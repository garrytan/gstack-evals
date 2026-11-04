INPUT: dx 42e28cee6c4f4bd89595766e39d43fcb547548ab81f48bf191bdf1c0c7b07b0b

# DX review (native voice, attempt a3)

Reviewer: anthropic/claude-opus-5-5, one strong voice, read-only. gstack checkout 1.93.34.0 at ~/.local/share/gstack (review-voice install, behind=3). I read the whole prompt, the CEO and design consensus, gstack's plan-devex-review and devex-review SKILL.md at that checkout, the mining and browser probe results and mine.py under probes-in, and origin/main's lanes/real-outcome layout, src/cli.ts and task/SPEC.md. I don't repeat CEO or design findings except where I add an X-specific mechanism.

## Verdict

The developer-experience primary (docs-only first success) is the right kind of instrument, and the fzf probe shows the container half works for a static Go binary. But as written it can't yet tell good docs from bad ones. The one check the plan relies on for saturation, the base-tree check, tests whether the goal needs the feature, not whether the goal needs the docs, so section 14's claim that it "catches" saturation from --help or types is wrong. The goal wording names the feature, the task format (V4) already names the new surface in the statement, and --help is part of the artifact, so a fresh Opus agent can often reach first success without reading a line the arm wrote. The harness also has no rule for interactive CLIs, which can hang a no-terminal agent, and "no source tree" holds only for compiled binaries. Family X's task contract (goal, checker, build recipe, doc globs) is unnamed, so O3 will guess. Fix those before the X thin slice is authored; they cost no money now and a pilot later.

## Developer persona card

Two developers meet this plan. The primary one is a crew build thread (Opus 5.5, fresh context, a token cap, no memory of this review) that must turn sections 3 to 6 into O1 to O5 code and T-X tasks without asking anyone. The secondary one is the docs-only agent itself: a fresh Opus 5.5 developer in a read-only, no-network container with an installed artifact, a bundle of docs and one goal, which is the persona the X primary simulates.

## Empathy narrative

The T-X author picks a uv feature from the 145 DX-tagged commits. The plan tells them to write "one frozen goal" and "a checker", but not what file holds either, when the checker runs, what it may inspect, or how long a command may take. They build the artifact at gold and at the parent, as the fzf probe did, then realise the arm's tree will need the same recipe, offline, with whatever dependency the arm added. They write the goal as section 3 suggests, "use the new --foo to get X", run the docs-only agent on gold with the docs deleted, and it succeeds anyway from "uv --help". Nothing in admission would have told them.

## Competitive DX benchmark

SWE-bench style rigs grade code with hidden tests and have no docs reader. SkillsBench (CEO-10) measures paired skill lift on Harbor but on task completion, not on a second agent's use of the output. The closest public practice to docs-only first success is documentation usability testing with novice users, which always withholds the feature's name from the task card and records where the user looks. The plan's degraded-fixture check for family U is the right model; family X lacks its twin.

## Magical moment

The X instrument works when one admission table shows, per thin-slice task, gold docs to first success in most runs, gold code with base docs failing in most runs, and base failing in all runs. That three-row table is what makes "devex-review helps" mean "the docs it wrote got a developer there".

## Developer journey map (crew build thread)

1. Read the plan: clear on intent, arms and contrasts.
2. O1 arm registry: turn scripts are clear; stand-in and forced lines and detectors are clear for wave 1, except plan-devex-review's mode and autoplan's DX phase (F11, F12).
3. O3 docs-only harness: stalls. No task file contract, no doc globs, no interactive rule, no build failure rule (F3 to F6).
4. T-X authoring: stalls on what counts as a DX feature and what an artifact is for a library or a server (F4, F9).
5. O5 dry run and admission: row 4 has no unit and no per-task validity rule (F10); no docs-sensitivity row (F1).
6. P-X pilot: devex-review may stop on an X image with no browser (F7).

## First-time developer confusion report

