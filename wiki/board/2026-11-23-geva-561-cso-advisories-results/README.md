---
id: 2026-11-23-geva-561-cso-advisories-results
kind: finding
title: "/cso on 52 real security advisories: with /cso typed, Opus 5.5 named 3 of 51 against 12 of 51 for a plain audit request (-17.6 points, 95% interval -31.1 to -5.9); the procedure ran in 37 of 52 sessions, so FIX-METHOD; particle-1 showed no difference"
summary: "52 advisories: Opus with /cso named 3/51 vs plain 12/51, -17.6 [-31.1, -5.9]; procedure ran 37/52, so FIX-METHOD. particle-1 -11.5 [-26.5, +1.9]. Judge kappa 0.975."
author: GEVA-561
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-23
status: done
links:
  - 2026-11-19-geva-561-cso-advisories-prereg
  - 2026-11-21-capy-cso-advisories-deviations
  - lanes/outcome-skills/cso/
attachments:
  - 943cf638d10cd8c9184bf0f3559f744a304273f531f48f9b5a1d8e06f17a0b32  kit/analyze.sh.txt
  - be24a6bb56cf1c2683a5e50f47fd88614124d3329dd4e95996ebe394795489e6  kit/judge-f.sh.txt
  - 30ced9d75f0490096409ab5dde56de2ddca11e5687a646a7fce39cd9b08feaeb  kit/mdd.ts.txt
  - 2baac7754f5eb95259145b863f25909511001f8665644dcaa00a0045bbee03bb  kit/open-s1.ts.txt
  - 36daa8201381963231ddfdcb6b82aa0fbd798fb69c00e5992c57ec7c161b2654  kit/stage2.sh.txt
  - ae7cc5a152c9d4095cb33c6c36c4800443ba66727fe7c7f4a586839b67a83bf3  stage1-outcomes.opened.json
  - bf931411131473236fca45eb3914561391b8af8e35a79793cd8a06e5eb291d3a  stage2-analysis.as-run.json
  - 04b756b6015b9fbfa886746e446fccd314ca654a56e6a4afb86987ab1858167e  stage2-analysis.json
  - 80984c4bae531b91dfca4a52915838d2316c4cf8a9817f0959476a2083b0de5c  stage2-draw.json
  - b5b7899ebb73a4c3aa09280a84ac7f947ef6e4f0e24040f9c152484fd2d016d9  stage2-scores.jsonl
  - 03c098af04a453fd1c7b7350e6b7919ef8cd46c87e90e6a338e09063b9305a5d  stage2-sessions.tsv
  - 6f61ee1bf36554b954eb85346406b3c5d7d1ee039039d0244530e14218e69dc2  unit-build.json
---

# /cso on real security advisories: results

## Takeaways

