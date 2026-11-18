// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the second attempt's ledger split, with pre-run change 4's rule and stage 1's rows: every approved item's ledger items sum to at most its frozen cap, each one-run part keeps 1.35 times its cost.py central figure plus its allowance, each launch's two items fit its frozen line, and the schedule check walks every launch's rounds under the launch loop's reservation rule; fails_when=a part grows past its approved cap, a launch cannot finish its schedule at its required multiple of central, the repair cannot start one Opus round, or the planning figures drift from cost.py.
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

  test("the second attempt's split, row for row, at its section 7 caps", () => {
    expect(SPLIT.map((p) => [p.item, p.central, p.allowance, p.cap])).toEqual([
      ["ohr-author", 281.64, 28, 409],
      ["ohr-audit", 28.81, 1, 40],
      ["ohr-s1-arms", 99.6, null, 151],
      ["ohr-s1-sim", 5.76, null, 14],
      ["ohr-s1-labels", 4.32, null, 7],
      ["ohr-s1-repair-arms", null, null, 38],
      ["ohr-s1-repair-sim", null, null, 7],
      ["ohr-s1-repair-labels", null, null, 3],
      ["ohr-judge-check", 89.8, 1, 123],
      ["ohr-s2-arms", 944, null, 1308],
      ["ohr-s2-sim", 38.4, null, 58],
      ["ohr-s2-labels", 28.8, null, 40],
      ["ohr-s2p-arms", 52, null, 77],
      ["ohr-s2p-sim", 19.2, null, 32],
      ["ohr-s2p-labels", 14.4, null, 21],
      ["ohr-hosts", 13.18, 1, 19],
    ]);
    expect(Object.fromEntries((Object.keys(CAPS) as (keyof typeof CAPS)[]).map((line) => [line, SPLIT.filter((p) => p.line === line).reduce((t, p) => t + p.cap, 0)]))).toEqual(CAPS);
  });

  test("stage 1 and the judge check keep pre-run change 4's rows, as the second attempt's section 7 says", () => {
    const tsv = readFileSync(join(import.meta.dir, "../../wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-4/split.tsv"), "utf8");
    const rows = tsv.trimEnd().split("\n").slice(1).map((l) => l.split("\t")).filter((r) => r[1] === "stage1" || r[1] === "judge_check");
    expect(rows).toEqual(SPLIT.filter((p) => p.line === "stage1" || p.line === "judge_check").map((p) => [p.item, p.line, String(p.central ?? ""), String(p.allowance ?? ""), String(p.cap), p.what]));
  });

  test("each stage 2 launch's items take its schedule's need at 1.35 times central, rounded up, and its arms item the rest of the approved cap", () => {
    const open = SPLIT.map((p) => ({ ...p, cap: 1e6 }));
    for (const [name, line] of [["stage2", "stage2"], ["stage2-particle", "stage2_particle"]] as const) {
      const s = SCHEDULES.find((x) => x.name === name)!;
      const need = walkSchedule(s, 1.35, open).need;
      const cap = (item: string) => SPLIT.find((p) => p.item === item)!.cap;
      expect([cap(s.items.sim), cap(s.items.labels)]).toEqual([Math.ceil(need.sim), Math.ceil(need.labels)]);
      expect(cap(s.items.arms)).toBe(CAPS[line] - cap(s.items.sim) - cap(s.items.labels));
      expect(cap(s.items.arms)).toBeGreaterThanOrEqual(need.arms);
    }
  });

  test("a part one dollar past its approved cap is refused", () => {
    expect(splitProblems(SPLIT.map((p) => (p.item === "ohr-hosts" ? { ...p, cap: 20 } : p)))).toEqual(["hosts's ledger items sum to $20, past its approved cap of $19"]);
  });

  test("a part under 1.35 times central is refused, and so is a duplicate item", () => {
    expect(splitProblems(SPLIT.map((p) => (p.item === "ohr-audit" ? { ...p, cap: 38 } : p))).join()).toContain("ohr-audit's cap $38 is under 1.35 times");
    expect(splitProblems(SPLIT.map((p) => (p.item === "ohr-audit" ? { ...p, cap: 39 } : p))).join()).toContain("ohr-audit's cap $39 does not hold 1.35 times central plus its stated allowance");
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

  test("the schedule check: stage 1, stage 2 and particle-1 finish at 1.35 times central, and the repair starts one brief on all three models", () => {
    const read = (name: string, at: number) => walkSchedule(SCHEDULES.find((s) => s.name === name)!, at);
    expect(read("stage1", 1.35)).toMatchObject({ rounds: 24, started: 24, stops_on: null });
    expect(read("stage1-repair", 1.35)).toMatchObject({ started: 3, ran: 9, stops_on: "arms" });
    expect(read("stage1-repair", 1)).toMatchObject({ started: 3, stops_on: "arms" });
    expect(read("stage2", 1.35)).toMatchObject({ rounds: 160, started: 160, sessions: 480, stops_on: null });
    expect(read("stage2-particle", 1.35)).toMatchObject({ rounds: 80, started: 80, sessions: 240, stops_on: null });
    expect(finishesUpTo(SCHEDULES.find((s) => s.name === "stage1")!)).toBeGreaterThanOrEqual(1.35);
    expect(finishesUpTo(SCHEDULES.find((s) => s.name === "stage2")!)).toBe(1.354);
    expect(finishesUpTo(SCHEDULES.find((s) => s.name === "stage2-particle")!)).toBe(1.363);
  });

  test("change 3's split under the two-attempt reservation stops stage 1 before its first round, and the repair cannot start one", () => {
    const c3: Record<string, number> = { "ohr-s1-arms": 150, "ohr-s1-sim": 9, "ohr-s1-labels": 7, "ohr-s1-repair-arms": 48, "ohr-s1-repair-sim": 3, "ohr-s1-repair-labels": 3, "ohr-s2p-arms": 83, "ohr-s2p-sim": 32, "ohr-s2p-labels": 24 };
    const split = SPLIT.map((p) => ({ ...p, cap: c3[p.item] ?? p.cap }));
    const read = (name: string) => walkSchedule(SCHEDULES.find((s) => s.name === name)!, 1, split, 2);
    expect(read("stage1")).toMatchObject({ started: 0, stops_on: "sim" });
    expect(read("stage1-repair").started).toBe(0);
    expect(read("stage2-particle")).toMatchObject({ rounds: 80, started: 80, stops_on: null });
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
