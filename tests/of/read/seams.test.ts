// Value: protects=start rule 7's edges this area owns: every seam must PASS on both sides of its frozen rule, or the lane's dry run fails before any spend.
import { describe, expect, test } from "bun:test";
import { seams } from "../../../lanes/office-hours-founder/read/seams.ts";

describe("readings seams", () => {
  test("seam names are unique", () => {
    expect(new Set(seams.map((s) => s.name)).size).toBe(seams.length);
  });
  for (const s of seams)
    test(s.name, async () => {
      const r = await s.run();
      expect(r.detail).toBeString();
      expect(r.ok).toBe(true);
    });
});
