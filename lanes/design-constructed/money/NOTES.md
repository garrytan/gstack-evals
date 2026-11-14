# Money area notes (for the integrator)

The money area holds the 17 ledger items' admission, one controller-held lease per item and run id, the stops, the metered client, ledger durability and dc-hosts. The integrator merges the reuse rows and build-time choices below into the lane README.

## Files

| File | Holds |
|---|---|
| types.ts | the area's own types: sub-reservations, admission outcomes, item figures, the ledger seam and the off-host target seam |
| book.ts | MoneyController: one lease per item and run id, sub-reservations, admission (settled, in flight and unknown carried apart), waits, cap stops, pauses, stop scopes, snapshot and restore of the book |
| ledger-main.ts | the ledger seam bound to main's src/runner/ledger (openLease with the fixed holder directory, settleLease, recordStop) |
| price.ts | L1's worst case from main's src/runner/pricing, the lane's direct model routes and the output caps |
| stops.ts | L5's table (STOP_SCOPES and CAP_STOP_SCOPE in frozen.ts) turned into scope stops, released sessions and settled leases |
| meter.ts | the metered client, adapted from the devex branch's aftermath meter |
| served.ts | ProviderWatch: the served-provider check direct calls and session traffic share (PD-9) |
| wal.ts | the hash-chained write-ahead copy and its completeness check |
| durability.ts | snapshots, the proxy ledger wrapper, recovery, ledger restore, reserve replay through reconcileJournal, the owner's reconcile |
| carry.ts | the carry across launches: every earlier launch's archived book read as recovery reads it, its reconciliation file, the completeness check against the approval record, and the carry file the host reads at boot |
| hosts.ts | dc-hosts: VM sub-reservations, measured settlement, the stage projection, idle deletion of the controller host |
| renewal.ts | lease renewal by draining, settling and opening the continuation with a new proxy |
| projection.ts | the figures export for the read area, the first judge packet's re-projection, the envelope, dc-authoring-3's release, R2-7's base-app reading |
| cli.ts | itemsCommand for `gstack-evals dc items` |
| dryrun-cases.ts, dryrun-durable.ts, dryrun-fixture.ts | the area's 40 dry-run cases and their rig |
| offhost.ts | the off-host write-ahead target: walctl on a second small VM, reached over SSH with a key pinned to it, and RemoteTarget |
| ledger-service.ts | the ledger service on the controller host: boot from the off-host copy, host admission on dc-hosts, snapshots, Captain stops and resume, idle deletion, teardown |
| host-main.ts | the controller host's entrypoint, started detached with setsid; runs the wiring's stage module in the same process |
| controller-host.ts | the launcher: launch, relaunch, recovery of a lost host and teardown, deleting every VM it made on failure |
| dryrun-hosts.ts | the controller host's 4 dry-run cases |

The read area's input is `moneyFigures(controller, crewMicros)` in projection.ts: settled, in-flight and unknown micros per item, never settled spend alone.

## Reuse

| Source path | Commit | sha256 of the source file | What changed |
|---|---|---|---|
| lanes/aftermath/meter.ts (devex branch, generalized from lanes/product-value/meter.ts) | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 4841e6c1b9f25a0f3100f36a8c817154ce81ae854363f6c7ff7bbaf6483dd1de | No lease opened here: the controller holds it and admits each call at the proxy's worst case before binding. Settles the controller's sub-reservation from the local ledger's figures per meter. The per-model scope stop moved from the branch's local ledger change into the controller's stop scopes, so main's local.ts is untouched. Drift is E_DC_PROVIDER_DRIFT and applies PD-9 across every item. The first call per model records its served provider and routing terms. The reply cache and its key are unchanged. |

Read as patterns, not copied: lanes/devex/leases.ts at the same devex commit, and main's lanes/eng-build/ledger.ts. Main's src/runner/ledger, src/runner/pricing and src/runner/proxy/metering-proxy.ts are imported, not copied.

## Build-time choices (BT)

