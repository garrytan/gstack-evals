---
id: 2026-11-02-geva-170-findings-standard-disclosure-placement
kind: decision
title: "The findings standard, disclosure placement: lines go only in a closing Disclosures section, never at the top, in front matter or in the X post"
summary: "Supersedes the findings standard on where disclosure lines go: only a closing Disclosures section, last in the file. None under the title, in the record table, in front matter or in the X post."
author: GEVA-170
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-02
status: done
supersedes: [2026-11-01-geva-105-findings-standard]
source: "org drive research/disclosures.md, sha256 0629b68480b2c445b6c5e358cc16ff6834652d320f909263438b3170018de0ac (the placement words and the lines)"
links:
  - 2026-11-01-geva-105-findings-standard
  - https://github.com/garrytan/gstack-evals/pull/113
  - https://github.com/garrytan/gbrain-evals/pull/301
  - GST-932
  - GST-821
---

# The findings standard: disclosures go only in a closing Disclosures section

GEVA-170, for the gstack-evals Captain (GEVA-2), issue GST-932. This post supersedes [the findings standard](2026-11-01-geva-105-findings-standard.md) (#113, 473350b) on one point only: where a finding file puts its disclosure lines. Everything else in that post stands as written: the ruling, the rest of the finding file template, the claim check (disclosures are still settled before the post), the admission check, R48, the methods, the weekly numbers, the index and registry, the publication order and the gates. Read the two posts together. On placement, this post governs.

## Garry's words

Garry Tan, 2026-11-01 at 23:46 UTC, in GBrain-Evals, about the particle-1 (W10b) post:

> "Put the disclosures at the end of the post and not at all in the X post."

FOUN-32 applies these words to every post, as org rule R55.

## Which parts are Garry's words and which follow from them

- **Garry's words.** Disclosures go at the end of the post. The X post carries none.
- **Follows from "at the end".** The Disclosures section is the last section of the file. No disclosure line sits under the title, in the publication status line or in the record table at the top.
- **Follows from "not at all in the X post".** The X hook drafted in the file carries no disclosure line, and neither does any image made for the X post.
- **GBrain-Evals' finding, not Garry's words.** GitHub renders a Markdown file's front matter as a table at the top of the page, so a disclosure line in front matter lands at the top. GBrain-Evals (thread GBEV-3) found this on the W10b page in [gbrain-evals #301](https://github.com/garrytan/gbrain-evals/pull/301) on 2026-11-02. Front matter therefore carries none.
- **The words of each line** come from the org drive's research/disclosures.md, which the gstack-evals Captain keeps under decision A1. The lines below are copied from it word for word.

## What changes in the standard

Section 1 of the standard changes in four places. Nothing else in it changes.

1. **Sections, in order.** The list keeps its 15 sections and adds a 16th, the last: "Disclosures", which carries the lines below for every subject the file tests, compares or features, word for word. Nothing follows it.
2. **The X hook (section 13).** It carries no disclosure line, and neither does any image made for the X post. The X post still links to the file at a pinned commit and says nothing the file doesn't.
3. **The record table.** The disclosures field leaves it. The table holds grade, repo_commit, prereg, data, reviewed_by and reproduced_by, and has no Disclosures row.
4. **Front matter.** No front matter field carries a disclosure line, the title and summary included.

The heading that states the claim and the publication status line under it carry no disclosure line either.

## The closing Disclosures section

disclosures.md states the rule this way, and this post adopts its words:

> A finding file or long-form post that tests, compares or features the subject carries the line only in a closing Disclosures section at the end. Nowhere else: not under the title, not in a record table at the top, and not in front matter, because GitHub renders front matter as a table at the top of the page (GBEV-3 found this on the W10b page, #301, 2026-11-02). An X post and its images carry no disclosure line. Use the words below exactly.

The lines, as disclosures.md held them on 2026-11-02:

| Subject | Line |
|---|---|
| Particle (particle-1) | Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1. |
| gstack | gstack is Garry Tan's own project. |
| gbrain | gbrain is Garry Tan's own project. |
| ggstack | ggstack is Garry Tan's own project. |
| QM | Disclosure: QM is a project of Y Combinator, which Garry Tan runs. |
| Hermes | Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes. |
| OpenAI (any OpenAI model, such as GPT-6.1 Sol) | Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator. |
| OpenClaw | Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI. OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator. |

disclosures.md stays the source for which lines apply and for their words. When it adds or changes a line, a finding file uses its words as they stand when the file is written.

The end of a finding file that tests gstack on particle-1 then reads:

```
## Changelog

- 2026-11-02: first version.

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

gstack is Garry Tan's own project.
```

## What this replaces

The standard put disclosures in the record table at the top of the body and had no closing section. Before Garry's words, disclosures.md and R55 put the line "as a paragraph under the title, and the post itself carries it too". Until 2026-11-02, disclosures.md also let a finding file keep its lines in front matter. This post replaces all three for gstack-evals finding files.

A merged finding file still changes only its status. A version of one that goes public is a new post that supersedes it, and that version follows this placement.
