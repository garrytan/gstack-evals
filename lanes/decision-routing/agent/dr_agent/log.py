# Copyright (c) 2026 Garry Tan. MIT License.
"""The decision log (B4): decisions.jsonl, states/<seq>.json and snapshots/<seq>.diff under the session's log dir.

One record per decision, in the shape the build spec fixes. state_file holds the exact canonical bytes the
state_sha256 covers; snapshots hold the full binary diff of the tree at a test-pass or done decision. Both stay
runner-side and never enter the public repo.
"""
import json
import os
import time

from dr_agent.state import canonical, sha256

ZERO_USAGE = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0, "reasoning": 0}


class DecisionLog:
    def __init__(self, log_dir, session, cell, model, t0):
        self.dir, self.session, self.cell, self.model, self.t0 = log_dir, session, cell, model, t0
        os.makedirs(os.path.join(log_dir, "states"), exist_ok=True)
        os.makedirs(os.path.join(log_dir, "snapshots"), exist_ok=True)
        self.path = os.path.join(log_dir, "decisions.jsonl")
        open(self.path, "a").close()
        self.seq = 0
        self.by_type = {}
        self.state_over_limit = 0
        self.decider_failures = 0

    def begin(self, type_, mode, actions_before, state, **fields):
        """Start a record: assign its seq, write its state file and fill every field with its default."""
        self.seq += 1
        data = canonical(state)
        rel = f"states/{self.seq}.json"
        with open(os.path.join(self.dir, rel), "wb") as f:
            f.write(data)
        rec = {
            "v": 1, "session": self.session, "cell": self.cell, "model": self.model,
            "decision_id": f"{self.session}:{self.seq}", "seq": self.seq, "type": type_, "mode": mode,
            "actions_before": actions_before, "t_ms": int((time.time() - self.t0) * 1000),
            "state_sha256": sha256(data), "state_file": rel,
            "options": ["yes", "no"], "candidates": [], "hits": [], "hits_total": 0,
            "command": None, "exit_code": None, "rule": None, "layers": {},
            "acting_layer": "shadow" if mode == "shadow" else None, "acted": None, "guard": None,
            "snapshot": None, "n_next": None,
        }
        rec.update(fields)
        return rec

    def snapshot(self, rec, data):
        rel = f"snapshots/{rec['seq']}.diff"
        with open(os.path.join(self.dir, rel), "wb") as f:
            f.write(data)
        rec["snapshot"] = rel

    def write(self, rec):
        for layer in rec["layers"].values():
            if layer.get("error") == "state_over_limit":
                self.state_over_limit += 1
            elif not layer.get("ok") and layer.get("error"):
                self.decider_failures += 1
        t = self.by_type.setdefault(rec["type"], {"n": 0, "by_layer": {}})
        t["n"] += 1
        key = rec["acting_layer"] or "none"
        t["by_layer"][key] = t["by_layer"].get(key, 0) + 1
        with open(self.path, "a") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
