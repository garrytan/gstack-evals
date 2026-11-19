// Copyright (c) 2026 Garry Tan. MIT License.
// The item gate (section 12): admission with attempts in flight, the journal a resume reads, the kinds' re-projection,
// the published state the all-in projection reads, and runGated's first-error rule.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allInProjection, ITEMS, ItemGate, planProjection, runGated, type ItemPlan } from "../../../lanes/eng-planted/stages/ledger.ts";
import { codeOf } from "../../../lanes/eng-planted/stages/cases.ts";

const plan: ItemPlan = { item: "ep-stock", row: "fixture", projectionUsd: 100, capUsd: 60, kinds: { build: { planned: 20, usd: 2 } } };

describe("ItemGate", () => {
  test("an attempt starts only when settled spend, $16 per attempt in flight and its own allowance fit the cap", async () => {
    const g = new ItemGate(plan);
    await g.acquire("build");
    g.settle("build", 2);
    await g.acquire("build");
    await g.acquire("build");
    expect(g.inFlight()).toBe(2);
    expect(g.admit("build")).toBe("go");
    await g.acquire("build");
    expect(g.admit("build")).toBe("wait");
    g.abort();
    expect(g.admit("build")).toBe("go");
  });

  test("with nothing in flight and no room, the item stops with E_EP_REPROJECT", async () => {
    const g = new ItemGate({ ...plan, kinds: { build: { planned: 3, usd: 2 } } });
    for (const c of [2, 20, 25]) {
      await g.acquire("build");
      g.settle("build", c);
    }
    expect(await codeOf(() => g.admit("build"))).toBe("E_EP_REPROJECT");
    expect(await codeOf(() => g.admit("build"))).toBe("E_EP_REPROJECT");
  });

  test("a resume reads the settled sessions back from the journal and appends new ones", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ep-gate-"));
    const journal = join(dir, "costs", "ep-stock.jsonl");
    const a = new ItemGate(plan, { journal });
    await a.acquire("build");
    a.settle("build", 3, "u1_stock_-_1");
    const b = new ItemGate(plan, { journal });
    expect(b.sessions()).toBe(1);
    expect(b.settled()).toBe(3);
    expect(b.reprojection()).toBe(3 + 19 * 3);
    expect(readFileSync(journal, "utf8").trim().split("\n").map((l) => JSON.parse(l).cell)).toEqual(["u1_stock_-_1"]);
  });

  test("planned overrides the plan's counts, refuses a kind the item does not plan, and a cap above the plan", async () => {
    expect(new ItemGate(plan, { planned: { build: 10 } }).reprojection()).toBe(20);
    expect(await codeOf(() => new ItemGate(plan, { planned: { call: 1 } }))).toBe("E_USAGE");
    expect(await codeOf(() => new ItemGate(plan, { capUsd: 61 }))).toBe("E_USAGE");
    expect(await codeOf(() => new ItemGate(plan).admit("call"))).toBe("E_USAGE");
  });

  test("the published state feeds the all-in projection: plan projection before start, re-projection open, settled when finished", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ep-allin-"));
    const allIn = { stateDir: dir, crewUsd: 450, hostsUsd: 90 };
    const before = allInProjection(allIn).usd;
    expect(before).toBe(ITEMS.reduce((s, i) => s + i.projectionUsd, 0) + 540);
    const stock = ITEMS.find((i) => i.item === "ep-stock")!;
    const g = new ItemGate(stock, { allIn });
    await g.acquire("build");
    g.settle("build", 2);
    expect(allInProjection(allIn).usd).toBeCloseTo(before - stock.projectionUsd + 2 + 63 * 2, 6);
    g.finish();
    expect(allInProjection(allIn).usd).toBeCloseTo(before - stock.projectionUsd + 2, 6);
    expect(planProjection(stock)).toBe(160);
  });
});

describe("runGated", () => {
  test("a run that throws after its session spent settles that spend under its key and rethrows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ep-spent-"));
    const journal = join(dir, "costs", "ep-stock.jsonl");
    const g = new ItemGate(plan, { journal });
    const e = await codeOf(() => runGated([1], { gate: g, kind: () => "build", key: (c) => "c" + c, run: async () => { throw Object.assign(new Error("noVerdict"), { spentUsd: 5 }); } }));
    expect(e).toBe("error: noVerdict");
    expect([g.settled(), g.sessions(), g.inFlight()]).toEqual([5, 1, 0]);
    expect(readFileSync(journal, "utf8").trim().split("\n").map((l) => JSON.parse(l))).toEqual([{ kind: "build", usd: 5, cell: "c1" }]);
  });

  test("a run that throws with nothing spent settles nothing and frees its slot", async () => {
    const g = new ItemGate(plan);
    expect(await codeOf(() => runGated([1], { gate: g, kind: () => "build", key: (c) => "c" + c, run: async () => { throw new Error("before any session"); } }))).toBe("error: before any session");
    expect([g.settled(), g.sessions(), g.inFlight()]).toEqual([0, 0, 0]);
  });

  test("the first error stops new starts; running cells settle and commit; skip leaves a cell out", async () => {
    const g = new ItemGate(plan);
    const ran: number[] = [];
    const committed: number[] = [];
    const e = await codeOf(() =>
      runGated([1, 2, 3, 4, 5], {
        gate: g,
        parallel: 1,
        kind: () => "build",
        key: (c) => "c" + c,
        skip: (c) => c === 2,
        run: async (c) => {
          ran.push(c);
          if (c === 4) throw Object.assign(new Error("infra"), { code: "E_USAGE" });
          return { costUsd: 1, commit: () => void committed.push(c) };
        },
      }),
    );
    expect(e).toBe("E_USAGE");
    expect(ran).toEqual([1, 3, 4]);
    expect(committed).toEqual([1, 3]);
    expect(g.sessions()).toBe(2);
    expect(g.inFlight()).toBe(0);
  });

  test("a session whose settle stops the item still writes its record", async () => {
    const g = new ItemGate({ ...plan, kinds: { build: { planned: 20, usd: 2 } } });
    const committed: number[] = [];
    const e = await codeOf(() => runGated([1, 2], { gate: g, kind: () => "build", key: (c) => "c" + c, run: async (c) => ({ costUsd: 30, commit: () => void committed.push(c) }) }));
    expect(e).toBe("E_EP_REPROJECT");
    expect(committed).toEqual([1]);
  });
});
