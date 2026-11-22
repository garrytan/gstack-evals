// Copyright (c) 2026 Garry Tan. MIT License.
// Section 11's lead table and per-arm rates for the office-hours rewrite eval (prereg
// wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg, sections 9 and 11), as data. The lead table holds new minus
// current, new minus none and current minus none, pooled over Opus 5.5 and Sol, then each model beside it, particle-1
// marked descriptive: estimate, 95% interval, control rate, the MDD the plan printed and the MDD at the observed control
// rate from section 9's re-read. The rates are R1, R2, R3 and R by arm on stage 2's founder briefs. Pre-run change 3
// reads the pooled new minus current row at the interim look's level when one is given (read/look.ts).
import { ARMS, HOSTS, MODELS, PRIMARY_MODELS } from "../frozen.ts";
import { entryId } from "../run/manifest.ts";
import type { ArmId, BriefKind, ModelId, ScoredSession, SessionRow } from "../types.ts";
import { checkRows, estimate, METRIC, scoredValue, type Metric } from "./estimate.ts";

export type Scope = "pooled" | ModelId;
export const SCOPES: readonly Scope[] = ["pooled", ...MODELS];
const modelsOf = (s: Scope): readonly ModelId[] => (s === "pooled" ? PRIMARY_MODELS : [s]);

/** Section 11's three contrasts, with section 9's printed MDDs pooled and for one model alone. */
export const CONTRASTS = [
  { name: "new minus current", a: "new", b: "current", mdd_plan: { pooled: "0.12 to 0.13", one: "0.17 to 0.18" } },
  { name: "new minus none", a: "new", b: "none", mdd_plan: { pooled: "0.08 to 0.13", one: "0.11 to 0.18" } },
  { name: "current minus none", a: "current", b: "none", mdd_plan: { pooled: "0.08 to 0.13", one: "0.11 to 0.18" } },
] as const satisfies ReadonlyArray<{ name: string; a: ArmId; b: ArmId; mdd_plan: { pooled: string; one: string } }>;
export type ContrastName = (typeof CONTRASTS)[number]["name"];

export interface LeadRow {
  contrast: ContrastName;
  scope: Scope;
  /** particle-1 decides nothing. */
  descriptive: boolean;
  C: number;
  estimate: number | null;
  lo: number | null;
  hi: number | null;
  control_arm: ArmId;
  control_rate: number | null;
  /** Section 9's printed range; particle-1 has none. */
  mdd_plan: string | null;
  mdd_observed: string | null;
}

/** "contrast|scope" to the MDD at the observed control rate (reread.ts observedMdd). */
export type ObservedMdd = Readonly<Record<string, string>>;

export function leadTable(rows: readonly ScoredSession[], observed: ObservedMdd = {}, level?: number): LeadRow[] {
  return CONTRASTS.flatMap((c) => SCOPES.map((scope) => {
    const primary = c.a === "new" && c.b === "current" && scope === "pooled";
    const e = estimate(rows, { a: c.a, b: c.b, kind: "founder", models: modelsOf(scope), ...(primary && level !== undefined ? { level } : {}) });
    const descriptive = scope === "particle";
    return {
      contrast: c.name, scope, descriptive, C: e.C, estimate: e.estimate, lo: e.lo, hi: e.hi, control_arm: c.b, control_rate: e.mean_b,
      mdd_plan: descriptive ? null : scope === "pooled" ? c.mdd_plan.pooled : c.mdd_plan.one,
      mdd_observed: observed[c.name + "|" + scope] ?? null,
    };
  }));
}

export interface Rate {
  k: number;
  n: number;
  rate: number | null;
}
export interface ArmRates {
  arm: ArmId;
  scope: Scope;
  R1: Rate;
  R2: Rate;
  R3: Rate;
  R: Rate;
}

/** R1, R2, R3 and R by arm, pooled over Opus 5.5 and Sol and per model: the share of stage 2 sessions scored on each part. */
export function rates(rows: readonly ScoredSession[], kind: BriefKind = "founder"): ArmRates[] {
  checkRows(rows);
  const part = (xs: readonly ScoredSession[], m: Metric): Rate => {
    const v = xs.map((s) => scoredValue(s, m)).filter((x): x is number => x !== null);
    const k = v.filter((x) => x === 1).length;
    return { k, n: v.length, rate: v.length ? k / v.length : null };
  };
  return ARMS.flatMap((arm) => SCOPES.map((scope) => {
    const xs = rows.filter((s) => s.stage === 2 && s.kind === kind && s.arm === arm && modelsOf(scope).includes(s.model));
    return { arm, scope, R1: part(xs, METRIC.R1), R2: part(xs, METRIC.R2), R3: part(xs, METRIC.R3), R: part(xs, METRIC.R) };
  }));
}

/** Pre-run change 5, F1: the primary row (new minus current, pooled) again with every flagged Sol session scored a fail on R1, R2, R3 and R. It is reported with zero flags too; a flagged session that reads missing or contaminated stays out, as in the primary. */
export function sensitivity(rows: readonly ScoredSession[], flagged: ReadonlySet<string>, level?: number): LeadRow & { flagged: number; flagged_cells: string[] } {
  const failed = rows.map((s) => (flagged.has(entryId(s)) ? { ...s, R1: 0 as const, R2: 0 as const, R3: 0 as const, R: 0 as const } : s));
  const row = leadTable(failed, {}, level).find((r) => r.contrast === "new minus current" && r.scope === "pooled")!;
  const cells = rows.filter((s) => flagged.has(entryId(s))).map(entryId);
  return { ...row, flagged: cells.length, flagged_cells: cells };
}

/** Pre-run change 5 on the Sol rows: F1's flagged sessions, G1's non-default turns, and the cells missing on an unreadable rollout listed apart from the other infra misses. */
export interface SolTrust {
  flagged: { cell: string; flags: string[] }[];
  non_default: { cell: string; turns: string[] }[];
  unreadable: string[];
  other_infra_missing: { cell: string; code: string }[];
}
export function solTrust(rows: readonly SessionRow[]): SolTrust {
  const sol = rows.filter((r) => HOSTS[r.model] === "codex");
  return {
    flagged: sol.filter((r) => r.rollout_flags?.length).map((r) => ({ cell: entryId(r), flags: r.rollout_flags! })),
    non_default: sol.filter((r) => r.non_default_turns?.length).map((r) => ({ cell: entryId(r), turns: r.non_default_turns! })),
    unreadable: sol.filter((r) => r.end === "missing" && r.code === "E_OHR_ROLLOUT_UNREADABLE").map(entryId),
    other_infra_missing: sol.filter((r) => r.end === "missing" && r.code === "E_OHR_INFRA_MISSING").map((r) => ({ cell: entryId(r), code: r.code! })),
  };
}
