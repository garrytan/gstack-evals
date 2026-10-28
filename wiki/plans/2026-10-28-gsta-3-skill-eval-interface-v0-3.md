---
id: 2026-10-28-gsta-3-skill-eval-interface-v0-3
kind: design
title: Skill eval interface, draft v0.3, pending the final plan gate
summary: Draft CLI, tasks file and verdict contract for the shared before/after skill eval (Lane A) that other repos code against. Nothing is built yet, and it may change before v0.1.
author: GSTA-3
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: superseded
source: Captain drive handoffs/GSTA-3/skill-eval-interface.md (sha256 d8fd67afc346a8e40734e7f74c3c9a442a067b1c7be146fe082ab57d84b4c555), copied by GSTA-6 on 2026-10-28
---
# gstack-evals skill-eval: interface (draft v0.3, 2026-10-28)

Status: draft for callers (GSTA-36/GSTA-133, GSTA-134, GBRA-225, HARN-1), written from plan v3 of gstack-evals. Nothing is built yet. Flags and fields may change before v0.1 is tagged; breaking changes are listed at the end with dates. Lane A implements gstack's skill eval contract (gstack docs/designs/SKILL_EVAL_CONTRACT.md, shipped in v1.91.287.0) as its floor, and adapts nicobailon/skill-diet (MIT, (c) 2026 Nico Bailon): the tasks format, the adapter contract, the three-run calibration and the MISS/WORSE/WARN gates.

Until the paid adapters land (milestone M1b, target 2026-11-11), /write-skill keeps running upstream skill-diet's eval.mjs with GSTA-134's adapter on the same task files. gstack's /learn eval is the first to move.

## What it answers

Did an edited skill (a diet or a rewrite) lose anything the old one did, on your tasks, on your host and model? It runs the old copy twice (before, before2), the new copy (after) and no skill (none) on the same tasks, several times each. It fails the edit when a task regresses, a safety task breaks, a gate line disappears while no passing task covers it, the skill stops being opened, the new copy is worse than chance explains, or a margin check you asked for fails. Exit 0 means "no loss detected" on this run. It is a diagnostic, never "proven equivalent"; promotion on Lane A's word also needs `--margin` with `noninferior: true`.

## Quickstart

```
git clone https://git.capy.ai/garrytan/gstack-evals.git && cd gstack-evals && git checkout v0.1.0 && bun install && bun link
gstack-evals doctor --host claude                 # keyless: Bun, Docker, builds the trial image and records its digest, host CLI, keys by name, ledger
gstack-evals skill-eval --example                 # keyless fake host, under 10 s, writes a real verdict.json
gstack-evals validate --tasks <tasks.json>        # the same rules as gstack's checkEvalTasks
gstack-evals skill-eval init --skill <dir>        # scaffold tasks.json (contract format) with a safety task per gate line
gstack-evals skill-eval --lock --tasks <file>     # then commit tasks.lock.json before you edit the skill
gstack-evals skill-eval ... --dry-run             # matrix, worst-case cost in parts, ETA; spends nothing
```

## Call

gstack's contract call works unchanged:

```
gstack-evals skill-eval --arms before=<dir>,after=<dir>,none --tasks <tasks.json>
                        --host claude|codex --model <id> --trials 3 --spend-cap <usd> --out <dir>
                        [--dry-run] [--calibrate] [--tasks-only <id,...>]
```

Extensions: `[--base gstack@<sha>] [--skill <name>] [--ext <tasks.ext.json>] [--policy <models.json>] [--smoke] [--no-noise-floor] [--ledger <path>] [--isolation docker|process] [--parallel <n>] [--timeout <s>] [--judge-model <id>] [--margin <points>] [--resume <out>] [--repair "<named repair>"] [--mirror <dir>] [--arms-file <arms.json>] [--json]`. `--model` takes a comma list for one verdict per model.

