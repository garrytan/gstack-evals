# Ask replay lane

This lane tests one idea for gstack: an "ask ledger" that keeps track of every question an agent has already asked its owner. The question is whether the ledger cuts needless asks (repeats, asks for permission the owner already gave, asks about things the agent could check itself) without holding back asks the owner really needed to see.

The preregistration is wiki/plans/2026-11-15-geva-539-ask-replay-prereg/README.md. It freezes every rule this code runs. When this README and the post disagree, the post wins.

## How the eval works

We take real moments when a coordinating agent was about to send its owner a question. For each moment (an "item") the model sees what the agent could see then: the conversation so far, the owner's standing rules and the draft question. It answers with one JSON object:

- SEND: send the question now.
- FOLD: don't send it now; carry it as one line under "Waiting on you" in the next digest.
- DROP: don't ask; carry on.

Four arms see the same items on the same model:

- (a) no gstack: the harness prompt and the item only.
- (b) gstack today: (a) plus three gstack files pinned at one commit.
- (c) gstack plus the ledger: (b) plus a view of earlier asks (open and answered), a one-line rule, two extra reply fields and a check the harness applies when the reply comes back.
- (d) the ledger without gstack's text: (a) plus exactly (c)'s ledger parts.

Scoring is deterministic. On an item the owner needed to see, FOLD or DROP is a miss. On a needless item, SEND is a needless send. No model judges the replies.

The real items stay private. They live as sealed (encrypted) files outside this repo and are only ever opened in memory on one machine. This repo holds the harness, the tests and a made-up set of 60 items with the same shape, in synthetic/.

## Files

| File | What it does |
|---|---|
| types.ts | The item, reply, sample and outcome shapes |
| frozen.json, frozen.ts | Every frozen number: margins, replicates, models, retries, seeds, the gstack pin |
| build.ts | Turns raw transcript pages, the audit CSV and the rules history into items (custody only) |
| privacy.ts | The secret and contact scan, and the public-text scan for repo files |
| ledger.ts | Ledger rows, their open or answered status, the view text and the send-time check |
| prompt.ts | Builds each arm's prompt in the frozen order |
| parse.ts | Reads a reply: the action, the ledger fields and each provider's safety stop |
| run.ts | The paid driver: sample ids, shards, retries, spend leases, resume |
| custody.ts | Opens sealed files in /dev/shm, proves they are gone afterwards, seals replies |
| score.ts, stats.ts, chains.ts | Scoring, paired bootstrap intervals, the decision rows and the chain linker |
| codebook.md, label.ts | The labeller's codebook, prompt, reply reader and the label readout |
| draws.ts | The seeded pilot and label-audit draws |
| synthetic/ | The seeded generator, the 60-item public set and its sha256 |
| dryrun.ts, fixtures.ts | The keyless dry run and the stub model it uses |
| cli.ts | The commands below |

## Commands

Run every command from the repo root. None of the keyless commands needs an API key.

    bin/gstack-evals ask-replay --help

**Keyless, safe to run anywhere:**

- `dryrun [--gstack <clone>]` drives every frozen rule on the synthetic set with a stub model and prints one PASS or FAIL line per check. It exits non-zero on any FAIL. It checks the three pinned gstack files in a gstack clone (default ~/.local/share/gstack). Without a clone that check fails, and the other checks still run on stand-in text.
- `synth` checks that synthetic/items.jsonl and items.sha256 match what the generator writes. `synth --write` rewrites them; frozen.json's synthetic.sha256 must then be updated by hand.
- `mdd` prints the planned detectable differences. `--items <file>` uses the proxy chain count from an items file instead of one item per cluster.
- `smoke-plan [--gstack <clone>]` lists the paid smoke's samples and the estimated input tokens per model and arm.
- `arms --items <file> [--gstack <clone>]` prints each arm's input tokens (characters divided by 4, mean and largest) and, for arm (a), how many items hold a line of gstack text or the word gstack. Run in custody on the real items, it gives the measured token counts and the cleanliness count the preregistration reports.
- `s1 --items <file>` runs the free automatic repeat filter (S1) on the drafts and prints catches per class.
- `chains-proxy --items <file>` runs the free linker that joins each duplicate to the earlier ask it repeats, and prints the chain count and the largest chain's share per thread.
- `scan <file>...` checks repo files before a push: issue keys or thread codes in prose, dollar figures outside an "Agent notes" section, names from `--deny <file>`, and overlap with a custody corpus from `--corpus <file>`. It exits 1 on any hit.

