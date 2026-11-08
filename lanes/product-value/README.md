# Product-value eval

Code for the preregistration in wiki/plans/2026-11-08-geva-403-product-value-prereg/: does a plan review by gstack's
plan-ceo-review (and, one level up, office-hours) anticipate more of what real users raised and what the project built
after launch than the same model with no gstack, or with a one-line founder framing?

Nothing here holds unit text, keys or reviews. Units, keys, transposition sources, judge labels and every review stay
sealed outside the repo; the repo gets counts and digests only.

## Modules

- meter.ts: the metered client. Every direct model call goes through one lease of one ledger line item and an
  in-process metering proxy, with a reply cache keyed by model and request digest.
- cli.ts: `gstack-evals pv <command>`, one module per subcommand.

## Review run side (GEVA-406)

review-units --plan product-value (src/trial/review/pv-cli.ts) runs the sessions. This lane reads them:

- pv parse <reply.txt | transcript.ndjson> prints the strict or lenient parse, the normalized list and its counts.
- pv exposure --session <dir> --skill plan-ceo-review|office-hours [--brief <brief.md>] prints one session's detector checks.
- pv rows --run <dir> [--run <dir> ...] --out <rows.jsonl> writes one row per planned session. The out file must sit outside the repo.

### Build-time choices

The prereg leaves these mechanics open. Each one is tested in both directions under tests/pv/.

1. **Which block.** The strict parse reads the last plan-changes fence in the last main-agent text that holds one. The one lenient parse reads that labelled block when there is one, else the last fence of any label. It records what it used: label, commas, array.
2. **Normalizer.** It drops non-string items, then keeps the first five. Per item it keeps link and image text, drops code ticks and emphasis markers, strips leading headings, bullets and numbering such as 1. or (2) until none is left, collapses whitespace and keeps the first 40 words.
3. **End states.** A parsed block wins over how the session ended, so a timeout with a block is block. A completion or a turn cap with no block is no-block. A timeout or E_BACKGROUND_DEADLINE is a harness timeout, allowance_stop an allowance stop, and arm_failure or an unreadable transcript a crash. A provider failure whose text says the prompt or context was too long is a context overflow; any other is an API error. A cap stop has no end state and counts as not run.
4. **Retry.** An infrastructure failure moves the attempt to p<n>-attempt1 and runs once more under its named reason. The cap check counts two attempts per session, and spend sums both.
5. **Web contamination.** Any successful WebSearch or WebFetch result, a subagent's or a server-side one included, makes the session contaminated (E_PV_WEB_CONTAMINATED). It is excluded as missing. A refused call does not count.
6. **Handoff line.** It counts from a successful main-agent Bash call to gstack-ceo-mode-handoff, in any of the three forms the pinned script prints. A line the command itself echoes does not count.
7. **Sections 9 and 10.** They are read from the main agent's text and from what its successful Write, Edit and MultiEdit calls wrote. A subagent's text does not count.
8. **0F proposals.** A proposal is a sighting with an effort (S, M, L or XL) and an impact, from a table with proposal and effort columns, a heading section or a list item. Sightings merge by their lowercased title words. The status is the last one stated, and pending when none is.
9. **expansion_in_block.** A block change carries a proposal when it shares at least half of the title's content words and at least two, or all of a one-word title.
10. **office-hours.** A design doc is a non-empty regular file at projects/<slug>/*-design-*.md in the session's copied state root (host/gstack-state, symlinks skipped). premises_overlap needs at least 3 shared three-word sequences between its Premises section and brief.md. The best doc decides.
11. **Rows.** Exposure is read only for a skill session that ended block or no-block; other rows carry exposed null. A planned session with no journal entry is a missing row with spend null. The opt-in gate arm (plan-ceo-review-gate, smoke rule 3) reads as the skill arm. Rows refuse mixed families or fallback settings and a session planned twice.

