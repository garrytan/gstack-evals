// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { scopeOf } from "../../lanes/outcome-skills/statemachines/scope.ts";

const many = (dir: string, n: number, ext = ".rs") => Array.from({ length: n }, (_, i) => dir + "/f" + i + ext);

describe("scope", () => {
  test("the deepest dir holding every fix file, widened one parent at a time to 10 source files", () => {
    const tracked = [...many("crates/a/src/state", 3), ...many("crates/a/src", 4), ...many("crates/a/tests", 9), ...many("crates/b/src", 8), "crates/a/README.md"];
    const s = scopeOf("rust", tracked, ["crates/a/src/state/f0.rs", "crates/a/src/state/f1.rs"], new Set());
    expect(s).toMatchObject({ dir: "crates", widened: 3 });
    expect(s.files.length).toBe(15);
    expect(scopeOf("rust", [...many("x/y", 12)], ["x/y/f0.rs"], new Set())).toMatchObject({ dir: "x/y", widened: 0 });
    expect(scopeOf("rust", [...many("a", 10)], ["a/f0.rs", "a/f1.rs"], new Set(["a/f1.rs"]))).toMatchObject({ dir: ".", widened: 1 });
  });
  test("the repository root stops the widening", () => {
    expect(scopeOf("go", ["main.go", "x/a.go"], ["x/a.go"], new Set())).toMatchObject({ dir: ".", widened: 1 });
    expect(scopeOf("go", ["main.go"], ["main.go"], new Set())).toMatchObject({ dir: ".", widened: 0 });
  });
});
