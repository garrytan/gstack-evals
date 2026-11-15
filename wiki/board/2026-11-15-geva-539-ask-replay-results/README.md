---
id: 2026-11-15-geva-539-ask-replay-results
kind: finding
title: "Ask replay results: an ask ledger cut needless asks on Claude Opus 5.5 and GPT-6.1 Sol, but on Opus it also held back needed asks, so gstack doesn't build it as tested"
summary: "Ledger cut needless asks on Opus (-6.79 pts) and Sol (-4.32), but raised Opus's must-ask misses +4.76 [+0.48, +9.29], past the 5-pt guard. Row fix-method: not built as tested."
author: GEVA-539
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-15
status: done
links:
  - 2026-11-15-geva-539-ask-replay-prereg
  - garrytan/gstack-evals#348
  - garrytan/gstack-evals#351
  - lanes/ask-replay
  - src/runner/proxy/metering-proxy.ts
  - https://github.com/garrytan/gstack/tree/0326b144af36676d599dcf63a9fad9a870d22ed6
attachments:
  - 43b406052db78b09a77fd4ac18ab9fb079ca21f9b6db3a4520ead8285f101f0a  ops.ts.txt
  - defc653e813fa421450d28047aced671677c54ef10609ffa1d601323fac89956  run-log.md
  - 099993c81ed8f30b157bd8aee468a174a1973ec1c2d96f1713d0d4d0b6f2e3fa  score.json
---

# Ask replay results: an ask ledger cut needless asks on both frontier models, but on Opus 5.5 it also held back needed asks

- **We learned that showing a model the asks it already sent cuts needless asks on both frontier models we tested.** We replayed 346 real moments where a coordinating agent was about to ask its owner something, and scored the 302 that two model labellers classed the same way. Against gstack as it is today, gstack plus an ask ledger (a list of every earlier ask, open or answered) sent 6.79 points fewer needless asks on Claude Opus 5.5 (95% interval -10.22 to -4.03, from a base of 26.3% of samples) and 4.32 points fewer on GPT-6.1 Sol (-7.33 to -1.95, from a base of 17.9%). The model's own choices made most of that cut: the harness's send-time check made 6.1% of it on Opus and 9.2% on Sol. You should give an agent that asks its owner questions the list of asks it already sent, and measure the needed asks it holds back on each model you run.
- **We learned that on Opus 5.5 the same ledger also held back needed asks.** Must-ask misses rose 4.76 points (+0.48 to +9.29), past the 5-point guard we froze before the run, while on Sol they fell 3.81 points (-6.90 to -0.71). The frozen decision row is fix-method: gstack doesn't build the ledger as tested, and its ask rules stay as they are. You should check a change like this on every model you ship it to, because here it helped one frontier model and hurt the other.
- **We learned that the October labels for these asks failed our label audit.** Two labellers from different model families, Opus 5.5 and GPT-6 Astra, agreed with each other on 90 of 99 audited asks, but with the October labels on only 75 and 78, and kappa missed the 0.6 bar (0.49 and 0.55). Our reading is that the October labels are the weak side; that is a reading of this pattern, not a measured fact. You should audit model-made labels before a paid run and price a relabel in advance. This run did both, and the decision came out the same under the October labels, Opus's labels and Astra's labels.

## Status

This is the results record for the preregistration [2026-11-15-geva-539-ask-replay-prereg](../../plans/2026-11-15-geva-539-ask-replay-prereg/README.md), merged in #348. Every interval below is the frozen scorer's (`ask-replay score`, 10,000 bootstrap draws at the frozen seed), converted from fractions to percentage points and otherwise as score printed it. The paid run finished with no cap stops, no safety-filter stops and no custody incidents. The arms are:

- (a) no gstack: the owner's own standing rules, with no gstack prose;
- (b) gstack today: (a) plus three whole files of gstack v1.99.5.0's prose, pinned at commit 0326b144 and checked by sha256;
- (c) gstack plus the ledger;
- (d) the ledger without gstack's prose: (a) plus exactly the ledger parts (c) adds.

## What works

- **The ledger cut needless asks on both frontier models, and the cut held with any one thread left out.** (c) minus (b), needless sends: Opus -6.79 [-10.22, -4.03], leave-one-thread-out range -8.94 to -5.47; Sol -4.32 [-7.33, -1.95], range -5.22 to -3.52. On duplicates alone: Opus -6.31 [-10.32, -3.27], Sol -3.03 [-5.43, -1.03].
- **On Sol it cut needless asks and needed-ask misses together.** (c) minus (b), must-ask misses: -3.81 [-6.90, -0.71]. Sol passes the guard with room.
- **The model did most of the work, not the filter.** The send-time check folds a repeat of an open ask and refuses a repeat of an answered one. It made 6.1% of Opus's cut and 9.2% of Sol's; the rest came from the model choosing FOLD or DROP itself with the ledger in view.
- **gstack today already beats no gstack on Opus.** (a) minus (b), needless sends: +3.91 [+0.72, +7.57]. Without gstack's prose, Opus sends more needless asks, and its must-ask misses show no detectable change (-1.43 [-6.43, +3.57]).
- **The ledger also works without gstack's prose.** Against no gstack, the ledger alone cut needless sends by 9.05 points on Opus [-13.38, -5.49] and 5.97 on Sol [-8.90, -3.36] ((d) minus (a)). Against gstack plus the ledger it did about as well: (d) minus (c) is +1.65 [-0.25, +3.78] on Opus and -1.85 [-3.73, -0.44] on Sol, where the ledger alone did better.
- **particle-1 shows the same cut (descriptive only; it never decides a row).** (c) minus (b): needless -5.14 [-7.95, -2.46], must-ask +1.67 [-2.38, +5.71].
- **The run was clean.** 1 of 11,418 main-run samples went missing (one Sol parse failure in arm (c)). There were 0 safety-filter stops, 0 cap stops and 0 custody incidents, and the frozen contingency handled the failed label audit without a new rule.

