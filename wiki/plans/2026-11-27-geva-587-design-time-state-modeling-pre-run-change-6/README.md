---
id: 2026-11-27-geva-587-design-time-state-modeling-pre-run-change-6
kind: plan
title: "Pre-run change 6 to the design-time state modeling eval: one driver folder serves every build stage"
summary: "The pilot builds now use the driver folder the hinted authoring builds bound the run to, so the ledger does not refuse them. No cap, arm, prompt or check changes."
author: GEVA-587
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-27
status: open
links:
  - wiki/plans/2026-11-24-geva-587-design-time-state-modeling-prereg/README.md
  - wiki/plans/2026-11-24-geva-587-design-time-state-modeling-pre-run-change-2/README.md
  - wiki/plans/2026-11-27-geva-587-design-time-state-modeling-pre-run-change-5/README.md
  - lanes/eng-planted/e1/commands.ts
---

# Pre-run change 6 to the design-time state modeling eval

## In short

- The ledger binds a run to the folder of its first driver lease, and refuses a driver lease on that run from any other folder. Attempt 3 met the same rule and gave its authoring, comparison and stock builds one driver folder (dated pre-run fix, 2026-11-17).
- In eval 1 the hinted authoring builds used e1/author/driver and eval 1's builds used e1/builds/driver. The hinted builds leased first, so every later pilot or counted build would have been refused.
- The first pilot build command stopped earlier, at the per-run driver lock, because the hinted builds were still running. It opened no lease and ran no session. Reading the code showed that the folder rule would refuse it next.
- The fix: both stages use one driver folder, e1/author/driver, the folder the run is already bound to.
- Nothing else changes. No new money, no change to any cap, item, arm, model, prompt, pilot check, threshold or Decision row. The hinted builds and eval 1's builds still cannot run at the same time on one host, because the driver holds one lock per run.

This change governs where it and the plan differ.

## The change

`e1Driver(run)` in lanes/eng-planted/e1/commands.ts names the folder, and `ep e1-author --step hinted` and `ep e1-builds` both pass it to the build launcher. Each cell keeps its own key, so the hinted cells and eval 1's build cells do not collide in the driver's records.

The tests in tests/ep/e1/commands.test.ts check that the hinted step and the pilot builds both hand the launcher this one folder.
