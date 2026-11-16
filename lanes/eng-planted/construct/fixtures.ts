// Copyright (c) 2026 Garry Tan. MIT License.
// Synthetic fixture repositories for the construct part's dry run and tests: one fix per ecosystem, each a parent P with
// a bug in a named function and its tests, and a fix F that changes the function and the tests, dated inside the window.
// Commits are written as objects with a fixture identity, so nothing reads the machine's git identity. The code is
// written for this lane; it copies no repository.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const git = (dir: string, args: string[], input?: string): string => {
  const r = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: dir, input, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git " + args[0] + " failed: " + (r.stderr ?? "").slice(0, 200));
  return r.stdout;
};

export interface FixtureCommit {
  name: string;
  date: string;
  message: string;
  /** Files to write; null deletes. */
  files: Record<string, string | null>;
}

/** Builds a repository on branch main from commits in order and returns each commit's sha by name. */
export function fixtureRepo(dir: string, commits: FixtureCommit[]): Record<string, string> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  const sha: Record<string, string> = {};
  let parent: string | null = null;
  for (const c of commits) {
    for (const [p, text] of Object.entries(c.files)) {
      if (text === null) rmSync(join(dir, p), { force: true });
      else {
        mkdirSync(dirname(join(dir, p)), { recursive: true });
        writeFileSync(join(dir, p), text);
      }
    }
    git(dir, ["add", "-A"]);
    const tree = git(dir, ["write-tree"]).trim();
    const when = Math.floor(Date.parse(c.date) / 1000) + " +0000";
    const body: string = "tree " + tree + "\n" + (parent ? "parent " + parent + "\n" : "") + "author fixture <fixture@example.invalid> " + when + "\ncommitter fixture <fixture@example.invalid> " + when + "\n\n" + c.message + "\n";
    parent = git(dir, ["hash-object", "-t", "commit", "-w", "--stdin"], body).trim();
    git(dir, ["update-ref", "refs/heads/main", parent]);
    sha[c.name] = parent;
  }
  git(dir, ["reset", "-q", "--hard", "main"]);
  return sha;
}

const MIT = "MIT License\n\nCopyright (c) 2026 fixture\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software, to deal in it without restriction.\n";
const day = (d: string) => d + "T12:00:00Z";

export const GO_MUL_BUGGY = "package calc\n\nimport \"fmt\"\n\n// Mul multiplies a by b with repeated addition.\nfunc Mul(a, b int) int {\n\tif a == 0 {\n\t\treturn b\n\t}\n\tnegative := b < 0\n\tif negative {\n\t\tb = -b\n\t}\n\tresult := 0\n\tfor i := 0; i < b; i++ {\n\t\tresult += a\n\t}\n\tif negative {\n\t\tresult = -result\n\t}\n\treturn result\n}\n\n// Describe names a product.\nfunc Describe(a, b int) string {\n\treturn fmt.Sprintf(\"%d*%d=%d\", a, b, Mul(a, b))\n}\n";
const GO_MUL_FIXED = GO_MUL_BUGGY.replace("\tif a == 0 {\n\t\treturn b\n\t}\n", "");
const goTests = (zero: boolean) => "package calc\n\nimport \"testing\"\n\nfunc check(t *testing.T, got, want int) {\n\tt.Helper()\n\tif got != want {\n\t\tt.Fatalf(\"got %d, want %d\", got, want)\n\t}\n}\n\nfunc TestMul(t *testing.T) {\n\tcheck(t, Mul(2, 3), 6)\n\tcheck(t, Mul(3, -2), -6)\n}\n" + (zero ? "\nfunc TestMulZero(t *testing.T) {\n\tcheck(t, Mul(0, 5), 0)\n}\n" : "");
const GO_DESCRIBE_TEST = "package calc\n\nimport \"testing\"\n\nfunc TestDescribe(t *testing.T) {\n\tif Describe(2, 3) != \"2*3=6\" {\n\t\tt.Fatal(\"describe\")\n\t}\n\tcheck(t, Mul(1, 1), 1)\n}\n";

/** Go: a test file F changes holds a helper another test file uses; go.mod names an old minimum and no toolchain. */
export const goFixture = (dir: string) =>
  fixtureRepo(dir, [
    { name: "start", date: day("2026-06-01"), message: "start", files: { LICENSE: MIT, "go.mod": "module example.invalid/calc\n\ngo 1.20\n", "calc.go": "package calc\n" } },
    { name: "parent", date: day("2026-08-01"), message: "add Mul", files: { "calc.go": GO_MUL_BUGGY, "calc_test.go": goTests(false), "describe_test.go": GO_DESCRIBE_TEST } },
    { name: "fix", date: day("2026-08-20"), message: "fix Mul of zero", files: { "calc.go": GO_MUL_FIXED, "calc_test.go": goTests(true) } },
  ]);

const PY_OPS = (fixed: boolean) =>
  'def find(items, key):\n    """Return the item named key, or None."""\n    for item in items:\n        if item.get("name") == key:\n            return item\n    return None\n\n\ndef label(items, key, prefix="item"):\n    """The label of the item named key; an empty string when there is none."""\n    found = find(items, key)\n' +
  (fixed ? '    if found is None:\n        return ""\n' : "") +
  '    name = found.get("name")\n    kind = found.get("kind", "thing")\n    parts = [prefix, kind, name]\n    text = ":".join(parts)\n    if len(text) > 40:\n        text = text[:40]\n    width = len(text)\n    padded = text.ljust(width)\n    result = padded.strip()\n    return result\n';
