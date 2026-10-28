# Adapters, isolation and egress

Each lane has one owner of isolation and egress (plan v3.2, "Lane B: trial runner and contract"). This file records which, and how each host adapter runs.

## Lane A: src/trial and the host adapters

Owner: U9 (src/trial), with U10 (the Claude Code and Codex adapters).

## Lane B: the runner chosen by the Harbor spike

Owner of isolation and egress: **Harbor**, chosen by the U8 spike ([finding](../wiki/board/2026-10-28-gsta-10-harbor-spike-lane-b-runner.md)). gstack-evals owns the metering proxy, the ledger, preregistration, stats and reports. Nothing in Lane B is built yet; this section is the contract M2a builds to.

**Runner.** Harbor, pinned by commit (f3a5a923 or later) until a release carries `skip_install` (harbor#3657). The pin goes into the arm manifest and the preregistration. The agent subclasses Harbor's `ClaudeCode` and calls private helpers (`_resolve_auth_env`, `_resolved_model_name`, `_model_alias_env`, `_sanitize_docker_compose_project_name`), so moving the pin means rerunning the spike's six checks. Tasks are Harbor task directories under `tasks/<track>/<task-id>/`.

**Agent.** Our own Harbor agent drives Claude Code through the Agent SDK, the same adapter shape as Lane A (stream-json with `canUseTool`). The SDK runs in the Harbor process on the evaluator side. Its CLI subprocess runs inside the trial container through `docker exec -i`, so stream-json and the question channel cross the boundary over stdio only. The env passed into the container is an explicit allowlist: `docker exec` forwards only the names the agent set, never the rest of the Harbor process's environment. The values of those names can still come from that environment: the API key does, through Harbor's auth helpers, so the Harbor process's environment holds only the metering proxy's key, and the provider key lives only in the proxy process. Harbor's built-in `claude-code` agent (`claude --print`) and its ACP bridge are not used: the first cannot answer AskUserQuestion, and the second runs the simulated user inside the task environment.

**User simulator.** Evaluator side only. The persona never enters the container; only the answer to each question does, as the tool result. Every question, answer and reply source goes to `usersim-events.jsonl` in an evaluator-only directory beside the trial's `agent/` directory, never inside it: Harbor bind-mounts `agent/` read-write into the container at `/logs/agent`, so anything written there can be read or rewritten by the agent under test. The same holds for the SDK message log.

**Model endpoint.** The metering proxy, passed as `--base-url`. Harbor sets `ANTHROPIC_BASE_URL`. Its own defaults for the tier aliases and `CLAUDE_CODE_SUBAGENT_MODEL` keep any value already set in the trial env or in the Harbor process's environment, so the agent pins every alias Harbor lists to the cell's model itself, and the trial env stays an explicit list.

**Arms.** Baked into the task image: the host CLI at a pinned version, the arm under the baked `CLAUDE_CONFIG_DIR`, and the gstack configuration. Trials run with `--ak skip_install=true`. Proposed, pending the Captain's decision (see the finding): every arm sets `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`, since Claude Code otherwise loads 16 bundled skills in every arm, and each trial records the skills list from Claude Code's init message.

**Network.** Per phase, in `task.toml`:

| Phase | Policy | Why |
|---|---|---|
| `[environment]` (setup) | `no-network` | Nothing installs during a trial |
| `[agent]` | `allowlist` with no hosts listed | Harbor allowlists the proxy's host on its own, every port on it, and refuses other TCP; DNS, ICMP and marked packets are the exceptions below |
| `[verifier]` | separate environment | Grading never shares the agent's container |

Harbor's Docker egress sidecar shares its network namespace with the agent container. Its nftables rules redirect TCP through a proxy that matches on SNI, Host or IP and reject other traffic, with three exceptions: DNS to the container's resolver, all ICMP, and any packet carrying the sidecar's own mark (114514). The allowlist is per host: Harbor drops the port from the base URL, so every TCP port on the proxy's host is reachable, and the proxy needs a host or address that serves nothing else to trials. DNS stays open as a slow side channel. ICMP stays open in both directions, to any host, even after the capability drop below, because Docker lets unprivileged users open ICMP echo sockets. Lane B containers hold no answer keys, so both are accepted and stated. The mark is not: a root process with Docker's default capabilities can set it (`SO_MARK` needs only `CAP_NET_RAW` on Linux 5.17 and later) and bypass the allowlist, and `CAP_NET_RAW` also opens `AF_PACKET` sockets that send below the sidecar's rules. So the agent runs as a non-root user in a container that drops `NET_RAW` and `NET_ADMIN`. Preflight checks that the agent's effective capabilities lack both, that a marked socket and an `AF_PACKET` socket both fail, and that no service in the task's or the run's Compose files declares `network_mode` or `networks`, since Harbor leaves such services, `main` included, outside the sidecar. WebSearch and WebFetch are removed under a restricted policy, and the metering proxy refuses requests that declare server-side tools.

**Host.** A Linux Docker host whose kernel has `CONFIG_NF_TABLES_INET` and `CONFIG_NFT_FIB_INET`: stock Ubuntu (Ubicloud, GitHub runners). Capy cloud machines lack both, and Harbor refuses non-public tasks there before starting. Preflight checks the kernel and fails with the fix line.

**Verifier.** Every task sets `[verifier] environment_mode = "separate"` (or `[verifier.environment]`) and declares the artifacts it grades, such as the patch. Harbor copies only `/logs/artifacts/` and declared paths into the verifier, so an undeclared output is not graded. Preflight refuses a task with shared verification.

**Open for M2a.** The non-root, capability-dropped agent above: Harbor's `[agent] user` reaches only Harbor's own exec path, so the SDK transport must pass `docker exec --user <uid>:<gid>` (a bare uid with no passwd entry runs in group 0) and the task's workdir itself. The spike task format has no setting for dropping capabilities, but Harbor's run-level `extra_docker_compose` does: the quick-look runner (`quick/laneb/runner/agent-caps.compose.yaml`) drops `NET_RAW` and `NET_ADMIN` from every trial's main container, which leaves it in the sidecar's network namespace, and its agent's setup refuses a container whose effective or bounding set still holds either. That runner still runs the agent as root, because Terminal-Bench tasks install packages and configure services. The spike agent hardcodes 12 turns and default permissions and ignores Harbor's `max_turns`, `max_budget_usd`, `reasoning_effort` and `permission_mode` options; the production agent forwards or refuses each. Also open: Compose tasks under the allowlist, regrading, and a streaming exec for any non-Docker environment.
