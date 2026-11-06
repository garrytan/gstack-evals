---
id: 2026-11-06-geva-350-l1-overhaul-results
kind: finding
title: "L1: gstack's overhaul got untold Opus 5.5 to open /investigate in 21.3% of fresh SWE-rebench sessions (0% before), a KEEP that went away with routing and contracts off; told adherence and pass rate show no change we could verify"
summary: "L1 on Opus 5.5, 80 fresh SWE-rebench tasks: B1 +21.3 points [+12.5, +30.0] KEEP; B3 +10.0 [+0.0, +20.0] FIX-METHOD (probe audit failed); O5 +5.0, unpowered. $353.34 paid."
author: GEVA-350
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-06
status: open
links:
  - 2026-11-03-geva-254-l1-overhaul-prereg-2000
  - 2026-11-05-geva-294-l1-amendment-c
  - 2026-11-05-geva-302-l1-amendment-d
  - 2026-11-02-geva-214-gstack-overhaul-before-after-prereg
  - 2026-11-01-geva-125-untold-discovery-prereg
  - garrytan/gstack-evals#193
  - garrytan/gstack-evals#221
  - garrytan/gstack-evals#227
  - quick/laneb/l1
attachments:
  - 15725a2694d22159036963b895ff572b3387232bf5760513cb2ceb7e819fb03a  f1-report.md
  - 6bedf48dc8106e9305675ecff9b5c9d2d47bad5629386072d611aaa073581539  f1-tb2-report.md
  - 569aa0b6d5e0b394542c02647911b64353a18141bb9d5035496f65668f21987e  blind-rubric.md
---

# L1: gstack's overhaul before and after on Opus 5.5

## Status

Publication status: unpublished. This is the record of a preregistered run. Done: the pilot, F1 and the TB2 twin, the read audit, the blind probe audit, the analysis and this post. Still open before any public use: the claim check by a cross-family reviewer and a recount by another crew.

