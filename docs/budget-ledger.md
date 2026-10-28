# The budget ledger

gstack-evals spends money only through its ledger, against a cap a human approved in their own words. This page is the guide for people who record approvals and for code that spends. The design is plan v3.2, "Where the ledger lives" and "Admission without a shared lock", and interface v0.4, "Spend and ledger".

The ledger records an approval. It cannot verify one: whoever runs `ledger init` vouches that the words are the owner's.

## Two tiers

| Tier | Flag | Variable | Default | What it holds |
|---|---|---|---|---|
| Approval record | `--ledger-record <dir>` | `GSTACK_EVALS_LEDGER_RECORD` | `$XDG_STATE_HOME/gstack-evals/record/` (else `~/.local/state/gstack-evals/record/`) | Approvals, leases and lease closes, one write-once JSON file each. Totals are sums over the files. It may live on a Capy drive. |
| Local ledger | `--ledger <path>` | `GSTACK_EVALS_LEDGER` | `$XDG_STATE_HOME/gstack-evals/ledger.sqlite`; on Capy `~/.capy/work/gstack-evals/ledger.sqlite`; else `~/.local/state/gstack-evals/ledger.sqlite` | A SQLite file that holds one lease's calls against the lease's amount. Never the OS temp dir. |

Only the local ledger is refused on a network or FUSE mount (E_LEDGER_PATH), because SQLite's lock does not hold there. `gstack-evals ledger status` prints both resolved paths and the rule that chose each.

The record's files live at `<record>/items/<item>/approval-0001.json`, `lease-0001.json`, `close-0001.json` and so on. Each one is written aside, fsynced and linked into its slot, so it appears whole, and it is read back after it lands. A Capy drive does not support links, so there the file is created exclusively instead. Never edit or delete a record file. A file that does not parse stops the item with E_LEDGER_RECORD until a human repairs it.

Money is integer micro-dollars (1 USD is 1,000,000 micros) in every file and table, so sums never drift against a cap. The CLI takes and prints dollars with up to six decimals.

## Recording an approval (a human runs this)

When a command stops with E_LEDGER_MISSING, a human approves a cap and records it with their exact words. On Capy, a crew thread asks its Captain through a needs-you report, and the Captain records the reply.

```
gstack-evals ledger init --cap 130 --item lanea-quick --admission required \
  --words "Rec" --source "gate 1 of plan v3.2, approving the \$500 first cap" \
  --words "It should be fast like this week" --source "2026-10-28 message moving the quick looks up" \
  --by "Garry Tan"
```

- `--item` names the line item: lowercase letters, digits, dots, dashes and underscores.
- `--admission required|warn` is explicit on every init and never changes. A program-funded run uses `required`; a caller's own run, such as a skill diet's Lane A check on its own budget, uses `warn`. See "Admission" below.
- Each `--words` is one quote. Give `--by` and `--source` once for every quote, or once per `--words` in the same order.
- `init` records the item's first cap; `ledger raise` takes the same flags except `--admission` and records a higher one. Running the same command again changes nothing.
- Each quote is mirrored through gstack's `gstack-approvals add` first, so the words also reach the thread's approvals table. Nothing is written to the record until the mirror succeeds. Any failure or absence of gstack-approvals is E_APPROVAL_RECORD, naming the binary, its exit and its APPROVAL_RECORD_* code. Pass `--branch <name>` on a detached checkout. `GSTACK_EVALS_APPROVALS_BIN` overrides where the binary is found.

## Line items and runs

An approved cap is split into line items, and each line item funds one run. A drive has no atomic write, so this is how two machines avoid spending the same money: they never share an item.

- The first lease on an item binds it to that lease's run. Another run asking for it gets E_ITEM_BOUND. So one cap cannot fund a second run to change a verdict.
- A lease records its id, machine id, amount and expiry. By default it takes everything the item has left and lasts 24 hours.
- Only one lease on an item is open at a time. A replacement worker cannot lease until the old lease is settled or reconciled (E_LEASE_UNSETTLED).
- When a lease runs out, a call is refused with CAP_STOP. When a lease has expired or been settled, it is E_LEASE_CLOSED. Either way, the run settles its lease and resumes on a new lease for the same run.
- When the item itself has nothing left, a new lease is CAP_STOP until the owner raises the cap.

```
gstack-evals ledger lease --item lanea-quick --run <run id> [--amount <usd>] [--ttl <hours>]
gstack-evals ledger settle --lease <lease id>
gstack-evals ledger status [--item lanea-quick]
```

## Admission

