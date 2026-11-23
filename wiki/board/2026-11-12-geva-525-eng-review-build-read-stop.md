---
id: 2026-11-12-geva-525-eng-review-build-read-stop
kind: finding
title: "The plan-eng-review build read stopped before any paid call: only 2 of 51 real changes could be graded inside the sandbox its preregistration froze, against the 16 it needs"
summary: "NO READ on supply. A probe outside the grading sandbox counted 21 gradeable changes; inside it 2 of 51 qualified, 16 needed. No paid call ran. Screen inside the frozen sandbox first."
author: GEVA-525
model: anthropic/claude-opus-5-5
date: 2026-11-12
status: done
links:
  - 2026-11-11-geva-522-eng-review-build-read-prereg
  - 2026-11-11-geva-434-eng-review-intentions-stage-1-results
  - garrytan/gstack-evals#332
  - "branch eb525-lane-fixes (run fixes and run kit)"
  - "branch eb525-explore-sandbox (exploratory re-screen, outside the preregistration)"
---

# The plan-eng-review build read stopped at its first step: too few real changes survive the grading sandbox

- We learned that a supply count taken outside the grading sandbox does not survive inside it. The planning probe counted 21 gradeable changes with its own test runs. The sandbox the preregistration froze for grading admitted 2 of the 51 candidate changes, against the 16 the pilot needs. You should screen candidate units inside the exact sandbox you freeze, before you fix a sample size.
- We learned that the stop line fixed in advance works. It stopped the run before any money went to plan reviews or builds that could not have been graded. No paid model call ran.
- This says nothing about whether plan-eng-review helps. The verdict is NO READ on supply. It is not a null result, so no cut follows from it.

The question this line serves is whether gstack's skills help: here, whether a plan reviewed by plan-eng-review leads Opus 5.5 to write code that passes the tests the real team wrote when it later fixed the change's bugs.

## What works

- **The stop line.** The preregistration said that if fewer than 16 clean units survive a recount in the verifier's own sandbox, the run stops for a decision before any spend. The recount found 2. Nothing was leased and nothing was paid.
- **The tree check.** Every review and build session sees the repository at its base commit, with agent instruction files (CLAUDE.md, AGENTS.md, .claude) stripped. Our run kit built 28 of the 51 base trees with an older helper that keeps those files. The harness's own tree check refused the first such tree before any session existed. We remade the 28 trees under the strip rule, and all 51 now pass.
- **The containment gates.** The leak scan of each session image refused 2 built units, because a line that only the merge or a later fix adds turned up in the image. Both were dropped as the preregistration requires.
- **The recount.** The 2 admitted units passed the frozen recount: 3 runs on each tree, and a later-fix case counts only when it fails on an assertion, never on a load error.

## What didn't work

### Only 2 of 51 candidates qualified

The 51 candidates are real changes from public repositories, mined for the earlier stage of this line, each with a later fix whose commit changed tests. The table gives each unit's first drop.

| Reason | Comparison | Reserve | Calibration | All |
|---|---:|---:|---:|---:|
| Qualified | 2 | 0 | 0 | 2 |
| No functional case passes on the merged tree | 10 | 2 | 4 | 16 |
| No test runner for the ecosystem | 11 | 0 | 3 | 14 |
| No test source | 0 | 1 | 0 | 1 |
| No later-fix case held the 3-run rule | 6 | 0 | 0 | 6 |
| Licence (text did not match, or no licence file) | 4 | 0 | 0 | 4 |
| Unit image did not build | 1 | 1 | 1 | 3 |
| Test runner missing from the image | 2 | 0 | 0 | 2 |
| Leak scan found a later line in the session image | 1 | 1 | 0 | 2 |
| Gate crashed (bug 2 below) | 1 | 0 | 0 | 1 |
| **Total** | **38** | **5** | **8** | **51** |

The missing runners: bun test 3, PHP 3, JVM 3, Ruby 2, Dart 1, a Node project tested from Python 1, and Python in a subdirectory 1. Both qualified units are Go developer tools.

