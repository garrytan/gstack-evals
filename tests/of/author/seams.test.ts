// Value: protects=the authoring area's start rule 7 seams, so the lane's dry run drives every authoring edge through real code.
import { describe, expect, test } from "bun:test";
import { seams } from "../../../lanes/office-hours-founder/author/seams.ts";

describe("authoring seams", () => {
  for (const s of seams)
    test(s.name, async () => {
      const r = await s.run();
      if (!r.ok) console.log(s.name + ": " + r.detail);
      expect(r.ok).toBe(true);
    });
});
