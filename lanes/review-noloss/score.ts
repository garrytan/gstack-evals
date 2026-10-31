// Copyright (c) 2026 Garry Tan. MIT License.
// noloss score (plan sections 4 and 5): an arm's metrics on a suite, and the paired comparison of a variant V against a
// reference R. Each blocker's value is the share of an arm's passes that FOUND it; PRs are the clusters. A comparison
// needs a margin and its reason; there is no default. The verdict comes from the exact tests in stats.ts, with the
// no-loss p-values Holm-adjusted across the comparisons one call makes (as the verdict engine does for margins; the
// LOSS test is not adjusted, like its WORSE). The record keeps the statistical result apart from whether the claim
// "non-inferior within the margin" may be made, and why not. Labelled and blind judgments are never pooled.
// A run may declare a LOSS family (GEVA-59 T8): its comparisons' LOSS p-values are Holm-adjusted in the declared order
// under a frozen null, and LOSS is decided on the adjusted p. Beside the verdict, the false-blocker reading (T6, T9)
// pairs each PR's false blockers per pass across the two arms with an exact two-sided sign-flip test over PRs.
import { clusteredPairedDelta, holmAdjusted, type PairedItem } from "../../src/runner/stats/paired.ts";
import type { ReasonCode } from "../../src/errors/codes.ts";
import { mapSeverity, matchedBlockers, type Arm, type CostRow, type Grade, type Judgment } from "./contract.ts";
import { POWER_GOAL, simulate, spreadValue, suiteClusters } from "./power.ts";
import { ALPHA, decide, holmSteps, lcm, pairedTests, twoSidedSignFlip, type SignFlip, type Verdict } from "./stats.ts";
import type { Blocker, FrozenBar, Suite, Unit } from "./suite.ts";

export const SCORE_VERSION = 1;
export const DEFAULT_SEED = 1;
export const DEFAULT_DRAWS = 10000;
const GRADES: Grade[] = ["exact", "lane", "upper-bound", "estimate"];

export class ScoreError extends Error {
  constructor(
    readonly code: ReasonCode,
    message: string,
  ) {
    super(message);
  }
}

export type SizeRuleSpec = { power: number; source: string } | { power_sims: number; spread?: string };

export interface Comparison {
  id: string;
  variant: string;
  reference: string;
  margin_points: number;
  margin_reason: string;
  post_hoc: boolean;
  /** The round of the suite's frozen bar that scores the variant first, or null. */
  frozen_bar: string | null;
  /** A same-window repeat of the reference: their discordance is the noise floor printed beside the comparison. */
  reference_repeat?: string;
  size_rule?: SizeRuleSpec;
  /** The smallest drop in false blockers per PR that counts (the preregistration freezes it). */
  false_blocker_drop?: number;
  note?: string;
}

/** A declared LOSS family: its comparisons' LOSS p-values are Holm-adjusted together, in this order. */
export interface LossFamily {
  /** Comparison ids, in the declared order. */
  order: string[];
  /** zero: the LOSS null is "V is no worse than R"; margin: "V is no worse than R by more than the comparison's margin". */
  null: "zero" | "margin";
  reason: string;
}

/** An arm as scored: parsed, judged, with the tree digest it was ingested under. */
export interface ScoredArm {
  arm: Arm;
  tree_sha256: string;
}

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const key = (u: Unit, b: Blocker) => u.id + " " + b.id;
const weaker = (a: Grade, b: Grade): Grade => (GRADES.indexOf(a) >= GRADES.indexOf(b) ? a : b);

/** Judgments by blocker, indexed by pass (1-based). */
function byBlocker(arm: Arm): Map<string, Map<number, Judgment>> {
  const m = new Map<string, Map<number, Judgment>>();
  for (const j of arm.judgments ?? []) {
    const k = key(j.unit, j.blocker);
    if (!m.has(k)) m.set(k, new Map());
    m.get(k)!.set(j.pass, j);
  }
  return m;
}

function shareOf(arm: Arm, js: Map<string, Map<number, Judgment>>, u: Unit, b: Blocker, hit: (j: Judgment) => boolean): number {
  const rows = js.get(key(u, b));
  let n = 0;
  for (let p = 1; p <= arm.arm.passes; p++) if (rows?.get(p) && hit(rows.get(p)!)) n++;
  return n / arm.arm.passes;
}

const found = (j: Judgment) => j.outcome === "F";
const blocking = (b: Blocker) => b.counts === "blocking";

function withInterval(values: Array<{ cluster: string; v: number }>, seed: number, draws: number) {
  if (!values.length) return null;
  const d = clusteredPairedDelta(values.map((x, i) => ({ id: String(i), cluster: x.cluster, a: 0, b: x.v })), { seed, draws });
  return { n: values.length, found: round(values.reduce((s, x) => s + x.v, 0)), recall: round(d.mean_b), ci95: d.ci95 ? ([round(d.ci95[0]), round(d.ci95[1])] as [number, number]) : null };
}

/** PR hit (every blocking blocker found) and PR any (at least one), per pass, then averaged over passes. */
function prRates(suite: Suite, arm: Arm, js: Map<string, Map<number, Judgment>>, group?: string | null) {
  const units = suite.units.filter((u) => u.blockers.some(blocking) && (group === undefined || u.group === group));
  if (!units.length) return null;
  let hit = 0;
  let any = 0;
  for (let p = 1; p <= arm.arm.passes; p++)
    for (const u of units) {
      const f = u.blockers.filter(blocking).map((b) => js.get(key(u, b))?.get(p)?.outcome === "F");
      if (f.every(Boolean)) hit++;
      if (f.some(Boolean)) any++;
    }
  const n = units.length * arm.arm.passes;
  return { prs: units.length, hit: round(hit / n), any: round(any / n) };
}

interface Metered {
  tokens: number;
  wall: number | null;
  usd: number | null;
  grade: Grade;
}

