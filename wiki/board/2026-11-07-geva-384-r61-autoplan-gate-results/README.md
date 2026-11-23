---
id: 2026-11-07-geva-384-r61-autoplan-gate-results
kind: finding
title: "R61 results: autoplan with gstack's opt-in stop gate read 0 of 2 told Opus 5.5 sessions exposed (fail at the early stop); the review loads ran but the frozen detector saw 2 of 6, so FIX-METHOD"
summary: "Stop gate on (gstack ca5dbfc7), Opus 5.5, T-G: 0 of 2 exposed, fail at the early stop. Exploratory: all 6 review loads ran, the detector saw 2. FIX-METHOD."
author: GEVA-384
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-07
status: done
links:
  - 2026-11-07-geva-375-r61-autoplan-gate-exposure-prereg
  - 2026-11-04-geva-262-g-family-admission-prereg
  - 2026-11-06-geva-364-g-admission-results
  - lanes/outcome-skills/arms/exposure.ts
attachments:
  - 02b81684da4288c8d26620fea87db98e8ac982f6ec50207126ba04f6dba350f6  pre-r48-check.txt
  - 5d81f54ebd30ccec86dbfc4f2791f7cfc8f154e5b8958f4d49819d472b33791e  read.txt
  - 0b80c4e439c41f6c4673d1cb688036c7ebfda76300e9d8605fbcfa862fdfe43f  session-facts.txt
  - 35fc6fed1b1d610895c18bbfc314caf2117ed2286d987f50d441d1f2d8bba905  settle.txt
---

# R61 results: autoplan with gstack's opt-in stop gate on Opus 5.5

## Status

Publication status: unpublished. This is the record of a preregistered exposure check. It reads no outcome and no effect of autoplan.

| Field | Value |
|---|---|
| Grade | Exposure check, preregistered. One model (Opus 5.5), the told arm only, 2 of 4 planned sessions (early stop). The section "Pre-R48 check" is exploratory and post hoc. |
| Prereg | [R61 prereg](../../plans/2026-11-07-geva-375-r61-autoplan-gate-exposure-prereg.md), merged as 2b596ec6 |
| Run commit | 2b596ec64cbe691b3e51eb5ee7fdca589902077d, the prereg's merge. rig.yml run 42343856227 passed there (Deviations, item 4). |
| Told arm | gstack ca5dbfc7e0016e3a1511161dc8c094399a2e350b (1.97.0.0), lite loadout with `--autoplan-gate` |
| Data | The run's exported results in the Captain's drive, checked against their sha256 manifest. read.txt, session-facts.txt and settle.txt are byte-identical copies. pre-r48-check.txt holds the lines this post's own check printed. The session records and T-G stay sealed. |
| Reviewed by | The /ship review of this post, recorded in its pull request |
| Reproduced by | Not yet |

## What we found

The check failed. Under G's frozen detector, 0 of 2 told sessions read exposed (95% Clopper-Pearson interval 0% to 84.2%). The rule passes at 3 of 4, so the early stop ended the check after session 2, and sessions 3 and 4 never opened. No gap occurred, so the one rerun went unused.

The gate worked as built. In both sessions it held the final stop until the phases published (2 and 3 blocks), released once and logged no error. In session 2 every applicable phase (CEO, DX, Eng) then published in order. Both sessions failed review_skills_loaded, and session 1 also failed findings_in_order.

An exploratory check on the sealed records, run after the verdict, found that the review-skill loads did happen. In both sessions every applicable phase read its whole review methodology, in the session's own records, before it published. The detector counted CEO's load and missed DX's and Eng's: the session piped the command that names the methodology file through python3, and the detector learns that file's path only from the command's raw JSON. With those loads counted, session 2 would read exposed and session 1 would not. That does not change the verdict.

