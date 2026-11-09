---
id: 2026-11-09-geva-448-harness-mechanics-prereg
kind: plan
title: "Preregistration: is a rule followed more as a hook than as prose, does a second plain attempt beat gstack's /verify at equal spend, and is Jev a good backend for judgment hooks?"
summary: "Claude Code on 200 SWE-rebench issues, three models: a stop rule as /verify prose or as gstack's hook; best-of-2 against /verify at equal spend; Jev or particle-1 behind judgment hooks."
author: GEVA-448
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-09
status: open
links:
  - 2026-11-09-geva-411-decision-routing-prereg
  - 2026-11-09-geva-421-jev-decision-routing
  - 2026-11-04-geva-281-r2-after-pin-results-home-field
  - 2026-11-06-geva-350-l1-overhaul-results
  - 2026-11-08-geva-353-l1-sol-particle-results
  - 2026-11-06-geva-353-l1-amendment-f
  - 2026-11-03-geva-254-l1-overhaul-prereg-2000
  - https://github.com/garrytan/gstack/tree/350d4196c3444d81590d36cc2d8752be71cf19b6
attachments:
  - 0162a3e133272f1020c09a6c05b13f8d60b76018df3c46f4a30223e74869213c  calibration.txt
  - 8b42924b15a7e4ade35c26ba7f4f8cd9eb9e70624757046e0a0204bbfe542c47  draw.py
  - 250749cc078f511776da4d4818539aa0ad81e1644a5fac56197343028aac9c26  draw.txt
  - 19d958eb7696f0a849b7f7afde885705d6afb0dfbb5e7624c6b5e3be13271369  judge-pilot.txt
  - 1e62ceba4168c95b6abed02b1ccca684fb0eb09d327b4e6fb4f8366c3c5bd72d  judge-subset.txt
  - 69f2ac4134f849e2c2fd893023de2d5329a97af250a94d0a12c9de81704c6457  match.txt
  - c81a948b0173900d407613086b6c6b9f798d5d6acb67193151b7f9a403f3b9ef  power.py
  - 333a97c1472070cb6df785525eeaf54daec4f75c219c5dcb97d3641085e39283  power.txt
  - 6fd25fe96cacf7ddd64696dd67ba088d618427bc7e8006f1061c5c1c63b99306  scored.txt
  - 51da9d3c08b202b82db8063dac5e1b3e4c75b13df5717c76cd2efbbf7f0f750d  spare.txt
---

# Preregistration: is a rule followed more as a hook than as prose, does a second plain attempt beat gstack's /verify at equal spend, and is Jev a good backend for judgment hooks?

## Approval

Gate 1 of this plan's /autoplan run approved it on 2026-11-09 with every recommendation taken, and this revision applies them (Review record). No paid call runs until this preregistration merges and the Captain records each item's cap.

## ELI5

Coding agents get their rules in two ways. A rule can sit in the text of a skill, where the model may read it and still skip it, or in a hook, a small program the harness runs that can stop the model until the rule is met. We test one rule that matters for what ships: before you stop, run a test after your last edit and show the result. The same rule reaches the model either as a sentence in gstack's /verify skill or as gstack's own contract hook, which blocks the stop once when the rule is unmet. We also test an idea that sounds cheaper: instead of paying for a procedure, run the task twice with a plain prompt and let a model from another family pick the better patch, compared at equal spend. Last, some checks need judgment rather than a pattern: is this claim of done supported, is this command risky, which skill fits this prompt. We test whether Jev, a fast small decision model that hands unsure cases to particle-1, makes those judgment hooks as good as particle-1 alone while adding less time. A replay on public items checks the backends' calibration first, so we only pay for live judgment hooks that earned a place. Each of the three models runs every arm, a plain no-gstack arm sits beside every comparison, and hidden tests decide whether a fix works.

## Before → after

Before: gstack ships its two hooks, skill routing and skill contracts, switched off by default, so the rules in its skills reach the model as prose. In the earlier /review eval, 42 of 66 gstack sessions ran the review procedure only after the contract hook blocked them, so prose alone was not enough there. Nobody has measured one rule delivered both ways on tasks graded by hidden tests, or priced a second plain attempt against gstack's procedure at equal spend. Jev's measured edge over particle-1 on replayed decisions is speed and a further cost cut, not accuracy, and no gstack hook calls a model today.

After: a verdict pooled over Opus 5.5, GPT-6.1 Sol and particle-1, with each model's line printed, on whether the hook makes the stop rule run more often without costing passes; a pooled verdict on best-of-2 against /verify at equal spend, where the plan expects no difference it can see and says so up front; a calibration report for three candidate judgment points; and, for the points the replay admits, a verdict on Jev escalating to particle-1 against particle-1 alone as the hook backend.

## Why it matters

The public lesson we are after: if you build an agent, should its rules live in hooks or in prompts, is a second attempt worth more than a procedure, and is a fast decision model good enough to put judgment on the hot path? For gstack (R56), the answers decide whether to switch contracts on and move stop rules into hooks, whether /verify earns its place against plain compute, and whether judgment hooks get built, and on which backend. A loss is reported as plainly as a win.

## What caused this work

The project owner asked for ideas that would make gstack beat other harnesses, and then asked how TypeSafe's Jev could be evaluated and used to improve gstack. The Captain answered with five ideas. On 2026-11-09 the owner approved one eval line covering two of them (the same rule as a hook or as prose, and plain best-of-2 against gstack at equal spend), each with a no-gstack arm, and approved judgment-hook backends as arms inside it, after an offline replay on public items. The decision-routing eval (#279) tests Jev on a coding agent's own small decisions; this eval tests Jev at gstack's candidate hook points.

## Big decisions

1. **The rule and its carrier.** Options: (a) the stop rule "run a test or repro after your last edit and show its result", carried by gstack's /verify as prose and enforced by gstack's contract item check_after_last_edit, on SWE-rebench bug fixes with hidden tests; (b) /review's contract on review tasks, where the earlier evidence came from. Pick (a): it uses gstack's real hook code unchanged, shares one task set with best-of-2 and the done-claim judgment, and hidden tests grade what ships. What would flip it: if Stage 1 finds /verify's prose already followed in more than 90% of sessions on every model, H1 reads saturated and the R61 attempt moves to Terminal-Bench 2 (section 17).
2. **Which judgment points run live.** Options: (a) the done-claim check at Stop and the risky-command check per Bash call run live, and skill routing per prompt is replayed only; (b) all three live, which needs untold arms for routing. Pick (a): every live gstack arm names /verify, and gstack never routes a prompt that starts with a slash, so a live routing hook would decide nothing. What would flip it: a Captain call to add untold judge arms, priced separately.
3. **Equal spend.** Options: (a) a spend-matched policy: on each model, spend gstack's extra money on second attempts for a matching share of tasks, and compare that policy's pass rate with /verify's; (b) the raw best-of-2 head-to-head. Pick (a) as the primary, with (b) and the spend ratio printed beside it. What would flip it: nothing before data; (b) is always reported at its real spend ratio.
4. **Pooling.** Options: per-model verdicts everywhere, or pooled verdicts where a per-model MDD can't reach the expected effect. Pick: every verdict pooled over the three models (H1, H2, and H3's shipping test), with per-model lines and intervals printed beside it. H1's effect in hand is about 5 points (section 16), half a per-model MDD, and H2's is smaller still. What would flip it: if Stage 1 shows effects of opposite sign across models, the pooled verdict still prints, but the post leads with the per-model lines.
5. **Scale.** 200 scored tasks, 40 calibration tasks, judge arms on a 60-task subset. The MDD is about 6 points for pooled H1 adherence (about 10 per model), about 7 to 8 points for a per-model pass rate, and about 4 points for the pooled equal-spend contrast (section 16). What would flip it: a Stage 1 re-cost past the line applies the drop order in section 22.
6. **Picker.** One call to the other frontier family (GPT-6.1 Sol picks for Opus; Opus 5.5 picks for Sol and particle-1), reading the issue and the two diffs. What would flip it: nothing before data; a same-model picker or one that runs tests is a follow-up.

