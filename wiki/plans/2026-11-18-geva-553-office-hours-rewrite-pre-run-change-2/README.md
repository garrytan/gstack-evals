---
id: 2026-11-18-geva-553-office-hours-rewrite-pre-run-change-2
kind: plan
title: "Pre-run change 2 to the office-hours rewrite eval: the new skill's pin, and the current pin confirmed as its merge base"
summary: "Pins the new arm to the content change's ready head 4afa7f2, confirms the current pin is its merge base with gstack main, and re-reads the rewrite's inventory at that head."
author: GEVA-553
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-18
status: open
links:
  - wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg/README.md
  - wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-1/README.md
  - wiki/research/2026-11-18-geva-553-office-hours-rewrite-intentions-inventory/README.md
attachments:
  - 92517dc944894be137688946831ef0102e331b8a942b7afa46067a44cc42c3b7  pin-new.tsv
---

# Pre-run change 2 to the office-hours rewrite eval: the new skill's pin, and the current pin confirmed as its merge base

## In short

- The new arm runs gstack at 4afa7f2b3e291758f6a7842dd066cde22606fca1, the head of gstack's office-hours content change (gstack pull request 4468) that its owners named ready on 2026-11-18. The verdict this eval reaches applies to that exact commit and no other.
- The current pin, fc5c285035b58ce0552d25cf7cb71749795b6d30, is the merge base of that head with gstack main, so it stands unchanged. The eval measures the content change alone.
- The rewrite's intentions inventory was first read at 0787a1e, an earlier head. Three commits separate the two. They make the founder's own test fire on the right project, keep memos out of design-doc lookups and tighten two lines of wording. The inventory is amended in place to read at the new head. No main intention is added or removed, and no measure changes.

This change governs where it and the earlier posts differ. It changes no measure, arm, model, threshold or decision row. It is pushed before stage 1's first paid call.

## 1. The new pin

| Field | Value |
|---|---|
| Commit | garrytan/gstack 4afa7f2b3e291758f6a7842dd066cde22606fca1 |
| Branch | office-hours-partner-sessions |
| VERSION | 1.100.0.0 |
| Named | the content change's ready head, 2026-11-18 |

pin-new.tsv lists the bytes and sha256 of every file under office-hours/ at this commit, and of the same helpers pin-current.tsv lists, plus bin/gstack-design-doc-find. The skill files' byte counts:

| File | Bytes |
|---|---|
| office-hours/SKILL.md | 43862 |
| office-hours/SKILL.md.tmpl | 17868 |
| office-hours/sections/manifest.json | 2576 |
| office-hours/sections/phase-2a-startup-diagnostic.md | 16768 |
| office-hours/sections/phase-2a-startup-diagnostic.md.tmpl | 16634 |
| office-hours/sections/phase-2b-builder-brainstorm.md | 3429 |
| office-hours/sections/phase-2b-builder-brainstorm.md.tmpl | 3295 |
| office-hours/sections/phase-2c-pivot-discovery.md | 3454 |
| office-hours/sections/phase-2c-pivot-discovery.md.tmpl | 3323 |
| office-hours/sections/landscape.md | 2144 |
| office-hours/sections/landscape.md.tmpl | 2028 |
| office-hours/sections/design-and-handoff.md | 35348 |
| office-hours/sections/design-and-handoff.md.tmpl | 25953 |
| office-hours/sections/second-opinion.md | 11921 |
| office-hours/sections/second-opinion.md.tmpl | 181 |
| office-hours/sections/visual-design.md | 19055 |
| office-hours/sections/visual-design.md.tmpl | 37 |
| office-hours/sections/preamble.md | 23282 |

VERSION reads 1.100.0.0 at both pins, so each container checks every file hash after install. The current arm's container also checks bin/gstack-design-doc-find at the current pin: 2648 bytes, sha256 78823ce7660281ed57e20f91bf9b84bf8bb7365d00eb02bc09ba964758358f7b. Both arms then check the same set of helper paths.

## 2. The current pin is the merge base

`git merge-base 4afa7f2b3e291758f6a7842dd066cde22606fca1 origin/main` in a gstack clone fetched on 2026-11-18 returns fc5c285035b58ce0552d25cf7cb71749795b6d30, the current pin. In that clone, main (cbd21f942) was four first-parent commits past it, the first d3d35019a; none of the four touches office-hours/ or a helper either pin checks, and the content change has not merged main again. So the current pin stands, and change 1's inventory check of the current skill holds as written.

## 3. The rewrite's inventory at the new head

The inventory was read at 0787a1e01f2d847f8e915a680e7f6afec777be88. The commits from there to the new head touch office-hours/ and two helpers:

| Change | Where | Effect on the inventory |
|---|---|---|
| The kill check now takes the project slug from gstack's slug helper, and compares the due date with the machine's local date, not the UTC date. It refuses a missing slug. | 2A:3; DP:496-508 | N6 reads the same. The note on seeding a returning founder changes: the seeded slug must equal gstack-slug's SLUG for the session's work repo, and the seeded due date should sit at least two days before the session so the time zone cannot decide it. |
| Design-doc lookups skip memo files, so a later plan review never reads a memo as a design doc. | bin/gstack-design-doc-find:39-48 | X4 gains this citation. |
| "A real outcome outranks the conversation count: a founder with a named payer or user never takes the memo route." | 2A:11 | N3 is stronger. It now conflicts more plainly with the pivot route (2C:1), which sends a pivot to a memo whatever the traction; the inventory lists the conflict. |
| "Ask this ONE question first, even before the fully-formed-plan shortcut." | 2A:5 | N1 reads the same. |
| The commitment test's line is shorter. | 2C:11 | N4 reads the same. |
| The commitment entry's command tells the model to escape the test text. | DH:234 | N6 reads the same. |
| docs/skills.md describes the reality check, the memo and the kill line. | docs/skills.md | The skill does not load this file. |

SKILL.md, its template and every builder file are byte-identical between the two heads. The quoted questions and the named pushback patterns in phase-2a, phase-2c and design-and-handoff are the same at both heads, apart from the kill check's slug argument, so authoring's anti-pattern list stands and its vocabulary screen reads the new pin's files. So the inventory's counts stand: 18 main intentions, the current skill's 10 with eight changed, plus N1 to N8. No main intention is newly unscored or unlisted, so section 6's untested list is unchanged.

Neither the inventory nor change 1 has merged, and no paid call has run, so the inventory is amended in place to read at 4afa7f2 instead of by a new post. Change 1's section 6 said a new post would carry it. This change replaces that line.

## 4. What this means for the run

- Stage 1 and stage 2 run the new arm at 4afa7f2 only. If the content change's head moves before the results are ready, the run stops and the team decides. It is never re-pinned during the run.
- A seeded returning founder (T8) sets its project slug to the value gstack-slug prints for the session's work repo, and its due date at least two days before the session's date.
