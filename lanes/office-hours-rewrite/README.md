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
| wire.ts, cli.ts | How the areas connect to the metered client, and the `gstack-evals ohr` commands |
| ledger.ts | The split of each approved item cap into ledger items (pre-run change 4), and the schedule check that walks every launch's rounds against its items |
| pinned.ts | The rule that a reply counts only when it names its pinned model, or a dated snapshot of it (pre-run change 4) |
| dryrun.ts | The keyless dry run over every area's seams, the ledger split, the schedule check and one lease per ledger item |
| e2e-score.ts | The keyless Docker end to end, then a planted scoring pass through score and read |
| preflight.ts, vm-bootstrap.sh | Section 12's no-model preflight, and the setup of a fresh runner VM for it |

Each area exports its dry-run seams from `<area>/seams.ts` as `Seam[]`. Tests live under tests/ohr/. Error codes
start with E_OHR_.

## Commands

`gstack-evals ohr --help` lists them: author, audit, rescreen, run, rows, score (packets, check-packets, judges,
sessions), judge-check, read (admission, decision, report), dryrun, e2e and preflight. rescreen is keyless: it runs
authoring's vocabulary check over a briefs directory with the screen read from the pins, and prints pass or fail per
brief with counts and file names, never text. Every model call goes through wire.ts: one
lease on one ledger item, the product-value meter and its metering proxy. The preregistration names GPT-6.2 Astra for
the Opus judge, the gold pass, the unanimous key and the simulator auditor, so wire.ts sends every "astra" request to the
meter's "astra-6.2" key (openai/gpt-6.2-astra); the meter's "astra" key stays GPT-6 Astra for other lanes.

`ohr read decision` takes every cap stop from each launch's stops.json and from each ledger item's record, and reads
authoring's end from the sealed authoring summary: an authoring cap stop after all 88 calibration and comparison
briefs were placed ends authoring only, and any other authoring end before that reads INCOMPLETE. `--cap-stop` can add
a stop but never remove one. This is the second attempt's fix for the one review finding that pull request 368
deferred.

## The no-model preflight on a VM

On a fresh Ubuntu 24.04 VM with no model key: run vm-bootstrap.sh (Docker CE from get.docker.com, since Ubuntu's
docker.io buildx refuses the rig's rewrite-timestamp export, and Bun 1.4.4), then create ~/.capy/work before anything
else and put a full gstack clone holding both pins at ~/.capy/work/gstack-evals/sources/gstack. The end to end creates
~/.capy/work, which moves the state root (src/trial/image.ts stateRoot) away from ~/.local/state, so a doctor run
before it pins the trial image where the end to end does not look. Then `bin/gstack-evals doctor --host claude` builds
the trial image (its claude CLI, key and gstack-approvals lines fail on a keyless VM and do not matter here), and
`bin/gstack-evals ohr preflight` checks the pins, Docker, the dry run and the end to end.

## Custody

Briefs, sheets, keys, transcripts and labels stay outside this repository. Every command refuses an output path
inside it, and the repository keeps only counts and digests.
