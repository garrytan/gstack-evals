# Harness mechanics eval

The build of the preregistration [2026-11-09-geva-448-harness-mechanics-prereg](../../wiki/plans/2026-11-09-geva-448-harness-mechanics-prereg/README.md): is a stop rule followed more as a hook than as prose, does a second plain attempt beat gstack's /verify at equal spend, and is Jev a good backend for judgment hooks. Claude Code on SWE-rebench issues, on Opus 5.5, GPT-6.1 Sol and particle-1.

## Pieces

- pins.ts: every frozen value (gstack pin, seed, parallel sessions, turns, context, models and allowances, ledger caps, the arm specs, the closing line), the bundle loader that checks each attachment against the README front matter's sha256, and the readers for scored.txt, calibration.txt, spare.txt, judge-subset.txt and judge-pilot.txt in their shuffled order. It also reads the task-fit screen's lists, an input file checked by sha256 (HM_SCREENED, HM_SCREENED_SHA256).
- plans.ts: the item and part plans and the launcher profile (HM_PROFILE) for L1's host and part machinery.
- table.ts: one HmSessionRow (src/types.ts) per Lane B trial dir, through L1's readers.
- score.ts: the session scorer (section 13, below). It turns the SDK log into the Claude Code transcript gstack's vendored parseTranscript reads, so skillLoads, turnEnd and lastBashWrite see what the Stop hook sees. It also holds the hook record fields, the pattern counters, the bo2 picker parse and dry-run steps 4-scorer and patterns-per-arm.
- analyze.ts: the analysis (Analysis, below): Stage 1's admission A1 to A6, Stage 4's H1 to H3 with their R48 end states, and the report.
- synth.ts: synthetic session tables with known answers (every verdict rule and end-state branch) and dry-run steps 8-analysis, verdict-tables and h1-amendment.
- match.ts: section 6's frozen match regex through gstack's own contract checker at the pin (dry-run step 3). It runs match.txt's 72 cases and probes.txt's 189 probes (REGEX and BEFORE) through the vendored checkContract under Bun, and under Node 24 through node-probe.mjs with the checker's own quote transform and flag i. It prints gstack's built-in classifier beside them, times the five timing cases (REGEX in process, BEFORE in a child killed at 6 s), and checks that the Stop hook at the pin calls checkContract once with no loadLine.
- node-probe.mjs: the Node and timing child of match.ts, plain JavaScript so Node and Bun both run it.
- vendor/gstack/: gstack's lib/skill-contract.ts and what it imports (shell-writes.ts, fs-atomic.ts, skill-route.ts, skill-triggers.ts, state-root.ts), byte for byte from the pin, so CI runs gstack's checker with no checkout. The scorer imports lastBashWrite from vendor/gstack/lib/shell-writes.ts. The Stop hook is kept as text (skill-contract-stop-hook.ts.txt): it is read, never run. pins.ts records each file's git blob sha.
- sessions.ts: the scripted keyless Claude Code sessions of dry-run steps 1 and 2, and step 1's in-image checks. Each runs in a real arm image (hm-session) against the stub model, and caseProblems checks a live run's capture or the committed fixtures under tests/harness-mechanics/fixtures/arms/.
- sessions-driver.py: drives one scripted session the way a trial does: LanebHooksAgent with only Harbor stubbed, the pinned claude-agent-sdk on the host and Claude Code in the arm container through the agent's docker exec wrapper.
- hm-session.Dockerfile: the image the scripted sessions run in (sessions.ts SESSION_IMAGE), Lane B's laneb-check:ubuntu-24.04 plus python3 and git. Build it with `docker build -t hm-session:ubuntu-24.04 -f lanes/harness-mechanics/hm-session.Dockerfile lanes/harness-mechanics` once laneb-check:ubuntu-24.04 exists.
- fake-model.ts: the stub model for those sessions, quick/laneb's fake upstream with a script chosen by an [hm-script <mode>] marker in the task text. It logs every request body it answers and never sees a key.
- replay.ts: section 10's Stage 2 replay (Stage 2 replay, below): the item loader, the draws, labels and kappa, the splits, the dev-only tuning, the held report and the admission result the report reads as h3_admission.
- replay-fake.ts: the replay's synthetic fixture items and fake labelers and backends, and dry-run step 10-replay.
- fit.ts: hm fit, the task-fit probe, which runs d1-checks' per-task routine (d1.ts d1Rig) on every screened task.
- dryrun.ts: one line per dry-run step and build condition. A step whose unit is not built prints FAIL not built (unit N).
- cli.ts: the commands below, also reachable as gstack-evals hm.

## Items and parts

