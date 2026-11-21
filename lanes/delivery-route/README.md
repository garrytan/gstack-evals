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

A linter or another suite chained after the test says nothing about whether the steps were followed. So the detector now also reads the passing run per test-runner command, where that is safe. When a call's test-runner commands and its result's test summaries (pytest's summary line, passing only with a passed count above 0; unittest's Ran line with the OK or FAILED after it) pair one to one in order, each runner command's outcome is its own summary, and a runner command that selects the test, comes after the source edit and whose own summary passed is a passing run. Pairing is used only when nothing else in the call can print a summary or print them out of order: the call has no &; every runner is pytest or unittest behind nothing but an interpreter, options and known wrappers (timeout, env, uv run, coverage run and the like); and every other command is an assignment, a filter reading a pipe, an in-place sed or perl, a virtualenv's activate script, or one of cd, pwd, export, unset, echo, printf, true, false, sleep, ls, git, cp, mv, rm, mkdir, touch, ruff, black, pyink, isort, flake8, mypy, pyright and pylint. A result that reports a failed test in the session's test files is never a passing run. Any other call is read whole, as before. The failing run is unchanged.

A second-model read of the first version of this change found two ways it could read a pass that did not happen: runners started together with &, whose summaries print out of order, and a runner whose summary was cut off (head -1) paired with a summary that a script printed. The conditions above close both, and the tests cover each.

The rule as merged stays in every table row as followed_as_merged, and the report prints it beside each arm's primary as a sensitivity line ("as merged, before D1"), with the decision reading under that rule.

Admission (section 10), rerun over the same 1,200 sessions: the merged detector reproduces admission.txt on every count, and D1 changes 2 sessions, both GPT-6.1 Sol, each from not followed to followed (passing-after and tool-only move with them):

- none arm, collective__icalendar-921: the test's own run printed "43 passed", and the whole suite, run after it with &&, failed one timezone test in another file ("1 failed, 9649 passed").
- verify-prose arm, google__adk-python-3088 (one of the 60 run tasks): the test's run printed "99 passed", and a pyink format check chained after it exited 1.

Seven more Sol verify-prose sessions pass their test the same way but chain /verify's own `"$C" status` (gstack-checks, named by a variable), so they are read whole and stay not followed.

Section 10 numbers that move: Sol's none arm from 151 to 152 of 200 (unchanged at 48 of the 60 run tasks) and Sol's verify-prose arm from 144 to 145 of 200 and from 47 to 48 of the 60. Opus 5.5 and particle-1 don't move. Over the 24 smoke sessions only the two Opus sessions above change.

## B1b: the skill named in prose

B1b runs B1's gstack-shaped prove-it skill on B1's 60 tasks and plain prompt, untyped, in two arms: claude-md (gstack's CLAUDE.md routing block naming /prove-it, at /root/.claude/CLAUDE.md) and hook (gstack's prompt-routing hook, printing its line naming /prove-it on every prompt). Opus 5.5 only. The primary is whether the skill loaded. The plan, the decision table and the frozen numbers are in [its preregistration](../../wiki/plans/2026-11-18-capy-b1b-prose-route-prereg/README.md). B1's files stay as merged; table.ts reads B1b's arm names and fake-model.ts gains a `load` mode. The results are in [the results post](../../wiki/board/2026-11-18-capy-b1b-prose-route-results/README.md).

Dated change, 2026-11-18, after the counted runs: the load detector reads the model's text blocks as the SDK log writes them, with no type field. Before, it read no model text, so every first text in reasons.tsv was blank and a session that named the skill only in its text read "never named". Loads and followed don't read the model's text, so they are unchanged.

| File | What it does |
|---|---|
| b1b-pins.ts | Frozen values: the two arms, the gstack commit and the git blob of every route file, the routing block's one changed line, the hook's one change, the items, caps and all-in stop, and B1's run whose none arm is reused |
| arms/b1b/ | The route files, regenerated from gstack at the pin; TypeScript files are kept as `<name>.ts.txt` |
| b1b.ts | Sources, tars and manifests (quick/laneb/arms/manifests/b1b), the route table, four keyless scripted sessions, the plan, caps and launch guard, the none arm's reuse check, the load detector, the table, and the report with its decision reading and reasons.tsv |

