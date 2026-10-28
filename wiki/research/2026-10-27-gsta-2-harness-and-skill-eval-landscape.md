---
id: 2026-10-27-gsta-2-harness-and-skill-eval-landscape
kind: research
title: Landscape of harness, skill and stack evals, with pstack, tstack and skill-diet
summary: Survey of coding-harness and skill evals. Harness choice moves cost more than correctness, skill-pack gains are small or null, and no independent eval of gstack has been reproduced.
author: GSTA-2
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-27
status: done
source: Captain drive handoffs/research/landscape.md (sha256 b20a6c72da48323e56579a5e8b5419e48f498d4b3f2312b4130dffcd6c275876), written by a GSTA-2 research subagent, copied by GSTA-6 on 2026-10-28
---
# gstack-evals landscape brief

Research date: 2026-10-27. Sources were web searches and fetches, plus read-only clones in ~/.capy/work/research/clones (skill-diet @5f41df1, tstack @92e38e2, cursor/plugins @c742dd6, a local gstack checkout v1.91.284.0 @10b77de). ⚠ marks a claim I could not verify first-hand: it is self-reported, secondhand, or was not re-checked this session.

## TL;DR

- Harness evaluation is now a field of its own. **Terminal-Bench 4.0 on Harbor** is the reference substrate. **OpenBench** and **Arena's HarnessTax** hold the model fixed and vary the harness. **Artificial Analysis' Coding Agent Index v2.0** ranks agent+model products. The finding repeats across studies: harness choice moves **cost** (up to about 5x) far more than it moves **correctness**.
- Evals of skills and config exist but stay narrow. **SkillsBench** found curated, task-specific skills add +16.6 pp. **Vercel** found an 8 KB AGENTS.md index beat skills (100% vs 79%). Three AGENTS.md papers found null or negative effects on correctness. A few small, careful trials of skill packs (Superpowers, Pocock) found **no reliable correctness gain** at 1.3–3x the cost, and the uplift **shrinks on newer models**.
- **No one benchmarks stack against stack with a fixed harness and model on multi-phase work (plan → build → review → ship).** That is the gap gstack-evals should fill.
- **pstack** is real: Lauren Tan's plugin in cursor/plugins, MIT, 58 skill folders. **tstack** is real: t3dotgg/tstack, MIT, 9 skills, published 2026-10-23/24. Neither ships benchmark results. **gstack absorbed ideas from both on 2026-10-26/27, plus a design port of tstack's pr-wait and code ports of two pstack scripts**, so stack arms now share content.
- **nicobailon/skill-diet** (MIT) ships the right core for our harness: an agent-written adapter, a 3-run canary calibration, an arms×tasks×runs runner, and a deterministic scorer with MISS/WORSE/WARN gates. Adapt it and generalize "versions" to "stacks".

## 1. Benchmarks that evaluate coding harnesses

**Terminal-Bench (TB) + Harbor.** TB 2.0 made Harbor its official harness, and its leaderboard is now closed to submissions. TB 3.0 (2026-07-30) has 74 tasks across 7 domains (best result ~34%) and runs the verifier in a separate container from the agent. TB 4.0 (2026-08-26) has 66 tasks, a flat 8 h timeout, resources calibrated against infra noise, and semantic versioning. Leaderboard rows are **model × agent**, so holding one fixed means filtering, e.g. Terminus-2 vs native CLIs. TerminalFeed republishes TB rows as a "harness gap" with 95% CIs. **Harbor** ships installed agents for Claude Code, Codex, Copilot CLI, Gemini CLI, Grok Build, OpenHands, Terminus-2, mini-SWE-agent and more. It takes native config via `--ak config=…` and accepts custom agents. SkillsBench, SWE-Bench Pro V2 and OpenBench ship Harbor tasks. https://www.tbench.ai/news/terminal-bench-4-0 · https://www.harborframework.com/docs/agents

