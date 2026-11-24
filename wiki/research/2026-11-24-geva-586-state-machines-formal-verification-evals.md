---
id: 2026-11-24-geva-586-state-machines-formal-verification-evals
kind: research
title: "State machines and formal verification: what pstack's skills promise, what its own tests check, four evals to build next and what gstack should take"
summary: "pstack's tests check its TLC tool, not whether modeling helps. Ranked evals: design-time modeling first. gstack takes one rule now: a counterexample becomes a code test."
author: GEVA-586
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-24
status: done
links:
  - https://github.com/cursor/plugins/tree/ca782ed8b3c2c521cead8e1720d55c3a5dbf2347/pstack
  - https://github.com/garrytan/gstack/tree/f7402213a04d720eed5c50557c0ba528a69af4bd
  - 2026-11-17-geva-521-pstack-checks-results
  - 2026-11-17-geva-520-state-machines-prompt-results
  - 2026-11-17-geva-551-state-machines-break-rates-correction
  - 2026-11-23-geva-543-eng-review-planted-results
  - 2026-11-15-geva-537-eng-review-planted-units-prereg
  - 2026-10-30-geva-59-pstack-tstack-idea-inventory
  - 2026-11-20-geva-565-skill-pack-h2h-correction
---

# State machines and formal verification: what pstack's skills promise, what its own tests check, four evals to build next and what gstack should take

## Takeaways

