// Copyright (c) 2026 Garry Tan. MIT License.
// B2's money (lanes/test-first/money.ts) and the run's order: the recorded caps from the cap rule, the launch guard both ways on
// its cap, the all-in stop with this thread's counter, a done item, the pilot's done mark, Sol's image check and the look's gate,
// the dry run, and the one infrastructure rerun.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger, readRows, toMicros, type Row } from "../../quick/laneb/runner/ledger.ts";
import { approve, capOf, dryRun, infraRerun, itemGuard, launchGuard, markDone, orderProblems, planLines, type Order } from "../../lanes/test-first/money.ts";
import { itemPlan } from "../../lanes/test-first/plans.ts";
import { B2, CAPS_USD, drawnTasks, ITEM_NAMES, PREREG_CAPS_USD, RATES_USD, type Item } from "../../lanes/test-first/pins.ts";
import { row } from "./fixtures/rows.ts";

const dir = mkdtempSync(join(tmpdir(), "b2-money-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const ledger = (item: Item, spendUsd = 0, done = false): Row[] => {
  const path = join(dir, item + "-" + n++ + ".jsonl");
  approve(path, item, CAPS_USD[item], "test");
  if (spendUsd) { const l = new Ledger(path, item); l.reserve("s1", toMicros(spendUsd)); l.settle("s1", toMicros(spendUsd)); }
  if (done) markDone(path, item);
  return readRows(path);
};
const go: Order = { pilotDone: true, images: { ok: true, why: "" }, look: { decision: "continue", z: 0.5 } };
const zero = { usd: 0, as_of: "2026-11-21T08:00Z" };
const guard = (item: Item, o: { rows?: Row[]; counter?: number; order?: Partial<Order>; part?: string | null } = {}) =>
  launchGuard(item, { [item]: o.rows ?? ledger(item) }, {}, { ...zero, usd: o.counter ?? 0 }, { ...go, ...o.order }, o.part ?? null);

describe("caps", () => {
  test("the cap rule gives every preregistered cap on the drawn plan, and change 1's caps keep their sum", () => {
    const d = drawnTasks(), p = planLines(d.run, d.pilot);
    expect(p.bad).toEqual([]);
    for (const i of ITEM_NAMES) expect(capOf(i).cap).toBe(PREREG_CAPS_USD[i]);
    expect(CAPS_USD).toEqual({ "b2-pilot": 65, "b2-opus": 715, "b2-sol": 355, "b2-p1": 230 });
  });
  test("an approval at any other amount is refused, the preregistered cap included", () => {
    expect(() => approve(join(dir, "x.jsonl"), "b2-opus", 470, "test")).toThrow("recorded cap is $715");
    expect(() => approve(join(dir, "y.jsonl"), "b2-opus", 465, "test")).toThrow("recorded cap is $715");
  });
});

describe("launch guard", () => {
  test("passes a fresh item inside its cap and the all-in stop", () => {
    const g = guard("b2-opus");
    expect(g.ok).toBe(true);
    expect(g.lines[0]).toStartWith("B2_LAUNCH PASS b2-opus");
  });
  test("refuses when spend so far plus the plan passes the item's cap", () => {
    const g = guard("b2-opus", { rows: ledger("b2-opus", 650) });
    expect(g.ok).toBe(false);
    expect(g.why.join()).toContain("passes its cap $715.00");
  });
  test("refuses when this thread's counter takes the all-in total past $1,860", () => {
    expect(guard("b2-opus", { counter: 100 }).ok).toBe(true);
    const g = guard("b2-opus", { counter: 1200 });
    expect(g.ok).toBe(false);
    expect(g.why.join()).toContain("passes the $1860.00 stop");
  });
  test("refuses with no counter reading", () => {
    expect(() => launchGuard("b2-opus", {}, {}, { usd: NaN, as_of: "" }, go)).toThrow("E_USAGE");
  });
  test("refuses a done item", () => {
    expect(guard("b2-pilot", { rows: ledger("b2-pilot", 0, true) }).why.join()).toContain("marked done");
  });
  test("no counted part before the pilot is done; the pilot itself needs no order", () => {
    expect(guard("b2-opus", { order: { pilotDone: false } }).why.join()).toContain("b2-pilot is not marked done");
    expect(guard("b2-pilot", { order: { pilotDone: false, images: null, look: null } }).ok).toBe(true);
  });
  test("no Sol part before the image check records every task, and the other items need none", () => {
    expect(guard("b2-sol", { order: { images: null } }).why.join()).toContain("no image check record");
    expect(guard("b2-sol", { order: { images: { ok: false, why: "3 failed" } } }).why.join()).toContain("3 failed");
    expect(guard("b2-sol").why.join()).not.toContain("image check");
    expect(guard("b2-p1", { order: { images: null } }).ok).toBe(true);
  });
  test("at change 1's $355 cap the plan's Sol rates project past it; change 3's guard rate fits, so Sol's first counted part launches", () => {
    const parts = itemPlan("b2-sol", drawnTasks().run, drawnTasks().pilot).parts;
    const old = itemGuard("b2-sol", ledger("b2-sol"), parts, [], RATES_USD);
    expect([old.total, old.fits]).toEqual([toMicros(467.58), false]);
    const g = guard("b2-sol");
    expect(g.ok).toBe(true);
    expect(g.lines.join()).toContain("b2-sol $237.00 of cap $355.00");
  });
  test("no part past the look's half without a look record that says continue", () => {
    expect(guard("b2-opus", { part: "b2-" + B2.lookParts, order: { look: null } }).ok).toBe(true);
    expect(guard("b2-opus", { part: "b2-" + (B2.lookParts + 1), order: { look: null } }).why.join()).toContain("no look record");
    expect(guard("b2-opus", { part: "b2-" + (B2.lookParts + 1), order: { look: { decision: "stop", z: 3.1 } } }).why.join()).toContain("stopped the run");
    expect(guard("b2-opus", { part: "b2-8", order: { look: { decision: "continue", z: 1 } } }).ok).toBe(true);
    expect(orderProblems("b2-p1", "b2-5-relaunch", { ...go, look: null })[0]).toContain("no look record");
  });
});

describe("dry run and reruns", () => {
  test("every item's temporary ledger opens and settles one lease and reads back done", () => {
    const lines = dryRun();
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain("b2-pilot: approval $65");
  });
  test("an infrastructure session reruns once; a graded one or a cap stop never does", () => {
    const first = [row("opus", "none", "t0", { outcome: "infra" }), row("opus", "line", "t0", { outcome: "cap_stop" }), row("opus", "gstack", "t0")];
    const r = infraRerun(first, [row("opus", "none", "t0", { outcome: "infra" })]);
    expect(r.rerun).toEqual(["t0\tnone"]);
    expect(r.missing).toEqual(["t0\tnone"]);
    expect(infraRerun(first).pending).toEqual(["t0\tnone"]);
    expect(() => infraRerun(first, [row("opus", "gstack", "t0")])).toThrow("owed no rerun");
  });
});
