// Copyright (c) 2026 Garry Tan. MIT License.
// Synthetic repositories for the eng-review build read's Docker tests: small changes in Go, Node (jest, vitest, mocha,
// node:test), Node with Rust, Python and Rust, each with a merge that adds a function with a bug and a later fix that
// fixes it and adds the test that shows it. Nothing here is a real upstream. Node lockfiles are made once per test
// run in a node container with the network on (keyless: the npm registry only).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docker } from "../../lanes/real-outcome/task/docker.ts";
import type { UnitSpec } from "../../lanes/eng-build/unit.ts";
import { buildRepo, MIT, type FxCommit } from "../real/fixture.ts";

export const IMAGES: Record<string, string> = {
  "node:22": "node:22-bookworm@sha256:7702d8aa4d5910871692af4480eb3ba86f23047a6417a44d857d06c95d060d3f",
  "golang:1.23": "golang:1.23-bookworm@sha256:167053a2bb901972bf2c1611f8f52c44d5fe7e762e5cab213708d82c421614db",
  "python:3.12": "python:3.12-bookworm@sha256:4209fae09a3e20afd863e528bfddc235da5fd5977983e1996cd54cc9a72e6267",
  "rust:1": "rust:1-bookworm@sha256:e6f2cff35d0f309acf8433b4f05878ed77092602c5065cc81801177da0bb3a9c",
};

export const RUNNER_VERSIONS: Record<string, string> = { jest: "29.7.0", vitest: "3.2.4", mocha: "11.7.1" };

