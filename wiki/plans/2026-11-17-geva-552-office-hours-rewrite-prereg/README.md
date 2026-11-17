---
id: 2026-11-17-geva-552-office-hours-rewrite-prereg
kind: plan
title: "Preregistration: does the rewritten office-hours skill make the right call more often than the current one? Current skill, rewrite and no gstack on Opus 5.5 and GPT-6.1 Sol, with a simulated founder and sealed briefs"
summary: 70 founder briefs, mostly matched pairs, and 24 builder briefs; three arms on Opus 5.5 and Sol. Merge needs a pooled lift of 15 points with its interval above zero, and no builder harm.
author: GEVA-552
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-17
status: open
links:
  - wiki/research/2026-11-17-geva-552-office-hours-intentions-inventory/README.md
  - wiki/plans/2026-11-09-geva-418-office-hours-founder-evidence-prereg/README.md
  - wiki/board/2026-11-14-geva-526-office-hours-founder-stage-1-results.md
  - wiki/research/2026-11-09-geva-412-plan-mode-intentions/README.md
  - lanes/office-hours-founder/
attachments:
  - 38d337d8a7084712662978763b70c3eb1a384642d469ca9cb48cca26d1129416  cost.py
  - f44bb877f7172be26ad86aedab6a4ba88fe0ea257273a440fee35ee382b2dc9e  cost.txt
  - d960e27c8e69f489b8dc7629784c06c8e0839a51b1c144ff0af4d1b1a1321c0b  power.py
  - 73e2b6c9e3ca9d790877319e4dad96acf78758584631e00fe08cbde50c2a0fde  power.txt
---

# Preregistration: does the rewritten office-hours skill make the right call more often than the current one?

## In short

- gstack is rewriting its office-hours skill. A founder with no real customer yet would get a one-page decision memo with one dated, numbered action and a line that says when to change direction. Builders and founders with traction keep the design doc. This eval decides whether that rewrite merges.
- We compare the current skill, the rewrite and no gstack on Opus 5.5 and GPT-6.1 Sol. A simulated founder holds hidden facts and gives them up only when asked. The primary score asks whether the session drew out the decisive fact and ended with the decision and next action those facts support.
- The plan as first written could not tell a 15-point gain from zero: its smallest detectable difference (MDD) was 28 to 33 points per model. This design pools the two models and runs 70 founder briefs, which brings the pooled MDD to 12 or 13 points under conservative assumptions. The merge bar stays literal: a pooled lift of at least 15 points, with its interval above zero. That bar costs power, and section 9 prints how much.

## 1. The decision this result changes

The project owner approved the rewrite's plan on 2026-11-17, with this eval as the gate before its content change merges. The rewrite ships as two gstack pull requests. The first moves the founder-video list out of the prompt and changes no behaviour. The second is the content change this eval measures.

The decision rule is an ordered table (section 10). Each outcome names what happens next:

| Outcome | What happens |
|---|---|
| MERGE | The content change may merge, after its own ship checks. |
| HOLD (harm) | It does not merge. Its owner fixes the cause. A rerun of the affected briefs needs a dated change to this plan with its own cap. |
| CUT | It does not merge. One Why-null cycle runs on the skill against no gstack, and the project owner hears in plain words that no gstack did better. The verdict reads FIX-METHOD on task fit, not CUT-CANDIDATE, because the after-launch half of every main intention stays untested (section 6). |
| HOLD (below bar) | It does not merge as a whole. One Why-null cycle. Its owner may propose shipping only the parts with their own clean deterministic wins, which goes back to the project owner. |
| INCONCLUSIVE | It does not merge on this eval. One Why-null cycle, then the same choice as the row above. |
| INCOMPLETE | No verdict. We report what stopped the run. A continuation needs a new ledger item and a dated change to this plan, and a cap stop is never retried to change a verdict. |

## 2. Arms, models and host

**Arms.**

- **current:** gstack at the commit the content change is built on. We expect gstack main after the founder-video move lands.
- **new:** gstack at the content change's head.
- **none:** no gstack.

A dated change to this plan pins both commits before any paid call: the full sha, VERSION and the sha256 of every office-hours file. Each container checks them after install. A pinned arm never moves.

**Models under test.** Opus 5.5 and GPT-6.1 Sol are primary. particle-1 runs on all three arms as a descriptive secondary; it decides nothing.

