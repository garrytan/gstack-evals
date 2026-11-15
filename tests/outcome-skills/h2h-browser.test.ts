// Copyright (c) 2026 Garry Tan. MIT License.
// The in-image discovery reader and the browser-engine check, keyless.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { browserCheck } from "../../lanes/outcome-skills/h2h/breadth/browser.ts";
import { discoveryScript, readDiscovery, type Discovery } from "../../lanes/outcome-skills/h2h/breadth/discover.ts";

const FX = join(import.meta.dir, "fixtures", "h2h-b");
const vlist = readFileSync(join(FX, "vitest-list.json"), "utf8");
const pwlist = readFileSync(join(FX, "playwright-list.json"), "utf8");
const log = [
  "===H2H_DISCOVER retries===", "jest_retry_times ", "mocha_retries ./test/flaky.test.js", "surefire_rerun ",
  "===H2H_DISCOVER vitest-projects===", JSON.stringify({ name: "unit", browser: false, provider: null, environment: "jsdom" }), JSON.stringify({ name: "browser (chromium)", browser: true, provider: "playwright", environment: "node" }),
  "===H2H_DISCOVER vitest-list===", vlist,
  "===H2H_DISCOVER playwright-list===", pwlist,
  "===H2H_DISCOVER jest-list===", "/testbed/src/jsdom.test.js", "",
  "===H2H_DISCOVER cargo-metadata===", JSON.stringify({ packages: [{ name: "core", manifest_path: "/testbed/crates/core/Cargo.toml" }, { name: "root", manifest_path: "/testbed/Cargo.toml" }] }),
].join("\n");

describe("discovery", () => {
  test("the script asks only for the collectors named", () => {
    const s = discoveryScript(["playwright"], ["e2e/a.spec.ts"]);
    expect(s).toContain("===H2H_DISCOVER retries===");
    expect(s).toContain("playwright test --list --reporter=json 'e2e/a.spec.ts'");
    expect(s).not.toContain("vitest");
    expect(discoveryScript(["vitest", "jest", "cargo"], [])).toContain("createVitest");
  });
  test("the reader", () => {
    const d = readDiscovery(log);
    expect(d.retries).toEqual({ jest_retry_times: false, mocha_retries: true, surefire_rerun: false });
    expect(d.discovered.vitest_projects?.map((p) => [p.name, p.browser, p.provider])).toEqual([["unit", false, null], ["browser (chromium)", true, "playwright"]]);
    expect(d.vitest_tests?.some((t) => t.file === "tests/dom.vt.test.js" && t.project === "unit")).toBe(true);
    expect(d.playwright_projects?.length).toBeGreaterThan(0);
    expect(d.jest_files).toEqual(["src/jsdom.test.js"]);
    expect(d.discovered.cargo_packages).toEqual([{ name: "core", dir: "crates/core" }, { name: "root", dir: "." }]);
  });
});

describe("browser-engine check", () => {
  const base: Discovery = { discovered: { vitest_projects: [{ name: "unit", browser: false, provider: null, environment: "jsdom" }, { name: "browser", browser: true, provider: "playwright", environment: "node" }] }, retries: { jest_retry_times: false, mocha_retries: false, surefire_rerun: false }, vitest_tests: [{ file: "t/b.test.ts", project: "browser" }], playwright_projects: [{ name: "chromium", browserName: null }], jest_files: [] };
  test("Playwright: a configured project", () => {
    const r = browserCheck({ runner: "playwright", format: "junit-playwright", f2p: ["[chromium]::page.spec.ts::page.spec.ts::::page › fails"], testFiles: ["e2e/page.spec.ts"], discovery: base });
    expect(r.ok).toBe(true);
    expect(r.tests[0]!.engine).toBe("chromium");
    expect(browserCheck({ runner: "playwright", format: "junit-playwright", f2p: ["[api]::a.spec.ts::a.spec.ts::::x"], testFiles: ["e2e/a.spec.ts"], discovery: base }).rule).toBe("not_a_browser_project");
  });
  test("Vitest: the browser provider and the report's project", () => {
    expect(browserCheck({ runner: "vitest", format: "vitest-json", f2p: ["[browser]::t/b.test.ts::b > x"], testFiles: ["t/b.test.ts"], discovery: base }).ok).toBe(true);
    expect(browserCheck({ runner: "vitest", format: "vitest-json", f2p: ["[unit]::t/b.test.ts::b > x"], testFiles: ["t/b.test.ts"], discovery: base }).rule).toBe("not_a_browser_project");
    const both = { ...base, vitest_tests: [{ file: "t/b.test.ts", project: "browser" }, { file: "t/b.test.ts", project: "unit" }] };
    const r = browserCheck({ runner: "vitest", format: "vitest-json", f2p: ["[browser]::t/b.test.ts::b > x"], testFiles: ["t/b.test.ts"], discovery: both });
    expect(r.rule).toBe("collected_under_node_or_jsdom");
    expect(r.also_collected).toEqual([{ file: "t/b.test.ts", by: "vitest:unit" }]);
  });
  test("Karma and Web Test Runner browser strings; Jest-driven Puppeteer names no engine", () => {
    expect(browserCheck({ runner: "karma", format: "junit", f2p: ["Chrome Headless 159.0.0.0 (Linux 0.0.0)::karma suite::::fails"], testFiles: ["test/a.spec.js"], discovery: base }).tests[0]!.engine).toBe("chrome");
    expect(browserCheck({ runner: "web-test-runner", format: "junit", f2p: ["Chromium_playwright_/wtr/w.test.js::wtr suite::wtr/w.test.js::fails"], testFiles: ["wtr/w.test.js"], discovery: base }).ok).toBe(true);
    expect(browserCheck({ runner: "karma", format: "junit", f2p: ["Node::s::::x"], testFiles: ["a.js"], discovery: base }).rule).toBe("no_engine_in_report");
    expect(browserCheck({ runner: "jest", format: "jest-json", f2p: ["e2e/a.test.js::x"], testFiles: ["e2e/a.test.js"], discovery: base }).rule).toBe("no_engine_in_report");
  });
  test("a file Jest also collects fails", () => {
    const r = browserCheck({ runner: "playwright", format: "junit-playwright", f2p: ["[chromium]::src/jsdom.test.js::src/jsdom.test.js::::x"], testFiles: ["src/jsdom.test.js"], discovery: { ...base, jest_files: ["src/jsdom.test.js"] } });
    expect(r.rule).toBe("collected_under_node_or_jsdom");
  });
});
