// Copyright (c) 2026 Garry Tan. MIT License.
// Part C's analysis (preregistration section 5.4). Every contrast is paired, b minus a: by bug-pass (a unit's blocking bug
// at one pass) for found and blocking, and by session (a unit at one pass) for the per-state counts, unmatched findings,
// new blockers and false blockers, clustered by pull request either way. Each gives R2's pull-request-clustered
// bootstrap (clusteredPairedDelta, 10,000 resamples, seed 20261119) and the exact two-sided cluster sign-flip test
// (twoSidedSignFlip in lanes/review-noloss/stats.ts, which counts every sign flip over the clusters whose sum is not 0
// exactly, by convolution, with no random draw; tests/codex-hooks/c/analysis/stats.test.ts checks it against a literal
// enumeration). A pair is dropped when either side's session was not scored. Readings follow section 1: above 0 or
// below 0 only when the interval excludes 0 and p < 0.05, not shown when the interval excludes 0 and p >= 0.05, else
// includes 0.
import { clusteredPairedDelta, type PairedItem } from "../../../../src/runner/stats/paired.ts";
import { twoSidedSignFlip } from "../../../review-noloss/stats.ts";
import type { Suite, Unit } from "../../../review-noloss/suite.ts";
import { ALPHA, ARMS, DRAWS, INCOMPLETE_ABOVE, MAX_SIGN_FLIP_CLUSTERS, SEED, type CArm, type CState } from "./frozen.ts";
import { blockingBugs, type StatesFile } from "./record.ts";
import type { Scored, StateScore } from "./score.ts";

export type ReadingKind = "above" | "below" | "not_shown" | "includes";
export type Metric = "found" | "blocking" | "unmatched" | "new_blockers" | "false_blockers";
export type Side = { arm: CArm; state: CState };

export interface Stats {
  pairs: number;
  clusters: number;
  mean_a: number;
  mean_b: number;
  /** mean(b - a), in the metric's units: a share of bug-passes for found and blocking, a count per session otherwise. */
  delta: number;
  ci95: [number, number] | null;
  p: number | null;
  min_p: number | null;
  informative_clusters: number;
  /** Pairs where b is above a, and below. */
  gains: number;
  losses: number;
}

export interface Contrast {
  name: string;
  metric: Metric;
  a: Side;
  b: Side;
  /** Pairs the design has, and pairs dropped because a side's session was not scored. */
  planned: number;
  dropped: number;
  /** Why the numbers are withheld (an unmapped label, an unadjudicated finding), or null. */
  incomplete: string | null;
  stats: Stats | null;
  reading: ReadingKind;
}

/** Section 1's reading of an interval and a sign-flip p. */
export function readingOf(ci: [number, number] | null, p: number | null): ReadingKind {
  if (!ci || !(ci[0] > 0 || ci[1] < 0)) return "includes";
  if (p === null || p >= ALPHA) return "not_shown";
  return ci[0] > 0 ? "above" : "below";
}

/** The bootstrap and the exact sign-flip test on paired items, b minus a. */
export function pairedStats(pairs: readonly PairedItem[], o: { seed?: number; draws?: number; maxClusters?: number } = {}): Stats | null {
  if (!pairs.length) return null;
  const d = clusteredPairedDelta(pairs, { seed: o.seed ?? SEED, draws: o.draws ?? DRAWS });
  const sums = new Map<string, number>();
  for (const p of pairs) sums.set(p.cluster, (sums.get(p.cluster) ?? 0) + (p.b - p.a));
  const values = [...sums.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, v]) => v);
  const nonzero = values.filter((v) => v !== 0).length;
  if (o.maxClusters !== undefined && nonzero > o.maxClusters) throw new Error("E_CH_C_FROZEN the sign-flip test enumerates at most 2^" + o.maxClusters + " flips, and this contrast has " + nonzero + " clusters whose sum is not 0");
  const t = twoSidedSignFlip(values);
  return { pairs: d.n_pairs, clusters: d.n_clusters, mean_a: d.mean_a, mean_b: d.mean_b, delta: d.delta, ci95: d.ci95, p: t.p, min_p: t.min_p, informative_clusters: t.informative_clusters, gains: pairs.filter((p) => p.b > p.a).length, losses: pairs.filter((p) => p.b < p.a).length };
}

type Index = Map<string, Record<CState, StateScore>>;
const cellKey = (arm: CArm, unit: string, pass: number) => arm + " " + unit + " " + pass;

export function indexScores(scored: Scored): Index {
  return new Map(scored.sessions.map((s) => [cellKey(s.session.arm, s.session.unit.id, s.session.pass), s.states]));
}

const sessionValue = (s: StateScore, m: Metric) => (m === "unmatched" ? s.unmatched : m === "new_blockers" ? s.new_blockers : s.false_blockers);

