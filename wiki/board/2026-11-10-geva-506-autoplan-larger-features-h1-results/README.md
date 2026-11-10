---
id: 2026-11-10-geva-506-autoplan-larger-features-h1-results
kind: finding
title: "Autoplan harder-task headroom check: plain Opus 5.5 solved 0.786 of larger Go features over 39 tasks, at least 0.722 however 10 flagged trials score, so there is no headroom; the frozen reading is RIG, because the audit flagged task repositories that name agent skill folders"
summary: "H1: plain Opus 5.5 on 42 larger Go features x 3. s 0.786 over 39 tasks, at least 0.722 with 10 flagged trials. Frozen reading RIG (FIX-METHOD). Told smoke: 14.4x cost, 1 of 2 exposed."
author: GEVA-506
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-10
status: done
links:
  - 2026-11-08-geva-397-autoplan-larger-features-prereg
  - 2026-11-08-geva-396-autoplan-report-order-recheck-results
  - 2026-11-06-geva-364-g-admission-results
  - 2026-11-09-geva-412-plan-mode-intentions
  - lanes/real-outcome/score/exposure.ts
  - lanes/outcome-skills/arms/h-registry.json
  - src/runner/proxy/metering-proxy.ts
attachments:
  - 34949a2aa152fca67ba1eaca250f4c6e3633b8354bc73b6c50e21aa2660ba658  base-skill-folders.txt
  - 38ae0f723c7ffe8d0f5e86b64db36068d03688720fc62818faa2dee162712115  containment.json
  - 4192452092bcf09f7df0c45d21199e11132bc3c38a406d5b9c585b44cb282a75  contamination-flags-by-trial.tsv
  - f34118b6f346d7bd6016ed2747fc6377dce8f913c57ac75b56d9c36f9023b3bb  contamination-flags.tsv
  - 8c25e5076cf667857bcf9bb5f462f51805b83fdbe86e34da9ae225f31afd585f  flag-checks.txt
  - 373ae903f720944fad29ecc0d9408fc183a5b24c2a8398f77e00b73aaf0f979c  read.txt
  - 288049de5f0b20b3cae5cd5adc8780441d70a511f4aef7b16d23f2d173578d88  settle.txt
  - 40caf0d42e99027bca5ec9d2bbbc67774179189649da544ad7830a4b9672b49a  trials.tsv
---

# Autoplan on larger Go features: the headroom check (H1)

- We learned that plain Opus 5.5 already solves most larger Go features with no planning skill. On 42 features merged on or after 2026-10-01, each 200 to 1,000 changed lines over 3 or more source files, its solve rate averaged 0.786 per task over the 39 tasks the frozen rule could read, and at least 0.722 over all 42 however the 10 flagged trials come out. Both sit above 0.65, the line that would leave room for autoplan to show a gain. You should not expect a planning skill to raise Opus 5.5's solve rate on features this size, and should test what else a plan is meant to change.
- We learned that a clean-room audit that flags any agent skill folder path trips on repositories that work with agent tooling. The frozen rule read RIG because 10 no-gstack trials on 4 tasks named .claude/skills, .agents/skills, .codex/skills or .claude/plugins paths inside the task's own repository, and none named a home, drive or gstack path. You should scope such a rule to the agent's home and install paths, and scan task repositories for these folder names when tasks are accepted.
- We learned that, in the two told sessions we priced, a session told to run autoplan cost 14.4 times a plain session on these tasks, and 1 of the 2 ran autoplan's procedure where our detector can see it. That is a two-session observation, not an estimate.

## Status

Publication status: unpublished. This is the record of a preregistered headroom check. It measures plain Opus 5.5 and reads no effect of autoplan.

