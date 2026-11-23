---
id: 2026-11-08-geva-404-findings-standard-takeaways-first
kind: decision
title: "The findings standard, section order: takeaways first, what works before what didn't, internal detail at the back, and cost only as a normalised lesson"
summary: "Supersedes the findings standard's section order only. A finding file opens with 2 or 3 takeaways, then what works, then what didn't. Cost shows only normalised; totals go to Agent notes."
author: GEVA-404
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-08
status: done
supersedes: [2026-11-01-geva-105-findings-standard, 2026-11-02-geva-170-findings-standard-disclosure-placement]
links:
  - 2026-11-01-geva-105-findings-standard
  - 2026-11-02-geva-170-findings-standard-disclosure-placement
---

# The findings standard: takeaways first, what works before what didn't

- A finding file now opens with two or three plain takeaways, each in the form "We learned X. You should do X." What works comes first, and what didn't work comes right after it, never buried.
- The facts a builder needs come first. Our internal mechanics (codes, lanes, ledgers, gate details) move to the back of the file, most of them into a collapsed Agent notes section.
- Cost appears in the body only as part of a lesson, normalised as cost per correct answer or a cost ratio between two setups. All-in spend, caps and ledger figures go in Agent notes. Every honesty rule stays as it was.

## What this replaces, and what stands

This post supersedes [the findings standard](2026-11-01-geva-105-findings-standard.md) and [its disclosure placement post](2026-11-02-geva-170-findings-standard-disclosure-placement.md) on one point: the structure and order of a finding file. The first post set the section list in its section 1, and the second added a closing Disclosures section to it. The order below replaces that list, and the Cost section leaves the body as the Cost section of this post sets out.

Everything else in both posts stands as written: the ruling, the record table's fields, the claim check, the admission check, the Why-null cycle (R48), the methods, the weekly numbers, the index and registry, the publication order, the gates by pull request class, and every rule on disclosures. Disclosure lines still go only in a closing Disclosures section, last in the file, and never under the title, in the record table, in front matter or in the X post. Read the three posts together. On structure and order, this post governs.

## Where this comes from

On 2026-11-08 Garry Tan set an org rule for every Captain (R79): write up what we learn as a gift to people who build agents. He amended it on cost the same day. The gstack-evals Captain applied both to this repo's finding files, settled where cost figures go here, and asked for this post. The rule's full text is in the org drive at software-factory/rules.md. This post paraphrases it.

The rule asks for these things:

- Two or three plain takeaway bullets at the top of every finding file, results README and write-up about what we learned, in the form "We learned X. You should do X."
- What works first, including where gstack, gbrain or our harness help, and why that matters to someone building agents.
- What didn't work right after, stated plainly. A null becomes a useful lesson where the data supports one, with its number.
- The most relevant facts first, and internal mechanics at the end or in the Agent notes section.
- A public lesson named in every preregistration. Work that yields neither a shareable lesson nor better software is the first to cut.
- No change to honesty: no number rounded in our favour and no caveat dropped. As org rule R78 requires, every judged result keeps its judge check beside it (Cohen's kappa, the catch rate on bad outputs, the false-fail rate on good ones, and the judge model and version), and every comparison keeps its paired 95% interval and the count of tasks that got worse.
- No cost by default. Where cost is part of the lesson, it is normalised as cost per correct answer or a cost ratio between two setups, never a total that invites a headline about money wasted.

## The new order

A finding file has two parts. The front is for someone building agents, and it holds every number and every caveat that matters to them. The back is the record.

**The front: what a builder needs**

1. **Title.** The claim in one sentence, with its number and interval, and its grade when it isn't confirmatory. Unchanged.
2. **Takeaways.** Two or three bullets right under the title, before anything else. Each reads "We learned X. You should do X." The first says what works. When the primary result is null or negative, the first bullet is still the useful lesson the data supports, and the next bullet states the null or the loss plainly. Where the data supports no lesson, the bullets say so and give the null with its control rate and MDD. A number in a bullet keeps what it keeps in the body: a judged result its judge check, a comparison its paired 95% interval and its count of tasks that got worse, a null its control rate and MDD, and a cost its normalised form. Where the preregistration named a public lesson, the bullets answer it or say plainly that the run didn't.
3. **What works.** The result that held, with its number and interval: where gstack, gbrain or the harness helped, on which model, and why it matters to someone building agents. When nothing under test helped, this section says what the data shows does work, such as the plain frontier model already doing the job, with its rate.
4. **What didn't work.** Stated plainly, with its number. A null gives the control rate and the MDD, and an interval that includes zero reads "no measurable difference". A loss is called a loss.
5. **How it works.** What we think is going on, labelled as an explanation, not a result.
6. **Result.** One chart and one table. The preregistered primary comes first, verbatim from the scorer, and secondaries and sensitivity readings come after it, labelled. Every comparison is paired, with its 95% interval and its count of tasks that got worse, and every judged result has its judge check beside it.
7. **Why null? (R48).** Required when the primary is null or negative, as before: exposure, task fit, power with floor or ceiling, and whether today's frontier model does the job without the skill. It ends in KEEP, FIX-METHOD or CUT-CANDIDATE, with a next step and a kill rule. A CUT-CANDIDATE is stated plainly.
8. **Limits and threats.** As before. It stays in the front, so no caveat sits behind the internal detail.

**The back: the record**

9. **Setup.** As before: question and estimand, arms, exact model ids and routes, generation settings, harness and version, tasks, trials, pairing unit, judges, seeds and dates. Wherever a front section gives a number, it names the arms, model and task set in plain words, so a reader can follow it without this section.
10. **Replicate it.** As before.
11. **What is held out, and why.** As before.
12. **Record.** The publication status line and the record table (grade, repo_commit, prereg, data, reviewed_by, reproduced_by), with the same fields and rules as before, moved here from the top.
13. **The claim check.** As before, one row per check with its evidence.
14. **The X hook.** As before. It carries no disclosure line and no cost total.
15. **Changelog.**
16. **Agent notes.** One collapsed section for the internal mechanics: issue and thread codes, lane names, ledger items and leases, gate and review details, and every money figure the Cost section of this post moves out of the body. The public export can leave it out.
17. **Disclosures.** Last, with nothing after it, as the disclosure placement post set.

What moved, compared with the old list:

- What we found becomes two sections, What works and What didn't work, under the new Takeaways.
- Result moves ahead of Setup, and Why null and Limits move up beside it.
- The publication status line and the record table move from the top to a Record section at the back.
- The Cost section leaves the body.
- Agent notes is new, just before Disclosures.

## Cost

The old Cost section (dollars and tokens per arm, per trial and per success, with the price table) leaves the body.

- A cost appears in the takeaways or the body only when it is part of the lesson, and then only normalised: cost per correct answer, or a cost ratio between two setups. It names the date of the price table it rests on.
- No total appears in the takeaways, the body or the X hook: no all-in spend, no cap and no ledger figure.
- Agent notes holds those figures: the all-in spend, the caps, the ledger lines, the dollars and tokens per arm, per trial and per success from the metering proxy, and the dated price table with how cache tokens were counted.

The methods don't change. Every run still measures cost in dollars and tokens per trial and per success. A number in Agent notes is checked like any other number in the file.

## A worked skeleton

Front matter follows the wiki's README. The body, in order:

```markdown
# <The claim in one sentence, with its number and interval, and its grade if not confirmatory>

- We learned <what works, with its number and what sits beside it>. You should <what a builder does with it>.
- We learned <what didn't work, stated plainly, with its number>. You should <the lesson it supports>.
- <Optional third bullet: the next most useful lesson, such as a cost per correct answer.>

## What works
<The result that held, where gstack, gbrain or the harness helped, and why it matters to a builder.>

## What didn't work
<The null or loss, plainly. Control rate and MDD for a null.>

## How it works
<Labelled as an explanation, not a result.>

## Result
<One chart and one table. Primary first, verbatim from the scorer. Paired 95% interval, tasks worse, judge check.>

## Why null? (R48)
<Exposure, task fit, power, frontier model without the skill. KEEP, FIX-METHOD or CUT-CANDIDATE.>

## Limits and threats

## Setup

## Replicate it

## What is held out, and why

## Record
Publication status: <unpublished or published, what still blocks it, what is done>.

| Field | Value |
|---|---|
| Grade | ... |
| Repo commit | ... |
| Prereg | ... |
| Data | ... |
| Reviewed by | ... |
| Reproduced by | ... |

## The claim check

## The X hook

## Changelog

<details>
<summary>Agent notes</summary>

<Codes, lanes, ledger items, gate and review details. All-in spend, caps, ledger figures, dollars and tokens per arm and per trial, the dated price table.>

</details>

## Disclosures

<The lines from the org drive's research/disclosures.md, word for word.>
```

## Example takeaways

Both examples use made-up numbers to show the form. They are not results.

**A positive result**, judged, with Opus 5.5 alone as the control:

- We learned that a review skill that runs a named pass for each risk catches more seeded bugs than Opus 5.5 alone: 61% of 120 tasks against 47%, a paired gain of 14 points (95% interval +6 to +22; 9 tasks got worse; judge GPT-6 Astra, kappa 0.78, catch rate 0.93, false-fail rate 0.05). You should have your review agent run a named pass for each risk rather than one general read.
- We learned that the extra passes cost 1.3 times as much per bug caught as a single read, at prices of 2026-11-08. You should run them where a missed bug is expensive, such as code that handles money or sign-in.
- We learned that the same skill made no measurable difference on GPT-6.1 Sol: a paired +2 points (95% interval -5 to +9; 14 tasks got worse; judge Opus 5.5, kappa 0.74, catch rate 0.90, false-fail rate 0.06). Sol alone already caught 78%, and the test could see a gain of 9 points or more. You shouldn't expect the skill to lift Sol by that much on reviews like these.

**A null**, scored by each task's own tests, so no judge:

- We learned that Opus 5.5 already finishes most refactors of this size without a planning skill: it passed 74% of 60 TypeScript refactoring tasks, three trials each. You can skip a planning skill for refactors this size and save it for larger changes, where the plain model has room to fail.
- We learned that the planning skill made no measurable difference: +3 points (paired 95% interval -5 to +11; 11 of 60 tasks got worse). The test could see a gain of 12 points or more, and the interval rules that out. The skill's steps ran in 55 of 60 sessions, so it ran and didn't help. You should not add it to an Opus 5.5 refactoring loop on this evidence.

## The preregistration lines

Every preregistration names the public lesson it is after, and its money section stays, marked internal, because caps are a gate input. A preregistration template or kit carries these two sections:

```markdown
## Public lesson

<One or two sentences a builder could act on, whichever way the run comes out.
If it works: "We learned X. You should do X."
If it doesn't: "We learned Y. You should do Y.", such as "plain Opus already does Y".>

## Money (internal)

<Caps, ledger lines and the all-in. These are gate inputs. The finding file states cost
only as a normalised lesson and puts these figures in its Agent notes.>
```

A preregistration that can name neither a public lesson nor a software change it would drive is the first to cut. A preregistration already merged isn't amended for these lines. One written after this post carries them.

## Files already merged

A merged finding file keeps its order, because a merged post changes only its status. A new finding file follows this order, and so does any later version that supersedes an existing one, such as the version that goes public. A results README or write-up that isn't a finding file, such as a research post or a report on what a run taught us, opens with the same takeaways. The rest of this order is for finding files.

## Changelog

- 2026-11-08: first version.
