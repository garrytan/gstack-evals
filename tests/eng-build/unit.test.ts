// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless tests of the build-unit builder's pieces (lanes/eng-build/unit.ts), the statement note (note.ts) and the leak
// needles (leak.ts), on a synthetic repository in Go, Python, Rust and TypeScript built with git fast-import. No Docker
// and no model call: the note's writer and auditor are stubs.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { leakNeedles } from "../../lanes/eng-build/leak.ts";
import { fixOnlyNames, NOTE_MODELS, noteRequest, publicNames, refusal, writeNote } from "../../lanes/eng-build/note.ts";
import { aftermathCases, anchorCases, attributed, baseOutcome, ebProtected, goSubtest, imageEnv, inScope, treeGrid, renderEbDockerfile, repoLabel, rustModule, scopesOf, targetOfFile, testChanges, writeSet, type Grid } from "../../lanes/eng-build/unit.ts";
import { recipeFor } from "../../lanes/eng-build/recipes.ts";
import { buildRepo, MIT, tempDir } from "../real/fixture.ts";

const CALC_GO = "package calc\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n";
const LIB_RS = "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn adds() {\n        assert_eq!(add(1, 2), 3);\n    }\n}\n";

let tmp: ReturnType<typeof tempDir>;
let sha: Record<string, string>;
const repo = () => join(tmp.dir, "shop");

beforeAll(() => {
  tmp = tempDir("eb-unit-");
  const mergeGo = CALC_GO + "\nfunc Mul(a, b int) int {\n\treturn a * b\n}\n\nfunc _hidden() {}\n";
  const mergeRs = LIB_RS.replace("#[cfg(test)]", "pub fn mul(a: i32, b: i32) -> i32 {\n    a * b\n}\n\n#[cfg(test)]").replace("    #[test]\n    fn adds", "    #[test]\n    fn muls() {\n        assert_eq!(mul(2, 3), 6);\n        pub fn not_public_api() {}\n    }\n    #[test]\n    fn adds");
  sha = buildRepo(repo(), [
    { name: "base", message: "base", date: "2026-01-01T00:00:00Z", files: { LICENSE: MIT, "go.mod": "module example.invalid/calc\n\ngo 1.23\n", "calc.go": CALC_GO, "calc_test.go": "package calc\n\nimport \"testing\"\n\nfunc TestAdd(t *testing.T) {\n\tif Add(1, 2) != 3 {\n\t\tt.Fatal(\"add\")\n\t}\n}\n", "Cargo.toml": "[package]\nname = \"calc\"\nversion = \"0.1.0\"\nedition = \"2021\"\n", "src/lib.rs": LIB_RS, "pkg/ops.py": "def add(a, b):\n    return a + b\n", "tests/test_ops.py": "from pkg import ops\n\n\ndef test_add():\n    assert ops.add(1, 2) == 3\n", "web/a.ts": "export const one = 1;\n" } },
    { name: "merge", message: "add multiplication", date: "2026-01-02T00:00:00Z", files: { "calc.go": mergeGo, "calc_test.go": "package calc\n\nimport \"testing\"\n\nfunc TestAdd(t *testing.T) {\n\tif Add(1, 2) != 3 {\n\t\tt.Fatal(\"add\")\n\t}\n}\n\nfunc TestMul(t *testing.T) {\n\tif Mul(2, 3) != 6 {\n\t\tt.Fatal(\"mul\")\n\t}\n}\n", "src/lib.rs": mergeRs, "pkg/ops.py": "def add(a, b):\n    return a + b\n\n\ndef scale(x, k=2):\n    return x * k\n\n\ndef _helper():\n    return 0\n", "tests/test_ops.py": "from pkg import ops\n\n\ndef test_add():\n    assert ops.add(1, 2) == 3\n\n\ndef test_scale():\n    assert ops.scale(2) == 4\n", "web/a.ts": "export const one = 1;\nexport function clamp(x: number, lo: number, hi: number): number {\n  return Math.min(hi, Math.max(lo, x));\n}\n", "web/mixed.py": "def f():\n    return 1\n\n\ndef test_f():\n    assert f() == 1\n" } },
    { name: "other", message: "docs", date: "2026-01-03T00:00:00Z", files: { "README.md": "calc\n" } },
    { name: "fix", message: "fix overflow in Mul", date: "2026-01-04T00:00:00Z", files: { "calc.go": mergeGo.replace("\treturn a * b\n", "\tif a == 0 {\n\t\treturn 0\n\t}\n\treturn a * b\n") + "\nfunc MulChecked(a, b int) (int, bool) {\n\treturn a * b, true\n}\n", "calc_test.go": "package calc\n\nimport \"testing\"\n\nfunc TestMulZero(t *testing.T) {\n\tif Mul(0, 3) != 0 {\n\t\tt.Fatal(\"zero\")\n\t}\n}\n" } },
    { name: "fix2", message: "tidy Add", date: "2026-01-05T00:00:00Z", files: { "calc.go": mergeGo.replace("\treturn a + b\n", "\treturn b + a\n").replace("\treturn a * b\n", "\tif a == 0 {\n\t\treturn 0\n\t}\n\treturn a * b\n") + "\nfunc MulChecked(a, b int) (int, bool) {\n\treturn a * b, true\n}\n", "src/lib.rs": mergeRs.replace("fn adds() {", "fn adds_again() {") } },
  ]);
});
afterAll(() => tmp?.cleanup());