- "README, docs/, --help, published type files" (section 3) versus "every doc file the repository ships" (section 10). Which is it, and does CHANGELOG at the repo root count?
- "no source tree", for a Python wheel or an npm package whose installed files are the source.
- "use the new <feature> to <outcome>": does the goal name the feature?
- "2 runs per tree; the tree's score is their mean": per trial or per tree, and what if one run hits an upstream error?
- "the package, binary or server": what boots a server, and what is a server's --help?
- "First success is the goal's checker passing": checked after each turn, or once at the end?

## Pass 1, getting started (TTHW for a build thread)

There is no hello world for the rig. The nearest is O5's keyless dry run, about nine steps away. The plan should name one first command per unit, for example a fake-agent docs-only run on the fzf probe bundle that prints a first-success record, so O3 has a smoke test on day one.

## Pass 2, API and CLI design of the rig

The plan names a directory (lanes/outcome-skills/) but no command row, file format or schema. The repo's own rules require a row in src/cli.ts and reason codes in src/errors/codes.ts for every new command (AGENTS.md), and the lane already has "real" as its row. The plan should say whether outcome-skills is a new row or subcommands of "real", and name the files a task adds to the lane's SPEC.md table (F5, F14).

## Pass 3, errors and debugging (agent-ready error contract)

New failure paths the plan introduces, scored per item:

| Path | what | fix | recovery | code | context | trace | redaction | channel |
|---|---|---|---|---|---|---|---|---|
| docs-only agent runs an interactive command (TUI, prompt, pager) | gap | gap | gap: no per-command timeout, no rule for a hang | gap | gap | gap | N/A | gap: hang, not a failure signal |
| arm tree fails to build or install the artifact offline | partial ("app does not start scores 0" is U only) | gap | gap: arm failure versus rig failure not separated | gap | gap | gap | N/A | gap |
| docs-only or agent-user model call fails upstream | gap: the gap rule covers trials, not measurement runs | gap | gap | gap | gap | gap | N/A | gap |
| checker crashes or times out | gap | gap | gap | gap | gap | gap | N/A | gap |
| clean-room preflight refuses | reused from panel v3 C1 | unknown | unknown | unknown | unknown | N/A | unknown | unknown |
| mutation tool error | counted and excluded (section 3) | gap | partial | gap | gap | gap | N/A | partial |

The first row is a block on a terminal, so it is a CAP4 Critical (F3) and caps Error Messages at 4. Rows 2 and 3 are CAP6 Highs (F6). The preflight row is existing behavior I did not inspect, so it reads unknown.

## Pass 4, documentation (the instrument's definition of docs)

What counts as docs is the crux of the X primary and is defined three ways in the plan. F4 asks for one frozen rule: the doc set is every file in the arm's final tree matching a per-repo glob list frozen at authoring from what the repo ships at base (README*, CHANGELOG*, docs/**, man pages, top-level *.md), plus any new file the arm adds that matches the same globs, plus --help output and published type files generated from the arm's tree. Docstrings are docs only where the language installs them without source (TS .d.ts JSDoc yes; Python docstrings only if the installed package is treated as surface, see F4).

## Pass 5, upgrade path

Not a rig concern beyond pins. One note: devex-review's exposure detector should read the gstack-review-log row the skill writes (tthw_measured, dimensions_tested, dimensions_inferred), not transcript prose, so it survives wording changes at the after pin (the design phase's point 12, applied to devex-review).

## Pass 6, environment and tooling

Family X images carry "the language's normal toolchain for every arm" and nothing else, while family U carries Playwright and Chromium for every arm. devex-review is a "Live developer experience audit" that drives Aside or gstack's own headless browser ($B), asks the user for a docs URL in Step 0 when CLAUDE.md has none, and says to stop rather than substitute curl when no browser is available (devex-review/SKILL.md lines 225, 489 to 495). On an X image the told arm may stop or degrade before Step 1 (F7).

## Pass 7, community

N/A for an internal rig, with one exception: results name public repositories, covered under R65 below.

## Pass 8, measurement of the instrument

