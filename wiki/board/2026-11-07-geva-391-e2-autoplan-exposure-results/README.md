---
id: 2026-11-07-geva-391-e2-autoplan-exposure-results
kind: finding
title: "E2 results: told autoplan with gstack's stop gate read 1 of 3 Opus 5.5 sessions exposed under the fixed detector (fail at the early stop); the review skills loaded in every phase but the phase reports did not hold, so FIX-METHOD"
summary: "Stop gate on (gstack ca5dbfc7), Opus 5.5, T-G, fixed detector: 1 of 3 exposed, fail at the early stop. Review loads 9 of 9; phase reports late or missing. FIX-METHOD. Paid $60.44."
author: GEVA-391
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-07
status: done
links:
  - 2026-11-07-geva-387-e2-autoplan-exposure-prereg
  - 2026-11-07-geva-390-e2-detector-cd-amendment
  - 2026-11-07-geva-384-r61-autoplan-gate-results
  - 2026-11-06-geva-364-g-admission-results
  - lanes/outcome-skills/arms/exposure.ts
attachments:
  - 84f27a8a5c24f47e401b0404da22ab81ab9bd023a40eac85cfb6d3f515a3ae23  check.txt
  - 4be5aff7a9d19e98fbc98571d5826d7f9eabd27bae315a0168d89b3dc5cc192e  phase-reports.txt
  - 210f72156d9a3a7a3b5c775b9e0d18345b075c75a4a0b3e9531bdecc8f12f75f  read.txt
  - fd0b9ac672cd3a83f1c53c9779349d599ee230b2538a4d07a1aa474696cd4d5f  reread-1.txt
  - 561633d6671d07e82e41a40a22132f6b28e27bab7be427d391192cd5590d085c  reread-2.txt
  - 01d6c3516e281027412b67271e4f27281fecc4bd529c3c5052d8f627b3a157b7  rule-count.txt
  - bea7be512b74425f18c4d8b1690faf4d404325ec77c05da4b00ca8cf63168f20  session-facts.txt
  - 3653534bc345200d92dd7c16926202c7592a86b14c3ce25a64cb4443dff24919  settle.txt
---

# E2 results: told autoplan with gstack's stop gate, read by the fixed detector

## Status

Publication status: unpublished. This is the record of a preregistered exposure check. It reads no outcome and no effect of autoplan.

| Field | Value |
|---|---|
| Grade | Exposure check, preregistered. One model (Opus 5.5), the told arm only, 3 of 4 planned sessions (early stop). The R61 re-read and the section 5 readings are report-only. |
| Prereg | [E2 prereg](../../plans/2026-11-07-geva-387-e2-autoplan-exposure-prereg.md), merged as cef946eb, and its [amendment](../../plans/2026-11-07-geva-390-e2-detector-cd-amendment.md), merged as 6d51ff1a |
| Run commit | 6d51ff1a758c2e0e5fa632379700e240bbe668d8, the amendment's merge. rig.yml run 42378736556 passed there. |
| Detector | lanes/outcome-skills/arms/exposure.ts, sha256 f0882eaf2d5fe19ef682ec0f0c88e9a1239870a04544cf6adbf6d34e4e167694 |
| Told arm | gstack ca5dbfc7e0016e3a1511161dc8c094399a2e350b, R61's pin, lite loadout with `--autoplan-gate`, the arm tar rebuilt on the run host (sha256 a68e791b5f9cb063ee9fbf21ee228d75ec1acb6875cceb80cc67fab0cd62cef1) |
| Data | The run's plain outputs in the Captain's drive, under a sha256 manifest (MANIFEST.txt sha256 858b097b6a2500311f41d59c0bcd7cda27f82769b113ec485fac836b4d1e3dd6). read.txt is a byte-identical copy of the reader's last output, and reread-1.txt and reread-2.txt of the re-read's two outputs. The other attachments are lines the run's readers printed, selected by their prefixes (Replicate it). The session records and T-G stay sealed. |
| Reviewed by | The /ship review of this post, recorded in its pull request |
| Reproduced by | Not yet |

## What we found

