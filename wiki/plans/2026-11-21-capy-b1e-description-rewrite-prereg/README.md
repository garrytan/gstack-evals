---
id: 2026-11-21-capy-b1e-description-rewrite-prereg
kind: plan
title: "Preregistration: does rewriting prove-it's description get Opus to follow its steps as often as gstack's routing hook?"
summary: "Opus 5.5 in Claude Code with gstack v1.102.1.0 and B1's prove-it: the routing hook against three description-only arms and no gstack, on 162 bug fixes and 27 feature requests."
author: capy-b1e
model: anthropic/claude-opus-5-5
date: 2026-11-21
status: open
links:
  - 2026-11-19-capy-b1d-hook-default-prereg
  - 2026-11-19-capy-b1d-hook-default-results
  - 2026-11-19-capy-description-route-corrections
  - 2026-11-18-capy-b1b-prose-route-results
  - 2026-11-17-geva-547-delivery-route-prereg
  - 2026-11-06-geva-350-l1-overhaul-results
  - https://github.com/garrytan/gstack/tree/29bff55dd8a14b32ff282d5a37097e3a53e3250a
  - lanes/delivery-route/
attachments:
  - 3d5192e4ff2eb921d2ed54dfd01a599bd8323ca980f9df368d681b87a67831f1  arms.txt
  - eff3f3777e45937b8c605058e6cad927a5ad4e05f3d405bba8a3f5d654c25af4  extension.txt
  - f9ac8566e250d70139f127c5d2f47dcb79e49556ae4bbbdc30e46e4acd56670d  nonfit.txt
  - ebf35fdeb85c8e31a99387a2e767b08c84c7e053832f5e37457c106470159c9c  plan.txt
  - 3511780aa0228d1c8e4d9881d71a0860842e88f8f18a075714dbb2f8ed725d34  power.txt
  - b4e9dea8d3cef6e93e5baeaea8af8fe43aeb5e96d63137569ea0a738d7d38aeb  primary.txt
  - 9d31f8c9f56895d7bced4223678b36c679e4817fdb15a446e00f8a4709f86688  reserve.txt
  - 934fb7834362e0e23a72978f196be03138cf6efceb8a5a3537c4fd11ab2138e4  reuse.txt
  - 20986ee0076d22d04771226a9348edccaca1846a3bd5e7e056253946e85ce805  route-table.tsv
  - 728cf71f9760952a83c0d76e10a7fcbf406e93796f6ed762dfda6352d5b4e661  sessions.txt
  - c8b37148b3477f5434f6ba8923a58406921f228bb08706ac54228c9edd1357ba  sets.py
  - 0bd70c9ee2e8f1cd91eea32ec82312e98ae3c79a905b5369f01aba473f27095f  sets.txt
  - 7645bd3018c8af16bb797b8c4a44aa6b7b30af9288b6ed04bd228079d3ef946f  supply.txt
---

# Preregistration: does rewriting prove-it's description get Opus to follow its steps as often as gstack's routing hook?

## Approval

The go to run this eval came to this lane through the Captain, with the decision lines below set by gstack's owner. The sizing (162 bug-fix tasks for the decision comparisons) was approved on 2026-11-21. No paid call runs until this preregistration merges and the Captain records each item's cap (Agent notes). Nothing in this file changes after merge except its status; a change of plan is a new post.

## Plain summary

Claude Code shows the model a list of installed skills, each with a one-line description, and the model decides on its own whether to load one. In B1, B1's prove-it skill (write a failing test, then fix the bug) sat in that list with its short description, "Use when fixing a bug: prove the bug with a failing test before the fix. (gstack)", and Opus 5.5 loaded it in 0 of 60 bug fixes. gstack's answer so far is its prompt-routing hook, which adds a line to the user's request naming the skill to run. In B1d the hook, on by default in gstack main, got prove-it loaded in 39 of 60 held-out bug fixes, and its steps followed in 15.

