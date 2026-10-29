#!/usr/bin/env python3
"""Per-instance pass rates on SWE-bench Verified from SWE-bench/experiments.

Reads evaluation/verified/<run>/per_instance_details.json (mini-SWE-agent v2 runs) or results/results.json.

Uses only the mini-SWE-agent v2 runs (one harness, Feb to Sep 2026), one run per model.
Writes raw/swebv_instance_stats.csv and prints the funnel under the same window rule used for TB 2.0.
"""
import json
from pathlib import Path
import pandas as pd

HERE = Path(__file__).resolve().parent
EXP = HERE / "raw/swebench-experiments/evaluation/verified"
FRONTIER = ["20260217_mini-v2.0.0_claude-4-6-opus", "20260217_mini-v2.0.0_claude-4-5-opus-high",
            "20260217_mini-v2.0.0_gpt-5-2-high"]
# Not used: 20260219 gpt-5-2-codex (no per-instance file); 20260226 gemini-3-pro-high (per-instance file marks all 500
# unresolved while its metadata says 69.6%, so the file is broken).
CHEAP = ["20260217_mini-v2.0.0_claude-4-5-haiku-high", "20260217_mini-v2.0.0_deepseek-3-2-high",
         "20260217_mini-v2.0.0_glm-5-high", "20260217_mini-v2.0.0_kimi-k2-5-high", "20260217_mini-v2.0.0_minimax-2-5-high",
         "20260217_mini-v2.0.0_gemini-3-flash-high", "20260217_mini-v2.0.0_gpt-5-mini", "20260901_mini-v2.4.2_gemini-3-5-flash"]


def main():
    hub = json.loads((HERE / "raw/hub/swebench-verified@1.0.json").read_text())
    ids = sorted(t["name"] for t in hub["tasks"])
    res, cost = {}, {}
    for s in FRONTIER + CHEAP:
        pid = EXP / s / "per_instance_details.json"
        if pid.exists():
            d = json.loads(pid.read_text())
            res[s] = {k for k, v in d.items() if v.get("resolved")}
            cost[s] = {k: v.get("cost") for k, v in d.items()}
        else:
            res[s] = set(json.loads((EXP / s / "results/results.json").read_text())["resolved"])
    opus = cost.get("20260217_mini-v2.0.0_claude-4-6-opus", {})
    rows = [{"instance": i,
             "frontier_rate": sum(i in res[s] for s in FRONTIER) / len(FRONTIER),
             "cheap_rate": sum(i in res[s] for s in CHEAP) / len(CHEAP),
             "repo": i.split("__")[0], "opus46_cost_usd": opus.get(i)} for i in ids]
    st = pd.DataFrame(rows)
    st.to_csv(HERE / "raw/swebv_instance_stats.csv", index=False)
    print({s: len(res[s]) for s in FRONTIER + CHEAP})
    w = st[(st.frontier_rate >= 0.2) & (st.frontier_rate <= 0.8)]
    print("instances:", len(st), "| frontier in [0.2,0.8]:", len(w), "| and cheap <= 0.30:", int((w.cheap_rate <= 0.30).sum()))
    print("frontier all:", int((st.frontier_rate == 1).sum()), "| frontier none:", int((st.frontier_rate == 0).sum()))
    sel = w[w.cheap_rate <= 0.30]
    print(sel.repo.value_counts().to_dict())
    print("median Opus 4.6 cost per instance (mini-SWE-agent): all", round(st.opus46_cost_usd.median(), 2),
          "| window+cheap", round(sel.opus46_cost_usd.median(), 2))


if __name__ == "__main__":
    main()
