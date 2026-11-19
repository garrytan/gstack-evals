---
id: 2026-11-19-capy-b1d-hook-default-prereg
kind: plan
title: "Preregistration: does gstack main, with its hooks on by default, get Opus to load the skill without anyone typing it?"
summary: "gstack main at 5afef04, hooks on by default, with B1's prove-it, unattended on Opus 5.5. The bar: prove-it loads in at least 39 of B1's 60 bugs. A sealed held-out 60 runs four arms."
author: capy-b1d
model: anthropic/claude-opus-5-5
date: 2026-11-19
status: open
links:
  - 2026-11-18-capy-b1c-project-route-prereg
  - 2026-11-18-capy-b1c-project-route-results
  - 2026-11-18-capy-b1b-prose-route-prereg
  - 2026-11-18-capy-b1b-prose-route-results
  - 2026-11-17-geva-547-delivery-route-prereg
  - 2026-11-18-geva-548-delivery-route-results
  - https://github.com/garrytan/gstack/tree/5afef04e31de1cb30c727c7f827bdd729d04713e
  - lanes/delivery-route/
attachments:
  - ef43f5922698f89db7d9b4db3267ba83bdc154400ccd5a251983a5d2e344407b  arms.txt
  - 196abeec6850fc36288c6f1e3b18163de27fe3f75c1c76fd853260543e1413c8  draw.py
  - 25409663db64f243055b51c88873abedf37961d98a523e7f25271b119f108704  heldout.txt
  - 709bfafebcd99396313864d1087c92a03f5f726ee9b7f484a443c5d554452822  plan.txt
  - 86aacff0bfc9f9d9970bc4f66986c0fe9b0b578750f6c7885a8c098a93b8c440  power.txt
  - 744e994ca03fdff3e7b0db3e56dcb8f3208852d94cc9940bf951e0dc71ca5e7b  reuse.txt
  - 521bec03e3100a6faea37516d7ab651d690035a1b8e53788cb505ece0e85bff1  route-table.tsv
  - 09beef1b2c56af27ec1379a7ff6668e4f1f142783db09b8b4669c00ea19602a6  sessions.txt
---

# Preregistration: does gstack main, with its hooks on by default, get Opus to load the skill without anyone typing it?

## Approval

The go to run this eval came to this lane through the Captain, with the decision rule below set by gstack's owner. No paid call runs until this preregistration merges and the Captain records each item's cap (Agent notes). Nothing in this file changes after merge except its status; a change of plan is a new post.

## Plain summary

B1b showed that gstack's prompt-routing hook line, set to name /prove-it on every prompt, got Opus 5.5 to load B1's prove-it skill in 58 of 60 bug fixes, when that hook was the only gstack part installed. B1c showed that gstack's CLAUDE.md routing block, placed in the project's CLAUDE.md the way gstack writes it, got the skill loaded in 39 of the same 60.

gstack main now turns its hooks on by default, and at 5afef04 its routing hook can name any installed skill, not only gstack's own. B1d installs gstack main at that commit the way a user would (`./setup`, the full loadout), adds B1's prove-it skill beside it, and runs B1's 60 bugs on Opus 5.5 with the plain prompt and nothing typed. It counts the sessions where prove-it loaded.

