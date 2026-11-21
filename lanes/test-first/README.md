# B2 test-first eval: the run lane

This folder runs the B2 test-first eval preregistered in [wiki/plans/2026-11-21-capy-b2-test-first-prereg](../../wiki/plans/2026-11-21-capy-b2-test-first-prereg/README.md). It asks whether telling an agent to write a failing test first helps it fix real bugs: 183 SWE-rebench tasks, four arms (no gstack, one test-first line in the instructions file, gstack alone, gstack with its prove-it skill typed), three models (Claude Opus 5.5 and particle-1 in Claude Code, GPT-6.2 Sol in Codex CLI).

Everything here is reachable as `gstack-evals b2 <command>` (or `bun lanes/test-first/cli.ts <command>`). Nothing in this folder calls a paid model by itself: paid sessions start only through `launch`, which passes the launch guard first.

## Commands

| Command | What it does |
|---|---|
| `arms build <dir>` | Builds none, line and the four Codex arm tars into a folder. `build-claude.sh <dir>` builds the Claude Code gstack and prove-it tars beside them. |
| `arms manifests <dir> [--register]` | Writes each arm's manifest from the built tars, checks what each arm must and must not hold, and with `--register` commits them under quick/laneb/arms/manifests/b2 with the Codex skill lines. |
| `arms check [<dir>]` | Rebuilds all eight tars and compares them byte for byte with the committed manifests. |
| `sessions run --out <dir> [--record]` | The keyless start captures: scripted Claude Code sessions per arm and one Codex session, all against stub models. `--record` writes their digests into the manifests. |
| `plan`, `dry-run` | Prints each item's parts, sessions and cap from the cap rule; opens and settles one lease per item on a temporary ledger. |
| `approve`, `done` | Writes an item's approval row at its recorded cap, or its done mark. |
| `guard <work> --counter-usd <usd> --counter-as-of <time>` | The launch guard: the item's cap, the $1,860 all-in stop with this thread's counter, and the run's order (pilot done, Sol's image check, the look). |
| `prepare`, `host-up`, `launch`, `attach`, `relaunch`, `rerun`, `recover`, `host-down` | L1's host and part machinery (quick/laneb/l1) under B2's profile. host-up, launch and relaunch run the guard first. |
| `images --out <dir>`, `images --record <file> <dir>...` | Builds every run task's image with Codex added and checks the Codex version inside, keyless; folds the rows into the record the guard reads. |
| `smoke.sh` | `WORK=<prepared dir> PART=<part> [TASK] [ARM] lanes/test-first/smoke.sh`: one session of a prepared part end to end and keyless, in the real task image through Harbor, the metering proxy and a scratch ledger, against a fake upstream (fake-responses.ts for Sol), then B2's table. |
| `table <config.json> <out.jsonl>` | One row per session from pulled parts, both hosts. |
| `look <table.jsonl> --out <record>` | The interim look at half the tasks. It prints only z, the bound and the decision. |
| `report <table.jsonl> [--stage end\|look] [--item b2-pilot]` | The reading and decision table, or the pilot's PASS and FAIL lines. |

The guard reads the item ledgers from `B2_LEDGERS`, the image check record from `B2_IMAGES` and the look record from `B2_LOOK`.

## Files

- pins.ts: the frozen values (arms, models, caps, bounds, the draw).
- arms.ts, build-claude.sh, arms/codex.Dockerfile: the eight arm tars and their manifests.
- sessions.ts, sessions-driver.py: the keyless start captures.
- plans.ts, prepare-run.ts, proxy.json: the parts, B2's prepare step (Sol parts get Codex and B2's Codex agent) and the proxy routes.
- money.ts: approvals, the cap rule, the launch guard, the dry run and the infrastructure rerun.
- images.ts: the Codex image check.
- scorer.ts, table.ts: the session table on the B2 scorer.
- analyze.ts: the reading, the look and the pilot report.
- cli.ts: the commands above.

## Credits

build-claude.sh follows the B1e build (lanes/delivery-route, b1e-build.sh) for the Claude Code gstack trees. The Codex arm build starts from the Codex hooks eval's part R Dockerfile (lanes/codex-hooks/r/arms/Dockerfile). The Codex agent is Lane B's (quick/laneb/runner/agent/laneb_codex.py). SWE-rebench is the work of Nebius AI R&D, used under CC-BY-4.0.
