import { describe, expect, test } from "bun:test";
import { EpError } from "../../../lanes/eng-planted/errors.ts";
import { fxBuild, fxReview, fxUnit } from "../../../lanes/eng-planted/readings/fixtures.ts";
import { admissionLine, enforce, exposureCounts, hardOf, hintedOf, interimCheck, raiseProjection, raiseRead, raiseStep, smokeGate, startRule, supplyCheck, type AdmissionReading } from "../../../lanes/eng-planted/readings/gates.ts";

const rd = (estimate: number, lo: number) => ({ estimate, lo, hi: estimate + 0.1, p: 0.5, units: 20, repos: 15, worse: 0, sd: 0.05, mdd: 0.14 });
const reading = (avoid: [number, number], c: [number, number], composite?: [number, number], o: Partial<AdmissionReading> = {}): AdmissionReading => ({
  units: 20,
  repos: 15,
  builds: 40,
  reach: 0.8,
  hinted: { passed: 18, screened: 20 },
  functional: 0.7,
  avoid: rd(...avoid),
  catch: rd(...c),
  composite: rd(...(composite ?? [(avoid[0] + c[0]) / 2, (avoid[1] + c[1]) / 2])),
  ...o,
});

describe("the admission pilot's lines", () => {
  test("INSTRUMENT comes first, also when no plain build was read", () => {
    expect(admissionLine(reading([0.01, 0], [0.01, 0], undefined, { reach: 0.5 }), { afterRaise: false }).code).toBe("E_EP_INSTRUMENT");
    expect(admissionLine(reading([0.4, 0.3], [0.4, 0.3], undefined, { reach: null, avoid: null }), { afterRaise: false }).code).toBe("E_EP_INSTRUMENT");
    expect(admissionLine(reading([0.4, 0.3], [0.4, 0.3], undefined, { hinted: { passed: 0, screened: 0 } }), { afterRaise: false }).code).toBe("E_EP_INSTRUMENT");
  });
  test("the component rule picks the composite, one component, or neither", () => {
    expect(admissionLine(reading([0.4, 0.3], [0.3, 0.2]), { afterRaise: false }).primary).toBe("composite");
    expect(admissionLine(reading([0.4, 0.3], [0.05, 0]), { afterRaise: false }).primary).toBe("avoid");
    expect(admissionLine(reading([0.7, 0.66], [0.3, 0.2]), { afterRaise: false }).primary).toBe("catch");
    expect(admissionLine(reading([0.9, 0.8], [0.05, 0]), { afterRaise: false }).code).toBe("E_EP_COMPONENTS_SPLIT");
  });
  test("FLOOR prints the functional share first and names the build setup under 0.50", () => {
    const a = admissionLine(reading([0.05, 0.01], [0.02, 0], undefined, { functional: 0.4 }), { afterRaise: false });
    expect(a.code).toBe("E_EP_FLOOR");
    expect(a.message).toStartWith("functional share 0.400 (under 0.50: the build setup, not the task)");
    expect(a.lines.at(-1)).toStartWith("E_EP_FLOOR functional share");
  });
  test("a ceiling reads the raise the first time and stops after it; the composite's own lower bound counts", () => {
    expect(admissionLine(reading([0.8, 0.7], [0.9, 0.8]), { afterRaise: false }).code).toBe("E_EP_RAISE");
    expect(admissionLine(reading([0.8, 0.7], [0.9, 0.8]), { afterRaise: true }).code).toBe("E_EP_CEILING");
    const c = admissionLine(reading([0.74, 0.6], [0.74, 0.6], [0.74, 0.66]), { afterRaise: false });
    expect([c.code, c.primary, c.ceiling.join()]).toEqual(["E_EP_RAISE", "composite", "avoid,catch"]);
    expect(admissionLine(reading([0.4, 0.3], [0.3, 0.2]), { afterRaise: true }).line).toBe("HEADROOM");
  });
  test("hinted builds come from the units' winnable flags", () => {
    expect(hintedOf([fxUnit(0), fxUnit(1, 1, 1, { winnable: false }), fxUnit(2, 1, 1, { winnable: null })])).toEqual({ passed: 1, screened: 2 });
  });
});

