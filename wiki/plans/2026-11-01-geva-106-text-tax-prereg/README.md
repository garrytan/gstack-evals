---
id: 2026-11-01-geva-106-text-tax-prereg
kind: plan
title: "Preregistration: does told skill text tax cheap models? A replication of #109's particle-1 placebo lead at two text lengths"
summary: "Freezes item 4 before any paid call: no gstack against told placebo text at 846 and 6,777 tokens on particle-1, Haiku 5.5 and DeepSeek V4.1 Flash, 37 TB2 tasks, with gates, MDD and dry run."
author: GEVA-106
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-01
status: open
links:
  - 2026-11-01-geva-93-stacks-round-1-tb2-results
  - 2026-10-31-geva-78-stacks-round-1-prereg-v2
  - 2026-10-30-gsta-30-laneb-quick-3-results
  - 2026-10-29-gsta-12-laneb-quick-results
  - GST-823
  - GST-821
attachments:
  - 4fc2ed0c08cc7b6e96686f79c8101efb03b95f0012b15c20609331b3eb634f69  dryrun.txt
  - 92b67d03fce0343c217213b7572f54d87b32d4db2771b6f2702f34d59c72a6da  mdd-sim.ts.txt
  - 88c2b8fc2eb22732d3346a2973af6d8ad85fa14ead7ced1e26af19fa08b42b8b  mdd-sim-input.json
  - 68e102c0e957e2ed26adceb7b771be35215f7e288e4c6ae9025bd2497328d435  mdd-sim.txt
---

# Preregistration: does told skill text tax cheap models?

This post freezes agenda item 4 of the insight plan (GEVA-98, adopted by Garry on 2026-11-01 under decision F) before any paid call. It calls the experiment Run T. The results go in a separate pull request. Item 2 of the plan (do agents open skills nobody tells them about) gets its own preregistration later, because it waits on a harness change (section 3).

## 1. The question and the decision

In #109, particle-1's arm that was told to use a placebo skill passed 10 points fewer TB2 tasks than its no-gstack arm: -10 [-18, -2]. #109 did not preregister that contrast. The placebo arm also hit its session cap 9 times, against 3 for no gstack. Quick look 3 measured the same contrast with the same arm tar on nearly the same tasks and got the opposite sign: +6 [-2, +15] (39 tasks, preregistered as exploratory). On Haiku 5.5 the two readings were -5 [-13, +3] (#109) and +0 [-7, +8] (quick look 3).

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Run T asks whether told skill text costs cheap models passes, and whether the cost grows with the length of the text. The decision: if it does, gstack should test short variants of its skills for cheap rungs; if it doesn't, gstack doesn't need them for this reason.

## 2. Tasks

The 37 TB2 tasks #109 analysed: quick look 3's 40 (`tasks/final.json`, sha256 9ccfec13f01c150f4ec838e19285375a1f034522c1a069c0ee83d75d12dd56d9) less crack-7z-hash, adaptive-rejection-sampler and largest-eigenval, which #109's in-run oracle rule dropped. TB2 is pinned at 69671fbaac6d67a7ef0dfec016cc38a64ef7a77c, and prepare-run checks every task digest. Every batch runs the oracle first. A task whose oracle fails on a batch's VM is dropped from every model, arm and replicate of Run T, with no swaps, and reported with the spend its trials had already used.

**Headroom.** A tax needs room below. With no gstack, particle-1 passed 82.9% and Haiku 75.7% of these tasks in #109, and DeepSeek V4.1 Flash passed 81% of quick look 3's 39.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

## 3. Arms and harness

Every arm runs Claude Code 2.1.312 as #109 did, with `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`, the same prompt wrapper (`runner/prompt-wrapper.md`, identical across arms) and the same runtime layer.

| Arm | Tar sha256 | What it is | Prompt |
|---|---|---|---|
| none | 8bab483364e4153a832c0995d6bc06d2953af805f32ae70a2e40788965a6764e | an empty `.claude/skills/`: no gstack installed | plain |
| placebo-short | bb25d3dc8018baeaf0048cf0adbc48630fedd562c9bb64abe4974e2135ee527c | #109's placebo tar with one change: the /investigate placebo body regenerated at 846 tokens (target 847, one eighth of 6,777) by the same generator | opens with `/investigate` |
| placebo | ff6b909d89d87be16780b817bf799361263e0efcf931a2b1543db2b779c406f7 | #109's placebo: every gstack v1.91.295.0 skill folder with its frontmatter kept and its body replaced by on-topic, procedure-free prose of the same token count (/investigate: 6,777 tokens) | opens with `/investigate` |

