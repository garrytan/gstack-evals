# Deviations from the head-to-head preregistration

The preregistration (wiki/plans/2026-11-15-geva-538-skill-pack-h2h-prereg, #349) is frozen. Each change made after it
froze is listed here with its date, the section it changes, the ruling and whether any outcome had been read. Stage 0's
outcomes stay sealed and were not read for any change below; no stage 1 or stage 2 session had run when any was made.

## 2026-11-15: the gstack family runs on stage 0's pins record (section 3, pre-data)

The gstack-family homes rebuilt at stage 0 could not reproduce the home hash frozen in arms-pins.json. Only the git pack
bytes differ: HEAD's tree (3758f84f) and the sorted object list are the same in all five installs. The smoke and the
pilot run with stage 0's pins record, which holds that evidence for every gstack-family install. Ruling: A1, GEVA-2.

## 2026-11-15: two code changes after the go, before any outcome (pre-outcome)

304a1e49 reads the containment base filter's blob stream as text, so a binary blob no longer hides base markers.
b54f6f4e sends the browser-only (B1) labels under the h2h-labels item through the state machines sender, and edits that
lane's shared send.ts.

## 2026-11-15: B1 futility stop (section 6, pre-outcome)

1a82119d stops the browser-only pool's gate walk once it can no longer reach its minimum, and fills the breadth pilot's
slots from the security pool (B2). Frozen at 19:37Z, before the next B1 result. If it fires, the results say why B1 was
called infeasible, that browser-only bugs and the /qa secondary arm are untested (not a null), the roughly 5% risk of
calling it early, and the drop reasons by class. Ruling: A2, GEVA-2.

## 2026-11-16: Claude Code's todo tools on in every arm (section 3, pre-data)

What changed. Claude Code's environment sets CLAUDE_CODE_ENABLE_TODO_TOOLS=1 in all nine arms, the no-skills arm
included (claudeEnv in sessions/run.ts). Nothing else in the environment moved.

Why. The pinned Claude Code (2.1.325) gives Claude Opus 5.5 no todo tools unless a session opts in. Its docs say the
task-tracking tools are "available by default only on Claude Opus 4.7, Claude Sonnet 4.6, Claude Haiku 4.5, and earlier
models" (https://code.claude.com/docs/en/agent-sdk/todo-tracking#model-availability), and users report the same gate in
anthropics/claude-code#80487. None of stage 0's 25 sessions had TodoWrite or a Task tool. Superpowers' skills tell the
agent to track each checklist item as a todo, and section 8 reads Superpowers' procedure as its announcement followed by
a todo, so its procedure rate was 0 by construction and gstack against Superpowers could not be read in either class.
Section 3 runs "Claude Code as shipped"; this turns on a shipped feature that the default holds back from this model.

What the flag gives. Checked with no model call on the pinned binary: without the flag the session's tool list holds
Task and TaskStop; with it, TaskCreate, TaskGet, TaskList and TaskUpdate join them. TodoWrite stays absent. Section 8's
detectors already count TaskCreate as a todo, so no detector changes for this.

What the results say. Claude Code on Opus 5.5 ships without todo tools, and this eval turned them on in every arm so
Superpowers could run as designed. A Superpowers user on Opus 5.5 needs to know this.

Check. The 25-session smoke reruns at this change (item h2h-rerun) before the pilot, and its exposure is read with the
detectors below. Ruling: A1, GEVA-2.

## 2026-11-16: the agent-skills detector reads tests written through Bash (section 8, pre-data)

Section 8 reads agent-skills' procedure on bug units as "a failing test written before the source edit". The frozen
detector counted a test only when the Write or Edit tools wrote it, and a failing run only in a later Bash call. At
stage 0 it missed both agent-skills bug sessions: each wrote its test with a Bash command (a heredoc in one, an inline
Python edit in the other) and saw it fail in that same call before editing source.

What changed (procedureMarkers and its helpers in sessions/exposure.ts):

- A Bash command that writes a test file counts as the test write: a redirect or tee into a test path, or an in-place
  edit (sed -i, perl -i) or inline script that opens a file for writing and names a test file. A relative path is read
  from the cd commands before it in the same command. Output captures (.log, .out, .txt) never count.
- The failing run may be the call that wrote the test or any later call, still before the source edit.
- A run sent to the background counts where its output is read (a Read of its output file, TaskOutput or BashOutput
  naming its id, or its task notification), never at its launch.

Added after the smoke, with GEVA-2's approval once it had seen why: a compiler's error count ("5 errors and 0 warnings
generated") reads as a failing result. Without it the cc65 session still read as not run, because cc65 rejecting the
agent's new test printed no FAIL word and the agent echoed the exit status as a bare "1". Only agent-skills' detector
reads failing results; no other arm's procedure marker reads a test run's output, so no other arm needs the rule.

What did not change. The source edit is still read from the Write and Edit tools only, so a session that edits source
only through Bash still reads as not run. The feature-unit rule (SPEC.md and tasks/plan.md) and every other arm's
detector are unchanged.

Checks. Keyless fixtures run both ways in tests/outcome-skills/h2h-exposure.test.ts, including a test written after
the source edit, a test that passes before it, a background run read only after it, and failing runs of tests the
session did not write; all must read as not run. On stage 0's 16 bug-unit transcripts, read through the agent-skills
detector, the two agent-skills sessions now read as procedure ran, the other 14 read as before, and every arm's own
reading is unchanged. By hand: in the gstack-pony cc65 session the test was written through Bash after the source edit
and never failed, and in the no-skills gogs session the test was edited after the source; both still read as not run.
Ruling: B1, GEVA-2.

## 2026-11-16: the rerun smoke pays from a new item, h2h-resmoke (section 14, pre-data)

The 25-session smoke reruns at the two changes above. The ledger binds each item to one run, and h2h-smoke is bound to
stage 0's run, so the rerun needs its own item. h2h-rerun stays free for the independent recompute and re-score it was
planned for. h2h-resmoke is capped at $20, moved out of h2h-reserve (which drops from $200 to $180), so the program
total at caps does not change. The driver's model-item list (H2H_STAGES in sessions/driver.ts) gains h2h-resmoke,
paying for all nine arms; prereg.json's item list is unchanged. Ruling: GEVA-2.
