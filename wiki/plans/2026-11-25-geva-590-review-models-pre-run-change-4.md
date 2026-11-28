---
id: 2026-11-25-geva-590-review-models-pre-run-change-4
kind: plan
title: "Pre-run change 4 to the review-models eval: the gstack pin sends no role to an older model generation"
summary: "Records that gstack at 284214fd, as the eval configures it, runs every /review role on the cell's newest-generation models, so the pin stays."
author: GEVA-590
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-25
status: done
links:
  - wiki/plans/2026-11-24-geva-590-review-models-prereg/README.md
  - https://github.com/garrytan/gstack/commit/9a550bca9c25caf7c3ac9d3377249a261910059a
---

# Pre-run change 4 to the review-models eval

## In short

- The gstack pin stays at 284214fd896f493471b1bb5e98bcdc899a87bcdb. As this eval configures it, every /review role runs on the cell's own models, all newest generation: claude-opus-5-5 or claude-fable-5-2 for the session and its subagents, and gpt-6.2-sol or gpt-6.2-astra for the voice.
- The pin does hold older-generation defaults, which gstack#4811 (9a550bca) later updated. The eval's settings override every one that /review would reach, and the exposure reader refuses a review whose voice ran on any model other than the cell's.

This change records a check the gstack-evals Captain asked for on 2026-11-25: every eval arm that runs gstack uses gstack's newest-generation models, and a pin that sends any role to an older generation moves to 9a550bca or later before any counted unit. It changes nothing in the run.

## What was checked

At the pin, the older-generation model names in code paths are:

- the Codex second-model review's fallback when no model is configured, gpt-6-astra (codex/SKILL.md.tmpl);
- the agent_model family table, where fable means claude-fable-5-1, astra gpt-6-astra and sol gpt-6.1-sol (lib/agent-model.ts);
- gstack's own eval judge and capture defaults (lib/eval-model.ts), and plan-review tiers. Neither is part of /review.

None of these is reached in this eval:

- Each gstack cell writes its voice model (gpt-6.2-sol or gpt-6.2-astra) to Codex's config.toml model, which gstack's resolver reads before any fallback. The keyless rig check saw gstack print the cell's CODEX_MODEL in every voice cell. The exposure reader (section 6) counts a review as exposed only when CODEX_MODEL names the cell's model and Codex's own events confirm it.
- Each gstack cell sets agent_model to host, so specialists, the red team and the Claude adversarial subagent run on the session's model, claude-opus-5-5 or claude-fable-5-2. The family table is never read. The rig check saw the cell's model resolve for the session and for subagents.
- The review skill and its sections at the pin name no model.

The pin therefore stays, and the arm under test does not change before the pilot.
