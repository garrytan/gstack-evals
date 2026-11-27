---
id: 2026-11-25-geva-590-review-models-pre-run-change-9
kind: plan
title: "Pre-run change 9 to the review-models eval: Grok 4.7 labels the judge check, not people"
summary: "Under R126 Grok 4.7, a fourth model family, labels all 100 judge-check reviews blind in one pass, with no people and no third reader; the labels item drops to $80."
author: GEVA-590
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-25
status: done
links:
  - wiki/plans/2026-11-25-geva-590-review-models-pre-run-change-6.md
  - wiki/plans/2026-11-25-geva-590-review-models-pre-run-change-7.md
  - wiki/plans/2026-11-25-geva-590-review-models-pre-run-change-8.md
---


# Pre-run change 9 to the review-models eval

## In short

- No people label the judge check. One model, xAI Grok 4.7, labels all 100 judge-check reviews blind. It sees the same bug evidence, fix diff and scrubbed findings the judge sees, and no judge verdict, arm, model name or earlier answer.
- The third-reader step from change 7 and the engineer seats from change 8 are dropped. Each review takes the labeller's one answer.
- The labels item drops from $650 to $80. The staged all-in cap becomes $6,178, and the full path's becomes $14,758, still gated on Garry.
- Every result line that rests on the judge check says exactly: "judge checked against Grok 4.7, a fourth model family, not against people; Gemini 4 Neon was not used because the judge is a Gemini model".

This change governs where it and changes 5 to 8 differ. It applies before any paid call. It changes no scored measure, arm, model under test or decision-table row. The pilot opens on 2026-11-28 as planned.

## Why

Garry ruled on 2026-11-25 (R126, relayed by the organisation's workflow thread and the gstack-evals Captain) that coding checks use Gemini 4 Neon as another model instead of people. This eval's judge is Gemini 4 Carbon, so a Gemini labeller would share the judge's family. The models under test are Claude and OpenAI. The labeller therefore comes from a fourth family. The gstack-evals Captain chose xAI Grok 4.7, confirmed with the organisation's workflow thread on 2026-11-25, with Moonshot Kimi K3.1 Pro used only if Grok can't run the labels.

## The rule

1. The labeller makes one pass and answers change 6's per-review question once per review: which finding names the bug, none, or can't tell, with a one-line reason.
2. Its input is the judge's input for that review, with the same scrubbing: no model names, arm cues or judge rulings. Reviews reach it in a seeded shuffle across arms.
3. Grok 4.7 runs through OpenRouter, pinned to one provider in src/runner/pricing/prices.ts before any call, at default effort. An empty or cut-off reply is retried once. A review Grok still can't label, because it refused or the harness failed, goes once to Kimi K3.1 Pro, pinned the same way. Each such review is reported by name, with its reason and labeller. A review neither model labels is can't tell, counted per arm.
4. Can't tell counts as not naming the bug, with a second reading that counts it as naming (change 6).
5. The R78 gate is unchanged: Carbon's kappa against these labels on the 100 reviews (the pilot's 55 plus 45 from validation) must reach 0.6 before Carbon's numbers count.
6. The contamination second read stays on this item, as change 3 says.

## Cost

| Item | Change 8 | Change 9 |
| --- | --- | --- |
| Labels, plus the contamination second read | $650 | $80 |
| Staged all-in cap | $6,748 | $6,178 |
| Full-path all-in cap, gated on Garry | $15,328 | $14,758 |

At Grok 4.7's OpenRouter price, read on 2026-11-25 as $2 in and $6 out per million tokens, 100 reviews of about 15,000 tokens in and 1,000 out cost about $4. The rest of the $80 covers retries, any Kimi fallback, and the rare contamination second read.

## What this leaves open

A model-to-model kappa shows that two families agree, not that either matches what an engineer would say. The results say so on every line that rests on the check.