| Field | Value |
|---|---|
| Grade | Confirmatory on Opus 5.5 for B1 and B3, the preregistered behavior primaries. One model. O5 and every secondary line are descriptive. |
| Prereg | [2026-11-03-geva-254-l1-overhaul-prereg-2000](../../plans/2026-11-03-geva-254-l1-overhaul-prereg-2000/README.md) (#193), which supersedes [#169's prereg](../../plans/2026-11-02-geva-214-gstack-overhaul-before-after-prereg/README.md), with [Amendment C](../../plans/2026-11-05-geva-294-l1-amendment-c/README.md) (#221) and [Amendment D](../../plans/2026-11-05-geva-302-l1-amendment-d.md) (#227) |
| Build | 802c2e490dfddf7ef726e8bddc72a06441fefbee for every counted session and for the analysis (probes.ts 47d55b3e, table.ts b91f698a, analyze.ts efeb634a, audit.ts 528509b8, as Amendment C pins them) |
| Data | Run records in the gstack-evals Captain's drive (handoffs/GEVA-302/ and the l1-recovery backups). They hold model transcripts, so they stay private. This post publishes counts, digests and aggregate tables only. |
| Reviewed by | The /ship review of this post, recorded in its pull request |
| Reproduced by | Not yet. This thread rebuilt both session tables from the trial dirs with table.ts at 802c2e4 and got the run thread's tables byte for byte. |

## What we found

gstack's overhaul changed what Opus 5.5 does when nobody names a skill. On 80 fresh SWE-rebench bug-fix tasks, untold Opus opened /investigate in 17 of 80 sessions with the after pin and in 0 of 80 with the before pin: **B1 is +21.3 points (95% CI +12.5 to +30.0, Holm p 0.0001), a KEEP**. The prereg's KEEP wording names the after pin's untold parts, the route hook and the description rewrite, as a package; it is not a measured split. Probe L passed its blind audit (37 of 37, kappa 1.00), but one of the seven readers read only 3 of its 18 probe L packets in full and searched the rest for the calls probe L reads, so part of that audit is a mechanical recheck (Limits). All 17 opens came on the 19 tasks the route hook sends to /investigate (17 of 19). With routing and contracts switched off together at the same pin, keeping the rewritten descriptions, Opus opened it 0 times. So the gain needs routing or contracts on, the description rewrite alone produced no opens, and this run can't credit the route hook alone. With no gstack, 0 of 80.

Told adherence shows no change we could verify. A complete /investigate record, scored by probe I, appeared in 24 of 80 told sessions with the after pin and 16 of 80 with the before pin: **B3 is +10.0 points (95% CI +0.0 to +20.0, Holm p 0.1152), a null, FIX-METHOD (method)**, because probe I failed its blind audit. It is also unpowered: at the before arm's 20.0% the MDD is 20.3 points, past the 20-point margin.

Pass rate didn't move. Told after passed 70.0% of tasks and told before 65.0%: **O5 is +5.0 points (95% CI +0.0 to +11.3)**, against an MDD of 18.7 points, so it carries no verdict. Opus with no gstack passed 65.0%. The paid runs cost $353.34, and L1's all-in figure at the final ceiling read was $965.45 of its $2,000.

## How it works

This section is an explanation, not a result.

The after pin adds a UserPromptSubmit route hook that scores the prompt and, above 0.66, tells the model which of four skills to run. Amendment C routed every F prompt before any session: 19 to /investigate, 10 to /verify, 6 to /qa, 1 to /review and 44 to none. In after-u the proxy's reading has the hook firing in 36 of 80 sessions, exactly on the 36 routed prompts and on none of the 44 others. The transcript's reading has 40 of 80: the same 36 and 4 prompts the table routes to none (route cross-check, below). Opus followed the /investigate route in 17 of 19 and opened /investigate on none of the other 61 tasks. The rewritten skill descriptions with routing and contracts off (off-u, which keeps the descriptions and turns both off) produced no opens. Every open came on a prompt the hook routed to /investigate, which points to the hook's instruction being followed rather than the model choosing the skill from its listing. off-u can't separate the hook from the contracts, so that stays a pointer, not a result.

Told, the after pin's contract Stop hook wrote a contract record in all 80 after-t sessions and blocked a stop in 16. Probe I's four items, read from the table, show where records fall short. A DEBUG REPORT with all six labels after the last edit appeared in 79 of 80 after-t sessions, 74 of 80 off-t and 61 of 80 before-t. A check after the last edit ran in 63, 59 and 55. The item that binds is Fix naming an edited file: 28, 30 and 20. That is the item the blind audit found probe I misreads (below), so B3's rates rest mostly on the probe's weakest item. These item counts are report-only and decide nothing.

## Setup

- **Question.** Does gstack's overhaul (before pin 82db89ab3ea3c64185538b8af33da2ffd1a18b57, v1.93.22.0; after pin 699a41cb6808e01240d02e82247693f9170d401a, v1.94.39.0) make Opus 5.5 open /investigate untold (B1, after-u minus before-u) and finish its record when told (B3, after-t minus before-t)? Holm over the two at 0.05, claim margin 20 points each.
- **Arms.** none: no gstack, an empty skills folder, the plain prompt (tar 8bab4833). before-u and before-t: the before pin's lite install (tar e28da7d0). after-u and after-t: the after pin's lite install (tar 604cdb53). off-u and off-t: the after pin with skill_routing and skill_contracts off (tar a44be22f). Told arms prefix the prompt with "/investigate ". No arm carries a procedure line. Every arm sets CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 and setting_sources user and project.
- **Model.** claude-opus-5-5 on the Anthropic API, through Lane B's metering proxy, $5 allowance per SWE-rebench session and $2.50 per TB2 session, 100 turns.
- **Harness.** Lane B at 802c2e4 with Claude Code 2.1.312, the pinned Agent SDK and Harbor. Each part ran on its own Ubicloud standard-16 VM in eu-central-h1, under one awake host per item that held the ledger.
- **Tasks.** F1: 80 SWE-rebench tasks drawn with seed 20261103 from 145 no earlier run drew (f-tasks.txt, sha256 b14dd044e4dfba0b217bb267566753585fcffdc05b42dc93d95887d192d3f4ee), 65 repositories, 4 parts of 20 tasks, one session per task and arm: 560 sessions. Pilot: 10 tasks (pilot-tasks.txt) on before-u and before-t, plus 3 smoke tasks on after-u, after-t, off-u and off-t: 32 sessions, never scored. TB2 twin: 37 Terminal-Bench 2 tasks at 69671fbaac6d (tb2-tasks.txt, sha256 582ba69f50ff8eb121fb87d622f3e3bc6a39310910d29f8ea3afdaa6eb9e53eb), 5 arms, 2 replicates, 2 parts: 370 sessions, descriptive.
- **Scoring.** Probe L (#169 7.1): a Skill call that loads the arm's installed /investigate, or a read whose result holds the first 200 characters of its body. Probe I (#169 7.2, with fc#3 settled in the prereg): a DEBUG REPORT after the last edit with six labels, Fix naming a path:line in an edited file, a listed Status, and a check after the last edit. Pass: verifier reward 1.
- **Analysis.** analyze.ts at 802c2e4: per-task paired differences, cluster bootstrap by task (10,000 resamples) with a repository-clustered interval beside it, two-sided sign-flip p (100,000 draws), seed 20261102, MDDs read from the frozen power.txt.
- **TB2 fit stratum.** custom-memory-heap-crash, overfull-hbox, fix-code-vulnerability, fix-git and db-wal-recovery. #169 names a 5-task fit stratum (lines 62 and 194) and takes Run D's task list unchanged from #125 (line 94). #125 names the five (line 46). See Deviations.
- **Tables.** Each analysis table holds the pilot's 32 rows beside F1's 560 (and TB2's 370), because analyze reads the behavior admission from the pilot rows. The run thread's tables held F1 and TB2 rows only, so they printed no admission. The pilot rows here match the pilot's own table byte for byte, and every other line of the report is unchanged by them.

## Before any score: the read audit and the blind probe audit

Amendment C requires these before anyone reads a score. Both were recorded first.

**Read audit of the none arm.**

- Procedure (a), audit.ts xargs: F1, 80 none sessions and 1,378 tool calls; TB2, 74 none sessions and 350 calls. No call differs between the merged rule and the line-wide rule, so no line needed a person's read.
- Procedure (b), audit.ts contamination, against a corpus of 522,074 gstack lines from the before and after arm tars. The four arm tars were rebuilt keylessly at 802c2e4 and all eight tar and tar.gz digests match Amendment C's table. F1: 80 none sessions, the merged rule drops 0, stands 0, overturned 0, listed 0. TB2: 74 none sessions, the same zeros.
- audit.ts apply changed no row, and the table without listed sessions is identical to the table with them, so the report-only sensitivity line equals the main line.

**Task images with their own prompt hook (task-hooks.tsv).** F1: 1 yes, 0 unknown, 79 no. The yes is dagster-io__dagster-33605, whose work tree carries .claude/settings.json. The routing table sends it to none, no arm opened /investigate on it, and the proxy read its route hook as not fired in every arm. TB2: 0 yes, 0 unknown, 37 no.

**Route cross-check.** 10 of the 962 sessions that carry both readings disagree between the proxy's route_hook and the transcript's, all 10 in F1 (0 of 32 in the pilot, 0 of 370 in TB2). In all 10 the proxy read not fired and the transcript read fired: 6 after-t and 4 after-u. So the hook fired in 36 of 80 after-u sessions by the proxy's reading and 40 of 80 by the transcript's. In after-t it fired in 0 of 80 by the proxy's reading and 6 by the transcript's. The 4 after-u sessions are all on prompts the table routes to none, one of them dagster-io__dagster-33605 with its own prompt hook, and none is on the 19-task routed stratum, so B1's exposure (19 of 19) is the same under either reading. This post's hook counts use the proxy's reading (route_hook).

**Blind probe audit (#169 7.6 item 4).** analyze.ts audit-sample drew 77 F1 sessions: for probe L, 17 it passed and 20 it failed; for probe I, 20 and 20. Each session was rendered to a compact text packet with no arm, pin sha, version string, trial name or probe value, and with the Stop hook's feedback text masked. Seven Opus 5.5 reader agents labeled them yes or no against a rubric that restates the two probe rules (attached as blind-rubric.md). The labels went into the analysis config by script, without printing any session's probe value, before any score line was read.

| Probe | Sessions | Agree | Kappa | Bar | Result |
|---|---|---|---|---|---|
| L (load) | 37 | 37 | 1.00 | 0.7 | passed |
| I (complete record) | 40 | 33 | 0.65 | 0.7 | failed |

All 7 probe I disagreements were sessions the probe scored incomplete and the reader scored complete: 2 before-t, 3 after-t and 2 off-t. In all 7 the probe failed the Fix item, which asks that Fix name a path:line in a file the session edited, and in 2 it also failed the check item. Tracing the pinned probe's Fix item session by session gives three causes. In 5 the fixed file was written by an inline Python heredoc, which the probe's write list does not count as an edit (#169 7.6 attack 2 names that gap). In 1 the write list held an unexpanded shell brace list of four file names, so no Fix path matched. In 1 the Fix item's path:line sat on the line after the label, which the probe does not read when the label line already has text. None came from how Fix names a file: the pinned matcher already accepts a base name, a path suffix and a line range.

## Result

analyze's primary lines, as printed for F1 with the pilot (f1-report.md). The F1 plus TB2 report (f1-tb2-report.md) prints the same lines.

    **B1** admission: admitted (before 0/10, Wilson upper 27.8%, MDD@Holm2 +12.9). Verdict: **KEEP**, reading KEEP: KEEP for the route hook and the description rewrite. Holm p 0.0001; before rate 0.0% [0.0%, 0.0%]; MDD@Holm2 there +12.3; coverage ok; audit kappa passed; exposure 100.0% of 19
    **B3** admission: admitted (before 1/10, Wilson upper 40.4%, MDD@Holm2 +17.7). Verdict: **FIX-METHOD (method)**, reading NULL: the probe failed its audit. Holm p 0.1152; before rate 20.0% [11.3%, 28.7%]; MDD@Holm2 there +20.3; coverage ok; audit kappa failed; exposure 100.0% of 80
    Gate reading (probe I complete in F1 after-t, bar 50%): 24/80 = 30.0%, not met; probes.ts sha256 47d55b3ea29af9617e889132c8ea7ba3f83660aa0623f29414b7b05659af6a38. It is B3's exposure line.
    O5: +5.0 points [+0.0, +11.3], before-t 65.0%, power.txt MDD@0.05 there +18.7. Unpowered: no verdict.

**Primaries and O5, with the none arm.**

| Endpoint | after | before (control) | Difference, points | Task 95% CI | Repository 95% CI | MDD at the control rate | none arm | Verdict |
|---|---|---|---|---|---|---|---|---|
| B1, untold load | 17 of 80 (21.3%) | 0 of 80 (0.0%) | +21.3 | +12.5 to +30.0 | +12.9 to +30.1 | 12.3 (Holm2) | 0 of 80 loads | KEEP |
| B3, told complete record | 24 of 80 (30.0%) | 16 of 80 (20.0%) | +10.0 | +0.0 to +20.0 | -1.1 to +22.1 | 20.3 (Holm2), not powered | 0 of 80 complete records | FIX-METHOD (method) |
| O5, told pass rate | 56 of 80 (70.0%) | 52 of 80 (65.0%) | +5.0 | +0.0 to +11.3 | +0.0 to +11.3 | 18.7 (alpha 0.05) | 52 of 80 passed (65.0%) | none (descriptive) |

Every session of every arm was graded: infra 0, cap stops 0, contaminated none sessions 0, coverage ok on every endpoint. The none arm can't load a gstack skill by construction, and the read audit found none that did.

**Per arm, F1 (80 sessions each) and TB2 (74 each).** Counts from the analysis table.

| Arm | F1 pass | F1 untold load | F1 complete record | F1 route hook fired | F1 contract record | TB2 pass | TB2 untold load | TB2 complete record |
|---|---|---|---|---|---|---|---|---|
| none | 52 (65.0%) | 0 | 0 | 0 | 0 | 63 (85.1%) | 0 | 0 |
| before-u | 55 (68.8%) | 0 | 0 | 0 | 0 | 60 (81.1%) | 0 | 0 |
| after-u | 53 (66.3%) | 17 (21.3%) | 6 | 36 | 17 | 59 (79.7%) | 2 (2.7%) | 0 |
| off-u | 51 (63.7%) (51/80 = 63.75%) | 0 | 0 | 0 | 0 | not run | | |
| before-t | 52 (65.0%) | told | 16 (20.0%) | 0 | 0 | 64 (86.5%) | told | 0 |
| after-t | 56 (70.0%) | told | 24 (30.0%) | 0 | 80 | 63 (85.1%) | told | 0 |
| off-t | 53 (66.3%) | told | 23 (28.7%) (23/80 = 28.75%) | 0 | 0 | not run | | |

Probe L is read on untold sessions. A told session gets /investigate from its slash command, so B3 reads probe I instead.

**Secondary lines (descriptive, no verdict).** As printed, with the none arm in the S1 and S5 rows.

| Line | Arm A | Arm B | Difference, points | Task 95% CI |
|---|---|---|---|---|
| B1 routed stratum | after-u 89.5% (19) | before-u 0.0% (19) | +89.5 | +73.7 to +100.0 |
| S1 pass | after-t 70.0% | none 65.0% | +5.0 | +0.0 to +11.3 |
| S1 pass | after-u 66.3% | none 65.0% | +1.3 | -5.0 to +7.5 |
| S3 pass | after-u 66.3% | before-u 68.8% | -2.5 | -7.5 to +2.5 |
| S5 pass | before-t 65.0% | none 65.0% | +0.0 | -6.3 to +7.5 |
| S5 pass | before-u 68.8% | none 65.0% | +3.8 | -1.3 to +8.8 |
| S6 load | after-u 21.3% | off-u 0.0% | +21.3 | +12.5 to +30.0 |
| S6 complete | after-t 30.0% | off-t 28.7% (23/80 = 28.75%) | +1.3 | -10.0 to +12.5 |
| S6 pass | after-t 70.0% | off-t 66.3% | +3.8 | -1.3 to +8.8 |
| S6 pass | after-u 66.3% | off-u 63.7% (51/80 = 63.75%) | +2.5 | +0.0 to +6.3 |
| S12 TB2 B1 (tunable) | after-u 2.7% (74) | before-u 0.0% (74) | +2.7 | +0.0 to +8.1 |
| S12 TB2 B3 (tunable) | after-t 0.0% (74) | before-t 0.0% (74) | +0.0 | +0.0 to +0.0 |
| S12 TB2 fit B1 (tunable) | after-u 20.0% (10) | before-u 0.0% (10) | +20.0 | +0.0 to +60.0 |

- **S6, what B1 needs.** off-u keeps the after pin's rewritten descriptions and body and turns routing and contracts off together, and it opened /investigate 0 times. So B1's gain needs routing or contracts on. S6 can't credit the route hook alone, because it turns both off at once.
- **S7, other untold loads.** after-u opened /verify in 4 F1 sessions and 1 TB2 session, all on prompts the hook routed to /verify. No untold arm opened any other gstack skill, and no session opened a skill from a task repository.
- **S10, probe I against the contract's own check** (after-t, 80): both met 23, probe only 1, contract only 49, neither 7. The contract check called 72 of 80 met. The contract is never the score.
- **S11, hooks.** The route hook fired in 36 of 80 after-u sessions by the proxy's reading (40 of 80 by the transcript's) and in 19 of 19 on the routed stratum under either reading. The contract hook left a record in 80 of 80 after-t sessions and blocked a stop in 16. No hook reading was unrecorded.
- **S12, the tuning gap.** TB2 minus F1: B1 +2.7 against +21.3, a gap of -18.6 points; B3 +0.0 against +10.0, a gap of -10.0. The overhaul does no better on TB2, the set its router was tuned on, than on fresh tasks. The routing table sends 4 of 37 TB2 prompts to /investigate against 19 of 80 F prompts. On the 5-task fit stratum every arm passed 10 of 10, and after-u opened /investigate in 2 of 10.
- **S13, background work at the result.** F1: none 3, before-u 2, after-u 2, before-t 3, after-t 4, off-u 4, off-t 4 of 80. TB2: none 1, before-u 1, after-u 1, before-t 0, after-t 0 of 74. Pilot and smoke 0. No arm is near the 10% rule.
- **Gate reading.** Probe I complete in F1 after-t: 24 of 80 (30.0%) against #169's 50% bar. It binds no item in this plan; it binds any held-out L1 item a later plan adds. It rests on probe I, which failed its audit in the direction of counting too few records.

## Why null? (R48)

B1 is a KEEP and needs no cycle. Every null below gets one, and none ends in CUT-CANDIDATE.

**B3, told adherence (null, +10.0 points, 95% CI +0.0 to +20.0).**

- **Harness and coverage.** Every session graded, no cap stop, background work in at most 4 of 80 per arm. This step passes.
- **Method.** Probe I failed its blind audit (kappa 0.65, 33 of 40), and every disagreement was a record the probe missed. This is the first step that fails, so the frozen verdict is FIX-METHOD (method).
- **Exposure.** Install exposure held: the contract hook recorded in 80 of 80 after-t sessions, against the 80% bar. Procedure exposure is the gate reading, 24 of 80 (30.0%) complete records, under the 50% bar. The DEBUG REPORT itself appeared in 79 of 80 after-t sessions, so the model wrote the report and the record fell short mostly on Fix, the item the probe misreads.
- **Power and saturation.** The before arm's 20.0% puts the MDD@Holm2 at 20.3 points, past the 20-point margin, so even with a passing audit B3 would carry no verdict and read FIX-METHOD (saturation). It isn't a ceiling: 100 minus the before arm's upper bound (28.7%) is 71.3 points, more than twice the MDD. Under R61 a null that rests on power or saturation is FIX-METHOD once, not a cut.
- **Task fit.** F's tasks are bug fixes, where /investigate's record fits, and before-t's 20% leaves room. On TB2 no told session in either pin wrote a complete record (0 of 74 each), so TB2 doesn't fit B3.
- **Without the skill.** No none session wrote a complete record (0 of 80), and none passed 65.0% of tasks against after-t's 70.0%. Opus doesn't write this record unprompted, and the record doesn't measurably change whether the bug gets fixed.
- **Verdict: FIX-METHOD (method).** The fix is in the probe. The write list should count a file written by an inline script and expand a shell brace list, and the Fix item should read the lines after its label; a fixed probe needs a fresh blind audit. A rerun that could carry a verdict also needs more than 80 x 1 at a 20% control rate.

**O5, told pass rate (descriptive null, +5.0 points, 95% CI +0.0 to +11.3).** The prereg gives O5 no verdict. R48's cycle, for steering:

- **Exposure.** Told after sessions had the contract hook in 80 of 80 and a complete record in 24 of 80.
- **Task fit.** none passes 65.0%, so F has room above the control.
- **Power.** The MDD is 18.7 points at a 65% control. The prereg's own figures: 80 x 3 brings it to 10.6 to 11.7, and all 145 eligible tasks x 3 to 7.9 to 8.7, still above the +5.0 seen here.
- **Without the skill.** Opus with no gstack passes 65.0% (52 of 80). after-t minus none is +5.0 (S1), after-u minus none +1.3.
- **R48 label: FIX-METHOD (power).** No powered reading exists, so nothing here supports a cut.

**Secondary nulls and negatives.** Each is descriptive and unpowered at 80 x 1 or 37 x 2.

| Line | Reading | Why null | R48 label |
|---|---|---|---|
| S1 after-u minus none, pass | +1.3 | Power: MDD near 19 points at a 65% control | FIX-METHOD (power) |
| S3 after-u minus before-u, pass | -2.5 (CI -7.5 to +2.5) | Power, as above. The negative point estimate is inside the interval of no change. | FIX-METHOD (power) |
| S5 before-t and before-u minus none, pass | +0.0 and +3.8 | Power, as above | FIX-METHOD (power) |
| S6 after-t minus off-t, complete | +1.3 | Method (probe I failed its audit) and power | FIX-METHOD (method) |
| S6 after-t minus off-t and after-u minus off-u, pass | +3.8 and +2.5 | Power, as above | FIX-METHOD (power) |
| S12 TB2 B1 (tunable) | +2.7 | Task fit: the router sends 4 of 37 TB2 prompts to /investigate | FIX-METHOD (task fit) |
| S12 TB2 B3 (tunable) | +0.0, both 0 of 74 | Floor and task fit: no told TB2 session wrote a complete record in either pin; also method | FIX-METHOD (task fit) |
| S12 TB2 fit stratum B1 (tunable) | +20.0 on 10 sessions | Power: 5 tasks x 2; every arm passed 10 of 10, a ceiling for pass rate | FIX-METHOD (power) |

## Deviations

None changes a primary, a cap, an arm, a draw or a scoring rule.

1. **The prepare-run.ts pin.** Amendment C pins quick/laneb/runner/prepare-run.ts at 08b2487be88d941c8db67f13d69736dc87c2b6d66cf7fa16f07b4ed3ff9f44da. At 802c2e4 it is c69d149f2ab57345d0cbf2eae3da8c995741969eb6d227df245374a571011448, because #226 (239d227) changed it. The run thread ran l1.ts prepare at 38aaa9e and at 802c2e4 on scratch ledgers: the manifests and plans differ only in created_at, git_head and run_id, and build_prompt is byte-identical over 24 told, plain and procedure-line cases. The Captain ruled it disclosed, not stopping. The next pins-only amendment re-pins the file. Every other file in Amendment C's source table matches at 802c2e4, except l1.ts and ceiling.ts, which match Amendment D's table.
2. **The mid-item launch rule.** ceiling.ts refuses a launch while the item holds an open reserve, and the awake host's reserve spans every part of an item by design. So the operator launched a later part only when the host's reserve was the sole open one; anything else stopped with exit 4 and launched nothing. f1-2, f1-3, f1-4 and tb2-2 launched under this rule, and the first launch of each item passed the check cleanly. The Captain accepted it for F1 and TB2 as an operator rule.
3. **Approval rows that name 38aaa9e.** The f1-opus and tb2-opus ledgers' approval rows name build 38aaa9e, because they were written before Amendment D merged. The pilot-opus-d row names 802c2e4. The voided pilot-opus row also names 38aaa9e, and that run did use it. Every counted session ran on 802c2e4 under the Captain's ruling that the build doesn't change mid-run. The rows stay unedited, since a ledger is never edited. An earlier ruling text named the tb2-opus and pilot-opus-d rows; the ledgers show f1-opus and tb2-opus.
4. **Sessions over $2.50.** Two f1-3 sessions, both on vyperlang__vyper-4801, settled at $2.699593 and $2.974401 against a $5.00 reserve. The $2.50 stop rule was stated for pilot sessions only, so nothing stopped and nothing was retried. The pilot's costliest session was $0.805733 and TB2's $1.329216. No settle in any ledger is over its reserve.
5. **The TB2 fit stratum's names came by reference.** #169 states the 5-task stratum but names no task. Its Run D row (line 94) takes Run D's task list unchanged from #125, and #125 line 46 names the five. The Captain took them from there before any TB2 score was read.
6. **This post comes before the Sol leg.** Section 9 runs Sol under the leftover rule once every planned item has settled. This post reports the Opus legs before Sol runs, which reorders the prereg's sequence. Sol reports in its own post, and no number here depends on it. So the Cost section's final ceiling read is final for the Opus legs only; Sol's spend comes after it.

## Cost

Every item settled in full with no reserve open, read from the ledgers.

| Item | Cap | Sessions | VM | Awake host | Settled |
|---|---|---|---|---|---|
| pilot-opus (pilot-opus-d.jsonl) | $80 | 32, $13.264959 (max $0.805733) | 0.57 h, $0.342500 | $0.074000 | $13.681459 |
| f1-opus | $680 | 560, $261.802681 (max $2.974401) | 4 VMs, $6.896834 | 12.403889 h, $0.992311 | $269.691826 |
| tb2-opus | $180 | 370, $67.558087 (max $1.329216) | 2 VMs, $2.053333 | 3.593611 h, $0.287489 | $69.898909 |
| voided pilot-opus run 92231acce642809f | none | 0 | $0 | $0.069089 | $0.069089 |
| **Paid total** | | | | | **$353.341283** |

F1 per part (sessions and VM): f1-1 $62.225032 and $1.392334; f1-2 $71.725255 and $2.065000; f1-3 $75.657912 and $2.377667; f1-4 $52.194482 and $1.061833. TB2: tb2-1 $34.980681 and $1.096333; tb2-2 $32.577406 and $0.957000.

**Final ceiling read**, after TB2, every ledger passed once and the voided ledger by --void-ledger: FINAL all-in $965.45, holds $107.98, room $926.57. All-in counts the paid items, the voided run and the L1 crew's model use through that read. This post's own model use is counted against the room.

**Per arm, from the ledger settles.** Tokens as input; output; cache write; cache read.

| Cell | Sessions | Spend | Per session | Per pass | Tokens | Ratio to none per pass |
|---|---|---|---|---|---|---|
| F1 none | 80 | $31.406073 | $0.393 | $0.604 | 2,746; 514,546; 2,297,080; 48,091,169 | 1.00 |
| F1 before-u | 80 | $33.725685 | $0.422 | $0.613 | 2,808; 510,511; 2,571,814; 53,223,006 | 1.02 |
| F1 after-u | 80 | $35.579748 | $0.445 | $0.671 | 3,016; 556,558; 2,438,082; 61,227,492 | 1.11 |
| F1 off-u | 80 | $31.975728 | $0.400 | $0.627 | 2,864; 518,187; 2,195,057; 53,123,437 | 1.04 |
| F1 before-t | 80 | $45.618088 | $0.570 | $0.877 | 3,184; 652,751; 3,552,417; 73,938,063 | 1.45 |
| F1 after-t | 80 | $42.918499 | $0.536 | $0.766 | 3,244; 632,980; 3,108,672; 73,509,668 | 1.27 |
| F1 off-t | 80 | $40.578860 | $0.507 | $0.766 | 3,208; 663,747; 2,509,987; 73,702,641 | 1.27 |
| TB2 none | 74 | $10.253410 | $0.139 | $0.163 | 854; 234,485; 668,222; 11,095,010 | 1.00 |
| TB2 before-u | 74 | $11.628861 | $0.157 | $0.194 | 876; 245,706; 825,123; 12,927,160 | 1.19 |
| TB2 after-u | 74 | $11.455310 | $0.155 | $0.194 | 886; 249,637; 779,099; 12,816,658 | 1.19 |
| TB2 before-t | 74 | $16.378747 | $0.221 | $0.256 | 996; 304,285; 1,372,652; 17,127,826 | 1.57 |
| TB2 after-t | 74 | $17.841759 | $0.241 | $0.283 | 1,152; 345,406; 1,392,004; 19,843,748 | 1.74 |

after-t's cost per pass on F1 is 1.27 times none's, the ratio #169's G3 named (descriptive here).

**Prices.** The build's quick/laneb/config/proxy.json, in dollars per million tokens, as used on 2026-11-05 and 2026-11-06. Opus 5.5: input 4, output 20, cache write 5 (5-minute) or 8 (1-hour), cache read 0.20. Every cache write here was a 5-minute write. VMs: the ledgers reserve and settle part VMs at $0.60 an hour. Ubicloud's published rate for the part VM's shape (standard-16, 640 GiB, one IPv4, hetzner-fsn1, config/billing_rates/vm_metal.yml at ubicloud 08f8108c, active from 2026-09-01) is 16 x $0.0004804689 x 60 + 640 x $0.0000019531 x 60 + $0.000074405 x 60 = $0.5407 an hour, so every VM figure above is the reserve rate, not the bill. Awake hosts at $0.08 an hour.

## GPT-6.1 Sol and particle-1

Not run as of this post. The Captain has decided that Sol runs next under section 9's leftover rule, each launch behind a passing ceiling check, and reports in its own post. particle-1 is not run under the ceiling. At F1's design its behavior MDDs are the same as Opus's rows: 12.3 to 15.0 points at a 1% to 5% before rate.

## Limits and threats

- **One model.** Every verdict is Opus 5.5's. R54 names Sol and particle-1 as models under test, and neither ran.
- **A fresh public draw, not a sealed set.** F's 80 tasks were public before the after pin froze. The defense is the prereg's search: the after pin's tree and its commit range hold no reference to the pool. The verdicts bind these two pins only. Opus may have seen these repositories in training, which applies to every arm alike.
- **Probe I failed its audit.** B3, the gate reading and S6's complete line all rest on it, and it misses records. Its misses fell in all three told arms, so the direction of any bias in B3 is unknown.
- **The blind audit's limits.** The packets hid labels, not everything: the after pin's skill body reads differently from the before pin's, and the model's own words sometimes name the route. Seven readers labeled the sample: four started together, two stopped at a shared token stop with 9 packets left, and three fresh readers labeled those. One reader read 3 of its 18 probe L packets in full and most of a fourth, and searched the rest for Skill calls, SKILL.md reads and the skill's base-directory line, which are the calls probe L reads. The packet renderer's sha256 is d7006af481547215b0d9ad9d7c2aa24d393497d149277e6ec76f23f6be478083; the packets themselves hold transcripts and stay private.
- **Route hook trust.** A true route_hook proves the route line reached the proxy as hook context in the first request. It can't tell the route hook from a task's own prompt hook; one F1 task carries one. On that task, dagster-io__dagster-33605, the proxy read its route hook as not fired in every arm; the transcript read it as fired in after-u.
- **Ceilings on TB2.** none passes 85.1% of TB2 sessions, and every arm passed all 10 fit-stratum sessions. TB2's pass rates can't show a gain.
- **Pass rate is unpowered by design.** O5 and every pass-rate secondary have MDDs near 19 points.

## Replicate it

Reanalysis is keyless, from a checkout at 802c2e4 with bun install, given the trial dirs (not public: they hold transcripts). The run's own commands, as this post ran them:

    bun quick/laneb/l1/table.ts <table-config with the pilot, F1 and TB2 jobs> sessions.jsonl
    bun quick/laneb/l1/audit.ts xargs <none job dirs>
    bun quick/laneb/l1/audit.ts contamination <rebuilt arms dir> <job dirs>
    bun quick/laneb/l1/audit.ts apply contamination.tsv sessions.jsonl applied.jsonl applied-without-listed.jsonl
    bun quick/laneb/l1/analyze.ts audit-sample applied.jsonl claude-opus-5-5
    bun quick/laneb/l1/analyze.ts report applied.jsonl analysis-config.json report.json

The arms dir comes from quick/laneb/arms/build.sh l1 (keyless, needs Docker and network). The record leaves out the paid launches, which need the ledger, Ubicloud and an Anthropic key, and the blind readers' sessions.

## What is held out, and why

Nothing is sealed. F, the pilot and TB2 are public tasks, listed in the prereg and Amendment C. The trial dirs and ledgers stay in the Captain's drive because they hold transcripts. Their digests: tb2-final.tgz 118b398c4d8ac638602a16da58b386543239f7857c3bfd3828a94fa74b98e4d8, work-l1.tgz d78b62bdb604ebe6b80db80249db07b58b82468e70c61328770bfee9ba425b91, f1-opus-work.tgz f9feb3b082f2d181ffa381cc44aaf73cb8bec45befd74163cbfd0b4bf4532143, pilot-opus-d-work.tgz e520dae6f1c39cdd3d1d8188a1a4c7b01bf827ab0a6ee9d691a3968746e8130a. Final ledgers: pilot-opus-d 43bc1a54bf2ea7864090a31b455bd0626c2b460252b73e30240886222304123f, f1-opus 956506c3c728713a1d74cb6b19a8d211014a5a094bf527d83c9dd58799f36069, tb2-opus a063b137c9742c7c144d4aabee90055c246f48f44461516324b771c1a191aa25, voided pilot-opus f435f32aab27145118b2d3562f93a0b09c0f145ae09c12d7850eeafd4c756692. Analysis inputs: the F1 table with the pilot 39548a85fa25232cdf35414894e1b7098ecfcbac3152c4f834ac78720837cb2c, the F1 plus TB2 table with the pilot 53e4805b394a36f3cc7acbd26b856f2955928175aaa117475dfb84a07e35e461, the audit labels 5ebb08bd82ba984717e319569fd627ab11cdefa93f1aa3ad2bdff1a07f7f1bad.

## Attribution

SWE-rebench is the work of Nebius AI R&D, used under CC-BY-4.0; Lane B runs its tasks in their published images with a separate verifier, and each task repository keeps its own open-source licence. Terminal-Bench 2 and Harbor are Apache-2.0. gstack at both pins is MIT.

## Changelog

- 2026-11-06: first version.

## Disclosures

gstack is Garry Tan's own project.