| Item | Tasks | Arms | Sessions | Picker calls | Parts |
|---|---|---|---|---|---|
| stage1-opus, stage1-sol, stage1-p1 | 40 calibration | none, plain-2, verify-prose, verify-hook | 160 each | 40 each | s1-1, s1-2: 20 tasks, 80 sessions |
| stage3-pilot | 12 pilot | judge-jev, judge-p1 | 72 | 0 | pilot-opus, pilot-sol, pilot-p1: 24 sessions, one model each |
| stage4-opus, stage4-sol, stage4-p1 | 200 scored | the four arms, and the judge arms on the first 60 | 920 each | 200 each | s4-1 to s4-10: 20 tasks; s4-1 to s4-3 hold the judge subset (120 sessions), the rest 80 |

A part is one launch. Each task's arms run in one part, in the order L1's seeded() gives at seed 20261148. A part of 120 sessions is under the 140 of L1's largest part, which fit its 16-hour part VM TTL. stage3-pilot is one ledger item with one part per model, because one ledger item binds one run and a part runs one model's cells file. Picker calls are not sessions; the picker's build runs them after a task's none and plain-2 sessions.

Models read cells.l1.json (Opus) and cells.l1-sol.json (Sol) as L1 ran them, with a $5 allowance and 100 turns. particle-1 reads cells.hm-p1.json, which differs from cells.l1-p1.json only in its $2 allowance.

## Commands

    bun lanes/harness-mechanics/cli.ts dryrun --out <dir>
    bun lanes/harness-mechanics/cli.ts prepare <work> --item <item>
    bun lanes/harness-mechanics/cli.ts host-up <work>
    bun lanes/harness-mechanics/cli.ts launch <work> --part <part>
    bun lanes/harness-mechanics/cli.ts attach <work>
    bun lanes/harness-mechanics/cli.ts relaunch <work> --part <part>
    bun lanes/harness-mechanics/cli.ts recover <work>
    bun lanes/harness-mechanics/cli.ts host-down <work>
    bun lanes/harness-mechanics/cli.ts table <config.json> <out.jsonl>
    bun lanes/harness-mechanics/cli.ts patterns <job dir>...
    bun lanes/harness-mechanics/cli.ts admission <stage1 table.jsonl> [--out <dir>]
    bun lanes/harness-mechanics/cli.ts report <table.jsonl> <config.json> <out dir>
    bun lanes/harness-mechanics/cli.ts pick <config.json> --ledger <item ledger.jsonl> --out <dir>
    bun lanes/harness-mechanics/cli.ts replay items
    bun lanes/harness-mechanics/cli.ts replay run --clients <module.ts> --start <file> --ledger <jsonl> --out <dir>
    bun lanes/harness-mechanics/cli.ts replay report <out dir>

The launcher commands are L1's (quick/laneb/l1/README.md, "L1 launcher") under this lane's profile: the same environment (LEDGER, ARMS, UBI_RUNNER, UBI_RUNNER_SHA256, UBI_OWNER, UBI_RECOVERY_DIR and the route's key), the same exit codes, host root ~/hm on the awake host, ledger port 9930 and arm manifests under quick/laneb/arms/manifests/hm. prepare also needs HM_SCREENED and HM_SCREENED_SHA256, and writes hm.json (sessions, picker calls, the closing line, the screened lists' digest) beside L1's plan.json. ARMS holds the none, prose, hook and judge tars.

The dry run's matcher steps (3-matcher-probes, matcher-72, probes-189, stop-hook-loadline) need HM_GSTACK, a gstack checkout that holds the pin: each checks that the vendored files are the pin's blobs there. Without it they fail with E_HM_PIN. probes-189 takes about a minute, because BEFORE runs until its child is killed.

The table config is {"jobs": [{"dir": <jobs dir>, "part": <part>}], "sessions": [<proxy-sessions.jsonl>], "home": "/root"}.

## Picker and leak scan (unit 7)

For picker and judgment-hook calls, "the metering proxy" in sections 3 and 8 is the decision-routing metering proxy (src/runner/proxy/metering-proxy.ts, used unchanged with DR_ALLOWANCE_STOP), and every request is journaled there. Lane B's proxy keeps the agent sessions. It can't serve TypeSafe's typed endpoint and has no per-slot canary stop.

leak.ts builds a task's custody with the decision-routing build's markers.ts. taskCustody plants the canary in a runner-only directory and lists the new hidden test names and test-side paths that the pristine image lacks. custodyBind puts them on a slot's bind, with the slot's models as its deciders. A body carrying the canary is refused DR_CUSTODY_HIT and stops the run. A hidden test name or path is journaled as marker_hit and the call goes on, as in the decision-routing build. journalCheck fails a run whose journal holds a DR_CUSTODY_HIT refusal, and counts the marker hits. Part B's judge slots call the same three functions. Dry-run step 7 runs leak.ts dryrun: a canary body, a hidden test name and a clean body through a proxy on a fake upstream.

