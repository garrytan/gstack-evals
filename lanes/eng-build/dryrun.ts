// Copyright (c) 2026 Garry Tan. MIT License.
// The eng-review build read's keyless dry run (prereg 2026-11-11-geva-522-eng-review-build-read-prereg, section 11). It
// drives every frozen rule the plan lists on synthetic fixtures: this lane's own modules (scoring, the pilot's lines, the
// exposure gate and interim stop, the fixed sequence, Holm, the reach guard, the verdict precedence, the gap rules, the
// re-projection, the mounts and strip rule, the cache, the containment gates on a real sidecar, one ledger lease per item
// on a temporary ledger and the route probe on a stubbed call) for real, and the rules other modules own (recipes, runner adapters, the case classifier,
// the test region, the cold rebuild, the Stop hook, the bundle cap, the transplant and the leak check) through named
// seams, each a function that runs that module on its fixture and returns its outcome word.
//
// The run-side check compares every case's line with its exact expected line, by case name. It fails on a missing,
// extra or different line and on any line holding "undefined", and prints the case name each time: there is no
// wildcard. An unwired seam prints OPEN and fails, so the dry run passes only once every module plugs in.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODES, type ReasonCode } from "../../src/errors/codes.ts";
import { openLease, recordApproval } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../src/runner/ledger/paths.ts";
import { analyze, compatibility, functional, holm, isGap, passes, primary, reach, reaches, sequence, SKILL_ARMS, toolReported, unitScore, untestedWhy, verdict, type ArmFacts, type Reading } from "./analysis.ts";
import { agentGuards, assertComplete, assertNoHistory, buildMounts, buildPrompt, buildRegistry, checkMounts, loadCell, runBuildCell, runSessionCell, saveCell, stripTree } from "./build-stage.ts";
import { EbError } from "./errors.ts";
import { FROZEN } from "./frozen.ts";
import { exposureGate, finalUntested, gateState, interimCheck, interimStops, pilotLine, pilotReading, recountGate, type GateState, type PilotReading } from "./gates.ts";
import { EB_RUN, ITEMS, leaseItem, reproject, settleItem } from "./ledger.ts";
import { installCommand, prepareReviewTree, reviewArmSpec } from "./review-stage.ts";
import { interimRun, pipelineCase, SIDECAR_CASES, sidecarCase } from "./dryrun-pipeline.ts";
import { probeRoutes, ROUTES } from "./routes.ts";
import type { Arm, BuildUnit, CaseClass, CaseRuns, Ecosystem, GradedBuild, Reviewer, ReviewRecord, SessionOutcome, SkillArm } from "./types.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Seams: the rules other modules own. Each wired function builds its fixture, runs its module and returns the word.

export const SEAMS = {
  "recipe go": { seam: "unit builder recipe", fixture: "a Go module with one passing and one failing test at base and at merge", expect: "per-case results at base and merge" },
  "recipe node": { seam: "unit builder recipe", fixture: "a Node package (npm, vitest) with one passing and one failing test", expect: "per-case results at base and merge" },
  "recipe node-rust": { seam: "unit builder recipe", fixture: "a Node package with a Rust crate (cargo test)", expect: "per-case results at base and merge" },
  "recipe python": { seam: "unit builder recipe", fixture: "a Python package (pip, pytest)", expect: "per-case results at base and merge" },
  "adapter jest": { seam: "verifier runner adapter", fixture: "the jest negative fixture: a pass, an assertion failure, a missing export and a load error", expect: "pass assert missing_name load" },
  "adapter vitest": { seam: "verifier runner adapter", fixture: "the vitest negative fixture", expect: "pass assert missing_name load" },
  "adapter mocha": { seam: "verifier runner adapter", fixture: "the mocha negative fixture (an ES module's missing export fails at link time, so it reads load)", expect: "pass assert load load" },
  "adapter node-test": { seam: "verifier runner adapter", fixture: "the node:test negative fixture", expect: "pass assert missing_name load" },
  "adapter cargo": { seam: "verifier runner adapter", fixture: "the cargo negative fixture (a missing name is a compile error)", expect: "pass assert compile" },
  "classify fail-to-pass": { seam: "unit builder case rule", fixture: "assert on merged and on the fix's parent, pass on the fix, in 3 runs, fix touching merged lines", expect: "aftermath" },
  "classify merged-error-only": { seam: "unit builder case rule", fixture: "a load error on merged, a pass on the fix", expect: "excluded" },
  "classify missing-name": { seam: "unit builder case rule", fixture: "a missing name on merged, a pass on the fix", expect: "excluded" },
  "classify red-on-base": { seam: "unit builder case rule", fixture: "fail-to-pass as above, and an assertion failure on base with the fix's tests", expect: "aftermath, base fail" },
  "classify anchor": { seam: "unit builder case rule", fixture: "a case in the fix's test files passing on merged and on the fix", expect: "anchor" },
  "classify t-case": { seam: "unit builder case rule", fixture: "a follow-up test case of a T item", expect: "t case" },
  "region rust-inline": { seam: "verifier test region", fixture: "a Rust source file with an inline #[cfg(test)] module changed by the fix", expect: "test region only" },
  "region product-hash": { seam: "verifier test region", fixture: "a graded tree whose product file changed after the move", expect: "E_EB_PRODUCT_HASH" },
  "rebuild stale-artifact": { seam: "verifier cold rebuild", fixture: "a build tree holding a stale compiled file that would pass the hidden test", expect: "stale artifact ignored" },
  "stophook blocks": { seam: "review Stop hook", fixture: "a skill session stopping three times with outputs missing", expect: "block, block, release" },
  "bundle cap": { seam: "review bundle", fixture: "a review whose plan, reply and skill files hold 12,500 words", expect: "truncated at 12000 words" },
  "transplant catch": { seam: "real-bug catch", fixture: "a build test red in 3 merged runs and green in 3 fixed runs", expect: "catch" },
  "transplant no-catch": { seam: "real-bug catch", fixture: "a build test red in 2 of 3 merged runs", expect: "no catch" },
  "leak image": { seam: "leak check", fixture: "the session image on a unit image whose module cache holds the fix's added product line", expect: "E_EB_LEAK" },
} as const;
export type SeamCase = keyof typeof SEAMS;
export type Seams = Partial<Record<SeamCase, () => Promise<string>>>;

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures.

const R3 = (c: CaseClass): CaseClass[] => [c, c, c];
const runs = (id: string, r: CaseClass[] | CaseClass): CaseRuns => ({ id, runs: Array.isArray(r) ? r : R3(r) });