## What didn't work

- **On Opus the ledger costs needed asks, so its guard fails.** (c) minus (b), must-ask misses: +4.76 [+0.48, +9.29], leave-one-thread-out range +3.86 to +5.88. The guard needs the upper end below +5. The interval also excludes zero, so this is a measured cost, not only a wide interval.
- **On Opus, no gstack at all misses fewer needed asks than gstack plus the ledger.** (a) minus (c), must-ask misses: -6.19 [-11.19, -1.43]. The ledger on top of no gstack points the same way: (d) minus (a) is +4.52 [-0.24, +9.29].
- **The cuts are small next to what the plan said earns a build.** Before the freeze, the Captain accepted the power plan on the grounds that "a ledger only earns its build with a cut well above 11 points" (ruling N1). The cuts we measured are 6.79 and 4.32 points. The frozen build row asks only for an interval below zero, so this doesn't change the row, but it limits what a fixed ledger could promise.
- **Both frontier models hold back a large share of needed asks in every arm.** Under the primary coding, where FOLD or DROP on a must-ask counts as a miss, Opus missed 35.7% to 41.9% of must-ask samples across the four arms and Sol 46.9% to 54.3%. These rates count FOLD, moving the ask to the next scheduled digest, as a miss; score didn't print drop-only rates per arm.
- **On Sol, gstack today showed no needless-ask benefit over no gstack.** (a) minus (b): needless sends -0.41 [-3.59, +2.04], must-ask misses -3.57 [-7.62, +0.48]. So on Sol, no gstack missed 3.57 points fewer needed asks than gstack today, with an interval that just includes zero.
- **On particle-1 (descriptive), gstack today held back more needed asks than no gstack.** (b) minus (a): must-ask misses +7.38 [+2.14, +12.62], while on needless sends it is -5.14 [-9.49, -1.28].
- **The ledger's "answered" status is often wrong.** Under ruling K1, a row counts as answered once any owner message follows it. In the 99 audited items the ledger views showed 2,341 answered rows, counting a row once for each item that shows it. Both labellers said the quoted owner message answered the ask in 1,177 of them and both said it didn't in 581. Of Opus's 25 send-time refusals in arm (c), both labellers had said the row was not answered in 19 (answered 5, not judged 1). For Sol it was 24 of 39 (answered 11, not judged 4).
- **The October labels failed the audit** (see The label audit), so the primary readout leaves out the 44 items the two labellers classed differently.

## The decision, read against the frozen table

Section 1 of the prereg froze this table word for word:

> - If the ledger arm cuts needless asks without missing must-asks, the ledger gets built in gstack and the prose rule is trimmed.
> - If gstack today matches the ledger, the ledger is dropped.
> - If the no-gstack arm does as well as both, the quiet and ask rules become a cut candidate, which Garry hears plainly (R48).

Its operational reading, frozen with it, decides each row from the paired intervals on Opus 5.5 and Sol. score printed row **fix-method**: build false, trim null (not read), drop false, cut candidate false, why-null false. Per model: Opus readable, cut, guard fail; Sol readable, cut, guard pass.

- **Row 1, build, didn't fire.** The cut half holds on both models: each (c) minus (b) needless interval lies wholly below zero, and so does its leave-one-thread-out range. The guard half needs the (c) minus (b) must-ask upper end below +5 on both models. Sol's is -0.71; Opus's is +9.29. The ledger arm cut needless asks but missed must-asks on Opus, so the table's first line doesn't apply, and the trim half isn't read.
- **The row that fired is "cut with a failed guard."** Its frozen text: "a cut on a frontier model with the guard failing on either. This is FIX-METHOD on the gate rule, not a Why-null cycle, and the ledger isn't built as is." So gstack doesn't build the ledger as tested, and gstack's ask prose stays.
- **Row 2, drop, didn't fire.** It needs no cut on either model; both models cut.
- **Row 3, cut candidate, read on its own, didn't fire.** It needs, on both models, the (a) minus (b) and (a) minus (c) needless upper ends below +10 and (a)'s must-ask guard passing against both. On Opus the (a) minus (c) needless upper end is +15.49. On Sol both needless upper ends pass (+2.04 and +6.86), but the (a) minus (c) must-ask upper end is +5.00, which isn't below +5. There is no cut candidate to report.
- **The row isn't label-sensitive.** score gives fix-method under the October audit's labels, Opus's labels and Astra's labels, each on all 346 items.

## Result

### Opus 5.5, paired by item

Percentage points. Each cell gives the estimate, its 95% interval and its leave-one-thread-out range. Primary coding, on the 302 items both labellers classed the same way. The reversed pairs mirror each other.

