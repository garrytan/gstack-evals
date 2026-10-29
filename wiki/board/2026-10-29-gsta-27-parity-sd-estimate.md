---
id: 2026-10-29-gsta-27-parity-sd-estimate
kind: finding
title: "Parity SD estimate from DeepSWE v1.1: about 0.38, which fits one primary cheap model at 80% power"
summary: DeepSWE's published trials put the parity SD near 0.376 (bootstrap 0.340 to 0.408; proxy pairs 0.270 to 0.432). Only one primary model at 80% power fits 213 tasks at the estimate.
author: GSTA-27
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-29
status: done
links:
  - docs/benchmarks/2026-11-parity-sd-estimate/README.md
  - scripts/parity-sd-estimate.ts
  - https://deepswe.datacurve.ai/artifacts/v1.1/trials.json
  - 2026-10-28-gsta-3-gstack-evals-v1-plan-v3-2
  - 2026-10-28-gsta-3-v1-plan-amendment-a2
  - 2026-10-28-gsta-3-v1-build-breakdown
  - 2026-10-28-gsta-14-u2-stats-prereg-handoff
  - 2026-10-28-gsta-14-sizing-tables-round-to-nearest
---

# Parity SD estimate from DeepSWE v1.1

Build unit U15 estimated decision 9's per-task SD of (C+gstack minus F+none) from DeepSWE v1.1's published trials, at no API cost. The note, its method and every table are in [docs/benchmarks/2026-11-parity-sd-estimate/](../../docs/benchmarks/2026-11-parity-sd-estimate/README.md). scripts/parity-sd-estimate.ts reproduces its numbers byte for byte from the recorded file (sha256 310cb428fe8914cff21b8edcb0b17256884efca55666bd6d6646d223c77d2ce6, retrieved 2026-10-29).

## What was found

- At 5 cheap-rung and 3 Opus trials, the SD is about 0.376, pooled over three stand-ins for the cheap rungs against Claude Opus 5 at max effort. A task bootstrap gives 0.340 to 0.408. Across 24 stand-in pairs it runs from 0.270 to 0.432. That is inside the plan's expected 0.33 to 0.42.
- The per-rung stand-ins differ: 0.421 for the Haiku 5.5 stand-in (gpt-5-6-luna), 0.407 for DeepSeek (deepseek-v4-flash) and 0.286 for GLM 5.3 Flash.
- Under 213 tasks, only one primary cheap model at 80% power fits at the estimate, as v3.2 is written or on its own tranche (Amendment A2, option B). One primary model at 90% power fits only at the bootstrap interval's low end. Three cheap models fit only at the low end of the proxy range. A2's option C fits no design at the estimate, and option A at 80% power needs 214 tasks.
- Reading p(1-p) from one overall pass rate per arm, as U2's taskDiffSd takes it, would give 0.440 instead of 0.376, because the pass rates vary across tasks. U17 should use per-task averages or this estimate.

## What it stands in for

DeepSWE ran no gstack arm, no Opus 5.5 or Haiku 5.5, and used mini-swe-agent on long feature requests, not Claude Code on minted build-fix tasks. So the number anchors the SD's size with measured data and does not replace Phase 2b's measurement on Haiku 5.5 plus gstack cells. The note names each stand-in and shows the estimate if gstack's lift varied by task (0.389 at an SD of 0.10, 0.426 at 0.20).

## Data and licence

DeepSWE's trials file states no licence, so the repo commits its digest, the fetch script and derived per-task pass counts for the 12 configurations used, never the file.
