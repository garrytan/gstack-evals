---
id: 2026-11-17-geva-549-day-one-pin-change
kind: plan
title: "Day-one usefulness eval: the /autoplan arms' gstack pins and the harness fixes"
summary: "Pins A to gstack c5250ded and the strengthened /autoplan arms to their branch commits, lists the planning-skill changes since the prereg's pin, and records each harness fix."
author: GEVA-549
model: anthropic/claude-opus-5-5
date: 2026-11-17
status: open
links:
  - 2026-11-17-geva-546-day-one-usefulness-prereg
  - lanes/day-one
  - https://github.com/garrytan/gstack/tree/c5250dedc1ef9398ff3f10519c17919aaae880dc
  - https://github.com/garrytan/gstack/tree/26f427d9ffca5ac3aac75e18945552af29b12550
  - https://github.com/garrytan/gstack/tree/439827d71d14292d8d5e32b4decf94bccd56a985
---

# Day-one usefulness eval: the /autoplan arms' pins and the harness fixes

This is a dated change to the day-one usefulness preregistration (2026-11-17-geva-546-day-one-usefulness-prereg). It was made on 2026-11-17, before any paid call and before any outcome data existed. Sections 6 and 7 were added the same day, during and after the smoke on the practice briefs, which are never counted. The merged preregistration stays as it is; this post and the code on the results branch carry the change.

It does two things. It pins the three /autoplan arms, A, S-dayone and S-full, to gstack commits (sections 1 to 3), and it adds three fixes to the lane's code before the smoke (section 4). It changes no frozen text, threshold, arm prompt, size, cap or decision rule.

## 1. The pins

| Arm | gstack commit | What it is |
|---|---|---|
| A | c5250dedc1ef9398ff3f10519c17919aaae880dc | gstack main. The preregistration pinned 5b4fa9ea335e3ba743a36e3269da95980b77b32d. |
| S-dayone | 26f427d9ffca5ac3aac75e18945552af29b12550 | Branch day-one-arm-d1-on-main: A's commit plus one commit, "Plan reviews start with what the owner does on day one" (32 files, 306 lines added, 126 removed). |
| S-full | 439827d71d14292d8d5e32b4decf94bccd56a985 | Branch day-one-arm-d2-on-main: S-dayone's commit plus one commit, "Cut the CEO review's copy of the engineering review" (22 files, 153 lines added, 591 removed). |

gstack's VERSION file reads 1.99.5.0 at all four commits, so the run logs shas, not versions.

A now includes gstack pull request 4431, the approval-page fix (section 2). S-dayone differs from A only by its one commit, and S-full differs from S-dayone only by its one commit, so S-dayone minus A reads the day-one block inside /autoplan, and S-full minus S-dayone reads the CEO-review cut. Both strengthened commits were checked against gstack's history: each branch head is the commit above, and each range holds exactly one commit.

In code, lanes/day-one/frozen.ts GSTACK_PINS sets all three pins. tests/day-one/frozen.test.ts used to check A's pin against the merged preregistration's text; it now checks all three pins against this post, because the merged preregistration can't change. The keyless dry run compares frozen texts, not pins, so it is unchanged.

The rig never fetches a commit (src/arms/install.ts stackTree). The runner host fetches all three commits into its gstack checkout before the smoke.

## 2. What changed in /autoplan and the plan-* skills between the two A pins

gstack main has 15 commits from 5b4fa9ea to c5250ded. Two of them touch the skill files of autoplan, plan-ceo-review, plan-design-review, plan-devex-review, plan-eng-review or plan-tune. The other 13 touch none of those folders.

