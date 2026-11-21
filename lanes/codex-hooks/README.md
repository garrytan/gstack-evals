# Codex hooks eval

Do gstack's routing hook and its /review contract help GPT-6.1 Sol in Codex CLI, and does high effort? Part R runs B1's 60 bug tasks with gstack's routing hook on, off and with no gstack, and reads whether the prove-it skill loaded. Part C runs R2's 33 review units with the /review contract on, off, on at high effort and with no gstack, and reads the known bugs a session's final report adds over its report at the contract's first block. The plan, the decisions each result changes and the frozen numbers are in [the preregistration](../../wiki/plans/2026-11-19-geva-562-codex-hooks-prereg/README.md), with its pre-run change on the results branch.

## Files

| File | What it does |
|---|---|
| pins.ts | Values both parts share: the gstack pin, the Codex CLI and its digests, the model, and the settings every arm passes |
| cli.ts | `gstack-evals codex-hooks r|c <command>` |
