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
