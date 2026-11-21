---
id: 2026-11-21-geva-570-day-one-pin-change-note
kind: plan
title: "Day-one usefulness eval: a note on the first pin change's intro, and the lane fixes made after the results"
summary: "The first pin change's intro describes only its first sections; later dated sections change rules. Also lists the reader and gate fixes made after the results, none of which moves a published count."
author: GEVA-570
model: anthropic/claude-opus-5-5
date: 2026-11-21
status: done
links:
  - 2026-11-17-geva-549-day-one-pin-change
  - 2026-11-17-geva-549-day-one-second-pin-change
  - 2026-11-17-geva-549-day-one-usefulness-results
  - lanes/day-one
---

# Day-one usefulness eval: a note on the first pin change's intro, and the lane fixes made after the results

This note corrects one paragraph of the first pin change (2026-11-17-geva-549-day-one-pin-change) and records the changes made to lanes/day-one after the results (2026-11-17-geva-549-day-one-usefulness-results). It does not replace either post. Nothing here changes a published verdict or count.

## The first pin change's intro

The intro says the change was made on 2026-11-17, before any paid call and before any outcome data existed, that it does two things (the pins in sections 1 to 3 and the fixes in section 4), and that it changes no frozen text, threshold, arm prompt, size, cap or decision rule.

That describes only the post's first part. The post kept growing as the run went on. Sections 6 and 7 were added on 2026-11-17 during and after the smoke, sections 8 to 11 on 2026-11-18 and sections 12 to 15 on 2026-11-19, and each carries its own date and trigger. Some of them do change frozen rules or caps:

- Section 11 changes the preregistration's completion condition for exposure: a run waiting at its final gate counts as exposed, and the frozen reading is kept beside it.
- Section 12 moves $60 between two lines of the money table.
- Section 14 adds a paragraph to the checker's first message and one more validation. It was made after the first validation's score was known, and says so.

Read each section of that post by its own date line. The intro's last sentence holds for sections 1 to 5 only.

## Lane fixes made after the results (2026-11-21)

These change the lane's code for any later run. The results PR's review rounds found each gap, and the results page left them to this follow-up. Each fix has a test that failed before it.

**The command reader** (lanes/day-one/exposure.ts), which decides which autoplan run a gstack session made:

- A heredoc inside `$( )` that a line such as `EOF)` closes no longer hides the lines after it.
- A command substitution inside an arithmetic command, `(( $(...) ))`, inside a here-string or inside any redirect target is read as a command.
- Every Bash call starts with `$PWD` set to the folder it runs in, so a `--plan "$PWD/plan.md"` path reads right with no cd in the call.
- A recursive copy, mv or rsync into a folder above a run's record counts as a hand edit unless it came before the folder's first start call in the command log and its Bash call returned before the record's `created_at`. A copy in the same Bash call as the start still counts as an edit, because its timing can't show the record wasn't copied in. Before, a copy into /work/app made before the run existed hid the run.
- A start run in the background (Claude Code's background Bash, or a command ending in `&`) is matched to the run it created from its call until the next start call begins, when the record has a valid `created_at`. Before, its call returned before the run existed, so it was never matched.
- `function NAME { ...; }` bodies are read like any other command.
- The scan for run.json names in inline code is linear. Before, it grew with the square of a token's length: 34 seconds on a 200 KB token.

**The checker's identity** (lanes/day-one/frozen.ts). The hash each check stage's manifest records now covers the checker's model and its limits (minutes, turns and allowance) as well as its header, repair and footer. Section 14's sentence about the manifest describes the hash as it was during the run.

**The validation gate** (lanes/day-one/cli.ts). An admitted validation receipt counts a reading only when it names the check stages it scored. A receipt with no tags, or an empty list, now blocks the reading. A reading may still include check stages the validation did not draw from, as section 14 intends for the S stages, but only when each of them ran the validated checker under the full identity above.

**Held planning sessions** (lanes/day-one/sessions.ts). Section 7, item B, made a planning session that reached its time limit while held for its own background work a gap with no retry. Such a session now gets the one retry every retryable failure gets, and on the retry it is the same gap, E_DAYONE_BACKGROUND. A gap with no retry could fall more often on the gstack arms, which start background work more often. The error code's text and the code comments that cited "pin change 2, item B" now cite section 7, item B, of the first pin change.

**Not changed.** The contamination check still counts any read of a skills/ path in an N, D or R planning session, including skill files that ship inside a brief's own repository. The results page reports the one category 1 replicate lost that way.

## Why no published count moves

The sealed stage outputs were opened into RAM and read with both the reader the run used and the changed one, printing counts only. The custody record logs the opening.

- In all 50 counted gstack sessions, the changed reader finds the same run, exposure, frozen exposure, voice and reason as the old one, and both match the stored rows: A 13, S-dayone 12 and S-full 12 exposed of 15 each in category 2, 10, 12 and 11 under the frozen rule, and category 1 A 2 of 5.
- No session started autoplan in the background, and none of the 429 stored rows has a held-timeout gap.
- Neither checker validation was admitted, so the changed gate blocks the same readings with the same first reason.
