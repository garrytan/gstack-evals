// Copyright (c) 2026 Garry Tan. MIT License.
// Section 10's guardrails and section 8's missing limits for the office-hours rewrite eval (prereg
// wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg, sections 8 and 10). Each returns held or broken with the
// numbers behind it. G1: any new-arm builder session asks a startup-only question, confirmed by a hand read of that
// transcript. G2: on founder briefs with the traction flag, the 95% lower bound of new minus current on questions asked
// per session is above 1. G3: on founder briefs, the 95% lower bound of new minus current on founder replies before the
// closing message is above 20% of the current arm's mean. Missing limits: more than 10% of founder brief-and-model
// differences missing, any arm-and-model cell missing more than 10% of its sessions, or none-arm contamination past 2%.
import { ARMS, DECISION, MISSING_LIMITS, MODELS, PRIMARY_MODELS } from "../frozen.ts";
import type { ArmId, ModelId, ScoredSession } from "../types.ts";
import type { State } from "./builder.ts";
import { checkRows, estimate, METRIC, scoredValue, type Estimate } from "./estimate.ts";
import { gt } from "./stats.ts";

export type { State };

/** G1's hand read of one new-arm builder session the detector flagged. confirmed: the transcript asks a startup-only question. */
export interface HandRead {
  brief: string;
  model: ModelId;
  confirmed: boolean;
}

export interface G1Reading {
  state: State;
  /** brief|model of every stage 2 new-arm builder session whose detector found a startup-only question. */
  candidates: string[];
  /** Those the hand read confirmed on Opus 5.5 or Sol: each breaks G1. */
  confirmed: string[];
  /** Confirmed on particle-1: reported, never breaking. */
  descriptive: string[];
}

const fail = (why: string): never => {
  throw new Error("E_OHR_READ_INPUT " + why);
};

/** G1. Every detector hit needs a hand read, and every hand read must name a hit. */
export function g1(rows: readonly ScoredSession[], reads: readonly HandRead[]): G1Reading {
  checkRows(rows);
  const hits = rows.filter((s) => s.stage === 2 && s.kind === "builder" && s.arm === "new" && s.end !== "missing" && (s.kept_whole?.startup_only.length ?? 0) > 0);
  const candidates = hits.map((s) => s.brief + "|" + s.model).sort();
  const byKey = new Map<string, boolean>();
  for (const r of reads) {
    const k = r.brief + "|" + r.model;
    if (!candidates.includes(k)) fail("G1's hand read names " + k + ", which is not a new-arm builder session with a startup-only detector hit");
    if (byKey.has(k)) fail("G1 has two hand reads for " + k);
    byKey.set(k, r.confirmed);
  }
  const unread = candidates.filter((k) => !byKey.has(k));
  if (unread.length) fail("G1 needs a hand read of every detector hit; none for " + unread.join(", "));
  const yes = candidates.filter((k) => byKey.get(k));
  const primary = (k: string) => (PRIMARY_MODELS as readonly string[]).includes(k.split("|")[1]!);
  const confirmed = yes.filter(primary);
  return { state: confirmed.length ? "broken" : "held", candidates, confirmed, descriptive: yes.filter((k) => !primary(k)) };
}

export interface BoundReading {
  state: State;
  /** The lower bound must stay at or under this. */
  threshold: number;
  estimate: Estimate;
}

/** G2: questions per session on traction founder briefs, new minus current, pooled. */
export function g2(rows: readonly ScoredSession[]): BoundReading {
  const e = estimate(rows, { a: "new", b: "current", kind: "founder", metric: METRIC.questions, where: (s) => s.traction });
  const threshold = DECISION.g2_questions;
  return { state: e.lo !== null && gt(e.lo, threshold) ? "broken" : "held", threshold, estimate: e };
}

/** G3: founder replies before the closing message on founder briefs, new minus current, pooled; 20% of current's mean on the same pairs. */
export function g3(rows: readonly ScoredSession[]): BoundReading & { current_mean: number | null } {
  const e = estimate(rows, { a: "new", b: "current", kind: "founder", metric: METRIC.founder_replies });
  const threshold = e.mean_b === null ? Number.NaN : DECISION.g3_share * e.mean_b;
  return { state: e.lo !== null && e.mean_b !== null && gt(e.lo, threshold) ? "broken" : "held", threshold, current_mean: e.mean_b, estimate: e };
}

export interface Guardrails {
  g1: G1Reading;
  g2: BoundReading;
  g3: BoundReading & { current_mean: number | null };
  broken: boolean;
}

export function guardrails(rows: readonly ScoredSession[], reads: readonly HandRead[]): Guardrails {
  const r = { g1: g1(rows, reads), g2: g2(rows), g3: g3(rows) };
  return { ...r, broken: r.g1.state === "broken" || r.g2.state === "broken" || r.g3.state === "broken" };
}

export interface CellMissing {
  arm: ArmId;
  model: ModelId;
  sessions: number;
  missing: number;
  share: number | null;
  /** particle-1's cells are reported and decide nothing. */
  decides: boolean;
  state: State;
}

export interface MissingLimits {
  founder_differences: { total: number; missing: number; share: number | null; limit: number; state: State };
  cells: CellMissing[];
  cells_state: State;
  contamination: { sessions: number; contaminated: number; share: number | null; limit: number; state: State };
  broken: boolean;
}

const share = (k: number, n: number) => (n ? k / n : null);

/**
 * Section 8's missing limits over stage 2. A session is missing when it has no R (a missing or contaminated end, or an
 * unscored block); a founder difference is missing when either arm's R is. Founder differences are new minus current on
 * Opus 5.5 and Sol; contamination counts their none-arm sessions; each cell counts every stage 2 session of its arm and
 * model, founder and builder.
 */
export function missingLimits(rows: readonly ScoredSession[]): MissingLimits {
  checkRows(rows);
  const s2 = rows.filter((s) => s.stage === 2);
  const miss = (s: ScoredSession) => scoredValue(s, METRIC.R) === null;
  const e = estimate(rows, { a: "new", b: "current", kind: "founder" });
  const fd = { total: e.pairs, missing: e.missing_pairs, share: share(e.missing_pairs, e.pairs), limit: MISSING_LIMITS.founder_differences };
  const cells: CellMissing[] = [];
  for (const arm of ARMS) for (const model of MODELS) {
    const xs = s2.filter((s) => s.arm === arm && s.model === model);
    if (!xs.length) continue;
    const k = xs.filter(miss).length, sh = share(k, xs.length);
    cells.push({ arm, model, sessions: xs.length, missing: k, share: sh, decides: PRIMARY_MODELS.includes(model), state: sh !== null && gt(sh, MISSING_LIMITS.cell_sessions) ? "broken" : "held" });
  }
  const none = s2.filter((s) => s.arm === "none" && PRIMARY_MODELS.includes(s.model));
  const k = none.filter((s) => s.end === "contaminated").length, csh = share(k, none.length);
  const r = {
    founder_differences: { ...fd, state: (fd.share !== null && gt(fd.share, fd.limit) ? "broken" : "held") as State },
    cells,
    cells_state: (cells.some((c) => c.decides && c.state === "broken") ? "broken" : "held") as State,
    contamination: { sessions: none.length, contaminated: k, share: csh, limit: MISSING_LIMITS.contamination, state: (csh !== null && gt(csh, MISSING_LIMITS.contamination) ? "broken" : "held") as State },
  };
  return { ...r, broken: r.founder_differences.state === "broken" || r.cells_state === "broken" || r.contamination.state === "broken" };
}
