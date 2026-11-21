# Part L transcript fixtures

Real Claude Code 2.1.325 sessions, captured keyless on 2026-11-21 against a stub Messages upstream (no key, no model), with
gstack v1.102.1.0 (29bff55dd8a14b32ff282d5a37097e3a53e3250a) installed into a scratch HOME by its own `./setup --no-browser`,
`gstack-config set telemetry off`, and the extension's prereg.json parts.L.claude_md text as `~/.claude/CLAUDE.md`. The stub
answered every main-loop call with DONE (and, in fallback-feature, first with one Bash call to the start command).

- md-feature: `/autoplan <task>` with the l-gstack-md CLAUDE.md. The start step ran inline at load.
- task-bug: a bug task with the sentence after a blank line (l-gstack-task's T) and the l-gstack CLAUDE.md.
- fallback-feature: `/autoplan <task>` with gstack-skill-start made non-executable, so gstack-skill-load printed its
  `SKILL_START: failed at load` line and the session ran the start command with Bash.

Each claude-session.jsonl keeps only the user and assistant records of Claude Code's own transcript, with the expanded
SKILL.md cut to its preamble section through the start output. Each first-request.json keeps the first main-loop
request's model, the CLAUDE.md block of its first user message (cut after the CLAUDE.md text) and the user's own text;
the system prompt, the tools and Claude Code's other context blocks are left out. The scratch HOME path reads /root.
