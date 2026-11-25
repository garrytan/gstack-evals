---
id: 2026-11-24-geva-588-state-machines-review-prereg
kind: plan
title: "Preregistration: does gstack's State Machines review specialist catch real bug-introducing changes? The specialist on against off, a plain review, its steps in plain words and pstack, scored by rerunning each check the reviewer leaves"
summary: "Does gstack /review with the State Machines specialist forced on leave a test that catches a real state bug more often than with it removed? Five arms, Opus 5.5 and particle-1, no judge."
author: GEVA-588
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-24
status: open
links:
  - 2026-11-24-geva-586-state-machines-formal-verification-evals
  - 2026-11-09-geva-487-pstack-checks-prereg
  - 2026-11-17-geva-521-pstack-checks-results
  - 2026-11-09-geva-409-state-machines-prompt-prereg
  - https://github.com/garrytan/gstack/tree/d74ee528b6df9ddb945be2103a24544babe76e65/review/specialists
  - https://github.com/garrytan/gstack/blob/d74ee528b6df9ddb945be2103a24544babe76e65/scripts/resolvers/review-army.ts#L343
  - https://github.com/cursor/plugins/tree/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/harness/pstack/claude-code
  - lanes/outcome-skills/smreview/
attachments:
  - f7599e6649ab6809093d1d203b7790aae083adc5a401fb2c4c7d68d2602ab423  power.py
  - 5a734745f3f29c7087bf900308a166e176aeab0eff2cf4c9304a3354d6db8131  power.txt
  - 357453c330dea1c45387e67ffcd0e22854297bda96e47da3380d6924e10612da  prereg.json
  - 3d961e5eefee2e056c9ecc5dfe2f9d292ddb7c0fa0f56bca98bedba45c909c61  supply-count.md
---

# Preregistration: does gstack's State Machines review specialist catch real bug-introducing changes?

## Approval

The Captain picked this design on 2026-11-24 (Review record). No paid call runs until this post merges and the Captain records each item's cap in the approvals file, and none runs before 2026-11-28 06:00 UTC. The draw, order and bootstrap seeds in the attached prereg.json were minted once, on 2026-11-24 at 23:05 UTC, before any draw, label or session. Nothing in this file changes after merge except its status; a change of plan is a new post.

## ELI5

gstack's /review hands parts of a review to specialists. One of them, State Machines, looks for bugs in code that moves records between states: a proposal that gets accepted, a hold that gets released, an invitation that gets withdrawn. It asks the reviewer to list every kind of record and every action, write down what should happen for each pair, and check that a test covers it. It has no eval behind it.

This test shows a reviewer a real commit from an open-source project that later turned out to have brought in a state bug, and asks for a review. If the reviewer finds a bug, it leaves a test. Then a machine reruns that test three ways: on the code with the bug, on the code with the project's real fix, and on the buggy code after a harmless edit. The test counts as a catch only if it fails on the bug, passes with the fix and still fails after the harmless edit. No judge decides anything.

Five reviewers try each change. G+ is gstack's /review with the State Machines specialist forced on. G0 is the same /review with the specialist removed. N is a plain "review this for bugs" with no gstack. C is the specialist's steps written out in plain words, with no gstack. P is pstack's formal-verification skills, then a review. The main question is G+ against G0: does the specialist, when it runs, catch more real bugs?

## Before → after

Before: the specialist runs inside every gstack /review whose change its detector flags, and nothing measures whether it catches anything. gstack's commit history shows it produces findings; whether they are real bugs is unknown.

After: a frozen test on 20 to 40 real state-bug-introducing changes, on Opus 5.5 and particle-1, two sessions a cell. It reports each arm's catch rate with a 95% interval, the paired G+ minus G0 difference pooled over both models (the verdict), and the secondaries: shipped gstack against a plain review, the plain-words steps against G+, and pstack against G+. It reports false alarms and the size of every change beside each result. It ends in a findings post with a KEEP, FIX-METHOD or CUT-CANDIDATE call for the specialist.

## Why it matters

