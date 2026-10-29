#!/usr/bin/env python3
"""Per-trial and whole-run cost estimates for the fixed list (tasks.json), from published token counts.

Token profile per task: WOZCODE (Claude Opus 4.7) median cached-prompt tokens C and output tokens O over 5 trials.
Opus 5.5 per-trial estimate: the max of (a) C and O priced at Opus 5.5 list prices with 5% of C as 5m cache writes and
(b) 0.85 x the median billed Opus 4.6 cost (3 harnesses). Cheap models: assume 1.5x the Opus token profile.
Prices: platform.claude.com/docs/en/about-claude/pricing and openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash-1017/endpoints, read 2026-10-28.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
K = 1.5            # cheap models use 1.5x the tokens of Opus 4.7 (assumption)
W = 0.05           # share of cached prompt tokens that are cache writes (assumption)
ARMS = 3


def main():
    d = json.loads((HERE / "tasks.json").read_text())
    rows = [t["published"] for t in d["main"]]
    n = len(rows)
    C = sum(r["opus47_median_cache_tok"] for r in rows) / n
    O = sum(r["opus47_median_out_tok"] for r in rows) / n
    opus = sum(r["est_opus55_usd"] for r in rows) / n
    per_trial = {
        "opus-5.5": opus,
        "haiku-5.5 (all prompts >100k tier)": K * (C * (W * 0.625 + (1 - W) * 0.05) + O * 2.50) / 1e6,
        "haiku-5.5 (all prompts <=100k tier)": K * (C * (W * 0.125 + (1 - W) * 0.01) + O * 0.50) / 1e6,
        "deepseek-v4.1-flash-1017 off-peak, 95% cache hits": K * (C * (W * 0.15 + (1 - W) * 0.003) + O * 0.60) / 1e6,
        "deepseek-v4.1-flash-1017 peak, 80% cache hits": K * (C * (0.20 * 0.30 + 0.80 * 0.006) + O * 1.20) / 1e6,
    }
    print(f"{n} main tasks; mean Opus 4.7 profile: {C:,.0f} cached prompt tokens, {O:,.0f} output tokens per trial")
    for k, v in per_trial.items():
        print(f"  {k:52s} ${v:.3f} per trial")
    for name, skill_overhead, unc in [("planning", 1.3, 1.0), ("high", 1.5, 1.5)]:
        arm_factor = (1 + 2 * skill_overhead) / ARMS   # none arm x1, gstack and placebo arms x skill_overhead
        o = n * ARMS * 1 * opus * arm_factor * unc
        h = n * ARMS * 2 * per_trial["haiku-5.5 (all prompts >100k tier)"] * arm_factor * unc
        s = n * ARMS * 2 * per_trial["deepseek-v4.1-flash-1017 peak, 80% cache hits"] * arm_factor * unc
        print(f"{name}: skill-arm overhead x{skill_overhead}, uncertainty x{unc}: Opus 1 trial ${o:.0f} + Haiku 2 trials ${h:.0f}"
              f" + DeepSeek 2 trials ${s:.0f} = ${o + h + s:.0f}")


if __name__ == "__main__":
    main()
