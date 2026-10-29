"""Evaluator-side user simulator for Lane B trials.

The same persona answers every arm. It never enters the trial container. Every
question and answer is logged with its source.
"""

import json
import time
from pathlib import Path


class Simulator:
    def __init__(self, persona: dict, log_path: Path):
        self.persona = persona
        self.log_path = log_path

    def log(self, event: dict) -> None:
        event["ts"] = time.time()
        with self.log_path.open("a") as f:
            f.write(json.dumps(event, default=str) + "\n")

    def pick(self, question: dict) -> tuple[str, str]:
        for option in question.get("options", []) or []:
            label = option.get("label", "")
            text = (label + " " + option.get("description", "")).lower().replace("not recommended", "")
            if any(marker in text for marker in self.persona["recommended_markers"]):
                return label, "recommended_option"
        return self.persona["fallback"], "fallback"

    def answer(self, questions: list[dict]) -> dict:
        answers = {}
        for q in questions:
            reply, source = self.pick(q)
            self.log({"event": "question", "question": q.get("question"), "options": [o.get("label") for o in q.get("options", []) or []]})
            self.log({"event": "answer", "question": q.get("question"), "answer": reply, "source": source})
            answers[q.get("question", "")] = reply
        return answers
