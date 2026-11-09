# The budget ledger

gstack-evals spends money only through its ledger, against a cap a human approved in their own words. This page is the guide for people who record approvals and for code that spends. The design is plan v3.2, "Where the ledger lives" and "Admission without a shared lock", and interface v0.4, "Spend and ledger".

The ledger records an approval. It cannot verify one: whoever runs `ledger init` vouches that the words are the owner's.

## Two tiers

| Tier | Flag | Variable | Default | What it holds |
|---|---|---|---|---|
| Approval record | `--ledger-record <dir>` | `GSTACK_EVALS_LEDGER_RECORD` | `$XDG_STATE_HOME/gstack-evals/record/` (else `~/.local/state/gstack-evals/record/`) | Approvals, leases and lease closes, one write-once JSON file each. Totals are sums over the files. It may live on a Capy drive, except a program's record (see Program envelopes). |
| Local ledger | `--ledger <path>` | `GSTACK_EVALS_LEDGER` | `$XDG_STATE_HOME/gstack-evals/ledger.sqlite`; on Capy `~/.capy/work/gstack-evals/ledger.sqlite`; else `~/.local/state/gstack-evals/ledger.sqlite` | A SQLite file that holds one lease's calls against the lease's amount. Never the OS temp dir. |

The local ledger is refused on a network or FUSE mount (E_LEDGER_PATH), because SQLite's lock does not hold there. A program's record is held to the same rule when an envelope entry is written, because an entry slot on such a mount can have more than one winner (see Program envelopes). Any other record may sit on one. `gstack-evals ledger status` prints both resolved paths and the rule that chose each.

The record's files live at `<record>/items/<item>/approval-0001.json`, `lease-0001.json`, `close-0001.json`, `stop-0001.json` and so on. Each one is written aside, fsynced and linked into its slot, so it appears whole, and it is read back after it lands. A Capy drive does not support links, so there the file is created exclusively instead. Never edit or delete a record file. A file that does not parse stops the item with E_LEDGER_RECORD until a human repairs it.

Money is integer micro-dollars (1 USD is 1,000,000 micros) in every file and table, so sums never drift against a cap. The CLI takes and prints dollars with up to six decimals.

## Recording an approval (a human runs this)

When a command stops with E_LEDGER_MISSING, a human approves a cap and records it with their exact words. On Capy, a crew thread asks its Captain through a needs-you report, and the Captain records the reply.

Before you run it, replace each angle-bracket value with the approver's own words, name and source, because the ledger records whatever you pass.

```
gstack-evals ledger init --cap 130 --item lanea-quick --admission required \
  --words "<exact words>" --source "<where the words were given>" \
  --words "<more exact words>" --source "<where the more words were given>" \
  --by "<approver>"
```

- `--item` names the line item: lowercase letters, digits, dots, dashes and underscores.
- `--admission required|warn` is explicit on every init and never changes. A program-funded run uses `required`; a caller's own run, such as a skill diet's Lane A check on its own budget, uses `warn`. See "Admission" below.
- Each `--words` is one quote. Give `--by` and `--source` once for every quote, or once per `--words` in the same order.
- `init` records the item's first cap; `ledger raise` takes the same flags except `--admission` and records a higher one. Running the same command again changes nothing.
- Each quote is mirrored through gstack's `gstack-approvals add` first, so the words also reach the thread's approvals table. Nothing is written to the record until the mirror succeeds. Any failure or absence of gstack-approvals is E_APPROVAL_RECORD, naming the binary, its exit and its APPROVAL_RECORD_* code. Pass `--branch <name>` on a detached checkout. `GSTACK_EVALS_APPROVALS_BIN` overrides where the binary is found.

## Line items and runs

An approved cap is split into line items, and each line item funds one run. A drive has no atomic write, so this is how two machines avoid spending the same money: they never share an item. The binding itself is a slot claim, which has one winner within one host. On a drive that syncs files between machines, two hosts claiming the same slot at the same moment can both win, so until a cross-host claim lands, lease each line item from one host (wiki finding `2026-10-28-gsta-16-ledger-cross-host-claim`).

