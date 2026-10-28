# quick/lanea-quick: a thin Lane A runner (Quick look 3)

A throwaway before/after skill check for gstack's office-hours diet, with /learn as a sanity check. The preregistration, [2026-10-28-gsta-13-lanea-quick-office-hours-diet-prereg](../../wiki/plans/2026-10-28-gsta-13-lanea-quick-office-hours-diet-prereg.md), fixes the question, arms, tasks, metrics and stop rule. The real CLI comes in units U5 to U7; this folder is evidence for them, not a product.

## Run it

Needs Docker, Bun 1.4.4 and a gstack clone with history (`git clone --filter=blob:none https://git.capy.ai/garrytan/gstack.git ~/.capy/work/gstack`).

```
cd quick/lanea-quick && bun install
docker build -f docker/base.Dockerfile -t lanea-quick/base:cc2.1.312-bun1.4.4 docker/
bash docker/build-arms.sh ~/.capy/work/gstack lanea-quick/base:cc2.1.312-bun1.4.4
bun src/run.ts prepare                                   # task files at their shas, digests, skill file sizes per image
bun src/run.ts run --stage S1 --fake --trials 1          # keyless: fake upstream, no spend
bun src/run.ts run --stage S0 --prereg <sha>             # paid: needs ANTHROPIC_API_KEY and the ledger's approval row
bun src/run.ts project                                   # how many S2 trials fit the remaining cap
bun src/analyze.ts --out ~/.capy/work/lanea-quick/runs   # verdict.json and verdict.md
bun test test/ && bunx tsc --noEmit -p .                 # keyless checks
```

The keyless `--fake` run still needs Docker and the arm images: only the Messages API is faked. The tests under `test/` need neither; they stub `docker` and `git` and mock the Agent SDK where they need them.

Runs land in `~/.capy/work/lanea-quick/runs/<suite>/<model>/<task>/<arm>/t<trial>/`: `result.json`, `transcript.jsonl` (every SDK message), `usersim.jsonl`, `proxy.jsonl` (one row per API request with usage and cost) and `work/` (the final work dir). A rerun skips finished cells, so an interrupted run resumes. `--fake` runs default to `~/.capy/work/lanea-quick/runs-fake/` and keep their own ledger there, `ledger-fake.jsonl`.

Each run also writes its own `stages/<stage>.<start ms>.json`: `status: "running"` with the stage's models, arms and trials before the first session, and `status: "done"` with the finished count and any cap stop at the end. analyze reads every file of a stage. A cap stop (CAP_STOP, or RESERVATION_EXCEEDED when one session spent past its reservation) or a `--fake` run marks the block INCOMPLETE for good; a later run never clears it. For each model, the latest run of the stage decides UNFINISHED: its file still says running or it finished fewer cells than it planned. Results for a stage with no file are UNFINISHED too. A run with an unknown model or no matching cells stops before it writes a file.

### Environment

| Variable | Default | What it sets |
|---|---|---|
| `LANEA_WORK` | `~/.capy/work/lanea-quick` | Work root: `prepared.json`, task copies, Docker build contexts, `runs/` and `runs-fake/` |
| `LANEA_GSTACK` | `~/.capy/work/gstack` | The gstack clone that `prepare` reads task files from |
| `LANEA_LEDGER` | `~/.capy/drive/captain-gstack-evals/ledger/lanea-quick.jsonl` | The paid ledger. Its lock is the same path plus `.lock` |
| `LANEA_FAKE_CEILING` | unset | A `--fake` run's per-session spend ceiling in dollars, to exercise the budget refusal |

### run.ts flags

| Flag | Commands | Default | What it does |
|---|---|---|---|
| `--stage` | run, project | S1 for run, S2 for project | S0, S1, S2 or S3, as the prereg orders them |
| `--prereg <sha>` | run | none | Full sha of the pushed prereg commit; every paid run needs it |
| `--fake` | run | off | Fake upstream, no key, zero reservations, its own ledger under `--out` |
| `--models a,b` | run | the stage's models | Only these models |
| `--tasks a,b` | run | every task in the suite | Only these task ids |
| `--arms a,b` | run | the stage's arms | Only these arms |
| `--trials 1,2,3` | run | 1,2,3 | Trial numbers to run |
| `--parallel n` | run | 6 | Sessions at once |
| `--ledger <path>` | run, project, approve | `LANEA_LEDGER`; for `--fake`, `<out>/ledger-fake.jsonl` | Ledger file. A `--fake` run refuses a ledger outside `--out` |
| `--out <dir>` | run, project | `<LANEA_WORK>/runs`, or `runs-fake` with `--fake` | Run root that results and stage files go under, and that project reads costs from |

`analyze.ts` takes `--out <dir>` (the run root, default `<LANEA_WORK>/runs`) and `--dest <dir>` (where `verdict.json` and `verdict.md` go, default the run root).

### Approve the cap

A paid run reserves only against a ledger whose first row is an approval with the owner's words, who gave them, a source, and `cap_usd` equal to the runner's cap ($130). Record the approval once, with each quoted reply as its own `--words`:

```
bun src/run.ts approve --words "Rec" --by "Garry Tan" --source "<where the words were given>"
```

Pass the words as separate arguments, not through a shell string with `$` in it (see the last item below). `approve` does nothing when a valid approval row is already there, and refuses a ledger that already has other rows.

### One runner per ledger, per WORK and per results tree

A run takes three locks with an exclusive create before it reads the ledger: `<ledger>.lock`, `<LANEA_WORK>/runner.lock` and `<out>/runner.lock`. `prepare` takes the WORK lock too, since it rewrites the task copies that sessions read. Each lock records the pid, the kernel boot id and a random token. A lock left by a dead process from this boot is replaced under a `.takeover` file, so two starters cannot both replace it; a lock from another boot or machine, or one in an older format, is refused with its pid, so remove it by hand only once that runner is gone. A release removes the lock only while it still holds this runner's token. Container names carry a hash of the cell's output dir, so runners on one machine never remove each other's containers. At start the runner settles any open reserve left by a stopped runner at its full amount. When parallel sessions hold enough open reserves that the next one would pass the cap, the runner waits for one to settle; it stops (CAP_STOP) only when settled spend plus the next reservation passes the cap.

### Images

A paid run resolves every image tag to its id and refuses one that `images.json` does not pin. After a rebuild, run `prepare`, copy its image ids into `images.json` and commit them before a paid run. `build-arms.sh` leaves `test/` out of every arm, so no arm can read graded task files.

## Layout

| Path | What it does |
|---|---|
| `src/session.ts` | One session: container, setup, seeded state root, the Agent SDK driving `claude` over `docker exec -i`, the scripted user, the work dir copy, the check in a fresh container, grading |
| `src/proxy.ts` | Metering proxy on the Docker bridge: a per-session token, one allowed model, one paid request at a time, a spend ceiling and a per-request bound under the reservation, usage parsed from the SSE stream, per-request price |
| `src/usersim.ts`, `usersim/categories.json` | The scripted user: keyword classifier, sidecar replies, a non-approving fallback, prose-question replies |
| `src/grade.ts` | `must` over the transcript or the final answer, `must_not` over code blocks, skill opened, loaded files |
| `src/ledger.ts` | Append-only JSONL ledger: approval, reserve before each session, settle after, cap stop; the ledger lock; the in-order reserver |
| `src/run.ts` | prepare, approve, run (stages, trial-major order, a worker pool), project |
| `src/analyze.ts` | Contract gates, Wilson intervals, task-clustered bootstrap, sign-flip test, loss signal and noise check, stage stops, uncovered contract lines, cost and loaded-bytes tables |
| `src/fake-upstream.ts` | A scripted fake Messages API for keyless runs |
| `contract-lines/` | The diet's contract lines and the tasks that cover them |

## What U5 to U7 should reuse

- **Drive Claude Code from the evaluator side.** The Agent SDK's `spawnClaudeCodeProcess` option runs `docker exec -i <container> claude <args>` with a fixed env list, so `canUseTool` answers AskUserQuestion on the host and the persona never enters the container. GSTA-10 found the same with the Python SDK.
- **office-hours also asks in prose.** Many turns end in a plain-text question, not an AskUserQuestion call. A simulator that only answers AskUserQuestion stops those sessions at the first prose question. Classify the turn's final text and send the reply as the next user message.
- **Seed the gstack state root as an onboarded user.** Without the markers (`.feature-prompted-model-overlay`, `.completeness-intro-seen`, `.telemetry-prompted`, `.proactive-prompted`, `.activated`, `.first-loop-tip-shown`, `.writing-style-prompted`) and config (`telemetry off`, `update_check false`, `proactive core`, `cross_project_learnings false`, `routing_declined true`), `gstack-skill-start` emits onboarding blocks. The routing block asks to edit and commit CLAUDE.md, which breaks no-code safety checks. Calibrate with `gstack-skill-start`: expect `SESSION_KIND: interactive` and no `GSTACK_INSTRUCTION_BEGIN`.
- **The SDK's entrypoint keeps gstack interactive.** `CLAUDE_CODE_ENTRYPOINT=sdk-ts` resolves to `SESSION_KIND: interactive`. Setting `GSTACK_SESSION_KIND` would change the skill's behavior.
- **A failed Skill call is not an open.** In the none arm, the model may call Skill for the missing skill, and the result is an error. Count an open only on a successful tool result.
- **Price per request.** Haiku 5.5 switches to its higher price when a request's prompt passes 100k tokens. Cache writes are split into 5-minute and 1-hour rows. So cost has to be computed per request, not from summed usage.
- **Run the check in a fresh container.** The work dir is the agent's, and its `.git/config` could run commands under `git diff` on the host. Run the check in a no-network container with `safe.directory=*`, as the agent's uid.
- **/learn's seed names the project after the work dir.** Use the same work dir path in every arm, here `/work`.
- **Ledger rows go through a file, not a shell string.** A `$500` inside a double-quoted shell argument expands to `00`. The first approval row here has that defect and a correction note after it.