A review specialist that runs often costs tokens on every review. If it catches real state bugs that a plain review misses, it should run more often. If it doesn't, it should run less, or its steps should change. Builders of review agents face the same question for every specialist they add, and a test scored by the project's own fix, with no judge, is a cheap way to answer it.

## What caused this work

The state machines and formal verification research post (GEVA-586) ranked this second of four evals. The owner approved eval 2 at about $1,500 paid and $2,300 all-in (approvals, B1). The Captain asked for a preregistration with arms N, C, P, G and G0, pstack-checks' catch rule, false alarms counted, and a keep, widen or cut decision.

## Big decisions

1. **Which gstack arms (B1).** G+ forces the specialist on every review and G0 removes it, both as small commits on top of the gstack pin. Shipped gstack (G) is then G+'s cell on units where the detector fires and G0's cell elsewhere, derived per unit at analysis. This is the only way to measure the specialist itself, because the detector fires on 6 of 221 changes (section 8).
2. **What the reviewer sees (P).** The bug-introducing commit's hunks, re-based onto the fix's base, so the reviewer sees real code that shipped with the bug and the scored tree is one the oracle already ran on. The construction is part of the result: every unit lists which hunks were kept, every result shows the change's size, and one sensitivity row leaves out changes of 10 lines or fewer (section 2).
3. **Every arm leaves a test (C1).** Every arm's task turn ends with "If you find a bug, leave a test in the repository that fails because of it." A review that names the bug but leaves no test scores a miss in every arm alike.
4. **When this becomes a findings post instead of a counted run.** Fewer than 20 counted units, a failing N floor in the pilot, or a pooled G+ minus G0 MDD over 25 points means no counted run (section 13).

## Decision

What we do for each way the result could come out (R97). The primary verdict is G+ minus G0 pooled over both models (section 10).

| Outcome | What we do |
|---|---|
| G+ beats G0, verdict HELPS, by 10 points or more | KEEP the specialist, and ask gstack's maintainer to widen its dispatch: today's detector would give that gain to about 3% of these changes. Consider widening its scope past proposals, holds and approvals, as the research post says |
| G+ beats G0, HELPS, by under 10 points | KEEP as shipped; no widening |
| No measurable difference | One R48 "Why null?" cycle (section 10). If G+ ran the specialist in at least 80% of its sessions and N's floor held, the specialist's run on every flagged review is a CUT-CANDIDATE. Under 80% exposure, FIX-METHOD |
| G+ worse than G0, HURTS | CUT-CANDIDATE, with the harm stated |
| A gain on one model only, pooled null | No widening and no cut. Report it per model as a lead with its interval, and keep the specialist as shipped until a test on that model alone says more |
| Pooled HELPS carried by one model | The pooled call stands, and the post names the model that carries it |
| C beats G+ by 10 or more (HELPS) | The steps work better as the reviewer's own task than as one specialist among many. Propose to gstack's maintainer that /review run them in the main pass on state-shaped changes |
| P beats G+ by 10 or more (HELPS) | Add a model-check step to review/specialists/state-machines.md, the research post's fold-in, crediting pstack's author, Lauren Tan |
| G against N (either way) | Decides nothing about the specialist. It is the no-gstack comparison (R44), reported plainly, and a loss goes to gstack's maintainer as a finding about /review |

## Pilots

The pilot is one part of the run for all arms: 6 units, both models, one session a cell, under one ledger item (sr-pilot, $180). Each arm's budget is its planned counted cost at 40 units, sessions and VMs; its pilot cap is its planned share of sr-pilot, at most a tenth of its budget. Section 13 gives the gates in full.

| Arm | Budget | Pilot cap | Part ran | Judge check | Supply |
|---|---|---|---|---|---|
| N (no gstack) | $224 | $20 | the read audit finds no gstack or pstack file read; N catches in at least 2 of 12 sessions (the floor) | none | the walk yields 6 pilot units and at least 20 counted units |
| C (no gstack) | $416 | $35 | the read audit finds no gstack or pstack file read; the session reviews and leaves its checks | none | the same units as every arm |
| P | $416 | $35 | P loaded both pstack skills in at least 10 of 12 sessions, by #358's exposure reader | none | the same units as every arm |
| G+ | $608 | $50 | the State Machines specialist's file was read or its matrix helper ran in at least 10 of 12 sessions | none | the same units as every arm |
| G0 | $512 | $40 | Review Army reached in at least 10 of 12 sessions, and the specialist ran in none | none | the same units as every arm |

