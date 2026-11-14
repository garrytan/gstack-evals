// Copyright (c) 2026 Garry Tan. MIT License.
// The read area's dry-run cases (build plan section 15 and 2026-11-09 start rule 5, the reading edges): each runs the
// area's real functions on invented fixtures and names its rule.
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DcError } from "../errors.ts";
import { CREW_DEVIATION, ENFORCED_LABEL, KEEP_WORDING, LEDGER_ITEMS, MONEY, SATURATION_WORDING } from "../frozen.ts";
import type { Arm, CellState, DryRunCase, GstackArm, MatchItem, Model, SessionKind } from "../types.ts";
import { admissionRead, buildDesign, cutAdmission, planningInputs, planningLines, plannedDesign, POWER_PY, project, projectionRerun, resize, type DesignJson } from "./admission.ts";

export { planningInputs };
import { above, atLeast, atMost, q4 } from "./num.ts";
import { armStopsHeldBlock, pd1Effect, rendersOnSupplyStop, tieDecided } from "./prints.ts";
import type { PowerRunner } from "./seams.ts";
import { armMean, kMultiple, lensParse, smokeDecision, stage1Reading, twinCheck, type SmokeSession, type Stage1Inputs, type Stage1Reading, type TwinPairInput, type TwinReading } from "./stage1.ts";
import { contrast, interimStop, judgeOk, missingShare, primaries, readingRule, unionSensitivity, verdict, type Contrast, type Primary, type VerdictInput } from "./stage2.ts";
import { requireStartRule8, startRule8, startRule9, type FirstCall, type TermsRecord } from "./start.ts";
import type { ReadCell } from "./types.ts";

// ---- Fixtures

type CellOpts = Partial<Omit<ReadCell, "unit" | "arm" | "pass">>;
export const cell = (unit: string, arm: SessionKind, pass: number, a: number | null, o: CellOpts = {}): ReadCell => ({
  unit, arm, pass, model: "opus", state: "scored" as CellState, a, g: null, d: null, shuffledA: 0, shuffledG: null, words: 100, exposed: arm === "plan-design-review" || arm === "autoplan" ? true : null, ...o,
});