**Host.** Every session runs in Claude Code inside a throwaway container, through the founder lane's driver (lanes/office-hours-founder). Opus goes to Anthropic's API. Sol and particle-1 go through OpenRouter's Anthropic-compatible route, with Sol pinned to OpenAI's endpoint. Sol cannot run in Codex here, because our Codex adapter is non-interactive and a founder conversation needs turns. So the Sol rows measure Sol inside Claude Code, as the founder lane's did.

## 3. Briefs

**Founder types.** Each founder brief is one of eight types. Six come as matched pairs: two twins share one opening word for word, and differ in one hidden decisive fact that calls for opposite advice.

| Type | The shared opening | The hidden contrast between twins |
|---|---|---|
| T1 | asks whether to raise money now | no real outcome yet, or paying customers |
| T2 | cites strong validation | signups or an unpriced letter of intent, or a priced contract or prepayment |
| T3 | asks what to do next | a few customer conversations, or many conversations and nobody using it |
| T4 | worries the market is too small | buyers times price falls short of the founder's goal, or clears it |
| T5 | runs two ideas at once | the ideas share a prerequisite, or they don't |
| T6 | asks whether to pivot | customers don't love it, or the market is too small |
| T7 (unpaired) | wants to hire to fix momentum | the hire would not fix a scoping problem |
| T8 (unpaired) | returns after setting a test last time | the test's date has passed and its condition failed |

A skin is one instance of all eight types: 14 founder briefs in 8 opening clusters. Five skins give 70 founder briefs in 40 clusters. Skins differ by industry and founder voice. Each opening also carries one founder anti-pattern that the rewrite targets as its surface (such as stuck writing docs, launch anxiety, a consultancy in disguise, or answering a sales question with architecture), so that every anti-pattern the rewrite names appears in at least one opening.

**Builder briefs.** 24 unpaired builder briefs spread across the skill's builder goals (hackathon, open source, research, learning, fun). Each holds one hidden fact that should shape what to build first, such as a deadline, a platform limit, an audience or a learning goal.

**Calibration and reserves.** 8 calibration briefs (two matched pairs, two unpaired founder briefs, two builder briefs) run only in stage 1. 8 reserves of the same make-up replace a comparison brief of the same kind that drops before any stage 2 session runs on it, in draw order, and a pair is replaced only by a pair.

**Authoring and validation** reuse the founder lane's pipeline. GPT-6.1 Sol and Gemini 4 Argon author alternately from a frozen type, skin and industry. No Claude model authors, and authors never see either skill. Each brief then passes the lane's vocabulary screen, unanimous key, give-away screen, blind two-family audit, recognition probe and generic screen. A brief gets one rewrite in all, and every check binds the brief's digest.

- **Key.** A founder brief's sealed key holds the decision (one line), 2 to 4 acceptable next-action classes, 1 or 2 decisive fact ids, its twin, and a traction flag (the founder has a named payer or user). A builder brief's key holds the build-first call, the acceptable first steps and its decisive fact ids.
- **Unanimous key.** Opus 5.5, GPT-6.1 Sol and GPT-6.2 Astra each get every fact. Each must make the key's decision and name an acceptable action, judged by a model from the other family. If one fails, the brief drops, and its twin drops with it so pairs stay whole.
- **Give-away screen.** An unpaired brief drops when any of the three makes the key's call from the opening alone. Twins share one opening and need opposite calls, so an opening alone cannot carry either call. Pairs pass this screen by construction.
- **Supply.** Authoring draws until 110 briefs are placed (70 founder, 24 builder, 8 calibration, 8 reserves) or its cap stops it. A shortfall goes to the Captain before stage 1, with the MDD at the count that can fill. The run never quietly shrinks the set.

**Sealing.** Openings, fact sheets, keys, gold labels, transcripts and judge replies stay outside this repository, in the project's encrypted custody store, under the founder lane's custody rules. Material is decrypted only into memory-backed storage, every opening is logged, and plaintext is swept on every wake, at every seal and at the end. The repository gets counts and sha256 digests only.

## 4. The session

1. **First message.** none gets "Act as a YC partner holding office hours with me.", a blank line, then the opening. Skill arms get "/office-hours " followed by the same text. The first message asks for no closing format. The founder lane's first message did, and told the model the conversation ended when it wrote one, after which plain models answered in their first reply.
2. **Questions reach the founder as text.** AskUserQuestion, WebSearch and WebFetch are denied in every arm, as in the founder lane. Both skills therefore use their interactive prose question form, and their landscape step reports that search is unavailable.
   - Each session gets a fresh state root. The arm environment leaves GSTACK_SESSION_KIND, OPENCLAW_SESSION, GSTACK_HEADLESS, CI and GITHUB_ACTIONS unset, because gstack's session-kind check reads each of them before it falls back to interactive.
   - A skill session must print SESSION_KIND: interactive. One that prints another kind is a harness fault.
   - Every arm sets CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 and starts in a fresh, empty git repository with no project instruction file.
   - The none arm has no gstack install, no skills folder and no drive, and its tool calls are audited for gstack reads.
