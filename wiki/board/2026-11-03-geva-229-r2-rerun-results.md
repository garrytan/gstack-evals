---
id: 2026-11-03-geva-229-r2-rerun-results
kind: finding
title: "R2 rerun gives no outcome: gstack's full /review ran in 2 of 3 exposure-smoke sessions (3 needed), and plain Opus 5.5 passes admission at 5.7% blocking recall on all 33 stacks-r1 units"
summary: "No outcome: the smoke gate failed at 2 of 3, so no grid ran. The fixed driver held. The no-gstack pilot passed admission at 5.7% [3.0, 8.6], MDD 24.5. $145.42. R48: FIX-METHOD."
author: GEVA-229
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-03
status: done
source: "Captain drive handoffs/GEVA-229/ (results.md and ledger-record/), the R2 rerun run by GEVA-229"
links:
  - 2026-11-02-geva-195-r2-rerun-amendment
  - 2026-11-02-geva-175-r2-full-review-results
  - 2026-11-02-geva-122-r2-amendment
  - 2026-11-01-geva-101-r48-follow-ups-prereg
  - GST-1162
---

# R2 rerun gives no outcome: gstack's full /review ran in 2 of 3 exposure-smoke sessions (3 needed), and plain Opus 5.5 passes admission at 5.7% blocking recall [3.0, 8.6] on all 33 stacks-r1 units

Publication status: unpublished; posting is Garry's. Done: the smoke, the pilot, its judging, this file. Still blocking a post: the /ship review recorded in the PR.

