// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fixSourcePatch } from "../../lanes/outcome-skills/pfchecks/neutral.ts";
import { commitLocal, inventoryLocal } from "../../lanes/outcome-skills/pfchecks/capture.ts";
import { buildTrees, changesOf, git, show, withoutFiles } from "../../lanes/outcome-skills/pfchecks/trees.ts";

const g = (d: string, ...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d, encoding: "utf8" }).stdout;
const put = (d: string, files: Record<string, string | null>) => { for (const [p, t] of Object.entries(files)) { if (t === null) rmSync(join(d, p)); else { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), t); } } };
function repo(base: Record<string, string>, fix: Record<string, string | null>, s: Record<string, string | null>) {
  const d = mkdtempSync(join(tmpdir(), "pf-trees-"));
  g(d, "init", "-q", "-b", "main");
  put(d, base);
  g(d, "add", "-A");
  g(d, "commit", "-q", "-m", "base");
  g(d, "checkout", "-q", "-b", "fixbr");
  put(d, fix);
  g(d, "commit", "-q", "-am", "fix");
  const patch = g(d, "diff", "main", "fixbr");
  g(d, "checkout", "-q", "main");
  put(d, s);
  g(d, "add", "-A");
  g(d, "commit", "-q", "-m", "session end");
  return { d, patch };
}
const N = { mode: "both" as const, files: ["a.go"] };
test("go: product edits restored, tests, config, docs and new files kept, deleted source restored; three trees on S", () => {
  const { d, patch } = repo({ "a.go": "package a\nfunc F() int { return 1 }\n", "b.go": "package a\n", "a_test.go": "package a\n", "go.mod": "module a\n", "README.md": "x\n" }, { "a.go": "package a\nfunc F() int { return 2 }\n" },
    { "a.go": "package a\nfunc F() int { return 9 }\n", "b.go": null, "a_test.go": "package a\n// t\n", "go.mod": "module a\ngo 1.22\n", "README.md": "y\n", "new_test.go": "package a\n", "spec/M.tla": "---- MODULE M ----\n" });
  const t = buildTrees({ repo: d, ref: "HEAD", lang: "go", testFiles: new Set(), fixPatch: patch, neutral: N });
  expect(t.gap).toBeNull();
  expect(t.plan.product_files).toEqual(["a.go", "b.go"]);
  expect(t.plan.deleted_restored).toEqual(["b.go"]);
  expect(show(d, t.parent, "a.go")).toBe("package a\nfunc F() int { return 1 }\n");
  expect(show(d, t.parent, "b.go")).toBe("package a\n");
  for (const p of ["a_test.go", "go.mod", "README.md", "new_test.go", "spec/M.tla"]) expect(show(d, t.parent, p)).toBe(show(d, t.s, p));
  expect(show(d, t.fix!, "a.go")).toBe("package a\nfunc F() int { return 2 }\n");
  expect(show(d, t.neutral, "a.go")).toBe("// gstack-evals neutral line\npackage a\nfunc F() int { return 1 }\n// gstack-evals neutral line\n");
  const meta = (c: string) => git(d, ["log", "-1", "--format=%P|%an|%aI|%cI|%s", c]).stdout.trim();
  expect(meta(t.parent)).toBe(t.s + "|scoring|2000-01-01T00:00:02Z|2000-01-01T00:00:02Z|scoring tree");
  expect(meta(t.fix!)).toBe(meta(t.parent));
  expect(meta(t.neutral)).toBe(meta(t.parent));
  const w = withoutFiles(d, t.fix!, t.s, ["new_test.go"]);
  expect(git(d, ["ls-tree", "-r", "--name-only", w]).stdout).not.toContain("new_test.go");
});
test("a fix that conflicts with a kept file is the gap E_PF_FIX_CONFLICT", () => {
  const { d, patch } = repo({ "a.go": "package a\n", "README.md": "one\n" }, { "README.md": "two\n" }, { "README.md": "three\n" });
  const t = buildTrees({ repo: d, ref: "HEAD", lang: "go", testFiles: new Set(), fixPatch: patch, neutral: N });
  expect(t.gap).toBe("E_PF_FIX_CONFLICT");
  expect(t.fix).toBeNull();
});
test("rust: hunks wholly inside a test module stay, product hunks go back, mixed hunks are counted", () => {
  const filler = Array.from({ length: 8 }, (_, i) => "// filler " + i).join("\n");
  const base = "pub fn f() -> i32 {\n    1\n}\n" + filler + "\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn a() {\n        assert_eq!(super::f(), 1);\n    }\n}\n";
  const s = base.replace("    1\n", "    2\n").replace("        assert_eq!(super::f(), 1);\n    }\n", "        assert_eq!(super::f(), 1);\n    }\n    #[test]\n    fn b() {}\n");
  const { d, patch } = repo({ "src/lib.rs": base, "Cargo.toml": "[package]\n" }, { "Cargo.toml": "[package]\nname = \"a\"\n" }, { "src/lib.rs": s });
  const t = buildTrees({ repo: d, ref: "HEAD", lang: "rust", testFiles: new Set(), fixPatch: patch, neutral: { mode: "end", files: ["src/lib.rs"] } });
  expect(t.plan).toMatchObject({ kept_test_hunks: 1, restored_hunks: 1, mixed_hunks: 0, product_files: ["src/lib.rs"] });
  expect(show(d, t.parent, "src/lib.rs")).toBe(base.replace("        assert_eq!(super::f(), 1);\n    }\n", "        assert_eq!(super::f(), 1);\n    }\n    #[test]\n    fn b() {}\n"));
  const mixed = base.replace("    1\n}\n" + filler, "    3\n}\n#[cfg(test)]\nmod more {}\n" + filler);
  const m = repo({ "src/lib.rs": base }, { "src/lib.rs": base + "\n" }, { "src/lib.rs": mixed });
  const tm = buildTrees({ repo: m.d, ref: "HEAD", lang: "rust", testFiles: new Set(), fixPatch: m.patch, neutral: { mode: "end", files: [] } });
  expect(tm.plan.mixed_hunks).toBe(1);
  expect(show(m.d, tm.parent, "src/lib.rs")).toBe(base);
});
test("a fix with bytes outside ASCII lands byte for byte in the fix tree, read the way scoring reads it", () => {
  const base = { "a.go": "package a\n// caf\u00e9 au lait\nfunc F() int { return 1 }\n", "README.md": "x\n" };
  const fixed = { "a.go": "package a\n// caf\u00e9 au lait\nfunc F() int { return 2 } // two \u2014 not one\n" };
  const { d, patch } = repo(base, fixed, { "README.md": "y\n" });
  const unit = mkdtempSync(join(tmpdir(), "pf-unit-"));
  writeFileSync(join(unit, "fix-source.patch"), patch);
  const t = buildTrees({ repo: d, ref: "HEAD", lang: "go", testFiles: new Set(), fixPatch: fixSourcePatch(unit), neutral: N });
  expect(t.gap).toBeNull();
  expect(Buffer.from(show(d, t.fix!, "a.go"), "latin1").equals(Buffer.from(fixed["a.go"], "utf8"))).toBe(true);
  expect(Buffer.from(show(d, t.parent, "a.go"), "latin1").equals(Buffer.from(base["a.go"], "utf8"))).toBe(true);
});
test("a fix that adds bytes outside ASCII next to ASCII context lands byte for byte too", () => {
  const base = { "a.go": "package a\nfunc F() int { return 1 }\n", "README.md": "x\n" };
  const fixed = { "a.go": "package a\n// set \u2014 and \u00e9\nfunc F() int { return 2 }\n" };
  const { d, patch } = repo(base, fixed, { "README.md": "y\n" });
  const unit = mkdtempSync(join(tmpdir(), "pf-unit-"));
  writeFileSync(join(unit, "fix-source.patch"), patch);
  const t = buildTrees({ repo: d, ref: "HEAD", lang: "go", testFiles: new Set(), fixPatch: fixSourcePatch(unit), neutral: N });
  expect(t.gap).toBeNull();
  expect(Buffer.from(show(d, t.fix!, "a.go"), "latin1").toString("hex")).toBe(Buffer.from(fixed["a.go"], "utf8").toString("hex"));
});