/** One contrast over the run's units and passes. */
export function contrast(name: string, metric: Metric, a: Side, b: Side, o: { index: Index; units: readonly Unit[]; passes: number }): Contrast {
  const pairs: PairedItem[] = [];
  let planned = 0;
  const problems = new Set<string>();
  const byBug = metric === "found" || metric === "blocking";
  for (const u of o.units)
    for (let pass = 1; pass <= o.passes; pass++) {
      const bugs = blockingBugs(u);
      if (byBug && !bugs.length) continue;
      planned += byBug ? bugs.length : 1;
      const x = o.index.get(cellKey(a.arm, u.id, pass))?.[a.state];
      const y = o.index.get(cellKey(b.arm, u.id, pass))?.[b.state];
      if (!x || !y) continue;
      for (const s of [x, y]) {
        if (metric === "blocking" && s.unmapped.length) problems.add(s.arm + " has labels no severity map names: " + s.unmapped.join(", "));
        if ((metric === "new_blockers" || metric === "false_blockers") && s.unadjudicated) problems.add(s.arm + " has blocking findings with no adjudication ruling");
        if ((metric === "new_blockers" || metric === "false_blockers") && s.unmapped.length) problems.add(s.arm + " has labels no severity map names: " + s.unmapped.join(", "));
      }
      if (byBug) for (const bug of bugs) pairs.push({ id: u.id + " " + bug.id + " " + pass, cluster: u.cluster, a: Number(x[metric as "found"][bug.id]), b: Number(y[metric as "found"][bug.id]) });
      else pairs.push({ id: u.id + " " + pass, cluster: u.cluster, a: sessionValue(x, metric), b: sessionValue(y, metric) });
    }
  const incomplete = problems.size ? [...problems].sort().join("; ") : null;
  const stats = incomplete ? null : pairedStats(pairs, { maxClusters: byBug ? MAX_SIGN_FLIP_CLUSTERS : undefined });
  return { name, metric, a, b, planned, dropped: planned - pairs.length, incomplete, stats, reading: stats ? readingOf(stats.ci95, stats.p) : "includes" };
}

export interface ArmSummary {
  arm: CArm;
  planned: number;
  scored: number;
  /** Sessions not scored: gaps and cap stops by reason code, units with no line, and judge gaps. */
  not_scored: Record<string, number>;
  not_scored_total: number;
  incomplete: boolean;
  reruns: number;
  limit_stops: number;
  safety_stops: number;
  no_text: number;
  blocked: number;
  false_block_sessions: number;
  fail_open_sessions: number;
  would_block: number;
  extracted_states: Record<CState, number>;
  /** Blocked sessions whose final state counts no finding while its first stop counted some: scored as written (section 6, attack 8). */
  final_refers_back: number;
  per_state: Record<CState, { found: number; blocking: number | null; bug_passes: number; counted: number; unmatched: number; new_blockers: number | null; false_blockers: number | null; unadjudicated: number; unmapped: string[] }>;
  cost: { sessions_metered: number; total_usd: number; mean_usd: number | null; per_found_bug_usd: number | null };
}

/** Per arm: supply, gaps, stops, exposure counts, per-state totals and cost. */
export function armSummaries(states: StatesFile, scored: Scored, o: { units: readonly Unit[]; passes: number }): Record<CArm, ArmSummary> {
  const out = {} as Record<CArm, ArmSummary>;
  for (const arm of ARMS) {
    const sessions = states.sessions.filter((s) => s.arm === arm);
    const mine = scored.sessions.filter((s) => s.session.arm === arm);
    const notScored: Record<string, number> = {};
    const bump = (k: string) => (notScored[k] = (notScored[k] ?? 0) + 1);
    for (const s of sessions) if (s.outcome !== "scored") bump(s.outcome_code!);
    for (const _ of states.missing.filter((m) => m.arm === arm)) bump("E_CH_C_NO_RECORD");
    for (const _ of scored.judge_gaps.filter((g) => g.arm === arm)) bump("E_CH_C_JUDGE_GAP");
    const total = Object.values(notScored).reduce((x, y) => x + y, 0);
    const perState = {} as ArmSummary["per_state"];
    for (const st of ["first_stop", "final"] as const) {
      const ss = mine.map((m) => m.states[st]);
      const sum = (f: (s: StateScore) => number) => ss.reduce((n, s) => n + f(s), 0);
      const unmapped = [...new Set(ss.flatMap((s) => s.unmapped))].sort();
      const unadj = sum((s) => s.unadjudicated);
      perState[st] = { found: sum((s) => Object.values(s.found).filter(Boolean).length), blocking: unmapped.length ? null : sum((s) => Object.values(s.blocking).filter(Boolean).length), bug_passes: sum((s) => Object.keys(s.found).length), counted: sum((s) => s.counted), unmatched: sum((s) => s.unmatched), new_blockers: unadj || unmapped.length ? null : sum((s) => s.new_blockers), false_blockers: unadj || unmapped.length ? null : sum((s) => s.false_blockers), unadjudicated: unadj, unmapped };
    }
    const metered = mine.filter((m) => m.session.cost.usd !== null);
    const totalUsd = metered.reduce((n, m) => n + m.session.cost.usd!, 0);
    out[arm] = {
      arm,
      planned: o.units.length * o.passes,
      scored: mine.length,
      not_scored: notScored,
      not_scored_total: total,
      incomplete: total > INCOMPLETE_ABOVE,
      reruns: sessions.filter((s) => s.attempts === 2).length,
      limit_stops: sessions.filter((s) => s.limit_stop).length,
      safety_stops: sessions.filter((s) => s.safety_stop).length,
      no_text: sessions.filter((s) => s.no_text).length,
      blocked: mine.filter((m) => m.session.blocked).length,
      false_block_sessions: mine.filter((m) => m.session.exposure?.false_block).length,
      fail_open_sessions: mine.filter((m) => m.session.exposure?.fail_open).length,
      would_block: mine.filter((m) => m.session.exposure?.would_block).length,
      extracted_states: { first_stop: mine.filter((m) => m.session.blocked && m.states.first_stop.extracted).length, final: mine.filter((m) => m.states.final.extracted).length },
      final_refers_back: mine.filter((m) => m.session.blocked && m.states.final.counted === 0 && m.states.first_stop.counted > 0).length,
      per_state: perState,
      cost: { sessions_metered: metered.length, total_usd: totalUsd, mean_usd: metered.length ? totalUsd / metered.length : null, per_found_bug_usd: metered.length === mine.length && perState.final.found ? totalUsd / perState.final.found : null },
    };
  }
  return out;
}