| Comparison | Needless sends (162 items, 98 clusters) | Must-ask misses (140 items, 140 clusters) | Duplicates (132 items, 75 clusters) |
|---|---|---|---|
| (c) minus (b) | -6.79 [-10.22, -4.03]; -8.94 to -5.47 | +4.76 [+0.48, +9.29]; +3.86 to +5.88 | -6.31 [-10.32, -3.27]; -8.50 to -4.49 |
| (d) minus (c) | +1.65 [-0.25, +3.78]; +0.75 to +2.71 | -1.67 [-5.95, +2.62]; -3.03 to +0.65 | +0.51 [-1.42, +2.47]; 0.00 to +1.36 |
| (a) minus (b) | +3.91 [+0.72, +7.57]; +2.68 to +5.22 | -1.43 [-6.43, +3.57]; -2.20 to -0.33 | +2.53 [-0.72, +6.29]; +1.17 to +3.85 |
| (a) minus (c) | +10.70 [+6.81, +15.49]; +9.26 to +13.82 | -6.19 [-11.19, -1.43]; -6.83 to -5.35 | +8.84 [+4.86, +13.89]; +7.69 to +11.56 |
| (c) minus (a) | -10.70 [-15.49, -6.81]; -13.82 to -9.26 | +6.19 [+1.43, +11.19]; +5.35 to +6.83 | -8.84 [-13.89, -4.86]; -11.56 to -7.69 |
| (b) minus (a) | -3.91 [-7.57, -0.72]; -5.22 to -2.68 | +1.43 [-3.57, +6.43]; +0.33 to +2.20 | -2.53 [-6.29, +0.72]; -3.85 to -1.17 |
| (d) minus (a) | -9.05 [-13.38, -5.49]; -11.11 to -7.64 | +4.52 [-0.24, +9.29]; +3.03 to +6.86 | -8.33 [-13.33, -4.39]; -10.20 to -7.02 |

### GPT-6.1 Sol, paired by item

Same layout. Sol's one MISSING sample, in arm (c), counts against the treatment arm in each comparison (rule B1), so the reversed pairs that involve (c) differ slightly.

| Comparison | Needless sends (162 items, 98 clusters) | Must-ask misses (140 items, 140 clusters) | Duplicates (132 items, 75 clusters) |
|---|---|---|---|
| (c) minus (b) | -4.32 [-7.33, -1.95]; -5.22 to -3.52 | -3.81 [-6.90, -0.71]; -4.13 to -1.63 | -3.03 [-5.43, -1.03]; -3.85 to -1.90 |
| (d) minus (c) | -1.85 [-3.73, -0.44]; -2.03 to -1.39 | -3.57 [-8.33, +1.19]; -4.96 to -2.49 | -2.27 [-4.68, -0.61]; -2.56 to -1.71 |
| (a) minus (b) | -0.41 [-3.59, +2.04]; -1.05 to +0.24 | -3.57 [-7.62, +0.48]; -4.68 to -2.49 | +0.51 [-2.80, +3.05]; -0.68 to +1.46 |
| (a) minus (c) | +4.12 [+1.58, +6.86]; +2.98 to +5.01 | +0.24 [-4.52, +5.00]; -2.94 to +1.57 | +3.79 [+1.02, +6.67]; +2.72 to +4.56 |
| (c) minus (a) | -3.91 [-6.49, -1.50]; -4.76 to -2.71 | -0.24 [-5.00, +4.52]; -1.57 to +2.94 | -3.54 [-6.14, -0.94]; -4.27 to -2.38 |
| (b) minus (a) | +0.41 [-2.04, +3.59]; -0.24 to +1.05 | +3.57 [-0.48, +7.62]; +2.49 to +4.68 | -0.51 [-3.05, +2.80]; -1.46 to +0.68 |
| (d) minus (a) | -5.97 [-8.90, -3.36]; -6.77 to -4.88 | -3.81 [-8.57, +0.71]; -4.72 to -0.33 | -6.06 [-9.25, -3.23]; -7.05 to -5.10 |

### particle-1, descriptive only

particle-1 ran arms (a) to (c). It never decides a row.

| Comparison | Needless sends (162 items, 98 clusters) | Must-ask misses (140 items, 140 clusters) | Duplicates (132 items, 75 clusters) |
|---|---|---|---|
| (c) minus (b) | -5.14 [-7.95, -2.46]; -6.08 to -4.34 | +1.67 [-2.38, +5.71]; -1.57 to +4.25 | -6.06 [-8.93, -3.47]; -6.97 to -4.76 |
| (a) minus (b) | +5.14 [+1.28, +9.49]; +3.52 to +5.76 | -7.38 [-12.62, -2.14]; -8.49 to -6.06 | +3.28 [-0.92, +8.18]; +2.04 to +3.94 |
| (a) minus (c) | +10.29 [+6.54, +14.81]; +7.86 to +11.28 | -9.05 [-14.05, -4.05]; -12.42 to -6.92 | +9.34 [+5.29, +14.38]; +6.80 to +10.91 |
| (c) minus (a) | -10.29 [-14.81, -6.54]; -11.28 to -7.86 | +9.05 [+4.05, +14.05]; +6.92 to +12.42 | -9.34 [-14.38, -5.29]; -10.91 to -6.80 |
| (b) minus (a) | -5.14 [-9.49, -1.28]; -5.76 to -3.52 | +7.38 [+2.14, +12.62]; +6.06 to +8.49 | -3.28 [-8.18, +0.92]; -3.94 to -2.04 |

### Power, ceiling and rates per arm

- **Detectable differences frozen in advance** (80% power, two-sided 5%): needless sends 8.3 points on items and 11.0 on the proxy chains (80 effective clusters, the worst case), duplicates 12.3 points (63 clusters), must-ask interval half-width 3.4 points (206 single-item clusters). The pilot projected 12.61 points for Opus and 7.98 for Sol at k = 3. The run had more needless clusters than the proxy planned (98 against 80) and more duplicate clusters (75 against 63), ran at k = 3, and detected needless cuts of 6.79 and 4.32 points, both below the frozen 8.3. The must-ask side had fewer items than planned (140 agreed must-asks against 206), and Opus's must-ask interval is wider than the planned half-width (about 4.4 points against 3.4).
- **Ceiling, arm (b)'s needless send rate:** Opus 26.3% (128 of 486 samples, 95% interval 22.5% to 30.5%), Sol 17.9% (87 of 486, 14.6% to 21.6%). Both models had room to cut. particle-1's was 20.4% (99 of 486).

