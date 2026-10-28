---
id: 2026-10-28-gsta-9-sealed-manifest-glob-gap
kind: finding
title: The sealed guard cannot let sealed/<set>/MANIFEST.json through while refusing task bodies beside it
summary: gstack-pregate's sealed globs have no exceptions, so U1 refuses all of sealed/ and protected/. Before the first seal (M2b), gstack needs an exception list or the manifests need to move.
author: GSTA-9
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: open
links:
  - .gstack/pregate.json
  - tests/sealed.test.ts
  - https://github.com/garrytan/gstack-evals/pull/3
---

# The sealed guard and the manifest layout do not fit

## What we found

Plan v3.2 puts each sealed set's digests at `sealed/<set>/MANIFEST.json` and the protected set's at `protected/MANIFEST.json`. Those are the folders where a held-out task body would land if one were copied in by mistake.

`gstack-pregate sealed` is the check that keeps held-out material out of a public push. Its path globs know only `*`, `**` and `?`, with no character classes and no exceptions. Its waivers in `.gstack/sealed-allow.tsv` match one commit sha each, so they cannot exempt a file for good.

So no rule can refuse `sealed/<set>/tasks.json` and still let `sealed/<set>/MANIFEST.json` through. U1's first config refused only nested paths (`sealed/*/*/**`), and the automatic review of PR #3 caught that a task body directly under a set got past it.

## What U1 did

The config now refuses every file under any folder whose name starts with `sealed`, `protected`, `heldout`, `held-out`, `held_out`, `hold-out` or `holdout`, in the casings the config lists, at any depth. It fails closed. Nothing in v1.0 writes there, since the first seal comes in M2b (earliest 2027-01-08) and needs a second principal first. `tests/sealed.test.ts` checks direct and nested bodies against the config, using the same glob rules gstack-pregate uses.

## What has to happen before the first seal

1. **Ask gstack for an exception list (recommended).** Add a field such as `sealed.allow_paths`, read from the base branch like the rest of the policy, so `sealed/*/MANIFEST.json` and `protected/MANIFEST.json` pass while everything beside them is refused. This keeps the plan's layout and fixes the gap for every repo that uses the guard. It is a request to GStack Minder, through the Captain.
2. **Or move the manifests out of the refused trees.** For example, use `manifests/sealed-<set>.json` and `manifests/protected.json`, and keep every `sealed/` and `protected/` folder refused. A folder named `sealed` under `manifests/` would be refused too. This needs no gstack change, but it changes the plan's layout, which the M2b unit and the plan would have to adopt.

Until one of these lands, a unit that commits a manifest under `sealed/` or `protected/` gets SEALED_OUTPUT_REFUSED.
