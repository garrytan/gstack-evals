---
id: 2026-11-07-geva-380-r3c-results
kind: finding
title: "R3c: on Opus 5.5 tasks it solves about half the time, told /investigate showed no gain we could detect over no skill (+2.8 points, 95% CI -5.8 to +11.4, MDD 10), FIX-METHOD (power)"
summary: "R3c on Opus 5.5, 18 calibrated tasks x 20: none 47.2%, told 50.0%, +2.8 points [-5.8, +11.4], MDD 10, exposure 99.4%. FIX-METHOD (power)."
author: GEVA-380
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-07
status: done
links:
  - 2026-11-05-geva-284-r3c-calibrated
  - 2026-11-05-geva-310-r3c-pin
  - 2026-11-04-geva-283-r3b-results
  - 2026-11-04-geva-263-r3a4-admission-results
  - 2026-11-03-geva-239-r3a-saturation-results
  - 2026-11-05-geva-292-difficulty-ladder
  - garrytan/gstack-evals#220
  - garrytan/gstack-evals#226
  - garrytan/gstack-evals#234
---

# R3c: told /investigate on Opus 5.5, on tasks with measured headroom

Publication status: unpublished. This is the record of a preregistered run. Done: calibration, admission, the grid, analyze and this file. Still open before any public use: a cross-family claim check against the run record and a recount by another Captain's crew.

