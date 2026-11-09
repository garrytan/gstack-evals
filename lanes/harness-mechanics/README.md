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

The launcher commands are L1's (quick/laneb/l1/README.md, "L1 launcher") under this lane's profile: the same environment (LEDGER, ARMS, UBI_RUNNER, UBI_RUNNER_SHA256, UBI_OWNER, UBI_RECOVERY_DIR and the route's key), the same exit codes, host root ~/hm on the awake host, ledger port 9930 and arm manifests under quick/laneb/arms/manifests/hm. prepare also needs HM_SCREENED and HM_SCREENED_SHA256, and writes hm.json (sessions, picker calls, the closing line, the screened lists' digest) beside L1's plan.json. ARMS holds the none, prose, hook and judge tars.

The dry run's matcher steps (3-matcher-probes, matcher-72, probes-189, stop-hook-loadline) need HM_GSTACK, a gstack checkout that holds the pin: each checks that the vendored files are the pin's blobs there. Without it they fail with E_HM_PIN. probes-189 takes about a minute, because BEFORE runs until its child is killed.

The table config is {"jobs": [{"dir": <jobs dir>, "part": <part>}], "sessions": [<proxy-sessions.jsonl>], "home": "/root"}.

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

Dry-run step d1-checks needs Docker and HM_GSTACK (ARMS names the arm tars, default ~/.capy/work/hm/arms). On tobymao__sqlglot-6413 and the first calibration task from another repository, it builds the image from the pinned task image plus the task workdir, Lane B's runtime PATH line and task-setup.Dockerfile. It checks that origin/main is HEAD and pytest resolves in the env, extracts the prose tar, edits one tracked source file, and checks that /verify's loop refuses with CHECKS_CONSENT_REQUIRED before trust. Then it runs CHECKS_TRUST, counts the test files gstack's own pregate selection picks, and runs the loop command from the pin's verify/SKILL.md. It passes when both tasks select at least one test file and print CHECK tests PASS or FAIL, the none tar gets the same origin and PATH with no gstack file, and the loop exits 3 with no pregate context once the origin is removed. It removes its containers and images after and writes its commands and output to <out>/d1-checks.txt.