/** S the way sessions make it: the base commit, the inventory, the agent's edits on disk, then capture.sh commit. */
function captured(base: Record<string, string>, fix: Record<string, string>, s: Record<string, string | null>) {
  const { d, patch } = repo(base, fix, {});
  g(d, "branch", "-q", "-D", "fixbr");
  const inv = join(d, "..", "inv-" + d.split("/").pop());
  writeFileSync(inv, inventoryLocal(d));
  put(d, s);
  commitLocal(d, inv);
  return { d, patch };
}
const files = (d: string, c: string) => git(d, ["ls-tree", "-r", "--name-only", c]).stdout.trim().split("\n").sort();

// Value: protects=section 6.1's listed directories inside src/, test/ or tests/ (source, scored by the usual rules); fails_when=a src/bin file or a Java package named build never reaches S or T, or a product edit inside one stays on the parent tree; why_new=capture.sh pruned them at any depth and classify calls build/ paths other, which T keeps as S has them; seam=capture.sh commit then trees.ts buildTrees; no_claim=the capture list alone (pf-capture.test.ts)
test("a listed directory inside src/ holds source: a src/bin test module reaches T, and in a Java package named build a new test reaches T while the product edit goes back", () => {
  const filler = Array.from({ length: 8 }, (_, i) => "// filler " + i).join("\n");
  const rs = "pub fn f() -> i32 {\n    1\n}\n" + filler + "\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn a() {\n        assert_eq!(super::f(), 1);\n    }\n}\n";
  const withB = rs.replace("        assert_eq!(super::f(), 1);\n    }\n", "        assert_eq!(super::f(), 1);\n    }\n    #[test]\n    fn b() {}\n");
  const r = captured({ "src/bin/tool.rs": rs, "Cargo.toml": "[package]\n" }, { "Cargo.toml": "[package]\nname = \"a\"\n" }, { "src/bin/tool.rs": withB.replace("    1\n", "    2\n"), "target/debug/tool": "bin" });
  const t = buildTrees({ repo: r.d, ref: "HEAD", lang: "rust", testFiles: new Set(), fixPatch: r.patch, neutral: { mode: "end", files: ["src/bin/tool.rs"] } });
  expect(t.plan).toMatchObject({ kept_test_hunks: 1, restored_hunks: 1, product_files: ["src/bin/tool.rs"] });
  expect(show(r.d, t.parent, "src/bin/tool.rs")).toBe(withB);
  expect(files(r.d, t.s)).not.toContain("target/debug/tool");

  const main = "src/main/java/com/x/build/Builder.java", test1 = "src/test/java/com/x/build/BuilderTest.java", test2 = "src/test/java/com/x/build/NewBuildTest.java";
  const j = captured({ [main]: "class Builder { int f() { return 1; } }\n", [test1]: "class BuilderTest {}\n", "pom.xml": "<project/>\n" }, { [main]: "class Builder { int f() { return 2; } }\n" }, { [main]: "class Builder { int f() { return 9; } }\n", [test2]: "class NewBuildTest {}\n", "build/classes/Builder.class": "bin" });
  const tj = buildTrees({ repo: j.d, ref: "HEAD", lang: "java", testFiles: new Set(), fixPatch: j.patch, neutral: { mode: "both", files: [main] } });
  expect(tj.gap).toBeNull();
  expect(tj.plan.product_files).toEqual([main]);
  expect(show(j.d, tj.parent, test2)).toBe("class NewBuildTest {}\n");
  expect(show(j.d, tj.parent, main)).toBe("class Builder { int f() { return 1; } }\n");
  expect(show(j.d, tj.fix!, main)).toBe("class Builder { int f() { return 2; } }\n");
  expect(files(j.d, tj.s)).not.toContain("build/classes/Builder.class");
});

