---
id: 2026-10-30-gsta-35-u10-host-adapters-handoff
kind: handoff
title: "U10 handoff: host adapters, user simulator, calibration and adjudication"
summary: What U10 landed and what is pushed but not yet merged, the seams U11's shakedown runs against, the exact seams GST-272 builds on, and what each unmerged branch needs to reach READY.
author: GSTA-35
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-30
status: open
links:
  - https://github.com/garrytan/gstack-evals/pull/64
  - https://github.com/garrytan/gstack-evals/pull/65
  - 2026-10-29-gsta-25-skill-eval-interface-v0-5
  - 2026-10-29-gsta-29-u7-skill-eval-cli-handoff
  - docs/adapters.md
  - docs/skill-eval.md
  - src/adapters/
  - src/usersim/sim.ts
  - src/grade/
  - src/skill-eval/cli/run-host.ts
---

# U10 handoff: host adapters, user simulator, calibration and adjudication

U10 (GST-271) connects the skill-eval CLI to real hosts. It ships as four pull requests, each a fresh commit off main, opened only after the previous one merges (the Captain's rule: no stacking). The first merged. The second is open. The last two are built, tested and pushed as WIP branches with no pull request, because this thread reached its token budget. A fresh thread takes them from here.

## What landed

- **#64 (merged, c051d65): Claude Code adapter, user simulator, GST-109 turns, OpenRouter /v1/messages.** Claude Code runs through the Agent SDK over stream-json, with the CLI inside the agent session and the SDK, canUseTool and the simulator on the evaluator side. The simulator binds each approval to the question's category and gated effects. Effects come from the header, the question, the option labels and the option descriptions. A reply that names an effect the question does not name is held back. A refusal is sent as written only when it is bare ("No, not yet.") or its direct negations cover every effect the question names. Turns and calls[] are parsed as GST-109 decided. particle-1 reaches a Claude Code arm through OpenRouter's Anthropic-compatible route.
- **#65 (open): Codex adapter.** `codex exec --json` behind the metering proxy, non-interactive tasks only, bundled skills and web search off, usage classes kept apart. The binary is pinned by sha256 in the trial image and by version in package.json.

## Unmerged branches

| Branch | Tip | Holds | Needs to reach READY |
|---|---|---|---|
| `capy/gsta-35-wip-run-loop` | 2ba22b4 | Calibration (`src/adapters/calibration.ts`), `hostDriver` and `SKILL_DIRS` (`src/adapters/host.ts`), the real-host run loop and Docker rig (`src/skill-eval/cli/run-host.ts`), `runOnRealHost` in skill-eval.ts, `SkillRef.home`, keyless run-loop tests and the Docker-tier rig test | After #65 merges: a fresh branch off main, `git cherry-pick 2ba22b4` (its parent is an earlier Codex commit, so only the run-loop diff applies), full suite, `GSTACK_EVALS_DOCKER=1 bun test tests/adapters/run-host.test.ts -t "Docker rig"`, PR body, sealed guard, pregate, CI and the Capy review |
| `capy/gsta-35-wip-adjudication` | 17eb8ee | Blinded cross-family adjudication (`src/grade/adjudicate.ts`), JUDGE_UNAVAILABLE, the `cells.ndjson` journal, `run.json`, `--resume` with E_CACHE_STALE and E_NOT_RESUMABLE, `--repair`, docs | After the run-loop PR merges: cherry-pick 17eb8ee the same way, then the checks above. The body must say why `JUDGE_ALLOWANCE` rose from 60k/4k to 200k/40k tokens: one host request reserves the proxy's 32,768-token output cap, so the old allowance could never admit a judge call. |

Both branches pass the full suite on their own trees: 999 tests for the run loop and 1002 for adjudication, with typecheck, errors:check and wiki:check clean.

## Seams for U11 (Lane A shakedown)

- A real call is `gstack-evals skill-eval --host claude|codex` under `--isolation docker` with loose-folder, `none` and `bare` arms. Per model, calibration runs one session per arm plus a shell check, a user-simulator round trip on Claude Code when a task has scripted replies, and an egress probe from the evaluator. Any failed check stops the run with exit 3 before a trial runs.
- Each session is a U9 trial on its own proxy slot. A round starts only when its worst case fits under the cap, so a cap stop never leaves partial cells. `progress.json` is rewritten after each session.
- Interactive tasks run on Claude Code only. Codex refuses them with E_INTERACTIVE_HOST.
- An OpenRouter rung on Claude Code needs its calibration and a tool-use smoke before a counted run, since OpenRouter guarantees Claude Code only on Anthropic models.
- Judge sessions use `JUDGE_ALLOWANCE` and dry-run counts them in the worst case. Safety tasks are never judged.

## Seams for GST-272

- `hostReadiness(call)` in `src/skill-eval/cli/run-host.ts` stops a real-host call with E_USAGE naming GST-272 for a gstack base at a sha (including one inferred from a rendered gstack skill), a stack arm, a placebo arm, or a persona free-form model. Remove each refusal as its piece lands.
- `CALIBRATION_CONFIG` is null in `src/adapters/calibration.ts`; it needs a gstack base to check.
- The persona's free-form answers: `UserSimOptions.freeform` (`FreeForm`) in `src/usersim/sim.ts` is the hook. The Claude Code driver takes a `freeform` option, but `hostDriver` (on the run-loop branch, `src/adapters/host.ts`) passes none today. A free-form answer is already held to the binding rules.
- The base install: `dockerRig` builds arm images from overlay layers only (the layers loop in run-host.ts). A base arm needs the gstack tree at the `--base` sha installed as a layer under the host's skill dir, then the overlay.
- `call.arms.base` (U7's grammar and inference) is parsed and recorded in the verdict context, but the rig ignores it.

## Open items

- `--calibrate` and `--mirror` are still unbuilt flags owned by U10.
- canUseTool does not see calls that Claude Code's own allow rules approve first. A fixture's `.claude/settings.json`, or one the agent writes, could carry such a rule. calls[] comes from the transcript, so grading does not depend on canUseTool. Whether an allow rule can skip the simulator for AskUserQuestion is untested; an SDK-side PreToolUse hook would close it.
- The judge runs on a full host with its tools and is told not to use them. Its container holds no skill and no copy of the agent's work, and its directory name is random.
- Codex in exec mode answers `request_user_input` itself and reports nothing.
- The `--resume` CLI path (run.json, recovery and E_NOT_RESUMABLE) is tested only below the CLI, at runOnHost.
