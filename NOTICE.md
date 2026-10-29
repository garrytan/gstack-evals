# Notices

gstack-evals is MIT licensed ([LICENSE](LICENSE)). This file lists every outside project whose code is, or is planned to be, vendored here, and the projects it reads or runs without copying code.

A unit that vendors a file records the exact source commit in its row, keeps the upstream copyright line in each file's header, and marks every change it makes. Until a row says vendored or adapted, no code from that source is in this repo.

## Vendored or planned

| Source | What | Lands in | Licence | Unit | Status |
|---|---|---|---|---|---|
| [harness-evals](https://github.com/garrytan/harness-evals) `runner/proxy/metering-proxy.ts` and `runner/proxy/sanitize.ts` | The metering proxy: lease mode, per-session slots, fail-closed pricing, upstream status counts, the leak tripwire. Lease mode only; slot bearers and meter ids, the management socket, the journal, retries and problem-details refusals are new code, listed in the file header | src/runner/proxy/ | MIT, Copyright (c) 2026 Garry Tan | U3 | vendored from 70cb3d019, which includes the exposure fix harness-evals#97 (a0fe48da6); sanitize.ts unchanged |
| harness-evals `runner/ledger/budget-ledger.ts`, pricing section | The chat price table and the request pricing, reservation, usage-cost and stream-usage functions the proxy reserves against. Anthropic and OpenAI chat only, no fallback table | src/runner/pricing/prices.ts | MIT, Copyright (c) 2026 Garry Tan | U3 | vendored from 70cb3d019; changes listed in the file header |
| harness-evals `runner/ledger/budget-ledger.ts`, itself from [gbrain-evals](https://github.com/garrytan/gbrain-evals) | The budget ledger: line items, leases, write-once approvals, reconcile | src/runner/ledger/ | MIT, Copyright (c) 2026 Garry Tan | U4 | not vendored: U4 wrote the ledger new after reading harness-evals 70cb3d019 (SQLite in WAL mode, one BEGIN IMMEDIATE transaction per charge, unknown outcomes kept at their reservation); no code copied |
| harness-evals `runner/prereg/prereg.ts` | The preregistration checker, unchanged | src/runner/prereg/ | MIT, Copyright (c) 2026 Garry Tan | U2 | planned |
| harness-evals `runner/stats/` (from gbrain-evals v0.10.128, 6999ebc9, `eval/runner/stats/`) and `scripts/paired-mdd.ts` | The statistics kit, with two fixes: `nonInferiorityP` on all-zero differences, and per-task means | src/runner/stats/ | MIT, Copyright (c) 2026 Garry Tan | U2 | `runner/stats/` and its tests vendored from harness-evals 70cb3d0197b7, with the `nonInferiorityP` fix, two `gates.ts` fixes, superiority on the clustered sign-flip p, and a system failure scored 0 only where higher is better. `scripts/paired-mdd.ts` is not vendored, since it reads harness-evals' trial records: `sizing.ts` sizes designs with unequal trials, and `powerNote` gives a run's detectable effect |
| harness-evals `scripts/` | Held-out sealing (adapted so bodies live outside the repo), the receipts manifest, the publish audit, Ubicloud fanout | scripts/ | MIT, Copyright (c) 2026 Garry Tan | v1.1 | planned |
| gbrain-evals `eval/registry.ts`, `eval/runner/mutation-kit.ts`, CONTRIBUTING "Add a category" | Promotion rules, the scorer mutation kit, the bug ledger, hermetic env and document shapes | not placed yet | MIT, Copyright (c) 2026 Garry Tan | v1.1 | planned; plan read 566c16f8 |
| [skill-diet](https://github.com/nicobailon/skill-diet) `scripts/eval.mjs` | The tasks.json format, the adapter contract, the three-run calibration and the MISS, WORSE and WARN gates, adapted for Lane A | src/skill-eval/ | MIT, Copyright (c) 2026 Nico Bailon | U5, U6, U7, U10 | adapted by U5 from 5f41df1: the answer-scoring rules in src/skill-eval/contract/predicate.ts; the rest planned |
| [gstack](https://github.com/garrytan/gstack) `test/fixtures/skill-evals/{learn,write-skill}/` | gstack's committed contract task files and their seed scripts, byte for byte, so the contract tests run with no checkout | tests/contract/fixtures/gstack/ | MIT, Copyright (c) 2026 Garry Tan | U5 | vendored unchanged from 61e201ec (v1.91.295.0); digests in that folder's README |
| GSTA-131's review replay panel (a Capy crew thread working for this repo's owner) | Panel cases, build scripts, the runner, two evals and measured tokens; public cases only | lanes/review-replay/ | Joins under this repo's MIT licence; credited in the lane README and each file header | U13 | planned |

harness-evals and gbrain-evals carry the same licence text and copyright holder as [LICENSE](LICENSE). skill-diet's licence:

```
MIT License

Copyright (c) 2026 Nico Bailon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Read or run, not vendored

| Project | How gstack-evals uses it | Licence |
|---|---|---|
| [gstack](https://github.com/garrytan/gstack) | Lane A reads gstack's skill eval contract (docs/designs/SKILL_EVAL_CONTRACT.md) and applies the same task-file rules as its `checkEvalTasks` without copying code. Keyless tests read the vendored copies of its task files listed above. An opt-in parity test, set by `GSTACK_CHECKOUT`, runs `checkEvalTasks` itself from a checkout. U13's keyless test will run its scripts/review-dispatch-compare.ts from a checkout. quick/laneb/arms/build.sh runs gstack's own setup from a checkout at 61e201ec (v1.91.295.0) to build the Lane B gstack arm. The arm tarball is not committed; quick/laneb/arms/manifests lists each file's path, size, mode and sha256, and copies none of gstack's files. | MIT |
| Harbor | The Lane B task format and trial runner, chosen by the U8 spike. spikes/harbor/ and quick/laneb/ (pinned at f3a5a923) import Harbor at run time and copy none of its files. If any Harbor file is ever vendored, its NOTICE and the Apache-2.0 change-marking rules apply. | Apache-2.0 |
| [Terminal-Bench 2.0](https://github.com/harbor-framework/terminal-bench-2) | quick/laneb/ runs its tasks by registry pin at 69671fb, fetched at run time. quick/laneb/tasks/ records task names, registry pins, image digests and published per-trial results, and copies none of its files. | Apache-2.0 |
