---
id: 2026-10-28-gsta-8-ci-plan-approved
kind: decision
title: Garry approved the CI, evals-in-CI and end-to-end test plan at gate_rev 3
summary: Garry took every recommendation at the CI plan's gate, so plan v5 stands as written. Three decisions and the order of the first builds follow.
author: GSTA-8
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: done
links: [wiki/plans/2026-10-28-gsta-8-ci-evals-e2e-plan]
---

# Garry approved the CI plan at gate_rev 3

On 2026-10-28 Garry answered the gate of autoplan run autoplan-ci-20261028154111 in the gstack-evals Captain's thread.

His reply took the recommendation on every item.

The Captain relayed the reply, and GSTA-8 recorded it with `gstack-autoplan answer --gate-rev 3 --reply rec --rec-hash f5da0da84c7a`. The run printed `APPROVED: gate_rev=3`. `rec` resolved to d1a, uc1a, uc2a, uc3a, uc4a and p1a:

- d1a keeps the plan as written. The reviewer's change, moving rig admission out of Lane A's preflight to the ledger lease, was already in plan v3.
- uc1a to uc4a accept the plan changes made after the CEO and Eng phases used their two review rounds. Each delta applied that round's findings and changed no decision.
- p1a approves plan v5 as reviewed.

## What the approval decides

1. **gstack's PR CI.** gstack-evals runs no job in gstack's PR CI in v1.0, as plan v3.2 already said. It reaches gstack through a nightly drift check, a diet-binding request for gstack's /ship and free-test requests.
2. **The diet receipt.** gstack's /ship and /write-skill ask for it only on a PR that declares a diet or cut, or removes a locked contract line. A NOT_MEASURABLE verdict records a waiver. It stays advisory until the warning data shows no deadlock.
3. **Rig proof before money.** Every program-funded paid run passes a keyless admission at its ledger lease. A required line item refuses with E_RIG_UNPROVEN, and a caller's own run gets a warning. Admission adds no spend. If U20 has not merged its first PR by 11-14, the Captain asks Garry whether U11 and U16 wait.

The defaults the Captain owns also stand: gstack's merge train with a hand-procedure fallback, unstamped heads with version changes only in release PRs, a generated and gitignored wiki/INDEX.md, rig proof keyed to a recipe hash, and an interface registry that warns until interface v0.1.

## Review

Two CEO rounds and two Eng rounds, each with a native voice (anthropic/claude-opus-5-5) and an outside voice (openai/gpt-6.1-sol). The last Eng round found no Critical or High. No model under test was run.

## Next

In order, each through the Captain's queue under the ship gate: this wiki post; sealed.yml as its own small PR, since it closes the leak gap the rest depends on; then U19's train work and its dry run. The plan puts sealed.yml and the train workflows in U19a's first PR and the ship policy and index in U19b's second. Taking sealed.yml out first is the Captain's scheduling change after the gate, and the plan's scope for U19 stands.

The Captain routes the plan's open asks. U1 merged without E_RIG_UNPROVEN, so that code goes to U4 with the requireAdmission seam and the --admission flag. U2 gets the preregistration check, and U6, U9 and U10 get theirs in their briefs. The Captain holds U20 to U22.

<details>
<summary>Agent notes</summary>

Reviewer reservations were counted at the run's $40 cap.

</details>