**SWE-bench family.** *Verified* (500 tasks) uses mini-SWE-agent for every model in its "Bash Only" view, so it **holds the harness fixed**. It tops out at 76.8%, is saturated, and Vals stopped running it on 2026-09-01. *SWE-bench-Live* adds issues monthly (MultiLang: 1,077), requires trajectories, and lists harness+model entries. *Multimodal* covers visual JS issues ⚠ (not re-checked). *SWE-Bench Pro V2* (Scale, 2026-10-16) has 642 tasks plus a 51-task Hard split, locks the network, and re-grades patches in a clean container. It runs Claude and GPT **in their native harnesses** (Claude Code, Codex) and everything else in SWE-agent, so it ranks systems. *Multi-SWE-bench* has 1,632 instances in 7 languages. https://www.swebench.com · https://swe-bench-live.github.io · https://labs.scale.com/blog/swe-bench-pro-v2

**Model-centric (harness fixed or absent; details in the table).** Aider polyglot has been frozen since its Aug 2025 entry. LiveCodeBench has no agent loop. Only a subset of SWE-Lancer is open. METR's time-horizon page has been "no longer actively updated" since 2026-09-08, and most of its tasks are private. GSO's Opt@1 requires ≥95% of the expert speedup, and its scaffold is fixed ⚠ (OpenHands, from memory). KernelBench audits for reward hacking. None of these isolates the harness. https://aider.chat/docs/leaderboards/ · https://openai.com/index/swe-lancer/ · https://metr.org/time-horizons/ · https://gso-bench.github.io · https://kernelbench.com

**Context and skill use.** *Letta Context-Bench* has a Filesystem suite and a Skills suite that measures whether a model **discovers and loads** the right skill from a library, judged by LLM. The harness (Letta Code) is fixed and the model varies. https://www.letta.com/blog/context-bench-skills/

**Web-dev arenas.** *WebDev/Code Arena* (arena.ai) runs pairwise human votes, about 950k, on model outputs inside the arena's own agent harness. *Design Arena* runs crowdsourced Elo across Website/UI/Game/DataViz/3D. It has a **"Builders" arena that compares whole app builders and coding agents**, i.e. product-level, with the harness varying. https://arena.ai/leaderboard/code/webdev · https://www.designarena.ai/leaderboard

**Harness leaderboards (model fixed, harness varies).**
- *OpenBench* (MIT) pins one model (gpt-5.5/5.6-sol, deepseek-v4-flash, grok-4.5) and runs it across 4–7 harnesses (cursor, devin, grokbuild, opencode, claude, pi, codex). It scores matched (task, trial) cells only, with Wilson CIs, proxy-metered tokens and sealed bundles. Correctness saturates, but time and tokens differ 4–8x. https://openbench.run/openbench/
- *Arena HarnessTax* (2026-09-16) runs 21 model×harness pairs (Claude Code, Codex, Pi) on 30 tasks each from SWE-bench Lite and TB 2.0, with 3 trials, a 100-turn cap, one price list and bootstrap CIs. Success was about flat across harnesses while cost varied up to 5x, and Pi stayed competitive. https://arena.ai/blog/coding-agents-harness-tax
- *Artificial Analysis Coding Agent Index v2.0* averages FrontierCode v1.1 (private, merge-worthiness rubrics), TB 4.0 and SWE-Atlas-QnA-AA (LLM judge), 3 attempts each, and ranks agent products. https://artificialanalysis.ai/methodology/coding-agents-benchmarking
- *"The harness (still) matters"* indexes 27 matched-harness studies. It finds 12–27 pp spreads in some settings, no harness that wins everywhere, and efficiency gaps clearer than quality gaps ⚠ (secondhand). https://tmustier.github.io/harness-benchmarks/
- *Harness Tax* measures fixed startup input at ~2.6k tokens for Pi and ~27k for Claude Code. https://www.eishanlawrence.com/blog/harness-bench/harness-efficiency-paper.pdf

How they control the comparison: a pinned model id and effort, the same task containers, an official verifier, a turn or timeout cap, ≥3 trials, CIs, matched cells only, proxy-measured tokens, and one price list. None of them varies a **skill pack** inside a harness.

## 2. Evals of harness + stack/skills/config

