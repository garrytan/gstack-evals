## Review record


### gstack-autoplan run log (run autoplan-20261102231443, session_kind unattended, status complete)

Host: gstack-autoplan. Scope: UI no (2 matches); DX no (68 term matches). Phase order: ceo → eng.
Deviation: autoplan guard: not enforced by this host; publication order is unverified (GUARD_NOT_INSTALLED)

#### ceo: closed 2026-11-02T23:32:21.285Z; snapshot 1da6ad7fafb4a0e6f37bfad2dda09ad6ade6936ee4ae0f963f87b25e40cae77b

- native completed (model anthropic/claude-opus-5-5, provider host-subagent, 16 findings, sha256 99a4277aac84)
- outside disabled

```
CEO DUAL VOICES — CONSENSUS TABLE:
  Severity        anthropic/claude-opus-5-5(native) outside: N/A
  Critical        0                            —
  High            6                            —
  Medium          8                            —
  Low             2                            —
  Informational   0                            —
  Findings        16                           —
Consensus: N/A (voice coverage: native only); confirmed counts require both voices.

Reconciliation (each outside finding against the native result):
| outside | native | disposition | resolution |
|---|---|---|---|
| — | autoplan-20261102231443-ceo-native-1 Section 8.2 misstates power.py: O1/O2 MDD@Holm4 at 60x3 is 13.8 to 16.3, past the 15-point margin, and the 48-task line is 15.4 to 18.7 | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-ceo-native-2 Admission MDD depends on an unfrozen power.py parameter: at the 40% planning rate H-inv admits at conc 2 (14.7) and is refused at conc 6 (16.2) | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-ceo-native-3 H-rev admission floor check (lower bound above 0 on 8 units x 2 passes) passes in about 5% of slices at the 7.1% planning rate, and a floor failure has no frozen path | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-ceo-native-4 Behavior family B1 to B4 has no admission, no saturation step, and an install check only at S11 = 0, so a ceiling at the before pin or a partial hook install becomes CUT-CANDIDATE | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-ceo-native-5 Probe R item 1 requires specialist reports that the before pin's /review skips by design under 50 changed lines (review-army.md L43 to L47), so B4 measures a size gate, not adherence | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-ceo-native-6 Held-out authors and auditors are called blind to gstack with no mechanism, while the user-scope AGENTS.md has every Capy session load gstack and use its workflows (GGST-6) | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-ceo-native-7 Outcome KEEP ignores exposure, so a gain with the skill rarely loaded is credited to the skill | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-ceo-native-8 Pause line counts only ledger items while R42 counts thread model use, machines and VMs; smokes, review hosts, authoring and audit have no spend line | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-ceo-native-9 Sealed H-inv bodies would reach OpenRouter providers: no data_collection deny under quick/laneb on main, unlike the rig's proxy (prices.ts L74 to L75) | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-ceo-native-10 Section 16 omits Claude Code's proprietary licence and gateway use with Sol and particle-1, gstack's bundled third-party components, and a rule for particle-1's terms | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-ceo-native-11 Fresh gstack state per session is not frozen; learnings, review logs and specialist gating could carry across held-out units and passes in gstack arms only | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-ceo-native-12 Headless AskUserQuestion handling is not frozen, though the before pin's /investigate guards call it | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-ceo-native-13 Section 8.3 lets an amendment drop a family's endpoints, which section 12 forbids | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-ceo-native-14 Custody rests on a who-must-not list with no check that GST-1088 build threads cannot mount the bundle or key drives | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-ceo-native-15 price.py's unsourced rates are unlabeled and h-pilot's $45 is under the script's own rates (about $53 before judging) | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-ceo-native-16 The public minus held-out effect gap, a direct tuning check, is not named | native_only | not raised by the outside voice |
```

#### design: skipped (docs-only plan)

#### dx: skipped (docs-only plan)

#### eng: closed 2026-11-02T23:36:32.532Z; snapshot 1da6ad7fafb4a0e6f37bfad2dda09ad6ade6936ee4ae0f963f87b25e40cae77b

- native completed (model anthropic/claude-opus-5-5, provider host-subagent, 13 findings, sha256 e089bbc8f4c5)
- outside disabled

```
ENG DUAL VOICES — CONSENSUS TABLE:
  Severity        anthropic/claude-opus-5-5(native) outside: N/A
  Critical        0                            —
  High            5                            —
  Medium          7                            —
  Low             1                            —
  Informational   0                            —
  Findings        13                           —
Consensus: N/A (voice coverage: native only); confirmed counts require both voices.

Reconciliation (each outside finding against the native result):
| outside | native | disposition | resolution |
|---|---|---|---|
| — | autoplan-20261102231443-eng-native-1 Ledger binding contradicts the plan's own repairs: E_ITEM_BOUND on a second run, yet smokes, named relaunches, pause-resume and review pass 2 all charge the same item | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-eng-native-2 No build unit installs the review-units arms: B1 builds setup-installed, hook-carrying and hooks-off layers for Lane B only, but H-rev and P4 run before-u/t, after-u/t and off-u/t in review-units | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-eng-native-3 B2 ports rule B only if the stub test fails, but section 3 and table 7.5 need session_end.cause, deadline gaps and background_at_first_result from every Lane B trial | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-eng-native-4 The kappa rule (attack 4) misfires at floor prevalence: with 20 sessions per cell and a probe rate near 0 or 100%, kappa is undefined or near 0 even at near-perfect agreement, so B endpoints flip to FIX-METHOD by artifact | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-eng-native-5 No build unit delivers the pause check: settled plus reserved must be summed across the rig ledger, Lane B's per-item ledger files, judge items and VM reservations per thread, and T-hrev's caps ($5,980) rely on it to stay under $5,000 | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-eng-native-6 The per-session outcome table that B5 consumes has no owner or schema: nothing maps sdk-messages.jsonl, arm.json, reader records and judge outputs to one table with coverage-gap class, contamination, cap-stop, repair and cost fields | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-eng-native-7 Recall pairing is undefined when a unit has one pass graded in one arm and two in the other; the weighted sign-flip and the ratio-of-sums bootstrap then test different statistics | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-eng-native-8 No rule for a judge call that fails, refuses or returns unparsable output, though matching and adjudication decide recall and the guard | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-eng-native-9 Hook firing is the central mechanism, but the dry run and B1's test use stub CLIs, which do not execute settings.json hooks the way the real CLI does | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-eng-native-10 Review-units arm order and run topology are not frozen: only Lane B is shuffled, about 1,224 H-rev sessions cannot finish on one day or inside one 6-hour background operation, and an arm-sequential order confounds arms with provider drift | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-eng-native-11 Custody on VMs and disk is not fully specified: hidden tests and oracle fixes must be absent from the agent-visible container, and plaintext transcripts on disk survive a machine death before re-encryption | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-eng-native-12 Judging is pinned at rig 715f837 while sealed judge keys come through review-units' later --sealed-root path; whether that rig reads keys from a sealed root is not shown | native_only | not raised by the outside voice |
| — | autoplan-20261102231443-eng-native-13 Probe I's command lists are not anchored (cd ... && pytest, env prefixes, subshells) and edits made by an Agent subagent may not appear in the parent transcript | native_only | not raised by the outside voice |
```

Budget: max_rounds 1.
Plan changed after the ceo cap (revise v1, round 1 of 1): +108 -83 lines unreviewed; accepted
Plan changed after the eng cap (revise v1, round 1 of 1): +108 -83 lines unreviewed; accepted

Gate: gate_rev 2, 26 decisions (0 pending); answered "rec" answered by agent:GEVA-214. Findings: 29. Tasks: 11.
