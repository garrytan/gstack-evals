---
id: 2026-11-06-geva-364-g-admission-results
kind: finding
title: "G admission: plain Opus 5.5 solved 22 of 22 valid tasks, so plan-eng-review and autoplan stop at headroom as FIX-METHOD (saturation); told exposure was 0 of 18 and 0 of 23"
summary: "G admission on Opus 5.5, 12 tasks x 2: none solved 22 of 22 (95% CI 84.6 to 100), above the 20% to 80% band. Both skills FIX-METHOD (saturation). Exposure 0/18, 0/23."
author: GEVA-364
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-06
status: done
links:
  - 2026-11-04-geva-262-g-family-admission-prereg
  - 2026-11-03-geva-225-outcome-per-skill-plan
  - 2026-11-04-geva-282-g-o5-pin
  - 2026-11-06-geva-312-g-admission-readiness
  - 2026-11-05-geva-312-g-tg-slice-yield
  - 2026-11-03-geva-250-panel-v3-headroom-results
  - src/runner/stats/g-admission.ts
  - lanes/real-outcome/score/grade.ts
attachments:
  - 95d2648a30b80fb3247b3997c7ab348e4e056d61c6f521d0b32de5f05b943fc8  admission.txt
  - d56eeb4a265aadb4c1e03b526fb7e74637cf683a0eb875bcd129a18dab699f4b  arm-counts.txt
  - 40a083d8c84a597d45c8bc3528373c6522992bd6ddf928b5c3ea9da480963506  gap-causes.txt
  - fa42e3e072d302763aedf0b580612df450328958472b4e2d89966279c26d2ad3  settle.txt
  - d483e1e73aecc071443e1c6bba9bbccae3112d01675c3b45dc39640f22515437  inputs/g-admission-runner.ts.txt
---

# G admission results: plan-eng-review and autoplan on Opus 5.5 (wave 1)

## Status

Publication status: unpublished. This is the record of a preregistered admission run. It reads no effect of either skill.

| Field | Value |
|---|---|
| Grade | Admission, preregistered. One model (Opus 5.5), one 12-task slice, 2 trials a task. The verdicts are admission routes, not verdicts on the skills. Every told solved rate is a description. |
| Prereg | [G prereg](../../plans/2026-11-04-geva-262-g-family-admission-prereg/README.md) under [plan v3](../../plans/2026-11-03-geva-225-outcome-per-skill-plan/README.md), pinned by the [O5 pin post](../../plans/2026-11-04-geva-282-g-o5-pin/README.md) and started under the [readiness post](../2026-11-06-geva-312-g-admission-readiness/README.md) |
| Run commit | 20c4277. It differs from the readiness post's c52f510 only in the readiness post's own two files under wiki/; the admit records bind tree 23d5982ec6d8e953d030014f6e42553fc5d73525, and rig.yml run 42147917032 passed at 20c4277 |
| Told arms | gstack 699a41cb, lite render (tree ed09c8c8), as the O5 pin post pins it |
| Data | The run's exported results in the project drive, checked against their sha256 manifest. The attachments here are byte-identical copies; the drive keeps the rest, including admission.json (Inputs, below). Transcripts and the sealed slice stay private. |
| Reviewed by | The /ship review of this post, recorded in its pull request |
| Reproduced by | Not yet |

## What we found

Plain Opus 5.5 solved every valid task. With no gstack installed, it solved 22 of 22 valid trials on G's sealed 12-task slice (100%, 95% Clopper-Pearson interval 84.6% to 100%). The prereg's headroom band is 20% to 80%, both ends included. So admitG stops both skills at item 1 with route **FIX-METHOD (saturation)**, and items 2 to 5 were not read. The 2 none trials that ended as gaps can't move this: counted unsolved, none is 22 of 24 (91.7%), still above the band. With 24 none trials, 19 solved is the most the band admits.

The told arms never visibly ran their skill's procedure. The frozen exposure detectors found the procedure in 0 of 18 scored told plan-eng-review trials and 0 of 23 scored told autoplan trials. Told sessions cost 7.1 times a none session for plan-eng-review and 19.7 times for autoplan, against plan v3's house multiples of 2.2 and 5.0. At these metered prices resize.py stops both skills on price as well: no design for either skill, alone or with the other, reaches the 20-point bound inside its line.

