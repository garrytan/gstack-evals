# Stack arms: gstack, pstack and tstack

The stacks round compares gstack with two other skill stacks: [pstack](https://github.com/cursor/plugins/tree/main/pstack), by Lauren Tan, and [tstack](https://github.com/t3dotgg/tstack), by Theo Browne. Both are MIT licensed. The plan is [wiki/plans/2026-10-30-geva-59-stacks-round-1-plan](../wiki/plans/2026-10-30-geva-59-stacks-round-1-plan/README.md). This page says how the rig installs each stack. It copies no text from either stack.

Each stack runs as its author publishes it, at a pinned commit. The rig never fetches: clone each repository under `<state>/sources/` (on Capy, `~/.capy/work/gstack-evals/sources/`), and the rig extracts the pinned tree from there and verifies it against its git tree id (E_STACK_SOURCE, E_STACK_DIGEST).

## Arms

| Arm | Ref | What is installed | Told command |
|---|---|---|---|
| gstack | `gstack@<sha>` | The whole tree, by gstack's own `./setup --host claude --no-browser -q`. | review `/review`, TB2 `/investigate` |
| pstack | `cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c:harness/pstack/claude-code` | pstack's generated Claude Code plugin alone, at `~/.local/share/pstack`. Each session loads it as a plugin directory (Claude Code's `--plugin-dir`, through the Agent SDK's `plugins` option), so its skills answer as `/pstack:<name>`. The installer runs pstack's own bootstrap for poteto-mode's scripts in the builder, so they find their dependencies with no registry in a trial. | review `/pstack:interrogate`, TB2 `/pstack:poteto-mode` |
| tstack | `t3dotgg/tstack@1085050f3baed1ac724caa4a8166145fb2ac88af` | The whole tree. The installer copies `skills/*` into `~/.claude/skills`, as tstack's README says. One rig-authored file is added: `~/.claude/agents/sol.md` ([src/arms/agents/sol.md](../src/arms/agents/sol.md)). sol-loop runs Sol only through a subagent set up for it, and this one relays the brief to gpt-6.1-sol through the Codex CLI. Its sha256 is in the arm's provenance. | review `/sol-loop` |
| pstack-placebo | `placebo` of pstack | pstack's plugin manifest and one generated SKILL.md per skill, made by Lane B's placebo generator. No playbooks, scripts, references or agents. | as pstack |

`<repo>@<sha>:<path>` names one folder of a commit. The arm installs that subtree alone, and the digest check compares it with `git rev-parse <sha>:<path>`. src/arms/stacks.ts lists each stack's repository, subtree, pin, installer per host, rig-authored files and told commands. A repository it does not list installs with gstack's setup.

## Cells

Some settings differ by the cell's model, so `cellSettings` (src/arms/cells.ts) gives a tree per arm and per cell, for arms.json and the session key. A cell is the session's model and the cross-family voice its proxy allowlist admits: gpt-6.1-sol in the Opus cells, none in cheap cells.

- pstack gets `~/.claude/rules/pstack-models.md`, the rule pstack's setup-pstack writes. The rig derives it from the shape in the pinned setup-pstack skill and maps it the way pstack's Claude Code adapter says. In an Opus cell, Claude slugs keep their family and effort, and every other seat runs on the session model. In a cheap cell, every role runs on the cell's model, and each panel keeps its length.
- gstack gets state root config keys: `agent_model: host`, so its readers run on the parent model, and `codex_reviews` enabled only in a cell with a voice.
- In a cell with a voice, gstack's outside voice and tstack's Sol reviewer run the Codex CLI. Before Claude Code starts, the Claude Code adapter writes `~/.codex/config.toml` for the session's proxy slot, and `OPENAI_API_KEY` carries the slot's bearer. No file holds a credential, and no provider key enters the session (E_CODEX_CONFIG if the step fails).

The real-host run loop (src/skill-eval/cli/run-host.ts) loads each arm's plugin roots but does not apply cells yet: it builds no cell images, seeds no cell config and passes no voice. Step 2 of the plan wires them in. Today only the canary applies them.

## Canary

tests/arms/stack-canary.test.ts is the keyless canary per stack. It installs each stack at its pin through the rig and runs real Claude Code sessions against the fake upstream with a scripted model. It checks that each told command resolves with its skill body in the first request, that the stacks' nested agents start, that the Sol subagent reaches gpt-6.1-sol through Codex on the slot, and that poteto-mode's scripts run with no registry. It skips unless `bun install` has put the Claude Code and Codex CLIs in node_modules and both pinned commits are in `<state>/sources/`.

`GSTACK_EVALS_CANARY_DOCKER=1 bun test tests/arms/stack-canary.test.ts` runs the same sessions from the trial image. Each stack installs in the builder container, the arm and cell images are built, every session runs in its image, and `<state>/canary/arms.json` records each arm's repo, sha, subtree path, git tree, tree sha256 and image digest, and each cell's tree and image digest.

## TB2 (Lane B)

The TB2 lane runs Lane B's runner, which extracts each arm as a tar into `/root` at trial start. `quick/laneb/arms/stacks.ts` builds the pstack and pstack-placebo tars from the same `installArms` path as above, plus one rig-authored file in each: `~/.claude/settings.json`, whose `env` block sets `CLAUDE_CODE_PLUGIN_DIRS` to `~/.local/share/pstack`. Lane B's agent loads the user setting source, so Claude Code loads the plugin from that setting and `/pstack:poteto-mode` resolves without `--plugin-dir`. The tars' sha256 values, tree digests and tests are in [quick/laneb/arms/README.md](../quick/laneb/arms/README.md#the-pstack-arms-stacks-round-1), and the told skill per arm and task is in `quick/laneb/runner/skill-map.stacks.json`. tstack has no TB2 arm, since the plan does not run it there.
