---
id: 2026-10-27-gsta-4-public-task-sourcing
kind: research
title: Should gstack-evals import DeepSWE, SWE-bench and other public tasks?
summary: Yes, as a selected minority. About 145 public tasks serve dev, val and a public track, never the sealed split. Covers sources, licences, contamination, power and cost.
author: GSTA-4
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-27
status: done
source: Captain drive handoffs/GSTA-4/task-sourcing.md (sha256 4421dc06bd8b2157917caa0af60320ba49aadaadb59d4fdeace29ac8ecc1a9e3) and notes/ from four GSTA-4 research subagents, copied by GSTA-6 on 2026-10-28
attachments:
  - e94162dc1b01ffa53189d1dac54f3ae2ba46d3ba12fef567ec22dd62ac698f03  notes/s1-swebench-deepswe.md
  - 39c18910bf7f6b0ef1ee2c93154306d818ec131ca2b82174a24d2a054f4e0c49  notes/s2-tbench-harbor-generators.md
  - 8f89c333070fc06a39a053934c4bdf717c31a1b537149758cad41befb81ae91b  notes/s3-review-qa-lifecycle.md
  - 639c1568c1b9d7ba4c0e1db1327f9d4764548242907d96a371d1e374ba75bf95  notes/s4-selection-contamination.md
---
# Should gstack-evals import DeepSWE, SWE-bench and other public tasks?

GSTA-4, research only, 2026-10-27. No repo code, no paid model runs. Four research subagents gathered sources. Their full notes, with a URL for every claim, are in this folder under notes/ (s1 SWE family and DeepSWE, s2 Terminal-Bench, Harbor and generators, s3 review, QA and lifecycle sets, s4 selection, contamination and model cutoffs). ⚠ marks self-reported, vendor-run or aggregator-only figures.

gstack: ok not-needed for=none (no gstack checkout on this machine; before the first workflow run, run the gstack skill's install script from the owner's user-scope Capy drive with --for <skill>)

## 1. Answer

Yes, but only a selected minority of v1, from a short list of sources, and never as the sealed split. Public tasks earn their place as dev and validation tasks, as calibration anchors for our harness, and as a track outsiders can reproduce. They cannot carry promotion decisions or the headline parity claims, because every candidate publishes its tests or answer key and the 2026 models we test were trained after most of them went public.

On the two sources Garry named:

- **DeepSWE: take a selected subset.** "DeepSWE 67.5" for Kimi K3 is Datacurve's benchmark (113 tasks), not Agentica's DeepSWE-Preview agent. It is the best SWE-style set available: tasks written from scratch, behavior-level verifiers, Apache-2.0, Harbor-native, frontier near 74%. But its tests and gold patches have been on GitHub since mid-May 2026, before Opus 5.5's June 2026 training cutoff, so it is dev/val only.
- **SWE-bench Verified and SWE-Bench Pro: do not score on them.** Frontier models sit at 97% (Verified) and 99.4% (Pro V2 public), and Opus 5 scores 98.0% on Pro V2's Hard-51. Both have audited grader defects and documented memorization. Keep 10 Verified tasks as an unscored harness smoke test, and copy Pro V2's locked evaluation protocol.

The sources that fit gstack's lifecycle better than any SWE-bench variant are SWEeper-Bench for /qa, GitHub ReviewBench and Qodo PR-Review-Bench for /review, and the 18 Software tasks in Terminal-Bench 4.0 for /investigate and the model ladder. Nothing public grades an /office-hours session, a plan review or a /ship landing, and nothing public can serve as a sealed holdout. Those stay authored.

**By goal:**