describe("what moves into a graded tree", () => {
  test("a range's test changes: whole test files, movable Rust regions and mixed files whose cases drop", () => {
    const own = testChanges(repo(), sha.base, sha.merge);
    expect(own.whole).toEqual(["calc_test.go", "tests/test_ops.py"]);
    expect(own.regions).toEqual(["src/lib.rs"]);
    expect(own.mixed).toEqual([{ path: "web/mixed.py", why: "test code in a source file" }]);
    expect(testChanges(repo(), sha.fix, sha.fix2).regions).toEqual(["src/lib.rs"]);
  });

  test("a restore set holds gold's test tree with the fix's test changes overlaid, and the region sources", () => {
    const dir = join(tmp.dir, "set");
    const tc = testChanges(repo(), sha.other, sha.fix);
    writeSet(repo(), dir, sha.merge, { rev: sha.fix, ...tc }, [{ rev: sha.merge, paths: ["src/lib.rs"] }]);
    expect(readFileSync(join(dir, "restore.list"), "utf8")).toBe("calc_test.go\ngo.mod\ntests/test_ops.py\n");
    expect(readFileSync(join(dir, "restore/calc_test.go"), "utf8")).toContain("TestMulZero");
    expect(readFileSync(join(dir, "regions.list"), "utf8")).toBe("src/lib.rs\n");
    for (const f of ["prepare.sh", "vrun.py", "cold.sh", "node-reporter.mjs", "vitest.none.cjs", "vitest.none.mjs", "protect.ere"]) expect(existsSync(join(dir, f))).toBe(true);
    expect(ebProtected(".cargo/config.toml")).toBe(true);
    expect(ebProtected("jest.config.ts")).toBe(true);
    expect(ebProtected("src/lib.rs")).toBe(false);
  });

  test("scopes read only a set's own ids: Go by declared test name, Rust by the region's module path", () => {
    const go = { kind: "go", module: "example.invalid/calc" } as const;
    expect(scopesOf(go, "calc_test.go", "func TestMulZero(t *testing.T) {\n}\nfunc helper() {}\n", "")).toEqual([".::TestMulZero"]);
    expect(inScope("go", ".::TestMulZero", [".::TestMulZero"])).toBe(true);
    expect(inScope("go", ".::TestAdd", [".::TestMulZero"])).toBe(false);
    const cargo = { kind: "cargo", root: "crates/c", package: "c", build: null } as const;
    expect(rustModule("crates/c", "crates/c/src/net/mod.rs")).toEqual({ target: "crates/c/src/lib.rs", module: "net" });
    expect(scopesOf(cargo, "crates/c/src/net/mod.rs", LIB_RS, "crates/c")).toEqual(["crates/c/src/lib.rs::net::tests::"]);
    expect(scopesOf(cargo, "crates/c/tests/it.rs", "", "crates/c")).toEqual(["crates/c/tests/it.rs::"]);
    expect(targetOfFile(cargo, "crates/c/src/net/mod.rs", "crates/c")).toBe("crates/c/src/lib.rs");
    expect(inScope("cargo", "collect:crates/c/src/lib.rs", ["crates/c/src/lib.rs::"])).toBe(false);
  });
});

