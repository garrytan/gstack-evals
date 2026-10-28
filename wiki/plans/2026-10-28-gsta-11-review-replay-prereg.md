---
id: 2026-10-28-gsta-11-review-replay-prereg
kind: plan
title: "Quick look 1 preregistration: review replay on known gstack bugs"
summary: Do gstack's /review reviewer prompts catch known gstack bugs better than a two-sentence prompt, split by bugs gstack's review caught and bugs that escaped it? Opus, Haiku, DeepSeek; $60 cap.
author: GSTA-11
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: open
links:
  - quick/replay/
  - https://github.com/garrytan/gstack-evals/pull/5
  - 2026-10-27-gsta-2-openrouter-programming-ranking
---
# Quick look 1: review replay on known gstack bugs (preregistration)

Thread GSTA-11, for the gstack-evals Captain (GSTA-2). Written 2026-10-28, before any paid call. Exploratory: these numbers steer research and support no public claim. Every result file records the commit sha of this post (PREREG_SHA). The harness is [quick/replay/](../../quick/replay/README.md).

## Question

Do gstack's reviewer prompts catch known, real bugs more often than a plain two-sentence review prompt, and at what false-alarm rate and cost? Does gstack's prompt let a cheap model (Haiku 5.5, DeepSeek V4.1 Flash) match Opus 5.5 at review? The answer is reported separately for bugs gstack's own review caught and bugs that escaped review, since only the second set was not chosen by gstack's reviewers.

## Cases

Twenty-four diffs from public garrytan/gstack history, mined by `mine.ts` and picked by `select.ts`. `cases.json` holds each case's PR, base and head shas, the filtered diff's sha256, and for a defect the file, line ranges in the reviewed head (for an escaped defect, the lines the introducing PR added that the fix rewrote, mapped back with git blame), fix commit, fixing PR and a one-paragraph statement of the defect. The filter drops CHANGELOG.md, VERSION, package.json, bun.lock, generated SKILL.md files, golden fixtures and agents-digest/.

