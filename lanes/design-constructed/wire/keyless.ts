// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless rows: scope (run/scope.ts on every plan.md), score (score/ from final labels), read (the stage 1 and
// stage 2 readings), power (the admission read through power.py, pinned by sha256) and items (money/cli.ts). None calls
// a model, opens a lease or reads a key; each reads files the paid rows wrote and prints counts.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fail } from "../errors.ts";
import { itemsCommand } from "../money/cli.ts";
import { show } from "../read/num.ts";
import { admissionRead, validateDesign } from "../read/admission.ts";
import { smokeDecision, stage1Reading, twinCheck, type SmokeSession, type Stage1Inputs, type TwinPairInput } from "../read/stage1.ts";
import { contrast, primaries, readingRule, unionSensitivity, verdict, type UntestedInputs, type Verdict } from "../read/stage2.ts";
import type { ReadCell } from "../read/types.ts";
import { printScopeShare, scopeOf, scopeShare } from "../run/scope.ts";
import { armSummary, scoreReviews, stockCounts, stockReading, type Review } from "../score/score.ts";
import type { PacketLabels, PacketMeta, ReviewRow, ScoreUnit, Stage } from "../score/types.ts";
import type { GstackArm, Model, SessionKind, Tier, UnitSet } from "../types.ts";
import { readJson } from "./json.ts";
import { need, oneOf, type Row } from "./start.ts";

const TIERS: readonly Tier[] = ["base", "2x", "10x"];
const ARMS: readonly GstackArm[] = ["plan-design-review", "autoplan"];
const f4 = (x: number | null) => (x === null ? "n/a" : show(x));

/** dc scope --units <dir>: each folder under dir holding plan.md is one unit, read with that folder as /work. */
export const scopeRow: Row = (a, io) => {
  const dir = resolve(need(a, "--units", "scope --units <folder of unit folders, each with plan.md>"));
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail("E_USAGE", "--units is not a folder");
  const units = readdirSync(dir).filter((n) => existsSync(join(dir, n, "plan.md"))).sort();
  if (!units.length) fail("E_USAGE", "--units holds no folder with a plan.md");
  const reads = units.map((u) => {
    const s = scopeOf(readFileSync(join(dir, u, "plan.md"), "utf8"), join(dir, u));
    io.out("scope " + u + ": " + (s === null ? "unreadable (no UI scope)" : (s.uiRequired ? "UI scope" : "no UI scope") + ", " + s.uiMatches + " matches"));
    return s;
  });
  io.out(printScopeShare("over " + units.length + " plans", scopeShare(reads)));
  return 0;
};

/** The score input folder: units.json, rows.json, packets.json (the packet map) and labels.json. */
export function readScoreInput(dir: string) {
  const units = readJson<ScoreUnit[]>(join(dir, "units.json"), "units.json");
  return {
    units: new Map(units.map((u) => [u.unit.id, u])),
    rows: readJson<ReviewRow[]>(join(dir, "rows.json"), "rows.json"),
    metas: readJson<PacketMeta[]>(join(dir, "packets.json"), "packets.json"),
    labels: new Map(readJson<PacketLabels[]>(join(dir, "labels.json"), "labels.json").map((l) => [l.packet, l])),
  };
}

export const summaryLine = (s: ReturnType<typeof armSummary>): string =>
  "score " + s.model + " " + s.kind + " at " + s.read + ": " + s.units + " units, A " + f4(s.A) + ", G " + f4(s.G) + ", D " + f4(s.D) + ", precision " + f4(s.precision) + ", specificity " + f4(s.specificity) + ", label-missing " + s.labelMissing + " of " + s.planned + ", tie-decided " + s.tieDecided + ", via Gemini " + s.viaGemini + ", via others " + s.viaOthers + ", split cells " + s.splitCells + (s.splitCells ? " (sensitivity, decides nothing: union A " + f4(s.unionA) + ", G " + f4(s.unionG) + ")" : "");