describe("the aftermath rule", () => {
  test("attribution: the fix's product change touches lines the merge added; a fix of base's lines does not", () => {
    expect(attributed(repo(), sha.base, sha.merge, sha.fix).ofChange).toBeGreaterThan(0);
    const tidy = attributed(repo(), sha.base, sha.merge, sha.fix2);
    expect(tidy.touched).toBeGreaterThan(0);
    expect(tidy.ofChange).toBe(0);
  });

  test("3 runs: assert on merged and on the fix's parent, pass on the fix, every run; anchors pass on both", () => {
    const merged: Grid = { f2p: ["assert", "assert", "assert"], flaky: ["assert", "pass", "assert"], name: ["missing_name", "missing_name", "missing_name"], anchor: ["pass", "pass", "pass"], erroronly: ["load", "load", "load"] };
    const parent: Grid = { f2p: ["assert", "assert", "assert"], flaky: ["assert", "assert", "assert"], name: ["missing_name", "missing_name", "missing_name"], anchor: ["pass", "pass", "pass"], erroronly: ["load", "load", "load"] };
    const fixed: Grid = { f2p: ["pass", "pass", "pass"], flaky: ["pass", "pass", "pass"], name: ["pass", "pass", "pass"], anchor: ["pass", "pass", "pass"], erroronly: ["pass", "pass", "pass"] };
    expect(aftermathCases(merged, parent, fixed, 3)).toEqual(["f2p"]);
    expect(aftermathCases(merged, { ...parent, f2p: ["assert", "assert", "pass"] }, fixed, 3)).toEqual([]);
    expect(aftermathCases(merged, parent, { ...fixed, f2p: ["pass", "pass"] }, 3)).toEqual([]);
    expect(anchorCases(merged, fixed, 3)).toEqual(["anchor"]);
  });

  test("the base split is descriptive: the most common outcome, a tie reads fail", () => {
    expect(baseOutcome(["pass", "pass", "assert"])).toBe("pass");
    expect(baseOutcome(["assert", "missing_name", "pass"])).toBe("fail");
    expect(baseOutcome(["no_result", "timeout", "assert"])).toBe("no_result");
    expect(baseOutcome(["pass", "assert", "no_result"])).toBe("fail");
    expect(baseOutcome([])).toBe("no_result");
  });

  test("a repository label is random, stable for the repository and never its name", () => {
    const f = join(tmp.dir, "custody/labels.json");
    const a = repoLabel(f, "owner/calc");
    expect(a).toMatch(/^r[0-9a-f]{12}$/);
    expect(repoLabel(f, "owner/calc")).toBe(a);
    expect(repoLabel(f, "owner/other")).not.toBe(a);
    expect(a).not.toContain("calc");
  });
});

describe("the unit image", () => {
  test("the Dockerfile pins its images, copies a second toolchain, installs with per-unit caches removed and rebuilds .git", () => {
    const go = recipeFor("go", (p) => (p === "go.mod" ? "module x\n\ngo 1.23\n" : null), "", new Set(["go.mod"]));
    expect(imageEnv(go)).toEqual({ GOCACHE: "/opt/eb-cache/gobuild", GOFLAGS: "-buildvcs=false" });
    const d = renderEbDockerfile({ from: "node@sha256:" + "a".repeat(64), addons: [{ eco: "rust", from: "rust@sha256:" + "b".repeat(64) }], installs: [{ root: "web", env: { npm_config_cache: "/opt/eb-cache/npm" }, command: "npm ci" }] });
    expect(d).toContain("FROM node@sha256:" + "a".repeat(64));
    expect(d).toContain("COPY --from=rust@sha256:" + "b".repeat(64) + " /usr/local/cargo /usr/local/cargo");
    expect(d).toContain('RUN cd /testbed/web && export npm_config_cache="/opt/eb-cache/npm" && (npm ci) && rm -rf /opt/eb-cache');
    expect(d).toContain("rm -rf .git && git init -q -b main");
  });
});

