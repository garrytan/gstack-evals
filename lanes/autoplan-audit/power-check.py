#!/usr/bin/env python3
# Copyright (c) 2026 Garry Tan. MIT License.
# Runs power.py part A's census() (prereg 2026-11-09-geva-419) on fixed inputs, so the TypeScript in stats.ts can be
# checked against it: the frozen power.py is loaded up to its first print, its bootstrap index draw is replaced by a
# fixed table, and the Jeffreys draws are passed in. Prints point, lo and hi as JSON.
# Run: uv run --with numpy==2.3.4 python lanes/autoplan-audit/power-check.py
import json, pathlib
import numpy as np

src = pathlib.Path(__file__).resolve().parents[2] / "wiki/plans/2026-11-09-geva-419-autoplan-record-audit-prereg/power.py"
text = src.read_text()
ns = {}
exec(text[: text.index('print(f"power.py, seed')], ns)
idx = np.array([[0, 1, 2, 3], [1, 1, 3, 3], [0, 0, 2, 2], [3, 3, 3, 1], [2, 1, 0, 0]])
class FixedIndex:
    def integers(self, lo, hi, size):
        return idx
ns["rng"] = FixedIndex()
runs = [np.array([1, 1, 1]), np.array([1, 1, 1, 1, 1, 1, 0]), np.array([1, 1, 1, 1, 1, 0]), np.array([1, 0])]
se = np.array([0.95, 0.9, 0.97, 0.85, 0.92]); sp = np.array([0.9, 0.95, 0.88, 0.93, 0.91])
point, draws = ns["census"](runs, (38, 36), (se, sp), boot=5)
lo, hi = np.percentile(draws, [2.5, 97.5])
print(json.dumps({"point": float(point), "lo": float(lo), "hi": float(hi)}))
