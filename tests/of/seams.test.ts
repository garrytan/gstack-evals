// Value: protects=start rule 7's parser seams, which the lane dry run prints as PASS lines.
import { expect, test } from "bun:test";
import { seams } from "../../lanes/office-hours-founder/seams.ts";

test("every parser seam passes and names are unique", async () => {
  expect(new Set(seams.map((s) => s.name)).size).toBe(seams.length);
  for (const s of seams) expect({ name: s.name, ...(await s.run()) }).toMatchObject({ name: s.name, ok: true });
});