3. **The simulated founder** is Gemini 4 Argon, pinned to one provider as in the founder lane, at temperature 0. It keeps that lane's ten rules with its repair: at most two hidden facts in one reply, never a fact added to a choice or a closing remark, a recommended choice answered alone in one short sentence, and JSON only. This plan adds four rules:
   - Answer from the fact sheet whenever it covers the question, the goal or mode question included. Otherwise take the option the adviser marks as recommended.
   - Decline optional extras in one line: a second opinion, founder resources, starting another review, a YC application.
   - Approve a document or memo after reading it once.
   - Set done when the adviser has given advice and a next step and asks nothing that needs an answer.

   The simulator logs which fact ids each reply reveals.
4. **Closing.** When the founder sets done, or after the 20th founder reply, the harness sends a frozen closing message. It asks for three lines: "DECISION: what I should do. NEXT ACTION: one thing, who and by when. WHY: up to three facts from our talk." If the reply holds no such block, the harness sends the message once more. A second miss scores the session as not the right call.
5. **Limits** follow the founder lane: 20 founder replies, 60 agent turns a reply, 120 minutes, 200k context, a per-session dollar allowance at the metering proxy, and one retry for an infrastructure fault.
6. **Returning founders (T8).** Skill arms start with a state root seeded with one prior session, in that pin's own format: the assignment and its test, and for the new pin also its date and condition fields. The none arm starts empty. The opening says the founder was here before. In every arm, how the test came out is a hidden fact the founder reveals only when asked.

## 5. The right call (primary measure)

A session makes the right call (R = 1) when all three parts hold:

- **R1, found.** Mechanical: the simulator's log shows at least one of the brief's decisive facts revealed before the closing message.
- **R2, decision.** Judged: the DECISION line makes the key's call, not the twin's, and does not hedge between them.
- **R3, action.** Judged: the NEXT ACTION falls in one of the key's acceptable action classes and is specific to this founder. A stock action such as "talk to more customers" does not count.

**Blind to arm, blind to format.**

- The judge sees only the three-line blocks, which every arm writes in the same form. A script cuts each line at 40 words.
- The judge never sees a transcript, a file or a deliverable.
- A packet holds one brief's key and that model's blocks for the brief from all three arms, under random ids.
- Every packet also holds three stock rows that must never score, and one near-miss row: the twin's right call written into a block by script. For an unpaired brief, the near-miss is the key's listed wrong call.

So the rewrite cannot score by printing the fields it was told to print (a memo, a kill line, a date). A skill that gives the same advice whatever the facts loses one twin of every pair.

**Judges.** GPT-6.2 Astra labels Opus blocks. Opus 5.5 labels Sol and particle-1 blocks. Each block gets one label at medium effort, the founder lane's production setting, with its prompt adapted to the two judged parts above (R2 and R3). The check is in section 12.

**A caveat carried from the founder lane.** The unanimous key makes the call nearly automatic for Opus and Sol once they hold every fact. So R mostly measures whether a session draws out the decisive fact and then acts on it. That is the main claim the rewrite makes (ask for a real outcome first), and section 6 lists what R leaves out.

## 6. Construct fit and intentions

This repo evaluates a plan-mode skill against an intentions inventory read at a pinned commit, following the plan-mode intentions research (wiki/research/2026-11-09-geva-412-plan-mode-intentions). The current skill's inventory is its own post (wiki/research/2026-11-17-geva-552-office-hours-intentions-inventory), read at gstack da98d0a0eb0072bc5825b1f361a92aa34bdb273b: 10 main intentions and 36 secondary. The rewrite's inventory is written at its pinned head, as a new post, before any paid call.

**Claimed value, current skill.** Be a YC office-hours partner who makes sure the problem is understood before any solution, give founders hard demand questions and builders an enthusiastic design partner, and leave a design doc instead of code.

**Claimed value, rewrite** (from its approved plan). For a founder without a real outcome, ask for that outcome first. Then leave them with one decision, one dated and numbered action, and a line saying when to change direction. Keep the design doc for builders and for founders with traction.