function unit(id: string, repo: string, eco: Ecosystem[], o: Partial<BuildUnit> = {}): BuildUnit {
  return {
    id,
    repo,
    set: "comparison",
    type: "devtools",
    ecosystems: eco,
    keying: "first",
    mergedMonth: "2026-08",
    strictWindow: true,
    functional: ["fn1"],
    aftermath: [{ item: "B1", cases: ["c1", "c2"], anchors: ["a1"], base: { c1: "fail", c2: "no_result" }, mentioned: false, generic: false, foreseeable: "no" }],
    tCases: ["t1"],
    ...o,
  };
}

function build(u: BuildUnit, arm: Arm, reviewer: Reviewer | null, rep: number, cls: Record<string, CaseClass[] | CaseClass>, o: Partial<GradedBuild> = {}): GradedBuild {
  const aftermath: Record<string, CaseRuns[]> = {};
  const anchors: Record<string, CaseRuns[]> = {};
  for (const item of u.aftermath) {
    aftermath[item.item] = item.cases.filter((c) => c in cls).map((c) => runs(c, cls[c]!));
    anchors[item.item] = item.anchors.filter((c) => c in cls).map((c) => runs(c, cls[c]!));
  }
  return {
    unit: u.id,
    arm,
    reviewer,
    rep,
    pilot: false,
    outcome: "completed",
    functional: u.functional.filter((c) => c in cls).map((c) => runs(c, cls[c]!)),
    aftermath,
    anchors,
    tCases: u.tCases.filter((c) => c in cls).map((c) => runs(c, cls[c]!)),
    catches: {},
    coverage: null,
    mutation: null,
    testLinesAdded: 0,
    costUsd: 0,
    ...o,
  };
}

const RD = (estimate: number, lo: number, hi: number, p: number): Reading => ({ estimate, lo, hi, p, units: 48, repos: 30, worse: 10, sd: 0.03, mdd: 0.084 });
const facts = (reading: Reading, o: Partial<ArmFacts> = {}): ArmFacts => ({ untested: null, reading, zero: reading, functional: RD(0, -0.05, 0.05, 1), reachGuard: RD(0, -0.04, 0.04, 1), exposure: 0.95, coverage: 1, ...o });
const helps = RD(0.12, 0.05, 0.19, 0.001);
const flat = RD(0.01, -0.04, 0.06, 0.6);
const fullGate = (members: SkillArm[] = [...SKILL_ARMS], o: Partial<GateState> = {}): GateState => ({ reviewer: "opus", members, passed: { precut: members.includes("precut"), engphase: members.includes("engphase"), candidate: members.includes("candidate") }, stopped: { precut: false, engphase: false, candidate: false }, final: { precut: 0.95, engphase: 0.95, candidate: 0.95 }, ...o });

const review = (unitId: string, arm: Exclude<Arm, "none">, reviewer: Reviewer, rep: number, exposed: boolean | null, o: Partial<ReviewRecord> = {}): ReviewRecord => ({ unit: unitId, arm, reviewer, rep, outcome: "completed", exposed, exposedBeforeBlock: exposed, blocks: 0, bundleWords: 1000, truncated: false, repoEditsDiscarded: 0, costUsd: 1, ...o });

const codeOf = (f: () => unknown): string => {
  try {
    f();
    return "no stop";
  } catch (e) {
    return e instanceof EbError ? e.code : "error " + (e as Error).message.split(" ")[0];
  }
};
const msgOf = (f: () => unknown): string => {
  try {
    f();
    return "no stop";
  } catch (e) {
    return e instanceof EbError ? e.code + " " + e.message : "error " + (e as Error).message;
  }
};

// ---------------------------------------------------------------------------------------------------------------------
// The cases: each returns its line. EXPECTED holds every case's exact line.

type Case = () => Promise<string> | string;

