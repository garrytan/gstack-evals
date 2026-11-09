# All results

This page lists every gstack-evals result, including the ones still waiting for their independent checks. It also says how a result is made and what the words in the posts mean. The [README](../README.md) shows the checked results as a scorecard.

## How a result is made

1. A preregistration, a plan fixed in advance, states the question, the setups, the tasks, the models, the scoring rules, the spend cap and the stop rule. It merges in its own pull request, before any result.
2. Since 2026-10-31, every comparison includes a setup with no gstack: the same model, tasks and agent program, with no gstack installed and a plain prompt. Many also include a placebo: gstack's skill files with their instructions swapped for plain text of the same length.
3. The run spends only through a budget record. A run that hits its cap stops and is reported as incomplete. It is never rerun to change a verdict.
4. A results post reports each skill's effect per model, with its 95% range. A result that shows no difference gives the no-gstack rate and the smallest difference the test could have seen, and says why it came out empty: did the agent use the skill, did the tasks fit, was the test big enough, and does the plain model already do the job?
5. A result enters the README's scorecard only after a model from another lab has checked its claims against the post and its data, and a separate team has rerun its numbers from the run's record.

Held-out task bodies, hidden tests and answer keys never enter this repo. They are sealed outside it, and the repo keeps only their counts and digests, so a reader can check later that nothing changed.

## How to read a verdict

- **Helps:** the gstack setup did measurably better, and the 95% range sits above zero.
- **Helps (opens only):** the agent opened the skill more often. That says nothing about whether it solved more tasks.
- **No difference we could measure:** the 95% range includes zero. The test may have been too small to see a modest gain, so this is not proof that the skill does nothing.
- **Worse:** the gstack setup did measurably worse. "Lower, not confirmed" means it scored lower but missed the bar fixed in advance.
- **Couldn't test yet:** the test couldn't answer its question. Usually the plain model already solved nearly everything, the skill never ran, or the run broke. The test needs fixing or harder tasks before it can say anything.
- **No verdict:** the run's own entry check didn't admit the comparison.

## Results waiting for their independent check

These results have no numbers here, because they haven't yet had both checks the scorecard needs. Each post has its numbers and ranges. Losses, empty results and tests with no room sit beside wins, because a test with no room to show a gain is a result too.

**/review**

- **Couldn't test**, Opus 5.5: in the first round of stack comparisons, Opus skipped /review's specialist reviewers and adversarial reader in every session, so the procedure never ran and no gain showed. [Round 1 review results](../wiki/board/2026-11-01-geva-89-stacks-round-1-review-results/README.md), [round 1 summary](../wiki/board/2026-11-01-geva-105-gstack-null-review-and-tb2/README.md)
- **Couldn't test**, Opus 5.5: the first run of the full procedure failed its check that the procedure ran, partly because our test driver ended sessions before their reviewers returned, so it read no outcome. [First full-review run](../wiki/board/2026-11-02-geva-175-r2-full-review-results/README.md)
- **Couldn't test**, Opus 5.5: the rerun failed its small trial run, so the main run never started. [Rerun](../wiki/board/2026-11-03-geva-229-r2-rerun-results.md)
- **Promising, so we ran the scorecard test**, Opus 5.5: judged blind, an earlier version of the full procedure in another agent program found far more blocking bugs than plain Opus. [Blind re-judge](../wiki/board/2026-11-01-geva-113-r1-blind-rejudge-results/README.md)
- **No difference we could measure**, Opus 5.5: an early look replayed gstack's reviewer prompts on known gstack bugs, and the gain's 95% range included zero. [Review replay quick look, corrected](../wiki/board/2026-10-29-gsta-20-review-replay-y09-correction/README.md)

**/investigate on coding and terminal tasks**

