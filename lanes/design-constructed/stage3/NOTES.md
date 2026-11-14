# Recipes and stage 3: build notes for the integrator

This folder and lanes/design-constructed/recipes/ hold the VM sandbox with its fail-closed audit, the recipe sessions and their qualification, and stage 3. The integrator merges the rows below into the lane README.

## Files

| Path | Holds |
|---|---|
| stage3/seams.ts | the injected seams: money (admit, settle, reconcile, cap stop, release), dc-hosts, the build agent, the build reader, stage 3 authoring and audit, the DES-4 judge, and CapStopSignal |
| stage3/sandbox.ts | the VM spec and its checks, specFor, the preamble, the mirror config, the audit's commands and parsers, sandboxed(), and UbicloudBackend |
| stage3/fake.ts | a simulated Ubicloud: the real UbicloudBackend on a fake fetch and a fake ssh, plus fake dc-hosts and a ledger stand-in |
| stage3/ubicloud-real.ts | the process and SSH runners, the SSH tunnel, realUbicloud and keyedUbicloud on the real fetch with the token read by name, and the controller host's mirrors |
| recipes/browser.ts | the BrowserSeam: the controller's Playwright over the VM's SSH tunnel to a headless Chromium inside the VM |
| stage3/build.ts | the six build arms, the build prompt, a build with its one retry, and the offline check run |
| stage3/units.ts | Sol's audit filter, the key-check and scenario counting rules, oracle builds, unit selection |
| stage3/measures.ts | measures 1 to 8, DES-4 and its instrument check, the paired readout, the KEEP flag |
| stage3/run.ts | the stage 3 controller and its printed readout |
| stage3/fixtures.ts | invented stage 3 fixtures for the tests and the dry run |
| stage3/dryrun-cases.ts | this area's dry-run cases |
| recipes/seams.ts | the frame's discovered routes and route matcher, candidates, the recipe agent, the browser |
| recipes/recipe.ts | the pinned recipe prompt and recipe.json's reader |
| recipes/qualify.ts | the in-page probe, both readings of "renders", route picking, the setup steps, a qualification run |
| recipes/sessions.ts | the recipe screen, the funnel and the supply rule |
| recipes/fixtures.ts | invented recipe fixtures and a stand-in route matcher |
| prompts/recipes/recipe.md | the recipe session prompt, sha256 bf0b6bb764ba35a2bfbc4a4e6b25781b7b0118add6b067e40133da2749a239c3 |

## Wiring

Integration passes the real pieces through these seams. Nothing here reads a key, calls a model or creates a VM by itself.

- UbicloudBackend takes the Ubicloud token from the paid run's launcher, plus fetch, an ssh runner, sleep and a clock. specFor reads UBI_OWNER from the environment by name.
- MoneySeam is the money area's ledger: one controller-held lease per item, sub-reservations admitted and settled by the controller. HostsSeam is dc-hosts at Ubicloud's list price read on the day.
- RouteMatcher and DiscoveredRoute come from the frame area (R2-19). recipes/fixtures.ts holds a stand-in for tests only.
- RecipeAgent and BuildAgent run Opus 5.5 in Claude Code inside the VM through the metering proxy.
- BrowserSeam is the controller's Playwright over the VM's SSH tunnel. Each load runs PAGE_PROBE_SCRIPT after the 10 second page-error window.
- BuildReader runs axe-core, overflow, target sizes, forced states with Astra's read, the key checks, the agent user and the diff read. Stage3Authoring is Opus writing and Sol auditing. PairwiseJudge is Astra and Argon. Each throws CapStopSignal on a refused admission with nothing in flight.
- opusBlock and oracleBlock are the score area's rendered blocks. baseAppOf is the unit-to-base-app map.
- cli.ts: the skeleton gives the "recipes" row to the frame area and its README places recipe sessions under frame/. This build puts them under recipes/ as the brief asked, so the integrator wires that row and the "stage3" row to runScreen, supply, selectUnits and runStage3.

