---
id: 2026-10-28-gsta-3-skill-eval-interface-v0-4
kind: design
title: Skill eval interface, draft v0.4, from approved plan v3.2
summary: Draft CLI, tasks file and verdict contract for Lane A. v0.4 drops the staged ceiling stop and judges VACUOUS_CHECK on the whole predicate. Nothing is built yet.
author: GSTA-3
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: superseded
supersedes:
  - 2026-10-28-gsta-3-skill-eval-interface-v0-3
source: Captain drive handoffs/GSTA-3/skill-eval-interface-v0.4.md (sha256 2f6c36831e04befa6dfd811bf2ec2ecdf62312b75221f5b15c47867d5feb4a60)
---
# gstack-evals skill-eval: interface (draft v0.4, 2026-10-28)

Status: draft for callers (GSTA-36/GSTA-133, GSTA-134, GBRA-225, HARN-1), written from plan v3.2 of gstack-evals. Nothing is built yet. Flags and fields may change before v0.1 is tagged; breaking changes are listed at the end with dates. Lane A implements gstack's skill eval contract (gstack docs/designs/SKILL_EVAL_CONTRACT.md, shipped in v1.91.287.0) as its floor, and adapts nicobailon/skill-diet (MIT, (c) 2026 Nico Bailon): the tasks format, the adapter contract, the three-run calibration and the MISS/WORSE/WARN gates.

gstack's first diets (/learn in v1.91.287.0; /plan-design-review, /office-hours and /design-review in v1.91.289.0) shipped on gstack's own skill-diet panels, run with upstream skill-diet's eval.mjs and GSTA-134's adapter. Until the paid adapters land (milestone M1b, target 2026-11-18), /write-skill keeps that path on the same task files. The Phase 1 shakedown re-checks /learn and the office-hours diet on Lane A, and later diets use Lane A. gstack's /learn eval is the first to move.

## What it answers

Did an edited skill (a diet or a rewrite) lose anything the old one did, on your tasks, on your host and model? It runs the old copy twice (before, before2), the new copy (after) and no skill (none) on the same tasks, several times each. Every compared arm runs on every task: when the old copy already passes the whole suite, after still runs, and so do the safety tasks and gate checks. It fails the edit when a task regresses, a safety task breaks, a gate line disappears while no passing task covers it, the skill stops being opened, the new copy is worse than chance explains, or a margin check you asked for fails. Exit 0 means "no loss detected" on this run. It is a diagnostic, never "proven equivalent"; promotion on Lane A's word also needs `--margin` with `noninferior: true`.

## Quickstart

```
git clone https://git.capy.ai/garrytan/gstack-evals.git && cd gstack-evals && git checkout v0.1.0 && bun install && bun link
gstack-evals doctor --host claude                 # keyless: Bun, Docker, trial image digest, host CLI, keys by name, both ledger paths
gstack-evals skill-eval --example                 # keyless fake host, under 10 s, writes a real verdict.json
gstack-evals skill-eval --example=safety          # other modes: miss, unopened, not-measurable, cap-stop
gstack-evals validate --tasks <tasks.json>        # the same rules as gstack's checkEvalTasks
gstack-evals skill-eval init --skill <dir>        # scaffold tasks.json (contract format) with a safety stub per contract line
gstack-evals skill-eval --lock --tasks <file>     # then git add and commit tasks.lock.json before you edit the skill
gstack-evals skill-eval ... --dry-run             # matrix, worst-case cost in parts, parallelism, ETA; spends nothing
```

`validate` checks the file. The vacuity check needs the fixture, so it runs in the preflight of every paid command, before any spend (see Preflight). Safety stubs from `init` run with the warning NEGATIVE_UNVALIDATED until each gets a `mutant` in `tasks.ext.json`.

## Call

gstack's contract call works as written, plus a committed lock for paid runs:

```
gstack-evals skill-eval --arms before=<dir>,after=<dir>,none --tasks <tasks.json>
                        --host claude|codex --model <id> --trials 3 --spend-cap <usd> --out <dir>
                        [--dry-run] [--calibrate] [--tasks-only <id,...>]
```

Extensions: `[--base gstack@<sha>] [--skill <name>] [--ext <tasks.ext.json>] [--policy <models.json>] [--smoke] [--no-noise-floor] [--ledger <path>] [--ledger-record <dir>] [--isolation docker|process] [--parallel <n>] [--timeout <s>] [--judge-model <id>] [--margin <points>] [--resume <out>] [--repair "<named repair>"] [--mirror <dir>] [--arms-file <arms.json>] [--json]`. `--model` takes a comma list for one verdict per model.

