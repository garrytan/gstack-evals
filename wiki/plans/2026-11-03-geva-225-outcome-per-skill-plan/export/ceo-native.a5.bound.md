INPUT: ceo 9ff6fb7a6baa6820279f73c74f80c30c892348350cbf98578f0a20111e71b283

# CEO review, gate_rev 2 confirm round: GST-1144 plan v2 (per-skill outcome tests under the $2,000 ceiling)

## Verdict

v2 spends Garry's $2,000-per-skill ceiling sensibly in outline. Admission comes before any large spend, every failed check stops the skill, every row prints its MDD, and the plan drops the "no effect" claim it can't afford. What v2 did not rewrite for the new budget are the rules that turn a reading into a decision. The new futility look is one-sided, so a skill that hurts stops at half the panel and reads "not distinguished". The 1.5x cost guard, at the plan's own new price multiples, decides most verdicts before the outcome does, and the plan doesn't say whether it binds. The promise that wave 1 settles GST-1218 rests on an after pin nobody has named and on a null inference the plan elsewhere disowns. The central prices sit at half the house's own real-task central. And the autoplan arm names no kind, on a before pin that predates R66's kinds.

All of these are text fixes inside the ceiling. My recommendation: approve v2 once F1 to F5 are fixed in the plan text before it merges. F6 to F15 can land in the same edit or carry as build tasks.

## Review facts

