# Quick look 1: review replay on known gstack bugs (preregistration)

Thread GSTA-11, for the gstack-evals Captain (GSTA-2). Written 2026-10-28, before any paid call. Exploratory: these numbers steer research and support no public claim. Every result file records the commit sha of this file.

## Question

Do gstack's reviewer prompts catch known, real bugs more often than a plain two-sentence review prompt, and at what false-alarm rate and cost? Does gstack's prompt let a cheap model (Haiku 5.5, DeepSeek V4.1 Flash) match Opus 5.5 at review?

## Cases

Twenty diffs from public garrytan/gstack history, mined by `mine.ts` and picked by `select.ts` (both in this folder). `cases.json` holds each case's PR, base and head shas, the filtered diff's sha256, and for a defect the file, line ranges, fix commit and a one-paragraph statement of the defect. The filter drops CHANGELOG.md, VERSION, package.json, bun.lock, generated SKILL.md files, golden fixtures and agents-digest/.

- **Defects (10).** Nine were caught by gstack's own review on the PR branch: a review-fix commit rewrote lines that same PR had added. The case is the candidate that review saw (the fix commit's parent, against the fork point, or against the start of the earlier fix range for a later pass). One (d04) was missed: a later PR, #391, fixed lines that #339 added. One per PR, filtered diff at most 750 lines; `select.ts` lists every excluded candidate and why.
- **Decoys (10).** Merged PRs from #1000 on whose review receipt records no blocking finding, whose diff is at least half non-markdown, and whose added lines no fix in the next 40 main commits rewrote. Each is the nearest in size to one defect.

| id | PR | base..head | defect file | source | lines | specialists | diff sha256 |
|---|---|---|---|---|---|---|---|
| d01 | #3515 | e08612e50d..1f77181596 | scripts/ubicloud/ubi-runner.sh | review-caught | 38 | 0 | 7f3d2ac8c60e |
| d02 | #3540 | 9e3308f65a..115355a38b | bin/gstack-doctor | review-caught | 65 | 2 | 1a8993c9e2d1 |
| d03 | #3527 | c5e13f9167..243ca8ea21 | ship/sections/adversarial.md.tmpl | review-caught | 97 | 3 | 7c84b0ea5e25 |
| d04 | #339 | faff8a2f07..0bff8d66a2 | scripts/gen-skill-docs.ts | missed | 111 | 5 | 94c0d1597eef |
| d05 | #1916 | 9cc41b7163..49035bdd88 | plan-devex-review/sections/review-sections.md.tmpl | review-caught | 129 | 5 | 5e52791ef33e |
| d06 | #3422 | 7bd3fb4a40..3570a6e515 | bin/gstack-design-craft | review-caught | 201 | 5 +RT | 1fc3d0ff61a8 |
| d07 | #3426 | c23d7d48fe..748c45a4a4 | setup | review-caught | 216 | 5 +RT | 6f209fd0b7b6 |
| d08 | #1296 | 7658179879..9a424a9f55 | office-hours/SKILL.md.tmpl | review-caught | 238 | 5 +RT | 6f0e3689de27 |
| d09 | #3475 | 5755601dac..761a22b38b | bin/gstack-doctor-check.sh | review-caught | 633 | 6 +RT | a321bbeeb016 |
| d10 | #3501 | 576839cb8c..a681c00a2b | lib/prose-lint.ts | review-caught | 743 | 6 +RT | 07cb535f30ca |
| y01..y10 | #3517, #3520, #1475, #3474, #3509, #1284, #3397, #3533, #3461, #3514 | see cases.json | - | decoy | 60 to 715 | 2 to 6 | see cases.json |

Digests: cases.json `1c457e46adc0`, plan.json `8bb811987c59`, frozen.sha256 `43bc43755c72` (sha256 of all 144 rendered prompts). Prompts render from gstack at 61e201ec08bc (v1.91.295.0) with `build.ts`, which re-checks every diff digest.

## Arms

