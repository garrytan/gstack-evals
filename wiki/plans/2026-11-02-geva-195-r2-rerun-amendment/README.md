---
id: 2026-11-02-geva-195-r2-rerun-amendment
kind: plan
title: "R2 rerun amendment: the full /review procedure against no gstack on the fixed driver (#141), all 33 stacks-r1 units, a floor admission pilot first"
summary: "Reruns R2 on #141's driver with its held read (A1) and deadline-as-gap (B1) rules frozen, on all 33 stacks-r1 units at 2 passes, after a no-gstack admission pilot and an exposure smoke."
author: GEVA-195
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-02
status: open
links:
  - 2026-11-01-geva-101-r48-follow-ups-prereg
  - 2026-11-02-geva-122-r2-amendment
  - 2026-11-02-geva-175-r2-full-review-results
  - 2026-10-31-geva-76-stacks-round-1-prereg
attachments:
  - d74c0bee01a73674fe92de8603cf07c000f3fc469917752fef841c037feaf9db  comparisons.rr.json
  - 7049f083d41bc41a5ca2c672c7bcc0706e4b1059e9dfbac74568eccf04275635  dry-run-rr.sh.txt
  - d7c1043f90088344efa6b0d564ea98eff6392af9b77cf4f4adc6dee110a7226a  dry-run-rr.txt
  - 21093ca9fc8c1744b2e418c3a6cc1110601b213da77f340fa962808b90a31528  power-rr.py.txt
  - a17fc2c08073053c225258af9448f3e520cfd03cfa7f23593e0750646587051d  reader-map-gstack-5209e9262d80.json
  - a03c399e4d7dad2b0105a64b5cad45993a8143abe864fc390321a0563c469c7d  rr-admit.py.txt
  - 45c5f92089a95de130dcfef3e5273a886cc0a6470041d415960cce4e83602324  rr-decide.py.txt
  - 3aa3ac323f5789f1496d3862fed73e334e1d1fd7fcf052417b2d57a87c5f2548  rr-gate.py.txt
  - cc708fa60c0c354bc48a6ca54117dcc3357b272a5f5bc9e880c0d4ed7ebb92c3  rr-held.py.txt
  - e6aefa5da928b40b6aeecd676e6ff09b12d4380ba839eefa6d48a83d4ec92afb  rr-pause.py.txt
  - 93feee1358443a88cbd612cd4d4892aa11faf5fc31c027e0a81ee90f08fc966a  rr-stub-arms.ts.txt
---

# R2 rerun amendment

