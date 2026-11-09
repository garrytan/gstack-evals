---
id: 2026-11-08-geva-396-autoplan-report-order-recheck-results
kind: finding
title: "With gstack's report-order gate, told autoplan visibly ran its review procedure in 3 of 4 Opus 5.5 sessions (pass); every phase report came before its publish, and the one miss looks like a detector undercount"
summary: "Report-order gate (gstack ddbf1c9a), Opus 5.5, T-G: 3 of 4 exposed, pass. Reports came before publishes in all 4; 18 early publishes refused. One Design load uncredited."
author: GEVA-396
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-08
status: done
links:
  - 2026-11-07-geva-393-e3-autoplan-gate-order-addendum
  - 2026-11-07-geva-387-e2-autoplan-exposure-prereg
  - 2026-11-07-geva-390-e2-detector-cd-amendment
  - 2026-11-07-geva-391-e2-autoplan-exposure-results
  - 2026-11-06-geva-364-g-admission-results
  - lanes/outcome-skills/arms/exposure.ts
attachments:
  - 39b09fe1b2df5247713c7974b2472fff0a78441118fbc9028ba01bd84afeefc6  check.txt
  - 13080fff4a3c2c5652115f97f4e08c7fd866fdd5085293384c43e052c3fbb7df  design-phase.txt
  - 5655e33459f564c5b343050c9698ab724120f0e3c276fcd64a1b2da5932bfc7c  phase-reports.txt
  - 8fa54567d28a6782779a6c49b43028068b993d3f61991998eb06a1df2bf2f6e3  read.txt
  - 7b803527238cf72598ed5cb20efef8231e1ebb579e7cb4a79e94005ea1e02b31  refused-publish.txt
  - 050d5c2e5456bda1aa3239a04d340ed18176947beea37a7c509d0e72bbf8c063  rule-count.txt
  - 15501d82391bdb0399658dcaf3f8668ee8b90878ea32796c58f57c218de68e9b  session-facts.txt
  - 41fdd7c6e068ee9e4f546d92abcb2282c25cbbfb8196f552593010a3a972582c  settle.txt
---

# Told autoplan with gstack's report-order gate: the re-check results (E3)

## Status

Publication status: unpublished. This is the record of a preregistered exposure check. It reads no outcome and no effect of autoplan.

| Field | Value |
|---|---|
| Grade | Exposure check, preregistered. One model (Opus 5.5), the told arm only, 4 of 4 planned sessions. The gate records, the draw-group split and the Design reading are report-only. |
| Prereg | The [E3 addendum](../../plans/2026-11-07-geva-393-e3-autoplan-gate-order-addendum.md), merged as 68aaf1fb, which amends the [E2 prereg](../../plans/2026-11-07-geva-387-e2-autoplan-exposure-prereg.md) (cef946eb) and its [amendment](../../plans/2026-11-07-geva-390-e2-detector-cd-amendment.md) (6d51ff1a) |
| Run commit | 68aaf1fbf491655e5918ac99637a9506013ffb2a, the addendum's merge. rig.yml run 42412105702 passed there. |
| Detector | lanes/outcome-skills/arms/exposure.ts, sha256 f0882eaf2d5fe19ef682ec0f0c88e9a1239870a04544cf6adbf6d34e4e167694, unchanged since E2 |
| Told arm | gstack ddbf1c9a471dbce28ed4ce7340b8af4dd3272957 (version 1.98.0.0), lite loadout with the autoplan gate on, the arm tar built on the run host (sha256 1630ac810b48c9b9da441cab179cc0341c4fac05a1828d1fb0e32fd0dff4412a) |
| Data | The run's plain outputs in the project-user drive, under a sha256 manifest (MANIFEST.txt sha256 3387ad5d1b4f5a322bf5ee5cb926daef4084e6312e604c564b485e7d103f3f1a). read.txt is a byte-identical copy of the reader's last output. The other attachments are lines the run's readers printed, selected by their prefixes (Replicate it). The session records and T-G stay sealed. |
| Reviewed by | The /ship review of this post, recorded in its pull request |
| Reproduced by | Not yet |

## What we found

The check passed. Under the frozen detector, after the refusal rule, the over-credit rule and the refused-publish check, 3 of 4 told sessions read exposed (95% Clopper-Pearson interval 19.4% to 99.4%). The rule passes at 3 of 4. There was no gap, no reclassification and no early stop, and the gap rerun went unused.

The report step held in all 4 sessions: every counted publish came after its own phase report, in phase order. gstack's gate refused 18 publishes, and every one was a publish before its own report. It logged no error, no skipped marker and no ceiling, and it released every run. On tg8d524982ac, where E2's gate ran out of blocks before any report was written, E3's session read exposed.