Raw rates per arm, MISSING excluded (samples, k = 3):

| Model | Arm | Needless sends | Must-ask misses |
|---|---|---|---|
| Opus 5.5 | (a) no gstack | 147 of 486 (30.2%) | 150 of 420 (35.7%) |
| Opus 5.5 | (b) gstack today | 128 of 486 (26.3%) | 156 of 420 (37.1%) |
| Opus 5.5 | (c) gstack plus ledger | 95 of 486 (19.5%) | 176 of 420 (41.9%) |
| Opus 5.5 | (d) ledger alone | 103 of 486 (21.2%) | 169 of 420 (40.2%) |
| GPT-6.1 Sol | (a) no gstack | 85 of 486 (17.5%) | 213 of 420 (50.7%) |
| GPT-6.1 Sol | (b) gstack today | 87 of 486 (17.9%) | 228 of 420 (54.3%) |
| GPT-6.1 Sol | (c) gstack plus ledger | 65 of 485 (13.4%) | 212 of 420 (50.5%) |
| GPT-6.1 Sol | (d) ledger alone | 56 of 486 (11.5%) | 197 of 420 (46.9%) |
| particle-1 | (a) no gstack | 124 of 486 (25.5%) | 195 of 420 (46.4%) |
| particle-1 | (b) gstack today | 99 of 486 (20.4%) | 226 of 420 (53.8%) |
| particle-1 | (c) gstack plus ledger | 74 of 486 (15.2%) | 233 of 420 (55.5%) |

### Secondary coding and sensitivity reads

These are labelled reads beside the primary. None of them decides a row.

- **Secondary coding (F8):** FOLD counts as an ask on answered duplicates and on permission and observable items, and only DROP counts as a must-ask miss. (c) minus (b): Opus needless -7.00 [-11.42, -2.93], must-ask +1.19 [-1.67, +4.29]; Sol needless -8.02 [-12.26, -4.17], must-ask +1.19 [-0.71, +3.10]. So about three quarters of Opus's extra must-ask misses under the primary coding (3.57 of 4.76 points) are FOLDs, not DROPs.
- **Single-decision asks** (130 of the 140 must-asks), (c) minus (b) must-ask misses: Opus +5.13 [+0.77, +9.74], Sol -3.08 [-6.41, 0.00].
- **Asks before October 15** (26 needless and 7 must-ask items, too few for a leave-one-thread-out range), (c) minus (b): Opus needless -11.54 [-44.44, -4.35], must-ask +14.29 [-28.57, +57.14]; Sol 0.00 [0.00, 0.00] and 0.00 [-28.57, +28.57]. Too few to read.
- **Duplicates whose repeated ask lies inside the item's window** (96 items), (c) minus (b): Opus -6.60 [-11.69, -2.75], Sol -2.08 [-4.69, 0.00].

### S1, an automatic word-overlap filter (secondary readout)

The prereg's S1 matcher (the office-hours lane's repeat rule: at least two shared content words with an earlier ask) costs nothing to run. Before the pilot, on the 346 original drafts under the October labels, it matched 117 of 206 decisions, 72 of 121 duplicates, 1 of 11 permission asks and 3 of 8 observable asks. score ran it again under the agreed labels: 83 of 140 decisions, 76 of 132 duplicates, 8 of 26 permission asks and 1 of 4 observable asks. On arm (b)'s sends it would have folded 55 of Opus's 128 needless sends and 154 of its 264 must-ask sends; for Sol 31 of 87 and 111 of 192; for particle-1 43 of 99 and 113 of 194. In every view it catches more than half of the must-asks, so a text-match filter is unusable as a send gate, as the prereg read before the pilot.

### Chains and links

Opus linked the 121 duplicates the October labels named to the earlier asks they repeat (98 links). Astra's audit labels agree with Opus's links on 36 of the 40 audited duplicates (0.90). On the 302 agreed items the chains form 212 clusters, with 44 chains holding 134 items. The largest chain's share of each thread's scored items, must-asks included: T1 0.50, T2 0.06, T3 0.05, T4 0.21, T5 0.17, T6 0.08, T7 0.18, T8 0.25.

## Why not built? The R48 questions

The frozen table makes this row FIX-METHOD directly, "not a Why-null cycle", and score printed why-null false. We still answer the four R48 questions once, because the ledger doesn't ship as tested. The answers can't move the row.

- **Exposure: did the models use the ledger?** Yes. The replay shows the ledger view in every arm (c) and (d) prompt, so it was in view every time by construction. Opus named an earlier row in 393 of 906 arm (c) samples (43.4%) and 406 of 906 in arm (d) (44.8%); Sol in 423 of 905 (46.7%) and 470 of 906 (51.9%). The rest said the ask was new, which is the right answer for most must-asks. Opus gave a reason to re-ask in 215 arm (c) samples and Sol in 108. Without the ledger, in arm (b), Opus's reasons cited an earlier ask in 309 of 906 samples (34.1%) and Sol's in 407 of 906 (44.9%), by the frozen phrase list.
- **Task fit: do the items test what the ledger does?** The replay tests the moment before an ask goes out, which is where the ledger acts. Two parts fit worse than planned. The ledger's "answered" status, ruling K1, marks a row answered whenever any owner message follows it, and both labellers judged 581 of 2,341 such rows unanswered. And the October labels failed their audit. The decision came out the same under all three label sets, so the labels didn't decide it.
- **Power and ceiling.** The frozen detectable differences were 8.3 points on items, 11.0 on proxy chains and 12.3 for duplicates. The run detected cuts below them on both models. The guard failure isn't a power artefact: Opus's must-ask interval (+0.48 to +9.29) excludes zero. Arm (b)'s needless rate, 26.3% on Opus and 17.9% on Sol, left room to cut.
- **Frontier unaided: does a frontier model already do this without gstack?** No. No gstack sends more needless asks than gstack plus the ledger on both models ((a) minus (c): Opus +10.70 [+6.81, +15.49], Sol +4.12 [+1.58, +6.86]), and more than gstack today on Opus (+3.91 [+0.72, +7.57]). On Sol it matches gstack today ((a) minus (b) -0.41 [-3.59, +2.04]). On Opus it does miss fewer needed asks than gstack plus the ledger (-6.19 [-11.19, -1.43]).
- **Verdict: FIX-METHOD.** Not KEEP, because the ledger isn't built and there is nothing to keep. Not CUT-CANDIDATE, because row 3 didn't fire on either model.

