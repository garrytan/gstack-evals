# Ask replay paid stage: run log

Counts only. No item ids, per-item digests, thread codes or owner text. Spend is read from the run's one ledger (record and local SQLite under this folder). Caps are 1.35 times central. Admission mode on every line item is warn (the lane's dry run uses the same; no rig admission record was written, so each lease carries a RIG_UNPROVEN warning).

Code: results branch at d2eccae0683820774c60fb5c9fbccfc89966ea1e, tree clean, run from the worktree. gstack pin for arm (b) read from the local gstack clone at 0326b144 (v1.99.5.0).

## Setup

- Ledger: record at run/ledger-record, local ledger at run/ledger.sqlite; caps recorded for I1, I2, I3, I5, I6, I7 and I8 only. I2r and I4 are not recorded.
- Synthetic bundles sealed to the custody recipient: the smoke's 20 items (12 DECISION, 6 DUPLICATE, 1 PERMISSION_FOR_DEFAULT, 1 OBSERVABLE; plain sha256 879f717c0d53) and the labeller check's 3 items (one DECISION, one DUPLICATE, one PERMISSION_FOR_DEFAULT from the smoke draw; plain sha256 b13029b01541).

## I1 smoke (ask-i1-smoke, cap $X)

- Leases: 3, one per model shard (Opus, Sol, particle-1), each opened and settled once; 0 unknown charges.
- Spend: $X of $X (Opus $X, Sol $X, particle-1 $X).
- Calls: 220 samples, 220 calls (no retries). Opus 80 (4 arms x 20), Sol 80, particle-1 60 (3 arms x 20).
- Status: complete, no stop.
- MISSING: 0 of 220 (parse 0, safety 0, upstream 0) on every model and arm. Refusals and safety-filter stops: 0.
- Replies at the 4,000-token output cap: 0 of 220 (0.0%).
- Reply shapes: Opus (Anthropic output_config.format) and Sol (OpenAI Responses text.format) JSON schema modes and particle-1's text parse all produced a valid action on every sample.
- particle-1 data_collection deny: confirmed. Every request carried provider routing only particle-ai, no fallbacks, data_collection deny; all 60 calls returned HTTP 200 from a particle provider. Evidence logged in CUSTODY.md. particle-1 runs on real items in I8.

## I3 part 1: labeller schema check on 3 synthetic items (charged to ask-i3-label-audit, cap $X)

- Leases: 2 (Opus, Astra), each settled once; 0 unknown charges.
- Spend: $X (Opus $X, Astra $X).
- Calls: 6 samples, 6 calls, all HTTP 200, no retries.
- Status: pass. The Anthropic output_config.format and the OpenAI Responses text.format schemas were accepted, every reply parsed, and the nullable integer came back as an integer on the duplicate and as null on the other two, for both labellers. Both labellers gave the synthetic set's class on all 3 items. 0 capped, 0 safety stops.

## I2 pilot (ask-i2-pilot, cap $X)

- Draw: 40 items (16 must-ask, 24 needless: 21 DUPLICATE, 2 PERMISSION_FOR_DEFAULT, 1 OBSERVABLE), seed minted from random bytes and logged in CUSTODY.md; the drawn set was sealed to the custody recipient before teardown.
- Leases: 2 (Opus, Sol), each settled once; 0 unknown charges.
- Spend: $X of $X (Opus $X, Sol $X).
- Calls: 240 samples (per model: arm a at k=1 and arm b at k=2 on 40 items), 240 calls, no retries.
- Status: complete, no stop.
- MISSING: 0 of 240. Safety-filter stops 0. Replies at the output cap 0.
- Measured cost per call (Opus): arm a replicate 1 $X, arm b replicate 1 $X, arm b replicate 2 $X (whole prompt read from cache). Sol: $X, $X and $X.
- Readout (ask-replay pilot): admitted. Opus: needless sends 5.5 of 24, must-ask misses 6.5 of 16, admits; W 0.0625, V 0.1517, B2 0.1205, projected MDD 13.39 points at k=2 and 12.61 at k=3. Sol: needless sends 2 of 24, misses 8 of 16, does not admit on its own; W 0.0417, V 0.058, B2 0.0371, projected MDD 8.79 at k=2 and 7.98 at k=3. The rule admits when one frontier model admits. k = 3 for the main run, because Opus's projected MDD at k=2 is above 12 points.

