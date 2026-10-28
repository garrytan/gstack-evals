---
id: 2026-10-28-gsta-11-review-replay-results
kind: finding
title: "Quick look 1 results: gstack's /review prompts on known gstack bugs"
summary: "Diff-only replay of gstack's /review reviewer prompts vs a plain prompt on 12 real gstack bugs: small recall gains on Opus and Haiku, more false alarms, no cheap model matched Opus."
author: GSTA-11
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: done
links:
  - 2026-10-28-gsta-11-review-replay-prereg
  - https://github.com/garrytan/gstack-evals/pull/5
  - quick/replay/
attachments:
  - 68ed7b7b131feb32ef012ac490fa871bf85286feeb547d58c67c8d1a52523b58  summary.json
---
# Quick look 1 results: gstack's /review prompts on known gstack bugs

Thread GSTA-11, for the gstack-evals Captain (GSTA-2). This is an exploratory run, preregistered in [2026-10-28-gsta-11-review-replay-prereg](../../plans/2026-10-28-gsta-11-review-replay-prereg.md) (PR #5). The numbers steer gstack's research and support no public claim.

## What was tested

The treatment is gstack's /review reviewer prompts run on a diff alone: the core reviewer, each dispatched specialist, and the Red Team when it activates. Each prompt is one API call that sees the PR's filtered diff and nothing else. This is not the /review workflow. It has no repo access, no tools, no later passes and no outside voice. The control is a plain two-sentence review prompt on the same diff.

The models are Opus 5.5 and Haiku 5.5 at effort `medium`, and DeepSeek V4.1 Flash at effort `high` with 32,000 output tokens. The 24 cases come from public garrytan/gstack history: 6 defects that escaped review and were fixed by a later PR, 6 defects gstack's own review caught on the PR branch, and 12 size-matched decoys. Each cell ran 3 trials. A gpt-6.1-sol judge, blind to the arm, decided whether a finding on the defect's file names the defect.

Recall is the share of trials in which a shown finding names the defect, averaged per case. A false alarm is a decoy trial with a shown CRITICAL finding. "Shown" follows /review's display rule: confidence 5 or more, or no confidence given. Intervals are 95% bootstrap intervals over cases, and differences are paired by case.

## All 24 cases

| model | arm | recall | 95% CI | recall at CRITICAL | false alarms | 95% CI | answered only: recall, false alarms (defect units) | cost per catch |
|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | plain | 39% | [14%, 67%] | 28% | 28% | [8%, 50%] | 39%, 28% (36) | $0.21 |
| Opus 5.5 | gstack | 44% | [19%, 72%] | 11% | 33% | [11%, 58%] | 44%, 33% (36) | $1.09 |
| Haiku 5.5 | plain | 33% | [11%, 58%] | 19% | 17% | [0%, 36%] | 33%, 17% (36) | $0.010 |
| Haiku 5.5 | gstack | 36% | [11%, 61%] | 19% | 33% | [14%, 56%] | 36%, 33% (36) | $0.040 |
| DeepSeek V4.1 Flash | plain | 14% | [0%, 33%] | 11% | 22% | [6%, 42%] | 42%, 43% (9) | $0.15 |
| DeepSeek V4.1 Flash | gstack | 31% | [8%, 56%] | 13% | 17% | [3%, 36%] | 38%, 15% (18) | $0.22 |

gstack minus plain, paired by case:

- **Opus:** recall +6 pts [0, 17], while recall at CRITICAL falls from 28% to 11%. With gstack's prompts, Opus finds slightly more of the defects but rates most of its catches below CRITICAL. False alarms +6 pts [-22, 31].
- **Haiku:** recall +3 pts [0, 8]. False alarms +17 pts [3, 33], so they double.
- **DeepSeek:** recall +17 pts [3, 36], but most of that lift comes from the plain prompt not finishing. Plain DeepSeek used all 32,000 tokens without answering in 44 of 72 units, and over answered units only the gap is +8 pts [0, 25]. False alarms -6 pts [-22, 8].

The answered-only column drops every unit with a call cut off before any answer. Opus and Haiku had no such calls. Counting findings below confidence 5 (ungated), Opus with gstack reaches 50% recall; the rest of the table barely moves.

## By stratum

**Escaped defects** (6 bugs that shipped and were fixed later; 6 decoys):

| model | arm | recall | 95% CI | recall at CRITICAL | false alarms | 95% CI | answered only: recall, false alarms (defect units) | cost per catch |
|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | plain | 67% | [33%, 100%] | 56% | 6% | [0%, 17%] | 67%, 6% (18) | $0.11 |
| Opus 5.5 | gstack | 78% | [44%, 100%] | 22% | 28% | [0%, 61%] | 78%, 28% (18) | $0.56 |
| Haiku 5.5 | plain | 56% | [17%, 89%] | 39% | 6% | [0%, 17%] | 56%, 6% (18) | $0.005 |
| Haiku 5.5 | gstack | 56% | [17%, 89%] | 33% | 28% | [6%, 61%] | 56%, 28% (18) | $0.023 |
| DeepSeek V4.1 Flash | plain | 28% | [0%, 61%] | 22% | 11% | [0%, 33%] | 56%, 22% (8) | $0.06 |
| DeepSeek V4.1 Flash | gstack | 56% | [17%, 89%] | 25% | 17% | [6%, 28%] | 60%, 11% (11) | $0.12 |

On escaped defects, gstack's prompts add 11 pts of recall on Opus [0, 33] while Opus's recall at CRITICAL falls from 56% to 22%, and false alarms rise by 22 pts [0, 44]. Haiku gains nothing in recall, and its false alarms rise by 22 pts [6, 44]. DeepSeek gains 28 pts [6, 61], most of it because the plain prompt did not finish; over answered units the gain is 11 pts [0, 33].

**Review-caught defects** (6 bugs gstack's review caught live; 6 decoys):

| model | arm | recall | 95% CI | recall at CRITICAL | false alarms | 95% CI | answered only: recall, false alarms (defect units) | cost per catch |
|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | plain | 11% | [0%, 33%] | 0% | 50% | [17%, 83%] | 11%, 50% (18) | $0.84 |
| Opus 5.5 | gstack | 11% | [0%, 33%] | 0% | 39% | [6%, 72%] | 11%, 39% (18) | $4.77 |
| Haiku 5.5 | plain | 11% | [0%, 33%] | 0% | 28% | [0%, 61%] | 11%, 28% (18) | $0.035 |
| Haiku 5.5 | gstack | 17% | [0%, 50%] | 6% | 39% | [11%, 72%] | 17%, 39% (18) | $0.097 |
| DeepSeek V4.1 Flash | plain | 0% | [0%, 0%] | 0% | 33% | [6%, 67%] | 0%, 58% (1) | - |
| DeepSeek V4.1 Flash | gstack | 6% | [0%, 17%] | 0% | 17% | [0%, 50%] | 0%, 17% (7) | $1.13 |

Five of the six review-caught defects were never caught by any model, arm or trial. Opus sits at 11% in both arms. This most likely reflects the treatment rather than the prompts: the live catches came from /review sessions with repo access and later passes, and a single diff-only call does not reproduce them. The models do look at the right lines (Opus with gstack puts a shown finding within 10 lines of the defect in 44% of trials, averaged per case), but they report other problems there. A hand check of those verdicts agreed with the judge.

## Cheap models against Opus

Recall difference, paired by case:

| comparison | all cases | escaped | review-caught |
|---|---|---|---|
| Haiku + gstack vs Opus plain | -3 pts [-22, 11] | -11 [-50, 17] | +6 [0, 17] |
| Haiku + gstack vs Opus + gstack | -8 [-28, 6] | -22 [-56, 0] | +6 [0, 17] |
| DeepSeek + gstack vs Opus plain | -8 [-28, 6] | -11 [-50, 17] | -6 [-17, 0] |
| DeepSeek + gstack vs Opus + gstack | -14 [-33, 0] | -22 [-56, 0] | -6 [-17, 0] |

Neither cheap model with gstack matched Opus, and this run makes no parity claim: it had no preregistered margin, and the intervals are 20 to 50 points wide. Haiku with gstack costs $0.04 per catch against $0.21 for Opus plain, with 3 points less recall and more false alarms (33% against 28%).

## Per case

Catches per completed trial. "Receipt" says whether the escaped defect's PR carried a passing gstack review receipt.

| case | PR | stratum | file | receipt | Opus plain | Opus gstack | Haiku plain | Haiku gstack | DeepSeek plain | DeepSeek gstack | Opus-high gstack |
|---|---|---|---|---|---|---|---|---|---|---|---|
| d13 | #897 | escaped | gstack-slug | no | 3/3 | 3/3 | 3/3 | 3/3 | 2/3 | 3/3 | 1/1 |
| d14 | #199 | escaped | SKILL.md.tmpl | yes | 3/3 | 3/3 | 0/3 | 0/3 | 0/3 | 0/3 | 1/1 |
| d04 | #339 | escaped | gen-skill-docs.ts | no | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/1 |
| d11 | #104 | escaped | read-commands.ts | yes | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 2/2 | 1/1 |
| d12 | #595 | escaped | cookie-picker-ui.ts | yes | 3/3 | 3/3 | 3/3 | 3/3 | 0/3 | 3/3 | 1/1 |
| d15 | #3143 | escaped | outside-review-result.ts | no | 0/3 | 2/3 | 1/3 | 1/3 | 0/3 | 1/3 | 1/1 |
| d01 | #3515 | review-caught | ubi-runner.sh | - | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | - |
| d02 | #3540 | review-caught | gstack-doctor | - | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | - |
| d03 | #3527 | review-caught | adversarial.md.tmpl | - | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | - |
| d08 | #1296 | review-caught | SKILL.md.tmpl | - | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | - |
| d09 | #3475 | review-caught | gstack-doctor-check.sh | - | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | - |
| d10 | #3501 | review-caught | prose-lint.ts | - | 2/3 | 2/3 | 2/3 | 3/3 | 0/3 | 1/3 | - |

Decoy trials with a shown CRITICAL finding:

| decoy | PR | stratum | Opus plain | Opus gstack | Haiku plain | Haiku gstack | DeepSeek plain | DeepSeek gstack |
|---|---|---|---|---|---|---|---|---|
| y13 | #547 | escaped | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| y14 | #3517 | escaped | 0/3 | 0/3 | 0/3 | 1/3 | 0/3 | 0/3 |
| y04 | #141 | escaped | 1/3 | 3/3 | 0/3 | 0/3 | 2/3 | 1/3 |
| y11 | #3397 | escaped | 0/3 | 0/3 | 0/3 | 1/3 | 0/3 | 0/2 |
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

The preregistered exploratory cell ran because the grid and its judging left $43.38 committed, under the $52 bar. Opus at effort `high` ran the gstack arm on the 6 escaped defects, 1 trial each. It caught 5 of 6 (83%), against 4 of 6 (67%) for Opus at `medium` in trial 1 on the same cases: +17 pts [0, 50], one case better and none worse. Its recall at CRITICAL was 50% against 33%. It cost $5.05 against $4.31 for those 6 units, with 17,800 output tokens per unit against 11,600. This cell enters no other table.

## Cost

Ledger item `replay-quick`, cap $60. The grid cost $43.02: Opus $36.48 (plain $5.43, gstack $31.05), DeepSeek $5.36, Haiku $1.18. The judge cost $0.39, and the Opus-high cell $5.05. The total is $48.46. DeepSeek's figure includes $0.76 settled at the worst case for 16 calls cut off by the harness restarts, and seven DeepSeek calls settled at $0 because OpenRouter reported a cost of 0. Per 72 units, gstack's prompts cost 5.7 times the plain prompt on Opus, 3.9 times on Haiku and 2.9 times on DeepSeek.

## Limitations

- The treatment is a diff-only single call per reviewer prompt, not the /review workflow (see above).
- Six defects per stratum: one case moves a stratum's recall by about 17 points.
- The plain arm names the severity words. It is a frozen prompt, so it is not fully plain.
- Opus and Haiku ran at effort `medium` in both arms, a Captain decision recorded in the preregistration, citing GSTA-131. The exploratory cell suggests `high` would score higher on Opus.
- DeepSeek's plain arm mostly ran out of tokens before answering; the answered-only columns show what that does.
- The review-caught set was chosen by gstack's own review, so it favours what gstack catches live. The escaped set was not.
- The judge is one model (gpt-6.1-sol), blind to the arm. A hand audit of 10 seeded verdicts agreed with all 10. All 488 right-file findings were judged; no unit is unjudged.
- The harness was fixed and restarted three times during the DeepSeek phase, before any Haiku or Opus call. The preregistration's "Changes during the run" section lists every change. One DeepSeek gstack unit (d11, trial 3) was marked incomplete for a corrupted Red Team prompt, decided before its findings were read. One DeepSeek gstack decoy unit (y11, trial 2) is incomplete because OpenRouter returned no cost for its core call.

## Notes for the rig (U4 and U7)

The Captain accepted two quick-look shortcuts that the rig must close:

- The ledger's approval row records `cap_usd`, but the code never compares it with the cap it enforces.
- "One ledger writer at a time" is an operating rule here, not a lock.

## Provenance

- Result files carry the commit they ran under in `prereg_sha`: 186 at 4ccef26, 166 at 5483453, 98 at eeaed8b and 905 at feb45fa (the grid), and 31 at b4f825a (the Opus-high cell). The tables were scored at 02e46db. The ledger rows carry no commit; the preregistration is PR #5.
- The prompts render from gstack 61e201ec08bcf59163ef2d3a69a26e334a536c04. Digests: frozen.sha256 72802811ab475c2513defc5470436ab210b5ff1c4823532f3dc37eea31a92bf7 (162 prompts), plan.json 50e474c5fda9ff89cf6dc45f542dc115b211ed399e56010d356f71be1838acaf.
- `summary.json` beside this post holds every table, including the ungated and answered-only variants and the exploratory cell. The raw outputs, judge verdicts and the hand audit sit in the Captain drive under handoffs/GSTA-11/.

## Next runs

1. Replay /review as a workflow (Claude Code with gstack loaded and the repo checked out) on the review-caught set, to test whether repo access explains the 11%.
2. Find why gstack's prompts push Opus's catches below CRITICAL, and whether the severity rubric or the Red Team causes it.
3. Grow the escaped set. Six defects per stratum cannot separate a 10-point lift from zero.
4. Cut false alarms on Haiku with gstack before any cheap-model ladder run. gstack's prompts double Haiku's false alarms, which gives back part of the cost win.
5. For DeepSeek, raise the output limit or lower the effort on both arms, so the plain prompt finishes.
6. Check decoy y09 for a real defect.