- Arm specs (one grammar on every command): `name=<dir>`, `name=<repo>@<sha>`, `none`, `placebo`. `--arms-file` takes the full manifest with an install command per host.
- `--base gstack@<sha>` with `--skill <name>`: gstack skills hard-code their install paths, so a loose folder measures gstack's degraded mode. With a base, before and after are overlays (the target skill replaced at its real path, which the host adapter resolves, for example Codex's `gstack-<skill>`), none is the base minus the target skill, and `bare` (optional) has no gstack.
- `before2` (the noise floor) is on by default; `--no-noise-floor` drops it. `--runs` is an alias of `--trials`.
- `--policy` names the model policy file. The default ships the gstack crews' rules: Sonnet and gpt-5.4-mini refused, Fable only with `--smoke`. The verdict records the policy's hash.
- `--isolation` is docker by default; with no daemon the run exits 2 (E_ISOLATION_UNSAFE) before any spend. Process mode must be explicit and is recorded.

## Tasks file: gstack's contract, unchanged

`test/fixtures/skill-evals/<skill>/tasks.json` in the repo that owns the skill, a bare array:

```json
[{ "id": "stats", "prompt": "one-line request", "setup": "sh \"$SKILL_EVAL_FIXTURES/seed.sh\" full",
   "must": ["regex"], "must_not": ["regex"], "check": "shell command that exits 0", "safety": true }]
```

- `setup` and `check` run in the session's work dir; `SKILL_EVAL_FIXTURES` is the tasks file's directory. `must` matches the final answer; `must_not` matches its code blocks. `safety: true` marks a task whose failure fails the diet on its own.
- `validate` applies gstack's `checkEvalTasks` rules: kebab-case ids, a non-empty prompt, `must` or `check` present, patterns that compile, unique ids, boolean `safety`, no unknown keys, setup scripts present. It also runs a vacuity check: a `check` or `must_not` that passes on an empty answer and the untouched fixture is refused (VACUOUS_CHECK).
- `setup` and `check` run from an evaluator-owned, read-only copy of the tasks directory, and checks run in a fresh container after the session, so the agent cannot edit its own grader.

## Sidecar: tasks.ext.json (optional)

Everything gstack-evals adds lives beside the tasks file, keyed by task id, so gstack's free test never sees an unknown key:

```json
{ "schema_version": 1,
  "tasks": { "demand-first": {
      "user": { "persona": "A dentist-turned-founder with no customers yet.",
                "replies": { "demand": "Nobody has paid yet.", "1": "Small practices, two chairs." } },
      "judge": "Asks at least two demand questions before proposing a design.",
      "timeout_s": 600, "env": ["FIXTURES"], "hidden": false } } }
```

- `user`: scripted replies keyed by question category or ordinal, plus a persona for free-form questions (gpt-6-luna, temperature 0, fixed seed). The Claude Code adapter answers AskUserQuestion through the Agent SDK permission callback; the Codex adapter through a PTY. A task on an interactive skill without `user` is refused at preflight (E_USER_TURNS_MISSING).
- `judge`: sends the task's runs to blinded adjudication. `hidden`: the task runs evaluator-side only.
- An entry for an id the tasks file lacks is an error.

## The lock is the preregistration

`--lock` writes `tasks.lock.json`: the tasks file's and sidecar's sha256, the policy version, and the before copy's contract lines (MUST, NEVER, STOP, ask and approval lines, required outputs), each with the ids of the tasks that cover it. A line counts as covered only when old-arm runs of a covering task reached it. Commit it before the first cut; a paid run needs it committed and clean at HEAD and records that commit.
- No lock: exit 2, LOCK_MISSING. A relock reruns the changed tasks in every arm and marks the verdict `post_hoc: true`.
- An after copy that removes a contract line exits 1 (UNCOVERED_GATE_REMOVAL) unless a task covers that line and still passes in after. No sign-off clears it.

## Exit codes and reasons

gstack's contract policy is the floor: REGRESSION (a task whose before panel passed at least 2 of 3 passes fewer than 2 of 3 in after), SAFETY (any failed after trial of a safety task) and WORSE (after's pass rate below before's by more than two standard errors) all exit 1.

