// Copyright (c) 2026 Garry Tan. MIT License.
// The run area's unit tests: each dry-run case of the area as its own test, so a failure names its rule and case.
// The cases drive the real functions: the export and C2 on real git, the session classifier and loop on scripted
// attempts, the hooks on a fake RunBox, the detectors on their fixtures, the scope read and the arms.
import { describe, expect, test } from "bun:test";
import { cases } from "../../../lanes/design-constructed/run/dryrun-cases.ts";

describe("the run area's dry-run cases", () => {
  // Value: protects=every frozen run rule the area's dry run drives (S6, PD-6, R2-22, J1, S10, C1, R2-15, C2, C3, R2-6, R2-11, R2-14, D1); fails_when=any case returns a problem or throws; why_new=the design plan review lane's run area is new; seam=the area's exported functions; no_claim=the real SDK and the pinned gstack (sdk.test.ts and pinned.test.ts)
  const all = cases();
  test("names are unique and every case names a rule", () => {
    expect(new Set(all.map((c) => c.name)).size).toBe(all.length);
    expect(all.filter((c) => !c.rule).map((c) => c.name)).toEqual([]);
  });
  for (const c of all) test(c.rule + " " + c.name, async () => expect(await c.check()).toBeNull(), 60_000);
});