- **SkillsBench 1.1** (arXiv 2602.12670): 87 Harbor/BenchFlow tasks across 8 domains. It pairs a no-skills run with a curated-skills run on the same container and adds a "self-generated skills" condition. It reports 18 model×harness configs (Claude Code, Codex, Gemini CLI, OpenHands) with 3 trials each. Skills lift the mean from 33.9% to 50.5% (+16.6 pp, range +4 to +26), and invocation is tracked. Its skills are **task-specific and expert-curated**, not general workflow stacks. https://www.skillsbench.ai/blogs/skillsbench-1-1
- **Vercel, "AGENTS.md outperforms skills"** (2026-01-27): Next.js 16 API evals. Baseline scored 53%. The skill alone also scored 53%, because it was never invoked in 56% of cases. The skill plus an explicit instruction reached 79%, and results depended heavily on the instruction's wording. A compressed 8 KB docs index in AGENTS.md reached 100%. https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals
- **AGENTS.md papers.** ETH/LogicStar (2602.11988): context files do not raise success and add over 20% cost, and repo overviews don't help. Lulla et al. (2601.20404): AGENTS.md cuts median runtime 28.6% and output tokens 16.6%. Khatri (2607.27250): Claude Code and Codex, 288 runs, an equivalence-bounded null of ≤10–15 pp. Agents fail on implementation skill, not on missing repo knowledge.
- **Small skill-pack trials (third party).** *Programming the Loop "SKT"* (2026-10-21, preregistered): arms were none, placebo, Superpowers and Pocock, with 16 Java tasks, hidden tests and 128 runs on Codex gpt-5.6-luna at low effort. Superpowers matched no-skills (24/32) at **3.07x tokens**. Pocock scored 27/32 (Holm p=0.38). **28 of 30 failed runs claimed success.** The whole trial cost about $3. *freshworktree* (2026-09-23): Superpowers helped Opus 4.6 (134 vs 131 of 145 tests) but not Opus 5 (143 vs 145) at 3.7x cost. *bartlomiejkrupa.dev*: 192 runs, Superpowers better on 1 of 7 tasks at 1.33x cost. *skill-receipts*: off/placebo/on arms, hidden hold-out tests, K≥5 trials, and a preregistered admission rule; it audited the Karpathy guidelines and Superpowers debugging. https://programmingtheloop.com/experiments/skills-tasks/ · https://freshworktree.com/did-opus5-replace-superpowers-a-brownfield-test/ · https://github.com/sjh9714/skill-receipts
- **Vendor and pack-owned tooling.** *superpowers-evals / Quorum* tests **workflow compliance** across 9 CLIs (Claude, Codex, Gemini, OpenCode, Pi, Copilot…). Each run gets a throwaway HOME so host plugins can't leak in, and grading combines a QA-agent conversation, a fresh evidence-based judge and deterministic post-checks. *Anthropic skill-creator* has an eval and benchmark mode (with/without skill; pass rate, time and tokens as mean±sd) plus trigger tuning (run_eval.py, improve_description.py). https://github.com/prime-radiant-inc/superpowers-evals · https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills
- **MCP.** *MCPMark* runs an "MCP leaderboard" that **holds the model fixed and varies the MCP server implementation**, the closest analog to varying the stack. Also see MCP-Universe and MCP-Bench. https://mcpmark.ai/leaderboard/mcp
- **Spec-kit / BMAD.** Only the Spec Kit Agents paper (2604.05278: 32 tasks, 5 repos, 4 configs) and n≈1 comparisons (vunvulear/speckit-assessment, pyros-projects/agent-comparison). No rigorous BMAD benchmark.
- **Static comparison.** *dbggr.dev* (2026-10-14) ran no agents. It counted skills and always-on tokens: gstack had 57 skills and ~1.2k tokens plus a CLAUDE.md section, pstack 54 skills (53 manual-only) and ~70 tokens, Superpowers 15 skills and ~1.5k tokens. It concludes "no controlled study has tested any of these libraries by name". https://dbggr.dev/articles/agent-skill-libraries-compared/

## 3. pstack and tstack

**pstack (Lauren Tan, @poteto).** Repo: https://github.com/cursor/plugins/tree/main/pstack, Cursor's official plugin repo. It was added in PR #73, merged 2026-05-23. MIT, v0.15.36 at HEAD (2026-10-27). Contents:
- 58 skill folders: 24 one-principle skills (laziness-protocol, prove-it-works, …) and 34 working skills. The entry point is `/poteto-mode`, a router with **23 playbooks** (bug-fix, perf, hillclimb, feature, refactor, eval, babysit, shipping, autopilot-full/stack, orchestrate…). Others include how, why, architect, arena (N parallel attempts with a cross-judge), swarm, interrogate (multi-model adversarial review that keeps only findings a run proves), tdd, unslop, reflect, correct, statechart (TLA+), create/maintain-(formal-)verification-skill, and setup-pstack, which maps roles to models (defaults: code → Grok, judgment and prose → Opus 5.5).
- 2 subagents (poteto-agent, comment-sicko), a Cursor-only "benny" automation pack, a 10-chapter guide, and a generated Claude Code tree.

