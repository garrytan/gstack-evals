// Copyright (c) 2026 Garry Tan. MIT License.
// Part S's one interim look (plan section 11 and its Interim look section; prereg.json interim). At half of part S's units
// in the extension's run order (the first half of each class in planExtStage's order), each deciding contrast is tested
// against the two-look O'Brien-Fleming bound of its own Holm step from interim.bounds_table, two-sided, on the clustered
// test. Holm's step comes from the contrast's rank by p, and a contrast crosses only when every contrast ranked before it
// in its family crossed too, as Holm steps down. s-gstack-line crosses when its less-code ratio crosses at its step within
// the sentence family's three, with the ratio below 1, and its two no-harm criteria already pass. The look prints only
// crossed or not crossed per deciding contrast and the stop decision.
import { normalQuantile } from "../../../../src/runner/stats/paired.ts";
import { phi } from "../../../../src/runner/stats/outcome-decision.ts";
import type { PairedTest } from "../analysis/stats.ts";
import { h2hFail, readPrereg, type H2hPrereg } from "../prereg.ts";
import type { H2hUnit, UnitClass } from "../types.ts";
import { cellOf, ExtData, primaryFamily, sentenceContrast, type ExtInput } from "./analysis.ts";
import { planExtStage } from "./plan.ts";
import { readExtPrereg, type ExtPrereg } from "./prereg.ts";

/** The two-sided p's |z|: Infinity at p = 0, 0 at p = 1. */
export const zFromP = (p: number): number => (p <= 0 ? Infinity : p >= 1 ? 0 : normalQuantile(1 - p / 2));
/** A paired test's |z|: the clustered z, or the one its p implies when the clustered variance is 0. */
export const absZ = (t: PairedTest): number => (t.z !== null ? Math.abs(t.z) : zFromP(t.p));

/** The two-look O'Brien-Fleming bounds at information 1/2 and 1, two-sided, for an overall alpha: c * sqrt(2) at the look
 *  and c at the end, where P(|Z1| >= c * sqrt(2) or |Z2| >= c) = alpha and Z1, Z2 have correlation sqrt(1/2). Each bound is
 *  rounded to 3 places, as interim.bounds_table holds them. */
export function obfBounds(alpha: number): [number, number] {
  const rho = Math.SQRT1_2, s = Math.sqrt(1 - rho * rho);
  const pass = (c: number) => {
    const a = c * Math.SQRT2, n = 4000, h = (2 * a) / n;
    let sum = 0;
    for (let k = 0; k <= n; k++) {
      const z = -a + k * h, w = k === 0 || k === n ? 1 : k % 2 ? 4 : 2;
      sum += w * (Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)) * (phi((c - rho * z) / s) - phi((-c - rho * z) / s));
    }
    return (sum * h) / 3;
  };
  let lo = 1, hi = 6;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (1 - pass(mid) > alpha) lo = mid;
    else hi = mid;
  }
  const c = (lo + hi) / 2;
  return [Math.round(1000 * c * Math.SQRT2) / 1000, Math.round(1000 * c) / 1000];
}

/** The bound of Holm step 0.05/k at the look (0) or the end (1), from interim.bounds_table. */
export function boundAt(x: ExtPrereg, k: number, at: 0 | 1 = 0): number {
  const b = x.interim.bounds_table["0.05/" + k];
  if (!b || !(b[at]! > 0)) return h2hFail("E_H2HX_PREREG", "interim.bounds_table has no bound for Holm step 0.05/" + k);
  return b[at]!;
}

/** Holm's step-down over one family of m: contrasts ranked by p (ties in list order), the contrast at rank r tested at
 *  step 0.05/(m - r), crossing when its |z| reaches that step's bound and every contrast ranked before it crossed. */