- The first lease on an item binds it to that lease's run. Another run asking for it gets E_ITEM_BOUND. So one cap cannot fund a second run to change a verdict.
- A lease may also name its holder: the run directory that serves it and a nonce for the launch that opened it. The outcome-skills driver sets it, and `ledger lease` does not. A run binds to the directory of its first lease that names a holder, and a lease for that run naming another directory is refused with E_USAGE, so one directory's records hold the run's trial counts. A lease that names no holder, such as one taken by hand or written before holders existed, binds nothing and still reads.
- A cap stop is a ledger fact. When an outcome-skills stage runs out of room, the driver writes `items/<item>/stop-<slot>.json` in its lease's slot, fsynced, before it answers the 409 that reports the stop, and a none stop writes one on every stage's item. Nothing rewrites or removes it. Every close of a stopped lease carries the stop's scope as `cap_stop`. `ledger settle --lease` copies it from the stop record, and so does its `--artifact` form when the record it reads holds the lease. `ledger settle --from` copies the record's stop into the imported close, or keeps the artifact's own `cap_stop` when the record holds none, and a reconcile copies the record's stop too. The local ledger keeps a stop with the close it stages, so a settle retried after a failed write still carries it, even when the stop record itself could not be written. A settle cut after the record took its close and before the local ledger marked the lease closed answers the record's close on a retry, and writes a stop that only the local ledger holds as the lease's stop record. Once an item holds a stop record or a close with `cap_stop`, `openLease` and O6's admission refuse every new lease on it with CAP_STOP, because a cap stop is not retried. A close without the field still reads.
- A lease records its id, machine id, amount and expiry. By default it takes everything the item has left and lasts 24 hours; `--ttl` can set up to 168 hours (7 days).
- If the machine's local ledger fails while it takes the lease, the lease is closed at $0 at once (E_LEDGER_PATH), since no call can spend against it. The next lease takes the next slot, so on a `required` item it needs its own admission record. If the local ledger cannot even be read, the lease stays reserved (E_LEASE_UNSETTLED) until it is settled there or reconciled.
- Only one lease on an item is open at a time. A replacement worker cannot lease until the old lease is settled or reconciled (E_LEASE_UNSETTLED).
- When a lease runs out, a call is refused with CAP_STOP. When a lease has expired or been settled, it is E_LEASE_CLOSED. Either way, the run settles its lease and resumes on a new lease for the same run.
- When the item itself has nothing left, a new lease is CAP_STOP until the owner raises the cap.

```
gstack-evals ledger lease --item lanea-quick --run <run id> [--amount <usd>] [--ttl <hours>]
gstack-evals ledger settle --lease <lease id>
gstack-evals ledger status [--item lanea-quick]
```

## Program envelopes

A program is a set of line items under one owner-approved total, with a ceiling for each of its skills as well. The outcome-per-skill plan v3 (wiki/plans/2026-11-03-geva-225-outcome-per-skill-plan, build step O6) is the first: one total for wave 1 and a ceiling for each of its six skills, both set in the plan. The envelope counts every dollar the program commits, so a stage is refused before it spends rather than after.

Before you run it, replace each angle-bracket value with the approver's own words and name, because the ledger records whatever you pass.

```
gstack-evals ledger envelope --program <name> --cap <usd> --skill-cap <usd> --skills <a,b,...> --credit-rate 1 \
  --words "<owner's exact words>" --by "<who>" --source "<where>"
gstack-evals ledger init --cap <usd> --item <name> --admission required --program <name> --skills <a,b> --words ... --by ... --source ...
gstack-evals ledger lease --item <name> --run <run id> --amount <usd>
gstack-evals ledger crew --program <name> --thread <code> --credits <n> --skills <a,b> --source "<counter reading>"
gstack-evals ledger status --program <name>
```

