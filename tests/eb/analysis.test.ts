import { describe, expect, test } from "bun:test";
import { analyze, holm, infer, primary, reach, sequence, verdict, word, type ArmFacts, type Reading } from "../../lanes/eng-build/analysis.ts";
import type { BuildUnit, CaseClass, GradedBuild, SkillArm } from "../../lanes/eng-build/types.ts";

const RD = (estimate: number, lo: number, hi: number, p: number): Reading => ({ estimate, lo, hi, p, units: 48, repos: 30, worse: 5, sd: 0.03, mdd: 0.08 });
const facts = (r: Reading, o: Partial<ArmFacts> = {}): ArmFacts => ({ untested: null, reading: r, zero: r, functional: RD(0, -0.05, 0.05, 1), reachGuard: RD(0, -0.04, 0.04, 1), exposure: 1, coverage: 1, ...o });

const unit = (id: string, repo: string): BuildUnit => ({ id, repo, set: "comparison", type: "devtools", ecosystems: ["go"], keying: "first", mergedMonth: "2026-08", strictWindow: true, functional: ["fn"], aftermath: [{ item: "B1", cases: ["c1", "c2"], anchors: ["a1"], base: { c1: "fail", c2: "pass" }, mentioned: false, generic: false, foreseeable: "no" }], tCases: [] });
const build = (u: BuildUnit, arm: GradedBuild["arm"], rep: number, cls: Record<string, CaseClass>): GradedBuild => ({ unit: u.id, arm, reviewer: arm === "none" ? null : "opus", rep, pilot: false, outcome: "completed", functional: [{ id: "fn", runs: ["pass", "pass", "pass"] }], aftermath: { B1: ["c1", "c2"].map((id) => ({ id, runs: [cls[id] ?? "no_result", cls[id] ?? "no_result", cls[id] ?? "no_result"] })) }, anchors: { B1: [{ id: "a1", runs: [cls.a1 ?? "no_result", cls.a1 ?? "no_result", cls.a1 ?? "no_result"] }] }, tCases: [], catches: {}, coverage: null, mutation: null, testLinesAdded: 0, costUsd: 0 });

describe("measures", () => {
  test("the primary counts a case passing in 2 of 3 runs and averages over items", () => {
    const u = unit("u", "r");
    const b = build(u, "plain", 1, { c1: "pass" });
    b.aftermath.B1![1] = { id: "c2", runs: ["pass", "assert", "pass"] };
    expect(primary(b, u)).toBe(1);
    b.aftermath.B1![1] = { id: "c2", runs: ["pass", "assert", "load"] };
    expect(primary(b, u)).toBe(0.5);
  });
  test("reach counts assertion results and anchors, never load errors", () => {
    const u = unit("u", "r");
    expect(reach(build(u, "plain", 1, { c1: "assert", c2: "load", a1: "pass" }), u)).toBeCloseTo(2 / 3, 9);
  });
});

describe("inference", () => {
  test("is seeded and clustered on the repository", () => {
    const ds = Array.from({ length: 12 }, (_, i) => ({ unit: "u" + i, repo: "r" + (i % 4), d: (i % 3) / 10 }));
    expect(infer(ds, 5, 500)).toEqual(infer(ds, 5, 500)!);
    expect(infer(ds, 5, 500)!.repos).toBe(4);
    expect(infer([], 5, 500)).toBeNull();
  });
  test("the exact sign-flip p is 2/2^R when every repository moves the same way", () => {
    const ds = Array.from({ length: 6 }, (_, i) => ({ unit: "u" + i, repo: "r" + i, d: 0.1 }));
    expect(infer(ds, 1, 200)!.p).toBeCloseTo(2 / 64, 12);
  });
  test("word needs p and the interval to agree", () => {
    expect(word(RD(0.1, 0.02, 0.2, 0.01))).toBe("helps");
    expect(word(RD(-0.1, -0.2, -0.02, 0.01))).toBe("hurts");
    expect(word(RD(0.1, -0.02, 0.2, 0.2))).toBe("no measurable difference");
    expect(word(RD(0.1, 0.01, 0.2, 0.2))).toBe("not shown");
  });
});