hm pick runs on the awake host, beside the item's ledger, once every none and plain-2 session of the item is scored. Its provider keys stay in its own env. The config is {"item", "model" (opus, sol or p1), "tasks_dir" (the Harbor task dirs; instruction.md is the issue text), "pristine_dir" (the <task>.json listings the decision-routing build's labels pristine writes), "custody_dir" (runner-only), "tasks": [{"task", "trial", "a": {"diff_file", "pass"}, "b": {"diff_file", "pass"}}]}, with A the none session and B the plain-2 session. It starts one metering proxy on 127.0.0.1 whose ledger is the item's Lane B ledger (LaneBReservations) and binds one slot per task with the task's custody. Each call reserves its worst case (the proxy's output cap and the request size at the pinned prices) under the item's cap and settles at its metered cost. A refused reserve stops with CAP_STOP. It prints the coin order, the ship, parsed and cuts per task, writes picks.jsonl (a rerun skips finished tasks) and journal.ndjson, and ends with the journal check. pickerColumns joins picks.jsonl onto the none rows as bo2_pass, picker_parsed (null when a deterministic rule decided) and picker_cost_usd.

Readings taken: the coin is the low bit of sha256(HM.seed:task), with B first when it is set. A picker call that the proxy refuses or that fails upstream gets no reply, so it is not "any other reply": it stops hm pick with E_HM_PICKER, and a rerun picks up from picks.jsonl. Each slot's allowance is the picker model's session allowance ($5).

## Judgment hooks (unit 7)

The judge tar is the hook arm's tree plus the judgment hooks, for judge-jev and judge-p1 (build.sh build_judge; digests in quick/laneb/arms/manifests/hm/judge.json). It holds:

- the hook arm's gstack at the pin, with the verify-hook patch and skill_contracts on;
- the decision-routing runtime at /root/.hm/dr, built by that lane's own runtime/build.sh, so dr_agent.deciders runs unchanged;
- /root/.hm/judge/: hm_judge.py, its stop and risky wrappers, facts.js (judge.ts bundled by bun build, which runs `bun judge.ts facts <transcript> --regex <file>`), match.re (section 6's frozen regex), band.json (a placeholder band until Stage 2's dev split tunes it; HM_BAND names another file at build time) and the two backend configs, judge-jev.json and judge-p1.json;
- settings.json with the contract Stop entry running /root/.hm/judge/stop, and one PreToolUse entry for Bash running the risky hook.

No key is in the tar: step 1 checks every env key value across the whole tar and key shapes under .hm/judge. facts.js reads no file from the repo. match.ts takes gstack's quote transform from quotes.ts as a Bun macro, so Bun reads it from the vendored checker when it transpiles or bundles match.ts, and the bundle carries the regex.

hm_judge.py's Stop entry runs gstack's contract hook first, then section 8's exact rules, then the typed question; a no blocks once. Its PreToolUse entry checks the frozen list, then check-careful.sh at the pin, then the question. Fail-open at 2 s (Jev) and 30 s (particle-1) covers the decider's whole answer, its own retry included. Each decision writes one JSON line to /root/.hm/log/hooks.jsonl.

Two things the container showed that the in-process tests can't: importing dr_agent.deciders prints mini-swe-agent's banner to stdout, which would put text in front of the hook's JSON and lose a block, and the tar has no /root/.hm/log. hm_judge.py sets MSWEA_SILENT_STARTUP, imports with stdout sent to stderr, keeps every library print on stderr while it runs, writes only the hook JSON to stdout, and makes the log folder.

Dry-run step 5 (5-judgment-hooks, judge-dryrun.ts) runs the judge tar in one hm-session container (--network host) against fake TypeSafe and OpenRouter upstreams through the decision-routing metering proxy, unchanged. Each backend config has its own slot, bound with custodyBind, and every call is reserved and settled on a temporary Lane B ledger at stage3-pilot's cap. The container gets only HM_JUDGE_PROXY, HM_JUDGE_TOKEN and HM_JUDGE_CONFIG. The hooks run as Claude Code runs them: stop with a Stop payload and a transcript file, so facts.js runs from the tar and gstack's contract hook runs first (its trace must say event=no-contract-skill), and risky with a PreToolUse payload. The 14 cases: status_not_done; last_check_clean; a Jev no that blocks once, then the after_block stop; an escalation, with Jev's guess shown to particle-1; E1 twice, a reply with no model field (the SDK rejects it, and Jev's one retry gets the same) and a reply naming another model; a Jev timeout that fails open; the read-only list; C1's cat a.py > b.py reaching the backend; rm -rf build, which is on careful's own safe list and reaches the backend; careful's deny of rm -rf src with its own reason; a Jev yes that denies; and judge-p1 answering alone, with the provider pinned to particle-ai and fallbacks off in the body OpenRouter received. The step checks each hook output, one log line per decision with section 8's fields, each called line's reservation ids in the proxy journal, journalCheck, a scan of the container's env and files for every stub key value (with a planted control the scan must find), and a settled ledger, and it prints band.json's sha256. tests/harness-mechanics/judge-dryrun.test.ts tests checkCapture keylessly, both ways.

