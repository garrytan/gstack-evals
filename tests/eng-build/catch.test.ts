// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless checks of the real-bug catch rule, the compile reading, the test-file rule and the coverage parsers and share.
import { describe, expect, test } from "bun:test";
import { caught, compiledOn, movesWhole } from "../../lanes/eng-build/catch.ts";
import { parseGoCover, parseLcov, share } from "../../lanes/eng-build/coverage.ts";
import type { CaseClass } from "../../lanes/eng-build/types.ts";

const R = (...c: CaseClass[]) => c;

describe("real-bug catch rule", () => {
  test("a case red at assertion level in all 3 merged runs and green in all 3 fixed runs is a catch", () => {
    expect(caught({ a: R("assert", "assert", "assert") }, { a: R("pass", "pass", "pass") }, 3)).toBe(true);
  });
  test("red in 2 of 3 merged runs, a missing name, a compile error, a fixed run that fails or a missing run is not", () => {
    expect(caught({ a: R("assert", "pass", "assert") }, { a: R("pass", "pass", "pass") }, 3)).toBe(false);
    expect(caught({ a: R("missing_name", "missing_name", "missing_name") }, { a: R("pass", "pass", "pass") }, 3)).toBe(false);
    expect(caught({ a: R("compile", "compile", "compile") }, { a: R("pass", "pass", "pass") }, 3)).toBe(false);
    expect(caught({ a: R("assert", "assert", "assert") }, { a: R("pass", "assert", "pass") }, 3)).toBe(false);
    expect(caught({ a: R("assert", "assert") }, { a: R("pass", "pass") }, 3)).toBe(false);
    expect(caught({ a: R("assert", "assert", "assert") }, {}, 3)).toBe(false);
  });
  test("one catching case among others is enough", () => {
    expect(caught({ a: R("pass", "pass", "pass"), b: R("assert", "assert", "assert") }, { a: R("pass", "pass", "pass"), b: R("pass", "pass", "pass") }, 3)).toBe(true);
  });
  test("the build's tests compiled on a tree when some own case reached a result in every run", () => {
    expect(compiledOn({ a: R("compile", "compile", "compile"), b: R("pass", "assert", "missing_name") }, 3)).toBe(true);
    expect(compiledOn({ a: R("load", "load", "load") }, 3)).toBe(false);
    expect(compiledOn({ a: R("pass", "no_result", "pass") }, 3)).toBe(false);
    expect(compiledOn({}, 3)).toBe(false);
  });
  test("test files move; runner and build configs, conftest and installed dependencies do not", () => {
    for (const p of ["calc_test.go", "tests/test_ops.py", "test/calc.test.js", "src/__tests__/a.ts", "tests/it.rs"]) expect(movesWhole(p)).toBe(true);
    for (const p of ["calc.go", "pkg/ops.py", "jest.config.js", "tests/conftest.py", "vitest.config.ts", ".mocharc.json", "node_modules/x/test/a.test.js", "go.mod", "Cargo.toml"]) expect(movesWhole(p)).toBe(false);
  });
});

describe("changed-line coverage", () => {
  test("lcov: absolute paths under /testbed and relative paths from the project dir", () => {
    const h = parseLcov("SF:/testbed/web/src/a.js\nDA:1,0\nDA:2,3\nend_of_record\nSF:pkg/ops.py\nDA:4,1\nend_of_record\nSF:/usr/lib/x.js\nDA:1,1\nend_of_record\n", "web");
    expect([...h.keys()].sort()).toEqual(["web/pkg/ops.py", "web/src/a.js"]);
    expect(h.get("web/src/a.js")).toEqual(new Map([[1, 0], [2, 3]]));
  });
  test("go coverprofile: every line of a block, the most runs of any block on a line, other modules ignored", () => {
    const h = parseGoCover("mode: set\nexample.invalid/calc/calc.go:3.24,5.2 1 1\nexample.invalid/calc/calc.go:5.2,7.2 1 0\nother.invalid/x/x.go:1.1,2.2 1 1\n", "example.invalid/calc", "");
    expect(h.get("calc.go")).toEqual(new Map([[3, 1], [4, 1], [5, 1], [6, 0], [7, 0]]));
    expect(h.size).toBe(1);
  });
  test("the share counts executable changed lines, and a file the tool never loaded counts its code lines as not run", () => {
    const changed = new Map([
      ["a.go", { lines: [3, 4, 5, 9], text: [] as string[] }],
      ["b.py", { lines: [1, 2, 3], text: ["def f():", "", "    # note"] }],
    ]);
    const hits = new Map([["a.go", new Map([[3, 1], [4, 0], [5, 2]])]]);
    expect(share(changed, hits)).toEqual({ lines: 4, covered: 2 });
  });
});
