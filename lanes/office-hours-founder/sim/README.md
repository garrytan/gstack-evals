# Office-hours founder eval: the simulated founder and its audit

This folder wires the reusable simulated person (src/persona-sim/) into the office-hours founder eval, as section 4 of the eval's preregistration (the PREREG path in ../frozen.ts) sets it out.

## Modules

- **founder.ts** holds section 4's frozen prompt (`FOUNDER_RULES`, checked byte for byte against the prereg by a test), loads a unit's sheet.json and opening.md into a person sheet (`loadFounder`), builds the visible transcript (`visibleTranscript`), and builds the Gemini 4 Argon call (`founderCall`) on the simulator item's metered client. `founderTurn` is the turn the run side calls. `worstCase` is a call's worst case as the metering proxy reserves it.
- **fidelity.ts** holds the frozen V1 to V6 definitions (checked byte for byte), the seeded draw of founder turns (`drawAudit`), the two-auditor audit (`runAudit`), the pass rule (`auditPasses`), the stage 1 repair record (`repairRecord`) and what an audit means for its stage (`auditOutcome`).
- **seams.ts** exports the dry-run seams for start rule 7: the simulator's JSON checks, its retry and a second failure; the audit at 2 and 3 failing turns with a disputed turn; an audit short of turns in a stratum, in revealing turns and in all (39, 20 and 19 turns); a refusal on the simulator's allowance on both sides; and a served provider other than Google Vertex.

The metered client (lanes/product-value/meter.ts) gained four optional request fields for this: `system`, `messages`, `temperature` and `seed`. They are sent only when set and only on OpenRouter, so every existing request body and cache key stays byte for byte the same (tests/of/sim/meter.test.ts).

## What the run side does with it

1. Open the simulator item's meter with `maxOutputTokens` of at least 1,200 and its cache on tmpfs.
2. For each session attempt, make one `SimSession` with the simulator's allowance in micros (`PRE_SMOKE_SIM_ALLOWANCE` before the smoke) and pass it to `founderCall`. Its `spent_micros` is the session's simulator spend.
3. After each assistant reply with no block, call `founderTurn({ sheet, transcript: visibleTranscript(replies, founderTurns), call })`. A `reply` becomes the next user message and a `FounderTurn` record. A `check-failed` makes the session missing (E_OF_SIM_TURN). A `call-failed` with reason `allowance` or `provider` makes it missing. A `drift` stops the simulator's items for the Captain (E_OF_PROVIDER_DRIFT).
4. After a stage, call `drawAudit(stage, sessions)`, then `runAudit` with each drawn turn's sheet, advisor message and reply and the two auditor calls (Astra and Opus at effort `max`), then `auditOutcome`.

## Build-time choices

1. The advisor's message is every main-agent text block of one reply (parse.ts's `replies`), joined by blank lines. A founder reply follows the advisor message it answered.
2. The loader drops each fact's `kind`, so the simulator sees only an id, a text and a reveal_when line. The opening is trimmed, as the arm's first message trims it.
3. Each simulator call sends effort medium, temperature 0, seed 20261109 and `max_tokens` 1,200, with the frozen prompt as a first system message.
4. The allowance check runs before every call. The worst case is the proxy's own reservation (`priceRequest` and `reservationMicros`) on the body the proxy will send, routing field included: one token per byte of input at the Argon row's input price, plus 1,200 output tokens at its output price. A call runs when its worst case is at most what is left.
5. A call's spend is the micros the meter records. A cached reply costs nothing. A call whose cost the meter could not record counts at its worst case.
6. Google Vertex is the served provider named `Google`, `Google Vertex` or `google-vertex`, any case, as OpenRouter names it and as the autoplan audit lane checks it. Everything else, Google AI Studio included, is a drift. The meter's own check accepts any name starting with Google, so founder.ts checks again. The meter's own drift refusal is also a drift.
7. A failed call whose problem starts with `E_ALLOWANCE` at status 402 (the proxy refusing on the lease) is an allowance refusal. Any other failed call is a provider failure.
8. `founderTurn` is persona-sim's `personTurn`. Its outcomes also carry `requests`, the request digests, beyond the shape the run side asked for.
9. Only arm sessions of the audited stage enter the draw. Reference and pitch-only sessions have no simulator by construction. An arm session with no founder turn is counted in `zero_turn_sessions` and offers none.
10. Stage 1's "the rest" is the lens arm: the only other arm with founder turns in stage 1.
11. The seeded order sorts every founder turn by unit, model, arm, pass and turn, then shuffles it with seed 20261109 (the product-value shuffle on the shared mulberry32 generator). So the draw does not depend on the order sessions arrive in.
12. With at least 40 turns, the draw walks the seeded order three times under the arm targets and at most 2 turns per session: turns that revealed a fact until 12 are drawn, then turns that revealed none until 12, then any turn until the targets fill. An arm's target is its quota capped by what it can offer under the per-session limit, and the shortfall goes to the arms in the order office-hours, lens, none. When a kind of turn is scarce, the minimum takes what exists.
13. One pass rule covers every case: at most 5% of audited turns fail, which is at most 2 of 40. When the per-session limit leaves fewer than 40 drawable turns in a stage of 40 or more, the draw audits what it can under the same rule.
14. A stage 1 NO READ carries E_OF_NO_READ (the eval ends at stage 1). A stage 2 NO READ or audit failure carries E_OF_SIM_AUDIT (stage 2 is void). A stage 1 failure with no repair returns `repair`; with the repair recorded it returns `fix-method`.
15. A repair record holds the sha256 of the frozen rules and of the repaired wording, and refuses a repair that changes nothing. The sheets are never part of it: `loadFounder` takes the repaired rules text and nothing else changes.
16. The audit prints, per violation code, the turns both auditors marked with it and the turns each marked with it, with `UNREADABLE` as its own row. Agreement is turn-level, on "marked any violation": the share of turns where the auditors agree, and Cohen's kappa.
17. The audit runs at most 8 turns at once, each turn's two auditors together.