The check failed. Under the fixed detector, after both verdict-line checks, 1 of 3 told sessions read exposed (95% Clopper-Pearson interval 0.8% to 90.6%). The rule passes at 3 of 4, so the early stop came at 2 not exposed. Session 4 (tg5dce6b3f8b) never opened, and the one gap rerun went unused. Neither verdict-line check reclassified a session.

The review skills loaded. In every session each applicable phase (CEO, DX, Eng) ran one methodology call before its publish and then made 4 credited reads of its methodology file: 9 of 9 phase loads, 36 credits, 0 through an open over-credit shape. So the prereg's CUT-CANDIDATE trigger (a failure on review_skills_loaded) did not fire. No session used a cd prefix, so the amendment's change credited nothing in E2.

What failed is the phase report step. Of the 9 phase reports the procedure calls for, 1 came before the first gate block, 5 came after a block and 3 were never written. The exposed session published all three phases with no report and back-filled one report after each of 3 blocks, in phase order. In the second session the gate blocked 3 times, each time missing CEO, before any report or publish, then ran out of blocks; the session published every phase and never wrote a report. The third session wrote Eng's report first, then back-filled CEO and DX after 2 blocks, which reads out of order. The gate's own reading agrees with the detector about which reports were missing.

R48: **FIX-METHOD**, on gstack's side. The gate doesn't enforce report order, and its blocks can run out before the first report. Paid spend was $60.44 against $352 in caps.

## How it works

This is our explanation, not a measured result.

autoplan closes each phase by writing a "**Phase N complete.**" report and then running a publish no-op for that phase. The detector's findings_in_order check counts a publish no-op only when that phase's report appears after the previous publish no-op and before this one, and it needs the counted publishes to match the applicable phases in order (CEO, DX, Eng). A session that publishes first and reports later can still pass, if it publishes again after each report, in order.

The opt-in stop gate holds the session's final stop while an applicable phase has no report. In E2 each block named the first phase still missing a report. It releases once every phase has a report, in any order, and in E2 it gave up (exhausted) after its third block with nothing new written. So the gate can turn a session into an in-order run only when the session answers each block with the next report in order. E2's first session did that. The second never answered a block, and the third had already written Eng's report, which the gate accepts and the detector reads as out of order.

## Setup

- **Question.** With gstack's opt-in stop gate on, does told /autoplan on Opus 5.5 visibly run its procedure, as read by the fixed detector? The estimand is the share of told sessions read exposed after the two verdict-line checks. The check passes at 3 of 4.
- **Arm.** R61's told arm, unchanged: gstack ca5dbfc7 installed with the lite loadout and the stop gate in a clean HOME that the session sees as /root. The run host rebuilt the arm tar with R61's install script (sha256 683e54cf...), and its checks passed: head ca5dbfc7 and its pinned version, lite loadout and gate on, exactly the pin's two Stop hooks, a clean checkout, and a render of 205 files with digest 3a06ddf7, as in R61. There is no none arm and no judge, because the check reads exposure only.
- **Model and harness.** claude-opus-5-5 through Anthropic's API and the run's metering proxy. Claude Code 2.1.312 with the claude-code-preset system prompt, claude-agent-sdk 0.2.174, Harbor f3a5a92 with HARBOR_TELEMETRY=0, and CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1. The arm's limits: $45, 400 turns, 4 hours, quiet 30 s, background wait 600 s. The session kind is interactive, and autoplan runs its default full kind. The registry turns t1 to t3 run verbatim (t2 loads /autoplan), with the rec persona and its hold line.
- **Tasks.** tgff24032962, tg8d524982ac, tg5b38fec201 and tg5dce6b3f8b, in that order: G's frozen autoplan draw on T-G, minus R61's two tasks and the two tasks whose ungated G session cost more than $25. One trial each, one at a time.
- **Detector.** autoplanExposure at the run commit. It is G's frozen detector with one rule changed, when a phase counts as loaded: a Read of the methodology path from the snapshot's JSON or of the review SKILL.md (as before), a Read of the phase's own methodology file after a sole methodology call piped at most once (new), or a simple Bash read of either file (new). The amendment lets one leading cd to a plain path come before the sole call. A session reads exposed only when config, scope, review_skills_loaded and findings_in_order all pass.
- **Rules.** Intention to treat. As each session settled, the run thread read it with e2-read.ts, counted the rule that credited each phase's load, applied the refusal rule (a refused call reads not exposed) and the over-credit rule (a load that rests on an open over-credit shape reads not exposed), and only then decided the early stop and opened the next session. A gap reruns once in the whole check. The early stop comes at 3 exposed or 2 not exposed. A cap stop is an incomplete run.
- **Start rules.** All 12 held before the first lease. The R61 re-read at the run commit matched the amended prediction (13:47:23Z). The image manifest was rebuilt under custody (13 rows, sha256 6138d946...). Dry run part 2 passed on a temporary ledger with a stand-in upstream. The dry run of both verdict-line checks passed on the host and on the run thread's machine: case 1 read not exposed by the refusal rule, cases 2 and 3 by the over-credit rule, and case 4 stayed exposed. Three detector-exposed sessions with one reclassified tallied 2 exposed and 1 not exposed, which doesn't settle a pass.
- **Dates and host.** 2026-11-07. Session 1 ran from 14:59:55Z to 15:37:44Z, session 2 from 15:47:21Z to 16:21:58Z and session 3 from 16:28:42Z to 17:22:21Z, on one Ubicloud standard-8 run host created at 13:18:09Z and destroyed at 17:27:49Z.

