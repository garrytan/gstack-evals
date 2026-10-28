// Vendored from harness-evals (https://github.com/garrytan/harness-evals) at 70cb3d0197b70d24b4bd3344b8248e908d4710a8, runner/stats/gates.ts,
// which took it from gbrain-evals v0.10.128 (6999ebc9), eval/runner/stats/. MIT License, Copyright (c) 2026 Garry Tan.
// gstack-evals changes (U2), each marked "gstack-evals:": an inconclusive comparison with no p-value says why
// (NO_VARIATION); an exploratory comparison that cannot pair is blocked alone instead of blocking the family; and the
// cluster minimum is checked before an interval can fail a comparison, so too few clusters is always inconclusive;
// superiority is decided by the clustered sign-flip p plus the point estimate (plan v3.2); and a comparison may
// preregister failure_value, the score of a system failure that left no metric value. An exact gate may state its
// metric's direction, so a crash on a higher-is-better metric scores 0 and fails it rather than blocking the family.
/**
 * Three-gate comparison policy over a preregistered family (plan amendment 4).
 *
 *   exact           Correctness and safety assertions. One violating item
 *                   fails the comparison at once. No significance test runs,
 *                   and no p-value can waive the failure. When any exact gate
 *                   fails, the statistical gates are not run.
 *   noninferiority  Noisy quality metrics. B passes only when it is shown to
 *                   be no worse than A by more than the stated tolerance:
 *                   the Holm-adjusted one-sided p-value is at or below alpha
 *                   (equivalently, the lower interval bound clears
 *                   -tolerance). Failing to find a difference is not proof of
 *                   equivalence, so a wide interval is "inconclusive", not a
 *                   pass. An interval entirely below -tolerance is a fail.
 *   superiority     A claimed improvement. B passes only when the
 *                   Holm-adjusted one-sided clustered sign-flip p-value is at
 *                   or below alpha and the point estimate is at least the
 *                   preregistered minimum effect (plan v3.2). An interval entirely on the losing side of
 *                   zero is a fail; anything else short of a pass is
 *                   "inconclusive".
 *   exploratory     Dashboards. Reported with intervals and unadjusted
 *                   p-values, and never part of the verdict.
 *
 * Holm correction covers the noninferiority and superiority comparisons, the
 * family's confirmatory tests. The family file is written before the runs it judges;
 * comparisons outside it can only be exploratory.
 */
import { readFileSync } from 'node:fs';
import {
  clusteredPairedDelta, exactMcNemar, holmAdjusted, nonInferiorityP, pairObservations, PairingError, powerNote, superiorityP,
  type McNemarResult, type PairedDelta, type PowerNote,
} from './paired.ts';
import { toObservation, type Row } from './rows.ts';

export type Direction = 'higher' | 'lower';
export type ExactAssertion =
  | { kind: 'every_b_equals'; value: number }
  | { kind: 'b_at_most'; value: number }
  | { kind: 'b_at_least'; value: number }
  | { kind: 'no_item_regression'; direction: Direction };

export type ComparisonSpec =
  | { id: string; metric: string; gate: 'exact'; assertion: ExactAssertion; direction?: Direction; cluster_by?: string; failure_value?: number; description?: string }
  | { id: string; metric: string; gate: 'noninferiority'; direction: Direction; tolerance: number; cluster_by: string; failure_value?: number; description?: string }
  | { id: string; metric: string; gate: 'superiority'; direction: Direction; min_effect: number; cluster_by: string; failure_value?: number; description?: string }
  | { id: string; metric: string; gate: 'exploratory'; direction?: Direction; cluster_by?: string; failure_value?: number; description?: string };

export interface ComparisonFamily {
  schema_version: 1;
  family_id: string;
  /** ISO date the family was fixed, before the runs it judges. */
  registered_at: string;
  description?: string;
  alpha: number;
  seed: number;
  draws: number;
  /** Fewer clusters than this makes a noninferiority or superiority result inconclusive, never a pass or a fail. Default 10. */
  min_clusters?: number;
  id_field: string;
  exclude_when?: string[];
  comparisons: ComparisonSpec[];
}