R48: plan-eng-review is a **CUT-CANDIDATE**, sent to the project owner, decision pending. autoplan is **FIX-METHOD (saturation and exposure)**. Under R56's fair-test rule both read **untested** on Opus 5.5, because exposure was zero.

No rerun ran, and nothing was retried.

## Setup

- **Tasks.** T-G, the sealed thin slice: 12 valid tasks (10 K3 features, 2 K2 issue fixes) from 9 public repositories, multi-file, statements in our own words, hidden tests from each real change and the base suite ([T-G yield post](../2026-11-05-geva-312-g-tg-slice-yield.md)). Tasks appear here only as tg digests.
- **Arms** (prereg section 4). none: bare, in the clean room, one turn asking for the implementation. told plan-eng-review and told autoplan: gstack at the pin, turn 1 asks for a plan in PLAN.md and no code, turn 2 runs the skill on PLAN.md, turn 3 asks for the implementation. Told autoplan runs its default full kind. Every told session runs under the lane's rec persona.
- **Sessions.** 12 tasks x 2 trials x 3 arms = 72 sessions, interleaved in the prereg's frozen order, four at a time, on the program's envelope host.
- **Harness.** Harbor f3a5a92 with real_agent in U4 mode and claude-agent-sdk 0.2.174, run by the G job file, g-harbor-job.sh (Inputs, below). Each session spent through its own metered U4 slot on the stage's ledger lease. Hidden tests decide solved; the lane's verifier grades in the pinned image. No judge model.
- **Scoring.** inputs/g-admission-runner.ts.txt scored each trial with the lane's scorer, the mutation scorer, the skill's exposure detector and the guarded t1 reading, then ran admitG and the prereg's resize.py. It takes each trial's task from the trial's own record (readiness gap 1) and applies the t1 guard (readiness gap 2). Its keyless test, g-admission-runner.test.ts, stays in the drive (next item).
- **Inputs.** The runner under inputs/ carries the sha256 the Captain recorded before the first lease; its name gets a .txt suffix so the repo's test run and type check don't pick it up, and its bytes are unchanged. Three run files stay in the project drive, unedited, cited by their recorded digests: the job file, g-harbor-job.sh (a3ba2e9cfc5890f3d52afe31470ef9f8c5e0e07f64c59be038a1cdda1396ff61); the runner's keyless test, g-admission-runner.test.ts (1e8b8ff9b58720d83e64a73bb539c2d83998e5fdcd39b050278214ca8afe56b2); and admission.json, the runner's machine-readable output with every row (7c931ef09368af50048ed785a213fec9e6ececff27e9d161b55e92ae33f171ba). The test file's line 2 is a usage comment that names the run VM's working directory, which the repo's sealed guard refuses as a local path; that VM no longer exists (Custody and teardown, below). If a public finding ever needs an outside recount, a data-only pull request will bring those three files into the repo.

## Verdict per skill

admitG's output, as printed (admission.txt):

| Item | plan-eng-review | autoplan |
|---|---|---|
| 1 headroom | FAIL: none solved 22 of 22 valid trials (100.0%); the band is 20% to 80%, ends included | FAIL: the same shared none arm |
| 2 exposure | not read (item 1 stopped the skill) | not read |
| 3 instruments | not read | not read |
| 4 rig | not read | not read |
| 5 price and power | not read | not read |
| Route | FIX-METHOD (saturation) | FIX-METHOD (saturation) |

The none arm is shared, so one headroom failure stops both skills. 72 trials were read, with 0 reruns.

## Report-only readings

None of these decides anything.

