# All results

This page lists every gstack-evals result, including the ones still waiting for their independent checks. It also gives the full notes behind the README's scorecard, how a result is made and what the words in the posts mean. The [README](../README.md) shows the checked results as a scorecard.

## How a result is made

1. A preregistration, a plan fixed in advance, states the question, the setups, the tasks, the models, the scoring rules, the spend cap and the stop rule. It merges in its own pull request, before any result.
2. Since 2026-10-31, every comparison includes a setup with no gstack: the same model, tasks and agent program, with no gstack installed and a plain prompt. Many also include a placebo: gstack's skill files with their instructions swapped for plain text of the same length.
3. The run spends only through a budget record. A run that hits its cap stops and is reported as incomplete. It is never rerun to change a verdict.
4. A results post reports each skill's effect per model, with its 95% range. A result that shows no difference gives the no-gstack rate and the smallest difference the test could have seen, and asks why it showed none: did the agent use the skill, did the tasks fit, was the test big enough, and does the plain model already do the job?
5. A result enters the README's scorecard only after a model from another lab has checked its claims against the post and its data, and a separate team has rerun its numbers from the run's record.

Unpublished tasks, hidden tests and answer keys never enter this repo, so models can't learn them from here. The repo keeps only their counts and fingerprints (digests), so anyone given the files later can check they didn't change.

## How to read a verdict

- **Helps:** the gstack setup did measurably better, and the 95% range sits above zero.
- **Helps (opens only):** the agent opened the skill more often. That says nothing about whether it solved more tasks.
- **No difference we could measure:** the 95% range includes zero. The test may have been too small to see a modest gain, so this is not proof that the skill does nothing.
- **Worse:** the gstack setup did measurably worse. "Lower, not confirmed" means it scored lower but missed the bar fixed in advance.
- **Couldn't test yet:** the test couldn't answer its question. Usually the plain model already solved nearly everything, the skill never ran, or the run broke. The test needs fixing or harder tasks before it can say anything.
- **No verdict:** the run's own entry check didn't admit the comparison.

## Scorecard notes

The README's scorecard keeps each note to one line. These are the notes in full.

### Reading the table

A skill is a written procedure the agent can open, which loads its instructions into the session. A hook is a small program that runs during a session and can stop the agent until a rule is met. /review checks a code change for bugs, /investigate debugs a failure, plan-ceo-review and plan-eng-review review a plan before any code is written, and autoplan runs gstack's plan reviews one after another. "On its own" means the task didn't name the skill, though gstack's routing hook may have. The routing and description rows compare two versions of gstack, and both appear under "With gstack". The models are Anthropic's Claude Opus 5.5, OpenAI's GPT-6.1 Sol and particle-1, a low-cost model from Particle.

### /review, full procedure

A blocking bug is one serious enough that the change shouldn't merge. Each of the 42 known blocking bugs, in 33 review tasks, was reviewed twice. 41 of the 42 came from code reviews done with gstack or its close relatives, so the test may suit gstack. In 42 of the 66 gstack sessions the full procedure ran only after a gstack hook blocked the agent for skipping it; 24 ran it unprompted. A gstack session cost 8.9 times as much as one with no gstack.

### Skill-routing overhaul

The overhaul is gstack v1.94.39.0, which adds a hook that names the right skill for the task, hooks that enforce a skill's steps and rewritten skill descriptions, tested as one package against v1.93.22.0. With no gstack there is no skill to open. These rows count opens, not solved tasks: pass rates showed no change we could measure (Opus, prompt not naming the skill: -2.5 [-7.5, +2.5]; Sol, prompt asking for it: +0.0 [-5.0, +5.0]), and the test was too small to see one. On Opus every open came on one of the 19 tasks the new hook sent to the skill, and none came with the new hooks switched off.

### Skill-routing overhaul on GPT-6.1 Sol

The run's entry check, a small pilot that decides whether a comparison goes ahead, didn't let this one through, so it has no verdict. The pilot's reason was that Sol had no room to improve, and that reason doesn't hold up: with the new hooks switched off Sol opened the skill in 88.8% of sessions (71 of 80), and at Sol's 65.0% starting rate the test could see a gain of 18.6 points, inside the 20 points it was looking for.

### /investigate description that says when to use it

This compares the rewritten description with the one gstack shipped. All of the gain came from Sol, and Sol's own change is exploratory: it wasn't the planned comparison. Sol's 9.5% for the old wording pools the gstack setup with a placebo setup, a stand-in used for comparison. Opus 5.5 and particle-1 opened nothing in 363 eligible trials. No effect on solving tasks was tested. The test used 37 tasks from Terminal-Bench 2, a public benchmark of command-line tasks, one trial per task per setup.

