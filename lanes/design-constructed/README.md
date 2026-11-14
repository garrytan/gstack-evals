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
| frame/ | the frame search, entry filters, frame order, safe clones, the file check and route discovery |
| recipes/ | recipe sessions, the in-page probe, both readings of "renders" and qualification |
| author/ | authoring steps 1 to 7, the fix round and rewrites, the structure and vocabulary screen, the 2x transform, twins, sets, the pilot and the gate check runner |
| run/ | arms and prompts, the export and strip, containment, mounts, the session loop, the gate hook and the D1 repair hook, detectors, the scope read |
| score/ | the parser and normalizer, the matcher (match.ts), packets, judge runs, the scorer and stock counts, the judge check, pairwise and the arm-guess probe |
| read/ | the twin check, the tier chain, smoke rules, contrasts, verdict precedence, the admission read and the projection rerun |
| money/ | the 17 ledger items, admission and one lease per item and run id |
| stage3/ | stage 3 authoring, oracle builds, the VM sandbox, builds, measures and the readout |
| paid/ | the per-item proxies that hold every paid call: direct callers for authors and judges, session proxies, the provider watch, the pin record and the pins command |
| wire.ts | the composition module: every area's seams built from four providers, built only after a row's start rules pass |
| wire/ | the cli rows that spend, the start rules, the real providers on the controller host (real.ts), the host's stage module (host.ts) and the keyless fakes |
| WIRING.md | the open items the binding left for the Captain |
| prompts/ | the build-time prompts for author, score and recipes, each pinned by sha256 in its area |
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
- **PD-14 (2026-11-14).** Crew's cap rises from $470 to $700, recorded before any outcome data under the rule that the lines are guidelines. Crew spend up to $700 never counts against the $3,999 line, so it triggers no stage 2 cut; the pre-stage-2 projection rerun still runs, and a projection past $5,000 still stops for the Captain. CREW_DEVIATION in frozen.ts records it.
- **PD-15 (2026-11-14).** The 30 kept clones may live only as sealed ciphertext on one machine, since they are public repositories at recorded commits. Each clone's commit and tree hash is recorded in the sealed record. A re-fetch must match the tree hash; a commit that can no longer be fetched drops that base app with the reason printed, and it is never swapped. wire/clones.ts carries it as `gstack-evals dc clones --record <record> --out <folder>`: each entry fetched by its commit through the frame's fetchAt, its tree checked, every drop printed by frame position and reason, and the output written in the frame's layout (clones/c<NNN>, clones.json, filecheck.json, run.json) for the recipes, author and exports rows. tests/dc/wire/clones.test.ts and wire/dryrun-clones.ts's W-clones case test it.
- **PD-16 (2026-11-14).** The autoplan gate hook answers every gate revision, whatever the run's max_rounds, and sends the fixed message after each. When the pin refuses an answer, the session ends as the pin leaves it, and the refusal is recorded per arm.
- **PD-17 (2026-11-14).** A refusal, an empty reply or malformed output is a completed reply, and the frozen parse decides it. A malformed tool call that ends a session is decided by mechanism: after an error from the API, the provider or the harness it is a failure outside the agent (one J1 retry, then infra-missing); when the harness ended it on the model's own output with no such error it is an arm stop under section 5's row, scored after its one fresh retry. Both counts print per arm and model.
- **PD-18 (2026-11-14).** An unknown charge counts as in flight until the owner's reconcile settles it, so a refusal on an item that holds one waits rather than becoming a cap stop. Admission still reserves the worst case.
- **PD-19 (2026-11-14).** The Captain's pre-data ruling: a reply that doesn't name its provider resolves through OpenRouter's generation record, on every session proxy and direct caller, and one short probe call per model runs first after the go, before any stage spends. paid/sessions.ts generationResolver, paid/direct.ts and paid/pin.ts modelProbePlan carry it; paid/dryrun-cases.ts's ruling 1A cases test it.
- **PD-20 (2026-11-14).** The Captain's pre-data ruling: provider names compare after folding case, spaces and punctuation, and both raw strings are recorded. A real provider change still stops the model. money/served.ts foldProvider carries it for the drift watch and read/start.ts startRule9 for start rule 9; tests/dc/money/names-hosts.test.ts and read/dryrun-cases.ts's PD-20 case test it.
- **PD-21 (2026-11-14).** The Captain's pre-data ruling: in the gate check a planted drop item counts as caught only if it doesn't reach the key unchanged. Either an auditor drops it, or an auditor marks it fix and, after the fix step, the second audit keeps it with the planted defect gone; the reading records which. An auditor saying fix while the item survives with the defect still in it is a miss, and E_DC_GATE_CHECK fires. author/gatecheck.ts carries it; author/dryrun-cases.ts's PD-21 cases test both ways. WIRING.md item 27 holds the reading of "defect gone".
- **PD-22 (2026-11-14).** The Captain's pre-data ruling: Playwright's headless Chromium is copied into each recipe and stage 3 VM over SSH, with its libraries from the apt mirror, before the session starts, and its files are recorded as the controller's so the sandbox audit doesn't read them as the session's. stage3/install.ts, stage3/sandbox.ts and wire/real.ts carry it; tests/dc/stage3/install.test.ts tests it.
- **PD-23 (2026-11-14).** The Captain's pre-data ruling: the WAL host is folded into dc-hosts on burstable-1, and dc-hosts' projection is rerun with it: $74.80 of the $80 cap. No cap changes. money/hosts.ts carries it; money/dryrun-hosts.ts and tests/dc/money/names-hosts.test.ts test it.
- **PD-24 (2026-11-14).** The Captain's pre-data ruling, a deviation from section 4: the bridge network is attached only for ./setup, before the session starts, then detached and verified gone before Claude Code launches. The install digest is recorded per session, and a session whose digest differs from the pinned one stops before launch. run/docker.ts carries it; run/dryrun-cases.ts's C3 install case and tests/dc/run/install.test.ts test it.
- **PD-25 (2026-11-14).** The Captain's pre-data ruling: a session cut by a drift stop reads as a cap stop reads: incomplete, never retried, never scored. run/session.ts readAttempt, run/types.ts and wire/sessions.ts carry it; run/dryrun-cases.ts's PD-25 case tests it. WIRING.md item 29 says which sessions count as cut.
- **PD-26 (2026-11-14).** The Captain's pre-data ruling: particle-1 is matched on the panel's edges, meaning edges with two votes. When Astra and Opus each name a different edge and Gemini says no, no edge has two votes, so the item can't be credited through a change. The count of such cells prints per arm, and a sensitivity read with the union prints beside particle-1's contrasts; it decides nothing. R2-18's "other judges' edges are used" covers a yes with no index, not two judges who disagree on which change. score/labels.ts, score/score.ts, read/stage2.ts unionSensitivity and wire/keyless.ts carry it; the PD-26 cases in score/dryrun-cases.ts and read/dryrun-cases.ts test it.
- **PD-27 (2026-11-14).** The Captain's pre-data ruling keeps these as built: a panel cell missing Astra's or Opus's answer after its resend is unlabelled and Gemini isn't asked (1I); stage 1 smoke packets count in STOCK FAIL (1J); a gold pair the subject judge didn't credit leaves its detail gate as unlabelled (1K); the pre-stage-2 fit check reads each item's cap as well as the all-in line (1L, now read through PD-30); cut 3 goes to the most units that fit, never below 48 (1M); a failed J1 reconciliation before an arm-stop retry reads infra-missing (1O); a cell that never ran reads incomplete, not missing (1P); an unread detector counts as not exposed, with the unread count printed (1Q); a twin pass of 0 counts as scored (1R); a failed 10x detail check reads NO READ (judge) before saturation (1S); k reads only units with both a base and a 2x Opus none mean (1T); R48 keeps the literal kind and prints the precedence step (1U); each particle-1 panel member's re-check is 40 cells in 4 packets of 10, 20 of each class (1V); the derangement pool is limited to the read's units, with the pairs recorded (1W); blocked connections are printed per sandbox and aren't breaches (1X); the frozen ./setup runs without --no-browser, and the results post says browse was unavailable in every gstack arm (1Y); the installed gstack checkout has no .git (1Z).
- **PD-28 (2026-11-14).** The Captain's pre-data ruling: the proxies' retry budget, for direct calls and both launchers, is 3 attempts within 15 minutes, and a wiring file naming another refuses. wire/real.ts carries it; tests/dc/wire/retry.test.ts tests it.
- **PD-29 (2026-11-14).** The Captain's pre-data ruling: section 2's 40 money and operations items, none of which moves a scored outcome, each take the recommended option, and the containment retry stands as WIRING.md item 8 describes it (a fresh session folder from the same export, one combined containment point, and a second failure stops the launch for the Captain).
- **PD-30 (2026-11-14).** The Captain's standing rule on the stage 2 margin: a measured cost a few percent over plan doesn't trigger section 13's cuts. Before stage 2, each item's cap is re-priced from stage 1's measured costs and the pilot and recorded as a deviation, because the lines are guidelines. Section 13's cut order applies only if the re-priced all-in projection would pass $5,000, which stops for the Captain in any case. read/admission.ts projectionRerun and reprice carry it; read/dryrun-cases.ts's PD-30 and S13-projection cases test it. The reprice row (wire/reprice.ts) writes the re-priced caps into the ledger, and wire/start.ts admits each launch on them; wire/dryrun-cases.ts's PD-30 cases test it.
- **PD-31 (2026-11-14).** The Captain's pre-data ruling on stage 3's unfrozen pieces (WIRING.md items 19 to 21): stages 0 to 2 are pinned and run first. Stage 3's build reader, authoring and DES-4 judge prompts and reply formats are written before stage 3 starts, each recorded as a pre-data deviation, and get one cross-family read on GPT-6 Astra framed as a read-only correctness review. They go to the Captain with the request to start stage 3, and no stage 3 call runs before that go. Stage 3's caps don't change. Until then the VM provider binds only the recipe agent, and every stage 3 piece refuses with E_DCW_NO_PROVIDER before it reads a key or makes a VM. wire/real.ts realVm and its stage3 provider, wire.ts and wire/stage3.ts carry it; tests/dc/wire/real.test.ts and wire/dryrun-cases.ts's PD-31 case test both ways.
- **PD-32 (2026-11-14).** The Captain's pre-data ruling on the driver's wait for background work (WIRING.md items 10 and 22): backgroundWaitMs is 3,600,000 ms, the same in every arm, and each session's own limits still bind. The number of sessions that still had background work at their first result prints per arm and model. frozen.ts BACKGROUND_WAIT, run/arms.ts sessionSetup, wire/real.ts, run/session.ts printBackgroundAtResult and wire/sessions.ts carry it; run/dryrun-cases.ts's PD-32 case and tests/dc/wire/real.test.ts test it.
- **PD-33 (2026-11-14).** The Captain's pre-data ruling on errorSeen's window (WIRING.md item 23): PD-17's error is any error from the API, the provider or the harness inside the attempt, as built. The code comments that said "the session's last exchange" now say "inside the attempt". wire.ts SessionDrive and run/session.ts carry it.
- **PD-34 (2026-11-14).** The Captain's pre-data ruling on the model probe's ledger item (WIRING.md item 25): PD-19's one short probe call per model charges dc-gate-check. paid/pin.ts runModelProbe and the modelprobe row (wire/modelprobe.ts) carry it; paid/dryrun-cases.ts's PD-34 cases, run by tests/dc/paid/paid.test.ts, test it.
- **PD-35 (2026-11-14).** The Captain's pre-data ruling on the gate check's fix step (WIRING.md item 27), which sharpens PD-21's "the planted defect gone": after the fix call, the fixed unit goes through step 3's screen again before the second audit, and the planted defect gets a keyless check of its own wherever one is possible (for example, B2's evidence pointer resolves to a supporting line, and B6's item cites the right component). A fix that changes the item's text but leaves the defect is a miss, and E_DC_GATE_CHECK fires; a fixed unit that fails the re-screen is a miss too. The gate report prints the item's text before and after the fix. author/gatecheck.ts carries it; tests/dc/author/gatecheck-fix.test.ts and author/dryrun-cases.ts's PD-35 cases test both ways.
- **PD-36 (2026-11-14).** The Captain's pre-data ruling on which sessions a drift stop cut (WIRING.md item 29): only a session that ended other than completed while a drift stop covered its model and arm reads as cut under PD-25. A session that completed before the stop reads as completed. wire/sessions.ts carries it, as built.
- **PD-37 (2026-11-14).** The Captain's pre-data ruling on the validators' parse (WIRING.md item 17): the author area's steps 5 and 6 keep the lenient parse frozen for sessions, as built. wire.ts blockParser carries it.
- **PD-42 (2026-11-14).** The Captain's launch-path ruling on the region and the recipe VM files: the launch values as listed, the region recorded on every row, a switch to the fallback region written in the run record, and a stage started in one region finishes there. On the controller host each paid row reads the host's region from the launch's record, prints it, writes it into launch.json and records the region each stage started in (the work folder's regions.json; the stages follow section 14 item 7: probes, stage 0, gate check, authoring, judge probe, admission, stage 1, stage 2, stage 3). A later row of a started stage in another region refuses with E_DCW_REGION before any admission, and so does a host with no recorded region, a vm section in another region or a recovery plan in another region. The vm section's Chromium build and Claude Code tarball ride in the work folder, named relative to it, and the host launch checks both, the tarball against the trial Dockerfile's pin. Probe 1D is stage 0's first browser launch: if it fails, the recipes row stops with E_DCW_BROWSER_LAUNCH once the sandbox has audited and deleted the VM. A failure before the browser launches (the VM, a preamble step or the controller's install) stays the frozen screen's outside-the-app outcome, retried once, and the run monitor watches the first qualification for it and stops for the Captain, as the ruling's gap 6 workaround has it.

