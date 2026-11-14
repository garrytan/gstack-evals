// Copyright (c) 2026 Garry Tan. MIT License.
// The admission read and the projection rerun (prereg sections 9, 12 and 13, plan section 12): design.json from the
// measured comparison set, power.py's design mode at its pinned bytes (other bytes refuse with E_DCV_POWER_PY_PIN) behind
// a wrapper that refuses a malformed design with E_USAGE, the projection on measured figures with the re-pricing before
// stage 2 (PD-30), the $5,000 stop (its line starts E_DCV_PROJECTION_STOP) with the frozen cut order put to the Captain,
// and the re-sizing.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUTHORING, CREW_DEVIATION, LEDGER_ITEMS, MONEY, PASSES, PREREG, READS, SETS, STAGE3 } from "../frozen.ts";
import { fail } from "../errors.ts";
import type { Arm, LedgerItemId, Model } from "../types.ts";
import { above, below, q4, show } from "./num.ts";
import type { PowerRunner } from "./seams.ts";

/** power.py as the prereg attaches it, beside the post; the wrapper refuses any other bytes. */
export const POWER_PY = join(import.meta.dir, "..", "..", "..", PREREG.replace(/README\.md$/, "power.py"));
export const POWER_PY_SHA256 = "09636859375fbde79efaffcedb794ebc7699e0d13cf081246da45bb943ae5d3a";

/** power.py's --design input: digests and counts only. */
export interface DesignJson {
  p0: number;
  rho: number;
  passes_arm: number;
  passes_none: number;
  units: { repo: string; items: number }[];
}

/** A base app's digest in design.json: sha256 of its label, so the file names no repository (BT). */
export const baseAppDigest = (label: string): string => createHash("sha256").update(label).digest("hex");

/**
 * design.json for the admitted tier's comparison set: each unit's base-app digest and primary item count, stage 1's Opus
 * none rate on that tier (A, or G at 10x) as p0, raised to 0.05 when it measures below 0.05, ICC 0.5, and the pass
 * counts the arms will actually run.
 */
export function buildDesign(units: ReadonlyArray<{ unit: string; baseApp: string; items: number }>, o: { p0Measured: number; passesArm: number; passesNone: number }): DesignJson {
  const p0 = below(o.p0Measured, READS.admission.p0Floor) ? READS.admission.p0Floor : q4(o.p0Measured) / 1e4;
  return validateDesign({ p0, rho: READS.admission.icc, passes_arm: o.passesArm, passes_none: o.passesNone, units: units.map((u) => ({ repo: u.baseApp ? baseAppDigest(u.baseApp) : "", items: u.items })) });
}

/** The wrapper's refusals, before power.py runs: an empty design, a unit with no base app or items, or passes below 1. */
export function validateDesign(d: unknown): DesignJson {
  const x = d as Partial<DesignJson> | null;
  if (!x || typeof x !== "object") fail("E_USAGE", "design.json must be an object");
  if (!Array.isArray(x!.units) || x!.units.length === 0) fail("E_USAGE", "design.json holds no units");
  x!.units!.forEach((u, n) => {
    if (!u || typeof u.repo !== "string" || !u.repo) fail("E_USAGE", "design unit " + (n + 1) + " has no base app");
    if (!Number.isInteger(u.items) || u.items < AUTHORING.minPrimaryItems || u.items > AUTHORING.itemsPerKey) fail("E_USAGE", "design unit " + (n + 1) + " has " + JSON.stringify(u.items) + " primary items; a unit holds 3 to 5");
  });
  for (const k of ["passes_arm", "passes_none"] as const) if (!Number.isInteger(x![k]) || x![k]! < 1) fail("E_USAGE", "design.json " + k + " must be a whole number of at least 1, got " + JSON.stringify(x![k]));
  if (typeof x!.p0 !== "number" || !(x!.p0 > 0 && x!.p0 < 1)) fail("E_USAGE", "design.json p0 must be strictly between 0 and 1");
  if (x!.rho !== READS.admission.icc) fail("E_USAGE", "design.json rho must be the frozen ICC " + READS.admission.icc);
  return { p0: x!.p0!, rho: x!.rho!, passes_arm: x!.passes_arm!, passes_none: x!.passes_none!, units: x!.units!.map((u) => ({ repo: u.repo, items: u.items })) };
}

