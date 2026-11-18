// Copyright (c) 2026 Garry Tan. MIT License.
// Section 11's lead table and per-arm rates, and section 9's re-reading of power.py, for the office-hours rewrite eval.
import { describe, expect, test } from "bun:test";
import { leadTable, rates } from "../../../lanes/office-hours-rewrite/read/report.ts";
import { POWER_PY, POWER_SHA256, observedMdd, reread, rereadProgram } from "../../../lanes/office-hours-rewrite/read/reread.ts";
import { founderRows, plant } from "../../../lanes/office-hours-rewrite/read/seams.ts";

describe("section 11's lead table", () => {
  test("three contrasts, pooled then each model, particle-1 marked descriptive", () => {
    const t = leadTable(plant("merge").rows);
    expect(t.map((r) => r.contrast + " " + r.scope)).toEqual([
      "new minus current pooled", "new minus current opus", "new minus current sol", "new minus current particle",
      "new minus none pooled", "new minus none opus", "new minus none sol", "new minus none particle",
      "current minus none pooled", "current minus none opus", "current minus none sol", "current minus none particle",
    ]);
    const nc = t[0]!;
    expect([nc.control_arm, nc.control_rate, nc.C, nc.mdd_plan, nc.descriptive]).toEqual(["current", 0.4, 20, "0.12 to 0.13", false]);
    expect(nc.estimate).toBeCloseTo(0.3, 12);
    expect(t[1]!.mdd_plan).toBe("0.17 to 0.18");
    expect(t[4]!.mdd_plan).toBe("0.08 to 0.13");
    expect(t[5]!.mdd_plan).toBe("0.11 to 0.18");
    expect([t[3]!.descriptive, t[3]!.mdd_plan]).toEqual([true, null]);
    expect(t[4]!.control_rate).toBe(0);
  });
  test("the observed MDD column fills from the re-read", () => {
    const obs = observedMdd({ founder: [
      { control: "current", p0: 0.4, rho: 0.5, pooled: "0.13", one_model: "0.18" }, { control: "current", p0: 0.4, rho: 0.843, pooled: "0.08", one_model: "0.11" },
      { control: "none", p0: 0.1, rho: 0.5, pooled: "0.09", one_model: "0.13" }, { control: "none", p0: 0.1, rho: 0.843, pooled: "0.07", one_model: "not reached by 0.39" },
    ], builder: [] });
    const t = leadTable(plant("merge").rows, obs);
    expect(t[0]!.mdd_observed).toBe("0.13 (0.08 at rho 0.843)");
    expect(t[2]!.mdd_observed).toBe("0.18 (0.11 at rho 0.843)");
    expect(t[9]!.mdd_observed).toBe("0.13 (not reached by 0.39 at rho 0.843)");
    expect(t[3]!.mdd_observed).toBeNull();
  });
});

describe("R1, R2 and R3 by arm", () => {
  test("share of scored founder sessions, pooled over Opus and Sol and per model", () => {
    const rows = founderRows({ R: (arm, j) => (arm === "new" && j < 10 ? 1 : 0), end: (arm, j, m) => (arm === "new" && m === "sol" && j === 39 ? "missing" : undefined) });
    const r = rates(rows);
    const pooledNew = r.find((x) => x.arm === "new" && x.scope === "pooled")!;
    expect(pooledNew.R).toEqual({ k: 20, n: 79, rate: 20 / 79 });
    expect(pooledNew.R1).toEqual({ k: 79, n: 79, rate: 1 });
    expect(r.find((x) => x.arm === "none" && x.scope === "particle")!.R2).toEqual({ k: 0, n: 40, rate: 0 });
    expect(r.length).toBe(12);
  });
});

describe("section 9's re-reading of power.py", () => {
  test("power.py is the attachment the preregistration names", () => {
    expect(POWER_SHA256).toBe("8ea44fae503752e3b64e99fd18962a44eadee9d0be8490619f748674b532dec9");
  });
  test("runs power.py's own functions at the observed rates, both rho values, no grid", () => {
    let seen: { program: string; stdin: string } | null = null;
    const out = reread({ current: 0.35, none: 0.1, kept: 1 }, (program, stdin) => {
      seen = { program, stdin };
      return JSON.stringify({ founder: [], builder: [] });
    });
    expect(out).toEqual({ founder: [], builder: [] });
    expect(JSON.parse(seen!.stdin)).toEqual({ founder: [{ control: "current", p0: 0.35 }, { control: "none", p0: 0.1 }], builder: [{ p0: 0.99 }], rho: [0.5, 0.843] });
    expect(seen!.program).toContain(JSON.stringify(POWER_PY));
    expect(rereadProgram(POWER_PY)).toContain("ns[\"mdd\"]");
  });
  test("a runner that fails or prints no JSON is refused", () => {
    expect(() => reread({ current: 0.4, none: 0.1, kept: 0.9 }, () => "Traceback")).toThrow(/^E_OHR_READ_POWER/);
  });
});