- `ledger envelope` records the program's ceilings once, with the owner's words, and then mirrors them through gstack-approvals. Of two envelopes recorded at the same moment, only the one on record is mirrored. If the mirror fails, run the same command again; it returns the envelope and mirrors it. The envelope never changes. `--credit-rate` is the dollar price of 1,000 credits of crew model use, a positive amount, and the mirrored approval names it, the record path and the envelope host's machine id.
- An item joins a program at `init` with `--program` and `--skills`, and that never changes. That first approval is written with schema 2, so a gstack-evals from before program envelopes stops on the item with E_LEDGER_RECORD instead of leasing it past the envelope. Its spend is split evenly across those skills; an odd micro-dollar goes to the first skill named. A family's shared stage names both skills. A survivor's own stage names only the survivor.
- Each lease on a program's item is the stage's reservation: `--amount` is the stage's projected worst case. Before the lease is written, the ledger checks it in one atomic step. The program's settled spend, its open leases, its admitted leases not yet written and this lease must stay at or under the program's ceiling, and each of the item's skills' lines, with its share of this lease, must stay at or under its ceiling. Otherwise the lease is refused with ENVELOPE_PROGRAM_STOP or ENVELOPE_SKILL_STOP, and nothing is written. Landing exactly on a ceiling is admitted.
- A lease that passes is written to the program's next entry slot, `<record>/programs/<program>/entry-<slot>.json`, before the lease file itself. The slot is write-once, so of two leases admitted at the same moment one wins it, and the other reads the winner's entry and is checked again. That makes the check and the reservation one step without a lock file a crash could strand.
- Settling a lease, or the owner's reconcile, moves its metered amount to settled spend and releases the rest. Unknown calls count at their full reservation. A lease that crashes before it settles stays counted at its whole amount, past its expiry, until it is settled or reconciled. An admission whose lease was never written counts until that lease's expiry, after which no call can spend against it. So a lease whose expiry passes after its admission and before it is written is refused with E_ENVELOPE_LATE and not written.
- No paid call runs without a covering reservation: a call needs a lease in the local ledger, and a lease on a program's item exists only after the envelope admitted it.
- `ledger crew` records a crew thread's model use, read from its credits counter, as settled spend on its skills' lines, or with `--overhead` on the program's own line only. A reading is cumulative, so the envelope counts each thread's latest reading once; a lower reading, a different split or a cost the ledger cannot hold exactly is refused before it is written. Crew use is spent already, so it is recorded even past a ceiling. The reading that takes a line past its ceiling warns ENVELOPE_OVER once, and every new stage on that line is then refused.
- `ledger status --program` prints the program's line, each skill's line and the overhead: settled, open, pending (admitted, not yet leased), committed and left. With `--item`, it prints only the lines of that item's skills beside the program's. It warns ENVELOPE_OVER for a line past its ceiling, which crew use or an overspent lease can cause.
- The envelope counts each dollar once: a lease on its item's split, a thread at its latest reading. A stage that already settled keeps the split it settled under, so a survivor's re-size reserves only the stages not yet spent.
- Every program read covers every line item in the record, so a damaged item anywhere stops the read with E_LEDGER_RECORD and nothing is admitted until a human repairs it.
- An entry slot has one winner within one host, like every record slot ([the cross-host finding](../wiki/board/2026-10-28-gsta-16-ledger-cross-host-claim.md)). So an envelope entry is refused with E_LEDGER_PATH when the record is on a network or FUSE mount, a Capy drive included.
- Each program has exactly one envelope host. Its record lives on that host's local disk, `ledger envelope` runs there once, and the mirrored approval names the host and the record path. The host stays awake for the whole program, such as a named runner VM, and is never a Capy machine that can sleep. Every lease and every crew-use record of the program goes through it. A worker on another machine takes its lease there with `lease --machine <its id> --export <file>`, holds it with `lease --from <file>`, and settles it with `settle --artifact <file>` on the worker and `settle --from <file>` on the host. VM shards work the same way.
- Nothing in the ledger stops a second host from recording its own envelope for the same program on its own disk, which would give the program a second ceiling. The owner records each program's envelope once, on its host, and checks the host named in the program's approval row before recording another.

## Admission

Admission is the rig check before money (the CI plan, decision 3). The ledger checks it at the lease, the one boundary Lane A, the replay lane, direct-API arms and judge calibration all cross.

