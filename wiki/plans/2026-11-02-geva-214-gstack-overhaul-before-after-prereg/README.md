---
id: 2026-11-02-geva-214-gstack-overhaul-before-after-prereg
kind: plan
title: "Preregistration: gstack's overhaul measured before and after, on frozen public instruments and a sealed held-out set, with no gstack beside both"
summary: "Freezes how gstack's overhaul is judged: before pin 82db89a, the after pin and no gstack side by side on Opus 5.5, GPT-6.1 Sol and particle-1, with verdicts on a sealed off-ceiling held-out set."
author: GEVA-214
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-02
status: superseded
links:
  - 2026-11-01-geva-125-untold-discovery-prereg
  - 2026-11-01-geva-101-r48-follow-ups-prereg
  - 2026-11-01-geva-89-stacks-round-1-amendment
  - src/trial/review
  - quick/laneb
source: "Plan written by GEVA-214 through gstack /autoplan run autoplan-20261102231443 (CEO and eng, one reader each, one round); approved at gate_rev 2. Issue GST-1089 under GST-1088. The Implementation plan section is the approved text."
attachments:
  - 2b3d7cb7dfaa5554e77641394f4e79caead776030b4109f1c19a262459291ded  power.py
  - 3bcacf777107b04801319dc8cc2b67a792e1a6737c6de1393fd377c5e53a7775  power.txt
  - 420fb5ef94c1aea69d43fdde4378b782d062bd1b8328dd7152c5bbbd659af13e  price.py
  - 23a70d8e11aa4089e1a4bd260ff59e497b81266c2d3ca9fc28e3602b25ad1eca  price.txt
  - d77f2e5143e0d435ef44886ad6f0b6713362ac8736b499756bebbabb4f87858d  review-record.md
---

# Preregistration: gstack's overhaul measured before and after, on frozen public instruments and a sealed held-out set, with no gstack beside both

GEVA-214, issue GST-1089 under GST-1088, Captain GEVA-2. Plan only: no paid call, no task authored and no build happen here. Garry approved the L1 direction (overhaul gstack, measure it before and after, then write it up) on 2026-11-02. Reviewed under org R65: one strong reviewer (Opus 5.5) read the plan with power.py and price.py in two phases, CEO then eng, and one revision applied the gate-1 answer and every reviewer finding.

## Approval

- **Gate 1** (gate_rev 1, rec_hash 5be7fc7d86b8): Garry approved the plan on 2026-11-02, relayed by the Captain (GEVA-2). He took every recommendation: the fix for each of the 11 High findings (d1a to d11a) and approval with those changes (p1b). His words are kept in the Captain drive's approvals/.
- **Gate 2** (gate_rev 2, rec_hash da0ef8c81830): the revision changed the plan after both phases had used their one round (+108 -83 lines), and the crew rules give that delta to the Captain. The Captain (GEVA-2) answered rec: it accepted the delta (uc1a, uc2a) and approved the plan with d1a to d11a (p1b), recorded as accepted_by GSTA-2. The reason: the delta is exactly the gate-1 fixes Garry took at 2026-11-02T23:47:16Z (Captain drive approvals/2026-11-02-l1-overhaul-measurement.md), so this gate was bookkeeping. gstack recorded the run complete at gate_rev 2.
- **/ship fix round** (2026-11-03): gstack /ship ran at full depth on the first pushed head (a batched specialist, red team, native adversarial, an outside voice and a targeted money reader), and Capy's PR review ran beside it. The Captain (GEVA-2) approved one fix round covering both sets of findings: the off arms' config path on review-units and one seeded user on both instruments (sections 3 and 4); one ledger item per launch, with a repair item per launch and the new totals, the $4,200 re-cost trigger, the $150 hold-back and the launch order (section 13); and rule fixes to the coverage gate, cap stops, the probe audit, table reading, the behavior LOSS branch, probes L and I, B5 and the amendment branches. The primaries O1 to O4, their arms and the MDD tables are unchanged.
- **Scoped fix** (2026-11-03): the second /ship pass found that the review caps sat below review-units' per-round worst case, that a LOSS could read CUT-CANDIDATE with a failed probe audit, and that oracle drops shrank the planned count. The Captain (GSTA-2) granted one scoped fix: the review cap headroom becomes one admission round's worst case, a LOSS reads CUT-CANDIDATE only with a passed audit, the install check and no arm over the cap-stop share, and oracle-dropped tasks stay in the planned count. Four smaller items were folded in. Expected spend is unchanged, and the primaries, their arms and the MDD tables are unchanged.
- **Cost bar** (2026-11-03): the approved GST-1088 overhaul plan makes cost per solved task at most 1.5x no gstack a co-primary acceptance bar. The Captain (GSTA-2) added it here as guard G3, binding on H-inv and descriptive on H-rev, in one text-only change. The same change makes section 7.6's attack 4 match section 9's LOSS rule and has the re-cost triggers read Lane B's ratio at 1.875. The tested families and MDD tables are unchanged.
- **Probe gate** (2026-11-03): Capy's review found that a behavior KEEP had no probe-audit gate, while section 7.6's attack 4 voids a behavior endpoint whose probe failed. The Captain (GSTA-2) granted one text fix: a behavior KEEP gets the same gate as a behavior LOSS, so a KEEP whose probe failed its audit reads FIX-METHOD (method). Outcome endpoints are unchanged.
- **Spend.** Approving this plan spends nothing. Section 13 expects about $7,970 across three run threads, each paused before $4,900. Each paid item still needs its amendment (section 12), a ledger approval row and, where section 8.3 asks for one, a passed admission.

## ELI5

gstack's skills are recipes the model can follow. Today Opus 5.5 mostly ignores them: it never opens one on its own, and when told to use one it loads the recipe and then skips the steps. gstack's maintainers are rebuilding gstack so the model actually runs the recipes. This plan says, before anyone sees results, exactly how we will check whether the rebuild worked.

We run three versions side by side on the same tasks at the same time: gstack as it is today, gstack after the rebuild, and no gstack at all. We count three things: does the model open the recipe without being told, does it do the recipe's steps when told, and does the work come out better.

The maintainers can see and tune against our public tests, so those only show trends. The verdict rests on a sealed set of new, hard tasks that nobody on the gstack side ever sees. We check first that plain Opus doesn't already ace them, so there is room to see a gain. Every null gets a "why null?" answer, and a loss is reported as a loss.

## Before → after

- **Before:** the evidence that gstack fails on Opus comes from separate runs on old gstack pins, with a driver bug in one of them, mostly on tasks where plain Opus already scores 81% or more. Nothing frozen says how the overhaul will be judged.
- **After:** one preregistration fixes the pins (before is gstack 82db89a), the arms, the endpoints, the scoring rules, the power, the caps and the verdict for every outcome, before the overhaul ships. The claim rests on a sealed, off-ceiling held-out set that gstack's maintainers never see.

## Why it matters

The overhaul is meant to fix a measured problem, so its success has to be measured the same way, not claimed. A test the builders can tune against can't carry the verdict. A test where plain Opus is already at the ceiling can't show a gain. And a before/after run that differs in anything but gstack can't attribute the change to gstack. This plan closes all three gaps before the first paid call.

## What caused this work