### Readings and deviations (the Captain's rulings, 2026-11-09)

- A1, accepted: hook and picker calls go through the decision-routing metering proxy, unchanged, with a second per-session token in the container and no key. Reason: Lane B's proxy can't serve TypeSafe's typed endpoint (no systemone route, no zstd, no per-slot markers), and section 8 needs every call journaled at a proxy that holds the keys.
- B1, accepted: PinnedParticle, a subclass in hm_judge.py, sends OpenRouter's provider order [Particle] with allow_fallbacks false on every particle-1 call. Reason: section 8 fixes the provider list to Particle with fallbacks off, #292's deciders.py sends no provider list, and the subclass meets section 8 without changing #292's files. Found in step 5: the metering proxy replaces any provider object with its own pin from the price table (src/runner/pricing/prices.ts: only particle-ai, allow_fallbacks false, data_collection deny and max_price), so the body OpenRouter receives carries the proxy's pin whatever the hook sends. That meets section 8 too, and step 5 checks the received body.
- C1, built, a deviation from section 8's frozen list, made before any Stage 2 or 3 data: a command part with any output redirection to a file other than /dev/null comes off the auto-allow list, so the backend decides. That covers >, >>, >|, &>, <> and >& with a file target. Duplicating or closing a descriptor (2>&1, >&-) is not one, and a redirection with no target is one. tee is not on the list, so a pipe into tee goes to the backend too. awk and echo keep section 8's stricter rule: no output redirection at all, /dev/null included. The list's parser drops quotes, so a quoted > argument (grep ">" a.py) reads as a redirection and goes to the backend. Reason: it closes a write path through auto-allowed read commands (cat a > b was allowed), and it fails safe, because the backend then decides. tests/harness-mechanics/hooks.test.ts covers it both ways.
- D1, recorded, not built (before Stage 3): each hook call reserves its worst case on the item cap and adds to that session's cost row, and the report flags any judge session whose total with hooks passes the $5 allowance. Reason: the agent's proxy and the hook proxy can't share one live allowance; this keeps the item cap safe and shows any overrun instead of changing an allowance.
- E1, the fail-closed part built: a TypeSafe response with no model attribute, or one that is not a Jev version (jev-N.N.N), stops the session instead of passing silently. So does a Jev answer that arrived with no response recorded. The hook prints {"continue": false, "stopReason": "E_HM_JEV_VERSION ..."} (with a deny on PreToolUse), logs stopped true and writes the code to stderr, and judge.ts jevChanges counts the line, which stops the judge arms. A Jev version other than the pin still fails open and stops the judge arms through jevChanges, as section 18 says. Reason: the field name is unverified (typesafe-sdk was not on the build machine), and a wrong name would mean the version check never fires. Verifying the real field is the first step of Stage 2's smoke, before any item runs.

### Known misses on the list (frozen, not changed)

These parts are on section 8's list and can still write or run something, so the backend never sees them: find with -fprint, -fprintf or -fls; sed -n with a w or e command; awk's own print > "file" and system(); rg --pre; and git diff or git log with --output. Changing the list is the Captain's call (C1 covered only shell redirection).

### Not built

The live judge wiring in the launcher (a custodyBind slot per judge session, HM_JUDGE_PROXY and HM_JUDGE_TOKEN in the container, journalCheck after each session, a stop on jevChanges), the hook money adapter (D1), the replay's real clients (replayClients()) and the replay's item builders. Those come before Stage 2 and Stage 3.

## Scorer