What it decides, by gstack's owner's rule: if prove-it loads in at least 39 of the 60 (B1c's count for the block), gstack cuts its CLAUDE.md routing block and relies on the hook. Below 39, the block stays and the result goes to gstack's owner.

Two things make a below-bar result the likely one, and we say so before any data. First, at the pin the hook names prove-it on only 40 of the 60 prompts, so the hook can clear the bar only if Opus follows it almost every time. Second, on 7 of those 40 the hook names /verify first and prove-it second and tells the model to pick /verify if both fit.

Because gstack's matcher was tuned with these 60 prompts in view, the 60 are labelled "in-sample for routing". A held-out set of 60 other bugs, drawn by a seeded rule and sealed until every held-out arm finishes, runs four arms side by side: gstack main, B1c's block, B1c's block without its escape clause, and no gstack. It can stop a cut, and it decides how the block is judged.

## 1. Question and decision

Question: on Claude Opus 5.5 in unattended Claude Code sessions, with gstack main at 5afef04 installed as a user installs it and B1's gstack-shaped prove-it skill beside it, does prove-it get loaded without anyone typing it, in at least 39 of B1's 60 bug fixes?

**The primary (gstack's owner's rule).** The count of graded gstack-main sessions on B1's 60 run tasks in which prove-it loaded (section 8), as a point count against 39. Beside it we report the paired difference in loads against B1c's published project-md rows, with Newcombe's 95% interval for paired proportions (method 10), and the smallest detectable difference (section 11), so readers see how close the call is. The interval and the MDD do not move the decision.

| In-sample result (60 run tasks) | What gstack does |
|---|---|
| prove-it loaded in 39 or more | gstack cuts its CLAUDE.md routing block (the offer in bin/gstack-skill-start that writes it into the project CLAUDE.md) and relies on the hook, unless one of the held-out stops below applies |
| prove-it loaded in 38 or fewer | the block stays, and the result goes to gstack's owner |
| INCOMPLETE (section 9) | no decision; the block stays until the Captain decides |

**Held-out stops.** They apply only when the in-sample count clears 39. Each one means the block is not cut on its own and the result goes to gstack's owner with both readings:

1. the held-out set is INCOMPLETE (any of its four arms);
2. **disagreement**: on the held-out set, gstack-main's loads minus project-md's loads, paired by task, is at or below -26 points (the held-out MDD, section 11). Differences on 60 paired tasks move in steps of 1.67 points, so "at or below -26" and "more than 26 below" are the same rule: -26.7 is the first step that fires;
3. **rewrite, not cut**: the current block falls short of the hook on the held-out set (its band below is not "matches"), and the block without its escape clause "matches" the hook. The verdict then says rewrite the block, not cut it.

**Bands on the held-out set.** For arm a against gstack-main, the paired difference a minus gstack-main in loads with its Newcombe interval, and B1c's margin of 15 points: "matches" when the interval's lower end is above -15 points, "clearly loses" when its upper end is below -15 points, "middle" otherwise.

**The R48 verdict for CLAUDE.md routing, stated before data.** It is read from the held-out bands, in this order:

| project-md vs gstack-main | project-md-noescape vs gstack-main | R48 verdict |
|---|---|---|
| matches | any | none: the current block is not a losing part; whether it is cut as redundant rests on the in-sample rule |
| middle or clearly loses | matches | FIX-METHOD for CLAUDE.md routing: rewrite the block (drop the escape clause), not cut it |
| middle or clearly loses | middle | CUT-CANDIDATE for the current block's wording and FIX-METHOD for CLAUDE.md routing in general |
| middle or clearly loses | clearly loses | CUT-CANDIDATE for the current block and for CLAUDE.md routing in general |
| INCOMPLETE | | no held-out verdict |

Everything else stands, including gstack's owner's bar on the 60. b1d.ts hoReading holds this table as code, and the tests drive every row.

## 2. Rig

B1c's rig, unchanged (B1c's preregistration, section 2, which is B1b's): Lane B's Claude Code agent on Harbor, Claude Code 2.1.312, the claude-agent-sdk at 0.2.174 with the user and project setting sources, Claude Code's own system prompt, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, the snapshot strip, the harness mechanics task setup, the 100-turn limit, the closing line, Harbor's egress sidecar at a 900 s read timeout, and L1's host and part machinery with six sessions at a time. The rig's code is the same tree B1b and B1c ran (section 7).

CLAUDE_CODE_DISABLE_1M_CONTEXT: the rig's agent (quick/laneb/runner/agent/laneb_agent.py) neither sets nor forwards it, and no arm spec carries it, so it is unset in B1b, B1c and B1d alike. The keyless sessions (section 13) record each arm's skill listing as Claude Code builds it under that setting.

The arm specs, each on B1's tail (`:system_prompt=claude-code-preset:gstack_hooks=copy:strip_snapshot=true:closing_line=hm-status`):

- `gstack-main:tar=gstack-main` plus the tail.
- `project-md:tar=project-md` plus the tail and `:checks_trust=true`, B1c's spec unchanged.
- `project-md-noescape:tar=project-md-noescape` plus the tail and `:checks_trust=true`.
- `none:tar=none` plus the tail, B1's spec unchanged.

The prompt is B1's plain prompt, as B1b and B1c sent it. It never opens with `/prove-it`.

## 3. Tasks

**In-sample.** B1's 60 run tasks, byte for byte: tasks.txt in B1's preregistration (sha256 b116edf386ad9400db88173e0b3f58144ff4153c1664bca64d01be4aca6227b1), in draw order.

**Held-out.** 60 tasks drawn from a pool none of B1's tasks share a repository with (section 6). The list stays sealed until every held-out arm finishes.

**Smoke.** Two calibration tasks from B1's screened list, outside B1's 62 tasks' repositories and outside the held-out pool (it holds scored tasks only), picked before any session by their keyless route: in sorted order, the first the hook names prove-it alone on (aallan__vera-662_interface) and the first it names nothing on (imperialcollegelondon__pyrealm-593). B1's own two smoke tasks are both named nothing at the pin, so they could not show the hook's line reaching a session. The smoke tasks are also the pilot's: every arm runs both before any counted run (section 13).

## 4. The arms

**gstack-main.** gstack main at 5afef04e31de1cb30c727c7f827bdd729d04713e (1.101.0.0), fetched by sha and installed in a build container with `./setup --host claude --no-browser --loadout full` as root, the way a user's first install runs. Then B1's gstack-shaped prove-it skill (lanes/delivery-route/arms/gstack-shaped-SKILL.md, byte for byte) goes in at /root/.claude/skills/prove-it/SKILL.md, and gstack's first-run prompts are marked seen (update_check false, routing_declined true, its onboarding markers) so an unattended session never stops on one. Nothing in gstack's own files changes. lanes/delivery-route/b1d-build.sh does all of it through quick/laneb/arms/Dockerfile (arms.txt). What the session starts with:

- 65 skill folders under /root/.claude/skills: gstack's 64 and prove-it. Two of gstack's (land-and-deploy, modernize) set disable-model-invocation, so Claude Code lists 63 skills plus its own plugin-authoring, each with its whole description: 9,746 characters, 64 entries, none cut to a bare name, prove-it's entry in full.
- gstack's four hooks, registered by its setup in /root/.claude/settings.json: the prompt-routing hook (UserPromptSubmit), the destructive-command check (PreToolUse on Bash and PowerShell), and two Stop hooks (timeline and skill contracts). gstack-config reads skill_routing on and skill_contracts on, its defaults.
- The tar is 1,370,961,920 bytes, sha256 ee58dd16b7516d1b865527cd79bb5906ca6097b2c41a68360689ea2a88ab81eb, 14,582 files (quick/laneb/arms/manifests/b1d/gstack-main.json). gstack's setup is not byte-reproducible, so this tar is kept and pinned by its sha256; `b1d arms check` checks the tree's route files against their git blobs at the pin, the hook registrations and the seeded user.

**project-md.** B1c's arm unchanged: its spec, its tar (sha256 69da649d839da7607d5594d53e66549e89a0e0ef3d121a497063538977fe7331) and its manifest, copied byte for byte. B1's gstack-shaped tree, plus a pre-session script that writes B1b's routing block to /testbed/CLAUDE.md and commits it with gstack's message.

**project-md-noescape.** project-md with one change to its block: the escape clause goes. The block's routing line ends "Route only to skills in the session's available-skills list; answer directly for quick questions or small scoped edits." in project-md and "Route only to skills in the session's available-skills list." here. Nothing else in the block, the script or the tree changes (lanes/delivery-route/arms/b1d/CLAUDE-noescape.md, sha256 ad1523dfeeb23da8043862c7052600f0161d3af8b89fab60c716d41a367b46e1; tar sha256 9edfdc0755143fea34cff5242c2328b6a316511373ba9260f5b6f40c336df63e).

**none.** B1's no-gstack arm unchanged: no skill and no gstack file, the same model, rig and plain prompt (tar sha256 8bab483364e4153a832c0995d6bc06d2953af805f32ae70a2e40788965a6764e).

**The commit cue.** B1c commits the block with gstack's message, "chore: add gstack skill routing rules to CLAUDE.md". We checked whether gstack at 5afef04 makes that commit. Its `./setup` never writes a project CLAUDE.md. The only gstack code that writes the routing block is the offer in bin/gstack-skill-start (blob c371df7b3bcda8c808989d6015db8bd5f9574aac, unchanged since B1b's pin), lines 691 to 721, and its accept branch at line 699 reads: "append this section to the end of CLAUDE.md, then commit it (`git add CLAUDE.md && git commit -m \"chore: add gstack skill routing rules to CLAUDE.md\"`)". So the commit stays in both project-file arms.