export type GateStatus = 'pass' | 'fail' | 'inconclusive' | 'report_only' | 'skipped' | 'blocked';

export interface ComparisonResult {
  id: string;
  metric: string;
  gate: ComparisonSpec['gate'];
  status: GateStatus;
  reasons: string[];
  n_pairs?: number;
  n_clusters?: number;
  n_excluded?: number;
  stats?: Omit<PairedDelta, 'bootstrap'>;
  mcnemar?: McNemarResult;
  power?: PowerNote;
  tolerance?: number;
  min_effect?: number;
  direction?: Direction;
  p_noninferiority?: number | null;
  p_superiority?: number | null;
  p_holm?: number;
  violations?: string[];
}

export interface FamilyDecision {
  family_id: string;
  verdict: 'pass' | 'fail' | 'inconclusive' | 'blocked' | 'report_only';
  reasons: string[];
  alpha: number;
  holm_family: string[];
  comparisons: ComparisonResult[];
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
// gstack-evals: the reason for a comparison where every paired difference is zero.
const NO_VARIATION = 'every paired difference is zero, so the bootstrap cannot bound the difference and no p-value exists; this is not evidence of equivalence';
const text = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;

export function validateFamily(value: unknown): ComparisonFamily {
  const f = value as ComparisonFamily;
  const problems: string[] = [];
  if (!f || typeof f !== 'object') throw new Error('family must be a JSON object');
  const allowed = ['schema_version', 'family_id', 'registered_at', 'description', 'alpha', 'seed', 'draws', 'min_clusters', 'id_field', 'exclude_when', 'comparisons'];
  for (const key of Object.keys(f)) if (!allowed.includes(key)) problems.push(`unknown family field ${key}`);
  if (f.schema_version !== 1) problems.push('schema_version must be 1');
  if (!text(f.family_id)) problems.push('family_id required');
  if (!text(f.registered_at) || !Number.isFinite(Date.parse(f.registered_at))) problems.push('registered_at must be an ISO date');
  if (!finite(f.alpha) || f.alpha <= 0 || f.alpha >= 0.5) problems.push('alpha must be in (0, 0.5)');
  if (!Number.isSafeInteger(f.seed)) problems.push('seed must be an integer');
  if (!Number.isSafeInteger(f.draws) || f.draws < 1000) problems.push('draws must be an integer >= 1000');
  if (f.min_clusters !== undefined && (!Number.isSafeInteger(f.min_clusters) || f.min_clusters < 2)) problems.push('min_clusters must be an integer >= 2');
  if (!text(f.id_field)) problems.push('id_field required');
  if (f.exclude_when !== undefined && (!Array.isArray(f.exclude_when) || !f.exclude_when.every(r => text(r) && r.indexOf('=') > 0))) problems.push('exclude_when must be field=value rules');
  if (!Array.isArray(f.comparisons) || !f.comparisons.length) problems.push('comparisons must be a nonempty array');
  const ids = new Set<string>();
  for (const c of Array.isArray(f.comparisons) ? f.comparisons : []) {
    const label = `comparison ${c?.id ?? '?'}`;
    if (!text(c?.id) || ids.has(c.id)) problems.push(`${label}: id missing or duplicated`);
    ids.add(c?.id);
    if (!text(c?.metric)) problems.push(`${label}: metric required`);
    if (c?.failure_value !== undefined && !finite(c.failure_value)) problems.push(`${label}: failure_value must be a finite number`);
    if (c?.gate === 'exact') {
      const a = c.assertion as ExactAssertion | undefined;
      if (!a || !['every_b_equals', 'b_at_most', 'b_at_least', 'no_item_regression'].includes(a.kind)) problems.push(`${label}: exact gate needs an assertion`);
      else if (a.kind === 'no_item_regression' ? !['higher', 'lower'].includes(a.direction) : !finite(a.value)) problems.push(`${label}: assertion needs ${a.kind === 'no_item_regression' ? 'a direction' : 'a finite value'}`);
      if (c.direction !== undefined && !['higher', 'lower'].includes(c.direction)) problems.push(`${label}: direction must be higher or lower`);
      else if (c.direction !== undefined && a?.kind === 'no_item_regression' && c.direction !== a.direction) problems.push(`${label}: direction ${c.direction} contradicts the assertion's direction ${a.direction}`);
    } else if (c?.gate === 'noninferiority') {
      if (!['higher', 'lower'].includes(c.direction)) problems.push(`${label}: direction must be higher or lower`);
      if (!finite(c.tolerance) || c.tolerance < 0) problems.push(`${label}: tolerance must be a finite number >= 0, in metric units`);
      if (!text(c.cluster_by)) problems.push(`${label}: cluster_by must be preregistered (use the id field when items are independent)`);
    } else if (c?.gate === 'superiority') {
      if (!['higher', 'lower'].includes(c.direction)) problems.push(`${label}: direction must be higher or lower`);
      if (!finite(c.min_effect) || c.min_effect < 0) problems.push(`${label}: min_effect must be a finite number >= 0, in metric units`);
      if (!text(c.cluster_by)) problems.push(`${label}: cluster_by must be preregistered (use the id field when items are independent)`);
    } else if (c?.gate === 'exploratory') {
      if (c.direction !== undefined && !['higher', 'lower'].includes(c.direction)) problems.push(`${label}: direction must be higher or lower`);
    } else problems.push(`${label}: gate must be exact, noninferiority, superiority or exploratory`);
  }
  if (problems.length) throw new Error(`invalid comparison family: ${problems.join('; ')}`);
  return f;
}

export function loadFamily(path: string): ComparisonFamily {
  return validateFamily(JSON.parse(readFileSync(path, 'utf8')));
}

function strip(stats: PairedDelta): Omit<PairedDelta, 'bootstrap'> {
  const { bootstrap: _bootstrap, ...rest } = stats;
  return rest;
}

function exactViolations(assertion: ExactAssertion, pairs: Array<{ id: string; a: number; b: number }>): string[] {
  const sign = assertion.kind === 'no_item_regression' && assertion.direction === 'lower' ? -1 : 1;
  return pairs.filter(p => {
    switch (assertion.kind) {
      case 'every_b_equals': return p.b !== assertion.value;
      case 'b_at_most': return p.b > assertion.value;
      case 'b_at_least': return p.b < assertion.value;
      case 'no_item_regression': return sign * (p.b - p.a) < 0;
    }
  }).map(p => `${p.id} (A=${p.a}, B=${p.b})`);
}

export function evaluateFamily(aRows: readonly Row[], bRows: readonly Row[], family: ComparisonFamily): FamilyDecision {
  validateFamily(family);
  const minClusters = family.min_clusters ?? 10;
  const pair = (spec: ComparisonSpec) => {
    const direction = spec.gate === 'exact' && spec.assertion.kind === 'no_item_regression' ? spec.assertion.direction : spec.direction;
    const selection = { idField: family.id_field, metric: spec.metric, clusterBy: spec.cluster_by, excludeWhen: family.exclude_when, direction, failureValue: spec.failure_value };
    return pairObservations(aRows.map(r => toObservation(r, selection)), bRows.map(r => toObservation(r, selection)));
  };
  const results: ComparisonResult[] = [];
  const blocked: string[] = [];
  const paired = new Map<string, ReturnType<typeof pair>>();
  for (const spec of family.comparisons) {
    try { paired.set(spec.id, pair(spec)); }
    catch (error) {
      const problems = error instanceof PairingError ? error.problems : [String(error)];
      results.push({ id: spec.id, metric: spec.metric, gate: spec.gate, status: 'blocked', reasons: problems });
      // gstack-evals: an exploratory comparison that cannot pair is blocked alone; it never blocks the family's verdict.
      if (spec.gate === 'exploratory') continue;
      blocked.push(`${spec.id}: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ''}`);
    }
  }
  const holmFamily = family.comparisons.filter(c => c.gate === 'noninferiority' || c.gate === 'superiority').map(c => c.id);
  if (blocked.length) {
    for (const spec of family.comparisons) if (!results.some(r => r.id === spec.id)) {
      results.push({ id: spec.id, metric: spec.metric, gate: spec.gate, status: 'skipped', reasons: ['another comparison in the family is blocked'] });
    }
    return { family_id: family.family_id, verdict: 'blocked', reasons: blocked, alpha: family.alpha, holm_family: holmFamily, comparisons: order(results, family) };
  }

  const exactFailures: string[] = [];
  for (const spec of family.comparisons) {
    if (spec.gate !== 'exact') continue;
    const { pairs, excluded } = paired.get(spec.id)!;
    const violations = exactViolations(spec.assertion, pairs);
    const result: ComparisonResult = { id: spec.id, metric: spec.metric, gate: 'exact', status: violations.length ? 'fail' : 'pass',
      reasons: violations.length ? [`${violations.length} of ${pairs.length} items violate ${spec.assertion.kind}; no significance test applies`] : [],
      n_pairs: pairs.length, n_excluded: excluded.length, ...(violations.length ? { violations: violations.slice(0, 50) } : {}) };
    if (violations.length) exactFailures.push(`${spec.id}: ${result.reasons[0]}`);
    results.push(result);
  }
  if (exactFailures.length) {
    // gstack-evals: a blocked exploratory comparison keeps its blocked status.
    for (const spec of family.comparisons) if (spec.gate !== 'exact' && paired.has(spec.id)) {
      results.push({ id: spec.id, metric: spec.metric, gate: spec.gate, status: 'skipped', reasons: ['an exact correctness or safety gate failed first'] });
    }
    return { family_id: family.family_id, verdict: 'fail', reasons: exactFailures, alpha: family.alpha, holm_family: holmFamily, comparisons: order(results, family) };
  }

  const statistical: Array<{ spec: Extract<ComparisonSpec, { gate: 'noninferiority' | 'superiority' | 'exploratory' }>; stats: PairedDelta; result: ComparisonResult }> = [];
  for (const spec of family.comparisons) {
    // gstack-evals: skip a blocked exploratory comparison.
    if (spec.gate === 'exact' || !paired.has(spec.id)) continue;
    const { pairs, excluded } = paired.get(spec.id)!;
    const stats = clusteredPairedDelta(pairs, { seed: family.seed, draws: family.draws });
    const binary = pairs.every(p => (p.a === 0 || p.a === 1) && (p.b === 0 || p.b === 1));
    const result: ComparisonResult = { id: spec.id, metric: spec.metric, gate: spec.gate, status: 'report_only', reasons: [],
      n_pairs: pairs.length, n_clusters: stats.n_clusters, n_excluded: excluded.length, stats: strip(stats),
      ...(binary ? { mcnemar: exactMcNemar(pairs) } : {}), power: powerNote(stats, { alpha: family.alpha, binary }),
      ...(spec.direction ? { direction: spec.direction } : {}) };
    if (binary && stats.n_clusters < stats.n_pairs) result.reasons.push('McNemar treats items as independent; the clustered sign-flip p-value is the primary test here');
    statistical.push({ spec, stats, result });
    results.push(result);
  }

  const confirmatory = statistical.filter(s => s.spec.gate === 'noninferiority' || s.spec.gate === 'superiority');
  const confirmP = confirmatory.map(s => s.spec.gate === 'noninferiority'
    ? nonInferiorityP(s.stats, s.spec.tolerance, s.spec.direction)
    : superiorityP(s.stats, (s.spec as Extract<ComparisonSpec, { gate: 'superiority' }>).min_effect, (s.spec as Extract<ComparisonSpec, { gate: 'superiority' }>).direction));
  const adjusted = holmAdjusted(confirmP.map(p => p ?? 1));
  const reasons: string[] = [];
  confirmatory.forEach((s, i) => {
    const r = s.result;
    const sign = s.spec.direction === 'higher' ? 1 : -1;
    const ci = s.stats.ci95;
    const orientedUpper = ci ? Math.max(sign * ci[0], sign * ci[1]) : null;
    r.p_holm = adjusted[i];
    if (s.spec.gate === 'noninferiority') {
      const spec = s.spec;
      r.tolerance = spec.tolerance;
      r.p_noninferiority = confirmP[i];
      // gstack-evals: the cluster minimum comes first, so too few clusters can neither pass nor fail.
      if (s.stats.n_clusters < minClusters) {
        r.status = 'inconclusive';
        r.reasons.push(`${s.stats.n_clusters} clusters is below the family minimum of ${minClusters}`);
      } else if (orientedUpper !== null && orientedUpper < -spec.tolerance) {
        r.status = 'fail';
        r.reasons.push(`the whole 95% interval is worse than the tolerance of ${spec.tolerance}`);
      } else if (confirmP[i] !== null && adjusted[i] <= family.alpha) {
        r.status = 'pass';
      } else {
        r.status = 'inconclusive';
        // gstack-evals: say why when there is no p-value at all.
        r.reasons.push(confirmP[i] === null ? NO_VARIATION : `non-inferiority within ${spec.tolerance} not shown (Holm p = ${adjusted[i].toFixed(4)} > ${family.alpha}); this is not evidence of a regression or of equivalence`);
      }
    } else {
      const spec = s.spec as Extract<ComparisonSpec, { gate: 'superiority' }>;
      r.min_effect = spec.min_effect;
      r.p_superiority = confirmP[i];
      // gstack-evals: the cluster minimum comes first here too.
      if (s.stats.n_clusters < minClusters) {
        r.status = 'inconclusive';
        r.reasons.push(`${s.stats.n_clusters} clusters is below the family minimum of ${minClusters}`);
      } else if (orientedUpper !== null && orientedUpper < 0) {
        r.status = 'fail';
        r.reasons.push('the whole 95% interval is on the losing side of zero');
      } else if (confirmP[i] !== null && adjusted[i] <= family.alpha) {
        r.status = 'pass';
      } else {
        r.status = 'inconclusive';
        // gstack-evals: say why when there is no p-value at all.
        // gstack-evals: the sign-flip p and the point estimate decide superiority, so the reason names the one that fell short.
        const estimate = sign * s.stats.delta;
        r.reasons.push(confirmP[i] === null ? NO_VARIATION
          : estimate < spec.min_effect - 1e-12 ? `the point estimate ${estimate.toFixed(4)} is below the minimum effect of ${spec.min_effect}, so p_superiority is 1 (the sign-flip p is in stats); this is not evidence of a loss`
          : `an improvement of at least ${spec.min_effect} is not shown (point estimate ${estimate.toFixed(4)}, Holm sign-flip p = ${adjusted[i].toFixed(4)}, alpha ${family.alpha}); this is not evidence of a loss`);
      }
    }
    if (r.status !== 'pass') reasons.push(`${s.spec.id}: ${r.status}`);
  });
  const verdict: FamilyDecision['verdict'] = !confirmatory.length && !family.comparisons.some(c => c.gate === 'exact') ? 'report_only'
    : confirmatory.some(s => s.result.status === 'fail') ? 'fail'
    : confirmatory.some(s => s.result.status === 'inconclusive') ? 'inconclusive' : 'pass';
  return { family_id: family.family_id, verdict, reasons, alpha: family.alpha, holm_family: holmFamily, comparisons: order(results, family) };
}

function order(results: ComparisonResult[], family: ComparisonFamily): ComparisonResult[] {
  return family.comparisons.map(c => results.find(r => r.id === c.id)!);
}
