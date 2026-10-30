# skill-eval for callers

`gstack-evals skill-eval` answers one question: did an edited skill (a diet or a rewrite) lose anything the old copy did, on your tasks, your host and your model? It runs the old copy twice (before, before2), the new copy (after) and no skill (none) on the same tasks, several times each, and writes a verdict. Exit 0 means no loss was detected on this run. It is a diagnostic, never proof that the two copies are equivalent.

This page is for callers: /write-skill (GStack Minder), HARN-1 and GBRA-225. It describes what gstack-evals v0.0.x (milestone M1a) has built. The design source is interface v0.5 (wiki/plans/2026-10-29-gsta-25-skill-eval-interface-v0-5.md); where this page and the interface differ, this page says what the code does today.

## What runs today

- Every check before spend: the contract, the host, the model policy, keys by name, the vacuity check, the lock, the ledger and the spend cap.
- `--dry-run`, `--example`, `doctor`, `explain`, `validate`, `init` and `--lock`.
- Full runs on the keyless fake host, which writes a real verdict through the verdict engine.

Real runs on Claude Code and Codex use the host adapters (src/adapters/claude-code/ and src/adapters/codex/), calibration and the real-host run loop (src/skill-eval/cli/run-host.ts) under `--isolation docker`. Arms on a real host are loose skill folders, `none` and `bare`. A gstack base at a sha (including the one inferred from a rendered gstack skill), a stack arm, a placebo arm and the persona's free-form model come with GST-272; until then such a call stops with E_USAGE naming GST-272 before anything is spent. So do tasks with a judge rubric, until blinded adjudication lands.

## Quickstart

```
bun install && bun link                           # from a gstack-evals checkout
gstack-evals doctor --host claude                 # Bun, Docker, the host CLI, keys by name, both ledger paths, gstack-approvals
gstack-evals skill-eval --example                 # keyless fake host: writes a real verdict.json and exits 0
gstack-evals skill-eval --example=miss            # other modes: safety, unopened, not-measurable, cap-stop
gstack-evals validate --tasks <tasks.json>        # the same rules as gstack's checkEvalTasks
gstack-evals skill-eval init --skill <dir>        # scaffold tasks.json with a safety stub per contract line
gstack-evals skill-eval --lock --tasks <tasks.json>
git add <tasks dir> && git commit -m "test: lock <skill> eval tasks"
gstack-evals skill-eval <call> --dry-run          # matrix and worst-case cost in parts; spends nothing
gstack-evals preflight <call>                     # every free check, then stop
gstack-evals explain <CODE>                       # a reason code's meaning, fix, side effects and retry safety
```

## The call

```
gstack-evals skill-eval --arms before=<dir>,after=<dir>,none --tasks <tasks.json>
                        --host claude|codex --model <id> --trials 3 --spend-cap <usd> --out <dir>
                        --item <line item> [options]
```

This is gstack's contract call, plus `--item`, the ledger line item the run spends from, and a committed lock.

- Arms take one grammar: `name=<dir>`, `name=<repo>@<sha>`, `name=<loadout.json>`, `none`, `placebo` and `bare`. before and after are required. The noise floor adds before2, a second copy of before, unless you pass `--no-noise-floor`.
- Base inference: when an arm is a rendered gstack skill folder (`<root>/<skill>/SKILL.md` beside `<root>/bin/gstack-skill-start`), skill-eval infers `--base gstack@<HEAD of root> --skill <name>` and prints it under the effective defaults. A loose folder that calls gstack bins but has no resolvable root is refused with E_LOOSE_GSTACK, since it would measure gstack's degraded mode. Its fix names the checkout's sha or the clone command.
- Every call prints its effective settings first, each with its source: a flag, a variable, a default or an inference.

## Flags

A flag row marked "not built" is refused with E_USAGE naming the unit that builds it. `gstack-evals skill-eval --help` prints the same table from the code.

