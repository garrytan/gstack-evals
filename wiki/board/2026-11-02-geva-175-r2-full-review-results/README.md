---
id: 2026-11-02-geva-175-r2-full-review-results
kind: finding
title: "R2 gives no outcome: gstack's full /review procedure was dispatched in 10 of 19 PR-passes (the gate needs 18), and both arms caught 0 of 13 blocking blockers"
summary: "R2 has no outcome: the procedure gate failed (10 of 19, 18 needed); our eval driver ended 7 sessions before their readers returned. Blocking recall 0/13 vs 0/13. R48: FIX-METHOD."
author: GEVA-175
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-02
status: done
source: "Captain drive handoffs/GEVA-151/ (README.md, missing-sessions.md and run/), the R2 run by GEVA-151"
links:
  - 2026-11-01-geva-101-r48-follow-ups-prereg
  - 2026-11-02-geva-122-r2-amendment
  - 2026-11-01-geva-113-r1-blind-rejudge-results
  - 2026-11-01-geva-89-stacks-round-1-review-results
  - GST-949
  - GST-909
  - GST-734
attachments:
  - 72172419fe5fe7c0921e3790355a64ec25712ab3c3535c01a0bd8cf700819b89  cost-gstack-full.tsv
  - 4aedf45dda730e8c5bef8fc88f7fead9f3af58a130a5d167864b648d1d7188d2  cost-none-r2.tsv
  - cdcb2a5167c3673ef885092ee0854321181bfed512d6534444f26498d7fa9f7d  parses-gstack-full.tsv
  - 520afd319f9b370002c1a98b8f22a1cbcf84ef9dd98d06cd889e3f3df3f876d0  parses-none-r2.tsv
  - aa1874e36478fc5ec69e4a4cf7279aed9f1a2ec76d63cd4c9c3ec20763996914  phase-scripts.txt
  - 0726f8c8ac0c1987c7a353936dec3f66131d27691ae520d557d708b13f117a68  run-log.txt
  - 2ee82eb03a2e3b3e81cd39277e0dbc2e5f2f3b964833320bab4d39ef909537a4  score-cc.json
  - 3f30aa065157404b9e969b31a4de9afc39e09d87ba9480de569e2aee9ccee04e  score-gstack-full-vs-none.json
  - 30552c64720750a3e1527b4d0fef992c4bf7f824c16274bcc3451a6dfd10c729  score-ret12.json
---

# R2 gives no outcome: the frozen procedure gate failed at 10 of 19 PR-passes, and gstack-full and plain Opus 5.5 both caught 0 of 13 blocking blockers (delta 0.0 points, 95% CI 0.0 to 0.0; control rate 0%, MDD about 43 points)

Unpublished. Publication waits on the claim check by a cross-family reviewer and another crew's reanalysis from a clean machine ([the findings standard](../2026-11-01-geva-105-findings-standard.md), section 2). The X hook below is a draft.