- **Escaped defects (6).** A later PR fixed lines this PR added. Two mining routes: a fix PR whose body names an earlier PR, and any fix or revert commit on main whose rewritten lines blame mostly to one earlier main commit within 150 commits. Kept: filtered diff 30 to 750 lines, the fix names a failure the old lines produce, one case per introducing PR and per fixing PR. `select.ts` lists every other candidate in range with its reason (features, design changes, environment-only failures, a dependency added later, a fix that sits in another file, and #346, whose fix PR #391 also fixed d04). Three of the six PRs carry a gstack Pre-Landing Review receipt that passed (`review_receipt` in cases.json); three carry none.
- **Review-caught defects (6).** gstack's own review caught them on the PR branch: a review-fix commit rewrote lines that same PR had added. The case is the candidate that review saw. They are size-matched to the escaped set: for each escaped defect, smallest first, the unused caught defect nearest in diff size. The three unmatched caught candidates from the first version (d05, d06, d07) are listed in cases.json.
- **Decoys (12).** Merged PRs whose review receipt records no blocking finding, whose diff is at least half non-markdown, whose added lines no fix in the next 40 main commits rewrote, and which no escaped candidate names as its introducer. Each is the nearest in size to one defect and takes that defect's stratum.

| id | stratum | PR | base..head | defect file | lines | specialists | fixed by | diff sha256 |
|---|---|---|---|---|---|---|---|---|
| d13 | escaped | #897 | 1868636f49..9d34baa973 | bin/gstack-slug | 41 | 0 | #1848 | a2bedabbfd4a |
| d14 | escaped | #199 | 4fe0ce9cba..2a206920ed | retro/SKILL.md.tmpl | 46 | 0 | #211 | 9526bfb3e372 |
| d04 | escaped | #339 | faff8a2f07..0bff8d66a2 | scripts/gen-skill-docs.ts | 111 | 5 | #391 | 94c0d1597eef |
| d11 | escaped | #104 | 1e06b6a5c6..78e519e3b7 | browse/src/read-commands.ts | 310 | 5 +RT | #117 | 0d80e51bdebe |
| d12 | escaped | #595 | 78bc1d1968..7450b5160b | browse/src/cookie-picker-ui.ts (and cookie-picker-routes.ts) | 535 | 6 +RT | #904 | 5cecc7c539a6 |
| d15 | escaped | #3143 | 6e250405fe..8fc9f2a58d | lib/outside-review-result.ts | 677 | 6 +RT | #3376 | 998fc41b1b0a |
| d01 | review-caught | #3515 | e08612e50d..1f77181596 | scripts/ubicloud/ubi-runner.sh | 38 | 0 | same PR | 7f3d2ac8c60e |
| d02 | review-caught | #3540 | 9e3308f65a..115355a38b | bin/gstack-doctor | 65 | 2 | same PR | 1a8993c9e2d1 |
| d03 | review-caught | #3527 | c5e13f9167..243ca8ea21 | ship/sections/adversarial.md.tmpl | 97 | 3 | same PR | 7c84b0ea5e25 |
| d08 | review-caught | #1296 | 7658179879..9a424a9f55 | office-hours/SKILL.md.tmpl | 238 | 5 +RT | same PR | 6f0e3689de27 |
| d09 | review-caught | #3475 | 5755601dac..761a22b38b | bin/gstack-doctor-check.sh | 633 | 6 +RT | same PR | a321bbeeb016 |
| d10 | review-caught | #3501 | 576839cb8c..a681c00a2b | lib/prose-lint.ts | 743 | 6 +RT | same PR | 07cb535f30ca |
| y13, y14, y04, y11, y12, y15 | escaped (decoys) | #547, #3517, #141, #3397, #3433, #3424 | see cases.json | - | 56 to 698 | 2 to 6 | - | see cases.json |
| y01, y02, y03, y08, y09, y10 | review-caught (decoys) | #462, #817, #110, #652, #201, #249 | see cases.json | - | 34 to 753 | 0 to 6 | - | see cases.json |

d12's defect spans two files: the unauthenticated route that serves the page and the page that inlines the token, so a finding at either file is a right-file finding.

Digests: cases.json `0b5ee6f8d92b`, plan.json `50e474c5fda9`, frozen.sha256 `72802811ab47` (sha256 of all 162 rendered prompts). Prompts render from gstack at 61e201ec08bc (v1.91.295.0) with `build.ts`, which re-checks every diff digest and runs the scope and state-machine detectors from a clean worktree at that sha.

## Arms

- **plain**: one call. The prompt is two sentences: "Review this pull request diff for bugs. Output one JSON object per line for each bug, {severity, path, line, summary}, or the two words NO FINDINGS if there are none." Then the diff.
- **gstack**: the reviewers /review dispatches, one call each, rendered from gstack's own text: the core reviewer (review/checklist.md with Step 4's blocking floor and Confidence Calibration), the Review Army specialists picked by Step 4.5's rules from the diff's size and `gstack-diff-scope` / `gstack-state-matrix detect` flags (`plan.json`), and the Red Team when the diff is over 200 lines or a specialist returns a CRITICAL (its prompt carries that trial's merged specialist findings in /review's Step 4.6 line form). Adaptive gating is off (no local history). Not replayed: QA probes, the adversarial and outside-voice step (4.8), Greptile, scope drift, learnings, and every tool step. Each reviewer gets the checklist and diff pasted in, with no repository access. Both arms get the same filtered diff and the same JSON output form.

## Models and trials

claude-opus-5-5 (reference) and claude-haiku-5-5 through the Anthropic Messages API, effort `medium` for both arms; deepseek/deepseek-v4.1-flash-1017 through OpenRouter, `provider.order=[deepseek]`, `allow_fallbacks=false`, reasoning effort `high`, cost read from the response's `usage.cost`. DeepSeek's own endpoint serves only the 1017 snapshot. The open-weight slot follows the 2026-10-27 OpenRouter programming ranking, where DeepSeek V4.1 Flash is first; the smoke step re-reads it with the key before the first paid call and records `meta.as_of`, and any change applies at the next preregistration. max_tokens 32,000. 3 trials per case, arm and model: 24 cases x 2 arms x 3 models x 3 trials = 432 units. No Sonnet, no Fable, no gpt-5.4-mini. No Claude Code session runs, so CLAUDE_CODE_DISABLE_BUNDLED_SKILLS does not apply.

