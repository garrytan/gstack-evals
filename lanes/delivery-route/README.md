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

## Credits

The Prove-It steps, the /test front matter and the test-driven-development description are from [agent-skills](https://github.com/addyosmani/agent-skills) by Addy Osmani (MIT). The gstack-shaped setup text is gstack's own /verify setup. NOTICE.md has both rows.