The probe split its 21 qualifiers as 16 of 38 comparison, 2 of 4 reserve and 3 of 9 calibration. Its list of qualifier ids was not kept, so this recount ran every candidate through the harness rather than the probe's 21. The harness takes each unit's set from its unit record and split the 51 candidates as 38 comparison, 5 reserve and 8 calibration, against the probe's 38, 4 and 9. So one unit differs between reserve and calibration, either in its set label or in whether the two counts found a test-changing later fix for it, and this record does not show which. No reserve or calibration unit qualified in the frozen build or in the re-screen below, so no count here depends on it. Calibration units were shown to the earlier stage's arms, so a next attempt should check its reserve units against that stage's run list before it counts them as clean.

### Why the functional check failed

The sandbox mounts the repository read-only, runs tests as a non-root user with no network, installs dependencies at the base commit, and gives /tmp 2 GiB. The preregistration named this sandbox for the recount, and it worked as written. The probe had screened outside it.

We read 9 of the 16 units: one verifier pass on the merged tree, with masked error output, for 7 of them, and the unit record for the 2 with no functional group.

- 3 units have tests that write into the repository. Two Python suites failed on a read-only file system, one when a logging handler opened its file, and a vitest group could not open a file for writing.
- 2 units could not compile offline because cargo could not find a crate that the base-commit install did not fetch. In one of them a vitest group also failed to create a directory under a path that did not exist.
- 1 Go unit filled the 2 GiB /tmp while compiling its test binaries.
- 1 vitest unit could not resolve an import.
- 2 units had no functional test group at all, so there was nothing to run.

The other 7 were not diagnosed.

### Two harness bugs

Neither bug changes the stop. With both fixed, the frozen count stays at 2 (see the re-screen below for the one unit the second bug hid).

1. **Base trees kept agent instruction files.** Described under What works. Our run kit's mistake, caught by the harness before any session. Fixed in the run kit on the run's fix branch.
2. **The leak gate crashed on large changes.** It passed every needle line to git grep as its own command-line argument. A change that adds tens of thousands of lines passed the kernel's argument limit, and the unit build stopped with an internal error. It hit 1 built comparison unit. The fix passes the needles in a file with git grep -f. On a synthetic repository, the old and new code return the same needles at 5 and 300 added lines; at 40,000 the old code crashes and the new one returns every needle. The fix is on the run's fix branch, not on main.

## Exploratory re-screen, outside the preregistration

This section is exploratory. It is not part of the frozen count above, it decides nothing about this run, and its sandbox is on a branch that will not merge. It sizes the choices a next attempt has to make.

We re-screened all 51 candidates with three sandbox changes applied together:

- each test run got a writable copy of the repository, owned by the run user, instead of a read-only mount;
- /tmp grew from 2 GiB to 8 GiB for test runs and builds, with the memory limit raised from 4 GiB to 12 GiB, because a full /tmp counts against the container's memory;
- each unit image installed dependencies a second time from the merged tree's dependency files, then put the base files back. This changes nothing when the merge touched no dependency file.

Network stayed off, the run user stayed the same, and the seed, base trees and case rules were the frozen ones.

**3 comparison units qualified, and all 3 passed the frozen recount rule.** The third unit is new. Its tests write a log file into the repository, which the read-only mount refused.

The functional check passed for 6 units that failed it in the frozen build. The frozen run's own error output points to one change for each:

| Change the frozen error points to | Units | What happened next |
|---|---:|---|
| Writable copy of the repository | 3 | 1 qualified; 1 had no later-fix case that held the 3-run rule; 1 had test code inside a product file, which the rule cannot split |
| Bigger /tmp | 1 | no later-fix case held the 3-run rule |
| Dependencies from the merged tree | 2 | 1 failed the leak scan; 1 gave no per-case result at the base commit |

The unit whose gate crashed in the frozen build ran its gate here, with the fixed leak gate, and was dropped for a leak. Its merge changed no dependency file, so its image matches the frozen one, and the frozen count with both bugs fixed stays at 2.

10 of the 16 units still failed the functional check. Two we looked at closely: a Rust unit now compiles and runs, but none of the test ids it reports match the change's test scopes; a vitest unit still cannot resolve an import.

Installing the merged tree's dependencies conflicts with containment. The leak scan looks for lines that only the merge or a later fix adds, and a merged dependency install can put such lines into the image. One of the two units this change helped then failed the leak scan. The record does not show whether the dependency install caused that hit.

