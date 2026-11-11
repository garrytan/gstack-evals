import { describe, expect, test } from "bun:test";
import { EbError } from "../../lanes/eng-build/errors.ts";
import { exposureGate, gateState, interimCheck, pilotLine, recountGate } from "../../lanes/eng-build/gates.ts";
import type { ReviewRecord, SkillArm } from "../../lanes/eng-build/types.ts";

const rec = (arm: SkillArm, reviewer: ReviewRecord["reviewer"], i: number, exposed: boolean): ReviewRecord => ({ unit: "u" + i, arm, reviewer, rep: 1, outcome: "completed", exposed, exposedBeforeBlock: exposed, blocks: 0, bundleWords: 100, truncated: false, repoEditsDiscarded: 0, costUsd: 1 });

describe("pilot lines", () => {
  const r = { reach: 0.8, plain: 0.4, plainLower: 0.3, functional: 0.6, units: 16, builds: 64 };
  test("read in order: reach first, even when the floor would also stop", () => {
    expect(pilotLine({ ...r, reach: 0.5, plain: 0.01 }).code).toBe("E_EB_REACH");
    expect(pilotLine({ ...r, plain: 0.05 }).code).toBe("E_EB_FLOOR");
    expect(pilotLine({ ...r, plain: 0.05, functional: 0.4 }).message).toEndWith("FIX-METHOD on the build setup");
    expect(pilotLine({ ...r, plain: 0.9 }).code).toBe("E_EB_CEILING");
    expect(pilotLine(r).line).toBe("HEADROOM");
  });
  test("the recount needs 16 clean units", () => {
    expect(() => recountGate(15)).toThrow(EbError);
    expect(() => recountGate(16)).not.toThrow();
  });
});

describe("exposure", () => {
  const arms: SkillArm[] = ["precut", "engphase", "candidate"];
  test("freezes membership at the gate and stops under two Opus arms", () => {
    const g = exposureGate(arms.flatMap((a) => [1, 2, 3, 4, 5, 6].map((i) => rec(a, "opus", i, a !== "precut" || i > 2))));
    expect(g.members).toEqual(["engphase", "candidate"]);
    expect(g.stop).toBe(false);
    expect(exposureGate(arms.flatMap((a) => [1, 2, 3, 4, 5, 6].map((i) => rec(a, "opus", i, a === "precut")))).stop).toBe(true);
  });
  test("the interim reads the first 24 sessions only", () => {
    const s = Array.from({ length: 30 }, (_, i) => rec("precut", "opus", i, i >= 8));
    expect(interimCheck("precut", "opus", s).stop).toBe(true);
    expect(interimCheck("precut", "opus", s.slice(0, 23)).exposure).toBeNull();
  });
  test("gate state carries the final exposure", () => {
    const g = exposureGate(arms.flatMap((a) => [1, 2, 3, 4, 5, 6].map((i) => rec(a, "opus", i, true))));
    const st = gateState(g, "opus", [rec("candidate", "opus", 1, true), rec("candidate", "opus", 2, false)]);
    expect(st.final.candidate).toBe(0.5);
    expect(st.final.precut).toBeNull();
  });
});
