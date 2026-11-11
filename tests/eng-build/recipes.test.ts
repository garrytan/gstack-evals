// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless tests of the eng-review build read's recipes, parsers and case classifier (lanes/eng-build/recipes.ts) and
// the verifier's new record parsers (lanes/real-outcome/task/record.ts). Synthetic records only; no Docker.
import { describe, expect, test } from "bun:test";
import { parseCargo, parseJestJson, parseMochaJson, parseNodeEvents, resultFor } from "../../lanes/real-outcome/task/record.ts";
import { caseClass, classifyLog, ecoOfFile, findProject, needRecipe, nodeRunner, parsePytestJunit, recipeFor, runClasses, runnable, screenTest, verifierRunner } from "../../lanes/eng-build/recipes.ts";
import { EbError } from "../../lanes/eng-build/errors.ts";
import { parseRecord } from "../../lanes/real-outcome/task/verify.ts";

const code = (f: () => unknown): string => {
  try {
    f();
  } catch (error) {
    return error instanceof EbError ? error.code : "other";
  }
  return "none";
};

describe("detection and recipes", () => {
  test("files map to ecosystems, and only Go, Node, Python and Rust have a recipe", () => {
    expect(["a.go", "a.ts", "a.py", "a.rs", "a.php", "a.kt"].map(ecoOfFile)).toEqual(["go", "node", "python", "rust", "php", "jvm"]);
    expect(code(() => needRecipe("u1", "php"))).toBe("E_EB_NO_RECIPE");
    expect(code(() => needRecipe("u1", "rust"))).toBe("none");
    expect(runnable("node", "src/a.test.ts")).toBe(true);
    expect(runnable("node", "node_modules/x/a.test.js")).toBe(false);
    expect(runnable("python", "tests/test_x.py")).toBe(true);
    expect(runnable("python", "tests/helpers.py")).toBe(false);
    expect(runnable("go", "pkg/x_test.go")).toBe(true);
  });

  test("the project is the nearest manifest, and the install root holds the lockfile", () => {
    const listing = new Set(["pnpm-lock.yaml", "package.json", "packages/a/package.json", "packages/a/src/x.test.ts", "crates/c/Cargo.toml", "Cargo.lock", "Cargo.toml"]);
    expect(findProject("node", "packages/a/src/x.test.ts", listing)).toEqual({ root: "", projdir: "packages/a", marker: "package.json" });
    expect(findProject("rust", "crates/c/src/lib.rs", listing)).toEqual({ root: "", projdir: "crates/c", marker: "Cargo.toml" });
    expect(findProject("go", "x_test.go", listing)).toBeNull();
  });

  test("node recipes pick their package manager and image from the tree", () => {
    const files: Record<string, string> = { "package.json": JSON.stringify({ engines: { node: ">=20" }, scripts: { build: "tsc" } }), "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" };
    const r = recipeFor("node", (p) => files[p] ?? null, "", new Set(Object.keys(files)));
    expect(r.pm).toBe("pnpm");
    expect(r.images[0]).toBe("node:22");
    expect(r.install("/work")).toContain("pnpm install --frozen-lockfile");
    expect(r.build!("/testbed")).toContain("npm run build");
    for (const [lock, pm] of [["yarn.lock", "yarn"], ["bun.lock", "bun"], ["package-lock.json", "npm"]]) expect(recipeFor("node", () => null, "", new Set([lock])).pm).toBe(pm as never);
    expect(recipeFor("python", () => null, "", new Set(["uv.lock", "pyproject.toml"])).install("/work")).toContain("uv sync --frozen");
    expect(recipeFor("go", (p) => (p === "go.mod" ? "module x\n\ngo 1.23\n" : null), "", new Set()).images[0]).toBe("golang:1.23");
    expect(recipeFor("rust", () => null, "", new Set()).images).toEqual(["rust:1"]);
  });

  test("the node runner comes from the test files' imports, then the project's dependencies; bun test has no recipe", () => {
    expect(nodeRunner("u", ["import { it } from 'vitest'"], [])).toBe("vitest");
    expect(nodeRunner("u", ["import test from 'node:test'"], [])).toBe("nodetest");
    expect(nodeRunner("u", ["jest.fn()"], [])).toBe("jest");
    expect(nodeRunner("u", [""], [{ devDependencies: { mocha: "10" } }])).toBe("mocha");
    expect(code(() => nodeRunner("u", ["import { test } from 'bun:test'"], []))).toBe("E_EB_NO_RECIPE");
  });

  test("the verifier runner comes from the image's own install, and vitest 3.1 or newer loads its config without writing", () => {
    const tree: Record<string, string> = { "package.json": JSON.stringify({ devDependencies: { vitest: "3" } }), "package-lock.json": "{}" };
    const recipe = recipeFor("node", (p) => tree[p] ?? null, "", new Set(Object.keys(tree)));
    const img: Record<string, string> = { "node_modules/vitest/vitest.mjs": "", "node_modules/vitest/package.json": JSON.stringify({ version: "3.2.4" }) };
    const r = verifierRunner("u", recipe, "", [{ path: "a.test.ts", text: "import { it } from 'vitest'" }], (p) => tree[p] ?? null, (p) => img[p] ?? null);
    expect(r).toMatchObject({ kind: "vitest", bin: "node_modules/vitest/vitest.mjs", args: ["--configLoader", "runner"] });
    expect(code(() => verifierRunner("u", recipe, "", [{ path: "a.test.ts", text: "import { it } from 'vitest'" }], (p) => tree[p] ?? null, () => null))).toBe("E_EB_IMAGE");
    expect(screenTest(r, ["a.test.ts"], "/work/.eb-out/m")).toContain("--reporter=json --outputFile=/work/.eb-out/m.json");
  });
});

