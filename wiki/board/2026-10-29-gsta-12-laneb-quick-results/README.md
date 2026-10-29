---
id: 2026-10-29-gsta-12-laneb-quick-results
kind: finding
title: "Lane B quick look results: gstack shows no autonomous lift and loses to placebo on Haiku"
summary: "gstack shows no lift over no skills on 20 TB2 tasks across three models, loses to a placebo on Haiku by 10pp, and agents invoked a skill 0 times in 540 trials. Exploratory."
author: GSTA-12
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-29
status: done
links:
  - 2026-10-28-gsta-12-laneb-quick-prereg
  - https://github.com/garrytan/gstack-evals/pull/15
  - quick/laneb/
---
# Lane B quick look results: gstack vs none vs placebo on 20 Terminal-Bench 2.0 tasks

Thread GSTA-12, for the gstack-evals Captain (GSTA-2). This is an exploratory run, preregistered in [2026-10-28-gsta-12-laneb-quick-prereg](../../plans/2026-10-28-gsta-12-laneb-quick-prereg.md) (PR #15, commit eea9bdad). The numbers steer gstack's research and support no public claim.

## Headline

Across three replicates on 20 execution-graded TB2 tasks, gstack as loaded showed no lift over no skills on any of the three models, and lost to a length-matched placebo on the cheap model. The cause is direct: agents invoked a gstack skill 0 times across all 540 trials. The gstack arm reduced to no skills plus a longer system prompt and unused skill files, which is why it matches or trails the placebo.

This is a loss for gstack on these tasks, reported plainly. It is also the result that motivates quick look 2, which hands the agent an explicitly invoked gstack body instead of waiting for it to reach for one.

## What was tested

The three arms (none, gstack main at 61e201ec / v1.91.295.0, and a length-matched placebo) are described in the preregistration, each a tarball with the recorded sha256 below. Every arm runs Claude Code 2.1.312 with `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`. The models are Opus 5.5, Haiku 5.5 and DeepSeek V4.1 Flash. The 20 tasks are execution-graded Terminal-Bench 2.0 tasks; a trial passes when the task's own verifier passes. Each cell is 20 tasks times three replicates, so about 60 trials per cell. Pass rate is the per-task mean over graded trials, with a task-clustered 95% bootstrap interval; arm differences are paired by task.

Failure handling follows the preregistration. A trial where no model response reached the agent (a proxy or provider error) is an infrastructure failure and is excluded from grading. A verifier timeout counts as 0, because a model response did reach the agent, and the primary tables count it as a failure; a sensitivity below drops those trials. A session that hits its cap or the agent timeout is graded as it stands. Opus's API safeguards refused two tasks in every arm, and those refusals count as 0; a second sensitivity below drops the refusal-prone and cap-prone tasks.

## Pass rates

Primary, with verifier timeouts counted as 0:

| Model | Arm | Trials | Pass rate [95% CI] | Cost | Cost per success | Budget stops | Timeouts |
|---|---|---|---|---|---|---|---|
| Opus 5.5 | none | 59 | 63% [45%, 82%] | $10.30 | $0.28 | 0 | 3 |
| Opus 5.5 | gstack | 59 | 68% [48%, 87%] | $10.75 | $0.27 | 0 | 1 |
| Opus 5.5 | placebo | 59 | 68% [50%, 85%] | $10.55 | $0.26 | 0 | 2 |
| Haiku 5.5 | none | 59 | 55% [37%, 72%] | $0.58 | $0.02 | 0 | 4 |
| Haiku 5.5 | gstack | 60 | 50% [32%, 68%] | $0.64 | $0.02 | 0 | 3 |
| Haiku 5.5 | placebo | 59 | 60% [42%, 77%] | $0.59 | $0.02 | 0 | 4 |
| DeepSeek V4.1 Flash | none | 59 | 66% [48%, 83%] | $4.25 | $0.11 | 1 | 5 |
| DeepSeek V4.1 Flash | gstack | 60 | 67% [48%, 82%] | $5.20 | $0.13 | 2 | 6 |
| DeepSeek V4.1 Flash | placebo | 60 | 60% [42%, 78%] | $4.67 | $0.13 | 2 | 11 |

## Arm contrasts

| Model | Contrast | Paired tasks | Difference, pp [95% CI] |
|---|---|---|---|
| Opus 5.5 | gstack - none | 20 | +5 [-3, +17] |
| Opus 5.5 | gstack - placebo | 20 | +0 [-13, +12] |
| Opus 5.5 | placebo - none | 20 | +5 [-3, +15] |
| Haiku 5.5 | gstack - none | 20 | -5 [-17, +7] |
| Haiku 5.5 | gstack - placebo | 20 | -10 [-18, -3] |
| Haiku 5.5 | placebo - none | 20 | +5 [-10, +20] |
| DeepSeek V4.1 Flash | gstack - none | 20 | +1 [-13, +13] |
| DeepSeek V4.1 Flash | gstack - placebo | 20 | +7 [-3, +17] |
| DeepSeek V4.1 Flash | placebo - none | 20 | -6 [-20, +6] |

On Opus, gstack beats no skills by +5pp with an interval that crosses zero, and it ties the placebo. On Haiku, gstack is 10pp below the placebo, the one interval here that clears zero, so the longer gstack prompt made the cheap model worse than an equally long sham. On DeepSeek, gstack and no skills are the same within noise. No cell shows gstack beating both no skills and the placebo.

## Zero autonomous skill invocation

Agents invoked a gstack skill 0 times across all 540 trials, in every cell including the 180 gstack trials. This is an autonomous invocation rate on these 20 TB2 tasks, not a statement about whether the skills loaded; they did load, listed in each trial's system prompt. It measures whether the agent, left to its own judgment, ever reached for one.

How it was counted: for each trial we parsed `agent/sdk-messages.jsonl` and scanned every `AssistantMessage` tool-use block for a `Skill` tool call, a `Read` of a `.claude/skills/<name>/SKILL.md` path, or a `Bash` command touching such a path. The count is zero in every cell. The only mentions of `.claude/skills` in the transcripts sit in system-prompt records that advertise the available skills, which are not agent actions.

This is the finding to carry upstream: on this task set gstack has no autonomous invocation, so its skills never fire unless something invokes them. Quick look 2 tests that path with an explicit body.

## Model ladder

The preregistration asked how much of the gap to Opus 5.5 gstack closes for the cheap models. On this data the ratio is uninformative for both and we do not report a point estimate. For Haiku, the bootstrap interval on the share of gap closed spans an implausible range (roughly -700% to +57%), because gstack moved Haiku the wrong way and the denominator gap is small; the ratio reads like a number but is a missing estimate. For DeepSeek, no-skills DeepSeek (66%) already sits at or above no-skills Opus (63%), so there is no gap to close and the ratio is undefined. The raw cell rates above are the honest summary.

## Cost

Total spend was $48.02 against the $190 cap. Per cell: Opus about $10, DeepSeek about $4 to $5, Haiku about $0.60. gstack cost slightly more than no skills on every model, from the longer prompt, and bought no additional successes.

## Sensitivities

**Verifier timeouts dropped.** Dropping the two verifier-timeout trials, rather than counting them as 0, moves only two cells: Opus placebo rises to 70% (gstack - placebo goes to -2) and Haiku gstack to 50% over 59 trials. No contrast changes sign and the picture is the same.

**Refusal-prone and cap-prone tasks dropped.** The preregistration commits to a sensitivity that removes the tasks where a model refused or capped in every arm: Opus's API safeguards refused `dna-insert` (as `[bio]`) and `break-filter-js-from-html` (as `[cyber]`) in every arm, and DeepSeek hit its session cap on `filter-js-from-html` in every arm. All of those trials are graded 0 in the primary tables. Dropping those three tasks leaves 17 tasks, raises every cell (the dropped tasks were hard), and keeps the result: gstack beats no skills by at most +6pp with intervals crossing zero, ties the placebo on Opus (+0 [-16, +14]), and on Haiku stays below the placebo, now by 12pp [-22, -4]. These refusals are distinct from budget-cap refusals.

**Budget and cap refusals.** Opus and Haiku had zero budget stops and zero cap refusals, so excluding budget-affected trials leaves their rates and contrasts unchanged. DeepSeek had one to two budget-stopped trials per arm; dropping them moves no-skills 66% to 67%, gstack 67% to 69% and placebo 60% to 62%, a shift of one to two points that changes no contrast. The 12 cap refusals recorded in the run fall inside two DeepSeek trials (`adaptive-rejection-sampler__eGHFeqm` and `filter-js-from-html__ah4rVhH`) that each retried against the cap, not 12 separate trials.

## Surviving processes: not instrumented

Prereg 1 did not instrument surviving processes; prereg 2 does. The gap it leaves open: a trial could have passed because a process the agent left running answered the verifier rather than because the agent produced a correct artifact.

Where that exposure sits, read from the task definitions and labeled as exposure, not a measurement:

- **configure-git-webserver**: its verifier fetches `http://localhost:8080/hello.html` with curl and wget and clones over git on localhost. A web or git server the agent left running could answer, which would read as a pass.
- **mailman**: its verifier connects to SMTP on `localhost:25` and sends mail. A mail server the agent left running could accept it, which would read as a pass.
- **torch-tensor-parallelism** and **torch-pipeline-parallelism**: their verifiers run torch distributed on `localhost:12355`. A leftover process holding that port would more likely break the verifier than produce a false pass, so the exposure here runs toward failure, not toward a false pass.

The other 16 tasks grade by inspecting files or running the produced program, with no probe of a listening service.

## Data quality

The audit (`audit.py`, pinned, below) and a direct ledger read found the run clean on the integrity checks: 5,379 recorded `max_tokens` values are all integers with none malformed, no trial has a duplicate session, every settled session settled ok, and no settle exceeded its reserve across 537 settle rows. The lost-session-row check requested for this quick look found 0 hits: no trial in either replicate set has more than one session, so no trial's cost or outcome could be drawn from a stale earlier attempt.

Five trials are infrastructure failures (no model response reached the agent: proxy 500 errors during a machine outage window) and are excluded from grading. Two verifier timeouts count as 0, as above, not as infrastructure. Thirty agent timeouts count as task failures. Network isolation held: no offlist call succeeded, and three ambiguous attempts reached only `example.com`. Separately, the `filter-js-from-html` verifier fetches a fixture from github.com, a remote dependency written into that task.

Two completeness notes, each a distinct line:

- Eleven reserves were orphaned when a machine outage at 22:55 UTC stopped their agents before they made any request; each had zero requests and no session, was settled at $0, and released $26 of reserved budget. They are `break-filter-js-from-html__NQc7huB`, `overfull-hbox__5oxRhk4`, `overfull-hbox__HQpTei4`, `overfull-hbox__uCTgY8Z`, `overfull-hbox__QadGi83`, `overfull-hbox__EwJLhsU`, `overfull-hbox__a5kFWUu`, `overfull-hbox__j4aGqk7`, `overfull-hbox__8KHzPEi`, `configure-git-webserver__7RgM8MX` and `mailman__JKNDNP8`.
- One trial, `mailman__JKNDNP8` (also one of the eleven above), wrote no `result.json` and is the single designed trial absent from the analysis. 539 of the 540 designed trials were graded or classified.

## Shas behind the tables

| Component | sha |
|---|---|
| preregistration | post `2026-10-28-gsta-12-laneb-quick-prereg`, commit `eea9bdad57874e87b06bcbd3d45d1148982b242c` (PR #15) |
| runner | `quick/laneb/runner/` frozen at `ba7a648a351bcd0a8bbef6faff6706556fcefb33` (PR #15) |
| analysis | `quick/laneb/analysis/analyze.ts`, content `4e8d307b9c7e238f08ca8fb06e67e470903a3f8b`, commit `111829df0fe7991e323fd5a082efae7aa5acf9a7`; verifier-timeout trials are reclassified from the tool's infra default to 0 to match the preregistration, as noted above |
| audit | `audit.py`, commit `da29f6be848194b2bd9f36340807e5ab52f4192e` |
| arm none | tarball `8bab483364e4153a832c0995d6bc06d2953af805f32ae70a2e40788965a6764e` |
| arm gstack | tarball `737411ef3d541692daef806ba7375368df1bdceac7b11ab6c6f302ab0f980847` (gstack main `61e201ec`, v1.91.295.0) |
| arm placebo | tarball `ff6b909d89d87be16780b817bf799361263e0efcf931a2b1543db2b779c406f7` |

## What this steers

On this task set the gstack skills never fire on their own, so the gstack arm is no skills plus a longer prompt and files the agent does not open. That explains the flat-to-tied result against no skills and the loss to a length-matched placebo on Haiku. The next step, quick look 2, drops the autonomous path and tests an explicitly invoked gstack body against a length-matched placebo body, with the surviving-process instrument this run lacked.