## 5. What the hook does at the pin

**The route table.** route-table.tsv holds, for B1's 60 run prompts and 10 calibration prompts, what gstack's own matcher (lib/skill-route.ts) returns and what gstack's real hook binary prints, run from the built arm's tree on each prompt as the rig sends it. They agree on all 70. On the 60 run prompts:

| Where the hook puts prove-it | Run prompts | Held-out prompts |
|---|---|---|
| alone ("this request fits /prove-it. Run /prove-it with the Skill tool before you start") | 33 | 39 |
| first of two (prove-it, then /verify; "/prove-it if both fit") | 0 | 3 |
| second of two (/verify, then prove-it; "/verify if both fit") | 7 | 7 |
| not named | 20 | 11 |

On the run prompts the hook names /verify on 9 (7 beside prove-it, 2 alone) and nothing on 18. The held-out counts come from the same command on the sealed list; only the counts are committed (heldout.txt).

**Coverage tops out at 40.** If Opus loads prove-it only where the hook names it, the most the hook can reach on the 60 is 40, one above the bar. And on 7 of those the hook names /verify first and, by gstack's tie rule, tells the model to run /verify if both fit. So a below-bar result is the likely one. Section 11 gives the odds.

**Tuning history.** At 3f1b82b, the first gstack commit with hooks on by default, the hook named only gstack's own skills and could not name prove-it, so this run waited. gstack 5afef04 made installed skills routable. Its matcher was developed with B1's 60 run prompts in view: three of them (tox-dev__tox-3666, zauberzeug__nicegui-5914, hkuds__openharness-217) are in gstack's own test fixture skill-route-bug-reports.json at the pin, and gstack's maintainers confirmed they tuned on the 60. prove-it's triggers are B1's, frozen since B1. That is why the primary is labelled "in-sample for routing", and why the held-out set exists.

