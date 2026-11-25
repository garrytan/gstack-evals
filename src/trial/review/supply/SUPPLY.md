# Review-models unit supply: commands and counts

The supply for plan 2026-11-24-geva-590-review-models-prereg (section 2, section 10 item 3, Pilots) and its pre-run changes
1 (item 1) and 2 (gate 4). Gate records name fix commits and BICs beside advisories, so they are answer keys. They live
outside this repository, in the Captain drive at handoffs/GEVA-590/supply/. This file keeps only counts and sha256 digests.

## Gate 4 under the Captain's ruling (2026-11-24)

Instruction files (CLAUDE.md, AGENTS.md, anything under .claude/, .mcp.json) stay in the unit tree:

1. They come from the unit's own head, which precedes the fix (the fix is never an ancestor). Their sha256 is recorded per
   unit, with the instruction files the unit's own diff changes.
2. The needle checks (advisory id, CVE ids, the fix's short sha, the suite's name and case ids) read their text like any
   tracked file. A unit whose instruction file trips one fails gate 4.
3. Executable config is disabled: every .mcp.json is removed, and every .claude/settings*.json loses hooks, permissions
   and the keys that run commands or start MCP servers (gates.ts EXEC_KEYS). The unit build records what it stripped,
   per file, and marks those files skip-worktree so git still reads the tree as clean. A settings file that is not JSON
   fails gate 4. Whether a stripped unit still installs and tests is checked by the unit-image check on the run host.

Each gate record and drawn unit carries flags per file type (claude_md, root_claude_md, agents_md, claude_dir, settings,
mcp_json) for the results' descriptive split.

## Commands

Keyless, in order (S is the supply folder, W a work folder for clones):

    gstack-evals rm-supply p-gates --suite review-real-bugs-2026-11.json --stage1 review-real-bugs-2026-11-stage1.json --work $W --out $S/p-gates-2.jsonl
    gstack-evals rm-supply b-gates --frame wiki/plans/2026-11-15-geva-538-skill-pack-h2h-prereg/b2-frame.json --work $W --shard <i>/6 --out $W/b-gates-<i>.jsonl
    cat $W/b-gates-*.jsonl > $S/b-gates-2.jsonl
    gstack-evals rm-supply vis-requests --b $S/b-gates-2.jsonl --frame wiki/plans/2026-11-15-geva-538-skill-pack-h2h-prereg/b2-frame.json --work $W --out $S/vis-requests-2.jsonl

Paid, not yet run (gate 3: Claude Opus 5.5 and GPT-6.2 Astra on each unit, 162 calls). It needs the ledger item the
Captain records for "Supply: B visibility reads" and a rig admission record on the machine that spends:

    gstack-evals rm-supply vis-send --requests $S/vis-requests-2.jsonl --out $S/vis-send --run-id geva590-visibility-1 --item <ledger item>

Keyless again, after the read:

    gstack-evals rm-supply vis-read --requests $S/vis-requests-2.jsonl --replies $S/vis-send/replies.jsonl --out $S/visibility.json
    gstack-evals rm-supply draw --p $S/p-gates-2.jsonl --b $S/b-gates-2.jsonl --visibility $S/visibility.json --out $S/draw.json
    gstack-evals rm-supply counts --p $S/p-gates-2.jsonl --b $S/b-gates-2.jsonl --visibility $S/visibility.json --draw $S/draw.json --out $S/counts.json
    gstack-evals rm-supply build --draw $S/draw.json --p $S/p-gates-2.jsonl --b $S/b-gates-2.jsonl --sources <full clones> --out <units>

## Counts, 2026-11-24, before gate 3

P, the suite's 101 outside bug units and 15 decoys:

| | Units | Read errors | Gate 1 | Gate 4 | Both |
|---|---|---|---|---|---|
| Bug units | 101 | 1 | 97 | 100 | 97 |
| Decoys | 15 | 0 | 12 | 15 | 12 |

47 bug units were never run by Harness Evals; 43 pass both gates.

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
| Gate 4 also | 81 |
| Awaiting gate 3 | 81 |

Gates in plan order: gate 1 passes 149, gates 1 and 2 pass 81, gates 1, 2 and 4 pass 81.

Instruction files among units that pass gate 4:

| | Units | CLAUDE.md | Root CLAUDE.md | AGENTS.md | .claude/ | settings | .mcp.json | settings stripped | unit diff changes one |
|---|---|---|---|---|---|---|---|---|---|
| P bug units | 100 | 70 | 67 | 75 | 53 | 19 | 7 | 17 | 1 |
| Decoys | 15 | 15 | 11 | 13 | 10 | 3 | 0 | 3 | 0 |
| B (gates 1 and 2 passed) | 81 | 6 | 6 | 6 | 2 | 0 | 0 | 0 | 0 |

Check against the design-stage prototype on its own 80 repositories: 80 blamed, 79 single-parent, 48 half-blamed, 35 at
most 2,000 lines, 16 dated (the prototype counted 37 and 17). The two units apart are ties between equally blamed commits
in multi-file fixes: the prototype took files in Python's set order, this code takes the first blamed in patch order.

## Digests

| File | sha256 |
|---|---|
| review-real-bugs-2026-11.json (g-harness-evals 74f0de63dc) | 97b9da91b2b5ffb7d5cc7af14d93896a009cf31a3f846ba3d691a96513a9d84b |
| review-real-bugs-2026-11-stage1.json (same commit) | 827929af7ce3818e6f5cd6c5fbfb1dec82976161160d59fd61d6d9e2d0319ed1 |
| b2-frame.json | 3e0bbb74711e308c8d77edff3342be8ff0e09220e602b9310c509083a64bfba3 |
| p-gates-2.jsonl | 62fa2a2899a04088225053c18aafef14da20da9ba53c70aeb6d4de587841ad70 |
| b-gates-2.jsonl | e35301c17192fddd5e4ececf2bbc05b04adc84794cc034d26d18e4ae10b21bf2 |
| vis-requests-2.jsonl | 4ee3b7c9e6e8b1866bbd672253659acb9497e03b698dbc95d3da257c145a0707 |
