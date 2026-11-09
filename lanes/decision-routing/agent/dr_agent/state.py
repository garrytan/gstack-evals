# Copyright (c) 2026 Garry Tan. MIT License.
"""The decision state every decider sees, built by code from the session's live record.

Trims (prereg section 4): the issue text to its first 4,000 characters, the diff to its stat plus its first 3,000
characters, the last command and its output together to 8,000 characters, and the last 10 steps to one line each
(the command cut to 120 characters plus its exit code). No model writes any of it.
"""
import hashlib
import json
import os
import re
import shlex
import subprocess
import tempfile

from dr_agent import rules_parser

ISSUE_CHARS = 4000
DIFF_CHARS = 3000
LAST_CHARS = 8000
STEP_COMMAND_CHARS = 120
RECENT_STEPS = 10
MAX_CANDIDATES = 5
SUBMIT_COMMAND = "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT && cat patch.txt"
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
TRACEBACK = re.compile(r'File "([^"]+)", line \d+')
CUT = "\n[... middle cut ...]\n"


def canonical(obj):
    """The exact bytes a state is hashed, stored and sent as."""
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def cut_middle(text, limit):
    """Keep the head and the tail of text so it fits in limit characters."""
    if len(text) <= limit:
        return text
    if limit <= len(CUT):
        return text[:limit]
    keep = limit - len(CUT)
    head = keep // 2
    return text[:head] + CUT + text[len(text) - (keep - head) :]


def step_line(command, exit_code):
    flat = " ".join(command.split("\n"))
    return f"{flat[:STEP_COMMAND_CHARS]} (exit {exit_code})"


def git(cwd, args, env=None):
    try:
        p = subprocess.run(["git", "-c", "core.fileMode=false", *args], cwd=cwd, env=env, capture_output=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        return 1, b""
    return p.returncode, p.stdout


def snapshot_diff(cwd, *, binary=True, stat=False):
    """The working tree's diff against HEAD, new files included, through a throwaway index (the real index is untouched)."""
    with tempfile.TemporaryDirectory() as tmp:
        env = {**os.environ, "GIT_INDEX_FILE": os.path.join(tmp, "index")}
        has_head = git(cwd, ["rev-parse", "--verify", "-q", "HEAD"])[0] == 0
        if has_head:
            git(cwd, ["read-tree", "HEAD"], env)
        git(cwd, ["add", "-A"], env)
        args = ["diff", "--cached"] + (["--binary"] if binary and not stat else []) + (["--stat"] if stat else []) + ["HEAD" if has_head else EMPTY_TREE]
        return git(cwd, args, env)[1]


class Tracker:
    """The session's live record: steps, last command and output, test state and printed files."""

    def __init__(self, cwd, issue):
        self.cwd, self.issue = cwd, issue
        self.steps = []
        self.last_command, self.last_output, self.last_exit = None, "", None
        self.last_test_command = None
        self.last_test = "unknown"
        self.printed = set()

    def record(self, command, output, exit_code, by):
        self.steps.append((command, exit_code))
        self.last_command, self.last_output, self.last_exit = command, output, exit_code
        self.printed |= {self.norm(p) for p in rules_parser.printed_paths(command)}
        if by == "main" and rules_parser.is_test_command(command):
            self.last_test_command = command

    def norm(self, path):
        p = path.strip()
        if os.path.isabs(p):
            rel = os.path.relpath(p, self.cwd)
            return p if rel.startswith("..") else rel
        return os.path.normpath(p)

    def is_file(self, path):
        p = self.norm(path)
        return bool(p) and not os.path.isabs(p) and not p.startswith("..") and os.path.isfile(os.path.join(self.cwd, p))

    def diff_parts(self):
        stat = snapshot_diff(self.cwd, stat=True).decode("utf-8", "replace")
        text = snapshot_diff(self.cwd, binary=False).decode("utf-8", "replace")
        return stat, text

    def diff_hash(self):
        return sha256(snapshot_diff(self.cwd))

    def base_state(self):
        stat, text = self.diff_parts()
        cmd = (self.last_command or "")[:LAST_CHARS]
        return {
            "task": self.issue[:ISSUE_CHARS],
            "diff": {"stat": stat, "text": text[:DIFF_CHARS]},
            "last_command": cmd,
            "last_output": cut_middle(self.last_output or "", LAST_CHARS - len(cmd)),
            "last_exit_code": self.last_exit,
            "recent_steps": [step_line(c, e) for c, e in self.steps[-RECENT_STEPS:]],
            "last_test": self.last_test,
        }

    def candidates(self):
        """Up to 5 files named in the last output (a traceback or a search) that no command has printed yet."""
        out, seen = [], set()
        names = TRACEBACK.findall(self.last_output or "")
        for line in (self.last_output or "").splitlines():
            head = line.split(":", 1)[0].strip()
            names += [head, line.strip()]
        for name in names:
            p = self.norm(name) if name else ""
            if p and p not in seen and p not in self.printed and self.is_file(p):
                seen.add(p)
                out.append(p)
            if len(out) == MAX_CANDIDATES:
                break
        return out

    def next_options(self):
        """Options rebuilt from live state, and the command code runs for each."""
        cands = self.candidates()
        options, commands = [], {}
        if self.last_test_command:
            options.append("run_tests")
            commands["run_tests"] = self.last_test_command
        for k, p in enumerate(cands):
            options.append(f"show_{k}")
            commands[f"show_{k}"] = f"cat {shlex.quote(p)}"
        if os.path.isfile(os.path.join(self.cwd, "patch.txt")):
            options.append("submit")
            commands["submit"] = SUBMIT_COMMAND
        options.append("other")
        return options, cands, commands

    def listing_hits(self, output):
        """Distinct file paths in a listing's output, in output order, and each line's path (None for other lines)."""
        hits, seen, line_paths, current = [], set(), [], None
        for line in output.splitlines():
            path = None
            s = line.strip()
            if s.endswith(":") and os.path.isdir(os.path.join(self.cwd, self.norm(s[:-1]) or ".")):
                current = self.norm(s[:-1])
            else:
                head = s.split(":", 1)[0]
                for cand in (head, s, os.path.join(current, s) if current and s else ""):
                    if cand and self.is_file(cand):
                        path = self.norm(cand)
                        break
            line_paths.append(path)
            if path and path not in seen:
                seen.add(path)
                hits.append(path)
        return hits, line_paths

    @staticmethod
    def filter_output(output, line_paths, dropped, total):
        drop = set(dropped)
        kept = [line for line, p in zip(output.splitlines(), line_paths) if p not in drop]
        return "\n".join(kept) + f"\n[{len(drop)} of {total} path hits dropped as not relevant to the task]\n"
