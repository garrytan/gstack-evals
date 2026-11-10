---
id: 2026-11-01-geva-105-findings-standard
kind: decision
title: "The findings standard: finding files, the claim check, the admission check, R48, weekly numbers and the publication order"
summary: Garry took A1 to E1 and I1 of the insight plan on 2026-11-01. This records the standard every gstack-evals result that could become public now follows.
author: GEVA-105
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-01
status: superseded
links:
  - 2026-11-01-geva-105-gstack-null-review-and-tb2
  - 2026-11-01-geva-89-stacks-round-1-review-results
  - 2026-11-01-geva-93-stacks-round-1-tb2-results
  - GST-800
  - GST-821
  - GST-822
---

# The findings standard

## The ruling

Garry Tan, 2026-11-01 at about 17:02 UTC, approved the gstack-evals Captain's ask on the insight plan (GST-800, written by GEVA-98).

His approval takes every recommendation on that ask. The decisions it took:

- **A1.** Post only from a merged finding file that passes a claim check: the headline holds at both ends of its interval, a null says how big an effect the test could have seen, a model from another lab reviews it, another crew reruns the numbers, and any relationship with a tested company is disclosed.
- **B1.** Each eval repo holds its own finding files. One index of findings and one registry of every run that didn't work out sit in the org drive's research/ folder until two repos are public, then move to one small public repo (proposed name garrytan/evals).
- **C1.** Publication order: particle-1 on the memory test first (gbrain-evals is already public), then gstack's null after GST-618 and its checks, then the rule-delivery result after its frontier rerun.
- **D1.** Publish gstack's null plainly, with how big a gain the tests could have seen and an R48 verdict for why it came out null.
- **E1.** The spend changes: an admission check before a test is built, scoring rules written and attacked in the plan before code, full review kept for scoring code, lighter checked gates for docs and results, one shared rig across the Captains, a preregistration kit, and weekly numbers. The estimated 15 to 25% saved goes back into trials.
- **I1.** From GEVA-100's R48 report: move gstack's operational ceremony out of the always-loaded skill body when a session is one-shot and unattended, and verify it with the before/after skill eval.

Not part of this ruling: F (caps for agenda items 1, 2 and 4 and two admission pilots) and G (planning R1a) were the Captain's calls under org R42, and H (disclosures) is still open.

The plan, with its section numbers used below, is in the Captain drive at plans/insight-plan.md, beside its review record by Opus 5.5, GPT-6 Astra and Fable 5.1. A byte-identical copy is in the org drive at research/insight-plan.md.

## The standard

### 1. Finding files

Every result that could become public is written as a finding file in the plan's section 3.1 template. In this repo a finding file is a wiki post of kind finding in wiki/board/, usually a bundle, so its scripts and their outputs ride along as attachments. The X post links to the file at a pinned commit and says nothing the file doesn't.

Sections, in order:

1. A heading that is the claim in one sentence, with its number and interval.
2. A publication status line: unpublished or published, what still blocks it, what is done.
3. A record table (below).
4. What we found: two or three sentences a non-specialist can follow. For a null: the control rate and the smallest effect the test could have seen.
5. How it works: what we think is going on, labelled as an explanation, not a result.
6. Setup: question and estimand; arms (always a no-skill arm, and a length-matched placebo when added text is the treatment); exact model ids, snapshot dates and provider routes; generation settings; harness and version; tasks with count, source, digest and licence; trials per cell; pairing unit; judges with prompt digests and calibration; seeds; dates. A field the run did not record is named as not recorded.
7. Result: one chart (arms with 95% intervals, cost beside them) and one table. The preregistered primary comes first, verbatim from the scorer; secondaries and sensitivity readings after, labelled.
8. Cost: dollars and tokens per arm, per trial and per success, from the metering proxy, with the price table, its date and how cache tokens were counted.
9. Why null? (R48): required when the primary is null or negative (section 4 below).
10. Limits and threats: floor or ceiling, power, contamination of public tasks, judge agreement and human spot checks, harness adaptations, exclusions and retries, and what the result does not show.
11. Replicate it: a keyless reanalysis whose expected outputs match byte for byte, and a paid one-cell rerun path with its cost and the spread to expect between replicates.
12. What is held out, and why: sealed tasks or keys by digest and sealing commit, whether outsiders can rerun or only verify digests, and when the set may be released.
13. The X hook, drafted in the file and held to the claim rule.
14. The claim check, one row per check with its evidence.
15. Changelog.

**The record table.** The wiki refuses unknown front matter fields, so the template's grade, repo_commit, prereg, data, reviewed_by, reproduced_by and disclosures fields go in a table at the top of the body. Front matter keeps the wiki's own fields: the title is the one-sentence claim, and the status is open until a later file supersedes it. This needs no change to the wiki's rules or its check, because the finding kind already exists.

**Updates.** A merged finding file changes only its status. A review, a reproduction, a correction or the version that goes public is a new post that supersedes it. A correction after a post is a superseding file plus a quote-post of the original, within a day.

### 2. The claim check

It blocks any post. A cross-family model runs it against the data, and the file records each line with its evidence.

