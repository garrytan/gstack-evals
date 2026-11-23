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

## 2026-11-17: agent-skills' test-path rule no longer counts spec folders (section 8, after stage 0 froze the detectors)

The agent-skills bug-unit detector reads a write as a test by its path (TEST_PATH in sessions/exposure.ts). That rule
counted any file under a spec/ or specs/ folder as a test. The B1 delivery-route eval vendored this detector, and its
hand-check (GEVA-547) found the rule reading a Python source package as tests: in hdmf-1374, src/hdmf/spec/namespace.py
counted as a test write, so an Opus session's source edit read as a test write. #361 (d3614c4) dropped the folder rule
there and kept spec-named files as tests. This change makes the same edit here: a spec or specs folder is no test by
itself, and a spec-named file (x_spec.rb, x.spec.ts, x-spec.js) still is. Only agent-skills' bug-unit procedure reads
TEST_PATH, so no other arm's reading can move.

Trade-off. A helper under a spec folder that is not named as a spec (spec_helper.rb, spec/support/*.js) now reads as a
source edit, not a test write. The O frame holds no Python or Ruby units; about half of B2's frame is npm, where some
repositories keep test helpers under spec/.

Effect so far. Read both ways on every session to date (stage 0's 25, the rerun's 25 and the pilot's first 60), no
reading changes, and no tool call in any of those sessions names a spec/ or specs/ folder. The pilot's remaining
sessions are read the same way before its readout, which reports the count by arm.

Checks. A new keyless test in tests/outcome-skills/h2h-exposure.test.ts fails on the old rule and passes on the new: a
source edit in a spec package after a failing test reads as procedure ran, an edit in a spec package before any test no
longer counts as the test, and spec-named files under spec/ and specs/ still count. Ruling: GEVA-2 ("If it does, apply
the same fix test-first, with both-direction fixtures, and rescore").
## 2026-11-17: Claude Code's refusal fallback reads as a safety stop (section 7 step 6, after the pilot, before stage 2)

Section 7 step 6 scores a provider safety-filter stop as no fix, counted per arm, with no retry. session.ts found that
stop only as stop_reason "refusal". Claude Code 2.1.325 does not stop there: when Opus 5.5's safeguards flag a request,
it switches the session to another model (system notice model_refusal_fallback) and retries. The metering proxy refuses
every model but the one under test, so the switched request fails with E_ALLOWANCE, the turn ends as an error result,
and session.ts read it as an upstream end: one retry, then a gap.

In the pilot this hit one B2 unit, patriksimek__vm2-ghsa-x965-fc75-jpqh, in all 7 primary arms. All 14 attempts drew
the cyber safeguard on the first request and became gaps (gap rate 1 in 12 per B cell). Read as built, a pack that trips
the filter mid-session would lose that unit from its contrast instead of scoring no fix, and 7 such units in 60 would
make every B row incomplete.

The change. withRefusalFallback in sessions/session.ts marks an attempt's summary when its sdk-messages.jsonl holds the
model_refusal_fallback notice, and endOf reads the mark as safety_stop: no retry, no gap, scored as no fix by the
existing rule in score/score.ts. The notice counts wherever the transcript holds it, a subagent's included, and it wins
over a harness error that ends the turn after it (found by the advisory read); a failed proxy finalize still halts the
session, and an allowance stop still reads as one. run.ts passes each attempt's summary through it. Claude Code stays at its defaults
(the fallback switch is left on), and the model under test is never swapped.

Checks. A new keyless test in tests/outcome-skills/h2h-session.test.ts fails on the old rule and passes on the new: the
recorded shape of a refused fallback (403 E_ALLOWANCE error result plus the notice) reads safety_stop with no retry and
no gap; the same summary without the notice still reads upstream and gaps on its second attempt; an ordinary provider
error (529) still reads upstream; a harness error after the notice reads safety_stop and without it infra; a completed
session with the notice reads safety_stop. Read both ways on every
recorded attempt (stage 0's 25, the rerun's 25 and the pilot's 199): exactly the 14 vm2 attempts change, upstream to
safety_stop, and no other attempt's end moves.

Effect on the pilot. The 7 vm2 sessions re-read as safety stops (both attempts kept, since both ran and spent $1.62 in
all). The pilot is re-read into a second sealed file beside the first; both digests are in the run record. Exposure
counts scored sessions, so tstack's B procedure rate moves from 9 of 11 (82%) to 9 of 12 (75%), because its vm2 session
never loaded the pack. Ruling: GEVA-2 (option 1, under R95: a model under test is never swapped, and its refusal is a
result).
