---
id: 2026-11-22-geva-573-weekly-stable-prereg
kind: plan
title: "Preregistration: is gstack better this week? A weekly paired number for this week's stable, last week's stable and no gstack, on 80 frozen SWE-rebench bug fixes"
summary: "Weekly, Opus 5.5 in Claude Code fixes 80 frozen SWE-rebench tasks with this week's gstack stable, last week's and none. Hidden tests score; a drop past the interval goes to GStack Minder."
author: GEVA-573
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-22
status: open
links:
  - 2026-11-21-capy-b2-test-first-prereg
  - 2026-11-21-capy-b1f-description-rewrite-prereg
  - 2026-11-21-capy-b1e-matcher-fix-results
  - 2026-11-17-geva-547-delivery-route-prereg
  - lanes/delivery-route/
  - https://github.com/garrytan/gstack/tree/dd611038ca41f81fab9fa129b670852c17954b44
attachments:
  - 602800ed65df8129628e78297eae8cd4ab0aac616fd096c031ee13e4e03cb8d2  draw.py
  - 39b312249c2f7b6ea4fb2687e4c210b8687dd50fc1a454f8ba75fc9cd7b31a9a  draw.txt
  - 7f29de150b2b416732958535c3d90614bcb47b5a30ede2d85d3d74242e4ced55  excluded.txt
  - 9a494b56afb2ca1521fcaa5bb426c2b5da94e6bea7022a69450dbb25e0650b3a  power.py
  - 3b83b533a01245c28e04b17a3b65421ce39867813704d8b301162211a19420db  power.txt
  - ea4f2f65f90a1f06f18c3c4c6d5a98d0313c7f9f733ac1ac1c7ea70e88ec4e86  tasks.txt
---

# Preregistration: is gstack better this week?

## Plain summary

Garry asked whether gstack is getting better. Nobody has a number for it. This plan gives one every Monday.

Every week, Claude Opus 5.5 in Claude Code tries the same 80 real bug fixes from 65 open-source Python repositories three ways: with this week's gstack stable, with last week's gstack stable, and with no gstack. Each task's own hidden tests decide pass or fail, so no model judges anything. The weekly number is this week's stable minus last week's stable, in passes out of 80, with a 95% interval, paired task by task. Cost per session gets the same paired treatment.

What it changes: a release whose interval lies wholly below last week's goes to GStack Minder as a regression, and the next stable cut waits until Minder names the cause or clears it. Anything else ships as normal. Every fourth week the four weeks pool into one gstack-versus-no-gstack number, the standing answer to "does gstack help Opus fix bugs at all".

It costs about $130 a week expected, with hard caps that total $185. A week when stable didn't move runs nothing and costs nothing.

What it can't see: a change smaller than about 12 points in a week, anything that isn't a Python bug fix, and other models. It needs a small build on the rig that already runs these tasks before the first week (section 13).

## Decision

### Each week

Read in this order. Rule 1 ends the reading; rules 2 to 4 each apply on their own, so a week can be both a cost regression and a pass gain; rule 5 applies only when none of 2 to 4 does.

| Result | What happens |
|---|---|
| 1. INCOMPLETE (section 9): an arm has more than 8 of its 80 tasks ungraded, a ledger cap stop, the weekly smoke fails on the rig, or the contamination check drops more than 8 tasks | No number that week. The page says why. If this week's stable failed its own ./setup, that is a release finding, not a rig failure: it goes to GStack Minder as a broken install, today's severe-fix rule. A cap stop still reports the cost ratio on the tasks that finished, because a cost regression is the likeliest reason a cap stops. |
| 2. Passes fell: the 95% interval for this week minus last week lies wholly below 0 | Regression. The weekly thread sends GStack Minder (GSTA-36) the tasks that flipped, both arms' transcripts and diffs, the exposure counts and the commit range between the two stable shas, and asks it to hold the next stable cut until it names the cause or clears it. The gstack-evals Captain carries the line to Garry. |
| 3. Cost rose: the cost ratio's 95% interval lies wholly above 1 and its point estimate is 1.10 or more | Cost regression. Same report to GStack Minder, with no hold. |
| 4. Passes rose: the 95% interval lies wholly above 0 | The page says this week's stable fixed more. GStack Minder gets the flipped tasks and the commit range as a lead on what helped. Nothing is published from one week. |
| 5. None of 2 to 4 | No change found. The release ships as normal. The page gives the number, its interval and the week's realized smallest detectable difference. |