- Phase and round: CEO, confirm round 2. The snapshot is 71,098 bytes and its sha256 matches 9ff6fb7a...; the prior revision is 42e28cee6c4f (+159 -117). I reviewed the delta and its consequences. The 24 DECIDED items are settled and I don't re-raise them. Every finding below cites a hunk of this diff (line numbers are in the snapshot, ceo-implementation.md).
- Mode: HOLD SCOPE. The owner set the ceiling (its words stay in the Captain drive). I propose no new spend. The one addition (F6) reads arms the plan already pays for. One recommendation is a user challenge on cost (F7), and it would spend less.
- Voices: this is the native voice. The outside voice is disabled for this round (run.json: Captain GEVA-2 limited gate_rev 2 to two voices). Design and DX closed as deferred, with 12 and 16 open findings carried to the gate.
- What I read: the whole brief (966 lines); origin/main at a0cb401 (the overhaul prereg #169, R3 amendment 4, the real-outcome lane plan, E0 and panel v3 headroom results); the Captain drive's NOTES.md and CREW.md; this run's run.json, timing.json and snapshot.json; one public paper (SkillsBench). No model call, no key read, no file changed but this one.
- gstack on this machine: `gstack: ok 1.93.34.0 for=review-voice`. That is below the CREW floor (1.94.15.0). review-voice never self-upgrades a shared checkout, and the Captain's rule is never to move a checkout mid-run. I ran only the trailer command and no SKILL.md.
- Findings: 15 (Critical 1, High 4, Medium 7, Low 3). Unresolved decisions: 5. Critical gaps: 1 (F1). Status: issues_open.

## Reality rows

```
REALITY: rig        | lane pieces the wrappers extend exist                      | verified      | origin/main a0cb401: lanes/real-outcome/{agent,arms,mine,sandbox,score,task}, src/runner/stats/
REALITY: before pin | 82db89a is gstack v1.93.22.0                               | verified      | wiki/plans/2026-11-02-geva-214-gstack-overhaul-before-after-prereg/README.md:106
REALITY: after pin  | named in writing                                           | NOT YET       | captain NOTES.md:1078 (GST-1089 waits on Amendment B, GSTA-256's after sha)
REALITY: cost bar   | 1.5x cost per solved task                                  | binding in #169 on H-inv, upper bound <= 1.5 | geva-214 prereg README.md:178; NOTES.md:1046
REALITY: Verified   | Opus none $0.191, told /investigate $0.424 a trial         | verified      | wiki/plans/2026-11-03-geva-247-r3-amendment-4/README.md:201
REALITY: real price | house plans real-repo tasks at 5x Verified (central), 10x (high) | plan uses 2.5x and stresses 5x | geva-247 r3 amendment 4 README.md:201
REALITY: E0 anchor  | $0.236 Opus, $0.019 particle-1                             | verified, but plain one-turn sessions with no skill and no build | wiki/board/2026-11-03-geva-232-panel-v3-e0-results.md:112-113, :133
REALITY: particle-1 | 0.41 of Opus on build-like trials (quick look 3)           | plan uses 0.08 | wiki/plans/2026-11-01-geva-87-real-outcome-lane-plan/README.md:319
REALITY: kinds      | /autoplan --kind fix|feature|--full from gstack v1.93.36.0 (R66) | postdates the before pin | captain CREW.md:23; NOTES.md:1072
REALITY: ceiling    | $2,000 a skill, all-in incl. thread model use; whole-gstack evals the same | Captain's reading of Garry's words | NOTES.md:1174
REALITY: GST-1218   | eng and dx CUT-CANDIDATE; P1 keeps them until GST-1144 reads | verified    | NOTES.md:1169; wiki/board/2026-11-03-geva-250-panel-v3-headroom-results.md:44
REALITY: 35 of 36   | eng 15/16 and dx 20/20 at ceiling                          | verified      | wiki/board/2026-11-03-geva-250-panel-v3-headroom-results.md:5
REALITY: lane price | Opus none $2.50 estimate; no real-repo trial metered        | verified      | wiki/plans/2026-11-01-geva-87-real-outcome-lane-plan/README.md:319
PLAN_REALITY: 13/13 rows checked by hand, 0 unverified, 4 contradict a plan assumption (after pin, house price, E0 basis, particle-1 ratio). gstack-plan-reality was not run: the brief allows a reviewer only the trailer command.
```

## The five questions

### 1. Is this the right problem, and is there a 10x reframe?

Yes, it's the right problem. The org has no outcome evidence for any skill (R56: 0 helps, 0 no effect), three planning panels saturated on plain Opus, and the real-world outcome lane is the one instrument that grades what ships. Testing each skill on hidden tests against no gstack is the question Garry asked, and putting plan-eng-review and plan-devex-review first is right because GST-1218 waits on them.

The reframe with real leverage is in how a reading becomes a decision. Every told skill in wave 1 costs 2.2 to 5.0 times a none session (line 263, new), and the plan reads 1.5x none's cost per solved task as a guard on every skill (line 85). Under that guard each skill's decision isn't "is there any effect", which a 13 to 16 point MDD mostly can't settle. It is "is the gain at least the break-even gain", a one-sided question against a known threshold that is larger than the MDD for every wave-1 skill. Told's solve rate must reach (multiple / 1.5) times none's:

| Skill | Told multiple | Opus MDD | Break-even gain at a 30% control rate | at 50% |
|---|---|---|---|---|
| plan-eng-review | 2.2 | 13.2 | +14 | +23 |
| plan-devex-review | 2.4 | 13.2 | +18 | +30 |
| devex-review | 2.5 | 13.2 | +20 | +33 |
| plan-design-review | 2.4 | 15.0 | +18 | +30 |
| design-review | 3.0 | 15.6 | +30 | +50 |
| autoplan | 5.0 | 14.4 | +70 | not reachable |

#169's form of the bar, an upper bound at or under 1.5, needs more than these point values.

Read that way, wave 1 can return a decisive KEEP or a cost CUT-CANDIDATE for most skills at the sizes it can afford. It also tells Garry today that autoplan can't pass a 1.5x bar at its told price whatever it does for quality. That makes the program's most useful output the gain each skill must buy to pay for its own text, and whether gstack can make a told session cheaper (R66's lean kinds, the overhaul's diet) faster than it can make the skill better. F2 asks the plan to say this and to get Garry's word on the bar before admission.

The second reframe is free. autoplan and plan-eng-review run on the same 78 G tasks with the same three turns, so the plan can read whether autoplan's extra phases pay for 5.0x against 2.2x without a new dollar (F6). That is the question behind "every crew runs /autoplan before new work", the rule that costs millions of tokens a run.

### 2. Which premises are assumed, and which could be wrong?

Stated and sound: real post-cutoff changes graded by hidden tests; told counts only at 80% exposure; a cap stop ends a skill incomplete; no equivalence claim; one ceiling per skill, all-in.

Assumed, and could be wrong:

1. A real feature session costs 2.5 times a Verified session, $0.48 (line 262). The merged R3 amendment 4 plans real-repo issue fixes at 5 times central and 10 times high (README.md:201), and G's multi-file features are harder than those. The plan's "price risk" case is the house's central case. (F4)
2. Told multiples come from told /investigate on Verified and from E0's plan-review session. E0's sessions were plain one-turn reviews with no skill text and no build (E0 results :133). They say little about what a told plan-review skill adds to a build session, and nothing about autoplan's outside voices and gate. (F4, F5)
3. particle-1 costs 0.08 of Opus (line 264). That ratio comes from the same one-turn E0 sessions; on build-like trials the lane measured 0.41 (lane plan :319). At 0.41 the particle-1 rows cost roughly three times their planned $103 to $291 (my estimate), which likely fails the plan's own 2-point rule in G. (F4)
4. The after pin will be named in time. It isn't named today (NOTES.md:1078), and the first G confirmatory prereg is dated 2026-11-17 (line 407). (F3)
5. "A null rules out a gain of that size" (line 293). It doesn't. An MDD is the effect found 80% of the time; a null rules out only gains above its interval's upper bound. (F3)
6. One-tree screening gives U and X a 40% in-band yield (lines 213, 266). X's tree score can only be 0, 0.5 or 1, so the 20 to 80% band admits only 0.5, which even an ideal task (per-run success 0.5) hits half the time. (F12)
7. The futility look "doesn't raise the test's alpha" (line 226). That's true, but it was checked only on the efficacy side; on the loss side it removes readings. (F1)

### 3. The six-month regret

May 2027. Wave 1 spent about $10,000 and about $960 of crew model use. Real sessions came in at the house's central price, so G and X ran at 17 to 19 point MDDs and U near 20. The after pin arrived after G's prereg, so plan-eng-review and plan-devex-review read on the forced line, which can't KEEP or CUT, and GST-1218 is still open. Two skills stopped at the futility look while trending against none and were posted as "not distinguished". autoplan's verdict attached to a full-panel configuration crews stopped running in November. The one firm result is that told skills cost 2 to 5 times a none session and fail a 1.5x bar, which November's price table already showed. Each of these has a cheap fix in the plan text today (F1 to F5).

### 4. Alternatives dismissed without enough analysis

- Within-family contrasts (F6). autoplan told against plan-eng-review told, and against plan-eng-review's stand-in, on the 78 shared tasks. Free, and unread.
- The branch design for after-build skills (F8). Offered to design-review only, though devex-review has the same shape and the same build noise.
- The plan-first arm. Dropped "under the ceiling" with no price shown. In X and U the cost is real (about $340 for X with docs-only measurement, my estimate), so dropping it there is defensible. In G the plan-eng-review stand-in already gives autoplan a same-turns comparator at no cost (F6).
- A finer primary. The share of the change's own hidden tests passed is kept only as a sensitivity (line 91). With the ceiling setting MDDs at 13 to 16, a finer primary is the cheapest power on offer. I'd defer it to the G prereg's re-simulation rather than change it here.
- A cheaper calibrated agent user for U. Line 294 names it as "the cheapest measure that could" decide a design skill, but doesn't make it a condition of U's spend (F7).
- Sol at lower power instead of not at all (F11).

### 5. Competitive risk

Low for the research itself, real for the claims. SkillsBench (arXiv 2602.12670, 2026) already runs paired no-skill and curated-skill arms with deterministic verifiers across 18 model and harness pairs, Claude Code included. It reports +16.6 points on average (+4.1 to +25.7 by configuration), with the smallest domain gains in mathematics (+9.7) and software engineering, and focused skills of at most three modules beating larger bundles. Two lessons follow. First, the prior for a procedure skill on software tasks with a frontier model is a single-digit gain, below every wave-1 MDD, so "not distinguished" is the expected reading and the decision rule (F2) matters more than the sample. Second, "focused beats exhaustive" predicts that autoplan, gstack's largest bundle, is the skill most likely to lose to a smaller comparator, and F6 reads that for free.

Anyone can run gstack's skills through a SkillsBench-style harness and publish first. gstack-evals' edge is the post-cutoff, hidden-test, exposure-gated design, and merging this plan as a wiki post already publishes the method.

A user's real alternative isn't "none". It's Claude Code as shipped: plan mode, plus the bundled skills every arm turns off (line 106, a house rule). A "helps" here means "helps against Claude Code with bundled skills off and no planning turn", and results posts should say so in the claim line. That is a wording rule, not a design change.

## Findings

**F1 (Critical). The futility look is one-sided, so losses stop at half and read "not distinguished".** Line 226 is new. At half the panel the scorer computes conditional power "for a true effect equal to the planned MDD" and stops under 10%. A skill whose interim estimate favors none has near-zero conditional power for a gain, so it stops and posts "not distinguished". At the full panel the same skill would often read "hurts": at plan-eng-review's 13.2-point MDD (alpha 0.025), a true 10-point loss is detected about 54% of the time (from the plan's 80%-at-MDD scale, SE about 4.3 points). So the rule removes most of the "hurts" readings that section 4 promises to report plainly as a CUT-CANDIDATE path, and the reader can't see that it happened. In a repo whose first rule is to report losses plainly, that's the one change in v2 that biases public results toward gstack. The fix is one sentence: a two-sided look, and the interim estimate printed at every stop.

