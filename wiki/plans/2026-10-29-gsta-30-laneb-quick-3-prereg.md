---
id: 2026-10-29-gsta-30-laneb-quick-3-prereg
kind: plan
title: "Lane B quick look 3 preregistration: Sonnet 5.5 and particle-1 on quick look 2's design"
summary: "Quick look 2's 20 tasks, three arms and three replicates on two new rungs, Sonnet 5.5 and particle-1, plus a one-replicate DeepSeek anchor. Pilot first. Cap $70, hard stop $65."
author: GSTA-30
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-29
status: open
links:
  - 2026-10-28-gsta-12-laneb-quick-2-prereg
  - 2026-10-29-gsta-12-laneb-quick-2-results
  - https://github.com/garrytan/gstack-evals/tree/gsta-30/laneb-quick-3-runner
  - quick/laneb/analysis/
---
# Lane B quick look 3: preregistration

GSTA-30, for the gstack-evals Captain (GSTA-2). Written 2026-10-29. Exploratory: these numbers steer research and support no public claim. Results go in a separate pull request and record the commit sha that adds this post. No paid call runs until the Captain relays Garry's approval of the cap for that pushed commit.

## Why

Quick look 2 ([prereg](2026-10-28-gsta-12-laneb-quick-2-prereg.md), [results](../board/2026-10-29-gsta-12-laneb-quick-2-results/README.md)) invoked gstack's `/investigate` body on every gstack trial. On Opus 5.5, Haiku 5.5 and DeepSeek V4.1 Flash it did no better than a length-matched placebo body, and on Haiku it did worse.

Garry asked to "add particle-1 as a model everywhere" and allowed Sonnet 5.5 as a model under test ("yes, ok sonnet then"). This run asks quick look 2's question for those two rungs. particle-ai/particle-1 is post-trained on DeepSeek V4.1 Flash for fewer tokens per task, so its most useful comparison is beside DeepSeek. These are fixed rungs Garry named, so the open-weight ranking rule does not apply and the OpenRouter ranking was not re-read.

## Question

With the skill invoked so its body is in context from turn 1, on Sonnet 5.5 and on particle-1:

1. Does the body load on the model request? (manipulation check)
2. Does gstack beat the length-matched placebo? (primary)
3. Does gstack beat no skills, and how do these cells sit beside quick look 2's Opus, Haiku and DeepSeek cells? (secondary; those cells ran on a different day)

## What stays as quick look 2 ran it

Everything below is quick look 2's design, unchanged.

- Tasks: the same 20 Terminal-Bench 2.0 tasks in rank order (`tasks/final.json`, sha256 `1b424348...`), each materialized and checked against its pinned digest. Before the first paid trial on each host, every task runs the oracle under the trial network policy; a task that fails is dropped and reported, with no swaps.
- Arms: `none` (the base wrapper), `gstack` (the prompt opens with `/investigate `, so the CLI injects gstack's real SKILL.md body) and `placebo` (the same invocation line, loading the length-matched placebo body). The skill map sends every task to `investigate` (sha256 `ef6d78da...`); the wrapper is sha256 `2e0674a8...`.
- Harness: Claude Code 2.1.312 driven by the Lane B agent through claude-agent-sdk 0.2.174 and Harbor at f3a5a923, with `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1` and `CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000`. The allowlist network policy, one standard-30 Ubicloud VM per job, 12 concurrent trials.
- Grid: every model by every arm on all 20 tasks, every cell of a task queued together. Replicate 1 is one job of one attempt; replicates 2 and 3 are one job of two attempts. About 60 trials per cell.
- Failure handling: a trial with a verifier reward is graded on it. A trial with no reward after a model response reached the agent is paid and scores 0, with the drop alternative shown. A trial where no model response reached the agent is infrastructure, leaves the denominators, and is rerun up to twice. A session that hits its cap or the agent timeout is graded as it stands. Cost comes only from the proxy's session rows.
- Analysis: per-task means and 95% percentile intervals from a task-clustered bootstrap (10,000 resamples, seed 20261028), arm differences paired by task. The native-5 subset (db-wal-recovery, overfull-hbox, sanitize-git-repo, query-optimize, tune-mjcf) and tier A (ranks 1 to 10) are the secondary subsets.
- Placebo-behavior coding: quick look 2's unit (the first assistant message through the third tool call after it), categories and regexes, byte for byte. A trial with fewer than three tool calls after its first assistant message is coded through the end of its transcript. That is the rule #37 fixed in the code, stated here as the rule.
- Integrity: `audit.py` on every pilot and grid job, with the silent-fetch gate #37 fixed.

## What changes, and why

### Models

Two new cells, each with all three arms:

- Sonnet 5.5, `claude-sonnet-5-5`, through Anthropic. Metered at Anthropic's list price: $2 input, $10 output, $2.50 and $4 for 5-minute and 1-hour cache writes, $0.10 cache reads, per million tokens, with no long-context tier. Session cap $2.50: half of Opus's $5 at exactly half of Opus's prices, so the same token budget per session as quick look 2's Opus cells.
- particle-1, `particle-ai/particle-1`, through OpenRouter's Anthropic Messages route and the metering proxy, the way quick look 2 ran DeepSeek. The proxy pins OpenRouter's provider to `particle-ai` with no fallbacks. Metered at $0.25 input, $1 output and $0.03 cache reads, with cache writes charged at the input price as an upper bound. Session cap $0.50, DeepSeek's cap, since the prices are close (DeepSeek's peak is $0.30 and $1.20; particle-1's cache reads cost five times DeepSeek's). OpenRouter's endpoint list, read 2026-10-29T22:34Z (response sha256 `4af341c8...`), shows one endpoint (Particle AI, tag `particle-ai`) supporting `tools` and `tool_choice`, reasoning on by default at high effort, and implicit caching.

