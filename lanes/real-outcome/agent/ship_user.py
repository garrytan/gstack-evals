"""The real-outcome lane's simulated user (plan 2026-11-01-geva-87, open item 4).

One persona for every arm, scoped to the trial: it never enters the container. In the build turn it holds shipping
("Not yet...") so neither arm ships before its ship turn; otherwise it picks the option the agent marked as recommended,
or answers "Go with your recommendation." A turn that ends on a prose question gets the same answer, at most
prose_replies_per_turn times per turn; in the build turn, a closing question about shipping, or a recommended next step
that ships, gets no reply, since the ship turn answers it. src/usersim's global guards are untouched. Every question, answer and source is logged and counted.

A registry arm (family G) counts per turn. In its turns before the skill turn (G ruling A on red-team #1), an ask that
proposes implementing gets PLAN_HOLD instead, counted as a hold: a closing ask that implements() reads in its question
or recommendation, or an AskUserQuestion whose question, or the option the persona would pick, proposes it. A generic
action ask counts too, unless it names the plan, or the persona would pick among options that each name it. A hold
reply spends the turn's prose allowance like any other. Every other answer, and every answer from the skill turn on, is
unchanged.
"""

import json
import re
import time
from pathlib import Path

PHASES = ("build", "ship")
# A sentence that proposes the agent's next step: what "Go with your recommendation." would approve.
RECOMMENDS = re.compile(r"\b(recommend|suggest|propose|next steps?|I'd|I would|I can|I could|I'll|I will|let me|ready to)\b", re.I)
PLAN_HOLD = "Not yet. Keep to PLAN.md for now; don't write code yet."
# What "proposes implementing" means, one sentence or line at a time. An implement ask names writing code: a start verb
# before a code verb, the agent offering to write code, or an option that opens with "Implement". A generic action ask
# (proceed, go ahead, continue, get started, make these changes, do that, a bare "Should I?") means the same in a turn
# before the skill turn, unless its sentence names the plan, PLAN.md, a section or an option.
CODE = r"(?:implement(?:ing)?|implementation(?!\s+(?:plan|section|steps?|details?|order|notes?|approach|strategy|phases?)\b)|coding|cod(?:e|ing)\s+(?:it|this|that|them|up)|writ(?:e|ing)\s+(?:the\s+|any\s+)?code|build(?:ing)?\s+(?:it|this|that|them)|building(?!\s+(?:the\s+|a\s+)?plan)|execut(?:e|ing)\s+(?:it|this|that|the\s+plan)|carry(?:ing)?\s+out\s+(?:it|this|that|the\s+plan))"
IMPLEMENTS = re.compile(
    r"\b(?:start|begin|get\s+started|proceed|move\s+on|go\s+ahead|ready|kick\s+off|dive\s+in|jump\s+in)\b[^.?!\n]{0,30}?\b" + CODE + r"\b"
    r"|\b(?:I|I'll|I'd|I’ll|I’d|me|we|we'll|we’ll|let's|let’s)\s+(?:\w+\s+){0,3}?" + CODE + r"\b"
    r"|^(?:yes,?\s+)?implement(?:ing)?\b(?!\s+(?:with|using|via|as|in)\b)",
    re.I)
ACT = r"(?:proceed|go\s+ahead|continue|carry\s+on|keep\s+going|get\s+started|get\s+going|start|begin|move\s+(?:on|forward|ahead)|kick\s+(?:it\s+|things\s+)?off|dive\s+in|jump\s+in|get\s+to\s+work|(?:make|apply|do)\s+(?:(?:these|those|the|this|that|any|all(?:\s+(?:the|these|those))?)\s+)?(?:\w+\s+){0,2}?(?:changes?|edits?|fix(?:es)?|updates?|modifications?)|(?:do|handle|tackle|take\s+care\s+of)\s+(?:it|that|this|them))\b"
GENERIC = re.compile(
    r"\b(?:I|I'll|I'd|I’ll|I’d|me|we|we'll|we’ll|let's|let’s|ready|ok(?:ay)?|like)\s+(?:\w+\s+){0,2}?(?:to\s+)?" + ACT
    + r"|^(?:yes,?\s+)?" + ACT
    + r"|^(?:(?:shall|should|can|may)\s+(?:I|we)|(?:do\s+you\s+)?(?:want|would\s+you\s+like)\s+me\s+to)\s*\?$",
    re.I)
PLANNED = re.compile(r"\bplan(?:s|'s|’s)?\b|\bsections?\b|\b(?:options?|alternatives?)\b", re.I)
BEFORE = re.compile(r"\b(?:before|until)\b[^.?!\n]*", re.I)
NEGATED = re.compile(r"\b(?:not|never)\b|n['’]t\b", re.I)


