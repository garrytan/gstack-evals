# Harbor spike (U8, throwaway)

Evidence for [the U8 finding](../../wiki/board/2026-10-28-gsta-10-harbor-spike-lane-b-runner.md). This code is not maintained. M2a builds the real Lane B rig from what it learned.

| File | What it is |
|---|---|
| `fake_upstream.py` | A fake Anthropic Messages server that plays a fixed script of tool calls, so nothing is charged. It logs each request's path, model and auth header names, never values. |
| `sdk_claude_code.py` | A Harbor agent that drives Claude Code through the Agent SDK from the evaluator side, with the CLI inside the trial container over `docker exec -i`. |
| `usersim.py` | The user simulator: a deterministic keyword classifier, scripted replies by category, a non-approving fallback, and an event log. |
| `persona.json` | The simulator's persona. It stays on the evaluator side and carries a canary the probe searches for. |
| `spike-task/` | A Harbor task: baked Claude Code and a one-skill arm, `no-network` setup, an `allowlist` agent phase, and a separate verifier that writes one reward per check. |
| `run.sh` | Starts the fake upstream and runs the task. |

Requirements: Docker; Harbor from main at f3a5a923 or later, with the Agent SDK in its environment: `uv tool install "harbor @ git+https://github.com/harbor-framework/harbor@f3a5a923" --with claude-agent-sdk==0.2.174`.

```bash
bash spikes/harbor/run.sh                 # allowlist; needs a kernel with nftables inet
NETWORK=public bash spikes/harbor/run.sh  # every phase public, for Capy cloud machines
```

Results land in `spikes/harbor/out/`. The trial's `verifier/reward.json` has one key per check, and `agent/usersim-events.jsonl` holds the simulator's log. With `NETWORK=public`, `egress_blocked` is 0 by design.

`tests/spikes-harbor.test.ts` checks the fake upstream's script, the simulator and the task's settings with no key, Docker or Harbor; it needs python3. Delete it with this folder.
