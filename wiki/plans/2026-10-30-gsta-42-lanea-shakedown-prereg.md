---
id: 2026-10-30-gsta-42-lanea-shakedown-prereg
kind: plan
title: "Lane A shakedown preregistration: /learn on four rungs and office-hours on Opus 5.5, before and after gstack's skill diets"
summary: "First paid Lane A run: /learn on four rungs and office-hours on Opus 5.5, arms before, before2, after and none, 3 trials plus rerun. Cap $500, stop $480, about $150 expected."
author: GSTA-42
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-30
status: superseded
links:
  - 2026-10-29-gsta-30-laneb-quick-3-prereg
  - 2026-10-28-gsta-13-lanea-quick-office-hours-diet-prereg
  - 2026-10-28-gsta-13-second-opinion-rerun-prereg
  - 2026-10-29-gsta-29-u7-skill-eval-cli-handoff
  - docs/benchmarks/2026-11-lanea-shakedown/tasks/
---
# Lane A shakedown: preregistration

GSTA-42, for the gstack-evals Captain (GSTA-2), issue GST-280. Written 2026-10-30 from GSTA-41's handoff. Exploratory: this run checks the rig's paid path and reads two skill diets, and supports no public claim. Results go in a separate pull request and record the commit sha that adds this post. No paid call, calibration included, runs before Garry approves the cap and the Captain confirms this pushed commit.

## Approval

Not yet given. The recommendation is a $500 cap with a $480 ledger hard stop and about $150 of expected spend. The Captain asks Garry once this pull request is up. Each line item's approval row will quote Garry's words and name this post's commit.

## Why

Lane A asks whether a gstack skill diet keeps the skill's behavior. The rig (U5 to U10, then #71's knobs) has run only on the fake host. This shakedown runs it for money once on each provider route, on two diets gstack has already shipped: /learn at half its template size (gstack 7204a39a) and the office-hours diet pilot (gstack a14c28ac). GSTA-13 read the office-hours diet with an earlier harness; this run reads it again through the rig.

## Pinned inputs

- Rig: gstack-evals main at c88f3263853926d2c6faf329507b381493530a15, #71's merge commit. #71 raised the session allowance to 1.6M input tokens, corrected particle-1's price row, seeded `routing_declined` and pinned the judge and persona efforts.
- Tasks: gstack's contract task files from gstack b61744517cc35b3109f06a54d64857be27f60c4e (v1.91.334.0), vendored unchanged in docs/benchmarks/2026-11-lanea-shakedown/tasks/ (README there, NOTICE.md row). Each copy matches `git show <sha>:test/fixtures/skill-evals/<path>` byte for byte. These are the digests GSTA-13 used.

| File | Mode | sha256 |
|---|---|---|
| learn/tasks.json | 644 | 2c2b88193ecfe681e3620d12da40b97be7d89b0790c43f1c19f26f4e36e4bc54 |
| learn/seed.sh | 755 | 3428622aa410a41e215dbe505e8f389493befd78b0f8575483c2abb894fb1c22 |
| office-hours/tasks.json | 644 | 472af4f02f08a658a5572f3ed993fe8aa600d1610642db2a48fba91e691ed656 |
| office-hours/tasks.ext.json | 644 | 20d3a53727befd809824e2ce28a9af1114e6cdde3f0f2e5346d2142f4fb2f125 |
| office-hours/seed.sh | 644 | 10b85c8f7fbcdd4ca8f1974ef78f8104b770daac9007144d019aea0bead4538c |
| learn/tasks.lock.json | 644 | d567ce8745017cbcf1f81b1c6a732be557a47856ff3ad16f586308e8e6f2a24d |
| office-hours/tasks.lock.json | 644 | 070c69f90b457d9026825509be509fa99c8ca6c1090d0b5b8090e926f659739d |

- Locks: built at the committed paths with `gstack-evals skill-eval --lock --tasks docs/benchmarks/2026-11-lanea-shakedown/tasks/<skill>/tasks.json --before <before folder>` under policy sha256 a00180abac95, unchanged since GSTA-41. The claims were then added and the lock run again. Both locks are byte-identical to GSTA-41's. Claims sit only where a task's check or must observes the line:
  - learn: B:SKILL:0106 (no-code-change), 0132 (empty, show), 0158 and 0173 (prune-stale), 0253 (stats).
  - office-hours: B:SKILL:0695 (alternatives, approach-approval-gate).
