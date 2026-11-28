---
id: 2026-11-28-geva-587-design-time-state-modeling-pre-run-change-7
kind: plan
title: "Pre-run change 7 to the design-time state modeling eval: the walk passes an unforeseeable unit once calibration is full"
summary: "Once calibration is full, the draw skips an unforeseeable unit still owed its hinted build or screen, so the walk no longer waits on a unit no step will finish. No cap, arm, prompt or check changes."
author: GEVA-587
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-28
status: open
links:
  - wiki/plans/2026-11-24-geva-587-design-time-state-modeling-prereg/README.md
  - wiki/plans/2026-11-24-geva-587-design-time-state-modeling-pre-run-change-2/README.md
  - wiki/plans/2026-11-27-geva-587-design-time-state-modeling-pre-run-change-6/README.md
  - lanes/eng-planted/e1/supply.ts
---

# Pre-run change 7 to the design-time state modeling eval

## In short

- An unforeseeable unit (both foreseeability ratings "no") serves calibration only. Once calibration is full, the draw always skips it, whatever its screens say.
- The hinted step and the screen step choose their units from a stand-in walk that treats owed work as done. That walk skips an unforeseeable unit once calibration is full, so neither step ever builds or screens it.
- The real walk checked for owed work first. So it stopped at the first unforeseeable unit still owed its hinted build and waited for work no step would do. This run hit that: the hinted builds finished every unit they owed, and the screens then found nothing to screen, because the walk stopped at such a unit in the pool segment.
- The fix: once calibration is full, the walk skips an unforeseeable unit that is still owed its hinted build or screen, with the reason "unforeseeable", in place of waiting on it.
- Nothing else changes. No new money, no change to any cap, item, arm, model, prompt, pilot check, threshold or Decision row.

This change governs where it and the plan differ.

## Why the sets cannot change

With every step done, such a unit is skipped for its screens, its repository or its ratings. Each of those paths skips it, and a skipped unit takes no set and no repository slot. So skipping it early leaves every set and the order of every placed unit as they would be. Only its skip reason can differ. A unit that its screens already dropped keeps its screen reason, because the early skip applies only while the unit is still owed. Before calibration is full, the walk still waits on the unit, because calibration takes unforeseeable units.

The test in tests/ep/e1/supply.test.ts covers both cases. With calibration full, an owed unforeseeable unit is skipped and the walk goes on to the next unit. With calibration one short, the walk still waits on it.
