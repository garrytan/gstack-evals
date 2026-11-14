// Copyright (c) 2026 Garry Tan. MIT License.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fixtureRepo, gitOut } from "../../lanes/outcome-skills/statemachines/fixtures.ts";
import { FOLLOWON_SCRIPT, followOnFiles, followOnStrip, prepareBase, preflight, runBash, strippedPaths } from "../../lanes/outcome-skills/statemachines/history.ts";
import { buildSessionImage } from "../../lanes/outcome-skills/statemachines/image.ts";
import { startTree } from "../../lanes/outcome-skills/statemachines/followon.ts";
import { sessionTreeCheck } from "../../lanes/outcome-skills/statemachines/strip.ts";
import { dropVolume, PY_IMAGE } from "../../lanes/outcome-skills/statemachines/testrun.ts";
import type { SmUnit } from "../../lanes/outcome-skills/statemachines/unit.ts";

const add = (p: string, body: string): string => {
  const l = body.split("\n");
  if (l[l.length - 1] === "") l.pop();
  return "diff --git a/" + p + " b/" + p + "\nnew file mode 100644\n--- /dev/null\n+++ b/" + p + "\n@@ -0,0 +1," + l.length + " @@\n" + l.map((x) => "+" + x).join("\n") + "\n";
};

const plain = add("src/x.ts", "export const x = 1;\n");
const memory = [
  plain,
  add("CLAUDE.md", "See @docs/new.md and @README.md\nnot @~/home.md\n`@docs/in-span.md`\n"),
  add("docs/new.md", "notes\n"),
  add("docs/in-span.md", "kept\n"),
  add("a/b/AGENTS.md", "agents\n"),
  add("deep/.claude/settings.json", "{}\n"),
  add(".claude/AGENTS.md", "x\n"),
  add("pkg/CLAUDE.local.md", "@note.txt\n"),
].join("");
const base = { "src/lib.rs": "pub fn add(a: i32, b: i32) -> i32 { a + b }\n", "README.md": "readme\n", ".gitignore": "target/\n" };

const baseTree = () => {
  const { dir, head } = fixtureRepo(base);
  prepareBase({ kind: "host", dir }, head, dir, "fixture");
  return dir;
};

describe("follow-on trees under section 4's strip", () => {
  test("the strip list names every memory file a first stage writes, the outermost .claude, and in-repository @imports", () => {
    expect(followOnStrip(memory, "/testbed/repo")).toEqual([".claude", "CLAUDE.md", "README.md", "a/b/AGENTS.md", "deep/.claude", "docs/new.md", "pkg/CLAUDE.local.md", "pkg/note.txt"]);
    expect(followOnStrip(plain, "/testbed/repo")).toEqual([]);
    expect(followOnStrip("", "/testbed/repo")).toEqual([]);
  });

  test("a patch that adds them: commit two drops them, records what it dropped, and passes the session tree check", () => {
    const dir = baseTree();
    const r = runBash({ kind: "host", dir }, FOLLOWON_SCRIPT, followOnFiles(memory, dir));
    expect(r.status).toBe(0);
    expect(strippedPaths(r.stdout)).toEqual([".claude", "CLAUDE.md", "README.md", "a/b/AGENTS.md", "deep/.claude", "docs/new.md", "pkg/CLAUDE.local.md"]);
    expect(gitOut(dir, "ls-files").split("\n").sort()).toEqual([".gitignore", "docs/in-span.md", "src/lib.rs", "src/x.ts"]);
    expect(gitOut(dir, "status", "--porcelain", "--ignored")).toBe("");
    expect(existsSync(join(dir, "deep"))).toBe(true);
    expect(preflight({ kind: "host", dir }, 2, "fixture")).toContain("count=2 refs=refs/heads/main");
    expect(() => sessionTreeCheck({ kind: "host", dir }, dir, "fixture")).not.toThrow();
  });

  test("a patch without them: the same tree, byte for byte, as the follow-on commit before the strip", () => {
    const before = baseTree(), after = baseTree();
    expect(gitOut(before, "rev-parse", "HEAD")).toBe(gitOut(after, "rev-parse", "HEAD"));
    expect(runBash({ kind: "host", dir: before }, FOLLOWON_SCRIPT, { "tree.patch": plain }).status).toBe(0);
    const r = runBash({ kind: "host", dir: after }, FOLLOWON_SCRIPT, followOnFiles(plain, after));
    expect(r.status).toBe(0);
    expect(strippedPaths(r.stdout)).toEqual([]);
    expect(gitOut(after, "rev-parse", "HEAD")).toBe(gitOut(before, "rev-parse", "HEAD"));
  });

  test("the session tree check still refuses a tree that holds one", () => {
    const dir = baseTree();
    expect(runBash({ kind: "host", dir }, FOLLOWON_SCRIPT, { "tree.patch": add("a/b/AGENTS.md", "agents\n") }).status).toBe(0);
    expect(() => sessionTreeCheck({ kind: "host", dir }, dir, "fixture")).toThrow(/^E_SM_STRIP fixture: the session tree holds files the strip rule removes: a\/b\/AGENTS\.md/);
  });
});

describe.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1")("the session image and the scorer's start tree match under the strip (docker)", () => {
  const pid = process.pid;
  const d = (args: string[], input?: string) => spawnSync("docker", args, { encoding: "utf8", input, timeout: 900_000 });
  const tag = "sm-test-strip-git:" + pid, vol = "sm-test-strip-tree-" + pid, dst = "sm-test-strip-start-" + pid;
  const built: string[] = [];
  const unit = (): SmUnit => ({ id: "strip-unit", repo_dir: "/w", image: { runtime_id: d(["image", "inspect", "--format", "{{.Id}}", tag]).stdout.trim() } }) as unknown as SmUnit;
  beforeAll(() => {
    expect(d(["build", "-q", "-t", tag, "-"], "FROM " + PY_IMAGE + "\nRUN apt-get update -qq && apt-get install -y -qq --no-install-recommends git >/dev/null && rm -rf /var/lib/apt/lists/* && mkdir -p /w\n").status).toBe(0);
    d(["volume", "create", vol]);
    const repo = "cd /d && git init -q && git symbolic-ref HEAD refs/heads/main && mkdir -p src && echo readme > README.md && echo 'pub fn a() {}' > src/lib.rs && git add -A && GIT_COMMITTER_DATE=2000-01-01T00:00:00Z git -c user.name=base -c user.email=base@localhost commit -q --date 2000-01-01T00:00:00Z -m base";
    expect(d(["run", "--rm", "--network", "none", "-v", vol + ":/d", "--entrypoint", "sh", tag, "-c", repo]).status).toBe(0);
  }, 900_000);
  afterAll(() => {
    for (const t of [...built, tag]) d(["image", "rm", "-f", t]);
    d(["volume", "rm", "-f", vol]);
  });
  test("one patch with memory files gives the same head and the same removed paths in both", () => {
    const u = unit();
    const img = buildSessionImage(u, { volume: vol, stage: "followon", treePatch: memory });
    built.push(img.tag);
    try {
      const t = startTree(u, u.image.runtime_id!, vol, "S2", memory, dst);
      expect(img.commits).toBe(2);
      expect(t.head).toBe(img.head);
      expect(img.removed).toEqual([".claude", "CLAUDE.md", "README.md", "a/b/AGENTS.md", "deep/.claude", "docs/new.md", "pkg/CLAUDE.local.md"]);
      expect(t.removed).toEqual(img.removed);
    } finally {
      dropVolume(dst);
    }
  }, 600_000);
});