describe("sequence, Holm and verdicts", () => {
  const helps = RD(0.12, 0.05, 0.19, 0.001);
  const flat = RD(0.01, -0.04, 0.06, 0.6);
  test("the sequence stops at the first test that doesn't reject, the pooled one included", () => {
    const s = sequence({ untested: null, reading: flat }, ["precut", "engphase", "candidate"], { candidate: facts(helps), precut: facts(helps), engphase: facts(helps) });
    expect(s.map((x) => x.status)).toEqual(["confirmatory", "descriptive", "descriptive", "descriptive"]);
    const t = sequence({ untested: "fewer than 2 arms passed the exposure gate", reading: null }, ["precut"], { candidate: facts(helps), precut: facts(helps), engphase: facts(helps) });
    expect(t.map((x) => x.status)).toEqual(["untested", "untested", "descriptive", "untested"]);
  });
  test("Holm steps down and stops at the first miss", () => {
    expect(holm([{ arm: "precut", p: 0.01 }, { arm: "candidate", p: 0.03 }, { arm: "engphase", p: 0.02 }]).map((h) => h.rejects)).toEqual([true, true, true]);
    expect(holm([{ arm: "precut", p: 0.017 }, { arm: "candidate", p: 0.001 }]).map((h) => [h.arm, h.rejects])).toEqual([["candidate", true], ["precut", true]]);
    expect(holm([{ arm: "precut", p: 0.04 }, { arm: "candidate", p: 0.03 }]).map((h) => h.rejects)).toEqual([false, false]);
  });
  test("an interval of 0.01 to 0.04 for the candidate reads CUT-CANDIDATE, not KEEP", () => {
    const r = RD(0.025, 0.01, 0.04, 0.01);
    const step = { test: "candidate" as const, status: "confirmatory" as const, reading: r, word: "helps" as const, rejects: true, why: "" };
    expect(verdict("candidate", step, facts(r)).verdict).toBe("CUT-CANDIDATE");
    expect(verdict("precut", { ...step, test: "precut" }, facts(r)).verdict).toBe("KEEP");
    expect(verdict("candidate", step, facts(r, { untested: "exposure 0.79 is under 0.80" })).verdict).toBe("untested");
  });
  test("a descriptive arm never reads helps", () => {
    const step = { test: "precut" as const, status: "descriptive" as const, reading: helps, word: "helps" as const, rejects: false, why: "after the sequence stopped" };
    expect(verdict("precut", step, facts(helps)).verdict).toBe("not shown");
  });
});

describe("analyze", () => {
  test("reads gaps as missing and as 0, and prints no undefined", () => {
    const units = Array.from({ length: 12 }, (_, i) => unit("u" + i, "r" + (i % 10)));
    const builds: GradedBuild[] = [];
    for (const u of units)
      for (const arm of ["none", "plain", "precut", "engphase", "candidate"] as const)
        for (let rep = 1; rep <= 3; rep++) builds.push(build(u, arm, rep, arm === "none" || arm === "plain" ? { c1: rep === 1 ? "pass" : "assert", c2: "assert" } : { c1: "pass", c2: rep === 3 ? "assert" : "pass" }));
    builds[builds.length - 1]!.outcome = "infra_gap";
    const all: SkillArm[] = ["precut", "engphase", "candidate"];
    const gate = { reviewer: "opus" as const, members: all, passed: { precut: true, engphase: true, candidate: true }, stopped: { precut: false, engphase: false, candidate: false }, final: { precut: 1, engphase: 1, candidate: 1 } };
    const a = analyze({ units, builds, reviews: [], reviewer: "opus", gate, headroom: true, planned: { none: 36, plain: 36, precut: 36, engphase: 36, candidate: 36 }, seed: 9, draws: 500 });
    expect(a.pooled.verdict).toBe("helps");
    expect(a.pooled.zero!.estimate).toBeLessThan(a.pooled.reading!.estimate);
    expect(a.lines.join("\n")).not.toContain("undefined");
    expect(a.lines.some((l) => l.startsWith("stratum outside the pilot"))).toBe(true);
  });
});
