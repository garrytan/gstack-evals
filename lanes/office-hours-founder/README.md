# Office-hours founder eval

This lane measures whether gstack's office-hours skill helps a model reach the first move a startup founder's own
evidence supports. Each unit is an invented founder: an opening message, a sheet of facts the founder reveals only when
asked, and an answer key. A simulated founder (Gemini 4 Argon) plays the founder, and three arms talk to it on Claude
Code: none (a plain prompt), lens (one line naming the skill's idea) and office-hours (gstack's skill at a pinned
commit). Each session ends with a short first-move block, and blind judges score it against the key.

The design, its rules and its stops are in the preregistration,
[wiki/plans/2026-11-09-geva-418-office-hours-founder-evidence-prereg](../../wiki/plans/2026-11-09-geva-418-office-hours-founder-evidence-prereg/README.md).
This folder is the build that preregistration describes. Every paid run pins one commit of it.

## Where things live

| Folder or file | What it holds |
|---|---|
| types.ts, frozen.ts | Shapes shared by every area, and the strings and numbers the preregistration freezes |
| parse.ts, seams.ts | The first-move parser, its one lenient parse and the normalizer, with their dry-run checks |
| sim/ and src/persona-sim/ | The simulated founder and its fidelity audit (the person simulator itself is reusable) |
| author/ | Constructed founders and the real-history stratum: drafting, screens, checks and sets |
| run/ | The arm sessions: manifests, the session loop, containment, rows and the end to end |
| score/ | Label packets, the judges, the exposure detector, the counters and the scorer |
| read/ | The frozen readings for stage 1 and stage 2, the projection and the headline |
| audit.ts | The fidelity audit of the simulated founder and the arm-guess probe, the two judge runs over finished sessions |
| wire.ts, cli.ts | How the areas connect, and the `gstack-evals of` commands |
| dryrun.ts, e2e-score.ts | The keyless dry run, and the scoring half of the end to end |

## Checks that need no keys

- `bin/gstack-evals of dryrun` runs every area's seams, each driving one frozen rule on one side of its edge, then
  opens and settles one ledger lease per item on a temporary ledger. Set `GSTACK_EVALS_DOCKER=1` so the container
  seams run; without Docker they print SKIP, and a SKIP fails the dry run.
- `GSTACK_EVALS_DOCKER=1 bin/gstack-evals of e2e` runs two invented founders through the real path: the trial image,
  the metering proxy container, ledger leases, the session loop with the real simulator code, the parser, the packets,
  the metered judge client and the scorer. A stub model server answers every model call, so nothing is spent. It needs
  the trial image pinned (`bin/gstack-evals doctor --host claude`) and a full gstack clone holding the pinned commit
  under the state directory's sources/.

## Custody

Units, sheets, keys, transcripts and labels stay outside this repository. Every command refuses an output path inside
it, and the repository keeps only counts and digests.