/** package-lock.json for a package.json, made in a node container with the network on. */
export function nodeLock(pkg: string): string {
  const dir = mkdtempSync(join(tmpdir(), "eb-lock-"));
  try {
    writeFileSync(join(dir, "package.json"), pkg);
    const r = docker(["run", "--rm", "-v", dir + ":/w", "-w", "/w", "--entrypoint", "sh", IMAGES["node:22"], "-c", "npm install --package-lock-only --no-audit --no-fund >/dev/null 2>&1 && cat package-lock.json"], { timeoutMs: 600000 });
    if (r.status !== 0) throw new Error("npm could not make a lockfile: " + r.stderr.slice(0, 300));
    return r.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const day = (n: number) => "2026-03-0" + n + "T00:00:00Z";
const BUGGY_JS = "export const mul = (a, b) => (a === 0 ? b : a * b);\n";
const FIXED_JS = "export const mul = (a, b) => a * b;\n";

/** The four node runners' test files: add and mul pass on the merge, "mul zero" is the later fix's case. */
export function nodeTest(runner: string, cases: ("adds" | "muls" | "mul zero")[], from = "../src/calc.js"): string {
  const body: Record<string, [string, string]> = { adds: ["add(1, 2)", "3"], muls: ["mul(2, 3)", "6"], "mul zero": ["mul(0, 5)", "0"] };
  const names = cases.some((c) => c !== "adds") ? "add, mul" : "add";
  const each = cases.map((c) => (runner === "jest" || runner === "vitest" ? "  test('" + c + "', () => expect(" + body[c][0] + ").toBe(" + body[c][1] + "));" : "  it('" + c + "', () => assert.equal(" + body[c][0] + ", " + body[c][1] + "));")).join("\n");
  const head =
    runner === "jest"
      ? "const { " + names + " } = require('" + from.replace("src", "dist") + "');\n"
      : runner === "vitest"
        ? "import { describe, test, expect } from 'vitest';\nimport { " + names + " } from '" + from + "';\n"
        : runner === "mocha"
          ? "import assert from 'node:assert';\nimport { " + names + " } from '" + from + "';\n"
          : "import { describe, it } from 'node:test';\nimport assert from 'node:assert';\nimport { " + names + " } from '" + from + "';\n";
  return head + "\ndescribe('calc', () => {\n" + each + "\n});\n";
}

export interface Fixture {
  repo: string;
  sha: Record<string, string>;
  spec: UnitSpec;
}

const spec = (id: string, repo: string, sha: Record<string, string>, items: UnitSpec["items"], over: Partial<UnitSpec> = {}): UnitSpec => ({
  id,
  repo: "fixture/" + repo,
  set: "comparison",
  type: "devtools",
  keying: "first",
  mergedMonth: "2026-03",
  strictWindow: true,
  licence: "MIT",
  trust: "fixture",
  base: sha.base,
  merge: sha.merge,
  items,
  images: IMAGES,
  limits: { verifier_sec: 600, cpus: 2, memory: "3g" },
  ...over,
});
const b = (commit: string, item = "B1"): UnitSpec["items"][number] => ({ item, kind: "B", commit, mentioned: false, generic: false, foreseeable: "maybe" });

/** A Node repository for one runner. jest's builds read dist/, which package.json's build script writes from src/. */
export function nodeRepo(dir: string, runner: string, lock: (pkg: string) => string): Fixture {
  const jest = runner === "jest";
  const ext = jest ? "cjs" : "js";
  const pkg = JSON.stringify({ name: "ebcalc", version: "1.0.0", private: true, type: jest ? "commonjs" : "module", ...(jest ? { scripts: { build: "node build.cjs" } } : {}), ...(RUNNER_VERSIONS[runner] ? { devDependencies: { [runner]: RUNNER_VERSIONS[runner] } } : {}) }, null, 2) + "\n";
  const testFile = runner === "mocha" ? "test/calc.spec.js" : "test/calc.test.js";
  const js = (s: string) => (jest ? s.replace(/^export const (\w+) = /gm, "exports.$1 = ") : s);
  const add = js("export const add = (a, b) => a + b;\n");
  const files: Record<string, string> = { LICENSE: MIT, "package.json": pkg, "package-lock.json": lock(pkg), ["src/calc." + ext]: add, [testFile]: nodeTest(runner, ["adds"], "../src/calc." + ext) };
  if (jest) Object.assign(files, { ".gitignore": "dist/\nnode_modules/\n", "build.cjs": "const fs = require('fs');\nfs.mkdirSync('dist', { recursive: true });\nfs.copyFileSync('src/calc.cjs', 'dist/calc.cjs');\n" });
  else files[".gitignore"] = "node_modules/\n";
  const sha = buildRepo(dir, [
    { name: "base", message: "base", date: day(1), files },
    { name: "merge", message: "add mul", date: day(2), files: { ["src/calc." + ext]: add + js(BUGGY_JS), [testFile]: nodeTest(runner, ["adds", "muls"], "../src/calc." + ext) } },
    { name: "fix", message: "fix mul of zero", date: day(3), files: { ["src/calc." + ext]: add + js(FIXED_JS), [testFile]: nodeTest(runner, ["adds", "muls", "mul zero"], "../src/calc." + ext) } },
  ]);
  return { repo: dir, sha, spec: spec("ebnode-" + runner, "ebcalc-" + runner, sha, [b(sha.fix)]) };
}

export const GO_CALC = "package calc\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n";
const goTest = (names: string[]) => "package calc\n\nimport \"testing\"\n" + names.map((n) => ({ TestAdd: "\nfunc TestAdd(t *testing.T) {\n\tif Add(1, 2) != 3 {\n\t\tt.Fatal(\"add\")\n\t}\n}\n", TestMul: "\nfunc TestMul(t *testing.T) {\n\tif Mul(2, 3) != 6 {\n\t\tt.Fatal(\"mul\")\n\t}\n}\n", TestMulZero: "\nfunc TestMulZero(t *testing.T) {\n\tif Mul(0, 5) != 0 {\n\t\tt.Fatal(\"mul zero\")\n\t}\n}\n" })[n]).join("");
export const GO_BUGGY = "\nfunc Mul(a, b int) int {\n\tif a == 0 {\n\t\treturn b\n\t}\n\treturn a * b\n}\n";
export const GO_FIXED = "\nfunc Mul(a, b int) int {\n\treturn a * b\n}\n";

export function goRepo(dir: string): Fixture {
  const sha = buildRepo(dir, [
    { name: "base", message: "base", date: day(1), files: { LICENSE: MIT, "go.mod": "module example.invalid/calc\n\ngo 1.23\n", "calc.go": GO_CALC, "calc_test.go": goTest(["TestAdd"]) } },
    { name: "merge", message: "add Mul", date: day(2), files: { "calc.go": GO_CALC + GO_BUGGY, "calc_test.go": goTest(["TestAdd", "TestMul"]) } },
    { name: "docs", message: "docs", date: day(3), files: { "README.md": "calc\n" } },
    { name: "fix", message: "fix Mul of zero", date: day(4), files: { "calc.go": GO_CALC + GO_FIXED, "calc_test.go": goTest(["TestAdd", "TestMul", "TestMulZero"]) } },
  ]);
  return { repo: dir, sha, spec: spec("ebgo", "ebcalc-go", sha, [b(sha.fix)]) };
}

export const PY_OPS = "def add(a, b):\n    return a + b\n";
const PY_BUGGY = "\n\ndef scale(x, k=2):\n    return abs(x) * k\n";
const PY_FIXED = "\n\nUNIT = 1\n\n\ndef scale(x, k=2):\n    return x * k\n\n\ndef ratio(a, b):\n    return a / b\n";

/** Python: the fix's tests hold a fail-to-pass case, a case that fails on a missing name on the merge (excluded), a
 * case whose fixture errors on the merge (excluded) and anchors; a later test-only commit is a T item. */
export function pyRepo(dir: string): Fixture {
  const t0 = "from pkg import ops\n\n\ndef test_add():\n    assert ops.add(1, 2) == 3\n";
  const t1 = t0 + "\n\ndef test_scale():\n    assert ops.scale(2) == 4\n";
  const t2 = t1 + "\n\ndef test_scale_negative():\n    assert ops.scale(-2) == -4\n\n\ndef test_ratio():\n    assert ops.ratio(1, 4) == 0.25\n\n\nimport pytest\n\n\n@pytest.fixture\ndef unit():\n    return ops.UNIT\n\n\ndef test_unit(unit):\n    assert unit == 1\n";
  const sha = buildRepo(dir, [
    { name: "base", message: "base", date: day(1), files: { LICENSE: MIT, "requirements.txt": "pytest==8.3.3\n", "pytest.ini": "[pytest]\n", "pkg/__init__.py": "", "pkg/ops.py": PY_OPS, "tests/test_ops.py": t0 } },
    { name: "merge", message: "add scale", date: day(2), files: { "pkg/ops.py": PY_OPS + PY_BUGGY, "tests/test_ops.py": t1 } },
    { name: "fix", message: "fix scale of negatives", date: day(3), files: { "pkg/ops.py": PY_OPS + PY_FIXED, "tests/test_ops.py": t2 } },
    { name: "more", message: "more tests", date: day(4), files: { "tests/test_more.py": "from pkg import ops\n\n\ndef test_add_more():\n    assert ops.add(2, 2) == 4\n" } },
  ]);
  return { repo: dir, sha, spec: spec("ebpy", "ebcalc-py", sha, [b(sha.fix), { item: "T1", kind: "T", commit: sha.more, mentioned: false, generic: false, foreseeable: null }]) };
}

export const RS_ADD = "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n";
export const RS_BUGGY = "\npub fn mul(a: i32, b: i32) -> i32 {\n    if a == 0 { b } else { a * b }\n}\n";
export const RS_FIXED = "\npub fn mul(a: i32, b: i32) -> i32 {\n    a * b\n}\n";
export const rsTests = (names: string[]) =>
  "\n#[cfg(test)]\nmod tests {\n    use super::*;\n" + names.map((n) => ({ adds: "    #[test]\n    fn adds() {\n        assert_eq!(add(1, 2), 3, \"add {}\", \"}\");\n    }\n", muls: "    #[test]\n    fn muls() {\n        assert_eq!(mul(2, 3), 6);\n    }\n", mul_zero: "    #[test]\n    fn mul_zero() {\n        assert_eq!(mul(0, 5), 0);\n    }\n" })[n]).join("") + "}\n";
const cargo = (name: string) => ({ "Cargo.toml": "[package]\nname = \"" + name + "\"\nversion = \"0.1.0\"\nedition = \"2021\"\n", "Cargo.lock": "# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = \"" + name + "\"\nversion = \"0.1.0\"\n" });

/** Rust: the tests live in an inline module, so only that module moves into a graded tree. */
export function rustRepo(dir: string): Fixture {
  const sha = buildRepo(dir, [
    { name: "base", message: "base", date: day(1), files: { LICENSE: MIT, ".gitignore": "target/\n", ...cargo("ebcalc"), "src/lib.rs": RS_ADD + rsTests(["adds"]) } },
    { name: "merge", message: "add mul", date: day(2), files: { "src/lib.rs": RS_ADD + RS_BUGGY + rsTests(["adds", "muls"]) } },
    { name: "fix", message: "fix mul of zero", date: day(3), files: { "src/lib.rs": RS_ADD + RS_FIXED + rsTests(["adds", "muls", "mul_zero"]) } },
  ]);
  return { repo: dir, sha, spec: spec("ebrust", "ebcalc-rs", sha, [b(sha.fix)]) };
}

/** Node with Rust: a node:test package and a crate in one repository; the merge changes both, the fix the crate. */
export function nodeRustRepo(dir: string, lock: (pkg: string) => string): Fixture {
  const pkg = JSON.stringify({ name: "ebweb", version: "1.0.0", private: true, type: "module" }, null, 2) + "\n";
  const crate = Object.fromEntries(Object.entries(cargo("ebcore")).map(([k, v]) => ["crates/core/" + k, v]));
  const sha = buildRepo(dir, [
    { name: "base", message: "base", date: day(1), files: { LICENSE: MIT, ".gitignore": "target/\nnode_modules/\n", "web/package.json": pkg, "web/package-lock.json": lock(pkg), "web/src/calc.js": "export const add = (a, b) => a + b;\n", "web/test/calc.test.js": nodeTest("nodetest", ["adds"]), ...crate, "crates/core/src/lib.rs": RS_ADD + rsTests(["adds"]) } },
    { name: "merge", message: "add mul in both", date: day(2), files: { "web/src/calc.js": "export const add = (a, b) => a + b;\n" + FIXED_JS, "web/test/calc.test.js": nodeTest("nodetest", ["adds", "muls"]), "crates/core/src/lib.rs": RS_ADD + RS_BUGGY + rsTests(["adds", "muls"]) } },
    { name: "fix", message: "fix the crate's mul of zero", date: day(3), files: { "crates/core/src/lib.rs": RS_ADD + RS_FIXED + rsTests(["adds", "muls", "mul_zero"]) } },
  ]);
  return { repo: dir, sha, spec: spec("ebnoderust", "ebcalc-nr", sha, [b(sha.fix)]) };
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export const readText = (path: string): string => readFileSync(path, "utf8");
export type { FxCommit };
