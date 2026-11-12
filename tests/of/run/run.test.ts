// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the run loop's records and stops: every ended session writes one row that parses and holds together, a cap stop writes no row and starts nothing more, a halt writes its row as missing and stops the launch, and a resumed launch reconciles an attempt that has a marker and no row as an infrastructure failure before its retry; fails_when=a cap-stopped session gets a row or a retry, a halt lets new sessions start, or a crashed attempt is run again from scratch or forgotten; why_new=the run area's run loop; seam=runSchedule with a scripted launch, readRows, rowProblems, rowsReport; no_claim=the Docker launch, which the e2e covers
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BLOCK_REPLY, scriptedRun } from "../../../lanes/office-hours-founder/run/seams.ts";
import { readManifest, type Manifest } from "../../../lanes/office-hours-founder/run/manifest.ts";
import { readRows, rowProblems, rowsReport } from "../../../lanes/office-hours-founder/run/rows.ts";
import type { ManifestEntry } from "../../../lanes/office-hours-founder/types.ts";

const all = (arms: ManifestEntry["arm"][] = ["none", "lens", "office-hours"]) => (ids: string[]): ManifestEntry[] => ids.flatMap((unit) => arms.map((arm) => ({ stage: 1 as const, kind: "arm" as const, unit, model: "opus" as const, arm, pass: 1 })));

describe("rows", () => {
  test("every session ends in one row that parses, with the office-hours arm's state root", async () => {
    const { run, out, ids } = await scriptedRun({ entries: all(), units: 2, scripts: new Map([["x", []]]) });
    expect(run.rows).toHaveLength(6);
    const rows = readRows(out);
    expect(rows.size).toBe(6);
    for (const l of rows.values()) {
      expect(rowProblems(l)).toEqual([]);
      expect(l.row.end).toBe("block");
      expect(l.state_root !== null).toBe(l.row.arm === "office-hours");
    }
    const report = rowsReport(readManifest(join(out, "manifest.json")) as Manifest, rows);
    expect(report.problems).toEqual([]);
    expect(report.unrun).toEqual([]);
    expect(ids).toHaveLength(2);
    expect(JSON.parse(readFileSync(join(out, "stops.json"), "utf8"))).toEqual({ stops: [], unrun: [] });
  });

  test("a row whose fields disagree is a problem", async () => {
    const { out } = await scriptedRun({ entries: all(["none"]), units: 1, scripts: new Map() });
    const [l] = [...readRows(out).values()];
    expect(rowProblems({ ...l!, row: { ...l!.row, code: "E_OF_NO_BLOCK" } })).toContain("every end but block names its code");
    expect(rowProblems({ ...l!, row: { ...l!.row, attempts: 3 } }).join()).toContain("at most one retry");
  });
});

describe("stops", () => {
  test("a cap stop writes no row, is never retried and leaves the rest unrun", async () => {
    const { run, calls, ids } = await scriptedRun({ entries: all(["none"]), units: 3, scripts: new Map([["fixture-calibration-1/none", [{ replies: [["Q?"]], termination: { kind: "cap_stop" } as never }]]]) });
    expect(calls).toEqual([ids[0] + "/none/a1"]);
    expect(run.rows).toEqual([]);
    expect(run.stops.map((s) => s.code)).toEqual(["CAP_STOP"]);
    expect(run.unrun.map((u) => u.how).sort()).toEqual(["stopped", "unstarted", "unstarted"]);
  });

  test("a containment departure halts: its row is missing E_OF_LEAK and no later session starts", async () => {
    const { run, calls } = await scriptedRun({ entries: all(["none"]), units: 3, scripts: new Map([["fixture-calibration-1/none", [{ replies: [[BLOCK_REPLY]], contained: ["env name OPENAI_API_KEY"] }]]]) });
    expect(calls).toHaveLength(1);
    expect(run.rows.map((r) => [r.row.end, r.row.code])).toEqual([["missing", "E_OF_LEAK"]]);
    expect(run.stops.map((s) => s.code)).toEqual(["E_OF_LEAK"]);
    expect(run.unrun).toHaveLength(2);
  });
});

describe("resume", () => {
  test("an attempt with a marker and no row is reconciled as an infrastructure failure, then retried once", async () => {
    const first = await scriptedRun({ entries: all(["none"]), units: 1, scripts: new Map() });
    rmSync(join(first.out, "rows.ndjson"));
    const again = await scriptedRun({ entries: all(["none"]), units: 1, scripts: new Map(), out: first.out });
    expect(again.calls).toEqual([first.ids[0] + "/none/a2"]);
    const id = "arm/opus/none/" + first.ids[0] + "/p1";
    expect(existsSync(join(first.out, "sessions", id, "a1", "reconcile.json"))).toBe(true);
    const [l] = [...readRows(first.out).values()];
    expect(l!.row.end).toBe("block");
    expect(l!.row.attempts).toBe(2);
    expect(l!.attempts[0]!.why).toContain("an unknown outcome, reconciled");
  });

  test("a session that already has a row is not run again", async () => {
    const first = await scriptedRun({ entries: all(["none"]), units: 2, scripts: new Map() });
    const again = await scriptedRun({ entries: all(["none"]), units: 2, scripts: new Map(), out: first.out });
    expect(again.calls).toEqual([]);
    expect(readRows(first.out).size).toBe(2);
  });

  test("a launch whose schedule differs from the frozen manifest is refused", async () => {
    const first = await scriptedRun({ entries: all(["none"]), units: 1, scripts: new Map() });
    await expect(scriptedRun({ entries: all(["none", "lens"]), units: 1, scripts: new Map(), out: first.out })).rejects.toThrow(/E_USAGE/);
  });
});