/** Per-pass totals from all-scope rows: per unit, and per aggregate row (pr * with covers). Components are not totals. */
function meter(arm: Arm): { units: Map<string, Metered>; aggregates: Array<Metered & { units: string[] }>; notes: string[] } {
  const reasons = new Map<string, number>();
  const note = (why: string) => reasons.set(why, (reasons.get(why) ?? 0) + 1);
  const groups = new Map<string, { units: string[]; aggregate: boolean; rows: CostRow[] }>();
  for (const r of arm.cost.filter((r) => /^all\b/.test(r.scope))) {
    const ids = r.units.map((u) => u.id).sort();
    const k = (r.aggregate ? "* " : "") + ids.join(",");
    if (!groups.has(k)) groups.set(k, { units: ids, aggregate: r.aggregate, rows: [] });
    groups.get(k)!.rows.push(r);
  }
  const units = new Map<string, Metered>();
  const aggregates: Array<Metered & { units: string[] }> = [];
  const passes = arm.arm.passes;
  for (const g of groups.values()) {
    const what = g.aggregate ? "pr * rows" : "units";
    const everyPass = g.rows.filter((r) => r.pass === null);
    const perPass = new Set(g.rows.filter((r) => r.pass !== null).map((r) => r.pass));
    if (everyPass.length && perPass.size) {
      note(what + " with an every-pass total and per-pass totals that would count twice, so not metered");
      continue;
    }
    if (!everyPass.length && perPass.size < passes) {
      note(what + " with totals for only some passes, so not metered");
      continue;
    }
    if (g.rows.some((r) => r.values.total_tokens === null)) {
      note(what + " whose total_tokens is unknown, so not metered");
      continue;
    }
    const sum = (k: "total_tokens" | "wall_seconds" | "usd") => (g.rows.some((r) => r.values[k] === null) ? null : g.rows.reduce((s, r) => s + r.values[k]!, 0) / passes);
    const m: Metered = { tokens: sum("total_tokens")!, wall: sum("wall_seconds"), usd: sum("usd"), grade: g.rows.map((r) => r.grade).reduce(weaker) };
    if (g.aggregate) aggregates.push({ ...m, units: g.units });
    else units.set(g.units[0]!, m);
  }
  const overlapping = aggregates.filter((a) => aggregates.some((b) => b !== a && b.units.some((u) => a.units.includes(u))));
  for (const a of overlapping) {
    aggregates.splice(aggregates.indexOf(a), 1);
    note("pr * rows whose covers overlap another pr * row, which would count shared units twice, so not metered");
  }
  for (const a of aggregates)
    for (const u of a.units)
      if (units.has(u)) {
        units.delete(u);
        note("units with their own total inside a pr * row, which would count them twice, so their own totals are dropped");
      }
  return { units, aggregates, notes: [...reasons].map(([why, n]) => n + " " + why) };
}

export interface CostSummary {
  units: number;
  tokens_per_pass: number;
  per_unit_mean: number;
  per_unit_median: number | null;
  found: number;
  per_blocker_found: number | null;
  wall_seconds_per_pass: number | null;
  usd_per_pass: number | null;
  grade: Grade;
  notes: string[];
}

function costOn(suite: Suite, arm: Arm, m: ReturnType<typeof meter>, set: Set<string>, extraNotes: string[] = []): CostSummary | null {
  const parts: Metered[] = [...m.units].filter(([u]) => set.has(u)).map(([, v]) => v);
  const aggs = m.aggregates.filter((a) => a.units.every((u) => set.has(u)));
  parts.push(...aggs);
  if (!parts.length) return null;
  const js = byBlocker(arm);
  const units = suite.units.filter((u) => set.has(u.id));
  const nFound = units.reduce((s, u) => s + u.blockers.filter(blocking).reduce((t, b) => t + shareOf(arm, js, u, b, found), 0), 0);
  const tokens = parts.reduce((s, p) => s + p.tokens, 0);
  const sum = (k: "wall" | "usd") => (parts.some((p) => p[k] === null) ? null : parts.reduce((s, p) => s + p[k]!, 0));
  const per = [...m.units].filter(([u]) => set.has(u)).map(([, v]) => v.tokens).sort((a, b) => a - b);
  const notes = [...m.notes, ...extraNotes];
  if (aggs.length) notes.push("a pr * row has no per-unit values, so there is no median");
  if (nFound === 0) notes.push("no blocker was found on these units, so there is no cost per blocker found");
  return {
    units: set.size,
    tokens_per_pass: round(tokens, 0),
    per_unit_mean: round(tokens / set.size, 0),
    per_unit_median: aggs.length ? null : per.length % 2 ? per[(per.length - 1) / 2]! : round((per[per.length / 2 - 1]! + per[per.length / 2]!) / 2, 0),
    found: round(nFound),
    per_blocker_found: nFound ? round(tokens / nFound, 0) : null,
    wall_seconds_per_pass: sum("wall"),
    usd_per_pass: sum("usd"),
    grade: parts.map((p) => p.grade).reduce(weaker),
    notes,
  };
}

const meteredUnits = (m: ReturnType<typeof meter>) => new Set([...m.units.keys(), ...m.aggregates.flatMap((a) => a.units)]);

/** Cost on the units metered in both arms, at the weaker grade. An aggregate row is never split to fit the other arm. */
export function pairedCost(suite: Suite, v: Arm, r: Arm): { variant: CostSummary; reference: CostSummary; grade: Grade } | { reason: string } {
  const mv = meter(v);
  const mr = meter(r);
  const bare = [v, r].filter((a, i) => meteredUnits([mv, mr][i]!).size === 0).map((a) => a.arm.id);
  if (bare.length) return { reason: (bare.length > 1 ? "arms " + bare.join(" and ") + " have" : "arm " + bare[0] + " has") + " no metered units" };
  const common = new Set([...meteredUnits(mv)].filter((u) => meteredUnits(mr).has(u)));
  const notes: string[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const a of [...mv.aggregates, ...mr.aggregates]) {
      const inside = a.units.filter((u) => common.has(u)).length;
      if (inside && inside < a.units.length) {
        a.units.forEach((u) => common.delete(u));
        notes.push("a pr * row covers " + a.units.length + " units but only " + inside + " are metered in both arms; it is not split, so those units are left out");
        changed = true;
      }
    }
  }
  if (!common.size) return { reason: "no unit is metered in both arms" + (notes.length ? " (" + notes.join("; ") + ")" : "") };
  const cv = costOn(suite, v, mv, common, notes)!;
  const cr = costOn(suite, r, mr, common, notes)!;
  return { variant: cv, reference: cr, grade: weaker(cv.grade, cr.grade) };
}

