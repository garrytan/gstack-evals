---
id: 2026-10-28-gsta-10-harbor-spike-lane-b-runner
kind: finding
title: Harbor spike, all six checks pass, so Harbor is the Lane B runner
summary: Harbor passed all six U8 checks against a fake upstream, with no API spend. Harbor runs Lane B, pinned to a commit, with our own SDK agent, on hosts whose kernel supports nftables inet.
author: GSTA-10
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: done
links:
  - spikes/harbor/
  - docs/adapters.md
  - https://github.com/harbor-framework/harbor/commit/f3a5a923
  - https://github.com/harbor-framework/harbor/pull/3657
  - https://github.com/garrytan/gstack-evals/actions/runs/40723646939
---

# Harbor spike, all six checks pass, so Harbor is the Lane B runner

This is unit U8 of the v1 build breakdown: the one-day Harbor spike (change d7). Plan v3.2 asks it to settle six things before anyone builds the Lane B runner. All six pass. Harbor stays the Lane B runner, and harness-evals' Docker fallback is not needed. The caveats and the plan corrections below matter more than the verdicts.

## How it was tested

Nothing was charged. A fake Anthropic Messages server stood in for our metering proxy. It replies to Claude Code with a fixed script of tool calls: AskUserQuestion, one Bash call that runs every probe, then a Write of `/app/answer.txt`. A separate verifier container reads that file and writes one reward per check. The code is in [spikes/harbor/](../../spikes/harbor/README.md), and `run.sh` reruns it.

- Harbor main at f3a5a923 (2026-10-27). The latest release, v0.25.0 (2026-10-25), lacks `skip_install`; see check 2.
- Claude Code 2.1.312 baked into the task image. Agent SDK for Python 0.2.174, running in the Harbor process.
- Model id `anthropic/claude-opus-5-5`, which only the fake upstream saw.
- Two hosts. This Capy cloud machine (kernel 6.1.158, Docker 29.9.2) ran the round trip with every network phase public. A GitHub-hosted ubuntu-24.04 runner (kernel 7.0.0-1017-azure, Docker 28.0.4) ran the full task with the allowlist on. The run was on a throwaway branch, since deleted: run 40723646939. It scored 1 on all six rewards.

## Verdicts

| # | Check | Verdict | Evidence |
|---|---|---|---|
| 1 | Accepts our proxy base URL | Pass | `--base-url http://<docker gateway>:8787` reached Claude Code as `ANTHROPIC_BASE_URL`. All four `/v1/messages` calls went to the fake upstream with an `x-api-key` header and model `claude-opus-5-5`. Harbor also sets every tier alias and the subagent model to the cell's model unless the caller's env already sets one, which fits the plan's model-purity rule as long as the trial env is an allowlist. |
| 2 | Baked arms with installs skipped | Pass, on Harbor main only | `--ak skip_install=true` logged "Skipping install, using the agent in the image". The environment's startup policy was `no-network`, so setup could not have downloaded anything. Claude Code's init message listed the baked `spike-arm` skill, and the probe read its sentinel line. `skip_install` landed in harbor#3657 on 2026-10-26, one day after v0.25.0, so pin a commit until a release carries it. |
| 3 | Separate verifier | Pass | With `[verifier] environment_mode = "separate"` and `tests/Dockerfile`, grading ran in a fresh container from its own image. Only the declared artifact `/app/answer.txt` crossed over; `/app/agent_only.txt`, which the agent also wrote, did not. The agent container had no `/tests` or `/solution`. |
| 4 | Drives Claude Code through the Agent SDK | Pass, as our own agent, Docker only | Harbor's built-in `claude-code` agent runs `claude --print` with permissions bypassed, so it cannot answer AskUserQuestion. A subclass of about 150 lines (`sdk_claude_code.py`) keeps Harbor's auth, base-URL and allowlist handling and replaces `run()`. The SDK runs in the Harbor process, and its CLI subprocess is `docker exec -i <trial container> claude`, so stream-json and the canUseTool channel cross into the container over stdio only. The env passed in is an explicit list. |
| 5 | Enforces an egress allowlist | Pass on a stock Ubuntu kernel; refused on Capy cloud machines | With `[agent] network_mode = "allowlist"` and no hosts listed, Harbor allowlisted the base URL on its own. The proxy answered 200, while `https://example.com`, `http://1.1.1.1` and `https://api.anthropic.com` all failed (curl exit 35, 52 and 35). Harbor turned on `disable_web_search` for the restricted policy, the agent passed it on, and WebSearch and WebFetch were gone from Claude Code's tool list. On this Capy machine Harbor refused the task before starting it: "network_mode='allowlist' is not supported by EnvironmentType.DOCKER environment". The kernel lacks `CONFIG_NF_TABLES_INET` and `CONFIG_NFT_FIB_INET`, which Harbor's egress sidecar needs. So Harbor fails closed rather than running unprotected. |
| 6 | AskUserQuestion round trip to an evaluator-side simulator | Pass | The simulator classified the question by keyword (`content_choice`) and answered `goodbye` from a persona file that never entered the container. The answer came back as the tool result. `usersim-events.jsonl` on the evaluator side recorded the question, the answer and its source (`scripted`). A search of the agent container's filesystem for the persona's canary found nothing. |

