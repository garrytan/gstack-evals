# Agents working on gstack-evals

gstack-evals measures whether gstack's skills help, on which models, and at what cost. It is open source and earnest: it steers gstack's research, it does not market gstack, and it reports losses plainly.

## The wiki rule

Plans, designs, research, decisions, findings, handoffs and reports worth keeping go into [wiki/](wiki/README.md) as posts, through a pull request.

- Read [wiki/INDEX.md](wiki/INDEX.md) first to see what is open and what has been decided.
- A merged post is immutable except for its `status`. To change one, write a new post that supersedes it.
- Run `bun run wiki:index` and `bun run wiki:check` before you push.
- A drive or scratch folder is the inbox; wiki/ is the record.

## Never commit

- Secrets, keys or tokens.
- Sealed task bodies, hidden tests or answer keys. Held-out material stays outside this repo; commit only counts and digests.
- Code, text or transcripts copied verbatim from private repos or sessions.

The repo will be public, so commit only what is safe to publish.

## Write plainly

Short paragraphs, active verbs, no marketing words, no em dashes.

## Checks

`bun test`, `bun run typecheck` and `bun run wiki:check` run without keys, and CI runs them on every pull request.

This guide does not authorise pushing, merging, spending or publishing; follow the current task's instructions for those.