/** dc score --in <dir> --read <tier> --stage <1|2>: A, G, D and the secondaries per model and arm, then STOCK FAIL per model. */
export const scoreRow: Row = (a, io) => {
  const usage = "score --in <folder with units.json, rows.json, packets.json, labels.json> --read base|2x|10x --stage 1|2";
  const dir = resolve(need(a, "--in", usage));
  const read = oneOf(a, "--read", TIERS, usage);
  const stage = Number(oneOf(a, "--stage", ["1", "2"] as const, usage)) as Stage;
  const inp = readScoreInput(dir);
  const reviews: Review[] = scoreReviews({ read, ...inp });
  const pairs = [...new Set(reviews.map((r) => r.model + "\t" + r.kind))].sort();
  for (const p of pairs) {
    const [model, kind] = p.split("\t") as [Model, SessionKind];
    io.out(summaryLine(armSummary(reviews, model, kind)));
  }
  const stageSet: UnitSet = stage === 1 ? "calibration" : "comparison";
  const counts = stockCounts({ metas: inp.metas, labels: inp.labels, units: inp.units, stageSet });
  const units = new Set([...inp.units.values()].filter((u) => u.unit.set === stageSet).map((u) => u.base)).size;
  for (const model of [...new Set(counts.map((c) => c.model))].sort()) {
    const s = stockReading(counts, model, stage, units);
    io.out("stock " + model + " stage " + stage + " over " + units + " units: " + s.rows.map((r) => "row " + r.row + " credited " + r.credited + ", unlabelled " + r.unlabelled).join("; ") + ": " + (s.fail ? "STOCK FAIL (" + s.consequence + ")" : s.toCaptain ? "to the Captain (PD-4)" : "no stock fail"));
  }
  io.out("score: " + reviews.length + " reviews at " + read);
  return 0;
};

/** The stage 1 read's input: the twin pairs and the figures stage1Reading takes beside the twin reading. */
export type Stage1File = Omit<Stage1Inputs, "twin"> & { twinPairs: TwinPairInput[] };

export interface Stage2File {
  model: Model;
  tier: Tier;
  cells: ReadCell[];
  /** Unit id to base-app label: every contrast clusters on it. */
  baseAppOf: Record<string, string>;
  /** Arms that stopped (a smoke drop, the interim exposure stop); each enters Holm at p = 1. */
  stopped: GstackArm[];
  stage1: Stage1File;
  incomplete: string | null;
  smoke: Record<GstackArm, { first: SmokeSession[]; resmoke?: SmokeSession[] }>;
  untested: Record<GstackArm, UntestedInputs>;
  mdd: number | null;
  pairwiseLosing: Record<GstackArm, boolean>;
  stage3Fewer: Record<GstackArm, boolean>;
}

const stage1Of = (s: Stage1File) => {
  const { twinPairs, ...rest } = s;
  const twin = twinCheck(twinPairs);
  return { twin, reading: stage1Reading({ ...rest, twin }) };
};