| Flag | Default | What it does |
|---|---|---|
| `--arms` | required | The arms, in the grammar above. |
| `--tasks` | required | The contract tasks file, usually `test/fixtures/skill-evals/<skill>/tasks.json`. |
| `--host` | required | claude runs every task; codex runs non-interactive tasks only (E_INTERACTIVE_HOST names the others). |
| `--model` | required | Models under test, comma-separated, one verdict each. The policy must allow each as a subject. |
| `--trials` | 3 | Trials per task in each arm. |
| `--spend-cap` | required to spend | The run's dollar limit. It must be at most the line item's approved cap and at least one arm-balanced round. |
| `--item` | `GSTACK_EVALS_ITEM` | The ledger line item; never implied. |
| `--out` | `~/.capy/work/gstack-evals/runs/<run id>` on Capy, else `$XDG_STATE_HOME/gstack-evals/runs/<run id>` | The run directory: verdict.json, error.json and trace files. Never the OS temp dir or the tasks repo. |
| `--dry-run` | off | Print the matrix, the worst case in parts and the wall time; needs no key, ledger or lock. |
| `--calibrate` | off | Run only the calibration checks. Not built (U10). |
| `--tasks-only` | all tasks | Run only these task ids. |
| `--base` | inferred | `gstack@<sha>`: overlay the arms on this gstack tree; needs `--skill`. |
| `--skill` | inferred | The target skill's name inside the base. |
| `--ext` | `tasks.ext.json` beside the tasks file | The sidecar: interactive, judge, timeout_s, env, paths, mutant, hidden. |
| `--policy` | `policy/models.json` | The model policy file; the lock and the verdict pin its sha256. |
| `--smoke` | off | Allows the policy's smoke-only models (Fable in the default). |
| `--no-noise-floor` | off | Drop before2. |
| `--ledger` | `GSTACK_EVALS_LEDGER`, else the state dir | The machine-local SQLite ledger; refused on a network or FUSE mount. |
| `--ledger-record` | `GSTACK_EVALS_LEDGER_RECORD`, else the state dir | The approval record. On Capy, point it at your Captain drive. |
| `--isolation` | docker | process must be explicit. Under docker, preflight runs task controls in containers on the trial image `doctor` pinned; with no daemon it stops with E_ISOLATION_UNSAFE, and with no pin for this checkout's recipe with E_IMAGE_STALE. |
| `--parallel` | min(4, available parallelism) | Sessions at once. |
| `--timeout` | 600 | Seconds per session; a sidecar timeout_s overrides it per task. |
| `--judge-model` | the policy's default for the subjects' provider | The cross-family judge for tasks with a judge rubric. |
| `--margin` | none | A non-inferiority margin in percentage points; needed for `noninferior: true`. |
| `--resume` | none | Continue a stopped run. Not built (U10). |
| `--repair` | none | Rerun the cells a named repair affects. Not built (U10). |
| `--mirror` | none | Copy the verdict and receipts without transcripts. Not built (U10). |
| `--arms-file` | none | The full arm manifest. Not built (U9). |
| `--json` | off | Stdout carries JSON only: the verdict, the plan or the preflight result. Every failure writes `<out>/error.json`. |
| `--example` | off | A keyless fake-host example; takes only `--out` and `--json`. |
| `--help` | off | Print the call and every flag. |

## Preflight

`gstack-evals preflight <call>` and every `skill-eval` call run these steps before any spend, in order. Every step that can run does, so one call reports every stop.

