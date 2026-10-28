// Vendored from harness-evals (https://github.com/garrytan/harness-evals) at 70cb3d0197b70d24b4bd3344b8248e908d4710a8, runner/stats/rows.ts,
// which took it from gbrain-evals v0.10.128 (6999ebc9), eval/runner/stats/. MIT License, Copyright (c) 2026 Garry Tan.
// gstack-evals changes (U2), marked "gstack-evals:": a system failure with no metric value scores 0 only on a
// higher-is-better metric, where 0 is a miss; elsewhere it takes the preregistered failure value or blocks pairing.
/**
 * Turn per-item result rows (NDJSON or a JSON array) into paired-comparison
 * observations under one eligibility rule, applied identically to both runs.
 *
 * Eligibility, in order:
 *   1. A row matching an `exclude_when` rule is ineligible (for example
 *      `is_abs=true`, the LongMemEval abstention questions that have no
 *      evidence label).
 *   2. A row whose error origin is `harness`, `dependency` or `judge` is
 *      ineligible: the system under test was never fairly measured. So is a
 *      row with a reader or judge failure (`qa_error`) when the metric is a
 *      reading-lane metric (`qa_*`); the multi-system join in
 *      memory-qa/outcomes.ts then excludes that id from every system.
 *   3. A row whose error origin is `sut` is eligible and, when the metric is
 *      missing, scores the preregistered failure value, or 0 on a metric where
 *      higher is better, following the probe-accounting rule that a system
 *      failure is a miss that stays in the denominator. With neither, the row
 *      has no value and blocks pairing: 0 would be the best latency or cost.
 *   4. A row without a finite (or boolean) metric value is ineligible.
 */
import { readFileSync } from 'node:fs';
import type { Observation } from './paired.ts';

export type Row = Record<string, unknown>;

export interface RowSelection {
  idField: string;
  metric: string;
  /** Dotted path to the cluster id; defaults to the id field (every item its own cluster). */
  clusterBy?: string;
  /** `field=value` rules; a matching row is ineligible. */
  excludeWhen?: string[];
  /** Which way the metric improves; a system failure scores 0 only when higher is better. */
  direction?: 'higher' | 'lower';
  /** The preregistered score of a system failure that left no metric value. */
  failureValue?: number;
}

export function getPath(row: unknown, path: string): unknown {
  let value: unknown = row;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export function parseRule(rule: string): { path: string; value: string } {
  const at = rule.indexOf('=');
  if (at <= 0 || at === rule.length - 1) throw new Error(`rule must look like field=value: ${rule}`);
  return { path: rule.slice(0, at), value: rule.slice(at + 1) };
}

const render = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);

export function matchesRule(row: Row, rule: string): boolean {
  const { path, value } = parseRule(rule);
  const actual = getPath(row, path);
  return actual !== undefined && render(actual) === value;
}

const EXCLUDED_ORIGINS = new Set(['harness', 'dependency', 'judge']);

export function toObservation(row: Row, selection: RowSelection): Observation {
  const rawId = getPath(row, selection.idField);
  const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
  const rawCluster = getPath(row, selection.clusterBy ?? selection.idField);
  const cluster = typeof rawCluster === 'string' || typeof rawCluster === 'number' ? String(rawCluster) : '';
  const ineligible = (reason: string): Observation => ({ id, cluster, value: null, eligible: false, reason });
  for (const rule of selection.excludeWhen ?? []) if (matchesRule(row, rule)) return ineligible(`excluded by ${rule}`);
  const origin = row.error_origin;
  const failed = row.error !== undefined && row.error !== null;
  if (failed && typeof origin === 'string' && EXCLUDED_ORIGINS.has(origin)) return ineligible(`${origin} error`);
  if (failed && origin !== 'sut') return ineligible('error without a known origin');
  if (!failed && selection.metric.startsWith('qa_') && typeof row.qa_error === 'string') return ineligible('reader or judge error');
  const raw = getPath(row, selection.metric);
  const value = typeof raw === 'boolean' ? Number(raw) : raw;
  if (typeof value === 'number' && Number.isFinite(value)) return { id, cluster, value, eligible: true };
  // gstack-evals: 0 is a miss only when higher is better; otherwise the failure needs a preregistered score.
  if (failed && selection.failureValue !== undefined) return { id, cluster, value: selection.failureValue, eligible: true };
  if (failed && selection.direction === 'higher') return { id, cluster, value: 0, eligible: true };
  if (failed) return { id, cluster, value: null, eligible: true, reason: `a system failure left no ${selection.metric} value and the comparison preregisters no failure_value` };
  return ineligible(`no ${selection.metric} value`);
}

export interface LoadedRows { rows: Row[]; skipped_summary_rows: number }

/**
 * Read NDJSON, or a JSON document. `rowsPath` selects an array inside a JSON
 * document (for example `per_query.gbrain` in a Cat13 report). NDJSON lines
 * that carry a string `kind` and no id are summary records and are skipped;
 * any other line without an id is an error at pairing time.
 */
export function loadRows(path: string, options: { idField: string; rowsPath?: string }): LoadedRows {
  const text = readFileSync(path, 'utf8');
  let rows: unknown;
  if (options.rowsPath || text.trimStart().startsWith('[')) {
    const doc = JSON.parse(text);
    rows = options.rowsPath ? getPath(doc, options.rowsPath) : doc;
  } else {
    rows = text.split('\n').filter(line => line.trim()).map((line, i) => {
      try { return JSON.parse(line); } catch { throw new Error(`${path}: line ${i + 1} is not JSON`); }
    });
  }
  if (!Array.isArray(rows)) throw new Error(`${path}: expected an array of rows${options.rowsPath ? ` at ${options.rowsPath}` : ''}`);
  const kept: Row[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${path}: every row must be a JSON object`);
    const r = row as Row;
    if (getPath(r, options.idField) === undefined && typeof r.kind === 'string') { skipped++; continue; }
    kept.push(r);
  }
  return { rows: kept, skipped_summary_rows: skipped };
}

export function selectRows(rows: readonly Row[], where: readonly string[]): Row[] {
  return rows.filter(row => where.every(rule => matchesRule(row, rule)));
}
