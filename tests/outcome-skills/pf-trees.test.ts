// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildTrees, git, show, withoutFiles } from "../../lanes/outcome-skills/pfchecks/trees.ts";

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