/** CRITICAL findings that match no blocker, per pass and per PR; null for a transcribed arm, which has no findings. */
function newBlockingFindings(suite: Suite, arm: Arm): { per_pass: number; per_pr: number } | null {
  if (!arm.findings) return null;
  const js = byBlocker(arm);
  let n = 0;
  for (const u of suite.units)
    for (let p = 1; p <= arm.arm.passes; p++) {
      const matched = new Set(u.blockers.flatMap((b) => js.get(key(u, b))?.get(p)?.matched.map((x) => x.id) ?? []));
      n += (arm.findings.get(u.id) ?? []).filter((x) => x.pass === p && !matched.has(x.id) && mapSeverity(arm.arm, x.raw, x.reader) === "CRITICAL").length;
    }
  return { per_pass: round(n / arm.arm.passes), per_pr: round(n / arm.arm.passes / suite.units.length) };
}

interface FalseBlockerTally {
  /** Per unit id, summed over passes. */
  units: Map<string, { false: number; unadjudicated: number; new: number }>;
  not_defect: number;
  known_informational: number;
  new_blockers: number;
  unadjudicated: number;
  labelled: boolean;
  blind: boolean;
}

/**
 * Every blocking finding once. judgments.tsv settles a matched one: a blocking or detection-only blocker makes it a real
 * defect, an over-blocking blocker alone makes it over-block the known informational case. adjudication.tsv rules on
 * the rest; a finding with no row is unadjudicated and is never counted as not a defect.
 */
export function tallyFalseBlockers(suite: Suite, arm: Arm): FalseBlockerTally | { reason: string } {
  if (!arm.findings) return { reason: "arm " + arm.arm.id + " is transcribed: it has no findings to adjudicate" };
  const matched = matchedBlockers(arm.judgments ?? []);
  const rows = arm.adjudications ?? [];
  const ruled = new Map(rows.map((a) => [a.finding, a.ruling]));
  const t: FalseBlockerTally = { units: new Map(), not_defect: 0, known_informational: 0, new_blockers: 0, unadjudicated: 0, labelled: rows.some((a) => a.saw_label), blind: rows.some((a) => !a.saw_label) };
  for (const u of suite.units) {
    const cell = { false: 0, unadjudicated: 0, new: 0 };
    for (const f of arm.findings.get(u.id) ?? []) {
      if (mapSeverity(arm.arm, f.raw, f.reader) !== "CRITICAL") continue;
      const blockers = matched.get(f) ?? [];
      if (blockers.some((b) => b.counts !== "over-blocking")) continue;
      const ruling = blockers.length ? "known-informational" : ruled.get(f);
      if (ruling === undefined) {
        cell.unadjudicated++;
        t.unadjudicated++;
      } else if (ruling === "defect") {
        cell.new++;
        t.new_blockers++;
      }
      else {
        cell.false++;
        if (ruling === "not-defect") t.not_defect++;
        else t.known_informational++;
      }
    }
    t.units.set(u.id, cell);
  }
  return t;
}

export interface FalseBlockerReading {
  /** False when a blocking finding has no adjudication row, an arm stopped, or labelled and blind adjudication would pool. */
  complete: boolean;
  reasons: string[];
  labelled: boolean;
  prs: number;
  per_pr: { variant: number; reference: number };
  /** Variant minus reference, false blockers per pass per PR; negative means the variant raises fewer. */
  difference: number | null;
  ci95: [number, number] | null;
  p_two_sided: number | null;
  min_p: number | null;
  drop: number | null;
  /** Whether the estimate is a drop of at least drop per PR. */
  clears_drop: boolean | null;
  interval_below_zero: boolean | null;
  table: Array<{ pr: string; variant: number; reference: number; difference: number; variant_unadjudicated: number; reference_unadjudicated: number }>;
}

/** False blockers per pass, paired by PR: the mean difference, its PR-clustered interval and the exact two-sided sign-flip test. */
function falseBlockers(suite: Suite, v: Arm, r: Arm, drop: number | null, noVerdict: string | null, opts: { seed: number; draws: number }): FalseBlockerReading | { reason: string } {
  const tv = tallyFalseBlockers(suite, v);
  if ("reason" in tv) return tv;
  const tr = tallyFalseBlockers(suite, r);
  if ("reason" in tr) return tr;
  const clusters = [...new Set(suite.units.map((u) => u.cluster))].sort();
  const sum = (t: FalseBlockerTally, c: string, k: "false" | "unadjudicated") => suite.units.filter((u) => u.cluster === c).reduce((s, u) => s + t.units.get(u.id)![k], 0);
  const pv = v.arm.passes;
  const pr = r.arm.passes;
  const vals = clusters.map((c) => ({ c, v: sum(tv, c, "false") / pv, r: sum(tr, c, "false") / pr }));
  const table = vals.map((x, i) => ({ pr: suite.sealed ? "PR " + (i + 1) : x.c, variant: round(x.v), reference: round(x.r), difference: round(x.v - x.r), variant_unadjudicated: sum(tv, x.c, "unadjudicated"), reference_unadjudicated: sum(tr, x.c, "unadjudicated") }));
  const reasons: string[] = noVerdict ? [noVerdict] : [];
  for (const [a, t] of [[v, tv], [r, tr]] as const) if (t.unadjudicated) reasons.push("arm " + a.arm.id + " has " + t.unadjudicated + " blocking finding" + (t.unadjudicated > 1 ? "s" : "") + " with no adjudication row");
  if ((tv.labelled || tr.labelled) && (tv.blind || tr.blind)) reasons.push("labelled and blind adjudication are never pooled");
  const mean = (k: "v" | "r") => round(vals.reduce((s, x) => s + x[k], 0) / vals.length);
  const base = { labelled: tv.labelled || tr.labelled, prs: clusters.length, per_pr: { variant: mean("v"), reference: mean("r") }, drop, table };
  if (reasons.length) return { complete: false, reasons, ...base, difference: null, ci95: null, p_two_sided: null, min_p: null, clears_drop: null, interval_below_zero: null };
  const d = clusteredPairedDelta(vals.map((x) => ({ id: x.c, cluster: x.c, a: x.r, b: x.v })), opts);
  const l = lcm(pv, pr);
  const test = twoSidedSignFlip(clusters.map((c) => sum(tv, c, "false") * (l / pv) - sum(tr, c, "false") * (l / pr)));
  return { complete: true, reasons, ...base, difference: round(d.delta), ci95: d.ci95 ? [round(d.ci95[0]), round(d.ci95[1])] : null, p_two_sided: test.p === null ? null : round(test.p, 6), min_p: test.min_p, clears_drop: drop === null ? null : d.delta <= -drop + 1e-9, interval_below_zero: d.ci95 ? d.ci95[1] < 0 : null };
}