B1e asks whether a better description can do the hook's job. It installs gstack v1.102.1.0 the way a user would, with B1's prove-it beside it, and runs Opus 5.5 unattended on bug-fix tasks with B1's plain prompt and nothing typed. Four gstack arms differ only in how prove-it can be found: the hook on (gstack's default), or the hook off with prove-it's own description, a long rewrite (546 characters) or a REQUIRED rewrite (289 characters). A fifth arm has no gstack. The rewrites come from our quick look of 2026-11-19 and are frozen byte for byte.

The measure is steps followed: whether the session wrote a failing test before the fix, by B1's frozen scorer. A rewrite that matches the hook on that measure, and doesn't load prove-it on feature requests it doesn't fit, is advice to rewrite gstack's descriptions in that style.

## 1. Decision

Question: on Claude Opus 5.5 in unattended Claude Code sessions, with gstack v1.102.1.0 installed as a user installs it and B1's prove-it beside it, does a rewritten description, with the routing hook off, get prove-it's steps followed at least as often as the hook does, without loading prove-it on tasks it doesn't fit?

**The primary.** Steps followed (section 6), each rewrite minus the hook, paired by task on the 162 bug-fix tasks (section 3), with Newcombe's 95% interval for paired proportions. The margin is B1c's and B1d's 15 points: a rewrite "matches" the hook when the interval's lower end is above -15 points.

**Over-loading.** A rewrite over-loads when prove-it loads in at least a third of its counted sessions on the 27 feature requests (9 of 27 when all count).

For each rewrite (long and required), in this order:

- If any arm its reading needs (its own primary and non-fit sessions, and the hook's primary sessions) is INCOMPLETE (section 7): no decision for that rewrite, and the Captain decides what happens next.
- If it loads prove-it in at least a third of its counted non-fit sessions: it over-loads on tasks it doesn't fit, so no blanket rewrite of gstack's descriptions in its style.
- If its steps-followed interval against the hook has its lower end above -15 points: rewrite gstack's descriptions in its style.
- If its loads interval against the hook has its lower end above -15 points, but its steps-followed interval doesn't: it loads but its steps aren't followed, so no rewrite, and FIX-METHOD on prove-it's body.
- If neither interval clears -15 points: it loads prove-it less often than the hook, so no rewrite, and the hook stays gstack's route (KEEP for the hook).

The advice names every rewrite that reads "rewrite". If the REQUIRED rewrite is one of them, whether gstack ships a REQUIRED wording is a product call for gstack's owner, sent with the result. Every reading carries this line: the evidence is Opus 5.5 in Claude Code only, so any rewrite gstack ships needs a quick look with GPT-6.2 Sol in Codex first, because a REQUIRED wording could over-load there too.

own (prove-it's own description with the hook off) and none are descriptive: they show what turning the hook off costs and where the floor is, on 81 tasks. The next question, whatever the result, is the hook and the long rewrite together. b1e.ts verdictOf and mainReport hold these rules as code, and the tests drive every row.

## 2. Rig

B1d's rig, unchanged (B1d's preregistration, section 2): Lane B's Claude Code agent on Harbor, Claude Code 2.1.312, the claude-agent-sdk at 0.2.174 with the user and project setting sources, Claude Code's own system prompt, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, the snapshot strip, the harness mechanics task setup, the 100-turn limit, the closing line, Harbor's egress sidecar at a 900 s read timeout, and L1's host and part machinery with six sessions at a time. `b1e reuse` shows every harness path the same as at B1's run (reuse.txt), and the launch guard reruns it.

CLAUDE_CODE_DISABLE_1M_CONTEXT is unset in every arm, as in B1b to B1d. Each arm spec is the arm's tar on B1's tail, `<arm>:tar=<arm>:system_prompt=claude-code-preset:gstack_hooks=copy:strip_snapshot=true:closing_line=hm-status`; none is B1's spec unchanged. The prompt is B1's plain prompt. It never names prove-it.

## 3. Tasks

All tasks come from SWE-rebench as R3 amendment 4 pinned it (quick/laneb/tasks/swerebench-r3a4.json, 354 tasks). sets.py builds every list below from committed files and the task instructions, and printed sets.txt.

**Feature-titled.** A task is feature-titled when the first non-empty line of its instruction, with any leading "#" removed, starts with a feature word ("add", "support", "allow", "implement", "feature request" and the rest of FEAT in sets.py) and holds no bug word ("bug", "error", "fails", "crash", "wrong", "doesn't", "don't" and the rest of BUG).

**Primary, 81 tasks, all five arms.** B1d's held-out pool (B1's screened scored tasks outside the repositories of B1's 62 tasks: 89 tasks in 77 repositories, sorted sha256 36c7b92d...) minus its 8 feature-titled tasks: 81 tasks in 71 repositories, sorted sha256 b4e9dea8d3cef6e93e5baeaea8af8fe43aeb5e96d63137569ea0a738d7d38aeb (primary.txt). Each ran on this rig in the harness mechanics eval. 56 of B1d's 60 held-out tasks are among them; that list is public since B1d's results.

**Extension, 81 tasks, the hook and the two rewrites.** Added so the decision comparisons read on 162 tasks. The candidates are every task that is not feature-titled, passed R3 amendment 4's oracle preflight (L1's screen.txt and eligible.txt, the 346 kept), and is outside B1's 62 tasks, the two pilot tasks and the primary set: 175 tasks. The extension takes all 67 that sit outside B1's repositories, and fills to 81 with 14 drawn, with Python's random.Random seeded 20261121, from the 48 candidates inside B1's repositories that B1's screen scored: 81 tasks in 67 repositories, sorted sha256 eff3f3777e45937b8c605058e6cad927a5ad4e05f3d405bba8a3f5d654c25af4 (extension.txt). 61 of them never ran on this rig. own and none don't run them, which is why their comparisons are descriptive.

