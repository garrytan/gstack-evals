---
id: 2026-11-09-geva-407-product-value-stage-1-results
kind: finding
title: "plan-ceo-review and office-hours did not run their review procedures unattended on Opus 5.5 (0 of 6 sessions each; plan-ceo-review also 0 of 6 with the owner's standing-preference sentence and 0 of 6 with gstack's opt-in gate), and plain Opus foresaw almost none of the plan family's after-launch record (A 0.012, with that sentence), so no comparison ran: FIX-METHOD on both"
summary: "Both families stopped before any comparison: each skill ran its review in 0 of 6 unattended Opus 5.5 sessions, plain Opus scored A 0.012 on plans, and the judge check fell short on gold."
author: GEVA-407
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-09
status: done
links:
  - 2026-11-08-geva-403-product-value-prereg
  - 2026-11-08-geva-402-ceo-stage-2-results
  - 2026-11-09-geva-412-plan-mode-intentions
  - 2026-11-08-geva-404-findings-standard-takeaways-first
  - garrytan/gstack-evals#275
  - garrytan/gstack-evals#273
  - garrytan/gstack-evals#277
  - tests/trial/image.test.ts
---

# Stage 1 of the product-value eval: the review procedures did not run unattended, so nothing was compared

- We learned that an unattended agent given a skill command and an output template in one prompt tends to write the output and skip the procedure. Opus 5.5 began each skill, then wrote the requested list within 3 to 8 turns. plan-ceo-review's review ran in 0 of 18 Opus sessions across three tries, and office-hours' in 0 of 6. You should check from the transcript that a skill's procedure ran before you pay for a comparison. Here that check cost about a thirtieth of the stage.
- We learned that plain Opus 5.5, asked to improve a real plan, foresaw almost none of what outside users raised and what the project built in the 42 days after launch: A 0.012 on 23 units, with any credit on only 2 of them. From the idea behind the plan it reached A 0.121. You should read the control's floor on an outcome key like this before you build a comparison on it. Ours ended the plan family.
- No comparison ran, so this says nothing yet about whether either skill makes a product better. Both families read FIX-METHOD. Neither is a CUT-CANDIDATE.

## What works

The instrument around the skills held up wherever it could be read.

- Plain models answered in the frozen format. 69 of 69 plain Opus replies parsed in each family, and 171 of 173 plan-family rows and 170 of 173 brief-family rows held a block.
- Where gold labels existed, the judges agreed with them. GPT-6 Astra on Opus lists read Cohen's kappa 0.977 (plan) and 0.965 (brief), real-list kappa 0.954 and 0.928, caught every planted miss, and false-failed 0.042 and 0.063 of good lists. The panel on particle-1 lists read kappa 0.920 and 0.902. These numbers are descriptive, because the check fell short on gold (below).
- The twins tracked. Invented products rebuilt from real histories scored like their public originals on plain Opus: part (a)'s 90% interval 0 to 0.0238, part (b) 0.0079 against its 95th percentile of 0.0079, Spearman 1. So admission could read all 23 calibration units.
- No stock row earned credit on any unit, so a generic list of good product ideas does not score.
- Routes held. Every Sol call went to OpenAI (283 of 283) and every particle-1 call to Particle AI (255 of 255).
- Checking exposure first is cheap. The two six-session Opus smokes that showed the procedures not running cost about 3% of stage 1's paid calls. The plain-model passes cost about 21% and the judge passes about 68%.

## What didn't work

**The procedures did not run.** The frozen detector counts plan-ceo-review as exposed when the transcript shows its mode handoff, an expansion proposal when the mode expands scope, and the content of its review Sections 9 and 10. Opus 5.5 was exposed in 0 of 6 smoke sessions. Two frozen fallbacks followed. With the owner's standing-preference sentence ("Take your recommended option at every decision, scope additions included."), it was exposed in 0 of 6 again, and 0 of 6 blocks carried an expansion proposal. With gstack's opt-in gate, it was exposed in 0 of 6: the gate's hook fired, and the mode handoff still did not run. Across all 18 Opus sessions, 1 ran the mode handoff or read the review-sections file. It chose SELECTIVE EXPANSION and still failed the detector. office-hours was exposed in 0 of 6 Opus sessions: 2 wrote the skill's design doc, and neither doc passed the detector's other checks. On GPT-6.1 Sol and particle-1, each skill was exposed in 0 of 2 sessions.

