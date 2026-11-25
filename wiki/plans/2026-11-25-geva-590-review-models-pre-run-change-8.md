---
id: 2026-11-25-geva-590-review-models-pre-run-change-8
kind: plan
title: "Pre-run change 8 to the review-models eval: engineers label the judge check, one on all 100 and a second on 30"
summary: "Coding labels come from engineers with proof of skill. One engineer labels all 100 judge-check reviews, a second labels a seeded 30-review subset, and splits on the subset go to a third engineer. The rate is not set yet."
author: GEVA-590
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-25
status: open
links:
  - wiki/plans/2026-11-25-geva-590-review-models-pre-run-change-5.md
  - wiki/plans/2026-11-25-geva-590-review-models-pre-run-change-6.md
  - wiki/plans/2026-11-25-geva-590-review-models-pre-run-change-7.md
---

# Pre-run change 8 to the review-models eval

## In short

- The person labels for the judge check come from engineers, not general hires. Each engineer shows proof: a work history or a GitHub account with real commits, and a short code task that we check.
- Engineer A labels all 100 judge-check reviews. Engineer B labels a seeded subset of 30 of them. Where A and B split, engineer C labels that review blind, and the label is the majority of three, as change 7 says.
- The rate is not known yet. If the labels line passes $650, it goes back to the gstack-evals Captain before any label is bought.

This change governs where it and changes 5 to 7 differ. It applies before any paid call. It changes no scored measure, arm, model or decision-table row. The counted run still waits for the labels.

## Why

Garry ruled on 2026-11-25 (R125, relayed by the organisation's workflow thread) that coding labels need engineer graders. Change 5 had two general hires label every review. Engineers cost more per hour, so the gstack-evals Captain chose on 2026-11-25 to keep one engineer on every review and check that engineer against a second on a subset, instead of buying two full passes.

## The rule

1. **Seat A** labels every review in both batches, answering change 6's question for each one.
2. **Seat B** labels a subset of 15 reviews per batch, 30 in all. The subset is 3 reviews per arm in each batch, drawn with seed 1872089902 over each arm's sorted opaque review ids. If a batch has fewer arms in its proceed set, it still takes 15, spread as evenly as the arms allow.
3. **Seat C** labels only the subset reviews where A and B split, in the follow-up package from change 7, blind to the first answers and to who gave them. The label is the answer at least two of the three gave. A review with no majority, or a can't-tell majority, is unresolved and is read both ways, as change 2 says.
4. Every review outside the subset takes seat A's label.
5. Can't tell still counts as not naming the bug, with a second reading that counts it as naming (change 6).
6. Seat A, seat B and seat C are three different people. None sees graders, models, arms, earlier answers or other labellers.

## What the readout adds

Beside the judge's kappa against the final labels on all 100 reviews, the readout prints how often A and B agreed on the 30-review subset, with their kappa. That number shows how far one engineer's label can be trusted. It is descriptive and gates nothing, and the judge's threshold of 0.6 is unchanged.

## What this leaves open

Seventy of the 100 reviews rest on one engineer's label. The A-vs-B agreement on the subset is the only check on that engineer, and a subset of 30 gives a wide interval on it. The readout states both plainly.

The source and the rate come from the organisation's labelling desk. The earlier price of $650 assumed general hires at the desk's rate; engineers may cost two or three times that.
