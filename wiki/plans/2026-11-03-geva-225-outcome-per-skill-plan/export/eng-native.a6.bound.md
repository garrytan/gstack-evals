INPUT: eng 9ff6fb7a6baa6820279f73c74f80c30c892348350cbf98578f0a20111e71b283

# Eng review, gate_rev 2 (confirm round 2), native voice

The arithmetic in sections 7 and 8 holds. Every MDD in section 7's table is mdd-grid.json times 1.2, every per-skill line in section 8 sums to its planned total, and the program comes to $33,853. The trouble is in what the price model leaves out and in one coupling it hides. Three findings are High. First, the per-skill plans only hold if both skills in a family pass admission: a lone survivor costs $1,986 to $2,376 at its planned size. Second, the told prices come from sessions where the skill's steps mostly didn't run, and the forced arm, which decision 3 expects to be the confirmatory arm, has no price at all. Third, the authoring price counts the paid author and audit calls but not the crew thread that ran them, which cost about five times as much in the thin slice. Any one of these moves a skill's planned spend from about $1,650 to between $1,700 and $2,380, and its MDD up by 1 to 4 points. The 15% reserve absorbs one of them, not two.

This review covers only the delta since 42e28cee6c4f and its consequences. Items in the DECIDED AT THE GATE list stay settled; every finding below cites a v2 hunk or a file:line that the settled records do not contain. I don't re-raise the CEO phase's 15 findings; where a finding here touches one, it says so.

## Step 0: Scope challenge

### A. Assess

What changed: a $2,000 all-in ceiling per skill replaces the 10-point MDD target; arms shrink to none and told everywhere, with a stand-in on plan-eng-review only and particle-1 where a 2-point rule allows; the pilot becomes a per-skill admission on the 12-task slice; a futility look at half the panel is new; prices are rebuilt from metered anchors; shared family costs split evenly between two skills; Sol, plan-first, follow-up runs and U judges leave wave 1.

Mapped to code and records on this machine:

- The lane's scorer (lanes/real-outcome/score/analysis.ts) already pairs by task, clusters by repository or task, runs a two-look O'Brien-Fleming design and emits an equivalence verdict. Its rule is that repository clustering decides (analysis.ts:183).
- src/runner/stats holds the vendored gates (gates.ts), sign-flip, paired deltas and sizing. Superiority there is one-sided with a preregistered min_effect, and fewer than 10 clusters is inconclusive (gates.ts:22-27, gates.ts:177).
- src/runner/ledger binds one line item to one run; a new lease waits until the last one settles (ledger.ts:2-4).
- The sizing scripts (cost.py, wave23.py, mddgrid.py, power.py) live in the Captain drive and read paths under ~/.capy/work/geva225/v2/, which is empty on this machine. I ran them with the grid path patched in memory; nothing was written.
- The metered anchors trace to GEVA-230.md, GEVA-231.md, GEVA-173.md, the E0 results post on main and R3 amendment 4 on main.

Complexity check: the plan adds no module beyond v1's list, but it adds two couplings that v1 didn't have: per-skill caps over family-shared spend, and a futility stop inside a shared none arm. Both cross the ledger boundary. That is where most of the findings sit.

Premise table (claims the delta rests on):

| premise | claim | file:line receipt | verdict |
|---|---|---|---|
| R3a none price | $0.191 a Verified none session, 91 sessions | ~/.capy/drive/captain-gstack-evals/reports/GEVA-230.md:30 ($17.376246 / 91) | true |
| R3a told price | $0.424 a told /investigate session, 10 sessions | GEVA-230.md:30 ($4.242669 / 10) | true, but exposure was 2 of 10 (GEVA-230.md:7) |
| Sol ratios | 1.33 times none, 1.63 times told | GEVA-231.md:28 ($23.090780 / 91, $6.910322 / 10) | true |
| E0 prices | Opus $0.236, particle-1 $0.019, median 4 turns | E0 results post on main, lines 45, 82-83 | true; a plain none session on a one-turn plan prompt; particle-1 took 11 turns |
| told multiple basis | "from R3a's 2.2 and E0's review session" | E0 results line 45 (none arm only) | false for E0: it has no told session, so only the 2.2 is metered |
| TS authoring | $9.71, $1.39 a valid task, $0.57 a sealed task | GEVA-173.md:16 | true as paid spend; the thread's own ~43,500 credits are outside it |
| VM rate | $0.60 an hour | R3 amendment 4 README on main, line 158 | true |
| crew rate | $0.52 per million tokens | arithmetic: 25,846 credits / 50.2M = $0.515 | arithmetic true; the counter reading itself unverified |
| lane's test rule | task-clustered primary, repository sensitivity, "the lane's rule" | lanes/real-outcome/score/analysis.ts:183 | false: the lane's repository clustering decides |
| design effect | 1.2, from d18's 12 to 13 points against 10.5 | ~/.capy/work/geva225/autoplan/eng-native-prompt.md:588 | consistent (1.14 to 1.24); d18's simulation itself unverified |
| MDD table | 1.2 times the grid | mdd-grid.json, every row | true |
| stand-in fits only on plan-eng-review | 2-point rule | cost.py:89, enumeration below | true |
| particle-1 fits in G and X only | 2-point rule | cost.py:89, enumeration below | true |
| Sol can't fit | a Sol row costs more than Opus's | arithmetic: a Sol pair on 108 x 4 is about $1,074 against Opus's $923 confirmatory | true |
| price risk | 2 times buys 17 to 19 points | wave1-high.json: 16.8 to 19.2 | true |
| cheap agent user | 114 and 102 x 4, MDD 12 to 13 | wave1-cheapuser.json (the user is $0.15, an eighth of $1.20) | true |
| program | $9,978 + $9,545 + $14,330 = about $33,900 | sums re-derived | true ($33,853) |
| task needs | U about 190, X about 240 valid tasks | 72 / 0.4 + 12 = 192; 90 / 0.4 + 12 = 237 | true |
| admission cost | about $34 to $84 a skill | per-skill lines | true as paid calls; all-in is $173 to $280 (F13) |