**Plain Opus sat at the floor on plans.** A is the share of a unit's after-launch items that a review's five proposed changes anticipated, with one change credited to at most one item. Admission needed plain Opus between 0.10 and 0.60. In the plan family it read 0.012 on all 23 calibration units and 0.010 on the 16 public ones, above zero on 2 units. The design assumed a control near 0.20 to 0.35. In the brief family it read 0.121 and 0.104, just above the lower edge.

**The judge check fell short on gold.** The check needs at least 40 anticipated gold items, at most half of them from oracle lists. Plain Opus anticipated so few items that the plan family's check set held 24 (12 real, 12 oracle) and the brief family's 32 (16 and 16). Every judge read NO READ for the shortfall, so admission read NO READ in both families. The floor and the shortfall are one fact seen twice.

## How it works

This is our explanation, not a result.

Each gstack session's prompt held the skill command, the task and the frozen template for the closing list. Opus ran plan-ceo-review's start-up command in its first tool call, a command that comes from the skill text, then read the inputs and wrote the list. The template gave it a finish line it could reach without the procedure, and unattended there is no person to send it back into the review. The standing-preference sentence answers the decisions the procedure would raise, but the sessions never reached them. The opt-in gate checks at the end of a session, and the session ended without the review anyway.

office-hours is built as a conversation with a founder. Unattended, nobody answers its forcing questions, and the sessions went straight to the list.

The plan family's floor probably says more about the key than about the reviewers: most of what outside users raise in the 42 days after a launch can't be foreseen from the plan text. We don't know why the brief family reads ten times higher. One guess: from a brief, a model proposes product directions, which match follow-on capabilities more often than edits to a written plan do.

## Result

Read on build fad7a4ca on 2026-11-09, on 23 calibration units (16 public plans and 7 twins). Plain arms ran 3 passes on Opus 5.5 and 2 on GPT-6.1 Sol and particle-1. In the plan family every arm carries the standing-preference sentence, as the preregistered fallback requires. No comparison ran, so there are no paired differences, intervals or counts of units that got worse to print.

| | Plan family (plan-ceo-review) | Brief family (office-hours) |
|---|---|---|
| Opus 5.5 smoke, block parsed (rule 1) | 6 of 6 | 6 of 6 |
| Opus 5.5 smoke, expansion in the block (rule 2) | 0 of 6; with the sentence, 0 of 6 | not applicable |
| Opus 5.5 smoke, exposed (rule 3) | 0 of 6; with gstack's opt-in gate, 0 of 6 | 0 of 6 (no gate exists) |
| Opus 5.5 sessions that ran the mode handoff or read the review sections | 1 of 18 | not applicable |
| Sol and particle-1 smoke, exposed (rule 4) | 0 of 2 each | 0 of 2 each |
| Plain Opus A, 23 units | 0.0121 (above 0 on 2 units) | 0.1208 (above 0 on 5 units) |
| Plain Opus A, 16 public units | 0.0104 | 0.1042 |
| Plain Sol A, 23 units (descriptive) | 0.0913 | 0.0652 |
| Plain particle-1 A, 23 units (descriptive) | 0.0217 | 0.0688 |
| Twin check, 7 pairs, plain Opus | part (a) 0 to 0.0238; part (b) 0.0079 at its 95th percentile of 0.0079; tracks | read from the plan family, as frozen |
| Stock checks | pass | pass |
| Judge check, GPT-6 Astra on Opus lists | NO READ: 24 gold anticipated (12 real, 12 oracle) of 40 needed, 382 not, 156 lists; catch 1, false-fail 0.042, kappa 0.977, real-list kappa 0.954 | NO READ: 32 gold anticipated (16 real, 16 oracle) of 40, 369 not, 155 lists; catch 1, false-fail 0.063, kappa 0.965, real-list kappa 0.928 |
| Judge check, Opus 5.5 on Sol lists | NO READ: 10 anticipated; catch 0.978, false-fail 0.10, kappa 0.708, real-list kappa 0.503 | NO READ: 20 anticipated; kappa 1, real-list kappa 1 |
| Judge check, panel on particle-1 lists | NO READ: 14 anticipated; kappa 0.920, real-list kappa 0.825 | NO READ: 30 anticipated; false-fail 0.167, kappa 0.902, real-list kappa 0.779 |
| Admission | NO READ | NO READ |
| Smoke rules | FIX-METHOD on the instrument | FIX-METHOD on the instrument |

