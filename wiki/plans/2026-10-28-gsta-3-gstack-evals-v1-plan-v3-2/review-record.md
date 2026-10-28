## Review record


### gstack-autoplan run log (run autoplan-20261028004737, session_kind unattended, status complete)

Host: gstack-autoplan. Scope: UI no (8 matches); DX yes (154 term matches, developer tool). Phase order: ceo → dx → eng.
Deviation: autoplan guard: not enforced by this host; publication order is unverified (GUARD_NOT_INSTALLED)

#### ceo: closed 2026-10-28T14:18:37.191Z; snapshot 05dc4c6e050d4c788f5d70b74b66c7bcfa751582bcf1792d4fccaaf6112a24f1

- native completed (model anthropic/claude-opus-5-5, provider host-subagent, 14 findings, sha256 abbe13a6a7ff)
- outside completed (model openai/gpt-6-astra, provider host-subagent, 3 findings, sha256 883bf50a3581)

```
CEO DUAL VOICES - CONSENSUS TABLE:
  Severity        anthropic/claude-opus-5-5(native) openai/gpt-6-astra(host-subagent)
  Critical        0                            0
  High            3                            3
  Medium          9                            0
  Low             2                            0
  Informational   0                            0
  Findings        14                           3
CONFIRMED 0 · SAME LOCATION, UNVERIFIED 0 · DISAGREE 0 · NEW (outside only) 3 · native only 14. Both completed.

Reconciliation (each outside finding against the native result):
| outside | native | disposition | resolution |
|---|---|---|---|
| autoplan-20261028004737-ceo-r3-outside-1 The November pilot depends on Lane B integrations deferred to December | - | new | not raised by the native voice |
| autoplan-20261028004737-ceo-r3-outside-2 The four-release reuse policy is absent from parity sizing and its budget table | - | new | not raised by the native voice |
| autoplan-20261028004737-ceo-r3-outside-3 Partial rotation resets digest-keyed budgets without accounting for retained tasks | - | new | not raised by the native voice |
| - | autoplan-20261028004737-ceo-r3-native-1 The diets Lane A exists to guard already shipped (v1.91.287.0 /learn, v1.91.289.0 plan-design-review, office-hours, design-review) and the Phase 1 shakedown does not audit them | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-ceo-r3-native-2 Decision 9 and the budget headline sit at the least likely SD and price corner, so parity not attempted is the expected v1.1 outcome | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-ceo-r3-native-3 Every stage of v1.0's required /review experiment (about 13 public cases, about 7 derived for confirmation) sits under the plan's own 24 to 38 point detection floor | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-ceo-r3-native-4 Phase 1 harness-check and Opus overhead-probe lines are priced below the floor of the plan's own cited per-trial costs | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-ceo-r3-native-5 The cut track cannot promote any diet when Opus is at ceiling, because --margin turns a ceiling model into MARGIN_NOT_ATTEMPTED | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-ceo-r3-native-6 Per-skill lift on Opus 5.5, which CREW names, is not produced in v1.1 although Lane A's none arm already measures it | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-ceo-r3-native-7 The measured-gstack pin (v1.91.284.0, 10b77de) predates the contract Lane A implements, and no rule says which of roughly ten releases a day get counted readings | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-ceo-r3-native-8 Decision 15's fixed roster conflicts with the CREW peg rule for open-weight slots, and its confirmation is deferred past the point it shapes minting | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-ceo-r3-native-9 Derived plan-gate keys come from Garry's grades of gstack's own session findings, a home-team tilt in the family that tests gstack's distinctive skills | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-ceo-r3-native-10 Implementation ceilings (M0 plus M1a 150M tokens) sit below the plan's own basis (163M for planning, 5.11B for HARN-1) and leave out the per-PR /autoplan and /ship gstack requires | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-ceo-r3-native-11 Decision 2 ties the public CLI's durable ledger to a Capy Captain drive, and leases from one drive file across machines have no atomic step | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-ceo-r3-native-12 The Martian re-measurement does not say the two-sentence baseline runs in the same Claude Code harness and tools as gstack /review | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-ceo-r3-native-13 Lane A's 5-informative-task floor gives exit 2 where gstack's contract would PASS, as on write-skill's 2 committed tasks | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-ceo-r3-native-14 Garry's sealed-source correction is dated 2026-10-28 in the plan and 2026-10-27 in CREW | native_only | not raised by the outside voice |
```

