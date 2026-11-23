// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertHomeContained, containHome, frameRepos, idiomOf, readFrame, unrelated, type FrameUnit } from "../../lanes/outcome-skills/h2h/arms/contain.ts";
import { fixtureRepo, fixtureRow } from "../../lanes/outcome-skills/statemachines/fixtures.ts";
import { toCandidate } from "../../lanes/outcome-skills/statemachines/source.ts";
import { writeUnit } from "../../lanes/outcome-skills/statemachines/unit.ts";

const FIX = "    let total_after_reset = counter.reset_and_count();";
const MARK = "    assert_eq!(counter.reset_and_count(), 0, \"reset clears the total\");";
const LONG = "reset_clears_the_total_value";
const SHORT = "rst_total";
const D = "sha256:" + "c".repeat(64);
const g = (d: string, ...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d, encoding: "utf8" });

function unit(repo = "example-org/widget", id = "example-org__widget-7"): string {
  const row = fixtureRow({
    repo, instance_id: id,
    patch: "diff --git a/src/counter.rs b/src/counter.rs\n--- a/src/counter.rs\n+++ b/src/counter.rs\n@@ -1 +1,2 @@\n fn reset() {}\n+" + FIX + "\n",
    test_patch: "diff --git a/tests/counter.rs b/tests/counter.rs\n--- a/tests/counter.rs\n+++ b/tests/counter.rs\n@@ -1 +1,2 @@\n // tests\n+" + MARK + "\n",
    FAIL_TO_PASS: ["counter::" + LONG, "counter::" + SHORT],
  });
  const dir = join(mkdtempSync(join(tmpdir(), "h2h-unit-")), "u");
  writeUnit(dir, { ...toCandidate("rust", row), image_digest: D }, row);
  return dir;
}
const base = () => ({ kind: "host" as const, dir: fixtureRepo({ "src/counter.rs": "fn reset() {}\n", "tests/counter.rs": "// tests\n" }).dir });
function home(files: Record<string, string>): string {
  const h = mkdtempSync(join(tmpdir(), "h2h-home-"));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(h, p)), { recursive: true });
    writeFileSync(join(h, p), body);
  }
  return h;
}
const tgz = (dir: string, out: string) => spawnSync("tar", ["-czf", out, "-C", dir, "."]);

