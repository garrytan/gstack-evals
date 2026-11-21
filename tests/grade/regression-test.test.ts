// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { regressionTest } from "../../src/grade/regression-test.ts";

const none = () => null;
const add = (path: string, lines: string[]) =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => "+" + l).join("\n")}\n`;
const edit = (path: string, at: number, ctx: string[], added: string[], removed: string[] = []) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -${at},${ctx.length + removed.length} +${at},${ctx.length + added.length} @@\n${ctx.map((l) => " " + l).join("\n")}\n${removed.map((l) => "-" + l).join("\n")}${removed.length ? "\n" : ""}${added.map((l) => "+" + l).join("\n")}${added.length ? "\n" : ""}`;
const del = (path: string, lines: string[]) =>
  `diff --git a/${path} b/${path}\ndeleted file mode 100644\n--- a/${path}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n${lines.map((l) => "-" + l).join("\n")}\n`;

describe("regressionTest", () => {
  test("a new Python test file counts, a source-only change does not", () => {
    const src = edit("pkg/core.py", 1, ["def f():"], ["    return 2"], ["    return 1"]);
    expect(regressionTest(src, "python", [], none)).toEqual({ added: false, files: [], lines: 0 });
    const r = regressionTest(src + add("tests/test_core.py", ["from pkg.core import f", "", "def test_f():", "    assert f() == 2"]), "python", [], none);
    expect(r).toEqual({ added: true, files: ["tests/test_core.py"], lines: 3 });
  });

  test("a test case added to an existing test file counts", () => {
    const p = edit("src/parse.test.ts", 10, ["});"], ["test(\"empty input\", () => {", "  expect(parse(\"\")).toEqual([]);", "});"]);
    expect(regressionTest(p, "ts", [], none)).toEqual({ added: true, files: ["src/parse.test.ts"], lines: 3 });
  });

  test("deleting a test file, or removing test lines, adds no test", () => {
    expect(regressionTest(del("tests/test_old.py", ["def test_x():", "    pass"]), "python", [], none).added).toBe(false);
    expect(regressionTest(edit("tests/test_a.py", 1, ["def test_a():"], [], ["    assert 1"]), "python", [], none).added).toBe(false);
  });

  test("blank or whitespace-only added lines do not count", () => {
    expect(regressionTest(edit("tests/test_a.py", 1, ["def test_a():"], ["", "   "]), "python", [], none).added).toBe(false);
  });

  test("a test-like path outside the language's conventions does not count", () => {
    expect(regressionTest(add("pkg/testdata/case1.json", ["{\"a\": 1}"]), "go", [], none).added).toBe(false);
    expect(regressionTest(add("pkg/parse_test.go", ["package pkg"]), "go", [], none).added).toBe(true);
  });

  test("a file in the unit's hidden test set counts even off the conventions", () => {
    const p = add("pkg/checks.py", ["def check_x():", "    assert True"]);
    expect(regressionTest(p, "python", [], none).added).toBe(false);
    expect(regressionTest(p, "python", ["pkg/checks.py"], none)).toEqual({ added: true, files: ["pkg/checks.py"], lines: 2 });
  });

  test("pack planning files never count", () => {
    expect(regressionTest(add(".planning/tests/plan.md", ["- write a test"]), "python", [], none).added).toBe(false);
    expect(regressionTest(add("docs/superpowers/tests/plan.md", ["- write a test"]), "python", [], none).added).toBe(false);
  });

  test("Rust: lines inside an in-source test module of a new file count, the rest of the file does not", () => {
    const p = add("src/lib.rs", ["pub fn two() -> i32 {", "    2", "}", "", "#[cfg(test)]", "mod tests {", "    use super::*;", "    #[test]", "    fn it() { assert_eq!(two(), 2); }", "}"]);
    const r = regressionTest(p, "rust", [], none);
    expect(r.added).toBe(true);
    expect(r.files).toEqual(["src/lib.rs"]);
    expect(r.lines).toBe(6);
    expect(regressionTest(add("src/lib.rs", ["pub fn two() -> i32 {", "    2", "}"]), "rust", [], none).added).toBe(false);
  });

  test("Rust: an edit that adds a case inside an existing test module counts, read against the base file", () => {
    const base = ["pub fn two() -> i32 {", "    2", "}", "", "#[cfg(test)]", "mod tests {", "    use super::*;", "    #[test]", "    fn it() { assert_eq!(two(), 2); }", "}", ""].join("\n");
    const p = edit("src/lib.rs", 9, ["    fn it() { assert_eq!(two(), 2); }"], ["    #[test]", "    fn again() { assert_eq!(two() + 0, 2); }"]);
    expect(regressionTest(p, "rust", [], (path) => (path === "src/lib.rs" ? base : null))).toEqual({ added: true, files: ["src/lib.rs"], lines: 2 });
    const outside = edit("src/lib.rs", 1, ["pub fn two() -> i32 {"], ["    // two"]);
    expect(regressionTest(outside, "rust", [], (path) => (path === "src/lib.rs" ? base : null)).added).toBe(false);
  });

  test("Rust: an edited source file whose base can't be read gives no module lines", () => {
    const p = edit("src/lib.rs", 9, ["    fn it() { assert_eq!(two(), 2); }"], ["    #[test]", "    fn again() {}"]);
    expect(regressionTest(p, "rust", [], none).added).toBe(false);
  });

  test("Rust tests/ directory counts by path", () => {
    expect(regressionTest(add("tests/it.rs", ["#[test]", "fn t() {}"]), "rust", [], none).lines).toBe(2);
  });
});
