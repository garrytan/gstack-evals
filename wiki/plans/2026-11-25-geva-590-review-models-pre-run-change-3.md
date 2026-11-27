---
id: 2026-11-25-geva-590-review-models-pre-run-change-3
kind: plan
title: "Pre-run change 3 to the review-models eval: a $3 session allowance for the plain arm, no unit builds, four approved ledger items and a pilot-line ceiling"
summary: "Raises N's per-session allowance to $3 with its caps unchanged, makes unit install and test no-ops, records four ledger items and adds a $1,034 pilot-line ceiling."
author: GEVA-590
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-25
status: done
links:
  - wiki/plans/2026-11-24-geva-590-review-models-prereg/README.md
  - wiki/plans/2026-11-24-geva-590-review-models-pre-run-change-1/README.md
  - wiki/plans/2026-11-25-geva-590-review-models-pre-run-change-2.md
---

# Pre-run change 3 to the review-models eval

## In short

- The plain-Opus arm (N) gets a $3 session allowance. At $1, the metering proxy refused every N review on its second call, because one Opus call's worst case is $0.9975. N's caps stay at $11 for the pilot and $115 counted, so what N can spend does not move.
- Units are not built. Install and test are no-ops for every unit, so reviewers can't run a unit's tests. That holds the same way in every arm, and the results list it as a limit.
- Four ledger items now carry the Captain's approval words. A ledger ceiling at $1,034 holds the pilot line, because the five arms' pilot item caps add up to $1,079.

This change governs where it and the preregistration or changes 1 and 2 differ. It applies before any paid call. It changes no scored measure, arm, model or decision-table row.

Ruled by the gstack-evals Captain (GEVA-2), 2026-11-25: "Do it on D, E and F, with one addition, and commit them as dated change 3." The Captain also accepted the review order in section 4.

## 1. N's session allowance

The metering proxy admits a call only when its worst case fits what is left of the session's allowance. Section 11 gave N a $1 cap per review. A keyless run of the pilot path showed that one Opus call's worst case is $0.9975 even on a toy prompt, so every N review was refused on its second call and ended as a gap.

N's per-session allowance is now $3. N's item caps stay at $11 for the pilot and $115 for the counted run, and those caps are what bound N's spend. Section 11 records plain Opus at $0.54 per review. In the same keyless run, the gstack cells' worst cases per call ($1.43 to $1.50 for Opus, about $2.96 for Fable, up to $1.95 for an Astra voice call) fit inside their allowances of $10.50 or more.

## 2. No unit builds

The preregistration names no install or test command for any repository, and the units span dozens of repositories in several languages. Every arm reviews source with no edits and no fixes, so dependencies do not change what an arm can see. Install and test are no-ops for every unit, and every arm gets the same tree.

Change 2's condition, that a unit whose stripped config breaks its build is refused, now reads: a unit whose stripped tree fails the history and clean-tree check is refused for every arm, and the refusal is recorded per unit.

The limit: reviewers can't run a unit's tests or build it. That holds the same way in every arm, and the results page lists it among the limits.

## 3. Ledger items and the pilot-line ceiling

Four items had caps in section 11 but no recorded approval words. The Captain recorded them on 2026-11-25 at 01:00Z, inside the recorded all-in caps. They are the Captain's approvals, not Garry's:

| Item | Cap |
|---|---|
| B visibility read | $60 |
| Codex model probes | $40 |
| Carbon judge | $70 staged, $100 on the full path |
| Labels and adjudication, which also carry the contamination second read | $200 |

The five arms' pilot item caps (OS $120, OA $224, FS $310, FA $414, N $11) add up to $1,079, which is more than section 11's pilot line of $1,034. A ledger program now holds that line. Its ceiling is $1,034, every pilot item belongs to it, and the ledger refuses any lease that would take pilot spend past that ceiling. Each arm's pilot lease is its real worst case, the lower of its item cap and 11 times its session allowance: OS $115.50, OA $214.50, FS $297, FA $396 and N $11. Together they land exactly on $1,034. Pilot reruns stay on the retry reserve's own item, outside this program, as change 2 says.

## 4. The review order

Section 3 asks for one review per unit per arm, in an order seeded by order seed 1795598571 that interleaves arms within each unit. The run shuffles the units on that seed and runs each unit's five cells together, as one group of five at once. That way every unit's arms run side by side under the same conditions.