**F2 (High). The 1.5x cost guard can't be passed by most wave-1 skills at the plan's own prices, and the plan doesn't say whether it binds.** Line 85 reads the bar "as a guard on every skill"; line 263 (new) prices told at 2.2 to 5.0 times none. Together they mean the guard is passed only with gains at or above each skill's MDD at a 30% control rate, and never by autoplan above 30% (table above). #169 makes the same bar binding on H-inv as an upper bound at or under 1.5 (README.md:178), and the Captain verified that Garry chose it there (NOTES.md:1046). The plan doesn't say whether it binds here, what "solved" means for U's and X's fractional primaries in the cost figure, or how the ratio enters R48. If it binds, autoplan's verdict is set before its $852 confirmatory. If it's descriptive, the plan has no rule that turns cost into KEEP or CUT, and R48 "weighs" it by judgment.

**F3 (High). The GST-1218 promise rests on an unnamed pin and a null inference the plan disowns.** Lines 27, 293 and 407 are new. Line 293 says a 13 to 14 point null "rules out a gain of that size ... so it can settle GST-1218's keep-or-cut call". Two things break it. First, the after pin isn't named (NOTES.md:1078), so the G prereg on 2026-11-17 would run under decision 3's forced line, which "can't by itself KEEP or CUT the shipped skill text" (line 27). The skills GST-1218 holds would get a reading that can't settle it. Second, a null rules out only gains above its interval's upper bound, which can sit above the MDD; section 4 itself says no skill gets a "no effect" reading. Settled d3b covers the after-pin dependency in general. This finding targets the new GST-1218 promise, the new null sentence and the new dates.

**F4 (High). Central prices sit at half the house's real-task central, and the stress case covers one of four guessed prices.** Lines 262 to 265 and 296 are new. A none session at 2.5x Verified is half of R3 amendment 4's 5x central for easier issue-fix tasks (README.md:201). Told multiples rest on a plain one-turn E0 session (E0 :133) and on Verified /investigate. particle-1's 0.08 comes from the same one-turn sessions, against 0.41 on build-like trials (lane plan :319). The agent user's $1.20 a tree is about half of each U told arm's cost, and the price-risk paragraph doesn't stress it. At the house central, section 8's own text gives MDDs of 17 to 19. At the house high (10x), G would buy about 36 and 27 tasks x 3 and MDDs near 24 to 27 (my scaling from the plan's grid). Admission meters all of it, which is the right safeguard. But the wave-1 table, the particle-1 inclusion, the stand-in fit, ELI5's "under $100" and the GST-1218 promise are all set at the low price.