placebo is exactly #109's told placebo arm. placebo-short keeps the told instruction, the 65-skill listing and the placebo tree, and changes only how much text the told expansion injects. So placebo minus placebo-short is the length effect with the instruction held fixed, which is the choice a short variant would make. placebo-short minus none carries the listing, the instruction and a short body together.

`arms/variants.ts` on the runner tag builds placebo-short by rewriting the one tar entry in a stream and keeping every other entry byte for byte, so a rebuild anywhere gives the same sha256. Its body uses the generator's topic terms for investigate and the seed `gstack-evals/laneb/placebo/v1-short` with the generator's per-folder stream, and the generator's procedural-marker check finds nothing in it.

**System prompt.** GEVA-104 found that the pinned Claude Agent SDK (0.2.174) passes an empty `--system-prompt` by default, and Lane B's agent sets none. So the model gets only the SDK's stub system prompt: a billing header and "You are a Claude agent, built on Anthropic's Claude Agent SDK.", 136 characters in all (section 10), and never Claude Code's own system prompt. #109 and the quick looks ran on this stub. Run T runs on it on purpose, so that it replicates #109 exactly. Its results describe Claude Code driven this way, not Claude Code as people usually run it. Item 2's preregistration makes the system prompt a factor once GEVA-109's harness change merges.

## 4. Models, cells and replicates

| Model | Route | Replicates | Trials (3 arms x 37 tasks x replicates) | Session cap |
|---|---|---|---|---|
| particle-1 | OpenRouter, particle-ai only | 5 | 555 | $0.50 |
| claude-haiku-5-5 | Anthropic | 5 | 555 | $1.00 |
| deepseek-v4.1-flash-1017 | OpenRouter, deepseek only | 2 | 222 | $0.50 |

1,332 trials. Session caps and prices are the runner's (`config/cells.json`, `config/proxy.json`), the same as #109 and quick look 3 for these models. particle-1, the lead's model, gets the most replicates.

**Ladder rungs left out, with reasons.** Opus 5.5 and Sonnet 5.5, because the question is about cheap models; Sonnet's told placebo minus none was +0 [-6, +6] in quick look 3. The open-weight slots beyond DeepSeek, for cost. The OpenRouter programming ranking was re-read for this preregistration: Data API `rankings-daily?category=programming`, meta.as_of 2026-11-01T17:15:04.164Z, response sha256 bd3b0f227952668f01fdc3e2d66d584130d1267bda97cfd54e3cbef8058c061d. In the latest weekly bucket (2026-10-26), deepseek-v4.1-flash-20261017 is first with 25.1% of programming tokens, so DeepSeek stays the open-weight rung. Open weights for the families below it were not verified, since no slot runs.

## 5. What gets measured

From each trial's `result.json`, `agent/sdk-messages.jsonl`, `agent/laneb-summary.json` and the run's proxy session files:

- **Pass.** Verifier reward 1.
- **Body load (the exposure gate).** The told expansion reached the model: `cmd_expanded` in the session record of `agent/laneb-summary.json`, as #109's gates counted it. The placebo has no procedure, so there is no procedure gate: Run T tests text, not procedure.
- **Session-cap stop.** A trial in which the metering proxy refused at least one request because spend plus that request's worst case would pass the session cap (the runner's budget stops).
- **Agent timeout, requests per trial, first-request prompt tokens, cost per trial and per success.**
- **Skill opens beyond the told expansion** (`skillOpensFromMessages` in `analysis/analyze.ts`), counted as #109 did. Descriptive only.

## 6. Estimands, tests and claims

All intervals are 95% percentile intervals from a task-clustered bootstrap: 10,000 resamples of tasks with replacement, seed 20261101. A cell's pass rate is the mean over tasks of the per-task rate over that cell's graded trials. A contrast pairs by task over the tasks both cells share. p values are two-sided Monte Carlo sign-flip tests on per-task differences, 100,000 draws, seed 20261101.

**T1, the replication (one test, alpha 0.05).** particle-1, placebo minus none. The verdict comes from the interval: **confirmed** if its upper end is below 0; **reversed** if its lower end is above 0; **not confirmed** otherwise. Separately, **smaller than the lead** if the lower end is above -10, which rules out a tax the size #109 saw.

**T2, the length effect (family: particle-1, Haiku, DeepSeek; Holm).** placebo minus placebo-short on each model. The claim "longer told text cost model M passes" needs T2's Holm-adjusted p below 0.05 and an interval whose upper end is below 0. The reverse claim mirrors it. The family stays at these three models whatever happens: a model that the start rule refuses, that fails the route check, or whose told cells are under the 95% body-load gate enters Holm with p = 1.