## Reuse

| Source path | Commit | sha256 of the source file | What changed |
|---|---|---|---|
| lanes/devex/stage3/sandbox.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | b639a5c0611f1a853e4da25deb4618d66dade8f38b3b62deb7a1d78bdf0bd2e4 | named mirror endpoints with terms lines in place of one mirror; mirror config written before anything installs; a verified apt and unattended-upgrades step; the filter logs accepted and dropped connections apart; the audit reads the filter, the process list, the egress log, the written-file list and a key and drive-path scan, checks every command's exit and fails closed on empty or cut output (sentinels on each channel); dc-hosts admission per VM; UBI_OWNER from the environment; DcError codes; fetch, sleep and the clock injected |
| lanes/devex/stage3/fake.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 7e6837e622ec0639a7dc18842355502d722d094c858d1da16512af33d9b00de5 | now wraps the real UbicloudBackend with a fake fetch and ssh, so tests run the real backend's commands and parsing; fault injection per audit command |
| lanes/devex/stage3/readout.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 78d4325a16c01f8d2fe63b9b7297138f99082253d01c88d3f47677470469545e | pattern only, not copied: pairing by unit with a worse count, now on main's clusteredPairedDelta (src/runner/stats/paired.ts, imported, not copied) against two comparators, with the base-app map required |

## Build-time choices (BT)

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

## Open for the integrator

Each item has a default in the code. Each could move a count or a descriptive read, so it needs a ruling before a paid run.

1. A1 says "at most 30" bounds recipe sessions; prereg line 134 says "at most 30 candidates get a recipe session". The code counts candidates, so a J1 retry spends no slot. Counting sessions would end the screen earlier when retries happen.
2. Strict route pick: the controller loads the first three recipe paths that match three distinct discovered routes, and a failure on any of them fails the strict reading. It doesn't try other recipe routes. The HTTP 200 reading loads the first three distinct recipe paths.
3. Blocked connections (dropped by the filter) are recorded and printed but are not breaches. Only accepted egress outside the proxy and the named mirrors breaches. D counted every new connection anywhere else, dropped or not, as a breach, which would let any blocked fetch by an app or a build agent stop the screen or stage 3.
4. The scan leaves out /work (the app tree and its dependencies), where vendored docs carry example keys. A key written into /work/app is caught only through process arguments or recipe.json.
5. R2-2 names "a Playwright login script the controller runs". The code takes declarative login fields (route, username, password, three selectors) and the controller fills them with its own script, so no recipe-written code runs on the controller.
6. "At most one a base app" is read as at most one stage 3 unit per base app. A unit that fails to qualify doesn't use up its base app.
7. 2026-11-09 section 11 tried at most 24 units. The 2026-11-14 units bullet replaces that paragraph, so the code tries the whole comparison set in draw order.
8. Builds set CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 only, as D did. Review arms also set CLAUDE_CODE_DISABLE_1M_CONTEXT=1 (HARNESS.env); the prereg doesn't say which builds get.
9. Agent-user completion with a missing scenario: completed over scenarios with a result. The frozen text says "completed scenarios over 3".
10. When Sol's audit rejects a unit's fixtures, the reader gets no fixtures and forced-state reads for that unit are left to the reader to mark unavailable. Stage 3 qualification doesn't depend on the fixtures verdict.
11. The plan-alone arm gets the frozen build prompt with no block after it, so its prompt still says "A reviewer's notes on the plan follow".

## Shared files

None edited. Shared shapes used as they stand; the area's own types (BuildArm, BuildRecord, BuildReads, KeyCheck, Scenario, Recipe, PageLoad and the seams) live in stage3/ and recipes/.

## Verified outside the unit tests

