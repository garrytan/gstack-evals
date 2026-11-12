# Office-hours founder eval: the frozen readings

This folder turns scored sessions into the readings the preregistration freezes
(wiki/plans/2026-11-09-geva-418-office-hours-founder-evidence-prereg, sections 6 to 13 and 16). It makes no model call
and spends nothing. It reads the shapes in ../types.ts: ScoredSession, StockCredit and ManifestEntry, which the scoring
side produces. The only subprocess is power.py's rerun, and that runner is injected, so tests make none.

## Modules

- stats.ts: the paired machinery. A unit's arm score is the mean of its matched passes; differences pair by unit,
  clustered on the session's unit field (the cluster count is checked against the unit count), with a 95% cluster
  bootstrap and a two-sided cluster sign-flip p (10,000 draws, seed 20261109) from src/runner/stats/paired.ts. Every
  comparison prints its units, both means, the difference, the interval, p and the count of units that got worse, all
  rounded to four places. It also holds the length-adjusted difference.
- stage1.ts: section 10 in its read order. The fidelity audit's result (from the audit module), the twin check (the
  product-value eval's two tests, plus the six-pair floor), the judge check per production judge (both kappas, the gold
  floors and the oracle cap from the product-value judgeScore, plus the near-miss bar), STOCK FAIL, the parse rate, the
  band, and the smoke rules with their repairs and re-smokes. It says which reading ends the eval, which conditions only
  make a model untested, and whether stage 2 may start. It prints the Captain's AN-2 lines: the reference's credit rate
  per item and model, the note that the room edge is close to automatic on Opus and Sol, and the drawing-out against
  deciding split, marked a finding only for particle-1.
- stage2.ts: section 11. The manifest (also for the real stratum and the AN-1 pitch-only cell), coverage per arm and
  model against it, exposure, the interim stop, each contrast with its verdict, the specificity guard, the sensitivity
  and intention-to-treat reads and the length-adjusted line, the reading rule and the framing lines, every section 8
  secondary through the same machinery, the descriptive splits, the real stratum, the arm-guess flag and the pitch-only
  readings with their headline condition. Only sessions on the primary manifest reach a primary number.
- projection.ts: the rerun before stage 2. It re-estimates the control rate, ICC and shuffled-key credit from stage 1,
  reruns power.py at the final size for the W MDD and the guard-rule MDD, and checks the Opus guard-rule MDD against
  0.15. It also sets the allowances after the smoke, admits rounds, and projects money per item with the net-envelope
  cuts. The pitch-only cell has its own runs item and its own labels item.
