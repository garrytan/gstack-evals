# Copyright (c) 2026 Garry Tan. MIT License.
"""Routed mode: mini's DefaultAgent with query() and execute_actions() overridden to add the five decision points.

Router holds the defer rule: each layer acts or hands the decision down, by one rule per layer, the same in every
cell that has the layer (prereg section 4; pin semantics in the build spec section 6). RoutedAgent asks the router at
the five moments, runs decider-picked actions itself as synthetic assistant messages in mini's own tool-call format
(marked extra.dr_controller) followed by mini's own observation message, and keeps the loop guards.
"""
import json
import time

from minisweagent.agents.default import DefaultAgent
from minisweagent.exceptions import LimitsExceeded, Submitted, TimeExceeded

from dr_agent import rules_parser
from dr_agent.counting import AllowanceStop, CountingMixin, exit_message, stop_status
from dr_agent.deciders import layer
from dr_agent.state import BLOCKED_EXIT, Tracker, snapshot_diff

CELL_LAYERS = {"R": ("jev", "particle", "frontier"), "P": ("particle", "frontier"), "F": ("frontier",), "J": ("jev", "frontier")}
LISTING_MIN_HITS = 20
MAX_ASKED_HITS = 100
MAX_DECIDER_ACTIONS = 3
BLOCKED = "blocked as unsafe"
NOT_DONE = "Not submitted: the done check says the task is not done yet. Keep working on the issue."
LAYER_ORDER = ("jev", "particle", "frontier")


class Router:
    def __init__(self, cell, pin, questions, jev=None, particle=None, frontier=None):
        names = CELL_LAYERS[cell]
        self.cell, self.pin, self.q = cell, pin, questions
        self.jev = jev if "jev" in names else None
        self.particle = particle if "particle" in names else None
        self.frontier = frontier if "frontier" in names else None
        self.pbands = pin.get("particle_guess" if cell == "R" else "particle_noguess", {})

    @staticmethod
    def _out(layers, acting, **kw):
        return {"layers": layers, "acting_layer": acting, **kw}

    def _jev_choice_acts(self, rec):
        if not rec["ok"] or rec["answer"] == "other":
            return False
        if self.cell == "J":
            return rec["conf"] >= self.pin["j_fixed"]["choice"]
        edge = self.pin["jev"]["next_step"].get("edge")
        return edge is not None and rec["conf"] >= edge

    def _jev_noul(self, typ, rec):
        p, conf, ans = rec["p_yes"], rec["conf"], rec["answer"]
        if self.cell == "J":
            fixed = self.pin["j_fixed"]
            return "yes" if p >= fixed["noul_yes"] else ("no" if p <= fixed["noul_no"] else None)
        band = self.pin["jev"].get(typ, {})
        if typ == "safe":
            if ans == "no" and band.get("block_edge") is not None and conf >= band["block_edge"]:
                return "no"
            if ans == "yes" and band.get("allow_edge") is not None and conf >= band["allow_edge"]:
                return "yes"
            return None
        edge = band.get("edge")
        return ans if edge is not None and conf >= edge else None

    def _jev_drops(self, p):
        if self.cell == "J":
            return p <= self.pin["j_fixed"]["relevant_drop_p"]
        edge = self.pin["jev"].get("relevant", {}).get("drop_edge")
        return edge is not None and (1 - p) >= edge

    def _particle_drops(self, p):
        edge = self.pbands.get("relevant", {}).get("drop_edge")
        return edge is not None and (1 - p) >= edge

    def _particle_choice_acts(self, rec):
        edge = self.pbands.get("next_step", {}).get("edge")
        return rec["ok"] and rec["answer"] != "other" and edge is not None and rec["conf"] >= edge

    def decide_next(self, state, options, ask_done=False):
        layers, done_jev, guess = {}, None, None
        q = self.q.choice_next(options)
        if self.jev:
            qs = {"next_step": q, **({"done": self.q.noul("done")} if ask_done else {})}
            recs = self.jev.ask(state, qs)
            rec = layers["jev"] = recs["next_step"]
            done_jev = recs.get("done")
            if self._jev_choice_acts(rec):
                return self._out(layers, "jev", pick=rec["answer"], done_jev=done_jev)
            if self.cell == "R" and rec["ok"]:
                guess = {"answer": rec["answer"], "probabilities": rec["probs"]}
        if self.particle:
            rec = layers["particle"] = self.particle.ask_choice(state, q, guess)
            if self._particle_choice_acts(rec):
                return self._out(layers, "particle", pick=rec["answer"], done_jev=done_jev)
        if self.frontier and self.cell == "F":
            rec = layers["frontier"] = self.frontier.ask_choice(state, q)
            if rec["ok"] and rec["answer"] != "other":
                return self._out(layers, "frontier", pick=rec["answer"], done_jev=done_jev)
        return self._out(layers, "main_turn", pick=None, done_jev=done_jev)

    def decide_noul(self, typ, state, rule=None, jev_rec=None):
        layers, guess = {}, None
        if rule is not None:
            layers["rule"] = layer(ok=True, answer=rule, p_yes=1.0 if rule == "yes" else 0.0, conf=1.0)
            return self._out(layers, "rule", answer=rule)
        q = self.q.noul(typ)
        if self.jev:
            rec = layers["jev"] = jev_rec if jev_rec is not None else self.jev.ask(state, {typ: q})[typ]
            if rec["ok"]:
                ans = self._jev_noul(typ, rec)
                if ans:
                    return self._out(layers, "jev", answer=ans)
                if self.cell == "R":
                    guess = {"answer": rec["answer"], "p_yes": rec["p_yes"]}
        if self.particle:
            rec = layers["particle"] = self.particle.ask_noul(state, q, guess)
            if rec["ok"]:
                return self._out(layers, "particle", answer=rec["answer"])
        if self.frontier:
            rec = layers["frontier"] = self.frontier.ask_noul(state, q)
            if rec["ok"]:
                return self._out(layers, "frontier", answer=rec["answer"])
        return self._out(layers, "main_turn", answer=None)

    def decide_relevant(self, state, hits):
        layers, dropped_by, guess = {}, {}, None
        if self.jev:
            rec = layers["jev"] = self.jev.ask_hits(state, hits, self.q)
            for e in rec["answer"] or []:
                if self._jev_drops(e["p_yes"]):
                    dropped_by[e["hit"]] = "jev"
            if self.cell == "R" and rec["answer"]:
                guess = [{"hit": e["hit"], "answer": e["answer"], "p_yes": e["p_yes"]} for e in rec["answer"] if e["hit"] not in dropped_by]
        remaining = [h for h in hits if h not in dropped_by]
        if self.particle and remaining:
            rec = layers["particle"] = self.particle.ask_hits(state, self.q.relevant_text(), remaining, guess)
            for e in rec["answer"] or [] if rec["ok"] else []:
                if self._particle_drops(e["p_yes"]):
                    dropped_by[e["hit"]] = "particle"
        if self.frontier and self.cell == "F":
            rec = layers["frontier"] = self.frontier.ask_hits(state, self.q.relevant_text(), hits)
            for e in rec["answer"] or [] if rec["ok"] else []:
                if e["answer"] == "no":
                    dropped_by[e["hit"]] = "frontier"
        dropped = [h for h in hits if h in dropped_by]
        acting = "keep" if not dropped else next(n for n in reversed(LAYER_ORDER) if n in dropped_by.values())
        return self._out(layers, acting, dropped=dropped, dropped_by=dropped_by)


