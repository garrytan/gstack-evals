---
id: 2026-11-21-capy-b2-test-first-prereg
kind: plan
title: "Preregistration: does following test-first steps fix more bugs? B2 on Opus 5.5, GPT-6.2 Sol and particle-1"
summary: "183 SWE-rebench tasks, four arms (no gstack, a one-line test-first instruction, gstack alone, gstack with prove-it typed), three models. Primaries: passes, and passes that ship a regression test."
author: capy
model: anthropic/claude-opus-5-5
date: 2026-11-21
status: open
links:
  - 2026-11-17-geva-547-delivery-route-prereg
  - 2026-11-18-geva-548-delivery-route-results
  - 2026-11-19-capy-description-route-corrections
  - 2026-11-19-capy-b1d-hook-default-results
  - 2026-11-19-geva-562-codex-hooks-prereg
  - 2026-11-17-geva-545-agent-skills-category-map
  - https://github.com/garrytan/gstack/tree/29bff55dd8a14b32ff282d5a37097e3a53e3250a
  - https://github.com/addyosmani/agent-skills/tree/39b723ceebf81474d0557c1fecd01eddab585563
  - lanes/delivery-route/
attachments:
  - 945a93e5858a674780010323b13b82f28349286bcb9c86dbd94977dbeda4c811  draw.py
  - 1a8f0a63c8e7fafdac3c2beb7190f4e8d688826b407d96c74b21249735f37025  draw.txt
  - ef74c5c64f6fe50d0d462af450ef65a082476b3d250df8e576de5e337f0cf886  hm-screened.txt
  - 69c13a1bfdc45d93ed3fc68d745544c15e7e7ecff6a53385d8b35151fd8324a5  power.py
  - f4884baeee32253c095d0900ec76d842f10f15856bc41e1baa0677d36584d645  power.txt
  - fd5c70d89e2d2fe8ba9575ceba3b51a38dd4480ae42206166f2f427b89ca7c53  tasks.txt
---

# Preregistration: does following test-first steps fix more bugs? B2 on Opus 5.5, GPT-6.2 Sol and particle-1

## Approval

The project owner approved running B2 on 2026-11-20, at the size the design post priced, through the gstack-evals Captain. No paid call runs until this preregistration merges and the Captain records each item's cap (Agent notes). Nothing in this file changes after merge except its status; a change of plan is a new post or a dated pre-data change on the results branch.

## Plain summary

B1 showed that when a coding agent is handed agent-skills' Prove-It steps (write a failing test, see it fail, fix, see it pass), it follows them: Claude Opus 5.5 went from 0 of 60 bug fixes to 46 of 60 with the steps typed as a gstack-shaped skill. B1 did not ask whether following them helps. B2 does.

We run 183 SWE-rebench tasks four ways on each of three models. The agent gets no gstack and no steps; or one line in its instructions file asking it to write a failing test first; or gstack installed, with nothing typed; or gstack installed with the prove-it skill typed in front of the task, the route B1 found works. We count two things: how many tasks pass the hidden tests, and how many pass with a regression test in the fix. The main comparison is gstack with prove-it against gstack alone, so the only difference is the test-first procedure. The no-gstack arm sits beside it.

