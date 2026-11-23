# wiki/

This folder is the shared record for the agents and people who work on this repo. It holds plans, designs, research, decisions, findings, handoffs, reports and questions, one post each. Anyone can read it with plain git; no chat tool, drive or Captain access is needed.

It works like an artifact store. A merged post never changes except for its status. Later posts supersede earlier ones by id, and every attached file is pinned by its sha256.

Drafts and scratch work live elsewhere: a Capy Drive, a local folder, a branch. When something is worth keeping, an agent copies it here in a pull request, and review is how it gets in.

## Rules

1. One post per file, or one folder per post when it has attachments.
2. A merged post is immutable. Nobody edits its body, its attachments or any front matter field except `status`. The only exception is an edit the repository owner directs, recorded as a row in a tab-separated file `wiki/edits/<name>.tsv`: the post's path, its sha256 before and after the edit, and a reason. A row may name only a markdown file in a wiki section (a post, a bundle's README.md or a `.md` attachment), never a data attachment or a waiver file. A waived README keeps the attachment names it had. A row counts only in the pull request that adds it, beside its edit, so the check passes that one edit and fails any later one.
3. To correct or replace a post, write a new post that lists it in `supersedes`, and set the old post's `status` to `superseded` in the same pull request.
4. To answer a question, write a post that lists it in `answers`, and set the question's `status` to `answered` in the same pull request.
5. Never delete or rename a merged post.
6. Post only what is safe to publish. No secrets, keys or tokens. No sealed task bodies, hidden tests or answer keys. No code, text or transcripts copied verbatim from private sources. Describe sealed material by counts and digests only.
7. INDEX.md is generated and never committed. `bun run wiki:index` writes it locally, and git ignores it.

If a merged post leaked something, deleting it does not remove it from git history. Stop, tell the repository owner, and rotate any exposed key. Only the owner can rewrite history.

## Layout

```
wiki/
  README.md    these rules
  INDEX.md     generated from front matter by bun run wiki:index, not committed
  board/       decision, finding, handoff, report, question
  plans/       plan, design
  research/    research
  edits/       waiver rows for owner-directed edits to merged files
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
3. Run the check.
4. Open a pull request. A post counts once it merges.

A skill posts the same way. /autoplan can file a plan bundle in plans/, /retro or /ship a report in board/, /learn or /investigate a finding, and a thread passing work to another thread a handoff.

## Eval plans and results

New eval plans and results pages carry a few fixed headings and labelled lines, so the check can confirm five practices every eval here already follows: name the decision the result changes, pilot every arm, check the judge, take one planned look, and record what the eval settled. Problems name them by their number on the team's eval-loop checklist: 1, 3, 5, 6 and 12.

The check reads these posts:

- a **preregistration**: an id ending in `-prereg` (or a numbered `-prereg-v2`, `-prereg-2`), or a title starting "Preregistration";
- a **quick look**: an id ending in `-quick-look`, or a title starting "Quick look";
- a **results page**: an id ending in `-results` (or a numbered `-results-v2`), whatever its title says.

Amendments, pins and addenda are not preregistrations, so they are not checked. A post that is already on the base branch is never checked, so plans and results merged before these rules stay as they are. The check decides this from git, not from the post's date. With no base (`--base none`) it does not run.

A preregistration has four sections. A heading may carry a number and a note in brackets, such as `## 2. Pilots (R111)`. Labelled lines start the line, as `Label: value`. Lines inside code fences (``` or ~~~) and HTML comments (`<!-- -->`) are not read, so a fenced or commented-out example never counts as the plan. A dollar value holds exactly one figure, which may end in k or M for thousands or millions when the letter touches the number, such as $1.2k; a value with two figures, a space before the k or M, or a spelled-out unit is refused.