function ownCases(): Record<string, Case> {
  const go = unit("u-go", "r1", ["go"]);
  const node = unit("u-node", "r2", ["node"]);
  const nodeRust = unit("u-node-rust", "r2", ["node", "rust"]);
  const py = unit("u-python", "r3", ["python"], { aftermath: [{ item: "B1", cases: ["c1"], anchors: [], base: { c1: "fail" }, mentioned: true, generic: false, foreseeable: "yes" }, { item: "B2", cases: ["d1", "d2", "d3", "d4"], anchors: [], base: { d1: "pass", d2: "fail", d3: "fail", d4: "fail" }, mentioned: false, generic: true, foreseeable: "maybe" }], tCases: [] });
  const ctx = (builds: GradedBuild[], gaps: "missing" | "zero" = "missing") => ({ units: [go, node, nodeRust, py], builds, reviewer: "opus" as const, gaps, seed: 1, draws: 200 });
  const f3 = (x: number | null) => (x === null ? "null" : x.toFixed(3));

  return {
    "score pass 2 of 3": () => "pass,pass,assert counts " + passes(runs("x", ["pass", "pass", "assert"])) + "; pass,assert,assert counts " + passes(runs("x", ["pass", "assert", "assert"])),
    "score no result": () => "no_result passes " + passes(runs("x", "no_result")) + ", reaches " + reaches(runs("x", "no_result")) + "; a missing case passes " + passes(undefined),
    "score excluded classes": () => (["missing_name", "load", "compile", "timeout"] as CaseClass[]).map((c) => c + " " + passes(runs("x", c)) + "/" + reaches(runs("x", c))).join(", "),
    "score fail-to-pass": () => "primary " + f3(primary(build(go, "plain", "opus", 1, { c1: "pass", c2: "assert" }), go)),
    "score red on base": () => {
      const b = build(go, "plain", "opus", 1, { c1: "pass", c2: "assert" });
      return "base fail case c1 enters the primary " + f3(primary(b, go)) + " and the base fail split " + f3(primary(b, go, (i, c) => i.base[c] === "fail"));
    },
    "score anchor": () => {
      const b = build(go, "plain", "opus", 1, { c1: "assert", c2: "assert", a1: "pass" });
      return "primary " + f3(primary(b, go)) + ", reach " + f3(reach(b, go)) + ", compatibility " + f3(compatibility(b, go));
    },
    "score t case": () => {
      const b = build(go, "plain", "opus", 1, { c1: "pass", c2: "pass", a1: "assert", t1: "pass" });
      return "primary " + f3(primary(b, go)) + ", compatibility " + f3(compatibility(b, go));
    },
    "score item weighting": () => "two items, 1 of 1 and 1 of 4 passing: primary " + f3(primary(build(py, "plain", "opus", 1, { c1: "pass", d1: "pass", d2: "assert", d3: "assert", d4: "assert" }), py)),
    "score no compile against hidden tests": () => {
      const b = build(go, "plain", "opus", 1, { c1: "compile", c2: "compile", a1: "compile", fn1: "compile", t1: "compile" });
      return "primary " + f3(primary(b, go)) + ", reach " + f3(reach(b, go)) + ", functional " + functional(b, go);
    },
    "score functional solved": () => "fn1 pass " + functional(build(go, "plain", "opus", 1, { fn1: "pass" }), go) + "; fn1 assert " + functional(build(go, "plain", "opus", 1, { fn1: "assert" }), go),
    "score gaps": () => {
      const bs = [build(go, "plain", "opus", 1, { c1: "pass", c2: "assert" }), build(go, "plain", "opus", 2, {}, { outcome: "infra_gap" })];
      return "missing " + f3(unitScore(ctx(bs), go, "plain", primary)) + ", as 0 " + f3(unitScore(ctx(bs, "zero"), go, "plain", primary)) + ", gap " + isGap(bs[1]!);
    },
    "fixture ecosystems": () => [go, node, nodeRust, py].map((u) => u.id + " " + u.ecosystems.join("+")).join(", "),

    "recount 15 and 16": () => "15 " + codeOf(() => recountGate(15)) + "; 16 " + codeOf(() => recountGate(16)),
    "pilot reach 0.59 and 0.60": () => {
      const r = (reach: number): PilotReading => ({ reach, plain: 0.4, plainLower: 0.3, functional: 0.6, units: 16, builds: 64 });
      return "0.59 " + pilotLine(r(0.59)).line + "; 0.60 " + pilotLine(r(0.6)).line;
    },
    "pilot floor 0.09 and 0.10": () => {
      const r = (plain: number, fn: number): PilotReading => ({ reach: 0.8, plain, plainLower: plain - 0.05, functional: fn, units: 16, builds: 64 });
      return "0.09 " + pilotLine(r(0.09, 0.5)).message + "; 0.09 with functional 0.49 " + pilotLine(r(0.09, 0.49)).message.split(": ").pop() + "; 0.10 " + pilotLine(r(0.1, 0.5)).line;
    },
    "pilot ceiling 0.85 and 0.86": () => {
      const r = (plain: number): PilotReading => ({ reach: 0.9, plain, plainLower: 0.7, functional: 0.9, units: 16, builds: 64 });
      return "0.85 " + pilotLine(r(0.85)).line + "; 0.86 " + pilotLine(r(0.86)).line;
    },
    "pilot lower bound 0.75 and 0.76": () => {
      const r = (plainLower: number): PilotReading => ({ reach: 0.9, plain: 0.8, plainLower, functional: 0.9, units: 16, builds: 64 });
      return "0.75 " + pilotLine(r(0.75)).line + "; 0.76 " + pilotLine(r(0.76)).line;
    },
    "pilot reading from builds": () => {
      const bs: GradedBuild[] = [];
      for (const u of [go, node]) {
        for (const rep of [1, 2]) {
          bs.push(build(u, "none", null, rep, { c1: "assert", c2: "assert", a1: "pass", fn1: "pass" }, { pilot: true }));
          bs.push(build(u, "plain", "opus", rep, { c1: "pass", c2: rep === 1 ? "pass" : "load", a1: "pass", fn1: rep === 1 ? "pass" : "assert" }, { pilot: true }));
        }
      }
      bs.push(build(go, "plain", "opus", 3, { c1: "pass", c2: "pass" }));
      const r = pilotReading([go, node], bs, 7, 200);
      return "reach " + r.reach.toFixed(3) + ", plain " + r.plain.toFixed(3) + ", functional " + r.functional.toFixed(3) + ", units " + r.units + ", builds " + r.builds + ": " + pilotLine(r).line;
    },

    "exposure gate opus 4 and 5 of 6": () => {
      const smoke = (n: number) => SKILL_ARMS.flatMap((arm) => [1, 2, 3, 4, 5, 6].map((i) => review("cal", arm, "opus", i, arm === "precut" ? i <= n : true)));
      const g4 = exposureGate(smoke(4));
      const g5 = exposureGate(smoke(5));
      return "4 of 6: precut " + (g4.members.includes("precut") ? "through" : "out") + ", members " + g4.members.join("+") + "; 5 of 6: members " + g5.members.join("+");
    },
    "exposure gate other 1 and 2 of 3": () => {
      const g = exposureGate([...SKILL_ARMS.flatMap((arm) => [1, 2, 3].map((i) => review("cal", arm, "sol", i, i <= (arm === "candidate" ? 1 : 2)))), ...SKILL_ARMS.flatMap((arm) => [1, 2, 3, 4, 5, 6].map((i) => review("cal", arm, "opus", i, true)))]);
      return g.arms.filter((a) => a.reviewer === "sol").map((a) => a.arm + " " + a.exposed + " of 3 " + (a.passed ? "runs" : "does not run")).join(", ");
    },
    "exposure gate fewer than two opus arms": () => {
      const g = exposureGate(SKILL_ARMS.flatMap((arm) => [1, 2, 3, 4, 5, 6].map((i) => review("cal", arm, "opus", i, arm === "candidate"))));
      return (g.stop ? "stop" : "go") + ": " + g.lines.at(-1);
    },
    "interim 0.69 and 0.70": async () => "0.69 " + (interimStops(0.69) ? "stops" : "goes on") + "; 0.70 " + (interimStops(0.7) ? "stops" : "goes on") + "; in run order, " + (await interimRun(16)) + "; " + (await interimRun(17)),
    "interim after 24 sessions": () => {
      const s = (n: number, len = 24) => Array.from({ length: len }, (_, i) => review("u" + i, "precut", "opus", 1, i < n));
      const a = interimCheck("precut", "opus", s(16));
      const b = interimCheck("precut", "opus", s(17));
      const c = interimCheck("precut", "opus", s(0, 23));
      return "16 of 24 " + (a.stop ? "stops" : "goes on") + ", 17 of 24 " + (b.stop ? "stops" : "goes on") + ", 23 sessions " + (c.exposure === null ? "no reading yet" : "read") + "; " + a.line;
    },
    "final exposure 0.79 and 0.80": () => "0.79 " + (finalUntested(0.79) ? "untested" : "tested") + "; 0.80 " + (finalUntested(0.8) ? "untested" : "tested"),
    "gate state interim stop makes pooled untested": () => {
      const g = exposureGate(SKILL_ARMS.flatMap((arm) => [1, 2, 3, 4, 5, 6].map((i) => review("cal", arm, "opus", i, true))));
      const comp = [...SKILL_ARMS.flatMap((arm) => Array.from({ length: 24 }, (_, i) => review("u" + i, arm, "opus", 1, arm === "engphase" ? i < 16 : true)))];
      const st = gateState(g, "opus", comp);
      return "members " + st.members.join("+") + ", engphase stopped " + st.stopped.engphase + ", final " + st.final.engphase!.toFixed(3);
    },

    "tools 89% and 90% of trees": () => "0.89 " + (toolReported(0.89) ? "reported" : "not reported") + "; 0.90 " + (toolReported(0.9) ? "reported" : "not reported"),

    "sequence stops at each test": () => {
      const order = (p: Reading, c: Reading, pc: Reading, e: Reading) =>
        sequence({ untested: null, reading: p }, SKILL_ARMS, { candidate: facts(c), precut: facts(pc), engphase: facts(e) })
          .map((s) => s.test + " " + (s.status === "confirmatory" ? (s.rejects ? "rejects" : "stops") : s.status))
          .join(", ");
      return [order(flat, helps, helps, helps), order(helps, flat, helps, helps), order(helps, helps, flat, helps), order(helps, helps, helps, flat), order(helps, helps, helps, helps)].join(" | ");
    },
    "sequence skips an arm out at the gate": () =>
      sequence({ untested: null, reading: helps }, ["precut", "engphase"], { candidate: facts(helps), precut: facts(helps), engphase: facts(flat) })
        .map((s) => s.test + " " + (s.status === "confirmatory" ? (s.rejects ? "rejects" : "stops") : s.status))
        .join(", "),
    "holm sensitivity": () => {
      const a = holm([{ arm: "candidate", p: 0.01 }, { arm: "precut", p: 0.02 }, { arm: "engphase", p: 0.04 }]);
      const b = holm([{ arm: "candidate", p: 0.02 }, { arm: "precut", p: 0.03 }, { arm: "engphase", p: 0.04 }]);
      return a.map((h) => h.arm + " " + (h.rejects ? "rejects" : "no")).join(", ") + " | " + b.map((h) => h.arm + " " + (h.rejects ? "rejects" : "no")).join(", ");
    },
    "pooled with arms out at the gate": () => {
      const pooled = (g: GateState) => {
        const fx = fixture([go, node, nodeRust, py]);
        const a = analyze({ ...fx, reviews: [], reviewer: "opus", gate: g, headroom: true, planned: planned(fx.units.length), seed: 3, draws: 200 });
        return a.pooled.verdict === "untested" ? "untested (" + a.pooled.untested + ")" : "tested";
      };
      return "one out: " + pooled(fullGate(["precut", "engphase"])) + "; two out: " + pooled(fullGate(["precut"])) + "; member under 0.80 late: " + pooled(fullGate(undefined, { final: { precut: 0.95, engphase: 0.79, candidate: 0.95 } })) + "; member stopped: " + pooled(fullGate(undefined, { stopped: { precut: true, engphase: false, candidate: false } }));
    },
    "reach guard -0.051 and -0.050": () => {
      const w = (hi: number) => untestedWhy({ headroom: true, arm: "precut", gate: fullGate(), coverage: 1, plainCoverage: 1, reachGuard: RD(-0.1, -0.15, hi, 0.01) });
      return "-0.051 " + (w(-0.051) ?? "tested") + "; -0.050 " + (w(-0.05) ?? "tested");
    },
    "coverage 0.89 and 0.90": () => {
      const w = (c: number) => untestedWhy({ headroom: true, arm: "precut", gate: fullGate(), coverage: c, plainCoverage: 1, reachGuard: null });
      return "0.89 " + (w(0.89) ?? "tested") + "; 0.90 " + (w(0.9) ?? "tested");
    },
    "keep at functional lower bounds -0.099, -0.10 and -0.11": () => {
      const step = { test: "precut" as const, status: "confirmatory" as const, reading: helps, word: "helps" as const, rejects: true, why: "" };
      const v = (lo: number) => verdict("precut", step, facts(helps, { functional: RD(0, lo, 0.1, 0.9) })).verdict;
      return "-0.099 " + v(-0.099) + "; -0.10 " + v(-0.1) + "; -0.11 " + v(-0.11);
    },
    "candidate cut at upper bounds 0.049 and 0.050": () => {
      const step = (r: Reading) => ({ test: "candidate" as const, status: "confirmatory" as const, reading: r, word: null, rejects: false, why: "does not reject" });
      const a = RD(0.0, -0.05, 0.049, 0.9);
      const b = RD(0.0, -0.05, 0.05, 0.9);
      const tight = RD(0.025, 0.01, 0.04, 0.01);
      const tightStep = { test: "candidate" as const, status: "confirmatory" as const, reading: tight, word: "helps" as const, rejects: true, why: "rejects" };
      return "0.049 " + verdict("candidate", step(a), facts(a)).verdict + "; 0.050 " + verdict("candidate", { ...step(b), word: "no measurable difference" }, facts(b)).verdict + "; 0.01 to 0.04 helps " + verdict("candidate", tightStep, facts(tight)).verdict;
    },
    "cut needs exposure, headroom and coverage": () => {
      const r = RD(0.0, -0.05, 0.03, 0.9);
      const st = { test: "candidate" as const, status: "confirmatory" as const, reading: r, word: "no measurable difference" as const, rejects: false, why: "" };
      return ["exposure 0.79", "no headroom", "coverage 0.85"].map((k, i) => {
        const why = untestedWhy({ headroom: i !== 1, arm: "candidate", gate: fullGate(undefined, { final: { precut: 0.95, engphase: 0.95, candidate: i === 0 ? 0.79 : 0.95 } }), coverage: i === 2 ? 0.85 : 1, plainCoverage: 1, reachGuard: null });
        return k + " " + verdict("candidate", st, facts(r, { untested: why })).verdict;
      }).join(", ");
    },
    "precut and engphase never read cut": () => {
      const r = RD(0.0, -0.05, 0.03, 0.9);
      const st = (arm: "precut" | "engphase") => ({ test: arm, status: "confirmatory" as const, reading: r, word: "no measurable difference" as const, rejects: false, why: "" });
      return "precut " + verdict("precut", st("precut"), facts(r)).verdict + ", engphase " + verdict("engphase", st("engphase"), facts(r)).verdict;
    },
    "end to end analysis": () => {
      const fx = fixture([go, node, nodeRust, py]);
      const a = analyze({ ...fx, reviews: [], reviewer: "opus", gate: fullGate(), headroom: true, planned: planned(fx.units.length), seed: 11, draws: 2000 });
      return "pooled " + a.pooled.verdict + " " + (a.pooled.reading?.estimate ?? 0).toFixed(3) + "; " + SKILL_ARMS.map((arm) => arm + " " + a.arms[arm].verdict).join(", ") + "; " + a.lines.length + " lines, conditional " + a.conditional;
    },
    "conditional stage trigger": () => {
      const a = fixture([go, node, nodeRust, py]);
      const b = fixture([go, node, nodeRust, py], true);
      const helpsRun = analyze({ ...a, reviews: [], reviewer: "opus", gate: fullGate(), headroom: true, planned: planned(a.units.length), seed: 11, draws: 2000 });
      const flatRun = analyze({ ...b, reviews: [], reviewer: "opus", gate: fullGate(), headroom: true, planned: planned(b.units.length), seed: 11, draws: 2000 });
      return "pooled " + helpsRun.pooled.verdict + ": " + (helpsRun.conditional ? "triggered" : "not triggered") + "; pooled " + flatRun.pooled.verdict + ": " + (flatRun.conditional ? "triggered" : "not triggered");
    },

    "session upstream then completed": async () => describeRun(await runSessionCell("c", script(["upstream_gap", "completed"]))),
    "session upstream twice": async () => describeRun(await runSessionCell("c", script(["upstream_gap", "upstream_gap"]))),
    "session infra twice": async () => describeRun(await runSessionCell("c", script(["infra_gap", "infra_gap"]))),
    "session upstream, infra, completed": async () => describeRun(await runSessionCell("c", script(["upstream_gap", "infra_gap", "completed"]))),
    "session limit scored": async () => describeRun(await runSessionCell("c", script(["limit"]))),
    "review gap leaves the build unbuilt": async () => {
      let sessions = 0;
      const lines: string[] = [];
      const b = await runBuildCell({ unit: go, arm: "precut", reviewer: "opus", rep: 1, pilot: false, note: "note", review: review("u-go", "precut", "opus", 1, true, { outcome: "upstream_gap" }), session: async () => (sessions++, { outcome: "completed", tree: "/t", costUsd: 1 }), grader: async () => fail0(), log: (l) => lines.push(l) });
      return "outcome " + b.outcome + ", sessions " + sessions + "; " + lines[0];
    },
    "build cell grades a completed session": async () => {
      const b = await runBuildCell({ unit: go, arm: "plain", reviewer: "opus", rep: 2, pilot: true, note: "note", review: review("u-go", "plain", "opus", 2, null), session: async (o) => ({ outcome: o.attempt === 1 ? "infra_gap" : "completed", tree: "/t", costUsd: 1.5 }), grader: async () => ({ functional: [runs("fn1", "pass")], aftermath: { B1: [runs("c1", "pass"), runs("c2", "assert")] }, anchors: {}, tCases: [], catches: {}, coverage: null, mutation: null, testLinesAdded: 3 }) });
      return "outcome " + b.outcome + ", cost " + b.costUsd + ", primary " + f3(primary(b, go));
    },

    "prompts": () => {
      const n = buildPrompt("none", "Names: foo(x) -> int.\n");
      const r = buildPrompt("precut", "Names: foo(x) -> int.");
      return JSON.stringify(n) + " | " + JSON.stringify(r);
    },
    "arms file": () => {
      const reg = buildRegistry();
      return Object.entries(reg.arms).map(([n, a]) => n + " " + a.kind + " " + a.install + " clean_room " + a.clean_room + " " + JSON.stringify(a.limits)).join("; ") + "; model " + reg.pins.model;
    },
    "agent guards": () => {
      const missing = agentGuards();
      return missing.length ? "missing " + missing.join(", ") : "real_agent carries every guard";
    },
    "mounts": () => buildMounts({ arm: "none", repo: "/s/repo", plan: "/s/plan.md", review: null }).join(" ") + " | " + buildMounts({ arm: "candidate", repo: "/s/repo", plan: "/s/plan.md", review: "/s/review" }).join(" "),
    "mounts refuse hidden tests, key, history and drives": () => {
      const forbidden = ["/sealed/task", "/sealed/key.json", "/fixture/drive"];
      return [
        ["/sealed/task/tests:/work/review:ro"],
        ["/sealed/key.json:/work/plan.md:ro"],
        ["/fixture/drive/x:/work/review:ro"],
        ["/sealed:/work/repo"],
        ["/s/repo:/work/later"],
        ["/s/repo:/work/repo", "/s/plan.md:/work/plan.md:ro"],
      ].map((m) => codeOf(() => checkMounts(m, forbidden))).join(", ");
    },
    "strip rule": () => withTmp((dir) => {
      for (const p of ["CLAUDE.md", "a/AGENTS.md", "a/b/.claude/settings.json", "a/b/CLAUDE.local.md", ".git/CLAUDE.md", "src/main.go"]) {
        mkdirSync(join(dir, p, ".."), { recursive: true });
        writeFileSync(join(dir, p), "x");
      }
      return "removed " + stripTree(dir).join(", ") + "; kept .git/CLAUDE.md " + existsSync(join(dir, ".git/CLAUDE.md")) + ", src/main.go " + existsSync(join(dir, "src/main.go"));
    }),
    "review strip rule": () => withTmp((dir) => {
      const repo = (name: string, committed: string[], loose: string[]) => {
        const d = join(dir, name);
        mkdirSync(d);
        const g = (...a: string[]) => spawnSync("git", ["-C", d, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...a], { encoding: "utf8" });
        g("init", "-q");
        for (const p of [...committed, ...loose]) {
          mkdirSync(join(d, p, ".."), { recursive: true });
          writeFileSync(join(d, p), "x");
        }
        g("add", ...committed);
        g("commit", "-q", "-m", "base");
        return d;
      };
      const clean = repo("clean", ["src/app.ts"], ["CLAUDE.md", "a/AGENTS.md", "a/.claude/settings.json"]);
      const removed = prepareReviewTree(clean);
      const dirty = repo("dirty", ["src/app.ts", "CLAUDE.md"], []);
      return "removed " + removed.join(", ") + "; a base commit holding CLAUDE.md " + codeOf(() => prepareReviewTree(dirty));
    }),
    "review installs per the arms table": () =>
      (["none", "plain", "precut", "engphase", "candidate"] as Arm[])
        .map((arm) => {
          const spec = reviewArmSpec(arm);
          return arm + " " + (spec === null ? "no session" : spec.kind === "bare" ? "bare, no gstack" : installCommand(arm) + " at " + (spec.kind === "stack" ? spec.stack.sha.slice(0, 9) : ""));
        })
        .join("; "),
    "no eb module goes through er-cli": () => {
      const dir = import.meta.dir;
      const pattern = new RegExp("from\\s+[\"'][^\"']*" + "er-" + "cli");
      const hits = readdirSync(dir).filter((f) => f.endsWith(".ts") && pattern.test(readFileSync(join(dir, f), "utf8")));
      return hits.length ? "imported by " + hits.join(", ") : "no eb module imports it";
    },
    "no later history": () => withTmp((dir) => {
      const g = (...a: string[]) => spawnSync("git", ["-C", dir, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...a], { encoding: "utf8" });
      g("init", "-q");
      writeFileSync(join(dir, "f"), "1");
      g("add", "f");
      g("commit", "-q", "-m", "base");
      const one = codeOf(() => assertNoHistory(dir));
      g("remote", "add", "origin", "https://example.invalid/x.git");
      const remote = codeOf(() => assertNoHistory(dir));
      g("remote", "remove", "origin");
      writeFileSync(join(dir, "f"), "2");
      g("commit", "-q", "-am", "later");
      return "base only " + one + ", with a remote " + remote + ", two commits " + codeOf(() => assertNoHistory(dir));
    }),

    "cache stale": () => withTmp((dir) => {
      const key = saveCell(dir, build(go, "plain", "opus", 1, { c1: "pass" }));
      const ok = loadCell(dir, key) ? "reads" : "missing";
      writeFileSync(join(dir, key + ".json"), "{}");
      return "fresh " + ok + ", absent " + (loadCell(dir, "nope") === null ? "null" : "read") + ", tampered " + codeOf(() => loadCell(dir, key));
    }),
    "cell incomplete": () => codeOf(() => assertComplete("pilot", ["a", "b"], new Set(["a"]))) + "; complete " + codeOf(() => assertComplete("pilot", ["a"], new Set(["a"]))),

    "reprojection cuts and the 0.12 stop": () => {
      const measured = { reviewUsd: { plain: 0.54, precut: 2.74, engphase: 3.51, candidate: 1.3 }, buildUsd: 2.5 };
      const caps = { reviews: 1500, builds: 2150 };
      const flat12 = reproject({ measured, caps, mdd: () => 0.12 });
      const flat13 = reproject({ measured, caps, mdd: () => 0.13 });
      const dear = reproject({ measured: { ...measured, buildUsd: 3.5 }, caps, mdd: (d) => (d.units === 48 ? 0.105 : d.k === 3 ? 0.114 : 0.14) });
      const dearer = reproject({ measured: { ...measured, buildUsd: 4.5 }, caps, mdd: (d) => (d.k === 3 ? 0.114 : 0.14) });
      const none = reproject({ measured: { ...measured, buildUsd: 9 }, caps, mdd: () => 0.1 });
      return ["0.12 " + (flat12.stop ? "stop" : "go"), "0.13 " + (flat13.stop ? "stop" : "go"), "$3.50 builds: " + dear.cuts.join(" then ") + " -> " + dear.design.units + "x" + dear.design.k + "x" + dear.design.kNone + " " + (dear.stop ? "stop" : "go"), "$4.50 builds: " + dearer.cuts.length + " cuts " + (dearer.stop ? "stop" : "go"), "$9 builds: " + (none.stop?.split(";")[1]?.trim() ?? "go")].join("; ");
    },
    "one ledger lease per item": () => ledgerCase(),
    "route probe": async () => {
      const seen: string[] = [];
      const ok = await probeRoutes(async (r) => (seen.push(r.name), { status: 200, text: "ok", micros: 1200, served_by: null }));
      const bad = await probeRoutes(async (r) => (r.name === "review-particle" ? { status: 429, text: null, micros: null, served_by: null } : { status: 200, text: "ok", micros: 1200, served_by: null }));
      return seen.length + " routes, one call each: " + (ok.ok ? "ok" : "FAIL") + "; a 429 on particle-1: " + (bad.ok ? "ok" : "FAIL") + " (" + bad.lines.at(-1) + ")";
    },
    "every E_EB code": () => codeTable(),
    "pipeline end to end": () => pipelineCase(),
    ...Object.fromEntries(Object.keys(SIDECAR_CASES).map((n) => [n, () => sidecarCase(n as keyof typeof SIDECAR_CASES)])),
  };
}

