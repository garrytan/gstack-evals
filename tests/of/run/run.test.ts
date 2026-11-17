// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the run loop's records and stops: every ended session writes one row that parses and holds together, a cap stop writes no row and starts nothing more, a halt writes its row as missing and stops the launch, and a resumed launch reconciles an attempt that has a marker and no row as an infrastructure failure before its retry; fails_when=a cap-stopped session gets a row or a retry, a halt lets new sessions start, or a crashed attempt is run again from scratch or forgotten; why_new=the run area's run loop; seam=runSchedule with a scripted launch, readRows, rowProblems, rowsReport; no_claim=the Docker launch, which the e2e covers
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BLOCK_REPLY, scriptedRun } from "../../../lanes/office-hours-founder/run/seams.ts";
import { readManifest, type Manifest } from "../../../lanes/office-hours-founder/run/manifest.ts";
import { readRows, rowProblems, rowsReport } from "../../../lanes/office-hours-founder/run/rows.ts";
import { meterSlot } from "../../../lanes/office-hours-founder/run/run.ts";
import { SIM_CALL, worstCase } from "../../../lanes/office-hours-founder/sim/founder.ts";
import type { ManifestEntry } from "../../../lanes/office-hours-founder/types.ts";
import type { Meter } from "../../../lanes/product-value/meter.ts";

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

  test("a launch on an out dir that ended in a cap stop is refused, and its stops.json stands", async () => {
    const scripts = () => new Map([["fixture-calibration-1/none", [{ replies: [["Q?"]], termination: { kind: "cap_stop" } as never }]]]);
    const first = await scriptedRun({ entries: all(["none"]), units: 3, scripts: scripts() });
    const stops = readFileSync(join(first.out, "stops.json"), "utf8");
    await expect(scriptedRun({ entries: all(["none"]), units: 3, scripts: new Map(), out: first.out })).rejects.toThrow(/E_USAGE .*cap stop/);
    expect(readFileSync(join(first.out, "stops.json"), "utf8")).toBe(stops);
  });

  test("a launch after a halt keeps the halt in stops.json under earlier", async () => {
    const first = await scriptedRun({ entries: all(["none"]), units: 2, scripts: new Map([["fixture-calibration-1/none", [{ replies: [[BLOCK_REPLY]], contained: ["env name OPENAI_API_KEY"] }]]]) });
    const again = await scriptedRun({ entries: all(["none"]), units: 2, scripts: new Map(), out: first.out });
    expect(again.calls).toHaveLength(1);
    const stops = JSON.parse(readFileSync(join(first.out, "stops.json"), "utf8"));
    expect(stops.stops).toEqual([]);
    expect(stops.earlier.map((s: { code: string }) => s.code)).toEqual(["E_OF_LEAK"]);
  });

  test("a containment departure halts: its row is missing E_OF_LEAK and no later session starts", async () => {
    const { run, calls } = await scriptedRun({ entries: all(["none"]), units: 3, scripts: new Map([["fixture-calibration-1/none", [{ replies: [[BLOCK_REPLY]], contained: ["env name OPENAI_API_KEY"] }]]]) });
    expect(calls).toHaveLength(1);
    expect(run.rows.map((r) => [r.row.end, r.row.code])).toEqual([["missing", "E_OF_LEAK"]]);
    expect(run.stops.map((s) => s.code)).toEqual(["E_OF_LEAK"]);
    expect(run.unrun).toHaveLength(2);
  });
});

describe("interim stop", () => {
  const stage2 = (ids: string[]): ManifestEntry[] => ids.flatMap((unit) => (["none", "office-hours"] as const).map((arm) => ({ stage: 2 as const, kind: "arm" as const, unit, model: "opus" as const, arm, pass: 1 })));
  const ohOf = (id: string) => id.startsWith("arm/opus/office-hours/");

  test("exposure under 0.70 on the first 24 Opus office-hours sessions stops that arm and leaves the other arms running", async () => {
    const { run, out } = await scriptedRun({ cell: "stage2", entries: stage2, units: 30, scripts: new Map(), exposed: (id) => (ohOf(id) ? false : null) });
    expect(run.interim).toEqual({ sessions: 24, exposed: 0, stop: true });
    expect(run.rows.filter((r) => ohOf(r.id))).toHaveLength(24);
    expect(run.rows.filter((r) => !ohOf(r.id))).toHaveLength(30);
    expect(run.unrun.map((u) => u.how)).toEqual(Array(6).fill("interim"));
    expect(run.stops).toEqual([]);
    expect(JSON.parse(readFileSync(join(out, "stops.json"), "utf8")).interim).toEqual({ sessions: 24, exposed: 0, stop: true });
    const again = await scriptedRun({ cell: "stage2", entries: stage2, units: 30, scripts: new Map(), out, exposed: (id) => (ohOf(id) ? false : null) });
    expect(again.calls).toEqual([]);
    expect(again.run.interim).toEqual({ sessions: 24, exposed: 0, stop: true });
    expect(again.run.unrun.map((u) => u.how)).toEqual(Array(6).fill("interim"));
  });

  test("exposure at 0.70 or above lets the arm go on, and a session with no exposure read does not count", async () => {
    let nulls = 0;
    const { run } = await scriptedRun({ cell: "stage2", entries: stage2, units: 30, scripts: new Map(), exposed: (id) => (!ohOf(id) ? null : nulls < 2 ? (nulls++, null) : true) });
    expect(run.interim).toEqual({ sessions: 24, exposed: 24, stop: false });
    expect(run.rows).toHaveLength(60);
    expect(run.unrun).toEqual([]);
  });

  test("other cells read no interim stop", async () => {
    const { run, out } = await scriptedRun({ entries: all(["office-hours"]), units: 30, scripts: new Map(), exposed: () => false });
    expect(run.interim).toBeNull();
    expect(run.rows).toHaveLength(30);
    expect(JSON.parse(readFileSync(join(out, "stops.json"), "utf8")).interim).toBeUndefined();
  });
});

describe("simulator slot", () => {
  test("prices the simulator's whole chat as the proxy reserves it", async () => {
    const req = { system: "You play a founder. ".repeat(200), messages: [{ role: "user" as const, content: "What have people paid for? ".repeat(200) }] };
    const worst = worstCase(req);
    let calls = 0;
    const meter = { call: async () => (calls++, { text: "ok", status: 200, micros: 1, cached: false, served_by: "Google", problem: null }) } as unknown as Meter;
    const call = { model: SIM_CALL.model, prompt: "", maxTokens: SIM_CALL.maxTokens, effort: SIM_CALL.effort, label: "x", system: req.system, messages: req.messages, temperature: SIM_CALL.temperature, seed: SIM_CALL.seed };
    const short = await meterSlot(meter)("s", worst - 1).call(call);
    expect(short.status).toBe(402);
    expect(short.problem).toStartWith("E_ALLOWANCE");
    expect(calls).toBe(0);
    expect((await meterSlot(meter)("s", worst).call(call)).status).toBe(200);
    expect(calls).toBe(1);
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
