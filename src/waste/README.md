# src/waste: the crew-log waste reader

`gstack-evals waste` turns exported crew-session logs, /ship receipts and per-PR replay data into counts for the in-the-wild waste baseline (GST-1114). The step before it, [wiki/board/2026-11-03-geva-220-waste-floor.md](../../wiki/board/2026-11-03-geva-220-waste-floor.md), found almost no waste in single-task benchmark sessions and moved the question to multi-hour crew ship pipelines.

It is keyless, makes no network call and decides no verdict. It prints counts, the label you pass and sha256 digests of its inputs. It never prints a command line, a path, a result or any other text from what it reads, so its output is safe to commit when the inputs are private. Labels are yours to mint; mint them from random bytes when an input names a private repository.

```
gstack-evals waste threads [--label <label>] <export>...
gstack-evals waste receipts [--label <label>] <file>...
gstack-evals waste prs [--label <label>] <per-pr.json>
```

Input problems exit 2 with `E_WASTE_INPUT` and name the input by its position, never by its path.

## threads: Capy thread exports

One export file is one session: a Capy thread, or one of its subagents, read with `tools.thread.get` and `transcript: { tools: true }`. The reader takes a transcript page (`{"items": [...]}`), an array of items, or JSON lines of either, in any order. It drops repeated item ids and sorts by `createdAt`. A Capy execute program like this writes one export on the machine that will run the scan:

```js
const lines = [];
let before;
do {
  const page = await tools.thread.get({ thread_id: THREAD, transcript: { limit: 100, tools: true, ...(before ? { before } : {}) } });
  lines.push(JSON.stringify({ items: page.transcript.items }));
  before = page.transcript.beforeCursor;
} while (before);
await tools.capy.write({ path: OUT, content: lines.join("\n") + "\n" });
```

Every tool call counts, whether a program made it or it was a direct tool call. A call's time is its `durationMs`; direct tool calls carry none and count 0 ms. Calls made inside one program can overlap, so summed call time is not elapsed time.

**The tree boundary.** A counter goes up at each call that may edit the work tree, commit or push: Capy's edit, write, apply_patch, pr_create and transfer_files tools; subagent_create, subagent_start and a message to a subagent, since a subagent on a shared machine can edit the tree; any background or detached bash call; and a bash call with any of these parts: a redirect to a file, a mutating git subcommand (commit, merge, rebase, cherry-pick, revert, am, pull, reset, checkout, switch, restore, stash, apply, push, rm, mv, worktree, clean, submodule, clone, init), a file tool (mv, cp, rm, rmdir, touch, patch, tee, install, ln, rsync, truncate, dd, unzip, tar, chmod, chown, wget), eval, xargs or exec, a script run with `.` or `source` (a `.env` file stays neutral, since it only sets variables), an in-place sed or perl, find with an action, sort -o, curl with an output file, a script runner (python, node, bun, npm, make, go, cargo and the like) that is not a check, or `gstack-pregate` with `push`. A bash call whose input was cut in the export can't be read; it counts as `unreadable_bash` and moves the counter.

**Checks.** A bash call is a check when one of its parts runs a test, typecheck, lint or build command (bun test, bun run test, typecheck, lint, build, check or any script ending in `:check`, npm, pnpm and yarn test, tsc, eslint, pytest, jest, vitest, go test, cargo test and the like) or gstack's pregate or ship preflight, with no fix or update flag (--fix, -u, --update, --update-snapshots, --snapshot-update, --write, fmt, format). `ship_checks` adds every bash call that runs a `gstack-` program.

**Readings.**

