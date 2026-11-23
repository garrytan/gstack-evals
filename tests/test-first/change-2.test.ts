// Copyright (c) 2026 Garry Tan. MIT License.
// B2's pre-run change 2 (lanes/test-first/plans.ts): the Sol re-pilot prepares b2-pilot's Sol part alone, and its launch
// guard adds the first pilot run's settled spend so both runs stay inside b2-pilot's one cap.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger, readRows } from "../../quick/laneb/runner/ledger.ts";
import { approve, itemTotals, markDone } from "../../lanes/test-first/money.ts";
import { itemPlan, pilotModels, withCarry } from "../../lanes/test-first/plans.ts";
import { CAPS_USD, drawnTasks } from "../../lanes/test-first/pins.ts";

const dir = mkdtempSync(join(tmpdir(), "b2-change-2-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the Sol re-pilot", () => {
  test("B2_PILOT_MODELS picks the pilot's parts; unset, every model's", () => {
    expect(pilotModels(undefined)).toEqual(["opus", "sol", "p1"]);
    expect(pilotModels("sol")).toEqual(["sol"]);
    expect(() => pilotModels("sol,gpt")).toThrow("E_USAGE");
    expect(() => pilotModels("sol,sol")).toThrow("E_USAGE");
    const d = drawnTasks(), before = process.env.B2_PILOT_MODELS;
    process.env.B2_PILOT_MODELS = "sol";
    try { expect(itemPlan("b2-pilot", d.run, d.pilot).parts.map((p) => [p.name, p.model])).toEqual([["pilot-sol", "gpt-6.2-sol"]]); }
    finally { if (before === undefined) delete process.env.B2_PILOT_MODELS; else process.env.B2_PILOT_MODELS = before; }
    expect(itemPlan("b2-pilot", d.run, d.pilot).parts.length).toBe(3);
  });
  test("the re-pilot's guard reads its own ledger with the first run's settled spend under b2-pilot's one cap", () => {
    const first = join(dir, "first.jsonl"), next = join(dir, "next.jsonl");
    approve(first, "b2-pilot", CAPS_USD["b2-pilot"], "test");
    const l = new Ledger(first, "b2-pilot");
    l.reserve("s1", 20_000_000); l.settle("s1", 13_624_968);
    approve(next, "b2-pilot", CAPS_USD["b2-pilot"], "test");
    expect(() => withCarry(readRows(next), readRows(first))).toThrow("not done");
    markDone(first, "b2-pilot");
    const t = itemTotals(withCarry(readRows(next), readRows(first)), "b2-pilot");
    expect([t.cap, t.settled, t.open, t.done]).toEqual([65_000_000, 13_624_968, 0, false]);
    expect(readRows(next).length).toBe(1);
  });
});
