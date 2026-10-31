# GEVA-79 keyless dry run of the planning lane's frozen rules

Scorer: lanes/review-noloss at main af60b9e, run from a copy at $D/repo ($D = $D), CLI = `bun bin/gstack-evals noloss`.
Everything is synthetic and keyless. Rebuild with `bash run.sh` and `bash power.sh` (gen.ts seed 79). Full outputs: out/logs/<tag>.out|.err; summary: results.log, power.log, holm-power.log.

Suite planrev-ceo-dryrun: 33 units (repo dryrun/planpanel, pr 1..33): 24 seeded x 2 blockers, 3 real x 1, 6 decoys. 51 blocking blockers in 27 clusters.
- A decoy with zero blockers is refused (suiteProblems: "units[i] needs at least one blocker"). One over-blocking blocker per decoy (catalog deserved INFORMATIONAL) works. Decoys add no cluster to recall or power (27 PRs) but count in the false-blocker reading (33 PRs).
- Faked diff concepts: unit head and base (40-hex), unit id and cluster (<repo>#<pr>), blocker location "added"; catalog reviewed_head, merge_base, diff_range, fix.commit and fix.pr, decoys (minItems 1, a fix-commit range with audit null), roles (specialist checklist "plan-ceo"), severity.in_history (minItems 1), shelf_life, receipt.
- The suite and catalog must sit inside the scorer's repo tree: catalogs resolve against REPO_ROOT (suite --check, judge-packet), and export loads the suite by id from lanes/review-noloss/suites/.
- Arms: six arms x 3 passes, contract v1, all ingest. Blocking recall: opus-gstack 56.2%, opus-lens 35.9%, opus-none 32.0%, p1-gstack 32.0%, p1-none 18.3%, p1-placebo 15.7%.

| Rule | Result | Change the plan must state |
|---|---|---|
| R1 primary family | CHANGE | Write loss_family.null as the string "zero"; a literal 0 is refused. Expect no NO_LOSS claim at this size (see below). |
| R2 power | CHANGE | noloss power reports LOSS power at unadjusted 0.05 only; Holm alphas need holm-power.ts or a new flag. |
| R3 missing cells | CHANGE | (a) scores; (b) gives no verdict. The derived suite needs its own id, its own comparisons file and a derive tool (none exists). |
| R4 dropped rung | PASS | The derived opus-only file must carry its own loss_family order of 4. |
| R5 stopped arm | PASS | The stopped arm's comparisons keep their Holm steps (family stays 8). |
| R6 blind judging | CHANGE | The second reply must answer exactly the set judge-join names. A join over arms that already hold judgments.tsv or adjudication.tsv needs --replace "<reason>". |
| R7 false blockers | PASS | none |
| R8 suite id | PASS | The comparisons file's "suite" must equal the scored suite's id (an id, not a path). |

## R1
`$CLI score --suite planrev-ceo-dryrun --variant <v> --reference <r> --prereg $D/out/comparisons/primary.json --root $D/out/root`, for all 8 pairs in declared order.
- opus-none vs opus-gstack: exit 1, `verdict: LOSS`; "p loss 0.000010 (Holm 0.000079, step 1 of 8 in the declared LOSS family) (minimum reachable 1.5e-8)".
- p1-none vs p1-gstack: exit 1, LOSS, "p loss 0.0011 (Holm 0.0053, step 4 of 8 in the declared LOSS family)". p1-placebo vs p1-gstack: exit 1, LOSS (Holm 0.00082). opus-lens vs opus-gstack: exit 1, LOSS (Holm 0.00037).
- The four reverse comparisons give exit 2, `verdict: NO_LOSS NOLOSS_UNDERPOWERED`. The size rule uses "no-loss alpha 0.05/8, Holm's strictest step", and an equal arm gets NO_LOSS in only 29.7% to 62.2% of 2000 simulations. At 27 clusters and 3 passes, no no-loss claim can meet the size rule, so the family's useful reading is LOSS.
- `primary-null0.json` (null 0): exit 2, "E_NOLOSS_SUITE ... loss_family.null is zero (V no worse than R) or margin ...".
- Export: `$CLI export --comparisons $D/out/comparisons/primary.json --root $D/out/root --table $D/out/table.json` exits 0 from the copy, where the suite is registered. From the main checkout: exit 2, "E_NOLOSS_SUITE cannot read suite /workspace/gstack-evals/lanes/review-noloss/suites/planrev-ceo-dryrun.json". Export only reads registered suites.

## R2
`$CLI power --suite <suite.json> --passes 3 --recall 0.35 --margin 10 --loss <15|20|25>`, all exit 0. Header, verbatim:
`| Design | PRs | Blocking blockers | Passes per arm | Equal arm NO_LOSS at 10 pts | False NO_LOSS at delta -10 | A 15-point loss called LOSS |`
- 24 seeded: `| planrev-ceo-dryrun | 27 | 51 | 3 | 68.3% | 5.1% | 93.0% |`, then 99.6% at 20 points and 100.0% at 25.
- 16 seeded: `| planrev-ceo-dryrun-s16 | 19 | 35 | 3 | 55.1% | 4.2% | 81.0% |`, then 96.5% and 99.7%.
- 32 seeded: `| planrev-ceo-dryrun-s32 | 35 | 67 | 3 | 81.0% | 4.9% | 97.6% |`, then 100.0% and 100.0%.
The tool has no alpha flag. holm-power.ts mirrors simulate() and reproduces the tool's 0.05 column exactly. LOSS power at 0.05/8 (and 0.05/4):
- 16 seeded: 41.1% (54.9%) at 15 points, 74.8% (85.2%) at 20, 95.1% at 25.
- 20 seeded: 54.7% at 15, 86.3% (92.8%) at 20.
- 24 seeded: 68.9% (78.5%) at 15, 94.1% (97.0%) at 20, 99.5% at 25.
- 28 seeded: 77.0% at 15. 32 seeded: 83.8% at 15, 98.6% at 20.
The smallest tested size that reaches 80% for a 20-point difference at 0.05/8 is 20 seeded units (86.3%). 16 seeded reaches only 74.8%; 17 to 19 were not tested. At 24 seeded, the minimum detectable difference at 0.05/8 lies between 15 and 20 points; at 32 seeded it is 15 points.

## R3
Opus-gstack pass 2 is missing on units 5, 12 and 19, scored with --root root-r3a and root-r3b.
- (a) M, coverage complete, with a note: opus-none vs opus-gstack exit 1, `verdict: LOSS` (recall 53.6%, Holm 0.0010).
- (b) coverage incomplete: exit 2, `verdict: none`, "no verdict (arm opus-gstack has blockers recorded with coverage incomplete, so there is no verdict)". p1-gstack vs p1-none in the same file still scores.
- Derived suite: grep finds no derive tool in lanes/review-noloss or scripts/. The dry run used derive.ts, which drops the units' findings files and TSV rows and rewrites arm.json suite. It then registered planrev-ceo-dryrun-x3, re-ingested all six arms with --suite planrev-ceo-dryrun-x3 and scored them with primary-x3.json (suite set to x3). Result: exit 1, LOSS, "45 blockers in 24 PRs", Holm 0.000092.

## R4
- p1-* arms deleted (root-r4), full file: exit 2, "E_NOLOSS_ARM arm p1-none is not ingested for suite planrev-ceo-dryrun".
- opus-only.json (same 4 opus comparisons, order kept): opus-none vs opus-gstack exit 1, LOSS, "Holm 1.000 over 4 ... p loss 0.000010 (Holm 0.000039". opus-lens vs opus-gstack: LOSS (Holm 0.00016). The size rule moves to 0.05/4.

## R5
opus-lens status stopped (root-r5):
- opus-lens vs opus-gstack: exit 2, `verdict: none`, "no verdict (arm opus-lens stopped, so there is no verdict) ... (Holm n/a, step 7 of 8 ...)".
- opus-none vs opus-gstack: exit 1, LOSS, Holm 0.000079, step 1 of 8, the same as R1. The family does not shrink.

## R6
- `$CLI judge-packet --suite planrev-ceo-dryrun --arm <opus-none> --arm <opus-gstack> --seed 7 --out $D/out/judge/packets --key $D/out/judge/key.json`: exit 0. The blinding check passed with plan.md paths, lines and summaries, and the packets rendered (packets/<pr>.json). --adjudicate (seed 8) also exits 0.
- Blocker reply format: `{batch, judge, packets:[{file:"packets/<n>.json", sha256, blockers:[{id:"B1", matches:["F1",...]}]}]}`. Adjudication reply format: `{batch, judge, packets:[{file, sha256, findings:[{id:"F1", ruling:"defect|not-defect|known-informational"}]}]}`.
- A primary-only join exits 2 with "E_NOLOSS_BLIND scoring waits for the second judge: send these 49 blockers ..." (12 findings for adjudication). A full second reply is refused: "must answer exactly the 49 blockers judge-join named (0 missing, 8 extra)". filter.ts trims the second reply to the named set.
- Join with the named second reply and --replace:
```
join exit 0
judge-join: batch 6ba87c1933abe58fda79bae0b0d5c7f7c24809780f82a02208a418a8a6452cc9, wrote judgments for opus-none, opus-gstack under $D/out/judge/joined2; second judge
1	B1	M				judge one (synthetic)	no		1
adj join exit 0
judge-join: batch 2c0f77af748f2b717409e8976a335092a8c41c7b8c9bffa785299ddf8bf2fc7d, wrote adjudication.tsv for opus-none, opus-gstack under $D/out/judge/adj-joined2; s
5	fa75f93d596	2	defect	judge one (synthetic)	no	1	2c0f77af748f2b717409e8976a335092a8c41c7b8c9bffa785299ddf8bf2fc7d
```

## R7
The false-blocker reading appears in each R1 score, with false_blocker_drop 1 in the file and adjudication.tsv rulings. From opus-gstack vs opus-none: "false blockers per PR: opus-gstack 0.06, opus-none 0.08, difference -0.02 [95% CI -0.07, +0.03] on 33 PRs; two-sided p 0.688 (minimum reachable 0.031); smallest drop that counts 1 per PR: the estimate does not clear it; the interval does not exclude zero or lies above it."

## R8
- `--suite planrev-ceo-dryrun-x3 --prereg primary.json`: exit 2, "E_USAGE --prereg is for suite planrev-ceo-dryrun, not planrev-ceo-dryrun-x3".
- --suite given as a path with the matching file: exit 1, LOSS. --prereg is the comparisons file; its top-level "suite": "<suite id>" must equal the suite's id field.
- `suite --check --prereg <file>` is a different check: it compares freeze digests over byte prefixes and passes trivially when prereg_freezes is empty.