- An item's admission mode is recorded with the owner's words in its first approval file, `items/<item>/approval-0001.json`, as `{ item, admission }` with `admission` set to `required` or `warn`. U2's preregistration check reads those two fields.
- Before a lease is written, the ledger reads the admission record for that lease's slot, `items/<item>/admission-<slot>.json` (or its latest attempt, `admission-<slot>.<n>.json`). `gstack-evals rig admit` writes it, and [docs/rig.md](rig.md) says what it must prove.
- On a `required` item, a missing or mismatched record refuses the lease with E_RIG_UNPROVEN, and nothing is leased. On a `warn` item the lease goes ahead, and the RIG_UNPROVEN warning is printed and returned with the lease.
- `openLease` takes a `requireAdmission` function, which defaults to U20's `rigAdmission()` (src/rig/admission.ts): the record must be green, name the lease's item, slot, run and machine, and still match the checkout's tree, the recipe hash and the host. Lane A asks for the trial proof set and the replay lane for the direct one.
- A new lease after a settle or reconcile is a new slot, so it needs its own record.

## Settling, and when a machine is lost

`ledger settle` closes a lease into the record from the machine's local ledger. It counts settled calls at their cost and every call with an unknown outcome at its full reservation. Settle is idempotent by lease id. The close is fixed in the local ledger before it is written, so a retry after a lost acknowledgement finds the same bytes already in place. A settle that cannot reach the record exits 2 with E_LEASE_UNSETTLED, and the lease stays reserved until the retry succeeds. A close above the lease's amount, from a call the provider billed above its reservation, is recorded at its real spend with a LEASE_OVERSPENT warning on stderr; the item's committed total counts the real figure, so a new lease gets only what is left of the cap. On a lease that names a driver's run directory (its holder), a settle then writes a `close` line for each session that directory's sessions.jsonl still shows open on the lease, and `ledger reconcile` does the same, so admission can read the run; either warns SESSIONS_OPEN when the run directory, or for a settle the lease's local ledger, is not on this machine (lanes/outcome-skills/driver/README.md).

A lease whose machine or local ledger is gone stays reserved in full. It is never released silently. Once the lease has expired, so the old machine can admit no more calls even if it comes back, the owner settles it from the provider's usage export:

Before you run it, replace each angle-bracket value with the approver's own words and name, because the ledger records whatever you pass.

```
gstack-evals ledger reconcile --lease <lease id> --spent 3.10 \
  --words "<owner's exact words>" --by "<who>" --source <provider usage export file>
```

`--source` must be the export file. The close records the figure, the words, the export's path and its sha256. A lease closes once. A later settle or reconcile with a different outcome is E_SETTLE_CONFLICT, and the first close stands.

## Counted runs in the sealed workflow

The sealed repo's workflow belongs to the second principal and cannot reach a Capy drive, so its lease travels as files:

1. The thread leases the item for the workflow and exports it: `ledger lease --item <item> --run <run id> --machine workflow:<name> --export lease.json`. It passes lease.json as a dispatch input.
2. The workflow holds the lease in its own local ledger with `ledger lease --from lease.json`, spends against it with provider keys from its protected environment, and writes a settle artifact with `ledger settle --lease <id> --artifact settle.json`.
3. The thread copies the artifact into the record with `ledger settle --from settle.json`. Only a settled close of that lease, in the shape a local ledger writes and holding no more unknown charge than the lease's amount, is accepted. An invalid artifact is E_USAGE and writes nothing. A workflow that spent more than its lease, which happens only when a provider bills a call above its reservation, is recorded at its real spend with a LEASE_OVERSPENT warning, the same as a direct settle. An unknown lease is E_LEASE_UNSETTLED; a different close already on record is E_SETTLE_CONFLICT.

If the export file is lost before dispatch, `ledger lease --lease <id> --export <file>` writes it again. If the export file cannot be created, no lease is recorded. If writing the lease into it fails after the lease is recorded, for example on a full disk, the lease stands and that same command writes the file again. `--export` and `--artifact` never replace a file that already holds other content; an empty file, such as one a failed export left, is filled. They take no lock, so never point two commands at the same output file at once. An output that cannot be written is E_USAGE, and the message names the command that recovers.