With no true change, rule 2 fires falsely in about 2.5% of weeks, about 1.3 weeks a year (power.txt). A false hold costs one Minder read of the flipped tasks, which is why a hold waits on Minder rather than on a second paid run.

### Every fourth week (the block)

Weeks are numbered from the first counted week, and each block is four weeks that share no week with another block. The block reading pools stable minus no gstack over every counted week in the block (section 10).

| Result | What happens |
|---|---|
| The block's 95% interval lies wholly above 0 | KEEP: gstack as installed helps Opus fix these bugs. The block results post says by how much, and the Captain takes it to Garry. |
| The block's 95% interval lies wholly below 0 | gstack as installed costs Opus fixes. One "Why null?" style cycle (R48: exposure, task fit, power, ceiling) runs in the block post, which ends in CUT-CANDIDATE or FIX-METHOD. Garry hears a cut candidate in plain words. |
| Neither | A null. One "Why null?" cycle in the block post, then KEEP, FIX-METHOD or CUT-CANDIDATE under R48. |
| Fewer than 2 counted weeks in the block | No block reading; the weeks carry over to the next block's post as descriptive rows only. |

**Program stop rule.** After three blocks in a row with a null block reading and no weekly rule 2, 3 or 4 firing, the Captain decides whether the program still changes anything (R97). It doesn't keep running by default.

## 1. Question

On Claude Opus 5.5 in Claude Code, fixing real bugs from open-source repositories, does this week's gstack stable pass more or fewer hidden tests, or cost more or less per session, than last week's stable? And pooled over four weeks, does gstack as installed help at all against no gstack?

## 2. What already exists, and what this plan reuses

**FOUN-404's release curve** (org drive handoffs/release-curve-2026-11/). It ran five gstack stable tags and no gstack on 50 real bugs from gstack's and gbrain's own history, then a hard tier of 26 gbrain bugs. It found the curve flat (no release beat no gstack; slope of pass rate −0.07 points a day, interval −0.28 to +0.13) and gstack arms about 8% dearer per session on the easy set. It can't be the weekly number as it stands, for four reasons:

- Its tasks come from gstack's and gbrain's own history. A later gstack stable carries the fixes to gstack's own bugs, so a weekly forward run on them leaks, and R36 asks for other repositories' problems.
- It ran in Capy subagents, not Claude Code (R110).
- Every gstack arm was told to load gstack. Its pilot showed Opus opened an installed gstack in 0 of 12 runs without that line. gstack since ships a routing hook on by default, which is how a user gets it today.
- The easy set sat at an 88% ceiling (6 of 50 tasks could tell arms apart) and the hard set at an 8% floor.

This plan reuses its findings, its leak checks (one shallow commit, no remote, no FETCH_HEAD) and its paired analysis.

**The Lane B rig and the delivery-route lane** (B1 to B1f, and B2 now starting). It already runs Opus 5.5 in Claude Code on SWE-rebench tasks with Harbor's verifier, builds a gstack arm from a stable sha by gstack's own ./setup after a depth-1 fetch (lanes/delivery-route/b1f-build.sh), runs a no-gstack arm that is clean by construction, keeps a ledger with per-session allowances, and runs parts on Ubicloud VMs with hosts that stay awake. That covers most of this plan. What it lacks is the weekly part: resolving which shas are this week's and last week's stable, the contamination check, the weekly table and page, and the automation. So the build is a thin weekly lane and a schedule, not a new harness (section 13).

**No lane runs a fixed task set across gstack versions on a schedule today.** B2 will run 183 tasks from the same screened pool with gstack v1.102.1.0 against no gstack on Opus, once. Its Opus gstack-versus-none discordance is the best admission data the block reading will have.

## 3. Rig

B1's rig, unchanged (2026-11-17-geva-547-delivery-route-prereg, section 2, as B1d to B1f and B2 run it): Lane B's Claude Code agent on Harbor, Claude Code 2.1.312, claude-agent-sdk 0.2.174, Claude Code's own system prompt, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, the snapshot strip (auto-loaded instruction files, AGENTS.md at any depth and any project .claude folder removed from the task tree before the session), the harness mechanics eval's task setup, a 100-turn limit, B1's plain prompt and closing line, Harbor's egress sidecar at a 900 s read timeout (no session reaches anything but the metering proxy), and L1's host and part machinery.

