---
id: 2026-11-17-geva-549-day-one-pin-change
kind: plan
title: "Day-one usefulness eval: the /autoplan arms' gstack pins and the fixes made before any run"
summary: "Pins A to gstack c5250ded and the strengthened /autoplan arms to their branch commits, lists the planning-skill changes since the prereg's pin, and records every fix made before the smoke."
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

# Day-one usefulness eval: the /autoplan arms' pins and the fixes made before any run

This is a dated change to the day-one usefulness preregistration (2026-11-17-geva-546-day-one-usefulness-prereg). It was made on 2026-11-17, before any paid call and before any outcome data existed. The merged preregistration stays as it is; this post and the code on the results branch carry the change.

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
