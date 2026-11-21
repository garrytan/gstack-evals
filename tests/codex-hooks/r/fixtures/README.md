# Part R detector fixtures

Each folder is one session as the Codex agent copies it out of the task container: `codex-sessions/` (every rollout under
`$CODEX_HOME/sessions`) and, in the gstack arms, `gstack-hooks/hooks/skill-route.log`.

They were written by real Codex 0.170.0 (`codex exec`) in the part R arm build image (`lanes/codex-hooks/r/arms/Dockerfile`,
target `build`), with the r-on, r-off or r-none home from that build. The model was a local stub of the Responses API that
plays a fixed script per scenario, so no model was paid and every tool call is the stub's: the stub reads the `[fx:<name>]`
tag in the prompt and returns the calls listed below. The gstack hook ran for real on every r-on prompt.

| Folder | Arm | What the stub did |
|---|---|---|
| direct | r-on | `cat ~/.codex/skills/prove-it/SKILL.md` as its first call |
| code | r-on | a code-mode `exec` cell running `sed -n 1,80p` on prove-it's file |
| fail | r-on | `wc -l` on prove-it's file (names it, prints no line) |
| grepdesc | r-on | grep for the `description:` lines of every skill (front matter only) |
| two | r-on | one code cell that reads prove-it and gstack-verify and prints only gstack-verify's text |
| verify | r-on | `cat` of gstack-verify's file |
| late | r-on | `ls`, then `cat $CODEX_HOME/skills/prove-it/SKILL.md` |
| inject | r-on | a prompt holding `$prove-it`, so Codex injected the skill as a `<skill>` user message |
| named | r-on | no call; its answer says "prove-it" |
| sub | r-on | `spawn_agent` and `wait_agent`; the sub-agent reads prove-it's file |
| route | r-on | B1's prompt for one SWE-rebench task, no call |
| route-off | r-off | the same, in the home without the hook |
| none-direct | r-none | `cat` of prove-it's path, which doesn't exist there |

To keep the folder small, each rollout line was trimmed on copy: `additional_tools` lists are
emptied, `session_meta.base_instructions` and `world_state` are replaced by a marker, and a developer or user message
text over 4,000 characters is cut to its first 200 characters plus `[trimmed N chars]`, unless it holds `<skill>`. Tool
calls, tool results, assistant messages and the hook's developer message are unchanged.
