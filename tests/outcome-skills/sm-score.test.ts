// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless tests for the first-stage scorer (post section 7): extraction, the strict and adapted readings on parsed
// fixtures (restore, in-source block drop, adapted keep, skip marker, protected config, exclusion log), the fix's tests
// split hunk by hunk, and the outcome rules (majority over three runs, the three-run new-test rule, the outcome table).
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureRepo, patchOf } from "../../lanes/outcome-skills/statemachines/fixtures.ts";
import { decide, extractChange, readings, testHunks, type RunView } from "../../lanes/outcome-skills/statemachines/score.ts";

const P = "pass", F = "fail";
const RUST = ["pub fn bump(x: i32) -> i32 {", "    x + 2", "}", "#[cfg(test)]", "mod tests {", "    use super::*;", "    #[test]", "    fn keeps_sign() {", "        assert!(bump(-5) < 0);", "    }", "}", ""].join("\n");

function applied(files: Record<string, string>, patch: string, path: string): string {
  const { dir } = fixtureRepo(files, 1);
  writeFileSync(join(dir, "p.patch"), patch);
  const r = spawnSync("git", ["apply", "p.patch"], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return readFileSync(join(dir, path), "utf8");
}

describe("extraction (step 1)", () => {
  test("text files, an untracked new file, a binary listed and left out, unsafe paths", () => {
    const { dir } = fixtureRepo({ "a.go": "package a\n" }, 1);
    const ch = extractChange(patchOf(dir, { "a.go": "package a\n\nvar X = 1\n", "new.txt": "hello\n", "blob.bin": "\u0000\u0001\u0002" }));
    expect(ch.files.map((f) => f.path).sort()).toEqual(["a.go", "new.txt"]);
    expect(ch.files.find((f) => f.path === "new.txt")!.oldPath).toBeNull();
    expect(ch.binary).toEqual(["blob.bin"]);
    expect(ch.lines).toBe(3);
    expect(extractChange("diff --git a/../x b/../x\n--- a/../x\n+++ b/../x\n@@ -1 +1 @@\n-a\n+b\n").unsafe.length).toBeGreaterThan(0);
    expect(extractChange("").files).toEqual([]);
  });
});

describe("readings (step 2)", () => {
  const goBase = { "calc.go": "package calc\n\nfunc Add(a, b int) int { return a + b }\n", "calc_test.go": "package calc\n\nimport \"testing\"\n\nfunc TestAdd(t *testing.T) {}\n", "go.mod": "module example.com/calc\n\ngo 1.16\n" };
  test("restores existing test files and protected config, applies new test files, logs every exclusion", () => {
    const { dir } = fixtureRepo(goBase, 1);
    const ch = extractChange(patchOf(dir, { "calc.go": goBase["calc.go"].replace("Add", "Sum"), "calc_test.go": goBase["calc_test.go"] + "// edited\n", "go.mod": goBase["go.mod"] + "require example.com/x v1.0.0\n", "go.sum": "x\n", "sum_test.go": "package calc\n" }));
    const r = readings("go", new Set(), ch, (p) => goBase[p as keyof typeof goBase]);
    const paths = (p: string) => extractChange(p).files.map((f) => f.path).sort();
    expect(paths(r.strict)).toEqual(["calc.go", "sum_test.go"]);
    expect(paths(r.adapted)).toEqual(["calc.go", "calc_test.go", "sum_test.go"]);
    expect(r.excluded).toEqual([
      { path: "calc_test.go", rule: "test_file", readings: "strict", detail: "edited" },
      { path: "go.mod", rule: "protected", readings: "both", detail: "edited" },
      { path: "go.sum", rule: "protected", readings: "both", detail: "new file" },
    ]);
    expect(r.deps_changed).toEqual(["go.mod", "go.sum"]);
  });
  test("a unit's test.patch file counts as a test file whatever its path", () => {
    const base = { "data/case1.json": "{}\n", "src/a.py": "x = 1\n" };
    const { dir } = fixtureRepo(base, 1);
    const ch = extractChange(patchOf(dir, { "data/case1.json": "{\"a\": 1}\n", "src/a.py": "x = 2\n" }));
    const r = readings("python", new Set(["data/case1.json"]), ch, (p) => base[p as keyof typeof base]);
    expect(extractChange(r.strict).files.map((f) => f.path)).toEqual(["src/a.py"]);
    expect(r.excluded[0]).toMatchObject({ path: "data/case1.json", rule: "test_file" });
  });
  test("drops the arm's blocks inside a Rust test module and keeps its other blocks in the same file", () => {
    const { dir } = fixtureRepo({ "src/lib.rs": RUST }, 1);
    const arm = RUST.replace("x + 2", "x + 1").replace("}\n#[cfg(test)]", "}\npub fn twice(x: i32) -> i32 {\n    x * 2\n}\n#[cfg(test)]").replace("assert!(bump(-5) < 0);", "assert!(true);");
    const ch = extractChange(patchOf(dir, { "src/lib.rs": arm }));
    const r = readings("rust", new Set(), ch, () => RUST);
    expect(r.excluded).toEqual([{ path: "src/lib.rs", rule: "in_source_test", readings: "strict", detail: "mod tests restored to base" }]);
    const strict = applied({ "src/lib.rs": RUST }, r.strict, "src/lib.rs");
    expect(strict).toBe(RUST.replace("x + 2", "x + 1").replace("}\n#[cfg(test)]", "}\npub fn twice(x: i32) -> i32 {\n    x * 2\n}\n#[cfg(test)]"));
    expect(applied({ "src/lib.rs": RUST }, r.adapted, "src/lib.rs")).toBe(arm);
  });
  test("a new test module the arm adds to a source file is dropped in strict; a file with no test block is unchanged", () => {
    const base = "pub fn one() -> i32 {\n    1\n}\n";
    const { dir } = fixtureRepo({ "src/a.rs": base }, 1);
    const ch = extractChange(patchOf(dir, { "src/a.rs": base.replace("    1", "    2") + "\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn t() {}\n}\n" }));
    const r = readings("rust", new Set(), ch, () => base);
    expect(applied({ "src/a.rs": base }, r.strict, "src/a.rs")).toBe(base.replace("    1", "    2"));
    expect(r.excluded).toEqual([{ path: "src/a.rs", rule: "in_source_test", readings: "strict", detail: "new mod tests dropped" }]);
    const gone = readings("rust", new Set(), extractChange(patchOf(fixtureRepo({ "src/lib.rs": RUST }, 1).dir, { "src/lib.rs": RUST.slice(0, RUST.indexOf("#[cfg(test)]")).replace("x + 2", "x + 1") })), () => RUST);
    expect(applied({ "src/lib.rs": RUST }, gone.strict, "src/lib.rs")).toBe(RUST.replace("x + 2", "x + 1").replace("}\n#[cfg(test)]", "}\n\n#[cfg(test)]"));
    const ch2 = extractChange(patchOf(dir, { "src/a.rs": base.replace("    1", "    3") }));
    expect(readings("rust", new Set(), ch2, () => base).strict).toBe(ch2.files[0]!.text);
  });
  test("an added skip marker is found for the adapted reading", () => {
    const base = { "tests/test_a.py": "def test_a():\n    assert True\n" };
    const { dir } = fixtureRepo(base, 1);
    const r = readings("python", new Set(), extractChange(patchOf(dir, { "tests/test_a.py": "import pytest\n@pytest.mark.skip\ndef test_a():\n    assert True\n" })), () => "");
    expect(r.skip).toEqual([{ path: "tests/test_a.py", marker: "@pytest.mark.skip" }]);
    expect(r.strict).toBe("");
  });
  test("a binary is logged as an exclusion in both readings", () => {
    const { dir } = fixtureRepo({ "a.txt": "a\n" }, 1);
    const r = readings("go", new Set(), extractChange(patchOf(dir, { "img.bin": "\u0000\u0001" })), () => "");
    expect(r.excluded).toEqual([{ path: "img.bin", rule: "binary", readings: "both" }]);
  });
});

describe("the fix's tests, hunk by hunk (step 3)", () => {
  test("a two-hunk section becomes two patches that each apply to base alone", () => {
    const body = Array.from({ length: 30 }, (_, k) => "line " + k).join("\n") + "\n";
    const { dir } = fixtureRepo({ "t/x_test.go": body }, 1);
    const p = patchOf(dir, { "t/x_test.go": body.replace("line 2\n", "line 2 changed\n").replace("line 27\n", "line 27 changed\n") });
    const parts = testHunks(p, "");
    expect(parts.length).toBe(2);
    for (const q of parts) {
      writeFileSync(join(dir, "q.patch"), q);
      expect(spawnSync("git", ["apply", "--check", "q.patch"], { cwd: dir }).status).toBe(0);
      expect(q).toContain("index ");
    }
  });
});

describe("outcome rules (steps 5 to 7)", () => {
  const known = new Set(["a", "b", "c", "s", "t", "u"]);
  const run = (parsed: Record<string, string> | null, build_failed = false): RunView => ({ parsed, build_failed });
  test("the outcome table", () => {
    expect(decide(["a", "b", "c"], ["s", "t"], known, [run({ a: P, b: P, c: P, s: P, t: P })])).toMatchObject({ outcome: "clean_fix", wants_more: false });
    expect(decide(["a", "b", "c"], ["s", "t", "u"], known, [run({ a: P, b: P, c: P, s: F, t: F, u: F })])).toMatchObject({ outcome: "fix_broke", wants_more: false });
    expect(decide(["a", "b", "c"], ["s"], known, [run({ a: F, b: P, c: P, s: P })])).toMatchObject({ outcome: "no_fix", broke: false, wants_more: false });
    const v = decide(["a", "b", "c"], ["s", "t", "u", "b"], known, [run({ a: F, b: P, s: "skip", t: F })]);
    expect(v).toMatchObject({ outcome: "no_fix_broke", wants_more: false });
    expect(v.broke_by).toEqual({ stable_missing: ["u"], stable_failed: ["s", "t"], new_test_failed: [], build_failed: false });
  });
  test("a build failure misses every test", () => {
    const v = decide(["a", "b", "c"], ["s", "t", "u"], known, [run({ a: P, b: P, c: P, s: P, t: P, u: P }, true)]);
    expect(v).toMatchObject({ outcome: "no_fix_broke", fixed: false });
    expect(v.broke_by).toMatchObject({ stable_missing: ["s", "t", "u"], build_failed: true });
    expect(v.absent).toEqual(["s", "t", "u"]);
  });
  test("an outcome on 2 tests or fewer takes each test's majority over three runs", () => {
    const one = [run({ a: P, s: P, t: P, u: P })];
    expect(decide(["a"], ["s", "t", "u"], known, one).wants_more).toBe(true);
    expect(decide(["a"], ["s", "t", "u"], known, [...one, run({ a: F, s: P, t: P, u: P }), run({ a: P, s: P, t: P, u: P })])).toMatchObject({ outcome: "clean_fix", rerun_2of3: true, deciding: ["a"] });
    expect(decide(["a"], ["s", "t", "u"], known, [...one, run({ a: F, s: P, t: P, u: P }), run({ a: F, s: P, t: P, u: P })])).toMatchObject({ outcome: "no_fix", rerun_2of3: true });
    const flaky = [run({ a: F, b: F, c: F, s: F, t: P, u: P }), run({ a: F, b: F, c: F, s: P, t: P, u: P }), run({ a: F, b: F, c: F, s: P, t: P, u: P })];
    expect(decide(["a", "b", "c"], ["s", "t", "u"], known, flaky.slice(0, 1)).wants_more).toBe(true);
    expect(decide(["a", "b", "c"], ["s", "t", "u"], known, flaky)).toMatchObject({ outcome: "no_fix", broke: false, rerun_2of3: true, deciding: ["s"] });
    expect(decide(["a", "b", "c"], ["s", "t", "u"], known, [run({ a: F, b: F, c: F, s: F, t: F, u: F })])).toMatchObject({ outcome: "no_fix_broke", wants_more: false });
  });
  test("a new test the arm wrote breaks only when it fails in all three scoring runs", () => {
    const r = (n: string) => run({ a: P, b: P, c: P, s: P, n });
    expect(decide(["a", "b", "c"], ["s"], known, [r(F)])).toMatchObject({ wants_more: true, new_tests: ["n"] });
    expect(decide(["a", "b", "c"], ["s"], known, [r(F), r(F), r(F)])).toMatchObject({ outcome: "fix_broke", broke_by: { new_test_failed: ["n"] } });
    expect(decide(["a", "b", "c"], ["s"], known, [r(F), r(P), r(F)])).toMatchObject({ outcome: "clean_fix", wants_more: false });
    expect(decide(["a", "b", "c"], ["s"], known, [r("skip"), r(F), r(F)])).toMatchObject({ outcome: "clean_fix" });
  });
});
