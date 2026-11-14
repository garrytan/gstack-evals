// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=each cell's session counts (prereg sections 10, 11 and 13 and the pitch-only ruling), rounds of up to 4 units with every arm on one model, pass and kind, and a manifest frozen with its digest that a changed body or schedule cannot pass; fails_when=a cell schedules a session the prereg does not, a round mixes models or passes, or a tampered manifest launches; why_new=the run area's manifest; seam=cellEntries, cellRounds, freezeManifest, readManifest; no_claim=real units, which stay sealed outside the repo
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TWINS } from "../../../lanes/office-hours-founder/frozen.ts";
import { cellEntries, cellProblem, cellRounds, entryId, freezeManifest, loadUnits, readManifest, twinDigest, type Cell, type Manifest } from "../../../lanes/office-hours-founder/run/manifest.ts";
import { fixtureUnits } from "../../../lanes/office-hours-founder/run/seams.ts";

const root = mkdtempSync(join(tmpdir(), "of-manifest-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
fixtureUnits(join(root, "units"), 16, "calibration");
for (const id of fixtureUnits(join(root, "units"), 8, "twin")) writeFileSync(join(root, "units", id, "key.json"), "{}\n");
fixtureUnits(join(root, "units"), 64, "comparison");
const units = loadUnits(join(root, "units"));
const count = (cell: Cell, f: (e: ReturnType<typeof cellEntries>[number]) => boolean = () => true) => cellEntries(cell, units).filter(f).length;

describe("cells", () => {
  test("counts", () => {
    expect(count("stage1", (e) => e.kind === "arm")).toBe(136);
    expect(count("stage1", (e) => e.kind === "arm" && e.model === "opus")).toBe(72);
    expect(count("stage1", (e) => e.kind === "reference")).toBe(112);
    expect(count("smoke", (e) => e.arm === "office-hours")).toBe(18);
    expect(count("smoke", (e) => e.arm === "lens" && e.model === "opus")).toBe(2);
    expect(count("smoke")).toBe(20);
    expect(count("stage2")).toBe(768);
    expect(count("pitch")).toBe(576);
    expect(count("pitch", (e) => e.kind === "pitch" && e.pass === 1)).toBe(576);
  });

  test("the smoke takes the first calibration units by draw", () => {
    const cal = units.filter((u) => u.set === "calibration").sort((a, b) => a.draw - b.draw).map((u) => u.id);
    expect([...new Set(cellEntries("smoke", units).filter((e) => e.arm === "lens").map((e) => e.unit))]).toEqual(cal.slice(0, 2));
    expect([...new Set(cellEntries("smoke", units).filter((e) => e.arm === "office-hours").map((e) => e.unit))]).toEqual(cal.slice(0, 6));
  });

  test("a units dir short of a quota is refused", () => {
    const dir = join(root, "units");
    const pin = { ...TWINS, digest: twinDigest(dir, units) };
    expect(cellProblem("stage1", units, dir, pin)).toBeNull();
    expect(cellProblem("stage1", units, dir)).toContain("pinned twins");
    expect(cellProblem("stage1", units.filter((u) => u.set !== "twin"), dir, pin)).toContain("6 to 8 twins");
    expect(cellProblem("stage2", units.slice(0, 40), dir)).toContain("64 comparison");
    expect(cellProblem("real", units, dir)).toContain("real-stratum");
  });
});

describe("rounds", () => {
  for (const cell of ["stage1", "smoke", "stage2", "pitch"] as const) {
    test(cell + ": every session once, rounds of up to 4 units on one model, pass and kind", () => {
      const entries = cellEntries(cell, units);
      const rounds = cellRounds(cell, entries);
      expect(rounds.flat().map(entryId).sort()).toEqual(entries.map(entryId).sort());
      for (const r of rounds) {
        expect(new Set(r.map((e) => e.unit)).size).toBeLessThanOrEqual(4);
        expect(new Set(r.map((e) => e.model + e.pass + e.kind)).size).toBe(1);
      }
    });
  }

  test("stage 2 rounds hold all three arms for each of their units, pass 1 before pass 2", () => {
    const rounds = cellRounds("stage2", cellEntries("stage2", units));
    for (const r of rounds) for (const u of new Set(r.map((e) => e.unit))) expect(r.filter((e) => e.unit === u).map((e) => e.arm)).toEqual(["none", "lens", "office-hours"]);
    const passes = rounds.map((r) => r[0]!.pass);
    expect(passes.indexOf(2)).toBeGreaterThan(passes.lastIndexOf(1));
    expect(rounds[0]!.map((e) => e.model)[0]).toBe("opus");
    expect(rounds[1]!.map((e) => e.model)[0]).toBe("sol");
  });

  test("stage 1 runs in draw order and stage 2 in a seeded order", () => {
    const first = cellRounds("stage1", cellEntries("stage1", units))[0]!;
    expect([...new Set(first.map((e) => e.unit))]).toEqual(["fixture-calibration-1", "fixture-calibration-2", "fixture-calibration-3", "fixture-calibration-4"]);
    const s2 = cellRounds("stage2", cellEntries("stage2", units)).flat().map((e) => e.unit);
    expect(s2).toEqual(cellRounds("stage2", cellEntries("stage2", units)).flat().map((e) => e.unit));
    expect([...new Set(s2)].slice(0, 4)).not.toEqual(["fixture-comparison-1", "fixture-comparison-10", "fixture-comparison-11", "fixture-comparison-12"]);
  });
});

describe("freeze", () => {
  const m: Manifest = { schema: 1, cell: "smoke", models: ["opus"], arms: ["lens"], repairs: [], units: { a: "d0" }, entries: [{ stage: 1, kind: "arm", unit: "a", model: "opus", arm: "lens", pass: 1 }] };

  test("freezes once, then matches the same schedule and refuses another", () => {
    const path = join(root, "m1.json");
    const first = freezeManifest(path, m);
    expect(first).toMatchObject({ wrote: true });
    expect(freezeManifest(path, m)).toEqual({ sha256: (first as { sha256: string }).sha256, wrote: false });
    expect(freezeManifest(path, { ...m, repairs: ["forced-line"] })).toMatchObject({ problem: expect.stringContaining("schedules") });
    expect(readManifest(path)).toEqual(m);
  });

  test("a body edited after it froze is refused", () => {
    const path = join(root, "m2.json");
    freezeManifest(path, m);
    const frozen = JSON.parse(readFileSync(path, "utf8"));
    frozen.manifest.entries[0].pass = 2;
    writeFileSync(path, JSON.stringify(frozen));
    expect(freezeManifest(path, m)).toMatchObject({ problem: expect.stringContaining("does not match its body") });
    expect(() => readManifest(path)).toThrow(/does not match its body/);
  });

  test("entry ids name kind, model, arm, unit and pass", () => {
    expect(entryId(m.entries[0]!)).toBe("arm/opus/lens/a/p1");
  });
});
