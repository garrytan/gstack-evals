// Copyright (c) 2026 Garry Tan. MIT License.
// The breadth report parsers (plan section 6) on reports the real runners wrote (Jest 30, Vitest 3.2, Playwright 1.5x,
// Karma 6 with karma-junit-reporter, Web Test Runner's JUnit reporter, Mocha's xunit, node:test's junit, go test -json,
// cargo test) plus a Surefire report and a TRX file written to their published formats. Paths were rewritten to /testbed.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { idParts, parseLocal, printCommand, printFind, testFileOf, unitParser, type ReportFormat } from "../../lanes/outcome-skills/h2h/breadth/parse.ts";
import { printReading } from "../../lanes/outcome-skills/statemachines/reports.ts";

const F = join(import.meta.dir, "fixtures", "h2h-b");
const read = (f: string) => readFileSync(join(F, f), "utf8");
const framed = (...files: [string, string][]) => files.map(([path, f]) => "===H2H_REPORT " + path + "===\n" + read(f) + "\n").join("");

describe("report parsers", () => {
  test("Jest JSON: pass, fail and skip by file and title", () => {
    const r = parseLocal("jest-json", framed([".h2h-reports/jest.json", "jest.json"]));
    expect(r).toEqual({ "tests/math.test.js::math > adds": "pass", "tests/math.test.js::math > breaks": "fail", "tests/math.test.js::math > later": "skip", "tests/math.test.js::top level": "pass" });
  });
  test("Vitest JSON: one report per project, the project from the report's name", () => {
    const hex = (s: string) => Buffer.from(s).toString("hex");
    const r = parseLocal("vitest-json", framed([".h2h-reports/vitest-" + hex("browser (chromium)") + ".json", "vitest.json"]));
    expect(r["[browser (chromium)]::tests/dom.vt.test.js::dom > has document"]).toBe("pass");
    expect(r["[browser (chromium)]::tests/dom.vt.test.js::dom > fails"]).toBe("fail");
  });
  test("Playwright JUnit: the project rides in the id", () => {
    const r = parseLocal("junit-playwright", framed([".h2h-reports/playwright.xml", "playwright.xml"]));
    expect(r["[chromium]::page.spec.ts::page.spec.ts::::page › sets content"]).toBe("pass");
    expect(r["[chromium]::page.spec.ts::page.spec.ts::::page › fails"]).toBe("fail");
    expect(r["[mobile]::page.spec.ts::page.spec.ts::::page › fails"]).toBe("fail");
    expect(Object.keys(r).length).toBe(4);
  });
  test("Karma and Web Test Runner JUnit keep the browser string in the suite", () => {
    const k = parseLocal("junit", framed([".h2h-reports/karma.xml", "karma.xml"]));
    expect(k).toEqual({ "Chrome Headless 159.0.0.0 (Linux 0.0.0)::karma suite::::karma suite passes": "pass", "Chrome Headless 159.0.0.0 (Linux 0.0.0)::karma suite::::karma suite fails": "fail" });
    const w = parseLocal("junit", framed([".h2h-reports/wtr.xml", "wtr.xml"]));
    expect(w).toEqual({ "Chromium_playwright_/wtr/w.test.js::wtr suite::wtr/w.test.js::wtr passes": "pass", "Chromium_playwright_/wtr/w.test.js::wtr suite::wtr/w.test.js::wtr fails": "fail" });
  });
  test("Mocha xunit, node:test junit and Surefire", () => {
    expect(parseLocal("junit", framed(["m.xml", "mocha.xml"]))).toEqual({ "Mocha Tests::mocha suite::tests/m.mocha.js::ok": "pass", "Mocha Tests::mocha suite::tests/m.mocha.js::bad": "fail", "Mocha Tests::mocha suite::tests/m.mocha.js::skip": "skip" });
    expect(parseLocal("junit", framed(["n.xml", "node.xml"]))).toEqual({ "::test::tests/n.test.mjs::node ok": "pass", "::test::tests/n.test.mjs::node bad": "fail" });
    const s = parseLocal("junit", framed(["a/target/surefire-reports/TEST-com.example.CalcTest.xml", "surefire.xml"]));
    expect(s).toEqual({ "com.example.CalcTest::com.example.CalcTest::::adds": "pass", "com.example.CalcTest::com.example.CalcTest::::breaks": "fail", "com.example.CalcTest::com.example.CalcTest::::throws": "fail", "com.example.CalcTest::com.example.CalcTest::::later": "skip" });
  });
  test("TRX: class and test name, NotExecuted reads skip", () => {
    expect(parseLocal("trx", framed([".h2h-reports/Demo.Tests.trx", "dotnet.trx"]))).toEqual({ "Demo.Tests.CalcTests::Adds": "pass", "Demo.Tests.CalcTests::Breaks": "fail", "Demo.Tests.CalcTests::Later": "skip", "Demo.Tests.CalcTests::Demo.Tests.CalcTests.Theory(x: 1)": "pass" });
  });
  test("go test -json: subtests keep their own status", () => {
    const r = parseLocal("go-json", framed([".h2h-reports/go-test.json", "go.json"]));
    expect(r).toEqual({ "example.com/demo/pkg/calc::TestAdd": "pass", "example.com/demo/pkg/calc::TestBroken": "fail", "example.com/demo/pkg/calc::TestSkip": "skip", "example.com/demo/pkg/calc::TestTable": "fail", "example.com/demo/pkg/calc::TestTable/one": "pass", "example.com/demo/pkg/calc::TestTable/two": "fail" });
  });
  test("cargo test: targets from cargo's Running lines, hashes dropped", () => {
    const r = parseLocal("cargo", framed([".h2h-reports/cargo.txt", "cargo.txt"]));
    expect(r).toEqual({ "Running unittests src/lib.rs::tests::unit_ignored": "skip", "Running unittests src/lib.rs::tests::unit_ok": "pass", "Running unittests src/lib.rs::tests::unit_bad": "fail", "Running tests/integ.rs::integ_ok": "pass", "Doc-tests demo::src/lib.rs - add (line 3)": "pass" });
  });
  test("a log with no marker parses as one report; a broken report refuses with its code", () => {
    expect(parseLocal("go-json", read("go.json"))["example.com/demo/pkg/calc::TestAdd"]).toBe("pass");
    expect(() => parseLocal("junit", "===H2H_REPORT x.xml===\n<testsuite><testcase name=")).toThrow(/^E_H2H_B_REPORT/);
    expect(() => parseLocal("jest-json", "===H2H_REPORT j.json===\n{not json")).toThrow(/^E_H2H_B_REPORT/);
    expect(() => unitParser("tap" as ReportFormat)).toThrow(/^E_H2H_B_REPORT/);
  });
  test("a test id that fails in one report and passes in another stays failed", () => {
    expect(parseLocal("junit", framed(["a.xml", "mocha.xml"], ["b.xml", "mocha.xml"]))["Mocha Tests::mocha suite::tests/m.mocha.js::bad"]).toBe("fail");
  });
});

