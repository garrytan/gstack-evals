# Office-hours rewrite eval: the readings

This folder turns scored sessions into the readings the preregistration freezes
(wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg, sections 7, 8, 9's re-reading note, 10, 11 and 12's
admission list). Every function is pure over ScoredSession rows from ../types.ts, plus small inputs a row does not
carry: admission flags, the cap stop, the judge-check results and G1's hand reads. The one exception is load.ts, which
reads the host files a stage 1 skill session left for A8. Nothing here calls a model or spends.
The only subprocess is the power.py re-read, and its runner is injected, so tests spawn nothing.

## Modules

- stats.ts: the two intervals. A Student t quantile (Lanczos log gamma, the incomplete beta's continued fraction, and
  bisection), the paired t interval over cluster differences with C - 1 degrees of freedom, and Newcombe's method 10
  with the design effect. Method 10 is lanes/delivery-route/analyze.ts's newcombe(), imported unchanged.
- estimate.ts: section 8's estimator. A brief's difference is the mean over models, where both arms scored, of arm a
  minus arm b; a cluster's is the mean over its briefs that have one; the estimate is the mean over clusters, with the t
  interval. It takes the arm pair, the model set, the metric, the stage, a row filter and the cluster unit, so one
  function gives new minus current, new minus none, current minus none, each model alone, pooled, and the guardrail
  counts. It also returns each arm's level on the same pairs and the count of brief-and-model pairs missing a side.
- builder.ts: section 7. Kept whole on the brief-and-model pairs where both skill arms scored, read by the corrected
  method 10 against the -15 point margin; the builder right call through the estimator, each brief its own cluster.
- guards.ts: G1 to G3 (section 10) and the missing limits (section 8), each held or broken with its numbers.
- admission.ts: A1 to A7 (section 12) and the second attempt's A8 (its pre-run change 3) over stage 1's scored rows,
  stage 1's run rows, A8's reads and four flags, and the one-repair rule (admitted, repair, or FIX-METHOD after a second
  failure).
- load.ts: A8's reader. On Claude Code it reads Claude Code's own session file, which the container's end step copies
  to host/claude-session.jsonl, for the "Base directory for this skill" message and checks its body against
  CLAUDE_BODY's head and tail, around a start-step output that must not be empty (pre-run change 5); on Codex CLI it
  checks the <skill> item in host/transcript.ndjson against CODEX_RENDERED.
- decision.ts: section 10's ordered table. Every row's condition is computed and returned; the first that holds decides.
  Beside the outcome go the two readings: new minus none not shown to beat no gstack by the bar, and current minus none
  wholly below zero.
- report.ts: section 11's lead table (three contrasts, pooled then each model, particle-1 marked descriptive) and R1,
  R2, R3 and R by arm, as data.
- reread.ts: section 9's re-read of power.py at stage 1's observed control rates, at rho 0.5 and 0.843.
- seams.ts: `export const seams: Seam[]`, 74 seams. Both worked examples and section 7's example; all 21 planted cases of
  section 10 (every row reachable, and each case where a lower row also holds names it, so the order is driven); every
  guardrail, missing limit and builder check on a known-good and a known-bad side; every admission condition on both
  sides (A7 twice: session kind and none-arm read; A8 through planted host files on both hosts: a whole body, one cut
  short, a missing copy and an unreadable one, plus a particle-1 arm left out and a session with no read) and the
  one-repair rule. Its fixture builders (row, founderRows, builderRows, sessionRow, stage1Input, plantLoad, PLANTED,
  plant) are exported for tests/ohr/read.

## Pinned to published numbers

- Student's sleep data (R datasets::sleep, paired, group 2 minus group 1): mean 1.58, 0.7001142 to 2.4598858
  (tests/ohr/read/stats.test.ts, to 1e-7). The t quantiles match scipy's t.ppf to 1e-8 at df 1, 9 and 39.
- Altman's example for method 10 (a 14, b 5, c 0, d 22): 0.1220, 0.0115 to 0.2265.
- Section 7's example (both models lose the same brief of 24, every other session kept whole): -0.140 uncorrected and
  -0.202 corrected, which equals 24 independent briefs (power.txt prints -0.1398 and -0.2024; the test checks four places).

## What matches power.py, line by line

- designEffect() is power.py lines 171 to 179 (design_effect): vc is G/(G-1) times the sum over briefs of (the brief's
  summed difference minus its pair count times the mean), squared, over n squared; vs is the summed squared deviation
  over n squared; k is vc/vs when vs is positive and 1 otherwise, clipped to 1 and 2. power.py writes the brief's pair
  count as m because every brief there has both models; here it is the brief's own count, so a brief with one model's
  pair is a cluster of one. With fewer than two briefs vc is undefined, and k takes 2.
- correctedNewcombe() is lines 181 to 183 (builder_interval): the four counts of pair_counts (lines 167 to 169) each
  divided by k, then method 10. The imported newcombe() is lines 138 to 158 (wilson and newcombe) term for term.
