# Codex hooks eval

Do gstack's routing hook and its /review contract help GPT-6.1 Sol in Codex CLI, and does high effort? Part R runs B1's 60 bug tasks with gstack's routing hook on, off and with no gstack, and reads whether the prove-it skill loaded. Part C runs R2's 33 review units with the /review contract on, off, on at high effort and with no gstack, and reads the known bugs a session's final report adds over its report at the contract's first block. The plan, the decisions each result changes and the frozen numbers are in [the preregistration](../../wiki/plans/2026-11-19-geva-562-codex-hooks-prereg/README.md), with its pre-run change on the results branch.

## Files

| File | What it does |
|---|---|
| pins.ts | Values both parts share: the gstack pin, the Codex CLI and its digests, the model, and the settings every arm passes |
| cli.ts | `gstack-evals codex-hooks r|c <command>` |
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

## Part C judging and analysis

Every command reads one states file from the rig (`--states`) and one judging directory (`--dir`). Each batch the judges read sits in its own folder there, with its key beside it and never inside it. Only `run` without `--dry-run` calls a model, and it spends from the `geva-562-judge` ledger item under one `--run-id` for every step. Run `--dry-run` first: it prices each request's worst case and sends nothing.

1. `packets extract`, then `run extract`. The production judge lists the findings of each message that has no json block.
2. `packets match`, `run match`, then `join match`. On the pilot, `--pilot` adds the judge check's anchors.
3. On the pilot only: `run gold`, then `check`.
4. `packets adjudicate --source <owner/repo>=<clone>`, `run adjudicate`, then `join adjudicate`.
5. On the counted run: `run gold`, then `confirm`. `route` names the route that passed both checks, and `analyze --route-file <route.json>` reads the tables.
6. `pilot` gives the pilot readout and the R113 line, `judge-item` dry runs the judge item on a temporary ledger, and `power` prints power.txt's numbers.

The tests in tests/codex-hooks/c/analysis/ run every step keyless, against a fake provider behind the real metering proxy.
