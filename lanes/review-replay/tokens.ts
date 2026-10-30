// The review token table (plan v3.2, review replay lane, requirement 3): measured tokens per review dispatch by reviewer
// role, effort and model, kept in tables/review-tokens.json. loadTable validates it and recomputes every statistic from
// the row's trials, flaggedRows applies the table's flag rules, and exportTokens builds the {role: {full, light}} object
// that gstack's scripts/review-dispatch-compare.ts reads through --tokens. Nothing here fills a default or calls a model.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const TABLE_PATH = join(import.meta.dir, "..", "..", "tables", "review-tokens.json");
export const EFFORTS = ["full", "light"] as const;
export type Effort = (typeof EFFORTS)[number];
export const STATS = ["median", "p90"] as const;
export type Stat = (typeof STATS)[number];

export interface TokenStats {
  median: number;
  p90: number;
}

/** One measured call. output_tokens counts output plus reasoning tokens. */
export interface Trial {
  id: string;
  input_tokens: number;
  output_tokens: number;
}

export interface TokenRow {
  model: string;
  role: string;
  /** gstack's effort name; provider_effort is what the measuring run sent, such as Anthropic effort high. */
  effort: Effort;
  provider_effort: string;
  input_tokens: TokenStats;
  output_tokens: TokenStats;
  n: number;
  source_run_ids: string[];
  /** The measurement date, YYYY-MM-DD. */
  as_of: string;
  trials: Trial[];
}

export interface TokenTable {
  schema_version: 1;
  flag_rules: { min_n: number; max_age_days: number };
  sources: Record<string, string>;
  rows: TokenRow[];
}

export interface Flag {
  row: TokenRow;
  reasons: string[];
}

export interface MissingRow {
  model: string;
  role: string;
  effort: Effort;
}

export type ExportResult = { ok: true; tokens: Record<string, Record<Effort, number>>; rows: TokenRow[] } | { ok: false; missing: MissingRow[] };

export class TableError extends Error {}

const DAY_MS = 86_400_000;

/** Whole tokens: the middle value, or the mean of the two middle values rounded half up. */
export function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.floor((sorted[mid - 1]! + sorted[mid]! + 1) / 2);
}

/** Nearest rank: the ceil(0.9 * n)-th smallest value. */
export function p90(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.ceil(0.9 * sorted.length) - 1]!;
}

const isCount = (v: unknown, min = 0): v is number => Number.isInteger(v) && (v as number) >= min;
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + "T00:00:00Z").toISOString().startsWith(v);

export const rowName = (r: { model: string; role: string; effort: string }) => r.model + " " + r.role + " " + r.effort;

/** Every way the value fails the table's shape; empty when it is a valid table. */
export function tableProblems(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ["the table is not a JSON object"];
  const t = raw as Record<string, any>;
  const problems: string[] = [];
  if (t.schema_version !== 1) problems.push("schema_version must be 1");
  if (!isCount(t.flag_rules?.min_n, 1) || !isCount(t.flag_rules?.max_age_days, 1)) problems.push("flag_rules needs whole-number min_n and max_age_days");
  const sources = typeof t.sources === "object" && t.sources !== null && !Array.isArray(t.sources) ? t.sources : {};
  if (sources !== t.sources || !Object.values(sources).every(isText)) problems.push("sources must map each run id to a description");
  if (!Array.isArray(t.rows) || t.rows.length === 0) return [...problems, "rows must be a non-empty array"];
  const seen = new Set<string>();
  t.rows.forEach((r: any, i: number) => {
    const at = "rows[" + i + "]";
    if (typeof r !== "object" || r === null) return problems.push(at + " is not an object");
    if (!isText(r.model)) problems.push(at + ".model must be a model id");
    if (typeof r.role !== "string" || !/^[a-z][a-z0-9-]*$/.test(r.role)) problems.push(at + ".role must be a lowercase role name such as specialist");
    if (!EFFORTS.includes(r.effort)) problems.push(at + ".effort must be full or light");
    if (!isText(r.provider_effort)) problems.push(at + ".provider_effort must name the effort the provider was sent");
    if (!isDate(r.as_of)) problems.push(at + ".as_of must be a YYYY-MM-DD date");
    if (!Array.isArray(r.source_run_ids) || r.source_run_ids.length === 0 || !r.source_run_ids.every((id: unknown) => typeof id === "string" && id in sources)) {
      problems.push(at + ".source_run_ids must name runs listed in sources");
    }
    const name = rowName(r);
    if (seen.has(name)) problems.push(at + " repeats " + name);
    seen.add(name);
    const trials = Array.isArray(r.trials) ? r.trials : [];
    if (trials.length === 0 || !trials.every((x: any) => isText(x?.id) && isCount(x.input_tokens) && isCount(x.output_tokens))) {
      return problems.push(at + ".trials must list each call's id, input_tokens and output_tokens");
    }
    if (r.n !== trials.length) problems.push(at + ".n is " + r.n + " but it lists " + trials.length + " trials");
    for (const field of ["input_tokens", "output_tokens"] as const) {
      const values = trials.map((x: Trial) => x[field]);
      const want = { median: median(values), p90: p90(values) };
      if (r[field]?.median !== want.median || r[field]?.p90 !== want.p90) problems.push(at + "." + field + " must be " + JSON.stringify(want) + ", as its trials give");
    }
  });
  return problems;
}

export function loadTable(path: string = TABLE_PATH): TokenTable {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new TableError("cannot read the token table " + path + ": " + (error as Error).message);
  }
  const problems = tableProblems(raw);
  if (problems.length > 0) throw new TableError("the token table " + path + " is invalid: " + problems.join("; "));
  return raw as TokenTable;
}

/** The rows the flag rules mark: n under min_n, or as_of more than max_age_days before now. */
export function flaggedRows(table: TokenTable, rows: TokenRow[] = table.rows, now: Date = new Date()): Flag[] {
  const { min_n, max_age_days } = table.flag_rules;
  return rows.flatMap((row) => {
    const reasons: string[] = [];
    if (row.n < min_n) reasons.push("n=" + row.n + " is under " + min_n);
    const age = Math.floor((now.getTime() - Date.parse(row.as_of + "T00:00:00Z")) / DAY_MS);
    if (age > max_age_days) reasons.push("as_of " + row.as_of + " is " + age + " days old, over " + max_age_days);
    return reasons.length > 0 ? [{ row, reasons }] : [];
  });
}

/**
 * The measured output tokens per dispatch for one model, by role and effort. Without roles it exports every role the
 * table has for the model; for a model the table lacks, every role the table has for any model. Each role needs both
 * efforts, and a gap fails with every missing row named.
 */
export function exportTokens(table: TokenTable, model: string, stat: Stat, roles?: string[]): ExportResult {
  const ofModel = table.rows.filter((r) => r.model === model);
  const wanted = roles && roles.length > 0 ? roles : (ofModel.length > 0 ? ofModel : table.rows).map((r) => r.role);
  const tokens: Record<string, Record<Effort, number>> = {};
  const rows: TokenRow[] = [];
  const missing: MissingRow[] = [];
  for (const role of new Set(wanted)) {
    for (const effort of EFFORTS) {
      const row = ofModel.find((r) => r.role === role && r.effort === effort);
      if (!row) {
        missing.push({ model, role, effort });
        continue;
      }
      rows.push(row);
      tokens[role] = { ...tokens[role], [effort]: row.output_tokens[stat] } as Record<Effort, number>;
    }
  }
  return missing.length > 0 ? { ok: false, missing } : { ok: true, tokens, rows };
}