**Construct-fit check.** R covers three things:

- understanding the founder's real situation before advising (R1);
- the decision that situation supports (R2);
- one concrete next action (R3).

R does not cover the deliverable's form, which the compliance checks report, or anything after the session.

Current skill, main intentions (ids from the inventory):

| Intention | How this eval reads it | Status |
|---|---|---|
| S1 find real demand evidence, or say there is none | R1 on every founder brief; R2 on the no-outcome twins | scored in session; after launch untested |
| S2 name the actual person who needs it | R1 where the decisive fact is a buyer's identity or commitment (T2) | partly scored |
| S3 the narrowest wedge someone pays for | R3 where an acceptable action is a wedge or manual delivery (T3, T5) | partly scored |
| S4 the next decision follows the evidence | R2 and R3 across matched pairs | scored in session; whether the founder acted is untested |
| B1 the most exciting version (builders) | builder right call, reported | partly scored; decides only as a loss guard |
| X1 no code, problem before solution | mechanical check per session | reported, not scored |
| X2 premises challenged before solutions | procedure detector | exposure only |
| X3 two or three approaches and a pick | procedure detector | exposure only |
| X4 an approved doc later skills can find | file and status check per session | reported; use by later skills untested |
| X5 one concrete real-world action | R3 | scored in session; whether it was done is untested |

Rewrite, main intentions as its approved plan states them. Its inventory confirms or amends this list. A main intention that the inventory names and this plan neither scores nor lists goes onto the untested list in the pinning change. The primary measure does not change.

| Intention | How this eval reads it |
|---|---|
| N1 a reality check first at every startup stage, skipped when the opening names a payer or user | R1; guardrail G2 on traction twins |
| N2 a memo with one dated, numbered action and a kill line for no-outcome and pivot sessions | R2 and R3 for content; the format is a reported compliance check |
| N3 the design doc kept for builders and founders with traction | compliance check; builder kept-whole rate (decides) |
| N4 a pivot flow that first asks love or size, with a small ceiling check | T6 and T4 pairs |
| N5 the evidence ladder (a priced commitment over soft signals) | T2 pair |
| N6 follow-up on the founder's own test date | T8 |
| N7 pushback on focus and on hiring | T5 and T7; a consultancy in disguise and launch anxiety appear only as opening surfaces, not as keyed calls |
| N8 builders unchanged | builder kept-whole rate and guardrail G1 |

**Untested.**

- The after-launch half of every intention: whether the founder acted, paid, contacted or launched.
- Use of the doc by later plan reviews.
- The landscape search, since search is denied in every arm.
- The second opinion and the visual design step, which are declined or never reached.
- The closing tiers across sessions, beyond one seeded prior session.
- Founder resources and the YC invitation text.

**Consequence.** Main intentions stay partly untested, so this eval cannot support a CUT-CANDIDATE verdict: the project's rule for plan-mode skills keeps that verdict for an eval whose score covers the skill's main intentions. A cut-type result reads FIX-METHOD on task fit, and the project owner still hears it plainly.

## 7. Builders aren't harmed

**The builder-facing measure: kept whole.** A builder session in a skill arm is kept whole when all four hold:

- it ran in builder mode;
- it asked no startup-only question: none of the six forcing questions, the reality check, the payment test, the evidence ladder, a kill line, a pivot question, the wallet question or the two-sentence pitch;
- it wrote a builder design doc with Status: APPROVED, not a memo and not a startup doc;
- it got there before the reply cap.

Each pin's markers are frozen from stage 1 transcripts and tested on planted fixtures before they read stage 2.

**Non-inferiority.** Builders aren't harmed when the 95% lower bound of new minus current on the kept-whole rate is above -15 points. The interval is Newcombe's method 10 for paired proportions, on the 48 brief-and-model pairs (one session each arm). It is the repo's existing implementation in lanes/delivery-route/analyze.ts, already tested against Altman's worked example (a 14, b 5, c 0, d 22 gives 0.1220, 0.0115 to 0.2265). Why 15 points:

- A 10-point margin needs about 48 builder briefs to reach 80% power, about $500 more at caps.
- The cluster t interval passed non-inferiority falsely 10% to 23% of the time near the ceiling, so it is not used here.
- The main way the rewrite could harm builders, a startup question leaking into a builder session, is covered absolutely by guardrail G1. G1 needs no interval.

