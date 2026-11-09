---
id: 2026-11-03-geva-239-r3a-saturation-results
kind: finding
title: "R3a: plain Opus 5.5 solved 86 of 91 and plain GPT-6.1 Sol 77 of 91 in-band SWE-bench Verified tasks, so told /investigate can't be tested on either (STOP, saturation)"
summary: "R3a read STOP (saturation) for both models: Opus 5.5 left 5 of 91 tasks unsolved and Sol 14, under R3b's 30. Told exposure 2 and 4 of 10. R48 FIX-METHOD."
author: GEVA-239
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-03
status: done
links:
  - 2026-11-01-geva-101-r48-follow-ups-prereg
  - 2026-11-02-geva-152-r3-amendment
  - 2026-11-02-geva-168-r3a-attempt-2
  - 2026-11-02-geva-177-r3-amendment-3
  - 2026-11-02-geva-192-r3-amendment-3b
  - 2026-11-03-geva-221-r3-amendment-3c
  - garrytan/gstack-evals#174
  - GST-1202
  - GST-1201
---

# R3a: plain Opus 5.5 solved 86 of 91 in-band SWE-bench Verified tasks and plain GPT-6.1 Sol solved 77 of 91, so told /investigate can't be tested on either model here

Publication status: unpublished. This is the record of a preregistered stop, not a claim about /investigate. Done: both runs, analyze for both models, this file. Still open before any public use: a cross-family claim check against the run records and a recount by another Captain's crew.

| Field | Value |
|---|---|
| Grade | A preregistered screen (R3a). Its rule decides whether R3b runs. It makes no claim about /investigate in either direction. |
| Prereg | [2026-11-01-geva-101-r48-follow-ups-prereg](../plans/2026-11-01-geva-101-r48-follow-ups-prereg/README.md) section 4 (#112), as amended by #133, #137, #146, #151 and [amendment 3c](../plans/2026-11-03-geva-221-r3-amendment-3c/README.md) (#174, merged as 60517b9) |
| Repo commit | Harness pinned at 8ec81b8a8ea6bfbc0f692826f9dbabe1146e3add and run from a git archive export of it (3c section 2) |
| Data | Run records in the gstack-evals Captain's drive, handoffs/GEVA-230/a5/ (Opus) and handoffs/GEVA-231/a2/ (Sol); not public, because they hold model transcripts. This file uses counts and public SWE-bench task ids only. |
| Reviewed by | /ship review of this file, recorded in the pull request |
| Reproduced by | Not reproduced |

## What we found

R3 asks whether gstack's /investigate, named in the prompt ("told"), helps a frontier model fix in-band SWE-bench Verified bugs. Before any comparison, its screen (R3a) checks that each model with no skill still fails enough tasks: R3b needs at least 30 of the 91 in-band tasks unsolved.

Neither model left enough. Opus 5.5 with no skill solved 86 of 91 tasks (94.5%) and left 5. GPT-6.1 Sol solved 77 of 91 (84.6%) and left 14. analyze printed STOP (saturation) for both models, so neither R3b starts. This is a "can't test here" finding. It says nothing about whether /investigate helps or hurts. It says that these tasks no longer have room to show a gain on today's frontier models.

The told pilot found a second problem. Both models opened /investigate's SKILL.md in all 10 told trials, but the procedure showed in only 2 of Opus's 10 and 4 of Sol's 10. The prereg needs 7 of 10, so the pilot gate would have stopped both models even if the screen had admitted 30 tasks.

## How it works

This section is an explanation, not a result. The band was cut from the mini-SWE-agent v2 leaderboard's February 2026 runs: the tasks that Opus 4.6, Opus 4.5 high and GPT-5.2 high solved 1 or 2 times out of 3 (93 tasks, 91 after amendment 3's oracle drops). Opus 5.5 and GPT-6.1 Sol are a later generation, and the prereg named the risk (section 4.1: Opus 5 was at 97% on Verified). The tasks and their fixes have been public since 2024, which may add to it. On the procedure side, the told models read the skill and then mostly did not produce its report. A SWE-bench issue often names the failing behavior, which may leave little for a root-cause procedure to do. We can't check that without reading transcripts, and this post reads none.

## Setup

