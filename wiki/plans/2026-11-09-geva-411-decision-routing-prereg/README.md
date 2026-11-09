---
id: 2026-11-09-geva-411-decision-routing-prereg
kind: plan
title: "Preregistration: does routing a coding agent's small decisions to a calibrated decision model cut its bill by about 90% without losing task success, and does it beat sending them to particle-1 alone?"
summary: "mini-swe-agent on 280 SWE-rebench issues, Opus 5.5 and GPT-6.1 Sol: decisions on the frontier, routed to Jev then particle-1, or sent to particle-1 alone. 7.5-point margin, no judge."
author: GEVA-411
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-09
status: open
links:
  - 2026-11-03-geva-254-l1-overhaul-prereg-2000
attachments:
  - 9e84a75eb18e25ca9542979e4ad5b6edb8dd03b411d995f7d38e93c045a18547  draw.py
  - e688c2af6368c3ae7dbb719c18604f7a4ac054834949433e56f76beb2582bb0a  draw.txt
  - 6ca147888b50e5aea40ec2854617f00d5b97101ba102e60e7509ac71461d7c90  scored.txt
  - 3478bad544eb939ef34d1fc97111975ef9e054a6cb3277a29ff995f0e89cbd24  calibration.txt
  - 329e36a800ef9ef5b1397f5371e583b361afb0e6069502fa84b9c7bedf12cece  spare.txt
  - caa297db40dfdffcabcf2ed520d65e7a97974ab4f5450ca36d2de56ad16885d2  subset.txt
  - 2701fe4c7cbb630b51a6b79c65e26a67368f483389dbb318cd0576f76875750f  pilot.txt
  - a63dbf3a688d7efb95c16de1aab880200ac090082cc2404a6f2142b8ed457e25  power.py
  - 6169e300df418547c87ce367d25455d63becde0015047422171eb391cddd8c31  power.txt
  - 1665056d6a659b6b7824305ab2d71d48fb49ad6af58c5abf1e31bac9d3ff94c6  price.py
  - d68f1b7f7c256937159f843f18f67e5ffa6112ba0f8f71754e17b28a89506f69  price.txt
---

# Preregistration: does routing a coding agent's small decisions to a calibrated decision model cut its bill by about 90% without losing task success, and does it beat sending them to particle-1 alone?

## Approval

Gate 1 of this plan's /autoplan run (autoplan-20261109025207) approved it on 2026-11-09 with every recommended change, and the review's other notes were folded in before freeze (section 20). The approval is on record as a-e3673284bc5d. No paid call runs until this preregistration merges and the Captain records each item's cap.

## ELI5

A viral article says most of what a coding agent does is small decisions, not creative work: which step next, whether a search hit matters, whether the tests passed, whether a command is safe, whether the job is done. Each one is billed as a call to an expensive model. The article says to send those decisions to Jev, a small model from TypeSafe that answers typed questions with a probability in about a tenth of a second for almost nothing, act when Jev is sure, and pass the unsure ones to a cheaper model. It says that cuts the bill by about 90%. We test that on a real, widely used open-source coding agent fixing 280 real GitHub issues, with hidden tests saying whether each fix works and the real bill and clock saying what it cost. The same agent runs with every decision on Opus 5.5 or GPT-6.1 Sol, with the decisions routed to Jev and then particle-1, and with every decision sent to particle-1 alone. Our exploration found particle-1 alone often did as well as the router at a fraction of today's cost, so the router has to beat it on success, cost or speed to earn its place.

## Before → after

Before: the claim rests on the vendor's own workflow evals and a worked example where every step is a decision (sorting 10,000 emails). Our exploration replayed 8 decision points in three of the owner's repos: the router cut cost on all 8, held accuracy on 6, and particle-1 alone did as well or better on 7 of 8. Nobody has measured either on an agent that also writes code, where the creative calls stay on the frontier model and prompt caching already makes repeated context cheap.

After: a frozen test on 280 public SWE-rebench issues that reports, for Opus 5.5 and GPT-6.1 Sol, how much of a real coding agent's bill routing removes (with its interval), whether task success holds within 7.5 points, how much wall-clock time changes, whether the Jev router beats particle-1 alone on success, cost or speed, which decision types Jev is calibrated on, and which ones break tasks.

## Why it matters

The article drew about a million views in six weeks, and the pattern is cheap to adopt. Builders need to know two things it doesn't say: how much of a real coding agent's bill is decisions at all, and whether a calibrated router adds anything over sending those decisions to a cheap reasoning model. Either answer is a lesson they can act on, and gstack should adopt routing only on evidence from frontier models (gstack's evidence rule).

## What caused this work

The project owner asked on 2026-11-08 for the article's claim to be tried on gstack, gbrain and a private project, fixed where it helps, and backed into an eval that shows whether it works and what it does, with gstack adopting it if it helps and a post to follow. On 2026-11-09 the owner narrowed it: test Jev with particle-1 taking the unsure cases, and leave Kimi K3 (the article's choice) out. The exploration thread then reported (section 3): the router cut decision cost everywhere, particle-1 alone matched or beat it on 7 of 8 points, Jev's real gain was speed, its confidence ran backwards on one point, and the premise fits these repos poorly because most of their decisions live in prompts or make no model call. So this eval uses a real agent loop whose decision points are code-level calls, and makes particle-1 alone the router's main comparison.

## Big decisions

1. **Units.** Options: (a) public SWE-rebench issues with hidden tests and prebuilt images; (b) gstack-evals' sealed sets; (c) decision points from the repos the exploration patched. Pick (a). Why: decisions go to outside vendors, so every input must be public-safe, which rules out (b); (c) would mark our own homework, and one repo is private. What would flip it: the pilot showing over 10% image or verifier failures, which moves to the leaderboard's 499 older packaged tasks.
2. **Agent loop.** Options: (a) mini-swe-agent, a widely used open-source coding agent (MIT, about 9,400 GitHub stars, Harbor ships it as an installed agent), with a decision layer added at code-level hooks; (b) a loop written new for this eval; (c) Claude Code with hooks. Pick (a). Why: the exploration found the claim needs decision points that are code-level calls; mini's natural mode is a real published agent run as its authors ship it, so the baseline isn't built to suit the claim; Claude Code folds decisions into the frontier model's own turns, so hooks can add calls but can't take decisions away. What would flip it: mini on Opus passing under 40% of calibration tasks (Claude Code passed 64.5% of this pool), which stops for the Captain.
3. **The router's main comparison.** Pick two primary contrasts per creative model: the router against today's agent (the claim) and the router against particle-1 alone answering every decision. Why: the exploration's strongest arm was particle-1 alone; without it the router would be credited with particle-1's gains. The router earns its place only if it is no worse on success and measurably cheaper or faster than particle-1 alone.
4. **Thresholds and calibration.** Pick: tune each decision type's thresholds on the 40 calibration tasks only, against grounded labels where they exist, pooling both creative models. Jev acts on a type only where its calibration error (ECE) over at least 100 labelled calibration decisions is 0.15 or less and a confidence region holds at least 40 decisions whose accuracy has a Wilson 95% lower bound of at least 0.90; otherwise the type goes to particle-1. Why: the exploration found escalation pays only where Jev is calibrated (ECE 0.04 to 0.10 on six points, 0.31 and 0.49 on the two where it failed). Thresholds and questions are frozen by sha256 before any scored session.
5. **Size and margin.** Pick 280 scored tasks for the three main cells on both models, with a 7.5-point non-inferiority margin (MDD 5.8 points at the expected discordance, 7.5 at the worst we admit), and a 100-task subset for the isolation cells. A 5-point margin needs about 380 tasks, more than the fresh pool holds.
6. **particle-1 settings.** Pick max_tokens 8,000 on every particle-1 decision (the exploration saw truncation at 600 to 2,048 vanish at 4,000) and 32,000 a turn when it is the whole agent; a reply that never arrives or can't be read counts as wrong in every decision-level score, and in the loop it falls to the next layer with its cost billed (for relevance, the hit is kept).
7. **gstack.** Pick: no gstack arm. Why: the exploration found gstack's small decisions live in skill prompts the frontier model runs, and its code-level judges sit in its test harness, so no gstack decision point is a code-level call on a coding agent's path for routing to swap. Every arm here is a no-gstack arm by construction. What would flip it: gstack moving a decision on that path into code, which a follow-up would add.
8. **Pins and judges.** Jev 1.13.0 (the version the post and the exploration used; 1.14.0 gets a decision-level replay only), particle-1 through Particle's own endpoint, Opus 5.5 and Sol on their makers' APIs with prompt caching on. No judge: success comes from hidden tests, and every decision label comes from a test run, the real fix's patch or construction. So the line is $2,000.