What it decides: whether gstack strengthens, keeps or cuts the way it hands bug fixes a test-first procedure today (its routing hook names an installed bug-fix skill on bug reports, and its CLAUDE.md block's bug line asks for a focused failing test first when the cause is unclear). What it doesn't decide: which route delivers a procedure best (B1, B1b to B1e), or whether test-first helps on feature work.

## Decision

Read on the pooled contrast over the three models, gstack with prove-it minus gstack alone (section 9), in this order. The first row that applies is the reading.

| Result | What gstack does |
|---|---|
| INCOMPLETE: Opus 5.5 or GPT-6.2 Sol INCOMPLETE (section 8) | No reading. gstack changes nothing, and the result goes to the Captain with what is missing. |
| The procedure gate fails (section 6.3): the procedure didn't reach the sessions | No reading on outcomes. FIX-METHOD on exposure; gstack changes nothing. |
| Passes below 0, or passes with a regression test below 0 | Test-first costs fixes. CUT-CANDIDATE: gstack drops the routing hook's bug-report rule (it names an installed bug-fix skill on bug reports) and the "focused failing test first" clause of its CLAUDE.md bug line. The owner hears it in plain words. |
| Passes above 0 | Test-first fixes more bugs. KEEP and strengthen: gstack ships its own prove-it skill and keeps routing bug reports to it. If prove-it minus the one line on passes is also above 0 (section 9), the procedure ships as that skill; otherwise gstack ships the one line in its CLAUDE.md block and Codex AGENTS.md text in place of its bug line, and no new skill. |
| Passes not shown either way, and passes with a regression test above 0 | Test-first leaves the same number of fixes and more of them carry a test. KEEP as it is: the routing rule and the bug line stay, gstack doesn't ship its own skill, and its docs claim tests, not fixes. |
| Neither shown | A null. One "Why null?" cycle (section 9.4), then CUT-CANDIDATE for the same two parts, unless the cycle finds an exposure, task-fit or power cause (FIX-METHOD), or a ceiling (FIX-METHOD once, with one attempt to raise it, R61). |

If passes are above 0 while passes with a regression test are below 0, the reading is not made by the table: the result goes to the Captain with both contrasts.

"Above 0" and "below 0" for passes use the group-sequential bounds of the interim look (2.917 at the look, 2.068 at the end); for passes with a regression test, |z| of at least 2.576 at the end of a run that went past the look (section 9).

Beside every reading the report prints, from the same table: prove-it minus none (the no-gstack arm, R44), gstack minus none, the one line minus none, and each model on its own. When the pooled reading is a KEEP and Opus 5.5's or GPT-6.2 Sol's own passes interval lies wholly below 0, the reading names that model in the same line.

## 1. Question

On Claude Opus 5.5 in Claude Code, GPT-6.2 Sol in Codex CLI and particle-1 in Claude Code, does a coding agent that is handed a test-first procedure for a bug fix pass more of the task's hidden tests, and ship more passing fixes that carry a regression test, than the same agent without it?

## 2. Rig

**Claude Code (Opus 5.5 and particle-1).** B1's rig, unchanged (2026-11-17-geva-547-delivery-route-prereg, section 2): Lane B's Claude Code agent on Harbor, Claude Code 2.1.312, the claude-agent-sdk pinned at 0.2.174, Claude Code's own system prompt, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, the snapshot strip (auto-loaded instruction files, AGENTS.md at any depth and any project .claude folder removed from the task's tree before the session), the harness mechanics eval's task setup, its 100-turn limit, B1's plain prompt and closing line ("When you finish, end your final message with one line: STATUS: FIXED or STATUS: NOT FIXED."), Harbor's egress sidecar at a 900 s read timeout, and L1's host and part machinery with six sessions at a time. The arm tar is extracted into /root before the session. The diff at session end is what the verifier grades.

