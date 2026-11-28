---
id: 2026-11-26-geva-590-review-models-pre-run-change-10
kind: plan
title: "Pre-run change 10 to the review-models eval: the pilot opens on 2026-11-26"
summary: "The pilot and the paid preparation it needs open at 2026-11-26 21:30Z instead of 2026-11-28 06:00Z. Counted steps keep 2026-11-28 06:00Z and still wait for the pilot readout."
author: GEVA-590
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-26
status: done
links:
  - wiki/plans/2026-11-24-geva-590-review-models-prereg/README.md
  - wiki/plans/2026-11-25-geva-590-review-models-pre-run-change-9.md
---

# Pre-run change 10 to the review-models eval

## In short

- The pilot, and the paid preparation it needs, may start at 2026-11-26 21:30Z. Until now nothing paid could start before 2026-11-28 06:00Z.
- Counted steps keep 2026-11-28 06:00Z, and they still wait until the gstack-evals Captain has read the pilot readout.
- Nothing else changes: no cap, item, envelope, arm, model, judge, labeller, gate, drop rule or decision-table row.

This change governs where it and changes 1 to 9 differ. Change 9's line that the pilot opens on 2026-11-28 is replaced by this one.

## Why

Garry approved on 2026-11-26 starting this pilot now rather than on 2026-11-28. The gstack-evals Captain checked that approval against its source and passed it on the same day. It moves only the pilot's not-before time. It adds no money and opens no counted run.

## What the code enforces

lanes/review-models/score/opening.ts holds the two times. Each paid command checks its phase before it spends, and refuses with E_RM_NOT_OPEN when it runs too early:

| Command | Phase | Opens |
| --- | --- | --- |
| rm-supply vis-send (the B visibility read) | pilot | 2026-11-26 21:30Z |
| rm-run pilot (not with --dry-run) | pilot | 2026-11-26 21:30Z |
| rm-post judge-send and label-send, pilot batch | pilot | 2026-11-26 21:30Z |
| rm-post second-read-send | pilot | 2026-11-26 21:30Z |
| rm-post judge-send and label-send, validation batch | counted | 2026-11-28 06:00Z |

No flag or environment variable moves either time. A counted run has no command yet, and when one is built it checks the counted time. The Captain's read of the pilot readout is a gate the run follows by procedure, not one the code can check.

## Unchanged

- The pilot envelope of $1,034 and every per-arm pilot lease.
- The staged cap of $6,178 and the full path's $14,758. The full path, where Fable runs in the counted run, still needs Garry's go-ahead.
- The pilot checks (R111), the Grok 4.7 labeller and the Carbon judge gate (R78), and the frozen Fable drop rule.
