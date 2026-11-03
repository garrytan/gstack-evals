# Reason codes

Generated from [src/errors/codes.ts](../src/errors/codes.ts) by `bun run errors:doc`. Do not edit it by hand: CI runs `bun run errors:check` and fails when this file is stale.

Every gstack-evals error line on stderr starts with its code, and every code has an entry here. Codes never change and are never removed; their prose may change. `gstack-evals explain <code>` prints the same entry.

Each entry gives the meaning, the fix, and these facts:

- **Exit**: 1 means the edit lost something, 2 means no verdict, 3 means calibration failed, 4 means an arm is untested. Warnings attach to any verdict. A run with several models exits 3, then 1, then 2, then 0.
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
| [E_RIG_PROOF](#e_rig_proof) | 2 | U20 |
| [E_RIG_PROBE](#e_rig_probe) | 2 | U20 |
| [E_RIG_RED](#e_rig_red) | 2 | U20 |
| [E_ITEM_BOUND](#e_item_bound) | 2 | U4 |
| [E_LEASE_CLOSED](#e_lease_closed) | 2 | U4 |
| [E_RESERVE_CONFLICT](#e_reserve_conflict) | 2 | U4 |
| [E_SETTLE_CONFLICT](#e_settle_conflict) | 2 | U4 |
| [E_CAP_TOO_LOW](#e_cap_too_low) | 2 | U7 |
| [E_USER_TURNS_MISSING](#e_user_turns_missing) | 2 | U10 |
| [E_APPROVAL_BYPASS](#e_approval_bypass) | 2 | U10 |
| [E_INTERACTIVE_HOST](#e_interactive_host) | 2 | U7 |
| [E_LOOSE_GSTACK](#e_loose_gstack) | 2 | U7 |
| [E_MODEL_POLICY](#e_model_policy) | 2 | U7 |
| [E_HOST_CLI](#e_host_cli) | 2 | U7 |
| [VACUOUS_CHECK](#vacuous_check) | 2 | U5 |
| [E_TASKS_INVALID](#e_tasks_invalid) | 2 | U5 |
| [E_ISOLATION_UNSAFE](#e_isolation_unsafe) | 2 | U9 |
| [E_ISOLATION_COUNTED](#e_isolation_counted) | 2 | U9 |
| [E_CACHE_STALE](#e_cache_stale) | 2 | U9 |
| [E_UNIT_REPO](#e_unit_repo) | 2 | U9 |
| [E_UNIT_IMAGE](#e_unit_image) | 2 | U9 |
| [E_RECEIPTS_VOLATILE](#e_receipts_volatile) | 2 | U9 |
| [E_NOT_RESUMABLE](#e_not_resumable) | 2 | U10 |
| [E_SLOT_DENIED](#e_slot_denied) | 2 | U3 |
| [E_ALLOWANCE](#e_allowance) | 2 | U3 |
| [E_TRIPWIRE](#e_tripwire) | 2 | U3 |
| [E_LEDGER_UNAVAILABLE](#e_ledger_unavailable) | 2 | U3 |
| [E_DISK_LOW](#e_disk_low) | 2 | U10 |
| [E_IMAGE_BUILD](#e_image_build) | 2 | U9 |
| [E_IMAGE_STALE](#e_image_stale) | 2 | U9 |
| [E_USERSIM](#e_usersim) | 2 | U10 |
| [E_VERIFIER](#e_verifier) | 2 | U9 |
| [E_REAL_MINE_SHALLOW](#e_real_mine_shallow) | 2 | U14 |
| [E_REAL_MINE_INPUT](#e_real_mine_input) | 2 | U14 |
| [E_REAL_MINE_FETCH](#e_real_mine_fetch) | 2 | U14 |
| [E_REAL_TASK_FORMAT](#e_real_task_format) | 2 | U20 |
| [E_REAL_TASK_LOCKFILE](#e_real_task_lockfile) | 2 | U20 |
| [E_REAL_TASK_KEYED_HOST](#e_real_task_keyed_host) | 2 | U20 |
| [E_REAL_TASK_GOLD_CONFLICT](#e_real_task_gold_conflict) | 2 | U20 |
| [E_REAL_TASK_DOCKER](#e_real_task_docker) | 2 | U20 |
| [E_INTERNAL](#e_internal) | 2 | U1 |
| [E_TOKENS_COVERAGE](#e_tokens_coverage) | 2 | U13 |
| [E_REPLAY_PLAN](#e_replay_plan) | 2 | U13 |
| [E_REPLAY_TRANSPORT](#e_replay_transport) | 2 | U13 |
| [E_PARITY_SOURCE](#e_parity_source) | 2 | U15 |
| [E_PARITY_STALE](#e_parity_stale) | 2 | U15 |
| [E_NOLOSS_SUITE](#e_noloss_suite) | 2 | U13 |
| [E_NOLOSS_SOURCE](#e_noloss_source) | 2 | U13 |
| [E_NOLOSS_ARM](#e_noloss_arm) | 2 | U13 |
| [E_NOLOSS_JUDGMENT](#e_noloss_judgment) | 2 | U13 |
| [E_NOLOSS_COST](#e_noloss_cost) | 2 | U13 |
| [LOSS](#loss) | 1 | U13 |
| [NOT_DISTINGUISHED](#not_distinguished) | 2 | U13 |
| [E_NOLOSS_BLIND](#e_noloss_blind) | 2 | U13 |
| [E_NOLOSS_STALE](#e_noloss_stale) | 2 | U13 |
| [E_NOLOSS_ADJUDICATION](#e_noloss_adjudication) | 2 | U13 |
| [E_NOLOSS_EXPECT](#e_noloss_expect) | 2 | U13 |
| [E_MINE_SOURCE](#e_mine_source) | 2 | U14 |
| [E_MINE_HAND](#e_mine_hand) | 2 | U14 |
| [E_MINE_STALE](#e_mine_stale) | 2 | U14 |
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
| [DELTA_DROPPED](#delta_dropped) | warning | U9 |
| [BROKEN_TASK](#broken_task) | warning | U6 |
| [REPLY_MISALIGNED](#reply_misaligned) | warning | U10 |
| [PDF_INPUT](#pdf_input) | warning | U7 |
| [NEGATIVE_UNVALIDATED](#negative_unvalidated) | warning | U5 |
| [RIG_UNPROVEN](#rig_unproven) | warning | U4 |
| [LEASE_OVERSPENT](#lease_overspent) | warning | U4 |
| [CLEANUP_INCOMPLETE](#cleanup_incomplete) | warning | U9 |
| [E_STACK_SOURCE](#e_stack_source) | 2 | U10 |
| [E_STACK_DIGEST](#e_stack_digest) | 2 | U10 |
| [E_CELL_RULE](#e_cell_rule) | 2 | U10 |
| [E_CODEX_CONFIG](#e_codex_config) | 2 | U10 |
| [E_INFRA_FAILURE](#e_infra_failure) | 2 | U10 |
| [E_BACKGROUND_DEADLINE](#e_background_deadline) | 2 | U10 |
| [E_COVERAGE_GAP](#e_coverage_gap) | 2 | U10 |
| [E_ROUTE_TOOL_ROUNDTRIP](#e_route_tool_roundtrip) | 1 | U9 |
| [E_ROUTE_NO_BLOCK](#e_route_no_block) | 1 | U9 |
| [E_ROUTE_METERING](#e_route_metering) | 1 | U9 |
| [E_ROUTE_INFRA](#e_route_infra) | 2 | U9 |
| [E_ROUTE_INCONCLUSIVE](#e_route_inconclusive) | 2 | U9 |
| [NOLOSS_UNDERPOWERED](#noloss_underpowered) | warning | U13 |
| [FALSE_ALARM_GATE_FAIL](#false_alarm_gate_fail) | warning | U13 |
| [E_REAL_SANDBOX_SETUP](#e_real_sandbox_setup) | 2 | U20 |
| [E_REAL_SANDBOX_EGRESS](#e_real_sandbox_egress) | 2 | U20 |
| [E_REAL_SANDBOX_RECORD](#e_real_sandbox_record) | 2 | U20 |
| [E_REAL_ARM_BUILD](#e_real_arm_build) | 2 | U10 |
| [E_REAL_SCORE_INPUT](#e_real_score_input) | 2 | U20 |
| [E_REAL_SCORE_GRADE](#e_real_score_grade) | 2 | U20 |
| [E_REAL_SCORE_CONFIG](#e_real_score_config) | 2 | U20 |
| [E_CLEAN_ROOM](#e_clean_room) | 2 | U10 |
| [E_ARM_CONTAMINATED](#e_arm_contaminated) | 4 | U10 |

## Exit 1: the edit lost something (FAIL)

### REGRESSION

A task whose before panel passed at least two thirds of its runs (2 of 3) passed fewer than two thirds in after (gstack's contract floor). With the rerun stage the thresholds apply to the pooled rounds.

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

### LOSS

A review no-loss comparison found the variant worse than the reference: the non-inferiority test at the margin did not pass, and the margin-0 exact sign-flip test over PR clusters, oriented the other way, gave p &lt; 0.05 on blocking recall.

Fix: Read the comparison's losses: the blockers the reference found and the variant missed. Restore what the variant dropped and score a new arm; never rerun the same arm to change a verdict.

Exit 1. Side effects: None: noloss score reads ingested arms and writes nothing. Retry safe: yes. Resumable: no. Owner: U13.

### E_ROUTE_TOOL_ROUNDTRIP

route-check's tool part failed on the model's OpenRouter route: in a one-turn session that reads a random token from token.txt, no main-agent tool call got a non-error result holding the token, the main agent's last text did not quote it, the session did not complete, or the provider answered one of the session's own calls with a 4xx other than 401, 402, 403, 408 or 429 (the reason holds the status and the response body). The try counts against the part's two; a second failure takes the model out of E1 with this code.

Fix: Apply a named repair from the frozen list (--repair provider-pin=&lt;openrouter provider>), then rerun route-check with the same --out. After the second failure there is no fix inside the check: the results name this code.

Exit 1. Side effects: Spend on the model's e1-route line item, settled in the ledger; the try is recorded in &lt;out>/route-check.json. Retry safe: yes. Resumable: no. Owner: U9.

### E_ROUTE_NO_BLOCK

route-check's block part failed on the model's OpenRouter route: the two-turn none-arm plan session on the fixture unit (the plan ask, then the turn-2 ask with the frozen output block) did not complete with a plan-findings block that parses, or the provider answered one of the session's own calls with a 4xx other than 401, 402, 403, 408 or 429 (the reason holds the status and the response body). An empty list ([]) passes. The try counts against the part's two; a second failure takes the model out of E1 with this code.

Fix: Raise the output allowance (--repair output-allowance=&lt;tokens>, above 32000), then rerun route-check with the same --out. After the second failure there is no fix inside the check: the results name this code.

Exit 1. Side effects: Spend on the model's e1-route line item, settled in the ledger; the try is recorded in &lt;out>/route-check.json. Retry safe: yes. Resumable: no. Owner: U9.

### E_ROUTE_METERING

route-check's metering part failed on the model's OpenRouter route: a call of the try's two sessions got a 2xx answer that reported no usage, has no spent outcome with its spend and reasoning tokens in the proxy journal, has no upstream id, or has no billed generation at OpenRouter by the end of the wait (the route must publish its generations to be metered), or a session's metered spend is more than 10% away from OpenRouter's billed cost. &lt;out>/metering-&lt;try>.json holds the per-call comparison. The try counts against the part's two.

Fix: Reconcile the try's lease against OpenRouter's billed cost with the gstack-evals ledger reconcile command the fix line names (its --source is &lt;out>/metering-&lt;try>.json), then rerun route-check with the same --out. A metering retry is refused until the approval record holds that reconcile.

Exit 1. Side effects: Spend on the model's e1-route line item, settled in the ledger at the metered figure; &lt;out>/metering-&lt;try>.json is written. A ledger reconcile row must be written before any retry. Retry safe: yes. Resumable: no. Owner: U9.

## Exit 2: no verdict (INCOMPLETE)

### NOT_MEASURABLE

Fewer than 5 tasks were informative (a task is informative unless every run of every arm failed, or every run of every arm passed), fewer than 5 of them could be paired, the preregistered missing-cell rule refused the paired comparison, or the skill went unopened in both old and new.

Fix: Add harder or more varied tasks, or move to Haiku 5.5 when the suite is at ceiling, commit a relock, and start a new run. Do not --resume.

Exit 2. Side effects: The run finished and its spend is settled in the ledger. Retry safe: no. Resumable: no. Owner: U6.

### MARGIN_NOT_ATTEMPTED

--margin was given and, on at least one requested model, the minimum detectable difference is wider than the margin, the model is at ceiling, or the margin test had nothing to compare (no paired variation, or fewer than 2 tasks).

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

The tasks file, the sidecar, the policy, the before copy, the contract-line rules or the question classifier no longer match the committed lock, or a lock row differs from the row re-derived from the before copy (a hand-edited or deleted row). Each line of the message names one difference, re-derived rows by index and id.

Fix: Restore the locked files (git checkout the lock to undo a hand edit to a row), or commit a relock (--lock), which reruns the changed tasks in every arm and marks the verdict post_hoc. Do not --resume.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U5.

### E_USAGE

A command was called wrong: an unknown command or flag, a bad value, a missing --spend-cap on a command that can spend, or a command that is not built yet.

Fix: Read the message and gstack-evals &lt;command> --help. gstack-evals --help lists every command and which ones run today. Without --spend-cap the CLI prints the dry-run matrix, never a cap to copy.

Exit 2. Side effects: Usually none: the command is refused before it spends or records anything. Two ledger commands can fail after they record: lease --export once the lease is in the record, and settle --artifact once the close is staged in the local ledger. Both keep that record, and the message names the command that writes the file. Retry safe: yes. Resumable: no. Owner: U1.

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

### E_RIG_PROOF

gstack-evals rig admit could not gather the proof set: the checkout has uncommitted changes, the workflow run it needs at this commit is missing or still running, or GitHub could not be read. Nothing was written.

Fix: Do what the message says: commit the change, start the named workflow at this commit (docs/rig.md) and wait for it to finish, or fix gh's access, then run gstack-evals rig admit again.

Exit 2. Side effects: None: no admission record was written and nothing was leased. Retry safe: yes. Resumable: no. Owner: U20.

### E_RIG_PROBE

gstack-evals rig admit or rig probes could not run the keyless probes on this machine, so nothing was proven: Docker, the trial image or the probe's network could not be set up.

Fix: Run gstack-evals doctor on this machine, fix what it names (Docker, the trial image), then run the command again. Probes make no model call and need no key.

Exit 2. Side effects: None: no admission record was written. The probe's containers and network are removed. Retry safe: yes. Resumable: no. Owner: U20.

### E_RIG_RED

The rig's proof is red: the Docker tier failed, skipped or missed an expected case, or an admission attempt found a failing workflow run, tier record or probe. A red admission record is written, so a lease on it refuses with E_RIG_UNPROVEN.

Fix: Read the problems the command printed. Fix the rig or the run it names, get a green run at the commit, then run gstack-evals rig admit again; the next attempt is written beside the red one and decides.

Exit 2. Side effects: rig tier writes its red rig-tier.json; rig admit writes a red admission record. Nothing is leased or spent. Retry safe: yes. Resumable: no. Owner: U20.

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

### E_APPROVAL_BYPASS

An AskUserQuestion call got an answer that did not come from the user simulator through the adapter's canUseTool, so that trial ended as a missing cell. The Claude Code adapter routes every tool call to canUseTool with a PreToolUse hook, so this means the pinned CLI found another route.

Fix: Read the trial's host/transcript.ndjson and host/usersim.ndjson to see which question was answered and how, then fix the adapter or the CLI pin before any counted run. Do not --resume.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: no. Owner: U10.

### E_INTERACTIVE_HOST

A task declared interactive was sent to --host codex, which runs only non-interactive tasks in v1.

Fix: Use --host claude, or --tasks-only with the other ids. The message names the interactive task ids. Do not --resume.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U7.

### E_LOOSE_GSTACK

An arm is a loose folder that calls gstack bins, but its gstack root cannot be resolved, so it would measure gstack's degraded mode.

Fix: Pass --base gstack@&lt;sha> --skill &lt;name> with the values the message prints, or point the arm at a rendered gstack skill folder. Do not --resume.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U7.

### E_MODEL_POLICY

A model the run would call is not allowed for its role (subject, judge, adjudicator or user simulator) by the model policy file, needs --smoke, has no row in the metering proxy's price table, or the policy file itself does not parse.

Fix: Read the policy line in the message: pick a model the policy allows for that role, add --smoke for a smoke-only model, or pass your own policy with --policy &lt;models.json> (policy/examples/ has one). The default policy is policy/models.json. Do not --resume.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U7.

### E_HOST_CLI

The host CLI (claude for Claude Code, codex for Codex) is not on PATH, or its --version failed.

Fix: Install the host's CLI on this machine and check that &lt;host> --version runs, or pick the other --host. Then run gstack-evals doctor again.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U7.

### VACUOUS_CHECK

Preflight found a task whose whole pass predicate holds on the no-op control (a non-safety task), or still holds on its mutant (a safety task).

Fix: Tighten the task so it fails when nothing is done; the message names the assertions that did not bite. Commit a relock and run preflight again. Do not --resume.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U5.

### E_TASKS_INVALID

A tasks file breaks the contract's task rules (the same rules as gstack's checkEvalTasks), or its tasks.ext.json sidecar breaks the sidecar rules (an unknown key, a bad value, an unknown reply category or an entry for an id the tasks file lacks), or preflight could not run a task's control: its setup or mutant setup failed, its check ended in an error (no exit code, exit 2, or a command missing outside the work dir), or a pattern stopped compiling.

Fix: Fix each problem the lines above name. gstack-evals validate --tasks &lt;tasks.json> checks the file rules, and gstack-evals preflight runs the controls. If the tasks file is locked, commit a relock (--lock).

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U5.

### E_ISOLATION_UNSAFE

No Docker daemon is reachable and --isolation process was not given.

Fix: Start Docker, or pass --isolation process on purpose; it runs the agent under a separate uid or bubblewrap and is recorded in the verdict.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U9.

### E_ISOLATION_COUNTED

A counted run, one that leases spend from a ledger line item under a rig admission (every real-host run), asked for --isolation process. Under process isolation setup and check run on this machine as this user, so a check that runs the agent's code could write outside the trial.

Fix: Run counted runs under --isolation docker. --isolation process stays for keyless dev runs: the fake host, --dry-run and the tests.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U9.

### E_CACHE_STALE

A cached session's key no longer matches (arm tree, task, fixture, check or verifier scripts, image, model, host version, adapter, isolation, timeout, passthrough env, judge model or policy).

Fix: Read which key parts changed, then rerun the affected cells with --repair "&lt;named repair>", which writes a new verdict id.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U9.

### E_UNIT_REPO

A review unit's repository could not be built from its source clone, or it failed the history check: its commits are not exactly the head's ancestry, it carries tags, remotes, a reflog, FETCH_HEAD or unreachable objects, its refs are not the ones written, or origin/&lt;base>, &lt;base> and origin/HEAD do not give the unit's merge-base and diff.

Fix: Read the problems the message lists. Point --source at a full (not shallow) clone that holds the unit's head and base commits, and name the base branch with --base-branch when the repository is not in the default table. Then run again.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U9.

### E_UNIT_IMAGE

A review unit's tree failed the unit-image check: its install command failed in the builder container, the install changed tracked files, or the unit's own test command failed offline (--network none).

Fix: Read the install or test output in the message. A unit whose own tests fail offline is dropped for every arm alike before the preregistration freezes (plan section 6): run again without it, or fix the install or test command for its repository.

Exit 2. Side effects: None: refused before any spend. Trees already built stay under &lt;out>/units. Retry safe: yes. Resumable: no. Owner: U9.

### E_RECEIPTS_VOLATILE

A run's out directory, which holds its receipts and journal, is on a path that does not outlive the machine (the OS temp dir, /tmp, /var/tmp, /dev/shm, or a tmpfs or ramfs mount), or GSTACK_EVALS_EPHEMERAL=1 is set without GSTACK_EVALS_RECEIPTS.

Fix: Put --out on a disk that outlives the machine, or on a VM the runner deletes afterwards set GSTACK_EVALS_RECEIPTS to a directory the receipts are copied to (src/trial/durable.ts).

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

The metering proxy refused a request the slot does not allow: a model, route or output cap outside the slot's allowlist, a body it cannot price (unknown model, not JSON), or a call whose worst case the slot's remaining allowance cannot hold.

Fix: A model, route or output cap outside the allowlist means the host called something the cell did not name: fix the arm or host configuration. A spent allowance means the session needed more than its share; read the allowance in the message before you --resume &lt;out>.

Exit 2. Side effects: None for the refused request: it never reached the provider. Retry safe: yes. Resumable: yes. Owner: U3.

### E_TRIPWIRE

The metering proxy refused a request whose path, query string, headers or body carried a forbidden marker (a hidden fact, an answer key or a sealed task id), raw or percent-decoded, so the cell is invalid.

Fix: Find how the marker reached the agent (task setup, fixtures, arm files or env) and remove it, then run the cell again as a new run. The message counts markers and never prints them.

Exit 2. Side effects: None for the refused request: it never reached the provider. Calls the cell made before it are charged. Retry safe: yes. Resumable: no. Owner: U3.

### E_LEDGER_UNAVAILABLE

The metering proxy could not reserve a call because the ledger did not answer, so nothing was sent to the provider.

Fix: Check that the run's ledger is reachable and its lease is open (the message carries the ledger's error and the reservation's idempotency key), then --resume &lt;out>. Resume must run reconcileJournal on the stopped proxy's journal before it settles the lease, which releases at $0 a hold the lost answer left. U9 wires that into the runner; until it does, call reconcileJournal from code.

Exit 2. Side effects: Nothing was sent or spent. If the ledger recorded the reservation before its answer was lost, it holds the call's worst case until reconcileJournal finds the journaled idempotency key and settles it at $0. A lease settled first counts that hold as unknown, which overstates spend and loses none. Retry safe: yes. Resumable: yes. Owner: U3.

### E_DISK_LOW

A filesystem a real-host call fills has less free space than the call can need at its peak: the state root (arm installs, retained trees, the trial image tar) or Docker's root dir (arm images and build cache), or both when they share one. Preflight checks it before any lease.

Fix: Free space on the filesystem the message names: delete &lt;state>/installs while no run is going, prune Docker's build cache and arm images no run needs, or point XDG_STATE_HOME at a larger disk. Then run the same call again, with --resume &lt;out> if it was a resume.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U10.

### E_IMAGE_BUILD

gstack-evals could not build the trial image (doctor) or an arm image, or a built arm image holds the skill's eval fixtures: a skill-evals path or a file with the same bytes as one in the tasks directory, which would put the answer key in the agent's reach.

Fix: Read the build log or the files the message names. Check Docker and the build's network (installs need egress at build time, never in a trial). Drop fixtures from the arm's tree (gstack keeps them under test/fixtures/skill-evals), then build again.

Exit 2. Side effects: Partial: layers already built stay in the Docker cache. Retry safe: yes. Resumable: no. Owner: U9.

### E_IMAGE_STALE

The trial image a run would use is not the pinned one: no pin exists for this checkout's recipe, the tag now names a rebuilt image, its recipe label differs, or its digest differs from the one the run or its preregistration recorded.

Fix: Run gstack-evals doctor to build and pin the image for this recipe. A resumed or preregistered run keeps its recorded digest: restore that image from the run's retained tarball (docker load -i) instead of rebuilding.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U9.

### E_USERSIM

The user simulator failed while answering an agent's question.

Fix: Read the trace file, check the free-form answer model's key by name with gstack-evals doctor, then --resume &lt;out>.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: yes. Owner: U10.

### E_VERIFIER

The verifier refused to grade a trial: the read-only check runner (Lane A) or Harbor's separate verifier (Lane B) could not start or rejected its inputs.

Fix: Read the trace file and the check it names. If nothing changed, --resume &lt;out>; after fixing a check or fixture, use --repair, since the cache key changed.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: yes. Owner: U9.

### E_REAL_MINE_SHALLOW

gstack-evals real mine repo was given a shallow clone. SZZ blame and the first-parent walk need the whole history, so nothing was mined.

Fix: Clone the repository in full (git clone without --depth, or git fetch --unshallow) and run the command again.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U14.

### E_REAL_MINE_INPUT

A real mine input file could not be read: the repository list, the GitHub metadata file or a mine result is not the JSON shape lanes/real-outcome/mine/ expects.

Fix: Regenerate the file (real mine fetch-meta writes the metadata file) or fix the field the message names, then run the command again.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U14.

### E_REAL_MINE_FETCH

real mine fetch-meta could not read pull request metadata from GitHub through gh. No file was written.

Fix: Check gh auth status and the repository name, wait out any rate limit, then run the command again.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U14.

### E_REAL_TASK_FORMAT

A real-outcome task directory breaks its format (lanes/real-outcome/task/SPEC.md): a missing or extra file, a bad task.json field, a symlink, a statement that names an upstream pull request or later commit, or a base tree with project Claude config. Nothing ran in Docker.

Fix: Fix the file the message names, or rebuild the directory with gstack-evals real task build, then check it again.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_REAL_TASK_LOCKFILE

A real-outcome task installs dependencies without a lockfile, or with a command that does not hold to its lockfile (npm ci, pip --require-hashes, uv sync --frozen and the like). Untrusted installs without a lockfile are refused.

Fix: Pick a base commit whose tree holds a lockfile and give the frozen install command for it in the build spec, or drop the candidate.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_REAL_TASK_KEYED_HOST

An untrusted real-outcome task (an upstream repository, not a fixture) was about to be built or run on a host whose environment holds a provider or GitHub credential. Task installs and tests run only on keyless build hosts.

Fix: Run the build or check on a build host with no provider keys in its environment (a fresh VM, not a Capy shell), then run it again.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_REAL_TASK_GOLD_CONFLICT

A K1 or K4 gold tree could not be built: the later fix does not apply onto the introducing change (or a re-land onto the base) without conflicts.

Fix: Hand-port the fix onto the introducing commit and pass it as gold_patch in the build spec, or drop the pair and record why.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_REAL_TASK_DOCKER

Docker failed while building a real-outcome task image or running its verifier, so the task got no validity verdict.

Fix: Read the build or run log the message names, fix the Dockerfile input or the host, and check the task again.

Exit 2. Side effects: Partial: images and volumes the check created are removed; nothing was spent. Retry safe: yes. Resumable: no. Owner: U20.

### E_INTERNAL

An unexpected error. The error record carries a correlation id that its trace file repeats.

Fix: Run the resume command the message prints. If it repeats, file an issue with the trace file, which holds no secret values.

Exit 2. Side effects: Unknown until reconciled: --resume reconciles by reservation id and never resends a call whose outcome is unknown. Retry safe: yes. Resumable: yes. Owner: U1.

### E_TOKENS_COVERAGE

gstack-evals tokens export was asked for a model, role or effort the token table does not cover. It never fills defaults and never makes a paid call.

Fix: Add the measured rows the message names from a metered run, or ask for an approved measuring run.

Exit 2. Side effects: None: no export is written and no call is made. Retry safe: yes. Resumable: no. Owner: U13.

### E_REPLAY_PLAN

The review replay plan cannot run as preregistered: a prompt or the preregistration file differs from its frozen sha256, the plan is malformed (a missing field, a repeated item id, no cut-off rule), or on --resume the plan or a recorded item's prompt digest differs from the run's.

Fix: Restore the frozen files, or freeze and preregister a new plan and start a new run. A resume never runs a changed plan.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U13.

### E_REPLAY_TRANSPORT

A review replay call failed between the runner and the model: the connection failed or timed out, the provider answered 429 or 5xx, or it answered 200 with an error, without usage or from an unpinned provider. The runner never retries a call, so it stopped before more items failed the same way.

Fix: Check the provider's status and &lt;out>/journal.ndjson, then --resume &lt;out>. The failed item keeps its outcome, unknown when the send may have reached the provider (its charge is kept) and missing when the provider answered with an error, and neither is sent again.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: yes. Owner: U13.

### E_PARITY_SOURCE

scripts/parity-sd-estimate.ts could not use the DeepSWE trials file: the download failed, the file is unreadable, its sha256 differs from the one docs/benchmarks/2026-11-parity-sd-estimate/source.json records, or it lacks a configuration the estimate reads.

Fix: Use the recorded file, the one with source.json's sha256. DeepSWE serves a live file, so a new digest needs a new estimate with its own note, never an edit to the old numbers. report --check needs no download.

Exit 2. Side effects: None: nothing is written. Retry safe: yes. Resumable: no. Owner: U15.

### E_PARITY_STALE

A file the parity SD estimate reads or generates (source.json, counts.json, results.json or the note's generated block) cannot be read, differs from what scripts/parity-sd-estimate.ts computes, is missing its markers, or was derived from another source file than source.json records.

Fix: Restore a missing or unreadable file from git. Otherwise run the same command without --check, review the diff, and commit it only if the change is intended.

Exit 2. Side effects: None: nothing is written. Retry safe: yes. Resumable: no. Owner: U15.

### E_NOLOSS_SUITE

A review no-loss suite cannot be used: the file is unreadable or malformed, a blocker's catalog case is missing, lacks a confirmed answer-key audit or disagrees with its unit's range, file or line, a prereg freeze digest fails on its byte prefix, or scripts/import-noloss-cases.ts found a blocker it cannot place (a line absent at the pass-1 head, a fix that does not touch it, lineage that rewrote it, or a summary that copies the source). Also a comparisons file (lanes/review-noloss/comparisons/) that is malformed, lacks a margin with its reason, or names a frozen bar the suite lacks, or a sealed suite whose arms root or table is inside the repo.

Fix: Read the named unit and blocker, or the named comparison. Fix the case or the hand audit (lanes/review-replay/catalog/noloss/mining/hand.json) and rerun the import, or regenerate the suite; never edit a digest to make it match.

Exit 2. Side effects: None: suite --check and import --check write nothing, and import writes cases only when every blocker resolves. Retry safe: yes. Resumable: no. Owner: U13.

### E_NOLOSS_SOURCE

scripts/import-noloss-cases.ts could not read a source: the gstack clone or a commit is missing, gstack-diff-scope is missing, the GitHub API failed, or the repo's visibility is unverified or not public. An API failure means unverified, not private.

Fix: Read the message. Fetch the named PR ref into the clone, point --gstack at a gstack checkout, or wait for the API and rerun; cached API responses under --cache are reused. A repo that is not public is never imported.

Exit 2. Side effects: None in the repo. API responses fetched so far stay in the --cache dir. Retry safe: yes. Resumable: no. Owner: U13.

### E_NOLOSS_ARM

A review arm directory does not fit arm contract v1: arm.json is missing, malformed or names an unsupported contract_version or another suite; the directory holds a symlink or a file outside the contract; a findings file or line is malformed, names no unit, repeats an id or carries an absolute path; a raw label has no severity_map entry; a text breaks the publication scan; or the destination already holds a different arm.

Fix: Each line names the file, row and field and how to fix that row. Fix the source arm (ingest never edits it) and run ingest --check again. For a scan hit in a finding, --digest-only &lt;id> publishes only its digest; to replace a published arm, pass --replace with the reason.

Exit 2. Side effects: None: refused before anything is published. Retry safe: yes. Resumable: no. Owner: U13.

### E_NOLOSS_JUDGMENT

An arm's judgments.tsv breaks the contract: a column is missing, a row names an unknown unit or blocker or repeats one, a blocker has no row for a pass, an outcome disagrees with the mapped severity of the findings it matched, matched_finding names no finding, or a transcribed row claims a finding or a blind judge.

Fix: Fix the named row. For a missing row, re-judge the blocker, or record it with coverage incomplete and the reason in note; never add an M row just to pass the check. Outcome follows the matched finding's mapped severity: CRITICAL is F, INFORMATIONAL is D.

Exit 2. Side effects: None: refused before anything is published. Retry safe: yes. Resumable: no. Owner: U13.

### E_NOLOSS_COST

An arm's cost.tsv breaks the contract: a required column is missing, a meter_source is not one of the five meters, a number is not a non-negative number, a pr * row has no covers, a row names an unknown unit, or two all-scope rows cover the same units and pass.

Fix: Fix the named row. Leave a number blank when it is unknown, use proxy-journal, reader-counter, lane-counter-delta, root-counter-delta or estimate for meter_source, and list the units a pr * row covers.

Exit 2. Side effects: None: refused before anything is published. Retry safe: yes. Resumable: no. Owner: U13.

### NOT_DISTINGUISHED

A review no-loss comparison reached neither NO_LOSS nor LOSS: too few PRs differ between the arms for either test to reach p &lt; 0.05, or no blocker differs at a ceiling or floor. The record prints the minimum reachable p.

Fix: More data decides it: more PRs, more blockers or more passes per arm. noloss power says how many; a new preregistration buys them.

Exit 2. Side effects: None: noloss score reads ingested arms and writes nothing. Retry safe: yes. Resumable: no. Owner: U13.

### E_NOLOSS_BLIND

Blinding would break: a comparison would pool labelled and blind judgments, or one arm mixes them; a judge packet would leak an arm id, label, model or reader name; the key file sits inside the packet directory; or a judge reply or key does not match its batch (another suite, changed arms, a stale or swapped packet, or a missing adjudication).

Fix: Read the named arm, packet or reply. Judge an arm one way only, remove the leaking text from the source arm and ingest it again, keep --key outside --out, and send each judge the packets of the batch its reply names.

Exit 2. Side effects: None: refused before any packet, judgment or score is written. Retry safe: yes. Resumable: no. Owner: U13.

### E_NOLOSS_STALE

tables/review-noloss.json differs from what noloss export computes from the ingested arms and the comparisons file, or cannot be read.

Fix: Run gstack-evals noloss export without --check, review the diff, and commit it only if the change is intended.

Exit 2. Side effects: None: export --check writes nothing. Retry safe: yes. Resumable: no. Owner: U13.

### E_NOLOSS_ADJUDICATION

An arm's adjudication.tsv breaks arm contract v1: a missing column, a row naming no blocking finding of its unit and pass, a finding judgments.tsv already matches, a second row for one finding, a version other than 1, or a ruling other than defect, not-defect or known-informational (the last only on a unit with an over-blocking blocker).

Fix: Fix the named row, or rebuild the file with noloss judge-packet --adjudicate and judge-join. A blocking finding with no row is not an error: the false-blocker reading reports it as incomplete.

Exit 2. Side effects: None: the arm is not ingested or scored. Retry safe: yes. Resumable: no. Owner: U13.

### E_NOLOSS_EXPECT

noloss score --expect: the run's outcome, read from its verdict line or JSON record and its first reason code, is not one --expect lists, or the output cannot be read as an outcome (no verdict line, no reason code, or an exit code that disagrees with the verdict).

Fix: Read the score output above this line. If the outcome is right, fix the --expect list; never accept a bare exit 2, which also covers refusals.

Exit 2. Side effects: None beyond what score itself writes (--out). Retry safe: yes. Resumable: no. Owner: U13.

### E_MINE_SOURCE

scripts/mine-review-cases.ts could not read a source it mines: a repo clone is missing, a git command failed, a commit stayed missing after fetching its PR's ref, gstack's bin/gstack-diff-scope failed, or the GitHub API answered something other than 200 or 404 after its retries.

Fix: Read the message. Clone a missing repo with git clone --filter=blob:limit=200k, fetch the named ref, or wait for the API's rate limit to reset, then run mine again. Cached API responses under --cache are reused, so a rerun reads only what is missing.

Exit 2. Side effects: None in the repo: mined.json is written only when mining finishes. API responses fetched so far stay in the --cache dir. Retry safe: yes. Resumable: no. Owner: U14.

### E_MINE_HAND

The hand audits in the catalog's mining/hand.json cannot be used: the file is unreadable, it audits a candidate mined.json does not hold, or an audit is incomplete (no summary or severity on a confirmed case, a line outside the located lines, no history where the script could not settle it, or no verdict on a decoy whose lines a later commit changed).

Fix: Fix the named audits in hand.json and run build again. Mark what the evidence cannot settle as needs_human_check with its reason rather than guessing.

Exit 2. Side effects: None: build writes nothing. Retry safe: yes. Resumable: no. Owner: U14.

### E_MINE_STALE

A generated catalog file differs from what scripts/mine-review-cases.ts build computes from mining/mined.json and mining/hand.json, a file in the catalog is not one build writes, or mined.json is missing or unreadable.

Fix: Run build without --check, review the diff, and commit it only if the change is intended. Restore a missing mined.json from git, or run mine again.

Exit 2. Side effects: None: --check writes nothing. Retry safe: yes. Resumable: no. Owner: U14.

### E_STACK_SOURCE

A --base or &lt;repo>@&lt;sha> arm names a commit that no local repository holds: not the checkout the base was inferred from, a gstack checkout on this machine, or a repository under &lt;state>/sources/. The rig never fetches.

Fix: Fetch the commit into a gstack checkout (git -C ~/.local/share/gstack fetch origin &lt;sha>) or clone the repository under &lt;state>/sources/, then run again.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U10.

### E_STACK_DIGEST

A stack tree did not verify by digest: the bytes git archive extracted do not hash to the commit's tree id, or a cached install or layer under &lt;state>/installs/ no longer hashes to its recorded digest. Nothing from it was installed.

Fix: Run git fsck on the source repository and check the tree for export-ignore, export-subst or filter attributes, which change what git archive writes. For a cached install, remove the directory the message names; it is rebuilt from the verified tree.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U10.

### E_CELL_RULE

A pstack arm's per-cell model rule could not be derived: the pinned tree's setup-pstack SKILL.md has no rule shape with role lines in its step 5, or a role's value is not a Claude slug, a Grok slug, auto or inherit-parent, so the cell cannot say which model that role runs on. No image was built for the cell.

Fix: Check that the arm pins pstack's Claude Code tree (cursor/plugins at harness/pstack/claude-code) at a commit whose setup-pstack still shows the rule shape, and re-pin it in the preregistration if the shape moved. A new kind of value needs its own mapping in src/arms/cells.ts, with a test, before any cell uses it. Do not --resume.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U10.

### E_CODEX_CONFIG

The Claude Code adapter could not write the session's Codex config (~/.codex/config.toml) for an arm whose cell keeps a cross-family voice, so Claude Code never started. The cell is missing, not an arm failure, and nothing was spent.

Fix: Check that the arm image leaves HOME and ~/.codex writable for the agent (mode 1777) and that no layer installs its own ~/.codex/config.toml, then rerun the cell with --resume.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U10.

### E_INFRA_FAILURE

A Claude Code session ended on an infra failure, not on anything the arm did: the evaluator's own code (the transcript, init or stderr write, the user simulator, the persona, the session records), the SDK's link to the CLI (a reset or a broken pipe while the CLI still ran, a CLI that exited 0, a CLI that exited only after the SDK closed its input, or a stream that ended while the turn's result was still awaited), or the machine (the CLI could not be spawned, its launcher failed with docker exec's own 125, 126 or 127, or the agent's session stopped answering once the CLI ended). The cell is missing, never a miss or an arm failure; in a review run it is a coverage gap that stops its arm, so that arm gets no verdict and review-units exits 2 (E_COVERAGE_GAP), and under skill-eval --host claude it is a missing cell under the prereg's missing-cell rule, never a fail against the arm. An error from the adapter's own abort or teardown after a recorded timeout or arm failure does not replace it; the adapter line names it as teardown.

Fix: Read the adapter line in the trial's host/cli-stderr.log, which names what failed, and fix the evaluator or the machine before a counted run. Start a new run for the arm's verdict.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: no. Owner: U10.

### E_BACKGROUND_DEADLINE

A Claude Code session in a review-units run sat idle past its background wait with background work it started still out: a background Agent or Bash task the main thread launched that had not finished, or a ScheduleWakeup it set while nothing ran that had not fired. The wait counts, in all, the time from each turn that ended with that work out to the start of the main agent's next turn: the turn init the CLI sends or the main agent's next message, whichever comes first (review-units --background-wait, 3600 s unless set). The adapter ends the session at that deadline, or at its session timeout when that comes while the session sits idle on that work. The cell is missing, never a miss or the arm finding nothing: it is a coverage gap that stops its arm (E_COVERAGE_GAP). Only review-units sets a background wait; every other runner ends a session at its turn's result. The trial record's session_end has cause deadline and names the work still out; the session's record in cells.ndjson also says whether a findings block existed (findings_block), which is never scored.

Fix: Read the adapter line in the trial's host/cli-stderr.log and session_end.pending in the trial record, which name the work still out. Set a longer --background-wait only under a preregistration that names it, and start a new run for the arm's verdict.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: no. Owner: U10.

### E_COVERAGE_GAP

A review-units arm stopped with a coverage gap, so it gets no verdict, and the run exits 2 once every arm is written. A gap is a session that ended on an infra failure (E_INFRA_FAILURE), its background wait's deadline (E_BACKGROUND_DEADLINE), a provider failure, a refusal or a cap stop; a plan session that timed out, crashed or completed before any model output; or a code unit's malformed or incomplete pass. The arm's arm.json has status stopped and lists each gap under coverage_gaps; an arm with no gap completes as usual.

Fix: Read the arm's coverage_gaps in arm.json and each named session's host/cli-stderr.log, fix the cause, and start a new run for that arm's verdict. Never rerun a gap inside the same run to change a verdict.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: no. Owner: U10.

### E_ROUTE_INFRA

route-check hit an endpoint, credential or proxy failure, which is not a compatibility failure and never passes a part: a session ended missing (such as UPSTREAM or E_INFRA_FAILURE), with rejected credentials, as an infra incident or before any model output, or after model output when its last call got a 401, 402, 403, 408, 429 or 5xx, no answer or a proxy refusal; the rig failed without a reason code of its own; OpenRouter's generation lookup refused the key, still failed at the deadline or never reached an id; a call of the try has no outcome line, or a session has no paid call, in the proxy journal (a proxy fault); a call had an unknown outcome (a lost send, a broken stream or a lost body) or a 5xx with no usage (the proxy charges it at its full reservation, a retried attempt included); or a session has no billed call, so no bill can verify its metering. The metering part's charge stays as settled. A session that ended that way after the provider answered one of its own calls with a 4xx other than 401, 402, 403, 408 or 429 is not infra: it fails the part the session serves (E_ROUTE_TOOL_ROUNDTRIP or E_ROUTE_NO_BLOCK). 5xx answers, network errors, 401 and 403 (the key), 402 (our credits), 408 (a timeout), 429 and the proxy's own refusals stay infra. It uses no try. The second infra outcome ends the check INCONCLUSIVE (E_ROUTE_INCONCLUSIVE).

Fix: Check the endpoint, credential or proxy that stderr names, then rerun route-check with the same --out. After the second infra outcome the check is INCONCLUSIVE: report it to the Captain instead.

Exit 2. Side effects: Spend on the model's e1-route line item if a call went out, settled in the ledger; the failure is recorded in &lt;out>/route-check.json. Retry safe: yes. Resumable: no. Owner: U9.

### E_ROUTE_INCONCLUSIVE

route-check had two infra outcomes (E_ROUTE_INFRA) on the model's OpenRouter route, its bound, before every part passed. Infra never passes a part, so the check ends INCONCLUSIVE, which blocks the route from E1: the model does not enter E1 on this check. A part that failed both tries reports its own code instead. A rerun on the same --out prints this code and runs nothing.

Fix: Report the check to the Captain with the E_ROUTE_INFRA lines its tries printed. route-check runs no more tries on this --out.

Exit 2. Side effects: None beyond the tries' spend, already settled on the model's e1-route line item; &lt;out>/route-check.json holds every try. Retry safe: yes. Resumable: no. Owner: U9.

### E_REAL_SANDBOX_SETUP

The real-outcome ship sandbox could not start or could not open a trial: git (with http-backend) or jq is missing, the sidecar could not listen, the task's bundle does not hold the base commit, the base tree holds project-local Claude Code configuration (a .claude/ directory or .mcp.json, which would give the none arm a skill, plugin or MCP route), or the in-container prep failed. No model was called for the trial.

Fix: Read the message. Install git and jq on the sidecar's host, or fix the task directory (B2) so its image's base branch is at base_commit. A repository with project-local Claude Code configuration is not eligible for this lane; drop it at mining.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_REAL_SANDBOX_EGRESS

The trial container's IP-and-port egress allowlist could not be applied or did not verify: the nftables helper failed, the table read back differs from the one written, an allowed endpoint was unreachable, or a denied probe got through. The agent never started.

Fix: Check that Docker can run the pinned helper image with NET_ADMIN on the container's network namespace and that the proxy and sidecar listen on the allowed address and ports. Never run a trial without the rules.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_REAL_SANDBOX_RECORD

A trial's shipment record could not be written or copied out, or its journal does not replay to the origin's refs (status rig_error). The trial's outcome is unknown: it is infra, never a fail for the arm.

Fix: Read the record's rig_errors and the sidecar's journal for the trial. A journal_mismatch means something changed the origin outside the sidecar; find it before any counted run.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: no. Owner: U20.

### E_REAL_ARM_BUILD

A real-outcome arm (none, gstack told or gstack untold) could not be built: the pinned gstack commit or its tree id did not verify, gstack's setup failed, the installed tree reports another version than the pin, or the tree has no question registry to set to auto-decide.

Fix: Fetch the pinned gstack commit into a local checkout (git -C ~/.local/share/gstack fetch origin &lt;sha>), then rebuild with bun lanes/real-outcome/arms/build.ts. Re-pin gstack only in a new preregistration.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U10.

### E_REAL_SCORE_INPUT

The real-outcome scorer could not read a trial's records as the lane defines them: a shipment.json that is not a real-outcome/shipment/v1 record, an arm that arms.json does not list, a K4 task with no replay role, a task bundle without the starting commit, a gold patch that does not apply, a trial-score.json of another schema, or a termination reason the taxonomy does not class. Nothing was scored.

Fix: Read the message. A missing record means the trial is infra (rig reason), never a fail. An unclassed termination needs B7's frozen taxonomy (--taxonomy) to class it before any trial is scored.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_REAL_SCORE_GRADE

The real-outcome scorer's scratch git repository failed while it built a trial's trees: a bundle would not fetch, or git could not read, diff or write a tree. The trial has no grade yet; it is not a fail for the arm.

Fix: Check that git is installed and the work directory is writable, then rerun gstack-evals real score trial for the trial.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_REAL_SCORE_CONFIG

The real-outcome analysis config or termination taxonomy is not usable: a missing or wrong schema, a primary model outside the models list, the same arm as treatment and control, a task order that repeats a task or misses a build task of the primary model, a margin, ceiling or guard outside 0 to 1, fewer than 1000 bootstrap draws, or a taxonomy class other than completed, truncated or infra.

Fix: Fix the config to match the preregistration (lanes/real-outcome/score/README.md lists the fields). Never change a frozen number after the run to change a verdict.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_CLEAN_ROOM

A none or lens plan arm could see a Capy drive or gstack (src/trial/review/clean-room.ts): a .capy, .local/share/gstack or .claude/skills path in its home, a home .claude/CLAUDE.md or AGENTS.md that names gstack, a /home/*/.capy/drive or /root/.capy/drive, a unit's .claude/skills, or an AGENTS.md or CLAUDE.md in a unit tree that names gstack. review-units checks each none and lens arm image, with each unit tree mounted read-only, before the lease opens, and refuses the run. The driver checks again in each none and lens session before the CLI starts; that cell is then a coverage gap that stops its arm (E_COVERAGE_GAP). Each line names a path the check found; a check that cannot run refuses the same way.

Fix: Remove the named paths from the arm image or the unit tree, then rerun the same command; a refusal before the lease left the item unopened. A session's refusal is not journaled, so --resume &lt;out> reruns that cell after the fix and reuses the scored sessions.

Exit 2. Side effects: Before the lease: none, refused before any spend. In a session: no model call in that session; completed cells and their spend are kept. Retry safe: yes. Resumable: yes. Owner: U10.

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

## Exit 4: an arm is untested (INCOMPLETE)

### E_ARM_CONTAMINATED

The read audit (src/trial/review/audit.ts) found a contaminated read in a plan arm's session: in any arm, a touch under a home's .capy whose result was not an error; in a none or lens arm, also a gstack skill file, anything under .local/share/gstack or a gstack-* command whose result was not an error. The arm's result is untested, never "no effect": its arm.json has status stopped and an untested block with the sessions, the paths (HOME as ~, the unit as &lt;unit>) and the arm's paid spend, so the scorer and the secondaries give it no reading. review-units logs every touch the audit saw and exits 4 once every arm is written.

Fix: Read the run's read audit lines and the named session's host/transcript.ndjson to see how the arm reached the path, close that path in the arm's image or the unit tree, and start a new run under a named repair and a separately approved item. Never rerun the arm inside the same run to change a verdict.

Exit 4. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: no. Owner: U10.

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

The old copies (before and before2) passed every run on this model, so the suite has no headroom there and a loss can only show as after's failures. It is decided only after every compared arm has run, and never stops the run.

Fix: Try Haiku 5.5 or harder tasks. With --margin, a model at ceiling makes the run MARGIN_NOT_ATTEMPTED.

Warning. Owner: U6.

### NONE_MATCHES

The none arm passed a task as often as before did, so the skill's lines for that task are candidates to cut.

Fix: Consider cutting those lines, then check the cut with a new before/after run.

Warning. Owner: U6.

### DELTA_DROPPED

A trial's delta import left some of the agent's output out or graded it as something else: a symlink out of the work tree (an empty directory stands in), an agent .gitignore, .gitattributes or .gitmodules (the baseline's stays), or a fifo, socket or device. The trial's delta.json names each path and why.

Fix: Read the trial's delta.json and transcript. Honest runs rarely write these; when the check's result turns on such a path, grade that trial by hand.

Warning. Owner: U9.

### BROKEN_TASK

A task failed in every run of every arm. It counts as broken until it is repaired or dropped through a committed relock.

Fix: Repair the task's setup, prompt or check, or drop it, and commit a relock.

Warning. Owner: U6.

### REPLY_MISALIGNED

A scripted reply matched a question ambiguously and got a non-approving answer, or after's question sequence differed from before's.

Fix: Read the event log's reply sources and give the question's category its own reply in tasks.ext.json.

Warning. Owner: U10.

### PDF_INPUT

A task's prompt, setup, check or mutant names a PDF, or the task has a setup and its fixtures hold one. The metering proxy reserves a PDF sent inline as base64 loosely, so one call's reservation bound may not hold; settlement still bills the provider's reported usage (U3, accepted as won't-fix).

Fix: Prefer text fixtures. If the task needs the PDF, keep headroom in the cap and check the ledger's settled spend after the run.

Warning. Owner: U7.

### NEGATIVE_UNVALIDATED

A safety task has no mutant in tasks.ext.json, so preflight could not check that the task fails on a violation.

Fix: Add a mutant {setup, answer} for the task in tasks.ext.json and commit a relock.

Warning. Owner: U5.

### RIG_UNPROVEN

A line item recorded with --admission warn, such as a caller's own Lane A run, was leased without a matching admission record. The lease went ahead.

Fix: Nothing is required for a caller's own run. A program-funded run records its line item with --admission required, so the lease waits for the rig's admission record (E_RIG_UNPROVEN).

Warning. Owner: U4.

### LEASE_OVERSPENT

A lease closed holding more than it reserved, because a provider billed a call above its reservation. The close records the real spend, so the line item's committed total can pass its cap.

Fix: Nothing to undo: the money is spent and recorded. Find the call whose spend passed its reservation in the local ledger and report it against the price table (U3). A new lease gets only what is left of the cap; the owner raises the cap if the run needs more.

Warning. Owner: U4.

### CLEANUP_INCOMPLETE

A work dir that a preflight control or a trial used is still on disk, because removing it failed (often files a root step left). The message names the path and why. The result is unchanged.

Fix: Remove the named path as its owner or as root. Give cleanup an image (the trial image) so it can remove root-owned files from a container with no network.

Warning. Owner: U9.

### NOLOSS_UNDERPOWERED

A review no-loss comparison reached NO_LOSS, but the size rule is unchecked or below 80%: an arm exactly as good as the reference would pass less than 80% of the time. The verdict prints with this warning, exits 2, and is not a no-loss claim.

Fix: Check the size rule with --power-sims (or the prereg's --power), and buy more PRs or passes until it reaches 80% before stating the claim.

Warning. Owner: U13.

### FALSE_ALARM_GATE_FAIL

A review no-loss comparison reached LOSS, so its reference caught more blockers, but the comparison's decoy-only false-alarm gate did not pass: the reference's excess must-fix false alarms per decoy has a 95% interval reaching past the preregistered margin, or the reading is incomplete. The verdict prints with this warning and exits 1, and the claim that the reference catches more may not be made.

Fix: Report the LOSS with its false-alarm reading and no claim. Adjudicate any unadjudicated must-fix finding on the decoys; never widen the margin after the run.

Warning. Owner: U13.
