---
id: 2026-10-30-gsta-36-u10-addendum-for-u11
kind: handoff
title: "U10 addendum for U11: what the last two U10 PRs changed and what is still open"
summary: An addendum to GSTA-35's U10 handoff. It records what the run-loop and adjudication PRs changed from the WIP branches, and lists every item U11, GST-272 and later units still own.
author: GSTA-36
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-30
status: open
links:
  - 2026-10-30-gsta-35-u10-host-adapters-handoff
  - https://github.com/garrytan/gstack-evals/pull/67
  - docs/adapters.md
  - docs/skill-eval.md
  - src/adapters/judge.ts
  - src/skill-eval/cli/run-host.ts
---

# U10 addendum for U11

GSTA-35's handoff (2026-10-30-gsta-35-u10-host-adapters-handoff) still describes the seams. This post records what changed when its two WIP branches landed, and what is still open. It ships in the adjudication PR, the second of the two.

## What changed from the WIP branches

- **`--calibrate` is built** (#67). It runs preflight, the rig and the calibration checks, then stops before any trial. It writes `<out>/calibration.json` and no verdict, and exits 3 on a failed check. `--dry-run --calibrate` prices only the calibration sessions, and the spend cap must cover them.
- **Calibration matches whole sentinels** (#67). Before this, `before2`, the noise floor's default copy, quoting its own line counted as quoting `before`'s, so every default run would have stopped with CALIBRATION_SKILL.
- **The rerun stage runs only the models with a red task** (#67). Rerunning every model made U6's `decide` throw.
- **`hostReadiness` refuses more** (#67): a loadout arm, which has no installer and would run empty, and a task with a user persona, whose free-form answers land with GST-272.
- **The judge has no tools** (adjudication PR). A judge session is one model request that declares no tools, sent from the judge's container through its own proxy slot (`src/adapters/judge.ts`). No host CLI runs, so a blinded judge cannot read the arm. The handoff's open item "the judge runs on a full host with its tools" is closed.
- **A resumed run keeps its funding** (adjudication PR). Preflight lets `--resume` spend from the line item bound to the run in `run.json`, and `--repair` keeps that run id for the lease while the verdict gets a new id. A terminal reason is matched by its code, so a run that ended NOT_MEASURABLE is E_NOT_RESUMABLE. A judged session is journaled only with its judgment, so a resume judges it again after a judge failure or cap stop. The judge's redaction matches whole words.
- **`--resume` and `--repair` live on the call** (adjudication PR). `--repair` without `--resume` is E_USAGE at call resolution, and the fake host refuses `--resume`. A test drives the CLI's run layer (`runOnRealHost` with the keyless rig) through E_NOT_RESUMABLE, journal reuse, E_CACHE_STALE and `--repair`.

## Still open

For U11 (Lane A shakedown):

1. No paid calibration has run. Start each rung with `--calibrate` under a ledger cap before any counted round.
2. An OpenRouter rung on Claude Code (particle-1) needs its calibration and a tool-use smoke first; OpenRouter guarantees Claude Code only on Anthropic models.
3. `JUDGE_ALLOWANCE` is 200k input and 40k output tokens. It is a reservation ceiling, not spend. Check it against the first real judge calls.
4. The judge request sets no reasoning effort, so a reasoning judge runs at its provider's default. Pin it in the preregistration if judged tasks count.
5. A full `bin/gstack-evals` run with `--resume` after a crash (preflight, the Docker rig, then proxy recovery and lease settlement) is covered only in parts: the CLI run layer with the keyless rig, `recoverRun`'s own tests, and the Docker rig test.
6. The fake host's rerun stage (`src/skill-eval/cli/run.ts`) still reruns every model, as the real host did before #67. A multi-model fake run where one model goes red makes `decide` throw.

7. Redaction replaces a skill's name with a visible `[redacted]` marker, and it shows up mostly in answers from arms that name their skill, so it can hint at the arm. `adjudication.ndjson` records the hit counts, but nothing gates on them yet.

For GST-272:

8. A gstack base at a sha, stack and placebo arms on real hosts, and `CALIBRATION_CONFIG`, which needs a base. The seams are in GSTA-35's handoff.
9. The persona's free-form model. `hostReadiness` refuses persona tasks until `hostDriver` passes a `freeform` source.

For later units:

10. `--mirror` is still unbuilt (U10's flag).
11. A loadout arm has no installer on a real host.
12. canUseTool does not see calls that Claude Code's own allow rules approve first. Grading reads the transcript, so it is unaffected; an SDK-side PreToolUse hook would close it.
13. Codex in exec mode answers `request_user_input` itself and reports nothing.