**Exploratory cell, only if money allows.** If the main grid and its judging finish with at most $52 committed, Opus at effort `high` runs the gstack arm on the escaped defects, 1 trial each, in plan order, with RUN_LIMIT 59, and its findings are judged the same way. It is reported beside Opus-medium's trial 1 on the same cases, labelled exploratory, and enters no other table. A cap stop there only ends the cell.

## Metrics

A gstack unit's findings are the union of its reviewers' findings. Findings with confidence 1 to 4 are dropped, as /review's display rule does; plain findings carry no confidence and all count. Every metric is reported three times: all cases, the escaped stratum and the review-caught stratum.

- **Recall (primary).** A defect unit is a catch when a finding sits at the defect's file (path or `cause.path`, deterministic) and the judge says it names the defect.
- **False alarms (primary).** A decoy unit is a false alarm when any shown finding is CRITICAL (deterministic).
- **Secondary.** Recall counting only CRITICAL catches; a judge-free proxy, a finding in the defect's main file within 10 lines of the defect; recall and false alarms with no confidence gate; decoy units with any finding; cost per catch (defect spend / catches, and all spend / catches); input and output tokens per unit.
- **Valid units.** A unit counts toward rates and catches only when every reviewer call returned and, for a defect, every right-file finding (gated or not) has a judge verdict. Units missing a call are reported as incomplete; units missing a verdict as unjudged. Spend counts every unit of a cell, valid or not, at what the ledger settled, failed calls included.
- **Judge.** openai/gpt-6.1-sol, effort `low`. It sees the defect statement, the fix commit's diff for the defect's files and right-file findings as {path, line, summary}, with arm and model removed, shuffled across arms and models in batches of at most 12. A judge call that fails (other than a retried 429 or 5xx) is recorded and not resent; its findings stay unjudged. I audit 10 judgments by hand (seeded sample, verdicts mixed) and report agreement.

## Analysis

Per stratum, model and arm: recall and false-alarm rate as the mean over cases of each case's rate across its trials, with case-clustered percentile bootstrap 95% intervals (10,000 resamples, seed 20261030). Paired by case: gstack minus plain within each model; Haiku-gstack and DeepSeek-gstack against Opus-plain and Opus-gstack. The escaped stratum is the test of whether gstack's prompts beat plain; the review-caught stratum is close to a sanity check, since gstack's reviewers chose those bugs. With 6 defects per stratum every comparison is descriptive. No superiority or parity claim is made; the CREW parity rule needs a preregistered margin and more cases than this.

## Money and stop rule

Cap $60, line item `replay-quick`, inside the $500 first cap Garry approved at gate 1 ("Rec"), moved to this week on his "It should be fast like this week". Ledger: Captain drive `ledger/replay-quick.jsonl`, append-only: the approval row first, then a reserve row at the worst case (every input token as a cache write, all 32,000 output tokens) before every call and a settle row with measured usage after. Review calls may commit at most $55; the judge uses the rest. A refused reservation with no call in flight stops the run: an incomplete run, reported as such, never rerun to change a result. 429 and 5xx responses retry up to 3 times; any other failure is recorded as INFRA, the unit is incomplete, and a rerun does not call again for it. Expected spend about $52: review calls about $49 (Opus about $46, Haiku about $1.2, DeepSeek about $2.2) and the judge about $3. This projects GSTA-11's earlier per-call output assumption onto the new prompts; no paid run backs it yet. One short smoke call per model runs first and counts. Order: DeepSeek, Haiku, then Opus. Within a model, case-arm groups run four at a time in plan order (escaped pairs first, then review-caught pairs); each group runs trial 1, then trials 2 and 3 at once so they read the prompt cache. A cap stop therefore cuts the review-caught tail of the Opus run first. None of the three keys can carry a spend limit set from an ordinary key, so the ledger is the limit.

## Known limits

