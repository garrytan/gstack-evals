# Part B: breadth units and the browser oracle

Notes for part B of the keyless build for the head-to-head preregistration
(wiki/plans/2026-11-15-geva-538-skill-pack-h2h-prereg/README.md, section 6). The post is the source of truth. This file
says what part B built, what ran for real, the readings it chose where the post leaves a detail open, and where it could
not follow the post as written. Nothing here makes a paid model call or reads a model key.

## What is built

Everything lives in lanes/outcome-skills/h2h/breadth/.

- b2.ts: the B2 miner. Reads github/advisory-database at a pinned commit, screens advisories, reads repository licences
  once by GraphQL, reads each fix's file list and writes the frozen B2 frame.
- b1.ts: the B1 miner. Searches TypeScript and JavaScript repositories once, probes each for a root real-browser runner,
  mines merged fix pull requests and writes the frozen repository list and B1 frame.
- frame.ts: shared miner helpers: the exclusion matcher, the licence rule, the windows, file classes, the GraphQL client
  with cost and rate-limit handling, and the bundle dir.
- recipes.ts: the frozen per-ecosystem recipes (pinned toolchain images by digest, lockfile installs, the browser layer
  for B1), the Dockerfile, and the test-command and report rules per runner.
- build.ts: builds one candidate's image at the fix's parent, on the local daemon or a builder host.
- store.ts: the image store by digest (a registry the eval controls, or docker save archives for carrying images) and
  assertStored, the refusal every oracle, session and scoring run calls first.
- parse.ts and parsers.py: the report parsers (JUnit, Playwright JUnit, TRX, go test -json, cargo test, Jest JSON,
  Vitest JSON). A unit's parser.py is parsers.py plus its format.
- discover.ts: the in-image discovery script (retry greps, Vitest projects through createVitest, vitest list,
  playwright --list, jest --listTests, cargo metadata) and its reader.
- browser.ts: the browser-engine check for B1.
- oracle-b.ts: from a frame row to an oracled unit: fetch the fix, build, read the statement, the told-mode screen,
  discovery, the runner choice and derived tests, the unit dir in sm-unit.v1 format, and the oracle (5 and 5 runs with
  the browser conditions for B1, 3 and 3 for B2).
- label.ts: the B1 browser-only label packet, the answer reader, the both-yes rule and agreement with Cohen's kappa.
- fallback.ts: section 6's B fallbacks: which rows enter each frame's order, and whether B1 is usable.
- chromium-wrapper.sh: the launcher wrapper that adds --no-sandbox and --disable-dev-shm-usage.
- commands.ts: `export const commands` with mine-b2, mine-b1, image-build, image-store, oracle-b, browser-check and
  label-packet. The h2h command table maps its rows here; part B did not edit src/cli.ts.

## What ran for real

**B2 miner.** Ran on 2026-11-15 against github/advisory-database at a91f5a514f4697f0303f547c9b50a12eb07fa70f (committed
2026-11-15T03:35:23Z), directories advisories/github-reviewed/2025 and 2026, then again over the same licence read and
file lists when the licence rule changed. Output: b2-frame.json and b2-licences.json in the post's bundle.

- 16,237 advisories read.
- Eligible in the primary window (2026-03-01 to 2026-10-31): 1,835 advisories in 586 repositories, 1,006 at 3 a
  repository. By ecosystem: npm 944, Go 504, Maven 285, crates.io 63, NuGet 39. Of these, 327 are pending the second
  licence read (294 NOASSERTION, 33 with no licence named).
- Eligible in the widened window only (2025-06-01 to 2026-02-28): 567 more (148 pending), 1,327 at 3 a repository with
  both windows.
