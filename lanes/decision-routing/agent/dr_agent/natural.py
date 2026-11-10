# Copyright (c) 2026 Garry Tan. MIT License.
"""Natural mode N (and W): mini's DefaultAgent plus the arm-neutral action counter and nothing else.

In calibration, ShadowLogger computes and logs the decision state at the five moments without asking anything:
before each main-model query after the first (with N's next command filled in as n_next), after each listing over
20 hits, before each command, after each test command and at submit. shadow.py answers the logged states later,
off the clock and outside the container.
"""
from minisweagent.agents.default import DefaultAgent

from dr_agent import rules_parser
from dr_agent.counting import CountingMixin
from dr_agent.deciders import layer
from dr_agent.routed import LISTING_MIN_HITS, MAX_ASKED_HITS
from dr_agent.state import snapshot_diff


class ShadowLogger:
    def __init__(self, dlog, tracker):
        self.dlog, self.tracker = dlog, tracker

    def _state(self, **extra):
        return {**self.tracker.base_state(), **extra}

    def _begin(self, agent, typ, state, **fields):
        return self.dlog.begin(typ, "shadow", agent.executed_actions, state, **fields)

    def before_query(self, agent):
        options, cands, _ = self.tracker.next_options()
        return self._begin(agent, "next_step", self._state(candidates=cands, options=options), options=options, candidates=cands)

    def fill_next(self, rec, message):
        actions = (message or {}).get("extra", {}).get("actions", [])
        rec["n_next"] = {"action": actions[0]["command"], "mapped": None} if actions else None
        self.dlog.write(rec)

    def before(self, agent, action):
        command = action.get("command", "")
        self.dlog.write(self._begin(agent, "safe", self._state(command=command), command=command))

    def after(self, agent, action, output):
        command, text, rc = action.get("command", ""), output.get("output", ""), output.get("returncode")
        self.tracker.record(command, text, rc, "main")
        if rules_parser.is_test_command(command):
            runner = rules_parser.is_runner_exit(command)
            rec = self._begin(agent, "tests_passed", self._state(command=command, exit_code=rc), command=command, exit_code=rc, rule="runner_exit" if runner else None)
            if runner:
                ans = "yes" if rc == 0 else "no"
                rec["layers"]["rule"] = layer(ok=True, answer=ans, p_yes=1.0 if ans == "yes" else 0.0, conf=1.0)
            self.tracker.last_test = ({"yes": "passed", "no": "failed"}[rec["layers"]["rule"]["answer"]]) if runner else "unknown"
            self.dlog.snapshot(rec, snapshot_diff(self.tracker.cwd))
            self.dlog.write(rec)
        if rules_parser.is_listing_command(command):
            hits, _ = self.tracker.listing_hits(text)
            if len(hits) > LISTING_MIN_HITS:
                asked = hits[:MAX_ASKED_HITS]
                self.dlog.write(self._begin(agent, "relevant", self._state(command=command, hits=asked), command=command, hits=asked, hits_total=len(hits)))

    def submitted(self, agent, action, exc):
        command = action.get("command", "")
        self.tracker.record(command, "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT\n" + exc.messages[0]["extra"].get("submission", ""), 0, "main")
        rec = self._begin(agent, "done", self._state(command=command), command=command)
        self.dlog.snapshot(rec, snapshot_diff(self.tracker.cwd))
        self.dlog.write(rec)


class NaturalAgent(CountingMixin, DefaultAgent):
    def __init__(self, model, env, *, shadow=None, action_limit=100, **kwargs):
        super().__init__(model, env, action_limit=action_limit, observer=shadow, **kwargs)
        self.shadow = shadow

    def query(self):
        rec = self.shadow.before_query(self) if self.shadow and self.n_calls > 0 else None
        message = None
        try:
            message = super().query()
            return message
        finally:
            if rec is not None:
                self.shadow.fill_next(rec, message)
