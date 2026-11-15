import { describe, expect, test } from "bun:test";
import { decisionRow, invocation, pairRow, pairWord, stockRow, stockWord, untestedWhy, verdictOf, whyNull, type Verdict } from "../../../lanes/eng-planted/readings/verdicts.ts";

const rd = (lo: number, hi: number, p = 0.01) => ({ estimate: (lo + hi) / 2, lo, hi, p, units: 64, repos: 35, worse: 3, sd: 0.04, mdd: 0.11 });
const base = { admitted: true, gatePassed: true, stopped: false, exposure: 0.9, coverage: 1, plainCoverage: 1, reachGuard: rd(-0.02, 0.02) };

describe("untested", () => {
  test("reasons in order: admission, the gate, the interim stop, final exposure, coverage, plain coverage, the reach guard", () => {
    expect(untestedWhy({ ...base, admitted: false, gatePassed: false })?.kind).toBe("admission");
    expect(untestedWhy({ ...base, gatePassed: false })?.why).toBe("failed the exposure gate");
    expect(untestedWhy({ ...base, stopped: true })?.why).toBe("stopped at the interim exposure check");
    expect(untestedWhy({ ...base, exposure: 0.79 })?.kind).toBe("exposure");
    expect(untestedWhy({ ...base, exposure: 0.8 })).toBeNull();
    expect(untestedWhy({ ...base, coverage: 0.89 })?.kind).toBe("coverage");
    expect(untestedWhy({ ...base, plainCoverage: 0.89 })?.why).toStartWith("plain coverage");
    expect(untestedWhy({ ...base, reachGuard: rd(-0.2, -0.06) })?.kind).toBe("reach");
    expect(untestedWhy({ ...base, reachGuard: rd(-0.2, -0.05) })).toBeNull();
  });
});

describe("verdicts", () => {
  test("precedence: untested, then KEEP, then helps without KEEP, then the other words; never CUT-CANDIDATE", () => {
    const helps = rd(0.02, 0.2);
    expect(verdictOf({ untested: { kind: "exposure", why: "x" }, reading: helps, functional: rd(0, 0.1) }).verdict).toBe("untested");
    expect(verdictOf({ untested: null, reading: helps, functional: rd(-0.099, 0.1) }).verdict).toBe("KEEP");
    expect(verdictOf({ untested: null, reading: helps, functional: rd(-0.1, 0.1) }).verdict).toBe("helps without KEEP");
    expect(verdictOf({ untested: null, reading: helps, functional: null }).verdict).toBe("helps without KEEP");
    expect(verdictOf({ untested: null, reading: rd(-0.2, -0.02), functional: null }).verdict).toBe("hurts");
    expect(verdictOf({ untested: null, reading: rd(-0.05, 0.1, 0.3), functional: null }).verdict).toBe("no measurable difference");
    expect(verdictOf({ untested: null, reading: rd(0.01, 0.1, 0.08), functional: null }).verdict).toBe("not shown");
    expect(verdictOf({ untested: null, reading: null, functional: null }).verdict).toBe("untested");
    expect(verdictOf({ untested: null, reading: helps, functional: rd(0, 0.1), p: 0.06 }).verdict).toBe("not shown");
    for (const v of ["KEEP", "helps without KEEP", "hurts", "no measurable difference", "not shown", "untested"] as Verdict[])
      for (const arm of ["standalone", "engphase"] as const) for (const u of ["exposure", "admission", "coverage", null] as const) expect(decisionRow(arm, v, { untested: u, why: "w", judged: null, judgedReported: false, lead: "avoid", mdd: 0.105 })).not.toContain("CUT");
  });
  test("decision rows follow section 11 and steer the rewrite brief by the judged secondary", () => {
    const row = (v: Verdict, judged: ReturnType<typeof rd> | null, reported: boolean) => decisionRow("standalone", v, { untested: null, why: "", judged, judgedReported: reported, lead: "catch", mdd: 0.105 });
    expect(row("no measurable difference", rd(0.05, 0.3), true)).toContain("the hand-off is the gap");
    expect(row("not shown", rd(-0.05, 0.3), true)).toContain("finds nothing plain Opus doesn't");
    expect(row("no measurable difference", null, false)).toContain("unsteered");
    expect(row("no measurable difference", null, false)).toContain("at MDD 0.105");
    expect(row("KEEP", null, false)).toContain("catch-led");
    expect(decisionRow("engphase", "hurts", { untested: null, why: "", judged: null, judgedReported: false, lead: null, mdd: null })).toContain("autoplan's Phase 3");
    expect(decisionRow("standalone", "untested", { untested: "exposure", why: "failed the exposure gate", judged: null, judgedReported: false, lead: null, mdd: null })).toStartWith("A gstack bug for GStack Minder");
  });
  test("standalone minus eng phase, the stock line and the invocation clause", () => {
    expect(pairWord(rd(0.01, 0.2), false)).toBe("standalone better");
    expect(pairWord(rd(-0.2, -0.01), false)).toBe("eng phase better");
    expect(pairWord(rd(-0.1, 0.1), false)).toBe("no measurable difference (MDD 0.110)");
    expect(pairWord(rd(0.01, 0.2), true)).toStartWith("untested");
    expect(pairRow("eng phase better")).toContain("move the wrapper's instructions");
    expect(stockWord("KEEP", rd(-0.1, 0.049))).toBe("matches");
    expect(stockWord("helps without KEEP", rd(-0.1, 0.049))).toBe("matches");
    expect(stockWord("KEEP", rd(-0.1, 0.05))).toBe("not distinguished");
    expect(stockWord("no measurable difference", rd(-0.1, 0))).toBe("not distinguished");
    expect(stockRow("not distinguished", "standalone")).toBe("Not distinguished: no brief.");
    expect(invocation("standalone", { exposed: 50, unexposed: 3, gaps: 2, share: 50 / 53 })).toEndWith("sessions exposed 50, unexposed 3, gaps 2");
    expect(whyNull("engphase", 0.9, 0.11, 0.4)).toContain("no CUT-CANDIDATE");
  });
});
