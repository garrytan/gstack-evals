#!/usr/bin/env python3
"""Pre-screen Terminal-Bench 2.0 tasks for the Lane B eval from published leaderboard trials.

Deterministic: the same inputs give the same list (no sampling: the eligible pool is smaller than the target). Inputs:
  raw/tb2_trials.csv          from flatten_tb2.py (HF harborframework/terminal-bench-2-leaderboard @ 572b261)
  raw/hub/terminal-bench@2.0.json   the Harbor Hub registry pin (fetch_registry.py)
  ~/.capy/work/ref/terminal-bench-2 checked out at the pinned commit (task.toml, instruction.md)
  internet_labels.json        hand labels: tasks whose agent phase needs internet (with reasons)
  raw/image_platforms.json    from check_images.py: linux/amd64 manifest present per image
Outputs: raw/tb2_task_stats.csv (all tasks, stats and rule flags) and selection_tb2.json.
"""
import json, tomllib, os
from pathlib import Path
import pandas as pd

HERE = Path(__file__).resolve().parent
TB2 = Path(os.environ.get("TB2_DIR", Path.home() / ".capy/work/ref/terminal-bench-2"))

# Groups. Frontier = the newest frontier generation in the data (Claude Opus 4.7, GPT-5.5), single-model submissions only.
FRONTIER = {
    "vix__claude-opus-4-7": "opus-4.7", "logos-latest__claude-opus-4.7": "opus-4.7", "logos-ts__claude-opus-4.7": "opus-4.7",
    "WOZCODE__Claude-Opus-4-7": "opus-4.7", "0error-Ledger__Claude-Opus-4.7": "opus-4.7",
    "Wecode__GPT-5.5": "gpt-5.5", "NexAU-AHE__gpt-5.5": "gpt-5.5", "Capy__GPT-5.5": "gpt-5.5", "clnkr__GPT-5.5": "gpt-5.5",
}
# Cheap = Haiku-class closed models and cheap open-weight models >= 100B params. Excludes models far below Haiku 5.5 /
# DeepSeek V4.1 Flash (qwen3.5-9b, qwen3.6-35b-a3b, gpt-oss-20b, TermiGen-32B, gpt-5-nano).
CHEAP = {
    "Terminus2__DeepSeek-V3.2": "deepseek-v3.2", "Terminus2__GLM-4.7": "glm-4.7", "ClaudeCode__GLM-4.7": "glm-4.7",
    "Terminus2__GLM-5": "glm-5", "just-another-coding-agent__GLM-5": "glm-5", "Terminus2__Kimi-k2.5": "kimi-k2.5",
    "Terminus2__Minimax-m2.5": "minimax-m2.5", "cchuter__minimax-m2.5": "minimax-m2.5",
    "IndusAGICodingAgent__MiniMax-M2.7": "minimax-m2.7", "harness-agent__minimax-m2-7-highspeed": "minimax-m2.7",
    "dakou__qwen3-coder-480b": "qwen3-coder-480b", "Gemini_CLI__Gemini-3-Flash-Preview": "gemini-3-flash",
    "Dirac__Gemini-3-Flash-Preview": "gemini-3-flash", "hookele__gpt5.1-codex-mini": "gpt-5.1-codex-mini",
}
OPUS46_COST = ["Meta-Harness__Claude-Opus-4.6", "Terminus-KIRA__Claude-Opus-4.6", "Capy__Claude-Opus-4.6"]
TOKEN_SUB = "WOZCODE__Claude-Opus-4-7"  # only frontier Anthropic submission with per-trial cache and output tokens
# A trial counts if the verifier wrote a reward, or if the agent hit its timeout (a failure). Trials with no reward
# for any other reason (setup, sandbox or harness errors, e.g. 200 RuntimeError trials in 0error-Ledger) are dropped.
COUNTED_EXCEPTION = "AgentTimeoutError"

# Opus 5.5 list prices, USD per MTok (platform.claude.com/docs/en/about-claude/pricing, read 2026-10-28)
P_CACHE_WRITE_5M, P_CACHE_READ, P_OUT = 5.00, 0.20, 20.00
CACHE_WRITE_SHARE = 0.05  # assumed share of cached prompt tokens written (5m) rather than read; see selection.md
OPUS46_TO_55 = 0.85       # Opus 4.6 billed cost -> Opus 5.5 list prices, with the newer tokenizer's ~1.3x token count

# The rule (see selection.md). Fixed before any of our runs.
R = dict(
    # hard filters
    max_agent_timeout_min=30, max_cpus=4, max_mem_gb=8,
    frontier_min=0.20, min_frontier_subs_solving=3,
    max_est_opus55_usd=2.00, max_frontier_median_agent_min=15,
    # tier A (the target window); tasks outside it but passing the hard filters rank after all tier A tasks
    tierA_frontier_max=0.85, tierA_cheap_max=0.30,
    n_main=20, n_reserve=6,
)


def mem_gb(s):
    s = str(s).upper()
    return float(s[:-1]) / (1024 if s.endswith("M") else 1) if s[-1] in "GM" else float(s)


