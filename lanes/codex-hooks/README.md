# Codex hooks eval

Do gstack's routing hook and its /review contract help GPT-6.1 Sol in Codex CLI, and does high effort? Part R runs B1's 60 bug tasks with gstack's routing hook on, off and with no gstack, and reads whether the prove-it skill loaded. Part C runs R2's 33 review units with the /review contract on, off, on at high effort and with no gstack, and reads the known bugs a session's final report adds over its report at the contract's first block. The plan, the decisions each result changes and the frozen numbers are in [the preregistration](../../wiki/plans/2026-11-19-geva-562-codex-hooks-prereg/README.md), with its pre-run change on the results branch.

## Files

| File | What it does |
|---|---|
| pins.ts | Values both parts share: the gstack pin, the Codex CLI and its digests, the model, and the settings every arm passes |
| cli.ts | `gstack-evals codex-hooks r|c <command>` |
| allin.ts | The all-in stop (section 11, pre-run change 2): before a part R launch, a part C step or a judge run, every item of both parts and the judge item counts at its spend or projection, plus the crew counter, and past $1,200 nothing starts |
| c/pins.ts | Part C's frozen values: the suite and its seeded pilot draw, the prefix, the four arms as review-units' codex-arms entries, and the four ledger items |
| c/rollout.ts | A session's rollouts as the readouts read them: the root thread, sub-agent threads, turns, messages, tool calls and contract blocks |
| c/states.ts | Each session's final and first-stop states and their findings, and the blind copy the judge reads |
| c/contract.ts | Section 5.6's exposure readout (contract log and independent check, false blocks, would-block) and pre-run change 1's pilot flags |
| c/outcomes.ts | Section 5.8's outcome per session, with the model, Codex version and effort read from the session's own record |
| c/plan.ts | The schedule (pilot, then c-main and h-main interleaved by unit), each step's review-units command, and the money: approval, guard, done mark and the dry run |
| c/run.ts | The run controller: one review-units run per item and unit, the collect pass, and the one rerun |
| c/readout.ts | The per-item readout files and the per-arm summary the pilot readout releases |
| c/records.ts | The states file the judging and analysis read, written from the readouts of one phase's items |
| c/stub.ts | A keyless stand-in for the Responses API that the fixtures and the end-to-end check run Codex against |
| c/cli.ts | `codex-hooks c` commands; `c analysis <command>` runs c/analysis/cli.ts |
| c/analysis/frozen.ts | Part C's frozen judging and analysis values: the suite, brief and severity map digests, the seeds, the judges, the judge check, power.txt's numbers and the judge item |
| c/analysis/record.ts | The states file part C's rig writes, one JSON line per session state, and the check that reads it |
| c/analysis/severity.ts | R2's after-pin severity maps applied to a finding's label |
| c/analysis/judging.ts | The three blind batches (extraction, matching, adjudication) with one packet per state, their keys, and which items a second and third judge read |
| c/analysis/run.ts | Sends a batch to its judges through any sender: primary, then second, then third, with one retry for a refused answer |
| c/analysis/join.ts | Joins the judges' reply files into one label per item |
| c/analysis/meter.ts | The paid sender, which puts each request through the metering proxy on a lease of the judge item, and the judge item's dry run |
| c/analysis/judge-policy.json | The models that may judge, adjudicate or write gold labels |
| c/analysis/check.ts | The judge check on the pilot, the confirmation check on the counted run, and the route that passed both |
| c/analysis/score.ts | Found, blocking, unmatched findings, new blockers and false blockers per state |
| c/analysis/analysis.ts | Paired contrasts with R2's clustered bootstrap and the exact sign-flip test, and per-arm summaries |
| c/analysis/decide.ts | The readings of section 1's contract table and E3 table |
| c/analysis/pilot.ts | The pilot readout and the R113 line |
| c/analysis/cli.ts | `gstack-evals codex-hooks c analysis <command>` |
| r/pins.ts | Part R's frozen values: the three arms, the Codex settings they pass (the shared ones plus a non-login shell, pre-run change 3), prove-it on Codex, the pilot tasks, the items and caps, the session allowance, the Codex install line, the proxy route and the route table's digest |
| r/routes.ts, r/route-table.tsv | The keyless route table (section 4.4): each prompt through the r-on home's routing hook; its output is change 1's table byte for byte |
| r/arms/Dockerfile, r/arms.ts | The three arm tars (gstack at ~/gstack set up with `./setup --host codex`, prove-it beside it, the seeded user; r-off with `skill_routing off`; r-none empty), each with a manifest: the tar's and tree's digests, the switches and Codex's own start capture |
| r/task-setup.Dockerfile | B1's task setup byte for byte, then Codex 0.170.0 from npm's tarball by its sha256 at /opt/laneb/codex |
| r/proxy.json | The metering proxy's route for part R: the OpenAI Responses API at api.openai.com for gpt-6.1-sol |
| r/prepare-run.ts | Lane B's prepare step, then part R's proxy route and the Codex agent in each job, with the driver's argv and env |
| r/plans.ts, r/money.ts | The items and their parts on L1's host and part machinery; the approval, done mark, launch guard, one rerun and the dry run |
| r/detect.ts | The load detector (section 4.5) on a session's copied rollouts, what the session's own hook log named, and section 4.6's reasons and split; tested on stub-driven sessions real Codex 0.170 wrote (tests/codex-hooks/r/fixtures) |
| r/table.ts | One row per session: outcome by section 4.7, cost, tokens, wall time, questions, safety stops, the root thread's model and Codex version from its rollout, the loads, destructive-check denies, r-none's read audit, and whether an allowance stop was a refused reservation or spend reaching $5 |
| r/smoke.sh, r/fake-responses.ts | The keyless end-to-end smoke: a fake Responses upstream, the metering proxy with a scratch ledger, Harbor, the Codex agent and Codex 0.170 in a real SWE-rebench task image, the verifier, then the session table |
| r/report.ts | The reading (section 4.8) with section 1's routing decision, and the pilot readout (section 9), which gives no load rate |
| r/cli.ts | `gstack-evals codex-hooks r <command>` |