- headline.ts: section 16's opening bullets, one fixed shape per verdict, with AN-1's condition and the Captain's
  pre-data completion rule (a helps model whose pitch-only cell ended incomplete says the check didn't complete), the
  repairs that ran and the population sentence.
- cli.ts: `export const commands`, the rows the lane's cli.ts merges into its table: `of stage1`, `of projection`,
  `of stage2` and `of headline`, described below. None makes a model call or spends.
- seams.ts: `export const seams: Seam[]`, one seam per side of every start rule 7 edge this area owns, on invented
  fixtures. Its fixture builders are exported for the tests in tests/of/read/.

## What other modules must hand in

- The scoring side: one ScoredSession per manifest entry (the latest attempt), pitch-only and real-stratum sessions
  included; stage 1 and stage 2 StockCredit rows; per production judge, the judge check's gold cells as the
  product-value CheckCell (kind arm for any block a model wrote, stock or oracle for anchors, list the block id), the
  count left unlabelled and the near-miss cells; and the stage 2 gold re-check cells.
- The audit module: the stage's audit result as { pass, no_read, repaired }.
- The run side: the frozen manifests, whether the stage stopped, the arm-guess tally, and repair names exactly as
  stage1.ts's REPAIR spells them.

## Commands

Every data path (units, scored sessions, stock credits, packet maps, labels, manifests, outputs) must sit outside the
repo. Each output file is written once, so a second run needs a new --out. Every error line on stderr starts with its
reason code. The commands print counts, readings and the sha256 of what they wrote, never unit text.

- `of stage1 --units-dir --scored... --stock... --audit --map --labels... --check-map --check-labels... --out
  [--ceiling-attempt]` prints section 10 in read order, which reading ends the eval, which models read untested, the
  AN-2 lines and whether stage 2 may start, and writes stage1.json. --audit is sim/fidelity.ts's stage 1 outcome; --map
  and --labels are stage 1's production packets and labels, and --check-map and --check-labels the judge check's pass.
- `of projection --units-dir --scored... --map --approvals --ceiling --out [--record] [--extra <item>=<usd>]...` prints
  the re-estimate, power.py's MDDs, every ledger item's spend, projection and cap, the cuts, and whether stage 2 may
  start on the projection. It writes projection.json and allowances.json, the file `of run --allowances` reads.
- `of stage2 --units-dir --scored... --stock... --manifest... --stage1 --projection --map... --labels... --audit --out
  [--arm-guess <correct>/<total>]` prints section 11's readings per model and writes stage2.json. --manifest takes the
  frozen manifest.json of every stage 2, pitch-only and real-stratum launch.
- `of headline --stage2 [--next <model>=<what the next attempt changes>]...` prints section 16's bullets.

## Build-time choices

1. Sign flips: paired.ts enumerates every sign pattern when a comparison has 20 units or fewer, and draws 10,000 seeded
   flips above that, so stage 2's 64 units use 10,000 flips. Exact enumeration is what the flips estimate.
2. Each comparison feeds paired.ts one item per unit (its mean over matched passes), so units weigh equally and the
   bootstrap resamples units.
3. The parse rate's denominator is the Opus none sessions that reached an end of their own: block, no block or arm stop.
   A missing session has no reply to parse.
4. The band reads edge a, then b, then c, so a stage where a and b both fail reads CEILING. The room is the reference's
   W minus none's W, each a mean over calibration units, rounded.
5. AN-2's "per item" means the two W items: the reference's credit rate on customer and on wedge, each on units where the
   item is primary, beside its W.
6. The drawing-out against deciding split: drawing out is the reference's W minus none's W, the part hidden evidence
   could fill; deciding is one minus the reference's W, the part the model misses with every fact in hand.
7. Smoke repairs: the forced sentence goes to the model that failed parse or exposure. The limit repair raises the
   limit for every arm and reruns every stage 1 session, so every model re-smokes after it. A missing smoke session
   neither parses nor shows exposure. A re-smoke is read on all three rules.
8. Near-miss accuracy counts an unlabelled cell as wrong. A judge with no near-miss cell fails, since it can't show the
   bar.
9. STOCK FAIL's limit is one unit in eight of the stage's units, rounded down: the calibration units in stage 1 and the
   manifest's units in stage 2. Credits count distinct units per row and production judge.
10. The stage 2 gold re-check reads Cohen's kappa over its labelled cells. With no labelled cell, or chance agreement
    of one, there is no kappa, and the model reads untested (judge).
11. Incomplete needs the run side to say the stage stopped. Unrun entries without a stop count as missing. The interim
    stop stops only its arm, so that arm's unrun Opus cells don't make Opus incomplete.
12. The interim stop and the run order follow the manifest's order, and count only sessions the exposure detector read.
    Exposure's denominator is the same: scheduled office-hours sessions with a detector read.
13. The sensitivity read treats every C1 zero (no block, arm stop) as missing. A judged zero is a score, not a failure.
14. The length-adjusted difference reads unit-passes where both arms wrote a block, and prints its slope too.
15. Untested conditions bind per contrast. Exposure, the interim stop and the smoke drop bind contrasts with the
    office-hours arm; gstack reads bind the none and lens arms; the rest bind every contrast of the model. So lens minus
    none still reads after an office-hours drop.
16. The guard reads in the W interval's direction: the specificity estimate must be above zero that way and, rounded, at
    least half the W difference on the same passes, also rounded.
17. "Carries the gain" wins over "carries part of the gain". The part line prints when lens minus none helps and
    office-hours minus lens fails the bound (an interval that includes zero with an upper bound under +0.05).
18. The reading rule names power when the primary is neither helps nor untested and its upper bound is at least 0.15.
19. Manifest order: the units are shuffled once (seed 20261109); then Opus, Sol and particle-1, each pass in turn,
    rounds of 4 units, arms none, lens and office-hours. Lens cuts apply to the primary and the real stratum, not the
    pitch-only cell. The pitch-only cell runs every arm, one pass, on every model.
20. A cut lens cell leaves its contrast with no unit, so it reads untested with "fewer than two units with a matched
    pass".
21. The real stratum reads W, E and N, office-hours minus none, per model, and W by fame tercile. The opposite-sign
    flag reads Opus only, as section 11 says.
22. The projection re-estimates from each model's stage 1 none sessions on the calibration units: the control rate as a
    mean over units, the ICC by one-way ANOVA, and the shuffled-key credit per session. power.py needs both inside 0 to
    1, so each is clipped to 0.01 to 0.99, and an ICC with no variance to read takes the prereg's planning value 0.5.
23. power.py runs as committed: the rerun keeps its imports, assignments and functions and skips its printed grid, then
    calls mdd() and Part F's guard search (k 0, a fully specific gain) at each model's passes. Each design gets a fresh
    generator seeded 20261109, while power.py's grid shares one across rows, so a rerun of a grid row can differ by a
    step. The default runner is power.py's own header command, uv run --with numpy==2.3.4 python. Run by hand once, 64
    units at 2 passes, control 0.25 and ICC 0.5 gave a W MDD of 0.13, as power.txt prints, and a guard MDD of 0.14.
24. The simulator keeps its frozen allowance after the smoke, since section 13 resets arm allowances only. The lens
    median over Opus's two smoke sessions is their mean.
25. The money projection runs on the eval's ledger items. Stage 2, the real stratum and the pitch-only cell each have
    runs and labels items, and stage 2 and the real stratum each have a simulator item. One label packet covers a model,
    unit and pass. The pitch-only cell has no simulator cost, because the closing message replaces the founder. A
    projection doesn't fit when the line or any item passes its cap. The Captain stop is checked before any cut.
26. Headlines: for untested and not shown, the results writer supplies what the next attempt changes, and the bullet
    refuses without it. Points are the difference times 100. Every bullet ends with the population sentence and names
    the repairs that ran. Bullets sort helps, no measurable difference, hurts, not shown, then untested.
27. The sessions in force: when --scored holds a session twice, the version with more repairs wins, because a repair's
    rerun wrote it. Two versions under the same repairs refuse. Office-hours smoke sessions carrying forced-line or
    limit-30 are the re-smoke round, and the rest are the first round.
28. The judge check's cells: each gold cell of the check pass is found again in the stage 1 production packet that
    holds the same blocks (same model and unit, shuffled-key packets left out), and scored on that model's production
    label. Session blocks are real blocks; oracle blocks are oracle cells; stock rows 1 and 2 are the other anchors.
    Near-miss blocks are scored only on their fixed labels, and stock row 3 is never an anchor, so neither is a gold
    cell. A gold cell with no production label counts as unlabelled.
29. The audit outcome: pass, repair, fix-method and no-read map onto the stage 1 reading, and the simulator repair counts
    as made when the sessions in force carry sim-prompt. In stage 2, void and no-read void the stage.
30. The projection's session costs are stage 1's measured medians. The pitch-only cell is projected at its arm's full
    session median, since a pitch session is a shortened session of the same arm. The label packet cost is the spend on
    of-s1-labels over stage 1's production packets; a stage 2 or real unit-pass is two packets (true key and shuffled
    key), and a pitch unit is one. Spend is each item's committed amount in the ledger record. --extra adds projected
    spend the manifests don't show, such as the stage 2 audit or the gold re-check. --ceiling is the line's ceiling,
    because crew and the reserve aren't ledger items.
31. Stage 2 reads stopped when a stage 2 launch's stops.json beside its manifest lists a stop. Each cell's entries run in
    cellRounds order, the run side's, which the interim stop counts in. The MDD at the effective design reruns power.py
    with projection.json's estimates.
32. The reading commands exit 0 once they write their reading, whatever it says. A reason code the reading carries goes
    to stderr as an information line, and the stdout lines say whether stage 2 may start.
33. The AN-1 completion rule (the Captain's pre-data addition): a model's pitch-only cell is complete when every one of
    its scheduled sessions scored a W and the cell's launch did not stop. A session that never ran, or scored no W, is
    missing. When a helps model's cell is incomplete, its bullet gives the scored count and credits neither the
    drawing-out reading nor the reveals-nothing one.