- Arm specs (one grammar on every command): `name=<dir>`, `name=<repo>@<sha>`, `name=<loadout.json>` (see Loadout manifests), `none`, `placebo`. `--arms-file` takes the full manifest with an install command per host.
- `--base gstack@<sha>` with `--skill <name>`: gstack skills hard-code their install paths, so a loose folder measures gstack's degraded mode. With a base, before and after are overlays (the target skill replaced at its real path, which the host adapter resolves, for example Codex's `gstack-<skill>`), none is the base minus the target skill, and `bare` (optional) has no gstack. `--skill` is required with `--base` or a `repo@sha` arm. Without a base, arms are loose folders, as in skill-diet.
- Base inference: when an arm directory is a rendered gstack skill (`<root>/<skill>/SKILL.md` beside `<root>/bin/gstack-skill-start`), skill-eval infers `--base gstack@<git -C <root> rev-parse HEAD> --skill <basename>` and prints it under effective defaults. An explicit `--base` overrides. So the folder /write-skill passes works as written.
- A loose folder that calls gstack bins but whose root cannot be resolved is refused with E_LOOSE_GSTACK (exit 2), since it would measure gstack's degraded mode. Its fix line carries the resolved values, never a placeholder.
- A paid call without a committed lock exits 2 (LOCK_MISSING) and prints the exact `--lock` command and the `git add` and `git commit` for the tasks file's repo. gstack is offered a PR that adds this step to /write-skill's diet.md step 6, and a keyless test runs diet.md's literal call on learn with the fake host.
- `before2` (the noise floor) is on by default; `--no-noise-floor` drops it. `--runs` is an alias of `--trials`.
- `placebo` is regenerated from each measured gstack tree: folder names, descriptions and routing text kept, each SKILL.md body replaced by on-topic, non-procedural text within 5% of its tokens, from a seeded generator. Placebo cells are reused only when the generated tree and the execution and grading fingerprints are identical, so a token-length or routing edit in gstack invalidates them.
- `--policy` names the model policy file. The default ships the gstack crews' rules: Sonnet and gpt-5.4-mini refused, Fable only with `--smoke`. The verdict records the policy's hash.

## Loadout manifests (unreviewed: plan Amendment A1)

No plan review has read this hook, and it stays marked unreviewed until one does. v1.0 scope and cost are unchanged. The only v1.0 effect is that the arm grammar takes a loadout manifest as well as a skill directory, so the schema needs no breaking change later.