Philosophy: "if you want to go fast, go deep first", "write less, but higher quality code", "fearless parallelism", multi-model by default, and **no planning skills** ("i don't believe in planning. the best spec is code"). The README opens "i'm not a president or ceo", which reads as a jab at gstack.

Evals: it ships a **blinded eval playbook**. The candidate never sees eval words; it gets an organic prompt; N candidates run on different model families; one judge from yet another family sees only labels; and chain-following is graded from transcripts, not self-report. It also has unit tests for helper scripts. **No published benchmark numbers found.** Usage claims are self-reported ⚠: "used 10,000 times last week" (LinkedIn) and "2,500 PRs a month" (barnabyrobson.org). The README says she ships at Cursor, while her GitHub profile now lists @xai-org.

Ports: michael-denyer/pstack-claude, ericlitman/open-pstack, backnotprop/pstack. **Name collisions:** BhaskarManam/pstack and no-session/pstack are gstack-inspired packs, and peadar/pstack plus GDB's pstack/gstack are Linux stack tracers. "pstack" here means cursor/plugins/pstack.

**tstack (Theo Browne, @theo / t3.gg).** Repo: https://github.com/t3dotgg/tstack, MIT. Created 2026-10-24 (first commit 2026-10-23), with 4 commits by 2026-10-27. Star counts in coverage range from about 677 to 1.6k ⚠. It has **9 skills**, about 30 KB of SKILL.md in total:
- full-send: autonomous change → proof → review → PR → babysit → **merge**.
- full-stop: the same, but it stops before merge.
- council: 3 models from 3 providers score and loop until they agree.
- sol-loop: a GPT Sol review loop, 3 rounds or 5 for security.
- file-pr, takeover, babysit-pr (with a python pr-wait script), modernize, and leaving-pr-comments.

Philosophy: codify repeated PR-landing habits, grant autonomy explicitly in writing, define proof as runtime evidence seen this session, and "make them yours" by keeping personal config in CLAUDE.md/AGENTS.md. It uses T3 Code's delegate_task when available. **No evals or tests are shipped.** Theo's video stats are anecdotal. Before the release, his video "My AGENTS.md & SKILLS.md breakdown (Don't copy them)" drew a community reconstruction (git.sr.ht/~krisyotam/theo-skills). "tstack" is unambiguous, but don't confuse it with the "T3 stack" (his Next.js/tRPC web stack).

**Public comparisons to gstack.** No benchmark found. The only head-to-head is static (dbggr). The most important fact is in gstack itself: **NOTICE.md and CHANGELOG v1.91.266–284 (2026-10-26/27, "Do it, send")** pulled in ideas from both packs ("ideas, not text"), a design port of tstack's pr-wait (licenses/MIT-tstack.txt), and code ports of two pstack scripts (licenses/MIT-pstack.txt).
- From tstack: /modernize, per-skill Codex prompts, an unattended-session grant, a porting rule, an attribution line, `gstack-pr-wait` (port of pr-wait), PR bodies that open with the problem, and the sol-loop severity glossary.
- From pstack: blast-radius, vet-the-number, transcript recall, the unslop word list (now in prose-lint), principles 5–8, eval-plan blinding rules, and the decision-trail and worktree-audit scripts.

## 4. nicobailon/skill-diet

https://github.com/nicobailon/skill-diet. **MIT, © 2026 Nico Bailon**, v0.1.0 released 2026-10-27, HEAD 5f41df1. It is a skill (SKILL.md plus references) that slims other skills, and it keeps a slimmed version only if a before/after eval says agents do as well. The eval is `scripts/eval.mjs` (364 lines, node, no dependencies) plus `scripts/observe.mjs`. Credits: Matt Pocock's writing-for-agents.

**Layout.**
- `<dir>/tasks.json` holds `[{id, prompt, must?:[regex], must_not?:[regex], setup?:sh, check?:sh}]`.
- `<dir>/sk/<version>/<skill>/` holds exactly one skill folder per version. `none` needs no folder.
- `<dir>/adapter` is an executable your agent writes.

