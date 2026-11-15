# Readings: scores, gates, statistics, verdicts, the judge and power

The readings part of the planted-unit eng-review read (prereg 2026-11-15-geva-537-eng-review-planted-units-prereg,
sections 5 to 11). Everything here is pure computation over the records the stages part writes (PlantedUnit,
ReviewRecord, GradedBuild, JudgedBundle in ../types.ts), plus the judge's model calls, which are injected.

- score.ts: avoid, catch (a dropped transplant scores 0 in the primary and is left out of the sensitivity read), the
  composite or the single component the pilot picks, the functional share, "solved", reach, unit scores with gaps left
  out or scored 0.
- stats.ts: paired differences clustered by repository; the two-stage bootstrap (repositories, then units; 10,000
  draws; the seed passed in) and the two-sided repository sign-flip, both the eng-build lane's `infer`; Holm; the verdict
  words; the length-adjusted line. Every lower or upper bound is that bootstrap's 2.5% or 97.5% quantile.
- gates.ts: the admission pilot's lines (INSTRUMENT, the component rule, FLOOR, CEILING, the split, HEADROOM), the
  content raise (hard units, the projection, the raise's read), the exposure smoke, the interim and final exposure, the
  start rule and short supply.
- verdicts.ts: the verdict precedence (untested, KEEP, helps without KEEP, the other words; no CUT-CANDIDATE path),
  standalone minus eng phase, the stock line, section 11's decision rows and the explicit-invocation clause.
- analysis.ts: the readout behind `ep analyze`.
- judge.ts, prompts/, generic/: the judged secondary's two blind calls, the bundle set, the gold set and check, the stock
  control, the generic-specific lists (30 common edge cases per ecosystem, written before any unit) and the section map.
- power.py, power.txt: the MDD simulation of section 10 and its output.
- fixtures.ts, dry.ts: synthetic fixtures and the keyless dry-run cases (commands.ts DRY_CASES).

## Commands

Each reads one JSON file. A stop line exits 2 with its E_EP_ code on stderr.

| Command | Input | Stops |
|---|---|---|
| `ep pilot --in <f> [--seed n] [--power-json out]` | `{units, builds, hinted?, raise?: {authored, admitted, unused, perCandidateUsd, perReadUsd}, unforeseeable?, seed?}`; the pilot's units are those with `pilot` set | E_EP_INSTRUMENT, E_EP_FLOOR, E_EP_RAISE (first ceiling, with the projection), E_EP_CEILING (supply short of 40 hard units), E_EP_COMPONENTS_SPLIT |
| `ep raise --in <f>` | `{units, builds, hinted?, hardAdmitted?, seed?}`: the raise's hard units | E_EP_CEILING |
| `ep exposure --in <f> [--reviewer opus]` | `{smoke, reviews?}`, sessions in run order | E_EP_EXPOSURE_GATE, E_EP_EXPOSURE_STOP |
| `ep start --mdd <x>` | the re-printed MDD | E_EP_START_RULE |
| `ep supply --admitted <n>` | admitted comparison units | E_EP_SUPPLY_SHORT |
| `ep analyze --in <f> [--seed n]` | analysis.ts AnalysisInput | none; it prints |
| `ep kappa --in <f> [--revision n]` | `{gold: GoldRow[], bundles?}` | E_EP_JUDGE_CHECK; exit 1 asks for the one rubric revision |
| `ep power [flags]` | power.py's flags | none |

power.py runs keyless with `uv run -q --with numpy==2.5.4 python lanes/eng-planted/readings/power.py` (the frozen
table, about a minute on 4 cores), `--rows 64x3` for one design, `--n 40 --k 3 ...` for one MDD, and `--fit
pilot.json` (written by `ep pilot --power-json`) for the start rule's re-printed MDD.
