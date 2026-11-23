// Copyright (c) 2026 Garry Tan. MIT License.
// B2's pre-run change 3 (lanes/test-first/pins.ts GUARD_RATES_USD, plans.ts pilotRows): the launch guard projects Sol at 1.25
// times both Sol pilots' cost per session, the cap rule and the caps are unchanged, and a counted item's all-in counts every
// pilot run's ledger.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger, readRows, toMicros } from "../../quick/laneb/runner/ledger.ts";
import { approve, capOf, itemTotals, launchGuard, markDone } from "../../lanes/test-first/money.ts";
import { pilotRows } from "../../lanes/test-first/plans.ts";
import { CAPS_USD, CHANGE_3, GUARD_RATES_USD, PREREG_CAPS_USD, RATES_USD, REPO, SOL_GUARD_RATE_USD, SOL_PILOTS } from "../../lanes/test-first/pins.ts";

const dir = mkdtempSync(join(tmpdir(), "b2-change-3-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const spend = (path: string, usd: number, done = true) => {
  approve(path, "b2-pilot", CAPS_USD["b2-pilot"], "test");
  const l = new Ledger(path, "b2-pilot");
  l.reserve("s1", toMicros(usd)); l.settle("s1", toMicros(usd));
  if (done) markDone(path, "b2-pilot");
};

describe("pre-run change 3", () => {
  test("Sol's guard rate is 1.25 times both Sol pilots' cost per session, rounded up to the cent; the other rates are the plan's", () => {
    expect(SOL_PILOTS.usd / SOL_PILOTS.sessions).toBeCloseTo(0.1663, 4);
    expect(SOL_GUARD_RATE_USD).toBe(0.21);
    for (const a of ["none", "line", "gstack", "prove-it"] as const) expect(GUARD_RATES_USD.sol[a]).toBe(0.21);
    expect(GUARD_RATES_USD.opus).toEqual(RATES_USD.opus);
    expect(GUARD_RATES_USD.p1).toEqual(RATES_USD.p1);
  });
  test("the cap rule still runs at the plan's rates and the caps do not change", () => {
    expect(capOf("b2-sol").cap).toBe(PREREG_CAPS_USD["b2-sol"]);
    expect(CAPS_USD).toEqual({ "b2-pilot": 65, "b2-opus": 715, "b2-sol": 355, "b2-p1": 230 });
    const post = readFileSync(join(REPO, CHANGE_3), "utf8");
    expect(post).toContain("$" + SOL_GUARD_RATE_USD.toFixed(2) + " a session");
    expect(post).toContain("No cap changes");
  });
  test("a counted item's all-in counts the first pilot ledger and every later pilot run's ledger", () => {
    const d = join(dir, "ledgers");
    mkdirSync(d);
    expect(pilotRows(d)).toEqual([]);
    spend(join(d, "b2-pilot.jsonl"), 13.62);
    spend(join(d, "b2-pilot.repilot-1.jsonl"), 2.1);
    const t = itemTotals(pilotRows(d), "b2-pilot");
    expect([t.settled, t.open, t.done]).toEqual([toMicros(15.72), 0, true]);
    const go = { pilotDone: t.done, images: { ok: true, why: "" }, look: null };
    const g = launchGuard("b2-opus", { "b2-pilot": pilotRows(d) }, {}, { usd: 0, as_of: "2026-11-21T12:00Z" }, go, "b2-1");
    const without = launchGuard("b2-opus", { "b2-pilot": readRows(join(d, "b2-pilot.jsonl")) }, {}, { usd: 0, as_of: "2026-11-21T12:00Z" }, go, "b2-1");
    const allIn = (l: string[]) => Number(l.join().match(/all-in \$([\d,.]+) of/)![1]!.replace(/,/g, ""));
    expect(allIn(g.lines) - allIn(without.lines)).toBeCloseTo(2.1, 6);
  });
  test("a later pilot ledger that is not done is refused rather than counted short", () => {
    const d = join(dir, "open");
    mkdirSync(d);
    spend(join(d, "b2-pilot.jsonl"), 13.62);
    spend(join(d, "b2-pilot.repilot-1.jsonl"), 2.1, false);
    expect(() => pilotRows(d)).toThrow("not done");
  });
});