```
bun lanes/delivery-route/cli.ts b1b arms sources --gstack <checkout at the pin> [--check]
bun lanes/delivery-route/cli.ts b1b arms build [--out <dir>] [--manifests]
bun lanes/delivery-route/cli.ts b1b arms check
bun lanes/delivery-route/cli.ts b1b sessions run --out <dir> [--cut tests/delivery-route/fixtures/b1b-sessions]
bun lanes/delivery-route/cli.ts b1b routes --export <SWE-rebench export> [--out <tsv>]
bun lanes/delivery-route/cli.ts b1b plan
bun lanes/delivery-route/cli.ts b1b reuse [--head <commit>]
bun lanes/delivery-route/cli.ts b1b approve --ledger <jsonl> --item <item> --usd <cap> --approved-by <who>
bun lanes/delivery-route/cli.ts b1b prepare <work> --item <item>
bun lanes/delivery-route/cli.ts b1b host-up|attach|recover|host-down <work>
bun lanes/delivery-route/cli.ts b1b launch|relaunch|rerun <work> --part <part>
bun lanes/delivery-route/cli.ts b1b guard <work>
bun lanes/delivery-route/cli.ts b1b done --ledger <jsonl> --item <item>
bun lanes/delivery-route/cli.ts b1b table <config.json> <out.jsonl>
bun lanes/delivery-route/cli.ts b1b report <table.jsonl> [--out <dir>]
```

The launcher commands are L1's under B1b's profile: host root ~/b1b, ledger port 9948, ARMS holding claude-md.tar and hook.tar. The launch guard reads B1B_LEDGERS and B1B_CREW the way B1's reads B1_LEDGERS and B1_CREW, and also refuses when the run commit's harness differs from B1's (`b1b reuse`). `routes` needs bun and an export holding each task's instruction.md; `sessions run` needs Docker and the hm-session image, as B1's does. Neither makes a model call.

## B1c: the routing block in the project CLAUDE.md

B1c runs B1b's claude-md arm with one change: the routing block sits in the task's project CLAUDE.md (/testbed/CLAUDE.md), placed and committed the way gstack's project install writes it, instead of in the user's CLAUDE.md. One arm, project-md, on Opus 5.5. B1b's hook and claude-md arms are read from B1b's published rows as controls, and B1's none arm as the no-gstack arm. The primary is whether the skill loaded, paired against B1b's hook arm with a 15-point margin. The plan, the decision table and the frozen numbers are in [its preregistration](../../wiki/plans/2026-11-18-capy-b1c-project-route-prereg/README.md). B1's and B1b's files stay as merged; table.ts reads B1c's arm name. The results are in [the results post](../../wiki/board/2026-11-18-capy-b1c-project-route-results/README.md).

The arm reaches the project through the rig's one pre-session command at the working directory (`checks_trust=true`, laneb_hooks.py CHECKS_TRUST, unchanged): its tar carries the block and arms/b1c/place-block at that command's path, and the script creates /testbed/CLAUDE.md, commits it with gstack's message and removes itself before the session starts.

| File | What it does |
|---|---|
| b1c-pins.ts | Frozen values: the arm and its spec, the placement (paths, gstack's message and install lines, the block's digest), the items, caps, all-in stop and margin, and B1b's run whose arms are the controls |
| arms/b1c/place-block | The placement script the arm's tar carries |
| b1c.ts | The tar and manifest (quick/laneb/arms/manifests/b1c), the plan, caps and launch guard, the controls' reuse check, the session rows (placed, loaded, why not), the report with its band, the power table and three keyless scripted sessions |

