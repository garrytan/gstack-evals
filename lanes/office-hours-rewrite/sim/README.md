# office-hours-rewrite: sim

The simulated person and its fixed-script audit for the office-hours rewrite eval (prereg section 5; pre-run change 1,
items 2 and 3).

- `founder.ts`: one simulator turn. It loads a brief's person sheet with change 1's rules text for the brief's kind
  (checked against its frozen digest, E_OHR_SIM_RULES), sends it through the founder lane's metered call, reads the
  draw, and redraws on a failed check or the reveal guard, at most three calls a turn. Rejected draws are kept apart and
  never reach the adviser.
- `audit.ts`: the fixed-script audit. It replays the frozen scripts against the simulator, samples the auditable turns,
  hands them to an injected auditor, and reads the guard share and the audit verdict.
- `seams.ts`: the dry-run seams, one per frozen rule, run by tests/ohr/sim/seams.test.ts.

## Reused and copied

Reused by import: src/persona-sim/sim.ts (renderSystem, toMessages, readOutput, NOTES, SIM_SHA256),
src/persona-sim/audit.ts (auditTurn, combine), the founder lane's founderCall and worstCase, its VIOLATIONS list and
its fakeMeter. Nothing is copied.

## Build-time choices

- Resend notes go after the rules text and before "The sheet:", so the sheet stays the last thing the model reads.
- A resend carries notes for the last draw's failures only, since earlier failures were already fixed or are repeated.
- founderCall's seed stays the founder lane's 20261109 because the call is reused by import; the prereg's SEED 20261117
  orders the sample, not the provider call.
- In the audit, a script turn with no delivered reply ends that script, since later turns would answer a turn that
  never happened.
- A sampled turn whose draws all failed a check counts as failed, like a guard failure (fail closed).
- The guard share's denominator is the script turns that ran.
- The audit sample is the auditable turns sorted by brief and turn, shuffled with SEED, first 80.
- The auditor is injected: the founder lane's meter names Astra as gpt-6-astra, and the audit needs GPT-6.2 Astra, so
  the wiring waits on that meter entry.
