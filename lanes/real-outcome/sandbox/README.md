# The ship sandbox

Each real-outcome trial ships into this sandbox instead of a real host (plan [2026-11-01-geva-87](../../../wiki/plans/2026-11-01-geva-87-real-outcome-lane-plan/README.md), open items 1, 3 and 6). The sidecar runs beside the metering proxy, outside every trial container, and owns everything that decides what shipped.

| File | What it is |
|---|---|
| `sidecar.ts` | One process per batch. Per trial: a bare origin seeded with the base branch only, served over git's smart HTTP; the gh API; the journal; and the shipment record at close. The agent plane admits a request only with its trial's token from its trial's address. The control plane listens on 127.0.0.1 for the evaluator. |
| `gh.ts` | The gh surface the sidecar serves. Merges are refused and journaled. Any other call outside the surface is a rig error. |
| `gh-stub.cjs` | The `gh` in the container: it forwards argv, branch and body files to the sidecar and prints its answer. |
| `shipment.ts`, [SHIPMENT.md](SHIPMENT.md) | The shipment record and its selection rule. |
| `gh-surface.ts` | Scans a gstack tree's ship skill and helpers for the gh shapes /ship can reach. |
| `cli.ts` | `gstack-evals real sandbox serve` and `gstack-evals real sandbox gh-surface`. |

## Running it

```
gstack-evals real sandbox serve --root <dir> --agent-host <ip> [--agent-port 8790] [--control-port 8791]
```

It prints `SIDECAR_READY control=<url> agent=<url>`. The Harbor agent (`lanes/real-outcome/agent/real_agent.py`) opens each trial with `POST /trials`, runs the returned prep script in the container after the egress rules are on, and closes the trial with `POST /trials/<id>/close` when the session ends.

Prep puts the stub first on PATH, points origin at the sidecar with the trial's token, sets origin/<base> and origin/HEAD to the base commit, and checks out the starting branch: a feature branch cut from base (K1 to K3), or the replay branch (K4). /ship's preflight stops on the base branch, so no trial starts there.

A base tree holding `.claude/` or `.mcp.json` is refused at open, so no task brings project-local skills, plugins, settings or MCP servers into either arm. `CLAUDE.md`, `CLAUDE.local.md` and `AGENTS.md` are recorded and left in place: both arms read them alike.

`gstack-evals real sandbox gh-surface <gstack tree>` lists every gh shape the tree's /ship can reach and whether the sidecar serves it. The scan reads prose too, so it over-reports; at gstack 1.92.35.0 its unserved rows are prose matches and merge-queue paths a trial never takes. P0's recorded trace settles the surface.

## Tests

`tests/real-outcome/sandbox.test.ts` drives a fake agent with real git and the real stub: a pull request, no pull request, a direct push to base, a force push, merge attempts, a draft, several pull requests, a deleted branch, a forged shipment, a journal bypass, hooks, another trial's token, calls after close and calls outside the surface.