**Codex CLI (GPT-6.2 Sol).** The Lane B Codex agent the Codex hooks eval built on this rig (2026-11-19-geva-562-codex-hooks-prereg, section 2): \`codex exec --json\` in the task container on the metered session, the model reaching only Lane B's metering proxy, Codex's approvals and sandbox bypassed inside the trial container, bundled system skills, web search, the update check and analytics off, retries off, no \`--ephemeral\`, questions through request_user_input answered with the driver's fixed reply, and the rollouts under \`$CODEX_HOME/sessions/\` copied out after the session. B1's task images with Codex added, B1's prompt and closing line, the same snapshot strip, and B1's verifier. Codex CLI 0.170.0 (npm @openai/codex@0.170.0, tarball sha256 67c4bccce8e6c3a2b9ae0e586750e0efac7e0b8cd85e6b4734ad474317d2cc32, binary sha256 880819aab735adcf16f36cd628940b9f1e652a36c01d10a5d32f83cc84902971), never @latest. Reasoning effort pinned with \`-c model_reasoning_effort=low\`, which is Codex 0.170.0's default for gpt-6.2-sol and what a Codex user gets unless they change it; a session with any metered request at another effort is an infrastructure gap. Context window as Codex's catalog sets it for the model, recorded from each session's session_meta.

**Every session.** GSTACK_SESSION_KIND=unattended in the gstack arms on both hosts, so gstack takes its recommended option instead of stopping at a question; gstack at 1.102 reads a \`codex exec\` session as headless and would otherwise stop as blocked. gstack's telemetry is off in every gstack arm (\`telemetry: off\` in the seeded ~/.gstack config, read back at build), and Harbor's egress sidecar lets no session reach anything but the proxy. Each result row takes the model and the CLI version from the session's own record: Claude Code's init message and the SDK's version, or Codex's session_meta cli_version and turn_context model, never from this plan.

## 3. Tasks

draw.py takes B1's copy of the harness mechanics eval's screened lists (hm-screened.txt, byte for byte B1's): 200 scored SWE-rebench tasks from 138 repositories, each built and graded on this rig in that eval. It drops the 17 whose ids end in \`_interface\`, because they ask for new code and the steps are written for a bug, and keeps the other 183 from 126 repositories. One seeded shuffle (seed 771515331, minted from 4 random bytes on 2026-11-21 before any draw) of the sorted 183 sets the run order; the first 92 are the interim look's half. The pilot takes the first three calibration tasks in the same seeded shuffle of the sorted calibration tasks: koxudaxi__datamodel-code-generator-3071, tox-dev__tox-3810 and imperialcollegelondon__pyrealm-593. draw.txt is draw.py's output, and tasks.txt holds the 183 run tasks in run order, then the three pilot tasks.

The corrections post found that the scored tasks were drawn as bug fixes, not all checked as bug reports; at least one non-interface task comes from a feature pull request. B2 keeps them, and the limits say so. Every task is a Python repository. SWE-rebench is the work of Nebius AI R&D, used under CC-BY-4.0.

## 4. Arms

Four arms, the same on both hosts except where the table says.

| Arm | gstack | Test-first text | Prompt |
|---|---|---|---|
| none | none | none | B1's plain prompt |
| line | none | one line, the whole of the user's instructions file: ~/.claude/CLAUDE.md on Claude Code, $CODEX_HOME/AGENTS.md on Codex | B1's plain prompt |
| gstack | v1.102.1.0 (29bff55d), installed by its own ./setup for the host, hooks on as shipped | none installed beside it | B1's plain prompt |
| prove-it | the same gstack tree | B1's prove-it skill installed beside gstack | opens with "/prove-it " on Claude Code, "$prove-it " on Codex |

**none** is the no-gstack arm (R44): the same model, tasks, rig and prompt, with no gstack, no skill, no hooks, no ~/.gstack and no gstack setting in its environment. On Claude Code it is B1's none tar (sha256 8bab483364e4153a832c0995d6bc06d2953af805f32ae70a2e40788965a6764e) byte for byte. It runs where it can see no Capy drive and no gstack install, clean by construction, and its read audit is reported after the run as a descriptive check.

**line** is none plus one line: "When you fix a bug, first write a test that reproduces it and run it to see it fail, then fix the bug and run the test again to see it pass." It goes where gstack would ship such a line, the user's own instructions file, which the snapshot strip doesn't touch and which each host delivers at session start. It carries no gstack.

**gstack** is gstack at the newest stable tag at this plan's freeze, v1.102.1.0, commit 29bff55dd8a14b32ff282d5a37097e3a53e3250a, fetched by sha. On Claude Code, \`./setup --host claude --no-browser --loadout full\` in Lane B's builder with Lane B's seeded long-time user, B1e's build at the same tag without the prove-it file; routing and contracts on as shipped. On Codex, \`./setup --host codex --no-browser\` into a fresh home, with the same seeded user; hooks.json as setup writes it, trusted with \`--dangerously-bypass-hook-trust\` as a user who has trusted gstack's hooks once. This arm is gstack as a user who installs it gets it on a bug report: its routing hook may name one of gstack's own skills, such as /verify, and the model may load it.

**prove-it** is the gstack tree plus B1's prove-it skill (lanes/delivery-route/arms/gstack-shaped-SKILL.md, 9,343 bytes: gstack 1.99.5.0's /verify setup with prove-it's name, description and triggers, then the 203 bytes of Prove-It steps), at ~/.claude/skills/prove-it/SKILL.md on Claude Code and at $CODEX_HOME/skills/prove-it/SKILL.md on Codex with its four ~/.claude/skills/gstack paths changed to ~/.codex/skills/gstack, as the Codex hooks eval installs it. The prompt types it: the route B1 measured at 46 of 60 followed on Opus. On Claude Code the tree is built the way B1e builds its hook arm, gstack at the same tag with prove-it beside it. It differs from the gstack arm only by the prove-it file and the typed prefix. With prove-it installed, gstack's routing hook may also name it on a bug report; that is part of what this arm gets.

The Prove-It steps are lines 13 to 18 of .claude/commands/test.md in agent-skills at 39b723ceebf81474d0557c1fecd01eddab585563 (MIT), sha256 47bfc31f877aef8938dfabc4984a759eaaa1f8f7588a408c542199bde6e34557.

The design post listed agent-skills' own /test command as an arm. B2 replaces it with the gstack arm (section 15).

## 5. Models

| Model | Host | Route | Allowance a session |
|---|---|---|---|
| claude-opus-5-5 | Claude Code 2.1.312 | Anthropic, cells.l1.json | 5 |
| gpt-6.2-sol | Codex CLI 0.170.0 | OpenAI Responses API through Lane B's proxy | 5 |
| particle-1 | Claude Code 2.1.312 | OpenRouter, cells.hm-p1.json | 2 |

Allowances are in dollars. A model under test is never swapped (R95): a refusal or a provider safety stop is a result.

## 6. What each session records

### 6.1 Passes (primary)

The Harbor verifier's reward on the diff at session end: 1 is a pass. B1's rule.

### 6.2 Passes with a regression test (co-primary)

A pass whose final diff (the one the verifier grades) adds or modifies at least one file that B1's test-path rule calls a test (2026-11-17-geva-547-delivery-route-prereg, section 6: a tests, test, __tests__, testing or e2e folder, a .test, .spec or .tests file, test_*.ext, *_test.go, *Test.java and its kin, or src/test/; spec and specs folders read as source). The rule reads paths only, so a reproduction script named test_*.py left in the diff counts; the report gives the count of sessions whose only test files sit at the repository root. Beside it the report gives, per arm, sessions whose diff touches a test file at all, pass or not.

### 6.3 Followed and the procedure gate

**Followed** is B1's rule (section 6 of its plan): a test write, then a failing run of that test before the first source edit, then a passing run that selects it after, read from the session's tool calls and the final diff, with these changes found by B1's results and its review, carried in here as its FIX-METHOD:

- A Bash call that holds several commands is read per command for its passing run, also when its runners and test summaries don't pair one to one: each runner's own summary is the block of output its command printed, found by the order of the commands and the runners' own summary lines, and a call whose output can't be split that way falls back to B1's as-merged rule. So a passing run chained with grep, a python -c check, a linter or another suite counts, as B1's blind hand reading counted it.
- A command that prints a file it names (cat, tail, head, less, or rg or grep of a log) is never a test runner's summary, so \`| cat old.log\` can't supply another run's pass.
- A runner started through xargs, find -exec or parallel is not paired per command; the call falls back to the as-merged rule.
- The table prints every as-merged line from its own field, never a zero for a field it didn't read.

On Codex the same rules read a stream built from the rollout: each shell command Codex ran (its completed CommandExecution item: the command, its folder and its output) is a Bash call and its result, and each patch Codex applied (its FileChange item, or an apply_patch call) is a write to every path its Add File, Update File, Delete File and Move to lines name. The keyless tests (section 7) check that a command run from a code-mode cell reaches the stream; if Codex 0.170.0 records such a command another way, the reader reads it from that record, by a dated pre-data change before the pilot. A rollout item the stream can't read is counted per arm and its session is scored both ways, as B1 scores a write no parser can name.

**The procedure gate.** The procedure reached the sessions when both hold: pooled over the three models, prove-it's followed rate is at least 20 points above the gstack arm's, and on Opus 5.5 prove-it's followed rate is at least 50%. B1 measured 77% on Opus with this skill typed and 0% with nothing. Sol already follows the steps unprompted in about three sessions of four (B1, in Claude Code), so Sol's own gap may be small; the report gives each model's.

### 6.4 Descriptive

Per arm and model: the step text reached the transcript (the typed expansion on Claude Code, Codex's injected skill item on Codex, or a read of prove-it's file); prove-it or any gstack skill loaded (a Skill call or a read of its SKILL.md, the B1d and Codex hooks detectors); what gstack's routing hook named, from its own log; gstack's start step seen, from its injected output or a gstack-skill-start run; questions asked; cost, tokens and wall time; allowance and turn-limit stops; provider safety stops; writes no parser can name; and the read audit of the no-gstack arms.

## 7. Scorer checks

The scorer is lanes/delivery-route's detector with section 6.3's changes and a Codex reader, in shared, tested modules, built on the results branch and pinned by commit before the pilot. Before any paid call it passes keyless tests in both directions: B1's detector fixtures unchanged; a passing run chained with grep, python -c, a linter and another suite in one call counted; \`| cat old.log\` and an xargs runner not paired; the as-merged table never printing an unread zero; the test-path rule on added, modified, renamed and root-level test files; and the Codex reader on real Codex 0.170.0 rollouts (a direct exec_command, a code-mode cell that runs two commands, an apply_patch that adds a test and updates a source file, a FileChange with a move, a sub-agent's rollout) giving the same followed reading as the same session written as Claude Code tool calls.

Before the counted runs, a hand reading of 5 pilot sessions spread across the four arms and the three models, at least 2 of them Codex, checks every field of 6.1 to 6.3 against the transcript and diff. A mismatch goes to the Captain before more spend.

## 8. Outcomes, reruns and gaps

B1's rules. A session is graded when it has a verifier reward and a model response reached the agent (on Codex also: its rollout was copied out), whatever stopped it: an allowance stop, the turn limit, or a model or upstream error after a response all score on the diff at session end. Anything else is infrastructure: no result, no model response (an upstream error before any response included), no verifier reward, or a Codex request at another effort. An infrastructure session reruns once as attempt 2; if attempt 2 is not graded, the cell is a gap. A ledger cap stop never reruns, ends the item incomplete and is never rerun to change a reading. A provider safety stop keeps its outcome class and is counted on its own line per arm.

A model is INCOMPLETE when any of its arms has more than 10% of its tasks not graded, or its item hit a cap stop. An INCOMPLETE model enters no pooled reading. The pooled reading runs over the complete models when Opus 5.5 and GPT-6.2 Sol are both complete, and says when particle-1 is left out; otherwise there is no reading. Pairs use the tasks graded in both arms.

## 9. Reading

### 9.1 Per model

For each model, arm and outcome, the count over graded sessions with a Wilson 95% interval. Paired contrasts on tasks graded in both arms with Newcombe's interval for paired proportions (method 10, as B1's analyze.ts computes it and tests against Altman's worked example): prove-it minus gstack, prove-it minus none, prove-it minus line, gstack minus none, line minus none.

### 9.2 Pooled

For a contrast A minus B, each complete model m and task t give d = A's outcome minus B's (1, 0 or -1). D is the mean of d over all (m, t) pairs. Its variance is the cluster-robust one with the repository as the cluster: V = G/(G-1) times the sum over repositories g of (s_g - n_g D)^2, over N^2, where s_g is the sum of d in g, n_g the number of pairs in g, N the number of pairs and G the number of repositories. z = D / sqrt(V), and the 95% interval is D plus or minus 1.96 sqrt(V). The keyless tests check this against a hand-computed table.

### 9.3 Bounds

The 5% type I error is split between the two co-primaries. Passes get 4%, with one interim look (below) and O'Brien-Fleming-shaped bounds: |z| of at least 2.917 at the look, 2.068 at the end (power.txt; the same code gives 2.797 and 1.977 at 5% and half, the published values). Passes with a regression test get 1%, read at the end only, on the full 183 tasks, at |z| of at least 2.576. The delivery-form contrast (prove-it minus line, passes) is read only after a passes reading above 0, with its 95% interval, uncorrected. Every other contrast is descriptive. The per-model Newcombe intervals are 95% and descriptive.

### 9.4 Why null?

A reading with nothing shown gets one cycle, written into the results: exposure (the procedure gate, and per model followed and step-text rates), task fit (bug-report tasks only, and a split by whether the none arm passed), power (the realized discordance and the MDD it implies), floor and ceiling (each model's none pass rate), and whether the frontier model already does it unaided (each model's followed rate in none and gstack). It ends in KEEP, FIX-METHOD or CUT-CANDIDATE by the decision table.

## 10. Power

power.py, output in power.txt. B1 measured discordance on passes between a treated arm and none of 15% on Opus, 5% on Sol in Claude Code and 10% on particle-1, with no design effect from tasks shared across models (0.78 to 1.01). At those rates the pooled passes contrast has a smallest difference found 80% of the time of about 3.9 points, 4.4 with a 1.25 design effect for repository clustering, and 4.8 to 6.2 points if every model's discordance is 15% to 20%. Per model, the MDD is about 6.5 points at 10% discordance and 8.0 at 15%. Passes with a regression test, at 1%, have an MDD of about 6.3 to 8.9 points at 15% to 30% discordance. B1 measured passes moving by +5, -5 and -3 points with the steps on its 60 tasks, so effects of that size are what this design is built to find pooled, not per model.

## 11. Interim look

Planned paid spend: $857

At: half the units, the first 92 of the 183 tasks in run order, in every arm of every model

Stop bounds: |z| of at least 2.917 at the look and 2.068 at the end, on the pooled passes contrast, prove-it minus gstack

Other looks: none

Each model's first four parts hold tasks 1 to 92. The look is taken once all of them have settled for every model, on the tasks graded in both arms, before any later part starts. At the look, section 8's INCOMPLETE test is applied to each model's first 92 tasks. An INCOMPLETE model enters no look z, and if Opus 5.5 or GPT-6.2 Sol is INCOMPLETE there, the look stops nothing and the run goes on. If |z| is at least 2.917 either way, the run stops there and the reading rests on passes alone: passes with a regression test are reported on those units as descriptive, with their 95% interval, and take no part in the decision table. Otherwise the run goes on to the end. Nobody reads any outcome before the look or between the look and the end; the run's controllers print progress counts only.

## 12. Pilots

The pilot (b2-pilot) runs before any counted session: the three pilot tasks on the four arms, on each model, 36 sessions in three parts, one per model. Each arm's budget is its share of the three model items' caps by expected spend; each pilot cap is the pilot item's cap split by the arm's expected pilot spend.

| Arm | Budget | Pilot cap | Part ran | Judge check | Supply |
|---|---|---|---|---|---|
| none | $275.73 | $13.79 | no step text, no skill listed but the host's own, no gstack file and no ~/.gstack in the tree, and no gstack read in the audit, on each model | none | the three pilot tasks build and grade on each host, six sessions at once; before Sol's first counted part every run task's image builds with Codex added, keyless |
| line | $275.73 | $13.79 | the line arrives in each session's start (Claude Code's user-instructions reminder, Codex's AGENTS.md instructions item), and nothing else differs from none | none | as none |
| gstack | $345.40 | $17.27 | gstack's skill listing reached the model, its routing hook logged an event on each prompt, and the start step of any gstack skill that loaded is seen, by its injected output on Claude Code (gstack's load-time start, 7f9c1bc5 and later) or its gstack-skill-start run on Codex; telemetry reads off | none | as none |
| prove-it | $402.95 | $20.14 | the step text arrived in every session, the followed detector reads every session through to a reading (followed or not, with the reason), at least one session on each model reads as followed, and prove-it's own load is seen as gstack's arm's loads are | none | as none |

In every arm, Part ran also requires every metered Sol request at low effort.

\`b2 report --item b2-pilot\` prints a PASS or FAIL line per arm and model. An arm that fails is fixed or left out of the counted run, and a left-out arm is reported as left out, never as a loss. Every failure goes to the Captain first; a fix comes back as a dated pre-data change on the results branch with its own pilot. Pilot sessions never enter a reading. No arm has a model judge.

## 13. Judge check

Judge: none

Passes come from the task's own verifier, regression tests from the diff's paths and followed from the deterministic detector, so no model judges this run. The hand reading in section 7 checks the detector.

## 14. Admission

B1's none arm passed 35, 34 and 34 of its 60 tasks on Opus, Sol and particle-1 (58%, 57%, 57%), so passes have room both ways. Opus followed the steps in 0 of 200 of the harness mechanics none sessions and particle-1 in 0 of 200, so the procedure has its whole range to move on those two. Sol followed them unprompted in 151 of 200, so Sol's exposure gap is small and its passes contrast is the least likely to move; it stays a model under test (R54) and is read the same way.

## 15. Order and machines

The pilot, then the three counted items, b2-opus, b2-sol and b2-p1, side by side. Each item runs eight parts one after another, 23 tasks and their four arms to a part (the last part 22), a task's four arms in one part in seeded order. At most three part VMs (standard-16) and their awake hosts (standard-2) run at once, 54 vCPUs, inside the crew's share, and every VM is destroyed when its stage ends. The run's records, transcripts and diffs are copied off the hosts, checked by sha256, before any host is destroyed.

## 16. Limits

- One procedure on one kind of task. Five short steps on Python bug fixes may not carry over to other languages, feature work or longer procedures.
- The prove-it arm differs from the gstack arm in two ways at once: the skill is installed, and it is typed. B2 asks whether the procedure, delivered the way B1 found it gets followed, changes outcomes; it doesn't separate the file from the typing.
- The line arm carries no gstack, so prove-it minus line mixes the skill against the line with gstack against no gstack. It decides only the delivery form, after a passes gain, and gstack minus none is printed beside it.
- Regression tests are read from paths, not run. A test file in the diff that doesn't test the bug, or a reproduction script left at the root, counts.
- Sol runs in Codex, where gstack marks its host experimental and its hooks advisory; /review there runs without its specialists and there is no cross-family second-model review.
- B1's Sol numbers came from Sol 6.1 in Claude Code, not Sol 6.2 in Codex, so the admission's Sol rates and the cost estimate's Sol rates are borrowed.
- The tasks were drawn as bug fixes, and not every one is a bug report (section 3).

## 17. Departures from the design post

- The design post's arms were none, the one line, agent-skills' /test command and a gstack port in B1's best route. B1 showed that a typed command with the steps alone and the gstack-shaped skill deliver the same steps about equally well, so a separate agent-skills arm would repeat the prove-it arm. B2 spends that arm on gstack alone, which isolates the procedure from installing gstack: prove-it minus gstack.
- 183 tasks, not 200: the 17 interface tasks ask for new code.
- Sol is GPT-6.2 Sol in Codex CLI, not GPT-6.1 Sol in Claude Code, by the crew's rules from 2026-11-19 and 2026-11-20.
- The design post planned Holm across three contrasts; B2 has one decision contrast with two co-primaries split 4% and 1%, and one planned look.

## Credits

The Prove-It steps are from agent-skills by Addy Osmani (MIT, Copyright (c) 2025 Addy Osmani), at 39b723ceebf81474d0557c1fecd01eddab585563. gstack is MIT, Copyright (c) 2026 Garry Tan. SWE-rebench is the work of Nebius AI R&D (CC-BY-4.0).

<details>
<summary>Agent notes</summary>

Money runs on the Lane B ledger, one item per model plus the pilot, each opened with its approval row at the cap below. A session reserves its allowance as it opens and settles at its metered cost; a refused reserve is a cap stop.

| Item | Sessions | Expected model spend | Cap |
|---|---|---|---|
| b2-pilot | 36 | 12.87 | 65 |
| b2-opus | 732 | 281.82 | 465 |
| b2-sol | 732 | 384.30 | 605 |
| b2-p1 | 732 | 118.95 | 230 |

Dollars. Expected spend per session, from B1's measured means and B1d's gstack arm: Opus 0.31 none and line, 0.42 gstack (B1d's gstack-main), 0.50 prove-it (B1's gstack-shaped plus the gstack listing); Sol 0.45, 0.45, 0.55, 0.65 (B1's Sol 6.1 in Claude Code, plus the same gstack step; GPT-6.2 Sol lists at Sol 6.1's prices, 2, 10, 0.10 cached input and 2.50 for a cache write per million tokens); particle-1 0.15, 0.15, 0.17, 0.18. Each cap is ceil5(1.35 x expected + 6 parallel allowances + the VM share): eight parts of two 4-hour standard-16 blocks at 0.60 an hour and the host's reserve at 0.08 an hour, about 53 an item, and about 15 for the pilot. The caps sum to 1,365. Expected paid spend is about 875 (857 for the counted run), and about 1,275 all-in with this thread's own work. Before each launch the guard refuses when the item's projection passes its cap, or when every item's projection plus this thread's own counter passes 1,860 all-in; a refusal goes to the Captain. A GPT-6.2 Sol price row goes into src/runner/pricing/prices.ts on the results branch before the pilot.

The rig code (the Codex reader, the detector changes, the B2 arms, items and table) is built on the results branch and pinned by commit before the pilot, and lands with the results (two pull requests for this experiment). The run's records go to the crew's private store with sha256 manifests before any host is destroyed.

</details>

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
