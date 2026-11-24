# Recorded requests

`codex-0.170-voice-request.json` is the first Responses request a gstack voice call sends, recorded keyless on 2026-11-24
for the review-models eval's proxy preflight (prereg 2026-11-24-geva-590, section 10 item 2; proxy-preflight.ts).

How it was recorded:

- Codex CLI 0.170.0 (`@openai/codex@0.170.0`, linux x64) ran the voice command from gstack's review/sections/adversarial.md
  at 284214fd896f493471b1bb5e98bcdc899a87bcdb, with its flags as written there: `codex exec - -C <unit> -s danger-full-access
  -c model="gpt-6.2-sol" -c skills.include_instructions=false -c web_search="cached" --json -o <text>`.
- Its HOME held the Codex config the rig writes for a cell's voice (codexConfigCommand in
  src/adapters/claude-code/driver.ts), so its provider was the metering proxy's route for a slot. The provider's base URL was a
  local stub of the Responses API that recorded the body and answered one message. No key was set and nothing was paid.
- The unit was a toy one-file repository and the prompt a planted toy adversarial line, not a real unit or gstack's prompt.

Trimmed on copy, as the Codex hooks fixtures are: message texts over 4,000 characters and tool descriptions over 400 are cut
to their first 200 characters plus `[trimmed N chars]`, and the recording folder's path is replaced by /work. Every key, tool
name and structure is as Codex sent it.

What it showed: the recorded request carries no web_search tool, so on this setup gstack's `web_search="cached"` reaches
the proxy as nothing to remove. The same held with the built-in openai provider, with a served model catalog and with each
web search feature flag Codex 0.170.0 names. The preflight therefore sends this request as recorded (it passes with nothing
removed) and with a web_search tool planted in the two places the hosted-tool rule reads (the top-level tools list and the
additional_tools item), where it passes with each planted tool removed.
