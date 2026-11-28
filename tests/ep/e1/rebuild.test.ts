// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unitDigests } from "../../../lanes/eng-planted/construct/digests.ts";
import { admitStaged, sealedImages } from "../../../lanes/eng-planted/e1/rebuild.ts";

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
  };
  const kept = (s: ReturnType<typeof stage>) => {
    for (const k of ["units", "repos"] as const) expect(readFileSync(join(s.live[k], "u1", "sentinel.txt"), "utf8")).toBe("previous " + k + "\n");
    expect(existsSync(join(s.live.units, "u1", "ep-unit.json"))).toBe(false);
    expect(existsSync(join(s.staged.units, "u1"))).toBe(false);
    expect(existsSync(join(s.live.units + ".prev", "u1"))).toBe(false);
    expect(existsSync(join(s.live.repos + ".prev", "u1"))).toBe(false);
  };
  test("a digest mismatch adds nothing to the live folders and leaves a previous live pair as it was", () => {
    const s = stage();
    previous(s);
    const sealedDigests = s.sealed.map((l) => (l.startsWith("D ") ? "D " + "0".repeat(64) : l));
    expect(admitStaged({ id: "u1", ...s, sealedDigests, sealedPlanted: ["c1"], planted: ["c1"] })).toEqual({ digests: "mismatch", planted: "same", admitted: false });
    kept(s);
  });
  test("an admitted unit replaces a previous live pair and leaves nothing set aside", () => {
    const s = stage();
    previous(s);
    expect(admitStaged({ id: "u1", ...s, sealedDigests: s.sealed, sealedPlanted: ["c1"], planted: ["c1"] }).admitted).toBe(true);
    expect(existsSync(join(s.live.units, "u1", "ep-unit.json"))).toBe(true);
    expect(existsSync(join(s.live.units, "u1", "sentinel.txt"))).toBe(false);
    expect(existsSync(join(s.live.repos, "u1", "sentinel.txt"))).toBe(false);
    expect(existsSync(join(s.live.units + ".prev", "u1"))).toBe(false);
  });
  for (const [when, fails] of [
    ["the unit's move into the live folder", (from: string, to: string) => from.includes("units.staging")],
    ["the repo's move into the live folder", (from: string, to: string) => from.includes("repos.staging")],
    ["setting the previous unit aside", (from: string, to: string) => to.includes("units.prev")],
  ] as const) {
    test("a failure at " + when + " puts the previous live pair back and promotes nothing", () => {
      const s = stage();
      previous(s);
      const move = (from: string, to: string) => {
        if (fails(from, to)) throw new Error("injected rename failure");
        renameSync(from, to);
      };
      expect(() => admitStaged({ id: "u1", ...s, sealedDigests: s.sealed, sealedPlanted: ["c1"], planted: ["c1"] }, move)).toThrow("injected rename failure");
      kept(s);
    });
  }
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

