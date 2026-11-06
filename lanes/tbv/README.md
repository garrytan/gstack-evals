# tbv: the trust-but-verify harness

This lane runs the trust-but-verify eval preregistered in [wiki/plans/2026-11-05-geva-313-trust-but-verify-prereg](../../wiki/plans/2026-11-05-geva-313-trust-but-verify-prereg/README.md), as [amendment 1](../../wiki/plans/2026-11-05-geva-326-tbv-prereg-amendment-1/README.md) changes it. Every command is `gstack-evals tbv <command>`. Nothing here spends money on its own: paid commands open a ledger lease on an item whose cap is recorded first, and the dry run and the tests need no key.

## How the pieces fit

1. **Histories.** `assemble-a` builds source A histories from R3 run bundles (history/source-a.ts: the SDK log parse, the provenance gate, the first-message rebuild, the drops and the final-text cut). `mine-b` fetches this repo's pull requests through `gh api graphql` and `assemble-b` turns one into a history (history/source-b.ts: the strip, lineage clusters, the dev window and held-out accrual). history/events.ts holds the canonical form, its sha256 and the drive-path refusal.
2. **Extractor.** `extract` lists fact candidates with cited events, the lists and the stratum (extract.ts). A history admits when it fits its family's limit: 130,000 tokens less the larger of 40,000 and the family's measured overhead. At 641d622 the limits are investigate 90,000, ship 79,546 and capy 90,000 (extract.ts's historyLimit).
3. **Request shape and splice.** `shape` captures the system prompt, tools and max_tokens from the pinned Claude Code 2.1.312 against a stub provider; `splice` captures a family's splice set at a gstack pin (shape.ts, splice.ts). Captured text stays outside the repo; its sha256 is printed. request.ts builds each turn's request from four inputs only and validates it.
4. **Driver.** `drive` runs an item's readings through the metering proxy on the item's lease, with the end-state table, caching order, retries, round admission, the outage pause, the release of unbilled OpenRouter sends and size drops (drive.ts, routes.ts, custody.ts). A send whose OpenRouter generation record is missing keeps its full reservation and stops the item (E_TBV_RUN).
5. **Keys, packets, judges, readings.** `keys` writes and audits keys on tbv-author's lease (keys.ts, briefs/audit-brief.md). `packets` builds blind judge packets and controls, `judge` runs the judges with judge-brief-v2.md, and `readings` joins records, the packet key and judge replies into the readings file (packet.ts, judge.ts, readings.ts). For held-out input, each takes `--held <sealed dir> --seal-cmd <cmd>`: it refuses an output path off tmpfs, as `drive --held` refuses `--tasks`, and seals each output file into the sealed directory as it is written (custody.ts). Each command refuses a sealed directory that already holds a sealed copy of a name it will write, when it starts and before any lease or send; `packets`, whose file names are random, refuses any sealed copy there. So give each held run a fresh sealed directory. `keys` and `judge` keep the run's metering journal under `<sealed dir>/journal/<run id>`, off tmpfs.

   To restart a held `keys` or `judge` run after a crash: delete its plaintext `--out` on tmpfs, move the dead run's `*.sealed` copies out of the sealed directory into custody and log the move, leave `journal/` where it is, then rerun with the same `--held`, the same `--run-id` and a new `--out`. The restart reconciles the dead run's journal, settles its open lease and leases again; it starts the work over and skips nothing the dead run finished. A fresh `--held` with the same run id also settles the dead lease, but it cannot read the dead journal, so a reservation the dead run held but never sent stays counted at its full reservation as unknown spend. The send in flight at the crash counts as unknown spend at its full reservation either way.
6. **Scorer.** rule.ts is the frozen tbv-rule.ts.txt with the build fixes and amendment 1's rule items: `words`, `endstate`, `admit`, `headroom`, `projection`, `allin`, `caps`, `compare`, `handoff` and `leak`. `headroom` and `compare` take `--split <manifest.json>`. A climb's readings hold only principle rows, so its `compare` takes `--base <tbv-dev-base readings.json>` and pairs them with dev-base's none and current rows; agreement, stop and harness counts read the climb's own rows.
7. **Confined held-out steps.** `held-step` runs one command (extract, assemble-a or assemble-b on held-out input) in a docker container whose only writable mount is a fresh work dir on /dev/shm, with the network off and no host environment, then seals every file it left, its stdout and stderr included, into `--held` from a second container whose only writable mount is that directory (held.ts). A probe container with the same mounts refuses the step if anything else is writable or mounted rw, or if it can see a socket or a FIFO. An `--input`, `--ro` or `--from` path that is not a regular file or a directory refuses before any container starts. Every container runs from the checked empty image and carries a label, and a step refuses while a labelled container from a dead step still runs. `held-unseal` copies `<prefix>*.sealed` records into a fresh work dir the same way. A held-out-derived `--input` on a fuse mount (a Capy drive) stops with E_TBV_BURNED and deletes nothing.
8. **Checks over real inputs.** `check handoff`, `check leak` and `check rules` gather text and names from histories, keys and a gstack checkout and hand them to rule.ts's handoff and leak checks (check.ts).

## Commands

Run from the repo root after `bun install --frozen-lockfile`.

| Command | What it does |
|---|---|
| `gstack-evals tbv dryrun <scratch dir>` | the keyless dry run (refuses to start with a key set); exits 0 with FAIL 0 |
| `bun lanes/tbv/regress.ts [--head <rule.ts>] [--out <table.md>]` | the regression table: frozen rule against the head |
| `gstack-evals tbv held-step --work <new dir on /dev/shm> --held <sealed dir> --seal-cmd <cmd> [--input <dir on /dev/shm>]... [--ro <path>]... -- <command>` | one held-out step, confined, then sealed; `--input` takes held-out-derived plaintext, `--ro` raw sources, tools and keys |
| `gstack-evals tbv held-unseal --work <new dir on /dev/shm> --from <sealed dir>... --prefix <name prefix> --unseal-cmd <cmd> [--ro <path>]...` | unseals the named records into the work dir, confined |
| `gstack-evals tbv rebuild-a --bundle <name>=<dir>... [--held-tier <dir>]... --export <dir> --out <new dir>` | source A's rebuild tier: a probe per commit on a held-tier task, then every other task rebuilt at its bundle's commit and kept only at its recorded digest (next section) |
| `gstack-evals tbv check handoff --artifact <file> --dev <dir> --held <dir> [--held-keys <dir>] [--held-b <dir>] [--held-b-keys <dir>] [--names <file>]` | the handoff check; `--held` takes held-out source A only, `--held-b` source B after accrual closes |
| `gstack-evals tbv check leak --gstack <checkout> --c <sha> --p <sha> --wording <file> --dev <dir> --held <dir> [--dev-keys <dir>] [--held-keys <dir>] [--held-b <dir>] [--held-b-keys <dir>] [--names <file>]` | the leak check over the added lines of C..P, gstack's tree at C as the exemption, then the org-rules scan over every history |
| `gstack-evals tbv check rules --wording <file> --histories <dir>` | the org-rules scan alone |
| `gstack-evals tbv <rule command> <file>` | one scorer command, as tbv-rule.ts runs it |

The check commands exit 0 on CLEAR or CLEAN, 1 on BLOCK or HIT and 2 on a refusal. A history directory holds tbv-history.v1 files and a key directory tbv-key.v1 files. The org rules' wording is read from a file at run time and never committed. Held-out material stays sealed: unseal it into /dev/shm on the run host before a check and delete it after.

## Source A's rebuild tier

The drive holds the task directories of 78 of the 200 source A tasks: the held tier (amendment 1 section 1). `rebuild-a` rebuilds the directory of every other task a none-arm session ran, from pinned inputs only, and keeps a directory only when it reaches a session's recorded digest, lock.json's task digest, which assemble-a's provenance gate checks again. Its pins live in history/rebuild.ts, each from a merged post:

| Pin | Value | Source |
|---|---|---|
| Harbor | f3a5a923f6d722472c9e797af836ae4425fb215f | R3 amendment 4 section 4; the pool file's dataset record |
| Dataset | swe-rebench/swe-rebench-leaderboard at version sha256:ebe7444e313a0d8db94fa541139826eaebe2b0abcd4900c6f73e750494910dca | R3 amendment 4 section 4 |
| Pool file | quick/laneb/tasks/swerebench-r3a4.json at sha256 7d2b2735cd50836364cc2c1fba9a2dd07a5ce42e9ea0f9c4b8d699b9e81ea1af | R3 amendment 4 section 5 |
| Bundles opus-r3a4 and sol-r3a4 | 616de34fb1c90763f897d1fdb7f1764ff7bcaee3 | R3 amendment 4 section 2; the R3a4 admission results post |
| Bundles opus-r3b and sol-r3b | dbcb5b49e4d41b6a6d176d35e406a4399704c3a7 | the R3b pin post; the R3b results post |
| Network | allowlist | prepare-run.ts's NETWORK default at both commits; no post names another, and the probe checks it |

How it runs:

1. It reads materialize.ts, the two runtime Dockerfiles and the pool file from each bundle's commit in the checkout's git history, never from the working tree, so the checkout needs full history. The pool must be at its sha256 and name the pinned dataset version and Harbor commit.
2. It walks each bundle for trial directories and keeps the none-arm ones. A session whose recorded digest matches a held-tier directory of its task is held tier and is not rebuilt. Every other session joins the rebuild tier at its bundle's commit.
3. Every export task directory the run needs must be at the pool's content hash (the Hub package's own hash), or it refuses before it rebuilds anything.
4. **The probe.** For each commit the rebuild tier uses, it rebuilds the first held-tier task, in byte order, that a session ran at that commit, and the result must reach that directory's digest. A mismatch, or a commit no held-tier session ran at, refuses with E_TBV_PROBE before any other rebuild.
5. It rebuilds each task once per commit into `<out>/<commit, first 12 characters>/<task id>` and keeps it when a session's recorded digest equals the rebuilt directory's. Otherwise it deletes the directory and the task drops as digest_mismatch. A task the pool does not list drops as not_in_pool, and a session with no lock digest drops as no_lock_digest.
6. It writes `<out>/rebuild.json`: the pins with each pinned file's sha256, the probes, and every task and session with its task directory or drop reason. It prints counts only, never a task id.