Plain Sol's plan-family A (0.091) is higher than plain Opus's, but the judge of Sol's lists has a real-list kappa of 0.503, under the 0.6 bar, so that reading is untested on the judge.

## Why null?

No primary ran, so each family's cycle reads the stop.

**Plan family, plan-ceo-review.**

- Exposure: 0 of 6, then 0 of 6 with the sentence, then 0 of 6 with the gate; 1 of 18 sessions ran the mode handoff. The procedure under test did not run, so the skill is untested here, not shown to have no effect.
- Task fit: the key scores what users raised and what the project built within 42 days. Of the skill's six main intentions in the plan-mode intentions map (#277), it reaches two in part: the product that is far better for its user, and thinking 6 to 12 months out. It leaves these untested: challenging the premise (CEO-1, which this key does not score; #273 tested it in part), calibrating scope through one of four modes (CEO-3), the user deciding every plan change (CEO-4), and honesty about how the product fails in real life (CEO-5). No autoplan CEO arm ran.
- Power, floor or ceiling: plain Opus's A of 0.012 is far under the 0.10 floor. The design's MDD (11 points at 80 units) assumed a control of 0.20 to 0.35, and the judge check's gold supply failed with the floor.
- Does today's frontier model do it without the skill? No. Plain Opus foresaw about one item in eighty, so neither arm does the task as built.
- Verdict: FIX-METHOD, on the instrument (exposure) and on task fit (the floor). It is not a CUT-CANDIDATE: the skill's review never ran, and most of what it aims at lies outside this key.
- Next step: for exposure, the next method below. For task fit, grade plan-ceo-review on what its review is meant to change, using the intentions map's rows, as the plan-eng-review intentions preregistration (#276) starts to, rather than on this key.
- Kill rule: if the two-turn smoke below exposes plan-ceo-review in fewer than 5 of 6 Opus sessions, stop testing it unattended in outcome evals, and report to gstack that its review needs a person to run.

**Brief family, office-hours.**

- Exposure: 0 of 6 on Opus, with 2 design docs that failed the detector's other checks; 0 of 2 on Sol and on particle-1. office-hours has no gate, so no fallback existed.
- Task fit: the key credits product directions and user needs, which the builder-mode intention (finding the most exciting version) reaches in part. These intentions are untested here: replacing interest with demand evidence (OH-2), naming the actual person who needs it most (OH-3), finding the narrowest wedge someone would pay for this week (OH-4), ending with one concrete real-world next action (OH-9), and changing the founder's next decision so it follows the evidence (OH-37). A session with no founder can't show most of them.
- Power, floor or ceiling: plain Opus's A of 0.121 (0.104 on public units) sits inside the band, just above its lower edge. Admission still read NO READ, with 32 gold anticipated items of the 40 needed.
- Does today's frontier model do it without the skill? Plain Opus anticipates about one item in eight. Whether office-hours adds to that is untested.
- Verdict: FIX-METHOD on the instrument. It is not a CUT-CANDIDATE.
- Next step: the next method below. If it fails, a simulated founder, as the preregistration names.
- Kill rule: if neither the two-turn shape nor a simulated founder exposes office-hours in at least 5 of 6 Opus sessions, stop testing it unattended.

## Next method

This is the smallest unattended procedure we can see that would get the review sections to run. Nothing in this section has run.

**Procedure: split each session into two turns.**