| Field | Value |
|---|---|
| Grade | Headroom check, preregistered. One model (Opus 5.5), the no-gstack arm only, 126 of 126 planned sessions, plus 2 told smoke sessions that price told sessions on these tasks. The frozen reading is RIG. The lower bound on the solve rate is descriptive. |
| Prereg | [Autoplan on larger Go features](../../plans/2026-11-08-geva-397-autoplan-larger-features-prereg/README.md), merged as 2cf03e3eb3f21c804e3037f642338faac357966f |
| Run commit | 34d2510e29ca9018ef825bd68282b8c302034360 on this branch: H's own arms file and an outcome serve --registry option, with their tests. rig.yml run 42698351357 passed there. |
| Audit and detector | The no-gstack read audit and the told detector in lanes/real-outcome/score/exposure.ts and lanes/outcome-skills/arms/exposure.ts at the run commit (the second has sha256 f0882eaf2d5fe19ef682ec0f0c88e9a1239870a04544cf6adbf6d34e4e167694, as E2 and E3) |
| Data | Lines the run's reader and the run thread's count-only scripts printed on the run host. read.txt is a byte-identical copy of the reader's output. The session records stay private and were not kept (Deviations, item 8). |
| Reviewed by | The /ship review of this post, recorded in its pull request |
| Reproduced by | Not yet |

## What works

**Plain Opus 5.5 builds most of these features.** Over the 39 tasks with a valid trial, 26 were solved in 3 of 3 trials, 4 in 2 of 3 and 3 in 1 of 3, and 5 were never solved. One more task was solved in 2 of its 2 valid trials. Across the 116 trials the audit didn't flag, 91 passed every hidden test (0.784). No trial stopped on its budget, its turn limit or its wall limit.

**The run itself held.** All 126 no-gstack sessions opened, ran and closed as agent_finished, every job exited 0, and the run had no gaps, no tripwires, no refusal-count mismatches and no reruns. All 92 refusals were the same harmless route refusal, which every session outlived. Spend stayed well inside each cap (Agent notes).

**Containment held as far as the counts can show.** Neither arm's journal held a provider key line, and no transcript held a server-side tool block, a WebSearch or WebFetch call, or an MCP tool call. Every model call went to claude-opus-5-5. The one route the proxy checks less closely is under Limits.

**Told autoplan ran as it did in E3.** Both told sessions completed. In each, gstack's gate blocked 3 times, once per phase (CEO, DX, Eng), refused 5 publishes that came before their phase reports, and released the run with no errors and no ceiling.

## What didn't work

**The frozen reading is RIG, FIX-METHOD (rig).** The audit flagged 10 no-gstack trials as contaminated, and the rule reads RIG when more than 2 are. Three tasks lost all 3 trials, so n is 39, under the rule's 40. The flags are false positives on the evidence below (The 10 flagged trials), but the rule is frozen, so the reading stands.

**Only 1 of 2 told sessions read exposed.** In the other, the detector credited no review skill load. Two sessions say little about exposure either way.

## How it works

This is our explanation, not a measured result.

The no-gstack arm runs on a clean host with no gstack and no drive mounted. After the run, a read audit checks every no-gstack transcript for signs that gstack reached the session anyway. Part of it is a path rule that matches .claude/skills, .claude/plugins, .agents/skills, .codex/skills, gstack's install path or a home .gstack folder anywhere in a tool call or a tool result.

Four of H's repositories work with agent tooling, and their own files name those folders. Before any agent turn, each task's image already held files naming .claude/skills, .agents/skills or .codex/skills under its work tree: 144, 33, 16 and 4 files, and one of the four ships an .agents/skills folder of 22 files. When a session greps or edits such a repository, the path rule fires on the repository's own text. So the audit trips on the task, whatever the arm does.

H's image check before the run found 4 other tasks whose work trees held a .claude/skills folder, and 4 spares replaced them before any session (Deviations, item 1). The four tasks here passed that check: it didn't refuse files that name the folders, or thac0edfecd9's .agents/skills folder.

## Result

**The reading (frozen rule): RIG, FIX-METHOD (rig).** read.txt opens "H1 READING: RIG (R48: FIX-METHOD (rig))".

| Line | Value |
|---|---|
| Tasks with a valid trial (n) | 39 |
| s, the mean of the task scores | 92/117 = 0.7863 |
| UB = s + t x sd / sqrt(n) | 0.9039 (t 2.024394 for 38 degrees of freedom, computed, because the prereg froze t only for 40 to 42) |
| Trials read | 126: solved 91, unsolved 25, budget stops 0, gaps 0, tripwire 0, contaminated 10 |
| Reruns | 0 of 6 |
| Rule that decided | RIG: contaminated plus tripped is 10, more than 2, and n is under 40 |

The prereg reads RIG before CEILING, so s and UB decide nothing here. If the rule had reached CEILING, s above 0.65 and UB at or above 0.80 would each have met it.