### plan-ceo-review

On 84 real product plans, the score is whether a review named the issue that later decided the plan's fate, not whether the plan got better, so it doesn't tell us whether the skill improves plans. [A new test](../wiki/plans/2026-11-08-geva-403-product-value-prereg/README.md) asks that. "With its gate hook" is a later gstack with plan-ceo-review's gate switched on, a hook that checks the review's steps. The two Opus rows count slightly different sets of reviews, so Opus's no-gstack rate differs between them.

### plan-ceo-review on particle-1

The 95% range sits below zero, but the stricter test the plan fixed in advance didn't pass. That test allows for trying two versions on each model, so one lucky result doesn't count. It isn't a confirmed loss.

### plan-eng-review and autoplan

The plan needed plain Opus to solve between 20% and 80% of trials, to leave room for a gain. It solved every trial that finished (95% range 84.6% to 100%, on 11 of 12 tasks), so the comparison never ran. That range treats every trial as independent, so it may be too narrow. Asked to use these skills, Opus showed no sign of running their steps in any scored session (0 of 18 for plan-eng-review, 0 of 23 for autoplan), by an automatic check for those steps.

## Results that have had both checks

A model from another lab checked each of these posts against its data, and a separate team reran its numbers from the run's record. Each post applies the corrections both checks found. The README's scorecard does not list them.

**/investigate on coding and command-line tasks**

- **No loss we could measure**, particle-1: loading placebo text as long as a skill into the prompt didn't lower its pass rate on command-line tasks by any amount we could measure. [Placebo text cost](../wiki/board/2026-11-10-geva-513-run-t-text-tax-results.md)

**The standard steps at the top of every gstack skill**

- **Cutting them met the non-inferiority margin on particle-1; no verdict on Opus 5.5**: removing the standard steps that open every gstack skill met its preregistered 10-point non-inferiority margin on particle-1. On Opus the command-line task score fell measurably with the cut, but a required check on the run failed, which left Opus without a verdict. [Results](../wiki/board/2026-11-10-geva-513-ceremony-cut-results.md)

**plan-ceo-review and office-hours**

- **Couldn't test, the procedures didn't run**, Opus 5.5: in a descriptive first-stage check, neither planning skill passed its procedure detector (0 of 18 plan-ceo-review sessions across three tries, 0 of 6 office-hours sessions), so no comparison of the skills' effect on plans ran. [Product value, stage 1](../wiki/board/2026-11-10-geva-513-product-value-stage-1-results.md)

**autoplan**

- **Three promises not met**, the team's own autoplan runs: audited against autoplan's own promises from 40 of its run records, the lean default's one reviewer produced 0.358 of the required outputs (95% range 0.275 to 0.443, against a bar of 0.80), no second model family runs in it, and its gate let an agent's own words settle three items only the owner should decide. [Autoplan record audit](../wiki/board/2026-11-10-geva-513-autoplan-record-audit-results.md)

## Results waiting for their independent check

These results have no numbers here, because they haven't yet had both checks the scorecard needs. Each post has its numbers and ranges. Losses, results that showed no difference and tests with no room sit beside wins, because a test with no room to show a gain is a result too.

**/review**

- **Couldn't test**, Opus 5.5: in the first round of comparisons with other skill sets, Opus skipped the extra reviewer agents that /review's procedure calls for in every session, so the procedure never ran and no gain showed. [Round 1 review results](../wiki/board/2026-11-01-geva-89-stacks-round-1-review-results/README.md), [round 1 summary](../wiki/board/2026-11-01-geva-105-gstack-null-review-and-tb2/README.md)
- **Couldn't test**, Opus 5.5: the first run of the full procedure failed its check that the procedure ran, partly because the program that ran the sessions ended them before their reviewers returned, so it measured no outcome. [First full-review run](../wiki/board/2026-11-02-geva-175-r2-full-review-results/README.md)
- **Couldn't test**, Opus 5.5: the rerun failed its small trial run, so the main run never started. [Rerun](../wiki/board/2026-11-03-geva-229-r2-rerun-results.md)
- **Promising, so we ran the scorecard test**, Opus 5.5: judged blind, an earlier version of the full procedure in another agent program found far more blocking bugs than plain Opus. [Blind re-judge](../wiki/board/2026-11-01-geva-113-r1-blind-rejudge-results/README.md)
- **No difference we could measure**, Opus 5.5: an early look replayed gstack's reviewer prompts on known gstack bugs, and the gain's 95% range included zero. [Review replay quick look, corrected](../wiki/board/2026-10-29-gsta-20-review-replay-y09-correction/README.md)