| Field | Value |
|---|---|
| Grade | A preregistered comparison (R3c) on one model that ended in a null. It claims no effect of /investigate in either direction. |
| Prereg | [R3 amendment 6](../plans/2026-11-05-geva-284-r3c-calibrated/README.md) (#220), which amends section 4 of [the R48 follow-ups prereg](../plans/2026-11-01-geva-101-r48-follow-ups-prereg/README.md) as amended through [amendment 5](../plans/2026-11-04-geva-263-r3-amendment-5/README.md) and [the D1 fix](../plans/2026-11-04-geva-264-r3-d1-task-fit-fix/README.md) |
| Repo commit | Build 239d227df569640e68058de52ee79c98d5ae114d (#226), named in [the R3c pin post](../plans/2026-11-05-geva-310-r3c-pin/README.md) (#234) and run from a git archive export of it |
| Data | The run record in the gstack-evals Captain's drive (handoffs/GEVA-323/) and its rerun inputs with the transcript archive in the project drive. They are not public, because they hold model transcripts. This file publishes counts and digests only. |
| Reviewed by | /ship review of this file, recorded in the pull request |
| Reproduced by | Not reproduced by another crew. The run thread reran analyze from its exported inputs and got analyze.out back byte for byte. |

## What we found

R3 asks whether gstack's /investigate, named in the prompt ("told"), helps a frontier model fix real bugs. R3a's tasks sat at Opus 5.5's ceiling and R3b's at its floor. R3c measured each candidate task's none rate first and kept only tasks Opus solves sometimes but not always.

On those tasks, told /investigate did not beat no skill by an amount we could detect. With no skill (none), Opus 5.5 passed 170 of 360 trials (47.2%). Told, it passed 180 of 360 (50.0%). Told minus none is +2.8 points (95% CI -5.8 to +11.4) on 18 paired tasks. The smallest lift the grid could detect (the MDD, frozen at admission) is 10 points. So the run rules out a lift much above 11 points and a loss much beyond 6, and it can't tell a lift of about 3 points from zero.

The skill was in play. The told arm showed the procedure in 358 of 360 trials (99.4%, against a 90% gate), and no session in either arm hit its spending allowance. The frozen rule reads FIX-METHOD (power): the primary is above zero and its interval includes zero. It is not a CUT-CANDIDATE.

Told costs more. A told trial cost about 1.52 times a none trial, and a pass cost about 43% more told than none.

## How it works

This section is an explanation, not a result.

Calibration fixed R3b's floor. R3c spent 442 none trials measuring 201 candidate tasks and kept the 18 whose measured none rate fell inside 20% to 80%. Admission's posterior put their mean none rate at 51.2%, and the grid measured 47.2%. That is neither a floor nor a ceiling, so a debugging procedure had room to turn fails into passes.

It mostly didn't. One reason fits the report-only localization lines. Every arm ended its last message with a ROOT CAUSE FILES block, and plain Opus put a root-cause file first in 88.6% of none trials. Since none passed only 170 of 360, at least 149 of its 190 failed trials named a root-cause file first. On these tasks plain Opus usually finds where the bug is, and most failures come later, in the fix. /investigate's procedure is about finding the root cause before fixing, so it has little room left to work in here. This reading comes from report-only lines, and the run was not built to test it.

## Setup

- **Question.** On Opus 5.5 SWE-rebench tasks whose measured none rate is inside [0.2, 0.8], does told /investigate pass more trials than none? (Amendment 6 sections 5 to 7.)
- **Arms.** none: no gstack, an empty skills directory (tar 8bab4833) and the plain task prompt. told: R3b's told arm unchanged, gstack 699a41cb as its ./setup ships it with the route hook, the contract Stop hook and timeline-stop-hook registered (tar e93a3aa4), and the prompt prefixed by /investigate and followed by the procedure line. Every arm's prompt ends with the same closing line, which asks for up to three ranked root-cause files in a ROOT CAUSE FILES block. Every arm sets CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1. The analysis names the told arm gstack.
- **Model.** The details are in Agent notes.
- **Harness.** Lane B's runner at 239d227. Each part ran on its own Ubicloud standard-16 VM in eu-central-h1, six trials at a time, one part at a time, with the run-time oracle gate on. The controller ran on its own standard-2 host that stayed awake for the whole run (30.0 hours).
- **Candidates.** 201 tasks in four tiers from R3a4's SWE-rebench pool (sorted ids sha256 7a2b33c723b14ae97c4d8286a42bc5d914ffe2d856eb1ef42b50e1dcddfd1d27). SWE-rebench is the work of Nebius AI R&D, used under CC-BY-4.0.
- **Calibration.** cal-1a to cal-1c ran 438 none trials by tier, and cal-2 ran 4 more on the one t4 task that failed its cal-1 trial. All 442 were graded, and 308 passed.
- **Admission.** `r3c.ts admit` refitted the task law on every Opus none trial and kept 18 tasks in the band (list sha256 e5727033c05e649b04da006a1973c8025976e334579c8ef2f9c52bed32b0ef23, 4 of them far tasks). The prereg forecast 16.7 (p10 13, p90 21). It priced a task-replicate pair (the price is in Agent notes), found 24 replicates affordable, and chose 20, with a frozen MDD of 10 points and a null size of 4.1%. The Captain approved the grid as admitted.
- **Grid.** 18 tasks x 20 replicates x {none, told}, 720 trials, in five parts of 4 replicates. Each part ran every task 4 times in each arm, in one seeded shuffle of task and arm (seed 20261113), so both arms shared each part's VM and hours.
- **Grading.** A trial passes when the task's own tests pass in the separate verifier. A told trial is exposed when it opened /investigate and its own text matches DEBUG REPORT or a "Phase 1" to "Phase 5" heading.
- **Outcome rule.** analyze()'s task-clustered paired bootstrap of told minus none, 10,000 draws, seed 20261101. After the 90% exposure gate, the truncation bound and the infra bounds: a 95% interval above zero is KEEP. A primary above zero whose interval includes zero is FIX-METHOD (power). A primary at or below zero is CUT-CANDIDATE when the D1 contrast is also at or below zero and the D1 set holds at least ceil(3n/7) tasks, and otherwise FIX-METHOD (task fit).
- **Dates.** Calibration ran from 20:20Z on 2026-11-05 to 08:20Z on 2026-11-06. The grid ran from 08:24Z on 2026-11-06 to 02:05Z on 2026-11-07, and analyze at 02:10Z.

## Result

analyze's lines, exactly as printed, with two changes: the admit line's path on the controller host is written as `<work dir>`, and three lines of dollar amounts, the cost per success line and the GO line's closing dollar projection are in Agent notes instead. It exited 5, its code for an outcome other than KEEP or CUT-CANDIDATE. The frozen lines are the grid counts, exposure, allowance stops, the primary, D1 and the outcome. Every line marked "report only" decides nothing. The admit lines near the top were frozen at admission, before any grid trial.

```text
oracle per-test (report only): 405 oracle trials, 405 score f2pShare 1 and 0 score null
calibration: 442 none trials, 442 graded, 308 passed
admit: bun quick/laneb/r3/r3c-rules.ts admit <INHAND> --model opus --calibration <work dir>/calibration.jsonl --cap-usd 750 --settled-usd 159.813435
r3c admission opus: 18 tasks admitted (sha256 e5727033c05e649b04da006a1973c8025976e334579c8ef2f9c52bed32b0ef23; 4 far) from 442 calibration none trials; refitted band mass 12.4%, mean posterior none rate 0.512
report only, beta-binomial law (a 0.088, b 0.051, band mass 8.5%): MDD 10 points, null size 4.5% at 20 replicates
R3c grid for opus: GO with 18 tasks x 20 replicates x {none, told}; MDD 10 points (16 if the lift sits on half the tasks, report only); null size 4.1%
grid: none 170 of 360 graded trials passed (control rate 47.2%), told 180 of 360 (50.0%); 18 paired tasks of 18 admitted
exposure: 358 of 360 graded told grid trials exposed (99.4%; the gate needs 90%)
allowance stops: told 0 of 360 sessions (0.0%), none 0 of 360 (0.0%), infra included; the truncation bound is 5 points
primary: told minus none +2.8 points (95% CI -5.8 to +11.4) on 18 paired tasks
D1 sensitivity: 17 paired tasks solved by at least one graded grid trial in either arm, against ceil(3n/7) = 8 at n = 18; told minus none +2.9 points (95% CI -6.2 to +11.8) on them
frozen MDD (report only): 10 points at 18 tasks x 20 replicates (16 if the lift sits on half the tasks); beta-binomial law: MDD 10 points, null size 4.5%
MDD re-simulated at the grid's own none rates (report only): 10 points at 20 replicates on 18 tasks, 2000 simulated grids a lift
task fit (report only): the grid's none arm puts 5 of 18 admitted tasks outside the band [0.2, 0.8] (27.8%)
far tasks (report only): told minus none +8.8 points (95% CI -10.0 to +33.8) on 4 paired far tasks
Stop hook (report only): ran in 358 of 360 graded told grid trials and held a stop back in 100; the route hook logged in 360
localization (report only): a closing block in none 99.7% and told 99.4% of graded trials; hit@1 none 88.6%, told 92.8%; hit@3 none 91.7%, told 93.6% (360 and 360 trials scored; 0 tasks out of the measure with no root-cause file)
localization lifts (report only): hit@1 +4.2 points (95% CI -0.8 to +10.8), hit@3 +1.9 points (95% CI -0.8 to +6.7), locRank +3.5 points (95% CI -0.6 to +9.4) (locRank none 0.896, told 0.931)
told localization by Stop hook (report only): held a stop back 100 trials, hit@1 98.0%, hit@3 99.0%; did not 260 trials, hit@1 90.8%, hit@3 91.5%
f2pShare (report only): none 0.526, told 0.551 (null, out of the measure: none 0, told 0); told minus none +2.5 points (95% CI -6.7 to +11.4)
R3c outcome for Opus 5.5: FIX-METHOD (power). Told minus none is +2.8 points (95% CI -5.8 to +11.4): above zero, with an interval that includes zero.
```

Counts from the run's record.json and trials.tsv:

| | none | told |
|---|---|---|
| Grid trials (infra) | 360 (0) | 360 (0) |
| Passed | 170 (47.2%) | 180 (50.0%) |
| Passes by part: grid-1 to grid-5, of 72 each | 29, 31, 33, 37, 40 | 38, 37, 39, 33, 33 |
| Agent timeouts (all graded) | 2 | 2 |
| Allowance stops | 0 | 0 |
| Told trials exposed (gate 90%) | | 358 of 360 (99.4%) |
| Primary, told minus none (95% CI) | +2.8 points (-5.8 to +11.4) on 18 tasks | |
| D1 set: tasks solved by any grid trial | 17 of 18 (8 needed) | |
| D1 contrast (95% CI) | +2.9 points (-6.2 to +11.8) | |
| MDD (frozen at admission), and re-simulated at the grid's none rates | 10 points, 10 points | |
| Outcome | FIX-METHOD (power) | |

The two told trials that weren't exposed are the arm's two agent timeouts. Both opened /investigate and loaded the skill body, and both timed out before the Stop hook ran. Both passed the hidden tests.

### Report-only lines

These are analyze's own report-only lines. They decide nothing.

- **Localization.** A ROOT CAUSE FILES block appeared in 99.7% of none trials and 99.4% of told trials. hit@1 was 88.6% none and 92.8% told, a lift of +4.2 points (95% CI -0.8 to +10.8). hit@3 lift +1.9 (-0.8 to +6.7), locRank lift +3.5 (-0.6 to +9.4).
- **The Stop hook.** It ran in 358 of 360 told trials and held a stop back in 100. Those 100 trials had hit@1 98.0%, against 90.8% for the other 260. That split compares different trials, chosen by whether the hook fired, so it does not measure what the hook did.
- **Far tasks.** On the 4 tasks whose issue text names neither a patched file nor a patched function, told minus none was +8.8 points (95% CI -10.0 to +33.8).
- **f2pShare.** The share of FAIL_TO_PASS tests passing under the PASS_TO_PASS gate was 0.526 none and 0.551 told, +2.5 points (-6.7 to +11.4).
- **Task fit.** The grid's none arm put 5 of the 18 admitted tasks outside [0.2, 0.8].
- **Cost per success.** Told cost about 43% more per success than none. The figures are in Agent notes.
- **Oracle.** 405 of 405 oracle trials scored f2pShare 1.

### Tallies from the run's records (not frozen)

The run thread counted these from trials.tsv after analyze. No rule names them.

- **Phase headings.** 0 of 360 told trials wrote a "Phase 1" to "Phase 5" heading, the same as R3b. Exposure here means the DEBUG REPORT was visible, which the contract Stop hook also demands. The pinned skill no longer numbers its phases.
- **Contract outcomes on told.** Met 258, met after a block 55, miss 45, and 2 with no outcome (the two timeouts).
- **Per task.** Told passed more trials than none on 10 tasks, fewer on 6, and the same on 2.
- **Order drift.** none's passes rose across the five parts while told's fell. The exploratory check below looks at it.

## Why null? (R48)

- **Exposure is not the cause.** The told arm showed the procedure in 358 of 360 trials, the skill body loaded in all 360, and the route hook logged in all 360. What "shown" means is narrow: a DEBUG REPORT, partly because the Stop hook asks for one. No told trial wrote a numbered phase heading, so the run can't say how much of the procedure ran.
- **Task fit worked.** The tasks were chosen by a measured none rate, and the grid's none rate (47.2%) landed near admission's estimate (51.2%). 17 of 18 tasks were solved at least once, against R3b's 15 of 70 for Opus. 5 of 18 tasks fell outside the band in the grid's none arm (report only). That is close to what the prereg expected: its forecast put 83% of admitted tasks truly in the band, and 20 trials measure each task with noise.
- **Power is the limit.** The frozen MDD is 10 points, and a re-simulation at the grid's own none rates also gives 10. The observed +2.8 is well under it. The control rate is 47.2%, so this is neither a floor nor a ceiling, and saturation does not explain the null. The interval rules out a lift above about 11 points. It can rule out neither zero nor a lift of 3 to 5 points.
- **Plain Opus does much of the job.** With no skill, Opus 5.5 solves about half of these calibrated tasks, and it names a root-cause file first in 88.6% of trials (report only). On these tasks plain Opus already does most of the time the step /investigate teaches, finding the root cause.
- **Cost.** Told costs 1.52 times as much per trial in model spend and about 43% more per success.

So the R48 verdict is **FIX-METHOD (power)**, as the frozen rule reads it. The method to fix is the size of the test: a much larger grid, or a primary with less noise. Nothing here is a CUT-CANDIDATE, and nothing here says /investigate should lose lines.

## An exploratory check: the order drift

This check is exploratory. No rule named it, and it was chosen after the drift was seen.

none's passes rose across the five grid parts, 29, 31, 33, 37 and 40 of 72, while told's fell, 38, 37, 39, 33 and 33. Told minus none by part was +12.5, +8.3, +8.3, -5.6 and -9.7 points. Their mean is the primary's +2.8.

**Is it bigger than chance?** A permutation test kept each task's 20 outcomes per arm and shuffled which part each came from, keeping 4 per part (20,000 shuffles, seed 20261106; the session-metadata tests below used 5,000 each). Two-sided, the rising trend in none has p = 0.018, the falling trend in told p = 0.16, and the trend in told minus none p = 0.006. The test treats every trial as independent and was picked after looking at many tallies, so these p-values overstate the evidence. The drift is spread over many tasks: from the first two parts to the last two, none's passes rose on 8 tasks, fell on 4 and held on 6, and told's fell on 8, rose on 2 and held on 8.

**What could cause it.**

1. **Chance, plus a look after the fact.** One trend among many tallies can reach p = 0.006 by luck more often than that p suggests.
2. **A change on the provider's side during the 17-hour grid.** grid-1's sessions ran from 08:43Z to 11:24Z on 2026-11-06, and grid-5's from 22:22Z to 01:54Z, so later parts fell in US working hours. The records show no visible change: all 720 sessions ran claude-opus-5-5 through Claude Code 2.1.312, and all 26,689 assistant messages report the standard service tier, standard speed and global inference routing. A change the API doesn't report would not show here.
3. **The part's VM.** Each part ran on its own VM. The oracle passed every task in every part, and both arms shared each VM, so a VM effect would move both arms the same way.
4. **A change in how sessions ran.** Session metadata, read without transcript text, shows little. Told sessions kept the same turns, Bash calls and subagent count, and their mean thinking tokens fell from 2,384 to 1,859 (p = 0.04). none sessions started a few more subagents in later parts (3.03 to 3.64 a session, p = 0.03). Within a task, one more subagent went with about 2.5 more points of passing, far too little to explain a 15-point rise. These are more after-the-fact tests, so p values of 0.03 and 0.04 among them mean little.

None of these explains the drift, and the records can't rule out a provider-side change.

**Does it threaten the reading?** Not the verdict. Every part ran each task 4 times in each arm, interleaved on one VM in one seeded order, so anything that moved both arms alike cancels in told minus none. What doesn't cancel is a change in the lift itself. If the lift really moved during the run, +2.8 is an average over an unstable effect, and the task-clustered interval, which treats a task's 20 replicates as exchangeable, is too narrow. Treating each part as one paired block gives -9.4 to +14.9 points (a t interval on the five part lifts, 4 degrees of freedom). That is wider than the frozen -5.8 to +11.4, and both include zero, so FIX-METHOD (power) stands. The frozen order is paired and fixed, so the drift doesn't change the verdict.

What it does change is how to read the point estimate and how to run the next round. A 3-point lift is not a stable property of these sessions. A later round should keep both arms interleaved inside each block, as R3c did, report the lift block by block, and never use R3c's arms as a control for an arm run at another time.

## Next round: options, not a prereg

Nothing in this section is frozen. It lays out what each option would cost, and the choice goes to the project owner.

**A pass-rate grid that resolves a 3 to 5 point lift.** A prereg would size its own grid by simulation.

- If the lift were the same on every task, as the frozen power model assumes, the MDD falls with the square root of the number of pairs. 5 points needs about 1,440 pairs (four times R3c's grid) and could reuse R3c's 18 admitted tasks at 80 replicates. 3 points needs about 4,000 pairs. The grid costs are in Agent notes.
- R3c's data argue against that model. The per-task lifts varied 2.35 times as much as trial noise alone would give (p about 0.001 against no spread), which puts the spread of true per-task lifts near 15 points, a loose estimate from 18 tasks. With that spread, more replicates on the same 18 tasks barely help: 80 replicates would still leave the MDD near 10 points. The grid needs many more tasks. At 10 replicates, a 5-point MDD takes about 160 tasks (1,620 pairs) and a 3-point MDD about 450 tasks (4,510 pairs).
- Tasks cost money before the grid. Its candidates were every pool task not already at the floor or held for L1, so more in-band tasks need a new source.

**Localization as a lower-noise primary.** hit@1's interval here was 11.6 points wide against the primary's 17.2. Two limits: none already sits at 88.6%, so told has at most 11.4 points to gain, and a localization result says the model named the file, not that it fixed the bug. This lift came from R3c's own report-only lines, so a confirmatory test needs a fresh grid.

**The hook-enforced /investigate arm.** the gstack Captain was asked to build an arm whose hooks enforce the procedure. R3c's told arm showed a DEBUG REPORT in nearly every trial but a numbered phase heading in none, so enforcement is the open question about exposure. A first look could run that arm beside none on R3c's 18 admitted tasks at 3 replicates each (108 trials; the cost estimate is in Agent notes) to measure exposure and cost. At that size its MDD would be near 26 points, so it would claim no effect.

**What the line's remainder can buy.** No pass-rate or localization round that resolves 3 to 5 points fits in what is left of the line. The amounts are in Agent notes. The remainder can fund the enforced arm's first look with a lean amendment, pin and run, if that arm is built and pinned. Any powered round needs a new line or a raised ceiling, which is the project owner's call.

## Deviations

None changes a rule or a count. The run had no stop, raise or relaunch, no infra trial, and no hand-opened lease. The transcript archive (369 MB) is larger than the drive's per-file limit, so it is kept as four parts with a digest for each part and for the joined file (3c79a845583e0adef11271e71efc6492f2f490a791444d8294d66febe2f67bb5), which this thread checked before reading it.

## Limits

- **One model, one pool.** Every number here is about 18 SWE-rebench tasks that Opus 5.5 solves about half the time. The band holds about 8% to 12% of the pool, so the verdict speaks for mid-difficulty tasks only. GPT-6.1 Sol was left out as a scope limit (amendment 6 section 2).
- **Procedure visible, not followed.** The gate reads the DEBUG REPORT, which the contract Stop hook also enforces, and no told trial wrote a numbered phase.
- **Skill and hooks together.** The told arm is gstack as its ./setup ships it, so R3c can't separate the skill text from the Stop hook.
- **The closing line is new to both arms.** Admission mixed in-hand none trials measured without it with calibration trials that carried it.
- **Contamination.** The pool's tasks predate Opus 5.5's training cutoff, which raises solve rates in both arms and biases toward a null.
- **The interval and the drift.** The frozen interval treats a task's 20 replicates as exchangeable. The exploratory check above suggests the lift may have moved during the run, which would make that interval too narrow.
- **Report-only lines.** The localization reading in "How it works" rests on report-only lines and a bound derived from them, not on a frozen test.

## Replicate it

The commands that ran are in the run record: handoffs/GEVA-323/scripts/ in the Captain's drive (prep-local, approve, host prepare, the run, grid and analyze launchers, status, attach and bundle) and run-record.md, which lists every command, digest and decision in order. The outcome step is r3c.ts's analyze, run as `LEDGER=<item ledger> INHAND=<dir> bun quick/laneb/r3/r3c.ts analyze <work dir> --item r3c-opus` from a git archive export of 239d227, and the lines it printed are quoted above. The rerun inputs (the six in-hand records, the ledger, the task tests and the four archive parts, with a RERUN.md) are in the project drive under r3c-runs/GEVA-323/, and a rerun from them printed analyze.out byte for byte on 2026-11-07. The order-drift check's scripts read trials.tsv, the ledger and session metadata, and they stay with this thread's handoff in the Captain's drive. This record leaves out the trial records and transcripts, so an outsider can't rerun analyze.

## What is held out

Nothing is sealed. The tasks are public SWE-rebench tasks. The run records stay private only because they hold model transcripts. This post names no task and gives the admitted list by its digest and the D1 set by its count.

## Changelog

- 2026-11-07: first version (GEVA-380).

<details>
<summary>Agent notes</summary>

**Model.** claude-opus-5-5 on the Anthropic API, through the metering proxy with a $12 allowance per session, under Claude Code 2.1.312.

It priced a task-replicate pair at $1.049, found 24 replicates affordable, and chose 20, with a frozen MDD of 10 points and a null size of 4.1%.

r3c-opus: settled $540.41 of $750, open reserves 0

money: none $0.385 a trial (59 calibration none trials on the admitted tasks), $1.049 a task-replicate pair, 24 replicates affordable

report only: the mean over every calibration none trial $0.345 a trial (442 trials)

R3c grid for opus: GO with 18 tasks x 20 replicates x {none, told}; MDD 10 points (16 if the lift sits on half the tasks, report only); null size 4.1%; projection $616.74

**Cost**

Both items settled in full, with no reserve open:

| Item | Cap | Model | VM | Settled |
|---|---|---|---|---|
| r3c-opus | $750 | $522.772436, 1,162 sessions | $17.638334, 9 part VMs | $540.410770 |
| r3c-opus-host | $20 | | 29.999 hours of standard-2 | $2.000000 |
| **Total** | | | | **$542.410770** |

By stage: calibration $159.81 (cal-1a $49.49, cal-1b $48.07, cal-1c $60.90, cal-2 $1.37) and grid $380.60 (grid-1 $75.39, grid-2 $76.53, grid-3 $72.30, grid-4 $75.44, grid-5 $80.93). The projections before the five grid parts were $616.74, $615.96, $618.80, $612.71 and $613.59 against $750, so there was no projection stop, raise or relaunch. The grid cost $1.057 a task-replicate pair, model and VM, against admission's $1.049.

Per cell, from the ledger settles (tokens as input, output, cache write and cache read):

| Cell | Sessions | Spend | Per session | Per pass | Tokens | Requests |
|---|---|---|---|---|---|---|
| Calibration none | 442 | $152.685768 | $0.345 | $0.496 | 13,752; 2,668,386; 9,891,009; 249,026,545 | 6,839 |
| Grid none | 360 | $146.932063 | $0.408 | $0.864 | 12,588; 2,452,045; 10,272,528; 232,378,629 | 6,254 |
| Grid told | 360 | $223.154605 | $0.620 | $1.240 | 15,170; 3,385,020; 16,592,884; 362,130,276 | 7,567 |

Prices are the build's quick/laneb/config/proxy.json, in dollars per million tokens, as used from 2026-11-05 to 2026-11-07. Opus 5.5: input 4, output 20, cache write 5 (5-minute) or 8 (1-hour), cache read 0.20. Every cache write here was a 5-minute write. VMs: Ubicloud standard-16 at $0.60 an hour for the parts, and standard-2 at $0.0666 an hour for the controller host.

**VMs.** The harness destroyed all nine part VMs. The run thread destroyed the controller host at 02:14:45Z on 2026-11-07, and its list of its own VMs came back empty.

**The /investigate line against its $2,000 ceiling**

Each gstack skill's evaluation gets at most $2,000 all-in, counted from 13:30Z on 2026-11-03: paid model calls, VMs, and the crew's own model use at about $1 per 1,000 credits. Paid figures are the item ledgers' settled totals. Crew figures are each thread's counter, read at about 02:30Z on 2026-11-07, when every thread below except this one was archived.

| Line | Amount |
|---|---|
| R3a4 items, settled: r3a4-oracle $2.78, r3a4-opus $85.40, r3a4-sol $103.85, two capacity probes $0.02 | $192.04 |
| R3b items, settled: r3b4-opus $247.37, r3b4-sol $268.15 | $515.51 |
| R3c item, settled: r3c-opus | $540.41 |
| Controller hosts: r3b4-opus-host $0.79 and r3c-opus-host $2.00 (ledgers), R3b's Sol host about $0.93 (13.9 hours of up time; it opened no ledger) | $3.72 |
| **Paid, settled** | **$1,251.69** |
| Crew before R3c: GEVA-248 12,668, GEVA-249 17,045, GEVA-263 22,059, GEVA-264 23,890, GEVA-270 26,748, GEVA-273 19,812, GEVA-275 11,234, GEVA-276 22,948 and GEVA-283 16,469 credits, 172,873 in all | $172.87 |
| R3c crew: GEVA-284 (prereg) 78,657, GEVA-299 26,539, GEVA-305 49,187, GEVA-310 15,786 and GEVA-319 10,536 (build, its /ship and the pin post), GEVA-323 (run) 38,583 credits, 219,288 in all | $219.29 |
| This thread, GEVA-380, at its 60M-token stop (4,160 credits when this was written) | about $17 |
| **All-in** | **about $1,661** |
| **Left of $2,000** | **about $339** |

As in the earlier tallies, GEVA-247 (amendment 4, started before the ceiling), the difficulty ladder's thread and the Captain's own model use are not on the line.

At caps, amendment 6 and the Captain's caps record put the line at $1,895.03, with $104.97 unallocated. The actual all-in is about $234 lower, mostly because r3c-opus settled $209.59 under its cap and its host $18.00 under. The caps record holds GEVA-284 on its own $75.96 row, and it came in $2.70 over. The caps record's crew row of $166.92 covers the rest of R3c's crew (the build, its /ship, the pin post, the run and this post), which comes to about $158 with this thread at its stop. What is left is not a reserve: only a raise the Captain records can draw on it, and the caps record names the hook-enforced arm's round as its first claim.

**A pass-rate grid that resolves a 3 to 5 point lift.** These are rough figures from R3c's data, at the grid's measured $1.057 a task-replicate pair.

If the lift were the same on every task, as the frozen power model assumes, the MDD falls with the square root of the number of pairs. 5 points needs about 1,440 pairs (four times R3c's grid), about $1,520 of grid, and could reuse R3c's 18 admitted tasks at 80 replicates. 3 points needs about 4,000 pairs, about $4,230 of grid.

R3c paid $159.81 of calibration for 18 admitted tasks, about $8.90 a task. At that rate, a 5-point MDD under the spread model costs about $3,150 for calibration and grid, and a 3-point MDD about $8,800. R3c's own crew cost about $235 on top (prereg, build, pin post, run and this post).

On the same 18 tasks, an MDD of 5 points on hit@1 needs about 2.7 times R3c's grid (about 990 pairs, about $1,050), and 4 points about 4.3 times (about 1,550 pairs, about $1,640), if the lift is about the same on every task.

A first look could run that arm beside none on R3c's 18 admitted tasks at 3 replicates each (108 trials, roughly $60 of model spend and VM at R3c's costs) to measure exposure and cost.

**What the line's remainder can buy.** About $339 is left of $2,000. No pass-rate or localization round that resolves 3 to 5 points fits in it; the cheapest is about $1,050 of grid before crew.

A fresh replication is a paid run: about $542 at this run's costs, calibration and host included.

From the summary: Paid $542.41.

cost per success (report only): none $0.86, told $1.24

Told costs more. A told trial cost $0.62 against $0.41 for none, and a pass cost $1.24 told against $0.86 none, about 43% more per success.

- **Cost per success.** none $0.86, told $1.24.

- **Cost.** Told costs 1.52 times as much per trial ($0.620 against $0.408 in model spend) and about 43% more per success ($1.24 against $0.86).

</details>

## Disclosures

gstack is Garry Tan's own project.
