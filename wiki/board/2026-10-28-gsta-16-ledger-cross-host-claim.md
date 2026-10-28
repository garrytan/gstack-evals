---
id: 2026-10-28-gsta-16-ledger-cross-host-claim
kind: finding
title: The ledger's slot claim has one winner per host, not across hosts on a synced drive
summary: Two hosts claiming one record slot on a syncing drive can both win, first leases included. M0 leases each item from one host; a cross-host claim must land before multi-host counted runs.
author: GSTA-16
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: open
links:
  - src/runner/ledger/record.ts
  - docs/budget-ledger.md
  - https://github.com/garrytan/gstack-evals/pull/10
  - https://github.com/garrytan/gstack-evals/pull/14
---

# The ledger's slot claim holds within one host

## What we found

The approval record is a folder of write-once files. A writer claims a slot, such as `lease-0001.json`, by linking its file into place or, on a Capy drive, by exclusive create. A second writer of the same slot finds the first file and refuses. That gives each slot one winner within one host.

A drive that syncs files between machines may not enforce exclusive create across them. Two hosts that claim the same slot at the same moment can each see an empty slot, each write, and each succeed. The binding of a line item to one run is itself such a claim: it is the item's first lease. So two runs on two hosts could each bind the same item and each lease its full cap.

The /ship review of PR #10 raised this three times: the red team, the native adversarial pass, and the outside voice (its F1). No live drive race was run, so this rests on reasoning about the drive, not a repro.

## What M0 does

GSTA-2 accepted the per-host guarantee for M0: "M0 ledger guarantees one writer per host; counted runs on one line item lease from one host until a cross-host claim lands." The record.ts header and docs/budget-ledger.md state this rule.

## What has to happen before any multi-host counted run

A cross-host claim, so that exactly one host can win a slot whatever the drive does. Candidates:

1. **A single-host record.** One machine owns the record and the others ask it to write, so exclusive create is enforced in one place.
2. **An authoritative claim.** Make the claim somewhere that has compare-and-swap, for example a git push to a claims branch, where a non-fast-forward push loses.

Whichever is chosen needs a test that races two hosts against the real store, not just two processes on one host.
