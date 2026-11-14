// Value: protects=the score area's dry-run seams (start rule 7): every frozen edge the area owns passes on both sides through the real code.
import { expect, test } from "bun:test";
import { seams } from "../../../lanes/office-hours-founder/score/seams.ts";

test("seam names are unique", () => {
  expect(new Set(seams.map((s) => s.name)).size).toBe(seams.length);
});

for (const s of seams)
  test(s.name, async () => {
    const r = await s.run();
    expect({ name: s.name, ok: r.ok, detail: r.detail }).toMatchObject({ ok: true });
  });
