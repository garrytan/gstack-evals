---
id: 2026-11-03-geva-220-waste-floor
kind: finding
title: "Wasted tool calls are at the floor in 899 single-task benchmark sessions, so the planned waste comparison on GST-1089 is dropped"
summary: "A $0 rough scan found 4 waste calls in 14,036 and none in any no-gstack cell. The room rule fails, so R48 gives FIX-METHOD and the work moves to crew ship logs."
author: GEVA-220
model: anthropic/claude-opus-5-5
date: 2026-11-03
status: done
links:
  - 2026-11-01-geva-125-untold-discovery-prereg
  - 2026-11-02-geva-153-run-d-discovery-results
  - 2026-11-01-geva-89-stacks-round-1-review-results
---

# Wasted tool calls are at the floor in 899 single-task benchmark sessions: 4 of 14,036 calls, and none in any no-gstack cell

Publication status: unpublished; posting is Garry's. Done: the scan, this file and the author's claim check. Still blocking a post: the /ship review recorded in the PR, a cross-family claim check, and a rerun by another crew.

| Field | Value |
|---|---|
| Grade | Exploratory. One rough scan of two archives, with no frozen detector and no precision or recall audit. Paid calls: $0. |
| Repo commit | None. The scratch scanner is not in the repo; the counts come from the archives below. |
| Prereg | None. The scan ran as a room check for a draft plan that this post replaces. |
| Data | geva153-rund-data.tar.gz, sha256 51f09d0cce87e2b17eee52499691c9f854121c75dd19f7be9c6416c954f4cb4b, and review-data.tar.gz, sha256 cfa9ea1781fb3414be8617882e5279398a72391883f4b4bea2bcf3e356064190, held by the gstack-evals Captain; not public |
| Reviewed by | /ship review of this file, recorded in the PR's receipt. The cross-family claim check is pending. |
| Reproduced by | Pending: another crew, from a clean machine |

## What we found

We scanned 899 archived agent sessions for tool calls that added nothing: a re-run with nothing new, a re-read of unchanged text, a duplicate reviewer, a repeated poll. We found 4 such calls in 14,036, and none in any no-gstack cell. The Opus 5.5 no-gstack control rate is 0 of 381 calls in Run D and 0 of 1,009 in stacks round 1. Every no-gstack model pair and every gstack-against-none pair has a paired task difference of 0, so no minimum detectable difference (MDD) can be computed.

The plan for this work said a waste comparison needs room: an Opus no-gstack share of at least 2%, or 5% in some cell. The archives are far below that. So the waste comparison planned on the transcripts of GST-1089, a planned paid comparison of these three models inside Claude Code, is dropped, and the question moves to where the waste showed up: multi-hour crew ship pipelines.

## How it works

This is an explanation, not a result. Each session chases one task, and cells average 5 to 67 tool calls per session. A short session with one goal rarely repeats itself. When an agent re-runs a check, the tree has usually changed, so the re-run tells it something.

The waste that prompted the question came from crew ship pipelines. A replay of 220 merged pull requests across seven crew repos found that deterministic re-runs at a tree CI had already run were the first gate on 2 of 331 real catches, and crews ran the same deterministic tests 3 to 6 times per head. That waste spans many sessions and CI runs. A scan of one session at a time can't see it.

## Setup

- **Question.** Do Opus 5.5, GPT-6.1 Sol and particle-1 differ in tool calls that add nothing, and does gstack change that against no gstack?
- **Run D.** 635 Lane B sdk-messages logs on 37 Terminal-Bench 2 tasks. Arms none, gstack, gstack-rewritten and placebo on all three models, plus 6 route-d sessions. Models, routes and harness are as in the Run D results post.
- **stacks round 1.** 264 review-unit transcripts on 33 units. Opus 5.5 with none, gstack and tstack; particle-1 with none and gstack.
- **Scanner.** A scratch script written for this look, not a frozen detector. Waste is the union of these four rules over every tool call in the session:
  - **R1, re-run with nothing new.** A Bash call with the same command and the same result as an earlier one, with no edit and no mutating Bash call between them. The headline uses byte-equal results; a second reading strips timing lines, durations and timestamps first.
  - **R2, unchanged file read again.** A read of a file range an earlier read covered, with no write between them and equal text.
  - **R3, duplicate reviewer.** An Agent or Task call with the same subagent type and prompt as an earlier one, with the tree unchanged.
  - **R4a, repeated poll.** The extra calls in a run of adjacent poll calls whose command and result stay identical through the whole run. A run with any changed result is not waste.
  - R6 (asking for approval the brief already gave) is counted and kept out of the share.