**Builder quality.** The builder right call has the same form as R, keyed to the builder's decisive fact and build-first call. It is reported with its interval. If the 95% interval for new minus current lies wholly below zero, that is a real quality loss and it holds the merge (row 2).

## 8. Analysis and failure scoring

**Estimate.** The estimate is δ, the mean over opening clusters of the cluster's difference. A cluster's difference is the mean over its briefs. A brief's difference is the mean over models of R_new minus R_current. There is one session per brief, arm and model. A brief's difference averages the models where both arms scored. A cluster averages its briefs that have a difference.

**Interval.** A paired t interval over cluster differences, with C - 1 degrees of freedom, two-sided 95%. It is pinned to Student's sleep data (R datasets::sleep, paired): mean 1.58, interval 0.7001142 to 2.4598858. power.py asserts the interval, and the run's tests must assert the mean and the interval.

The same estimator gives new minus none, current minus none, and each model alone. Builder kept-whole uses Newcombe's method 10 (section 7). The builder right call and the guardrail counts use the t estimator over builder briefs or over founder clusters.

**Failure scoring, frozen.**

| Event | Scored as |
|---|---|
| Upstream or provider error, simulator failure or harness fault, after one retry | missing |
| A gstack read in the none arm | missing, counted as contamination |
| A provider safety-filter stop | R = 0, counted as its own outcome |
| A model refusal | R = 0 |
| No block after two closing messages | R = 0 |
| The reply cap reached | the closing message goes out and the block is scored |
| The skill did not run its procedure | scored as observed; exposure is reported beside every verdict |
| A cap stop | INCOMPLETE |

**Missing limits.** The run is INCOMPLETE when any of these holds:

- more than 10% of founder brief-and-model differences are missing;
- any arm-and-model cell misses more than 10% of its sessions;
- none-arm contamination passes 2% of its sessions.

## 9. Sizing

**Arithmetic.** For a paired t interval over C clusters, MDD = (t(0.975, C - 1) + t(0.80, C - 1)) × s / √C, where s is the spread of cluster differences. power.py simulates s from the founder lane's power model (Beta brief difficulty with mean p0 and between-brief share rho, a logit lift with brief noise 0.5 and model-by-brief noise 0.3). It reports the MDD as the smallest true lift at which the interval excludes zero in 80% of runs.

The gain comes from more clusters and from pooling the two models. A second trial on 42 briefs reaches about the same pooled MDD (0.12 to 0.13, or 0.09 at rho 0.843), but it runs 84 sessions per arm and model against 70 and covers fewer situations, so more briefs buy the same power for less.

| Design | Clusters | Sessions per brief and arm | MDD, one model | MDD, pooled |
|---|---|---|---|---|
| The plan as written: 14 founder briefs (5 pairs, 4 unpaired), 3 trials | 9 | 3 a model | 0.28 to 0.33, over 0.45 at p0 0.55 and rho 0.843 | 0.22 to 0.28, over 0.45 there |
| 42 founder briefs (3 skins), 1 trial | 24 | 1 a model | | 0.16 to 0.17 (0.12 at rho 0.843) |
| 56 founder briefs (4 skins), 1 trial | 32 | 1 a model | | 0.14 to 0.15 (0.09 to 0.10) |
| **Frozen: 70 founder briefs (5 skins), 1 trial** | **40** | **1 a model** | **0.17 to 0.18 (0.11)** | **0.12 to 0.13 (0.08)** |

Ranges cover p0 from 0.25 to 0.55 at rho 0.5. The figure in brackets uses rho 0.843, the founder lane's other assumption. A twin correlation of 0.5 leaves the frozen MDD unchanged. For the contrasts against no gstack, with none as control at p0 0.05 to 0.40, the pooled MDD is 0.08 to 0.13 (one model alone, 0.11 to 0.18). The interval's simulated coverage is 0.93 to 0.97 pooled and 0.91 to 0.98 for one model alone. It falls below 0.95 at a 10-point true lift on a 5% control rate (0.93 pooled, 0.91 for one model).

**What the literal bar costs.** MERGE needs a pooled estimate of at least 15 points and an interval wholly above zero (section 10). On the frozen design, with p0 0.40 and rho 0.5, the share of simulated runs that read MERGE is:

| True lift | 0 | 10 points | 15 points | 20 points | 25 points |
|---|---|---|---|---|---|
| Reads MERGE | 0.000 | 0.139 | 0.537 | 0.880 | 0.987 |

