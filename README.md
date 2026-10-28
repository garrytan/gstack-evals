# gstack-evals

An outcome-graded eval rig for [gstack](https://github.com/garrytan/gstack), being built. It exists to steer gstack's research and development: which skills help, on which models, at what cost, and where gstack loses. It reports losses plainly.

## Where things are

- [wiki/](wiki/README.md): plans, designs, research, decisions and handoffs, as immutable posts. Start with [wiki/INDEX.md](wiki/INDEX.md).
- [AGENTS.md](AGENTS.md): how agents work in this repo.

## Checks

None of these need a key, locally or in CI.

```
bun install
bun test
bun run typecheck
bun run wiki:check
```
