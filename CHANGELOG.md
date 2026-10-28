# Changelog

What each gstack-evals release changed. Versions follow `VERSION` and `package.json`. Unit pull requests leave this file and `VERSION` alone; the Captain writes each entry at release.

## [0.0.1] - 2026-10-28

### U1: repo skeleton and shared registries (M0)

- `bin/gstack-evals` with the full command table (src/cli.ts). A command runs once its module exists and exports `main`; until then it exits 2 with E_USAGE and "not built yet", naming the unit that builds it.
- `src/errors/codes.ts`: every reason code in plan v3.2 and interface v0.4, one object per code with its exit, meaning, fix, side effects, retry safety, resumability and owning unit. `bun run errors:doc` writes docs/errors.md and `bun run errors:check` fails CI when it is stale.
- `src/types.ts`: the arm spec, leases, reservations and the ledger interface the proxy reserves through, the typed outcome taxonomy and the versioned error record.
- `.gstack/pregate.json` with a sealed config for `gstack-pregate sealed`, and `.gstack/generated.json` registering docs/errors.md and wiki/INDEX.md as generated files.
- The src/ layout from the plan, an empty schema/, docs/adapters.md headings, README, TODOS.md, LICENSE (MIT) and NOTICE.md with every planned vendored source.
- CI runs typecheck, `bun test` over the whole repo, the reason-code doc check and the wiki check. Tests moved from test/ to tests/, the plan's layout.
- The wiki check reads `sealed.answer_markers` as regular expressions, the way `gstack-pregate sealed` does.
