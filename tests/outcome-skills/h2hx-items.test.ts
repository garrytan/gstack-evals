// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { extItems, extLedgerDryRun, mayOpenPilot, pilotSessions, pilotState } from "../../lanes/outcome-skills/h2h/ext/items.ts";
import { EXT_ARMS, readExtPrereg } from "../../lanes/outcome-skills/h2h/ext/prereg.ts";

const x = readExtPrereg();

describe("h2hx ledger items and the pilot cap rule", () => {
  test("the items are prereg.json's, each with its central, cap and model", () => {
    const items = extItems(x);
    expect(items.map((i) => i.item)).toEqual(["h2hx-s-pilot", "h2hx-s-main", "h2hx-p-pilot", "h2hx-p-main", "h2hx-l-pilot", "h2hx-l-main", "h2hx-vms", "h2hx-crew"]);
    expect(items.find((i) => i.item === "h2hx-s-main")).toMatchObject({ central_usd: 770, cap_usd: 1130, model: "gpt-6.2-sol", part: "S" });
    expect(items.find((i) => i.item === "h2hx-p-pilot")).toMatchObject({ model: "particle-ai/particle-1", part: "P" });
    expect(items.find((i) => i.item === "h2hx-vms")).toMatchObject({ model: null, part: null });
  });

  test("the dry run opens and settles one lease per item on a temporary ledger, and every check passes", () => {
    const r = extLedgerDryRun({ x });
    const leases = r.checks.filter((c) => c.name.startsWith("ledger lease "));
    expect(leases).toHaveLength(x.items.length);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
  });

  test("a cap override past the approved total fails the dry run's total check", () => {
    const r = extLedgerDryRun({ x, caps: { "h2hx-crew": 700 } });
    expect(r.checks.find((c) => c.name === "caps fit the approved all-in total")!.ok).toBe(false);
  });

  test("pilot sessions per arm: 10 in parts S and P, 6 for an O-only arm and in part L", () => {
    expect(pilotSessions("s-gstack", x)).toBe(10);
    expect(pilotSessions("s-gstack-line", x)).toBe(6);
    expect(pilotSessions("p-gstack-oneline", x)).toBe(6);
    expect(pilotSessions("l-gstack-md", x)).toBe(6);
  });

  test("a pilot session opens only while settled spend is under the arm's cap; reaching it first leaves the arm out", () => {
    for (const arm of EXT_ARMS) {
      const cap = x.pilot_caps_usd[arm];
      expect(mayOpenPilot(arm, 0, 0, x)).toBe(true);
      expect(mayOpenPilot(arm, cap - 0.01, 1, x)).toBe(true);
      expect(pilotState(arm, cap, 1, x)).toBe("left_out");
      expect(pilotState(arm, cap + 3, 2, x)).toBe("left_out");
      expect(pilotState(arm, cap + 3, pilotSessions(arm, x), x)).toBe("done");
    }
    expect(() => pilotState("s-pstack" as never, 0, 0, x)).toThrow(/^E_H2HX_INPUT /);
    expect(() => pilotState("s-none", -1, 0, x)).toThrow(/^E_H2HX_INPUT /);
  });
});