const codeOf = (f: () => unknown): string | null => {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof DcError ? e.code : "threw " + (e as Error).message;
  }
};
const expectCode = (f: () => unknown, code: string): string | null => {
  const got = codeOf(f);
  return got === code ? null : "expected " + code + ", got " + (got ?? "no error");
};
const eq = (got: unknown, want: unknown, what: string): string | null => (JSON.stringify(got) === JSON.stringify(want) ? null : what + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
const all = (...checks: (string | null)[]): string | null => checks.find((x) => x !== null) ?? null;

/** Opus none cells on two skins: three passes each. */
const pair = (id: string, first: number[], second: number[]): TwinPairInput => ({
  pair: id,
  first: first.map((a, i) => cell(id + "-1", "none", i + 1, a)),
  second: second.map((a, i) => cell(id + "-2", "none", i + 1, a)),
});
const sixPairs = (f: (n: number) => [number[], number[]]) => [1, 2, 3, 4, 5, 6].map((n) => pair("p" + n, ...f(n)));

let trackingTwin: TwinReading | null = null;
const tracking = () => (trackingTwin ??= twinCheck(sixPairs(() => [[0.4, 0.6, 0.4], [0.6, 0.4, 0.4]])));

/** Stage 1 inputs that pass every check before the tier chain, with the base tier at HEADROOM. */
const s1 = (o: Partial<Stage1Inputs> = {}): Stage1Inputs => ({
  twin: tracking(),
  opusJudge: { kappa: 0.7, goldShort: false },
  stockFailOpus: false,
  opusNoneParse: { parsed: 48, replies: 48 },
  base: { none: 0.4, reference: 0.7 },
  ...o,
});
const x2 = (o: Partial<NonNullable<Stage1Inputs["x2"]>> = {}): NonNullable<Stage1Inputs["x2"]> => ({ none: 0.4, reference: 0.7, units: 12, costBase: [1], cost2x: [1], kUnits: [{ unit: "c1", base: 0.8, x2: 0.4 }], ...o });
const x10 = (o: Partial<NonNullable<Stage1Inputs["x10"]>> = {}): NonNullable<Stage1Inputs["x10"]> => ({ noneG: 0.4, noneD: 0.1, referenceG: 0.7, detailCheck: { kappa: 0.7, goldShort: false }, detailUnits: 12, ...o });
const ceilingBase = { none: 0.66, reference: 0.8 };
const reads = (r: Stage1Reading) => (r.ends ? r.reading : "HEADROOM " + r.tier);

const smoke = (parsed: number, exposed: number, usd = 2): SmokeSession[] => [0, 1, 2, 3, 4, 5].map((i) => ({ parsed: i < parsed, exposed: i < exposed, usd, blocks: 0 }));

/** A primary whose contrast is given directly, for the precedence steps. */
const primaryOf = (ci: [number, number], holm: number, spec: [number, number] | null, arm: GstackArm = "plan-design-review"): Primary => ({
  arm,
  pIn: holm,
  holm,
  contrast: { model: "opus", b: arm, a: "none", tier: "base", measure: "A", units: 64, clusters: 16, unpaired: [], delta: (ci[0] + ci[1]) / 2, ci95: ci, p: holm, pMethod: "exact-sign-flip", worse: 3, specificity: spec ? { units: 64, delta: 0, ci95: spec } : null, lengthAdjusted: null } as Contrast,
});
let headroom: Stage1Reading | null = null;
const vin = (o: Partial<VerdictInput> = {}): VerdictInput => ({
  stage1: (headroom ??= stage1Reading(s1())),
  incomplete: null,
  smoke: smokeDecision("plan-design-review", "opus", smoke(6, 6)),
  untested: { judgeOk: true, stockFail: false, exposure: 0.9, interimStopped: false, missing: { arm: 0.02, none: 0.02 }, contamination: 0 },
  primary: primaryOf([0.05, 0.2], 0.01, [0.01, 0.1]),
  mdd: 0.08,
  ...o,
});
const untested = (o: Partial<VerdictInput["untested"]>) => vin({ untested: { ...vin().untested, ...o } });

/** Cells for units on base apps, one value per arm per pass, with shuffled scores of 0. */
const grid = (spec: Array<{ unit: string; values: Partial<Record<SessionKind, number[]>> }>, model: Model = "opus"): ReadCell[] =>
  spec.flatMap((u) => Object.entries(u.values).flatMap(([arm, vs]) => vs!.map((v, i) => cell(u.unit, arm as SessionKind, i + 1, v, { model }))));

const fakeRunner = (power: string, word: "pass" | "fail", mdd = "0.08", seen?: { design?: DesignJson; calls: number }): PowerRunner => (_script, designPath) => {
  if (seen) {
    seen.calls++;
    seen.design = JSON.parse(readFileSync(designPath, "utf8"));
  }
  return { code: 0, stdout: "ADMIT units 64 repositories 16 p0 0.200 passes_arm 2 passes_none 2 delta 0.12 alpha 0.025 sims 4000 power " + power + " se 0.006 -> " + word + "\nMDD units 64 repositories 16 p0 0.200 passes_arm 2 passes_none 2 alpha 0.025 sims 1000 MDD " + mdd + "\n", stderr: "" };
};
const designUnits = (n: number, apps: number, items = (i: number) => 3 + (i % 3)) => Array.from({ length: n }, (_, i) => ({ unit: "u" + i, baseApp: "app-" + Math.floor((i * apps) / n), items: items(i) }));
const withTemp = <T>(f: (dir: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), "dc-read-"));
  try {
    return f(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const terms: TermsRecord = { model: "sol", dated: "2026-11-14", provider: "OpenAI", dataCollection: "deny", termsDigest: "t1" };
const call = (o: Partial<FirstCall> = {}): FirstCall => ({ model: "sol", provider: "OpenAI", fallbacks: false, dataCollection: "deny", termsDigest: "t1", ...o });
const day = (n: number) => new Date(Date.UTC(2026, 11, 1) + n * 86_400_000).toISOString();
const judges = (o: { astra?: number; opus?: number; argon?: number; opusRecheck?: number | null; opusDetail?: number } = {}) => ({
  astra: { stage1: { kappa: o.astra ?? 0.7, goldShort: false }, recheck: null, detail: { kappa: 0.7, goldShort: false } },
  opus: { stage1: { kappa: o.opus ?? 0.7, goldShort: false }, recheck: o.opusRecheck === undefined || o.opusRecheck === null ? null : { kappa: o.opusRecheck, goldShort: false }, detail: { kappa: o.opusDetail ?? 0.7, goldShort: false } },
  argon: { stage1: { kappa: o.argon ?? 0.7, goldShort: false }, recheck: null, detail: { kappa: 0.7, goldShort: false } },
});

// ---- Cases

export function cases(): DryRunCase[] {
  return [
    // M12: rounding and exact decimal comparison
    { rule: "M12", name: "at most 0.65 passes 0.6500 and 0.65004 and fails 0.6501 and 0.65005", check: () => all(eq([atMost(0.65, 0.65), atMost(0.65004, 0.65), atMost(0.6501, 0.65), atMost(0.65005, 0.65)], [true, true, false, false], "atMost")) },
    { rule: "M12", name: "binary noise never moves a rounding", check: () => all(eq(q4(0.1 + 0.2), 3000, "0.1 + 0.2"), eq(atLeast(0.65 - 0.5, 0.15), true, "0.65 - 0.5 at least 0.15"), eq(q4(-0.00005), -1, "negative half")) },
    { rule: "M12", name: "D for an arm is the mean over detail-keyed units of each unit's mean D", check: () => all(eq(armMean([cell("u1", "none", 1, 0.5, { d: 0 }), cell("u1", "none", 2, 0.5, { d: 1 }), cell("u2", "none", 1, 0.5, { d: 0 }), cell("u3", "none", 1, 0.5, { d: null })], "d"), 0.25, "D")) },
    { rule: "M13", name: "an arm mean weighs units equally whatever their pass counts", check: () => eq(q4(armMean([cell("u1", "none", 1, 0), cell("u1", "none", 2, 0), cell("u1", "none", 3, 1), cell("u2", "none", 1, 1)], "a")!), 6667, "arm mean") },
    { rule: "M13", name: "a no-block cell counts 0 and a missing cell leaves the mean", check: () => eq(armMean([cell("u1", "none", 1, null, { state: "no-block" }), cell("u1", "none", 2, 1), cell("u1", "none", 3, null, { state: "infra-missing" })], "a"), 0.5, "arm mean") },

    // M12: the k label
    { rule: "M12-k", name: "k at 2.0 is labelled 2x", check: () => eq(kMultiple([{ unit: "c1", base: 0.8, x2: 0.4 }]).label, "2x", "label") },
    { rule: "M12-k", name: "k at 1.6 and 2.7 is labelled 2x, at 1.5686 and 2.7586 by its measured k", check: () => eq([0.5, 0.3, 0.51, 0.29].map((x, i) => kMultiple([{ unit: "c", base: i === 1 ? 0.81 : 0.8, x2: x }]).label), ["2x", "2x", "k 1.5686", "k 2.7586"], "labels") },
    { rule: "M12-k", name: "k reads infinite when the 2x none A is 0 and is labelled by it", check: () => { const k = kMultiple([{ unit: "c1", base: 0.5, x2: 0 }, { unit: "c2", base: 0.4, x2: 0 }]); return all(eq(k.k, Infinity, "k"), eq(k.label, "k infinite", "label")); } },
    { rule: "M12-k", name: "k comes from unrounded A and is rounded once", check: () => eq(q4(kMultiple([{ unit: "c1", base: 0.33335, x2: 0.20005 }]).k), q4(0.33335 / 0.20005), "k") },

    // Section 9: the twin check
    { rule: "S9-twin", name: "six matching pairs track", check: () => eq(tracking().tracks, true, "tracks") },
    { rule: "S9-twin", name: "a pair without 3 scored passes drops and is named; 5 pairs left read NO READ (twin)", check: () => { const ps = sixPairs(() => [[0.4, 0.6, 0.4], [0.6, 0.4, 0.4]]); ps[2] = { ...ps[2]!, second: [ps[2]!.second[0]!, ps[2]!.second[1]!, cell("p3-2", "none", 3, null, { state: "infra-missing" })] }; const r = twinCheck(ps); return all(eq(r.tracks, false, "tracks"), eq(r.code, "E_DC_TWIN", "code"), eq(r.dropped.map((d) => d.pair), ["p3"], "dropped")); } },
    { rule: "S9-twin", name: "test (a): an interval wholly above 0.10 doesn't track", check: () => { const r = twinCheck(sixPairs(() => [[0.8, 0.8, 0.8], [0.4, 0.4, 0.4]])); return all(eq(r.tracks, false, "tracks"), r.fails.some((f) => f.startsWith("(a)")) ? null : "test (a) didn't fire"); } },
    { rule: "S9-twin", name: "test (a): an interval at exactly 0.10 is not wholly outside", check: () => { const r = twinCheck(sixPairs(() => [[0.5, 0.5, 0.5], [0.4, 0.4, 0.4]])); return r.fails.some((f) => f.startsWith("(a)")) ? "test (a) fired at 0.10" : null; } },
    { rule: "S9-twin", name: "test (b): a mean absolute difference above the re-split 95th percentile doesn't track", check: () => { const r = twinCheck(sixPairs((n) => (n % 2 ? [[1, 1, 1], [0, 0, 0]] : [[0, 0, 0], [1, 1, 1]]))); return all(eq(r.tracks, false, "tracks"), r.fails.some((f) => f.startsWith("(a)")) ? "test (a) fired" : null, r.fails.some((f) => f.startsWith("(b)")) ? null : "test (b) didn't fire"); } },

    // Section 9: the read order
    { rule: "S9-order", name: "the twin check fires first, before a failing judge", check: () => eq(reads(stage1Reading(s1({ twin: twinCheck(sixPairs(() => [[0.8, 0.8, 0.8], [0.4, 0.4, 0.4]])), opusJudge: { kappa: 0.2, goldShort: false } }))), "NO READ (twin)", "reading") },
    { rule: "S9-order", name: "the Opus judge at kappa 0.59 reads NO READ (judge), at 0.60 doesn't", check: () => eq([0.59, 0.6].map((k) => reads(stage1Reading(s1({ opusJudge: { kappa: k, goldShort: false } })))), ["NO READ (judge)", "HEADROOM base"], "readings") },
    { rule: "S9-order", name: "a gold shortfall reads NO READ (judge) whatever A is, never FLOOR", check: () => eq(reads(stage1Reading(s1({ opusJudge: { kappa: 0.9, goldShort: true }, base: { none: 0.05, reference: 0.1 } }))), "NO READ (judge)", "reading") },
    { rule: "S9-order", name: "STOCK FAIL on Opus lists comes before the parse rate", check: () => { const r = stage1Reading(s1({ stockFailOpus: true, opusNoneParse: { parsed: 1, replies: 48 } })); return all(eq(reads(r), "STOCK FAIL", "reading"), eq(r.ends && r.code, "E_DC_STOCK_FAIL", "code")); } },
    { rule: "S9-order", name: "the parse rate at 95 of 100 passes and 94 of 100 reads NO READ (parse)", check: () => eq([95, 94].map((p) => reads(stage1Reading(s1({ opusNoneParse: { parsed: p, replies: 100 } })))), ["HEADROOM base", "NO READ (parse)"], "readings") },

    // Section 9: the tier chain, base tier
    { rule: "S9-tier", name: "base none A 0.65 is HEADROOM and 0.66 is CEILING", check: () => eq([0.65, 0.66].map((n) => reads(stage1Reading(s1({ base: { none: n, reference: 0.85 }, x2: x2() })))), ["HEADROOM base", "HEADROOM 2x"], "readings") },
    { rule: "S9-tier", name: "base reference 0.29 is FLOOR and 0.30 is HEADROOM", check: () => eq([0.29, 0.3].map((r) => reads(stage1Reading(s1({ base: { none: 0.1, reference: r } })))), ["FLOOR", "HEADROOM base"], "readings") },
    { rule: "S9-tier", name: "base room 0.14 is NO ROOM and 0.15 is HEADROOM", check: () => eq([0.64, 0.65].map((r) => reads(stage1Reading(s1({ base: { none: 0.5, reference: r } })))), ["NO ROOM", "HEADROOM base"], "readings") },
    { rule: "S9-tier", name: "a ceiling with little room reads CEILING (base none 0.66, reference 0.80)", check: () => { const r = stage1Reading(s1({ base: ceilingBase, x2: x2() })); return all(eq(reads(r), "HEADROOM 2x", "reading"), r.lines.some((l) => l.startsWith("base tier: CEILING")) ? null : "no CEILING line"); } },
    { rule: "S9-tier", name: "FLOOR wins over a failing (a): reference 0.20 with none 0.70", check: () => eq(reads(stage1Reading(s1({ base: { none: 0.7, reference: 0.2 } }))), "FLOOR", "reading") },
    { rule: "S9-tier", name: "base none A under 0.10 prints and stops nothing", check: () => { const r = stage1Reading(s1({ base: { none: 0.05, reference: 0.4 } })); return all(eq(reads(r), "HEADROOM base", "reading"), r.lines.some((l) => l.includes("under 0.10; it prints and stops nothing")) ? null : "no print"); } },
    { rule: "S9-tier", name: "when the base tier admits, the 2x reads print as leads", check: () => stage1Reading(s1({ x2: x2() })).lines.some((l) => l.startsWith("lead (2x, descriptive)")) ? null : "no lead line" },

    // Section 9: the 2x tier
    { rule: "S9-tier", name: "2x none A 0.60 admits and 0.61 is CEILING", check: () => eq([0.6, 0.61].map((n) => reads(stage1Reading(s1({ base: ceilingBase, x2: x2({ none: n, reference: 0.9 }), x10: x10() })))), ["HEADROOM 2x", "HEADROOM 10x"], "readings") },
    { rule: "S9-tier", name: "2x none A 0.61 with the reference at 0.75 reads CEILING", check: () => { const r = stage1Reading(s1({ base: ceilingBase, x2: x2({ none: 0.61, reference: 0.75 }), x10: x10() })); return r.lines.some((l) => l.startsWith("2x tier: CEILING")) ? null : "no 2x CEILING"; } },
    { rule: "S9-tier", name: "2x reference 0.29 ends the chain named (b), 0.30 admits", check: () => eq([0.29, 0.3].map((r) => reads(stage1Reading(s1({ base: ceilingBase, x2: x2({ none: 0.1, reference: r }) })))), ["FIX-METHOD (2x (b))", "HEADROOM 2x"], "readings") },
    { rule: "S9-tier", name: "2x room 0.14 with (a) passing ends the chain named (c); with (a) failing (c) isn't read", check: () => eq([reads(stage1Reading(s1({ base: ceilingBase, x2: x2({ none: 0.5, reference: 0.64 }) }))), reads(stage1Reading(s1({ base: ceilingBase, x2: x2({ none: 0.61, reference: 0.7 }), x10: x10() })))], ["FIX-METHOD (2x (c))", "HEADROOM 10x"], "readings") },
    { rule: "S9-tier", name: "11 calibration units with a 2x version end the chain named (d), 12 admit", check: () => eq([11, 12].map((u) => reads(stage1Reading(s1({ base: ceilingBase, x2: x2({ units: u }) })))), ["FIX-METHOD (2x (d))", "HEADROOM 2x"], "readings") },
    { rule: "S9-tier", name: "the budget anchor fails at 0.79 and 1.26 and holds at 0.80 and 1.25", check: () => eq([0.79, 0.8, 1.25, 1.26].map((c) => reads(stage1Reading(s1({ base: ceilingBase, x2: x2({ costBase: [1, 1, 1], cost2x: [c, c, 9] }) })))), ["FIX-METHOD (2x (e))", "HEADROOM 2x", "HEADROOM 2x", "FIX-METHOD (2x (e))"], "readings") },
    { rule: "S9-tier", name: "a 2x tier failing (b) and (d) names both", check: () => { const r = stage1Reading(s1({ base: ceilingBase, x2: x2({ none: 0.61, reference: 0.2, units: 10 }) })); return eq(reads(r), "FIX-METHOD (2x (b) (d))", "reading"); } },
    { rule: "S9-tier", name: "the 2x tier's label is its k: 2x inside 1.6 to 2.7, the measured k outside", check: () => { const a = stage1Reading(s1({ base: ceilingBase, x2: x2() })); const b = stage1Reading(s1({ base: ceilingBase, x2: x2({ kUnits: [{ unit: "c1", base: 0.8, x2: 0 }] }) })); return eq([!a.ends && a.label, !b.ends && b.label], ["2x", "k infinite"], "labels"); } },

    // Section 9: the 10x tier
    { rule: "S9-tier", name: "10x none G 0.24 fails on task fit, 0.25 and 0.50 admit, 0.51 reads saturation", check: () => eq([0.24, 0.25, 0.5, 0.51].map((g) => reads(stage1Reading(s1({ base: ceilingBase, x2: x2({ none: 0.7, reference: 0.9 }), x10: x10({ noneG: g, noneD: 0.1, referenceG: 0.9 }) })))), ["FIX-METHOD (10x)", "HEADROOM 10x", "HEADROOM 10x", "saturation"], "readings") },
    { rule: "S9-tier", name: "10x saturation carries its frozen wording and reads FIX-METHOD, never a cut", check: () => { const r = stage1Reading(s1({ base: ceilingBase, x2: x2({ none: 0.7, reference: 0.9 }), x10: x10({ noneG: 0.6 }) })); return all(eq(r.ends && r.r48, "FIX-METHOD", "r48"), r.ends && r.why.includes(SATURATION_WORDING) ? null : "no wording"); } },
    { rule: "S9-tier", name: "10x D 0.20 admits and 0.21 reads saturation (detail)", check: () => eq([0.2, 0.21].map((d) => reads(stage1Reading(s1({ base: ceilingBase, x2: x2({ none: 0.7, reference: 0.9 }), x10: x10({ noneD: d }) })))), ["HEADROOM 10x", "saturation (detail)"], "readings") },
    { rule: "S9-tier", name: "Astra's detail check at kappa 0.59 or short reads NO READ (judge), at 0.60 admits", check: () => eq([{ kappa: 0.59, goldShort: false }, { kappa: 0.9, goldShort: true }, { kappa: 0.6, goldShort: false }].map((c) => reads(stage1Reading(s1({ base: ceilingBase, x2: x2({ none: 0.7, reference: 0.9 }), x10: x10({ detailCheck: c }) })))), ["NO READ (judge)", "NO READ (judge)", "HEADROOM 10x"], "readings") },
    { rule: "S9-tier", name: "10x room 0.14 and 11 detail-keyed units each end on task fit", check: () => eq([x10({ referenceG: 0.54 }), x10({ detailUnits: 11 })].map((t) => { const r = stage1Reading(s1({ base: ceilingBase, x2: x2({ none: 0.7, reference: 0.9 }), x10: t })); return r.ends ? r.kind : "admits"; }), ["task fit", "task fit"], "kinds") },

    // Section 9: the smoke rules
    { rule: "S9-smoke", name: "parse and exposure at 5 of 6 pass, at 4 of 6 call the repair", check: () => eq([smoke(5, 5), smoke(4, 6), smoke(6, 4)].map((s) => smokeDecision("autoplan", "sol", s).outcome), ["pass", "repair", "repair"], "outcomes") },
    { rule: "S9-smoke", name: "a re-smoke that passes runs with an enforced procedure", check: () => { const d = smokeDecision("plan-design-review", "opus", smoke(6, 4), smoke(6, 5)); return all(eq(d.outcome, "enforced", "outcome"), eq(d.label, ENFORCED_LABEL, "label")); } },
    { rule: "S9-smoke", name: "a re-smoke that fails drops the arm for that model, untested, at Holm p = 1", check: () => { const d = smokeDecision("plan-design-review", "opus", smoke(6, 4), smoke(6, 4)); return all(eq([d.outcome, d.code, d.holmP1, d.untested], ["dropped", "E_DC_SMOKE_DROP", true, ["exposure"]], "decision")); } },
    { rule: "S9-smoke", name: "the standing smoke's mean cost replaces the planning figure", check: () => eq([smokeDecision("autoplan", "opus", smoke(6, 6, 2.2)).meanUsd, smokeDecision("autoplan", "opus", smoke(3, 6, 2.2), smoke(6, 6, 3.1)).meanUsd].map(q4), [22000, 31000], "mean cost") },
    { rule: "S9-smoke", name: "lens parse: 45 of 48 on Opus fails and 46 passes; 15 of 16 on Sol fails and 16 passes", check: () => eq([lensParse("opus", 45).pass, lensParse("opus", 46).pass, lensParse("sol", 15).pass, lensParse("particle", 16).pass], [false, true, false, true], "lens parse") },
    { rule: "S9-smoke", name: "a smoke that isn't 6 sessions is refused", check: () => expectCode(() => smokeDecision("autoplan", "opus", smoke(5, 5).slice(0, 5)), "E_USAGE") },

    // Section 10: the interim exposure stop
    { rule: "S10-interim", name: "after 24 Opus sessions, 16 exposed (0.6667) stops and 17 (0.7083) goes on", check: () => { const s = (k: number) => Array.from({ length: 30 }, (_, i) => ({ exposed: i < k })); return eq([interimStop("opus", s(16)).code, interimStop("opus", s(17)).code], ["E_DC_EXPOSURE_STOP", null], "codes"); } },
    { rule: "S10-interim", name: "fewer than 24 sessions isn't ready; sessions after the 24th don't count", check: () => eq([interimStop("opus", Array(23).fill({ exposed: false })).ready, interimStop("opus", [...Array(24).fill({ exposed: true }), ...Array(20).fill({ exposed: false })]).stop], [false, false], "interim") },

    // Section 10: contrasts, unit means and clusters (M13)
    { rule: "M13", name: "a unit with one arm pass and two none passes pairs the two means", check: () => { const c = contrast({ cells: [cell("u1", "plan-design-review", 1, 0.6), cell("u1", "none", 1, 0.2), cell("u1", "none", 2, 0.4), cell("u2", "plan-design-review", 1, 0.5), cell("u2", "none", 1, 0.2)], model: "opus", b: "plan-design-review", a: "none", tier: "base", baseAppOf: new Map([["u1", "x"], ["u2", "y"]]) }); return eq(q4(c.delta), 3000, "delta"); } },
    { rule: "M13", name: "a unit with no scored pass in one arm leaves the contrast", check: () => { const c = contrast({ cells: [cell("u1", "plan-design-review", 1, 0.6), cell("u1", "none", 1, 0.2), cell("u2", "plan-design-review", 1, null, { state: "infra-missing" }), cell("u2", "none", 1, 0.2), cell("u3", "plan-design-review", 1, 0.4), cell("u3", "none", 1, 0.3)], model: "opus", b: "plan-design-review", a: "none", tier: "base", baseAppOf: new Map([["u1", "x"], ["u2", "y"], ["u3", "y"]]) }); return all(eq(c.units, 2, "units"), eq(c.unpaired, ["u2"], "unpaired")); } },
    { rule: "M13", name: "several units per base app flip together through the real entry point", check: () => { const cells = grid(["u1", "u2", "u3", "u4"].map((u) => ({ unit: u, values: { "plan-design-review": [0.7], none: [0.2] } }))); const byApp = contrast({ cells, model: "opus", b: "plan-design-review", a: "none", tier: "base", baseAppOf: new Map([["u1", "x"], ["u2", "x"], ["u3", "y"], ["u4", "y"]]) }); const byUnit = contrast({ cells, model: "opus", b: "plan-design-review", a: "none", tier: "base", baseAppOf: new Map(["u1", "u2", "u3", "u4"].map((u) => [u, u])) }); return eq([byApp.clusters, byApp.p, byUnit.clusters, byUnit.p, byApp.pMethod], [2, 0.5, 4, 0.125, "exact-sign-flip"], "clusters and p"); } },
    { rule: "M13", name: "every contrast entry point refuses a missing map or a unit with no base app", check: () => all(expectCode(() => contrast({ cells: [cell("u1", "lens", 1, 0.5), cell("u1", "none", 1, 0.2)], model: "opus", b: "lens", a: "none", tier: "base", baseAppOf: undefined as unknown as Map<string, string> }), "E_USAGE"), expectCode(() => contrast({ cells: [cell("u1", "lens", 1, 0.5), cell("u1", "none", 1, 0.2)], model: "opus", b: "lens", a: "none", tier: "base", baseAppOf: new Map() }), "E_USAGE"), expectCode(() => primaries({ cells: [cell("u1", "autoplan", 1, 0.5), cell("u1", "none", 1, 0.2)], model: "opus", tier: "base", baseAppOf: null as unknown as Map<string, string> }, []), "E_USAGE")) },
    { rule: "M13", name: "missing counts against planned cells, with unequal planned counts per arm", check: () => { const cs = [cell("u1", "none", 1, 0.2), cell("u1", "none", 2, 0.2), cell("u2", "none", 1, null, { state: "web-contaminated" }), cell("u1", "autoplan", 1, 0.4)]; return eq([missingShare(cs, "opus", "none", 4, "base"), missingShare(cs, "opus", "autoplan", 2, "base")], [0.5, 0.5], "missing"); } },
    { rule: "PD-7", name: "the 10x primary and specificity read G with the partner's details; the base reads A", check: () => { const cells = [cell("u1", "autoplan", 1, 0.6, { g: 0.5, shuffledA: 0.1, shuffledG: 0.2 }), cell("u1", "none", 1, 0.2, { g: 0.3, shuffledA: 0.1, shuffledG: 0.05 }), cell("u2", "autoplan", 1, 0.6, { g: 0.5, shuffledA: 0.1, shuffledG: 0.2 }), cell("u2", "none", 1, 0.2, { g: 0.3, shuffledA: 0.1, shuffledG: 0.05 })]; const map = new Map([["u1", "x"], ["u2", "y"]]); const g = contrast({ cells, model: "opus", b: "autoplan", a: "none", tier: "10x", baseAppOf: map }); const a = contrast({ cells, model: "opus", b: "autoplan", a: "none", tier: "base", baseAppOf: map }); return eq([g.measure, q4(g.delta), q4(g.specificity!.delta), a.measure, q4(a.delta), q4(a.specificity!.delta)], ["G", 2000, 500, "A", 4000, 4000], "reads"); } },

    // Section 10: Holm with a dropped arm
    { rule: "S10-holm", name: "an arm dropped at smoke enters Holm at p = 1", check: () => { const cells = grid(Array.from({ length: 8 }, (_, i) => ({ unit: "u" + i, values: { "plan-design-review": [0.6 + i / 100], none: [0.2] } }))); const map = new Map(cells.map((c) => [c.unit, "app" + (Number(c.unit.slice(1)) % 4)])); const p = primaries({ cells, model: "opus", tier: "base", baseAppOf: map }, []); return all(eq(p.autoplan.contrast, null, "autoplan contrast"), eq(p.autoplan.pIn, 1, "autoplan p"), eq(p["plan-design-review"].holm, Math.min(1, p["plan-design-review"].pIn * 2), "Holm")); } },
    { rule: "S10-holm", name: "an interim-stopped arm prints its partial contrast and enters Holm at p = 1", check: () => { const cells = grid(Array.from({ length: 8 }, (_, i) => ({ unit: "u" + i, values: { "plan-design-review": [0.6], autoplan: [0.7 + i / 100], none: [0.2 + i / 200] } }))); const map = new Map(cells.map((c) => [c.unit, "app" + (Number(c.unit.slice(1)) % 4)])); const p = primaries({ cells, model: "opus", tier: "base", baseAppOf: map }, ["autoplan"]); return all(p.autoplan.contrast ? null : "no partial contrast", eq(p.autoplan.pIn, 1, "p in"), eq(p.autoplan.holm, 1, "Holm")); } },

    // Section 10: the verdict precedence, step by step
    { rule: "S10-precedence", name: "step 5: Holm, the interval and specificity read helps, and the mirror reads hurts", check: () => eq([verdict(vin()).verdict, verdict(vin({ primary: primaryOf([-0.2, -0.05], 0.01, [-0.1, -0.01]) })).verdict], ["helps", "hurts"], "verdicts") },
    { rule: "S10-precedence", name: "step 1: stage 1 ending the eval decides every contrast", check: () => eq(verdict(vin({ stage1: stage1Reading(s1({ base: { none: 0.4, reference: 0.2 } })) })).step, 1, "step") },
    { rule: "S10-precedence", name: "step 2: a cap refusal or a provider change in otherwise significant data reads incomplete, never helps", check: () => eq([verdict(vin({ incomplete: "a cap stop on dc-stage2-opus" })).verdict, verdict(vin({ incomplete: "E_DC_PROVIDER_DRIFT" })).verdict], ["incomplete", "incomplete"], "verdicts") },
    { rule: "S10-precedence", name: "step 3: an arm dropped at smoke reads untested (exposure), repair tried", check: () => { const v = verdict(vin({ smoke: smokeDecision("plan-design-review", "opus", smoke(6, 4), smoke(6, 3)) })); return all(eq([v.step, v.verdict, v.untested], [3, "untested", ["exposure"]], "verdict")); } },
    { rule: "S10-precedence", name: "step 4: two untested conditions at once are both named", check: () => eq(verdict(untested({ judgeOk: false, missing: { arm: 0.11, none: 0 } })).untested, ["judge", "coverage"], "conditions") },
    { rule: "S10-precedence", name: "step 4: exposure 0.79 is untested and 0.80 isn't; the interim stop is untested (exposure)", check: () => eq([verdict(untested({ exposure: 0.79 })).verdict, verdict(untested({ exposure: 0.8 })).verdict, verdict(untested({ interimStopped: true })).untested], ["untested", "helps", ["exposure"]], "verdicts") },
    { rule: "S10-precedence", name: "step 4: missing at 10% passes and 11% in one arm is untested (coverage)", check: () => eq([verdict(untested({ missing: { arm: 0.1, none: 0.1 } })).verdict, verdict(untested({ missing: { arm: 0, none: 0.11 } })).untested], ["helps", ["coverage"]], "verdicts") },
    { rule: "S10-precedence", name: "step 4: contamination at 5% passes and just over is untested (contamination)", check: () => eq([verdict(untested({ contamination: 0.05 })).verdict, verdict(untested({ contamination: 0.0501 })).untested], ["helps", ["contamination"]], "verdicts") },
    { rule: "S10-precedence", name: "step 4: stock reads untested (stock)", check: () => eq(verdict(untested({ stockFail: true })).untested, ["stock"], "conditions") },
    { rule: "S10-precedence", name: "step 6: an interval excluding zero that fails Holm reads not shown, naming Holm", check: () => { const v = verdict(vin({ primary: primaryOf([0.05, 0.2], 0.06, [0.01, 0.1]) })); return all(eq(v.verdict, "not shown", "verdict"), v.why.includes("Holm p") ? null : "Holm not named"); } },
    { rule: "S10-precedence", name: "step 6: passing Holm but failing the specificity contrast reads not shown", check: () => { const v = verdict(vin({ primary: primaryOf([0.05, 0.2], 0.01, [-0.01, 0.05]) })); return all(eq(v.verdict, "not shown", "verdict"), v.why.includes("specificity") ? null : "specificity not named"); } },
    { rule: "S10-precedence", name: "step 5: helps on a contrast whose upper bound is under +0.05 reads helps", check: () => eq(verdict(vin({ primary: primaryOf([0.01, 0.04], 0.01, [0.005, 0.04]) })).verdict, "helps", "verdict") },
    { rule: "S10-precedence", name: "step 7: an interval including zero reads no measurable difference with its MDD", check: () => { const v = verdict(vin({ primary: primaryOf([-0.01, 0.1], 0.2, null) })); return all(eq(v.verdict, "no measurable difference", "verdict"), v.why.includes("MDD 0.0800") ? null : "no MDD"); } },
    { rule: "S10-judge", name: "Opus's detail check short at stage 1 leaves Sol's and particle-1's 10x contrasts untested (judge), not Opus's", check: () => { const j = judges({ opusDetail: 0.5 }); return eq([judgeOk("opus", "10x", j), judgeOk("sol", "10x", j), judgeOk("particle", "10x", j), judgeOk("sol", "base", j)], [true, false, false, true], "judge ok"); } },
    { rule: "S10-judge", name: "Opus short at the stage 2 re-check leaves Sol untested (judge); the panel fails when one member fails", check: () => eq([judgeOk("sol", "base", judges({ opusRecheck: 0.59 })), judgeOk("sol", "base", judges({ opusRecheck: 0.6 })), judgeOk("particle", "base", judges({ argon: 0.59 }))], [false, true, false], "judge ok") },

    // Section 10: the reading rule
    { rule: "S10-reading", name: "KEEP carries the frozen wording and is flagged, not changed, by a pairwise loss", check: () => { const r = readingRule({ arm: "plan-design-review", model: "opus", armNone: verdict(vin()), armNoneCi: [0.05, 0.2], armLensCi: [0.01, 0.1], lensNone: "no measurable difference", pairwiseLosing: true, stage3Fewer: false }); return all(eq([r.r48, r.beyondRole, r.flagged.length], ["KEEP", true, 1], "reading"), r.lines[0]!.includes(KEEP_WORDING) ? null : "no wording"); } },
    { rule: "S10-reading", name: "the framing carries it at a skill-minus-lens upper bound of 0.049 and not at 0.050", check: () => eq([0.049, 0.05].map((u) => readingRule({ arm: "autoplan", model: "opus", armNone: verdict(vin()), armNoneCi: [0.05, 0.2], armLensCi: [-0.02, u], lensNone: "helps", pairwiseLosing: false, stage3Fewer: false }).framing), ["carries it", "carries part"], "framing") },
    { rule: "S10-reading", name: "none 0.20, lens 0.35 and skill 0.60 read framing carries part through the real contrasts", check: () => {
      const spec = Array.from({ length: 16 }, (_, i) => ({ unit: "u" + i, values: { none: [0.2 + ((i % 3) - 1) / 100], lens: [0.35 + ((i % 2) - 0.5) / 50], "plan-design-review": [0.6 + ((i % 4) - 1.5) / 100] } }));
      const cells = grid(spec);
      const map = new Map(spec.map((u, i) => [u.unit, "app" + (i % 8)]));
      const p = primaries({ cells, model: "opus", tier: "base", baseAppOf: map }, ["autoplan"]);
      const lens = contrast({ cells, model: "opus", b: "lens", a: "none", tier: "base", baseAppOf: map });
      const armLens = contrast({ cells, model: "opus", b: "plan-design-review", a: "lens", tier: "base", baseAppOf: map });
      const lensV = verdict(vin({ primary: { arm: "plan-design-review", contrast: lens, pIn: lens.p, holm: lens.p } }));
      const armV = verdict(vin({ primary: p["plan-design-review"] }));
      const r = readingRule({ arm: "plan-design-review", model: "opus", armNone: armV, armNoneCi: p["plan-design-review"].contrast!.ci95, armLensCi: armLens.ci95, lensNone: lensV.verdict, pairwiseLosing: false, stage3Fewer: false });
      return all(eq([armV.verdict, lensV.verdict, r.r48, r.framing, r.beyondRole], ["helps", "helps", "KEEP", "carries part", true], "reading"));
    } },
    { rule: "S10-reading", name: "a null on Opus prints the trim lead at an upper bound of 0.049 and not at 0.050", check: () => eq([0.049, 0.05].map((u) => { const v = verdict(vin({ primary: primaryOf([-0.03, u], 0.4, null) })); return readingRule({ arm: "plan-design-review", model: "opus", armNone: v, armNoneCi: [-0.03, u], armLensCi: [-0.05, 0.03], lensNone: "no measurable difference", pairwiseLosing: false, stage3Fewer: false }).trimLead; }), [true, false], "trim lead") },
    { rule: "S10-reading", name: "every reading but KEEP is FIX-METHOD of the kind its precedence names", check: () => { const k = (v: VerdictInput) => readingRule({ arm: "autoplan", model: "sol", armNone: verdict(v), armNoneCi: null, armLensCi: null, lensNone: "no measurable difference", pairwiseLosing: false, stage3Fewer: false }); return eq([k(untested({ exposure: 0.5 })).kinds, k(untested({ judgeOk: false })).kinds, k(vin({ stage1: stage1Reading(s1({ base: ceilingBase, x2: x2({ none: 0.7, reference: 0.9 }), x10: x10({ noneG: 0.6 }) })) })).kinds, k(vin({ primary: primaryOf([0.05, 0.2], 0.06, [0.01, 0.1]) })).r48], [["exposure"], ["instrument"], ["saturation"], "FIX-METHOD"], "kinds"); } },

    // Section 12: the admission read through power.py's design mode
    { rule: "S12-power", name: "the read passes at power 0.800 and fails at 0.799", check: () => withTemp((dir) => { const d = buildDesign(designUnits(64, 16), { p0Measured: 0.2, passesArm: 2, passesNone: 2 }); return eq([admissionRead(d, { dir, run: fakeRunner("0.800", "pass") }).pass, admissionRead(d, { dir, run: fakeRunner("0.799", "fail") }).pass], [true, false], "pass"); }) },
    { rule: "S12-power", name: "design.json holds only base-app digests and counts, with uneven passes and an app of three", check: () => withTemp((dir) => { const seen = { calls: 0 } as { design?: DesignJson; calls: number }; const units = [...designUnits(4, 1), ...designUnits(3, 1).map((u) => ({ ...u, unit: u.unit + "b", baseApp: "app-b" }))]; admissionRead(buildDesign(units, { p0Measured: 0.3, passesArm: 1, passesNone: 2 }), { dir, run: fakeRunner("0.850", "pass", "0.10", seen) }); const d = seen.design!; return all(eq(Object.keys(d).sort(), ["p0", "passes_arm", "passes_none", "rho", "units"], "keys"), eq(d.units.every((u) => /^[0-9a-f]{64}$/.test(u.repo)), true, "digests"), eq(new Set(d.units.map((u) => u.repo)).size, 2, "apps"), eq([d.passes_arm, d.passes_none], [1, 2], "passes")); }) },
    { rule: "S12-power", name: "the wrapper refuses an empty design, a unit with no base app or items, and passes below 1, before power.py runs", check: () => withTemp((dir) => { const seen = { calls: 0 }; const run = fakeRunner("0.9", "pass", "0.08", seen); const good = buildDesign(designUnits(8, 2), { p0Measured: 0.2, passesArm: 2, passesNone: 2 }); const bad: unknown[] = [{ ...good, units: [] }, { ...good, units: [{ repo: "", items: 4 }] }, { ...good, units: [{ repo: "a".repeat(64) }] }, { ...good, passes_arm: 0 }, { ...good, passes_none: 0.5 }]; return all(...bad.map((d) => expectCode(() => admissionRead(d as DesignJson, { dir, run }), "E_USAGE")), eq(seen.calls, 0, "power.py calls")); }) },
    { rule: "S12-power", name: "a measured p0 of 0 and of 0.04 each run at 0.05", check: () => eq([0, 0.04, 0.0512].map((p) => buildDesign(designUnits(8, 2), { p0Measured: p, passesArm: 2, passesNone: 2 }).p0), [0.05, 0.05, 0.0512], "p0") },
    { rule: "S12-power", name: "a power.py whose bytes differ from the pin is refused", check: () => withTemp((dir) => { const copy = join(dir, "power.py"); copyFileSync(POWER_PY, copy); writeFileSync(copy, readFileSync(copy, "utf8") + "\n# changed\n"); return expectCode(() => admissionRead(buildDesign(designUnits(8, 2), { p0Measured: 0.2, passesArm: 2, passesNone: 2 }), { dir, run: fakeRunner("0.9", "pass"), script: copy }), "E_DCV_POWER_PY_PIN"); }) },
    { rule: "S12-power", name: "the pinned power.py is the one beside the prereg", check: () => eq(createHash("sha256").update(readFileSync(POWER_PY)).digest("hex").slice(0, 12), "09636859375f", "sha256") },

    // Section 13: the projection rerun, the cut order and the $5,000 stop
    {
      rule: "PD-14",
      name: "crew spend up to $700 never counts against the $3,999 line, and past $700 it does; the $5,000 stop reads every dollar",
      check: () => {
        const at = (crewUsd: number) => {
          const i = planningInputs();
          const nonCrew = project(i, plannedDesign()).allInUsd - (i.otherUsd.crew ?? 0);
          i.otherUsd["dc-authoring-2"] = (i.otherUsd["dc-authoring-2"] ?? 0) + (MONEY.capAllInUsd - CREW_DEVIATION.frozenCapUsd) - nonCrew;
          i.otherUsd.crew = crewUsd;
          const p = project(i, plannedDesign());
          return [p.fits, Math.round(p.allInUsd)];
        };
        return all(eq([at(470), at(699.99), at(700.5)], [[true, 3999], [true, 4229], [false, 4230]], "fits and all-in"), eq([CREW_DEVIATION.capUsd, LEDGER_ITEMS.crew.capUsd], [700, 470], "caps"));
      },
    },
    { rule: "S13-projection", name: "the planning lines print the all-in at the planning figures, $3357.20, beside the frozen projections' $3357.00, and name only the three stage 2 runs items that differ", check: () => { const l = planningLines(); return all(l[0]!.startsWith("planning projection: all-in $3357.20 ") && l[0]!.endsWith(" sum to $3357.00") ? null : "line " + l[0], eq(l.filter((x) => / against its frozen /.test(x)).map((x) => x.split(" ")[2]), ["dc-stage2-opus", "dc-stage2-sol", "dc-stage2-particle"], "items")); } },
    { rule: "S13-projection", name: "the planning figures fit with no cut and no re-pricing", check: () => { const o = projectionRerun(planningInputs()); return all(eq([o.outcome, o.cuts.length, o.repriced.length], ["fits", 0, 0], "outcome"), above(o.projection.allInUsd, 3300) && atMost(o.projection.allInUsd, 3400) ? null : "all-in " + o.projection.allInUsd); } },
    { rule: "PD-30", name: "an Opus overrun past plan cuts nothing: dc-stage2-opus is re-priced to its measured need as a recorded deviation", check: () => { const o = projectionRerun(planningInputs(3)); const r = o.repriced[0]; return all(eq([o.outcome, o.cuts, o.design.stage3Units, o.design.passes.sol.lens, o.design.units, o.repriced.map((x) => x.item)], ["fits", [], 16, 1, 64, ["dc-stage2-opus"]], "outcome"), r && r.repricedCapUsd >= r.needUsd && r.needUsd > r.frozenCapUsd && o.lines.some((l) => l.includes("pre-data deviation")) ? null : "re-pricing " + JSON.stringify(o.repriced)); } },
    { rule: "PD-30", name: "an all-in projection over the $3,999 line and within $5,000 cuts nothing", check: () => { const o = projectionRerun(planningInputs(8)); return all(eq([o.outcome, o.cuts.length, o.design.units, o.design.passes.opus.autoplan], ["fits", 0, 64, 2], "outcome"), above(o.projection.allInUsd, 3999) ? null : "all-in " + o.projection.allInUsd); } },
    { rule: "PD-30", name: "a re-priced projection past $5,000 stops for the Captain, with section 13's cuts in the frozen order as the design put to the Captain", check: () => { const o = projectionRerun(planningInputs(2.5, 1700)); return all(eq([o.outcome, o.outcome === "captain" && o.why, o.cuts[0], o.design.passes.particle.lens], ["captain", "envelope", MONEY.cutOrder[0], 1], "outcome"), o.lines.some((l) => l.includes("stop for the Captain")) ? null : "lines " + o.lines.join(" | ")); } },
    { rule: "S13-projection", name: "a projection at $5,000.00 doesn't trip the envelope stop and $5,000.01 does", check: () => { const base = projectionRerun(planningInputs()).projection.allInUsd; const at = (usd: number) => { const o = projectionRerun(planningInputs(2.5, usd - base)); return o.outcome === "captain" ? o.why : o.outcome; }; return eq([at(5000), at(5000.01)], ["fits", "envelope"], "outcomes"); } },
    { rule: "S13-projection", name: "a re-priced design whose measured design fails the admission read doesn't run", check: () => withTemp((dir) => { const o = projectionRerun(planningInputs(3)); const d = buildDesign(designUnits(o.design.units, 14), { p0Measured: 0.2, passesArm: 2, passesNone: 2 }); return eq([cutAdmission(o, admissionRead(d, { dir, run: fakeRunner("0.780", "fail") })).run, cutAdmission(o, admissionRead(d, { dir, run: fakeRunner("0.900", "pass") })).run], [false, true], "run"); }) },
    { rule: "S13-projection", name: "the planned design is 64 units, Opus at 2 passes and the others at 1", check: () => { const d = plannedDesign(); return eq([d.units, d.passes.opus.autoplan, d.passes.sol.lens, d.passes.particle.none, d.stage3Units], [64, 2, 1, 1, 16], "design"); } },

    // Sections 3 and 14: the re-sizing
    { rule: "S3-resize", name: "64, 56 and 47 projected units: the full set, a set of 56, and a supply stop", check: () => { const r = [64, 56, 47].map(resize); return eq(r.map((x) => [x.units, x.code]), [[64, null], [56, null], [null, "E_DC_SUPPLY_SHORT"]], "re-sizing"); } },

    // Start rules 8 and 9
    { rule: "SR8", name: "a Captain go naming office-hours' twin reading starts stage 1, NO READ (twin) included", check: () => eq([startRule8({ go: { recordedAt: day(1), officeHoursReading: "tracks" }, choice: null, pilotPassedAt: day(0), now: day(2) }).start, startRule8({ go: { recordedAt: day(1), officeHoursReading: "NO READ (twin)" }, choice: null, pilotPassedAt: day(0), now: day(2) }).start], [true, true], "start") },
    { rule: "SR8", name: "with no go, stage 1 waits; at 14 days it needs the Captain's choice made after them", check: () => eq([startRule8({ go: null, choice: null, pilotPassedAt: day(0), now: day(13) }).start, startRule8({ go: null, choice: null, pilotPassedAt: day(0), now: day(14) }).start, startRule8({ go: null, choice: { recordedAt: day(10), start: true }, pilotPassedAt: day(0), now: day(15) }).start, startRule8({ go: null, choice: { recordedAt: day(14), start: true }, pilotPassedAt: day(0), now: day(15) }).deviation !== null], [false, false, false, true], "decisions") },
    { rule: "SR8", name: "stage 1 refuses to start without the go, and a go naming no twin reading, with E_DCW_START_RULE (PD-29, section 2 item 1)", check: () => all(expectCode(() => requireStartRule8({ go: null, choice: null, pilotPassedAt: null, now: day(0) }), "E_DCW_START_RULE"), expectCode(() => startRule8({ go: { recordedAt: day(1), officeHoursReading: "pending" as never }, choice: null, pilotPassedAt: day(0), now: day(2) }), "E_DCW_START_RULE")) },
    { rule: "PD-29", name: "section 2 item 1: the $5,000 projection stop's line starts with E_DCV_PROJECTION_STOP, and a fitting projection prints no such line", check: () => { const stop = projectionRerun(planningInputs(2.5, 1700)); const fits = projectionRerun(planningInputs()); return all(stop.lines.some((l) => l.startsWith("E_DCV_PROJECTION_STOP the re-priced projection is past $5,000")) ? null : "lines " + stop.lines.join(" | "), fits.lines.some((l) => l.includes("E_DCV_PROJECTION_STOP")) ? "a fitting projection printed the stop" : null); } },
    { rule: "SR9", name: "a first call under the recorded provider and terms passes", check: () => eq(startRule9(terms, call()).ok, true, "ok") },
    { rule: "PD-20", name: "start rule 9 compares provider names after folding case, spaces and punctuation, prints both raw names, and still stops a real change", check: () => { const folded = startRule9(terms, call({ provider: " " + terms.provider.toUpperCase().split("").join(" ") + "." })); return all(eq(folded.ok, true, "folded ok"), folded.line.includes("recorded as " + terms.provider) ? null : "line " + folded.line, eq(startRule9(terms, call({ provider: terms.provider + "x" })).code, "E_DC_PROVIDER_DRIFT", "real change")); } },
    { rule: "SR9", name: "a provider change, fallbacks, data collection or new terms stop that model in every role", check: () => { const r = [call({ provider: "Azure" }), call({ fallbacks: true }), call({ dataCollection: "allow" }), call({ termsDigest: "t2" })].map((c) => startRule9(terms, c)); return all(eq(r.map((x) => x.code), Array(4).fill("E_DC_PROVIDER_DRIFT"), "codes"), eq(r[0]!.roles.length, 7, "roles"), eq(r[0]!.scope?.stops, "model-calls", "scope")); } },

    // Descriptive prints
    { rule: "M14", name: "PD-1's effect counts a credit a tie-break decided, beside the funnel", check: () => { const it = (id: string, ch: number[]): MatchItem => ({ id, keyedDetail: false, edges: ch.map((change) => ({ change, detail: false })) }); const tied = [it("i1", [3]), it("i2", [3]), it("i3", [5])]; const lines = pd1Effect([{ step: "step 5", classOf: { i1: "S", i2: "H", i3: "A" }, items: tied }, { step: "base", classOf: { i1: "S" }, items: [it("i1", [1])] }], { "step 5": { H: 2 } }); return all(eq(tieDecided(tied), ["i1"], "tie-decided"), eq(lines.find((l) => l.startsWith("PD-1 effect, step 5, class S")), "PD-1 effect, step 5, class S: 1 credits, 1 decided by a tie-break; removed by the check: 0", "S line"), eq(lines.find((l) => l.startsWith("PD-1 effect, step 5, class H")), "PD-1 effect, step 5, class H: 0 credits, 0 decided by a tie-break; removed by the check: 2", "H line"), eq(lines.find((l) => l.startsWith("PD-1 effect, base, class S")), "PD-1 effect, base, class S: 1 credits, 0 decided by a tie-break; removed by the check: 0", "base line")); } },
    { rule: "S6-print", name: "the arm stops whose attempt held a block print per arm and model", check: () => eq(armStopsHeldBlock(() => [{ model: "opus", arm: "autoplan", armStops: 3, heldBlock: 2 }]), ["arm stops holding a block, opus autoplan: 2 of 3 (descriptive; decides nothing)"], "lines") },
    { rule: "PD-10-print", name: "a supply stop prints the qualified count under both readings of renders", check: () => eq(rendersOnSupplyStop({ strict: 14, http200: 17 }, 16), "supply stop: 14 base apps qualify under the strict reading of renders and 17 under the HTTP 200 reading; 16 are needed", "line") },
    { rule: "PD-26", name: "the union sensitivity read swaps in each cell's union A, counts split cells per arm and leaves the primary contrast as it was", check: () => {
      const cells = ["u1", "u2", "u3"].flatMap((u, k) => [{ ...cell(u, "autoplan", 1, 0.4), model: "particle" as const, split: 1, unionA: 0.6 }, { ...cell(u, "none", 1, 0.2 + k / 100), model: "particle" as const, split: 0, unionA: 0.2 + k / 100 }]);
      const map = new Map(cells.map((c) => [c.unit, "app-" + c.unit]));
      const i = { cells, model: "particle" as const, b: "autoplan" as const, a: "none" as const, tier: "base" as const, baseAppOf: map };
      const s = unionSensitivity(i);
      const plain = contrast(i);
      const none = unionSensitivity({ ...i, cells: cells.map(({ split: _s, unionA: _u, ...c }) => c) });
      return s && Math.abs(s.contrast.delta - (0.6 - 0.21)) < 1e-9 && Math.abs(plain.delta - (0.4 - 0.21)) < 1e-9 && s.split.b === 3 && s.split.a === 0 && none === null ? null : "sensitivity " + JSON.stringify([s?.contrast.delta, plain.delta, s?.split, none]);
    } },
  ];
}