At rho 0.843 the shares are 0.000, 0.084, 0.505 and 0.895 for lifts of 0, 10, 15 and 20 points. So a rewrite that truly gains exactly 15 points merges about half the time. One that gains 20 merges about nine times in ten. One that gains nothing never merges.

**Builder non-inferiority.** This uses 24 builder briefs, 48 brief-and-model pairs and Newcombe's method 10 with a 15-point margin. When nothing changes, it passes in 0.73, 0.82 and 0.92 of runs when the current skill keeps 85%, 90% and 95% of builder sessions whole (rho 0.5), and in 0.95 to 0.99 at rho 0.843. At a true 15-point loss it passes in 0.03 to 0.06 of runs.

**Re-reading the assumptions.** After stage 1, power.py reruns with the stage's estimates of p0 and rho, and the results post prints the MDD at the observed control rate beside each contrast.

## 10. Decision rule

The rows are exclusive and checked from top to bottom. The first row whose condition holds decides. The pooled primary decides. Per-model rows are reported beside it, and they act only through row 2's loss guard.

| Row | Outcome | Condition (pooled over Opus 5.5 and Sol unless named) |
|---|---|---|
| 1 | INCOMPLETE | an admission condition failed and was not repaired (section 12); a cap stop; a missing limit passed (section 8); or a judge check failed |
| 2 | HOLD (harm) | any of: new minus current has an upper bound below 0, pooled or on Opus alone or on Sol alone; builder kept-whole has a lower bound at or below -15 points; the builder right call, new minus current, has an upper bound below 0; or a guardrail breaks |
| 3 | CUT | new minus none has an upper bound below 0 |
| 4 | MERGE | new minus current has an estimate of at least +15 points and a lower bound above 0 |
| 5 | HOLD (below bar) | new minus current has an estimate below +15 points, and either a lower bound above 0 or an upper bound below +15 |
| 6 | INCONCLUSIVE | everything else: the interval includes zero and reaches +15 |

**Guardrails** (each one breaks row 2):

- **G1.** Any new-arm builder session asks a startup-only question (the list in section 7), confirmed by a hand read of that transcript.
- **G2.** On founder briefs with the traction flag, the 95% lower bound of new minus current on the founder questions asked per session is above 1.
- **G3.** On founder briefs, the 95% lower bound of new minus current on the founder replies before the closing message is above 20% of the current arm's mean.

**Two readings reported beside every outcome.**

- When new minus none includes zero and its upper bound is below +15, the post says the rewrite was not shown to beat no gstack by the bar, and runs a Why-null cycle on it.
- When current minus none has an upper bound below 0, the post reports to the project owner, as its own finding, that office-hours on gstack main loses to no gstack.

## 11. Reporting

The results post leads with this table, pooled, then each model beside it:

| Contrast | Estimate | 95% interval | Control rate | MDD in this plan | MDD at the observed control rate |
|---|---|---|---|---|---|
| new minus current | | | current | 0.12 to 0.13 | |
| new minus none | | | none | 0.08 to 0.13 | |
| current minus none | | | none | 0.08 to 0.13 | |

Beside it, the post reports:

- R1, R2 and R3 by arm;
- procedure exposure by skill arm and model;
- founder replies and questions per session;
- builder kept-whole and builder right call, with their intervals;
- each guardrail;
- the compliance checks: deliverable type, an action with a date and a number, a kill line on no-outcome twins, no code written, an approved file on disk;
- counts of missing sessions, safety stops, refusals and contamination;
- cost by arm and model;
- particle-1's rows, marked descriptive;
- the five hand-checked sessions;
- the Why-null cycle for any null;
- the untested list;
- both inventories' commits.

## 12. Stages, gates and admission

0. **After this plan merges.** The Captain records each item's cap. A dated change to this plan then pins both arms, adds the rewrite's inventory and names the build commit. The change is a post on the results branch, pushed before any paid call, and it lands with the results.
1. **Build** on the results branch:
   - Generalise the founder lane's arms to two stack pins plus none, with a VERSION and file check per pin.
   - Carry the lane's open fixes, each with a test that fails first: the four blocking bugs left in its run, read and simulator code (a manifest that copies declared digests instead of hashing files, a missing stop file read as complete, a gold kappa that drops unlabelled cells, and a metered refusal that loses the cap stop), the simulator-rules digest bound in the frozen manifest, a torn last line that blocks resume, a cap stop lost when the rig fails to close, the text-joining mismatch between driver and parser, unique packet ids, a stock check with no stock rows, load tests and lane lines for the lane's CLI and end-to-end scorer, and its missing src/README row.
   - Add the new key schema, the judge prompt, the closing message, the simulator's added rules, the procedure and kept-whole detectors and the guardrail counters.
   - Before any paid stage, all of these pass:
     - a keyless test of both worked examples;
     - a dry run that drives every frozen rule: one ledger lease per frozen run on a temporary ledger, every row of section 10 on planted data, and every gate on planted known-good and known-bad cases;
     - a driven launch against a fake provider;
     - a no-model preflight on a real VM;
     - a dated re-read of model and provider terms.
