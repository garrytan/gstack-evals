# gstack-evals

An outcome-graded eval rig for [gstack](https://github.com/garrytan/gstack), being built. It exists to steer gstack's research and development: which skills help, on which models, at what cost, and where gstack loses. It reports losses plainly, including a gstack skill that loses to no skill or to a placebo.

Everything here describes the repository at `VERSION` (gstack-evals v0.0.1): the skeleton. The v1.0 rig runs no evals yet; exploratory quick looks under quick/ run outside it, each preregistered in wiki/. The approved plan is plan v3.2 in [wiki/](wiki/README.md), split into build units U1 to U18 by the v1.0 build breakdown.

## What v1.0 will answer

| Part | Question | Status |
|---|---|---|
| Lane A, `gstack-evals skill-eval` | Did an edited skill (a diet or a rewrite) lose anything the old one did, on your tasks, host and model? | being built (M1a, M1b) |
| Review replay lane | Does a gstack reviewer role catch a known historical defect, at which model and effort, and at what cost? | planned (M1c) |
| Martian /review replication | Does the third-party result on gstack's /review prompt hold under a re-pinned judge? | planned (M1c) |
| Pilot report | What do these cost, how noisy are they, and how should the v1.1 outcome-graded lane be sized? | planned |

## Commands

`bin/gstack-evals` lists every planned command. A command that is not built yet exits 2 with E_USAGE and says which unit builds it.

```
bun install && bun link
gstack-evals --help
```

## Layout

| Path | What |
|---|---|
| [bin/gstack-evals](bin/gstack-evals) | The CLI; its command table is in [src/cli.ts](src/cli.ts) |
| [src/](src/README.md) | The code, one folder per part of the plan, each naming its build unit |
| [src/errors/codes.ts](src/errors/codes.ts) | Every reason code, one object per code; [docs/errors.md](docs/errors.md) is generated from it |
| [src/types.ts](src/types.ts) | Interfaces that more than one unit codes against: arms, leases, reservations, outcomes, the error record |
| [schema/](schema/README.md) | Public-safe JSON schemas: tasks and arms (U5) so far, the verdict schema with U6 |
| [docs/](docs/) | The [budget ledger guide](docs/budget-ledger.md), reason codes and adapters |
| [spikes/harbor/](spikes/harbor/README.md) | U8's throwaway Harbor runner spike, with a fake upstream and keyless tests |
| [quick/replay/](quick/replay/README.md) | GSTA-11's exploratory review replay on known gstack bugs, with a fake upstream and keyless tests; [preregistration](wiki/plans/2026-10-28-gsta-11-review-replay-prereg.md) in wiki/ |
| [wiki/](wiki/README.md) | Plans, designs, research, decisions and handoffs, as immutable posts. `bun run wiki:index` writes an index of them to wiki/INDEX.md |
| [.gstack/pregate.json](.gstack/pregate.json) | The sealed-output config `gstack-pregate sealed` checks before every push |
| [NOTICE.md](NOTICE.md) | Every vendored or planned-vendored source and its licence |
| [TODOS.md](TODOS.md) | Open items carried from the plan |

## Checks

None of these need a key, locally or in CI.

```
bun install
bun test
bun run typecheck
bun run errors:check
bun run wiki:check
```

Held-out task bodies, hidden tests and answer keys never enter this repo; it commits only counts and digests. See [AGENTS.md](AGENTS.md).

## Licence

MIT, see [LICENSE](LICENSE). Vendored code keeps its own notices, listed in [NOTICE.md](NOTICE.md).