- Drops by rule (primary, widened): ecosystem 3,814 and 1,158; no GitHub fix reference 2,612 and 642; no test file 741
  and 606; withdrawn 624 and 97 (68 more outside the windows); licence not permissive 436 and 155; excluded 401 and 78
  (all openclaw/*); source files over 6, 368 and 99; archived 66 and 43; fix unreadable 66 and 22; fix repositories not
  one, 30 and 39; source files 0, 20 and 19; licence not found 3 and 3; outside both windows 1,625.

**B1 miner.** Ran on 2026-11-15. The repository search (one query per language, no licence qualifier, 3 queries
after the star splits) returned 1,959 repositories and froze them as b1-repos.json. 1,669 were probed for a root
real-browser runner (the rest drop on licence or the exclusion list, so they were not probed), and 456 were kept, 89 of
them pending the second licence read. Repository drops: no root real-browser runner 1,213, licence not permissive 280,
excluded 10 (openclaw/* 3, garrytan/* 2, and one each for addyosmani/agent-skills, open-gsd/*, cursor/plugins,
DietrichGebert/ponytail and yc-software/*). The kept repositories' pull requests were read between 04:18 and 06:37 UTC
by resumable workers that cache one file per repository; b1-frame.json was then built from those caches with the
committed code.

- Eligible in the primary window: 1,600 merged fix pull requests in 131 repositories, 315 at 3 a repository. 196 are
  pending the second licence read.
- Eligible in the widened window only: 460 more (107 pending), 348 at 3 a repository with both windows, in 143
  repositories.
- Drops by rule (primary, widened): no closing issue 91,643 and 32,240; no browser-test file 29,606 and 10,657;
  closes more than one issue 1,323 and 635; source files over 6, 372 and 53; source files 0, 274 and 145; title without
  a fix word 41 and 13.
- 76 primary rows come from repositories whose only runners are Cypress or Puppeteer, which fail the browser-engine
  check by rule (below). Without them: 1,524 rows in 114 repositories, 279 at 3 a repository.
- B1 is usable at 32 units. The frame holds 315 at 3 a repository before any build, oracle, browser check or label, so
  how many survive those steps is unknown until they run on the eval's VM.
- An earlier search that put the licence keywords in the query (b1-repos.json v1, commit bf957be) found 367 kept
  repositories. It could not find repositories whose licence GitHub does not detect, so it was replaced before any
  frame was frozen from it.

**Oracle smoke runs.** Two small repositories served from a local git daemon went through the whole path in Docker
(tests/outcome-skills/h2h-oracle-docker.test.ts): recipe build, local registry store by digest, preparation from the
stored digest, discovery and derived tests, then the state machines oracle. The Go unit was kept over 3 base and 3
fixed runs. The Playwright unit passed the browser-engine check and was kept over 5 base and 5 fixed runs in the
hardened container with a 2 GB /dev/shm and the launcher wrapper (about 7 s a base run and 2 s a fixed run). The
oracle's smoke step used the state machines runtime (Claude Code 2.1.312) and found no egress.

## Readings this build chose

- Both windows are mined in one frozen run, and each row is tagged primary or widened. A fallback that widens only lets
  the draw read rows already tagged widened; nothing is searched again.
- Licences: a repository whose GraphQL licence is on prereg.json's list is kept; one with no licence named or
  NOASSERTION is kept with second_read_pending true and its raw spdxId, for section 5's second read, which part C's
  ordinary/licences.ts owns; any other licence drops. Pending repositories are mined like the rest.
- B2 fix reference: the advisory's first GitHub pull request reference, else its first commit reference. A pull request
  must be merged; its fix commit is the merge commit and the parent its first parent. Commit renames are paired by blob id.
- B2 file classes use the union of the languages of every affected ecosystem (npm ts, Go go, Maven java, crates.io
  rust, NuGet csharp) and the state machines' langs.ts lists. A test file is one langs.ts classifies as a test, so Rust
  in-source tests do not count as a test file.
- B2 problem statement: the advisory's summary, a blank line and its details, with fix references, commit, pull and
  compare URLs, and any 40-hex id or prefix of the fix commit or its parent removed; the told-mode screen reads that
  body, and the statement adds one attribution line under CC-BY-4.0.
- B1 search: one query per language (TypeScript, JavaScript) for repositories with more than 5,000 stars, pushed after
  2026-09-01, not archived, with no licence qualifier, star ranges split past 1,000 results. GitHub's licence qualifier
  cannot find a repository whose licence it does not detect, so the licence rule runs on the results. The runner probe
  reads the root package.json and root config files, and only for repositories not excluded or archived whose licence
  is listed or pending.
- B1 pull request rules: the title has the word fix, fixes, fixed or fixing; exactly one closing issue; at least one
  browser-test file by the frozen path rule (BROWSER_TEST in b1.ts, JavaScript or TypeScript files only); 1 to 6 non-test
  source files by the ts lists. The statement is the issue title, a blank line and its body. The frame keeps only its
  sha256 and length. At unit build the issue is read again and must match that sha256; an issue edited since the freeze
  drops (statement_changed_since_freeze).
- Report ids: JUnit ids are suite::classname::file::name, with a [project] prefix for Playwright. Vitest runs one report
  per project, named vitest-<hex of the project name>.json, because Vitest's JSON names no project. Cargo captures
  stderr too, because its Running lines go there.
- Tests are found by one base run (the fix's tests applied) and one fixed run in the stored image. Fail-to-pass passes
  fixed and not base; pass-to-pass passes both. The runners are tried in a frozen order, and the first that finds at
  least one of each is the unit's runner. The oracle then confirms the set over 5 and 5 (B1) or 3 and 3 (B2) runs.
- The Go and Cargo offline switches (GOPROXY=off, CARGO_NET_OFFLINE) are set after the install steps, so they bind the
  runs and not the dependency fetch.
- The oracle, discovery and sessions use registry-store refs only. The archive store is for carrying images between
  hosts and is loaded into a registry before any run.
- B1 is usable when its stage 2 gets at least 20 units, so its frame needs 32 usable units (20 plus 6 stage 1 units, 5
  reserves and stage 0). fallback.ts applies that floor before and after each fallback; part C's draw assigns positions.

## Where the post could not be followed as written

- The post's B2 free count (2,963 advisories in 775 repositories, 1,376 at 3 a repository, with about 55% passing the
  file screen in a sample) was an estimate before the exclusion list and the file screen. The frozen frame above is the
  count that binds: 1,006 at 3 a repository in the primary window, well above B2's share.
- Cypress and Puppeteer: the post lists them as B1 runners, but its browser evidence names only a Playwright project or
  browserName, the Karma or Web Test Runner browser string, and the Vitest provider with the project name. Cypress's and
  Puppeteer's reports name no engine, so their units fail the browser-engine check by rule (no_engine_in_report).
- Playwright's --list JSON does not carry each project's use block, so the check reads the project name from the report
  and takes Playwright's default engine (chromium) when the name names none. A Playwright project that runs only API
  tests would pass this check; the two-model label is the guard there.
- CSS, Vue and Svelte-only fixes drop in B1 as source_files_0, because the ts lists count only JavaScript and
  TypeScript as source.
- Web Test Runner's chromeLauncher needs CHROME_PATH, which the shared browser environment (types.ts BROWSER) does not
  set. Units that use it may fail discovery. The playwrightLauncher is unaffected. types.ts is shared, so part B left it.
- The MultiLang fallback rows: fallback.ts takes their count, but the step that picks which pinned MultiLang units pass
  the browser checks is not built, because those units carry the dataset's parsers, not part B's.
- Image builds are meant to run on a throwaway VM with no keys. buildImage takes a builder host (docker_host) for that,
  but this build ran no real repository's install scripts: the Docker tests serve small local repositories instead.

## Hooks into sibling lanes

Part B changed the state machines lane only through backward-compatible hooks. testrun.ts gained RunExtra (an optional
/dev/shm size, read-only bind mounts and env) and extraArgs; runArgs and runTests take an optional extra. oracle.ts
gained an optional extra on oneRun and oracleUnit. With no extra, the container arguments are unchanged
(tests/outcome-skills/h2h-hooks.test.ts). A B unit's unit.json sets source to h2h-b1 or h2h-b2, outside SmUnit's union;
no state machines code branches on those values outside its own convert command.

## Tests

- Keyless: h2h-parsers, h2h-miners, h2h-recipes, h2h-browser, h2h-label, h2h-fallback, h2h-gates (a good and a bad case
  for every gate, the 5 and 5 keep rule through the state machines judge, and one unit through every gate) and
  h2h-hooks.
- Docker (GSTACK_EVALS_DOCKER=1): h2h-breadth-docker (a local registry:2 store by digest, the browser conditions in a
  real container, and one Go candidate through build, store, discovery, derived tests and the unit dir) and
  h2h-oracle-docker (the Go and Playwright units through the oracle, above). The oracle test needs network for the npm,
  Playwright and runtime layers.

## Open items

- Real builds, the oracle and the label calls on mined candidates run later on the eval's VM under its ledger items.
- The second licence read for pending repositories (part C's classifier) runs at integration; until then pending rows
  stay in both frames, marked.
