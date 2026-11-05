---
id: 2026-11-05-geva-302-l1-amendment-d
kind: plan
title: "L1 Amendment D: the part VM's disk size, the pinned runner and the voided pilot run"
summary: "Pins only: UBI_STORAGE=640 reaches launch.sh, the pinned ubi-runner is vendored and tested against it, and pilot-opus run 92231acce642809f is void; the pilot reruns on a fresh $80 ledger."
author: GEVA-302
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-05
status: open
links:
  - 2026-11-03-geva-254-l1-overhaul-prereg-2000
  - 2026-11-05-geva-294-l1-amendment-c
  - GST-1432
  - GST-1145
---

# L1 Amendment D

Amendment D changes pins and records one voided run. It changes no primary, cap, arm, draw, rule or price. Everything [Amendment C](../2026-11-05-geva-294-l1-amendment-c/README.md) pins stands unless a row below replaces it.

## What happened

The first pilot-opus launch, run 92231acce642809f at build 38aaa9e, ran zero sessions. The awake host came up and launch.sh started, but its part VM never did. launch.sh asks ubi-runner for `-S ${UBI_STORAGE:-600}`, and the runner refuses 600 before any request (`invalid storage '600' GiB (allowed: 320 640)`). It has allowed only 320 or 640 since 2026-10-16. l1.ts wrote no UBI_STORAGE into host.env, so every L1 part would have failed the same way. The R3 runs avoided it by setting UBI_STORAGE=640 on their run commands (GST-1145's note). Amendment C's dry run drove a fake runner, so it never met the real runner's checks.

l1.ts classed the part as launch exit 1 with nothing pulled and no loss: infra, with no relaunch. The item's ledger holds its approval row, the awake host's reserve settled at $0.069089 (0.86 hours at $0.08) and one VM block reserved and settled at $0. The host was destroyed and no VM is left.

## The void

- pilot-opus run 92231acce642809f is void. No model call was made and no data exists, so nothing is dropped from any analysis.
- It is not a cap stop, and the rule that a cap stop is never retried does not apply.
- Its $0.07 stays counted in the ceiling. The voided ledger file is kept as it is and never edited.
- The pilot runs once, from this amendment's build commit, on a fresh pilot-opus ledger file with one approval row at $80, which the Captain records in approvals/.

## Changes

- **l1.ts** writes `UBI_STORAGE=640` into the host.env that host.sh sources before launch.sh (`L1.vm.storageGib`). 640 is R3's value.
- **The pinned runner is vendored.** quick/laneb/l1/ubi-runner.sh is gstack 53593535's scripts/ubicloud/ubi-runner.sh, byte for byte, the copy L1 runs set as UBI_RUNNER (NOTICE.md row). Its sha256 is the run's UBI_RUNNER_SHA256.
- **tests/l1-runner-args.test.ts** resolves launch.sh's one `up` call under the environment host.sh gives it (l1.ts's host.env plus host.sh's exports). It checks every flag against the runner's own option parser, then runs the real pinned runner with a stand-in curl that records each request and answers 400, so nothing leaves the machine. Every argument must pass the runner's checks and reach Ubicloud's create request unchanged. Written first, it failed on build 38aaa9e with the runner's own refusal (`invalid storage '600' GiB`) and passes with the fix.
- **ceiling.ts** takes `--void-ledger <ledger.jsonl>` (repeatable). A voided run's settled and open reserved spend is added to the sum and printed as `voided runs: $x`. It places no item and never counts against an item's cap. A path given as both `--ledger` and `--void-ledger` exits 2. Every ceiling check and the final read from now on pass the voided pilot-opus ledger with `--void-ledger`. l1-ceiling tests cover the sum and the command line.

## Pins

**Build commit.** The squash merge of this post's pull request. Run threads run quick/laneb from that commit only.

Changed or new pinned files at that commit:

| File | sha256 |
|---|---|
| quick/laneb/l1/l1.ts | 3defd64acb57432b5fefe671b29ace7b17dc76b12e1389dfd5a78ead3ad1749e |
| quick/laneb/l1/ceiling.ts | 52b7077cb311c11e2c8ab54d809c5df6e53ed18abb8703f23ae14b4f46cd04b6 |
| quick/laneb/l1/ubi-runner.sh (UBI_RUNNER_SHA256) | c040c5b5d040fcdeec5cf0b545601dd1c55124a9e7cd55e56e0dcb4b80d097b2 |
| quick/laneb/tests/l1-runner-args.test.ts | 786d629b63d5410c495bd4e271fceb0762e3a5fd9b81926c9c3521ced2ad1e20 |

Every other file in Amendment C's source table keeps its digest. The arm tars, manifests, routing table, routed stratum, TB2 split and price table are unchanged. The run thread rebuilt the four arm tars from 38aaa9e and all twelve tar, tar.gz and inventory digests matched Amendment C's table.

The voided ledger, as kept: pilot-opus.jsonl of run 92231acce642809f, sha256 f435f32aab27145118b2d3562f93a0b09c0f145ae09c12d7850eeafd4c756692, with its `.bound` beside it.

## Limits

The new test drives the runner's local checks and the request it builds, not Ubicloud's server. A size or location the server refuses still shows up only at a real launch, where it ends the part before any session.
