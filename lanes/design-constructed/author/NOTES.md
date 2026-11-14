# Author area: build notes for the integrator

The author area builds units: the pipeline per unit in K1's order, the 2x tier, twins, draws, the author input bundle,
sets, the pilot stop and the authoring re-projection, the build-time prompts and the gate check runner. Every model
call, block parse, spend read and base-app read comes in through a seam typed in seams.ts. No shared file was edited.

## Files

| File | Holds |
|---|---|
| seams.ts | Caller, BlockParser, SpendReader, BaseAppView and Deps: what integration wires |
| text.ts | word counts, the vocabulary normalization, word sequences, sha256, the last JSON object of a reply |
| unit.ts | unit files, reply parsing, item ids at intake (PD-12, R2-21), 2x id inheritance (M2), the digest (K2), the check log |
| screen.ts | step 3 (structure and vocabulary), the 2x screen, the needle check, the pinned skill files |
| prompts.ts | the prompt builders and the sha256 pins of the build-time prompts |
| ../prompts/author/*.md | audit, 2x audit additions, fix, rewrite note, validator labelling brief |
| bundle.ts | K10, the author input bundle |
| checks.ts | the audit reply and how two auditors combine, label packets and their parse, the generic screen, steps 5 and 6 |
| pipeline.ts | one unit end to end (K1 to K6), the funnel |
| x2.ts | the 2x tier (K7, R2-16, M10) |
| twins.ts | second skins (K8) |
| draws.ts | draw positions, the kind order and the pilot positions (K9) |
| sets.ts | calibration, comparison and reserves, and the replacement rule (K11) |
| pilot.ts | the pilot cost stop (K12) and the re-projection (start rule 12) |
| run.ts | the pilot end to end on the seams |
| gatecheck.ts | section 16's runner, its expectation table and the keyless half |
| fixture.ts, scripted.ts | invented fixtures and a scripted caller for tests and the dry run |
| dryrun-cases.ts | 60 dry-run cases |

Tests: tests/dc/author/author.test.ts runs every dry-run case as a test, plus the prompt pins, the vocabulary loader
and the parsers.

## Reuse

No source file was copied whole. Each row is a file whose pattern was read and rewritten for this eval on main's code;
the file that carries it names the source path and commit in its header.

| Source path | Commit | sha256 | What changed |
|---|---|---|---|
| lanes/office-hours-founder/author/sets.ts | 14fbe35b2a3cb6d7477bc1eea4e61577650d4243 | aa067b11225680f4400f44fa641d43762a571ecdf3df9c0422cb8d5166ce52df | sets.ts: the type and shape quotas are gone; calibration is the first passing unit on each of the first 16 base apps, comparison has a cap of 4 an app, the replacement takes the same app first |
| lanes/office-hours-founder/author/screens.ts | 14fbe35b2a3cb6d7477bc1eea4e61577650d4243 | d79c8665ad03c0e812ac551269b974c1e5a7f90833925e859313d0fc76657cdf | text.ts: only the normalization, word sequences and whole-word test; the vocabulary source is plan-design-review's three files at the gstack pin |
| lanes/office-hours-founder/author/constructed.ts | 14fbe35b2a3cb6d7477bc1eea4e61577650d4243 | 891b8ec06200870b9c84c5e74d490f7f5625e45004a7a36b83f35378e6e9c28d | pipeline.ts: only the write, check and rewrite loop; this eval's step order, fix round, per-item drops and early exits replace office-hours' checks |
| lanes/aftermath/stats.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 72ca982d012c054b1dbd66546a80bc4a76481b9deb97382139aaca50d1edc9c1 | unit.ts: only the shuffle's Fisher-Yates form, run on main's seededRandom (src/runner/stats/paired.ts, imported, not copied) |

## Build-time choices (BT)

1. A word count is the number of whitespace-separated tokens, as main's review lanes count change words.
2. The plan's date is the first date plan.md states, else the authoring date. Dates are read in these forms:
   2026-08-14, 2026/08/14, "August 14, 2026", "Aug 14 2026", "14 August 2026" and "August 2026" (its first day).
3. The name check: a capitalized first name from a frozen list of about 190 common first names, followed by a
   capitalized word of letters; an email address; an @handle not followed by "/" (so package names pass). Names that
   are also common words or colours (Mark, Frank, Jack, Grace, Amber) are left off the list.
4. The docs folder is docs/ at the repository root. An evidence path bears an instruction-file name when any path
   segment matches section 4's strip list, in any case.
5. Item ids are i01 to i05. Before the seeded shuffle, items are put in a canonical order (class S, H, R, A, Y, then
   statement, detail and pointers), so the author's order can't reach the ids.
6. The author reply's key may be a list of items or an object holding items; "mentioned" names an item by its class
   letter or exact statement, and anything else is a parse failure, which is resent once.
7. The context writer's reply parses when it is non-empty.
8. An audit reply that doesn't parse twice drops the unit. A fix reply (JSON items with id, statement and detail; only
   the fix-marked ids apply) that doesn't parse twice drops the unit, read as an author reply under K4. After the fix
   the pre-fix step 3 result is void and step 3 reruns.
9. The audit reply is JSON with a keep, fix or drop verdict, a reason and a mentioned flag per item, and input
   failures from five named checks: plan-signposts, evidence-recommends, dated-after-plan, real-person and
   method-wording. At 2x a sixth, decoy, joins them, and a split failure is an item verdict.
10. The early exit runs before the generic screen too: with fewer than 3 items left after the audit and the mentioned
    flag, the unit drops at the audit and the generic screen (a paid check) doesn't run. Validators run one at a time
    in the order Opus, Sol, Astra, and step 5 or 6 stops once fewer than 3 items can remain.
11. Label packets list items as "- <id>: <statement>" (with the detail when the packet asks for details) and each list
    as numbered changes. A key-construction block is list-a; stock rows are list-1 and list-2. The 2x unanimous
    packets ask for the detail label, because M10 reads it there.
12. Efforts and output caps: author, fix, transform and audit at high effort; validators, label packets and the
    generic screen at medium; caps from frozen.ts's outputCaps, doubled on each resend.
13. The needle's stop list is 40 function words (screen.ts NEEDLE_STOP_WORDS).
14. The 2x screen's split and needle checks run on the base unit's primary items; "cites at least two evidence files"
    counts distinct docs files, not base-app files. The 2x id inheritance also requires byte-identical class and
    detail. The 2x key's flags carry from the base unit; its wrong-way facts are the reply's, else the base's.
15. The author bundle: a KB is 1,000 bytes; files are framed as "=== path ==="; design files in path order, the one
    that crosses 60 KB cut and the rest named; the tree sorted, first 4,000 paths; screen files ranked by whole-word
    matches of the kind's noun words. The context writer's README and tree take the same caps, with every evidence path
    listed.
16. A second skin's unit id is the first skin's plus "-t". The translation prompt is the next app's bundle for the
    first skin's kind, then the case as JSON, then the frozen twin note. A pilot or later unit's id is "u" and its
    draw position.
17. The re-projection fills comparison units first, then reserves. Calibration units still needed and twin tries are
    costed at the measured cost per passing unit and 2x versions at the planning $1.40 until measured. The dc-authoring-1
    projection prints and doesn't stop.
18. Money compares at four decimals (M12), so $10.00 a passing unit passes and $10.01 stops.
19. The gate check runs one audit with no fix round, and every gate reads all five items of the planted unit, so each
    gate's verdict is read on its own. "Dropped by the audit" is a drop verdict from at least one auditor. A known-good
    unit's "kept" is keep from both auditors with no mentioned flag.
20. The gate check reads only the sealed planted units: author/planted.json holds each unit's digestOf and the sha256 of
    its files by role (plan.md, context/project.md, evidence/<n> in unit.json's order, key.json, unit.json), plus the
    sealed tar's plaintext sha256, and nothing else. runGateCheck refuses, before any call, a unit whose digest, plan,
    context or evidence differs (E_PLANTED_DIGEST). The planted units' base-app view takes designFiles as every file
    the file check's designKind accepts and routeFiles as the view files the app's router imports.

## Open for the integrator

1. **The plan's date (step 3).** The author prompt never asks plan.md for a date, so "no date after the plan's date"
   needs a reading. I take the first date plan.md states, else the authoring date. This decides which units fail step
   3, so it moves supply and cost, not a scored verdict directly. Confirm or replace.
2. **Wrong-way facts are not screened.** Step 3's list doesn't check that key.json holds two wrong-way facts, so a
   unit with none passes. Adding the check would add a frozen-rule gate; that is the Captain's call.
3. **The transform's length and path rules are not screened.** "Keep every file's path" and "within 10%" are in the
   transform prompt, not in the 2x screen's two added checks, so a transform that renames or resizes files passes.
4. **Gate check readings that decide E_DC_GATE_CHECK.** B2 and B6 read "dropped by the audit" as a drop verdict from
   either auditor in one audit with no fix round, so a fix verdict on the planted item fails the check. G1 and G2 read
   "kept by both auditors" as keep from both, with no mentioned flag.
5. **Kind nouns match whole words only.** "settings" matches k2's noun, but "notifications" doesn't match
   "notification". PD-11 doesn't say whether plurals count, and the authors' inputs depend on it.
6. **One copy of the kind order and draw positions.** The plan's layout table lists draw positions under frame/ and
   the brief gives K9 to this area. draws.ts gives the kind order k5, k3, k6, k4, k2, k1 (main's seededRandom at
   20261114, Fisher-Yates from the last place). If frame/ computes it too, keep one.
7. **The real vocabulary.** loadVocabulary reads plan-design-review/SKILL.md, sections/review-sections.md and
   sections/checklist.md from a gstack checkout at b6155921 and refuses any whose sha256 differs from screen.ts's pins.
   CI's keyless half runs on a stand-in vocabulary (the lens line only). With DC_GSTACK_PIN_DIR set, the test runs the
   fixture against the real vocabulary; I ran it and it passes. The planted units should be checked the same way.
8. **Block parsing for validators.** Steps 5 and 6 take the block parser as a seam. Whether validators get the strict
   parse or the one lenient parse is for whoever wires it; the frozen lenient parse is written for sessions.
9. **Wiring.** cli.ts's author and gatecheck rows are still "not built yet". The entry points are runPilot and
   runPosition (run.ts), run2x (x2.ts), sourceTwins (twins.ts), fillSets and replaceDropped (sets.ts), checkPilotFrom
   and reprojectFrom (pilot.ts) and enforceGateCheck (gatecheck.ts). Each planted unit needs plantedClass: the planted
   item's class for B2, B4 and B5, Y for B6, null for the rest.
10. **Funnel printing.** funnelTable gives each step's units reached and passed and, per class, items reached, removed
    and credited by a tie-break (M14 for steps 5 and 6). The print format is the integrator's.
