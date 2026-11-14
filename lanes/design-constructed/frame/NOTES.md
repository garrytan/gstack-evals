# Frame area notes

For the integrator, who merges these rows into the lane README. The frame area covers plan section 8's search, entry
filters and file check, addendum R2-1 and R2-19, and the Captain's A1 and C1 rulings. Recipe sessions, qualification
and draw positions are not built here; the `recipes` command row still says "not built yet".

## Files

| File | What it holds |
|---|---|
| gh.ts | the paced gh client with the GitHub egress allowlist (copied, see below) |
| git.ts | hardened git and `fetchAt`, the fetch of one commit by oid at depth 1 (copied, see below) |
| search.ts | the pure query builder, the 50 queries and the cached search run |
| filters.ts | the entry filters, the README title reading, the frame order and the owner dedupe |
| tree.ts | the clone listing (no .git, no node_modules, no symlinks) and package.json reading |
| routes.ts | route discovery per router and R2-19's matcher, exported for the recipes area |
| filecheck.ts | the file check's four tests |
| run.ts | `runFrame`, its seams (`FrameSeams`) and the real seams |
| command.ts | the `dc frame` and `dc filecheck` rows that cli.ts calls |
| fixtures.ts | invented search nodes, a fake gh on a fake clock and invented app trees |
| dryrun-cases.ts | the area's dry-run cases |

What the recipes area uses: `discoverRoutes(dir)` gives the route sets of a clone, `matchingRoutes(path, sets)` gives
the route keys a concrete recipe path matches (most specific first), and `routeKey` and `distinctRoutes` say when two
patterns name one route. PD-10's "three distinct routes the file check discovered" reads as three distinct route keys.

## Reuse

| Lane file | Source path | Commit | sha256 of the source file | What changed |
|---|---|---|---|---|
| frame/gh.ts | lanes/aftermath/gh.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | c41962dde4a98eaa8f6c390e541196d1129e3303e9a7a8b2c3ad7f5b68f1b225 | Trimmed to run, graphql, rateLimit and calls. graphql returns the whole reply and refuses any reply that carries an error (the source refused only a reply with no data), so a partial search page is never kept or cached. rateLimit also reads limit and used. codeload.github.com left the allowlist (the frame never downloads archives). Pacing applies between any two calls. The per-eval reason code, restMaybe, restText and pointsUsed went. Main has no copy of this file; main's lanes/product-value/author/gh.ts (sha256 746d7c81d1443e431ee39f4b62e244a3cdaba8dd80aba1588ec07719579609db) is the older version without the allowlist. |
| frame/git.ts | lanes/devex/mine/git.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | aaf5a18dbbb8600db5d8d5c852af64a818e21eac8c9fffc190c3caa2f054e0f1 | The allowed protocols are a parameter (HTTPS by default; tests pass file). GIT_NO_REPLACE_OBJECTS added. exportBase became fetchAt: it keeps .git so later exports can build from the pinned tree, checks HEAD is the oid, and leaves nothing behind on failure. unitDiff went. The caller asserts the GitHub URL. |
| (pattern only) | lanes/devex/mine/github.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 2bd953e0234dddf53014198e56c9c62f7e36a30b4f5c5182e50a3507e4f8d057 | Not copied. Its REST topic search is replaced by GraphQL repository search only, as plan section 2 says. |
| (not used) | lanes/devex/mine/pace.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 219e4389bf450e850917e3b13f07be8800de8d895f13fd4fda5f765e755296dc | Not copied. The frame spends about 50 points, so a fixed 3-second gap at concurrency 1 replaces the points-per-hour pace. |

## Build-time choices (BT)

- **BT-F1 Query.** One query text for all 50 searches, `$q` = `topic:<t> license:<l> sort:stars`, first 100, topics in
  frozen order and each topic's licences in frozen order. The README is read by four aliased `object(expression:
  "HEAD:<path>")` fields in the order README.md, readme.md, Readme.md, README; the first non-null text is the README.
- **BT-F2 Cache.** Each reply is cached at `<out>/search-cache/<sha256 of query and variables>.json`, written only after
  a reply with no error. A rerun reads the cache and spends nothing on a cached query.
- **BT-F3 Pacing and quota.** At least 3,000 ms between the starts of any two gh calls, rate_limit reads included.
  Transient errors (502, 503, 504, timeouts, secondary limits) get 3 tries, 5 s and 10 s apart. The frame never takes
  the GraphQL quota under 1,000 points; under it, it waits for the reset.
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
- **BT-F11 Relaunch.** A crashed run relaunched into the same out folder reuses cached replies and finished clones,
  never retries a clone that failed, retries one a crash interrupted, and refuses a launch from another commit. A
  finished run (run.json present) is refused: the frame runs once (C1).
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
  stdout prints counts, frame positions of unfetchable oids and sha256 digests only. `--out` must lie outside the
  repository, and a dirty tree is refused.

## Open for the integrator

1. **HTML in the README title (BT-F8).** Settled by the Captain on 2026-11-14: the first heading may be an HTML `<h1>`,
   and only visible text counts (BT-F8). Frame fixtures cover both cases.
2. **Repository-wide route count (BT-F15).** Settled by the Captain on 2026-11-14: the literal, repository-wide count.
3. **No reason code for a search or clone failure.** No E_DC_ code covers a GitHub or git failure in the frame, and the
   build adds none. A search reply with an error, or gh failing after its tries, throws a plain error and the command
   exits non-zero with a stack; the rerun resumes from the cache. If a code is wanted, it is a codes.ts change.
4. **Not checked live.** The query shape is checked against a recorded invented reply, not GitHub's schema, and no
   real clone ran (no network here). Before the dated run, the integrator should run one live query by hand and one
   `git ls-remote https://github.com/<public repo>` under the same isolated config (`GIT_CONFIG_GLOBAL=/dev/null`),
   because hardened git ignores any proxy rewrite in the global git config. The prereg says "1-point queries"; the
   run records each query's cost and prints the total but does not stop on a cost above 1.
5. **Shared-file edits.** cli.ts: the frame and filecheck rows now call frame/command.ts (the row edit this area owns,
   plus one import line). tests/dc/dryrun.test.ts: its "not built yet" check used the frame row, which is now built, so
   it checks the recipes row instead.