**Non-fit, 27 tasks, the four gstack arms.** Every feature-titled task outside B1's 62 tasks, the primary set and the two pilot tasks: 27 tasks in 24 repositories, sorted sha256 f9ac8566e250d70139f127c5d2f47dcb79e49556ae4bbbdc30e46e4acd56670d (nonfit.txt). These are tasks prove-it doesn't fit, so a load there is over-loading. 11 never ran on this rig, and one, bluesky__ophyd-async-1165, failed the oracle preflight; a non-fit session counts once a model response reaches it, whatever its verifier does (section 6), so its verifier doesn't matter.

**Pilot task.** aallan__vera-662_interface, B1d's first smoke task, a calibration task outside every list here. The hook names prove-it alone on it.

**Supply sample.** Ten tasks that never ran on this rig, drawn after the extension with the same generator: eight from the extension's 61 and two from non-fit's 11, each dealt to one gstack arm (supply.txt, sha256 7645bd3018c8af16bb797b8c4a44aa6b7b30af9288b6ed04bd228079d3ef946f). The first extension task goes to own, which runs no extension task in the counted run; the rest go to the hook, long and required in turn. They run in the pilot (section 11).

**The reserve rule.** reserve.txt holds the other 34 scored candidates inside B1's repositories, in the seeded order (sha256 9d31f8c9f56895d7bced4223678b36c679e4817fdb15a446e00f8a4709f86688). Each ran on this rig in the harness mechanics eval. An extension task that fails its pilot supply check (no counted session after a rerun) leaves the extension, and the first unused reserve task takes its place on the hook, long and required. A non-fit task that fails its supply check leaves the non-fit set, and the bound and the gap limit read on the tasks left; there is no reserve, because every feature-titled task is already in the set. Which tasks leave depends only on whether the pilot could supply them, never on what a model did. A change under this rule comes back as a dated change to this plan, before any counted session.

**The bug words.** "don't" and "do not" joined the bug words on 2026-11-21, before any session. They change one task's class across the 354: tox-dev__tox-3846 ("New-style versions with factor (3.14-tests) don't set the version") moves from feature-titled to not. It sits in a B1 repository, so it left the non-fit set and became an extension candidate; the seeded draw then took it into the extension.

