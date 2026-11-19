// Copyright (c) 2026 Garry Tan. MIT License.
// Section 8's estimator for the office-hours rewrite eval (prereg
// wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg, section 8, and the guardrail and builder readings of
// sections 7 and 10 that reuse it). A brief's difference is the mean over models, where both arms scored, of arm a's
// metric minus arm b's; a cluster's difference is the mean over its briefs that have one; the estimate is the mean over
// clusters, with section 8's paired t interval over the cluster differences. One function serves new minus current, new
// minus none and current minus none, pooled or one model alone, on R or any other per-session metric.
import { PRIMARY_MODELS } from "../frozen.ts";
import type { ArmId, BriefKind, ModelId, ScoredSession } from "../types.ts";
import { mean, tInterval } from "./stats.ts";

/** A per-session number; null leaves the session out. */
export type Metric = (s: ScoredSession) => number | null;

export const METRIC = {
  R: (s) => s.R,
  R1: (s) => s.R1,
  R2: (s) => s.R2,
  R3: (s) => s.R3,
  questions: (s) => s.questions,
  founder_replies: (s) => s.founder_replies,
  kept: (s) => (s.kept_whole ? Number(s.kept_whole.kept) : null),
} as const satisfies Record<string, Metric>;

/** Section 8's failure table: a missing or contaminated session is missing on every metric, whatever its fields hold. */
export const scoredValue = (s: ScoredSession, metric: Metric): number | null => (s.end === "missing" || s.end === "contaminated" ? null : metric(s));

const fail = (why: string): never => {
  throw new Error("E_OHR_READ_INPUT " + why);
};

/** One row per stage, brief, model and arm, and every row of a brief agrees on its kind, cluster, set and traction flag. */
export function checkRows(rows: readonly ScoredSession[]): void {
  const seen = new Set<string>();
  const briefs = new Map<string, string>();
  for (const s of rows) {
    const key = [s.stage, s.brief, s.model, s.arm].join("|");
    if (seen.has(key)) fail("two scored rows for stage " + s.stage + ", brief " + s.brief + ", model " + s.model + ", arm " + s.arm);
    seen.add(key);
    const meta = [s.kind, s.cluster, s.set, s.traction].join("|");
    const had = briefs.get(s.brief);
    if (had !== undefined && had !== meta) fail("brief " + s.brief + "'s rows disagree on kind, cluster, set or traction: " + had + " against " + meta);
    briefs.set(s.brief, meta);
  }
}

export interface ContrastSpec {
  /** The difference reads a minus b. */
  a: ArmId;
  b: ArmId;
  kind: BriefKind;
  /** Defaults to Opus 5.5 and Sol, the pooled primary. */
  models?: readonly ModelId[];
  /** Defaults to R. */
  metric?: Metric;
  /** Defaults to stage 2. */
  stage?: 1 | 2;
  /** Keeps only rows it accepts, such as the traction flag for G2. */
  where?: (s: ScoredSession) => boolean;
  /** "brief" makes each brief its own cluster (the builder right call); defaults to the row's opening cluster. */
  by?: "cluster" | "brief";
}

export interface BriefDiff {
  brief: string;
  cluster: string;
  /** Models where both arms scored. */
  models: ModelId[];
  diff: number | null;
  a: number | null;
  b: number | null;
}

export interface ClusterDiff {
  cluster: string;
  briefs: number;
  diff: number;
  a: number;
  b: number;
}

export interface Estimate {
  a: ArmId;
  b: ArmId;
  kind: BriefKind;
  models: ModelId[];
  stage: 1 | 2;
  /** Brief-and-model pairs with a row in either arm, those where both arms scored, and those missing a side. */
  pairs: number;
  scored_pairs: number;
  missing_pairs: number;
  briefs: BriefDiff[];
  clusters: ClusterDiff[];
  C: number;
  estimate: number | null;
  sd: number | null;
  lo: number | null;
  hi: number | null;
  /** Each arm's level by the same weighting over the same pairs, so estimate = mean_a - mean_b. */
  mean_a: number | null;
  mean_b: number | null;
}

const sortBy = <T>(xs: T[], key: (x: T) => string) => xs.sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0));

/** Section 8's estimate of a minus b, with its paired t interval over clusters. */
export function estimate(rows: readonly ScoredSession[], spec: ContrastSpec): Estimate {
  checkRows(rows);
  const models = [...(spec.models ?? PRIMARY_MODELS)];
  const metric = spec.metric ?? METRIC.R;
  const stage = spec.stage ?? 2;
  const keep = rows.filter((s) => s.stage === stage && s.kind === spec.kind && models.includes(s.model) && (s.arm === spec.a || s.arm === spec.b) && (spec.where?.(s) ?? true));
  const cell = new Map(keep.map((s) => [s.brief + "|" + s.model + "|" + s.arm, s]));
  const briefIds = sortBy([...new Set(keep.map((s) => s.brief))], (x) => x);
  let pairs = 0, scored = 0;
  const briefs: BriefDiff[] = briefIds.map((brief) => {
    const any = keep.find((s) => s.brief === brief)!;
    const av: number[] = [], bv: number[] = [], ms: ModelId[] = [];
    for (const m of models) {
      const sa = cell.get(brief + "|" + m + "|" + spec.a), sb = cell.get(brief + "|" + m + "|" + spec.b);
      if (!sa && !sb) continue;
      pairs++;
      const x = sa ? scoredValue(sa, metric) : null, y = sb ? scoredValue(sb, metric) : null;
      if (x === null || y === null) continue;
      scored++;
      av.push(x);
      bv.push(y);
      ms.push(m);
    }
    const cluster = spec.by === "brief" ? brief : any.cluster;
    return ms.length ? { brief, cluster, models: ms, diff: mean(av) - mean(bv), a: mean(av), b: mean(bv) } : { brief, cluster, models: ms, diff: null, a: null, b: null };
  });
  const byCluster = new Map<string, BriefDiff[]>();
  for (const b of briefs) if (b.diff !== null) byCluster.set(b.cluster, [...(byCluster.get(b.cluster) ?? []), b]);
  const clusters = sortBy([...byCluster.entries()].map(([cluster, bs]) => ({ cluster, briefs: bs.length, diff: mean(bs.map((b) => b.diff!)), a: mean(bs.map((b) => b.a!)), b: mean(bs.map((b) => b.b!)) })), (c) => c.cluster);
  const t = tInterval(clusters.map((c) => c.diff));
  return {
    a: spec.a, b: spec.b, kind: spec.kind, models, stage, pairs, scored_pairs: scored, missing_pairs: pairs - scored, briefs, clusters,
    C: t.n, estimate: t.mean, sd: t.sd, lo: t.lo, hi: t.hi,
    mean_a: clusters.length ? mean(clusters.map((c) => c.a)) : null,
    mean_b: clusters.length ? mean(clusters.map((c) => c.b)) : null,
  };
}
