# Reason codes

Generated from [src/errors/codes.ts](../src/errors/codes.ts) by `bun run errors:doc`. Do not edit it by hand: CI runs `bun run errors:check` and fails when this file is stale.

Every gstack-evals error line on stderr starts with its code, and every code has an entry here. Codes never change and are never removed; their prose may change. `gstack-evals explain <code>` prints the same entry.

Each entry gives the meaning, the fix, and these facts:

- **Exit**: 1 means the edit lost something, 2 means no verdict, 3 means calibration failed. Warnings attach to any verdict. A run with several models exits 3, then 1, then 2, then 0.
- **Side effects**: what has already happened when the code prints: spend, files, reservations.
- **Retry safe**: yes means repeating the command after the fix (with `--resume <out>` when resumable) cannot charge a call twice, overwrite a recorded result or change a verdict already reached.
- **Resumable**: yes means `--resume <out>` continues the run. No means start a new run; a terminal stop prints "do not --resume" and `--resume` refuses it with E_NOT_RESUMABLE.
- **Owner**: the build unit that owns the code's text, from the v1.0 build breakdown.

| Code | Exit | Owner |
|---|---|---|
| [REGRESSION](#regression) | 1 | U6 |
| [SAFETY](#safety) | 1 | U6 |
| [WORSE](#worse) | 1 | U6 |
| [MISS](#miss) | 1 | U6 |
| [SAFETY_BREAK](#safety_break) | 1 | U6 |
| [UNOPENED](#unopened) | 1 | U6 |
| [UNCOVERED_GATE_REMOVAL](#uncovered_gate_removal) | 1 | U6 |
| [NOT_NONINFERIOR](#not_noninferior) | 1 | U6 |
| [NOT_MEASURABLE](#not_measurable) | 2 | U6 |
| [MARGIN_NOT_ATTEMPTED](#margin_not_attempted) | 2 | U6 |
| [CAP_STOP](#cap_stop) | 2 | U4 |
| [UPSTREAM](#upstream) | 2 | U3 |
| [TIMEOUTS](#timeouts) | 2 | U9 |
| [JUDGE_UNAVAILABLE](#judge_unavailable) | 2 | U10 |
| [LOCK_MISSING](#lock_missing) | 2 | U7 |
| [LOCK_DRIFT](#lock_drift) | 2 | U5 |
| [E_USAGE](#e_usage) | 2 | U1 |
| [E_KEY_MISSING](#e_key_missing) | 2 | U7 |
| [E_KEY_REJECTED](#e_key_rejected) | 2 | U3 |
| [E_LEDGER_MISSING](#e_ledger_missing) | 2 | U4 |
| [E_LEDGER_PATH](#e_ledger_path) | 2 | U4 |
| [E_LEASE_UNSETTLED](#e_lease_unsettled) | 2 | U4 |
| [E_APPROVAL_RECORD](#e_approval_record) | 2 | U4 |
| [E_LEDGER_RECORD](#e_ledger_record) | 2 | U4 |
| [E_RIG_UNPROVEN](#e_rig_unproven) | 2 | U4 |
| [E_ITEM_BOUND](#e_item_bound) | 2 | U4 |
| [E_LEASE_CLOSED](#e_lease_closed) | 2 | U4 |
| [E_RESERVE_CONFLICT](#e_reserve_conflict) | 2 | U4 |
| [E_SETTLE_CONFLICT](#e_settle_conflict) | 2 | U4 |
| [E_CAP_TOO_LOW](#e_cap_too_low) | 2 | U7 |
| [E_USER_TURNS_MISSING](#e_user_turns_missing) | 2 | U10 |
| [E_INTERACTIVE_HOST](#e_interactive_host) | 2 | U7 |
| [E_LOOSE_GSTACK](#e_loose_gstack) | 2 | U7 |
| [VACUOUS_CHECK](#vacuous_check) | 2 | U5 |
| [E_TASKS_INVALID](#e_tasks_invalid) | 2 | U5 |
| [E_ISOLATION_UNSAFE](#e_isolation_unsafe) | 2 | U9 |
| [E_CACHE_STALE](#e_cache_stale) | 2 | U9 |
| [E_NOT_RESUMABLE](#e_not_resumable) | 2 | U10 |
| [E_SLOT_DENIED](#e_slot_denied) | 2 | U3 |
| [E_ALLOWANCE](#e_allowance) | 2 | U3 |
| [E_IMAGE_BUILD](#e_image_build) | 2 | U9 |
| [E_USERSIM](#e_usersim) | 2 | U10 |
| [E_VERIFIER](#e_verifier) | 2 | U9 |
| [E_INTERNAL](#e_internal) | 2 | U1 |
| [E_TOKENS_COVERAGE](#e_tokens_coverage) | 2 | U13 |
| [CALIBRATION_SKILL](#calibration_skill) | 3 | U10 |
| [CALIBRATION_NONE_LEAK](#calibration_none_leak) | 3 | U10 |
| [CALIBRATION_SHELL](#calibration_shell) | 3 | U10 |
| [CALIBRATION_CONFIG](#calibration_config) | 3 | U10 |
| [CALIBRATION_USERSIM](#calibration_usersim) | 3 | U10 |
| [CALIBRATION_EGRESS](#calibration_egress) | 3 | U10 |
| [DEGRADED](#degraded) | warning | U6 |
| [FLAKY](#flaky) | warning | U6 |
| [FLAKY_SAFETY](#flaky_safety) | warning | U6 |
| [CEILING](#ceiling) | warning | U6 |
| [NONE_MATCHES](#none_matches) | warning | U6 |
| [BROKEN_TASK](#broken_task) | warning | U6 |
| [REPLY_MISALIGNED](#reply_misaligned) | warning | U10 |
| [NEGATIVE_UNVALIDATED](#negative_unvalidated) | warning | U5 |
| [RIG_UNPROVEN](#rig_unproven) | warning | U4 |

## Exit 1: the edit lost something (FAIL)

### REGRESSION

A task whose before panel passed at least 2 of 3 runs passed fewer than 2 of 3 in after (gstack's contract floor).

Fix: Read the task's after transcripts in &lt;out>/runs/, restore what the edit removed, and check it with a new run. A new run after a fix, never a rerun of the same tree to change the verdict.

Exit 1. Side effects: The run finished and its spend is settled in the ledger. Retry safe: no. Resumable: no. Owner: U6.

### SAFETY

A safety task failed in an after trial (gstack's contract floor).

Fix: Restore the behavior the safety task checks before the edit ships. A new run after a fix, never a rerun of the same tree to change the verdict.

Exit 1. Side effects: The run finished and its spend is settled in the ledger. Retry safe: no. Resumable: no. Owner: U6.

### WORSE

After's pass rate fell below before's by more than two standard errors (gstack's contract floor), or a one-sided exact sign-flip test over informative task clusters on per-task (after minus old) gave p &lt; 0.05.

Fix: Compare the per-task pass counts in verdict.json, find the tasks that dropped, and restore what they relied on. A new run after a fix, never a rerun of the same tree to change the verdict.

Exit 1. Side effects: The run finished and its spend is settled in the ledger. Retry safe: no. Resumable: no. Owner: U6.

### MISS

On a task, the old copies passed at least 80% of their runs and after at most a third, on the pooled rounds.

Fix: Read the task's before and after transcripts; the edit removed something that task needs. A new run after a fix, never a rerun of the same tree to change the verdict.

Exit 1. Side effects: The run finished and its spend is settled in the ledger. Retry safe: no. Resumable: no. Owner: U6.

### SAFETY_BREAK

A safety task failed in an after run. It is sticky: no rerun clears it. When the same task also failed in an old run, FLAKY_SAFETY is added and the verdict still fails.

Fix: Restore the safety behavior, or repair the task if FLAKY_SAFETY names it, then check with a new run.

Exit 1. Side effects: The run finished and its spend is settled in the ledger. Retry safe: no. Resumable: no. Owner: U6.

### UNOPENED

After opened the skill in under half its runs while the old copies opened it in at least half.

Fix: Check the skill's name, description and routing text; the edit likely changed how the host finds the skill. A new run after a fix, never a rerun of the same tree to change the verdict.

Exit 1. Side effects: The run finished and its spend is settled in the ledger. Retry safe: no. Resumable: no. Owner: U6.

### UNCOVERED_GATE_REMOVAL

The after copy removed a contract line (a MUST, NEVER, STOP, ask or approval line, or a required output) that no task covers and still passes in after.

Fix: Restore the line, or add a task that covers it, commit a relock, and run again. No sign-off clears this code.

Exit 1. Side effects: The run finished and its spend is settled in the ledger. Retry safe: no. Resumable: no. Owner: U6.

### NOT_NONINFERIOR

--margin was given and the non-inferiority gate failed on at least one requested model.

Fix: Read the per-model interval in verdict.json. The edit is not shown to be within the margin; restore what it cut or keep the old copy.

Exit 1. Side effects: The run finished and its spend is settled in the ledger. Retry safe: no. Resumable: no. Owner: U6.

## Exit 2: no verdict (INCOMPLETE)

### NOT_MEASURABLE

Fewer than 5 tasks were informative (a task is informative unless every run of every arm failed, or every run of every arm passed), or the skill went unopened in both old and new.

Fix: Add harder or more varied tasks, or move to Haiku 5.5 when the suite is at ceiling, commit a relock, and start a new run. Do not --resume.

Exit 2. Side effects: The run finished and its spend is settled in the ledger. Retry safe: no. Resumable: no. Owner: U6.

### MARGIN_NOT_ATTEMPTED

--margin was given and, on at least one requested model, the minimum detectable difference is wider than the margin or the model is at ceiling.

Fix: Add tasks or trials until the minimum detectable difference fits inside the margin, or drop the model at ceiling, then start a new run. Do not --resume.

Exit 2. Side effects: The run finished and its spend is settled in the ledger. Retry safe: no. Resumable: no. Owner: U6.

### CAP_STOP

The spend cap ran out. Complete paired cells are kept, and the run prints STOP: reason=budget_exhausted spent=&lt;usd> reserved=&lt;usd> unknown=&lt;n> cap=&lt;usd>.

Fix: Ask the owner for a higher cap and record it with gstack-evals ledger raise and their exact words. Settle the run's lease (gstack-evals ledger settle --lease &lt;id>), then --resume &lt;out>, which leases the rest of the same line item. Never rerun to change a verdict.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: yes. Owner: U4.

### UPSTREAM

Provider errors (429 or 5xx past the proxy's retry budget, or failures before any model output) hit more than 10% of an arm's sessions, so the run stopped. Each such session is a missing cell.

Fix: Check the provider's status and the proxy journal, then --resume &lt;out>. A 401 or 403 is E_KEY_REJECTED instead.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: yes. Owner: U3.

### TIMEOUTS

Sessions hit their wall-clock timeout in more than 10% of an arm's sessions, so the run stopped. A timeout is its own outcome, never a pass or a fail.

Fix: Find why sessions stalled (host CLI, machine load, proxy), then --resume &lt;out> with the same settings. A longer --timeout changes the cache key, so it needs a new run or --repair.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: yes. Owner: U9.

### JUDGE_UNAVAILABLE

The cross-family judge that tasks with a judge rubric need could not be reached, so those tasks have no adjudication.

Fix: Check the judge's key by name with gstack-evals doctor and the --judge-model id against the policy file, then --resume &lt;out>.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: yes. Owner: U10.

### LOCK_MISSING

A paid run found no tasks.lock.json committed and clean at HEAD for its tasks file. The committed lock is the run's preregistration.

Fix: Run the printed gstack-evals skill-eval --lock command, then git add and git commit tasks.lock.json in the tasks file's repo before editing the skill. Do not --resume.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U7.

### LOCK_DRIFT

The tasks file, the sidecar or the policy no longer matches the committed lock.

Fix: Restore the locked files, or commit a relock (--lock), which reruns the changed tasks in every arm and marks the verdict post_hoc. Do not --resume.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U5.

### E_USAGE

A command was called wrong: an unknown command or flag, a bad value, a missing --spend-cap on a command that can spend, or a command that is not built yet.

Fix: Read the message and gstack-evals &lt;command> --help. gstack-evals --help lists every command and which ones run today. Without --spend-cap the CLI prints the dry-run matrix, never a cap to copy.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U1.

### E_KEY_MISSING

A provider key the matrix needs, the judge's included, is not set. Keys are checked by name and never printed.

Fix: Export the named variable in the shell that runs gstack-evals (only the metering proxy reads it), then run again. gstack-evals doctor lists every key the matrix needs by name.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U7.

### E_KEY_REJECTED

The provider answered 401 or 403, so the run stopped at once.

Fix: Replace or re-authorize the key the context names, then --resume &lt;out>. Recorded cells are kept.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: yes. Owner: U3.

### E_LEDGER_MISSING

No approved cap is on record for this run's line item, or this machine's local ledger holds no lease for the call. The CLI never implies a cap.

Fix: With no cap on record, escalate: a human approves a cap and records it with their exact words (the command is in docs/budget-ledger.md). On Capy, ask your Captain through a needs-you report. With no local lease, lease the line item on this machine before the run spends.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U4.

### E_LEDGER_PATH

The local SQLite ledger (--ledger, GSTACK_EVALS_LEDGER) is on a network or FUSE mount, or cannot be used. The approval record is not held to this rule.

Fix: Point --ledger at a local disk. The message prints the default, $XDG_STATE_HOME/gstack-evals/ledger.sqlite (on Capy, under ~/.capy/work/gstack-evals/). If a lease was closed at $0 because the local ledger failed while taking it (a busy lock, a full disk), fix that and lease again; the new lease takes the next slot.

Exit 2. Side effects: None: refused before any spend. If the local ledger failed after a lease was recorded, that lease is closed at $0 in the record. Retry safe: yes. Resumable: no. Owner: U4.

### E_LEASE_UNSETTLED

A lease could not be settled into the approval record, or a new lease was asked for while an earlier lease on the same line item is still open.

Fix: Run gstack-evals ledger settle --lease &lt;id> on the lease's machine; settle is idempotent by lease id. A lease whose machine or local ledger is gone stays reserved until it expires and the owner settles it with gstack-evals ledger reconcile, their words and the provider usage export.

Exit 2. Side effects: Partial: the run's cells are recorded and the lease stays reserved until it is settled or reconciled. Retry safe: yes. Resumable: yes. Owner: U4.

### E_APPROVAL_RECORD

gstack-approvals is missing or failed while an approval was mirrored, so the approval was not written to the approval record.

Fix: Read the binary path, its exit and its APPROVAL_RECORD_* code in the message. Add the missing flag, pass --branch on a detached checkout, or install gstack.

Exit 2. Side effects: None: no approval is recorded until the mirror succeeds. Retry safe: yes. Resumable: no. Owner: U4.

### E_LEDGER_RECORD

The approval record (--ledger-record, GSTACK_EVALS_LEDGER_RECORD) could not be read or written: a file in it does not parse, or a write or its read-back failed.

Fix: Read the path in the message and check that the record directory is reachable and writable (on Capy, that the drive is mounted), then run the command again; record files are write-once, so a retry rewrites nothing. A file that does not parse is repaired by a human, never deleted.

Exit 2. Side effects: Partial when a write failed: the file can land before the directory sync or the read-back fails, so that approval or lease may already be in the record. None when a read failed. A gstack-approvals mirror row may already exist; a retry skips it. Retry safe: yes. Resumable: no. Owner: U4.

### E_RIG_UNPROVEN

A line item recorded with --admission required was asked for a lease, and no matching admission record exists for the lease's slot, so nothing was leased. The rig is proven before money is spent (GSTA-8, decision 3).

Fix: Write the admission record the message names on the machine that will spend (U20's rig admission), then lease again. A new lease after a reconcile needs its own record.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U4.

### E_ITEM_BOUND

The line item is bound to another run. Each line item of an approved cap admits one run, so the same money cannot fund a second run to change a verdict.

Fix: This run cannot spend from that item. Continue the run the message names with its own --resume &lt;out>, or ask the owner for a new line item for this run and record it with gstack-evals ledger init and their words.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U4.

### E_LEASE_CLOSED

A reserve named a lease that is past its expiry or already settled or reconciled, so it admits no new charge.

Fix: Settle the lease with gstack-evals ledger settle --lease &lt;id>, then --resume &lt;out>, which takes a new lease on the same line item for the same run.

Exit 2. Side effects: Partial: charges already held under the lease are kept; the refused call was not sent. Retry safe: yes. Resumable: yes. Owner: U4.

### E_RESERVE_CONFLICT

A reserve reused an idempotency key with a different lease, cell or amount than the first reserve under that key.

Fix: An idempotency key names one call, so this is a defect in the caller. File an issue with the message, which names the key and both requests. Do not --resume.

Exit 2. Side effects: None: the first reservation under the key is kept and nothing new is held. Retry safe: no. Resumable: no. Owner: U4.

### E_SETTLE_CONFLICT

A second settle of a reservation or a lease carried a different outcome than the first. The first stands: a settled lease cannot be reconciled differently, nor the reverse.

Fix: Read both outcomes in the message and tell the owner which is right. The ledger is append-only, so the first outcome is never rewritten. Do not --resume.

Exit 2. Side effects: None: the first outcome is kept and nothing is rewritten. Retry safe: no. Resumable: no. Owner: U4.

### E_CAP_TOO_LOW

The spend cap is below one arm-balanced round, so preflight refused.

Fix: Read the worst case in parts from --dry-run, then ask for a cap that covers at least one round, or shrink the matrix.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U7.

### E_USER_TURNS_MISSING

The agent asked a question (AskUserQuestion) in a task with no scripted replies, so that trial ended as a missing cell. The message names the task and the question.

Fix: Declare the task interactive in tasks.ext.json (user replies, or interactive: true), commit a relock, and start a new run. Do not --resume.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: no. Owner: U10.

### E_INTERACTIVE_HOST

A task declared interactive was sent to --host codex, which runs only non-interactive tasks in v1.

Fix: Use --host claude, or --tasks-only with the other ids. The message names the interactive task ids. Do not --resume.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U7.

### E_LOOSE_GSTACK

An arm is a loose folder that calls gstack bins, but its gstack root cannot be resolved, so it would measure gstack's degraded mode.

Fix: Pass --base gstack@&lt;sha> --skill &lt;name> with the values the message prints, or point the arm at a rendered gstack skill folder. Do not --resume.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U7.

### VACUOUS_CHECK

Preflight found a task whose whole pass predicate holds on the no-op control (a non-safety task), or still holds on its mutant (a safety task).

Fix: Tighten the task so it fails when nothing is done; the message names the assertions that did not bite. Commit a relock and run preflight again. Do not --resume.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U5.

### E_TASKS_INVALID

A tasks file breaks the contract's task rules (the same rules as gstack's checkEvalTasks), or its tasks.ext.json sidecar breaks the sidecar rules: an unknown key, a bad value, an unknown reply category or an entry for an id the tasks file lacks.

Fix: Fix each problem the lines above name, then run gstack-evals validate --tasks &lt;tasks.json> until it exits 0. If the tasks file is locked, commit a relock (--lock).

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U5.

### E_ISOLATION_UNSAFE

No Docker daemon is reachable and --isolation process was not given.

Fix: Start Docker, or pass --isolation process on purpose; it runs the agent under a separate uid or bubblewrap and is recorded in the verdict.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U9.

### E_CACHE_STALE

A cached session's key no longer matches (arm tree, task, fixture, check or verifier scripts, image, model, host version, adapter, isolation, timeout, passthrough env, judge model or policy).

Fix: Read which key parts changed, then rerun the affected cells with --repair "&lt;named repair>", which writes a new verdict id.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U9.

### E_NOT_RESUMABLE

--resume was given for a run that ended on a terminal stop: NOT_MEASURABLE, MARGIN_NOT_ATTEMPTED, VACUOUS_CHECK, LOCK_MISSING, LOCK_DRIFT, E_USER_TURNS_MISSING, E_INTERACTIVE_HOST or E_LOOSE_GSTACK.

Fix: Follow the next step on the original run's last stderr line and start a new run.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U10.

### E_SLOT_DENIED

The metering proxy refused a request: the bearer does not belong to the slot, the slot is unbound or closed, or a trial token reached the management socket.

Fix: This is a trial-service fault: --resume &lt;out> reruns the missing cell under a fresh slot. Report it if it repeats.

Exit 2. Side effects: None for the refused request: it never reached the provider. Retry safe: yes. Resumable: yes. Owner: U3.

### E_ALLOWANCE

The metering proxy refused a request for a model outside the slot's allowlist, or because the slot spent its allowance.

Fix: A model outside the allowlist means the host called a model the cell did not name: fix the arm or host configuration. A spent allowance means the session needed more than its share; read the allowance in the message before you --resume &lt;out>.

Exit 2. Side effects: None for the refused request: it never reached the provider. Retry safe: yes. Resumable: yes. Owner: U3.

### E_IMAGE_BUILD

gstack-evals doctor could not build the trial image from the repo's Dockerfile.

Fix: Read the build log the message names, check Docker and the build's network (installs need egress at build time, never in a trial), then run doctor again.

Exit 2. Side effects: Partial: layers already built stay in the Docker cache. Retry safe: yes. Resumable: no. Owner: U9.

### E_USERSIM

The user simulator failed while answering an agent's question.

Fix: Read the trace file, check the free-form answer model's key by name with gstack-evals doctor, then --resume &lt;out>.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: yes. Owner: U10.

### E_VERIFIER

The verifier refused to grade a trial: the read-only check runner (Lane A) or Harbor's separate verifier (Lane B) could not start or rejected its inputs.

Fix: Read the trace file and the check it names. If nothing changed, --resume &lt;out>; after fixing a check or fixture, use --repair, since the cache key changed.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: yes. Owner: U9.

### E_INTERNAL

An unexpected error. The error record carries a correlation id that its trace file repeats.

Fix: Run the resume command the message prints. If it repeats, file an issue with the trace file, which holds no secret values.

Exit 2. Side effects: Unknown until reconciled: --resume reconciles by reservation id and never resends a call whose outcome is unknown. Retry safe: yes. Resumable: yes. Owner: U1.

### E_TOKENS_COVERAGE

gstack-evals tokens export was asked for a model, role or effort the token table does not cover. It never fills defaults and never makes a paid call.

Fix: Add the measured rows the message names from a metered run, or ask for an approved measuring run.

Exit 2. Side effects: None: no export is written and no call is made. Retry safe: yes. Resumable: no. Owner: U13.

## Exit 3: calibration failed (INCOMPLETE)

### CALIBRATION_SKILL

A skill arm did not quote the sentinel line only its copy holds, or its calls did not show the read of that copy.

Fix: Check that the arm's skill is installed where the host looks (the message names the arm, host, model and path read), fix the arm or its install command, and run again.

Exit 3. Side effects: Calibration sessions are charged; no task cell ran. Retry safe: yes. Resumable: no. Owner: U10.

### CALIBRATION_NONE_LEAK

The none arm did not answer NO-SKILL, or it read a skill copy, so something leaks into the trial HOME.

Fix: Remove the leak the message names (user memory, a global CLAUDE.md or AGENTS.md, an MCP config or a mounted path) from the trial HOME and run again.

Exit 3. Side effects: Calibration sessions are charged; no task cell ran. Retry safe: yes. Resumable: no. Owner: U10.

### CALIBRATION_SHELL

A shell command did not return its output, or did not appear in the host's calls.

Fix: Check the host CLI version and its tool permissions in the trial configuration, then run again.

Exit 3. Side effects: Calibration sessions are charged; no task cell ran. Retry safe: yes. Resumable: no. Owner: U10.

### CALIBRATION_CONFIG

A gstack base did not print its pinned proactive and session-kind values.

Fix: Check the pre-seeded onboarding markers and the state root (GSTACK_STATE_ROOT and GSTACK_HOME pointing at the work dir's .gstack-home), then run again.

Exit 3. Side effects: Calibration sessions are charged; no task cell ran. Retry safe: yes. Resumable: no. Owner: U10.

### CALIBRATION_USERSIM

A task with scripted user replies did not complete one question and answer round trip.

Fix: Check that the host exposes AskUserQuestion (the SDK-driven adapter, not plain claude -p) and that the task's replies cover the question's category.

Exit 3. Side effects: Calibration sessions are charged; no task cell ran. Retry safe: yes. Resumable: no. Owner: U10.

### CALIBRATION_EGRESS

An egress probe to a non-model host succeeded, so the trial network is not locked to the metering proxy.

Fix: Fix the trial network so its only exit is the proxy, and run no trials until this passes.

Exit 3. Side effects: Calibration sessions are charged; no task cell ran. Retry safe: yes. Resumable: no. Owner: U10.

## Warnings: attach to any verdict, never change the exit code

### DEGRADED

On a task, the old copies passed at least 80% of their runs and after at most two thirds: a drop short of MISS.

Fix: Read the task's after transcripts; the edit weakened something that task uses.

Warning. Owner: U6.

### FLAKY

On a task, the old copies disagreed with themselves across the rounds of the rerun stage.

Fix: Make the task's check deterministic, or give it more trials, before it decides anything.

Warning. Owner: U6.

### FLAKY_SAFETY

A safety task that failed in after also failed in an old run. The verdict still fails; this names the task for repair.

Fix: Repair the safety task so the old copy passes it reliably, then check the edit with a new run.

Warning. Owner: U6.

### CEILING

An arm passed every run on this model, so it cannot show a loss there. It is decided only after every compared arm has run.

Fix: Try Haiku 5.5 or harder tasks. With --margin, a model at ceiling makes the run MARGIN_NOT_ATTEMPTED.

Warning. Owner: U6.

### NONE_MATCHES

The none arm passed a task as often as before did, so the skill's lines for that task are candidates to cut.

Fix: Consider cutting those lines, then check the cut with a new before/after run.

Warning. Owner: U6.

### BROKEN_TASK

A task failed in every run of every arm. It counts as broken until it is repaired or dropped through a committed relock.

Fix: Repair the task's setup, prompt or check, or drop it, and commit a relock.

Warning. Owner: U6.

### REPLY_MISALIGNED

A scripted reply matched a question ambiguously and got a non-approving answer, or after's question sequence differed from before's.

Fix: Read the event log's reply sources and give the question's category its own reply in tasks.ext.json.

Warning. Owner: U10.

### NEGATIVE_UNVALIDATED

A safety task has no mutant in tasks.ext.json, so preflight could not check that the task fails on a violation.

Fix: Add a mutant {setup, answer} for the task in tasks.ext.json and commit a relock.

Warning. Owner: U5.

### RIG_UNPROVEN

A line item recorded with --admission warn, such as a caller's own Lane A run, was leased without a matching admission record. The lease went ahead.

Fix: Nothing is required for a caller's own run. A program-funded run records its line item with --admission required, so the lease waits for the rig's admission record (E_RIG_UNPROVEN).

Warning. Owner: U4.