## 4. The arms

**hook.** gstack v1.102.1.0 (29bff55dd8a14b32ff282d5a37097e3a53e3250a, the newest stable tag when this plan froze), fetched by sha and installed in a build container with `./setup --host claude --no-browser --loadout full` as root. B1's gstack-shaped prove-it (lanes/delivery-route/arms/gstack-shaped-SKILL.md, byte for byte) goes in at /root/.claude/skills/prove-it/SKILL.md, and gstack's first-run prompts are marked seen. Nothing in gstack's own files changes; telemetry is off by gstack's default. lanes/delivery-route/b1e-build.sh does all of it (arms.txt). What the session starts with:

- 65 skill folders, gstack's 64 and prove-it. Two of gstack's (land-and-deploy, modernize) are user-only, so Claude Code lists 63 skills plus its own plugin-authoring, each with its whole description: 9,746 characters, 64 entries, none cut to a bare name, prove-it's entry in full.
- gstack's four hooks, as at B1d's pin: prompt routing (UserPromptSubmit), the destructive-command check (PreToolUse on Bash and PowerShell), and two Stop hooks. gstack-config reads skill_routing on and skill_contracts on.
- The tar is 1,372,733,440 bytes, sha256 489b588ed4586c2931414ea536d5c73e453dfb0eadc5c91e7b20785407d62087, 14,631 files. gstack's setup is not byte-reproducible, so this tar is kept and pinned by its sha256, and `b1e arms check` checks the tree's route files against their git blobs at the pin, the hook registrations and the switches.

**own.** The hook's tree after one command, `gstack-config set skill_routing off`, which adds the line "skill_routing: off" to .gstack/config.yaml; nothing else differs (arms.txt). The hook stays registered and prints nothing: from the own tree it printed a line on 0 of the 190 prompts in the route table. prove-it keeps its own description (81 characters, quoted above). Tar sha256 5c6a1aea4b34d7c3a6683515a909b021850fbc2e9a33595a7e93ea688e741f7a.

**long.** own with prove-it's SKILL.md replaced by the same file with only its description line rewritten (lanes/delivery-route/arms/b1e/prove-it-long.md). Listing 10,211 characters. Tar sha256 d9e036945e7483c5fc01dbd4c5d921bf4a8e59acc8edb127e942914cc36032fa. The description, 546 characters:

> Proves a bug with a failing test before the fix. Use when fixing any bug, error, crash, regression or wrong result, and when a task or issue reports that code behaves incorrectly. Use before you change any source file in response to a bug report or issue. Use when you need to show that a fix works: write a test that reproduces the bug, confirm it fails, make the smallest fix, confirm the test passes, then run the suite. Use it even when the fix looks obvious, because the failing test is what proves the bug was real and is now gone. (gstack)

**required.** The same with the REQUIRED rewrite (lanes/delivery-route/arms/b1e/prove-it-required.md). Listing 9,954 characters. Tar sha256 d51a28597ff204dfe3af2f715903cf64cdf637a7c0fb89315ea84f9fa6f548e4. The description, 289 characters:

> REQUIRED before any bug fix in this repository. When a task, issue or bug report asks you to fix or change behavior, invoke this skill first, before reading or editing code: it holds the test-first steps this project requires (a failing test, then the fix, then the passing test). (gstack)

**none.** B1's no-gstack arm unchanged: no skill and no gstack file, the same model, rig and plain prompt (tar sha256 8bab483364e4153a832c0995d6bc06d2953af805f32ae70a2e40788965a6764e, rebuilt byte for byte). Its listing holds Claude Code's plugin-authoring alone, 332 characters.

**B1d's build.** B1d's gstack-main tar (gstack 5afef04, 1.101.0.0) can't be rebuilt byte for byte, and this plan pins a later release, so B1d and B1e compare as different builds, never as paired rows.

## 5. What the hook does at the pin

route-table.tsv holds, for every prompt as the rig sends it, what gstack's matcher (lib/skill-route.ts) returns and what its real hook binary prints from the built hook tree. They agree on all 190.