R48: **FIX-METHOD** (an exposure null, R61's one attempt). The attempt failed in part on gstack-evals' own detector, which R61 treats as a method limit, and the skill's load step ran in every phase, so there is no cut question.

## How it works

This is our explanation, not a measured result.

At ca5dbfc7, autoplan loads each phase's review skill in two steps. A Bash call, `gstack-autoplan-snapshot methodology <phase> <installed SKILL.md> <restore path>`, writes one methodology file (the review skill's SKILL.md, plus its review-sections file where the skill has one) and prints a JSON manifest that names the file and its read ranges. The session then reads the file in 600-line ranges. The frozen detector credits a phase's load when the session Reads either a plan-*-review/SKILL.md or a path it parsed from that manifest, before the phase's first publish. When the session pipes the command's output into another program, the tool result is no longer the manifest, and the detector has no path to match.

The gate counts a publish from "Phase N ... complete" wording and also needs the Final Approval Gate. In both sessions the first run of publish no-ops came with no such line, so at its first block the gate counted only the phase that had a report (Eng in session 1, none in session 2). After the blocks the session wrote the phase reports and published again. That is how the gate turned session 2 into an in-order run.

## Setup

- **Question.** With gstack's opt-in stop gate on, does told /autoplan on Opus 5.5 visibly run its procedure? The estimand is the share of told sessions that G's frozen detector reads exposed. The check passes at 3 of 4.
- **Arm.** G's told autoplan arm with one change, the gstack pin: ca5dbfc7 (1.97.0.0), installed with `./setup --host claude --loadout lite --autoplan-gate` in a clean HOME that the session sees as /root. The pin also dropped G's skill-contract Stop hook and skill-route UserPromptSubmit hook (Limits). There is no none arm and no judge, because the check reads exposure only.
- **Model and harness.** claude-opus-5-5 through Anthropic's API and the run's metering proxy. Claude Code 2.1.312 with the claude-code-preset system prompt, claude-agent-sdk 0.2.174, Harbor f3a5a92 with HARBOR_TELEMETRY=0, and CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1. The session kind is interactive, and autoplan runs its default full kind with a Claude subagent as its outside voice. The registry turns t1 to t3 run verbatim (t2 is `/autoplan PLAN.md`), with the rec persona and its hold line.
- **Tasks.** The first four distinct tasks of G's frozen autoplan draw on T-G: tg0b7b079452, tged20545f89, tgff24032962 and tg0a031169b2. One trial each, one at a time, in that order.
- **Detector.** autoplanExposure in lanes/outcome-skills/arms/exposure.ts, sha256 074336a6f7d31c8669fc69e214c847c6251c9a550dfa4ca1d56c1d068258a0fd, unchanged since G's run. A session reads exposed only when config, scope, review_skills_loaded and findings_in_order all pass.
- **Rules.** Intention to treat. A gap reruns once in the whole check. The early stop comes at 3 exposed or 2 not exposed. A cap stop is an incomplete run.
- **Dates and host.** 2026-11-07. Session 1 ran from 06:06:32Z to 07:06:06Z and session 2 from 07:19:14Z to 07:47:46Z, on one Ubicloud standard-8 run host.

## Result

**Verdict (the frozen rule, prereg section 4): fail.** read.txt ends "exposed 0 of 2 read, verdict fail under 3 of 4". Sessions 3 and 4 never opened. The frozen rule passes a true exposure rate of 0.5 with probability 0.313.

| | Session 1 | Session 2 |
|---|---|---|
| Task | tg0b7b079452 | tged20545f89 |
| Reading | not exposed | not exposed |
| config | true | true |
| scope | true | true |
| review_skills_loaded | false | false |
| findings_in_order | false | true |
| Applicable phases | ceo, dx, eng | ceo, dx, eng |
| Published, as the detector counts them | eng, ceo, eng, dx | ceo, dx, eng |

**The gate's own reading** (report-only: `gstack-skill-gates report --expect armed`, as read.txt and session-facts.txt record it). It decides nothing.

| | Session 1 | Session 2 |
|---|---|---|
| Report exit | 0 | 0 |
| Fired | 1 | 1 |
| Blocked (steps missing) | 2 (ceo, dx) | 3 (ceo, dx, eng) |
| Released | 1 | 1 |
| Exhausted | 0 | 0 |
| Errors | 0 | 0 |
| Skipped | none | none |

**Session facts** (report-only, session-facts.txt).