| Exit | `verdict` | Meaning | Reason codes |
|---|---|---|---|
| 0 | PASS | No loss detected on at least 5 informative tasks | Warnings only: DEGRADED, FLAKY, CEILING, NONE_MATCHES, BROKEN_TASK |
| 1 | FAIL | The edit lost something | REGRESSION, SAFETY, WORSE, MISS, SAFETY_BREAK, UNOPENED, UNCOVERED_GATE_REMOVAL, NOT_NONINFERIOR |
| 2 | INCOMPLETE | No verdict | NOT_MEASURABLE, MARGIN_NOT_ATTEMPTED, BROKEN_SAFETY_TASK, CAP_STOP, UPSTREAM, TIMEOUTS, JUDGE_UNAVAILABLE, LOCK_MISSING, LOCK_DRIFT, E_USAGE, E_KEY_MISSING, E_KEY_REJECTED, E_LEDGER_MISSING, E_CAP_TOO_LOW, E_USER_TURNS_MISSING, VACUOUS_CHECK, E_ISOLATION_UNSAFE, E_CACHE_STALE, E_INTERNAL |
| 3 | INCOMPLETE | Calibration failed | CALIBRATION_SKILL, CALIBRATION_NONE_LEAK, CALIBRATION_SHELL, CALIBRATION_CONFIG, CALIBRATION_USERSIM, CALIBRATION_EGRESS |

Rules (thresholds are fractions, so they hold with or without the noise floor):
- A task is informative unless it fails every run of every arm or passes every run of every arm. Fewer than 5 informative tasks is NOT_MEASURABLE.
- MISS: the old copies pass at least 80% of their runs and after at most a third, pooled over rounds. WORSE (also): a one-sided exact sign-flip test over informative tasks, p < 0.05.
- SAFETY_BREAK: a safety task that passed every before and before2 run fails in any after run; no rerun clears it. A safety task that also fails in an old run is BROKEN_SAFETY_TASK (exit 2) until it is made deterministic.
- `--margin <points>`: NOT_NONINFERIOR (exit 1) when the non-inferiority gate fails; MARGIN_NOT_ATTEMPTED (exit 2) when the minimum detectable difference is wider than the margin.
- Staged ceiling stop: the before arm's first trial runs on every task first; if all pass, the run stops with NOT_MEASURABLE (CEILING) and names the next step (Haiku 5.5, or harder tasks).
- One same-tree rerun stage when any task is red: it reruns every task, is named in the verdict, and the decision pools both rounds.
- UPSTREAM: 401 or 403 stops at once (E_KEY_REJECTED); 429 and 5xx are retried by the proxy's limiter; a session still failing before any output is a missing cell; above 10% of an arm the run stops and `--resume` continues it.
- Several models: one verdict per model; the run exits 3, then 1, then 2, then 0, so a loss on any model exits 1. A ceiling model beside a measurable one adds CEILING instead of NOT_MEASURABLE.
- Every code has an anchor in docs/errors.md and `gstack-evals explain <code>`, with a fix line, side effects and whether a retry is safe. With `--json`, every failure writes `<out>/error.json` and prints `{code, message, fix, side_effects, retry}`, including failures before verdict.json exists.

## Calibration (before every eval)

Per host and model, in parallel: each skill arm quotes a sentinel line only its copy holds, and its calls show the read; the none arm answers NO-SKILL and reads no copy; a shell command returns its output; a gstack base prints its pinned proactive and session-kind values; tasks with `user` replies complete one question and answer round trip; an egress probe to a non-model host fails.

## Adjudication

Executable checks are authoritative. A disagreement between `must` and `check` is reported as a grader dispute. A `judge` rubric sends the task's runs to a fresh session from another model family (gpt-6.1-sol for Anthropic agents, Opus 5.5 for OpenAI agents, `--judge-model` within the policy). The judge sees the prompt, the answers and the evidence, in random order with arm labels removed, and answers done, not done or unknown. Unknown counts as missing; above 10% of a task's runs the task is not measurable. Judges never override a safety task.

## Spend and ledger

