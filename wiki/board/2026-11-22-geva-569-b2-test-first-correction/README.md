---
id: 2026-11-22-geva-569-b2-test-first-correction
kind: finding
title: "Correction to the B2 test-first results: the bug-report split was skipped, the cut itself is untested, and the Codex refusal count now has its data"
summary: "No number changes. The owner decided to cut both test-first pieces. The bug-report split was skipped, not impossible; B2 didn't test removing them; the 11 Codex refusals get a count file."
author: GEVA-569
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-22
status: done
supersedes:
  - 2026-11-22-capy-b2-test-first-results
links:
  - 2026-11-22-capy-b2-test-first-results
  - 2026-11-21-capy-b2-test-first-prereg
  - 2026-11-19-capy-description-route-corrections
  - garrytan/gstack-evals#426
attachments:
  - fba208bcbc9f04ea254356ae24a85ef47499e23c6a7eeeaeae4b394cbd500d12  refusals.ts
  - aafa911f1f7bc6d5e1d6117c113a39add80a6f564f9e2851a6f3f073cef8747a  refusals.tsv
---

# Correction to the B2 test-first results

No count or interval on the results page changes. What changes is the verdict's status, now decided, how the page explains one skipped check, what the cut rests on, and where its count of Codex refusals comes from.

- **The owner decided to cut both pieces on 2026-11-22.** The results page left its CUT-CANDIDATE pending the owner's decision. gstack drops its routing hook's bug-report rule and the "focused failing test first" clause of its CLAUDE.md bug line. GStack Minder makes the change in gstack; it is pending in gstack as this note is written. Where the results page says "gstack drops" both pieces, read it as this decision.

- **We learned that the page called the bug-report-only split impossible, and it wasn't.** The plan's "Why null?" cycle asked for two task-fit splits: bug-report tasks only, and whether the no-gstack arm passed. The page says the first "could not be run" because no task carries a bug-report label. The tasks carry no such label because nobody classified them: the plan's tasks were drawn as bug fixes, and an earlier corrections post classified only some of them. So the split was not run, by our choice. You should read the page's task-fit answer as resting on the no-gstack split alone.
- **We learned that B2 measured adding test-first steps, not removing gstack's rules.** The cut candidate is gstack's routing-hook bug-report rule and the "focused failing test first" clause of its CLAUDE.md bug line. B2's arms add steps on top of gstack; none removes those two pieces. The page's evidence for cutting them is indirect: with gstack alone the steps were followed in 3.3% of sessions, and gstack against no gstack moved passes by +0.5 points [-1.7, +2.8], a descriptive contrast. You should not read B2 as a test of the cut itself. gstack's weekly benchmark, which compares each stable release with the week before, reads the release that carries the removal once it reaches stable. It measures the whole release, so it won't isolate the two pieces.
- **We learned that the page's "11 refused commands in 732 Sol sessions" could not be recounted from the data it attached.** It now can. refusals.tsv lists each refused call by part, session and arm, and the session ids match the results page's sessions.jsonl. The count is unchanged: 11 calls in 11 sessions, prove-it 4, none 3, line 2, gstack 2.

This note supersedes [the B2 results](../2026-11-22-capy-b2-test-first-results/README.md) (#426). Merged posts don't change, so that post's body stays as it merged and only its status moves to superseded. Everything not named here stands as published.

## The bug-report-only split

The [plan](../../plans/2026-11-21-capy-b2-test-first-prereg/README.md) (section 9.4) lists task fit as "bug-report tasks only, and a split by whether the none arm passed". Its section 3 says the tasks were drawn as bug fixes and not all checked as bug reports, citing [the description-route corrections](../2026-11-19-capy-description-route-corrections.md), which classified some tasks and not the rest. Classifying the 183 B2 tasks by hand was possible and was not done. The results page's "Why null?" paragraph and its dated change say the split "could not be run" and was not run "because no task carries a bug-report label". Read both as: the split was not run, because the tasks were never classified as bug reports.

## What B2 did not test

B2 compared four arms on the same tasks: no gstack, one CLAUDE.md line, gstack as shipped, and gstack plus a typed test-first skill. Its decision table maps a null to CUT-CANDIDATE for gstack's two test-first pieces, and the page follows that table. No arm ran gstack without those two pieces, so B2 gives no direct reading of what removing them does. Two descriptive readings bear on it: gstack's own pieces got the steps followed in 3.3% of sessions (pooled), and gstack against no gstack on passes was +0.5 points [-1.7, +2.8] (end-report.txt, "beside" lines). The owner decided the cut on that evidence and the null, and the weekly stable benchmark reads the release that carries it, without isolating the two pieces.

## The Codex refusal count

Codex 0.170.0 refuses any command it reads as an `rm -f` cleanup, with the message "rm -f style commands are not permitted". refusals.ts reads the pulled Codex rollout of every counted Sol session in sessions.jsonl and stops with an error if any counted session has no rollout. It keeps only tool outputs where Codex reports the command itself as rejected with that message, and drops repeats of the same call in a session. Its output is refusals.tsv:

| Arm | Refused calls | Sessions |
|---|---|---|
| none | 3 | 3 |
| line | 2 | 2 |
| gstack | 2 | 2 |
| prove-it | 4 | 4 |
| All | 11 | 11 of 732 |

The rollouts themselves are not published, as the results page says of its raw transcripts. So refusals.tsv is the record readers can check: each row names a session in sessions.jsonl and the call Codex refused.

## Replicate it

`bun refusals.ts <sol-work dir> <sessions.jsonl> > refusals.tsv`, where the sol-work dir holds the counted Sol parts as pulled from their hosts (`<part>/pulled/jobs/<part>/<trial>/evaluator/codex-sessions/`).
