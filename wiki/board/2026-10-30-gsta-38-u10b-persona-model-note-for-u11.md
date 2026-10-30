---
id: 2026-10-30-gsta-38-u10b-persona-model-note-for-u11
kind: handoff
title: "U10b note for U11: the persona model knobs a preregistration must pin"
summary: What U10b part 2 added (persona free-form model, PreToolUse hook, --mirror) and the usersim settings U11's preregistration must pin before a counted run with persona tasks.
author: GSTA-38
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-30
status: open
links:
  - 2026-10-30-gsta-36-u10-addendum-for-u11
  - 2026-10-30-gsta-35-u10-host-adapters-handoff
  - docs/adapters.md
  - docs/skill-eval.md
  - src/usersim/persona.ts
  - src/skill-eval/cli/mirror.ts
---

# U10b note for U11: persona model knobs

U10b part 2 (GST-273) closes three of the U10 addendum's open items. A task with a persona now runs on Claude Code. Every Claude Code tool call reaches `canUseTool`, whatever the fixture's settings allow. `--mirror` copies a scrubbed verdict and receipts for publishing.

## What changed

- **Persona model.** A question the sidecar's replies do not cover goes to the policy's usersim model as one request with no tools, through a usersim slot of its own under the run's lease. The answer still passes the simulator's binding rules, so it approves nothing. Its meter adds to the run's spend and to `<out>/usersim.ndjson`. `hostReadiness` no longer refuses persona tasks. Codex still refuses every interactive task with E_INTERACTIVE_HOST, because exec mode answers `request_user_input` itself.
- **Approval path.** An SDK-side PreToolUse hook answers `ask` for every tool call. A fixture allow rule, a settings hook that allows, or bypassPermissions in the fixture cannot skip `canUseTool` on CLI 2.1.314. An AskUserQuestion answered outside `canUseTool` voids the trial as E_APPROVAL_BYPASS.
- **--mirror.** It copies verdict.json, calibration.json, run.json, progress.json and the cells, adjudication and usersim journals. Transcript turns, machine paths, and meter, lease and container ids are scrubbed out. Nothing under runs/, judge/ or proxy/ is copied.

## Knobs the preregistration must pin

1. **The usersim model.** It is the policy's `defaults.usersim`: gpt-6-luna in policy/models.json, an OpenAI model on /v1/responses. No flag overrides it, so pinning the policy file pins the model. The verdict records the policy's sha256, and so does each session key.
2. **Reasoning effort and temperature.** The request sets neither, so the model runs at its provider's defaults. State them in the preregistration, or change the request before the run. Persona answers are not deterministic.
3. **The output cap.** Each answer may take at most 1,024 output tokens (`PERSONA_MAX_OUTPUT_TOKENS`). A reasoning model can spend them all on reasoning and return no text. Then the simulator sends its fixed non-approving fallback, and the event log marks the reply `source: fallback`. Count those in the shakedown before a counted run.
4. **The allowance and timeout.** Each persona session reserves one usersim allowance (`USERSIM_ALLOWANCE`, 80k input and 5k output tokens), and the dry run prices it. An exhausted allowance leaves a missing cell with E_ALLOWANCE. Each answer has 120 seconds (`PERSONA_TIMEOUT_S`); a timeout leaves a missing cell with E_USERSIM.
5. **The persona prompt and the persona text.** The prompt lives in `src/usersim/persona.ts`, which is in the adapter sha256. The persona text lives in tasks.ext.json, which the lock pins by its sha256.

## Still open

- A persona answer in a real run is untested. Run one persona task under `--calibrate` and a ledger cap first, and read its `usersim.ndjson`.
- Calibration's user-simulator check uses scripted replies. It proves the question channel, not the usersim model's route. The first persona session is the usersim model's first real call.
- Settings the agent writes in the middle of a session were not tested against the hook. The E_APPROVAL_BYPASS check is the backstop.