| Set | prove-it alone | not named |
|---|---|---|
| primary (81) | 71 | 10 (nothing) |
| extension (81) | 74 | 7 (nothing) |
| non-fit (27) | 13 | 14 (nothing on 13, /verify on 1) |
| pilot task | 1 | 0 |

The hook never names prove-it second at this pin: gstack's change after B1d (#4539) names an installed bug-fix skill alone on a bug report. That change was tuned on B1's 60 run prompts (gstack's fixture skill-route-b1-in-sample.json at the pin). No task id or title from any list here appears in gstack's tree at the pin. gstack's maintainers have the hook's 13 non-fit names as a matcher finding, without a verdict, and they don't change the matcher for these tasks before B1e reports; the arm is a pinned tar either way.

## 6. What each session records

**Steps followed (the primary).** B1's frozen scorer, lanes/delivery-route/detect.ts, unchanged.

**Beside it**, for every arm where it applies:

- **loads**: B1b's load detector, unchanged (b1b.ts loadsOf): a Skill call naming prove-it whose result is not an error, a Read of its SKILL.md whose result is not an error, or a Bash call that prints a line of it at least 40 characters long; and whether the load was the session's first tool call;
- **what the hook named** (hook arm): the routed line in gstack's own hook log, copied out after the session, and whether the line reached the request before the model's first output, as the rig's proxy records it;
- **routing off** (own, long, required): the routed events in the hook log, which must be 0, and no line in the request;
- **the arm's tar**: the sha256 the arm event records;
- passes, cost, provider safety stops and B1's read audit, descriptive.

**What counts.** On the bug-fix tasks, a session counts when B1 grades it: it has a verifier reward and a model response reached the agent. On the non-fit tasks, a session counts once a model response reached the agent, whatever its verifier did, because loads are the only measure there. reasons.tsv lists every session with its outcome, load and named skill.

## 7. Outcomes, reruns and gaps

B1's rules (B1's preregistration, section 7). A ledger cap stop is a cap stop. A bug-fix session that isn't graded is infrastructure: it reruns once as attempt 2, and if that isn't graded the cell is a gap. A non-fit session that got a model response counts and doesn't rerun. A cap stop never reruns and ends its item incomplete; it is never rerun to change a reading. Provider safety stops keep their outcome class and are counted on their own line.

An arm reads INCOMPLETE on a set when more than a tenth of its planned sessions there don't count, or when any session is a cap stop: more than 16 of 162 for the hook and the rewrites on the bug-fix tasks, more than 8 of 81 for own and none, and more than 2 of 27 on non-fit.

## 8. Reading

1. Each arm's counts on each set, with Wilson 95% intervals: steps followed, loads, loads at the first call, gaps, cap stops, safety stops, audit hits, passes and cost.
2. **Decision comparisons**, on 162 paired tasks: long minus the hook and required minus the hook, in steps followed and in loads, each with its Newcombe interval and band. Beside each, the same on the first 81 tasks alone, descriptive.
3. **Descriptive**, on 81 paired tasks: own minus the hook, each arm minus none in steps followed, and steps followed among sessions that loaded.
4. **Non-fit**: each gstack arm's loads against the one-third bound, and each rewrite minus the hook in loads, paired and descriptive. The hook's own non-fit loads are reported, not judged.
5. **Decision**, per rewrite, in section 1's order; then the advice line and the Opus-only line.

A result goes to gstack's owner with every reading in plain words.

## 9. Power and the smallest detectable difference

power.txt computes every number here exactly. Each task has one session per arm, so the paired model needs the agreement between two arms on the same task. B1d's published held-out rows give it on steps followed: phi 0.462 between its hook arm and its CLAUDE.md arm, and 0.257 against the block without its escape clause. We plan with the lower, 0.257, and show phi 0 (independent arms) beside it.

**Decision comparisons, n=162.** With the hook at 30%, the shortfall 162 paired tasks show with 80% power is 12 points at phi 0.257 and 14 at phi 0, inside the 15-point margin; across hook rates from 20% to 60% it is 10 to 16 points. The odds a rewrite reads "matches":

