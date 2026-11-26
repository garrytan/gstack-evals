---
id: 2026-11-26-geva-587-design-time-state-modeling-pre-run-change-3
kind: plan
title: "Pre-run change 3 to the design-time state modeling eval: the pilot and its preparation open on 2026-11-26"
summary: "Moves the opening time for pilot preparation and the pilot only, on the owner's go; counted cells keep 2026-11-28 06:00Z and still wait for the Captain's ruling on the pilot."
author: GEVA-587
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-26
status: open
links:
  - wiki/plans/2026-11-24-geva-587-design-time-state-modeling-prereg/README.md
  - wiki/plans/2026-11-24-geva-587-design-time-state-modeling-pre-run-change-2/README.md
  - lanes/eng-planted/e1/commands.ts
---

# Pre-run change 3 to the design-time state modeling eval

## In short

- The prereg's run order starts paid work "From 2026-11-28 06:00Z". On 2026-11-26 at 21:08:58Z the owner approved starting this eval's pilot now. The Captain checked that approval against its source and recorded it in its approvals file before this change.
- From that instant, pilot preparation and the pilot may run: rebuilding the pool from custody, the two state screens, authoring and hinted builds for units the draw reaches, the draw, and the pilot's reviews and builds on the 6 calibration units.
- Counted cells keep the prereg's opening time, 2026-11-28 06:00Z. They also still wait for the Captain's ruling on the pilot readout, as the prereg and the approval both say.
- Nothing else changes. No new money, no change to any cap, item, arm, model, prompt, pilot check, threshold or Decision row.

This change governs where it and the plan differ.

## The change

The prereg's run order, step 3, read "From 2026-11-28 06:00Z: rebuild the pool from custody and check each unit against its sealed digests; the two state screens on the pool; the calibration draw; wave 2 if needed, alongside the pilot." Step 3 and the pilot now open at 2026-11-26T21:08:58Z. Every step after the pilot readout is unchanged.

The harness enforces both times. Each paid e1 command checks the clock before it opens a lease (lanes/eng-planted/e1/commands.ts, E1_NOT_BEFORE):

| Commands | Opens at |
|---|---|
| ep e1-screen, ep e1-author (item e1-supply) | 2026-11-26T21:08:58Z |
| ep e1-reviews and ep e1-builds with --phase pilot (item e1-pilot) | 2026-11-26T21:08:58Z |
| ep e1-reviews and ep e1-builds with --phase comparison (the 14 counted items) | 2026-11-28T06:00:00Z |

Before its time, a command refuses with E_USAGE and opens nothing. The tests in tests/ep/e1/commands.test.ts run the guard on both sides of each time: a second before the pilot's time, every pilot and preparation command refuses; a second after it, the pilot runs while every counted command still refuses; after the counted time, a counted command runs. A counted command also still needs e1/comparison.json, which ep e1-freeze writes only after the pilot (pre-run change 2, section 9).

## What this does not change

The pilot's checks and its cap ($165, each arm within a tenth of its counted budget), the supply cap ($220), the hosts cap ($200), the 14 counted items and their caps, the $4,913 cap total and the $5,000 all-in stop. The pilot readout goes to the Captain before any counted cell, and the Captain's ruling on it decides what runs next.