| Goal | Verdict on imported tasks | Why |
|---|---|---|
| (a) Lift per skill per model | Partial | Imports cover /review, /qa, /investigate and "build after /plan-eng-review or /autoplan". They do not exercise /office-hours, /plan-ceo-review or /ship. Contamination inflates every arm alike, so it compresses headroom more than it biases lift (my inference); selecting off-ceiling tasks handles most of it. |
| (b) Model ladder | Yes, strongest case | Terminal-Bench 4.0 has one-harness numbers for every pegged model (Vals): Opus 5.5 65.2% vs 24.2 to 38.9% for the pegged slots. Published rows in Claude Code exist for GLM 5.3 and GLM 5.3 Flash, which lets us check our harness against an outside number before spending. |
| (c) Parity claims | Secondary only | A public result can appear as a labelled "public replication" of a claim, not as its basis. Contamination differs by model: Xiaomi plotted DeepSWE during MiMo V2.6 RL, and open labs RL-train on SWE-rebench, Multi-SWE-bench and SWE-smith task families. Power also matters: a 10-point margin needs about 75 to 140 task clusters, a 5-point margin about 300 to 550 (section 7). |
| (d) Factory optimization | Dev split only | The factory may read public task bodies, so public tasks are where it reflects. Keep/revert decisions can use public tasks whose bodies the factory never reads, behind a leakage gate on skill diffs. Promotion and parity use only sealed tasks created after the newest tested model's release. |

**Recommended v1 mix:** about 145 imported scored tasks (plus 20 variants derived from DeepSWE), against about 110 sealed tasks that we author or mint. That is roughly 55:45 by count. Every promotion decision and every headline claim rests on the sealed part; imported results report as their own track.

## 2. Which DeepSWE

There are two things named DeepSWE.

- **Datacurve DeepSWE (the benchmark).** 113 original long-horizon tasks from 91 repos in TypeScript (35), Go (34), Python (34), JavaScript (5) and Rust (5); 106 of the 113 are feature requests. Paper arXiv 2607.07946, v1 May 2026, v1.1 June 2026. https://deepswe.datacurve.ai/ · https://github.com/datacurve-ai/deep-swe · https://arxiv.org/abs/2607.07946. Kimi K3's model card eval file points at dataset id datacurve/deep-swe with value 67.5, run in the Kimi Code harness (https://huggingface.co/moonshotai/Kimi-K3/blob/main/.eval_results/deep-swe.yaml). The official board now shows kimi-k3 [max] at 69% ±5 under mini-swe-agent.
- **Agentica/Together DeepSWE-Preview (a model).** Qwen3-32B trained with RL on an R2E-Gym subset, 42.2% pass@1 and 59% with test-time scaling on SWE-bench Verified (2025). It is a model, not a task source. https://huggingface.co/agentica-org/DeepSWE-Preview · https://www.together.ai/blog/deepswe

Everything below about "DeepSWE" means Datacurve's benchmark.

## 3. Source table

Costs are published per-attempt figures without gstack, mostly from mini-swe-agent runs. Skill packs have measured 1.3x to 3.7x token overhead in third-party trials (landscape.md), so gstack arms will cost more; measure it in the pilot. "Headroom" means room above the published score for the frontier, and the published gap between frontier and pegged models for the ladder.

