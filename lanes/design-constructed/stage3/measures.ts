// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 3's measures 1 to 8 per build, the DES-4 pairwise with its instrument check, the readout paired by unit against
// the none-block build and the no-review build, and the KEEP flag (2026-11-09 section 11 "Measures", "Failures" and
// "Readout", with key-check recurrence in place of measure 5, as the 2026-11-14 prereg section 11 and section 10's KEEP
// line keep them). Stage 3 is descriptive: it decides nothing except the KEEP flag.
// The readout's pairing follows lanes/devex/stage3/readout.ts at 5ee7f764232b196a1d0cec5b144a287b792f9c94 (branch
// build-devex-review-eval), on main's clusteredPairedDelta in src/runner/stats/paired.ts.
import { createHash } from "node:crypto";
import { clusteredPairedDelta } from "../../../src/runner/stats/paired.ts";
import { READS, ROUND_DECIMALS, SEED, STAGE3 } from "../frozen.ts";
import { fail } from "../errors.ts";
import type { GstackArm, Unit } from "../types.ts";
import { BUILD_ARMS, type BuildArm } from "./build.ts";
import type { BuildReads, KeyCheck, PairwiseJudge } from "./seams.ts";

/** One build as the readout sees it. */
export interface BuildRecord {
  unit: string;
  arm: BuildArm;
  /** measured: built (completed or own-limit) and checked; missing: failed outside the agent twice; not-built: no Opus block; incomplete: a cap stop. */
  state: "measured" | "missing" | "not-built" | "incomplete";
  /** Measure 1, for a measured build. */
  serves: boolean | null;
  reads: BuildReads | null;
  retried: "own-limit" | "infra" | null;
  /** Whether the build that was measured ended on its own limit. */
  ownLimit: boolean;
}

export const MEASURES = ["serves", "axe", "axeNew", "overflow", "smallTargets", "forcedMechanical", "forcedAstra", "keyCheckRecurrence", "completion", "agentSteps", "agentFailedActions", "agentConsoleErrors", "agentDeadEnds", "literals", "des4"] as const;
export type Measure = (typeof MEASURES)[number];
/** +1 where higher is better, -1 where lower is. */
export const DIRECTION: Readonly<Record<Measure, 1 | -1>> = { serves: 1, axe: -1, axeNew: -1, overflow: -1, smallTargets: -1, forcedMechanical: 1, forcedAstra: 1, keyCheckRecurrence: 1, completion: 1, agentSteps: -1, agentFailedActions: -1, agentConsoleErrors: -1, agentDeadEnds: -1, literals: -1, des4: 1 };
/** The render reads: unavailable, never zero, for a build that doesn't install or serve. */
export const RENDER_READS: readonly Measure[] = ["axe", "axeNew", "overflow", "smallTargets", "forcedMechanical", "forcedAstra", "keyCheckRecurrence", "literals", "des4"];

export type Values = Record<Measure, number | null>;

const r4 = (x: number) => Number(x.toFixed(ROUND_DECIMALS));
const share = (num: number, den: number) => (den ? r4(num / den) : null);
const none = (): Values => Object.fromEntries(MEASURES.map((m) => [m, null])) as Values;
const axeKeys = (r: BuildReads) => new Set(r.axe.flatMap((a) => a.violations.map((v) => a.route + " " + a.width + " " + v)));

/**
 * Measures 1 to 7 for one build (DES-4 joins from the pairwise). A build that never serves scores 0 on measure 1 and on
 * agent-user completion, and every render read is unavailable. Forced states are unavailable when the screen doesn't
 * read the data source plan.md names. A missing scenario or check leaves its denominator. The agent user's secondaries
 * (steps, failed actions, console errors, dead ends) are means over its scenarios with a result.
 */
