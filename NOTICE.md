# Notices

gstack-evals is MIT licensed ([LICENSE](LICENSE)). This file lists every outside project whose code is, or is planned to be, vendored here, and the projects it reads or runs without copying code.

A unit that vendors a file records the exact source commit in its row, keeps the upstream copyright line in each file's header, and marks every change it makes. Until a row says vendored, no code from that source is in this repo.

## Vendored or planned

| Source | What | Lands in | Licence | Unit | Status |
|---|---|---|---|---|---|
| [harness-evals](https://github.com/garrytan/harness-evals) `runner/proxy/metering-proxy.ts` and `runner/proxy/sanitize.ts` | The metering proxy: lease mode, per-session slots, fail-closed pricing, upstream status counts, the leak tripwire. Lease mode only; slot bearers and meter ids, the management socket, the journal, retries and problem-details refusals are new code, listed in the file header | src/runner/proxy/ | MIT, Copyright (c) 2026 Garry Tan | U3 | vendored from 70cb3d019, which includes the exposure fix harness-evals#97 (a0fe48da6); sanitize.ts unchanged |
| harness-evals `runner/ledger/budget-ledger.ts`, pricing section | The chat price table and the request pricing, reservation, usage-cost and stream-usage functions the proxy reserves against. Anthropic and OpenAI chat only, no fallback table | src/runner/pricing/prices.ts | MIT, Copyright (c) 2026 Garry Tan | U3 | vendored from 70cb3d019; changes listed in the file header |
| harness-evals `runner/ledger/budget-ledger.ts`, itself from [gbrain-evals](https://github.com/garrytan/gbrain-evals) | The budget ledger, rewritten on vendoring: line items, leases, write-once approvals, journal, reconcile | src/runner/ledger/ | MIT, Copyright (c) 2026 Garry Tan | U4 | planned |
| harness-evals `runner/prereg/prereg.ts` | The preregistration checker, unchanged | src/runner/prereg/ | MIT, Copyright (c) 2026 Garry Tan | U2 | planned |
| harness-evals `runner/stats/` (from gbrain-evals v0.10.128, 6999ebc9, `eval/runner/stats/`) and `scripts/paired-mdd.ts` | The statistics kit, with two fixes: `nonInferiorityP` on all-zero differences, and per-task means | src/runner/stats/ | MIT, Copyright (c) 2026 Garry Tan | U2 | planned |
| harness-evals `scripts/` | Held-out sealing (adapted so bodies live outside the repo), the receipts manifest, the publish audit, Ubicloud fanout | scripts/ | MIT, Copyright (c) 2026 Garry Tan | v1.1 | planned |
| gbrain-evals `eval/registry.ts`, `eval/runner/mutation-kit.ts`, CONTRIBUTING "Add a category" | Promotion rules, the scorer mutation kit, the bug ledger, hermetic env and document shapes | not placed yet | MIT, Copyright (c) 2026 Garry Tan | v1.1 | planned; plan read 566c16f8 |
| [skill-diet](https://github.com/nicobailon/skill-diet) `scripts/eval.mjs` | The tasks.json format, the adapter contract, the three-run calibration and the MISS, WORSE and WARN gates, adapted for Lane A | src/skill-eval/ | MIT, Copyright (c) 2026 Nico Bailon | U5, U6, U7, U10 | planned; plan read 5f41df1 |
| GSTA-131's review replay panel (a Capy crew thread working for this repo's owner) | Panel cases, build scripts, the runner, two evals and measured tokens; public cases only | lanes/review-replay/ | Joins under this repo's MIT licence; credited in the lane README and each file header | U13 | planned |

When the first skill-diet file lands, its unit adds skill-diet's MIT licence text below with its copyright line. harness-evals and gbrain-evals carry the same licence text and copyright holder as [LICENSE](LICENSE).

## Read or run, not vendored

| Project | How gstack-evals uses it | Licence |
|---|---|---|
| [gstack](https://github.com/garrytan/gstack) | Lane A reads gstack's skill eval contract (docs/designs/SKILL_EVAL_CONTRACT.md) and applies the same task-file rules as its `checkEvalTasks` without copying code. Keyless tests read gstack's committed task files and run its scripts/review-dispatch-compare.ts from a checkout. | MIT |
| Harbor | The candidate Lane B task format and trial runner, settled by the U8 spike. If any Harbor file is ever vendored, its NOTICE and the Apache-2.0 change-marking rules apply. | Apache-2.0 |
