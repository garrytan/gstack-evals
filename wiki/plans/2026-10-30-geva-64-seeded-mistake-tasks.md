---
id: 2026-10-30-geva-64-seeded-mistake-tasks
kind: design
title: "Seeded-mistake Lane A tasks for round 2: grading a guard against a past mistake"
summary: "Twelve keyless Lane A tasks that seed a repeated mistake in a small repo and grade whether the agent's guard catches the old mistake or makes it harmless, written before any arm runs."
author: GEVA-64
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-10-30
status: done
links:
  - 2026-10-30-geva-59-stacks-round-1-plan
  - 2026-10-30-geva-59-pstack-tstack-idea-inventory
---

# Seeded-mistake Lane A tasks for round 2: grading a guard against a past mistake

GEVA-64, for the gstack-evals Captain (GEVA-2), issue GST-348. GEVA-67 revised the grader before merge, after gstack /ship found two ways a graded tree could change its verdict; see "What the grader keeps out" below. This is item J of the stacks round 1 plan (2026-10-30-geva-59-stacks-round-1-plan), approved by the Captain as its own keyless unit.

The idea under test is Lauren Tan's, from pstack's correct skill: after a mistake, add the strongest check that would have caught it, so it can't happen again. Round 2 asks whether a skill that teaches this makes an agent's guard work on the old mistake. These tasks were written first, before any arm ran, so the test is not tuned to any stack. No model ran for this post, and nothing in the tasks comes from pstack's skill text.

The tasks live in docs/benchmarks/2026-11-seeded-mistakes/. Its README lists them and their files.

## The tasks

Twelve tasks, three of each kind:

| Kind | Tasks |
|---|---|
| test gap | admin-route-flag, migration-rollback, missing-translation |
| config footgun | timeout-units, env-flag-strings, config-key-typo |
| unsafe default | secret-file-mode, html-escape, open-redirect |
| missed edge case | empty-average, month-end, limit-off-by-one |

Each task seeds a small Bun repo with three commits. The first adds code with the mistake at site A. The second fixes A, sometimes with a test that covers A alone. The third adds site C with the same mistake. The prompt reports the bug at C, mentions that A had it before, and ends with one sentence shared by every task: fix it, make sure this kind of mistake can't come back, CI runs `bun run check`, keep the existing files and exported names, and work without stopping to ask.

## Grading

The check is `bun --no-env-file --config=<suite bunfig.toml> --tsconfig-override=<suite tsconfig.json> grade.ts <id>`. It copies the graded tree once per scenario, runs a behavior oracle the agent never sees, and then the repo's own CI entry, `bun run check`:

| Scenario | Edit | Passes when |
|---|---|---|
| final | none | the check and the oracle pass |
| touch | a comment, or JSON reformatted, in the files the mistakes live in | the check and the oracle pass |
| revert-a | site A's mistake put back | the check fails, or the oracle still passes |
| revert-c | site C's mistake put back | the check fails, or the oracle still passes |
| fresh | the same mistake in a new file, written in the repo's own style | the check fails, or the oracle still passes |

A task passes when all five pass. final says the fix works and the agent's checks pass on it. revert-a and revert-c say the guard fails on the old mistakes. fresh says it fails on the next copy of the mistake, which is the point of a guard. touch says the guard does not fail on harmless edits.

"The check fails, or the oracle still passes" is how the grade stays neutral about the kind of guard. A test, a lint rule that names the fix, or a type error that some check enforces all make `bun run check` fail. A design change that makes the mistake harmless, such as a router that guards every /admin path or an html tag that escapes by default, leaves the check green and the oracle passing. Both count. The one outcome that fails is the mistake shipping with every check green.

## Why it is fair to gstack, pstack and none

- The oracle tests behavior, never mechanism. For each task the keyless tests pass a reference guard, and four tasks also pass a second reference of another kind (a design change, or validation when the config loads). Guards that work through a test, a lint rule or a design change all score the same.
- The prompts name no stack, no skill and no kind of guard. A keyless test fails if a prompt or a seed history mentions gstack, pstack, tstack, superpowers or a skill, or if a prompt asks for a test, a lint rule or a type.
- Every arm gets the same environment. The trial image has Bun but no tsc, and Bun does not typecheck, so a type guard counts only when a check the agent adds enforces it. That holds for every arm.
- The grader runs only what CI runs. A guard that `bun run check` does not reach does not count, for any arm.
- The lock names no stack's skill. `skill-eval --lock` needs a before copy, so it names stack-neutral/, a stub with no procedure and no contract lines. The lock pins tasks.json (sha256 d239ef0af5c04e41e5076c71e3d6e379c4de606a1dea1362f711cfb2d7127963) and the policy (a00180abac95). The lock file's own sha256 is 0a0db8200d90e22d04ba3760aacd195794d079b3926c9d571386c85ea7370489. GEVA-67 changed all 12 check commands and relocked before merge; no model had run the tasks, so they were still written first. Round 2's preregistration relocks against the arms it names; the tasks digest must stay the same, which shows the tasks were not changed after any arm ran. That digest covers tasks.json only. grade.ts, the oracles, the mutants and the seed histories sit beside it, so the preregistration should also record the git tree id of tasks/ (`git rev-parse <commit>:docs/benchmarks/2026-11-seeded-mistakes/tasks`) and check it before the first trial.