- The audit's ps, find and scan commands were run against the real tools on the build machine, and their output parsed as expected: hits on a key and a drive path, an ERR line for a missing file, and the find rows with the end marker.
- PAGE_PROBE_SCRIPT was run in headless Chromium on invented pages (content, blank, hidden, login form, Next.js 404 text, a settings page with a password field). tests/dc/recipes/probe.test.ts repeats it when Chromium is installed and skips otherwise.

## Not verified

- nft: the build machine's kernel refused nft in a network namespace, so the filter rules and parseRuleset's reading of a real listing are untested.
- Ubicloud's VM API shape (kept from D), journalctl's kernel-log line format for nft log prefixes, the mirror config on the VM image, and docker run of recipe services.
- The real Playwright browser seam, login flow and storage state; the real reads (axe-core, overflow, forced states, agent user, DES-4 judges).

## Real seams (controller host build)

- **UbicloudBackend** now takes a name prefix and a size per create (dcctl- and dcwal- for the hosts), a private subnet every VM joins, attach, exists, address and privateAddress, and deletes a VM that fails partway through create. ExecOptions gains input (stdin). keyedUbicloud builds it with its own key and the real SSH runner; realUbicloud reads UBICLOUD_API_KEY by name and refuses without it.
- **The SSH runner** runs root commands through sudo -n and run-user commands through sudo -n -u run; exit 255 is SSH's own failure and 124 a command past its limit. The preamble now creates the run user when the image lacks one (Ubicloud's image has only ubi), before linger.
- **BrowserSeam** is playwrightBrowser in recipes/browser.ts: Chromium starts as the run user, detached, with DevTools on 127.0.0.1:9222 inside the VM; the controller connects over an SSH local forward. Each load counts uncaught page errors from the navigation's start to the end of the frozen 10 second window, then runs PAGE_PROBE_SCRIPT. close stops the browser by its pid file and removes its profile under /tmp/dc-browser before the audit lists written files.
- **Mirrors.** controllerMirrors(privateIp, terms) gives the four named entries on the controller host's private IPv4 (npm 4873, PyPI 3141, apt 3142, Docker Hub 5000), and mirrorSetup(privateIp) the servers behind them, bound to that address only: verdaccio 7.1.0, devpi-server 6.21.0, apt-cacher-ng and the distribution registry in proxy mode, the last two from Ubuntu noble.
- fake.ts gains an SSH hook (a local stand-in runs every command for real), API faults per method and call, and a 404 for a deleted VM.

Tests: tests/dc/recipes/browser.test.ts (local Chromium through the seam, skipped without Chromium), tests/dc/stage3/ssh.test.ts (a local sshd).

### Open for the integrator

12. **Chromium inside the sandbox VMs.** Nothing installs it yet, and egress allows only the proxy and the mirrors. Ubuntu noble's chromium is a snap. Options: copy Playwright's headless Chromium build into the VM over SSH and its libraries from the apt mirror, or a VM image that carries it. Either adds files the audit lists.
13. **Login success.** The login reads as signed in when the submit and the page load finish and no password field matching the recipe's selector is still visible. A different reading could change how many apps qualify.
14. **Page errors before load.** PD-10 says no uncaught page error within 10 seconds; the seam counts errors from the navigation's start through load plus 10 seconds.
15. **Mirrors are pinned by version, not digest.** The 2026-11-09 plan says the cache's configuration is pinned by digest. Docker's registry-mirrors may also need the http mirror listed as an insecure registry. The mirror servers' licences are not yet in NOTICE.md.
16. **Network.** Sandboxes reach the controller host's mirrors and proxy on its private IPv4 only when both sit on one private subnet; the subnet's id and its firewall are not set up by this code.

### Not verified (real seams)

The SSH runner, tunnel and pinned WAL key ran against a local sshd, and the browser seam against a local Chromium. Not run: Chromium inside a Ubicloud VM, the tunnel over Ubicloud's network, the mirror servers, and any live Ubicloud call.