- `--spend-cap` is required on any command that can spend. Without it: exit 2 (E_USAGE) with the dry-run matrix; the CLI never suggests a cap value. The cap may not exceed the cap in your ledger.
- A cap below one arm-balanced round is refused (E_CAP_TOO_LOW). A cap stop leaves complete paired cells, exits 2 (CAP_STOP) and prints `STOP: reason=budget_exhausted spent=<usd> reserved=<usd> unknown=<n> cap=<usd>`.
- Ledger: `--ledger` or `$GSTACK_EVALS_LEDGER`, which on Capy should point into your Captain drive so an approved cap survives machine replacement. A missing ledger exits 2 (E_LEDGER_MISSING): "your Captain gets a cap approved by its person, then runs `gstack-evals ledger init --cap <usd> --approved-by <name>`". The CLI never creates a ledger or implies a cap. The verdict records `approved_by`.
- Your keys: the CLI starts the metering proxy with your provider key; sessions see only a per-session token, stored as `meter_id: "trial-token:<id>"` so secret scans pass. The proxy refuses a token used for another session's slot.

## verdict.json

A superset of the contract's verdict file. The contract's fields keep their names and shapes: `verdict` (PASS, FAIL, INCOMPLETE), `reasons`, `harness_version`, `model`, `trials`, `calibration`, `arms`, `tasks`, `adjudication`. gstack-evals adds: schema_version, verdict_id, exit_code, warnings, smallest_detectable_loss {sign_flip_tasks, mdd_points}, noninferior?, effective {trials, noise_floor, parallel, timeout_s, judge_model, isolation, margin?, policy_sha256}, harness {host, host_version, adapter_sha256, image_digest, base?}, lock {tasks_sha256, ext_sha256, commit, post_hoc}, contract_lines_removed, per-model blocks (informative tasks, ceiling tasks, per-arm tokens by class, turns, files loaded, loaded bytes, opened share, cost, wall time, session kind per task), levels (description, SKILL.md and reference tokens before and after), rerun stage, spend {ledger, committed, reserved, unknown, cap, approved_by, caps_history}, resumed_from, wall time from first command to verdict.

Files are written atomically. Stdout prints about 15 lines, or JSON with `--json`. Transcripts stay in `<out>/runs/`; `--mirror` copies the verdict and receipts without transcripts, machine paths or meter ids.

## Resume and repair

- `--resume <out>` first reconciles the ledger against the proxy's usage log, so a paid but unrecorded cell is charged, not repeated; then it fills only missing cells. A cap stop may resume under a newly approved, higher cap.
- Each cached session is keyed over the arm's installed tree, the task and its sidecar entry, the fixture tree, check and verifier scripts, image digest, model, host version, adapter, isolation, `--timeout`, the passthrough env values' hash, judge model and policy. A mismatch refuses (E_CACHE_STALE), names the parts that changed, and points at `--repair "<named repair>"`, which reruns the affected cells under a new verdict id.

## Running from a Capy thread

Start the eval as a background operation (Capy's limit is six hours per operation), register a wait on it, and run `--resume` after a machine wake. A Capy machine has few cores; `--dry-run` prints the parallelism and an ETA.

## Cost at a typical size

12 tasks x 4 arms x 3 trials = 144 sessions, plus calibration, judges and any rerun stage: about $60 on Opus 5.5 (range $30 to $120), $2 to $4 on Haiku 5.5, about $30 on gpt-6.1-sol in Codex.

## Hosts

v1: Claude Code and Codex. Capy threads and OpenClaw come next. MCP `get_skill` installs (gbrain) are v1.1. The skill-opened signal comes from the host transcript: a Skill call or a read under the arm's skill tree (Claude Code), a shell read of the SKILL.md path (Codex).

## Changes

- v0.3 (2026-10-28): reads gstack's contract tasks.json unchanged (bare array, boolean `safety`); extensions moved to `tasks.ext.json`; verdict.json is a superset of the contract's; `--margin` failure exits 1; gate removals clear only through a covering task; model policy is a file; ledger has no default inside the package and never implies a cap; staged ceiling stop; JSON error contract.
- v0.2 (2026-10-27): first draft for callers.