Admission is the rig check before money (GSTA-8's CI plan, decision 3). The ledger checks it at the lease, the one boundary Lane A, the replay lane, direct-API arms and judge calibration all cross.

- An item's admission mode is recorded with the owner's words in its first approval file, `items/<item>/approval-0001.json`, as `{ item, admission }` with `admission` set to `required` or `warn`. U2's preregistration check reads those two fields.
- Before a lease is written, the ledger looks for the admission record for that lease's slot, `items/<item>/admission-<slot>.json`. It must name the same item, slot, run and machine as the lease.
- On a `required` item, a missing or mismatched record refuses the lease with E_RIG_UNPROVEN, and nothing is leased. On a `warn` item the lease goes ahead, and the RIG_UNPROVEN warning is printed and returned with the lease.
- The ledger checks only that the record exists and matches. What the record must prove, and the command that writes it, are U20's. `openLease` takes a `requireAdmission` function for that, which defaults to the existence check.
- A new lease after a settle or reconcile is a new slot, so it needs its own record.

## Settling, and when a machine is lost

`ledger settle` closes a lease into the record from the machine's local ledger. It counts settled calls at their cost and every call with an unknown outcome at its full reservation. Settle is idempotent by lease id. The close is fixed in the local ledger before it is written, so a retry after a lost acknowledgement finds the same bytes already in place. A settle that cannot reach the record exits 2 with E_LEASE_UNSETTLED, and the lease stays reserved until the retry succeeds.

A lease whose machine or local ledger is gone stays reserved in full. It is never released silently. Once the lease has expired, so the old machine can admit no more calls even if it comes back, the owner settles it from the provider's usage export:

```
gstack-evals ledger reconcile --lease <lease id> --spent 3.10 \
  --words "<owner's exact words>" --by "<who>" --source <provider usage export file>
```

`--source` must be the export file. The close records the figure, the words, the export's path and its sha256. A lease closes once. A later settle or reconcile with a different outcome is E_SETTLE_CONFLICT, and the first close stands.

## Counted runs in the sealed workflow

The sealed repo's workflow belongs to the second principal and cannot reach a Capy drive, so its lease travels as files:

1. The thread leases the item for the workflow and exports it: `ledger lease --item <item> --run <run id> --machine workflow:<name> --export lease.json`. It passes lease.json as a dispatch input.
2. The workflow holds the lease in its own local ledger with `ledger lease --from lease.json`, spends against it with provider keys from its protected environment, and writes a settle artifact with `ledger settle --lease <id> --artifact settle.json`.
3. The thread copies the artifact into the record with `ledger settle --from settle.json`.

If the export file is lost before dispatch, `ledger lease --lease <id> --export <file>` writes it again. A failed `--export` write records no lease.

The workflow's local ledger is the lease's journal, and the ledger cannot see across workflow attempts. So the workflow must keep that file across attempts of the same dispatch, for example as an artifact keyed by the lease id. It must not start an attempt on a fresh runner with the old lease file. A fresh runner needs a new lease, exported after the old one is settled or reconciled. Otherwise a rerun could spend the same allowance twice, and the record would see the second settle only as E_SETTLE_CONFLICT, after the money is gone. `ledger lease --from` refuses a lease that its own ledger has already settled.

## On Capy

Keep the local ledger at its default under `~/.capy/work/gstack-evals/` and point the record at your Captain drive, for example `GSTACK_EVALS_LEDGER_RECORD=~/.capy/drive/<captain drive>/ledger-record`. The local ledger file is the run's journal of reservations. If the machine is replaced, its lease stays reserved until `ledger reconcile` records the owner's settlement.

## In code

`src/runner/ledger/ledger.ts` has `recordApproval`, `openLease`, `settleLease`, `reconcileLease`, `exportLease`, `importSettlement` and `ledgerStatus`. `LocalLedger` in `src/runner/ledger/local.ts` implements `ReservationLedger` from `src/types.ts`:

- `reserve({ idempotency_key, lease_id, cell, max_micros })` holds the call's real maximum. The same key with the same request returns the first reservation. With a different request it is refused with E_RESERVE_CONFLICT.
- `settle(reservation_id, outcome)` records the cost, or `unknown`, which keeps the full charge. The same outcome again returns the same reservation. A different one is refused with E_SETTLE_CONFLICT.

`openLease` takes `requireAdmission`, the seam U20 fills, and a `warn` callback for RIG_UNPROVEN.

## Reason codes

[CAP_STOP](errors.md#cap_stop), [E_LEDGER_MISSING](errors.md#e_ledger_missing), [E_LEDGER_PATH](errors.md#e_ledger_path), [E_LEDGER_RECORD](errors.md#e_ledger_record), [E_LEASE_UNSETTLED](errors.md#e_lease_unsettled), [E_LEASE_CLOSED](errors.md#e_lease_closed), [E_ITEM_BOUND](errors.md#e_item_bound), [E_RIG_UNPROVEN](errors.md#e_rig_unproven), [RIG_UNPROVEN](errors.md#rig_unproven), [E_APPROVAL_RECORD](errors.md#e_approval_record), [E_RESERVE_CONFLICT](errors.md#e_reserve_conflict), [E_SETTLE_CONFLICT](errors.md#e_settle_conflict). Every error line on stderr starts with its code.