1. Turn 1 starts the skill the way a person does, with no output template: "/plan-ceo-review Review the plan in plan.md." or "/office-hours Here is what a team wants to build, in brief.md.", unattended and with the standing-preference sentence, and runs until the session ends on its own.
2. Turn 2 resumes the same session with the frozen template and asks for the five changes.
3. The plain and one-line arms take the same two turns, so the arms still differ only in their first line.
4. Exposure reads from turn 1's transcript with the frozen detectors, unchanged. The block parses from turn 2.

Why this one first: it removes the finish line from the turn that should run the procedure, changes nothing in gstack, and is closer to how a person uses the skill (run the review, then ask what to change) than one prompt that holds both. gstack's own unattended route for the CEO review, autoplan's CEO phase, comes second: it was unexposed in #273's smoke, and the intentions map found that Capy's default autoplan run sends the CEO review as a short checklist.

**Admission check, read in this order, each step stopping the next:**

1. Exposure: each skill exposed in at least 5 of 6 Opus 5.5 sessions by the frozen detector, and at least 5 of 6 blocks parsed. This is read before any other paid pass.
2. Floor: plain Opus's A on the 23 calibration units, re-read under the two-turn shape, inside 0.10 to 0.60. The plan family's 0.012 makes this unlikely there, so we would run this step on the brief family only, unless the owner wants the plan family's floor re-read.
3. Judge check: at least 40 gold anticipated items, at least 20 of them real. Stage 1 found 16 real ones in 155 brief lists, so the check set needs about 195 brief lists.

**Cost, as ratios to stage 1's paid calls.** The exposure smoke is 12 Opus sessions, 6 a skill. At stage 1's rate for sessions that stopped early it would cost about 0.03 of stage 1. A session that runs the review sections runs longer, and we budget 10 to 30 times as much per session, so 0.3 to 0.9 (an estimate, not a measurement). If the smoke passes, the brief family's plain re-read costs 0.04 to 0.09 and the judge check with enough gold about 0.4. The Agent notes give the dollar figures.

## Limits and threats