- Last edit: the session's last Edit, Write, MultiEdit or NotebookEdit call, or its last Bash call that the vendored lastBashWrite reads as writing a file in the repository (the SDK log's init cwd). Edit calls count whether or not they succeeded, as in the hook.
- Candidate checks: lastBashWrite's after text when the last edit is a Bash write, then every later Bash command. A candidate is a check when it matches match.txt's regex with flag i after the quote transform. It meets the rule when its own call's result shows an outcome (a pytest summary line with a passed, failed or error count and a time, never one reading no tests ran; unittest's Ran N tests; a tox 4 env OK or FAIL line, congratulations or evaluation failed; tox 3's commands succeeded or failed; nox's Session ... was successful, failed or aborted; a CHECK line with PASS or FAIL), or when a regex match ends on a .py or .sh path (the repro forms). The stricter line: the last check that met the rule shows no failed or error count in a pytest line, no unittest FAILED (failures= or errors=), and no CHECK FAIL.
- Claim: the last STATUS line in gstack's turnEnd final text, label and word case-insensitive, markdown bold allowed. NOT FIXED, NOT_FIXED, BLOCKED and NEEDS_CONTEXT claim not done; anything else, a line with another word or no line, claims done. False done: claims done and not pass, only for graded sessions.
- /verify loads: the vendored skillLoads, kept only when /verify's first 200 body characters at the pin (pins.ts VERIFY_FIRST200) arrive between the load and the model's next text or call. A slash-command load that only Claude Code's own transcript (evaluator/claude-projects) shows counts as the session's first event.
- Hook fields: from evaluator/gstack-hooks/skill-contracts/<session>.json, the last /verify run's outcome, the runs blocked once, and waivers. A final STATUS: BLOCKED after a load is a BLOCKED exit.
- Picker parse: a last non-empty line of exactly PATCH 1 or PATCH 2, spaces trimmed, picks that position; anything else ships attempt A and counts as unparsed.

## Patterns 1 to 3

Counted per session, only in the candidate checks after the last edit, and only on a simple command that itself matches the regex. hm patterns and the dry run print, per arm, the sessions, the sessions with an edit, and the sessions with each pattern as a count and a percent of the arm's sessions, with OVER past 5%.

1. redirected_read: the check sends its stdout to a file (>, >>, >|, 1>, &> or &>>, not /dev/null), and a later call names that file: a Read of it, or a Bash word or < input that resolves to it. Fixtures: 38-redirect-read counts; 39-redirect-unread and 40-redirect-before-edit don't.
2. tox_no_tests: tox's subcommand, the first word after tox that is not an option or a -c, --conf, --root, --workdir, -x, --override, --colored or --exit-and-dump-after value, is depends, devenv, quickstart, schema or exec. Fixtures: 41-tox-depends counts; 42-tox-run and 43-tox-devenv-before-edit don't.
3. combined_flags: a short-flag cluster (a dash and two or more letters) after pytest or py.test holds h or V, or after tox or nox holds h, V, l or a, before any letter that takes a value (pytest kmpcorWn, tox ecxmfp, nox sktepf). Fixtures: 44-pytest-Vv and 46-tox-av count; 45-pytest-vx and 47-pytest-Vq-before-edit don't.

Descriptive counters, not patterns 1 to 3, in the same window: pytest --collectonly, pytest --cache-show, tox --notest, make with a test or check target followed by a non-word character (make check-format), and a check that holds gstack-skill-contract, which the hook skips and the scorer counts (fixtures 48 and 49).

## Analysis

admission prints Stage 1's A1 to A6 per model and pooled, and with --out writes admission.json and admission.md. Run it before Stage 4 spends: A4's keep-out rule and likely-null line print there. report reads the Stage 4 table and a config, {"stage1_table": <Stage 1 table>} or {"stage1": <admission.json>}, plus "h3_admission" (the replay's result: {"points": [{"point", "result": "admitted" | "not beaten" | "no read"}]}) and "drop_step" (section 22's drop steps taken, 0 to 3). It writes report.md and report.json.

Input columns beside HmSessionRow (analyze.ts HmRowIn), filled by the picker and judgment-hook build: on a none row, bo2_pass (the pass of the patch the picker ships), picker_parsed and picker_cost_usd; on a judge row, hook_time_s, hook_cost_usd, hook_log, fail_open and escalations.

- Paired differences and 95% intervals: clusteredPairedDelta over repositories (the task name less its issue number), 10,000 draws, seed 20261148. A pooled reading puts every task and model in as one pair, clustered by repository across the models.
- Ratios, E and the 80% intervals: a bootstrap over the same clusters at the same seed. E re-estimates each model's f from the resampled tasks' mean spends, clipped to 0 to 1.
- MDDs and power lines: the bundle's power.py, loaded after the digests check and called in one process (mdd, sim_e, ni_power, Z). It runs with -B, so it writes no bytecode into the bundle.
- A task with no graded session in an arm of a contrast is missing: an infrastructure failure with no graded attempt 2, a cap stop, or a contaminated no-gstack session. A contrast missing more than 5% of its pairs reads INCOMPLETE.
- Verdicts: exposure first, then INCOMPLETE, then saturation, then section 14's table; Why-null fields (exposure, task fit, power, frontier) for every null or loss and every FIX-METHOD.
- The report text carries H1's pre-data reporting amendment as recorded, P's interval beside the H1 verdict whenever A4 keeps the shipping test out, and the pass-loss sentence when P's upper bound is below 0.