1. **76fad3edd, "Make gstack agents lead every report with what failed, what's unverified and what else changed" (gstack pull request 4273).** It rewrites the shared preamble's closing-report rule. A status report now stays under 250 words and opens with three lines: what failed or was skipped, what is unverified, and what else changed. Mandated reports, the /plan-*-review reports among them, stay exempt, as before. The preamble's id moves from 227aca067dd3 to d56c99c92144, which changes one line of the same length in each SKILL.md. Files: SKILL.md and sections/preamble.md in each of the six folders (12 files, 24 lines added, 30 removed).
2. **c5250dedc, "Keep reviewer product challenges open on the approval page" (gstack pull request 4431), the approval-page fix.** In autoplan/DRIVER.md, the result format a reviewer follows changes: any finding that recommends changing a plan's scope, cost or direction now names that kind of change at any severity, and only the owner's own words (a plan's "Owner's words" section) count as the plan's direction. A plan with no such section keeps the old rule. The same line changes in the prompt code (lib/autoplan-prompts.ts), and the gate-building code under lib/ now keeps every reviewer challenge on the approval page as a proposal instead of dropping it. File: autoplan/DRIVER.md (1 line).

Neither commit changes the text of a main intention in the /autoplan intentions inventory the preregistration cites. The first changes how reports end. The second changes which reviewer proposals reach the gate, so it can change what the simulated owner sees there and which plan changes apply; A's results carry that behavior.

One more commit in the range touches a file /autoplan's second voice calls: bcece3fbc ("Make gstack's shell locks hold when mkdir reports a race it lost", gstack pull request 4262) changes how bin/gstack-codex-probe, the helper that picks and checks the Codex model, takes its cache lock, and nothing else in that file.

## 3. Loaded bytes to check at the smoke

Each figure is the size of SKILL.md plus every sections/*.md file in the skill's folder, read from gstack's git tree at the pin. They match the figures gstack's maintainers sent with the strengthened branch, all nine.

| Skill | A (c5250ded) | S-dayone (26f427d9) | S-full (439827d7) | A at the preregistration's pin (5b4fa9ea) |
|---|---|---|---|---|
| plan-ceo-review | 166,299 | 168,576 | 152,150 | 166,303 |
| plan-design-review | 129,857 | 132,638 | 132,638 | 129,861 |
| autoplan | 120,045 | 122,926 | 122,818 | 120,049 |

On both strengthened arms, the day-one block ("## Day one first (before any other step)") starts at byte 1,360 of plan-ceo-review/SKILL.md, byte 4,006 of plan-design-review/SKILL.md and byte 1,637 of autoplan/SKILL.md.

The smoke's loaded-skill log (lanes/day-one/exposure.ts loadedSkills) lists every skill file each session read. The run checks the bytes of those files at each arm's pin against this table and the block offsets. A mismatch stops both strengthened arms before they spend.

## 4. Three fixes before the smoke

The preregistration's last review left these as notes to fix before the smoke. Each is its own commit on the results branch, after the pin commit, with a test that fails on the merged code and passes after the fix.

1. **The gstack-read check runs only on N, D and R planning sessions** (lanes/day-one/sessions.ts). Section 8 of the preregistration freezes that check for N, D and R sessions. The code also ran it on build and check sessions, so a builder whose shell command named gstack while it read an /autoplan plan was marked contaminated and left unscored. That would drop A-arm builds. The check now runs where section 8 puts it.
2. **A planning resume leases only what the responder's line has left** (lanes/day-one/cli.ts and run.ts). The stage's own lease already took its cap or the line's balance, whichever is less. The responder's lease asked for the whole --owner-spend-cap every time, so a resume after an admission stop could be refused by the ledger. It now leases the smaller amount, and rounds are admitted inside that lease, the same way as the stage's own line.
3. **The voice bearer stays out of every exec argument** (lanes/day-one/sessions.ts and src/trial/sandbox.ts). Section 7's containment check compares the container's OPENAI_API_KEY with the voice slot's bearer. The code put the bearer into the docker exec command, so it showed in the runner host's process list and in Docker's exec events while the check ran. The check now sends the bearer on the exec's standard input and compares it inside the container; no form of it, a digest included, is in any argument. The bearer is a per-session proxy slot token; no provider key was ever in the container.

Before the smoke, one second-model read of just these three fix commits runs as an advisory check, not a review round. The results pull request's own review covers them in full.

## 5. What the advisory read found

The advisory read of the three fix commits returned two blocking findings and three notes. Each change below is its own commit on the results branch, made before any paid call. The first three have a test that fails on the code before them and passes after.

1. **A crashed launch's responder lease no longer blocks its resume** (lanes/day-one/cli.ts and lanes/product-value/meter.ts). Fix 2 read the responder line's balance before the meter settled the crashed launch's open lease. An open lease counts its whole reservation as committed, so the balance read zero and the new lease asked for nothing, which the ledger refuses as a cap stop. The meter now reads the balance after it settles the stale lease. The test covers a stale lease with no spend and one with some spend.
2. **A skill load marks an N, D or R planning session contaminated** (lanes/day-one/sessions.ts). Section 8 marks a session contaminated for any gstack read or skill load, but the code counted only tool calls whose path or command named gstack. It now also counts every entry of the session's loaded-skill log: a Skill tool call, or a Read of a SKILL.md or of a file under a skills/ folder. This gap was in the merged code; fix 1 did not cause it. N, D and R containers hold no skills, so the check should find nothing; as section 8 says, it is descriptive.
3. **The bearer check fails closed** (lanes/day-one/sessions.ts). The comparison now needs a successful read of a nonempty bearer, and the runner takes its answer only from an exec that exited 0 inside its time limit. Before, a lost stdin with an empty OPENAI_API_KEY in the container, or a timed-out exec that had printed the marker, could pass.
4. **A transport test for stdin** (tests/trial/sandbox-stdin.test.ts). Docker exec gets -i and the input on stdin only when there is input, bubblewrap forwards it too, and no argument holds it. The code was already right; the test fails if -i is dropped or always added, or if either sandbox drops the input.

One note stays a note. The keyless voice check (gstack-evals day-one voice-check, lanes/day-one/voicecheck.ts) still passes its stub bearers and a fake provider key as process arguments. It runs only against a local stub provider with a temporary ledger, so no paid-run credential is involved, and fix 3's claim covers counted sessions only.

## 6. Fixes made during the smoke

The smoke's first step, the fixtures with the real checker, stopped the wave: the reference app scored 0 of 5 tasks done. The placeholder also scored 0, but for the wrong reason. The two checker transcripts show the cause. In both, the checker's first call was ToolSearch, to load the browser tools. The session's tool limit refused it ("That tool is not available in this session"), and the checker wrote verdicts saying it could not reach the browser. No plan, build or check had run. Two harness bugs were behind the miss. Each fix is its own commit, with a test that fails on the code before it and passes after. A third fix came from the advisory read of the first two, and fixes 4 and 5 from the smoke's review stage, where no A session could start.

1. **A session limited to named tools gets them in its request** (src/adapters/claude-code/driver.ts). Claude Code 2.1.314 defers MCP tools behind its ToolSearch tool: the request carries only a placeholder, and the model must call ToolSearch to load them. The checker's session allows only its 18 browser tools, so that call was refused and the session never saw a browser. The driver now also disallows ToolSearch for such a session, unless its list names it, and Claude Code then declares the MCP tools in the request. The new test (tests/adapters/only-tools.test.ts) runs the pinned CLI with no key against a stub MCP server. It checks that the request declares every browser tool and no ToolSearch, that the first browser call reaches the server, and that the session completes.
2. **A replayed tool call with a url argument is priced** (src/runner/pricing/prices.ts). With fix 1 in, the test session's next request was refused E_ALLOWANCE. The metering proxy read browser_navigate's url argument, inside the model's own replayed tool call, as a remote file the provider would fetch. The provider never fetches a client tool call's input, so the check now skips it. A url image source or a remote image_url elsewhere in the same request is still refused. The real checker would have hit this on its first page load.
3. **The skip holds only inside a content list** (src/runner/pricing/prices.ts). A cross-family advisory read of fixes 1 and 2 found that fix 2 also skipped the input of a request body, or of an OpenAI input item, typed tool_use. A body could then hide a remote image in its input and reach the free count route unchecked. The skip now applies only to a tool_use block in a content list, and the test covers both shapes. This changes no checker request: its tool calls are content blocks either way.
4. **A gstack arm's home is streamed into its RAM-backed HOME** (src/trial/sandbox.ts). Every A session in the smoke's review stage failed before its agent started. The A image's home holds the whole gstack install, 1.2 GB, and the sandbox read its archive into memory before copying it in, which Node refuses past 1 GiB. The copy now streams from one container to the other, and a failed copy still stops the session. The N, D and R images have an empty home, so their sessions never hit this. The new test streams 1.2 GB through a stub docker client.
5. **A gap names its cause** (lanes/day-one/sessions.ts). When a session failed before its agent started, its row said only that the containment probe could not run. The row now adds the trial's own reason, so the results can say why each gap happened.

Neither check before the smoke could catch these. The keyless fixtures use a scripted checker that drives the browser server directly, with no Claude Code session and no proxy. The dry run checks the tool list the driver is given, not the request the CLI sends. Under the preregistration a failed fixture stops the wave for a decision; the run record logs that decision and any rerun.

## 7. Two changes after the A smoke

Dated 2026-11-17. Both changes come after the smoke's A sessions on the practice briefs and before any counted session. They also come before the second pin change, which will re-pin A and the strengthened arms on a gstack fix for the second-model review. Each change has tests that fail on the code before it and pass after. Both cover the strengthened arms too: they run through the same session code as A.

**A. Which autoplan run counts** (lanes/day-one/exposure.ts, lanes/day-one/run.ts). /autoplan ran in all three of the smoke's A sessions, but the harness found none of the runs. Each run's record sat where the session's own `gstack-autoplan next --out` call put it, /work/app/.gstack/tmp/autoplan/run. The harness looked only in the state root, /work/app/.gstack-home. So no A session read as exposed, and the live check that hands a waiting gate to the owner never fired. The rule now:

- A run.json anywhere in the work tree, the state root included, counts only when the session's own command log holds the gstack-autoplan call that wrote it. That call's --out must be the run.json's folder and its --plan must be /work/app/plan.md. The record's plan_input must also be /work/app/plan.md.
- A record the session wrote or edited any other way never counts. That covers the Write and Edit tools, a shell redirect, tee, sed -i, cp, mv and an interpreter's inline write.
- Exposure and the live gate check read the same record. Of the records that count, the newest wins.
- The command log is read as shell. Variables the command sets are expanded, and relative paths resolve against the folder the last cd left.

The new tests (tests/day-one/run-record.test.ts) cover four cases:

- a real --out record in the work tree is found;
- a record in the state root is found;
- a planted run.json with no matching call is refused, and so is one edited after the call;
- a record for another plan file is ignored.

On the smoke's three A transcripts, the rule finds all three runs. Two of them wait at the gate, and one stopped in its CEO phase. The dry run's exposure case now also checks that a planted record does not count.

**B. Planning sessions wait for their own background work** (lanes/day-one/sessions.ts, lanes/day-one/run.ts). One A session started its second-model review as a background task, said it would wait for the result, and ended its turn. A session that gets no reply ends at its turn's result, so the review was cut off and the run stopped in its CEO phase. Planning sessions now stay open while background work they started still runs, through the driver's existing hold.

- The hold works the same way for every arm: N, D, R, A and both strengthened arms.
- It lasts at most the session's own time limit.
- A session that reaches the limit while held becomes a gap row, E_DAYONE_BACKGROUND, with no retry.
- Builds and checks do not hold. They are scored on the tree and in the browser, and a dev server left running would turn every such build into a gap.

Of the smoke's 23 sessions, only that one A session ended with background work still running. No N, D or R session did, and nothing reruns. The new tests are in tests/day-one/hold.test.ts.

**What the advisory read found.** One cross-family read of both changes (GPT-6.1 Sol, read-only) reported eight blockers and one note. All eight were fixed test-first in one commit, with no second read:

- The command log missed real calls in some shell shapes: behind a wrapper (env, command, exec, timeout and others), inside a command substitution, or inside eval or a bash -c string. A cd inside a subshell or in a subagent's shell also moved the main agent's folder, and `${X:-default}` and escaped dollars expanded wrongly. The command log now reads all of these.
- A read-only Python command that wrote to stdout refused the record. Interpreter code now counts as an edit only when it opens a file for writing.
- Edits made through env, eval or bash -c were missed. They are now read.
- A call that only asked for help counted. Only next and run calls start a run now.
- A symlink loop in the work tree stopped the scan, and a symlinked folder read differently live and after the copy-out. The scan no longer follows symlinks, which matches the copy-out.
- A held session that reached its deadline retried when its containment probe could not run. The deadline gap now comes first.

Three limits remain, kept as notes:

- A call that is written but never runs, such as one after `false &&`, or another program named gstack-autoplan, still counts.
- Interpreter code that builds the record's path at run time, without naming run.json, is not seen as an edit.
- An edit made through a symlinked path is not seen.

A held session whose RAM-backed mount fills still retries as an infrastructure failure. The full mount may be why its work never finished.

## 8. A change after rep 3 of the smoke (2026-11-18)

**The run-record rule now follows a plan the session revised under another name** (lanes/day-one/exposure.ts). In rep 3, `gstack-autoplan revise` refused plan.md because it had no `## Implementation plan` section, though the first `next` had accepted it. One A session then wrote plan.md under that heading to `<run folder>/plan-v2.md` and revised that file, so gstack recorded the copy as the run's plan_input. The rule in section 7 counted a record only when its plan_input was /work/app/plan.md, so it passed this one over. The live gate check reads the same record, so it saw no waiting gate after round 2. The owner was never asked, and the session read as not exposed, though Astra completed in all four phases.

The rule now also counts a record whose plan_input is a file inside the run folder or /work/app, when the session's own `gstack-autoplan revise` call, with the record's folder as its --out, named that file as its --plan. Everything else in section 7 still holds: the run must start from a next or run call with --plan /work/app/plan.md, and a hand-edited record never counts. The rule does not depend on the arm. These are still passed over:

- a plan_input outside both the run folder and /work/app;
- a run that did not start from /work/app/plan.md;
- a file named by anything but the session's own revise call for that folder, such as a copy, a next call, or a revise call for another folder or another file.

**The arm's plan follows the same file.** The build reads the arm's plan, and the plan-amended check compares it with the base plan. When a counted record's plan_input is a revised file other than plan.md, the arm's plan is now that file as it stands at the session's end. Before, it was plan.md whenever plan.md differed from the base. In rep 3's third A session the two agree: plan.md held the 58 changes accepted at the round-1 gate, and plan-v2.md is the heading followed by that same text, so its build would have read the amended plan either way. A session that edited only the wrapped copy would have been built from a stale plan.md. A wrapped copy differs from the base by its added heading even when nothing else changed, so for such a session the smoke's plan-amended check compares the text under that heading with the base plan.

The new tests are in tests/day-one/run-record.test.ts. On the tree before the change, the wrapped-plan test fails. Each still-passed-over case fails when the rule is widened past it: with no folder check, with no revise check, with any call that names the file, or with no start check. One cross-family advisory read of this change runs alongside rep 4 of the smoke. Exposure is read from the records, so if the read moves a classification, rep 4's rows are re-scored from their records with no new sessions.