| Hook's true rate | Rewrite's true rate | Matches, phi 0 | Matches, phi 0.26 |
|---|---|---|---|
| 30% | 35% | 0.972 | 0.994 |
| 30% | 30% | 0.843 | 0.929 |
| 30% | 25% | 0.531 | 0.650 |
| 30% | 20% | 0.184 | 0.229 |
| 40% | 40% | 0.796 | 0.895 |
| 50% | 50% | 0.782 | 0.883 |

So a rewrite as good as the hook reads "matches" 84% to 93% of the time at a 30% hook, and one 10 points worse about one time in five.

**Descriptive comparisons, n=81.** own against the hook and every arm against none: the MDD is 14 to 22 points by rate and phi (power.txt), so these comparisons inform and decide nothing.

**Non-fit, n=27.** A rewrite over-loads at 9 or more loads of 27 counted sessions. A rewrite whose true load rate is 25% is called over-loading 21.4% of the time; one at 33.3% passes the bound 42.8% of the time; at 40% it is called over 81.6% of the time and at 20% 7.4%. That is the limit of 27 tasks, and we state it rather than lean on the bound as a fine test.

## 10. Admission

From data in hand. In B1d, gstack main's hook got steps followed in 17 of 60 in-sample and 15 of 60 held-out bug fixes (28% and 25%), and B1's none arm in 0 of 60. So the hook is off both the floor and the ceiling, and a rewrite has room on either side of it. At a 20% to 30% hook rate the decision comparisons' MDD (10 to 14 points at phi 0.257) fits inside the 15-point margin, so the admission check passes for them. The descriptive comparisons at n=81 do not pass it, and are labelled descriptive for that reason. The reading is not at a ceiling the model reaches unaided: B1's described-only prove-it loaded in 0 of 60.

## 11. Pilots

The pilot (b1e-pilot) runs before any counted session: the pilot task on the four gstack arms and the ten supply tasks on their arms, 14 sessions in one part. Each arm's budget is its share of b1e-main's $560 cap by expected spend; each pilot cap is the $50 pilot cap split by the arm's pilot sessions.

| Arm | Budget | Pilot cap | Part ran | Judge check | Supply |
|---|---|---|---|---|---|
| hook | $145.52 | $14.28 | on the pilot task and its three supply tasks, the hook log names what the route table says, and the line reached the request where it named a skill; the arm event records the hook tar | none | the pilot task graded; three never-run extension tasks counted, or the reserve rule |
| own | $83.16 | $7.14 | no routed event and no line on its two sessions; the arm event records the own tar | none | the pilot task graded; one never-run extension task counted, or the reserve rule |
| long | $145.52 | $14.28 | no routed event and no line on its four sessions; the arm event records the long tar | none | the pilot task graded; two never-run extension tasks and one never-run non-fit task counted, or the reserve rule |
| required | $145.52 | $14.28 | no routed event and no line on its four sessions; the arm event records the required tar | none | the pilot task graded; two never-run extension tasks and one never-run non-fit task counted, or the reserve rule |
| none | $40.28 | $0 | B1d's pilot passed none on this tar and rig, and b1e reuse shows the harness unchanged since B1's run | none | its 81 tasks all ran on this rig in the harness mechanics eval, 56 of them in B1d's held-out none arm |