2. **Authoring** (paid; section 3).
3. **Simulator audit** (paid). A fixed six-question script runs over every fact sheet, independent of any arm. GPT-6.2 Astra and Opus 5.5 at maximum effort mark a seeded sample of 80 of its founder turns. It passes when at most 5% of turns are marked by both auditors. Fewer than 40 auditable turns reads NO READ. A keyless guard retries any reply that logs more than two reveals.
4. **Stage 1** (paid): the 8 calibration briefs on three arms and two models, plus particle-1. The detectors' marker strings are frozen from these transcripts. Then the judge check and a live probe of every judge route run, and admission reads:
   - A1: at least 6 of 8 sessions are exposed in each skill arm and model;
   - A2: on founder briefs, median founder replies are at least 3 in each skill arm and model;
   - A3: the simulator audit passed;
   - A4: both judge checks passed;
   - A5: the current arm's right-call rate on the calibration founder briefs, pooled, is at most 0.75, so the 15-point bar has room;
   - A6: stage 1's measured cost per session, by arm and model, keeps stage 2's projection inside its caps;
   - A7: every skill session printed SESSION_KIND: interactive, and no none-arm session read gstack.

   A failing condition gets one repair, by a dated change to this plan, rerunning only what failed under stage 1's remaining cap. A second failure ends the eval with FIX-METHOD on the instrument. A ceiling (A5) gets one honest attempt to raise it with harder briefs before any other step. A6 never trims briefs, arms or sessions: it goes to the Captain with the measured numbers. No repair may tell a skill to choose for the founder.
5. **Stage 2** (paid). Every comparison brief runs once per arm and model, in a seeded random order with a brief's arms adjacent. The scorer is then hand-checked on 5 real sessions across arms before any reading.
6. **The results PR.**

**Exposure, frozen.** A skill session is exposed when all three hold:

- it read the skill file and printed SESSION_KIND: interactive;
- it asked at least two of its diagnostic or generative questions one at a time, each answered by a founder reply;
- it wrote its deliverable (a design doc or a memo) to the state root.

Stage 1 supplies only the marker strings for each pin. The definition does not move.

**Judge check.** Each judge needs at least 40 labelled outputs from at least 40 blocks:

- real stage 1 blocks;
- authoring's full-information and opening-only answers, put into block form;
- script anchors: an oracle block per calibration brief and the twin near-miss.

Gold labels are the cells where GPT-6.2 Astra and Opus 5.5 agree in a separate maximum-effort pass, plus the anchors' fixed labels. Anchors make up at most half of the credited gold. A judge passes with all of:

- kappa of at least 0.6, overall and on real session blocks;
- near-miss accuracy of at least 0.8;
- no stock row credited.

Gold here is two models agreeing, so these figures measure agreement, not accuracy, and the post says so. A judge's production numbers count only after its check passes.

## 13. Money

cost.py (attached) computes every figure below from these planning inputs:

- an Opus skill session, $3.50 (the approved plan's figure), and a none session, $0.50;
- a Sol skill session, $2.00, and a none session, $0.30. No interactive Sol figure exists yet, because the founder lane's sessions mostly ended in their first reply;
- particle-1, $0.30 with a skill and $0.05 without;
- per session, $0.08 for the simulator and $0.06 for its judge label, from the founder lane's measured $0.0064 a simulator reply and $0.062 a session of labels;
- authoring at the founder lane's $1.04 a drawn brief ($129.19 over 124 draws) and its pass rate of 96 in 124. A matched pair passes only when both twins pass, so placing 34 pairs and 42 unpaired briefs takes about 168 draws;
- the simulator audit: a six-question script over 110 sheets at $0.0064 a reply, and 80 audited turns at the lane's $0.314 a turn for two auditors;
- the judge check: 1,000 rows labelled by both gold models at maximum effort at the lane's $0.078 a row, the production labels on the same rows at $0.0098 a row, and $2 of live probes;
- hosts: 4 VM-minutes a session at the lane's $0.00416 a VM-minute.

Each cap is 1.35 times central plus one allowance for the item's costliest unit, rounded up: $15 for an Opus skill session on the stage 1 and Opus and Sol stage 2 items, $3 for a particle-1 skill session, $3.50 for a brief, and $1 for the rest. Stage 1 measures the session costs, and admission A6 holds stage 2 inside its caps.

| Ledger item | What it pays for | Central | Cap |
|---|---|---|---|
| 1 Authoring | about 168 draws to place 110 briefs, with keys and validation | $175 | $240 |
| 2 Simulator audit | the fixed script and two auditors | $29 | $41 |
| 3 Stage 1 | 48 sessions on Opus and Sol and 24 on particle-1, with simulator and labels | $110 | $164 |
| 4 Judge check | the gold pass, production labels on it and live probes | $90 | $123 |
| 5 Stage 2, Opus and Sol | 420 founder and 144 builder sessions, with simulator and labels | $1,188 | $1,620 |
| 6 Stage 2, particle-1 | 282 sessions, with simulator and labels | $101 | $139 |
| 7 Hosts | runner VMs | $15 | $22 |
| **Paid total** | | **$1,708** | **$2,349** |

Agent model use adds about $350: about $100 for writing and reviewing this plan and about $250 for the build and the runs. That is about $2,058 all-in at central and $2,699 at caps, inside the $2,745 the project's owners approved for this sizing on 2026-11-17. particle-1 costs about $109 central and about $151 at caps across both stages. A cap stop is an incomplete run, never retried to change a verdict.

## 14. Reused from the founder lane, and what changes

**Reused as is:**

- the Claude Code driver and its throwaway containers;
- the metering proxy and the ledger with its admission rules;
- the containment probe and the none-arm read audit;
- the founder loop and the persona simulator;
- the authoring pipeline and its screens;
- the judge routing and its gold method;
- the custody rules;
- Newcombe's method 10;
- the power model.

**Changed:**

- two stack pins instead of one;
- no closing format in the first message;
- a closing message after the founder's done or the reply cap;
- a key for the right call, with twins;
- the simulator's four added rules;
- a fixed-script simulator audit that every sheet feeds, so the audit cannot run short of turns;
- an exposure detector frozen from both pins' real transcripts, in their prose format;
- the lane's open fixes (section 12).

The lane's 64 sealed comparison founders are not reused. They are keyed to a first customer and wedge, not to the decisions this rewrite changes, and they have no twins.

## 15. Changes from the approved plan

This plan governs where the two differ.

- **Briefs and trials:** 70 founder and 24 builder briefs at one session per model and arm, instead of 16 briefs at three trials. The pivot briefs became a matched pair. Why: the plan's MDD of 28 to 33 points per model could not confirm a 15-point bar.
- **The decision:** an ordered table on the pooled primary. The plan merged on a point estimate of 15 or more with one model's interval above zero. Merge now needs the pooled estimate at 15 or more and the pooled interval above zero, with per-model losses as a harm guard.
- **The cut:** the plan read "no gstack matches or beats the new skill" as CUT-CANDIDATE. Here CUT needs the new-minus-none interval wholly below zero, and the verdict reads FIX-METHOD under the plan-mode rule. A tie with no gstack is reported beside the outcome, because a tie can sit beside a real lift over the current skill.
- **Builders:** a stated 15-point non-inferiority margin on the kept-whole rate, plus the zero-leak guardrail, replaces the plan's guardrail alone.
- **Judges:** one label at medium effort, the founder lane's checked setting, instead of three samples and the median. The check validates exactly what runs.
- **The simulator:** Gemini 4 Argon, the founder lane's tested and pinned route, instead of Gemini 4 Hydrogen. Both are a third family.
- **The price smoke:** 12 sessions became stage 1's 72, which also serve the judge check and admission.
- **Money:** $1,708 central and $2,349 at caps for paid calls, against the plan's $1,270 and $1,800.

## 16. Limits

- The briefs are constructed, so the result speaks to these eight situations as written, not to real founders' sessions.
- The founder is a model following rules. Its audit measures agreement between two auditors, not truth.
- One session per brief, arm and model means per-model rows are descriptive, with MDDs of 17 to 18 points.
- Search and the native question tool are off in every arm, so the result covers the skills' prose question path without outside research.
- Sol runs inside Claude Code, not Codex.
- R measures one session. Whether any founder would act on the advice is untested.