- No comparison ran. Nothing here measures whether either skill helps, on any model.
- Every A reading rests on judges whose checks read NO READ for the gold shortfall. Where gold existed the judges agreed with it, but the check's size rule failed.
- The plan family's numbers carry the standing-preference sentence, which every plan-family arm took after rule 2 tripped.
- The twin check passed at an edge. Part (b)'s value equals its 95th percentile to four places, because almost every plain plan-family pass scores 0 and the re-split distribution is nearly degenerate.
- The Opus judge left cells unlabelled after one resend: 0 in the plan family's production labels and 60 in the brief family's, and 264 and 177 in the check pass.
- Sol and particle-1 skill contrasts would have been descriptive under rule 4 in any case. particle-1 lost 2 of its 46 plain plan sessions, which count against coverage.
- Twin deviations, ruled before any stage 1 session ran. Twins were tried on all 16 public draws, not the first 8, because 6 of the first 8 failed audit; the selection used the audit alone, before any arm output existed. The check ran on 7 pairs, not 8. At 7 pairs the frozen simulation (1,000 runs each, frozen seeds) gave a part (b) false-fail rate on identical twins of 0.022 at ICC 0.5 and 0.003 at ICC 0.843 (bar: at most 0.064), and a catch rate on unrelated twins of 0.725 and 0.912 (bar: at least 0.5). The frozen 8-pair figures were 0.020 and 0.005, and 0.767 and 0.947.
- Infrastructure. Two Opus smoke items, one per family, crashed before any session ran: four items started within 90 seconds and retained the same gstack install tree, every first retain wrote to one shared temp path, and the losing renames failed. Each item got one retry under the preregistration's retry rule, and both finished 6 of 6. The rest of stage 1 ran skill items one at a time. This change fixes the build: each retain now writes its own temp file and removes it on failure, and a new test runs four retains of one 2,000-file tree at once. It fails without the fix and passes with it.
- Provenance. Because of that race, the retained manifest and one Sol smoke item's arm record carry a hash of the retained tar taken while losing writers were still writing (de9a1cf5...). The finished file hashes to c8b3055b..., which the three later records carry, and it extracts to the tree hash its name gives. No score reads this field.
- The plan judges first stopped at their row check, because the opt-in gate smoke and the sentence rerun each hold a gstack session on the same unit and pass. The chain ran again without the gate smoke, which only the exposure detector reads and which was never to be judged.
- One ledger record carries a wrong source in a field that decides nothing. The Agent notes give the record and its appended correction.
- Known stage 2 defects. Stage 1 never ran this code, so no number here reads it, and the next build fixes each one test-first before any stage 2 run. Paired contrasts weight a unit by its surviving passes instead of once per unit. The interim exposure stop does not reach the verdicts. An intent-to-treat primary can never pass the specificity requirement. The stage 2 gold re-check has no minimum, so a judge can pass with most gold cells unlabelled. Pairwise packets read only the top level of a unit's context folder, which may differ from what the agent saw. Stage 2 readings skip a model with no primary reviews without saying why.
- Transposed keys carry no commitments, so the brief family's commitment items are empty for all 7 twins. The judge check builds its packets without commitment items, so its gold, its counts and its kappa leave them out, and this stage reports no commitment reading.
- Authoring checks for an open outcome window only when it replaces the first release, so a record whose first release already holds the merge could be keyed before its 42 days end. Every calibration public unit came from a release on or before 2026-09-27, so each window had closed before authoring began.
- A failed classification is cached as if it were a label, and the draw counts the cached file as one. Every audited calibration unit carries a classifier label, and each twin's matches its original, so this did not fire.
- Mining runs one GitHub search per week of each 42-day window and stops at 10 pages of 100, so a week with more than 1,000 records would lose the rest with no log line. A check of the 19 audited public units found the busiest week at no more than 242 records, so this cap cut nothing.
- Mining also keeps a GraphQL reply that carries both data and errors, and the discussion fetch stops after 2,000 discussions, newest first. Neither writes a log line, and the record can't show whether either dropped anything (the most discussions kept in any window was 10). If either did, the keys hold fewer items. That lowers the anticipated rates and the gold counts, toward the floor this stage reported.
- The name replacer passes each replacement to String.replace as a pattern, so a replacement holding `$&`, `` $` `` or `$'` would put the original name back into a unit. None did: no $ appears in any of the 576 replacements the 19 audited public units used, and the twins use no replacements.
- What did not run: stage 2's comparison and its unit draw, the projection rerun, the authoring of further comparison units (stopped after one batch had started), and the owner's taste check. The taste check is skipped because stage 2's pairwise judges won't run, so the owner's picks would have nothing to check.

## Setup