class RoutedAgent(CountingMixin, DefaultAgent):
    def __init__(self, model, env, *, router, dlog, tracker: Tracker, action_limit=100, **kwargs):
        super().__init__(model, env, action_limit=action_limit, **kwargs)
        self.router, self.dlog, self.tracker = router, dlog, tracker
        self.decider_actions = self.submits = self.submits_blocked = self.blocked_commands = 0
        self.guards = {"max3": 0, "repeat": 0, "rerun_no_change": 0}
        self.since_main, self.last_decider_command, self.run_tests_diff = 0, None, None

    def _wall(self):
        limit = self.config.wall_time_limit_seconds
        if 0 < limit <= int(time.time() - self._start_time):
            raise TimeExceeded(exit_message("wall_stop"))

    def _decide(self, fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except AllowanceStop as e:
            raise LimitsExceeded(exit_message(stop_status(e), str(e)[:500])) from e

    def _state(self, **extra):
        return {**self.tracker.base_state(), **extra}

    def _begin(self, typ, state, **fields):
        return self.dlog.begin(typ, "live", self.executed_actions, state, **fields)

    def _finish(self, rec, out, **fields):
        rec.update(layers=out["layers"], acting_layer=out["acting_layer"], **fields)
        self.dlog.write(rec)

    def query(self):
        self.check_limits()
        if self.n_calls > 0:
            self._next_steps()
        message = super().query()
        self.since_main, self.last_decider_command = 0, None
        return message

    def _next_steps(self):
        while self.executed_actions < self.action_limit:
            self._wall()
            options, cands, commands = self.tracker.next_options()
            state = self._state(candidates=cands, options=options)
            rec = self._begin("next_step", state, options=options, candidates=cands)
            if self.since_main >= MAX_DECIDER_ACTIONS:
                self.guards["max3"] += 1
                return self._finish(rec, {"layers": {}, "acting_layer": "main_turn"}, guard="max3")
            out = self._decide(self.router.decide_next, state, options, ask_done="submit" in options)
            pick = out["pick"]
            command = commands.get(pick) if pick else None
            guard = None
            if pick and command == self.last_decider_command:
                guard = "repeat"
            elif pick == "run_tests" and self.run_tests_diff is not None and self.tracker.diff_hash() == self.run_tests_diff:
                guard = "rerun_no_change"
            if guard:
                self.guards[guard] += 1
                return self._finish(rec, {"layers": out["layers"], "acting_layer": "main_turn"}, guard=guard)
            self._finish(rec, out, acted=pick)
            if pick is None:
                return
            if pick == "run_tests":
                self.run_tests_diff = self.tracker.diff_hash()
            self._controller_action(command, rec["decision_id"], out["done_jev"] if pick == "submit" else None, state)

    def _controller_action(self, command, decision_id, done_jev, done_state):
        call_id = f"call_dr_{self.dlog.seq}"
        action = {"command": command, "tool_call_id": call_id}
        message = {"role": "assistant", "content": None,
                   "tool_calls": [{"id": call_id, "type": "function", "function": {"name": "bash", "arguments": json.dumps({"command": command})}}],
                   "extra": {"actions": [action], "dr_controller": True, "decision_id": decision_id, "cost": 0.0, "timestamp": time.time()}}
        self.add_messages(message)
        self.decider_actions += 1
        self.since_main += 1
        self.last_decider_command = command
        output = self._run_action(action, "decider", done_jev=done_jev, done_state=done_state)
        self.add_messages(*self.model.format_observation_messages(message, [output], self.get_template_vars()))

    def execute_actions(self, message):
        outputs = [self._run_action(a, "main") for a in message.get("extra", {}).get("actions", [])]
        return self.add_messages(*self.model.format_observation_messages(message, outputs, self.get_template_vars()))

    def _run_action(self, action, by, done_jev=None, done_state=None):
        command = action.get("command", "")
        if by == "main":
            self.env.check_limit()
            state = self._state(command=command)
            rec = self._begin("safe", state, command=command)
            out = self._decide(self.router.decide_noul, "safe", state)
            blocked = out["answer"] == "no"
            self._finish(rec, out, acted={"no": "blocked", "yes": "allowed"}.get(out["answer"]))
            if blocked:
                self.blocked_commands += 1
                self.tracker.record(command, BLOCKED, BLOCKED_EXIT, by)
                return {"output": BLOCKED, "returncode": 1, "exception_info": ""}
        try:
            output = self.env.execute(action)
        except Submitted as e:
            return self._on_submit(command, e, by, done_jev, done_state)
        self.tracker.record(command, output.get("output", ""), output.get("returncode"), by)
        if rules_parser.is_test_command(command):
            self._tests_passed(command, output)
        if by == "main" and rules_parser.is_listing_command(command):
            output = self._relevance(command, output)
        return output

    def _tests_passed(self, command, output):
        rc = output.get("returncode")
        runner = rules_parser.is_runner_exit(command)
        state = self._state(command=command, exit_code=rc)
        rec = self._begin("tests_passed", state, command=command, exit_code=rc, rule="runner_exit" if runner else None)
        self.dlog.snapshot(rec, snapshot_diff(self.tracker.cwd))
        out = self._decide(self.router.decide_noul, "tests_passed", state, rule=("yes" if rc == 0 else "no") if runner else None)
        self.tracker.last_test = {"yes": "passed", "no": "failed"}.get(out["answer"], "unknown")
        self._finish(rec, out, acted=self.tracker.last_test)

    def _relevance(self, command, output):
        text = output.get("output", "")
        hits, line_paths = self.tracker.listing_hits(text)
        if len(hits) <= LISTING_MIN_HITS:
            return output
        asked = hits[:MAX_ASKED_HITS]
        state = self._state(command=command, hits=asked)
        rec = self._begin("relevant", state, command=command, hits=asked, hits_total=len(hits))
        out = self._decide(self.router.decide_relevant, state, asked)
        self._finish(rec, out, acted=out["dropped"], dropped_by=out["dropped_by"])
        if not out["dropped"]:
            return output
        filtered = dict(output, output=self.tracker.filter_output(text, line_paths, out["dropped"], len(hits)))
        self.tracker.last_output = filtered["output"]
        return filtered

    def _on_submit(self, command, exc, by, done_jev, done_state):
        self.submits += 1
        self.tracker.record(command, "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT\n" + exc.messages[0]["extra"].get("submission", ""), 0, by)
        state = done_state if done_jev is not None else self._state(command=command)
        rec = self._begin("done", state, command=command)
        self.dlog.snapshot(rec, snapshot_diff(self.tracker.cwd))
        if self.submits >= 3:
            self._finish(rec, {"layers": {}, "acting_layer": "rule"}, acted="third_submit_stands")
            raise exc
        out = self._decide(self.router.decide_noul, "done", state, jev_rec=done_jev)
        self._finish(rec, out, acted={"no": "not_done", "yes": "done"}.get(out["answer"]))
        if out["answer"] == "no":
            self.submits_blocked += 1
            return {"output": NOT_DONE, "returncode": 1, "exception_info": ""}
        raise exc