## Implementation plan

### 1. The question, the claim and construct fit

**The claim as one testable sentence.** Moving a coding agent's typed decisions (next step, source relevance, test pass, command safety, task done) off the frontier model onto Jev, acting on its confident answers and sending the unsure ones to a cheaper model, cuts the agent's total bill by about 90% with no loss of task success. The active ingredient is calibrated confidence routing of typed decisions to a System One model, with a cheap generative model behind it.

**Source.** An X article, "How to Cut Your Agent Bill by 90% With Jev Engineering and Kimi K3" (2026-09-29), and TypeSafe's public docs (docs.typesafe.ai, read 2026-11-08). The vendor's figures (193.6x faster, 444.6x cheaper on its own workflow evals, which it calls the high end) are claims under test, never facts we repeat.

**Departure from the post.** The post sends unsure cases to Kimi K3. This eval sends them to particle-1, by the project owner's choice on 2026-11-09, and makes no Kimi K3 call. Findings speak to Jev routing with particle-1 behind it, and the results post says so in its first lines.

**What the post's 90% rests on.** The article's worked math is a pure decision workload (10,000 emails at about 1,000 tokens each, 10% escalated) against an uncached frontier call per email; the vendor's own cascade estimate in the post is about 79%. A coding agent also writes code, the creative calls stay on the frontier model in every arm, and prompt caching bills repeated context at a tenth of the input price. So we predict, before any data, that the cut on a coding agent's total bill is bounded by the share of the natural loop's bill spent in turns that edit no file (S3), and that a 90% needs the post's no-caching price assumption (S6).

**Construct fit (one sentence).** The claim's value is a smaller total bill at equal task success, and the primary scores exactly that: the real bill of every model call and hidden-test success on whole tasks run end to end, with wall-clock time beside them because speed is the router's other claimed gain. A second construct check guards transfer: the natural loop's pass rate on calibration tasks is compared with Claude Code's on the same tasks from data in hand (section 7).

**The public lesson (R79).** How much of a real frontier coding agent's bill sits in small decisions; whether those decisions can move off the frontier model without losing task success; whether a calibrated router adds anything over a cheap reasoning model answering every decision; and which decision types are safe to move. Builders get a number either way, such as "route these decisions to a cheap model and save X%" or "you don't need the router; particle-1 alone does it, and the saving is bounded by Y%".

### 2. Units and custody

**Pool.** The SWE-rebench leaderboard pool R3 amendment 4 pinned (quick/laneb/tasks/swerebench-r3a4.json): issues created 2025-10 to 2026-03 in public GitHub repos, 354 tasks at 8G of memory, 346 kept after the oracle preflight (the real fix passes the verifier), each with a Docker image pinned by digest and Harbor packaging (CC-BY-4.0). The dataset has no newer month (Hugging Face revision 34d5a588, last modified 2026-07-28). SWE-rebench V2 (32,079 tasks) is not fresher: 106 tasks are dated 2025-08 or later. The free supply count is in the Captain drive (handoffs/GEVA-411/supply-count.md).

**Held out.** Every pool task has run in an earlier gstack experiment, but none was used to design or tune decision routing. Thresholds and question wording are tuned only on the calibration split, and no scored task's output is read before the scored stage starts. The repos the exploration patched (gstack, gbrain and a private project) are never scored.

**Splits.** One seeded draw (draw.py, seed 20261109), frozen now because it reads only committed pool files, splits the kept pool: L1's screen.txt plus eligible.txt, 346 ids with sorted sha256 f0632159...c9be76dc. It drops a task whose upstream change duplicates one already kept (L1's rule for a repository that moved owner; one twin, pytest-dev__pyfakefs-1286), shuffles the other 345, and fills scored (280), then calibration (40), then spare, with at most 4 tasks per repository in each split. That gives 280 scored tasks from 185 repositories, 40 calibration tasks from 17, 16 spares from 10, and 9 tasks the cap strands (2 from litellm, 7 from sqlglot). The isolation subset is the first 100 scored tasks in shuffled order (79 repositories). The pilot uses the first 20 calibration tasks (8 repositories), and the small pilot cells use the first 12. draw.txt prints every count and each list's sorted sha256, and the five lists sit beside this post in shuffled order. Filling scored first spreads it widely and leaves calibration to repositories with more than 4 tasks; section 19 states the cost. A scored task that can't run (image pull or verifier failure after the registry window) is replaced by the next spare in shuffled order, and the count prints.

**Hidden tests.** Lane B's materializer builds a separate verifier from the pristine image and applies the agent's patch there, so FAIL_TO_PASS and PASS_TO_PASS tests are never in the agent's container.

**Custody.** Requests to TypeSafe and Particle carry only what the agent sees: the issue text, command outputs from the task container, the agent's own diff and its step summaries. All of it is public code and public issue text. The real fix's patch and hidden tests stay on the runner, for grounded labels (section 6 and S4). No gstack-evals sealed set, held-out key or private-repo source is used. **Leak scan.** Every decider request body in the proxy journal is scanned, in the dry run and live, for content that exists only on the runner: hunks of the hidden test patch that add new tests, file paths absent from the pristine image, and canary strings planted in the label store. Only a match with runner provenance is a custody hit, which stops the run (section 15). Existing test names and an agent diff equal to the real fix's hunk are legitimate, since a correct agent can write the real fix, so they are logged, never stopped on. **Keys.** A task container holds only a per-session proxy token. No provider key and no TYPESAFE_API_KEY enters it, because the agent can run env.

### 3. What the exploration found (descriptive, never evidence here)

The exploration thread (GEVA-410, report in the Captain drive) inventoried model decision calls in gstack (20, pinned b6155921), gbrain (25, pinned 15e3ab8c) and a private project (10), and replayed 8 points on held splits of 39 to 296 items with four arms: today's model, particle-1 alone, Jev 1.13.0 alone, and the cascade (Jev, then particle-1 below a threshold tuned on a dev split, shown Jev's guess). A missing or unreadable answer counted as wrong.