**CLI.**
- `run <dir> [--versions before,after,none] [--tasks a,b] [--runs 3] [--parallel 6] [--model id]`
- `calibrate <dir>`
- `score <dir> [--detail]`
- `check <skill-dir>` prints SKILL.md bytes and fails on broken relative links or anchors.

**Arms.** before, after and none. A task that passes with none marks rules the model already follows, so those lines can go. Tasks are written **before** any cut, so they can't be shaped around the new version.

**Adapter contract.** It is invoked as `adapter <skill-dir|""> <prompt> <out-dir> <work-dir>` with `EVAL_MODEL` and `OBSERVE_TAGS="version=… task=… run=…"` set. It must:
- show the agent exactly one skill and hide installed skills, plugins, memory and user AGENTS.md/CLAUDE.md, without touching the real login;
- run with no prompts;
- write `result.json` as `{answer, tokens:{input,output,cacheRead,cacheWrite}, turns|null, calls:[{name,path?,command?}]}` (non-zero tokens are required, and a skill loaded by name counts as reading `<skill-dir>/SKILL.md`);
- clean up on SIGTERM.

It exits 0 when usage was recorded even if the agent failed. A non-zero exit stops the eval. The design argument is that a fair harness can't be generic across agent versions, so the agent writes the adapter from its own `--help` (about 4 min for Claude Code and Pi, 7–16 min for Codex), and calibration checks it.

**Calibration** (run before every eval, as parallel as the eval itself). Three runs:
1. *skill*: a fresh `CANARY-xxxxxxxx` line under the real front matter must be quoted back, and the calls must show the SKILL.md read.
2. *none*: the agent must answer NO-SKILL and read no copy, which catches a leaked installed copy.
3. *shell*: `echo calib-$((6*7))` must return calib-42 and be logged.

Any failure exits 1.

**Execution.** Every job runs in a fresh `mkdtemp` work dir outside the eval folder, deleted after `check`. `setup` and `check` run with `OBSERVE_LOG=""` so they aren't metered. Children are detached process groups with a 10-min timeout (SIGTERM, then SIGKILL after 10 s); a timeout counts as a failed run, and any other adapter error stops the eval. Results are cached per `runs/<v>-<task>-<r>/result.json` with wallMs, so rerunning fills gaps.

**Scoring** (deterministic, code-owned). Quotes are stripped first. `must` regexes match anywhere in the answer. `must_not` regexes match only non-comment lines inside code blocks, so "I won't run X" passes. A run passes when exit==0, check≠false, nothing is missing and nothing banned appears. The scorer reads which skill files each run opened (from `/sk/<v>/<skill>/…` paths). It flags and exits 1 on:
- **MISS**: before passed every run and after passed none; rerun with 6 runs.
- **WORSE**: after's pass rate is below before's by more than 2 SE, using the pooled binomial SE.
- **WARN**: a run read the skill from outside its own version folder; a task fails in every version; orphan runs exist; or fewer than half of the skill-armed runs opened the skill ("scores mostly measure the tool's own text").

**Output.** Two markdown tables: version × (success, tokens/run, turns/run, skill files read/run, wall s/run), and task × version pass counts. It adds per-version read histograms and notes that cache reads are counted at full price, so the numbers compare versions but don't cost them.

**Metering and adjudication.**
- `observe.mjs shim <tool>` wraps a CLI and logs JSONL records `{tags,args,code,ms,bytes,kind}`, where kind is lookup, invalid or action. `--summary` reports validFirst% and help KB.
- Adjudication lives in references/eval.md. Read every failing output first, because the scorer is usually what's wrong. Before loosening a `must`, show only the task and the answer to a **fresh session** and loosen only if it says the job is done. For quality outputs, have a fresh session judge before/after **pairs blind, in random order**.
- 10–15 tasks sampled from real logs, 3 runs per version, same model.

**What to adapt.** Generalize `sk/<version>/<skill>` to `stacks/<arm>/` holding a whole stack (many skills plus CLAUDE.md fragments plus bins). Swap "exactly one skill folder" for an install manifest. Keep the canary calibration, extended to per-stack canaries. Keep the result.json schema and the MISS/WORSE/WARN gates, generalized to N arms against none and placebo. Add Harbor task dirs and dollar cost. Keep MIT attribution in NOTICE.

