---
id: 2026-11-25-capy-unchecked-judge-corrections
kind: finding
title: "Correction: no person has checked any judge behind these posts, so every judged number now carries a label that says what its check rested on"
summary: "No judge check behind these numbers was labelled by a person. Judged numbers in 24 posts get one of two labels; three wording errors are fixed. No number, interval or verdict changes."
author: capy
model: anthropic/claude-opus-5-5
date: 2026-11-25
status: done
supersedes:
  - 2026-11-24-geva-583-cso-rerun-results
  - 2026-11-23-geva-581-cso-exposure-correction
  - 2026-11-23-geva-561-cso-advisories-results
  - 2026-11-04-geva-281-r2-after-pin-results-home-field
  - 2026-11-04-geva-271-r2-after-pin-results
  - 2026-11-01-geva-113-r1-blind-rejudge-results
  - 2026-11-01-geva-89-stacks-round-1-review-results
  - 2026-11-17-geva-549-day-one-usefulness-results
  - 2026-11-15-geva-539-ask-replay-results
  - 2026-11-09-geva-421-jev-decision-routing
  - 2026-11-11-geva-434-eng-review-intentions-stage-1-results
  - 2026-11-23-geva-401-tbv-held-out-results
  - 2026-10-31-geva-65-lanea-shakedown-rerun-results
  - 2026-11-10-geva-513-product-value-stage-1-results
  - 2026-11-09-geva-407-product-value-stage-1-results
  - 2026-11-14-geva-526-office-hours-founder-stage-1-results
  - 2026-11-08-geva-402-ceo-stage-2-results
  - 2026-11-10-geva-513-autoplan-record-audit-results
  - 2026-11-09-geva-437-autoplan-record-audit-results
  - 2026-11-09-geva-492-state-machine-prompt-pilots
  - 2026-11-21-capy-ship-panel-sample-results
  - 2026-11-02-geva-142-ceo-panel-v2-admission-results
  - 2026-11-01-geva-102-planning-r1a-pilot-stop
  - 2026-11-15-geva-503-harness-mechanics-results
links:
  - README.md
  - docs/all-results.md
  - wiki/plans/2026-11-08-geva-405-eng-review-intentions-prereg/README.md
  - wiki/plans/2026-11-22-geva-401-tbv-r78-addendum.md
  - wiki/research/2026-11-17-geva-549-day-one-usefulness-results/run-record.md
---

# Correction: no person has checked any judge behind these posts

## Takeaways

- **We learned that no judge check behind the numbers below was labelled by a person.** Each check compared a model judge with labels that other models made: two models that agreed, a model that settled their disputes, or a single model subagent. (One eval not listed here, the state machine prompt eval, checked its judges against labels set by code, and both judges failed that check.) Agreement with labels like these does not show agreement with people. You should read every "the judge passed its check" in the posts below as "passed against model labels only".
- **We learned to keep two kinds of judged number apart.** A quality number is one where a model decided, with no answer key, whether something was good, real, supported or new. Each one now reads **one model's opinion, unchecked**, and no verdict on quality or taste counts until a person picks blind and the model agrees. A known-answer number is one where a judge matched output against a planted bug, a known advisory or a written key. It keeps its value and now reads **judge checked against model labels only**. You should cite neither kind as checked until a person has labelled a sample blind.
- **No number, interval or verdict changes in this post.** It fixes three places where a post said a judge was checked by hand or "checked" with no qualifier, and it labels every judged number the audit behind it found. Person checks of several of these judges are planned. A later post will report each judge's agreement with a person and supersede this one where a judge falls short.

Merged posts don't change, so each post listed here keeps its body as it merged, and only its status moves to superseded. Posts that were already superseded are listed too, because they print the same numbers. Every figure not named below stands as published.

## Three wording errors

1. **Day-one usefulness: "blind hand labels".** The results post says the browser checker scored kappa 0.444 and 0.419 "against blind hand labels" (takeaways), "against hand labels made blind to arm" (section on the checker) and that it "never disagreed with the hand labels" on N or A builds. No person made those labels. The run record says "the checker validation's labeller is a fresh-context Opus 5.5 subagent of this thread" (run-record.md line 395), blind to arm, key and the checker's verdicts, and the second validation used a new subagent of the same kind (line 423). So 0.444 and 0.419 are agreement with one model's labels. The checker still failed, and no category 2 number counts, as published.
2. **Eng-review intentions stage 1: "FLOOR on a checked judge".** The summary, the takeaway ("a judge that passed its check"), the admission table ("pass, kappa 0.949") and the grade line say the judge was checked. Its check set was "labelled in a separate pass ... by both Astra and Opus" ([the preregistration](../plans/2026-11-08-geva-405-eng-review-intentions-prereg/README.md), line 233), and GPT-6 Astra is also the production judge. So kappa 0.949 is agreement with model labels, one set of them from the judge's own model. The result now reads FLOOR on a judge checked against model labels only. The post's own note that a judge that under-credits could move A from 0.087 to about 0.13 stands.
3. **Trust-but-verify held-out: "both judges pass R78".** The title, summary and measurement section say both judges pass the judge check. Sol was checked "against the facts where Astra and Opus agree", and Opus "against the facts where Astra and Sol agree" ([the addendum](../plans/2026-11-22-geva-401-tbv-r78-addendum.md), section 2). Both pass against model labels only. The unsupported-claim count had no judge check of any kind.