- **Exposure.** Of all scored told trials, the detector read the procedure in 0 of 18 for plan-eng-review and 0 of 23 for autoplan. The 7 told gaps have no exposure reading. The prereg's 8-trial exposure sample per skill was drawn (admission.txt lists it), but item 2 was not read.
- **t1 writes outside PLAN.md.** Turn 1 asks for a plan in PLAN.md and no code. The model wrote other files in turn 1 in 5 of 18 plan-eng-review trials and 9 of 23 autoplan trials, with the t1 guard applied (a told trial with no t1 message record reads null).
- **None read audit.** 0 of 24 none trials, scored or gap, were flagged.
- **Told solved, descriptive.** plan-eng-review 17 of 18 scored trials; the unsolved one ended at the background-wait limit (bg_wait_expired, truncated). autoplan 21 of 23; one unsolved trial ended at the same limit and one completed unsolved. These carry no comparison with none.
- **What items 3 and 4 would have read.** The verifier returned a run for 63 of 63 scored trees (22 none, 18 told plan-eng-review, 23 told autoplan) and for none of the 9 gaps (the drive copy of admission.json, field verifier_ran). So the half of item 3 that the headroom reading rests on held. The mutation scorer returned a tool error on 10 of 22 none trees, 11 of 18 told plan-eng-review trees and 13 of 23 told autoplan trees (the drive copy of admission.json, field mutation_status). Item 3 asks for 90% of the trees in each skill's comparison, and admitG counts the scored trees, so it would have read 19 of 40 for plan-eng-review and 22 of 45 for autoplan (19 and 22 of the 48 planned trials). The run record doesn't name the cause of the tool errors. Item 4 allows at most 1 gap per arm; the rows hold 2 for none, 6 for plan-eng-review and 1 for autoplan (The 9 gaps, below). Both truncated told trials were explained by the lane's termination taxonomy.
- **Capture counts.** A host-side capture logged every new outbound TCP SYN and UDP packet from trial containers. Over all 72 trials, at the batch's end and again at settle: 0 packets before a trial's egress table, 0 not allowed after it, and every trial's proxy and sidecar traffic mapped to that trial. The unmapped packets, 255 at the batch's end and 261 at settle, were DNS replies to the host itself. The 6 extra arrived after the batch, with no trial running, and were not inspected. No rerun ran, so there was no rerun trial to count.

## Metered inputs and the re-size

| Input | Value | How it was read |
|---|---|---|
| AUTH_PAID | 0.3624 | T-G's settled paid author and audit dollars per valid task, over 12 valid tasks |
| AUTH_EXTRA | 1.2 | unmeasured; resize.py's value when it is absent, as the Captain accepted before the run |

No told trial was exposed, so every told mean is the unexposed mean. Unknown calls: 0 calls and $0 in every arm. admitG computes these means over scored trials; the 9 gap sessions are in the settled spend below but not in the means.

