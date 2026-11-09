# gstack-evals

**Do [gstack](https://github.com/garrytan/gstack)'s skills help, on which models, and at what cost?** We hold the model and the tasks fixed, change only the part of gstack under test, and always run an arm with no gstack beside it. The answers steer gstack's research and development, and a skill that loses to no skill, or to a placebo, is reported as plainly as one that wins.

To read the findings, start with [Reading this repo](docs/reading-this-repo.md): where the findings live, what the codes in them mean and what stays sealed. [Why this repo is open](wiki/board/2026-11-09-geva-422-why-this-repo-is-open.md) says why we publish it.

## Results that passed an independent check

Every number in this table passed two checks: a model from another lab checked the claims against the finding and its data, and another crew reran the numbers from the run's record. Each row links the record of its checks. Brackets are 95% intervals.

| Skill | Model | Result [95% interval] | Verdict | Limit | Finding |
|---|---|---|---|---|---|
| /review, full procedure (gstack 699a41cb) | Opus 5.5 | Marked 26.2% of bug-passes as blocking (42 known blocking bugs, each reviewed twice), against 3.6% with no gstack: +22.6 points [+11.0, +33.7], at 8.9 times the cost per session | KEEP | Home field: 41 of the 42 bugs came from reviews by gstack-family tools. 42 of the 66 gstack sessions ran the procedure only after a hook blocked them | [R2 at the after pin](wiki/board/2026-11-04-geva-281-r2-after-pin-results-home-field.md), [its checks](wiki/board/2026-11-09-geva-421-r2-independent-checks.md) |

## /review

- **The full procedure flags more of the known blocking bugs.** On 33 review units holding 42 known blocking bugs, each reviewed twice, gstack's full /review marked 22 of the 84 bug-passes as blocking and Opus 5.5 with no gstack marked 3 (+22.6 points [+11.0, +33.7]).
- **Most sessions ran it only after a hook made them.** In 42 of the 66 gstack sessions, the specialist reviewers and the adversarial reader ran only after gstack's contract hook blocked the session, and 24 ran them unprompted. The split was not randomized.
- **The suite may favour gstack.** 41 of the 42 bugs came from reviews by gstack-family tools, so the suite may hold the kind of bug gstack's reviewers look for.
- **It costs more.** A gstack session cost 8.9 times as much as one with no gstack.

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

- **KEEP for skill opens, FIX-METHOD for the told procedure**, Opus 5.5: gstack's overhaul of skill routing and contracts got Opus to open /investigate on its own more often, and the test of whether it then followed the procedure needs a fixed probe. [L1 results](wiki/board/2026-11-06-geva-350-l1-overhaul-results/README.md)
- **KEEP on particle-1, saturated on GPT-6.1 Sol**, FIX-METHOD on both for the told procedure: the same overhaul got particle-1 to open /investigate more often, while Sol already opened it often enough to leave no room. [L1 on Sol and particle-1](wiki/board/2026-11-08-geva-353-l1-sol-particle-results/README.md)
- **KEEP for skill opens**, GPT-6.1 Sol, Opus 5.5 and particle-1: saying in /investigate's description when to use it got Sol to open it more often, while Opus and particle-1 never opened it unprompted. [Run D](wiki/board/2026-11-02-geva-153-run-d-discovery-results/README.md)

**Preamble ceremony**

- **CUT on particle-1, FIX-METHOD on Opus 5.5**: cutting gstack's preamble ceremony lost nothing measurable on particle-1, but Opus's terminal-task score fell measurably with the cut, and a failed coverage check left Opus without a verdict. [Ceremony cut results](wiki/board/2026-11-02-geva-184-ceremony-cut-results/README.md)

**plan-ceo-review**

- **CUT-CANDIDATE, since narrowed**, Opus 5.5, GPT-6.1 Sol and particle-1: plan-ceo-review made no measurable difference to whether a review named a plan's deciding issue, on any of the three models; see Corrections. [CEO stage 2 results](wiki/board/2026-11-08-geva-402-ceo-stage-2-results/README.md)
- **FIX-METHOD, saturated**, Opus 5.5: plain Opus found every seeded issue in the panel's admission pilot, so the panel had no room to show a gain. [CEO panel v2 admission](wiki/board/2026-11-02-geva-142-ceo-panel-v2-admission-results/README.md)
- **FIX-METHOD, saturated**, Opus 5.5 and particle-1: in a pilot, plain Opus found every seeded flaw, and the review procedure never ran. [Planning pilot stop](wiki/board/2026-11-01-geva-102-planning-r1a-pilot-stop/README.md)

**plan-eng-review, other plan reviews and autoplan**

- **FIX-METHOD, saturated**, Opus 5.5: Opus with no gstack solved every admission task, and told sessions never ran the skills; see Corrections for plan-eng-review. [G admission results](wiki/board/2026-11-06-geva-364-g-admission-results/README.md)
- **CEILING**, Opus 5.5: Opus with no gstack already found nearly every seeded flaw in engineering and developer-experience plans, and the CEO and design strata had too few items to read. [Panel v3 headroom](wiki/board/2026-11-03-geva-250-panel-v3-headroom-results.md)
- **DROP-CEILING**, Opus 5.5: Opus with no gstack matched nearly every candidate reading on every item kind, so no kind had room. [Panel v3 E0](wiki/board/2026-11-03-geva-232-panel-v3-e0-results.md)
- **Exposure passed**, Opus 5.5: with gstack's report-order gate, told autoplan ran its review steps in most sessions; this checks that the steps ran, not whether they help. [Autoplan report-order recheck](wiki/board/2026-11-08-geva-396-autoplan-report-order-recheck-results/README.md)
- **FIX-METHOD**, Opus 5.5: with the stop gate, told autoplan ran its review steps in too few sessions to pass the exposure check. [Autoplan exposure with the stop gate](wiki/board/2026-11-07-geva-391-e2-autoplan-exposure-results/README.md)
- **FIX-METHOD**, Opus 5.5: with the opt-in stop gate, the exposure check failed at its early stop, and the detector saw fewer review loads than ran. [Autoplan opt-in gate](wiki/board/2026-11-07-geva-384-r61-autoplan-gate-results/README.md)

**office-hours and /learn**

- **No measurable difference**, Opus 5.5: a shorter office-hours skill did as well as the longer one in a low-powered look, and /learn was at the ceiling. [Quick look 3](wiki/board/2026-10-28-gsta-13-quick-look-3-results/README.md)
- **Shakedown**, Opus 5.5, GPT-6.1 Sol and particle-1: two shakedowns of the before-and-after skill eval test the rig, not a skill, though Sol failed a /learn safety task. [Lane A shakedown](wiki/board/2026-10-30-geva-54-lanea-shakedown-results.md), [rerun](wiki/board/2026-10-31-geva-65-lanea-shakedown-rerun-results.md)

**gstack as a whole**

- **FIX-METHOD**, archived benchmark sessions: gstack sessions wasted almost no tool calls, so there was nothing to cut. [Waste floor](wiki/board/2026-11-03-geva-220-waste-floor.md)
- **Untested**, crew sessions: re-running /ship's checks at an already pushed head took a tiny share of check time, but the case for cutting it could not be shown. [Waste baseline](wiki/board/2026-11-03-geva-236-waste-baseline.md)

**Routing small decisions to cheaper models**

- **Descriptive**, Jev, particle-1 and each repo's current model: a cascade from TypeSafe's Jev to particle-1 cut the cost of small decisions in gstack and gbrain, but particle-1 alone matched or beat it on most points, and the cascade lost on gstack's long rubric judges. [Jev decision routing](wiki/research/2026-11-09-geva-421-jev-decision-routing/README.md)

## Corrections

A merged post never changes, so these posts still print the verdicts they had when they merged. These lines are the current reading.

- **plan-ceo-review's CUT-CANDIDATE is narrowed.** The stage 2 score measured only whether a review named a plan's deciding issue, never whether the plan got better, so the verdict covers that alone, and [a new preregistered test](wiki/plans/2026-11-08-geva-403-product-value-prereg/README.md) asks whether plans get better for real users. [CEO stage 2 results](wiki/board/2026-11-08-geva-402-ceo-stage-2-results/README.md)
- **plan-eng-review's CUT-CANDIDATE is narrowed.** It rested on seeded-flaw detection with no gstack arm and on an admission run where told sessions never ran the skill, so it now reads as no effect on finding extra bugs in a plan, with the skill's main aims untested, and [a new preregistered eval](wiki/plans/2026-11-08-geva-405-eng-review-intentions-prereg/README.md) tests those aims. [Panel v3 headroom](wiki/board/2026-11-03-geva-250-panel-v3-headroom-results.md), [G admission results](wiki/board/2026-11-06-geva-364-g-admission-results/README.md)
- **Quick look 2's placebo loss did not replicate.** Another crew reran its loss to the placebo arm on Haiku 5.5, a model we no longer test, and did not reproduce it; that rerun is not published yet. [Lane B quick look 2, corrected](wiki/board/2026-10-29-gsta-30-laneb-quick-2-body-load-correction/README.md)
- **The L1 and Run D KEEPs measure skill opens, not outcomes.** They show agents opening /investigate on their own more often, not solving more tasks. [L1 results](wiki/board/2026-11-06-geva-350-l1-overhaul-results/README.md), [L1 on Sol and particle-1](wiki/board/2026-11-08-geva-353-l1-sol-particle-results/README.md), [Run D](wiki/board/2026-11-02-geva-153-run-d-discovery-results/README.md)

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

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.
