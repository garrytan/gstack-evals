// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless tests for the mutation scorer (outcome-per-skill plan v3, sections 3 and 10): the patch reader, the test-unit
// finders, the frozen sample, the scoring rules in both directions, the tool output readers and the pinned images.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, newLine, parsePatch, sourceRanges, unsafePaths } from "../../lanes/outcome-skills/mutation/diff.ts";
import { LANGS, SAMPLE_CAP, SAMPLE_SEED, TOOLS } from "../../lanes/outcome-skills/mutation/pins.ts";
import { outText, rustCollision, rustResults, skipOthers, strykerMutants } from "../../lanes/outcome-skills/mutation/run.ts";
import { reading, record, sample, summary, transplantRan, type Outcome } from "../../lanes/outcome-skills/mutation/score.ts";
import { changedUnits, goUnits, pythonFunctions, pythonModule, pythonUnits, rustModule, rustUnits, tsCallEnd, tsUnits, type Unit } from "../../lanes/outcome-skills/mutation/units.ts";
import { unpinnedInstalls } from "../../src/rig/pins.ts";

const HERE = join(import.meta.dir, "../../lanes/outcome-skills/mutation");

const PATCH = [
  "diff --git a/calc/ops.py b/calc/ops.py",
  "index 1111111..2222222 100644",
  "--- a/calc/ops.py",
  "+++ b/calc/ops.py",
  "@@ -1,4 +1,6 @@",
  " def double(x):",
  "-    return x * 2",
  "+    return x + x",
  "+",
  "+--- not a header",
  " ",
  " ",
  " def half(x):",
  "diff --git a/tests/test_ops.py b/tests/test_ops.py",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/tests/test_ops.py",
  "@@ -0,0 +1,2 @@",
  "+def test_x():",
  "+    assert True",
  "diff --git a/old.py b/old.py",
  "deleted file mode 100644",
  "--- a/old.py",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-x = 1",
  "diff --git a/img.png b/img.png",
  "new file mode 100644",
  "Binary files /dev/null and b/img.png differ",
  "",
].join("\n");

describe("patch reader", () => {
  test("added lines, removed old lines, new, deleted and binary files", () => {
    const f = parsePatch(PATCH);
    expect(f.map((x) => [x.oldPath, x.newPath, x.binary])).toEqual([
      ["calc/ops.py", "calc/ops.py", false],
      [null, "tests/test_ops.py", false],
      ["old.py", null, false],
      [null, "img.png", true],
    ]);
    expect(f[0]!.added).toEqual([2, 3, 4]);
    expect(f[0]!.removed).toEqual([2]);
    expect(f[1]!.added).toEqual([1, 2]);
  });

  test("a content line starting with --- or +++ stays inside its hunk", () => {
    const f = parsePatch(PATCH);
    expect(f[0]!.newPath).toBe("calc/ops.py");
    expect(f.length).toBe(4);
  });

  test("a pure deletion records its old lines, and old lines map to their new place", () => {
    const p = "diff --git a/a.go b/a.go\n--- a/a.go\n+++ b/a.go\n@@ -3,2 +2,0 @@\n-x\n-y\n@@ -9,1 +7,2 @@\n z\n+w\n";
    const f = parsePatch(p)[0]!;
    expect(f.removed).toEqual([3, 4]);
    expect(f.added).toEqual([8]);
    expect([1, 2, 3, 4, 5, 8, 9, 10].map((n) => newLine(f, n))).toEqual([1, 2, null, null, 3, 6, 7, 9]);
  });

  test("header lines after a hunk are not headers, and paths that leave the repository are named", () => {
    const p = "diff --git a/a_test.go b/a_test.go\n--- a/a_test.go\n+++ b/a_test.go\n@@ -1 +1 @@\n-x\n+y\n--- a/../../tmp/zz_test.go\n+++ b/../../tmp/zz_test.go\n";
    expect(parsePatch(p).map((f) => [f.oldPath, f.newPath])).toEqual([["a_test.go", "a_test.go"]]);
    const paths = (o: string | null, n: string | null) => [{ oldPath: o, newPath: n, added: [], removed: [], kept: [], shifts: [], binary: false }];
    expect(unsafePaths(paths("a/b.py", "a/b.py"))).toEqual([]);
    expect(unsafePaths(paths(null, ".tox/../../x_test.py"))).toEqual([".tox/../../x_test.py"]);
    expect(unsafePaths(paths("/etc/passwd", null))).toEqual(["/etc/passwd"]);
    expect(unsafePaths(paths("a/./b.py", "a//b.py"))).toEqual(["a/./b.py", "a//b.py"]);
  });

  test("source ranges merge adjacent added lines and skip tests and deleted files", () => {
    expect([...sourceRanges("python", parsePatch(PATCH))]).toEqual([["calc/ops.py", [[2, 4]]]]);
  });

  test("quoted paths with octal escapes", () => {
    const p = 'diff --git "a/caf\\303\\251.go" "b/caf\\303\\251.go"\n--- "a/caf\\303\\251.go"\n+++ "b/caf\\303\\251.go"\n@@ -1 +1 @@\n-a\n+b\n';
    expect(parsePatch(p)[0]!.newPath).toBe("café.go");
  });
});