describe("the case classifier carries the primary", () => {
  const fail = (o: object) => ({ status: "fail" as const, ...o });
  test("Python AttributeError, NameError and ImportError are never assert", () => {
    for (const exc of ["AttributeError", "NameError", "ImportError", "ModuleNotFoundError"]) expect(caseClass("pytest", fail({ cls: "assert", exc, msg: exc + ": x" }), {}, false)).toBe("missing_name");
    expect(caseClass("pytest", fail({ cls: "assert", exc: "AssertionError", msg: "assert 1 == 2" }), {}, false)).toBe("assert");
    expect(caseClass("pytest", fail({ cls: "load", msg: "fixture 'db' not found" }), {}, false)).toBe("load");
  });
  test("a JS ReferenceError or a TypeError calling or reading through undefined is never assert", () => {
    expect(caseClass("jest", fail({ cls: "assert", msg: "TypeError: m.mul is not a function" }), {}, false)).toBe("missing_name");
    expect(caseClass("vitest", fail({ cls: "assert", msg: "ReferenceError: nope is not defined" }), {}, false)).toBe("missing_name");
    expect(caseClass("vitest", fail({ cls: "assert", msg: "TypeError: (0 , mul) is not a function" }), {}, false)).toBe("missing_name");
    expect(caseClass("vitest", fail({ cls: "assert", msg: "TypeError: (0 , __vi_import_0__.mul) is not a function" }), {}, false)).toBe("missing_name");
    expect(caseClass("mocha", fail({ cls: "assert", msg: "TypeError: Cannot read properties of undefined (reading 'x')" }), {}, false)).toBe("missing_name");
    expect(caseClass("nodetest", fail({ cls: "assert", msg: "AssertionError: 3 == 4" }), {}, false)).toBe("assert");
    expect(caseClass("jest", fail({ cls: "assert", msg: "src/a.ts: error TS2339: Property" }), {}, false)).toBe("compile");
  });
  test("Go and Rust compile errors, and collection or load errors, are never assert", () => {
    expect(caseClass("go", fail({ cls: "missing_name", msg: "undefined: Foo" }), {}, true)).toBe("compile");
    expect(caseClass("cargo", fail({ cls: "load", msg: "could not compile" }), {}, true)).toBe("compile");
    expect(caseClass("pytest", fail({ cls: "load", msg: "ERROR collecting" }), {}, true)).toBe("load");
    expect(caseClass("jest", fail({ cls: "missing_name", msg: "does not provide an export named 'x'" }), {}, true)).toBe("missing_name");
  });
  test("a timed-out run, a stopped run, a skip and a missing case are not results", () => {
    expect(caseClass("go", { status: "pass" }, { timed_out: true }, false)).toBe("timeout");
    expect(caseClass("go", { status: "pass" }, { stopped: true }, false)).toBe("no_result");
    expect(caseClass("go", { status: "skip" }, {}, false)).toBe("no_result");
    expect(caseClass("go", { status: "missing" }, {}, false)).toBe("no_result");
    expect(caseClass("go", { status: "pass" }, {}, false)).toBe("pass");
  });
  test("runClasses reads a case through its file's collection failure", () => {
    const parsed = parseCargo("error[E0425]: cannot find function \u0060mul\u0060 in this scope\nerror: could not compile \u0060ebcalc\u0060 (lib test) due to 1 previous error\n");
    expect(runClasses("cargo", parsed, ["src/lib.rs::tests::muls"], {})).toEqual({ "src/lib.rs::tests::muls": "compile" });
  });
  test("step logs classify by the first matching pattern", () => {
    expect(classifyLog("npm ERR! getaddrinfo ENOTFOUND registry")).toBe("network_needed");
    expect(classifyLog("")).toBe("empty_log");
  });
});

