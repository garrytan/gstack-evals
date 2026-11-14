# Paid seams notes (for the integrator)

This area holds the real callers behind the money area's metered client, the session proxies, the write-ahead relay that covers the session proxies' reserves, and the model pin record. It closes money open items 3 and 4. Nothing here makes a paid call on its own: every model call is admitted by the money controller at the proxy's worst case before it is sent, and the probe plan only writes commands.

## Files

| File | Holds |
|---|---|
| direct.ts | DirectCallers: one in-process metering proxy per direct-call item on the controller host, its ledger wrapped by the write-ahead copy; the meter per item; the author area's Caller and the score area's JudgeCaller on top; renewal's proxy seam; provider keys read by name |
| sessions.ts | SessionProxies: one metering proxy per session item (review rounds, recipe sessions, stage 3 and oracle builds), its write-ahead relay, session binding at the frozen allowance, settlement from the proxy's own meters, the served-provider scan of its journal, the cut on drift, renewal's proxy seam; the container and in-process launchers; the generation-record resolver |
| relay.ts | the controller end of the write-ahead relay: a unix socket in the proxy's directory that appends checked reserve and outcome lines to the run's one WriteAhead and answers only once the off-host target holds them |
| pin.ts | the model pin record (start rule 9): the keyless probe plan, the endpoints parse, one record file per run, and the views the watch and start rule 9 read |
| cli.ts | pinsCommand for `gstack-evals dc pins plan` and `pins record` |
| scripted.ts | scripted upstreams that answer like Anthropic, OpenAI and OpenRouter (JSON and streams, usage blocks, the served-provider field, errors, 429 and 5xx, OpenRouter's generation record) |
| dryrun-cases.ts | the area's dry-run cases (L1, L2, L7, R2-4, R2-8, PD-9, SR9) and their rig |
| ../money/served.ts | ProviderWatch, the served-provider check shared by direct calls and session traffic (in the money area because meter.ts uses it) |

Tests are in tests/dc/paid/paid.test.ts.

## How the money flows

- **Direct calls.** `DirectCallers.meter(item)` is money/meter.ts's client on that item's proxy. The meter admits the call at `worstCaseMicros`, the body priced as the proxy sends it, binds a slot at that allowance, sends, finalizes the meter and settles the sub-reservation from the local ledger's figures for that meter, which the proxy wrote. The proxy's ledger is `writeAheadLedger(local, wal)`, so a reserve is answered only once its line is off host.
- **Sessions.** `SessionProxies.bind(item, { sub, session, attempt })` binds one slot at the item's frozen allowance (the session items' allowanceUsd; $15 for an oracle build, STAGE3.build) and returns the base URL and bearer the session's harness uses. `end` drains and closes the slot and scans the journal; `settle` settles the sub-reservation at the sum of its sessions' meters, the retry included.
- **Write-ahead for session proxies (money item 3).** The session proxy runs with `write_ahead_socket` set (src/trial/proxy-entry.ts), so its ledger is `relayedLedger` (src/trial/write-ahead.ts): each reserve is posted to the relay and answered only after a 200. The relay accepts only reserve and outcome lines on its own lease, rebuilt from checked fields, so the proxy can never write an admission or a book change into the chain. A relay that does not acknowledge makes the proxy refuse with E_LEDGER_UNAVAILABLE and send nothing; main's reconcileJournal releases that hold at $0. A lost controller host recovers from the off-host copy with money/durability.ts's recover, replayReserves and ownerReconcile, which now see the session proxies' reserves too.
- **Drift (money item 4, PD-9).** One ProviderWatch per run. The first call per model, direct or session, in any role, records its provider and the routing terms in terms.ndjson. A later call is drift when its provider fails the route's pin pattern, differs from the dated terms record, or differs from that first record in provider or routing terms. Drift applies E_DC_PROVIDER_DRIFT's stop scope once (every call on that model, every role), cuts that model's session proxies, and throws E_DC_PROVIDER_DRIFT. Session traffic is read from the proxy journal's outcome lines, which carry served_provider and generation_id when ProxyOptions.servedProvider is on.
- **Pin record (start rule 9).** `pins plan --dir <new dir>` writes plan.json and prints one keyless curl per OpenRouter model (HTTPS only, no header, 30 s) against OpenRouter's public endpoints API. `pins record` parses the reads: each route's admitted endpoints are those on a pinned provider slug within the routing's max price, and the route is pinned only when they name exactly one provider that matches the pin pattern. Anthropic and OpenAI routes pin to the provider itself. The record is written once per run and is ok only when every route is pinned; `datedTermsOf` refuses a record that isn't.

## Build-time choices (BT)