def main():
    pin = json.loads((HERE / "raw/hub/terminal-bench@2.0.json").read_text())
    reg = {t["name"]: t for t in pin["tasks"]}
    labels = json.loads((HERE / "internet_labels.json").read_text())["agent_phase_needs_internet"]
    images = json.loads((HERE / "raw/image_platforms.json").read_text()) if (HERE / "raw/image_platforms.json").exists() else {}

    df = pd.read_csv(HERE / "raw/tb2_trials.csv")
    df["task"] = df.task.str.replace("^terminal-bench/", "", regex=True)
    df = df[df.task.isin(reg) & (df.reward.notna() | (df.exception == COUNTED_EXCEPTION))].copy()
    df["r"] = df.reward.fillna(0.0)
    df["pass"] = (df.r >= 1.0).astype(float)

    def rate(subs):
        x = df[df.submission.isin(subs)]
        return x.groupby("task")["pass"].agg(["mean", "size"])

    fr, ch = rate(FRONTIER), rate(CHEAP)
    o47 = rate([s for s, m in FRONTIER.items() if m == "opus-4.7"])["mean"]
    g55 = rate([s for s, m in FRONTIER.items() if m == "gpt-5.5"])["mean"]
    fx = df[df.submission.isin(FRONTIER)]
    subs_solving = fx.groupby(["task", "submission"])["pass"].max().groupby("task").sum()
    f_agent_min = fx.groupby("task").agent_sec.median() / 60
    allrate = df.groupby("task")["pass"].mean()
    o46 = df[df.submission.isin(OPUS46_COST) & (df.cost_usd > 0)].groupby("task").cost_usd.median()
    tk = df[df.submission == TOKEN_SUB].groupby("task")[["n_cache", "n_output"]].median()
    est_tok = (tk.n_cache * CACHE_WRITE_SHARE * P_CACHE_WRITE_5M + tk.n_cache * (1 - CACHE_WRITE_SHARE) * P_CACHE_READ
               + tk.n_output * P_OUT) / 1e6
    est_bill = o46 * OPUS46_TO_55
    est = pd.concat([est_tok, est_bill], axis=1).max(axis=1)

    rows = []
    for name, t in sorted(reg.items()):
        toml = tomllib.loads((TB2 / t["path"] / "task.toml").read_text())
        env, md = toml["environment"], toml["metadata"]
        compose = any("compose" in p.name for p in (TB2 / t["path"] / "environment").iterdir())
        row = dict(
            task=name, category=md.get("category"), difficulty=md.get("difficulty"),
            agent_timeout_min=toml["agent"]["timeout_sec"] / 60, verifier_timeout_min=toml["verifier"]["timeout_sec"] / 60,
            cpus=env.get("cpus"), memory=env.get("memory"), gpus=env.get("gpus", 0), docker_image=env.get("docker_image"),
            compose=compose, internet=name in labels,
            frontier_rate=fr["mean"].get(name), frontier_n=int(fr["size"].get(name, 0)),
            opus47_rate=o47.get(name), gpt55_rate=g55.get(name),
            frontier_subs_solving=int(subs_solving.get(name, 0)),
            cheap_rate=ch["mean"].get(name), cheap_n=int(ch["size"].get(name, 0)), all_rate=allrate.get(name),
            frontier_median_agent_min=f_agent_min.get(name), opus46_median_cost_usd=o46.get(name),
            opus47_median_cache_tok=tk.n_cache.get(name), opus47_median_out_tok=tk.n_output.get(name),
            est_opus55_from_opus47_tokens=est_tok.get(name), est_opus55_from_opus46_bill=est_bill.get(name),
            est_opus55_usd=est.get(name),
            amd64=images.get(env.get("docker_image"), {}).get("amd64"),
        )
        row["f_env"] = (row["agent_timeout_min"] <= R["max_agent_timeout_min"] and not compose and not row["gpus"]
                        and (row["cpus"] or 1) <= R["max_cpus"] and mem_gb(row["memory"]) <= R["max_mem_gb"]
                        and not row["internet"] and row["amd64"] is not False)
        row["f_solved"] = (row["frontier_rate"] >= R["frontier_min"]
                           and row["frontier_subs_solving"] >= R["min_frontier_subs_solving"])
        row["f_cost"] = ((row["est_opus55_usd"] or 99) <= R["max_est_opus55_usd"]
                         and row["frontier_median_agent_min"] <= R["max_frontier_median_agent_min"])
        row["eligible"] = row["f_env"] and row["f_solved"] and row["f_cost"]
        row["tierA"] = (row["eligible"] and row["frontier_rate"] <= R["tierA_frontier_max"]
                        and row["cheap_rate"] <= R["tierA_cheap_max"])
        row["headroom"] = (1 - row["frontier_rate"]) * (1 - row["cheap_rate"])
        rows.append(row)
    st = pd.DataFrame(rows)
    st.to_csv(HERE / "raw/tb2_task_stats.csv", index=False)

    funnel = {"registry tasks": len(st)}
    m = pd.Series(True, index=st.index)
    for f in ["f_env", "f_solved", "f_cost"]:
        m &= st[f]
        funnel[f] = int(m.sum())
    funnel["tierA"] = int(st.tierA.sum())

    # Order: tier A first, then the other eligible tasks; within each, by headroom (desc), then name.
    el = st[st.eligible].copy()
    el["rank_key"] = list(zip(~el.tierA, -el.headroom.round(6), el.task))
    order = [t for _, t in sorted(zip(el.rank_key, el.task))]
    main_list, reserves = order[: R["n_main"]], order[R["n_main"]: R["n_main"] + R["n_reserve"]]
    out = dict(rule=R, funnel=funnel, eligible=len(order), order=order, main=main_list, reserves=reserves)
    (HERE / "selection_tb2.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(funnel))
    print("eligible", len(order))
    cols = ["task", "category", "tierA", "frontier_rate", "opus47_rate", "gpt55_rate", "frontier_subs_solving", "cheap_rate",
            "headroom", "frontier_median_agent_min", "est_opus55_usd", "agent_timeout_min"]
    pd.set_option("display.width", 250)
    print(st.set_index("task").loc[main_list + reserves, cols[1:]].round(2).to_string())


if __name__ == "__main__":
    main()
