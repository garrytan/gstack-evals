# Planted-unit eng-review read

The lane for attempt 3 of the plan-eng-review measurement (prereg 2026-11-15-geva-537-eng-review-planted-units-prereg).
Each unit comes from one real merged bug fix that shipped a test, in a permissive public repository: the code just
before the fix, with the bodies of the functions the fix changed stubbed out, packed as a one-commit tree. A plan to
implement those functions is reviewed by plain Opus with no gstack, by autoplan's eng phase, or by the restored
standalone /plan-eng-review. A fixed Opus builder with no gstack then implements the reviewed plan with tests. The
real fix's failing cases (avoid) and the build's own tests run against the real buggy code (catch) grade each build,
with no judge.

The lane reuses the eng-build lane (lanes/eng-build) for recipes, the screen, the unit builder and verifier, the
sandbox sidecar, the review and build launchers, the session image, catch, coverage, leak and containment checks and
the ledger. Changes there keep every existing caller's behavior by default, and lanes/eng-build's tests stay green.

## Layout

- types.ts: the shared types every part codes against, the Command and DryCase seams, and the PlantedGrader seam
  between grading and the build stage.
- frozen.ts: every frozen number, the comparison size as one parameter, and RESTORE_PIN (the gstack commit both
  skill arms run, set when the prereg freezes).
- errors.ts: the lane's refusal, a reason code (E_EP_*) from src/errors/codes.ts and a message.
- cli.ts: `gstack-evals ep`; it merges each part's commands.ts table.
- stock-review.md: the stock control's fixed review, written before any unit was seen.
- construct/: the repository search and seeded draw, the miner with the earliest public date, the region finder, the
  stubber, the root-commit construction, the body and one-commit checks, the planted screen and grading rules, the
  keyless signature note, the supply count and `ep digests`, the content digests custody checks a rebuilt unit
  against.
- stages/: authoring (plan, two-way audit, hint, foreseeability raters, hinted and no-review builds), the three review
  arms at the restore pin, the stock control, the build stage with the reviewed plan mounted, the ledger items and the
  all-in projection stop, the rerun log that plans each owed cell's rerun, and the driven launch.
- readings/: the scores, the pilot's component rule and lines, the content raise, the exposure gate, the start rule,
  the statistics (paired, repository-clustered bootstrap and sign-flip, Holm), the verdicts, the judged secondary and
  its check, and power.py.
- dryrun.ts: `gstack-evals ep dryrun`, every part's keyless cases.
