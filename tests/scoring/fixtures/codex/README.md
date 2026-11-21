# Codex rollout reader fixtures

Each folder is one session as Lane B's Codex agent copies it out of the task container: `codex-sessions/` (every rollout
under `$CODEX_HOME/sessions`, the root thread's and any sub-agent's) and `final.patch`, the diff the session left
(`git add -A && git diff --cached -M HEAD`).

They were written on 2026-11-21 by real Codex CLI 0.170.0 (`codex exec --json`, the binary from the npm
`@openai/codex@0.170.0-linux-x64` tarball, sha256 67c4bccce8e6c3a2b9ae0e586750e0efac7e0b8cd85e6b4734ad474317d2cc32, binary
sha256 880819aab735adcf16f36cd628940b9f1e652a36c01d10a5d32f83cc84902971), model `gpt-6.2-sol` at low effort, in an empty
CODEX_HOME, with approvals and the sandbox bypassed, against a local stub of the Responses API. The stub plays a fixed
script per scenario, chosen by the `[fx:<name>]` tag in the prompt, so no model was paid and every tool call is the stub's.
The commands ran for real in a small invented repository at `/testbed` (`pkg/mod.py` with an `add` that subtracts, and
`tests/test_other.py`), with pytest 8.3.4. `stub-model.ts.txt`, `make-fixture.sh.txt` and `trim.py.txt` are the stub,
the per-scenario driver and the copy step, kept as text so they never run in the test suite.

| Folder | What the stub did |
|---|---|
| direct | exec_command calls only: a heredoc writes the test, pytest fails, `sed -i` fixes the source, then pytest passes chained with grep and `python -c` |
| code | two code-mode cells (the `exec` tool), each running two commands: write the test and run it; fix and run it |
| patch | apply_patch adds the test; pytest fails; one apply_patch adds a second test and updates the source; pytest of tests/ passes |
| patch-first | one apply_patch adds the test and updates the source together, then pytest passes |
| patch-failed | the same patch with a stale hunk (an earlier version of the stub, whose hunk lacked the line's `  # sum`), which Codex refused (no FileChange item, nothing written), then pytest finds no test |
| move | apply_patch adds a test importing `pkg.calc`; pytest fails to collect it; an apply_patch with `*** Move to: pkg/calc.py` fixes and moves the source; pytest passes |
| sub | the root writes the test and sees it fail, then spawn_agent and wait_agent; the sub-agent patches the source and sees the test pass |
| bg | as direct, but the last run is still going when exec_command returns (a 250 ms yield), and a write_stdin call reads its output |
| bg-unread | the same, with no write_stdin: the background run is never read |

What these rollouts show about Codex 0.170.0:

- A command run from a code-mode cell has no function_call of its own. Codex records it only as an `event_msg`
  `item_completed` CommandExecution item with an `exec-<uuid>` id and `source: unified_exec_startup`, written before the
  cell's `custom_tool_call_output`, which holds only the text the cell printed.
- A direct exec_command's CommandExecution item has the call's `call_id` as its id. A background command's item is written
  when the process ends (in bg, while write_stdin waits), and in bg-unread it is never written.
- A patch's FileChange item has the apply_patch call's `call_id` as its id and lists its changes keyed by absolute path,
  in path order, not the patch's order; a move is an update with `move_path`. A refused patch has no FileChange item.

To keep the folder small, each rollout line was trimmed on copy as the Codex hooks fixtures are: `additional_tools` lists
are emptied, `session_meta.base_instructions` and `world_state` are replaced by a marker, and a developer or user message
text over 4,000 characters is cut to its first 200 characters plus `[trimmed N chars]`. Tool calls, tool results and
command and patch items are unchanged.
