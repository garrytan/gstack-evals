---
id: 2026-11-24-geva-587-design-time-state-modeling-pre-run-change-1
kind: plan
title: "Pre-run change 1 to the design-time state modeling eval: wave 2 searches afresh, because attempt 3's search pools were not kept"
summary: "Attempt 3's search pools and seeds are gone, so wave 2 runs a fresh search on the same frame with a new seed, excludes attempt 3's unit repositories by digest, and seals its own pool."
author: GEVA-587
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-24
status: open
links:
  - wiki/plans/2026-11-24-geva-587-design-time-state-modeling-prereg/README.md
  - wiki/plans/2026-11-15-geva-537-eng-review-planted-units-prereg/README.md
  - lanes/eng-planted/construct/
---

# Pre-run change 1 to the design-time state modeling eval

## In short

- The plan's wave 2 continues attempt 3's frozen search pools "in their seeded order past the 953 repositories already searched". That needs each attempt 3 search run's pool and seed. Neither was kept. Custody holds only the manifests' digests and the 79 repositories that gave units. A listing-only opening of nine sealed archives on 2026-11-24 found no pool or seed file, and the screening VMs that held them were destroyed. The opening is logged in the custody log.
- So wave 2 runs a fresh search instead. It uses the same queries, ecosystems and frame, and draws with a new seed minted at launch. Every repository that gave attempt 3 a unit is left out by digest. Everything after the draw is unchanged: mine, construct, screen, recount, the two state screens and authoring, at the harness commit that runs the pilot.
- This time wave 2's pool, seed, manifest and searched list go into custody before its VMs are destroyed.
- No paid call has run. This change touches no arm, model, score, threshold, decision row, item cap or ledger item. It runs inside the plan's $100 VM cap for wave 2, on the Captain's word (B1, 2026-11-24).

This change governs where it and the plan differ.

## 1. The search

- **Queries and frame.** Attempt 3's, unchanged (lanes/eng-planted/construct/search.ts): Go, Node (TypeScript and JavaScript), Python and Rust; 300 to 50,000 stars in three bands; pushed since October 2026; at most 300 MB; no forks or archives; 10 pages of 100 a query. The fix window stays first public from 2026-07-01 to 2026-10-31.
- **Seed.** A new one, minted from random bytes by `ep search` at launch and recorded before the draw, as attempt 3 did. Wave 2 can't continue attempt 3's order, because that order hashed a seed nobody kept.
- **Draw.** 250 repositories an ecosystem, in the seeded order, after exclusion.
- **Exclusion.** `ep search --exclude <file>` drops every repository whose key is in the file before the draw. A key is the sha256 of the lowercase owner/name (search.ts `repoKey`), so the file names no repository. The file lists the 79 repositories in attempt 3's sealed recipes. It's written from recipes.json in /dev/shm on the Capy machine that holds custody, and only the keys reach the VM. Since every attempt 3 unit comes from those repositories, no wave 2 candidate can repeat one.
- **What exclusion can't cover.** Attempt 3 searched about 874 more repositories that gave no unit, and their names were not kept. Wave 2 may draw some of them again. They go through the same screen and recount. A fix attempt 3 screened out for a stable reason drops again, so the cost is VM time. A fix attempt 3 dropped only on a flaky recount could now pass. Where attempt 3's sealed drop records let us match one by its fix commit, the results report flags each such unit by count, and the count is printed beside every contrast.

## 2. Where it runs

- **Hosts.** Ubicloud standard-16 VMs, at most 4 at once (64 vCPUs, inside the crew's 208 and the project's 464), each holding no model key and no sealed plaintext beyond the exclusion keys. `ep mine --shard k/n` splits the manifest's rows by index modulo n, so each VM mines, constructs, screens and recounts only its share.
- **Commit.** Wave 2 runs from the results branch at the commit that adds this change. The pilot runs only if lanes/eng-planted/construct/ is byte-identical at its own commit, checked by digest and printed in the readout. A difference stops the pilot for the Captain.
- **Stop.** The first of: the drawn manifest's end, $100 of VM time (standard-16 compute at $0.00504 a minute plus disk, read from the runner's records), or, once the paid screens measure the state-shaped and screen rates, a projection of 70 state units in hand. Before those rates exist, only the first two can fire.

## 3. Custody

Before any wave 2 VM is destroyed, these are sealed with age to the eng-review recipient and logged in custody/gstack-evals/ep-geva537/CUSTODY.md with their sha256 values: each shard's run directory without its mirrors (pool.json and its digest, seed.txt, manifest.json and its digest, mined fixes, outcomes and drop evidence), the searched repository list, the clean units and their label map. The mirrors are public clones and are rebuilt from the manifest rows.

## 4. What the results say about it

The results name wave 2's seed digest, manifest digest, draw size, the share of drawn repositories that reached the screen, and the count of wave 2 units that attempt 3 had dropped on a flaky recount. Every contrast also prints its stratum by plan writer, as the plan already says.