- **Couldn't tell**, Opus 5.5: on tasks picked so Opus solves some and fails some, asking for /investigate made no difference we could measure, and the test was too small to see a modest gain. [Results](../wiki/board/2026-11-07-geva-380-r3c-results.md)
- **Couldn't tell**, Opus 5.5 and GPT-6.1 Sol: no difference we could measure, on tasks so hard that neither model solved many of them without gstack. [Results](../wiki/board/2026-11-04-geva-283-r3b-results.md)
- **Couldn't test**, Opus 5.5 and GPT-6.1 Sol: the screen stopped because both models solved nearly every task without gstack. [Screen](../wiki/board/2026-11-03-geva-239-r3a-saturation-results.md)
- **Room check passed**, Opus 5.5 and GPT-6.1 Sol: a new task set left enough tasks unsolved to test /investigate. This checks room only and reads no effect. [Room check](../wiki/board/2026-11-04-geva-263-r3a4-admission-results.md)
- **Couldn't test**, Opus 5.5 and particle-1: in the first round of stack comparisons on terminal tasks, Opus never wrote /investigate's debug report, so the procedure never ran and no gain showed. pstack, run beside it, won no comparison. [Round 1 terminal-task results](../wiki/board/2026-11-01-geva-93-stacks-round-1-tb2-results/README.md)
- **Couldn't test**, Opus 5.5: with gstack installed but not named in the prompt, agents never opened a skill. [/investigate quick look 1](../wiki/board/2026-10-29-gsta-12-laneb-quick-results/README.md)
- **Worse, exploratory**, Opus 5.5: asked to use /investigate, Opus did measurably worse than with no skill in this exploratory look. Its loss to the placebo did not replicate, as the corrections below say. [/investigate quick look 2, corrected](../wiki/board/2026-10-29-gsta-30-laneb-quick-2-body-load-correction/README.md)
- **No difference we could measure**, particle-1: asked to use /investigate, particle-1 did no better, and it trailed the placebo without a gap we could measure. [/investigate quick look 3](../wiki/board/2026-10-30-gsta-30-laneb-quick-3-results/README.md)
- **No cost we could measure**, particle-1: loading placebo text as long as a skill into the prompt cost no pass rate we could measure on terminal tasks. [Placebo text cost](../wiki/board/2026-11-02-geva-128-run-t-text-tax-results/README.md)

**Getting agents to open skills**

- **Helps (opens only), waiting on a recount**, particle-1: gstack's routing overhaul got particle-1 to open /investigate on its own more often, only where the new hook named the skill, and no setup with the hooks switched off ran on particle-1. The result rests on a blind audit whose label files are lost. Without that audit, the run's fixed analysis script reads the line as couldn't test, so the result waits until the audit can be recounted. [Overhaul on Sol and particle-1](../wiki/board/2026-11-08-geva-353-l1-sol-particle-results/README.md), [claim check](../wiki/board/2026-11-09-geva-431-claim-check-corrections.md#l1-gstacks-overhaul-before-and-after-opus-55-gpt-61-sol-particle-1)

**The standard steps at the top of every gstack skill**

- **Cutting them lost nothing on particle-1; no verdict on Opus 5.5**: removing the standard steps that open every gstack skill lost nothing measurable on particle-1. On Opus the terminal-task score fell measurably with the cut, but a failed coverage check left Opus without a verdict. [Results](../wiki/board/2026-11-02-geva-184-ceremony-cut-results/README.md)

**plan-ceo-review**

- **Couldn't test, no room**, Opus 5.5: plain Opus found every planted issue in the review panel's room check, so the panel had no room to show a gain. [Panel room check](../wiki/board/2026-11-02-geva-142-ceo-panel-v2-admission-results/README.md)
- **Couldn't test, no room**, Opus 5.5 and particle-1: in a pilot, plain Opus found every planted flaw, and the review procedure never ran. [Planning pilot stop](../wiki/board/2026-11-01-geva-102-planning-r1a-pilot-stop/README.md)

**plan-eng-review, other plan reviews and autoplan**