## Judge check

Judge: none

## Interim look

Planned paid spend: $2.1k
At: half the counted units, rounded up, in the draw's order, once every one of them has all its planned G+ and G0 sessions on both models
Stop bounds: bootstrap p under 0.003 for the primary contrast, either direction, at the look; p under 0.049 at the end
Other looks: none

## Implementation plan

Everything below holds as written. Where it reuses pstack-checks' rules ([its preregistration](../2026-11-09-geva-487-pstack-checks-prereg/README.md), "#358" below), the code it names is that eval's code, unchanged, and this post says so.

### 1. Claim and construct fit

**Primary claim.** On real state-bug-introducing changes, gstack /review with the State Machines specialist forced on (G+) leaves a test that catches the bug more often than the same /review with the specialist removed (G0), pooled over Opus 5.5 and particle-1.

**Why G+ against G0 and not G against G0.** Shipped gstack dispatches the specialist when its detector says true or unknown (review/sections/review-army.md line 56 at the pin). The detector fires on 6 of the 221 changes this pool supplies, so shipped G equals G0 on about 97% of units by construction, and G minus G0 would measure the detector's rarity, not the specialist. G+ against G0 asks what the specialist does when it runs. G against N asks what shipped gstack does.

**Construct fit.** A review's value is in the bugs it finds. A test that fails on the bug, passes with the real fix and survives a harmless edit is evidence the reviewer found this bug and not just noticed a change. The rule misses a review that names the bug in prose and leaves no working test; C1's suffix asks every arm for the test, so that cost falls on every arm alike.

**Decisions this result changes (R97)** are in the Decision section above.

### 2. Units

**Pool (679 rows).** Three sources, frozen by id in lanes/outcome-skills/smreview/units.ts:

- 41 known state bugs: the SWE-bench-Live MultiLang rows #358 or the state machines prompt eval used. The 7 SWE-rebench leaderboard units need a Harbor export this build lacks, so they are left out.
- 67 MultiLang rows that the state machines prompt eval's two labellers both marked a defect and state-shaped.
- 571 SWE-rebench-V2.1 rows (revision 26c0145d) that pass #358's keyword screens, in a language the harness reads, at most 3 a repository in id order.

**The bug-introducing commit (BIC).** SZZ on a full clone: git blame -w at the fix's base of every non-trivial line the fix deletes from a non-test source file, or, when it deletes none, the lines on each side of its insertions. The BIC is the commit blamed for the most lines, ties to the smaller sha. Gates, in order: a BIC exists and has one parent (E_SR_NO_BIC, E_SR_BIC_MERGE); it carries at least half the blamed lines (E_SR_BIC_SHARE); it changes at most 2,000 lines (E_SR_BIC_SIZE); and the change under review brings back at least half of its blamed lines (E_SR_PR_MISSES_BUG).

**The change under review, plainly.** It is constructed, not a real pull request. We take the BIC's diff with no context lines, drop CLAUDE.md, CLAUDE.local.md, AGENTS.md and .claude/ paths, and reverse-apply it at the fix's base with `git apply -R --unidiff-zero --reject`. Hunks that no longer apply are left out and listed in the unit's bic.json. The session repository has two commits: origin/main is the fix's base with the kept hunks reversed, and HEAD is the fix's base itself. So the reviewer sees the BIC's code as it stood just before the fix, inside a tree the project built and tested. Across the 221 that pass, the median unit keeps 89% of its BIC's hunks (68 keep all, 153 leave some out), the median change is 100 lines (quartiles 44 and 324), and 15 change 10 lines or fewer. Three things follow, and the results state each one:

- every per-unit row lists the BIC's hunks, the kept ones and the change's added and deleted lines;
- every contrast prints a no_small_pr row that leaves out changes of 10 changed lines or fewer;
- a reviewer of the real BIC saw the code around it as it was then; ours sees it as it was later.

