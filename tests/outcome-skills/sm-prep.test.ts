// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless tests for unit prep's later rules: the in-source test-module detector and the fix patch split (tests inside the
// fix patch, the mixed-hunk drop and the 1 to 6 count), the screen's use of the split, the dataset's pass word, and the
// leak scan's dependency-cache split. Fixtures are invented minimal repos.
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { splitFix } from "../../lanes/outcome-skills/statemachines/fixsplit.ts";
import { fixtureRepo, gitOut } from "../../lanes/outcome-skills/statemachines/fixtures.ts";
import { rustTestModules, TEST_MODULES } from "../../lanes/outcome-skills/statemachines/langs.ts";
import { classifyHits, hitKind } from "../../lanes/outcome-skills/statemachines/leak.ts";
import { screenOne } from "../../lanes/outcome-skills/statemachines/screen.ts";
import type { Candidate } from "../../lanes/outcome-skills/statemachines/source.ts";
import { passed } from "../../lanes/outcome-skills/statemachines/testrun.ts";

const BASE = [
  "pub fn add(a: i32, b: i32) -> i32 {",
  "    a - b",
  "}",
  "",
  "pub fn label() -> &'static str {",
  '    "}{ not a brace"',
  "}",
  "",
  "// a comment with }",
  "#[cfg(test)]",
  "#[allow(unused)]",
  "mod tests {",
  "    use super::*;",
  '    const RAW: &str = r#"}"#;',
  "    fn keep<'a>(x: &'a str) -> &'a str { x }",
  "    const C: char = '}';",
  "    #[test]",
  "    fn adds() {",
  "        assert_eq!(add(1, 1), 2);",
  "    }",
  "}",
  "",
].join("\n");

const FIXED = BASE.replace("    a - b", "    a + b").replace("        assert_eq!(add(1, 1), 2);\n    }\n", "        assert_eq!(add(1, 1), 2);\n    }\n    #[test]\n    fn adds_negative() {\n        assert_eq!(add(-1, -1), -2);\n    }\n");

/** An invented repo at BASE plus the fix as git diff prints it. */
function fixture(extra: Record<string, string> = {}, fixedExtra: Record<string, string> = {}) {
  const { dir } = fixtureRepo({ "src/lib.rs": BASE, "README.md": "x\n", ...extra });
  writeFileSync(join(dir, "src/lib.rs"), FIXED);
  for (const [p, b] of Object.entries(fixedExtra)) writeFileSync(join(dir, p), b);
  gitOut(dir, "add", "-A");
  const patch = gitOut(dir, "diff", "--cached", "HEAD") + "\n";
  gitOut(dir, "reset", "-q", "--hard", "HEAD");
  return { dir, patch, base: (p: string) => readFileSync(join(dir, p), "utf8") };
}

describe("in-source test modules", () => {
  test("Rust's #[cfg(test)] mod runs from its attribute lines to its closing brace, past braces in strings, chars and comments", () => {
    expect(rustTestModules(BASE)).toEqual([[10, 21]]);
    expect(rustTestModules("#[cfg(test)]\nmod tests;\nfn f() {}\n")).toEqual([]);
    expect(rustTestModules("#[cfg(test)]\npub(crate) mod t {\n  /* } /* nested } */ */\n  fn x() {}\n}\n")).toEqual([[1, 5]]);
    expect(rustTestModules("#[cfg(test)]\nfn helper() {}\n")).toEqual([]);
  });
  test("only Rust has a detector; the other languages keep tests in test files", () => {
    expect(Object.entries(TEST_MODULES).filter(([, v]) => v).map(([k]) => k)).toEqual(["rust"]);
  });
});