- Preflight's lock step on the committed locks, keyless on the fake host (a throwaway ledger and approval record under ~/.capy/work, fake key values, `GSTACK_EVALS_FAKE_HOST=1`, `--isolation process`):

```
GSTACK_EVALS_FAKE_HOST=1 ANTHROPIC_API_KEY=fake-anthropic-value OPENAI_API_KEY=fake-openai-value OPENROUTER_API_KEY=fake-openrouter-value \
gstack-evals preflight --base gstack@7204a39a27ba90755db2e71e5bb869262a937402 --skill learn \
  --arms before=<learn at 398618259d56>,after=<learn at 7204a39a27ba>,none \
  --tasks docs/benchmarks/2026-11-lanea-shakedown/tasks/learn/tasks.json --host claude --model claude-opus-5-5 --trials 3 \
  --item lanea-fake --spend-cap 300 --ledger <tmp>/ledger.sqlite --ledger-record <tmp>/record --out <tmp>/out --isolation process
ok vacuity: 9 tasks bite on their control, 1 safety tasks without a mutant (controls ran as this user with the env allowlist, --isolation process)
ok lock: docs/benchmarks/2026-11-lanea-shakedown/tasks/learn/tasks.lock.json committed at 61d0e668377e, 88 contract lines, no drift
PREFLIGHT: pass (7 steps; nothing was spent)

(office-hours: the same call with its --base, --arms and --tasks, and --spend-cap 480)
ok vacuity: 11 tasks bite on their control, 0 safety tasks without a mutant (controls ran as this user with the env allowlist, --isolation process)
ok lock: docs/benchmarks/2026-11-lanea-shakedown/tasks/office-hours/tasks.lock.json committed at 61d0e668377e, 371 contract lines, no drift
PREFLIGHT: pass (7 steps; nothing was spent)
```

The paid calls run with the default `--isolation docker` once `gstack-evals doctor` pins the trial image on the run machine. This machine has no pinned image, so the keyless check ran the controls as the user.

## Cells

- /learn: Opus 5.5 (`claude-opus-5-5`) and Haiku 5.5 (`claude-haiku-5-5`) in Claude Code, gpt-6.1-sol in Codex, and particle-1 (`particle-ai/particle-1`) in Claude Code behind the smoke below.
- office-hours: Opus 5.5 in Claude Code only.
- Arms: before, before2 (the default noise floor), after and none, as folder overlays on a gstack base at each diet commit. Folders are exported with `git archive <sha> <skill> | tar -x` from a full gstack clone, which also sits under `<state>/sources/` so the rig finds every sha.
  - /learn: `--base gstack@7204a39a27ba90755db2e71e5bb869262a937402 --skill learn --arms before=<learn at 398618259d56df55e66793f168d0bd8c25cb9085>,after=<learn at 7204a39a27ba>,none`. The after folder comes from the diet tree, whose gstack-learnings-search gained `--stats` for the stats task.
  - office-hours: `--base gstack@a14c28aca7839cd0182fa130bff9874714672c24 --skill office-hours --arms before=<office-hours at cd4fc4be73d86a5b14be9a91026d3e4b16cd8520>,after=<office-hours at a14c28aca783>,none`.
- 3 trials, plus the rerun stage, which repeats all 3 trials for a model with a red task.
- Every Claude Code arm sets `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`.
- /learn runs before office-hours, so the reservation peak stays at about $480.

## Rungs

A shakedown checks the rig's paid path on each route once. Anthropic is covered by Opus and Haiku, OpenAI by Sol in Codex, and OpenRouter by particle-1, which is built on DeepSeek V4.1 Flash. Sonnet 5.5 adds cost without a new path, and DeepSeek V4.1 Flash runs the same OpenRouter path as particle-1, so both stay out here and join the full Lane A ladder. The open-weight ladder slots are outside this shakedown's brief, so the OpenRouter ranking was not re-read; the ladder run's preregistration re-reads it and records its `meta.as_of`.

## Judge

gpt-6.1-sol at reasoning effort medium (`JUDGE_REASONING_EFFORT` in src/adapters/judge.ts). It is cross-family, because Opus cannot judge Opus subjects. Nine office-hours tasks carry a judge rubric: mode-question, first-startup-question, vague-evidence-pushback, builder-mode, premise-challenge, second-opinion-offer, alternatives, ui-visual-step and backend-skips-visual. No /learn task is judged: /learn has no sidecar, and every /learn dry run prices 0 judge calls. So Sol's /learn cell makes no judge call, and Sol never judges Sol.

