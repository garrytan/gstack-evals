# read area: build notes

The read area holds stage 1's and stage 2's readings, the admission read and the projection rerun, each a pure function
the dry run drives on invented fixtures. The integrator merges the rows below into the lane README.

## Files

| File | Holds |
|---|---|
| num.ts | M12's four-decimal rounding (q4) and exact threshold comparisons |
| stats.ts | percentile intervals, a seeded mean bootstrap, the twin re-split, OLS and a cluster bootstrap (copied in part) |
| types.ts | ReadCell and JudgeCheck, the shapes the readings take (kept here, not in the lane's types.ts) |
| seams.ts | PowerRunner (power.py as a process) and ArmStopCounts (the run area's counts), with the real uv runner |
| stage1.ts | arm means from unit means, the twin check, the read order, the tier chain, the k label, the smoke rules, lens parse |
| stage2.ts | unit-paired contrasts on the base app, Holm, the interim stop, rates, judge mapping, the precedence, the reading rule |
| admission.ts | design.json, the power.py wrapper, the projection rerun with the cut order and the $5,000 stop, the re-sizing |
| start.ts | start rules 8 and 9 as code checks |
| prints.ts | PD-1's effect (M14), arm stops that held a block, the renders counts on a supply stop |
| dryrun-cases.ts | the area's dry-run cases |

## Reuse

| Source path | Commit | sha256 | What changed |
|---|---|---|---|
| lanes/aftermath/stats.ts (D) | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 72ca982d012c054b1dbd66546a80bc4a76481b9deb97382139aaca50d1edc9c1 | copied in part to read/stats.ts: percentileInterval, bootstrapMeans, resplitDraws, ols and clusterBootstrap; upperQuantile added; r4, mean, shuffle, derangement, maxMatching, kappa, Spearman and the logistic fit left out (num.ts rounds; match.ts matches) |
| src/runner/stats/paired.ts (M) | 91d76421a9f127167b3694306aa77f2971f7a712 | dbd7aac9e900963491c35ef4b4866eee4d98ea6412ec878303c8cd6b703772e3 | imported, not copied: clusteredPairedDelta (base-app cluster bootstrap, 10,000 draws, and the sign-flip p, exact at 20 or fewer clusters), holmAdjusted, seededRandom |
| src/runner/stats/sign-flip.ts (M) | 91d76421a9f127167b3694306aa77f2971f7a712 | 4acc2e81b190f442f39dc445878420a4d92fd03a876be0020e6bd4e41b9a94fb | not used: it holds the margin-shifted non-inferiority test; the two-sided exact sign flip this eval reads is paired.ts's |
| lanes/devex/score/rules.ts (D) | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 3205cc4a6f0a0c7ec5901dd78e8f3062888ae347fdaeb90092d7ce45d982c7c0 | pattern only, rewritten in stage1.ts and stage2.ts: the smoke decision, the precedence and framing readings follow its shape; its unit-pass join and its optional repository map are replaced by per-arm unit means and a required base-app map (M13) |
| wiki/plans/2026-11-14-geva-527-design-review-constructed-units-prereg/power.py (M) | 91d76421a9f127167b3694306aa77f2971f7a712 | 09636859375fbde79efaffcedb794ebc7699e0d13cf081246da45bb943ae5d3a | run in place, not copied; the wrapper refuses any other bytes |

## Build-time choices (BT)

- **Rounding (M12).** q4 rounds x's decimal expansion at ten places to four decimals, half away from zero, and returns whole ten-thousandths, so thresholds compare as integers. Infinity stays infinite.
- **Statistics computed before rounding.** Room (reference minus none), the budget anchor ratio and k are computed from unrounded values and rounded once at their threshold.
- **Percentiles.** Intervals use paired.ts's index rule (floor(n(1 - level)/2), ceil(n(1 + level)/2) - 1). The twin check's re-split 95th percentile is the value at index ceil(0.95 n) - 1.
- **Seeds.** Every bootstrap and re-split starts its own stream at seed 20261114 with 10,000 draws.
- **Twin test (a)** fails only when the 90% interval is strictly outside -0.10 to 0.10 after rounding; an endpoint at exactly 0.10 is inside. Test (b) fails when the mean absolute difference is strictly above the re-split 95th percentile.
- **The k label.** "2x" inside 1.6 to 2.7 inclusive, else "k <value>" at four decimals, or "k infinite".
- **Arm means.** Each unit's mean over its valued passes (score, or 0 for a no-block or a second arm stop), then the mean over units. D leaves out units whose cells carry no D.
- **Specificity.** Per unit and arm, the mean over valued passes of (value minus the shuffled-key value); a zero cell's shuffled value is 0.
- **Length-adjusted difference.** OLS of the unit difference on the difference in mean list words, its intercept with a base-app cluster bootstrap 95% interval.
- **design.json.** A base app's digest is sha256 of its label; p0 is written at four decimals; items must be 3 to 5 (the frozen key size), stricter than power.py's 1 to 6.
- **power.py output.** The read takes power.py's own pass or fail word on its ADMIT line, which agrees with M12 because the power is a multiple of 1/4000.
- **Smoke cost.** The mean cost of the smoke whose result stands (the re-smoke when one ran) replaces the planning figure.
- **Stage 2 label cost** in the projection is units times the most passes any arm runs on that model, times one packet's measured cost.

## Open for the integrator

Each of these is a reading the frozen text leaves open or a seam choice; none was picked in a way that changes a frozen rule, but some could move a reading, so the Captain may want to confirm them.

1. **What "fits the line" means in the projection rerun.** project() fits when the all-in projection is at most $3,999 and each stage 2 runs item and the stage 3 builds item hold projection plus round reserve within their caps. The prereg says only "fits the line"; the per-item checks are my reading of section 13's reserve rule.
2. **Cut 3.** "Comparison units down to 48" is read as down to the most units that fit, never below 48, not straight to 48. After cut 4, units are not raised back. Which units leave is the caller's choice (the area returns a count).
3. **R48 kinds for incomplete and contamination.** The reading rule says every non-KEEP reading is FIX-METHOD "of the kind its precedence names ... and otherwise task fit". Read literally, incomplete (step 2) and untested (contamination) land on task fit. An incomplete run is arguably not a result at all.
4. **10x order.** A failed or short Astra detail check reads NO READ (judge) before saturation is read; with G above 0.50 and a failed detail check, the eval ends on the instrument, not saturation.
5. **Twin "scored passes".** A pass with a value of 0 (no block, a second arm stop) counts as scored; only missing and incomplete cells drop a pair.
6. **Exposure denominators.** An unread detector counts as not exposed, in the interim stop (over the first 24 sessions) and in untested (exposure) over every stage 2 session of the arm.
7. **k units.** k and its interval read the calibration units that have both a base and a 2x Opus none mean, not the base tier's full 16.
8. **Reason codes outside the E_DC_ set.** A stage 1 refusal under start rule 8 and a power.py with the wrong bytes both throw E_USAGE, since the plan adds only the 18 E_DC_ codes.
9. **No interval at step 5.** A verdict that reaches step 5 with no interval (fewer than two base apps) throws E_USAGE instead of reading.
10. **Secondary contrasts and Holm.** verdict() reads a Primary's holm field. For lens minus none (the framing line) the caller passes the unadjusted p as holm; the prereg names Holm only for the two primaries.
11. **CLI.** cli.ts's read and power rows still say not built yet. Wire power to validateDesign and admissionRead with uvPowerRunner, and read to the stage 1 and stage 2 functions, once the score and run areas supply ReadCell rows.
12. **Shared types.** ReadCell and JudgeCheck live in read/types.ts; move them to the lane's types.ts if the score area produces them.