export interface ArmMetrics {
  id: string;
  label: string;
  kind: string | null;
  provenance: "live" | "transcribed";
  status: "complete" | "stopped";
  passes: number;
  tree_sha256: string;
  judging: { labelled: boolean; blind_share: number; judges: string[] };
  blocking: ReturnType<typeof withInterval>;
  detection: ReturnType<typeof withInterval>;
  over_blocking: { n: number; rate: number } | null;
  over_blocking_reason: string | null;
  pr_hit_any: { all: ReturnType<typeof prRates>; by_group: Record<string, ReturnType<typeof prRates>> };
  by_location: Record<string, { n: number; found: number; recall: number }>;
  f_share: number | null;
  new_blocking: { per_pass: number; per_pr: number } | null;
  new_blocking_reason: string | null;
  /** Per pass: false blockers per PR, by kind, and the blocking findings that still lack a ruling. */
  false_blockers: { per_pr: number; not_defect: number; known_informational: number; new_blockers: number; unadjudicated: number; labelled: boolean } | null;
  false_blockers_reason: string | null;
  incomplete: number;
  cost: CostSummary | null;
}

export function armMetrics(suite: Suite, s: ScoredArm, opts: { seed: number; draws: number }): ArmMetrics {
  const { arm } = s;
  if (!arm.judgments) throw new ScoreError("E_NOLOSS_JUDGMENT", "arm " + arm.arm.id + " is raw: it has findings but no judgments.tsv. Build judge packets (noloss judge-packet), judge them, and join the reply (noloss judge-join) before scoring.");
  const js = byBlocker(arm);
  const cells = suite.units.flatMap((u) => u.blockers.map((b) => ({ u, b })));
  const values = (keep: (b: Blocker) => boolean, hit: (j: Judgment) => boolean) => cells.filter((c) => keep(c.b)).map((c) => ({ cluster: c.u.cluster, v: shareOf(arm, js, c.u, c.b, hit) }));
  const block = cells.filter((c) => blocking(c.b));
  const byLocation: ArmMetrics["by_location"] = {};
  for (const c of block) {
    const l = (byLocation[c.b.location] ??= { n: 0, found: 0, recall: 0 });
    l.n++;
    l.found = round(l.found + shareOf(arm, js, c.u, c.b, found));
    l.recall = round(l.found / l.n);
  }
  let f = 0;
  let d = 0;
  for (const c of block)
    for (const j of js.get(key(c.u, c.b))?.values() ?? []) {
      if (j.outcome === "F") f++;
      if (j.outcome === "D") d++;
    }
  const over = values((b) => b.counts === "over-blocking", found);
  const newBlocking = newBlockingFindings(suite, arm);
  const groups = [...new Set(suite.units.map((u) => u.group).filter((g): g is string => g !== null))].sort();
  const judgments = arm.judgments;
  const own = meter(arm);
  const fb = tallyFalseBlockers(suite, arm);
  const perPass = (n: number) => round(n / arm.arm.passes);
  return {
    id: arm.arm.id,
    label: arm.arm.label,
    kind: arm.arm.kind ?? null,
    provenance: arm.provenance,
    status: arm.arm.status ?? "complete",
    passes: arm.arm.passes,
    tree_sha256: s.tree_sha256,
    judging: { labelled: judgments.some((j) => j.saw_label), blind_share: round(judgments.filter((j) => !j.saw_label).length / judgments.length), judges: [...new Set(judgments.map((j) => j.judge))].sort() },
    blocking: withInterval(values(blocking, found), opts.seed, opts.draws),
    detection: withInterval(values((b) => b.counts !== "over-blocking", (j) => j.outcome !== "M"), opts.seed, opts.draws),
    over_blocking: over.length ? { n: over.length, rate: round(over.reduce((x, o) => x + o.v, 0) / over.length) } : null,
    over_blocking_reason: over.length ? null : "the suite has no over-blocking blockers (cases whose deserved severity is INFORMATIONAL)",
    pr_hit_any: { all: prRates(suite, arm, js), by_group: Object.fromEntries(groups.map((g) => [g, prRates(suite, arm, js, g)])) },
    by_location: byLocation,
    f_share: f + d ? round(f / (f + d)) : null,
    new_blocking: newBlocking,
    new_blocking_reason: arm.findings ? null : "a transcribed arm has no findings",
    false_blockers: "reason" in fb ? null : { per_pr: round((fb.not_defect + fb.known_informational) / arm.arm.passes / new Set(suite.units.map((u) => u.cluster)).size), not_defect: perPass(fb.not_defect), known_informational: perPass(fb.known_informational), new_blockers: perPass(fb.new_blockers), unadjudicated: fb.unadjudicated, labelled: fb.labelled },
    false_blockers_reason: "reason" in fb ? fb.reason : null,
    incomplete: judgments.filter((j) => j.coverage === "incomplete").length,
    cost: costOn(suite, arm, own, meteredUnits(own)),
  };
}

export interface FrozenBarResult {
  round: string;
  text: string;
  arm: string;
  result: "PASS" | "FAIL" | null;
  detail: string;
}

