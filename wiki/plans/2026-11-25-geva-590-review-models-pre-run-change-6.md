---
id: 2026-11-25-geva-590-review-models-pre-run-change-6
kind: plan
title: "Pre-run change 6 to the review-models eval: people answer one question per review, and the labels line rises to $650"
summary: "Person labellers mark which finding names the bug, none, or can't tell, once per review; the labels item rises to $650 and the all-in caps to $6,748 and $15,328."
author: GEVA-590
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-25
status: done
links:
  - wiki/plans/2026-11-24-geva-590-review-models-prereg/README.md
  - wiki/plans/2026-11-25-geva-590-review-models-pre-run-change-5.md
---

# Pre-run change 6 to the review-models eval

## In short

- Each person labeller answers one question per review: which numbered finding names the bug, or none does, or they can't tell, with a one-line reason. Change 5 had them answer for every finding.
- The labels item rises from $400 to $650. The staged all-in cap becomes $6,748. The full path's becomes $15,328, and it stays gated on Garry.

This change governs where it and the preregistration or earlier changes differ. It applies before any paid call. It changes no scored measure, arm, model or decision-table row.

Ruled by the gstack-evals Captain (GEVA-2), 2026-11-25: "G1 and H1, do it. The labels cap goes to $650. The staged all-in cap becomes $6,748, and the full path $15,078 becomes $15,328, still gated on Garry. Replacement seats come back to me if you need one."

## 1. One question per review

The primary score is per review: a review scores 1 when any finding names the unit's bug (section 4). Carbon rules on each finding, and the judge check compares its per-review score with the people's. A per-review question gives the people's label for exactly that score, and it still identifies which finding matched. It takes about 5 minutes an item instead of about 8, which a per-finding sheet needs.

Each item shows the bug's evidence, the real fix and the review's numbered findings, normalised and blind to arm as in change 5. The labeller picks one of three answers:

- finding number N names the bug (more than one number allowed);
- no finding names it;
- can't tell.

Can't tell counts as not naming the bug, with a second reading that counts it as naming, as section 4 reads Carbon's can't tell. Adjudication and the R78 gate are as change 5 says.

## 2. Money

The desk prices by the minute. At about 5 minutes an item, plus an adjudication pass of about 10 items, each batch of about 50 reviews is about 5 hours a seat. At $25 an hour that is $125 a seat, 2 seats, and $295 a batch with RentAHuman's 18% fee. The pilot and validation batches come to $590. The labels item also carries the contamination second read.

| Item | Before | After |
|---|---|---|
| Labels and adjudication | $400 | $650 |
| Staged all-in cap | $6,498 | $6,748 |
| Full-path all-in cap, gated on Garry | $15,078 | $15,328 |

A replacement seat after a rejected return is not in this line. It goes to the Captain first.