The rig stays pinned for the program's life, so that a weekly change can only come from gstack. A change to any rig pin (Claude Code, the SDK, the verifier, the model) is a dated change to this plan, made in a week with no counted run, and the first week after it is a bridge: it reports its number but rules 2 to 4 don't fire, because last week's stable then ran on the old rig in the earlier week's sessions only. Within a week the rule can't be broken: all three arms run that week, on the same rig, interleaved.

## 4. Arms

| Arm | gstack | Prompt |
|---|---|---|
| this | the sha refs/heads/stable points to at run start | B1's plain prompt |
| last | the sha the previous weekly run recorded as this; for the first week, the stable sha seven days before run start | B1's plain prompt |
| none | none (R44) | B1's plain prompt |

**this** and **last** are each built the way B1f builds its stable arm, without any added skill: `git init; git fetch --depth 1 https://github.com/garrytan/gstack.git <sha>; git checkout FETCH_HEAD`, then `./setup --host claude --no-browser --loadout full` in Lane B's builder with Lane B's seeded long-time user, hooks on as shipped, GSTACK_SESSION_KIND=unattended and gstack's telemetry off. Nobody types a skill name and nothing tells the model to load gstack, so the arm is gstack as a user who installed it gets it on a bug report. The stable sha must be the peeled target of a v-tag; the page names the tag.

**none** is B1's none tar, sha256 8bab483364e4153a832c0995d6bc06d2953af805f32ae70a2e40788965a6764e, byte for byte: same model, tasks, rig and prompt, with no gstack, no ~/.gstack and no gstack setting. It runs where it can see no Capy drive and no gstack install, clean by construction; its read audit is reported after the run as a descriptive check.

**Old fixtures can't reach a gstack arm.** gstack's test/fixtures/skill-route-b1-in-sample.json names 60 SWE-rebench tasks, and old fixture files stay in gstack's git history. The depth-1 fetch brings one commit and no history. Each week's build checks `git rev-list --all --count` is 1, that the tree has no remote and no FETCH_HEAD after checkout, and runs the contamination check (section 6). The 60 ids are excluded from the draw (section 5), and the current stable, v1.102.2.0 at dd611038, names none of the 80 drawn tasks in any form (checked keyless on 2026-11-22: the 60 excluded ids are the only screened-pool ids it names).

**When this equals last** (stable didn't move), the week runs nothing, the page carries a row "stable unchanged at <tag>" and the spend is $0. If stable moves to a sha that last week already measured as last, the week runs as normal.

## 5. Tasks

draw.py reads the harness mechanics eval's screened SWE-rebench list (hm-screened.txt in B2's bundle, sha256 checked): 200 scored tasks, each built and graded on this rig in that eval. It drops the 60 tasks named in gstack's old routing fixtures (excluded.txt: the ids in the org drive's handoffs/GEVA-562/skill-route-fixtures/ and in gstack stable's test/fixtures/skill-route-b1-in-sample.json, the same 60, all in the scored list) and the 10 remaining interface tasks, which ask for new code. That leaves 130 tasks from 98 repositories. One seeded shuffle (seed 3892364212, minted from 4 random bytes on 2026-11-22 before any draw) of the sorted 130 gives the run order, and the first 80 are the frozen set: 80 tasks from 65 repositories. The pilot and weekly smoke take the first three tasks of the same shuffle of the sorted calibration tasks that are neither excluded nor interface tasks: psd-tools__psd-tools-593, BerriAI__litellm-16526 and schemathesis__schemathesis-3195. draw.txt is draw.py's output; tasks.txt lists the 80 in run order, then the three pilot tasks.

The draw uses no outcome from any earlier run, so it can't favour an arm. The set is frozen for the program's life and changes only by a new preregistration. SWE-rebench is the work of Nebius AI R&D, used under CC-BY-4.0. Every task is a Python repository.

**Admission.** B1's none arm passed 35 of its 60 tasks on Opus (58%), and on B1e's fresh 60 gstack main and no gstack both passed 34. The control sits mid-range, so passes have room to move both ways.

## 6. Each week, in order