function frozenBar(suite: Suite, bar: FrozenBar, v: Arm, arms: Map<string, ScoredArm>): FrozenBarResult {
  const base = { round: bar.round, text: bar.text, arm: v.arm.id };
  const unfit = (a: Arm) => a.arm.status === "stopped" || a.judgments!.some((j) => j.coverage === "incomplete");
  if (unfit(v)) return { ...base, result: null, detail: "arm " + v.arm.id + " stopped or has blockers recorded with coverage incomplete" };
  if (v.arm.passes !== 1) return { ...base, result: null, detail: "the bar was frozen for one pass; arm " + v.arm.id + " has " + v.arm.passes };
  const js = byBlocker(v);
  const isF = (a: Arm, m: Map<string, Map<number, Judgment>>, u: Unit, b: Blocker) => m.get(key(u, b))?.get(1)?.outcome === "F";
  if (bar.kind === "group-all-and-hits") {
    const all = suite.units.filter((u) => u.group === bar.all_found_group).flatMap((u) => u.blockers.filter(blocking).map((b) => isF(v, js, u, b)));
    const hitsUnits = suite.units.filter((u) => u.group === bar.hits_group && u.blockers.some(blocking));
    const hits = hitsUnits.filter((u) => u.blockers.filter(blocking).every((b) => isF(v, js, u, b))).length;
    const ok = all.every(Boolean) && hits >= bar.min_hits;
    return { ...base, result: ok ? "PASS" : "FAIL", detail: all.filter(Boolean).length + " of " + all.length + " group (" + bar.all_found_group + ") blockers found (needs all); " + hits + " of " + hitsUnits.length + " group (" + bar.hits_group + ") PRs hit (needs " + bar.min_hits + ")" };
  }
  const ref = arms.get(bar.reference)?.arm;
  if (!ref) return { ...base, result: null, detail: "reference arm " + bar.reference + " is not loaded" };
  if (unfit(ref)) return { ...base, result: null, detail: "reference arm " + ref.arm.id + " stopped or has blockers recorded with coverage incomplete" };
  if (ref.arm.passes !== 1) return { ...base, result: null, detail: "the bar was frozen for one reference pass; arm " + ref.arm.id + " has " + ref.arm.passes };
  const rjs = byBlocker(ref);
  const refFound = suite.units.flatMap((u) => u.blockers.filter(blocking).filter((b) => isF(ref, rjs, u, b)).map((b) => ({ u, b })));
  const misses = refFound.filter(({ u, b }) => !isF(v, js, u, b)).length;
  return { ...base, result: misses <= bar.max_misses ? "PASS" : "FAIL", detail: "misses " + misses + " of the " + refFound.length + " blockers " + bar.reference + " found (allows " + bar.max_misses + ")" };
}

export interface ScoreRecord {
  record: "noloss-score";
  version: number;
  id: string;
  suite: { id: string; sha256: string; development_only: boolean; sealed: boolean };
  variant: { id: string; label: string; provenance: string; passes: number; status: string; tree_sha256: string };
  reference: { id: string; label: string; provenance: string; passes: number; status: string; tree_sha256: string };
  margin: { points: number; reason: string };
  post_hoc: boolean;
  frozen_bar: FrozenBarResult | null;
  judging: { labelled: boolean; blind_share: { variant: number; reference: number }; severity_maps: { variant: unknown; reference: unknown; differ: boolean } };
  result: {
    verdict: Verdict | null;
    no_verdict_reason: string | null;
    blockers: number;
    clusters: number;
    discordant_clusters: number;
    recall: { variant: number; reference: number };
    delta: number;
    ci95: [number, number] | null;
    losses: number;
    gains: number;
    p_no_loss: number | null;
    p_no_loss_holm: number | null;
    p_loss: number | null;
    /** Holm-adjusted across the declared LOSS family; null outside one. */
    p_loss_holm: number | null;
    min_p_loss: number | null;
    note: string | null;
    holm_family: number;
    loss_family: { size: number; position: number; step: number; null: LossFamily["null"]; null_points: number } | null;
  };
  false_blockers: FalseBlockerReading | { reason: string };
  size_rule: { source: "declared" | "simulated" | "unchecked"; power: number | null; goal: number; met: boolean | null; detail: string };
  agreement: { shared: number; table: { FF: number; FD: number; DF: number; DD: number } | null; agreement: number | null; kappa: number | null; reason: string | null };
  noise_floor: { repeat: string; delta: number; losses: number; gains: number; discordant_clusters: number } | { repeat: null; reason: string };
  cost: ReturnType<typeof pairedCost>;
  warnings: string[];
  eligibility: { claim: string; eligible: boolean; reasons: string[] };
  seed: number;
  draws: number;
  exit: 0 | 1 | 2;
}

function pairsOf(suite: Suite, v: Arm, r: Arm): PairedItem[] {
  const jv = byBlocker(v);
  const jr = byBlocker(r);
  return suite.units.flatMap((u) => u.blockers.filter(blocking).map((b) => ({ id: key(u, b), cluster: u.cluster, a: shareOf(r, jr, u, b, found), b: shareOf(v, jv, u, b, found) })));
}

function agreement(suite: Suite, v: Arm, r: Arm): ScoreRecord["agreement"] {
  if (v.arm.passes > 1 || r.arm.passes > 1) return { shared: 0, table: null, agreement: null, kappa: null, reason: "an arm has more than one pass; severity agreement is defined on one pass each" };
  const jv = byBlocker(v);
  const jr = byBlocker(r);
  const t = { FF: 0, FD: 0, DF: 0, DD: 0 };
  for (const u of suite.units)
    for (const b of u.blockers.filter(blocking)) {
      const ov = jv.get(key(u, b))?.get(1)?.outcome;
      const or = jr.get(key(u, b))?.get(1)?.outcome;
      if (ov && or && ov !== "M" && or !== "M") t[(or + ov) as keyof typeof t]++;
    }
  const n = t.FF + t.FD + t.DF + t.DD;
  if (n < 10) return { shared: n, table: t, agreement: n ? round((t.FF + t.DD) / n) : null, kappa: null, reason: n + " blockers matched by both arms; kappa needs 10" };
  const po = (t.FF + t.DD) / n;
  const pe = ((t.FF + t.FD) / n) * ((t.FF + t.DF) / n) + ((t.DF + t.DD) / n) * ((t.FD + t.DD) / n);
  return { shared: n, table: t, agreement: round(po), kappa: pe < 1 ? round((po - pe) / (1 - pe)) : null, reason: pe < 1 ? null : "every shared match has the same severity in both arms, so kappa is undefined" };
}

