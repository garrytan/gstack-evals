// Value: protects=the draw holds back the pilot's last 5 never-run P units, its first 5 B units and a seeded decoy, then 15
// seeded validation units, before it fills the counted set with P in rank order and B in draw order to 100 at 3 a
// repository, refuses below 80 or with any gate pending, and gives the same sets for the same inputs; fails_when=a held-back
// unit enters the counted set, the cap or the order drifts, or the draw changes run to run; why_new=GEVA-590 section 2,
// Pilots, and pre-run change 1 item 1; seam=draw, pendingUnits on planted records; no_claim=the real supply's counts
import { describe, expect, test } from "bun:test";
import type { BRecord } from "../../../../src/trial/review/supply/b-units.ts";
import { draw, pendingUnits } from "../../../../src/trial/review/supply/draw.ts";
import type { PRecord } from "../../../../src/trial/review/supply/p-units.ts";
import type { VisResult } from "../../../../src/trial/review/supply/visibility.ts";

const P = (rank: number, o: Partial<PRecord> = {}): PRecord => ({ id: "p" + rank, repo: "o/p" + (rank % 30), pr: rank, head: "h", base: "b", group: "S1", rank, decoy: false, ran: rank % 2 === 0, evidence: "", paths: [], cases: [], fix: null, head_dates: null, disclosure: {}, gates: { g1: "ok", g4: "ok" }, ...o });
const D = (i: number, o: Partial<PRecord> = {}): PRecord => P(0, { id: "n" + String(i).padStart(2, "0"), repo: "o/n" + i, rank: null, decoy: true, ...o });
const B = (position: number, o: Partial<BRecord> = {}): BRecord => ({ position, ghsa: "GHSA-" + position, repo: "o/b" + position, ecosystem: "npm", published: "2026-08-01", fix: { kind: "commit", ref: "", commit: "f", parent: "p" }, cves: [], source_files: 1, szz: { basis: "deleted", blamed_lines: 2, blamed_commits: 1, bic: position.toString(16).padStart(40, "a"), bic_lines: 2 }, shape: null, bic_dates: null, fix_dates: null, disclosure: {}, gates: { g1: "ok", g2: "ok", g4: "ok" }, ...o });
const vis = (bs: BRecord[], fail: number[] = []): Record<string, VisResult> => Object.fromEntries(bs.map((b) => [b.ghsa, { unit: "", verdicts: {}, g3: fail.includes(b.position) ? { fail: "astra no" } : "ok" }]));

function supply() {
  const p = Array.from({ length: 101 }, (_, i) => P(i + 1, i + 1 === 7 ? { gates: { g1: { fail: "early" }, g4: "ok" } } : i + 1 === 99 ? { error: "E_RMS_GIT x", gates: {} } : {}));
  const decoys = Array.from({ length: 15 }, (_, i) => D(i));
  const b = Array.from({ length: 40 }, (_, i) => B(i, i === 2 ? { gates: { g1: "ok", g2: { fail: "big" } } } : {}));
  return { p: [...p, ...decoys], b, v: vis(b.filter((x) => x.position !== 2), [5]) };
}

describe("draw", () => {
  test("pilot, validation and counted sets, held back in order and deterministic", () => {
    const s = supply();
    const d = draw(s.p, s.b, s.v);
    expect(draw(s.p, s.b, s.v)).toEqual(d);
    expect(d.pilot.p.map((u) => u.rank)).toEqual([91, 93, 95, 97, 101]);
    expect(d.pilot.b.map((u) => u.position)).toEqual([0, 1, 3, 4, 6]);
    expect(d.pilot.decoy.pool).toBe("decoy");
    expect(d.decoys).toHaveLength(15);
    expect(d.validation).toHaveLength(15);
    const pilot = new Set([...d.pilot.p, ...d.pilot.b].map((u) => u.id));
    const val = new Set(d.validation.map((u) => u.id));
    expect(d.validation.some((u) => pilot.has(u.id))).toBe(false);
    expect(d.counted.some((u) => pilot.has(u.id) || val.has(u.id))).toBe(false);
    expect(d.counted).toHaveLength(100);
    const ranks = d.counted.filter((u) => u.pool === "P").map((u) => u.rank!);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks).not.toContain(7);
    expect(ranks).not.toContain(99);
    const firstB = d.counted.findIndex((u) => u.pool === "B");
    expect(d.counted.slice(firstB).every((u) => u.pool === "B")).toBe(true);
    expect(d.counted.some((u) => u.position === 5 || u.position === 2)).toBe(false);
    const perRepo = new Map<string, number>();
    for (const u of d.counted) perRepo.set(u.repo, (perRepo.get(u.repo) ?? 0) + 1);
    expect(Math.max(...perRepo.values())).toBeLessThanOrEqual(3);
    expect(d.capped.length).toBeGreaterThan(0);
    expect(draw(s.p, s.b, s.v, 7).validation).not.toEqual(d.validation);
  });

  test("refuses with gates pending and below the floor", () => {
    const s = supply();
    const missing = { ...s.v };
    delete missing["GHSA-9"];
    expect(pendingUnits(s.p, s.b, missing)).toEqual(["GHSA-9"]);
    expect(() => draw(s.p, s.b, missing)).toThrow("E_RMS_PENDING");
    const noG4 = [...s.p.slice(0, 3).map((r) => ({ ...r, gates: { g1: "ok" as const } })), ...s.p.slice(3)];
    expect(pendingUnits(noG4, s.b, s.v)).toEqual(["p1", "p2", "p3"]);
    const few = s.p.filter((r) => r.decoy || r.rank! > 40);
    expect(() => draw(few, s.b.slice(0, 20), s.v)).toThrow("E_RMS_FLOOR");
    expect(() => draw(s.p.filter((r) => r.decoy || r.ran), s.b, s.v)).toThrow("the pilot needs 5 P units");
  });
});