- **Couldn't test, no room; rerun matched; another lab's read not yet in a public post**, Opus 5.5, no-gstack setup only: in a panel of plans with planted flaws, plain Opus found nearly every planted flaw in the engineering and developer-experience parts, and nearly every candidate flaw in the panel's first round. The CEO and design parts were not read. No gstack setup ran, so no skill effect was measured, and the test covered only whether planted flaws get found. The skills' main aims are untested. [Panel room check](../wiki/board/2026-11-03-geva-250-panel-v3-headroom-results.md), [panel first round](../wiki/board/2026-11-03-geva-232-panel-v3-e0-results.md), [claim check](../wiki/board/2026-11-09-geva-431-claim-check-corrections.md#panel-v3-e0-and-the-headroom-check)
- **Steps ran**, Opus 5.5: with gstack's report-order gate on, autoplan, when asked for, ran its review steps in most sessions. This checks that the steps ran, not whether they help. [Report-order recheck](../wiki/board/2026-11-08-geva-396-autoplan-report-order-recheck-results/README.md)
- **Couldn't test**, Opus 5.5: with gstack's stop gate on, autoplan ran its review steps in too few sessions to pass the check that they ran. [Stop gate](../wiki/board/2026-11-07-geva-391-e2-autoplan-exposure-results/README.md)
- **Couldn't test**, Opus 5.5: with the opt-in stop gate, the check that the steps ran failed at its early stop, and our detector saw fewer review steps than actually ran. [Opt-in gate](../wiki/board/2026-11-07-geva-384-r61-autoplan-gate-results/README.md)

**office-hours and /learn**

- **No difference we could measure**, Opus 5.5: a shorter office-hours skill did as well as the longer one in a small test, and /learn left no room. [Office-hours and /learn quick look](../wiki/board/2026-10-28-gsta-13-quick-look-3-results/README.md)
- **Rig test only**, Opus 5.5, GPT-6.1 Sol and particle-1: two trial runs of the before-and-after skill eval tested our tooling, not a skill, though Sol failed a /learn safety task. [First trial run](../wiki/board/2026-10-30-geva-54-lanea-shakedown-results.md), [rerun](../wiki/board/2026-10-31-geva-65-lanea-shakedown-rerun-results.md)

**gstack as a whole**

- **Nothing to cut**, archived benchmark sessions: gstack sessions wasted almost no tool calls. [Waste floor](../wiki/board/2026-11-03-geva-220-waste-floor.md)
- **Couldn't show a case**, the team's own sessions: re-running gstack's ship checks on code already pushed took a tiny share of check time, but the case for cutting it could not be shown. [Waste baseline](../wiki/board/2026-11-03-geva-236-waste-baseline.md)

## Corrections

A merged post never changes, so some posts still print the verdict they had when they merged. The one exception is an owner-directed wording edit, recorded by a row in `wiki/edits/<name>.tsv` (see [wiki/README.md](../wiki/README.md), rule 2). These lines are the current reading.

- **Seven results posts are replaced by one claim check.** [The claim check](../wiki/board/2026-11-09-geva-431-claim-check-corrections.md) covers the routing overhaul, the skill-description test, plan-ceo-review, the planted-flaw panel and the planning room check. A separate team checked every claimed number it could with no keys, and every one matched. The verdict words changed where the posts claimed more than the data.
- **plan-ceo-review is not a cut.** Its score measured only whether a review named a plan's deciding issue, never whether the plan got better. [A new preregistered test](../wiki/plans/2026-11-08-geva-403-product-value-prereg/README.md) asks whether plans get better for real users. [Results](../wiki/board/2026-11-08-geva-402-ceo-stage-2-results/README.md), [claim check](../wiki/board/2026-11-09-geva-431-claim-check-corrections.md#plan-ceo-review-stage-2)
- **plan-eng-review and plan-devex-review are not cuts either.** The planted-flaw panel ran no gstack setup, so it measured no skill effect, and the skills' main aims are untested. For plan-eng-review the planning room check adds that our detector saw its steps in none of the scored sessions, and that run measured no empty result. [A new preregistered test](../wiki/plans/2026-11-08-geva-405-eng-review-intentions-prereg/README.md) checks plan-eng-review's aims. [Panel room check](../wiki/board/2026-11-03-geva-250-panel-v3-headroom-results.md), [planning room check](../wiki/board/2026-11-06-geva-364-g-admission-results/README.md), [claim check](../wiki/board/2026-11-09-geva-431-claim-check-corrections.md#panel-v3-e0-and-the-headroom-check)
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
- **95% CI:** the 95% range.
- **MDD:** the smallest difference the test could reliably have seen.
- **Holm p:** a significance test corrected for running several comparisons at once.
- **ICC:** how alike trials on the same task are. When they are alike, a test has less real evidence than its trial count suggests.
- **hit@3:** whether the issue that decided a plan was among the review's top three points.
- **home field:** the /review test bugs came mostly from reviews by gstack-family tools, so the test may suit gstack.
- **pin:** an exact version of gstack, named by its commit.
- **KEEP:** the part helped. **CUT:** removing it lost nothing measurable. **CUT-CANDIDATE:** it showed no gain where it should have. **FIX-METHOD:** the test could not answer its question, so the test needs fixing.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
