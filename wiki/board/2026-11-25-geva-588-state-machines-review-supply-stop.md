---
id: 2026-11-25-geva-588-state-machines-review-supply-stop
kind: finding
title: "The State Machines review specialist eval stopped on supply before any paid call: the specialist runs on about 3 in 100 real state bugs, and too few usable bugs exist to test it"
summary: "NO READ on supply. Detector fires on 6 of 222 real state-bug changes. Projected counted run 19, under the floor of 20. Sol untestable at the pin. No paid call ran."
author: GEVA-588
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-25
status: done
links:
  - garrytan/gstack-evals#451
  - "branch sr-prereg-geva-588 (the preregistration and harness, closed unmerged; bic.ts fixes and tests reusable)"
  - https://github.com/garrytan/gstack/blob/d74ee528b6df9ddb945be2103a24544babe76e65/scripts/resolvers/review-army.ts#L343
  - 2026-11-17-geva-521-pstack-checks-results
  - 2026-11-09-geva-409-state-machines-prompt-prereg
---

# The State Machines review specialist eval stopped on supply

- We learned that gstack's State Machines review specialist almost never runs on real state bugs. The detector that decides whether /review dispatches it fires on 6 of 222 real bug-introducing changes (2.7%). These are changes their projects later fixed as state bugs. You should read shipped /review as running without the specialist on about 97 of 100 real state bugs. A detector that fires more often matters more than anything inside the specialist.
- We learned that real, buildable, state-shaped bug-introducing changes are scarce. After a recount, 222 of 679 candidate fixes pass the gates, and the projected counted run is 19 units, under the preregistered floor of 20. So the eval didn't run. The verdict is NO READ on supply. It is not a null result, and no cut follows from it.
- We learned that GPT-6.2 Sol can't be tested at the gstack pin: gstack gives Codex hosts no specialists at all (scripts/resolvers/review-army.ts line 343 returns an empty string for host codex).
- We learned that rebuilding a change from git history is easy to get silently wrong. Review caught a bug that dropped parts of changes without a trace. The four fixes below apply to any eval that rebuilds a change with git apply.

The question was whether gstack /review with the State Machines specialist forced on leaves a test that catches a real state bug more often than /review with the specialist removed. The plan also had a plain review, the specialist's steps in plain words, and pstack, on Opus 5.5 and particle-1. Each arm would be scored by rerunning the failing test the reviewer leaves.

## What works

- **The stop rule.** Before any spend, the plan said that a projected counted run under 20 units means a findings post, not a run. The projection is 19, so nothing was leased and no paid model call ran.
- **Review of the supply code.** The final review of the preregistration found the rebuild bug described below before any number was frozen. The fix and a full recount took under an hour, on one 16-vCPU VM that is now destroyed.
- **The harness.** A keyless dry run on a real unit passes 54 of 54 checks at the final code. It drives the session image, both gstack homes, exposure reading, scoring, the analysis and the one look. That code stays on the branch for reuse.

## What didn't work

### The specialist rarely runs

Shipped gstack dispatches the specialist when its detector finds both a subject word (proposal, hold, approval, pending) and an action word (accept, approve, reject, release and the like) in the added code. On this pool:

| Diff | Detector fires |
|---|---:|
| The change under review, for the 222 that pass the gates | 6 of 222 |
| The full bug-introducing commit, for those 222 | 12 of 222 |
| Every bug-introducing commit that passed the share and size gates | 25 of 424 |

That's why the plan compared specialist forced on against specialist removed: measuring shipped gstack against removal would mostly measure the detector's rarity. The rarity also lowers the value of the question. Even a clear win for the specialist would change shipped /review on about 3 reviews in 100 until the detector changes.

### Too few usable bugs

The pool had 679 fixes: 41 known state bugs from earlier evals, 67 rows that both labellers of the state machines prompt eval marked a state-shaped defect, and 571 screened SWE-rebench-V2.1 rows (at most 3 per repository). For each fix, SZZ finds the commit that brought the bug in (the BIC). The gates then drop a fix with no BIC, a BIC that wrote under half the blamed lines, a BIC over 2,000 lines, and a rebuilt change that brings back under half the BIC's own blamed lines.

| Gate | Known | Labelled | V2.1 | All |
|---|---:|---:|---:|---:|
| No BIC | 1 | 0 | 8 | 9 |
| BIC wrote under half the blamed lines | 5 | 18 | 142 | 165 |
| BIC over 2,000 lines | 7 | 8 | 66 | 81 |
| Rebuilt change misses the bug | 12 | 21 | 169 | 202 |
| Pass | 16 | 20 | 186 | 222 |

