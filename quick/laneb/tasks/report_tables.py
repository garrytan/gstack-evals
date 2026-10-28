#!/usr/bin/env python3
"""Print the markdown tables used in selection.md from the prescreen outputs."""
import json, importlib.util
from pathlib import Path
import pandas as pd

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("p", HERE / "prescreen_tb2.py")
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
df = pd.read_csv(HERE / "raw/tb2_trials.csv")
df["task"] = df.task.str.replace("^terminal-bench/", "", regex=True)
df = df[df.reward.notna() | (df.exception == p.COUNTED_EXCEPTION)]
df["pass"] = (df.reward.fillna(0) >= 1).astype(float)


def subtable(groups, label):
    print(f"\n| {label} submission (agent__model) | model | first trial | trials | pass rate |\n|---|---|---|---|---|")
    for s, m in groups.items():
        x = df[df.submission == s]
        print(f"| {s} | {m} | {str(x.started_at.min())[:10]} | {len(x)} | {x['pass'].mean():.2f} |")


subtable(p.FRONTIER, "Frontier")
subtable(p.CHEAP, "Cheap")
d = json.loads((HERE / "tasks.json").read_text())
print("\n| # | task | category | tier | frontier | Opus 4.7 | GPT-5.5 | frontier subs solving (of 9) | cheap | median frontier agent min | est. Opus 5.5 $/trial | agent timeout min | network |")
print("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for t in d["main"] + d["reserves"]:
    q = t["published"]
    print(f"| {t['rank']}{'' if t['role'] == 'main' else ' (R)'} | {t['task_id']} | {t['category']} | {t['tier']} | {q['frontier_rate']:.2f} | "
          f"{q['opus47_rate']:.2f} | {q['gpt55_rate']:.2f} | {q['frontier_subs_solving']} | {q['cheap_rate']:.2f} | "
          f"{q['frontier_median_agent_min']:.1f} | {q['est_opus55_usd']:.2f} | {t['agent_timeout_sec'] // 60} | {t['network_needed_by_reference_solution']} |")
