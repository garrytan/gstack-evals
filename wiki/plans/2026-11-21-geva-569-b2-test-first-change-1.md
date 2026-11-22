---
id: 2026-11-21-geva-569-b2-test-first-change-1
kind: plan
title: "Pre-run change 1 to B2: move $250 of cap from GPT-6.2 Sol to Opus 5.5, after the pilot's cost per session"
summary: "b2-opus's cap goes from $465 to $715 and b2-sol's from $605 to $355. Paid caps stay $1,365 and the all-in stop $1,860. The move rests on the pilot's cost per session alone."
author: GEVA-569
model: anthropic/claude-opus-5-5
date: 2026-11-21
status: done
links:
  - wiki/plans/2026-11-21-capy-b2-test-first-prereg/README.md
---

# Pre-run change 1 to B2: move $250 of cap from GPT-6.2 Sol to Opus 5.5, after the pilot's cost per session

## In short

- The b2-pilot item ran on 2026-11-21: the three pilot tasks on all four arms of each model, 36 sessions, all graded, every arm and model PASS on section 12's criteria.
- Opus 5.5 cost $0.75 a session against the plan's $0.39 (the mean of its four arms' planning rates). GPT-6.2 Sol cost $0.17 against $0.53. particle-1 cost $0.15 against $0.16.
- At the pilot's Opus rate, b2-opus's 732 sessions would cost about $550 in model spend, past its $465 cap, so the counted run would end in a cap stop. Sol's item has room to spare.
- The Captain moved $250 of cap from b2-sol to b2-opus. b2-opus is now $715 and b2-sol $355. b2-pilot ($65) and b2-p1 ($230) are unchanged, the paid caps still sum to $1,365, and the all-in stop stays $1,860.

This change governs where it and the preregistration's Agent notes differ. It changes two caps and nothing else: no arm, task, model, setting, bound, rule, rate used by the guard's projection, or pilot gate.

## What the change rests on

Cost per session only. Pilot sessions never enter a reading (section 12), and no outcome was read to make this change. The pilot's passes were the same in every arm: tox-dev__tox-3810 passed in every arm on every model, and the other two pilot tasks passed in none.

| Model | Sessions | Model spend | Per session | Plan's rate (mean of the four arms) |
|---|---|---|---|---|
| Opus 5.5 | 12 | $9.03 | $0.75 | $0.39 |
| GPT-6.2 Sol | 12 | $2.06 | $0.17 | $0.53 |
| particle-1 | 12 | $1.79 | $0.15 | $0.16 |

Three tasks is a small sample. One of them, imperialcollegelondon__pyrealm-593, cost $1.20 to $1.58 a session on Opus.

## The items

| Item | Sessions | Expected model spend (plan) | Cap before | Cap now |
|---|---|---|---|---|
| b2-pilot | 36 | 12.87 | 65 | 65 |
| b2-opus | 732 | 281.82 | 465 | 715 |
| b2-sol | 732 | 384.30 | 605 | 355 |
| b2-p1 | 732 | 118.95 | 230 | 230 |

Each counted item's ledger opens with its approval row at the cap above. A cap stop stays a result and is never rerun.

## What the launch guard does with these caps

The guard still projects each item at the plan's rates. It projects b2-opus at $365.10 against $715, so Opus launches. It projects b2-sol at $467.58 against $355, so it refuses Sol's first counted part. Sol's counted parts wait anyway, for the Codex harness fix and a Sol re-pilot. The projection rates for Sol change only by a later dated change, before any counted Sol part.