- Run D (#140, prereg #125): untold, Opus 5.5 opened an installed gstack skill in 0 of 252 eligible trials and particle-1 in 0 of 111; GPT-6.1 Sol in 17 of 111. Claude Code's preset prompt changed nothing on Opus.
- Told, loaded, then skipped: on #109's TB2 grid the /investigate body loaded 111 of 111 times and its DEBUG REPORT appeared 0 of 111 on Opus (0 of 333 pooled with the two ceremony-cut Opus arms, #148 line 224). On #108's review grid Opus dispatched no specialist and ran no adversarial pass in 66 of 66 sessions.
- When the procedure ran, it worked: GSTA-167's forced full /review caught 67.2% of blocking bugs against 10.3% for plain Opus (#120), at 2.71 false blockers per PR per pass, on a panel mined from gstack-family reviews.
- Traps: our review driver ended sessions while background readers ran (GST-734, fixed in #141); only 5 of 37 TB2 tasks fit /investigate and plain Opus passed all 15 runs of them.

## Big decisions

1. **Before and after run together, after the after pin exists.** Both pins, and no gstack, run in the same interleaved batches on one Claude Code version, so the arms differ only in gstack. Running "before" now would add weeks of model and harness drift. Only two small before-pin readings run early, as admission data that is never scored (section 8.3).
2. **Every primary endpoint rests on the sealed held-out set.** Discovery, adherence and outcome all get their verdicts there. The public instruments are rerun at both pins for comparability and are labeled tunable.
3. **Held-out arms: none, before and after, each untold and told, on all three models, plus two Opus attribution arms with the new hooks switched off.** The attribution arms cost about $720 and let R56 say whether the hooks or the text did the work.
4. **Held-out size: 80 bug-fix tasks x 3 and 36 review units x 2 passes, after a separate 12 + 8 admission slice.** At 80 tasks the outcome MDD stays under its 15-point margin even under the cautious spread assumption (section 8.2); 60 tasks did not.
5. **/qa and /verify get descriptive untold counts only.** No instrument on main has tasks that fit them; a fit set is a follow-up.
6. **Sol and particle-1 run inside Claude Code, Run D's route.** All three models then see the same hooks and the same system prompt. A native-harness Sol arm (Codex) is a separate question.
7. **Three run threads, each held under $5,000 by a pause rule that counts ledger spend, host model use and VMs.** About $7,970 expected in all: public $2,530, held-out bug fixes with the admission pilots $1,600, held-out review $3,830.

## Implementation plan

### 1. The question and the claims

GST-1088 overhauls gstack so frontier models run its skills. This preregistration asks three questions of the overhauled gstack ("after"), against gstack as of today ("before") and against no gstack ("none"), on Opus 5.5, GPT-6.1 Sol and particle-1:

1. **Discovery.** Untold (the prompt names no skill), does the model load the skill that fits the task?
2. **Adherence.** Told (the prompt opens with the skill's slash command), does the model produce the skill's required outputs?
3. **Outcome.** Does the work come out better than with no gstack, and better than before?

The claims the results post may make are the primary endpoints in section 6, each per model, each with its interval and its R48 verdict. Every primary endpoint is measured on the sealed held-out set (section 10). The public instruments (section 5.1) are rerun at both pins, but gstack's maintainers can read them and tune against them, so the post reports them as comparability readings and never rests a verdict on them. The post says this in its Setup section, in those words.

Targeted skills, agreed with gstack's maintainers on 2026-11-02: /investigate and /review, told and untold. /qa and /verify are untold-only and descriptive (section 6.3). Every other skill changes only by the description rewrite and the body diet, which act on every arm that carries gstack.

### 2. What exists on main, and what this plan reuses

Read on main at 0030e40. Each row is reused as it stands, with new pins written in a later pins-only amendment (section 12).

| Instrument | Code and posts | Reuse here |
|---|---|---|
| Run D untold discovery | quick/laneb (runner, arms, analysis/discovery-tax.ts); prereg #125, results #140; 37 TB2 tasks at TB2 69671fba; open, load and compliance rules in #125 section 5 | Public discovery (P1). Its load rule, task list and oracle rule unchanged; its arms rebuilt at the two pins. |
| TB2 told harness | quick/laneb, #109's grid (told prepare-run, invoke on), ceremony-cut #122/#128/#148 | Public told /investigate (P2, P3). |
| review-units | bin/gstack-evals review-units, src/trial/review; stacks-r1 (33 units, 42 blockers, 26 PRs, sha256 4f46bb17b7ef98a34db9bf4b03c69755c694eb17dfc7ca0e29e1049a1bcc9a1d); #141's driver (176fdc7); #154's admission, gate and pause rules; #153's Sol route; R2's judge pipeline at rig 715f837 | Public told /review (P4, P5) and the held-out review family (H-rev) through --sealed-root. |
| Lane B on sealed tasks | quick/laneb runs any Harbor-format task list with digests | The held-out bug-fix family (H-inv), in Harbor format. |
| Price table | src/runner/pricing/prices.ts; quick/laneb/config/proxy.json | Caps (section 13). |
| Ledger | the rig ledger and Lane B's per-item ledgers, one approval row per item | Every paid call. |

Not reused, with reasons: R1's arm C (GSTA-167's full /review) ran in another harness and cannot be rerun from main. R3's SWE-bench Verified band has not yet run a screen, so its headroom is unproven; it can join a later preregistration as a public bug-fix reading once it has run. CEO panel v2 is at a ceiling and panel v3 targets planning skills. The real-outcome lane targets /ship.

### 3. Pins and the fair-test rules

**gstack pins.**
- **before** = garrytan/gstack 82db89ab3ea3c64185538b8af33da2ffd1a18b57 (v1.93.22.0, committed 2026-11-02T21:53Z), confirmed by gstack's maintainers on 2026-11-02 as predating every overhaul commit. It is fixed whatever lands on gstack main later. At this pin /investigate has no phase headings (gstack#3842 removed them), so no probe here counts phases.
- **after** = one sha that gstack's maintainers name in writing when the overhaul ships, at or above before, on one release, with no gstack change between it and the run. It comes with a written install manifest (hook paths, the settings.json entries, the Bun the hook shims resolve, and each skill's dispatch and output rules that the probes read), which Amendment B diffs against before's install.

**Harness pins** (written in the amendments, section 12): one gstack-evals build commit for Lane B and one for review-units, each at or after the build units in section 11; review-units at or after 176fdc7 (#141) and after #160's event-order hold tests; one judging build that reads sealed keys (R2's rig 715f837 if B4 shows it can, otherwise the build B4 names); one Claude Code CLI version and one Agent SDK version for every arm and both pins; TB2 at 69671fbaac6d67a7ef0dfec016cc38a64ef7a77c with Run D's 37-task list as pinned at its runner tag (Run D cites sha256 9ccfec13f01c150f4ec838e19285375a1f034522c1a069c0ee83d75d12dd56d9 for quick look 3's 40-task file, less three tasks).

**The arms differ only in gstack.** These hold for every arm, model and instrument:
- Claude Code's own system prompt (claude-code-preset) on every arm, the R56 fair test.
- CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 on every arm.
- **One seeded user.** Lane B sets no GSTACK_* variable. review-units sets GSTACK_HOME and GSTACK_STATE_ROOT on every arm to the session's own seeded state root (src/trial/state-root.ts): the onboarding markers, with telemetry, update checks, artifact sync and codex reviews off, routing_declined true and proactive core. Build unit B1 writes the same markers and keys into each Lane B gstack arm's state root, so both instruments start every gstack arm as the same onboarded user. If the after pin's install manifest names a seeded key that changes how /investigate or /review fires, the Captain hears before Amendment B. At the after pin the diet is unconditional for /investigate and /review (gstack's maintainers, 2026-11-02), so a headless session gets the body a user gets.
- Each gstack arm installs gstack through that pin's own ./setup (host claude) into the arm's HOME, the way a user installs it, so each pin's hooks land in that HOME's ~/.claude/settings.json. before's existing hooks (timeline Stop, memorable UserPromptSubmit) install too. #109's tar arms predate this and are not reused.
- **Fresh state per session.** Every session starts from its arm's install-time HOME and gstack state root, unpacked fresh (review-units seeds its state root fresh for each session), so no learnings, review logs or contract records carry across tasks, units or passes. The dry run asserts that the state root holds only install-time files at session start.
- **Headless questions.** If a session calls AskUserQuestion, every arm and pin gets the same reply, the harness's existing headless answer recorded in Amendment B (or, if the harness has none, the fixed text "No answer is available; proceed with your best judgment."). Calls are counted per arm.
- The same prompt wrapper, turn cap, session allowance and timeout within an instrument and model.
- **Concurrency.** For each instrument and model, all arms run in the same batches, after the after pin exists. Lane B shuffles arm, task and replicate in one seeded order per batch (seed 20261102). review-units runs one command per model and pass, with every arm in it, in a seeded interleaved order of arm and unit (seed 20261102); every arm's pass 1 runs before any arm's pass 2. Long runs go out as detached shards with the controller on the waiting agent's machine, resumable without regrading. The only before-pin sessions that run before the after sha are the admission readings in section 8.3, which are never scored.

**The no-gstack arm is clean by construction.** Lane B runs each trial in a Harbor container whose image carries no gstack file. review-units runs each session in the rig's Docker sandbox with one bind mount, the work dir, on an arm image with no layers. Neither mounts a Capy drive. The dry run asserts, per arm image: no ~/.local/share/gstack, no gstack folder under ~/.claude/skills, and no gstack hook entry in ~/.claude/settings.json. After the run, a read audit greps every none transcript for drive paths, gstack paths and SKILL.md reads outside the repo under work. It is descriptive. A none session that read an installed gstack file is contaminated: it is dropped as untested, never scored as "no effect", and counted per arm.

**GST-734.** review-units carries #141's rule B (the session stays open while visible background work runs, bounded by --background-wait 3600 s; a deadline ends as E_BACKGROUND_DEADLINE, a coverage gap) and #154's held read rule A1. Lane B's driver (quick/laneb/runner/agent/laneb_agent.py, Python Agent SDK) never got that fix. Build unit B2 (section 11) gives it rule B and the session-end record before any counted run. Both pins use the same fixed drivers. Every results table reports, per arm, session_end.cause, deadline gaps and sessions that ended with background work still running at the first result.

### 4. Arms and models

| Arm | gstack | Prompt | Where |
|---|---|---|---|
| none | none | the instrument's plain prompt | everywhere |
| before-u | 82db89a | plain prompt (untold) | Run D, H-inv, H-rev |
| after-u | after sha | plain prompt (untold) | Run D, H-inv, H-rev |
| before-t | 82db89a | "/investigate" or "/review" then the plain prompt (told) | TB2 told, stacks-r1, H-inv, H-rev |
| after-t | after sha | same told line | TB2 told, stacks-r1, H-inv, H-rev |
| off-u, off-t | after sha, with skill_routing off and skill_contracts off in the config the session reads: on Lane B, gstack-config writes both into the arm's state root after ./setup; on review-units, both go in as seeded config keys (stateConfig in src/trial/review/run.ts, the path stack cells use) | untold, told | Opus only, H-inv and H-rev |

The told line is the skill's slash command, one space, and the instrument's plain prompt, the way a user types it. It is identical across pins. On review units the plain prompt is the rig's frozen brief (src/trial/review/told.ts), which forbids edits to the code under review. /review's fix-first step therefore can't run in any arm, and probe R (section 7.3) doesn't count it. At the after pin the off switches leave the hook entries registered but silent (gstack's maintainers, 2026-11-02), so off differs from after only in that config value. The dry run asserts, on each instrument, that gstack-config get prints off for both keys inside an off session and that an after session reads neither key as off.

Models (org R54): anthropic/claude-opus-5-5 direct; openai/gpt-6.1-sol inside Claude Code through OpenRouter's Anthropic-compatible endpoint (Run D's route, #153's review route); particle-ai/particle-1 through OpenRouter (particle-ai only). Every model runs inside Claude Code, so the hooks act the same way on all three. A Sol arm in its own Codex harness is out of scope. No Haiku 5.5 or Sonnet 5.5 cell runs. No open-weight ladder slot runs, so the OpenRouter ranking needs no re-read here. Placebo arms are left out: the treatment is a whole install, not a text, and #132 and #140 already measured placebo text.

### 5. Instruments and sessions

#### 5.1 Public instruments (comparability, tunable)

- **P1, Run D untold discovery.** Lane B, the 37 TB2 tasks, 3 replicates (Run D ran 1), arms none, before-u and after-u, three models: 333 trials per model. 60 turns. Allowances: Opus $2.50, Sol $2.50, particle-1 $0.80.
- **P2 and P3, TB2 told.** Same tasks and settings, arms before-t and after-t (none is shared with P1): 222 trials per model.
- **P4 and P5, stacks-r1 told review.** review-units, 33 units x 2 passes, arms none, before-t and after-t, three models: 198 sessions per model. 200 turns. Allowances: Opus $40, Sol $40, particle-1 $10. --cap-stops. Reader maps for both pins (section 11).

#### 5.2 Held-out instruments (where the verdicts rest)

- **H-inv, bug fixes.** Lane B, 80 sealed Harbor-format tasks x 3 replicates. Arms none, before-u, after-u, before-t and after-t on three models, plus off-u and off-t on Opus: 1,200 trials per model and 1,680 on Opus. 100 turns. Allowances: Opus $5, Sol $5, particle-1 $1.50.
- **H-rev, PR review.** review-units with --sealed-root, 36 sealed units x 2 passes, the same arms: 360 sessions per model and 504 on Opus. Turns and allowances as P4.
- **Admission slice.** 12 more H-inv tasks x 3 replicates and 8 more H-rev units x 2 passes, none arm only, three models. Its units never enter the confirmatory set (section 8.3).

### 6. Endpoints

All rates are per session (a TB2 or H-inv trial, or a review unit-pass). Every endpoint is reported per model with its 95% interval and its R48 verdict (section 9). Per model there are two Holm families at 0.05.

#### 6.1 Primary, behavior family (held-out; after minus before)

- **B1 discovery, H-inv.** Share of untold trials that load /investigate: after-u minus before-u.
- **B2 discovery, H-rev.** Share of untold sessions that load /review: after-u minus before-u.
- **B3 adherence, H-inv.** Share of told trials with a complete /investigate record under probe I: after-t minus before-t.
- **B4 adherence, H-rev.** Share of told sessions with a complete /review record under probe R: after-t minus before-t.

Claim margin for each: 20 points.

#### 6.2 Primary, outcome family (held-out; after minus none)

- **O1.** H-inv pass rate, after-t minus none.
- **O2.** H-inv pass rate, after-u minus none.
- **O3.** H-rev blocking recall, after-t minus none, under guard G1.
- **O4.** H-rev blocking recall, after-u minus none, under guard G2.

Claim margins: 15 points for O1 and O2, 20 points for O3 and O4.

**Guards G1 and G2 (false-blocker cost).** False blockers per unit-pass, after-t (G1) or after-u (G2) minus none: the guard holds when the unit-clustered 95% interval's upper bound is at most 1.0. This is gstack's maintainers' bar of at most one false blocker per PR, read against no gstack.

**Guard G3 (cost per solved task, binding on H-inv).** The approved GST-1088 overhaul plan sets an economic acceptance bar: on held-out tasks, cost per solved task at the after pin is at most 1.5x no gstack, and a default-on flip needs the bar as well. For O1 (after-t) and O2 (after-u), per model, G3 is the ratio of the arm's dollars per solved H-inv task to none's. Each arm's figure is its total metered dollars over its passing sessions (verifier reward 1), the successes S8 counts. If the after arm passes no session, G3 fails; if none passes no session, its figure is unbounded and G3 holds. The interval is section 8's task-clustered bootstrap (10,000 resamples, seed 20261102), and G3 holds when its upper bound is at most 1.5. On H-rev, the same ratio with matched key blockers in place of solved tasks is printed beside O3 and O4 as a descriptive line only, because "solved" has no frozen meaning on review units. G3 adds no tested endpoint, so the Holm families and the MDD tables are unchanged.

#### 6.3 Secondary (intervals, no family, no verdict of their own)

- S1 to S4: O1 to O4 with before in place of none, and after minus before on each outcome. This is the overhaul's own outcome effect.
- S5: before minus none on each outcome, so the post shows where today's gstack stands.
- S6, attribution (Opus): after-t minus off-t and after-u minus off-u on B1 to B4 and O1 to O4.
- S7, false routes: untold loads of /review on H-inv, of /investigate on H-rev, and of any other installed skill, /qa and /verify included. On P1, after-u minus before-u pass rate on the 32 non-fit TB2 tasks, read against a 7.5-point no-loss margin (the ceremony-cut Opus margin).
- S8, cost: dollars and tokens per session and per success, and the ratio to none, per arm. G3 (section 6.2) is S8's H-inv ratio for after-t and after-u, made binding.
- S9: share of blocking findings that carry proof (a repro, a failing test, or a cited line with its consequence), from the judge.
- S10: agreement between our probes and the after pin's own contract record (a JSON file under gstack's state root). The contract is never the score.
- S11: the mechanism counts: the route hook's line in the transcript (after-u), the contract hook's Stop block and contract record (after-t), repro before the first edit (descriptive, whatever GST-960 returns).
- S12, the tuning gap: for each behavior and outcome contrast that has a public twin, the public reading minus the held-out reading, per model. A gap well above 0 means the overhaul fits the public instruments better than new tasks.

#### 6.4 Public readings (comparability)

P1: B1's reading on the 37 TB2 tasks, and on the 5-task fit stratum, with Run D's open and compliance counts. P2: B3's reading on TB2 told, with #109's DEBUG REPORT marker beside it. P3: TB2 pass rate, after-t minus none and after-u minus none. P4: B4's reading on the stacks-r1 units whose diffs both pins' dispatch rules send to specialists (the rest are a reported stratum), with specialists and adversarial counts as #154 counts them. P5: stacks-r1 blocking recall, after-t minus none, with false blockers per unit-pass. Each gets an interval. None gets a KEEP, FIX-METHOD or CUT-CANDIDATE verdict; the post tags each one tunable.

### 7. Scoring rules, written before code

#### 7.1 Probe L, a load (discovery)

Run D's rule from #125 section 5, unchanged: a Skill call naming the skill with a non-error result, or a Read or Bash of the installed SKILL.md whose result holds the first 200 characters of that arm's own installed body, after stripping Read's line-number prefixes. The body prefix comes from each pin's own install, never from one pin for both. review-units gets the same rule (build unit B3). A load by the route hook's own injected text does not count; only a body arriving in a tool result counts. The one exception: if the after pin delivers a targeted skill's body through a hook by design (Amendment B reads the install manifest), a hook output holding the first 200 characters of that pin's installed body counts as a load for that pin, and the post reports how many of the pin's loads came that way.

#### 7.2 Probe I, a complete /investigate record (adherence)

A told trial is complete when all of these hold:
1. An assistant text after the last file edit holds a line matching DEBUG REPORT (case-insensitive, any markdown decoration), followed within 40 lines by the labels Symptom, Root cause, Fix, Evidence, Regression test and Status, each with non-empty content.
2. Fix names a path:line, and that path is a file the session edited.
3. Status is one of DONE, DONE_WITH_CONCERNS or BLOCKED.
4. After the last edit, the session ran a check: a simple command (each command of a parsed shell line, after cd, env prefixes and subshells are unwrapped) that matches the frozen test-runner list (pytest or py.test, python -m pytest, python -m unittest, tox, nox, go test, cargo test, npm/pnpm/yarn/bun test or run test, npx jest or vitest, jest, vitest, mocha, mvn test or verify, gradle or ./gradlew test, dotnet test, rspec or bundle exec rspec, rake test, phpunit, mix test, swift test, make test or check, ctest, bash or sh running a file under a test or tests path) or repeats a Bash call whose command exited non-zero before the session's first edit (a failing reproduction, run again). Exit status is read per Bash tool call, as Claude Code reports it, so the repeat must match that whole call's command.

An edit is an Edit, Write, MultiEdit or NotebookEdit call, or a simple command matching the frozen write list (sed -i, perl -pi, tee, a > or >> redirect to a path in the work tree, cat with a heredoc to a file, patch, git apply, git checkout of a path). Tool calls made by the session's subagents count in the edit and check order. A trial with no edit fails items 2 and 4. If the after pin's own skill no longer produces an output this probe needs, by design (Amendment B reads the install manifest), B3 gets no verdict: FIX-METHOD (method), never CUT-CANDIDATE.

#### 7.3 Probe R, a complete /review record (adherence)

A told session is complete when all three hold:
1. **Specialists, by the pin's own rule.** Each pin's reader map carries that pin's dispatch rule (for 82db89a, review-army.md L43 to L47: no specialists under 50 changed lines) and computes it from the unit's diff. Where the rule calls for specialists, at least one specialist report returned: a subagent launch the reader map names as a specialist, whose task notification arrived with a numeric total_tokens (#154's returned-report rule). Every H-rev unit changes at least 80 lines, and Amendment B checks that both pins' rules call for specialists on every H-rev unit; a unit the after pin's rule exempts leaves B4 only, reported, never the outcome endpoints.
2. An adversarial report returned, by the same rule, for a launch the reader map names as the adversarial pass.
3. A final findings block the rig parses.

Each pin gets its own reader map, built from that pin's own skill source and pinned by sha256 (build unit B3). A session that ends at the background deadline is a coverage gap (rule B1), not an incomplete record. If the after pin drops a probed output by design, B4 gets FIX-METHOD (method), never CUT-CANDIDATE.

#### 7.4 Outcomes

- **H-inv and TB2 pass.** Verifier reward 1 on the hidden tests. Hidden tests and oracle files are never reachable from the agent's container; the author kit and the dry run check it. Before every batch the oracle runs on that batch's VM; a task whose oracle fails is dropped from every arm and model, with no swap, and reported (Run D's oracle rule).
- **Review recall.** R2's pipeline: the judge-packet with reader names masked (blind.py), arm labels hidden, a matching batch (Opus 5.5 primary, GPT-6.1 Sol second, Sonnet 5.5 third) of each blocking finding against the key, then an adjudication batch for unmatched blocking findings. Per unit and arm, recall is matched key blockers over key blockers times graded passes. A unit enters a contrast only when both passes are graded in both arms; otherwise it leaves that contrast and counts under the coverage rule. The pooled rate is the ratio of sums, and the per-unit difference is weighted by the unit's key blockers.
- **Judge failures.** A judge call that fails, refuses or returns output the ingest can't parse is retried up to twice under the judge item (judge-run's own retry). If it still fails, that unit-pass is ungraded: a coverage gap.
- **False blocker.** An unmatched blocking finding that adjudication rules not a defect. An unmatched finding ruled a real defect is an extra real finding: counted and reported, never a false blocker and never recall.

#### 7.5 Session outcomes other than a graded result

| Case | Scored as | Rule |
|---|---|---|
| Turn cap or allowance stop | a graded fail for pass and adherence; for recall, a graded pass scored from its last parsed findings block (A1), or zero matched blockers if none parsed | Counted in every outcome. The rate is reported per arm; over 10% in any arm sends a null to step 1 of section 9's cycle; a KEEP stands, and a LOSS reads by section 9's LOSS rule. |
| Background deadline | coverage gap | as #154 B1; Lane B records it through B2 |
| Upstream or provider error (the session ends with no model output from a 5xx, a 429 after retries, or a route refusal) | relaunched once with the same task, arm and seed, under that launch's repair item, running only the affected cells (Amendment B's dry run shows this on each harness); a second failure is a coverage gap | never relaunched for any other reason |
| Infrastructure loss (VM or machine died, image pull refused) | relaunched once under that launch's repair item | logged per arm |
| Contaminated none session | dropped as untested | counted per arm |

Every Lane B and review-units session records session_end.cause, background_at_first_result and its upstream status (build unit B2 for Lane B), so each row above is classified from the record, never guessed.

**Coverage rule.** An endpoint has no outcome for a model when any of its arms has graded sessions for under 90% of its planned sessions, or when more than 10% of its task or unit clusters fail to enter its contrast. A task cluster enters when each arm of the contrast has at least one graded session on it; a review unit enters by section 7.4's rule (both passes graded in both arms). A task dropped by the oracle rule (section 7.4) stays in the planned count as a cluster that fails to enter, and is reported. A cluster that fails to enter is never imputed.

No graded session is ever rerun. A cap stop of a ledger item makes the run incomplete; it is never retried to change a verdict.

#### 7.6 Attacks on these rules, and the answers

1. **An empty report template passes probe I.** Every label needs content, Fix must name an edited file, and Status must be a listed value.
2. **Edits after the last test slip past the check by going through Bash.** The write list counts Bash edits, on each simple command. A gap remains for writes made by an interpreter one-liner; the probe audit (item 4) measures it.
3. **Subagents named "adversarial" that do nothing.** A report must return with numeric total_tokens. The reader map is built from the pin's source, not from the session.
4. **The probes misread paraphrases.** A blind audit reader (Opus 5.5, arm and pin hidden) labels sessions sampled stratified on the probe's own outcome: per probe and model, 20 that the probe passed and 20 it failed, pooled over arms (all of a class when fewer exist). Cohen's kappa is computed per probe and model, and the probe passes at 0.7 or more. When either sampled class holds fewer than 10 sessions (one class alone included), kappa is unstable at that prevalence, so the probe instead passes when the reader agrees on at least 95% of the sampled sessions. A failed probe makes the behavior endpoints that use it FIX-METHOD (method) for that model. For O1 to O4 it changes no KEEP: a KEEP is worded as a KEEP for the after install (section 9). A LOSS with a failed probe still reads as a loss, but its verdict is FIX-METHOD, never CUT-CANDIDATE (section 9), and a null still reads it at step 2 of section 9's cycle.
5. **The route hook injects the skill name and "discovery" becomes trivial.** That is the overhaul working as designed. S11 reports the hook's firing rate, a load still needs the body to arrive, and the outcome endpoints don't depend on it.
6. **The builders tune to the tests.** Every verdict rests on the held-out set (section 10), and S12 measures the gap.
7. **Time drift between pins.** Arms run in the same batches, in seeded interleaved order (section 3).
8. **Install asymmetry.** Both pins install through their own ./setup, built by the same builder (B1) for both harnesses, with construction checks in the dry run, and the hooks are shown to fire through the real pinned CLI.
9. **The driver ends a session early.** Rule B on both drivers, the session-end record on every session, deadline gaps counted.
10. **Judges unblinded by finding format.** Reader names and arm labels are masked. A newer format can still hint at the arm; matching is against a fixed key, which limits the room for bias, and the post lists it as a limit.
11. **Cap stops favor the cheap arm.** Cap stops score against their own arm, the 10% rule withholds outcomes when they bite, and cost is reported beside every rate.
12. **Many tests.** Holm within each family per model, and every secondary reading is labeled secondary.
13. **A panel that leans toward gstack.** stacks-r1 was mined from gstack-family reviews, so it stays public and secondary. H-rev is authored fresh, by a family not under test, with gstack kept out of the authoring sessions (section 10.2).
14. **Held-out leakage through the results.** Only aggregates leave custody (section 10.4).
15. **State carried between sessions.** Each session starts from a fresh install-time HOME and state root (section 3).
16. **/review's own size gate.** Probe R follows each pin's dispatch rule, and H-rev units are big enough that both pins call specialists (section 7.3).

### 8. Analysis, power and admission

#### 8.1 Method

Intervals are 95% percentile intervals from a cluster bootstrap: 10,000 resamples, seed 20261102. Clusters are tasks (Lane B) and units (review). A contrast pairs by cluster over the clusters both arms share. p values come from two-sided Monte Carlo sign-flip tests on per-cluster differences (100,000 draws, seed 20261102). For recall, the per-cluster difference is weighted by the unit's key blockers (section 7.4). Holm is applied within each family per model. One keyless analysis entry (build unit B5) reads one per-session outcome table, whose schema B5 freezes in src/types.ts with one converter per harness, and computes every endpoint, guard, gate and verdict. The dry run drives it.

#### 8.2 Power and MDD

power.py (attached; its sha256 is in the front matter) gives MDD = (z + 0.842) x SE, with SE simulated on paired clusters. Its assumptions: cluster rates ~ Beta(mean = control, a+b = conc), conc 2 (very spread; on TB2, Opus none passed 3 of 3 on 28 of 37 tasks) or 6 (moderate); each cluster drifts between arms by N(0, 0.10) under no effect (0.15 for recall); replicates and passes are independent; H-rev has 20% decoys and keyed units carry 1, 1, 1, 2, 2 or 3 blockers. MDD@Holm4 uses the first Holm step of a 4-member family (alpha 0.0125). From power.txt:

| Endpoint | Planned n | Assumed control | MDD@0.05 | MDD@Holm4 | Margin |
|---|---|---|---|---|---|
| O1, O2 (H-inv pass) | 80 tasks x 3 | 30% to 70%, conc 2 to 6 | 9.9 to 12.1 | 11.9 to 14.4 (admission table: up to 14.8) | 15 |
| O3, O4 (H-rev recall) | 36 units (29 keyed) x 2 | 7.1% to 15% | 10.7 to 13.2 | 12.7 to 15.8 | 20 |
| B1, B3 (behavior, H-inv) | 80 x 3 | before at 2% to 5% (30% to 50%) | 4.7 to 5.8 (9.9 to 10.6) | 5.6 to 7.0 (11.8 to 12.7) | 20 |
| B2, B4 (behavior, H-rev) | 36 x 2 | before at 2% to 5% (30% to 50%) | 8.4 to 10.5 (18.3 to 19.4) | 10.1 to 12.5 (21.9 to 23.1) | 20 |
| P5 (stacks-r1 recall, public) | 33 x 2 | 7.1% | 11.2 | 13.3 | |

power.txt's rows come from separate draws of one seeded stream, so one design can read slightly differently in two tables: the frozen admission table reads 14.8 at 50% control (conc 6) against 14.4 in the outcome rows. Monte Carlo error at 4,000 simulations is about 0.4 points. Admission reads the frozen table as written, so the rule is exact, but a true MDD near 50% control may sit up to about 0.4 points above the table, close to the 15-point margin. Recall rows draw about 1.67 blockers per keyed unit where stacks-r1 averages 1.56, so recall MDDs run slightly optimistic.

At 60 tasks x 3, O1's MDD@Holm4 was 13.9 to 16.3 and at 72 tasks 12.5 to 15.2, past the margin under conc 6, so section 5.2 asks for 80. B2 and B4 pass their margin only while the before arm sits low; section 9's saturation step handles the rest. The guard's precision comes from R1: on 14 PRs the false-blocker difference's interval was 2.7 points wide ([+1.46, +4.18]), so 36 units narrows it to roughly 1.7 (inferred, scaling with the square root of units).

#### 8.3 Admission (the E1 check, insight plan C1)

**Frozen parameters.** Admission reads power.txt's frozen admission tables, interpolating linearly between rows, never a fresh simulation. A rate outside a table's rows reads the nearest end row. That is conservative: binomial spread peaks at 50%, so MDD falls as a rate moves from 50% toward 0 or 100. The same reading rule applies to power.txt's behavior rows (2% to 50%), which section 9's saturation step uses. The tables: H-inv at 80 tasks x 3, conc 6, effect_sd 0.10, planning rate 40%; H-rev at 36 units x 2, conc 2, effect_sd 0.15, planning rate 7.1%; both at SIMS 4000 and seed 20261102. Amendment A's dry run prints admit or refuse at the floor, middle and top from those tables.

**Outcome admission (paid item h-pilot).** The admission slice runs the none arm on all three models. For each held-out family, on Opus 5.5:
- c = the none arm's rate on the slice, with its cluster interval. MDD = the larger of the table's MDD@Holm4 at c and at the planning rate.
- **Admit** when 100 minus the interval's upper bound is at least 2 x MDD and MDD is at most the family's claim margin. No lower-bound test applies: plain Opus may sit near 0 on review units, and each key is proven by its failing tests instead (section 10.2).
- **Not admitted** at the ceiling: the authors make one ceiling-raise attempt (R61: harder kinds, a new slice) and the slice runs again under a new item. A second failure stops the family.
- **Broken slice:** if more than 1 of the 8 H-rev units, or more than 2 of the 12 H-inv tasks, fails its oracle or failing-test check on the run VM, the authors make one re-author attempt under a new item; a second failure stops the family.
- A stopped family is one of the preregistered branches section 12 lists: Amendment B drops that family's endpoints, and the post reports it as FIX-METHOD (task fit).
- An incomplete slice (coverage under 90%, or any stop other than a coverage gap) gets no admission and goes to the Captain.
- Sol and particle-1 report their control rates. A model whose own rate leaves less room than 2 x MDD is flagged "ceiling expected"; its cells still run, and its verdicts follow the saturation path in section 9.

**Behavior reading (paid item b-pilot).** Before the after sha exists, the before-t arm runs on Opus on 10 public TB2 tasks x 1 and 6 public stacks-r1 units x 1 (each at least 80 changed lines). Probe I and probe R rates are reported to the Captain as admission data, never scored and never part of a contrast. If either rate passes 25%, the Captain hears before confirmatory authoring that B3 or B4 may land on section 9's saturation path.

The slice's units never enter the confirmatory set, and no gstack arm ever runs on them.

### 9. Verdicts and the R48 path for every null

Each primary endpoint gets one line per model: estimate, interval, Holm p, exposure, coverage, and the verdict, with G3's ratio and interval on the O1 and O2 lines. The exposure line for an outcome endpoint is the after arm's probe-complete rate (told) or load rate (untold).

**Outcome endpoints O1 to O4.**
- **KEEP:** the Holm-adjusted test rejects with the interval above 0, for O1 and O2 G3 holds, and for O3 and O4 the guard holds. With exposure at 80% or more, and the probe behind the exposure line passing its audit (section 7.6), the post credits the skill's procedure. Otherwise it is a KEEP for the after install, and the post says the procedure ran in that share of sessions.
- **KEEP, cost bar failed (O1, O2):** the test rejects with the interval above 0, but G3 fails. The post reports the gain and the failed bar together, and under the approved overhaul plan the after pin does not qualify for a default-on flip. It is never CUT-CANDIDATE; gstack's maintainers act on the bar. Every other O1 or O2 verdict prints G3 beside it.
- **Recall gain, guard fails:** no KEEP. The post says the skill catches more and blocks falsely more, with both intervals. R48's cycle names the fix (the proof rule on blocking findings). The verdict is FIX-METHOD (guard), never CUT-CANDIDATE.
- **LOSS:** the interval is below 0 with Holm p under 0.05. The post calls it a loss. CUT-CANDIDATE only when exposure is at least 80%, the probe behind the exposure line passed its audit (section 7.6) and no arm cap-stopped in more than 10% of its sessions; otherwise FIX-METHOD (exposure, method or harness limit, the first that fails).
- **Null:** the Why-null cycle runs in this order, and the first failing check names the kind:
  1. Power: coverage under the rule, or cap stops over 10%: FIX-METHOD (harness limit).
  2. Method: the probe audit failed for the probe behind the exposure line: FIX-METHOD (method).
  3. Exposure: the after arm's exposure line under 80%: FIX-METHOD (exposure).
  4. Saturation: with MDD read from section 8.3's frozen table at the none arm's counted rate, 100 minus the upper bound of the none arm's 95% cluster interval is under 2 x MDD: FIX-METHOD once (R61), with one ceiling-raise attempt on a new held-out wave before any cut.
  5. Task fit: the judges' extra-real findings or the probe audit show the key wrong for over 20% of units: FIX-METHOD (task fit).
  6. Otherwise: CUT-CANDIDATE for that skill on that model. It goes to the Captain plainly, in R48's words. The none arm's rate answers R48's frontier question ("does the model do it without the skill?") and is printed beside it.

**Behavior endpoints B1 to B4.**
- **KEEP:** the test rejects with the interval above 0 and the probe passed its audit (section 7.6). KEEP goes to the overhaul part that targets the endpoint: the route hook and the description rewrite for B1 and B2, the contract hook and the body diet for B3 and B4. S6 says which part carried it on Opus. A KEEP whose probe failed its audit reads FIX-METHOD (method).
- **LOSS:** the interval is below 0 with Holm p under 0.05. The post calls it a loss for that overhaul part on that model: CUT-CANDIDATE only when the probe passed its audit (section 7.6), the install exposure check (step 3 below) holds and no arm cap-stopped in more than 10% of its sessions; otherwise FIX-METHOD (method, exposure or harness limit, the first that fails). No Why-null cycle runs on a loss.
- **Null:** the cycle runs in this order:
  1. Power: as above: FIX-METHOD (harness limit).
  2. Method: the probe audit failed, or the after pin dropped a probed output by design: FIX-METHOD (method).
  3. Install exposure: the construction checks failed, or the after arm's hook fired in under 80% of the sessions where it should (the route hook's line in after-u sessions for B1 and B2; a contract record in after-t sessions for B3 and B4): FIX-METHOD (exposure).
  4. Saturation: take MDD from power.txt's behavior rows at the before arm's counted rate (the 80 x 3 rows for B1 and B3, the 36 x 2 rows for B2 and B4, read by section 8.3's rule). Saturation holds when that MDD passes the 20-point margin, or when 100 minus the upper bound of the before arm's 95% cluster interval is under 2 x MDD: FIX-METHOD (saturation).
  5. Otherwise: CUT-CANDIDATE for that overhaul part on that model.

A failed ceiling-raise attempt that fails because of harness limits or broken tasks gives FIX-METHOD, never CUT-CANDIDATE (CREW rule, R61). No verdict rests on Haiku or Sonnet data. The post names each null's kind: saturation, exposure, method or task fit.

### 10. The held-out set

This plan specifies the set; a later custody thread authors it (out of scope here).

#### 10.1 What each family holds

- **H-inv: 80 confirmatory tasks and 12 admission tasks.** Each task is a small fresh repository with one bug, a symptom report written the way a user writes one (it never names the cause), and a Harbor task (instruction, environment, hidden tests, oracle solution). The hidden tests fail on the broken tree and pass with the oracle fix, and neither is reachable from the agent's container. Kinds are chosen where root-cause work should matter: the symptom sits far from the cause, or the first hypothesis misleads. The kind list lives in the sealed author kit; this repo commits only the kit's sha256.
- **H-rev: 36 confirmatory units and 8 admission units.** Each unit is a fresh small repository at base and one PR (diff and description, written as an ordinary PR) that changes at least 80 lines. Its key lists 0 to 3 blocking defects, each with its location and its floor reason (it fails a test, breaks production, or loses data or secrets), plus known non-blocking issues. Each blocking defect comes with a failing test that proves it. 7 of the 36 confirmatory units (and 2 of the 8 admission units) are decoys with no blocking defect. Format: the stacks-r1 suite JSON that review-units reads under --sealed-root.
- **Derived only.** No TB2, SWE-bench, stacks-r1 or harness-evals content. A pattern taken from a private incident is rebuilt in fresh code; no code, text or transcript is copied (CREW rule, 2026-10-27).

#### 10.2 Authoring and audit

- **Who.** Authors: google/gemini-4-argon, a family not under test. Auditors: Opus 5.5 and GPT-6.1 Sol, each auditing every unit. They work on fresh machines under ~/.capy/work, blind to the overhaul plan, this repo's other panels and each other's drafts. They get the author kit, written by the custody thread. Files move by file transfer, never by message.
- **gstack kept out.** Every author and auditor brief says, first: do not load, read, install or run gstack or any skill, and do not read any drive path. The custody thread reads each author and auditor session's full transcript, tool inputs included, before sealing. Any unit authored or audited in a session that read a gstack path, a drive skills folder, an installed SKILL.md or made a Skill call is cut, and the cut count is reported. An auditor who touched gstack is replaced, not just cut.
- **Checks before sealing.** Each H-inv task passes a keyless oracle preflight twice: the broken tree fails the hidden tests, the oracle fix passes. Each H-rev blocking defect's failing test fails on the PR head and passes once the defect is fixed. These keyless checks come first. Then an auditor fit check confirms each task is a bug fix where investigation matters and each unit's key is right. A unit failing any check is cut before sealing, and counts cut are reported.
- **Staging.** Admission slices first; confirmatory units only after admission, of the admitted kinds.

#### 10.3 Custody

- Each family and wave is its own age-encrypted bundle, to a new recipient key for this set. The identity sits in a project-user drive's sealed-keys, apart from the Captain drive, beside the earlier panels' keys. Bundles live under a Captain-drive handoffs/<custody thread>/sealed/ folder, beside a CUSTODY.md that logs every opening, closing and incident.
- Labels are minted from crypto.getRandomValues, never from shas, names or ids; CUSTODY.md says so.
- Decrypt only into /dev/shm, under a live foreground program, with leftovers checked and deleted (test ! -e) on every wake. Run outputs are written encrypted per batch to mode-0700 directories, and leftovers of plaintext outputs are checked on every wake too.
- Lane B ships task bodies to Ubicloud VMs. Every VM is created with UBI_OWNER set to the run thread, from a runner copy pinned by sha256, with a TTL that covers its batch, and is deleted when its batch ends. CUSTODY.md logs each VM's create and delete times.
- Every held-out call through OpenRouter sends provider.data_collection deny (build unit B4; the rig's proxy already does, per prices.ts L74 to L75), and the dry run asserts it. h-pilot is each model's first held-out call, so it shows whether the route accepts the deny; a route that refuses it takes section 12's branch.
- The repo gets counts by family and language, size ranges, the bundle, suite and kit sha256s, the cut counts and the admission numbers. Never a per-unit row.
- **Who may open:** the custody thread, the run threads the Captain names, and their same-machine subagents (handoffs that carry sealed material stay on one machine). **Who must not:** gstack's maintainers and every thread working on GST-1088's build, any thread that builds a gstack candidate, and the authors and auditors after sealing. Amendment A names the GST-1088 build threads and confirms that none of them mounts the Captain drive or that project-user drive; CUSTODY.md records the check, and the custody thread repeats it before each counted release.
- **Opening budget:** one counted release per confirmatory bundle (all arms and both pins in it), plus logged keyless dry-run openings. Alpha 0.05 per family per release. A second release, such as a later after2 pin, needs a fresh wave and its own preregistration.

#### 10.4 What leaves custody

Aggregates only: per-arm rates, intervals, verdicts, costs and counts. Never per-task rows, transcripts, kinds or examples. The per-session outcome table (random labels, outcomes, costs; no bodies, no kinds) is age-encrypted to the custodian key, with its sha256 committed in the results post. The claim-check rerun (section 14) gets it through the custodian, logged in CUSTODY.md. gstack's maintainers get the post's aggregates, the same as any reader.

### 11. Build units before the amendments

Each unit is its own PR, with the plan step the crew rules set for it, and keyless tests under tests/. The Captain assigns them. None changes an endpoint or a rule above.

- **B1, setup-installed arms for both harnesses.** For Lane B and for review-units, build each gstack arm by running the pin's own ./setup (host claude) in a clean HOME on the harness's base image. Capture ~/.claude/skills, ~/.claude/settings.json and the gstack checkout with the Bun its hook shims resolve, as one manifest-pinned layer per pin (82db89a, after, and after with both hooks off). The none arm gets no layer. Checks: manifest sha256 per arm; hook entries present in both pins as each pin's ./setup writes them; none clean as section 3 says; and, with the real pinned Claude Code CLI against a fake upstream inside the actual arm images (as #141 tested), the after arm's UserPromptSubmit and Stop hooks fire on a fixture prompt and stay silent in the off arm.
- **B2, Lane B session-end record and hold rule (GST-734 shape).** Every Lane B trial records session_end.cause, background_at_first_result and its upstream status, whatever else happens. laneb_agent.py gets #141's rule B: hold while visible background work runs, a deadline as E_BACKGROUND_DEADLINE (a coverage gap). Keyless tests against the pinned Python Agent SDK with a stub CLI that backgrounds an Agent task, schedules a wakeup and has a Stop hook block once, plus a fixture per row of table 7.5.
- **B3, probes.** Probe I for Lane B. Probe R and probe L for review-units. Reader maps for 82db89a and the after sha, each built from that pin's own source, carrying that pin's dispatch rule, and pinned by sha256. Adversarial fixtures for every attack in section 7.6, including anchored shell parsing and subagent tool calls.
- **B4, sealed task roots.** Lane B reads a Harbor task list from a sealed root in /dev/shm, with digests checked, and sends provider.data_collection deny on every OpenRouter call. review-units' --sealed-root path with sealed judge keys, tested at the pinned judging build on a sealed fixture root. Run outputs never land under /dev/shm (E_RECEIPTS_VOLATILE).
- **B5, analysis and verdicts.** The per-session outcome table's schema in src/types.ts, one converter per harness (tested on recorded fixtures from Run D and #154), and one keyless entry from that table to every endpoint, interval, Holm step, guard, gate and verdict in sections 6 to 9. It implements the guard-fail verdict (FIX-METHOD, guard), cap-stopped sessions as graded fails, the contrast-entry coverage rule and the oracle-drop denominator (section 7.5). Synthetic-data tests cover KEEP, the guard failure, LOSS for outcome and behavior endpoints, every FIX-METHOD branch and CUT-CANDIDATE.
- **B6, the pause check.** A keyless command that reads every ledger a thread uses (the rig ledger, Lane B's per-item ledgers, judge items, VM reservations), adds the thread's host model use from a counter reading the operator passes in (credits at about $1 per 1,000, R42) and refuses a launch whose worst case would cross $4,900. Lane B's launch takes a --spend-cap, added here if it lacks one. Both dry runs drive it.

### 12. Amendments and the dry run

Two pins-only amendments follow this post. Neither may change an endpoint, arm, size, margin, scoring rule or verdict rule, except these preregistered branches: a family stopped under section 8.3; a model whose terms bar this use or publishing its results (section 16), whose cells drop; and a model whose route refuses provider.data_collection deny in h-pilot (section 10.3), whose held-out cells drop. The post says why for each. Any other change is a new preregistration that supersedes this one, reviewed the same way.

- **Amendment A (admission).** Pins the Lane B and review-units builds, the CLI and SDK versions, the judging build and the admission bundles' digests. Records the terms links for section 16 and the GST-1088 custody check. Its keyless dry run drives the admission rule at the floor, middle and top, the broken-slice and incomplete cases, and B6's pause. Then b-pilot and h-pilot run.
- **Amendment B (counted runs).** Written after the after sha exists. Pins the after sha and its install manifest (diffed against before's), every build, the reader maps and their dispatch rules, the probe lists, the AskUserQuestion reply, the analysis config sha256, the confirmatory bundle digests and the price table's as_of. Exposure smokes run on public units only, never on held-out, under their own items: 3 sessions per gstack arm, instrument and model. They confirm the install, the hooks firing, the driver hold and the per-session cost, and they re-cost every item under section 13's rule; they are never scored. Its keyless dry run drives every frozen rule through the pinned SDK and the real pinned CLI against fake upstreams and fake judges: each probe on adversarial fixtures, every session-outcome row, the coverage and cap-stop rules, each verdict branch, the pause, and one ledger lease opened and settled per item on a temporary ledger, with E_ITEM_BOUND on a second run of an item and a --resume after a pause reusing the open lease.

### 13. Spend

_Internal planning record: these budget and cost figures are plans and caps, not findings._

Prices come from src/runner/pricing/prices.ts (Opus 5.5 $4 in, $20 out, $0.20 cache read, $5 cache write per million; Sol through OpenRouter $2, $10, $0.10, $2.50, read 2026-11-02; particle-1 $0.10, $1, $0.003, read 2026-10-30). Lane B's proxy prices particle-1 input at $0.25, so its Lane B spend is an upper bound. Planning costs per session come from metered runs on main; price.py's header names each source and labels every guess. Sol has no metered review run, so it is costed at Opus's per-session rate. Cap per launch item = 1.5 x expected + one admission round's worst case: on Lane B, parallel sessions x allowance; on review-units, max(1, floor(parallel / arms)) units x arms x allowance, because review-units admits a round only while spent plus that round's worst case fits under the cap (src/trial/review/run.ts). Per judge batch, 1.5 x expected + $5. Per repair item, 1.5 x expected + 2 x allowance on Lane B, and 1.5 x expected + one round's worst case on review-units. Each cap is rounded up to $10. price.py and price.txt are attached.

**One item per launch.** The ledger binds an item to its first run (E_ITEM_BOUND), so every launch is its own item: each Lane B batch, each review-units command (one per model and pass), each smoke set (one per instrument and model, covering every gstack arm that model runs), each pilot launch and each judge batch (one per model, pass and step). Each launch also has its own repair item for its named relaunches (section 7.5), expected at 5% of the launch, so no two runs share an item. Each judge batch also has one repair item, capped like the batch and expected at zero, for a fresh run after a transport stop. A run resumed after a pause reuses its open lease with --resume (Amendment B's dry run shows it).

| Thread | Items | Expected | Item caps |
|---|---|---|---|
| T-pub | smokes per instrument and model; tb2 per model; rev per model and pass; judge batches; VM; a repair item per launch and per judge batch | $2,531 | $6,660 |
| T-hinv | b-pilot and h-pilot launches; their judge batches; hinv per model; VM; a repair item per launch and per judge batch | $1,604 | $5,070 |
| T-hrev | hrev per model and pass; judge batches; a repair item per launch and per judge batch | $3,834 | $8,220 |
| All | | $7,969 | $19,950 |

The Opus attribution arms (off-u, off-t) account for $722 of the expected total. Each thread's own host model use is read from its counter and counted at the pause, not budgeted here. The custody thread's authoring and audit model use is its own line, sized in Amendment A before authoring starts (section 15, step 2) and held under the same $4,900 pause as a run thread.

- **Pause rule (R42).** Each run thread stops launching new sessions, and reports to the Captain, before its settled plus reserved ledger spend, plus its host model use and VM hours, would pass $4,900. The operator runs B6's pause check before every launch, and launches run one at a time (#154's rule). A launch's --spend-cap is the smaller of its item's remaining cap and the pause headroom less $150 held back for the thread's host model use during the launch; the operator rereads the counter after each launch. The pause changes no score. The run resumes only on the Captain's word, and nobody reads an outcome of that thread in between. Every thread's item caps sum past $5,000, so the pause, not the caps, keeps each thread under the line. Passing $4,900 in any thread needs the Captain, and a heads-up to Garry before $5,000.
- **Re-cost and launch order.** After the smokes, price.py reruns with every guessed rate replaced by its smoke-measured per-session cost (each arm's held-out rate is its own smoke-measured public rate times its instrument's planning ratio of held-out to public cost: 1.7 on Lane B and 1.0 on review-units, as price.py's header states). The $4,200 and $5,000 triggers read the re-cost with Lane B's ratio at 1.875, the highest H-inv ratio measured, not the flat 1.7; price.py stays as written. If any thread's re-costed expected spend passes $4,200, that thread stops before its first counted launch and goes to the Captain; if it passes $5,000, Garry also hears before any launch. Launches run Opus, then Sol, then particle-1, each model's pass 1 before its pass 2, so a pause keeps whole Opus cells.
- Every paid call goes through a ledger item with one approval row. Ubicloud VMs carry UBI_OWNER and are deleted when their batch ends.

### 14. Results plan

- One results post, in its own PR after the runs (never in this PR), written as a finding file in the insight plan's section 3.1 template. Order: claim with its interval, what we found (each null with its control rate and MDD), how it works, setup (with the sentence that the verdicts rest on the held-out set because the builders could tune against the public instruments), results with the preregistered primaries first and verbatim, cost with a dated price table, Why null? per endpoint, limits, replication, what is held out and why, changelog. Disclosures go last, in a closing Disclosures section: "gstack is Garry Tan's own project." No disclosure in any X post draft.
- The claim check is blocking: a cross-family reviewer reads the post, and another Captain's crew reruns the keyless reanalysis on a clean machine from the committed public tables and the custodian's outcome table. Headlines must hold at both ends of their intervals, and the sealed guard must pass.
- The post is written later with the org banger-writing skill (R63). The claim check has the last word on every number and caveat. Posting is Garry's.
- Every pilot, stop and null goes in the org research registry, one line each.

### 15. Sequence and calendar

1. This preregistration merges.
2. B1 to B6 build, and the custody thread authors the admission slices, while gstack's overhaul is built.
3. Amendment A, then b-pilot and h-pilot (about $76 together). If admitted, confirmatory authoring (2 to 3 days).
4. The after sha arrives. Amendment B with smokes and the dry run (about 1 day).
5. Counted runs: T-pub, T-hinv and T-hrev (about 2 to 3 days; the 1,818 review-units sessions, 1,224 held-out and 594 public, are the long pole, re-estimated from #154's session times in Amendment B).
6. The results post and its claim check (1 to 2 days).

If steps 2 and 3 finish before the after sha, results land about 5 to 8 days after it.

### 16. Outside terms, licences and rights (R65's question)

| Item | Terms | What this plan does |
|---|---|---|
| Terminal-Bench 2.0 tasks | Apache-2.0 (NOTICE.md) | Runs them by registry pin, copies no file. |
| Harbor | Apache-2.0 (NOTICE.md) | Imports at run time, copies no file. |
| stacks-r1 units | public garrytan/gstack and garrytan/gbrain PRs, this repo owner's MIT projects | Reused as #108 and #154 use them. |
| gstack, both pins | garrytan/gstack, MIT; its install may pull third-party components under their own licences | Installed by its own ./setup into private arm layers; no layer or file is committed or published. |
| Claude Code CLI and Agent SDK | Anthropic's proprietary licence and terms for Claude Code | Run as a headless host, as every earlier instrument did, including with Sol and particle-1 through OpenRouter's Anthropic-compatible gateway (#140, #153). |
| Opus 5.5, Sol, particle-1 | each provider's API terms; Sol and particle-1 also under OpenRouter's terms, with data collection denied on held-out calls | Results from all three have been published before (#140). particle-1's licence is not stated on its OpenRouter page (read 2026-11-02). Amendment A records each terms link; if particle-1's terms bar this use or publishing its results, its cells drop before any run and the post says why. |
| gemini-4-argon as held-out author | Google's API terms, including the bar on using outputs to build competing models | The tasks measure gstack and train no model; Amendment A records the terms link the custody thread read. |
| Held-out tasks | authored fresh; no third-party code or text | The derived-task rule in section 10.1 keeps private-repo content out. |

No new dataset or benchmark licence is involved. Price note: OpenRouter listed particle-1 at $0.05 in and $0.50 out on 2026-11-02, half of prices.ts's row, so section 13's particle-1 figures are upper bounds.

### 17. Not in scope

Building the overhaul; authoring the held-out tasks (this plan specifies how); any paid run; a fit task set for /qa and /verify; Codex-host or other native-harness arms; R3's SWE-bench band; rerunning or amending #154.

### 18. Risks

- **The after pin's install needs something the containers lack.** B1 and Amendment B's install diff catch it before any counted run.
- **Held-out kinds come out at the ceiling.** One ceiling-raise attempt, then FIX-METHOD, never a cut.
- **Sol review costs differ from the assumption.** The smokes re-cost every item, the $4,200 re-cost trigger stops a thread before it launches, and the pause rule holds the line.
- **Judges may share Opus's blind spots.** The matching is against fixed keys proven by failing tests, Sol judges second, and kappa is reported.
- **The rig's no-edit brief may suppress /review steps in both pins.** Probe R counts only read-only steps, and the exposure line shows it if it happens.
- **gstack's hook-enforced /investigate test (GST-960) changes the after pin's contract.** The probe stays ours; repro-before-edit is scored descriptively either way.
- **Today's before pin may already run some steps.** b-pilot reads it early, and section 9's saturation step keeps a high before rate from becoming a cut.

## Review record

gstack /autoplan run autoplan-20261102231443 under org R65: phases CEO and eng, one native reader each (Opus 5.5), one round each, no outside voice, design and DX skipped as out of scope. CEO raised 16 findings (6 High) and eng 13 (5 High). The run log, both consensus tables and every finding title are in review-record.md. Gate 1 items d1 to d11 carried the 11 High findings, and the revision (revise v1) wrote each fix into the text above. In the attached copy, gstack's em dashes are replaced with hyphens and one thread reference is generalised.

The PR's gstack /ship review read this bundle at full depth (money class, from price.py), with Capy's PR review beside it, and a fix round and one scoped fix applied the findings listed under Approval. The /ship receipt in the PR body records the readers and their verdicts.