## 6. The held-out set

**Pool.** B1's screened scored tasks (hm-screened.txt in B1's bundle, 200 tasks, each run on this rig in the harness mechanics eval) minus every task whose repository is the repository of one of B1's 62 tasks: 89 tasks in 77 repositories. The pool can be listed from committed files. Our crew ran every one of them in the harness mechanics eval; nobody used them to tune routing; none of their ids appears in gstack's tree at 5afef04.

**Draw.** draw.py, committed with its seed's sha256 (47efaf1f6d41d69991d0b36a1f05f835a04a24467a8b69265618879a485d7255) before it ran. The seed is 32 random bytes as 64 hex characters, minted on our machine and kept outside this repository. The script shuffles the sorted pool with Python's random.Random seeded by the seed and takes the first 60 tasks with at most one task per repository. It printed (heldout.txt): the pool's sorted sha256 36c7b92de330e618c4560b121f987c32491bf8bac6b0bd5de07b85c0951fecf7, and the run's 60 tasks from 60 repositories with sorted sha256 918664d3b44dcb0bb9480d8cc30bc4293be832f625fdf1d998e1257e655f12c0 and draw-order sha256 c12ff26d9fd21cd7c8615e0615cd8d036763462a3808092da5c5882e56868cd5. Neither smoke task's repository is in the list.

**Seal.** The list, the seed and the per-task held-out route table stay outside this repository and are not shared with gstack's maintainers until every held-out arm finishes. The run reads the list from B1D_HELDOUT and refuses it unless both digests match. The arm is a pinned tar, so no change to gstack's matcher can reach the run; and nobody changes the matcher or prove-it's triggers for this run while the set is sealed. The results publish the seed, the list and the route table, so anyone can rerun the draw.

## 7. Controls and the no-gstack arm