const fail0 = (): never => {
  throw new Error("the grader ran on a gap");
};
const script = (outcomes: SessionOutcome[]) => async (n: number) => outcomes[n - 1]!;
const describeRun = (r: { outcome: string; attempts: string[]; gap: boolean; line: string | null }) => r.outcome + " after " + r.attempts.length + " attempt(s), gap " + r.gap + (r.line ? "; " + r.line : "");

function withTmp<T>(f: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "eb-dryrun-"));
  try {
    return f(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const planned = (units: number): Record<Arm, number> => ({ none: units * 2, plain: units * 3, precut: units * 3, engphase: units * 3, candidate: units * 3 });

/** Eight copies of each fixture unit over five repository labels each, with seeded builds: plain passes about 30% of the cases, every skill arm 75% (or 30% when flat). */
function fixture(base: BuildUnit[], flat = false): { units: BuildUnit[]; builds: GradedBuild[] } {
  let s = 12345;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out: GradedBuild[] = [];
  const units = Array.from({ length: 8 }, (_, i) => base.map((u) => ({ ...u, id: u.id + "-" + i, repo: u.repo + "-" + (i % 5) }))).flat();
  for (const u of units) {
    for (const arm of ["none", "plain", ...SKILL_ARMS] as Arm[]) {
      const p = arm === "none" || arm === "plain" || flat ? 0.3 : 0.75;
      for (let rep = 1; rep <= (arm === "none" ? 2 : 3); rep++) {
        const cls: Record<string, CaseClass> = { fn1: "pass", a1: "pass", t1: "pass" };
        for (const item of u.aftermath) for (const c of item.cases) cls[c] = rand() < p ? "pass" : "assert";
        out.push(build(u, arm, arm === "none" ? null : "opus", rep, cls));
      }
    }
  }
  return { units, builds: out };
}

function ledgerCase(): string {
  return withTmp((dir) => {
    const record = join(dir, "record");
    const local = openLocalLedger(ledgerPath(join(dir, "ledger.sqlite")));
    try {
      const quote = { words: "dry run on a temporary ledger", by: "eb dryrun", source: "section 11" };
      for (const i of ITEMS) recordApproval(record, { action: "init", item: i.item, cap_micros: i.capUsd * 1_000_000, quotes: [quote], admission: "warn" });
      let settled = 0;
      for (const i of ITEMS) {
        const lease = leaseItem(record, local, i.item, { requireAdmission: () => null });
        settleItem(record, local, lease.lease_id);
        settled++;
      }
      let bound = "no refusal";
      try {
        openLease(record, local, { item: ITEMS[0]!.item, run_id: "another-run", requireAdmission: () => null });
      } catch (e) {
        bound = (e as { code?: string }).code ?? "error";
      }
      return ITEMS.length + " items, " + settled + " leases opened and settled on run " + EB_RUN + "; a second run on " + ITEMS[0]!.item + ": " + bound;
    } finally {
      local.close();
    }
  });
}

/** Every E_EB code: in the code table with the plan's exit, and the ones this lane raises printed by the rule that raises them. */
function codeTable(): string {
  const drops: ReasonCode[] = ["E_EB_NO_RECIPE", "E_EB_IMAGE", "E_EB_NO_AFTERMATH", "E_EB_TRANSPLANT", "E_EB_GAP"];
  const stops = (Object.keys(CODES) as ReasonCode[]).filter((c) => c.startsWith("E_EB_") && !drops.includes(c));
  const bad = [...drops.filter((c) => CODES[c].exit !== null), ...stops.filter((c) => CODES[c].exit !== 2)];
  const r = (reach: number, plain: number, lower: number): PilotReading => ({ reach, plain, plainLower: lower, functional: 0.6, units: 16, builds: 64 });
  const printed: Record<string, string> = {
    E_EB_REACH: pilotLine(r(0.5, 0.4, 0.3)).code + " " + pilotLine(r(0.5, 0.4, 0.3)).message,
    E_EB_FLOOR: pilotLine(r(0.8, 0.05, 0.01)).code + " " + pilotLine(r(0.8, 0.05, 0.01)).message,
    E_EB_CEILING: pilotLine(r(0.9, 0.9, 0.8)).code + " " + pilotLine(r(0.9, 0.9, 0.8)).message,
    E_EB_FEW_UNITS: msgOf(() => recountGate(12)),
    E_EB_CACHE_STALE: "E_EB_CACHE_STALE (see cache stale)",
    E_EB_CELL_INCOMPLETE: msgOf(() => assertComplete("pilot", ["a"], new Set())),
  };
  const missing = (Object.keys(printed) as ReasonCode[]).filter((c) => !printed[c]!.startsWith(c));
  return (Object.keys(CODES).filter((c) => c.startsWith("E_EB_")).length) + " codes; exits as the plan's table: " + (bad.length ? "no (" + bad.join(", ") + ")" : "yes") + "; printed lines start with their code: " + (missing.length ? "no (" + missing.join(", ") + ")" : "yes");
}

// ---------------------------------------------------------------------------------------------------------------------
// Expected lines.

export const EXPECTED: Record<string, string> = {
  "score pass 2 of 3": "pass,pass,assert counts true; pass,assert,assert counts false",
  "score no result": "no_result passes false, reaches false; a missing case passes false",
  "score excluded classes": "missing_name false/false, load false/false, compile false/false, timeout false/false",
  "score fail-to-pass": "primary 0.500",
  "score red on base": "base fail case c1 enters the primary 0.500 and the base fail split 1.000",
  "score anchor": "primary 0.000, reach 1.000, compatibility 0.500",
  "score t case": "primary 1.000, compatibility 0.500",
  "score item weighting": "two items, 1 of 1 and 1 of 4 passing: primary 0.625",
  "score no compile against hidden tests": "primary 0.000, reach 0.000, functional 0",
  "score functional solved": "fn1 pass 1; fn1 assert 0",
  "score gaps": "missing 0.500, as 0 0.250, gap true",
  "fixture ecosystems": "u-go go, u-node node, u-node-rust node+rust, u-python python",
  "recount 15 and 16": "15 E_EB_FEW_UNITS; 16 no stop",
  "pilot reach 0.59 and 0.60": "0.59 INSTRUMENT; 0.60 HEADROOM",
  "pilot floor 0.09 and 0.10": "0.09 plain functional solved 0.500, reach 0.800; plain-review later-fix pass share 0.090 is under 0.10 (units 16, builds 64): FIX-METHOD on task fit; 0.09 with functional 0.49 FIX-METHOD on the build setup; 0.10 HEADROOM",
  "pilot ceiling 0.85 and 0.86": "0.85 HEADROOM; 0.86 CEILING",
  "pilot lower bound 0.75 and 0.76": "0.75 HEADROOM; 0.76 CEILING",
  "pilot reading from builds": "reach 0.917, plain 0.750, functional 0.500, units 2, builds 8: HEADROOM",
  "exposure gate opus 4 and 5 of 6": "4 of 6: precut out, members engphase+candidate; 5 of 6: members precut+engphase+candidate",
  "exposure gate other 1 and 2 of 3": "precut 2 of 3 runs, engphase 2 of 3 runs, candidate 1 of 3 does not run",
  "exposure gate fewer than two opus arms": "stop: E_EB_EXPOSURE_GATE 1 Opus arm passed the gate, needs 2; the comparison does not start, stop for the Captain",
  "interim 0.69 and 0.70": "0.69 stops; 0.70 goes on; in run order, 16 of 24: ran 1, stopped and recorded (2 stop lines), a resume ran 0; 17 of 24: ran 2, went on",
  "interim after 24 sessions": "16 of 24 stops, 17 of 24 goes on, 23 sessions no reading yet; E_EB_EXPOSURE_STOP arm precut on opus: exposure 0.667 after 24 sessions is under 0.70; the arm stops and its leases settle, the pooled primary reads untested, the other arms go on",
  "final exposure 0.79 and 0.80": "0.79 untested; 0.80 tested",
  "gate state interim stop makes pooled untested": "members precut+engphase+candidate, engphase stopped true, final 0.667",
  "tools 89% and 90% of trees": "0.89 not reported; 0.90 reported",
  "sequence stops at each test":
    "pooled stops, candidate descriptive, precut descriptive, engphase descriptive | pooled rejects, candidate stops, precut descriptive, engphase descriptive | pooled rejects, candidate rejects, precut stops, engphase descriptive | pooled rejects, candidate rejects, precut rejects, engphase stops | pooled rejects, candidate rejects, precut rejects, engphase rejects",
  "sequence skips an arm out at the gate": "pooled rejects, candidate untested, precut rejects, engphase stops",
  "holm sensitivity": "candidate rejects, precut rejects, engphase rejects | candidate no, precut no, engphase no",
  "pooled with arms out at the gate": "one out: tested; two out: untested (fewer than 2 arms passed the exposure gate); member under 0.80 late: untested (member engphase: exposure 0.79 is under 0.80); member stopped: untested (member precut: stopped at the interim exposure check)",
  "reach guard -0.051 and -0.050": "-0.051 reach guard: reach minus plain upper bound -0.051 is below -0.05; -0.050 tested",
  "coverage 0.89 and 0.90": "0.89 coverage 0.89 is under 0.90; 0.90 tested",
  "keep at functional lower bounds -0.099, -0.10 and -0.11": "-0.099 KEEP; -0.10 helps; -0.11 helps",
  "candidate cut at upper bounds 0.049 and 0.050": "0.049 CUT-CANDIDATE; 0.050 no measurable difference; 0.01 to 0.04 helps CUT-CANDIDATE",
  "cut needs exposure, headroom and coverage": "exposure 0.79 untested, no headroom untested, coverage 0.85 untested",
  "precut and engphase never read cut": "precut no measurable difference, engphase no measurable difference",
  "end to end analysis": "pooled helps 0.425; precut KEEP, engphase KEEP, candidate KEEP; 46 lines, conditional true",
  "conditional stage trigger": "pooled helps: triggered; pooled no measurable difference: not triggered",
  "session upstream then completed": "completed after 2 attempt(s), gap false",
  "session upstream twice": "upstream_gap after 2 attempt(s), gap true; E_EB_GAP cell c: upstream_gap again after 1 retry; recorded as a gap",
  "session infra twice": "infra_gap after 2 attempt(s), gap true; E_EB_GAP cell c: infra_gap again after 1 retry; recorded as a gap",
  "session upstream, infra, completed": "completed after 3 attempt(s), gap false",
  "session limit scored": "limit after 1 attempt(s), gap false",
  "review gap leaves the build unbuilt": "outcome upstream_gap, sessions 0; E_EB_GAP cell u-go:precut:opus:1: its review ended upstream_gap, so the build is not run; recorded as a gap",
  "build cell grades a completed session": "outcome completed, cost 3, primary 0.500",
  prompts:
    '"Implement the plan in plan.md in /work/repo, with tests.\\n\\nNames: foo(x) -> int." | "Implement the plan in plan.md in /work/repo, with tests. A reviewer\'s notes on the plan are in /work/review/; use them as you see fit.\\n\\nNames: foo(x) -> int."',
  "arms file":
    'eb-build:none none none clean_room true {"session_cap_usd":16,"wall_limit_sec":10800,"max_turns":400,"quiet_sec":30,"bg_wait_sec":600}; eb-build:reviewed none none clean_room true {"session_cap_usd":16,"wall_limit_sec":10800,"max_turns":400,"quiet_sec":30,"bg_wait_sec":600}; model claude-opus-5-5',
  "agent guards": "real_agent carries every guard",
  mounts: "/s/repo:/work/repo /s/plan.md:/work/plan.md:ro | /s/repo:/work/repo /s/plan.md:/work/plan.md:ro /s/review:/work/review:ro",
  "mounts refuse hidden tests, key, history and drives": "E_USAGE, E_USAGE, E_USAGE, E_USAGE, E_USAGE, no stop",
  "strip rule": "removed CLAUDE.md, a/AGENTS.md, a/b/.claude, a/b/CLAUDE.local.md; kept .git/CLAUDE.md true, src/main.go true",
  "review strip rule": "removed CLAUDE.md, a/.claude, a/AGENTS.md; a base commit holding CLAUDE.md E_USAGE",
  "review installs per the arms table": "none no session; plain bare, no gstack; precut ./setup --host claude --no-browser -q at b493d4e31; engphase ./setup --host claude --no-browser -q at 199931029; candidate ./setup --host claude at 57295cbc5",
  "no eb module goes through er-cli": "no eb module imports it",
  "no later history": "base only no stop, with a remote E_USAGE, two commits E_USAGE",
  "cache stale": "fresh reads, absent null, tampered E_EB_CACHE_STALE",
  "cell incomplete": "E_EB_CELL_INCOMPLETE; complete no stop",
  "reprojection cuts and the 0.12 stop": "0.12 go; 0.13 stop; $3.50 builds: no-review builds to 1 a unit then comparison units from 48 to 40 -> 40x3x1 go; $4.50 builds: 3 cuts stop; $9 builds: no frozen cut fits the recorded caps, stop for the Captain before any further spend",
  "one ledger lease per item": "9 items, 9 leases opened and settled on run geva-522-eb; a second run on eb-reviews-opus: E_ITEM_BOUND",
  "route probe": "6 routes, one call each: ok; a 429 on particle-1: FAIL (route review-particle: FAIL openrouter particle-ai/particle-1 on eb-exposure-smoke, cost unknown (status 429))",
  "every E_EB code": "18 codes; exits as the plan's table: yes; printed lines start with their code: yes",
  "pipeline end to end": "1 screened, 1 built, 1 noted; 4 reviews, 4 bundles, Stop hook on candidate engphase precut; 5 builds, 5 graded; eb-build-units 1 opened, 1 settled; eb-reviews-opus 1 opened, 1 settled; eb-builds-opus 1 opened, 1 settled",
  "sidecar clean": "pass",
  "sidecar extra ref": "E_EB_LEAK sidecar-origin (extra_ref)",
  "sidecar tag": "E_EB_LEAK sidecar-origin (tag)",
  "sidecar unreachable object": "E_EB_LEAK sidecar-origin (unreachable)",
  "sidecar extra pack": "E_EB_LEAK sidecar-origin (object_count)",
  "sidecar gh issue": "E_EB_LEAK sidecar-gh (issue_open)",
  "sidecar gh pr": "E_EB_LEAK sidecar-origin (extra_ref); E_EB_LEAK sidecar-gh (pr_open)",
};
for (const [name, s] of Object.entries(SEAMS)) EXPECTED["seam " + name] = s.expect;

// ---------------------------------------------------------------------------------------------------------------------
// The run side and its check.

export interface DryRunResult {
  ok: boolean;
  lines: string[];
  failed: string[];
  skipped: string[];
}

export async function runCases(o: { part: "own" | "all"; seams?: Seams; expected?: Record<string, string> }): Promise<Map<string, string>> {
  const got = new Map<string, string>();
  for (const [name, f] of Object.entries(ownCases())) {
    try {
      got.set(name, await f());
    } catch (e) {
      got.set(name, "threw " + (e instanceof EbError ? e.code + " " : "") + (e as Error).message.split("\n")[0]);
    }
  }
  if (o.part === "all") {
    for (const name of Object.keys(SEAMS) as SeamCase[]) {
      const f = o.seams?.[name];
      if (!f) {
        got.set("seam " + name, "OPEN (seam " + SEAMS[name].seam + " not wired)");
        continue;
      }
      try {
        got.set("seam " + name, await f());
      } catch (e) {
        got.set("seam " + name, "threw " + (e as Error).message.split("\n")[0]);
      }
    }
  }
  return got;
}

/** The run-side check: every expected case needs its exact line, by name; a missing, extra or "undefined" line fails.
 * A seam that could not run here returns "SKIP <reason>": it prints as SKIP with its reason and the run is not ok. */
export function check(got: Map<string, string>, expected: Record<string, string>, part: "own" | "all"): DryRunResult {
  const lines: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  const want = Object.entries(expected).filter(([name]) => part === "all" || !name.startsWith("seam "));
  for (const [name, line] of want) {
    const g = got.get(name);
    if (g === undefined) {
      failed.push(name);
      lines.push("FAIL " + name + ": no line was printed");
    } else if (g.startsWith("SKIP ")) {
      skipped.push(name);
      lines.push("SKIP " + name + ": " + g.slice(5) + "; not a pass");
    } else if (g.includes("undefined")) {
      failed.push(name);
      lines.push("FAIL " + name + ": the line holds the word undefined: " + g);
    } else if (g !== line) {
      failed.push(name);
      lines.push("FAIL " + name + ": expected " + JSON.stringify(line) + ", got " + JSON.stringify(g));
    } else lines.push("ok " + name + ": " + g);
  }
  for (const name of got.keys()) {
    if (!want.some(([n]) => n === name)) {
      failed.push(name);
      lines.push("FAIL " + name + ": printed a line no expected case names");
    }
  }
  return { ok: failed.length === 0 && skipped.length === 0, lines, failed, skipped };
}

export async function dryRun(o: { part?: "own" | "all"; seams?: Seams; expected?: Record<string, string> } = {}): Promise<DryRunResult> {
  const part = o.part ?? "all";
  return check(await runCases({ part, seams: o.seams }), o.expected ?? EXPECTED, part);
}