- **Lease time to live.** One day by default; integration passes each stage's length plus a day, within main's 7-day ceiling (L7).
- **Worst case.** The body is priced as the proxy sends it (provider routing, service tier, usage field), with an inference region added to every Anthropic body, which can only raise the bound. A free input count is used only when the caller passes one. The dry run shows the controller's reserve equal to the real proxy's own reserve on all five models.
- **In-flight limits per item.** Direct calls 8 (frozen), recipe sessions 1, oracle builds 1. Rounds and VMs have no count limit, only room.
- **dc-hosts and the wait rule.** The controller host's own sub-reservations never count as work that will free room, so a VM refused with only the controller host in flight is a cap stop, not a wait to the end of the stage.
- **Rounds.** A round with fewer sessions than the item's round size reserves its own sessions at full allowance twice over. A session released by a stop takes its share (twice its allowance) off the round's reservation.
- **Stops drain.** Work in flight under a stop finishes and settles; each named lease settles once nothing on it is in flight. Unrun sessions release at once. Every stop scope lifts only on the Captain's word.
- **Authoring leases.** The leases that settle on E_DC_SUPPLY_SHORT, E_DC_AUTHOR_COST and E_DC_GATE_CHECK are dc-base-apps, dc-gate-check and dc-authoring-1 to -3.
- **Write-ahead copy.** Lines are hash-chained. After one unacknowledged append the log refuses every admission until a verified snapshot restarts it. The proxy ledger wrapper copies a reserve after the local ledger holds it and throws when the copy fails, so the proxy refuses with E_LEDGER_UNAVAILABLE, sends nothing, and reconcileJournal releases the hold at $0.
- **Snapshots.** The book, the local ledger (SQLite serialize, read under its lock) and the proxy journal at one watermark, read back from the target by sha256. Due after any settlement and at least every 10 minutes.
- **Recovery.** Every sub-reservation in flight at the watermark and every admission after it is held as unknown at its full reservation, even when a later settle line exists; settle lines are kept as evidence only. The owner's reconcile (main's reconcileLease after expiry) spreads the provider figure, less spend already settled on that lease, over the held sub-reservations in proportion to their reservations.
- **Routes and drift.** Sol, particle-1 and Argon run through OpenRouter; a reply's provider must match the pin's pattern (OpenAI, Particle, Google) and, when a dated terms record is passed, equal its provider name exactly.
- **The first judge packet.** dc-judges admits only the first-packet tag until the re-projection, which is everything committed plus the measured packet cost times the packets left.
- **R2-7's cap stop reading.** With 16 or more qualified, the base apps stay at that count, at most 20.

## Open for the integrator

1. **Unknown charges and the cap stop.** Settled by the Captain on 2026-11-14 (PD-18): an unknown charge counts as in flight until reconciled, so a refusal waits on it.
2. **Recipe retries and "at most 30".** The money area admits a J1 retry on money alone. Whether a retry counts toward the 30 recipe sessions is the frame area's count, and the frozen text doesn't say.
3. **Done in paid/ (see paid/NOTES.md): the session proxies copy their reserves through a write-ahead relay.** Write-ahead copy for session proxies. The proxy container (src/trial/proxy-entry.ts) opens its own local ledger, so its reserves are not copied off host. It needs an additive, off-by-default option that wraps its ledger with writeAheadLedger and a WriteAhead whose target the container can reach (for example a unix socket in its mounted directory, served by the controller). Not done here, to stay clear of the run area's edits to that file.
4. **Done in paid/ (see paid/NOTES.md): session traffic runs through the same ProviderWatch as direct calls.** Session-side drift. The meter checks the served provider on direct calls. Sol and particle-1 sessions go through the proxy container; the run area needs to read the served provider there and call `applyStop(controller, stopPlan("E_DC_PROVIDER_DRIFT", { model }))`.
5. **Captain stops with no frozen code.** The first packet's re-projection past $520, a refused dc-hosts stage, an unproven ledger copy and a projection past $5,000 return a `captain` outcome with no reason code, because codes.ts gains only the 18 E_DC codes.
6. **The items command.** Wire the `items` row in cli.ts to `itemsCommand` in money/cli.ts.
7. **Eval-ending stops.** They drain in-flight work before settling. If the Captain wants an immediate settle (in-flight work then held as unknown at full reservation), settleItem needs a force option.
8. **The off-host target.** DirTarget is for tests. Integration binds a real target off the controller host whose append resolves only on a durable acknowledgment.
9. **L6 against R2-7.** The plan's L6 says $3.20 admits 27 under the withdrawn $10 reserve; R2-7 and frozen.ts give 29 at one $5.00 allowance. The build follows R2-7.

No shared file was edited. money/types.ts extends the shared SubReservation instead of changing types.ts.

## Controller host, ledger service and off-host target (money open items 5, 7 and 8)

The controller host is a Ubicloud VM (name prefix dcctl-) beside a second small VM (dcwal-) that holds the off-host copy. controller-host.ts runs on the attaching agent's machine; host-main.ts runs detached on the controller host and holds the money controller, the one local ledger file and the approval record at fixed paths under /var/lib/dc (the same paths on a replacement host). The wiring binds:

- launch, relaunch, recoverHost, teardown and hostStatus from controller-host.ts, with a HostRecord the attaching agent keeps;
- serviceEnv(process.env, owner) for the keys, read by name and handed over on the SSH session's stdin;
- keyedUbicloud (stage3/ubicloud-real.ts) for the backend, with the token read by name;
- controllerProvision({ bunVersion, mirrors: true }) for the host's setup;
- a stage module exporting runOnHost(service, args), named in the plan's stage field, which runs the paid stages in the service's process and calls service.idleDelete for a long wait.

