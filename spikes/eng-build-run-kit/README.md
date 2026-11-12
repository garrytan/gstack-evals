# eng-build run kit (step 1 of the build read)

Scripts that ran the build read's first step on the run host: unit specs and base trees from the sealed checkpoint,
the unit build in shards, the frozen recount, and the diagnostics behind the stop record. They ran from a directory
beside the checkout, so TypeScript imports use ../gstack-evals/. Every script prints counts, shapes or digests only.

- specs.ts, review-units.ts, clone.py: unit specs, one-commit base trees, plans and review units.
- strip-trees.ts: the prereg strip rule (CLAUDE.md, CLAUDE.local.md, AGENTS.md, .claude at any depth) applied to base
  trees whose one commit still held a stripped name, each remade from a fresh .git with the same date and message and
  checked with prepareTree.
- shard.py, units-shards.sh, units-resume.sh, units-stop.sh, merge-units.py: the unit build in shards by repository,
  rerun through eb units' own resume path after a gate crash, then merged.
- recount-par.ts, recount-run.sh: the frozen recount (recountUnit unchanged) in parallel workers.
- drop-table.py: first drop per unit, by set.
- diag-func.py, diag-grade.ts, diag-go.sh, diag-all.sh, diag-open.py: one verifier run of a dropped unit's functional
  set on its merged tree, with masked messages.
- needles-both.ts: the leak needles before and after the git grep -f change, on a synthetic repository.
- boot.sh: run host boot.