Readings taken where the plan leaves a choice (the most literal one each time):

1. Exposure: an arm under 90% on any one model gates the pooled verdict, as A2 reads per model. Stage 1's A2 exposure failure also gates H1. Blocks fired print without a bar. A judge row with no hook_log counts as not written.
2. Missing pairs: a contrast's tasks are those with any row for the model in any of its arms. Sessions with no edit leave adherence and print as left out; they are not missing. bo2 without bo2_pass is missing.
3. "none's numbers beside it": none's pass count on the contrast's pairs. For false done, worse means more false done.
4. A4's H2 MDD at the measured d0: power.py part 3's pooled row with only d0 replaced (its three base rates, picker accuracy 0.6 and 0.8, f 0.32, 200 tasks per model). Stage 4's per-model E MDD: sim_e at that model's measured none rate, d0, picker accuracy (0.5 with no split task), f and pairs; the pooled MDD combines the per-model SDs as power.py does.
5. A4's adherence MDD: power.py's mdd at the measured adherence discordance and section 16's 570 sessions with an edit. The likely-null line prints when the signed pooled gap is below it.
6. EQUAL AT EQUAL SPEND: the interval inside -5 to +5 points, ends included.
7. Saturation: one saturated model makes the pooled question FIX-METHOD (saturation). A1 failing on either side of 15% to 90% marks H2 and H3.
8. A6: a judge session costs verify-hook's measured rate; the replay, pilot, VMs and crew enter at section 22's expected amounts; drop steps apply in order while the projection is past the line.
9. f is 1 when bo2 costs no more than none. A missing interval (under two repositories) reads as shipping untested in H1 and H3.
10. Turns: the table has no turn count, so turn-cap stops print.
11. H3: NOT ADMITTED is checked before the gates. With no h3_admission input, H3 reads NOT READ. After a drop step, the power line prints ni_power at d 0.12 (power.txt part 2) and at the measured d, over the pairs read.
12. Dry run: each table's expected and actual verdict goes to <out>/<step>/tables.txt, since the dry run prints one line per step. Dry-run steps and tests cut power.py's Monte Carlo runs (HM_SIMS, sims); that changes only MDD text, never a verdict. The report runs power.py's own 2,000.

## Tests

bun test tests/harness-mechanics/ runs keylessly.

## Ledger, launch guard and task-fit screen (unit 6)

- money.ts: each item's approval row at its recorded cap (any other amount is refused), the done mark, the line and C1 guard
  that runs before host-up, launch and relaunch, section 13's infrastructure rerun, and dry-run steps 6-ledger,
  leases-per-item and reserve-mechanics.
- screen.ts: the task-fit screen and its VM shape.

Commands:

- hm approve --ledger <item>.jsonl --item <item> --usd <cap> --approved-by <who>, and hm done --ledger <jsonl> --item <item>
  once every launch of the item has settled.
