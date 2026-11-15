// Copyright (c) 2026 Garry Tan. MIT License.
// In-image discovery (plan section 6: tests are found by frozen rules, never by a model). One script runs in the built
// image with no network and prints what the rules read, each under its own marker line: the retry greps, the Vitest
// projects through Vitest's node API (createVitest), the tests Vitest collects per project (vitest list --json),
// Playwright's projects (playwright test --list --reporter=json), the files Jest collects (jest --listTests) and cargo's
// workspace packages (cargo metadata). readDiscovery turns that output into the facts recipes.ts and browser.ts use.
import { REPO_ROOT_IN_IMAGE } from "./parse.ts";
import type { Discovered, RepoFacts } from "./recipes.ts";

export const MARK = "===H2H_DISCOVER ";
export type Section = "retries" | "vitest-projects" | "vitest-list" | "playwright-list" | "jest-list" | "cargo-metadata";
export type Collector = "vitest" | "playwright" | "jest" | "cargo";

const VPROJECTS = [
  "import { createVitest } from 'vitest/node';",
  "const v = await createVitest('test', { watch: false, run: true }, {}, {});",
  "for (const p of v.projects) console.log(JSON.stringify({ name: p.name, browser: !!p.config.browser?.enabled, provider: p.config.browser?.provider?.name ?? p.config.browser?.provider ?? null, environment: p.config.environment }));",
  "await v.close();",
].join("\n");

const sh = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
const grepTree = (re: string) => "grep -rIlE --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=target " + sh(re) + " . 2>/dev/null | head -1";

/** The discovery script. tests are the fix's test files (Playwright lists only those). */
export function discoveryScript(collectors: readonly Collector[], tests: readonly string[]): string {
  const out = [
    "cd " + REPO_ROOT_IN_IMAGE,
    "echo " + sh(MARK + "retries==="),
    "printf 'jest_retry_times %s\\n' \"$(" + grepTree("jest\\.retryTimes\\(") + ")\"",
    "printf 'mocha_retries %s\\n' \"$({ grep -lE 'retries' .mocharc* 2>/dev/null; " + grepTree("this\\.retries\\(") + "; } | head -1)\"",
    "printf 'surefire_rerun %s\\n' \"$(find . -name pom.xml -not -path '*/node_modules/*' -exec grep -l rerunFailingTestsCount {} + 2>/dev/null | head -1)\"",
  ];
  if (collectors.includes("vitest"))
    out.push(
      "printf '%s\\n' " + sh(VPROJECTS) + " > .h2h-vprojects.mjs",
      "echo " + sh(MARK + "vitest-projects==="),
      "node .h2h-vprojects.mjs 2>/dev/null; rm -f .h2h-vprojects.mjs",
      "echo " + sh(MARK + "vitest-list==="),
      "npx --no-install vitest list --json=/tmp/h2h-vlist.json >/dev/null 2>&1; cat /tmp/h2h-vlist.json 2>/dev/null",
    );
  if (collectors.includes("playwright")) out.push("echo " + sh(MARK + "playwright-list==="), "npx --no-install playwright test --list --reporter=json " + tests.map(sh).join(" ") + " 2>/dev/null");
  if (collectors.includes("jest")) out.push("echo " + sh(MARK + "jest-list==="), "npx --no-install jest --listTests 2>/dev/null");
  if (collectors.includes("cargo")) out.push("echo " + sh(MARK + "cargo-metadata==="), "cargo metadata --no-deps --format-version 1 --offline 2>/dev/null");
  return out.join("\n") + "\n";
}

export interface Discovery {
  discovered: Discovered;
  retries: NonNullable<RepoFacts["retries"]>;
  /** Every test Vitest collects, by file and project (null when Vitest was not asked or printed nothing). */
  vitest_tests: { file: string; project: string }[] | null;
  playwright_projects: { name: string; browserName: string | null }[] | null;
  jest_files: string[] | null;
}

const rel = (p: string) => (p.startsWith(REPO_ROOT_IN_IMAGE + "/") ? p.slice(REPO_ROOT_IN_IMAGE.length + 1) : p);
const json = (s: string | undefined): any => {
  if (!s?.trim()) return null;
  try {
    return JSON.parse(s.slice(s.search(/[[{]/)));
  } catch {
    return null;
  }
};

export function sections(log: string): Partial<Record<Section, string>> {
  const out: Partial<Record<Section, string>> = {};
  let cur: Section | null = null;
  for (const line of log.split("\n")) {
    const m = line.match(/^===H2H_DISCOVER ([a-z-]+)===$/);
    if (m) {
      cur = m[1] as Section;
      out[cur] = "";
    } else if (cur) out[cur] += line + "\n";
  }
  return out;
}

export function readDiscovery(log: string): Discovery {
  const s = sections(log);
  const flag = (k: string) => new RegExp("^" + k + " \\S", "m").test(s.retries ?? "");
  const vp = s["vitest-projects"];
  const projects = vp === undefined ? undefined : vp.split("\n").map(json).filter((x) => x && typeof x.name === "string").map((p) => ({ name: String(p.name), browser: !!p.browser, provider: p.provider == null ? null : String(p.provider), environment: String(p.environment ?? "") }));
  const vlist = json(s["vitest-list"]);
  const pw = json(s["playwright-list"]);
  const cargo = json(s["cargo-metadata"]);
  const discovered: Discovered = {};
  if (projects?.length) discovered.vitest_projects = projects;
  if (cargo?.packages)
    discovered.cargo_packages = (cargo.packages as { name: string; manifest_path: string }[])
      .map((p) => {
        const d = rel(p.manifest_path).replace(/\/?Cargo\.toml$/, "");
        return { name: p.name, dir: d === "" || d === REPO_ROOT_IN_IMAGE ? "." : d };
      })
      .sort((a, b) => (a.name < b.name ? -1 : 1));
  return {
    discovered,
    retries: { jest_retry_times: flag("jest_retry_times"), mocha_retries: flag("mocha_retries"), surefire_rerun: flag("surefire_rerun") },
    vitest_tests: Array.isArray(vlist) ? vlist.map((t: { file: string; projectName?: string }) => ({ file: rel(t.file), project: t.projectName ?? "" })) : null,
    playwright_projects: pw?.config?.projects ? (pw.config.projects as { name?: string; use?: { browserName?: string } }[]).map((p) => ({ name: p.name ?? "", browserName: p.use?.browserName ?? null })) : null,
    jest_files: s["jest-list"] === undefined ? null : s["jest-list"].split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")).map(rel).sort(),
  };
}
