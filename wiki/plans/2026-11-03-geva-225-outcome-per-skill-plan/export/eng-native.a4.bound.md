INPUT: eng 42e28cee6c4f4bd89595766e39d43fcb547548ab81f48bf191bdf1c0c7b07b0b

# ENG review, native voice (attempt autoplan-20261103023817-a4)

Reviewer: anthropic/claude-opus-5-5, one strong voice, read-only on the shared machine. Checked against origin/main at 97e4796 and gstack 1.93.34.0 (local) and 1.93.38.0 (main). Prior-phase findings are not repeated unless this review adds something new.

The plan's shape is right: one rig, arms per skill, hidden tests deciding, instruments gated by admission. But the scoring rules in section 3 do not yet survive contact with the lane's code. The gap rule would turn long told sessions' own failures into reruns, the rig reuse needs lane-code changes the build sequence never names, the gstack arm the lane builds has no browser, and U and X are sized as if tasks were independent when the plan itself lets 8 share a repository. Each of these moves a scored outcome, so they belong in the plan now (insight plan E1, CREW "settle failure-scoring rules in the plan").

## Step 0: scope challenge

A (assess). The plan adds one module boundary (lanes/outcome-skills/) over the real-outcome lane and four code units plus a scorer extension. The minimum that answers the first question (does autoplan or plan-eng-review change hidden-test correctness on G) is O1, O4 and the G thin slice; O2's mutation scorer and follow-up runner, and O3's two harnesses, only serve secondaries (G) or other families. Building O1 to O4 in one 9-day window before any G pilot reads exposure is more than the first decision needs.

B (selectors). Scope: ui=yes, dx=yes (flags). Perf scope applies to the instruments (mutation runtime, agent-user tokens).

C (findings). Recommend staging O2 and O3 behind the G pilot's exposure read: the G pilot needs only solved and gaps to decide admission rows 1, 3 and 5. This is an ordering note, not a finding, because the plan already gates paid stages.

REALITY: lane agent is two turns, build then ship: lanes/real-outcome/agent/real_agent.py:104 returns [("build", ...), ("ship", spec["turn2"])]. The three-turn plan protocol needs a code change there.
REALITY: lane none T1 differs from the plan's: lanes/real-outcome/arms/arms.json:3 build_suffix ends "Don't stop to ask; I'll tell you when to ship."; the plan's none T1 drops the ship clause, so "G shares the lane's screening where the candidate and turn text match" never matches.
REALITY: lane taxonomy classes error, cli_exit and error_result with no cap refusal as infra: lanes/real-outcome/score/README.md:49 (outcome.ts:33-36 maps only wall_limit, turn_ceiling, bg_wait_expired, session_cap to truncated).
REALITY: lane gstack arm is installed with --no-browser, outside voice off, questions auto-decided: lanes/real-outcome/arms/build.ts:7-14.
REALITY: lane clean-room rule flags any tool input or result naming .claude/skills, ~/.gstack or a drive path, attempts included: lanes/real-outcome/score/README.md:67.
REALITY: a base tree holding .claude/ or .mcp.json is refused; CLAUDE.md and AGENTS.md stay: lanes/real-outcome/sandbox/README.md:24.
REALITY: WebSearch and WebFetch are disallowed in the lane agent: lanes/real-outcome/agent/real_agent.py:340; egress allows only proxy and sidecar: agent/egress.py:1-11.
REALITY: decisions cluster by repository with a cluster-robust z and sign-flip: lanes/real-outcome/score/README.md:76; Holm and cluster bootstrap exist in src/runner/stats/paired.ts (used at score/analysis.ts:6). No Holm-of-three or TOST helper is needed beyond what exists, but power.py (GEVA-225 power/power.py:21) uses a task-level paired t with no repository term.
REALITY: OpenRouter calls carry data_collection deny with pinned providers and no fallbacks: src/runner/pricing/prices.ts:75; particle-1 pinned to particle-ai (docs/adapters.md:36).
REALITY: autoplan wraps a free-form plan in "## Implementation plan" at init: gstack bin/gstack-autoplan-snapshot.ts:426, and stops on helper errors (autoplan/SKILL.md:439-440). An agent-written PLAN.md is reviewable; a malformed one stops the skill.
REALITY: validity V1 already runs gold 10 times in random order and quarantines gold-flaky tests: lanes/real-outcome/task/SPEC.md:67,169; history leak rule L1 at SPEC.md:162.

