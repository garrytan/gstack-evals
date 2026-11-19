---
id: 2026-11-19-geva-562-codex-hooks-prereg
kind: plan
title: "Preregistration: do gstack's routing hook and /review contract help GPT-6.1 Sol in Codex, and does high effort?"
summary: "Sol in Codex CLI. Routing on vs off on B1's 60 bugs (prove-it loads); /review contract on vs off on 33 real PRs (defects found); a high-effort arm for E3; no-gstack arms."
author: GEVA-562
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-19
status: open
links:
  - 2026-11-18-capy-b1b-prose-route-prereg
  - 2026-11-18-capy-b1b-prose-route-results
  - 2026-11-19-capy-why-opus-skips-skills
  - 2026-11-04-geva-271-r2-after-pin-results
  - 2026-11-03-geva-255-r2-after-pin-amendment
  - 2026-10-31-geva-76-stacks-round-1-prereg
  - garrytan/gstack-evals#376
  - GST-3174
  - GST-3162
  - GST-3161
  - src/adapters/codex/driver.ts
  - src/trial/review/run.ts
  - lanes/delivery-route/
attachments:
  - b185c7966440e1b65a57db45aaec47f8413ad64ab08958d1d93317b899ec02cb  power.py.txt
  - 37ddae4adf8800bc0f85413fcec1bde201d831d62706bc635e793cda10e21222  power.txt
  - 1e6475c1396c71299a1d991466a3dd1883f50e4678554858425270bf67e56064  probes.txt
---

# Preregistration: do gstack's routing hook and /review contract help GPT-6.1 Sol in Codex, and does high effort?

## Approval

The go for this eval is Garry's "do it" on 2026-11-19 to GStack Minder's Codex hooks plan (GST-3162), relayed by GStack Minder to the gstack-evals Captain the same day. No paid call runs until this preregistration merges, both gstack pull requests have landed, the pin post (section 3) has merged, the Captain has recorded each item's cap, and it is after 2026-11-21 06:00 UTC. Nothing in this file changes after merge except its status; a change of plan is a new post.

## Plain summary

gstack is about to give Codex users three of its Claude Code hooks: a routing hook that adds one line naming a skill when a prompt fits it, a check that stops destructive commands, and a /review contract that holds /review once if it tries to finish without its adversarial pass or its report. The plan ships all three registered by default and asks this eval whether routing and the contract earn that default for GPT-6.1 Sol, and whether gstack should ship a separate high-effort Codex profile.

We run Sol in Codex CLI in two parts. Routing: B1's 60 SWE-rebench bug tasks with B1's prove-it skill installed beside gstack, routing on against routing off, and we count the sessions where the skill's text reached the model. Contract: gstack's /review on R2's 33 real gstack and gbrain pull requests with 42 known real bugs, contract on against contract off, and we count the known bugs the delivered review names. We compare the review each session would have delivered at its first stop with the one it delivers after the contract has had its say, so the contract is graded on the bugs it adds, not on whether its pass ran. One more arm runs the contract-on review at high effort. Each part has an arm with no gstack at all.

What it decides: whether routing and the contract stay on by default for Codex, and whether gstack ships a high-effort Codex profile (E3) or keeps printing a recommendation (E2). What it doesn't decide: whether test-first fixes more bugs, whether the hooks help on Opus or Claude Code, or effort's effect on any workflow but /review.

## 1. The decisions this result changes (R97)

Each part has its own primary and its own decision. No decision reads another's primary, so no correction is made across them; each interval is a two-sided 95% interval.

**Routing default for Codex** (plan item B1, routing). Read in this order.

| Result | What gstack does for Codex |
|---|---|
| Part R held at the coverage gate (section 4.4) | No run, no reading. The routing part goes to the Captain with the route table, as B1d did at 3f1b82b. |
| INCOMPLETE (section 4.7) | No reading. gstack ships routing as planned (B1) and the result goes to the Captain with what is missing. |
| Primary above 0: routing raises prove-it loads on the prompts it names it on | Routing stays on by default for Codex. Verdict KEEP. If its passes contrast with routing off (section 4.6) lies wholly below 0, the reading is "loads up, fixes down" and goes to the Captain and GStack Minder before the default is confirmed. |
| Primary includes 0, and routing off loads prove-it in at least 80% of those prompts | Sol finds the skill without the line. Routing ships off by default on Codex (registered, `skill_routing` off for that host). Why null: a ceiling the model reaches unaided, so FIX-METHOD (ceiling) until one honest attempt to raise it (R61) runs as its own quick look. |
| Primary includes 0, and routing off loads it in under 80% | The line doesn't move Sol. Routing ships off by default on Codex. Why null in the results; FIX-METHOD when the line was not delivered in at least 90% of named sessions or the interval is wider than the MDD, otherwise CUT-CANDIDATE for the line on Codex, which Garry hears in plain words. |
| Primary below 0 | Routing lowers loads of the skill that fits (for example by steering to /verify). Routing ships off by default on Codex; FIX-METHOD on its line. |

**Contract default for Codex** (plan item B1, contract). Read in this order.

