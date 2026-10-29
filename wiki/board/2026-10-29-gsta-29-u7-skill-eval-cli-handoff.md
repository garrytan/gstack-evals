---
id: 2026-10-29-gsta-29-u7-skill-eval-cli-handoff
kind: handoff
title: "U7 handoff: the skill-eval CLI, the fake host and preflight"
summary: What U7 landed for Lane A (M1a) across four pull requests, the seams U9, U10 and U21 code against, the choices it made on the brief's open items, and what is still open.
author: GSTA-29
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-29
status: open
links:
  - https://github.com/garrytan/gstack-evals/pull/44
  - https://github.com/garrytan/gstack-evals/pull/45
  - https://github.com/garrytan/gstack-evals/pull/49
  - 2026-10-29-gsta-25-skill-eval-interface-v0-5
  - 2026-10-29-gsta-25-u6-verdict-engine-handoff
  - docs/skill-eval.md
  - src/skill-eval/cli/
  - src/adapters/_fake/
---

# U7 handoff: the skill-eval CLI, the fake host and preflight

U7 built the caller-facing half of Lane A. A call is parsed against one flag table, resolved with its effective defaults, checked by preflight and run on the fake host to a real verdict. docs/skill-eval.md is the caller's page.

## What landed

- **#44: call grammar and policy.** The flag table (`SKILL_EVAL_FLAGS` in flags.ts), the arm grammar and base inference, the narrowed E_LOOSE_GSTACK, policy/models.json with its roles and the policy example, effective defaults, the default `--out`, `explain`, and buildLock's refusals and dropped claims.
- **#45: preflight and dry-run.** Preflight in a fixed order, `--dry-run`, the check-error seam (check.ts), the PDF_INPUT warning, and vacuity before any `--lock`.
- **#49: fake host and examples.** The fake host, the run after preflight with the rerun stage and cap stops, and `--example` in six modes.
- **The doctor pull request.** `doctor` without the image build, this page's caller doc, and DeepSeek V4.1 Flash beside particle-1 in the default policy.

## Seams for other units

- **U9 (trial module).**
  - Preflight takes a container runner as `PreflightOptions.runner` (vacuity's `ShellRunner`). Under the default `--isolation docker` and with no runner, preflight runs no task control and stops with E_ISOLATION_UNSAFE. Once U9 passes its runner from skill-eval.ts, the default works. `--lock` still runs controls with vacuity's local runner; switch it to the container runner too.
  - Report each check through `judgeCheck(result, workDir)` in contract/check.ts. Exit 2 and no exit code are errors. Exit 126 or 127 fails for a path inside the work dir and is an error otherwise.
  - doctor prints `skip trial image`; replace that line with the image build and its digest (E_IMAGE_BUILD).
- **U10 (adapters).**
  - `hostCheck` in skill-eval.ts returns the host step's stop. A real host returns E_USAGE today; return null once the adapter is ready.
  - `runFake` in run.ts is the shape of the run loop: arm-balanced rounds, the rerun stage when `rerunPlan` names a red task, and no round started past the cap. Replace `fakeRecord` with real sessions and keep `finishRun`, which writes the verdict through U6.
  - The verdict context in `runOnFakeHost` lists what a real run must fill: `host_version`, `adapter_sha256`, `image_digest`, `lease_id` and `approval`.
- **U21 (interface registry).** `SKILL_EVAL_FLAGS` is the machine-readable table: kind, variable, default, default rule, owner and whether it is built. Unbuilt flags are refused with E_USAGE naming their owner.

## Choices on the brief's open items

1. **Model policy.** Roles are subject, judge, adjudicator and usersim. The default allows Sonnet 5.5 as a subject only, and lists particle-1 and DeepSeek V4.1 Flash as OpenRouter subjects that are refused until the proxy routes OpenRouter. The CLI-wide Sonnet-judge rule was dropped: a caller's own `--policy` decides its judges.
2. **The default `--out`.** It is `<state>/runs/<run id>`: `~/.capy/work/gstack-evals/runs` on Capy, else the XDG state dir. It is never the OS temp dir or the tasks repo. E_INTERNAL lines, trace files and error records are scrubbed against the call's environment.
3. **The PDF flag.** PDF_INPUT is a warning. It names tasks whose prompt, setup, check, mutant or fixtures hold a PDF.
4. **buildLock.** It throws LockInputError on a bad tasks file or sidecar and reports the claims it dropped.
5. **Check errors.** check.ts decides how a check ended, as above. It is tested on real shells.
6. **The approved cap.** `--spend-cap` above the approved cap, or above what is left, is E_LEDGER_MISSING with the owner's words.
7. **GST-109.** Vacuity runs before the lock step in preflight, and `--lock` refuses a set that fails it.
8. **U5's codes.** Only the texts of E_TASKS_INVALID and LOCK_DRIFT were edited. U7 added E_MODEL_POLICY, E_HOST_CLI and PDF_INPUT.
9. **One flag table.** All commands share `SKILL_EVAL_FLAGS`; doctor filters it.

## Open

- When the proxy's OpenRouter route merges (GST-227, PR #50), `modelProblem` in policy.ts should ask the proxy's `routable(provider, model)` instead of refusing every OpenRouter row. The particle-1 and DeepSeek tests then flip to passes.
- The real-host run, `--calibrate`, `--resume`, `--repair`, `--mirror` and `--arms-file` wait on U9 and U10.
- `levels` (tokens per level) is null in every verdict until a tokenizer is chosen.