The one session that read not exposed is the spare, tg6b9daf7138. The pin's wider UI scope rule made Design apply there, and the detector credited no Design load, so review_skills_loaded read false and the class is load step. The counts show the session read Design's methodology file 3 times, right after a methodology call the detector can't credit. That looks like a detector undercount, not a skipped load. The frozen reading stands.

R48: not a null, so there is no cut question. autoplan's exposure is met on Opus 5.5 with this gate. That says the procedure ran where we can see it. It says nothing about whether autoplan improves outcomes, and autoplan's line can't pay for the test that would (What comes next).

## How it works

This is our explanation, not a measured result.

autoplan closes each phase by writing a "**Phase N complete.**" report and then running a publish no-op for that phase. The detector counts a publish only when its result is ok and that phase's report came after the previous counted publish, and it needs the counted publishes to match the applicable phases in order.

E2's gate checked only at Stop, released on reports in any order, and could run out of blocks before the first report. gstack's fix (gstack #4135, commit ddbf1c9a) adds a check before each publish runs: the publish is refused unless its phase is the next one due and its report came since the previous publish. At Stop it counts a publish only after its own report and in order, budgets 3 blocks per step and resets the count when the step advances. Blocks before the first phase report count against no step, and a ceiling of 12 blocks ends a run that never reports.

In E3, autoplan still reached for the publish first. In all four sessions the first publish of the CEO phase came with no report, and the gate refused it 2 to 4 times. The session then ended its turn, the Stop check blocked, and the session wrote the CEO report and published. DX went the same way in three sessions, with 2 refusals each. The other 6 of the 13 phase reports came before the session tried to publish that phase. So the pass belongs to autoplan with this gate on. Under E2's gate, which checked only at Stop, 1 of 9 reports came before the gate's first block and 3 were never written.

## Setup

- **Question.** With gstack's order-enforcing gate on, does told /autoplan on Opus 5.5 visibly run its procedure, as read by the frozen detector? The estimand is the share of told sessions read exposed after the three checks. The check passes at 3 of 4.
- **Arm.** E2's told arm with the gstack pin moved to ddbf1c9a, installed with the lite loadout and the gate on in a clean HOME that the session sees as /root. The run host built the arm tar with e3-told-install.sh (sha256 a0505070...), and its checks passed: the pin's commit and version, the lite loadout and the gate on, exactly the pin's three hooks (Stop for the timeline and the gate, and the gate's new PreToolUse check with matcher Bash), a clean checkout, and a lite render of 197 files with digest 70db9ce6, as the addendum froze. There is no none arm and no judge, because the check reads exposure only.
- **Model and harness.** claude-opus-5-5 through Anthropic's API and the run's metering proxy. Claude Code 2.1.312 with the claude-code-preset system prompt, claude-agent-sdk 0.2.174, Harbor f3a5a92 with HARBOR_TELEMETRY=0, and CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1. The session kind is interactive, and autoplan runs its default full kind. The registry turns t1 to t3 run verbatim (t2 loads /autoplan), with the rec persona and its hold line.
- **Tasks.** tg5dce6b3f8b (E2's unopened session 4), tg6b9daf7138 (the sealed spare, admitted by the Captain's recorded decision, with no cost filter because it has no G session), then tgff24032962 and tg8d524982ac (E2's first two tasks, in E2's order). gstack built its replay tests from E2's sessions, so tasks 3 and 4 are replay sources. One trial each, one at a time.
- **Detector.** autoplanExposure at the run commit, the file E2 ran. A session reads exposed only when config, scope, review_skills_loaded and findings_in_order all pass.
- **Rules.** Intention to treat. As each session settled, the run thread read it with e3-read.ts, applied the refusal rule (a refused call reads not exposed) and the over-credit rule (a load that rests on an open over-credit shape reads not exposed), checked that every refused publish read as an error, wrote the class of any not-exposed session, and only then decided the early stop and opened the next session. A gap reruns once in the whole check. The early stop comes at 3 exposed or 2 not exposed. A cap stop is an incomplete run.
- **Start rules.** All 11 held before the first lease: the merge and the caps, the detector's sha256 at the run commit, the green rig.yml run, the host rules (apt timers off from boot, linger on before any sealed material), the rebuilt envelope matching its export byte for byte, the images rebuilt and checked (13 rows), the arm tar and its render, dry run part 2 on a temporary ledger with a stand-in upstream, the run files' sha256s, and the dry run of the verdict-line checks on hand-written cases. That dry run included the two new refused-publish cases: a refusal recorded as ok stopped the run, and the same refusal recorded as an error passed.
- **Dates and host.** Session 1 ran 2026-11-07 from 22:22:35Z to 23:19:34Z, session 2 from 23:20:07Z to 00:03:04Z, session 3 on 2026-11-08 from 00:08:58Z to 00:41:18Z and session 4 from 00:41:41Z to 01:26:43Z, on one Ubicloud standard-8 run host created at 20:46:23Z and destroyed at 01:31:33Z.