The Captain also ruled on 2026-11-14 that "at most 30" bounds recipe sessions, with a separate limit of 100 clones (the post's terms paragraph lists 30 clones, a pre-data deviation); that a recipe may sign in a seeded local test user, while an app that needs an outside auth provider or hosted service doesn't qualify; and that the frame search and file check run once, early, from a frozen commit.

## Build-time choices

Each area lists the choices it makes that the preregistration leaves open, with the plan section that settles each.

### frame

- **BT-F1 Query.** One query text for every page, with `$q` = `topic:<t> license:<l> sort:stars`, `$first` and
  `$after`, and `pageInfo { hasNextPage endCursor }`. Searches run topic by topic in frozen order, each topic's
  licences in frozen order. The README is read by four aliased `object(expression: "HEAD:<path>")` fields in the order
  README.md, readme.md, Readme.md, README; the first non-null text is the README.
- **BT-F1a Paging (Captain's approval, 2026-11-14).** Live GitHub answered HTTP 502 to a first-100 page carrying README
  text (about 12 s, past GitHub's GraphQL time limit) while a first-25 page came back in about 4 s. So each search is
  read as up to 4 cursor pages of 25 (`SEARCH_PAGE_SIZE`, BT), following endCursor until the search has given 100
  node slots (`FRAME.resultsPerQuery`, unchanged) or GitHub says there is no next page. Pages are read in order and
  concatenated, so the nodes come in the order one first-100 reply would give. Each search records its pages, its
  summed cost and its nodes. A full frame is 200 page requests.
- **BT-F2 Cache.** Each page reply is cached at `<out>/search-cache/<sha256 of query and variables, cursor
  included>.json`, written only after a reply with no error, so the cache holds the record of every page the launch
  read. The cache serves only its own launch: a relaunch starts clean (BT-F11).
- **BT-F3 Pacing, resends and quota.** One request at a time, at least 3,000 ms between the starts of any two gh calls,
  rate_limit reads included. A page that fails with HTTP 502, HTTP 504 or a request timeout (`SEARCH_RESEND`) is resent
  up to 3 times, 4 tries in all, 5, 10 and 15 s apart: it is the same request and nothing came back. Any other error,
  or a page that fails all 4 tries, stops the run at once (BT-F11). The frame never takes the GraphQL quota under 1,000
  points; under it, it waits for the reset.
- **BT-F4 Duplicates.** A repository two queries return is read from the first query, in query order.
- **BT-F5 Filter order.** public, not a fork, not archived, not a template, stars, pushed, licence, language, topic
  words, README title. A repository leaves at the first it fails; counts print after each.
- **BT-F6 Pushed.** pushedAt on or after 2026-06-01T00:00:00Z (UTC).
- **BT-F7 Language.** GitHub's primary language name compared exactly with TypeScript, JavaScript, Vue, Svelte.
- **BT-F8 README title words (the Captain's ruling, 2026-11-14).** The title is the first heading outside fenced code,
  which is a Markdown heading (ATX, or setext under a paragraph) or an HTML `<h1>` element, whichever comes first; only
  when there is no heading does it fall back to the first non-empty line. Either way only the visible text counts:
  tags and attributes, link and image URLs, image alt text and bare URLs are removed before the whole-word check.
  Words are runs of letters and digits, lowercased. No README leaves the title filter passed.
- **BT-F9 Frame key.** sha256 of "20261114", a newline and nameWithOwner as GitHub returns it.
- **BT-F10 Clone walk.** Down the frame order, each repository is cloned once, at the oid the search recorded, by
  `git fetch --depth 1 <url> <oid>` into a fresh repository with hardened git, then checked out detached. Clone
  starts are at least 3 s apart. The walk stops at 100 clone attempts or once 30 candidates pass the file check (A1:
  at most 30 recipe sessions, so a 31st pass is never used). A repository whose search recorded no head oid counts as
  an unfetchable attempt with no network call. Under R2-1's other reading (`bound: "clones"`, code only, no flag) the
  walk stops at 30 attempts.
- **BT-F11 Stops and relaunch (Captain's approval, 2026-11-14).** All 200 pages run in one sitting at the frozen pacing,
  and run.json records the search's start and end times in UTC. When a page fails for good, the run deletes the
  search cache and everything else it wrote, keeps only launches.jsonl with a stop line (commit, time, search, page,
  error class), and exits 2 with "frame stopped: ... The frame must go to the Captain before any relaunch." A relaunch
  into the same out folder keeps nothing from earlier launches (it clears everything but launches.jsonl), runs all
  200 pages again, and records each earlier launch in run.json as "failed, no data" with its stop, if any. A finished
  run (run.json present) is refused: the frame runs once (C1).
- **BT-F12 What the file check walks.** Every regular file outside .git and node_modules, never through a symlink.
- **BT-F13 Tests and stories.** A file with a .test., .spec., .stories. or .story. part in its name, or under a
  `__tests__` folder, is not a component file and is not read for routes.
- **BT-F14 Design-system source.** Basenames compared case-insensitively: theme.*, tokens.*, *.tokens.json, DESIGN.md.
  A Tailwind config is tailwind.config.{js,cjs,mjs,ts,cts,mts} holding an object literal with `theme: { extend: ... }`.
  Custom properties count every `--name:` declaration in one .css or .scss file, comments removed.
- **BT-F15 Routes.** Route keys count repository-wide across every router and package. Next.js routes count only
  under a package whose package.json names next, in its pages/, src/pages/, app/ or src/app/; pages/api and the top
  level _app, _document and _error are not routes; in app/, private folders (_x) and intercepting routes are skipped,
  and route groups and @slots drop out. Nuxt routes count only under a package naming nuxt, in pages/, app/pages/ or
  src/pages/, with Nuxt 2's _id read as [id]. SvelteKit counts every +page.svelte from its nearest routes folder.
  Code routers count only in files that import react-router, react-router-dom, @react-router/dev/routes, vue-router or
  @angular/router; an entry needs a literal path and a route key (component, element, children, lazy and the like);
  nesting reads through children; a redirect entry and a wildcard-only entry (`*`, `**`, `/:pathMatch(.*)*`) are not
  routes. Path constants and routes split across files are not followed.
- **BT-F16 Matcher.** As R2-19, plus: `[[...x]]` and `*` match zero or more segments, `[[x]]` and `:x?` zero or one,
  a query string is ignored, static segments compare exactly, and a base path is stripped only when the path starts
  with it. A hash router's routes come from the fragment (`#/x` or `#!/x`). Base paths and hash mode are read from
  literal strings only (next.config basePath, nuxt.config baseURL or router base, svelte.config paths.base and router
  type, createWebHistory, basename, Angular's base href).
- **BT-F17 Output.** `<out>` holds search.json, entry.json (each returned repository and the step it left at),
  frame.json, clones.json, filecheck.json, run.json, launches.jsonl, clone-attempts.jsonl, search-cache/ and clones/.
  stdout prints counts (one line per search: topic, licence, pages, nodes, cost), frame positions of unfetchable
  oids and sha256 digests only. `--out` must lie outside the
  repository, and a dirty tree is refused.

### author

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

### run

- Prompt parts join with one newline, then a blank line, then the template.
- The reference prompt lists evidence by path in byte order, each under its path inside a fence longer than any backtick run in the file.
- GSTACK_SESSION_KIND=unattended and the empty plan-tune state apply to the gstack arms only. The CLAUDE_CODE_* settings apply to every session.
- Export commit metadata: `dc-export <dc-export@invalid>`, time 1763078400 +0000, message "unit export", branch main. The commit is written with hash-object, not git commit.
- The export builds its tree in a scratch repository that borrows the clone's objects through GIT_ALTERNATE_OBJECT_DIRECTORIES, then copies exactly the reachable objects with pack-objects into index-pack in the fresh repository.
- .ignore and .rgignore files are checked by writing them as .gitignore files in a scratch repository and running check-ignore --no-index.
- Symlinks are judged outside the tree lexically, without following them.
- The tree digest is the sha256 of TREE_DIGEST_SH's output.
- The C2 script runs through an Exec seam, on the host and in each container. Containers print only sha256 values and file names; the key-statement print runs on the host only.
- Words for the key-statement print are lowercased, NFKC-normalized, and kept to letters and digits.
- Ends: timeout, turn_cap, allowance_stop and context_overflow are the session's own limit. harness_crash, missing, infra, unknown and credentials_rejected are outside the agent. malformed_output, malformed_tool_call, refusal and empty_response map to no frozen row and the classifier holds them.
- The reply is every main-agent text joined by a blank line.
- A gstack read is any tool input matching the GSTACK_PATH pattern. A web result is any client or server web tool result.
- Cell order: units in the order given; each unit's cells are shuffled (Fisher-Yates) with a seed from the first 8 hex digits of sha256("20261114\n" + parts), through seededRandom in src/runner/stats/paired.ts.
- A retry holds its cell's concurrency slot.
- Gate hook: "written this session" means run.json's mtime is at or after the session start. --rec-hash goes on the answer whenever gate.json has a numeric rec_rev. It answers every gate revision, past the run's max_rounds (Captain, 2026-11-14), and records any answer the pin refuses.
- The D1 message is "Do not stop yet. The procedure has not shown these required outputs: {missing}. Produce them, then end your reply with the plan-changes block."
- plan-design-review detector: pass names count as the longest in-order run of first appearances, ignoring case and whitespace. The summary needs a Pass row with a score out of 10, or a GSTACK REVIEW REPORT with a "| Design Review |" row.
- autoplan detector: the lean design lens means a lean run with scope.ui true and docs_only not true. Bound means exactly one submitted native attempt, no outside attempt, and a bound file whose first line is an INPUT receipt and that holds a gstack-findings fence. The gate counts when gate.reply is rec and answered_by is agent:harness. Approved means status complete, plan.md and review-record.md present, and gstack-artifact validate printing ARTIFACT_VALID.
- Scope read: --scaffold, then init's wrap, then detectUiScope with the session's working folder (/work) as root.
- sdk.test.ts's hostile check runs on this host with the repository root as the working folder and a stand-in install (the pinned skill folders copied into HOME/.claude/skills). docker.test.ts runs it in the review container at /work with gstack's real install.
- Export intake: the source's HEAD and HEAD^{tree} must equal the base app's recorded commit and tree. A bundle is read with git bundle verify, then list-heads for its HEAD, then git bundle unbundle into a scratch repository, so no fetch transport opens. Git runs with GIT_NO_LAZY_FETCH=1. A drop is E_BASE_APP_DROPPED.
- Review image: the pinned trial image (docker/trial.Dockerfile through checkImagePin), run by its image id; the id is the digest each session records.
- Review container: one per session, entrypoint sleep infinity, the host user's uid, every capability dropped, no-new-privileges, a pids limit of 1024, working folder /work. Its env is PATH=/usr/local/bin:/usr/bin:/bin, HOME, LANG=C.UTF-8, TERM=dumb and the arm's frozen env, checked on the agent allowlist and holding no key name. The proxy URL and the session bearer go only on the CLI's own docker exec, the bearer through the docker client's env.
- Mounts: read-write binds of the session's own copy of the export (repo/), plan.md and context/, made in a new session folder.
- Network: the run's trial network alone (src/trial/proxy.ts createTrialNetwork and startProxyContainer, reused as they are).
- gstack install: the pinned commit's tree from a local gstack repository through src/arms/install.ts stackTree (git archive, checked against the commit's tree, no .git), copied to HOME/.claude/skills/gstack (gstack's README install for Claude Code), then GSTACK_PIN.install run there. Only the install joins a plain bridge network for its downloads, and it leaves before the second C2.
- C3's listing: every path under HOME, the frozen mount points, every mount point in /proc/self/mountinfo, /drive and any */.capy/drive path outside /proc, /sys, /dev and /work. Beside containerProblems, C3 checks docker's view: the pinned image id, a non-root user, exactly the three binds from the session folder, the session network alone and no key name in the env (names only; the inspect template prints no value). Before the install every arm's HOME must be empty; after it, the gstack arm's own C3.
- The container's run reads: find under /work and HOME to depth 11 with .git and node_modules pruned and symlinks not followed, the same rule findRuns walks, then pickRuns on the files' mtimes and text.
- The sentinel's NET probe uses bash's /dev/tcp under a 10 s timeout, else curl, else prints NET unknown; its DRIVE lines are deduplicated.
- Plan-tune state files are matched by the PLAN_TUNE_FILES pattern.
- A mounted file named key.json or unit.json at any depth fails C2.

### score

- **Packet items (BT).** A production packet shows every key item no key step dropped, so the mentioned and generic strata read from the same packet. Each item shows the file its statement names (the last path-like token with a source extension), or none.
- **Packet seeds (BT).** Each packet is shuffled and labelled from its own seeded stream (sha256 of the seed 20261114, a newline and the packet's identity, first 8 hex digits). Ids are unique within a build. The derangement uses seededRandom(20261114) directly.
- **Shuffled packets (BT).** A shuffled-key packet holds every session list of the unit-pass, the reference included, against the partner's primary items in the partner's key order; no stock rows or oracle list. Stage 1 refuses shuffled packets on a read other than base.
- **Oracle lists (plan section 11, BT).** One change per primary item, its statement; at 10x an item with a keyed detail adds "Specifically: " and its detail. Items without a keyed detail add nothing at 10x. A 10x change over 40 words is cut and its pair leaves the detail anchors.
- **Label parse (BT).** A missing entry, a non-array or out-of-range index, a conflicting repeat, a missing detail_changes on an anticipated detail-keyed 10x item, or a detail index not among the item's changes is unlabelled. A no that lists indices reads as a no (D's rule). A yes with no index is unlabelled for one judge (R2-18).
- **Resend (K4).** A judge's packet with any unlabelled cell, a yes with no index included, is resent once whole with the resend note, a new cache identity and twice the output cap.
- **Panel (M11, BT).** Gemini is asked, on the whole packet, when any cell splits on the anticipated or screen-hit label, on a shared yes's edges, or on the detail of a pair both credit. A panel member's yes with no index counts as a yes vote with no edges. A cell missing a first vote after its resend is unlabelled without asking Gemini.
- **Cache identity (BT).** Judge, effort, tier, prompt digest (the pinned templates the packet uses) and packet digest (sha256 of the rendered packet). The provider's version is recorded on each result.
- **Evidence read (section 11 BT).** A session opened an evidence file when any string in any tool input names the evidence path at a path boundary.
- **File read (section 11 BT).** Over the primary items: an item's file is named when any change names its path, its basename with extension, or a component identifier from its statement (PascalCase words of two or more parts, camelCase words), each as a whole token.
- **Per-change precision (BT).** The share of a list's changes credited with any kept key item, by its own matching over every kept key item.
- **Secondary cells (BT).** An unlabelled cell outside the primary leaves only the read it feeds null (mentioned, generic, precision, shuffled, decoy or wrong-way), never the review.
- **Gold (BT).** Gold cells are key-item cells only (no decoy or wrong-way cells). Anchors sit on primary items: stock rows 1 and 2 known-bad, the oracle list known-good. Other cells of those lists, and every stock row 3 cell, go through agreement. A list met in several packets counts once, the first in a fixed order.
- **Gate (BT).** The oracle cap keeps a seeded subset of oracle cells no larger than the real anticipated count. Anchors weigh min(1, real / (3 x anchors)) each, so they carry at most a quarter. The gate reads weighted kappa; the unweighted and real-list kappas print beside it.
- **Re-check sample (BT).** One unit per packet, half of each class per packet, units in a seeded order with the admitted tier's gold first and base-tier gold after, cells within a unit rotated across list sources. A production judge takes 80 cells in 8 packets; a panel member takes 40 in 4. Packets sit at evenly spaced queue positions.
- **Pairwise (BT).** An unreadable answer is resent once, then the pair is unread. Win rates count ties as half; the stock flag counts wins only.

### read

- **Rounding (M12).** q4 rounds x's decimal expansion at ten places to four decimals, half away from zero, and returns whole ten-thousandths, so thresholds compare as integers. Infinity stays infinite.
- **Statistics computed before rounding.** Room (reference minus none), the budget anchor ratio and k are computed from unrounded values and rounded once at their threshold.
- **Percentiles.** Intervals use paired.ts's index rule (floor(n(1 - level)/2), ceil(n(1 + level)/2) - 1). The twin check's re-split 95th percentile is the value at index ceil(0.95 n) - 1.
- **Seeds.** Every bootstrap and re-split starts its own stream at seed 20261114 with 10,000 draws.
- **Twin test (a)** fails only when the 90% interval is strictly outside -0.10 to 0.10 after rounding; an endpoint at exactly 0.10 is inside. Test (b) fails when the mean absolute difference is strictly above the re-split 95th percentile.
- **The k label.** "2x" inside 1.6 to 2.7 inclusive, else "k <value>" at four decimals, or "k infinite".
- **Arm means.** Each unit's mean over its valued passes (score, or 0 for a no-block or a second arm stop), then the mean over units. D leaves out units whose cells carry no D.
- **Specificity.** Per unit and arm, the mean over valued passes of (value minus the shuffled-key value); a zero cell's shuffled value is 0.
- **Length-adjusted difference.** OLS of the unit difference on the difference in mean list words, its intercept with a base-app cluster bootstrap 95% interval.
- **design.json.** A base app's digest is sha256 of its label; p0 is written at four decimals; items must be 3 to 5 (the frozen key size), stricter than power.py's 1 to 6.
- **power.py output.** The read takes power.py's own pass or fail word on its ADMIT line, which agrees with M12 because the power is a multiple of 1/4000.
- **Smoke cost.** The mean cost of the smoke whose result stands (the re-smoke when one ran) replaces the planning figure.
- **Stage 2 label cost** in the projection is units times the most passes any arm runs on that model, times one packet's measured cost.

### money

- **Lease time to live.** One day by default; integration passes each stage's length plus a day, within main's 7-day ceiling (L7).
- **Worst case.** The body is priced as the proxy sends it (provider routing, service tier, usage field), with an inference region added to every Anthropic body, which can only raise the bound. A free input count is used only when the caller passes one. The dry run shows the controller's reserve equal to the real proxy's own reserve on all five models.
- **In-flight limits per item.** Direct calls 8 (frozen), recipe sessions 1, oracle builds 1. Rounds and VMs have no count limit, only room.
- **dc-hosts and the wait rule.** The controller host's own sub-reservations never count as work that will free room, so a VM refused with only the controller host in flight is a cap stop, not a wait to the end of the stage.
- **Rounds.** A round with fewer sessions than the item's round size reserves its own sessions at full allowance twice over. A session released by a stop takes its share (twice its allowance) off the round's reservation.
- **Stops drain.** Work in flight under a stop finishes and settles; each named lease settles once nothing on it is in flight. Unrun sessions release at once. Every stop scope lifts only on the Captain's word.
- **Authoring leases.** The leases that settle on E_DC_SUPPLY_SHORT, E_DC_AUTHOR_COST and E_DC_GATE_CHECK are dc-base-apps, dc-gate-check and dc-authoring-1 to -3.
- **Write-ahead copy.** Lines are hash-chained. After one unacknowledged append the log refuses every admission until a verified snapshot restarts it. The proxy ledger wrapper copies a reserve after the local ledger holds it and throws when the copy fails, so the proxy refuses with E_LEDGER_UNAVAILABLE, sends nothing, and reconcileJournal releases the hold at $0.
- **Snapshots.** The book, the local ledger (SQLite serialize, read under its lock) and the proxy journal at one watermark, read back from the target by sha256. Due after any settlement and at least every 10 minutes.
- **Recovery.** Every sub-reservation in flight at the watermark and every admission after it is held as unknown at its full reservation, even when a later settle line exists; settle lines are kept as evidence only. The owner's reconcile (main's reconcileLease after expiry) spreads the provider figure, less spend already settled on that lease, over the held sub-reservations in proportion to their reservations.
- **Routes and drift.** Sol, particle-1 and Argon run through OpenRouter; a reply's provider must match the pin's pattern (OpenAI, Particle, Google) and, when a dated terms record is passed, equal its provider name exactly.
- **The first judge packet.** dc-judges admits only the first-packet tag until the re-projection, which is everything committed plus the measured packet cost times the packets left.
- **R2-7's cap stop reading.** With 16 or more qualified, the base apps stay at that count, at most 20.

### stage3

- The audit scans files written outside /work since the run started, plus /work/recipe.json when it exists, for provider key shapes (Anthropic, OpenAI and OpenRouter, Google, GitHub) and Capy drive paths. Process arguments get the same scan. The run's own proxy token is lease-scoped and isn't one of these shapes.
- Each audit channel has a sentinel: kernel-log start and end marks for egress, a done line after ps and find, an end-marker file in the find list, a done line after the scan. A channel without its sentinel reads as cut and stops like a breach. A file the scan can't read stops the same way.
- The egress filter's listing is read back after the run. A rule the run did not set, a policy other than drop, or an accepted endpoint set other than exactly the proxy and the named mirrors is a breach. Endpoints are IPv4 literals so the filter can name them.
- Mirror config: npm via the run user's and root's .npmrc, pip via /etc/pip.conf, apt via sources.list with the three noble suites, Docker via daemon.json registry-mirrors.
- Run lengths: recipe 75, qualify 90, build 150, check 90 minutes; the time to live adds 60. Qualification step limits: install 20, seed 10, build 20, start 1, serve 2 minutes.
- recipe.json: at most 64 KB; base_url on http localhost or 127.0.0.1 only; at least 3 distinct paths; services only from Docker Hub references (no other registry host); no provider key names in service env; a recipe that carries a key pattern or drive path is refused.
- Qualification starts services, then install, seed, build and start (detached), waits up to 2 minutes for base_url, signs in when the recipe has a login and the run allows it, then loads the routes. A failed step fails both readings.
- PD-10 page reads: a blank page has no visible text and no visible image, SVG, canvas or video in the app root (#root, #app, #__next, #__nuxt, #svelte, app-root, [data-reactroot], else the body). A login form alone is a visible password input with under 200 characters of visible root text outside its form. A framework fallback is a dev-server error overlay, or one of the listed fallback phrases on a page with under 400 characters of visible text. Query strings are ignored when checking the final route; fragment routes are compared for hash routers.
- A qualification run that fails outside the app (the VM, a preamble step) gets one retry; then the candidate is unqualified as infra.
- Build arms run in the order no-review, none, lens, plan-design-review, autoplan, generic-look, unit by unit, 2 at a time.
- plan.md sits at /work/plan.md beside /work/repo, so the diff reads see only the build's changes (D put it inside the repository).
- A check run serves when every setup step exits 0 and every route answers below 400 to curl inside the VM.
- DES-4: one pair per arm, unit and judge; the arm's screens come first when the first 8 hex digits of sha256 of the seed, unit, arm and judge are even. Ties and losses are not wins, in the win rates and in the instrument check.
- Agent-user secondaries are means over scenarios with a result.

## Reuse

Every file copied from another branch or lane keeps its copyright header and adds one line naming its source path and commit.

| Source path | Commit | sha256 | What changed |
|---|---|---|---|
| lanes/aftermath/gh.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | c41962dde4a98eaa8f6c390e541196d1129e3303e9a7a8b2c3ad7f5b68f1b225 | frame/gh.ts: Trimmed to run, graphql, rateLimit and calls. graphql returns the whole reply and refuses any reply that carries an error (the source refused only a reply with no data), so a partial search page is never kept or cached. rateLimit also reads limit and used. codeload.github.com left the allowlist (the frame never downloads archives). Pacing applies between any two calls. The per-eval reason code, restMaybe, restText and pointsUsed went. Main has no copy of this file; main's lanes/product-value/author/gh.ts (sha256 746d7c81d1443e431ee39f4b62e244a3cdaba8dd80aba1588ec07719579609db) is the older version without the allowlist. |
| lanes/devex/mine/git.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | aaf5a18dbbb8600db5d8d5c852af64a818e21eac8c9fffc190c3caa2f054e0f1 | frame/git.ts: The allowed protocols are a parameter (HTTPS by default; tests pass file). GIT_NO_REPLACE_OBJECTS added. exportBase became fetchAt: it keeps .git so later exports can build from the pinned tree, checks HEAD is the oid, and leaves nothing behind on failure. unitDiff went. The caller asserts the GitHub URL. |
| lanes/devex/mine/github.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 2bd953e0234dddf53014198e56c9c62f7e36a30b4f5c5182e50a3507e4f8d057 | frame/ (pattern only): Not copied. Its REST topic search is replaced by GraphQL repository search only, as plan section 2 says. |
| lanes/devex/mine/pace.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 219e4389bf450e850917e3b13f07be8800de8d895f13fd4fda5f765e755296dc | frame/ (not used): Not copied. The frame spends about 50 points, so a fixed 3-second gap at concurrency 1 replaces the points-per-hour pace. |
| lanes/office-hours-founder/author/sets.ts | 14fbe35b2a3cb6d7477bc1eea4e61577650d4243 | aa067b11225680f4400f44fa641d43762a571ecdf3df9c0422cb8d5166ce52df | author/ sets.ts: the type and shape quotas are gone; calibration is the first passing unit on each of the first 16 base apps, comparison has a cap of 4 an app, the replacement takes the same app first |
| lanes/office-hours-founder/author/screens.ts | 14fbe35b2a3cb6d7477bc1eea4e61577650d4243 | d79c8665ad03c0e812ac551269b974c1e5a7f90833925e859313d0fc76657cdf | author/ text.ts: only the normalization, word sequences and whole-word test; the vocabulary source is plan-design-review's three files at the gstack pin |
| lanes/office-hours-founder/author/constructed.ts | 14fbe35b2a3cb6d7477bc1eea4e61577650d4243 | 891b8ec06200870b9c84c5e74d490f7f5625e45004a7a36b83f35378e6e9c28d | author/ pipeline.ts: only the write, check and rewrite loop; this eval's step order, fix round, per-item drops and early exits replace office-hours' checks |
| lanes/aftermath/stats.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 72ca982d012c054b1dbd66546a80bc4a76481b9deb97382139aaca50d1edc9c1 | author/ unit.ts: only the shuffle's Fisher-Yates form, run on main's seededRandom (src/runner/stats/paired.ts, imported, not copied) |
| lanes/aftermath/exposure.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 9e17a3d42df11e02fc3e63924787f081d7be01f5da6cf66e72b9157f8125f176 | run/ Adapted into transcript.ts. |
| lanes/devex/run/stophook.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | fd4c5ec0b823cb2830ec617f614b7280ac1235569ac62b3fb2fdacb2acf56246 | run/ Pattern for hooks.ts; devex-only behaviour dropped. |
| lanes/devex/author/scope.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 5039c3394cda272528ee5b8a7663e2add73475a7bded830205cb0081bef5ef99 | run/ Pattern for scope.ts. |
| lanes/devex/run/exposure.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | a49268ebec44e97e26e9f2885d5a1c302038e752b690bd9a35fb4ae4da4b2903 | run/ Pattern for detect.ts. |
| lanes/devex/run/checks.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 7f562ff8ba87b29b93b3f1b7c6ed590acfc7742b29bdd2e92a096b6c70d1f2f1 | run/ Hostile fixture, adapted into hostile.ts. |
| lanes/devex/run/memory.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 07afd16ba379857d8d9f77d43053f826ef56fdc1d95bb89b5fd3344523b22bef | run/ Not copied; the driver's memoryLog option replaces it. |
| The driver's memoryLog change | 5ee7f764232b196a1d0cec5b144a287b792f9c94 |  | run/ Ported into src/adapters/claude-code/driver.ts, off by default. |
| lanes/devex/run/parse.ts and session.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 |  | run/ The classifier is replaced; session.ts follows the session shape. |
| gstack lib/autoplan-scope.ts | b6155921a564ba9ec2470fd2cb3894c05e2c2d13 | 898c3cb791eb36a09113ce5b0a998b20e7576fc0755bc786998f6a7c18292ab7 | run/ Vendored into scope.ts. |
| gstack lib/frontend-scope.ts | b6155921a564ba9ec2470fd2cb3894c05e2c2d13 | 27c8a69861ed35b7c28de88f2c17a80dc15191a5a852f3fbf22cc6696e804cae | run/ Vendored into scope.ts. |
| gstack lib/autoplan-plan-text.ts | b6155921a564ba9ec2470fd2cb3894c05e2c2d13 | decb0fb8809ed85afa5bf3c7889fd65507856ecec3a0c50c4ae1b94b16e01bd7 | run/ Vendored into scope.ts. |
| gstack bin/gstack-autoplan-snapshot.ts | b6155921a564ba9ec2470fd2cb3894c05e2c2d13 | f9a31c701d8a86af3b752ab0901661a12f54cd7cd73b512e33f0eea62e555e73 | run/ Section reads and init's wrap, vendored into scope.ts. |
| gstack plan-design-review/SKILL.md | b6155921a564ba9ec2470fd2cb3894c05e2c2d13 | 5934f10c95119c12e3fe785a9b33cdb608f6214f79a88ea84ac77cdfed6fb820 | run/ Read for the pass names and the summary. |
| gstack plan-design-review/sections/review-sections.md | b6155921a564ba9ec2470fd2cb3894c05e2c2d13 | 262d857596134531e5b3e20e1d491afcf2083f798e05f6d5edcc566b3b000ddd | run/ Read for the state table. |
| gstack lib/autoplan-lean.ts | b6155921a564ba9ec2470fd2cb3894c05e2c2d13 | ef1cd3d4d88ca0af5f0b561f72370b7ac0dd7c1baa687f1a3d49d2e6ac862f60 | run/ Read for the lean design lens. |
| gstack lib/gate-list.ts | b6155921a564ba9ec2470fd2cb3894c05e2c2d13 | e27370c0ef920c5c3383339e5a34ce34007f17e03d1d307bd032be2b3f463a7e | run/ Read for the render's binding line. |
| gstack lib/autoplan-gate.ts | b6155921a564ba9ec2470fd2cb3894c05e2c2d13 | 4e7f4ea9e085817dfc2ba9317089ff01346ad9eab112b414b4f754ecd22b4abc | run/ Read for answer and recommend. |
| lanes/aftermath/parse.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 674c3c1baef4a291f1d5afa117dd4382d0b328065ee18c5d8a5bca7466133721 | score/ into score/parse.ts: bound to 8 changes of 40 words from frozen.ts; the lenient parse takes only the three frozen forms (no single-key object); overflowed() left to the run area; evidenceOpened added |
| lanes/devex/run/parse.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 49e46190e4baeb1a5553fc648880dda49f03a6fec05656fde647ca81c9b099ee | score/ its binding folded into score/parse.ts; its attempt classifier is not copied (the run area owns end states) |
| lanes/aftermath/stats.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 72ca982d012c054b1dbd66546a80bc4a76481b9deb97382139aaca50d1edc9c1 | score/ into score/stats.ts: shuffle, randomId, derangeByGroup, r4 and kappa only; maxMatching not copied; kappa takes cell weights; seedOf and rngFor added |
| lanes/devex/score/packets.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | d22d516a2c1053253a56643dff935bc232182f84bb54b37fcd98b333e5915aba | score/ into score/packets.ts: design items with their files, 2x decoy and wrong-way items, 10x details, oracle lists, one seeded stream per packet identity |
| lanes/devex/score/judge.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | ffd356d50e989e3fc457474ad9f4e6065bcaaf0227d1142c2cffff2261264ac5 | score/ into score/labels.ts: anticipated and screen-hit labels with the 10x detail label, R2-18's unlabelled yes, M11's panel; the metered client became a seam |
| lanes/aftermath/judge.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | e4e72291cf4506889e70e1b7d46185e6d7a2db613be63fd84b787d80186bc9b7 | score/ into score/labels.ts: lastJson, the resend note and the pinned-prompt check; the version tap stays with the money area's client |
| lanes/devex/score/score.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 8ba2b75c4fb8b0e6d0820f2b4304f9c3761102d1575dee98ac8d2751d27e94bf | score/ into score/score.ts: every credit through fixedMatching; G and D; decoy, wrong-way, evidence and file reads; PD-4 and PD-8 stock counts |
| lanes/aftermath/readings.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | f50a4f320a45d7de778d5e27755502c8ee493923b0e3433d3239988fd1925e56 | score/ into score/check.ts: the gold-scoring core, now with anchor weights and the oracle half cap |
| lanes/devex/score/rules.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 3205cc4a6f0a0c7ec5901dd78e8f3062888ae347fdaeb90092d7ce45d982c7c0 | score/ into score/check.ts: judgeScore, goldCells and recheck, rebuilt on prereg section 6 (gold from the other two families, the detail check, 80 cells in 8 packets) |
| lanes/devex/score/prompts/brief.md and audit.md | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | b6fe604ecc39eeb5fa0d16f2b8a9e0de98781abf42be3feacb571c672de34b6a and f87930837fa35bb750e507f8e867c586d771b7d33d2645aa0b54e23d4da1c98a | score/ the shape only (labels, examples, answer format); the text of prompts/score/brief.md and audit.md is new, for design items |
| lanes/aftermath/stats.ts (D) | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 72ca982d012c054b1dbd66546a80bc4a76481b9deb97382139aaca50d1edc9c1 | read/ copied in part to read/stats.ts: percentileInterval, bootstrapMeans, resplitDraws, ols and clusterBootstrap; upperQuantile added; r4, mean, shuffle, derangement, maxMatching, kappa, Spearman and the logistic fit left out (num.ts rounds; match.ts matches) |
| src/runner/stats/paired.ts (M) | 91d76421a9f127167b3694306aa77f2971f7a712 | dbd7aac9e900963491c35ef4b4866eee4d98ea6412ec878303c8cd6b703772e3 | read/ imported, not copied: clusteredPairedDelta (base-app cluster bootstrap, 10,000 draws, and the sign-flip p, exact at 20 or fewer clusters), holmAdjusted, seededRandom |
| src/runner/stats/sign-flip.ts (M) | 91d76421a9f127167b3694306aa77f2971f7a712 | 4acc2e81b190f442f39dc445878420a4d92fd03a876be0020e6bd4e41b9a94fb | read/ not used: it holds the margin-shifted non-inferiority test; the two-sided exact sign flip this eval reads is paired.ts's |
| lanes/devex/score/rules.ts (D) | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 3205cc4a6f0a0c7ec5901dd78e8f3062888ae347fdaeb90092d7ce45d982c7c0 | read/ pattern only, rewritten in stage1.ts and stage2.ts: the smoke decision, the precedence and framing readings follow its shape; its unit-pass join and its optional repository map are replaced by per-arm unit means and a required base-app map (M13) |
| wiki/plans/2026-11-14-geva-527-design-review-constructed-units-prereg/power.py (M) | 91d76421a9f127167b3694306aa77f2971f7a712 | 09636859375fbde79efaffcedb794ebc7699e0d13cf081246da45bb943ae5d3a | read/ run in place, not copied; the wrapper refuses any other bytes |
| lanes/aftermath/meter.ts (devex branch, generalized from lanes/product-value/meter.ts) | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 4841e6c1b9f25a0f3100f36a8c817154ce81ae854363f6c7ff7bbaf6483dd1de | money/ No lease opened here: the controller holds it and admits each call at the proxy's worst case before binding. Settles the controller's sub-reservation from the local ledger's figures per meter. The per-model scope stop moved from the branch's local ledger change into the controller's stop scopes, so main's local.ts is untouched. Drift is E_DC_PROVIDER_DRIFT and applies PD-9 across every item. The first call per model records its served provider and routing terms. The reply cache and its key are unchanged. |
| lanes/devex/stage3/sandbox.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | b639a5c0611f1a853e4da25deb4618d66dade8f38b3b62deb7a1d78bdf0bd2e4 | stage3/ named mirror endpoints with terms lines in place of one mirror; mirror config written before anything installs; a verified apt and unattended-upgrades step; the filter logs accepted and dropped connections apart; the audit reads the filter, the process list, the egress log, the written-file list and a key and drive-path scan, checks every command's exit and fails closed on empty or cut output (sentinels on each channel); dc-hosts admission per VM; UBI_OWNER from the environment; DcError codes; fetch, sleep and the clock injected |
| lanes/devex/stage3/fake.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 7e6837e622ec0639a7dc18842355502d722d094c858d1da16512af33d9b00de5 | stage3/ now wraps the real UbicloudBackend with a fake fetch and ssh, so tests run the real backend's commands and parsing; fault injection per audit command |
| lanes/devex/stage3/readout.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 78d4325a16c01f8d2fe63b9b7297138f99082253d01c88d3f47677470469545e | stage3/ pattern only, not copied: pairing by unit with a worse count, now on main's clusteredPairedDelta (src/runner/stats/paired.ts, imported, not copied) against two comparators, with the base-app map required |

## C1 frame-run record

The frame search and the file check ran once, from the commit below. Their results and the clone list stay sealed outside this repository; this record holds counts and digests only. The frame and file-check code is frozen at that commit, and any later change to it goes to the Captain before it lands.

- **Commit:** 5d4de8b5ee98b85eafd3cc9d25e0b9b6146446e7. Launched 2026-11-14 at 03:48:28 UTC and finished at 04:04:22 UTC in one sitting; run.json records the search start and end times.
- **Earlier launches:** two, at 92dbb3b4b540d62da45d9e7dd28a6d0ee4542a52 (03:30:36 and 03:32:55 UTC). Each asked for 100 results in one request, died on its first request with HTTP 502 and kept no data. Neither counts as the dated run; run.json lists both as "failed, no data".
- **Search:** 50 searches as 119 cursor page requests of up to 25 results (none from cache), 119 points. Each search reads its first 100 results; one (dashboard, bsd-3-clause) took a fifth request because GitHub returned a short page before the 100th result. The terms paragraph names 50 search pages, so the results post lists the paging the Captain ruled on 2026-11-14 as a pre-data deviation.
- **Results:** 2,392 returned, 2,230 distinct repositories.
- **Entry filters, repositories left after each:** public 2,230, not a fork 2,230, not archived 2,105, not a template 2,057, stars 623, pushed 426, licence 426, language 154, topic words 140, readme title 139.
- **Frame:** 139 in frame order, 131 after the one-per-owner rule (the frame size).
- **Clones:** 77 attempts (limit 100), 77 fetched at their recorded commit, 0 unfetchable. The walk stopped at 30 file-check passes, the most that can get a recipe session.
- **File check:** test 1 (front end) 62, test 2 (components) 55, test 3 (design system) 67, test 4 (routes) 37, all four 30.
- **Digests (sha256):** search.json 9f77a4992902f3c797cbdba973c0202b39c09c82ba1cf29f20a04007f93f947b; entry.json 7f4f3ef381e670470f60c7ef8e2a8f56b0663295ef577e2eb37c7a63d578a1a1; frame.json 1f819d650b72b1c6ef826dd307a32a1798597b354e14520a53bcbccbab8f5f89; clones.json 30f1aa87679b732eb7ac3367f30a2bc5ebfaaaaa2c0fbf4d8c604d41abd26a4a; filecheck.json 8d1c4189cf9998c38e25a910fcdec0e3acec52ac619ab22d9d07ee1ef8cee6fd; run.json 892a75506dde5c498aa859c16bafdab4381be8b5c1f06b34e3684a39e303f728.
- **Sealed archives (plaintext sha256):** results 32b118cf77b0c61868980fe33440f0bb51c1f001624eec215136c4eeed3d622a; the 30 passing clones 4b8fc47cff59a51db904f930f553c1494f9be34de7464dea57feeae4b42fc4fb.
- **Recipe sessions; qualified under the strict and the HTTP 200 reading:** not run yet.

Nodes returned per search (topic by licence):

| Topic | mit | apache-2.0 | bsd-3-clause | bsd-2-clause | isc |
|---|---|---|---|---|---|
| admin-dashboard | 100 | 100 | 11 | 1 | 3 |
| admin-panel | 100 | 100 | 10 | 3 | 1 |
| dashboard | 100 | 100 | 100 | 33 | 34 |
| crm | 100 | 100 | 13 | 3 | 2 |
| helpdesk | 100 | 45 | 5 | 3 | 0 |
| inventory-management | 100 | 100 | 9 | 2 | 5 |
| project-management | 100 | 100 | 20 | 1 | 13 |
| booking-system | 100 | 31 | 3 | 1 | 4 |
| invoicing | 100 | 62 | 1 | 1 | 3 |
| self-hosted | 100 | 100 | 100 | 100 | 69 |