## I3 part 2: label audit (ask-i3-label-audit, cap $X)

- Draw: 99 items (40 DECISION, 40 DUPLICATE, 11 PERMISSION_FOR_DEFAULT, 8 OBSERVABLE), seed minted from random bytes and logged in CUSTODY.md; the drawn set was sealed to the custody recipient before teardown.
- Leases: 2 more (Opus, Astra), 4 on the item in all with the schema check; each settled once; 0 unknown charges.
- Spend: Opus $X (99 calls, $X per call), Astra $X (99 calls, $X per call). Item total with the schema check: $X of $X.
- Calls: 198 samples, 198 calls, no retries. MISSING 0, safety-filter stops 0, replies at the output cap 0.
- Status: complete. Audit labels sealed for 99 of 99 items on both labellers.
- Kappa against the audit's labels (needed against needless, pooled / duplicate against must-ask): Opus 0.4884 / 0.65, Astra 0.5505 / 0.725. Both pooled values are below 0.6, so the audit does not stand. The frozen rule now calls for the contingency (I4: both labellers on the other 247 items, primary label = their agreement).
- Class counts, audit label against labeller label (Opus; Astra): of 40 DECISION, 26 and 27 kept DECISION, 14 and 13 moved to a needless class; of 40 DUPLICATE, 33 and 37 kept; of 8 OBSERVABLE, 5 and 5 moved to DECISION; of 11 PERMISSION_FOR_DEFAULT, 8 and 7 kept. The two labellers agree with each other on needed against needless on 90 of 99 items; each agrees with the audit's labels on 75 (Opus) and 78 (Astra).
- Answer judgements (S2 input): 2,341 answered ledger rows seen; both yes 1,177, both no 581; labeller agreement 0.8492.

## Stop: label audit did not stand (2026-11-15)

- Stopped before any further paid call, as the run brief requires when kappa is below 0.6 and I4 would be needed. I4 and I2r were never opened. I5, I6, I7 and I8 were not leased.
- Projections from the measured per-call costs (no lease opened): I4 contingency $X (Opus $X, Astra $X) against its $X cap; I5 linking $X against its $X cap (over by $X); I6 Opus at k=3 about $X against $X; I7 Sol at k=3 about $X against $X; I8 particle-1 at k=3 about $X if replicates 2 and 3 read from cache, about $X if they don't, against $X.

## Ruling after the stop (2026-11-15)

