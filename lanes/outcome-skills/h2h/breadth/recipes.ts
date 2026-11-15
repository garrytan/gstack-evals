// Copyright (c) 2026 Garry Tan. MIT License.
// The frozen B image recipes and test-command rules (plan section 6). A recipe is chosen by rule from what the repository
// holds at the fix's parent: a pinned toolchain image by digest, its dependencies installed from the lockfile (npm, pnpm
// or yarn; Go modules; Cargo; Maven; .NET restore), Playwright's Chromium and its OS libraries baked in for B1, and test
// retries off. The test command and report parser follow from the runner: JUnit XML where the runner writes it, TRX for
// .NET, else go test -json, cargo test, and Jest and Vitest JSON. A runner whose JUnit or JSON reporter is not already in
// the lockfile drops by rule; no reporter package is added. No model writes any of this. Every drop has a reason code,
// counted per ecosystem.
import type { ReasonCode } from "../../../../src/errors/codes.ts";
import { printCommand, printFind, REPORT_DIR, REPO_ROOT_IN_IMAGE, type ReportFormat } from "./parse.ts";
import { BROWSER } from "../types.ts";
import { SOURCE_EXT, TEST_PATH, type Lang } from "../../statemachines/langs.ts";

export type Ecosystem = "npm" | "Go" | "Maven" | "crates.io" | "NuGet";
export type PackageManager = "npm" | "pnpm" | "yarn" | "go" | "cargo" | "maven" | "dotnet";
export type TestRunner = "playwright" | "vitest" | "jest" | "mocha" | "node-test" | "karma" | "web-test-runner" | "cypress" | "go" | "cargo" | "maven" | "dotnet";

/** The pinned toolchain images (linux/amd64 index digests read on the freeze date). */
export const TOOLCHAINS = {
  node20: "node:20-bookworm@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5",
  node22: "node:22-bookworm@sha256:e13726ca604184d7a91fcacab1fc09eefd642dc28e79ac34e85540dd93b78cfb",
  node24: "node:24-bookworm@sha256:9d266751ca3d7fdbe651c878ffd5ad0a42fed49a18c283509267c97f025b7496",
  go: "golang:1.27-bookworm@sha256:4fa7c968ba93f1635670522dbb01a2c78150443e1385746924566079f36570ea",
  rust: "rust:1-bookworm@sha256:ade39a710ef85f3506cffcfec3e8a24ba090badef1dff2fb798f71d878833fea",
  maven8: "maven:3.9-eclipse-temurin-8@sha256:0f402712b7a469189cfea5ec69cdcadcb32b22aaf1ea62777ab925c3d8470175",
  maven11: "maven:3.9-eclipse-temurin-11@sha256:7bb84a451705605a47d24eb844d4d9ab03e33e131a507db76aafe25db3907f64",
  maven17: "maven:3.9-eclipse-temurin-17@sha256:1a352420f7aba21f5ad08df31bab55f74c013fb491f1ae8ab1dd7ff9ed698584",
  maven21: "maven:3.9-eclipse-temurin-21@sha256:99e61abcff91a9b1333463bd8451fb18495d6eba9250ac66a338b518f8278320",
  dotnet8: "mcr.microsoft.com/dotnet/sdk:8.0@sha256:1b955f179b02df4f0eb5fadedaa898cbe44d620a64aab52eec72c8e91d1355b5",
  dotnet9: "mcr.microsoft.com/dotnet/sdk:9.0@sha256:1dfdb27e9c2c345cb598925ccf6b13719ecfebea8467bd4745c23a3c108cdf84",
  dotnet10: "mcr.microsoft.com/dotnet/sdk:10.0@sha256:fe0fd4e93bd2fbb47c883b7a6369e5c8d3db8bf01cdc5981f6ee35fbdf3ff4fb",
} as const;
/** The Playwright whose Chromium a B1 image gets when its lockfile holds no Playwright. */
export const PLAYWRIGHT_PIN = "1.65.1";
export const BROWSERS_PATH = "/ms-playwright";

/** What the rules read from the repository at the fix's parent: every tracked path, the text of the root files the rules
 *  name, and the in-image retry scan (discover.ts). */
export interface RepoFacts {
  files: string[];
  texts: Partial<Record<"package.json" | ".nvmrc" | ".node-version" | "go.mod" | "pom.xml" | "global.json" | ".yarnrc.yml", string>>;
  retries?: { jest_retry_times: boolean; mocha_retries: boolean; surefire_rerun: boolean };
}
export interface Drop { code: ReasonCode; rule: string }
export const isDrop = (x: unknown): x is Drop => typeof x === "object" && x !== null && "code" in x && "rule" in x;