describe("source and test files", () => {
  const cases: [Parameters<typeof classify>[0], string, ReturnType<typeof classify>][] = [
    ["python", "pkg/mod.py", "source"],
    ["python", "tests/helpers.py", "test"],
    ["python", "pkg/test_mod.py", "test"],
    ["python", "pkg/mod_test.py", "test"],
    ["python", "conftest.py", "test"],
    ["python", "setup.py", "other"],
    ["python", "docs/conf.py", "other"],
    ["python", ".venv/lib/x.py", "other"],
    ["go", "a/b.go", "source"],
    ["go", "a/b_test.go", "test"],
    ["go", "a/testdata/c.go", "other"],
    ["go", "vendor/x/y.go", "other"],
    ["rust", "src/lib.rs", "source"],
    ["rust", "tests/it.rs", "test"],
    ["rust", "crates/x/tests/it.rs", "test"],
    ["rust", "build.rs", "other"],
    ["rust", "examples/e.rs", "other"],
    ["typescript", "src/a.ts", "source"],
    ["typescript", "src/a.test.ts", "test"],
    ["typescript", "src/__tests__/a.ts", "test"],
    ["typescript", "src/a.spec.tsx", "test"],
    ["typescript", "src/a.d.ts", "other"],
    ["typescript", "vitest.config.ts", "other"],
    ["typescript", "node_modules/x/index.js", "other"],
    ["typescript", "README.md", "other"],
  ];
  for (const [lang, path, kind] of cases) test(lang + " " + path + " is " + kind, () => expect(classify(lang, path)).toBe(kind));
});

