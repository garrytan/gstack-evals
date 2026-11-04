---
id: 2026-11-04-geva-263-r3a4-admission-results
kind: finding
title: "R3a4: plain Opus 5.5 left 71 of 200 SWE-rebench tasks unsolved and plain GPT-6.1 Sol left 81, and both told pilots showed the procedure in 10 of 10, so both models pass admission for R3b (no effect claimed)"
summary: "R3a4 admission passed on both models: with no skill Opus 5.5 left 71 of 200 SWE-rebench tasks unsolved and Sol 81; told pilots 10 of 10 exposed. No effect claimed. Paid: $192.04."
author: GEVA-263
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-04
status: done
links:
  - 2026-11-01-geva-101-r48-follow-ups-prereg
  - 2026-11-03-geva-247-r3-amendment-4
  - 2026-11-03-geva-239-r3a-saturation-results
  - 2026-11-04-geva-263-r3-amendment-5
  - garrytan/gstack-evals#190
  - GST-1201
  - GST-1317
---

# R3a4: both models pass admission for R3b on SWE-rebench

Publication status: unpublished. This is the record of a preregistered admission check, not a claim about /investigate. Done: the oracle preflight, both screens, both pilots, analyze for both models and this file. Still open before any public use: a cross-family claim check against the run records and a recount by another Captain's crew.