describe("containment over an arm's home", () => {
  test("a clean home passes and counts each needle set", () => {
    const r = containHome({ arm: "tstack", home: home({ ".claude/skills/full-send/SKILL.md": "Full send.\n" }), unitDir: unit(), where: base() });
    expect(r.ok).toBe(true);
    expect(r.hits).toEqual([]);
    expect(r.needles).toEqual({ line: 1, marker: 1, name: 2 });
  });

  test("a leak planted in a pack's node_modules is caught, named by path and sha256, and drops the unit", () => {
    const h = home({ ".claude/skills/gstack/node_modules/widget/src/counter.rs": "fn x() {}\n" + FIX + "\n" });
    const r = containHome({ arm: "gstack-qa", home: h, unitDir: unit(), where: base() });
    expect(r.home).toBe("gstack");
    expect(r.confirmed).toBe(1);
    expect(r.hits[0]).toMatchObject({ needle: "line", where: "file", path: ".claude/skills/gstack/node_modules/widget/src/counter.rs", kind: "own_package", package: "widget", idiom: null });
    expect(JSON.stringify(r)).not.toContain("reset_and_count");
    let msg = "";
    try {
      assertHomeContained(r);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/^E_H2H_HOME_LEAK example-org__widget-7: 1 confirmed hit\(s\) in the gstack home \(arm gstack-qa\): line \.claude\/skills\/gstack\/node_modules\/widget\/src\/counter\.rs sha256 [0-9a-f]{64}; the unit drops for every arm$/);
    expect(msg).not.toContain("reset_and_count");
  });

  test("a hidden test name of 12 characters or fewer is classified as an idiom, not counted", () => {
    const r = containHome({ arm: "gsd", home: home({ ".claude/gsd-core/runtime.js": "function " + SHORT + "() {}\n" }), unitDir: unit(), where: base() });
    expect(r.hits.map((h) => [h.needle, h.idiom])).toEqual([["name", "short_name"]]);
    expect(r.confirmed).toBe(0);
    expect(r.idioms).toBe(1);
    expect(r.ok).toBe(true);
    expect(() => assertHomeContained(r)).not.toThrow();
  });

  test("a needle in at least 3 unrelated repositories of the frame is an idiom; forks and same-owner repositories do not count", () => {
    const m = MARK.trim();
    const fu = (repo: string): FrameUnit => ({ repo, text: "diff --git a/t b/t\n--- a/t\n+++ b/t\n@@ -1 +1,2 @@\n  " + m + "\n+x\n" });
    const three = [fu("alpha/one"), fu("beta/two"), fu("gamma/three")];
    const related = [fu("alpha/one"), fu("beta/two"), fu("example-org/other"), fu("someone/widget"), fu("ALPHA/one")];
    expect(unrelated("example-org/widget", "someone/widget")).toBe(false);
    expect(unrelated("example-org/widget", "example-org/other")).toBe(false);
    expect(frameRepos("marker", MARK, "example-org/widget", three)).toBe(3);
    expect(frameRepos("marker", MARK, "example-org/widget", related)).toBe(2);
    expect(idiomOf("name", LONG, "example-org/widget", [fu("a/b")]).idiom).toBeNull();
    const h = home({ ".npm/notes.txt": MARK + "\n" });
    const idiom = containHome({ arm: "agent-skills", home: h, unitDir: unit(), where: base(), frame: three });
    expect(idiom.hits.map((x) => [x.needle, x.idiom, x.frame_repos])).toEqual([["marker", "frame_common", 3]]);
    expect(idiom.ok).toBe(true);
    const hit = containHome({ arm: "agent-skills", home: h, unitDir: unit(), where: base(), frame: related });
    expect(hit.confirmed).toBe(1);
    expect(hit.ok).toBe(false);
  });

  test("the frame file lists unit dirs and reads their repositories and patches", () => {
    const list = join(mkdtempSync(join(tmpdir(), "h2h-frame-")), "frame.txt");
    writeFileSync(list, unit("alpha/one", "alpha__one-1") + "\n" + unit("beta/two", "beta__two-2") + "\n");
    const f = readFrame(list);
    expect(f.map((u) => u.repo)).toEqual(["alpha/one", "beta/two"]);
    expect(f[0]!.text).toContain(FIX);
  });

  test("git objects and archives two levels deep are read, and a third level is listed, not opened", () => {
    const h = home({ ".claude/skills/ok/SKILL.md": "ok\n" });
    const store = join(h, ".claude/plugins/marketplaces/m");
    mkdirSync(store, { recursive: true });
    g(store, "init", "-q");
    writeFileSync(join(store, "leak.rs"), FIX + "\n");
    g(store, "add", "-A");
    g(store, "commit", "-q", "-m", "c");
    rmSync(join(store, "leak.rs"));
    const w = mkdtempSync(join(tmpdir(), "h2h-arch-"));
    mkdirSync(join(w, "l3"), { recursive: true });
    writeFileSync(join(w, "l3", "deep.txt"), FIX + "\n");
    mkdirSync(join(w, "l2"), { recursive: true });
    writeFileSync(join(w, "l2", "marker.txt"), MARK + "\n");
    tgz(join(w, "l3"), join(w, "l2", "inner.tgz"));
    mkdirSync(join(w, "l1", "package"), { recursive: true });
    writeFileSync(join(w, "l1", "package", "name.txt"), "it(\"" + LONG + "\")\n");
    tgz(join(w, "l2"), join(w, "l1", "package", "nested.tar.gz"));
    mkdirSync(join(h, ".npm/_cacache/content-v2/sha512/aa"), { recursive: true });
    tgz(join(w, "l1"), join(h, ".npm/_cacache/content-v2/sha512/aa/bb"));
    const r = containHome({ arm: "gsd", home: h, unitDir: unit(), where: base() });
    expect(r.stores).toEqual([".claude/plugins/marketplaces/m/.git"]);
    const by = (n: string) => r.hits.filter((x) => x.needle === n).map((x) => [x.where, x.path]);
    expect(by("line")).toEqual([["git", ".claude/plugins/marketplaces/m/.git"]]);
    expect(by("name")).toEqual([["archive", ".npm/_cacache/content-v2/sha512/aa/bb!package/name.txt"]]);
    expect(by("marker")).toEqual([["archive", ".npm/_cacache/content-v2/sha512/aa/bb!package/nested.tar.gz!marker.txt"]]);
    expect(r.archives.map((a) => [a.level, a.opened])).toEqual([[1, true], [2, true], [3, false]]);
    expect(r.confirmed).toBe(3);
  });
});
