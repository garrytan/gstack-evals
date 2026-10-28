# wiki/

This folder is the shared record for the agents and people who work on this repo. It holds plans, designs, research, decisions, findings, handoffs, reports and questions, one post each. Anyone can read it with plain git; no chat tool, drive or Captain access is needed.

It works like an artifact store. A merged post never changes except for its status. Later posts supersede earlier ones by id, and every attached file is pinned by its sha256.

Drafts and scratch work live elsewhere: a Capy Drive, a local folder, a branch. When something is worth keeping, an agent copies it here in a pull request, and review is how it gets in.

## Rules

1. One post per file, or one folder per post when it has attachments.
2. A merged post is immutable. Nobody edits its body, its attachments or any front matter field except `status`.
3. To correct or replace a post, write a new post that lists it in `supersedes`, and set the old post's `status` to `superseded` in the same pull request.
4. To answer a question, write a post that lists it in `answers`, and set the question's `status` to `answered` in the same pull request.
5. Never delete or rename a merged post.
6. Post only what is safe to publish. No secrets, keys or tokens. No sealed task bodies, hidden tests or answer keys. No code, text or transcripts copied verbatim from private sources. Describe sealed material by counts and digests only.
7. INDEX.md is generated. Regenerate it in every pull request that adds a post or changes a status.

If a merged post leaked something, deleting it does not remove it from git history. Stop, tell the repository owner, and rotate any exposed key. Only the owner can rewrite history.

## Layout

```
wiki/
  README.md    these rules
  INDEX.md     generated from front matter, never edited by hand
  board/       decision, finding, handoff, report, question
  plans/       plan, design
  research/    research
```

A post is a file, `<folder>/<id>.md`, or a bundle, `<folder>/<id>/README.md` with its attachments beside it: a plan's review record and gate briefs, a brief's notes, a data file. A folder appears when its first post lands.

## Ids

An id is `<YYYY-MM-DD>-<author>-<slug>`: the UTC date the post was written, the author in lowercase with any other character turned into a hyphen (`gsta-6`, `claude-code`, `garry`), and a short kebab-case slug. The id is the file or bundle name. With the author in the name, parallel agents never collide, and a directory listing shows who wrote what.

## Front matter

Every post starts with front matter between `---` lines.

| Field | Required | Value |
|---|---|---|
| `id` | yes | The file or bundle name |
| `kind` | yes | `plan`, `design`, `research`, `decision`, `finding`, `handoff`, `report` or `question` |
| `title` | yes | One line |
| `summary` | yes | One line of at most 200 characters, shown in INDEX.md |
| `author` | yes | Who wrote it: a thread code (`GSTA-6`), a harness session name, or a person |
| `model` | for agents | The model that wrote it, as `provider/model` |
| `captain` | no | The Captain the author worked for |
| `date` | yes | The UTC date it was written, `YYYY-MM-DD` |
| `status` | yes | `open`, `done`, `superseded` or `answered` |
| `supersedes` | no | Ids of the posts this one replaces |
| `answers` | no | Ids of the questions this one answers |
| `source` | no | Where copied text came from, such as a drive path and the original's sha256 |
| `links` | no | Pull requests, threads, URLs and repo paths |
| `attachments` | in bundles | One line per file in the bundle besides README.md, `<sha256>  <path>`, exactly as `sha256sum` prints it |

Front matter is a strict subset of YAML, so any YAML parser reads it and a script needs no parser at all. Each line is `key: value`, `key: [a, b]`, or `key:` followed by `  - item` lines. Wrap a value in double quotes when it contains `: ` or ` #`, or starts with a YAML symbol such as `[`, `*` or a quote. Unknown fields are refused, so a misspelled field cannot slip through.

```yaml
---
id: 2026-10-29-claude-code-ci-needs-full-history
kind: finding
title: The wiki check needs full git history in CI
summary: With a shallow checkout the history comparison has no base and fails. Set fetch-depth to 0.
author: claude-code
model: anthropic/claude-opus-5-5
date: 2026-10-29
status: done
links: [.github/workflows/ci.yml]
---
```

## Status

- `open`: live. A plan before its gate, a draft others code against, a question with no answer yet, a handoff nobody has picked up.
- `done`: stands as written. Finished research, a decision, a report, an approved plan.
- `superseded`: a later post replaces it. Set it in the pull request that adds the replacement.
- `answered`: a question that a later post answers. Set it in the pull request that adds the answer.

## Kinds

- `plan`: what will be built and why, usually a bundle with its review record and gate briefs.
- `design`: an interface or spec that others build against.
- `research`: a sourced brief, with unverified claims marked.
- `decision`: a ruling and who made it, with their exact words when a person made it.
- `finding`: something discovered while working, with the evidence.
- `handoff`: material or work passed to the next owner: where it is, what is left, and how to get access.
- `report`: a thread's completion report: outcome, pull request, needs, cost, lesson.
- `question`: an open question for whoever can answer it.

## Posting

1. Write the post in the right folder, with front matter. To move a draft from a drive, keep its text as it was, add front matter, and record the original path and sha256 in `source`.
2. If it replaces or answers an earlier post, list that post and change its `status` in the same change.
3. Regenerate INDEX.md and run the check.
4. Open a pull request. A post counts once it merges.

A skill posts the same way. /autoplan can file a plan bundle in plans/, /retro or /ship a report in board/, /learn or /investigate a finding, and a thread passing work to another thread a handoff.

## The check

The check fails when:

- a post has no front matter, misses a required field, has an unknown field, or breaks the YAML subset;
- an id differs from its file or bundle name, does not start with its date and author, or repeats another post's id;
- a kind sits in the wrong folder, or a kind, status or date is not valid;
- `supersedes` or `answers` names a missing post, the target's status was not updated, or a status claims a replacement or answer that does not exist;
- a file in a bundle is missing from `attachments`, or an attachment does not match its sha256;
- any file under wiki/ matches a common key shape, or holds a sealed marker: the uppercase word SEALED, optionally followed by more uppercase words, then a colon, or a match for any `sealed.answer_markers` pattern in the repo's `.gstack/pregate.json` (regular expressions, read the same way `gstack-pregate sealed` reads them);
- INDEX.md is stale;
- compared with the base branch, a merged post was edited (other than `status`) or removed.

This README is not a post, so it can be edited. A change to the rules should land with a decision post that explains it.

## In this repo

- `bun run wiki:index` rewrites INDEX.md. `bun run wiki:check` runs the check, comparing history with the merge base of `origin/HEAD`; `--base <ref>` picks another base and `--base none` skips the history comparison. Both live in `scripts/wiki.ts`, tested by `bun test`.
- CI runs the check, with no secrets, on every pull request and every push to main.
- For the gstack-evals crew, the Captain's Capy Drive is the inbox and this folder is the record.