describe("the fix patch split", () => {
  test("a hunk inside the test module becomes the fix's tests, and the two parts apply in either order", () => {
    const { dir, patch, base } = fixture();
    const s = splitFix("rust", patch, new Set(), base, "fixture");
    expect(s).toMatchObject({ test_hunks: 1, mixed: [], source_files: ["src/lib.rs"] });
    expect(s.fix).toContain("+    a + b");
    expect(s.fix).not.toContain("adds_negative");
    expect(s.tests).toContain("adds_negative");
    expect(s.tests).not.toContain("a + b");
    writeFileSync(join(dir, "fix.patch"), s.fix);
    writeFileSync(join(dir, "tests.patch"), s.tests);
    gitOut(dir, "apply", "--check", "tests.patch");
    gitOut(dir, "apply", "fix.patch");
    expect(readFileSync(join(dir, "src/lib.rs"), "utf8")).not.toContain("adds_negative");
    gitOut(dir, "apply", "tests.patch");
    expect(readFileSync(join(dir, "src/lib.rs"), "utf8")).toBe(FIXED);
  });

  test("a file whose hunks are all tests is not a source file for the 1 to 6 rule", () => {
    const { patch, base } = fixture({ "src/other.rs": BASE }, { "src/other.rs": FIXED.replace("a + b", "a - b") });
    const s = splitFix("rust", patch, new Set(), base, "fixture");
    expect(s.source_files).toEqual(["src/lib.rs"]);
    expect(s.test_hunks).toBe(2);
  });

  test("a hunk partly inside and partly outside a test module is mixed, so the unit drops", () => {
    const code = "pub fn sub(a: i32) -> i32 {\n    a - 1\n}\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn s() {}\n}\n";
    const { patch, base } = fixture({}, { "src/new.rs": code });
    const s = splitFix("rust", patch, new Set(), base, "fixture");
    expect(s.mixed).toEqual([{ path: "src/new.rs", hunk: 1 }]);
    const cand = { id: "x", lang: "rust", image_digest: "sha256:" + "0".repeat(64), f2p: 1, p2p: 1, fix_source_files: 2, feature_screen: false, split: { source_files: 2, mixed: 1, test_hunks: 1 } } as unknown as Candidate;
    expect(screenOne(cand)).toMatchObject({ code: "E_SM_MIXED_TEST_HUNK", rule: "mixed_test_hunk", lang: "rust" });
    expect(screenOne({ ...cand, split: { source_files: 0, mixed: 0, test_hunks: 2 }, fix_source_files: 0 })).toMatchObject({ code: "E_SM_INELIGIBLE", rule: "fix_source_files_1_to_6" });
    expect(screenOne({ ...cand, split: { source_files: 2, mixed: 0, test_hunks: 2 } })).toBeNull();
  });

  test("a language with no detector keeps the whole fix patch", () => {
    const { patch, base } = fixture();
    expect(splitFix("go", patch, new Set(), base, "fixture")).toMatchObject({ fix: patch, tests: "", test_hunks: 0 });
  });
});

describe("pass word and leak kinds", () => {
  test("only the dataset's own pass word counts", () => {
    expect([passed({ a: "pass" }, "a"), passed({ a: "PASSED" }, "a"), passed({ a: "skip" }, "a"), passed({}, "a")]).toEqual([true, false, false, false]);
  });
  test("a dependency-cache hit is the project's own published package or another package", () => {
    const own = ["widget", "widget-core", "github.com/acme/widget"];
    expect(hitKind("/usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/widget-core-0.6.1/src/lib.rs", own)).toEqual({ kind: "own_package", package: "widget-core" });
    expect(hitKind("/usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-1.0.2/src/de.rs", own)).toEqual({ kind: "other_package", package: "serde" });
    expect(hitKind("/usr/local/rustup/toolchains/1.77.2-x86_64-unknown-linux-gnu/lib/rustlib/src/rust/library/std/src/fs.rs", own)).toMatchObject({ kind: "other_package" });
    expect(hitKind("/go/pkg/mod/github.com/acme/widget@v1.2.0/a.go", own)).toMatchObject({ kind: "own_package" });
    expect(hitKind("/testbed/node_modules/@acme/widget/index.js", own)).toMatchObject({ kind: "own_package", package: "@acme/widget" });
    expect(hitKind("/root/.m2/repository/org/acme/widget/1.0/widget-1.0.jar", own)).toMatchObject({ kind: "own_package", package: "org.acme:widget" });
    expect(hitKind("/testbed/target/debug/notes.txt", own)).toEqual({ kind: "not_cache" });
    expect(classifyHits({ needles: 2, scan_exit: "0", hits: [{ path: "/x/node_modules/left-pad/i.js", needle_sha256: "a" }, { path: "/tmp/f", needle_sha256: "b" }] }, own).kinds).toEqual({ own_package: 0, other_package: 1, not_cache: 1 });
  });
});