**F5 (High). autoplan's told arm names no kind, voice count or gate setting, and the before pin predates the kinds.** Lines 111, 118, 148 and 263 apply; 263 is new. R66 added `--kind fix|feature|--full` in gstack v1.93.36.0 (CREW.md:23). The before pin is v1.93.22.0 (#169 README.md:106), and crews now run `--kind feature` for features. The told turn is "/autoplan PLAN.md" with no kind. The 5.0x multiple assumes "four review phases". The stand-in reviews "four ways". Section 4 runs an outside voice in each phase. So the before-pin arm tests a full panel crews no longer run by default, the after-pin arm tests whatever its default is, and the price ignores outside voices and the gate. A KEEP or CUT on "autoplan" would attach to an unnamed configuration of the most expensive skill. Settled d22b covers the lane's install flags; this finding covers the invocation and its price.

**F6 (Medium). Free within-family contrasts go unread.** Line 276 (new) puts autoplan's 78 tasks inside plan-eng-review's 108-task panel, and both before-build arms use the same three turns (line 111). So autoplan told minus plan-eng-review told, and autoplan told minus plan-eng-review's stand-in, cost nothing extra. They answer whether autoplan's CEO, design and DX phases pay for 5.0x against 2.2x, which steers R66's kind choice and the "/autoplan before new work" rule. They need a seeded subset and interleaved batches, and they should be preregistered as secondaries.

**F7 (Medium, user challenge on cost). U's wave-1 confirmatory buys a reading the plan says can't cut.** Line 294 (new) says a U null at 15 to 16 points "can't by itself move a design skill to a cut". Settled d5b and d7b carry a Critical and a High against the agent user's ability to see design-review's main claims and against completion's ceiling. So the only decisive outcome left for U's $3,299 plan is a 15-point completion win through an instrument that may not see the skills' work. Section 8 already applies the right rule to design-consultation and design-html at 20 points: come back with a cheaper measure before spending. The same rule fits U's wave-1 rows. If no cheaper calibrated agent user passes, most of U's two ceilings stay unspent.

**F8 (Medium). The branch design is offered to design-review only.** Line 294 (new) lets design-review's told arm continue from the none arm's own built tree, so build noise cancels. devex-review is the same after-build shape (line 111: none's T1, then "/devex-review"). Branching saves told's T1 (about $173 across 360 told trials at central prices) and removes build variance from the X contrast. The estimand changes slightly, because T1 runs without gstack installed, and the arm table should say so.

**F9 (Medium). Sections 1, 2, 5 and 9 still describe v1's arms and measures.** Line 36 still asks every skill the stand-in and untold questions. Lines 62 and 63 list autoplan in U and X. Lines 148 to 153 list follow-up and judges as wave-1 measures and autoplan as G, U, X. Lines 332 to 339 assign an idea-only (stand-in) outcome to skills with no stand-in, and a follow-up clause to plan-eng-review's saturation raise. The delta removed those arms and measures but left these rows, and build lanes inherit the text word for word.

**F10 (Medium). The lane amendments ask for spend the ceiling may not allow, and /review's K4 arms are priced twice.** Line 126 (new) says ship's stand-in and the /review K4 arms "are priced in the lane's plan, not here". Line 303 prices "review | K4 replays, a new pool | $1,619" here. The Captain's reading of Garry's ceiling is that whole-gstack evals get the same $2,000 (NOTES.md:1174), and line 439 asks whether it binds ship. Until that's decided, asking the lane to run ship's stand-in "whatever R1 shows" is an ask without a budget.

**F11 (Medium). With Sol out, a wave-1 CUT-CANDIDATE would cut shipped text on Opus-only evidence.** Line 122 (new) drops Sol on price, which R54 allows with a reason. But Garry's R54 words name Opus and Sol as the models gstack is built for. Cutting or dieting shipped skill text affects Sol users too, so each verdict should carry its model scope. A cheap Sol admission row (12 x 2, none and told, about $55 to $75 a skill at R3a's Sol ratios) would show whether Sol's exposure or headroom differ before a cut.

**F12 (Medium). One-tree screening on U's and X's coarse scores makes the 40% yield optimistic.** Line 213 (new) screens U and X on one tree "because their fractional score already bands". X's tree score is 0, 0.5 or 1, so the band admits only 0.5. A task with per-run success p lands there with probability 2p(1-p), at most 50%. U's 0, 1/3, 2/3 or 1 is better but noisy too. The admitted set also regresses toward 0 or 1 on the confirmatory none arm. Section 14's need of 190 and 240 valid tasks, and the authoring cost behind it, rest on the 40%.

**F13 (Low). particle-1 rows print no size or MDD.** Line 276 lists "particle-1 none and told" with tasks x trials and MDD only for Opus, though every verdict is meant to carry its MDD.

**F14 (Low). Wave 2 and 3 prices assume wave-1 panels that get built only for admitted skills.** Line 304 and the rows after it reuse the G panel for verify, deslop-shared-libs, context-save, context-restore and learn. Line 213 builds a panel only for admitted skills. If both G skills stop at admission (on exposure, say), those five rows lose their reuse price.

**F15 (Low). This plan's own crew use sits outside the all-in ceilings.** Line 268 calls it program overhead. The Captain's reading of Garry's ceiling includes thread model use (NOTES.md:1174). The sum is small, but the record should show who accepted it.

## Review sections 1 to 11 (delta and consequences)

**Section 1, Architecture.** One rig with per-family builds is sound, and the split of O3 into O3a and O3b matches the family order. The consequence of v2's per-skill ceilings is coupling: shared costs (crew, panel, none arm) ride on whichever skills pass admission, so later waves' prices depend on earlier skills' exposure (F14). The futility and cost-guard logic both land in O4, a scorer-class build, so F1 and F2 must change O4's spec before it is written. 2 issues.

**Section 2, Error and rescue map.** See the registry below: 8 capability rows, 1 critical gap (F1).

