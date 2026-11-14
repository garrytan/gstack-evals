# Design plan review eval on constructed units (lanes/design-constructed)

This lane builds and runs the design plan review eval frozen in [the 2026-11-14 preregistration](../../wiki/plans/2026-11-14-geva-527-design-review-constructed-units-prereg/README.md). It asks whether gstack's design plan review makes a plan carry the design decisions its product's own evidence supports. Each test case is an invented new screen for a real open-source web app: a plan, a few evidence files the team already keeps, and a sealed key of five design decisions that evidence supports. Four review arms (none, a one-line designer lens, plan-design-review and autoplan) each end with the same block of at most eight plan changes, and judges from other model families label which key items each block names.

The code here does the whole pipeline: the frame search and recipes for the base apps, authoring with its checks, the review harness and its containment, judging and scoring with one fixed matching, the frozen readings, the ledger items, and stage 3's builds. Everything the preregistration freezes lives in frozen.ts, and tests/dc/frozen.test.ts checks every quoted string against the post byte for byte. `gstack-evals dc dryrun` runs every area's keyless dry-run cases and prints one PASS or FAIL line each; CI runs it through tests/dc/dryrun.test.ts. No paid call runs from this lane until the Captain's go, and every paid run pins the commit it ran from.

## Layout

| Path | Holds |
|---|---|
| frozen.ts | every frozen constant and quoted prompt, grouped by area |
| types.ts | the interfaces two or more areas share |
| errors.ts | DcError and fail() on the reason codes in src/errors/codes.ts |
| cli.ts | `gstack-evals dc`; each area replaces its own rows when it lands |
| dryrun.ts | the dry-run registry and runner |
| frame/ | the frame search, entry filters, frame order, safe clones, the file check, recipe sessions and qualification |
| author/ | authoring steps 1 to 7, the fix round and rewrites, the structure and vocabulary screen, the 2x transform, twins, sets, the pilot and the gate check runner |
| run/ | arms and prompts, the export and strip, containment, mounts, the session loop, the gate hook and the D1 repair hook, detectors, the scope read |
| score/ | the parser and normalizer, the matcher (match.ts), packets, judge runs, the scorer and stock counts, the judge check, pairwise and the arm-guess probe |
| read/ | the twin check, the tier chain, smoke rules, contrasts, verdict precedence, the admission read and the projection rerun |
| money/ | the 17 ledger items, admission and one lease per item and run id |
| stage3/ | stage 3 authoring, oracle builds, the VM sandbox, builds, measures and the readout |
| <area>/dryrun-cases.ts | each area's dry-run cases, exported as cases() |

Tests live under tests/dc/, one folder per area.

## Pre-data clarifications

Each was ruled by the Captain on 2026-11-14, before any paid call, and is listed in the results post's deviations.

- **PD-1 (2026-11-14).** Credit in section 2's unanimous and give-away checks uses section 7's fixed matching: the maximum one-to-one matching with G's tie-break. The base and 2x tiers' A by class and A without Y read the same matching.
- **PD-2 (2026-11-14).** A unit version gets one fix round, read by a second audit in fresh calls. In that audit an item marked fix or drop by either auditor drops, an unfixed item included, and items dropped in the first audit stay dropped.
- **PD-3 (2026-11-14).** The generic screen runs right after the audit, and generic items leave the step 5 and step 6 matchings as mentioned items do.
- **PD-4 (2026-11-14).** A stock cell still unlabelled after the one whole-packet resend stays unlabelled; its unit counts for that row only when another counted packet credits it. When the unlabelled cells could flip STOCK FAIL, the read goes to the Captain first.
- **PD-5 (2026-11-14).** A change that matches the decoy or a wrong-way fact keeps its edges to primary items. The decoy-hit and wrong-way-hit rates are label reads, and the wrong-way-hit rate reads at 2x only.
- **PD-6 (2026-11-14).** A session's end is read in this order: contamination, then a cap stop, then termination on the session's own limit, then a failure outside the agent, then the last block of a completed reply. A cell gets at most one retry.
- **PD-7 (2026-11-14).** The specificity contrast reads G at the 10x tier, with shuffled-key packets carrying the partner unit's keyed details. At the base and 2x tiers it reads A.
- **PD-8 (2026-11-14).** STOCK FAIL counts each calibration unit once, credited for a row when its base or 2x real-key production packet credits it. Twin, reference and shuffled packets count nothing.
- **PD-9 (2026-11-14).** A provider drift stops every call on that model, in every role, for the Captain.
- **PD-10 (2026-11-14).** "Renders" takes the strict reading: three distinct discovered routes, each load below HTTP 400, on the requested route, with no uncaught page error within 10 seconds and visible app content, at all three viewports. A recipe path matches a discovered route when each dynamic segment matches one non-empty segment and a catch-all one or more, with route groups dropped, a basePath stripped, a trailing slash ignored and hash routers compared on the fragment. A supply stop prints the qualified count under the HTTP 200 reading too.
- **PD-11 (2026-11-14).** The author's input bundle: README up to 30 KB, a file tree of up to 4,000 paths, design-system files up to 60 KB, and up to 6 screen files of up to 30 KB each, ranked by the words their path shares with the kind's noun, then size, then path.
- **PD-12 (2026-11-14).** Item ids are assigned at intake in a seeded per-unit order (Fisher-Yates, seeded from the first 8 hex digits of sha256 of "20261114", a newline and the unit id, read as an unsigned 32-bit integer), never the author's order. A 2x key inherits each id by byte-identical statement match.
- **PD-13 (2026-11-14).** Stop scopes: which work each stop halts, which keeps running and which sub-reservations settle, as STOP_SCOPES in frozen.ts records them. A dc-hosts cap stop stops every stage, and a recorded cap stop closes its whole item.

The Captain also ruled on 2026-11-14 that "at most 30" bounds recipe sessions, with a separate limit of 100 clones (the post's terms paragraph lists 30 clones, a pre-data deviation); that a recipe may sign in a seeded local test user, while an app that needs an outside auth provider or hosted service doesn't qualify; and that the frame search and file check run once, early, from a frozen commit.

## Build-time choices

Each area lists the choices it makes that the preregistration leaves open, with the plan section that settles each.

### frame

### author

### run

### score

### read

### money

### stage3

## Reuse

Every file copied from another branch or lane keeps its copyright header and adds one line naming its source path and commit.

| Source path | Commit | sha256 | What changed |
|---|---|---|---|

## C1 frame-run record

The frame search and the file check run once, from the commit below. Their results and the clone list stay sealed outside this repository; this record holds counts and digests only.

- Commit: (not run yet)
- Search queries and cached responses: (count, digest)
- Frame after the entry filters and the one-per-owner rule: (count, digest)
- Clone attempts, clones, file-check passes: (counts)
- Recipe sessions; qualified under the strict and the HTTP 200 reading: (counts)