- **Pairing.** Per task: the share in each cell, then the mean paired difference over the tasks both cells share.
- **U1, unverified finish (descriptive).** A session that edited is an unverified finish when no program on a fixed list ran after its last edit: pytest, npm, bun, yarn or pnpm test, go test, cargo test, make, tsc, python on a .py file, node on a file, or ./script.
- **Date.** The scan ran on 2026-11-03 UTC over archives already on disk. It added no session.

## Result

| Archive | Model | Arm | Sessions | Calls | Waste calls | Waste share |
|---|---|---|---|---|---|---|
| Run D | Opus 5.5 | none | 74 | 381 | 0 | 0.00% |
| Run D | Opus 5.5 | gstack | 148 | 770 | 0 | 0.00% |
| Run D | Opus 5.5 | gstack-rewritten | 74 | 380 | 0 | 0.00% |
| Run D | Opus 5.5 | placebo | 37 | 188 | 0 | 0.00% |
| Run D | GPT-6.1 Sol | none | 37 | 413 | 0 | 0.00% |
| Run D | GPT-6.1 Sol | gstack | 37 | 530 | 0 | 0.00% |
| Run D | GPT-6.1 Sol | gstack-rewritten | 37 | 521 | 0 | 0.00% |
| Run D | GPT-6.1 Sol | placebo | 37 | 494 | 0 | 0.00% |
| Run D | particle-1 | none | 37 | 804 | 0 | 0.00% |
| Run D | particle-1 | gstack | 37 | 718 | 0 | 0.00% |
| Run D | particle-1 | gstack-rewritten | 37 | 799 | 3 (R2) | 0.38% |
| Run D | particle-1 | placebo | 37 | 703 | 0 | 0.00% |
| Run D route-d | all three | none and gstack | 6 | 13 | 0 | 0.00% |
| stacks round 1 | Opus 5.5 | none | 66 | 1,009 | 0 | 0.00% |
| stacks round 1 | Opus 5.5 | gstack | 66 | 1,150 | 0 | 0.00% |
| stacks round 1 | Opus 5.5 | tstack | 66 | 895 | 1 (R1) | 0.11% |
| stacks round 1 | particle-1 | none | 33 | 2,064 | 0 | 0.00% |
| stacks round 1 | particle-1 | gstack | 33 | 2,204 | 0 | 0.00% |

The normalized R1 reading gives the same counts. No R3, R4a or R6 call fired anywhere. All 899 sessions parsed; 12 made no tool call, and 5 tool calls had no result.

**Paired contrasts.** Every no-gstack model pair (Run D: Opus against Sol on 36 shared tasks, Opus against particle-1 on 36, Sol against particle-1 on 37; stacks round 1: Opus against particle-1 on 33) and every gstack-against-none pair (Run D on 36, 37 and 37 tasks; stacks round 1 on 33 and 33) has a mean difference of 0 with an SE of 0. particle-1 gstack-rewritten against none in Run D is +0.25 points (SE 0.25). Opus tstack against none in stacks round 1 is +0.09 points (SE 0.09). Placebo against none is 0.

**Upper check.** With every reset rule switched off, only 6 Bash calls in Run D and 2 in stacks round 1 repeat an earlier call's command with an identical result. Reads that repeat an earlier file, offset and limit number 17 in Run D (3 with identical text, 2 answered with Claude Code's unchanged stub) and 0 in stacks round 1. Counting all 23 Run D repeats as waste would give 0.34% of its 6,714 calls. The zeros come from the sessions, not from strict rules.

**U1, descriptive only.** Run D, sessions that edited:

| Model | Arm | Editing sessions | U1 | No Bash at all after the last edit |
|---|---|---|---|---|
| Opus 5.5 | none | 19 | 37% | 21% |
| Opus 5.5 | gstack | 41 | 34% | 20% |
| GPT-6.1 Sol | none | 34 | 79% | 12% |
| GPT-6.1 Sol | gstack | 33 | 76% | 6% |
| particle-1 | none | 27 | 52% | 4% |
| particle-1 | gstack | 25 | 56% | 0% |

The two columns rank the models differently: Opus 5.5 has the lowest U1 rate and the highest no-Bash rate. U1 depends on which commands the list knows, and Sol likely checks its work with commands the list misses. This post makes no claim about models from U1. stacks round 1's review sessions almost never edit (8 Write calls in all), so U1 there rests on 3 sessions and is not shown.

## Cost

Paid model calls: $0. The scan used 1.9M host tokens (1,347 Capy credits, about $1.35). Planning, review and drafting before this post's /ship used about 35M host tokens (about 17,600 credits, about $18). Prices: Capy credits at about $1 per 1,000, as of 2026-11-02. No provider tokens were bought.

## Why null? (R48)

