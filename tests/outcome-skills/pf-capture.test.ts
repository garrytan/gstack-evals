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
