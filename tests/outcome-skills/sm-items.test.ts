// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { ITEM_NAME } from "../../src/runner/ledger/record.ts";
import { ITEMS, LINES, itemsOf, lineSum } from "../../lanes/outcome-skills/statemachines/items.ts";

const M = 1_000_000;

describe("state machines ledger items", () => {
  test("every cap is pinned in micros, as sections 16 and 17 set them", () => {
    expect(Object.fromEntries(Object.entries(ITEMS).map(([k, v]) => [k, v.cap_micros]))).toEqual({
      "sm-labels": 150 * M, "sm-oracle": 60 * M, "sm-admit": 270 * M, "sm-opus": 1400 * M, "sm-sol": 1460 * M, "sm-particle": 230 * M, "sm-judges": 180 * M,
      "sm-qa-admit": 50 * M, "sm-qa-opus": 440 * M, "sm-qa-sol": 440 * M, "sm-qa-particle": 50 * M,
    });
    expect(LINES["state-machines"]).toEqual({ cap_micros: 4000 * M, crew_counted_micros: 250 * M });
    expect(LINES["state-machines-qa"]).toEqual({ cap_micros: 1100 * M, crew_counted_micros: 60 * M });
  });

  test("each line's items sum inside the line, with crew use counted beside them", () => {
    expect(lineSum("state-machines")).toBe(3750 * M);
    expect(lineSum("state-machines-qa")).toBe(980 * M);
    for (const [line, l] of Object.entries(LINES)) expect(lineSum(line as keyof typeof LINES) + l.crew_counted_micros).toBeLessThanOrEqual(l.cap_micros);
    expect(lineSum("state-machines") + LINES["state-machines"].crew_counted_micros).toBe(4000 * M);
    expect(itemsOf("state-machines-qa").map((i) => i.item)).toEqual(["sm-qa-admit", "sm-qa-opus", "sm-qa-sol", "sm-qa-particle"]);
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