## Result

**Verdict (the frozen rule, prereg section 4): fail.** read.txt ends "exposed 1 of 3 read, verdict fail under 3 of 4". check.txt ends "TALLY exposed 1 not_exposed 2 gaps 0 of 4, decision settled fail". With 2 not exposed, at most 2 of 4 could read exposed, so the early stop settled it. The frozen rule passes a true exposure rate of 0.5 with probability 0.313.

| | Session 1 | Session 2 | Session 3 |
|---|---|---|---|
| Task | tgff24032962 | tg8d524982ac | tg5b38fec201 |
| Reading after both checks | exposed | not exposed | not exposed |
| config | true | true | true |
| scope | true | true | true |
| review_skills_loaded | true | true | true |
| findings_in_order | true | false | false |
| Applicable phases | ceo, dx, eng | ceo, dx, eng | ceo, dx, eng |
| Published, as the detector counts them | ceo, dx, eng | none | eng, ceo, dx |
| How t2 ended | quiet | quiet | quiet |
| Refused calls | 0 | 0 | 0 |
| Refusal rule | clear | clear | clear |
| Over-credit rule | clear | clear | clear |

**The gate's own reading** (report-only: the gate's report over each session's gate record, as read.txt records it). It decides nothing.

| | Session 1 | Session 2 | Session 3 |
|---|---|---|---|
| Report exit | 0 | 0 | 0 |
| Fired | 1 | 1 | 1 |
| Blocked (step missing at each block) | 3 (ceo, dx, eng) | 3 (ceo, ceo, ceo) | 2 (ceo, dx) |
| Released | 1 | 0 | 1 |
| Exhausted | 0 | 1 | 0 |
| Errors | 0 | 0 | 0 |
| Skipped | none | none | none |

