# Codex hooks eval

Do gstack's routing hook and its /review contract help GPT-6.1 Sol in Codex CLI, and does high effort? Part R runs B1's 60 bug tasks with gstack's routing hook on, off and with no gstack, and reads whether the prove-it skill loaded. Part C runs R2's 33 review units with the /review contract on, off, on at high effort and with no gstack, and reads the known bugs a session's final report adds over its report at the contract's first block. The plan, the decisions each result changes and the frozen numbers are in [the preregistration](../../wiki/plans/2026-11-19-geva-562-codex-hooks-prereg/README.md), with its pre-run change on the results branch.

## Files

| File | What it does |
|---|---|
| pins.ts | Values both parts share: the gstack pin, the Codex CLI and its digests, the model, and the settings every arm passes |
| cli.ts | `gstack-evals codex-hooks r|c <command>` |
| r/pins.ts | Part R's frozen values: the three arms, prove-it on Codex, the pilot tasks, the items and caps, the session allowance, the Codex install line, the proxy route and the route table's digest |
| r/routes.ts, r/route-table.tsv | The keyless route table (section 4.4): each prompt through the r-on home's routing hook; its output is change 1's table byte for byte |
| r/arms/Dockerfile, r/arms.ts | The three arm tars (gstack at ~/gstack set up with `./setup --host codex`, prove-it beside it, the seeded user; r-off with `skill_routing off`; r-none empty), each with a manifest: the tar's and tree's digests, the switches and Codex's own start capture |
| r/task-setup.Dockerfile | B1's task setup byte for byte, then Codex 0.170.0 from npm's tarball by its sha256 at /opt/laneb/codex |
| r/proxy.json | The metering proxy's route for part R: the OpenAI Responses API at api.openai.com for gpt-6.1-sol |
| r/prepare-run.ts | Lane B's prepare step, then part R's proxy route and the Codex agent in each job, with the driver's argv and env |
| r/plans.ts, r/money.ts | The items and their parts on L1's host and part machinery; the approval, done mark, launch guard, one rerun and the dry run |
| r/detect.ts | The load detector (section 4.5) on a session's copied rollouts, what the session's own hook log named, and section 4.6's reasons and split; tested on stub-driven sessions real Codex 0.170 wrote (tests/codex-hooks/r/fixtures) |
| r/table.ts | One row per session: outcome by section 4.7, cost, tokens, wall time, questions, safety stops, the root thread's model and Codex version from its rollout, the loads, and whether an allowance stop was a refused reservation or spend reaching $5 |
| r/report.ts | The reading (section 4.8) with section 1's routing decision, and the pilot readout (section 9), which gives no load rate |
| r/cli.ts | `gstack-evals codex-hooks r <command>` |

Lane B pieces part R adds: quick/laneb/runner/agent/laneb_codex.py (the Codex agent), quick/laneb/runner/responses.ts (the proxy's Responses route), quick/laneb/config/cells.codex-hooks-r.json and the arm manifests in quick/laneb/arms/manifests/codex-hooks-r.

## Part R commands

Keyless:

```
bun lanes/codex-hooks/cli.ts r routes --home <r-on home>        # the route table; exits 0 only on change 1's bytes
bun lanes/codex-hooks/cli.ts r arms build --out <dir> [--register]
bun lanes/codex-hooks/cli.ts r arms check <tar dir>             # a run's tars against the committed manifests
bun lanes/codex-hooks/cli.ts r plan                             # parts, sessions and the cap rule against section 11
bun lanes/codex-hooks/cli.ts r dry-run                          # one lease per item on a temporary ledger
bun lanes/codex-hooks/cli.ts r table <config.json> <out.jsonl>
bun lanes/codex-hooks/cli.ts r report <table.jsonl> --item r-pilot [--hand <tsv>]   # the pilot readout; --hand: trial, prove_it, verify (yes or no)
bun lanes/codex-hooks/cli.ts r report <table.jsonl> --item r-main     # the reading and the decision
```

Paid, on L1's host and part machinery, each after the Captain records the item's cap:

```
bun lanes/codex-hooks/cli.ts r approve --ledger <jsonl> --item r-pilot --usd 45 --approved-by <who>
LEDGER=<jsonl> ARMS=<tar dir> SWEREBENCH=<export> bun lanes/codex-hooks/cli.ts r prepare <work> --item r-pilot
R_LEDGERS=<dir> R_CREW=<crew.json> bun lanes/codex-hooks/cli.ts r host-up <work>
R_LEDGERS=<dir> R_CREW=<crew.json> bun lanes/codex-hooks/cli.ts r launch <work> --part r-pilot
```

The crew file holds `as_of` and `usd`, this thread's counter. The guard reads every item's projection plus that counter against the Captain's $1,200 all-in stop (r/pins.ts). r-main launches only after r-pilot is marked done.