After the labels, the oracle (the fix's tests must fail before the fix and pass after it) and a harmless-edit check, the projection was:

| Step | Low | Central | High |
|---|---:|---:|---:|
| State-shaped V2.1 units (186 at 10%, 17.6% and 25%) | 19 | 33 | 46 |
| Known and labelled units the oracle keeps | 16 | 16 | 17 |
| V2.1 units the oracle keeps (36% to 60%) | 7 | 12 | 28 |
| Drawn units, after a 90% harmless-edit check | 21 | 25 | 40 |
| Counted units after 6 pilot units | 15 | 19 | 34 |

The central figure is under 20. The minimum detectable difference at 20 units would have been 15.7 to 18.4 points, so supply was the binding limit, not the power math.

### Sol can't be tested

At the pinned gstack (d74ee528), review-army.ts line 343 returns no specialists when the host is codex. Under Codex CLI, /review never reaches the State Machines specialist, forced or not, so GPT-6.2 Sol was left out.

## The recount

The change under review is built from the BIC's diff, with no context lines and without agent instruction files, reverse-applied at the fix's base commit with `git apply -R --unidiff-zero --reject`. A hunk that no longer applies should be left out and listed.

The final review found that the harness ignored git's exit status and only counted .rej files as left out. git refuses some files whole and writes no .rej for them: a file the BIC edited that is gone at the base, or a file the BIC created that later commits extended (git won't delete a file whose contents it doesn't fully match). Those hunks vanished, were never listed, and still counted as kept. A second review reader found that renamed files were lost too, because `git diff --numstat` prints them as `old => new`, a path no file has. A review of the fix then caught a regression: a file name with a space made the reject lookup miss its .rej file.

All 679 rows were recounted after the fixes:

| Figure | First count | Recount |
|---|---:|---:|
| Pass the gates | 221 | 222 |
| Rebuilt change misses the bug | 203 | 202 |
| Repositories among passes | 195 | 196 |
| Median share of BIC hunks kept | 89% | 85% |
| Units keeping every hunk | 68 | 62 |
| Units leaving some out | 153 | 160 |
| Change size quartiles, lines | 44 / 100 / 324 | 45.5 / 100.5 / 326 |
| Changes of 10 lines or fewer | 15 | 15 |
| Detector fires on the change under review | 6 | 6 |
| pstack-checks labels in hand | 12 (miscounted) | 15 |
| Projected counted units | 14 / 19 / 34 | 15 / 19 / 34 |

The first three gates came out the same for every row. One row moved to a pass: its BIC created the buggy file, and the first count kept 1 of its 13 blamed lines, against all 13 in the recount. The change under review differed for 10 of the 221 earlier passes, and the kept and left-out counts differed for 66. The errors were real but small, and they didn't move the central projection.

## A reusable lesson: rebuilding a change from git history

Any eval that reverse-applies an old commit onto a later tree should do these four things:

1. **Check git apply's result per file.** Apply each file of the diff on its own. A file that fails with no .rej was refused whole, so list all its hunks as left out. A missing .rej doesn't prove the hunks applied.
2. **Rebuild created files from plain hunks.** When git won't reverse a file the old commit created (because later commits extended it), retry it as a plain hunk that removes the commit's lines wherever they still stand.
3. **Turn rename detection off.** Use `--no-renames` for the file list and the diff, so a rename is a delete plus an add with real paths, never `old => new`.
4. **Take file names from `git diff --name-only -z`, not from diff headers.** git writes a name with a space with a trailing tab in its `---` and `+++` lines and quotes unusual names, so a header parser looks for the wrong .rej file.

Each fix has a keyless test on a scratch repository that fails on the old code (tests/outcome-skills/sr-core.test.ts on branch sr-prereg-geva-588).

## What would reopen it

- **A wider source of state bugs.** Lifting V2.1's per-repository cap from 3 to 5 adds only 26 rows, about half a counted unit at the measured rates. So it needs a new source: a looser V2.1 screen, the SWE-rebench leaderboard export (7 rows this run lacked), or another dataset of fixes with buildable images.
- **A detector that fires more often.** If gstack's detector dispatched the specialist on a real share of state-bug changes, the question would be worth more, and shipped gstack could be compared with removal directly.
- **Codex specialists.** A gstack change at review-army.ts line 343 would let Sol into a later version.

## Cost

No paid model calls. About $74 of agent model use (169M tokens at list price) went into the preregistration, the harness, its review and the recount, plus about 35 minutes of one 16-vCPU Ubicloud VM.

## Files

The pool, both BIC record files and the label files are kept off the repository, by sha256:

- pool.json `640abb032308b158ddc372e49019d1dabceac92ccd4b7b7c90baa00e1c2f6137` (679 rows)
- bic.jsonl from the recount `4616231c8fe2f406ba752d9677f4f17a77c6eccea9db603dddfc2aae746a338c` (679 records)
- bic.jsonl from the first count `2519a923fe24ee8d77ce02104e12da3ecec2fafc8adf76de2b83083148b8d0ea`
- labels-sm.json `e623e22782a0ffd6657a48b64e8f450d3a465ea7ec124b478d7ab04994073a89` (28 units)
- labels-358.json `80f00631251fcad64a71ff817af5a9990aefc3ce6a7b47e4cf8a73b76e80d2ae` (15 units)

The preregistration bundle, the harness (lanes/outcome-skills/smreview/) and the dry run are on branch sr-prereg-geva-588 at 83741bcb.
