# Review-models unit supply: commands and counts

The supply for plan 2026-11-24-geva-590-review-models-prereg (section 2, section 10 item 3, Pilots) and its pre-run change 1
(item 1). Gate records name fix commits and BICs beside advisories, so they are answer keys. They live outside this
repository, in the Captain drive at handoffs/GEVA-590/supply/. This file keeps only counts and sha256 digests.

## Commands

Keyless, in order (S is the supply folder, W a work folder for clones):

    gstack-evals rm-supply p-gates --suite review-real-bugs-2026-11.json --stage1 review-real-bugs-2026-11-stage1.json --work $W --out $S/p-gates.jsonl
    gstack-evals rm-supply b-gates --frame wiki/plans/2026-11-15-geva-538-skill-pack-h2h-prereg/b2-frame.json --work $W --shard <i>/6 --out $W/b-gates-<i>.jsonl
    cat $W/b-gates-*.jsonl > $S/b-gates.jsonl
    gstack-evals rm-supply vis-requests --b $S/b-gates.jsonl --frame wiki/plans/2026-11-15-geva-538-skill-pack-h2h-prereg/b2-frame.json --work $W --out $S/vis-requests.jsonl

Paid, not yet run (gate 3: Claude Opus 5.5 and GPT-6.2 Astra on each unit, 146 calls). It needs the ledger item the
Captain records for "Supply: B visibility reads" and a rig admission record on the machine that spends:

    gstack-evals rm-supply vis-send --requests $S/vis-requests.jsonl --out $S/vis-send --run-id geva590-visibility-1 --item <ledger item>

Keyless again, after the read:

    gstack-evals rm-supply vis-read --requests $S/vis-requests.jsonl --replies $S/vis-send/replies.jsonl --out $S/visibility.json
    gstack-evals rm-supply draw --p $S/p-gates.jsonl --b $S/b-gates.jsonl --visibility $S/visibility.json --out $S/draw.json
    gstack-evals rm-supply counts --p $S/p-gates.jsonl --b $S/b-gates.jsonl --visibility $S/visibility.json --draw $S/draw.json --out $S/counts.json

## Counts, 2026-11-24, before gate 3

P, the suite's 101 outside bug units and 15 decoys:

| | Units | Read errors | Gate 1 | Gate 4 | Both |
|---|---|---|---|---|---|
| Bug units | 101 | 1 | 97 | 19 | 19 |
| Decoys | 15 | 0 | 12 | 0 | 0 |

Every gate 4 failure in P is an instruction file alone (CLAUDE.md, AGENTS.md or .claude/ in the unit tree): 81 bug units
and all 15 decoys. 47 bug units were never run by Harness Evals; 43 pass gate 1 and 11 pass both gates.

B, one advisory per repository over the frame's 303 repositories published from 2026-07-01, in seeded order (draw seed
1872089902):

| Step | Units |
|---|---|
| Repositories (1 clone error) | 303 |
| SZZ blamed a line | 299 |
| BIC has one parent | 295 |
| BIC carries at least half the blamed lines | 206 |
| BIC changes at most 2,000 lines, at least 1 source line | 155 |
| Fix dated on or after 2026-07-01 (gate 1 with gate 2) | 81 |
| Gate 4 also (8 fail on instruction files) | 73 |
| Awaiting gate 3 | 73 |

Gates in plan order: gate 1 passes 149, gates 1 and 2 pass 81, gates 1, 2 and 4 pass 73.

Check against the design-stage prototype on its own 80 repositories: 80 blamed, 79 single-parent, 48 half-blamed, 35 at
most 2,000 lines, 16 dated (the prototype counted 37 and 17). The two units apart are ties between equally blamed commits
in multi-file fixes: the prototype took files in Python's set order, this code takes the first blamed in patch order.

## Digests

| File | sha256 |
|---|---|
| review-real-bugs-2026-11.json (g-harness-evals 74f0de63dc) | 97b9da91b2b5ffb7d5cc7af14d93896a009cf31a3f846ba3d691a96513a9d84b |
| review-real-bugs-2026-11-stage1.json (same commit) | 827929af7ce3818e6f5cd6c5fbfb1dec82976161160d59fd61d6d9e2d0319ed1 |
| b2-frame.json | 3e0bbb74711e308c8d77edff3342be8ff0e09220e602b9310c509083a64bfba3 |
| p-gates.jsonl | 21ac60061cce5d6166182468491ce1fa3b5ac4656dfae2ac3f1a304e5b60aadd |
| b-gates.jsonl | 037b60059143bb9ad8787e08f8a3aa06540cad306b8263e78ffa82742998b0b1 |
| vis-requests.jsonl | d4aa4f6fb57a4b58732190355a687c6fd40f552cea1ae7cb368715dd3341c35c |
