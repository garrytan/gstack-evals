---
id: 2026-10-28-gsta-11-review-replay-results
kind: finding
title: "Quick look 1 results: gstack's /review prompts on known gstack bugs"
summary: "Diff-only replay of gstack's /review prompts vs a plain prompt on 12 real gstack bugs: Opus +6 pts recall, Haiku +3, both with more false alarms; no cheap model matched Opus."
author: GSTA-11
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: superseded
links:
  - 2026-10-28-gsta-11-review-replay-prereg
  - https://github.com/garrytan/gstack-evals/pull/5
  - quick/replay/
attachments:
  - ffe94905984025c8a5d55bee0718f5ac481ec0ddd8e1b75bb7f7b2664a6401c6  summary.json
---
# Quick look 1 results: gstack's /review prompts on known gstack bugs

Thread GSTA-11, for the gstack-evals Captain (GSTA-2). This is an exploratory run, preregistered in [2026-10-28-gsta-11-review-replay-prereg](../../plans/2026-10-28-gsta-11-review-replay-prereg.md) (PR #5). The numbers steer gstack's research and support no public claim.

## What was tested

The treatment is gstack's /review reviewer prompts run on a diff alone: the core reviewer, each dispatched specialist, and the Red Team when it activates. Each prompt is one API call that sees the PR's filtered diff and nothing else, except the Red Team, whose prompt also carries the specialists' merged findings, as in /review. This is not the /review workflow. It has no repo access, no tools, no later passes, no fix-check and no outside voice. The control is a plain two-sentence review prompt on the same diff.

The models are Opus 5.5 and Haiku 5.5 at effort `medium`, and DeepSeek V4.1 Flash at effort `high` with 32,000 output tokens. The 24 cases come from public garrytan/gstack history: 6 defects that escaped review and were fixed by a later PR, 6 defects gstack's own review caught on the PR branch, and 12 size-matched decoys. Each cell ran 3 trials. A gpt-6.1-sol judge, blind to the arm, decided whether a finding on the defect's file names the defect.

Recall is the share of trials in which a shown finding names the defect, averaged per case. A false alarm is a decoy trial with a shown CRITICAL finding. "Shown" follows /review's display rule: confidence 5 or more, or no confidence given. Cost per catch is a cell's spend on its defect units, failed calls included, divided by its catches. Intervals are 95% bootstrap intervals over cases, and differences are paired by case. A unit counts only when every reviewer call in it returned; the preregistration's "Changes during the run" section lists the restarts and the corrected calls, and the one other failed call is named under Cost.

## All 24 cases

| model | arm | recall | 95% CI | recall at CRITICAL | false alarms | 95% CI | answered only: recall, false alarms (defect units) | cost per catch |
|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | plain | 39% | [14%, 67%] | 28% | 28% | [8%, 50%] | 39%, 28% (36) | $0.21 |
| Opus 5.5 | gstack | 44% | [19%, 72%] | 11% | 33% | [11%, 58%] | 44%, 33% (36) | $1.09 |
| Haiku 5.5 | plain | 33% | [11%, 58%] | 19% | 17% | [0%, 36%] | 33%, 17% (36) | $0.010 |
| Haiku 5.5 | gstack | 36% | [11%, 61%] | 19% | 33% | [14%, 56%] | 36%, 33% (36) | $0.040 |
| DeepSeek V4.1 Flash | plain | 17% | [0%, 42%] | 14% | 22% | [6%, 42%] | 50%, 50% (8) | $0.15 |
| DeepSeek V4.1 Flash | gstack | 32% | [10%, 57%] | 17% | 17% | [3%, 36%] | 38%, 15% (15) | $0.25 |

DeepSeek used all 32,000 output tokens and returned no text in 44 of 72 plain units (44 calls) and 28 of 72 gstack units (61 calls). The answered-only column drops every unit with such a call. Opus and Haiku had none. These counts cover the units the scorer loads: one more empty cut-off, the Red Team call in DeepSeek gstack d10 trial 3, sits in a unit that is incomplete because its core call failed. Incomplete units: DeepSeek plain 3, DeepSeek gstack 6, all others 0.

gstack minus plain, paired by case:

- **Opus:** recall +6 pts [0, 17], while recall at CRITICAL falls from 28% to 11%. With gstack's prompts, Opus finds slightly more of the defects but rates most of its catches below CRITICAL. False alarms +6 pts [-22, 31].
- **Haiku:** recall +3 pts [0, 8]. False alarms +17 pts [3, 33], so they double.
- **DeepSeek:** recall +15 pts [0, 35], and most of that lift comes from the plain prompt not finishing: over the 4 defects with answered units in both arms the recall gap is 0 pts, and over the 6 such decoys the false-alarm gap is -28 pts [-61, -6]. On all units, false alarms -6 pts [-22, 8].

Counting findings below confidence 5 (ungated), Opus with gstack reaches 50% recall and DeepSeek with gstack 36%; the other cells do not move. Every gated-to-ungated change in recall comes from findings at confidence 4. The models gave confidence on three scales (1 to 10 for most, 0 to 1 for 48 findings, 0 to 100 for 245), and recall, recall at CRITICAL and false alarms do not move because of it. Two secondary rates for DeepSeek gstack do: on a common 1 to 10 scale, its file-and-line rate falls from 44% to 39% and its decoys with any finding rise from 79% to 83%.

## By stratum

**Escaped defects** (6 bugs that shipped and were fixed by a later PR; 6 decoys). Three of the six PRs carry a passing gstack review receipt; the other three carry none, so for them "escaped" means the bug shipped without a passing gstack review receipt.

| model | arm | recall | 95% CI | recall at CRITICAL | false alarms | 95% CI | answered only: recall, false alarms (defect units) | cost per catch |
|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | plain | 67% | [33%, 100%] | 56% | 6% | [0%, 17%] | 67%, 6% (18) | $0.11 |
| Opus 5.5 | gstack | 78% | [44%, 100%] | 22% | 28% | [0%, 61%] | 78%, 28% (18) | $0.56 |
| Haiku 5.5 | plain | 56% | [17%, 89%] | 39% | 6% | [0%, 17%] | 56%, 6% (18) | $0.005 |
| Haiku 5.5 | gstack | 56% | [17%, 89%] | 33% | 28% | [6%, 61%] | 56%, 28% (18) | $0.023 |
| DeepSeek V4.1 Flash | plain | 33% | [0%, 67%] | 28% | 11% | [0%, 33%] | 67%, 33% (7) | $0.06 |
| DeepSeek V4.1 Flash | gstack | 56% | [17%, 89%] | 33% | 17% | [6%, 28%] | 60%, 11% (9) | $0.14 |

DeepSeek cut-offs here: plain 20 of 36 units, gstack 16 of 36 units (33 calls).

On escaped defects, gstack's prompts add 11 pts of recall on Opus [0, 33] while Opus's recall at CRITICAL falls from 56% to 22%, and false alarms rise by 22 pts [0, 44]. Haiku gains nothing in recall, and its false alarms rise by 22 pts [6, 44]. DeepSeek gains 22 pts [0, 56], and most of that is the plain prompt not finishing: over the 3 cases with answered units in both arms, the gap is 0 pts.

**Review-caught defects** (6 bugs gstack's review caught live; 6 decoys):

| model | arm | recall | 95% CI | recall at CRITICAL | false alarms | 95% CI | answered only: recall, false alarms (defect units) | cost per catch |
|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | plain | 11% | [0%, 33%] | 0% | 50% | [17%, 83%] | 11%, 50% (18) | $0.84 |
| Opus 5.5 | gstack | 11% | [0%, 33%] | 0% | 39% | [6%, 72%] | 11%, 39% (18) | $4.77 |
| Haiku 5.5 | plain | 11% | [0%, 33%] | 0% | 28% | [0%, 61%] | 11%, 28% (18) | $0.035 |
| Haiku 5.5 | gstack | 17% | [0%, 50%] | 6% | 39% | [11%, 72%] | 17%, 39% (18) | $0.097 |
| DeepSeek V4.1 Flash | plain | 0% | [0%, 0%] | 0% | 33% | [6%, 67%] | 0%, 58% (1) | - |
| DeepSeek V4.1 Flash | gstack | 8% | [0%, 25%] | 0% | 17% | [0%, 50%] | 0%, 17% (6) | $1.13 |

DeepSeek cut-offs here: plain 24 of 36 units, gstack 12 of 36 units (28 calls), plus the d10 trial 3 Red Team call in an incomplete unit.

Only d10 was caught by a shown finding; the other five review-caught defects never were. Opus with gstack named d09 in one trial and d10 in a third trial, both at confidence 4, so its ungated recall on this stratum is 22%. Opus sits at 11% in both arms. This most likely reflects the treatment rather than the prompts. Going by the subjects of the live fix commits, d08 came from a Codex finding, d03 from a /ship fix-check, and d01 and d09 from a second review pass; only d02 clearly came from a first pre-landing review. d10's fix is the PR's second "pre-landing review fixes" commit, 4 minutes after the replayed head, so it may also be a later pass. None of those later steps, and no repo access, are in this replay. The models do look at the right lines (Opus with gstack puts a shown finding within 10 lines of the defect in 44% of trials, averaged per case), but they report other problems there. I also read 12 of the judge's "does not name it" verdicts on such near-line findings (two per case, counting findings below confidence 5) and agree with each; unlike the seeded audit, these reads are not archived.

## Cheap models against Opus

Recall difference, paired by case:

| comparison | all cases | escaped | review-caught |
|---|---|---|---|
| Haiku + gstack vs Opus plain | -3 pts [-22, 11] | -11 [-50, 17] | +6 [0, 17] |
| Haiku + gstack vs Opus + gstack | -8 [-28, 6] | -22 [-56, 0] | +6 [0, 17] |
| DeepSeek + gstack vs Opus plain | -7 [-26, 6] | -11 [-50, 17] | -3 [-8, 0] |
| DeepSeek + gstack vs Opus + gstack | -13 [-31, 0] | -22 [-56, 0] | -3 [-8, 0] |

Neither cheap model with gstack matched Opus, and this run makes no parity claim: it had no preregistered margin, and the intervals run from 8 to 67 points wide. Haiku with gstack costs $0.04 per catch against $0.21 for Opus plain, with 3 points less recall and more false alarms (33% against 28%).

## Per case

Catches per completed trial. "Receipt" says whether the escaped defect's PR carried a passing gstack review receipt.

| case | PR | stratum | file | receipt | Opus plain | Opus gstack | Haiku plain | Haiku gstack | DeepSeek plain | DeepSeek gstack |
|---|---|---|---|---|---|---|---|---|---|---|
| d13 | #897 | escaped | gstack-slug | no | 3/3 | 3/3 | 3/3 | 3/3 | 2/2 | 3/3 |
| d14 | #199 | escaped | SKILL.md.tmpl | yes | 3/3 | 3/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| d04 | #339 | escaped | gen-skill-docs.ts | no | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/2 |
| d11 | #104 | escaped | read-commands.ts | yes | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 1/1 |
| d12 | #595 | escaped | cookie-picker-ui.ts | yes | 3/3 | 3/3 | 3/3 | 3/3 | 0/3 | 3/3 |
| d15 | #3143 | escaped | outside-review-result.ts | no | 0/3 | 2/3 | 1/3 | 1/3 | 0/3 | 1/3 |
| d01 | #3515 | review-caught | ubi-runner.sh | - | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| d02 | #3540 | review-caught | gstack-doctor | - | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| d03 | #3527 | review-caught | adversarial.md.tmpl | - | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/2 |
| d08 | #1296 | review-caught | SKILL.md.tmpl | - | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| d09 | #3475 | review-caught | gstack-doctor-check.sh | - | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| d10 | #3501 | review-caught | prose-lint.ts | - | 2/3 | 2/3 | 2/3 | 3/3 | 0/3 | 1/2 |

Decoy trials with a shown CRITICAL finding:

| decoy | PR | stratum | Opus plain | Opus gstack | Haiku plain | Haiku gstack | DeepSeek plain | DeepSeek gstack |
|---|---|---|---|---|---|---|---|---|
| y13 | #547 | escaped | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| y14 | #3517 | escaped | 0/3 | 0/3 | 0/3 | 1/3 | 0/3 | 0/3 |
| y04 | #141 | escaped | 1/3 | 3/3 | 0/3 | 0/3 | 2/3 | 1/3 |
| y11 | #3397 | escaped | 0/3 | 0/3 | 0/3 | 1/3 | 0/1 | 0/2 |
| y12 | #3433 | escaped | 0/3 | 2/3 | 1/3 | 3/3 | 0/3 | 1/3 |
| y15 | #3424 | escaped | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 1/3 |
| y01 | #462 | review-caught | 0/3 | 0/3 | 0/3 | 0/3 | 1/3 | 0/3 |
| y02 | #817 | review-caught | 0/3 | 0/3 | 0/3 | 2/3 | 0/3 | 0/3 |
| y03 | #110 | review-caught | 1/3 | 3/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| y08 | #652 | review-caught | 3/3 | 0/3 | 0/3 | 0/3 | 2/3 | 0/3 |
| y09 | #201 | review-caught | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| y10 | #249 | review-caught | 2/3 | 1/3 | 2/3 | 2/3 | 0/3 | 0/3 |

Three cases decide most of the escaped recall: every Opus and Haiku trial caught d13, d11 and d12, and nobody caught d04. gstack's clearest single win is Opus on d15 (0 of 3 plain, 2 of 3 gstack). Every cell flagged decoy y09 as CRITICAL in every trial, so y09 may hold a real defect; nobody has checked.

## Exploratory: Opus at effort high

The preregistered exploratory cell ran because the grid and its judging stayed under its preregistered bar. Opus at effort `high` ran the gstack arm on the 6 escaped defects, 1 trial each. It caught d13, d14, d11, d12 and d15 and missed d04: 5 of 6 (83%), against 4 of 6 (67%) for Opus at `medium` in trial 1 on the same cases. That is +17 pts [0, 50], one case better and none worse. Its recall at CRITICAL was 50% against 33%. It cost $5.05 against $4.31 for those 6 units, with 17,800 output tokens per unit against 11,600. The judge saw the Opus-high findings in batches of their own, while the medium cell's findings were judged in batches mixed with other cells. This cell enters no other table above.

## Cost

Per 72 units, gstack's prompts cost 5.7 times the plain prompt on Opus, 4.0 times on Haiku and 2.9 times on DeepSeek.

## Limitations

- The treatment is a diff-only single call per reviewer prompt, not the /review workflow (see above).
- Six defects per stratum: one case moves a stratum's recall by about 17 points.
- The plain arm names the severity words. It is a frozen prompt, so it is not fully plain.
- Opus and Haiku ran at effort `medium` in both arms, a Captain decision recorded in the preregistration, citing GSTA-131. The exploratory cell hints that `high` scores higher on Opus, but the difference rests on one case.
- DeepSeek's plain arm mostly ran out of tokens before answering, and the answered-only columns pair only 4 of the 12 defects and 6 of the 12 decoys. Four more DeepSeek replies held no review and count as answered with no findings: two tool calls in DeepSeek's own markup, one empty reply with a normal stop, and one cut off at the token limit after 76 characters of an unfinished finding (d03, gstack, trial 2). The answered-only rule drops only cut-offs with no text, as the harness defined it before the grid ran. Dropping these units as well leaves the paired answered-only gaps unchanged. It moves DeepSeek gstack's answered-only recall from 38% over 15 defect units to 43% over 14 (the cut-off reply only) or 33% over 12 (all four).
- The review-caught set was chosen by gstack's own review, so it favours what gstack catches live. The escaped set was not.
- Decoys are PRs whose gstack review receipt records no blocking finding, so a false alarm here is a CRITICAL finding gstack's live review did not raise.
- The judge is one model (gpt-6.1-sol), blind to the arm. A seeded hand audit of 10 verdicts agreed with all 10, and 12 unarchived reads of near-line review-caught verdicts (above) also agreed. All 479 right-file findings in counted units were judged (447 in the grid, 32 in the Opus-high cell); no counted unit is unjudged. The 3 right-file findings in one excluded unit (DeepSeek gstack d11 trial 3) were never judged. `judged_findings` in summary.json is 488 because it counts every verdict on record: the other 9 belong to DeepSeek gstack units the post-score correction excluded after judging (d04 trial 3 and d11 trial 1, 4 each, and d10 trial 3, 1).
- The harness was fixed and restarted three times during the DeepSeek phase, before any Haiku or Opus call, and corrected once after the first score: seven DeepSeek replies that ended in a provider error now count as failed calls. The preregistration's "Changes during the run" section lists every change. That correction moved DeepSeek's all-case gap from +17 to +15 pts and its answered-only gap from +8 to 0.

## Notes for the rig (U4 and U7)

The Captain accepted two quick-look shortcuts that the rig must close:

- The ledger's approval row records `cap_usd`, but the code never compares it with the cap it enforces.
- "One ledger writer at a time" is an operating rule here, not a lock.

## Provenance

- Result files carry the commit they ran under in `prereg_sha`: 184 at 4ccef26, 166 at 5483453, 98 at eeaed8b and 905 at feb45fa (the grid), and 31 at b4f825a (the Opus-high cell). The judge ran at b4f825a and 02e46db. The tables come from a rescore without new judge calls at 7f8fffd, after the post-score correction. The ledger rows carry no commit; the preregistration is PR #5.
- The prompts render from gstack 61e201ec08bcf59163ef2d3a69a26e334a536c04. Digests: frozen.sha256 72802811ab475c2513defc5470436ab210b5ff1c4823532f3dc37eea31a92bf7 (162 prompts), plan.json 50e474c5fda9ff89cf6dc45f542dc115b211ed399e56010d356f71be1838acaf.
- `summary.json` beside this post holds the overall and stratum tables with their ungated and answered-only variants, the paired comparisons and the exploratory cell. The per-case table is not in it; it comes from the raw outputs and judge verdicts. The raw outputs, judge verdicts and the hand audit are in the Captain drive at handoffs/GSTA-11/results.tgz, sha256 f7c884c86189e0e704b7203735fa788db743f71898c3ca0eec8f295b75d1b7c8.

## Next runs

1. Replay /review as a workflow (Claude Code with gstack loaded and the repo checked out) on the review-caught set, to test whether repo access and the later passes explain the 11%.
2. Find why gstack's prompts push Opus's catches below CRITICAL, and whether the severity rubric or the Red Team causes it.
3. Grow the escaped set. Six defects per stratum cannot separate a 10-point lift from zero.
4. Cut false alarms on Haiku with gstack before any cheap-model ladder run. gstack's prompts double Haiku's false alarms, which gives back part of the cost win.
5. For DeepSeek, raise the output limit or lower the effort on both arms, so the plain prompt finishes.
6. Check decoy y09 for a real defect.

<details>
<summary>Agent notes</summary>

The preregistered exploratory cell ran because the grid and its judging left $43.38 committed, under the $52 bar.

**Cost**

Ledger item `replay-quick`, cap $60. The grid cost $43.02: Opus $36.48 (plain $5.43, gstack $31.05), DeepSeek $5.36, Haiku $1.18. The judge cost $0.39, and the Opus-high cell $5.05. The total is $48.46. DeepSeek's figure includes $0.81 settled at the worst case for 17 calls: 16 cut off by the harness restarts ($0.76) and one whose reply carried no cost (the core call in DeepSeek gstack y11 trial 2, which OpenRouter returned without `usage.cost`). The seven DeepSeek replies that ended in a provider error settled at $0, so DeepSeek spend is slightly understated. Per 72 units, gstack's prompts cost 5.7 times the plain prompt on Opus, 4.0 times on Haiku and 2.9 times on DeepSeek.

</details>