- The cascade cost 0.2% to 6.8% of today's cost per decision on all 8 points. It held accuracy on 6, lost on gstack's long rubric judges (-9.9 points) and was borderline on one point where today's Opus 5.5 scored 117 of 117.
- particle-1 alone matched or beat the cascade on 7 of 8 points at 1% to 14% of today's cost, and measurably beat today's model on 4 (for example +9.2 points on gbrain's dream triage and +5.7 on its take grading).
- Jev's gain over particle-1 was speed: 70 to 90 ms per decision at p50 against 0.7 to 5.2 s for particle-1 and 0.9 to 16.5 s for today's models. Its extra cost saving was 1x to 4x on decisions that already cost fractions of a cent.
- Escalation paid only where Jev was calibrated. Its held-split ECE was 0.04 to 0.10 on six points; on dream triage it ran backwards (0.49, most confident answers wrong about half the time, 64% escalated), and on one private-project point it was under-confident (0.31, 89% escalated, the cascade cost more than particle-1 alone).
- Showing particle-1 Jev's guess helped on 1 point and scored at or below particle-1 without it on the other 7.
- particle-1 reasons before it answers: token caps of 600 to 2,048 gave no-answers that went away at 4,000, and 8,192 was short on long rubric prompts.
- The premise fits those repos poorly: most gstack decisions live in skill prompts the frontier model runs, the private project makes no model call at runtime, and gbrain already ships a decision router whose own verdicts gave Jev 2 of 9 slots.

What this plan takes from it: particle-1 alone becomes a full arm and the router's main comparison; calibration is scored per decision type and gates whether Jev acts; wall-clock time sits beside cost and success; particle-1's caps start at 8,000 and a no-answer counts as wrong; and the eval uses a real agent loop whose decisions are code-level calls.

### 4. The agent loop

**Base.** mini-swe-agent (PyPI mini-swe-agent, MIT; version and wheel sha256 pinned at the build pin, 2.4.6 as of 2026-11-08). Every cell uses one execution model: Harbor's installed MiniSweAgent, at the Harbor commit the SWE-rebench pool pins (f3a5a923), runs mini inside the task container, and mini's local environment runs each command in /testbed. mini, the decision layer, litellm and every SDK live in an arm-neutral runtime layer: an isolated uv-managed venv on its own path, never on the repository's sys.path, with PYTHONPATH cleared and the venv off the command PATH, so the agent's commands see the repository's own interpreter and packages. Every cell, N included, runs in that same layer. Natural mode takes the agent and model settings of mini's own SWE-bench configuration as published at that version (its prompt templates, action format and model settings, set_cache_control included, all listed in the pin file). Its docker environment section is not used, because Harbor's installed agent already runs inside the container. We set only the model, the limits below and a 45-minute wall limit, the same in every cell. mini has one tool, bash, runs each command independently and keeps a linear history. Prompt caching is on the way each provider supports it through mini's model layer (Anthropic cache breakpoints through set_cache_control; OpenAI automatic caching), and the main model's reasoning is each API's default, the same in every cell.

**Limits.** The step limit is 100 executed actions in every cell, counting actions run for the main model and actions run for a decider alike. In N that is mini's own step limit, because its SWE-bench configuration runs one action per model call (B9 checks this on the pinned version); routed cells raise mini's own limit exception when main-model and decider actions together reach 100. mini's cost_limit is 0, which mini reads as off, and its cost tracking ignores models it can't price (B9 checks both), so the per-session proxy allowance of $5 is the only dollar stop and covers every call in the session. The bill always comes from the proxy journal, never from mini's own count.

**Routed mode** is a subclass of mini's DefaultAgent that overrides query() and execute_actions() to add five code-level decision points. Natural-mode code is never edited. Every decision gets the same state: the issue text (first 4,000 characters), the agent's current diff (stat plus the first 3,000 characters), the last command and its output (trimmed to 8,000 characters), a one-line summary of each of the last 10 steps (written by code: the command cut to 120 characters plus its exit code; no model writes them), and the decision's own fields. That fits Jev's 32K per-question limit.

1. **Next step** (Choice), before every main-model query after the first. Options are rebuilt from live state each time, as the post describes: run_tests (rerun the last test command the agent itself ran; offered only once one exists), show_k for up to 5 candidate files (paths named in the last output, from a traceback or a search, that the agent has not printed), submit (mini's own submit command), and other. A pick other than other is run by code with no main-model call. The history then gets a synthetic assistant message in mini's own action format (the bash block), marked as run by the controller, followed by mini's observation message, so the linear message protocol holds and the cache prefix keeps growing by appending. other hands the turn to the main model.
2. **Source relevance** (Noul per hit), after a command whose output lists more than 20 path hits (grep, rg, find, ls -R). The first 100 hits in output order are asked about, and the rest are kept. A decider may drop a hit only on the drop side, inside a tuned drop band (section 6); an unsure or failed answer keeps the hit, so relevance never calls the frontier model in R, P or J. Dropped hits are removed from what the main model sees, with a line saying how many were dropped.
3. **Test pass** (Noul). The post's first layer is an exact rule in code with a frozen parser. A command is runner-exit only when it is one simple command, or cd <dir> && followed by one, whose program or module is in a frozen runner list (pytest, py.test, python -m pytest, python -m unittest, tox, nox), with no pipe, ;, ||, & or second command after it (redirection to a file is allowed). Then its exit code decides. Anything else, such as pytest piped to tail or tee, pytest; echo $? or pytest || true, goes to the decider. B8 holds table tests for the parser. The answer is written into the state as last_test (passed, failed or unknown) for the next-step and done decisions.
4. **Command safety** (Noul), before every command the main model proposes. A command the decider calls unsafe is not run; the main model gets "blocked as unsafe" and continues.
5. **Task done** (Noul), when the main model or the next-step decider submits. If the decider says not done, the main model gets one line saying so and continues; a third submit in a session stands, and submits chosen by the next-step decider count toward the three.

**Who acts (the defer rule).** Each layer either acts or hands the decision down, by one rule per layer, the same in every cell that has the layer.
- Jev (R and J) acts only inside an acting band (tuned in R, section 6; fixed in J, section 5) and never on an exit pick.
- particle-1 (R and P) acts on next step unless it picks the exit (other) or its confidence is below its own threshold, tuned on calibration by the same band rule as Jev's; with no qualifying band it never acts on next step. On test pass, safety and done its answer acts (yes when its probability of yes is at least 0.5), and the decision falls to the main model only when particle-1 fails after its retry. On relevance it may drop a hit only inside its tuned drop band; otherwise the hit is kept.
- The main model is the last layer: for next step it takes its own turn; for test pass, safety and done it answers the same typed question (the typed-frontier rendering below) and its answer acts. Relevance has no frontier layer in R, P and J: a hit no decider drops is kept, because keeping a hit is free and dropping the fix file is the costly error.

So an unsure or failed decider costs a frontier call or keeps a hit, never a silent default. B8 tests the rule in every cell.

**Loop guards.** At most 3 decider-run actions between two main-model turns; the same decider-run action never twice in a row; run_tests never twice without a code change between. A guard that fires hands the turn to the main model and is counted.

**Question text.** Written now from the posted rules (describe situations, not moods; one judgment per question; every Choice has an exit; every Noul reads so a high number means yes; backticked field paths), frozen in questions.json by sha256, the same text for every decider. Draft wording:
- next_step: "Pick the next step for a coding agent fixing the issue in `task`. Pick a listed action only when `last_output` and `recent_steps` make it clearly the right next step." run_tests: "The last step in `recent_steps` changed code and no test has run since." show_k: "`candidates[k]` has not been printed, and `last_output` names it as where the failure happens or where the code the issue describes lives." submit: "`diff` changes code for the issue and `last_test` is passed." other: "None of the above clearly applies, or the next step needs new code, a new search or a new command."
- relevant: "Would the change asked for in `task` most likely need to read or edit `hit`?"
- tests_passed: "Does `last_output` show that every test that ran passed, with no failures or errors?"
- safe: "Is `command` safe to run in the task's container: it changes nothing outside /testbed, sends nothing over the network, and does not delete the repository or rewrite its git history?"
- done: "Is the task in `task` done: `diff` makes the change the issue asks for, and `last_test` is passed?"

**Fan-out.** As posted, questions that share a state go in one Jev request (next_step with done; every asked relevance hit of one command in one request). particle-1 and the main model get every asked hit of one command in one structured request with an array schema, one answer and confidence per hit.

**Generative deciders** (particle-1, and the main model in the typed-frontier cell and as the last layer) get the same state and question text as a structured-output request: a JSON schema with the options (the exit included) and a 0-to-1 confidence field. particle-1 runs with max_tokens 8,000 and its default reasoning. A reply that is missing, truncated or fails the schema gets one retry, then falls to the next layer (for relevance, the hits are kept). In the router, particle-1 is also shown Jev's answer and probabilities, as the post gives its escalation model.

### 5. Cells and models

Creative (main) model M is Opus 5.5 or GPT-6.1 Sol in every cell except W.

| Cell | Decision layer | Who answers a decision | Tasks |
|---|---|---|---|
| N, natural | off | M, inside its own turns (mini as shipped) | 280 scored + 40 calibration, both models |
| R, router (the claim, with particle-1) | on | exact rule, then Jev 1.13.0 inside its tuned acting band, then particle-1 (shown Jev's guess) under the defer rule, then M | 280, both models |
| P, particle-1 alone | on | exact rule, then particle-1 for every decision under the defer rule, then M | 280, both models |
| F, typed frontier | on | exact rule, then M answers the typed questions and its answer acts (relevance in one array request, a no drops the hit; an exit pick hands M its own turn) | 100 subset, Opus |
| J, Jev alone | on | exact rule, then Jev 1.13.0 at one fixed threshold (Choice confidence 0.9; Noul acts yes at p 0.9 or more and no at 0.1 or less; relevance drops only at p 0.1 or less), then M (relevance: the hit is kept) | 100 subset, both models |
| W, whole agent on particle-1 | off | particle-1 is mini's main model (32,000 tokens a turn) | 100 subset |

**What each comparison isolates.** R against N: the claim. R against P: what Jev adds over a cheap reasoning model answering every decision (the router's main comparison). P against N: moving decisions off the frontier with no router. F against N: the cost and success of restructuring an agent into typed decisions. R against J: particle-1 as the middle layer. W against N, R and P: switching the whole agent against routing its decisions.

**No gstack in any cell.** The loop contains no gstack file, skill, hook or drive path, so every cell is a no-gstack arm by construction (cited code, checked in the dry run). No gstack cell runs, because no gstack decision point is a code-level call on a coding agent's path (section 3); the results post says so. Folding routing into gstack is GStack Minder's call after the results (R56).

**Pins.** anthropic claude-opus-5-5 (Anthropic API); openai gpt-6.1-sol (OpenAI API); TypeSafe jev-1.13.0 through POST /v1/systemone with typesafe-sdk at a pinned version; particle-ai/particle-1 through OpenRouter with the provider list fixed to Particle AI and fallbacks off. The price table is re-read and dated at the build pin (read 2026-11-08: Opus 5.5 $4 in, $20 out, $0.20 cache read, $5 cache write per million; Sol $2, $10, $0.10, $2.50; Jev $0.042 in, output free; particle-1 $0.05 in, $0.50 out).

**Models under test (R54).** Opus 5.5 and GPT-6.1 Sol as creative models. particle-1 is the low-cost primary in the roles the question gives it: the escalation decider, the all-decisions decider and the whole-agent reference. A routed cell with particle-1 as the creative model is left out, because routing a cheap agent's decisions can't move a bill that is already about $0.20 a session. No open-weight ladder slot runs, so the OpenRouter programming ranking needs no re-read.

### 6. Calibration stage (the shadow week)

1. N runs on the 40 calibration tasks on both models (80 sessions). At each of the five decision points' moments in every N session (before each main-model query, after each listing over 20 hits, before each command, at submit), the build computes the decision state and logs it. Nothing is asked during the session, so N's clock is untouched. After the session, off the clock and outside the task container, Jev 1.13.0 and particle-1 answer every logged state in shadow, and particle-1 answers each state twice, with and without Jev's guess (R shows it the guess, P doesn't). N's own behaviour is the frontier's answer (it ran the command, it opened the file, it submitted).
2. **Grounded labels**, computed after the session in a separate label container built from the pristine image plus the tree's diff at that moment, never in the agent's container:
   - Done: the hidden tests on that snapshot.
   - Relevance: whether the real fix's patch edits the hit's file ("edited by the real fix: must keep").
   - Test pass: the runner's exit code, from the same test command rerun without the pipe on the snapshot.
   - Safety: a frozen pattern rule over N's real calibration commands (a write outside /testbed, a network call to any host but the proxy, deleting the repository, or rewriting git history: push, rebase, filter-branch, or reset to another commit; exact patterns in the pin file), plus the constructed set's calibration half (100 of 200 commands) for unsafe commands that real sessions rarely produce.
   - Next step: no grounded label. It uses agreement with N's next action under a mapping frozen in code: N reran the exact last test command is run_tests; N printed candidates[k] (cat, head, tail, sed -n, nl or less on that path) is show_k; N submitted is submit; anything else is other. B8 tests the mapping.
3. **Question rewrite.** For any type whose Jev answers are right on under 80% of calibration decisions, the build thread rewrites that question once, from the posted rules only. Jev and particle-1 (with and without the guess) all re-answer the same logged states, and every rate prints before and after. No scored task is looked at.
4. **Pooling.** Calibration states from both creative models are pooled per type, and one set of thresholds serves both.
5. **Acting bands.** For Jev, for particle-1 with the guess (R) and for particle-1 without it (P), per type, bands of the decider's confidence start at 0.95, 0.90, 0.80, 0.70, 0.60 and 0.50 (Choice: the confidence field; Noul: max(p, 1 - p)). The threshold is the lowest band edge at which the region at or above it holds at least 40 labelled decisions and its accuracy's Wilson 95% lower bound is at least 0.90. Empty bands are skipped, never counted as right or wrong. If no edge qualifies, that decider gets no acting band on that type.
   - Jev's ECE gate. A type gets a Jev acting band only when Jev's ECE over 10 equal-width bins, on at least 100 labelled calibration decisions, is 0.15 or less. With fewer than 100, ECE is mostly noise, so the type gets no Jev band. Jev still answers a type with no band (its guess goes to particle-1) but never acts on it.
   - Relevance acts on the drop side only. A decider may drop a hit only in a band where calibration dropped no fix-edited file over at least 40 decisions. Keeping is the default, so the keep side never needs a band.
   - Safety. Jev may block only in a band whose false blocks on N's real commands are at most 1%, and allow only in a band that passes the Wilson rule. Blocked commands print per cell.
   - particle-1's bands apply where the defer rule uses them: next step and the relevance drop side. On test pass, safety and done its answer acts as section 4 says.
6. Thresholds, acting bands, the safety pattern rule, the next-step mapping and questions.json are written to a pin file with their sha256 before any pilot or scored session.

### 7. Admission (E1) and the construct check

From calibration and the pilot, before any scored session:

- **Room in the control.** N's calibration pass rate must sit between 15% and 90% on each creative model. A model outside that range stops its items for the Captain before the pilot.
- **Transfer.** N on Opus must pass at least 40% of calibration tasks (Claude Code passed 64.5% of 200 tasks of this pool); below that the run stops for the Captain before the pilot. The 40% line was set from that Opus figure, so Sol gets the room check only.
- **The cut's ceiling.** From the 80 calibration N sessions, the share of N's dollars spent in turns that edit no file (S3's first look) prints per model before the pilot. That share bounds the cut. If it is under 80%, the run says in advance that HOLDS can't occur and runs anyway, because the success leg, the router against particle-1 alone and the decision-type map are still the lessons.
- **MDD inside the margin.** Discordance d is the share of pilot pairs where R or P differs from N on the same task and model, pooled over 80 pairs (20 tasks x 2 models x 2 contrasts). The pairs share tasks and the pilot tasks are calibration tasks, so admission reads the upper end of d's 80% interval from a bootstrap that resamples whole tasks (10,000 draws, seed 20261112). If it is at most 0.20, the non-inferiority tests are admitted. Above 0.20, the success endpoints print intervals and MDDs with no non-inferiority verdict, the verdicts come from section 11's rows for that case, and the Captain hears before the scored stage. At 280 tasks the MDD is 5.8 points at d = 0.12, 6.5 at 0.15 and 7.5 at 0.20, and at d = 0.15 the test's power is 0.90, 0.66 and 0.50 against true differences of 0, -2 and -3 points.
- **Exposure.** If Jev has an acting band on no decision type, R is P with Jev's guess added, and the Captain hears before the scored stage (the plan runs as frozen; R48 reads it as exposure).

### 8. Pilot

R and P on both models on the first 20 calibration tasks, and J on both models, F on Opus and W on the first 12, with the frozen pin file. The pilot checks wiring (every decision point answered by the right layer under the defer rule, every layer reachable, the loop guards, the action count), measures each cell's dollars, wall time and decider questions per session (relevance questions above all), and re-costs the scored items with the frozen price script: each cell's rate becomes the higher of its planning rate and its pilot mean. If the all-in at caps then passes $2,000, cells drop in this order until it fits: W, then J on Sol, then F, then the subset from 100 to 80 tasks. Each drop prints as "not run under the line". If particle-1's no-answer rate after its retry exceeds 2% of its pilot decisions, its decision max_tokens rises once to 16,000 for the scored stage (frozen now, decided on pilot data only). A pilot session costing more than $2.50 stops for the Captain. Pilot outcomes are never scored.

### 9. Scored stage

N, R and P on both models on all 280 scored tasks; F (Opus), J (both models) and W on the 100-task subset. One trial per task and cell. Each batch runs its cells interleaved in one seeded order (seed 20261110), so provider load and time of day fall on every cell alike, and cells of one task never run at the same time on one VM. Runs go detached on runner VMs with a ledger lease per item, and the controller and ledger live on a host that stays awake. Each batch pulls every image it needs before its first session, and after any stop the controller reconciles open leases before a relaunch (section 15).

### 10. Scoring rules

**Success.** The verifier's reward on the agent's final patch: 1 when every FAIL_TO_PASS and PASS_TO_PASS test passes, else 0. No judge.

**Bill.** The sum over every model call in the session (main model, Jev, particle-1, retries and no-answers included), priced from each provider's own usage fields (input, cached input read, cache write, output, reasoning) with the dated price table, read from the proxy journal. TypeSafe bills input tokens only; its usage.input_tokens is priced at $0.042 per million and its output-token count prints beside it.

**Wall-clock time.** Session time from the first model call to the end of the agent's run, excluding container setup and verification; and per decision call, request to answer by decider (p50 and p90). Label runs and shadow answers happen after the session and never count.

**Outcomes per session, settled now.**
- **Stops.** An allowance stop, the step limit (100 actions) or the wall limit (45 minutes) ends the session, and the verifier grades whatever patch is in /testbed at that moment, in every cell alike, as earlier lanes did. Its spend and time count, and stops print per cell and kind.
- **The allowance stop is never infrastructure.** The proxy refuses a call past the $5 allowance with its own status and body code and journals it. The session wrapper maps that code to allowance_stop before Harbor's rerun logic sees the session, so an allowance stop is graded and never rerun. The same holds when a decider call hits the allowance mid-fall-through.
- A session with no model response, or ended by any other provider error after the SDK's retries, is infrastructure: Harbor reruns it once inside the same launch; failing again it is missing, a coverage gap, never a fail.
- A decider call that fails after its retry (an outage, a 429 storm, a missing or unreadable reply) falls to the next layer, as a working system would (for relevance, the hit is kept), and the session goes on. Its cost and time are billed. In every decision-level score it counts as wrong. Over 5% of a cell's decisions failing marks that cell degraded, and a null on it reads FIX-METHOD on infrastructure.
- A blocked command the agent then works around or gives up on is the cell's real behaviour, graded as it ends.
- A decision state over Jev's 32K per-question limit after trimming goes to the next layer and is counted.
- A grounded label that can't be computed (a snapshot that won't build) is missing for that decision, counted, never imputed.

**Coverage.** An endpoint has no outcome when any of its cells has graded sessions for under 90% of its planned tasks, or over 10% of tasks fail to enter. Nothing graded is rerun. A cap stop ends the run incomplete and is never retried to change a verdict.

**Pairing.** Every comparison uses tasks graded in both cells, on the same creative model.

### 11. Endpoints and verdicts

Each creative model (Opus 5.5 and GPT-6.1 Sol) gets its own verdicts; none is pooled across models. Paired success differences and their 95% intervals come from the stats kit's clusteredPairedDelta (src/runner/stats/paired.ts), resampling repositories (at most 4 tasks each; 10,000 draws, seed 20261111). A verdict reads the interval's bounds, so a lower bound above -7.5 points is the one-sided 2.5% non-inferiority test. Bill and time ratios use a bootstrap over the same repository clusters with the same seed.

**Primary A, the claim: R against N.**
- Cut = 1 - (sum of R's bills / sum of N's bills) over paired tasks, with its 95% interval; the median per-task ratio prints beside it.
- Success: R's pass rate minus N's, paired, with its 95% interval and the counts of tasks that got worse and better. Non-inferiority margin 7.5 points.
- Wall clock: the ratio of summed session times, with its interval.

The verdict is the first rule that matches, in order. When admission let the non-inferiority tests in (section 7):

1. NO SAVING: the cut's lower bound is at or below 0.
2. TRADES SUCCESS FOR COST: the success upper bound is below 0 and its lower bound is at or below -7.5.
3. INCONCLUSIVE ON SUCCESS: the success lower bound is at or below -7.5.
4. HOLDS: the cut's lower bound is 80% or more.
5. SAVES LESS: anything else (the cut's lower bound is above 0 and below 80%, and the success lower bound is above -7.5).

When admission kept the non-inferiority tests out (d's upper bound above 0.20):

1. NO SAVING: the cut's lower bound is at or below 0.
2. SUCCESS MEASURABLY LOWER: the success upper bound is below 0.
3. CUTS ABOUT 90%, SUCCESS UNTESTED: the cut's lower bound is 80% or more.
4. CUTS LESS, SUCCESS UNTESTED: anything else.

"About 90%" reads as a cut whose lower bound is at least 80%. A success interval that includes zero reads "no measurable difference"; a non-inferior interval wholly below zero reads "a small measurable loss inside the margin". The cut, its interval and the time ratio print whatever the verdict.

**Primary B, the router against particle-1 alone: R against P.**
- Success: R minus P, paired, 95% interval, worse and better counts.
- Bill ratio R / P and wall-clock ratio R / P, each with its interval. R is cheaper when the bill ratio's upper bound is below 0.90, and faster when the time ratio's upper bound is below 0.90. Every verdict states the two legs separately.
- R against P changes two things at once, Jev acting and particle-1 seeing Jev's guess, which together are the router as the post describes it. S11 separates the guess at decision level.

First match wins. With the non-inferiority tests admitted:

1. PARTICLE-1 ALONE IS BETTER: the success upper bound is below 0.
2. INCONCLUSIVE: the success lower bound is at or below -7.5.
3. THE ROUTER EARNS ITS PLACE: R is cheaper, faster or both, and the verdict names which ("cheaper and faster", "cheaper" or "faster").
4. PARTICLE-1 ALONE IS ENOUGH: anything else (success within the margin, R neither cheaper nor faster).

With them kept out: PARTICLE-1 ALONE IS BETTER when the success upper bound is below 0; otherwise R CHEAPER AND FASTER, R CHEAPER, R FASTER or NO COST OR TIME GAIN, each with "success untested".

B8 runs both printers over a full grid of cut lower bound, success lower and upper bound, both ratio upper bounds and admission, and checks that exactly one verdict prints at every point. P against N prints in Primary A's form (cut, success, time) with no verdict of its own, so a reader can see what moving decisions off the frontier does without a router.

**Secondaries (intervals, no verdict).**
- S1 decomposition (subset, Opus): F against N (restructuring) and R against F (decider swap), on bill, success and time.
- S2 ingredients (subset): R against J; J against F on Opus.
- S3 decision share: the share of N's dollars and of its time spent in turns that edit no file, by kind (test runs, reads, searches, submit). This is the room any decision routing has on this agent.
- S4 calibration per decision type on the scored tasks' grounded labels: done (hidden tests on a snapshot), relevance (files the real fix edits, must keep), test pass (the runner's exit code), safety (false blocks on the scored sessions' real commands under the frozen pattern rule, and detection on the constructed set's held half: 100 of 200 public-safe commands, half that write outside the repository, send data out or rewrite git history, half ordinary, labelled by construction). Per type: Jev's accuracy by confidence band and ECE over 10 bins, and particle-1's and the frontier's accuracy on the same states, no-answers counted wrong. Next step reports agreement with N's own next action only.
- S5 latency: per decision p50 and p90 for Jev, particle-1 and the frontier, beside the vendor's speed claim; where the router's time goes; and the deciders' share of session time per cell.
- S6 re-pricing from logged tokens, no new calls: every bill with caching priced away (what the post's math assumes) and at batch prices.
- S7 newer release: Jev 1.14.0 on every logged decision state (decision level, descriptive).
- S8 switching against routing: W against N, R and P on bill, success and time, with W's gap to the frontier and its interval in any headline that favours particle-1.
- S9 where it breaks: for every task one cell passed and the other failed (R against N, R against P), the rule-based trace from the decision log of the last decision before the paths parted (a submit the done check let through, a dropped hit in the real fix, a blocked command, a loop guard, an exit storm). Counts per kind, no judge.
- S10 acting rates: per cell and type, the share of decisions settled at each layer, the no-answer and retry counts, wrong acts (a decision acted on below the main model that its grounded label marks wrong), the fix-file drop rate, blocked commands, decider questions per session, and stops per kind.
- S11 the guess: on every logged R state of the subset, particle-1 with and without Jev's guess, decision level.

### 12. Attacks on the scoring rules, answered before code

1. *"A weak harness makes routing look bad."* N is mini as its authors ship it; F uses the same decision layer with the frontier answering, so R against F isolates the decider; the transfer check stops the run below 40% on Opus.
2. *"A harness built for the claim makes routing look good."* The natural loop is a published agent, unedited; the decision layer only adds calls at code-level hooks; and P runs on the identical layer, so anything the layer itself buys shows up in P too.
3. *"Thresholds tuned on the scored set."* They come only from calibration tasks, are pinned by sha256 before any pilot or scored session, and the scored draw is fixed after the build pin.
4. *"Rewriting questions until Jev agrees."* One rewrite per type, from the posted rules only, on calibration states only, both rates printed.
5. *"Miscalibrated confidence hides behind a threshold."* A type with calibration ECE above 0.15 gets no acting band; S4 reports ECE on the scored tasks' grounded labels.
6. *"The cut is a ratio of noisy totals."* The interval is a task bootstrap over paired tasks, and the median per-task ratio prints beside it, so one expensive task can't carry the headline unseen.
7. *"Failures look cheap."* A routed agent that stops early is cheap and wrong; every verdict needs success, and allowance and step-limit stops are fails with their spend counted.
8. *"Infra gaps bias a cell."* Infrastructure is missing, never a fail, with one in-launch rerun; an allowance stop has its own code, is graded and is never rerun, so a cell that burns money can't turn its costliest failures into gaps; coverage under 90% voids the endpoint; decider outages fall through, are billed and counted, so a flaky vendor shows as lost savings, not a hidden gap.
9. *"No-answers get quietly forgiven."* particle-1 runs at 8,000 tokens, its no-answers fall to the frontier at the frontier's price, count as wrong at decision level and print per cell.
10. *"Exit storms hide in the router."* If Jev and particle-1 mostly pick the exit, R becomes N with overhead; S10 prints acting rates, and R48's exposure step reads them.
11. *"Caching flatters the baseline."* Caching is how a builder pays today, so it stays in the primary; S6 prices it away so the post's assumption is visible.
12. *"Leaks through the decider."* Deciders see only the agent's own state, and every decider request is scanned, in the dry run and live, for content only the runner holds (new hidden tests, paths absent from the pristine image, planted canaries).
13. *"Two models pooled into one claim."* Each model gets its own verdicts.
14. *"particle-1 is favoured by an investor tie."* Any headline that favours particle-1 gives its gap to the frontier with the interval, and the Particle disclosure ends the post.
15. *"The router's speed win is mechanical."* Jev answers in about 80 ms and particle-1 in seconds, so R is likely faster than P on time alone. Primary B states cheaper and faster as separate legs, and S5 prints the deciders' share of session time per cell, so a speed-only win reads as one.
16. *"An always-drop decider looks accurate on relevance."* With over 20 hits and one to three fix files, almost every label is no. The label is "edited by the real fix: must keep", deciders act only on the drop side in bands that dropped no fix file over at least 40 calibration decisions, and the fix-file drop rate prints per cell.
17. *"Routed cells get more actions."* The step limit counts every executed action, from the main model or a decider, in every cell.
18. *"Shadow calls slow the control."* Calibration logs states and answers them after the session, so N's clock and the room check never see a decider.

### 13. Power and the MDD

Paired binary success, one trial per task and cell. With discordance d and a true difference near zero, the MDD (two-sided 5%, power 80%) is 2.80 x sqrt(d / n). Discordance in hand: two GPT-6.1 Sol arms that barely differ split on 3 to 7 of 80 tasks (0.04 to 0.09); particle-1 arms on 7 to 11 of 78 to 80 (0.09 to 0.14); Opus none against Sol none on 28 of 199 (0.141). Routing changes behaviour more than a near-identical arm does, so the plan uses d = 0.12 and admits up to 0.20 (section 7).

| d | MDD at 100 tasks | at 240 | at 280 | tasks for a 5-point margin |
|---|---|---|---|---|
| 0.10 | 8.9 | 5.7 | 5.3 | 314 |
| 0.12 | 9.7 | 6.3 | 5.8 | 377 |
| 0.15 | 10.9 | 7.0 | 6.5 | 471 |
| 0.20 | 12.5 | 8.1 | 7.5 | 628 |

Bill and time ratios across 280 paired tasks have intervals a few points wide. The subset cells (100 tasks) are secondaries with intervals and no verdict; their MDD near 10 points prints beside them. power.py and power.txt freeze the table. power.txt also prints the 7.5-point test's power at true differences of 0, -2 and -3 points, and admission reads the upper end of d's 80% interval (section 7). Intervals resample repositories; power.py treats tasks as independent, and the cap of 4 tasks per repository keeps that gap small.

### 14. Money (internal; a gate input, not for the public post)

The line is $2,000 all-in (no judge): paid calls, runner VMs and the crew's own model use read from thread counters at about $1 per 1,000 credits. A projection past $5,000 goes to the project owner. The exploration's spend sits on its own item and isn't counted here. price.py freezes the planning table; the pilot re-costs it.

| Item | Sessions | Expected | Cap |
|---|---|---|---|
| Calibration: N on both models, deciders in shadow after each session | 80 | $39 | $90 |
| Pilot: R and P on both models, 20 tasks | 80 | $26 | $70 |
| Pilot: J on both models, F on Opus and W, 12 tasks | 48 | $21 | $70 |
| Scored, Opus: N, R and P on 280 | 840 | $286 | $420 |
| Scored, Sol: N, R and P on 280 | 840 | $316 | $460 |
| Scored subset: F on Opus, J on both models, 100 tasks | 300 | $153 | $240 |
| Reference: whole agent on particle-1, 100 tasks | 100 | $20 | $60 |
| Decision-level replay: Jev 1.14.0, safety set, guess ablation | | $15 | $40 |
| Runner VMs: 139 hours, with 3,000 label runs and image pulls | | $84 | $140 |
| Crew: every thread on this line, read from counters | | $220 | $350 |
| **All-in** | **2,288** | **$1,179** | **$1,940** |

Planning rates per session: N $0.40 on Opus and $0.45 on Sol (Claude Code measured $0.37 and $0.425 on this pool); F 2 times N, because its typed frontier calls are uncached structured requests on every command and query; R and P about 0.75 to 0.8 times N with deciders included; J between them and N; W $0.20; offline shadow answers $0.06 a calibration session. VMs: 0.05 hours a session (R3 amendment 4 measured 0.032 to 0.054), 0.005 hours per label verifier run (at most 2 done states a session in calibration N and scored R, P, J and F sessions), and 10 hours of image pulls and waits, at $0.60 an hour. Crew: from comparable threads' counters (a gate-class build and its /ship about 150M to 250M tokens, a run thread 100M to 150M, a results post and its /ship about 100M) at about $0.30 per million tokens, capped with headroom. Item cap = ceil10(m x expected + 6 parallel sessions x $5), with m 1.5 for calibration and pilot and 1.35 for scored items.

The caps sum to $1,940, inside the $2,000 line with $60 to spare, so the line stays at $2,000. If the pilot re-cost passes it, section 8's drop order applies; a raised line would need the Captain, and a projection past $5,000 the project owner. The Captain records every item's cap before its first lease.

### 15. Build, dry run and start rules

The build lands with the results PR, pinned by commit before calibration (R77: this experiment has two merged PRs, this preregistration and its results). Units:

- B1 the routed agent: a subclass of mini's DefaultAgent with the five decision points, the defer rule per layer, the loop guards, the action-counting step limit, code-written step summaries, the synthetic assistant message before each decider-run action, and questions.json by sha256; natural mode is mini unedited. The arm-neutral runtime layer (an isolated uv venv holding mini, the decision layer, litellm and the SDKs, off the repository's sys.path) serves every cell.
- B2 decider adapters: TypeSafe (typesafe-sdk pinned) and structured-output adapters for Anthropic, OpenAI and OpenRouter, all through the metering proxy, with particle-1's max_tokens and retry rule and the array schema for relevance.
- B3 a TypeSafe route and price row in the proxy and price table, particle-1's provider pin (Particle AI only, no fallbacks), per-session proxy tokens, and a distinct proxy code for allowance exhaustion, journalled.
- B4 the per-session decision log (decision id, type, state digest, every layer's answer and probabilities, the acting layer, latency, tokens, cost), the session summary, and the session wrapper that maps the allowance code to allowance_stop before Harbor's rerun logic.
- B5 the scorer: success from the verifier, bill from the proxy journal, wall-clock time, the paired analysis through src/runner/stats (paired.ts and outcome-cost.ts, no new bootstrap), and the verdict printers for both primary tables.
- B6 the calibration tuner (ECE gate, Wilson bands, the relevance drop side, the safety false-block gate, particle-1's bands) and the question-rewrite replay for Jev and particle-1.
- B7 grounded labels, computed after each session in a separate label container from the pristine image plus a snapshot diff and kept on the runner: real-fix file sets, the done snapshot verifier, the test rerun, the safety pattern rule, the next-step mapping, and the 200-command safety set with its seeded halves.
- B8 a keyless dry run with fake upstreams for every provider that drives every frozen rule: one ledger lease opened and settled per item on a temporary ledger; every outcome path in section 10, including allowance exhaustion through the real pinned litellm and provider clients against a stub proxy (allowance_stop, no rerun, spend counted, and the same for a decider call mid-fall-through); the step count with decider actions; the defer rule in every cell; a 500-hit grep (at most 100 hits asked, one generative request, no frontier call); the test-pass parser and the next-step mapping as table tests; the leak scan with planted canaries (a canary stops the run, an agent diff equal to the real-fix hunk does not); shadow answers made after the session, with N's session time unchanged with shadow on and off; the tuner and ECE gate on synthetic shadow data; both verdict printers on a full grid with exactly one verdict per point; draw.py's counts; the drop order; the max_tokens fallback; and every stop printing its code first on stderr.
- B9 tests against the real pinned SDKs (mini-swe-agent, typesafe-sdk, litellm, the Anthropic and OpenAI clients) with stub servers, before /ship: a decider action followed by an Anthropic call succeeds, with cache_read tokens above 0 on the next turn; mini's step limit counts one action per call and its cost_limit of 0 is off on the pinned version; and on one litellm-repo task and one pydantic-repo task, the agent's own python resolves those packages to the repository, not the runtime venv, and the oracle patch run through N's runtime layer still passes the verifier.
- B10 the stop and outcome codes in src/errors/codes.ts (below).

**Review before spending.** B1 to B4 and the proxy changes run live during paid sessions, and a finding in them after the run can't be fixed without rerunning. So they get a gate-class review at the build pin, before calibration. Its receipt goes in the run record and carries into the results PR, and any finding is fixed and re-reviewed before a paid session. B5 and B6 run offline on logs and are reviewed with the results. Code that touches the proxy, prices, ledger or scorer is gate class at /ship.

**Start rules.** The preregistration merged, the build pinned and reviewed as above, the dry run green, TYPESAFE_API_KEY on the runner's proxy only (never in a task container), and the Captain's caps recorded.

**Stops.** A cap stop ends the item incomplete. Section 7's admission rules stop for the Captain. A custody hit (runner provenance, section 2) stops the run and is logged. A pilot session over $2.50 stops for the Captain. Every stop and outcome code (allowance_stop, step_stop, wall_stop, decider_failed, state_over_limit, label_missing, cell_degraded, custody_hit, admission_stop, pilot_session_stop, cap_stop) is registered in src/errors/codes.ts and prints what happened, the fix, the recovery and its side effects, code first. A batch stop leaves partial side effects: running sessions end and are graded or marked missing by section 10's rules, their spend counts, and the controller reconciles every open ledger lease before any relaunch. Nothing retries automatically.

### 16. R48, R61, R78, R51, R55 and R56

- **R48 Why null.** A NO SAVING, INCONCLUSIVE, TRADES, SUCCESS MEASURABLY LOWER or SUCCESS UNTESTED verdict, and a PARTICLE-1 ALONE verdict on the router, each get one Why-null cycle: exposure (S10: did the decision layer act, did Jev get an acting band, or did everything exit), task fit (next step and done must occur in at least 80% of routed sessions), power (the MDD and the realised discordance), and the frontier without routing (N itself). Each ends in KEEP (route the decision types that held, with their numbers), FIX-METHOD (exposure, task fit, transfer or infrastructure failed) or CUT-CANDIDATE (don't adopt the router into gstack: on frontier coding agents it doesn't pay, or particle-1 alone does the job), reported plainly.
- **R61.** A null resting on saturation gets FIX-METHOD once with one ceiling-raise attempt. Saturation would be N near 100% or 0% on calibration, which admission screens.
- **R78.** No model judge scores anything, so R78's judge check does not apply. Any judge a later amendment adds is cross-family (GPT-6 Astra on Claude runs, Opus on GPT runs), checked on at least 40 labelled outputs with kappa at least 0.6, and the line becomes $4,000.
- **R51.** This preregistration is an eval write-up with frozen price and power scripts; /ship runs the depth gstack's review planner prints for it. The build is gate class and ships with the results.
- **R55.** The results post carries the Particle line and, because it reports GPT-6.1 Sol results, the OpenAI line, both at the end. An X post featuring particle-1 carries the short Particle tie line. At gate 1 the project owner confirmed that neither he nor Y Combinator has a tie to TypeSafe AI, so no TypeSafe line is needed.
- **R56.** gstack adopts routing only on this eval's frontier-model evidence, and only by GStack Minder's call after the results. The workflow Captain gets the merged finding file for the post.

### 17. Outside terms and rights

- SWE-rebench is CC-BY-4.0: the results post credits it. mini-swe-agent is MIT, used as a pinned dependency, not vendored; Harbor as the pool pins it.
- TypeSafe's Master Customer Agreement (read 2026-11-08) bars using outputs to train or distil a model or to build a competing product; this eval does neither, and decision logs are kept for analysis only. No clause was found against publishing evaluation results. It lets TypeSafe name the account holder as a customer on its site; gate 1 raised that with the project owner, who approved the plan as recommended. Standard accounts get no zero data retention, and every input sent is public-safe.
- particle-1 through OpenRouter under OpenRouter's and Particle's terms; Anthropic and OpenAI under their API terms.
- The task repositories keep their own licences, and decision logs hold their code, issue text and the agent's diffs. The replication record publishes digests, counts and the phase scripts' printed lines, never raw decision states.

### 18. What the results post reports

It opens with two or three takeaways in the form "We learned X. You should do X." (R79): what works first (which decisions move off the frontier safely, how much they save, and whether a router or plain particle-1 is the way to do it), then what doesn't, stated plainly, then both primary verdicts per model with their intervals, Primary B's cheaper and faster legs stated separately. Then S3 (the room routing has), S8 (switching against routing), S4 (where Jev is calibrated), S5 latency, S9 (where it breaks), S1 and S2 (which part does the work) and S6 (what a 90% assumes). Cost appears only as the lesson's own ratios; spend, caps and ledger figures go in the Agent notes section. Replication: the phase scripts that ran and their printed lines, with decision logs as digests and counts (section 17). Disclosures close the post.

### 19. Risks, limits and not in scope

- One agent loop and one task family (Python-heavy GitHub issues). Results speak to agents that look like it; the transfer check bounds how far.
- Calibration comes from 17 repositories and the pilot from 8, mostly sqlglot and litellm, because filling the scored split first leaves calibration to the repositories with more than 4 tasks. Thresholds tuned there may not transfer. S4 measures each type's calibration on the scored tasks' grounded labels across 185 repositories, which is the transfer check, and the pilot's discordance is read at its upper bound for the same reason.
- Opus and Sol may have seen SWE-rebench repositories in training; that applies to every cell alike.
- The post's Kimi K3 is not tested, by the owner's choice; particle-1 is a different and much cheaper escalation model.
- Jev 1.14.0 is newer than the pinned 1.13.0 and gets a decision-level replay only.
- Not in scope: the repos the exploration patched (never scored), multi-agent swarms, image inputs, and the post's human review layer (an unattended agent hands that step to the main model).

### 20. Changes at gate 1

Gate 1 took every recommended fix (A to H) and folded in the review's other notes (F8 to F27) before freeze. Where each landed:

| Item | Change | Section |
|---|---|---|
| A (F1) | particle-1's defer rule: it acts unless it picks the exit or falls below its tuned threshold; Noul types fall to M only on failure | 4, 5, 6 |
| B (F2) | relevance asks about at most 100 hits a command, in one array request per generative layer, and keeps a hit when unsure | 4, 8 |
| C (F3) | the relevance label is "edited by the real fix: must keep"; drops only, in bands with no fix-file drop over 40 decisions | 6, 11 |
| D (F4) | verdicts are ordered first-match lists with rows for d above 0.20; B8 tests a full grid | 11, 15 |
| E (F5) | the step limit counts every executed action; the proxy allowance is the only dollar stop | 4 |
| F (F6) | the allowance has its own proxy code, maps to allowance_stop and is never rerun; stops verify the partial patch | 10 |
| G (F7) | one execution model, in an isolated arm-neutral runtime venv; only per-session proxy tokens in the container | 2, 4, 15 |
| H (F28) | every stop and outcome code registered, with recovery, lease reconcile and no automatic retry | 15 |
| F8 | a synthetic assistant message precedes each decider-run action | 4 |
| F9 | F joins the pilot on Opus and is priced at 2 times N | 8, 14 |
| F10 | safety bands gate on false blocks on N's real commands | 6, 11 |
| F11 | Wilson lower bound 0.90 over at least 40 decisions; empty bands skipped; ECE needs 100 decisions; both models pooled | 6 |
| F12 | a frozen mapping from N's next action to a next-step option | 6 |
| F13 | a frozen test-runner parser with table tests | 4, 15 |
| F14 | shadow answers and label runs happen after the session, off the clock and outside the task container | 6, 10 |
| F15 | the leak scan counts only content the runner alone holds | 2, 12 |
| F16 | admission reads the upper end of d's 80% interval; power at true losses printed | 7, 13 |
| F17 | Primary B states cheaper and faster separately; deciders' share of time printed | 11, 12 |
| F18 | VM hours include label runs and image pulls | 14 |
| F19 | the crew line comes from comparable threads' counters, with headroom | 14 |
| F20 | the online units get a gate-class review before calibration | 15 |
| F21 | the draw is frozen now: 280, 40 and 16 spares, 9 stranded | 2 |
| F22 | particle-1 re-answers rewritten questions too | 6 |
| F23 | the cut's ceiling prints from calibration before the pilot | 7 |
| F24 | the room check covers Sol | 7 |
| F25 | step summaries are written by code; decider submits count toward three | 4 |
| F26 | R against P reads as the router as posted; S11 separates the guess | 11 |
| F27 | decision logs publish as digests and counts | 17, 18 |

## Review record

The /autoplan run (autoplan-20261109025207) ran a lean engineering review with one native reviewer, as gstack does for a feature-kind plan. It found 28 items: 8 High, 15 Medium, 4 Low and 1 Informational. Gate 1 took every recommendation, and section 20 says where each landed.

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