- Kappa miss as it stands: pooled kappa 0.49 for Opus and 0.55 for Astra, against the 0.6 bar. The labellers agree with each other on needed against needless on 90 of 99 items, against 75 (Opus) and 78 (Astra) with the October audit labels. Our reading of that pattern is that the October labels are the weak side; that is a reading, not a measured fact.
- The Captain ruled A1 (run I4 under the frozen rule, cap $X), B1 (I5's cap to $X, because the central price undercounted Opus's tokenizer) and C1 (I8's cap to $X). Recorded in the ledger with those words: I4 initialised at $X, I5 raised from $X to $X, I8 raised from $X to $X. I2r stays unopened.
- Order from here: I4, I5, I6, I7, I8, score.

## I4 contingency relabel (ask-i4-relabel, cap $X)

- Projection before the lease: $X (Opus $X, Astra $X).
- Leases: 2 (Opus, Astra), each settled once; 0 unknown charges. Each shard ran inside a custody opening of the sealed audit draw, which label --kind contingency reads through --audit-draw to skip the 99 audited items.
- Spend: $X of $X (Opus $X, 247 calls, $X per call; Astra $X, 247 calls, $X per call).
- Calls: 494 samples, 494 calls, no retries. MISSING 0, safety-filter stops 0, replies at the output cap 0.
- Status: complete. Contingency labels sealed for 247 of 247 items on both labellers.
- Label readout after I4: audit complete, contingency complete, decision not withheld by the labels. Primary labels are now the two labellers' agreement: 302 of 346 items carry the same class from both labellers; the other 44 leave the primary readout and are shown under each labeller's labels.

## I5 duplicate linking (ask-i5-linking, cap $X after the raise)

- Projection before the lease: $X.
- Leases: 1, settled once; 0 unknown charges.
- Spend: $X of $X (121 calls, $X per call).
- Calls: 121 samples (the 121 audit-labelled duplicates), 121 calls, no retries. MISSING 0, safety-filter stops 0, replies at the output cap 0.
- Status: complete.

## I6 main run, Opus 5.5 (ask-i6-opus, cap $X)

- Projection before the first lease, k = 3, from the pilot's measured Opus usage per arm and replicate (replicate 1 writes the user content to cache at $X per million, replicates 2 and 3 read the whole prompt at $X per million, output at $X per million), scaled to the full bundle's prompt sizes, with the ledger view adding about 3,200 tokens in arms c and d: about $X per item, $X for 346 items, under the $X cap.
- Leases: 2 (two shards), each settled once; 0 unknown charges. Shard 1 ran 3,575 samples and stopped at its 50-minute launch stop (the program wrapping it was stopped by a Capy worker restart about 36 minutes in; the shard process kept running in the foreground and ended on its own clock). Shard 2 resumed in the same directory, skipped the 3,575 sealed samples and ran the other 577. No resume redraws (E_ASK_RESUME 0).
- Spend: $X of $X (shard 1 $X, shard 2 $X), against the $X projection.
- Calls: 4,152 samples (346 items x 4 arms x k = 3), 4,152 calls, no retries.
- Status: complete, no stop. No end-of-run UPSTREAM pass needed.
- MISSING: 0 of 4,152 in every arm (parse 0, safety 0, upstream 0). Safety-filter stops 0. Replies at the output cap 0.

## I7 main run, GPT-6.1 Sol (ask-i7-sol, cap $X)

- Projection before the first lease, k = 3, from the pilot's measured Sol usage (replicate 1 metered at $X per million uncached input, replicates 2 and 3 reading the prompt from cache at $X per million, output and reasoning at $X per million), scaled to the full bundle's prompt sizes, with the ledger view adding about 2,200 tokens in arms c and d: about $X per item, $X for 346 items, under the $X cap. (I6 landed 1.4% above its projection.)
- Leases: 2 (two shards), each settled once; 0 unknown charges. Shard 1 ran 3,968 samples and stopped at its 50-minute launch stop (its wrapping program was again stopped by a Capy worker restart near the end; the shard finished on its own clock and returned its result). Shard 2 resumed in the same directory, skipped the 3,968 sealed samples and ran the other 184. No resume redraws.
- Spend: $X of $X (shard 1 $X, shard 2 $X), against the $X projection.
- Calls: 4,152 samples, 4,175 calls: 23 unparsable attempts got the frozen one retry (21 in arm c, 2 in arm d). No upstream failures.
- Status: complete, no stop. No end-of-run UPSTREAM pass needed.
- MISSING: 1 of 4,152 (arm c, a parse failure after its retry, a reply cut at the 4,000-token output cap); arms a, b and d 0 of 1,038 each; arm c 1 of 1,038 (0.10%, under the 3% ceiling). Safety-filter stops 0. Final replies at the output cap: 1 (the same arm c sample).

## I8 main run, particle-1 (ask-i8-particle, cap $X after the raise)

- Projection before the lease, k = 3, arms a to c, from the smoke's measured particle-1 usage (about 1.1 billed tokens per estimated token; input $X, cache read $X, output $X per million) scaled to the full bundle's prompt sizes: about $X if replicates 2 and 3 read from cache, about $X if they don't; both under the $X cap. The smoke showed the endpoint caching the shared gstack prefix across items.
- Routing: the same deny route as the smoke (only particle-ai, no fallbacks, data_collection deny) on every call; no E_ASK_PROCESSOR.
- Leases: 1, settled once. 1 unknown charge ($X, a 200 answer whose usage could not be read, charged at its full reservation).
- Spend: $X of $X (settled $X plus the $X unknown), against the $X cached projection. Replicates 2 and 3 read most of the prompt from cache.
- Calls: 3,114 samples (346 items x 3 arms x k = 3), 3,135 calls: 21 upstream attempts got the frozen retries (20 HTTP 429 rate limits and 1 unreadable 200 answer), all recovered.
- Status: complete, no stop. No end-of-run UPSTREAM pass needed.
- MISSING: 0 of 3,114 in every arm. Safety-filter stops 0. Replies at the output cap 0.

## Score (ask-replay score, frozen 10,000 bootstrap draws, with --items, --replies, --pilot-items, --pilot-replies and --labels)

- Inputs complete: no E_ASK_INCOMPLETE, no decision withheld. Links: Opus links (121 duplicates linked, 98 links; Astra agrees on 36 of the 40 audited duplicates, 0.90). Chains: 212 clusters, 44 chains holding 134 items.
- Primary labels: the two labellers' agreement, 302 items (162 needless, 140 must-ask). Main-run k = 3, matching the pilot rule.
- MISSING in the scored readout (302 items, 906 samples per arm): Opus 0 in every arm; Sol 0 in a, b and d, 1 in c (0.11%); particle-1 0 in every arm. No cell passes the 3% ceiling.
- Decision row: fix-method (a cut with a failed guard). Per model: Opus readable, cut true, guard fail; Sol readable, cut true, guard pass. build false, trim null, drop false, cut candidate false, why-null false.
- Opus, (c) minus (b): needless -6.79 points [-10.22, -4.03], leave-one-thread-out -8.94 to -5.47; must-ask misses +4.76 [+0.48, +9.29], LOTO +3.86 to +5.88. The guard needs the upper end below +5, so it fails.
- Sol, (c) minus (b): needless -4.32 [-7.33, -1.95], LOTO -5.22 to -3.52; must-ask misses -3.81 [-6.90, -0.71], LOTO -4.13 to -1.63. Guard passes.
- (d) minus (c), needless / must-ask: Opus +1.65 [-0.25, +3.78] / -1.67 [-5.95, +2.62]; Sol -1.85 [-3.73, -0.44] / -3.57 [-8.33, +1.19].
- (a) minus (b), needless / must-ask: Opus +3.91 [+0.72, +7.57] / -1.43 [-6.43, +3.57]; Sol -0.41 [-3.59, +2.04] / -3.57 [-7.62, +0.48].
- (a) minus (c), needless / must-ask: Opus +10.70 [+6.81, +15.49] / -6.19 [-11.19, -1.43]; Sol +4.12 [+1.58, +6.86] / +0.24 [-4.52, +5.00].
- Duplicates, (c) minus (b): Opus -6.31 [-10.32, -3.27]; Sol -3.03 [-5.43, -1.03].
- Ceiling, arm (b)'s needless send rate: Opus 26.3% (128 of 486 samples), Sol 17.9% (87 of 486).
- Label views: the audit's labels, Opus's labels and Astra's labels each give fix-method too, so the row is not label-sensitive.
- particle-1 (never decides a row): (c) minus (b) needless -5.14 [-7.95, -2.46], must-ask +1.67 [-2.38, +5.71].
- The full score output is in logs/score.json (numbers only; 0 item-id-shaped strings).

## Totals

- Paid spend: $X across 17 leases, every one settled; 1 unknown charge ($X, I8). By item against cap: I1 $X of $X, I2 $X of $X, I3 $X of $X, I4 $X of $X, I5 $X of $X, I6 $X of $X, I7 $X of $X, I8 $X of $X. I2r never opened.
- Cap stops 0. Safety-filter stops 0 on every item. Custody incidents 0.
