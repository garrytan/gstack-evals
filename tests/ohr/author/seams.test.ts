// Value: protects=the authoring area's dry-run seams: every seam passes on the build, and each frozen rule is driven on both sides.
import { expect, test } from "bun:test";
import { seams } from "../../../lanes/office-hours-rewrite/author/seams.ts";

test("every authoring seam passes", async () => {
  const failed: string[] = [];
  for (const s of seams) {
    const r = await s.run();
    if (!r.ok) failed.push(s.name + ": " + r.detail);
  }
  expect(failed).toEqual([]);
});

test("seam names are unique and the rules have both sides", () => {
  expect(new Set(seams.map((s) => s.name)).size).toBe(seams.length);
  for (const rule of ["unanimous key", "give-away screen", "blind audit", "recognition probe", "generic screen", "one rewrite", "twins", "pilot line", "pilot, driven", "reserves", "custody", "vocabulary screen", "builder goal fact"]) {
    expect(seams.filter((s) => s.name.startsWith(rule + ":")).length).toBeGreaterThanOrEqual(2);
  }
});