### Keyless check that particle-1 tool calls pass through the proxy

Before writing this post, the quick look 3 runner was run end to end against a fake upstream with no key in any process: Harbor, the Lane B agent, real Claude Code 2.1.312 in the smoke-task container, the metering proxy with this run's proxy config (both routes pointed at a logging relay in front of the repo's stock `runner/fake_upstream.ts`), and a scratch ledger.

- particle-1, arm none and an invoked skill arm: every request reached the upstream at `/v1/messages` with the model rewritten to `particle-ai/particle-1`, the provider pin `{"only": ["particle-ai"], "allow_fallbacks": false}` and bearer auth. Claude Code ran the scripted Bash, Skill, AskUserQuestion and Bash tool calls, returned each tool result (one more per request, 0 to 4), and finished; the verifier passed. Each session metered 5 requests at $0.003375, which is 5 times the fake usage at particle-1's prices.
- Sonnet 5.5, invoked skill arm: the same five tool calls, with count_tokens forwarded on the Anthropic route, $0.02575 metered (5 times the usage at Sonnet's prices), verifier passed.
- Claude Code logs `unrecognized_model` for `particle-1` and proceeds; the session ran normally.

What this cannot show: how particle-1 itself behaves, how well it calls tools, or how OpenRouter's Anthropic route carries its reasoning output. The route check and the pilot's tool-use gate below test that with real calls before the grid.

### Body-load probe fix

Quick look 2's probe searched the whole first request for `<command-name>`. Claude Code 2.1.312's Skill tool description also contains that string, so the probe read true on every session, none included: 180 of 180 quick look 2 none-arm sessions have `cmd_expanded` true. The quick look 2 conclusion that the body loaded still holds on other evidence. For every model, every invoked session's first-request token bound exceeds every none session's (Opus and Haiku: invoked at least 33,915, none at most 21,155; DeepSeek: at least 92,617 against at most 59,953), and prereg 2's keyless check saw the full body in the request. But the per-session proxy proof that quick look 2's results post cites was not discriminating.

This run's proxy searches only the request's `messages`. In the keyless check it read false for particle-1's none arm and true for both invoked sessions. A new test sends a tool description that names `<command-name>` and expects false; it fails on quick look 2's probe. The gate threshold and rules below are quick look 2's. Grid body-load rates are reported for every cell, none included, where the expected rate is now 0%.

### Rebuilt gstack arm (dated deviation, 2026-10-29)

Quick look 2's gstack arm tarball was not kept, so it was rebuilt from the runner tag with `arms/build.sh`.

- none: tar sha256 `8bab483364e4153a832c0995d6bc06d2953af805f32ae70a2e40788965a6764e`, identical to the pin, as is its tar.gz.
- placebo: tar sha256 `ff6b909d89d87be16780b817bf799361263e0efcf931a2b1543db2b779c406f7`, identical to the pin, as is its tar.gz.
- gstack: tar sha256 `b93994689107ebc329b83b35c139b6a6e37ce6b4637f5c8a76dce961732c46b1` (tar.gz `28bfc18d5e55f7146332eebf8c86b873a8f60043a43027ef18930414e0878419`), against quick look 2's `737411ef...`. The `gstack.files.tsv` diff is exactly the three files under `.claude/skills/gstack/.git/objects/pack/`: the pack is renamed from `pack-5b429414...` to `pack-b3d96b65...`, the pack grows from 23,547,253 to 23,577,234 bytes, and the idx and rev keep their sizes. HEAD is still 61e201ec, the pack holds the same 4,582 objects, and `git fsck --full` is clean. The SKILL.md digest is unchanged (`eec9fe90...`), so every skill file the agent can read is byte-identical. This matches HARN-14's finding.
- The placebo manifest's generator hash recomputes as `04b4c94f...` rather than the committed `e9c16c57...`, because 111829d edited `generate.ts` after that manifest was written. The placebo output is byte-identical, so the committed placebo manifest stays.

All three tar.gz files are kept by digest in the Captain drive at `handoffs/GSTA-30/arms/`, with a SHA256SUMS file. The drive holds files under 100 MB, so gstack's tar.gz is stored in 95 MB parts that reassemble to its digest.

### Pilot

Quick look 2's pilot shape with this run's models: Sonnet 5.5 and particle-1, arms gstack and placebo, the same 5 tasks (db-wal-recovery, overfull-hbox, filter-js-from-html, chess-best-move, adaptive-rejection-sampler), 1 trial each, 20 trials, about $3 to $4. Pilot trials are reported on their own and never pooled into the grid. Two gates, applied per model:

- Body load: the body loads (`cmd_expanded` true) in at least 90% of the model's invoked pilot sessions. If one model is under it, the grid runs and that model's cells are reported as not measuring skill bodies. If both are under it, the run stops after the pilot and GSTA-30 reports to the Captain.
- Tool use: at least 8 of the model's 10 pilot trials contain at least one tool call that got a tool result back, read from the trial's SDK message log. A model under it is dropped before the grid with the reason "tool-use incompatibility found in the pilot", and its grid cells do not run. If particle-1 is dropped, the anchor below is skipped too. If both models are dropped, the run stops after the pilot.

### DeepSeek anchor

One replicate of DeepSeek V4.1 Flash's none arm (20 trials, one attempt, quick look 2's cell config), run as its own job on the same day as grid replicate 1. It checks drift before particle-1 is read beside quick look 2's DeepSeek cells. No decision rides on it. Every particle-1 versus DeepSeek row in the results prints the anchor beside it and carries a "different days" label.