describe("the content raise", () => {
  test("hard units missed on a component at the ceiling; unforeseeable units are never hard", () => {
    const u = fxUnit(0, 2, 1);
    expect(hardOf(u, [fxBuild(u, "none", 1, { pass: 1, catch: true })], ["avoid"])).toBe(true);
    expect(hardOf(u, [fxBuild(u, "none", 1, { pass: 2, catch: false })], ["avoid"])).toBe(false);
    expect(hardOf(u, [fxBuild(u, "none", 1, { pass: 2, catch: null })], ["avoid", "catch"])).toBe(true);
    expect(hardOf(u, [fxBuild(u, "none", 1, { pass: 0, outcome: "infra_gap" })], ["avoid"])).toBeNull();
    expect(hardOf(fxUnit(1, 1, 1, { foresee: ["no", "no"] }), [], ["avoid"])).toBe(false);
  });
  test("the projection: hard rate, survival, supply, candidates and a 1.2 cap", () => {
    const p = raiseProjection({ read: 20, hard: 8, authored: 30, admitted: 20, unused: 200, perCandidateUsd: 6, perReadUsd: 3.5 });
    expect([p.hardRate, p.projected, p.target, p.short, p.candidates, p.readUsd, p.totalUsd, p.capUsd]).toEqual([0.4, 61, 61, false, 199, 112, 1306, 1568]);
    const q = raiseProjection({ read: 20, hard: 15, authored: 20, admitted: 20, unused: 300, perCandidateUsd: 6, perReadUsd: 3.5 });
    expect([q.target, q.candidates]).toEqual([64, 66]);
    expect(raiseProjection({ read: 20, hard: 0, authored: 20, admitted: 20, unused: 300, perCandidateUsd: 6, perReadUsd: 3.5 }).short).toBe(true);
  });
  test("raiseStep leaves a non-ceiling alone and stops short supply before any spend", () => {
    const head = admissionLine(reading([0.4, 0.3], [0.3, 0.2]), { afterRaise: false });
    const p = raiseProjection({ read: 20, hard: 2, authored: 20, admitted: 20, unused: 10, perCandidateUsd: 6, perReadUsd: 3.5 });
    expect(raiseStep(head, p)).toBe(head);
    const first = admissionLine(reading([0.8, 0.7], [0.9, 0.8]), { afterRaise: false });
    const s = raiseStep(first, p);
    expect(s.code).toBe("E_EP_CEILING");
    expect(s.message).toContain("can't reach 40 hard units");
    expect(raiseRead(reading([0.4, 0.3], [0.3, 0.2]), 39).code).toBe("E_EP_CEILING");
  });
});

describe("exposure", () => {
  test("counts a gap as neither in the comparison", () => {
    const rs = [fxReview("a", "standalone", 1, true), fxReview("b", "standalone", 1, false), fxReview("c", "standalone", 1, true, "infra_gap")];
    expect(exposureCounts(rs)).toEqual({ exposed: 1, unexposed: 1, gaps: 1, share: 0.5 });
  });
  test("the smoke counts a session that never ran against the arm", () => {
    const five = [1, 2, 3, 4, 5].map((i) => fxReview("c" + i, "standalone", 1, true));
    const g = smokeGate([...five, ...[1, 2, 3, 4, 5, 6].map((i) => fxReview("c" + i, "engphase", 1, true))], "opus");
    expect(g.through).toEqual(["standalone", "engphase"]);
    const h = smokeGate([...five.slice(1), ...[1, 2, 3].map((i) => fxReview("c" + i, "engphase", 1, true))], "opus");
    expect([h.code, h.through.length]).toEqual(["E_EP_EXPOSURE_GATE", 0]);
    expect(h.message).toContain("the comparison does not start");
  });
  test("the interim check waits for 24 non-gap sessions", () => {
    const rs = Array.from({ length: 30 }, (_, i) => fxReview("u" + i, "engphase", 1, false, i < 7 ? "upstream_gap" : "completed"));
    expect(interimCheck("engphase", "opus", rs).share).toBeNull();
    expect(interimCheck("engphase", "opus", [...rs, fxReview("x", "engphase", 1, false)]).stop).toBe(true);
  });
});

describe("start rule and supply", () => {
  test("refuse through enforce with their codes", () => {
    expect(() => enforce(startRule(0.13))).toThrow(EpError);
    expect(() => enforce(startRule(0.12))).not.toThrow();
    try {
      enforce(supplyCheck(12));
    } catch (e) {
      expect((e as EpError).code).toBe("E_EP_SUPPLY_SHORT");
    }
    expect(supplyCheck(64).message).toBe("supply: 64 admitted units");
  });
});