**The bound** (descriptive, not a reading). Every task has 3 trials, so if all 10 flagged trials were scored unsolved, s over all 42 tasks would be 91/126 = 0.722. That is the lowest s can be, however the 10 come out, and it is still above the 0.65 CEILING line. So a fixed audit would not have shown headroom on these tasks. Without the 10, s is 0.786 over 39 tasks.

**Per-task histogram** (tasks with 3 valid trials): 0 of 3: 5, 1 of 3: 3, 2 of 3: 4, 3 of 3: 26. One task had 2 valid trials and solved both.

**Refusals, budget stops and gaps.** All 92 refusals were E_ALLOWANCE on the route GET /anthropic/models, which the proxy doesn't allow. Every session outlived them, so each scored on its tree. Budget stops: none. Gaps: none.

**Cost, wall time and turns** (report-only). The cost lines are in Agent notes. The median no-gstack session cost 1.55 times G's no-gstack mean, the difficulty ladder's budget anchor, printed and not applied because H is not a ladder tier. Wall time per session: mean 566.7 s, median 447.0 s, max 3,748.3 s. Turns: mean 41.9, median 35, max 91. Tokens over the 126 sessions: input 10,274, output 3,656,374, cache read 465,000,824, cache write 14,161,960.

**G_B** (report-only): the 6 tagged tasks with a valid trial averaged 0.9667.

**Told smoke** (report-only; two sessions price C1 and are not an exposure check).