- The headline is true at both ends of its interval. A win's headline survives the low end. A null's survives the high end, so it says "no gain we could detect" and gives the control rate and the MDD.
- The headline names the grade when it isn't confirmatory (dev, exploratory, one model).
- No claim the scorer forbade (for example non-inferiority below the size rule), and no parity claim without a preregistered margin.
- Disclosures are settled before the post, not after.
- The sealed guard (gstack-pregate sealed) passes on the file and its bundle.
- Another Captain's crew reruns the reanalysis from a clean machine.

### 3. The admission check

Before any confirmatory preregistration, use data in hand or a small preregistered pilot on a dev split to compute the control arm's rate per task and the MDD at the planned n. Admit only if the control arm has room for the expected effect (for a gain, 100% minus the control rate is at least twice the MDD) and the MDD sits inside the claim margin. For behavior metrics, the control must sit near the floor with room above. The pilot's tasks never enter the confirmatory set.

It is not a fixed band: an 81% control still admits a 19-point gain if the test can see it. Quick look 3 had already measured Opus at 79% on TB2 with no skills before stacks round 1 was built, and nothing forced a decision on it. This check is what forces it.

### 4. R48: Why null?

Every null or negative result gets one bounded Why-null cycle before any rerun: exposure (did the model load the part under test, and did its steps run), task fit, power with floor or ceiling, and whether today's frontier model already does the job without the skill. It ends in KEEP, FIX-METHOD or CUT-CANDIDATE, with a next step and a kill rule. Exposure means the procedure ran, not only that the text loaded: #108 and #109 passed body-load gates in every session while Opus ran almost none of the procedure (GEVA-100). So every skill preregistration freezes a procedure gate and reports the exposure rate beside every verdict. A CUT-CANDIDATE goes to Garry plainly, with the evidence. A skill still null after its harder-task track becomes a CUT-CANDIDATE.

### 5. Methods

From the plan's sections 4 and 5, for every preregistration:

- Preregister before any paid call, pilots included, and fix task-selection rules before outcomes are seen.
- A no-skill arm in every head-to-head, and a length-matched placebo whenever added text is the treatment.
- Measure discovery (was the skill found), load (was it read), compliance (did its steps run) and benefit (did the outcome change) apart.
- Task-clustered paired intervals at 95%, an exact sign-flip p and Holm, or a stated alternative suited to the estimand; name the estimand, the sampling unit and the multiplicity family.
- State the MDD and the power.
- Cost in dollars and tokens per trial and per success, with dated price tables.
- Write failure-scoring and outcome rules (miss, gap, arm stop, outcome categories) into the plan with worked cases, attack them there, and test them against the real pinned SDK with a stub CLI before code.
- Report losses in the same post as any win.

### 6. Weekly numbers

Each Captain reports weekly: the paid-call share of dollars (tracked, with no target), decisions changed per $1,000 (a skill kept, fixed or cut; a lane opened or closed), and findings independently reproduced. There is no posting quota, because a spend-share target can be gamed by buying expensive calls and a findings count by splitting findings.

### 7. Index and registry

The findings index (org drive research/INDEX.md) lists every finding across the four eval projects with its claim, grade, status, commit and link. The experiment registry beside it (research/registry.md) lists every preregistered run, pilot, stop and null, one line each with its preregistration, result, verdict and status, so readers can see what didn't work and nobody can quietly swap tasks until a skill wins. Every crew adds its own lines. Both move to the public repo once two eval repos are public.

### 8. Publication order

1. Now: nothing is posted. Captains write finding files privately and run the claim check.
2. First public finding: the gbrain Captain's particle-1 result on LongMemEval, because its repo is already public, after a primary-source check of its report and receipts, a second-judge sensitivity and the disclosure check.
3. Then gstack's null, #108 and #109 as one finding (2026-11-01-geva-105-gstack-null-review-and-tb2), after GST-618 closes, the publish audit passes, the trial bundles and a direct-key rerun path exist and another crew has rerun it. Garry makes the repo public.
4. Then the harness Captain's rule-delivery result (H10) with its frontier rerun, after its audit.
5. Another crew's private project, after its held-out run.

Garry posts on X, from finding files the Captains hand him: at most one finding a week once the first repo is public, plus a monthly thread linking the month's files and the registry's new nulls.

### 9. Gates by PR class

E1 took the plan's lighter checked gates for docs and results, tried on three PRs first (section 2.3, C3):

- Results posts and docs: a script recomputes every number from the attachments, plus a light review, cap 15M tokens.
- Preregistrations: standard depth, one outside voice, and an adversarial read of the frozen numbers before the sealed dry run, cap 35M tokens.
- Code that moves a scored outcome keeps the full gate, with no pass-count cut line.
- The pilot runs on the next three docs or results PRs, and post-merge corrections are counted as its guardrail.

Org R51 (2026-11-01) sets review depth meanwhile: docs, tests and eval or research write-ups get one reviewer and one round at /ship, the full panel runs only on code that touches security, user data, money or the merge checks, and no change gets more than two review rounds.

<details>
<summary>Agent notes</summary>

Before any confirmatory preregistration, use data in hand or a small preregistered pilot on a dev split (about $20 to $60) to compute the control arm's rate per task and the MDD at the planned n. Admit only if the control arm has room for the expected effect (for a gain, 100% minus the control rate is at least twice the MDD) and the MDD sits inside the claim margin. For behavior metrics, the control must sit near the floor with room above. The pilot's tasks never enter the confirmatory set.

</details>
