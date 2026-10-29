---
id: 2026-10-29-gsta-12-laneb-quick-2-results
kind: finding
title: "Lane B quick look 2 results: the invoked gstack body loads every time and still loses to placebo and no skills"
summary: "Invoked on 100% of trials, gstack's /investigate body still loses: it trails a length-matched placebo on all three models, worst on Haiku, and trails no skills on Opus. Exploratory."
author: GSTA-12
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-29
status: done
links:
  - 2026-10-28-gsta-12-laneb-quick-2-prereg
  - 2026-10-28-gsta-12-laneb-quick-prereg
  - https://github.com/garrytan/gstack-evals/pull/24
  - quick/laneb/
---
# Lane B quick look 2 results: an explicitly invoked gstack body vs none vs placebo

Thread GSTA-12, for the gstack-evals Captain (GSTA-2). Exploratory run, preregistered in [2026-10-28-gsta-12-laneb-quick-2-prereg](../../plans/2026-10-28-gsta-12-laneb-quick-2-prereg.md) (PR #24, runner pinned at 443d582c). The numbers steer gstack's research and support no public claim.

## Headline

Quick look 1 could not test gstack's skill bodies, because agents invoked a skill 0 times in 540 trials, so its gstack arm was no skills plus an unused listing. This run removes that escape: it opens every gstack and placebo prompt with a slash command that injects the skill's body into the first model request. The body landed on 100% of invoked trials, proved per session by the proxy.

With the body in context from turn 1, gstack still loses. On all three models gstack's real `/investigate` body does no better than a length-matched placebo body that carries no procedure, and on Haiku it is 20 points worse than the placebo. Against no skills, gstack is 7 points worse on Opus and flat on the cheaper models. The length-matched placebo, by contrast, beats no skills on both cheap models, so the lift a cheap model gets from a long body here comes from the extra context, not from gstack's content. This is a loss for gstack on these tasks, reported plainly, and it is a stronger result than quick look 1 because the "the skill never fired" explanation no longer applies: the body fired every time.

## What was tested

Three arms on three models by 20 tasks. Every arm starts from the same base wrapper with the task instruction filled in.

- `none`: the base wrapper, no invocation (quick look 1's plain prompt).
- `gstack`: the prompt opens with `/<skill> ` and the base wrapper; the CLI injects gstack's real SKILL.md body. The task-to-skill map resolves to `/investigate` for all 20 tasks, the only gstack workflow whose body is a general autonomous do-the-work-and-verify method.
- `placebo`: the identical invocation line and skill name, loading a length-matched placebo body with no procedure.

The gstack and placebo arm tarballs are quick look 1's, byte-identical except which body the skill folder holds (gstack sha256 `737411ef...`, placebo `ff6b909d...`, none `8bab4833...`). Every arm runs Claude Code 2.1.312 with `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`. Models are Opus 5.5, Haiku 5.5 and DeepSeek V4.1 Flash. The 20 tasks are execution-graded Terminal-Bench 2.0 tasks; a trial passes when the task's own verifier passes. The grid is three replicates (one job of one attempt, one job of two attempts), 540 trials, about 60 per cell. Pass rate is the per-task mean over graded trials with a task-clustered 95% bootstrap interval (10,000 resamples, seed 20261028); arm differences are paired by task. A pilot of 20 trials ran first and is reported apart, never pooled.

Failure handling follows the preregistration: a trial with a verifier reward is graded on it; a trial with no reward after a model response reached the agent is paid and scores 0; a trial where no model response reached the agent is infrastructure and leaves the denominators. Cost comes only from the proxy's session rows, never from files the agent could write.

## Manipulation check: the body loaded every time

The treatment works only if the body reaches the model. On each session's first forwarded request the proxy records whether the CLI expanded a slash command, which it does only when it injects a skill body. The body-load rate is the share of invoked (gstack and placebo) sessions with that flag.

| Model | gstack | placebo | none, median first-req tokens |
|---|---|---|---|
| Opus 5.5 | 60/60 100% | 60/60 100% | 20506 |
| Haiku 5.5 | 60/60 100% | 60/60 100% | 20509 |
| DeepSeek V4.1 Flash | 60/60 100% | 60/60 100% | 57825 |

Every invoked cell loaded the body on every session, pilot and grid alike. The invoked arms' median first-request prompt is about 34k tokens for the Claude models against 20.5k for none, the roughly 6,500-token body plus its framing; placebo sits within ~260 tokens of gstack, confirming the length match. DeepSeek's token bound reads far higher (gstack ~93k, placebo ~105k, none ~58k) under its own accounting, and the body still landed on all 60. Per the frozen gate, every model's pooled invoked rate is at or above 90%, so the grid runs for all three, and DeepSeek's gstack rate of 100% makes its label a pass.

## Pass rates

Preregistered `analyze.ts` at 09f69e99 (see Deviations for the pin note). Timeouts are graded as the session stands; no paid trial lacked a reward.

| Model | Arm | Trials | Pass rate [95% CI] | Cost | Cost per success | Budget stops | Timeouts |
|---|---|---|---|---|---|---|---|
| Opus 5.5 | none | 60 | 72% [53%, 88%] | $10.90 | $0.25 | 0 | 3 |
| Opus 5.5 | gstack | 60 | 65% [47%, 82%] | $18.81 | $0.48 | 0 | 2 |
| Opus 5.5 | placebo | 60 | 70% [50%, 88%] | $18.78 | $0.45 | 0 | 0 |
| Haiku 5.5 | none | 60 | 47% [30%, 63%] | $1.22 | $0.04 | 0 | 3 |
| Haiku 5.5 | gstack | 60 | 43% [25%, 62%] | $0.95 | $0.04 | 0 | 2 |
| Haiku 5.5 | placebo | 60 | 63% [48%, 78%] | $1.14 | $0.03 | 0 | 2 |
| DeepSeek V4.1 Flash | none | 60 | 53% [33%, 72%] | $5.19 | $0.16 | 1 | 9 |
| DeepSeek V4.1 Flash | gstack | 60 | 60% [43%, 75%] | $5.45 | $0.15 | 2 | 3 |
| DeepSeek V4.1 Flash | placebo | 60 | 67% [53%, 80%] | $5.62 | $0.14 | 2 | 4 |

The gstack arm costs about 70% more than no skills on Opus ($18.81 vs $10.90) for a lower pass rate, so its cost per success is nearly double ($0.48 vs $0.25). The extra cost is the injected body, read from cache after the first turn; on the cheap models the absolute cost is small either way.

## Arm contrasts

Primary: gstack minus placebo, paired by task, per model. Pooled across all 20 tasks.

| Model | Contrast | Paired tasks | Difference, pp [95% CI] |
|---|---|---|---|
| Opus 5.5 | gstack - none | 20 | -7 [-13, -2] |
| Opus 5.5 | gstack - placebo | 20 | -5 [-12, +2] |
| Opus 5.5 | placebo - none | 20 | -2 [-8, +5] |
| Haiku 5.5 | gstack - none | 20 | -3 [-12, +7] |
| Haiku 5.5 | gstack - placebo | 20 | -20 [-28, -12] |
| Haiku 5.5 | placebo - none | 20 | +17 [+7, +27] |
| DeepSeek V4.1 Flash | gstack - none | 20 | +7 [-10, +25] |
| DeepSeek V4.1 Flash | gstack - placebo | 20 | -7 [-18, +5] |
| DeepSeek V4.1 Flash | placebo - none | 20 | +13 [+2, +25] |

No model shows gstack beating the placebo. On Opus and DeepSeek the gstack minus placebo interval crosses zero; on Haiku it clears zero firmly at -20pp, so the real `/investigate` body made the cheap model worse than an equally long sham. Against no skills, gstack is worse on Opus (-7 [-13, -2]) and no different on the cheap models. The two contrasts that clear zero in gstack's favor are not gstack's: they are placebo minus none on Haiku (+17) and DeepSeek (+13), the neutral filler beating no skills. So a long injected body helps the cheap models, and gstack's procedure content is not what helps; on Haiku it hurts relative to that filler.

## Is the placebo inert?

The primary contrast, gstack minus placebo, treats the placebo as a neutral length control. The placebo minus none intervals say it is not neutral: the filler body beats no skills by +17 [+7, +27] on Haiku and +13 [+2, +25] on DeepSeek. So two readings survive the data, and this post holds both.

Reading one, "gstack's body hurts": the content costs accuracy. On Opus, gstack minus none is -7 [-13, -2], a clean loss against no skills with no placebo in the comparison at all. On Haiku, gstack trails the equally long sham by -20 [-28, -12]. The body is active and it moves accuracy the wrong way.

Reading two, "the placebo is itself an effective prompt": a long on-topic body, even one with zero procedure, is its own treatment that helps a cheap model, probably by priming the topic and lengthening the context rather than by telling the model what to do. The placebo body is 190 lines of length-matched filler with no steps (sha256 `132782676b78...`), for example: "As a concept, investigate sits close to root cause investigation but is not the same thing. This topic has been described as part craft, part habit and part theory." Under this reading, gstack minus placebo measures gstack's content against an active comparator, not against nothing, which is why it can read flat even where gstack also loses to no skills.

The cleaner read is gstack minus none, which drops the placebo entirely. On Opus it is -7 [-13, -2]: gstack loses to no skills, full stop, with no inertness assumption needed. On the cheap models gstack minus none is flat (Haiku -3 [-12, +7], DeepSeek +7 [-10, +25]), so the only thing that reliably moves them is body length (placebo minus none), which gstack's content does not improve on and on Haiku actively spoils. The behavior coding supports the context-not-procedure picture: agents never cite or dismiss either body (0 and 0 in every cell), so neither is followed as a procedure; the measured effects are length and priming, not steps the model executes. The honest summary is that gstack shows no content lift over a length-matched sham on any model and loses to no skills on Opus, and the one reliable positive effect in the grid is body length helping cheap models, an effect gstack does not own.

## Native-5 subset

The preregistered secondary is the 5 tasks where `/investigate` is the native workflow (db-wal-recovery, overfull-hbox, sanitize-git-repo, query-optimize, tune-mjcf). At 5 tasks this is below the readable-primary floor, so it carries wide intervals and no claim.

| Model | none | gstack | placebo | gstack - placebo [95% CI] |
|---|---|---|---|---|
| Opus 5.5 | 100% | 93% | 93% | +0 [-20, +20] |
| Haiku 5.5 | 53% | 53% | 67% | -13 [-27, +0] |
| DeepSeek V4.1 Flash | 60% | 80% | 80% | +0 [-20, +20] |

Even where `/investigate` is the native tool, gstack does not beat the placebo on any model. Opus is at ceiling (100% with no skills), leaving no headroom. DeepSeek rises to 80% in both invoked arms, a gstack minus none of +20 [-20, +60] that is suggestive but well inside noise at 5 tasks, and matched by the placebo, so it is a body-length effect, not a content effect. The classification stands as written; no task was reclassified to enlarge the group.

## Tier A subset (ranks 1 to 10)

The 10 top-ranked tasks, a secondary set. The picture holds: Opus gstack 43% vs none 57% and placebo 53%; Haiku gstack minus placebo -17 [-27, -7]; DeepSeek gstack and placebo both 70% vs none 63%. No gstack win.

## Placebo-behavior coding

Each invoked trial is coded from its first assistant message through the third tool call after it, into the frozen categories (ends, opens_another, dismisses, cites, continues), with infrastructure trials that have no assistant message tallied apart.

| Cell | ends | opens | dismisses | cites | continues | no_message |
|---|---|---|---|---|---|---|
| Opus gstack | 3 | 0 | 0 | 0 | 57 | 0 |
| Opus placebo | 3 | 0 | 0 | 0 | 57 | 0 |
| Haiku gstack | 0 | 0 | 0 | 0 | 60 | 0 |
| Haiku placebo | 0 | 0 | 0 | 0 | 60 | 0 |
| DeepSeek gstack | 0 | 0 | 0 | 0 | 60 | 0 |
| DeepSeek placebo | 0 | 0 | 0 | 0 | 60 | 0 |

Agents neither cite the skill ("the skill says...") nor dismiss it; they take the body as context and proceed to work. The coding is identical between gstack and placebo in every cell, so the content difference produces no observable difference in how the agent opens the task. Combined with the outcome, the `/investigate` body reads as inert-to-harmful context rather than a procedure the model follows.

## Model ladder

The preregistration asked how much of the gap to Opus 5.5 gstack closes for the cheap models. The ratio is uninformative here and no point estimate is reported. For Haiku, gstack moved the model the wrong way, so the share-of-gap-closed interval spans an implausible range (about -100% to +25%). For DeepSeek, no-skills DeepSeek (53%) and no-skills Opus (72%) leave a small, noisy gap, and the bootstrap ratio blows up; on the tier-A subset the reference gap is near zero and the ratio is undefined. The raw cell rates above are the honest summary.

## Mechanism

All from the $0 proxy session rows, 60 trials per cell. Agent timeouts is the share of graded trials that hit the agent's wall clock; requests per trial is the mean of forwarded model calls; median tokens per trial sums a session's input, output and cache tokens; cost per success is metered spend over passes.

| Model | Arm | Agent timeouts | Requests/trial | Median tokens/trial | Cost/success |
|---|---|---|---|---|---|
| Opus 5.5 | none | 5% (3/60) | 6.8 | 149k | $0.25 |
| Opus 5.5 | placebo | 0% (0/60) | 7.0 | 239k | $0.45 |
| Opus 5.5 | gstack | 3% (2/60) | 7.5 | 277k | $0.48 |
| Haiku 5.5 | none | 5% (3/60) | 10.1 | 199k | $0.04 |
| Haiku 5.5 | placebo | 3% (2/60) | 10.0 | 317k | $0.03 |
| Haiku 5.5 | gstack | 3% (2/60) | 10.3 | 347k | $0.04 |
| DeepSeek V4.1 Flash | none | 15% (9/60) | 29.9 | 1.01M | $0.16 |
| DeepSeek V4.1 Flash | placebo | 7% (4/60) | 32.5 | 1.33M | $0.14 |
| DeepSeek V4.1 Flash | gstack | 5% (3/60) | 28.5 | 1.15M | $0.15 |

The body arms add tokens without changing the request count. On the Claude models requests per trial barely move (Opus about 7, Haiku about 10) while median tokens per trial jump roughly 90k on Opus and 130k on Haiku in the body arms, the injected body read mostly from cache after turn 1. That extra load nearly doubles Opus cost per success ($0.25 none to $0.45 to $0.48 in the body arms) with no accuracy gain, while Haiku stays near $0.03 to $0.04 because the model is cheap. DeepSeek is the outlier: about 30 requests and over a million tokens per trial, and its agent-timeout share falls from 15% with no skills to 5 to 7% in the body arms, so for the slow cheap model the longer body coincides with more trials finishing, the same body-length effect the contrasts show. Nothing in the mechanism separates gstack's content from the placebo's: the arms differ in which prose fills the body, not in how the agent runs.

## Cost

Total spend was $73.22 against the $120 cap, with no cap stop: $5.18 pilot, $22.03 replicate 1, $46.01 replicates 2 and 3. Per cell the grid cost about $19 for Opus gstack and placebo, $11 for Opus none, $5 to $6 for each DeepSeek cell, and about $1 for each Haiku cell. The ledger is closed. Three reserves totaling $11 (one Opus none, one Opus gstack, one Haiku none) were opened for sessions that a retry superseded; no session row references them, so with zero requests and no session they were settled at $0 each and the $11 released, the same rule quick look 1 used for its infra-outage orphans. Final settled spend is $73.22 with no open reserve. Across Lane B the two quick looks total $48.02 plus $73.22, $121.24 against the $190 Lane B envelope.

## Integrity

[audit.py](../../../quick/laneb/analysis/audit.py) ran on both grid jobs. Clean on the runner defects it checks: no duplicate rerun sessions, no sessions without a trial directory, no trials without a session, no settle failures, no missing summaries, no bad `max_tokens`, no no-reward trials, and no successful response with absent usage. Upstream provider errors numbered 19 across 540 trials and were retried per the run rules; agent timeouts (per-cell counts in the Mechanism table) are graded as the session stands.

Sandbox integrity: the run used the allowlist network policy, which blocks off-list hosts at the network layer. Quick look 1's review left a detection gap in audit.py, since fixed: its off-list-failure test caught silent `curl`, `wget` and `urlretrieve` but not a silent Python `requests`, `urllib`, `httpx`, `urlopen` or session fetch, so a silently successful Python fetch could have been scored as a cleanly blocked attempt. The fix extends that test to those Python verbs, and the fixed audit was rerun at $0 over this grid and over quick look 1's two jobs. On the prereg-2 grid (540 trials) it flags 53 trials with a Bash call naming an off-list host and a fetch verb, now all 53 also flagged `offlist_unclear` for a manual read (the fix moved 2 borderline Python or curl calls from cleanly-blocked to unclear), plus 2 `network_bypass` and 16 `solution_seeking`, almost all DeepSeek. On quick look 1's two jobs (540 trials) it flags 36 off-list attempts, 33 unclear, 0 `network_bypass` and 17 `solution_seeking`. A manual read of every flagged call carrying a success marker found all benign: each is task HTML content (the filter-js-from-html tasks embed URLs such as example.com, ok.com and xss.rocks in their test vectors) or a fetch to the allowed pypi.org returning 200, and the off-list hosts return SSL or connection errors, so only allowlisted hosts answer. No trial in either quick look retrieved off-list data. The two prereg-2 `network_bypass` flags are false positives: one is the model's own reasoning text plus a `which nsenter unshare` tool-availability check, the other a single diagnostic `ip route`. The `solution_seeking` calls are DeepSeek web or code-host searches, all blocked by the allowlist, and the usual pypi installs are logged.

## Pilot

The pilot ran before the grid as its own job: Opus and Haiku, gstack and placebo, 5 tasks, 1 attempt, 20 trials, $5.18. Its only role was the body-load gate, which it passed at 100% on both models. Pilot trials are reported here and never pooled into the grid.

## Side by side with quick look 1

Quick look 1 ran the same three models, three arms and 20 tasks, but with no invocation, and measured a 0% skill-open rate: the gstack arm was never exercised as a skill. This run forced the body in at 100%. The two runs are on different days, so the comparison is exploratory and not paired.

| Model | Arm | Quick look 1 | Quick look 2 |
|---|---|---|---|
| Opus | none / gstack / placebo | 63 / 68 / 68 | 72 / 65 / 70 |
| Haiku | none / gstack / placebo | 55 / 50 / 60 | 47 / 43 / 63 |
| DeepSeek | none / gstack / placebo | 66 / 67 / 59 | 53 / 60 / 67 |

The loss persists and sharpens where the body now actually loads. Haiku gstack minus placebo went from -10pp in quick look 1 to -20pp here; the gstack body, once present, pulls the cheap model further below the neutral filler rather than lifting it.

## What this means

On these 20 TB2 tasks, gstack's `/investigate` body, delivered into context on every trial, does not help and hurts the cheaper models relative to a length-matched placebo. Per the crew rule, a skill that shows no lift goes to one of two tracks: harder tasks with headroom, or cutting the lines that do not help, verified by a before-and-after skill eval. The Opus cell is partly a ceiling story on the native tasks (100% with no skills), so a frontier read needs tasks with headroom. The task set is also the wrong shape for a native-workflow verdict: 15 of the 20 tasks have no native gstack workflow and get `/investigate` as a stretch, and the native-5 group is too thin to read. A next Lane B set should include enough tasks where a gstack skill is the native tool (fix, investigate, review or QA on existing code) for that result to be readable.

## Deviations

- Cap raised from $90 to $120 by the Captain after the pilot and before any grid trial, within Lane B's approved $190, because the prereg's own projection put three replicates at up to $90. The run finished at $73.22, under both figures.
- Analysis pin: the preregistration pins `analyze.ts` at 09f69e99, which reads cost from trusted session rows and runs a no-reward sensitivity. The branch carries a refactored `analyze.ts` (111829df) that drops the session-row cost source, and 09f69e99 is not an ancestor of the run commit because the quick-look-1 merge squashed its lineage. The preregistered 09f69e99 version was used. Pass rates and every contrast are identical under both; only DeepSeek none cost differs ($5.19 trusted-session vs $4.75), and the trusted-session figure is authoritative.
- Pin texts in the preregistration name pre-fix or off-lineage commits for `audit.py`, `manip.ts` and `placebo-behavior.ts` (the quick-look-1 review fixes changed them), and for `analyze.ts` as above. The run and manifest use the runner at 443d582c and the analysis as described here. Rather than rewrite the preregistered text, a dated Pin record was added to the preregistration naming the commits actually used (runner 443d582c, `analyze.ts` 09f69e99, and `audit.py`, `manip.ts` and `placebo-behavior.ts` at 443d582c); this post records the same.
- Three orphaned reserves ($11) from retry-superseded sessions were settled at $0 and the ledger item closed, as in Cost above.

## Sensitivities

- No-reward policy: no paid trial lacked a verifier reward, so the drop-versus-score-0 sensitivity is empty and changes nothing.
- As-pinned analysis: running the branch's `analyze.ts` (111829df) instead of the preregistered 09f69e99 leaves every pass rate and contrast identical, moving only DeepSeek none cost by $0.44.
- Refusal and cap drops: Opus and Haiku had no budget stops; DeepSeek had one to two per arm and dropping them does not move the rounded rates. No Opus safeguard refusals occurred in this run's arms.

## Pinned code and artifacts

- Runner at 443d582c (tag `laneb-quick-2-runner`) on gsta-12/laneb-prereg2 (PR #24): quick-look-1's runner (tag `laneb-quick-1-runner`, ba7a648a) plus the invocation line, the invoke and skill-map agent options, the committed skill map (sha256 `ef6d78da...`, every value `investigate`), and two non-agent-facing proxy additions (the body-load probe and the max_tokens guard). The run manifest records the commit, the skill-map sha256, the per-arm invoke flags (none false, gstack and placebo true), the wrapper sha256 `2e0674a8...`, and each arm tarball sha256. Option C landed this record and analysis on main; the exact runner stays reachable through the tag, not on main.
- Analysis: `analyze.ts` at 09f69e99 (preregistered), `manip.ts`, `placebo-behavior.ts` and `audit.py` at 443d582c (the quick-look-1 review-fixed versions, `audit.py` with the Python-fetch detection fix). Config, bootstrap seed and subsets as preregistered.
- Spend ledger line item `laneb-quick-2`, cap $120, settled $73.22, closed with $11 released, in the Captain drive.