export interface AdmissionResult {
  pass: boolean;
  power: number;
  se: number;
  /** null when power.py prints "over 0.40". */
  mdd: number | null;
  designPath: string;
  lines: string[];
}

/** Writes design.json into dir and runs power.py --design on it; the read passes at power of at least 0.80. */
export function admissionRead(design: DesignJson, o: { dir: string; run: PowerRunner; script?: string }): AdmissionResult {
  const d = validateDesign(design);
  const script = o.script ?? POWER_PY;
  const sha = createHash("sha256").update(readFileSync(script)).digest("hex");
  if (sha !== POWER_PY_SHA256) fail("E_DCV_POWER_PY_PIN", script + " has sha256 " + sha + ", not the pinned " + POWER_PY_SHA256);
  mkdirSync(o.dir, { recursive: true });
  const designPath = join(o.dir, "design.json");
  writeFileSync(designPath, JSON.stringify(d, null, 2) + "\n");
  const r = o.run(script, designPath);
  if (r.code !== 0) fail("E_USAGE", "power.py --design exited " + r.code + ": " + (r.stderr.trim().split("\n").at(-1) ?? ""));
  const admit = /^ADMIT .* power (\d\.\d{3}) se (\d\.\d{3}) -> (pass|fail)$/m.exec(r.stdout);
  const mddLine = /^MDD .* MDD (over 0\.40|\d\.\d{2})$/m.exec(r.stdout);
  if (!admit || !mddLine) fail("E_INTERNAL", "power.py --design printed no ADMIT and MDD lines");
  const power = Number(admit![1]);
  const pass = admit![3] === "pass";
  const mdd = mddLine![1] === "over 0.40" ? null : Number(mddLine![1]);
  const apps = new Set(d.units.map((u) => u.repo)).size;
  return {
    pass,
    power,
    se: Number(admit![2]),
    mdd,
    designPath,
    lines: [
      "admission read: " + d.units.length + " units on " + apps + " base apps, p0 " + d.p0.toFixed(4) + ", ICC " + d.rho + ", passes " + d.passes_arm + " arm and " + d.passes_none + " none, lift " + READS.admission.lift + " at alpha " + READS.admission.alphaFirstStep,
      "admission read: power " + admit![1] + " (se " + admit![2] + "), MDD " + mddLine![1] + ": " + (pass ? "pass" : "fail, re-size within the line or go to the Captain"),
    ],
  };
}

// ---- The projection rerun and the cut order (section 13)

/** The stage 2 and stage 3 design the projection prices. passes[model][arm] is the passes each arm runs on each unit. */
export interface Stage2Design {
  units: number;
  passes: Record<Model, Record<Arm, number>>;
  stage3Units: number;
}

export interface ProjectionInput {
  /** Each item outside stage 2's runs and stage 3, at measured figures: settled, in flight, unknown and the projected rest. */
  otherUsd: Partial<Record<LedgerItemId, number>>;
  /** Measured mean cost of one session, per model and arm (the smoke's for the gstack arms, stage 1's for none and lens). */
  sessionUsd: Record<Model, Record<Arm, number>>;
  /** Measured cost of one stage 2 label packet (one unit-pass), per model; charged to dc-judges. */
  labelPacketUsd: Record<Model, number>;
  /** Stage 3 per unit, at measured or planning figures, per item. */
  stage3PerUnitUsd: { authoring: number; builds: number; reads: number };
}

export const MODELS: readonly Model[] = ["opus", "sol", "particle"];
export const ARMS: readonly Arm[] = ["none", "lens", "plan-design-review", "autoplan"];
const STAGE2_ITEM: Record<Model, LedgerItemId> = { opus: "dc-stage2-opus", sol: "dc-stage2-sol", particle: "dc-stage2-particle" };

/** The frozen design: 64 units, Opus at 2 passes and the others at 1 on all four arms, stage 3 at 16 units. */
export function plannedDesign(units: number = SETS.comparison): Stage2Design {
  const all = (n: number) => ({ none: n, lens: n, "plan-design-review": n, autoplan: n });
  return { units, passes: { opus: all(PASSES.stage2.opus), sol: all(PASSES.stage2.sol), particle: all(PASSES.stage2.particle) }, stage3Units: STAGE3.maxUnits };
}