#### design: skipped (no UI scope detected)

#### dx: closed 2026-10-28T14:35:49.843Z; snapshot 05dc4c6e050d4c788f5d70b74b66c7bcfa751582bcf1792d4fccaaf6112a24f1

- native completed (model anthropic/claude-opus-5-5, provider host-subagent, 19 findings, sha256 6c9fcaeadc09)
- outside completed (model openai/gpt-6-astra, provider host-subagent, 6 findings, sha256 8badabcf499d)

```
DX DUAL VOICES - CONSENSUS TABLE:
  Severity        anthropic/claude-opus-5-5(native) openai/gpt-6-astra(host-subagent)
  Critical        0                            1
  High            8                            4
  Medium          8                            1
  Low             3                            0
  Informational   0                            0
  Findings        19                           6
CONFIRMED 0 · SAME LOCATION, UNVERIFIED 6 · DISAGREE 0 · NEW (outside only) 0 · native only 13. Both completed.

Reconciliation (each outside finding against the native result):
| outside | native | disposition | resolution |
|---|---|---|---|
| autoplan-20261028004737-dx-r3-outside-1 CAP4:trial-token receipts:redaction | autoplan-20261028004737-dx-r3-native-6 The new grader import of 'changed files under the task's paths' has no paths source in contract tasks and, under any tracked-or-declared reading, drops .gstack-home (git-excluded by learn's seed.sh), which 3 of /learn's 10 checks read | unverified | same location, agreement unverified (plan.md:178): The new grader import of 'changed files under the task's paths' has no paths source in contract tasks and, under any tracked-or-declared reading, drops .gstack-home (git-excluded by learn's seed.sh), which 3 of /learn's 10 checks read |
| autoplan-20261028004737-dx-r3-outside-2 CAP6:ledger lease recovery:recovery | autoplan-20261028004737-dx-r3-native-3 CAP6:E_LEDGER_PATH:fix - v3.1 removed $GSTACK_EVALS_LEDGER and names no flag, variable or default for either ledger tier, and the named home of the durable record (the Captain drive, a fuse.capydrive mount) is the mount type E_LEDGER_PATH refuses, so the refusal has no valid place to send the caller | unverified | same location, agreement unverified (plan.md:188): CAP6:E_LEDGER_PATH:fix - v3.1 removed $GSTACK_EVALS_LEDGER and names no flag, variable or default for either ledger tier, and the named home of the durable record (the Captain drive, a fuse.capydrive mount) is the mount type E_LEDGER_PATH refuses, so the refusal has no valid place to send the caller |
| autoplan-20261028004737-dx-r3-outside-3 CAP6:runtime error records:context | autoplan-20261028004737-dx-r3-native-7 CAP6:error-record:context - the new versioned error record has no context, cause or doc field and 'redacts causes' instead of scrubbing secret values from them | unverified | same location, agreement unverified (plan.md:212): CAP6:error-record:context - the new versioned error record has no context, cause or doc field and 'redacts causes' instead of scrubbing secret values from them |
| autoplan-20261028004737-dx-r3-outside-4 Ordinal reply fallback can authorize a reordered question instead of the intended action | autoplan-20261028004737-dx-r3-native-2 E_INTERACTIVE_HOST and E_USER_TURNS_MISSING key on an 'interactive skill' the plan never defines; /learn lists AskUserQuestion in allowed-tools and every gstack skill carries the AskUserQuestion preamble, so a text rule refuses the Phase 1 /learn shakedown on both hosts | unverified | same location, agreement unverified (plan.md:162): E_INTERACTIVE_HOST and E_USER_TURNS_MISSING key on an 'interactive skill' the plan never defines; /learn lists AskUserQuestion in allowed-tools and every gstack skill carries the AskUserQuestion preamble, so a text rule refuses the Phase 1 /learn shakedown on both hosts |
| autoplan-20261028004737-dx-r3-outside-5 The split ledger exposes two storage locations but only one documented address | autoplan-20261028004737-dx-r3-native-4 CAP6:lease-settle:recovery - a run that cannot settle its lease back to the drive record (write error, machine sleep or replacement) has no code, fix or reconcile path, and the journal that would reconcile it is machine-local | unverified | same location, agreement unverified (plan.md:188): CAP6:lease-settle:recovery - a run that cannot settle its lease back to the drive record (write error, machine sleep or replacement) has no code, fix or reconcile path, and the journal that would reconcile it is machine-local |
| autoplan-20261028004737-dx-r3-outside-6 CAP6:tokens export:fix | autoplan-20261028004737-dx-r3-native-18 tokens export drops the table's n<10 and older-than-30-days flags and leaves the token class and role-name mapping implicit | unverified | same location, agreement unverified (plan.md:310): tokens export drops the table's n<10 and older-than-30-days flags and leaves the token class and role-name mapping implicit |
| - | autoplan-20261028004737-dx-r3-native-1 The contract call as /write-skill issues it is refused twice (new E_LOOSE_GSTACK on the rendered folder the contract says to pass, then LOCK_MISSING), and the new 'preflight on gstack's committed tasks must pass unchanged' test cannot pass, so 'works as written' and 'move onto it without edits' are false | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-dx-r3-native-5 CAP6:ledger-init:fix - ledger init and raise write through gstack-approvals, which requires --ask, --words, --by and --scope and a git branch (lib/approval-record.ts:151, :73), while v3.1 dropped --approved-by and names no error when gstack-approvals is absent or refuses | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-dx-r3-native-8 Exit 2 now carries terminal refusals (E_LOOSE_GSTACK, E_INTERACTIVE_HOST, VACUOUS_CHECK, LOCK_MISSING) that the contract reads as INCOMPLETE, and no verdict.json is promised for them, so contract callers cannot tell a refusal from a resumable stop | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-dx-r3-native-9 Routing text committed into the fixture's CLAUDE.md is not scoped to Lane B; applied to Lane A it makes /learn's export check (test ! -e CLAUDE.md) fail in every gstack and placebo arm | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-dx-r3-native-10 The bundled two-task --example cannot reach the five-informative-task floor, so the default magical moment exits 2 NOT_MEASURABLE instead of showing a PASS (unchanged text) | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-dx-r3-native-11 VACUOUS_CHECK's way out is a sidecar mutant with no defined shape, and a negative-only safety task without one has no stated outcome | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-dx-r3-native-12 Question-category classification can only be checked in paid runs, and REPLY_MISALIGNED stays a warning even when arms received replies from different sources, which breaks the pairing the verdict assumes | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-dx-r3-native-13 The Phase 1 office-hours shakedown has no contract tasks.json or category-keyed tasks.ext.json in gstack (origin/main has skill-evals for learn and write-skill only), and no milestone writes them | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-dx-r3-native-14 SAFETY_BREAK with FLAKY_SAFETY exits 1 with no stated recovery and no rule for whether the post_hoc relock it implies can promote a diet | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-dx-r3-native-15 Baked images make the local host CLI irrelevant, yet doctor still checks it, and E_IMAGE_BUILD covers doctor only while arm layers are built per run | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-dx-r3-native-16 CAP6:replay-run:recovery - the rebuilt review replay runner 'exits nonzero' with no named code and no resume, and allows no retries, so a transport failure mid-run forces a paid rerun of items already recorded | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-dx-r3-native-17 The state-root rule exports GSTACK_HOME, the second link in gstack's chain; GSTACK_STATE_ROOT wins when present, and Capy's GSTACK_LAUNCH_FILE sets it | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-dx-r3-native-19 Command inventory drift: the bin list omits explain, tokens and init and the ledger subcommands, and Lane A's exit-2 list carries E_VERIFIER for Harbor, which Lane A does not use | native_only | not raised by the outside voice |
```