## 5. Existing evals of gstack itself

**Internal** (in the gstack repo, so not independent):
- A paid **PR gate**: 132 cases on Opus 5.5 under test with a Fable 5.1 judge whose calibration fixtures are keyed to it. A full gate costs about $32, against $93 on Fable (v1.91.144.0).
- A **with/without-skill "arm benchmark"** (test/skill-e2e-arm-benchmark.test.ts). It is labelled a research instrument, not a gate. Three build tasks are judged 0–3 for over-engineering, plus LOC, and no assertion compares arms. Its header says skills "cost ~13K tokens per invocation and nothing else measures whether they earn it."
- **Overlay benchmark contract v4**: model-overlay ON/OFF, 10 samples per arm.
- **/eval-plan** (preregistration, decoys, a priced pilot) and **/benchmark-models** (one prompt across providers with a judge).
- docs/TEST_PORTFOLIO.md admits "No paid eval runs the full /autoplan chain."

**Third party** (all unreproduced ⚠):
- Sam Fold (LinkedIn, 2026-03-20): gstack's /review **prompt** was run alone, outside the full skill, on 50 PRs from the Martian Code Review Benchmark, 1,400 reviews, about $120. On Opus 4.6 it scored 31.6% F1 against 33.2% for a two-sentence baseline, with the lowest recall. Model choice mattered about 5x more than prompt choice.
- ponystack (AyanbekDos, 2026-06): claims gstack wrote more LOC than no instructions on 2 of 3 models, and that ponystack scored correctness 86/86/76% against gstack's 71/76/57%. It is self-published, has 20 stars, and the method is unclear.
- gstack's own docs/ON_THE_LOC_CONTROVERSY.md shows this criticism is known.
- Qualitative only: dbggr.dev, RyanAlberts/best-of-Agent-Harnesses, and an Augment Code explainer.

## Comparison table

| Name | Measures | Holds fixed / varies | Task source | Grader | Cost profile | OSS |
|---|---|---|---|---|---|---|
| Terminal-Bench 4.0 + Harbor | Terminal/agent work, 66 tasks | Varies model × agent; filter to fix one | Community-authored, expert-reviewed | Per-task tests, separate verifier container | High: 8 h timeout, multi-trial | Yes |
| SWE-bench Verified (bash-only) | Python issue resolution, 500 | Fixed harness (mini-SWE-agent), varies model | GitHub PRs, human-filtered | Hidden unit tests | Medium; saturated | Yes |
| SWE-Bench Pro V2 | Long-horizon SWE, 642 + 51 Hard | Native harness for Claude/GPT, SWE-agent otherwise (systems) | 11 repos, re-validated by engineers | Tests in clean container, network-locked | High | Public split |
| SWE-bench-Live / Multi-SWE | Fresh / multilingual issues | Agent+model entries | Monthly GitHub issues / 7 languages | Tests | Medium | Yes |
| Aider polyglot | Code editing, 225 exercises | Fixed aider harness, varies model | Exercism | Tests, 2 attempts | Low; stale since 2025 | Yes |
| LiveCodeBench | Competitive programming | Model only | Post-cutoff contests | Tests | Low | Yes |
| SWE-Lancer | Freelance SWE ($ value) | Model in fixed scaffold | Upwork/Expensify | E2E tests + manager choices | High | Partial |
| METR HCAST/RE-bench | Time horizon | METR scaffold, varies model | Mostly private, human-timed | Task scorers | Very high | Mostly no |
| GSO / KernelBench | Perf optimization / GPU kernels | Mostly fixed scaffold | Real repos / PyTorch ops | Speedup + correctness | Medium–high (GPU) | Yes |
| Context-Bench (Skills) | Context retrieval, skill discovery | Fixed Letta harness, varies model | Synthetic | Deterministic + LLM judge | Low–medium | Partly |
| WebDev/Code Arena, Design Arena | Frontend preference | Model (Arena); whole builder product (Design "Builders") | User prompts | Human pairwise Elo | Crowd | No |
| OpenBench | Harness effect | **Fixed model + task, varies harness** | Synthetic + Exercism + 5 TB tasks | Checker scripts; Wilson CI | Low (~$1 open-model panel) | Yes (MIT) |
| Arena HarnessTax | Harness cost vs success | **Fixed model, varies harness** (CC/Codex/Pi) | SWE-bench Lite + TB 2.0 samples | Official verifiers; bootstrap CI | Medium | Traces promised |
| AA Coding Agent Index v2 | Agent product quality + cost | Varies agent+model | FrontierCode (private) + TB 4 + SWE-Atlas | Rubric/tests + LLM judge | High | Partial |
| SkillsBench 1.1 | Lift from curated skills | **Fixed harness+model, varies skills on/off/self-made** | Contributed tasks, 8 domains | Deterministic tests | High (9.4k trajectories) | Yes |
| Vercel AGENTS.md vs skills | Delivery of framework docs | Fixed agent+model, varies context mechanism | Next.js 16 API tasks | Build/lint/test | Low | Partial |
| AGENTS.md papers (3) | Context-file effect | Fixed agent, ±context file | SWE-bench + real repos | Tests | Medium | Yes |
| Programming the Loop SKT | Skill-pack effect | **Fixed harness+model, varies pack + placebo** | 16 real Java bugs/features | Hidden API tests; sign-flip + Holm | ~$3 / 128 runs | Yes |
| superpowers-evals (Quorum) | Workflow compliance | Varies CLI, Superpowers on | Scenario scripts | LLM judge + post-checks | Medium | Yes |
| skill-diet eval.mjs | Skill slimming safety | **Fixed agent+model, varies skill version / none** | Real-log tasks | Regex + shell check; MISS/WORSE/WARN | Low (45 runs/diet) | Yes (MIT) |
| gstack internal gate / arm bench | gstack regressions; with/without skill | Fixed Claude Code + Opus 5.5 | Authored fixtures | LLM judge (Fable 5.1) + checks | ~$32/gate | Yes (in repo) |
| MCPMark MCP board | MCP server quality | **Fixed model, varies MCP server** | Verifiable tasks | Programmatic | Medium | Yes |