| Result | What gstack does for Codex |
|---|---|
| INCOMPLETE (section 5.8) | No reading. gstack ships the contract as planned (B1) and the result goes to the Captain. |
| False blocks in more than 5% of contract-on sessions (section 5.6) | The contract ships off by default on Codex, and its Codex transcript reader gets FIX-METHOD, whatever the primary shows. |
| The contract blocked in fewer than 7 of 66 contract-on sessions | Sol on Codex already runs the adversarial pass and writes the report, so the contract had almost nothing to act on. That is no evidence it helps (R56), and not a loss. The contract ships off by default on Codex. Verdict FIX-METHOD (ceiling), with the R61 attempt as its own quick look on harder reviews. |
| Primary above 0: the contract adds known bugs to what ships | The contract stays on by default for Codex. Verdict KEEP. |
| Primary includes 0 | The contract ships off by default on Codex. CUT-CANDIDATE when the interval's upper bound is under the MDD (11.5 points at no losses), otherwise FIX-METHOD (power). Garry hears a cut candidate in plain words. |
| Primary below 0 | The hold makes the delivered review worse. Off by default on Codex; CUT-CANDIDATE. |

If the check on the within-session design fails (section 5.4, check A), the between-arm contrast, contract on minus contract off, takes the primary's place in this table, and the results say why.

In this table, the E3 table below and every between-arm contrast of part C, a reading is above 0 or below 0 only when both hold: its bootstrap interval excludes 0, and the exact two-sided pull-request-clustered sign-flip test (section 5.4) gives p < 0.05. Otherwise it includes 0. Part R's readings use Newcombe's interval alone (section 4.8).

**E3 against E2** (plan item E). The effort contrast is contract-on /review at high against the same arm at low (Codex's default for Sol), on the same units.

| Result | What gstack does |
|---|---|
| Either arm INCOMPLETE | No reading. E2 stands. |
| High minus low above 0 | gstack ships E3: a `gstack` Codex profile at high effort, used with `codex --profile gstack`. The results give the cost per added known bug, so the profile's docs can say what it costs. E1 (writing effort into the user's own config) stays rejected. |
| Includes 0 | E2 stands: setup prints its one-line recommendation and writes nothing. This eval can't show an effort gain smaller than about 19 to 22 points on /review (section 10), and E3 is not shipped on this evidence. |
| High minus low below 0 | E2's recommendation of high is wrong for /review on Sol. GStack Minder rewrites or drops the printed line. |

The E3 reading covers /review only. Routing sessions run at low in every arm.

## 2. Rig

**Model.** GPT-6.1 Sol (`gpt-6.1-sol`, OpenAI API) in every arm of both parts, the frontier OpenAI model R54 names, the model B1 ran as Sol, and the one gstack's GPT tier table covers. Codex 0.170.0's own catalog lists `gpt-6.2-sol` first (probes.txt, section 5); this eval doesn't test it. A model under test is never swapped (R95): a refusal or a safety stop is a result.

**Harness.** Codex CLI 0.170.0 (npm @openai/codex@0.170.0, tarball sha256 67c4bccce8e6c3a2b9ae0e586750e0efac7e0b8cd85e6b4734ad474317d2cc32, as GEVA-555 recorded it), `codex exec --json`, unless the pin post names a later version that both gstack pull requests require. Context window as Codex's catalog sets it for the model (500,000 tokens, effective 95%), recorded from each session's `session_meta`.

**Effort.** Pinned with `-c model_reasoning_effort=...` in every arm: `low` everywhere, which is Codex's default for gpt-6.1-sol (probes.txt, section 5) and what a Codex user gets unless they change it, except the effort arm at `high`. Every metered request's `reasoning.effort` is read from the proxy's journal; a session with any request at another effort is an infrastructure gap.

**Session settings, every arm.** From the shared Codex driver (src/adapters/codex/driver.ts with GEVA-555's infrastructure pull request, which lands GSTACK_SESSION_KIND, the seeded gstack config, the effort pin, the request_user_input_async capture and the E_INTERACTIVE_HOST lift): the model reaches only the metering proxy; approvals and Codex's sandbox are bypassed inside the trial container; bundled system skills, web search, the update check and analytics are off; retries are off; the same GSTACK_SESSION_KIND and seeded `~/.gstack` config in every arm, no-gstack arms included, where nothing reads them. A question the model asks through request_user_input or request_user_input_async gets the driver's reply, "No one is available. Treat this question as answered with your recommended option, and keep going.", and is counted per arm.

**What this eval adds to the driver.**
- `--dangerously-bypass-hook-trust` in the gstack arms only. The no-gstack arms have no hooks.json and don't pass it.
- No `--ephemeral`, in every arm. With it, Codex writes no rollout file and every hook gets `transcript_path: null` (probes.txt, section 1). The contract hook reads the rollout through that path, so under `--ephemeral` it could never see the session, and this eval's load detector would have no record. The shared driver passes `--ephemeral` today.
- After the session, a copy of `$CODEX_HOME/sessions/` (the root thread's rollout and any sub-agent's) and gstack's hook logs under `$GSTACK_STATE_ROOT/hooks/`.
- init.json records, per session: Codex's version, the model, the effort, whether the trust bypass was passed, the sha256 of `$CODEX_HOME/hooks.json` (null when absent), the three gstack switches as gstack's config reports them (`skill_routing`, `skill_contracts`, `destructive_guard`), the gstack pin, the arm tree's digest and the sha256 of the arm's prompt-input capture.

**Keyless start capture.** One `codex debug prompt-input` capture per arm and part, free, at build: the skill listing, the tools and the instructions each arm's model receives. Their digests go in the pin post.

## 3. gstack pins

gstack lands this work as two pull requests: routing with the destructive-command check (PR 1), and the contract with a Codex transcript reader (PR 2). The pin is the first gstack main commit that contains both merges. It is named, with its sha and VERSION, in a dated pin post that merges before any paid call, together with the Codex version and the outcomes of these keyless checks, each run from the pinned tree:

1. `./setup --host codex --no-browser` into a fresh home writes `$CODEX_HOME/hooks.json` with gstack's routing, destructive-command and contract handlers, and leaves `config.toml` without gstack hooks under `[hooks]`.
2. With the bypass flag, against the stub (probes.txt), the routing hook's line arrives as a developer message on a prompt it routes; the contract hook blocks once on a fixture /review session whose rollout has no adversarial `spawn_agent` call, and doesn't block on one that has the call and the report; `skill_routing off` and `skill_contracts off` each stop their hook.
3. `$review` as the first word of a prompt injects exactly one skill item, named review.
4. The route table and coverage gate (section 4.4).
5. The duplicate check (section 7).

A check that fails at the pin holds that part. gstack under test is never patched here; GStack Minder fixes it, and the pin post names the fixed commit.

## 4. Part R: routing on against off

### 4.1 Tasks

B1's 60 run tasks byte for byte (B1's tasks.txt, sha256 b116edf386ad9400db88173e0b3f58144ff4153c1664bca64d01be4aca6227b1), in draw order, with B1's plain prompt and closing line, on B1's Harbor task images and verifiers. SWE-rebench is the work of Nebius AI R&D, used under CC-BY-4.0.

