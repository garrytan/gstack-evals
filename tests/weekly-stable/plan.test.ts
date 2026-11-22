// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plannedCells } from "../../quick/laneb/l1/l1.ts";
import { toMicros, type Row } from "../../quick/laneb/runner/ledger.ts";
import { approve, guard, isoWeek, itemOf, partTasks, projection, taskLists, totals, weekPlan, weekSeed } from "../../lanes/weekly-stable/plan.ts";
import { PILOT, WEEK_ITEM_CAP, WEEK_STOP } from "../../lanes/weekly-stable/pins.ts";

const L = taskLists(), ITEM = itemOf("2026-11-28"), SEED = weekSeed("2026-11-28");
describe("tasks, seeds and weeks", () => {
  test("130 tasks in run order, the first 80 the preregistration's, and three pilot tasks outside them", () => {
    expect([L.run.length, new Set(L.run).size, L.pilot]).toEqual([130, 130, ["psd-tools__psd-tools-593", "BerriAI__litellm-16526", "schemathesis__schemathesis-3195"]]);
    expect(L.run.slice(0, 3)).toEqual(["careamics__careamics-688", "microsoft__qcodes-8039", "pandas-dev__pandas-64797"]);
  });
  test("the seed is the first 4 bytes of SHA-256 of the date, big-endian (values from Python's hashlib)", () => {
    expect([weekSeed("2026-11-28"), weekSeed("2026-11-22")]).toEqual([1275945340, 3750637864]);
  });
  test("ISO weeks match Python's isocalendar, including year ends", () => {
    const want: Record<string, string> = { "2026-11-28": "2026-W48", "2026-11-22": "2026-W47", "2027-01-01": "2026-W53", "2027-01-04": "2027-W01", "2021-01-03": "2020-W53" };
    for (const [d, w] of Object.entries(want)) expect(isoWeek(d).label).toBe(w);
    expect(isoWeek("2026-11-28").tag).toBe("weekly-2026-w48");
  });
});
describe("the week's plan", () => {
  const parts = weekPlan(ITEM, L.run, L.pilot, [], SEED);
  test("a smoke part, then three parts of whole tasks in run order, 44, 43 and 43", () => {
    expect(parts.map((p) => p.name)).toEqual(["smoke", "s390-1", "s390-2", "s390-3"]);
    expect(partTasks(L.run).map((x) => x.length)).toEqual([44, 43, 43]);
    expect(partTasks(L.run).flat()).toEqual(L.run);
    expect([...plannedCells(parts[0]!)].sort()).toEqual(L.pilot.map((t) => [t + "\tcandidate", 1] as [string, number]).sort());
  });
  test("every task has three candidate, three stable and one none session, all in one part; job 1 holds all three arms", () => {
    for (const t of L.run) {
      const holding = parts.filter((p) => p.rects.some((r) => r.tasks.includes(t)));
      expect(holding.length).toBe(1);
      const c = plannedCells(holding[0]!);
      expect([c.get(t + "\tcandidate"), c.get(t + "\tstable"), c.get(t + "\tnone")]).toEqual([3, 3, 1]);
      expect(holding[0]!.rects.map((r) => [...r.arms].sort().join())).toEqual(["candidate,none,stable", "candidate,stable", "candidate,stable"]);
    }
  });
  test("dropped tasks leave every part, and the seed changes the order but not the cells", () => {
    const drop = L.run.slice(10, 15), p2 = weekPlan(ITEM, L.run, L.pilot, drop, SEED);
    expect(p2.flatMap((p) => p.rects.flatMap((r) => r.tasks)).some((t) => drop.includes(t))).toBe(false);
    const other = weekPlan(ITEM, L.run, L.pilot, [], weekSeed("2026-12-05"));
    expect(other[1]!.rects[0]!.tasks).not.toEqual(parts[1]!.rects[0]!.tasks);
    expect([...plannedCells(other[1]!)].sort()).toEqual([...plannedCells(parts[1]!)].sort());
  });
  test("the projection matches change 1's money table: $416 expected model spend, 18 sessions in flight, the $610 item", () => {
    const p = projection(ITEM, parts);
    expect([p.sessions, Math.round(p.expected), p.parallel, p.cap]).toEqual([913, 416, 54, 610]);
    const pilot = projection(PILOT.item, weekPlan(PILOT.item, L.run, L.pilot, [], SEED));
    expect([pilot.sessions, pilot.expected, pilot.parallel, pilot.cap]).toEqual([9, 3.81, 6, 14]);
  });
});
describe("money", () => {
  const parts = weekPlan(ITEM, L.run, L.pilot, [], SEED), pilotParts = weekPlan(PILOT.item, L.run, L.pilot, [], SEED);
  const approval = (item: string, usd: number): Row => ({ ts: "2026-11-28T06:00:00Z", item, kind: "approval", id: "approval", usd_micros: toMicros(usd) } as Row);
  test("the week passes with room, and the meter counts toward the $645 stop", () => {
    const ok = guard(ITEM, [approval(ITEM, WEEK_ITEM_CAP)], { parts, finished: [] }, 20);
    expect([ok.ok, ok.lines[0]!.startsWith("WEEKLY_LAUNCH PASS")]).toEqual([true, true]);
    const over = guard(ITEM, [approval(ITEM, WEEK_ITEM_CAP)], { parts, finished: [] }, WEEK_STOP - 500);
    expect(over.ok).toBe(false);
    expect(over.why[0]).toMatch(/week stop/);
  });
  test("the pilot's peak reservation, two sessions, a VM block and the host's reserve, is $13.20 of its $14", () => {
    const g = guard(PILOT.item, [approval(PILOT.item, 14)], { parts: pilotParts, finished: [] }, 0);
    expect([g.ok, g.total]).toEqual([true, toMicros(13.2)]);
    const spent = guard(PILOT.item, [approval(PILOT.item, 14), { ts: "t", item: PILOT.item, kind: "settle", id: "s1", usd_micros: toMicros(1) } as Row], { parts: pilotParts, finished: [] }, 0);
    expect(spent.ok).toBe(false);
  });
  test("a relaunch overshoot is reported, never refused; a done item never launches", () => {
    const rows = [approval(ITEM, WEEK_ITEM_CAP), { ts: "t", item: ITEM, kind: "settle", id: "x", usd_micros: toMicros(700) } as Row];
    expect(guard(ITEM, rows, { parts, finished: [] }, 0, "s390-1").lines[0]).toMatch(/^WEEKLY_LAUNCH OVERSHOOT/);
    expect(guard(ITEM, [...rows.slice(0, 1), { ts: "t", item: ITEM, kind: "note", id: "done", usd_micros: 0 } as Row], { parts, finished: [] }, 0).why[0]).toMatch(/marked done/);
    expect(() => totals([approval(ITEM, 645)], ITEM)).toThrow(/approval row at \$610/);
  });
  test("approve writes only the recorded cap, once", () => {
    const dir = mkdtempSync(join(tmpdir(), "weekly-approve-")), path = join(dir, "l.jsonl");
    try {
      expect(() => approve(path, ITEM, 645, "captain")).toThrow(/recorded cap is \$610/);
      approve(path, ITEM, 610, "captain");
      expect(() => approve(path, ITEM, 610, "captain")).toThrow(/already holds rows/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