**In-sample control.** B1c's published project-md rows (its results bundle's sessions.jsonl, sha256 d21b0d0b8fa52c7e65acae092f30892d8c5c11f58d80f3dc21461d5efedb77e1): 39 of 60 loaded. It ran on 2026-11-18 from 6a72369dcecf099011295db6fa79ae5a3add0a17, before B1d, not beside it. It is reused only because everything that decides what a session gets is the same: `b1d reuse` compares the git tree or blob of each such path at B1c's run commit and at B1d's (B1's list, B1b's, and B1c's arm files and manifests) and checks the model id on B1c's rows. All are the same at main when this was written (reuse.txt). The launch guard reruns it at the run commit and at the checkout's head, refuses if any path differs or the checkout holds uncommitted changes to these paths or to B1d's own, and takes it to the Captain.

**In-sample no-gstack arm.** B1's Opus none arm, as B1b and B1c used it: followed in 0 of 60, loaded in none. B1b's check that it can be reused runs at launch too.

**Held-out.** All four arms run on the same 60 tasks, concurrently: each part holds 20 tasks with every arm of each task, in L1's seeded order. The no-gstack arm there is a fresh run of B1's none arm.

## 8. What each session records

**Loads (the primary).** B1b's load detector, unchanged (lanes/delivery-route/b1b.ts loadsOf): a Skill call naming prove-it whose result is not an error, a Read of its SKILL.md whose result is not an error, or a Bash call that prints a line of it at least 40 characters long. A call of one of these shapes that fails those tests is a failed load.

**Beside the primary**, for every arm where it applies:

- **at the first call**: the load was the session's first tool call;
- **/verify loaded**: the same three shapes for gstack's /verify (b1d.ts verifyLoadOf; a Bash result must hold its "# /verify" heading);
- **what the hook named**: the routed line's skill and second skill in gstack's own hook log, copied out after the session (gstack_hooks=copy), and so where it put prove-it (alone, first of two, second of two, not named, or log missing);
- **line delivered**: whether the hook's line reached the request before the model's first output, as the rig's proxy records it;
- **followed**: B1's frozen scorer (lanes/delivery-route/detect.ts, unchanged), also among sessions that loaded;
- passes, cost, provider safety stops and B1's read audit, descriptive.

**Why a graded gstack-main session didn't load**, first that applies: hook log missing; hook did not name prove-it; line not delivered; loaded /verify instead; load failed; named, not loaded (the model wrote "prove-it" but never loaded it); never named. A project-file arm keeps B1c's reasons (block not placed; load failed; named, not loaded; never named). reasons.tsv lists every graded session that didn't load and every session that wasn't graded.

**The split** (gstack-main, from each session's own hook log): loads, /verify loads and neither, among sessions where the hook put prove-it alone, first of two, second of two, and not named.

**Strata**, descriptive, on the held-out set for all four arms and on the in-sample set for gstack-main: tasks the hook names prove-it on (by the keyless route table) against tasks it doesn't; `_interface` tasks against the rest; and prompt-length tertiles, ranking the tasks by prompt characters ascending with ties broken by task id, 20 a tertile.

## 9. Outcomes, reruns and gaps

B1's rules (B1's preregistration, section 7). A session is graded when it has a verifier reward and a model response reached the agent. A ledger cap stop is a cap stop. Anything else is infrastructure; it reruns once as attempt 2, and if that isn't graded the cell is a gap. A cap stop never reruns and ends its item incomplete; it is never rerun to change a reading. Provider safety stops keep their outcome class and are counted on their own line.

An arm reads INCOMPLETE when more than 6 of its 60 sessions are not graded, or when any session is a cap stop. The in-sample rule stays a point count against 39 whatever the number of graded sessions, so gaps only ever lower the count.

## 10. Reading

1. **In-sample.** INCOMPLETE first; then gstack-main's loaded count against 39. Reported beside it: the count with its Wilson 95% interval, first-call loads, /verify loads, the reasons, the split, gstack-main minus B1c's project-md rows in loads (paired, Newcombe), gstack-main minus B1's none arm in followed (paired), and the strata.
2. **Held-out.** Keyless coverage first (section 5); each arm's counts as above; gstack-main minus project-md in loads, which the disagreement rule reads; each of project-md and project-md-noescape minus gstack-main, with its band; project-md-noescape minus project-md (the escape clause's own effect); each gstack arm minus none in followed; the split and the strata.
3. **Decision**, in this order: in-sample INCOMPLETE; in-sample below 39; held-out INCOMPLETE; disagreement; rewrite, not cut; otherwise the block is cut. Then the R48 verdict from the held-out bands (section 1).

A result that goes to gstack's owner goes with both readings in plain words.

## 11. Power and the smallest detectable difference

power.txt computes every number here exactly.

**Odds of clearing the bar** on the in-sample 60, with each session the hook names prove-it on loading it at a follow rate f:

| f | named at f, unnamed at 0 | unnamed at 0.05 | second of two at f/2 |
|---|---|---|---|
| 100% | 1.000 | 1.000 | 0.063 |
| 99% | 0.939 | 0.975 | 0.044 |
| 98.3% | 0.857 | 0.937 | 0.035 |
| 96.7% (B1b's hook rate) | 0.613 | 0.797 | 0.019 |
| 95% | 0.399 | 0.633 | 0.011 |
| 93.3% | 0.242 | 0.476 | 0.006 |
| 90% | 0.080 | 0.243 | 0.002 |
| 85% | 0.012 | 0.070 | 0.000 |
| 80% | 0.001 | 0.016 | 0.000 |

So the hook clears the bar only if Opus follows it nearly every time, and almost never if it takes /verify on the two-name prompts.

**In-sample paired MDD.** Against B1c's rows as published (39 of 60), with every task at one true rate: 80% power to show the hook above the block at 84.9% (+19.9 points) and below it at 41.7% (-23.3 points). Under the coverage model above the true difference can't pass +1.7 points, so the interval will not show the hook above the block.

**Held-out MDD and the disagreement rule.** Two arms on the same 60 tasks, each task loading independently, with the block at B1c's 65%: the hook's shortfall that 60 paired tasks show (interval wholly below 0) with 80% power is 26 points. That is the disagreement rule's threshold. The rule reads the point estimate, so at a true shortfall of exactly 26 points it fires about half the time:

| hook's true rate (block at 65%) | P(hook shown below) | P(difference at or below -26, the rule) | P(hook shown above) |
|---|---|---|---|
| 97% | 0.000 | 0.000 | 0.999 |
| 80% | 0.000 | 0.000 | 0.450 |
| 65% | 0.025 | 0.001 | 0.025 |
| 50% | 0.386 | 0.112 | 0.000 |
| 39% (26 points short) | 0.821 | 0.511 | 0.000 |
| 30% | 0.975 | 0.858 | 0.000 |

**The noescape band.** With the hook at 80%, a noescape block that loads at 80% too reads "matches" 53.8% of the time and "middle" otherwise; at 90%, 97.0%; at 70%, 9.7%. So a rewrite verdict needs the noescape block to load clearly at the hook's level; a block only as good as the hook will often read "middle".

## 12. Admission

From data in hand: on the in-sample tasks B1b's hook-only install, naming prove-it on every prompt, loaded 58 of 60 and B1c's block 39, so the bar sits inside the range the routes have reached and the hook has room on either side of it. On the held-out set the block's expected rate (65%) leaves room both ways, and the no-gstack arm sits at 0. The in-sample reading is not at a ceiling the model reaches unaided: B1's none arm never loaded the skill, and B1's described-only skill loaded in 0 of 60.

## 13. Checks before the main run

Keyless, before this preregistration merged:

- `b1d arms check`: the three small tars rebuild byte for byte against their manifests (two of which are B1's and B1c's, copied byte for byte), the noescape block is B1b's with only the escape clause removed, and the gstack-main tar matches its manifest, with its route files at their gstack blobs, its four hook registrations and the seeded user (arms.txt).
- `b1d routes`: the route table on the 60 run and 10 calibration prompts, and with B1D_HELDOUT set, the held-out counts (route-table.tsv, heldout.txt). The smoke rule picks the two smoke tasks. The table fills the prompt wrapper as the rig does, with Python's str.replace, so one in-sample row, facelessuser__pymdown-extensions-2807, is 1523 characters rather than the 1755 that B1b's merged route table records from JavaScript's $-expanding replace, a prompt the rig never sent; at this pin the hook names prove-it alone on both.
- Eight scripted sessions in the real Claude Code 2.1.312 image against a stub model, through the rig's own agent code with the strip on (`b1d sessions run`, fixtures under tests/delivery-route/fixtures/b1d-sessions, sessions.txt). On gstack-main: a "Fix this bug:" prompt gets one hook line naming /prove-it alone, and a Skill load of prove-it reads as a load at the first call; a "Fix this bug and make the tests pass:" prompt gets the two-name line with /verify first, and a /verify load reads as "loaded /verify instead"; the plain prompt gets no line and the reason "hook did not name prove-it"; prove-it's preamble runs against gstack's real scripts (gstack-skill-start prints SKILL_START_PROTO: 1); and gstack's destructive-command check answers "ask" on `cd /testbed && git reset --hard`, which the rig's permission callback allows, so the reset runs unattended and leaves the tree clean. On project-md-noescape and project-md: the first request holds the block as the project CLAUDE.md, with and without the escape clause, the file is the block byte for byte and the last commit is gstack's routing commit on the snapshot. On none: Claude Code's plugin-authoring is the only skill listed. Each arm's listing size is in section 4 and sessions.txt; B1b's and B1c's arms listed 2 skills in 426 characters, as project-md and project-md-noescape do here.
- `b1d reuse`: both reuse checks pass at main (reuse.txt).
- `b1d plan` and `b1d power`: plan.txt and power.txt.
- Tests (tests/delivery-route/b1d.test.ts): the noescape block, the route table's counts and smoke rule, the bar at its edge with INCOMPLETE and a cap stop, every held-out stop and every R48 row, the reasons in order, the power numbers, the plans, caps, approval rows and launch guard, the pilot's pass rules per arm, both reuse checks, the session rows on captured sessions, and the eight captures, each also changed so a check must fail.

Paid, after merge and before any counted run: the pilot, which is the smoke item. Both smoke tasks run on all four arms, eight sessions, and each arm is checked on its own outputs; `b1d report --item b1d-smoke` prints a PASS or FAIL line per arm. Every arm needs both its sessions graded, or rerun to graded inside the item, which shows its tasks can be supplied, and no audit hit in either. Each arm must also show that its part under test ran. On gstack-main, both hook logs are copied and the hook named prove-it alone on the first task and nothing on the second, as the route table says. On project-md and project-md-noescape, the block was placed as the project CLAUDE.md in both sessions. none has no part beyond the absence of gstack, which the audit covers. A hand reading of all eight sessions agrees with the readers. No arm has a model judge, so there is no judge check.

An arm that fails its pilot is fixed or left out of the counted runs, and a left-out arm is reported as left out. It is never rerun quietly into a counted run: every failure goes to the Captain before the in-sample run, and a fix comes back as a dated change to this plan with its own pilot. Pilot sessions never enter a reading. The launch guard projects every item at the fixed planning rates in the Agent notes; the pilot's spend counts only in the all-in total. A relaunch after a lost part counts its item at its ledger spend, so the salvage it starts with is never refused for the item's cap. No pilot runs on sealed tasks, so the held-out list stays unseen: the held-out arms run the same task set on the same rig, every pool task ran on this rig in the harness mechanics eval (section 6), and `b1d reuse` shows the rig unchanged (section 7).

Before the results are written, at least four counted gstack-main sessions are read by hand from their transcripts, two that loaded and two that didn't where the run has them, and checked against the load detector, the /verify reader and the hook log.

## 14. Order and machines

b1d-smoke, the pilot (both smoke tasks on all four arms); then b1d-in's three parts of 20 (B1's 60 run tasks in draw order, gstack-main only); then b1d-ho's three parts of 80 (the held-out list in draw order, 20 tasks a part, all four arms of each task in its part). Each part runs in L1's seeded order with B1's seed. One awake host (standard-2) and one part VM (standard-16) at a time, under the shared project's free-capacity rule. Every VM is destroyed when its work ends.

