# gstack-evals

**Do [gstack](https://github.com/garrytan/gstack)'s skills help, on which models, and at what cost?** We hold the model and the tasks fixed, change only the part of gstack under test, and always run an arm with no gstack beside it. The answers steer gstack's research and development, and a skill that loses to no skill, or to a placebo, is reported as plainly as one that wins.

To read the findings, start with [Reading this repo](docs/reading-this-repo.md): where the findings live, what the codes in them mean and what stays sealed. [Why this repo is open](wiki/board/2026-11-09-geva-422-why-this-repo-is-open.md) says why we publish it.

## Results that passed an independent check

Every number in this table passed two checks: a model from another lab checked the claims against the finding and its data, and another crew reran the numbers from the run's record. Each row links the record of its checks. Brackets are 95% intervals.

| Skill | Model | Result [95% interval] | Verdict | Limit | Finding |
|---|---|---|---|---|---|
| /review, full procedure (gstack 699a41cb) | Opus 5.5 | Marked 26.2% of bug-passes as blocking (42 known blocking bugs, each reviewed twice), against 3.6% with no gstack: +22.6 points [+11.0, +33.7], at 8.9 times the cost per session | KEEP | Home field: 41 of the 42 bugs came from reviews by gstack-family tools. 42 of the 66 gstack sessions ran the procedure only after a hook blocked them | [R2 at the after pin](wiki/board/2026-11-04-geva-281-r2-after-pin-results-home-field.md), [its checks](wiki/board/2026-11-09-geva-421-r2-independent-checks.md) |
| Routing small decisions to Jev, escalating to particle-1 (research, not a gstack skill) | jev-1.13.0 and particle-1, against each repo's current model | The cascade cost 0.2% to 6.8% of today's model on all 8 decision points. particle-1 alone matched or beat it on 7 and measurably beat today's model on 4 | Descriptive | Not preregistered, 39 to 296 held items a point. The cascade lost on gstack's rubric judges, -9.9 points [-18.5, -1.2], and escalated 64% on gbrain's dream triage | [Jev decision routing](wiki/research/2026-11-09-geva-421-jev-decision-routing/README.md), [its checks](wiki/research/2026-11-09-geva-421-jev-decision-routing/README.md#the-claim-check) |
| gstack overhaul, v1.93.22.0 to v1.94.39.0 (route hook, contract hooks and rewritten skill descriptions as one package), /investigate when the user doesn't name it | Opus 5.5 | +21.3 points of sessions that open /investigate (17 of 80 vs 0 of 80) [+12.5, +30.0] | helps (skill opens only) | Measures whether the skill gets opened, not task outcomes. The route hook names the skill; every open was on its 19 routed tasks, and none with routing and contracts off, so the run credits the package, not the hook alone. Untold pass rate -2.5 [-7.5, +2.5], unpowered. The told record has no verdict, because its probe failed its audit. 80 public SWE-rebench tasks | [L1 results](wiki/board/2026-11-06-geva-350-l1-overhaul-results/README.md), [its checks](wiki/board/2026-11-09-geva-431-claim-check-corrections.md#l1-gstacks-overhaul-before-and-after-opus-55-gpt-61-sol-particle-1) |
| The same overhaul | GPT-6.1 Sol | +8.8 points (59 of 80 vs 52 of 80) [-3.8, +22.5] | not admitted (no verdict) | The pilot didn't admit it; frozen label FIX-METHOD (saturation), but the ceiling didn't bind: with routing and contracts off Sol opened /investigate in 88.8% of sessions (71 of 80), and the MDD at the 65.0% control is 18.6 points, under the 20-point margin. Told pass rate +0.0 [-5.0, +5.0], unpowered, no verdict. The told record has no verdict, because its probe failed its audit | [L1 on Sol and particle-1](wiki/board/2026-11-08-geva-353-l1-sol-particle-results/README.md), [its checks](wiki/board/2026-11-09-geva-431-claim-check-corrections.md#l1-gstacks-overhaul-before-and-after-opus-55-gpt-61-sol-particle-1) |
| Skill descriptions: /investigate rewritten to say when to use it (untold skill opens) | Opus 5.5, GPT-6.1 Sol and particle-1, pooled, in Claude Code | +5.9 points pooled [+1.4, +10.8], p 0.039 | helps (skill opens only, carried by Sol) | All of it comes from GPT-6.1 Sol: 9.5% (gstack and placebo pooled) to 27.0%, exploratory, Holm p 0.118. Opus 5.5 and particle-1 opened nothing in 363 eligible trials with gstack installed. No pass-rate or procedure effect was tested. One description changed, one trial per task per cell, 37 Terminal-Bench 2 tasks | [Run D](wiki/board/2026-11-02-geva-153-run-d-discovery-results/README.md), [its checks](wiki/board/2026-11-09-geva-431-claim-check-corrections.md#run-d-pooled-skill-descriptions) |
| plan-ceo-review (standalone and hook-enforced), scored on naming the issue that decided a real plan (hit@3) | Opus 5.5, GPT-6.1 Sol and particle-1 | Opus enforced +0.0 points [-6.0, +6.0], standalone +0.0 [-7.3, +7.2]; Sol standalone +0.0 [-6.0, +6.0], enforced +3.6 [-1.2, +8.3]; particle-1 standalone -9.5 [-17.9, -1.2], enforced -1.2 [-10.7, +8.3] | no measurable difference under the preregistered Holm test (particle-1 standalone: unadjusted 95% interval [-17.9, -1.2], below zero; sign-flip p 0.057, Holm p 0.114) | Plain-model hit@3 34.1% (Opus), 15.5% (Sol), 22.6% (particle-1). MDD 9 points (Opus) and 13 (Sol, particle-1), from the design grid at a 0.50 control rate and Opus's ICC; power at Sol's and particle-1's own control rates wasn't computed. 84 real plans. particle-1 standalone's result is neither evidence of no effect nor a confirmed loss. hit@3 never scored plan improvement, so the verdict is FIX-METHOD (task fit), not a cut | [CEO stage 2 results](wiki/board/2026-11-08-geva-402-ceo-stage-2-results/README.md), [its checks](wiki/board/2026-11-09-geva-431-claim-check-corrections.md#plan-ceo-review-stage-2) |
| plan-eng-review and autoplan (told), admission | Opus 5.5 | No skill effect read. With no gstack, Opus 5.5 solved 22 of 22 valid trials (100%) [84.6%, 100%], on 11 of 12 tasks, above the prereg's 20% to 80% band | untested | Admission stopped for saturation. The interval treats trials as independent (about 83% at an assumed within-task ICC of 0.10). The exposure detector marked the procedure in 0 of 18 (plan-eng-review) and 0 of 23 (autoplan) scored told sessions, a descriptive reading. plan-eng-review: FIX-METHOD on task fit and exposure; its CUT-CANDIDATE was narrowed on 2026-11-08, and this run measured no null. autoplan: FIX-METHOD (saturation and exposure). 12 held-out tasks x 2 trials; hidden tests decide solved | [G admission results](wiki/board/2026-11-06-geva-364-g-admission-results/README.md), [its checks](wiki/board/2026-11-09-geva-431-claim-check-corrections.md#g-admission-plan-eng-review-and-autoplan) |

## /review

- **The full procedure flags more of the known blocking bugs.** On 33 review units holding 42 known blocking bugs, each reviewed twice, gstack's full /review marked 22 of the 84 bug-passes as blocking and Opus 5.5 with no gstack marked 3 (+22.6 points [+11.0, +33.7]).
- **Most sessions ran it only after a hook made them.** In 42 of the 66 gstack sessions, the specialist reviewers and the adversarial reader ran only after gstack's contract hook blocked the session, and 24 ran them unprompted. The split was not randomized.
- **The suite may favour gstack.** 41 of the 42 bugs came from reviews by gstack-family tools, so the suite may hold the kind of bug gstack's reviewers look for.
- **It costs more.** A gstack session cost 8.9 times as much as one with no gstack.

## Routing small decisions to cheaper models

- **The cost cut is real.** A cascade that keeps Jev's answer when Jev is confident and sends the rest to particle-1 cost 0.2% to 6.8% of today's model on all 8 decision points we replayed from gstack, gbrain and a private game, and Jev answered in 70 to 88 ms at the median.
- **The escalation model alone did as well or better.** particle-1 on its own matched or beat the cascade on 7 of 8 points and measurably beat today's model on 4, so run it alone before you credit a router with its gains.
- **It breaks where the confidence is wrong or the decision isn't small.** The cascade lost on gstack's long rubric judges, -9.9 points [-18.5, -1.2], and on gbrain's dream triage Jev's confidence ran backwards, so the cascade escalated 64% of transcripts.

## Skill routing and descriptions

- **The overhaul gets /investigate opened, which is not the same as better outcomes.** Taken as one route-and-contract package, gstack's overhaul got untold Opus 5.5 sessions to open /investigate in 17 of 80 against 0 of 80 (+21.3 points [+12.5, +30.0]). The before-and-after pass-rate comparisons are unpowered and showed no change we could measure. On GPT-6.1 Sol the untold line wasn't admitted, and particle-1's row waits on its audit labels.
- **Saying when to use a skill helped one model open it.** Rewriting /investigate's description to say when to use it raised untold opens by +5.9 points pooled [+1.4, +10.8], all of it from GPT-6.1 Sol. Opus 5.5 and particle-1 opened nothing in 363 eligible trials with gstack installed, and no pass-rate effect was tested.

## Plan reviews

- **Plain Opus already solves the admission tasks.** With no gstack, Opus 5.5 solved 22 valid trials on 11 of 12 G admission tasks. So build harder tasks, or tasks that test what the planning skills are meant to do, before reading any lift for plan-eng-review or autoplan. The seeded-flaw panel's eng and dx readings wait in the pending list below: their rerun matched, and their cross-lab read is not yet in a public post.
- **plan-ceo-review showed no measurable gain on what we scored.** Under the preregistered Holm test it showed no measurable difference on Opus 5.5 (+0.0 points [-6.0, +6.0]), GPT-6.1 Sol or particle-1. On particle-1 the standalone skill scored lower: its unadjusted interval, -17.9 to -1.2 points, sits below zero, but it misses the preregistered Holm rule (sign-flip p 0.057, Holm p 0.114). The verdict is FIX-METHOD on task fit, because hit@3 never scored whether a review makes a plan better.

## Measured, independent check pending

These results have no numbers here yet, because every number in the table above passed a check by another lab's model and a rerun by another crew, and these have not had both. Each post has its numbers and intervals. Losses, nulls and saturated tests sit beside wins, because a test with no room to show a gain is a result too.

The verdict words: KEEP means the part helped. CUT means removing it lost nothing measurable, and CUT-CANDIDATE means it showed no gain where it should have. FIX-METHOD means the test could not answer the question, so the test needs fixing. CEILING, STOP and DROP-CEILING mean the model with no gstack already did nearly everything, so there was no room to show a gain.

**/review**

- **FIX-METHOD**, Opus 5.5: in stacks round 1, Opus skipped /review's specialist reviewers and adversarial reader in every session, so no gain showed and the procedure went untested. [Round 1 review results](wiki/board/2026-11-01-geva-89-stacks-round-1-review-results/README.md), [round 1 summary](wiki/board/2026-11-01-geva-105-gstack-null-review-and-tb2/README.md)
- **FIX-METHOD**, Opus 5.5: the first run of the full procedure failed its procedure gate, partly because our driver ended sessions before their reviewers returned, so it read no outcome. [R2 full-review results](wiki/board/2026-11-02-geva-175-r2-full-review-results/README.md)
- **FIX-METHOD**, Opus 5.5: the rerun failed its smoke gate, so no grid ran. [R2 rerun results](wiki/board/2026-11-03-geva-229-r2-rerun-results.md)
- **Go: R2 runs**, Opus 5.5: judged blind, an earlier full procedure in another harness found far more blocking bugs than plain Opus, which is why the test in the table above was run. [R1 blind re-judge](wiki/board/2026-11-01-geva-113-r1-blind-rejudge-results/README.md)
- **No measurable difference**, Opus 5.5: quick look 1 replayed gstack's reviewer prompts on known gstack bugs, and the gain's interval touched zero. [Quick look 1, corrected](wiki/board/2026-10-29-gsta-20-review-replay-y09-correction/README.md)

**/investigate on coding and terminal tasks**

- **FIX-METHOD**, Opus 5.5: on tasks picked so Opus solves some and fails some, told /investigate made no measurable difference, and the test was too small to see a modest gain. [R3c results](wiki/board/2026-11-07-geva-380-r3c-results.md)
- **FIX-METHOD**, Opus 5.5 and GPT-6.1 Sol: no measurable difference, on tasks so hard that neither model solved many of them without gstack. [R3b results](wiki/board/2026-11-04-geva-283-r3b-results.md)
- **STOP**, Opus 5.5 and GPT-6.1 Sol: the screen stopped because both models solved nearly every task without gstack. [R3a screen](wiki/board/2026-11-03-geva-239-r3a-saturation-results.md)
- **Admission passed**, Opus 5.5 and GPT-6.1 Sol: a new task set left enough tasks unsolved to test /investigate; this checks room only and reads no effect. [R3a4 admission](wiki/board/2026-11-04-geva-263-r3a4-admission-results.md)
- **FIX-METHOD**, Opus 5.5 and particle-1: in stacks round 1 on terminal tasks, Opus never wrote /investigate's debug report, so no gain showed and the procedure went untested, and pstack, run beside it, won no cell. [Round 1 terminal-task results](wiki/board/2026-11-01-geva-93-stacks-round-1-tb2-results/README.md)
- **Untested**, Opus 5.5: with gstack installed but not named in the prompt, agents never opened a skill. [Lane B quick look 1](wiki/board/2026-10-29-gsta-12-laneb-quick-results/README.md)
- **Loss, exploratory**, Opus 5.5: told to use /investigate, Opus did measurably worse than with no skill in this exploratory look; its placebo result is under Corrections. [Lane B quick look 2, corrected](wiki/board/2026-10-29-gsta-30-laneb-quick-2-body-load-correction/README.md)
- **No measurable difference**, particle-1: told /investigate made no measurable difference for particle-1, which trailed the placebo arm without a measurable gap. [Lane B quick look 3](wiki/board/2026-10-30-gsta-30-laneb-quick-3-results/README.md)
- **KEEP**, particle-1: loading skill-length placebo text into the prompt cost no measurable pass rate on terminal tasks. [Run T](wiki/board/2026-11-02-geva-128-run-t-text-tax-results/README.md)

**Skill routing and descriptions**

- **helps (skill opens only); waiting on the audit labels**, particle-1: gstack's overhaul of skill routing and contracts got particle-1 to open /investigate on its own more often, only where the route hook named it, and no routing-off arm ran on particle-1. The verdict rests on a blind audit whose label files are lost; without it the frozen script reads the line as FIX-METHOD (method), so the row waits until the audit can be recounted. The told record has no verdict. [L1 on Sol and particle-1](wiki/board/2026-11-08-geva-353-l1-sol-particle-results/README.md), [claim check](wiki/board/2026-11-09-geva-431-claim-check-corrections.md#l1-gstacks-overhaul-before-and-after-opus-55-gpt-61-sol-particle-1)

**Preamble ceremony**

- **CUT on particle-1, FIX-METHOD on Opus 5.5**: cutting gstack's preamble ceremony lost nothing measurable on particle-1, but Opus's terminal-task score fell measurably with the cut, and a failed coverage check left Opus without a verdict. [Ceremony cut results](wiki/board/2026-11-02-geva-184-ceremony-cut-results/README.md)

**plan-ceo-review**

- **FIX-METHOD, saturated**, Opus 5.5: plain Opus found every seeded issue in the panel's admission pilot, so the panel had no room to show a gain. [CEO panel v2 admission](wiki/board/2026-11-02-geva-142-ceo-panel-v2-admission-results/README.md)
- **FIX-METHOD, saturated**, Opus 5.5 and particle-1: in a pilot, plain Opus found every seeded flaw, and the review procedure never ran. [Planning pilot stop](wiki/board/2026-11-01-geva-102-planning-r1a-pilot-stop/README.md)

**plan-eng-review, other plan reviews and autoplan**

- **saturated (under the frozen seeded-flaw rules); rerun matched; cross-lab read not yet in a public post**, Opus 5.5, no-gstack arm only: in seeded-flaw panel v3, plain Opus found nearly every planted-flaw reading in the eng and dx strata and nearly every candidate reading across E0's strata; the ceo and design strata were not read. No gstack arm ran, so no skill effect was measured, and the test covers seeded-flaw recall only. The CUT-CANDIDATEs for plan-eng-review and plan-devex-review were narrowed to FIX-METHOD on task fit, and the skills' main intentions are untested. [Panel v3 headroom](wiki/board/2026-11-03-geva-250-panel-v3-headroom-results.md), [Panel v3 E0](wiki/board/2026-11-03-geva-232-panel-v3-e0-results.md), [claim check](wiki/board/2026-11-09-geva-431-claim-check-corrections.md#panel-v3-e0-and-the-headroom-check)
- **Exposure passed**, Opus 5.5: with gstack's report-order gate, told autoplan ran its review steps in most sessions; this checks that the steps ran, not whether they help. [Autoplan report-order recheck](wiki/board/2026-11-08-geva-396-autoplan-report-order-recheck-results/README.md)
- **FIX-METHOD**, Opus 5.5: with the stop gate, told autoplan ran its review steps in too few sessions to pass the exposure check. [Autoplan exposure with the stop gate](wiki/board/2026-11-07-geva-391-e2-autoplan-exposure-results/README.md)
- **FIX-METHOD**, Opus 5.5: with the opt-in stop gate, the exposure check failed at its early stop, and the detector saw fewer review loads than ran. [Autoplan opt-in gate](wiki/board/2026-11-07-geva-384-r61-autoplan-gate-results/README.md)

**office-hours and /learn**

- **No measurable difference**, Opus 5.5: a shorter office-hours skill did as well as the longer one in a low-powered look, and /learn was at the ceiling. [Quick look 3](wiki/board/2026-10-28-gsta-13-quick-look-3-results/README.md)
- **Shakedown**, Opus 5.5, GPT-6.1 Sol and particle-1: two shakedowns of the before-and-after skill eval test the rig, not a skill, though Sol failed a /learn safety task. [Lane A shakedown](wiki/board/2026-10-30-geva-54-lanea-shakedown-results.md), [rerun](wiki/board/2026-10-31-geva-65-lanea-shakedown-rerun-results.md)

**gstack as a whole**

- **FIX-METHOD**, archived benchmark sessions: gstack sessions wasted almost no tool calls, so there was nothing to cut. [Waste floor](wiki/board/2026-11-03-geva-220-waste-floor.md)
- **Untested**, crew sessions: re-running /ship's checks at an already pushed head took a tiny share of check time, but the case for cutting it could not be shown. [Waste baseline](wiki/board/2026-11-03-geva-236-waste-baseline.md)

## Corrections

A merged post never changes, so these posts still print the verdicts they had when they merged. The one exception is an owner-directed edit recorded by a waiver row in `wiki/edits/<name>.tsv` (see [wiki/README.md](wiki/README.md), rule 2). These lines are the current reading.

- **Seven results posts are replaced by one claim check.** [The claim check](wiki/board/2026-11-09-geva-431-claim-check-corrections.md) covers L1, Run D, plan-ceo-review stage 2, panel v3 and G admission. Another crew checked every claimed number it could with no keys, and every one matched; the verdict words changed where the posts claimed more than the data. Its rows are the current reading, and the rows in this README use its verdict words.
- **plan-ceo-review's CUT-CANDIDATE is narrowed to FIX-METHOD (task fit).** The stage 2 score measured only whether a review named a plan's deciding issue, never whether the plan got better, so the verdict covers that alone, and [a new preregistered test](wiki/plans/2026-11-08-geva-403-product-value-prereg/README.md) asks whether plans get better for real users. [CEO stage 2 results](wiki/board/2026-11-08-geva-402-ceo-stage-2-results/README.md), [claim check](wiki/board/2026-11-09-geva-431-claim-check-corrections.md#plan-ceo-review-stage-2)
- **plan-eng-review's and plan-devex-review's CUT-CANDIDATEs are narrowed to FIX-METHOD on task fit.** The seeded-flaw panel ran no gstack arm, so it measured no skill effect, and the skills' main intentions are untested. For plan-eng-review the admission run adds exposure: the exposure detector marked the procedure in none of the scored told sessions, and the run measured no null. [A new preregistered eval](wiki/plans/2026-11-08-geva-405-eng-review-intentions-prereg/README.md) tests plan-eng-review's aims. [Panel v3 headroom](wiki/board/2026-11-03-geva-250-panel-v3-headroom-results.md), [G admission results](wiki/board/2026-11-06-geva-364-g-admission-results/README.md), [claim check](wiki/board/2026-11-09-geva-431-claim-check-corrections.md#panel-v3-e0-and-the-headroom-check)
- **Quick look 2's placebo loss did not replicate.** Another crew reran its loss to the placebo arm on Haiku 5.5, a model we no longer test, and did not reproduce it; that rerun is not published yet. [Lane B quick look 2, corrected](wiki/board/2026-10-29-gsta-30-laneb-quick-2-body-load-correction/README.md)
- **The L1 and Run D KEEPs now read helps (skill opens only).** They measure agents opening /investigate on their own, not task outcomes. Run D's gain is carried by GPT-6.1 Sol, Sol's L1 line was not admitted, and particle-1's L1 row waits on its audit labels. [L1 results](wiki/board/2026-11-06-geva-350-l1-overhaul-results/README.md), [L1 on Sol and particle-1](wiki/board/2026-11-08-geva-353-l1-sol-particle-results/README.md), [Run D](wiki/board/2026-11-02-geva-153-run-d-discovery-results/README.md), [claim check](wiki/board/2026-11-09-geva-431-claim-check-corrections.md)

## How a result is made

1. A preregistration states the question, the arms, the tasks, the models, the scoring rules, the spend cap and the stop rule. It merges in its own pull request, before any result.
2. Since 2026-10-31, every head-to-head includes a no-gstack arm: the same model, tasks and harness with no gstack installed and a plain prompt. Many also include a placebo arm.
3. The run spends only through a budget ledger. A run that hits its cap stops and is reported as incomplete; it is never rerun to change a verdict.
4. A results post reports each skill's lift per model with its interval. A null result states the control arm's rate and the smallest effect the test could have seen, and says why it came out null.
5. A result enters the table at the top only after a model from another lab has checked its claims against the finding and its data, and another crew has rerun its numbers from the run's record.

Held-out task bodies, hidden tests and answer keys never enter this repo. They are sealed outside it, and the repo commits only their counts and digests, so a reader can check later that nothing changed.

## Reading this repo

[docs/reading-this-repo.md](docs/reading-this-repo.md) explains how the repo is laid out, how to list every finding, what the codes in posts mean, what stays sealed and how to run the keyless checks. Read [CONTRIBUTING.md](CONTRIBUTING.md) before you open an issue or a pull request, and report security problems privately, as [SECURITY.md](SECURITY.md) describes. The licence is MIT, see [LICENSE](LICENSE); vendored code keeps its own notices, listed in [NOTICE.md](NOTICE.md).

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.