### 4.2 Arms

| Arm | gstack | prove-it | Hooks | Prompt |
|---|---|---|---|---|
| r-on | at the pin, `./setup --host codex` | installed (4.3) | as setup writes them, trusted by flag; `skill_routing` on | B1's plain prompt |
| r-off | the same | the same | the same; `gstack-config set skill_routing off` | the same |
| r-none | none | none | none | the same |

r-on and r-off have the same files and the same hooks.json; they differ only in the switch. The destructive-command check and the contract are on in both, as shipped. r-none is the no-gstack arm (R44): the same model, tasks, rig and prompt, with no gstack, no skill, no hooks and no `~/.gstack`. It runs where it can see no Capy drive and no gstack install, clean by construction, and its read audit is reported after the run as a descriptive check.

### 4.3 prove-it on Codex

B1's prove-it skill (lanes/delivery-route/arms/gstack-shaped-SKILL.md, 9,343 bytes: gstack's /verify setup with prove-it's name, description and triggers, then the 203 bytes of Prove-It steps in steps.md) installed at `$CODEX_HOME/skills/prove-it/SKILL.md`. Its four `~/.claude/skills/gstack` paths become `~/.codex/skills/gstack`, the rewrite gstack's own Codex setup applies to its skills, and nothing else changes. The build checks the file's sha256 and that Codex lists it with its description. B1d puts the same file beside gstack main on Claude Code.

### 4.4 The route table and the coverage gate

Keyless, at the pin: for each of the 60 prompts as the rig sends it, the pinned routing hook runs on a UserPromptSubmit payload from the r-on arm's home, and the table records what its line names and where it puts prove-it: alone, first of two, second of two, or not named. The covered tasks are those where it names prove-it in any position.

**Gate.** If prove-it is covered on fewer than 30 of the 60 prompts, part R holds at no spend and goes to the Captain. Under 30, the primary's MDD passes 27 points at every disagreement rate (section 10). One install variant is checked first, keylessly and before any paid call: if gstack's Codex router lists only skills under `gstack-` folder names, as GST-3162's plan says it scans, the table is rebuilt with prove-it at `$CODEX_HOME/skills/gstack-prove-it/SKILL.md`, gstack's own Codex layout, its file unchanged. If that variant clears the gate, it is the install for both gstack arms, and the results say so. The route table and which install was used go in the pin post.

### 4.5 The load, from Codex's rollout

In Codex, nothing like Claude Code's Skill tool call exists: the model reads a SKILL.md with a command, usually from inside a code-mode `exec` cell, or Codex injects the body when the user types `$name` (probes.txt, sections 2 and 3). So a load is the skill's text arriving in what the model reads. It is read from the session's rollout JSONL files (the root thread's and any sub-agent's).

A session loaded prove-it when any of these holds:

- **(a) Text unique to prove-it arrived.** A model-visible tool result, a `response_item` of type `function_call_output` or `custom_tool_call_output` (its output string, or its `input_text` parts joined), holds a line of prove-it's SKILL.md below its front matter, at least 40 characters long, that appears in no other file under `$CODEX_HOME/skills`.
- **(b) A read of prove-it's file arrived.** A tool result holds a line of prove-it's SKILL.md below its front matter, at least 40 characters long, and its call (the `function_call` arguments or the `custom_tool_call` input with the same `call_id`) names prove-it's SKILL.md by any path form: absolute, `~/.codex/...`, `$CODEX_HOME/...` or relative to the skills root. (b) applies only when the call names no other file under `$CODEX_HOME/skills` and holds no wildcard path. prove-it shares its setup lines with gstack's skills, and a code-mode cell can read two files and pass on only one (probes.txt, section 3), so a call that reads another skill file counts only under (a).
- **(c) Codex injected it.** A user message holds `<skill>` with `<name>prove-it</name>`. No prompt here names the skill, so this should never happen; any case is reported.

A call that names prove-it's SKILL.md and whose result holds no such line is a failed load. Whether a command exited 0 doesn't matter: the text arrived or it didn't. The listing in the developer message is not a tool result, so a listing never counts as a load.

Beside each load, the detector records whether its call was the session's first tool call (B1b found loads at the first call or never on Opus), and whether the steps arrived: a tool result holding the line "1. Write a test that reproduces the bug (must FAIL)". The same rules with gstack's verify skill's file record /verify loads.

### 4.6 What each session records

