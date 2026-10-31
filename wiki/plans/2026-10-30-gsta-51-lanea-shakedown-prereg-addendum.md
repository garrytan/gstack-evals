---
id: 2026-10-30-gsta-51-lanea-shakedown-prereg-addendum
kind: plan
title: "Lane A shakedown preregistration, addendum 1: rig commit 464209c and the rig-admission step"
summary: "Amends U11's prereg in two places: the rig moves from c88f326 to 464209c (#78) or a later main commit, and each line item is admitted with rig admit before its first lease."
author: GSTA-51
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-30
status: superseded
supersedes: [2026-10-30-gsta-42-lanea-shakedown-prereg]
links:
  - 2026-10-30-gsta-42-lanea-shakedown-prereg
  - 2026-10-30-gsta-49-u20-rig-admit-handoff
  - https://github.com/garrytan/gstack-evals/pull/78
  - https://github.com/garrytan/gstack-evals/blob/464209c52221832222654e59db3600d365a4d9cd/docs/rig.md
  - docs/rig.md
---
# Lane A shakedown preregistration: addendum 1

GSTA-51, for the gstack-evals Captain (GSTA-2), issue GST-280. This post amends [the Lane A shakedown preregistration](2026-10-30-gsta-42-lanea-shakedown-prereg.md) (merged in #74 as 3ea75fa) in two places: the rig commit and the order of work. Read the two posts together. On those two points this post governs. Everything else in the preregistration stands as written: the caps, the $480 stop, the expected spend, the arms, cells, rungs, tasks, locks, judge, persona and stop rules.

Garry has not approved U11's cap. The preregistration's rule still holds: no paid call, calibration included, runs before he approves the cap and the Captain confirms the pushed commit.

## 1. Rig commit

**Was:** gstack-evals main at c88f3263853926d2c6faf329507b381493530a15, #71's merge commit.

**Now:** gstack-evals main at 464209c52221832222654e59db3600d365a4d9cd, #78's merge commit (U20: the Docker tier in rig.yml and `gstack-evals rig admit`), or a later main commit. Every call runs from the same commit (see the first point under "Where docs/rig.md and the preregistration disagree"). The run notes and the results name that commit.

**Why.** Every shakedown line item is recorded with `--admission required`, so each lease needs an admission record for its slot. At c88f326 the lease check (`admissionRecordExists` in src/runner/ledger/ledger.ts) accepts a record only when it names the lease's run id, and nothing at that commit writes records. `rig admit` (#78) writes them, but the record for an item's first lease names no run, because the run id is minted when the run starts. So at c88f326 no shakedown item could take its first lease. At 464209c the lease check is `rigAdmission()` in src/rig/admission.ts, which accepts a record with no run on slot 1.

**What else changed.** c88f326 is an ancestor of 464209c. Between them, the code a shakedown call runs changed only in #78: the new src/rig/ commands, the lease check in src/runner/ledger/ledger.ts, the lease call in src/skill-eval/cli/run-host.ts (which now asks for the `trial` proof), the command table and the reason codes. policy/models.json (sha256 a00180abac95) and the rest of src/, including the adapters, trial, usersim, proxy and skill-eval code, are unchanged. So #71's knobs and the preregistration's allowances, price rows and worst cases still hold. The vendored tasks and locks landed with #74, after c88f326, so they are in 464209c's tree and were not in c88f326's.

**The task locks do not depend on the rig commit.** A lock records the sha256 of the tasks file, the ext file, the policy file, each file of the before skill, the contract-line extractor and the question classifier. None of these differs between c88f326 and 464209c. Rebuilt at 464209c with `gstack-evals skill-eval --lock`, on copies of the committed tasks files (office-hours with `--ext`) and before folders exported with `git archive` (learn at 398618259d56, office-hours at cd4fc4be73d8), both locks came out byte-identical to the committed ones:

| File | sha256 |
|---|---|
| learn/tasks.lock.json | d567ce8745017cbcf1f81b1c6a732be557a47856ff3ad16f586308e8e6f2a24d |
| office-hours/tasks.lock.json | 070c69f90b457d9026825509be509fa99c8ca6c1090d0b5b8090e926f659739d |

If a later main commit changed the extractor, the classifier or the policy file, preflight's lock step would stop the call with LOCK_DRIFT before any spend.

## 2. Order of work: the rig-admission step

The preregistration's order of work gains one step inside its step 3: before each call, and so before its line item's first lease, admit that item. This covers every `lanea-shakedown-<row>` item and every `lanea-shakedown-<row>c` calibration item. The commands are docs/rig.md's at 464209c, from its section "Admitting a U11 item, step by step" ([pinned copy](https://github.com/garrytan/gstack-evals/blob/464209c52221832222654e59db3600d365a4d9cd/docs/rig.md#admitting-a-u11-item-step-by-step)). Run them on the machine that will spend, after the setup in step 2 (the CLIs, `gstack-evals doctor`, the gstack clone and the arm folders).

1. **Check out the run's commit with nothing uncommitted** (docs/rig.md step 1). Keep the run's `--out`, ledger and state directories, and the arm folders, outside the checkout or under ignored paths, because the record binds to the checkout's tree with untracked files included.

   ```
   cd <gstack-evals checkout> && git fetch origin main && git checkout --detach origin/main
   git status --porcelain   # must print nothing
   git rev-parse HEAD
   ```

2. **Confirm that a green rig.yml run covers that tree** (step 2). Only a `push` or `workflow_dispatch` run admits. Pull-request runs never do.

   ```
   gh run list --repo garrytan/gstack-evals --workflow rig.yml --commit "$(git rev-parse HEAD)" --json databaseId,event,status,conclusion
   ```

   If none is listed, or only `pull_request` runs are, dispatch one on main and wait for it (about 20 minutes, no model spend):

   ```
   gh workflow run rig.yml --repo garrytan/gstack-evals --ref main
   gh run list --repo garrytan/gstack-evals --workflow rig.yml --event workflow_dispatch --limit 1 --json databaseId,headSha
   gh run watch <databaseId> --repo garrytan/gstack-evals --exit-status
   ```

   If the dispatch's `headSha` is not the checkout's commit, main moved: go back to step 1.

3. **Record the line item** (step 3), as the preregistration already says: the Captain runs `gstack-evals ledger init --admission required` with Garry's words, just before the call.

4. **Admit the item** (step 4), with the same `--ledger-record` the call will use and the provider keys unset:

   ```
   env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u OPENROUTER_API_KEY \
     bin/gstack-evals rig admit --item lanea-shakedown-<row> --proof trial \
     --prereg wiki/plans/2026-10-30-gsta-42-lanea-shakedown-prereg.md --ledger-record <record>
   ```

   For a calibration item, `<row>` is the row number followed by `c`, as in `lanea-shakedown-3c`. `--prereg` names the preregistration itself, as docs/rig.md does. A green record prints `ADMIT: green item=... slot=1 ...`. On `ADMIT: red` the lease would refuse with E_RIG_UNPROVEN: fix the cause, get a green run and admit again. No call starts without a green record.

5. **Start the call within 24 hours** (step 5), from the same checkout on the same machine, without editing the checkout or upgrading Docker in between.

## Where docs/rig.md and the preregistration disagree

Two points. Both resolve in the preregistration's favour, so its pin, caps and stop rules hold.

1. **One rig commit for the run.** The preregistration pins one rig commit for every call. docs/rig.md step 1 checks out `origin/main` again for each item, so if main moved during the run, later calls would run a newer rig than earlier ones. Resolution: every call runs from the commit the first call was admitted at. Run step 1 in full for the first item only. For each later item, run its last two lines in the same checkout and confirm that HEAD is still that commit. Step 2 should then list the green run the first item used.

2. **No second lease after a cap stop.** docs/rig.md step 6 names CAP_STOP as one reason a run takes a second lease and admits again. The preregistration says "A cap stop at any point means an incomplete run, reported as one and never retried to change a verdict." Resolution: no shakedown item takes a second lease after a cap stop. If a call needs a second lease after an expiry or a reconcile, docs/rig.md step 6 applies: admit that slot before it.
