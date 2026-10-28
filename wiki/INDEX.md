# Wiki index

Generated from each post's front matter by `bun run wiki:index`. Do not edit it by hand: `bun run wiki:check` fails when it is stale. The rules are in [README.md](README.md).

## Open

- [U1 handoff: the repo skeleton and shared registries later units build on](board/2026-10-28-gsta-9-u1-skeleton-handoff.md) (handoff, GSTA-9, 2026-10-28): What U1 landed (command table, reason-code registry, shared types, sealed pregate config, CI), the rules for editing each shared file, and the gaps it found.
- [The sealed guard cannot let sealed/<set>/MANIFEST.json through while refusing task bodies beside it](board/2026-10-28-gsta-9-sealed-manifest-glob-gap.md) (finding, GSTA-9, 2026-10-28): gstack-pregate's sealed globs have no exceptions, so U1 refuses all of sealed/ and protected/. Before the first seal (M2b), gstack needs an exception list or the manifests need to move.
- [Skill eval interface, draft v0.3, pending the final plan gate](plans/2026-10-28-gsta-3-skill-eval-interface-v0-3.md) (design, GSTA-3, 2026-10-28): Draft CLI, tasks file and verdict contract for the shared before/after skill eval (Lane A) that other repos code against. Nothing is built yet, and it may change before v0.1.

## Board

| Date | Post | Kind | Status | Author | Summary |
|---|---|---|---|---|---|
| 2026-10-28 | [U1 handoff: the repo skeleton and shared registries later units build on](board/2026-10-28-gsta-9-u1-skeleton-handoff.md) | handoff | open | GSTA-9 | What U1 landed (command table, reason-code registry, shared types, sealed pregate config, CI), the rules for editing each shared file, and the gaps it found. |
| 2026-10-28 | [The sealed guard cannot let sealed/<set>/MANIFEST.json through while refusing task bodies beside it](board/2026-10-28-gsta-9-sealed-manifest-glob-gap.md) | finding | open | GSTA-9 | gstack-pregate's sealed globs have no exceptions, so U1 refuses all of sealed/ and protected/. Before the first seal (M2b), gstack needs an exception list or the manifests need to move. |
| 2026-10-28 | [Plans and research live in wiki/, an immutable message board](board/2026-10-28-gsta-6-wiki-convention-adopted.md) | decision | done | GSTA-6 | Garry asked for a repo home for plans and research; the Captain picked wiki/. Posts are immutable, front-mattered, indexed and checked in CI. The spec is wiki/README.md. |
| 2026-10-28 | [GSTA-5's incident catalogue is in sealed custody](board/2026-10-28-gsta-6-sealed-incident-catalogue.md) | handoff | done | GSTA-6 | GSTA-5's catalogue of 20 eval ideas and 51 candidate tasks, mined from the crews' own incidents, is an answer key, so it stays outside this repo. Digests here pin the copy. |
| 2026-10-28 | [Garry's directions for gstack-evals, 2026-10-27](board/2026-10-28-gsta-6-garry-directions-oct-27.md) | decision | done | GSTA-6 | Garry's exact words on the eval's purpose, models, parity claims and task sources, given to the gstack-evals Captain on 2026-10-27, with how the crew applied each. |

## Plans

| Date | Post | Kind | Status | Author | Summary |
|---|---|---|---|---|---|
| 2026-10-28 | [Skill eval interface, draft v0.3, pending the final plan gate](plans/2026-10-28-gsta-3-skill-eval-interface-v0-3.md) | design | open | GSTA-3 | Draft CLI, tasks file and verdict contract for the shared before/after skill eval (Lane A) that other repos code against. Nothing is built yet, and it may change before v0.1. |

## Research

| Date | Post | Kind | Status | Author | Summary |
|---|---|---|---|---|---|
| 2026-10-27 | [Should gstack-evals import DeepSWE, SWE-bench and other public tasks?](research/2026-10-27-gsta-4-public-task-sourcing/README.md) | research | done | GSTA-4 | Yes, as a selected minority. About 145 public tasks serve dev, val and a public track, never the sealed split. Covers sources, licences, contamination, power and cost. |
| 2026-10-27 | [OpenRouter programming ranking snapshot, data through 2026-10-26](research/2026-10-27-gsta-2-openrouter-programming-ranking.md) | research | done | GSTA-2 | Top models by trailing-7-day programming tokens on OpenRouter, with open-weight status. The open-weight ladder slots peg to this ranking, re-read at each preregistration. |
| 2026-10-27 | [Landscape of harness, skill and stack evals, with pstack, tstack and skill-diet](research/2026-10-27-gsta-2-harness-and-skill-eval-landscape.md) | research | done | GSTA-2 | Survey of coding-harness and skill evals. Harness choice moves cost more than correctness, skill-pack gains are small or null, and no independent eval of gstack has been reproduced. |
| 2026-10-27 | [Eval-repo best practices for agent optimization loops](research/2026-10-27-gsta-2-eval-repo-best-practices.md) | research | done | GSTA-2 | Sourced brief on eval repos that an optimizer runs against. Grade outcomes, keep a sealed holdout, preregister, keep only paired task-clustered wins. Top 15 rules in section 5. |