Admission row 4 reads gold at least 70% and base at most 10%, with no unit (per task or pooled over 10 tasks x 2 runs) and no per-task drop rule. A family should not fail admission because two tasks have broken goals; those tasks should fail a task validity rule, as V10 does for follow-ups (F10). The row also lacks the docs-sensitivity check (F1).

## Family X task source and yield

mine.py tags a feature DX when it touches a README or docs/ file and a SURFACE path: cli/, commands/, cmd/, any index.ts/js, __init__.py or lib.rs, openapi, swagger or a schema file. Barrel files change in most internal refactors, and the top DX repo is usememos/memos, a web app whose "surface" is an HTTP API, so 145 overstates what the X harness (CLIs, SDKs, libraries) can grade. The plan sets a mining scope for U (at least 60 web-app repositories) but none for X, which needs about 360 valid candidates. F9 asks for a stricter tag, a stated artifact class list, and an X mining target.

## Stand-in lines for plan-devex-review and devex-review

The plan says stand-ins are written from the skill's one-line description and public practice. The descriptions at 1.93.34.0 are "Interactive developer experience plan review." and "Live developer experience audit." The drafts go further and use the instrument's own terms: plan-devex-review's stand-in asks "what do they install, read and type to get a first success", and devex-review's tells the agent to work "from the docs alone: install it, follow the docs, run the first example". The skills themselves talk about TTHW, personas, a magical moment and eight passes across upgrade path, community and measurement. A stand-in that names the measured outcome is a hint at the test, so told minus stand-in leans toward the "idea helps, procedure adds nothing" reading, which sends the procedure text to a diet. F8 asks for stand-ins written without the instrument's words, or a second, neutral stand-in in the pilot to size the wording effect.

## Clear enough to build without guessing?

Arms, turn scripts, contrasts, readings and the staged gates are clear enough to build. Not yet clear: the X task contract (F5), the doc set (F4), failure classification for builds and measurement runs (F6), plan-devex-review's mode under the simulated user (F11), autoplan's DX-phase exposure on X (F12), the hidden-test guard statistic (F13), and the command and reason-code surface (F14).

## R65: outside terms, licences and rights

Yes, outside terms are involved, and section 11 handles the main ones (permissive-only task repos with recorded SPDX, tool licences listed, the Claude Code gateway clause and comparative-publication terms flagged, OpenRouter data-collection deny). The CEO phase already raised the root-LICENSE-only check, issue and PR text under GitHub's terms, and the deferral of the gateway clause; the design phase raised UI assets. Family X adds two smaller points (F17). First, documentation can carry a licence apart from the code (CC BY docs, or docs kept in a separate website repository), and the docs bundle is the X instrument's input; nothing is published, so this only matters if a results post quotes docs, but the V8 check should record a docs licence when the repo declares one. Second, the docs-only container installs the arm's artifact with its dependency closure from an offline mirror; local evaluation is fine under permissive and copyleft licences alike, but if task images are ever pushed to a public registry, redistribution terms of every bundled dependency apply. The plan should say task images stay private.

## NOT in scope (this review)

Re-pricing, power and MDD arithmetic, the U instrument and the CEO-scope questions, all covered by earlier phases.

## What already exists

The lane's task SPEC (instruction.md, V1 to V9), its arms.json and manifests, its score/exposure.ts, the fzf docs-only probe script (partb/check.sh), the browser probe's 110-line driver, and gstack's review-log rows that record devex-review's tthw_measured and dimensions_tested.

## TODOS.md updates (proposed)

- T-X: write the X task file contract into the lane SPEC (goal.md, docs-globs, build recipe, check script) before authoring.
- O3: interactive-command rule and per-command timeout in the docs-only harness.
- P-X: docs-sensitivity fixture (gold code, base docs) per task.
- O1: devex-review detector from the review-log row; plan-devex-review mode recorded.

## DX scorecard (the plan as a buildable tool)