**/investigate on coding and command-line tasks**

- **Couldn't tell**, Opus 5.5: on tasks picked so Opus solves some and fails some, asking for /investigate made no difference we could measure, and the test was too small to see a modest gain. [Results](../wiki/board/2026-11-07-geva-380-r3c-results.md)
- **Couldn't tell**, Opus 5.5 and GPT-6.1 Sol: no difference we could measure, on tasks so hard that neither model solved many of them without gstack. [Results](../wiki/board/2026-11-04-geva-283-r3b-results.md)
- **Couldn't test**, Opus 5.5 and GPT-6.1 Sol: the first check stopped because both models solved nearly every task without gstack. [First check](../wiki/board/2026-11-03-geva-239-r3a-saturation-results.md)
- **Room check passed**, Opus 5.5 and GPT-6.1 Sol: a new task set left enough tasks unsolved to test /investigate. This checks room only and doesn't measure any effect. [Room check](../wiki/board/2026-11-04-geva-263-r3a4-admission-results.md)
- **Couldn't test**, Opus 5.5 and particle-1: in the first round of comparisons with other skill sets, on command-line tasks, Opus never wrote /investigate's debug report, so the procedure never ran and no gain showed. pstack, Lauren Tan's skill set, ran beside it and won no comparison. [Round 1 terminal-task results](../wiki/board/2026-11-01-geva-93-stacks-round-1-tb2-results/README.md)
- **Couldn't test**, Opus 5.5: with gstack installed but not named in the prompt, agents never opened a skill. [/investigate quick look 1](../wiki/board/2026-10-29-gsta-12-laneb-quick-results/README.md)
- **Worse, exploratory**, Opus 5.5: asked to use /investigate, Opus did measurably worse than with no skill in this exploratory look. Its loss to the placebo did not replicate, as the corrections below say. [/investigate quick look 2, corrected](../wiki/board/2026-10-29-gsta-30-laneb-quick-2-body-load-correction/README.md)
- **No difference we could measure**, particle-1: asked to use /investigate, particle-1 did no better, and it trailed the placebo without a gap we could measure. [/investigate quick look 3](../wiki/board/2026-10-30-gsta-30-laneb-quick-3-results/README.md)

**Getting agents to open skills**

- **Helps (opens only), waiting on a recount**, particle-1: gstack's routing overhaul got particle-1 to open /investigate on its own more often, only where the new hook named the skill, and no setup with the hooks switched off ran on particle-1. The result rests on a blind check by readers whose records were lost. Without those records the run's own analysis can't confirm it, so it waits until that check can be redone. A later note on task images that kept the answer in their git history corrects the published leak counts and moves no verdict. [Overhaul on Sol and particle-1](../wiki/board/2026-11-08-geva-353-l1-sol-particle-results/README.md), [claim check](../wiki/board/2026-11-09-geva-431-claim-check-corrections.md#l1-gstacks-overhaul-before-and-after-opus-55-gpt-61-sol-particle-1), [containment note, corrected](../wiki/board/2026-11-12-geva-529-containment-note-correction.md)

**plan-ceo-review**

- **Couldn't test, no room**, Opus 5.5: plain Opus found every planted issue in a set of plans built for this test, so there was no room to show a gain. [Room check](../wiki/board/2026-11-02-geva-142-ceo-panel-v2-admission-results/README.md)
- **Couldn't test, no room**, Opus 5.5 and particle-1: in a pilot, plain Opus found every planted flaw, and the review procedure never ran. [Planning pilot stop](../wiki/board/2026-11-01-geva-102-planning-r1a-pilot-stop/README.md)

**plan-eng-review, other plan reviews and autoplan**

