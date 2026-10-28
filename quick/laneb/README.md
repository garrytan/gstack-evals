# quick/laneb: Lane B quick look on public tasks

GSTA-12's exploratory runner for one question: on Terminal-Bench 2.0 tasks graded by execution, does gstack beat no skills and a length-matched placebo, on Opus 5.5 and on cheap models? The preregistration is the wiki post [2026-10-28-gsta-12-laneb-quick-prereg](../../wiki/plans/2026-10-28-gsta-12-laneb-quick-prereg.md). Results go in a separate pull request.

It is a quick runner, written so M2a can keep the parts that hold up. It grows the U8 Harbor spike ([finding](../../wiki/board/2026-10-28-gsta-10-harbor-spike-lane-b-runner.md)) into something that spends money safely.

## How a trial runs

```mermaid
sequenceDiagram
  participant L as ledger service (Capy machine)
  participant P as metering proxy (VM host)
  participant H as Harbor + laneb agent (VM host)
  participant C as trial container
  H->>C: build task image + runtime layer, start
  H->>C: extract the arm tarball into /root
  H->>P: open session (model, cap)
  P->>L: reserve the cap (SSH reverse tunnel)
  H->>C: docker exec claude (stream-json, canUseTool)
  C->>P: /v1/messages with the session token
  P->>P: refuse if spend + worst case > cap, meter usage
  H->>C: stop Claude Code, export patch if any
  H->>P: close session
  P->>L: settle with metered cost
  H->>C: verifier
```

## Pieces

| Path | What it does |
|---|---|
| `runner/proxy.ts` | Anthropic Messages proxy. Holds the provider keys; containers hold only a per-session token. Rewrites the model to the cell's model, refuses provider-side tools and any body field outside the set Claude Code sends (`mcp_servers`, `container`, OpenRouter's `plugins` and routing fields), drops unlisted `anthropic-beta` values, refuses a `max_tokens` that is not a positive integer, refuses a request when spend plus that request's worst case would pass the session cap, meters usage from streamed and plain responses, and charges the worst case when it cannot (a body cut mid-read, a 200 without usage, a failure after the request may have reached the provider). Enforces the batch cap when a session opens, never mid-session. Injects OpenRouter's `provider` pin for DeepSeek. Close writes the session row before it settles, retries the settle, and leaves a failed one for the next close or `close-all`. |
| `runner/ledger.ts` | Append-only ledger in integer micro-dollars: approval row first, a reserve per session (idempotent by id, refused past the cap), one settle per reserve. `serve` exposes it on 127.0.0.1 for the proxy; `reconcile` settles open reserves from a run's `proxy-sessions.jsonl`. |
| `runner/agent/laneb_agent.py` | Harbor agent. Claude Code runs inside the container over `docker exec -i`, driven by the Agent SDK outside it. Extracts the arm during agent setup (off the event loop, outside the agent timer), opens and closes the metered session, wraps the instruction in the arm-neutral prompt, answers AskUserQuestion from `usersim.py`, and on any exit kills Claude Code, closes the session (which settles) and writes `laneb-summary.json`, each step even when an earlier one fails. Evaluator evidence goes to `evaluator/` beside the trial's `agent/` directory, which Harbor mounts read-write in the container. Setup refuses a container that still holds `NET_RAW` or `NET_ADMIN`. A session that closes with no ok response raises `LanebInfraError`, the only agent error Harbor reruns; any other error after a model response is graded as it stands. |
| `runner/prompt-wrapper.md` | The one prompt wrapper, identical across arms. |
| `runner/materialize.ts` | Turns registry task directories into runnable ones: the task image plus a runtime layer (Claude Code 2.1.312, Node, Bun) that is identical across arms, and the per-phase network policy. Also converts SWE-bench Verified tasks to a separate verifier that grades the exported patch (not used in this run). |
| `runner/prepare-run.ts` | Builds one batch's run directory: the tasks in `tasks/final.json` materialized and checked against their pinned digests, the arm tarballs, the proxy config, the JobConfig with VM paths, and a manifest with the git head and every digest. |
| `runner/route-check.sh` | The first paid step: the smoke task once per model through the real proxy and ledger, arm none. |
| `runner/grid.ts` | Writes a Harbor JobConfig: every task by every (model, arm). Harbor orders trials task by task, so a cap stop leaves complete, paired task blocks. Reruns only `LanebInfraError` and Harbor's environment-start and agent-setup timeouts, and adds `agent-caps.compose.yaml`, which drops `NET_RAW` and `NET_ADMIN` from every trial's main container. |
| `runner/launch.sh`, `vm-bootstrap.sh`, `vm-run.sh` | One batch on a fresh Ubicloud VM: bootstrap, keys to a 0600 file over stdin, an oracle gate that needs reward 1 on every task, proxy plus Harbor on the VM, ledger service here through a reverse tunnel, results pulled back and open reserves reconciled. The VM is destroyed only after a confirmed pull. An interrupt stops Harbor, lets the sessions close and settle, then pulls. |
| `runner/smoke.sh`, `fake_upstream.ts`, `smoke-task/` | Keyless end-to-end test: fake upstream, proxy, scratch ledger, Harbor, agent, real Claude Code, separate verifier. |
| `arms/` | The gstack arm build and the seeded placebo generator. |
| `tasks/` | The task pre-screen scripts and the fixed list with digests; the write-up is the wiki post [2026-10-28-gsta-12-tb2-task-selection](../../wiki/research/2026-10-28-gsta-12-tb2-task-selection.md). `final.json` is the list after oracle checks, with each dropped task and why. |
| `analysis/analyze.ts` | Pass rates with task-clustered bootstrap intervals, paired contrasts, cost per success, share of the Opus gap closed, skill-open rates. A trial is graded on its verifier reward; a trial without one scores 0 if a model response reached the agent (reported again with those trials dropped), and is infra otherwise. Cost comes from the proxy's session rows (`sessions` in the config: each run's `out/proxy-sessions.jsonl`); a trial without a row has a missing cost, never $0. |
| `config/` | Proxy routes and prices, and the cells with their session caps. |

## Checks

Keyless: `bun test quick/laneb` and `npx tsc --noEmit -p quick/laneb/tsconfig.json`. `NETWORK=public bash quick/laneb/runner/smoke.sh` needs Docker and Harbor (`uv tool install "harbor @ git+https://github.com/harbor-framework/harbor@f3a5a923f6d722472c9e797af836ae4425fb215f" --with claude-agent-sdk==0.2.174`).

## What M2a should know

- Keep: the proxy's session tokens and worst-case refusal, the ledger's integer money and idempotent reserves, the agent's always-settle exit path, the task-major job order, the runtime layer appended to PATH.
- Replace: the hand-written batch specs with the plan's prereg plumbing, and the Python usersim with the shared simulator.
- Known gaps: the agent runs as root (Terminal-Bench tasks install packages and configure services), in a container without `NET_RAW` or `NET_ADMIN`; processes the agent starts are recorded at the phase boundary but keep running into the public verifier phase, because some tasks grade services the agent leaves running; arms are extracted at trial start rather than baked; DeepSeek is metered at peak price; Claude Code's own `max_tokens` of 128k forces a large per-request worst case, so the agent sets `CLAUDE_CODE_MAX_OUTPUT_TOKENS` (32000) in the container; the worst case counts input at `count_tokens` plus 64 tokens on Anthropic routes and at one token per request byte on OpenRouter or when counting fails, so long sessions stop short of their cap.