**Section 3, Security and threat model.** Custody is unchanged from v1. v2 puts particle-1 into four wave-1 skills, so sealed G and X statements will pass through OpenRouter. Section 11 already gates that on the proxy's data-collection deny and on citing Claude Code's gateway clause in the first prereg that runs particle-1 (lines 383 to 384). G admission runs particle-1 "after Opus's pass", so both gates must clear before G admission's particle-1 rows, not just before the confirmatory prereg. No new finding: the plan's own gate covers it if it's read in that order. 0 High.

**Section 4, Data flow and edge cases.** Cost per solved task is defined on "solved trials" (line 101), which has no meaning for U's completion fraction or X's docs-only mean (folded into F2). The interim-favors-none case is unhandled (F1). The case where both skills in a family fail exposure on the before pin leaves the panel unbuilt (F14). 3 edge cases mapped, 2 unhandled.

**Section 5, Code quality.** No code yet. O1 has to freeze autoplan's invocation as a turn script (F5). 1 issue.

**Section 6, Test review.** O5's keyless dry run should drive the futility rule in both directions and the cost-guard rule on fixture ratios (F1, F2). These are rules that move outcomes, which the CREW lessons say to attack in the plan before code. 2 gaps.

**Section 7, Performance.** autoplan's wall time is unmeasured on real repos. This run's four native voices took 1,787 s on one plan (timing.json), with outside voices disabled. The arm-stop limits frozen from admission's p95 handle it, and the metering belongs with F5. 1 issue.

**Section 8, Observability.** The plan prints MDD, exposure, gaps and cost per solved task. It should also print the interim estimate at any futility stop (F1), the break-even gain per skill (F2) and the price-stress MDDs (F4). 3 gaps.

**Section 9, Deployment and rollout.** Staging G, then X, then U is right. G admission on 11-11 and the G prereg on 11-17 leave six days for bulk mining, authoring about 360 candidates with two audits each, and screening. The dates move with yield, which is fine, but GST-1218 hangs on them (F3). 2 risks flagged.

**Section 10, Long-term trajectory.** Reversibility is 4 of 5: nothing here changes gstack, and a wiki post can be superseded. The step that is hard to undo is a cut of shipped text made on Opus-only (F11), forced-line (F3) or futility-stopped (F1) evidence. Debt items: 2 (F9 stale rows, F10 double-priced /review).

