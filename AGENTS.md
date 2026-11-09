# Agents working on gstack-evals

gstack-evals measures whether gstack's skills help, on which models, and at what cost. It is open source and earnest: it steers gstack's research, it does not market gstack, and it reports losses plainly.

## The wiki rule

Plans, designs, research, decisions, findings, handoffs and reports worth keeping go into [wiki/](wiki/README.md) as posts, through a pull request.

- Run `bun run wiki:index`, then read wiki/INDEX.md to see what is open and what has been decided. The index is generated and never committed.
- A merged post is immutable except for its `status`. To change one, write a new post that supersedes it. The only exception is an owner-directed edit with a matching waiver row in `wiki/edits/<name>.tsv` (see wiki/README.md).
- Run `bun run wiki:check` before you push.
- A drive or scratch folder is the inbox; wiki/ is the record.

## Never commit

- Secrets, keys or tokens.
- Sealed task bodies, hidden tests or answer keys. Held-out material stays outside this repo; commit only counts and digests.
- Code, text or transcripts copied verbatim from private repos or sessions.

The repo will be public, so commit only what is safe to publish.

## Shared registries

Several build units share these files. Edit only the lines your unit owns.

- `src/cli.ts` holds the command table behind `bin/gstack-evals`. A command runs once its module exists at the path in its row and exports `main(argv)`; until then it exits 2 with E_USAGE "not built yet".
- `src/errors/codes.ts` holds every reason code, one object per code. Add new codes there; never rename or remove one. Edit only the codes your unit owns, then run `bun run errors:doc`. Every error line on stderr starts with its code.
- `src/types.ts` holds the interfaces more than one unit codes against. Change one only with the units that use it.
- Vendored code keeps its upstream copyright line in each file header and gets its row in NOTICE.md marked vendored, with the source commit.
- `.gstack/pregate.json` has a sealed config. Run `gstack-pregate sealed` (from gstack) before every push.

## Write plainly

Short paragraphs, active verbs, no marketing words, no em dashes.

## Checks

`bun test`, `bun run typecheck`, `bun run errors:check` and `bun run wiki:check` run without keys, and CI runs them on every pull request. A pull request into main that changes only human-facing docs skips `bun test` and `bun run typecheck`; scripts/docs-only.ts holds the rule. Tests live under tests/; a quick look under quick/ keeps its keyless tests beside its code.

This guide does not authorise pushing, merging, spending or publishing; follow the current task's instructions for those.