## The chosen Lane B runner: Harbor

Harbor passed every check, and it brings what the plan wanted from it: Harbor-format imports (DeepSWE, Terminal-Bench), the separate verifier, regrading and per-phase network policy. So M2a builds the Lane B rig on Harbor, under four conditions:

1. Pin Harbor by commit (f3a5a923 or later), and record the pin in the arm manifest and the preregistration. Harbor moves fast: 16 commits landed between v0.25.0 and f3a5a923 in two days, `skip_install` among them.
2. Run Claude Code through our own SDK agent, not Harbor's `claude-code` agent or its ACP bridge.
3. Run on Docker hosts whose kernel has nftables inet, such as Ubicloud's stock Ubuntu image or GitHub's runners. Capy cloud machines cannot enforce Lane B's network policy. The plan already puts Lane B on Ubicloud shards.
4. Assert at preflight that every task uses separate verification and declares the artifacts it grades.

Two things would flip this to the fallback. One is a need to run on a cloud sandbox (Modal, Daytona) where the `docker exec` transport has no streaming equivalent. The other is an upstream change that breaks skip-install or the egress sidecar under our pin. Neither is in view.

## Corrections and gaps for the plan

The plan does not need a new design, but these points change details. They are recommendations; the Captain decides.

- **Claude Code ships its own skills, so no arm is skill-free by default.** Claude Code 2.1.312 loads 16 bundled skills in every arm, including bare, none and placebo. Several overlap gstack's own skills: `code-review`, `debug`, `verify`, `simplify`, `deep-research`. `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1` leaves two, `doctor` and `plugin-authoring`. The plan's "bare (no skills)" arm and calibration's NO-SKILL check do not account for any of this. Recommendation, for both lanes since they share the host: set the variable in every arm, record the skills list from Claude Code's init message in each trial, and have calibration check it against the arm. Whether the last two can be removed was not tested.
- **Harbor's ACP bridge cannot host our simulator.** Plan v3.2 allows Harbor's ACP bridge as an option. The bridge runs the user agent inside the task environment, in the agent's workspace, so the agent could read the persona. The SDK agent is the only option that keeps the simulator outside the container.
- **The separate verifier sees only declared artifacts.** Lane A's grader imports the agent's whole filesystem delta. Harbor copies only `/logs/artifacts/` and the paths a task declares. That matches the plan's patch re-grade protocol, but every Lane B task must declare its patch or outputs, and imported tasks that use shared verification must be converted or refused.
- **DNS stays open under the allowlist.** Harbor's Docker sidecar sends all TCP through a proxy that matches on SNI, Host or IP, and rejects other non-TCP traffic, but it always allows DNS to the container's resolver. Under the allowlist, `example.com` still resolved. An agent could use lookups as a slow side channel. Lane B containers never hold answer keys, so the risk is low, but the docs should say so rather than claim full isolation.
- **Server-side tools bypass any sandbox.** Web search and fetch run at the provider. Harbor drops WebSearch and WebFetch when the network is restricted, and our agent passes that on. The metering proxy (U3) should also refuse requests that declare server tools, so a configuration slip cannot reach the web through the model API.
- **The `docker exec` transport is Docker-only.** It needs the trial container's id, which the agent reads from Docker Compose labels. Other Harbor environments would need their own streaming exec.
- **The agent ran as root.** The plan wants non-root containers. Harbor has an `[agent] user` setting, untested here. This is open for M2a.
- **Notes for the adapter (U10).** The Python SDK's canUseTool path needs a PreToolUse hook to keep the stream open, as Anthropic's docs show. AskUserQuestion answers go back as `updated_input` carrying an `answers` map from question text to label. In `default` permission mode every Bash and Write call also reaches canUseTool, which is where gated effects can be watched.

## Unknowns

None of the six checks is left unknown. Not tested in the timebox: non-root agent users, multi-container (Compose) tasks under the allowlist, Harbor's regrade command, and timing at scale.