**Section 11, Design and UX (UI scope yes).** The design measurement text is unchanged from v1, and its 12 open design findings were deferred to the gate by the Captain (design-deferred.findings.jsonl, with d5b's Critical carried). From the CEO view the new issue is U's decision value under the ceiling (F7). 1 issue.

## NOT in scope

Deferred by the plan (each comes back at a later prereg): Sol in wave 1 (price; F11 asks for a scoped label), the plan-first arm, follow-up change runs, U judges, untold arms unless the after pin shows opens, waves 2 and 3, and Codex host rows (HARN-13).

Rejected by the plan: seeded-flaw panels (saturated three times), judge preference as a primary, self-reported scores, "no effect" readings (unaffordable equivalence), and the 32 skills section 5 lists as not outcome-testable.

Rejected by this review: raising the ceiling (the owner's call), other stacks as arms (idea sources only under CREW), and a second seeded-flaw round. Deferred by this review: a finer primary (share of the change's own hidden tests passed), to the G prereg's re-simulation.

## What already exists

- The real-world outcome lane's rig (Harbor runner, metering proxy and ledger, verifier, sidecar, mining, custody): reused, as planned.
- Panel v3's clean room (C1) and forced lines: reused for the none preflight and decision 3's fallback.
- #169's guard G3 (cost per solved ratio, task-clustered bootstrap, upper bound): exists in the overhaul prereg (README.md:178). O4 should reuse its definition for F2, not invent a new one.
- R3 amendment 4's between-part projection check F1 (README.md:148) stops a run before a stage whose projected spend passes the cap. It fits F4's stage gate between admission, screening and confirmatory.
- R3 amendment 4's fixed procedure line: a working precedent for the forced arm. Its pilot showed the told procedure in only 2 of 10 Opus trials (README.md:42), which is the exposure risk decision 3 plans around.
- src/runner/stats and lanes/real-outcome/score: reused by O4.
- power.py and mdd-grid.json from v1: reused, with the 1.2 design effect.

## Dream state delta

The 12-month ideal: every F-tier skill has an outcome verdict per frontier model, with its cost per solved task and its break-even gain, and gstack's mandatory workflows (/autoplan, /ship) are configured by measured value, not habit. v2 as written gets to Opus-only verdicts that see only large effects, plus exposure rates and cost multiples. With F1 to F6 it also gets decisive cost-based KEEP or CUT readings, an honest loss path, and a measured answer to whether autoplan beats plan-eng-review alone. Still missing after this plan: Sol, effects under about 13 points, design skills (until a cheaper calibrated agent user exists), and ship under the ceiling.

## Error and rescue registry (strategy level, capability rows)

| Capability | Failure mechanism | User impact | Known safeguard | Gap | Owner to verify |
|---|---|---|---|---|---|
| Price model (section 8) | sessions, told multiples, particle-1 or agent user cost 2x to 4x the assumption | MDDs widen past what can decide | admission meters, prereg re-sizes, cap stop | no stop when a re-sized MDD can't change a decision (F4) | Captain at each admission |
| Told on a pin (decision 3) | after pin late; forced line also under 7 of 8 | reading can't KEEP or CUT; exposure FIX-METHOD | decision 3 fallback, admission item 2 | GST-1218 promise (F3) | Captain with GSTA-256 |
| autoplan invocation (O1) | kind, voices and gate unfrozen | verdict attaches to an unnamed configuration (F5) | none | F5 | O1 builder; GSTA-36 for the pin's default |
| Futility look (O4) | one-sided | losses posted as "not distinguished" (F1) | non-binding look | F1 | O4 builder; O5 dry run |
| Cost guard (O4, R48) | binding status unstated | verdicts predetermined or undefined (F2) | cost per solved printed | F2 | Garry for the bar; O4 for the rule |
| Screening (stage 4) | one tree on a 2- or 3-level score | low U and X yield, more authoring (F12) | slice yield read | F12 | T-X and T-U builders |
| Lane amendments (section 4) | ship and review spend outside a decided ceiling | unfunded asks (F10) | Captain decision in Needs | F10 | Captain |
| Panel reuse (waves 2 and 3) | wave-1 panel never built | wave-2 prices wrong (F14) | re-price at each prereg | F14 | wave-2 prereg authors |

## Failure modes registry

```
  CODEPATH               | FAILURE MODE                                        | RESCUED? | TEST? | USER SEES?               | LOGGED?
  -----------------------|-----------------------------------------------------|----------|-------|--------------------------|----------------
  O4 futility look       | interim favors none -> stop -> "not distinguished"  | N        | N     | Silent (loss hidden)     | interim MDD only   <- CRITICAL GAP (F1)
  O4 cost guard / R48    | 1.5x bar status unstated; told is 2.2x to 5.0x      | N        | N     | Visible (ratio printed)  | yes
  Decision 3 / GST-1218  | after pin late -> forced line -> no KEEP or CUT     | partial  | n/a   | Visible                  | yes
  O1 autoplan turn       | kind and voices unfrozen                            | N        | N     | Partly silent            | turn script only
  Section 8 prices       | 2x to 4x under the assumption                       | Y        | n/a   | Visible (MDD printed)    | yes
  Stage 4 U/X screen     | one tree on a coarse score                          | partial  | N     | Visible late             | yes
  Section 4 lane asks    | spend outside a decided ceiling                     | Y        | n/a   | Visible                  | yes
  Waves 2-3 reuse        | panel never built                                   | Y        | n/a   | Visible at prereg        | yes
```

8 rows, 1 critical gap.

## Scope expansion decisions

Not applicable: HOLD SCOPE. No expansion is proposed. F6 adds secondaries on arms already paid for, and F7 would spend less.

## Diagrams

1. One skill's spend and decision path, with where the findings bite:

```
  thin slice built (crew, VM)
          |
     ADMISSION (12 x 2, $34 to $84 at central; about 2x at house central)  <- F4
       | headroom fail    -> FIX-METHOD, stop (R61 raise is a new ask)
       | exposure fail    -> exposure FIX-METHOD, stop (forced only on fallback)  <- F3, F5
       | instrument fail  -> instrument FIX-METHOD, stop                   <- F7 (U)
       | price re-size    -> MDD printed; add: stop if it can't decide      <- F2, F4
          v
     SCREENING into the 20 to 80% band (G 2 trials; U and X 1 tree)        <- F12
          v
     CONFIRMATORY, half panel
       | futility look: CP < 10% for +MDD -> stop, "not distinguished"     <- F1 (one-sided)
          v
     CONFIRMATORY, full panel
          v
     READING: helps | hurts | not distinguished, with cost per solved      <- F2 (guard binding?)
          v
     R48 Why-null -> KEEP | FIX-METHOD | CUT-CANDIDATE                     <- F3 (GST-1218), F11 (Opus only)
```

2. plan-eng-review's $2,000, with the lines that rest on a guessed price marked `*`:

```
  crew 160 | authoring 259 | screening 203* | admission 34* | Opus confirmatory 923* | particle-1 103* | reserve 318
  = 2,000. At the house central price, the starred lines roughly double and the reserve can't cover them.
```

The system, state-machine and error-flow views are in diagram 1. Deployment and rollback diagrams don't apply: the plan builds nothing yet, and rollback is a superseding wiki post.

## Stale diagram audit

The plan has no ASCII diagrams. Four tables act as diagrams, and three are stale after the delta: section 2's family table (autoplan in U and X), section 5's wave-1 table (follow-up, judges, autoplan as G, U, X) and section 9's R48 table (idea-only for skills with no stand-in, follow-up in plan-eng-review's raise). Section 1's question text is stale too. All are covered by F9. Stale found: 3 tables plus 1 paragraph.

## Completion summary