1. **Contract.** The tasks file and sidecar follow the contract's rules (E_TASKS_INVALID); `--tasks-only` names real ids.
2. **Host.** Codex gets no interactive task (E_INTERACTIVE_HOST), and each model's provider runs on the host.
3. **Policy.** Each model is allowed for its role: subjects, the judge (always from another family than the subjects) and the user simulator (E_MODEL_POLICY).
4. **Keys.** Checked by name only; values are never printed (E_KEY_MISSING).
5. **Vacuity.** Each task's predicate must fail on its no-op control, and a safety task's on its mutant (VACUOUS_CHECK, or E_TASKS_INVALID when a control cannot run). A check that exits 2, ends with no exit code, or exits 126 or 127 for a command outside the work dir is an error, never a fail. A safety task without a mutant gets NEGATIVE_UNVALIDATED.
6. **Lock.** `tasks.lock.json` must be committed and clean at HEAD (LOCK_MISSING prints the exact `--lock` command and git steps). A changed tasks file, sidecar, policy, before copy or extractor, or a hand-edited row, is LOCK_DRIFT.
7. **Ledger and cap.** The line item needs an approved cap on record, and `--spend-cap` must fit within it and what is left (E_LEDGER_MISSING, E_ITEM_BOUND). A cap below one arm-balanced round is E_CAP_TOO_LOW. With no `--spend-cap`, the stop prints the dry-run matrix and never a cap to copy.
8. **PDF flag.** A task that sends a PDF gets the PDF_INPUT warning.
9. **Host adapter.** The fake host is ready. A real host is ready for loose skill folders, `none` and `bare` under `--isolation docker`; other arms stop here with E_USAGE naming GST-272.

`skill-eval --lock` runs the contract and vacuity checks first and refuses to lock a set that fails them, so a rebuilt task set is checked and locked fresh. It runs the controls in containers on the pinned trial image when Docker answers, and otherwise as you with the trial's env allowlist; its vacuity line says which.

## Spend

- The dry run prices every session at its allowance: 400k input and 32k output tokens per agent session, 60k and 4k per judged run, 80k and 5k per user-simulator session, at list price. The rerun stage doubles each part.
- One arm-balanced round is one trial of every task in every arm, for every model. A round that would pass the cap is not started, so a cap stop keeps complete paired cells, exits 2 with CAP_STOP and prints `STOP: reason=budget_exhausted spent=<usd> reserved=<usd> unknown=<n> cap=<usd>`.
- Approvals are recorded by a person with `gstack-evals ledger init|raise` and their exact words (docs/budget-ledger.md). The CLI never implies or suggests a cap.

## Run it from a Capy thread

A real run outlasts one tool call, so run it the way Capy runs long work:

1. Start the eval as a background operation. Capy's limit is six hours per operation; `--dry-run` prints the parallelism and an ETA first, and a Capy machine has few cores.
2. Register a wait on that operation and end the turn. The wait keeps the machine awake through the operation's own timeout and wakes the thread when it ends.
3. Keep `--out` at its default under `~/.capy/work`, which survives a wake, and the local ledger at its default on the machine. Point `--ledger-record` at your Captain drive.
4. While you wait, read `<out>/progress.json`: sessions done, passed, failed, timed out and missing, the cells still running and an ETA. It is rewritten whole after every session.
5. If the operation ended before the run did (the six-hour limit, or a machine that slept with no wait on it), run the same call with `--resume <out>` (not built until U10). Resume stops the proxy, reconciles its journal, then settles the lease (docs/adapters.md, Lane A), and a session whose cache key changed stops with E_CACHE_STALE before any spend.
6. If the machine is replaced, its lease stays reserved until `gstack-evals ledger reconcile` records the settlement from the provider's usage export.

On a VM that is deleted after the run, set `GSTACK_EVALS_EPHEMERAL=1` and `GSTACK_EVALS_RECEIPTS` to a directory that outlives it; the run copies its receipts and journal there before it exits.

## Model policy

The default policy, `policy/models.json`, lists the newest generation of each family. Opus 5.5, Sonnet 5.5, Haiku 5.5, gpt-6-astra, gpt-6.1-sol and gpt-6-luna may be subjects. Opus 5.5, Sonnet 5.5, gpt-6-astra and gpt-6.1-sol may also judge and adjudicate, and gpt-6-luna simulates the user. Fable 5.1 is allowed only with `--smoke`, and gpt-5.4-mini is refused. particle-1 and DeepSeek V4.1 Flash run through OpenRouter as subjects, with `OPENROUTER_API_KEY`: on `--host claude` through OpenRouter's Anthropic-compatible Messages route, and on `--host codex`. Any model the metering proxy cannot route and price is refused (E_MODEL_POLICY). Pass your own file with `--policy`; policy/examples/gbrain.json shows a narrower ladder.