## 1. Architecture

**Rig reuse is a lane change, not a wrapper.** real_agent.py hard-codes a build turn then a ship turn, the shipped head from the sidecar is the lane's graded object, and the build suffix promises a ship turn. Outcome-skills needs an N-turn list from the arm file, a final-tree snapshot after the last turn as the graded object, and no ship. Either the lane's agent takes an arms-file turn list (a lane amendment GST-817 must accept, with its own /ship and its own tests/real-outcome/arms.test.ts pin changes), or lanes/outcome-skills forks the agent. Section 13 lists neither, and section 2's table says "wrappers". The none T1 should then be chosen deliberately: identical to the lane's build_suffix (and the ship clause dropped from G's claim of shared screening), or new text with G screening priced alone.

**The lane's gstack arm is the wrong arm for U.** build.ts installs gstack with `./setup --host claude --no-browser`, turns the outside voice off and sets every registry question to auto-decide. Section 4 says gstack arms in U "also have gstack's own browse" and that autoplan's outside voice is "pinned to the cell's model". With the lane's build, design-review, qa and devex-review told arms have no $B, and autoplan has no outside voice at all. Freeze a per-family arm build (U and X with browse, or none of the arms with it and say so), and freeze the outside-voice state in the arm manifest. The exposure detector should record browse availability so a missing browser reads unexposed, never as a skill null.

**Told autoplan's invocation is not frozen.** In a Claude Code trial, autoplan's behaviour depends on SESSION_KIND (interactive, spawned or headless; autoplan/SKILL.md:48,199) and, since R66, on the runner's kind (fix runs no review). "/autoplan PLAN.md" lets the after pin choose, and the autoplan exposure check ("every phase autoplan's scope chose") passes a run whose scope chose nothing. Freeze the expected SESSION_KIND and phase set per family (G: CEO and Eng; U: plus Design; X: plus DX) and count anything less as unexposed. This extends DX-12 to G and to the kind flag.

Two shapes (design-twice) for lanes/outcome-skills:
- Shape A, amend the lane: one agent, arms file grows a turns array; lower drift, but every change rides the lane's scorer-class /ship and its sha256 pins.
- Shape B, fork the agent: lanes/outcome-skills/agent copies real_agent's session loop; faster, but two copies of the quiet-detection, wall-limit and torn-tail logic diverge, and the lane's 6 /ship rounds of fixes stop protecting this plan.
Recommend A, with B's risk named. Red flag either way: the scorer must import the lane's taxonomy and clean-room code, never re-implement them.

## 2. Code quality and the scoring rules (attacked)

**Gap vs arm stop (High).** The lane's taxonomy makes error_result, cli_exit and error infra. A long told session that overflows the context window, hits a max-output error, or sends an invalid request ends as error_result or cli_exit, so under the plan it becomes a gap, is rerun once, and past 5% makes the cell NO READ. The longest arms (autoplan at $8 to $20, design-review loops) are the ones that hit these, so the rule converts a skill's own failure into a rerun or a non-result. Separately, gap hazard grows with session length, and the analysis averages each arm over its valid trials only, so the told arm's surviving trials skew to its shorter, easier runs within a task. Freeze the classifier from proxy records: a gap only when the proxy logged a provider availability failure (5xx, 429 past retries, connect or TLS error) or a named rig event; a request error caused by the arm's own context (prompt too long, output limit, tool schema) is an arm stop scored unsolved. Print, beside every verdict, a sensitivity that scores every gap as unsolved, and gap rate per arm per session-hour.

**Wall limit and provider latency (Medium).** wall_limit is truncated, so it is an arm stop. Sol and particle-1 run through OpenRouter, slower and with more variance than Opus direct, and a slow provider stops a told session that would have finished. Size limits per arm and per model, and measure the wall clock on agent-active time or classify a wall stop whose proxy wait share is above a frozen fraction as a gap. A p95 from 24 pilot trials is the second-largest value; freeze limit = max(lane limit, 2 x pilot p95).

**Contamination rule (Medium).** The plan's rule ("read any gstack file") cannot fire in a clean room, so it is vacuous; the lane's rule that would actually run (score/README.md:67) flags path mentions and attempts, in bare arms only, and excludes them. A bare agent that runs `ls -a ~` or `find / -name SKILL.md` is excluded; a told agent doing the same is not checked. That is a one-sided exclusion. Freeze one rule: with the arm clean by construction, path-only hits and failed attempts are descriptive; only a successful read of gstack content excludes, and both counts print per arm.

**Arm compliance (Medium).** Nothing checks that plan-first's T1 ("Don't write code yet") wrote only PLAN.md, or that the stand-in's T2 changed PLAN.md. An agent that codes in T1 makes told's /autoplan review a plan whose code already exists; a stand-in that is ignored makes "told minus stand-in" a win over a weak comparator and feeds "helps beyond the idea". Snapshot after each turn (the lane already snapshots after build), freeze compliance checks per bare multi-turn arm, print compliance rates, and read told minus stand-in as untested below a frozen compliance bar, the way exposure gates told.

**Exposure detectors and the forced line (Medium).** The forced line names the skill's steps, so a forced session echoes those names in prose; detectors such as "its 7 passes in order" or "its 4 sections in order" that read transcript text will mark echo as exposure. Key every detector on actions and artifacts (Skill call, subagent dispatches, files written, run.json validation, browser tool calls) and add a fixture: a transcript that only restates the step names reads unexposed.

**G-v turn script (Medium).** none's T1 says "Don't stop to ask", while spec and office-hours told arms are built to ask the oracle user. On G-v that instructs the control not to use the oracle the treatment uses. Freeze a G-v T1 for every arm that says questions are allowed.

**Mutation score (Medium).** "Tests the agent added or changed" must be per test case, not per file: an agent that adds one line to an existing test file would otherwise get the gold-era tests' kill power. Run the agent's tests 3 times on the unmutated tree and drop any that flips (a flaky pass kills mutants at random). Freeze timeouts per tool (Stryker counts a timeout as detected; excluding it is a choice). Print mutation separately for solved and unsolved trees, because tests that pin wrong behaviour score well.

**Follow-up and hidden grading see arm artifacts (Medium).** PLAN.md exists in plan-first, stand-in and told trees but not in none's, and told arms leave gstack review files. The follow-up agent reads them, so "architecture" picks up "left notes"; and a repo's lint or file-listing test can fail on them. Strip a frozen artifact list from every arm's tree before hidden tests, mutation and follow-up, or keep them and name the reading "tree plus notes".

**Cost per solved task (Low).** With particle-1 near zero solved, bootstrap resamples with 0 solved make the ratio undefined; and the 1.5x guard has no stated consequence. Report ratio of means with unbounded resamples counted, and say a crossing labels the row a cost tradeoff.

**Task contamination (Medium).** The window starts 2026-07-01, but the plan records no training cutoff for Opus 5.5, GPT-6.1 Sol or particle-1. Record each published cutoff; where one is after July 1, make the strict stratum (on or after 2026-10-01) that model's primary population.

## 3. Test review (test plan)

What O5's keyless dry run must drive, beyond the plan's list:
1. Gap classifier: fixtures for a 529 overloaded (gap), a prompt-too-long 400 (arm stop), a CLI crash after a model error (arm stop), a proxy refusal (cap stop).
2. Exposure: an echo-only forced transcript reads unexposed; a run with no browser tool reads unexposed for design-review.
3. Compliance: T1 diff touching source in plan-first reads non-compliant.
4. Contamination: `ls -a ~` in a bare arm is descriptive, not excluded.
5. Mutation: an edited existing test file credits only the new test cases; a flaky agent test is dropped.
6. Artifact strip: PLAN.md and .gstack/ are absent from the graded and follow-up trees in every arm.
7. Real pinned SDK with a stub CLI for the N-turn agent (CREW, #101 and #106 lesson), including quiet detection between three turns.

## 4. Performance

Mutation at $0.25 a tree assumes about 10 VM-minutes. cargo-mutants rebuilds per mutant, so 200 mutants on a real crate can take hours; the probe ran small commits (28 mutants). Price mutation per language from O2's run on the largest thin-slice repository, and freeze a time budget with "budget-truncated" recorded apart from tool errors.

## Statistics and power (power.py, power.txt)

I re-ran power.py's model with two additions (scratch at ~/.capy/work/geva225/eng-a4/sim.py, 4,000 sims):
- Repository clustering. With task effect sd 0.12 plus repository effect sd 0.08 (total near the plan's 0.15) and a repository-clustered test at alpha 0.025, 120 x 4 gives MDD 11.5 at 4 tasks a repository and 13.0 at 8 (12.0 with repository sd 0.05). U and X allow 8 a repository with the clustered reading deciding, so their 10.5-point line and their $66,000 to $73,000 a model rest on independence they do not have. power.py has no repository term at all, and it uses a paired t while the decision test is the lane's cluster-robust z and sign-flip.
- Equivalence. "No effect at stated power" (90% interval inside plus or minus 10) is reached 83% of the time at a true zero and 46% at a true 5 points, at 120 x 4; at 60 x 4, 36% at a true zero. The plan never states this power. The idea-only reading says "told minus stand-in sits inside the margin" without saying interval or point, and it also needs stand-in minus none, a secondary outside the Holm family, yet it sends the procedure text to a diet or CUT path. Define it as TOST on told minus stand-in plus stand-in minus none significant inside a three-contrast Holm family, and print equivalence power in each prereg.
- Multiplicity (Low). About 20 skill, family and model verdicts each at family alpha 0.05 expect about one false helps or hurts across wave 1. State it in the results, or report an FDR column.

## Prices

Beyond CEO-6 and CEO-7: the autoplan told price ($12) is plausible against this very run (the thread counter read 40.8M tokens after three phases, about $16 at the crew's $0.39 a million), but that is a 65 KB plan; the pilot meters the real number. Mutation is the line most likely to be off (section 4). Repository clustering (above) is the largest cost risk: holding U and X at a 10.5-point clustered MDD needs about 160 to 180 tasks or no more than 4 a repository, roughly 1.4 to 1.5 times their confirmatory cost.

## R65: outside terms, licences and rights

Yes, outside terms are involved, and section 11 handles most of them; prior phases added multi-licence repos, issue text as user content, UI assets and docs licences. What this review adds:
- particle-1's route runs with data_collection deny, only particle-ai and no fallbacks (prices.ts:75). If particle-ai's OpenRouter listing does not meet the deny policy, every particle-1 call fails, the cell's gaps pass 5% and the row is NO READ for a terms reason that reads like a rig failure. The route check must run with deny on and record the provider's data policy and retention before the pilot, not at the confirmatory prereg.
- Task images vendor each repository's full dependency closure (npm, pip, cargo, Go modules), whose licences differ from the repository's (GPL or AGPL transitive deps are common). Running them locally is fine; pushing images to a public registry is redistribution with notice and source-offer duties, and would leak task identity past L4. The plan should state images stay in private or local registries and are deleted with the run.
- Harbor and the gost helper image are third-party (agent/egress.py pins gogost/gost); their licences are in the lane's NOTICE.md, which the plan should cite rather than restate.
- Playwright's bundled Chrome Headless Shell is fine for local testing; no change.

## NOT in scope (agreed)

Building, spending, gstack changes, Codex hosts, the 32 untestable skills, and claims about gstack in general.

## What already exists

Lane agent, egress, sidecar, gh stub, validity V1 to V9 and L1 to L6, termination taxonomy, clean-room check, cluster bootstrap, sign-flip and Holm (src/runner/stats), the OpenRouter routing with data_collection deny, and the K4 replay set. Missing: N-turn turns, final-tree grading without ship, a gap classifier from proxy records, compliance checks, per-family arm builds, repository-clustered power.

## Diagram

```
mined pool --> validity (V1-V10, L1-L6) --> sealed bundle
                                   |
arm registry (turns, lines, detectors) --> lane agent (N turns) --> snapshots per turn
                                                                     |
            proxy records --> gap classifier --> {scored, arm stop, gap, contaminated}
                                                                     |
final tree (artifacts stripped) --> verifier | mutation | follow-up | agent user | docs-only
                                                                     |
                                       scorer: exposure, compliance, contrasts, TOST, R48
```

## Failure modes

| Failure | Caught by today's plan? | Fix |
|---|---|---|
| Context overflow in told arm read as gap | No | gap classifier (F1) |
| U told arm has no browser | No | per-family arm build (F4) |
| Forced echo read as exposure | No | action-based detectors (F6) |
| Stand-in ignored | No | compliance gate (F7) |
| Bare arm excluded for listing home | No | contamination rule (F8) |
| Repo clustering widens U/X MDD | No | clustered power (F2) |
| particle-1 route refused under deny | No | route check with deny before pilot (F15) |

## Worktree parallelization

O1 (arms, detectors) and the lane amendment touch lanes/real-outcome/agent and arms; they go first and alone. O2 and O3 are disjoint (instruments) and can run in parallel after O1's turn schema lands. O4 depends on O1's records and O2/O3 output schemas. Thin slices run in parallel throughout. No two units should edit src/types.ts or src/errors/codes.ts at once (AGENTS.md shared registries).

## Unresolved decisions

1. Amend the lane's agent (Shape A) or fork it (Shape B).
2. U and X size under repository clustering: more tasks, or a cap of 4 a repository.
3. Whether gstack arms in U carry browse (and so whether none and stand-in get Playwright as now).

## Completion summary

Findings: 0 Critical, 5 High, 12 Medium, 3 Low. The highest-severity items are F1 (gap rule turns told failures into reruns), F2 (U and X power ignores repository clustering), F3 (rig reuse needs unlisted lane-code changes), F4 (the lane's gstack arm has no browser and no outside voice) and F5 (equivalence and diet readings unpowered and ill-defined).

Review log row: eng | native | autoplan-20261103023817-a4 | 20 findings (5 High) | input 42e28cee.

Next steps: fold F1 to F5 into sections 3, 4, 7 and 13 before the gate; the rest can land as plan edits at the same time.

Learnings: a scoring rule written against a lane must be checked against that lane's taxonomy file, not its plan; here the default infra class decided the outcome of the plan's most expensive arm.

```gstack-findings
{"id":"F1","severity":"High","title":"Gap rule uses the lane's taxonomy, which classes error_result and cli_exit as infra, so told sessions' own context or request failures become reruns or NO READ, and valid-only averaging biases toward told's shorter runs","file":"lanes/real-outcome/score/README.md","line":49,"fix":"Freeze a gap classifier from proxy records: gap only for provider availability failures or named rig events; context-length, output-limit and invalid-request ends are arm stops scored unsolved. Print a gaps-as-unsolved sensitivity and gap rate per arm per session-hour beside every verdict."}
{"id":"F2","severity":"High","title":"U and X sizing ignores repository clustering: at 8 tasks a repository a clustered test gives about 12 to 13 points at 120 x 4, not 10.5; power.py has no repository term","file":"<local notes (not committed)>/.capy/work/geva225/power/power.py","line":21,"fix":"Add a repository random effect and the lane's cluster-robust decision test to power.py; size U and X to the clustered MDD (about 160 to 180 tasks, or at most 4 a repository) and re-cost wave 1.","user_challenge":true,"changes":"cost"}
{"id":"F3","severity":"High","title":"Rig reuse needs lane-code changes the build sequence omits: real_agent hard-codes build then ship turns, grades the shipped head, and the none T1 differs from the lane's build_suffix so G cannot share the lane's screening","file":"lanes/real-outcome/agent/real_agent.py","line":104,"fix":"Add an O0 lane amendment (arms-file turn list, final-tree snapshot as graded object, no ship) agreed with GST-817, or fork the agent under lanes/outcome-skills; choose the none T1 text deliberately and drop shared G screening from the price if it differs."}
{"id":"F4","severity":"High","title":"The lane's gstack arm is installed with --no-browser, outside voice off and questions auto-decided, contradicting section 4's browse in U and outside voice pinned to the cell's model","file":"lanes/real-outcome/arms/build.ts","line":8,"fix":"Freeze a per-family arm build (browse on for U and X told arms or off everywhere, stated), freeze the outside-voice state in the manifest, and record browse availability in exposure so a missing browser reads unexposed."}
{"id":"F5","severity":"High","title":"No-effect and idea-only readings are unpowered and ill-defined: equivalence reached 83% at a true zero and 46% at a true 5 points (120 x 4); 'inside the margin' does not say interval or point; stand-in minus none is a secondary outside Holm yet drives a diet or CUT path","fix":"Define idea-only as TOST on told minus stand-in plus stand-in minus none significant, in a three-contrast Holm family; print equivalence power per prereg."}
{"id":"F6","severity":"Medium","title":"Exposure detectors that read step names in transcript text will mark forced sessions exposed because the forced line puts the names in the prompt","fix":"Key every detector on actions and artifacts (Skill calls, dispatches, files, run.json, browser calls) and add an echo-only fixture that must read unexposed."}
{"id":"F7","severity":"Medium","title":"No compliance check for bare multi-turn arms: plan-first may code in T1 and stand-in may ignore T2, weakening the comparator behind 'helps beyond the idea'","fix":"Snapshot after each turn, freeze compliance checks (T1 diff is PLAN.md only; T2 changes PLAN.md), print compliance per arm, and read told minus stand-in untested below a frozen bar."}
{"id":"F8","severity":"Medium","title":"Contamination rule mismatch: the plan's 'read any gstack file' is vacuous in a clean room, while the lane's rule excludes bare trials for path mentions and attempts, a one-sided exclusion","file":"lanes/real-outcome/score/README.md","line":67,"fix":"Freeze one rule: path-only hits and failed attempts are descriptive; only a successful read of gstack content excludes; print both counts per arm."}
{"id":"F9","severity":"Medium","title":"Mutation scoring credits whole edited test files, counts flaky agent tests, leaves timeouts unfrozen and mixes solved and unsolved trees","fix":"Score per new or modified test case, drop tests that flip across 3 unmutated runs, freeze timeout handling per tool, and print solved and unsolved trees apart."}
{"id":"F10","severity":"Medium","title":"Arm artifacts (PLAN.md in planning arms only, gstack review files) reach the follow-up agent and the hidden suite, so architecture reads 'left notes' and lint suites can fail","fix":"Strip a frozen artifact list from every arm's tree before hidden tests, mutation and follow-up, or keep them and name the reading 'tree plus notes'."}
{"id":"F11","severity":"Medium","title":"Wall limits count OpenRouter latency as arm stops for Sol and particle-1, and a p95 from 24 pilot trials is the second-largest value","fix":"Freeze limits per arm and model at max(lane limit, 2 x pilot p95) on agent-active time, or class wall stops above a frozen proxy-wait share as gaps."}
{"id":"F12","severity":"Medium","title":"G-v none T1 says 'Don't stop to ask' while spec and office-hours told arms ask the oracle user","fix":"Freeze a G-v T1 for every arm that allows questions."}
{"id":"F13","severity":"Medium","title":"Told autoplan invocation is not frozen: SESSION_KIND and R66's kind change the panel, and 'every phase scope chose' passes a no-review run in G as well as X","fix":"Freeze invocation, expected SESSION_KIND and the phase set per family; anything less reads unexposed; init errors on a malformed PLAN.md read unexposed."}
{"id":"F14","severity":"Medium","title":"Mutation priced at $0.25 a tree from small probe commits; cargo-mutants rebuilds per mutant, so 200 mutants on a real crate can take hours","fix":"Price mutation per language from O2's run on the largest thin-slice repo; freeze a time budget and record budget-truncated apart from tool errors."}
{"id":"F15","severity":"Medium","title":"R65: particle-1 runs with data_collection deny, only particle-ai and no fallbacks; if that provider fails the deny policy every call fails and the row goes NO READ looking like a rig fault; task images vendor dependency closures whose licences differ","file":"src/runner/pricing/prices.ts","line":75,"fix":"Run the route check with deny on before the pilot and record the provider's data policy; state task images stay in private or local registries and are deleted with the run; cite NOTICE.md for Harbor and helper images."}
{"id":"F16","severity":"Medium","title":"No training cutoff is recorded for Opus 5.5, GPT-6.1 Sol or particle-1 against the 2026-07-01 window","fix":"Record each published cutoff; where one is after July 1, make the strict stratum that model's primary population."}
{"id":"F17","severity":"Medium","title":"Staging: O2 and O3 serve secondaries and other families but are built before the G pilot reads exposure","fix":"Gate O2 and O3 behind the G pilot's exposure and gap read; the G pilot needs only O1, O4 and solved.","user_challenge":true,"changes":"ordering"}
{"id":"F18","severity":"Low","title":"Cost per solved task is undefined when a resample has 0 solved, and the 1.5x guard has no consequence","fix":"Use ratio of means with unbounded resamples counted, and label a crossing as a cost tradeoff."}
{"id":"F19","severity":"Low","title":"power.py tests a task-level paired t, not the lane's cluster-robust z and sign-flip decision test","file":"<local notes (not committed)>/.capy/work/geva225/power/power.py","line":21,"fix":"Port the simulation to the decision test the scorer runs."}
{"id":"F20","severity":"Low","title":"About 20 verdicts at family alpha 0.05 expect about one false helps or hurts across wave 1 with no cross-verdict control","fix":"State the expected false-verdict count in results or add an FDR column."}
```
