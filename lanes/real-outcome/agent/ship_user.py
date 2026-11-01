"""The real-outcome lane's simulated user (plan 2026-11-01-geva-87, open item 4).

One persona for every arm, scoped to the trial: it never enters the container. In the build turn it holds shipping
("Not yet...") so neither arm ships before its ship turn; otherwise it picks the option the agent marked as recommended,
or answers "Go with your recommendation." A turn that ends on a prose question gets the same answer, at most
prose_replies_per_turn times per turn; a build-turn closing question about shipping gets no reply, since the ship turn
answers it. src/usersim's global guards are untouched. Every question, answer and source is logged and counted.
"""

import json
import re
import time
from pathlib import Path

PHASES = ("build", "ship")


class ShipUser:
    def __init__(self, persona: dict, log_path: Path):
        self.persona = persona
        self.log_path = log_path
        self.ship_words = re.compile(persona["ship_words"], re.I)
        self.asks = re.compile(persona["asks_user"], re.I)
        self.phase = "build"
        self.counts = {p: {"questions": 0, "recommended": 0, "fallback": 0, "hold": 0, "prose": 0, "prose_unanswered": 0} for p in PHASES}
        self.prose_used = 0

    def log(self, event: dict) -> None:
        event["ts"] = time.time()
        with self.log_path.open("a") as f:
            f.write(json.dumps(event, default=str) + "\n")

    def start(self, phase: str) -> None:
        assert phase in PHASES, phase
        self.phase = phase
        self.prose_used = 0
        self.log({"event": "phase", "phase": phase})

    def turn_ended(self) -> None:
        """A new user turn starts its own prose allowance only when the evaluator sends a phase's opening message."""

    def pick(self, question: dict) -> tuple[str, str]:
        labels = " ".join(str(o.get("label", "")) + " " + str(o.get("description", "")) for o in question.get("options", []) or [])
        if self.phase == "build" and self.ship_words.search(str(question.get("question", "")) + " " + labels):
            return self.persona["hold"], "hold"
        for option in question.get("options", []) or []:
            text = (str(option.get("label", "")) + " " + str(option.get("description", ""))).lower().replace("not recommended", "")
            if any(marker in text for marker in self.persona["recommended_markers"]):
                return str(option.get("label", "")), "recommended"
        return self.persona["fallback"], "fallback"

    def answer(self, questions: list) -> dict:
        answers = {}
        for q in questions or []:
            reply, source = self.pick(q)
            self.counts[self.phase]["questions"] += 1
            self.counts[self.phase][source] += 1
            self.log({"event": "question", "phase": self.phase, "question": q.get("question"), "options": [o.get("label") for o in q.get("options", []) or []], "answer": reply, "source": source})
            answers[q.get("question", "")] = reply
        return answers

    def asks_user(self, text: str) -> bool:
        tail = (text or "").strip()[-600:]
        last = tail.split("\n\n")[-1]
        return bool(re.search(r"\?\s*$", tail)) or any(line.rstrip().endswith("?") for line in tail.splitlines()[-3:]) or bool(self.asks.search(last))

    def question(self, text: str) -> str:
        """The closing question asks_user fires on: the last paragraph's sentences that end in "?" and any of the last three
        lines that ends in one, or the whole last paragraph when only the asks pattern matched."""
        tail = (text or "").strip()[-600:]
        last = tail.split("\n\n")[-1]
        asked = [s for s in re.split(r"(?<=[.!?])\s+", last) if s.rstrip().endswith("?")]
        asked += [line for line in tail.splitlines()[-3:] if line.rstrip().endswith("?")]
        return "\n".join(asked) or (last if self.asks.search(last) else "")

    def prose(self, text: str):
        """The reply to a turn that ended on prose, or None when the evaluator moves on."""
        if not self.asks_user(text):
            return None
        why = None
        if self.phase == "build" and self.ship_words.search(self.question(text)):
            why = "build_turn_ship_question"
        elif self.prose_used >= int(self.persona["prose_replies_per_turn"]):
            why = "prose_limit"
        if why:
            self.counts[self.phase]["prose_unanswered"] += 1
            self.log({"event": "prose", "phase": self.phase, "text": (text or "")[-300:], "answer": None, "source": why})
            return None
        self.prose_used += 1
        self.counts[self.phase]["prose"] += 1
        self.log({"event": "prose", "phase": self.phase, "text": (text or "")[-300:], "answer": self.persona["fallback"], "source": "fallback"})
        return self.persona["fallback"]