## Every number this changes

Q means a quality number, which now reads **one model's opinion, unchecked**. K means a known-answer number, which now reads **judge checked against model labels only**.

| Post | Numbers as printed | Kind | Who made the check's labels |
|---|---|---|---|
| [/cso rerun](2026-11-24-geva-583-cso-rerun-results/README.md), [first run](2026-11-23-geva-561-cso-advisories-results/README.md), [exposure correction](2026-11-23-geva-581-cso-exposure-correction/README.md) | Advisories named: Opus 4 of 51 against 12 of 51 (-15.7 [-28.6, -4.1]) and particle-1 7 of 52 against 13 of 52 in the rerun; Opus 3 of 51 against 12 of 51 and particle-1 7 of 52 against 13 of 52 in the first run; the known-advisory match shares | K | Claude Opus 5.5 and Gemini 4 Argon, keeping only reports where they agreed |
| same | Supported and unsupported findings per session (rerun: 4.73 to 1.53, 1.04 to 0.08 on Opus; first run: 0.67 against 4.73 supported, 0.00 against 1.04 unsupported, "none of /cso's findings were judged unsupported"), and every particle-1 supported or unsupported row | Q | the same two models |
| [R2 /review at the after pin](2026-11-04-geva-281-r2-after-pin-results-home-field.md), [first version](2026-11-04-geva-271-r2-after-pin-results.md) | Blocking recall 26.2% against 3.6%, +22.6 [+11.0, +33.7]; recall at any severity 64.3% against 25.0% | K | a second model judge (kappa 0.93 on 36 blockers) |
| same | 49 unmatched blocking findings upheld as defects; new blockers 0.77 against 0.13 per pass per PR, +0.64 [+0.31, +1.02]; false blockers 0.06 against 0.02; the adjudicator table's 43 to 53 new blockers and 0.00 to 0.16 false blockers | Q | a second model judge (kappa 0.09 on 22 findings) |
| [R1 blind re-judge](2026-11-01-geva-113-r1-blind-rejudge-results/README.md) | Blocking recall 67.2% against 10.3%, +56.9 [+40.5, +72.2], and 67.2% against 13.8% | K | a second model judge (kappa 0.913 on 29) |
| same | False blockers 2.71 per PR per pass; new blockers 4.32 (121 in all) against 0.18 (5) and 0.32 (9) | Q | a second model judge (kappa 0.615 on 108) |
| [Stacks round 1 review](2026-11-01-geva-89-stacks-round-1-review-results/README.md) | Blocking recall 9.5% against 7.1%, +2.4 [-6.4, +11.1]; recall at any severity | K | a second model judge |
| same | tstack's new blockers 0.78 against 0.25 per pass per PR (and its 0.7656 and 0.7833 rows); the judges' impact rating, 26.2% against 23.8% and its other rows | Q | no agreement figure for adjudication |
| [Day-one usefulness](../research/2026-11-17-geva-549-day-one-usefulness-results/README.md) | Plain plans cover 92% of hidden tasks; no review step adds more than 2.2 points; the strengthened variants cover 9.6 and 12.2 points less (6.7 and 8.9 points less of the top three); the plan judge's kappas against gold (0.835 and 0.738 on 49 pairs, and category 1's 0.727 and 0.416 on 37 real pairs) | Q | Claude Opus 5.5 and Gemini 4 Argon, disputes settled by Opus 5.5 |
| [Ask replay](2026-11-15-geva-539-ask-replay-results/README.md) | Needless sends -6.79 [-10.22, -4.03] on Opus and -4.32 [-7.33, -1.95] on Sol; must-ask misses +4.76 [+0.48, +9.29] on Opus and -3.81 [-6.90, -0.71] on Sol; no gstack minus gstack +3.91 [+0.72, +7.57] on needless sends and -1.43 on must-ask misses; duplicates -6.31 and -3.03. The frozen fix-method row rests on these | Q | two model classifiers, whose audit against older labels scored kappa 0.49 and 0.55 |
| [Jev decision routing](../research/2026-11-09-geva-421-jev-decision-routing/README.md) | Recommendation judge +10.0 [+2.9, +18.6]; relationship contradictions +16.5 [+9.4, +24.7]; those two points inside "matched or beat the cascade on 7 of 8" and "measurably beat today's model on 4". The cost and speed figures stand | Q | Claude Opus 5.5 and GPT-6 Astra, keeping only items where they agreed |
| [Eng-review intentions stage 1](2026-11-11-geva-434-eng-review-intentions-stage-1-results.md) | A 0.087 (95% CI 0.007 to 0.191) and the FLOOR reading; weighted kappa 0.949 and the other check figures | K | GPT-6 Astra and Claude Opus 5.5 |
| [Trust-but-verify held-out](2026-11-23-geva-401-tbv-held-out-results/README.md) | Opus principle minus none +3.6 [-1.1, +8.4]; current gstack Sol -7.9 [-11.7, -4.2] and Opus -4.8 [-8.9, -0.6]; source A +7.6 and +10.0 | K | facts where two other models agreed |
| same | "More unsupported claims", about 1.5 more per report, and every unsupported-claim row | Q | none: never checked |
| [Office-hours shakedown rerun](2026-10-31-geva-65-lanea-shakedown-rerun-results.md) | Judged pass rates (before 0.67, after 0.76, none 0.36) and +18.5 [+7.4, +29.6]. "No loss" stands, because it rests on the patterns-only check | Q | none: no check (planned before checks were required) |
| [Product-value stage 1](2026-11-10-geva-513-product-value-stage-1-results.md), [first version](2026-11-09-geva-407-product-value-stage-1-results.md) | Plain Opus A 0.012 and 0.121; Sol 0.091 and 0.065; particle-1's A readings; "foresaw almost none". The verdict rests on exposure and stands | Q | model labels, and the check was NO READ |
| [Office-hours founder stage 1](2026-11-14-geva-526-office-hours-founder-stage-1-results.md) | W 1 of 69; named the customer or offering in 96% to 98% of sessions when handed every fact. "0 of 69" founder answers is a count and stands | Q | GPT-6 Astra and Claude Opus 5.5 |
| [plan-ceo-review stage 2](2026-11-08-geva-402-ceo-stage-2-results/README.md) | The hit@3 rows (34.3%, 15.5%, 22.6% and the rest, as on the README scorecard), on a key written by models | K | a second model judge (kappa 0.790) |
| [Autoplan record audit](2026-11-10-geva-513-autoplan-record-audit-results.md), [first version](2026-11-09-geva-437-autoplan-record-audit-results/README.md) | 79 of 118 outside findings marked new, and the reading that the outside voice is where most new findings came from. The four readings that needed no model call stand | Q | none: gstack's own reconcile model decided "new" |
| [State machine prompt pilots](2026-11-09-geva-492-state-machine-prompt-pilots.md) | 1 verified bug against 15; 5 and 3 in round 2; the severity and state-shaped counts | Q | none: one Claude Opus 5.5 verifier decided what counted as a bug |
| [Ship panel judged sample](2026-11-21-capy-ship-panel-sample-results/README.md) | "Two frontier models agree on whether a fixed finding was a real bug" (kappa 0.68 and 0.16); the judge's 11 of 12 on part B | Q | Claude Opus 5.5 and GPT-6.2 Astra, settled by the run's own agent |
| [CEO panel v2 admission](2026-11-02-geva-142-ceo-panel-v2-admission-results/README.md) | The unkeyed-finding rows: findings ruled a defect or not a defect (0.44, 1.44 and 1.63 per plan per pass, none minus gstack -1.00 [-1.75, -0.31], and the rest of that bullet) | Q | a second model judge (kappa 0.38 on 24) |
| [Planning R1a pilot stop](2026-11-01-geva-102-planning-r1a-pilot-stop/README.md) | Stop (e): must-fix findings ruled not a defect, per plan per pass | Q | none: no check (planned before checks were required) |
| [Harness mechanics](2026-11-15-geva-503-harness-mechanics-results/README.md) | The risky-command replay row: 0.960 (false deny 7.9%), 0.940 (12.1%) and 0.639, scored against labels where GPT-6 Astra and Claude Opus 5.5 agreed (kappa 0.778 between them). The KEEP and the other verdicts rest on tests and stand | K | the same two models |

## What stands

- Every number scored by tests, code or counts, with no model judge, stands as published, in these posts and in the posts not listed here.
- Every verdict stands as published. Where a verdict rests on a number labelled Q above, it now carries the same label: it is one model's opinion until a person checks it.
- Where a post already reported a judge that failed its check, that failure stands. A check against model labels can't rescue a judge, and it can't fail one either: a judge that passed only against model labels may still fall short against a person.