| Dimension | Score | Why |
|---|---|---|
| Getting started | 5 | clear intent, no first command per unit |
| API and CLI design | 5 | arms clear; commands, files and codes unnamed |
| Error messages | 4 (capped by CAP4) | interactive hang; build and measurement failures unclassified |
| Documentation (of the instrument) | 4 | three definitions of docs |
| Upgrade path | 7 | pins and after-pin rule are clear |
| Environment and tooling | 5 | X images omit the browser devex-review uses |
| Measurement | 4 | no docs-sensitivity check; admission row 4 has no unit |
| Overall | 5 | |

## DX implementation checklist

1. One frozen doc-set rule (F4). 2. Goals in user words, feature unnamed, checker verifies the new surface ran (F2). 3. Docs-sensitivity fixture and admission row (F1). 4. Non-interactive goal rule and per-command timeout (F3). 5. X task contract in the lane SPEC (F5). 6. Build and measurement failure classes (F6). 7. Browser in X images or a $0 devex-review probe (F7). 8. Neutral stand-ins (F8). 9. X tag, artifact classes and mining target (F9). 10. V11 docs-only validity (F10). 11. plan-devex-review mode (F11). 12. autoplan DX phase in X exposure (F12). 13. Guard statistic and conditional reading (F13). 14. Command rows and reason codes (F14).

## Unresolved decisions

- Whether HTTP servers (memos-style APIs) are in family X at all, or deferred.
- Whether the installed package counts as published surface for interpreted languages.
- Which plan-devex-review mode the simulated user picks.

## Review log row

{"skill":"plan-devex-review","phase":"dx","voice":"native","attempt":"autoplan-20261103023817-a3","overall_score":5,"findings":17,"critical":1,"high":7}

## Next steps

Fold F1 to F8 into the plan before gate 1, then the eng phase should attack the X task contract (F5) and failure classes (F6) as code-level designs.

