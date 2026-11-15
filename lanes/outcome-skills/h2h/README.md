# The skill-pack head-to-head lane (h2h)

The keyless build for the preregistration in wiki/plans/2026-11-15-geva-538-skill-pack-h2h-prereg/README.md (the post).
The post is the source of truth, and its prereg.json holds every frozen value the code reads (prereg.ts). This file
records the rules as built and the readings this build chose where the post leaves a detail open. The lane reuses the
state machines harness (lanes/outcome-skills/statemachines/) and the pstack-checks lane (lanes/outcome-skills/pfchecks/)
read-only.

## Parts

- Shared: prereg.ts (reads prereg.json; H2hError and h2hFail), types.ts (the records every part codes against) and
  items.ts (the ledger items at planning prices).
- Part A, arms and sessions: the install recipes, pins check, browser runtimes, turns (entries, question reply,
  continuation, DONE rule), the session driver, exposure detectors, the read audit, containment over arm homes and the
  driven launch against a fake provider.
- Part B, breadth units: the B2 advisory miner and B1 pull-request miner and their frozen frames, the per-ecosystem image
  recipes, test-command and report-parser rules, the image store by digest, the browser-engine check, the 5+5 browser
  oracle, the launcher wrapper and the label step.
- Part C, ordinary units, scoring and analysis: the O frame and draw, the scoring additions, the analysis (cluster-aware
  test, Holm, bootstrap, row states, secondaries, piece G, the sealed stage 1 readout), the ledger dry run over the items,
  and the rerun command.

Every refusal prints its reason code first (docs/errors.md, codes E_H2H_*).