| | th117fd136bb t1 | th5c1d188c05 t1 |
|---|---|---|
| Termination | completed | completed |
| Solved | yes | no |
| Turns | 171 | 260 |
| Wall time | 2,752.3 s | 4,605.3 s |
| Exposed (E3's rules) | no: review_skills_loaded false | yes |
| config, scope, findings_in_order | true, true, true | true, true, true |
| Phases applicable and published | ceo, dx, eng; ceo, dx, eng | ceo, dx, eng; ceo, dx, eng |
| Gate: blocked, released, publishes refused, errors | 3 (ceo, dx, eng), 1, 5, 0 | 3 (ceo, dx, eng), 1, 5, 0 |
| Refused calls at the proxy | 0 | 0 |
| Tokens: output, cache read, cache write | 240,675; 50,909,347; 830,481 | 284,329; 102,194,550; 1,774,179 |

1 of 2 read exposed, so the prereg's stop for neither exposed did not fire. The told-to-plain cost ratio m is 14.3951: the two told sessions' mean over the 126 no-gstack sessions' mean. That is two sessions, an observation and not an estimate. At that ratio C1 could not have reached KEEP, which needs told's solve rate to be at least m x s / 1.5 = 7.55, above 1. C1's re-projected caps are in Agent notes.

## The 10 flagged trials

The 10 are th22febd06e1 t1 to t3, th2ff942c332 t1 to t3, thac0edfecd9 t1 to t3 and thafc1efccdd t2. Each was flagged by the path rule alone.

**What the claim rests on.** The claim that these flags are false positives rests on the counts-only flag table and checks the run thread printed on the run host before teardown: contamination-flags.tsv, contamination-flags-by-trial.tsv, flag-checks.txt and base-skill-folders.txt. The transcripts behind them were deleted at teardown without the encrypted export the prereg requires (Deviations, item 8). Nobody, us included, can recheck them now. Readers can check the counts in these files, not the transcripts.

- **Which patterns matched.** 29 rows over the 10 trials, matching .claude/skills, .agents/skills, .codex/skills and .claude/plugins. Every path is repo-relative, a bare folder name, /testbed (the task's work tree), or a tilde path in text (below). By where they matched: Bash calls in 4 trials, Edit calls in 2, a Read call in 1, and tool results in 7.
- **None names a home, drive or gstack path.** The table counts 0 Capy drive paths, 0 gstack install paths and 0 gstack skills listed or loaded.
- **The 9 tilde-path hits are text, not an opened home folder.** In th22febd06e1 t1, 19 of the 20 tool results and all 3 calls with a tilde token carry a token that also appears in the task's own files, and in t2 and t3 every one does. t1's 2 python3 calls that name a tilde path write a file with a string replace, with no home expansion and no directory listing. The two results whose token isn't in the task folder came from a cat of a relative file piped to grep (th22febd06e1 t1) and a grep pipeline run in /testbed (thafc1efccdd t2). No call opened a home folder.
- **The repositories name these folders at base.** Counted on each task's pinned image with no network, before any agent turn: files under the work tree naming .claude/skills, .agents/skills or .codex/skills, 144 (th22febd06e1), 33 (th2ff942c332), 16 (thac0edfecd9) and 4 (thafc1efccdd). thac0edfecd9 also ships an .agents/skills folder of 22 files.
- **Flags without a gstack read.** Every no-gstack session also listed two skills that aren't gstack's (doctor and plugin-authoring) at start. The audit counts gstack skills only, so these are descriptive.

## R48 reading

**FIX-METHOD (rig), from the frozen rule.** The attempt failed on the harness, which is not a cut.

- *The fix.* Scope the audit's path rule to the agent's own home and install paths (a tilde, $HOME, /root or /home/<user> prefix, and gstack's install path), not every place the folder names appear, and run the clean-room scan for these folder names on each candidate image when tasks are accepted. We name the fix here and apply it only in a later experiment. H1's own trials can't be re-read under it (Deviations, item 8).
- *Headroom.* The crew's rule allows one honest attempt to raise the ceiling before a saturated null can become a cut question (R61). This was that attempt, on harder Go features, and the ceiling didn't move: on G's tasks plain Opus 5.5 solved 22 of 22 valid trials, and on H it solved at least 0.722 however the 10 come out, and 0.786 over 39 tasks without them.
- *Exposure.* The no-gstack arm has nothing to expose. 1 of 2 told smoke sessions read exposed.
- *Task fit and the frontier.* Opus 5.5 builds most of these features without help, so solve rate on tasks like these can't show what autoplan adds.
- *Power.* n is 39. UB is 0.904.
- *No cut question.* No CUT-CANDIDATE and no funding ask for C1. The reading isn't HEADROOM, and the plan-mode rule bars a cut while any of autoplan's main intentions is untested. This test covered none of them as an outcome: H1 ran plain Opus 5.5 only. Had C1 run, it would have scored build correctness, part of AP-ENG-1, the engineering phase's review of the final plan. These stay untested as outcomes: AP-X-1 (every review in one pass, with the owner speaking once; E3 covers it for process only), AP-X-2 (auto-decisions never skip analysis), AP-X-3 (two reviewers from different model families per phase), AP-CEO-1, AP-DES-1, AP-DX-1, AP-ENG-1 beyond build correctness, AP-GATE-1 (the owner decides taste calls and challenges to their direction) and AP-GATE-2 (accepted changes land in the built plan). The [intentions map](../../research/2026-11-09-geva-412-plan-mode-intentions/README.md) lists them.

## What comes next

The harder-task track for autoplan's build correctness on Opus 5.5 is spent: one raise, no headroom. The next tests of autoplan should score the intentions above that don't rest on solve rate. Any later run that keeps a no-gstack read audit should carry the scoped path rule and the image scan from the start.

## Limits

- **One model.** Every reading is Opus 5.5's. The told arm runs in Claude Code, which can't run GPT-6.1 Sol, and particle-1 has no admission row.
- **Two smoke sessions.** They price told sessions and say little about exposure.
- **No trial can be re-read.** The trial records were deleted without the encrypted export (Deviations, item 8). Every number here was printed before teardown, and none changes, but a later fix or recount can't use H1's transcripts.
- **The free count route.** The metering proxy forwarded the free count_tokens route (52 no-gstack and 33 told calls) after its model check but before the body checks it runs on paid calls, so a hosted tool or MCP server named only in a count request would not have been refused.
- **Login shells.** A session that runs an explicit bash -l loses bun in every arm, and go in every arm too.
- **The detector's known undercounts stay** (E2's and E3's limits). They can only lower the exposed count.
- **Raised limits.** H's sessions ran with session limits twice G's, so costs and stop counts aren't comparable one for one with G or E3.
- **The full kind only.** The told arm ran autoplan's default full kind at gstack ddbf1c9a, not the lean kind gstack now uses for feature plans.
- **Repositories aren't named.** The prereg names a repository in a results post only after a terms check for that repository, which hasn't been done.

## Deviations

None changes a number in this post.

1. **4 spares replaced 4 finals, before any data.** The 4 finals failed the no-gstack arm's clean-room image check, because each work tree holds a .claude/skills fixture folder. The Captain swapped in the 4 spares, all of which passed, before any session. This departs from the prereg's section 3.5, which lets a spare replace a final only when the final's image stops passing its reference change.
2. **Host fixes before any lease** (accepted by the Captain). docker compose v2 was installed after dry run 2's stand-in trials failed without it; the clean-room test's busybox image was pulled; the hours-lease script that left a second lease open in the dry run was swapped for E2's, which refuses a reused cell task and closes a lease whose reserve fails; and R61_GSTACK in the run env file was corrected to point at the arm's gstack checkout at ddbf1c9a.
3. **The h1-none item names two skills.** The stage driver gives a no-gstack stage every told skill in the arms file, and H's arms file holds both plan-eng-review and autoplan, so h1-none was approved with both skills. The ledger splits h1-none evenly between them. By the Captain's ruling all of H1's spend counts as autoplan's (Agent notes).
4. **More room in /dev/shm, and a pruner, mid-run.** The sandbox sidecar kept each trial's repositories after the trial closed, so /dev/shm would have filled before the batch ended. It was remounted from 16 GB to 20 GB, and a script deleted each sidecar trial folder only after its job's end line (84 checks, 128 folders). No frozen file changed.
5. **Dry-run custody cleanup and the move to /dev/shm.** Dry run 2 wrote stand-in trial material outside /dev/shm on the run host's disk. All of it was deleted before any real session, and the sidecar root and TMPDIR moved into /dev/shm for the real run.
6. **Scoring scratch deleted mid-run.** At 08:25:05Z the reader's scoring scratch in /dev/shm was deleted (4 folders, 5.6 GB) to free memory. Every trial's score was already cached beside its record.
7. **The smoke run started twice.** The first smoke run ran one session and exited 0 without starting the second, most likely because the harness read the smoke loop's input. It was started again, skipped the finished session and ran the second session once. That session's first and only run is the one reported.
8. **The trial records were not exported before teardown.** The prereg's section 9 end rule requires an age-encrypted export of the trial records before /dev/shm is deleted, as E2 and E3 did. The step was skipped: /dev/shm was deleted at 10:57:38Z and the host destroyed at 10:58:06Z, without it. What is lost: no re-read of H1's 128 trials is possible, including the 10 flagged trials under a fixed path rule, and no leak check can run against H1's transcripts. No plaintext left the host, and the sealed task set itself is intact. No number in this post changes.
9. **Run files not attached.** As in R61, E2 and E3, this post attaches printed lines, not scripts. The run files and the run thread's scripts are cited by sha256 in Replicate it.
10. **Count-only scripts that aren't frozen.** The flag table, the tilde-path checks, the base-image count, the containment scans and the bundle script were written during or after the run to answer questions about it. Each prints counts, labels and path classes only, and none decides the reading.

## Setup

- **Question.** On H's 42 larger Go features, does plain Opus 5.5 leave room for autoplan to show a gain? The reading is s, the mean over tasks of solved over valid trials, with its upper bound UB, against a band of 0.20 to 0.65 and UB under 0.80.
- **Tasks.** H, mined for this experiment: Go features merged on or after 2026-10-01, from 3 or more source files and 200 to 1,000 changed lines. Acceptance walked the panel, in its seeded order, to index 903 of 4,604. 192 candidates were skipped at the per-repository cap of 3 before they started, and 695 started, from 105 repositories. Of those, 634 failed a build, probe or audit stage, 57 passed and 4 were parked. The mining log lists 541 drops by cause, the main ones being the probe's validity checks (235), functional tests that never ran at the reference change (125) and the audits (98 by both auditors, 68 by Opus alone), and it doesn't say why that count is lower than the failure count. 46 passing candidates were kept, 42 finals and 4 spares. 42 finals from 24 repositories are in the run, at most 3 from a repository, each licensed MIT, Apache-2.0, BSD-2-Clause or BSD-3-Clause. 6 of the 42 are tagged with a constraint test.
- **Arm.** none: the same harness with no gstack, an empty arm tar, and no drive mounted. The told smoke arm is E3's: gstack ddbf1c9a with the lite loadout and the gate on, built by E3's install script and checked (197 files, digest 70db9ce6).
- **Model and harness.** claude-opus-5-5 through Anthropic's API and the run's metering proxy. Claude Code 2.1.312 with the claude-code-preset system prompt, claude-agent-sdk 0.2.174, Harbor f3a5a92 with HARBOR_TELEMETRY=0, and CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1. Session limits from H's arms file: none, 400 turns and 3 hours; told, 800 turns and 8 hours; each with a cost limit in Agent notes.
- **Rules.** 3 fresh trials a task, in the seeded order the prereg fixed, at most 4 sessions at once. Solved means the final tree passes every hidden test, functional and base suite, in a verifier-owned run. Refusals are scored by their code from the proxy's journal. A gap gets one rerun, 6 at most. A contaminated or tripped trial is excluded. The smoke tasks were drawn by the prereg's seed after the last no-gstack session settled.
- **Start rules.** The 7 start rules held before the first lease, with the roster swap in Deviations item 1: the sealed set and its digests, the caps recorded, the run commit with rig.yml green and E3's checked files byte-identical, the host rules, the envelope rebuilt to match its export with h1-none and h1-told admitted, the told tar and its render, and the run files' sha256s with both dry runs passed. h-vm, the host-hours item, admits with a warning only, and was admitted on the run host before its hours settled.
- **Dates and host.** One Ubicloud standard-8 run host, created at 21:13:10Z on 2026-11-09. The no-gstack batch ran from 01:45:35Z to 07:02:14Z on 2026-11-10, scoring until 08:19Z, the first smoke session from 08:25:05Z to 09:42:28Z and the second from 09:50:14Z to 10:36:44Z. The reader ran at 10:38:50Z, and the run settled at 10:40:26Z. The host was destroyed at 10:58:06Z.

## Custody and teardown

- **One opening.** H was opened once on the run host at 21:21:47Z on 2026-11-09, into /dev/shm only, after linger was on and with no provider key in the host's environment. The identity copy went in over ssh stdin and was deleted at 21:21:53Z. Specs, answers and the 4 excluded task folders were deleted at once.
- **Images.** Rebuilt at the run commit over the 42 finals and checked. The manifest stays private; its sha256 is 8e067e20a5518e0da3dba31d26da6f3e031791d819af420f8d8df83826be1fe9.
- **One incident during the dry run** (Deviations, item 5), logged and cleaned before any real session.
- **No export of the trial records** (Deviations, item 8).
- **Teardown.** /dev/shm/h1 (53,069 files) and the run's image manifest were deleted at 10:57:38Z and checked with test ! -e. A sweep found no repository bundle, score file or task file anywhere else on the disk. The host was destroyed at 10:58:06Z. The runner's list of the run thread's VMs came back empty, and Ubicloud's API returns not found for the host.
- The custody log beside the sealed bundle records every opening, deletion, sweep and incident.

## Replicate it

A recount would need the session records, which were not kept. The run's reader h1-read.ts printed read.txt, and h-harbor-job.sh ran every session and the smoke; both are cited with every other run file in the run record, and their edits against G's and E3's files are listed in the run files' change log. The run thread's count-only scripts printed the other attachments: post-bundle.ts (sha256 0f353c0ed766e64664281651e2ad8fffb15e5c75137064a9409987df04616782) printed trials.tsv; flag-table.ts (a91e416300417c057fc0ae0fb407775409d48690093ae9535acb94ff404210e5) printed contamination-flags.tsv; home-check.ts (c87ed777c50619c2809eba42fa89d21409f9ac62f02f18404ef337bb2a4de86a), home-check2.ts (0809059fcc43a478eaf6dacf22e84e78bb1bfa246c965cfc026f567032a50fb7) and home-check3.ts (d22812fa9b8d366f5314b96924a2a3bcac20289ae80ef472cb43f538c4cdc574) printed flag-checks.txt; flag-summary.py (6e9846d04cccec1c6b8c4c6c70467c8d378064258eef878fae16dbf383914a57) turned the flag table into contamination-flags-by-trial.tsv; proxy-scan.ts (7c2e562a0e70dde36a591a68794be3ef21899fd45488a14c373a80c527ecb789), proxy-scan2.ts (5774b1a55e075a9497a8396dd5ddc9dfca843b82f378f13c005509a88a89905d) and proxy-scan3.ts (fe767520f60b41170ce3568372582673b28363bd46a591231fb55ddca2810187) printed containment.json. base-skill-folders.txt holds the counts from one docker command per image, recorded in the run record. settle.txt holds the stage driver's settle lines, the run's settled line, the host-hours lease line and the ledger's status lines.

This record leaves out the scripts' text, the host setup commands (they are in the run record) and the paid sessions, which need the sealed task set, the ledger and an Anthropic key.

## What is held out, and why

H stays sealed: its tasks, statements, hidden tests, repositories and image manifest, so later models can't learn them. Its digests are public: the bundle 681d848fe269bc3d95e7354a868cb13fe14a1cb43ec2a8a3bb651bccb39cb5d0, its inner tar fd9e4937437046f4675ec5c48007dfecbf653eec2f07a13ff5790093a60dc30f, the sealed image manifest 7312fe8e26063c53bf66ed953e440f6a451f71dbc13623ce53723d7984c68b71, and the units table 397c9af961d6dc5e005c86c056f1894cdd3ad78905140c8113bb165e8c4164e3. The task labels in this post are random and say nothing about the tasks.

## Attribution

Harbor is Apache-2.0. gstack at the pin is MIT. Claude Code is Anthropic's proprietary software, here driving Anthropic's own Opus 5.5 through Anthropic's API. Each task repository keeps its own MIT, Apache-2.0 or BSD licence.

## Changelog

- 2026-11-10: first version.

<details>
<summary>Agent notes</summary>

**Per-session cost** (read.txt; from the metering proxy).

- No-gstack sessions (126): mean $1.8808, median $1.4454, 95th percentile $4.5958, total $236.9805. The median over G's no-gstack mean of $0.9325 is 1.5501.
- Told smoke: th117fd136bb t1 $19.1495 (solved, not exposed); th5c1d188c05 t1 $34.9989 (unsolved, exposed). Mean $27.0742, which is 14.3951 times the no-gstack mean.
- Session cost limits from H's arms file: none $16, told $90.
- C1 re-projected caps (section 7.3's formulas, printed and not used): told $8,280.00, none $856.00.

**Prices.** Opus 5.5 in dollars per million tokens, from src/runner/pricing/prices.ts at the run commit, as the proxy used them on 2026-11-10: input 4, output 20, cache read 0.20, cache write 5. The token totals at these prices give each arm's metered total to the cent.

**Paid** (the ledger, wave 1 envelope; settle.txt).

| Item | What | Settled | Cap | Share of cap |
|---|---|---|---|---|
| h-mine | Mining's model calls | $57.521082 | $80 | 71.9% |
| h-vm | Host hours: the build host and its overrun, and this run's host | $23.21898 | $45 | 51.6% |
| h1-none | 126 no-gstack sessions | $236.980526 | $660 | 35.9% |
| h1-told | 2 told smoke sessions | $54.148411 | $180 | 30.1% |
| **H, all items** | | **$371.868999** | **$965** | 38.5% |

h-vm's three leases: $17.70 for the build host, $1.2348 for its 2.058-hour overrun, and $4.28418 for this run's host, 14.2806 hours at $0.30. That last lease had to open on the admitted host, so it was settled before teardown to a planned end of 11:30:00Z. The host ran 13.749 hours, so the lease is $0.1596 over. Both model-call leases settled with unknown $0.00.

**How the ledger splits h1-none.** The item names two skills (Deviations, item 3), so the ledger charged plan-eng-review $118.490263 and autoplan $118.490263. By the Captain's ruling all of H1's paid spend, $291.128937 (h1-none and h1-told), counts as autoplan's. The plan-eng-review line can subtract its $118.490263. After settling, wave 1 reads $1,946.161179 committed of $10,000 with nothing open; autoplan's ledger line reads $1,260.708287 settled of $2,000, or $1,379.198550 with plan-eng-review's share moved back.

**Crew**, from the thread counters at $1 per 1,000 credits.

| Thread | Work | Credits | Dollars |
|---|---|---|---|
| GEVA-397 | the prereg | 37,987 | $37.99 |
| GEVA-399 | mining, building and sealing H | 65,027 | $65.03 |
| GEVA-506 | this run and post, when written | 58,966 (when written) | $58.97 |

**H all-in, on actuals:** $371.87 paid plus $161.99 of crew, about $534 when written. E3's results post put autoplan's line at about $1,351 all-in through E3, so with H the line is about $1,885 of $2,000.

</details>

## Disclosures

gstack is Garry Tan's own project.