export interface Projection {
  allInUsd: number;
  byItem: Partial<Record<LedgerItemId, number>>;
  fits: boolean;
  /** Each failing fit check, named. */
  misses: string[];
}

const reserveOf = (id: LedgerItemId) => {
  const a = LEDGER_ITEMS[id].admission;
  return a.kind === "sessions" ? a.reserveUsd : 0;
};

/**
 * The projection on a design. It fits when the all-in projection is within the $3,999 line and every stage 2 runs item
 * and the stage 3 builds item hold their projection plus their round reserve within their caps (BT; see NOTES.md).
 */
export function project(i: ProjectionInput, d: Stage2Design): Projection {
  const byItem: Partial<Record<LedgerItemId, number>> = { ...i.otherUsd };
  const add = (id: LedgerItemId, usd: number) => (byItem[id] = (byItem[id] ?? 0) + usd);
  for (const m of MODELS) {
    add(STAGE2_ITEM[m], ARMS.reduce((s, a) => s + d.units * d.passes[m][a] * i.sessionUsd[m][a], 0));
    add("dc-judges", d.units * Math.max(...ARMS.map((a) => d.passes[m][a])) * i.labelPacketUsd[m]);
  }
  add("dc-stage3-authoring", d.stage3Units * i.stage3PerUnitUsd.authoring);
  add("dc-stage3-builds", d.stage3Units * i.stage3PerUnitUsd.builds);
  add("dc-stage3-reads", d.stage3Units * i.stage3PerUnitUsd.reads);
  const allInUsd = Object.values(byItem).reduce((s, v) => s + (v ?? 0), 0);
  const misses: string[] = [];
  const crewOverUsd = Math.min(Math.max((byItem.crew ?? 0) - CREW_DEVIATION.frozenCapUsd, 0), CREW_DEVIATION.capUsd - CREW_DEVIATION.frozenCapUsd);
  if (above(allInUsd - crewOverUsd, MONEY.capAllInUsd)) misses.push("all-in $" + allInUsd.toFixed(2) + (crewOverUsd > 0 ? " (less $" + crewOverUsd.toFixed(2) + " of crew spend under PD-14)" : "") + " is over the $" + MONEY.capAllInUsd + " line");
  for (const id of [...MODELS.map((m) => STAGE2_ITEM[m]), "dc-stage3-builds" as const]) {
    const need = (byItem[id] ?? 0) + reserveOf(id);
    if (above(need, LEDGER_ITEMS[id].capUsd)) misses.push(id + " needs $" + need.toFixed(2) + " with its reserve, over its $" + LEDGER_ITEMS[id].capUsd + " cap");
  }
  return { allInUsd, byItem, fits: !misses.length, misses };
}

/** The section 13 planning figures as measured inputs; Opus's gstack arm cost can be raised to drive the cuts. */
export const planningInputs = (gstackUsd = 2.5, extraCrewUsd = 0): ProjectionInput => {
  const planned: Record<Arm, number> = { none: 0.4, lens: 0.45, "plan-design-review": 2.5, autoplan: 2.5 };
  const opus: Record<Arm, number> = { ...planned, "plan-design-review": gstackUsd, autoplan: gstackUsd };
  const scale = (f: number) => Object.fromEntries(Object.entries(planned).map(([k, v]) => [k, v * f])) as Record<Arm, number>;
  const other = Object.fromEntries(
    Object.entries(LEDGER_ITEMS)
      .filter(([id]) => !id.startsWith("dc-stage2-") && !id.startsWith("dc-stage3-"))
      .map(([id, s]) => [id, id === "dc-judges" ? s.projectionUsd - 213 : id === "crew" ? s.projectionUsd + extraCrewUsd : s.projectionUsd]),
  );
  return { otherUsd: other, sessionUsd: { opus, sol: scale(0.9), particle: scale(0.1) }, labelPacketUsd: { opus: 213 / 256, sol: 213 / 256, particle: 213 / 256 }, stage3PerUnitUsd: { authoring: 174 / 16, builds: 144 / 16, reads: 146 / 16 } };
};

/**
 * The planning projection beside the frozen one: the all-in at the planning figures through project(), each item whose
 * planning figure differs from its frozen projection, and the fields of the measured input projectionRerun takes.
 */
