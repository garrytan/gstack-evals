---
id: 2026-10-29-gsta-30-laneb-quick-3-prereg
kind: plan
title: "Lane B quick look 3 preregistration: Sonnet 5.5, particle-1, DeepSeek V4.1 Flash and Haiku 5.5 on 40 tasks, with an Opus 5.5 reference"
summary: "Quick look 2's design on 40 TB2 tasks: three arms on Sonnet 5.5, particle-1, DeepSeek V4.1 Flash and Haiku 5.5, plus Opus 5.5 none, three replicates, same day. Cap $300, stop $280."
author: GSTA-30
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-29
status: open
links:
  - 2026-10-28-gsta-12-laneb-quick-2-prereg
  - 2026-10-29-gsta-12-laneb-quick-2-results
  - 2026-10-28-gsta-12-tb2-task-selection
  - https://github.com/garrytan/gstack-evals/tree/gsta-30/laneb-quick-3-runner
  - quick/laneb/analysis/
---
# Lane B quick look 3: preregistration

GSTA-30, for the gstack-evals Captain (GSTA-2). Written 2026-10-29. Exploratory: these numbers steer research and support no public claim. Results go in a separate pull request and record the commit sha that adds this post. No paid call runs until the Captain confirms this pushed commit.

## Approval

Garry approved the cap on 2026-10-29, in GSTA-2's thread, answering GST-234 about this preregistration's pull request (#46). His words: "approve, make it $300". The Captain then amended the design to what this post describes: 40 tasks, a full same-day DeepSeek V4.1 Flash grid in place of a one-replicate anchor, a full same-day Haiku 5.5 grid, and a $280 hard stop under the $300 cap. Garry then added: "i'm also curious about the relative performance of each model too". So the Captain added a same-day Opus 5.5 none arm as the frontier reference and the model comparison section below, with the stop unchanged. The ledger's approval row quotes Garry's approval and names this post's commit.

## Why

Quick look 2 ([prereg](2026-10-28-gsta-12-laneb-quick-2-prereg.md), [results](../board/2026-10-29-gsta-12-laneb-quick-2-results/README.md)) invoked gstack's `/investigate` body on every gstack trial. On Opus 5.5, Haiku 5.5 and DeepSeek V4.1 Flash it did no better than a length-matched placebo body, and on Haiku it did worse, by 20 points.

Garry asked to "add particle-1 as a model everywhere" and allowed Sonnet 5.5 as a model under test ("yes, ok sonnet then"). This run asks quick look 2's question for those two rungs. particle-ai/particle-1 is post-trained on DeepSeek V4.1 Flash for fewer tokens per task, so its most useful comparison is beside DeepSeek, run the same day and paired by task. Haiku runs again to check quick look 2's 20-point loss on twice the tasks. Opus 5.5 runs only its none arm, as the frontier reference for comparing the models; its gstack and placebo arms stay out on cost. These are fixed rungs, so the open-weight ranking rule does not apply; the open-weight slots are outside this run's brief, and the OpenRouter ranking was not re-read.

## Question

With the skill invoked so its body is in context from turn 1, on each of Sonnet 5.5, particle-1, DeepSeek V4.1 Flash and Haiku 5.5:

1. Does the body load on the model request? (manipulation check)
2. Does gstack beat the length-matched placebo? (primary)
3. Does gstack beat no skills? Within each arm, how does particle-1 compare with DeepSeek on the same tasks? Does Haiku's quick look 2 loss to placebo hold? (secondary)
4. How do the models compare with each other and with Opus 5.5 with no skills, in pass rate, cost, tokens and time? (secondary, exploratory)

## What stays as quick look 2 ran it

Everything below is quick look 2's design, unchanged except for the task count.

- Arms: `none` (the base wrapper), `gstack` (the prompt opens with `/investigate `, so the CLI injects gstack's real SKILL.md body) and `placebo` (the same invocation line, loading the length-matched placebo body). The skill map sends every task to `investigate`; the wrapper is sha256 `2e0674a8...`.
- Harness: Claude Code 2.1.312 driven by the Lane B agent through claude-agent-sdk 0.2.174 and Harbor at f3a5a923, with `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1` and `CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000`. The allowlist network policy, one standard-30 Ubicloud VM per job, 12 concurrent trials.
- Oracle: before the first paid trial on each host, every task runs the oracle under the trial network policy; a task that fails there is dropped and reported, with no swaps.
- Grid: every model by every arm on every task (Opus 5.5 by its none arm only), every cell of a task queued together. Replicate 1 is one job of one attempt; replicates 2 and 3 are one job of two attempts.
- Failure handling: a trial with a verifier reward is graded on it. A trial with no reward after a model response reached the agent is paid and scores 0, with the drop alternative shown. A trial where no model response reached the agent is infrastructure, leaves the denominators, and is rerun up to twice. A session that hits its cap or the agent timeout is graded as it stands. Cost comes only from the proxy's session rows.
- Analysis: per-task means and 95% percentile intervals from a task-clustered bootstrap (10,000 resamples, seed 20261028), arm differences paired by task. The native-5 subset (db-wal-recovery, overfull-hbox, sanitize-git-repo, query-optimize, tune-mjcf) and tier A (ranks 1 to 10) are the secondary subsets.
- Placebo-behavior coding: quick look 2's unit (the first assistant message through the third tool call after it), categories and regexes, byte for byte. A trial with fewer than three tool calls after its first assistant message is coded through the end of its transcript. That is the rule #37 fixed in the code, stated here as the rule.
- Integrity: `audit.py` on every pilot and grid job, with the silent-fetch gate #37 fixed.

## What changes, and why

### Tasks: 40, by quick look 2's own rule

The Captain extended the list from 20 to 40 tasks before any quick look 3 outcome existed. The added 20 come from the same rule that chose the first 20: the order in `tasks/selection_tb2.json`, from the [selection post](../research/2026-10-28-gsta-12-tb2-task-selection.md), whose filters every candidate passed (environment, solved by a frontier submission, an estimated Opus 5.5 cost under $2 per trial). Ranks 1 to 21 gave quick look 2's 20 after its one oracle swap. Ranks 22 to 41 are the added 20, and ranks 42 to 54 are their reserves, used in order.

- `tasks/tasks.json` keeps quick look 2's `main` and `reserves` as they were and adds `extension`: ranks 27 to 54 (ranks 22 to 26 are already in `reserves`), each with its registry pin at TB2 commit 69671fba. `build_tasks_json.py` generates the extension the same way it generates `main` and `reserves`, and `digest_tasks.py` checks every digest against the pinned commit. Rerunning the selection pipeline on 2026-10-29 reproduced `selection_tb2.json`, `internet_labels.json`, `main` and `reserves` byte for byte, and all 54 digests checked clean.
- `tasks/final.json` (sha256 `9ccfec13f01c150f4ec838e19285375a1f034522c1a069c0ee83d75d12dd56d9`) lists the 40 in rank order as `tasks`, with `original_20` and `added_20` beside it, and records each pre-check drop in `dropped`.
- Pre-check on 2026-10-29: the added 20 ran the oracle on one standard-30 VM under the trial network policy, before any model call. Sixteen got reward 1. Four got reward 0 and were replaced by reserves 42 to 45 in order: qemu-startup (rank 27) by fix-git, financial-document-processor (30) by git-leak-recovery, build-pmars (34) by git-multibranch and build-cython-ext (36) by kv-store-grpc. The failures come from the environment, not the tasks' logic: package versions the Debian archive no longer serves, a download from github.com that fails under the policy, and a missing source checkout. The four replacements then ran the oracle the same way, and all four got reward 1. This follows how the original list was built, where qemu-alpine-ssh's oracle failure was replaced by the next reserve. The in-run oracle rule above still drops with no swaps.
- The added 20, in rank order: largest-eigenval, pypi-server, feal-differential-cryptanalysis, pytorch-model-recovery, sparql-university, custom-memory-heap-crash, headless-terminal, openssl-selfsigned-cert, password-recovery, large-scale-text-editing, log-summary-date-ranges, cobol-modernization, code-from-image, constraints-scheduling, crack-7z-hash, fix-code-vulnerability, fix-git, git-leak-recovery, git-multibranch, kv-store-grpc.
- The skill map (sha256 `54fbcf1e21dbd8bc42c59aa2c1e62dbee5f8e24dbac1af2450b1201a93e4f2e6`) sends every added task to `investigate`, like the first 20. Its branch field, which no prompt reads, marks custom-memory-heap-crash, password-recovery, fix-code-vulnerability, fix-git and git-leak-recovery as fix-existing and the rest as implement-new.

Every outcome table is reported on all 40 tasks and on the original 20, so the original 20 can be read beside quick look 2.

### Models

Four models with all three arms, and Opus 5.5 with its none arm, run the same day in the same jobs:

- Sonnet 5.5, `claude-sonnet-5-5`, through Anthropic. Metered at Anthropic's list price: $2 input, $10 output, $2.50 and $4 for 5-minute and 1-hour cache writes, $0.10 cache reads, per million tokens, with no long-context tier. Session cap $2.50: half of Opus's $5 at exactly half of Opus's prices, so the same token budget per session as quick look 2's Opus cells.
- particle-1, `particle-ai/particle-1`, through OpenRouter's Anthropic Messages route and the metering proxy, the way quick look 2 ran DeepSeek. The proxy pins OpenRouter's provider to `particle-ai` with no fallbacks. Metered at $0.25 input, $1 output and $0.03 cache reads, with cache writes charged at the input price as an upper bound. Session cap $0.50, DeepSeek's cap, since the prices are close (DeepSeek's peak is $0.30 and $1.20; particle-1's cache reads cost five times DeepSeek's). OpenRouter's endpoint list, read 2026-10-29T22:34Z (response sha256 `4af341c8...`), shows one endpoint (Particle AI, tag `particle-ai`) supporting `tools` and `tool_choice`, reasoning on by default at high effort, and implicit caching.
- DeepSeek V4.1 Flash, `deepseek-v4.1-flash-1017`, and Haiku 5.5, `claude-haiku-5-5`, with quick look 2's cell configs, routes and session caps ($0.50 and $1).
- Opus 5.5, `claude-opus-5-5`, arm none only, with quick look 2's cell config, route and $5 session cap. The runner's models list takes `claude-opus-5-5:none` for a model that runs only some arms, so Opus none shares the grid jobs and their task-major order.

The DeepSeek grid replaces the one-replicate DeepSeek none anchor that an earlier commit of this post planned. A same-day grid lets particle-1 and DeepSeek be compared paired by task in every arm, instead of across days.

### Keyless check that particle-1 tool calls pass through the proxy

Before writing this post, the quick look 3 runner was run end to end against a fake upstream with no key in any process: Harbor, the Lane B agent, real Claude Code 2.1.312 in the smoke-task container, the metering proxy with this run's proxy config (both routes pointed at a logging relay in front of the repo's stock `runner/fake_upstream.ts`), and a scratch ledger.

