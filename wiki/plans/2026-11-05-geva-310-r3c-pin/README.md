---
id: 2026-11-05-geva-310-r3c-pin
kind: plan
title: "R3c pin: the build's merge commit, the arms' and records' digests, the five build rulings and a keyless dry run of every R3c rule"
summary: "Pins R3c to #226's merge commit 239d227d and the told arm at 699a41cb, with a keyless dry run (46 rules) and capture there, the five build rulings as rules, the k correction and the null-cost STOP."
author: GEVA-310
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-05
status: open
links:
  - 2026-11-05-geva-284-r3c-calibrated
  - 2026-11-04-geva-273-r3b-pin
  - garrytan/gstack-evals#226
attachments:
  - 705c71890d3beff47c5db94716d6a711e5edfe4bd3eea2a3d3cf7a4adbf20dc4  capture.txt
  - 022b71fb26696880a11234d4fcec33cb1639715e8b3f09e6dedd521f6b5bb49a  dryrun.sh.txt
  - e612ba4afa2494302c9bd517ad19aeec48d9bbbd4f315459dc1101c8e868c059  dryrun.txt
---

# R3c pin

[Amendment 6](../2026-11-05-geva-284-r3c-calibrated/README.md) section 10 asks for a pin post before any R3c spend. It names the build's merge commit and carries a keyless dry run at that commit that drives every rule with one ledger lease per trial on a temporary ledger. The Captain records r3c-opus's $750 cap in approvals/ only after this post merges, and no paid call happens before that.

GEVA-299 built #226 and drafted this post. GEVA-305 ran #226's review and added the grid resume rows (H5) to the dry run. GEVA-310 finished #226, ran the dry run and the capture at the merge commit and wrote this post.

## The pin

- **Build commit:** 239d227df569640e68058de52ee79c98d5ae114d, the squash merge of garrytan/gstack-evals#226. The run thread runs quick/laneb/r3/r3c.ts from this commit only.
- **Told arm:** R3b's, unchanged. gstack 699a41cb6808e01240d02e82247693f9170d401a and Claude Code 2.1.312, from quick/laneb/arms/manifests/r3b/gstack.json, checked against the six parts on the project drive (laneb-arms/r3b-gstack-699a41cb): tar e93a3aa4e1e477d0046027b32defbd331c60a847404b67118373250c0c281975, gz 8f56fdff7d154f0f5037a2424dc1ddfc3c53c596277803e5b12bab9a09c13125. The [R3b pin](../2026-11-04-geva-273-r3b-pin/README.md) lists its tree, files.tsv and settings.json digests.
- **None arm:** tar 8bab483364e4153a832c0995d6bc06d2953af805f32ae70a2e40788965a6764e. Rebuilt with arms/build.sh, its manifest is byte-identical to manifests/r3/none.json.
- **Prompt lines:** procedure line sha256 d369da3eacc80085787edc864ffddae08aa6bb83627e027d4b1121eac0aa2f9f; closing line (closing_line=r3c-root-cause-files) sha256 a1d63518118d7df92ba25d267f48ece72003e286433240adab43d273e6461d1c. Every arm's prompt ends with the closing line.
- **Pool:** the pinned Harbor's export of swe-rebench/swe-rebench-leaderboard, 860 tasks, every one shipping tests/parser.py at sha256 bdedd1a6f64c511cc1e2c8c4b9e9402d61e68d962dbebc78d9d86ec4ea3cd261. run refuses a task whose parser differs. That parser's passing statuses are PASSED and XFAIL.
- **In-hand records.** r3c-rules.ts checks each by sha256 before it reads it, and refuses a changed one with E_PIN_MISMATCH.

| Record | sha256 |
|---|---|
| opus-r3a4.jsonl | d7c87e34cc5bdeffd79c08cb9fc2decc0ea4da832048b9e74ccaadfd81638880 |
| sol-r3a4.jsonl | 6ecac9f836a8b9638d403dc0bb4c000c71470f8b3cb510bf3897901ccfff126d |
| opus-r3b.tsv | 2176856539f12ad8a255e68964960859bd6e4ae067a9970c86158e34193a88f8 |
| sol-r3b.tsv | dd8f041fa5687db05580e87854197505961a55a0533111fc03d759ce4e3c776b |
| r3a4-drop-list.json | dd23d16ce1b32669e219c82d48c2b7bd0fa34289b6dda628445a0939cc36cc6f |
| r3c-taskfit.tsv | b8298156309d020770ce94741531aa40a58f2d222faf0776a16acb4f4d20b54d |

