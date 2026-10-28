# Adapters, isolation and egress

Each lane has one owner of isolation and egress (plan v3.2, "Lane B: trial runner and contract"). This file records which, and how each host adapter runs.

## Lane A: src/trial and the host adapters

Owner: U9 (src/trial), with U10 (the Claude Code and Codex adapters).

## Lane B: the runner chosen by the Harbor spike

Owner of isolation and egress: **Harbor**, chosen by the U8 spike ([finding](../wiki/board/2026-10-28-gsta-10-harbor-spike-lane-b-runner.md)). gstack-evals owns the metering proxy, the ledger, preregistration, stats and reports. Nothing in Lane B is built yet; this section is the contract M2a builds to.

**Runner.** Harbor, pinned by commit (f3a5a923 or later) until a release carries `skip_install` (harbor#3657). The pin goes into the arm manifest and the preregistration. Tasks are Harbor task directories under `tasks/<track>/<task-id>/`.

**Agent.** Our own Harbor agent drives Claude Code through the Agent SDK, the same adapter shape as Lane A (stream-json with `canUseTool`). The SDK runs in the Harbor process on the evaluator side. Its CLI subprocess runs inside the trial container through `docker exec -i`, so stream-json and the question channel cross the boundary over stdio only. The env passed into the container is an explicit allowlist. Harbor's built-in `claude-code` agent (`claude --print`) and its ACP bridge are not used: the first cannot answer AskUserQuestion, and the second runs the simulated user inside the task environment.

**User simulator.** Evaluator side only. Personas and scripted replies never enter the container. Every question, answer and reply source goes to `usersim-events.jsonl` beside the trial's agent logs.

**Model endpoint.** The metering proxy, passed as `--base-url`. Harbor sets `ANTHROPIC_BASE_URL` and points every tier alias and `CLAUDE_CODE_SUBAGENT_MODEL` at the cell's model, unless the env already sets one, so the trial env must not carry those variables.

**Arms.** Baked into the task image: the host CLI at a pinned version, the arm under the baked `CLAUDE_CONFIG_DIR`, and the gstack configuration. Trials run with `--ak skip_install=true`. Every arm sets `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`, since Claude Code otherwise loads 16 bundled skills in every arm, and each trial records the skills list from Claude Code's init message.

**Network.** Per phase, in `task.toml`:

| Phase | Policy | Why |
|---|---|---|
| `[environment]` (setup) | `no-network` | Nothing installs during a trial |
| `[agent]` | `allowlist` with no hosts listed | Harbor allowlists the proxy's base URL on its own; nothing else is reachable |
| `[verifier]` | separate environment | Grading never shares the agent's container |

Harbor's Docker egress sidecar redirects TCP through a proxy that matches on SNI, Host or IP and rejects other non-TCP traffic. DNS to the container's resolver stays open. WebSearch and WebFetch are removed under a restricted policy, and the metering proxy refuses requests that declare server-side tools.

**Host.** A Linux Docker host whose kernel has `CONFIG_NF_TABLES_INET` and `CONFIG_NFT_FIB_INET`: stock Ubuntu (Ubicloud, GitHub runners). Capy cloud machines lack both, and Harbor refuses non-public tasks there before starting. Preflight checks the kernel and fails with the fix line.

**Verifier.** Every task sets `[verifier] environment_mode = "separate"` (or `[verifier.environment]`) and declares the artifacts it grades, such as the patch. Harbor copies only `/logs/artifacts/` and declared paths into the verifier, so an undeclared output is not graded. Preflight refuses a task with shared verification.

**Open for M2a.** A non-root agent user (`[agent] user`), Compose tasks under the allowlist, regrading, and a streaming exec for any non-Docker environment.