const PY_TESTS = (fixed: boolean) =>
  'import pytest\n\nfrom pkg import ops\n\nITEMS = [{"name": "a", "kind": "tool"}]\n\n\ndef test_find():\n    assert ops.find(ITEMS, "a")["kind"] == "tool"\n\n\ndef test_label():\n    assert ops.label(ITEMS, "a") == "item:tool:a"\n\n\ndef test_label_missing():\n' +
  (fixed ? '    assert ops.label(ITEMS, "zz") == ""\n' : '    with pytest.raises(AttributeError):\n        ops.label(ITEMS, "zz")\n');

/** Python: an AttributeError on None in a product file; F rewrites a test that expected the bug. */
export const pyFixture = (dir: string) =>
  fixtureRepo(dir, [
    { name: "start", date: day("2026-06-01"), message: "start", files: { LICENSE: MIT, "requirements.txt": "pytest==8.3.3\n", "pytest.ini": "[pytest]\n", "pkg/__init__.py": "" } },
    { name: "parent", date: day("2026-08-01"), message: "add label", files: { "pkg/ops.py": PY_OPS(false), "tests/test_ops.py": PY_TESTS(false) } },
    { name: "fix", date: day("2026-08-20"), message: "fix label of a missing item", files: { "pkg/ops.py": PY_OPS(true), "tests/test_ops.py": PY_TESTS(true) } },
  ]);

export const JS_PORT = (fixed: boolean) =>
  "export function port(config) {\n  const server = config.server;\n  const fallback = 8080;\n" +
  (fixed ? "  const raw = server ? server.port : undefined;\n" : "  const raw = server.port;\n") +
  "  if (raw === undefined) {\n    return fallback;\n  }\n  const value = Number(raw);\n  if (Number.isNaN(value)) {\n    return fallback;\n  }\n  const bounded = Math.min(Math.max(value, 1), 65535);\n  return bounded;\n}\n";
const jsTest = (name: string, body: string) => 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { port } from "../src/cfg.js";\n\ntest("' + name + '", () => {\n  ' + body + "\n});\n";

/** Node (node:test, no dependencies): a property read through undefined; F adds a test file and changes no existing one.
 * With dist, a committed bundle holds the function's body under another name, for the body check. */
export const nodeFixture = (dir: string, dist = false) =>
  fixtureRepo(dir, [
    { name: "start", date: day("2026-06-01"), message: "start", files: { LICENSE: MIT, "package.json": JSON.stringify({ name: "cfg", version: "1.0.0", private: true, type: "module", scripts: { test: "node --test" } }, null, 2) + "\n", ".gitignore": "node_modules/\n" } },
    { name: "parent", date: day("2026-08-01"), message: "add port", files: { "src/cfg.js": JS_PORT(false), "test/cfg.test.js": jsTest("reads the port", 'assert.equal(port({ server: { port: "3000" } }), 3000);'), ...(dist ? { "dist/bundle.js": "// built\n" + JS_PORT(false).replace("export function port", "function bundledPort") } : {}) } },
    { name: "fix", date: day("2026-08-20"), message: "fix port without a server", files: { "src/cfg.js": JS_PORT(true), "test/missing.test.js": jsTest("defaults without a server", "assert.equal(port({}), 8080);") } },
  ]);

const RS_LIB = (fixed: boolean) =>
  "/// Clamps v into lo..=hi.\npub fn clamp(v: i64, lo: i64, hi: i64) -> i64 {\n    let below = v < lo;\n    let above = v > hi;\n    let mut out = v;\n    if below {\n        out = lo;\n    }\n    if above {\n        out = " +
  (fixed ? "hi" : "lo") +
  ";\n    }\n    let checked = out;\n    checked\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    fn within(v: i64) -> i64 {\n        clamp(v, 0, 10)\n    }\n\n    #[test]\n    fn keeps_inside() {\n        assert_eq!(within(5), 5);\n    }\n" +
  (fixed ? "\n    #[test]\n    fn caps_high() {\n        assert_eq!(within(15), 10);\n    }\n" : "") +
  "}\n";

/** Rust: the tests sit in an inline #[cfg(test)] module of the product file, with a helper. */
export const rustFixture = (dir: string) =>
  fixtureRepo(dir, [
    { name: "start", date: day("2026-06-01"), message: "start", files: { LICENSE: MIT, "Cargo.toml": '[package]\nname = "calc"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n', "Cargo.lock": "# This file is automatically @generated by Cargo.\nversion = 3\n\n[[package]]\nname = \"calc\"\nversion = \"0.1.0\"\n", "src/lib.rs": "\n" } },
    { name: "parent", date: day("2026-08-01"), message: "add clamp", files: { "src/lib.rs": RS_LIB(false) } },
    { name: "fix", date: day("2026-08-20"), message: "fix clamp above the range", files: { "src/lib.rs": RS_LIB(true) } },
  ]);

/** A GitHub stub: no pull request for any commit unless prOpened names one's open date. */
export const stubGitHub =
  (prOpened?: string) =>
  async (path: string): Promise<{ status: number; body: any }> => {
    if (path.endsWith("/pulls")) return { status: 200, body: prOpened ? [{ created_at: prOpened, labels: [], body: "" }] : [] };
    return { status: 404, body: null };
  };