/** dc read --stage 1|2 --in <file>: the twin check and tier chain, or the stage 2 contrasts, verdicts and readings. */
export const readRow: Row = (a, io) => {
  const usage = "read --stage 1|2 --in <read input JSON>";
  const stage = oneOf(a, "--stage", ["1", "2"] as const, usage);
  const file = resolve(need(a, "--in", usage));
  if (stage === "1") {
    const s = stage1Of(readJson<Stage1File>(file, "--in"));
    for (const l of [...s.twin.lines, ...s.reading.lines]) io.out(l);
    io.out("stage 1: " + (s.reading.ends ? s.reading.reading + " (R48 " + s.reading.r48 + ", " + s.reading.kind + ")" : "HEADROOM at " + s.reading.tier + " (" + s.reading.label + ")"));
    return 0;
  }
  const f = readJson<Stage2File>(file, "--in");
  const base = { cells: f.cells, model: f.model, tier: f.tier, baseAppOf: new Map(Object.entries(f.baseAppOf)) };
  const s1 = stage1Of(f.stage1).reading;
  const prim = primaries(base, f.stopped);
  for (const arm of ARMS) {
    const p = prim[arm];
    const smoke = smokeDecision(arm, f.model, f.smoke[arm].first, f.smoke[arm].resmoke);
    for (const l of smoke.lines) io.out(l);
    if (p.contrast) io.out(arm + " minus none on " + f.model + " at " + f.tier + ": " + f4(p.contrast.delta) + " (95% " + (p.contrast.ci95 ? f4(p.contrast.ci95[0]) + " to " + f4(p.contrast.ci95[1]) : "n/a") + "), p " + f4(p.contrast.p) + ", Holm " + f4(p.holm) + ", " + p.contrast.units + " units on " + p.contrast.clusters + " base apps");
    const sens = p.contrast ? unionSensitivity({ ...base, b: arm, a: "none" }) : null;
    if (sens) io.out("sensitivity (PD-26, decides nothing): " + arm + " minus none on " + f.model + " with the union on split cells: " + f4(sens.contrast.delta) + " (95% " + (sens.contrast.ci95 ? f4(sens.contrast.ci95[0]) + " to " + f4(sens.contrast.ci95[1]) : "n/a") + "); split cells " + arm + " " + sens.split.b + ", none " + sens.split.a);
    const v = verdict({ stage1: s1, incomplete: f.incomplete, smoke, untested: f.untested[arm], primary: p, mdd: f.mdd });
    io.out(arm + " on " + f.model + ": " + v.verdict + " (step " + v.step + "): " + v.why);
    const ranLens = f.cells.some((c) => c.model === f.model && c.arm === "lens");
    const lens = p.contrast && ranLens ? contrast({ ...base, b: arm, a: "lens" }) : null;
    const lensNoneC = ranLens ? contrast({ ...base, b: "lens", a: "none" }) : null;
    const lensNone: Verdict = lensNoneC?.ci95 ? verdict({ stage1: s1, incomplete: f.incomplete, smoke, untested: f.untested[arm], primary: { arm, contrast: lensNoneC, pIn: lensNoneC.p, holm: lensNoneC.p }, mdd: f.mdd }).verdict : "untested";
    io.out("lens minus none on " + f.model + " at " + f.tier + " (beside " + arm + "): " + (lensNoneC ? f4(lensNoneC.delta) + " (95% " + (lensNoneC.ci95 ? f4(lensNoneC.ci95[0]) + " to " + f4(lensNoneC.ci95[1]) : "n/a") + "), unadjusted p " + f4(lensNoneC.p) : "the lens didn't run") + ": " + lensNone);
    const reading = readingRule({ arm, model: f.model, armNone: v, armNoneCi: p.contrast?.ci95 ?? null, armLensCi: lens?.ci95 ?? null, lensNone, pairwiseLosing: f.pairwiseLosing[arm], stage3Fewer: f.stage3Fewer[arm] });
    for (const l of reading.lines) io.out(l);
  }
  return 0;
};

/** dc power --design <design.json> --out <new folder>: power.py --design under uv, refusing a power.py with other bytes. */
export const powerRow: Row = (a, io, env) => {
  const usage = "power --design <design.json> --out <new folder for the written design>";
  const design = validateDesign(readJson<unknown>(resolve(need(a, "--design", usage)), "--design"));
  const out = resolve(need(a, "--out", usage));
  if (existsSync(out)) fail("E_USAGE", "--out exists already; the admission read writes design.json into a new folder");
  const r = admissionRead(design, { dir: out, run: env.power });
  for (const l of r.lines) io.out(l);
  return 0;
};

export const itemsRow: Row = (a, io) => {
  if (a.rest.length || a.flags.size) fail("E_USAGE", "usage: gstack-evals dc items");
  return itemsCommand(io);
};