| Source | v1 tasks / total | Licence | Contamination risk | Frontier headroom | Cheap-model headroom | gstack skills exercised | Adapter | Cost per attempt | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| **DeepSWE v1.1** (Datacurve) | 30 / 113, plus 10 /review and 10 /investigate variants | Apache-2.0; upstream repos permissive | High for 2026 models: tests and golds public since May 2026, canary on website but in zero task files, MiMo tracked it in RL | Yes. Opus 5 74%, GPT-6 Astra 74% (board); Opus 5.5 74.2 ⚠; per-task rates 0 to 100% | Small in aggregate. GLM 5.3 69, GLM 5.3 Flash 63, DeepSeek V4 Flash 53 (board); pegged vendor claims 67 to 77 ⚠ | Build after /plan-eng-review or /autoplan; /review and /investigate via variants | Harbor Hub datacurve/deep-swe-1-1; Pier drives claude-code and codex | $0.24 (GLM 5.3 Flash) to $13.41 (Fable 5); 18 to 35 min ⚠ | **Import** a hard and a ladder-gap stratum, dev/val only |
| **Terminal-Bench 4.0** | 18 Software (+ up to 4 Ops debug) / 66 | Apache-2.0, canary GUID in task files | Medium: public with solutions, tasks written Mar to Aug 2026 | Yes. Opus 5.5 65.15% (Vals, mini-swe-agent); 64.8% (official, Claude Code); GPT-6 Astra 59.6% | Large. GLM 5.3 38.9, GLM 5.3 Flash 37.4, DeepSeek V4.1 Flash 1017 31.8, Step 5 Preview 31.8, MiniMax M3.1 Flash 25.3, MiMo V2.6 Flash 24.2 (Vals) | /investigate on debug tasks; careful-change tasks for plan and verification steps | Native Harbor | $0.21 to $13.20 per trial; 35 min to 2h25 (Vals) | **Import** as public transfer and ladder track; factory never reads it |
| **SWEeper-Bench** (Princeton) | 25 / 200 | Code MIT; data CC-BY-4.0 per README (HF licence field empty) | Medium-high: bugs are historical fixes in upstream history; verifier workflows public on HF | Yes. Best 59% (Grok 4.6 in Cursor); Opus 5 57.5 ⚠; no Opus 5.5 row | Medium. GLM 5.3 43.5, GLM 5.3 Flash 39.5 ⚠ | **/qa** directly: find the bug by using the app, fix it, keep nearby features working | Not Harbor; Modal VMs with a browser; claude-code and codex harnesses | Verifier $0.16/task; agent 12 to 102 min; agent $ not published | **Import** for /qa dev/val; re-pin verifier from GPT-5.6 Luna to GPT-6 Luna and re-check |
| **ReviewBench** (GitHub) | 25 (its test subset) / 219 PRs | MIT | High: golden findings public; mostly model-generated (GPT-5.5, Opus 4.7), so recall leans to what those models notice | Yes. Best grounded recall 26% (tools ⚠); no Opus 5.5 row | Not found | **/review** | Harbor review-bench/reviewbench-public@v1, judge isolated in verifier | Not published | **Import** for /review dev/val; re-pin judge |
| **Qodo PR-Review-Bench 1.0** | 25 / 100 PRs (580 injected issues) | MIT (HF) | High: answer key public; injected bugs may not match human bug distribution | Qodo's tool 60.1% F1 ⚠; no model rows | Small on Qodo's separate model bench: GLM 5.3 52.1 vs Opus 5.5 56.8 F1 ⚠ | **/review** recall and precision against known locations | None; JSONL plus GitHub PRs | About $1/PR for Opus 5.5 on Qodo's model bench ⚠ | **Import**; it is also the template for our sealed seeded-bug split |
| **Martian Code Review Bench** (offline) | 50 / 50, one-off | Code MIT; data CC-BY-4.0; diffs from AGPL/GPL repos | High | n/a; swapping the judge moves F1 about 9 points | n/a | /review | None; needs GitHub forks | About $0.09/review on early-2026 models ⚠ | **One-off**: replicate the third-party "gstack /review 31.6 vs 33.2 F1" result with the full skill; too small for a lift basis |
| **SWE-rebench** (Nebius, monthly) | 20 from the newest slice / 111 per month | Data CC-BY-4.0; pipeline MIT | Low per slice when issues postdate model release; the task family is in open-model RL data | Fable 5 64.5, Opus 5 63.4 (older generation); no Opus 5.5 row | MiniMax M3 47.2, MiMo V2.5 Pro 46.5 (older generation) | /investigate; build | Harbor Hub monthly slices | $0.10 to $4.40/problem | **Import** only a slice whose issues postdate 2026-10-17; otherwise use the pipeline to mint sealed tasks |
| **SWE-bench Verified** | 10 smoke, unscored / 500 | Harness MIT; no data licence field | Very high (OpenAI audit) | None: Opus 5 97.0% | None: GLM 5.3 95.4, GLM 5.3 Flash 92.0 | Build, /investigate | Harbor Hub | $1.29, 9.6 min (Opus 5, Vals) | **Smoke test only** |
| **SWE-Bench Pro V2** + Hard-51 | 0 scored / 642 + 51 | Code MIT; public split from GPL-family repos | High: 17.8-point public-vs-private gap for Opus 5 | None: Opus 5 99.4% public, 98.0% Hard-51 | Small: GLM 5.3 95.6% public, 84.3% Hard | Build, /investigate | Harbor task dirs in repo; public GHCR images; not seen on Hub | Mean $2.3 to $3/task; 50-min budget | **Skip scoring.** Copy the locked protocol; mine its published failing trajectories for real wrong patches as /review items |
| SWE-bench Multimodal v2 | 0 in v1, 20 in v1.1 / 480 | HF card has no licence field | High unless network-locked (closing the network cost agents 21 to 35 points) | Yes: Opus 5.5 70.2% (Vals) | Large: DeepSeek V4.1 Flash 46.5, GPT-6.1 Sol 43.5, Step 5 Preview 40.8 | /investigate on visual JS bugs; weak /qa | Not found on Hub | $3.63, 18.5 min (Opus 5.5) | Defer: confirm licence, rewrite instance ids that leak PR numbers |
| Senior SWE-Bench v2026.06 (Snorkel) | 0 in v1, 20 in v1.1 / 50 public | No licence file (GitHub API) | Medium | Yes: Opus 5.5 39.3% "tasteful", 61.8% basic | 17 points: DeepSeek V4.1 Flash 22.7 tasteful | Plan skills, /review-style taste and bloat gates, /investigate | Harbor | Not found | Defer until licence is clear; override its Sonnet 4.6 and Haiku 4.5 judges |
| SWE-Atlas QnA / Test Writing / Refactoring (Scale) | 0 in v1, 16 in v1.1 / 124, 90, 70 | Apache-2.0 | Medium: public, copyleft source repos | Yes: QnA 63% (Opus 5), TW 67% (Fable 5.1), RF 59% (GPT-6 Astra) | Not found | /investigate (root-cause QnA), test writing (/qa, /ship steps), refactoring | Harbor | Not found | Defer; check its judge against crew model rules |
| Harbor-Index 1.0 | Pilot 10 in v1.1 / 82 | Not checked | Public | Yes: no agent-model pair above 30% | n/a | Hard track for skills with no Opus 5.5 lift | Harbor | "A few hundred dollars" per full run | Candidate hard track |
| SlopCodeBench | Pilot in v1.1 / 36 multi-step | Not checked | Public | Not checked | Not checked | Multi-step plan then build; scores code erosion and verbosity (gstack's LOC criticism) | Harbor | Not checked | Candidate |
| **Generators**: Repo2RLEnv (HF), SWE-rebench V2 pipeline, SWE-smith, RepoLaunch | n/a | Apache-2.0, MIT, MIT, MIT | Fresh instances are clean; task families are in open-model RL data | n/a | n/a | Build, /investigate; SWE-smith also seeds bugs for /review | Repo2RLEnv emits Harbor tasks with private verifiers | SWE-smith about 2.3 cents per candidate bug | **Use** to mint sealed tasks |

**Skip** (reasons in notes s1 and s2): Multi-SWE-bench (stale board since 2025-04, same pipeline released as RL data, git-history leak reported), SWE-bench Multilingual (Opus 5.5 93.9 ⚠, images leaked future commits), SWE-Lancer (public since 2023-24, 100% zip-replacement exploit; keep only its Manager "pick the proposal" format as a plan-review template), SWE-bench-Live as tasks (Python refresh stopped at 2025-09; use RepoLaunch instead), Commit0 (board stops 2024-11, memorized libraries), GSO (frontier 79 to 88%, answers public, no gstack skill targets performance), KernelBench (GPU, reward hacking), LiveCodeBench (not agentic, saturated), Aider polyglot (frozen since 2025-10), SWE-Marathon (about 97M tokens per trial), FrontierCode, MacroscopeBench and Qodo's model bench (private). SWE-Factory is AGPL non-commercial; avoid it.

Key sources for the table: DeepSWE board https://deepswe.datacurve.ai/ and v1.1 post https://deepswe.datacurve.ai/blog/deepswe-v1-1; TB4 Vals https://www.vals.ai/benchmarks/terminal-bench-4 (read 2026-10-27) and https://www.tbench.ai/news/terminal-bench-4-0; Pro V2 https://labs.scale.com/blog/swe-bench-pro-v2 and https://github.com/scaleapi/SWE-bench_Pro-os; Verified https://www.vals.ai/benchmarks/swebench and https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/; SWEeper https://sweeperbench.com/ and https://theaggregate.ai/benchmark?slug=sweeper-bench-target ⚠; ReviewBench https://github.com/review-bench/ReviewBench; Qodo https://huggingface.co/datasets/Qodo/PR-Review-Bench; Martian https://github.com/withmartian/code-review-benchmark; SWE-rebench https://swe-rebench.com/; Multimodal https://www.vals.ai/benchmarks/swebench-multimodal; Senior SWE https://snorkel.ai/leaderboard/senior-swe-bench/; SWE-Atlas https://labs.scale.com/leaderboard; Harbor-Index https://www.tbench.ai/news/harbor-index; Repo2RLEnv https://github.com/huggingface/Repo2RLEnv; SWE-smith https://arxiv.org/abs/2504.21798. Pegged-model vendor rows are in notes s4 section 4.

## 4. Fit to gstack, skill by skill

Most public tasks are single-issue patches, so on them gstack can only show lift through whichever skill the task triggers. Imported instructions are written for generic agents, and an organic prompt may trigger no gstack skill at all (Vercel saw a skill go unused in 56% of runs; landscape.md). Two consequences: every imported task gets an arm-neutral instruction wrapper in the voice that triggers the skill under test ("debug this failing test", "review this PR before it lands"), identical across none, placebo and gstack; and every run logs whether the skill was opened.

| Skill | Public tasks as-is | Adaptation of public tasks | Must be authored |
|---|---|---|---|
| /office-hours | None | None useful: public tasks fix the scope in advance | All tasks, with a simulated user (Harbor supports user agents over ACP) |
| /plan-ceo-review | None | None useful | Planted-flaw specs (scope and premise traps), graded by whether the review catches them |
| /plan-eng-review, /autoplan | None grade a plan | DeepSWE feature prompts (short behavior specs, about 2,158 characters): run the plan skill, then build; grade with the same verifier plus diff size. Senior SWE-Bench "tasteful" gates and SlopCodeBench erosion in v1.1 | Planted-flaw engineering specs; gate-respect tasks so a factory cannot delete approval gates |
| /review | ReviewBench, Qodo PR-Review-Bench, Martian | Seed one bug into a DeepSWE gold patch (mean 668 added lines over 7 files). Detection is graded by location; because /review fixes what it finds, the hidden verifier grades the fix deterministically. Pro V2's published failing patches give real wrong patches with no seeding | Seeded-defect PRs on fresh code (Qodo or Cheddar style), plus clean PRs to measure false positives |
| /investigate | TB4 debug tasks (session-window-debug, payments-pipeline-fix, legacy-utility-triage, wal-recovery-ordering and others) | Hand the agent DeepSWE's failing CTRF test ids or a fresh SWE-rebench failing test, without the fix; grade by verifier plus fault location | Reverted fixes in sealed repos with a written root-cause rubric |
| /qa | SWEeper-Bench | SWE-bench Multimodal visual bugs (v1.1) | Apps with seeded UI bugs, scoring detection apart from repair |
| /ship | None (CI-Repair-Bench covers CI fixing but has no licence file) | None | Flaky CI, review-bot comments, merge gates, PR text |

One caveat on seeded bugs in public gold patches: a model that memorized the original patch may spot the seeded change by recall. Seed sealed bugs into minted post-cutoff PRs instead, and use DeepSWE variants only in dev.

## 5. Selection rule (preregister it)

How others do it (details in notes s4 section 1): SWE-bench Lite filters by text and patch shape, then samples at random. Verified uses three-annotator screening for underspecified issues and bad tests. Pro V2 Hard-51 keeps tasks that at least two of five model families fail, then drops ambiguous ones; Scale notes this biases those five models' Hard scores. Verified-mini clusters tasks by per-model results. Arena HarnessTax sampled 30 tasks at random from each source. SWE-rebench and LiveCodeBench filter by date against model release. IRT methods (tinyBenchmarks, metabench, Agent Psychometrics) need a response matrix we would build from pilots.

Proposed rule for gstack-evals:

1. **Eligibility.** The licence permits our use (we reference tasks by id and digest and never redistribute bodies in our repo). The grader is execution-based, or an LLM judge we can pin to a newest-generation, non-Sonnet model from a different family than the agent under test. The oracle passes and an empty patch fails in our harness. The task runs with the agent network-locked (model endpoint only) and a separate verifier container, as Pro V2 and DeepSWE v1.1 do. No open defect report (for example DeepSWE's prometheus-transactional-reload-status, whose gold fails its own verifier: https://github.com/datacurve-ai/deep-swe/issues/52). Opus 5.5 wall time under a preregistered cap.
2. **Pre-screen from published per-task data** where it exists: DeepSWE publishes per-task pass rates, Pro V2 publishes per-task grades in both modes, TB4 jobs sit on Harbor Hub. This cuts pilot cost.
3. **Pilot in our harness on separate runs.** Opus 5.5 with no skill and one cheap model (GLM 5.3 Flash) with no skill, two trials each, on the eligible pool.
4. **Keep two strata.** Frontier-headroom tasks: Opus 5.5 pass rate between 0.2 and 0.8. Ladder-gap tasks: Opus 5.5 passes and the cheap model mostly fails. Drop all-pass tasks (ceiling) and all-fail tasks (inspect as possibly broken first, since "0% pass@100 is most often a broken task").
5. **Spread clusters.** At most two tasks per upstream repo.
6. **Measure on fresh runs.** Never reuse pilot runs as measurement runs; selecting and measuring on the same runs inflates lift through regression to the mean.
7. **Disclose.** Candidate counts, every drop with its reason, post-selection edits (Scale edited 39 of 51 Hard instructions), and frozen ids plus digests in the preregistration. State that lift on a hard-selected stratum describes hard tasks, not typical ones.

How Harbor adds external datasets: an adapter emits task directories; the oracle must pass 100%; then a symmetric "parity" run checks that score ranges overlap with at least 2 runs per side (https://raw.githubusercontent.com/harbor-framework/harbor/main/adapters/ADAPTER_CONTRIBUTING.md). Overlapping ranges is a smoke test, not an equivalence test; do not reuse it for our non-inferiority claims. Note too that publishing a Harbor dataset is private by default, but sharing it makes all versions public (https://docs.harborframework.com/harbor-hub/sharing.md). Sealed tasks belong in a private git repo with a local registry.

Harbor features that fit our arms: `--skill` loads a skill pack per trial into Claude Code or Codex (https://docs.harborframework.com/jobs/skills.md), simulated users, multi-step tasks with reward gates, and separate verifiers by default since v0.25.

## 6. Holdout and contamination

What the evidence says:

- OpenAI found every frontier model it probed could reproduce SWE-bench Verified gold patches or verbatim issue details, and 59.4% of 138 audited hard tasks had defective tests (https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/). It later estimated about 30% of original SWE-Bench Pro tasks broken (https://openai.com/index/separating-signal-from-noise-coding-evaluations/).
- Scale's network-locked Pro V2 runs: Opus 5 638/642 public vs 222/272 private; GLM 5.3 614/642 vs 211/272. Scale attributes the gap to training exposure (https://labs.scale.com/blog/swe-bench-pro-v2).
- Repository mutation (namespace remapping and similar) cut Verified scores 6 to 14 points but left a post-release SWE-rebench split unchanged (https://arxiv.org/abs/2609.27891). That makes mutation a cheap contamination probe.
- Canaries are weak: GPT-4-base reproduced the BIG-bench canary ⚠ (https://www.lesswrong.com/posts/kSmHMoaLKGcGgyWzs/big-bench-canary-contamination-in-gpt-4). No lab card we read promises canary filtering or benchmark decontamination.
- Cutoffs: Opus 5.5 June 2026 (some data collected to September 2026 ⚠), GPT-6 Astra and GPT-6.1 Sol April 30, 2026 (https://platform.claude.com/docs/en/models/opus-5-5/overview, https://developers.openai.com/api/docs/models/gpt-6-astra.md). No pegged open model publishes a cutoff. The newest pegged releases are DeepSeek V4.1 Flash 1017 and MiniMax M3.1 Flash weights (both 2026-10-17), so "created after 2026-10-17" is today's bar for a task to be fresh for every model we test.

Plan:

1. **Public imports never become the sealed split.** They are dev, val, and a separately reported public track.
2. **Sealed holdout = authored plus minted.** Mint 40 to 60 tasks from real PRs merged after 2026-10-17 in repos we choose, using Repo2RLEnv's Tasksmith (writes a private verifier and repairs the task until oracle passes and no-op fails; Apache-2.0; emits Harbor tasks) or the SWE-rebench V2 pipeline (MIT). Never publish them. Prefer real post-cutoff PRs over SWE-smith synthetic bugs for parity tasks, because open labs RL-train on synthetic-bug families and parity there could flatter cheap models.
3. **Custody.** Private repo or bucket outside the public repo, committed digests, canary GUID in every sealed file (free, weak), aggregate-only results, and a query budget for the holdout.
4. **Contamination probe on each public set.** Run a sample in original and namespace-remapped form on each model; a drop beyond the noise flags memorization for that model, and that model's public-set numbers get a caveat.
5. **Leakage gate for the factory.** Reject skill diffs that name task paths, identifiers or strings from public tasks (SkillsBench-style), and reject changes that raise public scores without raising sealed val.
6. **Rotate.** At each preregistration, pull fresh tasks dated after the newest tested model's release, and retire public tasks that hit ceiling.

## 7. Power and cost, rough

**Power for parity (my arithmetic, not a cited result).** Paired non-inferiority on task means, one-sided alpha 0.05, 80% power, true difference zero, per-arm Bernoulli variance about 0.2, and an SD of the true per-task difference of 0.2 to 0.3:

| Margin | Tasks needed, 3 trials | Tasks needed, 5 trials |
|---|---|---|
| 10 points | 108 to 139 | 75 to 106 |
| 7.5 points | 191 to 246 | 132 to 187 |
| 5 points | 429 to 553 | 297 to 421 |

More tasks beat more trials once between-task variance dominates. A v1 sealed split of about 110 tasks can support a 10-point margin at best, pooled across families. A 5-point claim needs several hundred clean tasks, which only minting can supply at reasonable cost.

**Run cost.** The Opus 5.5 cell dominates. At the published per-attempt costs above, 145 imported tasks x 3 arms x 3 trials is about 1,300 attempts per model: roughly $6.5k to $17k for Opus 5.5 at $5 to $13 per attempt, and roughly $260 to $1,300 per pegged model at $0.2 to $1, before gstack's token overhead. Cheaper options: run Opus 5.5 only on the frontier-headroom stratum, use published per-task data to pre-screen, and run review tasks (diff in, findings out) at a few dollars each. No spend happens without a committed preregistration and a cap Garry approves.

## 8. Recommended v1 task plan

| Track | Source | Tasks | Role |
|---|---|---|---|
| Imported | DeepSWE v1.1 | 30 (15 headroom, 15 ladder-gap), plus 10 /review and 10 /investigate variants | Dev/val for plan skills, build, /review, /investigate |
| Imported | Terminal-Bench 4.0 | 18 Software, up to 4 Ops debug | Public transfer and ladder track, never read by the factory |
| Imported | SWEeper-Bench | 25 | /qa dev/val and ladder |
| Imported | ReviewBench | 25 | /review dev/val |
| Imported | Qodo PR-Review-Bench | 25 PRs | /review recall and precision |
| Imported | SWE-rebench newest post-cutoff slice | 20 | Fresh public val for /investigate; mint instead if no slice postdates 2026-10-17 |
| One-off | Martian offline | 50 | Replicate the third-party gstack /review claim with the full skill |
| Smoke | SWE-bench Verified | 10, unscored | Harness and install check |
| Sealed | Minted post-2026-10-17 PRs | 40 to 60 | Build and /investigate holdout; parity backbone |
| Sealed | Authored seeded-defect PRs | 20 | /review holdout |
| Sealed | Authored QA apps with seeded UI bugs | 15 | /qa holdout |
| Sealed | Authored planted-flaw specs with simulated users | 20 to 30 | /office-hours, /plan-*-review, /autoplan |
| Sealed | Authored ship scenarios | 10 to 15 | /ship |
| v1.1 candidates | Senior SWE-Bench, SWE-Atlas, SWE-bench Multimodal, Harbor-Index, SlopCodeBench | about 80 | Harder-task track and lifecycle quality, after licence and judge checks |

Every LLM-judged import (ReviewBench, Qodo, Martian, SWEeper's verifier, Senior SWE, SWE-Atlas) needs its judge re-pinned to a newest-generation non-Sonnet model, cross-family from the agent under test, and re-checked against the source's human labels. That breaks direct comparison with published numbers; say so wherever we cite them.

## 9. Could not verify

- Opus 5.5's DeepSWE harness, and which SWE-bench Pro split its self-reported 89.9 uses.
- DeepSWE figures for MiMo V2.6 Flash (67.9) and Step 5 Preview (67.7) came via deepswe.dev and HF widgets, not the lab pages. Mercor's GLM 5.3 Flash 42.5% (vs 63.4 on Datacurve's board) came via the deepswe.dev CSV.
- SWEeper-Bench per-model numbers come from an aggregator; the primary table did not render as text. No Opus 5.5 or GPT-6.1 Sol row found.
- Licences: Senior SWE-Bench (no licence file), SWE-bench Multimodal and Verified data (no HF licence field), Harbor-Index, SlopCodeBench, CI-Repair-Bench, Replay Web Debug Bench, SWE-Lancer data.
- Whether any SWE-rebench slice with issues after 2026-10-17 exists yet; the HF dataset was last modified 2025-12, and Hub slices seen run to June 2026 issues.
- Official tbench.ai rows render client-side; read via the Snorkel and Clorvin mirrors ⚠. Vals' TB4 table was read directly.
- Pro V2 board rows come from the BenchLM mirror, cross-checked against Scale's blog for three rows. Pro V2 is not seen as a Harbor Hub dataset.
- Datacurve's verifier audit (1.4% disagreement vs 32.4% for Pro) is its own self-audit; an independent audit found 112 of 113 golds pass (https://june.kim/auditing-deepswe-v1-1).
- Per-attempt dollar cost for SWEeper agents, ReviewBench, SWE-Atlas and Senior SWE-Bench.
- The power table rests on assumed variances; the pilot should replace them with measured ones.