| | Session 1 | Session 2 |
|---|---|---|
| How t2 ended | quiet; termination completed; no exception | quiet; termination completed; no exception |
| Persona in t2 | 1 question (recommended reply), 0 prose | 1 question (recommended reply), 0 prose |
| /autoplan loads in t2 | 1 | 1 |
| Model calls | 320, none refused | 168, none refused |
| Tool calls | 409 | 182 |

None of the question-stop risks in prereg section 2 showed up. Each session asked the persona one question, which got the recommended reply, and no prose question went unanswered. No session loaded /autoplan a second time (prereg section 5, item 3).

## Pre-R48 check (exploratory)

The R48 reading turns on one question the frozen readings can't answer: did the sessions load the review skills somewhere the detector doesn't look, or not at all? This post's thread opened the sealed trial records once to count it (Custody and teardown). It read only the two sessions' SDK message records and printed counts only, kept in pre-r48-check.txt. The check was written after the verdict, by one reader, and is not preregistered.

1. **The frozen detector, rerun on the records, gives the same readings.** All four checks and both published lists match read.txt.
2. **By phase, the detector's load rule passed for CEO and failed for DX and Eng, in both sessions.**
3. **Every phase loaded its whole review methodology, in the session's own records.** For each applicable phase, the session itself (turn t2, parent_tool_use_id null) ran the methodology command on the review skill's SKILL.md, then Read the methodology file in 4 ranged calls that covered every line: CEO 2,224 lines, DX 1,871 and Eng 2,110. All 24 Reads succeeded, and each came before its phase's first publish. That is 6 of 6 phase loads (3 phases in each of 2 sessions).
4. **Why the detector missed DX and Eng.** For CEO the session ran the methodology command alone, and its result parsed as the JSON manifest. For DX and Eng both sessions piped the command's output through python3, so the result was not the manifest and the detector never learned the file's path. Neither session Read a plan-*-review/SKILL.md directly, and neither called the Skill tool.
5. **Subagents loaded nothing.** Each session made 6 Agent calls (general-purpose, no model override). Their records hold 3 and 5 Reads, none of them a review SKILL.md or a methodology file.
6. **Publishes.** In both sessions the first run of publish no-ops (ceo, dx, eng, eng in session 1; ceo, ceo, dx, eng, eng in session 2) came with no "Phase N complete" line in the session's own text since the previous no-op. Of the 7 reports the detector counted, 6 came after a gate block. In session 1, eng came before any block, ceo and eng after the first block and dx after the second. In session 2, ceo, dx and eng came after the first, second and third blocks.
7. **A widened reading.** A detector that also credited a Read of the phase's own methodology file (autoplan-<phase>-methodology-*/methodology.md) before that phase's first publish reads session 2 exposed, with all four checks true, and session 1 not exposed on findings_in_order. That is 1 of 2, which would still leave the 3-of-4 rule undecided. It is not the frozen reading, and the verdict stands.

## Why null? (R48)