function sizeRule(suite: Suite, spec: SizeRuleSpec | undefined, v: Arm, r: Arm, refRecall: number, margin: number, seed: number, family: number): ScoreRecord["size_rule"] {
  if (!spec) return { source: "unchecked", power: null, goal: POWER_GOAL, met: null, detail: "no size rule was given (--power or --power-sims)" };
  if ("power" in spec) return { source: "declared", power: spec.power, goal: POWER_GOAL, met: spec.power >= POWER_GOAL, detail: "declared power " + spec.power + " from " + spec.source };
  if (!(refRecall > 0 && refRecall < 1)) return { source: "unchecked", power: null, goal: POWER_GOAL, met: null, detail: "the reference's blocking recall is " + refRecall + ", so the simulation has no rate to draw around" };
  const spread = spec.spread ?? "wide";
  const res = simulate({ clusters: suiteClusters(suite), passes_variant: v.arm.passes, passes_reference: r.arm.passes, recall: refRecall, spread: spreadValue(spread), margin_points: margin, delta_points: 0, sims: spec.power_sims, seed, alpha_no_loss: ALPHA / family });
  return { source: "simulated", power: round(res.no_loss), goal: POWER_GOAL, met: res.no_loss >= POWER_GOAL, detail: "an arm as good as the reference gets NO_LOSS in " + round(res.no_loss * 100, 1) + "% of " + spec.power_sims + " simulations (spread " + spread + ", recall " + round(refRecall, 3) + ", seed " + seed + (family > 1 ? ", no-loss alpha 0.05/" + family + ", Holm's strictest step" : "") + ")" };
}

/**
 * Scores comparisons as one family: their no-loss p-values are Holm-adjusted together. With a declared LOSS family, the
 * LOSS p-values of its comparisons are Holm-adjusted in its order under its null, and LOSS is decided on the adjusted p.
 */
