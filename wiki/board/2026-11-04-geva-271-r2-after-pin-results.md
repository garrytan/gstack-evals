---
id: 2026-11-04-geva-271-r2-after-pin-results
kind: finding
title: "R2 at the after pin: KEEP. gstack's full /review (699a41cb) found 22 of 84 blocking blocker-passes against plain Opus 5.5's 3 of 84 on all 33 stacks-r1 units (+22.6 points, 95% CI +11.0 to +33.7)"
summary: "KEEP: blocking recall 26.2% vs 3.6% (control), +22.6 [11.0, 33.7], MDD 24.5; holds under each judge. 42 of 66 gstack sessions ran the procedure only after the hook blocked."
author: GEVA-271
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-04
status: superseded
source: "Captain drive handoffs/GEVA-271/ (ledger-record/, the wrapper logs, grading/ and sens/), the R2 after-pin run by GEVA-271"
links:
  - 2026-11-03-geva-255-r2-after-pin-amendment
  - 2026-11-02-geva-195-r2-rerun-amendment
  - 2026-11-03-geva-229-r2-rerun-results
  - 2026-11-02-geva-175-r2-full-review-results
  - GST-1163
---

# R2 at the after pin: KEEP. gstack's full /review (699a41cb) found 22 of 84 blocking blocker-passes against plain Opus 5.5's 3 of 84 on all 33 stacks-r1 units (+22.6 points, 95% CI +11.0 to +33.7)

Publication status: unpublished; posting is Garry's. Done: the smoke, both grids, both judge batches, scoring, the decision, this file. Still blocking a post: the /ship review recorded in the PR.