```
  +====================================================================+
  |            MEGA PLAN REVIEW - COMPLETION SUMMARY                   |
  +====================================================================+
  | Mode selected        | HOLD SCOPE                                  |
  | System Audit         | after pin unnamed; house price 2x plan's;   |
  |                      | E0 anchor is plain one-turn; kinds postdate |
  |                      | the before pin; 1.5x bar binding in #169    |
  | Step 0               | hold scope under the owner's ceiling        |
  | Section 1  (Arch)    | 2 issues found                              |
  | Section 2  (Errors)  | 8 error paths mapped, 1 GAP                 |
  | Section 3  (Security)| 0 issues found, 0 High severity             |
  | Section 4  (Data/UX) | 3 edge cases mapped, 2 unhandled            |
  | Section 5  (Quality) | 1 issue found                               |
  | Section 6  (Tests)   | Diagram produced, 2 gaps                    |
  | Section 7  (Perf)    | 1 issue found                               |
  | Section 8  (Observ)  | 3 gaps found                                |
  | Section 9  (Deploy)  | 2 risks flagged                             |
  | Section 10 (Future)  | Reversibility: 4/5, debt items: 2           |
  | Section 11 (Design)  | 1 issue (12 design findings deferred)       |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (14 items)                          |
  | What already exists  | written                                     |
  | Dream state delta    | written                                     |
  | Error/rescue registry| 8 rows, 1 CRITICAL GAP                      |
  | Failure modes        | 8 total, 1 CRITICAL GAP                     |
  | TODOS.md updates     | 0 items proposed (reviewer writes none)     |
  | Scope proposals      | 0 proposed, 0 accepted (HOLD SCOPE)         |
  | CEO plan             | skipped by mode                             |
  | Outside voice        | disabled (Captain two-voice limit)          |
  | Lake Score           | N/A (no question answered in this phase)    |
  | Diagrams produced    | 2 (decision state machine, dollar flow)     |
  | Stale diagrams found | 3 tables, 1 paragraph                       |
  | Unresolved decisions | 5 (listed below)                            |
  | Reality rows         | 13/13 rows (PLAN_REALITY), 0 unverified     |
  +====================================================================+
```

The saved terminal report, published summary, review log row and next-skill handoff are the runner's stages (gstack-autoplan), not this voice's.

## Unresolved decisions

1. Does the 1.5x cost-per-solved bar bind told skills, on which measure for U and X, and in #169's upper-bound form? This is Garry's call, and it decides autoplan's verdict before spend (F2).
2. If the after pin isn't named by G admission, does GST-1218 wait for it, or take a forced-line reading as information only? This is the Captain's call (F3).
3. Should U's wave-1 confirmatory wait for a cheaper calibrated agent user? This is the user challenge, for Garry or the Captain (F7).
4. Does the $2,000 ceiling bind ship's lane test, and so the two lane amendments? This is the Captain's call, already in Needs (F10).
5. Which autoplan kind and voice setting does the told arm freeze, on each pin? This is the Captain's call, with GSTA-36 for the after pin's default (F5).