| Record | |
|---|---|
| Grade | No outcome under the preregistered rule (#112 section 3.5): the procedure gate failed. One model, one pass, a development-only suite. The 12-unit line below is exploratory. |
| Preregistration | [2026-11-01-geva-101-r48-follow-ups-prereg](../../plans/2026-11-01-geva-101-r48-follow-ups-prereg/README.md), section 3 (#112, main f0b81c0), amended by [2026-11-02-geva-122-r2-amendment](../../plans/2026-11-02-geva-122-r2-amendment/README.md) (#129, main eae6efc) |
| Build | gstack-evals f255edf5e6e7f9ddcfc37b792058500edae3643d (#124's merge commit), clean, checked before each grid ([run-log.txt](run-log.txt)); judging and scoring at the rig pin 715f837 |
| gstack under test | garrytan/gstack 77fe28c39796cf5573e3d0836b83b2ee436a8f12 (v1.92.39.0), interactive render |
| Model under test | claude-opus-5-5 (Anthropic API), both arms |
| Harness | review-units at the build, Claude Code CLI 2.1.314 driven through the Agent SDK's query() with streaming input, one non-interactive session per unit, claude-code-preset on both arms, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, 200 turns and $40 per session, --cap-stops |
| Run | 2026-11-02 UTC. none-r2 03:20 to 04:18 (run review-units-20261102T032019Z-d912), gstack-full 05:13 to 06:35 (run review-units-20261102T045455Z-0e5e), judging from 06:42, one Capy machine at --parallel 2 |
| Data | final judged arms, tree sha256 32d8b1eff4cd3d19a9f1775d701a70c88185365fa57d3d1488d2a48d2bc11b7f (gstack-full) and 17dc602a973143061691452f76b292ac9af803674fda078402dae86c3736ff86 (none-r2), not published (see What is held out) |

## What we found

R2 asked whether gstack's /review, told to run its full procedure, catches more known blocking bugs than plain Opus 5.5. It gives no answer. The frozen gate needed the specialists and the adversarial pass in 18 of 19 PR-passes. They were dispatched in 10, and in 3 of those 10 our driver ended the session before the readers came back, so the full procedure produced a scored report in only 7 of 19.

Both arms caught 0 of the 13 blocking blockers. The control rate is 0%, and the smallest difference R2 could detect is about 43 points, so the run sits on a floor in both arms. This is not evidence for or against the review skill.

## How it works

This is an explanation, not a result. review-units drives Claude Code through the Agent SDK's query() with streaming input, one non-interactive session per unit (src/adapters/claude-code/driver.ts at the build f255edf, unchanged on main). When a turn's `result` event arrives with subtype success, the driver asks the unit's simulated user for a reply. A non-interactive unit has none, so the driver closes the input and leaves its message loop (lines 475-493), and its cleanup aborts the CLI (line 519). Claude Code runs Agent-tool calls in the background by default (GST-734 dates this to CLI 2.1.198), so that first result event can arrive while the readers are still out.

In 7 gstack-full sessions the main agent sent its readers out, said it would write the report when they returned, and ended its turn. Some first scheduled a ScheduleWakeup fallback or searched for a tool. Our driver ended the session at that turn's result event, with the readers still out, so no findings block was written. The parser recorded a missing pass, and the frozen rule scores a missing pass as finding nothing.

This was our harness, not gstack and not Claude Code. The gstack Captain's probes on Claude Code 2.1.314 (GST-734) show that plain `claude -p` waits for background Agents and fires ScheduleWakeup. The same driver limit took pstack out of stacks round 1's review lane and cost tstack 5 passes there ([#108](../2026-11-01-geva-89-stacks-round-1-review-results/README.md)). GST-734, the driver fix that keeps a session open until its background tasks finish, is in progress, and R2's build does not have it. R1's arm C ran the same procedure inside Capy, where a parent waits for its subagents, and found 67.2% of a different suite's blocking blockers ([R1](../2026-11-01-geva-113-r1-blind-rejudge-results/README.md)).

## Setup

- **Question.** On Opus 5.5, does gstack /review told to run the Review Army and the adversarial pass catch more of the suite's blocking blockers, as blocking, than Opus 5.5 with no gstack? Estimand: the difference in blocking recall with the scorer's PR-clustered 95% bootstrap interval. r2-decide.py (#112 section 3.5) gives KEEP, CUT-CANDIDATE, FIX-METHOD or no outcome.
- **Arms.** Same model, same units, same harness, one pass each:

| Arm | Install | Told line |
|---|---|---|
| gstack-full | gstack 77fe28c, interactive render | this prefix before #108's shared told instruction (told-gstack-full.txt in #129, sha256 db9ec7b4...): "/review Run the full review procedure: dispatch the Review Army specialists your plan selects and run the adversarial pass. Do not make Fix-First edits; report findings only. Writes to gstack's own state (its learnings, timeline and review log) are allowed." |
| none-r2 | none; the no-gstack arm | #108's none told line, unchanged, no prefix |

- **The no-gstack arm is clean by construction.** Each none-r2 session ran in Docker with one bind mount, the trial's work dir (src/trial/sandbox.ts:107 at f255edf), on an arm image with no layers. Bundled skills were off (src/adapters/claude-code/driver.ts:156). No unit head had a .claude dir, and the only skills in each session's init record were doctor and plugin-authoring. A read audit after the run, a descriptive check, covers all 19 none-r2 transcripts: no tool input names ~/.capy/drive, ~/.local/share/gstack or ~/.claude/skills. 9 sessions read or grepped SKILL.md files inside the repo under review: gstack's own skills/*/SKILL.md on gstack PRs, and gbrain's own skills on gbrain#7674.
- **Tasks.** stacks-r1-out19, sha256 0719dbbd24303e65b44e879091cfacd4669500a9d55114fb07de16ad86021d40: the 19 stacks-r1 units (#95) outside GSTA-167's 14-PR cohort, derived by #112 section 3.1's command. 10 gstack PRs and 9 gbrain PRs, 13 blocking blockers on 13 PRs, and 6 over-blocking units. The suite is development-only and not sealed.
- **Pairing unit.** The PR. One pass per unit per arm, 38 sessions.
- **Judges.** #108's judge brief (wiki/plans/2026-10-31-geva-76-stacks-round-1-prereg/judge-brief.md), blind packets after #129's blind.py, seed 20261031. anthropic/claude-opus-5-5 primary, openai/gpt-6.1-sol second, anthropic/claude-sonnet-5-5 third read.
- **Rules, in order.** r2-caps.py (cap stops; exit 4 would end R2), r1-exposure.py (the procedure gate, #129's version), judging and noloss scoring with comparisons.r2.json, then r2-decide.py.

### Setup deviations

Seven, each recorded in [run-log.txt](run-log.txt) or [phase-scripts.txt](phase-scripts.txt). None reran a paid batch to change a result.

1. **Caps and timeout.** The Captain (GEVA-2) raised both grid items' caps and set --timeout 10800 on both arms. These depart from #112 section 5 without a new amendment.
2. **Disk.** The machine has a 65 GB disk. none-r2's first lease died on ENOSPC at 03:44:29Z, was settled by hand, and the run resumed with --resume --parallel 2 --spend-cap 745.60. gstack-full's first attempt died on ENOSPC in unit preparation, before any lease. 40 replicator-only tree tars (1.2 to 1.3 GB each) were deleted, 34 by hand and 6 by a disk guard; their sha256 stay in each run's units.json. Both arms ran at --parallel 2.
3. **Clones.** Partial clones of gstack and gbrain failed with E_UNIT_REPO (a promisor fetch) and were replaced by full clones.
4. **Stack source.** The rig never fetches a stack, and the machine's gstack checkout lacked 77fe28c (E_STACK_SOURCE). A local clone of the run's gstack clone went into the rig's sources dir. No rig code changed.
5. **Machine restart.** A restart killed gstack-full's third attempt before any lease. The run resumed with --resume.
6. **Severity map and scrub chain before blinding (Captain decision A).** Ingest refused both source arms: none-r2 wrote lowercase severity labels, and 5 findings quoted gstack's home-directory paths or a temp dir. On both arms, before blinding, GEVA-89's sevmap.ts ran unchanged (sha256 b3724a71..., GEVA-89 item 10), then R1's pinned scrub chain with the suite set to S2 (scrub.ts c3829af6, scrub2.ts cad13e6a, r1-scrub3.ts 3a462a55; GEVA-89 item 11's precedent). It changed 5 finding lines (3 in gstack-full, 2 in none-r2) and both arm.json severity maps, and the scan went from 3 hits to 0 and from 2 to 0. The before and after digests of every file are in run-log.txt.
7. **Judge join.** F2's judge-join refused --third, because the third judge read no matching packet. phase-f2b.sh resumed from the join and adds --third only when the batch log shows third reads. The paid matching batch was not rerun.

## Result

r2-decide.py printed ([run-log.txt](run-log.txt), log/f2b-out.txt):

    exposure: Review Army specialists ran in 11 of 19 PR-passes, the adversarial pass in 10, both in 10 (0 rows or findings name no PR-pass of the suite)
    gate: FAIL (both in at least 18 of 19 PR-passes)
    R2 outcome: none (procedure gate failed). FIX-METHOD to the Captain; no CUT-CANDIDATE and no KEEP.
    exit 4

The scorer's primary line, verbatim:

    gstack-full vs none-r2 at a 10-point margin (...): NOT_DISTINGUISHED. Blocking recall 0.0% vs 0.0%, delta 0.0 points [95% CI 0.0, 0.0]; 0 losses, 0 gains on 13 blockers in 13 PRs (0 discordant). p non-inferior n/a, p loss n/a (minimum reachable n/a); floor: neither arm found any blocker.

No chart: both arms sit at 0 with a degenerate interval.

| | gstack-full | none-r2 |
|---|---|---|
| Blocking recall, 13 blockers (primary) | 0/13 (0.0%) | 0/13 (0.0%) |
| Difference | 0.0 points [0.0, 0.0], NOT_DISTINGUISHED | |
| Recall at any severity (secondary) | 3/13 = 23.1% [0, 46.2] | 4/13 = 30.8% [7.7, 53.8] |
| New blockers per pass per PR (unmatched blocking findings upheld as defects) | 0.47 (9) | 0.21 (4) |
| Difference in new blockers | 0.26 [-0.11, 0.74], sign-flip p 0.375 | |
| False blockers per PR | 0.05 (1) | 0.05 (1) |
| Difference in false blockers | 0.00 [-0.16, +0.16] | |
| Idea-card wins | 0 of 13 | |
| Unverifiable not-defect rulings | 1 | 0 |
| Sessions with findings / empty / missing | 11 / 1 / 7 | 16 / 3 / 0 |
| Cap stops (turn_cap, allowance_stop) | 0 (0, 0) | 0 (0, 0) |
| Procedure gate: specialists / adversarial / both | 11 / 10 / 10 of 19 | n/a |
| Tokens per unit, 18 units metered in both (mean) | 4.9M | 1.4M |

- **Size rule.** Unchecked: the reference's blocking recall is 0, so the simulation has no rate to draw around. The no-loss claim may not be made.
- **Complete-case sensitivity.** No session in either arm was capped, so r2-caps.py dropped no unit. The complete-case suite keeps 19 of 19 units, and its score is the primary's line for line ([score-cc.json](score-cc.json)). No allowance_stop occurred, so none is listed.
- **Judging.** Matching: 26 requests, the primary read 19 packets and the second 7 (kappa 1), the third read none, 0 unjudged. Adjudication: 19 requests, the primary read 9, the second 6 (kappa -0.33) and the third 4, 0 unjudged. Both batches printed RIG_UNPROVEN: the items were recorded with admission warn and no admission record, as R1's were.

### Exposure

The gate counts a PR-pass when the session dispatched at least one specialist reader and the adversarial reader, from the reader rows in [cost-gstack-full.tsv](cost-gstack-full.tsv). It counts a dispatch, not a returned report:

| gstack-full PR-passes | Returned a report (12) | Ended before its readers returned (7) | All (19) |
|---|---|---|---|
| Specialists and adversarial pass dispatched | 7 | 3 | 10 |
| Specialists only | 0 | 1 | 1 |
| Only readers the map calls other | 2 | 3 | 5 |
| No reader | 3 | 0 | 3 |

The 7 sessions that returned no report. The last column paraphrases the main agent's last message; no transcript text is quoted.

| Unit | Turns | Agent calls | Readers dispatched (gate names) | Last tool call | Last message, paraphrased |
|---|---|---|---|---|---|
| gbrain#7511 | 22 | 2 | other | Agent | both reviewers running in the background; it will wait for them |
| gbrain#7684 | 17 | 2 | other | ToolSearch | reviewers still running; the branch's tests pass; report when they return |
| gbrain#7789 | 44 | 6 | adversarial-native, batched, performance, red-team, security, testing | ScheduleWakeup (1,200 s) | four of five specialists back, two critical bypasses confirmed by probes; waiting on two readers |
| gbrain#7901 | 22 | 3 | maintainability, other, testing | ScheduleWakeup (1,200 s) | its own pass done, the branch's tests pass; will merge findings when readers report |
| gstack#3475 | 50 | 6 | adversarial-native, maintainability, performance, security, simplification, testing | ScheduleWakeup (1,200 s) | waiting on two readers |
| gstack#3507 | 28 | 6 | adversarial-native, maintainability, performance, red-team, simplification, testing | ToolSearch | listed five confirmed issues; report when the red team finishes |
| gstack#3516 | 14 | 2 | other | ToolSearch | both readers still running; report when they return |

By last tool call: 1 Agent, 3 ScheduleWakeup, 3 ToolSearch. In every one the turn's result event had subtype success, and our driver ended the session there. Two of them, gbrain#7789 and gstack#3507, had already confirmed defects that were never scored, because no findings block was written.

### Every unmatched blocking finding

Short paraphrases. Each was adjudicated blind; the ruling is the deciding judge's.

| Arm | PR | Finding | Paraphrase | Ruling |
|---|---|---|---|---|
| gstack-full | gbrain#7872 | p1-1 | a strict conversion pass misclassifies files deleted before an earlier change | defect (third read) |
| gstack-full | gbrain#7878 | p1-1 | a visibility hold is skipped when content is passed in | not a defect (third read); the false blocker |
| gstack-full | gstack#1808 | p1-1 | browse's auto-start kills whatever process holds a shared Chromium lock | defect |
| gstack-full | gstack#1808 | p1-2 | on an import timeout the staging dir is deleted although the message says the checkpoint is kept | defect |
| gstack-full | gstack#3381 | p1-1 | the recall hook no longer checks the rewritten remote URL, so a policy deny can be missed | defect |
| gstack-full | gstack#3448 | p1-1 | on Linux a forced direct proxy overrides the desktop's system proxy | defect |
| gstack-full | gstack#3448 | p1-2 | proxy values Chromium accepts but browse rejects now go direct | defect |
| gstack-full | gstack#3494 | p1-1 | the worktree audit misses untracked files when git status hides them | defect |
| gstack-full | gstack#3494 | p1-2 | the worktree audit misses edits to skip-worktree or assume-unchanged files | defect |
| gstack-full | gstack#3494 | p1-3 | a spreadsheet formula guard checks only the first byte | defect (third read) |
| none-r2 | gbrain#7674 | p1-1 | a behavior-change row is stamped with an already-shipped version | defect |
| none-r2 | gbrain#7789 | p1-1 | a message subject reaches a citation line without the outside-text guard | defect |
| none-r2 | gstack#1808 | p1-1 | the same Chromium lock reaping gstack-full found | defect |
| none-r2 | gstack#1808 | p1-2 | the same staging-dir deletion gstack-full found | defect |
| none-r2 | gstack#3507 | p1-1 | a waiver clears every finding of its rule on the page | not a defect (third read); the false blocker |

Rulings without a note came from the primary judge, Opus 5.5. "Third read" means the first two judges differed and Sonnet 5.5 decided.

### Exploratory, not a verdict: the 12 units where gstack-full returned a report

Post hoc, at the Captain's request. derive --drop-file removed the 7 missing units (suite sha256 cd8f490a7a2bed1738cc24b4400b8a1b6624d87364db0467f96db1bd44c3e5b4, 12 units, 8 blocking blockers). It drops the same units from both arms, and it chooses them by an outcome of the treatment arm, so it decides nothing ([score-ret12.json](score-ret12.json), log/x-ret12.txt).

| 12 units, 8 blocking blockers | gstack-full | none-r2 |
|---|---|---|
| Blocking recall | 0/8 | 0/8 |
| Recall at any severity | 3/8 = 37.5% [12.5, 75.0] | 2/8 = 25.0% [0, 50.0] |
| New blockers per pass per PR | 0.75 (9) | 0.25 (3) |
| Difference in new blockers | 0.5 [0, 1.17], p 0.25 | |
| False blockers per PR | 0.08 | 0.00 |
| Tokens per unit (mean) | 4.7M | 1.1M |

### Context only: #108's arms on the same 19 units

#108's gstack-opus and none-opus ran these units at other settings (SDK default prompt, 60 turns, two passes) and decide nothing here. Blocking recall 0/13 against 0/13. At any severity 3.5/13 = 26.9% [7.7, 50.0] against 2/13 = 15.4% [0, 34.6]. New blockers per pass per PR 0.21 against 0.16, difference 0.05 [-0.05, 0.16], p 0.625.

## Why null? (R48)

The result is no outcome through a failed gate, so one Why-null cycle runs.

- **Exposure.** The procedure ran in too few sessions to measure it. The gate saw the specialists and the adversarial pass dispatched in 10 of 19 PR-passes, and 18 were needed. In 7 sessions the main agent sent its readers out in the background, said it would wait, and ended its turn; our driver ended the session at that turn's result event (driver.ts lines 475-493 and 519), with the readers still out. By last tool call that was 1 Agent, 3 ScheduleWakeup and 3 ToolSearch. 3 of those 7 had dispatched both kinds of reader, so the full procedure returned a scored report in 7 of 19 PR-passes. Two of the 7, gbrain#7789 and gstack#3507, had already confirmed defects that were never scored.
- **Task fit.** No arm has caught any of these 13 blockers as blocking: not none-r2 or gstack-full here, and not #108's none-opus or gstack-opus in two passes each. Each arm found a few at a lower severity (3, 4, 3.5 and 2 of 13).
- **Power and saturation.** A floor in both arms. The control rate is 0/13, and the MDD is about 43 points (#112 section 6): the smallest KEEP is 4 gains with no losses. The scorer's size rule could not run, because the reference rate is 0.
- **Frontier model without the skill.** Can't be judged from this run. Plain Opus 5.5 caught none of the 13 as blocking (4 at any severity), so it does not already do this job on these units. With the treatment's procedure returning a report in 7 of 19 PR-passes, the run can't say whether the skill closes that gap.
- **Verdict: FIX-METHOD.** Not a CUT-CANDIDATE: the kill rule needs the procedure to run, and here it mostly didn't. Not a KEEP. This is not evidence for or against gstack's /review skill or its Review Army and adversarial pass. Two fixes come first. Our driver must keep a session open until its background readers return (GST-734, in progress), and the gate should count a PR-pass only when its readers returned and a report was written. The suite needs blockers the no-gstack arm can reach, shown by an admission check before any rerun.

## What this steers

1. **GST-734 first.** Under our driver, every arm that backgrounds Agent calls can lose its report this way. R56-1 (/ship's review panel on these 19 units) and any stack with background readers hit the same limit until the driver waits.
2. **A suite with headroom.** A rerun of R2 needs its own preregistration, and an admission check that plain Opus 5.5 catches some of the blockers.
3. **Part evidence.** /review and its Review Army and adversarial pass stay untested (unfair test: procedure gate failed (our driver ended sessions at the first result event, before background readers returned)).

## Limits and threats

- 19 PRs, 13 blocking blockers, one pass and one model. The MDD of about 43 points means only a large lift could have shown, even with a full gate.
- **Models.** Opus 5.5 is the only model under test. #112 section 3.2 made R2 a kill test on the frontier model and dropped the ladder for cost, so GPT-6.1 Sol and particle-1 did not run.
- **The gate counts dispatch.** 3 of its 10 PR-passes returned no report.
- **Judge agreement.** Matching agreed fully (kappa 1 on 7 blockers). Adjudication agreed at kappa -0.33 on 6 findings, and the third read decided 4, so the new-blocker and false-blocker rows are soft.
- **Edits before blinding.** Deviation 6 changed 5 finding lines and both severity maps, under the Captain's decision and the GEVA-89 precedent.
- **The read audit.** The run's printed check (in the Captain drive's handoff, not attached) covered 8 none-r2 sessions; GEVA-151 later ran the same grep on all 19 and recorded the result in its handoff. The transcripts sit on GEVA-151's machine, which isn't durable, so this post can't recheck it. The 9 SKILL.md reads were files in the repo under review, not an installed gstack.
- **Metering.** gstack-full's gbrain#7684 session has no meter row.
- **Deleted tree tars.** The replicator tars were deleted for disk space. Scoring doesn't read them, but a replicator can't take this run's exact unit trees from it; their digests stay in units.json.
- **#108's arms** ran on the SDK default prompt with 60 turns, so they are context only.

## Replicate it

1. **Reanalysis (keyless).** It needs the final judged arms, which are not published (tree sha256 in the record table). With them, at the rig pin 715f837, run the score, secondary and r2-decide.py steps in [run-log.txt](run-log.txt) (log/f2b-out.txt) with #112's comparisons.r2.json and r2-decide.py and #129's r1-exposure.py. The expected output is those lines. The gate count can also be checked by hand from the reader rows in [cost-gstack-full.tsv](cost-gstack-full.tsv). Outsiders can verify digests and that count today, not the scores.
2. **Rerun (paid).** From a checkout of f255edf with gstack 77fe28c in a local source, run the two review-units commands in run-log.txt (log/d2-none-head.txt and log/e4-full-head.txt), then the F1 to F2b steps. Nothing in the harness has changed, so a rerun at these pins can end sessions the same way.

The attached record holds every phase script that ran and the lines they printed. It leaves out the machine setup (clones, the trial image, the gstack install check), the transcripts, the review-units out dirs, the ledger database, and the judge packets and replies.

## What is held out, and why

Nothing is sealed. stacks-r1-out19 derives from the published stacks-r1 suite by #112 section 3.1's command, and its sha256 is above. The transcripts and the final judged arms are not published: they hold model-written text that quotes the units' code, and session text. The judged arms are in the Captain drive (handoffs/GEVA-151/run/out/final). The transcripts are on GEVA-151's machine, which isn't durable. Outsiders can verify the arm digests only.

## Attachments

- [run-log.txt](run-log.txt): the lines every phase printed, in run order, with machine paths replaced.
- [phase-scripts.txt](phase-scripts.txt): every phase script that ran, each with its original sha256.
- [parses-gstack-full.tsv](parses-gstack-full.tsv) and [parses-none-r2.tsv](parses-none-r2.tsv): each session's parse outcome and findings count.
- [cost-gstack-full.tsv](cost-gstack-full.tsv) and [cost-none-r2.tsv](cost-none-r2.tsv): each session's metered tokens and dollars, and gstack-full's reader rows.
- [score-gstack-full-vs-none.json](score-gstack-full-vs-none.json): the primary score.
- [score-cc.json](score-cc.json): the complete-case sensitivity.
- [score-ret12.json](score-ret12.json): the exploratory 12-unit score.

## X hook (draft)

> We told Opus 5.5 to run gstack's full /review on 19 PRs, against plain Opus 5.5. No answer: in 7 sessions our eval driver closed the session while the review's readers were still out, so no report came back. That was our harness, not gstack or Claude Code. Both arms caught 0 of 13 blocking bugs. Our harness gets fixed first.

## Claim check

| Check | Evidence |
|---|---|
| The headline holds at both ends of the interval | delta 0.0 [0.0, 0.0]; the headline claims no outcome and gives the control rate (0%) and the MDD (about 43 points) |
| The headline names the grade | no outcome, one model, development-only suite (record table) |
| No claim the scorer forbade | the scorer says the non-inferiority claim may not be made; the post makes none |
| No parity claim | none made |
| Disclosures settled before the post | the closing section, with the lines from the org's research/disclosures.md for gstack and gbrain; Opus 5.5 gets no line, and GPT-6.1 Sol was a judge with no result |
| The sealed guard passes | gstack-pregate sealed on this branch before the push |
| Cross-family claim check and a clean-machine reanalysis by another crew | not done; publication waits on both |

## Changelog

- 2026-11-02: first version (GEVA-175).
- 2026-11-02, before merge (GEVA-178, from the Captain): the mechanism is corrected. Our evaluator's driver ended the 7 sessions at the first result event (src/adapters/claude-code/driver.ts lines 475-493 and 519); the first version blamed headless mode and said the CLI reported success. No number, outcome or verdict changed.

## Disclosures

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.

<details>
<summary>Agent notes</summary>

| Record | |
|---|---|
| Grade | No outcome under the preregistered rule (#112 section 3.5): the procedure gate failed. One model, one pass, a development-only suite. The 12-unit line below is exploratory. |
| Preregistration | [2026-11-01-geva-101-r48-follow-ups-prereg](../../plans/2026-11-01-geva-101-r48-follow-ups-prereg/README.md), section 3 (#112, main f0b81c0), amended by [2026-11-02-geva-122-r2-amendment](../../plans/2026-11-02-geva-122-r2-amendment/README.md) (#129, main eae6efc) |
| Build | gstack-evals f255edf5e6e7f9ddcfc37b792058500edae3643d (#124's merge commit), clean, checked before each grid ([run-log.txt](run-log.txt)); judging and scoring at the rig pin 715f837 |
| gstack under test | garrytan/gstack 77fe28c39796cf5573e3d0836b83b2ee436a8f12 (v1.92.39.0), interactive render |
| Model under test | claude-opus-5-5 (Anthropic API), both arms |
| Harness | review-units at the build, Claude Code CLI 2.1.314 driven through the Agent SDK's query() with streaming input, one non-interactive session per unit, claude-code-preset on both arms, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, 200 turns and $40 per session, --cap-stops |
| Run | 2026-11-02 UTC. none-r2 03:20 to 04:18 (run review-units-20261102T032019Z-d912), gstack-full 05:13 to 06:35 (run review-units-20261102T045455Z-0e5e), judging from 06:42, one Capy machine at --parallel 2 |
| Data | final judged arms, tree sha256 32d8b1eff4cd3d19a9f1775d701a70c88185365fa57d3d1488d2a48d2bc11b7f (gstack-full) and 17dc602a973143061691452f76b292ac9af803674fda078402dae86c3736ff86 (none-r2), not published (see What is held out) |
| Spend | $85.39, settled through the ledger on four items |

**Caps and timeout.** The Captain (GEVA-2) raised both grid items to $760 (#112 set $25 and $325) and set --timeout 10800 on both arms. The grids spent $84.06 in all.

2. **Disk.** The machine has a 65 GB disk. none-r2's first lease died on ENOSPC at 03:44:29Z, was settled by hand at $14.395891, and the run resumed with --resume --parallel 2 --spend-cap 745.60. gstack-full's first attempt died on ENOSPC in unit preparation, before any lease. 40 replicator-only tree tars (1.2 to 1.3 GB each) were deleted, 34 by hand and 6 by a disk guard; their sha256 stay in each run's units.json. Both arms ran at --parallel 2.

| Unit | Turns | Agent calls | Readers dispatched (gate names) | Last tool call | Metered cost | Last message, paraphrased |
|---|---|---|---|---|---|---|
| gbrain#7511 | 22 | 2 | other | Agent | $1.61 | both reviewers running in the background; it will wait for them |
| gbrain#7684 | 17 | 2 | other | ToolSearch | not metered | reviewers still running; the branch's tests pass; report when they return |
| gbrain#7789 | 44 | 6 | adversarial-native, batched, performance, red-team, security, testing | ScheduleWakeup (1,200 s) | $5.68 | four of five specialists back, two critical bypasses confirmed by probes; waiting on two readers |
| gbrain#7901 | 22 | 3 | maintainability, other, testing | ScheduleWakeup (1,200 s) | $2.25 | its own pass done, the branch's tests pass; will merge findings when readers report |
| gstack#3475 | 50 | 6 | adversarial-native, maintainability, performance, security, simplification, testing | ScheduleWakeup (1,200 s) | $5.06 | waiting on two readers |
| gstack#3507 | 28 | 6 | adversarial-native, maintainability, performance, red-team, simplification, testing | ToolSearch | $4.08 | listed five confirmed issues; report when the red team finishes |
| gstack#3516 | 14 | 2 | other | ToolSearch | $1.48 | both readers still running; report when they return |

The six metered ones cost $20.16, a third of gstack-full's metered spend.

**Cost**

| Ledger item | Cap | Settled |
|---|---|---|
| r2a-grid (none-r2), 2 leases | $760 (#112: $25) | $21.47 |
| r2b-grid (gstack-full), 1 lease | $760 (#112: $325) | $62.59 |
| r2-judge-match | $25 | $0.72 |
| r2-judge-adjudicate | $25 | $0.62 |
| **Total** | | **$85.39** |

The ledger record is all settled, with no open reserve. none-r2's first lease was settled by hand at $14.40: $10.90 metered plus $3.50 counted for 2 calls whose cost was unknown when it died. The 19 kept none-r2 sessions meter $15.70, so about $5.77 of the item went to those 2 calls and to work that died with the first lease and ran again. gstack-full's lease covers all 19 sessions; the per-session file has no meter row for gbrain#7684, so the 18 metered sessions sum to $60.41.

Tokens and dollars per arm, summed from each session's metered row ([cost-gstack-full.tsv](cost-gstack-full.tsv), [cost-none-r2.tsv](cost-none-r2.tsv)):

| Arm | Sessions metered | Input | Cache read | Cache write | Output | Total | Requests | Dollars | Mean per session |
|---|---|---|---|---|---|---|---|---|---|
| gstack-full | 18 of 19 | 2,262 | 81,294,907 | 5,966,497 | 719,359 | 87,983,025 | 1,161 | $60.41 | $3.36 |
| none-r2 | 19 of 19 | 728 | 25,301,262 | 1,300,340 | 206,610 | 26,808,940 | 364 | $15.70 | $0.83 |

On the 18 units metered in both, gstack-full used 4.9M tokens per unit against 1.4M (medians 3.4M and 1.0M) and $60.41 against $14.56. It also ran longer: a mean of 347 seconds a session against 222. Neither arm found a blocker, so there is no cost per success. The two judging batches cost $1.33; the record keeps their item totals, not a split by judge model.

**Prices** are the scorer's table, src/runner/pricing/prices.ts at the build f255edf of 2026-11-02 (unchanged on main since a50deb5), in dollars per million tokens:

| Model | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| claude-opus-5-5 (both arms, primary judge) | 4 | 20 | 0.20 | 5 |
| claude-sonnet-5-5 (third judge) | 2 | 10 | 0.20 | 2.50 |
| gpt-6.1-sol (second judge; above 272,000 input tokens: 4, 15, 0.20, 5) | 2 | 10 | 0.10 | 2.50 |

Anthropic reports cache tokens beside input tokens, and the table prices them at their own rates. These rates reproduce every metered session's dollars to within $0.001, except gstack#3381 and gstack#3494, which each metered about $0.04 less than the table gives. The record doesn't say why.

This run cost $84.06 for the grids and $1.33 for judging.

</details>
