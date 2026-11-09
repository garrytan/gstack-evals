# quick/replay: review replay on known gstack bugs

Exploratory quick look. The question, design and stop rule are in the preregistration, [wiki/plans/2026-10-28-gsta-11-review-replay-prereg.md](../../wiki/plans/2026-10-28-gsta-11-review-replay-prereg.md).

This quick look ran before the program ledger ([docs/budget-ledger.md](../../docs/budget-ledger.md)) landed, and it does not use it. It spends through its own ledger in `llm.ts`: one JSONL file, line item `replay-quick`, a $60 cap, and no paid call until the file holds an approval row.

## Files

- `mine.ts`: mines review-caught, escaped and decoy candidates from a full gstack clone and its PR bodies (needs `gh`).
- `select.ts`: picks the cases and writes `cases.json`.
- `build.ts`: renders every prompt from gstack at a pinned sha into `~/.capy/work/replay/prompts`, writes `plan.json` and `frozen.sha256`.
- `run.ts`: runs the cells through the ledger (`llm.ts`), resumable, refuses a prompt that does not match `frozen.sha256`.
- `score.ts`: file matching, the blind judge, and the tables per stratum (`summary.json`).
- `smoke.ts`: with the keys, one short metered call per model, the OpenRouter key limit, DeepSeek's endpoints and the programming ranking's `meta.as_of` (`manifest.json`).
- `audit.ts`: draws the seeded sample of 10 judge verdicts for the hand audit (`audit.md`).
- `lib.ts`, `llm.ts`: diff filtering, finding parsing, /review's dispatch rules, the bootstrap; providers, prices and the ledger.
- `fake-upstream.ts`, `replay.test.ts`: keyless tests against a fake Anthropic, OpenRouter and OpenAI.

## Reproduce

```
git clone https://github.com/garrytan/gstack.git /workspace/gstack
bun quick/replay/build.ts            # fetches PR refs it needs; fails if a diff digest moved
bun test quick/replay
bun quick/replay/run.ts --dry-run
PREREG_SHA=<sha> bun quick/replay/smoke.ts # paid: needs the keys and the ledger approval row
PREREG_SHA=<sha> bun quick/replay/run.ts
bun quick/replay/score.ts
bun quick/replay/audit.ts
```