| Field | What it counts |
|---|---|
| `r1` | R1, a re-run with nothing new: a foreground bash call with the same command bytes and machine as the last such call, the same result digest, length and error flag, and no tree boundary between them. A call that crosses the boundary itself, such as an edit, a file write or a push, never counts. Polls and sleeps are left to R4. `approx_calls` are matches where either result was cut in the export, compared on the cut text plus the full length, so R1 there is approximate. `r1_checks` and `r1_ship_checks` are the matches that are checks or ship checks. |
| `r1_strict` | The same, but any bash call outside the read-only, check, poll and sleep lists, or with a substitution or here-doc, also counts as a boundary, and a call that is such a boundary itself never counts. A lower bound for R1. |
| `informative_reruns` | Same command, no boundary, a different result: a flake or a real change. Never waste. |
| `pushed_head_checks` | Checks made after a successful push or an opened PR, on the same machine and after the same `cd`, with no boundary since, by a call that crosses no boundary itself: deterministic runs at a pushed head, which CI also runs when the branch has a PR. An opened PR is on the machine its `index` names, or the primary when the index is absent or null, and keeps the `cd` of a push on that machine with no boundary since. A `pr_create` whose input was cut in the export is read as the primary with no `cd`. |
| `r4a` | R4, identical repeated status polls: a poll whose command bytes (or Capy status tool and input) and result match an earlier poll, with only polls, pure sleeps, waits and quiet tools (thread_get, thread_list, read, end_turn) between them. A pure sleep only sleeps and writes nothing; a sleep call that does other work ends the run, and a status read that writes a file is not a poll. Poll commands are ps, pgrep, pidof, jobs, git status and ls-remote, gh run view, list and watch, gh pr checks and view, curl to localhost, nc -z, docker ps, logs and inspect, and tail without follow. Capy status tools are operation_get and operation_list, subagent_get and subagent_list, pr_get_checks, pr_get_overview, pr_get_findings, pr_get_comments and port_list. Exports record only the fields a program read from a Capy tool, so an identical poll there means the fields it read were identical. Any background or detached call ends the run, a background sleep included. |
| `r4b` | Idle time, reported and never counted as waste: bash calls that sleep (count and time), wait tool calls (count, timer waits, the seconds the timers asked for, and operation waits) and `sleep(` sites in program code (sites, not executions). |
| `models` | Assistant messages by model. |

Tool results in exports are cut to a few thousand characters (`cut_results` counts them), and system wakes are not in the transcript, so a background job or subagent that finishes between two runs shows only through the boundary at its start.

## receipts: R5 from /ship receipts

Each file is a PR body or any text that holds a /ship receipt. The reader takes the last `gstack-ship-receipt` block's `review_loop`, or failing that the last `REVIEW_LOOP:` line. Rounds follow gstack's rule: `review_loop.rounds`, or else passes plus fix-checks, with fix-checks counted as 0 when not recorded. R51 caps rounds at 2. It counts files with no receipt, passes and rounds, how far each goes past the cap, the PRs past it, and rounds by count.

## prs: per-PR replay data

One JSON file with a `prs` array and an optional `catches` array, in the shape of the cross-repo catch replay's per-repo data. PRs marked `in_sample: false` are left out. A field no PR records prints as null, which means not measured, never zero.

- `ci`: heads with and without CI jobs, heads whose job count is not measured, workflow runs, reruns, red heads, job minutes, and wall minutes over all heads and over final heads.
- `local_checks`: pregate, ship_preflight, ubicloud_verify and train_gate, the local deterministic gates that rerun what CI runs at the same tree. Runs and wall minutes are summed from numbers only; a run count that isn't a number counts as `runs_not_measured`, and a wall time given as text, an estimate, counts as `wall_estimate_only`.
- `review`: /ship passes (from receipt_loop, review_loop or the ship_panel gate), passes per head over the PRs whose heads are measured, rounds (gstack's rule, as for receipts), passes and rounds past the cap of 2 and the PRs past it, /ship runs, and platform review runs per head over the PRs whose heads are measured.
- `catches`: catches by first-gate family, weighted by `count`. Escapes, catches marked `strict: false` and catches outside the sample window are counted apart and left out of `counted`.

## Tests

`bun test tests/waste`. Every fixture is invented in the test file.