resize.py (the prereg's file, sha256 1265268921e9, under python3 -I, AGENT_USER unset) exited 0 and printed the same lines as the runner's own g-resize.ts:

| Case | Result |
|---|---|
| Both alive | both past the 20-point bound, and neither finds an alone design |
| plan-eng-review alone | stops, FIX-METHOD (price) |
| autoplan alone | stops, FIX-METHOD (price) |

So price would stop both skills even without the saturation stop.

## The 9 gaps

The rows step wrote 9 gaps: 2 none, 6 plan-eng-review and 1 autoplan (gap-causes.txt). Each one is the metering proxy refusing a call with E_ALLOWANCE (HTTP 402), because the session's allowance could not hold that call's worst case.

| Arm | Label/trial |
|---|---|
| none | tg9e6c31ad6e/t1 |
| none | tg9e6c31ad6e/t2 |
| plan-eng-review | tg0a031169b2/t2 |
| plan-eng-review | tg0b7b079452/t2 |
| plan-eng-review | tg0f068d5968/t1 |
| plan-eng-review | tg9e6c31ad6e/t1 |
| plan-eng-review | tg9e6c31ad6e/t2 |
| plan-eng-review | tgff24032962/t2 |
| autoplan | tg9e6c31ad6e/t2 |

Task tg9e6c31ad6e stopped this way in all three arms.

The lane's frozen taxonomy calls each of these session_cap, class truncated: terminationOf maps an error result after a proxy budget refusal to session_cap. They scored as infra gaps instead because of a field mismatch. grade.ts reads the refusal count from laneb-summary.json's session.refused_budget, and on the U4 slot path the session summary carries that count as session.refused. With session.refused_budget absent, the termination stays error_result, class infra, and the runner records a gap. This is a scorer limitation. It changes no reading here: item 4 was not read, and scored as session_cap stops the 2 none trials would count unsolved, which is the 22 of 24 case above.

No rerun ran. A cap stop is never retried; a rerun at the same allowance would stop at the same point, and a larger allowance would change the prereg. The verdict can't move either way.

## Findings for a confirmatory prereg

1. **Long sessions stop well short of their allowance.** The proxy refuses any call whose worst case doesn't fit in what is left, so a session stops one worst-case call short of its limit, not one call past it. The prereg's section 9 assumed a session could pass its limit by at most one call. 9 of 72 sessions stopped this way, 6 of them among plan-eng-review's 24.
2. **Sessions cost far more than plan v3's house prices.** A none session averaged 4.9 times plan v3's house none price, and told sessions 7.1 and 19.7 times a none session, against house multiples of 2.2 and 5.0. Any re-costing for these skills starts from the metered inputs above.
3. **Exposure needs its own fix before a told arm can read anything.** Told under the rec persona, neither skill's procedure showed in any scored session (Why null, below).

## Why null? (R48)

**plan-eng-review: CUT-CANDIDATE**, sent to the project owner, decision pending.

- *Exposure.* 0 of 18 scored told sessions showed the procedure. So this run did not see the skill's procedure work, and the CUT-CANDIDATE does not rest on a measured null effect of it.
- *Task fit.* The slice is the work the skill claims to help with: multi-file features and fixes in real repositories, planned before code.
- *Power, floor and ceiling.* none solved 22 of 22 (95% CI 84.6% to 100%). On these tasks there is no solve-rate room for any skill to show a gain.
- *Frontier without it.* Plain Opus 5.5 does the job without the skill. This is the second attempt to raise the ceiling that found none, after the seeded-flaw [panel v3 headroom check](../2026-11-03-geva-250-panel-v3-headroom-results.md), where plain Opus 5.5 found 15 of 16 planted engineering flaws.

The prereg's section 11 tied plan-eng-review's cut reading to a confirmatory told arm. Admission stopped, so that arm won't run under this prereg, and the Captain sent the CUT-CANDIDATE to the project owner on this evidence and panel v3's.

**autoplan: FIX-METHOD (saturation and exposure).**

- *Exposure.* 0 of 23 scored told sessions showed the procedure. Unattended told autoplan, in its default full kind, never visibly ran it.
- *Task fit.* As for plan-eng-review.
- *Frontier without it.* As for plan-eng-review.
- *Cost.* A told autoplan session cost 19.7 times a none session, about four times plan v3's house multiple.

The thing to fix before any retest: unattended autoplan costs about 20 times a none session and never visibly ran its procedure. Plan v3's section 9 names the strict stratum as autoplan's one ceiling raise, a proposal with its own price and approval.

**R56 rows.**

| Skill | Model | Reading | Condition that failed |
|---|---|---|---|
| plan-eng-review | Opus 5.5 | untested | exposure 0 of 18 under the fair-test rule; none at the ceiling (22 of 22) |
| autoplan | Opus 5.5 | untested | exposure 0 of 23 under the fair-test rule; none at the ceiling (22 of 22) |

plan-devex-review is not covered here. Its outcome test is the X family.

## Deviations

None changes an arm, a draw, a scoring rule, a cap or a verdict.

1. **The prepare step and the launch.** The job file's prepare step had run on only 3 of the 12 run copies when the batch started. The first launch, 4 workers at a time, started 4 trials, and the job file's own guard refused 9 others before any job folder was made. The operator stopped the launch, ran the job file's prepare on all 12 copies and finished the frozen order with a separate launcher, at most 4 trials at once, from 02:42Z. The refused early trials ran a few minutes later than the frozen order placed them. The job file, the runner and its test kept their recorded digests.
2. **The hours-lease key collision.** The hours-lease template opened the g-vm lease, and its reserve then failed with E_RESERVE_CONFLICT: its idempotency key, the bare cell task, was already held by T-G's host-hours reservation in the same ledger. Nothing was reserved or spent. A finish script ran the template's remaining steps on that same open lease with the meter id as the key and settled the hours once. No second lease opened. The script (sha256 in What is held out) stays in the run record; the template's key is a separate backlog fix.
3. **The setup network window** (readiness run rule 5). The job file's prepare step rewrites the bound run copy's two network_mode lines to public, keeping the bound file beside it and refusing any other difference, because real_agent refuses a container on more than one network and enforces egress with its own table. A keyless check before the batch found each trial container's network open for about 11 seconds of setup, before real_agent writes its egress table. No model call and no agent process runs in that window, and real_agent opens no session until its table is written and probed. The Captain ruled the run go ahead with a passive capture, which counted 0 outbound attempts before any trial's table. In the Captain's terms, this run had no network the agent can use, rather than no network outside the session.
4. **The run commit.** The run checked out 20c4277, not the readiness post's c52f510. The Captain accepted it before the first lease, since the two differ only in the readiness post's own files.
5. **AUTH_EXTRA.** It was not measured. resize.py ran with 1.2, plan v3's house central value, as the Captain accepted.

## Harbor telemetry

Harbor sends anonymous usage telemetry by default, and the frozen job file did not turn it off, so every session sent it. Harbor's telemetry module at f3a5a92 sends two events, harbor.job_finished and harbor.command_finished, to PostHog's US ingest host. A detached helper process posts each one. The distinct id is a random UUID stored in Harbor's config folder, with person profiles and GeoIP off, and an allowlist drops any key the two event models don't declare.

- job_finished carries a random job UUID; Harbor and Python versions, OS, architecture, CI flag and launch source; a fixed coding-agent label; counts of tasks, trials, attempts, concurrency, retries, completed, errored and cancelled; environment enums and overrides; agent names (a custom agent import maps to "custom"); model provider and name (anthropic, claude-opus-5-5); dataset source types ("local" for a path task) and registry or public repository references (none here); booleans for MCP, skills, custom verifier, artifacts and extra instructions; network-mode enum values; status; job and trial duration statistics; token and cost totals; the reward mean; and exception class names.
- command_finished carries the job UUIDs, the command path ("run"), flag names only (values are never read), status, duration, exit code and exception class name.

It carries no task, repository or path identifiers. The tasks ran from local paths, which map to "local", the agent import maps to "custom", flag values are dropped, and the job id is a random UUID. What left was counts, durations, token and cost totals, enum labels and flag names. Telemetry turns off only when HARBOR_TELEMETRY is 0, false, no, off or disabled. From this run on, every Harbor job file in this program sets HARBOR_TELEMETRY=0, and its run record shows it was set.

## Custody and teardown

- **Sealed material.** T-G's task material was decrypted only into the envelope host's RAM-backed /dev/shm. Before deletion, the outputs that hold no sealed content were copied to the host's disk, with repository fields removed from admission.json (0 matches for repository names, GitHub or host paths afterwards). At 2026-11-06T18:03:49Z the run thread deleted the /dev/shm working folder (5.3 GB: task folders, run copies and job folders), and test ! -e passed. The custody log records the deletion.
- **Envelope host teardown, confirmed.** The wave 1 envelope record was exported first. Then the envelope host was destroyed: list --mine came back empty, the Ubicloud API returns 404 for the VM, no relay or tunnel is left, and its key is deleted. The settled envelope figures are in Spend.

## Limits

- **One model, one small slice.** Every reading is Opus 5.5's, on 12 tasks with 2 trials each. GPT-6.1 Sol is out of wave 1 (prereg section 4), and particle-1 was not run at admission.
- **Exposure is the detector's reading.** The detectors are frozen from the pin's files and fixture-tested keyless. The transcripts were not reread for this post, so a detector miss is not ruled out by these counts alone.
- **Metered means leave out the gaps.** admitG averages over scored trials. The 9 gap sessions settled in the totals above.
- **Task binding in the scorer** (readiness gap 1). The scorer checks the image a trial ran in, not its task. The runner took each trial's task from the trial's own record, checked against the sealed manifest.
- **Capture limits.** A packet a trial's egress table drops never leaves the container, so after the table only allowed traffic shows. Docker's embedded DNS answers inside the container's namespace, so a name lookup shows only through the connection that follows it.
- **Outside terms.** Anthropic's Commercial Terms of Service (effective 2025-06-17, read 2026-11-06) restrict building competing products, reverse engineering and resale, and hold no clause on publishing evaluation results. The task repositories are not named, because naming one needs its own terms check first (plan v3 section 11).

## Replicate it

A recount is keyless from the drive copy of admission.json, which holds every row. The run's own commands, as the run thread ran them on the envelope host, from a checkout at the run commit with the run env file sourced:

    G_RUN_ENV=<run env> bash g-harbor-job.sh prepare
    G_RUN_ENV=<run env> bash g-harbor-job.sh batch 4
    bun g-admission-runner.ts rows <run env> <shard> 2
    bun g-admission-runner.ts admit <run env> > admission.txt

admit runs the prereg's resize.py itself. The record leaves out the paid sessions, which need the sealed T-G bundle, the envelope ledger and an Anthropic key, and the separate launcher that finished the order (Deviations, item 1).

## What is held out, and why

T-G stays sealed: its 12 tasks and spare, their statements and hidden tests. Its image manifest's sha256 is 7b1ab47b539ee573ea353be777a7b6787e7168d94742b5e43477305e32f4ebe9 (readiness post). Transcripts stay private.

The rest of the export stays in the project drive, under its manifest: launch.log 3907431ab7d224f4c80654a779a04e30bfdd56a40a1ad001a8e7e5ff505534f8, capcount-batch.txt 9342bfd0aef3c79b85531574786e49af297a6ee5a871e23a303c0f54207ffd12, capcount-final.txt dc41d57669b491b25b46a7461a06acb95795202e527e68a61099708d2815718e, rows.tsv d7f23256325ee9fa9e1c52eb8f8bc9f36116923d00afcb2a935d39d3ed3f0652 and rows-detail.tsv 68880351edebce8e7e0a97f8618b5b2bc6e7154a1fbb51d59e9e518b656c8dbc. The hours-lease finish script is 31d17868827417f90d57c89d30f72027a04b4c5dc7d4ea5b9519952246f08150. The job file, the runner's keyless test and admission.json carry the digests under Inputs.

## Attribution

Harbor is Apache-2.0. gstack at the pin is MIT. Claude Code is Anthropic's proprietary software, here driving Anthropic's own Opus 5.5 through Anthropic's API. Each task repository keeps its own MIT, Apache-2.0 or BSD licence.

## Changelog

- 2026-11-06: first version.

## Disclosures

gstack is Garry Tan's own project.

<details>
<summary>Agent notes</summary>

The admission stages settled $690.03 of their $2,112 in caps.

Session limits: none $8, 200 turns, 90 minutes; told plan-eng-review $20, 200 turns, 120 minutes; told autoplan $45, 400 turns, 240 minutes.

| Input | Value | How it was read |
|---|---|---|
| MULT | 4.882 | none's mean session cost, $0.9325 over its 22 scored trials, over plan v3's house $0.191 |
| M_PER | 7.119 | told plan-eng-review's mean, $6.6378 over 18 scored trials, over none's |
| M_AP | 19.704 | told autoplan's mean, $18.3733 over 23 scored trials, over none's |
| AUTH_PAID | 0.3624 | T-G's settled paid author and audit dollars per valid task, over 12 valid tasks |
| AUTH_EXTRA | 1.2 | unmeasured; resize.py's value when it is absent, as the Captain accepted before the run |

| Case | Rungs tried, as n x k, price, MDD in points | Result |
|---|---|---|
| Both alive | plan-eng-review 24 x 2, $837, 34.8; autoplan 24 x 2, $1,682, 34.8; wave 1 plans $9,047 | both past the 20-point bound, and neither finds an alone design |
| plan-eng-review alone | 60 x 3, $2,497, 18.6; 60 x 4, $2,959, 16.8; 54 x 4, $2,700, 17.4; 48 x 4, $2,440, 18.6; 42 x 4, $2,181, 19.8; 36 x 4, $1,921, 21.0; 30 x 4, $1,661, 23.4; 24 x 4, $1,402, 26.4 | stops, FIX-METHOD (price) |
| autoplan alone | 54 x 3, $4,466, 19.2; 54 x 4, $5,516, 17.4; 48 x 4, $4,975, 18.6; 42 x 4, $4,434, 19.8; 36 x 4, $3,893, 21.0; 30 x 4, $3,351, 23.4; 24 x 4, $2,810, 26.4 | stops, FIX-METHOD (price) |

A rung qualifies when its alone price is inside the $1,700 line and its MDD is at most 20 points (prereg section 7). No rung does. plan-eng-review's cheapest rung at 20 points or under, 42 x 4, prices at $2,181, past the line and past the skill's whole $2,000 cap. autoplan's cheapest rung of any size prices at $2,810.

| Arm | Label/trial | Allowance | Committed | Refused worst case |
|---|---|---|---|---|
| none | tg9e6c31ad6e/t1 | $8 | $4.09 | $3.92 |
| none | tg9e6c31ad6e/t2 | $8 | $4.24 | $3.84 |
| plan-eng-review | tg0a031169b2/t2 | $20 | $13.59 | $6.41 |
| plan-eng-review | tg0b7b079452/t2 | $20 | $13.53 | $6.49 |
| plan-eng-review | tg0f068d5968/t1 | $20 | $13.70 | $6.31 |
| plan-eng-review | tg9e6c31ad6e/t1 | $20 | $13.28 | $6.84 |
| plan-eng-review | tg9e6c31ad6e/t2 | $20 | $13.14 | $6.90 |
| plan-eng-review | tgff24032962/t2 | $20 | $13.51 | $6.59 (3 refusals) |
| autoplan | tg9e6c31ad6e/t2 | $45 | $32.64 | $12.51 |

Here that was $13.1 to $13.7 of $20 for plan-eng-review, about $4.1 to $4.2 of $8 for none and $32.6 of $45 for autoplan. A confirmatory prereg should size each allowance with the largest worst-case call in mind ($3.8 to $12.5 here) and score these stops as the taxonomy says, after the scorer reads the refusal count the proxy writes.

At metered prices the skill alone can't reach a 20-point MDD for less than $2,181, past its $2,000 cap.

The CUT-CANDIDATE rests on the last two checks: Opus 5.5 does this job without the skill, and $2,000 can't power a 20-point test of the skill alone.

*Power, floor and ceiling.* The same none ceiling. autoplan's cheapest re-size rung of any size prices at $2,810 alone.

A retest needs an unattended told session in which the procedure runs where the detector can see it, at a cost a $2,000 line can power, and tasks with headroom.

**Spend**

Each stage settled through its own ledger lease on the envelope host (settle.txt). Every model-call stage settled 24 sessions with unknown $0.00 and ended completed.

| Item | Charged to | Lease | What settled | Settled | Cap | Share of cap |
|---|---|---|---|---|---|---|
| g-none | split evenly | g-none.0001.71e654 | 24 sessions | $28.844138 | $229 | 12.6% |
| g-pe | plan-eng-review | g-pe.0001.119680 | 24 sessions | $200.244453 | $572 | 35.0% |
| g-ap | autoplan | g-ap.0001.a5483c | 24 sessions | $455.225669 | $1,287 | 35.4% |
| g-vm | split evenly | g-vm.0001.e9156d | 19.063 host hours at $0.30 | $5.718900 | $24 | 23.8% |
| **Admission** | | | | **$690.033160** | **$2,112** | 32.7% |

The host hours run from T-G's seal at 2026-11-05T22:57Z to the driver's exit at 2026-11-06T18:00:46Z. Model calls came to $684.31. Split by the charge column, admission's paid spend is $217.53 for plan-eng-review and $472.51 for autoplan. T-G's own stage settled separately, as the readiness post records.

**The wave 1 envelope**, exported from the host before teardown, reads $1,388.91 settled against the $10,000 program cap, with nothing open: plan-eng-review $566.96, autoplan $821.94 (each rounded to the cent), and the other four skills $0. These figures cover the crew rows as recorded on the ledger, which lag the live thread counters. This post's own crew cost counts half to each skill's $2,000 line and is not in them.

**Prices.** Opus 5.5 in dollars per million tokens, from src/runner/pricing/prices.ts at the run commit, as the proxy used them on 2026-11-05 and 2026-11-06: input 4, output 20, cache read 0.20, cache write 5. The envelope host settles at $0.30 an hour, the Captain's reserve rate; Ubicloud's list rate for its shape is about $0.25 an hour. Per-arm token totals are not in the export; the dollar figures are the ledger's.

</details>
