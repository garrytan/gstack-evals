---
id: 2026-11-15-geva-542-harness-mechanics-correction
kind: finding
title: "Corrected harness mechanics results: Stage 4 spent $880.20 on model calls and $44.84 on machines, not $917.13 and $7.90, and its records sit in a private archive; no total or verdict changes"
summary: "Corrects the harness mechanics results: Stage 4 spent $880.20 on model calls and $44.84 on machines, not $917.13 and $7.90. Totals, ratios and verdicts stand."
author: GEVA-542
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-15
status: done
supersedes:
  - 2026-11-15-geva-503-harness-mechanics-results
links:
  - 2026-11-09-geva-448-harness-mechanics-prereg
---

# Corrected harness mechanics results: Stage 4 spent $880.20 on model calls and $44.84 on machines, not $917.13 and $7.90, and its records sit in a private archive; no total or verdict changes

- We learned that the harness mechanics results post split Stage 4's cost wrongly. Stage 4 settled at $925.03, as the post says, but $880.20 of it was model calls and $44.84 was machines. The post said $917.13 and $7.90, because its machine figure left out the VMs the sessions ran on ($36.92). No total, per-session cost ratio, count or verdict changes. You should read the post as published, with this note's split in place of its own.
- We learned that the post names the wrong place for the run's records. They are kept in the eval team's private archive with checksums, and the post's digests still pin its run tables and ledgers. You should read the corrected wording below in place of the post's Data row and its "What is held out" section.
- We learned that a cost split is only as complete as the list of rows it adds up. You should split a cost line from the ledger's own row ids, not from a list of the items you remember.

This note supersedes [the harness mechanics results post](2026-11-15-geva-503-harness-mechanics-results/README.md). Merged posts don't change, so that post's body stays as it merged and only its status moves to superseded. Two things in it are corrected here: the Stage 4 cost split, and where it says the run's records are kept. Everything else stands as published.

## The Stage 4 cost split

The post's Agent notes say "Stage 4 settled at $925.03, which includes the $7.90 of listing VM and hosts above, so its model spend was $917.13", and its changelog says the spend line "separates $917.13 of model spend from $7.90 of machines". Both are wrong. The $7.90 counted the best-of-2 listing VM ($1.75) and the three hosts, and left out the part VMs the scored sessions ran on: 36 part-VM rows on the ledgers, $36.92. Two of those rows, for the two Sol parts that a quota refusal stopped before they began, settled less than a tenth of a cent between them.

Read instead: Stage 4 settled at $925.03, which includes $44.84 of machines (part VMs $36.92, the listing VM $1.75 and the three hosts $6.16), so its model calls came to $880.20 (sessions $848.55, best-of-2 picker calls $30.91 and judge calls $0.74).

The recount sums every settled row on the three Stage 4 ledgers, classed by row id. Each column is one model's ledger item. The picker for Opus's item was GPT-6.1 Sol, and Opus 5.5 picked for the other two.

| Row | Opus 5.5 | GPT-6.1 Sol | particle-1 | Stage 4 |
|---|---|---|---|---|
| Sessions | $352.25 | $393.51 | $102.79 | $848.55 |
| Best-of-2 picker calls | $3.07 | $14.32 | $13.52 | $30.91 |
| Judge calls | $0.25 | $0.19 | $0.30 | $0.74 |
| **Model calls** | **$355.57** | **$408.01** | **$116.62** | **$880.20** |
| Part VMs (ledger rows) | $11.62 (10) | $11.46 (14) | $13.84 (12) | $36.92 (36) |
| Best-of-2 listing VM, in equal shares | $0.58 | $0.58 | $0.58 | $1.75 |
| Host | $1.75 | $2.42 | $1.98 | $6.16 |
| **Machines** | **$13.96** | **$14.47** | **$16.41** | **$44.84** |
| **Settled** | **$369.53** | **$422.48** | **$133.02** | **$925.03** |

Each figure is a ledger sum in micro-dollars rounded to the cent, so a total can differ by a cent from the sum of its rounded rows. The post's $6.15 for the hosts added the three hosts after rounding each one; their exact sum rounds to $6.16.

How the rows were classed: a session row's id is the item, the part and the session (for example `stage4-opus/s4-1/s-<hex>`), a part VM's is the item, the part and `vm`, picker and judge rows start with `picker:` and `judge:`, the listing VM's share is `pick4/vm` and a host is `host-1`. Every settled row on the three ledgers falls in exactly one class. The three Stage 4 ledgers and the vms ledger match the sha256 values in the results post's digests.txt.

## What didn't change

- The Stage 4 total, $925.03, and each model's settled amount: $369.53, $422.48 and $133.02.
- The paid runs and machines total, $1,196.96. The recount checked it from the ledgers: Stages 1 to 3 settled $264.43 and the vms item $7.50, beside Stage 4's $925.03. The all-in total doesn't use the split either.
- Every per-session cost ratio, such as the 1.61, 0.94 and 1.21 times the spend the post gives for /verify, and best-of-2's 2.1 to 2.6 times one attempt. These come from each session's own metered spend in the run table, not from the split.
- Every verdict, interval, count and Why null? end state.

## Where the records are kept

The post's Data row and its "What is held out" section say the trial dirs, ledgers, picks and run records sit in a drive folder. Read instead: the run tables, the trial records of Stages 1 and 4 (transcripts, verifier output, meters and hook logs), the ledgers and the picks are kept in the eval team's private archive with checksums, and the run records sit beside them. They stay private because they hold transcripts and repository code. The task dirs rebuild from the public SWE-rebench dataset and the frozen task list in the preregistration bundle, and the arm installs rebuild from commit 3d5dcce. The results post's digests.txt still lists the sha256 of both run tables at both codes and of every final ledger.

## Changelog

- 2026-11-15: the harness mechanics results post.
- 2026-11-15: this note. It corrects the Stage 4 cost split to $880.20 of model calls and $44.84 of machines, and says where the run's records are kept.

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

gstack is Garry Tan's own project.
