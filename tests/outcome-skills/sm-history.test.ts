// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureRepo, gitOut } from "../../lanes/outcome-skills/statemachines/fixtures.ts";
import { importsOf, prepareBase, prepareFollowOn, preflight, stripPlan } from "../../lanes/outcome-skills/statemachines/history.ts";

const files = {
  "src/lib.rs": "pub fn add(a: i32, b: i32) -> i32 { a + b }\n",
  "CLAUDE.md": "Read @docs/guide.md and @~/.private.md and @../outside.md.\n`@docs/in-span.md`\n```\n@docs/in-block.md\n```\n",
  "docs/guide.md": "guide\n", "docs/in-span.md": "x\n", "docs/in-block.md": "y\n",
  "a/b/CLAUDE.local.md": "@note.txt\n", "a/b/note.txt": "note\n",
  "a/AGENTS.md": "agents\n", ".claude/AGENTS.md": "x\n", "deep/x/.claude/settings.json": "{}\n",
  "untracked:target/debug/build.log": "build output\n",
};

describe("history and strip", () => {
  test("@imports resolve one level, inside the repo, outside code", () => {
    expect(importsOf("CLAUDE.md", files["CLAUDE.md"], "/testbed/repo")).toEqual(["docs/guide.md"]);
    expect(importsOf("a/CLAUDE.md", "@/testbed/repo/z.md @/etc/passwd", "/testbed/repo")).toEqual(["z.md"]);
  });

  test("the strip removes every name at any depth and the history becomes one commit on main", () => {
    const { dir, head } = fixtureRepo(files);
    const out = prepareBase({ kind: "host", dir }, head, "/testbed/repo", "fixture");
    expect(out.removed).toEqual([".claude", "CLAUDE.md", "a/AGENTS.md", "a/b/CLAUDE.local.md", "a/b/note.txt", "deep/x/.claude", "docs/guide.md"]);
    expect(out.preflight).toBe("PREFLIGHT count=1 refs=refs/heads/main remotes=0 stash=0 loose=0 logs=0 headmatch=1");
    expect(existsSync(join(dir, "docs/in-span.md")) && existsSync(join(dir, "target/debug/build.log"))).toBe(true);
    expect(gitOut(dir, "ls-files").split("\n").sort()).toEqual(["docs/in-block.md", "docs/in-span.md", "src/lib.rs"]);
    expect(gitOut(dir, "tag")).toBe("");
    const two = prepareFollowOn({ kind: "host", dir }, "diff --git a/src/new.rs b/src/new.rs\nnew file mode 100644\n--- /dev/null\n+++ b/src/new.rs\n@@ -0,0 +1 @@\n+pub fn n() {}\n", "fixture");
    expect(two).toContain("count=2 refs=refs/heads/main");
    expect(() => preflight({ kind: "host", dir }, 1, "fixture")).toThrow(/^E_SM_HISTORY .*count=2/);
  });

  test("the preflight refuses three commits, extra refs, and a tree off its base commit", () => {
    const { dir, head } = fixtureRepo({ "src/lib.rs": "x\n" });
    expect(() => preflight({ kind: "host", dir }, 1, "fixture")).toThrow(/^E_SM_HISTORY .*count=3/);
    expect(() => prepareBase({ kind: "host", dir }, "f".repeat(40), "/r", "fixture")).toThrow(/^E_SM_HISTORY .*not base_commit/);
    writeFileSync(join(dir, "src/lib.rs"), "changed\n");
    expect(() => prepareBase({ kind: "host", dir }, head, "/r", "fixture")).toThrow(/^E_SM_HISTORY .*differ/);
    const plan = stripPlan("HEAD abc\nDIRTY 0\n", "/r");
    expect(plan).toEqual({ head: "abc", dirty: 0, remove: [] });
  });

  test("a nested repository's own history goes too", () => {
    const { dir, head } = fixtureRepo({ "src/lib.rs": "x\n" });
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub/f.txt"), "f\n");
    gitOut(join(dir, "sub"), "init", "-q");
    expect(prepareBase({ kind: "host", dir }, head, "/r", "fixture").preflight).toContain("count=1");
    expect(existsSync(join(dir, "sub/.git"))).toBe(false);
  });
});