describe("the statement note and the leak needles", () => {
  test("the request names the merge diff's added or changed public names with signatures, and nothing private or in a test region", () => {
    const names = publicNames(repo(), sha.base, sha.merge);
    expect(names.map((n) => n.file + ":" + n.name)).toEqual(["calc.go:Mul", "pkg/ops.py:scale", "src/lib.rs:mul", "web/a.ts:clamp", "web/mixed.py:f"]);
    expect(names.find((n) => n.name === "Mul")!.signature).toBe("func Mul(a, b int) int");
    expect(names.find((n) => n.name === "clamp")!.signature).toBe("export function clamp(x: number, lo: number, hi: number): number");
    const req = noteRequest(repo(), sha.base, sha.merge);
    expect(req.writerPrompt).toContain("- scale (def, in pkg/ops.py): def scale(x, k=2)");
    expect(req.writerPrompt).not.toContain("{{NAMES}}");
    expect(req.writerPrompt).not.toContain("TestMul");
  });

  test("names that exist only at a later fix are found, and a note that names one is refused", () => {
    const fixOnly = fixOnlyNames(repo(), sha.merge, [sha.fix]);
    expect(fixOnly).toEqual(["MulChecked"]);
    const req = noteRequest(repo(), sha.base, sha.merge);
    const good = "The change adds Mul (func Mul(a, b int) int), scale, mul, clamp and f; these names and signatures are fixed.";
    expect(refusal("PASS", good, req, fixOnly)).toBeNull();
    expect(refusal("PASS\n", good, req, fixOnly)).toBeNull();
    expect(refusal("REFUSE: it hints at zero", good, req, fixOnly)).toBe("auditor: REFUSE: it hints at zero");
    expect(refusal("PASS, looks fine", good, req, fixOnly)).toContain("auditor:");
    expect(refusal("PASS", good.replace("clamp", "clip"), req, fixOnly)).toBe("the note leaves out clamp");
    expect(refusal("PASS", good + " See MulChecked.", req, fixOnly)).toContain("MulChecked");
    expect(refusal("PASS", good + "\n\nSecond paragraph.", req, fixOnly)).toBe("the note is more than one paragraph");
  });

  test("the writer and the auditor run through the adapter call, and a refused note comes back refused", async () => {
    const req = noteRequest(repo(), sha.base, sha.merge);
    const calls: string[] = [];
    const out = await writeNote(req, [], async (role, prompt) => {
      calls.push(role + ":" + NOTE_MODELS[role]);
      return role === "writer" ? "Mul, scale, mul, clamp and f are fixed." : prompt.includes("Mul, scale, mul, clamp and f are fixed.") ? "REFUSE: too short" : "PASS";
    });
    expect(calls).toEqual(["writer:openai/gpt-6.1-sol", "audit:anthropic/claude-opus-5-5"]);
    expect(out).toEqual({ note: "Mul, scale, mul, clamp and f are fixed.", refused: "auditor: REFUSE: too short" });
  });

  test("leak needles: the merge's added lines and the fix's added product lines, none found at base, no test lines", () => {
    const needles = leakNeedles(repo(), sha.base, sha.merge, [sha.fix]);
    expect(needles).toContain("func MulChecked(a, b int) (int, bool) {");
    expect(needles).toContain("assert ops.scale(2) == 4");
    expect(needles.some((l) => l.includes("TestMulZero"))).toBe(false);
    expect(needles).not.toContain("func Add(a, b int) int {");
  });
});

describe("Go test ids in a graded tree", () => {
  // Value: protects=aftermath and catch cases in nested Go packages; fails_when=a top-level test such as internal/calc::TestMulZero is read as a subtest and dropped from the grid.
  test("a top-level test in a nested package stays in the grid; only a name with a / after :: is a subtest", () => {
    const parsed = { seen: ["internal/calc::TestMulZero", "internal/calc::TestMulZero/zero", ".::TestAdd"], results: { "internal/calc::TestMulZero": { status: "pass" }, "internal/calc::TestMulZero/zero": { status: "pass" }, ".::TestAdd": { status: "fail" } }, notes: [] };
    const tree = { runs: [{ parsed, timed_out: false, out_full: false, killed: false }] } as unknown as Parameters<typeof treeGrid>[0];
    const grid = treeGrid(tree, "go", ["internal/calc::TestMulZero", ".::TestAdd"]);
    expect(Object.keys(grid)).toEqual([".::TestAdd", "internal/calc::TestMulZero"]);
    expect(grid["internal/calc::TestMulZero"]).toEqual(["pass"]);
    expect([goSubtest("internal/calc::TestMulZero"), goSubtest("internal/calc::TestMulZero/zero"), goSubtest(".::TestAdd/case")]).toEqual([false, true, true]);
  });
});
