# Score area notes (lanes/design-constructed/score)

For the integrator to merge into the lane README: the reuse rows, the build-time choices (BT) this area makes, and the items left open.

## What is here

| File | Holds |
|---|---|
| parse.ts | the strict parse, the one lenient parse with its three frozen forms, the normalizer (8 changes of 40 words), length counts, the web check and the evidence read |
| stats.ts | four-decimal rounding, seeded shuffles and ids, the same-base-app derangement and weighted Cohen's kappa |
| packets.ts | tier-specific production packets, shuffled-key packets, check-pass mirrors, oracle lists, the file read |
| labels.ts | the pinned prompts, the label parse with explicit unlabelled cells, the one whole-packet resend, the particle-1 panel |
| score.ts | A, G, D and every section 7 secondary from fixedMatching, unit means, stock counts and STOCK FAIL |
| check.ts | gold cells, anchors and weights, floors, catch and false-fail rates, kappa, the detail check, the stage 2 re-check, the live judge probe |
| pairwise.ts | pairwise plan quality and the arm-guess probe |
| seams.ts | the one model caller (JudgeCaller) every judge, pairwise and probe call goes through |
| types.ts | this area's own shapes (review rows, packets, raw and reader cells) |
| fixtures.ts | invented units, keys, rows and a scripted judge for the dry run and tests |
| ../prompts/score/*.md | the label brief, the audit prompt, the detail label, pairwise, arm guess and the probe, each pinned by sha256 in labels.ts |

No shared file was edited. ScoreUnit (key plus base unit id plus evidence paths), ReviewRow, ReaderCell (LabelCell plus how a panel cell's edges were chosen) and the packet types live in score/types.ts.

## Reuse

Every copied file keeps its copyright line and names its source path and commit in its header.

| Source path | Commit | sha256 | What changed |
|---|---|---|---|
| lanes/aftermath/parse.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 674c3c1baef4a291f1d5afa117dd4382d0b328065ee18c5d8a5bca7466133721 | into score/parse.ts: bound to 8 changes of 40 words from frozen.ts; the lenient parse takes only the three frozen forms (no single-key object); overflowed() left to the run area; evidenceOpened added |
| lanes/devex/run/parse.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 49e46190e4baeb1a5553fc648880dda49f03a6fec05656fde647ca81c9b099ee | its binding folded into score/parse.ts; its attempt classifier is not copied (the run area owns end states) |
| lanes/aftermath/stats.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 72ca982d012c054b1dbd66546a80bc4a76481b9deb97382139aaca50d1edc9c1 | into score/stats.ts: shuffle, randomId, derangeByGroup, r4 and kappa only; maxMatching not copied; kappa takes cell weights; seedOf and rngFor added |
| lanes/devex/score/packets.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | d22d516a2c1053253a56643dff935bc232182f84bb54b37fcd98b333e5915aba | into score/packets.ts: design items with their files, 2x decoy and wrong-way items, 10x details, oracle lists, one seeded stream per packet identity |
| lanes/devex/score/judge.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | ffd356d50e989e3fc457474ad9f4e6065bcaaf0227d1142c2cffff2261264ac5 | into score/labels.ts: anticipated and screen-hit labels with the 10x detail label, R2-18's unlabelled yes, M11's panel; the metered client became a seam |
| lanes/aftermath/judge.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | e4e72291cf4506889e70e1b7d46185e6d7a2db613be63fd84b787d80186bc9b7 | into score/labels.ts: lastJson, the resend note and the pinned-prompt check; the version tap stays with the money area's client |
| lanes/devex/score/score.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 8ba2b75c4fb8b0e6d0820f2b4304f9c3761102d1575dee98ac8d2751d27e94bf | into score/score.ts: every credit through fixedMatching; G and D; decoy, wrong-way, evidence and file reads; PD-4 and PD-8 stock counts |
| lanes/aftermath/readings.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | f50a4f320a45d7de778d5e27755502c8ee493923b0e3433d3239988fd1925e56 | into score/check.ts: the gold-scoring core, now with anchor weights and the oracle half cap |
| lanes/devex/score/rules.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 3205cc4a6f0a0c7ec5901dd78e8f3062888ae347fdaeb90092d7ce45d982c7c0 | into score/check.ts: judgeScore, goldCells and recheck, rebuilt on prereg section 6 (gold from the other two families, the detail check, 80 cells in 8 packets) |
| lanes/devex/score/prompts/brief.md and audit.md | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | b6fe604ecc39eeb5fa0d16f2b8a9e0de98781abf42be3feacb571c672de34b6a and f87930837fa35bb750e507f8e867c586d771b7d33d2645aa0b54e23d4da1c98a | the shape only (labels, examples, answer format); the text of prompts/score/brief.md and audit.md is new, for design items |

## Build-time choices (score)

- **Packet items (BT).** A production packet shows every key item no key step dropped, so the mentioned and generic strata read from the same packet. Each item shows the file its statement names (the last path-like token with a source extension), or none.
- **Packet seeds (BT).** Each packet is shuffled and labelled from its own seeded stream (sha256 of the seed 20261114, a newline and the packet's identity, first 8 hex digits). Ids are unique within a build. The derangement uses seededRandom(20261114) directly.
- **Shuffled packets (BT).** A shuffled-key packet holds every session list of the unit-pass, the reference included, against the partner's primary items in the partner's key order; no stock rows or oracle list. Stage 1 refuses shuffled packets on a read other than base.
- **Oracle lists (plan section 11, BT).** One change per primary item, its statement; at 10x an item with a keyed detail adds "Specifically: " and its detail. Items without a keyed detail add nothing at 10x. A 10x change over 40 words is cut and its pair leaves the detail anchors.
- **Label parse (BT).** A missing entry, a non-array or out-of-range index, a conflicting repeat, a missing detail_changes on an anticipated detail-keyed 10x item, or a detail index not among the item's changes is unlabelled. A no that lists indices reads as a no (D's rule). A yes with no index is unlabelled for one judge (R2-18).
- **Resend (K4).** A judge's packet with any unlabelled cell, a yes with no index included, is resent once whole with the resend note, a new cache identity and twice the output cap.
- **Panel (M11, BT).** Gemini is asked, on the whole packet, when any cell splits on the anticipated or screen-hit label, on a shared yes's edges, or on the detail of a pair both credit. A panel member's yes with no index counts as a yes vote with no edges. A cell missing a first vote after its resend is unlabelled without asking Gemini.
- **Cache identity (BT).** Judge, effort, tier, prompt digest (the pinned templates the packet uses) and packet digest (sha256 of the rendered packet). The provider's version is recorded on each result.
- **Evidence read (section 11 BT).** A session opened an evidence file when any string in any tool input names the evidence path at a path boundary.
- **File read (section 11 BT).** Over the primary items: an item's file is named when any change names its path, its basename with extension, or a component identifier from its statement (PascalCase words of two or more parts, camelCase words), each as a whole token.
- **Per-change precision (BT).** The share of a list's changes credited with any kept key item, by its own matching over every kept key item.
- **Secondary cells (BT).** An unlabelled cell outside the primary leaves only the read it feeds null (mentioned, generic, precision, shuffled, decoy or wrong-way), never the review.
- **Gold (BT).** Gold cells are key-item cells only (no decoy or wrong-way cells). Anchors sit on primary items: stock rows 1 and 2 known-bad, the oracle list known-good. Other cells of those lists, and every stock row 3 cell, go through agreement. A list met in several packets counts once, the first in a fixed order.
- **Gate (BT).** The oracle cap keeps a seeded subset of oracle cells no larger than the real anticipated count. Anchors weigh min(1, real / (3 x anchors)) each, so they carry at most a quarter. The gate reads weighted kappa; the unweighted and real-list kappas print beside it.
- **Re-check sample (BT).** One unit per packet, half of each class per packet, units in a seeded order with the admitted tier's gold first and base-tier gold after, cells within a unit rotated across list sources. A production judge takes 80 cells in 8 packets; a panel member takes 40 in 4. Packets sit at evenly spaced queue positions.
- **Pairwise (BT).** An unreadable answer is resent once, then the pair is unread. Win rates count ties as half; the stock flag counts wins only.

## Open for the integrator

1. **Panel yes with no two-vote edge and no Gemini edge.** When Astra and Opus both say yes with different edges and Gemini says no, the frozen rule gives Gemini's edges, which are none. This build applies R2-18 ("other judges' edges are used, and the cell is unlabelled only when no judge names one") and takes the union of the yes voters' edges, counted as viaOthers. The other readings are unlabelled or uncreditable. This moves particle-1 scores.
2. **Panel cell with one member missing.** A cell where Astra's or Opus's answer is still missing after its resend is unlabelled, and Gemini is not asked (D's rule). Asking Gemini and taking two of three would lower particle-1's missing rate.
3. **Smoke packets and STOCK FAIL.** PD-8 excludes twin, reference and shuffled packets. Stage 1 smoke packets (gstack arms on the first 6 calibration units) are base real-key production packets, and this build counts them. Excluding them could change a STOCK FAIL read.
4. **"Reference packets" in PD-8.** Read as packets that hold no arm's list. None occur in the stage 1 plan, since every reference pass shares its packet with a none pass.
5. **Detail check on pairs the judge didn't name.** A gold pair the subject judge didn't credit in production is left out of its detail gate and counted unlabelled, not read as "no detail". Reading it as no would lower detail kappa.
6. **Pairwise stock block.** "A stock block (stock rows 1 and 2) against none's" is read as two blocks, row 1 against none and row 2 against none, each 8 changes. One 16-change block would be cut to row 1 by normalization. This moves only the pairwise flag, which decides nothing.
7. **Re-check size for panel members.** "40 from each member's set" is built as 40 cells in 4 packets of 10, 20 of each class.
8. **Live probe output cap.** Each route is probed at its own frozen cap (labels 16,000, check 24,000, pairwise 4,000), as prereg section 6 says. frozen.ts's outputCaps.probe (4,000) is used for the arm-guess probe. The money area's projection should read the caps the same way.

## Wiring left to integration

- cli.ts rows probe, labels and score still say "not built yet"; they belong to this area but the file is outside it. They should call liveProbe, labelAll with the judge check and re-check, and scoreReviews with stockCounts.
- JudgeCaller (seams.ts) is the money area's metered client: judge key to model id, effort, output cap, subject for per-model stops, the call's cacheKey, and the provider's version on the reply.
- ReviewRow comes from the run area's end-state classifier once each cell is final; evidenceOpened from parse.ts.
- The author area's generic screen (stock rows 1 and 2 against each key, by Astra and Opus) has no packet builder here; buildLabelPackets serves review lists only.
- The read area may carry its own copy of the stats helpers; this area's stats.ts holds only what scoring uses.