export interface Recipe { ecosystem: Ecosystem; pm: PackageManager; image: string; install: string[]; browser: boolean; env: Record<string, string>; apt: string[] }

const has = (f: RepoFacts, p: string) => f.files.includes(p);
const pkg = (f: RepoFacts): any => {
  try {
    return JSON.parse(f.texts["package.json"] ?? "{}");
  } catch {
    return {};
  }
};
/** Every dependency name the root package.json lists. */
export const deps = (f: RepoFacts): Set<string> => {
  const p = pkg(f);
  return new Set(Object.keys({ ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}), ...(p.optionalDependencies ?? {}) }));
};

/** The Node major: .nvmrc, then .node-version, then engines.node; the first of 20, 22 and 24 named, a lower one reads 20, a
 *  higher one 24, none 22. */
export function nodeMajor(f: RepoFacts): 20 | 22 | 24 {
  for (const text of [f.texts[".nvmrc"], f.texts[".node-version"], pkg(f).engines?.node]) {
    if (typeof text !== "string" || !text.trim()) continue;
    const ns = [...text.matchAll(/(\d+)(?:\.\d+)*/g)].map((m) => Number(m[1]));
    const hit = ns.find((n) => n === 20 || n === 22 || n === 24);
    if (hit) return hit as 20 | 22 | 24;
    if (ns.some((n) => n < 20)) return 20;
    if (ns.some((n) => n > 24)) return 24;
  }
  return 22;
}

/** The JavaScript package manager: package.json's packageManager when its lockfile is there, else the first lockfile of
 *  pnpm-lock.yaml, yarn.lock, package-lock.json and npm-shrinkwrap.json. */
export function nodePm(f: RepoFacts): "npm" | "pnpm" | "yarn" | null {
  const lock = { pnpm: has(f, "pnpm-lock.yaml"), yarn: has(f, "yarn.lock"), npm: has(f, "package-lock.json") || has(f, "npm-shrinkwrap.json") };
  const named = String(pkg(f).packageManager ?? "").split("@")[0] as keyof typeof lock;
  if (named in lock && lock[named]) return named;
  return lock.pnpm ? "pnpm" : lock.yarn ? "yarn" : lock.npm ? "npm" : null;
}

/** The Java version from the root pom: maven.compiler.release, then maven.compiler.source, then java.version; 1.8 reads 8;
 *  the nearest of 8, 11, 17 and 21 at or above it; none reads 21. */
export function javaVersion(pom: string): 8 | 11 | 17 | 21 {
  for (const tag of ["maven.compiler.release", "maven.compiler.source", "java.version"]) {
    const m = pom.match(new RegExp("<" + tag.replace(/\./g, "\\.") + ">\\s*(?:1\\.)?(\\d+)\\s*<"));
    if (!m) continue;
    const v = Number(m[1]);
    return v <= 8 ? 8 : v <= 11 ? 11 : v <= 17 ? 17 : 21;
  }
  return 21;
}