- **Proxy output cap.** Direct proxies refuse a request above 48,000 output tokens: the largest lane output cap (24,000) doubled for a resend. Reserves still follow each call's stated cap.
- **Keys.** A proxy's env is exactly ANTHROPIC_API_KEY, OPENAI_API_KEY and OPENROUTER_API_KEY, read by name when the proxy starts. The container launcher passes only the ones that are set.
- **Refusals.** A cap stop or closed item throws CapStopSignal (stage3/seams.ts); a stop scope throws DcError with its code; a wait the controller can't resolve, a Captain hold or an unacknowledged copy throws PaidRefusal with the admission.
- **Session routes.** Opus sessions use Anthropic's Messages API; Sol and particle-1 sessions use OpenRouter's Anthropic-shaped /v1/messages route, as main's Claude Code driver does.
- **Served name in the record.** The pin record's served provider is the endpoints API's provider_name for the admitted endpoint.

## Shared-file edits (additive, off by default)

- src/runner/proxy/metering-proxy.ts: `ProxyOptions.servedProvider` (default off). When on, each OpenRouter outcome line carries `served_provider` and `generation_id` from the reply (exported `servedOf`: a JSON body's top-level fields, or the first stream event that carries them). Nothing else changes.
- src/trial/proxy-entry.ts: optional `write_ahead_socket` and `served_provider` in ProxyConfig. Without them the entry is unchanged.
- src/trial/proxy.ts: `startProxyContainer` takes optional `writeAheadSocket` (it must sit in the proxy's mounted directory) and `servedProvider`, and writes them into the config.
- src/trial/write-ahead.ts (new): `relayedLedger`, the container side of the relay.
- lanes/design-constructed/dryrun.ts: registers the paid area.
- lanes/design-constructed/money/meter.ts: checks served providers through ProviderWatch (one per run when the caller passes it), and adds `version` (the reply's model field) to CallResult for the score area's JudgeReply.

## Open items

1. **Retry budget.** DirectCallers and both launchers take the proxy's retry budget from the integrator. A 429 settles at $0 and is resent within the budget. A 5xx with no usage is charged at its full reservation, so inside a direct call's allowance (its worst case) it can't be resent. The attempts and elapsed time are not chosen here.
2. **A direct authoring call with no reply text.** The author Caller throws PaidCallFailed (HTTP error, lost reply, or a reply that isn't JSON) and the pipeline lets it through. Whether such a call is resent, or counts as one of K4's parse failures, can decide whether a unit drops, so it is not chosen here. Judge calls follow the score seam: a sent call with no text returns its problem and text null.
3. **Does OpenRouter's Messages route name its provider?** OpenRouter documents the provider field on chat completions and their stream chunks. Whether its Anthropic-shaped /v1/messages replies carry one is not verified keyless. With no name, the scan resolves the reply through OpenRouter's generation record when `resolve` is bound (`generationResolver` on a direct proxy's free route); unbound or unresolved, the reply is unnamed and is drift, as on direct calls. If the route names no provider and the record can't be read, every Sol and particle-1 session would stop as drift. The first paid session per model shows which holds.
4. **Reply names against the endpoints API's names.** The watch compares the reply's provider to the pin record's provider_name exactly. That the two use the same spelling is not verified keyless; a difference would stop the model on its first call. This applies to the money area's dated-record check too.
5. **The drift window on sessions.** The controller reads a session proxy's journal when `scan` runs (and at every `end`). Calls sent between a drifting reply and the next scan go out, each inside its slot's allowance. How often the integrator scans is a money choice left open.
6. **A session cut by drift.** Cutting a model stops its session proxies, so a running session on it fails mid-flight. PD-6's order has no row for a session ended by a stop scope, and STOP_SCOPES says nothing on that model resumes without the Captain. How that session is recorded is the Captain's.
7. **The relay's credential.** The relay socket has mode 0600 and sits in the evaluator-side proxy directory, which no agent container mounts. It takes no token, unlike the management socket. A token would be an additive change if the integrator wants one.
8. **Wiring.** cli.ts needs a `pins` row calling `pinsCommand`. The wiring module binds `DirectCallers.author` and `DirectCallers.judge` to the author and score seams on the right item per stage, `SessionProxies.bind`, `end` and `settle` to the session loop, the recipe sessions and stage 3, `containerLauncher` to the session rig's trial network, `scan` to a timer, and `datedTermsOf(pinRecord)` into the run's one ProviderWatch. The lane README's layout table needs a paid/ row.

## Not verified here

- `containerLauncher` and the proxy container itself: they need Docker and the trial image. The in-process launcher runs the same relay client and served-provider path, and tests/dc/paid runs proxy-entry.ts as a subprocess with the relay on, on the refusal path only (an acknowledged call would reach the network).
- Any real provider reply: every reply here is scripted.