### Money and the ledger

The pilot and the anchor count toward the cap. The cap is $70, asked of Garry from gate 1's remaining balance. The hard stop is $65: the ledger line item `laneb-quick-3` (a fresh exploratory jsonl ledger in the Captain drive) is approved at $65, so no session can reserve past it. Every ledger row carries this post's commit sha: the runner's ledger service stamps it on every reserve and settle row, and the approval and close rows name it. A cap stop is reported as an incomplete run and is never retried. The run also stops at 12:00 PT on Thursday 2026-11-05, whichever comes first.

Projection, from quick look 2's metered per-cell costs, repriced:

| Cell (about 60 trials) | Basis | none | gstack | placebo |
|---|---|---|---|---|
| Sonnet 5.5, Opus's token mix | Opus $10.90 / $18.81 / $18.78 at half price | $5.45 | $9.40 | $9.39 |
| Sonnet 5.5, Haiku's token mix | Haiku's metered tokens at Sonnet prices | $13.78 | $16.31 | $16.83 |
| particle-1, DeepSeek's token mix | DeepSeek $5.19 / $5.45 / $5.62 at particle-1 prices | $6.92 | $7.31 | $7.89 |

Sonnet's three cells come to $24 with Opus's token mix and $47 with Haiku's. particle-1's come to $22 with DeepSeek's mix, before any credit for its fewer-tokens training; the 1.33 to 1.40 ratio over DeepSeek's spend is its five-times-dearer cache reads. With the anchor ($1.73, one third of DeepSeek none's $5.19), the pilot ($3 to $4) and the route check (under $0.10), the run comes to about $40 to $75. The low end has Sonnet at Opus's mix and particle-1 at half of DeepSeek's tokens; the high end has Sonnet at Haiku's mix and particle-1 at DeepSeek's. The planning figure is $59: Sonnet at 1.3 times Opus's mix, particle-1 at DeepSeek's. If Sonnet runs near Haiku's token mix, replicate 3 may stop part way at the $65 hard stop. Task-major order means a cap stop leaves whole task blocks behind, for both models alike.

## Order of work

From pinned worktrees: the runner at the commit below, the analysis at main's commit below.

1. Route check, the first paid step: the smoke task once each for Sonnet 5.5, particle-1 and DeepSeek, arm none, through the real proxy and the `laneb-quick-3` ledger: `ITEM=laneb-quick-3 PREREG=<sha> LEDGER=<drive>/ledger/laneb-quick-3.jsonl MODELS="claude-sonnet-5-5 particle-1 deepseek-v4.1-flash-1017" runner/route-check.sh`.
2. Pilot: `TASKS=db-wal-recovery,overfull-hbox,filter-js-from-html,chess-best-move,adaptive-rejection-sampler ORACLE=1 bun runner/prepare-run.ts <run> laneb3-pilot claude-sonnet-5-5,particle-1 gstack,placebo <arm dir> 1 12`.
3. Gates, read from the pilot, then grid replicate 1: `ORACLE=1 bun runner/prepare-run.ts <run> laneb3-r1 claude-sonnet-5-5,particle-1 none,gstack,placebo <arm dir> 1 12`, and the anchor: `ORACLE=1 bun runner/prepare-run.ts <run> laneb3-anchor deepseek-v4.1-flash-1017 none <arm dir> 1 12`, the same day.
4. Grid replicates 2 and 3: the replicate 1 command with job laneb3-r23 and 2 attempts.

A dropped model leaves the models list of steps 3 and 4. Each job launches with `UBI_OWNER=GSTA-30 UBI_SIZE=standard-30 ITEM=laneb-quick-3 PREREG=<sha> LEDGER=<drive>/ledger/laneb-quick-3.jsonl runner/launch.sh <run> <prefix> <cap left>`. Every VM is deleted when its job's results are pulled, and none is left when the run ends.

## Metrics and analysis

The outcome is the verifier reward (1 or 0), under the failure rules above.

- Primary: gstack minus placebo, paired by task, per model, pooled across all 20 tasks.
- Secondary: gstack minus none and placebo minus none per model; pass rate, cost and cost per success per cell; budget stops and agent timeouts per cell; the native-5 and tier A subsets with wide intervals and no claim; the Mechanism table (agent-timeout share, requests per trial, median tokens per trial, cost per success) from the session rows.
- Manipulation check: body-load rate per model and arm, pilot beside grid, and the median first-request prompt tokens per arm.
- Placebo-behavior coding: counts per category for each model and arm, with up to three quoted windows per category in trial-name order. No model judges.
- Model ladder: this run has no Opus cell, and quick look 2 found the share-of-gap ratio uninformative, so no ratio is computed. Each cell's pass rate, cost per success and tokens per trial are shown beside quick look 2's Opus, Haiku and DeepSeek cells, labeled as different days.
- particle-1 beside DeepSeek: particle-1's cells beside quick look 2's DeepSeek cells and the anchor, with tokens per trial and cost per success, labeled as different days and not a paired estimate.
- Each on its own line: safeguard refusals, session-cap stops, upstream errors and agent timeouts per cell. A sensitivity drops tasks hit by refusals or caps in every arm of a model.
- No parity or non-inferiority claim is made.

The analysis runs `analyze.ts` with models `claude-sonnet-5-5,particle-1`, arms `none,gstack,placebo` and reference `claude-opus-5-5` (absent, so its gap table is empty by construction), and separately on the anchor job.

## Pinned code

- Runner: a6c2fdc41582cbcc1870d23e34be2b2074522e2f on branch `gsta-30/laneb-quick-3-runner`, reviewed in #48. It is quick look 2's runner (tag `laneb-quick-2-runner`, 443d582c) plus three commits. 910f3e60 adds the two model rows to `config/cells.json` and `config/proxy.json`, records the rebuilt gstack arm's manifest, lets `route-check.sh` take ITEM, and makes the body-load probe search only the messages, with its test. 067697d2 makes the ledger service stamp the prereg commit on every row, makes `launch.sh` and `route-check.sh` require PREREG, and tests the stamp. a6c2fdc4 makes `route-check.sh` check PREREG before it starts the ledger and proxy, from #48's review. Nothing agent-facing changes: the prompt, the wrapper, the skill map, the agent, the materialized tasks and the none and placebo arm bytes are quick look 2's, and the gstack arm differs only in its git pack files. Every paid job runs from a worktree pinned at this commit, and its manifest records the commit, the skill-map sha256 and each arm's sha256. On approval the commit is tagged `laneb-quick-3-runner`.
- Analysis: `quick/laneb/analysis` at main fd5a73a036ef51c053435829019177652cb1d755, whose `quick/laneb/` is unchanged since cf69387 and so includes #37's two fixes: `analyze.ts`, `manip.ts`, `placebo-behavior.ts` and `audit.py`.

## What would change a decision

If gstack minus placebo is clearly positive on a model whose body-load rate passes, gstack's body helps that model on these tasks, and the next step is a per-skill eval on it. If it is near zero or negative with a passing body-load rate, quick look 2's loss extends to that rung, and the skill stays on the track for harder tasks with headroom or for cutting lines that do not help. If particle-1 fails the tool-use gate, it cannot run this harness as is, and the next step is a fix to the route or a different harness for it, not a rerun of this grid.