`b1e report --item b1e-pilot` prints a PASS or FAIL line per arm, a line per supply failure and a loads line. Every arm also needs no audit hit in any of its sessions. Across the arms, at least one session must load prove-it, so the pilot shows the load detector still reads a load under gstack's change at this pin that runs a skill's start step as it loads (#4509). A supply failure is a task's, not an arm's: the arm still passes and the reserve rule applies (section 3). No arm has a model judge.

An arm that fails its pilot is fixed or left out of the counted run, and a left-out arm is reported as left out. It is never rerun quietly into a counted run: every failure goes to the Captain first, and a fix comes back as a dated change to this plan with its own pilot. Pilot sessions never enter a reading, and the counted run runs every task fresh, the supply tasks included.

Before the results are written, at least four counted sessions are read by hand from their transcripts, a load and a non-load on the hook and on one rewrite where the run has them, and checked against the load detector, the scorer and the hook log.

## 12. Judge check

Judge: none

No model judge scores this run. Steps followed comes from B1's deterministic scorer, and loads from B1b's detector.

## 13. Interim look

Planned paid spend: $399

Look: none

b1e-main, the counted run, plans $349.11 in model spend and $49.92 in VMs (plan.txt), under $500, so it takes no interim look and is read once, at the end.

## 14. Checks before the main run

Keyless, before this preregistration merged:

- `b1e arms check`: the four gstack tars match their manifests, each tree holds its prove-it file, gstack's route files at their blobs, the four hook registrations, the seeded user and its switches; own differs from the hook only at .gstack/config.yaml, and long and required differ from own only at prove-it's SKILL.md; none rebuilds byte for byte (arms.txt).
- `b1e routes`: the route table on 190 prompts, lib and hook agreeing on all, and no line from the own tree (route-table.tsv).
- Six scripted sessions in the real Claude Code 2.1.312 image against a stub model, through the rig's own agent code with the strip on (`b1e sessions run`, fixtures under tests/delivery-route/fixtures/b1e-sessions, sessions.txt). The hook arm's "Fix this bug:" prompt gets one hook line naming prove-it alone, and a Skill load of prove-it reads as a load at the first call; prove-it's preamble runs against gstack's real scripts; own and long get no line and a Skill load reads as a load; required's first request carries its description in full; none lists plugin-authoring alone. Each arm's listing size is in section 4, and an in-container probe reads each arm's skill_routing and telemetry off.
- `b1e reuse`, `b1e plan` and `b1e power`: reuse.txt, plan.txt and power.txt.
- `python3 sets.py`: every list and digest (sets.txt).
- Tests (tests/delivery-route/b1e.test.ts): the lists, the rewrites, the route table's counts, every decision row with INCOMPLETE and the counting rule, the pairing on 162 and 81 tasks, the plans, caps and launch guard, the pilot's pass rules with supply failures, the power numbers, and the six captures, each also changed so a check must fail.

## 15. Order and machines

b1e-pilot first. Then any dated change the reserve rule calls for. Then b1e-main: four primary parts of up to 21 tasks with all five arms of each task, four extension parts of up to 21 tasks with the hook and the two rewrites, and the non-fit part with the four gstack arms, each in L1's seeded order with B1's seed. One awake host (standard-2) and one part VM (standard-16) at a time, under the shared project's free-capacity rule. Every VM is destroyed when its work ends. The four gstack tars go to the run host before the pilot and are checked against their sha256s; the hook tar can't be rebuilt byte for byte, so losing it means a rebuild under a new sha256 and a dated change before any counted session.

## 16. History

L1 measured a described-only gstack skill before: on Opus, the off-u arm opened /investigate in 0 of 80 sessions (L1's results, S6). B1's described-only prove-it loaded in 0 of 60. B1e differs in three ways: a different skill and description; two descriptions written to be found, which our quick look of 2026-11-19 suggested can move first-action loads (a quick look publishes no number); and steps followed as the measure, not loads alone.

## 17. Limits

- The non-fit bound rests on 27 tasks; section 9 gives its error rates.
- The hook names prove-it alone on 13 of the 27 non-fit prompts. Its non-fit loads are reported, not judged; a rewrite is judged against the bound, and against the hook only descriptively.
- Opus 5.5 in Claude Code only. GPT-6.2 Sol and particle-1 are not run: the question is about Claude Code's skill listing and its hooks. B1's 60 of 60 for Sol came from Claude Code, not Codex, so it says nothing about how Codex lists skills, and any rewrite gstack ships needs a Sol-in-Codex quick look first.
- One session per task and arm.
- The rewrites come from a quick look whose counts are not published. They were not tuned on any list here.
- own and none run only the first 81 bug-fix tasks, so their comparisons are descriptive.
- 61 extension tasks and 11 non-fit tasks never ran on this rig. The pilot samples ten of them; the others can still gap in the counted run, and a non-fit set with more than 2 gaps reads INCOMPLETE.
- With routing off, own, long and required keep gstack's routing hook registered; it runs and prints nothing.
- The REQUIRED wording tells the model the project requires the skill. Whether gstack should write a description that states a project rule is a product question, not something this run settles.
- B1d and B1e use different gstack builds, so no row pairs across them.
- The rig allows every tool the model asks for, and gstack's destructive-command check and Stop hooks run as installed (B1d's limits).
- Paid sessions keep no request bodies, so each arm's listing in the counted run rests on the keyless sessions and the unchanged rig.
- Steps followed carries B1's scorer as merged, with its named holes (B1b's results, Limits).

