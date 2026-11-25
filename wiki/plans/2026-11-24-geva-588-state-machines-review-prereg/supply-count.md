# Supply count for the State Machines review eval (GEVA-588)

Counted on 2026-11-24 with `gstack-evals sr pool` and `gstack-evals sr bic`, and recounted on 2026-11-25 at commit 5b856f07 with the same findBic that `sr bic` calls, split by repository across 16 workers on one VM (see the recount below). No model was called.

## The pool: 679 fixes

| Source | Rows | How a row gets in |
|---|---:|---|
| Known state bugs | 41 | SWE-bench-Live MultiLang rows that pstack-checks (#358) or the state machines prompt eval (#360) used, frozen by id (`KNOWN_ML`) |
| State machines eval's labelled rows | 67 | MultiLang rows that eval's two labellers (GPT-6 Astra and Opus 5.5) both marked a defect and state-shaped, other than the known ones (`SM_STATE_ML`) |
| SWE-rebench-V2.1 | 571 | Screened rows (a bug report, 1 to 6 files changed, state words in the report or fix, a pinned image), in a language the harness reads, at most 3 per repository in id order |

The 7 SWE-rebench leaderboard units #360 used need a Harbor export this machine doesn't have, so they are left out.

## The BIC gates: 222 of 679 pass

| Gate | Known | Labelled | V2.1 | All |
|---|---:|---:|---:|---:|
| No line the fix deletes or edits around has a commit that wrote it (E_SR_NO_BIC) | 1 | 0 | 8 | 9 |
| The commit that wrote most of those lines wrote under half of them (E_SR_BIC_SHARE) | 5 | 18 | 142 | 165 |
| That commit changes more than 2,000 lines (E_SR_BIC_SIZE) | 7 | 8 | 66 | 81 |
| Reversed onto the fix's base, it brings back under half of its own blamed lines (E_SR_PR_MISSES_BUG) | 12 | 21 | 169 | 202 |
| Pass | 16 | 20 | 186 | 222 |

The 222 come from 196 repositories: Python 102, Go 44, TypeScript 27, JavaScript 17, Rust 12, C# 9, C++ 5, C 4 and Java 2.

**How the change under review is built.** The bug-introducing commit's diff, with no context lines and without CLAUDE.md, AGENTS.md or .claude/ paths, is reverse-applied at the fix's base commit, one file at a time, with `git apply -R --unidiff-zero --reject`. A hunk that no longer applies is left out and listed. git refuses some files whole and writes no reject file for them: a file the BIC edited that is gone at the base, or a file the BIC created that later commits extended. A file the BIC created is then reversed as one plain hunk that removes the BIC's lines where they still stand, and any file still refused is left out and listed with all its hunks. Renames are read as a delete and an add, so a renamed file's hunks are kept or listed like any other. The change under review is the diff from that tree back to the fix's base, so the reviewer sees the code that shipped with the bug, as it stood just before the fix. Across the 222, the median unit keeps 85% of its BIC's hunks; 62 keep all of them and 160 leave at least one out. The median change is 100.5 lines (quartiles 45.5 and 326); 15 change 10 lines or fewer. The median BIC is 180 lines and sits 93 commits before the fix's base.

**Why no context lines.** With git's default 3 lines of context, 191 of 244 drops at the last gate kept some hunks but none of the bug's lines, because later commits had edited the lines around them. Reapplying with no context took the known and V2.1 rows from 139 passes to 201 and kept every one of the 139 that passed before. Rows dropped before the reapply step (the first three gates) don't depend on it, so their records were carried over from the first count rather than recomputed.

**A recount after review.** Review found two ways the first count lost part of a BIC without a trace. The rebuild ignored git's exit status, so a file git refused whole left no reject file: its hunks dropped out of the change under review, were never listed and still counted as kept. And the file list came from `git diff --numstat` with rename detection on, which prints a renamed file as `old => new`, a name no file has. Review also found that the diff readers took a line inside a hunk that starts with `+++` or `--- ` for a file header. All three are fixed, and all 679 rows were recounted from the same pool and fix patches with no model called. The first three gates come out the same for every row: every BIC, share and size above stands. One V2.1 row moves from E_SR_PR_MISSES_BUG to a pass (dapr__components-contrib-1807, whose BIC created the file with the bug: the first count kept 1 of its 13 blamed lines, the recount keeps all 13). The change under review is different for 10 of the 221 rows that passed before, and the kept and left-out hunk counts are different for 66 of them, because hunks that had silently vanished are now kept or listed. The first count also gave 12 for pstack-checks' published units; its labels file holds 15.

## Labels: 36 in hand, 186 to buy

All 36 known and labelled units that pass the BIC gates already carry both labellers' defect and state-shaped answers: 28 from the state machines eval's records and 15 from pstack-checks' published test units (7 of them in both). All 36 are state-shaped. The 186 V2.1 units have no labels. At pstack-checks' measured price ($19.89 for 279 label packets) they cost about $13.

## What the draw is likely to get

| Step | Low | Central | High | Basis |
|---|---:|---:|---:|---|
| State-shaped V2.1 units | 19 | 33 | 46 | 186 at 10%, 17.6% (the state machines eval's rate: 101 of 575 sent) and 25% |
| Known and labelled units kept by the oracle | 16 | 16 | 17 | 7 kept by the state machines eval's oracle at the same fix base, 9 pstack-checks test units, 1 never run; 19 failed it there |
| V2.1 units kept by the oracle | 7 | 12 | 28 | 36% (that eval's walk: 100 of 275) to 60% (V2.1 ships validated fail-to-pass tests) |
| Kept by the harmless-edit check | 90% | 90% | 90% | |
| Drawn units | 21 | 25 | 40 | |
| Counted units after 6 pilot units | 15 | 19 | 34 | |

So the counted run most likely has about 19 units, just under the 20 this plan needs, and could have as few as 15 or as many as 34. The state machines eval's oracle verdicts are a guide, not a record for this eval: this eval runs its own oracle on every drawn unit.

## Files

Kept off the repository, in the eval's handoff folder, by sha256:

- pool.json `640abb032308b158ddc372e49019d1dabceac92ccd4b7b7c90baa00e1c2f6137` (679 rows)
- bic.jsonl `4616231c8fe2f406ba752d9677f4f17a77c6eccea9db603dddfc2aae746a338c` (679 sr-bic.v1 records, from the recount below; the first count's file is kept beside it as bic-first-count.jsonl, `2519a923fe24ee8d77ce02104e12da3ecec2fafc8adf76de2b83083148b8d0ea`)
- labels-sm.json `e623e22782a0ffd6657a48b64e8f450d3a465ea7ec124b478d7ab04994073a89` (28 units)
- labels-358.json `80f00631251fcad64a71ff817af5a9990aefc3ce6a7b47e4cf8a73b76e80d2ae` (15 units)