REALITY: premise-table finding unverified=2 false=2; the E0 told basis and the "lane's rule" are false, the crew counter and d18's simulation unverified, receipt lanes/real-outcome/score/analysis.ts:183
REALITY: already-done pass git ls-remote origin main is a0cb401; origin/main since 2026-11-02 holds #181, #183, #190 and #191 and no lanes/outcome-skills code, so nothing in this plan is built yet, receipt a0cb401
REALITY: surface-check pass every named surface exists: ledger CLI src/runner/ledger/cli.ts:67, ledger raise src/runner/ledger/ledger.ts:59, the lane scorer lanes/real-outcome/score/analysis.ts:102, the stats gates src/runner/stats/gates.ts:177; lanes/outcome-skills/ is new; the mutation-tool flags rest on section 10's probes, unchanged in this delta
REALITY: binding-decisions pass read the DECIDED AT THE GATE list (r1 d1a to d23b, p1c); v2 keeps d18a's direction while adding the 1.2 factor and drops the no-effect reading per d23b; no overruled default comes back; gstack-decision-search was not run because the brief allows only the trailer command, receipt ~/.capy/work/geva225/autoplan/eng-native-prompt.md:570
REALITY: numbers finding every section 7 and 8 number re-derived; anchors are [measured] but the told multiples, stand-in, measurement-agent, VM and crew prices are [estimated], the told anchor is a low-exposure session and the forced arm has no price, receipt ~/.capy/drive/captain-gstack-evals/handoffs/GEVA-225/v2-sources/cost.py:16
REALITY: deferred-asks pass section 15 lists what GST-1144's ask loses in wave 1 (Sol, plan-first, follow-up runs, U judges) with reasons, receipt ~/.capy/work/geva225/autoplan/autoplan-eng-hAbM7X/eng-implementation.md:432
REALITY: pr-count finding .gstack/ship-policy.json sets no pr_count, so the default is one PR per wave; wave 1 plans about 12 to 15 PRs (O1, O2, O3a, O3b, O4, O5, three admission preregs, three confirmatory preregs, results posts) and never states the queue cost per extra PR, receipt .gstack/ship-policy.json:2
REALITY: contract-assumptions finding the plan assumes the lane decides on the task-clustered test and that the ledger can split a shared batch between two caps; analysis.ts decides by repository and the ledger binds one item to one run, receipt src/runner/ledger/ledger.ts:2
REALITY: dependency-fallback finding without GST-1088's after pin the forced arm runs, and section 8 prices no forced arm; told exposure on the before pin was 2 of 10 in R3a, receipt ~/.capy/drive/captain-gstack-evals/reports/GEVA-230.md:7

### B. Selectors

Scope is the round-2 delta: sections 2 to 4 (arms and contrasts), 6 (staging, admission, futility), 7 (power), 8 (prices and program), 13 and 14 (build and risks), and the ELI5 and decisions that summarize them. Design and DX are deferred phases, so their measurement text is out of scope here. The perf scope does not apply as a code change, but throughput and wall time get a short section because the new sizes drive them.

### C. Findings in brief

High: F1 survivor cost, F2 told and forced prices, F3 authoring crew cost. Medium: F4 no MDD stop at admission, F5 decision test inverted, F6 stats contract, F7 particle-1 floor order, F8 plan-first confound on plan-devex-review, F9 null arithmetic, F10 price risk leaves out measurement, F11 futility mechanics, F12 ledger can't split, F13 admission stop cost, F14 custody at bulk scale, F15 wave 2 and 3 instruments. Low: F16 to F20.

## Sections 7 and 8, number by number

I re-derived every number from cost.py's formulas (cost.py:10-60) and mdd-grid.json.

**Section 7's table.** All eight rows equal the grid value times 1.2 (for example 108 x 4 at alpha 0.025: 11.0 x 1.2 = 13.2; 90 x 4 at 0.05: 11.0 x 1.2 = 13.2; 48 x 3: 17.0 and 19.0 give 20.4 and 22.8). The 1.2 factor sits inside d18's range (12 to 13 against 10.5 is 1.14 to 1.24). As a design effect on the MDD, 1.2 means a variance inflation of 1.44, which at 8 tasks a repository is an intraclass correlation of about 0.06 in the per-task difference. Nothing measures that number before the confirmatory run; 12 slice tasks can't. The grid steps by 0.5 points (0.6 after the factor) and reports the first step at 80% power or more, so each value is conservative by up to 0.6. The neighbors check out against 1/sqrt(n) scaling (from 120 x 4 at 10.5, 108 x 4 should be about 11.1; the grid says 11.0).