export function scoreComparisons(suite: Suite, suiteSha256: string, arms: Map<string, ScoredArm>, comparisons: Comparison[], opts: { seed: number; draws: number; lossFamily?: LossFamily }): ScoreRecord[] {
  const family = opts.lossFamily ?? null;
  for (const id of family?.order ?? []) if (!comparisons.some((c) => c.id === id)) throw new ScoreError("E_USAGE", "the LOSS family names comparison " + id + ", which this run does not score");
  const get = (id: string) => {
    const a = arms.get(id);
    if (!a) throw new ScoreError("E_NOLOSS_ARM", "arm " + id + " is not ingested for suite " + suite.id);
    if (!a.arm.judgments) throw new ScoreError("E_NOLOSS_JUDGMENT", "arm " + id + " is raw: it has findings but no judgments.tsv. Build judge packets (noloss judge-packet), judge them, and join the reply (noloss judge-join) before scoring.");
    return a;
  };
  const drafts = comparisons.map((c) => {
    if (!(Number.isFinite(c.margin_points) && c.margin_points >= 0) || !c.margin_reason?.trim()) throw new ScoreError("E_USAGE", "comparison " + c.id + " needs a margin in points and its reason; there is no default");
    const V = get(c.variant);
    const R = get(c.reference);
    const v = V.arm;
    const r = R.arm;
    for (const a of [v, r]) {
      const seen = new Set(a.judgments!.map((j) => j.saw_label));
      if (seen.size > 1) throw new ScoreError("E_NOLOSS_BLIND", "arm " + a.arm.id + " mixes labelled and blind judgments; they are never pooled. Judge it again one way.");
    }
    const labelled = v.judgments![0]!.saw_label;
    if (labelled !== r.judgments![0]!.saw_label) throw new ScoreError("E_NOLOSS_BLIND", "comparison " + c.id + " would pool labelled and blind judgments (" + (labelled ? v.arm.id : r.arm.id) + " was judged with labels in view); they are never pooled");
    const pairs = pairsOf(suite, v, r);
    if (!pairs.length) throw new ScoreError("E_NOLOSS_SUITE", "suite " + suite.id + " has no blocking blockers to compare on");
    const stats = clusteredPairedDelta(pairs, opts);
    const tests = pairedTests(pairs, c.margin_points, [v.arm.passes, r.arm.passes], family?.null === "margin" && family.order.includes(c.id) ? c.margin_points : 0);
    const stopped = [v, r].filter((a) => a.arm.status === "stopped").map((a) => a.arm.id);
    const incomplete = [v, r].filter((a) => a.judgments!.some((j) => j.coverage === "incomplete")).map((a) => a.arm.id);
    const noVerdict = stopped.length ? "arm " + stopped.join(" and ") + " stopped, so there is no verdict" : incomplete.length ? "arm " + incomplete.join(" and ") + " has blockers recorded with coverage incomplete, so there is no verdict" : null;
    const byCluster = new Map<string, number>();
    for (const p of pairs) byCluster.set(p.cluster, (byCluster.get(p.cluster) ?? 0) + p.b - p.a);
    return { c, V, R, pairs, stats, tests, noVerdict, discordant: [...byCluster.values()].filter((x) => Math.abs(x) > 1e-12).length };
  });
  const holm = holmAdjusted(drafts.map((d) => (d.noVerdict === null && d.tests.no_loss.p !== null ? d.tests.no_loss.p : 1)));
  const lossHolm = family ? holmSteps(family.order.map((id) => drafts.find((d) => d.c.id === id)!).map((d) => (d.noVerdict === null && d.tests.loss.p !== null ? d.tests.loss.p : 1))) : null;
  return drafts.map((d, i) => {
    const { c, V, R, pairs, stats, tests } = d;
    const v = V.arm;
    const r = R.arm;
    const attempted = d.noVerdict === null && tests.no_loss.p !== null;
    const at = family ? family.order.indexOf(c.id) : -1;
    const pLossHolm = at >= 0 && d.noVerdict === null && tests.loss.p !== null ? lossHolm!.adjusted[at]! : null;
    const verdict = d.noVerdict === null ? decide(attempted ? holm[i]! : null, at >= 0 ? pLossHolm : tests.loss.p) : null;
    const pHolm = attempted ? round(holm[i]!, 6) : null;
    const labelled = v.judgments![0]!.saw_label;
    const bar = c.frozen_bar === null ? null : suite.frozen_bars.find((b) => b.round === c.frozen_bar);
    if (c.frozen_bar !== null && !bar) throw new ScoreError("E_NOLOSS_SUITE", "comparison " + c.id + " names frozen bar round " + c.frozen_bar + ", which suite " + suite.id + " does not have");
    for (const other of [bar?.kind === "reference-misses" ? bar.reference : null, c.reference_repeat ?? null]) {
      if (other !== null && get(other).arm.judgments![0]!.saw_label !== labelled) throw new ScoreError("E_NOLOSS_BLIND", "comparison " + c.id + " would pool labelled and blind judgments through arm " + other + "; they are never pooled");
    }
    const barResult = bar ? frozenBar(suite, bar, v, arms) : null;
    const size = sizeRule(suite, c.size_rule, v, r, stats.mean_a, c.margin_points, opts.seed, comparisons.length);
    const warnings = verdict === "NO_LOSS" && size.met !== true ? ["NOLOSS_UNDERPOWERED"] : [];
    const claim = "non-inferior within " + c.margin_points + " points of blocking recall";
    const reasons: string[] = [];
    if (barResult && barResult.result !== "PASS") reasons.push("frozen bar, round " + barResult.round + ": " + (barResult.result ?? "not scored") + " (" + barResult.detail + ")");
    if (verdict !== "NO_LOSS") reasons.push(verdict === null ? d.noVerdict! : "the verdict is " + verdict);
    if (verdict === "NO_LOSS" && size.met !== true) reasons.push(size.met === null ? "the size rule is unchecked" : "below the size rule: power " + size.power + " is under " + POWER_GOAL);
    if (c.post_hoc) reasons.push("post hoc: the comparison was not preregistered before the arms ran");
    if (labelled) reasons.push("labelled judging: the judge saw arm labels");
    if (suite.development_only) reasons.push("suite " + suite.id + " is development-only: it ranks variants but cannot confirm a release on its own");
    if (!v.findings) reasons.push("the variant is transcribed, so its unmatched blocking findings cannot be adjudicated");
    else if ((tallyFalseBlockers(suite, v) as FalseBlockerTally).unadjudicated > 0) reasons.push("the variant's unmatched blocking findings are not adjudicated, so there is no false-blocking bound");
    const repeat = c.reference_repeat ? get(c.reference_repeat) : null;
    let noise: ScoreRecord["noise_floor"] = { repeat: null, reason: "no same-window repeat of reference " + r.arm.id + " is named" };
    if (repeat?.arm.arm.status === "stopped") noise = { repeat: null, reason: "repeat arm " + repeat.arm.arm.id + " stopped" };
    else if (repeat) {
      const rp = pairsOf(suite, repeat.arm, r);
      const byCluster = new Map<string, number>();
      for (const p of rp) byCluster.set(p.cluster, (byCluster.get(p.cluster) ?? 0) + p.b - p.a);
      noise = { repeat: repeat.arm.arm.id, delta: round(rp.reduce((s, p) => s + p.b - p.a, 0) / rp.length), losses: rp.filter((p) => p.b < p.a).length, gains: rp.filter((p) => p.b > p.a).length, discordant_clusters: [...byCluster.values()].filter((x) => Math.abs(x) > 1e-12).length };
    }
    const exit: 0 | 1 | 2 = verdict === "LOSS" ? 1 : verdict === "NO_LOSS" && size.met === true ? 0 : 2;
    const side = (s: ScoredArm) => ({ id: s.arm.arm.id, label: s.arm.arm.label, provenance: s.arm.provenance, passes: s.arm.arm.passes, status: s.arm.arm.status ?? "complete", tree_sha256: s.tree_sha256 });
    const note = (t: SignFlip) => t.reason;
    return {
      record: "noloss-score",
      version: SCORE_VERSION,
      id: c.id,
      suite: { id: suite.id, sha256: suiteSha256, development_only: suite.development_only, sealed: suite.sealed },
      variant: side(V),
      reference: side(R),
      margin: { points: c.margin_points, reason: c.margin_reason },
      post_hoc: c.post_hoc,
      frozen_bar: barResult,
      judging: {
        labelled,
        blind_share: { variant: round(v.judgments!.filter((j) => !j.saw_label).length / v.judgments!.length), reference: round(r.judgments!.filter((j) => !j.saw_label).length / r.judgments!.length) },
        severity_maps: { variant: v.arm.severity_map ?? null, reference: r.arm.severity_map ?? null, differ: JSON.stringify(v.arm.severity_map ?? null) !== JSON.stringify(r.arm.severity_map ?? null) },
      },
      result: {
        verdict,
        no_verdict_reason: d.noVerdict,
        blockers: pairs.length,
        clusters: stats.n_clusters,
        discordant_clusters: d.discordant,
        recall: { variant: round(stats.mean_b), reference: round(stats.mean_a) },
        delta: round(stats.delta),
        ci95: stats.ci95 ? [round(stats.ci95[0]), round(stats.ci95[1])] : null,
        losses: pairs.filter((p) => p.b < p.a).length,
        gains: pairs.filter((p) => p.b > p.a).length,
        p_no_loss: tests.no_loss.p === null ? null : round(tests.no_loss.p, 6),
        p_no_loss_holm: pHolm,
        p_loss: tests.loss.p === null ? null : round(tests.loss.p, 6),
        p_loss_holm: pLossHolm === null ? null : round(pLossHolm, 6),
        min_p_loss: tests.loss.min_p,
        note: note(tests.no_loss) ?? note(tests.loss),
        holm_family: comparisons.length,
        loss_family: at >= 0 ? { size: family!.order.length, position: at + 1, step: lossHolm!.step[at]!, null: family!.null, null_points: family!.null === "margin" ? c.margin_points : 0 } : null,
      },
      false_blockers: falseBlockers(suite, v, r, c.false_blocker_drop ?? null, d.noVerdict, opts),
      size_rule: size,
      agreement: agreement(suite, v, r),
      noise_floor: noise,
      cost: pairedCost(suite, v, r),
      warnings,
      eligibility: { claim, eligible: reasons.length === 0, reasons },
      seed: opts.seed,
      draws: opts.draws,
      exit,
    };
  });
}

