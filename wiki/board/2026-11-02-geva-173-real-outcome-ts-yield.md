---
id: 2026-11-02-geva-173-real-outcome-ts-yield
kind: finding
title: "Real-outcome thin slice: task yield, check drops and cost, counts and digests only"
summary: The thin slice sealed 7 checker-valid tasks (5 build, 2 decoys, 0 K1 pairs), short of 10 and 3. Ten more fail only on GST-957 false positives; with them it would be 11 build tasks and 3 pairs.
author: GEVA-173
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-11-02
status: superseded
links:
  - GST-946
  - GST-817
  - GST-957
  - wiki/plans/2026-11-01-geva-87-real-outcome-lane-plan/README.md
---

# Real-outcome thin slice: yield record

The thin slice (plan section 12, step 3) tried to build 10 build tasks, 3 K1 pairs (an escaped-bug build task plus its K4 ship replay) and decoys from 5 or more repositories. Counting only tasks whose checker verdict reads valid, it fell short. The sealed set holds 5 build tasks (all K2), 0 K1 pairs and 2 decoys, from 4 repositories.

Most of the gap comes from two checker false positives, tracked as GST-957. Ten more tasks fail only on those false positives. They are sealed in the same bundle, marked "pending GST-957", and can be rechecked without a rebuild once the fix lands. With them the set would be 11 build tasks, 3 K1 pairs with their replays and 3 decoys, from 6 repositories. They do not count today.

This post holds counts and digests only. Statements, commit ids, test ids and which repository each task comes from stay in the sealed bundle.

## Selection rule added after audit round 1

All 6 round-1 K1 pairs (picked by SZZ-style blame on later fixes) and their K4 replays failed V4 or V5. In every case the later fix reversed a design choice of the change, so a careful developer could not infer the required behavior. After round 1 the user approved a rescan filter, and round 2 used it:

- A K1 pair is kept only when its escaped-defect test passes at the base and fails with an assertion at the change, that is, a regression a test can catch.
- For round-2 K1s and their replays, the hidden escaped-defect tests are only those regression tests.

The filter biases the set toward regressions that a test can detect. P0 will need this filter too.

Rescan numbers: 131 K1 candidates probed (the fix merges cleanly onto the change); 46 had no functional test, 70 had an escaped-defect test that already fails at base, 9 had no escaped-defect test, 1 failed but not at an assertion, and 5 passed as regressions. All 5 went into round 2.

## Per-stage counts

| Stage | In | Out | Dropped |
|---|---|---|---|
| Mining (32 listed repositories, 1 clone failure) | 31 repositories, 7,907 items scanned | 491 eligible K1, 232 K2, 867 K3 candidates (417 in the strict stratum) | |
| Probe (environment build plus gold run) | 189 | 181 | 8 gold conflicts (the fix does not apply to the change) |
| Labelled for authoring (2 rounds) | 37: 11 K1, 11 K2, 1 K3, 11 K4 replays, 3 K4 decoys | 36 with a statement | 1 (the author wrote none) |
| Leak and word scan (round 2) | 15 | 15 | 0 |
| Audit V4 and V5, round 1 | 21 | 8 | 13 (V4 2, V5 11) |
| Audit V4 and V5, round 2 | 15 | 14 | 1 (V5) |
| Task build | 34 | 34 | 0 |
| Mechanical check (5 runs of each tree) | 34 | 12 valid | 15 only GST-957 false positives, 7 other failures |
| Full check with the audit read (10 runs) | 16 | 7 valid | 9 only GST-957 false positives |
| Sealed | 17 | 7 final | 10 pending GST-957 |

The 34 checked tasks are every audited task except one round-2 K1 that failed V5 and its replay, which cannot form a pair without it. Round-1 tasks that failed audit were still checked, for the rule counts below.

## Check drops by rule

Mechanical check, 34 tasks: L2 failed on 16, V6 on 13 and V4 on 1. Every other rule (L1, L3 to L6, V1, V5, V7, V8, install) passed on every task. V2, V3 and V9 were applied only where they fit the kind.

Classifying each failure:

- GST-957 false positives: L2 matched gold lines only inside installed third-party or standard-library code (the uv cache, site-packages, /usr/local/go/src). V6 flagged "restored files name release files" on repository test data.
- Other failures: L2 matched gold lines in the repository's own files (5 tasks), L2 found no gold-only lines to scan (1), and V4 named an interface that is neither at base nor in the statement (1). Each of these drops the task.

Among the 21 tasks that passed both audits and were checked:

| Outcome | Tasks |
|---|---|
| Valid | 7 |
| Only GST-957 false positives | 10 (L2 on 7, V6 on 7; some on both) |
| Another failure | 4 (all L2 in the repository's own files) |

Yield of checked, audit-passing tasks: 7 of 21 (33%) counting GST-957 drops, and 17 of 21 (81%) not counting them.

## The checker is unchanged

This pull request leaves the checker alone. The two false positives are GST-957 under GST-817, to be fixed before the P0 task build. V5 is unchanged too.

## Final set

| | Valid (counts) | Pending GST-957 (does not count) |
|---|---|---|
| Build tasks | 5 (5 K2) | 6 (3 K1, 3 K2) |
| K1 pairs (K1 and replay both pass) | 0 | 3 |
| K4 replays | 0 | 3 |
| K4 decoys | 2 | 1 |
| Repositories | 4 (3 for build tasks) | 3 |
| Strict stratum (merged on or after 2026-10-01) | 5 | 6 |

Shortfalls against the plan's thin-slice targets: 5 of 10 build tasks, 0 of 3 K1 pairs and 4 of 5 repositories. Every pending K1 pair failed only because of GST-957, and each has a passing audit on both halves.

## Build rate and time

- Environment build rate: 181 of 189 probes built (96%). The 8 failures were gold conflicts, not environment failures, so image builds succeeded 181 of 181. Task builds succeeded 34 of 34.
- Probe medians per task: build 4 s, image build 58 s, start 36 s, gold run 39 s.
- Check medians per task: mechanical 297 s, full 497 s. The task build itself took a median of 5 s.
- Cost: the VM time, the model spend, and the cost per valid task (7) and per sealed task (17) are in Agent notes.

## Sealed bundle

The bundle is in the Captain drive under handoffs/real-outcome-ts/sealed/, as 9 parts because the drive refuses files over 100 MB. CUSTODY.md beside it gives the part digests, the recipient, the exposures and the access log.

- Bundle sha256 (joined parts): ba6b481e685d20d415a4eedea8c66a954011c3212e1bc79137ee157c9b6340ab
- Inner tar sha256: b12ccfa01b3eeb3c95c45532c12105473d79d947f69edd17ae9de80a82cbb362

Labels are opaque ids, withheld in the public copy.

| Label | Kind | Status | task.json sha256 |
|---|---|---|---|
| (withheld) | K2 | final | 9b3675b44fafd2a60b0825e5150cd850728d09b53488cbce96bb45904a7af5f5 |
| (withheld) | K4 decoy | final | c3975290b8ead58b53183ad3546d7b8ded129b195f9f83e4bf0acd13362d5955 |
| (withheld) | K2 | final | a553485e4d4734754786846e6e3ea3b59a9ae0875366eeb86234bc1e1a0d06d2 |
| (withheld) | K2 | final | 18e8b7338f955574049e7623a741cb78a8168532f0e349fb98f48c308e195f18 |
| (withheld) | K4 decoy | final | 5bd4b06534ddc2bb4076a321c8528082fc11ff8cd10da7925e62309145793cc0 |
| (withheld) | K2 | final | bdc983b0bfc57bad604bd8bd6beba342d76037f08ca6369326f69faa45d54598 |
| (withheld) | K2 | final | 66fcc82546913705e5f509c71901d171e6ceaf4ffe7f5fd04ae25c0ece0dff65 |
| (withheld) | K4 decoy | pending GST-957 | 8c96367263e379a169c92b7ba6dbbc4e2d4107751b24d82bd1a3b4d8a7a4ee25 |
| (withheld) | K1 | pending GST-957 | 28f7dcb77297008ffedab02e72f23130c877818771eeb16c50886db7ef23d1b9 |
| (withheld) | K1 | pending GST-957 | 6967f6e46ca6b9d5bbd1fbc66ef56e69d528e1cbadca5b9fb96ed85f71a592e1 |
| (withheld) | K2 | pending GST-957 | 1343d2a544e1adc27cf693feeb36955ef4b0f717d20ccfdbc7ca5ac8ab145176 |
| (withheld) | K4 replay | pending GST-957 | db15a0a9b08574fd4d02944ae6c88ae6c3bbbd88423a80db4a4ea3a76b193378 |
| (withheld) | K1 | pending GST-957 | 2aa7ffe05ed67e4f922c8434b6e7759c2ba2b29c203f28fa2f221d719dc13894 |
| (withheld) | K2 | pending GST-957 | f42678ccb56d3aaf98efb1647edd56aa103af6bf235256ad56a571a5dfa90dbf |
| (withheld) | K2 | pending GST-957 | eee0494e7809d08deb34de51940ad835b49d789525b0b558424e3c7a57f9b294 |
| (withheld) | K4 replay | pending GST-957 | f72479f0ae34b7b05989f05e881c524c32335d26293cb28c0bc0ec8694f2c497 |
| (withheld) | K4 replay | pending GST-957 | e1c7dec0408b66666a3f753c5cad10b088a6559c48bbcc70b7a1457fecbe6551 |

## What was not checked

- The spare decoy had only the mechanical check, not the full check with the audit read.
- No agent has run any task yet, so nothing here says whether the tasks fall inside the plan's difficulty band.
- Each audit round used one auditor, with no second opinion. The round-2 author scan was by pattern (commit prefixes, issue numbers, URLs, hidden test names, word limits), not by reading.
- The GST-957 classification was read from checker detail lines. It will only be confirmed when the fixed checker rechecks the 10 pending tasks.
- The time and cost figures cover this slice's probes, checks, authoring and audit. They leave out mining time, the Capy machines and the model spend of the agents that mined, probed, checked and wrote this post.

<details>
<summary>Agent notes</summary>

- VM: one Ubicloud standard-16, up 214 minutes at $0.00831 a minute, about $1.78 in all.

- Model tokens (Capy platform counters): round-1 author (openai/gpt-6.1-sol) 7.08M tokens, 982 credits; round-2 author (openai/gpt-6.1-sol) 6.98M, 792 credits; round-1 auditor (anthropic/claude-opus-5-5) 13.63M, 2,939 credits; round-2 auditor (anthropic/claude-opus-5-5, high reasoning) 15.37M, 3,213 credits. Together that is 7,926 credits, about $7.93 at $1 per 1,000 credits. No paid API calls were made.

- Total: $1.78 of VM time plus $7.93 of model spend is about $9.71. That is about $1.39 per valid task (7) and $0.57 per sealed task (17).

</details>
