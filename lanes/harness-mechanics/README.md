# Harness mechanics eval

The build of the preregistration [2026-11-09-geva-448-harness-mechanics-prereg](../../wiki/plans/2026-11-09-geva-448-harness-mechanics-prereg/README.md): is a stop rule followed more as a hook than as prose, does a second plain attempt beat gstack's /verify at equal spend, and is Jev a good backend for judgment hooks. Claude Code on SWE-rebench issues, on Opus 5.5, GPT-6.1 Sol and particle-1.

## Pieces

- pins.ts: every frozen value (gstack pin, seed, parallel sessions, turns, context, models and allowances, ledger caps, the arm specs, the closing line), the bundle loader that checks each attachment against the README front matter's sha256, and the readers for scored.txt, calibration.txt, spare.txt, judge-subset.txt and judge-pilot.txt in their shuffled order. It also reads the task-fit screen's lists, an input file checked by sha256 (HM_SCREENED, HM_SCREENED_SHA256).
- plans.ts: the item and part plans and the launcher profile (HM_PROFILE) for L1's host and part machinery.
- table.ts: one HmSessionRow (src/types.ts) per Lane B trial dir, through L1's readers.
- score.ts: the session scorer. A stub: every score field is null until the scorer's build.
- analyze.ts: the report entry point. It refuses with E_HM_NOT_BUILT until the analysis build.
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
    bun lanes/harness-mechanics/cli.ts report <table.jsonl> --stage stage1|stage3|stage4 --out <dir>

The launcher commands are L1's (quick/laneb/l1/README.md, "L1 launcher") under this lane's profile: the same environment (LEDGER, ARMS, UBI_RUNNER, UBI_RUNNER_SHA256, UBI_OWNER, UBI_RECOVERY_DIR and the route's key), the same exit codes, host root ~/hm on the awake host, ledger port 9930 and arm manifests under quick/laneb/arms/manifests/hm. prepare also needs HM_SCREENED and HM_SCREENED_SHA256, and writes hm.json (sessions, picker calls, the closing line, the screened lists' digest) beside L1's plan.json. ARMS holds the none, prose, hook and judge tars.

The table config is {"jobs": [{"dir": <jobs dir>, "part": <part>}], "sessions": [<proxy-sessions.jsonl>], "home": "/root"}.

## Tests

bun test tests/harness-mechanics/ runs keylessly.