**Secondary readings, no claims.** placebo minus none on Haiku and DeepSeek; placebo-short minus none on all three; the same contrasts pooled across the three models with equal weight per model; per arm, session-cap stops (count and rate), agent timeouts, median requests per trial, first-request prompt tokens, and cost per trial and per success; the retried-trial sensitivity (section 7).

**The session-cap mechanism.** A longer prompt makes every request cost more, so a fixed dollar cap binds sooner. On the OpenRouter routes the proxy also counts a request's worst-case input at one token per byte, so its refusal comes earlier still. Part of any tax on particle-1 and DeepSeek can come from the rig's caps rather than the model. The results split it two ways, both labelled descriptive: the contrast in session-cap stop rates, and each pass-rate contrast recomputed without the trials that hit a session cap (a complete-case reading, biased by selection, never a verdict). Haiku's route counts tokens exactly, which gives a comparison.

**Gate.** Body load per told cell is reported beside every verdict. A told cell under 95% body load is flagged, and no T1 or T2 claim is made from it.

**Prior readings shown beside T1 and T2, never pooled with them:** #109 (particle-1 -10 [-18, -2], Haiku -5 [-13, +3]) and quick look 3 (particle-1 +6 [-2, +15], Haiku +0 [-7, +8], DeepSeek -2 [-9, +6]).

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

**Disclosure.** Run T's results post prints that line, verbatim, beside every particle-1 result it reports.

## 7. Scoring and failure rules

Settled here, before any run, following the org's lesson from #101, #106 and #107.