The judge is chosen per preregistration, always from another family than the models under test. gstack's own runs prefer Opus 5.5 wherever that rule allows it, because Garry prefers Opus. This preference is stated here and not enforced in code: the default judge is Opus 5.5 for OpenAI and OpenRouter subjects and gpt-6.1-sol for Anthropic subjects, and `--judge-model` picks any judge the policy allows.

## Exit codes

| Exit | `verdict` | Meaning | Reason codes |
|---|---|---|---|
| 0 | PASS | No loss detected on at least 5 informative tasks | none; warnings may attach |
| 1 | FAIL | The edit lost something | REGRESSION, SAFETY, WORSE, MISS, SAFETY_BREAK, UNOPENED, UNCOVERED_GATE_REMOVAL, NOT_NONINFERIOR |
| 2 | INCOMPLETE | No verdict | NOT_MEASURABLE, MARGIN_NOT_ATTEMPTED, CAP_STOP, every LOCK_* and E_* code |
| 3 | INCOMPLETE | Calibration failed | CALIBRATION_SKILL, CALIBRATION_NONE_LEAK, CALIBRATION_SHELL, CALIBRATION_CONFIG, CALIBRATION_USERSIM, CALIBRATION_EGRESS |

An exit 1 reason outranks NOT_MEASURABLE. Warnings, such as CEILING, NONE_MATCHES, FLAKY and DEGRADED, never change the exit code. Every error line on stderr starts with its code, and the last lines give the fix and the docs anchor. docs/errors.md lists every code, and `gstack-evals explain <CODE>` prints one code's meaning, fix, side effects, retry safety and whether a run can resume.

## verdict.json

The contract's fields keep their names and shapes: `verdict`, `reasons`, `harness_version`, `model`, `trials`, `calibration`, `arms`, `tasks` and `adjudication`. gstack-evals adds the rest; schema/verdict.schema.json is the full definition.

- `exit_code`, `warnings`, `resumable` and `verdict_id`.
- `smallest_detectable_loss` and `noninferior` (null without `--margin`).
- `effective` (every setting the run used), `harness` (the host, its version, the adapter's sha256 and the image digest) and `arm_trees` (each folder arm's tree sha256).
- `lock` (the tasks and sidecar sha256 and the lock commit), `lock_drift` and `contract_lines_removed`.
- `models`, one block per model: its reasons, informative and ceiling tasks, per-arm outcomes, the opened share, the rerun stage and its simulated false-negative rate.
- `spend`, holding the ledger paths, committed, reserved, unknown, the cap, the line item and the approval words; then `resumed_from`, `wall_s` and `rig`.

`tasks` holds, for each task and arm, one entry per trial: true for a pass, false for a fail, null for no outcome. A fake-host verdict says `"host_version": "fake"`.

## Testing your integration without keys

`GSTACK_EVALS_FAKE_HOST=1` stands in a fake host for claude or codex. It runs no agent and no check: the old copies and after pass every task and none fails every task, and the verdict engine grades each record as it grades a real run. Set it to the path of a script file to choose outcomes per arm and task. Each outcome is one character per trial: 1 pass, 0 fail, t timeout. A script can also set which runs open the skill, give passing answers and set a per-session cost:

```json
{"arms": {"before": "1", "after": "1", "none": "0"}, "tasks": {"search": {"after": "0"}}, "opened": {"after": "001"}, "session_usd": 0.1}
```

`--example` runs the same machinery on a built-in skill, with no files of yours, in well under 10 seconds:

| Mode | Verdict | Exit |
|---|---|---|
| `--example` | PASS | 0 |
| `--example=miss` | FAIL (MISS) | 1 |
| `--example=safety` | FAIL (SAFETY, SAFETY_BREAK) | 1 |
| `--example=unopened` | FAIL (UNOPENED) | 1 |
| `--example=not-measurable` | INCOMPLETE (NOT_MEASURABLE) | 2 |
| `--example=cap-stop` | INCOMPLETE (CAP_STOP) | 2 |
