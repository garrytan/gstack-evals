# $0 probes for the outcome-per-skill plan (section 10)

The four probes ran on 2026-11-02 on fresh Capy machines, with public-read network only, no model call and no key read. Each part gives the probe's result note and then the scripts that ran. The notes drop their install trailer and scratch-folder prefix; the scripts are as they ran.

## Mutation-tool fit

### Probe: mutation (mutation-testing tool fit per language)

Date 2026-11-02. Machine: 2 CPUs (nproc), Docker 29.9.2. No paid calls, no keys read.

#### Answer

Yes for all four languages. Each tool installed from a public registry, then ran with docker run --network none and finished in under 70 seconds with machine-readable output (go-mutesting prints text only). Diff restriction differs by tool:

- Rust, cargo-mutants: true changed-line restriction (--in-diff). Best fit.
- TypeScript, StrykerJS: true line restriction (--mutate file:start-end), fed from git diff -U0.
- Go, gremlins: true line restriction (--diff <ref>), but it made only 1 mutant on this commit and its verdict flipped between KILLED and TIMED OUT across runs. go-mutesting works at file (or function via --match) level only.
- Python, mutmut: no line or diff option. It mutates whole files; you then run a subset by mutant-name glob, which gives function-level restriction.

#### Repos and commits (all merged after 2026-07-01, source plus tests)

| Lang | Repo (licence) | Commit | Changed source lines |
|---|---|---|---|
| TS | remeda/remeda, packages/remeda (MIT), vitest 4.1.11 | 362dd05 (2026-10-28) | 31 ranges in 10 files (most are type overloads and docs) |
| Python | more-itertools/more-itertools (MIT) | fbd5513 (2026-10-26) | more.py:4630-4634 (chunked_even) |
| Go | spf13/pflag (BSD-3-Clause) | 7d0f377 (2026-10-25) | count.go:20-24 |
| Rust | uuid-rs/uuid (Apache-2.0 OR MIT) | 285967d (2026-09-16) | 11 ranges in src/error.rs, src/parser.rs |

#### Raw results (offline runs)

| Lang | Tool, version, licence | Install ok | Offline ok | Restriction | Mutants | Killed | Survived | Timeout | Other | Wall s | Output |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TS | @stryker-mutator/core 10.1.1 + vitest-runner, Apache-2.0 | yes (33 s) | yes (2nd try) | lines | 4 | 4 | 0 | 0 | 0 errors | 13 | mutation-testing-report-schema JSON |
| TS subset demo | same | | yes | 2 whole files, only the commit's 2 test files | 69 | 53 | 12 | 4 | 0 errors | 8 | same |
| Python | mutmut 3.8.1, BSD-3-Clause | yes (15 s) | yes (2nd try) | function (glob x_chunked_even*); 4446 generated for the package, 87 run | 87 | 81 | 6 | 0 | 0 | 66 | export-cicd-stats JSON, results text |
| Go | gremlins v0.6.0, Apache-2.0 | yes (71 s, both Go tools) | yes | lines (--diff HEAD~1) | 1 | 1 in 2 of 4 runs | 0 | 1 in 2 of 4 runs | 413 skipped (outside diff) | 2 to 15 | JSON (--output) |
| Go | go-mutesting (avito-tech, v0.0.0-20261002081621-9ce5f731e321), MIT | yes | yes | file (count.go) | 24 | 15 | 9 | 0 | 0 | about 14 | text score line, optional HTML |
| Rust | cargo-mutants 27.1.0, MIT | yes (130 s, compiled from source) | yes | lines (--in-diff) | 28 | 26 | 1 | 0 | 1 unviable | 41 | mutants.out/outcomes.json |

No run came near the 15-minute cap or 200 mutants, so no sampling was needed. Caps available at scale: cargo-mutants --shard k/n and --timeout; Stryker has no mutant-count cap, so cap by line ranges and timeoutMS; mutmut by mutant-name glob; gremlins by --diff and --exclude-files. Licences came from npm package.json, Python package metadata (License-Expression), the LICENSE file in the Go module cache, and cargo-mutants' Cargo.toml.

First-try failures, both config mistakes on my side: Stryker rejected --vitest.configFile on the CLI (it must go in stryker.config.json); mutmut with paths_to_mutate pointing at one file failed test collection (see notes).

#### Exact commands

