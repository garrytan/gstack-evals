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
| fresh | the same mistake in a new file, written the way the repo writes such files | the check fails, or the oracle still passes |

A task passes when all five do. The grader prints one JSON line with every scenario's check and oracle result, and exits 0 (pass), 1 (fail) or 2 (nothing judged: a setup or mutant failed, or a step timed out, was killed or exited above 128).

The repo's own `bun run check` reads the tree's config, as its CI would. Nothing in the tree reaches the grader itself:

- grade.ts, each oracle and the mutants' bun steps run with `--no-env-file` and the suite's bunfig.toml, so the tree's .env, bunfig.toml preloads and [test] options (a coverage threshold, say) do not apply to them. grade.ts also runs with the suite's tsconfig.json, so a paths entry in the tree cannot swap it for another file.
- The oracle runs first, in its own copy of the scenario's tree, so nothing the check does to the files reaches it. It passes only when it exits 0 and its JUnit report shows its own tests ran with none failing, so tree code that ends the process early does not pass it.
- The copies keep symlinks as links. A link that leaves the tree or points nowhere fails the grade (exit 1, with the link named in `refused`) before any mutant runs.

The oracle still imports the tree's code, which is the point of it, so code written to tamper with the oracle from inside its process is out of reach of these rules.

To grade a work tree by hand, run the check from the tree's root with `SKILL_EVAL_FIXTURES` set to the tasks folder.

These tasks are public, not held out. The agent never sees the tasks directory during a trial, but a future model may have read it.