export function buildValues(b: BuildRecord, validated: readonly KeyCheck[], noReview: BuildRecord | undefined): Values {
  const v = none();
  if (b.state !== "measured" || b.serves === null) return v;
  if (!b.serves || !b.reads) return { ...v, serves: 0, completion: 0 };
  const r = b.reads;
  v.serves = 1;
  v.axe = r.axe.reduce((n, a) => n + a.violations.length, 0);
  if (noReview?.state === "measured" && noReview.serves && noReview.reads) {
    const base = axeKeys(noReview.reads);
    v.axeNew = [...axeKeys(r)].filter((k) => !base.has(k)).length;
  }
  v.overflow = r.overflow.filter((o) => STAGE3.overflowWidths.includes(o.width as 375 | 768) && o.overflow).length;
  v.smallTargets = r.smallTargets;
  if (r.readsDataSource) {
    v.forcedMechanical = share(r.forced.filter((f) => f.distinct).length, r.forced.length);
    const astra = r.forced.filter((f) => f.astra !== null);
    v.forcedAstra = share(astra.filter((f) => f.astra === "designed").length, astra.length);
  }
  const kc = validated.map((k) => r.keyChecks[k.id]).filter((x): x is boolean => x === true || x === false);
  v.keyCheckRecurrence = share(kc.filter(Boolean).length, kc.length);
  const au = r.agentUser.filter((a) => a.completed !== null);
  v.completion = share(au.filter((a) => a.completed).length, au.length);
  const mean = (f: (a: (typeof au)[number]) => number) => (au.length ? r4(au.reduce((n, a) => n + f(a), 0) / au.length) : null);
  v.agentSteps = mean((a) => a.steps);
  v.agentFailedActions = mean((a) => a.failedActions);
  v.agentConsoleErrors = mean((a) => a.consoleErrors);
  v.agentDeadEnds = mean((a) => a.deadEnds);
  v.literals = r.literalsAdded;
  return v;
}

/** Validated key checks that pass on every arm's build print as uninformative. */
export function uninformative(validated: readonly KeyCheck[], builds: readonly BuildRecord[]): string[] {
  const all = BUILD_ARMS.map((a) => builds.find((b) => b.arm === a));
  if (all.some((b) => !b || b.state !== "measured" || !b.serves || !b.reads)) return [];
  return validated.filter((k) => all.every((b) => b!.reads!.keyChecks[k.id] === true)).map((k) => k.id);
}

export const DES4_JUDGES = ["astra", "argon"] as const;

export interface PairRow {
  unit: string;
  arm: Exclude<BuildArm, "generic-look">;
  judge: (typeof DES4_JUDGES)[number];
  /** Whether the arm's screens were shown first (BT: seeded per pair). */
  armFirst: boolean;
  /** win, loss or tie for the arm against the control; null when the read failed twice. */
  result: "win" | "loss" | "tie" | null;
}

/** BT: the seeded order of one pair, from the first 8 hex digits of sha256 of the seed, unit, arm and judge. */
export function armFirst(unit: string, arm: string, judge: string): boolean {
  const h = createHash("sha256").update(SEED + "\n" + unit + "\n" + arm + "\n" + judge).digest("hex");
  return (parseInt(h.slice(0, 8), 16) & 1) === 0;
}

/** Measure 8: each non-control build's screens against the generic-look control's, blind, by Astra and by Argon. */
export async function des4(unit: Unit, builds: readonly BuildRecord[], judge: PairwiseJudge): Promise<PairRow[]> {
  const screens = (b?: BuildRecord) => (b?.state === "measured" && b.serves && b.reads?.screens ? b.reads.screens : null);
  const control = screens(builds.find((b) => b.arm === "generic-look"));
  if (!control) return [];
  const rows: PairRow[] = [];
  for (const arm of BUILD_ARMS.filter((a): a is PairRow["arm"] => a !== "generic-look")) {
    const mine = screens(builds.find((b) => b.arm === arm));
    if (!mine) continue;
    for (const j of DES4_JUDGES) {
      const first = armFirst(unit.id, arm, j);
      const pick = await judge({ unit, judge: j, first: first ? mine : control, second: first ? control : mine });
      const result = pick === null ? null : pick === "tie" ? "tie" : (pick === "first") === first ? "win" : "loss";
      rows.push({ unit: unit.id, arm, judge: j, armFirst: first, result });
    }
  }
  return rows;
}

