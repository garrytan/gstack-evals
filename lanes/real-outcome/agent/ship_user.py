"""The real-outcome lane's simulated user (plan 2026-11-01-geva-87, open item 4).

One persona for every arm, scoped to the trial: it never enters the container. In the build turn it holds shipping
("Not yet...") so neither arm ships before its ship turn; otherwise it picks the option the agent marked as recommended,
or answers "Go with your recommendation." A turn that ends on a prose question gets the same answer, at most
prose_replies_per_turn times per turn; in the build turn, a closing question about shipping, or a recommended next step
that ships, gets no reply, since the ship turn answers it. src/usersim's global guards are untouched. Every question, answer and source is logged and counted.

A registry arm (family G) counts per turn. In its turns before the skill turn (G ruling A on red-team #1), an ask that
proposes implementing gets PLAN_HOLD instead, counted as a hold: a closing ask that implements() reads in its question
or recommendation, or an AskUserQuestion whose question, or the option the persona would pick, proposes it. A generic
action ask counts too, unless it names the plan, or the persona would pick among options that each name it. An option's
leading marker (A), 1., (b), -) is read past, a leading before or until clause ends at its comma, and a negation drops
only its own clause. A second reading can only add holds: in it a before or until clause that is not leading ends at its
own clause break, and a closing "or not" or a "whether or not" asks rather than declines. A bare "Should I?" reads the
sentence before it: an offer to draft the plan exempts it. A hold
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
# before the skill turn, unless its sentence names the plan, PLAN.md, a section or an option. "Proceed with" and "go
# ahead with" stay held when they name the plan; only a section, an option or a drafting verb right after "with"
# (writing, drafting, updating, finishing, revising) exempts them.
CODE = r"(?:implement(?:ing)?|implementation(?!\s+(?:plan|section|steps?|details?|order|notes?|approach|strategy|phases?)\b)|coding|cod(?:e|ing)\s+(?:it|this|that|them|up)|writ(?:e|ing)\s+(?:the\s+|any\s+)?code|build(?:ing)?\s+(?:it|this|that|them)|building(?!\s+(?:the\s+|a\s+)?plan)|build(?:ing)?\s+out(?!\s+(?:the\s+|a\s+)?plan)|wir(?:e|ing)\s+(?:(?:it|this|that|them)\s+)?up|execut(?:e|ing)\s+(?:it|this|that|the\s+plan)|carry(?:ing)?\s+out\s+(?:it|this|that|the\s+plan))"
IMPLEMENTS = re.compile(
    r"\b(?:start|begin|get\s+started|proceed|move\s+on|go\s+ahead|ready|kick\s+off|dive\s+in|jump\s+in)\b[^.?!\n]{0,30}?\b" + CODE + r"\b"
    r"|\b(?:I|I'll|I'd|I’ll|I’d|me|we|we'll|we’ll|let's|let’s)\s+(?:\w+\s+){0,3}?" + CODE + r"\b"
    r"|^(?:yes,?\s+)?implement(?:ing)?\b(?!\s+(?:with|using|via|as|in)\b)",
    re.I)
ACT = r"(?:proceed|go\s+ahead|continue|carry\s+on|keep\s+going|get\s+started|get\s+going|start|begin|move\s+(?:on|forward|ahead)|kick\s+(?:it\s+|things\s+)?off|dive\s+in|jump\s+in|get\s+to\s+work|(?:make|apply|do)\s+(?:(?:these|those|the|this|that|any|all(?:\s+(?:the|these|those))?)\s+)?(?:\w+\s+){0,2}?(?:changes?|edits?|fix(?:es)?|updates?|modifications?)|(?:do|handle|tackle|take\s+care\s+of)\s+(?:it|that|this|them))\b"
BARE = re.compile(r"^(?:(?:shall|should|can|may)\s+(?:I|we)|(?:do\s+you\s+)?(?:want|would\s+you\s+like)\s+me\s+to)\s*\?$", re.I)
GENERIC = re.compile(
    r"\b(?:I|I'll|I'd|I’ll|I’d|me|we|we'll|we’ll|let's|let’s|ready|ok(?:ay)?|like)\s+(?:\w+\s+){0,2}?(?:to\s+)?" + ACT
    + r"|^(?:yes,?\s+)?" + ACT + r"|" + BARE.pattern,
    re.I)
CHOICE = re.compile(r"\bsections?\b|\b(?:options?|alternatives?)\b", re.I)
PLANNED = re.compile(r"\bplan(?:s|'s|’s)?\b|" + CHOICE.pattern, re.I)
DRAFTING = r"writing|drafting|updating|finishing|revising"
PROCEED_WITH = re.compile(r"\b(?:proceed|go\s+ahead)\s+with\b(?!\s+(?:" + DRAFTING + r")\b)", re.I)
DRAFTS = re.compile(r"\b(?:write|draft|update|finish|revise|" + DRAFTING + r")\b[^.?!\n]{0,40}?\bplan(?:s|'s|’s)?\b", re.I)
OPTION = re.compile(r"^(?:[-*•]\s*)?\**\(?(?:[A-Za-z]|\d{1,2})[).:]\**\s+|^[-*•]\s+")
BEFORE = re.compile(r"^(?:before|until)\b[^,]*,\s*|\b(?:before|until)\b[^.?!\n]*", re.I)
CLAUSE = re.compile(r"[,;:]|\s[-–—]\s|\bbut\b", re.I)
NEGATED = re.compile(r"\b(?:not|never)\b|n['’]t\b", re.I)
# The second reading's two changes: a before or until clause that is not leading stops at its clause break (a comma,
# semicolon, colon, spaced dash, "but" or "or"), and "or not" or "or not yet" closing a clause, or "or not" after
# "whether", is dropped, since it asks rather than declines.
UNTIL = re.compile(r"^(?:before|until)\b[^,]*,\s*|\b(?:before|until)\b(?:(?![,;:]|\s[-–—]\s|\b(?:but|or)\b)[^.?!\n])*", re.I)
OR_NOT = re.compile(r"\s+or\s+not(?:\s+yet)?\b(?=\s*(?:[,;:.?!]|$))|(?<=\bwhether)\s+or\s+not\b", re.I)


def proceeds(text: str) -> bool:
    """"Proceed with" or "go ahead with" the plan itself, not one of its sections or options: writing the code."""
    return bool(PROCEED_WITH.search(text)) and not CHOICE.search(text)


def implements(text: str, plan_choice: bool = False) -> bool:
    """Whether text proposes implementing. An option's leading marker is read past. A before or until clause names what
    comes later, so it is dropped first: a leading one up to its comma, any other to the sentence's end. In a statement
    (not a question), a clause with not, never or n't declines rather than proposes, so it is dropped and the rest is
    read. A generic action ask is exempt when its sentence names the plan, or when plan_choice says the answer picks
    among plan options; but an ask that proceeds() means writing the code even when it names the plan. A bare
    "Should I?" is exempt when the sentence before it offers to draft the plan. Each sentence is read twice, and either
    reading holds: the second ends a before or until clause that is not leading at its clause break (UNTIL) and drops a
    closing "or not" (OR_NOT), so it can only hold more."""
    prior = ""
    for line in re.split(r"(?<=[.!?])\s+|\n+", text or ""):
        bare = OPTION.sub("", line.strip())
        sentence = BEFORE.sub("", bare).strip()
        if held(sentence, prior, plan_choice) or held(OR_NOT.sub("", UNTIL.sub("", bare)).strip(), prior, plan_choice):
            return True
        prior = sentence
    return False


def held(sentence: str, prior: str, plan_choice: bool) -> bool:
    """One reading of one sentence, prior being the sentence before it."""
    clauses = [sentence] if sentence.endswith("?") or not NEGATED.search(sentence) else [c.strip() for c in CLAUSE.split(sentence) if not NEGATED.search(c)]
    exempt = plan_choice or (PLANNED.search(sentence) and not proceeds(sentence)) or (BARE.search(sentence) and DRAFTS.search(prior) and not NEGATED.search(prior))
    return any(IMPLEMENTS.search(c) or (GENERIC.search(c) and not exempt) for c in clauses)


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
        plan_choice = bool(chosen) and all(PLANNED.search(text(o)) and not proceeds(text(o)) for o in chosen)
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
        said = re.split(r"(?<=[.!?])\s+", last)
        asked = [(said[i - 1] + " " if i and BARE.search(s.strip()) else "") + s for i, s in enumerate(said) if s.rstrip().endswith("?")]
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