```markdown
## Decision

- If the hook raises loads: it stays on by default.
- If the interval includes 0: it ships off by default.

## Pilots

| Arm | Budget | Pilot cap | Part ran | Judge check | Supply |
|---|---|---|---|---|---|
| hook on | $400 | $40 | the hook log shows the line in every pilot session | 10 pilot outputs labelled; the judge agrees on this arm | 6 tasks build and grade, 6 at once |
| no gstack | $300 | $30 | the read audit finds no gstack file read | 10 pilot outputs labelled; the judge agrees on this arm | 6 tasks build and grade, 6 at once |

## Judge check

Judge: openai/gpt-6-astra scores anthropic/claude-opus-5-5
Labelled outputs: 100
Kappa at least: 0.6
Errors read: per arm

## Interim look

Planned paid spend: $700
At: half the units, 30 of 60, in seeded order
Stop bounds: |z| of at least 2.797 at the look and 1.977 at the end
Other looks: none
```

- **Decision** names at least two outcomes, each with what we do then: `- If <outcome>: <what we do>` lines, or a table with a row per outcome.
- **Pilots** has one row per arm, the no-gstack arm included, with these six cells in this order. The pilot cap is at most a tenth of the arm's budget, both in dollars. Each pilot says how it shows, on that arm's own outputs, that the part under test ran, that the judge passes its check there, and that the tasks can be supplied at the planned rate. The judge cell may be `none` only when the plan has no model judge.
- **Judge check** has one `Judge: <lab>/<model> scores <lab>/<model>[, ...]` line per judge, and the judge's lab differs from every lab it scores. The lab is the first path segment, or the second after an `openrouter/` prefix, so `openrouter/anthropic/claude-opus-5-5` is an Anthropic model. Then at least 100 labelled outputs, a kappa of at least 0.6, and errors read per arm. The floor comes from the plan's `date`: a plan dated 2026-11-22 or later needs 100, and a plan dated earlier needs 40, the floor before then. A plan with no model judge writes `Judge: none` and nothing else here; an empty `Judge:` line fails.
- **Interim look** gives the planned paid spend of the largest counted run. Above $500, the plan takes one look at half the units, fixes its stop bounds and takes no other look. At $500 or less, the other lines are optional; `Look: none` says so.

A quick look (at most $100 paid and one day) needs none of that, only its three-line plan and its size:

```markdown
## Quick look

Question: does the shorter skill text still get the test run?
Decision: if it does, the cut goes to a counted run; if not, the cut is dropped.
Stop rule: stop at 10 sessions or $60, whichever comes first.
Paid cap: $60
Days: 1
```

A quick look above $100 or longer than a day fails: it is a counted run and needs a preregistration.

A results page carries one line with the ship-or-kill call it settled, or `none`. Its paid and meter cost go in the experiment's private registry row, not on the page:

```markdown
Call settled: the hook stays on by default (KEEP)
```

## The check

The check fails when:

- a post has no front matter, misses a required field, has an unknown field, or breaks the YAML subset;
- an id differs from its file or bundle name, does not start with its date and author, or repeats another post's id;
- a kind sits in the wrong folder, or a kind, status or date is not valid;
- `supersedes` or `answers` names a missing post, the target's status was not updated, or a status claims a replacement or answer that does not exist;
- a file in a bundle is missing from `attachments`, or an attachment does not match its sha256;
- any file under wiki/ matches a common key shape, or holds a sealed marker: the uppercase word SEALED, optionally followed by more uppercase words, then a colon, or a match for any `sealed.answer_markers` pattern in the repo's `.gstack/pregate.json` (regular expressions, read the same way `gstack-pregate sealed` reads them);
- INDEX.md is committed, or git cannot tell whether it is;
- a preregistration, quick look or results page that is new compared with the base branch lacks a heading or line that Eval plans and results, above, requires;
- compared with the base branch, a merged post was edited (other than `status`) without a matching waiver row, or removed, or a waiver row is malformed, or a new waiver row names a data attachment or a waiver file, matches no edit in the same change, or changes a bundle's attachment names.

This README is not a post, so it can be edited. A change to the rules should land with a decision post that explains it.

## In this repo

- `bun run wiki:index` writes INDEX.md, which git ignores; run it, then read INDEX.md, to see what is open. `bun run wiki:check` runs the check, comparing history with the merge base of `origin/HEAD`; `--base <ref>` picks another base and `--base none` skips the history comparison and the eval plan checks. Both live in `scripts/wiki.ts`, tested by `bun test`.
- CI runs the check, with no secrets, on every pull request and every push to main.
- For the gstack-evals crew, the Captain's Capy Drive is the inbox and this folder is the record.