describe("record parsers", () => {
  test("jest and vitest json: per assertion, and a suite that failed to run fails its file", () => {
    const p = parseJestJson(JSON.stringify({ testResults: [
      { name: "/testbed/test/a.test.js", status: "failed", assertionResults: [{ ancestorTitles: ["calc"], title: "adds", fullName: "calc adds", status: "passed" }, { fullName: "calc bad", status: "failed", failureMessages: ["Error: expect(received).toBe(expected)"] }, { fullName: "calc todo", status: "todo" }] },
      { name: "/testbed/test/b.test.js", status: "failed", message: "Cannot find module '../src/b.js' from 'test/b.test.js'", assertionResults: [] },
    ] }));
    expect(p.results["test/a.test.js::calc adds"]).toEqual({ status: "pass" });
    expect(p.results["test/a.test.js::calc bad"]).toMatchObject({ status: "fail", cls: "assert" });
    expect(p.results["test/a.test.js::calc todo"].status).toBe("skip");
    expect(resultFor(p, "test/b.test.js::x")).toMatchObject({ status: "fail", cls: "load" });
    expect(parseJestJson("not json").notes).toEqual(["unparsable json record"]);
  });
  test("mocha json: a failed hook fails its file", () => {
    const p = parseMochaJson(JSON.stringify({ passes: [{ fullTitle: "calc adds", file: "/testbed/t/m.js" }], failures: [{ fullTitle: "calc ref", file: "/testbed/t/m.js", err: { name: "ReferenceError", message: "nope is not defined" } }, { fullTitle: '"before all" hook in "db"', file: "/testbed/t/d.js", err: { message: "boom" } }], pending: [] }));
    expect(p.results["t/m.js::calc adds"]).toEqual({ status: "pass" });
    expect(p.results["t/m.js::calc ref"]).toMatchObject({ status: "fail", cls: "missing_name", name: "nope" });
    expect(resultFor(p, "t/d.js::db x")).toMatchObject({ status: "fail", cls: "load" });
  });
  test("node:test events from the verifier's reporter: suites in the id, and a file that failed to load", () => {
    const lines = [
      { event: "test:pass", path: ["grp", "inner"], file: "/testbed/t/n.test.js" },
      { event: "test:fail", path: ["ref"], file: "/testbed/t/n.test.js", msg: "ReferenceError: nope is not defined" },
      { event: "test:pass", path: ["sk"], file: "/testbed/t/n.test.js", skip: true },
      { event: "test:fail", path: ["t/bad.test.js"], file: "/testbed/t/bad.test.js", msg: "test failed" },
    ].map((x) => JSON.stringify(x));
    const p = parseNodeEvents(lines.join("\n"));
    expect(p.results["t/n.test.js::grp > inner"]).toEqual({ status: "pass" });
    expect(p.results["t/n.test.js::ref"]).toMatchObject({ cls: "missing_name" });
    expect(p.results["t/n.test.js::sk"].status).toBe("skip");
    expect(resultFor(p, "t/bad.test.js::any")).toMatchObject({ status: "fail", cls: "load" });
    const gone = parseNodeEvents(JSON.stringify({ event: "test:fail", path: ["t/m.test.js"], file: "/testbed/t/m.test.js", msg: "test failed SyntaxError: The requested module '../src/calc.js' does not provide an export named 'mul'" }));
    expect(resultFor(gone, "t/m.test.js::calc > muls")).toMatchObject({ status: "fail", cls: "missing_name", name: "mul" });
  });
  test("a node run whose record holds nothing fails every id from its stderr; a record with results ignores stderr", () => {
    const mocha = { kind: "mocha" as const, root: "", bin: "node_modules/mocha/bin/mocha.js", config: null, build: null, node_args: [], args: [] };
    const files = (record: string | null, stderr: string | null) => (f: string) => (f === "record.json" ? record : f === "stderr.txt" ? stderr : null);
    const died = parseRecord(mocha, files(null, "SyntaxError: The requested module '../src/calc.js' does not provide an export named 'mul'\n"));
    expect(resultFor(died, "test/calc.spec.js::calc muls")).toMatchObject({ status: "fail", cls: "missing_name", name: "mul" });
    const crashed = parseRecord(mocha, files("", "Error: boom\n    at x.js:1\n"));
    expect(resultFor(crashed, "test/calc.spec.js::calc muls")).toMatchObject({ status: "fail", cls: "load" });
    expect(parseRecord(mocha, files(null, ""))).toEqual({ results: {}, seen: [], notes: [] });
    const ok = parseRecord(mocha, files(JSON.stringify({ passes: [{ fullTitle: "calc adds", file: "/testbed/test/calc.spec.js" }], failures: [], pending: [] }), "Error: noise\n"));
    expect(ok.results).toEqual({ "test/calc.spec.js::calc adds": { status: "pass" } });
  });
  test("cargo text: ids by target source, and a panic is an assert", () => {
    const text = ["     Running unittests src/lib.rs (target/debug/deps/x-1)", "test tests::adds ... ok", "test tests::bad ... FAILED", "", "---- tests::bad stdout ----", "thread 'tests::bad' panicked at src/lib.rs:9:30:", "assertion failed", "", "failures:", "     Running tests/it.rs (target/debug/deps/it-2)", "test outer ... ok", "test slow ... ignored"].join("\n");
    const p = parseCargo(text, "crates/c");
    expect(Object.keys(p.results).sort()).toEqual(["crates/c/src/lib.rs::tests::adds", "crates/c/src/lib.rs::tests::bad", "crates/c/tests/it.rs::outer", "crates/c/tests/it.rs::slow"]);
    expect(p.results["crates/c/src/lib.rs::tests::bad"]).toMatchObject({ status: "fail", cls: "assert" });
    expect(p.results["crates/c/src/lib.rs::tests::bad"].msg).toContain("panicked");
  });
  test("pytest junit: node ids from file attributes, and a collection error fails its file", () => {
    const xml = '<?xml version="1.0"?><testsuites><testsuite><testcase classname="tests.test_x" name="test_ok" file="tests/test_x.py"/><testcase classname="tests.test_x.TestC" name="test_m" file="tests/test_x.py"><failure message="AttributeError: module \'calc\' has no attribute \'mul\'">E   AttributeError</failure></testcase><testcase classname="" name="tests.test_y" ><error message="collection failure">ImportError: cannot import name \'z\'</error></testcase></testsuite></testsuites>';
    const p = parsePytestJunit(xml);
    expect(p.results["tests/test_x.py::test_ok"]).toEqual({ status: "pass" });
    expect(p.results["tests/test_x.py::TestC::test_m"]).toMatchObject({ status: "fail", exc: "AttributeError" });
    expect(caseClass("pytest", p.results["tests/test_x.py::TestC::test_m"], {}, false)).toBe("missing_name");
    expect(resultFor(p, "tests/test_y.py::test_a")).toMatchObject({ status: "fail", cls: "load" });
  });
});