export function holmCrossings(items: readonly { p: number; z: number }[], m: number, x: ExtPrereg, at: 0 | 1 = 0): boolean[] {
  if (items.length > m) h2hFail("E_H2HX_ANALYSIS_INPUT", items.length + " contrasts in a Holm family of " + m);
  const out = items.map(() => false);
  let all = true;
  items.map((it, k) => ({ p: it.p, k })).sort((a, b) => a.p - b.p).forEach(({ k }, rank) => {
    all = all && items[k]!.z >= boundAt(x, m - rank, at);
    out[k] = all;
  });
  return out;
}

export type LookStop = "efficacy" | "gaps" | "cap" | "continue";
export interface LookResult { half: Record<UnitClass, number>; contrasts: { label: string; crossed: boolean }[]; stop: LookStop }

/** Part S's look half: the first half, rounded down, of each class of its stage 2 units in planExtStage's run order. */
export function lookHalf(stage2: readonly H2hUnit[], x: ExtPrereg = readExtPrereg()): Set<string> {
  const order = planExtStage("S", [...stage2], "stage2", x).units;
  const byId = new Map(stage2.map((u) => [u.id, u]));
  const want: Record<UnitClass, number> = { O: Math.floor(stage2.filter((u) => u.class === "O").length / 2), B: Math.floor(stage2.filter((u) => u.class === "B").length / 2) };
  const got: Record<UnitClass, number> = { O: 0, B: 0 };
  const half = new Set<string>();
  for (const id of order) {
    const c = byId.get(id)!.class;
    if (got[c] < want[c]) {
      got[c]++;
      half.add(id);
    }
  }
  return half;
}

/** The look over part S's stage 2 records. capStop is the ledger's cap stop on h2hx-s-main, if one came. */
export function interimLook(i: ExtInput, o: { x?: ExtPrereg; base?: H2hPrereg; capStop?: boolean } = {}): LookResult {
  const x = o.x ?? readExtPrereg(), base = o.base ?? readPrereg();
  const all = i.units.filter((u) => u.stage === "stage2");
  const half = lookHalf(all, x);
  const got: Record<UnitClass, number> = { O: 0, B: 0 };
  for (const u of all) if (half.has(u.id)) got[u.class]++;
  const keep = <T extends { unit: string }>(rows: readonly T[]) => rows.filter((r) => half.has(r.unit));
  const d = new ExtData("S", { units: all.filter((u) => half.has(u.id)), sessions: keep(i.sessions), scores: keep(i.scores), tests: keep(i.tests), stage: "stage2" }, x);
  const family = primaryFamily(d, "S", base, { withMdd: false });
  const crossed = holmCrossings(family.map((r) => ({ p: r.p_holm_input, z: r.incomplete ? 0 : absZ(r.test) })), x.parts.S.holm_m, x);
  const contrasts = family.map((r, k) => ({ label: "s-gstack minus " + r.other + ", " + r.class, crossed: crossed[k]! }));
  const line = sentenceContrast(d, "s-gstack-line", "s-gstack", base);
  const three = holmCrossings([
    { p: line.lines.p, z: line.lines.ratio !== null && line.lines.ratio < 1 ? zFromP(line.lines.p) : 0 },
    { p: line.fixes.p, z: absZ(line.fixes) },
    { p: line.tests.p, z: absZ(line.tests) },
  ], x.sentence_family.holm_within, x);
  contrasts.push({ label: "s-gstack-line: less-code ratio with both no-harm criteria passing", crossed: !line.incomplete && three[0]! && line.fixes_kept && line.tests_kept });
  const gaps = (["O", "B"] as const).some((c) => x.parts.S.arms.some((arm) => d.of(c, arm).length > 0 && cellOf(d, base, c, arm).incomplete));
  const stop: LookStop = o.capStop || d.capStop ? "cap" : gaps ? "gaps" : contrasts.every((c) => c.crossed) ? "efficacy" : "continue";
  return { half: got, contrasts, stop };
}

/** The look's printed lines: crossed or not crossed per deciding contrast, then the stop decision, and nothing else. */
export const lookLines = (r: LookResult): string[] => [...r.contrasts.map((c) => c.label + ": " + (c.crossed ? "crossed" : "not crossed")), "stop: " + r.stop];
