# quick/replay: review replay on known gstack bugs

Exploratory quick look (GSTA-11). The question, design and stop rule are in [PREREG.md](PREREG.md).

## Files

- `mine.ts`: mines defect and decoy candidates from a full gstack clone and its PR bodies (needs `gh`).
- `select.ts`: picks the cases and writes `cases.json`.
- `build.ts`: renders every prompt from gstack at a pinned sha into `~/.capy/work/replay/prompts`, writes `plan.json` and `frozen.sha256`.
- `run.ts`: runs the cells through the ledger (`llm.ts`), resumable, refuses a prompt that does not match `frozen.sha256`.
- `score.ts`: file matching, the blind judge, and the tables (`summary.json`).
- `lib.ts`, `llm.ts`: diff filtering, finding parsing, /review's dispatch rules, the bootstrap; providers, prices and the ledger.
- `fake-upstream.ts`, `replay.test.ts`: keyless tests against a fake Anthropic, OpenRouter and OpenAI.

## Reproduce

```
git clone https://git.capy.ai/garrytan/gstack.git /workspace/gstack
bun quick/replay/build.ts            # fetches PR refs it needs; fails if a diff digest moved
bun test quick/replay
bun quick/replay/run.ts --dry-run
PREREG_SHA=<sha> bun quick/replay/run.ts   # paid: needs the keys and the ledger approval row
bun quick/replay/score.ts
```