- Question: on real plans that shipped after Opus 5.5's stated training cutoff, does a review by plan-ceo-review, run as a user runs it, anticipate more of what outside users raised and what the project built after launch than the same model with no gstack, or with a one-line CEO prompt? And the same question one level up for office-hours, on the idea behind each plan.
- Units: 23 calibration units, 16 public plans first posted on GitHub from 2026-07-01 to 2026-09-30 and 7 audited twins, each an invented product rebuilt from one public unit's history.
- Key: U items (needs outside users raised about the shipped feature within 42 days, at least two users or one plus a maintainer's acknowledgement) and E items (capabilities the project shipped within 42 days that extend the feature). Brief-family A credits only what reality added after the plan.
- Arms, plan family: none ("Review the plan in plan.md and make it better."), lens ("Do a CEO/founder-mode review of this plan." first), and plan-ceo-review ("/plan-ceo-review" first). Brief family: none, lens ("Do a YC office-hours review of this idea." first) and office-hours ("/office-hours" first). Each prompt ends with the frozen closing template.
- gstack: garrytan/gstack at 23f9d07ce9e802ac148a8a353228f201655fc5b8 (VERSION 1.98.0.0), default install, GSTACK_SESSION_KIND=unattended. The opt-in gate fallback used gstack-skill-gates settings --ceo-review at the same pin. The plain and lens arms had no gstack install, no skills folder and no drive mount.
- Harness: the trial container used for #273, with a 200,000-token context window, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, web search and fetch denied, and no network except the metering proxy.
- Models under test: Opus 5.5 (anthropic/claude-opus-5-5, Anthropic's API); GPT-6.1 Sol (through OpenRouter pinned to OpenAI, fallbacks off, data collection denied); particle-1 (particle-ai/particle-1 through OpenRouter pinned to Particle AI, data collection denied).
- Passes: plain arms 3 passes on Opus (69 reviews a family) and 2 on Sol and particle-1 (46 each). Smoke: 6 Opus sessions per gstack arm, 2 each on Sol and particle-1, 2 lens sessions on Opus per family; then the plan family's two fallback smokes of 6 Opus sessions each.
- Judges: GPT-6 Astra (openai/gpt-6-astra) labels Opus lists, Opus 5.5 labels Sol lists, and a panel of Astra and Opus labels particle-1 lists, with Gemini 4 Argon (google/gemini-4-argon) as the third vote where they split.
- Dates: 2026-11-09, 01:20 to 04:15 UTC, on one runner VM.

## Replicate it

Keyless, from the repo at this change:

```
bun install --frozen-lockfile
bun test tests/pv tests/trial/image.test.ts
bin/gstack-evals pv dryrun --twin-pairs 7
```

The dry run prints the 7-pair simulation above (69 PASS, 0 FAIL). The stage 1 readings came from `bin/gstack-evals pv readings --stage 1` and the build's smoke rules, run over the sealed run data. `pv readings` does not pass the fallback smokes to the smoke rules, and the gate smoke's rows carry the skill arm's id, so the two fallback smokes were read by calling the build's smokeRules directly with their rerun and gate sessions. This record leaves out the host launch scripts and the sealed units, keys and labels, so the paid readings can't be re-run from the repo alone.

Before you rerun this build, know its gaps. None of them fired in this run, and the next build closes them:

- `pv rows --out` doesn't refuse a path that names one of its inputs, so write rows to a new file.
- `pv score` doesn't refuse a session repeated across `--rows` files, so pass each rows file once.
- Scoring joins labels to rows by session id and reads the current key, so never repair a session or edit a key after labelling.
- `pv author`, `pv transpose` and `pv classify` don't check that `--work` sits on tmpfs. Keep it under /dev/shm.
- Run ids are fixed per ledger item, a second meter opens outside the first one's cleanup, and the reply cache writes one fixed temp path. Run one authoring command per item at a time, and close any lease a refusal leaves open.
- A retried session's arm record carries only the last attempt's cost. Read costs from the ledger, as this post does.
- A launch that dies mid-session keeps attempt 1's outcome only in memory, so keep the one-retry rule by hand. In this run the only failed launches died before any session started.
- `--resume` doesn't compare `--arms` or `--models`, so resume with the same flags. This run resumed nothing.
- A smoke session with no block hides the expansion fallback from smoke rule 2. Every smoke here parsed 6 of 6.
- The copied gstack state has no size cap, so watch the host's disk.
- Usage errors that span lines carry the reason code on the first line only.

## What is held out, and why

The units, their keys, the judge labels and every review stay sealed with the operator, with digests only. A published key would let later models train on the answers, and the source summaries carry text from outside users. The sealed host bundle for stage 1 holds 19,965 entries, 728 of them session transcripts.

## Record

Publication status: unpublished. Before any public use: a claim check by a reviewer from another model family.

| Field | Value |
|---|---|
| Grade | Stage 1 gate readings, descriptive. No confirmatory primary ran. |
| repo_commit | Every paid call ran on build fad7a4ca. After it, this change adds the taste packet render, the retain temp-file fix, a renamed loader variable and lane tests for two files. None of them changes how scored code behaves. |
| prereg | [2026-11-08-geva-403-product-value-prereg](../plans/2026-11-08-geva-403-product-value-prereg/README.md) (#275) |
| data | Sealed host bundle, sha256 fcc98da42b1418a97441b1b48b6046079ab5ff1201bd1bf1f0e0d8acc7c788e9 (held out) |
| reviewed_by | pending |
| reproduced_by | none |

## The claim check

| Claim | Evidence |
|---|---|
| Exposure 0 of 6 per skill on Opus, 0 of 6 under each plan-family fallback | The build's smoke rules on the run rows, with the frozen section 5 detectors |
| 1 of 18 Opus plan sessions ran the mode handoff or read the review sections | A tool-call audit of the 18 raw transcripts in the sealed bundle |
| Plain A, judge checks, stock checks, twin check | `pv readings --stage 1` on build fad7a4ca |
| Twin simulation at 7 pairs | `pv dryrun --twin-pairs 7`, keyless, run before any stage 1 session |
| Shares of paid calls | The ledger record: every lease closed and settled, no cap stop |
| The retain fix | tests/trial/image.test.ts: the concurrent test fails without the fix and passes with it |

## The X hook

We set out to test whether two of gstack's planning skills, plan-ceo-review and office-hours, make products better for real users, graded on what users raised after launch. First we checked that the skills actually ran without a person. On Opus 5.5 they didn't: their review ran in 0 of 18 and 0 of 6 sessions. So no comparison yet, and no verdict on the skills. Also run on GPT-6.1 Sol and particle-1 (YC is an investor in Particle).

## Changelog

- 2026-11-09: first version.

## Agent notes

<details>
<summary>Spend, ledger records, cancellations and the record correction</summary>

- Stage 1 paid calls: $101.52 settled. Runs $32.26 (gstack and lens smokes with both fallbacks $10.56; plain passes $21.70). Judges $69.26 (labels $15.10; checks $54.16). Every lease closed; no cap stop.
- The two first Opus exposure smokes: $1.71 (plan) and $1.25 (brief), $2.96 together.
- The line to date: $223.20 in paid calls of the $4,000 guideline, $121.68 of it unit authoring (the stopped batch's $9.60 included) and $101.52 stage 1.
- Runner VM: one Ubicloud standard-8 for about 3.5 hours at $0.00416 a minute (Ubicloud's price page, read 2026-11-09), about $0.87. It sat under a ledger item with no lease. It was destroyed after the run data was sealed and its RAM-disk copies removed.
- This thread's model use: about 32,000 credits when this post was written, about $32 at $1 per 1,000 credits. Other threads on this line (the preregistration, the build and unit authoring) are not counted here.
- All-in for stage 1 as measured here: about $134 ($101.52 paid calls, $0.87 VM, about $32 model use).
- Next method in dollars: the exposure smoke is 12 sessions, $2.96 at stage 1's stopped-session rate and $30 to $89 at 10 to 30 times that. If it passes, the brief family's plain re-read is $4.37 to $8.74 and the judge check with enough gold about $43.
- Cancelled after stage 1 by the Captain's ruling: unit authoring batch A closed at $9.60 spent of its $315 cap ($305.40 released), batch B at $0 of $121 (all released), and the taste packet render at $0 of $3 (released). The comparison draw and the projection rerun had no ledger items. The ledger has no command that lowers a cap, so each release is an append-only note beside the item's records; the ledger's reader skips notes, so its status still prints the old caps.
- Record correction: the particle-1 plan fallback item's first approval record carries the source "probe". I ran that init by hand while diagnosing a failed batch init, and it wrote. Its cap ($1) and quote are the approved ones; only the source is wrong. Records are never edited, so an appended note gives the real source, gate 1 of the preregistration's /autoplan run on 2026-11-08, and the later raise to $2 carries both quotes with their real sources.
- Caps: the Captain raised the stage 1 caps by $31 a family before launch. The fallback items were recorded from the plan reserve and raised under a pre-approval that applied only if a fallback tripped; both did.
- Timeline, UTC 2026-11-09: 01:20 first launches; 01:25 the two smoke items crash; 01:56 retries; 02:01 smoke rules read; 02:10 fallbacks and plan-family plain passes launch; 04:15 readings; 04:22 run data sealed; then the VM destroyed.

</details>

## Disclosures

- Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.
- Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
- gstack is Garry Tan's own project.