describe("test units", () => {
  test("brackets and quotes inside Python strings neither stretch a test nor make one", () => {
    const text = 'def test_a():\n    assert render() == "("\n    s = """\ndef test_fake():\nx"""\n    assert s\n\n\ndef test_b():\n    assert 1\n';
    expect(pythonUnits("t.py", text).map((u) => [u.name, u.start, u.end])).toEqual([
      ["t.py::test_a", 1, 6],
      ["t.py::test_b", 9, 10],
    ]);
  });

  test("test( and it( inside TypeScript strings, comments, regexes and templates are not units", () => {
    const text = 'import { expect, test } from "vitest";\n// test("commented", () => {});\ntest("real", () => {\n  expect(render()).toBe("test(");\n  const re = /test(x)/;\n  const t = `it(${f(1)})`;\n});\n';
    expect(tsUnits("a.test.ts", text).map((u) => [u.start, u.end])).toEqual([[3, 7]]);
    expect(skipOthers("a.test.ts", text, new Set([3]))).toBe(text);
  });

  test("Go tests inside raw strings are not units, and a brace line inside one does not end a test", () => {
    const text = "package a\n\nfunc TestReal(t *testing.T) {\n\tsrc := `\nfunc TestFake(t *testing.T) {\n}\n`\n\t_ = src\n}\n";
    expect(goUnits("a_test.go", text).map((u) => [u.name, u.start, u.end])).toEqual([["TestReal", 3, 9]]);
  });

  test("a test's span covers its whole decorator, so a new case in a multiline parametrize table counts", () => {
    const before = "import pytest\n\n\n@pytest.mark.parametrize(\n    \"x\",\n    [1],\n)\ndef test_x(x):\n    assert x\n";
    const after = before.replace("    [1],\n", "    [1, 2],\n");
    const p = "diff --git a/t.py b/t.py\n--- a/t.py\n+++ b/t.py\n@@ -5,3 +5,3 @@\n     \"x\",\n-    [1],\n+    [1, 2],\n )\n";
    expect(pythonUnits("t.py", after).map((u) => [u.name, u.start, u.end])).toEqual([["t.py::test_x", 4, 9]]);
    expect(changedUnits(pythonUnits("t.py", after), parsePatch(p)[0]!, pythonUnits("t.py", before)).map((u) => u.name)).toEqual(["t.py::test_x"]);
  });

  test("a deleted test credits no neighbour, and a test that lost only lines still counts as changed", () => {
    const before = "from m import f\n\n\ndef test_a():\n    assert f(1)\n\n\ndef test_b():\n    assert f(2)\n\n\ndef test_c():\n    assert f(3)\n    assert f(4)\n";
    const drop = "diff --git a/t.py b/t.py\n--- a/t.py\n+++ b/t.py\n@@ -5,10 +5,6 @@\n     assert f(1)\n \n \n-def test_b():\n-    assert f(2)\n-\n-\n def test_c():\n     assert f(3)\n     assert f(4)\n";
    const afterDrop = "from m import f\n\n\ndef test_a():\n    assert f(1)\n\n\ndef test_c():\n    assert f(3)\n    assert f(4)\n";
    expect(changedUnits(pythonUnits("t.py", afterDrop), parsePatch(drop)[0]!, pythonUnits("t.py", before))).toEqual([]);
    const trim = "diff --git a/t.py b/t.py\n--- a/t.py\n+++ b/t.py\n@@ -12,3 +12,2 @@\n def test_c():\n     assert f(3)\n-    assert f(4)\n";
    const afterTrim = before.replace("    assert f(4)\n", "");
    expect(changedUnits(pythonUnits("t.py", afterTrim), parsePatch(trim)[0]!, pythonUnits("t.py", before)).map((u) => u.name)).toEqual(["t.py::test_c"]);
  });

  test("pytest functions and methods, with decorators, and only the touched ones", () => {
    const text = "import pytest\n\n@pytest.mark.parametrize('x', [1, 2])\ndef test_a(x):\n    assert x\n\n\ndef helper():\n    pass\n\n\nclass TestB:\n    def test_c(self):\n        assert (1 +\n2)\n\n    def other(self):\n        pass\n\n\nclass Plain:\n    def test_d(self):\n        pass\n";
    const units = pythonUnits("tests/test_x.py", text);
    expect(units.map((u) => [u.name, u.start, u.end])).toEqual([
      ["tests/test_x.py::test_a", 3, 5],
      ["tests/test_x.py::TestB::test_c", 13, 15],
    ]);
    const adds = (...added: number[]) => ({ oldPath: "tests/test_x.py", newPath: "tests/test_x.py", added, removed: [], kept: [], shifts: [], binary: false });
    expect(changedUnits(units, adds(9)).length).toBe(0);
    expect(changedUnits(units, adds(15)).map((u) => u.name)).toEqual(["tests/test_x.py::TestB::test_c"]);
    expect(changedUnits(units, adds(3)).map((u) => u.name)).toEqual(["tests/test_x.py::test_a"]);
  });

  test("Python functions get mutmut's mangled names and module paths", () => {
    const text = "def f():\n    def inner():\n        pass\n    return 1\n\n\nclass K:\n    @staticmethod\n    def m():\n        return 2\n";
    expect(pythonFunctions(text)).toEqual([
      { mangled: "x_f", start: 1, end: 4 },
      { mangled: "x\u01c1K\u01c1m", start: 8, end: 10 },
    ]);
    expect(pythonModule("src/pkg/a.py")).toBe("pkg.a");
    expect(pythonModule("pkg/__init__.py")).toBe("pkg");
    expect(pythonModule("calc/ops.py")).toBe("calc.ops");
  });

  test("Go TestXxx functions only, scoped by package directory", () => {
    const text = "package a\n\nfunc TestOne(t *testing.T) {\n\tif x {\n\t}\n}\n\nfunc Testlower(t *testing.T) {\n}\n\nfunc TestTwo(t *testing.T) {}\n\nfunc BenchmarkX(b *testing.B) {\n}\n";
    expect(goUnits("pkg/a/a_test.go", text).map((u) => [u.name, u.start, u.end, u.scope])).toEqual([
      ["TestOne", 3, 6, "pkg/a"],
      ["TestTwo", 11, 11, "pkg/a"],
    ]);
  });

  test("Rust #[test] functions with module paths, past strings, comments, lifetimes and char literals", () => {
    const text = [
      "pub fn f<'a>(s: &'a str) -> char { '}' }",
      "#[cfg(test)]",
      "mod tests {",
      "    use super::*;",
      "    /* { nested /* } */ */",
      "    #[test]",
      "    fn one() {",
      '        let s = "}{";',
      '        let r = r#"}"#;',
      "        assert_eq!(f(s), '}');",
      "    }",
      "    #[tokio::test]",
      "    #[should_panic]",
      "    async fn two() {",
      "        // }",
      "    }",
      "    fn helper() {}",
      "    mod inner {",
      "        #[test]",
      "        fn three() {}",
      "    }",
      "}",
    ].join("\n");
    expect(rustUnits("src/parse/mod.rs", "src/parse/mod.rs", text).map((u) => [u.name, u.start, u.end, u.scope])).toEqual([
      ["parse::tests::one", 6, 11, "unit"],
      ["parse::tests::two", 12, 16, "unit"],
      ["parse::tests::inner::three", 19, 20, "unit"],
    ]);
    expect(rustModule("src/lib.rs")).toEqual({ target: "unit", path: [] });
    expect([rustModule("src/main.rs"), rustModule("src/bin/demo.rs"), rustModule("src/bin/demo/main.rs"), rustModule("src/bin/demo/util.rs")].map((m) => m.path)).toEqual([[], [], [], ["util"]]);
    expect(rustModule("src/a/b.rs")).toEqual({ target: "unit", path: ["a", "b"] });
    expect(rustModule("tests/it.rs")).toEqual({ target: "it", path: [] });
    expect(rustModule("tests/big/main.rs")).toEqual({ target: "big", path: [] });
    expect(rustUnits("tests/it.rs", "tests/it.rs", "#[test]\nfn a() {}\n").map((u) => [u.name, u.scope])).toEqual([["a", "it"]]);
  });

  test("Rust src/bin.rs is a library module named bin; only the src/bin/ directory holds binaries", () => {
    expect(rustModule("src/bin.rs")).toEqual({ target: "unit", path: ["bin"] });
    expect(rustUnits("src/bin.rs", "src/bin.rs", "#[cfg(test)]\nmod tests {\n    #[test]\n    fn t() {}\n}\n").map((u) => u.name)).toEqual(["bin::tests::t"]);
    expect([rustModule("src/bin/demo.rs"), rustModule("src/bin/demo/main.rs")].map((m) => m.path)).toEqual([[], []]);
  });

  test("TypeScript test and it calls end where their parentheses close, past strings, templates, regexes and .each tables", () => {
    const text = [
      'import { it, test, expect } from "vitest";',
      'test("a ) b", () => {',
      "  expect(`${1})`).toBe(')');",
      "  expect('x').toMatch(/\\(/);",
      "});",
      "it.each([[1], [2]])('n %s', (n) => {",
      "  expect(n).toBeTruthy();",
      "});",
      "test.skipIf(false)('c', () => {",
      "  // )",
      "});",
      'describe.only("x", () => {});',
      "test('one line', fn)",
    ].join("\n");
    const units = tsUnits("src/a.test.ts", text);
    expect(units.map((u) => [u.start, u.end])).toEqual([
      [2, 5],
      [6, 8],
      [9, 11],
      [13, 13],
    ]);
    expect(tsCallEnd(text, 2, 1)).toBe(5);
  });

  test("skipOthers turns every call outside the kept lines into .skip", () => {
    const text = 'test("a", () => {});\nit.each([1])("b", () => {});\ntest("c", () => {});\n';
    expect(skipOthers("a.test.ts", text, new Set([3]))).toBe('test.skip("a", () => {});\nit.skip.each([1])("b", () => {});\ntest("c", () => {});\n');
  });
});

