import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { loadCatalog } from "../../lanes/review-replay/catalog/catalog.ts";
import { blockerCount, checkSuite, loadSuite, resolveUnit, suiteFromCatalog, unitRef, type Suite } from "../../lanes/review-noloss/suite.ts";
import { REPO_ROOT } from "../../src/cli.ts";
import { join } from "node:path";

const { suite } = loadSuite("gsta167-14pr");

describe("the GSTA-167 no-loss suite", () => {
  test("27 new cases load with confirmed audits, and the suite checks clean", () => {
    const loaded = loadCatalog(join(REPO_ROOT, "lanes/review-replay/catalog/noloss"));
    expect(loaded.problems).toEqual([]);
    expect(loaded.cases.length).toBe(27);
    for (const c of loaded.cases) {
      expect(c.answer_key_audit?.verdict).toBe("confirmed");
      expect(c.repo).toBe("garrytan/gstack");
      expect(c.decoys.every((d) => d.audit === null)).toBe(true);
    }
    expect(checkSuite(suite)).toEqual([]);
  });

  test("29 blockers, not 30, in the prereg's per-PR counts; two reuse mined cases", () => {
    expect(blockerCount(suite)).toBe(29);
    expect(suite.units.map((u) => [u.pr, u.blockers.length])).toEqual([[3593, 2], [3596, 2], [3516, 2], [3524, 1], [3526, 4], [3527, 4], [3534, 4], [3540, 1], [3545, 1], [3564, 1], [3567, 3], [3573, 1], [3578, 1], [3583, 2]]);
    const cases = suite.units.flatMap((u) => u.blockers.map((b) => b.case));
    expect(cases).toContain("gstack-3540-review-0e2e1121");
    expect(cases).toContain("gstack-3572-review-4ad8a6bf");
    expect(new Set(suite.units.map((u) => u.cluster)).size).toBe(14);
    expect(suite.units.filter((u) => u.group === "a").map((u) => u.pr)).toEqual([3593, 3596]);
  });

  test("freeze digests are checked on byte prefixes", () => {
    const fake = Buffer.alloc(30000, 120);
    const problems = checkSuite(suite, { prereg: fake });
    expect(problems.filter((p) => p.startsWith("prereg freeze")).length).toBe(3);
    const s: Suite = { ...suite, prereg_freezes: [{ round: "x", bytes: 10, sha256: createHash("sha256").update(fake.subarray(0, 10)).digest("hex") }] };
    expect(checkSuite(s, { prereg: fake })).toEqual([]);
  });
});

describe("unit refs and catalog suites", () => {
  const combined = suiteFromCatalog({ id: "combined", catalogs: ["lanes/review-replay/catalog/public"], released: "2026-01-01", base: suite });

  test("the 44 mined cases: 14 blocking, 6 over-blocking, 24 detection-only, and --released is required", () => {
    const cat = suiteFromCatalog({ id: "catalog-public", catalogs: ["lanes/review-replay/catalog/public"], released: "2026-01-01" });
    expect([blockerCount(cat, "blocking"), blockerCount(cat, "over-blocking"), blockerCount(cat, "detection")]).toEqual([14, 6, 24]);
    expect(checkSuite(cat)).toEqual([]);
    expect(() => suiteFromCatalog({ id: "x", catalogs: ["lanes/review-replay/catalog/public"], released: null })).toThrow(/--released/);
    const late = suiteFromCatalog({ id: "late", catalogs: ["lanes/review-replay/catalog/public"], released: "2026-12-31" });
    expect(late.units.length).toBe(0);
    expect(late.ineligible.length).toBe(44);
  });

  test("combined with the 29: 42 blocking blockers in 27 units and 26 clusters; the 3572 case is not counted twice", () => {
    expect(blockerCount(combined, "blocking")).toBe(42);
    expect(combined.units.filter((u) => u.blockers.some((b) => b.counts === "blocking")).length).toBe(27);
    expect(new Set(combined.units.filter((u) => u.blockers.some((b) => b.counts === "blocking")).map((u) => u.cluster)).size).toBe(26);
    expect(combined.units.flatMap((u) => u.blockers).filter((b) => b.case === "gstack-3572-review-4ad8a6bf").length).toBe(1);
  });

  test("two #3516 heads need a head in the ref, and repos keep same-numbered PRs apart", () => {
    expect(resolveUnit(combined, "3516").problem).toMatch(/names 2 units/);
    const u = resolveUnit(combined, "3516@ee73419c").unit!;
    expect(u.head.startsWith("ee73419c")).toBe(true);
    expect(unitRef(combined, u)).toBe("3516@ee73419c3295");
    expect(resolveUnit(combined, "garrytan__gstack#3516@3712b797").unit?.head.startsWith("3712b797")).toBe(true);
    const twin: Suite = { ...suite, units: [suite.units[0]!, { ...suite.units[0]!, repo: "garrytan/gbrain", id: "garrytan/gbrain#3593@" + suite.units[0]!.head.slice(0, 12), cluster: "garrytan/gbrain#3593" }] };
    expect(resolveUnit(twin, "3593").problem).toMatch(/names 2 units/);
    expect(resolveUnit(twin, "garrytan/gbrain#3593").unit?.repo).toBe("garrytan/gbrain");
    expect(resolveUnit(suite, "35x").problem).toMatch(/not a unit ref/);
  });
});
