# gstack-evals

Evals for [gstack](https://github.com/garrytan/gstack): do its skills help, on which models, and at what cost? The answers steer gstack's research and development. A gstack skill that loses to no skill, or to a placebo, is reported as plainly as one that wins.

gstack-evals is at v0.0.1 (see [VERSION](VERSION)). The shared rig is still being built. Exploratory runs live under [quick/](quick/) and [lanes/](lanes/), and each paid run is preregistered in [wiki/](wiki/README.md) before it starts.

## How a result is made

1. A preregistration states the question, the arms, the tasks, the models, the scoring rules, the spend cap and the stop rule. It merges in its own pull request, before any result.
2. Since 2026-10-31, every head-to-head includes a no-gstack arm: the same model, tasks and harness with no gstack installed and a plain prompt. Many also include a placebo arm.
3. The run spends only through a budget ledger. A run that hits its cap stops and is reported as incomplete; it is never rerun to change a verdict.
4. A results post reports each skill's lift per model with its interval. A null result states the control arm's rate and the smallest effect the test could have seen, and says why it came out null.

Held-out task bodies, hidden tests and answer keys never enter this repo. They are sealed outside it, and the repo commits only their counts and digests, so a reader can check later that nothing changed.

## Where findings live

| Path | What |
|---|---|
| [wiki/board/](wiki/board/) | Findings, results, decisions and handoffs. Results posts have `results` in their name |
| [wiki/plans/](wiki/plans/) | Plans and preregistrations |
| [wiki/research/](wiki/research/) | Background research |

A merged post never changes except for its `status`; a correction is a new post that supersedes the old one. The one exception is an owner-directed edit recorded by a waiver row in `wiki/edits/<name>.tsv` (see [wiki/README.md](wiki/README.md), rule 2). Run `bun run wiki:index` to write wiki/INDEX.md, a local list of every post with its kind and status.

Posts and commits use ids like GSTA-12, GEVA-105 or GST-618. These are thread and issue codes from the agent crew that builds this repo for Garry Tan. They are labels for provenance, not links you can follow.

## Run the keyless checks

You need [Bun](https://bun.sh) 1.4.4 (the version CI pins). None of these need an API key.

```
bun install --frozen-lockfile
bun test
bun run typecheck
bun run errors:check
bun run wiki:check
```

The Docker tier needs Docker and no key: `bin/gstack-evals rig tier --out <dir>`. [docs/rig.md](docs/rig.md) gives the Docker setup it expects.

The paid evals need provider keys, a merged preregistration and an approved spend cap. Outside contributors are not expected to run them.

## Layout

| Path | What |
|---|---|
| [bin/gstack-evals](bin/gstack-evals) | The CLI; its command table is in [src/cli.ts](src/cli.ts). A command that is not built yet exits 2 with E_USAGE |
| [src/](src/README.md) | The rig's code |
| [lanes/](lanes/) | Eval lanes: their tasks, arms, scorers and frozen inputs |
| [quick/](quick/) | Exploratory quick looks that ran before the rig, each with keyless tests |
| [spikes/](spikes/) | Throwaway feasibility spikes |
| [schema/](schema/README.md) | JSON schemas for tasks, arms and verdicts |
| [docs/](docs/) | Guides: the [rig](docs/rig.md), the [budget ledger](docs/budget-ledger.md), [adapters](docs/adapters.md), [skill-eval](docs/skill-eval.md), [stacks](docs/stacks.md) and the generated [reason codes](docs/errors.md) |
| [tests/](tests/) | Keyless tests |
| [.gstack/pregate.json](.gstack/pregate.json) | The pregate policy: the sealed-output rules that `gstack-pregate sealed` checks before every push and that CI checks on every pull request and every push to main, the test lanes, and the CI carry map (`run_profiles`, `ship_lanes_from`) that lets gstack's /ship and pregate reuse a green `ci.yml` run at the same tree for the lanes `bun test`, `bun run typecheck`, `bun run errors:check` and `bun run wiki:check`, each matched byte for byte |
| [NOTICE.md](NOTICE.md) | Every vendored or adapted source and its licence |

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before you open an issue or a pull request. In short: bug reports need a repro on current main, and outside code is read, then rebuilt by the crew rather than merged as is.

Report security problems privately, as [SECURITY.md](SECURITY.md) describes. That includes any secret, held-out task or answer you find in this repo or its history.

## Licence

MIT, see [LICENSE](LICENSE). Vendored code keeps its own notices, listed in [NOTICE.md](NOTICE.md).

## Disclosures

gstack is Garry Tan's own project.