**Supply.** 221 of 679 pass the BIC gates, from 195 repositories (supply-count.md). After labels, the oracle and the harmless-edit check, the draw most likely yields about 25 units, so about 19 counted after the pilot, with a range of 14 to 34. That central figure is under this plan's 20-unit floor, and the draw decides (section 13).

### 3. Labels and the draw

**Labels.** #358's labels gate, unchanged: a unit passes when both labellers (GPT-6 Astra and Opus 5.5, #358's packet, questions and strict reply reader) answer yes to "defect" and yes to "state-shaped". A reader with no answered reply gets null and the unit fails closed. Labels come from three sources, the first that has a unit wins: the state machines prompt eval's records (28 units), #358's published test units (12 units, 7 also in the first), and this eval's own sr-labels calls for the 185 V2.1 units that have none. The labellers decide which units are in the eval, never a score, so R78's judge check does not apply to them.

**Oracle and harmless-edit gates.** #358's, unchanged, run at the fix's base: the fix's fail-to-pass tests fail before the fix and pass with it, stably, and #358's harmless edit (the neutral tree) leaves that true.

**The draw.** The units that pass the BIC gates, ids sorted, then one Fisher-Yates shuffle with seededRandom(draw_seed). The walk takes each unit through labels, the oracle and the harmless-edit gate, at most 3 a repository. The first 6 kept units are the pilot's and are never counted; the next 40 are the counted run's. A gate with no record stops the walk where it stands, so the walk resumes as records arrive and its order never changes.

### 4. Arms

Every arm runs in Claude Code 2.1.312 through claude-agent-sdk 0.2.174 with `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`, on #358's session path. The task turn is the arm's text, a blank line, then one suffix every arm shares:

> The pull request is checked out here: HEAD is the change and origin/main is its base. If you find a bug, leave a test in the repository that fails because of it. Don't stop to ask.

| Arm | Task text | Installed |
|---|---|---|
| N | Review this pull request for bugs. | nothing |
| C | The specialist's steps in plain words (below) | nothing |
| P | /create-formal-verification-skill model the state machines this pull request changes, and use /statechart to visualize the flows it changes. Then review the pull request for bugs. | pstack at c742dd61 |
| G+ | /review | gstack e69e29da: the pin with the specialist dispatched on every review |
| G0 | /review | gstack 6872290c: the pin with the specialist removed |

C's text, word for word: "Review this pull request for bugs in its state machines. Find each record the changed code handles that has a kind and a pending status an owner action settles, such as proposals, holds, approvals, review queues or invitations, and read the code after the change, not only the changed lines. List every kind the settle path handles and every action that settles a pending record. For each kind and action, write down the result the owner expects, from what the kind means rather than from what the code does. Find the test that exercises exactly that kind and action and checks that result. Report each pair no test covers, each pair where the code gives a different result than expected, and each branch that sends several kinds down one destructive path."

**gstack.** Pin d74ee528 (v1.103.2.0), installed with `./setup --host claude --loadout lite`. lanes/outcome-skills/smreview/gstack_arms.py makes G+ and G0 as one commit each on top of the pin (trees 51c37ad9 and 1151ad70), and every G session checks its home against its tree before it starts. G+ and G0 send the same task turn; only the installed gstack differs. A session checks its home by tree, not commit, so a home rebuilt on another machine (whose git identity gives a different commit sha) still serves its arm. Shipped G is derived (section 10) and never run.

**Where the arms run.** N and C have no gstack, no pstack and no Capy drive in their environment. P has only pstack's plugin tree. G+ and G0 have only their gstack home. Each session runs in a Harbor docker container built from the unit's prepared tree, which holds no Capy drive and no ~/.claude/skills of its own, so the no-gstack arms are clean by construction; a read audit runs after the run and is reported as a descriptive check.

**The wrap-up turn.** #358's CHECKS.json turn, unchanged (pfchecks/arms.ts WRAPUP), so every arm's tests are found and rerun the same way.