## 15. Limits

- The primary is in-sample for routing: the matcher was tuned with these 60 prompts in view. The held-out set measures what the tuning bought, but the decision rule reads the in-sample count.
- The held-out pool can be listed from committed files; only the draw is sealed. Anyone who knew the pool could have tuned on all 89; nobody did, and the arm is a pinned tar built before the draw.
- The in-sample control is non-concurrent: B1c ran on 2026-11-18. The reuse check shows the rig unchanged and the model id is the same; a change on the provider's side under the same model id would not show. The held-out arms run side by side.
- The held-out comparison is gstack main as installed against B1c's block as B1c ran it, not the hook against the block on one install. gstack-main's listing holds 64 skills; the project-file arms' hold 2. The difference measures the two routes as each would reach a user, and cannot say how much of it comes from the listing.
- The rig allows every tool the model asks for. gstack's destructive-command check is on by default and answers "ask" on commands such as `git reset --hard`; in this rig those run, where an interactive user would be asked. gstack's two Stop hooks run as installed and may add turns.
- gstack is installed with --no-browser, so its browser binary isn't built; the browse skill is still listed.
- Paid sessions keep no request bodies, so each arm's listing and first request in the main run rest on the keyless sessions and the unchanged rig.
- One skill, one task family, one model, one harness. GPT-6.1 Sol and particle-1 are not run: the question is about Claude Code's hooks and skill listing, which the other models don't run under in this rig.
- Followed carries B1's scorer as merged, with its named holes (B1b's results, Limits). The primary does not use that scorer.

