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

Runs land in `~/.capy/work/lanea-quick/runs/<suite>/<model>/<task>/<arm>/t<trial>/`: `result.json`, `transcript.jsonl` (every SDK message), `usersim.jsonl`, `proxy.jsonl` (one row per API request with usage and cost) and `work/` (the final work dir). A rerun skips finished cells, so an interrupted run resumes.

## Layout

| Path | What it does |
|---|---|
| `src/session.ts` | One session: container, setup, seeded state root, the Agent SDK driving `claude` over `docker exec -i`, the scripted user, the work dir copy, the check in a fresh container, grading |
| `src/proxy.ts` | Metering proxy on the Docker bridge: a per-session token, one allowed model, one paid request at a time, a spend ceiling and a per-request bound under the reservation, usage parsed from the SSE stream, per-request price |
| `src/usersim.ts`, `usersim/categories.json` | The scripted user: keyword classifier, sidecar replies, a non-approving fallback, prose-question replies |
| `src/grade.ts` | `must` over the transcript or the final answer, `must_not` over code blocks, skill opened, loaded files |
| `src/ledger.ts` | Append-only JSONL ledger: approval, reserve before each session, settle after, cap stop |
| `src/run.ts` | prepare, approve, run (stages, trial-major order, a worker pool), project |
| `src/analyze.ts` | Contract gates, Wilson intervals, task-clustered bootstrap, sign-flip test, cost and loaded-bytes tables |
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