- **We learned that a plain code test is what works for state bugs today, and pstack's own tests never check whether modeling helps.** pstack (Lauren Tan's skill pack) ships about 140 tests for its /statechart tool, and they check that the tool reports exactly what the TLC model checker reports and draws it safely. Its two formal verification skills ship no test, eval or example at all. Our one measured use, leaving a check for a known real state bug, lost to a one-line test request by 37.9 points (95% CI -50.0 to -26.1), because a hand-written model is not tied to the code. You should fold one rule into gstack now: turn a model checker's counterexample into a code test before you keep it as a check.
- **We learned that the design-time use Garry asked about is not what pstack claims at its head, but gstack already asks for it without evidence.** pstack's guide files /statechart and formal verification under "Verify and ship", after the code exists; the design-first direction it shipped on 2026-10-21 (cursor/plugins#741) was removed five days later (cursor/plugins#977). gstack's plan-ceo-review and plan-eng-review already require state diagrams in every plan, and no eval has tested those lines. You should run the design-time eval first: it reuses the planted-unit harness from plan-eng-review attempt 3 (#446), which ran 704 builds with no gaps, and its result decides both whether to add a model-check step to gstack's plan review and whether the existing diagram lines earn their place.
- **What we can't claim yet.** The other three evals below (review-time, a person reading the chart, and a blind bug hunt) carry real decisions but each has a likely failure: supply, a ceiling, or a floor. Each has a pilot that must pass before money goes in. Two candidate evals are dropped because no gstack decision rides on them.

## What gstack should take, in one table

| Group | Change | gstack file at main f7402213 | Evidence |
|---|---|---|---|
| a, add now | A check that runs a model, not the product code, is not a regression test: replay the counterexample as a code test that fails before the fix and passes after | review/specialists/testing.md, beside "Regression test without red proof" (lines 156 to 159) | #358: code tests did 25 of 28 of the chain's catches, and 35 of 90 model checks stayed red after the real fix |
| a, already there | Ask for a code test that fails before the fix and passes after, when the job is to leave a check | qa/SKILL.md.tmpl 181 to 204 and 212 to 214; ship/sections/pr-body.md.tmpl 105 to 106; captain/SKILL.md.tmpl 335 to 338; review/specialists/testing.md 156 to 159 | #358: the plain request caught 69% to 72%. Nothing to add |
| b, after eval 1 | Model the plan's state machine, check it, and write a test per counterexample into the plan | plan-eng-review/sections/review-sections.md.tmpl 553 to 561 (Diagrams, Failure modes), reached by autoplan Phase 3 | Untested |
| b, after eval 1 | Keep or cut "ASCII diagram for every new stateful object" | plan-ceo-review/sections/review-sections.md.tmpl 124 and 451; plan-eng-review/SKILL.md.tmpl 110 to 112 | Untested; these lines have no eval behind them |
| b, after eval 2 | Add a model check to, or narrow, the always-on State Machines review specialist | review/specialists/state-machines.md; review/sections/review-army.md 47 and 56; ship/sections/review-army.md 346 and 355 | Untested |
| b, after eval 3 | Show the owner a checked statechart beside a plan | plan-ceo-review/sections/review-sections.md.tmpl 448 to 454 (Diagrams list), rendered through diagram/SKILL.md.tmpl | Untested |
| b, after eval 4 | A blind state-bug hunt step | none yet; would need its own plan | Untested; prior readings floor |
| c, don't add | pstack's model-first chain (/create-formal-verification-skill, then /statechart) as the way to leave a regression check | none | #358: CUT-CANDIDATE, -37.9 [-50.0, -26.1] against a plain request, -17.2 [-28.7, -4.9] against the same steps in plain words |
| c, don't add | The "find all the implicit state machines" restructuring prompt | none | #360 and its correction post: no gain on the next real fix on any model, and it broke tests; CUT-CANDIDATE |
| c, don't add | A setup-time offer to generate a formal verification skill, or routing bug reports to one | none; and CLAUDE.md's bug line (552) should stay as gstack#4707 left it | #358's generated verify skills (left in 89 of 90 sessions) didn't track the fix; #426, cited by gstack#4707, showed that naming a bug-fix skill raised its use (80% against 3%) but fixed no more bugs |

Since 2026-11-17, gstack main has taken no pstack idea about state machines or formal verification. The two related commits are gstack#4707 (2026-11-22), which removed "a focused failing test first" from CLAUDE.md's bug route on #426's evidence, and gstack#4504 (2026-11-18), a fix to how /ship reads the State Machines specialist's reply. gstack's earlier pstack fold-ins are ideas from interrogate, blast-radius, recall, benchmark-checklist, architect, the principle skills, poteto-mode and its eval playbook, and unslop, plus two ported scripts (NOTICE.md lines 130 to 175). None is about modeling or formal verification.

## 1. What was read

**pstack pin.** cursor/plugins ca782ed8b3c2c521cead8e1720d55c3a5dbf2347 (2026-11-24). The last commit to touch pstack/ is 9e278fe4d4ecd8bfe98b1b79bf4be662efb338cc (2026-11-23), plugin.json 0.15.48. pstack publishes a Claude Code harness tree (harness/pstack/claude-code) and no Codex harness.

**What changed since our results.** The pstack checks result (#358) ran on c742dd61706f (2026-10-27, plugin 0.15.36), not 3dbd22ff; 3dbd22ff is the skill-pack head-to-head's pin (#352). Between c742dd61 and today:

- create-formal-verification-skill and maintain-formal-verification-skill are byte-identical.
- statechart/SKILL.md gained one sentence on how to run it on native Windows (line 19).
- statechart's scripts changed in 14 files (385 lines added, 71 removed): native Windows runs, TLC's CRLF line ends, SANY's line and column on a parse error, arrows that enter a parent state through its border, and process clean-up. None changes what the skill asks the agent to do.

So #358's reading applies to pstack's current text.

**Files read in full** (paths under pstack/; the key letters are used in citations below):

| Key | File | Bytes | sha256 (first 16) |
|---|---|---|---|
| CF | skills/create-formal-verification-skill/SKILL.md | 5,626 | 30ef0ac27612ecd1 |
| MF | skills/maintain-formal-verification-skill/SKILL.md | 7,012 | 0c96f54293542d38 |
| SC | skills/statechart/SKILL.md | 9,311 | ca7b3e43b1ddc4fb |
| RN | skills/statechart/references/render.md (the one reference SC loads) | 3,716 | 8cca446eb0c8f87f |
| MD | skills/principle-model-the-domain/SKILL.md | 1,035 | 97c6214dc6a18b93 |
| FP | skills/poteto-mode/playbooks/feature.md | 2,800 | beb7b527049eab12 |
| SP | skills/setup-pstack/SKILL.md (steps 7 and 8) | 8,751 | 9347e6a17d41c92f |
| PH | skills/poteto-help/SKILL.md (lines 29, 91 to 93) | 15,648 | ea4b36ba83fa7027 |
| G6 | docs/guide/06-verify-and-ship.md | 13,331 | 31ab46936950c789 |
| G1 | docs/guide/01-setup.md | 5,601 | 86f1343beb84df87 |
| RM | README.md (skill table, lines 153 to 157) | 28,650 | 3b21e8b4c6f894b4 |
| EV | skills/poteto-mode/playbooks/eval.md | 2,695 | 369bfda8bf305fb5 |

Also read: every test file under skills/statechart/scripts/test/ (10 test files, 33 corpus specs, about 140 tests), the CI workflow .github/workflows/validate-plugins.yml, the messages of the cursor/plugins pull requests that added and changed these skills (#709, #716, #721, #741, #776, #791, #794, #977, #1236 and #1292), and SC as first shipped in #741. In this post, a pull request number on a pstack skill is a cursor/plugins number; a bare number elsewhere is a gstack-evals pull request, and gstack's carry a gstack# prefix. create-verification-skill and maintain-verification-skill were read too: they drive the app the way a user does and make no state machine or formal claim, so they are out of scope here.

All three skills set disable-model-invocation: true (CF line 4, MF line 4, SC line 4). They run only when a person types them. That is why pstack made no skill calls in 160 generic coding sessions in the skill-pack head-to-head (#387): nothing in those tasks typed them.

## 2. Intentions inventory

Status words: **tested** means #358 or #360 measured whether it was met; **tested, misfit** means one of them measured a nearby use that doesn't answer it; **tool-tested** means only pstack's own tests check it, and they check the tool, not the outcome; **untested** means nothing has. Where it shows: in the plan (before code), in what ships, after launch (later changes), or with a person reading.

### create-formal-verification-skill (CF)

| # | Intention | Main or secondary | Cite | Met looks like | Where it shows | Status |
|---|---|---|---|---|---|---|
| CF1 | Check every case in a stated scope, so it catches what tests miss | main | CF 9; G6 98; RM 155 | On real stateful code, it finds real bugs that a plain test or bug hunt misses | In what ships | tested, misfit: #358 handed every session the bug report. Its blind probe (0 of 8, Opus) and our exploration (5 bugs against 3, one run per arm) are descriptive |
| CF2 | Pick the strongest target: a promise where a break harms users and tests rarely reach | main | CF 13 to 15 | The chosen target is where real bugs later land | After launch | untested |
| CF3 | Leave a project-local skill so the next agent can check a change against the property | main | CF 9, 31 to 33 | On a later change that breaks the property, the check fails; on a correct change, it passes | After launch | tested (#358): the checks it left caught the real bug in 28 of 90 sessions, against 61 of 87 for a plain test request |
| CF4 | True to the code: every part points to code, and one indivisible step in the code is one step in the model | main | CF 23 | The check's verdict moves with the code: fails before the fix, passes after | In what ships | tested (#358): a model check that failed before the fix stayed red after it in 35 of 90 sessions |
| CF5 | Able to fail: show each property failing on a broken variant of the code | main | CF 24, 39 | The check fails when the guarded code is broken | In what ships | tested (#358, through its fail-before and harmless-edit rules). Our exploration also found the skill's own proof passing with the model edited by hand beside the code |
| CF6 | Findings stay findings: no weakening the property, no product edits unless asked | secondary | CF 25 | Property text unchanged; product code untouched | In what ships | untested as a count; our exploration saw no product edits in 3 of 3 runs |
| CF7 | Honest about scope: bounds and assumptions stated | secondary | CF 26, 43 | The hand-off names bounds and what is left out | With a person reading | untested |
| CF8 | Readable without the tool: one plain sentence for the property and the harm; counterexample as steps in the code's words | secondary | CF 9, 27 | A developer who doesn't know TLA+ acts correctly on the hand-off | With a person reading | untested |
| CF9 | Let the question choose the tool: TLA+ for orderings, a code-level verifier per input, generated inputs when no verifier runs | secondary | CF 19 | The tool fits the property; the fallback tests the real code | In what ships | untested |
| CF10 | Cheap to rerun on every relevant change | secondary | CF 28 | One command, short run, a pinned tool version | After launch | tested, misfit (#358 reran each check 9 times but not on later changes) |
| CF11 | Record coverage and a sync commit so drift shows | secondary | CF 29, 33 | The skill names files, functions and a commit | After launch | untested; present in 3 of 3 exploration runs |
| CF12 | Read every TLA+ result through /statechart | secondary | CF 35 | Each violation reaches the reader as a shortest path | With a person reading | tool-tested |

### maintain-formal-verification-skill (MF)

| # | Intention | Main or secondary | Cite | Met looks like | Where it shows | Status |
|---|---|---|---|---|---|---|
| MF1 | Catch a stale pass: a check that passes on a description of code that no longer exists | main | MF 9, 30, 56 | After real commits change covered code, it names each check's outcome correctly | After launch | untested |
| MF2 | Tell drift in the model from a bug in the code | main | MF 15 to 20, 40 to 42, 56 | Its bug and drift labels match what the project's later history shows | After launch | untested |
| MF3 | Update from the code, not from the result; keep bounds; change a property only with cited evidence | secondary | MF 38 | Model edits trace to code edits | In what ships | untested |
| MF4 | Edit only the verification, in a change of its own | secondary | MF 22 to 24, 58 | No product edits | In what ships | untested |

### statechart (SC)

| # | Intention | Main or secondary | Cite | Met looks like | Where it shows | Status |
|---|---|---|---|---|---|---|
| SC1 | Show behavior to the person who decides, in their words, so they can judge it | main | SC 9; RM 157; G6 120 to 126; PH 93 | A product owner shown the chart spots wrong behavior more often than from prose | With a person reading | untested |
| SC2 | Give the shortest path to each state that breaks a rule | main | SC 3, 62 to 70 | Each reported path is TLC's shortest | In the report | tool-tested (chart.test.ts 251; corpus and differential tests) |
| SC3 | The picture and the checked model can't drift apart | main | G6 126 | The chart is generated from the model | In the report | tool-tested, true by construction |
| SC4 | Replay each bug path against the real code, as a test or a live repro, and assume the model is wrong until shown otherwise | main | SC 82; G6 126 | Every reported bug comes with a code test that fails on the code | In what ships | tested (#358): pstack's sessions left a code test in 36 of 90, against 84 of 90 for the plain request |
| SC5 | Write each rule the reader agrees to as an invariant; never weaken one | secondary | SC 25 | Rules match the reader's sentences | In the plan | untested |
| SC6 | Keep the chart readable: about 20 arrows, reader's labels, no variable names | secondary | SC 39 to 43, 55 | Charts stay small and in the reader's words | With a person reading | tool-tested for the mechanics (labels.ts, render.test.ts) |
| SC7 | Model a product flow or protocol, not only code (implied: before code) | secondary at this pin | SC 3, 13 | A model of a planned flow finds a design flaw before code | In the plan | untested. cursor/plugins#741 stated it as a main direction ("Use from-chart when there is no model and the PM should agree on the behavior before anyone writes or changes the code"; "If a rule breaks, the agreed chart has a design bug"); cursor/plugins#977 removed that direction |

### The design-time principle (MD, FP)

| # | Intention | Main or secondary | Cite | Met looks like | Where it shows | Status |
|---|---|---|---|---|---|---|
| MD1 | Choose a state machine over scattered booleans before the code is written | main | MD 9 to 11, 15; FP 12; poteto-mode SKILL.md 50 | New stateful code built this way ships fewer state bugs | In what ships | tested, misfit: #360 applied the idea to existing code as a restructuring pass, which is not new code |
| MD2 | Don't force it: keep boring code when the shape is local | secondary | MD 13 | No new machinery where it removes no branch | In what ships | untested |

### Setup and routing (SP, G1, PH)

| # | Intention | Main or secondary | Cite | Met looks like | Where it shows | Status |
|---|---|---|---|---|---|---|
| R1 | Offer a formal verification skill once at setup; say yes for concurrency, retries, state machines and parsers | secondary | SP 78 to 80; G1 41 | Projects that took it ship fewer such bugs later | After launch | untested |
| R2 | Point at the skill when a question is about a race or invariant | secondary | PH 29, 91 to 93 | Routing happens on the right questions | In the session | untested |

**Lifecycle, as pstack places it today.** Formal verification and /statechart sit in "Verify and ship" (G6 lines 96 to 126), after a feature is built, and the setup offer happens once per project (G1 41). The only design-time intention left at this pin is MD1, which asks for a state machine in the code's structure, not a checked model.

## 3. pstack's own tests and evals, and what they assume

| Test or eval | What it checks | When in the lifecycle it assumes the skill runs | Task, model and reader it assumes | Could it fail? |
|---|---|---|---|---|
| statechart cli.test.ts and chart.test.ts (95 tests) | The command turns TLC's output into the committed chart and report; labels can't break Mermaid; marks land on the right states; bad views and configs exit 2 | Any: the spec is given | A TLA+ spec already written; no model in the loop; a person reading Mermaid | Yes. CI runs them on every pull request (validate-plugins.yml line 35) |
| statechart corpus, differential, plain-tlc, tlc-out and config-fuzz tests | Each corpus spec gives plain TLC's verdict, exit and shortest path; a fuzzed config parser agrees with a Java oracle | Any | 33 hand-written specs (Counter variants, DieHard, Login, MediaPlayer, TwoPhase and others) | Yes, but only where TLA2TOOLS is set. CI sets none, so these TLC-backed tests skip there |
| statechart render.test.ts | Every corpus chart renders in Pele 1.9.0 and parses in mermaid.js; the theme colors every class | Any | A person viewing an SVG | Yes, in CI |
| Seeded-bug corpus specs (TwoPhase "with one seeded bug" and TwoPhaseFixed, MediaPlayer's LoudWhenStopped, CounterDeadlock) | The report finds and words the bug that the spec holds by construction | Any | The model is the ground truth | Yes, but the bug is in the model by construction, so nothing tests whether a model written from code or a plan would hold it |
| create-formal-verification-skill's own hand-off proof (CF 37 to 39) | Within one run: the generated check catches a scratch break of the real code, then returns to its start | After code exists | The agent that wrote the model runs it once | Yes, but our exploration saw it pass with the model edited by hand alongside the code |
| create- and maintain-formal-verification-skill | No test, eval or example ships. cursor/plugins#721's message says its new paragraph "is the exact text that a preregistered eval tested"; that eval is not in the repo, so we couldn't read it | n/a | n/a | n/a |
| poteto-mode's eval playbook (EV) | A general method: an organic blinded prompt, N candidates on different models, a 3 to 6 point rubric for one cross-family judge, chain-following graded from transcripts | Any | A judge decides | Yes. It has not been applied to these skills in anything pstack ships |

**Where pstack's tests check something other than what its skills claim.**

1. The skills claim outcomes in code (CF1, CF3, CF4, SC4); the tests check a tool's fidelity to TLC on specs a person wrote. Nothing tests the step where an agent turns code or a plan into a model, which is where #358's sessions lost.
2. The seeded-bug specs put the bug in the model by construction. That assumes the hard part, a model that holds the real bug, is already done.
3. SC1 names a reader who decides (a PM or designer). No test has a reader.
4. The TLC-backed tests skip in pstack's CI, so the parts that compare against the real checker run only on a maintainer's machine.

**Where pstack's text and our results disagree.**

- CF 23 to 24 and CF 28 promise a check that is true to the code, able to fail, and cheap to rerun on every change. On #358's 90 sessions, 35 model checks that failed before the real fix stayed red after it, so a rerun told the next agent nothing about the code.
- SC 82 asks the agent to replay every bug path on the real code. pstack's sessions left a code test in 36 of 90, against 84 of 90 for a one-line test request; the plain-words version of the same steps left one in 83 of 90. pstack's text lowers the chance of the step it asks for.
- MF 9 warns that a stale pass looks like a proof, and leaves the fix to an agent who reruns /maintain-formal-verification-skill. That agrees with our reading of #358: a mechanical rerun can't keep a hand model in step with code. It is also why MF stays untested by us: it is the hand loop.
- Where our results agree with pstack: findings stayed findings (no product edits in our exploration's pstack runs), and CF 19's fallback for languages with no verifier, testing the real code with generated inputs, is a code-tied check, which is the kind that worked.

## 4. Proposed evals, ranked by the decision each changes

Each eval below carries items 1, 3, 5 and 6 of the team's eval-loop checklist: the decision for each outcome, a pilot of every arm at most a tenth of its budget, the judge check, and one planned look. Every one scores from code, with no judge in its primary. Models are Claude Opus 5.5 in Claude Code, GPT-6.2 Sol in Codex CLI (gstack installed with ./setup --host codex in gstack arms) and particle-1. Costs are rough, from the per-session spend of #358 and of plan-eng-review attempt 3 (#446) at list price, and assume the harness exists.

**A cross-cutting problem for the pstack arm on Sol.** pstack publishes no Codex harness at this pin. Running its files as Codex skills is not "as published", and running Sol in Claude Code breaks the rule that Sol runs in Codex CLI. Recommendation: leave the pstack arm out on Sol, run Sol's other arms in Codex CLI, and say why in each prereg. The plain-words arm carries pstack's steps on Sol.

### Eval 1 (rank 1): does checking a plan's states before the build lead to code with fewer state bugs?

**Question.** Given a plan for stateful code before the code exists, does a reviewer that models the plan's states and checks them lead a fixed builder to code that passes more of a real fix's hidden tests, and to tests that catch the real bug?

**Decision it changes (item 1).**

- If the plain-words model check (C) beats the plain review (N) by 10 composite points or more, pooled over models, with its interval above 0, and beats gstack's current review (G): add C's step to plan-eng-review's Diagrams and Failure modes (review-sections.md.tmpl 553 to 561), so autoplan's eng phase carries it too.
- If pstack (P) beats N by 10 or more and C doesn't: pstack's text does something plain words don't. Port the idea with credit, the way gstack's NOTICE.md records other pstack ideas.
- If the plain-words diagram arm (D, gstack's current "ASCII diagram for every new stateful object") reads no gain over N, with its interval below +10: those lines in plan-ceo-review (124, 451) and plan-eng-review (SKILL.md.tmpl 110 to 112, review-sections 553) become cut candidates for the before/after skill eval.
- If everything reads within 10 of N: no modeling step goes into gstack's plan skills, and the design-time question closes with a registry row.

**Attacking the idea before building it.**

1. pstack no longer claims it. A null here doesn't cut a pstack claim (section 2, SC7). It answers gstack's own untested lines and Garry's question, which is enough to run it.
2. Real bugs don't come with real designs. The planted recipe from plan-eng-review attempt 3 (the code just before a real fix, the touched function bodies removed, and a plan that is silent about the bug) is a proxy: the design is local to a few functions and the rest of the repo exists. Greenfield design stays untested, and the post must say so.
3. Many state bugs are implementation slips (a reset missed in one branch) that no model of the plan can see. So the units need a foreseeability filter: two raters from different model families agree that the bad state is reachable from the transitions the plan describes. That filter may cut supply below the floor.
4. Plans already get state diagrams. In attempt 3, autoplan's eng phase (which asks for them) moved avoid by +8.8 and catch by -2.6 over a plain review, and the standalone review moved avoid by +4.0, from a plain composite of 39.5. The checker has to beat a review that already draws diagrams.
5. The model-to-code gap that sank #358 shrinks here, because there is no code yet to drift from. This is the strongest case for modeling. The gap moves to the builder, which must turn a counterexample in the plan into code; the fixed builder isolates that.
6. Cost: pstack's chain cost 2.4 to 8 times a plain session in #358. The 10-point bar reflects that.
7. Reader: /statechart is written for a person; here an agent builder reads it. Eval 3 covers the person.

It still changes gstack text that runs on every feature plan, so it stays.

**Units (R36).** State-shaped planted units built with attempt 3's recipe and harness (lanes/eng-planted/), from real fixes made public after 2026-07-01. Screen attempt 3's 131 usable units with two cross-family state-shape labels, as #358 did, and the foreseeability filter above; add a mining wave inside the frozen sandbox if fewer than 64 pass. Target 64, floor 48, at most 3 a repository.

**Arms** (the reviewer step; the builder is a fixed Opus 5.5 with no gstack, as in attempt 3):

- N, no gstack, plain prompt: "Review this plan and improve it before it is built."
- D, gstack's current line in plain words, no skills: N's text plus "For every new stateful object, add an ASCII state diagram with its impossible transitions and what prevents them."
- C, pstack's steps in plain words, no skills: N's text plus "Write a small TLA+ model of the states this plan adds, write each rule as an invariant, check it with TLC, change the plan to fix each counterexample, and add to the plan a code test that replays each counterexample."
- P, pstack loaded as published: "/statechart model the states this plan adds and the rules they must keep, then improve the plan." Opus and particle-1 only (see above).
- G, gstack at main: /plan-eng-review on the plan. Opus and Sol.

Every arm gets TLC and Java from a read-only tools volume, as #358 did, so the checker can run with no network.

**Score.** Attempt 3's composite, with no judge: half for the built code passing the real fix's failing cases (avoid), half for the builder's own test failing on the real buggy code and passing on the fixed code (catch). Exposure, printed beside it: TLC ran in the session (P, C), a diagram exists (D), attempt 3's procedure detector (G), P read statechart/SKILL.md by any tool, the builder opened the review files.

**Size, MDD and cost.** 64 units, 2 review and build cells per arm and model. Attempt 3's power simulation puts the per-model composite MDD at 12 to 14 points at 64 x 2; the pooled contrast over three models should come in near 8 to 10, to be simulated in the prereg before freezing. The smallest effect worth acting on is 10 points. Rough paid cost: Opus about $1,200 (cells from $0.97 for N to $2.75 for G), Sol about $750 without P, particle-1 about $330 (the Opus build dominates), plus about $100 of supply screening and labels: about $2,400 paid, about $3,300 all-in with agent use and machines. Opus alone, all five arms, is about $1,900 all-in.

**Pilot (item 3, R111), at most $240.** On 6 calibration units, one cell per arm and model. It must show: TLC ran in at least 5 of 6 P and C sessions, D wrote a diagram in 5 of 6, G's procedure detector fired in 5 of 6, and P read the skill file; the builder opened the review files; plain N's composite on the calibration units sits between 0.15 and 0.75; and at least 48 state-shaped units pass the screen inside the frozen sandbox, because a screen outside it overcounted by ten times last time (the plan-eng-review build read counted 21 outside and 2 inside).

**Judge (item 5).** None in the primary. A judged "the plan named the planted condition" secondary is left out: attempt 3's version failed its label check (kappa 0.373 under the one allowed revision).

**One look (item 6).** At 32 of 64 units in seeded order: stop C's and P's remaining cells if both their pooled minus-N upper bounds sit below +5. No early stop for a gain.

### Eval 2 (rank 2): which state check in review catches a state bug in a diff?

**Question.** Shown the real diff that introduced a state bug, which review leaves a test that fails on that diff's tree and passes once the real fix lands?

**Decision it changes.** gstack's State Machines specialist runs on every /review and /ship, even when every other specialist is skipped for a small diff (review-army.md 47), whenever its detector says true or unknown. It has no eval behind it. On gstack main since 2026-10-17, 14 of 967 commits carry a review-finding trailer naming its reader, so it does produce findings; whether they are real bugs is unmeasured.

- G (gstack /review with the specialist) beats G0 (the specialist turned off) by 10 points or more: keep it, and consider widening its scope past proposals, holds and approvals.
- C beats G by 10 or more: add a model-check step to review/specialists/state-machines.md.
- G reads the same as G0: the specialist's always-on run on small diffs becomes a cut candidate.

**Attack.** Reviewers foresee little: in the plan-eng-review intentions stage 1, plain Opus's checks were credited with 2.4% of the later defects in its key. Here the bug is in the diff itself, which should be easier, but a floor is the likely failure. Supply is the other: the plan-eng-review build read got 2 of 51 aftermath units through its sandbox. Units need the bug-introducing commit (found by blame from the fixing commit) to build and test.

**Units.** Real state-bug fixes (for example #358's 30 SWE-bench-Live units and more of that kind), each paired with the commit that introduced the bug, both building in the frozen sandbox. Target 48.

**Arms.** N, no gstack: "Review this pull request." C, plain words: N plus "model the state machine this diff changes, check it with TLC, and turn each counterexample into a code test." P, pstack: "/statechart model the states this diff changes and the rules they must keep", Opus and particle-1 only. G: gstack /review at main. G0: the same with the State Machines specialist turned off. The same last turn in every arm asks for the checks to keep, as #358's did.

**Score.** #358's rule, code-decided: a kept check catches when it fails 3 of 3 times on the bug-introducing tree and passes 3 of 3 with the fix applied. False alarms (checks that fail on both) are a secondary.

**Size and cost.** 48 units, 2 sessions per cell. Per-model MDD about 18 to 20 points at a 20% base rate, pooled about 11 to 12 (rough; simulate before freezing). Paid about $1,500, about $2,300 all-in.

**Pilot.** At most $150 on 8 units: plain N catches at least 1 in 10 (else FLOOR, stop); the specialist fires in G on the units where its detector says true; at least 48 units build in the sandbox.

**Judge.** None. **One look.** At 24 of 48 units: stop C and P if their pooled minus-N upper bounds sit below +5.

### Eval 3 (rank 3): does an owner decide better with a checked statechart?

**Question.** Shown a plan that either keeps a real bug's behavior or doesn't, does an owner who sees a checked statechart beside it send back the flawed plan and approve the sound one more often than an owner who reads prose alone?

**Decision it changes.** Garry approves plain-language plans before builds. If P or C beats N by 10 points of balanced accuracy: add a checked statechart, rendered through /diagram, to plan-ceo-review's Diagrams list (review-sections.md.tmpl 448 to 454) for plans with stateful objects. If D reads no better than N: the ASCII state diagram isn't helping owners decide, which adds to eval 1's reading on those lines.

**Attack.** A flawed plan that states the buggy behavior plainly may be easy to reject from prose (a ceiling). The model that draws the chart may find the flaw itself and mark it, so the eval measures chart plus reader together, which is what pstack's SC1 claims. Readers: a fixed fresh model told "approve or send back" is cheap but isn't the person pstack writes for; human readers through RentAHuman fit better but run into its five-bounty-a-day limit. The primary uses a model reader and says so; a human stage runs only if the model reading shows a gain.

**Units.** 40 of eval 1's planted units, each written as an owner-facing plan in two versions: one that keeps what the buggy code did, keyed by the real fix's failing test, and one that keeps what the fix does. 80 plans.

**Arms** (what the owner sees beside the prose; the artifact maker is the model under test): N, prose only, no gstack; D, an ASCII state diagram; C, a plain-words model check summary; P, /statechart's chart and report (Opus and particle-1).

**Score.** Balanced accuracy from the key: flawed plans sent back and sound plans approved. Code decides.

**Size and cost.** 80 plans, paired. MDD about 12 points per model (rough). Paid about $850, about $1,500 all-in.

**Pilot.** At most $85 on 8 plans: P's charts render with marks; N's reader accuracy sits between 0.55 and 0.85; readers answer in the frozen format.

**Judge.** None in the primary. **One look.** Planned paid spend is above $500, so one look at 40 of 80 plans with a futility stop at a +5 upper bound.

### Eval 4 (rank 4, gated on eval 1): does modeling find state bugs nobody reported?

**Question.** With no bug report, pointed at the files a real state fix later touched, does pstack's formal verification skill, or the same steps in plain words, leave a check that catches the real bug more often than a plain "find and fix the bugs" request?

**Decision it changes.** gstack has no blind bug-hunting step for stateful code. If P or C beats N by 10 points or more, plan a hunt step with /autoplan; otherwise close CF1 and finish #358's cut for this chain.

**Attack.** Every reading we have floors. #360's plain bug-hunt clean-fixed 1 of 30 at folder scope and 1 of 26 at file scope, and #358's blind probe caught 0 of 8. Two exploration runs on the same three repositories found 5 verified state-shaped bugs with pstack's chain, and 5 state-shaped (15 in all) with a plain bug-hunt, one run each. A floor reading changes nothing, so this eval runs only if eval 1 shows modeling helps, and only past its pilot.

**Units.** #358's 30 state-shaped SWE-bench-Live units plus 30 more of the same kind, at file scope, no bug report.

**Arms.** N, no gstack: "Find and fix the bugs in these files. Leave a test for each." C, plain words: N plus the model-check steps. P: "/create-formal-verification-skill <files>" as published (Opus and particle-1). G: gstack installed, N's prompt.

**Score.** #358's catch rule (fails before, passes after, fails after a harmless edit, 3 runs each), with the pfchecks scorer.

**Size and cost.** 60 units, one session per cell. #358's blind probe cost $9.59 a session on Opus, so paid is about $1,500, about $2,300 all-in.

**Pilot.** At most $200 on 8 units on Opus: N clean-finds at least 2 of 8, else FLOOR and stop. **Judge.** None. **One look.** At 30 of 60 units with a +5 futility bound.

### Dropped

- **maintain-formal-verification-skill on real drift.** It changes nothing for gstack while gstack keeps no formal checks (group c), and public repos with code-tied TLA+ specs and labelled drift and bug commits are too few to supply it.
- **#358's reopening condition: the chain with a code test for every counterexample, on regression checks.** The plain request already catches 69% to 72% at a fraction of the cost. A variant that at best ties it carries no fold-in decision.

## 5. Fold-in detail

**Group a, add now.** One rule, in review/specialists/testing.md beside "Regression test without red proof" (lines 156 to 159): a check that runs a model (a TLA+ spec, a hand-written simulator, any file that stands in for the product code) is not a regression test; ask for a code test that replays the counterexample on the product code, failing before the fix and passing after. It has a consumer today: any diff that keeps a model check as its proof, whoever wrote it. It needs no new machinery, and it is the one part of pstack's chain our evidence supports.

The other candidate, "ask for a code test that fails before the fix and passes after", is already in gstack wherever the job is leaving a check: /qa's regression test before repair (qa/SKILL.md.tmpl 181 to 204) and its re-test (212 to 214), the testing specialist's red-proof rule, /ship's "Regression proof" line (ship/sections/pr-body.md.tmpl 105 to 106) and captain's fix rule (captain/SKILL.md.tmpl 335 to 338). It should not go back into CLAUDE.md's bug route: the test-first eval (#426) showed that a failing-test-first step doesn't raise the fix rate, and gstack#4707 removed it there. #358 measured a different job (leaving a check for a known bug), so the two results don't conflict.

**Group b, after a named eval.** Listed in the table at the top; each row names the eval and the file.

**Group c, don't add.** pstack's model-first chain for regression checks (#358, CUT-CANDIDATE); the implicit state machines restructuring prompt (#360 and its correction, CUT-CANDIDATE); a setup-time offer of a formal verification skill or routing bug reports to one (#358's generated skills didn't track the fix, and #426 showed that naming a bug-fix skill buys use, not fixes).

## 6. Limits

- This is a reading, with no new runs. The costs and MDDs above are rough and each prereg must recompute them.
- The inventory covers pstack at one commit. pstack moves often (seven pstack commits since 2026-11-13), so a prereg must re-pin and diff these files.
- The 14 commit trailers naming gstack's State Machines reader show it reports findings, not that the findings were real.
- The exploration readings (5 bugs against 3, and 15 for a plain hunt) are one run per repository and arm, and decide nothing.
- We couldn't read the preregistered eval that pstack's #721 cites.

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

gstack is Garry Tan's own project. pstack is Lauren Tan's work (MIT), published in cursor/plugins; we checked the public YC company directory and found no tie between Garry Tan or Y Combinator and Lauren Tan or Cursor.