The synthetic set works as `--items lanes/ask-replay/synthetic/items.jsonl` for arms, s1, chains-proxy and mdd.

**Custody only (real items, never in this repo):**

- `build --pages <dir> --audit <csv> --rules <md> --out /dev/shm/<file> [--owner <names>] [--map <file>] [--variant]` writes items JSONL and a thread map, both on /dev/shm, and prints counts and the bundle sha256, never text.
- `draw --kind pilot|audit --items <file> --out /dev/shm/<file> --seed-log <CUSTODY.md> [--seed <n>]` draws the admission pilot's 40 items (16 must-ask and 24 needless, spread over class and thread) or the label audit's 99 (40 must-ask, 40 duplicates and every permission and observable item). It mints the seed from random bytes and appends it to the log, writes the drawn items to /dev/shm and prints counts only. `--seed` redraws a recorded draw.
- `synth-check --corpus <file>` compares the synthetic set with the private texts: 6-gram hits and the largest content-word overlap. Any 6-gram hit or an overlap above 0.5 fails.
- `score --items <file> --replies <dir> [--labels <dir>] [--links <file>] [--draws <n>] [--keyless]` prints the frozen readout and the decision rows, numbers only. `--labels` reads the decrypted labeller records: each labeller's kappa against the audit, the primary labels and the views beside them, the label-sensitive flag, chains from the Opus links and the answer judgements. `--keyless` uses a test seed instead of the frozen one. It prints no decision rows, and exits with E_ASK_INCOMPLETE, unless `--labels` holds every scheduled audit label of both labellers and the audit stands or the contingency is complete.
- `pilot --items <file> --replies <dir>` reads the pilot's drawn items and decrypted replies and prints the frozen admission rule and k rule: arm (b)'s needless sends and must-ask misses, W, V, B2, the projected detectable differences and the k for the main run, numbers only.

**Paid (only after the preregistration merges and a spend cap is approved):**

- `run --bundle <items.jsonl.age> --sums <SHA256SUMS> --log <CUSTODY.md> --spend-item <I1..I8> --model <opus|sol|particle> --out <dir> --recipient <age recipient> [--k <n> | --pilot] [--gstack <clone>] [--redraw-upstream]` runs one shard of under 55 minutes: no attempt starts past 55 minutes, a deadline timer ends the shard there (E_ASK_SHARD_LIMIT), and the /dev/shm directory is removed on every exit, SIGTERM, SIGINT and SIGHUP included. `--pilot` runs the pilot's frozen arms and replicate counts. `--k` takes only the frozen counts: 1 on the smoke (I1), 2 or 3 on the main run. Each cell (item, arm, model) runs its replicates in sequence, so replicate 2 reads the prompt replicate 1 cached. The age identity comes in on stdin. Every sample has a fixed id, its reply is sealed under that id and its spend settles once against that id, so a rerun skips finished samples and never counts a call twice. It refuses while frozen.json still holds a placeholder seed (E_ASK_UNFROZEN).
- `label --kind audit|contingency|link --model <opus|astra> --bundle <items.jsonl.age> --sums <SHA256SUMS> --log <CUSTODY.md> --out <dir> --recipient <age recipient> [--audit-draw <file>] [--redraw-upstream]` runs the labeller from codebook.md on every item in the bundle (link: on the duplicates, Opus only; contingency: only on the items outside the audit draw that `--audit-draw` names, and it refuses to run without it). It uses the same driver, leases and sealed store as run, on spend items I3, I4 and I5.

## Tests

    bun test tests/ask-replay

The tests are keyless. A few check the real gstack pin and skip when no gstack clone is present.

## Reason codes

The lane's errors start with E_ASK_. docs/errors.md lists each one with its fix.