export function planningLines(): string[] {
  const p = project(planningInputs(), plannedDesign());
  const frozen = (Object.keys(LEDGER_ITEMS) as LedgerItemId[]).reduce((s, id) => s + LEDGER_ITEMS[id].projectionUsd, 0);
  return [
    "planning projection: all-in $" + p.allInUsd.toFixed(2) + " at section 13's planning figures (read/admission.ts planningInputs on the frozen design); the frozen projections sum to $" + frozen.toFixed(2),
    ...(Object.keys(LEDGER_ITEMS) as LedgerItemId[]).filter((id) => Math.abs((p.byItem[id] ?? 0) - LEDGER_ITEMS[id].projectionUsd) > 0.005).map((id) => "planning projection: " + id + " $" + (p.byItem[id] ?? 0).toFixed(2) + " against its frozen $" + LEDGER_ITEMS[id].projectionUsd + ", priced per session at the planning figures"),
    "measured input (projectionRerun, the reprice row's --projection): otherUsd, each item outside stage 2's runs and stage 3 at stage 1's measured figures: settled, in flight, unknown and the projected rest",
    "measured input: sessionUsd, the mean cost of one session per model and arm: the smoke's for the gstack arms, stage 1's for none and lens",
    "measured input: labelPacketUsd, the cost of one stage 2 label packet (one unit-pass) per model, charged to dc-judges",
    "measured input: stage3PerUnitUsd, stage 3's cost per unit for authoring, builds and reads, at measured or planning figures",
  ];
}

/** One item's cap re-priced before stage 2 (PD-30): the frozen cap, the measured need with its reserve and the new cap. */
export interface Repricing {
  item: LedgerItemId;
  frozenCapUsd: number;
  needUsd: number;
  repricedCapUsd: number;
}

export type ProjectionOutcome =
  | { outcome: "fits"; design: Stage2Design; cuts: string[]; projection: Projection; repriced: Repricing[]; lines: string[] }
  | { outcome: "captain"; why: "envelope"; design: Stage2Design; cuts: string[]; projection: Projection; repriced: Repricing[]; lines: string[] };

/** The deviation line for one re-priced cap: printed by the rerun and written word for word as the ledger raise's quote (PD-30). */
export const repricedLine = (item: LedgerItemId, frozenCapUsd: number, repricedCapUsd: number): string => "re-priced before stage 2 (a pre-data deviation, PD-30): " + item + " cap $" + frozenCapUsd + " to $" + repricedCapUsd.toFixed(2) + " (measured need with its reserve)";

/** PD-30: every item whose measured projection plus its round reserve passes its cap gets that need as its cap, to the cent. */
export function reprice(p: Projection): Repricing[] {
  const out: Repricing[] = [];
  for (const id of Object.keys(p.byItem).sort() as LedgerItemId[]) {
    const needUsd = (p.byItem[id] ?? 0) + reserveOf(id);
    if (above(needUsd, LEDGER_ITEMS[id].capUsd)) out.push({ item: id, frozenCapUsd: LEDGER_ITEMS[id].capUsd, needUsd, repricedCapUsd: Math.ceil(needUsd * 100 - 1e-9) / 100 });
  }
  return out;
}

/**
 * The rerun under the Captain's standing rule on the stage 2 margin (PD-30). The lines are guidelines, so a measured
 * cost over plan triggers no cut: before stage 2 each item's cap is re-priced from stage 1's measured costs and the
 * pilot, and the re-pricing is recorded as a deviation. Section 13's cut order applies only when the re-priced all-in
 * projection would pass $5,000, which stops for the Captain in any case; the cuts then print in the frozen order
 * (stage 3 down to 12 units, Sol's lens cells, comparison units down to 48 to the most units under $5,000, then Opus's
 * second pass on the gstack arms) as the design put to the Captain. particle-1 stays.
 */
