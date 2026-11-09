"""Family SM's no-answer rule (the implicit state machines prereg, section 6), for real_agent's family SM mode.

Nobody answers the agent. A question asked in prose ends its turn, and the session is scored as is: prose() counts it and
returns None, so real_agent's phase ends quiet with no second user turn. Claude Code's AskUserQuestion tool gets one fixed
reply for every question, in every arm, the no-gstack arm included. The counts land in real-summary.json (persona) and the
session record, so question counts are reported per arm.

A prose question is the literal reading of ship_user.py's rule without its persona patterns: the last assistant text ends
in "?", or one of its last three lines does.
"""

import json
import re
import time
from pathlib import Path


def sm_turn(spec: dict, task: dict, instruction: str, trim) -> str:
    """The one user turn an SM arm sends, as lanes/outcome-skills/statemachines/arms.ts smTurn writes it."""
    text = spec["turns"][0]["text"]
    if spec["kind"] == "followon":
        statement = trim(instruction)
        if not statement.strip():
            raise ValueError("the follow-on's issue text is empty")
        return statement + text[len("{statement}"):]
    scope = task.get("scope") or ""
    if not scope or re.search(r"[\n\r`]", scope):
        raise ValueError(f"the scope must be one line with no backtick, not {scope!r}")
    return text.replace("{scope}", scope, 1)


class NoAnswer:
    def __init__(self, reply: str, log_path: Path):
        self.reply = reply
        self.log_path = log_path
        self.phase = "t1"
        self.counts = {"t1": {"questions": 0, "ask_user_question": 0, "prose_questions": 0}}

    def log(self, event: dict) -> None:
        with self.log_path.open("a") as f:
            f.write(json.dumps({"t": round(time.time(), 2), **event}, default=str) + "\n")

    def per_turn(self, phases: list, plan_turns: list = ()) -> None:
        self.counts = {p: {"questions": 0, "ask_user_question": 0, "prose_questions": 0} for p in phases}

    def start(self, phase: str) -> None:
        self.phase = phase
        self.counts.setdefault(phase, {"questions": 0, "ask_user_question": 0, "prose_questions": 0})

    def answer(self, questions: list) -> dict:
        answers = {}
        for q in questions or []:
            self.counts[self.phase]["questions"] += 1
            self.counts[self.phase]["ask_user_question"] += 1
            self.log({"event": "question", "phase": self.phase, "question": q.get("question"), "answer": self.reply, "source": "no_answer"})
            answers[q.get("question", "")] = self.reply
        return answers

    def prose(self, text: str):
        tail = (text or "").strip()[-600:]
        if re.search(r"\?\s*$", tail) or any(line.rstrip().endswith("?") for line in tail.splitlines()[-3:]):
            self.counts[self.phase]["questions"] += 1
            self.counts[self.phase]["prose_questions"] += 1
            self.log({"event": "prose_question", "phase": self.phase, "answer": None})
        return None