| Field | Value |
|---|---|
| Grade | Run under a merged preregistration ([2026-11-02-geva-195-r2-rerun-amendment](../plans/2026-11-02-geva-195-r2-rerun-amendment/README.md), #154). The comparison gives no outcome; the admission reading is the preregistered pass line. |
| Paid calls | $145.42 in all: smoke $18.28, pilot sessions $125.11, pilot judging $2.03. |

## What we found

- **The comparison gives no outcome.** #154 runs its grid only after a 3-session exposure smoke of gstack-full passes at 3 of 3. It passed at 2 of 3: the gbrain#7789 session returned findings but ran no Review Army specialist, and its one reader did not carry gstack's adversarial marker. So no grid ran, and nothing compares gstack-full with no gstack here.
- **The fixed driver held.** All 3 smoke sessions returned a report and ended clean, with 0 held rescues, 0 gaps and 0 cap stops. In R2 these same three units ended before their readers returned. The two gstack sessions waited 107 s and 379 s and collected every reader they sent.
- **gstack's outside voice stayed at 0** in all 3 smoke sessions: 0 requests, 0 tokens, as in R2.
- **Plain Opus 5.5 is off the floor on all 33 units.** The no-gstack admission pilot (5 passes, 165 sessions) found 12 of 210 blocker-passes as blocking: 5.7%, 95% PR-clustered CI [3.0, 8.6]. The MDD at the grid's 2 passes is 24.5 points, and the upper bound plus the MDD is 33.2, so rr-admit.py printed PASS and exited 0. All 12 blocking finds are in R1's cohort of 14 units; the out19 units stay at 0 of 65.
- **R48: FIX-METHOD (exposure).** The procedure under test did not run reliably enough to measure, so this is not a CUT-CANDIDATE.

## How it works

#154 orders the rerun so that no grid spends before two checks pass. The exposure smoke runs gstack-full once on the three units where R2's sessions sent out both kinds of reader and then ended early. A session passes the gate only when it returned a scored report with a specialist reader and the native adversarial reader, each with counted tokens. The admission pilot runs the no-gstack arm 5 times on all 33 units, judges it once, and passes when the blocking-recall interval's lower bound is above 0 and its upper bound plus the MDD is at most 100 points. Both had to pass for the grid to start. The smoke failed, so the Captain had the pilot run alone, for its control rate.

## Setup

Every session ran from gstack-evals 176fdc7 (#141's driver), on Opus 5.5 with Claude Code CLI 2.1.314, the claude-code-preset system prompt, bundled skills off, 200 turns, a $40 allowance, `--cap-stops`, `--timeout 10800` and a background wait of 3600 s, in the rig's Docker sandbox. gstack-full ran gstack 5209e92 (v1.93.6.0) with R2's told prefix (db9ec7b4) and the reader map a17fc2c0. Judging ran at rig 715f837 with #108's brief and judges (Opus 5.5 primary, GPT-6.1 Sol second, Sonnet 5.5 third read), seed 20261031. The suite is stacks-r1 (4f46bb17): 33 units, 42 blocking blockers on 26 PR clusters. The ledger held #154's seven items at their caps, and rr-pause.py ran before each launch; it never paused.

### Setup deviations

1. **Machine.** The run machine moved from 64 GB to 128 GB of disk before any launch, because each unit keeps a prepared tree and a retained tree tar. The pilot's 33 units took the disk to 99 GB used.
2. **Trial image.** The first smoke launch exited 2 with E_IMAGE_STALE before it made an out dir or a lease: the new machine had no trial image for 176fdc7's recipe. `gstack-evals doctor` built and pinned it (sha256:fab75ded), and the smoke started as a new run.
3. **Severity labels (the Captain's decision A on GST-1162).** On the pilot's source arm, the frozen sevmap.ts left 3 labels unmapped and stopped: Medium (3 findings), Low (3) and P2 (2), 8 of 331. Before ingest and any judge call, the source arm's severity map gained Medium and Low at their lowercase twins' values and P2 at INFORMATIONAL (the frozen map has no P1). All three are INFORMATIONAL, so no blocking count can move. No frozen script changed; every file's sha256 before and after is in the run record. The 8 rows: gbrain#7901 lines 3, 4 and 5; gstack#3448 line 6; gstack#3596 lines 4 and 5; gstack#3557 line 1; gstack#3573 line 6.
4. **Ledger helper.** Ledger init needs gstack-approvals, so the run machine had gstack's read-only helpers installed (no host skill profiles). Sessions run in Docker and never see the host.

## Result

### Exposure smoke

Run review-units-20261103T034836Z-7bb4, gstack-full, 1 pass. rr-gate.py: 3 of 3 PR-passes returned; a specialist with tokens in 2, adversarial-native with tokens in 2, both in 2; red-team 2, targeted 0; gate FAIL, exit 3.

| Unit | Parse | Scored rule | session_end | Waited | Readers with tokens | Cost |
|---|---|---|---|---|---|---|
| gbrain#7789@49eb4da5f7c8 | 3 findings | final | clean | 0 s | other (1) | $3.44 |
| gstack#3475@fc69d3ff0bfe | 9 findings | final | clean | 107 s | adversarial-native, batched, maintainability, red-team, security, testing | $7.00 |
| gstack#3507@8c021d124220 | 14 findings | final | clean | 379 s | adversarial-native, maintainability, performance, red-team, security, simplification, state-machines, testing | $7.84 |

On gbrain#7789 the session read the diff, checked it by hand, ran one general-purpose reader in the foreground with its own short adversarial brief (no gstack marker, no checklist path), and wrote its report. It sent no Review Army specialist.

### Admission pilot

Run review-units-20261103T044742Z-c529, no gstack, 5 passes on 33 units: 165 sessions, 151 with findings and 14 empty, 0 missing, malformed or not run, 0 cap stops, 0 held rescues, 0 gaps. Every session ended clean; 1 waited (842 s idle). Judging: 56 requests, primary on 33 packets, second on 22, third on 1, 0 unjudged; the second judge agreed on 28 blockers at kappa 0.96.

rr-admit.py, as printed: "none-pilot blocking recall 5.7% on 42 blocking blockers in 26 PR clusters, 0 units dropped as gaps; 95% CI [3.0, 8.6]; MDD with 2 passes 24.2 points at 5.7% and 24.5 at the planning rate 7.1%, so 24.5; upper bound plus MDD 33.2 points. PASS", exit 0.

| Blocker set | Blocker-passes | Blocking | Any severity | Any severity without the 8 |
|---|---|---|---|---|
| All 33 units (42 blockers) | 210 | 12 (5.7%) | 59 (28.1%) | 56 (26.7%) |
| Cohort14 (29 blockers) | 145 | 12 (8.3%) | 39 (26.9%) | 37 (25.5%) |
| Out19 (13 blockers) | 65 | 0 (0.0%) | 20 (30.8%) | 19 (29.2%) |

The 12 blocking finds hit 9 of the 42 blockers in 9 of the 26 PR clusters. The 47 other matches were rated below blocking. "Without the 8" counts a blocker-pass as missed when its only match was one of the 8 relabelled findings; 3 blocker-passes moved. The intervals beside the strata were not computed, and the strata decide nothing.

Read audit, descriptive: across the 165 transcripts, no tool input names ~/.capy/drive or ~/.local/share/gstack. Nine name `.claude/skills`, all in gstack#3524's sessions, whose diff changes gstack's install code: they build test fixtures under a temp home or list the sandbox's own ~/.claude/skills, which printed "No such file or directory" where it printed at all.

### The comparison

No outcome. No grid ran, so rr-decide.py never ran, and there is no gstack-full against no-gstack delta.

## Cost

| Ledger item | Cap | Settled |
|---|---|---|
| rr-smoke-full | $120 | $18.28 |
| rr-pilot-none | $6,600 | $125.11 |
| rr-pilot-judge | $332 | $2.03 |
| rr-grid-none, rr-grid-full, rr-judge-match, rr-judge-adjudicate | $2,640, $2,640, $332, $1,130 | $0 |
| **Total** | | **$145.42** |

Every lease closed at or under its reservation, with $0 unknown.

| Run | Sessions | Input | Cache read | Cache write | Output | Total tokens | Requests | Dollars | Mean |
|---|---|---|---|---|---|---|---|---|---|
| Smoke, gstack-full | 3 | 694 | 27,980,447 | 1,704,153 | 207,863 | 29,893,157 | 344 | $18.28 | $6.09 |
| Pilot, no gstack | 165 | 5,518 | 189,200,284 | 11,013,438 | 1,609,214 | 201,828,454 | 2,756 | $125.11 | $0.76 |

Prices are the pinned table (src/runner/pricing/prices.ts at 176fdc7 and 715f837, read 2026-11-03), in dollars per million tokens:

| Model | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| claude-opus-5-5 (sessions, primary judge) | 4 | 20 | 0.20 | 5 |
| claude-sonnet-5-5 (third judge) | 2 | 10 | 0.20 | 2.50 |
| gpt-6.1-sol (second judge; above 272,000 input tokens: 4, 15, 0.20, 5) | 2 | 10 | 0.10 | 2.50 |

From the smoke, a gstack-full grid arm (66 sessions) would cost about $402. It did not run.

## Why null? (R48)

- **Exposure.** This is an exposure null. gstack's full procedure ran in 2 of 3 smoke sessions; on gbrain#7789 the model skipped the Review Army and wrote its own adversarial brief. The gate needs every smoke session, so the grid never started.
- **Task fit and floor.** The pilot shows plain Opus 5.5 off the floor on all 33 units (5.7% [3.0, 8.6]) and far below the top. The floor R2 hit remains on the out19 units alone: 0 of 65 blocking blocker-passes.
- **Power.** At the grid's 2 passes the MDD is 24.5 points, inside the pass line's room (33.2 of 100).
- **Today's frontier model without the skill.** Plain Opus 5.5 found 5.7% of blocker-passes as blocking and 28.1% at any severity.
- **Verdict: FIX-METHOD (exposure).** Not a CUT-CANDIDATE: the comparison never measured the procedure.

## What this steers

The next review amendment, on the gstack pin where the procedure's adherence fix lands, can reuse this pilot's no-gstack control rate on these 33 units at these settings: it involved no gstack. Its smoke should expect sessions that skip the Review Army on a small diff, as gbrain#7789 did here.

## Limits and threats

- The smoke is 3 sessions. It shows the procedure can be skipped; it does not estimate how often.
- The pilot judged one matching batch with no adjudication, as #154 section 5 says, so its unmatched blocking findings were not reviewed.
- The read audit is a string search on tool inputs, not a trace of every file the sandbox exposed.
- Decision A relabelled 8 findings after the run. It can only move the any-severity line, and both readings are shown.

## Replicate it

Each launch ran `rr-pause.py`, then the command with `--dry-run`, then the command, and then `rr-pause.py --append` on its stderr, from a clean 176fdc7 checkout:

    python3 $A/rr-pause.py.txt $R <item> 4
    bin/gstack-evals review-units --suite $S --units <the three smoke units> --arms gstack-full=garrytan/gstack@5209e9262d8068a75b29be562fbc1de82ba8b487 --passes 1 --system-prompt gstack-full=claude-code-preset --told-prefix gstack-full=<#129>/told-gstack-full.txt $COMMON --item rr-smoke-full --spend-cap 120.00 --out <dir>/rr-smoke-full <step 5 flags>
    bin/gstack-evals review-units --suite $S --units all --arms none --passes 5 --system-prompt none=claude-code-preset $COMMON --item rr-pilot-none --spend-cap 4481.72 --out <dir>/rr-pilot-none <step 5 flags>

with $COMMON as #154 section 10 gives it. Then, at rig 715f837: r2-source.py, sevmap.ts, decision A's three map entries, the scrub chain, blind.py, ingest, judge-packet, judge-run --dry-run with the judge pre-flight, rr-pause.py, judge-run, judge-join, ingest, `derive --drop-gaps` and rr-admit.py, in dry-run-rr.sh's pilot order. The run record in the Captain drive holds the printed lines; it leaves out the transcripts and the ledger database.

## What is held out, and why

Nothing here is sealed. The session transcripts and findings stay on the run machine, because they quote code from the units' private repositories. This post carries counts and digests only.

## Changelog

- 2026-11-03: first version (GEVA-229).

## Disclosures

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.