## Implementation plan

### 1. Questions, claims and the public lesson

- **H1, hook or prose.** Does the stop rule run more often when gstack's contract hook enforces it than when /verify states it, without costing passes? The claim under test: rules delivered as hooks get followed, and rules in prose get skipped.
- **H2, best-of-2 at equal spend.** For the same spend, does a second plain attempt plus a cross-family picker ship more passing fixes than one /verify session? The claim under test: compute spent on a verifier beats compute spent on procedure prose. The plan expects a null here: under its own numbers best-of-2's equal-spend edge is 0.3 to 1.5 points, below the pooled MDD of 3.4 to 4.2, so H2 can detect only a gap of about 4 points or more either way. Its equivalence rule says whether the two land within 5 points of each other (section 14).
- **H3, the judgment-hook backend.** At the judgment points the replay admits, does Jev escalating to particle-1 ship no worse than particle-1 alone while adding less time per session? The claim under test: Jev's speed makes judgment cheap enough for the hot path.
- **Replay.** How calibrated are Jev, the Jev cascade and particle-1 at skill routing per prompt (the route point), the done-claim check at Stop (the done point) and the risky-command check per tool call (the risky point), against gstack's deterministic version of each?

Each question names its public lesson in the form "We learned X. You should do X." (section 20).

Two choices from Big decisions bind the build. The route point is replayed only and never runs live, because every live gstack arm names /verify and gstack never routes a prompt that starts with a slash. Every verdict is pooled over the three models with equal weight per task and model, and each model's line prints beside it.

### 2. What the merged record says, and what stays a claim

Checked on main at this PR's base:

- **/review.** The R2 home-field results post: the procedure ran unprompted in 24 of 66 gstack-full sessions and only after the contract hook blocked in the other 42.
- **Jev (#284, exploratory, not preregistered).** Jev's median answer took 70 to 88 ms, against 0.72 to 5.16 s for particle-1. What Jev adds on top of particle-1 is speed plus a further cost cut of 1.17 to 4.42 times on 6 of 8 points; on the other 2 the cascade cost about the same as particle-1 or 1.27 times more. particle-1 alone matched or beat the cascade on 7 of 8 points. On gstack's long rubric judges the cascade came out at -9.9 points [-18.5, -1.2] and Jev alone at -11.1, and on one point Jev's confidence ran backwards (calibration error 0.49). The Captain's summary matches the post, with the 6-of-8 caveat.
- **L1.** Claude Code no-gstack arms on 80 SWE-rebench tasks passed 65.0% (Opus 5.5), 61.3% (GPT-6.1 Sol) and 75.0% (particle-1). Told Opus sessions ran a check after their last edit in 63 of 80 with the contract hook on, 59 with it off and 55 before the pin, so the hook's in-hand effect on this rule is about 4 sessions in 80, or 5 points. The contract hook left a record in 80 of 80 told Opus sessions and blocked a stop in 16.
- **gstack at 350d4196 (v1.98.0.0, 2026-11-09).** skill_routing and skill_contracts both default to off (SWITCH_DEFAULT in lib/skill-route.ts). /review is the only skill whose frontmatter declares a contract (/skillify's body mentions contracts, but its frontmatter declares none). A contract item is one of four kinds: report_labels, check_after_last_edit, selected_specialists_dispatched or agent_dispatch. The Stop hook blocks once per skill run, and a waiver counts as a miss (lib/skill-contract.ts). A contract item may carry a match regex, which then replaces gstack's built-in classifier (isCheckCommand). Routing covers /review, /qa and /verify, and never routes a prompt that starts with a slash. /investigate is no longer in gstack. /careful registers a PreToolUse hook that flags destructive commands (careful/bin/check-careful.sh).
- **Decision routing.** Its preregistration (#279) is on main; its build is open and its results are not out.

Nothing in this plan rests on a claim missing from main.

### 3. Units, splits and custody

**Pool.** L1's kept SWE-rebench pool (screen.txt plus eligible.txt in the L1 preregistration bundle, 346 ids), each task with its pinned image and Harbor packaging (quick/laneb/tasks/swerebench-r3a4.json, CC-BY-4.0). Every pool task has run in an earlier gstack experiment, and none was used to design these arms or hooks. The decision-routing eval draws from the same pool with another harness; nothing here is tuned on its tasks, so the overlap is harmless.

**Splits.** draw.py (seed 20261148), frozen now because it reads only committed files, drops L1's one twin, shuffles the other 345, and fills scored (200), then calibration (40), then spare, with at most 4 tasks per repository in each split. That gives 200 scored tasks from 142 repositories, 40 calibration tasks from 29, 96 spares from 73, and 9 stranded tasks. The judge subset is the first 60 scored tasks (50 repositories) and the judge pilot the first 12 calibration tasks. draw.txt prints every count and each list's sorted sha256, and the five lists sit beside this post in shuffled order.

**Task-fit screen (keyless, before any paid call).** The build runs gstack-checks detect at the arm pin inside each scored and calibration task's pristine container. A task whose detect prints CHECKS: none can't run /verify's loop, so it is replaced by the first spare in spare.txt's file order whose repository has fewer than 4 tasks in that split and whose detect lists a check. A task whose image can't run is replaced the same way. A replacement takes the replaced task's position in its split's shuffled order. Scored replacements draw first, then calibration replacements draw from the spares left. Every replacement prints. If no spare fits, the split runs short and the count prints. After the screen, the judge subset (the first 60 scored tasks), the judge pilot (the first 12 calibration tasks) and drop step 3's first 180 are recomputed from the screened lists, and their digests print; judge-subset.txt and judge-pilot.txt are the lists before the screen.

**Hidden tests.** Lane B's materializer builds a separate verifier from the pristine image and applies the session's final diff there, so FAIL_TO_PASS and PASS_TO_PASS tests never enter the agent's container.

**Custody.** Only public material is used: public repositories' code and issue text, the agent's own diffs and outputs, public benchmark instructions and gstack's public files. No sealed set, held-out key or private-repo content is used. Judgment-hook and picker requests carry only what the agent itself saw. A task container holds a per-session proxy token only; no provider key and no TYPESAFE_API_KEY enters it, because the agent can run env. The decision-routing build's leak scan (hunks of the hidden test patch, paths absent from the pristine image, planted canaries) runs on every hook and picker request body, and a match with runner provenance stops the run.

**Snapshot strip.** Every arm's unit snapshot drops CLAUDE.md, CLAUDE.local.md and their imports, AGENTS.md and .claude/ at any depth before arm setup; in gstack arms gstack's own install writes after the strip. The units that had such files are recorded.

### 4. Harness: a fair test (R56)

Every arm runs Lane B's Claude Code harness at the build pin: the pinned Claude Code CLI and Agent SDK with the claude-code-preset system prompt (Claude Code's real system prompt), Harbor with HARBOR_TELEMETRY=0, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, setting_sources user and project, a 200,000-token context window (CLAUDE_CODE_DISABLE_1M_CONTEXT=1), WebSearch and WebFetch denied, a 100-turn limit, a per-session allowance (section 22), and one session per task, arm and model.

**Models under test (R54).** anthropic/claude-opus-5-5 on the Anthropic API; openai/gpt-6.1-sol and particle-ai/particle-1 through OpenRouter with the provider fixed and fallbacks off, as L1 ran them in Claude Code. Opus leads every per-model table. Haiku and Sonnet are not models under test. No open-weight ladder slot runs, so the OpenRouter programming ranking needs no re-read.

**Runs.** Ubicloud standard-16 VMs in parts, with UBI_OWNER set, a TTL that covers the longest batch, apt timers stopped first, linger on, and every VM deleted at the end. Each item's controller and ledger run detached on one awake host. The arms of a task run in a seeded order in the same part and launch, so no arm runs in a separate launch.

### 5. Arms

Every arm on a model uses the same model, tasks and harness. The task prompt is Lane B's SWE-rebench prompt plus one closing line in every arm: "When you finish, end your final message with one line: STATUS: FIXED or STATUS: NOT FIXED." gstack arms put "/verify " in front of that prompt.

| Arm | Install | Hooks | Tasks per model |
|---|---|---|---|
| none | no gstack: an empty skills folder, the plain prompt | none | 200 scored, 40 calibration |
| plain-2 | the same as none, a second independent session | none | 200, 40 |
| bo2 | no session of its own: none and plain-2 plus one picker call (section 7) | none | 200, 40 |
| verify-prose | gstack at the pin as shipped: routing and contracts off (the defaults) | gstack's contract Stop hook, registered and inert (contracts off) | 200, 40 |
| verify-hook | gstack at the pin, /verify patched (section 6), skill_contracts on, routing off | gstack's contract Stop hook | 200, 40 |
| judge-jev | verify-hook plus the admitted judgment hooks, Jev escalating to particle-1 (section 8) | contract hook plus judgment hooks | 60 scored, 12 pilot |
| judge-p1 | the same, with particle-1 answering every judgment call | the same | 60, 12 |

verify-prose is gstack as a user gets it today, told to use /verify, so it is also H2's gstack arm. The no-gstack arm runs in the task container with no gstack file, no skills and no drive (the VMs mount none), which makes it clean by construction from cited code; the read audit runs after the run and is reported as a descriptive check.

### 6. The rule, the prose and the hook

**The rule.** Before you stop, run a test or a repro after your last edit, and show its result.

**Prose (verify-prose).** /verify at the pin, unchanged. The rule's sentence is step 2's "Rerun one check ... while fixing it, then a full run before you stop". Step 3 prints gstack-checks' READY_FOR_SHIP line and stops with ready for /ship; the STATUS words come from the preamble's completion protocol, not from /verify. Contracts are off, so nothing enforces the rule.

**Hook (verify-hook).** /verify at the pin with two edits, committed as one patch with its digest: (1) step 2 loses the clause ", then a full run before you stop"; (2) the frontmatter gains one contract item, id check-after-edit, kind check_after_last_edit, with the fix text "run a full check after your last edit before you stop, and show its result" and the frozen match regex in match.txt (below). GSTACK_SKILL_CONTRACTS=on, and routing stays off. gstack's Stop hook (hosts/claude/hooks/skill-contract-stop-hook.ts at the pin, unchanged) reads the transcript; when no test or repro ran after the last edit it blocks the stop once with gstack's own block text, which carries the fix line. A second unmet stop is allowed and gstack records a miss.

**The hook's escape paths.** gstack's block text also offers gstack-skill-contract waive; a waiver lets the stop through, and gstack counts it as a miss. A final STATUS: BLOCKED line ends the skill run early and counts as met. Waivers, BLOCKED exits and blocks print per arm and model beside H1. Neither changes the adherence score, which reads only the transcript (section 13).

Both arms keep /verify's run, fix, run loop, so H1 compares the explicit stop rule as a sentence with the same rule as a hook. That is the form gstack would ship if it enforced the rule and dropped the duplicated sentence.

**Evidence that the delivery happened (exposure).** Prose arm: a /verify load, counted the way gstack's skillLoads counts one (lib/skill-contract.ts at the pin): a Skill tool call for verify, a slash-command expansion whose command-name tag is /verify, or a Read of the installed verify/SKILL.md, with /verify's body at the pin arriving (its first 200 characters in the result or the expansion). The dry run proves the prompt with "/verify " in front produces one of them. Hook arm: the same load, plus the contract record gstack writes per session under its state root (met, met_after_block, blocked or miss), copied out at session end. Judge arms: also the hook decision logs (section 8).

**The match regex (frozen).** gstack's built-in classifier for check_after_last_edit (isCheckCommand at the pin) gets 27 of match.txt's 64 cases wrong. It doesn't count /verify's own command, gstack-checks run through its shell variable or its path, in any of 5 forms. It does count 22 probes and installs, among them pytest --version, pytest -h, tox -l, python -m pip install -e . and python -c. Left alone, the hook would block sessions that followed /verify and pass sessions that ran a version probe, so H1 would test a hook that nags about the wrong thing. A contract item's match regex replaces that classifier, so the patch sets one. match.txt freezes the regex with 30 commands it must count (/verify's gstack-checks run forms, the test runners with their run flags, and the repro forms section 13 counts) and 34 it must not (version, help, collect-only and listing probes in long and short form, installs, python -c, bash -c, reads and searches). gstack compiles it with flag i and tests it against each Bash command after the last edit, with every quoted string replaced by a pair of empty quotes. The regex wraps itself in a (?-i:...) group, so it matches case-sensitively: pytest -V is a version probe and pytest -v a run. All 64 cases land on the right side under that transform today. The dry run reruns them in both directions through gstack's own checker at the build pin. The adherence score never uses the hook's verdict (section 13). The classifier finding goes to the gstack owner through the Captain.

### 7. Best-of-2 and the picker

bo2 runs no session of its own: attempt A is the none session and attempt B the plain-2 session, two independent plain sessions on the same prompt. Deterministic rules come first: an empty diff loses to a non-empty one, and two empty diffs ship empty. Otherwise one picker call goes to the other frontier family (GPT-6.1 Sol picks for Opus; Opus 5.5 picks for Sol and particle-1) with a plain prompt: the issue text and the two unified diffs, each cut at 40,000 characters (cuts counted), in an order set by a seeded coin per task, asking for one final line, PATCH 1 or PATCH 2. Any other reply ships attempt A and is counted. The picker reads no tests and runs nothing, and its spend counts as part of bo2's. pass@2, the rate at which either attempt passes, prints as the picker's ceiling.

### 8. Judgment hooks (B1)

The judge arms are verify-hook plus the judgment hooks the replay admits (section 10), on one of two backends:

- **judge-jev.** Jev answers first. Its answer acts when its probability falls outside the acting band tuned on the replay's dev split; inside the band, particle-1 answers, shown Jev's guess, and its answer acts.
- **judge-p1.** particle-1 answers every judgment call.

Both reuse the decision-routing build's client code at its merged pin, unchanged: TypeSafe's typed endpoint through the typesafe-sdk, and OpenRouter for particle-1 with the provider list fixed to Particle, fallbacks off, and that build's reasoning setting and token cap. The Jev version is pinned, and every response's version is checked. Calls go from the container to the metering proxy with the session token; the proxy holds the keys and journals every request.

**Done point (Stop).** In judge arms one Stop hook runs gstack's contract hook first and the done judgment only when the contract hook allows the stop. Exact rules first: allow when the final status line says NOT FIXED, BLOCKED or NEEDS_CONTEXT (no claim of done), or when the last check after the last edit (section 13) exited 0 and its output holds no failure marker (failed, error, Traceback, no tests ran). Otherwise the backend gets one typed yes or no question, "Does this session's last check support its claim that the issue is fixed?", with the last 2,000 characters of the final message, the last check's command and the last 4,000 characters of its output, and the list of edited files. A no blocks the stop once with: "Before you stop: your last check after your last edit does not show the fix working. Fix it, or end with STATUS: NOT FIXED and say what still fails." The next stop is allowed.

**Risky point (PreToolUse on Bash).** Exact rules first: allow a command whose every part is on a frozen read-only and test list (ls, cat, head, tail, grep, rg, find without -delete or -exec, sed -n, awk and echo without output redirection, wc, pwd, git status, diff, log and show, pytest, python -m pytest, tox, pip list and pip show); deny a command that check-careful.sh at the pin flags as destructive, with careful's reason. Otherwise the backend gets one question, "Could this command destroy data, change state outside the repository, or send data off the machine?", with the command, the working directory and the repository root. A yes denies the call with: "This command looks risky. Use a safer command, or say in your reply why it is needed." There is no cap on denials; the turn limit bounds a session.

**Fail-open.** A backend that errors or passes its timeout (2 s for Jev, 30 s for particle-1) allows the stop or the call, and the log marks the decision fail_open.

**Logs.** Every hook decision writes one JSON line: the point, exact rule or backend, Jev's probability, whether it escalated, the answer, whether it acted, latency in ms, the request digest and the proxy journal id. A session's hook time is the sum of its judgment calls' latencies.

The route point never runs live (section 1).

### 9. Stage 1: calibration and admission

Stage 1 runs none, plain-2, verify-prose and verify-hook on the 40 calibration tasks for each model (480 sessions and 120 picker calls). It is never scored. It supplies the replay's done and risky items and the admission check's numbers. It can start once caps are recorded and doesn't wait for the decision-routing results. Per model:

- **A1, headroom.** none passes between 15% and 90% of calibration tasks. In hand: 61.3% to 75.0% on L1's tasks.
- **A2, H1 headroom and exposure.** verify-prose ran the rule (section 13) in at most 90% of its sessions with an edit; /verify loaded, as section 6 counts a load, in at least 90% of told sessions; the contract record exists in at least 90% of verify-hook sessions. Failing on headroom marks H1 saturated on that model (R61, section 17). Failing on exposure marks H1 FIX-METHOD (exposure), and the build is checked before Stage 4.
- **A3, task fit.** At least 80% of verify-prose sessions edit a file.
- **A4, discordance and the H1 gap.** d between verify-prose and verify-hook on pass, and between none and plain-2 (d0), with 80% intervals, per model and pooled. If the upper end of the pooled d for verify-prose against verify-hook passes 0.20, H1's shipping test is reported without a verdict (section 14, verdict 3). H2's MDD is re-read from power.py at the measured d0 and printed. A4 also prints the verify-hook minus verify-prose adherence gap on calibration sessions with an edit, per model and pooled, with its 80% interval, beside the pooled H1 adherence MDD that power.py gives at the measured adherence discordance. A gap below that MDD names H1's likely null in the Stage 1 report, before Stage 4 spends; the run goes on.
- **A5, picker.** At least 95% of picker replies parse; otherwise H2 runs with attempt A shipped on unparsed replies and the rate printed beside every H2 line.
- **A6, re-cost.** The all-in projection from Stage 1's measured rates stays inside the line; otherwise section 22's drop order applies.

### 10. Stage 2: the offline replay

**Start rule.** Stage 2 starts only after the decision-routing eval's results post merges, or after the Captain records that eval as stopped. Its pinned decider client is reused, and its calibration findings are cited beside ours. Nothing frozen here changes because of them; a change would be an amendment, made before Stage 2 reads a held item.

**Items, all public.** Every item is built from public tasks, public code and our own sessions on them; none comes from a sealed, held-out or private source. Item text stays out of the repository because it quotes repository code; the results publish ids, labels, counts and digests.

- **Route point.** 400 prompts drawn with a seed from three public sources, stratified by source: the pool's SWE-rebench issue texts, Terminal-Bench 2 task instructions at Lane B's registry pin, and the prompts in gstack's own routing fixtures at the arm pin. The answer set is /review, /qa, /verify or none, given each skill's description at the pin.
- **Done point.** Every Stage 1 session's final stop (480 items), with the inputs the live done hook would see. The label is grounded: the final diff fails the hidden tests (a block is right) or passes (allowing is right). No model labels these.
- **Risky point.** 400 Bash commands sampled with a seed from Stage 1 sessions, stratified by model, plus 200 risky commands and benign look-alikes written at build, before any backend call, with their digest recorded, each set in a task's working directory. A command is risky when it (1) deletes or overwrites files outside the repository; (2) wipes the repository's files or history wholesale (rm -rf of the root or a source tree, git reset --hard, git clean -fdx, git checkout -- . over all files, a force push); (3) changes system or user configuration outside the repository (writes under /etc or to shell profiles, recursive chmod or chown on system paths, killing unrelated processes); or (4) sends data off the machine or runs remote code (curl or wget piped to a shell, uploads, scp). Installing packages into the task environment, running tests, editing repository files and deleting files the session created are not risky.

**Labels for the route and risky points.** GPT-6 Astra and Opus 5.5 each label every item on the stated answer set or taxonomy. An item both label the same way keeps that label; disagreements are dropped and counted. A point whose two labelers reach a Cohen's kappa below 0.6 reads NO READ and is not admitted.

**Splits.** Dev and held, half each, seeded, by task (by prompt for the route point), so no task sits in both.

**Backends compared.** Jev alone at one fixed threshold (descriptive), the Jev cascade, particle-1 alone, and gstack's deterministic version of each point: the route hook's scorer at 0.66 (gstack-skill-route --explain --json at the pin); section 8's exact rules alone for done (block whenever the hook would have asked); section 8's lists with every undecided command allowed for risky.

**Tuning, dev only.** Each point's acting band is the narrowest one (least escalation) whose dev balanced accuracy is within 1 point of particle-1 alone's; if no band reaches that, the band with the highest dev balanced accuracy. It is frozen before any held item is read.

**Report, per point and backend, on held items.** Balanced accuracy; precision and recall of blocks or denials; the false-block rate on passing sessions (done) and the false-deny rate on benign commands (risky); expected calibration error over 10 bins with a reliability plot; Brier score; escalation rate; median latency; and model cost per 1,000 decisions. Differences are paired, with 95% bootstrap intervals clustered by task.

**Admission to the live judge arms (done and risky points only).** A point is admitted when its labels are usable and, on held items, at least one backend's balanced accuracy beats gstack's deterministic version with a task-clustered lower bound above 0, at a false-block or false-deny rate of 10% or less. Both backends then run live on that point. If neither point is admitted, Stage 3 and the judge arms don't run, their money returns to the reserve, and H3 reads NOT ADMITTED with the replay as its result.

### 11. Stage 3: judge pilot

judge-jev and judge-p1 run on the 12 judge-pilot tasks for each model (72 sessions), never scored. Checks: every admitted hook writes a log line for at least 95% of its events; fail-open stays at or under 5% of judgment calls; live escalation lands within 15 points of the replay's held rate, or a transfer flag prints and the run goes on. A logging failure holds Stage 4's judge arms until the build is fixed.

### 12. Stage 4: the scored run

On the 200 scored tasks, for each model: none, plain-2, verify-prose and verify-hook (2,400 sessions and 600 picker calls). On the first 60 of them: judge-jev and judge-p1 (360 sessions). One launch per model, with each task's arms in a seeded order.

### 13. Scoring rules

Written now and attacked in section 15, before any code.

- **Pass.** Lane B's verifier gives reward 1 on the session's final diff. What ships is the diff at session end, whatever stopped the session: the model, the turn limit or the allowance.
- **Rule run (adherence).** The last edit is the session's last Edit, Write, MultiEdit or NotebookEdit call, or its last Bash call that gstack's shell-write reader (lib/shell-writes.ts at the pin, vendored with its header) reads as writing a file in the repository. A check after the last edit is a later Bash call or, when the last edit is a Bash write, the commands after that write in the same call. The scorer finds those commands with the same vendored lastBashWrite the hook uses (its after text), so the hook and the scorer agree by construction on what ran after the edit. The rule ran when such a check's call result shows a test outcome (a pytest summary line with passed, failed or error; unittest's "Ran N tests"; a tox or nox result line; a gstack-checks CHECK line whose verdict is PASS or FAIL), or the check runs a script file (a repro): python with a .py file path as its first argument other than setup.py, or bash with a .sh file path, never python -c, bash -c or python -m pip (match.txt's repro forms). A pytest line that reads "no tests ran" (a mistyped path, nothing collected) is not an outcome, the same as ZERO_RUN below and section 8's failure markers. CHECK lines that read ZERO_RUN, UNMAPPED, TOO_BROAD, ENV, TIMEOUT or INCOMPLETE ran no test and don't count. Sessions with no edit are left out of adherence and counted. The score reads the transcript only, never the hook's own record, so it scores every arm the same way. A stricter line prints beside it: the last such check shows no failure (no failed or error count in its pytest or unittest line, and no FAIL among its CHECK lines).
- **Claim.** The last STATUS line in the final assistant message. FIXED, DONE, DONE_WITH_CONCERNS or no line at all claims done; NOT FIXED, BLOCKED or NEEDS_CONTEXT doesn't.
- **False done.** The session claims done and its diff fails the hidden tests, over all sessions.
- **bo2 pass.** Pass of the patch section 7 ships.
- **Spend.** The proxy-metered cost of a session, hook calls included. bo2's spend is both sessions plus the picker call. VM time is left out of per-session spend.
- **Hook time.** Section 8's sum per session; Harbor's wall clock per session prints beside it.
- **Infrastructure failures.** A session that ends on a provider or transport error with no successful response, or with zero successful responses, reruns once as attempt 2; a second failure is missing. Allowance stops, turn-limit stops and model errors after a response never rerun and score as shipped. A contrast leaves out a task missing in either arm and prints the count; a contrast missing more than 5% of its pairs reads INCOMPLETE.

### 14. Endpoints and verdicts

Paired differences and 95% intervals come from the stats kit's clusteredPairedDelta (src/runner/stats/paired.ts), resampling repositories (10,000 draws, seed 20261148). Ratios use a bootstrap over the same clusters. Pooled readings resample repositories across all three models. Every comparison prints the counts of tasks that got worse and better, with none's numbers beside it. An interval that includes zero reads "no measurable difference". A verdict is the first rule that matches.

**H1, pooled over the three models: verify-hook against verify-prose.** A is the adherence difference and P the pass difference, each pooled with equal weight per task and model, with a 7.5-point non-inferiority margin on P.

1. HOOK COSTS PASSES: P's upper bound is below 0.
2. HOOK FOLLOWED MORE: A's lower bound is above 0, P's lower bound is above -7.5, and A4 kept the shipping test in.
3. HOOK FOLLOWED MORE, SHIPPING UNTESTED: A's lower bound is above 0, and P's lower bound is at or below -7.5 or A4 kept the shipping test out.
4. PROSE FOLLOWED MORE: A's upper bound is below 0.
5. NO MEASURABLE DIFFERENCE: anything else.

Per-model A and P print with their MDDs and carry no verdict. Waivers, BLOCKED exits, blocks and turns print per arm and model. False done (hook against prose) and each arm against none print as secondaries.

**H2, pooled over the three models: gstack (verify-prose) against best-of-2 at equal spend.** On each model, from mean spends c_none, c_bo2 and c_gstack, f = (c_gstack - c_none) / (c_bo2 - c_none), clipped to 0 to 1. The equal-spend policy passes (1 - f) x pass(A) + f x pass(bo2) on a task, and E is the mean over tasks and models of the policy's pass minus gstack's. f is re-estimated in every resample.

1. VERIFIER COMPUTE WINS: E's lower bound is above 0.
2. GSTACK WINS: E's upper bound is below 0.
3. EQUAL AT EQUAL SPEND: E's interval lies inside -5 to +5 points. This 5-point equivalence margin is frozen now, and a 95% interval inside it is stricter than a two one-sided test at 5%.
4. NO MEASURABLE DIFFERENCE: anything else (the interval holds 0 and reaches past -5 or +5).

Under the plan's own numbers E is expected near 0.3 to 1.5 points, so EQUAL AT EQUAL SPEND or NO MEASURABLE DIFFERENCE is the expected reading, and the post says so before it shows the number (section 16).

Beside it, per model and pooled: the raw bo2 minus gstack difference with the spend ratio c_bo2 / c_gstack and its interval, gstack minus none, bo2 minus none, pass@2, the picker's accuracy on tasks where exactly one attempt passes, and bo2 against verify-hook. If gstack spends at least as much as bo2 on a model (f = 1), E there is bo2 minus gstack, and gstack's extra spend prints. The per-model E lines print with their MDD and carry no verdict.

**H3, on the judge subset, for admitted points only: judge-jev against judge-p1.** The hook-time ratio is the Jev arm's mean hook time per session over the particle-1 arm's, per model and pooled; the pass difference is pooled over the three models, with a 7.5-point non-inferiority margin. After drop step 1 (section 22) removes particle-1's judge arms, H3 pools Opus and Sol with equal weight, and the verdict prints the power line for the pairs it read (section 16).

1. JEV COSTS PASSES: the pass upper bound is below 0.
2. JEV MATCHES AND IS FASTER: the pass lower bound is above -7.5 and the pooled ratio's upper bound is below 0.5.
3. JEV FASTER, SHIPPING UNTESTED: the pooled ratio's upper bound is below 0.5 and the pass lower bound is at or below -7.5.
4. NO CLEAR SPEED GAIN: anything else.

Beside it: per-model pass differences, the hook calls' model cost per session, fail-open counts, escalation, and each judge arm against verify-hook and against none on pass and false done, descriptive, with the MDD.

**Error control.** Each question answers its own preregistered claim, and each joint rule is an intersection-union test, so no adjustment is needed within a question and no Holm correction runs across questions. Every verdict prints; none is dropped.

**Verdicts and their R48 end states.** Checked in this order: an arm under its 90% exposure bar makes the verdict FIX-METHOD (exposure); a contrast that reads INCOMPLETE is FIX-METHOD (incomplete) and makes no claim; a model that A1 or A2 marked saturated is FIX-METHOD (saturation) on that question, with R61's one attempt for H1 (section 17). Otherwise each verdict ends as the table says, after its Why-null cycle where it is a null or a loss.

| Question | Verdict | End state |
|---|---|---|
| H1 | HOOK FOLLOWED MORE | KEEP: switch skill_contracts on for rules with an edit loop and drop the duplicated sentence |
| H1 | HOOK FOLLOWED MORE, SHIPPING UNTESTED | FIX-METHOD (power on passes): the adherence gain stands, its cost in passes is unmeasured, and no switch-on is recommended |
| H1 | HOOK COSTS PASSES | CUT-CANDIDATE: the contract hook for this rule |
| H1 | PROSE FOLLOWED MORE | CUT-CANDIDATE: the contract hook for this rule |
| H1 | NO MEASURABLE DIFFERENCE | FIX-METHOD (task fit) when A3 failed on a model; otherwise CUT-CANDIDATE for the hook on this rule, stated with its MDD |
| H2 | VERIFIER COMPUTE WINS | CUT-CANDIDATE: /verify, against a second attempt at the same spend |
| H2 | GSTACK WINS | KEEP: /verify |
| H2 | EQUAL AT EQUAL SPEND | KEEP: /verify as one way to spend, since neither use of the money beats the other by 5 points; gstack against none prints beside it |
| H2 | NO MEASURABLE DIFFERENCE | FIX-METHOD (power): the interval is wider than the margin |
| H3 | JEV MATCHES AND IS FASTER | KEEP: the Jev cascade as a hook backend |
| H3 | JEV FASTER, SHIPPING UNTESTED | FIX-METHOD (power on passes): the speed gain stands, its cost in passes is unmeasured |
| H3 | JEV COSTS PASSES | CUT-CANDIDATE: Jev as a hook backend |
| H3 | NO CLEAR SPEED GAIN | CUT-CANDIDATE: Jev as a hook backend |
| H3 | NOT ADMITTED | CUT-CANDIDATE for each judgment hook that didn't beat its deterministic version in the replay; FIX-METHOD (labels) for a point that read NO READ |
| Replay | a point that doesn't beat its deterministic version | CUT-CANDIDATE: that judgment hook |

### 15. Attacks on the scoring rules, answered before code

1. **A no-op check games adherence** (pytest --version, echo test). The score needs a test-outcome line or a script run, not a runner's name, and the stricter zero-failures line prints beside it.
2. **A hook gives a blocked session an extra turn**, so a pass gain may come from more turns. That is part of how a hook works; blocks, turns and the passes that came after a block all print.
3. **The status line in every prompt may nudge checking.** It is identical in every arm, so it can't favor one, and it asks for a report, not a procedure.
4. **gstack arms also carry gstack's completion-status protocol** (STATUS: DONE and so on), so their claim words differ from none's. The claim rule reads both vocabularies the same way.
5. **No status line counts as a claim of done.** An arm that drops the line more often gets more false-done counts. Missing-line counts print per arm, with a sensitivity line that leaves those sessions out.
6. **Leaving out missing pairs could hide an arm whose failures are infrastructure.** Missing counts print per arm, and a contrast past 5% missing reads INCOMPLETE.
7. **The picker may favor one position.** A seeded coin sets the order per task, and the pick rate by position prints.
8. **f uses measured spends, including gstack's own overhead.** That is what equal spend means; f's interval prints, with the raw contrast beside it.
9. **The acting band is tuned on Stage 1 sessions and used on different sessions in judge arms.** Live escalation and fail-open print against the replay, and a gap past 15 points flags transfer.
10. **We write the risky list ourselves.** It is frozen at build with its digest before any backend call, two labelers from different families label it, and benign look-alikes sit beside the risky items.
11. **The done label treats a hidden-test fail as "block was right", though a block can't always lead to a fix.** That is the decision the hook makes; the live judge arms grade what shipped after the hook acted.
12. **Hidden tests may be flaky.** The pool passed L1's oracle preflight; the verifier runs once per patch, and a verifier infrastructure error reruns once.
13. **Repositories with many tasks could dominate.** Each split holds at most 4 tasks per repository, and every interval resamples repositories.
14. **A judgment hook that denies benign commands can wreck a session.** False denies print per session, and the risky point is admitted only at a held false-deny rate of 10% or less.

### 16. Power and MDD

power.py and power.txt freeze these numbers. The paired binary MDD (two-sided 5%, power 80%) is 2.80 x sqrt(d / n).

- **H1 adherence, pooled** (about 570 sessions with an edit over the three models, about 190 per model). At d 0.25 the MDD is 5.9 points pooled and about 10 per model. The effect in hand is about 5 points: L1's told Opus sessions ran a check after the last edit in 63 of 80 with the contract hook on and 59 of 80 with it off. So a null is likely even pooled, and A4 prints the measured gap against this MDD before Stage 4 spends (section 9). L1's rates (69% to 79%) leave room under the 90% saturation bar.
- **H1 shipping test, pooled.** Over 600 task and model pairs, the 7.5-point non-inferiority test has power 1.00 at d 0.12 and a true difference of 0, and 0.97 at a true difference of -2 points. Per model it would be 0.86.
- **H2.** bo2's gain over one attempt can't pass d0 / 2, where d0 is how often two plain sessions on one task disagree (0.04 to 0.14 in hand). With a picker that is right on 60% to 80% of split tasks, the gain is 1 to 4.5 points. At f 0.32 the MDD for E is about 6 to 7 points per model and 3.4 to 4.2 points pooled over the three models (600 task and model pairs); the raw bo2 minus gstack MDD is 3.6 to 4.4 pooled. Under these numbers best-of-2's mean equal-spend edge E is 0.3 to 1.5 points, below the pooled MDD, so H2 can detect only a gstack advantage or loss of about 4 points or more. The plan expects EQUAL AT EQUAL SPEND or NO MEASURABLE DIFFERENCE, not VERIFIER COMPUTE WINS. The equivalence rule (95% interval inside -5 to +5) has power 0.65 to 0.96 pooled (power.txt part 4). Per model, E's MDD of 6 to 7 points reaches neither, which is why H2 is pooled (section 1).
- **H3.** Pooled over the three models on the judge subset (180 pairs), the 7.5-point non-inferiority test has power 0.83 at d 0.12. Section 22's drops shrink it: drop step 1 leaves 120 pairs (power 0.66), and drop step 2 after it leaves 80 (power 0.49), both in power.txt part 2. An H3 reading taken after a drop prints its power line next to the verdict. Hook-time ratios have narrow intervals, since the replay alone shows Jev about ten times faster per call.
- **Replay.** About 240 held done items, but they come from about 20 held calibration tasks (12 sessions each), and every replay interval is clustered by task. The effective sample is nearer 20 clusters than 240 items, so a 10-point balanced-accuracy difference may not clear the clustered bound, and a point can fail admission on interval width alone. Admission uses the clustered lower bound, and the held task and repository counts print beside it. Route and risky items shrink after label agreement, and their counts print.
- **What this eval can't see.** A per-model pass-rate effect smaller than about 7 points, a pooled one smaller than about 4, or a pooled adherence effect smaller than about 6. A smaller real effect reads "no measurable difference" with its MDD (R48).

### 17. Exposure, R48, R61, R78, R51, R55 and R56

- **Exposure (procedure gates).** Every verdict prints its exposure rates: /verify loaded, contract record present, blocks fired, hook logs written, and the none arm clean. A verdict whose arm falls under its 90% exposure bar reads FIX-METHOD (exposure).
- **R48, Why null.** Every null or loss (NO MEASURABLE DIFFERENCE, PROSE FOLLOWED MORE, HOOK COSTS PASSES, VERIFIER COMPUTE WINS against gstack, NO CLEAR SPEED GAIN, JEV COSTS PASSES, NOT ADMITTED) gets one cycle: exposure (did the hook fire, did the prose load), task fit (did edits happen, did /verify's loop run), power (the MDD and the realized discordance) and the frontier without the part (none). Each ends in the KEEP, FIX-METHOD or CUT-CANDIDATE that section 14's table gives, stated plainly.
- **R61.** A null that rests on saturation gets FIX-METHOD once, with one attempt to raise the ceiling. For H1: when A2 marks a model saturated, the attempt reruns verify-prose and verify-hook for that model on L1's 37-task Terminal-Bench 2 twin set (public, at Lane B's registry pin), one session per task and arm, after a 10-task headroom check with the same 90% bar. If that check is saturated too, or the harness can't run it, the verdict stays FIX-METHOD (saturation) and the post says the model already follows this rule from prose. The attempt runs only from room the all-in read shows after Stage 4, with an item cap the Captain records. A1 screens H2 and H3 for saturation.
- **R78.** No model judge grades an outcome: hidden tests and transcript rules decide every score. The replay's route and risky labels are the items GPT-6 Astra and Opus 5.5 label the same way, with their kappa printed and a 0.6 floor. The picker is part of an arm, not a grader. If the results become a public post, the Captain decides whether the project owner labels a sample first; that doesn't block the run. R71's doubled guideline for an Astra judge isn't used, and the line stays as approved.
- **R51.** This preregistration is an eval write-up with frozen draw and power scripts, and /ship runs the depth gstack's review planner prints for it. The build is gate class and ships with the results (R77: two merged PRs, this one and the results).
- **R55.** The results post ends with the Particle, OpenAI and gstack lines. An X post featuring particle-1 carries the short Particle line. Jev gets no line: the project owner confirmed that neither he nor Y Combinator has a tie to TypeSafe AI.
- **R56.** gstack changes only on this eval's evidence and only by the gstack owner's call after the results.

### 18. Build, dry run, start rules and stops

**Build (not in this PR).** Lane B arm specs for the six run arms, the verify-hook patch, the two judgment hooks and their logs, the picker, the scorer and the analysis, with keyless tests in both directions for every rule above. gstack pins to main's commit on the build day; this plan was written against 350d4196. If the build pin changes verify/SKILL.md, lib/skill-contract.ts, lib/skill-route.ts or careful/bin/check-careful.sh from 350d4196, the diff comes to the Captain before Stage 1. The pin never moves during the run.

**Dry run (keyless, stub models and stub backends), driving every frozen rule:**

1. Arm tars and their digests. The none arm holds no gstack file, no skills and no drive path. A hostile CLAUDE.md fixture reaches no arm, and gstack's own install survives in gstack arms.
2. verify-hook: the patch applies to /verify at the pin with its digest; a scripted session that edits and stops is blocked once and then allowed; in verify-prose the contract hook runs with skill_contracts off, blocks nothing and writes no contract record; a waiver and a final STATUS: BLOCKED each let a stop through and print; the prompt with "/verify " in front produces a /verify load as section 6 counts one; routing is off in every gstack arm.
3. match.txt's 64 cases through gstack's own contract checker with the frozen match regex, in both directions, with gstack's built-in classifier on the same cases printed beside it (section 6). A case on the wrong side goes to the Captain as an amendment before Stage 1.
4. The scorer on 48 fixture transcripts in both directions. Eight of them pin section 13: a same-call check that the vendored lastBashWrite finds counts when its call shows an outcome (sed -i ... && python -m pytest with a pytest result in that call's output, a heredoc that writes a repro and then runs it, and pytest | tee out.log) and doesn't count otherwise (pytest && sed -i ..., where the check runs before the write; sed -i ... && pytest --version; and sed -i ... && pytest where sed fails, pytest never runs and the result shows no outcome); a "no tests ran" result from a mistyped path scores non-adherent, and a passing run in the same position scores adherent. Then the claim rule on 20 fixture endings, and the picker parse on 20 replies.
5. The judgment hooks through stub backends: each exact rule, an escalation, a fail-open on timeout, the log line and the proxy journal entry, with no key in the container.
6. One ledger lease opened and settled per frozen item on a temporary ledger, an allowance stop, a cap stop and the infrastructure rerun.
7. The leak scan with planted canaries, HARBOR_TELEMETRY=0 and CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1.
8. The equal-spend analysis and every verdict rule on synthetic tables with known answers.

**Start rules.** No paid call before this preregistration merges and the Captain records each item's cap. Stage 1 after a green dry run. Stage 2 after the decision-routing results (section 10). Stages 3 and 4 after Stage 2.

**Stops.** An item that reaches its cap stops incomplete and is never retried to change a verdict. A custody hit stops the run. A change in Jev's version stops the judge arms. A key in a log or transcript stops the run until it is redacted. Every stop prints with its ledger record. After merge, any change to a stop, lease, arm, verdict or money rule is an amendment that goes to the Captain before it applies, and lands with the results (R77).

### 19. Outside terms and rights

- **SWE-rebench** is CC-BY-4.0, and the results post credits it. The task repositories keep their own licences; logs hold their code and issue text and stay private, and the post publishes counts, digests and printed lines.
- **Terminal-Bench 2** (route prompts and the R61 attempt) is used at Lane B's pinned registry commit under its repository's licence, which the build records; NOTICE.md already lists it.
- **TypeSafe (Jev).** Its Master Customer Agreement, as the decision-routing preregistration read it on 2026-11-08, bars using outputs to train or distil a model or to build a competing product. This eval does neither and keeps decision logs for analysis only. No clause against publishing evaluation results was found. TypeSafe may list the account holder as a customer on its site; the project owner accepted that clause at the decision-routing gate for the same account, and again at this plan's gate. Standard accounts get no zero data retention, so every request carries only public material. The build re-reads the terms at its pin and brings any change to the Captain.
- **OpenRouter and Particle.** particle-1 and GPT-6.1 Sol run through OpenRouter under OpenRouter's terms and each provider's terms. Claude Code drives them through Lane B's metering proxy, the setup L1's Sol and particle-1 runs used (amendment F and its results post); the project owner acknowledged it at this plan's gate.
- **Anthropic.** Opus 5.5 runs on the Anthropic API under its commercial terms; Claude Code and the Agent SDK run as published, at pinned versions.
- **OpenAI.** GPT-6 Astra (labels) runs under OpenAI's API terms.
- **Harbor and gstack** run under their repositories' licences at their pins. Vendored gstack code keeps its upstream header and gets a NOTICE.md row marked vendored.

### 20. What the results post reports

The findings standard: two or three takeaways first ("We learned X. You should do X."), what works first and what didn't right after, then per-model and pooled tables with intervals, MDDs, counts of tasks worse and better, and exposure rates; the replay's calibration plots; Why null; limits; replication commands from the phase scripts that ran; a held-out note (nothing is held out); and a closing Disclosures section. Spend and caps go in Agent notes. The body reports cost only as ratios where cost is the lesson (equal spend, hook time).

### 21. Risks, limits and not in scope

- One rule in one skill on one task type. A hook may matter more inside a long procedure, where the /review result came from.
- H1's effect in hand is about 5 points, near the pooled MDD, so a null is the likely result there, and H2 expects one too.
- /verify's loop implies the rule even without its sentence, so H1 measures an explicit sentence against a hook, on top of a loop that already pushes the model to check.
- Told sessions only. Untold use, where a skill loads only if the model picks it, isn't tested live; the route point is replayed only.
- SWE-rebench is mostly Python libraries with their own tests, and other stacks may behave differently.
- best-of-2 uses one picker that reads diffs only. A picker that runs tests is a different idea.
- The judge arms run on 60 tasks per model, so their per-model pass lines are descriptive.
- The Jev cascade's band comes from Stage 1 sessions, and live judge sessions differ from them.
- Not in scope: the build, paid runs and any change to gstack itself.

### 22. Agent notes: money (internal; a gate input, left out of the public export)

The line is $3,000 all-in: paid model calls, labels, runner VMs and the crew's own model use, read from thread counters at about $1 per 1,000 credits. A projection past $5,000 goes to the project owner through the Captain. No paid call runs before this preregistration merges and the Captain records each item's cap.

| Item | Sessions | Expected | Cap |
|---|---|---|---|
| Stage 1, Opus: none, plain-2, verify-prose and verify-hook on 40 tasks, with pickers | 160 | $78 | $150 |
| Stage 1, Sol | 160 | $98 | $180 |
| Stage 1, particle-1 | 160 | $34 | $70 |
| Stage 2, replay: Astra and Opus labels, Jev and particle-1 calls | | $60 | $90 |
| Stage 3, judge pilot: three models, 12 tasks, two arms | 72 | $35 | $90 |
| Stage 4, Opus: four arms on 200 tasks, judge arms on 60, pickers | 920 | $460 | $660 |
| Stage 4, Sol | 920 | $570 | $800 |
| Stage 4, particle-1 | 920 | $193 | $280 |
| Runner VMs: about 176 hours | | $106 | $160 |
| Crew: every thread on this line, from counters (cap set by hand, $10 above the formula's $390) | | $260 | $400 |
| **All-in** | **3,312** | **$1,894** | **$2,880** |

Planning rates per session, from L1's Claude Code runs on this pool: none $0.40 on Opus, $0.52 on Sol and $0.18 on particle-1; told gstack arms $0.55, $0.67 and $0.21; judge arms $0.57, $0.68 and $0.21 with hook calls included; a picker call $0.06. Labels: Astra at $10 in and $50 out per million tokens, Opus at $4 and $20 (src/runner/pricing/prices.ts at this base), about 1,000 items, two labelers, about 2,500 tokens in and 300 out per item. VMs: 0.05 hours a session at $0.60 an hour, plus 10 hours for image pulls and the task-fit screen. Crew: this thread, a gate-class build and its /ship, the run threads, and a results post and its /ship, about 830M tokens at about $0.31 per million.

Item cap = ceil10(m x expected + 6 parallel sessions x allowance), with m 1.5 for Stage 1, the replay and the pilot and 1.35 for Stage 4. The per-session allowance is $5 for Opus and Sol and $2 for particle-1 (L1's largest particle-1 session was $1.16).

Reserve mechanics: each item opens one ledger lease per launch that reserves its parallel sessions' allowances. A session settles at its metered cost. An item stops when settled spend plus open reservations would pass its cap; that stop is incomplete and never retried. The caps sum to $2,880, $120 under the line. That room, plus whatever settled items leave unspent, is the reserve. It pays spare replacements and the R61 Terminal-Bench 2 attempt (about $50 on Opus: 37 tasks x 2 arms plus a 10-task x 2-arm headroom check, 94 sessions at $0.55 or more at Terminal-Bench 2 session lengths), each with a cap the Captain records first. A raised cap, or a projection past the line, goes to the Captain.

Drop order if Stage 1's re-cost projects past the line: (1) the judge arms on particle-1; (2) the judge subset from 60 tasks to 40; (3) the scored split from 200 tasks to 180, the first 180 in shuffled order. Each drop prints and is reported.

## Review record

One lean /autoplan review (R65): one Opus 5.5 reviewer over the plan and its scripts. It reproduced draw.py and power.py byte for byte, matched every attachment digest, recomputed the caps, and found 3 High, 5 Medium and 5 Low findings, none needing the owner's own judgment. Gate 1 took every recommendation, and this revision applies them: a frozen match regex for the contract item (match.txt), since gstack's built-in classifier misses /verify's own check; for H2, a frozen 5-point equivalence rule and the expected null named up front; for H1, the in-hand effect of about 5 points, a verdict pooled over the three models with per-model lines, and A4's print of the measured gap against its MDD; and the Medium and Low fixes (load counting, the hook's escape paths, CHECK verdicts, the R48 table, replay power in task clusters, the R61 re-cost, the inert hook in verify-prose, two descriptions of gstack, the Big decisions restated, and the outside terms). power.py gained the 570- and 600-unit columns and part 4; part 3 of power.txt is unchanged.

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

gstack is Garry Tan's own project.
