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
| wal.ts | the hash-chained write-ahead copy and its completeness check |
| durability.ts | snapshots, the proxy ledger wrapper, recovery, ledger restore, reserve replay through reconcileJournal, the owner's reconcile |
| hosts.ts | dc-hosts: VM sub-reservations, measured settlement, the stage projection, idle deletion of the controller host |
| renewal.ts | lease renewal by draining, settling and opening the continuation with a new proxy |
| projection.ts | the figures export for the read area, the first judge packet's re-projection, the envelope, dc-authoring-3's release, R2-7's base-app reading |
| cli.ts | itemsCommand for `gstack-evals dc items` |
| dryrun-cases.ts, dryrun-durable.ts, dryrun-fixture.ts | the area's 40 dry-run cases and their rig |

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
3. **Write-ahead copy for session proxies.** The proxy container (src/trial/proxy-entry.ts) opens its own local ledger, so its reserves are not copied off host. It needs an additive, off-by-default option that wraps its ledger with writeAheadLedger and a WriteAhead whose target the container can reach (for example a unix socket in its mounted directory, served by the controller). Not done here, to stay clear of the run area's edits to that file.
4. **Session-side drift.** The meter checks the served provider on direct calls. Sol and particle-1 sessions go through the proxy container; the run area needs to read the served provider there and call `applyStop(controller, stopPlan("E_DC_PROVIDER_DRIFT", { model }))`.
5. **Captain stops with no frozen code.** The first packet's re-projection past $520, a refused dc-hosts stage, an unproven ledger copy and a projection past $5,000 return a `captain` outcome with no reason code, because codes.ts gains only the 18 E_DC codes.
6. **The items command.** Wire the `items` row in cli.ts to `itemsCommand` in money/cli.ts.
7. **Eval-ending stops.** They drain in-flight work before settling. If the Captain wants an immediate settle (in-flight work then held as unknown at full reservation), settleItem needs a force option.
8. **The off-host target.** DirTarget is for tests. Integration binds a real target off the controller host whose append resolves only on a durable acknowledgment.
9. **L6 against R2-7.** The plan's L6 says $3.20 admits 27 under the withdrawn $10 reserve; R2-7 and frozen.ts give 29 at one $5.00 allowance. The build follows R2-7.

No shared file was edited. money/types.ts extends the shared SubReservation instead of changing types.ts.
