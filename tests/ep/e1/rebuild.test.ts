// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unitDigests } from "../../../lanes/eng-planted/construct/digests.ts";
import { admitStaged, sealedImages, setAside } from "../../../lanes/eng-planted/e1/rebuild.ts";
import { unitFolders } from "../../../lanes/eng-planted/stages/pipeline.ts";

describe("the rebuild pins the base image to the sealed digest", () => {
  const pinned = { "golang:1.24": "golang@sha256:new", "node:22": "node@sha256:n" };
  test("a pin whose image name matches the sealed FROM moves to the sealed digest; others stay", () => {
    expect(sealedImages(pinned, "# syntax=docker/dockerfile:1\n# Generated\nFROM golang@sha256:old\nRUN x\n")).toEqual({ "golang:1.24": "golang@sha256:old", "node:22": "node@sha256:n" });
  });
  test("a sealed Dockerfile with no digest in FROM leaves the pins as they are", () => {
    expect(sealedImages(pinned, "FROM scratch\n")).toEqual(pinned);
  });
});

describe("a rebuilt unit reaches the draw's folders only once admitted", () => {
  const git = (cwd: string, ...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf8" });
  const stage = () => {
    const root = mkdtempSync(join(tmpdir(), "ep-e1-admit-"));
    const staged = { units: join(root, "units.staging"), repos: join(root, "repos.staging") };
    const live = { units: join(root, "units"), repos: join(root, "repos") };
    const unit = join(staged.units, "u1");
    const src = join(root, "src");
    mkdirSync(join(unit, "environment"), { recursive: true });
    mkdirSync(join(unit, "restore"), { recursive: true });
    mkdirSync(src);
    git(src, "init", "-q", "-b", "main");
    writeFileSync(join(src, "a.txt"), "a\n");
    git(src, "add", ".");
    git(src, "commit", "-q", "-m", "b");
    git(src, "bundle", "create", "-q", join(unit, "environment", "task.bundle"), "main");
    writeFileSync(join(unit, "environment", "Dockerfile"), "FROM scratch\n");
    writeFileSync(join(unit, "restore", "t.py"), "assert True\n");
    writeFileSync(join(unit, "ep-unit.json"), "{}\n");
    mkdirSync(join(staged.repos, "u1"), { recursive: true });
    return { staged, live, sealed: unitDigests(unit) };
  };
  const gone = (s: ReturnType<typeof stage>) => {
    for (const d of [s.staged.units, s.staged.repos, s.live.units, s.live.repos]) expect(existsSync(join(d, "u1"))).toBe(false);
  };

  test("a unit whose digests and planted set match moves into the live folders, and staging is emptied", () => {
    const s = stage();
    expect(admitStaged({ id: "u1", ...s, sealedDigests: s.sealed, sealedPlanted: ["c2", "c1"], planted: ["c1", "c2"] })).toEqual({ digests: "match", planted: "same", admitted: true });
    expect(existsSync(join(s.live.units, "u1", "ep-unit.json"))).toBe(true);
    expect(existsSync(join(s.live.repos, "u1"))).toBe(true);
    expect(existsSync(join(s.staged.units, "u1"))).toBe(false);
  });
  const previous = (s: ReturnType<typeof stage>) => {
    for (const k of ["units", "repos"] as const) {
      mkdirSync(join(s.live[k], "u1"), { recursive: true });
      writeFileSync(join(s.live[k], "u1", "sentinel.txt"), "previous " + k + "\n");
    }
    writeFileSync(join(s.live.units, "u1", "ep-unit.json"), JSON.stringify({ id: "u1", previous: true }) + "\n");
  };
  const drawable = (s: ReturnType<typeof stage>) => unitFolders(s.live.units, s.live.repos).units().map((u) => u.id);
  const quarantined = (s: ReturnType<typeof stage>) => {
    expect(drawable(s)).toEqual([]);
    for (const k of ["units", "repos"] as const) {
      expect(existsSync(join(s.live[k], "u1"))).toBe(false);
      const kept = setAside(s.live[k]);
      expect(kept).toHaveLength(1);
      expect(readFileSync(join(kept[0]!, "sentinel.txt"), "utf8")).toBe("previous " + k + "\n");
      expect(existsSync(join(s.staged[k], "u1"))).toBe(false);
    }
  };
  const refusals = [
    ["a digest mismatch", (s: ReturnType<typeof stage>) => ({ sealedDigests: s.sealed.map((l) => (l.startsWith("D ") ? "D " + "0".repeat(64) : l)), planted: ["c1"] })],
    ["a different planted set", (s: ReturnType<typeof stage>) => ({ sealedDigests: s.sealed, planted: ["c1", "c2"] })],
  ] as const;
  for (const [why, inputs] of refusals) {
    test(why + " keeps a previous live pair out of the draw, set aside and unchanged", () => {
      const s = stage();
      previous(s);
      expect(drawable(s)).toEqual(["u1"]);
      expect(admitStaged({ id: "u1", ...s, sealedPlanted: ["c1"], ...inputs(s) }).admitted).toBe(false);
      quarantined(s);
    });
  }
  test("an admitted unit replaces a previous live pair and leaves nothing set aside", () => {
    const s = stage();
    previous(s);
    expect(admitStaged({ id: "u1", ...s, sealedDigests: s.sealed, sealedPlanted: ["c1"], planted: ["c1"] }).admitted).toBe(true);
    expect(readFileSync(join(s.live.units, "u1", "ep-unit.json"), "utf8")).toBe("{}\n");
    expect(existsSync(join(s.live.units, "u1", "sentinel.txt"))).toBe(false);
    expect(existsSync(join(s.live.repos, "u1", "sentinel.txt"))).toBe(false);
    expect([...setAside(s.live.units), ...setAside(s.live.repos)]).toEqual([]);
  });
  const failing = (fails: (from: string, to: string) => boolean) => (from: string, to: string) => {
    if (fails(from, to)) throw new Error("injected rename failure");
    renameSync(from, to);
  };
  for (const [when, fails] of [
    ["the unit's move into the live folder", (from: string) => from.includes("units.staging")],
    ["the repo's move into the live folder", (from: string) => from.includes("repos.staging")],
    ["setting the previous repo aside", (_from: string, to: string) => to.includes("repos.prev")],
  ] as const) {
    test("a failure at " + when + " is raised, promotes nothing and keeps the previous pair set aside, out of the draw", () => {
      const s = stage();
      previous(s);
      expect(() => admitStaged({ id: "u1", ...s, sealedDigests: s.sealed, sealedPlanted: ["c1"], planted: ["c1"] }, { move: failing(fails) })).toThrow("injected rename failure");
      expect(drawable(s)).toEqual([]);
      expect(existsSync(join(s.staged.units, "u1"))).toBe(false);
      expect(setAside(s.live.units)).toHaveLength(1);
      if (when !== "setting the previous repo aside") quarantined(s);
    });
  }
  test("a failure setting the previous unit aside is raised before anything else moves: the live pair is as it was", () => {
    const s = stage();
    previous(s);
    expect(() => admitStaged({ id: "u1", ...s, sealedDigests: s.sealed, sealedPlanted: ["c1"], planted: ["c1"] }, { move: failing((_f, to) => to.includes("units.prev")) })).toThrow("injected rename failure");
    for (const k of ["units", "repos"] as const) expect(readFileSync(join(s.live[k], "u1", "sentinel.txt"), "utf8")).toBe("previous " + k + "\n");
    expect(existsSync(join(s.staged.units, "u1"))).toBe(false);
  });
  test("a failure removing a set-aside copy after promotion is raised and leaves the admitted pair live", () => {
    const s = stage();
    previous(s);
    const remove = (p: string) => {
      if (p.includes(".prev")) throw new Error("injected remove failure");
      rmSync(p, { recursive: true, force: true });
    };
    expect(() => admitStaged({ id: "u1", ...s, sealedDigests: s.sealed, sealedPlanted: ["c1"], planted: ["c1"] }, { remove })).toThrow("injected remove failure");
    expect(drawable(s)).toHaveLength(1);
    expect(readFileSync(join(s.live.units, "u1", "ep-unit.json"), "utf8")).toBe("{}\n");
    expect(existsSync(join(s.live.repos, "u1"))).toBe(true);
  });
  test("an admitted unit also clears set-aside copies of it left by earlier attempts, and no other unit's", () => {
    const s = stage();
    for (const k of ["units", "repos"] as const) {
      mkdirSync(join(s.live[k] + ".prev", "u1.1"), { recursive: true });
      mkdirSync(join(s.live[k] + ".prev", "u2.1"), { recursive: true });
    }
    expect(admitStaged({ id: "u1", ...s, sealedDigests: s.sealed, sealedPlanted: ["c1"], planted: ["c1"] }).admitted).toBe(true);
    for (const k of ["units", "repos"] as const) expect(setAside(s.live[k]).map((x) => x.split("/").pop())).toEqual(["u2.1"]);
  });
  test("a different planted set leaves nothing in either live folder", () => {
    const s = stage();
    expect(admitStaged({ id: "u1", ...s, sealedDigests: s.sealed, sealedPlanted: ["c1"], planted: ["c1", "c2"] })).toEqual({ digests: "match", planted: "different", admitted: false });
    gone(s);
  });
  test("a staged unit whose digests cannot be read (no task bundle) is refused, not thrown", () => {
    const s = stage();
    spawnSync("rm", ["-f", join(s.staged.units, "u1", "environment", "task.bundle")]);
    expect(admitStaged({ id: "u1", ...s, sealedDigests: s.sealed, sealedPlanted: ["c1"], planted: ["c1"] }).admitted).toBe(false);
    gone(s);
  });
});