export function projectionRerun(i: ProjectionInput, start: Stage2Design = plannedDesign()): ProjectionOutcome {
  const d = structuredClone(start);
  const p = project(i, d);
  const repriced = reprice(p);
  const lines = [
    "projection as planned: all-in $" + p.allInUsd.toFixed(2) + (above(p.allInUsd, MONEY.capAllInUsd) ? ", over the $" + MONEY.capAllInUsd + " line, which is a guideline: no cut (PD-30)" : ", within the $" + MONEY.capAllInUsd + " line"),
    ...repriced.map((r) => repricedLine(r.item, r.frozenCapUsd, r.repricedCapUsd)),
  ];
  if (!above(p.allInUsd, MONEY.projectionStopUsd)) return { outcome: "fits", design: d, cuts: [], projection: p, repriced, lines: [...lines, "no cut; the re-priced design goes to the admission read before spending"] };
  lines.push("E_DCV_PROJECTION_STOP the re-priced projection is past $5,000: stop for the Captain; section 13's cut order follows for the Captain");
  const over = (x: Stage2Design) => above(project(i, x).allInUsd, MONEY.projectionStopUsd);
  const order: Array<() => void> = [
    () => (d.stage3Units = Math.min(d.stage3Units, STAGE3.cutUnits)),
    () => (d.passes.sol.lens = 0),
    () => {
      const floor = SETS.comparisonFloor;
      let n = d.units;
      while (n > floor && over({ ...d, units: n })) n--;
      d.units = Math.min(d.units, Math.max(n, floor));
    },
    () => {
      d.passes.opus["plan-design-review"] = Math.min(d.passes.opus["plan-design-review"], 1);
      d.passes.opus.autoplan = Math.min(d.passes.opus.autoplan, 1);
    },
  ];
  const cuts: string[] = [];
  for (let k = 0; k < order.length && over(d); k++) {
    order[k]!();
    cuts.push(MONEY.cutOrder[k]! + (k === 2 ? " (" + d.units + " units)" : ""));
    lines.push("after " + cuts.at(-1) + ": all-in $" + project(i, d).allInUsd.toFixed(2));
  }
  if (over(d)) lines.push("no cut in the frozen order brings the projection to $5,000");
  return { outcome: "captain", why: "envelope", design: d, cuts, projection: p, repriced: reprice(project(i, d)), lines };
}

/** A cut design whose measured design fails the admission read goes to the Captain instead of running. */
export function cutAdmission(o: ProjectionOutcome, admission: AdmissionResult | null): { run: boolean; line: string } {
  if (o.outcome !== "fits") return { run: false, line: "the projection goes to the Captain (" + o.why + ")" };
  if (!o.cuts.length) return { run: admission === null || admission.pass, line: admission && !admission.pass ? "the admission read fails: re-size within the line or go to the Captain" : "no cut; the planned design stands" };
  if (!admission) fail("E_USAGE", "a cut design needs its admission read before it runs");
  return admission!.pass
    ? { run: true, line: "the cut design passes the admission read; its MDD " + show(admission!.mdd) + " prints before spending" }
    : { run: false, line: "the cut design fails the admission read (power " + admission!.power.toFixed(3) + "): go to the Captain" };
}

// ---- Re-sizing at the authoring re-projection (sections 3 and 14, start rule 12)

/**
 * The comparison set is the units the authoring caps can fill at the measured figures: at most 64, never below 48. A
 * projection that can't fill 48 stops authoring (E_DC_SUPPLY_SHORT) for the Captain, with the MDD at the count that can fill.
 */
export function resize(projectedUnits: number): { units: number | null; code: "E_DC_SUPPLY_SHORT" | null; mddAt: number | null; line: string } {
  if (!Number.isInteger(projectedUnits) || projectedUnits < 0) fail("E_USAGE", "projected units must be a whole number, got " + projectedUnits);
  if (projectedUnits >= SETS.comparison) return { units: SETS.comparison, code: null, mddAt: null, line: "re-sizing: " + projectedUnits + " projected units fill the set of " + SETS.comparison };
  if (projectedUnits >= SETS.comparisonFloor) return { units: projectedUnits, code: null, mddAt: null, line: "re-sizing: the comparison set shrinks to " + projectedUnits + " units" };
  return { units: null, code: "E_DC_SUPPLY_SHORT", mddAt: projectedUnits, line: "re-sizing: " + projectedUnits + " projected units can't fill " + SETS.comparisonFloor + ": authoring stops (E_DC_SUPPLY_SHORT) for the Captain with the MDD at " + projectedUnits + " units" };
}


