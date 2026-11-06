# tbv: the trust-but-verify harness

This lane runs the trust-but-verify eval preregistered in [wiki/plans/2026-11-05-geva-313-trust-but-verify-prereg](../../wiki/plans/2026-11-05-geva-313-trust-but-verify-prereg/README.md), as [amendment 1](../../wiki/plans/2026-11-05-geva-326-tbv-prereg-amendment-1/README.md) changes it. Every command is `gstack-evals tbv <command>`. Nothing here spends money on its own: paid commands open a ledger lease on an item whose cap is recorded first, and the dry run and the tests need no key.

## How the pieces fit

1. **Histories.** `assemble-a` builds source A histories from R3 run bundles (history/source-a.ts: the SDK log parse, the provenance gate, the first-message rebuild, the drops and the final-text cut). `mine-b` fetches this repo's pull requests through `gh api graphql` and `assemble-b` turns one into a history (history/source-b.ts: the strip, lineage clusters, the dev window and held-out accrual). history/events.ts holds the canonical form, its sha256 and the drive-path refusal.
2. **Extractor.** `extract` lists fact candidates with cited events, the lists and the stratum (extract.ts). A history admits when it fits its family's limit: 130,000 tokens less the larger of 40,000 and the family's measured overhead. At 641d622 the limits are investigate 90,000, ship 79,546 and capy 90,000 (extract.ts's historyLimit).
3. **Request shape and splice.** `shape` captures the system prompt, tools and max_tokens from the pinned Claude Code 2.1.312 against a stub provider; `splice` captures a family's splice set at a gstack pin (shape.ts, splice.ts). Captured text stays outside the repo; its sha256 is printed. request.ts builds each turn's request from four inputs only and validates it.
4. **Driver.** `drive` runs an item's readings through the metering proxy on the item's lease, with the end-state table, caching order, retries, round admission, the outage pause, the release of unbilled OpenRouter sends and size drops (drive.ts, routes.ts, custody.ts). A send whose OpenRouter generation record is missing keeps its full reservation and stops the item (E_TBV_RUN).
5. **Keys, packets, judges, readings.** `keys` writes and audits keys on tbv-author's lease (keys.ts, briefs/audit-brief.md). `packets` builds blind judge packets and controls, `judge` runs the judges with judge-brief-v2.md, and `readings` joins records, the packet key and judge replies into the readings file (packet.ts, judge.ts, readings.ts). For held-out input, each takes `--held <sealed dir> --seal-cmd <cmd>`: it refuses an output path off tmpfs, as `drive --held` refuses `--tasks`, and seals each output file into the sealed directory as it is written (custody.ts). Each command refuses a sealed directory that already holds a sealed copy of a name it will write, when it starts and before any lease or send; `packets`, whose file names are random, refuses any sealed copy there. So give each held run a fresh sealed directory. `keys` and `judge` keep the run's metering journal under `<sealed dir>/journal/<run id>`, off tmpfs.

   To restart a held `keys` or `judge` run after a crash: delete its plaintext `--out` on tmpfs, move the dead run's `*.sealed` copies out of the sealed directory into custody and log the move, leave `journal/` where it is, then rerun with the same `--held`, the same `--run-id` and a new `--out`. The restart reconciles the dead run's journal, settles its open lease and leases again; it starts the work over and skips nothing the dead run finished. A fresh `--held` with the same run id also settles the dead lease, but it cannot read the dead journal, so the send in flight at the crash stays counted at its full reservation as unknown spend.
6. **Scorer.** rule.ts is the frozen tbv-rule.ts.txt with the build fixes and amendment 1's rule items: `words`, `endstate`, `admit`, `headroom`, `projection`, `allin`, `caps`, `compare`, `handoff` and `leak`. `headroom` and `compare` take `--split <manifest.json>`.
7. **Checks over real inputs.** `check handoff`, `check leak` and `check rules` gather text and names from histories, keys and a gstack checkout and hand them to rule.ts's handoff and leak checks (check.ts).

## Commands

Run from the repo root after `bun install --frozen-lockfile`.

| Command | What it does |
|---|---|
| `gstack-evals tbv dryrun <scratch dir>` | the keyless dry run (refuses to start with a key set); exits 0 with FAIL 0 |
| `bun lanes/tbv/regress.ts [--head <rule.ts>] [--out <table.md>]` | the regression table: frozen rule against the head |
| `gstack-evals tbv check handoff --artifact <file> --dev <dir> --held <dir> [--held-keys <dir>] [--held-b <dir>] [--held-b-keys <dir>] [--names <file>]` | the handoff check; `--held` takes held-out source A only, `--held-b` source B after accrual closes |
| `gstack-evals tbv check leak --gstack <checkout> --c <sha> --p <sha> --wording <file> --dev <dir> --held <dir> [--dev-keys <dir>] [--held-keys <dir>] [--held-b <dir>] [--held-b-keys <dir>] [--names <file>]` | the leak check over the added lines of C..P, gstack's tree at C as the exemption, then the org-rules scan over every history |
| `gstack-evals tbv check rules --wording <file> --histories <dir>` | the org-rules scan alone |
| `gstack-evals tbv <rule command> <file>` | one scorer command, as tbv-rule.ts runs it |

The check commands exit 0 on CLEAR or CLEAN, 1 on BLOCK or HIT and 2 on a refusal. A history directory holds tbv-history.v1 files and a key directory tbv-key.v1 files. The org rules' wording is read from a file at run time and never committed. Held-out material stays sealed: unseal it into /dev/shm on the run host before a check and delete it after.

## The dry run

`gstack-evals tbv dryrun <scratch dir>` runs three parts:

1. The frozen bundle's own dry run with this checkout as the scorer. It must print PASS 150, FAIL 0, and its transcript must match the frozen dryrun.txt apart from the scorer HEAD line.
2. The same 150 frozen checks against the head rule, through adapt.ts. Every check passes except the ordered changes dryrun.ts lists in ORDERED (today one: item 1 refuses a copy relabelled to the other family before the duplicate check does).
3. The amendment's and the build's rules: new end states, size drops against coverage, judge pricing by model and packet kind, the all-in check before every paid item, the leak exemption, held-out source B accrual, items 1 to 7 and 16, the regression table, each family's history limit, the skill-start check, the proxy's reservations beside the rule's worst cases, tbv-author's worst case per task, and the driver, judge and key items end to end on stub upstreams through the real proxy and ledger.

## Tests

`bun test tests/tbv/` runs every unit's tests with no key. The real-CLI capture test runs only with `TBV_REAL_CLI=1` on a machine with Claude Code 2.1.312 and gstack at 641d622.