def implements(text: str, plan_choice: bool = False) -> bool:
    """Whether text proposes implementing. A before or until clause names what comes later, so it is dropped first, and
    a statement (not a question) with not, never or n't declines rather than proposes. A generic action ask is exempt
    when its sentence names the plan, or when plan_choice says the answer picks among options that each name it."""
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", text or ""):
        sentence = sentence.strip()
        if NEGATED.search(sentence) and not sentence.endswith("?"):
            continue
        sentence = BEFORE.sub("", sentence).strip()
        if IMPLEMENTS.search(sentence) or (GENERIC.search(sentence) and not plan_choice and not PLANNED.search(sentence)):
            return True
    return False


class ShipUser:
    def __init__(self, persona: dict, log_path: Path):
        self.persona = persona
        self.log_path = log_path
        self.ship_words = re.compile(persona["ship_words"], re.I)
        self.asks = re.compile(persona["asks_user"], re.I)
        self.phase = "build"
        self.plan_turns = frozenset()
        self.counts = {p: {"questions": 0, "recommended": 0, "fallback": 0, "hold": 0, "prose": 0, "prose_unanswered": 0} for p in PHASES}
        self.prose_used = 0

    def log(self, event: dict) -> None:
        event["ts"] = time.time()
        with self.log_path.open("a") as f:
            f.write(json.dumps(event, default=str) + "\n")

    def per_turn(self, phases: list, plan_turns: list = ()) -> None:
        """A registry arm (family G) counts per turn (t1, t2, ...) instead of build and ship. It never holds shipping,
        since only a build turn does. plan_turns are the turns before the arm's skill turn, where it holds code."""
        assert set(plan_turns) <= set(phases), (plan_turns, phases)
        self.counts = {p: {"questions": 0, "recommended": 0, "fallback": 0, "hold": 0, "prose": 0, "prose_unanswered": 0} for p in phases}
        self.plan_turns = frozenset(plan_turns)
        self.phase = phases[0]

    def start(self, phase: str) -> None:
        assert phase in self.counts, phase
        self.phase = phase
        self.prose_used = 0
        self.log({"event": "phase", "phase": phase})

    def turn_ended(self) -> None:
        """A new user turn starts its own prose allowance only when the evaluator sends a phase's opening message."""

    def pick(self, question: dict) -> tuple[str, str]:
        labels = " ".join(str(o.get("label", "")) + " " + str(o.get("description", "")) for o in question.get("options", []) or [])
        if self.phase == "build" and self.ship_words.search(str(question.get("question", "")) + " " + labels):
            return self.persona["hold"], "hold"
        options = question.get("options", []) or []
        text = lambda option: str(option.get("label", "")) + " " + str(option.get("description", ""))
        picked = next((o for o in options if any(marker in text(o).lower().replace("not recommended", "") for marker in self.persona["recommended_markers"])), None)
        chosen = [picked] if picked else options
        plan_choice = bool(chosen) and all(PLANNED.search(text(o)) for o in chosen)
        if self.phase in self.plan_turns and implements("\n".join([str(question.get("question", ""))] + [text(o) for o in chosen]), plan_choice):
            return PLAN_HOLD, "hold"
        if picked:
            return str(picked.get("label", "")), "recommended"
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

    def recommendation(self, text: str) -> str:
        """The sentences and lines in the same last 600 characters that propose a next step."""
        tail = (text or "").strip()[-600:]
        return "\n".join(s for s in re.split(r"(?<=[.!?])\s+|\n+", tail) if RECOMMENDS.search(s))

    def prose(self, text: str):
        """The reply to a turn that ended on prose, or None when the evaluator moves on."""
        if not self.asks_user(text):
            return None
        why = None
        if self.phase == "build" and self.ship_words.search(self.question(text) + "\n" + self.recommendation(text)):
            why = "build_turn_ship_question"
        elif self.prose_used >= int(self.persona["prose_replies_per_turn"]):
            why = "prose_limit"
        if why:
            self.counts[self.phase]["prose_unanswered"] += 1
            self.log({"event": "prose", "phase": self.phase, "text": (text or "")[-300:], "answer": None, "source": why})
            return None
        self.prose_used += 1
        if self.phase in self.plan_turns and implements(self.question(text) + "\n" + self.recommendation(text)):
            self.counts[self.phase]["hold"] += 1
            self.log({"event": "prose", "phase": self.phase, "text": (text or "")[-300:], "answer": PLAN_HOLD, "source": "hold"})
            return PLAN_HOLD
        self.counts[self.phase]["prose"] += 1
        self.log({"event": "prose", "phase": self.phase, "text": (text or "")[-300:], "answer": self.persona["fallback"], "source": "fallback"})
        return self.persona["fallback"]
