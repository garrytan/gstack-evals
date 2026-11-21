// Copyright (c) 2026 Garry Tan. MIT License.
// B1e (lanes/delivery-route/b1e.ts): the bar on each set, every row of the decision table and its R48 verdict, the fresh draw
// and route table against their pins, the smoke rule, the plans and the caps against the crew's formula.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { barReading, b1dInRows, b1eApprove, b1eCap, b1eMain, b1ePlan, decision, freshTasks, partProblems, R48, routeRows } from "../../lanes/delivery-route/b1e.ts";
import { routeCounts, smokeOf, type Stat } from "../../lanes/delivery-route/b1d.ts";
import { GSTACK_ARM as B1D_GSTACK } from "../../lanes/delivery-route/b1d-pins.ts";
import { B1E_BUNDLE, B1E_CAPS_USD, B1E_ITEMS, B1E_SMOKE, COVERAGE, FRESH, GSTACK_ARM } from "../../lanes/delivery-route/b1e-pins.ts";
import { REPO } from "../../lanes/delivery-route/pins.ts";

const stat = (loaded: number, graded = 60, cap_stops = 0) => ({ arm: "gstack-main", planned: 60, graded, gaps: 60 - graded, cap_stops, incomplete: cap_stops > 0 || 60 - graded > 6, loaded } as unknown as Stat);

describe("b1e bar and decision", () => {
  test("the bar is a point count at 39, INCOMPLETE first", () => {
    expect(barReading(stat(39), "x").key).toBe("clears");
    expect(barReading(stat(38), "x").key).toBe("short");
    expect(barReading(stat(39, 54), "x").key).toBe("clears");
    expect(barReading(stat(45, 53), "x").key).toBe("incomplete");
    expect(barReading(stat(50, 60, 1), "x").key).toBe("incomplete");
  });
  test("every row of the decision table", () => {
    const r = (k: string) => ({ key: k, text: "" }) as ReturnType<typeof barReading>;
    const want: [string, string, string][] = [
      ["incomplete", "clears", "none"], ["incomplete", "short", "none"],
      ["short", "clears", "stays"], ["short", "short", "stays"], ["short", "incomplete", "stays"],
      ["clears", "clears", "cut"], ["clears", "short", "owner"], ["clears", "incomplete", "owner"],
    ];
    for (const [a, b, k] of want) { const d = decision(r(a), r(b)); expect(d.key).toBe(k); expect(R48[d.key]).toBeTruthy(); }
    expect(decision(r("clears"), r("incomplete")).text).toContain("INCOMPLETE");
    expect(decision(r("clears"), r("short")).text).toContain("gstack's owner");
  });
});

describe("b1e pins", () => {
  test("the arm is B1d's but for the gstack commit and its blobs", () => {
    const { sha, version, blobs, ...rest } = GSTACK_ARM, { sha: s0, version: v0, blobs: b0, ...rest0 } = B1D_GSTACK;
    expect(rest).toEqual(rest0);
    expect(sha).not.toBe(s0);
    expect(Object.keys(blobs)).toEqual(Object.keys(b0));
  });
  test("the fresh draw is the committed one and refuses another", () => {
    const list = freshTasks();
    expect(list.length).toBe(FRESH.tasks);
    expect(() => freshTasks([...list.slice(1), list[0]].join("\n") + "\n")).toThrow("E_B1_PIN");
    const b1 = readFileSync(join(REPO, "wiki/plans/2026-11-17-geva-547-delivery-route-prereg/tasks.txt"), "utf8"), ho = readFileSync(join(REPO, "wiki/board/2026-11-19-capy-b1d-hook-default-results/heldout-list.txt"), "utf8");
    for (const t of list) { expect(b1.includes(" " + t + "\n")).toBe(false); expect(ho.includes(t + "\n")).toBe(false); }
  });
  test("the committed route table gives the pinned coverage and smoke tasks", () => {
    const rows = routeRows();
    for (const k of ["run", "fresh"] as const) { const n = routeCounts(rows.filter((r) => r[0] === k)); expect([n.only, n["first of two"], n["second of two"], n["not named"]]).toEqual([COVERAGE[k].only, COVERAGE[k].first, COVERAGE[k].second, COVERAGE[k].none]); expect(n.disagree).toBe(0); }
    expect(smokeOf(rows)).toEqual([...B1E_SMOKE]);
    expect(B1E_BUNDLE.startsWith("wiki/plans/")).toBe(true);
  });
  test("plans and caps follow the crew's formula", () => {
    expect([b1ePlan("b1e-smoke").sessions, b1ePlan("b1e-in").sessions, b1ePlan("b1e-fresh").sessions]).toEqual([4, 60, 120]);
    for (const i of B1E_ITEMS) expect(b1eCap(i).cap).toBe(B1E_CAPS_USD[i]);
    expect(() => b1ePlan("b1d-in")).toThrow("E_USAGE");
  });
});

describe("b1e guards", () => {
  test("approve records only an item's own cap, named, on an empty ledger", () => {
    const p = join(mkdtempSync(join(tmpdir(), "b1e-")), "ledger.jsonl");
    expect(() => b1eApprove(p, "b1d-in", 90, "x")).toThrow("E_USAGE");
    expect(() => b1eApprove(p, "b1e-in", 90, " ")).toThrow("E_USAGE");
    expect(() => b1eApprove(p, "b1e-in", B1E_CAPS_USD["b1e-in"] + 1, "x")).toThrow("E_USAGE");
    b1eApprove(p, "b1e-in", B1E_CAPS_USD["b1e-in"], "x");
    expect(() => b1eApprove(p, "b1e-in", B1E_CAPS_USD["b1e-in"], "x")).toThrow("already holds rows");
  });
  test("launch refuses a work dir that plans another lane's item", async () => {
    const w = mkdtempSync(join(tmpdir(), "b1e-w-"));
    writeFileSync(join(w, "plan.json"), JSON.stringify({ item: "b1d-in", git_head: "HEAD" }));
    await expect(b1eMain(["launch", w, "--part", "b1d-in-1"])).rejects.toThrow("E_USAGE");
  });
  test("a report refuses rows from another run's parts, B1d's in-sample table included", () => {
    const b1d = b1dInRows(), row = b1d[0]!;
    expect(partProblems(b1d, "b1e-in").length).toBe(b1d.length);
    expect(partProblems(["b1e-in-2", "b1e-in-2-a2", "b1e-in-2-relaunch", "b1e-in-2-a2-relaunch"].map((part) => ({ ...row, part })), "b1e-in")).toEqual([]);
    expect(partProblems(["b1d-in-1-relaunch", "b1e-fresh-1-relaunch", "b1e-in-2-relaunch-a2", "b1e-in-9-relaunch"].map((part) => ({ ...row, part })), "b1e-in").length).toBe(4);
    expect(partProblems([{ ...row, part: "b1e-fresh-1" }], "b1e-in").length).toBe(1);
    expect(partProblems([{ ...row, part: "smoke-opus" }], "b1e-smoke")).toEqual([]);
  });
});