| Case | Pass rate |
|---|---|
| Verifier reward 1 | pass |
| Verifier reward 0 | fail |
| No reward after a model response reached the agent (agent timeout, session-cap stop, crash) | fail (0), as #109 scored it |
| First request refused by the provider (Claude Code writes an "API Error" text with no usage; no tool calls) | fail (0), as #109 scored it, and counted |
| Infrastructure trial: no model response reached the agent | excluded; Harbor reruns it up to twice on the runner's retry list |
| Still infrastructure after reruns | missing, counted per cell |
| Rerun after a model response (the #109 case: the session ran, the settle call failed, Harbor reran the trial) | graded on the rerun and counted. Harbor deletes the first attempt's folder, so these trials are found from the proxy sessions file (two sessions with model responses for one trial). A sensitivity reading scores them 0 |
| Task dropped by the oracle rule | excluded from the whole run, spend reported |

A trial's arm, model and task come from its Harbor config, never from its directory name.

## 8. Money

**Ledger.** One ledger item, `texttax-r1`, in its own file `ledger/texttax-r1.jsonl` with one approval row carrying the cap, this post's merge commit and the runner tag sha. Cap: **$75** of metered model spend through the proxy. Item 4 was funded at $50; at that cap particle-1 could run 3 replicates with a minimum detectable difference of 11.4 points against the lead's 10, which failed the admission check (section 11). The Captain (GSTA-2, 2026-11-01, under org rule R42) chose: "Item 4's cap is $75 (particle-1 at 5 replicates, Haiku at 5, DeepSeek at 2; particle-1 and Haiku run first, and DeepSeek runs after they settle)." Ubicloud VM time is reported beside the cap and counts toward the R42 approval. Open reserves left by a settle that never reached the ledger stay open, and spend is reported from the proxy files, as #109 did.

**Grid check, the first step.** Before any paid call, the operating thread runs prepare-run keyless for the full grid: particle-1, Haiku and DeepSeek, each with none, placebo-short and placebo on all 37 tasks, at 5, 5 and 2 replicates (1,332 trials). It checks every cell's tar against its manifest, its told line and its trial count. If any check fails, Run T stops before the route check.

**Route check, the first paid step.** The runner's smoke task, once per model, arm none, through Run T's proxy and ledger. A model that fails twice is dropped, and the results say why.

**Projected spend per trial** (measured means from #109 and quick look 3; placebo-short sits between none and placebo):

| Model | none | placebo-short | placebo | Projected cell total |
|---|---|---|---|---|
| particle-1 | $0.072 [#109] | $0.078 | $0.088 [#109] | $44.03 |
| Haiku 5.5 | $0.009 [#109] | $0.012 | $0.013 [#109] | $6.29 |
| DeepSeek V4.1 Flash | $0.062 [quick look 3] | $0.065 | $0.068 [quick look 3] | $14.43 |

Run T projects to $64.75.

**Start rule, before each batch launches.** Run T's settled spend, plus its open reserves, plus 1.4 times the projected cost of the trials not yet finished in this batch and in every batch still running, must be at most $75. `runner/start-rule.ts` computes it from the ledger file and records the inputs and the result as a note row. If it fails, the batch does not launch, Run T ends incomplete, and the results report it. A cap stop is an incomplete run, never retried to change a verdict.

**Order.** particle-1 and Haiku at once (start rule $70.45 of $75 at the Haiku launch, with particle-1 running, on an empty ledger), then DeepSeek after both have settled ($70.52 if both settle at projection). Each batch runs on its own fresh Ubicloud standard-30 VM at 12 concurrent trials with UBI_OWNER set to the operating thread's code, and every VM is deleted when its batch ends. Batch controllers run detached on the operating thread's own machine with the ledger service, and that thread waits on them.

## 9. Runner

The runner tag `laneb-texttax-2-runner` (6d0e960feeb9e8430dfef9ca1702223e96a86609) is `laneb-stacks-1-runner` (bcf91cbba2afb8c2a822e937e0e23be9e541e110), which ran #109, plus the changes below. Both tags are in this repository, so the exact change is `git diff bcf91cbba2afb8c2a822e937e0e23be9e541e110 6d0e960feeb9e8430dfef9ca1702223e96a86609 -- quick/laneb`.

1. `arms/variants.ts` and the placebo-short manifest, which prepare-run checks.
2. `runner/skill-map.stacks.json` maps placebo-short to investigate on every task, as it maps placebo.
3. `runner/start-rule.ts`, the start rule above.
4. `analysis/discovery-tax.ts`, which computes every reading in section 6 from the pulled job folders, the proxy session files and the run config, with keyless tests.
5. Changes item 2 will use and Run T does not: an invoke switch in `prepare-run.ts` (default on, which is Run T's setting), a gstack-rewritten arm and a gpt-6.1-sol route.

Everything else (proxy, ledger, agent, grid, Harbor f3a5a923 with claude-agent-sdk 0.2.174, materialize, launch and VM scripts) is the stacks tag's, unchanged.

## 10. Keyless dry run

Run at `laneb-texttax-2-runner` on 2026-11-01 with no provider keys set. The output is attached as dryrun.txt, with operator paths shown as `<work>`, `<captain-drive>` and `<home>`. It drives every frozen rule:

1. **Arm builds.** placebo-short (and item 2's gstack-rewritten) built twice in separate processes, streaming the tars, with identical digests both times. placebo-short's body is 846 tokens with no procedural markers. prepare-run for Run T (none, placebo-short, placebo; invoke on) accepted every tar against its manifest and gave none no told line and both placebo arms `/investigate` on all 37 tasks.
2. **What reaches the model.** The pinned claude-agent-sdk 0.2.174 drove Claude Code 2.1.312 with `laneb_agent.py`'s options, environment and `build_prompt`, through the metering proxy, a fake upstream and a recording shim, with each arm's `.claude/` as its home. Every first request carries a 136-character system field (the SDK's default), and the skill listing sits in the second message, a message with role system. Told placebo: 103,724 bytes, 65 skills listed, the `/investigate` line and the body's first 200 characters present. Told placebo-short: 68,095 bytes, the same 65 skills, the line and the body present. none: 56,380 bytes, one skill listed (plugin-authoring). GEVA-109's separate check found the same placement under the real SDK.
3. **One lease for the run's ledger item.** On a temporary `texttax-r1` ledger at $75: one approval row, two sessions reserved and settled through the proxy at fake prices, no open reserve; a second approval row refused; a reserve past the cap refused.
4. **Start rule.** Run T's order passes: $70.45 of $75 at the Haiku launch with particle-1 running on an empty ledger, and $70.52 at the DeepSeek launch once both settle at projection. A case past the cap ($60 settled, then DeepSeek) comes to $80.20, is refused, and writes its note row.
5. **Analysis.** Synthetic job folders hit every row of section 7 and every claim branch: confirmed, reversed, not confirmed, smaller than the lead, the 95% body-load gate, Holm, the session-cap complete-case reading and the retried-trial sensitivity. `bun test quick/laneb`: 94 pass, 1 skip, 0 fail. The quick/laneb typecheck is clean.
6. **Route check.** The commands are printed, not run.

**What the dry run did not drive.** Harbor's local smoke hung on the dry-run machine before its agent opened a proxy session, so step 2 drives the SDK and CLI directly instead of through Harbor. The Harbor path itself is the stacks tag's, which ran #109's 1,443 trials on Ubicloud VMs. Run T changes nothing on it: the invoke switch defaults to #109's behavior, and the skill map only gains a key. The route check (section 8) is the first run through Harbor on the paid path. The dry run's prepare-run built particle-1's three cells only; the grid check (section 8) builds every cell before any paid call.

One trap the dry run found: Claude Code also loads `.claude/skills` from every parent folder of its working directory. In a trial the working folder is the task's, under no such parent, so each arm sees only its own tree.

## 11. Power and admission

The minimum detectable difference (80% power, two-sided 0.05) comes from #109's standard error for this contrast on these tasks: its particle-1 placebo minus none, -10 [-18, -2] at 3 replicates, gives about 4.08 points. It scales by the square root of 3 over the replicates. Haiku's #109 interval had the same width, and DeepSeek's quick look 3 interval was a little narrower.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

| Replicates | MDD (T1, alpha 0.05) | T2, first Holm step (alpha 0.05/3) |
|---|---|---|
| 1 | 19.8 | 22.9 |
| 2 | 14.0 | 16.2 |
| 3 | 11.4 | 13.2 |
| 4 | 9.9 | 11.4 |
| 5 | 8.8 | 10.2 |

At the frozen counts, this scaling gives particle-1's T1 MDD as 8.8 points, and T2's first Holm step as 10.2 points on particle-1 and Haiku and 16.2 on DeepSeek. The scaling treats all of the contrast's variance as noise between replicates, so these are lower bounds. The simulation below measures T1's MDD with task-level variance included.

**Simulated MDD, with task-level variance** (Captain decision on #118's review, 2026-11-01). `mdd-sim.ts.txt` runs on #109's particle-1 outcomes per task (`mdd-sim-input.json`: 37 tasks x 3 replicates, rebuilt from #109's job folders; none 92 of 111 and placebo 81 of 111, which match #109's cells). The variance of the per-task differences, 670.7 points², splits by the method of moments into 160.2 between tasks, which more replicates don't shrink, and 510.5 of sampling noise within tasks at 3 replicates. The simulation keeps the 37 tasks, sets each task's true rates to #109's shrunk by those components, shifts the mean effect in 0.25-point steps, draws r replicates per arm and applies T1's rule: the upper end of the 95% task-clustered percentile interval below 0. It runs 1,000 simulated datasets x 1,000 resamples per effect size, seed 20261101, and its output is `mdd-sim.txt`. A second reading also resamples the tasks.

| Replicates | Analytic, with task variance | Simulated, tasks fixed | Power at 10, tasks fixed | Simulated, tasks resampled |
|---|---|---|---|---|
| 3 | 11.9 | 11.6 | 0.68 | 11.8 |
| 4 | 10.7 | 10.4 | 0.77 | 10.7 |
| 5 | 9.9 | 9.1 | 0.88 | 9.6 |
| 6 | 9.4 | 8.6 | 0.90 | 8.7 |
| 7 | 9.0 | 7.9 | 0.93 | 8.7 |
| 8 | 8.6 | 7.9 | 0.96 | 8.2 |

At 5 replicates, T1's MDD is 9.1 points with the tasks fixed, as Run T runs them (9.6 with tasks resampled, 9.9 analytic), and power at the lead's 10 is 0.88. The design stays as frozen.

**Admission (the plan's C1).** The control arm has room: no-gstack passes 76% to 83% on these tasks, more than twice the MDD above the floor. T1's simulated MDD (9.1 points; 9.6 with tasks resampled and 9.9 analytic) sits inside the 10-point claim margin, which is the lead's size and the size that would justify short variants. Admitted. At the funded $50 (3 particle-1 replicates, simulated MDD 11.6) it was not.

**Caveat.** #109 and quick look 3 disagree on this contrast by 16 points, more than either interval allows. Something besides sampling may move between runs, such as changes at particle-1's provider. A single run can't remove that. The results report Run T beside both earlier readings and say so.

## 12. What each outcome means for gstack

T1 confirmed and T2 negative on particle-1: told text costs particle-1 passes and the cost grows with length, a reason to test short variants of gstack's skills for cheap rungs. A tax that tracks session-cap stops points at the rig's caps first. T1 not confirmed with T2 flat: no evidence that told text taxes these models; gstack doesn't need short variants for this reason, and #109's reading goes down as noise. Every null gets one Why-null cycle in the results post (org R48): exposure, task fit, power and floor or ceiling, and what today's frontier model does without the text, ending in KEEP, FIX-METHOD or CUT-CANDIDATE.

## 13. Out of scope

Item 2 (its own preregistration), item 1 (Harness Evals leads), gstack's real skill bodies (the placebo isolates text from procedure), the Claude Code system prompt as a factor, other hosts, the open-weight ladder slots, and any posting.