## What the keyless tests show

tests/seeded-mistakes/tasks.test.ts runs without keys in about 40 seconds:

- tasks.json passes the contract, with three tasks per kind and every task's files present.
- Preflight's vacuity check (checkVacuity, which `--lock` also runs) accepts every task: the untouched fixture fails each check.
- The lock pins this tasks file against the stub.
- On every task, the reference guards pass. Three controls are scored to fail, and each fails on the scenario built for it: the fix alone fails revert-c; a snapshot of every source file fails touch; a guard that remembers only the old mistakes' exact bytes fails fresh.
- Nothing in a graded tree changes how it is graded. Each case below failed on the grader as GEVA-64 left it and passes now: a bunfig.toml preload that exits 0 (it skipped grading, passed the oracle, or skipped a mutant's bun step), a .env that set TMPDIR inside the tree (a failing tree came out unjudged), a coverage threshold the repo's tests meet (it failed a correct fix), a relative symlink (mutants wrote into the graded tree), a symlink out of the tree or to nothing, a tsconfig.json paths entry (it swapped grade.ts for another file), tree code that exits 0 on import, a test that rewrites the mutated file back, a check that fails only in the mistake scenarios' folders, a fixed route or migration list that never loads fresh's file, a missing translation rendered as a blank line, a check killed by a signal, and a read-only folder at cleanup.

## What the grader keeps out

The repo's own `bun run check` reads the tree's config, as its CI would. The grader's own steps do not:

- grade.ts, each oracle and the mutants' bun steps run with `--no-env-file` and the suite's bunfig.toml (which also sets `env = false`). grade.ts also runs with the suite's tsconfig.json. The oracle keeps the tree's tsconfig.json, because the tree's code it imports may rely on its paths.
- Each scenario runs at the same path, in random order, on a fresh copy of the tree, and mutants read a seed made for that scenario and removed before any tree code runs. A check that failed only in the mistake scenarios' folders passed with no guard before this.
- The oracle runs first, in its own copy of each scenario's tree, so the check cannot rewrite what the oracle grades. It passes only when it exits 0 and its JUnit report shows its own test file ran with none failing.
- The copies keep symlinks as links. A link that leaves the tree or points nowhere fails the grade before any mutant runs.
- A step that exits above 128 counts as killed, so a guard ended by a signal is unjudged, not a caught mistake. Cleanup makes the copies writable first and never changes the exit code.

The oracle imports the tree's code by design. Code written to tamper with grading from inside a step (by patching the oracle's process, writing outside its own copy, keeping state between its runs or leaving a process running) stays out of reach. A check that keeps state can still guess its scenario; the random order makes that guess wrong most of the time. These rules close the routes a tree can hit by accident and the cheap deliberate ones.

## Limits

- The tasks are public, not held out. The agent never sees the tasks directory in a trial, but a future model may have read it. Round 2 may add sealed variants.
- revert-a is often caught by the test the history already added for A. revert-c and fresh are the scenarios that tell arms apart.
- fresh is written in the repo's old style. If an arm changes an API so that this code no longer loads, the check fails and fresh counts as caught. That is generous to design changes, which is acceptable: code written the old, mistaken way no longer runs.
- In admin-route-flag and migration-rollback, fresh's file reaches the app only through a folder scan, so those oracles also require it to be served or listed. A tree that switches to a fixed list must catch the unlisted file in its check, or fresh fails.
- An agent that renames or moves the files a mutant edits breaks the scenario. The prompt asks agents to keep files and exported names, and the oracles import those names.
- How much headroom the tasks leave on Opus 5.5 is unknown until a pilot. A ceiling there would send the suite to the cheaper rungs, as the CREW model-ladder rule says.
- Each grade runs `bun run check` five times, so a slow suite of agent tests makes grading slow. Each step has a 300-second limit. A step that times out or is killed leaves its scenario unjudged, so the grader exits 2 and the trial records a check error, never a pass.
- No scenario adds a harmless new file, so a guard that fails on any new file, paired with one that remembers the old mistakes' bytes, would pass every scenario. Closing it needs a sixth scenario per task (a correct new file written the repo's way); it is left for round 2's pilot to show whether any arm writes such a guard.
- The timeout-units oracle accepts a design that drops timeouts entirely, because checking that a hung call is cut off at 10 seconds would make each grade far slower.
- Round 2's preregistration must decide two things these tasks leave open: whether an unjudged trial drops its task (on_missing: drop_task) or counts as a failure, and a timeout_s for each task, since a grade runs up to 23 timed steps of up to 300 seconds each (four seeds, four mutant edits, and five each of oracle, git add and check), though only the oracle and the check run tree code.
