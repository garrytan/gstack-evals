// Copyright (c) 2026 Garry Tan. MIT License.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchGate, meterReading, partCapStops, publishArgs, recordLook, reportGate, reportRows, type GhRun, type WeekFile } from "../../lanes/weekly-stable/cli.ts";
import type { WeeklyRow } from "../../lanes/weekly-stable/read.ts";
import { taskLists } from "../../lanes/weekly-stable/plan.ts";

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
const TARS = { candidate: "tar-c", stable: "tar-s", none: "tar-n" };
const week = (o: Partial<WeekFile> = {}): WeekFile => ({
  date: "2026-11-28", week_of: null, base: "ws-2026-11-28", seed: 1, start: "2026-11-28T06:00:00.000Z", candidate: "c".repeat(40), stable: "s".repeat(40), stable_tag: "v1.0.0.0",
  decision: { kind: "run" } as WeekFile["decision"], held: null, dropped: [], setup_failed: [], contamination: {}, smoke: { rig: [], flag: null, detail: [] }, arms: { pass: true, tars: TARS }, look: null, ...o,
});
const row = (task: string, arm: "candidate" | "stable" | "none", tar: string | null = TARS[arm], cost = 0.48): WeeklyRow => ({ task, arm, trial: task + arm + Math.random(), outcome: "graded", pass: true, cost_usd: cost, tar_sha256: tar, opened_at: "1" } as unknown as WeeklyRow);

describe("a counted launch needs the week's checks first", () => {
  test("the smoke needs the arms check and the contamination search; a counted part also needs a smoke with no rig failure", () => {
    expect(launchGate(week(), "smoke")).toEqual([]);
    expect(launchGate(week(), "s390-2")).toEqual([]);
    expect(launchGate(week({ arms: null }), "smoke")[0]).toMatch(/arms check/);
    expect(launchGate(week({ contamination: null }), "smoke")[0]).toMatch(/contamination search/);
    expect(launchGate(week({ smoke: null }), "s390-1")[0]).toMatch(/smoke/);
    expect(launchGate(week({ smoke: { rig: ["t: wrong tar"], flag: null, detail: [] } }), "s390-3")[0]).toMatch(/smoke/);
  });
});

describe("the meter reading", () => {
  const dir = mkdtempSync(join(tmpdir(), "weekly-meter-")), f = join(dir, "meter.json"), now = Date.parse("2026-11-28T08:00:00Z");
  roots.push(dir);
  test("a reading taken in the last hour passes; an older, future or missing as_of is refused", () => {
    writeFileSync(f, JSON.stringify({ as_of: "2026-11-28T07:30:00Z", usd: 12.5 }));
    expect(meterReading(f, now)).toBe(12.5);
    writeFileSync(f, JSON.stringify({ as_of: "2026-11-28T06:30:00Z", usd: 12.5 }));
    expect(() => meterReading(f, now)).toThrow(/older than 60 minutes/);
    writeFileSync(f, JSON.stringify({ as_of: "2026-11-28T09:00:00Z", usd: 12.5 }));
    expect(() => meterReading(f, now)).toThrow(/future/);
    writeFileSync(f, JSON.stringify({ usd: 12.5 }));
    expect(() => meterReading(f, now)).toThrow(/as_of/);
  });
});

describe("the report reads only this week's sessions", () => {
  const run = taskLists().run, pilot = taskLists().pilot;
  test("a graded row from another tar, a missing contamination search or arms check is refused", () => {
    const rows = [row(run[0]!, "candidate"), row(run[0]!, "stable"), row(run[0]!, "none")];
    expect(reportGate(week(), rows, undefined)).toEqual([]);
    expect(reportGate(week(), [...rows, row(run[1]!, "candidate", "tar-last-week")], undefined)[0]).toMatch(/1 graded session.*not this week's/);
    expect(reportGate(week({ contamination: null }), rows, undefined)[0]).toMatch(/contamination search/);
    expect(reportGate(week({ arms: null }), rows, undefined)[0]).toMatch(/arms check/);
  });
  test("--stopped must match the recorded look, and a recorded STOP needs --stopped", () => {
    const rows = [row(run[0]!, "candidate")];
    const stopped = week({ look: { stop: "HOLD", at: "2026-11-29T00:00:00Z" } });
    expect(reportGate(stopped, rows, "HOLD")).toEqual([]);
    expect(reportGate(stopped, rows, undefined)[0]).toMatch(/look stopped for HOLD/);
    expect(reportGate(stopped, rows, "GAIN")[0]).toMatch(/look stopped for HOLD/);
    expect(reportGate(week(), rows, "HOLD")[0]).toMatch(/no look recorded a stop/);
  });
  test("the counted rows and results.md leave out the smoke's sessions and dropped tasks", () => {
    const rows = [row(run[0]!, "candidate"), row(run[1]!, "candidate"), row(pilot[0]!, "candidate")];
    const r = reportRows(week({ dropped: [run[1]!] }), rows, undefined);
    expect([r.kept.length, r.rows.map((x) => x.task)]).toEqual([129, [run[0]]]);
    expect(reportRows(week(), rows, "HOLD").kept.length).toBe(65);
  });
});

describe("the look runs once and is recorded", () => {
  test("a ready look is written to week.json; a second is refused; a look that is not ready records nothing", () => {
    const w = week();
    expect(recordLook(w, { ready: false, stop: null }, "2026-11-29T00:00:00Z")).toBe(false);
    expect(w.look).toBeNull();
    expect(recordLook(w, { ready: true, stop: "GAIN" }, "2026-11-29T00:00:00Z")).toBe(true);
    expect(w.look).toEqual({ stop: "GAIN", at: "2026-11-29T00:00:00Z" });
    expect(() => recordLook(w, { ready: true, stop: null }, "2026-11-29T01:00:00Z")).toThrow(/look already ran/);
  });
});

describe("a cap stop in any part's result makes the week INCOMPLETE", () => {
  test("cap stops are read from each part's result files beside week.json", () => {
    const w = mkdtempSync(join(tmpdir(), "weekly-cap-"));
    roots.push(w);
    mkdirSync(join(w, "p2"), { recursive: true });
    writeFileSync(join(w, "p2", "s390-2.result.json"), JSON.stringify({ cap_stop: ["the proxy latched a cap stop"], loss: [] }));
    mkdirSync(join(w, "p1"), { recursive: true });
    writeFileSync(join(w, "p1", "smoke.result.json"), JSON.stringify({ cap_stop: [], loss: [] }));
    expect(partCapStops(w)).toEqual(["p2/s390-2: the proxy latched a cap stop"]);
  });
});

describe("publish", () => {
  const ok = { tag: "weekly-2026-w48", week: "2026-W48", verdict: "NO_CHANGE" }, rec = { candidate: { sha: "c".repeat(40) }, stable: { tag: "v1.0.0.0" } };
  const list = (stdout: string, status = 0): GhRun => () => ({ status, stdout, stderr: status ? "HTTP 502" : "" });
  test("a failed or unreadable release list is refused, never read as empty", () => {
    expect(publishArgs(ok, rec, "/o", list("", 1))).toMatchObject({ error: expect.stringMatching(/release list failed/) });
    expect(publishArgs(ok, rec, "/o", list("not json"))).toMatchObject({ error: expect.stringMatching(/did not return JSON/) });
    const a = publishArgs(ok, rec, "/o", list(JSON.stringify([{ tagName: "weekly-2026-w49" }])));
    expect("args" in a && a.args.includes("--latest=false")).toBe(true);
  });
});