describe("frozen sample", () => {
  const ids = Array.from({ length: 500 }, (_, i) => "m" + i);
  test("at most the cap, the same ids whatever their order, and every id when under the cap", () => {
    const a = sample(ids);
    expect(a.length).toBe(SAMPLE_CAP);
    expect(sample([...ids].reverse())).toEqual(a);
    expect(new Set(a).size).toBe(SAMPLE_CAP);
    expect(sample(ids.slice(0, 50)).length).toBe(50);
    expect(sample(["b", "a", "b"])).toEqual(["a", "b"]);
  });
  test("the cap is 200 and the seed is frozen; another seed draws another sample", () => {
    expect(SAMPLE_CAP).toBe(200);
    expect(SAMPLE_SEED).toBe("gstack-evals O2 mutation sample, frozen 2026-11-04");
    expect(sample(ids, 10, "other")).not.toEqual(sample(ids, 10));
    expect(sample(ids, 3)).toEqual(sample(ids, 3, SAMPLE_SEED));
  });
});

describe("scoring rules", () => {
  const outcomes = (o: Record<string, Outcome>) => new Map(Object.entries(o));
  test("score = killed / (killed + survived); timeouts and errors are excluded and counted", () => {
    const r = reading({ changed: 3, passing: 2, inScope: 9, sampled: ["a", "b", "c", "d", "e"], outcomes: outcomes({ a: "killed", b: "killed", c: "survived", d: "timeout", e: "error" }) });
    expect(r).toEqual({ status: "scored", score: 2 / 3, tests: { changed: 3, passing: 2, dropped: 1 }, mutants: { in_scope: 9, sampled: 5, killed: 2, survived: 1, timeout: 1, error: 1 } });
  });
  test("strong tests score high and weak tests score low on the same mutants", () => {
    const ids = ["a", "b", "c", "d"];
    expect(reading({ changed: 1, passing: 1, inScope: 4, sampled: ids, outcomes: outcomes({ a: "killed", b: "killed", c: "killed", d: "killed" }) }).score).toBe(1);
    expect(reading({ changed: 1, passing: 1, inScope: 4, sampled: ids, outcomes: outcomes({ a: "survived", b: "survived", c: "survived", d: "survived" }) }).score).toBe(0);
  });
  test("no added or changed test scores 0 as no-tests, even with a tool error", () => {
    expect(reading({ changed: 0, passing: 0, toolError: "x" })).toMatchObject({ status: "no-tests", score: 0 });
  });
  test("tests that all fail on the tree score 0, never better than writing none", () => {
    expect(reading({ changed: 2, passing: 0, inScope: 5 })).toMatchObject({ status: "no-passing-tests", score: 0, tests: { dropped: 2 } });
  });
  test("no mutant, or only timeouts and errors, leaves no score", () => {
    expect(reading({ changed: 1, passing: 1, inScope: 0 })).toMatchObject({ status: "no-mutants", score: null });
    expect(reading({ changed: 1, passing: 1, inScope: 2, sampled: ["a", "b"], outcomes: outcomes({ a: "timeout", b: "error" }) })).toMatchObject({ status: "no-scorable-mutants", score: null, mutants: { timeout: 1, error: 1 } });
  });
  test("a tool error leaves no score, and a sampled mutant with no outcome counts as an error", () => {
    expect(reading({ changed: 1, passing: 1, inScope: 3, sampled: ["a"], toolError: "boom" })).toMatchObject({ status: "tool-error", score: null, detail: "boom" });
    expect(reading({ changed: 1, passing: 1, inScope: 2, sampled: ["a", "b"], outcomes: outcomes({ a: "killed" }) })).toMatchObject({ score: 1, mutants: { killed: 1, error: 1 } });
  });
  test("the record names the tool, version, licence and restriction; summary counts statuses and transplants", () => {
    const own = reading({ changed: 1, passing: 1, inScope: 1, sampled: ["a"], outcomes: outcomes({ a: "killed" }) });
    const r = record("go", own, reading({ changed: 1, passing: 0, notTransplantable: "inline" }));
    expect(r).toMatchObject({ lang: "go", tool_version: TOOLS.go.version, licence: "MIT", restriction: "file", cap: 200 });
    expect(transplantRan(r.transplant)).toBe(false);
    expect(transplantRan(own)).toBe(true);
    const err = record("go", reading({ changed: 1, passing: 1, toolError: "x" }));
    expect(summary([r, err])).toEqual({ lang: "go", trees: 2, by_status: { scored: 1, "tool-error": 1 }, tool_error_rate: 0.5, transplant: { tried: 1, ran: 0 } });
    expect(() => summary([r, record("python", own)])).toThrow(/within one language/);
  });
});

