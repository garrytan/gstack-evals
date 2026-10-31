// Copyright (c) 2026 Garry Tan. MIT License.
// noloss secondary (stacks round 1 prereg, section 7): the two secondaries noloss score does not compute, for a variant
// and a reference arm on one suite.
// - New blockers: unmatched blocking findings that blind adjudication rules a defect, per pass per PR, paired by PR
//   cluster with the PR-clustered interval and the exact two-sided sign-flip test, the way score pairs false blockers.
//   It has no reading when either arm stopped or has a blocking finding with no adjudication row.
// - Idea-card wins: blocking blockers the variant found in every pass and the reference in none, beside a null from
//   swapping the two arms' labels within each unit at random (the permutations, seeded), with the null's mean and 95th
//   percentile (nearest rank). The arms need the same passes. A blocker either arm did not judge in a pass, or judged
//   with coverage incomplete, is left out and counted.
import { clusteredPairedDelta, seededRandom } from "../../src/runner/stats/paired.ts";
import type { Arm } from "./contract.ts";
import { ScoreError, tallyFalseBlockers } from "./score.ts";
import { lcm, twoSidedSignFlip } from "./stats.ts";
import { unitRef, type Suite } from "./suite.ts";

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

export interface NewBlockerReading {
  complete: boolean;
  reasons: string[];
  prs?: number;
  totals?: { variant: number; reference: number };
  per_pr?: { variant: number; reference: number };
  difference?: number;
  ci95?: number[] | null;
  p_two_sided?: number | null;
  min_p?: number | null;
}

export function newBlockers(suite: Suite, v: Arm, r: Arm, opts: { seed: number; draws: number }): NewBlockerReading {
  const tv = tallyFalseBlockers(suite, v);
  if ("reason" in tv) return { complete: false, reasons: [tv.reason] };
  const tr = tallyFalseBlockers(suite, r);
  if ("reason" in tr) return { complete: false, reasons: [tr.reason] };
  const reasons: string[] = [];
  for (const [a, t] of [[v, tv], [r, tr]] as const) {
    if ((a.arm.status ?? "complete") === "stopped") reasons.push("arm " + a.arm.id + " stopped");
    if (t.unadjudicated) reasons.push("arm " + a.arm.id + " has " + t.unadjudicated + " blocking finding" + (t.unadjudicated > 1 ? "s" : "") + " with no adjudication row");
  }
  const clusters = [...new Set(suite.units.map((u) => u.cluster))].sort();
  const sum = (t: typeof tv, c: string) => suite.units.filter((u) => u.cluster === c).reduce((s, u) => s + t.units.get(u.id)!.new, 0);
  const pv = v.arm.passes;
  const pr = r.arm.passes;
  const vals = clusters.map((c) => ({ c, v: sum(tv, c) / pv, r: sum(tr, c) / pr }));
  const mean = (k: "v" | "r") => round(vals.reduce((s, x) => s + x[k], 0) / vals.length);
  const base = { prs: clusters.length, totals: { variant: tv.new_blockers, reference: tr.new_blockers }, per_pr: { variant: mean("v"), reference: mean("r") } };
  if (reasons.length) return { complete: false, reasons, ...base };
  const d = clusteredPairedDelta(vals.map((x) => ({ id: x.c, cluster: x.c, a: x.r, b: x.v })), opts);
  const l = lcm(pv, pr);
  const test = twoSidedSignFlip(clusters.map((c) => sum(tv, c) * (l / pv) - sum(tr, c) * (l / pr)));
  return { complete: true, reasons, ...base, difference: round(d.delta), ci95: d.ci95 ? [round(d.ci95[0]), round(d.ci95[1])] : null, p_two_sided: test.p === null ? null : round(test.p, 6), min_p: test.min_p };
}

export function ideaWins(suite: Suite, v: Arm, r: Arm, opts: { seed: number; permutations: number }) {
  if (v.arm.passes !== r.arm.passes) throw new ScoreError("E_USAGE", "noloss secondary: idea-card wins need arms with the same passes; " + v.arm.id + " has " + v.arm.passes + " and " + r.arm.id + " has " + r.arm.passes);
  const passes = Array.from({ length: v.arm.passes }, (_, i) => i + 1);
  const rows = (a: Arm) => new Map((a.judgments ?? []).map((j) => [j.unit.id + " " + j.blocker.id + " " + j.pass, j]));
  const jv = rows(v);
  const jr = rows(r);
  let left = 0;
  const units: Array<Array<{ ref: string; vAll: boolean; vNone: boolean; rAll: boolean; rNone: boolean }>> = [];
  for (const u of suite.units) {
    const list = [];
    for (const b of u.blockers) {
      if (b.counts !== "blocking") continue;
      const got = (m: typeof jv) => passes.map((p) => m.get(u.id + " " + b.id + " " + p));
      const gv = got(jv);
      const gr = got(jr);
      if ([...gv, ...gr].some((j) => !j || j.coverage !== "complete")) {
        left++;
        continue;
      }
      const found = (js: typeof gv) => js.map((j) => j!.outcome === "F");
      list.push({ ref: unitRef(suite, u) + " " + b.id, vAll: found(gv).every(Boolean), vNone: !found(gv).some(Boolean), rAll: found(gr).every(Boolean), rNone: !found(gr).some(Boolean) });
    }
    units.push(list);
  }
  const wins = units.flat().filter((x) => x.vAll && x.rNone);
  const rng = seededRandom(opts.seed);
  const draws = Array.from({ length: opts.permutations }, () => units.reduce((n, list) => (rng() < 0.5 ? n + list.filter((x) => x.rAll && x.vNone).length : n + list.filter((x) => x.vAll && x.rNone).length), 0)).sort((a, b) => a - b);
  const p95 = draws[Math.ceil(0.95 * draws.length) - 1]!;
  return { wins: wins.length, blockers: units.flat().length, left_out: left, null_mean: round(draws.reduce((s, x) => s + x, 0) / draws.length), null_p95: p95, above_null: wins.length > p95, won: wins.map((x) => x.ref) };
}