1. **Resolve.** In a full clone used only by the resolver, outside every arm and every VM that runs a session: this = refs/heads/stable at run start, peeled to its v-tag; last = the previous run's recorded this, or for the first week `git log --first-parent -1 --before=<start minus 7 days> origin/stable`. Record both shas, tags and the commit count between them.
2. **Build.** The this arm's tar at its sha (section 4), and the last arm's tar, rebuilt the same way at its sha. Both are checked against the recorded sha's git archive digest, like B1f's tree check.
3. **Contamination check.** In each built gstack tree (the source tree and everything ./setup wrote under ~/.claude and ~/.gstack), search for each of the 83 task ids in four forms: `owner__repo-N`, `owner/repo#N`, `owner/repo/pull/N` and `owner/repo/issues/N`. A task with a hit in either tree drops from that week's pairs in every arm and is listed on the page. More than 8 dropped makes the week INCOMPLETE and calls for a refreshed set by a new preregistration.
4. **Weekly smoke.** The three pilot tasks on the this arm only, read for exposure, not outcomes, before any counted session: the arm passes its Part ran row in the Pilots table. Smoke sessions never enter a number.
5. **Run.** 240 counted sessions: each task's three arms in one part, in an order shuffled per task by a seed derived from the week's date. Four parts of 20 tasks, two at a time, six sessions at once in each.
6. **Read and post.** Section 10's table, the page row, the messages in the Decision table, records off the hosts with sha256 manifests, every VM destroyed.

## 7. What each session records

- **Pass** (primary): the Harbor verifier's reward on the diff at session end; 1 is a pass. B1's rule.
- **Dollars**: the session's metered list-price cost, from the ledger.
- **Exposure** (descriptive): in gstack arms, whether gstack's skill listing reached the model, what its routing hook logged on the prompt, whether any gstack skill loaded (a Skill call or a read of its SKILL.md, the B1d detectors) and whether a gstack skill's start step was seen; in none, the read audit.
- **Also descriptive**: tokens, turns, wall time, the STATUS line against the verifier (false "fixed"), allowance and turn-limit stops, provider safety stops on their own line (R95).

## 8. Models

| Model | Host | Route | Allowance a session |
|---|---|---|---|
| claude-opus-5-5 | Claude Code 2.1.312 | Anthropic, cells.l1.json | $3 |