**What the fix would have to change.** A fixed ledger would have to do two things before it earns another run, and a rerun needs its own preregistration with the same 10-point and 5-point margins.

1. Mark a row answered only when the owner's reply answers that ask. K1's rule (any later owner message answers every open ask before it) let the send-time check refuse asks against rows both labellers said were never answered, in 19 of Opus's 25 refusals and 24 of Sol's 39.
2. Stop Opus holding back genuine decisions once it sees open asks. Under the secondary coding Opus's extra misses shrink to +1.19 [-1.67, +4.29], so most of them are FOLDs: Opus moved a needed ask into the next digest's waiting line. The send-time check changed only 31 of Opus's 906 arm (c) actions (25 refusals and 6 folds), but score doesn't split those by class, so we can't yet say how many of the extra misses the check caused and how many Opus chose. A rerun should have score report both by class.

## The label audit

- **The audit (I3).** 99 items drawn at random within class: 40 decisions, 40 duplicates, all 11 permission asks and all 8 observable asks. Opus 5.5 and GPT-6 Astra each labelled every item blind to the October labels and to every arm output, with the full item, the owner's next reply and the frozen codebook. The October labels came from two classifier passes on Opus 5.5 that read 500-character tails and the reply kind, without the thread history (prereg section 7).
- **Kappa missed the bar.** Against the October labels, needed against needless (pooled) and then duplicate against must-ask alone: Opus 0.4884 and 0.65, Astra 0.5505 and 0.725. The audit stands only when each labeller reaches 0.6 on both; neither pooled value did.
- **Where they moved.** Of the 40 October decisions, Opus kept 26 and Astra 27 as decisions. Of the 40 duplicates, Opus kept 33 and Astra 37. Both moved 5 of the 8 observable asks to decisions. Of the 11 permission asks, Opus kept 8 and Astra 7.
- **The pattern.** The two labellers agree with each other on needed against needless on 90 of 99 items, and with the October labels on 75 (Opus) and 78 (Astra). On 18 items both gave the same reading against the October label: 11 October decisions both read as needless, and 7 October needless asks (5 observable, 2 duplicates) both read as decisions. Our reading is that the October labels are the weak side, since they were made from short tails and the labellers saw the whole thread. That is a reading of the pattern, not a measured fact: no person relabelled anything.
- **Answered rows.** Each labeller also said whether the owner message the ledger quotes really answered each row it marks answered. Over the 2,341 such rows in the audited items, their answers (yes, no or unclear) matched on 84.9%; both said yes on 1,177 and both said no on 581.
- **The frozen contingency (I4).** The rule then called for both labellers on the other 247 items, with their agreement as the primary label. They gave the same class on 302 of 346 items: 162 needless and 140 must-ask. The 44 others leave the primary readout and appear under each labeller's labels.
- **The decision didn't depend on it.** score gives fix-method under the October audit's labels, Opus's labels and Astra's labels.

## Run health