```
bun lanes/delivery-route/cli.ts b1c arms sources --gstack <checkout at B1b's gstack pin>
bun lanes/delivery-route/cli.ts b1c arms build [--out <dir>] [--manifest]
bun lanes/delivery-route/cli.ts b1c arms check
bun lanes/delivery-route/cli.ts b1c sessions run --out <dir> [--cut tests/delivery-route/fixtures/b1c-sessions]
bun lanes/delivery-route/cli.ts b1c plan | power | reuse [--head <commit>]
bun lanes/delivery-route/cli.ts b1c approve --ledger <jsonl> --item <item> --usd <cap> --approved-by <who>
bun lanes/delivery-route/cli.ts b1c prepare <work> --item <item>
bun lanes/delivery-route/cli.ts b1c host-up|attach|recover|host-down <work>
bun lanes/delivery-route/cli.ts b1c launch|relaunch|rerun <work> --part <part>
bun lanes/delivery-route/cli.ts b1c guard <work>
bun lanes/delivery-route/cli.ts b1c done --ledger <jsonl> --item <item>
bun lanes/delivery-route/cli.ts b1c table <config.json> <out.jsonl>
bun lanes/delivery-route/cli.ts b1c report <table.jsonl> [--out <dir>]
```

The launcher commands are L1's under B1c's profile: host root ~/b1c, ledger port 9949, ARMS holding project-md.tar. The launch guard reads B1C_LEDGERS and B1C_CREW the way B1b's reads its pair, and refuses when the run commit's or the checkout's harness differs from B1b's run or B1's (`b1c reuse`) or the checkout holds uncommitted changes to those paths. `sessions run` needs Docker and the hm-session image, as B1b's does, and makes no model call.

## B1d: gstack main with its hooks on by default

B1d installs gstack main at 5afef04 the way a user does (`./setup`, the full loadout), adds B1's prove-it skill beside it, and runs B1's 60 bugs on Opus 5.5 unattended, as one arm, gstack-main. gstack's owner's rule reads the count of sessions where prove-it loaded against 39 (B1c's count). Because gstack's matcher was tuned on those 60 prompts, a sealed held-out set of 60 other bugs runs four arms side by side: gstack-main, B1c's project-md arm, project-md-noescape (B1c's block without its escape clause) and B1's none arm. The plan, the decision table, the held-out draw and the frozen numbers are in [its preregistration](../../wiki/plans/2026-11-19-capy-b1d-hook-default-prereg/README.md). B1's, B1b's and B1c's files stay as merged; table.ts reads B1d's arm names, and fake-model.ts gains two scripts (verify, guard).

| File | What it does |
|---|---|
| b1d-pins.ts | Frozen values: gstack's pin and the blobs of its route files, the hook registrations, the listing, the noescape change, the four held-out arms and their rates, the held-out draw's digests and coverage, the smoke, the items, caps, all-in stop, bar, margin and held-out MDD, and B1c's run whose rows are the in-sample control |
| b1d-build.sh | Builds the gstack-main tar: fetches gstack by sha, runs its setup in quick/laneb/arms/Dockerfile's gstack-l1-tar target with the full loadout, and adds prove-it |
| arms/b1d/CLAUDE-noescape.md | The noescape arm's block |
| b1d.ts | The arm checks and the small tars, the keyless route table, the plan, caps and launch guard, the reuse checks, the session rows (loaded, /verify loaded, what the hook named, why not), the in-sample and held-out reports with the decision and R48 verdict, the power table and eight keyless scripted sessions |

```
lanes/delivery-route/b1d-build.sh
bun lanes/delivery-route/cli.ts b1d arms build [--out <dir>] [--manifests]
bun lanes/delivery-route/cli.ts b1d arms check
bun lanes/delivery-route/cli.ts b1d routes --export <SWE-rebench export> [--out <tsv>] [--check] [--sealed <tsv>]
bun lanes/delivery-route/cli.ts b1d sessions run --out <dir> [--cut tests/delivery-route/fixtures/b1d-sessions]
bun lanes/delivery-route/cli.ts b1d plan | power | reuse [--head <commit>]
bun lanes/delivery-route/cli.ts b1d approve --ledger <jsonl> --item <item> --usd <cap> --approved-by <who>
bun lanes/delivery-route/cli.ts b1d prepare <work> --item <item>
bun lanes/delivery-route/cli.ts b1d host-up|attach|recover|host-down <work>
bun lanes/delivery-route/cli.ts b1d launch|relaunch|rerun <work> --part <part>
bun lanes/delivery-route/cli.ts b1d guard <work>
bun lanes/delivery-route/cli.ts b1d done --ledger <jsonl> --item <item>
bun lanes/delivery-route/cli.ts b1d table <config.json> <out.jsonl>
bun lanes/delivery-route/cli.ts b1d report <table.jsonl> --item <b1d-smoke|b1d-in|b1d-ho> [--in <in-sample table.jsonl>] [--routes <sealed held-out route table>] [--out <dir>]
```