- **plain**: one call. The prompt is two sentences: "Review this pull request diff for bugs. Output one JSON object per line for each bug, {severity, path, line, summary}, or the two words NO FINDINGS if there are none." Then the diff.
- **gstack**: the reviewers /review dispatches, one call each, rendered from gstack's own text: the core reviewer (review/checklist.md with Step 4's blocking floor and Confidence Calibration), the Review Army specialists picked by Step 4.5's rules from the diff's size and `gstack-diff-scope` / `gstack-state-matrix detect` flags (`plan.json`), and the Red Team when the diff is over 200 lines or a specialist returns a CRITICAL (its prompt carries that trial's merged specialist findings). Adaptive gating is off (no local history). Not replayed: QA probes, the adversarial and outside-voice step (4.8), Greptile, scope drift, learnings, and every tool step. Each reviewer gets the checklist and diff pasted in, with no repository access. Both arms get the same filtered diff and the same JSON output form.

## Models and trials

claude-opus-5-5 (reference) and claude-haiku-5-5 through the Anthropic Messages API, effort `medium` (the API default for both, pinned); deepseek/deepseek-v4.1-flash-1017 through OpenRouter, `provider.order=[deepseek]`, `allow_fallbacks=false`, reasoning effort `high`, cost read from the response's `usage.cost`. DeepSeek's own endpoint serves only the 1017 snapshot. The open-weight slot follows the 2026-10-27 OpenRouter programming ranking (wiki/research), where DeepSeek V4.1 Flash is first; the run re-reads it with the key before the first paid call and records `meta.as_of`, and any change applies at the next preregistration. max_tokens 32,000. 3 trials per case, arm and model: 20 cases x 2 arms x 3 models x 3 trials = 360 units. No Sonnet, no Fable, no gpt-5.4-mini. No Claude Code session runs, so CLAUDE_CODE_DISABLE_BUNDLED_SKILLS does not apply.

## Metrics

A gstack unit's findings are the union of its reviewers' findings. Findings with confidence 1 to 4 are dropped, as /review's display rule does; plain findings carry no confidence and all count.

- **Recall (primary).** A defect unit is a catch when a finding sits at the defect's file (path or `cause.path`, deterministic) and the judge says it names the defect.
- **False alarms (primary).** A decoy unit is a false alarm when any shown finding is CRITICAL (deterministic).
- **Secondary.** Recall counting only CRITICAL catches; a judge-free proxy, right file and line within 10 of the defect; recall and false alarms with no confidence gate; decoy units with any finding; cost per catch (defect spend / catches, and all spend / catches); input and output tokens per unit.
- **Judge.** openai/gpt-6.1-sol, effort `low`. It sees the defect statement, the fix commit's diff for that file and right-file findings as {path, line, summary}, with arm and model removed, shuffled across arms and models in batches of at most 12. I audit 10 judgments by hand (seeded sample, verdicts mixed) and report agreement.

## Analysis

Per model and arm: recall and false-alarm rate as the mean over cases of each case's rate across its trials, with case-clustered percentile bootstrap 95% intervals (10,000 resamples, seed 20261030). Paired by case: gstack minus plain within each model; Haiku-gstack and DeepSeek-gstack against Opus-plain and Opus-gstack. With 10 cases these are descriptive. No superiority or parity claim is made; the CREW parity rule needs a preregistered margin and more cases than this.

## Money and stop rule

Cap $60, line item `replay-quick`, inside the $500 first cap Garry approved at gate 1 ("Rec"), moved to this week on his "It should be fast like this week". Ledger: Captain drive `ledger/replay-quick.jsonl`, append-only: the approval row first, then a reserve row at the worst case (every input token as a cache write, all 32,000 output tokens) before every call and a settle row with measured usage after. Review calls may commit at most $54; the judge uses the rest. A refused reservation with no call in flight stops the run: an incomplete run, reported as such, never rerun to change a result. 429 and 5xx responses retry up to 3 times; any other failure is recorded as INFRA and the unit is incomplete. Expected spend about $46 (Opus about $41, Haiku about $1, DeepSeek about $2, judge about $3). One short smoke call per provider runs first and counts. Order: DeepSeek, Haiku, then Opus; within a model, trial 1 of each case and arm, then trials 2 and 3 at once so they read the prompt cache. None of the three keys can carry a spend limit set from an ordinary key, so the ledger is the limit.

## Known limits

Nine defects were found by gstack's own reviewers, which favors gstack-style prompts. Reviewers see only the diff. Decoys are clean by the best evidence available, not proven clean. Three defects are in prompt templates, not code. n is 10 defects and 10 decoys.
