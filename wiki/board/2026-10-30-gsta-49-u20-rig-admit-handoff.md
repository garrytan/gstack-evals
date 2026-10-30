---
id: 2026-10-30-gsta-49-u20-rig-admit-handoff
kind: handoff
title: "U20's first PR: rig admit and the Docker tier, handed to U11 and U21"
summary: "What U11 runs to admit each required line item, why U11 must run from a main commit with U20, and what U21 picks up. PR runs never admit; push and dispatch runs do."
author: GSTA-49
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-30
status: open
links:
  - 2026-10-28-gsta-8-ci-evals-e2e-plan
  - 2026-10-30-gsta-42-lanea-shakedown-prereg
  - docs/rig.md
  - docs/budget-ledger.md
---

# U20's first PR: rig admit and the Docker tier

GSTA-47 built most of U20's first deliverable and GSTA-49 finished it. It adds `.github/workflows/rig.yml` (stage m1b, the Docker tier), `gstack-evals rig tier | probes | admit`, the `rig-docker-tier` pregate guard and [docs/rig.md](../../docs/rig.md). The ledger's lease now checks a real admission record through `rigAdmission()`.

## For U11 (the Lane A shakedown)

- Every shakedown line item is `--admission required`, so each call, the `c` calibration items included, needs a green `trial` record for its lease slot. docs/rig.md, "Admitting a U11 item, step by step", has the commands.
- Run from a main commit that includes this PR. The preregistration pins the rig at c88f326 (#71's merge commit), which has no `rig admit`, and its lease check wants a record that names the run, which a first-lease record cannot, since the run id is minted when the run starts. A record also binds to the checkout's tree, so the run must start from the checkout that was admitted. Whether the new rig commit needs a note or an amendment to the preregistration is the Captain's call.
- Admission needs a green `rig.yml` push or dispatch run at the run's commit. A main push that touches a rig path runs one; for any other main tree, `gh workflow run rig.yml --ref main` starts one (about 20 minutes, no model spend).
- Admit on the run machine, just before each call. A record holds 24 hours and goes stale when the tree, the recipe hash or the host (kernel, Docker engine) changes. Keep `--out`, the ledger and state directories outside the checkout, since untracked files count toward the tree.
- A second lease in the same run (after CAP_STOP, an expiry or a reconcile) is a new slot and needs its own record.

## For U21 (interface registry, nightly drift check, verify)

- New reason codes owned by U20: E_RIG_PROOF, E_RIG_PROBE and E_RIG_RED, all exit 2. E_RIG_UNPROVEN and RIG_UNPROVEN keep their U4 meaning.
- A new command row, `rig`, with `tier --out`, `probes --proof` and `admit --item --proof --prereg [--run] [--check-run] [--repo] [--ledger-record]`, each with `--json`. The registry should list them.
- The verdict's rig block and the stage-0 receipt are U20's second PR, not this one, so verify --promote has no rig block to read yet.

## Still open in U20

The stage-0 receipt (the run's calibration bound to the host fingerprint and recipe hash) and `rig reconcile` against provider usage exports. Both are U20's second PR.

## Choices made on the way

- admit reads the tier summary from the tier job's annotation through the REST API, because the Capy proxy refuses artifact downloads.
- Only push and dispatch runs admit, because their workflow file sits in the tree they prove. A pull request's run takes its workflow file from the PR's merge commit, whose base can be any branch, so a PR could otherwise prove main's tree with a rig.yml that only prints GREEN. The Captain chose this on 2026-10-30.
- A red attempt does not strand a slot. A later attempt is written beside it and the highest attempt decides. A record whose attempt differs from its file name does not count.