| Field | Value |
|---|---|
| Grade | A preregistered screen and pilot (R3a4). Its rules decide whether R3b may run. It makes no claim about /investigate in either direction. |
| Prereg | [2026-11-01-geva-101-r48-follow-ups-prereg](../plans/2026-11-01-geva-101-r48-follow-ups-prereg/README.md) section 4 (#112), as amended through [R3 amendment 4](../plans/2026-11-03-geva-247-r3-amendment-4/README.md) (#190, merged as 703c733b) |
| Repo commit | Harness pinned at 616de34fb1c90763f897d1fdb7f1764ff7bcaee3 and run from a git archive export of it (amendment 4 section 2) |
| Data | Run records in the gstack-evals Captain's drive: handoffs/GEVA-248/record/ (Opus and the oracle preflight) and handoffs/GEVA-249/r3a4-sol/ (Sol). They are not public, because they hold model transcripts. This file publishes counts and digests only. |
| Reviewed by | /ship review of this file, recorded in the pull request |
| Reproduced by | Not reproduced |

## What we found

R3 asks whether gstack's /investigate, named in the prompt ("told"), helps a frontier model fix real bugs. R3a on SWE-bench Verified stopped for saturation ([R3a results](2026-11-03-geva-239-r3a-saturation-results.md), #183). Amendment 4 then spent R61's one ceiling-raise attempt on newer SWE-rebench tasks. Before any comparison, its screen checks that each model with no skill still fails at least 30 of 200 tasks, and a 10-trial told pilot checks that the procedure shows in at least 7.

Both models pass. With no skill, Opus 5.5 solved 129 of 200 tasks and left 71 unsolved. GPT-6.1 Sol solved 119 and left 81. In both told pilots, all 10 trials opened /investigate and showed its procedure. analyze exited 0 for both models and listed 70 R3b tasks for each.

This is admission only. No told arm ran on the admitted tasks, so this post estimates no effect of /investigate and claims none. It says that SWE-rebench leaves room to test told /investigate on both models, and that the told prompt with amendment 4's procedure line gets the procedure shown.

## How it works

This section is an explanation, not a result. SWE-rebench's pool tasks were created from October 2025 to May 2026, later than SWE-bench Verified's. The public leaderboard put earlier frontier models near 63% on its newest window (amendment 4 section 4), so the screen expected room, and it found 35.5% and 40.5% unsolved. On the pilot side, amendment 4 added a fixed line after the slash command: "Work through /investigate's phases in order, and finish with its DEBUG REPORT." The bare command had shown the procedure in only 2 and 4 of 10 R3a trials. With the line, both models printed a DEBUG REPORT in every pilot trial. The line names what the gate looks for, so these counts say the procedure was visible, not that it was followed (amendment 4 section 7).

## Setup

- **Question.** Does each model with no skill leave at least 30 of 200 drawn tasks unsolved, and does told /investigate with the procedure line show the procedure in at least 7 of 10 pilot trials? (#112 section 4.3; amendment 4 section 10.)
- **Arms.** Screen: none, with no skill, the plain task prompt and an empty skills directory in its arm tar. Pilot: told, gstack at 61e201ec (v1.91.295.0) with the prompt prefixed by /investigate and followed by the procedure line (arm name gstack in the analysis). Every arm sets CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1.
- **Models.** claude-opus-5-5 on the Anthropic API. openai/gpt-6.1-sol through OpenRouter, with the provider pinned to OpenAI and no fallbacks. Both go through the metering proxy with a $12 allowance per session (config/cells.r3a4.json at the pin).
- **Harness.** Lane B's runner at 616de34: Harbor at f3a5a923 and Claude Code 2.1.312, each part on its own Ubicloud standard-16 VM in eu-central-h1, six trials at a time.
- **Tasks.** The 354-task pool (sha256 7d2b2735cd50836364cc2c1fba9a2dd07a5ce42e9ea0f9c4b8d699b9e81ea1af). The oracle preflight ran the reference solution twice on every pool task and dropped 8 that failed both passes, keeping 346 (drop list sha256 dd23d16ce1b32669e219c82d48c2b7bd0fa34289b6dda628445a0939cc36cc6f). The screen drew 200 with seed 20261104 (ids in draw order sha256 440bac4fb8c1193292562d4199b9b86e19bf993d32138c6e93f2410e4a9c2055) as screen-a and screen-b of 100 each, one none trial per task. The pilot drew 10 of those 200 with seed 20261105 (sha256 e4c16fb029f58453d370e89c73e76db64b8ed8b9824bde623c697c8c173ccbc0), one told trial each. Both models got the same tasks. SWE-rebench is the work of Nebius AI R&D (arXiv 2505.20411 and 2602.23866), used under CC-BY-4.0; amendment 4 section 17 lists what we changed.
- **Grading.** A trial passes when the task's own tests pass in the separate verifier. The procedure gate (r3/exposure.ts at the pin) counts a told trial as exposed when it opened /investigate and the agent's text matches DEBUG REPORT or a "Phase 1" to "Phase 5" heading.
- **Runs.** Opus (GEVA-248) bound r3a4-opus at 13:55:39Z on 2026-11-03 and analyze ran at 20:38:07Z. Sol (GEVA-249) passed its route check from 12:27:56Z to 12:31:10Z, bound r3a4-sol at 13:56:47Z, finished its pilot at 02:00:28Z on 2026-11-04, and analyze ran at 02:01:37Z.

## Result

analyze's lines, exactly as printed. It exited 0 for both models.

Opus 5.5:

```text
r3a4-opus: 200 screen trials, 10 pilot trials, settled $85.40 of $550, open reserves 0
admission: 71 of 200 graded screen tasks unsolved by Opus 5.5 none (0 infra); pilot exposure 10 of 10 graded told trials
R3b start: 70 tasks; measured cost per trial none $0.37, told $0.74; projection r3b4-opus $232, r3b4-particle $473 (planning estimate $0.75 a trial); the Captain records both caps before R3b starts
```

GPT-6.1 Sol:

```text
r3a4-sol: 200 screen trials, 10 pilot trials, settled $103.85 of $700, open reserves 0
admission: 81 of 200 graded screen tasks unsolved by GPT-6.1 Sol none (0 infra); pilot exposure 10 of 10 graded told trials
R3b start for GPT-6.1 Sol: 70 tasks; measured cost per trial none $0.44, told $0.90; projection r3b4-sol $280; the Captain records r3b4-sol's cap before Sol's R3b starts
```

Counts from each run's record.json and trials.jsonl:

| | Opus 5.5 | GPT-6.1 Sol |
|---|---|---|
| Screen trials (none): run, graded, infra | 200, 200, 0 | 200, 200, 0 |
| Solved with no skill | 129 of 200, 64.5% (95% interval 57.4 to 71.1) | 119 of 200, 59.5% (52.3 to 66.4) |
| Unsolved, so admitted: screen-a, screen-b, total | 38, 33, 71 | 43, 38, 81 |
| R3b's bar | 30 | 30 |
| R3b tasks, n = min(70, admitted), drawn with seed 20261102 | 70 | 70 |
| Infra: screen-a, screen-b, pilot | 0 of 100, 0 of 100, 0 of 10 | 0 of 100, 0 of 100, 0 of 10 |
| Allowance stops (E1): screen-a none, screen-b none, pilot told | 0, 0, 0 | 0, 1, 0 |
| Agent timeouts and cap stops, every part | 0 | 0 |
| Pilot told: SKILL.md body loaded, /investigate opened, procedure shown | 10, 10, 10 of 10 | 10, 10, 10 of 10 |
| Pilot exposure, 95% interval | 69.2% to 100% | 69.2% to 100% |
| Pilot told: passed | 8 of 10 | 8 of 10 |
| Amendment 4 section 12 state | headroom found | headroom found |

The intervals are Clopper-Pearson, computed for this post from the counts.

Digests, sha256 of one id per line: the admitted lists, sorted, are df48f3cc0c9e649f8cfc457955bf67429c0f34bbe00970a70e1c0ffb5f8e7881 (Opus) and fc5527d7b15328fd5deecfdfd3af91bed716c71ec55be85cb2c387161a7a17ba (Sol). The R3b task lists, in draw order, are c4dc57fba3c9652e453dd32b57711b9bd55cd51a27803c74ea308ed54c073471 (Opus) and c357947874938eb82365c2fe70360600252f2fb4ffa6a5cc76ba58dc74b016ac (Sol); sorted, ecce0d450057ffd38c29d1434c2592818feb00f7a28b639ac6ab5c1a30065669 and da802083e36b493d36c1b85614a03ed11af650c1795a92a033b9f4247f3366e0.

62 tasks are admitted for both models, 9 for Opus only and 19 for Sol only, so 90 distinct tasks are unsolved by at least one model.

**Also read, deciding nothing:**

- **Gate patterns.** Every exposed pilot trial matched DEBUG REPORT. A Phase heading matched in no Opus trial and in one Sol trial.
- **Pilot passes.** 8 of 10 for each model. The pilot's tasks were drawn from all 200, and only two of them are admitted for each model; told failed both, on both models. One trial on each of 10 tasks is not a comparison, and the prereg freezes none.
- **Sol's allowance stop.** One screen-b none session had 6 requests refused at the session budget check, at $3.02 of its $12, and still passed. The check counts each request's worst-case cost before sending it, so it can refuse well under the allowance.
- **Told against none cost.** A told trial cost about twice a none trial: $0.74 against $0.37 on Opus and $0.90 against $0.44 on Sol. The pilot's 10 tasks are not the screen's 200, so the ratio is rough.

## Deviations

Three deviations, each ruled on by the Captain during the run (rulings recorded as GSTA-2). None changes an admission rule or count.

1. **Sol's screens ran without the run-time oracle gate.** Amendment 4 section 9 keeps `ORACLE=1`, so each part runs the reference solution on its tasks before its paid trials. GEVA-249's prepare ran without it, so prepare wrote no oracle.json for screen-a and screen-b, and vm-run.sh skipped the gate in both without a word. The Captain's ruling A1: "screen-a and screen-b stand on the preflight, with no oracle pass added afterward, and the reading gives infra per part beside the admitted count." The oracle preflight had passed every drawn task's reference solution twice at the same pinned image digests, and the table above gives infra per part (0 in each). Sol's pilot ran with the gate restored from a keyless scratch prepare whose plan.json was byte-identical to the live run's, and the gate passed. The Opus run caught the same miss before its bind and prepared again with `ORACLE=1`, so every Opus part ran the gate.
2. **Sol's screen-b controller died when the run machine slept, and screen-b was relaunched by hand.** The run thread ended a turn with no registered wait on its watcher. The machine slept, which killed the detached controller, the ledger service and the ssh session after screen-b's VM had pulled its images and before any trial ran. The ledger holds no screen-b session from that launch, so no model call was lost or counted twice. The Captain's ruling B: "GSTA-2 rules a hand relaunch of R3a4 Sol screen-b after its controller died before any trial ran: fresh VM reserve r3a4-sol-screen-b/vm2 sized to the worst case and settled by hand, model calls through launch.sh under r3a4-sol, launch-exit from the captured exit status." The first VM was settled by hand at $3.528667 for 5.881111 hours, over its $2.40 block, because no second block was reserved after the controller died. vm2 was reserved by hand at $4.80 and settled at $1.559000. Between screen-b and the pilot, a script mirrored screen.ts's stop checks and printed the projection, $179.77, which fits $700.
3. **The none arms see skills that ship inside 10 task repositories.** Amendment 4 section 16 says the none arm has an empty skills directory. Its arm tar does, but 10 of the 200 task checkouts carry their own project skills, and both arms run in the task's environment. The Captain ruled the Opus fastmcp-3237 hit "a descriptive note, not contamination" and the task-repo skills a deviation to list, with no rule change. They are descriptive, listed here and excluded from nothing. The next section traces them.

## Read audit of the none arms (descriptive)

scan.py ran over every part before analyze, as amendment 4 section 16 says. No gstack or drive pattern matched in any of the 400 none sessions. Generic skill patterns matched in a few. GEVA-248 traced the Opus init lists to the task repositories; the source of Sol's hits was left unchecked. This post checked both models, from three fields in the pulled records: the init skill and slash-command names, the names in Skill tool calls, and path strings in tool inputs.

- **Init lists.** In 190 of 200 none sessions per model, the init skill list holds only Claude Code's two built-ins, doctor and plugin-authoring. The other 10 list 1 to 6 more, 3 to 8 in all. They are the same 10 tasks for both models, from 6 repositories, with byte-identical extra names. The two models ran on different VMs from the same none arm tar, so what those sessions share is the task image. The extra skills come from the task checkouts. None is a gstack skill.
- **Skill tool calls.** Opus made none in its 200 none sessions. Sol made 9 calls in 6 sessions (scan.py counts sessions, which is the 6 its line shows). Each call names a skill or project command that appears among that session's own init skills or slash commands, and among those of no session outside its task, on either model. All 6 sessions are among the 10 above.
- **SKILL.md.** One hit per model, both on fastmcp-3237, whose task concerns fastmcp's own skills provider. The tool calls write and edit SKILL.md test fixtures inside the repository.
- **Skill directories (Sol).** One session listed /root/.claude/skills and found it empty, which is the none arm's own empty directory. Another ran a command that named the checkout's own .claude/skills path.

So every generic hit traces to a task repository or to the arm's own empty directory. The none arm stays free of gstack, by construction and by audit. The 10 tasks give both arms the same project skills, so they favor neither arm by design. R3 amendment 5 has R3b report the same counts per arm.

## Cost

Every R3a4 item, from the item ledgers in the Captain's drive (ledger/), settled in full with no reserve open:

| Item | Cap | Model spend | VM | Settled |
|---|---|---|---|---|
| r3a4-oracle (4 shards, no model) | $20 | $0 | $2.778166 | $2.778166 |
| r3a4-opus | $550 | $81.407886, 210 sessions | $3.992333, 3 VMs | $85.400219 |
| r3a4-sol | $700 | $96.668780, 212 sessions (2 in the route check) | $7.180500, 4 VMs | $103.849280 |
| r3-capacity-probe, Opus and Sol | $5 each | $0 | $0.007000 and $0.010333 | $0.017333 |
| **Total** | | | | **$192.044998** |

By part: Opus screen-a $35.891581 plus $1.780667 of VM, screen-b $38.153796 plus $1.889500, pilot $7.362509 plus $0.322166. Sol route check $0.174630, screen-a $43.668047 plus $1.648333, screen-b $43.854447 plus $5.087667 (vm1 $3.528667 and vm2 $1.559000), pilot $8.971656 plus $0.444500.

The run threads' own model use, at about $1 per 1,000 credits: GEVA-248 12,668 credits (about $12.67) and GEVA-249 17,045 credits (about $17.05). R3a4 all-in: about $221.76.

Per cell, from the ledger settles (tokens as input, output, cache write and cache read):

| Cell | Sessions | Spend | Per session | Per pass | Tokens | Requests |
|---|---|---|---|---|---|---|
| Opus 5.5 none | 200 | $74.045377 | $0.370 | $0.574 | 6,446; 1,220,308; 5,273,830; 116,215,100 | 3,214 |
| Opus 5.5 told | 10 | $7.362509 | $0.736 | $0.920 | 446; 105,430; 599,611; 11,269,940 | 221 |
| Sol none | 200 | $87.522494 | $0.438 | $0.735 | 18,486; 2,375,944; 14,896,592; 264,818,748 | 6,119 |
| Sol told | 10 | $8.971656 | $0.897 | $1.121 | 1,437; 201,527; 1,312,345; 36,724,458 | 479 |

Prices are the pin's config/proxy.json, in dollars per million tokens, as used on 2026-11-03 and 2026-11-04. Opus 5.5: input 4, output 20, cache write 5 (5-minute) or 8 (1-hour), cache read 0.20. GPT-6.1 Sol: input 2, output 10, cache write 2.50, cache read 0.10, and above 272,000 prompt tokens input 4, output 15, cache write 5, cache read 0.20. VMs: Ubicloud standard-16 at $0.60 an hour.

**VMs.** Every VM is destroyed. The Opus thread made 4 oracle shards, 1 probe and 3 part VMs, and `UBI_OWNER=GEVA-248 list --mine` came back empty. The Sol thread made 1 probe and VMs for screen-a, screen-b (two), and the pilot, and `UBI_OWNER=GEVA-249 list --mine` came back empty at 02:00:28Z.

## Why null? (R48)

This post reports an admission pass, not a null. No effect was estimated, so no Why-null cycle runs here. R3b's results post runs it if R3b ends null.

## Limits

- **Contamination.** Every pool task predates Opus 5.5's training cutoff, and most predate Sol's (amendment 4 section 6). That raises solve rates in both arms and biases toward saturation and a null. Every number here is about these tasks only.
- **Single draws.** One none trial per task, as frozen, so 71 and 81 are single draws; the intervals show the range.
- **Procedure visible, not followed.** The procedure line names the pattern the gate looks for, so exposure shows the procedure was visible, not that it was followed (amendment 4 section 7's known limit).
- **Sol's screens without the run-time gate** (deviation 1), covered by the preflight.
- **Task-repo skills** in 10 of 200 tasks (deviation 3).
- **Transcripts.** The counts come from analyze's output, the run records and the ledgers. The read audit above used only skill names, Skill call names and path strings; no agent reasoning or task text was read.

## Replicate it

The commands that ran are in amendment 4 sections 9 and 10 and in the run records: GEVA-248's step files and scripts/ (oracle preflight, prepare, probe, run) and GEVA-249's step scripts (route check, prepare, probe, launch, relaunch.sh for screen-b). The outcome step is `bun quick/laneb/r3/screen.ts analyze <work dir> --item <item>` from the pin's export, with LEDGER, DROPS and DROPS_SHA256 set, and the lines it printed are quoted above. This record leaves out the trial records and transcripts, which stay in the Captain's drive, so an outsider can't rerun analyze on them. A fresh replication is a paid screen: about $88 for Opus with the oracle preflight and about $104 for Sol at these runs' costs.

## What is held out

Nothing is sealed. The run records stay private only because they hold model transcripts and expired proxy session tokens. This post publishes counts and digests.

## Changelog

- 2026-11-04: first version (GEVA-263).

## Disclosures

gstack is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