- Effort is `medium` for Opus and Haiku in both arms (Captain: "keep medium"). GSTA-131 found medium can cost recall on fix-checks: a fix-check case went 0/3 at medium and 2/3 at high, which set gstack's rule that blocking reviewers stay at full effort. So the gstack arm here is lighter than gstack runs itself, and its recall may be understated.
- Five of the six escaped defects come from early gstack (v0.4 to v0.15) and are reviewed with today's prompts; the review-caught defects come mostly from v1.91. The size match does not match era.
- Reviewers see only the diff. Decoys are clean by the best evidence available, not proven clean. Three defects are in prompt templates, not code.
- n is 6 escaped and 6 review-caught defects and 12 decoys. One judge model; one hand audit of 10.

## Changes from the first version of this preregistration

The first version (PR #5 at e9e4b6e, never run) had nine review-caught defects, one escaped defect and ten decoys. Before any spend the Captain asked for the escaped set ("fix it before any spend"), stratified reporting, and medium effort recorded as a limit. This version adds the blame mining route, escaped line ranges in reviewed-head coordinates, the size-matched strata, decoys from any PR number with escaped introducers excluded, the Opus-high exploratory cell, the valid-unit rule, ledger-based cost per catch, terminal INFRA on resume, pinned detectors and the group run order, and moves the preregistration into wiki/.

## Changes during the run

Paid calls began on 2026-10-28 at commit 4ccef26 (smoke calls, then the DeepSeek phase). During the DeepSeek phase, GSTA-11's /ship review found harness bugs that do not change any frozen prompt, so the run was stopped and restarted from the next commit on this branch, before any Haiku or Opus call. Each result file records the commit it ran under in `prereg_sha`.

- **Cap wait.** Calls refused near RUN_LIMIT woke each other in a loop that starved the event loop, so the run would have frozen at the limit instead of stopping, losing the responses of calls in flight. Now only a call that settles, or the cap stop, wakes a waiting call. The stop rule is unchanged.
- **Red Team fill.** The merged findings went in through a string replacement, so `$'`, `` $` ``, `$&` or `$$` in a model-written finding expanded. One DeepSeek Red Team prompt (d11, gstack, trial 3) carried extra text because of it. That unit is marked incomplete, decided before its findings were read, and not called again. The fill now inserts the text literally.
- **Ledger.** A RUN_LIMIT that is not a number now refuses every reservation instead of none, and a 200 response with an error body settles at the worst case instead of $0.
- **Restart.** Calls in flight when the run stopped were cut off. Their reservations are settled at the worst case in the ledger, and those units are called again, once, under the new commit.
- **Cache timing (second restart, still before any Haiku or Opus call).** Trials 2 and 3 of a gstack unit waited for the whole trial-1 unit, its slowest specialist and its Red Team. On the DeepSeek phase the gap from a reviewer's trial-1 call to its later trials had a median of 5.8 minutes, past Anthropic's 5-minute cache, so most Opus trial-2 and trial-3 calls would have paid a cache write instead of a read: about $32 of Opus input instead of $17, enough to cap-stop the grid early. Now each reviewer prompt sends its later trials as soon as its own trial 1 returns, ahead of other waiting calls, and Red Team prompts, which no later call repeats, go without cache_control. Prompts, models, trials and the plan order of case-arm groups are unchanged; only call timing and cache billing move.
- **Provider and ledger handling (same restart).** A 200 reply with no usage, or a body that is not JSON, now settles at the worst case as an INFRA failure instead of ok at $0. Bun's idle timeout, which would have cut a silent reply at about 5 minutes and lost the longest Opus calls, is off; the 20-minute limit stands. Only a provider failure becomes a terminal INFRA record; a ledger read or write failure stops the run instead. Result files are written atomically. One process writes the ledger at a time: smoke, then run, then score, never at once.
- **Parsing.** A stray `{` in a reviewer's prose no longer hides the findings after it. Rerun over all 350 DeepSeek outputs so far, the new parser reads exactly what the old one read, so no Red Team decision already made changes.
- **Scoring, before any score was computed.** A reply cut off at max_tokens counts with the findings it holds, and the tables report how many replies were cut off. A cell with no valid unit still reports its spend and incomplete count. A judge id the judge leaves out is recorded and not paid for again. The judge's fix diff is checked against `fix_diff_sha256`.
- **Network guard (third restart, during the DeepSeek tail, before any Haiku or Opus call).** A missing key now stops the run before any reservation. Three provider failures in a row with no HTTP status (a network outage) stop the run, so an outage marks a handful of calls INFRA instead of every call left; calls not yet sent stay unsent and run on resume. The judge has the same guard, and only a provider failure or an unparsable verdict marks a judge batch failed.
- **DeepSeek replies cut off before any answer, decided before any score.** At reasoning effort `high` with 32,000 output tokens, DeepSeek used every token without answering on 42 of 70 plain calls, 51 of 340 gstack first-stage calls and 12 of 31 Red Team calls so far. The primary rule stands: a cut-off reply counts with the findings it holds, so an empty one is a miss. The tables add an answered-only sensitivity that drops every unit with such a call, and report the count per cell. A plain unit is one call and a gstack unit merges several, so for DeepSeek part of any gstack-minus-plain gap is the plain prompt failing to finish; the report says so.
- **Judge guard order (during the Opus phase, before any score).** The judge's network guard stopped before it recorded the batch that tripped it, so a resumed score would have sent that batch again and paid twice. It now records the batch as failed first, as the run guard does. Only score.ts changed, and it runs after the grid, so no review call ran under the old code. Scoring runs at the commit that carries this fix; result files keep the commit they ran under.
- **Network stop drains (during the Opus phase, before any score).** The run's network guard threw out of the run, so Bun exited with calls still in flight: their replies were lost, their reservations stayed open, and calls queued behind them could still be sent first. Now the guard sets a stop that every call checks before it is sent, calls in flight finish and are recorded, and the run exits 3. The live run at feb45fa has not tripped the guard, so this matters only for a resume or the exploratory Opus-high cell, which run at the commit that carries it.
- **After the grid, before any score.** The grid finished at feb45fa with no cap or network stop. Before scoring, from /ship findings: an account failure (a rejected key, no credit, a spent quota) now stops the run or the judge at once instead of recording every remaining call as a failure; a 200 reply with an empty usage settles at the worst case (no reply in this run had one); the judge's cache and failure files are written atomically; verdicts are kept per case, so one case's verdict cannot score another case's finding with the same text. Checks on the data, unchanged by any of this: every result's `prompt_sha256` matches its frozen prompt or its saved Red Team prompt (the corrupt d11 file aside), every fix diff matches its digest, no finding gave its confidence as null, and 3 Haiku gstack findings gave their line as null, which the parser reads as line 0; that touches only the file-and-line metric. Seven DeepSeek calls settled at $0 because OpenRouter reported a cost of 0, so DeepSeek spend is slightly understated.
- **After the first score (at b4f825a), before the results.** The rest of the /ship findings, none of which changes this run's data. A null confidence or line now counts as absent, and findings inside a wrapper object are read; rerun over all 1,384 outputs, the only change is one Haiku decoy output whose null lines read as absent instead of line 0, so no Red Team decision and no score moves. An OpenRouter cost of 0 falls back to token pricing. Retries honor retry-after. Fix diffs use a fixed abbreviation, and all 12 digests still match. A result whose prompt hash moved counts as missing; none did. select.ts checks git's exit status, and the test fake binds 127.0.0.1. The Captain (GSTA-2) accepted the seven earlier /ship rulings unchanged and ratified the DeepSeek cut-off rule on 2026-10-28. The exploratory Opus-high cell ran at b4f825a; the tables are scored at the commit that carries this entry.
- **Post-score correction (after the first results, before any merge).** The seven DeepSeek calls that settled at $0 were HTTP 200 replies with `finish_reason: "error"` and empty text, and the harness stored them as answered replies with no findings. This plan counts a unit only when every reviewer call returned, and a reply the provider ended in error returned no review. So these calls now count as failed: `loadUnit` treats a stored reply with stop `error` as missing, and a new call that ends this way is a provider failure settled at the worst case. The /ship review of the results PR found it. It makes 3 DeepSeek plain units (d13 t2, y11 t1, y11 t2) and 4 DeepSeek gstack units (d03 t1, d04 t3, d10 t3, d11 t1) incomplete. Opus and Haiku do not change.
