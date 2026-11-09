---
id: 2026-11-09-geva-422-public-wording-cleanup
kind: decision
title: A one-time wording cleanup of merged posts for public readers, allowed by waiver rows
summary: The owner directed a one-time wording cleanup of merged posts before the repo opens. Each edited file needs a waiver row with its before and after sha256; a later edit fails again.
author: GEVA-422
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-09
status: done
links:
  - GST-1060
  - wiki/README.md
  - AGENTS.md
  - scripts/wiki.ts
---

# A one-time wording cleanup of merged posts for public readers

## The ruling

The repository owner directed a one-time wording cleanup of merged wiki posts for public readers, done before the repository opens to the public.

## What changes

- Owner quotes become neutral paraphrases.
- Private project names and Captain names become generic labels.
- Cost figures in findings move into a collapsed Agent notes block at the end of the post. A cost comparison that is the lesson of a finding stays where it is.
- No number and no verdict changes. The edits change wording only.

## How the check allows it

A merged post stays immutable. The one exception is an edit with a waiver row in a tab-separated file, `wiki/edits/<name>.tsv`. Each row names the edited post, its sha256 before the edit, its sha256 after the edit, and a reason. `bun run wiki:check` passes a changed merged post only when a row added in the same change matches its path and both digests, so any later edit to that post fails again. A row that matches no edit in its change fails, and so does a row that names a data attachment or a waiver file, or one that changes a bundle's attachment names. Removing or renaming a merged file still fails, whatever the rows say. The rule is in [README.md](../README.md), rule 2.

## What stays

The older wording stays in git history. `git log` and `git show` print any post as it was first merged.