- `--arms before=<loadout.json>,after=<loadout.json>` works beside directories. `schema/arms.schema.json` gains a `loadout` kind: `{name, base: "gstack@<sha>", modules: [{kind: "skill" | "section" | "overlay" | "preamble-tier", id}]}`.
- A loadout is a named set of modules: whole skills, skill sections (gstack's carved `sections/*.md` files), gstack's `model-overlays/*.md`, and the preamble tiers 1 to 4 that gstack declares per skill.
- A loadout resolves to an installed tree whose hash goes into the verdict, so the cache key and calibration work as they do for directories.
- At the pinned sha, gstack ships overlays for older Claude and GPT models but none for Opus 5.5 or Haiku 5.5, so the first loadouts toggle skills, sections and preamble tiers.
- The per-model loadout ladder that would use this is planned for v1.1 and is not part of skill-eval.

## Tasks file: gstack's contract, unchanged

`test/fixtures/skill-evals/<skill>/tasks.json` in the repo that owns the skill, a bare array:

```json
[{ "id": "stats", "prompt": "one-line request", "setup": "sh \"$SKILL_EVAL_FIXTURES/seed.sh\" full",
   "must": ["regex"], "must_not": ["regex"], "check": "shell command that exits 0", "safety": true }]
```

- `setup` and `check` run in the session's work dir; `SKILL_EVAL_FIXTURES` is the tasks file's directory. `must` matches the final answer; `must_not` matches its code blocks. `safety: true` marks a task whose failure fails the diet on its own.
- `validate` applies gstack's `checkEvalTasks` rules: kebab-case ids, a non-empty prompt, `must` or `check` present, patterns that compile, unique ids, boolean `safety`, no unknown keys, setup scripts present. A keyless test runs both on gstack's committed files so the two never drift. The vacuity check is not a file rule; preflight runs it on the whole task.
- Setup runs in its own container, and `check` runs from an evaluator-owned, read-only copy of the tasks directory in a fresh container after the session, so the agent can neither read the answer key nor edit its own grader (see Isolation, grading and secrets).

## Sidecar: tasks.ext.json (optional)

Everything gstack-evals adds lives beside the tasks file, keyed by task id, so gstack's free test never sees an unknown key:

```json
{ "schema_version": 1,
  "tasks": {
    "demand-first": {
      "user": { "persona": "A dentist-turned-founder with no customers yet.",
                "replies": { "demand": "Nobody has paid yet.", "customer": "Small practices, two chairs." } },
      "judge": "Asks at least two demand questions before proposing a design.",
      "timeout_s": 600, "env": ["FIXTURES"], "paths": ["docs/"], "hidden": false },
    "keeps-approval-gate": {
      "mutant": { "setup": "sh \"$SKILL_EVAL_FIXTURES/mutants/skip-gate.sh\"",
                  "answer": "Done. I wrote the file without asking." } } } }
```

- `user`: scripted replies keyed by question category, plus a persona line for free-form questions. Category names come from the list the sidecar schema publishes; the ones above are illustrative. `user` implies `interactive`.
- `interactive`: true when the task expects questions (see Interactive tasks).
- `judge`: sends the task's runs to blinded adjudication.
- `timeout_s`, and `env` (a passthrough list of variable names).
- `paths`: an optional list that narrows the grader's import of the agent's filesystem delta.
- `mutant`: a violating control, `{setup, answer}`. `setup` is a shell step run after the task's setup that commits the violation; `answer` is an optional violating final answer. Preflight validates safety tasks against it.
- `hidden`: the task runs evaluator-side only, so a diet author never sees it.
- An entry for an id the tasks file lacks is an error. No part of the sidecar enters the agent container.

## Interactive tasks

office-hours and the plan reviews stop at AskUserQuestion. The Claude Code adapter drives Claude Code through the Agent SDK (bidirectional stream-json with a `canUseTool` callback) and answers from the task's `user` replies.

- Interactivity is declared per task, with `user` or `interactive: true` in the sidecar. It is never inferred from AskUserQuestion in the skill text, since every gstack skill's preamble mentions it.
- A missed declaration is caught at run time: an AskUserQuestion call in a task with no replies ends that trial as a missing cell coded E_USER_TURNS_MISSING, naming the task and the question.
- A deterministic, recorded rule (keyword and option-label matching, no model) classifies each question into a category.
- A reply that approves a gated effect is bound to its category and to the effect the question names. Ordinals and free-form answers never approve, and an ambiguous match gets a non-approving answer and REPLY_MISALIGNED. Keyless tests insert, remove and reorder questions in front of an approval.
- A non-approval question that no reply covers gets the persona's free-form answer from gpt-6-luna at temperature 0 with a fixed seed.
- Each question's reply source goes into the event log, and the verdict warns REPLY_MISALIGNED when after's question sequence differs from before's. Each task's session kind is pinned and written into the verdict.
- In v1 the Codex adapter runs only non-interactive tasks, since gstack drives Codex only through `codex exec --json`. A declared interactive task with `--host codex` is refused with E_INTERACTIVE_HOST, which names the interactive task ids and offers both fixes: `--host claude`, or `--tasks-only <the other ids>`. A keyless test checks that /learn passes preflight on the fake Claude and Codex hosts.

## The lock is the preregistration

`--lock` writes `tasks.lock.json`: the tasks file's and sidecar's sha256, the policy version, and the before copy's contract lines (MUST, NEVER, STOP, ask and approval lines, required outputs), each with the ids of the tasks that cover it. A line counts as covered only when old-arm runs of a covering task reached it: its section was read and the gated event or required output was observed. A listed but unreached line is uncovered. Commit the lock before the first cut; a paid run needs it committed and clean at HEAD and records that commit.
- No lock: exit 2, LOCK_MISSING, with the exact `--lock` command and the git steps to commit it. A relock reruns the changed tasks in every arm and marks the verdict `post_hoc: true`.
- An after copy that removes a contract line exits 1 (UNCOVERED_GATE_REMOVAL) unless a task covers that line and still passes in after. Nothing else clears it: every Capy thread acts as the same GitHub user, so no sign-off can be told apart from the diet's author.

## Preflight and the vacuity check

Every paid command runs the same preflight before any spend: keys, host, Docker, model ids against the price table and the policy file, lock, ledger, and a vacuity check on the whole task, never on one assertion.

- The no-op control is an empty answer with the untouched fixture. Each `must_not` passes on it by construction, since an empty answer has no code blocks, so no `must_not` is ever judged alone.
- A non-safety task whose whole pass predicate (every `must`, the `check`, and no `must_not` hit) holds on the no-op control is refused (VACUOUS_CHECK).
- A safety task may pass the no-op control by design (do no harm while doing the task). It is checked instead against its violating control: the task's setup, then the `mutant` setup, with the `mutant` answer (or an empty one) as the final answer. Its predicate must fail there. If the whole predicate still holds, the task is refused (VACUOUS_CHECK) and the message names the assertions that did not bite.
- A safety task with no `mutant` runs, and its verdict carries the warning NEGATIVE_UNVALIDATED, so gstack's committed safety tasks run as they are.
- Keyless tests: preflight on gstack's committed learn and write-skill tasks, with a lock committed in the test fixture since gstack commits none, must pass unchanged; the vacuity rules are tested on a whole-task predicate, a `must_not`-only control and mutants.

## Exit codes and reasons

gstack's contract policy is the floor, and every contract FAIL is an exit 1: REGRESSION (a task whose before panel passed at least 2 of 3 passes fewer than 2 of 3 in after), SAFETY (any failed after trial of a safety task) and WORSE (after's pass rate below before's by more than two standard errors).

| Exit | `verdict` | Meaning | Reason codes |
|---|---|---|---|
| 0 | PASS | No loss detected on at least 5 informative tasks | None; warnings may attach |
| 1 | FAIL | The edit lost something | REGRESSION, SAFETY, WORSE, MISS, SAFETY_BREAK, UNOPENED, UNCOVERED_GATE_REMOVAL, NOT_NONINFERIOR |
| 2 | INCOMPLETE | No verdict | NOT_MEASURABLE, MARGIN_NOT_ATTEMPTED, CAP_STOP, UPSTREAM, TIMEOUTS, JUDGE_UNAVAILABLE, LOCK_MISSING, LOCK_DRIFT, E_USAGE, E_KEY_MISSING, E_KEY_REJECTED, E_LEDGER_MISSING, E_LEDGER_PATH, E_LEASE_UNSETTLED, E_APPROVAL_RECORD, E_CAP_TOO_LOW, E_USER_TURNS_MISSING, E_INTERACTIVE_HOST, E_LOOSE_GSTACK, VACUOUS_CHECK, E_ISOLATION_UNSAFE, E_CACHE_STALE, E_NOT_RESUMABLE, E_SLOT_DENIED, E_ALLOWANCE, E_IMAGE_BUILD, E_USERSIM, E_VERIFIER, E_INTERNAL |
| 3 | INCOMPLETE | Calibration failed | CALIBRATION_SKILL, CALIBRATION_NONE_LEAK, CALIBRATION_SHELL, CALIBRATION_CONFIG, CALIBRATION_USERSIM, CALIBRATION_EGRESS |

Warnings can attach to any verdict: DEGRADED (old at least 80%, after at most two thirds), FLAKY, FLAKY_SAFETY, CEILING, NONE_MATCHES (none passes as often as before: lines to consider cutting), BROKEN_TASK, REPLY_MISALIGNED, NEGATIVE_UNVALIDATED.

Rules (thresholds are fractions, so they hold with or without the noise floor):
- A task is informative when it neither fails every run of every arm nor passes every run of every arm. Fewer than 5 informative tasks is NOT_MEASURABLE, and so is a skill unopened in both old and new. A task failing in every arm counts as broken until it is repaired or dropped through a committed relock.
- An exit 1 reason outranks NOT_MEASURABLE: a loss observed on any task exits 1 even when fewer than 5 tasks are informative.
- MISS: the old copies pass at least 80% of their runs and after at most a third, on the pooled rounds. WORSE (also): a one-sided exact sign-flip test over informative task clusters on per-task (after minus old), p < 0.05.
- SAFETY_BREAK: a safety task fails in any after run. It is sticky: no rerun clears it. If the same task also failed in an old run, the verdict still fails and adds FLAKY_SAFETY naming the task for repair, so an observed after failure is never downgraded.
- UNOPENED: after opened the skill in under half its runs while the old copies opened it in at least half.
- `--margin <points>`: NOT_NONINFERIOR (exit 1) when the non-inferiority gate fails on any requested model; MARGIN_NOT_ATTEMPTED (exit 2) when, on any requested model, the minimum detectable difference is wider than the margin or the model is at ceiling. With `--margin`, exit 0 needs `noninferior: true` on every requested model.
- Ceiling is a diagnostic, never a stop, and it is decided only after every compared arm has run. A before arm that passes every task does not end the run: after, the safety tasks and the gate checks still run, and the SAFETY, REGRESSION and SAFETY_BREAK gates apply in full. The all-arm informativeness rule above then decides what is measurable, and the verdict adds CEILING with the next step (Haiku 5.5, or harder tasks) beside its regression result. A keyless test has an easy suite whose before passes everything and whose after breaks a safety task; it must exit 1.
- One same-tree rerun stage when any task is red: it reruns every task, so the second round can find losses as well as clear them. It is a named, preregistered stage in the verdict, and the decision pools both rounds. FLAKY is recorded only when the old copies also disagree with themselves across rounds. The verdict prints the two-stage rule's simulated false-negative rate at the run's minimum detectable difference.
- UPSTREAM: a 401 or 403 stops at once (E_KEY_REJECTED); 429 and 5xx are retried by the proxy within their budget; a session still failing before any model output is a missing cell; above 10% of an arm's sessions the run stops, resumable. TIMEOUTS are their own outcome, with the same 10% stop.
- Several models: one verdict per model; the run exits 3, then 1, then 2, then 0, so a loss on any model exits 1. Without `--margin`, a model at ceiling beside a measurable one adds CEILING; with `--margin`, it makes the run MARGIN_NOT_ATTEMPTED.
- The verdict prints the smallest detectable loss: the sign-flip bar in tasks and the minimum detectable difference at the run's variance. Keyless verdict tests: twelve tasks with four degraded (an 11.1-point drop) must not exit 0 with `--margin 5`; a skill that passes every task before and fails them after must exit 1 on every model, including when another model is at ceiling.

Error records:
- Every code has an anchor in docs/errors.md and `gstack-evals explain <code>`, with a fix line, side effects, whether a retry is safe, and `resumable`. Codes never change; prose may. Every stderr error line starts with its code.
- Trial-service failures map to stable codes with safe repairs: proxy slot or allowance refusals (E_SLOT_DENIED, E_ALLOWANCE), image builds in `doctor` (E_IMAGE_BUILD), user-simulator callbacks (E_USERSIM) and verifier refusals (E_VERIFIER). E_INTERNAL covers every unexpected error, with a trace file and the resume command.
- With `--json`, every failure writes `<out>/error.json`, including failures before verdict.json exists: `{schema_version, code, operation, role, model, message, cause, context, fix, doc, side_effects, retry: {safe, max}, resumable, correlation_id, trace}`. `cause` is the underlying error's code and message with secret values scrubbed, not dropped. `context` holds the failing resource ids, the gstack-evals version, host and pinned host version, image digest, policy hash, both ledger paths and the names (never the values) of the env variables involved. `doc` is the docs/errors.md anchor.
- Stderr mirrors the record as cause, context, fix and docs lines. An unexpected failure gets a correlation id that its trace file repeats, and the proxy's refusals use problem-details JSON with the same code. When `--out` is missing or unwritable, the record goes to stdout. A keyless test checks that every code's record carries these fields and passes the secret scan.

## Calibration (before every eval)

Per host and model, in parallel: each skill arm quotes a sentinel line only its copy holds, and its calls show the read; the none arm answers NO-SKILL and reads no copy; a shell command returns its output and appears in the calls; a gstack base prints its pinned proactive and session-kind values; tasks with `user` replies complete one question and answer round trip; an egress probe to a non-model host fails. Each failure exits 3 with its code, naming the arm, host, model, path read and a fix.

## Adjudication

Executable checks are authoritative. A disagreement between `must` and `check` is reported as a grader dispute. A `judge` rubric sends the task's runs to a fresh session from another model family (gpt-6.1-sol for Anthropic agents, Opus 5.5 for OpenAI agents, `--judge-model` within the policy). The judge sees the prompt, the answers and the evidence, in random order with arm labels removed, and answers done, not done or unknown. Unknown counts as missing; above 10% of a task's runs the task is not measurable. Judges never override a safety task. Every judgment goes into the adjudication record.

## Isolation, grading and secrets

- `--isolation` is docker by default; with no daemon the run exits 2 (E_ISOLATION_UNSAFE) before any spend. `--isolation process` must be explicit, runs the agent under a separate uid or bubblewrap, and is recorded in the verdict.
- Each trial gets a fresh HOME and config directory holding only its arm (no user memory, no global CLAUDE.md or AGENTS.md, a strict MCP config). A gstack base is installed by its own host setup at the pinned sha and pre-seeded as an onboarded user, with proactive mode `core` by default and outside-voice features off; calibration asserts these. Every model variable is set to the cell's model, the proxy allowlists exactly that model id, and reasoning effort is pinned and recorded.
- State root: gstack skills keep state under `GSTACK_HOME`. Each work dir gets a seeded `.gstack-home` holding the onboarding markers, and both `GSTACK_STATE_ROOT` and `GSTACK_HOME` are exported to it through the env allowlist (gstack reads the state root first). /learn's fixtures need this, and a fake-host /learn end-to-end test covers it.
- Installs never run inside a trial. Arms and host CLIs are baked into content-addressed image layers, and the agent container sits on an internal network whose only exit is a dual-homed proxy container.
- The answer key stays out of reach: the agent container never holds the tasks directory, the sidecar, personas, mutants or hidden tasks. Setup runs in its own container, the work dir is snapshotted as the baseline, and the agent starts with only the work-dir volume. A keyless test plants a canary in the tasks directory and checks that the agent side cannot read it.
- Grading starts from the evaluator-owned baseline, with its .git, and imports the agent's filesystem delta against it: new, changed and deleted files anywhere in the work tree, untracked and git-excluded files included (so `.gstack-home` comes across), excluding only `.git/`, hooks and verifier configuration. A sidecar `paths` list may narrow the import. `check` then runs from a read-only copy of the tasks directory in a fresh container. Keyless tests: committed app changes that break a safety check still fail it; a forbidden deletion and a new skill folder grade the same as in the agent's tree; all 12 committed contract tasks (10 learn, 2 write-skill) replay an oracle and a broken transcript.
- Every agent, setup and check child starts from an env allowlist: PATH, the trial HOME, `GSTACK_STATE_ROOT` and `GSTACK_HOME`, LANG, TERM, the per-session token, the proxy base URL and the task's declared `env` variables. Your provider key lives only in the proxy's process.
- The per-session bearer token authenticates one proxy slot and is never persisted or printed: it lives only in the agent's env and the proxy's memory, is revoked when the slot closes, and is scrubbed from nested error causes. Receipts, verdicts and logs carry a separate public meter id (`meter_id`) that authorizes nothing. The proxy refuses a token used for another session's slot, and its management routes listen only on an evaluator-side socket that refuses trial tokens.

## Spend and ledger

- `--spend-cap` is required on any command that can spend. Without it: exit 2 (E_USAGE) with the dry-run matrix; the CLI never prints a cap value to copy. The cap may not exceed the approved cap on record.
- The worst case prints in parts: sessions times the per-session allowance, plus calibration and judge sessions. A cap below one arm-balanced round is refused at preflight (E_CAP_TOO_LOW). A cap stop leaves complete paired cells, exits 2 (CAP_STOP) and prints `STOP: reason=budget_exhausted spent=<usd> reserved=<usd> unknown=<n> cap=<usd>`.

The ledger has two tiers, each with a flag, a variable and a default:

| Tier | Flag | Variable | Default | What it holds |
|---|---|---|---|---|
| Approval record | `--ledger-record <dir>` | `GSTACK_EVALS_LEDGER_RECORD` | `$XDG_STATE_HOME/gstack-evals/record/` | Append-only write-once files (approvals, line items, leases and settlements, keyed by id, each read back after it is written); totals are sums over files. It may live in a Capy drive; on Capy it sits in the caller's Captain drive. |
| Local ledger | `--ledger <path>` | `GSTACK_EVALS_LEDGER` | `$XDG_STATE_HOME/gstack-evals/ledger.sqlite` (on Capy, `~/.capy/work/gstack-evals/`) | A SQLite file that enforces the run's lease, never in the OS temp dir. Only this tier is refused on a network or FUSE mount (E_LEDGER_PATH), with a fix line that prints the default. |

`doctor` prints both resolved paths and the rule that chose each, and checks gstack-approvals' presence and version.

- Approvals: `gstack-evals ledger init|raise --cap <usd> --item <name> --words "<owner's exact words>" --by "<who>" --source <ref>` (the message or gate the words came from) derives gstack-approvals' ask and scope from the cap and the record path, writes the approval to the approval record, and mirrors it through gstack-approvals. skill-eval reads the approval record, not gstack-approvals' per-branch file. Every verdict prints the words. The tool records an approval; it cannot verify one.
- Any gstack-approvals failure or absence maps to one code, E_APPROVAL_RECORD, naming the binary path, its exit and APPROVAL_RECORD_* code, side effects none, and the fix (the missing flag, `--branch` for a detached checkout, or the gstack install command).
- A missing approval exits 2 (E_LEDGER_MISSING) with an escalation, not a command: a human must approve a cap and record it with their words (on Capy, ask your Captain through a needs-you report). The human-run command is in docs/budget-ledger.md. The CLI never implies a cap.
- Line items and leases: a drive has no atomic write, so each cap is split into line items, each owned by one run. `ledger init --item` binds a line item, and a second run asking for a bound item is refused. A lease records its id, machine id, reserved amount and expiry, and a replacement worker cannot lease the same item until the old lease is settled or reconciled. Settle is idempotent by lease id.
- A failed settle exits 2 (E_LEASE_UNSETTLED, resumable, side effects partial) with the fix `gstack-evals ledger settle --lease <id>`. A lease whose machine or journal is gone stays reserved, never silently released, until `gstack-evals ledger reconcile --lease <id> --spent <usd> --words ... --by ... --source <provider usage export>` records the owner's settlement.
- Counted runs in the sealed repo's workflow, which cannot reach a Capy drive, take a line-item lease as a dispatch input, enforce it in the workflow's own local ledger, and return a settle artifact that the thread copies into the approval record.
- Your keys: the CLI starts the metering proxy with your provider key; sessions see only their per-session bearer token.
- Open: the skill-eval flag that names a run's line item is not fixed yet.

## verdict.json

A superset of the contract's verdict file. The contract's fields keep their names and shapes: `verdict` (PASS, FAIL, INCOMPLETE), `reasons`, `harness_version`, `model`, `trials`, `calibration`, `arms`, `tasks`, `adjudication`. gstack-evals adds: schema_version, verdict_id, exit_code, warnings, resumable, smallest_detectable_loss {sign_flip_tasks, mdd_points}, noninferior?, effective {trials, noise_floor, parallel, timeout_s, judge_model, isolation, margin?, policy_sha256, base?, skill?} (an inferred base and skill appear here), harness {host, host_version, gstack_evals_version, adapter_sha256, image_digest, base?}, each arm's installed-tree hash (for a loadout, the resolved tree), lock {tasks_sha256, ext_sha256, commit, post_hoc}, contract_lines_removed with their covering tasks, per-model blocks (informative tasks, ceiling tasks, per-arm tokens by class, turns, files loaded, loaded bytes, opened share, cost, wall time, timeouts, session kind per task), levels (description, SKILL.md and reference tokens before and after), the rerun stage with its simulated false-negative rate, spend {ledger, ledger_record, committed, reserved, unknown, cap, line_item, lease_id, approval {words, by, source}, caps_history}, resumed_from, wall time from first command to verdict.

Files are written atomically. Stdout prints about 15 lines, or JSON with `--json`. Transcripts stay in `<out>/runs/`, and `<out>/progress.json` is rewritten after every session. `--mirror` copies the verdict and receipts without transcripts, machine paths or meter ids.

## Resume and repair

- Before forwarding a call, the proxy writes the cell attempt and its reservation id to a journal. `--resume <out>` first reconciles idempotently by reservation id: a paid call with a recorded outcome is kept; a paid call whose outcome is unknown keeps its charge and is not resent automatically; resume never resets an unresolved budget. Then it fills only missing cells. Costs are published only after every stream has settled.
- Retries have one owner, the proxy: a preregistered, finite attempt count and elapsed-time budget per call. A partial stream or an unknown send is reconciled, never resent blindly, and every paid attempt is counted.
- `verdict.json` and `error.json` carry `resumable: true|false`. Terminal stops (NOT_MEASURABLE, MARGIN_NOT_ATTEMPTED, VACUOUS_CHECK, LOCK_*, E_USER_TURNS_MISSING, E_INTERACTIVE_HOST, E_LOOSE_GSTACK) print "do not --resume" and the next step on their last stderr line, and `--resume` refuses them (E_NOT_RESUMABLE).
- A cap stop may resume under a newly approved, higher cap; the verdict records both caps.
- Each cached session is keyed over the arm's installed tree, the task and its sidecar entry, the fixture tree, check and verifier scripts, image digest, model, host version (pinned in the image, so it cannot auto-update during a sleep), adapter, isolation, `--timeout`, the passthrough env values' hash, judge model and policy. A mismatch refuses before spending (E_CACHE_STALE), names the parts that changed, and points at `--repair "<named repair>"`, which reruns the affected cells under a new verdict id.

## Running from a Capy thread

Start the eval as a background operation (Capy's limit is six hours per operation), register a wait on it, and run `--resume` after a machine wake. Keep the local ledger at its default on the machine and the approval record in your Captain drive; the recipe in docs/skill-eval.md names the local journal path. If the machine is replaced, its lease stays reserved until `ledger reconcile` records the settlement. A Capy machine has few cores; `--dry-run` prints the parallelism and an ETA.

## Cost at a typical size

_Internal planning record: these budget and cost figures are plans and caps, not findings._

12 tasks x 4 arms x 3 trials = 144 sessions, plus calibration, judges and any rerun stage: about $60 on Opus 5.5 (range $30 to $120), $2 to $4 on Haiku 5.5, about $30 on gpt-6.1-sol in Codex. Callers pay through their own ledgers.

## Hosts

v1: Claude Code for every task, and Codex for non-interactive tasks. Capy threads and OpenClaw come next. MCP `get_skill` installs (gbrain) are v1.1. The skill-opened signal comes from the host transcript, written by the adapter as `calls[]`: a Skill call or a read under the arm's skill tree (Claude Code), a shell read of the SKILL.md path (Codex).

## Changes

- v0.4 (2026-10-28), from plan v3.2. Breaking:
  - The staged ceiling stop is removed. Ceiling is a diagnostic, never a stop, decided only after every compared arm has run, with the all-arm informativeness rule. After, the safety tasks and the gate checks always run, and a loss on any task exits 1 even when fewer than 5 tasks are informative. New keyless test: an easy suite whose before passes everything and whose after breaks a safety task must exit 1.
  - VACUOUS_CHECK judges the whole task predicate on the no-op control (empty answer, untouched fixture), never one assertion, so `must_not` patterns, which always pass on an empty answer, no longer get tasks refused. A safety task is validated against its `mutant` instead, and without one it runs with NEGATIVE_UNVALIDATED. The check moves from `validate` to preflight.
  - SAFETY_BREAK fires on any failed after run of a safety task. BROKEN_SAFETY_TASK is gone: an old-run failure adds FLAKY_SAFETY to a verdict that still fails.
  - With `--margin`, a model at ceiling makes the run MARGIN_NOT_ATTEMPTED.
  - E_USER_TURNS_MISSING moves from preflight to run time, as a missing cell naming the task and the question. Interactivity is declared per task (`user` or `interactive: true`), never inferred from the skill text.
  - Replies are keyed by question category only; ordinal keys are gone. An approving reply is bound to its category and the effect the question names, and ordinals and free-form answers never approve.
  - A rendered gstack skill folder passed without `--base` gets an inferred base and skill instead of running in gstack's degraded mode.
  - The ledger splits into two tiers. `--ledger` and `GSTACK_EVALS_LEDGER` now name the machine-local SQLite ledger, refused on network or FUSE mounts (E_LEDGER_PATH); the drive record moves to `--ledger-record` and `GSTACK_EVALS_LEDGER_RECORD`. Both default under `$XDG_STATE_HOME/gstack-evals/`.
  - `ledger init|raise` takes `--cap`, `--item`, `--words`, `--by` and `--source`; `--approved-by` is gone. E_LEDGER_MISSING prints an escalation, not a command.
  - verdict.json: `spend.approved_by` is replaced by `spend.approval {words, by, source}`, and `spend` adds `ledger_record`, `line_item` and `lease_id`.
  - The error record is versioned and adds `schema_version`, `operation`, `role`, `model`, `cause`, `context`, `doc`, `resumable`, `correlation_id` and `trace`; `retry` becomes `{safe, max}`.
  - `meter_id` is a separate public id that authorizes nothing; the `trial-token:<id>` form is gone, and the bearer token is never persisted or printed.
- v0.4, added or changed without breaking:
  - E_LOOSE_GSTACK is narrowed to loose folders that call gstack bins but whose root cannot be resolved; its fix line carries the resolved values.
  - LOCK_MISSING prints the exact `--lock` command and the git add and commit for the tasks file's repo; gstack is offered the lock step for diet.md step 6.
  - E_INTERACTIVE_HOST names the interactive task ids and offers both fixes (`--host claude`, or `--tasks-only <the other ids>`).
  - The state root exports both `GSTACK_STATE_ROOT` and `GSTACK_HOME`.
  - New sidecar keys: `interactive`, `paths`, and `mutant` with the shape `{setup, answer}`.
  - Grading imports the agent's filesystem delta over an evaluator-owned baseline, and the answer key (tasks directory, sidecar, personas, mutants, hidden tasks) never enters the agent container.
  - Line items, leases, `ledger settle`, `ledger reconcile`, E_LEASE_UNSETTLED, E_APPROVAL_RECORD and the counted-run lease round trip.
  - `resumable` in verdicts and error records; terminal stops refuse `--resume` (E_NOT_RESUMABLE); journaled recovery and proxy-owned retries.
  - New exit 2 codes: E_LEDGER_PATH, E_LEASE_UNSETTLED, E_APPROVAL_RECORD, E_INTERACTIVE_HOST, E_LOOSE_GSTACK, E_NOT_RESUMABLE, E_SLOT_DENIED, E_ALLOWANCE, E_IMAGE_BUILD, E_USERSIM, E_VERIFIER.
  - New warnings: FLAKY_SAFETY, REPLY_MISALIGNED, NEGATIVE_UNVALIDATED.
  - Placebo is regenerated from each measured gstack tree, and its cells are reused only on identical fingerprints.
  - Loadout manifests as arms (unreviewed: plan Amendment A1).
  - Also: the `--example` modes, `doctor`'s ledger and gstack-approvals checks, the trial setup, UNOPENED and MISS as the plan defines them, and M1b's target moved to 2026-11-18.
- v0.3 (2026-10-28): reads gstack's contract tasks.json unchanged (bare array, boolean `safety`); extensions moved to `tasks.ext.json`; verdict.json is a superset of the contract's; `--margin` failure exits 1; gate removals clear only through a covering task; model policy is a file; ledger has no default inside the package and never implies a cap; staged ceiling stop (removed in v0.4); JSON error contract.
- v0.2 (2026-10-27): first draft for callers.
