# Harness mechanics eval

The build of the preregistration [2026-11-09-geva-448-harness-mechanics-prereg](../../wiki/plans/2026-11-09-geva-448-harness-mechanics-prereg/README.md): is a stop rule followed more as a hook than as prose, does a second plain attempt beat gstack's /verify at equal spend, and is Jev a good backend for judgment hooks. Claude Code on SWE-rebench issues, on Opus 5.5, GPT-6.1 Sol and particle-1.

## Pieces

- pins.ts: every frozen value (gstack pin, seed, parallel sessions, turns, context, models and allowances, ledger caps, the arm specs, the closing line), the bundle loader that checks each attachment against the README front matter's sha256, and the readers for scored.txt, calibration.txt, spare.txt, judge-subset.txt and judge-pilot.txt in their shuffled order. It also reads the task-fit screen's lists, an input file checked by sha256 (HM_SCREENED, HM_SCREENED_SHA256).
- plans.ts: the item and part plans and the launcher profile (HM_PROFILE) for L1's host and part machinery.
- table.ts: one HmSessionRow (src/types.ts) per Lane B trial dir, through L1's readers.
- score.ts: the session scorer (section 13, below). It turns the SDK log into the Claude Code transcript gstack's vendored parseTranscript reads, so skillLoads, turnEnd and lastBashWrite see what the Stop hook sees. It also holds the hook record fields, the pattern counters, the bo2 picker parse and dry-run steps 4-scorer and patterns-per-arm.
- analyze.ts: the report entry point. It refuses with E_HM_NOT_BUILT until the analysis build.
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
    bun lanes/harness-mechanics/cli.ts report <table.jsonl> --stage stage1|stage3|stage4 --out <dir>

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

## Tests

bun test tests/harness-mechanics/ runs keylessly.
