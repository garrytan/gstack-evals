# Delivery route eval

Which way of handing a coding agent a short procedure gets the procedure followed? This lane runs agent-skills' Prove-It steps for a bug fix four ways (no route, a skill found by its description, a gstack-shaped skill with setup first, a typed command with the steps first) on 60 SWE-rebench bugs and three models, and counts the sessions that followed the steps. The plan, the decision each result leads to and the frozen numbers are in [the preregistration](../../wiki/plans/2026-11-17-geva-547-delivery-route-prereg/README.md).

It runs on the harness mechanics eval's rig (lanes/harness-mechanics) and L1's host and part machinery (quick/laneb/l1), with no new harness.

## Files

| File | What it does |
|---|---|
| pins.ts | Frozen values: the arms, the step text's sources, the models, the items and caps, the planning rates, the bundle loader and the draw reader |
| arms/ | The arm sources: the step text, the three files that carry it, and the gstack-shaped arm's three stand-in scripts |
| arms.ts | Regenerates the arm sources from pinned agent-skills and gstack checkouts, builds the canonical tars, writes and checks the manifests under quick/laneb/arms/manifests/b1 |
| fake-model.ts, sessions.ts | Keyless scripted sessions in the real Claude Code image against a stub model: what each arm delivers, the gstack-shaped setup, its stand-in scripts against real gstack 1.99.5.0, and the detector on real transcripts |
| detect.ts | The primary: did a session write a test, see it fail before the first source edit, and see it pass after. It also counts the Bash writes no parser can name and flags writes to non-spec files under a spec folder |
| table.ts | One row per trial: outcome class, reward, cost, the detector's reading, steps seen, skill loads, safety stops, the read audit |
| analyze.ts | Per model and arm: followed rate with its interval, the 80% bar, the gap rule, the line that scores sessions with unnamed or spec-folder writes both ways, paired contrasts and the decision reading |
| plans.ts, money.ts | The items and parts, the launcher profile, approvals, the cap formula, the launch guard and the one rerun |
| cli.ts | `gstack-evals b1 <command>` |

## Commands

```
bun lanes/delivery-route/cli.ts arms sources --agent-skills <checkout> --gstack <checkout> [--check]
bun lanes/delivery-route/cli.ts arms build [--out <dir>] [--manifests]
bun lanes/delivery-route/cli.ts arms check
bun lanes/delivery-route/cli.ts sessions run --out <dir> [--gstack <checkout>] [--cut tests/delivery-route/fixtures/sessions]
bun lanes/delivery-route/cli.ts plan
bun lanes/delivery-route/cli.ts approve --ledger <jsonl> --item <item> --usd <cap> --approved-by <who>
bun lanes/delivery-route/cli.ts prepare <work> --item <item>
bun lanes/delivery-route/cli.ts host-up|attach|recover|host-down <work>
bun lanes/delivery-route/cli.ts launch|relaunch|rerun <work> --part <part>
bun lanes/delivery-route/cli.ts guard <work>
bun lanes/delivery-route/cli.ts done --ledger <jsonl> --item <item>
bun lanes/delivery-route/cli.ts detect <trial dir>
bun lanes/delivery-route/cli.ts table <config.json> <out.jsonl>
bun lanes/delivery-route/cli.ts report <table.jsonl> [--out <dir>]
```

The launcher commands are L1's (quick/laneb/l1/README.md) under this lane's profile: the same environment (LEDGER, ARMS, UBI_RUNNER, UBI_RUNNER_SHA256, UBI_OWNER, UBI_RECOVERY_DIR and the route's key), the same exit codes, host root ~/b1 on the awake host, ledger port 9947 and arm manifests under quick/laneb/arms/manifests/b1. ARMS holds none.tar, described.tar, gstack-shaped.tar and command.tar from `arms build` (default ~/.capy/work/b1/arms). host-up, launch and relaunch run the launch guard first, which reads B1_LEDGERS (a folder of <item>.jsonl ledgers) and B1_CREW (a JSON file, {"as_of": "...", "usd": n}, written from the lane's own spend counter).

