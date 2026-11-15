// Copyright (c) 2026 Garry Tan. MIT License.
// Every part B gate with a planted case that passes and one that drops, and one unit that passes every gate in order:
// told-mode screen, lockfile, runner, reporter, retries, tests found, report parse, image store, browser engine, the 5+5
// oracle keep rule (the state machines judge) and the B fallback floor.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toldScreen } from "../../lanes/outcome-skills/pfchecks/told.ts";
import { judge } from "../../lanes/outcome-skills/statemachines/oracle.ts";
import { readUnit } from "../../lanes/outcome-skills/statemachines/unit.ts";
import { readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import { browserCheck } from "../../lanes/outcome-skills/h2h/breadth/browser.ts";
import { readDiscovery } from "../../lanes/outcome-skills/h2h/breadth/discover.ts";
import { planB } from "../../lanes/outcome-skills/h2h/breadth/fallback.ts";
import { ATTRIBUTION, b2Body, candidateOf, writeBUnit } from "../../lanes/outcome-skills/h2h/breadth/oracle-b.ts";
import { parseLocal, unitParser, type ReportFormat } from "../../lanes/outcome-skills/h2h/breadth/parse.ts";
import { candidateRunners, chooseRecipe, isDrop, testPlan, type RepoFacts, type TestPlan } from "../../lanes/outcome-skills/h2h/breadth/recipes.ts";
import { assertStored, type ImageStore } from "../../lanes/outcome-skills/h2h/breadth/store.ts";

const P40 = "1234567890abcdef1234567890abcdef12345678", C40 = "abcdef1234567890abcdef1234567890abcdef12";
const REF = "127.0.0.1:5000/h2h@sha256:" + "f".repeat(64);
const LONG = "When a GraphQL query nests aliases past the configured limit the server still parses the whole document, so one request can pin a worker for seconds and exhaust the pool. Requests from unauthenticated clients reach this path.";
const fakeStore = (held: string[]): ImageStore => ({ kind: "registry", location: "127.0.0.1:5000/h2h", push: () => ({ ref: REF, digest: REF.split("@")[1]! }), has: (r) => held.includes(r), pull: (r) => r });
const fails = (f: () => unknown, code: string) => expect(f).toThrow(new RegExp("^" + code));
const pkgFacts = (files: string[], pkg: object): RepoFacts => ({ files, texts: { "package.json": JSON.stringify(pkg) } });

describe("gates, one good and one bad case each", () => {
  test("told-mode screen over B2's stripped body", () => {
    const adv = { summary: "Alias depth is not limited", details: LONG + "\n\nFixed in https://github.com/acme/lib/commit/" + C40 + " (" + C40.slice(0, 7) + ") and https://github.com/acme/lib/pull/9.", references: [{ type: "FIX", url: "https://example.com/acme/patch-notes" }] };
    const body = b2Body(adv, { commit: C40, parent: P40 });
    expect(body).not.toContain(C40.slice(0, 7));
    expect(body).not.toContain("/commit/");
    expect(body).not.toContain("/pull/");
    expect(toldScreen(body, "")).toBeNull();
    expect(toldScreen(b2Body({ summary: "Short", details: "Too short." }, { commit: C40, parent: P40 }), "")).toEqual({ rule: "issue_short", value: 17 });
    expect(toldScreen(LONG + "\n@@ -1 +1 @@\n", "")?.rule).toBe("diff_block");
    const added = "+  if (depth > options.maxAliasDepth) throw new Error('too deep');\n+  const counted = countAliases(document.definitions, options);\n";
    expect(toldScreen(LONG + "\nif (depth > options.maxAliasDepth) throw new Error('too deep');\nconst counted = countAliases(document.definitions, options);", added)?.rule).toBe("fix_lines");
    expect(ATTRIBUTION("GHSA-1")).toBe("Adapted from GitHub Advisory Database advisory GHSA-1 (CC-BY-4.0).");
  });
  test("lockfile, runner, reporter, retries and tests found", () => {
    expect(isDrop(chooseRecipe("B2", "npm", pkgFacts(["package.json", "yarn.lock"], {})))).toBe(false);
    expect(chooseRecipe("B2", "npm", pkgFacts(["package.json"], {}))).toMatchObject({ code: "E_H2H_B_NO_LOCKFILE" });
    expect(candidateRunners("B2", "npm", pkgFacts(["package.json"], { devDependencies: { mocha: "10" } }))).toEqual(["mocha"]);
    expect(candidateRunners("B2", "npm", pkgFacts(["package.json"], {}))).toMatchObject({ code: "E_H2H_B_NO_RUNNER" });
    expect(isDrop(testPlan("karma", ["t.js"], pkgFacts(["package.json", "karma.conf.js"], { devDependencies: { "karma-junit-reporter": "2" } })))).toBe(false);
    expect(testPlan("web-test-runner", ["t.js"], pkgFacts(["package.json"], {}))).toMatchObject({ code: "E_H2H_B_NO_REPORTER" });
    expect(isDrop(testPlan("mocha", ["t.js"], pkgFacts(["package.json"], {})))).toBe(false);
    expect(testPlan("mocha", ["t.js"], { ...pkgFacts(["package.json"], {}), retries: { jest_retry_times: false, mocha_retries: true, surefire_rerun: false } })).toMatchObject({ code: "E_H2H_B_RETRIES" });
    expect(testPlan("maven", ["README.md"], { files: ["pom.xml"], texts: {} })).toMatchObject({ code: "E_H2H_B_NO_TESTS" });
    expect(readDiscovery("===H2H_DISCOVER retries===\njest_retry_times ./a.test.js\n").retries.jest_retry_times).toBe(true);
  });
  test("report parse: a TRX report parses, an unknown format refuses", () => {
    const trx = '<?xml version="1.0"?><TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010"><Results><UnitTestResult testId="1" testName="Ns.CalcTests.Adds" outcome="Passed"/><UnitTestResult testId="2" testName="Ns.CalcTests.Breaks" outcome="Failed"/></Results><TestDefinitions><UnitTest id="1" name="Adds"><TestMethod className="Ns.CalcTests" name="Adds"/></UnitTest><UnitTest id="2" name="Breaks"><TestMethod className="Ns.CalcTests" name="Breaks"/></UnitTest></TestDefinitions></TestRun>';
    const r = parseLocal("trx", "===H2H_REPORT .h2h-reports/h2h-0.trx===\n" + trx + "\n");
    expect(Object.values(r).sort()).toEqual(["fail", "pass"]);
    fails(() => unitParser("tap" as ReportFormat), "E_H2H_B_REPORT");
  });
  test("image store: only a stored digest the unit list records", () => {
    expect(() => assertStored(fakeStore([REF]), REF, REF)).not.toThrow();
    fails(() => assertStored(fakeStore([REF]), "h2h-b/acme:latest"), "E_H2H_B_STORE");
    fails(() => assertStored(fakeStore([REF]), REF, REF.replace(/f{64}$/, "e".repeat(64))), "E_H2H_B_STORE");
    fails(() => assertStored(fakeStore([]), REF), "E_H2H_B_STORE");
  });
  test("5 base and 5 fixed runs: a fail-to-pass test that passes 4 of 5 fixed runs makes the unit unstable", () => {
    const f2p = ["t::fails"];
    const base = Array.from({ length: 5 }, () => ({ "t::fails": "fail", "t::ok": "pass" }));
    const fixed = Array.from({ length: 5 }, () => ({ "t::fails": "pass", "t::ok": "pass" }));
    expect(judge(f2p, base, fixed).code).toBe("kept");
    expect(judge(f2p, base, fixed).stable).toContain("t::ok");
    expect(judge(f2p, base, [...fixed.slice(0, 4), { "t::fails": "fail", "t::ok": "pass" }]).code).toBe("E_SM_ORACLE_UNSTABLE");
    expect(readPrereg().classes.B.browser_oracle_runs).toBe(5);
  });
  test("B1 floor", () => {
    expect(planB({ b1: { primary: 20, widened: 0, multilang: 0 }, b2: { primary: 99, widened: 0 } }).b1.infeasible).toBe(false);
    expect(planB({ b1: { primary: 19, widened: 0, multilang: 0 }, b2: { primary: 99, widened: 0 } }).b1.code).toBe("E_H2H_B_INFEASIBLE");
  });
});

describe("one B1 unit through every gate", () => {
  test("recipe, runner, plan, told, browser engine, 5+5 keep rule, unit dir", () => {
    const facts = pkgFacts(["package.json", "package-lock.json", "playwright.config.ts", "e2e/focus.spec.ts", "src/focus.ts"], { devDependencies: { "@playwright/test": "1.65.1" } });
    const recipe = chooseRecipe("B1", "npm", facts);
    expect(isDrop(recipe)).toBe(false);
    const runners = candidateRunners("B1", "npm", facts, ["playwright"]);
    expect(runners).toEqual(["playwright"]);
    const plan = testPlan("playwright", ["e2e/focus.spec.ts"], facts) as TestPlan;
    expect(isDrop(plan)).toBe(false);
    const statement = "Focus ring disappears after the dialog closes\n\n" + LONG;
    expect(toldScreen(statement, "+restore()\n")).toBeNull();
    const f2p = ["[chromium]::focus.spec.ts::focus.spec.ts::::focus returns to the trigger"];
    const p2p = ["[chromium]::focus.spec.ts::focus.spec.ts::::dialog opens"];
    const d = readDiscovery("===H2H_DISCOVER playwright-list===\n" + JSON.stringify({ config: { projects: [{ name: "chromium" }] } }) + "\n");
    const bc = browserCheck({ runner: "playwright", format: plan.format, f2p, testFiles: ["e2e/focus.spec.ts"], discovery: d });
    expect(bc.ok).toBe(true);
    const run = (fx: string) => Object.fromEntries([[f2p[0]!, fx], [p2p[0]!, "pass"]]);
    expect(judge(f2p, Array.from({ length: 5 }, () => run("fail")), Array.from({ length: 5 }, () => run("pass"))).code).toBe("kept");
    assertStored(fakeStore([REF]), REF, REF);
    const root = mkdtempSync(join(tmpdir(), "h2h-gates-"));
    try {
      const c = candidateOf("B1", { repo: "acme/web", number: 7, url: "u", merged: "2026-06-02", month: "2026-06", window: "primary", licence: "MIT", runners: ["playwright"], fix: { commit: C40, parent: P40 }, files: { browser_test: 1, test: 1, source: 1, total: 2 }, issue_url: "https://github.com/acme/web/issues/3", statement_sha256: "0".repeat(64), statement_chars: statement.length });
      const u = writeBUnit(join(root, c.id), {
        c, lang: "ts", plan, statement, tests: { f2p, p2p },
        patches: { fix: "diff --git a/src/focus.ts b/src/focus.ts\n+restore()\n", test: "diff --git a/e2e/focus.spec.ts b/e2e/focus.spec.ts\n+test()\n", all: ["e2e/focus.spec.ts", "src/focus.ts"], testFiles: ["e2e/focus.spec.ts"], fixFiles: ["src/focus.ts"], sourceFiles: ["src/focus.ts"] },
        h2h: { kind: "B1", image_ref: REF, runner: "playwright", format: plan.format, ecosystem: "npm", licence: "MIT", statement_sha256: "0".repeat(64), browser: bc, build: { image_id: "sha256:" + "1".repeat(64), dockerfile_sha256: "2".repeat(64) } },
      });
      const back = readUnit(join(root, c.id));
      expect(back.image.ref).toBe(REF);
      expect(back.base_commit).toBe(P40);
      expect(back.commands).toEqual(plan.commands);
      expect(back.fix.files).toEqual(["src/focus.ts"]);
      expect(u.tests.f2p).toEqual(f2p);
      expect(() => writeBUnit(join(root, c.id), { c, lang: "ts", plan, statement, tests: { f2p, p2p }, patches: { fix: "", test: "", all: [], testFiles: [], fixFiles: [], sourceFiles: [] }, h2h: u.h2h })).toThrow(/^E_H2H_B_STORE/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
