// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import { analyse, bootstrap, cellsOf, mddText, report, valueOf, verdictOf, wilson, type Row } from "../../lanes/outcome-skills/pfchecks/analysis.ts";
import { blindFits, ceilingReading, contrastFloor, costReading, exposureReading, floorReading, infraReading, itemCap, midRunCheck, nRule, reprice } from "../../lanes/outcome-skills/pfchecks/admission.ts";
import { ITEMS, LINE, lineItemsMicros, OPUS, P1, PLANNING, SOL } from "../../lanes/outcome-skills/pfchecks/items.ts";

const rows = (): Row[] => {
  const out: Row[] = [];
  for (const model of [OPUS, SOL, P1]) for (let i = 0; i < 12; i++) for (const arm of ["P", "C", "N"] as const) {
    const score = arm === "P" ? (i < 9 ? 1 : 0) : arm === "C" ? (i < 4 ? 1 : 0) : i < 2 ? 1 : 0;
    out.push({ unit: "u" + i, repo: "r" + (i % 6), model, arm, stratum: i < 4 ? "july-2026" : "jan-jun-2026", score: score as 0 | 1, gap: null, no_static: score as 0 | 1, no_api_guess: score as 0 | 1, compile_rerun: score as 0 | 1, loaded: arm === "P", checker: arm !== "N" });
  }
  return out;
};
test("items sum to the line and the line holds the $1,960", () => {
  expect(lineItemsMicros() + LINE.crew_counted_micros).toBe(LINE.cap_micros);
  expect(ITEMS["pf-blind"]!.in_line).toBe(false);
});
test("Wilson, the bootstrap p and the verdict words", () => {
  const [lo, hi] = wilson(5, 10);
  expect(lo).toBeCloseTo(0.2366, 3);
  expect(hi).toBeCloseTo(0.7634, 3);
  const pairs = Array.from({ length: 30 }, (_, i) => ({ unit: "u" + i, repo: "r" + (i % 10), model: "m", a: 0, b: i < 20 ? 1 : 0 }));
  const b = bootstrap(pairs, 1);
  expect(b.delta).toBeCloseTo(20 / 30);
  expect(b.p).toBe(0);
  expect(bootstrap(pairs, 1)).toEqual(b);
  expect(verdictOf([0.1, 0.3], 0.01, false)).toBe("HELPS");
  expect(verdictOf([-0.3, -0.1], 0.01, false)).toBe("HURTS");
  expect(verdictOf([-0.1, 0.3], 0.01, false)).toBe("NO MEASURABLE DIFFERENCE");
  expect(verdictOf([0.1, 0.3], 0.01, true)).toBe("INCOMPLETE");
  expect(mddText(30, true)).toContain("16 to 27");
});
test("pooled and per-model analysis, gaps and the incomplete rule", () => {
  const a = analyse(rows(), 5);
  expect(a.pooled["P-N"].verdict).toBe("HELPS");
  expect(a.pooled["P-N"].n).toBe(36);
  expect(a.pooled["P-C"].p_holm).toBeGreaterThanOrEqual(a.pooled["P-C"].p);
  expect(a.per_model[OPUS]!["C-N"]!.verdict).toBeNull();
  expect(Object.keys(a.strata).sort()).toEqual(["jan-jun-2026", "july-2026"]);
  const g = rows().map((r) => (r.model === SOL && r.arm === "N" && ["u0", "u1"].includes(r.unit) ? { ...r, score: null, gap: "E_PF_FIX_CONFLICT", no_static: null, no_api_guess: null, compile_rerun: null } : r));
  expect(cellsOf(g).find((c) => c.model === SOL && c.arm === "N")).toMatchObject({ gaps: 2, incomplete: true });
  const ag = analyse(g, 5);
  expect(ag.pooled["P-N"].verdict).toBe("INCOMPLETE");
  expect(ag.pooled["P-N"].readings.worst_case!.n).toBe(36);
  expect(ag.pooled["P-N"].readings.conflict_as_miss!.n).toBe(36);
  expect(ag.pooled["P-N"].n).toBe(34);
});
test("tree-check refusals and wrap-up allowance gaps: counted per arm and model beside every verdict, and a refusal scored as a miss for its own arm", () => {
  const gap = (r: Row, code: string): Row => ({ ...r, score: null, gap: code, no_static: null, no_api_guess: null, compile_rerun: null });
  const g = rows().map((r) => (r.model === OPUS && r.arm === "P" && ["u0", "u1"].includes(r.unit) ? gap(r, "E_PF_ARM") : r.model === SOL && r.arm === "C" && r.unit === "u3" ? gap(r, "E_PF_WRAPUP_ALLOWANCE") : r.model === P1 && r.arm === "N" && r.unit === "u5" ? gap(r, "E_PF_FIX_CONFLICT") : r));
  expect(valueOf(g.find((r) => r.gap === "E_PF_ARM")!, "arm_refusal_as_miss")).toBe(0);
  expect(valueOf(g.find((r) => r.gap === "E_PF_WRAPUP_ALLOWANCE")!, "arm_refusal_as_miss")).toBeNull();
  expect(valueOf(g.find((r) => r.gap === "E_PF_FIX_CONFLICT")!, "arm_refusal_as_miss")).toBeNull();
  const a = analyse(g, 5);
  const pn = a.pooled["P-N"];
  expect(pn.n).toBe(33);
  expect(pn.readings.arm_refusal_as_miss!.n).toBe(35);
  expect(pn.readings.arm_refusal_as_miss!.delta).toBeCloseTo((pn.delta * 33 - 2) / 35);
  expect(pn.named_gaps).toEqual({ E_PF_ARM: { [OPUS]: { P: 2, N: 0 }, [P1]: { P: 0, N: 0 }, [SOL]: { P: 0, N: 0 } }, E_PF_WRAPUP_ALLOWANCE: { [OPUS]: { P: 0, N: 0 }, [P1]: { P: 0, N: 0 }, [SOL]: { P: 0, N: 0 } } });
  expect(a.pooled["P-C"].named_gaps.E_PF_WRAPUP_ALLOWANCE![SOL]).toEqual({ P: 0, C: 1 });
  expect(a.per_model[OPUS]!["P-N"]!.named_gaps).toEqual({ E_PF_ARM: { [OPUS]: { P: 2, N: 0 } }, E_PF_WRAPUP_ALLOWANCE: { [OPUS]: { P: 0, N: 0 } } });
  const lines = report(a);
  const verdicts = lines.map((l, i) => [l, i] as const).filter(([l]) => /^  (P minus|C minus|P-N|P-C|C-N)/.test(l));
  expect(verdicts.length).toBe(3 + 3 * 3);
  for (const [, i] of verdicts) {
    const block = lines.slice(i + 1, lines.findIndex((l, j) => j > i && !l.startsWith("    ")));
    expect(block.some((l) => l.startsWith("    E_PF_ARM gaps (tree-check refusals):"))).toBe(true);
    expect(block.some((l) => l.startsWith("    E_PF_WRAPUP_ALLOWANCE gaps (wrap-up refused for its allowance):"))).toBe(true);
    expect(block.some((l) => l.startsWith("    arm_refusal_as_miss:"))).toBe(true);
  }
  expect(lines.find((l) => l.startsWith("    E_PF_ARM gaps") && l.includes(OPUS + " P 2"))).toBeDefined();
});
test("admission readings", () => {
  expect(floorReading({ P: 1, C: 1, N: 0 }).reading).toBe("FLOOR");
  expect(floorReading({ P: 1, C: 1, N: 0 }, { P: 1, C: 0, N: 0 }).reading).toBe("STOP");
  expect(floorReading({ P: 2, C: 0, N: 0 }).reading).toBe("OK");
  expect(contrastFloor({ P: 1, C: 3, N: 0 })).toEqual({ "P-N": true, "P-C": false });
  expect(ceilingReading(7).reading).toBe("CEILING");
  expect(ceilingReading(7, { P: 3, C: 2, N: 6 }).issue).toBe("cut");
  expect(ceilingReading(7, { P: 3, C: 1, N: 5 })).toMatchObject({ issue: "full", ceiling_bound: true });
  const s = (loaded: boolean, checker: boolean, d: string | null = null) => ({ unit: "u", loaded, checker, harness_defect: d });
  expect(exposureReading([...Array(6)].map(() => s(true, true)).concat([s(true, false), s(true, false)])).reading).toBe("OK");
  expect(exposureReading([...Array(5)].map(() => s(true, true)).concat([s(true, false), s(true, false), s(true, false)])).reading).toBe("MODEL_CHOICE");
  expect(exposureReading([s(false, false, "plugin mount failed")]).reading).toBe("HARNESS_DEFECT");
  expect(infraReading([{ cell: "opus P", units: 8, gaps: 1 }]).reading).toBe("INFRA");
  expect(infraReading([{ cell: "opus P", units: 10, gaps: 1 }]).reading).toBe("OK");
  const c = costReading({ P: [1, 2, 7], C: [1], N: [1] });
  expect(c.arms[0]!.over).toBe(true);
  expect(c.allowance.P[SOL]).toBe(24);
  expect(c.allowance.N[OPUS]).toBe(6);
});
test("the re-price, the n rule, the mid-run check and the blind fit", () => {
  const plan = { [OPUS]: { P: [7], C: [7], N: [2] }, [SOL]: { P: [4.2], C: [4.2], N: [1.2] }, [P1]: {} };
  const p = reprice(plan);
  expect(p[OPUS]!.P).toBeCloseTo(8.4);
  expect(p[SOL]!.P).toBeCloseTo(6.3);
  expect(p[P1]).toEqual(PLANNING[P1]!);
  expect(itemCap(p[OPUS]!, 28)).toBe(580);
  const n = nRule(p, { supply: 50, spent_usd: 500, crew_held_usd: 250 });
  expect(n.left_usd).toBe(1210);
  expect(n.caps["pf-opus"]! + n.caps["pf-sol"]! + n.caps["pf-particle"]!).toBeLessThanOrEqual(1210);
  expect(nRule(p, { supply: 50, spent_usd: 500, crew_held_usd: 250 }).n).toBeGreaterThan(nRule(p, { supply: 50, spent_usd: 600, crew_held_usd: 250 }).n - 1);
  expect(nRule(p, { supply: 12, spent_usd: 0, crew_held_usd: 0 })).toMatchObject({ n: 12, captain: true });
  expect(midRunCheck(SOL, { cap_usd: 370, spent_usd: 200, done: 10, n: 28, measured: { P: [10], C: [10], N: [3] } }).stop).toBe(true);
  expect(blindFits(1840)).toBe(true);
  expect(blindFits(1841)).toBe(false);
});