- **MISSING:** Opus 0 of 4,152 samples; Sol 1 of 4,152 (arm (c), 1 of 1,038, 0.10%: a reply cut at the 4,000-token output cap that stayed unparsable after its one retry); particle-1 0 of 3,114. In the 302-item readout, Sol's arm (c) has 1 of 906 (0.11%) and every other cell has 0. No cell came near the 3% ceiling.
- **Retries:** Opus 0. Sol 22 unparsable replies got the frozen one retry (20 in arm (c), 2 in arm (d)), so 4,174 calls for 4,152 samples. particle-1 21 upstream attempts got the frozen retries (20 HTTP 429 rate limits and 1 unreadable HTTP 200), all recovered, so 3,135 calls for 3,114 samples. The smoke, the pilot, the label audit, the contingency and the linking had 0. No resume redraws, and no end-of-run UPSTREAM pass was needed. The run log counts 23 Sol retries (21 in arm (c)) and 4,175 calls; the ledger and the proxy journals hold 22 and 4,174, because the call log holds one retry line twice. This post uses the ledger's counts.
- **Safety-filter stops:** 0 on every spend item and model, labellers included.
- **Replies at the output cap:** 0 of 220 in the smoke; 1 in the main run (the Sol sample above).
- **particle-1's data-collection deny:** every one of the smoke's 60 calls carried provider routing to particle-ai only, with no fallbacks and data collection denied, and all 60 returned HTTP 200 from a particle provider. The main run used the same route on all 3,135 calls, and no E_ASK_PROCESSOR fired. The request settings and replies are logged in custody as evidence, so particle-1 counts as tested on real items.
- **Leases and custody:** 17 leases, each opened and settled once; 1 unknown charge (an I8 HTTP 200 whose usage couldn't be read, charged at its full reservation). Every custody opening closed with its /dev/shm directory gone (`test ! -e`), with 0 incidents.

## Setup

- **Question (frozen):** on the same models, items and harness, does gstack plus the idea 1 ledger send fewer needless asks than gstack today, without holding back more needed asks?
- **Items:** 346 real asks from 8 coordinating threads, sent 2026-10-09 to 2026-10-29, each rebuilt as the moment before the ask went out (prereg section 2). Scored on the 302 items with agreed labels.
- **Models:** Claude Opus 5.5 (Anthropic Messages, `claude-opus-5-5`) and GPT-6.1 Sol (OpenAI Responses, `gpt-6.1-sol`, not stored) on all four arms; particle-1 (OpenRouter, `particle-ai/particle-1`, data collection denied) on arms (a) to (c). Medium reasoning, the provider's default temperature and a 4,000-token output cap. Labellers: Opus 5.5 and GPT-6 Astra at medium reasoning.
- **Replicates:** k = 3 per item, arm and model, set by the pilot rule (Opus's projected detectable difference at k = 2 was 13.39 points, above 12).
- **Pilot (I2):** 40 items, arm (a) at k = 1 and arm (b) at k = 2. Admitted on Opus (5.5 of 24 needless sends, 6.5 of 16 must-ask misses). Sol didn't admit on its own (2 of 24 sends); the rule needs one frontier model.
- **Statistics:** paired by item; 95% intervals from 10,000 bootstrap resamples over decision chains within thread (seed 1992076652); a leave-one-thread-out range for each estimate; arm order seed 1647197898.
- **Code:** the counted runs ran from this branch at commit d2eccae0683820774c60fb5c9fbccfc89966ea1e, with gstack read from a clone at 0326b144. Runs and scoring on 2026-11-15.

## Deviations from the preregistration

These are all of them.

1. **Five passages of the prereg became incomplete.** The guard fixes in item 2 left five passages of the prereg post incomplete, and the post stays unedited. Section 7's rule bullet: score now also withholds the decision rows when fewer than 40 audit items carry both labels, when a failed audit's complete contingency pairs no labels, when a started link run has unsealed labels, and when the main run's k isn't the pilot readout's k. Section 10's admission bullet: `pilot` prints the admission and k only when every pilot sample it schedules on Opus and Sol is present, and otherwise exits with E_ASK_INCOMPLETE. Section 13's E_ASK_INCOMPLETE row names only score; pilot now raises it too, and score also raises it for a k mismatch, a missing pilot or a partial link run. Section 13's absent-samples paragraph: score now also checks each reply's k against the pilot readout. Section 16's item 6, the list of additions the plan didn't name, should now include score's `--pilot-items` and `--pilot-replies`.
2. **Guard fixes landed on this branch before any paid call.** Commit d2eccae made `pilot` refuse an incomplete pilot; kept a resumed attempt's spent retries, so no draw sends more than the frozen calls; made `score --draws` with anything but the frozen 10,000 print no decision; added the label and link checks in item 1; made a processor fault stop every running cell; and made score check the main run's k against the pilot readout. Each fix only refuses or checks more and has a test in both directions. The dry run regenerated byte-identical (24 PASS, 0 FAIL), and frozen.json, the synthetic set, the codebook and the gstack pins didn't change.
3. **The shared metering proxy changed.** In src/runner/proxy/metering-proxy.ts, a client timeout now cancels the upstream provider call. The cancelled call keeps its charge (it settles as unknown, at its reservation) and isn't resent, so the driver's 5-minute timeout no longer buys a slow call twice. The proxy is shared, so every lane that uses it gets this change when this pull request merges.
4. **Two caps were raised before their leases.** I5's cap went up because the central price undercounted the tokens Opus's tokenizer counts for the same text, and the projection from the label audit's measured cost per call passed the cap (ruling B1). I8's cap went up because particle-1's projection at k = 3 without cache hits passed its cap; with cache hits it fit (ruling C1). The Captain ruled both before the leases opened, and the ledger records both with those words. I5 spent 86% of its raised cap and I8 40%. Amounts are in Agent notes.
5. **I4 ran under the frozen rule, after a stop.** When the label audit missed kappa 0.6, the run stopped before any further paid call, as its run brief required, and resumed after the Captain ruled to run the frozen contingency (ruling A1). The rule didn't change. I4's and I2r's caps hadn't been recorded at setup; I4's was recorded with the ruling, and I2r never opened.
6. **Ledger admission ran in warn mode on every lease, the same as the dry run.** No rig admission record was written for this run, so each lease carries a RIG_UNPROVEN warning instead of a refusal. Every lease still had a recorded cap and settled once.
7. **Two Capy worker restarts stopped the wrapping program, not the shards.** About 36 minutes into I6's first shard, and near the end of I7's first shard, a restart of the Capy worker stopped the program wrapping the shard. Each shard process kept running in the foreground, stopped at its 50-minute launch stop and closed its custody opening cleanly. Each second shard resumed in the same directory, skipped the sealed samples and redrew nothing. The prereg's custody choice (section 16, deviation 1) assumed a live program for the whole shard; for those minutes each shard ran without one.
8. **Operator glue outside the repo.** The custody openings around the draws, the pilot readout, the label readout, the class counts, the contingency shards, prompt sizing, the label cost projection and score ran through ops.ts, a script kept outside the repo that only composes the lane's own functions. It ran once and is attached verbatim (see Record).

## Limits and threats

- A single-decision replay is cleaner than a live thread: the history is laid out, nothing is compacted, and the agent isn't juggling work. The ledger was in view every time; a live roll-out should log how often agents read it.
- The draft framing tests the moment before an ask goes out. It doesn't test whether an agent would have drafted the ask at all.
- Arm (a) holds the owner's own standing rules, several of which are ask rules, so it is "no gstack prose", not "no ask rules". Every real item mentions gstack in its conversation or rules, because the threads discuss it.
- Labels are model labels audited by models; no person relabelled any item. The primary readout leaves out the 44 items the labellers classed differently, and the answered-row judgements cover only the 99 audited items.
- The primary coding counts FOLD on a must-ask as a miss. Whether moving an ask to the next digest costs the owner anything depends on how soon the digest goes out, which the replay doesn't model.
- 8 threads, 3 weeks and one owner. The leave-one-thread-out ranges show the spread across threads.
- Rule text may carry amendments made after an item's date (prereg section 16, deviation 2).
- The arm (b) exposure count uses a frozen phrase list, so it can miss a reason that cites an earlier ask in other words.
- particle-1 ran three arms and decides nothing.

## Replicate it

1. **Keyless, from a clean clone at this pull request's head:**

   ```bash
   git clone https://github.com/garrytan/gstack-evals && cd gstack-evals
   git checkout <this PR's head>
   bun install --frozen-lockfile
   bin/gstack-evals ask-replay synth      # the committed synthetic set matches its generator byte for byte
   bin/gstack-evals ask-replay dryrun     # 24 PASS, 0 FAIL, as in the prereg's dryrun.txt
   bun test tests/ask-replay/
   ```

   Outsiders can check the harness, the synthetic set and the scoring rules this way, but they can't rerun score on the real items.

2. **The paid stage, in custody.** Each paid shard ran through a small wrapper (shard.sh, not attached) that ran `bin/gstack-evals ask-replay <args> --log <custody>/CUSTODY.md --recipient <age recipient>` with the age identity on stdin and the run's one ledger named in `GSTACK_EVALS_LEDGER` and `GSTACK_EVALS_LEDGER_RECORD`. The wrapper didn't record its argument lists, so the lines below are the lane README's documented forms with the values the run log records; the I4 line is exact, from ops.ts. Paths are placeholders.

   ```bash
   # I1 smoke, once per model, on the 20-item synthetic smoke bundle
   run --spend-item I1 --model opus|sol|particle --k 1 --bundle <smoke>/items.jsonl.age --sums <smoke>/SHA256SUMS --out <run>/i1-<model>
   # I3 schema check, on 3 synthetic items
   label --kind audit --model opus|astra --bundle <synth3>/items.jsonl.age --sums <synth3>/SHA256SUMS --out <run>/i3-check-<model>
   # I2 pilot, on the drawn pilot bundle
   run --spend-item I2 --model opus|sol --pilot --bundle <pilot>/items.jsonl.age --sums <pilot>/SHA256SUMS --out <run>/i2-<model>
   # I3 label audit, on the drawn audit bundle
   label --kind audit --model opus|astra --bundle <audit>/items.jsonl.age --sums <audit>/SHA256SUMS --out <run>/i3-audit-<model>
   # I4 contingency (inside ops.ts contingency <model>, which opens the audit draw)
   label --kind contingency --model opus|astra --bundle <main>/items.jsonl.age --sums <main>/SHA256SUMS --out <run>/i4-<model> --audit-draw <opened audit draw>/items.jsonl
   # I5 duplicate linking
   label --kind link --model opus --bundle <main>/items.jsonl.age --sums <main>/SHA256SUMS --out <run>/i5-link-opus
   # I6, I7, I8 main runs; I6 and I7 ran twice, the second shard resuming the first
   run --spend-item I6 --model opus --k 3 --bundle <main>/items.jsonl.age --sums <main>/SHA256SUMS --out <run>/i6-opus
   run --spend-item I7 --model sol --k 3 --bundle <main>/items.jsonl.age --sums <main>/SHA256SUMS --out <run>/i7-sol
   run --spend-item I8 --model particle --k 3 --bundle <main>/items.jsonl.age --sums <main>/SHA256SUMS --out <run>/i8-particle
   ```

   The operator steps around them are ops.ts commands, run once each with the identity on stdin: `synth-bundle smoke|synth3`, `draw pilot|audit`, `pilot`, `labels`, `confusion`, `contingency opus|astra` and `score`, which runs `ask-replay score --items --replies --pilot-items --pilot-replies --labels` inside one custody opening.

## What is held out, and why

The real items are one owner's private messages, so they stay sealed and no release is planned. Sealed in a private custody drive, age-encrypted with SHA256SUMS: the 346 built items (owner and agent messages, standing rules, drafts), the variant bundle, the pilot and audit draws, every reply, label and link record, and the custody log. This post commits counts and bundle-level digests only:

- the main bundle, plaintext sha256 f49f0973de12d2b1a01c975354c00927f918b5500d113b39bc1efc6cd66ef06c, and the unused variant bundle, cb857f63e2c315fadb4ac4a1c59fb21815ec05825e4070a3f290c430d9dcd325 (both from the prereg);
- the sealed pilot draw, sha256 of its age file 42e7bf60d8e2b38c2ec3c8bae8f2c6177b367c5c8dd0990d3cd89cd32702b745;
- the sealed audit draw, sha256 of its age file 311716f2f200f7278017140d9afa147b64648f33a0dc3104f49c787f72caa360;
- the synthetic smoke bundle (plaintext sha256 starting 879f717c0d53) and the 3-item schema-check bundle (starting b13029b01541), both built from the public synthetic set.

Outsiders can verify the public synthetic set and the code. They can't rerun on the real items.

## Record

Three files beside this post. Together they leave out the custody setup (building, sealing and the key), the shard wrapper, the per-call ledger and journals, which hold item ids, and every reply and label, which stay sealed.

- **ops.ts.txt** is the paid stage's operator glue, the version that ran, byte for byte except one line: its one absolute home path (line 13) is replaced by `<home>`, because the publication check refuses local paths. Its other paths are relative to the home directory and stay as they ran. It holds no keys and no item data: it reads the age recipient, a public key, from a file and the identity from stdin, and prints counts, rates, digests and cost projections. It carries a .txt extension so no tool treats it as repo code.
- **run-log.md** is the run's log with every dollar amount replaced by `$X`; the amounts are in Agent notes. Nothing else changed, so its Sol retry and call counts (23 and 4,175) still carry the double count noted under Run health.
- **score.json** is score's full output at the frozen seed, numbers only. Each chain's name, a thread label plus the position of the chain's first ask in that private thread, is replaced by the thread label and a running number. Nothing else changed.

## Changelog

- 2026-11-15: first version.

## Agent notes

<details>
<summary>Spend, caps, prices, tokens and crew use</summary>

- The project owner approved the eval at about $400 to $800 all-in for paid calls (prereg Agent notes). Paid spend: $695.29 ($695.288836) across 17 leases, all settled, including 1 unknown charge of $0.021657 on I8. No cap stops.

| Item | Central (prereg) | Cap | Projection before the lease | Spent | Calls |
|---|---|---|---|---|---|
| I1 smoke | $8 | $10.80 | none | $2.40 (Opus $1.81, Sol $0.55, particle-1 $0.05) | 220 |
| I2 pilot | $23 | $31.05 | none | $20.12 (Opus $15.02, Sol $5.10) | 240 |
| I3 label audit, with the schema check | $52 | $70.20 | none | $58.72 (Opus $21.84, Astra $36.89) | 204 |
| I4 relabel | $130 | $175.50 | $151.38 | $152.62 (Opus $56.48, Astra $96.14) | 494 |
| I5 duplicate linking | $18 | $24.30, raised to $30.00 | $25.56 | $25.73 | 121 |
| I6 main run, Opus 5.5 | $308 at k = 2 | $415.80 | $317.72 at k = 3 | $322.27 | 4,152 |
| I7 main run, GPT-6.1 Sol | $154 at k = 2 | $207.90 | $106.4 at k = 3 | $108.09 | 4,174 |
| I8 main run, particle-1 | $7 | $9.45, raised to $13.50 | $4.4 with cache hits, $10.0 without | $5.33 ($5.31 settled plus the $0.02 unknown) | 3,135 |
| I2r pilot retry | $24 | not recorded | none | never opened | 0 |

Prices, USD per million tokens, from src/runner/pricing/prices.ts at d2eccae; reasoning is priced as output:

| Model | Input | Cache write | Cache read | Output | Price source and date |
|---|---|---|---|---|---|
| Claude Opus 5.5 | 4 | 5 | 0.20 | 20 | list prices as checked 2026-10-02 to 2026-10-08 |
| GPT-6.1 Sol | 2 | 2.50 | 0.10 | 10 | list prices as checked 2026-10-02 to 2026-10-08; OpenRouter's models API matched them on 2026-11-02 |
| GPT-6 Astra | 10 | 12.50 | 1 | 50 | list prices as checked 2026-10-02 to 2026-10-08 |
| particle-1 | 0.10 | none | 0.003 | 1 | OpenRouter's models API, read 2026-10-30 |

Tokens, summed from the ledger's usage records (Opus reports its reasoning inside output):

| Item and model | Uncached input | Cache write | Cache read | Output | Reasoning |
|---|---|---|---|---|---|
| I1 Opus | 320 | 257,214 | 655,272 | 19,607 | 0 |
| I1 Sol | 5,779 | 162,023 | 448,780 | 4,586 | 3,853 |
| I1 particle-1 | 172,872 | 0 | 412,928 | 3,239 | 23,567 |
| I2 Opus | 480 | 2,724,080 | 2,786,200 | 42,138 | 0 |
| I2 Sol | 360 | 1,898,910 | 1,886,375 | 7,168 | 8,902 |
| I3 Opus | 408 | 3,888,279 | 113,841 | 118,651 | 0 |
| I3 Astra | 306 | 2,758,397 | 0 | 27,940 | 20,121 |
| I4 Opus | 988 | 10,053,189 | 298,989 | 307,331 | 0 |
| I4 Astra | 1,761 | 7,161,094 | 0 | 76,870 | 55,311 |
| I5 Opus | 484 | 4,591,400 | 141,363 | 137,075 | 0 |
| I6 Opus | 16,608 | 52,103,062 | 141,775,052 | 1,666,630 | 0 |
| I7 Sol | 25,377 | 36,388,295 | 98,098,348 | 370,500 | 355,402 |
| I8 particle-1 | 31,089,557 | 0 | 76,016,128 | 191,506 | 1,781,926 |

- Measured cost per call. Pilot, Opus: $0.1771 (arm a, replicate 1), $0.1807 (arm b, replicate 1) and $0.0177 (arm b, replicate 2, whole prompt from cache); Sol: $0.0611, $0.0614 and $0.0049. Labels, Opus: $0.2193 (I3), $0.2286 (I4) and $0.2126 (I5); Astra: $0.3707 (I3) and $0.3892 (I4).
- Waste, plainly. The label audit cost $58.72 and didn't stand, which set off the $152.62 contingency: $211.34 together, 30% of paid spend, is what the October labels failing cost us. I4 ran 17% over its central, and I5 43% over its central because the central price undercounted Opus's tokenizer. I6 landed 1.4% over its k = 3 projection. The 1 unknown charge cost $0.02. No paid call ran twice: 0 resume redraws.
- Crew model use: the eval's thread and its subagents stood at 137,373 credits (about $137 at about $1 per 1,000 credits) and 477.6M tokens while this post was written, before this pull request's /ship. The prereg estimated $250 to $330 against a $400 stop.
- This results pull request keeps a merge commit rather than a squash, because its counted runs ran from this branch's commit d2eccae (org R76), so the commit the run record points to stays on main.

</details>

## Disclosures

- gstack is Garry Tan's own project.
- Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.
- Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
