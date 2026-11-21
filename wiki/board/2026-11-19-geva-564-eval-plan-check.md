---
id: 2026-11-19-geva-564-eval-plan-check
kind: decision
title: The wiki check refuses a new preregistration or results page that skips the eval-loop practices
summary: "New preregistrations must name the decision, pilot every arm, check the judge and plan one look above $500; quick looks carry a three-line plan; results pages carry the call they settled."
author: GEVA-564
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-19
status: done
links:
  - wiki/README.md
  - scripts/wiki.ts
  - tests/wiki-practices.test.ts
---

# The wiki check refuses a new preregistration or results page that skips the eval-loop practices

## Decision

Garry asked that every eval follow the team's eval-loop practices, and that the repo enforce them so nobody has to remember. From this change, `bun run wiki:check`, which CI runs on every pull request, fails a new preregistration that lacks any of these:

1. the decision the result changes, with what we do for each way it could come out;
2. a pilot for every arm, capped at a tenth of that arm's budget, that shows on the arm's own outputs that the part under test ran, that the judge passes its check there, and that the tasks can be supplied;
3. when a model judge scores the run, its check: at least 40 labelled outputs, a kappa of at least 0.6, a judge from another lab than the models it scores, and its errors read per arm;
4. when the largest counted run is planned above $500 paid, one look at half the units, with stop bounds fixed in the plan and no other look.

A quick look (at most $100 paid, one day) is exempt, but must carry its question, decision and stop rule. A new results page must carry one line with the ship-or-kill call it settled, or "none". Its paid and meter cost go in the experiment's private registry row, not on the public page.

The format is in wiki/README.md, under "Eval plans and results": four headings and a few labelled lines. The check reads only those, never free prose.

## Why it lives in wiki:check

The wiki check already runs in CI with no keys, already compares the tree with the base branch, and already knows which posts are merged. A separate command would need its own CI step and its own place in the ship checks for no gain.

## Old posts stay closed

A post that is already on the base branch is never checked. We chose this over a date cutoff because a post's date is written by its author, while the base comparison comes from git. A date cutoff would also catch or miss posts in pull requests that are open when this lands, depending on the date each author typed. When there is no base to compare with (`--base none`, or a push that created its branch), the eval plan checks do not run, the same as the merged-post checks.

## What it does not check

It doesn't check that a pilot row exists for every arm the plan describes elsewhere, because the arm list is only the table. It doesn't judge whether a decision is a real decision. Reviewers still read for both.