// Value: protects=section 6.1's tracked build output (a root dist/, packages/x/dist); fails_when=a rebuilt tracked output file or a new file in one lands on the parent, fix or neutral tree, counts as a product edit, or reads as a test file; why_new=capture now keeps listed directories git tracks files in, and transplant kept other changes and every new file as S has them; seam=capture.sh commit then trees.ts buildTrees; no_claim=the capture list alone (pf-capture.test.ts)
test("a tracked build-output directory outside src/, test/ and tests/ reaches S, but its changes go back to base and its new files stay out of every scoring tree", () => {
  const base = { "src/a.ts": "export const f = () => 1;\n", "dist/app.js": "old\n", "dist/gone.js": "g\n", "packages/x/dist/index.js": "old\n", "tests/a.test.ts": "t\n" };
  const r = captured(base, { "src/a.ts": "export const f = () => 2;\n" }, { "src/a.ts": "export const f = () => 9;\n", "tests/new.test.ts": "n\n", "dist/app.js": "rebuilt\n", "dist/app.test.js": "x\n", "dist/chunk.js": "c\n", "dist/gone.js": null, "packages/x/dist/index.js": "rebuilt\n" });
  const t = buildTrees({ repo: r.d, ref: "HEAD", lang: "ts", testFiles: new Set(), fixPatch: r.patch, neutral: { mode: "both", files: ["src/a.ts"] } });
  expect(t.gap).toBeNull();
  expect(show(r.d, t.s, "dist/app.js")).toBe("rebuilt\n");
  expect(files(r.d, t.s)).toEqual(expect.arrayContaining(["dist/app.test.js", "dist/chunk.js"]));
  expect(t.plan.product_files).toEqual(["src/a.ts"]);
  expect(t.plan.deleted_restored).toEqual([]);
  expect(t.plan.build_output).toEqual(["dist/app.js", "dist/app.test.js", "dist/chunk.js", "dist/gone.js", "packages/x/dist/index.js"]);
  for (const c of [t.parent, t.fix!, t.neutral]) {
    expect(files(r.d, c)).toEqual(["dist/app.js", "dist/gone.js", "packages/x/dist/index.js", "src/a.ts", "tests/a.test.ts", "tests/new.test.ts"]);
    for (const p of ["dist/app.js", "dist/gone.js", "packages/x/dist/index.js"]) expect(show(r.d, c, p)).toBe(base[p as keyof typeof base]);
  }
  expect(changesOf(r.d, t.base, t.parent).map((c) => c.path)).toEqual(["tests/new.test.ts"]);
});
