// Copyright (c) 2026 Garry Tan. MIT License.
// The money area: every dry-run case as its own test, plus unit checks on the write-ahead chain, the stop table, the
// controller's guards and the items listing.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STOP_SCOPES } from "../../../lanes/design-constructed/frozen.ts";
import { MoneyController } from "../../../lanes/design-constructed/money/book.ts";
import { itemsLines } from "../../../lanes/design-constructed/money/cli.ts";
import { cases } from "../../../lanes/design-constructed/money/dryrun-cases.ts";
import { withRig } from "../../../lanes/design-constructed/money/dryrun-fixture.ts";
import { DirTarget } from "../../../lanes/design-constructed/money/durability.ts";
import { callWorstCase, outputCap, worstCaseMicros } from "../../../lanes/design-constructed/money/price.ts";
import { stopPlan } from "../../../lanes/design-constructed/money/stops.ts";
import { chainAfter, GENESIS, WriteAhead } from "../../../lanes/design-constructed/money/wal.ts";
import type { DcStopCode } from "../../../lanes/design-constructed/types.ts";

describe("money dry-run cases", () => {
  for (const c of cases()) {
    test(c.rule + " " + c.name, async () => {
      expect(await c.check()).toBeNull();
    });
  }
});

describe("write-ahead chain", () => {
  const lines = async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-wal-"));
    const t = new DirTarget(dir);
    const w = new WriteAhead(t);
    for (let i = 0; i < 4; i++) await w.append({ kind: "admit", i });
    const out = await t.lines();
    rmSync(dir, { recursive: true, force: true });
    return out;
  };

  test("an unbroken chain reads whole, and from a watermark", async () => {
    const l = await lines();
    const all = chainAfter(l, 0, GENESIS);
    expect("lines" in all && all.lines.length).toBe(4);
    const second = JSON.parse(l[1]!);
    const after = chainAfter(l, 2, second.hash);
    expect("lines" in after && after.lines.map((x) => x.seq)).toEqual([3, 4]);
  });

  test("a gap, a fork, a tampered line and a wrong head are each refused", async () => {
    const l = await lines();
    expect(chainAfter([l[0]!, l[2]!, l[3]!], 0, GENESIS)).toHaveProperty("broken");
    const forked = JSON.parse(l[2]!);
    forked.entry = { kind: "admit", i: 99 };
    expect(chainAfter([...l, JSON.stringify(forked)], 0, GENESIS)).toHaveProperty("broken");
    expect(chainAfter([l[0]!, l[1]!.replace('"i":1', '"i":7'), l[2]!, l[3]!], 0, GENESIS)).toHaveProperty("broken");
    expect(chainAfter(l, 0, "f".repeat(64))).toHaveProperty("broken");
  });

  test("after one unacknowledged append the log refuses every later line until it restarts", async () => {
    let fail = true;
    const dir = mkdtempSync(join(tmpdir(), "dc-wal-"));
    const t = new DirTarget(dir);
    const flaky = { ...t, lines: () => t.lines(), putSnapshot: t.putSnapshot.bind(t), getSnapshot: t.getSnapshot.bind(t), latestSnapshot: t.latestSnapshot.bind(t), append: async (line: string) => (fail ? Promise.reject(new Error("down")) : t.append(line)) };
    const w = new WriteAhead(flaky);
    await expect(w.append({ kind: "admit" })).rejects.toThrow("not acknowledged");
    fail = false;
    await expect(w.append({ kind: "admit" })).rejects.toThrow("broken");
    w.restart(w.seq, w.head);
    await w.append({ kind: "admit" });
    expect((await t.lines()).length).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("stop table (L5, PD-13)", () => {
  test("every frozen stop code has a plan with the frozen reach", () => {
    for (const code of Object.keys(STOP_SCOPES) as DcStopCode[]) {
      const p = stopPlan(code, { model: "opus", arm: "autoplan", stage: 2 });
      expect(p.reach).toBe(STOP_SCOPES[code].stops);
      expect(p.scopes.every((s) => s.captain)).toBe(true);
      expect(p.capStop).toBe(false);
    }
  });

  test("a cap stop names its item, and only dc-hosts' reaches every stage", () => {
    expect(() => stopPlan("CAP_STOP")).toThrow();
    expect(stopPlan("CAP_STOP", { item: "dc-judges" }).settle).toEqual(["dc-judges"]);
    expect(stopPlan("CAP_STOP", { item: "dc-hosts" }).reach).toBe("every-stage");
  });
});

describe("controller guards", () => {
  test("the holder directory is absolute, crew has no lease, and a round holds 1 to perRound sessions", async () => {
    expect(() => new MoneyController({ runId: "r", holder: "relative/dir", leases: null as never })).toThrow("absolute");
    const why = await withRig({}, async (r) => {
      await expect(r.c.openItem("crew")).rejects.toThrow("no lease");
      await r.c.openItem("dc-stage2-sol");
      expect(() => r.c.admitRound("dc-stage2-sol", { run: "x", model: "sol", arms: ["a", "b", "c", "d", "e"] })).toThrow();
      expect(() => r.c.admitCall("dc-stage2-sol", { run: "x", model: "sol", worstCaseMicros: 1 })).toThrow("not direct");
      return null;
    });
    expect(why).toBeNull();
  });

  test("output caps are the plan's, doubled on a resend, and a call with no stated cap is refused", () => {
    expect(outputCap("author")).toBe(24_000);
    expect(outputCap("productionLabels", true)).toBe(32_000);
    expect(callWorstCase("astra", "hi", 1000)).toBeGreaterThan(1000 * 50);
    expect(() => worstCaseMicros("anthropic", { model: "claude-opus-5-5", messages: [{ role: "user", content: "hi" }] })).toThrow("states its output cap");
  });
});

test("dc items lists the 17 items and the envelope", () => {
  const lines = itemsLines();
  expect(lines.length).toBe(18);
  expect(lines.some((l) => l.startsWith("dc-base-apps") && l.includes("$5.00 allowance"))).toBe(true);
  expect(lines.at(-1)).toContain("$3999");
});
