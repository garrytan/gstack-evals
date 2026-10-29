#!/usr/bin/env python3
"""Assemble tasks.json from selection_tb2.json, raw/tb2_task_stats.csv, the Hub pin and image metadata.

Run after prescreen_tb2.py; then run digest_tasks.py --write to fill digests.
"""
import json, os, subprocess
from pathlib import Path
import pandas as pd

HERE = Path(__file__).resolve().parent
TB2 = Path(os.environ.get("TB2_DIR", Path.home() / ".capy/work/ref/terminal-bench-2"))
TB21 = "2fd12b88aafdd04a52c298e3940bcb189f9766d6"  # terminal-bench-2 main on 2026-10-28, includes the "TB2.1" task fixes

STAT_COLS = ["frontier_rate", "frontier_n", "opus47_rate", "gpt55_rate", "frontier_subs_solving", "cheap_rate", "cheap_n",
             "all_rate", "headroom", "frontier_median_agent_min", "opus46_median_cost_usd", "opus47_median_cache_tok",
             "opus47_median_out_tok", "est_opus55_from_opus47_tokens", "est_opus55_from_opus46_bill", "est_opus55_usd"]


TB21_FIX = "53ff2b87d621bdb97b455671f2bd9728b7d86c11"  # "Various task fixes for TB2.1"


def changed_files(path, a, b):
    out = subprocess.run(["git", "-C", str(TB2), "diff", "--name-only", a, b, "--", path],
                         capture_output=True, text=True, check=True).stdout.split()
    return [f.split("/", 1)[1] for f in out]


def main():
    sel = json.loads((HERE / "selection_tb2.json").read_text())
    st = pd.read_csv(HERE / "raw/tb2_task_stats.csv").set_index("task")
    pin = {t["name"]: t for t in json.loads((HERE / "raw/hub/terminal-bench@2.0.json").read_text())["tasks"]}
    images = json.loads((HERE / "raw/image_platforms.json").read_text())
    net = json.loads((HERE / "internet_labels.json").read_text())["labels"]
    old = {}
    if (HERE / "tasks.json").exists():
        prev = json.loads((HERE / "tasks.json").read_text())
        old = {t["task_id"]: t for t in prev.get("main", []) + prev.get("reserves", [])}

    def entry(name, rank, role):
        s = st.loc[name]
        p = pin[name]
        img = s.docker_image
        e = {
            "rank": rank, "role": role, "task_id": name,
            "source_dataset": "Terminal-Bench", "source_version": "2.0",
            "harbor_registry": "terminal-bench@2.0",
            "registry": {"git_url": p["git_url"], "git_commit_id": p["git_commit_id"], "path": p["path"]},
            "docker_image": img, "docker_image_index_digest": images.get(img, {}).get("digest"),
            "docker_image_platforms": images.get(img, {}).get("platforms"),
            "agent_timeout_sec": int(s.agent_timeout_min * 60), "verifier_timeout_sec": int(s.verifier_timeout_min * 60),
            "cpus": int(s.cpus), "memory": s.memory, "category": s.category, "difficulty": s.difficulty,
            "network_needed_by_reference_solution": net[name]["class"],
            "tier": "A" if s.tierA else "B",
            "files_changed_on_tb2_main_since_pin": changed_files(p["path"], p["git_commit_id"], TB21),
            "files_changed_by_tb2_1_fixes": changed_files(p["path"], p["git_commit_id"], TB21_FIX),
            "published": {c: (None if pd.isna(s[c]) else (round(float(s[c]), 4) if isinstance(s[c], float) else int(s[c])))
                          for c in STAT_COLS},
        }
        if name in old and "digest" in old[name]:
            e["digest"], e["digest_files"] = old[name]["digest"], old[name]["digest_files"]
        return e

    main_list = [entry(n, i + 1, "main") for i, n in enumerate(sel["main"])]
    reserves = [entry(n, len(main_list) + i + 1, "reserve") for i, n in enumerate(sel["reserves"])]
    doc = {
        "schema": "gsta12-lane-b-tasks/1",
        "fixed_on": "2026-10-28",
        "digest_algorithm": "sha256 over sorted lines '<relpath>\\0<sha256(file)>\\n' for every git-tracked file under the task path at registry.git_commit_id (digest_tasks.py)",
        "sources": {
            "trials": "huggingface.co/datasets/harborframework/terminal-bench-2-leaderboard @ 572b2614be2c0cb2527e14f5b1e4026f1072e6c1 (2026-05-15), via github.com/prime-radiant-inc/terminal-bench-analysis @ 2e161fdca93b67f14b945cd36eee31686d01a7b6",
            "registry": "Harbor Hub get_dataset('terminal-bench','2.0'), the default registry of harbor @ f3a5a923f6d722472c9e797af836ae4425fb215f; matches registry.json at that commit",
        },
        "rule": sel["rule"], "funnel": sel["funnel"],
        "main": main_list, "reserves": reserves,
    }
    (HERE / "tasks.json").write_text(json.dumps(doc, indent=1) + "\n")
    print(len(main_list), "main,", len(reserves), "reserves")


if __name__ == "__main__":
    main()