**Session facts** (report-only, session-facts.txt and the stage driver's session log).

| | Session 1 | Session 2 | Session 3 |
|---|---|---|---|
| Termination | completed | completed | completed |
| Persona in t2 | 1 question (recommended reply), 0 prose | 1 question (recommended reply), 0 prose | 1 question (recommended reply), 0 prose |
| /autoplan loads in t2 | 1 | 1 | 1 |
| Model calls (proxy requests, all answered) | 191 | 171 | 292 |
| Tool calls | 242 | 179 | 353 |
| Metered cost | $17.185916 | $13.733702 | $28.131534 |
| G's ungated told session on the same task, trials 1 and 2 | $16.07, $14.20 | $15.57, $17.26 | $23.32, $19.32 |

None of the question-stop risks in R61 prereg section 2 showed up, and no session ended on the budget. Pooled, E2's gated sessions cost 1.12 times G's ungated sessions on the same tasks (both G trials averaged), against R61's 1.31 on two sessions. That is a description from one trial per task, not an estimate of what the gate costs.

## Readings beside the verdict (prereg section 5, report-only)

**1. Which rule credited each load** (rule-count.txt, counted on the run host by the run thread's rule-count script as each session settled, before it counted toward the early stop). Every applicable phase in every session had exactly one methodology call, made before that phase's publish, and 4 credited Reads of that phase's methodology file after it. No phase had a credit through an open over-credit shape, and the count matched the detector in all three sessions.

| | CEO | DX | Eng |
|---|---|---|---|
| Session 1 | JSON path rule (call unpiped) | methodology-file rule (call piped once, to bun) | methodology-file rule (piped, to bun) |
| Session 2 | JSON path rule (unpiped) | methodology-file rule (piped, to python3) | methodology-file rule (piped, to python3) |
| Session 3 | JSON path rule (unpiped) | JSON path rule (unpiped) | methodology-file rule (piped, to bun) |

Each cell is 4 credits. The call shapes, as class labels with no command text, are in rule-count.txt. No session's call began with cd, and none used the Bash read rule.

By the rule count, not a rerun: G's frozen detector credits only the JSON path rule and direct SKILL.md reads, so it would have credited 4 of these 9 loads, and every E2 session would have failed review_skills_loaded. The detector fix is what kept the prereg's cut trigger from firing on loads that did happen.

**2. Reports and publishes around each gate block** (phase-reports.txt, from the session records after teardown; Deviations, item 4). In phase-reports.txt, R1, R2.5 and R3 are the session's own "**Phase N complete.**" lines for CEO, DX and Eng, P<phase> is a publish no-op, and a U[hook,gate,stop,phase,pub] record is a gate block. Other S, U, O and X tokens are system, user, other and result records, tagged with the words they contain.

- **Session 1 (exposed).** In t2 it published ceo, dx and eng with no report. At the first block it wrote R1 and published ceo, dx and eng again; at the second, R2.5 and published dx and eng; at the third, R3 and published eng; then the gate released. Every report was back-filled after a block, in phase order, so the detector's counted publishes read ceo, dx, eng.
- **Session 2 (not exposed).** The gate blocked 3 times back to back, each block missing ceo, before any report or publish. The session wrote nothing between blocks, and the gate exhausted. The stop then went through, turn t2 resumed (the records hold a second t2 start and result), and the session published ceo, dx and eng with no report, so the detector counts no publish.
- **Session 3 (not exposed).** It published ceo and dx, wrote R3 unprompted and published eng. At the first block it wrote R1 and published ceo; at the second, R2.5 and published dx; then the gate released. The order reads eng, ceo, dx: the order limit that prereg section 11 names.

Across the five gated told sessions read so far (R61's two and E2's three), at most one phase report came before the first gate block in any session, and both times it was Eng's.

**3. Session facts** are in the Result section above.

## The R61 re-read (report-only)

The prereg's start rule 4 required a real-data check of the detector fix before any lease: R61's two sealed sessions, re-read under custody with the frozen and the fixed detector, counts only. It changes no R61 reading. R61's frozen verdict (fail, 0 of 2) stands.

- **First run, at the first fix's merge (cef946eb), 12:57:10Z** (reread-1.txt). The frozen detector read 0 of 2, and session 1 read as predicted. Session 2 did not: it read not exposed on review_skills_loaded, where the prediction said exposed. Two counts-only diagnostic openings (12:58:36Z and 13:04:21Z) found the cause and the call shapes. Each of session 2's methodology calls began with a cd to a plain path joined by a semicolon, which the sole-call rule rejected, so the DX and Eng reads of their methodology files went uncredited.
- **The amendment.** The Captain ruled to fix it before E2. The amendment lets one leading cd to a plain path come before the sole call, with tests in both directions, and rewrote the prediction.
- **Second run, at the run commit (6d51ff1a), 13:47:23Z** (reread-2.txt). It matched the amended prediction on all four readings. The frozen detector reads 0 of 2. The fixed detector reads session 2 exposed, all four checks true, published ceo, dx, eng, and session 1 not exposed, review_skills_loaded true, failed findings_in_order, published eng, ceo, eng, dx. Under the fixed detector R61 would read 1 of 2.

**The amended prediction is not blind.** It was written after the 12:58:36Z and 13:04:21Z diagnostic openings, which showed the call shapes and counts the fix was built from, and the amendment says so. So the second run checks that the code reads the real records the way the diagnostics said. It does not test a hypothesis.

## Cost

**Paid** (the ledger, wave 1 envelope; settle.txt).

| Item | Charged to | Lease | Settled | Cap | Share of cap |
|---|---|---|---|---|---|
| ap-e2, model calls | autoplan | ap-e2.0001.974eb9, 3 sessions | $59.051152 | $343 | 17.2% |
| e2-vm, run host hours | autoplan | e2-vm.0001.35379e, 4.645 h | $1.393500 | $9 | 15.5% |
| **Paid** | | | **$60.444652** | **$352** | 17.2% |

The model-call lease settled with unknown $0.00, and the three sessions' metered costs sum to it exactly. The host hours run from the host's creation at 13:18:09Z to 17:26:50Z, plus the half-hour teardown allowance: 4.645 hours of a standard-8 at the Captain's $0.30 reserve rate. The prereg expected about $70 for an early stop after 3 sessions. After settling, wave 1 reads $1,494.485829 committed of $10,000 with nothing open, and autoplan's line on the ledger reads $927.5232 settled of $2,000.

**Tokens** (the stage driver's session log, from the metering proxy).

| | Input | Output | Cache read | Cache write | Total |
|---|---|---|---|---|---|
| Session 1 | 384 | 195,173 | 48,670,427 | 709,351 | 49,575,335 |
| Session 2 | 350 | 157,260 | 38,466,896 | 578,731 | 39,203,237 |
| Session 3 | 586 | 218,139 | 97,057,931 | 870,943 | 98,147,599 |
| **All three** | 1,320 | 570,572 | 184,195,254 | 2,159,025 | 186,926,171 |

**Prices.** Opus 5.5 in dollars per million tokens, from src/runner/pricing/prices.ts at the run commit, as the proxy used them on 2026-11-07: input 4, output 20, cache read 0.20, cache write 5. Cache reads and writes are counted as the proxy reported them, and the token totals at these prices give the metered costs above to the cent.

**Crew**, from the thread counters at the Captain's rate of $1 per 1,000 credits, read on 2026-11-07. Every thread below has finished except this one.

| Thread | Work | Credits | Tokens | Dollars |
|---|---|---|---|---|
| GEVA-375 | R61 prereg | 27,426 | 77.7M | $27.43 |
| GEVA-382 | R61 run | 23,982 | 63.3M | $23.98 |
| GEVA-384 | R61 results post | 18,001 | 54.8M | $18.00 |
| GEVA-386 | R61 results post, /ship tail | 5,872 | 20.5M | $5.87 |
| GEVA-387 | next-round plan, first detector fix and E2 prereg | 38,555 | 104.4M | $38.56 |
| GEVA-389 | first detector fix and E2 prereg, /ship tail | 19,470 | 73.9M | $19.47 |
| GEVA-390 | R61 re-read, second detector fix, E2 run | 37,047 | 100.8M | $37.05 |
| GEVA-391 | this post, when written | 3,135 | 11.8M | $3.14 |

**autoplan's line, all-in, on actuals.** Paid on the ledger: G's autoplan share $474.68 (g-ap plus half of g-none, g-vm and g-tg), R61 $45.13 and E2 $60.44, so $580.26. G's crew: $453.40, autoplan's half of $906.79 over G's 29 threads at final counters, as the R61 results post read them. R61's crew: $75.28. The next round's crew before this post: $95.07. That is $1,204.01, plus this post's thread ($3.14 when written, not final): about $1,207 of $2,000, with about $793 left. The ledger's own $927.52 includes $347.26 of G crew rows recorded on 2026-11-05, which the counter reading replaces. Adding every counter to the whole ledger reading instead counts G's crew twice and gives about $1,554, still under the line. gstack's own lane built the gate, and that work is not on this line.

## Why null? (R48)

**autoplan: FIX-METHOD, on gstack's side (an exposure null, the second attempt).**

- *Exposure.* The part under test loaded: 9 of 9 phase loads, each before its phase's publish, read by the fixed detector and confirmed by the run thread's rule count, with no credit through an open shape. The step that failed is the report step that the procedure and the gate both require before a phase counts as done. Only 1 of 9 reports came before the first block. The gate got all three written in sessions 1 and 3, but it accepted session 3's out-of-order report, and in session 2 it ran out of blocks before any report. The gate's own reading agrees with the detector on every missing report, so this is not a detector miss.
- *Task fit.* Not tested, because this check reads exposure only. On T-G, G found plain Opus 5.5 at 22 of 22, so these tasks have no headroom for an outcome test of autoplan.
- *Power, floor and ceiling.* Three sessions under an early stop. 1 of 3 has a 95% interval of 0.8% to 90.6%, and the frozen rule passes a true rate of 0.5 only 31% of the time, so the count alone says little. The mechanism is what carries the reading: in all three sessions the report step ran late or not at all, the same pattern R61 showed.
- *Frontier without it.* Opus 5.5 is the frontier model here, and on these tasks it does the work without the skill (G: 22 of 22).
- *Kind of null.* An exposure null. R61 was the first attempt to fix autoplan's exposure method and failed partly on our detector, which is now fixed. E2 is the second attempt, and it failed on the gate and the report step.

The verdict is FIX-METHOD rather than KEEP because the check did not pass, so autoplan on Opus 5.5 still has no fair test under R56: no exposure pass, no outcome. It is FIX-METHOD rather than CUT-CANDIDATE for three reasons. The prereg's cut trigger, a failed review_skills_loaded, did not fire: the review skills loaded in every phase. Nothing here measures whether any skill line helps, so nothing supports cutting lines. And the failure sits in gstack's enforcement: a gate that releases on reports in any order, and whose blocks can run out before the first report, cannot hold the procedure the detector reads. Our method saw both the loads and the missing reports, so the fix is gstack's.

**What would flip it.** The next exposure check should run with a gate that enforces report order and cannot run out before the first report. If that check still fails on the report step, the question becomes whether autoplan's report-then-publish step runs on Opus 5.5 at all, and that is a CUT-CANDIDATE question for that step, to go to the Captain plainly. It would still not be a cut question for the review loads.

Where it goes, as prereg section 9 says for fewer than 3 exposed:

- **To gstack's maintainers,** with the per-check reasons and the gate's reading above. They took the handoff on 2026-11-07 and plan a gate change: each phase's report must come in phase order before that phase publishes, and the block budget won't run out before the first report. The next exposure check waits on that change.
- **To gstack-evals.** Nothing to fix in the detector on this evidence. The rule count matched it in every session.
- **No headroom check.** The prereg ran the headroom check only after a pass, so it stays unrun and its money unspent.

## What an outcome test would need

An exposure pass shows only that the procedure ran where the detector can see it. An outcome test needs four things on top of that: tasks with headroom (T-G has none: plain Opus 5.5 solved 22 of 22), a headroom check on the no-gstack arm before the comparison (the next-round plan priced one at about $290, with a $485 cap), a no-gstack arm paired with the told arm on every task, and enough pairs to detect a useful effect.

The next-round plan sized the comparison with plan v3's power script (the same grid, times 1.2), told gated autoplan against no gstack, scored solved or not:

| Design (tasks x trials) | Pairs | MDD, points | Expected paid | At G-style caps |
|---|---|---|---|---|
| 16 x 1, or 8 x 2 | 16 | above 40 | $410 to $490 | $930 |
| 30 x 1 | 30 | 43.2 | $770 to $920 | $1,750 |
| 24 x 4 | 96 | 26.4 | $2,450 to $2,930 | $5,600 |
| 36 x 4 | 144 | 21.0 | $3,670 to $4,390 | $8,400 |
| 42 x 4 | 168 | 19.8 | $4,280 to $5,120 | $9,800 |

Expected paid assumes $24 to $29 per told session on harder tasks plus $1.50 per none session. At 24 pairs or fewer the power script finds no MDD up to 40 points.

**autoplan's $2,000 line is too small to give an outcome test enough power.** Less than $800 is left. Spent entirely on pairs, with no headroom check, it buys fewer than 30 once harder tasks are mined, and even 30 pairs has an MDD of 43.2 points. A 20-point test needs 42 x 4, about $4.3k to $5.1k expected, past the line. Any comparison run inside the line would be descriptive.

## Deviations

None changes the arm, a task, the detector, a scoring rule, a cap or the verdict.

1. **/dev/shm wiped by systemd-logind.** After the arm tar build, the run user's last ssh session ended, and logind's default RemoveIPC=yes deleted the user's /dev/shm files, the opened T-G material included. Dry run part 2's first attempt (14:40Z) found /dev/shm empty and failed at once; its temporary-ledger leases opened and settled at $0.00 and $0.03, on the temporary ledger, not the real one. The operator turned on linger for the run user (14:48Z), opened the bundle a second time, re-bound the four tasks (same image ids) and prepared them again. /dev/shm then survived ssh disconnects for the rest of the run.
2. **Kit edits on the host.** The dry-run and check kits are not frozen files. Their host copies took small, logged edits: the check kit's start-rule-12 script pointed at the host's paths, its case fixture path moved from a hard-coded checkout path to the host's (one line) after the first run failed on it, and the dry-run script's reuse check matched exactly. The hours-lease script refuses a reused cell task and closes a lease whose reserve fails, the fix for R61's deviation 7. No run file changed, and the run files matched their prereg sha256s on the host.
3. **First item recording refused.** Recording the two items from a detached checkout refused with E_APPROVAL_RECORD (no branch) and recorded nothing. The rerun named main, which is the run commit.
4. **Section 5 readings taken after teardown.** The prereg asks for the report and publish counts "in the same pass" as the rule count, on the run host as each session settles. The rule count ran there, before each session counted. The report and publish sequences and the session facts did not: the run thread read them after the host was destroyed, from E2's encrypted export, in two counts-only openings on its own machine (17:30:45Z and 17:31:30Z). The first opening's label filter dropped names with digits, the turn names t1 to t3 among them, so the reader was fixed and run once more. These readings decide nothing, and every verdict input was read before the early stop.
5. **A late custody log entry.** The 13:04:21Z diagnostic opening of R61's records was missing from the custody log. The run thread found the gap later that day, told the Captain, and added the entry late, with its log and both sweeps, which were clean.
6. **The export kept outside the Captain's drive.** R61's export went to the Captain's drive. E2's sealed trial records went to the project-user drive, because the Captain's drive was at its 2 GB limit. The age recipient and the custody rules are unchanged.
7. **Run files not attached.** As in R61, this post attaches printed lines, not scripts. Prereg section 7 cites the run files by sha256, and Replicate it cites the run thread's readers by sha256.

## Custody and teardown

- **R61's records.** Four counts-only openings on the run thread's own Capy machine, none on a run host and no model call from any: the first re-read (12:57:10Z), two diagnostics (12:58:36Z and 13:04:21Z, the second logged late, Deviations item 5) and the re-read at the run commit (13:47:23Z). Each decrypted into /dev/shm, extracted only the two sessions' SDK message records, printed counts only, deleted the folder (test ! -e) and swept /tmp, /var/tmp and the tool-output folder before and after, with 0 files left each time.
- **T-G on the run host.** Opened at 13:51:53Z into /dev/shm before any provider key reached the host (4,353 files, 13 task dirs; the 9 unused task dirs deleted). Wiped by logind at about 14:35Z (Deviations item 1), which deleted the plaintext without reading it, and opened again at 14:48:36Z. Sweeps at each seal and each opening found 0 files. The sweep after the dry run found 1 file in /tmp (716 bytes, the stand-in trial's), logged by path, owner and mtime and deleted unread. The custody log records the run-end sweeps as clean.
- **The export.** E2's trial records and gate folders left the host age-encrypted: 66 files of jobs/ and gates/, sha256 f27da007b155f5a2132c584f6f98f5c257738d2a7bb5b6d0c5dd628a4aeb8247, in the project-user drive (Deviations item 6). Four git bundles over 5 MB were left out, listed by size. No plaintext of these records left the host.
- **After teardown.** Two counts-only openings of that export on the run thread's own machine, at 17:30:45Z and 17:31:30Z, for section 5's readings (Deviations item 4). Each deleted its /dev/shm folder within 2 seconds, and the sweeps before and after found 0 files.
- **Teardown.** The run host was destroyed at 17:27:49Z, inside the hours allowance, and the runner's records show no VM left.
- The custody log beside the sealed bundle in the Captain's drive records every opening, deletion, sweep and incident.

## Limits

- **Three sessions on one model.** Opus 5.5 only, as the prereg says: GPT-6.1 Sol is out of wave 1 on price and harness, and particle-1 has no admission row.
- **The cost filter biases toward shorter sessions.** It dropped the two draw tasks whose ungated sessions cost the most, so E2 read exposure where autoplan ran cheaper.
- **The pin moved more than the gate.** ca5dbfc7's setup no longer registers G's skill-contract Stop hook or skill-route UserPromptSubmit hook, so this check can't separate the gate from those changes.
- **The gate doesn't enforce publish order.** Prereg section 11 named this limit, and session 3 met it.
- **The report and publish counts are post hoc.** They come from the records after teardown, by one reader, and show which reports and publishes happened and when, not how good the reviews were.
- **No outcome.** A pass would only have shown the procedure ran where the detector can see it.
- **Outside terms,** as in prereg section 10: gstack is MIT; Harbor is Apache-2.0, run with its telemetry off; Claude Code is Anthropic's proprietary software, here driving Anthropic's own Opus 5.5 through Anthropic's API; the T-G repositories are MIT, Apache-2.0 or BSD, and none is named.

## Replicate it

A recount needs the sealed session records, which stay private. The run thread ran each session with the frozen job file's single-session step and read it with e2-read.ts (sha256 7d01f8bf...), whose output is read.txt. Then, before the next session opened, its rule-count script (rc.ts, sha256 746debb2669a7ccc6cd8e5cea34df3f3733fbc71eb7109d016278cc7d3f3f085) printed rule-count.txt, and its check script (check.ts, sha256 d8ef9e2fcaadd25e43ab9437c073aec9a97c7b236afe26ed4df1c499480c9efb) printed check.txt. After teardown, e2facts.ts (sha256 3310d1c24987baee30d27a3c14d4037fdcf48a7a3a2cca024181c273f0a31307) and facts-reader-e2.py (sha256 4537fd17b1352137fad9db5eb729cc672715cb8e56337c06f45dc367d4fbd3cb) printed the lines in phase-reports.txt and session-facts.txt, out of a counts-only output with sha256 4b7b48746055fccb258659f0e83e3380b5a24da1eb5ff782518b25bf69df4785. The re-read script (reread.ts, sha256 b46a204a83a3a3566dd8d20883907ed3bb857423f7ea1ed82447f3e10d1924be) printed reread-1.txt and reread-2.txt. settle.txt holds the stage driver's settle line, the run thread's settled line and the ledger's status lines for the two items, the envelope and autoplan's line.

The run files are cited by sha256 in prereg section 7 and kept in the project-user drive. The readers and kits are in the Captain's drive. This record leaves out the scripts' text, the host setup commands (they are in the run record) and the paid sessions, which need the sealed T-G bundle, the ledger and an Anthropic key.

## What is held out, and why

T-G stays sealed: its tasks, statements and hidden tests. E2's image manifest stays sealed; its sealed copy's sha256 is e135066c855d054e7886c11707f557fe4ceaf3af89bd217fc6b5f133ee589659. The session records stay sealed, because they quote task code, and so do the gate records, which carry session ids. read.txt carries the gate's counts. The run's plain outputs sit in the Captain's drive under their manifest (MANIFEST.txt sha256 858b097b6a2500311f41d59c0bcd7cda27f82769b113ec485fac836b4d1e3dd6).

## Attribution

Harbor is Apache-2.0. gstack at the pin is MIT. Claude Code is Anthropic's proprietary software, here driving Anthropic's own Opus 5.5 through Anthropic's API. Each task repository keeps its own MIT, Apache-2.0 or BSD licence.

## Changelog

- 2026-11-07: first version.

## Disclosures

gstack is Garry Tan's own project.
