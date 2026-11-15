# Copyright (c) 2026 Garry Tan. MIT License.
"""The head-to-head session loop's pure rules (post section 4), with no SDK import so the keyless tests can run them under
any python3: the DONE rule as turns.ts hasDone writes it, and the loop's next step after a turn. prereg.json's done_rule is
passed in; nothing here retypes a frozen value.
"""
import re
import unicodedata

JS_SPACE = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


def js_trim(s: str) -> str:
    """String.prototype.trim: JavaScript's whitespace, which differs from str.strip."""
    return s.strip(JS_SPACE)


def bare_line(line: str) -> str:
    """A line with every Unicode punctuation and symbol character removed, then trimmed (turns.ts bareLine)."""
    return js_trim("".join(c for c in line if unicodedata.category(c)[0] not in "PS"))


def has_done(final_message, rule: dict) -> bool:
    """Any of the last last_nonempty_lines non-empty lines, bare and (when case_insensitive) lower-cased, is the word."""
    if not final_message:
        return False
    lines = [l for l in re.split(r"\r\n|\r|\n", final_message) if js_trim(l) != ""][-int(rule["last_nonempty_lines"]):]
    word = rule["word"].lower() if rule["case_insensitive"] else rule["word"]
    return any((bare_line(l).lower() if rule["case_insensitive"] else bare_line(l)) == word for l in lines)


def next_turn(scripted_left: int, done: bool, continuations: int, cap: int) -> str:
    """After a turn that ended completed: the next scripted turn while any is left (scripted turns always run, whatever
    the turn said), else a continuation while DONE is absent and the cap is not reached, else the session ends."""
    if scripted_left > 0:
        return "scripted"
    if not done and continuations < cap:
        return "continuation"
    return "end_done" if done else "end_cap"
