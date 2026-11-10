// Copyright (c) 2026 Garry Tan. MIT License.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureRepo, gitOut } from "../../lanes/outcome-skills/statemachines/fixtures.ts";
import { importsOf, prepareBase, prepareFollowOn, preflight, stripPlan } from "../../lanes/outcome-skills/statemachines/history.ts";
import { buildSessionImage } from "../../lanes/outcome-skills/statemachines/image.ts";
import { PY_IMAGE } from "../../lanes/outcome-skills/statemachines/testrun.ts";
import type { SmUnit } from "../../lanes/outcome-skills/statemachines/unit.ts";

const files = {
  "src/lib.rs": "pub fn add(a: i32, b: i32) -> i32 { a + b }\n",
  "CLAUDE.md": "Read @docs/guide.md and @~/.private.md and @../outside.md.\n`@docs/in-span.md`\n```\n@docs/in-block.md\n```\n",
  "docs/guide.md": "guide\n", "docs/in-span.md": "x\n", "docs/in-block.md": "y\n",
  "a/b/CLAUDE.local.md": "@note.txt\n", "a/b/note.txt": "note\n",
  "a/AGENTS.md": "agents\n", ".claude/AGENTS.md": "x\n", "deep/x/.claude/settings.json": "{}\n",
  ".gitignore": "target/\n",
  "untracked:target/debug/build.log": "build output\n",
  "untracked:test-output.json": "{}\n",
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
    expect(existsSync(join(dir, "test-output.json"))).toBe(false);
    expect(gitOut(dir, "ls-files").split("\n").sort()).toEqual([".gitignore", "docs/in-block.md", "docs/in-span.md", "src/lib.rs"]);
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
    const restored = prepareBase({ kind: "host", dir }, head, "/r", "fixture");
    expect(restored.restored).toEqual(["src/lib.rs"]);
    expect(readFileSync(join(dir, "src/lib.rs"), "utf8")).toBe("x\n");
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

const MNT_IMAGE = process.env.SM_SCORE_GO_IMAGE ?? "";
describe.skipIf(!(process.env.GSTACK_EVALS_DOCKER === "1" && MNT_IMAGE))("history in Docker (SM_SCORE_GO_IMAGE)", () => {
  test("a VOLUME the image declares inside the tree stays put and the history still becomes one commit", () => {
    const tag = "sm-history-mnt:test", vol = "sm-history-mnt-test";
    const d = (args: string[], input?: string) => spawnSync("docker", args, { encoding: "utf8", input });
    try {
      expect(d(["build", "-q", "-t", tag, "-"], "FROM " + MNT_IMAGE + "\nVOLUME /w/mnt_tmp\n").status).toBe(0);
      d(["volume", "create", vol]);
      const s = d(["run", "--rm", "--network", "none", "--user", "0:0", "-v", vol + ":/w", "--entrypoint", "bash", tag, "-c", "cd /w && git init -q && echo a > a.txt && git add a.txt && git -c user.name=a -c user.email=a@localhost commit -q -m one && git rev-parse HEAD"]);
      const r = prepareBase({ kind: "docker", image: tag, volume: vol, repoDir: "/w", name: "sm-history-mnt" }, s.stdout.trim(), "/w", "mnt");
      expect(r.preflight).toContain("count=1");
    } finally {
      d(["volume", "rm", "-f", vol]);
      d(["image", "rm", "-f", tag]);
    }
  });
});

describe.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1")("session image on a runtime image that declares a VOLUME inside the repo dir (docker)", () => {
  const pid = process.pid;
  const d = (args: string[], input?: string) => spawnSync("docker", args, { encoding: "utf8", input, timeout: 900_000 });
  const tag = { git: "sm-test-git:" + pid, plain: "sm-test-novol:" + pid, vol: "sm-test-vol:" + pid, full: "sm-test-volfull:" + pid };
  const tree = { one: "sm-test-tree1-" + pid, two: "sm-test-tree2-" + pid };
  const built: string[] = [];
  const unit = (t: string): SmUnit => ({ id: "vol-unit", repo_dir: "/w", image: { runtime_id: d(["image", "inspect", "--format", "{{.Id}}", t]).stdout.trim() } }) as unknown as SmUnit;
  const anon = () => d(["volume", "ls", "-q"]).stdout.split("\n").filter((v) => /^[0-9a-f]{64}$/.test(v)).sort();
  const look = (image: string) => d(["run", "--rm", "--network", "none", "--entrypoint", "sh", image, "-c", "cd /w && echo \"STATUS[$(git status --porcelain)]\" && ls -A"]).stdout.trim().split("\n");
  const repo = (n: number) => "cd /d && git init -q && " + Array.from({ length: n }, (_, i) => "echo " + i + " > a.txt && git add a.txt && git -c user.name=t -c user.email=t@e commit -qm c" + i).join(" && ") + " && echo junk > untracked.txt";
  beforeAll(() => {
    expect(d(["build", "-q", "-t", tag.git, "-"], "FROM " + PY_IMAGE + "\nRUN apt-get update -qq && apt-get install -y -qq --no-install-recommends git >/dev/null && rm -rf /var/lib/apt/lists/*\n").status).toBe(0);
    expect(d(["build", "-q", "-t", tag.plain, "-"], "FROM " + tag.git + "\nRUN mkdir -p /w && echo orig > /w/orig.txt\n").status).toBe(0);
    expect(d(["build", "-q", "-t", tag.vol, "-"], "FROM " + tag.plain + "\nVOLUME /w/mnt_tmp\n").status).toBe(0);
    expect(d(["build", "-q", "-t", tag.full, "-"], "FROM " + tag.plain + "\nRUN mkdir -p /w/mnt_tmp && echo orig > /w/mnt_tmp/x\nVOLUME /w/mnt_tmp\n").status).toBe(0);
    for (const [v, n] of [[tree.one, 1], [tree.two, 2]] as const) {
      d(["volume", "create", v]);
      expect(d(["run", "--rm", "--network", "none", "-v", v + ":/d", "--entrypoint", "sh", tag.git, "-c", repo(n)]).status).toBe(0);
    }
  }, 900_000);
  afterAll(() => {
    for (const t of [...built, tag.full, tag.vol, tag.plain, tag.git]) d(["image", "rm", "-f", t]);
    for (const v of Object.values(tree)) d(["volume", "rm", "-f", v]);
  });
  test("an image with no volume builds as before: one commit, a clean tree, the image's own files gone", () => {
    const img = buildSessionImage(unit(tag.plain), { volume: tree.one, stage: "first" });
    built.push(img.tag);
    expect(img.commits).toBe(1);
    expect(look(img.image_id)).toEqual(["STATUS[]", ".git", "a.txt"]);
  }, 300_000);
  test("an image with a VOLUME inside the repo dir builds: the rm and git clean skip the mount point, the tree is clean, and no anonymous volume is left", () => {
    const before = anon();
    const img = buildSessionImage(unit(tag.vol), { volume: tree.one, stage: "first" });
    built.push(img.tag);
    expect(img.commits).toBe(1);
    expect(look(img.image_id)).toEqual(["STATUS[]", ".git", "a.txt", "mnt_tmp"]);
    expect(anon()).toEqual(before);
  }, 300_000);
  test("a failed build on such an image leaves no anonymous volume", () => {
    const before = anon();
    expect(() => buildSessionImage(unit(tag.vol), { volume: tree.two, stage: "first" })).toThrow(/^E_SM_HISTORY .*has 2 commits, not 1/);
    expect(anon()).toEqual(before);
  }, 300_000);
  test("an image whose volume path already holds files fails closed, since every session's volume would start with them", () => {
    const before = anon();
    expect(() => buildSessionImage(unit(tag.full), { volume: tree.one, stage: "first" })).toThrow(/^E_SM_HISTORY .*SM_MOUNT_NOT_EMPTY mnt_tmp/);
    expect(anon()).toEqual(before);
  }, 300_000);
});