```gstack-findings
{"id":"F1","severity":"High","title":"Base-tree check cannot detect docs saturation: it tests whether the goal needs the feature, not whether it needs the docs; section 14's claim is wrong","fix":"Add a per-task docs-sensitivity fixture (gold artifact and gold --help, with the base tree's doc files) and an admission row: first success on gold docs at least 30 points above gold code with base docs, mirroring U's degraded-fixture drop; correct section 14"}
{"id":"F2","severity":"High","title":"Goal 'use the new <feature> to <outcome>' names the feature that V4 already names in the statement, so the docs-only agent can find it in --help without the arm's docs","fix":"Write X goals in user words that state the outcome and withhold the feature's name; have the checker confirm the new surface ran (an exec-log shim or an outcome only that surface produces), and keep the base-tree check"}
{"id":"F3","severity":"Critical","title":"CAP4:docs-only harness:channel interactive CLIs (TUIs, prompts, pagers; the probe's fzf --bind feature is one) can hang a no-terminal agent with no non-interactive rule or per-command timeout","fix":"Admit only goals completable non-interactively (or provide a scripted pty such as tmux with a documented driver), set a per-command timeout, set PAGER=cat and CI=1, and score a timed-out command as a failed command, never a gap"}
{"id":"F4","severity":"High","title":"What counts as docs is defined three ways (section 3 list, section 10 'every doc file', arm-created files unaddressed), and 'no source tree' is unenforceable for Python and npm packages whose installed files are source","fix":"Freeze one doc-set rule per repo at authoring (globs from what the repo ships at base plus matching files the arm adds, plus --help and type files built from the arm's tree), and either declare installed package contents part of the published surface or restrict X to compiled CLIs in the pilot"}
{"id":"F5","severity":"High","title":"Family X has no task file contract: goal file, checker interface and timing (after each turn or at the end), build recipe, offline dependency install, doc globs and artifact class are unnamed, so O3 and T-X will guess","fix":"Add X rows to the lane's task SPEC table (goal.md, docs-globs, build.sh with an offline mirror, check.sh with exit-code contract, run after every turn and read-only to the agent) before thin-slice authoring"}
{"id":"F6","severity":"High","title":"CAP6:docs-only build:recovery an arm tree that fails to build or install the artifact, and a docs-only run lost to a provider error, have no rule separating arm failure (score 0) from rig gap, and no recovery","fix":"Score an arm-caused build or install failure as 0 with its cause printed; treat a measurement-agent upstream or rig failure as a gap rerun once with a named repair, counted under the 5% NO READ rule; give each a reason code in src/errors/codes.ts"}
{"id":"F7","severity":"High","title":"X images carry no browser, but devex-review drives Aside or gstack's $B, asks for a docs URL in Step 0 and says to stop rather than substitute curl when no browser exists, so its told arm may stop before Step 1","fix":"Put Playwright and Chromium in X images for every arm as U does, and run a $0 probe of devex-review on a CLI fixture under the simulated user; read exposure from its gstack-review-log row (tthw_measured, dimensions_tested)"}
{"id":"F8","severity":"High","title":"plan-devex-review and devex-review stand-ins use the instrument's own terms ('first success', 'from the docs alone'), not the skills' one-line descriptions, biasing told minus stand-in toward the diet reading","user_challenge":true,"changes":"direction","fix":"Rewrite both stand-ins from the skill's idea without naming the measured outcome, or add a neutral second stand-in in the pilot to size the wording effect before any diet candidate rests on told minus stand-in"}
{"id":"F9","severity":"Medium","title":"X yield is overstated: the DX tag (docs plus any index.ts, __init__.py, lib.rs or schema file) catches internal refactors and web-app APIs (memos leads), and X has no mining scope while U has 60 repositories","fix":"Tighten the tag to public-surface changes with a user doc change, list X's artifact classes (CLI binary, library package; servers deferred or given a boot contract), and set an X mining target sized to about 360 valid candidates"}
{"id":"F10","severity":"Medium","title":"Admission row 4's docs-only bar has no unit and no per-task validity rule, so two broken goals can fail a whole family","fix":"Add V11: a task enters the pool only if gold reaches first success in at least 2 of 3 runs and base in 0 of 2; keep the family row as pooled over valid tasks"}
{"id":"F11","severity":"Medium","title":"plan-devex-review asks for a mode under the simulated user: EXPANSION proposes scope beyond the statement, TRIAGE traces only install and hello world, and the '8 passes in order' detector ignores the mode","fix":"Freeze the mode the simulated user picks (POLISH for enhancement tasks) or record the mode and score exposure per mode's required passes"}
{"id":"F12","severity":"Medium","title":"autoplan on family X counts as exposed when its own scope detector skips the DX phase, so autoplan (DX scope) can be scored without any DX review","fix":"For X rows, require the DX phase in autoplan's run.json as part of exposure, and report how often scope detection chose DX"}
{"id":"F13","severity":"Medium","title":"X primary is confounded with build and correctness, and the hidden-test guard ('losing more than 10 points') has no statistic","fix":"Print the X primary on the subset where both arms' trees pass hidden tests as a sensitivity; define the guard as the 95% interval of told minus none on hidden tests lying wholly below minus 10 points"}
{"id":"F14","severity":"Medium","title":"The plan names lanes/outcome-skills/ but no src/cli.ts row, subcommands, registry schema or reason codes, which AGENTS.md requires for every new command","fix":"State whether outcome-skills is a new cli row or subcommands of 'real', name each unit's entry command and its first smoke test, and list the reason codes O1 to O5 add"}
{"id":"F15","severity":"Low","title":"Wall time to first success mixes provider latency into a secondary","fix":"Report turns, tokens and failed commands to first success; keep wall time descriptive only"}
{"id":"F16","severity":"Low","title":"The fixed docs-only reader is Opus 5.5, the same family as the Opus row's writer, which may favour Opus-written docs over Sol and particle-1 docs","fix":"State the asymmetry in each X verdict, and in the pilot run a second reader family on a sample to size it"}
{"id":"F17","severity":"Low","title":"R65: docs may carry a licence apart from the code, and docs-only images bundle the artifact's dependency closure","fix":"Record a declared docs licence beside the SPDX id in V8, and state that task images stay private so dependency redistribution terms never apply"}
```
