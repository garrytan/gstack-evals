---
id: 2026-11-25-geva-590-review-models-pre-run-change-5
kind: plan
title: "Pre-run change 5 to the review-models eval: two people label the judge check, not models"
summary: "Under R124, two people make the 100 judge-check labels through a labelling desk; a model only supports adjudication; labels rise to $400 and the all-in caps by $200."
author: GEVA-590
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-25
status: open
links:
  - wiki/plans/2026-11-24-geva-590-review-models-prereg/README.md
  - wiki/plans/2026-11-24-geva-590-review-models-pre-run-change-1/README.md
  - wiki/plans/2026-11-25-geva-590-review-models-pre-run-change-2.md
---

# Pre-run change 5 to the review-models eval

## In short

- Two people label the 100 judge-check reviews, fix-aware and blind to arm, through a paid labelling desk. Claude Opus 5.5 and GPT-6.2 Astra no longer make labels. Both are model families under test, and model-made labels are the setup that failed against people elsewhere.
- A model may support adjudication with a neutral summary of the two people's reasons. It never makes or proposes a label.
- The labels item rises from $200 to $400. The staged all-in cap rises by the same $200, to $6,498, and the full path to $15,078, which stays gated on Garry.

This change governs where it and the preregistration or earlier changes differ. It applies before any paid call. It changes no scored measure, arm, model or decision-table row.

Ruled by the gstack-evals Captain (GEVA-2), 2026-11-25, under R124 and an audit of model-made labels across the crew's evals. The Captain's words:

> 1. The 100 judge-check reviews are labelled by two people through FOUN-32's labelling desk (R72, org research/desk/), fix-aware and blind to arm.
> 2. A model may still do adjudication support. It doesn't make the labels.
> 3. The labels item cap rises from $200 to $400.
> 4. The staged all-in cap rises by the same $200, to $6,498. The full path goes to $15,078, and it's still gated on Garry.
>
> The pilot can run on schedule. Carbon's numbers count only once the person labels pass R78. If the labels are late, the counted run waits for them.

## 1. Who labels

The preregistration's Judge check had two labellers, Claude Opus 5.5 and GPT-6.2 Astra, read each review fix-aware and blind to arm. Two people now do that, through the organisation's labelling desk (R72). The judge check's design is otherwise unchanged:

- Each person sees, per review, the bug's evidence, the real fix, and the review's findings as one numbered list. Model names, voice headers and severity words are normalised away, as in the list Carbon sees. For each finding they answer: names the bug, doesn't, or can't tell. They give a short reason.
- The 100 labelled reviews are the pilot's 50 bug-unit reviews and the validation batch's 50 or 51 (change 2). Decoys are not labelled for the judge check.
- Disagreements go back to the same two people with each other's labels and reasons, once. A model may write a neutral side-by-side summary of the two people's reasons for that round. It never proposes a label, and its output is never read as one. An item still unsettled after that stays in the check and is read both ways, as change 2 says.
- Carbon's kappa against the adjudicated person labels must reach 0.6 on the 100 before any counted review is read (R78). Its errors, abstentions and empty replies print per arm and per pool.

Labelling packets carry the real fixes and, for new B units, the advisory each bug comes from. Those are answer keys until the run ends. The packets go to the desk under its terms, and nothing from them enters this repository before the results.

## 2. Timing

The pilot runs on schedule. Its readout reports each arm's judge column as waiting on person labels until they arrive. The other pilot gates (part ran, supply, cost) and the staged rule do not need labels. Carbon's numbers count only once the person labels pass R78. If labels are late, the counted run waits for them.

## 3. Money

| Item | Before | After |
|---|---|---|
| Labels and adjudication (people, plus the contamination second read) | $200 | $400 |
| Staged all-in cap (Fable leaves at the pilot) | $6,298 | $6,498 |
| Full-path all-in cap, gated on Garry | $14,878 | $15,078 |

The model labeller calls the $200 line paid for no longer run.
