# Decision routing: test-pass labels, a stated reading of the prereg

This lane runs the 2026-11-09 decision-routing preregistration (wiki/plans/2026-11-09-geva-411-decision-routing-prereg). `gstack-evals decision-routing --help` lists its subcommands.

The prereg labels a test-pass decision with "the runner's exit code, from the same test command rerun without the pipe on the snapshot" (section 6). It does not say what happens when the logged command is more than a runner. We read it this way, and labels/container.ts applies it:

1. The replay drops everything from the command's first top-level pipe on (`|` or `|&`, never `||` or a quoted bar). So `pytest tests | tail -5` replays as `pytest tests` and keeps its label, because the left side of the pipe is the runner. Everything after the pipe goes too, so `pytest | tail -1 && echo done` also replays as `pytest`.
2. What remains must be a bare runner under the frozen test-runner rule of section 5 (dr_agent/rules_parser.py is_runner_exit, ported in labels/runner-exit.ts): one simple command from the frozen runner list (pytest, py.test, python -m pytest, python -m unittest, tox, nox), optionally after `cd <dir> &&`, with redirection to a file allowed.
3. Otherwise the label is missing (DR_LABEL_MISSING), never a pass or a fail. `pytest tests; echo $?`, `pytest || true`, `pytest && echo ok`, `make test` and a project script such as `./tests/runtests.py` all drop: their exit code is not the tests' result, or the frozen list does not name the runner.

`score` prints how many test-pass labels this drops, per model, cell and acting layer (jev, particle, frontier, main_turn, rule), in its text and JSON reports. `labels trial` prints the count for one trial. The results post discloses both.