The launcher commands are L1's under B1d's profile: host root ~/b1d, ledger port 9950, ARMS holding the four held-out tars. The launch guard reads B1D_LEDGERS and B1D_CREW, and refuses when the run commit's or the checkout's harness differs from B1c's run or B1's (`b1d reuse`) or the checkout holds uncommitted changes to those paths or B1d's own. Its all-in stop is $400 (b1d-pins.ts B1D.stopUsd, raised from $340 on 2026-11-19 before the pilot). A relaunch is never refused on money: when it would pass its item's cap or the all-in stop, the guard prints `B1D_LAUNCH OVERSHOOT` and the reasons for the Captain, and the relaunch runs its salvage. A fresh launch past either still refuses. Held-out commands read the sealed list from B1D_HELDOUT and refuse it unless it is the committed draw. `routes` needs the built tree and an export holding each task's instruction.md; `sessions run` needs Docker, the hm-session image and the built tars. None of them makes a model call.

## B1e: B1d on gstack's matcher fix

B1e runs B1d's gstack-main arm again, built by `B1_PINS=b1e-pins.ts lanes/delivery-route/b1d-build.sh` into ~/.capy/work/b1e/arms from gstack main at 5df6b5a8, which names the installed bug-fix skill alone on bug reports. It runs on B1's 60 run tasks against the same bar of 39, and on a fresh draw of 60 tasks no B1 run has used, beside B1's no-gstack arm. The plan and the decision are in [its preregistration](../../wiki/plans/2026-11-20-capy-b1e-matcher-fix-prereg/README.md). The session rows, load detector and readers are B1d's; b1d.ts's arm checks take the gstack pin as an argument, and its pilot check takes the arms.

| File | What it does |
|---|---|
| b1e-pins.ts | Frozen values: the gstack pin and its blobs, the arms, the keyless coverage, the fresh draw's digests, the smoke tasks, the items and caps, and B1d's run whose in-sample rows are a paired reference |
| b1e.ts | The arm manifest and check, the route table with the fresh draw, the plan, profile and caps, the launch check, the reports, the decision and its R48 verdict, and the power table |

```
bun lanes/delivery-route/cli.ts b1e arms manifest|check [--out <dir>]
bun lanes/delivery-route/cli.ts b1e routes --export <swe-rebench export> [--tree <dir>] [--out <tsv>] [--check]
bun lanes/delivery-route/cli.ts b1e plan | power | reuse [--head <commit>]
bun lanes/delivery-route/cli.ts b1e approve --ledger <jsonl> --item <item> --usd <cap> --approved-by <who>
bun lanes/delivery-route/cli.ts b1e prepare|host-up|attach|recover|host-down|launch|relaunch|rerun <work> ...
bun lanes/delivery-route/cli.ts b1e table <config.json> <out.jsonl>
bun lanes/delivery-route/cli.ts b1e report <table.jsonl> --item <b1e-smoke|b1e-in|b1e-fresh> [--in <in-sample table.jsonl>] [--out <dir>]
```

The launcher commands are L1's under B1e's profile: host root ~/b1e, ledger port 9951, ARMS holding gstack-main.tar and none.tar. Before host-up, launch and relaunch, B1e reruns both reuse checks at the run commit and the checkout's head and refuses a checkout with uncommitted harness changes. It has no all-in guard; each item's ledger cap bounds its spend.

## Credits

The Prove-It steps, the /test front matter and the test-driven-development description are from [agent-skills](https://github.com/addyosmani/agent-skills) by Addy Osmani (MIT). The gstack-shaped setup text is gstack's own /verify setup. B1b's routing block and prompt-routing hook are gstack's own, at bbf48aa7ef19. B1d installs gstack itself at 5afef04e31de, and B1e at 5df6b5a8cf21, at build time; neither commits gstack's code. NOTICE.md has rows for the bytes this repo vendors.
