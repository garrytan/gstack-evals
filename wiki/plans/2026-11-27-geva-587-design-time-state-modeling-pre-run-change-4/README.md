---
id: 2026-11-27-geva-587-design-time-state-modeling-pre-run-change-4
kind: plan
title: "Pre-run change 4 to the design-time state modeling eval: each pilot pair can run as its own command"
summary: "Adds --pair to the pilot's review command, so each of the 14 pairs opens its one lease after its own admission record; no cap, arm, prompt, check or Decision row changes."
author: GEVA-587
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-27
status: open
links:
  - wiki/plans/2026-11-24-geva-587-design-time-state-modeling-prereg/README.md
  - wiki/plans/2026-11-24-geva-587-design-time-state-modeling-pre-run-change-2/README.md
  - wiki/plans/2026-11-26-geva-587-design-time-state-modeling-pre-run-change-3/README.md
  - lanes/eng-planted/e1/commands.ts
---

# Pre-run change 4 to the design-time state modeling eval

## In short

- The pilot's review command runs the 14 arm and model pairs one after another, each under its own lease on e1-pilot. The item requires admission, and the ledger checks an admission record for each lease's slot. `rig admit` writes only the record for the item's next slot. So one command can open the first pair's lease, and the second pair's lease would refuse with E_RIG_UNPROVEN before any spend.
- The keyless dry run did not catch this. Its driven launch of the pilot passes a stub admission check, and its ledger part opens one lease per item.
- The fix: `ep e1-reviews --phase pilot` takes an optional `--pair <arm>-<model>`, such as `d-opus`, and then runs only that pair. Each pair runs as its own command, right after its own `rig admit --item e1-pilot --proof trial`.
- Nothing else changes. No new money, no change to any cap, item, arm, model, prompt, pilot check, threshold or Decision row. The pilot still runs every pair on the same 6 calibration units, and its builds still run under one lease once every pair's reviews are in.

This change governs where it and the plan differ.

## The change

Without `--pair`, the command behaves as before. With it, the pilot runs the one pair it names. It refuses with E_USAGE, before any lease, when the pair does not run (P runs on Opus and particle-1 only, prereg section 4) or when the phase is comparison, whose item already names its pair.

The test in tests/ep/e1/commands.test.ts runs one pair under one lease, and checks that an unknown pair and a comparison command with `--pair` both refuse with no lease opened.