The workflow's local ledger is the lease's journal, and the ledger cannot see across workflow attempts. So the workflow must keep that file across attempts of the same dispatch, for example as an artifact keyed by the lease id. It must not start an attempt on a fresh runner with the old lease file. A fresh runner needs a new lease, exported after the old one is settled or reconciled. Otherwise a rerun could spend the same allowance twice, and the record would see the second settle only as E_SETTLE_CONFLICT, after the money is gone. `ledger lease --from` refuses a lease that its own ledger has already settled.

## On Capy

Keep the local ledger at its default under `~/.capy/work/gstack-evals/`. A record that holds no program may sit on your Captain drive, for example `GSTACK_EVALS_LEDGER_RECORD=~/.capy/drive/<captain drive>/ledger-record`. A program's record may not: the drive is a FUSE mount that every crew machine shares, so envelope entries are refused there, and the record lives on the program's envelope host (Program envelopes). The local ledger file is the run's journal of reservations. If the machine is replaced, its lease stays reserved until `ledger reconcile` records the owner's settlement.

## In code

`src/runner/ledger/ledger.ts` has `recordApproval`, `openLease`, `settleLease`, `reconcileLease`, `exportLease`, `importSettlement` and `ledgerStatus`. `LocalLedger` in `src/runner/ledger/local.ts` implements `ReservationLedger` from `src/types.ts`:

- `reserve({ idempotency_key, lease_id, cell, max_micros })` holds the call's real maximum. The same key with the same request returns the first reservation. With a different request it is refused with E_RESERVE_CONFLICT.
- `settle(reservation_id, outcome)` records the cost, or `unknown`, which keeps the full charge. The same outcome again returns the same reservation. A different one is refused with E_SETTLE_CONFLICT.
- `releaseUnbilled({ lease_id, idempotency_key, journal, generation_id, record })` settles one send on an open lease at $0 when the provider's own record shows it was not billed. The OpenRouter generation record must name `generation_id` with a `total_cost` of 0 and 0 prompt and completion tokens, and the proxy journal must show the send ended with no usage: `unknown`, or a 5xx charged at its reservation. A send still in flight is never released. The record's sha256 and the prior outcome are kept, so a later settle of that prior outcome returns the released reservation. The tbv driver calls it ([lanes/tbv/README.md](../lanes/tbv/README.md)).

`openLease` takes `requireAdmission`, the seam U20 fills, and a `warn` callback for RIG_UNPROVEN.

`src/runner/ledger/envelope.ts` has `recordProgram`, `admitLease` (which `openLease` calls for a program's item), `recordCrew` and `envelopeStatus`.

## Reason codes

[CAP_STOP](errors.md#cap_stop), [E_LEDGER_MISSING](errors.md#e_ledger_missing), [E_LEDGER_PATH](errors.md#e_ledger_path), [E_LEDGER_RECORD](errors.md#e_ledger_record), [E_LEASE_UNSETTLED](errors.md#e_lease_unsettled), [E_LEASE_CLOSED](errors.md#e_lease_closed), [E_ITEM_BOUND](errors.md#e_item_bound), [E_RIG_UNPROVEN](errors.md#e_rig_unproven), [RIG_UNPROVEN](errors.md#rig_unproven), [LEASE_OVERSPENT](errors.md#lease_overspent), [SESSIONS_OPEN](errors.md#sessions_open), [E_APPROVAL_RECORD](errors.md#e_approval_record), [E_RESERVE_CONFLICT](errors.md#e_reserve_conflict), [E_SETTLE_CONFLICT](errors.md#e_settle_conflict), [ENVELOPE_PROGRAM_STOP](errors.md#envelope_program_stop), [ENVELOPE_SKILL_STOP](errors.md#envelope_skill_stop), [E_ENVELOPE_MISSING](errors.md#e_envelope_missing), [E_ENVELOPE_LATE](errors.md#e_envelope_late), [ENVELOPE_OVER](errors.md#envelope_over). Every error line on stderr starts with its code.