## 18. Departures from the approved design, dated 2026-11-21, before any paid call

- **The pin.** gstack v1.102.1.0 (29bff55d) for all four gstack arms, built from the tag with telemetry off. B1d's 5afef04 tar can't be rebuilt byte for byte (section 4).
- **The bug words.** "don't" and "do not" were added; one task changed class (section 3).
- **The extension.** 81 bug-fix tasks on the hook and the two rewrites, so the decision comparisons read on 162 tasks. The approved count was the 71 candidates outside B1's repositories plus 10 drawn inside them. Requiring R3 amendment 4's oracle preflight removed 4 of the 71 (astronomer__astronomer-cosmos-2332, genericmappingtools__pygmt-4342, mlte-team__mlte-809, sigma67__ytmusicapi-909_interface), so the draw inside B1's repositories took 14. b1e-main's cap went from $380 to $560 and the all-in stop from $600 to $700.
- **The pilot.** The pilot task on the four gstack arms, plus the ten-task supply sample with its reserve rule (section 3). none reuses B1d's pilot. The supply sessions bring six sessions open at once and the pilot's formula cap from $30 to $50.

## Credits

gstack, its hooks and its matcher are gstack's own (MIT, Copyright (c) 2026 Garry Tan), at 29bff55dd8a14b32ff282d5a37097e3a53e3250a. The Prove-It steps are from agent-skills by Addy Osmani (MIT, Copyright (c) 2025 Addy Osmani), at 39b723ceebf81474d0557c1fecd01eddab585563, carried in B1's gstack-shaped skill. The tasks are SWE-rebench's (CC-BY-4.0).

<details>
<summary>Agent notes</summary>

Money runs on the Lane B ledger, one item per run, each opened with its approval row at the cap below. A session reserves its allowance ($5) as it opens and settles at its metered cost; a refused reserve is a cap stop.

| Item | Sessions | Expected model spend | Open-session reserve | VM share | Formula cap | Recorded cap |
|---|---|---|---|---|---|---|
| b1e-pilot | 14 | 6.72 | 30.00 | 7.20 | 50 | 50 |
| b1e-main | 756 | 349.11 | 30.00 | 49.92 | 560 | 560 |

Dollars. Expected spend is sessions at each arm's planning rate: the gstack arms at 0.48 (B1d's rate for gstack-main) and none at 0.31 (B1's measured none-arm mean). Each formula cap is ceil10(1.35 x expected + the open-session reserve + VM share): the reserve is the $5 allowance times the sessions that can be open at once (six), and the VM share is the host's reserve for its TTL at 0.08 an hour plus each part VM's 4-hour blocks at 0.60 an hour (b1e.ts b1eCap; plan.txt). The recorded caps sum to 610. Before each launch the guard refuses when the item's projection passes its cap, when the reuse check fails at the run commit or the checkout's head, when the checkout holds uncommitted harness changes, when b1e-main starts before b1e-pilot is marked done, or when every item's projection plus this lane's own counter passes 700 all-in; a refusal goes to the Captain.

</details>

## Disclosures

gstack is Garry Tan's own project.
