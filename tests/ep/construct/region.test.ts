// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless tests of the planted-unit region finder, test-case remover and stubber (lanes/eng-planted/construct/region.ts
// and stub.ts) on synthetic files.
import { describe, expect, test } from "bun:test";
import { enclosing, functionsOf, lngOf, parseErrors, pruneImports, removeTestCases, signatureOf } from "../../../lanes/eng-planted/construct/region.ts";
import { stubFile } from "../../../lanes/eng-planted/construct/stub.ts";

describe("region", () => {
  test("languages by extension", () => {
    expect(["a.ts", "a.tsx", "a.mjs", "a.go", "a.py", "a.rs", "a.md"].map(lngOf)).toEqual(["ts", "tsx", "js", "go", "python", "rust", null]);
  });

  test("each hunk maps to its innermost named function, nested ones fold into a chosen outer one, and a hunk outside every function is null", () => {
    const src = "export function a(x) {\n  const inner = () => {\n    return x;\n  };\n  return inner() + 1;\n}\nexport const b = (y) => {\n  return y * 2;\n};\nconst top = 1;\n";
    const fns = functionsOf("js", src);
    expect(fns.map((f) => f.name)).toEqual(["a", "inner", "b"]);
    expect(enclosing(fns, [{ s: 2, e: 2 }, { s: 4, e: 4 }])!.map((f) => f.name)).toEqual(["a"]);
    expect(enclosing(fns, [{ s: 7, e: 7 }])!.map((f) => signatureOf(src, f))).toEqual(["const b = (y)"]);
    expect(enclosing(fns, [{ s: 9, e: 9 }])).toBeNull();
  });

  test("Go: test functions and their comments go, helpers and TestMain stay, and an import only they used is dropped", () => {
    const go = 'package p\n\nimport (\n\t"regexp"\n\t"testing"\n)\n\nfunc helper(t *testing.T) int { return 1 }\n\n// TestA checks a.\nfunc TestA(t *testing.T) {\n\t_ = regexp.MustCompile("a")\n}\n\nfunc BenchmarkB(b *testing.B) {}\n\nfunc TestMain(m *testing.M) {}\n';
    const out = removeTestCases("go", go)!;
    expect(out).toContain("func helper(");
    expect(out).toContain("func TestMain(");
    expect(out).not.toMatch(/TestA|BenchmarkB|regexp|checks a/);
    expect(parseErrors("go", out)).toBe(0);
    expect(removeTestCases("go", 'package p\n\nimport "testing"\n\nfunc TestA(t *testing.T) {}\n')).toBeNull();
  });

  test("Python: test functions and classes go, fixtures stay, and imports only the tests used are dropped", () => {
    const py = "import os\nimport pytest\nfrom pkg import ops, util\n\n\n@pytest.fixture\ndef unit():\n    return util.U\n\n\ndef test_a():\n    assert ops.add(1, 2) == 3\n\n\nclass TestB:\n    def test_x(self):\n        assert os.sep\n";
    const out = removeTestCases("python", py)!;
    expect(out).toContain("def unit():");
    expect(out).toContain("from pkg import util");
    expect(out).not.toMatch(/test_a|TestB|import os|ops/);
    expect(removeTestCases("python", "from pkg import ops\n\n\ndef test_a():\n    assert ops.x\n")).toBeNull();
  });

  test("Rust: #[test] functions go, an inline module keeps its helpers, and a module left with only uses goes", () => {
    const keep = "pub fn f() -> i32 {\n    1\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    fn helper() -> i32 {\n        f()\n    }\n\n    #[test]\n    fn t() {\n        assert_eq!(helper(), 1);\n    }\n}\n";
    const out = removeTestCases("rust", keep)!;
    expect(out).toContain("fn helper()");
    expect(out).not.toContain("fn t()");
    expect(parseErrors("rust", out)).toBe(0);
    const gone = removeTestCases("rust", keep.replace(/\n    fn helper\(\) -> i32 \{\n        f\(\)\n    \}\n/, ""))!;
    expect(gone).not.toContain("mod tests");
    expect(gone).toContain("pub fn f()");
  });

  test("JavaScript: it and test blocks go with describes they empty, hooks and helpers stay, and unused imports are dropped", () => {
    const js = 'import { describe, it, expect } from "vitest";\nimport { add, mul } from "../src/calc.js";\nimport { fixture } from "./fx.js";\n\nconst make = () => fixture(add);\n\ndescribe("calc", () => {\n  it("adds", () => {\n    expect(add(1, 2)).toBe(3);\n  });\n  test.each([[1]])("muls %i", (a) => {\n    expect(mul(a, 1)).toBe(a);\n  });\n});\n\nbeforeEach(() => make());\n';
    const out = removeTestCases("ts", js)!;
    expect(out).toBe('import { add } from "../src/calc.js";\nimport { fixture } from "./fx.js";\n\nconst make = () => fixture(add);\n\nbeforeEach(() => make());\n');
  });

  test("pruneImports drops only bindings the original used and the change stopped using", () => {
    const before = 'import { a, b } from "m";\nimport c from "n";\nexport const x = () => a(b);\n';
    const after = 'import { a, b } from "m";\nimport c from "n";\nexport const x = () => { throw new Error("not implemented"); };\n';
    expect(pruneImports("js", before, after)).toBe('import c from "n";\nexport const x = () => { throw new Error("not implemented"); };\n');
  });
});

describe("stub", () => {
  test("each language's stub keeps the signature, doc comments and a Python docstring, and returns the removed lines", () => {
    const cases: [Parameters<typeof stubFile>[0], string, string, string][] = [
      ["go", 'package p\n\nimport "strings"\n\n// Up upper-cases.\nfunc Up(s string) string {\n\tt := strings.TrimSpace(s)\n\treturn strings.ToUpper(t)\n}\n', 'panic("not implemented")', "// Up upper-cases.\nfunc Up(s string) string {"],
      ["python", 'def f(x):\n    """Doc."""\n    y = x + 1\n    return y\n', "raise NotImplementedError", '    """Doc."""'],
      ["rust", "/// Doc.\npub fn f(x: i32) -> i32 {\n    let y = x + 1;\n    y\n}\n", "todo!()", "/// Doc.\npub fn f(x: i32) -> i32 {"],
      ["ts", "/** Doc. */\nexport function f(x: number): number {\n  const y = x + 1;\n  return y;\n}\n", 'throw new Error("not implemented");', "/** Doc. */\nexport function f(x: number): number {"],
    ];
    for (const [l, text, stub, kept] of cases) {
      const s = stubFile(l, text, functionsOf(l, text))!;
      expect(s.text).toContain(stub);
      expect(s.text).toContain(kept);
      expect(s.removed.join("\n")).toMatch(/x \+ 1|TrimSpace/);
      expect(parseErrors(l, s.text)).toBe(0);
    }
    expect(stubFile("go", 'package p\n\nimport "strings"\n\nfunc Up(s string) string {\n\treturn strings.ToUpper(s)\n}\n', functionsOf("go", 'package p\n\nimport "strings"\n\nfunc Up(s string) string {\n\treturn strings.ToUpper(s)\n}\n'))!.text).not.toContain('"strings"');
  });
});