```gstack-findings
{"id":"F1","severity":"Critical","title":"Futility look is one-sided: a skill trending to hurts stops at half the panel and is posted as not distinguished","file":"<local notes (not committed)>/autoplan-ceo-3xMLJc/ceo-implementation.md","line":226,"fix":"Stop for futility only when conditional power is under 10% for a true effect of both plus and minus the planned MDD, so a skill whose interim estimate favors none runs the full panel and can read hurts. Print the interim estimate, its 95% interval and its direction at every stop, and have R48 treat an interim estimate in none's favor as a loss lead, not a plain null. Add both cases to O5's keyless dry run."}
{"id":"F2","severity":"High","title":"The 1.5x cost-per-solved guard can't be passed by most wave-1 told skills at the plan's own 2.2x to 5.0x multiples, and the plan doesn't say whether it binds","file":"<local notes (not committed)>/autoplan-ceo-3xMLJc/ceo-implementation.md","line":85,"fix":"State whether the guard binds told skills and in which form (#169 binds it on H-inv as an upper bound <= 1.5, README.md:178). Print each skill's break-even gain beside its MDD in section 8 (at a 50% control rate: plan-eng-review +23, plan-devex-review and plan-design-review +30, devex-review +33, design-review +50, autoplan unreachable). Define solved for U's and X's cost figure, reuse #169's G3 definition in O4, and write the R48 rule that turns the ratio interval into KEEP or CUT-CANDIDATE. Ask Garry before admission whether 1.5x on hidden-test solves is the bar for a told skill."}
{"id":"F3","severity":"High","title":"The promise that wave 1 settles GST-1218 rests on an unnamed after pin and on a null inference the plan disowns","file":"<local notes (not committed)>/autoplan-ceo-3xMLJc/ceo-implementation.md","line":293,"fix":"Replace 'A null rules out a gain of that size' with an interval rule: a gain is ruled out only above the upper 95% bound of told minus none, or against F2's break-even gain. Tie GST-1218's keep-or-cut reading to a told arm on the named after pin. If the pin isn't named by G admission, tell the Captain then that plan-eng-review's and plan-devex-review's rows can only inform GST-1218 (a forced-line verdict can't KEEP or CUT, line 27), and let the Captain choose between waiting and reading the forced line as information."}
{"id":"F4","severity":"High","title":"Central prices sit at half the house's real-task central (R3 amendment 4: 5x Verified) and the price-risk case stresses only the none session","file":"<local notes (not committed)>/autoplan-ceo-3xMLJc/ceo-implementation.md","line":262,"fix":"Stress section 8 at the house central (5x Verified) and high (10x), with particle-1 at quick look 3's 0.41 of Opus, told multiples at 1.5x their central and the agent user at 2x, and print which rows survive and their MDDs. Show the wave-1 table's MDDs at both central and house central. Reuse R3 amendment 4's between-part projection check between admission, screening and confirmatory, so a stage that would push a skill's re-sized MDD past what can change its decision stops before it spends. Recheck particle-1's 2-point fit at admission's metered ratio before any particle-1 spend."}
{"id":"F5","severity":"High","title":"autoplan's told arm names no kind, voice count or gate setting; the before pin predates R66's kinds and the 5.0x price assumes the full panel","file":"<local notes (not committed)>/autoplan-ceo-3xMLJc/ceo-implementation.md","line":263,"fix":"Freeze autoplan's told invocation in O1: the kind (crews now run --kind feature on features), the phases scope chooses, the outside voice and its model, the gate answer, and the exact slash line per pin. Meter that configuration on admission sessions before autoplan's place, size and MDD in the wave-1 table are fixed, align the four-way stand-in with it, and name the configuration in every autoplan verdict. If the after pin's default kind differs, the prereg says which one it tests and why."}
{"id":"F6","severity":"Medium","title":"Free within-family contrasts go unread: autoplan against plan-eng-review told and its stand-in on the 78 shared G tasks","file":"<local notes (not committed)>/autoplan-ceo-3xMLJc/ceo-implementation.md","line":276,"fix":"Preregister as secondaries at no added spend: autoplan told minus plan-eng-review told and autoplan told minus plan-eng-review's stand-in on the 78 shared tasks, each with its cost-per-solved ratio, plus plan-devex-review told beside devex-review told on X's shared panel as a descriptive line. Draw autoplan's 78 tasks as a seeded subset of the 108 and run all G arms in the same interleaved batches."}
{"id":"F7","severity":"Medium","title":"U's wave-1 confirmatory buys a 15 to 16 point reading the plan says can't move a design skill to a cut","file":"<local notes (not committed)>/autoplan-ceo-3xMLJc/ceo-implementation.md","line":294,"fix":"Apply section 8's rule for design-consultation and design-html to U's wave-1 rows: plan-design-review and design-review go to confirmatory only once a cheaper agent user passes the same calibration and the prereg's MDD is about 12 to 13. Otherwise they stop after admission with their price, exposure and calibration reading as FIX-METHOD, and most of their $3,299 plan stays unspent.","user_challenge":true,"changes":"cost"}
{"id":"F8","severity":"Medium","title":"The branch design that cancels build noise is offered to design-review only; devex-review has the same after-build shape","file":"<local notes (not committed)>/autoplan-ceo-3xMLJc/ceo-implementation.md","line":294,"fix":"Offer devex-review the same branch design: told continues from the none arm's own built tree with gstack installed before T2, so told pays only for T2 and build noise cancels. Admission measures its spread on the X slice and X's prereg uses it when its MDD comes out lower. State in section 4's arm table that T1 then runs without gstack installed."}
{"id":"F9","severity":"Medium","title":"Sections 1, 2, 5 and 9 still describe v1's arms and measures (stand-in and untold for every skill, autoplan in U and X, follow-up and judges in wave 1)","file":"<local notes (not committed)>/autoplan-ceo-3xMLJc/ceo-implementation.md","line":148,"fix":"Edit section 1's question to none and told, with the stand-in where it runs; drop autoplan from section 2's U and X rows; in section 5's wave-1 table drop follow-up and judges and set autoplan's family to G; in section 9 mark the idea-only column as plan-eng-review only and drop the follow-up clause from plan-eng-review's saturation raise."}
{"id":"F10","severity":"Medium","title":"Lane amendments ask for ship and review spend the ceiling may not allow, and /review's K4 arms are priced both in the lane and as wave 2's $1,619 row","file":"<local notes (not committed)>/autoplan-ceo-3xMLJc/ceo-implementation.md","line":126,"fix":"Make both lane amendments conditional on the Captain's decision on whether the $2,000 ceiling binds ship (the Captain's reading is that whole-gstack evals get the same, NOTES.md:1174). Price /review's K4 arms in one place only: either here as wave 2's row or in the lane's plan."}
{"id":"F11","severity":"Medium","title":"With Sol out of wave 1, a CUT-CANDIDATE would cut shipped skill text on Opus-only evidence","file":"<local notes (not committed)>/autoplan-ceo-3xMLJc/ceo-implementation.md","line":122,"fix":"Label every wave-1 verdict as Opus 5.5 only and say in each CUT-CANDIDATE that Sol is untested. Consider a Sol admission-only row (12 x 2, none and told, about $55 to $75 a skill at R3a's Sol ratios) from each G and X skill's reserve, so a cut can say whether Sol's exposure or headroom differ."}
{"id":"F12","severity":"Medium","title":"One-tree screening on X's 0/0.5/1 and U's thirds scores makes the 40% in-band yield optimistic","file":"<local notes (not committed)>/autoplan-ceo-3xMLJc/ceo-implementation.md","line":213,"fix":"Screen U and X on two none trees, or on a band the thin slice validates, and set their in-band yields from the slice's measured screen instead of 40%. Re-derive section 14's 190 and 240 valid-task needs, the mining reach and the authoring cost from that yield."}
{"id":"F13","severity":"Low","title":"particle-1 rows print no tasks x trials or MDD","file":"<local notes (not committed)>/autoplan-ceo-3xMLJc/ceo-implementation.md","line":276,"fix":"Print particle-1's size, MDD and expected none rate on the Opus-screened panel per skill in the wave-1 table, so its floor rule and the 2-point fit can be checked."}
{"id":"F14","severity":"Low","title":"Wave 2 and 3 prices reuse wave-1 panels that are built only for admitted skills","file":"<local notes (not committed)>/autoplan-ceo-3xMLJc/ceo-implementation.md","line":304,"fix":"Say that a reused-panel row is priced again without reuse if its family's wave-1 skills stop at admission, and show the five G-reuse rows (verify, deslop-shared-libs, context-save, context-restore, learn) at their stand-alone price."}
{"id":"F15","severity":"Low","title":"This plan's own crew use sits outside the all-in skill ceilings","file":"<local notes (not committed)>/autoplan-ceo-3xMLJc/ceo-implementation.md","line":268,"fix":"Charge this plan's crew use pro rata to the six wave-1 skills, or have the Captain record it in approvals/ as accepted program overhead, since the Captain's reading of the ceiling includes thread model use."}
```