/** The .NET SDK: global.json's sdk.version major, else the highest netN.0 any project file name holds; 8, 9 or 10; none 10. */
export function dotnetMajor(f: RepoFacts): 8 | 9 | 10 {
  const m = (f.texts["global.json"] ?? "").match(/"version"\s*:\s*"(\d+)\./);
  const pick = (n: number) => (n <= 8 ? 8 : n === 9 ? 9 : 10);
  if (m) return pick(Number(m[1]));
  return 10;
}

/** The recipe for a candidate, or its drop. B1 always takes the JavaScript recipes. */
export function chooseRecipe(kind: "B1" | "B2", ecosystem: Ecosystem, f: RepoFacts): Recipe | Drop {
  const env: Record<string, string> = { CI: "1" };
  if (kind === "B1" || ecosystem === "npm") {
    if (!has(f, "package.json")) return { code: "E_H2H_B_NO_LOCKFILE", rule: "no_root_package_json" };
    const pm = nodePm(f);
    if (!pm) return { code: "E_H2H_B_NO_LOCKFILE", rule: "no_js_lockfile" };
    const install = pm === "npm" ? ["npm ci --no-audit --no-fund"] : pm === "pnpm" ? ["corepack enable", "pnpm install --frozen-lockfile"] : ["corepack enable", has(f, ".yarnrc.yml") ? "yarn install --immutable" : "yarn install --frozen-lockfile"];
    const browser = kind === "B1";
    if (browser) {
      install.push("if [ -x node_modules/.bin/playwright ]; then node_modules/.bin/playwright install --with-deps chromium; else npx -y playwright@" + PLAYWRIGHT_PIN + " install --with-deps chromium; fi", "chmod -R a+rX " + BROWSERS_PATH);
      Object.assign(env, { PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH, ...BROWSER.env, PUPPETEER_SKIP_DOWNLOAD: "1" });
    }
    const apt = browser && deps(f).has("cypress") ? ["xvfb"] : [];
    return { ecosystem: kind === "B1" ? "npm" : ecosystem, pm, image: TOOLCHAINS[("node" + nodeMajor(f)) as "node22"], install, browser, env, apt };
  }
  if (ecosystem === "Go") {
    if (!has(f, "go.mod")) return { code: "E_H2H_B_NO_LOCKFILE", rule: "no_root_go_mod" };
    if (!has(f, "go.sum") && /^\s*require\b/m.test(f.texts["go.mod"] ?? "")) return { code: "E_H2H_B_NO_LOCKFILE", rule: "no_go_sum" };
    return { ecosystem, pm: "go", image: TOOLCHAINS.go, install: ["go mod download", "go test -count=1 -run '^$' ./... >/dev/null 2>&1 || true"], browser: false, env: { ...env, GOTOOLCHAIN: "local", GOFLAGS: "-mod=mod", GOPROXY: "off" }, apt: [] };
  }
  if (ecosystem === "crates.io") {
    if (!has(f, "Cargo.toml")) return { code: "E_H2H_B_NO_LOCKFILE", rule: "no_root_cargo_toml" };
    if (!has(f, "Cargo.lock")) return { code: "E_H2H_B_NO_LOCKFILE", rule: "no_cargo_lock" };
    return { ecosystem, pm: "cargo", image: TOOLCHAINS.rust, install: ["cargo fetch --locked", "cargo test --offline --no-run >/dev/null 2>&1 || true"], browser: false, env: { ...env, CARGO_NET_OFFLINE: "true" }, apt: [] };
  }
  if (ecosystem === "Maven") {
    if (!has(f, "pom.xml")) return { code: "E_H2H_B_NO_LOCKFILE", rule: "no_root_pom" };
    const pom = f.texts["pom.xml"] ?? "";
    const image = TOOLCHAINS[("maven" + javaVersion(pom)) as "maven21"];
    return { ecosystem, pm: "maven", image, install: ["mvn -B -q -DskipTests install", "mvn -B -q test -Dtest=H2hNoSuchTest -Dsurefire.failIfNoSpecifiedTests=false -DfailIfNoTests=false >/dev/null 2>&1 || true", "find . -path '*/target/surefire-reports' -type d -prune -exec rm -rf {} +"], browser: false, env, apt: [] };
  }
  if (ecosystem === "NuGet") {
    const sln = f.files.filter((p) => !p.includes("/") && /\.(sln|slnx)$/.test(p));
    const proj = f.files.filter((p) => /\.csproj$/.test(p));
    if (!sln.length && !proj.length) return { code: "E_H2H_B_NO_LOCKFILE", rule: "no_dotnet_project" };
    const locked = f.files.some((p) => p.endsWith("packages.lock.json"));
    const target = sln.length === 1 ? ' "' + sln[0] + '"' : "";
    return { ecosystem, pm: "dotnet", image: TOOLCHAINS[("dotnet" + dotnetMajor(f)) as "dotnet10"], install: ["dotnet restore" + target + (locked ? " --locked-mode" : ""), "dotnet build" + target + " --no-restore >/dev/null 2>&1 || true"], browser: false, env: { ...env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" }, apt: [] };
  }
  return { code: "E_H2H_B_NO_LOCKFILE", rule: "ecosystem_" + ecosystem };
}

const sh = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

/** The image's Dockerfile: the toolchain image, the repository fetched at the fix's parent alone (a depth-1 fetch, so no
 *  later commit is in the image), the install steps, the browser layer and wrapper for B1, and the run environment. The
 *  offline switches (GOPROXY=off, CARGO_NET_OFFLINE) are set after the install steps, so they bind the runs and not the
 *  dependency fetch. */
export const OFFLINE_ENV = ["GOPROXY", "CARGO_NET_OFFLINE"];
export function dockerfile(r: Recipe, repoUrl: string, parent: string): string {
  if (!/^[0-9a-f]{40}$/.test(parent)) throw new Error("E_H2H_B_BUILD parent is not a 40-hex commit: " + parent);
  const env = (keep: (k: string) => boolean) => Object.entries(r.env).filter(([k]) => keep(k)).map(([k, v]) => k + "=" + JSON.stringify(v)).join(" ");
  const lines = ["FROM " + r.image, "ENV " + env((k) => !(k in BROWSER.env) && !OFFLINE_ENV.includes(k))];
  if (r.apt.length) lines.push("RUN apt-get update && apt-get install -y --no-install-recommends " + r.apt.join(" ") + " && rm -rf /var/lib/apt/lists/*");
  lines.push("RUN git init -q " + REPO_ROOT_IN_IMAGE + " && cd " + REPO_ROOT_IN_IMAGE + " && git fetch -q --depth 1 " + sh(repoUrl) + " " + parent + " && git checkout -q --detach FETCH_HEAD && git remote remove origin 2>/dev/null; git -C " + REPO_ROOT_IN_IMAGE + " rev-parse HEAD");
  lines.push("WORKDIR " + REPO_ROOT_IN_IMAGE);
  for (const step of r.install) lines.push("RUN " + step);
  if (OFFLINE_ENV.some((k) => k in r.env)) lines.push("ENV " + env((k) => OFFLINE_ENV.includes(k)));
  if (r.browser) {
    lines.push("COPY chromium-wrapper.sh " + BROWSER.wrapper_container_path, "RUN chmod 0755 " + BROWSER.wrapper_container_path + " && " + BROWSER.wrapper_container_path + " --headless=new --dump-dom about:blank >/dev/null");
    lines.push("ENV " + Object.entries(BROWSER.env).map(([k, v]) => k + "=" + v).join(" "));
  }
  return lines.join("\n") + "\n";
}

/** The test command, print command and parser for one runner over the fix's test files. */
export interface TestPlan { runner: TestRunner; format: ReportFormat; commands: { rebuild: string[]; test: string[]; print: string[] } }

/** What discovery read in the image that the rules use. */
export interface Discovered {
  vitest_projects?: { name: string; browser: boolean; provider: string | null; environment: string }[];
  cargo_packages?: { name: string; dir: string }[];
}

const RD = REPORT_DIR;
const q = (files: string[]) => files.map(sh).join(" ");

/** Paths that are never a unit's source: statemachines/langs.ts classify's NOT_SOURCE, which that file does not export
 *  (h2h-recipes.test.ts checks that the two agree). */
export const NOT_SOURCE = /(^|\/)(node_modules|vendor|third_party|target|\.git|dist|build|__pycache__|\.venv|venv)(\/|$)/;
const ere = (r: RegExp) => r.source.replace(/\\\//g, "/");

/** Section 7's verified-correct fix counts a new test file the arm added that fails in all three scoring runs (the reused
 *  scorer's new-test rule), so a scoring run must collect it. This sets the shell's arguments for a path-filtered runner:
 *  the fix's test files, then each file new to the base commit (untracked, or added in the index) that langs.ts classify
 *  calls a test under the unit's language: not under a NOT_SOURCE directory, a source extension, a test path. Strict
 *  scoring has already dropped the arm's protected files and its files at the fix's new test paths. On the oracle's base
 *  and fixed trees the only new files are the fix's own new test files, which the list already holds. */
export function armTestArgs(lang: Lang, tests: string[]): string {
  const git = "git -c safe.directory='*' -c core.quotePath=false";
  return "printf '%s\\n' " + q(tests) + " > " + RD + "/fix-tests.txt && { " + git + " ls-files --others --exclude-standard; " + git + " diff --cached --name-only --diff-filter=A HEAD --; } | grep -Ev " + sh(ere(NOT_SOURCE)) + " | grep -E " + sh(ere(SOURCE_EXT[lang])) + " | grep -E " + sh(ere(TEST_PATH[lang])) + " | grep -vxF -f " + RD + "/fix-tests.txt | sort -u > " + RD + "/arm-tests.txt; set -- " + q(tests) + "; while IFS= read -r p; do set -- \"$@\" \"$p\"; done < " + RD + "/arm-tests.txt; ";
}
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".");
const nearest = (path: string, files: readonly string[], match: (p: string) => boolean): string | null => {
  let d = dirOf(path);
  for (;;) {
    const hit = files.find((f) => dirOf(f) === d && match(f));
    if (hit) return hit;
    if (d === ".") return null;
    d = dirOf(d);
  }
};
const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");

/** The rule per runner. Every command writes its report under .h2h-reports and runs with retries off. */
export function testPlan(runner: TestRunner, tests: string[], f: RepoFacts, d: Discovered = {}, lang: Lang = "ts"): TestPlan | Drop {
  const dp = deps(f);
  const mk = "mkdir -p " + RD + " && ";
  const arm = mk + armTestArgs(lang, tests);
  const plan = (format: ReportFormat, test: string[], print: string[]): TestPlan => ({ runner, format, commands: { rebuild: [], test, print } });
  switch (runner) {
    case "playwright":
      return plan("junit-playwright", [arm + "PLAYWRIGHT_JUNIT_OUTPUT_NAME=" + RD + "/playwright.xml npx --no-install playwright test --reporter=junit --retries=0 \"$@\""], [printCommand([RD + "/playwright.xml"])]);
    case "vitest": {
      const projects = d.vitest_projects?.length ? d.vitest_projects.map((p) => p.name) : [""];
      return plan("vitest-json", projects.map((p) => arm + "npx --no-install vitest run" + (p ? " --project " + sh(p) : "") + " --reporter=json --outputFile=" + RD + "/vitest-" + hex(p) + ".json --retry=0 \"$@\""), [printCommand([RD + "/vitest-*.json"])]);
    }
    case "jest":
      if (f.retries?.jest_retry_times) return { code: "E_H2H_B_RETRIES", rule: "jest_retry_times" };
      return plan("jest-json", [arm + "npx --no-install jest --ci --json --outputFile=" + RD + "/jest.json --runTestsByPath \"$@\""], [printCommand([RD + "/jest.json"])]);
    case "mocha":
      if (f.retries?.mocha_retries) return { code: "E_H2H_B_RETRIES", rule: "mocha_retries" };
      return plan("junit", [arm + "npx --no-install mocha --reporter xunit --reporter-option output=" + RD + "/mocha.xml \"$@\""], [printCommand([RD + "/mocha.xml"])]);
    case "node-test":
      return plan("junit", [arm + "node --test --test-reporter=junit --test-reporter-destination=" + RD + "/node.xml \"$@\""], [printCommand([RD + "/node.xml"])]);
    case "karma": {
      if (!dp.has("karma-junit-reporter")) return { code: "E_H2H_B_NO_REPORTER", rule: "karma-junit-reporter" };
      const conf = ["karma.conf.js", "karma.conf.cjs"].find((p) => has(f, p));
      if (!conf) return { code: "E_H2H_B_NO_RUNNER", rule: "karma_config_not_js" };
      const wrapper = "const base = require('./" + conf + "'); module.exports = function (config) { base(config); config.set({ reporters: ['junit'], junitReporter: { outputDir: '" + RD + "', outputFile: 'karma.xml', useBrowserName: false }, singleRun: true, autoWatch: false }); };";
      return plan("junit", [mk + "printf '%s\\n' " + sh(wrapper) + " > .h2h-karma.conf.cjs && npx --no-install karma start .h2h-karma.conf.cjs"], [printCommand([RD + "/karma.xml"])]);
    }
    case "web-test-runner": {
      if (!dp.has("@web/test-runner-junit-reporter")) return { code: "E_H2H_B_NO_REPORTER", rule: "@web/test-runner-junit-reporter" };
      const conf = ["web-test-runner.config.mjs", "web-test-runner.config.js", "web-test-runner.config.cjs"].find((p) => has(f, p));
      if (!conf) return { code: "E_H2H_B_NO_RUNNER", rule: "wtr_no_root_config" };
      const wrapper = "import base from './" + conf + "'; import { defaultReporter } from '@web/test-runner'; import { junitReporter } from '@web/test-runner-junit-reporter'; export default { ...base, reporters: [defaultReporter(), junitReporter({ outputPath: '" + RD + "/wtr.xml' })] };";
      return plan("junit", [arm + "printf '%s\\n' " + sh(wrapper) + " > .h2h-wtr.config.mjs && npx --no-install wtr --config .h2h-wtr.config.mjs \"$@\""], [printCommand([RD + "/wtr.xml"])]);
    }
    case "cypress":
      return plan("junit", [arm + "npx --no-install cypress run --reporter junit --reporter-options " + sh("mochaFile=" + RD + "/cypress-[hash].xml") + " --config retries=0 --spec \"$(IFS=,; printf '%s' \"$*\")\""], [printCommand([RD + "/cypress-*.xml"])]);
    case "go": {
      const pkgs = [...new Set(tests.filter((t) => t.endsWith("_test.go")).map((t) => "./" + (dirOf(t) === "." ? "" : dirOf(t))))].sort();
      if (!pkgs.length) return { code: "E_H2H_B_NO_TESTS", rule: "no_go_test_file" };
      return plan("go-json", [mk + "go test -json -count=1 " + pkgs.map((p) => (p === "./" ? "." : p)).join(" ") + " > " + RD + "/go-test.json"], [printCommand([RD + "/go-test.json"])]);
    }
    case "cargo": {
      const owned = d.cargo_packages ? [...new Set(tests.map((t) => d.cargo_packages!.filter((p) => p.dir === "." || t.startsWith(p.dir + "/")).sort((a, b) => b.dir.length - a.dir.length)[0]?.name).filter((x): x is string => !!x))].sort() : [];
      return plan("cargo", [mk + "cargo test --offline --no-fail-fast" + owned.map((n) => " -p " + sh(n)).join("") + " > " + RD + "/cargo.txt 2>&1"], [printCommand([RD + "/cargo.txt"])]);
    }
    case "maven": {
      if (f.retries?.surefire_rerun) return { code: "E_H2H_B_RETRIES", rule: "surefire_rerun_in_pom" };
      const classes = [...new Set(tests.filter((t) => /\.(java|kt)$/.test(t)).map((t) => t.slice(t.lastIndexOf("/") + 1).replace(/\.(java|kt)$/, "")))].sort();
      if (!classes.length) return { code: "E_H2H_B_NO_TESTS", rule: "no_java_test_file" };
      const modules = [...new Set(tests.map((t) => nearest(t, f.files, (p) => p.endsWith("pom.xml"))).filter((p): p is string => !!p).map(dirOf))].sort();
      const pl = modules.filter((m) => m !== ".").length ? " -pl " + modules.join(",") : "";
      return plan("junit", ["mvn -B -o -Dsurefire.rerunFailingTestsCount=0 -Dsurefire.failIfNoSpecifiedTests=false -DfailIfNoTests=false -Dtest=" + classes.join(",") + pl + " test"], [printFind(".", "*/target/surefire-reports/TEST-*.xml")]);
    }
    case "dotnet": {
      const projects = [...new Set(tests.map((t) => nearest(t, f.files, (p) => p.endsWith(".csproj"))).filter((p): p is string => !!p))].sort();
      if (!projects.length) return { code: "E_H2H_B_NO_TESTS", rule: "no_test_project" };
      return plan("trx", projects.map((p, i) => "dotnet test " + sh(p) + " --no-restore --logger " + sh("trx;LogFileName=h2h-" + i + ".trx") + " --results-directory " + RD), [printCommand([RD + "/*.trx"])]);
    }
  }
}

/** The runners a candidate may use, in the frozen order discovery tries them. B1: its real-browser runners (Puppeteer
 *  through the Jest or Mocha that drives it). B2 npm: Vitest, Jest, Mocha, node:test. Other ecosystems: their one runner. */
export function candidateRunners(kind: "B1" | "B2", ecosystem: Ecosystem, f: RepoFacts, browserRunners: readonly string[] = []): TestRunner[] | Drop {
  const dp = deps(f);
  const scripts = Object.values(pkg(f).scripts ?? {}).map(String).join(" ");
  if (kind === "B1") {
    const out: TestRunner[] = [];
    const add = (r: TestRunner) => out.includes(r) || out.push(r);
    for (const r of ["playwright", "vitest-browser", "web-test-runner", "karma", "cypress", "puppeteer"])
      if (browserRunners.includes(r)) {
        if (r === "vitest-browser") add("vitest");
        else if (r === "puppeteer") {
          if (dp.has("jest")) add("jest");
          if (dp.has("mocha")) add("mocha");
        } else add(r as TestRunner);
      }
    return out.length ? out : { code: "E_H2H_B_NO_RUNNER", rule: "no_root_browser_runner" };
  }
  if (ecosystem === "npm") {
    const out: TestRunner[] = [];
    if (dp.has("vitest")) out.push("vitest");
    if (dp.has("jest")) out.push("jest");
    if (dp.has("mocha")) out.push("mocha");
    if (/\bnode\s+(--[\w-]+\s+)*--test\b/.test(scripts)) out.push("node-test");
    return out.length ? out : { code: "E_H2H_B_NO_RUNNER", rule: "no_known_js_runner" };
  }
  return [({ Go: "go", "crates.io": "cargo", Maven: "maven", NuGet: "dotnet" } as const)[ecosystem as "Go"]];
}