## Tasks

The candidates are amendment 6's 201 Opus tasks in tiers t1 to t4 (16, 20, 55 and 110 tasks). Their sorted ids hash to 7a2b33c723b14ae97c4d8286a42bc5d914ffe2d856eb1ef42b50e1dcddfd1d27, and this post lists no task ids. prepare repeats each candidate by its tier's trial count, shuffles the 438 slots with seed 20261112 (slot list sha256 308c1cc5406458a8bee71789f145dc426231899a3dddb28e83dff03614b92ca9) and cuts three parts of 146. These digests come from prepare at 239d227 in the dry run below:

| Part | Trials | Tasks | order.json sha256 | oracle.json sha256 |
|---|---|---|---|---|
| cal-1a | 146 | 108 | f6bbf256e415419b154f01b453d3257003c4b886735d82ecf1b676fc5a6f9f40 | 1580927abcfe99e7301ee13c9b6ee3e06a44dfc18d8342e323be20dea1c72b55 |
| cal-1b | 146 | 103 | 3d8d1bdb325428162868070e9c5e0b2140d7806880470f646a217390f8d0cb9a | e1a93def13fc5a4e69fd985f61e411c8404d11a078dc4caba28d8487a44b7428 |
| cal-1c | 146 | 103 | b8d36967140a1a496fff7a8c2bac207c07a46b507df4c5e625ffb0f18bff64b9 | 6443e14ac82083c737485ec048d0d0cf6dda91b3ab406eb78760b3c258f992a2 |

cal-2 and the grid parts are prepared during run from measured outcomes, so their task lists exist only then.

## Commands

One item, r3c-opus ($750, ledger port 9917). From the build commit, with LEDGER the item's ledger file, INHAND the directory holding the six records above, ARMS the directory holding none.tar.gz and the told arm's gstack.tar.gz, and SWEREBENCH the export:

1. `bun quick/laneb/r3/r3c.ts arm-check`
2. `LEDGER=<ledger> INHAND=<dir> ARMS=<dir> SWEREBENCH=<export> bun quick/laneb/r3/r3c.ts prepare <work dir> --item r3c-opus`
3. The same env plus UBI_RUNNER, UBI_OWNER (the run thread's code), UBI_TTL_HOURS=12 or more, UBICLOUD_API_KEY, VM_USD_PER_HOUR=0.6, VM_RESERVE_HOURS=4, LEDGER_PORT=9917 and the provider key: `bun quick/laneb/r3/r3c.ts run <work dir> --item r3c-opus`. It binds the item, runs cal-1a to cal-1c and cal-2, and runs admission. On GO it prepares the grid parts and stops (exit 0). On STOP it ends (exit 5).
4. After the admit lines reach the Captain, with the same env: `bun quick/laneb/r3/r3c.ts grid <work dir> --item r3c-opus`.
5. After a projection stop and a raise recorded with `ledger.ts raise --approved-by <file>`, with the same env: `bun quick/laneb/r3/r3c.ts resume <work dir> --item r3c-opus`. This works for a stop in calibration and a stop in the grid.
6. `LEDGER=<ledger> INHAND=<dir> bun quick/laneb/r3/r3c.ts admit <work dir> --item r3c-opus` prints admission again and writes nothing; `analyze` with the same env gives the outcome.

run, grid and resume wait on each part for hours. Start them detached, with setsid, on a host that stays awake for the whole run and keeps the ledger file, such as a dedicated runner VM the run thread names and pins. Never start them on a Capy machine that can sleep. Two controllers can't share a work dir: the second is refused while the first holds its lock.

## The five build rulings

The Captain ruled on five build points, word for word:

> GEVA-299 build points, ruled do it: a worst-case cal-2 projection (440 trials) for the start rule before cal-2 is known; admit uses the ledger's current cap; a separate grid command after the admit lines reach the Captain; an unreadable transcript is a recorded error, never a miss; trial-order seeds 20261112 and 20261113. All go into the pin post.

At 239d227 they are these rules:

1. **Start rule.** run binds r3c-opus only when settled spend, plus cal-1's 438 trials and a worst-case cal-2 of 440 (4 trials on each of the 110 t4 tasks) at R3b's measured none cost and VM hours, plus the $79.20 reserve headroom, fits the cap. Until cal-1c settles, the projection before each later calibration part also counts cal-2 at 440. (Rules C1, C2, D2.)
2. **Admission's cap.** admit runs at the ledger's current cap and settled total, so a raise counts only once it is recorded on the ledger. (Rules D3, F5.)
3. **The grid command.** On GO, run prepares the grid parts and stops. The grid runs only through `r3c.ts grid`, after the admit lines reach the Captain, and only once. (Rules D1, D4, E3, H4.)
4. **Unreadable transcripts.** A graded trial with no readable main-thread text, including a log written before parent_tool_use_id was captured, is E_TRANSCRIPT_UNREADABLE, never a miss. While any graded grid trial has one, localization prints that error line instead of rates. The primary and its verdict do not change. (Rule H1.)
5. **Seeds.** Seed 20261112 shuffles cal-1's slots before the three-way cut. Seed 20261113 shuffles each grid part's task, arm and replicate slots. (Rules B5, B6.)

## What k = 1.72 compares

Amendment 6 section 1 defines k as a strict none rate on a reference set over the rate on the tier, at the same session budget, and gives k = 1.72 against R3a's SWE-bench Verified none rate. That pair is not at the same budget. R3a ran Opus at a $4 allowance with zero budget stops, not at R3c's $12, so k = 1.72 compares the two at a budget that did not bind, not at the same budget. The 0.94 session-cost anchor compares R3c's candidates with R3b, not with R3a. This changes no rule or number in amendment 6.

## A none trial with no session stops admission

A none calibration trial that never opened a session has a null cost. The frozen admissionInputs leaves that task's none cost unpriced, and admission STOPs. The rule stays frozen, and the Captain ruled that this post states the numbers.

- In hand, 0 of 410 Opus none trials never opened a session, infra included: 0 of 200 in R3a4's screens and 0 of 210 in R3b's grid. Sol was 0 of 200 and 0 of 210.
- The rule-of-three 95% upper bound on that rate is 3/410 = 0.73% a trial.
- Admission prices every calibration none trial on the admitted tasks. In the dry run's GO shape that is 176 trials (40 admitted tasks, 650 calibration trials).
- If trials fail to open a session independently at a fixed rate, the chance that at least one of the 176 has a null cost, so that admission STOPs early, is 0 at the observed rate, 16% at 0.1%, 36% at 0.25%, 59% at 0.5% and 72% at the 0.73% upper bound. These are calculations at assumed rates, not measured chances.

## The binding proofs

Two keyless proofs bind this pin, and the run thread reruns neither:

1. **The cap path:** the dry run below, with the grid resume rows H5a to H5f, passed every rule at 239d227.
2. **The transcript path:** #226's keyless capture (quick/laneb/r3/r3c-capture.sh, stub model runner/fake_upstream_r3c.ts) passed 17 of 17 checks at 239d227, keyless, on three made-up tasks in both arms. It ran through vm-run.sh, the proxy, the ledger, Harbor 0.25.0 at the pin, the agent, the pinned Agent SDK 0.2.174 and Claude Code 2.1.312 in Docker against a stub model. Every assistant record carries parent_tool_use_id. A ROOT CAUSE FILES block in a thinking block or a subagent message is never read, in either arm. The told arm's Stop hook lets a DEBUG REPORT followed by the block stop, and holds an unmet stop back while the block before the continuation still counts. Harbor keeps report.json and the oracle's patch, and a task listed twice runs in order.json's order. capture.txt holds its output.

## The dry run

dryrun.sh.txt ran at 239d227df569640e68058de52ee79c98d5ae114d and printed dryrun.txt. It takes the commit as its argument, exports it with git archive outside any git work tree, and ends with DRYRUN: ok and exit 0 (a failed rule prints DRYRUN: fail and exits 1). No step calls a model or starts a VM: the model and Ubicloud keys are unset, r3c.ts gets a placeholder Ubicloud key that is not a real one, and the Ubicloud runner and ssh are stubs. It reads the real SWE-rebench export, the real in-hand records and the real told arm.

How it drives the rules. Each scenario copies a prepared work dir, approves a fresh temporary ledger at $750 and runs r3c.ts run, grid, resume, admit and analyze. The real launch.sh reserves and settles each VM block and starts the item's ledger service. The stub ssh plays vm-run.sh: it opens and settles one $12 session lease per planned trial through that service, as the proxy does, in the part's order.json order, and writes each trial's files with the scenario's outcome and cost. Grid scenarios clone the GO run after admission.

dryrun.txt is the printed output with one change: two trial names in rules H1 and H2b are replaced by `<trial>`, because each holds a candidate task id. The unredacted output's sha256 is 7a79112f0c1fb9bcfdde5e830677f259e8004e2d5496014288ff6bac1cc72edd.

### Two limits

1. **Trial files use the keyless tests' shape.** Harbor, the agent and the proxy never run in the dry run, so it shows that the rules read such files as frozen, not that a real trial writes them that way. The capture above covers that path.
2. **The report-only MDD re-simulation ran at 20 simulated runs** (R3C_MDD_SIMS=20) instead of 2,000, to keep the run short. Those lines decide nothing. Admission always runs its frozen 2,000.

### One line per rule

At 239d227 all 46 rules passed:

1. **Export and arms (P0, A1 to A5).** The export sits outside any work tree. The six drive parts, the gz and the tar match SHA256SUMS.txt, the manifest and the told-arm pin. arm-check passes on the committed manifests and fails on a copy without the Stop entry. The none arm rebuilds byte for byte.
2. **Prepare (B1 to B7).** The six in-hand records match INHAND. The export holds the 860-task pool, each with the pinned parser. prepare refuses a ledger approved at $700 and an in-hand record changed by one byte (E_PIN_MISMATCH), and otherwise writes cal-1a to cal-1c at 146 trials each, with the plan naming the item, cap, candidates, both seeds, the closing line and the parser. The cal-1 parts run the none arm alone, with the closing line.
3. **Start rule (C1 to C4).** At $750 the projection is $472.86: 878 calibration trials at $0.44836 plus $79.20, and it binds. At $450 it refuses. A missing oracle.json and UBI_TTL_HOURS under 12 are refused before the bind.
4. **GO path (D1 to D7).** run binds, runs cal-1a to cal-1c, plans cal-2 from the failed t4 tasks (53 tasks, 212 trials) and admits: GO with 40 tasks x 11 replicates, MDD 10 points. The projection before each later calibration part counts cal-2 at 440 until cal-1c settles. admit again gives GO at the current cap. grid runs every part, with the projection before each from grid-1 on at the grid's own costs. The ledger holds 1,537 reserve and 1,537 settle rows for 1,530 trials and 7 VM blocks, with 0 open. analyze reads KEEP (n 40, R 11, parts 4, 4 and 3), with the report-only localization, f2pShare and oracle lines.
5. **Admission STOP (E1 to E4).** Calibration at $0.70 a trial leaves money for 2 replicates, under 3: run exits 5 with no grid, admit again exits 5, grid is refused and analyze exits 6.
6. **Projection stop, raise and resume in calibration (F1 to F6).** cal-1a at $1.20 a trial projects $1,132.80 before cal-1b, over $750, and the run stops there (exit 4, FIX-METHOD (cost limits)). Resume is refused with no raise, and refused again after a raise to $900. After a raise to $1,300 it is accepted once and admits at $1,300. A second resume is refused.
7. **Infra (G1).** 15 of cal-1b's 146 trials infra stops the run before admission, FIX-METHOD (harness limits).
8. **Grid rules (H1 to H4).** One grid trial logged without parent_tool_use_id prints E_TRANSCRIPT_UNREADABLE instead of rates and the KEEP stands. Told grid-1 trials at $1.50 project $1,011.70 before grid-2, over $750: the grid stops and analyze is incomplete for cost limits. At $6 a trial the ledger refuses a session reserve inside grid-1, and the part is incomplete for harness limits. Told and none passing alike gives CUT-CANDIDATE, or FIX-METHOD (task fit) by D1's ceil(3n/7). A second grid is refused.
9. **Projection stop, raise and resume in the grid (H5a to H5f).** These rows bind. Told grid-1 trials at $1.50 stop the grid before grid-2. Resume is refused with no recorded raise, and refused again after a raise to $900 that the $1,011.70 projection still passes, with no grid-2 lease. After a raise to $1,300 it is accepted once and every grid part launches. A second resume is refused. analyze then gives an outcome at the raised cap with 1,537 reserve and 1,537 settle rows and 0 open.

The dry-run outcomes come from made-up trial files. They test the rules, not gstack.

## Attachments

| File | What it is |
|---|---|
| dryrun.sh.txt | the dry-run script, run as `bash dryrun.sh.txt 239d227` |
| dryrun.txt | every line it printed at 239d227, with two trial names redacted |
| capture.txt | every line the keyless capture printed at 239d227, with its work dir written as $W |