const pts = (x: number) => (x * 100).toFixed(1);
export const fmtP = (p: number | null) => (p === null ? "n/a" : p >= 0.01 ? p.toFixed(3) : p.toPrecision(2));
const verdictText = (v: Verdict | null, margin: number) => (v === "NO_LOSS" ? "non-inferior within " + margin + " points (NO_LOSS)" : v ?? "no verdict");

/** The flags every verdict line opens with: labelled judging first, then transcribed, then post hoc. */
export function lineFlags(rec: ScoreRecord): string {
  const f: string[] = [];
  if (rec.judging.labelled) f.push("labelled judging");
  const t = [rec.variant, rec.reference].filter((a) => a.provenance === "transcribed").map((a) => a.id);
  if (t.length) f.push("transcribed (" + t.join(", ") + ")");
  if (rec.post_hoc) f.push("post hoc");
  return f.length ? f.join(", ") + ": " : "";
}

/** Human lines for one record: the frozen bar first, then the category rule, size rule and cost. */
export function renderRecord(rec: ScoreRecord): string[] {
  const flags = lineFlags(rec);
  const out: string[] = [];
  const name = rec.variant.id + " vs " + rec.reference.id;
  if (rec.frozen_bar) out.push(flags + "frozen bar, round " + rec.frozen_bar.round + ": " + rec.frozen_bar.arm + " " + (rec.frozen_bar.result ?? "not scored") + ", " + rec.frozen_bar.detail + ".");
  const r = rec.result;
  out.push(
    flags +
      name +
      " at a " +
      rec.margin.points +
      "-point margin (" +
      rec.margin.reason +
      "): " +
      verdictText(r.verdict, rec.margin.points) +
      (r.no_verdict_reason ? " (" + r.no_verdict_reason + ")" : "") +
      ". Blocking recall " +
      pts(r.recall.variant) +
      "% vs " +
      pts(r.recall.reference) +
      "%, delta " +
      pts(r.delta) +
      " points" +
      (r.ci95 ? " [95% CI " + pts(r.ci95[0]) + ", " + pts(r.ci95[1]) + "]" : "") +
      "; " +
      r.losses +
      " losses, " +
      r.gains +
      " gains on " +
      r.blockers +
      " blockers in " +
      r.clusters +
      " PRs (" +
      r.discordant_clusters +
      " discordant). p non-inferior " +
      fmtP(r.p_no_loss) +
      (r.holm_family > 1 ? " (Holm " + fmtP(r.p_no_loss_holm) + " over " + r.holm_family + ")" : "") +
      ", p loss " +
      (r.loss_family?.null === "margin" ? "beyond the margin " : "") +
      fmtP(r.p_loss) +
      (r.loss_family ? " (Holm " + fmtP(r.p_loss_holm) + ", step " + r.loss_family.step + " of " + r.loss_family.size + " in the declared LOSS family)" : "") +
      " (minimum reachable " +
      fmtP(r.min_p_loss) +
      ")" +
      (r.note ? "; " + r.note : "") +
      ".",
  );
  out.push(flags + "size rule: " + (rec.size_rule.met === null ? "unchecked" : rec.size_rule.met ? "met" : "below") + ", " + rec.size_rule.detail + ".");
  const fb = rec.false_blockers;
  const two = (x: number) => (x > 0 ? "+" : "") + x.toFixed(2);
  if ("reason" in fb) out.push("false blockers per PR: n/a (" + fb.reason + ").");
  else if (!fb.complete) out.push((fb.labelled ? "labelled adjudication: " : "") + "false blockers per PR: incomplete, so not tested (" + fb.reasons.join("; ") + ").");
  else
    out.push(
      (fb.labelled ? "labelled adjudication: " : "") +
        "false blockers per PR: " + rec.variant.id + " " + fb.per_pr.variant.toFixed(2) + ", " + rec.reference.id + " " + fb.per_pr.reference.toFixed(2) +
        ", difference " + two(fb.difference!) + (fb.ci95 ? " [95% CI " + two(fb.ci95[0]) + ", " + two(fb.ci95[1]) + "]" : "") +
        " on " + fb.prs + " PRs; two-sided p " + fmtP(fb.p_two_sided) + " (minimum reachable " + fmtP(fb.min_p) + "); " +
        (fb.drop === null ? "no smallest drop that counts was given" : "smallest drop that counts " + fb.drop + " per PR: the estimate " + (fb.clears_drop ? "clears it" : "does not clear it")) +
        "; the interval " + (fb.interval_below_zero ? "is below zero" : "does not exclude zero or lies above it") + ".",
    );
  const c = rec.cost;
  if ("reason" in c) out.push("cost: " + c.reason + ".");
  else out.push("cost on the " + c.variant.units + " units metered in both (" + c.grade + "): " + rec.variant.id + " " + mtok(c.variant.per_unit_mean) + " per unit, " + mtok(c.variant.per_blocker_found) + " per blocker found; " + rec.reference.id + " " + mtok(c.reference.per_unit_mean) + " per unit, " + mtok(c.reference.per_blocker_found) + " per blocker found.");
  out.push("claim \"" + rec.eligibility.claim + "\": " + (rec.eligibility.eligible ? "may be made" : "may not be made: " + rec.eligibility.reasons.join("; ")) + ".");
  return out;
}

/** The per-PR false-blocker table: PR, variant count, reference count, difference, and findings still unadjudicated. */
export function falseBlockerTable(rec: ScoreRecord): string[] {
  const fb = rec.false_blockers;
  if ("reason" in fb) return [];
  return ["| PR | " + rec.variant.id + " | " + rec.reference.id + " | difference | unadjudicated (" + rec.variant.id + " / " + rec.reference.id + ") |", "|---|---|---|---|---|", ...fb.table.map((t) => "| " + [t.pr, t.variant, t.reference, t.difference, t.variant_unadjudicated + " / " + t.reference_unadjudicated].join(" | ") + " |")];
}

export const mtok = (t: number | null) => (t === null ? "n/a" : (t / 1e6).toFixed(1) + "M tokens");