**autoplan: FIX-METHOD (an exposure null, R61's one attempt).**

- *Exposure.* The frozen reading is 0 of 2. The exploratory check shows the load step ran in all 6 phase loads, in the sessions' own records, and the detector saw 2 of them. The publish step ran in order in session 2, after the gate had held the stop three times. In session 1 Eng's report came first and Eng published twice, which the frozen rule counts as out of order. So the null is part detector miss and part real: the sessions read the review skills, and 6 of the 7 counted phase reports came out after a gate block.
- *Task fit.* Not tested, because this check reads exposure only. On T-G, G found plain Opus 5.5 at 22 of 22, so these tasks have no headroom for an outcome test of autoplan.
- *Power, floor and ceiling.* Two sessions under an early stop. 0 of 2 has a 95% interval of 0% to 84.2%, and the frozen rule passes a true rate of 0.5 only 31% of the time. The widened reading, 1 of 2, would also leave the rule undecided.
- *Frontier without it.* Opus 5.5 is the frontier model here, and on these tasks it does the work without the skill (G: 22 of 22).
- *Kind of null.* An exposure null, from R61's one attempt to fix autoplan's exposure method.

The verdict is FIX-METHOD rather than CUT-CANDIDATE for two reasons. The attempt failed in part on the instrument: gstack-evals' detector missed 4 of the 6 loads it was built to see, and R61 sends a failure that rests on harness limits to FIX-METHOD. And the skill's load step ran in every phase, so the evidence does not say the procedure gets skipped.

Under R56's fair-test rule, autoplan on Opus 5.5 still reads untested: the frozen exposure is 0 of 2.

Where it goes, as prereg section 9 says for fewer than 3 exposed:

- **To gstack's maintainers,** with the per-check reasons and the gate's reading above. In both sessions the first run of publish no-ops came with no phase report, 6 of the 7 counted reports came after a gate block, and session 1 published Eng's report first.
- **To gstack-evals.** The detector's methodology-path rule fails closed on piped output. A fix credits a Read of the phase's own methodology file, keeps refusing a load that comes after the phase's publish, and needs tests in both directions before any reuse. G's 0 of 23 used the same rule, and G's session records were deleted when its custody closed, so G can't be re-read for this miss.
- **A confirmatory reading** needs a new preregistered check with the fixed detector.

## Deviations

None changes the arm, a task, the detector, a scoring rule, a cap or the verdict.

1. **New image manifest,** as prereg section 3 foresaw. The 13 T-G images were rebuilt by `outcome images pin --set T-G` on the run host under custody, before any key reached it. The new manifest (sha256 8a0fd900063fe2d68fd2c1d6d73ea38304506d9496f74b9cca7dff35c7bcc2f8) replaces 7b1ab47b for R61 only, and `images check` passed on 13 rows.
2. **Host setup.** Ubuntu's docker.io came without buildx and the Compose plugin, so the first pin attempt exited 2. docker-buildx and docker-compose-v2 2.40.3 were installed. Dry run part 2 hit a gap on its first run (no Compose plugin) and passed on its second, with no change to the kit or the run files.
3. **Empty jobs folder.** r61-harbor-job.sh appends to the jobs folder's launch.log (line 94) before `one` creates that folder (line 71), so the first batch launch exited at once and spent nothing. Creating the empty folder fixed it. The run file was not edited.
4. **rig.yml dispatch.** Main's push at 2b596ec6 touched no rig path, so no rig.yml run existed there and `rig admit` refused. rig.yml was dispatched at 2b596ec6 from a temporary branch (run 42343856227, green), every admit used that run, and the branch was deleted afterwards.
5. **Host adoption.** The host was created without a recovery bundle, so its ssh key existed only on its creator's machine. The creating thread added the run thread's public key. Nothing else on the host changed.
6. **Relaunch, the Captain's one named deviation.** The first batch ran without bun on PATH, so after session 1 the job file could not read the session, and an end watcher with no settled check settled the driver (lease 1, one session; its amount is in Agent notes). The Captain ruled that an operator error is not a cap or arm stop. A new driver ran sessions 2 to 4 with `--planned 3 --reruns 1`, so the check still totals 4 sessions and one rerun, on a second ap-r61 lease with slot-2 admits naming run r61. Session 1's reading stands. A guarded end script, keyed on the job file's "settled:" line, was tested on stand-in logs before the paid relaunch.
7. **Second hours lease.** The operator reused the first hours lease's cell task, so the reserve failed with E_RESERVE_CONFLICT after lease r61-vm.0002.9b6f09 opened, and the lease held the rest of the item's cap for a few minutes. A kit script (r61-hours-settle-open.ts) settled that open lease under its own meter id. The amounts are in Agent notes. No run file changed.
8. **Reading session 1 during the relaunch check.** Session 1's result was read from its job folder's read.txt, because batch2.log fills only at the batch's end.
9. **The pre-R48 opening.** At the Captain's request, this post's thread opened the sealed trial records once, on its own machine, for the exploratory check. The prereg names no such opening. It reads no outcome and changes no reading.
10. **Run files not attached.** Prereg section 7 says the run files are published as text with the results, and the run thread's handoff asked for them and the dry run part 2 kit as .txt files beside this post. Prereg section 7 cites them by sha256, and this post leaves their text in the project-user drive (Replicate it), because attaching scripts moves the post's review from the docs class to a code-class /ship. They can follow in a post of their own.

## Custody and teardown

- **T-G material.** It lived only in the run host's /dev/shm, opened before any provider key reached the host. At 07:54Z the run thread deleted that folder (4,338 files) and the plaintext R61 image manifest, and test ! -e passed for both.
- **The export.** The two trials' records and gate folders left the host age-encrypted, as one 5,633,560-byte part (sha256 ac948bbaa2900def6e8aa52a0c350053bbaa0579104e77639917cc4fb1686724) in the Captain's drive. Four git bundles over 5 MB were left out. No plaintext of these records left the host.
- **Sweeps at the run's end,** counted without opening and deleted unread: on the run host, /tmp held 3 files (2,192 bytes); on the operator machine, /tmp held 1 file and the tool-output folder 1. None remain on either.
- **The pre-R48 opening.** At 08:02:24Z this post's thread decrypted the export into /dev/shm on its own machine, extracted only the two SDK message records and printed counts only. It deleted the folder at 08:07:35Z (test ! -e passed) and swept /tmp, /var/tmp and its tool-output folder before and after. No model call ran from that opening.
- **Teardown.** The run host was destroyed at 07:55:11Z, and `list --mine` came back empty under both owner tags.
- The custody log beside the sealed bundle in the Captain's drive records every opening, deletion and sweep.

## Limits

- **Two sessions on one model.** Opus 5.5 only, as the prereg says: GPT-6.1 Sol is out of wave 1 on price, and particle-1 has no admission row.
- **The pin moved more than the gate.** ca5dbfc7's setup no longer registers G's skill-contract Stop hook or skill-route UserPromptSubmit hook, so this check can't separate the gate from those changes.
- **Exposure is the detector's reading,** and the exploratory check shows that reading undercounts loads when a session pipes the methodology command.
- **The pre-R48 check is post hoc.** One reader wrote it after the verdict, from counts. The counts show which files were read and when, not how well the reviews used them.
- **No outcome.** A pass would only have shown the procedure ran where the detector can see it.
- **The cost comparison with G is one trial per task.** It is a description, not an estimate of what the gate costs.
- **Outside terms,** as in prereg section 10: gstack is MIT; Harbor is Apache-2.0, run with its telemetry off; Claude Code is Anthropic's proprietary software, here driving Anthropic's own Opus 5.5 through Anthropic's API; the T-G repositories are MIT, Apache-2.0 or BSD, and none is named.

## Replicate it

A recount needs the sealed session records, which stay private. On the run host, from a checkout at the run commit with the run env file sourced, the run thread prepared the four task images with the job file's prepare step, started the stage driver for the relaunch, and ran the batch:

    outcome serve --run r61 --envelope-host <host id> --stage ap-r61=autoplan:told --host 172.17.0.1 --dir <run dir> --planned 3 --reruns 1
    R61_RUN_ENV=<run env> bash r61-harbor-job.sh batch

The batch runs one trial at a time and reads each with r61-read.ts, whose lines are read.txt. The five run files (r61-told-install.sh, r61-told.tar, r61-gates.compose.yaml, r61-harbor-job.sh and r61-read.ts) are cited by sha256 in prereg section 7 and kept, with the dry run part 2 kit, in the project-user drive. This record leaves out the scripts' text, the host setup commands (they are in the run record) and the paid sessions, which need the sealed T-G bundle, the ledger and an Anthropic key.

## What is held out, and why

T-G stays sealed: its tasks, statements and hidden tests. R61's image manifest stays sealed; its sealed copy's sha256 is 2ace6164ea4f5a6ec595bdb0befc301c929aa40f60d78c6bfc74293efc25a194. The session records stay sealed, because they quote task code. The two gate report files are not attached. The pregate's secrets scan reads their session-id lines as secrets, though a session id is a random identifier, not a credential. They stay with the rerun inputs, and read.txt and session-facts.txt carry their counts. An earlier commit in this post's pull request attached them, so they also sit in that branch's history. The rerun inputs sit in the Captain's drive under their manifest (84 files; MANIFEST.txt sha256 c62e1b19f318bb6aabb3eb7badaf3a262806a0d8f44235289560c9f9c73af229).

## Attribution

Harbor is Apache-2.0. gstack at the pin is MIT. Claude Code is Anthropic's proprietary software, here driving Anthropic's own Opus 5.5 through Anthropic's API. Each task repository keeps its own MIT, Apache-2.0 or BSD licence.

## Changelog

- 2026-11-07: first version.

<details>
<summary>Agent notes</summary>

Paid spend was $45.13 against $509 in caps.

The arm's limits from registry.json: $45, 400 turns, 4 hours, quiet 30 s, background wait 600 s.

| | Session 1 | Session 2 |
|---|---|---|
| How t2 ended | quiet; termination completed; no exception | quiet; termination completed; no exception |
| Persona in t2 | 1 question (recommended reply), 0 prose | 1 question (recommended reply), 0 prose |
| /autoplan loads in t2 | 1 | 1 |
| Model calls | 320, none refused | 168, none refused |
| Tool calls | 409 | 182 |
| Metered cost | $30.364065 | $13.524139 |
| G's ungated told session on the same task (trial 1, prereg section 6) | $28.05 | $5.52 |

**Cost**

**Paid** (the ledger, wave 1 envelope).

| Item | Charged to | Leases | Settled | Cap | Share of cap |
|---|---|---|---|---|---|
| ap-r61, model calls | autoplan | ap-r61.0001.6fd211 $30.364065; ap-r61.0002.5e8cfe $13.524139 | $43.888204 | $500 | 8.8% |
| r61-vm, run host hours | autoplan | r61-vm.0001.c7aae7 3.393 h $1.0179; r61-vm.0002.9b6f09 0.762 h $0.2286 | $1.246500 | $9 | 13.9% |
| **Paid** | | | **$45.134704** | **$509** | 8.9% |

Both model-call leases settled with unknown $0.00 (settle.txt). The host hours run from the host's creation at 03:58:16Z to the teardown margin: 4.155 hours of a standard-8 at the Captain's $0.30 reserve rate. After settling, wave 1 reads $1,434.041177 committed of $10,000 with nothing open, and autoplan's line on the ledger reads $867.078548 settled of $2,000.

**Prices.** Opus 5.5 in dollars per million tokens, from src/runner/pricing/prices.ts at the run commit, as the proxy used them on 2026-11-07: input 4, output 20, cache read 0.20, cache write 5. Per-session token totals are not in the export, so the dollar figures are the proxy's and the ledger's.

**Crew**, from the thread counters at the Captain's rate of $1 per 1,000 credits: the prereg thread (GEVA-375) $27.43 and 77.7M tokens; the run thread with its two operator subagents (GEVA-382) $23.98 and 63.3M tokens; this post's thread (GEVA-384) about $5 when the post was written, not final.

**autoplan's line, all-in.** The ledger's $867.08 holds autoplan's paid share, $474.68 from G (g-ap plus half of g-none, g-vm and g-tg) and $45.13 from R61, plus $347.26 of crew rows: half of the $694.53 recorded for 19 G threads on 2026-11-05. Read from the counters instead, G's 29 threads (those 19 and the 10 that followed, through G's results post) came to $906.79, and autoplan's half is $453.40. So autoplan's line stands at $519.82 paid plus $453.40 of G crew plus $51.41 of R61 crew, $1,024.62, plus this post's thread: about $1,030 of $2,000. gstack's own lane built the gate, and that work is not on this line.

An outcome retest still needs tasks with headroom, and prereg section 9 prices autoplan alone at about $2,810 or more for a 24 x 4 design at G's metered prices, more than the line has left (about $970).

**Relaunch, the Captain's one named deviation.** The first batch ran without bun on PATH, so after session 1 the job file could not read the session, and an end watcher with no settled check settled the driver (lease 1, $30.364065, one session).

**Second hours lease.** The operator reused the first hours lease's cell task, so the reserve failed with E_RESERVE_CONFLICT after lease r61-vm.0002.9b6f09 opened, and the lease held the item's remaining $7.98 for a few minutes. A kit script (r61-hours-settle-open.ts) settled that open lease at $0.2286 under its own meter id.

From the summary: Paid $45.13.

</details>

## Disclosures

gstack is Garry Tan's own project.
