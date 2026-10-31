# Seeded-mistake Lane A tasks

Twelve Lane A tasks for round 2 of the stacks comparison. They test one idea: after a mistake, add the check that makes it impossible to repeat. The idea comes from Lauren Tan's pstack (its correct skill). The tasks were written before any arm ran, hold no stack's skill text, and grade gstack, pstack and no skill the same way. The design note is wiki/plans/2026-10-30-geva-64-seeded-mistake-tasks.md.

Each task seeds a small Bun repo whose history shows one mistake fixed once (site A) and now back in a new place (site C). The prompt reports C, mentions A, and asks the agent to fix it and make sure the mistake can't come back.

| Task | Kind | The repeated mistake |
|---|---|---|
| admin-route-flag | test gap | an admin route without `admin: true` answers anyone |
| migration-rollback | test gap | a migration's down does not undo its up |
| missing-translation | test gap | a key added in English but not French shows raw |
| timeout-units | config footgun | a timeout written in seconds where milliseconds are read |
| env-flag-strings | config footgun | `!!env.X` turns a flag on for "false" |
| config-key-typo | config footgun | a misspelled config key is ignored and the default applies |
| secret-file-mode | unsafe default | credential files written with the default, world-readable mode |
| html-escape | unsafe default | the html tag does not escape, so a view forgets escape() |
| open-redirect | unsafe default | redirect() follows any target, so a handler forgets safePath() |
| empty-average | missed edge case | an average over no rows is NaN |
| month-end | missed edge case | setUTCMonth rolls January 31 over into March |
| limit-off-by-one | missed edge case | a limiter checks n > limit and allows one extra |

## Files

- `tasks/tasks.json`: the tasks, in gstack's contract format. Setup is `sh "$SKILL_EVAL_FIXTURES/seed.sh" <id>`; the check is `bun --no-env-file --config="$SKILL_EVAL_FIXTURES/bunfig.toml" --tsconfig-override="$SKILL_EVAL_FIXTURES/tsconfig.json" "$SKILL_EVAL_FIXTURES/grade.ts" <id>`.
- `tasks/bunfig.toml` and `tasks/tsconfig.json`: the grader's own Bun config. With `--no-env-file`, they keep the graded tree's .env, bunfig.toml and tsconfig.json away from grade.ts, the oracles and the mutants' bun steps.
- `tasks/seed.sh` and `tasks/<id>/history.sh`: build the repo one commit at a time.
- `tasks/grade.ts`: the grader. It copies the graded tree once per scenario and runs the task's behavior oracle, `tasks/<id>/oracle.ts`, then the repo's CI entry, `bun run check`.
- `tasks/<id>/mutants.sh`: the scenarios' edits. They read old file versions from a fresh seed, so the grader does not need the agent's git history.
- `tasks/json-edit.ts`: the JSON edits of config-key-typo, missing-translation and timeout-units. Each finds its key wherever the tree keeps it (nested, wrapped or in a list) and fails when it finds nothing to change.
- `tasks/tasks.lock.json`: the lock, built with `gstack-evals skill-eval --lock --tasks docs/benchmarks/2026-11-seeded-mistakes/tasks/tasks.json --before docs/benchmarks/2026-11-seeded-mistakes/stack-neutral`.
- `stack-neutral/SKILL.md`: the stub the lock names as its before copy. It holds no procedure and no contract lines.
- `tests/seeded-mistakes/`: the keyless tests and each task's reference solutions.

## Grading

| Scenario | Edit to the graded tree | Passes when |
|---|---|---|
| final | none | the check passes and the oracle passes |
| touch | a comment added, or JSON reformatted, in the files the mistakes live in | the check passes and the oracle passes |
| revert-a | site A's mistake put back | the check fails, or the oracle still passes |
| revert-c | site C's mistake put back | the check fails, or the oracle still passes |
| fresh | the same mistake in a new file or config entry, written the way the repo writes such files | the check fails, or the oracle still passes |
| fresh-ok | fresh's new file or entry, written without the mistake | the check passes and the oracle passes |

A task passes when all six do. fresh-ok is there so a guard that fails on any new file, or on any change to what the config means, fails the grade. The grader prints one JSON line with every scenario's check and oracle result, and exits 0 (pass), 1 (fail) or 2 (nothing judged: the grader itself failed).

Failures the tree causes count as fails, with the reason in the JSON line: a tree that cannot be copied (a FIFO, a socket, an unreadable file), a mutant that fails on the tree but applies to the seed (a file moved, or a config key nowhere to be found), and an oracle or check that times out, is killed or exits above 128. Exit 2 is kept for faults the grader owns: an unknown task, a seed that failed, a mutant that fails on the seed too, a step that could not start, or a full disk.

The repo's own `bun run check` reads the tree's config, as its CI would. Nothing in the tree reaches the grader itself:

- grade.ts, each oracle and the mutants' bun steps run with `--no-env-file` and the suite's bunfig.toml, so the tree's .env, bunfig.toml preloads and [test] options (a coverage threshold, say) do not apply to them. grade.ts also runs with the suite's tsconfig.json, so a paths entry in the tree cannot swap it for another file.
- Each scenario runs at the same path, in random order (the JSON lists it as `order`), on a fresh copy of the tree. Mutants read a seed made for that scenario and removed before any tree code runs. So the check cannot tell which scenario it is in from where or when it runs.
- The oracle runs first, in its own copy of the scenario's tree, so nothing the check does to the files reaches it. That copy and the oracle's report are removed before the check runs, so the check cannot read the verdict. Nothing in its environment or arguments names the scenario: it runs every test every time, and the grader reads each test's result from its JUnit report. Tests in its "with no mistake in place" block count in final, touch and fresh-ok only. It passes only when the report shows its own tests ran with none that count failing, so tree code that ends the process early does not pass it.
- The copies keep symlinks as links. Each copy's links are checked where that copy sits, before anything runs in it. A link that leaves the copy or points nowhere fails the grade (exit 1, with the link named in `refused`), so no mutant writes outside its copy.

The oracle still imports the tree's code, which is the point of it. Code written to tamper with grading from inside a step (by patching the oracle's process, writing outside its own copy, keeping state between its runs or leaving a process running) is out of reach of these rules.

To grade a work tree by hand, run the check from the tree's root with `SKILL_EVAL_FIXTURES` set to the tasks folder.

These tasks are public, not held out. The agent never sees the tasks directory during a trial, but a future model may have read it.