#### eng: closed 2026-10-28T15:02:30.046Z; snapshot 05dc4c6e050d4c788f5d70b74b66c7bcfa751582bcf1792d4fccaaf6112a24f1

- native completed (model anthropic/claude-opus-5-5, provider host-subagent, 24 findings, sha256 30020fd583d7)
- outside completed (model openai/gpt-6-astra, provider host-subagent, 6 findings, sha256 0353ea659dc8)

```
ENG DUAL VOICES - CONSENSUS TABLE:
  Severity        anthropic/claude-opus-5-5(native) openai/gpt-6-astra(host-subagent)
  Critical        0                            0
  High            5                            4
  Medium          12                           2
  Low             7                            0
  Informational   0                            0
  Findings        24                           6
CONFIRMED 0 · SAME LOCATION, UNVERIFIED 6 · DISAGREE 0 · NEW (outside only) 0 · native only 18. Both completed.

Reconciliation (each outside finding against the native result):
| outside | native | disposition | resolution |
|---|---|---|---|
| autoplan-20261028004737-eng-r3-outside-1 Authenticated trial credentials are serialized as meter IDs | autoplan-20261028004737-eng-r3-native-2 Grader import of 'changed files under the task's paths' has no paths source in contract tasks and drops /learn's git-excluded .gstack-home, breaking add and prune-stale in every arm and making prune-conflict a silent pass | unverified | same location, agreement unverified (plan.md:178): Grader import of 'changed files under the task's paths' has no paths source in contract tasks and drops /learn's git-excluded .gstack-home, breaking add and prune-stale in every arm and making prune-conflict a silent pass |
| autoplan-20261028004737-eng-r3-outside-2 Local leases have no specified atomic admission against the shared program cap | autoplan-20261028004737-eng-r3-native-4 Leases taken from one append-only Drive record have no atomic step across machines; Drive saves on completion with 24h history, so two runs can lease the same cap and a keyless two-host test cannot show it | unverified | same location, agreement unverified (plan.md:188): Leases taken from one append-only Drive record have no atomic step across machines; Drive saves on completion with 24h history, so two runs can lease the same cap and a keyless two-host test cannot show it |
| autoplan-20261028004737-eng-r3-outside-3 The verifier artifact boundary can discard ignored state and conceal a forbidden change | autoplan-20261028004737-eng-r3-native-23 --isolation process has no egress control now that egress is the Docker internal network | unverified | same location, agreement unverified (plan.md:175): --isolation process has no egress control now that egress is the Docker internal network |
| autoplan-20261028004737-eng-r3-outside-4 A fixed model roster does not make an old placebo valid for a new gstack tree | autoplan-20261028004737-eng-r3-native-12 The canary search job must search for raw GUIDs that exist only inside the runner-keyed sealed bundle, yet its credential is separate from the runner; plan.md:281 still lists canaries in the public manifest | unverified | same location, agreement unverified (plan.md:285): The canary search job must search for raw GUIDs that exist only inside the runner-keyed sealed bundle, yet its credential is separate from the runner; plan.md:281 still lists canaries in the public manifest |
| autoplan-20261028004737-eng-r3-outside-5 New allowance and slot errors turn arm-caused failures into incomplete runs | autoplan-20261028004737-eng-r3-native-8 MARGIN_NOT_ATTEMPTED is known only after the full paid matrix; at 12 tasks and 3 trials the detectable loss is about 13 to 18 points, so --margin 5 or 10 exits 2 after about $60 and v1's diet judge has no reachable exit 0 | unverified | same location, agreement unverified (plan.md:205): MARGIN_NOT_ATTEMPTED is known only after the full paid matrix; at 12 tasks and 3 trials the detectable loss is about 13 to 18 points, so --margin 5 or 10 exits 2 after about $60 and v1's diet judge has no reachable exit 0 |
| autoplan-20261028004737-eng-r3-outside-6 Parity sizing lacks the conversion from two-trial pilot variance to the five-by-three matrix | autoplan-20261028004737-eng-r3-native-14 The parity SD is measured on stratum-selected imports at 2 trials, not on the outcome-free minted build-fix set, and the formula adds variances to a spread | unverified | same location, agreement unverified (plan.md:352): The parity SD is measured on stratum-selected imports at 2 trials, not on the outcome-free minted build-fix set, and the formula adds variances to a spread |
| - | autoplan-20261028004737-eng-r3-native-1 v1.0 pilot rows (harness check, overhead probe, review probe, replay harness arms, rig shakeout: $360 of $500) need importers, placebo, OpenRouter route and simulator that only M2 (v1.1, 2026-12-16) builds | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-eng-r3-native-3 After the delta, nothing keeps the tasks directory (must/check answer key, scripted replies, mutants, hidden tasks) out of the agent container where setup runs | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-eng-r3-native-5 Counted runs execute in the second principal's sealed-repo workflow, which cannot reach the Capy Drive record holding the caps (no Drive API, not in the crew); no lease handoff, settle path or key home is named | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-eng-r3-native-6 Retries are said to have one owner, the proxy, but Claude Code retries up to 10 times and Codex 4 request plus 5 stream retries by default, resending after proxy failures and dropped streams | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-eng-r3-native-7 Lane A NOT_NONINFERIOR uses the percentile cluster-bootstrap nonInferiorityP (paired.ts:300-317), which passes too easily at 5 to 12 task clusters | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-eng-r3-native-9 The $90 Lane A shakedown line is below the plan's own Lane A prices: /learn alone is about $78 per round on three models before office-hours, calibration and the every-task second round | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-eng-r3-native-10 Phase 2a /review experiment ($150) and the $60 replay pilot are priced from GSTA-131's single-call API rates while three of four arms are agent sessions priced at $1 to $2 per Opus trial elsewhere in the plan | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-eng-r3-native-11 Reusing /eval-plan's pilot report while reserving in the program ledger fails: pilot start, settle and report run only on spend.json under its own lock (eval-plan/SKILL.md.tmpl:161-170) | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-eng-r3-native-13 Reusing none and placebo cells across up to four counted readings breaks 'arms launched together' and puts any provider or alias drift entirely on gstack's lift; rotation also changes the digest the release budget is keyed on | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-eng-r3-native-15 E_LOOSE_GSTACK refuses the contract's own call ('A gstack skill passes its rendered folder', SKILL_EVAL_CONTRACT.md:13), so 'works as written' is false for every gstack skill | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-eng-r3-native-16 The new preflight test on gstack's committed tasks cannot pass (gstack commits no tasks.lock.json), and the lock's reached-coverage needs paid old-arm runs that the committed lock must precede | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-eng-r3-native-17 Open PR #1 already adds keyless CI, AGENTS.md with the wiki rule and the interface v0.3 post, while the layout puts plans and reports under docs/ and omits wiki/ | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-eng-r3-native-18 The plan does not say where the Agent SDK host (canUseTool, simulator, replies) runs relative to the CLI's container; canUseTool needs permissionMode default | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-eng-r3-native-19 Simulator replies rely on temperature 0 and a fixed seed, which providers do not guarantee and which do not pair differently worded questions across arms | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-eng-r3-native-20 No ship policy in gstack-evals (default one PR per wave) and v1.0 implies about twelve PRs with no stated per-PR gate cost | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-eng-r3-native-21 Long Lane A runs on Capy end at the background operation's timeout mid-session, leaving paid unknown-outcome calls and missing cells | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-eng-r3-native-22 The M1a Harbor spike is labelled no API charges but its AskUserQuestion end-to-end check needs a model to call the tool | native_only | not raised by the outside voice |
| - | autoplan-20261028004737-eng-r3-native-24 The independent confirmation before acting on a single cell names no task set and no alpha accounting | native_only | not raised by the outside voice |
```

Reopened ceo at gate_rev 1: revise v1 (2026-10-28T06:37:46.458Z)
Reopened dx at gate_rev 1: revise v1 (2026-10-28T06:37:46.458Z)
Reopened eng at gate_rev 1: revise v1 (2026-10-28T06:37:46.458Z)
Reopened ceo at gate_rev 2: revise v2 (2026-10-28T13:59:57.972Z)
Reopened dx at gate_rev 2: revise v2 (2026-10-28T13:59:57.973Z)
Reopened eng at gate_rev 2: revise v2 (2026-10-28T13:59:57.973Z)

Budget: max_rounds 3.
Plan changed after the ceo cap (revise v3, round 3 of 3): +114 -77 lines unreviewed; accepted
Plan changed after the dx cap (revise v3, round 3 of 3): +114 -77 lines unreviewed; accepted
Plan changed after the eng cap (revise v3, round 3 of 3): +114 -77 lines unreviewed; accepted

Gate: gate_rev 4, 32 decisions (0 pending); answered "rec" answered by agent:GSTA-2. Findings: 72. Tasks: 28.