GPT-6.2 Sol in Codex CLI and particle-1 are left out of the weekly run, and this says why (R54): at K = 80, Sol adds about $124 a week expected (B2's rates: $0.55 a gstack session, $0.45 none) and particle-1 about $39 ($0.17 and $0.15), which would take the weekly total well past $200. Sol's Codex rig also lands only with B2's results. The Captain can add either as a monthly wide week by a dated change; the cost of that is in section 12. A model under test is never swapped (R95).

## 9. Outcomes, reruns and gaps

B1's and B2's rules. A session is graded when it has a verifier reward and a model response reached the agent, whatever stopped it: an allowance stop, the turn limit, or a model or upstream error after a response all score on the diff at session end. Anything else is infrastructure: no result, no model response, or no verifier reward. An infrastructure session reruns once; if the rerun isn't graded, the cell is a gap. A ledger cap stop never reruns and makes the week INCOMPLETE. A provider safety stop keeps its outcome and is counted on its own line.

A week is INCOMPLETE when any arm has more than 8 of its 80 tasks ungraded or dropped, when its ledger item hits a cap stop, or when the weekly smoke fails for a rig reason. Pairs use the tasks graded in both arms of a contrast.

## 10. Reading

**Weekly primary.** Passes, this minus last, over tasks graded in both arms: the paired difference with Newcombe's 95% interval for paired proportions (method 10, as lanes/delivery-route/analyze.ts computes it), and the exact McNemar p beside it as descriptive.

**Weekly cost.** The geometric mean over tasks of this's dollars over last's, with a 95% paired bootstrap interval (10,000 resamples over tasks, seed derived from the week's date).

**Weekly descriptive.** this minus none and last minus none, on passes and cost; exposure per arm; and the same-release repeat: this week's last arm against last week's this arm, which ran the same sha a week apart, as a check on drift in the rig and the model's serving. A repeat interval that excludes 0 is printed on the page; it doesn't change the week's reading, which pairs within the week.

**Block.** For each counted week w in the block and each task t graded in both arms, d = stable's pass minus none's, where stable is that week's this arm. D is the mean over all (w, t). Its variance is cluster-robust with the task as the cluster: V = G/(G−1) times the sum over tasks g of (s_g − n_g D)^2, over N^2, where s_g is the sum of d for task g, n_g its count, N the number of pairs and G the number of tasks. The 95% interval is D ± 1.96 sqrt(V). The same formula with repository clusters is printed beside it. The block post also gives each week's this minus none and the cost ratio pooled the same way.

Nobody reads an outcome before a week's last session settles; the controller prints progress counts only.

## 11. Power

power.py, output in power.txt, two-sided 0.05 at 80% power.

- **Weekly passes** at K = 80: B1 measured 15% of tasks discordant between a treated arm and none on Opus. Two adjacent stables should disagree less, mostly from session noise. At 10%, 15% and 20% discordance the smallest detectable difference is 9.9, 12.1 and 14.0 points, about 8 to 11 of 80 tasks. The week catches a broken release, not a small drift.
- **Weekly cost**: FOUN-404 measured an SD of 0.23 to 0.33 in the per-task log cost difference, so the week detects a ratio of about 1.08 to 1.11. That is why rule 3 asks for a point estimate of 1.10 or more.
- **Block**: 4 × 80 pairs. If session noise dominates, 6.1 points at 15% discordance; if every task carries a fixed gstack effect, 12.1 points. The truth sits between.

## 12. Money

Each counted week is one ledger item, `ws-<YYYY-MM-DD>`, on the Lane B ledger. A session reserves its $3 allowance when it opens and settles at its metered cost; a refused reserve is a cap stop.

| Line | Expected a week | Cap a week |
|---|---|---|
| Opus sessions: 80 this and 80 last at $0.48, 80 none at $0.31 (B1f's planning rates), 3 smoke at $0.48 | $103 | $145 |
| Ubicloud: four parts on standard-16 at $0.60 an hour, about 5.5 hours each, and two standard-2 hosts at $0.08 an hour for about 11 hours | $15 | $20 |
| The weekly thread's own Capy meter (cost.dollars), building the arms and writing the page | $12 | $20 |
| Total | $130 | $185 |

The model cap is $103 plus 12 sessions in flight at their $3 allowance, plus about 5% for reruns, so a week at the planned rates can't stop on reservations alone. A this arm that costs about 30% more than planned would push the week to its cap; the cap stop is then the finding, and rule 1's partial cost ratio says so. If the pilot's sessions cost more than these planning rates, the caps are re-set by a dated change before the first counted week, and the new total goes back to Garry.

Over a year of weeks in which stable moves: about $6.8k expected and $9.6k at caps. Weeks when stable doesn't move cost $0. A monthly wide week with Sol in Codex and particle-1 would add about $163 expected that week ($124 Sol, $39 particle-1), about $215 at caps.

One-time costs before the first counted week, outside the weekly item: the pilot (the Pilots section, cap $14) and the build of the weekly lane in its own thread (section 13; estimate $150 to $300 on the meter, with its /ship).

Spend runs only through the ledger, and no paid session runs until the Captain records the weekly cap, after Garry approves the weekly total (R71).

## 13. Machines, build and schedule

**Ubicloud.** Two part VMs (standard-16) and their two awake hosts (standard-2) at once: 36 vCPUs, inside the crew's 208, and under the project's 464 fan-out line. Every VM carries UBI_OWNER set to the weekly thread's code and UBI_TTL_HOURS=14, runs from a pinned copy of ubi-runner.sh recorded by sha256, and is destroyed when its part ends, after its records are copied off and checked by sha256. Parts run detached on the hosts, and the weekly thread attaches on a timer, so no Capy machine has to stay awake for a part.

**Build.** One pull request adds lanes/weekly-stable/: the resolver, the arm build (b1f-build.sh's steps without the added skill, at two shas), the rev-list and contamination checks, the ledger item and caps, the table and page writer, and keyless tests for each, including the Newcombe and cluster-robust computations against hand-computed tables. It changes no scoring rule here. It ships under /ship before the pilot.

**Pilot.** Before the first counted week, and again after any rig change: the three pilot tasks on all three arms, nine sessions, under its own ledger item with a $14 cap.

**Schedule.** One automation, created by the gstack-evals Captain so that every run's thread joins its crew (R68), created disabled and switched on only after Garry approves the weekly total:

- Trigger: cron `0 20 * * 0` in America/Los_Angeles (Sunday 20:00, so the page lands Monday morning Pacific time).
- Each run starts a fresh thread (never the automation's standing thread) on Claude Opus 5.5, with this prompt: "Run this week's gstack weekly stable number: load the user-scoped gstack skill and run its install check, then follow lanes/weekly-stable/README.md in garrytan/gstack-evals for the week starting today, under wiki/plans/2026-11-22-geva-573-weekly-stable-prereg. Spend only through the week's ledger item at its recorded cap. Write the week's row to weekly/gstack-stable.md in the Captain drive, send the Decision table's messages, destroy every VM you created, report to the gstack-evals Captain, then archive this thread. In the fourth week of a block, open the block results pull request first, and archive only after it merges or closes."
- R70: a fresh thread per run that archives itself, so no standing thread grows. A thread that opened a block results pull request stays until it merges or closes (R91).

**Where the number lives.** Each week's row goes to weekly/gstack-stable.md in the gstack-evals Captain drive, with the tags, the shas, the three pass counts, the paired difference and its interval, the cost ratio and its interval, exposure, and the reading. Each block's results post goes to wiki/board through one pull request, with every week's row, the block reading and its "Why null?" cycle. Under R77, each block is one experiment with one results pull request; this preregistration covers every block. Runs' raw records go to the crew's private run store with sha256 manifests, so a new question is a re-score, not a re-run.

## Pilots

The one-time pilot runs the three pilot tasks on every arm. Budgets are each arm's share of the weekly model cap by expected spend. Each week's smoke repeats the this arm's Part ran row on the new stable before any counted session.

| Arm | Budget | Pilot cap | Part ran | Judge check | Supply |
|---|---|---|---|---|---|
| this | $54.80 | $5 | the built tree passes the rev-list, remote and contamination checks; gstack's skill listing reached the model and its routing hook logged an event on the prompt in each pilot session; telemetry reads off | none | the three pilot tasks build and grade on the rig, three sessions at once (one per arm, $9 reserved against the $14 pilot item), and the verifier returns a reward for each; the rig's six-at-once rate is B1's and B2's |
| last | $54.80 | $5 | as this, at last week's sha | none | as this |
| none | $35.40 | $3.50 | no gstack file, no ~/.gstack and no drive path in the session's environment, and no gstack read in the audit | none | as this |

The pilot runs three sessions at once so its reservations fit its $14 item cap; each counted week runs six at once in each part, and its $145 model cap holds 12 sessions in flight (section 12).

An arm that fails is fixed or left out and reported as left out, never as a loss. A failure goes to the Captain first, and a fix comes back as a dated change with its own pilot. Pilot sessions never enter a reading.

## Judge check

Judge: none

Passes come from each task's own hidden tests, cost from the meter and exposure from deterministic detectors, so no model judges any outcome and the R78 judge check doesn't apply.

## Interim look

Planned paid spend: $165

Look: none

Each week is its own counted run, planned at $165 paid at caps (sessions and Ubicloud), under $500, so it takes no interim look. The block reading pools weeks that share no week with another block, so it is one look per block.

## Limits

- One kind of task, on one model. Python bug fixes in Claude Code on Opus 5.5 say nothing about planning, review, /ship, other languages or Sol.
- A week detects about 12 points. A release that moves passes by 3 points will read as no change for months; the block reading is where smaller effects can show.
- One session per task per arm. Session noise is part of every paired difference; the same-release repeat measures how much.
- The frozen set is public and these tasks sit in a public dataset, so gstack could be tuned to them. The weekly contamination check catches a task named in gstack's tree, not tuning by hand.
- The rig is pinned for the program's life, so as users move to newer Claude Code versions, the weekly number drifts from what they run. Moving the pin costs a bridge week.
- "Last week's stable" is whatever stable was when the previous run started; a stable that moved twice in a week is measured only at its run-time head.
- The tasks were drawn as bug fixes and not every one is checked as a bug report (B2's limit applies here too).

## Credits

SWE-rebench is the work of Nebius AI R&D (CC-BY-4.0). gstack is MIT, Copyright (c) 2026 Garry Tan.

<details>
<summary>Agent notes</summary>

- Inventory read on 2026-11-22: org drive handoffs/release-curve-2026-11/ (FOUN-404.md, hard-tier/FOUN-404-hard.md, hard-tier/PREREG.md), lanes/delivery-route/, and wiki/INDEX.md. No lane runs a fixed set across gstack versions on a schedule.
- Contamination check before the draw: gstack stable dd611038 (v1.102.2.0) fetched at depth 1 (rev-list --all --count 1); the 240 ids in hm-screened.txt searched in four forms over every file outside .git; hits for exactly the 60 excluded ids, all in test/fixtures/skill-route-b1-in-sample.json. test/fixtures/skill-route-plain-prompts.txt holds 63 synthetic prompts, none from a task.
- The org drive copy of the fixture ids and gstack stable's file name the same 60 ids.
- The weekly lane, the pilot and the automation are not built by this pull request. No paid call has run.

</details>

## Disclosures

gstack is Garry Tan's own project.
