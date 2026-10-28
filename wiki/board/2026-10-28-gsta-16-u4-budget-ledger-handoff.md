---
id: 2026-10-28-gsta-16-u4-budget-ledger-handoff
kind: handoff
title: "U4 handoff: the budget ledger, its two tiers, and how later units spend through it"
summary: What U4 landed (approval record, local SQLite ledger, leases, settle, reconcile, admission, CLI, workflow round trip), the shared type change, choices made inside the plan, and open items.
author: GSTA-16
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: open
links:
  - docs/budget-ledger.md
  - src/runner/ledger/
  - src/types.ts
  - https://github.com/garrytan/gstack-evals/pull/10
---

# U4 handoff: the budget ledger

U4 is the ledger unit of the v1.0 build breakdown (M0). It shipped in two stacked PRs: the core library (#10), then the `gstack-evals ledger` command with docs. docs/budget-ledger.md is the user guide. This post is for the units that build on it.

## What landed

- **Approval record** (`record.ts`). Write-once JSON files per line item: approvals, leases and lease closes, each in a numbered slot and read back after it is written. On local disks a file is linked into its slot. A Capy drive does not support links, so there it is created exclusively. A file that does not parse stops the item with E_LEDGER_RECORD.
- **Local ledger** (`local.ts`). SQLite in WAL mode. `LocalLedger` implements `ReservationLedger`, and each reserve or settle is one BEGIN IMMEDIATE transaction. `openLocalLedger` refuses a network or FUSE mount with E_LEDGER_PATH.
- **Operations** (`ledger.ts`). `recordApproval`, `openLease`, `settleLease`, `reconcileLease`, `exportLease`, `importSettlement` and `ledgerStatus`.
- **CLI** (`cli.ts`). `ledger init|raise|lease|settle|reconcile|status`, with each approval mirrored through gstack-approvals (`approvals.ts`) before it is recorded.
- **Admission** (GSTA-8's CI plan, decision 3, approved by Garry). `ledger init` takes an explicit `--admission required|warn`, recorded in the item's first approval file. A lease on a required item is refused with E_RIG_UNPROVEN unless a matching admission record exists for its slot. A warn item gets the RIG_UNPROVEN warning. `openLease`'s `requireAdmission` is the seam U20 fills; U4 checks only that the record exists and matches.
- **Tests** (`tests/ledger/`, keyless). Two runs racing for one item, in process and across six processes. Reserves racing from four processes. A settle failure, a lost settlement acknowledgement and a lost machine. The sealed-workflow round trip, both in code and through the CLI. The conflict codes. The quick looks' approval shapes.

## The shared type change

`src/types.ts` changed for the U1 review items the Captain gave U3 and U4. GSTA-15 (U3) was told.

- Money is integer micro-dollars: `Lease.reserved_micros`, `Reservation.max_micros` and `spent_micros`, and `CallOutcome.spent_micros`.
- `reserve` takes an `idempotency_key`. Reusing a key with a different request is E_RESERVE_CONFLICT.
- `settle` returns `LedgerReply`, the same union as `reserve`. A second settle with a different outcome is E_SETTLE_CONFLICT.

## For later units

- **U3, the proxy.** Use the journaled cell attempt as the idempotency key, so a resumed call gets its first reservation back. Settle a call whose outcome is lost as `{ kind: "unknown" }`: it keeps its full charge, and a later settle with a cost is a conflict, not a correction.
- **U7, skill-eval and doctor.** Call `openLease` with the run's item and run id before any spend, and `settleLease` at the end and on a stop. Print CAP_STOP's STOP line from `ledgerStatus` and the lease. Fill the verdict's `spend` block from the lease and the item's latest approval quotes. `doctor` can print both paths with `ledgerPath` and `recordPath`, and find gstack-approvals with `approvalsBin`.
- **U13, the replay runner.** The same lease, reserve and settle calls as Lane A.
- **U11 and U16, the paid runs.** Record each line item with `ledger init --admission required` and Garry's words before the first call.
- **U2, the preregistration check.** It reads `{ item, admission }` from `<record>/items/<item>/approval-0001.json`, the item's init approval, where `admission` is `required` or `warn`.
- **U20, rig admission.** Write the admission record at `<record>/items/<item>/admission-<slot>.json` with at least `item`, `seq` (the lease slot), `run_id` and `machine_id`, and pass your own check as `requireAdmission`. `ledger status` shows how many leases an item has, so the next slot is that count plus one.

## Choices made inside the plan

None of these changes the design. Each is a reading of a line the plan leaves open.

- **Binding.** The plan says `ledger init --item` binds a line item. init takes no run id, so the item binds to the run of its first lease, and later leases must carry that run id.
- **Lease defaults.** A lease takes everything the item has left unless `--amount` says less, and expires after 24 hours (`--ttl`). An expired lease admits no new call (E_LEASE_CLOSED) but still blocks a new lease until it is settled or reconciled.
- **Calls in flight at settle.** Calls still reserved when a lease settles become unknown and keep their full charge.
- **Reconcile's `--source`.** It is the provider usage export, as in the plan's flag list. Its sha256 is recorded when it is a file.
- **Reconcile waits for expiry.** A reconcile before the lease expires is refused with E_LEASE_UNSETTLED. Until then a machine that comes back could still spend beside a replacement worker. `--source` must be the export file, and its sha256 is recorded.
- **The admission record's key.** GSTA-8's plan keys the record by lease id and reads it at lease time. A lease id carries a random suffix that only exists once the lease is written, so U4 keys the record by the lease's slot: the item and the slot number, which is the lease id without its suffix. A new lease after a reconcile is a new slot and still needs its own record, as the plan says.
- **New codes.** E_LEDGER_RECORD (the record cannot be read or written), E_ITEM_BOUND, E_LEASE_CLOSED, E_RESERVE_CONFLICT, E_SETTLE_CONFLICT and E_RIG_UNPROVEN, plus the RIG_UNPROVEN warning.
- **Existing codes.** CAP_STOP's fix now says to settle the lease before `--resume`. E_LEASE_UNSETTLED also covers a new lease asked for while an old one is open.

## Open items

- **The skill-eval flag that names a run's line item** (TODOS.md, for U4 and U7). U4 proposes `--item <name>`, matching the ledger's flag. U7 decides.
- **Parent caps.** Each line item carries its own cap and words. The ledger does not check that a cap's items sum to no more than the cap they were split from (the $500 first cap, for example). `ledger status` shows every item, so a human can check the sum.
- **The sealed workflow's journal.** The ledger cannot see across workflow attempts. If the workflow reruns on a fresh runner with the same lease file, it could spend the allowance twice, and the record sees the second settle only as E_SETTLE_CONFLICT. The workflow must keep its local ledger across attempts and take a new lease for a fresh runner (docs/budget-ledger.md). Whoever builds that workflow (M3) owns this.
- **Exclusive create on a drive.** On a Capy drive, a slot is claimed by exclusive create, which one machine enforces but the drive may not enforce across machines. The guard there is the plan's: one run per line item.
- **The quick looks' JSONL ledgers** in the Captain drive predate U4. Their approval rows fit `ledger init` (several quotes, each with its words, speaker and source) if the Captain wants them in a record.
