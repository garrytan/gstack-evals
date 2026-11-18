# Office-hours rewrite eval

This lane measures whether gstack's rewritten office-hours skill makes the right call more often than the current
skill, without harming builders. Each brief is an invented founder or builder: an opening message, a sheet of facts
the person reveals only when asked, and a key. A simulated person (Gemini 4 Argon) plays the founder, and three arms
talk to it in Claude Code: none (a plain first message), current (gstack's skill at the commit the content change is
built on) and new (the content change's head). Each session ends with a three-line block (DECISION, NEXT ACTION, WHY),
and blind judges score the decision and the action against the key.

The design, its rules and its stops are in the preregistration,
[wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg](../../wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg/README.md),
as changed by its dated pre-run changes. This folder is the build those posts describe. Every paid run pins one commit
of it.

It reuses the office-hours founder lane (lanes/office-hours-founder) wherever that lane already does the job: the Claude
Code driver and its containers, the metering proxy and ledger, the containment probe and read audit, the person
simulator (src/persona-sim), the judge client, custody, and the paired statistics helpers.

## Where things live

| Folder or file | What it holds |
|---|---|
| types.ts, frozen.ts | Shapes shared by every area, and the values the preregistration and its changes freeze |
| author/ | Briefs: types and skins, twins, keys, the screens, the pilot gate and the sets |
| run/ and sim/ | The arm sessions with two pins and none, the closing loop, the simulated person with its added rules and reveal guard, and the fixed-script audit |
| score/ | The block parser, packets, the judge prompt and labeller, the judge check, the detectors and the scorer |
| read/ | The cluster t interval, Newcombe's method 10 with the design effect, the missing limits, admission and the decision table |
| wire.ts, cli.ts | How the areas connect, and the `gstack-evals ohr` commands |
| dryrun.ts | The keyless dry run over every area's seams |

Each area exports its dry-run seams from `<area>/seams.ts` as `Seam[]`. Tests live under tests/ohr/. Error codes
start with E_OHR_.

## Custody

Briefs, sheets, keys, transcripts and labels stay outside this repository. Every command refuses an output path
inside it, and the repository keeps only counts and digests.