## 16. Departures from the brief, dated 2026-11-19, before any paid call

- **Two-name lines.** The brief checked the one-name hook line. At 5afef04 the hook also prints a two-name line, so the keyless checks, the route table, the readers and the split cover both forms, tested both ways (section 13).
- **In-sample label and the held-out set.** The primary keeps gstack's owner's bar on the 60, labelled in-sample for routing with its tuning history (section 5). The held-out set of 60, its four arms, its MDD and its disagreement rule are added (sections 1, 6 and 11).
- **The noescape arm.** Added on the held-out set, with the rewrite rule and the R48 wording in section 1. b1d-ho's cap went from $150 to $185 and the all-in stop from $300 to $340.
- **The smoke.** Two calibration tasks replace B1's smoke tasks, which the hook names nothing on (section 3).
- **The pilot.** Our eval rules now ask for a pilot before each arm's counted run: a small paid run that shows, on that arm's own outputs, that its part under test ran and its tasks can be supplied. The smoke item became that pilot for all four arms, eight sessions instead of two, with the pass rules in section 13. b1d-smoke's cap went from $20 to $50, so the recorded caps sum to $325; the all-in stop stays $340.
- **The commit cue** was checked against gstack at the pin and stays (section 4).
- **Strata** on the held-out set (section 8).
- **quick/laneb/arms/Dockerfile.** Its last step, which runs after the tar is written, moved setup's render folder aside and back unconditionally; a full-loadout setup renders nothing there, so the step now moves it only when it exists. No tar changes, and a lite setup's path is the same.

## Credits

gstack, its hooks, its matcher and the routing block are gstack's own (MIT, Copyright (c) 2026 Garry Tan), at 5afef04e31de1cb30c727c7f827bdd729d04713e. The Prove-It steps are from agent-skills by Addy Osmani (MIT, Copyright (c) 2025 Addy Osmani), at 39b723ceebf81474d0557c1fecd01eddab585563, carried in B1's gstack-shaped skill.

<details>
<summary>Agent notes</summary>

Money runs on the Lane B ledger, one item per run, each opened with its approval row at the cap below. A session reserves its allowance ($5) as it opens and settles at its metered cost; a refused reserve is a cap stop.

| Item | Sessions | Expected model spend | Open-session reserve | VM share | Formula cap | Recorded cap |
|---|---|---|---|---|---|---|
| b1d-smoke | 8 | 3.26 | 30.00 | 7.20 | 50 | 50 |
| b1d-in | 60 | 28.80 | 30.00 | 14.88 | 90 | 90 |
| b1d-ho | 240 | 97.80 | 30.00 | 14.88 | 180 | 185 |

Dollars. Expected spend is sessions at each arm's planning rate: gstack-main 0.48 (B1's measured mean for its gstack-shaped arm on Opus, above B1b's hook arm at 0.403, to cover the larger listing and gstack's full install), project-md and project-md-noescape 0.42 (B1c's measured 0.414, rounded up), none 0.31 (B1's measured none-arm mean). Each formula cap is ceil10(1.35 x expected + the open-session reserve + VM share): the reserve is the $5 allowance times the sessions that can be open at once (six, or fewer when a part holds fewer), and the VM share is the host's reserve for its TTL at 0.08 an hour plus each part VM's 4-hour blocks at 0.60 an hour (b1d.ts b1dCap; plan.txt). b1d-ho's recorded cap is the Captain's $185, above its formula. The recorded caps sum to 325. Before each launch the guard refuses when the item's projection passes its cap, when either reuse check fails (section 7), when the checkout holds uncommitted harness changes, or when every item's projection plus this lane's own counter passes 340 all-in; a refusal goes to the Captain.

</details>

## Disclosures

gstack is Garry Tan's own project.