**Departures from the research post's eval 2.** Its C was a TLC model check; here C is the specialist's own steps in plain words, because the question is the specialist, and P carries the model-check idea (so the post's "add a model-check step" decision rides on P against G+). Its P used /statechart alone; here P runs both pstack skills, as #358 invoked them. Its G and G0 become G+ and G0 (Big decision 1). Its target of 48 units becomes 20 to 40 (section 2).

**Why GPT-6.2 Sol is not tested.** This is a finding, not a budget cut. At the pin, scripts/resolvers/review-army.ts line 343 reads `if (ctx.host === 'codex') return '';`: gstack's Codex host strips the whole Review Army section from /review, so a Codex /review never dispatches any specialist. On Sol in Codex CLI (R110), G+ and G0 would be the same arm, and the specialist has no effect to measure. The models under test are Opus 5.5 in Claude Code and particle-1 (particle-ai/particle-1 on OpenRouter, through Claude Code as #358 runs it).

### 5. Session limits and how sessions end

The task turn has 5,400 seconds of wall time and 250 turns; the wrap-up turn has 300 seconds and 20 turns. Allowances per session: Opus 5.5 $13 for the task and $13 for the wrap-up, particle-1 $5 and $0.50. #358's rules decide how a session ends and what counts as a harness gap, an upstream gap or an arm stop, unchanged (its section 5, pfchecks/run.ts). A cell with a gap scores the mean of its other sessions; a cell with no scored session has no pair.

### 6. Session order

Each unit's sessions (arm and model) run in one seeded order: stream order_seed + 0 for the pilot and order_seed + 1 for the counted run. Units run in the draw's order.

### 7. Attacks on the scoring, answered before code

- **A test that fails on any change.** The harmless-edit rerun stops it: it must still fail after a no-op edit to the same files.
- **A test that flags something real but not this bug.** It fails with the fix too, so it is no catch. It counts as a false alarm (section 9).
- **A review that names the bug and leaves no test.** A miss in every arm alike, by C1.
- **The constructed change makes the bug easier or harder to see.** Stated plainly in section 2; the no_small_pr row and the per-unit hunk lists let a reader check it.
- **The specialist's text leaks into C.** C is the specialist's procedure by design; what C lacks is gstack's dispatch, its matrix helper and the rest of /review. C against G+ measures that packaging.
- **G0 is not gstack.** G0 is the pin with one specialist removed and every other part of /review intact, checked by its tree hash.

### 8. Exposure (R48's procedure gate)

Read keylessly from each session's SDK stream and Claude Code's own transcript, which holds the subagents' calls (smreview/exposure.ts):

- **army**: the session read review/sections/review-army.md, so /review reached its specialist step.
- **ran**: the session read review/specialists/state-machines.md or ran `gstack-state-matrix outfile` or `check`.

G+ should show ran in every session and G0 in none. Exposure prints beside every verdict, and the pilot gate reads it (section 13).

**The detector finding, in its own right.** gstack's detector (lib/state-matrix.ts at the pin, vendored unchanged as smreview/detect.ts) dispatches the specialist when the added code lines name a subject (proposal, hold, approval, pending) and an action (accept, approve, reject, release and the like). On this pool it fires on 6 of the 221 changes under review, on 12 of the full BIC diffs of those 221, and on 25 of 424 BIC diffs overall. These are changes their projects later fixed as state bugs, and both labellers called the labelled ones state-shaped. So on real state bugs, shipped gstack's specialist runs about 3 times in 100. This holds whatever the counted run finds.

### 9. Scoring rules

**Catch.** #358's rule, code-decided (pfchecks/score.ts scoreSession): a test the agent left fails 3 of 3 runs on the change under review (HEAD, the fix's base), passes 3 of 3 with the real fix applied, and fails 3 of 3 after a harmless edit. A session catches when any test it left does. The session's score is 1 or 0; a gap is no score.

**False alarms.** A test the agent left that fails 3 of 3 on the change under review and is no catch. It flags something, but not this bug. Counted per session, printed per arm and model, and deciding nothing.

### 10. Analysis

A cell (unit, model, arm) scores the mean of its scored sessions. G's cell is G+'s where the detector fires on the unit's change and G0's elsewhere. Every contrast is paired by unit and model, b minus a, with #358's bootstrap over repositories, stratified by model, 10,000 resamples, seeded with bootstrap_seed.

| Contrast | Role | Verdict rule |
|---|---|---|
| G+ minus G0, pooled over both models | primary | HELPS when the 95% interval is above 0 and p < 0.049; HURTS when below 0 and p < 0.049 |
| G minus N, C minus G+, P minus G+ | secondary | the same at p < 0.05 |
| G+, G0, C and P each minus N | descriptive | no verdict |

Each contrast also prints per model, and beside it five readings: gaps scored as misses, arm refusals as misses, no_small_pr, and the units where the detector fires and where it is silent. Each arm's catch rate prints per model with its Wilson interval. A run that stops on a cap, or that lacks any session its plan lists, is INCOMPLETE: it prints no HELPS or HURTS and no decision, and it is never retried to change a verdict.

**Why null? (R48).** A null gets one cycle before its call: did G+ run the specialist (exposure); do the units fit (state-shaped labels, the size and hunk rows); was there power and room (N's and G0's rates against the MDD); and does the frontier model already do it unaided (C and N against G+). The call is KEEP, FIX-METHOD or CUT-CANDIDATE, and a CUT-CANDIDATE goes to the owner in plain words.

### 11. Power and MDD

By simulation (power.py, seed 1, numpy 2.3.5, output in power.txt): units differ in difficulty, drawn from a beta with concentration 2 or 5 around a G0 rate of 20% on Opus and 10% on particle-1, or 35% and 15%; two sessions a cell; 80% power at a two-sided 5% level. The smallest pooled G+ minus G0 difference the run detects:

| Counted units | MDD, points |
|---:|---|
| 15 | 16.3 to 22.0 |
| 20 | 15.7 to 18.4 |
| 25 | 13.4 to 16.7 |
| 30 | 11.3 to 14.8 |
| 40 | 10.6 to 13.1 |

At the likely 20 units, the run can see a gain of about 16 to 18 points, not the research post's 10. A 10-point gain would read as no measurable difference, and the results say so. After the pilot, power.py reruns at the counted n the draw supplies, with the pilot's G0 rate per model (at least 5%) and concentration 5; that MDD is the one the stop rule reads.

### 12. Money

One line, state-machines-review, with crew use counted. Planning prices per session: Opus 5.5 N $2, C $4, P $4, G+ $6, G0 $5; particle-1 at a fifth of those; $0.40 of VM per session. These are guesses: no /review session has run on either model in this harness.

| Item | Cap | What it pays for | Planned at n = 22 | Planned at n = 40 |
|---|---:|---|---:|---:|
| sr-labels | $40 | both labellers on the 185 V2.1 units with no labels | $13 | $13 |
| sr-vm | $400 | the oracle and harmless-edit walk, and every session's runner | $236 | $380 |
| sr-pilot | $180 | 6 units, five arms, both models, one session a cell (60 sessions) | $175 | $175 |
| sr-opus | $1,750 | the counted run on Opus 5.5, two sessions a cell | $924 | $1,680 |
| sr-particle | $350 | the same on particle-1 | $185 | $336 |
| Paid total | $2,720 | | $1,533 | $2,584 |
| Crew, counted | $250 | this thread's model use | $250 | $250 |
| All-in | $2,970 | | $1,783 | $2,834 |

**How the caps work.** Each item is a hard cap on the ledger. A session the ledger cannot admit does not start, and the item stops as INCOMPLETE. The pilot costs under a tenth of the paid line ($180 of $2,720), as R111 asks.

**Re-pricing after the pilot.** The pilot's mean cost per session, by arm and model, replaces the planning prices. The counted n is the smaller of what the draw supplies and the largest n whose re-priced cost fits sr-opus and sr-particle with 15% of each left unspent. If the re-priced all-in at that n passes about $3,400, it goes to the Captain before any counted session. A cap changes only by a dated entry the Captain records in the approvals file.

**Why above the research post's figure.** The post priced eval 2 at about $1,500 paid, $2,300 all-in, for 48 units. Five arms on two models at two sessions a cell cost more per unit than it assumed; the caps are sized for n = 40 and the likely run (n near 22) lands at about $1,800 all-in.

### 13. The pilot, and when the counted run does not happen

The pilot runs the first 6 drawn units, all five arms on both models, one session a cell. It is never counted. It passes when all of these hold:

1. **N floor.** N catches in at least 2 of its 12 sessions (at least 1 in 10). Else FLOOR: stop.
2. **The part under test ran (R111).** G+ ran the specialist in at least 10 of 12 sessions; G0 reached its Review Army step in at least 10 of 12 and ran the specialist in none; P loaded both pstack skills in at least 10 of 12 sessions, by #358's exposure reader (the formal-verification skill's body in the session and a Read of statechart's SKILL.md). A failing P or C is fixed or left out and reported as left out. A failing G+ or G0 means the primary cannot run: stop.
3. **The harness works.** At most 6 of the 60 sessions end with a harness gap, and each gap's cause is named. Gaps print per arm and model with their reasons. One reason gets its own line: a session whose git work leaves the change under review's commit out of its history (a checkout of origin/main left in place, an amend or a rebase) scores as base_mismatch and drops out of its cell, and /review does more git work than N or C, so the pilot and the results report base_mismatch per arm and never read it as an arm effect.
4. **Supply.** The walk yields at least 20 counted units beyond the pilot's 6.

**The frozen stop rule.** Fewer than 20 counted units, a failing N floor, or a pooled G+ minus G0 MDD over 25 points (section 11) means a findings write-up, not a counted run. The write-up carries the supply counts, the detector finding, the Sol finding and the pilot's readings, and publishes no verdict.

**Order of work after merge.** Labels, then the draw's walk (oracle and harmless-edit gates on VMs), then the pilot, then the pilot readout to the Captain with re-priced costs and the MDD at the supplied n, then the counted run once the Captain records its caps.

### 14. The one look (R113)

The paid plan is above $500, so the run takes one look, and no other. It comes when half the counted units, rounded up, in the draw's order, each have all their planned G+ and G0 sessions (two a cell) on both models. A unit in that half that is not finished is waited for, never replaced by a later one. The look reads only the primary contrast on those units. If its bootstrap p is under 0.003, in either direction, the counted run stops there and that is its verdict. Otherwise the run finishes, and the final primary test uses p < 0.049. No other arm is read at the look.

### 15. Build, pins, dry run and stops

- **Code.** lanes/outcome-skills/smreview/, run as `gstack-evals sr` (pool, bic, labels, draw, plan, session, score, analyze, look, items). Error codes E_SR_* in docs/errors.md.
- **Pins.** gstack d74ee528 with G+ e69e29da and G0 6872290c; SWE-rebench-V2.1 revision 26c0145d, tool commit 5792b785; SWE-bench-Live MultiLang revision eb09c2e5; pstack cursor/plugins c742dd61 (harness/pstack/claude-code, plugin 0.15.36); Claude Code 2.1.312; claude-agent-sdk 0.2.174. prereg.json holds the full hashes and the code checks them.
- **Model roles at the gstack pin (checked 2026-11-25 against gstack #4811, 9a550bca).** In G+ and G0, /review gives no role a model of its own: the specialists, the Review Army subagents and the Claude adversarial pass run on the session's model. The one role that would pick its own model is the adversarial step's Codex second-model review, whose fallback at the pin is gpt-6-astra; the session image has no Codex CLI, so that step reports Codex as not installed and never runs. The pin's older defaults elsewhere (gpt-6-astra in /codex, claude-fable-5-1 as an eval judge and as the fable alias) belong to skills these arms never call. So the pin stays at d74ee528, and the pilot's transcripts are searched for any Codex call, reported if one appears.
- **Dry run, no model called.** A stub session on a real unit (google__starlark-go-599) drives the image, both gstack homes and their commit checks, the exposure reader, the catch and false-alarm scoring, the analysis and the look, and passes 54 of 54 checks. #358's own dry run still passes 68 of 68 on the shared code.
- **Not shown by the dry run, and checked by the pilot.** That /review runs to its end unattended on each real model, that Review Army's subagents run inside the session limits, and what a session costs.
- **Stops.** A cap stop is INCOMPLETE. A pilot failure under section 13 stops the eval. Any change to an arm, a gate or a rule after merge is a new post.

### 16. Outside terms and public safety

SWE-rebench-V2.1 is CC-BY-4.0 and credited. SWE-bench-Live rows are read as #358 reads them. pstack runs as published at a pinned commit, invoked the way its docs describe, and its author is credited by name; nobody contacts its author. The pool, BIC records and label files stay in the eval's handoff folder, and this post commits only their counts and sha256s (supply-count.md). There are no sealed units: every unit is a public fix in a public repository.

### 17. How the rules map

| Rule | Where |
|---|---|
| R97, a decision for each outcome | section 1 |
| R44, a scored no-gstack arm | N, plus C and P |
| R54 and R110, frontier models in their own harness | section 4; Sol's exclusion is a finding |
| R111, a pilot under a tenth of the budget | sections 12 and 13 |
| R113, one look with stop bounds | section 14 |
| R78, judges | no judge scores anything; labellers only gate eligibility |
| R48, Why null? | section 10 |
| No-gstack arms see no drive and no gstack | section 4 |
| Exposure beside every verdict | section 8 |

### 18. Risks, limits and not in scope

- **Supply.** The likely count is about 19, under the 20-unit floor. If the draw falls short, this eval ends as a findings write-up.
- **Power.** At about 20 units the run detects about 16 to 18 points, not 10.
- **Construction.** The reviewer sees a re-based change, not the original pull request (section 2).
- **pstack's pin.** P runs pstack at #358's commit c742dd61, because #358's harness reads its pin from #358's preregistration. The research post asked each new preregistration to re-pin; this one does not, so P speaks for pstack 0.15.36 at that commit, not pstack's current main.
- **Labels.** V2.1's state-shaped rate and its oracle keep rate at the fix's base are unmeasured until the labels and the walk run.
- **Not in scope.** The detector's own accuracy, any specialist other than State Machines, /ship's copy of Review Army, and Sol (section 4).

## Review record

The Captain's picks, 2026-11-24:

- "A1, B1, C1, with two additions." B1: G+ and G0, with shipped G derived per unit. C1: every arm ends with the request to leave a failing test. A1 (the oracle at the BIC) was superseded by the unit option below.
- Units, option P: "The reviewer sees a real bug-introducing change, and the oracle runs on a tree we know builds. That's worth the constructed part, as long as the prereg states it plainly: which BIC hunks were kept, the PR size beside every result, and a sensitivity row that leaves out PRs of 10 lines or fewer."
- Stop rule: "n under 20, N's floor failing, or a pooled G+ minus G0 MDD over 25 means a findings write-up, not a counted run."
- Cost: "Re-price in the prereg for Opus and particle-1 at your projected n. If all-in passes about $3,400, bring it to me before you freeze." The re-priced all-in is about $1,800 at n = 22 and $2,830 at n = 40.
- Sol: "Sol's exclusion is a finding, so state it with the review-army.ts:343 line."

## Disclosures

gstack is Garry Tan's own project, and his team runs this eval.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

## Agent notes

<details>
<summary>Sources and checks behind this plan (internal)</summary>

- Supply: `gstack-evals sr pool` and `sr bic` at this post's build; counts and file hashes in supply-count.md. The 207 rows dropped before the reapply step were carried from the first count.
- Line 343 and the dispatch rule were read with git show at d74ee528 (scripts/resolvers/review-army.ts, review/sections/review-army.md lines 8, 47 and 56).
- Planning prices are guesses; the pilot replaces them.
- Disk: the host clones behind the BIC step were deleted after the count to make room for the dry run's images; the walk re-clones what it needs.
- Seeds: crypto.getRandomValues(new Uint32Array(3)) in one program, read once.

</details>
