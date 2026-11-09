# Devex eval

Code for the preregistration in wiki/plans/2026-11-09-geva-417-devex-review-intentions-prereg/: does a review by gstack's
plan-devex-review (and autoplan's default lean run) anticipate more of the getting-started, error, docs and upgrade trouble
real developers hit in the 60 days after a change shipped than the same model with no gstack, or with one line of
developer-experience framing?

Nothing here holds unit text, keys or reviews. Units, keys, alias maps, judge labels, stage 3 recipes and every review stay
sealed outside the repo; the repo gets counts and digests only. No command here spends without a ledger item and its lease.

## Layout

- types.ts: the shapes every part codes against (units, keys, alias maps, rows, labels, dry-run lines).
- cli.ts: `gstack-evals dx <command>`, one module per subcommand.
- mine/: the shared frame and miner for this eval and the design eval (frame-rules.md of the design prereg), the devex-only
  filters applied after the shared exclusive assignment, release ancestry, the window reader and the free screen.
- unit/: the snapshot builder (the instruction-file strip, one commit, no remote) and the alias map.
- author/: authoring under custody: the classifier, plan rewrite, triage, key read, audits and recognition probe; the
  sets, the miss sample and the supply rules.
- run/: the review run side's readers: the plan-changes parser, the exposure detectors, the Stop hook repair and rows with
  section 6's failure table and recovery rule. The sessions run through review-units --plan devex (src/trial/review).
- score/: packets, judges, scoring and the frozen readings of sections 7, 8, 10 and 11.
- stage3/: section 12's goals, checkers and probes, build arms, docs-only first success and the VM sandbox.
- leases.ts: the frozen runs, their line items and lease sizes (section 14).
- dryrun.ts: section 15 rule 4's keyless dry run; each part plugs in through its checks.ts.

Shared parts generalized from the product-value build live in lanes/aftermath/, with product-value's own files as thin
bindings: the metered client with its per-model stop (meter.ts) and the scoring and judging core.