`sessions run` needs Docker and the hm-session image (lanes/harness-mechanics/hm-session.Dockerfile on laneb-check:ubuntu-24.04, which quick/laneb/arms/check-l1.sh builds). It makes no model call.

The table config is the harness mechanics one: {"jobs": [{"dir": "<pulled>/jobs/<job>", "part": "<part>"}], "sessions": ["<pulled>/out/proxy-sessions.jsonl"]}.

`report` refuses a table that holds a row whose task is not one of the 60 drawn tasks, or two graded rows for one model, arm and task. It prints one E_USAGE line per problem and exits 2. Infra and cap-stop rows never count as repeats, so an attempt 2 or a relaunch is read.

## Deviation D1, 2026-11-17, before any counted session

Section 6 of the preregistration reads a passing run as "after the source edit, a successful result that shows a test outcome (a pytest summary, unittest's Ran N tests, a tox or nox result) with no failing count and no line reporting a failed test in the test file, from a run that selects the test." The detector as merged applied that to the whole Bash call: the call's exit status and every count anywhere in its result.

A hand reading of the smoke sessions found two Opus 5.5 sessions on getmoto__moto-9590 that followed the steps and were scored as not followed:

- command arm, trial getmoto__moto-9590__6Q4dqEV: one call ran the fix, the test's folder and two ruff checks, and exited 127 because ruff is not installed. The next ran the test's folder with tests/test_core, whose collection printed "4 errors" with or without the fix, and then the test's own run, which printed "1 passed".
- gstack-shaped arm, trial getmoto__moto-9590__z8o4DSr: one call ran the fix, the test's folder ("178 passed") and two ruff checks, and exited 127 because ruff is not installed.

A linter or another suite chained after the test says nothing about whether the steps were followed. So the detector now also reads the passing run per test-runner command. When a call's test-runner commands and its result's test summaries (pytest's summary line; unittest's Ran line with the OK or FAILED after it) pair one to one in order, each runner command's outcome is its own summary, and a runner command that selects the test, comes after the source edit and whose own summary passed is a passing run. A result that reports a failed test in the session's test files is never a passing run. A call whose runners and summaries don't pair is read whole, as before. The failing run is unchanged.

The rule as merged stays in every table row as followed_as_merged, and the report prints it beside each arm's primary as a sensitivity line ("as merged, before D1"), with the decision reading under that rule.

Admission (section 10), rerun over the same 1,200 sessions: the merged detector reproduces admission.txt on every count, and D1 changes 9 sessions, all GPT-6.1 Sol, each from not followed to followed (passing-after and tool-only move with them):

- none arm, collective__icalendar-921: the test's own run ("43 passed") was chained with the whole suite, which failed one timezone test in another file ("1 failed, 9649 passed").
- verify-prose arm, chaoss__augur-3512, google__adk-python-3088 (one of the 60 run tasks), kubeflow__pipelines-13112, lincc-frameworks__nested-pandas-425, litestar-org__advanced-alchemy-673_interface, macbre__sql-metadata-625_interface, niconoe__pyinaturalist-643 and oOo0oOo__leanclient-24: the passing run was chained with checks that exited 1, in each case /verify's own `gstack-checks status` (NOT_READY), and in google__adk-python-3088 a pyink format check before it.

Section 10 numbers that move: Sol's none arm from 151 to 152 of 200 (unchanged at 48 of the 60 run tasks) and Sol's verify-prose arm from 144 to 152 of 200 and from 47 to 48 of the 60. Opus 5.5 and particle-1 don't move. Over the 24 smoke sessions only the two Opus sessions above change.

## Credits

The Prove-It steps, the /test front matter and the test-driven-development description are from [agent-skills](https://github.com/addyosmani/agent-skills) by Addy Osmani (MIT). The gstack-shaped setup text is gstack's own /verify setup. NOTICE.md has both rows.