This post amends section 3 (R2) of [2026-11-01-geva-101-r48-follow-ups-prereg](../2026-11-01-geva-101-r48-follow-ups-prereg/README.md) (#112) as [2026-11-02-geva-122-r2-amendment](../2026-11-02-geva-122-r2-amendment/README.md) (#129) amended it. R2 ran once and gave no outcome ([results, #138](../../board/2026-11-02-geva-175-r2-full-review-results/README.md)). This post sets up a fair rerun. Every rule, pin and attachment of #112 and #129 that this post does not change stands as written, and R1 and R3 are unchanged. Where this post names an attachment of #112 or #129, it means that file in its own folder, pinned by its sha256 there.

What changes, in short:

- The driver is #141's (GST-734): a headless session stays open while background work it started is out, up to a deadline. #141's held read rule (A1) and deadline-as-gap rule (B1) are frozen here.
- The set is all 33 stacks-r1 units, at 2 passes an arm, not the 19 out-of-cohort units at 1 pass. The 19 units sit on a floor (section 1).
- A paid grid starts only after an admission pilot shows the no-gstack arm off the floor and below the top, and after a 3-session exposure smoke of gstack-full.
- GPT-6.1 Sol and R56-1 (/ship's review panel) each need a code change first, so each follows in its own short amendment (section 9).

The rerun is also the first real test of gstack's background-reader path under a driver that waits. GStack Minder's two repros for GST-950 (canceled) went through gstack's own launcher and never dispatched a reader, so they did not exercise this path.

## 1. Why R2 sat on the floor, and why the set changes

R2 caught 0 of its 13 blocking blockers in both arms (control 0%, MDD about 43 points). Before choosing a rerun set, this post read R2's judged arms keyless (Captain drive handoffs/GEVA-151/run/out/final, with stacks-r1.json and labels.tsv at 176fdc7) to find out why. No model was called.

| Cause | What R2's judged arms show |
|---|---|
| Judge matching | Not the cause. Matching agreed fully where two judges read (kappa 1 on 7 blockers). The only CRITICAL findings on a blocker's own file (gstack-full on gstack#3381 and gstack#3448) name other defects than the one the fix commit's test pins down, and on gstack#1808 both arms' blocking findings sit on other files. |
| Severity | Every detection was downgraded. gstack-full reached 3 of the 13 at some severity and none-r2 reached 4, and all 7 were rated non-blocking (INFORMATIONAL, medium). The suite's judging rule counts a downgrade as missed. #108 saw the same on the full suite: gstack-opus found 12 of 42 at some severity. |
| Session ending | gstack-full only. It had no report on 5 of the 13 blocker PRs, the GST-734 limit #141 fixes. none-r2 had no missing session, so this explains none of its zero. |
| Blocker difficulty | The rest. 9 of 13 (none-r2), and 5 of the 8 PRs where gstack-full returned a session, were not reached at any severity. Each label is one narrow case that a later fix commit's test pins down, while the diffs hold other real defects: blind adjudication upheld 9 (gstack-full) and 4 (none-r2) unlabelled blocking findings. |

**The 19 units fail admission from data in hand.** Plain Opus 5.5 found 0 of the 13 as blocking in R2's none-r2, which ran at the settings this rerun keeps for its no-gstack arm (claude-code-preset, CLI 2.1.314, 200 turns, $40; #141 changes nothing for a session that never waits), and 0 of 13 in each of #108's two none-opus passes. A paid pilot on those units would only restate that.

**The rerun set is all 33 stacks-r1 units** (GSTA-2's pick): 42 blocking blockers on 26 PR clusters, plus 6 over-blocking units. #108's none-opus found 3 of the 42 as blocking, 7.1% [2.1, 13.9], all three among the 14 units of GSTA-167's cohort. That ran on the SDK's empty system prompt and the old driver, so the admission pilot (section 5) measures the control again at this post's settings. The 33 units include R1's cohort of 14 (gsta167-14pr), which R1 judged before choosing to run R2, so the rerun is not independent of R1 on those 14. The results post reports the cohort and the out19 units as strata (section 7).

| Set considered | Blockers, PR clusters | Control from data in hand | MDD at 1 pass | MDD at 2 passes |
|---|---|---|---|---|
| out19, blocking (R2 as run) | 13, 13 | 0 of 13, three times | 39 | 27 |
| out19, any severity | 13, 13 | 4 of 13 (R2), 2 of 13 (#108) | 44 | 31 |
| cohort14, blocking | 29, 14 | 3 of 29, 10.3% [3.1, 20.8] (R1, blind) | 27 | 19 |
| **all 33 units, blocking (this rerun)** | **42, 26** | **3 of 42, 7.1% [2.1, 13.9] (#108)** | **22** | **16** |

MDDs here use #112's R1 method (power-rr.py): the standard error of the arms' difference at a 30-point lead, simulated on each set's own clusters with a wide spread, times 2.8. #112's exact figure for R2's KEEP rule on the 19 units was about 43 points; this method gives 39 at 1 pass.

## 2. Pins

| What | Pin |
|---|---|
| gstack-evals for every session (pilot, smoke and grid) | main 176fdc75e04626e736b0c3c93d45a45937e45508, #141's merge commit. Every session runs from a checkout of it; the operator records `git rev-parse HEAD` before each review-units command |
| gstack-evals for judging and scoring | rig 715f837, as #112 and #129 pin it, so blind.py, judge-run, noloss and r2-source.py run where R2's dry run proved them |
| gstack under test (gstack-full) | garrytan/gstack 5209e9262d8068a75b29be562fbc1de82ba8b487, v1.93.6.0, gstack main when #141's build froze; main reached v1.93.9.0 before this post froze, with no change to /review (section 2, below) |
| gstack render | interactive, gstack setup's default, as #129 |
| Claude Code | CLI 2.1.314, the one bundled with the pinned Agent SDK 0.3.314 (package.json at 176fdc7), on both arms |
| System prompt | claude-code-preset on both arms |
| Bundled skills | off in both arms (CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, src/adapters/claude-code/driver.ts:179 at 176fdc7) |
| Turn cap, allowance, cap stops | 200 turns and $40 a session on both arms, `--cap-stops` on every run, as #129 |
| Background wait | 3600 s, review-units' default (BACKGROUND_WAIT_MS); run.json records background_wait_s 3600 |
| Session timeout | `--timeout 10800` on every run (R2 ran with it under a Captain deviation; frozen here) |
| Reader map | reader-map-gstack-5209e9262d80.json (attached), pinned to the gstack commit above |
| Read rule at the pin | sha256 at 176fdc7: held.ts 17e499d578cbd45db307cad55b759ff6354ca4dae2c0dd0879549bff572dc2c7, findings.ts 584c81bcc40202798713cec9647c3a45c282373b379196e8fee413caa7ddb959, capped.ts 717e33723cd1a4d2acc8d7d11d8e7dd3f966b609855c2c28df98b6a45fc38fa9, readers.ts 339541c8ffcf3926666bcfb1b7fc531f10b34c45f57445e8dfd58026dfd2c06c |
| Suite | wiki/plans/2026-10-31-geva-76-stacks-round-1-prereg/stacks-r1.json, sha256 4f46bb17b7ef98a34db9bf4b03c69755c694eb17dfc7ca0e29e1049a1bcc9a1d, as is (no derive) |
| Judges, brief, seed | as #112: Opus 5.5 primary, gpt-6.1-sol second, Sonnet 5.5 third read; #108's judge brief; seed 20261031 |

**Why gstack moves from 77fe28c.** The rerun tests today's gstack. R2 gave no outcome, so there is no result to stay comparable with. One change matters for this rerun's path: at 5209e92, /review's Claude adversarial subagent (review/sections/adversarial.md) is told to dispatch with `run_in_background: false` when available and to await a background launch's completion notice. Specialist readers keep gstack's own dispatch. The driver waits either way.

**Why the pin stays at 5209e92.** gstack main reached v1.93.9.0 (d45c3501) on 2026-11-02 while this post was written. Between the two commits, 39 files changed, and none is under review/. The changes are /ship's receipts, stamps, queue and review loop. gstack-review-plan and lib/review-depth.ts change only what happens when the loop's plan would stop (Step 11's voices on gate-class code, an owner's grant after round 2), and a plan that doesn't stop is unchanged. So the /review procedure under test matches the newest release, and the reader map and the dry run stand.

**The reader map.** It keeps #129's map shape and names, re-pinned to 5209e92: the ten Review Army checklists (each path checked present at the pin), plus review/specialists/targeted.md as `targeted`, the reader gstack's planner adds on money, gate, auth and secret code (lib/review-targeted.ts at the pin). The adversarial marker is unchanged and present at the pin.

## 3. Set, arms and passes

The suite is stacks-r1.json as it stands: 33 units, 42 blocking blockers on 26 PR clusters, 6 over-blocking units. gstack#3516 appears at two heads, one in each stratum, so its cluster holds 3 blockers across 2 units.

| Arm (source id) | Model | What it gets |
|---|---|---|
| none-rr | Opus 5.5 | no gstack installed; #108's none told line, unchanged (no prefix) |
| gstack-full | Opus 5.5 | gstack at the pin, invoked as /review with R2's told prefix, unchanged (told-gstack-full.txt in #129, prefix sha256 db9ec7b42f9b2e86c7f51354d581cb47d775fbbc2ebe4e8a229764a5f92540ad) |

Each arm runs 2 passes on all 33 units: 66 sessions an arm, 132 in the grid. The PR is the pairing cluster. As in R2, review-units gives gstack-full in an Opus 5.5 cell gstack's Codex outside voice on gpt-6.1-sol (src/arms/cells.ts at 176fdc7); R2's voice row stayed at 0 in all 19 sessions. Its voice-row tokens are reported.

**Where the no-gstack arm runs, and why it is clean.** Every session runs in the rig's Docker sandbox with one bind mount, the trial's work dir (src/trial/sandbox.ts at 176fdc7), on an arm image with no layers for none-rr, with bundled skills off. No Capy drive and no gstack install exist in its environment, so the arm is clean by construction. The read audit (no tool input naming ~/.capy/drive, ~/.local/share/gstack or ~/.claude/skills) runs after the run on all 66 none-rr transcripts and is reported as a descriptive check, as in R2.

## 4. Scoring rules from #141, frozen

**A1, the held read rule** (src/trial/review/held.ts at 176fdc7, sha256 in section 2). A completed code session that waited on background work (session_end.waited_ms > 0, rounded up) and whose final turn has no json block at all is scored from the latest main-agent text whose last json block is an array (its body starts with `[` after whitespace), when that text sits in an earlier CLI turn than the final text; turns split at result events in transcript.ndjson. A malformed array there stays malformed. Only array-bodied json blocks count, so a json object an earlier turn wrote, such as a plan, is ignored. A block in the final turn always wins, waited or not; a malformed final block stays malformed; a session that never waited scores exactly as findings.ts's final-turn parse; cap-stopped sessions are scored by capped.ts as #129 section 3 says. Every code session records scored_turn (rule final, held or capped).

**B1, the deadline is a gap.** A session that reaches the background deadline ends E_BACKGROUND_DEADLINE: a missing cell, never a miss and never the arm finding nothing. Idle time counts, in all, from each turn's result to the start of the main agent's next turn: the CLI's turn init or the earliest event of that turn, whichever comes first. So the clock never runs while a turn does, and the deadline is 3600 s of idle time in all, not per wait. session_end.findings_block records whether a findings block existed at the deadline; it is reported and never scored.

**Gaps, and the coverage rule.** At the pin, a code unit's gap is a malformed or incomplete pass: a deadline (B1), an infra failure, a provider or upstream failure, a refusal, a crash or a timeout. review-units marks the arm stopped and lists the gap. A gap is never rerun inside the run, whatever caused it. The comparison is scored through `noloss derive --drop-gaps`, which drops every unit with a gap in either arm from both and marks the arms complete again. **If that drop removes more than 3 of the 33 units, R2's rerun gives no outcome** and goes to the Captain as FIX-METHOD with the gap list. Gap counts per arm, by cause, are printed beside the verdict.

**Cap stops** keep #129's rule (scored against their own arm, never a gap), scaled to 66 sessions: **if more than 6 of either arm's 66 sessions end in turn_cap or allowance_stop, the rerun gives no outcome.** The complete-case sensitivity of #129 section 3 is reported beside the verdict.

**Reported per arm, beside the verdict** (rr-held.py, attached):

- held rescues: sessions scored by the held rule that parse as findings (arm.json held_rescues), and the count of each scored_turn.rule;
- session_end.cause counts: clean, deadline, tasks_pending, and sessions with no session_end;
- block_present_at_deadline: deadline gaps whose session_end.findings_block is true;
- sessions that waited (waited_ms > 0), and their total idle time.

**Rescue sensitivity.** A rescue rule that applies only to held sessions favors the arm that holds more often. So beside the primary, the primary is rerun without rescued sessions: every unit with a held-rescued session in either arm, in either pass, is dropped from both arms (rr-held.py writes the drop file; `noloss derive --drop-file`), and the scorer runs on the rest. It is reported and never decides.

## 5. Admission pilot and exposure smoke (E1)

The pilot answers one question before any grid: does plain Opus 5.5 sit clearly above zero and clearly below the top on this primary, on this set, at these settings?

**The run.** The none arm, 1 pass on all 33 units, at the pins above, on item rr-pilot-none. Its source arm (id none-pilot) goes through the same ingest, scrub, blinding and one matching batch as the grid (section 7), on item rr-pilot-judge. No adjudication runs; the pass line reads blocking recall only.

**The pass line** (rr-admit.py, attached). First `noloss derive --drop-gaps` on the judged pilot arm; if that drops more than 3 units, the pilot is incomplete and goes to the Captain with no admission. So is a pilot whose review-units arm left any session not run (arm.json parse_outcomes.not_run above 0) or stopped for any reason other than coverage gaps, which the drop rule handles: it is incomplete, gets no admission and goes to the Captain, so an interrupted pilot can never pass. Then blocking recall on the remaining blockers, with a PR-clustered 95% percentile bootstrap (10,000 draws, seed 20261031). **The pilot passes when the interval's lower bound is above 0 and its upper bound plus the MDD is at most 100 points.** The MDD is the larger of two, both from power-rr.py's method on the derived suite's clusters at the grid's 2 passes: the MDD at the pilot's point estimate, and the MDD at the planning control rate of 7.1% (section 1, 16 points on all 33 units). The second keeps a pilot at the ceiling from passing: at 100% recall the interval is [100, 100] and the MDD at the point estimate is 0. A fail stops the rerun on this set: the run thread reports the numbers to the Captain, and no grid runs.

**Pilot sessions are admission data only and never enter the grid.** The grid's none-rr arm is a new review-units run with its own run id, in its own out dir, on its own item, and never resumes from the pilot's. No pilot finding, judgment or score is read by any grid step.

**Exposure smoke.** gstack-full runs 1 pass on 3 units, on item rr-smoke-full: gbrain#7789@49eb4da5f7c8, gstack#3475@fc69d3ff0bfe and gstack#3507@8c021d124220, the three R2 sessions that dispatched both kinds of reader and ended before the readers returned. Smoke sessions are never judged or scored. **The smoke passes when all 3 sessions meet gstack-full's gate (section 6).** If it fails, no grid runs, and the run thread reports to the Captain with each session's readers, parse and session_end. The smoke also measures gstack-full's cost a session, and the run thread re-costs the grid from it before the grid starts.

**Order.** The pilot and the smoke run in either order, both before the grid. The pilot's cap goes to the Captain before it runs. The grid needs a passing pilot, a passing smoke, and caps the Captain recorded.

## 6. Exposure gate, counted on returned reports

A PR-pass **returned** when its session's parse outcome is findings or empty (a findings block was scored, by the final, held or capped rule) and every reader row the gate needs has a numeric total_tokens, which the build writes only when that reader's task notification arrived (src/trial/review/readers.ts at 176fdc7). A reader still out when the session ended has total_tokens unavailable and does not count. A specialist is a reader row named for one of the map's checklists or batched, as #129's gate counts it.

**gstack-full's gate:** a PR-pass passes when it returned with a specialist (a reader row named for one of the map's nine Review Army checklists other than red-team, or batched) and adversarial-native. **It needs 60 of the 66 PR-passes (90%)**, R2's threshold. The smoke uses the same rule on its 3 PR-passes and needs all 3. targeted, red-team and the voice row are counted and reported, not gated. rr-gate.py (attached) prints the counts per reader and exits 0 on a pass, 3 on a fail and 5 on bad input, with #129 section 6's reader-row format and bad-input rules unchanged. A failed gate gives no outcome.

## 7. Judging, scoring and the decision

**Before blinding**, in this order, on every source arm (the pilot's included): r2-source.py (#129) to set the source id; GEVA-89's sevmap.ts (sha256 b3724a71fe4ee0a8a70eb454115d8e815679ab62066771541f975f9e197a66ea) and R1's scrub chain with the suite set to stacks-r1 (scrub.ts c3829af6, scrub2.ts cad13e6a, r1-scrub3.ts 3a462a55), the two steps R2 ran under the Captain's decision A (#138, deviation 6), now frozen; then #129's blind.py. The pilot's ingest runs on real arm output before any grid, so a refusal shows before the grid spends.

**Judging.** One matching batch (rr-judge-match) and one adjudication batch (rr-judge-adjudicate) over both source arms, judges and brief as #112, at rig 715f837.

**Scoring.** `noloss derive --drop-gaps` on the two arms, then `noloss score` with comparisons.rr.json (attached: gstack-full-vs-none against none-rr, the lane's 10-point margin and size rule, seed 20261031). Blocking recall pools both passes per blocker.

**The decision** (rr-decide.py, attached), in this order. The Holm family is this one comparison, so KEEP is R2's own interval rule:

1. **No outcome** when gstack-full's gate failed, the cap-stop rule or the coverage rule fired (section 4), or the scorer gave no verdict, delta or interval. It goes to the Captain as FIX-METHOD with the counts. Bad input makes rr-decide.py exit 5, an error and never an outcome.
2. **CUT-CANDIDATE** when gstack-full found no more blocking blocker-passes than none-rr. The Review Army and the adversarial pass go to Garry with the record.
3. **KEEP** when the scorer's 95% PR-clustered interval of the recall difference is above zero.
4. **FIX-METHOD** otherwise: gstack-full found more, but this grid can't show it.

The scorer's NO_LOSS, LOSS and size-rule lines print and decide nothing. Reported beside the verdict, deciding nothing:

- the rescue sensitivity, the complete-case sensitivity and the counts of section 4;
- the strata: the cohort's 14 units (29 blockers) and the out19 units (13 blockers), each through `noloss derive --drop-file`;
- recall at any severity, new blockers per pass per PR, false blockers per PR on the 6 over-blocking units, and every unmatched blocking finding as a paraphrase;
- tokens and dollars per arm, and per blocker found;
- R2's and #108's lines on the same units, labelled as other settings.

## 8. Spend: items, caps and the pause rule

Caps are sized for the science (R57): every review-units item's cap is its worst case at the allowance, sessions times $40, so the allowance binds before an item cap can. Judge items cap at judge-run's worst case for a batch of their real size. The dry run fits judge-run's per-packet worst case on its stub batches, sizes each packet at R2's largest session (9 findings at R2's line length, 27 stub-sized findings) times the sessions a packet holds (1 in the pilot, 4 in the grid), takes 33 packets, doubles the sum because judge-run may ask every answer again once, and rounds up to the dollar. Expected spend uses R2's metered rates: none-r2 $0.83 a session; gstack-full $3.36 a session over all 19, and $3.80 to $9.19 for the sessions that ran the full procedure and returned. The smoke re-costs the grid before it starts.

| Item | Sessions | Cap (worst case) | Expected |
|---|---|---|---|
| rr-pilot-none | 33 | $1,320 | about $30 |
| rr-smoke-full | 3 | $120 | $10 to $30 |
| rr-pilot-judge | 1 batch | $176 | about $1 |
| **Pilot total** | | **$1,616** | **about $40 to $60** |
| rr-grid-none | 66 | $2,640 | about $55 |
| rr-grid-full | 66 | $2,640 | $250 to $610 |
| rr-judge-match | 1 batch | $209 | a few dollars |
| rr-judge-adjudicate | 1 batch | $1,130 | a few dollars |
| **Grid total** | | **$6,619** | **about $310 to $680** |

Every item serves one run: its first lease binds it, and a second run on it is refused (E_ITEM_BOUND). A resume of the same run, with the same run id, may take a further lease, as R2's none-r2 did.

**The pause rule (GSTA-2, for R42).** The run thread stops launching new sessions, and reports to the Captain, before this rerun's settled plus reserved spend, summed over every item above (pilot items included), would pass $4,500. It works through each launch's spend cap: before every review-units command and every judge batch, the operator runs rr-pause.py (attached) on the ledger, which prints the headroom (4500 minus settled minus reserved, over this post's items) and exits 3 when the headroom is below one launch round's worst case. For a judge batch, that worst case is the larger of the batch's printed worst case and the item's remaining cap, because judge-run at 715f837 opens its lease with no amount and the ledger then reserves all the item has left. Each review-units launch takes `--spend-cap` equal to the smaller of its item's remaining cap and that headroom. review-units starts a round only when the round's worst case (each session at its allowance) fits under the spend cap, so it stops between rounds, never inside a session. That stop is the pause, not a cap stop of the item, and it changes no score. The run resumes, with `--resume` on the same run, only on the Captain's word, and nobody reads an outcome, judgment or score of this rerun in between. With the caps above, the worst case of every item together ($8,235) passes $4,500, so the rule binds only if sessions cost far more than R2's.

**Launches run one at a time.** A launch is one review-units command or one judge batch. review-units opens its lease only after the arm's image builds (src/skill-eval/cli/run-host.ts at 176fdc7), so the guard can't see a launch that has started but not yet leased. The operator runs rr-pause.py for the next launch only after the previous launch's lease shows in the ledger record, and two launches never run at once. This closes the overlap the /ship red-team found: two grid arms launched together each saw the full $4,500 of headroom, and their leases reserved $5,280.

**One ledger.** Every review-units, judge-run, ledger and rr-pause.py command in this rerun uses the same two paths, named in section 10: the ledger <dir>/ledger.sqlite and the ledger record <dir>/ledger-record. The guard and the one-run-per-item rule (E_ITEM_BOUND) read only that record.

**An overspent close stops the run.** The ledger warns LEASE_OVERSPENT when a lease closes above what it reserved (src/runner/ledger/ledger.ts). On that warning the run thread launches nothing more and reports to the Captain, whatever headroom rr-pause.py prints. review-units settles its lease without that warning, so for the review-units items the operator reads each closed lease in the record after the launch and stops the run the same way on any close above its reservation (spent plus unknown above reserved).

## 9. What follows in separate amendments

**GPT-6.1 Sol.** R54 puts Sol under test beside Opus 5.5. At 176fdc7 review-units can't drive it: it takes only a model with an anthropic or openrouter route for Claude Code (src/trial/review/cli.ts), policy/models.json routes gpt-6.1-sol to openai, and src/runner/pricing/prices.ts has no openrouter row for it, so the metering proxy can't price it, and a `--policy` file can't add a price. GSTA-2 started a build (GEVA-196) for the price row and the route. It had not merged when this post froze, so this post freezes Opus only. A short amendment on the same set adds Sol's none and gstack-full arms at that build's merge commit, reusing this post's rules, as its own Holm family. One fact that amendment must face: src/arms/cells.ts keeps no cross-family voice in a Sol cell, so gstack's outside voice is off there.

**R56-1, /ship's review panel.** The registry's R56-1 row (org drive research/registry.md) shares these units and could have shared this post's none arm. At 176fdc7 it can't run: review-units refuses a gstack arm's told prefix that opens with anything but /review (src/trial/review/cli.ts:226, E_USAGE), and the CLI takes the install's target skill from the default prefix (cli.ts:258) while the run loop takes it from the given one (run.ts:376). GSTA-2 started a small build for it. R56-1 follows in its own short amendment that reuses this post's frozen rules (A1, B1, the coverage and cap-stop rules, the gate counted on returned reports, the admission and smoke rules, the pause rule), with its own none arm at its own pin and its own gate for every panel voice.

## 10. Commands

Each arm runs alone, one launch at a time (section 8), in its own out dir, on its own item, from a checkout at 176fdc7. The flags not named are stacks round 1's step 5 flags (`--severity-map` from its post, `--test garrytan/gstack=true --test garrytan/gbrain=true`, and `--source` clones holding each unit head), as #129. API keys come from the ledger's run environment, never the command line. P is rr-pause.py's printed spend cap for the launch. The ledger paths are the same everywhere: judge-run takes `--ledger $L --record $R`, the ledger CLI takes `--ledger $L --ledger-record $R`, and rr-pause.py takes `$R`.

    S=wiki/plans/2026-10-31-geva-76-stacks-round-1-prereg/stacks-r1.json
    A=wiki/plans/2026-11-02-geva-195-r2-rerun-amendment
    G=garrytan/gstack@5209e9262d8068a75b29be562fbc1de82ba8b487
    L=<dir>/ledger.sqlite
    R=<dir>/ledger-record
    COMMON="--models claude-opus-5-5 --max-turns 200 --allowance 40 --cap-stops --timeout 10800 --reader-map $A/reader-map-gstack-5209e9262d80.json --ledger $L --record $R"

    # pilot and smoke
    gstack-evals review-units --suite $S --units all --arms none --passes 1 --system-prompt none=claude-code-preset \
      $COMMON --item rr-pilot-none --spend-cap P --out <dir>/rr-pilot-none <step 5 flags>
    gstack-evals review-units --suite $S --units garrytan/gbrain#7789@49eb4da5f7c8 garrytan/gstack#3475@fc69d3ff0bfe \
      garrytan/gstack#3507@8c021d124220 --arms gstack-full=$G --passes 1 --system-prompt gstack-full=claude-code-preset \
      --told-prefix gstack-full=<#129's folder>/told-gstack-full.txt $COMMON --item rr-smoke-full --spend-cap P \
      --out <dir>/rr-smoke-full <step 5 flags>

    # grid: the same two commands with --units all --passes 2, items rr-grid-none and rr-grid-full,
    # and new out dirs <dir>/rr-none and <dir>/rr-full

Every command runs `--dry-run` first, which prints the cap-stop line, the reader map, the background wait and the worst case at the allowance. Then, at rig 715f837 with this post's scripts and #129's beside them, dry-run-rr.sh's order: r2-source.py, sevmap and the scrub chain, blind.py, rr-gate.py, judging, `derive --drop-gaps`, scoring, rr-held.py, rr-decide.py, the sensitivities and the strata.

## 11. Dry run

dry-run-rr.sh runs this post's steps keyless at rig 715f837 and build 176fdc7, and dry-run-rr.txt is its output. rr-stub-arms.ts drives review-units' run loop and Claude Code driver through the pinned Agent SDK, with the build's stub CLI (STUB_MODE=background) answering every model call, so the journals, session files and arm.json are the build's own. #112's judge-fake.ts answers every judge request at a set match rate, and every ledger is temporary. The background wait is 3 s, a dry-run setting; the frozen wait is 3600 s. No model was called.

- **Pins.** Rig 715f837 and build 176fdc7 are clean. #112's and #129's reused attachments match their front matter, and GEVA-89's sevmap.ts and R1's scrub chain match their digests. The reader map loads at 176fdc7, its 11 checklist paths exist at 5209e92, and the adversarial marker is present. stacks-r1 has 33 units and 42 blocking blockers. power-rr.py prints section 1's MDDs.
- **A1.** Each arm has one held rescue, scored by rule held on its first turn's findings, and arm.json's held_rescues matches the journal. A waited session whose final turn has the block is scored by rule final. A held malformed block stays malformed and is a gap, and so is a malformed final block after an earlier valid one. Every never-waited session (60 in none, 62 in gstack-full) is scored by rule final with findings.ts's parse.
- **B1.** One session per arm ends E_BACKGROUND_DEADLINE after about 3.2 s of idle time, and both are coverage gaps. block_present_at_deadline is 1 in gstack-full and 0 in none; session_end.cause is clean 65 and deadline 1 in each arm.
- **Coverage and cap stops.** Three units carry gaps, at the coverage limit without passing it. gstack-full has 1 cap stop (turn_cap); none-rr has 2, a turn_cap scored on its turn-2 review and an allowance_stop scored as finding nothing. The rescue drop file holds 2 units and the complete-case drop file 3.
- **Before blinding.** sevmap leaves 0 unmapped labels, the scrub chain takes every source arm's publication-scan hits to 0, and blind.py and ingest pass.
- **Gate.** The stub output passes at 60 of 66 returned PR-passes. A copy with one more reader's tokens unavailable fails at 59 (exit 3), and three bad inputs exit 5. The smoke passes 3 of 3.
- **Admission.** The pilot's stub run journals 33 sessions. A fake judge matching nothing fails at the floor (recall 0, interval [0, 0], exit 3). One matching a third passes (33.3%, [19.4, 48.6], MDD 17.6, upper bound plus MDD 66.2, exit 0). One matching everything fails at the top: the interval is [100, 100], the MDD at the point estimate is 0 and at the planning rate 16.0, so 116 (exit 3). Four units marked as gaps make the pilot incomplete (exit 4).
- **Decision.** On the same stub sessions, three fake judgings give KEEP (69 of 78 blocker-passes against 13, +71.8 points [+59.7, +83.3]), CUT-CANDIDATE (14 against 44, -38.5 [-50.0, -25.6]) and FIX-METHOD (35 against 33, +2.6 [-10.3, +16.2]). A failing gate, 7 capped sessions in none-rr, a fourth dropped unit and a missing interval each give no outcome (exit 4), and a missing score file exits 5. noloss score prints its margin verdict beside each; it decides nothing.
- **Beside KEEP.** The secondaries, the rescue and complete-case sensitivities and both strata run. rr-admit.py's port of the bootstrap gives each arm the scorer's own recall interval ([74.4, 98.7] and [7.4, 26.7]).
- **Judge caps.** The fit gives $176, $209 and $1,130, with every answer asked again (section 8).
- **Ledger.** All seven items record at their frozen caps, and each opens one lease and settles it. A second run on rr-grid-full is refused (E_ITEM_BOUND).
- **Pause.** rr-pause.py gives $4,500 of headroom on a fresh ledger, $1,860 after rr-grid-none's lease, and STOP (exit 3) at $150, below one rr-grid-full round ($160). A judge batch with a $100 worst case on rr-judge-adjudicate launches on the fresh ledger and is refused at $150, because its lease would reserve the item's $1,130. Through review-units, a spend cap of $150 stops a 33-session run before any session (CAP_STOP, 0 journaled), and `--resume` with a larger cap finishes the same run.

The dry run leaves out real model behavior, real judges and real spend.

## 12. Changes from #112 and #129

- The driver is #141's, and its A1 and B1 rules are frozen (section 4).
- The set is all 33 stacks-r1 units at 2 passes, not the 19 out-of-cohort units at 1 pass (section 1).
- gstack moves to 5209e92 (v1.93.6.0) with a reader map re-pinned there (section 2).
- The gate counts returned reports, not dispatches (section 6).
- Gaps are dropped under a coverage rule instead of stopping the comparison outright, and the cap-stop rule scales to 66 sessions (section 4).
- An admission pilot and an exposure smoke come before the grid (section 5).
- sevmap and the scrub chain before blinding, a deviation in R2, are frozen steps (section 7).
- Caps sit at the worst case at the allowance, under a pause rule at $4,500 (section 8).
- Sol and R56-1 follow in their own amendments (section 9).

## Attachments

- reader-map-gstack-5209e9262d80.json: the reader map for `--reader-map` (section 2).
- comparisons.rr.json: the one comparison and R2's KEEP rule, for derive and score (section 7).
- power-rr.py.txt: section 1's MDDs, and the MDD rr-admit.py uses.
- rr-admit.py.txt: the admission pass line (section 5).
- rr-gate.py.txt: the exposure gate on returned reports (section 6).
- rr-held.py.txt: held rescues, deadline gaps, causes and the rescue drop file (section 4).
- rr-decide.py.txt: the decision and its no-outcome rules (section 7).
- rr-pause.py.txt: the pause rule's headroom and spend cap (section 8).
- rr-stub-arms.ts.txt: the dry run's stub sessions through the build's driver (section 11).
- dry-run-rr.sh.txt and dry-run-rr.txt: the keyless dry run and its output (section 11).

## Disclosures

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.