- particle-1, arm none and an invoked skill arm: every request reached the upstream at `/v1/messages` with the model rewritten to `particle-ai/particle-1`, the provider pin `{"only": ["particle-ai"], "allow_fallbacks": false}` and bearer auth. Claude Code ran the scripted Bash, Skill, AskUserQuestion and Bash tool calls, returned each tool result (one more per request, 0 to 4), and finished; the verifier passed. Each session metered 5 requests at $0.003375, which is 5 times the fake usage at particle-1's prices.
- Sonnet 5.5, invoked skill arm: the same five tool calls, with count_tokens forwarded on the Anthropic route, $0.02575 metered (5 times the usage at Sonnet's prices), verifier passed.
- Claude Code logs `unrecognized_model` for `particle-1` and proceeds; the session ran normally.

What this cannot show: how particle-1 itself behaves, how well it calls tools, or how OpenRouter's Anthropic route carries its reasoning output. The route check and the pilot's tool-use gate below test that with real calls before the grid. DeepSeek and Haiku ran quick look 2's pilot and grid on this harness.

### Body-load probe fix

Quick look 2's probe searched the whole first request for `<command-name>`. Claude Code 2.1.312's Skill tool description also contains that string, so the probe read true on every session, none included: 180 of 180 quick look 2 none-arm sessions have `cmd_expanded` true. The quick look 2 conclusion that the body loaded still holds on other evidence. For every model, every invoked session's first-request token bound exceeds every none session's (Opus and Haiku: invoked at least 33,915, none at most 21,155; DeepSeek: at least 92,617 against at most 59,953), and prereg 2's keyless check saw the full body in the request. But the per-session proxy proof that quick look 2's results post cites was not discriminating.

This run's proxy searches only the request's `messages`. In the keyless check it read false for particle-1's none arm and true for both invoked sessions. A new test sends a tool description that names `<command-name>` and expects false; it fails on quick look 2's probe. The gate threshold and rules below are quick look 2's. Grid body-load rates are reported for every cell, none included, where the expected rate is now 0%.

### Rebuilt gstack arm (dated deviation, 2026-10-29)

Quick look 2's gstack arm tarball was not kept, so it was rebuilt from the runner tag with `arms/build.sh`.

- none: tar sha256 `8bab483364e4153a832c0995d6bc06d2953af805f32ae70a2e40788965a6764e`, identical to the pin, as is its tar.gz.
- placebo: tar sha256 `ff6b909d89d87be16780b817bf799361263e0efcf931a2b1543db2b779c406f7`, identical to the pin, as is its tar.gz.
- gstack: tar sha256 `b93994689107ebc329b83b35c139b6a6e37ce6b4637f5c8a76dce961732c46b1` (tar.gz `28bfc18d5e55f7146332eebf8c86b873a8f60043a43027ef18930414e0878419`), against quick look 2's `737411ef...`. The `gstack.files.tsv` diff is exactly the three files under `.claude/skills/gstack/.git/objects/pack/`: the pack is renamed from `pack-5b429414...` to `pack-b3d96b65...`, the pack grows from 23,547,253 to 23,577,234 bytes, and the idx and rev keep their sizes. HEAD is still 61e201ec, the pack holds the same 4,582 objects, and `git fsck --full` is clean. The SKILL.md digest is unchanged (`eec9fe90...`), so every skill file the agent can read is byte-identical. This matches HARN-14's finding.
- The placebo manifest's generator hash recomputes as `04b4c94f...` rather than the committed `e9c16c57...`, because 111829d edited `generate.ts` after that manifest was written. The placebo output is byte-identical, so the committed placebo manifest stays.

All three tar.gz files are kept by digest in the Captain drive at `handoffs/GSTA-30/arms/`, with a SHA256SUMS file. The drive holds files under 100 MB, so gstack's tar.gz is stored in parts that reassemble to its digest.

### Pilot

Quick look 2's pilot shape on the two new rungs: Sonnet 5.5 and particle-1, arms gstack and placebo, the same 5 tasks (db-wal-recovery, overfull-hbox, filter-js-from-html, chess-best-move, adaptive-rejection-sampler), 1 trial each, 20 trials, about $3 to $4. Pilot trials are reported on their own and never pooled into the grid. Two gates, applied per model:

- Body load: the body loads (`cmd_expanded` true) in at least 90% of the model's invoked pilot sessions. If one model is under it, the grid runs and that model's cells are reported as not measuring skill bodies. If both are under it, the run stops after the pilot and GSTA-30 reports to the Captain.
- Tool use: at least 8 of the model's 10 pilot trials contain at least one tool call that got a tool result back, read from the trial's SDK message log. A model under it is dropped before the grid with the reason "tool-use incompatibility found in the pilot", and its grid cells do not run. If particle-1 is dropped, the particle-1 minus DeepSeek contrast is not computed and DeepSeek's grid still runs. If both models are dropped, the run stops after the pilot and GSTA-30 reports to the Captain.

### Money and the ledger

The route check and the pilot count toward the cap. The cap is $300, as Garry approved. The hard stop is $280: the ledger line item `laneb-quick-3` (a fresh exploratory jsonl ledger in the Captain drive) is approved at $280, so no session can reserve past it. Every ledger row carries this post's commit sha: the runner's ledger service stamps it on every reserve and settle row, and the approval and close rows name it. A cap stop is reported as an incomplete run and is never retried. The run also stops at 12:00 PT on Thursday 2026-11-05, whichever comes first.

Projection per cell of about 120 trials (40 tasks, three replicates), from quick look 2's metered 20-task cells, doubled for 40 tasks and repriced where the model is new:

| Cell | Basis | none | gstack | placebo | Cell total |
|---|---|---|---|---|---|
| Sonnet 5.5, Opus's token mix | Opus's metered cost, which at half price is Sonnet's for twice the tasks | $10.90 | $18.81 | $18.78 | $48.49 |
| Sonnet 5.5, Haiku's token mix | Haiku's metered tokens at Sonnet prices, doubled | $27.56 | $32.62 | $33.66 | $93.84 |
| particle-1, DeepSeek's token mix | DeepSeek's metered tokens at particle-1 prices, doubled | $13.84 | $14.62 | $15.78 | $44.24 |
| DeepSeek V4.1 Flash | DeepSeek's metered $5.19 / $5.45 / $5.62, doubled | $10.38 | $10.90 | $11.24 | $32.52 |
| Haiku 5.5 | Haiku's metered $1.22 / $0.95 / $1.14, doubled | $2.44 | $1.90 | $2.28 | $6.62 |
| Opus 5.5, none only | Opus none's metered $10.90, doubled | $21.80 | not run | not run | $21.80 |

With the pilot ($3 to $4) and the route check (under $0.50), the run comes to about $135 to $203. The low end has Sonnet at Opus's mix and particle-1 at half of DeepSeek's tokens; the high end has Sonnet at Haiku's mix and particle-1 at DeepSeek's. The planning figure is $172: Sonnet at 1.3 times Opus's mix, particle-1 at DeepSeek's. The added 20 passed the same cost filter as the first 20, but their real cost is unknown; if they cost 1.5 times as much per task as the first 20, the high end is about $253, still under the stop. particle-1's 1.33 to 1.40 ratio over DeepSeek's spend is its five-times-dearer cache reads, before any credit for its fewer-tokens training.

The Captain's rule for an expected total over about $230: keep Opus none, drop replicates 2 and 3 of the cheapest cells before dropping any task, and tell the Captain. The planning figure is under it, so every cell plans three replicates. After replicate 1, GSTA-30 projects the total again as the spend so far plus twice each cell's replicate 1 cost. If that is over $230, GSTA-30 tells the Captain before replicates 2 and 3 start and drops those replicates cell by cell, cheapest replicate 1 cell first and never Opus none, until the projection is under $230. No task is dropped for cost. Task-major order means a cap stop leaves whole task blocks behind, for every model alike.

## Order of work

From pinned worktrees: the runner and the analysis at the commits below.

1. Route check, the first paid step: the smoke task once each for the five models, arm none, through the real proxy and the `laneb-quick-3` ledger: `ITEM=laneb-quick-3 PREREG=<sha> LEDGER=<drive>/ledger/laneb-quick-3.jsonl MODELS="claude-sonnet-5-5 particle-1 deepseek-v4.1-flash-1017 claude-haiku-5-5 claude-opus-5-5" runner/route-check.sh`.
2. Pilot: `TASKS=db-wal-recovery,overfull-hbox,filter-js-from-html,chess-best-move,adaptive-rejection-sampler ORACLE=1 bun runner/prepare-run.ts <run> laneb3-pilot claude-sonnet-5-5,particle-1 gstack,placebo <arm dir> 1 12`.
3. Gates, read from the pilot, then grid replicate 1, every model in one job: `ORACLE=1 bun runner/prepare-run.ts <run> laneb3-r1 claude-sonnet-5-5,particle-1,deepseek-v4.1-flash-1017,claude-haiku-5-5,claude-opus-5-5:none none,gstack,placebo <arm dir> 1 12`, 13 cells per task.
4. The projection check above, then grid replicates 2 and 3: the replicate 1 command with job laneb3-r23 and 2 attempts.

A dropped model leaves the models list of steps 3 and 4. Each job launches with `UBI_OWNER=GSTA-30 UBI_SIZE=standard-30 ITEM=laneb-quick-3 PREREG=<sha> LEDGER=<drive>/ledger/laneb-quick-3.jsonl runner/launch.sh <run> <prefix> <cap left>`. Quick look 2 ran 180 trials in about 1 hour 41 minutes and 360 in about 3 hours 17 minutes at 12 concurrent, so this run's 520-trial and 1,040-trial jobs should take about 5 and 10 hours. Each launch sets `UBI_TTL_HOURS` to 8 and 14, so the VM's TTL outlasts its job. Every VM is deleted when its job's results are pulled, and none is left when the run ends.

## Metrics and analysis

The outcome is the verifier reward (1 or 0), under the failure rules above. Every outcome table below is printed on all 40 tasks and on the original 20.

- Primary: gstack minus placebo, paired by task, per model.
- particle-1 beside DeepSeek: particle-1 minus DeepSeek, paired by task, within each arm, with the same task-clustered bootstrap, plus tokens per trial and cost per success for both. Both ran the same day in the same jobs.
- Haiku check: Haiku's gstack minus placebo on the original 20 beside quick look 2's -20 [-28, -12], and on all 40. Quick look 2's loss holds if this run's original-20 interval is wholly below zero.
- Secondary: gstack minus none and placebo minus none per model; pass rate, cost and cost per success per cell; budget stops and agent timeouts per cell; the native-5 and tier A subsets with wide intervals and no claim; the Mechanism table (agent-timeout share, requests per trial, median tokens per trial, cost per success) from the session rows.
- Manipulation check: body-load rate per model and arm, pilot beside grid, and the median first-request prompt tokens per arm. This and the placebo-behavior counts are printed on all 40 only: `manip.ts` reads session rows, which carry no task name, and both check the manipulation rather than the outcome.
- Placebo-behavior coding: counts per category for each model and arm, with up to three quoted windows per category in trial-name order. No model judges.
- Model comparison: the section below.
- Each on its own line: safeguard refusals, session-cap stops, upstream errors and agent timeouts per cell. A sensitivity drops tasks hit by refusals or caps in every arm of a model.
- No parity or non-inferiority claim is made.

### Model comparison (secondary, exploratory)

Garry asked how the models perform relative to each other. Every table here is printed on all 40 tasks and on the original 20, so the original 20 line up with quick look 2's Opus, Haiku and DeepSeek numbers, which are printed beside them and labeled as a different day. No parity or ranking claim is made from it.

- Per model and arm: the pass rate with its task-clustered 95% interval, cost per success, median billed tokens per trial (input, both cache writes, cache reads and output, summed over the trial's proxy sessions) and median wall time per trial (from the trial's own start and finish times).
- Paired by task, every model's every arm minus Opus 5.5 none.
- Paired by task within each arm: particle-1 minus DeepSeek V4.1 Flash, and Sonnet 5.5 minus Haiku 5.5.
- The share of the gap to Opus that each cheaper model's gstack arm closes: (C gstack minus C none) over (Opus none minus C none), with `analyze.ts`'s bootstrap interval and the share of resamples where the gap exists. Beside it goes the interval of the denominator, Opus none minus C none. A share is marked unstable wherever that interval does not lie wholly above zero. Quick look 2 found this ratio uninformative because its gaps were small, so an unstable share is reported as unstable and not read.

The analysis runs `analyze.ts` with models `claude-sonnet-5-5,particle-1,deepseek-v4.1-flash-1017,claude-haiku-5-5,claude-opus-5-5`, arms `none,gstack,placebo`, reference `claude-opus-5-5` and subsets `original_20`, `added_20` and `tier_a` from `tasks/final.json`, and `native_5` as listed above. Its Opus gstack and placebo rows are empty by construction. `model-contrast.ts` runs on the same config with `model_pairs` `[["particle-1", "deepseek-v4.1-flash-1017"], ["claude-sonnet-5-5", "claude-haiku-5-5"]]` and `reference_cell` `["claude-opus-5-5", "none"]`, and prints the model comparison tables.

## Pinned code

- Runner: 96b0e61f3d316bc56e5e3cf0e4c78ecf59175dcf on branch `gsta-30/laneb-quick-3-runner`, under review in #48. It is quick look 2's runner (tag `laneb-quick-2-runner`, 443d582c) plus six commits. 910f3e60 adds the Sonnet and particle-1 rows to `config/cells.json` and `config/proxy.json`, records the rebuilt gstack arm's manifest, lets `route-check.sh` take ITEM, and makes the body-load probe search only the messages, with its test. 067697d2 makes the ledger service stamp the prereg commit on every row, makes `launch.sh` and `route-check.sh` require PREREG, and tests the stamp. a6c2fdc4 makes `route-check.sh` check PREREG before it starts the ledger and proxy, from #48's review. 5f46d92b adds the 40-task list to `tasks/tasks.json` and `tasks/final.json`, the added tasks to the skill map, and the extension to `prepare-run.ts`, with its test. b12469a3 makes `build_tasks_json.py`, `digest_tasks.py` and `report_tables.py` carry the extension and regenerates `tasks.json` through the pipeline, from #48's review, so the extension entries also record each image's digest and platforms, the network class and the published task stats. 96b0e61f lets a model in the models list run only some arms (`claude-opus-5-5:none`), with its test. Nothing agent-facing changes for the original 20: the prompt, the wrapper, the agent, their materialized tasks and the none and placebo arm bytes are quick look 2's, and the gstack arm differs only in its git pack files. Every paid job runs from a worktree pinned at this commit, and its manifest records the commit, the skill-map sha256 and each arm's sha256. On confirmation the commit is tagged `laneb-quick-3-runner`.
- Analysis: `quick/laneb/analysis` at this post's commit. That is main fd5a73a036ef51c053435829019177652cb1d755's `analyze.ts`, `manip.ts`, `placebo-behavior.ts` and `audit.py`, unchanged since cf69387 and so including #37's two fixes, plus `model-contrast.ts` and its test, added with this post. `model-contrast.ts` reuses `analyze.ts`'s per-task means, bootstrap and gap share, and computes only what the Captain asked for: the per-cell table, the within-arm model pairs, the contrasts against Opus none and the gap share's denominator interval.

## What would change a decision

If gstack minus placebo is clearly positive on a model whose body-load rate passes, gstack's body helps that model on these tasks, and the next step is a per-skill eval on it. If it is near zero or negative with a passing body-load rate, quick look 2's loss extends to that rung, and the skill stays on the track for harder tasks with headroom or for cutting lines that do not help. If particle-1 matches or beats DeepSeek within an arm at lower cost per success, it is the cheaper rung to carry forward; if it trails, its token savings come at a cost in passes. If Haiku's original-20 loss to placebo does not repeat, quick look 2's -20 points was partly day-to-day noise, and later posts cite this run's figure beside it. The model comparison steers which rungs later lanes carry and decides nothing on its own. If particle-1 fails the tool-use gate, it cannot run this harness as is, and the next step is a fix to the route or a different harness for it, not a rerun of this grid.