Scripts are in s/ (ts.sh, py.sh, go.sh, go2.sh, ts2.sh, rs.sh) and ranges.py (turns git diff -U0 C^ C into file:start-end for non-test files). Each language ran twice: docker run --rm -v repo:/w -v out/<lang>:/out -v s:/s <image> bash /s/<lang>.sh install, with network; then the same with --network none and "run", under timeout 900. Images: node:26 (remeda's .nvmrc), python:3.12, golang:1.27, rust:1. Logs are in out/<lang>/.

- TS: npx stryker run --mutate "$(cat /out/mutate.txt)" with stryker.config.json {"testRunner":"vitest","vitest":{"configFile":"vitest.stryker.config.ts"},"reporters":["json","clear-text","progress"],"concurrency":2}; the vitest config keeps only runtime tests (src/**/*.test.ts).
- Python: pyproject [tool.mutmut] paths_to_mutate=["more_itertools/"], pytest_add_cli_args_test_selection=["tests/test_more.py"], max_children=2; mutmut run "more_itertools.more.x_chunked_even*"; mutmut export-cicd-stats.
- Go: GOPROXY=off GOTOOLCHAIN=local gremlins unleash --diff HEAD~1 --workers 2 --output /out/gremlins.json . (also with --timeout-coefficient 10); go-mutesting ./count.go.
- Rust: CARGO_NET_OFFLINE=true cargo mutants --in-diff /out/diff.patch --jobs 2 --output /out --timeout 120.

#### Reading

cargo-mutants and Stryker do what the plan needs out of the box: changed-line restriction, offline runs, JSON output, short runtimes. The TS commit gave only 4 mutants because most changed lines were type overloads, comments and bare returns, so that run proves the plumbing, not the scale. The whole-file subset run (69 mutants, 8 s) shows the scale.

mutmut works but is coarser: the harness would map diff hunks to enclosing function names and pass them as globs. It also generates mutants for every file under paths_to_mutate (4446 here, about 9 s) even though only 87 ran.

gremlins restricts by line but has a small default mutator set (1 mutant on 5 changed lines here, where go-mutesting found 24 in the file) and a flaky timeout classification even at --timeout-coefficient 10. go-mutesting is steadier but file-level and text-only, so the harness would parse its score line or wrap tests with --exec.

#### Running only the agent's new tests

- Stryker: yes. Point the vitest (or jest) runner at a config whose include lists only the new test files. Shown above.
- mutmut: yes, via pytest_add_cli_args_test_selection (used above to limit to tests/test_more.py).
- cargo-mutants: yes per its docs, through extra cargo test arguments after -- (test-name filters) or nextest filters. Not run here.
- gremlins: no test-selection flag in unleash --help (only --tags and --integration); a subset needs build tags or a filtered package.
- go-mutesting: yes, through --exec with a custom test command. Not run here.

#### Sealed-container notes

- Go needs GOPROXY=off, GOTOOLCHAIN=local and git config --global --add safe.directory /w (gremlins reads git for --diff). Keep GOPATH and GOCACHE outside the repo: with caches inside it, gremlins walked them and listed 419,643 skipped mutants.
- mutmut writes a mutants/ copy into the repo. With paths_to_mutate set to the single file more.py, the copy had no __init__.py, more_itertools became a namespace package and collection failed; pointing it at the package directory fixed it. It warns that paths_to_mutate is deprecated in favour of source_paths.
- Stryker writes reports/ and a sandbox; I turned npm's update notifier off. No dashboard reporter is on by default. All offline runs exited 0, so no tool needed the network.
- Containers ran as root, so outputs on bind mounts were root-owned; use --user in the harness.
- cargo-mutants compiles from source (130 s on 2 CPUs); prebuild it into the image.

#### Limits

One commit per language and one run each (gremlins four runs). Wall times are single samples on 2 CPUs. I did not run a test-subset mode for Rust or Go, and for Python only file-level test selection. I did not try cosmic-ray because mutmut could restrict to files. Install times include dependency downloads.

**mutation/s/rs.sh**

````bash
set -e; cd /w; export CARGO_HOME=/w/.cargo-home CARGO_TARGET_DIR=/w/target PATH=/w/.cargo-home/bin:$PATH
if [ "$1" = install ]; then
  cargo install --locked cargo-mutants; cargo mutants --version; cargo fetch; cargo test --no-run -q 2>&1 | tail -3; exit 0
fi
export CARGO_NET_OFFLINE=true
cargo mutants --in-diff /out/diff.patch --jobs 2 --output /out --timeout 120 --no-shuffle 2>&1 | tail -60
````

**mutation/s/ts.sh**

````bash
set -e; export npm_config_cache=/w/.npm-cache npm_config_update_notifier=false
cd /w
if [ "$1" = install ]; then
  npm ci --workspace packages/remeda --include-workspace-root --ignore-scripts --no-audit --no-fund
  npm i -D -w packages/remeda --ignore-scripts --no-audit --no-fund @stryker-mutator/core @stryker-mutator/vitest-runner
  cd packages/remeda; npx stryker --version; npm ls @stryker-mutator/core @stryker-mutator/vitest-runner vitest 2>/dev/null | tail -5
  node -e 'for (const p of ["@stryker-mutator/core","@stryker-mutator/vitest-runner","mutmut"]) { try { console.log(p, require("/w/node_modules/"+p+"/package.json").license) } catch(e){} }'
  exit 0
fi
cd packages/remeda
cat > vitest.stryker.config.ts <<'C'
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";
export default defineConfig({ plugins: [tsconfigPaths()], test: { include: ["src/**/*.test.ts"] } });
C
echo '{"testRunner":"vitest","vitest":{"configFile":"vitest.stryker.config.ts"},"reporters":["json","clear-text","progress"],"concurrency":2,"tempDirName":"/tmp/stryker-tmp"}' > stryker.config.json
npx stryker run --mutate "$(cat /out/mutate.txt)"
cp reports/mutation/mutation.json /out/ || true
````

**mutation/s/ts2.sh**

````bash
cd /w/packages/remeda
cat > vitest.subset.config.ts <<'C'
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";
export default defineConfig({ plugins: [tsconfigPaths()], test: { include: ["src/dropFirstBy.test.ts","src/internal/heap.test.ts"] } });
C
echo '{"testRunner":"vitest","vitest":{"configFile":"vitest.subset.config.ts"},"reporters":["json","clear-text"],"concurrency":2,"tempDirName":"/tmp/stryker-tmp","jsonReporter":{"fileName":"/out/subset.json"}}' > stryker.subset.json
npx stryker run stryker.subset.json --mutate "src/dropFirstBy.ts,src/internal/heap.ts" 2>&1 | grep -E 'All files|dropFirstBy|heap|Done|ERROR|instrumented'
````

**mutation/s/py.sh**

````bash
set -e; cd /w; export PIP_CACHE_DIR=/w/.pip-cache PIP_DISABLE_PIP_VERSION_CHECK=1
if [ "$1" = install ]; then
  python -m venv /w/.venv && . /w/.venv/bin/activate && pip install -q -e . pytest mutmut && pip show mutmut | grep -E '^(Version|License)'; python -c "import importlib.metadata as m;print(m.metadata('mutmut').get('License-Expression') or m.metadata('mutmut').get('License'))"; exit 0
fi
. /w/.venv/bin/activate
grep -q tool.mutmut pyproject.toml || cat >> pyproject.toml <<'C'

[tool.mutmut]
paths_to_mutate = ["more_itertools/"]
pytest_add_cli_args_test_selection = ["tests/test_more.py"]
max_children = 2
C
mutmut run "more_itertools.more.x_chunked_even*" || echo "mutmut exit $?"
mutmut results --all true > /out/results.txt 2>&1 || mutmut results > /out/results.txt 2>&1 || true
mutmut export-cicd-stats >/dev/null 2>&1 && cp mutants/mutmut-cicd-stats.json /out/ || true
````

**mutation/s/go.sh**

````bash
set -e; cd /w; export GOPATH=/out/.gopath GOMODCACHE=/out/.gopath/pkg/mod GOCACHE=/out/.gocache GOTOOLCHAIN=local GOFLAGS=-buildvcs=false PATH=/out/.gopath/bin:$PATH
if [ "$1" = install ]; then
  go version; go install github.com/go-gremlins/gremlins/cmd/gremlins@latest; go install github.com/avito-tech/go-mutesting/cmd/go-mutesting@latest || echo go-mutesting-install-failed
  go mod download; go test ./... >/dev/null && echo tests-ok; ls $GOMODCACHE/github.com/; exit 0
fi
export GOPROXY=off GOSUMDB=off
git config --global --add safe.directory /w
gremlins --version || true
gremlins unleash --help > /out/gremlins-help.txt 2>&1 || true
gremlins unleash --diff HEAD~1 --workers 2 --output /out/gremlins.json . 2>&1 | tail -60
echo "== go-mutesting on count.go"
go-mutesting --help > /out/go-mutesting-help.txt 2>&1 || true
go-mutesting ./count.go 2>&1 | tail -15
````

**mutation/s/go2.sh**

````bash
cd /w; export GOPATH=/out/.gopath GOMODCACHE=/out/.gopath/pkg/mod GOCACHE=/out/.gocache GOTOOLCHAIN=local GOPROXY=off GOFLAGS=-buildvcs=false PATH=/out/.gopath/bin:$PATH
git config --global --add safe.directory /w
for i in 1 2; do gremlins unleash --diff HEAD~1 --workers 2 --timeout-coefficient 10 --output /out/gremlins-tc10-$i.json . 2>&1 | grep -E 'count.go|Killed|Timed'; done
````

## Browser agent-user driver

### Probe: browser (agent-user driver and docs-only harness)

Folder: probes/browser/. No model call of any kind. Nothing committed or pushed.

#### Part A: browser driver

**Setup.** Playwright 1.64.1 (npm, licence Apache-2.0), Chrome Headless Shell 156.0.8078.4, on the host (Node 24.22.1). App: TodoMVC javascript-es5 prebuilt `dist/` from tastejs/todomvc at ff43b02e (MIT), served by `python3 -m http.server 8765 --bind 127.0.0.1` from `site/`. No build step was needed.

**Network block.** Two layers in `driver.ts`: a context route that aborts any request whose host is not localhost or 127.0.0.1, and a Chromium `--proxy-server=http://127.0.0.1:9` (a dead proxy; Chromium bypasses loopback by default). `node netblock.ts` printed:

| test | result |
|---|---|
| goto localhost app | ok "TodoMVC: JavaScript Es5" |
| goto https://example.com (both layers) | blocked: net::ERR_BLOCKED_BY_CLIENT |
| in-page fetch https://registry.npmjs.org/ | blocked: TypeError: Failed to fetch |
| proxy layer alone, https://example.com | blocked: net::ERR_PROXY_CONNECTION_FAILED |
| proxy layer alone, localhost | ok |
| control, no block, https://example.com | loaded "Example Domain" |

**Driver** (`driver.ts`, about 110 lines). Actions: observe, click, type (fill), press key, back. Targets are role plus accessible name, optional nth, optional "inside the list item whose text is X". Each step writes one JSON line: scenario, step, action, target, text or key, note, result (ok or error), error text, url_before, url_after, state_hash (sha256 of URL plus `locator('body').ariaSnapshot()`, 16 hex), dead_end (state hash first seen two or more steps earlier), console_errors new this step, aria_chars, aria_tokens_est (chars/4), shot_px, shot_bytes. Each step also saves the aria YAML and a PNG under `out/shots/<run>/`. Action timeout is 1.5 s.

**Degraded copy** (`site/dist-degraded/`): two edits to index.html. The input loses its placeholder, so its accessible name is gone, and a style rule `.clear-completed{display:none !important}` removes the Clear completed button.

**Fixed scripted policy** (`run.ts`). Add a todo: type into textbox "What needs to be done?"; on error, type into the first textbox; press Enter. Complete: click the checkbox in the list item with that text. Clear completed: click button "Clear completed"; on error, click link "Completed", retry the button, then go back and give up. Success is checked from the DOM after the run (item and completed counts).

**Results** (`node run.ts`, out/summary.json; actions exclude the initial observe):

| run | success | actions | errors | dead ends | console errors | aria chars min-max | aria tokens mean (est) | screenshot | PNG KB mean |
|---|---|---|---|---|---|---|---|---|---|
| normal.add3_complete1 | yes | 7 | 0 | 0 | 0 | 483-970 | 197 | 1280x720 | 32 |
| normal.clear_completed | yes | 6 | 0 | 0 | 1 | 483-913 | 187 | 1280x720 | 31 |
| degraded.add3_complete1 | yes | 10 | 3 | 0 | 1 | 458-918 | 186 | 1280x720 | 29 |
| degraded.clear_completed | no | 11 | 4 | 1 | 1 | 458-861 | 184 | 1280x720 | 28 |

The one console error per affected run is "Failed to load resource: 404" on the first load; `/favicon.ico` returns 404 on this server, so it is most likely the favicon (I did not log the URL). Requests blocked during scenarios: 0 (the app makes no outside requests).

Degraded clear_completed, abridged log: step 9 click "Clear completed" error (timeout); step 10 click link "Completed" ok, URL to `#/completed`; step 11 retry error; step 12 back ok, URL back to `/dist-degraded/`, dead_end true, first seen at step 8. Each missing input name costs one error step plus one fallback step, so add-three went from 7 to 10 actions.

**One driver fix found in the probe.** The first run flagged no dead end, because after a click the mouse hovered a list item and the hover-only "×" delete button entered the snapshot, so states that look the same had different hashes. Moving the mouse to (0,0) before each observation fixed it. A real harness needs that rule, or a hash that drops hover-only nodes.

**Token estimate for an LLM agent user (estimate, not measured on a model).** Aria snapshot here is 115 to 243 tokens by chars/4. A 1280x720 screenshot is about 1,229 tokens by Anthropic's published (width x height)/750 rule. So one observation is about 1,475 tokens with a screenshot or about 245 text-only, before the system prompt, task text, action schema and model output, which I did not measure. For a 20-step scenario: about 29.5k observation tokens if each step sees only the latest observation, or about 310k if every past observation stays in context (text-only: about 4.9k and 51k). TodoMVC is tiny; a real built UI will have larger snapshots, so measure on the target apps before pricing.

**gstack browse.** Not used and not needed. The driver depends only on Playwright.

#### Part B: docs-only harness

**Pick.** junegunn/fzf (MIT). Feature commit 99bfd5aa0f66133d7dcfbf18f8044eb765f04649, "Add change-info-command and transform variants" (Close #4951), committed 2026-11-02, on master. It adds user-facing `--bind` actions and changes CHANGELOG.md (3 lines mention it) and man/man1/fzf.1 (+2 lines). README.md and `--help` do not mention it. Parent: 26ff936df038b6a62ec42cf18db27b2ea2bb8ec3.

**Build** (go 1.27.2, deps from proxy.golang.org):
```
git clone https://github.com/junegunn/fzf.git && cd fzf
for c in 99bfd5aa 26ff936d; do git worktree add ../wt-$c $c; (cd ../wt-$c && CGO_ENABLED=0 go build -o ../bin-$c/fzf .); done
```
Bundle per commit: `fzf` (static, about 8.06 MB), `docs/README.md`, `docs/CHANGELOG.md`, `docs/fzf.1`, `docs/help.txt` (`fzf --help`).

**Container.** debian:stable-slim (sha256:13e0a2e7...), `docker run --rm --network none --read-only --tmpfs /tmp -v bundle-$c:/opt/app:ro -v check.sh:/check.sh:ro debian:stable-slim sh /check.sh`. `partb/check.sh` lists the bundle, counts .go and go.mod files on the filesystem, checks the network, greps the docs, then runs fzf in a pty (`script`, `stty rows 24 cols 80`) with `--info-command 'echo BASE_INFO' --bind 'start:change-info-command(echo FEATURE_OK)' --bind 'load:transform:sleep 1; echo accept'`. First success means exit 0 and FEATURE_OK drawn on screen (outside an error line). A control run without the new action must draw BASE_INFO.

| | feature 99bfd5aa | parent 26ff936d |
|---|---|---|
| files in /opt/app | fzf + 4 docs | fzf + 4 docs |
| .go / go.mod files on fs | 0 | 0 |
| network | lo only, no DNS | lo only, no DNS |
| docs mentions (CHANGELOG, fzf.1, help) | 3, 1, 0 | 0, 0, 0 |
| control (BASE_INFO drawn) | exit 0, drawn | exit 0, drawn |
| feature run | exit 0, FEATURE_OK drawn | exit 2, "unknown action: change-info-command(...)" |
| FIRST_SUCCESS | yes | no |

#### Limits

- Part A ran Chromium on the host, not in a container; the block is the route plus the dead proxy, shown by test, not a kernel network rule. Wrapping the same driver in a `--network none` container with the app inside should work but I did not run it.
- The scripted policy is fixed and narrow. It shows that the log separates errors, extra steps, dead ends and failure, not how an LLM agent would behave.
- Dead-end detection needs hover-stable state; the hash rule above is one probe's fix.
- Token numbers are estimates (chars/4, a published image rule), not model counts.
- Part B's first-success check needs a pty and a sleep-based accept; it ran once per commit. A "fresh agent from docs alone" was not run (no model).
- Part B's docs for this feature live in CHANGELOG and the man page, not README; a docs-only agent would need those in its bundle.
- The check's early version counted FEATURE_OK inside the parent's error message; the exit code still decided correctly, and the final check filters error lines.

**browser/driver.ts**

````ts
import { chromium } from "playwright";
import type { Page, Locator } from "playwright";
import { createHash } from "node:crypto";
import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";

export type Target = { role: string; name?: string; nth?: number; inItem?: string };
export type Action =
  | { kind: "observe" }
  | { kind: "click"; target: Target }
  | { kind: "type"; target: Target; text: string }
  | { kind: "press"; target: Target; key: string }
  | { kind: "back" };

const ALLOWED = new Set(["localhost", "127.0.0.1"]);

export async function openBrowser() {
  const browser = await chromium.launch({
    args: ["--proxy-server=http://127.0.0.1:9"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const blocked: string[] = [];
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (ALLOWED.has(u.hostname)) return route.continue();
    blocked.push(route.request().url());
    return route.abort("blockedbyclient");
  });
  return { browser, context, blocked };
}

export class Driver {
  step = 0;
  seen = new Map<string, number>();
  consoleErrors: string[] = [];
  page: Page;
  logPath: string;
  shotDir: string;
  constructor(page: Page, logPath: string, shotDir: string) {
    this.page = page; this.logPath = logPath; this.shotDir = shotDir;
    page.on("console", (m) => { if (m.type() === "error") this.consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => this.consoleErrors.push(String(e)));
    mkdirSync(shotDir, { recursive: true });
    writeFileSync(logPath, "");
  }

  locate(t: Target): Locator {
    const scope = t.inItem ? this.page.getByRole("listitem").filter({ hasText: t.inItem }) : this.page;
    const loc = scope.getByRole(t.role as any, t.name === undefined ? {} : { name: t.name, exact: true });
    return t.nth === undefined ? loc : loc.nth(t.nth);
  }

  async observe() {
    await this.page.mouse.move(0, 0);
    const aria = await this.page.locator("body").ariaSnapshot();
    writeFileSync(`${this.shotDir}/step${String(this.step).padStart(3, "0")}.aria.yml`, aria);
    const png = await this.page.screenshot({ path: `${this.shotDir}/step${String(this.step).padStart(3, "0")}.png` });
    const vp = this.page.viewportSize()!;
    return {
      url: this.page.url(),
      hash: createHash("sha256").update(this.page.url() + "\n" + aria).digest("hex").slice(0, 16),
      aria_chars: aria.length,
      aria_tokens_est: Math.ceil(aria.length / 4),
      shot_px: `${vp.width}x${vp.height}`,
      shot_bytes: png.length,
    };
  }

  async act(a: Action, scenario: string, note = "") {
    this.step++;
    const urlBefore = this.page.url();
    const errBefore = this.consoleErrors.length;
    let result = "ok";
    let error: string | undefined;
    try {
      if (a.kind === "click") await this.locate(a.target).click({ timeout: 1500 });
      else if (a.kind === "type") await this.locate(a.target).fill(a.text, { timeout: 1500 });
      else if (a.kind === "press") await this.locate(a.target).press(a.key, { timeout: 1500 });
      else if (a.kind === "back") await this.page.goBack({ timeout: 1500 });
    } catch (e) {
      result = "error";
      error = String((e as Error).message).split("\n")[0];
    }
    const obs = await this.observe();
    const firstSeen = this.seen.get(obs.hash);
    const deadEnd = firstSeen !== undefined && this.step - firstSeen >= 2;
    if (firstSeen === undefined) this.seen.set(obs.hash, this.step);
    const line = {
      scenario, step: this.step, action: a.kind,
      target: "target" in a ? a.target : null,
      text: "text" in a ? a.text : "key" in a ? a.key : undefined,
      note: note || undefined,
      result, error,
      url_before: urlBefore, url_after: obs.url,
      state_hash: obs.hash, dead_end: deadEnd, dead_end_first_seen: deadEnd ? firstSeen : undefined,
      console_errors: this.consoleErrors.slice(errBefore),
      aria_chars: obs.aria_chars, aria_tokens_est: obs.aria_tokens_est,
      shot_px: obs.shot_px, shot_bytes: obs.shot_bytes,
    };
    appendFileSync(this.logPath, JSON.stringify(line) + "\n");
    return line;
  }
}
````

**browser/netblock.ts**

````ts
import { openBrowser } from "./driver.ts";
import { chromium } from "playwright";

const out: Record<string, string> = {};
const { browser, context, blocked } = await openBrowser();
const page = await context.newPage();
await page.goto("http://127.0.0.1:8765/dist/");
out.localhost_goto = "ok " + (await page.title());
try { await page.goto("https://example.com", { timeout: 8000 }); out.external_goto = "LOADED (block failed)"; }
catch (e) { out.external_goto = "blocked: " + String((e as Error).message).split("\n")[0]; }
const pageB = await context.newPage();
await pageB.goto("http://127.0.0.1:8765/dist/");
out.in_page_fetch = await pageB.evaluate(async () => {
  try { const r = await fetch("https://registry.npmjs.org/"); return "LOADED " + r.status; }
  catch (e) { return "blocked: " + String(e); }
});
out.route_blocked_urls = blocked.join(" ");
await browser.close();

const b2 = await chromium.launch({ args: ["--proxy-server=http://127.0.0.1:9"] });
const p2 = await b2.newPage();
try { await p2.goto("https://example.com", { timeout: 8000 }); out.proxy_only_external = "LOADED (block failed)"; }
catch (e) { out.proxy_only_external = "blocked: " + String((e as Error).message).split("\n")[0]; }
const p2b = await b2.newPage();
await p2b.goto("http://127.0.0.1:8765/dist/");
out.proxy_only_localhost = "ok " + (await p2b.title());
await b2.close();

const b3 = await chromium.launch();
const p3 = await b3.newPage();
try { await p3.goto("https://example.com", { timeout: 15000 }); out.control_no_block_external = "loaded: " + (await p3.title()); }
catch (e) { out.control_no_block_external = "failed: " + String((e as Error).message).split("\n")[0]; }
await b3.close();
console.log(JSON.stringify(out, null, 2));
````

**browser/run.ts**

````ts
import { openBrowser, Driver } from "./driver.ts";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const variants: Record<string, string> = {
  normal: "http://127.0.0.1:8765/dist/",
  degraded: "http://127.0.0.1:8765/dist-degraded/",
};
const INPUT_NAMED = { role: "textbox", name: "What needs to be done?" };
const INPUT_ANY = { role: "textbox", nth: 0 };

async function addTodo(d: Driver, sc: string, text: string) {
  const r = await d.act({ kind: "type", target: INPUT_NAMED, text }, sc);
  const target = r.result === "ok" ? INPUT_NAMED : INPUT_ANY;
  if (r.result !== "ok") await d.act({ kind: "type", target, text }, sc, "fallback: first textbox");
  await d.act({ kind: "press", target, key: "Enter" }, sc);
}

async function clearCompleted(d: Driver, sc: string) {
  const r = await d.act({ kind: "click", target: { role: "button", name: "Clear completed" } }, sc);
  if (r.result === "ok") return;
  await d.act({ kind: "click", target: { role: "link", name: "Completed" } }, sc, "fallback: look under Completed filter");
  const r2 = await d.act({ kind: "click", target: { role: "button", name: "Clear completed" } }, sc, "retry");
  if (r2.result === "ok") return;
  await d.act({ kind: "back" }, sc, "give up, go back");
}

const scenarios: Record<string, (d: Driver, sc: string) => Promise<() => Promise<boolean>>> = {
  async add3_complete1(d, sc) {
    for (const t of ["Buy milk", "Walk dog", "Pay rent"]) await addTodo(d, sc, t);
    await d.act({ kind: "click", target: { role: "checkbox", inItem: "Walk dog" } }, sc);
    return async () =>
      (await d.page.locator(".todo-list li").count()) === 3 &&
      (await d.page.locator(".todo-list li.completed").count()) === 1;
  },
  async clear_completed(d, sc) {
    for (const t of ["Buy milk", "Walk dog"]) await addTodo(d, sc, t);
    await d.act({ kind: "click", target: { role: "checkbox", inItem: "Buy milk" } }, sc);
    await clearCompleted(d, sc);
    return async () => {
      await d.page.goto(d.page.url().split("#")[0] + "#/");
      return (await d.page.locator(".todo-list li").count()) === 1;
    };
  },
};

const summary: any[] = [];
for (const [variant, url] of Object.entries(variants)) {
  for (const [name, fn] of Object.entries(scenarios)) {
    const { browser, context, blocked } = await openBrowser();
    const page = await context.newPage();
    await page.goto(url);
    const tag = `${variant}.${name}`;
    const d = new Driver(page, `${OUT}${tag}.jsonl`, `${OUT}shots/${tag}`);
    await d.act({ kind: "observe" }, tag);
    const check = await fn(d, tag);
    const lines = readFileSync(`${OUT}${tag}.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const success = await check();
    summary.push({
      run: tag, success,
      actions: lines.length - 1,
      errors: lines.filter((l) => l.result === "error").length,
      dead_ends: lines.filter((l) => l.dead_end).length,
      console_errors: lines.reduce((s, l) => s + l.console_errors.length, 0),
      aria_chars_min: Math.min(...lines.map((l) => l.aria_chars)),
      aria_chars_max: Math.max(...lines.map((l) => l.aria_chars)),
      aria_tok_mean: Math.round(lines.reduce((s, l) => s + l.aria_tokens_est, 0) / lines.length),
      shot_px: lines[0].shot_px,
      shot_kb_mean: Math.round(lines.reduce((s, l) => s + l.shot_bytes, 0) / lines.length / 1024),
      blocked_reqs: blocked.length,
    });
    await browser.close();
  }
}
writeFileSync(`${OUT}summary.json`, JSON.stringify(summary, null, 2));
console.table(summary);
````

**browser/partb/check.sh**

````bash
#!/bin/sh
# Runs inside the container. /opt/app holds only the built binary and docs.
cd /tmp
echo "files_in_app: $(cd /opt/app && find . -type f | sort | tr '\n' ' ')"
echo "source_files_on_fs: $(find / -xdev \( -name '*.go' -o -name go.mod -o -name '*.rb' -path '*test*' \) 2>/dev/null | wc -l)"
echo "net: $(getent hosts github.com >/dev/null 2>&1 && echo resolves || echo no-dns); ifaces: $(ls /sys/class/net | tr '\n' ' ')"
echo "docs_mentions_change_info_command: $(grep -c 'change.*info.*command' /opt/app/docs/CHANGELOG.md /opt/app/docs/fzf.1 /opt/app/docs/help.txt | tr '\n' ' ')"
run() { (sleep 4) | TERM=xterm timeout 15 script -qec "stty rows 24 cols 80; seq 3 | /opt/app/fzf $1" /dev/null > /tmp/pty.txt 2>&1; echo $? ; }
c=$(run "--info-command 'echo BASE_INFO' --bind 'load:transform:sleep 1; echo accept'")
echo "control_base_info: exit=$c rendered=$(grep -c BASE_INFO /tmp/pty.txt)"
f=$(run "--info-command 'echo BASE_INFO' --bind 'start:change-info-command(echo FEATURE_OK)' --bind 'load:transform:sleep 1; echo accept'")
r=$(grep -av 'unknown action' /tmp/pty.txt | grep -c FEATURE_OK)
echo "feature: exit=$f rendered=$r err=$(grep -ao 'unknown action' /tmp/pty.txt | head -1)"
if [ "$f" = 0 ] && [ "$r" -ge 1 ]; then echo "FIRST_SUCCESS=yes"; else echo "FIRST_SUCCESS=no"; fi
````

## Pool yield: future bugs, follow-ups, UI and DX

### Probe: mining (future-bug and follow-up yield in post-cutoff feature changes)

Run 2026-11-02, git only, keyless, $0. Folder: probes/mining/

#### Method

- 18 repos picked; all 18 cloned with `git clone -q --filter=blob:none --shallow-since=2026-04-01 --single-branch https://github.com/<owner>/<repo>.git` (timeout 600). No clone failed.
- 16 finished the scan. TryGhost/Ghost and biomejs/biome were still in SZZ blame after about 50 minutes and I stopped them to stay inside the token cap; they have no numbers here.
- Licence: read the LICENSE/COPYING files at HEAD and matched the MIT, Apache-2.0 and BSD texts. All 16 measured repos are permissive (table column licence). Nothing dropped.
- Script: mine.py (per repo), aggregate.py (table). run_all.sh ran 4 repos at a time.
- History: `git log --first-parent --diff-merges=first-parent --name-only HEAD` (merges diffed against first parent, which differs from the earlier probe's plain diff-tree, which lists nothing for merges).
- SRC and TEST classification: the earlier probe's regexes, unchanged.
- Feature: first-parent commit with committer date 2026-07-01..2026-10-31, at least one SRC and one TEST file, subject not matching fix|bug|regress|crash|broke|revert|chore|docs|bump|release|deps (case-insensitive).
- Q1 (SZZ): fix = first-parent commit 2026-07-01..2026-11-02, subject matches fix|bug|regress|crash|broke, touches SRC and TEST. For each fix: `git diff -U0 F^1 F -- file` on its first 4 SRC files, at most 6 hunks with removed or changed lines, then `git blame --first-parent --porcelain -L a,+n F^1 -- file` (timeout 60 s). A feature counts when a blamed line points at it. --first-parent was added so merge-based repos blame to the merge on the default branch.
- Q2: first later first-parent commit within 60 days (and before 2026-11-03) whose subject matches neither revert nor the fix regex, that touches at least one of the feature's SRC files and at least one TEST file.
- Q3 UI: a non-test .tsx/.jsx/.vue/.svelte/.css/.scss/.html file under a path segment in apps?|ui|web|webapp|frontend|client|desktop-client|components|pages|views|routes|layouts|site|www|dashboard|admin. DX: a README* or docs?/ file AND a surface file (cli/, commands/, cmd/, index.(ts|tsx|js|mjs|cjs), __init__.py, lib.rs, an openapi/swagger path, or a *schema*.json/yaml/graphql). e2e: any HEAD path matching playwright.config.*, cypress.config.*, cypress.json or an e2e/ folder.

#### Raw output (16 repos)

| repo | licence | commits_window | features | fixes_scanned | q1 | q2 | ui | ui_q1 | ui_q2 | dx | dx_q1 | dx_q2 | e2e | median_q2_days |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| actualbudget/actual | MIT | 421 | 152 | 75 | 11 | 109 | 89 | 10 | 76 | 11 | 1 | 10 | True | 6.0 |
| astral-sh/ruff | MIT | 1925 | 154 | 49 | 7 | 119 | 0 | 0 | 0 | 27 | 1 | 27 | True | 3.9 |
| astral-sh/uv | Apache-2.0+MIT | 1828 | 436 | 40 | 9 | 400 | 0 | 0 | 0 | 29 | 1 | 28 | False | 1.1 |
| charmbracelet/gum | MIT | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | False | - |
| drizzle-team/drizzle-orm | Apache-2.0 | 9 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | False | - |
| excalidraw/excalidraw | MIT | 129 | 49 | 41 | 10 | 43 | 43 | 10 | 40 | 1 | 0 | 1 | False | 1.7 |
| fastapi/fastapi | MIT | 559 | 37 | 22 | 5 | 28 | 0 | 0 | 0 | 3 | 0 | 3 | False | 0.3 |
| gin-gonic/gin | MIT | 19 | 3 | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | False | 11.8 |
| honojs/hono | MIT | 196 | 23 | 93 | 1 | 7 | 0 | 0 | 0 | 5 | 0 | 1 | False | 4.4 |
| hoppscotch/hoppscotch | MIT | 51 | 6 | 8 | 0 | 5 | 4 | 0 | 4 | 2 | 0 | 2 | True | 3.8 |
| louislam/uptime-kuma | MIT | 124 | 9 | 13 | 0 | 8 | 7 | 0 | 7 | 0 | 0 | 0 | True | 3.2 |
| pydantic/pydantic | MIT | 323 | 97 | 33 | 3 | 76 | 0 | 0 | 0 | 9 | 0 | 7 | False | 6.6 |
| tokio-rs/axum | MIT | 77 | 7 | 2 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | False | 6.4 |
| trpc/trpc | MIT | 123 | 6 | 42 | 0 | 4 | 1 | 0 | 1 | 1 | 0 | 1 | True | 12.4 |
| usememos/memos | MIT | 349 | 95 | 95 | 37 | 89 | 71 | 31 | 67 | 35 | 16 | 34 | False | 1.5 |
| vitest-dev/vitest | MIT | 491 | 65 | 202 | 22 | 56 | 15 | 4 | 14 | 22 | 10 | 22 | True | 3.2 |
| TOTAL (16 repos) | | 6633 | 1140 | 720 | 105 | 947 | 230 | 55 | 209 | 145 | 29 | 136 | 6 with e2e | 2.1 |
blames 2111 timeouts 2
projection q1*0.038 per repo per 4 months: 3.99 total; per repo 0.249

Columns: q1 = feature commits with at least one SZZ link from a later fix; q2 = feature commits with a Q2 follow-up; ui_q1 etc. = UI- or DX-tagged features with that link. median_q2_days = median days from feature to its first follow-up.

#### Reading

- Q1 raw yield: 105 of 1,140 feature commits (9.2%) were later touched by a fix whose removed lines blame back to them. It is very uneven: usememos/memos 37, vitest 22, actual 11, excalidraw 10, uv 9, ruff 7; seven repos have 0 or 1.
- Projection only, not a measurement: the earlier execution check kept about 3.8% of SZZ-linked candidates (5 of 131) as real fail-to-pass regression tasks. 105 x 0.038 is about 4 usable future-bug tasks from 16 repos in four months, about 0.25 per repo; memos alone projects to about 1.4. Round 1's audit, where all six SZZ pairs failed because the fix reversed a design choice, suggests even this is high.
- Q2 is plentiful but loose: 947 of 1,140 features (83%) have a qualifying follow-up, median 2.1 days after. In active Rust and Python tools (uv 400 of 436, ruff 119 of 154) any later commit that touches a shared big file and any snapshot test qualifies, so this criterion mostly measures churn, not "the next change to that feature". It needs a tighter rule (same function or hunk region, or a shared issue) before it can carry an architecture measure.
- Q3: 230 UI-tagged features (55 with a Q1 link, 209 with Q2), nearly all from four web apps (actual, memos, excalidraw, vitest's UI). 145 DX-tagged features (29 Q1, 136 Q2), led by memos, uv, ruff, vitest. 6 of 16 repos match the e2e rule at HEAD (actual, ruff, hoppscotch, uptime-kuma, trpc, vitest), but only 4 have a playwright or cypress config file (actual 3, uptime-kuma 1, trpc 11 under examples/, vitest 1). ruff's e2e/ folder is language-server tests and hoppscotch's is CLI tests, so they are not browser tests. Ghost (unscanned) has 6 such configs at HEAD.

#### Limits

- Ghost and biome unmeasured (stopped for the token cap). Library/back-end group therefore has fastapi, pydantic, gin, axum, trpc, drizzle; web apps have excalidraw, hoppscotch, uptime-kuma, actual, memos (no Ghost); dev tools have uv, ruff, vitest, hono, gum (no biome).
- Some repos are quiet on the default branch in the window (gum 9 commits, drizzle 9; I did not check where drizzle's work lands), so they yield nothing.
- Subject filters are crude: a feature subject with a bug emoji but no word "fix" counts as a feature (one fastapi Q1 sample is "Distinguish JSON null from omitted body values"), and hono's merges of a "next" branch count as one big feature. Words like "prefix" match the fix regex.
- SZZ is the plain variant: no whitespace or refactor filtering, no check that the fix fixes the feature's behaviour. Blame stops at the shallow boundary (2026-04-01), which cannot create false feature links because all features are after it.
- Rust inline unit tests (#[cfg(test)] in src files) are not seen as TEST, so Rust features are undercounted.
- 2,111 blames ran, 2 timed out (uv).
- No PR metadata was read (labels, linked issues); "feature" and "fix" rest on commit subjects only.

**mining/mine.py**

````python
#!/usr/bin/env python3
# mining probe: feature commits (2026-07-01..2026-10-31), SZZ links from later fixes (Q1),
# 60-day follow-up changes (Q2), UI/DX tags and e2e presence (Q3). git only, keyless.
import json, os, re, subprocess, sys
from datetime import datetime, timezone

ROOT = os.path.expanduser("~/.capy/work/geva225/probes/mining")
WIN_START = int(datetime(2026, 7, 1, tzinfo=timezone.utc).timestamp())
WIN_END = int(datetime(2026, 11, 1, tzinfo=timezone.utc).timestamp())   # exclusive: through 2026-10-31
TODAY = int(datetime(2026, 11, 3, tzinfo=timezone.utc).timestamp())     # exclusive: through 2026-11-02
DAY = 86400

SRC_EXCL = re.compile(r'(^|/)(tests?|__tests__|spec|docs?)/|[._-](test|spec)\.|\.(md|json|ya?ml|lock|txt)$', re.I)
TEST = re.compile(r'(^|/)(tests?|__tests__|spec)/|[._-](test|spec)\.', re.I)
FEAT_EXCL = re.compile(r'fix|bug|regress|crash|broke|revert|chore|docs|bump|release|deps', re.I)
FIX = re.compile(r'fix|bug|regress|crash|broke', re.I)
REVERT = re.compile(r'revert', re.I)
UI_EXT = re.compile(r'\.(tsx|jsx|vue|svelte|css|scss|html)$', re.I)
UI_SEG = re.compile(r'(^|/)(apps?|ui|web|webapp|frontend|client|desktop-client|components|pages|views|routes|layouts|site|www|dashboard|admin)/', re.I)
DOCS = re.compile(r'(^|/)readme[^/]*$|(^|/)docs?/', re.I)
SURFACE = re.compile(r'(^|/)(cli|commands|cmd)/|(^|/)(index\.(ts|tsx|js|mjs|cjs)|__init__\.py|lib\.rs)$|openapi|swagger|(^|/)[^/]*schema[^/]*\.(json|ya?ml|graphql|gql)$', re.I)
E2E = re.compile(r'(^|/)(playwright|cypress)\.config\.|(^|/)cypress\.json$|(^|/)e2e/', re.I)
HUNK = re.compile(r'^@@ -(\d+)(?:,(\d+))? \+')

def git(repo, *args, timeout=120):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, timeout=timeout, errors="replace").stdout

def is_src(f): return not SRC_EXCL.search(f)
def is_test(f): return bool(TEST.search(f))

def log(repo):
    out = git(repo, "log", "--first-parent", "--diff-merges=first-parent", "--name-only",
              "--format=@@@%H%x09%ct%x09%s", "HEAD", timeout=600)
    commits = []
    for block in out.split("@@@")[1:]:
        lines = block.strip("\n").split("\n")
        h, ct, subj = (lines[0].split("\t", 2) + ["", ""])[:3]
        commits.append(dict(h=h, t=int(ct), s=subj, files=[l for l in lines[1:] if l.strip()]))
    commits.reverse()
    return commits

def szz(repo, fix, fset, stats):
    links = set()
    hunks_left = 6
    for f in [f for f in fix["files"] if is_src(f)][:4]:
        if hunks_left <= 0: break
        try:
            d = git(repo, "diff", "-U0", fix["h"] + "^1", fix["h"], "--", f, timeout=60)
        except subprocess.TimeoutExpired:
            stats["timeouts"] += 1; continue
        for line in d.split("\n"):
            m = HUNK.match(line)
            if not m: continue
            start, n = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1)
            if n == 0: continue
            if hunks_left <= 0: break
            hunks_left -= 1
            stats["blames"] += 1
            try:
                b = git(repo, "blame", "--first-parent", "--porcelain", "-L", f"{start},+{n}", fix["h"] + "^1", "--", f, timeout=60)
            except subprocess.TimeoutExpired:
                stats["timeouts"] += 1; continue
            for bl in b.split("\n"):
                mm = re.match(r'^([0-9a-f]{40}) \d+ \d+', bl)
                if mm and mm.group(1) in fset:
                    links.add(mm.group(1))
    return links

def licence(repo):
    names = [n for n in git(repo, "ls-tree", "--name-only", "HEAD").split("\n")
             if re.match(r'^(licen[cs]e|copying)([._-].*)?$', n, re.I)]
    ids = []
    for n in names:
        txt = git(repo, "show", f"HEAD:{n}")[:8000]
        if "Permission is hereby granted, free of charge" in txt: ids.append("MIT")
        elif "Apache License" in txt and "Version 2.0" in txt: ids.append("Apache-2.0")
        elif "Redistribution and use in source and binary forms" in txt:
            ids.append("BSD-3-Clause" if "Neither the name" in txt else "BSD-2-Clause")
        elif txt.strip(): ids.append("OTHER:" + n)
    return names, sorted(set(ids))

def analyse(repo):
    name = os.path.basename(repo).replace("__", "/")
    lic_files, lic = licence(repo)
    commits = log(repo)
    win = [c for c in commits if WIN_START <= c["t"] < WIN_END]
    feats = [c for c in win if any(map(is_src, c["files"])) and any(map(is_test, c["files"])) and not FEAT_EXCL.search(c["s"])]
    fset = {c["h"]: c for c in feats}
    fixes = [c for c in commits if WIN_START <= c["t"] < TODAY and FIX.search(c["s"])
             and any(map(is_src, c["files"])) and any(map(is_test, c["files"]))]
    stats = dict(blames=0, timeouts=0)
    q1 = {}
    for fx in fixes:
        for h in szz(repo, fx, fset, stats):
            if h != fx["h"] and fset[h]["t"] <= fx["t"]:
                q1.setdefault(h, []).append(fx["h"])
    q2 = {}
    later = [c for c in commits if c["t"] >= WIN_START]
    for c in feats:
        srcs = {f for f in c["files"] if is_src(f)}
        for d in later:
            if d["t"] <= c["t"] or d["h"] == c["h"]: continue
            if d["t"] > c["t"] + 60 * DAY or d["t"] >= TODAY: break
            if REVERT.search(d["s"]) or FIX.search(d["s"]): continue
            if srcs & set(d["files"]) and any(map(is_test, d["files"])):
                q2[c["h"]] = (d["h"], (d["t"] - c["t"]) / DAY)
                break
    ui = {c["h"] for c in feats if any(UI_EXT.search(f) and UI_SEG.search(f) and not is_test(f) for f in c["files"])}
    dx = {c["h"] for c in feats if any(DOCS.search(f) for f in c["files"]) and any(SURFACE.search(f) for f in c["files"])}
    tree = git(repo, "ls-tree", "-r", "--name-only", "HEAD", timeout=300).split("\n")
    e2e = [f for f in tree if E2E.search(f)]
    return dict(repo=name, licence_files=lic_files, licence=lic, commits_window=len(win), features=len(feats),
                fixes_scanned=len(fixes), blame_stats=stats, q1=len(q1), q2=len(q2),
                ui=len(ui), ui_q1=len(ui & q1.keys()), ui_q2=len(ui & q2.keys()),
                dx=len(dx), dx_q1=len(dx & q1.keys()), dx_q2=len(dx & q2.keys()),
                e2e=bool(e2e), e2e_examples=e2e[:3],
                q2_days=[round(v[1], 2) for v in q2.values()],
                q1_links={h[:10]: [x[:10] for x in v] for h, v in q1.items()},
                q1_subjects={h[:10]: fset[h]["s"][:90] for h in q1},
                oldest_commit=datetime.fromtimestamp(commits[0]["t"], timezone.utc).date().isoformat() if commits else None)

if __name__ == "__main__":
    repo = sys.argv[1]
    res = analyse(repo)
    os.makedirs(f"{ROOT}/out", exist_ok=True)
    with open(f"{ROOT}/out/{os.path.basename(repo)}.json", "w") as fh:
        json.dump(res, fh, indent=1)
    print(json.dumps({k: res[k] for k in ("repo", "licence", "commits_window", "features", "fixes_scanned", "blame_stats", "q1", "q2", "ui", "dx", "e2e")}))
````

**mining/aggregate.py**

````python
import json,glob,statistics
rows=[json.load(open(f)) for f in sorted(glob.glob('out/*.json'))]
cols=['repo','licence','commits_window','features','fixes_scanned','q1','q2','ui','ui_q1','ui_q2','dx','dx_q1','dx_q2','e2e']
print('| '+' | '.join(cols)+' | median_q2_days |'); print('|'+'---|'*(len(cols)+1))
T={c:0 for c in cols[2:-1]}; days=[]
for r in rows:
    d=r['q2_days']; days+=d
    print('| '+' | '.join(str('+'.join(r[c]) if c=='licence' else r[c]) for c in cols)+' | '+(str(round(statistics.median(d),1)) if d else '-')+' |')
    for c in T: T[c]+=r[c]
print('| TOTAL ('+str(len(rows))+' repos) | | '+' | '.join(str(T[c]) for c in T)+' | '+str(sum(r['e2e'] for r in rows))+' with e2e | '+str(round(statistics.median(days),1))+' |')
print('blames',sum(r['blame_stats']['blames'] for r in rows),'timeouts',sum(r['blame_stats']['timeouts'] for r in rows))
print('projection q1*0.038 per repo per 4 months:', round(T['q1']*0.038,2), 'total; per repo', round(T['q1']*0.038/len(rows),3))
for r in rows:
    for h,s in list(r['q1_subjects'].items())[:2]: print('Q1SAMPLE',r['repo'],h,s)
````

**mining/run_all.sh**

````bash
#!/bin/bash
cd ~/.capy/work/geva225/probes/mining
until grep -q CLONES_DONE clone.log; do sleep 20; done
ls -d repos/*/ | sed 's#/$##' | xargs -P4 -I{} sh -c 'timeout 3000 python3 mine.py {} >> mine.log 2>> mine.err || echo "TIMEOUT_OR_ERR {}" >> mine.log'
echo MINE_DONE >> mine.log
````