describe("ids back to the fix's test files", () => {
  test("each format maps its tests to the files the fix changes", () => {
    expect(testFileOf("jest-json", "tests/math.test.js::math > adds", ["tests/math.test.js"])).toBe("tests/math.test.js");
    expect(testFileOf("junit-playwright", "[chromium]::page.spec.ts::page.spec.ts::::page › fails", ["e2e/page.spec.ts"])).toBe("e2e/page.spec.ts");
    expect(testFileOf("junit", "com.example.CalcTest::com.example.CalcTest::::adds", ["core/src/test/java/com/example/CalcTest.java"])).toBe("core/src/test/java/com/example/CalcTest.java");
    expect(testFileOf("go-json", "example.com/demo/pkg/calc::TestAdd", ["pkg/calc/calc_test.go"])).toBe("pkg/calc/calc_test.go");
    expect(testFileOf("go-json", "example.com/demo/pkg/other::TestAdd", ["pkg/calc/calc_test.go"])).toBeNull();
    expect(testFileOf("cargo", "Running tests/integ.rs::integ_ok", ["tests/integ.rs"])).toBe("tests/integ.rs");
    expect(testFileOf("trx", "Demo.Tests.CalcTests::Adds", ["tests/Demo.Tests/CalcTests.cs"])).toBe("tests/Demo.Tests/CalcTests.cs");
    expect(testFileOf("junit", "Chromium_playwright_/wtr/w.test.js::wtr suite::wtr/w.test.js::wtr passes", ["wtr/w.test.js"])).toBe("wtr/w.test.js");
    expect(testFileOf("junit", "Chrome Headless 159.0.0.0 (Linux 0.0.0)::karma suite::::karma suite passes", ["karma/k.test.js"])).toBeUndefined();
    expect(idParts("vitest-json", "[unit]::a.test.ts::x > y")).toEqual({ context: "unit", classname: "", file: "a.test.ts", name: "x > y" });
  });
  test("the print command reads as report files, so the stale-report rule covers it", () => {
    const r = printReading({ rebuild: [], test: ["mkdir -p .h2h-reports && npx jest --json --outputFile=.h2h-reports/jest.json"], print: [printCommand([".h2h-reports/*.json"])] });
    expect(r.kind).toBe("report");
    expect(r.paths).toEqual([{ cwd: "", glob: ".h2h-reports/*.json" }]);
    const m = printReading({ rebuild: [], test: ["mvn -B -o test"], print: [printFind(".", "*/target/surefire-reports/TEST-*.xml")] });
    expect(m).toEqual({ kind: "report", paths: [{ cwd: "", find: { root: ".", follow: false, tests: [["-path", "*/target/surefire-reports/TEST-*.xml"]] } }] });
  });
});