export interface Analysis {
  units: number;
  passes: number;
  /** A cap stop anywhere in part C ends the part INCOMPLETE (section 5.8). */
  cap_stop: boolean;
  arms: Record<CArm, ArmSummary>;
  /** The contract's primary: c-on's final minus its first stop. */
  primary: Contrast;
  /** Check A: c-on's first stop minus c-off's final. It fails when its interval excludes 0 or its p is under 0.05. */
  check_a: Contrast;
  check_a_fails: boolean;
  /** Within c-on, final minus first stop, for the other metrics (section 6, attack 9). */
  within: Contrast[];
  /** Between arms, final against final, for every metric. */
  between: Contrast[];
  /** E3: c-high's final minus c-on's final. */
  e3: Contrast;
  /** Section 1's E3 KEEP row gives this: c-high's added cost per added known bug, over the scored sessions. */
  e3_cost_per_added_bug_usd: number | null;
}

const fs: Side["state"] = "first_stop";
const S = (arm: CArm, state: CState = "final"): Side => ({ arm, state });
export const BETWEEN: ReadonlyArray<{ name: string; a: Side; b: Side }> = [
  { name: "c-on minus c-off", a: S("c-off"), b: S("c-on") },
  { name: "c-on minus c-none", a: S("c-none"), b: S("c-on") },
  { name: "c-off minus c-none", a: S("c-none"), b: S("c-off") },
  { name: "c-high minus c-none", a: S("c-none"), b: S("c-high") },
  { name: "c-high minus c-on", a: S("c-on"), b: S("c-high") },
];
const METRICS: readonly Metric[] = ["found", "blocking", "unmatched", "new_blockers", "false_blockers"];

export function analyze(suite: Suite, states: StatesFile, scored: Scored, o: { units: readonly string[]; passes: number }): Analysis {
  const units = suite.units.filter((u) => o.units.includes(u.id));
  const run = { index: indexScores(scored), units, passes: o.passes };
  const arms = armSummaries(states, scored, { units, passes: o.passes });
  const primary = contrast("contract primary: c-on final minus c-on first stop", "found", S("c-on", fs), S("c-on"), run);
  const checkA = contrast("check A: c-on first stop minus c-off final", "found", S("c-off"), S("c-on", fs), run);
  const e3 = contrast("E3: c-high final minus c-on final", "found", S("c-on"), S("c-high"), run);
  const hi = arms["c-high"];
  const on = arms["c-on"];
  const added = hi.per_state.final.found - on.per_state.final.found;
  const metered = hi.cost.sessions_metered === hi.scored && on.cost.sessions_metered === on.scored;
  return {
    units: units.length,
    passes: o.passes,
    cap_stop: states.sessions.some((s) => s.outcome === "cap_stop"),
    arms,
    primary,
    check_a: checkA,
    check_a_fails: checkA.stats !== null && ((checkA.stats.ci95 !== null && (checkA.stats.ci95[0] > 0 || checkA.stats.ci95[1] < 0)) || (checkA.stats.p !== null && checkA.stats.p < ALPHA)),
    within: METRICS.filter((m) => m !== "found").map((m) => contrast("within c-on, " + m + ": final minus first stop", m, S("c-on", fs), S("c-on"), run)),
    between: BETWEEN.flatMap((c) => METRICS.map((m) => contrast(c.name + ", " + m, m, c.a, c.b, run))),
    e3,
    e3_cost_per_added_bug_usd: metered && added > 0 ? (hi.cost.total_usd - on.cost.total_usd) / added : null,
  };
}