**Prices.** $0.4775 for a real none session is 0.191 x 2.5; the 2.5 is an estimate (CEO-4 covers the house's 5 times reading). The told multiples are estimates except plan-eng-review's 2.2, which is R3a's told /investigate ratio (0.424 / 0.191 = 2.22). That session had the procedure visible in 2 of 10 trials (GEVA-230.md:7), so 2.2 is the price of loading a skill and mostly skipping it. E0 can't support a told multiple: it ran the none arm only, on a one-turn plan prompt. particle-1's 0.0805 is 0.019 / 0.236 from that same review-only session, in which particle-1 took 11 turns to Opus's 4. The stand-in's 1.25 is never metered: admission runs none and told only. The authoring price is TS's paid author and audit calls plus VM; TS's thread spent about 43,500 credits besides (GEVA-173.md:16). VM at $0.02 a session compares with R3a's measured $0.0086 for a none session and $0.021 for a told one on Verified (GEVA-230.md:30), before real-task lengths and the 2.2 to 5.0 multiples.

**Per-skill lines.** Each matches cost.py. For plan-eng-review: crew 320 / 2 = 160; authoring (108 / 0.3 + 12) x 1.39 / 2 = 259; screening 360 x 2.27 x 0.4975 / 2 = 203; admission 7 + 27 = 34; none share (39 + 30) x 4 x 0.5475 = 151; told 432 x 1.1205 = 484; stand-in 432 x 0.6669 = 288; particle-1 6 + 97 = 103. The other five match the same way. The plan prints sums of rounded parts, so plan-devex-review reads $1,665 where the script's total is $1,664 and autoplan $1,648 against $1,647; that is rounding. Reserves are 15.8% to 17.9% of the ceiling.

**Selection rule.** cost.py:89 keeps the configuration with the most added rows whose MDDs stay within 2 points of the told-only design. I enumerated all 16 configurations per family. In G the stand-in alone costs plan-eng-review 1.2 points (12.0 to 13.2, from Holm); particle-1 on both costs autoplan another 1.2 (13.2 to 14.4). In X the plan-devex-review stand-in alone costs 3.0 points (12.0 to 15.0) and fails; particle-1 on both costs 1.2 and 0.6. In U every addition fails. So decision 2's "plan-eng-review only" and decision 6's "particle-1 holds in G and X" are what the rule produces.

**Price risk and the cheap agent user.** wave1-high.json gives 16.8 to 19.2, which the plan rounds to 17 to 19. One correction for the gate: cost.py's MULT scales the none price, and told is none times its multiple, so the 2 times case does stress told sessions. What it holds fixed is the multiples, the measurement agents, authoring, VM and crew (F10). wave1-cheapuser.json uses a $0.15 agent user (an eighth, not a tenth) and gives 114 and 102 x 4 at 12.0 and 12.6.

**Program.** Wave 2 sums to $9,545 and wave 3 to $14,330; with wave 1's $9,978 the total is $33,853. 24 running skills plus codex, benchmark and ship make 27; 27 + 32 + 5 = 64.

## 1. Architecture

**The family is the budget unit, but the plan caps the skill (F1, F12).** Section 8 splits every shared cost evenly (~/.capy/work/geva225/autoplan/autoplan-eng-hAbM7X/eng-implementation.md:268), and section 6 says a stopped skill "stops only the spend the stopped skill would have made, and shared costs already spent stay split" (~/.capy/work/geva225/autoplan/autoplan-eng-hAbM7X/eng-implementation.md:224). That sentence is silent on shared costs not yet spent: bulk authoring, screening, the shared none arm and the prereg thread. Those fall on the survivor. I priced the survivor at its planned size with cost.py's formulas, splitting only what is spent before admission (the rig and build halves, the slice, the admission none arm, calibration):

| survivor | planned size | cost alone | over the $1,700 plan | re-sized under $1,700 | MDD |
|---|---|---|---|---|---|
| autoplan | 78 x 4 | $1,986 | +$286 | 72 x 3 | 16.8 (15.6 without particle-1, 78 x 3) |
| plan-eng-review | 108 x 4, stand-in | $2,272 | +$572 | 90 x 3 | 16.2 |
| devex-review | 90 x 4 | $2,376 | +$676 | 60 x 4 | 16.8 (15.0 without particle-1, 72 x 4) |
| plan-devex-review | 90 x 4 | $2,357 | +$657 | about the same as devex-review | about 15 to 17 |
| design-review | 66 x 4 | $2,237 | +$537 | 54 x 3 | 19.2 |
| plan-design-review | 72 x 4 | $2,319 | +$619 | 48 x 4 | 18.6 |

Five of six survivors pass the $2,000 ceiling at their planned size. This branch is likely, not an edge case: the plan's own evidence says told exposure fails on the before pin, and every proxy panel so far hit a ceiling. The same coupling appears at the futility look, where one skill stopping leaves the rest of the shared none arm on the other.

The ledger can't express the split either. It binds a line item to one run, and a new lease waits until the last one settles (src/runner/ledger/ledger.ts:2-4). Half a screening batch can't be charged to two caps, and nothing says which skill stops when shared spend reaches one skill's cap. The cleanest shape is one shared item per family plus one item per skill (see "Two shapes" below).

**The decision test is inverted against the lane and the sizing (F5).** Section 4's new text makes the task-clustered sign-flip the primary and calls the repository reading a sensitivity, "the lane's rule" (~/.capy/work/geva225/autoplan/autoplan-eng-hAbM7X/eng-implementation.md:128). The lane's code says the reverse: "Task-clustered sensitivity (plan open item 13: repository clustering decides)" (lanes/real-outcome/score/analysis.ts:183). Section 10 already makes the repository reading decide for U and X, and section 7's 1.2 factor sizes a repository-clustered test. When tasks cluster by repository, a task-level test doesn't lose power. It loses alpha. At the variance inflation of 1.44 that the factor assumes, a test at a nominal 0.05 rejects a true null about 10% of the time (2 x (1 - Phi(1.96 / 1.2))). A false "hurts" is a CUT-CANDIDATE path, so this matters. gates.ts makes any comparison with fewer than 10 clusters inconclusive (src/runner/stats/gates.ts:177), so the per-repository cap also sets a floor on repositories.

**The stated test matches neither existing scorer (F6).** Section 2 says the scorer extension reuses lanes/real-outcome/score and src/runner/stats. gates.ts decides superiority with a Holm-adjusted one-sided sign-flip p plus a preregistered min_effect (gates.ts:22-27; src/runner/prereg/format.ts:79). The lane's look() runs an efficacy interim at z 2.797, a final boundary at 1.977 and emits same_within_margin (lanes/real-outcome/score/power.ts:11-12, analysis.ts:170-174). The plan wants two-sided alpha 0.05, no efficacy stop, no equivalence verdict, and a futility look neither scorer has. O4 will have to pick, and the MDD table assumes none of these boundaries.

**particle-1 is bought before its floor is read (F7).** Opus's panels shrink to pay for particle-1 rows: G goes from 114 and 90 tasks to 108 and 78, X from 114 and 108 to 90 and 90. But the floor rule reads particle-1's none rate "on the Opus-screened panel" (~/.capy/work/geva225/autoplan/autoplan-eng-hAbM7X/eng-implementation.md:122), which exists only after the panel is sized. A particle-1 below 20% then leaves its money unspent while Opus keeps the smaller panel. Tasks screened into Opus's 20 to 80% band are where a weaker model is most likely to sit near the floor.

## 2. Code quality

The sizing code is short and readable, and its formulas match the plan text. Three issues:

- It doesn't run as attached. cost.py:4 and wave23.py read ~/.capy/work/geva225/v2/mdd-grid.json, which is empty here, and mddgrid.py execs power.py from ~/.capy/work/geva225/power/. power.py needs numpy and scipy, which only a local venv has. A reader of the results post can't re-run section 7 or 8 from the attachments (F20).
- The selection rule lives only in cost.py:80-93: "most added rows within 2 points, then lowest MDD". The plan states it per row. It should be stated as the joint rule it is, because it is the rule that traded X's de-confounding stand-in for particle-1 rows (F8).
- The lane's power.ts already ports power.md with a screening prior, ceiling and floor shares and Monte Carlo error at 5,000 simulations or more; src/runner/stats/sizing.ts:50 has an analytic minimumDetectable. v2 adds a third model (power.py at 3,000 simulations plus a constant factor). The prereg's re-simulation should be one of the existing two, extended with a repository term (F18).

## 3. Test review

### Test Plan

What the build must prove before any paid step, keyless, in the O5 dry run and unit tests:

1. **Survivor branch.** A fake family where skill A fails admission (headroom, exposure, instrument) and skill B passes: the scorer re-sizes B under the survivor rule, prints B's new MDD, and the ledger charges B only its share of spent costs plus all of the unspent shared work.
2. **Futility look.** Unit tests on the conditional power function: at t = 0.5, drift 2.8 and z = -0.49, CP is 0.10; with a stand-in, under Holm (drift 3.08), the threshold moves to z = -0.29. Also: the half panel is complete task pairs in the frozen random order, and a stop of one skill leaves the sibling's none trials running.
3. **Decision test.** A fixture with 8 tasks a repository and a repository effect: the repository-clustered sign-flip decides, the task-clustered one prints as the sensitivity, and fewer than the frozen repository minimum reads inconclusive. Assert the verdict set excludes same_within_margin and any interim efficacy stop.
4. **Ledger split.** Shared item plus skill items: a shared batch reserves against the shared item; each skill's ceiling check equals its own item plus half the shared one; a skill cap stop doesn't stop shared work the sibling needs; an unsettled shared lease blocks both and the reconcile path clears it.
5. **Price inputs.** Admission's report prints metered price per arm, separately for exposed and unexposed told trials, for the agent user and docs-only agent per tree, and VM minutes per arm; the re-size consumes those, not section 8's constants.
6. **Admission stop on MDD.** A fake admission whose metered prices buy an MDD above the frozen bound stops the skill as FIX-METHOD before bulk mining.
7. **particle-1 floor.** A fake particle-1 none rate under 20% on the slice drops the row before the Opus panel is sized, and the money returns to Opus's n.
8. **Sizing reproduction.** A keyless test that reproduces section 7's table and section 8's per-skill lines from committed scripts.

What breaks at 2am Friday: a VM dies with a shared lease open. Under today's ledger the next lease on that item waits, so both skills' runs stall, not one. The run thread needs the reconcile command in its run record before the run starts.

## 4. Performance

Session counts at the planned sizes, from cost.py's formulas [estimated]:

| family | screening | confirmatory, Opus | confirmatory, particle-1 | measurement |
|---|---|---|---|---|
| G | 817 none sessions | 1,608 (none 432, plan-eng-review told 432, stand-in 432, autoplan told 312) | 1,176 | mutation on every tree with added tests |
| X | 225 none + 450 docs-only runs | 1,080 | 1,080 | 4,320 docs-only runs |
| U | 180 none + 180 agent-user trees | 840 | none | 840 agent-user trees, 2,520 scenarios |

At R3 amendment 4's six concurrent 8 GB containers a VM, 30 minutes a build session would put G's Opus confirmatory at about 134 VM-hours. That is feasible in days on four VMs, but runs must be detached and polled (the 6-hour operation limit), and screening must respect Docker Hub's 100 pulls an hour per VM (amendment 4 split 354 tasks over four VMs for this). VM time scales with session length: at R3a's measured VM minutes scaled by the told multiples, VM runs about $0.03 for none and up to $0.14 for an autoplan told session, against the plan's flat $0.02. That adds roughly $30 to $45 a G skill; small, but it belongs in the metered inputs (F10).

## NOT in scope

- The CEO phase's findings: the one-sided futility look, the 1.5 times cost guard, GST-1218 and the after pin, the 5 times house central price, autoplan's kind and voice settings, free within-family contrasts, U's 15 to 16 points, devex-review's branch design, v1 text in sections 1, 2, 5 and 9, lane amendment pricing, Opus-only cuts, one-trial screening yield, particle-1's unprinted MDD, panel reuse, and plan overhead outside the ceilings.
- Design and DX measurement text, deferred at round 2 with open findings carried to the gate.
- Every r1 decided item (d1a to d23b), including d18a's clustering direction and d23b's equivalence power, except where a v2 hunk changed the text (F5, F9).
- Building, spending, and any change to gstack or to the lane's plan.

## What already exists

- lanes/real-outcome/score/analysis.ts: paired task means, repository or task clustering, cluster bootstrap, two-look boundaries, ceiling rule, equivalence verdict (analysis.ts:102, :163-176, :183).
- lanes/real-outcome/score/power.ts: power.md's simulator with a screening prior, O'Brien-Fleming boundaries and at least 5,000 simulations a point (power.ts:8-21).
- src/runner/stats: gates.ts (exact, non-inferiority, superiority, exploratory; Holm; min_clusters 10), sign-flip.ts, paired.ts (clusteredPairedDelta, powerNote, superiorityP), sizing.ts (minimumDetectable).
- src/runner/ledger: approval rows with init and raise, one lease per item at a time, local SQLite holding a lease's calls (ledger.ts:2-4, :59, :113; local.ts:1).
- src/runner/prereg/format.ts: task_clustered_bootstrap intervals and min_effect for superiority (format.ts:79, :103).
- lanes/real-outcome/arms, agent, mine, sandbox, task: the rig the plan extends.
- quick/laneb R3 code (on main at 616de34): projection checks between parts, ledger raise, oracle preflight, VM sharding under the Docker Hub limit; a ready pattern for F11's interim and F12's projection check.

## Two shapes before one (the budget boundary)

**Shape A, the plan's:** six skill caps of $2,000; shared work split evenly by convention; each skill's lines planned as if its sibling always runs.

**Shape B:** per family, one ledger item for shared work (crew, slice, bulk authoring, screening, calibration, the none arm on shared tasks) and one item per skill for its own arms. Each skill's ceiling check is its own item plus half the shared item, run as a projection before each part, the way R3 amendment 4's between-part check works. A survivor rule and a futility rule are reallocations of the shared item, with the survivor's MDD printed.

Red flags in A: the survivor overrun (F1), no ledger representation for a split (F12), and a futility stop that silently moves cost to the sibling (F11). B costs one more ledger item per family and a projection check the lane already has. Recommend B.

## Diagrams

Money flow per family:

~~~text
rig third + family build ($250-$300) --> slice (12 tasks) --> ADMISSION per skill ($34-$84 paid)
                                                             |            |              |
                                                         both pass    one passes      none pass
                                                             |            |              |
                                                             v            v              v
                                              bulk mine, author, screen   survivor pays  stop; sunk
                                              (sized to the larger n)     all unspent    $350-$560
                                                             |            shared cost    a family
                                                             v            (+$286 to +$676, F1)
                                              confirmatory, shared none arm
                                                             |
                                                       half panel: futility per skill
                                                             |
                                               one stops --> sibling pays the rest of the none arm (F11)
~~~

Where the price model's inputs come from:

~~~text
Verified none $0.191 [measured] x 2.5 [estimated] = none $0.4775
   told = none x multiple [estimated; only 2.2 metered, at exposure 2 of 10]
   forced = (no price)                      <-- decision 3's expected arm (F2)
   stand-in = none x 1.25 [estimated; never metered] (F19)
   particle-1 = Opus x 0.08 [measured, review-only session] (F7)
measurement per tree: mutation $0.05, agent user $1.20, docs-only $0.40 [estimated] (F10)
authoring per valid task: TS paid spend only; the crew thread's ~$6 a task is missing (F3)
crew: rig, build, prereg/run/results; no line for mining or two preregs a family (F3)
~~~

## Failure modes

| trigger | effect | plan covers it? | finding |
|---|---|---|---|
| one skill in a family fails admission | survivor costs $1,986 to $2,376 at plan size | no | F1 |
| after pin not named by admission | forced arm runs, with no price | no | F2 |
| after pin named between admission and prereg | told runs on a pin with no admission read | no | F2 |
| exposed told sessions cost more than skipped ones | told lines run over | no | F2 |
| bulk mining orchestration | crew use with no line | no | F3 |
| metered prices buy a 19-point MDD | full ceiling spent on a reading the plan calls undecidable | no | F4 |
| 8 tasks a repository, task-level test decides | false positive rate near 10% | partly (section 10 for U and X) | F5 |
| fewer than 10 repositories | gates.ts reads inconclusive | no | F5 |
| O4 reuses the lane's look() | interim efficacy stop and equivalence verdicts appear | no | F6 |
| particle-1 none under 20% | Opus already lost 0.6 to 1.2 points | no | F7 |
| agent user costs twice $1.20 | U designs at $2,297 to $2,370 | no | F10 |
| interim on a non-random half | biased conditional power | no | F11 |
| shared spend reaches one skill's cap | ledger has no rule | no | F12 |
| VM dies with a shared lease open | both skills stall | no | F12 |
| about 800 valid tasks sealed as TS did | about 40 GB of 100 MB parts; /dev/shm pressure on VMs | no | F14 |
| Docker Hub limit during bulk screening | pulls refused, screening stalls | the lane's rule | performance note |

## Worktree parallelization strategy

- Parallel from the start: O1 (lanes/outcome-skills/arms/), O2 (the mutation scorer), and the three thin slices (sealed, in their own threads, outside the repo).
- O4 (scorer extension) waits for O1's arm ids and must serialize against any open PR touching src/runner/stats or lanes/real-outcome/score, because both are shared with the lane.
- O3a (docs-only) and O3b (agent user) run in parallel after O4 fixes the scorer interface.
- O5 (dry run) last, per family.
- Shared registries: src/cli.ts rows, src/errors/codes.ts and src/types.ts. Each unit edits only its own lines and runs bun run errors:doc; land registry-touching PRs one at a time to avoid generated-file churn.
- Preregs and results posts never share a PR (CREW rule), so each family carries at least two prereg PRs and one results PR.

## Unresolved decisions

1. The survivor rule: re-size the survivor (and to what order: particle-1 first, then trials, then tasks) or stop it when its MDD passes a bound. (F1, F4)
2. The MDD bound per family above which a skill stops at admission. (F4)
3. Whether X's budget buys particle-1 rows or a de-confounding arm for plan-devex-review. A Captain call, since it decides what GST-1218 can settle. (F8)
4. Which clustering decides in G, and the per-repository cap. (F5)
5. The crew line for mining and authoring, and whether TS's rate or a slice-measured rate prices it. (F3)

## Completion summary

- Step 0: scope accepted as the round-2 delta; reality rows 10 (pass 4, finding 6), unverified=2.
- Architecture: 6 issues (F1, F5, F6, F7, F11, F12).
- Code quality: 3 issues (F18, F20, and the joint selection rule under F8).
- Tests: Test Plan with 8 keyless proofs and one 2am path.
- Performance: session counts and VM-time note; folded into F10.
- Sections 7 and 8: every number re-derived; no arithmetic error beyond rounding; assumption gaps in F2, F3, F10 and F19.
- NOT in scope: written. What already exists: written. Two shapes: written, recommend shape B. Diagrams: 2. Failure modes: 16 rows.
- Findings: Critical 0, High 3, Medium 12, Low 5, Informational 0.
- Outside voice: none in this round (one voice).

## Review log

| date | phase | voice | round | input | Critical | High | Medium | Low | Info |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-03 | eng | native (anthropic/claude-opus-5-5) | confirm 2 | 9ff6fb7a | 0 | 3 | 12 | 5 | 0 |

## Next steps

The Eng phase closes into the gate_rev 2 gate. The three High findings change section 8's numbers, so the plan's author should re-run cost.py with the survivor branch, a forced price row and a crew line for authoring before the gate is relayed, and print the resulting MDDs beside the central ones. No further review phase is needed; the plan then merges as a wiki post with a light docs /ship.

## Learnings

- A told price measured on sessions that skipped the procedure understates every arm that passes the exposure bar. Price an arm on exposed sessions, or on the forced arm that will actually run.
- When two skills share a panel, the skill is not a separable budget unit. Price the one-survivor branch whenever a per-skill cap sits over shared spend.
- A paid-spend authoring price leaves out the thread that runs the authoring; in TS that thread cost about five times the paid calls.
- Check a "the lane's rule" claim against the lane's code: here the code said the opposite.

```gstack-findings
{"id":"F1","severity":"High","title":"Per-skill plans assume both skills in a family pass admission; a lone survivor costs $1,986 to $2,376 at its planned size","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":224,"fix":"Price the one-survivor branch per family in section 8. At planned sizes the survivor pays every unspent shared cost (bulk authoring, screening, the whole none arm, the prereg thread) and costs autoplan $1,986, plan-eng-review $2,272, plan-devex-review $2,357, devex-review $2,376, plan-design-review $2,319 and design-review $2,237. Freeze a re-size rule (drop the particle-1 row first, then trials, then tasks) and print the MDD it buys (about 15 to 17 in G and X, 18.6 to 19.2 in U), or stop the survivor when that MDD passes the bound in F4. Apply the same rule when one skill stops at the futility look."}
{"id":"F2","severity":"High","title":"Told prices come from sessions where the procedure mostly did not run, and the forced arm that decision 3 expects to run has no price","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":263,"fix":"Add forced and told-exposed price rows to section 8. The only metered told session (R3a told /investigate, $0.424) had exposure 2 of 10, E0's $0.236 is a plain none session, and v2 deleted v1's forced row (told plus 15%, with panel v3's forced lines at 1.7 times told on plan units). Price the confirmatory on the arm that will run: forced at told x1.15 central and x1.5 as the risk case (planned designs $1,704 to $1,777 and $1,836 to $2,081, autoplan over its ceiling; re-sized G MDDs 14.4/15.0 and 16.2/15.6). Have admission meter exposed and unexposed told sessions separately, and freeze the pin at admission: a pin named after admission needs a new admission paid from the reserve."}
{"id":"F3","severity":"High","title":"Authoring is priced at TS's paid author and audit spend; the crew thread that mined, built, checked and sealed the tasks cost about five times that and has no line","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":266,"fix":"Add a crew line per valid task for mining, building, checking and sealing, measured on each family's thin-slice thread and re-sized at admission. TS spent $7.93 of author and auditor calls plus $1.78 of VM for 7 valid tasks while its thread used about 43,500 credits before its /ship tail (GEVA-173.md:16), about $6.20 a valid task. Wave 1 needs about 800 valid tasks (G 372, U 192, X 237). At a fifth of TS's rate the planned designs cost $1,761 to $1,912 and re-size to MDDs of G 14.4/15.0, U 15.6 and X 14.4; at TS's full rate G alone needs about $2,300, more than both G reserves. Also price two preregs per family (admission and confirmatory) inside the $70 line, not one."}
{"id":"F4","severity":"Medium","title":"Admission has no MDD bound, so a skill whose metered prices buy a 19 to 20 point reading still spends its ceiling","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":222,"fix":"Restore a power stop in admission criterion 5. Freeze per family the largest MDD worth buying (section 8 already treats 13 to 14 as able to settle keep-or-cut and about 20 as unable); a metered re-size above it stops the skill as FIX-METHOD (price) with its size and MDD printed, before bulk mining spends. Apply the same bound to the survivor re-size in F1."}
{"id":"F5","severity":"Medium","title":"Section 4 makes the task-clustered test primary and calls the repository reading the lane's sensitivity; the lane decides by repository, and the 1.2 factor sizes the repository test","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":128,"fix":"Make the repository-clustered sign-flip the decision test in every family, as lanes/real-outcome/score/analysis.ts:183 does and section 10 already says for U and X, with the task-clustered reading as the sensitivity. Under repository clustering a task-level test keeps its power and loses its alpha (about 0.10 at the 1.44 variance inflation v2 assumes), so the 1.2 factor corrects the wrong test. Cap tasks per repository so each family has at least 20 repositories (src/runner/stats/gates.ts:177 makes fewer than 10 inconclusive), and add a repository random effect to the prereg's re-simulation, printing the MDD at ICC 0, 0.05 and 0.10, since 12 slice tasks can't estimate it."}
{"id":"F6","severity":"Medium","title":"The stated test matches neither existing scorer: gates.ts decides superiority one-sided with a min_effect, and the lane's look() has an efficacy interim, a 1.977 final boundary and an equivalence verdict","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":128,"fix":"Name in section 4 the exact rule O4 runs: a two-sided sign-flip at 0.05 (0.025 under Holm) with min_effect 0, or gates.ts superiority one-sided at 0.025 per direction. Say that O4 does not reuse the lane's two-look O'Brien-Fleming look() (lanes/real-outcome/score/power.ts:11-12, analysis.ts:170-174) for the futility look and never emits same_within_margin, and re-simulate the MDD table at the boundary O4 actually uses."}
{"id":"F7","severity":"Medium","title":"Opus panels shrink to pay for particle-1 rows before particle-1's floor is read, so a floor drop leaves Opus underpowered for nothing","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":122,"fix":"Read particle-1's floor on the admission slice (its admission is already paid) or on a first screened batch, and size the Opus panel after that read; if the floor fails, the particle-1 money returns to Opus's tasks before bulk screening closes. Today the rows cost autoplan 1.2 points (13.2 to 14.4) and X 1.2 and 0.6 (12.0/12.6 to 13.2/13.2), and the 0.08 price ratio comes from a review-only session where particle-1 took 11 turns to Opus's 4; at 0.3 the plan's G configuration moves plan-eng-review from 12.0 to 14.4, past the 2-point rule."}
{"id":"F8","severity":"Medium","title":"For plan-devex-review a told win cannot KEEP the skill text: told minus none carries the planning turn, and the de-confounding arm lost the budget to particle-1 rows","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":293,"fix":"Say in section 8 that for plan-devex-review (and autoplan and plan-design-review) a helps reading means plan first and review helps, and goes to R48's idea-only path, not KEEP; GST-1218 can settle a cut on a null or a loss but not a keep on a win. State cost.py's joint selection rule (most added rows within 2 points). If the Captain wants the keep call settled, swap X's particle-1 rows for a bare plan-first arm on plan-devex-review (two turns, about 1.1 times none); the three-turn stand-in alone costs X 3.0 points (12.0 to 15.0) and fails the 2-point rule."}
{"id":"F9","severity":"Medium","title":"A null rules out a gain of that size is wrong: a non-significant estimate's 95% interval reaches about 1.4 times the MDD","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":245,"fix":"With the MDD at 2.8 standard errors, an estimate up to 1.96 SE (0.7 MDD) is not significant and its upper bound reaches 3.9 SE (1.4 MDD, 18 to 22 points at v2's sizes); only an estimate near zero bounds gains near 0.7 MDD. Replace section 7's rules out only gains larger than the MDD and section 8's rules out a gain of that size with: a null rules out gains above its interval's upper bound, which the results post prints per skill, and R48 and GST-1218 read that bound. Overlaps CEO-3 on the GST-1218 reading."}
{"id":"F10","severity":"Medium","title":"The price-risk paragraph stresses only the session price; the measurement agents, told multiples and VM time that dominate U and X stay fixed","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":296,"fix":"Add rows to the price-risk paragraph: at a $2.40 agent user U's planned designs cost $2,370 and $2,297 and re-size to 54 x 3 (MDD 19.2); at a $0.80 docs-only pair X's cost $2,184 and $2,204 and re-size to 78 x 3 (MDD 15.6). VM at $0.02 a session sits under R3a's measured VM minutes scaled by the same multiples (about $0.03 for none to $0.14 for autoplan told). Make the agent user's and the docs-only agent's metered price per tree, and VM minutes per arm, explicit admission inputs to the re-size."}
{"id":"F11","severity":"Medium","title":"The futility look needs a random half, a stated conditional power formula on the decision test, and a rule for the shared none arm","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":226,"fix":"Run tasks in a frozen random order with both arms of a task interleaved, so the half panel is a random half, and define the half as complete task pairs. Compute conditional power on the decision test's z with the B-value formula at the planned drift; at these settings a true effect at the MDD stops about 0.7% of the time and a true zero about 31%, which the prereg should print. Say that when one skill of a family stops, its sibling pays the shared none arm's remaining trials under F1's survivor rule."}
{"id":"F12","severity":"Medium","title":"The ledger can't charge half a shared batch to two skill caps, and no rule says which skill stops when shared spend reaches one cap","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":268,"fix":"Give each family one ledger item for shared work (crew, slice, authoring, screening, calibration, the none arm on shared tasks) and one item per skill for its own arms. Each skill's ceiling check is its own item plus half the shared item, run as a projection before each part, as R3 amendment 4's between-part check does. Say that a skill's cap stop never stops shared work its sibling needs, and that an unsettled shared lease (src/runner/ledger/ledger.ts:2-4) blocks both skills until it is settled or reconciled; put the reconcile command in the run record."}
{"id":"F13","severity":"Medium","title":"A check that costs under $100 counts only admission's paid calls; the all-in cost to reach the read is $173 to $280 a skill","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":8,"fix":"State the all-in cost to the admission read per skill and per family in the ELI5, decision 7 and stage 3: half the rig and family build ($125 to $150), half the slice authoring ($8 to $17), calibration ($10 to $29), particle-1's admission ($6 to $23) and the paid admission ($34 to $84) come to about $173 for plan-eng-review, $208 for autoplan, $224 for each X skill and $273 to $280 for each U skill, before the admission prereg's own crew use."}
{"id":"F14","severity":"Medium","title":"Custody isn't sized for bulk panels: TS's sealed bundle was 821 MB for 17 tasks and needed 9 parts","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":387,"fix":"Keep built task dirs out of sealed bundles: seal statements, hidden tests, checkers and build recipes, and rebuild images from pinned recipes inside the run, as GEVA-173.md:19 suggests. At TS's 48 MB a task, wave 1's roughly 800 valid tasks plus screened-out candidates are on the order of 40 GB of 100 MB parts in the Captain drive. State the sealed size per family, the /dev/shm budget per VM and the leftover check across VMs."}
{"id":"F15","severity":"Medium","title":"Wave 2 and 3 rows assume instruments that wave 1 defers and give them no build line","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":312,"fix":"Give every wave 2 or 3 row that needs a new instrument a build line at wave 1's rate ($150 to $200 plus a scorer-class /ship): deslop-shared-libs needs the follow-up runner, V10 and blame-linked follow-ups on 108 G tasks (yield unmeasured); learn needs three sequential tasks per repository; context-save and context-restore need a cut-and-resume harness; qa-only needs a report-to-fix runner; spec and office-hours need the oracle user. Mark deslop's 108 x 4 as conditional on a follow-up yield probe. Overlaps CEO-14 on panel reuse."}
{"id":"F16","severity":"Low","title":"Section 7's table puts design-consultation and design-html at 48 x 3 (20.4); section 8 sizes them at 42 x 4 (19.8)","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":234,"fix":"Move the Used by entry to a 42 x 4 row at 19.8, or change section 8 to 48 x 3."}
{"id":"F17","severity":"Low","title":"Target dates leave six days from G admission to the first confirmatory prereg for mining, authoring, sealing and screening about 360 valid G tasks","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":407,"fix":"Date the G prereg from the T-G slice's measured valid tasks per day and sessions per VM-hour; TS produced 7 valid tasks in one thread, and G's screen alone is 817 Opus sessions."}
{"id":"F18","severity":"Low","title":"MDDs resolve to 0.6 points and the sizing search picks sizes at grid-step edges","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":230,"fix":"In the prereg's re-simulation, bisect each MDD to 0.1 points with at least 5,000 simulations a point, as the lane's power.ts requires, and print the Monte Carlo error; a one-step difference such as 14.4 against 15.0 is not a real difference between skills. Reuse power.ts or src/runner/stats/sizing.ts instead of a third model."}
{"id":"F19","severity":"Low","title":"The stand-in's 1.25 price is never metered before the confirmatory run","file":"<local notes (not committed)>/autoplan-eng-hAbM7X/eng-implementation.md","line":263,"fix":"Add 24 stand-in sessions to plan-eng-review's admission (about $16), or price the stand-in at 1.6 times none until it is metered: it runs told's three turns, and E0's plain plan review alone cost $0.236. At 1.6, plan-eng-review's line rises $72 to $1,754."}
{"id":"F20","severity":"Low","title":"The attached sizing scripts don't run as attached: cost.py and wave23.py read an empty work path, and mddgrid.py execs power.py from another","file":"~/.capy/drive/captain-gstack-evals/handoffs/GEVA-225/v2-sources/cost.py","line":4,"fix":"Commit the sizing scripts with the prereg (or the plan PR) using relative paths, with a keyless test that reproduces section 7's table and section 8's per-skill lines, so the published numbers can be re-run as AGENTS.md's publish-what-ran rule expects."}
```
