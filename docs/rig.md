# The rig proof

gstack-evals proves its rig before it spends money (GSTA-8's CI plan, decision 3; unit U20). A line item recorded with `--admission required` leases only when an admission record for that lease's slot is green, current and written on the machine that will spend. This page says what the record proves, how a Captain writes one, and what makes a lease refuse.

The ledger side, where the lease reads the record, is in [budget-ledger.md](budget-ledger.md#admission). Reason codes are in [errors.md](errors.md).

## What a record proves

Every record holds one proof set, the one the preregistration names.

| Proof set | Used by | The workflow run it needs | The probes it runs on the spending machine |
|---|---|---|---|
| `trial` | arms in src/trial: Lane A and its judge calibration (U11, the agentic arms of U16 and U18) | a green `rig.yml` run, the Docker tier, on a push or a dispatch, whose commit has this checkout's tree, and whose tier summary is GREEN at the same tree and recipe hash | R5 egress (`r5.*`) and R6 sealed store (`r6.*`), from an agent container on the trial network |
| `direct` | direct-API runs, judge calibration on its own, the replay lane | a green `ci.yml` run on a push or a dispatch whose commit has this checkout's tree | the replay lane's fake-upstream tests (`replay.fake-upstream`) |

Each record also holds the line item, the lease slot, the run it admits (none for an item's first lease, whose run id is minted when the run starts), the machine id, the host fingerprint (platform, kernel, Bun and, for `trial`, the Docker engine), the preregistration's path and sha256, and an expiry 24 hours after admission. Admission makes no model call and needs no key.

### Why only push and dispatch runs admit

A push or dispatch run of `rig.yml` takes its workflow file from the commit it tests, so the steps that ran the tier and wrote its annotation sit inside the tree being proven. A pull request's run takes its workflow file from the PR's merge commit instead, and a PR may target any branch. A PR whose head commit has exactly main's tree, aimed at a branch whose `rig.yml` only prints a GREEN summary, would otherwise produce a run with the right path, repo, tree and conclusion. So `rig.yml` still runs on pull requests to give reviewers a signal, but those runs never admit. `ci.yml` follows the same rule for the `direct` set.

`rig admit` reads the tier summary from the tier job's annotation (title `gstack-evals-rig-tier`) through GitHub's REST API, because the Capy git proxy refuses artifact downloads. The run still uploads `rig-tier.json` and the JUnit report as an artifact for people. Exactly one such annotation must be present.

## Commands

```
gstack-evals rig tier --out <dir>
gstack-evals rig probes --proof trial|direct
gstack-evals rig admit --item <name> --proof trial|direct --prereg <file> [--run <id>] [--check-run <id>] [--repo <owner/name>] [--ledger-record <dir>]
```

- `rig tier` runs stage m1b of gate/manifest.json with every credential-looking variable removed from the env, and writes `<dir>/rig-tier.json` beside the JUnit report. It is GREEN only when the tests exit 0, every expected test file has passing cases and no case failed or was skipped. RED exits 2 with E_RIG_RED.
- `rig probes` runs the proof set's probes on this machine, prints each result and writes nothing.
- `rig admit` gathers the proof set for the item's next lease slot and writes the record, green or red. Green exits 0; red exits 2 with E_RIG_RED, and a lease on that slot refuses. When the proof cannot be gathered (uncommitted changes, no finished run at this commit, GitHub unreadable) it writes nothing and exits 2 with E_RIG_PROOF; when the probes cannot start it exits 2 with E_RIG_PROBE. Running it again while a green record still holds prints that record and writes nothing.
- `--check-run` names a workflow run id instead of the newest green run at this commit. A named run is checked by the same rules.
- GitHub is read with `gh` (`GSTACK_EVALS_GH_BIN` overrides it), Docker with `GSTACK_EVALS_DOCKER_BIN` or `docker`.

## Admitting a U11 item, step by step

U11 (the Lane A shakedown, [its preregistration](../wiki/plans/2026-10-30-gsta-42-lanea-shakedown-prereg.md)) records each call's line item with `--admission required`, so every call needs a green `trial` record before its lease. Do this for each item, the `c` calibration items included, just before its call, on the machine that will run it.

1. Check out the commit the run uses, with nothing uncommitted. The run's `--out`, ledger and state directories go outside the checkout or under ignored paths, because the record binds to the checkout's tree with untracked files included.

   ```
   cd <gstack-evals checkout> && git fetch origin main && git checkout --detach origin/main
   git status --porcelain   # must print nothing
   git rev-parse HEAD
   ```

2. Find a green `rig.yml` push or dispatch run at that commit.

   ```
   gh run list --repo garrytan/gstack-evals --workflow rig.yml --commit "$(git rev-parse HEAD)" --json databaseId,event,status,conclusion
   ```

   A push to main that touched a rig path ran one on its own. If none is listed, or only `pull_request` runs are, start a dispatch run on main and wait for it (about 20 minutes, no model spend):

   ```
   gh workflow run rig.yml --repo garrytan/gstack-evals --ref main
   gh run list --repo garrytan/gstack-evals --workflow rig.yml --event workflow_dispatch --limit 1 --json databaseId,headSha
   gh run watch <databaseId> --repo garrytan/gstack-evals --exit-status
   ```

   The dispatch tests main's head when it starts. If its `headSha` is not your checkout's commit, main moved: check out the new head and go back to step 1.

3. Record the line item, if it is not recorded yet, with the owner's words and `--admission required` ([budget-ledger.md](budget-ledger.md#recording-an-approval-a-human-runs-this)).

4. Admit the item on the run machine, with the same `--ledger-record` the call will use. Unset provider keys first; admission needs none.

   ```
   env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u OPENROUTER_API_KEY \
     bin/gstack-evals rig admit --item lanea-shakedown-<row> --proof trial \
     --prereg wiki/plans/2026-10-30-gsta-42-lanea-shakedown-prereg.md --ledger-record <record>
   ```

   It prints `ADMIT: green item=... slot=1 attempt=1 proof=trial run=none machine=... tree=... recipe=... expires=...`, the record's path, the run it read and each probe. On `ADMIT: red`, read the problems it prints, fix the rig or get a green run, and admit again.

5. Start the call within 24 hours, from the same checkout on the same machine, without editing the checkout or upgrading Docker in between. The lease checks the record against the tree, recipe hash and host as they stand.

6. If the run needs a second lease (after CAP_STOP, an expiry or a reconcile), that lease is slot 2: admit again. The record then names the item's bound run. A lease on a new machine after a reconcile is admitted on that machine.

## What refuses a lease

On a `required` item the lease refuses with E_RIG_UNPROVEN, and nothing is leased, when the slot's latest record:

- is missing, does not parse, or names another item, slot or attempt than its file name;
- is red: a failing, missing or `pull_request` workflow run, a RED tier summary or none or more than one, a failing or missing probe;
- holds the other proof set than the entry point asks for (Lane A asks for `trial`, the replay lane for `direct`; `gstack-evals ledger lease` takes either);
- names another run, or names no run on a slot after the first;
- was written on another machine;
- is stale: older than 24 hours, or the checkout's tree (uncommitted and untracked files included), the recipe hash or the host fingerprint changed;
- cannot be read or checked at all.

On a `warn` item, such as a caller's own Lane A run, the same checks print the RIG_UNPROVEN warning and the lease goes ahead. An item recorded without an admission mode is not checked.

## Attempts: the latest decides

A record is write-once. The first attempt for slot 1 is `items/<item>/admission-0001.json`; a later attempt at the same slot is written beside it as `admission-0001.2.json`, `admission-0001.3.json` and so on, and the highest attempt decides. So a red attempt never strands an item, and a green attempt older than a red one never admits. Only names `rig admit` writes count as attempts, and a file whose `attempt` field differs from its name's counts as a record that does not parse, so copying an older green record to a higher name does not admit either. Never edit or delete a record file.

## Disk space

A real-host call fills two places: the state root (`~/.capy/work/gstack-evals` on Capy, `$XDG_STATE_HOME/gstack-evals` or `~/.local/state/gstack-evals` elsewhere) and Docker's root dir. GST-361 measured U11's /learn call on a Capy machine: base gstack@7204a39a27ba, arms before, after and none.

| What | Where | Size | After the run |
|---|---|---|---|
| Arm installs: three gstack trees of about 1.2 GB each, and two small overlays | `<state>/installs/` | 3.6 GB on Claude Code, 3.6 GB on Codex | Deleted |
| Layer trees kept by digest | `<state>/retained/trees/` | 1.2 GB | Kept |
| Trial image tar | `<state>/retained/images/` | 0.8 GB, once per trial image | Kept |
| Arm images, calibration copies and their build cache | Docker's root dir | 5.9 GB | Kept |

The peak is about 11.6 GB when both places share a filesystem: 5.7 GB under the state root and 5.9 GB under Docker's root dir. Preflight refuses a real-host call with E_DISK_LOW, before any lease, when the state root's filesystem has less than 10 GB free or Docker's has less than 10 GB, or less than 20 GB when they share one, as they do on Capy. Each share is the measured peak with about 70% headroom, which covers a fourth gstack install (about 3.9 GB with its tree and images) and the trials' own files. The fake host and `--dry-run` skip the step.

**Installs.** A run holds every install entry it uses. When it ends, and when its start fails after the installs, it deletes the entries it built, with their logs, unless another run still holds them; then the last run to let go deletes them. Entries a run only reused stay, so a cache someone kept is not touched. A run that dies (killed, or a machine that slept) keeps its installs, and `--resume` takes over its claim and deletes them when it ends. A resume after a run deleted its installs reinstalls them, about 1.5 minutes for three gstack trees. Reinstalls are byte-identical, so every journaled cell keeps its session key: measured for U11's arms on both hosts, and `tests/arms/gstack-reinstall.test.ts` repeats the check with `GSTACK_EVALS_DOCKER=1 GSTACK_EVALS_GSTACK_SOURCE=<a gstack clone>`.

**What stays.** Retained trees and the trial image tar are a run's provenance, kept by digest, and Docker keeps the arm images and build cache. A call with a new arm set still leaves about 7 GB. Between calls, `docker builder prune` and `docker image rm` of `gstack-evals-arm` images no run needs reclaim most of it; archive `<state>/retained/` before deleting any of it. Delete `<state>/installs` by hand only while no run is going.

## Where the Docker tier runs

- On GitHub: `.github/workflows/rig.yml` runs on pull requests and main pushes that touch a rig path, and on `workflow_dispatch`. Its token is read-only, it reads no secret and it posts no check of its own.
- Before a push: a pregate guard in `.gstack/pregate.json` (`rig-docker-tier`) runs `GSTACK_EVALS_DOCKER=1 bun test tests/rig` when a change touches a rig path.
- Locally: `GSTACK_EVALS_DOCKER=1 bun test tests/rig`, or the whole tier with `bin/gstack-evals rig tier --out <dir>`, on a machine with Docker. Docker tests skip without `GSTACK_EVALS_DOCKER=1`, and the tier counts a skipped case as RED.