describe("tool output readers", () => {
  test("a container's output is read only through regular files, never through a symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "mutation-out-"));
    try {
      const out = join(root, "out");
      mkdirSync(join(out, "real"), { recursive: true });
      mkdirSync(join(root, "host"));
      writeFileSync(join(root, "host/secret.txt"), "SECRET");
      writeFileSync(join(out, "a.txt"), "ok");
      writeFileSync(join(out, "real/b.txt"), "ok too");
      symlinkSync(join(root, "host/secret.txt"), join(out, "link.txt"));
      symlinkSync(join(root, "host"), join(out, "dir"));
      expect([outText(out, "a.txt"), outText(out, "real/b.txt"), outText(out, "link.txt"), outText(out, "dir/secret.txt"), outText(out, "missing.txt"), outText(out, "real")]).toEqual(["ok", "ok too", null, null, null, null]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("libtest lines, keyed by unit or integration target", () => {
    const log = "     Running unittests src/lib.rs (target/debug/deps/calc-1)\ntest tests::a ... ok\ntest tests::b ... FAILED\n     Running tests/it.rs (target/debug/deps/it-2)\ntest a ... ok\ntest tests::b ... ignored\n";
    expect([...rustResults(log)]).toEqual([
      ["unit\ttests::a", true],
      ["unit\ttests::b", false],
      ["it\ta", true],
      ["it\ttests::b", false],
    ]);
  });

  test("libtest runs per harness: once in the library and once in a binary is one test, twice in one harness is a collision", () => {
    const list = new Set(["Cargo.toml", "src/lib.rs", "src/main.rs", "src/shared.rs", "src/bin/a.rs", "src/bin/b.rs", "tests/it.rs"]);
    const unit = (file: string, name: string, scope = "unit"): Unit => ({ file, name, start: 1, end: 1, scope });
    const run = (header: string, name: string) => "     Running " + header + " (target/debug/deps/x-1)\n\nrunning 1 test\ntest " + name + " ... ok\n\ntest result: ok. 1 passed; 0 failed\n\n";
    const lib = run("unittests src/lib.rs", "shared::tests::t");
    const main = run("unittests src/main.rs", "shared::tests::t");
    expect(rustCollision(lib + main, [unit("src/shared.rs", "shared::tests::t")], list)).toBeNull();
    expect(rustCollision(main, [unit("src/shared.rs", "shared::tests::t")], list)).toBeNull();
    expect(rustCollision(lib + main, [unit("src/lib.rs", "shared::tests::t")], list)).toStartWith("test shared::tests::t ");
    expect(rustCollision(lib + main, [unit("src/shared.rs", "shared::tests::t")], new Set([...list, "crates/b/Cargo.toml"]))).toStartWith("test shared::tests::t ");
    expect(rustCollision(lib + lib, [unit("src/lib.rs", "shared::tests::t")], new Set([...list, "crates/b/Cargo.toml"]))).toStartWith("test shared::tests::t ");
    const a = run("unittests src/bin/a.rs", "tests::t");
    const b = run("unittests src/bin/b.rs", "tests::t");
    expect(rustCollision(a + b, [unit("src/bin/a.rs", "tests::t")], list)).toStartWith("test tests::t ");
    expect(rustCollision(a + b, [unit("src/bin/a.rs", "tests::t"), unit("src/bin/b.rs", "tests::t")], list)).toBeNull();
    expect(rustCollision(run("tests/it.rs", "t") + run("unittests src/lib.rs", "t"), [unit("tests/it.rs", "t", "it")], list)).toStartWith("test t ");
  });
  test("Stryker mutants keyed by exact location, mutator and replacement", () => {
    const m = (line: number, mutatorName: string, status: string) => ({ mutatorName, replacement: "x", status, location: { start: { line, column: 3 }, end: { line, column: 9 } } });
    const got = strykerMutants(JSON.stringify({ files: { "src/a.ts": { mutants: [m(2, "ConditionalExpression", "Killed"), m(2, "EqualityOperator", "Survived")] } } }));
    expect([...got.keys()]).toEqual(["src/a.ts@2:3-2:9#ConditionalExpression=x", "src/a.ts@2:3-2:9#EqualityOperator=x"]);
  });
});

describe("pinned tools (plan v3 section 10)", () => {
  test("one tool per language at the plan's versions, licences and restriction levels", () => {
    expect(LANGS.map((l) => [l, TOOLS[l].tool.split(" ")[0], TOOLS[l].version, TOOLS[l].licence, TOOLS[l].restriction])).toEqual([
      ["rust", "cargo-mutants", "27.1.0", "MIT", "line"],
      ["typescript", "StrykerJS", "10.1.1", "Apache-2.0", "line"],
      ["python", "mutmut", "3.8.1", "BSD-3-Clause", "function"],
      ["go", "go-mutesting", "v0.0.0-20261002081621-9ce5f731e321", "MIT", "file"],
    ]);
  });
  test("every tool image installs only pinned bytes and names its pinned version", () => {
    for (const l of LANGS) {
      const text = readFileSync(join(HERE, TOOLS[l].dockerfile), "utf8");
      expect(unpinnedInstalls(TOOLS[l].dockerfile, text)).toEqual([]);
      expect(text).toContain(l === "go" ? "go-mutesting@" + TOOLS.go.version : TOOLS[l].version);
    }
  });
  test("the lockfiles pin the same versions", () => {
    const lock = JSON.parse(readFileSync(join(HERE, "images/node-package-lock.json"), "utf8")) as { packages: Record<string, { version?: string; integrity?: string }> };
    expect(lock.packages["node_modules/@stryker-mutator/core"]?.version).toBe("10.1.1");
    expect(lock.packages["node_modules/@stryker-mutator/vitest-runner"]?.version).toBe("10.1.1");
    expect(lock.packages["node_modules/vitest"]).toBeUndefined();
    expect(Object.entries(lock.packages).filter(([k, v]) => k && !v.integrity)).toEqual([]);
    const req = readFileSync(join(HERE, "images/python-requirements.txt"), "utf8");
    expect(req).toMatch(/^mutmut==3\.8\.1 \\\n {4}--hash=sha256:[0-9a-f]{64}/m);
    for (const block of req.split(/\n(?=\S)/).filter(Boolean)) expect(block).toMatch(/^[\w.-]+==[\w.]+ \\\n {4}--hash=sha256:[0-9a-f]{64}/);
  });
});
