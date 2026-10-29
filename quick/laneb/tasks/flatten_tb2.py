#!/usr/bin/env python3
"""Flatten Terminal-Bench 2.0 leaderboard trial results into one CSV.

Input: raw/terminal-bench-analysis (a clone of github.com/prime-radiant-inc/terminal-bench-analysis,
which mirrors every result.json in huggingface.co/datasets/harborframework/terminal-bench-2-leaderboard).
Output: raw/tb2_trials.csv, one row per trial. Reads only non-secret fields.
"""
import csv, json, sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "raw/terminal-bench-analysis/submissions/terminal-bench/2.0"
OUT = HERE / "raw/tb2_trials.csv"


def ts(s):
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def secs(block):
    if not block:
        return None
    a, b = ts(block.get("started_at")), ts(block.get("finished_at"))
    return (b - a).total_seconds() if a and b else None


def main():
    rows = []
    for f in sorted(SRC.glob("*/**/result.json")):
        try:
            d = json.loads(f.read_text())
        except Exception:
            continue
        if "task_name" not in d:
            continue
        sub = f.relative_to(SRC).parts[0]
        cfg = d.get("config") or {}
        agent_cfg = cfg.get("agent") or {}
        info = d.get("agent_info") or {}
        mi = info.get("model_info") or {}
        ar = d.get("agent_result") or {}
        vr = d.get("verifier_result") or {}
        rewards = (vr.get("rewards") or {}) if vr else {}
        exc = d.get("exception_info") or {}
        tid = d.get("task_id") or {}
        rows.append({
            "submission": sub,
            "job": f.relative_to(SRC).parts[1] if len(f.relative_to(SRC).parts) > 2 else "",
            "agent": info.get("name") or agent_cfg.get("name") or agent_cfg.get("import_path"),
            "model_cfg": agent_cfg.get("model_name"),
            "model_info": mi.get("name"),
            "task": d["task_name"],
            "commit": tid.get("git_commit_id"),
            "task_checksum": d.get("task_checksum"),
            "reward": rewards.get("reward"),
            "exception": exc.get("exception_type") if exc else "",
            "agent_sec": secs(d.get("agent_execution")),
            "trial_sec": secs(d),
            "cost_usd": ar.get("cost_usd"),
            "n_input": ar.get("n_input_tokens"),
            "n_cache": ar.get("n_cache_tokens"),
            "n_output": ar.get("n_output_tokens"),
            "timeout_mult": cfg.get("timeout_multiplier"),
            "override_timeout": agent_cfg.get("override_timeout_sec"),
            "started_at": d.get("started_at"),
        })
    with OUT.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {len(rows)} trials to {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
