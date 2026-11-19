// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the ledger split pre-run change 4 freezes: every approved item's ledger items sum to at most its frozen cap, each one-run part keeps 1.35 times its cost.py central figure plus its allowance, each launch's two items fit its frozen line, and the schedule check walks every launch's rounds under the launch loop's reservation rule; fails_when=a part grows past its approved cap, a launch cannot finish its schedule at its required multiple of central, the repair cannot start one Opus round, or the planning figures drift from cost.py.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CAPS } from "../../lanes/office-hours-rewrite/frozen.ts";
import { CENTRAL, finishesUpTo, LAUNCH_ITEMS, SCHEDULES, SPLIT, splitProblems, walkSchedule } from "../../lanes/office-hours-rewrite/ledger.ts";
import { dryRun } from "../../lanes/office-hours-rewrite/dryrun.ts";

describe("the ledger split", () => {
  test("holds as written, and each approved item's parts sum to at most its cap", () => {
    expect(splitProblems()).toEqual([]);
    for (const line of Object.keys(CAPS) as (keyof typeof CAPS)[]) expect(SPLIT.filter((p) => p.line === line).reduce((t, p) => t + p.cap, 0)).toBeLessThanOrEqual(CAPS[line]);
  });

  test("matches the table pre-run change 4 freezes, row for row", () => {
    const tsv = readFileSync(join(import.meta.dir, "../../wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-4/split.tsv"), "utf8");
    const rows = tsv.trimEnd().split("\n").slice(1).map((l) => l.split("\t"));
    expect(rows).toEqual(SPLIT.map((p) => [p.item, p.line, String(p.central ?? ""), String(p.allowance ?? ""), String(p.cap), p.what]));
  });

  test("a part one dollar past its approved cap is refused", () => {
    expect(splitProblems(SPLIT.map((p) => (p.item === "ohr-hosts" ? { ...p, cap: 23 } : p)))).toEqual(["hosts's ledger items sum to $23, past its approved cap of $22"]);
  });

  test("a part under 1.35 times central is refused, and so is a duplicate item", () => {
    expect(splitProblems(SPLIT.map((p) => (p.item === "ohr-audit" ? { ...p, cap: 39 } : p))).join()).toContain("ohr-audit's cap $39 is under 1.35 times");
    expect(splitProblems([...SPLIT, SPLIT[0]!]).join()).toContain("item ohr-author appears twice");
  });

  test("cost.py's planning figures are the ones the schedule check walks", () => {
    const py = readFileSync(join(import.meta.dir, "../../wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg/cost.py"), "utf8");
    const pair = (a: string, b: string) => new RegExp("^" + a + ", " + b + " = ([0-9.]+), ([0-9.]+)$", "m").exec(py)!.slice(1).map(Number);
    expect(pair("OPUS_SKILL", "OPUS_NONE")).toEqual([CENTRAL.session.opus.skill, CENTRAL.session.opus.none]);
    expect(pair("SOL_SKILL", "SOL_NONE")).toEqual([CENTRAL.session.sol.skill, CENTRAL.session.sol.none]);
    expect(pair("P1_SKILL", "P1_NONE")).toEqual([CENTRAL.session.particle.skill, CENTRAL.session.particle.none]);
    expect(pair("SIM", "LABEL")).toEqual([CENTRAL.sim, CENTRAL.label]);
  });

  test("the schedule check: stage 1 finishes at 1.35 times central, stage 2 and particle-1 at central, and the repair starts one brief on all three models", () => {
    const read = (name: string, at: number) => walkSchedule(SCHEDULES.find((s) => s.name === name)!, at);
    expect(read("stage1", 1.35)).toMatchObject({ rounds: 24, started: 24, stops_on: null });
    expect(read("stage1-repair", 1.35)).toMatchObject({ started: 3, ran: 9, stops_on: "arms" });
    expect(read("stage1-repair", 1)).toMatchObject({ started: 3, stops_on: "arms" });
    expect(read("stage2", 1)).toMatchObject({ rounds: 188, started: 188, stops_on: null });
    expect(read("stage2-particle", 1)).toMatchObject({ rounds: 94, started: 94, stops_on: null });
    expect(finishesUpTo(SCHEDULES.find((s) => s.name === "stage1")!)).toBeGreaterThanOrEqual(1.35);
  });

  test("change 3's split under the two-attempt reservation stops stage 1 before its first round, and the repair cannot start one", () => {
    const c3: Record<string, number> = { "ohr-s1-arms": 150, "ohr-s1-sim": 9, "ohr-s1-labels": 7, "ohr-s1-repair-arms": 48, "ohr-s1-repair-sim": 3, "ohr-s1-repair-labels": 3, "ohr-s2p-arms": 83, "ohr-s2p-sim": 32, "ohr-s2p-labels": 24 };
    const split = SPLIT.map((p) => ({ ...p, cap: c3[p.item] ?? p.cap }));
    const read = (name: string) => walkSchedule(SCHEDULES.find((s) => s.name === name)!, 1, split, 2);
    expect(read("stage1")).toMatchObject({ started: 0, stops_on: "sim" });
    expect(read("stage1-repair").started).toBe(0);
    expect(read("stage2-particle")).toMatchObject({ started: 84, stops_on: "sim" });
    expect(splitProblems(split).some((p) => p.startsWith("stage1: does not finish at 1.35"))).toBe(true);
  });

  test("each launch names two items in the split", () => {
    for (const it of Object.values(LAUNCH_ITEMS)) for (const item of [it.arms, it.sim]) expect(SPLIT.map((p) => p.item)).toContain(item);
  });

  test("the dry run's split and ledger lines pass: one lease per ledger item, and a second run refused", async () => {
    const lines = (await dryRun({ ledger: true })).filter((l) => /^ledger( split)?: /.test(l.name));
    expect(lines.length).toBeGreaterThanOrEqual(5);
    expect(lines.some((l) => l.name.includes("refuses a second run (E_ITEM_BOUND)"))).toBe(true);
    expect(lines.filter((l) => l.state !== "PASS")).toEqual([]);
  });
});
