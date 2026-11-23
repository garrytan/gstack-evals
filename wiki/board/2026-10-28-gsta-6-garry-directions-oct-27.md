---
id: 2026-10-28-gsta-6-garry-directions-oct-27
kind: decision
title: Garry's directions for gstack-evals, 2026-10-27
summary: Garry's directions on the eval's purpose, models, parity claims and task sources, given to the gstack-evals Captain on 2026-10-27 and paraphrased here, with how the crew applied each.
author: GSTA-6
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: done
source: Captain drive NOTES.md, the section "Garry's framing" and the dated lines after it, copied by GSTA-6 on 2026-10-28
---

# Garry's directions for gstack-evals, 2026-10-27

Garry Tan gave these directions to the gstack-evals Captain (GSTA-2) on 2026-10-27. Each direction below is a paraphrase; his exact words stay in the Captain's private notes. The "Applied" line under each direction is the crew's reading.

## Purpose

Direction (paraphrased): don't worry about the other stacks. What matters is making the best product, not marketing. The eval is open source, should be earnest, and should steer gstack's AI research and R&D.

Applied: the repo is open source and earnest. Other stacks (pstack, tstack) are idea sources, not a leaderboard. Losses are reported plainly, including a gstack skill that loses to no skill.

Direction (paraphrased): don't worry about older versions of other stacks; the goal is to be the best. It is all open source, and the eval is an internal diagnostic to be opened up later.

Applied: stack arms use the current pstack and tstack, with the commit recorded at preregistration. The repo stays private for now as an internal diagnostic and opens later, so everything committed must be safe to publish.

## Models

Direction (paraphrased): learning that a skill adds nothing on Opus 5.5 is valuable, and should lead to harder evals or to cutting what doesn't help. It would also be useful to know whether gstack can lift low-cost, small or open models to the level of Opus 5.5 or another frontier model.

Applied: a skill with no lift on Opus 5.5 goes to one of two tracks, harder tasks with headroom or cutting the lines that don't help (checked by the before/after skill eval). A model ladder measures how much of the gap to Opus 5.5 gstack closes for cheaper, smaller and open-weight models, with cost per success.

Direction (paraphrased): take the most-used open-source codegen models on OpenRouter as the ladder, and follow that ranking.

Applied: the open-weight ladder slots follow OpenRouter's programming ranking, re-read at every preregistration. The first snapshot is [2026-10-27-gsta-2-openrouter-programming-ranking](../research/2026-10-27-gsta-2-openrouter-programming-ranking.md).

## Parity claims

Direction (paraphrased): the evals should support parity claims, such as that on a named set of codegen tasks gstack brought a cheap model level with a frontier model.

Applied: a parity claim needs a preregistered margin, a non-inferiority test on task-clustered paired data, enough tasks that the smallest detectable difference fits inside the margin, and a frontier reference that is off ceiling. Without all four, the claim is not made.

## Task sources

Direction (paraphrased): research whether to borrow selected DeepSWE, SWE-bench and other public eval tasks.

Applied: GSTA-4 researched it. The answer is [2026-10-27-gsta-4-public-task-sourcing](../research/2026-10-27-gsta-4-public-task-sourcing/README.md).

Direction (paraphrased): the other Captains' work may also hold good eval ideas.

Applied: GSTA-5 mined the other Captains' work for eval ideas. That catalogue is sealed; see [2026-10-28-gsta-6-sealed-incident-catalogue](2026-10-28-gsta-6-sealed-incident-catalogue.md).

At the plan gate, Garry answered which of his private repos may seed sealed tasks:

Direction (paraphrased): harness-evals may seed sealed tasks and his other private repos may not; he took the gate's recommendation and noted that harness-evals is still private.

and later the same day widened it:

Direction (paraphrased): build tests from the other repos as well.

Applied: harness-evals material may be used as is in sealed tasks. Material from the other private repos becomes derived tasks only: the bug or failure pattern is rebuilt in fresh code, or a session is rewritten as a new scenario, and nothing is copied verbatim. Sealed task bodies never enter this repo.
