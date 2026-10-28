---
id: 2026-10-28-gsta-6-garry-directions-oct-27
kind: decision
title: Garry's directions for gstack-evals, 2026-10-27
summary: Garry's exact words on the eval's purpose, models, parity claims and task sources, given to the gstack-evals Captain on 2026-10-27, with how the crew applied each.
author: GSTA-6
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: done
source: Captain drive NOTES.md, the section "Garry's framing" and the dated lines after it, copied by GSTA-6 on 2026-10-28
---

# Garry's directions for gstack-evals, 2026-10-27

Garry Tan gave these directions to the gstack-evals Captain (GSTA-2) on 2026-10-27. The quotes are his exact words, copied from the Captain's notes. The "Applied" line under each quote is the crew's reading, not his words.

## Purpose

> "Oh no don't worry about the other side. We only care about us and making the best product. It's open source I don't care so much about marketing. This eval is open source and we should try to be earnest and use it to steer our ai research and r&d"

Applied: the repo is open source and earnest. Other stacks (pstack, tstack) are idea sources, not a leaderboard. Losses are reported plainly, including a gstack skill that loses to no skill.

> "Oh no we don't need to worry about versions before. We care about being the best. It's all open source and it's our internal diagnostic that we will open up later"

Applied: stack arms use the current pstack and tstack, with the commit recorded at preregistration. The repo stays private for now as an internal diagnostic and opens later, so everything committed must be safe to publish.

## Models

> "Actually knowing the skill does nothing on opus 5.5 is very useful and we should try to come up with harder evals and/or shorten stuff that doesn't help. It may well be useful to know if gstack is useful to get cheaper smaller or open source models to opus 5.5 or frontier model quality!"

Applied: a skill with no lift on Opus 5.5 goes to one of two tracks, harder tasks with headroom or cutting the lines that don't help (checked by the before/after skill eval). A model ladder measures how much of the gap to Opus 5.5 gstack closes for cheaper, smaller and open-weight models, with cost per success.

> "Look up the most used codegen models open source on open router and stay pegged to that"

Applied: the open-weight ladder slots follow OpenRouter's programming ranking, re-read at every preregistration. The first snapshot is [2026-10-27-gsta-2-openrouter-programming-ranking](../research/2026-10-27-gsta-2-openrouter-programming-ranking.md).

## Parity claims

> "Also evals should also allow us to make claims like 'on a set of x y and z codegen tasks gstack helped bring (cheap model) to parity with frontier model A'"

Applied: a parity claim needs a preregistered margin, a non-inferiority test on task-clustered paired data, enough tasks that the smallest detectable difference fits inside the margin, and a frontier reference that is off ceiling. Without all four, the claim is not made.

## Task sources

> "Is it worth taking select deep-swe and swe-bench and other eval questions for ours? Research"

Applied: GSTA-4 researched it. The answer is [2026-10-27-gsta-4-public-task-sourcing](../research/2026-10-27-gsta-4-public-task-sourcing/README.md).

> "You might be able to get interesting eval ideas from all the other captains in this Capy project too"

Applied: GSTA-5 mined the other Captains' work for eval ideas. That catalogue is sealed; see [2026-10-28-gsta-6-sealed-incident-catalogue](2026-10-28-gsta-6-sealed-incident-catalogue.md).

At the plan gate, Garry answered which of his private repos may seed sealed tasks:

> "Yes harness-evals no the others / Rec / Ok thankfully harness-evals is private still"

and later the same day widened it:

> "Oh no why don't you just create tests based on the other repos"

Applied: harness-evals material may be used as is in sealed tasks. Material from the other private repos becomes derived tasks only: the bug or failure pattern is rebuilt in fresh code, or a session is rewritten as a new scenario, and nothing is copied verbatim. Sealed task bodies never enter this repo.
