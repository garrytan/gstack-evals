// Copyright (c) 2026 Garry Tan. MIT License.
// The score area's dry-run seams (prereg section 12 stage 1): every seam passes, and every frozen rule is driven on both
// sides of its edge.
import { describe, expect, test } from "bun:test";
import { seams } from "../../../lanes/office-hours-rewrite/score/seams.ts";

describe("score seams", () => {
  test("names are unique and every rule has a holding side and a breaking side", () => {
    expect(new Set(seams.map((s) => s.name)).size).toBe(seams.length);
    const sides = new Map<string, Set<string>>();
    for (const s of seams) {
      const m = /^score: (.+) \| (holds|breaks): .+$/.exec(s.name);
      expect(m).not.toBeNull();
      sides.set(m![1]!, (sides.get(m![1]!) ?? new Set()).add(m![2]!));
    }
    for (const [rule, s] of sides) expect([rule, [...s].sort()]).toEqual([rule, ["breaks", "holds"]]);
    expect(sides.size).toBeGreaterThanOrEqual(25);
  });
  for (const s of seams)
    test(s.name, async () => {
      const r = await s.run();
      expect(r.detail).toBeTruthy();
      expect(r).toMatchObject({ ok: true });
    });
});