- **Question.** Does each model, with no skill, leave at least 30 in-band tasks unsolved, and does told /investigate show its procedure in at least 7 of 10 pilot trials? (#112 section 4.3, and #133 for Sol.)
- **Arms.** Screen: none, no skill and the plain task prompt. Pilot: told, gstack at the pin with the prompt prefixed by /investigate (arm name gstack in the analysis). Every arm sets CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1.
- **Models.** claude-opus-5-5 on the Anthropic API. openai/gpt-6.1-sol through OpenRouter, with the provider pinned to OpenAI and no fallbacks.
- **Harness.** Lane B's runner (Harbor at f3a5a923, Claude Code) at pin 8ec81b8, each part (screen, pilot) on its own Ubicloud standard-16 VM in eu-central-h1.
- **Tasks.** 91 in-band SWE-bench Verified tasks, with drop list sha256 1f801fb38283714510fd850ddb59068c29f5e2a5a15d444f9055774df8ab26dc. One none trial per task. Pilot: 10 tasks drawn from the band with seed 20261101, one told trial each, the same 10 for both models.
- **Grading.** A trial passes when SWE-bench's own tests resolve the task. The procedure gate (#112 section 4.5, r3/exposure.ts at the pin) counts a told trial as exposed when it opened /investigate's SKILL.md and the agent's text matches DEBUG REPORT or a "Phase 1" to "Phase 5" heading.
- **Runs.** 2026-11-03. Opus attempt a5 (GEVA-230) bound its item at 04:47:30Z and Sol attempt a2 (GEVA-231) at 04:36:04Z. In both, the screen and pilot launches exited 0, both oracle gates passed, and the proxy end state was clean (cap_stop null).

## Result

analyze's lines, exactly as printed. It exited 5 for both models.

Opus 5.5, attempt a5:

```text
admission: 5 of 91 graded in-band tasks unsolved by Opus 5.5 none (0 infra); pilot exposure 2 of 10 graded told trials
R3 outcome: STOP (saturation). Only 5 in-band tasks are unsolved by Opus 5.5 with no skill, fewer than 30, so told /investigate can't be tested on Opus 5.5 on SWE-bench Verified. This report is the finding; R3b does not start.
```

GPT-6.1 Sol, attempt a2:

```text
admission: 14 of 91 graded in-band tasks unsolved by GPT-6.1 Sol none (0 infra); pilot exposure 4 of 10 graded told trials
R3 outcome for GPT-6.1 Sol: STOP (saturation). Only 14 in-band tasks are unsolved by GPT-6.1 Sol with no skill, fewer than 30, so told /investigate can't be tested on GPT-6.1 Sol on SWE-bench Verified. This report is the finding; Sol's R3b does not start, and Opus's R3 is unaffected.
```

Counts from each run's record.json and trials.jsonl:

| | Opus 5.5 | GPT-6.1 Sol |
|---|---|---|
| Screen trials (none): run, graded, infra | 91, 91, 0 | 91, 91, 0 |
| Solved with no skill | 86 of 91, 94.5% (95% interval 87.6 to 98.2) | 77 of 91, 84.6% (75.5 to 91.3) |
| Unsolved, so admitted for R3b | 5 | 14 |
| R3b's bar | 30 | 30 |
| Told pilot: opened /investigate's SKILL.md | 10 of 10 | 10 of 10 |
| Told pilot: procedure shown (exposed) | 2 of 10 | 4 of 10 |
| Told pilot: passed | 9 of 10 | 10 of 10 |
| Session budget stops: screen, pilot | 0, 0 | 0, 4 |
| Agent timeouts and cap stops, both parts | 0 | 0 |

The intervals are Clopper-Pearson, computed for this post from the counts.

The unsolved tasks, by public SWE-bench id:

- **Opus 5.5 (5):** django__django-15695, sphinx-doc__sphinx-10673, sphinx-doc__sphinx-8548, sphinx-doc__sphinx-8595, sympy__sympy-20916.
- **GPT-6.1 Sol (14):** astropy__astropy-13033, django__django-10973, django__django-12273, django__django-14771, django__django-15695, pydata__xarray-6938, pylint-dev__pylint-4970, pylint-dev__pylint-8898, sphinx-doc__sphinx-10435, sphinx-doc__sphinx-8595, sympy__sympy-14248, sympy__sympy-18211, sympy__sympy-20916, sympy__sympy-23950.

Three tasks are on both lists (django__django-15695, sphinx-doc__sphinx-8595, sympy__sympy-20916), so 16 distinct tasks are unsolved by at least one model.

**Also read, deciding nothing:**

- **Gate patterns.** Every exposed trial matched DEBUG REPORT. No told trial for either model matched a Phase heading.
- **Pilot passes.** 9 of 10 and 10 of 10 told trials passed. They are not a comparison with the screen: the prereg froze none, and 10 single trials can't show one.
- **Sol's budget stops.** In 4 of Sol's 10 told sessions, the proxy refused at least one request at the session budget check. The check counts each request's worst-case cost before sending it (runner/proxy.ts at the pin), so it can refuse well under the cap. All four still passed. None of the four was one of Sol's four exposed sessions, so 4 of Sol's 6 unexposed told sessions had a budget refusal. A refusal may have cut a session short before any report, or not; we read no transcripts. It is a harness note for the next Sol run.

## Why null? (R48)

This is a saturation null under R61. An exposure problem sits behind it and would have stopped the run on its own.

- **Exposure.** The prereg's rule (#112 section 4.3, and #133 for Sol): R3b starts only when told /investigate showed its procedure in at least 7 of 10 graded pilot trials, and R3b's own gate (section 4.5) then needs it in 90% of graded Opus told trials. Opus showed it in 2 of 10 (95% interval 2.5% to 55.6%) and Sol in 4 of 10 (12.2% to 73.8%). Neither count passes 7 of 10. screen.ts checks saturation first, so had either screen admitted 30 tasks, analyze would have printed STOP (FIX-METHOD) for the pilot instead. The models did not skip the skill: both opened SKILL.md in 10 of 10 told trials. Even told, they read it and mostly did not run its procedure, the pattern GEVA-100 found for /review and /investigate on Opus.
- **Task fit.** The band was chosen from older models' results and has been public since 2024. For today's frontier models it is no longer in band. Whether a root-cause procedure fits SWE-bench issues at all is not tested here.
- **Power and ceiling.** A ceiling. The next section gives the control rates and the MDD.
- **Frontier competence.** Yes. With no skill, Opus 5.5 solves 94.5% of the band and Sol 84.6%. Today's frontier models already do most of this job without /investigate.
- **Verdict: FIX-METHOD.** Under R61, a saturated null gets one attempt to raise the ceiling, after a headroom check, before any CUT-CANDIDATE. That attempt is planned as R3 amendment 4, tracked in GST-1201. No KEEP and no CUT-CANDIDATE rests on this record.

## Control rate and the smallest effect R3 could have seen

The findings standard (GST-800, decision D1) asks every null to state its control rate and its MDD.

- **Control rates.** With no skill, Opus 5.5 solved 94.5% of the band (87.6% to 98.2%) and Sol 84.6% (75.5% to 91.3%). The most any arm could gain on the band is what is left: 5.5 points on Opus and 15.4 on Sol.
- **MDD.** The prereg's frozen formula (section 6, power.py: 2.8 x sqrt(2 x 0.16 / 3 / n), three replicates, paired by task) gives 10.9 points at R3b's planned 70 tasks and 16.7 at its minimum of 30. At the admitted counts it would be 40.9 points at 5 tasks (Opus) and 24.4 at 14 (Sol). The formula assumes per-task pass chances near 0.5. On tasks a model failed once, the true rates are unknown, so these are the prereg's planning numbers at a smaller n, not fitted values.
- **Admission.** R3b would run only on the admitted tasks, the ones each model failed in its screen trial, and their control rates are unknown. So the band's rates above can't settle the findings standard's admission check (room of at least twice the MDD) for R3b. The preregistered rule, at least 30 admitted tasks, is what stopped it.

A saturation stop isn't a null on the skill. R3b never ran, so no lift was estimated and no interval on /investigate exists. The finding is that told /investigate can't be tested here.

## The earlier attempts

Five earlier attempts ended incomplete, and none of them produced an outcome. Their pulled results are kept and never analyzed (3c section 3).

## Limits

- **Contamination.** SWE-bench Verified and its fixes have been public since 2024. Every number here is about these tasks only, with no claim about unseen bugs.
- **Single draws.** The screen ran one none trial per task, as the prereg froze it, so 5 and 14 are single draws. A rerun could move them by a few tasks; the intervals show the range.
- **The gate's patterns.** Exposure rests on two text patterns. A session could follow the procedure without printing them, or print them without following it. The gate is frozen, and this post reports it as frozen.
- **Sol's budget refusals** in 4 told sessions, described under Result.
- **No transcripts read.** Every count comes from analyze's output and the fields of the run records.

## Replicate it

The commands that ran are amendment 3c section 10, which applies 3b section 10 at pin 8ec81b8 from a git archive export. Its outcome step is `screen.ts analyze <work dir> --model <model>` (amendment 3 section 10 step 9), and the lines it printed are quoted above. This record leaves out the trial records and transcripts, which stay in the Captain's drive, so an outsider can't rerun analyze on them.

## What is held out

Nothing is sealed. The run records stay private only because they hold model transcripts. This post publishes counts and public SWE-bench task ids.

## Changelog

- 2026-11-03: first version (GEVA-239).

## Disclosures

gstack is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

<details>
<summary>Agent notes</summary>

Both go through the metering proxy, with a $4 allowance per session (config/cells.r3.json at the pin).

r3a-screen: 91 screen trials, 10 pilot trials, settled $22.61 of $150, open reserves 0

r3a-sol: 91 screen trials, 10 pilot trials, settled $31.42 of $140, open reserves 0

Each of the four spent $0.65 to $0.81 of its $4 allowance.

**Cost**

Every R3a attempt, from the item ledgers in the Captain's drive (ledger/), settled in full with no reserve open:

| Model | Attempt | Thread | Sessions | Model spend | VM | Item total | Capacity probe | Ended |
|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | a1 | GEVA-168 | 0 | $0 | 0.008611 h, $0.005167 | $0.005167 | none | incomplete: runner sync failed |
| Opus 5.5 | a2 | GEVA-168 | 0 | $0 | 0.708056 h, $0.424834 | $0.424834 | none | incomplete: oracle gate |
| Opus 5.5 | a3 | GEVA-191 | 0 | $0 | 0.168889 h, $0.101333 | $0.101333 | none | incomplete: no start |
| Opus 5.5 | a4 | GEVA-199 | 91 | $17.804813 | 2.248056 h, $1.348834 | $19.153647 | $0.004833 | incomplete: /status bug |
| Opus 5.5 | a5 | GEVA-230 | 101 | $21.618915 | 1.647223 h, $0.988334 | $22.607249 | $0.005000 | STOP (saturation) |
| GPT-6.1 Sol | a1 | GEVA-200 | 93 (91 screen, 2 route check) | $24.587813 | 1.952500 h, $1.171500 | $25.759313 | $0.007500 | incomplete: /status bug |
| GPT-6.1 Sol | a2 | GEVA-231 | 101 | $30.001102 | 2.358055 h, $1.414833 | $31.415935 | $0.005000 | STOP (saturation) |

Per model:

- **Opus 5.5, a1 to a5:** $42.292230 on the item ledgers ($39.423728 model, $2.868502 VM), plus $0.009833 of probes: **$42.302063**.
- **GPT-6.1 Sol, a1 and a2:** $57.175248 on the item ledgers ($54.588915 model, $2.586333 VM), plus $0.012500 of probes: **$57.187748**.
- **Shared:** amendment 3's oracle preflight, $1.959834 of VM with no model call (ledger r3-oracle-preflight.jsonl).
- **All of R3a:** **$101.449645**, against item caps of $150 per Opus attempt and $140 per Sol attempt.

Per cell in the two complete attempts, from the ledger settles (tokens as input, output, cache write and cache read):

| Cell | Sessions | Spend | Per session | Per pass | Tokens | Requests |
|---|---|---|---|---|---|---|
| Opus 5.5 none | 91 | $17.376246 | $0.191 | $0.202 | 2,054; 340,708; 974,996; 28,392,522 (29,710,280) | 1,025 |
| Opus 5.5 told | 10 | $4.242669 | $0.424 | $0.471 | 308; 68,065; 302,705; 6,832,780 (7,203,858) | 154 |
| Sol none | 91 | $23.090780 | $0.254 | $0.300 | 6,084; 664,819; 3,994,865; 64,423,783 (69,089,551) | 2,028 |
| Sol told | 10 | $6.910322 | $0.691 | $0.691 | 1,134; 153,182; 1,359,092; 19,783,420 (21,296,828) | 378 |

A told session cost 2.2 times a none session on Opus and 2.7 times on Sol. The pilot's 10 tasks are not the screen's 91, so the ratios are rough.

Prices are the pin's config/proxy.json, in dollars per million tokens. Opus 5.5: input 4, output 20, cache write 5 (5-minute) or 8 (1-hour), cache read 0.20. GPT-6.1 Sol: input 2, output 10, cache write 2.50, cache read 0.10, and above 272k prompt tokens input 4, output 15, cache write 5, cache read 0.20. Cache reads and writes are billed at their own rates as each provider reports them.

Opus a1 (GEVA-168) died at the runner's first sync, because the pinned runner can't pack a subdirectory of a git checkout ($0.005167). Opus a2 (GEVA-168) stopped at the screen's oracle gate, where 3 of 93 tasks failed their own reference solution or image pull ($0.424834). Opus a3 (GEVA-191) never started, because Ubicloud held its VM waiting for capacity past the runner's 600-second limit ($0.101333). Opus a4 (GEVA-199, $19.153647 plus a $0.004833 probe) and Sol a1 (GEVA-200, $25.759313 plus a $0.007500 probe) ran full screens and stopped before the pilot on the /status bug: the pinned vm-run.sh read a proxy route that doesn't exist, so the end-state file was empty and the frozen rule marked each part incomplete (3c section 1). Together the five cost $45.456627, probes included.

A fresh replication is a paid screen, about $23 on Opus and $31 on Sol at these runs' costs.

</details>