## Result

**Verdict (the frozen rule): pass.** read.txt ends "exposed 3 of 4 read, verdict pass under 3 of 4". check.txt ends "TALLY exposed 3 not_exposed 1 gaps 0 of 4, decision settled pass". After session 3 the tally was 2 exposed and 1 not exposed, so the check went to session 4, which settled it. The frozen rule passes a true exposure rate of 0.9 with probability 0.948 and 0.5 with probability 0.313.

| | Session 1 | Session 2 | Session 3 | Session 4 |
|---|---|---|---|---|
| Task | tg5dce6b3f8b | tg6b9daf7138 (spare) | tgff24032962 | tg8d524982ac |
| Reading after the checks | exposed | not exposed | exposed | exposed |
| config | true | true | true | true |
| scope | true | true | true | true |
| review_skills_loaded | true | false | true | true |
| findings_in_order | true | true | true | true |
| Applicable phases | ceo, dx, eng | ceo, design, dx, eng | ceo, dx, eng | ceo, dx, eng |
| Published, as the detector counts them | ceo, dx, eng | ceo, design, dx, eng | ceo, dx, eng | ceo, dx, eng |
| How t2 ended | quiet | quiet | quiet | quiet |
| Refused calls at the proxy | 0 | 0 | 0 | 0 |
| Refusal rule | clear | clear | clear | clear |
| Over-credit rule | clear | clear | clear | clear |
| Refused publishes recorded as errors | 5 of 5 | 4 of 4 (Deviations, item 1) | 5 of 5 | 4 of 4 |
| Class | | load step | | |

**The gate's records** (report-only: the gate's report over each session's gate record and the session's own t2 tool results, as read.txt records them). They decide nothing.

| | Session 1 | Session 2 | Session 3 | Session 4 |
|---|---|---|---|---|
| Report exit | 0 | 0 | 0 | 0 |
| Fired | 1 | 1 | 1 | 1 |
| Stop blocks (step missing at each) | 2 (ceo, dx) | 5 (ceo, ceo, design, dx, eng) | 3 (ceo, dx, eng) | 3 (ceo, dx, eng) |
| Released | 1 | 1 | 1 | 1 |
| Exhausted | 0 | 0 | 0 | 0 |
| Errors | 0 | 0 | 0 | 0 |
| Skipped | none | none | none | none |
| Publishes refused (phase, why) | 5 (ceo x3, dx x2, no report) | 4 (ceo x4, no report) | 5 (ceo x3, dx x2, no report) | 4 (ceo x2, dx x2, no report) |
| Last step, its blocks | dx, 1 | eng, 1 | eng, 1 | eng, 1 |
| Ceiling | false | false | false | false |

No refusal was for order: each was a publish before its own report. Where the readings disagree, as the addendum's section 4 says they can: in session 2 the gate released the run while the detector reads not exposed, because the gate acts only on reports and publishes, and the miss is a load.

**By draw group** (report-only, addendum section 2). On tasks 1 and 2, which the fix's replays didn't come from, 1 of 2 read exposed, and the miss is the spare. On tasks 3 and 4, the replay sources, 2 of 2 read exposed. A pass needed at least one exposed session on a replay-source task, and it rests on both. Beside E2 on the same tasks:

| Task | E2 | E3 |
|---|---|---|
| tgff24032962 | exposed; gate blocked 3 (ceo, dx, eng), released | exposed; blocked 3 (ceo, dx, eng), released, 5 publishes refused |
| tg8d524982ac | not exposed, findings_in_order false, nothing counted as published; gate blocked 3 (ceo each time) and exhausted before any report | exposed, published ceo, dx, eng in order; blocked 3 (ceo, dx, eng), released, 4 publishes refused |

The per-session costs are in Agent notes.