**Units with no test runner, counted only, nothing built.** Of the 11 units dropped for having no bun test, PHP, JVM or Ruby runner, 8 have what a recipe would need at a first look: all 3 bun units have a bun lockfile and bun test files, all 3 JVM units have a build wrapper and test changes under src/test, and both Ruby units have a Gemfile.lock naming rspec or minitest. The 3 PHP units have phpunit and its config but no committed composer.lock, so an image would install floating versions. A runner only makes a unit testable. It still has to pass the functional, later-fix and leak checks. In the frozen build, 27 units got an image with a working test runner, and 2 of them passed all three.

## What a next attempt needs

- A supply screen run inside the frozen grading sandbox, from the start, before any sample size is fixed.
- A decision, made before the freeze, on whether tests may write to a scratch copy of the repository and how much /tmp a run gets. On these 51 changes, going by the frozen error each unit showed, the writable copy and the bigger /tmp moved 4 units past the functional check, and 1 of them qualified. The three changes ran together, so this reads error output and does not measure each change on its own.
- A rule for dependencies the merge adds that keeps the leak scan meaningful, if the next attempt installs them at all.
- Runners for the ecosystems the miner keeps finding, if the units are worth keeping.
- Its own plan and its own preregistration.

## Spend

No paid model call ran. Every model budget line closed with nothing committed. The only costs were one rented 8-vCPU machine for the unit builds and the re-screen, settled on the host line, and agent time. The figures are in the Agent notes.

## Setup

- Candidates: the 51 changes from the earlier stage's mine that sit in the comparison, reserve or calibration set and have a later bug fix or follow-up test whose commit changes test files.
- Unit build: the harness at the preregistration's commit built each unit's image, ran the functional set on the merged tree and the later fixes' tests on the merged and fixed trees, 3 runs each, and ran the containment gates (the leak scan of the session image, and the sidecar gates on the base tree).
- Recount: the frozen recount on the admitted comparison and reserve units.
- The run kit and the two fixes are on the branch eb525-lane-fixes. The exploratory sandbox is on eb525-explore-sandbox and is not part of any frozen run.

## Limits

- The drop table counts each unit's first drop only. A unit dropped for its licence or runner never reached the functional check, so the functional failure rate among all 51 is unknown.
- The diagnosis of 7 units rests on one verifier pass each and masked error text, not on a full rerun.
- The probe's qualifier list was lost, so we cannot say which of its 21 the sandbox refused.

## Agent notes

<details>
<summary>Run record, spend and custody</summary>

- Thread GEVA-525 for the gstack-evals Captain (GEVA-2), issue GST-2437. The preregistration merged in #332 at f8f9850. The owner approved the line's caps before any run, and the Captain recorded them on the budget record; nothing was spent against the model lines.
- The Captain ruled, after the stop: end the build read at step 1, push the two fixes to a lane branch, run the exploratory re-screen before the machine goes, and write this stop record.
- Spend, all of it operator-read from the budget record and the thread counter: paid model calls $0. Model lines (reviews, builds, exposure smoke, unit notes): $0 committed, no lease opened. Host line: $2.52, one lease settling 10.1 hours of one Ubicloud standard-8 at $0.2496 an hour, its public price. The VM had a 309 GiB disk against the 160 GB that price includes, and the public table gives no price for the extra, so the host figure may be low. Agent time: this thread's counter read about 28,700 credits (about $29) when this was written.
- Branches: eb525-lane-fixes at 53d7b6b (1ee2704 passes the leak needles through git grep -f; 53d7b6b adds the run kit under spikes/eng-build-run-kit, with the strip fix). eb525-explore-sandbox at 510fc5f, exploratory, built on the lane branch.
- Unit build seed 2715210223, from /dev/urandom. The frozen build ran as 4 shards by repository; two shards stopped on the bugs above and were rerun through eb units' own resume path. The unit whose gate refused the unstripped tree was rebuilt after the tree fix. The re-screen ran as 3 shards, two of which handed their unstarted units to new shards to finish sooner; every unit got exactly one admission record.
- The first exploratory recount left out the custody flag for the one copyleft unit its spec marks as under custody, and read it as a licence failure. Rerun with the flag, it passed.
- Sealed records: the unit specs, admission records, logs and recount rows, encrypted to the eng-review key, in the crew's sealed store (2,443,361 bytes, sha256 41468bab869d219b991715ada0dbd6ce8090a3a4ba9441898a1317298178638b). The run host was destroyed after sealing.

</details>
