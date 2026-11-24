---
id: 2026-11-24-geva-583-cso-rerun-results
kind: finding
title: "/cso after gstack's fixes, on 52 real security advisories: the procedure now runs in every session, but /cso still named fewer advisories than a plain audit request (Opus 5.5 4 of 51 against 12 of 51, -15.7 points, 95% interval -28.6 to -4.1; particle-1 7 of 52 against 13 of 52, -11.5 [-23.1, -2.0]), so CUT-CANDIDATE on both models"
summary: "Fixed /cso ran its procedure in 104 of 104 sessions but named fewer advisories than plain: Opus 4/51 vs 12/51, -15.7 [-28.6, -4.1]; particle-1 7/52 vs 13/52, -11.5. CUT-CANDIDATE on both."
author: GEVA-583
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-24
status: done
links:
  - 2026-11-23-geva-583-cso-rerun-prereg
  - 2026-11-23-geva-561-cso-advisories-results
  - 2026-11-23-geva-581-cso-exposure-correction
  - 2026-11-19-geva-561-cso-advisories-prereg
  - https://github.com/garrytan/gstack/tree/a3ecfd530df3c78c2d60e92b6488586a75e0ff91/cso
  - lanes/outcome-skills/cso/
attachments:
  - 2a7ce2ba7c7339bb9b7636c56baf484579cb382aadca93b0d607d872c83cba8a  kit/judge-main.sh.txt
  - 1d735c6dc443582c2f9605f354222ffba4992273acbd3f00019dbc29125d7e27  kit/judge-pilot.sh.txt
  - d57c797b4eec942775319375e717b11af25ab0967a51f8b8d060843636e77755  kit/main.sh.txt
  - f42e474b048ee538bd8ff9fe2ff5d93c54fa953306fd17ce311524d17f0afd6d  kit/pilot.sh.txt
  - a76f96a0df1c7a7723e04b3598c46d99f3f4c7453d2846718f6e4077073db154  kit/pooled.sh.txt
  - 7cf738f560d27677a0a474367d54d0a31a30c8ce2b449c40d5c2b13b986f7fd0  kit/retry.sh.txt
  - a12bc61fae70b24a529ee00b81aee86a248b836e95c3231f496f88f85e2344cb  kit/retry3.sh.txt
  - 8f1f47460e06bbc86227bd773445ed54b0d263f543f0cebf5da70c7f92a4b6ac  pilot-gate.json
  - e636489b4e9c677027c1f75d305767d6c11794784724ac33798aba628254dbbb  pilot-sessions.tsv
  - b1cb1274bc65b51be538428b74c20d6741e8bd19b10dff95ff0b48ff3aa797e7  rerun-analysis.json
  - a2f7fa5336667aa1ce72999046617adc638f13a3ab8ef30c4a2069a5b74a6dff  rerun-scores.jsonl
  - 6708ac71d8be9b06b2be43756d2daa41244079402e7b55e59ffa76c513d4656f  rerun-sessions.tsv
---

# /cso after gstack's fixes, on the same 52 real advisories: results

## Takeaways

- We learned that the fixes made /cso run, but not find more. At gstack a3ecfd53, /cso's procedure ran in every session (52 of 52 on each model, up from 40 of 52 on Opus before the fixes). Fixed /cso still named fewer real advisories than a plain audit request: Opus 5.5 named 4 of 51 against 12 of 51 (-15.7 points, 95% interval -28.6 to -4.1), and particle-1 named 7 of 52 against 13 of 52 (-11.5 points, -23.1 to -2.0). Both rows are Behind with the procedure running, so the preregistered verdict is CUT-CANDIDATE on both models.
- You should not expect a security skill that narrows its report to beat a plain "audit this repo" on finding a known flaw. Fixed /cso reported 1.7 findings per Opus session against 14.8 for the plain audit, with about the same share of findings on the flaw. A plain audit that lists more findings names the flaw more often.
- Against /cso before the fixes, the named rate didn't move: 4 of 52 against 3 of 52 on Opus (+1.9 points, 0 to +6.3) and 7 of 52 against 7 of 52 on particle-1. The fixes raised how much /cso reports (Opus 0.73 to 1.71 findings per session; sessions with no finding fell from 58% to 29%), which is what gstack's maintainer asked us to check.

