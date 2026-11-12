// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { ITEM_NAME } from "../../src/runner/ledger/record.ts";
import { loadRegistry } from "../../lanes/outcome-skills/arms/registry.ts";
import { smLimits } from "../../lanes/outcome-skills/statemachines/arms.ts";
import { ITEMS, LINES, itemsOf, lineSum } from "../../lanes/outcome-skills/statemachines/items.ts";

const M = 1_000_000;

describe("state machines ledger items", () => {
  test("every cap is pinned in micros, as sections 16 and 17 set them, with the /qa line's two recorded deviations", () => {
    expect(Object.fromEntries(Object.entries(ITEMS).map(([k, v]) => [k, v.cap_micros]))).toEqual({
      "sm-labels": 150 * M, "sm-oracle": 60 * M, "sm-admit": 270 * M, "sm-opus": 1400 * M, "sm-sol": 1460 * M, "sm-particle": 230 * M, "sm-judges": 180 * M,
      "sm-qa-admit": 55 * M, "sm-qa-opus": 440 * M, "sm-qa-sol": 440 * M, "sm-qa-particle": 51 * M,
    });
    expect(LINES["state-machines"]).toEqual({ cap_micros: 4000 * M, crew_counted_micros: 250 * M });
    expect(LINES["state-machines-qa"]).toEqual({ cap_micros: 1100 * M, crew_counted_micros: 60 * M });
  });

  test("each line's items sum inside the line, with crew use counted beside them", () => {
    expect(lineSum("state-machines")).toBe(3750 * M);
    expect(lineSum("state-machines-qa")).toBe(986 * M);
    for (const [line, l] of Object.entries(LINES)) expect(lineSum(line as keyof typeof LINES) + l.crew_counted_micros).toBeLessThanOrEqual(l.cap_micros);
    expect(lineSum("state-machines") + LINES["state-machines"].crew_counted_micros).toBe(4000 * M);
    expect(itemsOf("state-machines-qa").map((i) => i.item)).toEqual(["sm-qa-admit", "sm-qa-opus", "sm-qa-sol", "sm-qa-particle"]);
  });

  // Value: protects=the /qa line's caps against the Captain's formula (2026-11-10): an item opens a session only while its remaining cap covers the allowance, so n sessions at mean m with k concurrent need (n - k) * m + k * allowance within the cap; fails_when=a /qa item cannot finish its sessions one at a time at twice section 16's first-stage planning price (VMs included) with section 6's allowance doubled by E1; why_new=GST-1959 C1 (sm-qa-admit needed $54.64 against $50, sm-qa-particle $50.84 against $50); seam=items.ts ITEMS, registry.json sm.arms qa:told limits; no_claim=admission's measured prices, which replace the planning ones
  test("each /qa item's cap covers its sessions one at a time at twice the planning price, with E1's doubled allowance", () => {
    const reg = loadRegistry();
    const mean: Record<string, number> = { "claude-opus-5-5": 2 * (3.0 + 0.08), "openai/gpt-6.1-sol": 2 * (3.0 + 0.08), "particle-ai/particle-1": 2 * (0.3 + 0.08) };
    const sessions: Record<string, number> = { "sm-qa-admit": 5, "sm-qa-opus": 60, "sm-qa-sol": 60, "sm-qa-particle": 60 };
    const k = 1;
    const need = Object.fromEntries(itemsOf("state-machines-qa").map((it) => [it.item, Math.round(((sessions[it.item]! - k) * mean[it.model!]! + k * 2 * smLimits(reg, "qa:told", it.model!).session_cap_usd) * M)]));
    expect(need).toEqual({ "sm-qa-admit": 54_640_000, "sm-qa-opus": 393_440_000, "sm-qa-sol": 393_440_000, "sm-qa-particle": 50_840_000 });
    expect(itemsOf("state-machines-qa").filter((it) => need[it.item]! > it.cap_micros).map((it) => it.item)).toEqual([]);
  });

  test("items fit what the driver's stage reads: a valid name, the line as program, the skill the arm spends for", () => {
    for (const [name, it] of Object.entries(ITEMS)) {
      expect(ITEM_NAME.test(name)).toBe(true);
      expect(ITEM_NAME.test(it.program)).toBe(true);
      expect(it.skills).toEqual(it.program === "state-machines-qa" ? ["qa"] : ["sm"]);
      expect(Number.isSafeInteger(it.cap_micros) && it.cap_micros > 0).toBe(true);
    }
    expect(ITEMS["sm-opus"]!.model).toBe("claude-opus-5-5");
    expect(ITEMS["sm-qa-sol"]!.model).toBe("openai/gpt-6.1-sol");
    expect(ITEMS["sm-particle"]!.model).toBe("particle-ai/particle-1");
    expect(ITEMS["sm-labels"]!.model).toBeNull();
  });
});