## Gaps gstack-evals should fill

1. **Stack as the variable.** Hold harness and model fixed, and vary whole stacks: none, placebo, gstack@sha, pstack@sha, tstack@sha, superpowers, pocock. Nobody does this today. SkillsBench varies curated task skills, and OpenBench varies harnesses.
2. **Lifecycle tasks.** Public suites grade one patch, but these stacks sell plan review, code review, browser QA, PR filing, CI babysitting and merge gates. That needs seeded review bots, flaky CI, decoy findings and rubric-graded plans (the Martian review benchmark is one source).
3. **Model-tier headroom.** Uplift decays on stronger models (Superpowers helped Opus 4.6, not Opus 5; Sam Fold's prompt spread was 1.8 pp). Report uplift per model tier and provider.
4. **Cross-harness portability.** Run the same stack on Claude Code, Codex, Cursor CLI and Pi via Harbor.
5. **Cost and size.** Report dollars, cache-aware tokens, wall time, startup tax, and LOC or an over-engineering score. Correctness alone saturates.
6. **Honesty and compliance.** Track false "done" claims (SKT: 28/30), whether the stack's skills were actually loaded (skill-diet WARN, Vercel's 56% never invoked), and whether the workflow was followed (Quorum).
7. **Rigor.** Placebo arm, blinded organic prompts, task as the unit with sign-flip/Holm tests, CIs, ≥3–5 trials, and a judge family independent of gstack's Fable judge.
8. **Version pinning.** gstack now contains pstack and tstack ideas plus three ported scripts. Pin commits (pre-1.91.266 vs current) and report overlap.
9. **Isolation.** Throwaway HOME/XDG per run (Quorum) plus canary calibration (skill-diet).
10. **Ecosystem fit.** Harbor task dirs plus Harbor installed agents (`--ak config=`), so results line up with TB, SWE-Pro and SkillsBench.

## Unverified / caveats

- Star counts and usage claims (pstack "10k runs/week", tstack stars) are snapshots or self-reported.
- Third-party gstack benchmarks (Sam Fold, ponystack) have not been reproduced. Sam Fold tested the review prompt outside the full skill flow.
- The tmustier and dbggr summaries are secondhand. dbggr ran no agents.
- GSO's scaffold and SWE-bench Multimodal's status were not re-checked this session.
- OpenBench bundles carry disclosed caveats about task-definition drift.
- Lauren Tan's employer is quoted as each source states it.