**JUDGE_ALLOWANCE gate.** Read the first 10 judge calls. If any uses more than half of the allowance (100k of 200k input, or 20k of 40k output), stop before round 2 and report to the Captain.

## Persona

gpt-6-luna, pinned by the policy sha, at effort low (`PERSONA_REASONING_EFFORT`), temperature unset, and the persona output cap in code (`PERSONA_MAX_OUTPUT_TOKENS` = 1,024 in src/usersim/persona.ts). Stop if more than 10% of trial-1 replies are `source: fallback`.

## routing_declined

#71 seeds `routing_declined: true` in code (src/trial/state-root.ts), and calibration's config probe requires `ROUTING_DECLINED: true` before any trial.

## particle-1 smoke

1. `--calibrate` on particle-1 with /learn's flags.
2. An uncounted pilot: task `show`, four arms, one trial (`--tasks-only show --trials 1`), never pooled into the verdict.

It passes only if every particle-1 call's settled spend is within its reservation, output plus reasoning is at most 32,768 tokens, no LEASE_OVERSPENT shows, and each session's spend stays within its $0.192 allowance. The proxy sends the price row as OpenRouter's `max_price` (prompt $0.10). If OpenRouter has no provider at that price, the call settles at $0 but shows as UPSTREAM or a calibration failure. That fails the smoke, and particle-1 drops with that stated reason. Nobody raises `max_price` mid-run.

## Analysis and reporting

- The rig's verdict for each cell, with the per-task table, every gate and lift with its interval.
- **Redaction.** Report redacted hits per arm from adjudication.ndjson. Where before and after differ by more than 20 points on a judged task, also give that task's verdict without the judge, as a sensitivity check.
- **Expected finding.** Both verdicts exit with UNCOVERED_GATE_REMOVAL by construction. gstack's tasks cover 5 of /learn's 14 changed gate lines (claims B:SKILL:0106, 0132, 0158, 0173 and 0253) and 1 of office-hours' 3 (B:SKILL:0695). That is a Lane A finding for gstack, not a rig fault, and the behavioral read comes from the per-task table and the other gates.
- **Known task limit.** GSTA-13 found that second-opinion-offer's must patterns credit text that never offers. Its row is read with that in mind.
- No parity or non-inferiority claim is made.

## Spend and caps

_Internal planning record: these budget and cost figures are plans and caps, not findings._

Garry's cap is $500, with a $480 hard stop across the shakedown's line items. Expected spend is about $150 as the planning figure, $95 with no rerun and $260 at the high end. GSTA-41's projection, from the rig's price table applied to GSTA-13's metered sessions:

| Line | Basis | Projected |
|---|---|---|
| Calibration, all rungs, twice | short sessions | $3 to $6 |
| /learn Haiku 5.5 | $0.0026 a session x 120 | $0.3 (rerun $0.6) |
| /learn Opus 5.5 | $0.075 to $0.109 a session | $11.5 (rerun $23) |
| /learn gpt-6.1-sol, Codex | Opus's token mix at Sol's row, x1 to x3 for Codex | $5 to $16, x2 with rerun |
| /learn particle-1 | Opus and Haiku mixes at the corrected row; Lane B shows about 6x Opus's tokens, mostly cached | $3 to $10 |
| particle-1 smoke | calibrate plus a 4-session pilot | under $1 |
| office-hours Opus 5.5 | $0.63 / $0.54 / $0.55 / $0.09 a session (before, before2, after, none), x1 to x1.5 because persona answers extend sessions | $59 to $89; $119 to $178 with rerun |
| Judge, gpt-6.1-sol medium | 108 calls a round, $0.02 to $0.05 each | $2 to $5, x2 with rerun |
| usersim, gpt-6-luna | under $0.001 an answer | under $1 |

How the caps work, from the run loop:

- A batch is one trial of every task in every arm. The loop starts a batch only when spend so far plus the batch's worst case (agent, judge and usersim) fits under the call's `--spend-cap`. A call runs up to 6 batches: 3 trials and the rerun stage.
- Calibration runs before any batch with no admission check, but its spend counts toward spent.
- E_CAP_TOO_LOW checks only one round of agent sessions, so it is a floor, not the cap.
- Each /learn cap is its calibration worst case, plus five batches at the high expected spend, plus one batch worst case, rounded up. A call's lease reserves its whole cap and releases what it did not spend, so a /learn cap moves the peak only while it runs.
- The ledger binds each line item to the first run that leases it (E_ITEM_BOUND), so every call has its own item: `lanea-shakedown-<row>` for each row below, and `lanea-shakedown-<row>c` for the `--calibrate` call before rows 3, 4, 5 and 7. Garry's one approval covers all of them. The Captain records each item with `gstack-evals ledger init --admission required`, quoting his words, just before its call. It is `required` because Garry's cap funds this run, and GSTA-8's decision 3 and U2's preregistration check require a program-funded item, whose every lease then refuses with E_RIG_UNPROVEN until U20's rig admission writes that lease slot's admission record. The item's cap is the smaller of the table's `--spend-cap` and $480 minus the settled spend on every earlier shakedown item, read with `gstack-evals ledger status`. The calls run one at a time, so settled spend plus the one open lease never passes $480.
- The office-hours cap is therefore the headroom under $480 left after /learn.

Worst cases from `--dry-run` and `--calibrate --dry-run` on these flags (allowances: agent session $7.04 on Opus 5.5, $0.88 on Haiku 5.5, $6.88 on gpt-6.1-sol, $0.192 on particle-1; judged run $0.80; usersim $0.0105). Each of rows 3, 4, 5 and 7 is preceded by its own `--calibrate` call with the same flags, capped at $8, $57, $56 and $64. Row 6 runs only if the smoke (rows 1 and 2) passes.

| # | Call | Calibration worst case | Batch worst case | E_CAP_TOO_LOW floor | Expected per batch | `--spend-cap` |
|---|---|---|---|---|---|---|
| 1 | particle-1 `--calibrate`, /learn | 8 x $0.192 = $1.54 | none | none | under $0.10 | $2 |
| 2 | particle-1 pilot, show, 1 trial | $1.54 | 4 x $0.192 = $0.77 | $0.77 | under $0.30 | $5 |
| 3 | /learn Haiku 5.5 | 8 x $0.88 = $7.04 | 40 x $0.88 = $35.20 | $35.20 | $0.10 to $0.21 | $45 |
| 4 | /learn Opus 5.5 | 8 x $7.04 = $56.32 | 40 x $7.04 = $281.60 | $281.60 | $3.0 to $4.4 | $360 |
| 5 | /learn gpt-6.1-sol, Codex | 8 x $6.88 = $55.04 | 40 x $6.88 = $275.20 | $275.20 | $1.7 to $5.3 | $360 |
| 6 | /learn particle-1 | $1.54 | 40 x $0.192 = $7.68 | $7.68 | $1.0 to $3.3 | $30 |
| 7 | office-hours Opus 5.5 | 9 x $7.04 = $63.36 | 44 x $7.04 + 36 x $0.80 + 44 x $0.0105 = $339.02 | $309.76 | $20 to $31 | $480 minus ledger spend so far |

With /learn's planning spend of about $25 to $40, office-hours gets a cap of about $440 to $455. Three batches need far less than that. The sixth batch, the last rerun trial, starts only if spend so far is at most the cap minus $339.02, so at the planning figures it is borderline and at the high end it does not start. A cap stop at any point means an incomplete run, reported as one and never retried to change a verdict.

**before2 fallback.** If Garry won't go to $500: the $390 design without before2, with `--no-noise-floor` on office-hours (batch worst case 33 x $7.04 + 27 x $0.80 + 33 x $0.0105 = $254.27, calibration worst case $56.32), every other rule unchanged.

Without before2, any REGRESSION on 3 trials can't be told from panel noise, and MISS and the pooled sign-flip gate, which need before2, do not run. GSTA-41's view is to keep before2: it adds $18 to $36 of expected spend and is the run's only check on panel noise, which in GSTA-13 held the main run's REGRESSION on second-opinion-offer.

## Order of work

1. Garry approves the cap. The Captain keeps his words and the approval record in the Captain drive, and records each call's line item as above.
2. On the run machine: the claude and codex CLIs on PATH, `gstack-evals doctor` for each host, a full gstack clone under `<state>/sources/` and the four arm folders exported as above.
3. The calls in the table's order, each started as a background operation with its own line item and `--ledger-record` in the Captain drive, and this post's commit in the run notes. Every call checks its stop rules (persona fallback, JUDGE_ALLOWANCE, the smoke) before its next stage.

## Out of scope

Changing gstack, any paid call (calibration included) before Garry's cap is approved, and results, which go in a separate pull request.
