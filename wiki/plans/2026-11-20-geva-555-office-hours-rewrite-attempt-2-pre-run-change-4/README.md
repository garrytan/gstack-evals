---
id: 2026-11-20-geva-555-office-hours-rewrite-attempt-2-pre-run-change-4
kind: plan
title: "Pre-run change 4 to the second office-hours rewrite eval: authoring ends with 6 of 8 reserves"
summary: "Ends authoring with all 88 required briefs and 6 of the 8 reserves, leaves the T1 reserve pair unfilled, and says how a later drop is counted with no new authoring."
author: GEVA-555
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-20
status: open
links:
  - wiki/plans/2026-11-18-geva-555-office-hours-rewrite-attempt-2-prereg/README.md
  - wiki/plans/2026-11-18-geva-555-office-hours-rewrite-attempt-2-pre-run-change-1/README.md
  - wiki/plans/2026-11-19-geva-555-office-hours-rewrite-attempt-2-pre-run-change-3/README.md
  - lanes/office-hours-rewrite/
---

# Pre-run change 4 to the second office-hours rewrite eval

## In short

- Authoring is over. All 88 required briefs are placed: the 8 calibration briefs and the 80 comparison briefs. So are 6 of the 8 reserves: the T4 reserve pair, the T7 and T8 reserves, and both builder reserves.
- The T1 reserve pair is left unfilled. The last 72 drafts, all drawn for it, placed nothing, and a reserve only matters when a comparison brief drops later. The eval's owner decided on 2026-11-20 to stop there rather than draw on to the cap.
- No brief will be authored for this eval again. A later drop with no reserve of its kind counts as missing, and the results report it.
- $160.02 of the $409 authoring item is unspent. This change moves it nowhere.

This change governs where it and the plan or an earlier change differ. It changes no arm, model, judge, measure, threshold, item cap, ledger item or decision row, and no stop rule except as section 2 says. It is made before any arm session has run.

## 1. How authoring ended

Section 5.6 of the plan has the reserves draw after calibration and comparison are full, until they are placed or the cap stops them. After 762 drafts, every slot was full except the T1 reserve pair. The run was stopped, then closed with one resume whose spend cap equalled what the item had already committed. Under the batch rule (a batch starts no more drafts than the cap less the spend covers at $3.50 each), that resume started no draft. It ended as a cap stop after calibration and comparison were full, which section 5.6 treats as the end of authoring only:

- the briefs already placed were written and sealed;
- there is no halt;
- the cap stop is final, so authoring can't resume.

The closing resume made no model call.

At the end, one T1 partner (a first twin that passed, with no matching second twin yet) was still open. Section 5.3 drops it, so pairs stay whole and nothing from the T1 reserve pair is placed.

## 2. A comparison brief that drops later

Section 5.6 already says a comparison brief that drops later with no reserve of its kind counts as missing. A reserve replaces a dropped brief by kind (pair, unpaired founder or builder), not by type, and takes the dropped brief's skin (lanes/office-hours-rewrite/author/README.md, rule 29). So the shortfall is one pair-kind reserve, whichever type drops:

| Kind | Reserves planned | Reserves placed | What a later drop gets |
|---|---|---|---|
| Pair | 2 pairs (T1, T4) | 1 pair (T4) | The first pair-kind drop takes the T4 reserve pair. Any further pair-kind drop has no reserve and counts as missing. |
| Unpaired founder | 2 (T7, T8) | 2 | As planned |
| Builder | 2 | 2 | As planned |

A brief that counts as missing is a missing cell under section 8's limits, unchanged. Nothing is re-drafted to fill it. Section 8's stops are also unchanged: a missing limit passed still reads INCOMPLETE.

## 3. Reporting

Section 9's list gains three lines:

- the unfilled T1 reserve pair, and that the last 72 drafts were drawn for it;
- every comparison brief that dropped after authoring, the reserve that replaced it, or that none was left;
- every brief counted missing for want of a reserve.