**Session facts** (report-only, session-facts.txt and the stage driver's session log).

| | Session 1 | Session 2 | Session 3 | Session 4 |
|---|---|---|---|---|
| Termination | completed | completed | completed | completed |
| Persona in t2 | 1 question (recommended reply), 0 prose | 2 questions (recommended reply), 0 prose | 1 question (recommended reply), 0 prose | 1 question (recommended reply), 0 prose |
| /autoplan loads in t2 | 1 | 1 | 1 | 1 |
| Model calls (proxy requests, all answered) | 202 | 264 | 194 | 190 |
| Tool calls (the session's own) | 224 (182) | 299 (239) | 251 (209) | 200 (154) |
| Own tool results that read as errors | 12 | 10 | 13 | 11 |

No session ended on the budget, the turn limit or the wall limit. On the three tasks with a G reading, E3's gated sessions cost 1.17 times G's ungated sessions (both G trials averaged), against E2's 1.12 and R61's 1.31. That is a description from one trial per task, not an estimate of what the gate costs.

## Readings beside the verdict (report-only)

**1. Which rule credited each load** (rule-count.txt, printed on the run host as each session settled, before it counted). Every credited phase had one methodology call, made before that phase's publish, and 4 credited reads of its methodology file after it. No credit went through an open over-credit shape, and the count matched the detector in every session.

| | CEO | Design | DX | Eng |
|---|---|---|---|---|
| Session 1 | JSON path rule (call unpiped) | not applicable | methodology-file rule (piped once, to python3) | methodology-file rule (piped, to python3) |
| Session 2 | JSON path rule (unpiped) | no credit (item 3) | methodology-file rule (one leading cd, piped to python3) | methodology-file rule (one leading cd, piped to python3) |
| Session 3 | JSON path rule (unpiped) | not applicable | methodology-file rule (piped, to python3) | methodology-file rule (piped, to python3) |
| Session 4 | JSON path rule (unpiped) | not applicable | methodology-file rule (piped, to python3) | methodology-file rule (piped, to python3) |

Each credited cell is 4 credits, 12 per session. The call shapes, as class labels with no command text, are in rule-count.txt. E2's amendment, which lets one leading cd to a plain path come before the call, credited session 2's DX and Eng loads. Without it that session would have failed on those two phases as well.

**2. Reports and publishes around each refusal and block** (phase-reports.txt, printed on the run host as each session settled). R1, R2, R2.5 and R3 are the session's own "**Phase N complete.**" lines for CEO, Design, DX and Eng. P<phase> is a publish no-op, D<phase>:<why> is a publish the gate refused, and a U[hook,gate,stop,phase,pub] record is a Stop block. Other S, U, O and X tokens are system, user, other and result records, tagged with the words they contain.

- **Session 1 (exposed).** CEO's publish was refused 3 times for no report, then a Stop block, then R1 and CEO's publish went through. DX's publish was refused twice, then R2.5, a Stop block, R2.5 again, and DX's publish. R3 came before Eng's first publish, which went through.
- **Session 2 (not exposed, load step).** CEO's publish was refused 4 times, then a Stop block, R1, another block and CEO's publish. Design, DX and Eng each had their report before any publish of that phase, then a Stop block, then the publish.
- **Session 3 (exposed).** CEO refused 3 times, a block, R1, publish. DX refused twice, R2.5, a block, R2.5 again, publish. R3, a block, R3 again, Eng's publish.
- **Session 4 (exposed).** As session 3, with CEO refused twice.

Across the four sessions, no phase report came before the gate's first refusal. 7 of the 13 reports came after refusals of their own phase's publish (CEO in all four sessions, DX in three), and 6 came before the session first tried to publish that phase. Every counted publish came after its own report and in order.

**3. Session 2's Design phase** (design-phase.txt, the Design part of a counts-only diagnostic printed on the run host after session 2, at the Captain's question).

- The pin's UI scope rule counts more words and file types than E2's pin did (addendum section 1), and on the spare it made Design applicable. Design reported and published in order.
- Design had one methodology call (record 937). It had more commands after its pipe, the last an ls with a redirect, and its result reads as an error.
- The detector credits a read of a phase's methodology file only after a methodology call for that phase that ran by itself and returned without error, and that call returned an error, so it credits nothing after it. In the 11 tool calls that followed it, before the next snapshot call, the session read a Design methodology file 3 times. Three later snapshot calls named Design with another subcommand, and none of those is a methodology call.
- Reading: Design was read, through a shape the detector can't credit. The rule is strict on purpose, to avoid over-credit, and the addendum's limits say such undercounts stay and can only lower the exposed count. The frozen reading stands: not exposed, class load step. The counts can't show what the session did with what it read.

**4. Session facts** are in the Result section above.

## R48 reading

**Not a null.** The addendum's section 5 fixed the reading before the run: a pass means autoplan's exposure is met on Opus 5.5 with this gate, and the next step is a funding question for an outcome test. R48's cycle applies to null and negative results, so no KEEP, FIX-METHOD or CUT-CANDIDATE verdict is owed.

- *No cut question.* E2's flip condition was a re-check that still failed on the report step. The report step held in all 4 sessions, so it didn't fire. The one not-exposed session is a load-step miss, which in a failing check would have fed a cut question. Here the check passed, and the counts point to a detector undercount rather than a skipped load.
- *Exposure.* 3 of 4 sessions ran the procedure where the detector can see it, and the fourth session read Design's methodology through a call shape the detector can't credit. The gate made the reports happen: the session's first publish of CEO had no report every time.
- *Task fit and the frontier.* Not tested here. On T-G, G found plain Opus 5.5 at 22 of 22, so these tasks have no headroom for an outcome test of autoplan.
- *Power.* Four sessions. 3 of 4 has a 95% interval of 19.4% to 99.4%, so the count alone can't separate a 50% rate from a 95% one. The gate records carry more of the reading than the count does.

## What comes next

Exposure passing doesn't show that autoplan improves outcomes. It shows only that, with this gate, the procedure ran where the detector can see it. An outcome test needs four things on top of that: tasks with headroom (T-G has none), a headroom check on the no-gstack arm before the comparison (the next-round plan priced one at 20 tasks x 3 trials, and its price and cap are in Agent notes), a no-gstack arm paired with the told arm on every task, and enough pairs to detect a useful effect.

E2's results post sized the comparison with plan v3's power script (the same grid, times 1.2), told gated autoplan against no gstack, scored solved or not:

| Design (tasks x trials) | Pairs | MDD, points |
|---|---|---|
| 16 x 1, or 8 x 2 | 16 | above 40 |
| 30 x 1 | 30 | 43.2 |
| 24 x 4 | 96 | 26.4 |
| 36 x 4 | 144 | 21.0 |
| 42 x 4 | 168 | 19.8 |

At 24 pairs or fewer the power script finds no MDD up to 40 points.

**autoplan's line can't power the comparison.** Spent on pairs alone, that buys fewer than 30, and even 30 pairs has an MDD of 43.2 points. The next step needs a new preregistration of its own: find harder tasks and run the headroom check inside the line, so that the question reaches the owner with the no-gstack arm's measured rate on those tasks. Any comparison run inside the line would be descriptive only.

## Deviations

None changes the arm, a task, the detector, a scoring rule, a cap or the verdict.

1. **The refused-publish check, narrowed by the Captain's ruling.** The addendum's section 3 says every tool result in a session's own t2 records that carries the gate's publish-refusal marker must read as an error, or the run stops before that session counts. After session 2 the check found 5 such results. 4 were the session's real refused publishes, all recorded as errors, matching the gate's 4 refusals. The fifth was the result of a search command whose output quoted the marker, which read ok. Under the literal wording the run would have stopped before session 2 counted. The Captain ruled that the check covers only the results of the exact publish no-op, which is the purpose section 3 states: a result that only quotes the marker isn't a publish, and the detector counts only the exact no-op. The ruling was recorded at 00:08:54Z, before session 3 opened. It changed no session's class: session 2 counted as not exposed, load step, either way. From session 3 on, rp-diag.ts listed every marked result with its command class, and every result of the exact publish no-op read as an error (refused-publish.txt).
2. **Setup snags on the host.** Setup first ran the gstack-evals bootstrap from the wrong folder (fixed with one cd), and a relaunch over ssh left an empty setup file (relaunched in the foreground). The arm-home install, which checks the pin's render before the tar build, found no bun under its clean PATH, so that one run was given bun's folder on PATH. The tar build itself runs in its builder container and was unchanged. Every run file matched its addendum sha256 on the host.
3. **The stage driver's first launch.** The first launch left out two required options and exited at once with a usage error. It opened no lease (ap-e3 showed nothing committed after it), and the second launch is the one that ran.
4. **The envelope manifest.** The first re-export's MANIFEST listed itself, because the redirect created the file before the listing ran. It was regenerated without its own line (90 lines, sha256 11404cfdf3fd413576207ab5763f75db7d3f27bc0da2420acc5982b5e0f49fed), and its check passes.
5. **Kits on the host.** The run thread's readers and checks are not frozen files. They are E2's kits renamed for E3, plus four new counts-only scripts: rp.ts and rp-diag.ts for the refused-publish check, design-diag.ts for the Design question, and session-step.sh, which ran every reader after each session. rp.ts and session-step.sh ran on stand-in trials before the first real session. rp-diag.ts and design-diag.ts were written after session 2's stop to answer the Captain's questions, and weren't run on stand-ins first. Their sha256s are in Replicate it.
6. **Tokens read after the run.** The handoff from the run thread said token counts weren't available. They were in the stage driver's session log, and this post read them there, counts only, from the plain host logs.
7. **Run files not attached.** As in R61 and E2, this post attaches printed lines, not scripts. The addendum's section 7 cites the run files by sha256, and Replicate it cites the readers by sha256.

## Custody and teardown

- **One opening.** The sealed T-G bundle was opened once, at 21:04:52Z on the run host, into /dev/shm, after linger was on and before any provider key reached the host. The identity copy went in over ssh stdin and was deleted at 21:04:53Z (test ! -e). The specs, answers and slice file were deleted at 21:04:54Z, and the 9 unused task folders at 21:58:46Z, after the image binds. Only the 4 E3 task folders stayed.
- **Images.** Rebuilt at the run commit over all 13 units and checked (13 rows). The manifest stays sealed; its sealed copy's sha256 is 91b4be6c8ac34c71fc4261691edf36c28bb17a935a103b6d2fea097e42c0c792.
- **The export.** E3's trial records and gate folders left the host age-encrypted: 93 files of jobs/ and gates/, sha256 5e83c60f7dd43e7261dbc52bdfe6ee126b35177045c8eb0f343e2e337dc7461d, in the project-user drive. Six files over 5 MB were left out and are listed by size. No plaintext of these records left the host.
- **Sweeps.** Every sweep logged counts and file metadata only. The sweep after the dry run found 1 file in /tmp (716 bytes, the stand-in trial's), and the end sweep found 4 (one 716-byte file per session), each logged and deleted unread. /var/tmp held nothing at any sweep.
- **Teardown.** /dev/shm/e3 was deleted at 01:31:24Z and checked with test ! -e. The host was destroyed at 01:31:33Z, and the runner's list of the run thread's VMs came back empty. There was no custody incident.
- The custody log beside the sealed bundle in the Captain's drive records every opening, deletion, sweep and incident.

## Limits

- **Four sessions on one model.** Opus 5.5 only. The told arm drives Claude Code, which can't run GPT-6.1 Sol, and particle-1 has no admission row.
- **Two of four tasks are replay sources,** and the pass rests on both of them. On the two other tasks, 1 of 2 read exposed. The spare ran without the cost filter.
- **The pin moved more than the gate.** It widened the UI scope rule, which added Design on the spare, and its lite render dropped /investigate (197 files where E2's had 205). This check can't separate the gate from those changes.
- **Claude Code version.** gstack tested the gate on 2.1.318, and the arm ran 2.1.312. Every refused publish was recorded as an error, as the keyless smoke on 2.1.312 predicted.
- **The detector's known undercounts stay.** One likely cost this check a session. They can only lower the exposed count.
- **The pass belongs to the gate as much as to autoplan.** Under E2's gate, which checked only at Stop, the report step mostly failed, and in every E3 session the first CEO publish came with no report.
- **The report and publish counts describe order, not quality.** They show which reports and publishes happened and when, not how good the reviews were.
- **No outcome.** A pass shows the procedure ran where the detector can see it.
- **Outside terms,** as in the addendum's section 10: gstack is MIT; Harbor is Apache-2.0, run with its telemetry off; Claude Code is Anthropic's proprietary software, here driving Anthropic's own Opus 5.5 through Anthropic's API; the T-G repositories are MIT, Apache-2.0 or BSD, and none is named.

## Replicate it

A recount needs the sealed session records, which stay private. The run thread ran each session with the frozen job file's single-session step and read it with e3-read.ts (sha256 1bb216ef0404c13bdd1b3709f371dea40cb6e46906548a1a37c9fe9704e4a902), whose last output is read.txt. After each session, before the next one opened, session-step.sh (sha256 41bc30eb16c94bba554b53f055bd842d8713c8a424e4f5c99bf30cb97df962b3) ran the rule-count script rc.ts (746debb2669a7ccc6cd8e5cea34df3f3733fbc71eb7109d016278cc7d3f3f085), which printed the lines in rule-count.txt; rp.ts (fb3fcfb4aa052555cab5545dc770e42cbf5289a03a8a6af719ab3d02b7daff82), which printed the rp lines in refused-publish.txt; check.ts (d8ef9e2fcaadd25e43ab9437c073aec9a97c7b236afe26ed4df1c499480c9efb), which printed check.txt; e3facts.ts (509202ab385d9b417c7f320c4468dc2b0646077dfaea5ff094f75c0d0e403fd7), which printed phase-reports.txt and the facts lines; and facts-reader-e3.py (f9151f359613746dd5d5a202d88b7c764948ef65f0571f9a7862d13aa9992e57), which printed the summary lines in session-facts.txt. rp-diag.ts (a284651414b0f5f380d45469375468c272d655f7136fbeace55d7f878db0b109) printed the rpd lines for sessions 2 to 4, each group headed by its session's label, and design-diag.ts (8c3f15ccfcfa60e07dfd2fe0f493db1b344291b1df0b74630bd01c1716a51e2b) printed design-phase.txt, whose Design part is attached and whose CEO part, printed for comparison, is left out. settle.txt holds the stage driver's settle line, the run thread's settled line, the hours lease line and the ledger's status lines for the two items, the envelope and autoplan's line.

The run files are cited by sha256 in the addendum's section 7 and kept in the project-user drive. The readers and kits are in the Captain's drive, with their sha256s. This record leaves out the scripts' text, the host setup commands (they are in the run record) and the paid sessions, which need the sealed T-G bundle, the ledger and an Anthropic key.

## What is held out, and why

T-G stays sealed: its tasks, statements and hidden tests. E3's image manifest stays sealed (its sealed copy's sha256 is above). The session records stay sealed, because they quote task code, and so do the gate records, which carry session ids. read.txt carries the gate's counts. The run's plain outputs sit in the project-user drive under their manifest (MANIFEST.txt sha256 3387ad5d1b4f5a322bf5ee5cb926daef4084e6312e604c564b485e7d103f3f1a).

## Attribution

Harbor is Apache-2.0. gstack at the pin is MIT. Claude Code is Anthropic's proprietary software, here driving Anthropic's own Opus 5.5 through Anthropic's API. Each task repository keeps its own MIT, Apache-2.0 or BSD licence.

## Changelog

- 2026-11-08: first version.

<details>
<summary>Agent notes</summary>

Paid spend was $79.81 against $352 in caps.

The arm's limits: $45, 400 turns, 4 hours, quiet 30 s, background wait 600 s.

| Task | E2 | E3 |
|---|---|---|
| tgff24032962 | exposed; gate blocked 3 (ceo, dx, eng), released; $17.19 | exposed; blocked 3 (ceo, dx, eng), released, 5 publishes refused; $16.62 |
| tg8d524982ac | not exposed, findings_in_order false, nothing counted as published; gate blocked 3 (ceo each time) and exhausted before any report; $13.73 | exposed, published ceo, dx, eng in order; blocked 3 (ceo, dx, eng), released, 4 publishes refused; $17.04 |

| | Session 1 | Session 2 | Session 3 | Session 4 |
|---|---|---|---|---|
| Termination | completed | completed | completed | completed |
| Persona in t2 | 1 question (recommended reply), 0 prose | 2 questions (recommended reply), 0 prose | 1 question (recommended reply), 0 prose | 1 question (recommended reply), 0 prose |
| /autoplan loads in t2 | 1 | 1 | 1 | 1 |
| Model calls (proxy requests, all answered) | 202 | 264 | 194 | 190 |
| Tool calls (the session's own) | 224 (182) | 299 (239) | 251 (209) | 200 (154) |
| Own tool results that read as errors | 12 | 10 | 13 | 11 |
| Metered cost | $21.919167 | $22.655697 | $16.624229 | $17.037058 |
| G's ungated told session on the same task, trials 1 and 2 | $17.10, $14.81 | none (the spare) | $16.07, $14.20 | $15.57, $17.26 |

**Cost**

**Paid** (the ledger, wave 1 envelope; settle.txt).

| Item | Charged to | Lease | Settled | Cap | Share of cap |
|---|---|---|---|---|---|
| ap-e3, model calls | autoplan | ap-e3.0001.df8579, 4 sessions | $78.236151 | $343 | 22.8% |
| e3-vm, run host hours | autoplan | e3-vm.0001.d6ea45, 5.234 h | $1.570200 | $9 | 17.4% |
| **Paid** | | | **$79.806351** | **$352** | 22.7% |

The model-call lease settled with unknown $0.00, and the four sessions' metered costs sum to it exactly. The host hours run from the host's creation at 20:46:23Z to the lease settle at 01:30:25Z, plus the half-hour teardown allowance, as in E2: 5.234 hours of a standard-8 at the Captain's $0.30 reserve rate. The host was destroyed inside the allowance. The addendum expected $80 to $100 for four sessions. After settling, wave 1 reads $1,574.29218 committed of $10,000 with nothing open, and autoplan's line on the ledger reads $1,007.329551 settled of $2,000.

**Tokens** (the close events in the stage driver's session log, from the metering proxy). The run thread's readers didn't print these. This post reads them from that log, a plain file in the run's host logs (host-run.tar, listed in the plain outputs' MANIFEST).

| | Input | Output | Cache read | Cache write | Total |
|---|---|---|---|---|---|
| Session 1 | 406 | 181,256 | 48,640,235 | 1,712,860 | 50,534,757 |
| Session 2 | 530 | 200,123 | 72,919,304 | 813,432 | 73,933,389 |
| Session 3 | 390 | 180,338 | 47,574,705 | 700,178 | 48,455,611 |
| Session 4 | 382 | 217,509 | 46,109,086 | 692,693 | 47,019,670 |
| **All four** | 1,708 | 779,226 | 215,243,330 | 3,919,163 | 219,943,427 |

**Prices.** Opus 5.5 in dollars per million tokens, from src/runner/pricing/prices.ts at the run commit, as the proxy used them on 2026-11-07 and 2026-11-08: input 4, output 20, cache read 0.20, cache write 5. Cache reads and writes are counted as the proxy reported them, and the token totals at these prices give each session's metered cost to the cent. Per session the mean was $19.56, and per exposed session $26.08.

**Crew**, from the thread counters at the Captain's rate of $1 per 1,000 credits, read on 2026-11-08. Every thread below has finished except this one.

| Thread | Work | Credits | Tokens | Dollars |
|---|---|---|---|---|
| GEVA-375 | R61 prereg | 27,426 | 77.7M | $27.43 |
| GEVA-382 | R61 run | 23,982 | 63.3M | $23.98 |
| GEVA-384 | R61 results post | 18,001 | 54.8M | $18.00 |
| GEVA-386 | R61 results post, /ship tail | 5,872 | 20.5M | $5.87 |
| GEVA-387 | next-round plan, first detector fix and E2 prereg | 38,555 | 104.4M | $38.56 |
| GEVA-389 | first detector fix and E2 prereg, /ship tail | 19,470 | 73.9M | $19.47 |
| GEVA-390 | R61 re-read, second detector fix, E2 run | 37,047 | 100.8M | $37.05 |
| GEVA-391 | E2 results post | 12,771 | 41.1M | $12.77 |
| GEVA-393 | E3 addendum and run | 50,940 | 97.6M | $50.94 |
| GEVA-396 | this post, when written | 3,359 | 10.7M | $3.36 |

**autoplan's line, all-in, on actuals.** Paid on the ledger: G's autoplan share $474.68 (g-ap plus half of g-none, g-vm and g-tg), R61 $45.13, E2 $60.44 and E3 $79.81, so $660.07. G's crew: $453.40, autoplan's half of $906.79 over G's 29 threads at final counters, as the R61 results post read them. The crew after G, in the table above without this thread: $234.07. That is $1,347.54, plus this post's thread ($3.36 when written, not final): about $1,351 of $2,000, with about $649 left. The ledger's own $1,007.33 includes $347.26 of G crew rows recorded on 2026-11-05, which the counter reading replaces. gstack's own lane built the gate, and that work is not on this line.

An outcome test needs four things on top of that: tasks with headroom (T-G has none), a headroom check on the no-gstack arm before the comparison (the next-round plan priced one at 20 tasks x 3 trials, about $290 expected with a $485 cap), a no-gstack arm paired with the told arm on every task, and enough pairs to detect a useful effect.

| Design (tasks x trials) | Pairs | MDD, points | Expected paid | At G-style caps |
|---|---|---|---|---|
| 16 x 1, or 8 x 2 | 16 | above 40 | $410 to $490 | $930 |
| 30 x 1 | 30 | 43.2 | $770 to $920 | $1,750 |
| 24 x 4 | 96 | 26.4 | $2,450 to $2,930 | $5,600 |
| 36 x 4 | 144 | 21.0 | $3,670 to $4,390 | $8,400 |
| 42 x 4 | 168 | 19.8 | $4,280 to $5,120 | $9,800 |

Expected paid assumes $24 to $29 per told session on harder tasks plus $1.50 per none session. For comparison, E3's told sessions averaged $19.56 on T-G.

**autoplan's line can't power the comparison.** About $649 is left on the $2,000 line. A 20-point test needs 42 x 4, about $4,280 to $5,120 expected, which is past the line, so the comparison is a funding question for the project owner, which the Captain puts to him.

From the summary: Paid $79.81.

3. **The stage driver's first launch.** The first launch left out two required options and exited at once with a usage error. It opened no lease (ap-e3 read $0.00 committed after it), and the second launch is the one that ran.

</details>

## Disclosures

gstack is Garry Tan's own project.
