# T1: minimum detectable difference of the false-blocker test (GEVA-76, GST-432)

## Headline

At 2 passes per arm, alpha 0.05 two-sided and 80% power, the false-blocker test detects a drop of about **1.0 false blocker per PR at N = 32 clusters** and **1.15 per PR at N = 26 PRs** (simulated; the normal approximation gives 1.01 and 1.12). That is twice the proposed smallest drop that counts (0.5 per PR). The headline uses share 1.0, the upper-bound proxy, because no GSTA-167 file measures the share of "other CRITICAL" lines a blinded adjudication would rule not-defect. Even the most favourable source (two near-identical stacks, A3668 against L∘G1) gives 0.55 at N = 32 and 0.65 at N = 26, still above 0.5. Under the preregistration's rule, T1 routes every outcome except a recall LOSS on provable blockers to a round 2 paired test.

## Method

1. Arms are read with the lane's own code: `loadSuite` (suite.ts), `snapshot` (ingest.ts), `parseArm`, `mapSeverity` and `matchedBlockers` (contract.ts). Every arm parsed cleanly against its suite digest.
2. The proxy per unit and pass counts findings whose mapped severity is CRITICAL and that judgments.tsv matches to no blocker. Neither suite has an over-blocking blocker and no arm has adjudication.tsv, so the "matched only to an over-blocking blocker" term is 0. The proxy reproduces the GSTA-167 results tables: A3668 86/96 (14pr) and 77/77 (u14), L 96/88, L6 83/79, C6 77/71, C 97/99 (73+24 and 79+20). G1 gives 97/91 against the reported 189, one line apart.
3. Per arm and unit the count is averaged over 2 passes; d_i is variant minus reference per unit. Each unit is its own PR cluster (gstack#3516 appears in both suites at different heads and is kept as two clusters).
4. MDD by simulation: for each N, draw N clusters with replacement from the centered d (d_i minus mean d), multiply by the share, add a shift, and compute the exact two-sided sign-flip p (the same statistic as stats.ts `twoSidedSignFlip`). Power is the share of 2,000 simulated suites with p < 0.05, seed 1 (`seededRandom` from src/runner/stats/paired.ts, reseeded for each N). The MDD is the smallest shift on a 0.05 grid with power at least 0.8. "Drop" shifts toward the variant raising fewer false blockers; "rise" is the other direction.
5. The p is exact at every N, so no Monte Carlo sign flips were needed: values are (share/2)·a_i + c with a_i integers, and one table over (signed sum of a_i, number of + signs) gives the exact null for every share and shift. A built-in self-check matches it to full enumeration and to `twoSidedSignFlip` on 40 random cases (maximum error 0).
6. Normal approximation: 2.80 × share × SD(d) / sqrt(N).

## Arms and pairs

Every arm with 2 passes was used: C, G1, G1old, L, LC and A3668 on gsta167-14pr (14 units), C6, L6 and A3668 on gsta167-u14 (12 units). A2, D and the digest-only folders have 1 pass or no findings.

- **A3668 against L∘G1.** L (14pr) and L6 (u14) are the recorded L∘G1 runs A3668's own preregistration compares against; pooled over 26 units.
- **C against G1.** C has no second 2-pass run on the same units: its two passes are C and its repeat C2. So the C comparison is G1 − C on 14pr. G1 reuses C's specialist and Red Team lines, and 23% of G1's proxy lines appear verbatim in C's same pass, which shrinks SD(d). It understates the spread between independent stacks.
- **L∘G1 against C′ (headline source).** L − C on 14pr plus L6 − C6 on u14, 26 units. These are independent runs of different review architectures that share 0.3% of proxy lines, the closest GSTA-167 analogue to one stack against another.

"Within SD" is the within-arm per-pass SD, SD(pass 1 − pass 2) / sqrt(2) over units. "Pass-noise share" is (within SD V² + within SD R²) / 2 over Var(d); "V FB lines also in R" is the share of the variant's proxy lines whose text appears in the reference's same unit and pass.

| Arm | Units | CRITICAL p1 / p2 | Proxy FB p1 / p2 | FB per unit per pass | SD(p1−p2) | Within-arm per-pass SD |
|---|---|---|---|---|---|---|
| C (14pr) | 14 | 120 / 126 | 97 / 99 | 7 | 4.912 | 3.474 |
| G1 (14pr) | 14 | 125 / 124 | 97 / 91 | 6.714 | 4.502 | 3.183 |
| G1old (14pr) | 14 | 106 / 104 | 84 / 77 | 5.75 | 3.976 | 2.811 |
| L (14pr) | 14 | 126 / 118 | 96 / 88 | 6.571 | 2.793 | 1.975 |
| LC (14pr) | 14 | 121 / 120 | 95 / 96 | 6.821 | 2.615 | 1.849 |
| A3668 (14pr) | 14 | 114 / 121 | 86 / 96 | 6.5 | 2.585 | 1.828 |
| C6 (u14) | 12 | 83 / 80 | 77 / 71 | 6.167 | 2.111 | 1.492 |
| L6 (u14) | 12 | 94 / 85 | 83 / 79 | 6.75 | 1.969 | 1.393 |
| A3668 (u14) | 12 | 85 / 86 | 77 / 77 | 6.417 | 1.477 | 1.044 |

| Pair (V − R) | n | V per PR | R per PR | mean d | SD d | two-sided p | within SD V / R | pass-noise share of Var d | V FB lines also in R |
|---|---|---|---|---|---|---|---|---|---|
| G1 − C (14pr) | 14 | 6.714 | 7 | -0.286 | 1.878 | 0.649 | 3.183 / 3.474 | 3.146 | 0.229 |
| G1old − C (14pr) | 14 | 5.75 | 7 | -1.25 | 1.899 | 0.029 | 2.811 / 3.474 | 2.769 | 0.267 |
| L − C (14pr) | 14 | 6.571 | 7 | -0.429 | 2.027 | 0.484 | 1.975 / 3.474 | 1.943 | 0 |
| LC − C (14pr) | 14 | 6.821 | 7 | -0.179 | 1.489 | 0.797 | 1.849 / 3.474 | 3.495 | 0.796 |
| A3668 − C (14pr) | 14 | 6.5 | 7 | -0.5 | 2 | 0.407 | 1.828 / 3.474 | 1.926 | 0 |
| G1old − G1 (14pr) | 14 | 5.75 | 6.714 | -0.964 | 0.97 | 0.002 | 2.811 / 3.183 | 9.584 | 1 |
| L − G1 (14pr) | 14 | 6.571 | 6.714 | -0.143 | 1.473 | 0.906 | 1.975 / 3.183 | 3.233 | 0.788 |
| LC − G1 (14pr) | 14 | 6.821 | 6.714 | 0.107 | 2.69 | 0.962 | 1.849 / 3.183 | 0.936 | 0 |
| A3668 − G1 (14pr) | 14 | 6.5 | 6.714 | -0.214 | 1.614 | 0.677 | 1.828 / 3.183 | 2.586 | 0 |
| L − G1old (14pr) | 14 | 6.571 | 5.75 | 0.821 | 1.409 | 0.057 | 1.975 / 2.811 | 2.974 | 0.788 |
| LC − G1old (14pr) | 14 | 6.821 | 5.75 | 1.071 | 2.48 | 0.08 | 1.849 / 2.811 | 0.921 | 0 |
| A3668 − G1old (14pr) | 14 | 6.5 | 5.75 | 0.75 | 1.696 | 0.143 | 1.828 / 2.811 | 1.956 | 0 |
| LC − L (14pr) | 14 | 6.821 | 6.571 | 0.25 | 1.858 | 0.695 | 1.849 / 1.975 | 1.06 | 0.204 |
| A3668 − L (14pr) | 14 | 6.5 | 6.571 | -0.071 | 1.107 | 0.918 | 1.828 / 1.975 | 2.955 | 0.005 |
| A3668 − LC (14pr) | 14 | 6.5 | 6.821 | -0.321 | 2.09 | 0.667 | 1.828 / 1.849 | 0.774 | 0.005 |
| L6 − C6 (u14) | 12 | 6.75 | 6.167 | 0.583 | 1.998 | 0.371 | 1.393 / 1.492 | 0.522 | 0.006 |
| A3668 − C6 (u14) | 12 | 6.417 | 6.167 | 0.25 | 1.994 | 0.723 | 1.044 / 1.492 | 0.417 | 0 |
| A3668 − L6 (u14) | 12 | 6.417 | 6.75 | -0.333 | 1.008 | 0.338 | 1.044 / 1.393 | 1.493 | 0 |
| L∘G1 − C′ (L−C on 14pr, L6−C6 on u14) | 26 | 6.654 | 6.615 | 0.038 | 2.039 | 0.962 | 1.7 / 2.703 | 1.226 | 0.003 |
| A3668 − L∘G1 (A3668−L on 14pr, A3668−L6 on u14) | 26 | 6.462 | 6.654 | -0.192 | 1.05 | 0.415 | 1.511 / 1.7 | 2.348 | 0.003 |
| A3668 − C′ (A3668−C on 14pr, A3668−C6 on u14) | 26 | 6.462 | 6.615 | -0.154 | 1.994 | 0.733 | 1.511 / 2.703 | 1.206 | 0 |

## MDD by N and share

Each cell is MDD drop / MDD rise / normal approximation / power at shift 0 (the test's size under the bootstrap null). Units are false blockers per PR, averaged over 2 passes.

MDD source: L∘G1 − C′ (L−C on 14pr, L6−C6 on u14)

| N | share 1: MDD drop / rise / normal / size at 0 | share 0.5: MDD drop / rise / normal / size at 0 | share 0.25: MDD drop / rise / normal / size at 0 |
|---|---|---|---|
| 20 | 1.3 / 1.4 / 1.277 / 0.046 | 0.65 / 0.7 / 0.638 / 0.046 | 0.35 / 0.35 / 0.319 / 0.046 |
| 22 | 1.25 / 1.3 / 1.217 / 0.051 | 0.65 / 0.65 / 0.609 / 0.051 | 0.35 / 0.35 / 0.304 / 0.051 |
| 24 | 1.2 / 1.25 / 1.166 / 0.051 | 0.6 / 0.65 / 0.583 / 0.051 | 0.3 / 0.35 / 0.291 / 0.051 |
| 26 | 1.15 / 1.2 / 1.12 / 0.053 | 0.6 / 0.6 / 0.56 / 0.053 | 0.3 / 0.3 / 0.28 / 0.053 |
| 28 | 1.1 / 1.15 / 1.079 / 0.049 | 0.55 / 0.6 / 0.54 / 0.049 | 0.3 / 0.3 / 0.27 / 0.049 |
| 30 | 1.05 / 1.1 / 1.042 / 0.048 | 0.55 / 0.55 / 0.521 / 0.048 | 0.3 / 0.3 / 0.261 / 0.048 |
| 32 | 1 / 1.1 / 1.009 / 0.048 | 0.5 / 0.55 / 0.505 / 0.048 | 0.25 / 0.3 / 0.252 / 0.048 |

MDD source: A3668 − L∘G1 (A3668−L on 14pr, A3668−L6 on u14)

| N | share 1: MDD drop / rise / normal / size at 0 | share 0.5: MDD drop / rise / normal / size at 0 | share 0.25: MDD drop / rise / normal / size at 0 |
|---|---|---|---|
| 20 | 0.75 / 0.65 / 0.657 / 0.048 | 0.4 / 0.35 / 0.329 / 0.048 | 0.2 / 0.2 / 0.164 / 0.048 |
| 22 | 0.7 / 0.6 / 0.627 / 0.066 | 0.35 / 0.3 / 0.313 / 0.066 | 0.2 / 0.15 / 0.157 / 0.066 |
| 24 | 0.65 / 0.6 / 0.6 / 0.064 | 0.35 / 0.3 / 0.3 / 0.064 | 0.2 / 0.15 / 0.15 / 0.064 |
| 26 | 0.65 / 0.6 / 0.576 / 0.058 | 0.35 / 0.3 / 0.288 / 0.058 | 0.2 / 0.15 / 0.144 / 0.058 |
| 28 | 0.6 / 0.55 / 0.555 / 0.06 | 0.3 / 0.3 / 0.278 / 0.06 | 0.15 / 0.15 / 0.139 / 0.06 |
| 30 | 0.6 / 0.55 / 0.537 / 0.055 | 0.3 / 0.3 / 0.268 / 0.055 | 0.15 / 0.15 / 0.134 / 0.055 |
| 32 | 0.55 / 0.55 / 0.519 / 0.063 | 0.3 / 0.3 / 0.26 / 0.063 | 0.15 / 0.15 / 0.13 / 0.063 |

MDD source: G1 − C (14pr)

| N | share 1: MDD drop / rise / normal / size at 0 | share 0.5: MDD drop / rise / normal / size at 0 | share 0.25: MDD drop / rise / normal / size at 0 |
|---|---|---|---|
| 20 | 1.15 / 1.35 / 1.176 / 0.055 | 0.6 / 0.7 / 0.588 / 0.055 | 0.3 / 0.35 / 0.294 / 0.055 |
| 22 | 1.1 / 1.25 / 1.121 / 0.055 | 0.55 / 0.65 / 0.561 / 0.055 | 0.3 / 0.35 / 0.28 / 0.055 |
| 24 | 1.05 / 1.2 / 1.073 / 0.053 | 0.55 / 0.6 / 0.537 / 0.053 | 0.3 / 0.3 / 0.268 / 0.053 |
| 26 | 1 / 1.15 / 1.031 / 0.054 | 0.5 / 0.6 / 0.516 / 0.054 | 0.25 / 0.3 / 0.258 / 0.054 |
| 28 | 0.95 / 1.1 / 0.994 / 0.059 | 0.5 / 0.55 / 0.497 / 0.059 | 0.25 / 0.3 / 0.248 / 0.059 |
| 30 | 0.9 / 1.05 / 0.96 / 0.057 | 0.45 / 0.55 / 0.48 / 0.057 | 0.25 / 0.3 / 0.24 / 0.057 |
| 32 | 0.9 / 1 / 0.93 / 0.052 | 0.45 / 0.5 / 0.465 / 0.052 | 0.25 / 0.25 / 0.232 / 0.052 |


## Headline table (drop direction, share 1.0 unless stated)

| Source | SD(d) | N = 26 PRs | N = 32 clusters | Share 0.5 at 26 / 32 | Share 0.25 at 26 / 32 |
|---|---|---|---|---|---|
| L∘G1 − C′, 26 units (headline) | 2.04 | 1.15 | 1.0 | 0.6 / 0.5 | 0.3 / 0.25 |
| A3668 − L∘G1, 26 units | 1.05 | 0.65 | 0.55 | 0.35 / 0.3 | 0.2 / 0.15 |
| G1 − C, 14 units | 1.88 | 1.0 | 0.9 | 0.5 / 0.45 | 0.25 / 0.25 |

## Share of "other CRITICAL" that is not a defect

No GSTA-167 file measures it: no arm has adjudication.tsv, and noloss6-results.md only says many such lines are real defects. Share 1.0 is the honest headline. Scaling d by the share is also optimistic. If adjudication thins each arm's count independently, it adds variance of about share × (1 − share) × 6.6 per PR to Var(d). Under that model the normal-approximation MDD for the headline source is 0.81 at N = 32 and 0.90 at N = 26 for share 0.5, and 0.61 and 0.67 for share 0.25. For A3668 − L∘G1 it is 0.69 / 0.76 (share 0.5) and 0.56 / 0.63 (share 0.25). The truth sits between the scaled and thinned figures, because two arms often flag the same real defect and get the same ruling. Under the thinning model no share brings the MDD to 0.5 at N ≤ 32.

## Limits

- The proxy is an upper bound: it counts real defects that no suite blocker names. Judging was unblinded with labels in view.
- 26 units from two suites and one family of stacks (gstack review variants). Round 1 compares different stacks; a stack that emits far fewer or far more CRITICAL lines would widen d beyond anything a bootstrap of these 26 values can draw.
- The shift is additive. A real drop is more likely proportional to a unit's count, which concentrates the effect on high-count units.
- The within-arm pass-to-pass SD is large and heavy-tailed (C on 14pr: 3.47 per pass), and the noise share exceeds 1 on several 14pr pairs, so it is not a clean variance component. Pass noise is at least half of Var(d) on the independent pairs, so more passes per arm would cut the MDD more than a few extra PRs.
- Monte Carlo error: at 2,000 suites the power SE near 0.8 is about 0.009, so each MDD is good to about one 0.05 grid step. The bootstrap null holds size at 0.046 to 0.066.
- Merging the two gstack#3516 units into one cluster would leave 25 clusters; it does not change the conclusion.

## Files

- `t1-mdd.ts`: the script (keyless, seed 1, reads the drive and the repo, writes t1-results.json and prints the tables).
- `t1-results.json`: every number above, including each pair's d values.
- `t1-out.md`: the script's printed tables.
