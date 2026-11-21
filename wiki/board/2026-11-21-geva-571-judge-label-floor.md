---
id: 2026-11-21-geva-571-judge-label-floor
kind: decision
title: New preregistrations check a model judge against at least 100 labelled outputs
summary: "From plans dated 2026-11-22, wiki:check asks a judge check for at least 100 labelled outputs instead of 40. Kappa stays at 0.6, and plans dated earlier keep 40."
author: GEVA-571
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-21
status: done
links:
  - 2026-11-19-geva-564-eval-plan-check
  - wiki/README.md
  - scripts/wiki.ts
  - tests/wiki-practices.test.ts
---

# New preregistrations check a model judge against at least 100 labelled outputs

## Decision

A model judge's numbers count only after it agrees with labelled outputs: a kappa of at least 0.6. Garry approved raising the number of labelled outputs that check needs from 40 to 100, for plans frozen from 2026-11-22. His words, on 2026-11-21: "Do it". Kappa stays at 0.6, and nothing else in the judge rule changes: the judge still comes from another lab than the models it scores, and its errors are still read per arm.

`bun run wiki:check` now enforces it. A new preregistration dated 2026-11-22 or later fails unless its Judge check says `Labelled outputs: 100` or more. One dated earlier still needs 40. The error names the floor that applied and why. This changes item 3 of [the eval-plan check decision](2026-11-19-geva-564-eval-plan-check.md); the rest of that decision stands.

## Why 100

Forty labels measure kappa loosely. Take two balanced labels and a measured kappa of 0.6: the usual large-sample 95% interval is about 0.35 to 0.85 at 40 labels, and about 0.44 to 0.76 at 100. At 40, a judge can pass the check while its true agreement sits well under the bar. The exact width depends on how the labels split, so read these as an example, not a bound.

## Why the plan's date sets the floor

The check has no field for the day a plan was frozen. Every post already carries `date`, the UTC day it was written, and its id must start with that date. So the floor follows that date. A plan written on 2026-11-21 keeps 40 even if it merges later. That is on purpose: it was written before the rule.

Two other ways were turned down. The day the check runs would make the same tree pass on one day and fail the next, so a CI result could not be reproduced. A new `frozen:` field would add a second date that authors must keep right, for one rule.

The eval-plan check decision chose git, not dates, to decide which posts are checked at all. That still holds: posts already on the base branch are never checked, so merged plans never start failing. The date only picks the floor for a post the check already reads.

## Known limit

An author could write an earlier date to keep the 40 floor. The check can't tell. It is visible, though: the id must match the date, and both show in the pull request, so a plan dated before the day it was opened stands out in review. A reviewer who sees a preregistration dated 2026-11-21 or earlier, opened on 2026-11-22 or later, should ask why.