Tests: tests/dc/money/hosts.test.ts (walctl and the service), tests/dc/money/controller-host.test.ts (the launcher on stage3/fake.ts's simulated Ubicloud with every SSH command run locally, the real service started with setsid), tests/dc/stage3/ssh.test.ts (the SSH runner, tunnel and pinned WAL key against a local sshd).

### Build-time choices (BT)

- **The off-host target (item 8).** An append-only file on a second small VM. walctl (offhost.ts) appends one line under an exclusive lock, fsyncs it (and the folder when the file is new) and answers ACK with the line's sha256; the append resolves only on that answer. The controller host's key is pinned on the WAL host to walctl on the WAL folder (command=..., restrict), so it can append and read but never delete. Sessions share one SSH connection (ControlMaster, 10 minutes).
- **Lag.** An append or snapshot that takes over 30 s (WAL_TIMEOUT_MS) counts as unacknowledged.
- **Captain stops (item 5).** A broken copy, a failed snapshot, a recovery that can't be shown complete or a refused host admission pause every open item for the Captain and write captain.json; no snapshot runs on its own while it stands. The Captain's resume is a control file (state/control/resume-captain): a verified snapshot restarts the chain and each item gets its earlier pause back.
- **Approval record.** Uploaded once at launch, kept at a fixed path, and carried off host as a tar beside each snapshot; a replacement host restores it with the ledger file. The teardown archive returns it.
- **Host hours.** Both hosts are admitted on dc-hosts as controller-type sub-reservations (never work that will free room) at their time to live and settle at measured hours from their creation, less hours already settled; an unknown one (after a relaunch) reconciles the same way.
- **Idle deletion.** Deletes the controller host only; the WAL host keeps the copy and stays on dc-hosts.
- **Teardown (item 7).** Waits for in-flight work to drain; force holds it as unknown at full reservation first. Off by default.
- **Service loop.** A turn every 30 s; a snapshot after any settlement and at least every 10 minutes (L7).
- **Keys on the host.** ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY and UBICLOUD_API_KEY plus UBI_OWNER reach the service's environment through stdin and an export inside the remote shell; nothing writes them to disk or a command line.

### Open for the Captain

10. **The WAL host adds a host the dc-hosts row doesn't name.** The prereg's row covers "the controller, ledger and review-container host, recipe sandboxes and stage 3 sandboxes". The code charges the WAL host to dc-hosts. Ubicloud's list prices read 2026-11-13: burstable-1 about $0.0143 an hour ($10.47 a month), standard-2 about $0.0574 an hour ($41.89 a month). Over 14 days that is about $4.81 or $19.28 against dc-hosts' $80 cap. Fold it into dc-hosts and rerun its projection, or open a ledger line. Settled by the Captain's ruling 1E: the WAL host runs on burstable-1 (hosts.ts WAL_HOST_SIZE; a plan naming another size is refused) and walFoldProjection reruns the projection with its hours, $70.00 plus 336 hours at $0.0143, $74.80 of the $80.00 cap. A launch whose WAL host time to live would pass the cap is refused.
11. **Where the approval record lives.** The host holds a copy that gains lease files; the teardown archive returns it. Who writes it back to the Captain's record is open.
12. **A same-host relaunch holds what was in flight as unknown**, the hosts' own sub-reservations included (recover()'s rule). The hosts reconcile at measured hours at teardown; other work waits for J1 or the owner's reconcile.
13. **A lost controller host's own hours** stay unknown until the owner's reconcile against Ubicloud's bill; the new host is admitted fresh.
14. **A Captain stop on a host that is then lost** survives only in the launcher's HostRecord, and recoverHost refuses while it stands; captain.json is not copied off host.
15. **Unrecorded minutes.** A launch that fails before the service boots deletes both VMs; their minutes are not on dc-hosts. The minute between teardown's settlement and the deletion is not charged either.
16. **Force teardown (item 7)** exists and is off; the Captain picks.

### Shared-file edits

package.json and bun.lock add playwright-core 1.65.1 (the browser seam); NOTICE.md gains its row. No file under src/ was edited.

### Not verified

Ubicloud's API on a live account (the private_subnet_id and private_ipv4 fields, the ubi login with passwordless sudo, a VM name of this shape), the controller host's provisioning (bun install, the mirrors, systemd units), walctl and the pinned key on a real VM over the private network, and setsid surviving the SSH session on Ubicloud's image. Everything else ran keyless on this machine.