| Field | Value |
|---|---|
| Grade | Run under a merged preregistration ([2026-11-03-geva-255-r2-after-pin-amendment](../plans/2026-11-03-geva-255-r2-after-pin-amendment/README.md), #194, amending #154). The verdict is rr-decide.py's, as printed. |
| Verdict | KEEP. Control rate (none-rr) 3.6%. MDD 24.5 points at 2 passes. No judge variant's interval crosses zero. |
| Exposure | gstack-full ran the procedure unprompted in 24 of 66 sessions and only after the contract hook blocked in 42. |

## What we found

- **KEEP.** rr-decide.py printed: "R2 rerun outcome: KEEP. The full procedure found more blocking blockers than plain Opus 5.5, and the interval is above zero." gstack-full found 22 of 84 blocking blocker-passes and none-rr found 3 of 84: 26.2% against a control rate of 3.6%, a difference of +22.6 points with a 95% PR-clustered interval of +11.0 to +33.7. The MDD at 2 passes is 24.5 points. The estimate sits just under it, and the interval still clears zero.
- **Most sessions needed the hook.** The procedure gate counted 66 of 66: every gstack-full session returned a report with a Review Army specialist and gstack's adversarial reader. But in 42 of the 66, the contract hook first blocked the session for a missing dispatch, and the readers ran after that block. 24 ran them unprompted. The gain shows up in both groups (table 2), and the split is not randomized.
- **The judges don't move the primary.** Blocking recall comes from the matching batch, where the second judge agreed at kappa 0.93 on 36 blockers. The primary reads the same +22.6 with the first judge alone (+11.0 to +33.7) and with the second judge's calls where it read (+10.5 to +33.3). The adjudication batch's low agreement (kappa 0.09 on 22 findings) touches only new blockers and false blockers, which decide nothing (table 1).
- **Beside the verdict.** At any severity, gstack-full found 64.3% and none-rr 25.0%. gstack-full raised 49 unmatched blocking findings that blind adjudication upheld as defects, none-rr 8: 0.77 against 0.13 per pass per PR.
- **R48: KEEP.** Not a null. The procedure ran in every session, and the control is far from the ceiling.

## How it works

#194 reruns #154's grid at gstack 699a41cb on the default install. A 3-session exposure smoke runs first and must pass #154's gate at 3 of 3. Then the smoke's dearest session re-costs the grid, and gstack-full's 66 sessions run only if they fit their cap. Their gate needs 60 of 66 sessions returned with both kinds of reader. Then none-rr's 66 sessions run, and both arms go blind into one matching batch and one adjudication batch. `noloss derive --drop-gaps` and `noloss score` give the blocking-recall difference and its PR-clustered interval. rr-decide.py checks for no outcome first, then CUT-CANDIDATE, then KEEP, then FIX-METHOD. KEEP needs the interval above zero.

A hook readout labels each gstack-full session by when the readers started. After-hook means the session's contract log has a blocked line naming specialists-dispatched or adversarial-pass as missing, so the dispatch came after the block. Unprompted means no such line, with both readers started before the first findings block (#194 section 7).

## Setup

Its install check passed (arm tree cc5c6a37, install tree 6967df0e), and so did the keyless hook check (review tree 33848099, settings e94318fa). none-rr ran with no gstack and #108's told line. Judging and scoring ran at rig 715f837 with #108's brief and judges (Opus 5.5 primary, GPT-6.1 Sol second, Sonnet 5.5 third read), seed 20261031. The suite is stacks-r1 (4f46bb17): 33 units, 42 blocking blockers on 26 PR clusters. The ledger held #194's five items at their caps, and rr2-pause.py ran before every launch; it never paused.

### Setup deviations

1. **Smoke, attempt 1.** The operator's launch wrapper misparsed a value it reads before launching and stopped there: no out dir, no lease, no paid calls. The wrapper line was fixed and the smoke ran as a new launch. The attempt is set aside in the run record.
2. **none-rr grid, attempt 1 (the Captain's decision A on GST-1163).** The first launch filled the 128 GB disk at unit 30 of 33. It exited 2 with empty stderr, never leased and made no paid calls. Under decision A, 64 retained tree tarballs were deleted after each digest matched a unit in units.json or unit.json (75.2 GB freed). The install tree 6967df0e and one unmatched tarball (3ab0c76c) were kept. The list of deleted digests is in the run record (deleted-tarballs.tsv, sha256 752551fd48457010ec3a7936f8f37cd85117f5f929968e7e0366b0015b7f1fc1). The wrapper gained a free-disk check that refuses a launch below 90 GB, with no code change.
3. **ADVISORY (decision A).** The frozen sevmap.ts stopped on gstack-full's unmapped ADVISORY label: 6 of 592 findings in 5 sessions. The Captain's words: "gstack-full's ADVISORY label maps to INFORMATIONAL: at the after pin, review/SKILL.md lists [ADVISORY] items as optional advice outside the defect count and strips the mark from any CRITICAL, so ADVISORY is never blocking; added as one severity_map.default entry, source arm recomputed with sha256 before and after, no frozen script edited, recorded as a deviation (GSTA-2, 2026-11-04)." The sha256 of all 35 source-arm files before and after is in the run record. It can move only the any-severity line.
4. **Sealed-marker hit (decisions A and A1).** R1's scrub chain flagged one gstack-full finding whose evidence quotes the sealed guard's answer marker from a probe string. The Captain's words: "gstack-full finding gstack#3556 p1-2 (INFORMATIONAL, lib/sealed-guard.ts:265) is ingested --digest-only because its evidence quotes the sealed guard's answer marker from a probe string; it holds no sealed material, it cannot move blocking recall, and it can only lower gstack-full's any-severity recall (GSTA-2, 2026-11-04)." Ingest's `--digest-only` matches a bare id across every unit, and p1-2 named 33 findings, 8 of them CRITICAL. So, in the Captain's words: "the finding's id is renamed p1-2 to p1-2-sg in garrytan__gstack#3556@95d9c6d06ef1.jsonl only, sha256 of every source-arm file recorded before and after, because ingest's --digest-only matches a bare id across every unit (GSTA-2, 2026-11-04)." The ingested arm lists exactly one digest-only entry, p1-2-sg, at sha256:27e9e79f46622c7034f6b5fdcf749d47d9a71121e17e922c9c833554aa07dc61. The judges saw only that digest. The primary judge read the unit's one blocker and did not match the finding to it. The second and third judges did not read that packet. As an INFORMATIONAL finding it was not in the adjudication batch.
5. **rr-decide.py, attempt 1.** It exited 5 because the operator had not copied rr-gate.py beside it. After the copy it ran unchanged and exited 0. The step is keyless.
6. **A printed warning, not a deviation.** judge-run printed RIG_UNPROVEN for both judge items: no rig admission record. #154 and #194 gate judging on the judge pre-flight and rr2-pause.py, which both ran; neither calls for rig admission.

## Result

### Exposure smoke

Run review-units-20261104T061457Z-7714, gstack-full, 1 pass on gbrain#7789, gstack#3475 and gstack#3507. rr-gate.py: 3 of 3, gate pass. Hook readout: an evaluating line in 2 of 3 sessions (blocked 1, met 1, met_after_block 1). Exposure: unprompted 2, after-hook 1 (gbrain#7789, the unit whose smoke failed in #187).

### The grids

The hook readout, as printed: "hook readout: 66 sessions; an evaluating contract-log line in 58 (delta.json lists the log in 66, linked in 66, lost in 0); lines: blocked 43, met 15, met_after_block 39, miss 4, fail-open 0 (unknown shape 0), deferred 27, no contract 0; routing log in 66 sessions, routed 52" and "exposure timing: unprompted 24, after-hook 42, late, no dispatch block 0, unknown (log lost) 0, absent 0; the final block differs from the first in 12 of 44 sessions with two or more blocks". All 12 sessions whose final block differs are after-hook sessions.

Driver diagnostics, rr-held.py's readout for each arm as printed:

    held gstack-full-opus: 66 sessions; held rescues 0 (arm.json 0); scored_turn.rule final 66
    cause gstack-full-opus: clean 66, deadline 0, tasks_pending 0, no session_end 0
    deadline gstack-full-opus: 0 deadline gaps, block_present_at_deadline 0
    waited gstack-full-opus: 18 sessions waited, 2785.7 s idle in all
    held none-opus: 66 sessions; held rescues 0 (arm.json 0); scored_turn.rule final 66
    cause none-opus: clean 66, deadline 0, tasks_pending 0, no session_end 0
    deadline none-opus: 0 deadline gaps, block_present_at_deadline 0
    waited none-opus: 0 sessions waited, 0.0 s idle in all

The background-wait path held: 18 gstack-full sessions waited 2,786 s in all, and none hit the deadline.

### The comparison

rr-decide.py, as printed:

    R2 rerun counts: cap stops gstack-full 0 (turn_cap 0, allowance_stop 0), none-rr 0 (turn_cap 0, allowance_stop 0); units dropped by --drop-gaps 0 of 33
    R2 rerun count: gstack-full found 22 of 84 blocking blocker-passes, none-rr 3 of 84; difference +22.6 points [95% CI +11.0, +33.7]
    R2 rerun outcome: KEEP. The full procedure found more blocking blockers than plain Opus 5.5, and the interval is above zero.

The scorer's line: "Blocking recall 26.2% vs 3.6%, delta 22.6 points [95% CI 11.0, 33.7]; 2 losses, 16 gains on 42 blockers in 26 PRs (14 discordant). p non-inferior 0.000041, p loss 1.000 (minimum reachable 0.000061)." Its NO_LOSS line at the 10-point margin decides nothing. It also says no release claim may be made, because stacks-r1 is a development suite.

Judging: the matching batch had 0 unjudged, a second read on 36 blockers at kappa 0.93 and a third read on 6. The adjudication batch had 0 unjudged, a second read on 22 findings at kappa 0.09 and a third read on 10.

### Table 1: who judged, descriptive

This table decides nothing and spent nothing. Each row reruns the rig's own judge-join, ingest, `derive --drop-gaps` and score at 715f837 on the run's replies. A one-judge row hands judge-join that judge's answers in both the primary and the second slot, so no third read is needed. Before the variants, a control rerun of the matching join with no adjudication at all gave the same +22.6 [11.0, 33.7], so blocking recall reads none of the adjudication batch.

The matching batch decides blocking recall. The second judge read 36 of the 48 blockers in the packets: every blocker where the arms differed under the primary, plus a seeded 20% sample.

| Matching judge | gstack-full | none-rr | Difference [95% PR-clustered CI] |
|---|---|---|---|
| As run: Opus 5.5, with Sonnet 5.5 deciding the 6 blockers where Opus and Sol differed | 22/84 (26.2%) | 3/84 (3.6%) | +22.6 [+11.0, +33.7] |
| Opus 5.5 alone | 22/84 (26.2%) | 3/84 (3.6%) | +22.6 [+11.0, +33.7] |
| GPT-6.1 Sol on the 36 it read, Opus 5.5 on the other 12 | 22/84 (26.2%) | 3/84 (3.6%) | +22.6 [+10.5, +33.3] |

The adjudication batch rules on unmatched blocking findings: defect, not-defect or known-informational. The second judge read 22 of the 62: every finding the primary ruled not a defect, plus a seeded 20% sample. Opus and Sol differed on 10 of those 22.

| Adjudicator | Blocking recall difference | New blockers per pass per PR (count) | Difference [95% CI] | False blockers per PR | Difference [95% CI] |
|---|---|---|---|---|---|
| As run: Opus 5.5, with Sonnet 5.5 deciding the 10 | +22.6 [+11.0, +33.7] | 0.77 (49) vs 0.13 (8) | +0.64 [+0.31, +1.02] | 0.06 vs 0.02 | +0.05 [-0.03, +0.16] |
| Opus 5.5 alone | +22.6 [+11.0, +33.7] | 0.67 (43) vs 0.13 (8) | +0.55 [+0.27, +0.86] | 0.16 vs 0.02 | +0.14 [0.00, +0.31] |
| GPT-6.1 Sol on the 22 it read, Opus 5.5 on the other 40 | +22.6 [+11.0, +33.7] | 0.83 (53) vs 0.13 (8) | +0.70 [+0.34, +1.09] | 0.00 vs 0.02 | -0.02 [-0.05, 0.00] |

No row's blocking-recall interval crosses zero. The judges disagree about which of gstack-full's extra blocking findings are real defects, so the new-blocker count runs from 43 to 53 and the false-blocker rate from 0.00 to 0.16 per PR. Every new-blocker row stays above zero.

### Table 2: unprompted against after-hook sessions, descriptive

This table decides nothing and spent nothing. It splits gstack-full's 66 sessions by the hook readout's exposure label and puts none-rr's sessions on the same units and pass numbers beside them. **The split is not randomized.** The hook blocks a session that skipped a dispatch, and whether a session skips depends on the unit and the run, so the rows differ in which units they hold. A unit can put one pass in each row. No interval is given: the cells are small, and the rows are not comparable groups.

| gstack-full sessions | Sessions | With a blocking blocker | Blocker-passes | gstack-full blocking | none-rr blocking, same units and passes | Difference |
|---|---|---|---|---|---|---|
| Unprompted | 24 | 19 | 38 | 9 (23.7%) | 2 (5.3%) | +18.4 points |
| After-hook | 42 | 35 | 46 | 13 (28.3%) | 1 (2.2%) | +26.1 points |
| All | 66 | 54 | 84 | 22 (26.2%) | 3 (3.6%) | +22.6 points |

The gain does not rest on the sessions that ran the procedure on their own. Sessions the hook pushed into the procedure found blocking blockers at least as often. But the table can't separate the hook from the procedure. In after-hook sessions the procedure did run, forced by the hook, and every gstack-full session had both the hook and the procedure while none-rr had neither. What this grid measures is gstack's /review as a Claude Code user installs it at this pin, hook included.

### Beside the verdict

Each of these decides nothing.

- **Recall at any severity:** gstack-full 27/42 = 64.3% [51.4, 76.6], none-rr 10.5/42 = 25.0% [15.7, 35.2].
- **New blockers per pass per PR** (unmatched blocking findings upheld as defects): 0.77 against 0.13 (49 and 8 on 32 PRs), difference +0.64 [+0.31, +1.02], exact sign-flip p 0.0005.
- **False blockers per PR:** 0.06 against 0.02, difference +0.05 [-0.03, +0.16] on 32 PRs, p 0.750. Unverifiable not-defect rulings: gstack-full 2, none-rr 1.
- **Idea-card wins:** 5 of 42 blocking blockers found by gstack-full in every pass and by none-rr in none. The null from 10,000 within-unit label swaps has a 95th percentile of 4.
- **Rescue and complete-case sensitivities:** 0 units to drop in either, so both repeat the primary.
- **Cohort14 stratum** (14 units, 29 blockers): 29.3% against 5.2%, +24.1 [9.6, 37.5].
- **Out19 stratum** (19 units, 13 blockers): 19.2% against 0.0%, +19.2 [0.0, 42.3]. The scorer flags it NOLOSS_UNDERPOWERED because the reference is at 0.
- **rr-admit.py on each arm:** gstack-full 26.2% [15.9, 36.9], PASS. none-rr 3.6% [0.0, 7.9], FAIL: "the lower bound is not above 0 (the floor)". The control in this grid sits at the floor by the admission rule.
- **Read audit (none-rr):** across the 66 transcripts and 1,040 tool inputs, none names ~/.capy/drive or ~/.local/share/gstack. Four name `.claude/skills`, all in gstack#3524's two sessions, whose diff changes gstack's install code. One lists the sandbox's own ~/.claude/skills, which printed "No such file or directory". The others build test fixtures under a temp home. Other hits on gstack file names are reads of the gstack PR under review.

### Every unmatched blocking finding

Short paraphrases, grouped by unit. Each was adjudicated blind; the ruling is the deciding judge's. "Third" marks a ruling the Sonnet 5.5 third read decided. Where two passes raised the same issue, both ids share a line.

gstack-full, 53 findings, 49 upheld as defects:

| Unit | Finding | Ruling | Paraphrase |
|---|---|---|---|
| gstack#3593 | p2-4 | defect | An unknown per-call charge counts as over the threshold, so the estimate meter always delegates. |
| gstack#3593 | p1-1 | defect | The parent's close checks the shared review log against its own reservations only and flags a child's rows. |
| gstack#3593 | p2-5 | defect | Close and resume touch the per-branch marker without checking that it names this run. |
| gstack#3593 | p2-1 | defect | The handoff launcher puts the prompt after a variadic flag, so the child reads it as a tool name. |
| gstack#3593 | p1-4 | defect (third) | Step 11 reserves every voice under one id while each voice starts its own pass. |
| gstack#3593 | p1-5 | defect (third) | The child's ledger write replaces the parent's budget block. |
| gstack#3593 | p2-2 | defect | Resume in a fresh session does not rebind when the meter type stays the same. |
| gstack#3593 | p1-3 | defect | Step 9 starts design-review-lite with no reservation guidance and no dispatch role. |
| gstack#3593 | p1-7 | defect | The record parser splits on whitespace and breaks a ledger path that holds a space. |
| gstack#3593 | p1-8 | defect | Rebuilding the ledger for the claude meter counts the session twice or reads zero. |
| gstack#3526 | p1-1, p2-1 | defect | The runtime's numeric line property hides an error class's line() method, so every CLI error crashes. |
| gstack#3526 | p2-2 | defect | A test snapshots a fixture tree that a real CLI on PATH writes into. |
| gstack#3526 | p2-4 | defect | Ownership comes only from the previous ledger, so a mode switch fails on leftover empty folders. |
| gstack#3527 | p1-1, p2-1 | defect | Step 11 skips the native adversarial pass on docs and tests diffs, but Step 11.5 still requires its record. |
| gstack#3527 | p2-2 | defect | The voices run only when no full pass ran, so a fix in pass 1 changes which plan is in force. |
| gstack#3527 | p1-2, p2-4 | not-defect (third) | The quiet revise path checks the severity of incorporated decisions, not the size of the edit. |
| gstack#3527 | p1-4 | not-defect (third) | After a fix-check, the final review record still names the pre-fix tree. |
| gstack#3534 | p1-1 | defect | Rename handling drops a file re-created at the old path from lane selection. |
| gstack#3583 | p1-2, p2-2 | defect | The Captain brief reads sections from a gate copy written only when the gate is built, so a revise that adds one is missed. |
| gstack#3583 | p2-1 | defect | A generated file grows past a test's line cap, so the test fails. |
| gbrain#7511 | p1-1 | defect | The release target picks index mode for any hold with a numeric row number, including older holds. |
| gbrain#7684 | p1-1 | defect | The new in-place admission skips the import gate for current pages. |
| gbrain#7789 | p1-2, p2-3 | defect | A copied heading pattern needs the heading at column 0, while the parser accepts leading space. |
| gbrain#7789 | p1-3 | defect | The structural-line check misses dated lines written with star bullets. |
| gbrain#7789 | p2-1 | defect | A mail citation puts the raw subject line into the page body without neutralizing it. |
| gbrain#7794 | p1-1 | defect | A new doctor check is in one database's goldens but not the other's. |
| gbrain#7878 | p1-1, p2-2 | defect (third) | Company-brain sync and import bypass the new visibility hold. |
| gbrain#7878 | p2-1 | defect | The hold is skipped whenever content is passed in, so large streamed imports miss it. |
| gbrain#7901 | p1-1, p2-1 | defect | The CI reuse step waits up to 90 minutes, longer than the remote gate's timeout. |
| gstack#1808 | p1-3 | defect | On Windows, shell mode joins arguments unquoted. |
| gstack#1808 | p1-1, p2-1 | defect | Starting the browse server kills whatever process holds the shared browser-profile lock, across projects. |
| gstack#1808 | p1-2 | defect (third) | Source drift still runs an unguarded source removal. |
| gstack#1808 | p2-3 | defect (third) | On an import timeout, clean-up deletes the checkpoint the message says is kept. |
| gstack#1808 | p1-4 | not-defect (third) | An existing clone is reused without a fetch, so the pinned commit is ignored. |
| gstack#3381 | p1-2, p2-2 | defect | Turning recall off reports success while the opt-in in the other store keeps it on. |
| gstack#3381 | p1-1, p2-1 | defect | The recall veto no longer checks the remote URL after insteadOf rewriting. |
| gstack#3381 | p2-3 | defect | A dangling store symlink now counts as a store. |
| gstack#3448 | p1-2, p2-2 | defect | A test does not pin the platform, so it fails on macOS and Windows. |
| gstack#3475 | p1-1, p2-1 | defect | Raising the minimum wrapper revision turns a mixed-revision machine from pass to fail. |
| gstack#3494 | p1-1, p2-1 | defect | The worktree audit honors showUntrackedFiles=no, so a worktree holding only untracked files reads clean. |

none-rr, 9 findings, 8 upheld as defects:

| Unit | Finding | Ruling | Paraphrase |
|---|---|---|---|
| gstack#3593 | p1-1 | defect | Under a token cap, Step 9's design-review-lite start is refused because the template gives it no reservation. |
| gstack#3593 | p1-2 | defect | The estimate meter never reports a per-call charge, so it always delegates. |
| gstack#3524 | p1-1 | not-defect | A helper reads the real global install instead of a fixture. |
| gstack#3527 | p2-1 | defect | Gate signals apply only when the diff is already code-class. |
| gstack#3534 | p1-1 | defect | The import graph drops a rename's old path even when the file still exists there. |
| gstack#3534 | p2-1 | defect | Deleted tests outside JS and TS now pass the lanes check. |
| gbrain#7674 | p2-1 | defect | A new notice row is pinned to a release that already ships its own row. |
| gbrain#7684 | p2-1 | defect | The in-place waiver also applies to a user's full sync. |
| gstack#1808 | p2-1 | defect | Starting the browse server kills whatever process holds the shared browser-profile lock. |

### Context only: other runs on the same units

These ran at other settings and decide nothing here. On the out19 units, R2 (GEVA-175's post) had gstack-full and plain Opus 5.5 both at 0 of 13 blocking blockers, and #108's arms were also at 0 of 13 against 0 of 13. GEVA-229's admission pilot (#187), the same no-gstack arm over 5 passes, read 5.7% [3.0, 8.6] on all 33 units, against none-rr's 3.6% [0.0, 7.9] here.

## Why null? (R48)

This is not a null, but #194 asks for the cycle beside the verdict.

- **Exposure.** The procedure ran in all 66 gstack-full sessions by the gate's count: 24 unprompted, 42 after the hook blocked. The gain appears in both groups (table 2).
- **Task fit and floor.** The control sits low: 3.6% [0.0, 7.9], at the floor by rr-admit.py's rule, and at 0 of 26 on the out19 units. gstack-full lifts off it on both strata.
- **Power.** The MDD at 2 passes is 24.5 points. The estimate, +22.6, sits under it, but the interval excludes zero.
- **Today's frontier model without the skill.** Plain Opus 5.5 found 3.6% of blocker-passes as blocking and 25.0% at any severity.
- **Verdict: KEEP.** No CUT-CANDIDATE: gstack-full found more blocking blockers than none-rr.

## What this steers

- **The procedure helps on frontier Opus at this pin, and the hook is part of why it runs.** 42 of 66 sessions dispatched their readers only after the contract hook blocked them. Work that makes the procedure run unprompted would cut gstack's reliance on the hook. The hook is what a user gets today, so this result covers it.
- **Cost per session is the price.** gstack-full cost 8.9 times as much per session. Per blocking find, it cost somewhat more, because it found about 7 times as many.
- **The upheld unmatched findings are candidate blockers.** gstack-full raised 49 unmatched blocking findings that blind adjudication upheld as defects. A later suite version could review them as blockers. They count for nothing here.

## Limits and threats

- The exposure split is not randomized, and its cells are small (table 2).
- The adjudication judges agreed at kappa 0.09 on 22 findings. That moves the new-blocker and false-blocker readings (table 1), not blocking recall.
- The control sits at the floor by the admission rule, so the difference is mostly gstack-full's own recall. GEVA-229's pilot read the same arm higher, at 5.7% over 5 passes.
- 2 passes give an MDD of 24.5 points, above the estimate. The interval excludes zero, but a run this size had less than 80% power for an effect of +22.6.
- stacks-r1 is a development suite, so the scorer licenses no release claim. The claim holds for these 33 units at these settings.
- 8 of 66 gstack-full sessions left no evaluating contract-log line. The readout still timed their dispatches, and none counts as late or absent.
- Decisions A and A1 relabelled 6 findings and hid one finding's text after the run. Neither can move blocking recall.

## Replicate it

Each launch ran #194 section 10's command through the operator's wrapper: rr2-pause.py, the command with `--dry-run`, the command, `rr2-pause.py --append` on its stderr, then `--match`, rr-gate.py, the hook readout and, after the smoke, the re-cost. Grading then ran #154 section 7's order at rig 715f837: r2-source.py, sevmap.ts with decision A's map entry, the scrub chain, the p1-2-sg rename, blind.py, ingest with `--digest-only p1-2-sg`, judge-packet, the judge pre-flight, rr2-pause.py, judge-run, judge-join and ingest for each batch, then `derive --drop-gaps`, score, rr-decide.py, the secondaries, rr-admit.py, the sensitivities and the strata.

For table 1, build reply files from the batch's own replies. For a one-judge row, put that judge's answers on the second judge's set in both slots. For the second-judge row, put the second judge's answers in the primary reply on its set, and pass the same answers on whatever set judge-join then names. Run judge-join, ingest, `derive --drop-gaps` and score as above. For table 2, join the hook readout's exposure column to each arm's scored judgments.tsv by unit and pass, counting only blockers whose `counts` is blocking. The scripts that did this print counts only and sit in the run record. The record holds the printed lines; it leaves out the transcripts and the ledger database.

## What is held out, and why

Nothing here is sealed. The session transcripts and findings stay on the run machine, because they quote code from the units' private repositories, so the findings above are paraphrased. The one finding that quoted the sealed guard's marker appears by digest only. This post carries counts and digests.

## Changelog

- 2026-11-04: first version (GEVA-271).

<details>
<summary>Agent notes</summary>

| Field | Value |
|---|---|
| Grade | Run under a merged preregistration ([2026-11-03-geva-255-r2-after-pin-amendment](../plans/2026-11-03-geva-255-r2-after-pin-amendment/README.md), #194, amending #154). The verdict is rr-decide.py's, as printed. |
| Verdict | KEEP. Control rate (none-rr) 3.6%. MDD 24.5 points at 2 passes. No judge variant's interval crosses zero. |
| Exposure | gstack-full ran the procedure unprompted in 24 of 66 sessions and only after the contract hook blocked in 42. |
| Paid calls | $504.78 in all: smoke $21.30, gstack-full grid $430.28, none-rr grid $48.45, matching $2.91, adjudication $1.84. |

It also cost 8.9 times as much per session ($6.52 against $0.73).

Every session ran from gstack-evals 176fdc7 on Opus 5.5 with Claude Code CLI 2.1.314, the claude-code-preset system prompt, bundled skills off, 200 turns, a $40 allowance, `--cap-stops`, `--timeout 10800` and a 3600 s background wait, in the rig's Docker sandbox (image gstack-evals-trial:f62711a0a17fc1e9). gstack-full ran garrytan/gstack 699a41cb (VERSION 1.94.39.0) from `./setup --host claude --no-browser -q`, told /review with #194's prefix and reader map.

The relaunch ran fresh under the same $240 cap, since the first attempt never bound.

The re-cost took the dearest session, $7.61, to a grid projection of $662.53, inside the $770 cap. $21.30.

gstack-full, run review-units-20261104T070239Z-cbff: 66 sessions, 0 cap stops, 0 gaps, 0 held rescues. rr-gate.py: 66 of 66 returned, a specialist with tokens in 66, adversarial-native in 66, red-team in 57; gate pass. $430.28.

none-rr, run review-units-20261104T123631Z-3fb3: 66 sessions, 62 with findings and 4 empty, 0 cap stops, 0 gaps, 0 held rescues. $48.45.

**Cost**

| Ledger item | Cap | Settled |
|---|---|---|
| rr2-smoke-full | $120 | $21.30 |
| rr2-grid-full | $770 | $430.28 |
| rr2-grid-none | $240 | $48.45 |
| rr2-judge-match | $200 | $2.91 |
| rr2-judge-adjudicate | $200 | $1.84 |
| **Total** | **$1,530** | **$504.78** |

Every lease settled under its cap, with $0 unknown and 0 unknown calls. The failed attempts in deviations 1 and 2 spent $0.

| Run | Sessions | Input | Cache read | Cache write | Output | Total tokens | Dollars | Per session | Per blocking find |
|---|---|---|---|---|---|---|---|---|---|
| Smoke, gstack-full | 3 | 845 | 29,236,967 | 2,071,552 | 256,296 | 31,565,660 | $21.30 | $7.10 | |
| Grid, gstack-full | 66 | 15,239 | 590,064,279 | 42,053,429 | 5,106,804 | 637,239,751 | $430.28 | $6.52 | $19.56 |
| Grid, none-rr | 66 | 2,118 | 71,147,852 | 4,365,123 | 619,377 | 76,134,470 | $48.45 | $0.73 | $16.15 |
| Matching judges | | 341,808 | 0 | 163,521 | 69,582 | 574,911 | $2.91 | | |
| Adjudication judges | | 281,794 | 0 | 91,236 | 36,951 | 409,981 | $1.84 | | |

The ledger reports the judges' reasoning tokens separately: 7,265 and 950. Per blocking find divides an arm's grid dollars by its blocking blocker-passes found (22 and 3).

Prices are the pinned table (src/runner/pricing/prices.ts at 176fdc7 and 715f837, the same pins as #187), in dollars per million tokens:

| Model | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| claude-opus-5-5 (sessions, primary judge) | 4 | 20 | 0.20 | 5 |
| claude-sonnet-5-5 (third judge) | 2 | 10 | 0.20 | 2.50 |
| gpt-6.1-sol (second judge; above 272,000 input tokens: 4, 15, 0.20, 5) | 2 | 10 | 0.10 | 2.50 |

Crew model use sits outside the ledger. At the last crew reading it was $115.52 including this thread, which puts the run at about $709 of #194's $2,000 all-in with the earlier threads' $89.06.

From the summary: $504.78.

The operator's launch wrapper misparsed a value it reads before launching and stopped there: no out dir, no lease, $0.

It exited 2 with empty stderr, never leased and spent $0.

Per blocking find, it cost $19.56 against $16.15, because it found about 7 times as many.

</details>

## Disclosures

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.
