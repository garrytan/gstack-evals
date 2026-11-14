// Copyright (c) 2026 Garry Tan. MIT License.
// The frame command end to end on a fake gh and real local git, its refusals, the CLI rows and the area's dry run.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../../lanes/design-constructed/cli.ts";
import { dryRun } from "../../../lanes/design-constructed/dryrun.ts";
import { FRAME } from "../../../lanes/design-constructed/frozen.ts";
import { fileCheck } from "../../../lanes/design-constructed/frame/filecheck.ts";
import { fakeGh, node, PASSING_APP, writeTree } from "../../../lanes/design-constructed/frame/fixtures.ts";
import { fetchAt, headOf, safeArgs } from "../../../lanes/design-constructed/frame/git.ts";
import { runFrame, type FrameSeams } from "../../../lanes/design-constructed/frame/run.ts";
import { buildSearchQuery } from "../../../lanes/design-constructed/frame/search.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "dc-run-"));
const capture = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) }, out, err };
};

/** A local git repository holding files, committed; returns its folder and commit. */
function repoOf(files: Record<string, string>): { dir: string; oid: string } {
  const dir = writeTree(files);
  const g = (...a: string[]) => spawnSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...a], { cwd: dir, encoding: "utf8" }).stdout.trim();
  g("init", "-q");
  g("add", "-A");
  g("commit", "-q", "-m", "fixture");
  return { dir, oid: g("rev-parse", "HEAD") };
}

describe("hardened git", () => {
  test("every call turns hooks, LFS smudge and other protocols off", () => {
    const a = safeArgs(["fetch"]).join(" ");
    for (const c of ["core.hooksPath=/dev/null", "filter.lfs.smudge=", "protocol.allow=never", "protocol.https.allow=always", "submodule.recurse=false"]) expect(a).toContain(c);
  });

  test("a hook committed into the source never runs and the clone keeps .git at the oid", () => {
    const src = repoOf({ "a.txt": "x\n", ".githooks/post-checkout": "#!/bin/sh\ntouch hooked\n" });
    const dest = join(tmp(), "c");
    try {
      fetchAt("file://" + src.dir, src.oid, dest, ["file"]);
      expect(headOf(dest)).toBe(src.oid);
      expect(spawnSync("test", ["-e", join(dest, "hooked")]).status).not.toBe(0);
    } finally {
      rmSync(src.dir, { recursive: true, force: true });
    }
  });
});

describe("runFrame", () => {
  test("search, filters, order, clones by oid and file check, written to out with digests", () => {
    const good = repoOf(PASSING_APP);
    const q = buildSearchQuery(FRAME.topics[2], FRAME.licenses[1]).variables.q;
    const gh = fakeGh({ [q]: [node("plum/desk", { oid: good.oid }), node("plum/second", { oid: good.oid }), node("fern/kit", { stargazerCount: 10 }), node("moss/gone", { oid: "e".repeat(40) })] });
    const out = tmp();
    const seams: FrameSeams = {
      gh: gh.exec,
      sleep: gh.sleep,
      now: gh.now,
      clone: (_name, oid, dest) => fetchAt("file://" + good.dir, oid, dest, ["file"]),
      lane: () => ({ commit: "a".repeat(40), dirty: false, root: "/nonexistent-lane-root" }),
      check: fileCheck,
    };
    try {
      const r = runFrame(out, seams);
      expect(r.lines).toContain("after stars: 3");
      expect(r.lines).toContain("frame order: 3; after the owner dedupe: 2 (frame size)");
      expect(r.lines).toContain("clone attempts: 2 (limit 100); clones: 1; unfetchable: 1");
      expect(r.lines.some((l) => l.includes("all four 1"))).toBe(true);
      expect(r.lines.join("\n")).not.toMatch(/plum|moss|fern/);
      const run = JSON.parse(readFileSync(join(out, "run.json"), "utf8"));
      expect(run.lane_commit).toBe("a".repeat(40));
      expect(run.points_used).toBe(50);
      expect(Object.keys(run.files).sort()).toEqual(["clones.json", "entry.json", "filecheck.json", "frame.json", "search.json"]);
      const clones = JSON.parse(readFileSync(join(out, "clones.json"), "utf8"));
      expect(clones.filter((c: any) => c.fetched).map((c: any) => c.nameWithOwner)).toEqual(["plum/desk"]);
      expect(() => runFrame(out, seams)).toThrow("the frame runs once");
      const gaps = gh.log.slice(1).map((l, i) => l.at - gh.log[i]!.at);
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(3000);
    } finally {
      rmSync(out, { recursive: true, force: true });
      rmSync(good.dir, { recursive: true, force: true });
    }
  });

  test("a relaunch from another commit is refused", () => {
    const out = tmp();
    writeFileSync(join(out, "launches.jsonl"), JSON.stringify({ commit: "b".repeat(40), at: "2026-11-14T00:00:00Z" }) + "\n");
    const gh = fakeGh({});
    const seams: FrameSeams = { gh: gh.exec, sleep: gh.sleep, now: gh.now, clone: () => {}, lane: () => ({ commit: "a".repeat(40), dirty: false, root: "/nonexistent-lane-root" }), check: fileCheck };
    try {
      expect(() => runFrame(out, seams)).toThrow("another commit");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe("gstack-evals dc frame and filecheck", () => {
  test("frame without --out exits 2 with E_USAGE", async () => {
    const c = capture();
    expect(await main(["frame"], c.io)).toBe(2);
    expect(c.err[0]).toStartWith("E_USAGE gstack-evals dc frame: usage: gstack-evals dc frame --out");
  });

  test("filecheck prints pass or fail per test with counts only", async () => {
    const dir = writeTree(PASSING_APP);
    try {
      const c = capture();
      expect(await main(["filecheck", "--repo", dir], c.io)).toBe(0);
      expect(c.out).toEqual(["test 1 front end: pass (1 frameworks named)", "test 2 components: pass (10 in the fullest folder)", "test 3 design system: pass (theme)", "test 4 routes: pass (3 distinct routes in 1 route sets)", "file check: pass"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the frame area's dry run", () => {
  test("every case passes", async () => {
    const r = await dryRun(["frame"]);
    expect(r.lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
    expect(r.lines.length).toBeGreaterThan(90);
  });
});