- **loaded** (the primary's outcome) and **at the first call**;
- **what the hook named**, from the session's copied hook log, and **line delivered**: the hook's developer message is in the rollout before the model's first output;
- **/verify loaded**, **steps arrived**;
- **passes**: the verifier's reward, B1's rule;
- cost, tokens, wall time, limit stops, provider safety stops, questions asked, destructive-command check events, and the read audit for r-none.

**Why a graded r-on session on a covered task didn't load,** first that applies: hook log missing; line not delivered; loaded /verify instead; load failed; named, not loaded (the model wrote "prove-it" in its text or a tool input); never named.

**The split** (B1d's split of coverage against follow-through). Coverage is whether the hook names prove-it on a prompt (keyless, the route table). Follow-through is whether the skill loads when it does. r-on's loads are given for each position from the session's own hook log (alone, first of two, second of two, not named, log missing), with /verify loads and neither. r-off's loads are given for the same positions from the route table, since no line reached its sessions.

### 4.7 Outcomes, reruns and gaps

B1's rules. A session is graded when it has a verifier reward, a model response reached the agent, and its rollout file was copied out. A ledger cap stop is a cap stop. A session that hits its allowance ($5) or B1's agent time limit is a limit stop: it is graded on what it left and counted per arm. Anything else is infrastructure: it reruns once as attempt 2, and if that isn't graded the cell is a gap. A cap stop never reruns and ends the part INCOMPLETE. Provider safety stops keep their class and are counted on their own line. An arm with more than 6 of its 60 sessions not graded reads INCOMPLETE.

### 4.8 Reading

**Primary.** On the covered tasks graded in both r-on and r-off: r-on's loaded minus r-off's, paired by task, with Newcombe's interval for paired proportions (method 10).

Beside it: the same contrast on all 60 tasks (end to end, which is what the default buys); each arm's loads with Wilson intervals; the split; first-call loads; /verify loads; the reasons; and passes, r-on minus r-off and each gstack arm minus r-none, paired, with Newcombe's interval. The routing table in section 1 is read on the primary. The passes guard in its KEEP row is the only other number that can send the result to the Captain.

The routing in gstack's Codex hook comes from the matcher GSTA-36 tuned on these 60 prompts for Claude Code (B1d, section 5). If PR 1 reuses it, the coverage count is in-sample. Follow-through, what Sol does when the line arrives, is not tuned.

## 5. Part C: the /review contract on against off, and the effort arm

### 5.1 Units

R2's suite, stacks-r1 (wiki/plans/2026-10-31-geva-76-stacks-round-1-prereg/stacks-r1.json, sha256 4f46bb17b7ef98a34db9bf4b03c69755c694eb17dfc7ca0e29e1049a1bcc9a1d): 33 units, each a real pull request on garrytan/gstack or garrytan/gbrain at its reviewed head, with 42 known blocking bugs on 26 pull-request clusters. Each bug is a real defect in the change: one that a later fix or a review on that pull request corrected, mined by the rules in 2026-10-30-gsta-33-u14-review-case-mining-rules. Every unit runs 2 passes per arm, as in R2, so each arm has 66 sessions and 84 bug-passes. The units are public. Their pull requests postdate GPT-6.1 Sol's reported training cutoff (2026-04-30).

### 5.2 Arms and prompts

| Arm | gstack | Hooks | Effort | Prompt |
|---|---|---|---|---|
| c-on | at the pin, `./setup --host codex` | as written, trusted by flag; `skill_contracts` on | low | `$review`, the prefix, then the template |
| c-off | the same | the same; `gstack-config set skill_contracts off` | low | the same |
| c-high | the same as c-on | the same as c-on | high | the same |
| c-none | none | none | low | the template only |

The template is stacks round 1's review told text (`TOLD_TEMPLATE` in src/trial/review/told.ts, sha256 16862a34212cd2eddbcedbc5654b26cb92b0dad50e3d501686770e6bc3d088ad, pinned by tests/trial/review/told.test.ts): review the branch against its base, don't change the code under review, and end with one fenced JSON block of findings. The prefix, frozen here, is: "Report findings only; do not make Fix-First edits. Writes to gstack's own state (its learnings, timeline and review log) are allowed. If a stop hook blocks your reply, end your next reply again with the complete fenced json block." The last sentence is R2's, word for word (2026-11-03-geva-255-r2-after-pin-amendment, section 7). It says nothing about the adversarial pass or the report, because the contract exists to enforce them; R2's prefix told Opus to run the full procedure, and that would leave the contract nothing to do. Routing is on in every gstack arm, as shipped, and skips prompts that start with `$`.

### 5.3 What is scored

**Two states per session.** The final state is the session's last assistant message. The first-stop state is the last assistant message before the rollout's first contract block: the first user message holding `<hook_prompt hook_run_id="stop:...">` from gstack's contract hook (probes.txt, section 2). A session the contract never blocked has one state, and its first-stop state is its final state. c-off, c-high's blocks aside, and c-none have only final states.

**Findings of a state.** The last fenced JSON block in that message, parsed by review-units' parser, first 15 findings in their order. If the message has no parseable block, the judge extracts the findings from that message key-blind (section 5.5), in every arm and state alike, and the count of such states is reported per arm. This keeps a contract block that only gets the model to print a block it skipped from counting as a found bug.

**Found** (the outcome): one of a state's counted findings matches the known bug, by R2's matching rules and #108's judge brief (wiki/plans/2026-10-31-geva-76-stacks-round-1-prereg/judge-brief.md, sha256 ef33d5ca0f802e49e18d1f3e4b16f989bcbd48fa4c46f339bc0533dfb1364427), at any severity. **Blocking**, as a secondary: found and labelled blocking under R2's severity maps (severity-map.json and R2's after-pin gstack-full entry), so Sol's numbers line up with R2's on Opus.

**Unmatched findings**, secondary: counted findings at any severity that the matching batch matches to no known bug, per state. The matching batch reads every counted finding, so this counts the same findings that can earn primary credit. Beside it, R2's adjudication of unmatched blocking findings gives new blockers and false blockers per state, as in R2. Adjudication covers blocking findings only, and these numbers decide nothing.

### 5.4 The primary and its checks

**Primary (the contract).** In c-on, over the 84 bug-passes: found in the final state minus found in the first-stop state, in points, with a 95% interval from R2's pull-request-clustered bootstrap (10,000 resamples, seed 20261119). It is the change the contract made to what ships, measured inside each session. It is zero in every session the contract didn't block. Gains and losses are both counted: a final report that drops a bug the first-stop message named is a loss.

**The sign-flip test.** For each pull-request cluster, sum its bug-passes' paired differences (+1 gained, -1 lost, 0 unchanged). The statistic is the total. Under the null, each cluster's sum is as likely to have either sign, so the test flips the signs of the cluster sums and counts the flips whose total is at least as far from 0 as the observed one. It uses every sign flip over the clusters whose sum is not 0, or 10,000 seeded flips (seed 20261119) when more than 20 clusters changed. Four gains in four clusters with no losses give p = 0.125 and read as including 0. The same test, on the same pairs, goes with check A, E3 and every between-arm contrast.

Why inside the session: until its first block, a c-on session gets exactly what a c-off session gets. A registered hook changes nothing the model sees until it fires (probes.txt, section 4), and routing skips these prompts. So the first-stop state is what that same session would have delivered with the contract off, and the between-session noise drops out. This is what lets 66 sessions see an 11.5-point gain (section 10).

**Check A.** c-on's first-stop found rate minus c-off's final found rate, paired by bug-pass, with the same bootstrap. They estimate the same thing, so they should agree. Check A is a guard, so it leans toward distrust: if the interval excludes 0 or the sign-flip test gives p < 0.05, the within-session design is not trusted: the contract's row in section 1 reads c-on minus c-off instead, and the results say so.

**Between arms, reported beside the primary**, each paired by bug-pass with the same bootstrap: c-on minus c-off (the plain on against off), each gstack arm minus c-none (R44), and blocking, unmatched findings and false blockers for each.

**Effort primary (E3).** c-high's final found rate minus c-on's final found rate, paired by bug-pass, same bootstrap. The cost per session and per found bug of each arm is given beside it.

### 5.5 The judge and its check (R78)

**Production judge:** Claude Opus 5.5, another family from the model under test, through R2's pipeline: blind packets with arm, state and pass hidden, seeded order, #108's brief. Matching, then adjudication of unmatched blocking findings. Gemini 4 Carbon reads second on every item where the arms or states differ under the primary and on a seeded 20%, in place of GPT-6.1 Sol, which can't judge its own runs; Claude Sonnet 5.5 reads third where the first two disagree, as in R2. When a state has no parseable block, the same judge first extracts its findings from the message without seeing the key.

**The check, before any judged number counts.** Gold labels are the items where GPT-6.2 Astra and Gemini 4 Argon agree, each labelling blind from the same packet and brief. The check set is every matching item from the pilot's sessions and states (section 9), plus anchors: for each pilot unit's bugs, a finding the harness writes from the bug's file, line and catalog summary (a known match) and a near miss in the same file at least 30 lines from the bug with another claim (a known non-match). Anchors are at most 30% of the set. The judge passes at kappa of at least 0.6 on at least 40 gold items with at least 10 in each class, for the Opus primary alone and for the joined label. Kappa on the non-anchor items alone is reported, and must also reach 0.6 when they hold at least 10 of each class.

After the counted run, before any reading, a confirmation check draws 40 counted items by seed (20 from each production label) and labels them the same way; kappa must again reach 0.6. If either check fails, Gemini 4 Carbon becomes the primary and is checked the same way. If no route passes, there is no reading and the Captain decides.

### 5.6 Exposure: did the contract run?

From gstack's contract log and the rollout, per c-on and c-high session: whether the contract evaluated a stop, whether it blocked, which items it named as missing, whether it failed open, and how many stops it saw. An independent check reads the rollout before each block: an adversarial pass is a `spawn_agent` call (direct, or inside a code-mode cell) whose message holds gstack's marker "Think like an attacker and a chaos engineer", and the report is an assistant message with the heading "Pre-Landing Review" and the label "Gate edits". **A false block** is a block at a stop before which this check finds both. Per arm: sessions blocked, items named, false blocks, fail-opens, and sessions where the adversarial pass ran before or only after a block. The same readout runs on c-off's rollouts to count the sessions in which the contract would have blocked, for comparison with c-on.

### 5.7 Limits per session

An allowance of $8 at low and $15 at high, and 3,600 seconds. A session that hits either is a limit stop, scored on its last assistant message and counted per arm. If the pilot's 95th-percentile session cost in any arm passes half its allowance, every allowance of that part doubles before the counted run, and its caps are re-priced.

### 5.8 Outcomes, reruns and gaps

A session is scored when a model response reached the agent and its rollout was copied out. Infrastructure failures rerun once; a second failure is a gap. A cap stop never reruns and ends the part INCOMPLETE. Safety stops keep their class; a session with no assistant text scores as finding nothing and is counted on its own line. An arm with more than 7 of its 66 sessions not scored (about 10%) reads INCOMPLETE.

## 6. Attacks on the scoring rules, and the answers

1. *A load by listing.* Codex lists every skill with its description in a developer message. That isn't a tool result, so it can't satisfy (a) or (b), and front-matter lines are left out of (a)'s unique lines.
2. *A read of gstack's verify counted as prove-it.* prove-it's setup text is gstack's /verify setup, so shared lines prove nothing. (a) needs a line in no other installed skill file; (b) needs the call to name prove-it's own path and no other skill file.
3. *Code mode hides the read.* Sol in Codex 0.170 runs commands inside JavaScript `exec` cells, whose nested command output reaches the model only if the script passes it on (probes.txt, section 3). The detector reads what reached the model, the `custom_tool_call_output`, not what a nested command printed. A cell that reads prove-it and another skill file and passes on only one counts only under (a), which needs text unique to prove-it.
4. *A grep that prints one long line.* A `grep -r` that happens to print a unique body line of prove-it counts under (a). The text did arrive. This is rare, and loads at the first call are reported beside all loads.
5. *An injected skill.* Covered by (c); never expected here and reported if seen.
6. *A load that arrives too late to matter.* Loads anywhere count, as in B1b; first-call loads are reported beside them, and steps arrived.
7. *The contract graded on its own exposure.* The primary is known bugs named in the delivered review, not whether the adversarial pass ran or the report appeared. Those are section 5.6's exposure numbers.
8. *A block that only reformats.* A first-stop message with no JSON block gets its findings extracted from its text, the same rule every arm and state gets, so printing the block after a hold adds nothing unless the findings are new. The prefix's last sentence, asking for the complete block again after a block, shapes only the format and does nothing in c-off, where nothing blocks. A final reply that still only refers back to earlier findings scores as written, and those sessions are counted per arm.
9. *Volume.* A hold that makes the model list every doubt could catch bugs by chance. Only the first 15 findings count, and the counted and unmatched findings at any severity, the same findings that can earn primary credit, are reported per arm and state beside every gain. Unmatched findings include real defects outside the key as well as false claims, so they overstate noise, which works against the contract. Adjudication rules only on blocking findings (R2's pipeline), so no not-defect ruling is claimed for the rest.
10. *Losses hidden.* A final report that drops a bug the first-stop message named is a loss and lowers the primary.
11. *The first-stop state isn't what c-off would deliver.* The hook changes nothing the model sees before it fires (probes.txt, section 4), and check A tests the claim on the data. If check A fails, the between-arm contrast decides.
12. *The judge knows which state is which.* Packets hide arm, state and pass. The first-stop and final states of one session reach the judge as separate packets in seeded order.
13. *A Sol judge flatters Sol.* Sol never judges. The primary judge is Opus; second and third reads come from Google and Anthropic; gold labellers are Astra and Argon, and only their agreements count.
14. *Effort changes cost, not findings.* Cost per session and per found bug are reported beside the E3 primary, so a gain bought at a high price is visible.
15. *Home field.* 41 of the 42 bugs came from gstack-family reviews (R2's results). That favours gstack arms against c-none, and is stated beside that contrast. It applies equally to c-on and c-off, so the primary doesn't carry it.
16. *Effort drift.* Every metered request's effort is checked against its arm's pin (section 2).

## 7. Duplicated skills

At gstack main b702243 (1.101.0.0), `./setup --host codex` makes Codex 0.170 list 66 skills, with gstack-upgrade, office-hours and plan-design-review each listed twice, from `skills/gstack-<name>/SKILL.md` and `skills/gstack/<name>/SKILL.md` (probes.txt, section 6). review, verify and qa are listed once. GST-3161 will fix this.

This eval types `$review`, routes to prove-it (and whatever else the hook names), and scores prove-it and verify loads. None of those is duplicated. So the gstack arms install as shipped, duplicates included, since that is what users get, and the listing in each arm's capture says how many entries it has. The check reruns at the pin. If any skill this eval types, scores or finds named by the hook on any of the 60 prompts is listed twice there, every gstack arm disables the copy under `skills/gstack/` with one `[[skills.config]]` entry (its absolute path, `enabled = false`), GEVA-555's layout fix, recorded in init.json and the arm's digest, and the results say so. If GST-3161 is in the pin, the check should find none.

## 8. Known Codex-host differences, stated in every result

- /review on Codex runs no specialist reviewers: gstack's Codex host suppresses its Review Army, and the contract's specialists item is skipped on Codex. Its adversarial pass is one `spawn_agent` reader.
- No cross-family second-model review in any gstack arm: on Codex, gstack's outside voice is Claude Code, which the sandbox doesn't have.
- Of gstack's Claude Code hooks, only routing, the destructive-command check and the contract are ported at the pin. The start note, team update, plan-tune and the /autoplan and /plan-ceo-review gates are not.
- Hooks are trusted by flag here. A user trusts them once at Codex's startup prompt; whether that trust covers `codex exec` is unchecked (GST-3162, "Not checked").
- Sol calls tools through Codex's code mode, and sub-agents may inherit the parent's whole conversation if GST-3091 is still open at the pin.
- gstack marks its Codex host experimental. gpt-6.1-sol gets gstack's generic GPT profile.

## 9. Pilots (R111) and admission

Each arm's pilot spends at most a tenth of that arm's planned spend (section 11), on its own outputs, before its counted run. Pilot sessions never enter a reading.

- **Part R:** 6 tasks, every arm. They are B1's two smoke tasks (yt-project__unyt-628, getmoto__moto-9590) and the first four tasks, in L1's seeded order, that are in B1's screened pool (hm-screened.txt), share a repository with one of B1's 62 tasks, aren't among them, and that the route table at the pin covers. So none is a counted task, and none is in B1d's held-out pool, which excludes those repositories.
- **Part C:** 6 of the 33 units, the first six in a seeded order (seed 20261119), 1 pass, every arm (24 sessions).

An arm's pilot passes when: every task or unit is supplied (its image builds, its verifier or unit build runs, and its session is graded or scored after at most one rerun); the part under test ran (r-on: the line was delivered and logged in every covered pilot session; c-on and c-high: the contract evaluated every stop and failed open in none, and a keyless positive control blocked); the load detector and the contract readout agree with a hand reading of 2 sessions per arm; and, for part C, the judge passes section 5.5's check. A failing arm gets one named repair to the harness, never to gstack, and one re-pilot within the same tenth. If it still fails, it is left out and reported as left out, and the Captain hears which decision loses its reading.

**The pilot readout** releases only: supply and gap counts, the exposure numbers (line delivered; contract blocks, items, fail-opens), costs (mean, median, 95th percentile), the hand-reading agreement and the judge check. It releases no load rate and no found rate for any arm. It also says plainly, before the counted run spends, if r-off loaded prove-it in every covered pilot session, or if the contract blocked in no c-on pilot session. Those are the ceiling cases of section 1. The counted run goes ahead unless the Captain stops it, since either is a real result for the decision.

**Admission, from data in hand.** Routing: B1's Sol ran on Claude Code at high effort and loaded a skill found only by its description in 60 of 60 sessions; in Codex, gstack's canary trials saw Sol load skills in 28% to 39% (GST-2773). So part R may sit at a ceiling, and the pilot readout shows it. Contract: on Opus in Claude Code, 42 of 66 gstack /review sessions ran the procedure only after the contract blocked (R2 after the pin); in the only Codex probe, Sol ran the adversarial pass without a block (GSTA-635, one session). The pilot shows which way Sol leans.

## 10. Power and the smallest detectable difference

power.txt is printed by power.py (attached; standard library only). Exact two-sided McNemar at 0.05 and 80% power. Part C uses a design effect of 1.2 for the 26 pull-request clusters, so 84 bug-passes count as 70. Part C's MDDs come from exact McNemar with that design effect, and approximate the clustered sign-flip test that part C's readings use (section 5.4).

| Comparison | Pairs | MDD in points |
|---|---|---|
| Routing primary, covered tasks | 40 | 24.5 at 30% of pairs disagreeing, 32.0 at 50%, 38.5 at 70% |
| Routing primary, covered tasks | 30 (the gate) | 27.5 at 30%, 36.5 at 50%, 43.5 at 70% |
| Routing end to end | 60 | 20.5 at 30%, 26.5 at 50%, 31.0 at 70% |
| Contract primary, inside the session | 84 bug-passes | 11.5 with no losses, 15.0 with 2% losses, 18.5 with 5% |
| Between arms (check A, c-on minus c-off, E3, against c-none) | 84 bug-passes | 15.5 at 20% disagreeing, 19.0 at 30%, 22.0 at 40%; none fits at 10% |

So the routing part sees large changes in loads, which is what B1b and B1c saw (Opus moved 38 points between routes). The contract part sees a gain of about 12 to 19 points of the known bugs from the hold. The effort arm sees only a gain of about 19 to 22 points; a smaller effort gain reads "not shown", and E2 stands. R2 on Opus, at the same 2 passes, reported an MDD of 24.5 by its own admission rule.

**R113.** Neither counted run is planned above $500 paid at the prices in section 11: part R's counted sessions come to $93 and part C's, the effort arm, its judging and VM shares included, to about $490. So neither takes an interim look. If the pilot's re-pricing puts a counted run above $500 before it starts, a dated change before its first counted session adds R113's one look at half its units, in seeded unit order: O'Brien-Fleming two-look bounds for this plan's two-sided 0.05 per decision, |z| of at least 2.797 at the look and 1.977 at the end (power.txt), a futility stop when conditional power under the planned effect (the MDD above) falls below 10%, an early stop flagged as possibly overstated, and no other look at any primary. An arm stops only when every decision that reads it has stopped.

## 11. Money

Planning prices, replaced by the pilots' measured costs. Per session at low effort: a bug task $0.55 in a gstack arm and $0.45 in r-none (B1's Sol sessions on Claude Code at high averaged $0.61 and $0.45); a review $1.50 in c-on and c-off and $0.40 in c-none (R2's plain Opus review cost $0.73 at twice Sol's token prices; Codex's /review runs one adversarial reader where Claude Code's ran an army); a review at high $3.00 (a guess at twice low). GPT-6.1 Sol per million tokens: $2 input, $10 output, $0.10 cache read, $2.50 cache write (src/runner/pricing/prices.ts). Judging: Opus matching and adjudication at R2's measured $0.04 a session, with second and third reads and fallback extraction; gold labels by Astra and Argon on about 60 states.

| Item | What it pays for | Central | Cap |
|---|---|---|---|
| r-pilot | 18 sessions | $9 | $45 |
| r-main | 180 sessions, and its VM share | $99 | $165 |
| c-pilot | 18 sessions (c-on, c-off, c-none) | $21 | $60 |
| c-main | 198 sessions, and its VM share | $234 | $345 |
| h-pilot | 6 sessions at high | $18 | $85 |
| h-main | 66 sessions at high, and its VM share | $201 | $330 |
| judge | matching, adjudication, reads, gold for both checks | $55 | $80 |
| **Paid, all items** | | **$637** | **$1,110** |

Caps follow the crew's rule for parallel ledgers: 1.35 times central, plus the parallel sessions times the per-session reserve ($5 for 6 bug sessions at once; $8 or $15 for 4 review sessions at once), plus the VM share. The Captain records each cap before its first lease. A cap stop ends its part INCOMPLETE and is never retried to change a reading.

**Crew model use,** not in the items above: this prereg and its review, about $60; building the harness and the scorer with a gate-class /ship, about $130; running, judging and the results post, about $60. About $250, with a stop at $350 that comes to the Captain.

**All-in:** about $890 at planning prices with the effort arm, and about $660 without it (paid $416, caps $700). The plan's estimate of $250 to $400 all-in can't buy two parts with R44's no-gstack arms, R111's pilots and R78's gold labels; both versions pass the Captain's $600 line, and both sit under R71's $2,000 guideline. Without the effort arm, this eval says plainly that it can't decide E3, and E2 stands by default.

## 12. Harness plan

Built on one branch and landed before the counted runs, after this post merges (R77: this post and the results are the experiment's two pull requests; the build is infrastructure). The scorer and readouts are gate class (R51).

1. **Driver additions** on the shared Codex driver, after GEVA-555's pull request lands: the trust flag in gstack arms, no `--ephemeral`, the rollout and hook-log copy-out, and init.json's new fields (section 2).
2. **Part R's rig: new.** B1b's rig is Lane B on Harbor with a Claude Code agent and an Anthropic Messages proxy, and the shared Codex driver runs in the skill-eval trial harness, not in Lane B. Part R needs a Lane B agent that runs Codex in B1's task containers: B1's images, verifiers, prompt, part machinery and ledger unchanged; Codex at the pin from the runtime layer; its command line built by the shared driver's own functions, so no second copy of the flags exists; model calls through a metering proxy route that speaks the Responses API (the skill-eval proxy has one; Lane B's does not). The build picks the route and names it in the pin post.
3. **Part C's rig:** review-units (src/trial/review/run.ts) with `--host codex`, which already selects the Codex driver for code units, with the four arms as its arm specs, R2's suite, R2's judge pipeline with this post's judge models, and R2's analysis code. New: the first-stop state, the per-state findings and the within-session analysis.
4. **Detectors:** section 4.5's load detector and section 5.6's contract readout, over rollout JSONL.
5. **The route table** command, keyless.
6. **Reason codes** in src/errors/codes.ts for every new gap and stop.

**Tests before any paid call,** with fixtures built from real Codex 0.170 rollouts captured against the stub: a direct read, a code-mode read, a read that names the path and fails, a grep that prints only the description line (not a load), a code-mode cell that reads prove-it and gstack's verify and passes on only verify's text (not a load), a read of gstack's verify that must not count, an injected skill item, and a sub-agent's thread file; a hook line delivered and one missing; a contract block, a met session, a fail-open and a false block; a first-stop message with and without a JSON block; check A's switch, on the interval and on the sign-flip test; 4 gains in 4 clusters with no losses, which must not read KEEP; and every row of section 1's three tables, each in both directions. The dry run opens and settles one ledger lease per item on a temporary ledger.

## 13. Order, machines and timing

Keyless checks and the pin post; then r-pilot, c-pilot and h-pilot, and the pilot readout to the Captain; then r-main, and c-main with h-main interleaved by unit in seeded order; then judging, the confirmation check and the analysis. Runs go detached on Ubicloud VMs that stay up for the run, with UBI_OWNER set to this thread's code, never on a Capy machine; every VM is destroyed when its work ends. No paid call before 2026-11-21 06:00 UTC.

## 14. Limits

- One model, one Codex version and one effort for the main arms. Results at low effort are what a Codex user gets by default; gstack's E2 line recommends high.
- Routing: one skill, one task family, a stand-in skill installed by hand, and a matcher tuned on these prompts. The coverage count is in-sample; follow-through isn't.
- Routing has no test-first reading. B1's scorer reads Claude Code transcripts and is not ported; passes are reported instead.
- The contract: 33 units on gstack's own repositories, a development suite, where 41 of 42 bugs came from gstack-family reviews. Its claims hold for these units at these settings.
- The within-session design rests on the hook changing nothing before it fires. The probe shows it for the prompt, and check A tests it on the data.
- E3 covers /review. Effort may matter more or less for other workflows.
- Hooks trusted by flag, not through Codex's startup prompt.
- The no-gstack arms are clean by construction; their read audits are descriptive.

## 15. Departures from the brief

- **Effort.** The brief and the plan say to match Sol's effort to a Claude arm. This eval has none, so the main arms run at Codex's default (low), and one arm runs /review at high to inform E3.
- **Cost.** Over the plan's $250 to $400 (section 11); the Captain decides.
- **Infrastructure.** Part R needs a Codex agent in Lane B, beyond the driver pull request the brief relies on.
- **The driver.** It drops `--ephemeral`, which the shared driver passes today, because the contract hook and the load detector both need the rollout.
- **Model.** GPT-6.1 Sol, as R54 names it, not GPT-6.2 Sol, which Codex lists first.

## Credits

The tasks are SWE-rebench's (Nebius AI R&D, CC-BY-4.0). The review units are public pull requests on garrytan/gstack and garrytan/gbrain, and their bugs were mined by this repo's U14 rules. The Prove-It steps are from agent-skills by Addy Osmani (MIT), carried in B1's gstack-shaped skill. Codex CLI is OpenAI's.

<details>
<summary>Agent notes</summary>

The keyless probes (probes.txt) ran on this thread's machine on 2026-11-19 with Codex 0.170.0 and a local stub; they made no model call. The power tables are power.py's output, run the same day.

Ledger items, central and caps as in section 11. Each item opens with its approval row at the cap the Captain records. A session reserves its allowance as it opens and settles at its metered cost; a refused reserve is a cap stop. Before each launch the guard refuses when the item's projection passes its cap, or when every item's projection plus the crew's model use passes the all-in stop the Captain sets.

gstack: ok 1.101.0.0 for=ship on this machine.

</details>

## Disclosures

gstack is Garry Tan's own project. gbrain is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
