# Open work

Open items carried from plan v3.2 ("Open items" and "Owner actions") and from building U1. Build units and their status live in the v1.0 build breakdown and the wiki handoff posts, not here, so unit PRs do not collide on this file. Each box stays open until the work is verified here.

## From the plan

- [ ] **OpenRouter's Anthropic-compatible endpoint with author-pinned providers in Claude Code.** Verified in the M2 feasibility smoke.
- [x] **Harbor with our base URL, baked arms, the separate verifier and the SDK-driven Claude Code agent.** Settled by the U8 spike: all pass, with the conditions in [its finding](wiki/board/2026-10-28-gsta-10-harbor-spike-lane-b-runner.md) and the Lane B section of docs/adapters.md.
- [ ] **A SWE-rebench slice newer than 2026-10-17.** Checked in Phase 2b; if none exists, mint instead.
- [ ] **Open weights for Step 5 Preview, Muse Spark 1.3 and Hy4 Preview.** Unverified; matters only if the ladder grows past two open-weight rungs.
- [ ] **Offers to gstack, through the Captain (U12).** The state-root convention (`GSTACK_STATE_ROOT` and `GSTACK_HOME`), a `resumable` field, the lock step in /write-skill's diet.md step 6, and office-hours' contract tasks.
- [ ] **Garry's reading of decision 15 and his pick of decision 9's design.** Asked at the pilot report, with the parity SD estimate (U15).
- [ ] **Credentials at build time.** Anthropic and OpenAI keys for the program ledger before the Lane A shakedown; an OpenRouter key before the M2 feasibility step; the sealed key under the second principal before anything is sealed.

## From U1

- [ ] **Sealed manifests under the sealed guard.** `.gstack/pregate.json` refuses all of `sealed/` and `protected/`, the plan's manifests included, because gstack-pregate's globs cannot exempt one file. Before the first seal (M2b), gstack adds an exception list or the manifests move. See the wiki finding `2026-10-28-gsta-9-sealed-manifest-glob-gap`.

- [ ] **The skill-eval flag that names a run's line item.** Interface v0.4 leaves it open; U4 and U7 settle it.
- [ ] **Owners for src/arms/ and src/runner/pricing/.** The breakdown lists them in no unit's files. The arm-spec grammar (U7) and the proxy (U3) are their first users.
- [ ] **Commands with no unit yet.** `plan`, `run`, `score`, `report` and `seal` are v1.1; `compare` waits for the factory loop's keep rule. Their module paths in src/cli.ts are placeholders.