## Part C, step by step

All of these are keyless except `run` on a real ledger, which spends.

```sh
bun lanes/codex-hooks/cli.ts c dry-run                       # one lease per item on a temporary ledger, and the schedule's counts
bun lanes/codex-hooks/cli.ts c plan                          # the steps in order
bun lanes/codex-hooks/cli.ts c approve --record <record> --item c-pilot --cap 60 --by <who> --words "<their words>"
bun lanes/codex-hooks/cli.ts c guard --record <record> --item c-pilot --root <root>
bun lanes/codex-hooks/cli.ts c run --phase pilot --root <root> --record <record> --ledger <ledger.sqlite> \
  --r-ledgers <dir> --crew <crew.json> --source garrytan/gstack=<clone> --source garrytan/gbrain=<clone>
bun lanes/codex-hooks/cli.ts c readout --root <root>         # writes <root>/<item>/readout/ and prints each summary
bun lanes/codex-hooks/cli.ts c states --root <root> --phase pilot --out <states.jsonl>   # the states file `c analysis` reads
bun lanes/codex-hooks/cli.ts c rerun --root <root> --item c-pilot   # then run the phase again for the one rerun
bun lanes/codex-hooks/cli.ts c done --record <record> --item c-pilot
```

`run` builds each step as `gstack-evals review-units --host codex --codex-arms <root>/<item>/codex-arms.json ... --resume` over the item's own `--out` (`<root>/<item>`), so a relaunch runs only the cells `cells.ndjson` lacks. Each session records init.json's host facts, copies its rollouts to `host/codex-sessions/` and gstack's hook logs and contract records to `host/gstack-hooks/` and `host/gstack-contracts/`, and the proxy's journal keeps each request's reasoning effort.

For a keyless end-to-end check, start the stub (`bun lanes/codex-hooks/c/stub.ts <port> <log>`) and pass `--upstream http://host.docker.internal:<port>` with every provider key unset; review-units refuses `--upstream` while a key is set.

## Part C judging and analysis

Every command reads one states file from the rig (`--states`, written by `c states`) and one judging directory (`--dir`). Each batch the judges read sits in its own folder there, with its key beside it and never inside it. Only `run` without `--dry-run` calls a model, and it spends from the `geva-562-judge` ledger item under one `--run-id` for every step. Run `--dry-run` first: it prices each request's worst case and sends nothing.

1. `packets extract`, then `run extract`. The production judge lists the findings of each message that has no json block.
2. `packets match`, `run match`, then `join match`. On the pilot, `--pilot` adds the judge check's anchors.
3. On the pilot only: `run gold`, then `check`.
4. `packets adjudicate --source <owner/repo>=<clone>`, `run adjudicate`, then `join adjudicate`.
5. On the counted run: `run gold`, then `confirm`. `route` names the route that passed both checks, and `analyze --route-file <route.json>` reads the tables.
6. `pilot` gives the pilot readout and the R113 line, `judge-item` dry runs the judge item on a temporary ledger, and `power` prints power.txt's numbers.

The tests in tests/codex-hooks/c/analysis/ run every step keyless, against a fake provider behind the real metering proxy.

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
WORK=<dir r prepare made> [TASK=<task>] [ARM=r-on] lanes/codex-hooks/r/smoke.sh   # one session end to end, no key
```

Paid, on L1's host and part machinery, each after the Captain records the item's cap:

```
bun lanes/codex-hooks/cli.ts r approve --ledger <jsonl> --item r-pilot --usd 50 --approved-by <who>
LEDGER=<jsonl> ARMS=<tar dir> SWEREBENCH=<export> bun lanes/codex-hooks/cli.ts r prepare <work> --item r-pilot
R_LEDGERS=<dir> R_CREW=<crew.json> CH_RECORD=<record> bun lanes/codex-hooks/cli.ts r host-up <work>
R_LEDGERS=<dir> R_CREW=<crew.json> CH_RECORD=<record> bun lanes/codex-hooks/cli.ts r launch <work> --part r-pilot
```

The crew file holds `as_of` and `usd`, this thread's counter. Before every part R launch, part C step and judge run, the all-in stop (allin.ts) counts every item of both parts and the judge item, part R's ledgers in `R_LEDGERS` (`--r-ledgers`) and part C's and the judge's in the record (`CH_RECORD`, `--record`), plus that counter, against the Captain's $1,200 stop. r-main launches only after r-pilot is marked done.
