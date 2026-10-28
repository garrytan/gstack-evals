"""Evaluator-side user simulator for the Harbor spike.

Answers AskUserQuestion from a persona that never enters the trial container,
keyed by a deterministic keyword classifier, and logs every question and answer.
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
            f.write(json.dumps(event) + "\n")

    def classify(self, question: dict) -> str | None:
        text = " ".join(
            [question.get("question", ""), question.get("header", "")]
            + [o.get("label", "") for o in question.get("options", [])]
        ).lower()
        for category, keywords in self.persona["categories"].items():
            if any(k in text for k in keywords):
                return category
        return None

    def answer(self, questions: list[dict]) -> dict:
        answers = {}
        for q in questions:
            category = self.classify(q)
            reply = self.persona["replies"].get(category) if category else None
            source = "scripted" if reply is not None else "fallback_non_approving"
            if reply is None:
                reply = self.persona["fallback"]
            self.log({"event": "question", "question": q.get("question"), "options": [o.get("label") for o in q.get("options", [])], "category": category})
            self.log({"event": "answer", "question": q.get("question"), "answer": reply, "source": source})
            answers[q["question"]] = reply
        return answers