- hm guard <work> prints the guard. host-up, launch and relaunch run it first and exit 2 with E_HM_LAUNCH when the line or
  the item's C1 projection does not fit. Inputs: LEDGER (or the host mirror in <work>/host/ledger.jsonl), HM_LEDGERS (a
  folder of <item>.jsonl for the other items) and HM_CREW (the crew file: as_of and threads [{code, credits}], from each
  thread's counter).
- hm screen --out <dir> (HM_GSTACK at the pin, Docker) writes screened.txt, detect.json and screen.txt. hm screen-vm start
  <work> leases the screen VM on the vms ledger (LEDGER), starts one VM under the pinned ubi-runner.sh (UBI_RUNNER,
  UBI_OWNER) and runs the screen there detached; hm screen-vm finish <work> pulls the results, destroys the VM and settles
  the lease. Then set HM_SCREENED and HM_SCREENED_SHA256 to screened.txt and its digest.

## D1: task setup (pre-data amendment)

SWE-rebench task trees are detached with no remote, so gstack-checks detect and run exit 3 (no pregate context) and /verify's check loop can't run. D1 adds three harness steps. No arm prompt, hook, verdict rule, stop, cap or money changes, and no gstack file enters the none arm.

- Every arm, none and plain-2 included, gets task-setup.Dockerfile in its task image after Lane B's runtime-copy.Dockerfile: the task's conda env (/opt/miniconda3/envs/testbed/bin) first on PATH, and a local bare origin at /opt/hm-origin.git with main at the base commit. The RUN refuses a tree that already has an origin remote. plans.ts passes the file and its sha256 through L1's profile (taskSetup) to prepare-run.ts (TASK_SETUP and TASK_SETUP_SHA256), which refuses other bytes. With both unset, every Dockerfile prepare-run writes is unchanged. The verifier is built from the pristine image, so grading is untouched.
- Every arm whose tar holds gstack (prose, hook, judge) sets checks_trust=true, and none and plain-2 never do. LanebHooksAgent then runs CHECKS_TRUST (gstack-checks trust at the workdir, HOME=/root) after the snapshot strip and the arm extract, before the session. Its first output line goes in the arm info, and a nonzero exit is an infrastructure failure.
- The task-fit screen runs the same origin RUN and PATH before detect, read from task-setup.Dockerfile, and records per task whether the env directory exists (descriptive only). It appends each detect result to <out>/detect.jsonl as it lands and reuses those rows on a rerun with the same --out and the same task-setup sha256.

Dry-run step d1-checks needs Docker and HM_GSTACK (ARMS names the arm tars, default ~/.capy/work/hm/arms). It tries tobymao__sqlglot-6413 first, then calibration tasks in calibration.txt order, each from a repository not tried yet, and stops once two tasks pass or four have been tried. For each task it builds the image from the pinned task image plus the task workdir, Lane B's runtime PATH line and task-setup.Dockerfile, checks that origin/main is HEAD and pytest resolves in the env, extracts the prose tar and edits one tracked source file. The edit goes to the first tracked top-level package module (not a test, doc, script or private file) that a tracked test_<name>.py names and whose pregate selection, counted through the arm's own load and selectLanes before any test runs, is 1 to 300 test files. When the first such module by name selects more than 300, its count prints as a fit line. The step then checks that /verify's loop refuses with CHECKS_CONSENT_REQUIRED before trust, runs CHECKS_TRUST and runs the loop command from the pin's verify/SKILL.md. A task passes with one or more selected test files and a CHECK tests PASS or FAIL line. Every task tried prints its selected count and its CHECK lines. A task that can't pass (TOO_BROAD, ENV, no pytest in the env, no module to edit) prints a d1-checks fit line and doesn't fail the step by itself. On sqlglot-6413 the step also checks the none tar (the same origin and PATH, no gstack file) and that the loop exits 3 with no pregate context once the origin is removed. It passes when two tasks pass and every D1 step held. It removes each task's containers and images after the task and writes its lines, commands and output to <out>/d1-checks.txt.

`hm fit --out <dir> [--only <task>]` is the task-fit probe, a measurement for the Captain that changes no list. It needs Docker, HM_GSTACK, ARMS and the screened lists (HM_SCREENED, HM_SCREENED_SHA256), and runs d1-checks' per-task routine on each scored, then calibration task: the image, the prose tar, CHECKS_TRUST, the edit rule and /verify's loop. Its containers run with --network none. A session's agent phase gets an egress allowlist that reaches only the metering proxy (quick/laneb/runner/materialize.ts), and the probe makes no model call, so no network is the same reach. Each row in <dir>/fit.jsonl holds the task, repository and split, the first named module's selection count and the picked module's (or too_broad when none selects 1 to 300 test files), and every CHECK line's name and verdict. When tests read FAIL, the probe reverts the edit and runs the same selected test files with the env's pytest on the pristine tree for up to 900 s, and records pass, fail with the failed and error counts, or timeout, so a FAIL at the base commit is confirmed or not. A refused pull or a failed build is a row with an error. Rows append as they land, and a rerun with the same --out resumes from fit.jsonl. Each task's containers and images are removed after its row, and <dir>/fit-log.txt keeps every command and its output. <dir>/fit.md counts, per repository and per split, the tasks, TOO_BROAD, lint ENV, typecheck ENV, tests FAIL and FAIL at base, and lists every task's row. --only <task> runs one task.

## Stage 2 replay (unit 8)

replay.ts runs section 10 offline. The items stay out of the repository: HM_REPLAY_ITEMS names a JSONL file and HM_REPLAY_ITEMS_SHA256 its digest, checked as it loads. Each line is {"point": "route" | "done" | "risky", "id", "task", "text"} plus source (route: swe-rebench, terminal-bench-2 or gstack-routing), tests_pass (done: the final diff's hidden-test result) or origin (risky: sampled, with model, or written). `replay items` checks the counts (400 route, 480 done, 400 sampled and 200 written risky). drawStratified is the seeded draw for the route prompts by source and the sampled commands by model. The fixture is tests/harness-mechanics/fixtures/replay/items.jsonl, the same items replay-fake.ts builds.

`replay run` refuses before any call when the counts are off, when --start (the decision-routing results post, or the Captain's record that it stopped) is missing, or when the stage2-replay ledger is not approved at its cap or was used before. It writes digests.json (the items, the written risky set, the start record and both splits), opens one lease, calls every client on the dev items, writes band.json, then calls them on the held items, settles the lease at the metered spend and writes report.md, report.json, one reliability plot per point and backend, and admission.json. admission.json is the h3_admission input of report: {"points": [{"point": "done" | "risky", "result": "admitted" | "not beaten" | "no read"}]}. `replay report <out dir>` rebuilds the report from those files with no calls. The answer files carry ids, labels, scores, costs and tokens, never item text.

**The interface unit 7 fills.** One module that exports `replayClients(): ReplayClients` (replay.ts), passed as --clients. ReplayClients holds five functions of one shape, `(req: ReplayRequest) => Promise<ReplayAnswer>`, with ReplayRequest {point, id, task, text, answers} and ReplayAnswer {label, score?, cost_usd, tokens, latency_ms?}:

- astra and opus: the two labelers. They label route and risky items from req.answers (LABELS: the route answer set; risky's taxonomy "1" to "4" or "not risky"). Done items get no labeler call.
- jev: Jev alone at its own fixed threshold, with score.
- p1: particle-1 alone, with score.
- det: gstack's deterministic version: gstack-skill-route --explain --json at the pin with its 0.66 scorer for route, section 8's exact rules for done, and section 8's lists with every undecided command allowed for risky.

score is the probability of block or deny for done and risky, and the confidence in label for route. cost_usd is required on every answer: an answer without it stops the run. The cascade is not a client: replay.ts builds it from jev and p1 with the tuned band. replay-fake.ts exports the same function with fakes. The item builders that read Stage 1's sessions (each final stop with the done hook's inputs, and the sampled Bash commands) and the public route pools are not built here; they write the items file above.

Readings taken where section 10 leaves a choice (the most literal one each time):

1. A stratified draw takes equal shares in the order the strata are listed. A stratum short of its share gives all it has, and the rest go round the others. One seeded stream runs across the strata.
2. The risky labelers label on the taxonomy's five classes, so agreement means the same class and kappa is over those classes. Scoring then reads classes 1 to 4 as deny and not risky as allow. A label outside the answer set drops the item. A kappa that is undefined (one class only) reads NO READ.
3. Done and risky items share one task split, so a Stage 1 task's stops and commands sit on the same side. Route splits by prompt. An odd count gives held the extra key.
4. The cascade escalates to particle-1 when Jev's score lies inside the band [lo, hi], with edges on a 0.01 grid, and no band is a candidate. "Narrowest (least escalation)" ranks by dev escalation rate, then width, then lower edge. "Within 1 point" is a balanced accuracy at least particle-1 alone's minus 0.01.
5. Jev alone uses the label its client returns at its own threshold. It is descriptive and never admits a point. Admission's "at least one backend" means the two live backends, the Jev cascade and particle-1 alone, and the false-block or false-deny bar applies to the backend that beats.
6. Paired differences are each backend minus the deterministic version and the cascade minus particle-1 alone, with 95% percentile intervals from analyze.ts's clusterBoot by task. A backend's label outside its answer set counts as allow.
7. Calibration for done and risky bins the probability of block or deny against how often blocking was right. For route it bins confidence against accuracy. Brier uses the same pairs. An answer with no score counts as 1 or 0 from its label.
8. "Frozen before any held item is read" covers every held call, labels included: band.json is written before the first held call.
9. The replay runs no sessions, so it is one launch with one lease of section 22's expected spend times its margin (pins.ts REPLAY, money.ts leaseUsd). It calls six items at a time. Before each batch, settled spend plus every in-flight reservation plus the batch's call count times the dearest call seen so far must stay at or under the $90 lease, or the run cap-stops before the batch's first call. Before any call has settled, the dearest call is the plan's per-call estimate times 1.5. Section 22 gives no per-call figure, so the estimate is the expected $60 over the 6,440 planned calls (three per done item, five per route or risky item), about $0.0093, and $0.0140 with the margin (replay.ts PER_CALL_USD).
10. The start rule's record is a file named by --start. The run records its path and sha256 and refuses a missing file; it does not read the file's content.

## Build log

- Install diff, measured on 2026-11-09 at gstack ba2289e1. build.sh hm with HM_PLAIN=1 adds a plain tree from `./setup --host claude --no-browser --loadout lite` with no flags (plain.tar sha256 290c53b5ddb25321ae26a9671c755b40c19754ad26d1e1aaa3af2e1f74e17185, a measurement, not a run arm). It and the prose tree (`--skill-contracts` with skill_contracts off) hold the same paths, and two files differ: .claude/settings.json gains the contract Stop entry (_gstack_source gstack-skill-contract, running hosts/claude/hooks/skill-contract-stop-hook with a 10 s timeout), and .gstack/config.yaml gains one line, `skill_contracts: off`.