Call settled: /cso at gstack a3ecfd53 names fewer real advisories than a plain audit request on Opus 5.5 and particle-1 with its procedure running, so it goes to gstack's maintainer as a cut candidate (CUT-CANDIDATE)

## What works

The fixes did what they were written to do. Every new /cso session loaded the skill, started the helper's daily run, read from that run and finished it: 104 of 104, read by the fixed exposure detector. In 68 of the 104, the helper's last submit recorded at least one finding (findings_submitted in rerun-sessions.tsv); the other 36 recorded zero or made no submit. Before the fixes, a symlink refusal in the start helper stopped 12 of 52 Opus sessions. None stopped this time. No session hit a wall, turn or allowance limit, and none ended in a safety stop.

/cso is also much cheaper per session. Opus with /cso cost $0.77 a session against $3.90 for the plain audit, and particle-1 $0.15 against $1.51. That saving comes from doing less, so it doesn't help when the goal is finding the flaw.

## What didn't work

The procedure running is not enough. The plain audit named the advisory on 9 Opus units where /cso didn't, and /cso named it on 1 unit where the plain audit didn't. On particle-1 the split was 6 to 0.

The miss anatomy (by code, for each unit where the plain audit named the flaw and /cso didn't) shows where /cso fell short on Opus: 4 sessions with a failed tool call or a "not assessed" helper result, 2 that never opened a fix file, 1 that cited a fix file but for another flaw or class, and 2 the code couldn't classify. On particle-1: 4 with a failed tool call and 2 that opened a fix file but whose text never named it. A failed tool call is common in the new arm: 47 of 104 sessions had at least one, against 22 of 104 in the old arm, and the anatomy's first bucket takes any session with one before it looks further.

## Result

### Primary: named rate, new /cso against the plain audit

The plain audit is the parent run's stage 2 arm, reused unchanged (same units, trees, model ids, harness, limits and judge). Pairs are by unit; the plain audit's one judge gap leaves 51 Opus pairs.

| Model | Pairs | Plain named | /cso named | Difference | 95% interval | Plain only | /cso only | Holm p | Procedure ran | Row | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | 51 | 12 (23.5%) | 4 (7.8%) | -15.7 | -28.6 to -4.1 | 9 | 1 | 0.021 | 52 of 52 | Behind | CUT-CANDIDATE |
| particle-1 | 52 | 13 (25.0%) | 7 (13.5%) | -11.5 | -23.1 to -2.0 | 6 | 0 | 0.028 | 52 of 52 | Behind | CUT-CANDIDATE |

At the gap bounds (the plain audit's missing Opus score counted as a miss, then as a hit) the Opus difference is -15.4 (-28.3 to -5.1) and -17.3 (-30.8 to -6.0), so the gap doesn't change the row. The frozen smallest detectable difference at the observed discordant share (about 0.2) is 19 points at alpha 0.05 and none at 0.025 (power.txt in the preregistration); both differences crossed their Holm bounds anyway.

### Second family: new /cso against /cso before the fixes

| Model | Pairs | Old /cso named | New /cso named | Difference | 95% interval | Holm p |
|---|---|---|---|---|---|---|
| Opus 5.5 | 52 | 3 (5.8%) | 4 (7.7%) | +1.9 | 0 to +6.3 | 0.64 |
| particle-1 | 52 | 7 (13.5%) | 7 (13.5%) | 0 | -9.4 to +9.6 | 1 |

This family never decides the verdict. It tells the maintainer the fixes didn't move the named rate.

### Exposure: did /cso run?

| Model | New /cso loaded | New /cso procedure ran | Old /cso procedure ran (fixed detector) |
|---|---|---|---|
| Opus 5.5 | 52 of 52 | 52 of 52 | 40 of 52 |
| particle-1 | 52 of 52 | 52 of 52 | 52 of 52 |

The helper reported its daily scope as partial in 102 of 104 sessions and "not assessed" in 2. The 104 don't depend on the saved helper records the fixed detector can also read: replayed without them, all 104 still read as ran, and in each the read from the run succeeded.

### Yield

| Model | Findings per session: new /cso | plain | old /cso | Sessions with no finding: new /cso | plain | old /cso | Helper findings per run |
|---|---|---|---|---|---|---|---|
| Opus 5.5 | 1.71 | 14.80 | 0.73 | 28.8% | 0% | 57.7% | 1.27 (52 runs) |
| particle-1 | 3.13 | 14.33 | 2.02 | 13.5% | 30.8% | 40.4% | 2.32 (53 runs) |

### Secondaries, new /cso minus plain (paired, 95% interval)

| Measure | Opus 5.5 (51 pairs) | particle-1 (52 pairs) |
|---|---|---|
| Named in the final message | 21.6% to 7.8% (-13.7; -27.1 to -1.9) | 23.1% to 13.5% (-9.6; -20.4 to -1.8) |
| File-level named | 43.1% to 19.6% (-23.5; -36.2 to -12.5) | 38.5% to 26.9% (-11.5; -25.9 to +1.9) |
| Supported findings per session | 4.73 to 1.53 (-3.20; -3.86 to -2.56) | 4.65 to 2.08 (-2.58; -3.64 to -1.58) |
| Unsupported findings per session | 1.04 to 0.08 (-0.96; -1.53 to -0.50) | 0.60 to 0.31 (-0.29; -0.67 to +0.02) |
| Can't-tell findings per session | 1.78 to 0.14 (-1.65; -2.14 to -1.16) | 1.35 to 0.75 (-0.60; -1.00 to -0.22) |
| Findings per session | 14.80 to 1.75 (-13.06; -19.28 to -8.38) | 14.33 to 3.13 (-11.19; -16.49 to -7.02) |
| Phantom citations per session | 10.69 to 7.43 (-3.25; -5.92 to -0.91) | 25.77 to 19.58 (-6.19; -13.38 to +0.28) |
| Cost per session | $3.90 to $0.77 (-$3.13) | $1.51 to $0.15 (-$1.36) |

Pooled precision barely differs. On Opus, 4 of /cso's 89 findings hit the advisory (4.5%) against 13 of the plain audit's 385 (3.4%), and 14 of 89 (15.7%) were known real flaws against 46 of 385 (11.9%). On particle-1, 7 of 163 (4.3%) against 14 of 343 (4.1%). The plain audit went past 10 findings in 43% of Opus sessions and 56% of particle-1 sessions; /cso never did. Plain particle-1 ended 11 sessions at its allowance and 5 at its turn limit; /cso ended none that way. The strata (part, kind, size, month, ecosystem) are in rerun-analysis.json.

## The judge check (R78)

The route is the parent's fallback: GPT-6.2 Astra judges, with gold from Opus 5.5 and Gemini 4 Argon. The pooled check reads the parent's 85 gold reports on this route, the 10 pilot reports and 24 counted new /cso reports drawn by the frozen seed before any judged number was read. It passed every gate: named kappa on all reports and on non-anchor reports, the per-arm gate (new /cso against the plain audit within 10 points), format pairs and near misses, refusals, gold over its cap, and validity kappa. Every minimum was met, including the 100-gold floor, with no top-up past the 24. The check itself is sealed; only its release booleans print.

The pilot's judge gate passed too: 10 reports, no refusal, no judge gap, and gold agreed with the judge on all 10.

## Why null? (R48)

This is a loss, not a null, and it gets the same cycle.

- **Did the model use the part?** Yes, in every session: loaded, helper run started, read and finished.
- **Do the tasks fit?** They are the parent's 52 real advisories, where a plain audit names the flaw about a quarter of the time, so there is room both ways.
- **Enough samples and headroom?** Both differences crossed their preregistered Holm bounds.
- **Does the frontier model do it unaided?** Better than with /cso. Plain Opus names more of these flaws.

The mechanism the data supports: /cso reports a short list, and the share of findings that land on the flaw is about the same as in the plain audit's long list. Fewer findings at the same hit rate means fewer flaws named. The fixes lengthened /cso's list a little and made every session run, but the list is still about a tenth as long.

Verdict on both models: CUT-CANDIDATE. gstack's maintainer decides whether to cut /cso or change what it reports.

## The one next step

The open question for a fix is whether /cso can report the long tail of plausible flaws, the way the plain audit does, without losing what its procedure adds. A version that doesn't narrow its final report would be the thing to measure next.

## Setup

- **Arms.** New /cso at gstack a3ecfd53 (run here, 104 sessions), the plain audit and old /cso at gstack 5afef04e (both reused from the parent's stage 2).
- **Models.** Opus 5.5 (claude-opus-5-5) in Claude Code 2.1.325 with Agent SDK 0.2.174, and particle-1 (particle-ai/particle-1 through OpenRouter) in the same harness, under Harbor f3a5a923.
- **Units.** The parent's 52 stage 2 units, in the frozen draw order (stage2-draw.json) restricted to the cso cells. Each unit's tree digest was checked against the export before its session.
- **Limits.** Opus's doubled $16 allowance, particle-1's $3, 2,700 seconds, 200 turns, 3 continuations; one whole-session retry for an infra end.
- **Pilot.** 5 units the counted run never uses, one session per model (pilot-sessions.tsv): 10 of 10 completed, the procedure ran in 5 of 5 per model, the judge gate passed, the yield and print checks printed.

## Method notes

- **Three infra ends and their retry.** Three counted cells (backstage 2cmg on Opus, nuxt xfq5 on Opus, backstage xm5q on particle-1) failed in under a minute, before the agent started, because tagging the session image failed with "No such image". In each case the same unit's other model was building its image in a parallel lane: two builds of one unit share a tag, and one build's cleanup removed the image the other was about to tag. Each got the plan's one whole-session retry, one lane at a time, and all three completed.
- **A refused attempt that wasn't a session.** The first retry launch passed the driver a planned count of 3 while its records already counted 101 sessions, so the driver refused the first slot, and the finalize guard halted the run because an attempt had started without a summary. Nothing was spent (the lease settled at $0.00 with an empty proxy journal and no model messages). The owner ruled it not a session, and the cell's retry ran on a later launch after its leftover run folder was moved aside.
- **A guard that didn't hold.** The halt above should have held the next launch until a relaunch named it. It didn't, because the driver stored the session runner's halt under a different event than the one its list of standing halts reads. This PR fixes that: a cso runner halt now holds the next launch until --lift-halt names it (lanes/outcome-skills/driver/stage.ts, tested in tests/outcome-skills/cso-driver.test.ts).
- **Code changed on this branch.** Before the pilot: the overlay that reads the rerun plan, the rerun's run items, the session-side notes ruled on the parent's results (C-locale id scan, tree digest recheck, a driver stop on a failed finalize, the counted-tree check), the pilot judge gate, the pooled check, and the analysis. After the pilot sessions and before the counted run: the analysis reading the parent's records as stage 2 so the pilot's print check pairs, and the judge's ledger item under the rerun plan (cso2-judge; the pilot's first judging call was refused for want of it, before any spend). During the counted run's retries: the halt fix above. After the counted run: the miss anatomy wiring for the rerun analysis, and a fix so a session's second attempt never keeps helper records its first attempt saved. That last one changes no counted session: all 104 ran on one attempt. After review, and changing no published number: each session image build tags a name of its own, so two builds of one unit can't collide (the tag race fix); the helper record copy reads one bounded stream and checks its setting before the session; and the analysis refuses a judge check under the rerun's 100-gold floor, new sessions from more than one stage or missing a cell, and a session whose helper records were lost (none of the 104 lost them).
- **The pilot's print check** paired nothing on the primary family with the parent's first stage 0 scores, because that judging left 9 of 10 judge gaps. Run again against the parent's two stage 0 re-judges, it printed real paired values. Pilot pairs never count.
- **The pilot's first exposure reading.** In pilot session 1 (happy-dom, Opus), the frozen detector read the skill as not loaded while the fixed detector read the procedure as run. The counted run reads exposure with the fixed detector, as the plan says.

## Limits

- The plain and old /cso arms ran about two days before the new arm. Their pins are identical, but provider-side changes in that window can't be ruled out.
- The parent's sessions keep the opened lists they recorded. The miss anatomy for the plain arm and the old /cso baseline reads those lists, not a re-read by the parent's later opened-reader fix; this touches only the miss buckets of 1 plain Opus session and 4 old /cso sessions.
- The comparison with old /cso measures gstack a3ecfd53 against 5afef04e as installed, of which the /cso changes are the named fixes; other skills changed in between.
- 52 units on one model per row: the intervals are wide, and a smaller loss than the observed one could be missed.

## Replicate it

Recount the primary from the published scores, with the plain arm from the parent's results:

~~~bash
jq -s -r '[.[] | select(.arm == "none" or .stage == "rerun")] | group_by(.model)[] | (group_by(.unit) | map(select(length == 2 and all(.[]; .named != null)))) as $p | "\(.[0].model): new cso \([$p[][] | select(.arm == "cso" and .named)] | length)/\($p | length), none \([$p[][] | select(.arm == "none" and .named)] | length)/\($p | length)"' ../2026-11-23-geva-561-cso-advisories-results/stage2-scores.jsonl rerun-scores.jsonl
~~~

and the second family:

~~~bash
jq -s -r '[.[] | select(.arm == "cso")] | group_by(.model)[] | (group_by(.unit) | map(select(length == 2 and all(.[]; .named != null)))) as $p | "\(.[0].model): new cso \([$p[][] | select(.stage == "rerun" and .named)] | length)/\($p | length), old cso \([$p[][] | select(.stage == "stage2" and .named)] | length)/\($p | length)"' ../2026-11-23-geva-561-cso-advisories-results/stage2-scores.jsonl rerun-scores.jsonl
~~~

rerun-analysis.json is the output of `CSO_PLAN=rerun gstack-evals cso rerun-analyze --work <units and the audited trees> --units <the 52 ids> --old-dir <parent export sessions/stage2> --old-scores <parent stage2 scores.jsonl> --sessions <rerun sessions.jsonl> --scores rerun-scores.jsonl --new-dir <rerun sessions dir> --check <pooled check, sealed> --key <readout key> --judged <rerun judged.jsonl> --old-judged <parent judge-s2 judged.jsonl>`. The scripts that ran are in kit/: pilot.sh.txt and judge-pilot.sh.txt (the pilot, its judge gate, scoring and print check), main.sh.txt (admission, the driver and the 104 sessions, four at a time), retry.sh.txt and retry3.sh.txt (the infra retries, as they last launched), judge-main.sh.txt (judging and scoring) and pooled.sh.txt (the pooled judge check). The record leaves out machine setup and the ledger steps that recorded each cap.

## What is held out, and why

Report text and transcripts are not published, for the parent's reason: a report can describe a real, unfixed flaw in a public repository. Score records drop the phantom paths, which come from report text, and keep their counts. The pilot gate file keeps its verdict and drops the per-report rows. Nothing here is a held-out task: every unit is a public advisory and a public commit.

## Changelog

- 2026-11-24: first version.

## Agent notes

- **Spend** for every item is in the experiment's registry row.
- **Custody.** Each streaming of the readout key, the pooled check's sealing and both analysis runs are logged in the Captain drive (handoffs/GEVA-583/CUSTODY.md). The key was removed after each use.
- **Decision trail.** handoffs/GEVA-583/decisions.tsv in the Captain drive.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
