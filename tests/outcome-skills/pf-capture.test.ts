// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitLocal, inventoryLocal } from "../../lanes/outcome-skills/pfchecks/capture.ts";

const git = (d: string, ...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d, encoding: "utf8" });
test("captures new, changed, ignored and deleted paths outside the build-output list, and counts the forced ones", () => {
  const d = mkdtempSync(join(tmpdir(), "pf-cap-"));
  git(d, "init", "-q", "-b", "main");
  writeFileSync(join(d, ".gitignore"), ".claude/skills/\n*.log\n");
  writeFileSync(join(d, "a.go"), "package a\n");
  writeFileSync(join(d, "gone.txt"), "x\n");
  git(d, "add", "-A");
  git(d, "commit", "-q", "-m", "base");
  mkdirSync(join(d, "build"));
  writeFileSync(join(d, "build", "pre.o"), "old");
  const inv = join(d, "..", "inv-" + Date.now());
  writeFileSync(inv, inventoryLocal(d));
  mkdirSync(join(d, ".claude", "skills", "verify"), { recursive: true });
  writeFileSync(join(d, ".claude", "skills", "verify", "SKILL.md"), "---\nname: verify\n---\n");
  writeFileSync(join(d, "a.go"), "package a\n// edited\n");
  writeFileSync(join(d, "a_test.go"), "package a\n");
  writeFileSync(join(d, "build", "out.o"), "bin");
  mkdirSync(join(d, "sub", "target"), { recursive: true });
  writeFileSync(join(d, "sub", "target", "x"), "bin");
  rmSync(join(d, "gone.txt"));
  const c = commitLocal(d, inv);
  expect(c.forced).toEqual([".claude/skills/verify/SKILL.md"]);
  expect(c.changed).toBe(3);
  expect(c.deleted).toBe(1);
  const files = git(d, "ls-tree", "-r", "--name-only", "HEAD").stdout.trim().split("\n").sort();
  expect(files).toEqual([".claude/skills/verify/SKILL.md", ".gitignore", "a.go", "a_test.go"]);
  const log = git(d, "log", "-1", "--format=%an %ae %aI %s").stdout.trim();
  expect(log).toBe("session session@localhost 2000-01-01T00:00:01Z session end");
});

// Value: protects=section 6.1's capture rule for listed build-output directories; fails_when=a listed directory git tracks files in at the base (src/bin, a Java build package, a tracked dist/) is pruned, or an untracked one is captured, or a glob character in a tracked directory's name widens the exception; why_new=the any-depth prune dropped src/bin and Java build packages from S; seam=sh/capture.sh list; no_claim=what the scoring trees keep (pf-trees.test.ts)
test("a listed build-output directory is pruned only when git tracks no file under it at the base", () => {
  const d = mkdtempSync(join(tmpdir(), "pf-cap-listed-"));
  git(d, "init", "-q", "-b", "main");
  const base: Record<string, string> = { "src/bin/tool.rs": "fn main() {}\n", "src/test/java/com/x/build/OldTest.java": "class OldTest {}\n", "dist/app.js": "old\n", "p[1]/dist/x.js": "old\n", "lib.rs": "\n" };
  for (const [p, t] of Object.entries(base)) {
    mkdirSync(join(d, p, ".."), { recursive: true });
    writeFileSync(join(d, p), t);
  }
  git(d, "add", "-A");
  git(d, "commit", "-q", "-m", "base");
  const inv = join(d, "..", "inv-listed-" + Date.now());
  writeFileSync(inv, inventoryLocal(d));
  const now: Record<string, string> = { "src/bin/tool.rs": "fn main() {}\n#[cfg(test)]\nmod tests {}\n", "src/test/java/com/x/build/NewTest.java": "class NewTest {}\n", "dist/app.js": "rebuilt\n", "dist/chunk.js": "new\n", "p[1]/dist/x.js": "rebuilt\n", "p1/dist/y.js": "out\n", "target/debug/x": "bin", "sub/build/y.o": "bin", "src/bin2/out/z": "bin" };
  for (const [p, t] of Object.entries(now)) {
    mkdirSync(join(d, p, ".."), { recursive: true });
    writeFileSync(join(d, p), t);
  }
  const c = commitLocal(d, inv);
  expect(c.changed).toBe(5);
  const files = git(d, "ls-tree", "-r", "--name-only", "HEAD").stdout.trim().split("\n").sort();
  expect(files).toEqual(["dist/app.js", "dist/chunk.js", "lib.rs", "p[1]/dist/x.js", "src/bin/tool.rs", "src/test/java/com/x/build/NewTest.java", "src/test/java/com/x/build/OldTest.java"]);
  expect(git(d, "show", "HEAD:src/bin/tool.rs").stdout).toContain("mod tests");
  expect(git(d, "show", "HEAD:dist/app.js").stdout).toBe("rebuilt\n");
  rmSync(d, { recursive: true, force: true });
});
