# Review units as trials

`gstack-evals review-units` runs the stacks round's review lane (wiki/plans/2026-10-30-geva-59-stacks-round-1-plan,
sections 4 to 9). Each review of one unit by one arm on one model in one pass is a Lane A trial (src/trial/trial.ts), so
it gets the session cache key, resume, receipts and the rig's lease admission. Nothing here calls a model on its own.

## Modules

- unit.ts: unit repositories and unit trees.
- told.ts: the frozen told prompt and its sha256.
- findings.ts: the fixed findings parser and the render to arm contract v1. A finding that says whether it was confirmed gets reader `confirmed` or `unconfirmed`, so an arm's `severity_map.by_reader.unconfirmed` can map unconfirmed findings as informational, as the plan's primary map does for pstack.
- cost.ts: cost.tsv and refusals.tsv from the metering proxy's journal.
- run.ts: runReviewUnits, the run loop on a HostRig.
- cli.ts: the command.

## Unit repositories

A unit repository is built from a full local clone (`--source <owner/repo>=<path>`; a shallow clone is refused):

- git init, then a fetch of the head commit and its ancestry only: no tags, no remote config, no reflog, no FETCH_HEAD,
  then gc --prune=now so only reachable objects stay. The head is checked out on branch `pr-<pr>`.
- The base branch is the repository's default branch (garrytan/gstack main, garrytan/gbrain master; `--base-branch`
  overrides). The local base branch and `refs/remotes/origin/<base>` sit at the merge-base of head and the unit's base,
  and `refs/remotes/origin/HEAD` points at it (T5).
- `.gstack-home/` is in .git/info/exclude, since the trial seeds a gstack state root in the work dir.
- The history check returns every problem: `git rev-list --all` must equal the head's ancestry, no tags, no remotes, no
  reflog, no unreachable objects, exactly the refs written, `git merge-base HEAD` with origin/<base>, <base> and
  origin/HEAD equal to the merge-base, `git diff <base>...HEAD` equal to the unit's diff, and a clean working tree.
  A failure refuses with E_UNIT_REPO.
- The sha256 of each instruction file the repository carries (CLAUDE.md and AGENTS.md at any depth, the .gstack/ tree)
  goes to units.json.

The unit tree is the repository plus its dependencies. The install command (`--install`, default
`bun install --frozen-lockfile`) runs in a builder container on the trial image with egress, at /work/<task id>, the path
the agent sees. The unit's own test command (`--test`, default `bun test`) then runs with --network none on a throwaway
copy. A failure refuses with E_UNIT_IMAGE, and the unit is dropped for every arm alike. The tree is kept by digest
(retainTree) and its dirTreeSha256 is the session key's fixture tree.

## A run

- Task id: `<repo name>-<pr>-<first 8 of head>`. The agent sees only /work/<task id>, seeded with the unit tree.
- Prompt: the told prompt with the arm's command (none no prefix, gstack /review, pstack /pstack:interrogate, tstack
  /sol-loop with "Run one review round and stop before any fix.") and the base branch.
- Session key: the unit tree's digest in fixture_tree, the told template's sha256 in task, the parser's source sha256 in
  verifier. --resume reuses a cell whose key matches and refuses a changed key with E_CACHE_STALE before any spend;
  --repair reruns those cells. --resume also keeps the run id in `<out>/run.json`, so the run still owns its ledger item
  and the install cache entries the crashed run held.
- A round is the next units with every arm for one pass and one model, as many as --parallel holds, and it starts only
  when its worst case at the allowance fits under --spend-cap (CAP_STOP otherwise).
- Outputs: `<out>/arms/<arm>-<model tag>/` per arm and model in arm contract v1 (arm.json, findings/<unit>.jsonl with each
  finding's pass, cost.tsv; no judgments.tsv, so the arm is raw), plus units.json, parses.tsv, refusals.tsv,
  cells.ndjson and progress.json. The model tag is a Claude model's family (opus, haiku), else the model id's last path segment, cut to 17 characters
  plus a 6-character hash once it passes 24. Each run rebuilds <out>/arms from the journal, so no stale arm survives a resume there. The receipts sink is a
  merge copy: it keeps any arm an earlier run of the same out dir wrote.
- Parse outcomes per unit-pass: findings, empty (a real zero), missing (no fenced json block: zero, flagged), malformed
  (flagged, never zero) and incomplete (the session did not complete: never scored as zero). A malformed or incomplete
  unit-pass is a coverage gap: the arm is written with status stopped and coverage_gaps naming each one, so scoring gives
  it no verdict instead of reading the pass as an empty review.
- cost.tsv: an all row and, in a cell with a voice, a voice row per unit-pass, from the proxy journal (meter_source
  proxy-journal). usd comes from spent_micros; a call with an unknown outcome makes its row's usd and tokens
  unavailable. requests, refused and unknown_calls are extra columns; refusals.tsv marks an arm and cell degraded when
  more than 2% of its requests were refused.
- The out dir must outlive the machine (E_RECEIPTS_VOLATILE). With GSTACK_EVALS_EPHEMERAL=1 the receipts are copied to
  GSTACK_EVALS_RECEIPTS, which the run refuses (E_USAGE) when it is the out dir or sits under <out>/arms.

The rig's arm installer takes one target skill for every arm, so one invocation runs arms that share a told skill:
none with gstack, or none with one other stack. `--dry-run` prints the plan and writes nothing.