- **We learned that you can grade a security-audit prompt against real, published vulnerabilities.** Each task is a public repository checked out at the commit just before a GitHub security advisory's fix, and the advisory is the answer key. A judge from another model family (GPT-6.2 Astra) agreed with two-labeller gold labels at kappa 0.975 on 85 reports. **You should test audit prompts and skills this way before you trust them,** because it scores whether the audit found the real bug, not how thorough the report looks.
- **We learned that gstack's /cso, as pinned (gstack 1.101.0.0, /cso 3.0.0), named fewer real advisories than plain Opus 5.5 asked for an audit.** With /cso typed, Opus named the advisory in 3 of 51 audits; with no gstack and a plain request it named 12 of 51: -17.6 points, 95% interval -31.1 to -5.9, Holm p 0.012. /cso reported less than one finding per session against about 15. Its findings were more often real and it cost about a seventh as much per session, but it missed far more. **You should not expect /cso, as pinned, to catch more real vulnerabilities than a plain audit request on Opus 5.5.** The frozen verdict is FIX-METHOD, not a cut, because the /cso procedure ran in only 37 of 52 Opus sessions, under the plan's 80% rule. Had it run in 80% or more, the plan would read this row as Behind and name /cso a cut candidate.
- **We learned that the loss is there where the procedure ran.** In the 37 Opus sessions where the procedure ran, /cso named 2 advisories against 9 for the plain audit on the same units, and 16 of those 37 audits reported no finding at all (an exploratory split, not in the plan, which can't show what /cso would have found where its procedure didn't run). And in 5 of the 10 advisories plain Opus named and /cso missed, the /cso session never opened a file the fix changed (the plan's miss anatomy). On particle-1, /cso named 7 of 52 against 13 of 52, -11.5 points [-26.5, +1.9]: no difference shown. Power at 52 units is thin, so that null reads FIX-METHOD and is not evidence that /cso doesn't help particle-1. **gstack's maintainers should find out why a full /cso run ends with almost no reported findings,** and rerun the cso arm before and after the fix on these 52 units.

Call settled: /cso at gstack 1.101.0.0 is not shown to name more real advisories than plain Opus 5.5 and named fewer, so no gain is claimed and its method goes to a fix first (FIX-METHOD)

## What works

**The measurement.** 208 stage 2 sessions ran on 52 advisories from 38 repositories, every one on its first attempt, with no session gaps, no safety stops and no wall-time limits. One judge reply failed (below). The judge passed its check on the plan's fallback route: GPT-6.2 Astra scored the Opus 5.5 and particle-1 reports at kappa 0.975 on whether a report named the advisory (0.964 on non-anchor reports), 0.863 on whether each finding is supported by the code, and 10 of 10 format pairs. A plain audit request on Opus named about one advisory in four (23.5%), which leaves room above and below, so the test can see both a gain and a loss. If you build agents, this is a test you can reuse for any audit prompt.

**What /cso reports is more often real, and cheap.** On Opus, 12 of /cso's 38 counted findings (31.6%) matched this advisory or another known advisory of the same repository, against 46 of 385 (11.9%) for the plain audit. None of /cso's findings were judged unsupported by the code, against 1.04 per session for the plain audit. A /cso session cost $0.58 on average against $4.11, and took a median 182 seconds against 382. These are pooled descriptive figures over few /cso findings, so read them as direction, not as a measured precision gain.

## What didn't work

**/cso named fewer advisories on Opus.** 3 of 51 against 12 of 51, -17.6 points [-31.1, -5.9]. Ten units were named only by the plain audit and one only by /cso. The loss holds at both gap bounds. Its point estimate is negative in every Opus stratum, and the interval excludes zero in five of the nine (table below).

**It reported almost nothing.** Opus with /cso reported 0.75 findings per session against 14.8, and 0.67 supported findings against 4.73 (-4.06 [-4.71, -3.40]). So /cso didn't only drop false alarms: it dropped real findings too, including the advisory. Across 52 sessions, 23 findings reached the /cso helper, from 12 sessions.

**The procedure didn't always run.** /cso loaded in all 52 Opus sessions, but its helper run started in 39 and the full procedure (start, an inspect or read on that run, and finish) ran in 37 (71%). On particle-1 it ran in 40 of 52 (77%). Both are under the 80% rule, so both rows read "skill not exercised as designed", which the plan maps to FIX-METHOD.

**In half its misses it never opened the files the fix changed.** The plan's miss anatomy classifies every unit one arm named and the other missed, by the first matching cause. Of the 10 advisories plain Opus named and /cso missed, the /cso session never opened a file the fix changed in 5, ended at a limit, a tooling error or a not-assessed helper result in 2, named the right file with another flaw or class in 2, and fit none of the plan's causes in 1. For the one advisory only /cso named, plain Opus named the right file with another flaw or class.

**GPT-6.2 Sol did not run, so /cso is untested on Sol.** The plan made Sol, in Codex CLI, a conditional stage. The owner deferred it until /cso's method is fixed: with the procedure running in under 80% of sessions on both models, a Sol run would most likely read FIX-METHOD too, and the harness can't run /cso sessions in Codex CLI yet.

## Result

### Primary: named rate, stage 2

A session scores "named" when one of its first 10 findings names the advisory's flaw in code the fix changed, as the right kind of weakness, with the mechanism in its own words (prereg section 5). Paired on stage 2 units, cso minus none, with a repository-clustered bootstrap interval and McNemar with clustered variance, Holm over the two models.

| Model | none | cso | cso minus none [95%] | Only none / only cso | Holm p (exact McNemar) | Procedure ran | Row |
|---|---|---|---|---|---|---|---|
| Opus 5.5 | 12/51 (23.5%) | 3/51 (5.9%) | -17.6 [-31.1, -5.9] | 10 / 1 | 0.012 (0.012) | 37/52 (71%) | Skill not exercised as designed |
| particle-1 | 13/52 (25.0%) | 7/52 (13.5%) | -11.5 [-26.5, +1.9] | 9 / 3 | 0.107 (0.146) | 40/52 (77%) | Skill not exercised as designed |

Verdicts (R48), in the plan's order: Opus FIX-METHOD at step 1 (skill not exercised as designed); particle-1 the same. The two models do not split.

**Gap bounds.** One Opus none session (Ghost, GHSA-9m4w-fmjw-fvjq) ended at its allowance and its judge reply came back malformed twice, so that unit leaves the complete pairs. Filling it both ways: -17.3 [-30.6, -6.0] if the plain audit missed it, -19.2 [-33.3, -7.5] if it named it. particle-1 has no gaps.

**Power.** The analysis printed no minimum detectable difference (MDD) for either row, because the plan computes it only for a row that reads no difference shown, and both rows read skill not exercised as designed. Computed after the data with the analysis's own function at the measured discordant shares (11 of 51 units on Opus, 12 of 52 on particle-1; kit/mdd.ts.txt, run from the repository root), the MDD at 0.05 is 20 points on Opus and 21 on particle-1. At 0.025 it is 22 points on particle-1, and on Opus no difference up to the 22% discordant share reaches 80% power. So power at 52 units is thin. The Opus loss showed anyway; the particle-1 interval is not evidence that /cso doesn't help.

### Secondaries

Paired, cso minus none, 95% clustered bootstrap intervals; Opus on 51 units, particle-1 on 52. "Phantom citations" counts file paths anywhere in the report that are not in the audited tree, or lines past a file's end.

| Measure | Opus none | Opus cso | Opus cso minus none | particle-1 none | particle-1 cso | particle-1 cso minus none |
|---|---|---|---|---|---|---|
| Named in the final message | 21.6% | 5.9% | -15.7 [-28.6, -4.1] | 23.1% | 13.5% | -9.6 [-24.0, +3.5] |
| Named a file the fix changed | 43.1% | 7.8% | -35.3 [-50.0, -22.6] | 38.5% | 26.9% | -11.5 [-23.1, 0.0] |
| Findings per session | 14.8 | 0.75 | -14.1 [-20.1, -9.5] | 14.3 | 2.0 | -12.3 [-17.5, -8.3] |
| Supported findings per session | 4.73 | 0.67 | -4.06 [-4.71, -3.40] | 4.65 | 1.56 | -3.10 [-4.12, -2.09] |
| Unsupported findings per session | 1.04 | 0.00 | -1.04 [-1.62, -0.58] | 0.60 | 0.12 | -0.48 [-0.85, -0.20] |
| Can't-tell findings per session | 1.78 | 0.08 | -1.71 [-2.16, -1.26] | 1.35 | 0.35 | -1.00 [-1.47, -0.57] |
| Phantom citations per session | 10.7 | 4.8 | -5.9 [-8.4, -3.5] | 25.8 | 19.8 | -6.0 [-13.4, +1.0] |
| Cost per session | $3.90 | $0.58 | -$3.32 [-4.34, -2.25] | $1.51 | $0.18 | -$1.33 [-1.67, -0.96] |

Pooled over counted findings (the first 10 per session), not paired:

| Precision | Opus none | Opus cso | particle-1 none | particle-1 cso |
|---|---|---|---|---|
| Matches this advisory | 13/385 (3.4%) | 3/38 (7.9%) | 14/343 (4.1%) | 7/105 (6.7%) |
| Matches this or another known advisory of the repository | 46/385 (11.9%) | 12/38 (31.6%) | 52/343 (15.2%) | 21/105 (20.0%) |
| Sessions with more than 10 findings | 43.1% | 0% | 55.8% | 0% |

No session hit a safety stop or the wall limit. Opus none: 51 completed, 1 at its allowance. particle-1 none: 36 completed, 11 at the allowance, 5 at the turn limit. Every cso session completed.

### Exposure: did /cso run?

| | Opus 5.5 | particle-1 |
|---|---|---|
| /cso skill loaded | 52/52 | 52/52 |
| Helper run started | 39/52 | 43/52 |
| Procedure ran (start, inspect or read, finish) | 37/52 (71%) | 40/52 (77%) |
| Helper completeness at finish | partial 23, not assessed 1, none recorded 28 | partial 39, none recorded 13 |
| Findings submitted to the helper | 23, from 12 sessions (18 from 9 as recorded in stage2-sessions.tsv; method notes) | 65, from 24 sessions |
| Helper tooling errors | 13, in 12 sessions | 12, in 10 sessions |
| Host file reads after the helper started (the skill forbids them) | 80, in 28 sessions | 1,362, in 41 sessions |
| Helper scope where it started | daily (default) in all 39 | daily (default) in all 43 |

**Exploratory split, not in the plan.** Named rate on the cso arm by whether the procedure ran:

| | Procedure ran | Did not run |
|---|---|---|
| Opus 5.5: named | 2/37 | 1/15 |
| Opus 5.5: sessions with no finding | 16/37 | 14/15 |
| Opus 5.5: findings per session | 1.0 | 0.07 |
| particle-1: named | 5/40 | 2/12 |
| particle-1: sessions with no finding | 14/40 | 7/12 |
| particle-1: findings per session | 2.2 | 1.3 |

On the 37 units where /cso ran as designed, Opus named 2; the plain audit named 9 of those same 37. The split is descriptive: it can't show what /cso would have found on the 15 units where its procedure didn't run.

### Strata (named, cso minus none)

Descriptive, unadjusted. Maven and NuGet had one unit each and are left out.

| Stratum | Opus 5.5 | n | particle-1 | n |
|---|---|---|---|---|
| Part 1 (units from the earlier skill-pack comparison) | -10.0 [-26.9, +3.2] | 30 | -16.7 [-36.4, 0.0] | 30 |
| Part 2 (added for this eval) | -28.6 [-47.8, -9.5] | 21 | -4.5 [-25.0, +14.3] | 22 |
| Library | -15.8 [-31.4, -2.5] | 38 | -12.8 [-30.3, +2.5] | 39 |
| Service (Dockerfile or compose file at the root) | -23.1 [-54.5, 0.0] | 13 | -7.7 [-36.4, +18.2] | 13 |
| Repository at or below the median size | -11.5 [-30.4, +3.7] | 26 | -26.9 [-48.0, -8.7] | 26 |
| Repository above the median size | -24.0 [-45.0, -8.0] | 25 | +3.8 [-13.0, +20.8] | 26 |
| Published from 2026-10-01 | -18.9 [-35.3, -5.0] | 37 | -7.9 [-22.2, +5.1] | 38 |
| Go | -18.2 [-36.8, -4.2] | 22 | -4.5 [-26.3, +14.3] | 22 |
| npm | -14.8 [-34.8, 0.0] | 27 | -21.4 [-41.7, -6.3] | 28 |

Every unit's advisory was published, and its fix committed, on or after 2026-07-01, after Opus 5.5's stated training cutoff (June 2026), so the cutoff split has nothing before it. particle-1 has no published cutoff.

### Miss anatomy

For every unit one arm named and the other missed, the missing session's first matching cause, in the plan's order. "Opened" counts files the session read, through its own tools or the /cso helper, helper reads inside a shell for loop included. The run's analysis printed this frozen secondary empty, because the command never passed it on; it was printed after the run once the command read the judged rows, from opened lists read again with a reader fixed to follow those loops (method notes below). Every other figure in the analysis is identical to the run's.

| Cause | Opus: /cso missed, plain named (10) | Opus: plain missed, /cso named (1) | particle-1: /cso missed, plain named (9) | particle-1: plain missed, /cso named (3) |
|---|---|---|---|---|
| Safety stop | 0 | 0 | 0 | 0 |
| Limit, tooling error or a helper result of not assessed | 2 | 0 | 1 | 1 |
| Never opened a file the fix changed | 5 | 0 | 1 | 0 |
| Opened a fix file, but the report doesn't name it | 0 | 0 | 3 | 0 |
| Named the fix file with another flaw or class | 2 | 1 | 3 | 1 |
| Named the flaw outside the first 10 findings | 0 | 0 | 0 | 1 |
| None of these | 1 | 0 | 1 | 0 |

On Opus, half the advisories /cso missed are ones its session never read: the plain audit opened the vulnerable file and named the flaw, and /cso never opened it. The one particle-1 session still counted as never opening its fix file did read it, through a shell while loop over a generated file list, which the reader does not follow.

### Stage 1, opened after stage 2's analysis

Stage 1 (12 pilot units, five cells) never enters the confirmatory analysis. Its per-arm outcomes stayed sealed until stage 2's analysis ran, and were opened against the recorded sha256. Descriptive only:

| Cell | Named | Findings per scored session |
|---|---|---|
| Opus 5.5 none | 3 of 11 scored (1 gap) | 12.6 |
| Opus 5.5 cso | 3/12 | 1.1 |
| Opus 5.5 untold (gstack installed, /cso not typed) | 4/12 | 6.0 |
| particle-1 none | 6/12 | 23.1 |
| particle-1 cso | 4/12 | 2.0 |

The same pattern shows at pilot size: /cso reports far fewer findings. Installing gstack without typing /cso (untold) named 4 of 12, against 3 of 11 with no gstack.

### Session cost and time

| Cell | Mean cost | Median cost | Median wall time |
|---|---|---|---|
| Opus 5.5 none | $4.11 | $3.97 | 382 s |
| Opus 5.5 cso | $0.58 | $0.57 | 182 s |
| particle-1 none | $1.51 | $1.47 | 642 s |
| particle-1 cso | $0.18 | $0.12 | 367 s |

Costs are the metering proxy's figures at the list prices in src/runner/pricing/prices.ts on 2026-11-22. Opus 5.5 had a $16 allowance per session in stage 2 and particle-1 $3.

## The judge check (R78)

The plan names Gemini 4 Carbon as the production judge, checked on the stage 0 and stage 1 reports against gold labels from two other models, with GPT-6.2 Astra as the fallback. Both routes were checked on the same reports.

| Route | Gold reports (named / not) | Kappa, named | Kappa, named, non-anchor | Kappa, finding supported | Format pairs | Judge gaps |
|---|---|---|---|---|---|---|
| Gemini 4 Carbon (production; gold by GPT-6.2 Astra and Opus 5.5) | 89 (31 / 58) | 0.703 | 0.812 | 0.584 | 8 of 10 | 1 |
| GPT-6.2 Astra (fallback; gold by Opus 5.5 and Gemini 4 Argon) | 85 (32 / 53) | 0.975 | 0.964 | 0.863 | 10 of 10 | 0 |

Carbon gave the same named label to 8 of the 10 format pairs (a table row and a prose paragraph holding the same finding), under the 9 the plan requires, so the fallback route ran; its supported label also missed the 0.6 floor. Astra passed every gate, including no near miss scored as a hit in 20 of 20, so Astra judged stage 1 and stage 2. Astra is an OpenAI model and scores Anthropic and Particle models, so the judge's family differs from every model it scores. The plan was frozen on 2026-11-19, so its floor is 40 labelled reports; the check used 85. Per-arm disagreement on the fallback route: 0 on cso reports, 0.045 on none reports. In stage 2, Astra made 349 calls and returned one malformed reply twice (the gap above).

## Why null? (R48)

This covers the Opus loss and the particle-1 null.

- **Exposure.** /cso loaded every time, but the full procedure ran in 71% of Opus sessions and 77% of particle-1 sessions, under the 80% rule, so neither row can carry a cut. In the exploratory split, completed runs named 2 of 37 on Opus against 9 of 37 for the plain audit on the same units; the split is descriptive and can't show what the skipped runs would have found. The miss anatomy says where it goes wrong: in 5 of the 10 advisories /cso missed on Opus, its session never opened a file the fix changed.
- **Task fit.** The plan flagged that libraries may suit /cso's application-security model badly. In the descriptive strata, the Opus loss shows in both libraries (38 units, -15.8 [-31.4, -2.5]) and services (a subgroup of 13 units, -23.1 [-54.5, 0.0]). That is descriptive, with no interaction test, and the service interval reaches zero, so it suggests rather than shows that task fit doesn't explain the loss.
- **Power and headroom.** The plain audit named 23.5% on Opus and 25.0% on particle-1, so there was room to gain. Power at 52 units is thin (computed after the data, the MDD at 0.05 is about 20 points), which is why the particle-1 null says nothing about /cso on particle-1. The Opus loss showed anyway.
- **Does Opus do it unaided?** Partly. A plain audit request found about one advisory in four. /cso found about one in seventeen.

Verdict: FIX-METHOD on both models. Had the procedure run in 80% of Opus sessions, the same numbers would read Behind, which the plan maps to CUT-CANDIDATE.

## The one next step

Find out why a full /cso run on Opus reports almost nothing and often never reads the vulnerable code: in 5 of the 10 advisories plain Opus named and /cso missed, /cso never opened a file the fix changed, and the procedure stopped short in 15 of 52 sessions. That question goes to gstack's maintainer. A fix to /cso gets a before-and-after rerun of the cso arm on these 52 units, with its own spend line. Running GPT-6.2 Sol or more units first would most likely read FIX-METHOD again.

## Setup

- **Tasks.** 52 stage 2 units, drawn in the plan's order from reviewed GitHub advisories (advisory-database at a91f5a5) published from 2026-07-01 to 2026-10-31, each with a fix that changes at least one test file and 1 to 6 non-test source files. The 52 are Go (22), npm (28), Maven (1) and NuGet (1). Each unit is the repository at the fix's parent commit, as one fresh commit with no history, with CLAUDE.md, AGENTS.md and .claude/ stripped, and with no file naming the advisory's GHSA id, a CVE id or the fix commit. Units whose ids appear in gstack's own install, or whose affected package sits in gstack's installed dependencies at or past the fixed version, were dropped from every cell before the draw (deviations (a) and (c)). unit-build.json holds the gate result for every candidate.
- **Arms.** none: no gstack installed, first turn T. cso: gstack installed at 5afef04e (1.101.0.0, /cso skill 3.0.0, helper gstack-cso 3.0.0), first turn "/cso " followed by T. T is identical in every arm: "Run a security audit of this repository. Look for vulnerabilities an attacker could exploit. Don't stop to ask. When you are done, write the full report in your final message: every finding with its file path and line numbers, the kind of weakness, and how an attacker would exploit it. End your last message with DONE on its own line."
- **Models and harness.** Opus 5.5 (claude-opus-5-5, Anthropic API) and particle-1 (particle-ai/particle-1 through OpenRouter, provider fixed to Particle AI) in Claude Code 2.1.325, as every session record shows. Limits: 2,700 seconds, 200 turns, and an allowance of $16 for Opus (doubled from $8 because stage 1's 95th-percentile cost passed half of it) and $3 for particle-1.
- **Order.** Each unit's four cells ran in a seeded shuffle (order_seed 2307533522), four sessions at a time, so a unit's cells ran close together. stage2-draw.json holds the units and the order.
- **Scoring.** Pass A (key-blind) lists each report's findings; pass B checks the first 10 against the advisory for location, weakness class, same defect and grounding, and labels each finding supported, unsupported or can't tell. Phantom citations and cost are counted by code.
- **Interim look.** Stage 2 was priced under $500 paid, so it took no interim look.

## Method notes and deviations

Every change below was made before the data it touches, in the deviations post linked above:

- (a) containment also scans each arm's gstack install; (c) units whose affected package sits in gstack's installed dependencies at or past the fixed version drop from every cell (16 by name, plus a gate);
- (b) stage 1 released only pass or fail from the judge check;
- (d) the judge runs at medium effort with a 65,536-token output cap;
- three harness repairs after stage 0, including the exposure detector reading launcher calls made through shell variables;
- (e) repairs found in stage 1's readout: the check's own items, pass B's known field and the session image tag;
- the stage 2 setup: the seeded order, the two flags that pass Opus's doubled allowance, and the re-priced caps.

Three changes came after the data, and the deviations post records them as dated notes. The run's analysis printed the frozen miss anatomy empty, because `cso analyze` never passed it on; the command now reads the judged rows (`--judged`) and prints it. Review of this write-up then found two transcript readers short. The reader behind the miss anatomy's opened list skipped helper reads written inside a shell for loop (`for f in a.go b.go; do <helper> read <run> $f; done`), so it counted files some sessions read as never opened; it now follows those loops, each stage 2 session's opened list was read again from its transcript, and the analysis was printed again from those lists. And the count of findings submitted to the helper took the finish's output when a submit and a finish ran in one command, so three Opus sessions (Arcane GHSA-pw5q-rjx4-7f7p, Quasar GHSA-r5mf-4r5x-q78f and serialize-javascript GHSA-m5mm-p8h7-m29v) recorded 0 where the helper accepted 1, 2 and 2. The exposure table gives the count read again; stage2-sessions.tsv keeps the recorded values. No outcome changes: the analysis matches the run's in every field but the miss anatomy, and no row, verdict or gate reads the submission count. The 16 audited trees the misses need were rebuilt from their public parent commits, and each matches its recorded hash.

Stage 1's first two readouts stopped stage 2. The first stopped on the judge's format pairs, session gaps, exposure and the plain-audit floor, which led to the repairs in (e) and a re-pilot of the two sessions lost to gaps. The second stopped on the production judge's format pairs, which led to the fallback judge check. The third readout read only exposure, which the owner ruled a result to report beside every verdict, and cost. Stage 1 data from the first two readouts stays sealed. The work moved to a second host once, during the fallback judge check. The rest of that check and all of stage 2 ran there; its cso install carries gstack's three pinned /cso files byte for byte.

## Limits

- **Power.** At 52 units, differences under about 20 points can be missed (the MDD at 0.05, computed after the data). The particle-1 null is not evidence either way.
- **One flaw per unit.** A report that finds other real flaws gets no main-score credit for them. The known-advisory precision and the supported count carry that, and this eval doesn't verify or disclose findings that match no known advisory.
- **The judge reads excerpts, not running code,** so "supported" is a reading, not a reproduction.
- **Construct.** One whole-repository audit per session, in /cso's default daily mode. /cso's comprehensive mode, scope flags and scanners are untested.
- **Pinned versions.** gstack 1.101.0.0 and Claude Code 2.1.325. Later /cso versions may behave differently.
- **Contamination.** Every unit is after Opus 5.5's stated cutoff; particle-1's cutoff is unknown.
- **The exposure split is exploratory,** and the miss anatomy names only the first matching cause of each miss. Its opened reader doesn't follow a shell while loop over a generated file list, so one particle-1 session that read its fix file that way still counts as never opening it.
- **Not read for severity.** Nobody has read the supported findings that match no known advisory for severity. The plan sends anything that looks severe to the eval's owner; that read is not done.

## Replicate it

Recount the primary from the published scores, paired by unit: a unit counts only when both arms were scored, so Opus's one judge gap leaves 51 pairs.

~~~bash
jq -s -r 'group_by(.model)[] | (group_by(.unit) | map(select(length == 2 and all(.[]; .named != null)))) as $p | "\(.[0].model): cso \([$p[][] | select(.arm == "cso" and .named)] | length)/\($p | length), none \([$p[][] | select(.arm == "none" and .named)] | length)/\($p | length)"' stage2-scores.jsonl
~~~

Recount the exploratory split from the session table and the scores. It prints each arm's named count on the units where /cso's procedure ran or didn't; the plain audit's judge gap is on an Opus unit where the procedure didn't run, so that row has 14 scored units.

~~~bash
jq -r '"\(.unit)|\(.model)\t\(.arm)\t\(.named)"' stage2-scores.jsonl |
  awk -F'\t' 'NR == FNR { if (FNR > 1 && $3 == "cso") ran[$1 "|" $2] = $12; next }
    $3 != "null" { split($1, a, "|"); k = a[2] " ran=" ran[$1] " " $2; n[k]++; if ($3 == "true") h[k]++ }
    END { for (k in n) print k, h[k] + 0 "/" n[k] }' stage2-sessions.tsv - | sort
~~~

stage2-analysis.as-run.json is the analysis command's output as it ran. stage2-analysis.json is the same command after the miss anatomy wiring and the opened reader fix, identical but for its miss fields; it ran as `cso analyze --work <units and trees> --sessions <sessions.jsonl with each opened list read again from its transcript> --scores scores.jsonl --judged judged.jsonl --units <stage 2 ids> --check check-production.sealed --check check-fallback-opus-particle.sealed --key <readout key> --headroom-admitted`. The scripts that ran stage 2 and the analysis are in kit/: stage2.sh.txt (admission, the driver, 208 sessions, judging and scoring), judge-f.sh.txt (the fallback judge check and stage 1's judging), analyze.sh.txt and open-s1.ts.txt (the analysis and the opening of stage 1's sealed file; the published open-s1 has its import's absolute host path made relative to the repository root, and nothing else changed). mdd.ts.txt computed the MDD after the data; its import is made relative the same way. That record leaves out the unit build, the arm installs, the host setup and the spend approvals, which the plan's harness section and the deviations post describe. A rerun of the sessions needs model keys and spends money: `bin/gstack-evals cso units`, `cso draw`, `outcome serve` and `cso rerun` rebuild and run it, then `cso judge --route fallback-opus-particle`, `cso score` and `cso analyze`.

## What is held out, and why

Report text and transcripts are not published. A report can describe a real, unfixed vulnerability in a public repository, and publishing that before its maintainer fixes it would be irresponsible. Score records drop the phantom paths, which come from report text, and keep only their counts. The sealed export holds the texts. Nothing in this eval is a held-out task: every unit is a public advisory and a public commit.

## Changelog

- 2026-11-23: first version.

## Agent notes

- **Miss anatomy wiring.** `cso analyze` called `secondaries(i, p)` without the per-session miss map, so the frozen secondary printed empty in the run's analysis. It now takes `--judged` and builds the map with `missMap` (lanes/outcome-skills/cso/analysis/secondaries.ts). The re-run read stage 2's sessions, scores and judged rows from the export in the Captain drive (handoffs/GEVA-561/export-2026-11-23, digests checked against its manifests), and the two sealed checks with the readout key in /dev/shm (logged in CUSTODY.md, key removed after). It also read the 16 audited trees the misses need, rebuilt from their public parent commits with build.ts's sessionTree, each matching its recorded tree_sha256.
- **Readers fixed after review.** Capy's review of #443 found the opened reader and the submission count short. `openedPaths` now unrolls `for V in WORDS` loops before matching helper reads (it also stops a read's path at `;`, `&`, `|`, `<` or `>`), which moved 2 Opus and 2 particle-1 misses out of never opened; the old reader reproduces all 208 recorded opened lists and the new one changes 90 cso lists. The re-read lists stay on the Capy machine with the transcripts, and analyze ran again under the same custody (logged in CUSTODY.md). A second review found the loop reader blind to a loop inside a loop and to glob words; `openedPaths` now writes out innermost loops first, and `missAnatomy` matches a glob word in opened against the fix files. At this head the reader re-reads all 208 stage 2 lists exactly as the analysis used them, and the glob match moves none of the 23 missed sessions. `csoExposure` reads a batched submit's own count through `helperObjects`; recounted over the 104 cso transcripts it changes only the three Opus sessions named in the method notes. `missAnatomy` resolves handles and snapshot-rooted paths in opened, which changes no stage 2 session. `cso stage0` now refuses a sessions file whose stage 0 units don't number the plan's stage 0 positions; stage 0 ran with both. A third review found `readTree` reading a symlink whose target lies outside the audited tree; it now keeps only links that resolve inside it. The parent commits of all 134 built units hold 241 symlinks, all inside their trees, so no tree, citation or judge excerpt changes.
- **Custody.** Every key streaming, sealed opening and teardown for this run is logged in the Captain drive (handoffs/GEVA-561/CUSTODY.md). Stage 1's third readout was opened against 7f271d3d, and the key was removed after each use.
- **Spend** for every item is in the experiment's registry row.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
