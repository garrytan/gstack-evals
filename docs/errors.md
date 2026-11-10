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
| [JUDGE_REPLY_REFUSED](#judge_reply_refused) | warning | U13 |
| [REPLY_MISALIGNED](#reply_misaligned) | warning | U10 |
| [PDF_INPUT](#pdf_input) | warning | U7 |
| [NEGATIVE_UNVALIDATED](#negative_unvalidated) | warning | U5 |
| [RIG_UNPROVEN](#rig_unproven) | warning | U4 |
| [LEASE_OVERSPENT](#lease_overspent) | warning | U4 |
| [JOURNAL_MISSING](#journal_missing) | warning | U4 |
| [SESSIONS_OPEN](#sessions_open) | warning | U4 |
| [STAGE_RECOVERED](#stage_recovered) | warning | U4 |
| [STAGE_SETTLED](#stage_settled) | warning | U4 |
| [CLEANUP_INCOMPLETE](#cleanup_incomplete) | warning | U9 |
| [E_STACK_SOURCE](#e_stack_source) | 2 | U10 |
| [E_STACK_DIGEST](#e_stack_digest) | 2 | U10 |
| [E_CELL_RULE](#e_cell_rule) | 2 | U10 |
| [E_SESSION_SETTINGS](#e_session_settings) | 2 | U10 |
| [E_SESSION_KIND_PIN](#e_session_kind_pin) | 2 | U20 |
| [E_CODEX_CONFIG](#e_codex_config) | 2 | U10 |
| [E_INFRA_FAILURE](#e_infra_failure) | 2 | U10 |
| [E_BACKGROUND_DEADLINE](#e_background_deadline) | 2 | U10 |
| [E_COVERAGE_GAP](#e_coverage_gap) | 2 | U10 |
| [NOLOSS_UNDERPOWERED](#noloss_underpowered) | warning | U13 |
| [FALSE_ALARM_GATE_FAIL](#false_alarm_gate_fail) | warning | U13 |
| [E_REAL_SANDBOX_SETUP](#e_real_sandbox_setup) | 2 | U20 |
| [E_OUTCOME_ARM](#e_outcome_arm) | 2 | U20 |
| [E_OUTCOME_TRANSCRIPT](#e_outcome_transcript) | 2 | U20 |
| [E_OUTCOME_AUTOPLAN_CONFIG](#e_outcome_autoplan_config) | 2 | U20 |
| [E_OUTCOME_TOLD_INSTALL](#e_outcome_told_install) | 2 | U20 |
| [E_OUTCOME_CLEAN_ROOM](#e_outcome_clean_room) | 2 | U20 |
| [E_OUTCOME_IMAGE](#e_outcome_image) | 2 | U20 |
| [E_TBV_NOT_BUILT](#e_tbv_not_built) | 2 | U20 |
| [E_TBV_INPUT](#e_tbv_input) | 2 | U20 |
| [E_TBV_HISTORY](#e_tbv_history) | 2 | U20 |
| [E_TBV_REBUILD](#e_tbv_rebuild) | 2 | U20 |
| [E_TBV_PROBE](#e_tbv_probe) | 2 | U20 |
| [E_TBV_SHAPE](#e_tbv_shape) | 2 | U20 |
| [E_TBV_REQUEST](#e_tbv_request) | 2 | U20 |
| [E_TBV_RUN](#e_tbv_run) | 2 | U20 |
| [E_TBV_JUDGE](#e_tbv_judge) | 2 | U20 |
| [E_TBV_CUSTODY](#e_tbv_custody) | 2 | U20 |
| [E_TBV_BURNED](#e_tbv_burned) | 2 | U20 |
| [E_TBV_STEP](#e_tbv_step) | 2 | U20 |
| [E_REAL_SANDBOX_EGRESS](#e_real_sandbox_egress) | 2 | U20 |
| [E_REAL_SANDBOX_RECORD](#e_real_sandbox_record) | 2 | U20 |
| [E_REAL_ARM_BUILD](#e_real_arm_build) | 2 | U10 |
| [E_REAL_SCORE_INPUT](#e_real_score_input) | 2 | U20 |
| [E_REAL_SCORE_GRADE](#e_real_score_grade) | 2 | U20 |
| [E_REAL_SCORE_CONFIG](#e_real_score_config) | 2 | U20 |
| [E_WASTE_INPUT](#e_waste_input) | 2 | U15 |
| [ENVELOPE_PROGRAM_STOP](#envelope_program_stop) | 2 | U4 |
| [ENVELOPE_SKILL_STOP](#envelope_skill_stop) | 2 | U4 |
| [E_ENVELOPE_MISSING](#e_envelope_missing) | 2 | U4 |
| [E_ENVELOPE_LATE](#e_envelope_late) | 2 | U4 |
| [E_MUTATION_DOCKER](#e_mutation_docker) | 2 | U20 |
| [E_MUTATION_INPUT](#e_mutation_input) | 2 | U20 |
| [E_PIN_MISMATCH](#e_pin_mismatch) | 2 | U20 |
| [E_AR_FRAME_DRIFT](#e_ar_frame_drift) | 2 | U20 |
| [E_AR_UNREADABLE](#e_ar_unreadable) | warning | U20 |
| [E_AR_SUPPLY_SHORT](#e_ar_supply_short) | 2 | U20 |
| [E_AR_SMOKE_FAIL](#e_ar_smoke_fail) | 2 | U20 |
| [E_AR_PACKET_LEAK](#e_ar_packet_leak) | 2 | U20 |
| [E_AR_LABEL_MISSING](#e_ar_label_missing) | warning | U20 |
| [E_AR_JUDGE_KAPPA](#e_ar_judge_kappa) | 2 | U20 |
| [E_AR_PROVIDER_DRIFT](#e_ar_provider_drift) | 2 | U20 |
| [E_AR_CUSTODY](#e_ar_custody) | 2 | U20 |
| [E_TRANSCRIPT_UNREADABLE](#e_transcript_unreadable) | warning | U20 |
| [ENVELOPE_OVER](#envelope_over) | warning | U4 |
| [DR_ALLOWANCE_STOP](#dr_allowance_stop) | 2 | U6 |
| [DR_STEP_STOP](#dr_step_stop) | 2 | U6 |
| [DR_WALL_STOP](#dr_wall_stop) | 2 | U6 |
| [DR_DECIDER_FAILED](#dr_decider_failed) | warning | U6 |
| [DR_STATE_OVER_LIMIT](#dr_state_over_limit) | warning | U6 |
| [DR_LABEL_MISSING](#dr_label_missing) | warning | U6 |
| [DR_CELL_DEGRADED](#dr_cell_degraded) | warning | U6 |
| [DR_CUSTODY_HIT](#dr_custody_hit) | 2 | U6 |
| [DR_ADMISSION_STOP](#dr_admission_stop) | 2 | U6 |
| [DR_PILOT_SESSION_STOP](#dr_pilot_session_stop) | 2 | U6 |
| [E_DR_PIN](#e_dr_pin) | 2 | U6 |
| [E_DR_RUNTIME](#e_dr_runtime) | 2 | U6 |
| [E_DR_RUNNER](#e_dr_runner) | 2 | U6 |
| [E_DR_STOPPED](#e_dr_stopped) | 2 | U6 |
| [E_PV_NO_BLOCK](#e_pv_no_block) | warning | U20 |
| [E_PV_INFRA_MISSING](#e_pv_infra_missing) | warning | U20 |
| [E_PV_WEB_CONTAMINATED](#e_pv_web_contaminated) | warning | U20 |
| [E_PV_LABEL_MISSING](#e_pv_label_missing) | warning | U20 |
| [E_PV_JUDGE_KAPPA](#e_pv_judge_kappa) | warning | U20 |
| [E_PV_STOCK_FAIL](#e_pv_stock_fail) | warning | U20 |
| [E_PV_NO_READ](#e_pv_no_read) | warning | U20 |
| [E_PV_EXPOSURE_FALLBACK](#e_pv_exposure_fallback) | warning | U20 |
| [E_PV_EXPOSURE_STOP](#e_pv_exposure_stop) | warning | U20 |
| [E_PV_LEAK_EXPOSED](#e_pv_leak_exposed) | warning | U20 |
| [E_PV_PROVIDER_DRIFT](#e_pv_provider_drift) | 2 | U20 |
| [E_PV_SUPPLY_SHORT](#e_pv_supply_short) | 2 | U20 |
| [E_SM_UNIT](#e_sm_unit) | 2 | U20 |
| [E_SM_SOURCE](#e_sm_source) | 2 | U20 |
| [E_SM_INELIGIBLE](#e_sm_ineligible) | 1 | U20 |
| [E_SM_MIXED_TEST_HUNK](#e_sm_mixed_test_hunk) | 1 | U20 |
| [E_SM_LEAKED](#e_sm_leaked) | 1 | U20 |
| [E_SM_HISTORY](#e_sm_history) | 1 | U20 |
| [E_SM_AMBIGUOUS_TEST](#e_sm_ambiguous_test) | 1 | U20 |
| [E_SM_ORACLE_UNSTABLE](#e_sm_oracle_unstable) | 1 | U20 |
| [E_SM_SLOW_TEST](#e_sm_slow_test) | 1 | U20 |
| [E_SM_SMOKE](#e_sm_smoke) | 1 | U20 |
| [E_SM_PULL](#e_sm_pull) | 1 | U20 |
| [E_SM_PARSER](#e_sm_parser) | 1 | U20 |
| [E_SM_SEED](#e_sm_seed) | 2 | U20 |
| [E_SM_CELL_INCOMPLETE](#e_sm_cell_incomplete) | 1 | U20 |
| [E_SM_ANALYSIS](#e_sm_analysis) | 2 | U20 |
| [E_SM_ARM](#e_sm_arm) | 2 | U20 |
| [E_SM_STRIP](#e_sm_strip) | 2 | U20 |
| [E_SM_UPSTREAM_GAP](#e_sm_upstream_gap) | 2 | U20 |
| [E_SM_INFRA_GAP](#e_sm_infra_gap) | 2 | U20 |
| [E_SM_APPLY_FAILED](#e_sm_apply_failed) | 1 | U20 |
| [E_SM_TEST_PATCH_CONFLICT](#e_sm_test_patch_conflict) | 2 | U20 |
| [E_SM_PACKET](#e_sm_packet) | 2 | U20 |
| [E_SM_JUDGE_ANSWER](#e_sm_judge_answer) | 1 | U20 |
| [E_SM_SECONDARY](#e_sm_secondary) | 2 | U20 |
| [E_PROXY_SERVER_TOOL](#e_proxy_server_tool) | 2 | U20 |

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

### E_SM_INELIGIBLE

A candidate failed the keyless eligibility screen (post section 3); the record names the rule: image_digest (no linux/amd64 digest), fail_to_pass or pass_to_pass (no test), fix_source_files_1_to_6, or feature_request_screen (the frozen keyword screen on the issue's first 800 code points).

Fix: Nothing to fix: the unit is not drawn. The drop counts by rule go in the results.

Exit 1. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U20.

### E_SM_MIXED_TEST_HUNK

A state machines unit's fix patch has a hunk that the frozen in-source test-module detector (Rust #[cfg(test)] modules) places partly inside and partly outside a test module, so it is neither the fix's tests nor the fix (preregistration sections 3 and 7). The record names each such file and hunk.

Fix: Nothing to fix: the unit drops. These drops are counted per language in the results; the detector is not changed for them.

Exit 1. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U20.

### E_SM_LEAKED

The leak scan (post section 4) found a line of 30 characters or more that the fix adds, and that no base file holds, somewhere in the unit's container filesystem, or the scan did not finish. The record names each path and the needle's sha256, never the line. The unit drops before any model call.

Fix: Nothing to fix: the unit drops as leaked. A scan that did not finish fails closed; rerun prep only to recover an infrastructure failure.

Exit 1. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U20.

### E_SM_HISTORY

The commit-count preflight or the history rewrite refused (post section 4): the image's tree was not at base_commit or its tracked files differed, the rewrite failed, or the tree does not hold exactly one commit on a base tree (two on a follow-on tree) on main alone with no remote, stash, reflog or loose object.

Fix: The unit or tree drops before any model call. Read the PREFLIGHT line in the message.

Exit 1. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U20.

### E_SM_AMBIGUOUS_TEST

The oracle preflight (post section 3) dropped a Go unit: every dataset fail-to-pass id is a bare test name (no package path before it) whose top-level test func more than one package dir defines, so the dataset parser's result for that name can be another package's. A Go unit also drops this way when the scan for those funcs does not finish (fail closed). The record lists the ids.

Fix: Nothing to fix: the unit drops and the next unit in draw order is tried.

Exit 1. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U20.

### E_SM_ORACLE_UNSTABLE

The oracle preflight (post section 3) dropped the unit: a fail-to-pass test passed in a base run or did not pass in a fixed run across the three base and three fixed runs, or no test passed in all six runs (no stable test). The record lists the failing ids.

Fix: Nothing to fix: the unit drops and the next unit in draw order is tried.

Exit 1. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U20.

### E_SM_SLOW_TEST

A unit's test command took over 15 minutes: one oracle run of the rebuild, test and print commands passed 900 seconds of wall time and was stopped. The record gives the wall ms.

Fix: Nothing to fix: the unit drops (post section 3).

Exit 1. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U20.

### E_SM_SMOKE

The runtime smoke failed in the unit's image: the runtime layer did not build, claude --version did not print the pinned 2.1.312, node did not run, or the egress probe opened a denied target.

Fix: Nothing to fix for a unit: it drops. If every image fails, the runtime layer is broken; fix it before the oracle continues.

Exit 1. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U20.

### E_SM_PULL

The unit's image could not be pulled by digest after the pacing rules: a refusal that was not Docker Hub's rate limit, twice. A rate-limit refusal waits for the window and is not counted.

Fix: Check the registry and the network, then rerun the oracle; it resumes at the unit.

Exit 1. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U20.

### E_SM_PARSER

The dataset's log parser, run in its sandbox (pinned python image, no network, no mount but its input, uid 10001), crashed, timed out or printed no dict of test id to status. On the oracle this is infrastructure; in scoring it is a gap.

Fix: Read the parser's stderr in the message. Never edit a dataset parser; a unit whose parser fails drops.

Exit 1. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U20.

### E_SM_CELL_INCOMPLETE

A state machines analysis cell (one model and one arm, or one model and one follow-on tree) has gaps on more than 10% of its units, so every contrast that uses it gets no verdict (post section 6). The analysis still writes every number, the gap worst case included, and then exits 1.

Fix: Nothing to fix in the analysis: report the cell as incomplete. Gaps are never rerun to change a verdict; a harness fault goes to the Captain.

Exit 1. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U20.

### E_SM_APPLY_FAILED

A state machines session's change did not apply to a fresh copy of the unit's base tree in the scoring container (or names an unsafe path), first and after one more extraction, so the session scores no fix and is listed (preregistration section 7, step 8).

Fix: Nothing to fix in the session: it counts as no fix and is listed per arm. If many sessions hit it, check the snapshot patch and the scorer's readings for a harness fault.

Exit 1. Side effects: None: scoring spends nothing. Retry safe: yes. Resumable: yes. Owner: U20.

### E_SM_JUDGE_ANSWER

A labeller or judge reply is not one bare JSON object with exactly the frozen fields and values (preregistration sections 3 and 10). The reader fails closed: the answer counts as missing, a unit with a missing label is not eligible, and a missing stock-diff answer counts as scored above 0.

Fix: Nothing to fix in the reply. Report it as malformed; the counts print beside every judged number.

Exit 1. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U20.

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

The local SQLite ledger (--ledger, GSTACK_EVALS_LEDGER) is on a network or FUSE mount, or cannot be used. A program's record (--ledger-record) is held to the same rule when an envelope entry is written, because an entry slot there can have more than one winner; any other approval record is not.

Fix: Point --ledger at a local disk. The message prints the default, $XDG_STATE_HOME/gstack-evals/ledger.sqlite (on Capy, under ~/.capy/work/gstack-evals/). If a lease was closed at $0 because the local ledger failed while taking it (a busy lock, a full disk), fix that and lease again; the new lease takes the next slot. For a program, keep its record on the local disk of its one envelope host (docs/budget-ledger.md, Program envelopes).

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

### E_SESSION_SETTINGS

The Claude Code adapter could not make the session's settings at session start: the command that prints them in the session's sandbox (for the hook-enforced CEO arm, the session's own gstack-skill-gates settings --ceo-review) failed, or its output did not hold what the arm needs (both ceo-review gate shims). Claude Code never started. The cell is missing, not an arm failure, and nothing was spent.

Fix: Read the adapter's line in the session's host/cli-stderr.log, check that the arm's gstack tree is the pinned commit installed by its own setup and that bun runs in the arm image, then rerun the cell with --resume.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U10.

### E_SESSION_KIND_PIN

An arm that sets GSTACK_SESSION_KIND=unattended runs a gstack tree whose own bin/gstack-session-kind, run in the arm's session env before any session, did not print unattended, so the arm's sessions would not run as unattended. review-units refused the run before any session.

Fix: Check that the arm's gstack tree's bin/gstack-session-kind honors GSTACK_SESSION_KIND=unattended and that the agent env allowlist keeps GSTACK_SESSION_KIND, then rerun.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

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

### E_REAL_SANDBOX_SETUP

The real-outcome ship sandbox could not start or could not open a trial: git (with http-backend) or jq is missing, the sidecar could not listen, the task's bundle does not hold the base commit, the base tree holds project-local Claude Code configuration (a .claude/ directory or .mcp.json, which would give the none arm a skill, plugin or MCP route), or the in-container prep failed. For an outcome-skills registry arm (family G) it also means the task is K4, which G's registry has no replay turn for, the task statement is blank after trimming, or the arm's turns are not t1 to tn. In U4 mode it also means real_agent's image check refused before any sandbox or session opened: image_id is not a sha256:&lt;64 hex> id; the T-G image manifest is unset or unreadable, or its bytes do not hash to manifest_sha256; the manifest has no row for task_label, or that row pins another image than image_id; docker inspect could not read the trial container's image; or the container runs another image than image_id. No model was called for the trial.

Fix: Read the message. Install git and jq on the sidecar's host, or fix the task directory (B2) so its image's base branch is at base_commit. A repository with project-local Claude Code configuration is not eligible for this lane; drop it at mining. For a registry arm, run K4 tasks on a lane arm (lanes/real-outcome/arms/arms.json) or drop them from G's task list, give a blank task a statement in its instruction file, and give each registry arm the turns lanes/outcome-skills/arms/registry.json writes. For a U4 image refusal, run the task from its bound run copy (gstack-evals outcome images bind) and pass image_id from bind's output, with manifest and manifest_sha256 as the readiness post records them.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_OUTCOME_ARM

The outcome-skills arm registry (lanes/outcome-skills/arms/registry.json) refused. Either the file breaks its shape (a told arm without exactly one skill turn that opens with its skill, a turn 1 that does not open with the statement, a missing or non-positive limit, a clean-room told arm, a told arm whose skill its family does not hold, a G skill with no told arm), or a caller asked for something G does not run: a stand-in, forced or untold arm (not run in G, with the prereg's reason), a skill or exposure detector of family X or U (not built), an unknown name (an inherited name such as __proto__ or toString included), or an empty task statement.

Fix: Read the message. Use an arm that armNames lists for a G skill. A registry edit keeps the G prereg's turn texts, whose sha256s tests/outcome-skills/registry.test.ts pins; X and U arms and detectors come with their own families.

Exit 2. Side effects: None: refused before any spend. Retry safe: no. Resumable: no. Owner: U20.

### E_OUTCOME_TRANSCRIPT

A session record file the G exposure detectors read (lanes/outcome-skills/arms/exposure.ts) is not readable: a line before the last is not a JSON object, or an assistant or user record has no phase or parent_tool_use_id, so its turn and author are unknown. A torn last line is dropped and returned, not refused.

Fix: Write the record with a recorder that writes one JSON object per line and keeps each message's phase and parent_tool_use_id. Never hand-edit a session record to change an exposure read.

Exit 2. Side effects: None: refused before any spend. Retry safe: no. Resumable: no. Owner: U20.

### E_OUTCOME_AUTOPLAN_CONFIG

autoplan's told configuration check (lanes/outcome-skills/arms/autoplan.ts, G prereg section 4) refused. The pin checkout is not 699a41cb or its gstack-session-kind or autoplan-lean.ts differs, the slash line is not /autoplan PLAN.md, a codex binary or an OpenAI or Codex variable is in the arm's environment, or the pin's own leanMode and gstack-session-kind select the lean feature kind or a session kind other than interactive on the arm's environment. autoplan's admission does not start.

Fix: Don't change the frozen configuration to pass. Fix the image or environment only where it drifted from the configuration; any other cause goes to the Captain, as the G prereg says.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_OUTCOME_TOLD_INSTALL

The told install (lanes/outcome-skills/arms/told-install.sh and told.ts) does not match the pin's lite manifest: the home was not clean, the checkout is not 699a41cb at 1.94.39.0, a pin source file the detectors were built from differs, config.yaml does not set claude_loadout: lite, the lite render's file count or tree digest differs from #193's or it holds a broken link, settings.json is missing or not JSON, the hooks differ, a hook command is not its source's pin file under the HOME the session sees (.claude/skills/gstack/hosts/claude/hooks/&lt;name>), a hook file's sha256 differs from the pin's, or git status shows a change in the checkout. Or the told runtime preflight did not find bun on the session's PATH in the arm's image, or could not finish.

Fix: Install again into a fresh HOME with told-install.sh, at the path the session will see as HOME, and never edit a rendered or checked-out file. Put bun on the image's PATH for the session's user. A different digest from a clean install means the install changed, which goes to the Captain.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_OUTCOME_CLEAN_ROOM

The none arm's clean-room preflight (lanes/outcome-skills/arms/clean-room.ts, running panel v3 C1's script) found a Capy drive or gstack in the arm's session. C1's scan: a .capy, .local/share/gstack or .claude/skills path in its home, a Capy drive mounted under any home directory or under /root (seen through other users' 0700 homes), a home or work-tree AGENTS.md or CLAUDE.md that names gstack, or a work tree's .claude/skills. O1's second scan: a .gstack in the home; a .claude/skills folder anywhere in a work tree outside .git; gstack named in a CLAUDE.md in a parent of a work dir, in the home's CLAUDE.md, in .claude/settings.json or .claude/settings.local.json in the home or a work dir (where hooks live), in an entry under .claude/commands, .claude/plugins, .claude/agents or .claude/rules in the home or a work dir, or in an entry under the home's .claude/projects/*/memory (Claude Code's auto memory); and, present at all, a CLAUDE.local.md or .mcp.json in the home or a work dir, a CLAUDE.local.md in a parent of a work dir, ~/.claude.json, ~/.claude/.claude.json (Claude Code's global config when CLAUDE_CONFIG_DIR is ~/.claude, as the arm sets it), or any entry under /etc/claude-code (Claude Code's managed settings). Or either scan could not finish in the image. Each hit is named. The preflight also refuses before any scan when the image's id (docker image inspect --format '{{.Id}}') does not equal the recorded image digest, or cannot be read.

Fix: Remove the named path or mount from the none arm's session, or make the image present and able to run sh with no network, then rerun the same command. When the image's id is not the recorded digest, run the image the digest names (pull or load it by digest), or record the digest of the image you mean to run. The refusal comes before any lease.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_OUTCOME_IMAGE

T-G's image manifest or a trial's binding to it does not hold (lanes/outcome-skills/images/manifest.ts): the manifest is unreadable, has a row with no sha256 image id, digests or label of its own, or is not tg-images.v1 with home /root and work dir /testbed; or check found a manifest whose sha256 is not the --sha256 recorded for it; or bind found no manifest row for --label, a task dir path that is a symlink, an out path inside the task dir, a task dir whose task.json or environment digest (file bytes and executable bits) differs from its row, a task.json that is not JSON, a file that differs from task.json's file digests (edited, added or deleted), a symlink, a docker tag that failed, an image the manifest pins that is missing or whose local tag resolves to another id, an out dir that exists, or a task.toml with no [environment] section or a docker_image of its own; or pin's out file exists, before its builds or when its exclusive create finds one written meanwhile, quick/laneb's runtime layer did not build on a task image, or in that final image gold fails a required test (the message names it), gold's run stopped, or the empty change passes every required test.

Fix: Pin on a keyless build host and move the images with docker save and docker load, which keep each id. Check with the sha256 the readiness post records for the manifest. Bind the task dir the manifest was pinned from, on the host whose Docker holds the pinned images (the envelope host), into a new out dir. When an image is gone or moved, rebuild it with pin into a new manifest and record that manifest's digests before any session. When pin finds gold failing or the empty change passing in the final image, the runtime layer changes a hidden test's result: repair the task with check and pin again. Nothing was spent and no lease is open.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_TBV_NOT_BUILT

A trust-but-verify command or function is declared but not built yet (lanes/tbv). Nothing ran.

Fix: Use a build of gstack-evals that has it, or build the unit that owns it.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_TBV_INPUT

A trust-but-verify input does not hold: a file is missing, malformed or not at its frozen sha256, a split manifest does not match, or a flag combination is refused.

Fix: Fix the named input and run the command again into a new out directory. Never edit a frozen file to make it match.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_TBV_HISTORY

A history could not be assembled or was refused: it fails the provenance gate, holds a drive path or a crew rules file, or its record is unreadable. At render, a history whose API turns cannot be rebuilt refuses too: a call with no result, a result that answers no call still waiting for one, a repeated call id, or user text while a call waits. A dropped session is counted by reason, never repaired.

Fix: Read the drop reason. A provenance failure drops the session; a drive path means the source is not clean and must not be used. A render refusal names the event and the reason; tbv render-gate finds it before any lease, and it goes to the Captain.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_TBV_REBUILD

tbv rebuild-a refused: a pin is missing or does not hold (a bundle with no pinned commit, a pinned commit the checkout lacks, a pinned file missing at its commit, a pool file not at its pinned sha256 or naming another dataset version or Harbor commit, an export task directory missing or not at the pool's content hash), the pinned materializer refused a pool task, or --out sits inside a git work tree. Every refusal but the materializer's comes before any task directory is rebuilt.

Fix: Clone the repo in full so its history holds the pinned commits, download the export again with the pinned Harbor at the pinned version, and give a new --out outside any git checkout, on the run host or in the crew-only Captain drive. Never change a pin to make a rebuild pass: a pin changes only in a new post.

Exit 2. Side effects: None: nothing is spent. The new --out holds the pinned files under pins/. After an export or materializer refusal it also holds refusal.txt, which names the tasks the message leaves out, and after a materializer refusal the probe's directories and the task directories rebuilt before it, with no rebuild.json. All of it carries the custody of source A's raw bundles. Retry safe: yes. Resumable: no. Owner: U20.

### E_TBV_PROBE

tbv rebuild-a's probe failed: it rebuilt a held-tier task, whose directory R3 left in the drive, and got another digest than that directory's, or no held-tier session ran at a commit the rebuild tier needs, so nothing could check that commit's rebuild. No other task directory was rebuilt.

Fix: Stop. No rebuilt directory may enter the frame: either the rebuild does not reproduce R3's task directories from the pinned inputs, or a commit has no held-tier session to check it. Bring the refusal line to the Captain. After a digest mismatch the two digests are in refusal.txt in the out directory, which keeps source A custody with pins/ and the probe's directory; a commit with no held-tier session writes no refusal.txt. A fix to the inputs or the method needs a new post.

Exit 2. Side effects: None: nothing is spent. The --out holds pins/ with the custody of source A's raw bundles; after a digest mismatch it also holds the probe's rebuilt directory and refusal.txt. Retry safe: yes. Resumable: no. Owner: U20.

### E_TBV_SHAPE

The request-shape or splice capture failed: the pinned Claude Code did not run or answer the stub provider, the version is wrong, the skill start took a degraded path, or the captured text holds a drive path, a crew rules file or the org rules' wording.

Fix: Check the Claude Code version (2.1.312), the gstack checkout at the pin and the empty home. Never commit captured text; commit only its sha256.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_TBV_REQUEST

A request failed the structural validator or the closer byte check: an unpaired tool_use or tool_result, a thinking block, roles that do not alternate, a last message that is not the user's, too many cache breakpoints, a one-hour cache ttl, or a closer that does not match its pin. A size-only refusal drops the task instead.

Fix: This is a harness failure: the item stops and nothing is scored. Fix the builder or the splice under a new post before the stage runs again.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: no. Resumable: no. Owner: U20.

### E_TBV_RUN

A trust-but-verify item run stopped: a harness failure, an outage stop, a lease or ledger refusal, or a restart that could not reconcile the dead run's journal.

Fix: Read the item's run record. A cap or outage stop is incomplete and is never retried to change a verdict; it goes to the Captain.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: no. Resumable: no. Owner: U20.

### E_TBV_JUDGE

A trust-but-verify judge or key run refused its input: the brief is not at its frozen sha256, a packet changed since it was written, the packet key sits inside the packets directory, or a reply file does not match its batch.

Fix: Rebuild the packets into a new directory and run the judges again into a new out directory.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_TBV_CUSTODY

A custody rule refused the run: held-out plaintext outside tmpfs, plaintext left by a dead run, a sealed checkpoint that will not unseal, --dev-plaintext with held-out input, --seal-cmd without --held, an empty --held, --held without --seal-cmd, a sealed directory that already holds an earlier run's sealed copy, or a seal command that failed.

Fix: Run held-out work only with its plaintext root on /dev/shm, a non-empty --held and a seal command; delete leftover plaintext as the log says before anything else. Give each held keys, judge, packet or readings run a fresh --held directory. To restart a crashed keys or judge run, follow lanes/tbv/README.md: move its sealed copies aside, keep journal/, and rerun with the same --held and run id. If a seal command failed during a held drive, keys or judge run, the run's close has already settled its lease: fix the seal command, then rerun drive with the same --run-id and --out and an --unseal-cmd, or keys or judge by those restart steps.

Exit 2. Side effects: None when the run is refused at open, before any lease. A seal-command failure inside a held drive, keys or judge run, or a per-write refusal of an earlier run's sealed copy inside a held keys or judge run, can come after paid sends, which stay on the lease and its journal. Retry safe: no. Resumable: no. Owner: U20.

### E_TBV_BURNED

A confined held-out step (tbv held-step) found a held-out-derived --input on a fuse mount, a Capy drive that syncs off the machine, keeps earlier versions and is readable by other crew threads. That is a burned-task event, not a cleanup.

Fix: Stop B2. Log the path in CUSTODY.md and bring the affected tasks to the Captain, who rules on dropping them. Do not delete the file as a fix: the drive's retained versions and other threads' reads stay. Held-out-derived plaintext lives only under /dev/shm.

Exit 2. Side effects: None: the step stops before any container runs, and nothing is deleted. Retry safe: no. Resumable: no. Owner: U20.

### E_TBV_STEP

The command a confined held-out step (tbv held-step) ran exited non-zero inside its container, or docker could not start it. Nothing was sealed.

Fix: Read the command's stdout and stderr under &lt;work>/.held-step/ on tmpfs, fix the cause, delete the work dir by the leftover rule (log it in CUSTODY.md), and rerun with the same --held.

Exit 2. Side effects: Plaintext the command wrote stays in the work dir on tmpfs until the leftover rule deletes it. Nothing reached the sealed directory. Retry safe: no. Resumable: no. Owner: U20.

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

The real-outcome scorer could not read a trial's records as the lane defines them: a shipment.json that is not a real-outcome/shipment/v1 record, an arm that arms.json does not list, a K4 task with no replay role, a task bundle without the starting commit, a gold patch that does not apply, a trial-score.json of another schema, or a termination reason the taxonomy does not class. It also means a tree needed grading with no --image-id, or with a pinned image that is not on this host with that id or is not the image the trial logged, or that --task names a bound run copy rather than the task dir. Nothing was scored.

Fix: Read the message. A missing record means the trial is infra (rig reason), never a fail. An unclassed termination needs B7's frozen taxonomy (--taxonomy) to class it before any trial is scored. Grade in the task's pinned image: pass --image-id from its image manifest row, load the image with docker load (which keeps its id), and pass --task the original task dir, never its run copy. Only a trial whose session logged its image (U4) is graded.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_REAL_SCORE_GRADE

The real-outcome scorer's scratch git repository failed while it built a trial's trees: a bundle would not fetch, or git could not read, diff or write a tree. The trial has no grade yet; it is not a fail for the arm.

Fix: Check that git is installed and the work directory is writable, then rerun gstack-evals real score trial for the trial.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_REAL_SCORE_CONFIG

The real-outcome analysis config or termination taxonomy is not usable: a missing or wrong schema, a primary model outside the models list, the same arm as treatment and control, a task order that repeats a task or misses a build task of the primary model, a margin, ceiling or guard outside 0 to 1, fewer than 1000 bootstrap draws, or a taxonomy class other than completed, truncated or infra.

Fix: Fix the config to match the preregistration (lanes/real-outcome/score/README.md lists the fields). Never change a frozen number after the run to change a verdict.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U20.

### E_WASTE_INPUT

gstack-evals waste could not read an input: a file is missing or unreadable, a thread export is not a transcript page, item array or JSON lines of either, an item lacks its id, source or createdAt, a gstack-ship-receipt block is not JSON, or per-PR data has no prs array. The message names the input by its position, never by its path. Nothing was printed to stdout.

Fix: Re-export the thread (src/waste/README.md shows the export program) or fix the file the message points to, then run the command again.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U15.

### ENVELOPE_PROGRAM_STOP

A lease on a program's line item was refused before anything was written: the program's settled spend, its open leases, its admitted leases not yet written and this lease would pass the program's envelope. The message gives each figure.

Fix: Nothing was spent or reserved. Read gstack-evals ledger status --program &lt;program>, settle any lease whose stage has finished (settling releases what it did not spend), then lease less or stop the stage as incomplete. Never rerun to change a verdict. A larger envelope needs the owner's words and a new program.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U4.

### ENVELOPE_SKILL_STOP

A lease on a program's line item was refused before anything was written: for one of the item's skills, the line's settled spend, open leases, admitted leases not yet written and its even share of this lease would pass the skill's ceiling. The message names the skill and gives each figure.

Fix: Nothing was spent or reserved. Read gstack-evals ledger status --program &lt;program>, settle any lease whose stage has finished, then lease less or stop the skill as incomplete. Never rerun to change a verdict, and never move a stage to another skill's line to fit it.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U4.

### E_ENVELOPE_MISSING

No envelope is on record for the program a command names: a line item joining it at init, a crew reading or a status read. The CLI never implies a ceiling.

Fix: Check --program and --ledger-record. Otherwise escalate: the owner's program and skill ceilings are recorded with gstack-evals ledger envelope and their exact words (docs/budget-ledger.md). On Capy, ask your Captain through a needs-you report.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: no. Owner: U4.

### E_ENVELOPE_LATE

A lease on a program's line item reached its expiry after the envelope admitted it and before it was written. Its admission stopped counting at that expiry and another stage may hold the room, so the lease is not written.

Fix: Lease again. If it happens again, the machine is stalling between admission and the lease write, or --ttl is too short.

Exit 2. Side effects: None: refused before any spend. The admission stays in the program's record and counts nothing. Retry safe: yes. Resumable: no. Owner: U4.

### E_MUTATION_DOCKER

Docker failed while building a mutation tool or scorer image, creating a volume or preparing a tree for the mutation scorer, so the tree got no mutation reading.

Fix: Read the build or prepare log in the message. A tool image builds once with the network; the scorer image and every scoring step need none. Fix the host or the image and score the tree again.

Exit 2. Side effects: Partial: images already built stay cached; the scorer's volumes are removed. Nothing was spent. Retry safe: yes. Resumable: no. Owner: U20.

### E_MUTATION_INPUT

The mutation scorer was given a project image that is not on this host.

Fix: Build or load the task's project image first, then score the tree again.

Exit 2. Side effects: None: refused before any container ran. Retry safe: yes. Resumable: no. Owner: U20.

### E_PIN_MISMATCH

R3c (quick/laneb/r3) read a pinned record whose sha256 is not the one its preregistration freezes: an in-hand trial record, the task-fit table, an L1 task list, a task's verifier parser or the told arm's tar. Nothing that depends on it ran.

Fix: Copy the record again from the path the message names (the Captain-drive path beside INHAND in r3/r3c-rules.ts, or the post folder) and rerun the same command. Never edit a pin to match a changed file.

Exit 2. Side effects: None: refused before anything was prepared, bound or launched. Retry safe: yes. Resumable: no. Owner: U20.

### E_AR_FRAME_DRIFT

The autoplan record audit (lanes/autoplan-audit) found its frozen inputs changed: the frame snapshot's manifest digests, a per-file digest, the run id list, a missing or extra file, the pinned gstack Pre-Gate table or a frozen matched path differs from what the preregistration froze. The run stops before any reading.

Fix: Restore the frozen snapshot (or the pinned gstack clone) and rerun. Never edit the frozen digests to fit; a changed frame is a new preregistration.

Exit 2. Side effects: Partial: the run's sink keeps what was written before the stop, marked incomplete; the open lease is settled at the spend recorded so far. Retry safe: yes. Resumable: no. Owner: U20.

### E_AR_SUPPLY_SHORT

The autoplan audit's gold supply is short: fewer than 80 HIT units or 40 ablatable ones in stage 1, too few eligible lean runs or units for GATE-2, or a gold class still under 40 after its one top-up. GATE-2's panel part stops; the free readings stand.

Fix: Report it to the Captain. GATE-2 reads NO READ; its mechanical hit share prints. Do not lower the bar or redraw to fill the pool.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: no. Owner: U20.

### E_AR_SMOKE_FAIL

The autoplan audit's smoke failed: a record parser on one gstack minor version, or a panel judge and effort pair whose label does not parse, whose quote fails the check or whose reply stops at its output limit.

Fix: One repair is allowed (parser, prompt format or output limit) before any gold or production call. A second failure drops that instrument and its check reads NO READ.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: no. Owner: U20.

### E_AR_PACKET_LEAK

The autoplan audit's outbound check refused a packet, a reply cache file or an aggregate export: it holds a replaced token class, a 6-word run of owner words, a secret pattern, an email address, a withheld task id or a part with no allowed source. Nothing was sent; the run stops.

Fix: Find the source of the leak with the run's private log, fix the scrub or the source, and start a new run with a new sink. Never relax the scan.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: no. Owner: U20.

### E_AR_JUDGE_KAPPA

The autoplan audit's judge check failed: GPT-6 Astra's or Claude Opus 5.5's Cohen's kappa against gold is below 0.6, or Gemini 4 Argon's is (under the Captain's pre-data ruling a failed Argon check makes GATE-2 read NO READ). GATE-2's panel part stops.

Fix: Report it to the Captain. GATE-2 reads NO READ and its mechanical hit share prints. Never re-judge to pass the check.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: no. Owner: U20.

### E_AR_PROVIDER_DRIFT

An autoplan audit call to Gemini 4 Argon through OpenRouter was served by a provider other than its pin (Google Vertex), or named none. Argon's calls stop; split units with no Argon vote are missing.

Fix: Report it to the Captain with the provider OpenRouter named. Do not move the pin during the run.

Exit 2. Side effects: Partial: completed cells and their spend are kept; nothing is sent twice. Retry safe: yes. Resumable: no. Owner: U20.

### E_AR_CUSTODY

The autoplan audit's told-session custody failed: a told record's digest differs, decryption failed, the identity or a decrypted file is still on disk after its removal, or the sink is not on /dev/shm. The run stops.

Fix: Delete any leftover decrypted file (test ! -e after), log the incident in CUSTODY.md and report it to the Captain before anything else.

Exit 2. Side effects: Partial: CUSTODY.md holds every opening and the incident; no told content left the machine. Retry safe: yes. Resumable: no. Owner: U20.

### DR_ALLOWANCE_STOP

Decision routing: the metering proxy refused a session's next model or decider call because the session's $5 allowance could not hold its worst case. The proxy answers HTTP 403 with DR_ALLOWANCE_STOP in the body and journals the refusal; the session wrapper ends the session as allowance_stop, never as an infrastructure error, so Harbor does not rerun it.

Fix: Nothing to repair in the session: the verifier grades the patch in /testbed as it stands and the stop prints per cell. If many sessions stop this way, send the proxy journal and the per-cell counts to the Captain; the allowance is frozen by the preregistration.

Exit 2. Side effects: Partial: the session's earlier calls are spent, settled and counted; the refused call was neither reserved nor sent. Retry safe: no. Resumable: no. Owner: U6.

### DR_STEP_STOP

Decision routing: a session reached 100 executed actions (main-model and decider actions alike), so the action counter ended it as step_stop before running another action.

Fix: Nothing to repair: the verifier grades the patch in /testbed as it stands, and the stop prints per cell and kind. The limit is frozen by the preregistration.

Exit 2. Side effects: Partial: the session's spend and time count; actions past the 100th in the same reply were not run. Retry safe: no. Resumable: no. Owner: U6.

### DR_WALL_STOP

Decision routing: a session ran past its 2,700-second wall limit, so it ended as wall_stop.

Fix: Nothing to repair: the verifier grades the patch in /testbed as it stands, and the stop prints per cell and kind. If wall stops cluster on one host, check that host's load before the next batch.

Exit 2. Side effects: Partial: the session's spend and time count up to the stop. Retry safe: no. Resumable: no. Owner: U6.

### DR_CUSTODY_HIT

Decision routing: a request on a decision-routing slot carried the slot's planted canary, content that exists only on the runner, so the run stopped and the hit was logged. This holds for any model, main or decider, since the frontier decider asks the main model's own id. Any other runner-only marker (a hidden test name or a path absent from the pristine image), on a main-model or a decider request, is logged as a marker_hit line and never stops a session or a batch. An existing test name, or an agent diff equal to the real fix, is not a marker.

Fix: Stop and report to the Captain with the hit's log line. Find how the content reached the agent's side, fix the custody path, and start a new batch only on the Captain's word. Do not --resume.

Exit 2. Side effects: Partial: sessions that already ended keep their spend and grades; the controller settles every open lease. Retry safe: no. Resumable: no. Owner: U6.

### DR_ADMISSION_STOP

Decision routing: an admission rule of the preregistration (room in the control, transfer, or the MDD inside the margin) failed on calibration or pilot data, so the run stopped for the Captain before the next stage.

Fix: Send the admission printout to the Captain and wait for a decision. Nothing reruns to change an admission reading.

Exit 2. Side effects: None beyond the finished stages: their spend is settled, and no session of the next stage was launched. Retry safe: no. Resumable: no. Owner: U6.

### DR_PILOT_SESSION_STOP

Decision routing: a pilot session's proxy meter passed $2.50, so the controller stopped the batch: it launches no new session and lets running ones end.

Fix: Send the session's meter and journal to the Captain and wait for a decision before any relaunch. The controller reconciles open leases before it starts again.

Exit 2. Side effects: Partial: running sessions ended and their spend counts; every lease is settled. Retry safe: no. Resumable: no. Owner: U6.

### E_DR_PIN

Decision routing: the pin file's sha256, or one of the digests it names (questions, mapping, safety rule), is not the one the run was frozen with, so nothing launched.

Fix: Copy the pinned file again from the run record and rerun the same command. Never edit a pin to match a changed file.

Exit 2. Side effects: None: refused before any lease, proxy or session started. Retry safe: yes. Resumable: no. Owner: U6.

### E_DR_RUNTIME

Decision routing: the runtime tarball's sha256 is not the pinned one, so no session was launched with it.

Fix: Rebuild the tarball with lanes/decision-routing/agent/runtime/build.sh at the pinned commit, or copy the pinned tarball again, and rerun.

Exit 2. Side effects: None: refused before any session started. Retry safe: yes. Resumable: no. Owner: U6.

### E_DR_RUNNER

Decision routing: lanes/decision-routing/host/vm.sh was given an Ubicloud runner whose sha256 is not the pinned one, or no UBI_OWNER or UBI_TTL_HOURS, so it did not call the runner.

Fix: Point vm.sh at the pinned copy of ubi-runner.sh with its sha256, set UBI_OWNER to the thread code and UBI_TTL_HOURS to cover the longest batch, and rerun.

Exit 2. Side effects: None: refused before any VM call. Retry safe: yes. Resumable: no. Owner: U6.

### E_DR_STOPPED

Decision routing: the controller found its STOP file, so it launched no new session, let running sessions end and settled every lease.

Fix: Remove the STOP file once the reason for it is dealt with, then relaunch the same plan; the controller reconciles open leases first and runs only the sessions that never launched.

Exit 2. Side effects: Partial: sessions that ran keep their spend and results; every lease is settled. Retry safe: yes. Resumable: yes. Owner: U6.

### E_PV_PROVIDER_DRIFT

Product-value eval (section 17, rule 6): a call through OpenRouter was served by a provider other than the one its route pins (OpenAI for GPT-6.1 Sol, the recorded serving provider for particle-1 and Gemini), or the provider's recorded terms changed. That model's items stop for the Captain.

Fix: Stop leasing the model's items, keep the journal line that shows the provider, and send the question to the Captain. Never retry on another provider.

Exit 2. Side effects: Calls already sent on the lease stay on its journal and its spend. Retry safe: no. Resumable: no. Owner: U20.

### E_PV_SUPPLY_SHORT

Product-value eval (section 4): supply is short. A named project type has fewer than 4 eligible units across both sources, the pooled count of passing comparison units is under 48, or a second named type is short of 2 audited public units in the calibration slice. Authoring stops and the question goes to the Captain.

Fix: Stop authoring, report the counts per type and source, and wait for the Captain's ruling before any more authoring spend.

Exit 2. Side effects: None beyond the authoring spend already settled. Retry safe: no. Resumable: no. Owner: U20.

### E_SM_UNIT

A state machines unit (sm-unit.v1, lanes/outcome-skills/statemachines/unit.ts) is refused: a dataset row with an empty or unparseable FAIL_TO_PASS or PASS_TO_PASS list, a base commit that is not 40 hex, an image with no pinned digest, a patch that is not a git diff, a parser with no parser(), no test command, or a unit dir whose files differ from unit.json's digests.

Fix: Convert the unit again from the pinned cache with gstack-evals outcome sm convert. Never hand-edit a unit dir.

Exit 2. Side effects: None: refused before any spend. Retry safe: no. Resumable: no. Owner: U20.

### E_SM_SOURCE

The state machines family's source does not match its pins: a SWE-bench-Live MultiLang parquet file whose sha256 is not the one source.ts pins for revision eb09c2e5, a download that failed, a parquet read that failed, or a preregistration JSON that pins another revision.

Fix: Run gstack-evals outcome sm source fetch again on a clean cache dir. A changed file at the pinned revision is a new source and needs a new preregistration.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U20.

### E_SM_SEED

The state machines draw found no seed: the preregistration's JSON (prereg.json in the post bundle) is missing, is not sm-prereg.v1, or lacks an unsigned 32-bit integer draw_seed, bootstrap_seed or order_seed.

Fix: Add the seeds through the preregistration's own pull request. The draw never runs on a seed chosen anywhere else.

Exit 2. Side effects: None: refused before any spend. Retry safe: no. Resumable: no. Owner: U20.

### E_SM_ANALYSIS

The state machines analysis, admission readings or packet reader refused its input: the analysis input is not sm-analysis-input.v1, a record lacks its model, a row repeats or names an unknown unit, model, arm or tree, a number is outside its frozen form, or a judge or labeller answer file does not parse.

Fix: Rebuild the input from the scorer's records with gstack-evals outcome sm analyse, or fix the answer file the message names. Frozen numbers (draws 10000, replicates 3, the bootstrap seed) come from the preregistration only.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U20.

### E_SM_ARM

A state machines arm (family SM in lanes/outcome-skills/arms/registry.json) is refused: an SM arm whose name, kind, install, clean room, turns or per-model limits break the family's shape, an arm text that is not the preregistration's, a scope that is empty or multi-line, or a qa:told run while the /qa pin is not recorded.

Fix: Restore registry.json's family SM arms from the preregistration (tests/outcome-skills/sm-arms.test.ts pins every text by sha256), record the /qa pin at freeze, and pass the unit's scope as one line.

Exit 2. Side effects: None: refused before any spend. Retry safe: no. Resumable: no. Owner: U20.

### E_SM_STRIP

A state machines session saw instructions the strip rule removes: a CLAUDE.md, CLAUDE.local.md or AGENTS.md, or a file under .claude/, inside the repository, in the session's tree or its loaded memory; or an A3 (qa:told) session whose loaded memory lacks gstack's installed instructions. The session is not scored.

Fix: Prepare the unit's base tree again with the strip (gstack-evals outcome sm convert), check nothing in the arm setup writes into the repository, and for A3 check the install went into the container's home after the strip.

Exit 2. Side effects: None: refused before any spend. Retry safe: no. Resumable: no. Owner: U20.

### E_SM_UPSTREAM_GAP

A state machines session ended on a provider or proxy error twice, the first try and its one retry from a fresh container, so the session is a gap (preregistration section 6), not a miss.

Fix: Nothing to fix in the session: report the gap per arm and cell. Check the provider's status and the proxy journal if gaps cluster.

Exit 2. Side effects: The two tries spent what the proxy metered for them. Retry safe: no. Resumable: no. Owner: U20.

### E_SM_INFRA_GAP

A state machines session failed outside the model twice (container, pull, Harbor or agent setup), the first try and its one rerun, so the session is a gap (preregistration section 6), not a miss.

Fix: Read the session's agent log for the failure, fix the harness, and report the gap per arm and cell; a gap is never rerun a third time.

Exit 2. Side effects: The two tries spent what the proxy metered for them. Retry safe: no. Resumable: no. Owner: U20.

### E_SM_TEST_PATCH_CONFLICT

A hunk of the fix's tests (test.patch, or the fix patch's in-source test hunks) still conflicts after git apply --3way over an arm's scored tree, so that reading is a scoring gap (preregistration section 7, step 3), counted per arm, never a miss.

Fix: Nothing to fix in the session: report the gap per arm and reading. The record names the hunk and the unmerged files.

Exit 2. Side effects: None: scoring spends nothing. Retry safe: yes. Resumable: yes. Owner: U20.

### E_SM_PACKET

A labeller or judge packet (preregistration sections 3 and 10) could not be built: the unit dir lacks a file, the session model has no frozen judge, a stock copy could not be diffed, or the packet text names the session's model, cell or id, which packets must never show.

Fix: Check the unit dir and the session record. A packet that names its session is never sent; report it and leave that diff unjudged.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U20.

### E_SM_SECONDARY

A keyless secondary (preregistration section 10) could not read the local clone it needs: the base commit or a candidate commit is missing, or git failed.

Fix: Clone the public repository with full history (git clone --filter=blob:none) and fetch refs/pull/&lt;n>/head into refs/sm/pull-&lt;n>, then rerun. Never read history from a paid or keyed API.

Exit 2. Side effects: None: refused before any spend. Retry safe: yes. Resumable: yes. Owner: U20.

### E_PROXY_SERVER_TOOL

The metering proxy refused a request whose tools list carries a provider-side tool (a typed tool such as web_search or web_fetch), before pricing it, because its lease runs with refuseServerTools on (the state machines family's stages).

Fix: Disallow the tool in the agent (Claude Code's WebSearch and WebFetch are disallowed in every SM arm). Never turn the option off for an SM stage.

Exit 2. Side effects: None: refused before any spend. Retry safe: no. Resumable: no. Owner: U20.

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

### JUDGE_REPLY_REFUSED

A noloss judge-run --ceo reply broke the prereg's section 8 failure rule: no block, a line that is not JSON, a review the packet doesn't hold, a review answered twice, or a list of the wrong length. It gets one retry in a fresh request; a second refusal leaves the packet missing with the cause in replies.json.

Fix: Nothing to do for one refusal. For a packet left missing, read its raw replies under raw/ in the judge run's --out.

Warning. Owner: U13.

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

### JOURNAL_MISSING

The outcome-skills driver recovered an open lease from an earlier run on this machine and found no proxy journal for it, so nothing tells which of its calls were answered. The settle keeps every call still reserved at its full reservation.

Fix: Nothing to undo: the lease closes charging every unanswered call in full, which can only overstate spend. Recovery runs only from the run directory that holds the lease, so a missing journal means the earlier driver stopped before its proxy started, or the journal was removed.

Warning. Owner: U4.

### SESSIONS_OPEN

ledger settle or ledger reconcile closed a driver's lease, but could not write a close line for the sessions its run directory's sessions.jsonl still shows open on it: that file is not on this machine, a settle ran where the local ledger does not hold the lease, or settle --from imported the close, which carries no per-session figures. The close is in the record and nothing about the money changes, but unknownFromRun refuses admission item 5 for the run while a session has no close line.

Fix: Run the same command again on the envelope host that holds the run directory and the lease's local ledger; after settle --from, run ledger settle --lease &lt;lease> there instead. A retry answers the close already in the record and writes only the missing close lines. Never edit sessions.jsonl by hand.

Warning. Owner: U4.

### STAGE_RECOVERED

The outcome-skills driver found a stage lease that an earlier launch of the same run, from the same run directory, left open on this machine, reconciled its proxy journal and settled it before opening anything new.

Fix: Nothing is required. Sessions the earlier driver was serving count as gaps whose named repair is the driver relaunch; the batch reruns them under its rerun rule.

Warning. Owner: U4.

### STAGE_SETTLED

The outcome-skills driver closed one stage: it closed the stage's live sessions, stopped its proxy, reconciled the proxy journal and settled the stage lease. The line names how the stage ended (completed, cap_stop, lease_expired or failed) and, on a cap stop, which stages it ended.

Fix: Nothing is required. A cap stop is an incomplete run and is never retried to change a verdict; a lease_expired stage resumes when the driver is launched again for the same run from the same run directory.

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

### E_AR_UNREADABLE

A record file in the autoplan audit's frame (run.json, decisions.jsonl, findings.jsonl, gate.json, a bound result or another file a check reads) is missing or does not parse. The units that need it are counted missing; the run goes on.

Fix: Nothing to fix in the run: the count prints beside each reading, and a stratum under 90% readable reads NO READ.

Warning. Owner: U20.

### E_AR_LABEL_MISSING

A panel reply in the autoplan audit gave no usable label: it did not parse after the lenient parse, its evidence quote is not in the packet's built text, the call failed after its one retry or its outcome is unknown. The label is counted missing and never re-asked.

Fix: Nothing to fix in the run: missing labels print, and GATE-2 reads on its missing bounds.

Warning. Owner: U20.

### E_TRANSCRIPT_UNREADABLE

R3c's localization reader (quick/laneb/r3/r3c.ts) found a graded trial whose sdk-messages.jsonl has no readable main-thread assistant text: no assistant text block, or assistant records written without the parent_tool_use_id field, so main-thread text can't be told from a subagent's. The trial's localization is a recorded error, never a miss, and the localization lines print no rates while any graded trial has one.

Fix: Read the trial's evaluator/sdk-messages.jsonl. A log from a build before parent_tool_use_id was logged can't be scored; nothing else changes. The primary outcome is unaffected, since localization decides nothing.

Warning. Owner: U20.

### ENVELOPE_OVER

A program's line, or one of its skills' lines, holds more than its ceiling: crew use is recorded after it is spent, and a lease can close above its reservation (LEASE_OVERSPENT). The spend is recorded as it is, and every new stage on that line is refused.

Fix: Nothing to undo: the money is spent and recorded. Report it to the Captain with gstack-evals ledger status --program &lt;program>. The line's skill stops as incomplete.

Warning. Owner: U4.

### DR_DECIDER_FAILED

Decision routing: a decider call (Jev, particle-1 or the typed frontier question) failed after its retry, so the decision fell to the next layer (for relevance, the hit is kept) and the session went on. Its cost and time are billed, and decision-level scores count it as wrong.

Fix: Nothing to undo. Read the session's decisions.jsonl and the proxy journal for the cause. Over 5% of a cell's decisions failing marks the cell degraded (DR_CELL_DEGRADED).

Warning. Owner: U6.

### DR_STATE_OVER_LIMIT

Decision routing: a decision state stayed over Jev's 32K per-question limit after trimming, so Jev was not asked and the decision went to the next layer. It is counted per cell.

Fix: Nothing to undo. If the count is high, report it with the results; the trimming rule is frozen by the preregistration.

Warning. Owner: U6.

### DR_LABEL_MISSING

Decision routing: a grounded label could not be computed for a decision (for example, a snapshot that will not build), so that decision has no label. It is counted and never imputed.

Fix: Nothing to undo. Read the label run's log on the runner for the cause; the decision stays unlabelled in every score.

Warning. Owner: U6.

### DR_CELL_DEGRADED

Decision routing: over 5% of a cell's decisions had a decider failure, so the cell is marked degraded, and a null on it reads FIX-METHOD on infrastructure.

Fix: Report the cell and its failure causes from the proxy journal with the results. Nothing reruns to change the reading.

Warning. Owner: U6.

### E_PV_NO_BLOCK

Product-value eval (prereg 2026-11-08-geva-403, section 6): a completed reply holds no plan-changes block that the strict parse or the one frozen lenient parse can read. The review scores 0 and counts as no-block in its cell; it is not missing.

Fix: Nothing to rerun: no-block is the arm's own outcome. The no-block rate prints per cell, and smoke rule 1 reads it for the gstack arms.

Warning. Owner: U20.

### E_PV_INFRA_MISSING

Product-value eval (section 6): a session ended on an infrastructure failure (an API error, a crash, a harness timeout, an allowance stop or a context overflow before any reply) and its one retry under the same named reason failed too. The session is missing: it counts against coverage and never scores 0.

Fix: Nothing to rerun: a missing session stays missing. If one cause repeats across sessions, read the session logs the message names and report it before the next item leases.

Warning. Owner: U20.

### E_PV_WEB_CONTAMINATED

Product-value eval (section 5): a session's transcript holds a successful WebSearch or WebFetch result even though every arm runs with both tools denied. The session is excluded as missing, counted against coverage and reported per arm.

Fix: Check that the arm's disallowed tools list still names WebSearch and WebFetch and that the trial network reaches only the metering proxy; then report the count per arm.

Warning. Owner: U20.

### E_PV_LABEL_MISSING

Product-value eval (section 7): a judge left a (list, key item) cell without a parsable label after the packet was resent once, whole, or a Gemini tie-break failed twice. The cell stays unlabelled and counts against coverage, never as not anticipated, and a review with any unlabelled primary cell is unscored.

Fix: Nothing to resend: the frozen rule allows one resend per packet and one retry per tie-break. Read the judge's raw reply named in the message; the coverage line reports the cell.

Warning. Owner: U20.

### E_PV_JUDGE_KAPPA

Product-value eval (section 7, R78): a production judge's Cohen's kappa against the gold cells is under 0.6, on all gold cells or on real-list cells alone. Only the contrasts of the models that judge serves read untested (judge); the other judges' contrasts stand.

Fix: Nothing to rerun under this preregistration. Report the judge's catch rate, false-fail rate and both kappas beside each contrast it serves.

Warning. Owner: U20.

### E_PV_STOCK_FAIL

Product-value eval (section 8): for at least one production judge, one stock row was credited with a primary item on more than one unit in eight (more than 3 of the 24 calibration units in stage 1, more than n/8 rounded down of n comparison units in stage 2). In stage 1 the family stops; in stage 2 every contrast of the family reads untested (stock).

Fix: Nothing to rerun. Report the per-judge, per-row counts; the next attempt needs a new preregistration.

Warning. Owner: U20.

### E_PV_NO_READ

Product-value eval (sections 7 and 10): a reading cannot be made. Either a production judge has fewer than 40 gold cells in either class from at least 40 distinct lists (NO READ (judge)), or a stage 1 admission input failed: the Astra judge's check on Opus lists or the none arm's parse rate under 95%.

Fix: Nothing to rerun under this preregistration. Report which input failed and its counts; the family ends at stage 1.

Warning. Owner: U20.

### E_PV_EXPOSURE_FALLBACK

Product-value eval (section 10, smoke rules 2 and 3): a smoke rule tripped and its frozen fallback applies. Rule 2: fewer than 4 of plan-ceo-review's 6 Opus smoke blocks carried an expansion proposal, so every plan-family arm gets the fallback sentence and the smoke reruns. Rule 3: plan-ceo-review was exposed in fewer than 5 of 6 Opus smoke sessions, so its stage 2 arm runs under gstack's opt-in gate after its own 6-session smoke.

Fix: Run the fallback items the Captain recorded for the rule (pv-s1-plan-fb-*), name the fallback in every headline that reports the family, and read admission only after the rerun.

Warning. Owner: U20.

### E_PV_EXPOSURE_STOP

Product-value eval (sections 10 and 11): a skill arm's exposure is too low to go on. Either its exposure after the first 32 Opus skill sessions of stage 2 is under 0.70 (its cells read untested and its remaining caps are released), or office-hours was exposed in fewer than 5 of its 6 Opus smoke sessions, so its stage 2 does not start (FIX-METHOD on the instrument).

Fix: Stop leasing that arm's items and report the exposure count and the detector lines behind it to the Captain.

Warning. Owner: U20.

### E_PV_LEAK_EXPOSED

Product-value eval (section 11): a model's stated training cutoff falls after a unit's plan date, so that unit's cells are descriptive and out of the model's primaries. When more than a quarter of a model's units are leak-exposed, the model's primaries read untested (leak).

Fix: Nothing to rerun. Check the cutoff the build recorded from the provider's published documentation and the unit's plan date, and report the count per model.

Warning. Owner: U20.