- tInterval() is lines 80 to 85 (t_interval): the mean, sd with ddof 1, t(0.975, C - 1).
- Checked by hand on 30 random 24-brief, two-model datasets drawn by numpy: design effect and both bounds agree with
  power.py to 1.6e-15. The section 9 re-read at p0 0.40 and 0.10 reproduces power.txt's MDDs exactly (0.13, 0.18, 0.08,
  0.11 with current as control; 0.09, 0.13, 0.07, 0.10 against none). Its builder pass share at kept-whole 0.90 reads
  0.769 against power.txt's 0.777, because the re-read draws from a fresh generator (choice 13).

## Build-time choices

1. Thresholds compare with power.py's 1e-12 tolerance (its bar test reads m >= BAR - 1e-12), so an estimate of exactly
   0.15 meets the bar and a share of exactly 10% holds. Floating sums should not flip a frozen edge.
2. A session ending missing or contaminated is missing on every metric, whatever its bits hold (section 8's failure
   table). A block with a null R (an unlabelled cell) is missing for R too.
3. The t interval needs two clusters. With fewer, the estimate prints and its interval is null, and no row condition
   that reads that bound can hold. Such a run already fails a missing limit.
4. The missing limits count stage 2 only. A session is missing when its R is; a founder difference is missing when
   either arm's R is, over Opus 5.5 and Sol, new minus current. The scorer hands in one row per manifest entry, so an
   unrun entry is a row with end missing.
5. The cell limit and the contamination limit decide on Opus 5.5 and Sol only. particle-1's cells are reported, because
   section 2 says particle-1 decides nothing. Contamination counts every stage 2 none-arm session of the two models,
   founder and builder.
6. G1 breaks only on Opus 5.5 and Sol sessions; a confirmed particle-1 hit is listed as descriptive. Every detector hit
   needs a hand read and every hand read must name a hit, or the reading refuses.
7. G2 and G3 read pooled over Opus 5.5 and Sol on stage 2 founder briefs, through the estimator (founder clusters). G3's
   threshold is 20% of the current arm's level on the same pairs, weighted as the estimator weighs.
8. A1 and A2 decide on Opus 5.5 and Sol, as section 12 stage 4 runs "three arms and two models, plus particle-1";
   particle-1's cells are reported. A1 refuses a cell without its 8 calibration rows; a missing session counts as not
   exposed.
9. A2's median reads founder sessions that ended other than missing or contaminated.
10. A5's rate is the share of scored current-arm sessions on the 6 calibration founder briefs, Opus 5.5 and Sol pooled
    (12 when none is missing).
11. A6 projects each arm and model at 94 stage 2 sessions (70 founder, 24 builder), each costing stage 1's mean arm
    dollars plus mean simulator dollars plus the measured label cost per session, and checks item 5 (Opus and Sol)
    against $1,620 and item 6 (particle-1) against $139. Host VMs are item 7 and not projected here.
12. A7 reads the run rows: a skill session fails when its printed SESSION_KIND is not interactive. A skill session that
    ended missing before printing anything is listed as never started and does not fail A7, since section 8 scores it
    missing. A none-arm session fails on any gstack read or a contaminated end.
13. The re-read gives every design a fresh generator seeded 20261117, where power.py's grid shares one across rows, so a
    re-read of a grid row can differ by a draw. Observed rates are clipped to 0.01 to 0.99, since power.py's Beta needs a
    rate inside 0 and 1; a founder control rate with no room for a 5-point lift reads "no room". It checks power.py's
    sha256 against the preregistration's front matter before running.
14. The lead table's observed MDD column prints the rho 0.5 figure with the rho 0.843 figure in brackets, as section 9
    prints them; per-model rows take power.py's one-model MDD. The plan MDD column carries section 9's ranges: pooled
    0.12 to 0.13 (new minus current) and 0.08 to 0.13 (against none), one model 0.17 to 0.18 and 0.11 to 0.18.
    particle-1 has none.
15. R1, R2, R3 and R rates are shares of scored sessions, not the estimator's cluster weighting, since they describe an
    arm rather than a paired contrast.
16. Row 6 holds when no row above it does. Its condition also prints as the preregistration words it: the interval
    includes zero and reaches +15.
17. Admission reads once and at most once more after its one repair; a third read refuses.
18. A8 reads every stage 1 skill session that left a transcript. A skill session that ended missing with no transcript
    never reached the model, so it is listed as never started and read for nothing, as A7 lists it. A session with no
    read, or whose copy is missing, unreadable, cut, changed or the other pin's, fails. Claude Code's body is read by
    length from the frozen figure, so an ARGUMENTS line inside the body cannot end it early, and what follows must be
    nothing or a new ARGUMENTS line. A8 decides on Opus 5.5 and Sol; a particle-1 failure leaves that arm out of
    particle-1's stage 2 (stage2_particle_arms names the arms its --arms keeps) and admission holds.

## What other modules must hand in

- The scorer: one ScoredSession per manifest entry for stage 1 and stage 2, with kind, cluster, set and traction equal
  on every row of a brief (the readings refuse otherwise), and kept_whole.startup_only holding the detector's hits.
- The run side: stage 1's SessionRow list, and whether any ledger item stopped on its cap. For A8, each Claude Code
  session's host/claude-session.jsonl beside its transcript, and each Codex session's transcript.
- The judge check: pass or fail per production judge. The simulator audit: pass or fail.
- A person: G1's hand read of every flagged new-arm builder transcript.