B2 then passes a kept session's directory to assemble-a as `--task-dir`. tests/tbv/rebuild.test.ts reads the pinned commits from git history too, so it needs a full clone, as CI's checkout is.

**Custody.** A rebuilt directory is a source A task directory, the same kind of file the raw bundles hold for the held tier, and after the draw any of them may belong to a held-out task. So the rebuilt directories, the probe's directory and rebuild.json carry the custody of source A's raw bundles (prereg section 11 item 3): they live on the run host or in the crew-only Captain drive, never in the repo, never anywhere a principle builder can read, and never in an artifact for the gstack Captain. The repo gets counts and sha256s only (prereg section 16). A held-out step takes a rebuilt directory as `--ro`, as it takes a held-tier one (pins addendum section 2). rebuild-a refuses an `--out` inside a git work tree.

## The dry run

`gstack-evals tbv dryrun <scratch dir>` runs three parts:

1. The frozen bundle's own dry run with this checkout as the scorer. It must print PASS 150, FAIL 0, and its transcript must match the frozen dryrun.txt apart from the scorer HEAD line.
2. The same 150 frozen checks against the head rule, through adapt.ts. Every check passes except the ordered changes dryrun.ts lists in ORDERED (today one: item 1 refuses a copy relabelled to the other family before the duplicate check does).
3. The amendment's and the build's rules: new end states, size drops against coverage, judge pricing by model and packet kind, the all-in check before every paid item, the leak exemption, held-out source B accrual, items 1 to 7 and 16, the regression table, each family's history limit, the skill-start check, the proxy's reservations beside the rule's worst cases, tbv-author's worst case per task, the driver, judge and key items end to end on stub upstreams through the real proxy and ledger, and source A's rebuild tier on fixtures.

## Tests

`bun test tests/tbv/` runs every unit's tests with no key; tests/tbv/held.test.ts needs docker and fails without it when CI is set. The real-CLI capture test runs only with `TBV_REAL_CLI=1` on a machine with Claude Code 2.1.312 and gstack at 641d622.
