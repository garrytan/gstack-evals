# Copyright (c) 2026 Garry Tan. MIT License.
"""The frozen test-runner rule and the small shell parser behind it.

A command is runner-exit only when it is one simple command, or cd <dir> && followed by one, whose program or module
is in RUNNERS / RUNNER_MODULES, with no pipe, ;, ||, &, && or second command after it. Redirection to a file is
allowed. Then its exit code decides whether the tests passed. Anything else goes to the decider.
"""
import os
import re

RUNNERS = frozenset({"pytest", "py.test", "tox", "nox"})
RUNNER_MODULES = frozenset({"pytest", "unittest"})
PYTHON = re.compile(r"^python(\d+(\.\d+)?)?$")
LISTERS = frozenset({"grep", "egrep", "fgrep", "rg", "find", "ag"})
PRINTERS = frozenset({"cat", "head", "tail", "sed", "nl", "less"})
OPS = ("||", "&&", "|&", "|", ";", "&", "\n")


def tokenize(cmd):
    """Split a shell command into ("word", text), ("op", text) and ("redir", text) tokens.

    Returns (tokens, bad). bad is True when the command uses anything the rule does not model: command substitution,
    subshells or groups, here-docs, or unbalanced quotes.
    """
    toks, word, i, n = [], None, 0, len(cmd)

    def flush():
        nonlocal word
        if word is not None:
            toks.append(("word", word))
            word = None

    while i < n:
        c = cmd[i]
        if c in " \t":
            flush()
            i += 1
        elif c == "\\" and i + 1 < n:
            if cmd[i + 1] == "\n":
                i += 2
                continue
            word = (word or "") + cmd[i + 1]
            i += 2
        elif c == "'":
            j = cmd.find("'", i + 1)
            if j < 0:
                return toks, True
            word = (word or "") + cmd[i + 1 : j]
            i = j + 1
        elif c == '"':
            j, buf = i + 1, ""
            while j < n and cmd[j] != '"':
                if cmd[j] == "\\" and j + 1 < n:
                    buf += cmd[j + 1]
                    j += 2
                    continue
                if cmd[j] == "`" or cmd.startswith("$(", j):
                    return toks, True
                buf += cmd[j]
                j += 1
            if j >= n:
                return toks, True
            word = (word or "") + buf
            i = j + 1
        elif c == "`" or cmd.startswith("$(", i) or c in "(){}":
            return toks, True
        elif c in "<>" or cmd.startswith("&>", i):
            if word is not None and word.isdigit():
                word = None
            flush()
            if cmd.startswith("<<", i):
                return toks, True
            m = re.match(r"&>>?|>>?&?|<&?", cmd[i:])
            op = m.group(0)
            i += len(op)
            if op.endswith("&") and op != "&>":
                m2 = re.match(r"\d+|-", cmd[i:])
                if not m2:
                    return toks, True
                i += len(m2.group(0))
                toks.append(("redir", op + m2.group(0)))
                continue
            toks.append(("redir", op))
        elif any(cmd.startswith(op, i) for op in OPS):
            flush()
            op = next(op for op in OPS if cmd.startswith(op, i))
            toks.append(("op", op))
            i += len(op)
        else:
            word = (word or "") + c
            i += 1
    flush()
    return toks, False


def segments(cmd):
    """Return (segments, ops, bad): the words of each simple command with redirections removed, and the operators."""
    toks, bad = tokenize(cmd.strip())
    segs, ops, cur, skip = [], [], [], False
    for kind, text in toks:
        if kind == "redir":
            skip = not text[-1:].isdigit() and not text.endswith("-")
        elif kind == "op":
            segs.append(cur)
            ops.append(text)
            cur, skip = [], False
        elif skip:
            skip = False
        else:
            cur.append(text)
    segs.append(cur)
    return segs, ops, bad


def _is_runner(words):
    if not words:
        return False
    prog = os.path.basename(words[0])
    if prog in RUNNERS:
        return True
    return bool(PYTHON.match(prog)) and len(words) >= 3 and words[1] == "-m" and words[2] in RUNNER_MODULES


def is_runner_exit(cmd):
    """The frozen rule: True when the command's exit code alone says whether its tests passed."""
    segs, ops, bad = segments(cmd)
    if bad or any(not s for s in segs):
        return False
    if not ops:
        return _is_runner(segs[0])
    return ops == ["&&"] and len(segs) == 2 and segs[0][0] == "cd" and len(segs[0]) == 2 and _is_runner(segs[1])


def is_test_command(cmd):
    """True when any simple command in it runs a test runner (the test-pass decision point)."""
    segs, _, bad = segments(cmd)
    if any(_is_runner(s) for s in segs):
        return True
    if bad:
        return bool(re.search(r"(^|[\s;&|(])(pytest|py\.test|tox|nox)(\s|$)|python[\d.]*\s+-m\s+(pytest|unittest)", cmd))
    return False


def is_listing_command(cmd):
    """True when the command lists paths: grep, rg, find, git grep or a recursive ls."""
    segs, _, _ = segments(cmd)
    for s in segs:
        if not s:
            continue
        prog = os.path.basename(s[0])
        if prog in LISTERS or (prog == "git" and len(s) > 1 and s[1] == "grep"):
            return True
        if prog == "ls" and any(a == "--recursive" or (a.startswith("-") and not a.startswith("--") and "R" in a) for a in s[1:]):
            return True
    return False


def printed_paths(cmd):
    """Paths a command prints with cat, head, tail, sed -n, nl or less (the files the agent has seen)."""
    segs, _, _ = segments(cmd)
    out = []
    for s in segs:
        if not s or os.path.basename(s[0]) not in PRINTERS:
            continue
        args = s[1:]
        if s[0] == "sed":
            if "-n" not in args:
                continue
            rest = [a for a in args if not a.startswith("-")]
            args = rest[1:]
        out += [a for a in args if not a.startswith("-") and not a.isdigit()]
    return out
