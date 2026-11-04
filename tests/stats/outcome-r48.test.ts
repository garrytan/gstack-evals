import { describe, expect, test } from "bun:test";
import type { CostGuard } from "../../src/runner/stats/outcome-cost.ts";
import type { Contrast, ContrastReading, Futility, Verdict } from "../../src/runner/stats/outcome-decision.ts";
import { EXPOSURE_BAR, r48, R48_PATHS, renderR48, type R48Input } from "../../src/runner/stats/outcome-r48.ts";

const reading = (delta: number, ci95: [number, number], share = 0.5): ContrastReading => ({ cluster: "repo", tasks: 60, clusters: 20, control_mean: share, treatment_mean: share + delta, delta, se: 0.05, z: delta / 0.05, ci95, p_greater: 0.5, p_less: 0.5, p_two_sided: 1, control_share: share, verdict: "not_distinguished", note: null });
const contrastOf = (verdict: Verdict, delta: number, ci95: [number, number], share = 0.5): Contrast => ({ arms: { control: "none", treatment: "told" }, verdict, note: null, with_truncated: reading(delta, ci95, share), without_truncated: null, task_clustered: null, truncation: { guard: 0.05, control: 0, treatment: 0, tripped: false }, dropped: [] });
const costOf = (lo: number, hi: number, m = 2.2): CostGuard => ({ tasks: 60, control: { trials: 180, solved: 90, cost_usd: 180, per_solved_usd: 2, mean_session_usd: 1 }, treatment: { trials: 180, solved: 100, cost_usd: 180 * m, per_solved_usd: 1.8 * m, mean_session_usd: m }, ratio: (lo + hi) / 2, ci95: [lo, hi], holds: hi <= 1.5, reason: "", session_multiple: m });
const input = (verdict: Verdict, o: Partial<Omit<R48Input, "cost">> & { delta?: number; ci?: [number, number]; cost?: [number, number]; m?: number } = {}): R48Input => {
  const { delta, ci, cost, m, ...rest } = o;
  return { skill: "plan-eng-review", contrast: contrastOf(verdict, delta ?? 0.05, ci ?? [-0.1, 0.3]), exposure: { exposed: 22, trials: 24 }, cost: costOf(...(cost ?? [1.1, 1.4]), m), mdd: 0.186, ...rest };
};

describe("R48, plan v3 section 9, in both directions", () => {
  test("below 80% exposure the row is untested (exposure), whatever the contrast says", () => {
    expect(EXPOSURE_BAR).toBe(0.8);
    const low = r48(input("helps", { exposure: { exposed: 19, trials: 24 } }));
    expect(low.route).toBe("FIX-METHOD");
    expect(low.null_kind).toBe("exposure");
    expect(low.reason).toContain("untested (exposure)");
    expect(low.next).toBe(R48_PATHS["plan-eng-review"].exposure);
    expect(r48(input("helps", { exposure: { exposed: 4, trials: 5 } })).route).toBe("KEEP");
  });

  test("a control arm past the ceiling is a saturation null: FIX-METHOD with R61's one raise", () => {
    const r = r48(input("ceiling"));
    expect(r.route).toBe("FIX-METHOD");
    expect(r.null_kind).toBe("saturation");
    expect(r.next).toContain("R61");
  });

  test("hurts is a CUT-CANDIDATE, reported plainly", () => {
    const r = r48(input("hurts", { delta: -0.2, ci: [-0.35, -0.05] }));
    expect(r.route).toBe("CUT-CANDIDATE");
    expect(r.next).toBe(R48_PATHS["plan-eng-review"].loss);
  });

  test("helps: the cost ratio's interval decides KEEP, FIX-METHOD or CUT-CANDIDATE", () => {
    expect(r48(input("helps", { cost: [1.1, 1.5] })).route).toBe("KEEP");
    const unsettled = r48(input("helps", { cost: [1.2, 1.8] }));
    expect(unsettled.route).toBe("FIX-METHOD");
    expect(unsettled.reason).toContain("cost unsettled");
    const dear = r48(input("helps", { cost: [1.6, 2.4] }));
    expect(dear.route).toBe("CUT-CANDIDATE");
    expect(dear.reason).toContain("diet track");
  });

  test("not distinguished: a ratio above 1.5 throughout is a CUT-CANDIDATE on cost", () => {
    expect(r48(input("not_distinguished", { cost: [1.51, 2] })).route).toBe("CUT-CANDIDATE");
    expect(r48(input("not_distinguished", { cost: [1.5, 2], ci: [-0.1, 0.3] })).route).toBe("WHY-NULL");
  });

  test("G only: not distinguished with its upper bound under the break-even gain is a CUT-CANDIDATE", () => {
    const under = r48(input("not_distinguished", { ci: [-0.2, 0.2] }));
    expect(under.break_even!).toBeCloseTo(0.2333, 4);
    expect(under.route).toBe("CUT-CANDIDATE");
    expect(under.reason).toContain("break-even");
    const over = r48(input("not_distinguished", { ci: [-0.1, 0.25] }));
    expect(over.route).toBe("WHY-NULL");
    expect(over.next).toContain("frontier without it");
  });

  test("cost readings print as provisional until the project owner confirms the 1.5 bar", () => {
    expect(r48(input("helps")).provisional).toBe(true);
    expect(r48(input("helps", { bar_confirmed: true })).provisional).toBe(false);
    expect(r48(input("hurts", { delta: -0.2, ci: [-0.35, -0.05] })).provisional).toBe(false);
  });

  test("a futility stop whose interim favors none is a loss lead, checked for a loss before the null", () => {
    const fut: Futility = { tasks: 30, clusters: 20, delta: -0.05, se: 0.04, z: -1.25, ci95: [-0.13, 0.03], cp_plus: 0.01, cp_minus: 0.08, stop: true, direction: "hurts", loss_lead: true };
    const r = r48(input("not_distinguished", { futility: fut, ci: [-0.13, 0.03], cost: [1.1, 1.4] }));
    expect(r.loss_lead).toBe(true);
    expect(r.reason).toContain("loss lead");
  });

  test("renders one table row per skill", () => {
    const text = renderR48([r48(input("helps")), r48({ ...input("hurts", { delta: -0.2, ci: [-0.35, -0.05] }), skill: "autoplan" })]);
    expect(text.split("\n").length).toBe(4);
    expect(text).toContain("| plan-eng-review |");
    expect(text).toContain("| autoplan |");
  });
});
