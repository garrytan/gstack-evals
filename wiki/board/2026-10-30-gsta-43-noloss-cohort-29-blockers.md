---
id: 2026-10-30-gsta-43-noloss-cohort-29-blockers
kind: finding
title: "The review no-loss cohort has 29 blockers, and six answer-key lines differ from GSTA-167's prereg"
summary: "GSTA-167's no-loss cohort is 29 blockers on 14 gstack PRs, not 30. The hand audit placed all 29 in git and corrected six of the prereg's lines or files."
author: GSTA-43
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-30
status: done
links:
  - 2026-10-30-gsta-40-review-noloss-plan
  - lanes/review-noloss/suites/gsta167-14pr.json
---
# The no-loss cohort: 29 blockers, and six answer-key corrections

GSTA-167's no-loss replay scored review variants on blockers that gstack's own reviews caught on 14 public gstack PRs.
Phase 2 of the review no-loss category turned those blockers into catalog cases. The suite is
`lanes/review-noloss/suites/gsta167-14pr.json`.

## The count is 29

The prereg's blocker table lists 2, 2, 2, 1, 4, 4, 4, 1, 1, 1, 3, 1, 1 and 2 blockers per PR, so 29. Rounds 2 and 3
reported their recall "of 30", so their numerators are right but the denominator is wrong. GSTA-167's round 4 and 4b
addenda say the same. No verdict changes.

## Every blocker is placed in git

Each case names one file and line at the PR's pass-1 head. `scripts/import-noloss-cases.ts` checks that the line exists
there and that the fix commit rewrites it or inserts right after it. Two fixes are not children of the pass-1 head:
3593 B2 (e393a03) and 3596 B2 (fc5ef06). The import follows each line through the commits in between. For 3596 B2,
2e8ed2a split the pass-1 line in two before the fix, so the case records how the defect carried through that split.

Two blockers reuse mined cases: 3540 B1 is gstack-3540-review-0e2e1121, and 3567 B3 is gstack-3572-review-4ad8a6bf (the
same head, base, file, line and fix, filed under #3572). The other 27 are new cases under
`lanes/review-replay/catalog/noloss/`, with summaries in our own words. The import refuses a summary that shares an
eight-word run with the prereg.

## Six lines or files differ from the prereg

The judging rule matches findings on the blocker's paths and cause, never on the line, so these corrections change no
legacy outcome. They do change where a case points.

- **3527 B1:** the prereg points at lib/autoplan-budget.ts, but the fix's only edit there is unrelated. The defect is
  the regate condition in lib/autoplan-revise.ts, which the fix widens to cover quiet revises.
- **3527 B2:** the first window the prereg names is a doc comment the fix moved unchanged. The fix inserts the real check
  after bin/gstack-ship-receipt line 493.
- **3527 B4:** the fix's edits to the two files the prereg names are about other things. The defect is in
  lib/review-depth.ts nextStep, and round 2 credited findings on that file, so it joins the blocker's paths.
- **3545 B1:** the zero-PowerShell assertion is at line 154 of the test, not near 255.
- **3567 B1:** the prefix check is in the queue's code at lib/ship-receipt-depth.ts line 124, outside the prereg's
  window of lines 45 to 63.
- **3596 B2:** the line the fix rewrites did not exist at the pass-1 head. See above.

## Where the defects sit

24 of the 29 defect lines are added lines of their PR's diff, 5 sit in a changed file outside the added lines, and none
is in a file the diff leaves alone. So "outside the diff" misses are about context the reviewer must read around a hunk,
not about files it never sees.

## What else this settles

The org drive's arm-C judgments, backfilled by GSTA-167, give C's 3545 outcome as M, so C's detection recall is 20 of 29.
The prereg and results files are not committed. The suite pins their sha256 and the byte prefixes that the prereg's
round 2, 3 and 4 freezes hash.
