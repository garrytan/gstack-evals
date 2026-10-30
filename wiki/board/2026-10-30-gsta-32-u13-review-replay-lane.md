---
id: 2026-10-30-gsta-32-u13-review-replay-lane
kind: handoff
title: "U13 review replay lane: what landed and what U14 and U16 need"
summary: U13 vendored GSTA-131's review panel, added the review token table and rebuilt the replay runner on the proxy and ledger. All keyless. Cases and paid runs come next.
author: GSTA-32
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-30
status: open
links:
  - https://github.com/garrytan/gstack-evals/pull/54
  - https://github.com/garrytan/gstack-evals/pull/55
  - https://github.com/garrytan/gstack-evals/pull/56
  - lanes/review-replay/README.md
  - tables/review-tokens.json
---

U13 builds the review replay lane (M1c) in three pull requests. None of them makes a paid call, and every test uses a fake upstream. The lane README is the reference; this post says what is done and what the next units pick up.

## What landed

- #54 (U13b) adds tables/review-tokens.json, one row per model, reviewer role and effort, and `gstack-evals tokens export`, which prints the object gstack's scripts/review-dispatch-compare.ts reads through --tokens. Only the two Opus 5.5 specialist rows exist, at n 6, so both are flagged. Any other model, role or effort exits 2 with E_TOKENS_COVERAGE.
- #55 (U13a) vendors GSTA-131's two panel evals under lanes/review-replay/panel/ with their digests, and adds the catalog schema with the decoy audit field and two public seed cases. Case 3 of the source panel is from a private repo, so only its digest is committed.
- #56 (U13c) rebuilds the runner as lanes/review-replay/run.ts. It spends only through the metering proxy and a ledger lease, reserves each call's real maximum, never retries, never resends an unknown outcome and never classes an item infra. It adds E_REPLAY_PLAN and E_REPLAY_TRANSPORT.

## GSTA-11 rerun preconditions

#56's body maps each precondition and gap to a test name or to the unit that owns it. The runner covers preconditions 1, 2, 3, 6 and 7, the runner half of 4, G3, G6, G7 and both rig notes. Precondition 9 and G8 ride on U13a's build script. These stay open for U16, because they belong to the scorer or the judge: the judge half of 4, 5, 8, G1, G2, G4 and G5.

## What the next units need

- U14 mines cases into lanes/review-replay/catalog/public/ and the sealed store, using the same schema. Every decoy, including the two seeds' fix commits, has a null audit. A decoy scores as clean only after its audit says clean.
- U16 runs paid replays. It needs a committed preregistration, a cap Garry approved on a ledger line item, and a plan file whose cut_off is stated, since the runner has no default. Its scorer owns the move from missing to infra, through a preregistered incident list.
- review-dispatch-compare covers only the Opus 5.5 specialist role until paid runs add rows to the token table. Rows stay flagged until n reaches 10.

## Notes

#56 adds 1,051 lines, slightly over the 1,000-line target for a PR, because the two README sections landed with it rather than in a follow-up.