- **Couldn't test, no room; rerun matched; another lab's read not yet in a public post**, Opus 5.5, no-gstack setup only: in a set of plans with planted flaws, plain Opus found nearly every flaw meant for the engineering and developer-experience reviews, and nearly every flaw in the set's first round. The flaws meant for the CEO and design reviews were scored, but each set had too few items to give a reading. No gstack setup ran, so no skill effect was measured, and the test covered only whether planted flaws get found. The skills' main aims are untested. [Planted-flaw room check](../wiki/board/2026-11-03-geva-250-panel-v3-headroom-results.md), [first round](../wiki/board/2026-11-03-geva-232-panel-v3-e0-results.md), [claim check](../wiki/board/2026-11-09-geva-431-claim-check-corrections.md#panel-v3-e0-and-the-headroom-check)
- **Couldn't test, no room**, Opus 5.5, no-gstack setup only: on 42 larger Go features, plain Opus solved too many tasks without gstack to leave room for a gain, however the trials the run flagged are scored. The run's own rule read it as a harness problem, because its check for gstack reads flagged trials in task repositories that name agent skill folders. [Larger-features room check](../wiki/board/2026-11-10-geva-506-autoplan-larger-features-h1-results/README.md)
- **Couldn't test, floor**, Opus 5.5: on 16 real changes, plain Opus's plan reviews named too little of where each change's later bugs, follow-up tests and CI changes landed to clear the bar the test set in advance, so no skill comparison ran. A checked judge from another lab did the grading. [Eng-review intentions, stage 1](../wiki/board/2026-11-11-geva-434-eng-review-intentions-stage-1-results.md)
- **Couldn't test, too few units**, Opus 5.5: the build read, which grades the code Opus writes from a reviewed plan against the tests the real team wrote for the change's later bugs, stopped before any paid call. Only 2 of 51 real changes could be graded inside the sandbox its preregistration froze, against the 16 it needed. [Build read stop](../wiki/board/2026-11-12-geva-525-eng-review-build-read-stop.md)
- **Steps ran**, Opus 5.5: with a gstack hook that checks the order of autoplan's report, autoplan, when asked for, ran its review steps in most sessions. This checks that the steps ran, not whether they help. [Report-order recheck](../wiki/board/2026-11-08-geva-396-autoplan-report-order-recheck-results/README.md)
- **Couldn't test**, Opus 5.5: with a gstack hook that checks autoplan's steps before the session stops, autoplan ran them in too few sessions to pass the check that they ran. [Stop gate](../wiki/board/2026-11-07-geva-391-e2-autoplan-exposure-results/README.md)
- **Couldn't test**, Opus 5.5: with an opt-in version of that hook, the check that the steps ran failed at its early stop, and our automatic check saw fewer review steps than actually ran. [Opt-in gate](../wiki/board/2026-11-07-geva-384-r61-autoplan-gate-results/README.md)

**office-hours and /learn**

- **No difference we could measure**, Opus 5.5: a shorter office-hours skill (gstack's coach for a product idea) did as well as the longer one in a small test, and /learn (which saves lessons for later sessions) left no room. [Office-hours and /learn quick look](../wiki/board/2026-10-28-gsta-13-quick-look-3-results/README.md)
- **Tooling test only**, Opus 5.5, GPT-6.1 Sol and particle-1: two trial runs of the test that compares a skill before and after an edit tested our tooling, not a skill, though Sol failed a /learn safety task. [First trial run](../wiki/board/2026-10-30-geva-54-lanea-shakedown-results.md), [rerun](../wiki/board/2026-10-31-geva-65-lanea-shakedown-rerun-results.md)

**gstack as a whole**

- **Nothing to cut**, archived benchmark sessions: we looked for wasted tool calls in gstack sessions and found almost none. [Waste floor](../wiki/board/2026-11-03-geva-220-waste-floor.md)
- **Couldn't show a case**, the team's own sessions: re-running gstack's pre-merge checks on code already pushed took a tiny share of check time, but the case for dropping that rerun could not be shown. [Waste baseline](../wiki/board/2026-11-03-geva-236-waste-baseline.md)

**Sending a coding agent's small decisions to cheaper models**

- **NO SAVING**, Opus 5.5 and GPT-6.1 Sol: on 279 real GitHub issues, routing a coding agent's small decisions to Jev, a small calibrated model, then to particle-1 for the ones Jev was unsure of, cost 29.7% more than the plain agent on Opus 5.5 (95% range 19.8% to 40.4% more) and 18.8% more on GPT-6.1 Sol (9.2% to 28.9% more). Task success moved +1.1 points on each model (Opus -2.2 to +4.3, Sol -1.1 to +3.3), no difference we could measure. [Results](../wiki/research/2026-11-12-geva-501-decision-routing-results/README.md)
- **PARTICLE-1 ALONE IS ENOUGH**, Opus 5.5 and GPT-6.1 Sol: sending every one of those decisions to particle-1, with no Jev step, did as well as the router. Against particle-1 alone, the router's success moved +0.4 points on Opus (-2.5 to +3.3) and -2.2 on Sol (-4.6 to +0.4), and its bill ratio was 0.966 on Opus (0.885 to 1.046) and 0.992 on Sol (0.919 to 1.066), so it was neither cheaper nor, by the rule fixed in advance, faster. [Results](../wiki/research/2026-11-12-geva-501-decision-routing-results/README.md)

## Corrections

Some posts still print the verdict they had when they merged, because a merged post never changes. These lines are the current reading.

- **Seven results posts are replaced by one claim check.** [The claim check](../wiki/board/2026-11-09-geva-431-claim-check-corrections.md) covers the routing overhaul, the skill-description test, plan-ceo-review, the planted-flaw panel and the planning room check. A separate team checked every claimed number it could with no keys, and every one matched. The verdict words changed where the posts claimed more than the data.
- **plan-ceo-review is not a candidate for removal.** Its score measured only whether a review named a plan's deciding issue, never whether the plan got better. [A new preregistered test](../wiki/plans/2026-11-08-geva-403-product-value-prereg/README.md) asks whether plans get better for real users. [Results](../wiki/board/2026-11-08-geva-402-ceo-stage-2-results/README.md), [claim check](../wiki/board/2026-11-09-geva-431-claim-check-corrections.md#plan-ceo-review-stage-2)
- **Neither are plan-eng-review and plan-devex-review.** The planted-flaw panel ran no gstack setup, so it measured no skill effect, and the skills' main aims are untested. For plan-eng-review the planning room check adds that our automatic check saw its steps in none of the scored sessions, and that run never measured the skill's effect. [A new preregistered test](../wiki/plans/2026-11-08-geva-405-eng-review-intentions-prereg/README.md) checks plan-eng-review's aims. [Panel room check](../wiki/board/2026-11-03-geva-250-panel-v3-headroom-results.md), [planning room check](../wiki/board/2026-11-06-geva-364-g-admission-results/README.md), [claim check](../wiki/board/2026-11-09-geva-431-claim-check-corrections.md#panel-v3-e0-and-the-headroom-check)
- **/investigate quick look 2's loss to the placebo did not replicate.** A separate team reran it on Haiku 5.5, a model we no longer test, and did not reproduce it. That rerun is not published yet. [/investigate quick look 2, corrected](../wiki/board/2026-10-29-gsta-30-laneb-quick-2-body-load-correction/README.md)
- **The routing overhaul and skill-description results now read "helps (opens only)".** They measure agents opening /investigate on their own, not task outcomes. The description result's gain comes from GPT-6.1 Sol, Sol's overhaul line has no verdict, and particle-1's overhaul line waits on its audit labels. [Overhaul on Opus](../wiki/board/2026-11-06-geva-350-l1-overhaul-results/README.md), [overhaul on Sol and particle-1](../wiki/board/2026-11-08-geva-353-l1-sol-particle-results/README.md), [skill descriptions](../wiki/board/2026-11-02-geva-153-run-d-discovery-results/README.md), [claim check](../wiki/board/2026-11-09-geva-431-claim-check-corrections.md)

## Words you'll meet in the posts

The posts were written by and for the AI agent teams that ran the tests, so they use shorthand. This is what it means.

- **none, or the no-gstack arm:** the setup with the same model and tasks and no gstack. An **arm** is one setup in a comparison.
- **placebo:** gstack's skill files with their instructions swapped for plain text of the same length.
- **told and untold:** told means the prompt names the skill ("/investigate ..."). Untold means gstack is installed but the prompt doesn't name a skill, so the agent has to decide to open one.
- **prereg:** a preregistration, the plan fixed in advance.
- **admission, headroom:** a check, before the main comparison, that the no-gstack setup leaves room for a gain.
- **exposure:** whether the skill's procedure actually ran in a session.
- **saturated, CEILING, STOP, DROP-CEILING:** the no-gstack setup already did nearly everything, so there was no room to show a gain.
- **95% CI:** the 95% range, where the true difference most likely falls.
- **MDD:** the smallest difference the test could reliably have seen.
- **Holm p:** a significance test adjusted because several comparisons ran at once, so one lucky result doesn't count as a finding.
- **ICC:** how alike trials on the same task are. When they are alike, a test has less real evidence than its trial count suggests.
- **hit@3:** whether the issue that decided a plan was among the review's top three points.
- **home field:** the /review test bugs came mostly from reviews by gstack-family tools, so the test may suit gstack.
- **pin:** an exact version of gstack, named by its commit.
- **KEEP:** the part helped. **CUT:** removing it lost nothing measurable. **CUT-CANDIDATE:** it showed no gain where it should have. **FIX-METHOD:** the test could not answer its question, so the test needs fixing.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
