---
id: 2026-10-30-geva-63-stacks-step-1-handoff
kind: handoff
title: "Stacks round 1, build step 1: the pstack and tstack arm kinds, and what steps 2 and 3 plug into"
summary: "pstack and tstack install at their pins as stack arms, with subtree refs, per-cell settings, Codex on the proxy slot and a pstack placebo. Both keyless canaries pass, locally and from the trial image."
author: GEVA-63
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-10-30
status: done
links:
  - 2026-10-30-geva-59-stacks-round-1-plan
  - docs/stacks.md
  - src/arms/stacks.ts
  - src/arms/cells.ts
  - tests/arms/stack-canary.test.ts
---

# Stacks round 1, build step 1: the pstack and tstack arm kinds, and what steps 2 and 3 plug into

This is step 1 of section 10 of the [stacks round 1 plan](../plans/2026-10-30-geva-59-stacks-round-1-plan/README.md), issue GST-370. pstack is Lauren Tan's and tstack is Theo Browne's, both MIT. Each runs as published at the commit the plan pins, and no text from either is committed. [docs/stacks.md](../../docs/stacks.md) says how each is installed. Nothing here was charged: every session ran against the fake upstream.

## What shipped

- `StackRef` gains an optional `path`, written `<repo>@<sha>:<path>`. A subtree is extracted alone and verified against `git rev-parse <sha>:<path>`. The extraction cache is keyed by repository, commit and subtree.
- src/arms/stacks.ts lists pstack and tstack: repository, subtree, pin, installer per host, rig-authored files, told commands. A stack arm takes its installer from that map, and a listed stack with no installer for the host is refused.
- pstack installs at `~/.local/share/pstack` and is loaded per session as a plugin directory, recorded in the arm's `plugins`. The Claude Code adapter passes it through the Agent SDK's `plugins` option. Its installer runs pstack's own bootstrap in the builder, so poteto-mode's scripts need no registry in a trial.
- tstack installs by its README's copy, plus one disclosed file, src/arms/agents/sol.md, as a second digested layer. sol-loop refuses to run without a Sol route, and this subagent relays the brief to gpt-6.1-sol through the Codex CLI.
- src/arms/cells.ts gives each arm's settings per cell: pstack's `~/.claude/rules/pstack-models.md`, derived from the pinned setup-pstack shape; gstack's state root keys (`agent_model: host`, `codex_reviews` on only with a voice); and the Codex voice. Each cell has its own tree digest.
- In a cell with a voice, the Claude Code adapter writes `~/.codex/config.toml` for the session's slot before Claude Code starts, and `OPENAI_API_KEY` carries the slot's bearer. No file holds a credential. A failed write is a missing cell, E_CODEX_CONFIG.
- The placebo kind handles a plugin: pstack-placebo is the manifest plus one generated SKILL.md per skill, and the keyless test checks the told skill resolves, no procedure text survives, and each SKILL.md keeps its token count within 10%.
- `armImages` builds one image per cell that adds a layer and writes each arm's plugin roots and cells into arms.json.
- New reason codes: E_CELL_RULE and E_CODEX_CONFIG.

## Canary results

tests/arms/stack-canary.test.ts passed both tiers on 2026-10-30 (GEVA-63's machine, Claude Code 2.1.314, Codex 0.166.0). Each told command resolved with its skill body in the first model request. pstack:poteto-agent started as a subagent. tstack's Sol subagent ran `codex exec`, which reached the fake upstream as gpt-6.1-sol on the session's slot with the proxy's key, never the session's. poteto-mode's watch-pr ran with the registry pointed at a closed port. The Docker tier did the same from trial image gstack-evals-trial:20aba56c362bcd81 and wrote this arms.json:

| Arm | Repo at sha | Subtree | Git tree | Tree sha256 | Image digest |
|---|---|---|---|---|---|
| pstack | cursor/plugins@c742dd61706f | harness/pstack/claude-code | cdbbd4ca5dd2 | eb7aeda94b0e | sha256:1ba6679788f2 |
| pstack, Opus cell | | | | 82d976158c28 (cell tree) | sha256:eb97f00f89ee |
| pstack, Haiku cell | | | | 19a92365e55c (cell tree) | sha256:27102fb9c71c |
| tstack | t3dotgg/tstack@1085050f3bae | | a939d866f545 | 0abdb52c9996 | sha256:91a57f55fc26 |

tstack's Sol file has sha256 af8c6c4f271d56a47b6ebbe6b776d2c8889e19ec1411da090f4d8396f2d07244. The digests depend on the builder image and are re-made at preregistration.

## For step 2 (review units as trials)

- Install each arm with its own told skill: `installArms` takes one target skill per call, so call it once per arm (interrogate, sol-loop, review).
- For each cell, call `cellSettings(install, cell, dir)`. Use its `tree_sha256` as the session key's arm tree, pass `gstack_config` to `seedStateRoot`'s new `extra` argument (runTrial does not pass it yet), and pass `codex` and the arm's plugin roots (joined to the agent's HOME) to `hostDriver`. `armImages` with `cells` returns each cell's image as `<arm>@<model>`.
- The proxy binding in an Opus cell must admit `openai:gpt-6.1-sol` beside the cell's model, or the voice is refused. That allowlist is yours.
- T5 (origin refs for head-only units) is still open; gstack /review and sol-loop both look for a base.

## For step 3 (TB2 arms)

- The pstack and pstack-placebo trees are `installArms` outputs (stack and placebo kinds). pstack's skills load only as a plugin, so the Lane B agent has to load `~/.local/share/pstack` as a plugin directory (`--plugin-dir`, or Claude Code's `CLAUDE_CODE_PLUGIN_DIRS`). Without it, `/pstack:poteto-mode` does not resolve.
- In the cheap cells, use `cellSettings` with no voice: every pstack role is inherit-parent.

## Found on the way

- Claude Code 2.1.314 loads two built-in plugins, cc-plugin-agents-md and cc-plugin-plugin-authoring, in every session even with `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`. They load in every arm alike, but the preregistration should record them.
- Codex 0.166 ignores `OPENAI_BASE_URL` and `OPENAI_API_KEY` in the environment: with only those set it called api.openai.com with no credential. That is why the voice writes a config file per session.
- pstack's Opus-cell rule equals its defaults mapped by its Claude Code adapter, so it changes nothing there; it is written so every cell has a recorded rule.