/** Each arm's win rate against the control per judge and both together; ties and losses are not wins. */
export function winRates(rows: readonly PairRow[]): Array<{ arm: string; judge: string; pairs: number; rate: number | null }> {
  const out: Array<{ arm: string; judge: string; pairs: number; rate: number | null }> = [];
  for (const arm of BUILD_ARMS.filter((a) => a !== "generic-look"))
    for (const judge of [...DES4_JUDGES, "both"]) {
      const rs = rows.filter((r) => r.arm === arm && (judge === "both" || r.judge === judge) && r.result !== null);
      out.push({ arm, judge, pairs: rs.length, rate: share(rs.filter((r) => r.result === "win").length, rs.length) });
    }
  return out;
}

/** The instrument check: the no-review build must beat the control in at least 70% of its pairs, or DES-4 is flagged. */
export function instrument(rows: readonly PairRow[]): { rate: number | null; flagged: boolean } {
  const rate = winRates(rows).find((w) => w.arm === "no-review" && w.judge === "both")!.rate;
  return { rate, flagged: rate === null || rate < STAGE3.des4InstrumentMin };
}

/** A build's DES-4 value: its share of wins over its read pairs. */
export const des4Value = (rows: readonly PairRow[], unit: string, arm: BuildArm): number | null => {
  const rs = rows.filter((r) => r.unit === unit && r.arm === arm && r.result !== null);
  return share(rs.filter((r) => r.result === "win").length, rs.length);
};

export interface Paired {
  comparator: "none" | "no-review";
  arm: BuildArm;
  measure: Measure;
  units: number;
  /** Mean over units of arm minus comparator, rounded. */
  delta: number | null;
  ci95: [number, number] | null;
  /** Units where the arm did worse than the comparator. */
  worse: number;
}

/**
 * Every measure paired by unit against the none-block build and against the no-review build, with a 95% cluster-bootstrap
 * interval over base apps (10,000 draws at seed 20261114) and the worse count. Only units where both builds have the
 * value pair. The unit-to-base-app map is required, with no default.
 */
export function readout(values: ReadonlyMap<string, Partial<Record<BuildArm, Values>>>, baseAppOf: Readonly<Record<string, string>>): Paired[] {
  const out: Paired[] = [];
  const units = [...values.keys()].sort();
  for (const u of units) if (!baseAppOf[u]) fail("E_INTERNAL", "stage 3 readout: unit " + u + " has no base app in the map");
  for (const comparator of ["none", "no-review"] as const)
    for (const arm of BUILD_ARMS.filter((a) => a !== comparator))
      for (const measure of MEASURES) {
        const pairs = units.flatMap((u) => {
          const a = values.get(u)?.[comparator]?.[measure], b = values.get(u)?.[arm]?.[measure];
          return a === null || a === undefined || b === null || b === undefined ? [] : [{ id: u, cluster: baseAppOf[u]!, a, b }];
        });
        if (!pairs.length) {
          out.push({ comparator, arm, measure, units: 0, delta: null, ci95: null, worse: 0 });
          continue;
        }
        const d = clusteredPairedDelta(pairs, { seed: SEED, draws: READS.draws });
        out.push({ comparator, arm, measure, units: pairs.length, delta: r4(d.delta), ci95: d.ci95 ? [r4(d.ci95[0]), r4(d.ci95[1])] : null, worse: pairs.filter((p) => (p.b - p.a) * DIRECTION[measure] < 0).length });
      }
  return out;
}

/** The KEEP flag: a gstack arm's builds pass fewer key checks than the none block's, with an interval that excludes zero. */
export function keepFlags(paired: readonly Paired[]): Array<{ arm: GstackArm; flagged: boolean; delta: number | null; ci95: [number, number] | null }> {
  return (["plan-design-review", "autoplan"] as const).map((arm) => {
    const p = paired.find((x) => x.comparator === "none" && x.arm === arm && x.measure === "keyCheckRecurrence");
    return { arm, flagged: !!p?.ci95 && p.ci95[1] < 0, delta: p?.delta ?? null, ci95: p?.ci95 ?? null };
  });
}