- **Exposure.** The question is about the models' own habits, and the gstack arms ran with gstack loaded as the Run D and stacks round 1 posts report. gstack and none both sat at 0, so gstack had nothing to cut. Exposure doesn't decide this.
- **Task fit.** Poor. Single-task benchmark sessions of 5 to 67 calls on average leave little to repeat. The waste we wanted to measure lives in multi-session ship pipelines.
- **Power and floor.** Floor. The control rate is 0 of 381 calls (Opus none, Run D) and 0 of 1,009 (Opus none, stacks round 1). Every no-gstack model pair and every gstack-against-none pair has a paired difference of 0, so the MDD is undefined, and the room rule fails on its own.
- **Frontier competence.** Opus 5.5 without gstack made no wasted call by these rules in 1,390 calls across both archives.
- **Verdict: FIX-METHOD** (floor and task fit). This is not a CUT-CANDIDATE for any gstack skill, because the scan never had room to see an effect. Next step: the crew-log reader and the in-the-wild baseline below. Kill rule: if the baseline finds deterministic re-runs at a tree CI ran, plus review rounds past the cap, under 10% of the measured ship-check wall clock, and no admission or public data meet the second trigger below, the waste line of work stops and no paid suite is built.

## What changes

- The planned secondary analysis of GST-1089's transcripts is dropped: the confirmatory waste families, their admission and custody steps, and the detector PR. Nothing is frozen against GST-1089, and the requests to GST-1089 for extra transcript fields are withdrawn.
- Next, at $0 in paid calls: a reader for crew session logs, in its own PR, and a counts-only in-the-wild baseline of crew ship pipelines, as its own post. The baseline counts deterministic re-runs at a head CI already ran, review rounds past the cap, CI reruns, and which gate caught each bug first. Only counts and digests leave the logs, and no transcript text is committed. Those crews ran almost entirely on Opus 5.5, so the baseline describes one model and compares none.
- A paid ship-task suite keeps its own gate. The plan gave it three start triggers. The first, a claim from the GST-1089 comparison, went with that comparison. The other two still hold. It starts if the baseline shows deterministic re-runs at a tree CI ran, plus review rounds past the cap, above 10% of the measured ship-check wall clock. It also starts if admission or public data show some model and arm cell's waste share at 10% or more, with a model contrast whose 95% interval excludes 0. Otherwise it is not built.

## Limits and threats

- The scanner is rough, with no precision or recall audit, so its error can run either way. Its rules are strict, which can miss waste, and its context handling can overcount, as the next bullet says. The upper check above bounds what R1 and R2 could be missing.
- Run D logs carry no parent_tool_use_id, so each Run D session is scanned as one context, and the scanner doesn't split at compaction. R1 and R2 can then match a repeat by a different context or after a compaction, which overcounts. R2 gives 3 of the 4 counted calls, so those may not be waste at all. An Agent call resets R1 in Run D because subagent edits aren't visible there (7 Agent calls in all).
- Two archives and two task sources. Longer or multi-step tasks may behave differently.
- stacks round 1's Opus none sessions come from one batch, so the tstack-against-none pair crosses batches.

## Replicate it

The scan reads the Run D and stacks round 1 transcript bundles, which are not published, and the scratch scanner is not committed, so outsiders can't rerun it. The tables above are the lines the scanner printed; that record leaves out the scanner source and its per-session rows. The Run D and stacks round 1 posts say how to rerun those sessions.

## What is held out, and why

Nothing held out is read here. Run D uses public Terminal-Bench 2 tasks, and stacks round 1's units come from gstack's public pull requests. The crew logs the next step reads are private sessions, so only counts and digests will leave them.

## X hook (draft)

Exploratory, $0: we scanned 899 coding-agent sessions on Opus 5.5, GPT-6.1 Sol and particle-1 for tool calls that added nothing. We found 4 in 14,036. Single-task benchmark sessions leave almost nothing to waste, so we're measuring multi-hour ship pipelines next.

## Claim check

| Check | Evidence |
|---|---|
| The headline holds at the high end | A count has no interval. With every reset rule off, the upper check gives at most 0.34% of Run D's calls, still under the 2% room rule. |
| A null says what the test could see | Control rate 0 of 381 calls (Opus none, Run D) and 0 of 1,009 (Opus none, stacks round 1). The MDD is undefined because every paired difference is 0, and the post says so. |
| The grade is named | Exploratory, in the record table and the X hook. |
| No forbidden claim | No model claim from U1, no gstack cut claim, no parity claim. |
| The numbers recompute | Sessions sum to 899 and calls to 14,036, and the shares and paired SEs follow from the table rows, as this PR's review checked. |
| Disclosures are settled | The gstack, Particle and OpenAI lines sit in the closing section only, and the X hook has none. |
| The sealed guard passes | gstack-pregate sealed is clear on this branch. |
| Cross-family review | Pending. |
| Rerun by another crew | Pending. |

## Changelog

- 2026-11-03: first version. In the same pull request it replaced a draft preregistration, never merged, after this scan showed the room rule would fail.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
