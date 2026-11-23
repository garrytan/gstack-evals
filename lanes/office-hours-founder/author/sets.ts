// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's sets (prereg section 3, "Sets and timing", and start rule 12), pure functions over
// passing units in draw order:
// - fillSets: quotas first, in seeded draw order: 16 calibration units with at least 3 of each named type, then 64
//   comparison units with at least 8 of each named type and 6 of each story shape, then 6 reserves. A unit joins a set
//   only while the set's minimums can still fill in its remaining places; otherwise it waits for the next set.
// - projectSupply: the pilot's measured cost per passing unit, failures included, projects the cost of every quota; when
//   that passes the authoring cap it raises E_OF_SUPPLY_SHORT with the comparison count that can fill and the MDD there.
// - replaceDropped: a reserve, the first in draw order, replaces a comparison unit only when it dropped before any stage
//   2 session ran on it.
// - comparisonRecord: the comparison set's size, composition and digest, fixed before the first stage 2 lease.
import { QUOTA } from "../frozen.ts";
import type { AuthorFamily, ProjectType, Shape } from "../types.ts";
import { AuthorError, sha256 } from "./files.ts";
import { NAMED_TYPES, SHAPES } from "./prompts.ts";

export interface Member {
  id: string;
  draw: number;
  type: ProjectType;
  shape: Shape | null;
  author: AuthorFamily;
  digest: string;
}

export interface Quota {
  calibration: number;
  twins: number;
  comparison: number;
  reserve: number;
}

export interface Sets {
  calibration: Member[];
  comparison: Member[];
  reserve: Member[];
}

type Min = { of: (m: Member) => string | null; min: number; keys: readonly string[] };
const CALIBRATION_MINS: Min[] = [{ of: (m) => m.type, min: 3, keys: NAMED_TYPES }];
const COMPARISON_MINS: Min[] = [{ of: (m) => m.type, min: 8, keys: NAMED_TYPES }, { of: (m) => m.shape, min: 6, keys: Object.keys(SHAPES) }];

/** Takes members in order while each minimum can still fill in the places left. */
function take(pool: readonly Member[], size: number, mins: readonly Min[]): { taken: Member[]; rest: Member[] } {
  const taken: Member[] = [], rest: Member[] = [];
  for (const m of pool) {
    const next = [...taken, m];
    const fits = next.length <= size && mins.every((x) => x.keys.reduce((d, k) => d + Math.max(0, x.min - next.filter((n) => x.of(n) === k).length), 0) <= size - next.length);
    (fits ? taken : rest).push(m);
  }
  return { taken, rest };
}

/** The sets from passing first-skin units, in draw order. */
export function fillSets(passed: readonly Member[], quota: Quota): Sets {
  const pool = [...passed].sort((a, b) => a.draw - b.draw);
  const cal = take(pool, quota.calibration, CALIBRATION_MINS);
  const cmp = take(cal.rest, quota.comparison, COMPARISON_MINS);
  return { calibration: cal.taken, comparison: cmp.taken, reserve: cmp.rest.slice(0, quota.reserve) };
}

export const setsFull = (s: Sets, q: Quota): boolean => s.calibration.length === q.calibration && s.comparison.length === q.comparison && s.reserve.length === q.reserve;

export interface Projection {
  spent: number;
  passing: number;
  per_passing: number;
  needed: number;
  projected: number;
  cap: number;
  fits: boolean;
  /** Comparison units the cap can fill after calibration, twins and reserves, and the MDD at that count (null: above 0.50). */
  comparison_fillable: number;
  mdd: number | null;
}

/**
 * Start rule 12. needed counts every quota unit (16 calibration, 8 twins, 64 comparison, 6 reserve); the pilot's passing
 * units count toward them. The projection fits when the spend so far plus the units still needed at the pilot's cost per
 * passing unit stays within the cap.
 */
export function projectSupply(p: { spent: number; passing: number; cap: number; mdd: (comparisonUnits: number) => number | null }): Projection {
  const needed = QUOTA.calibration + QUOTA.twins + QUOTA.comparison + QUOTA.reserve;
  const per = p.passing ? p.spent / p.passing : Infinity;
  const projected = p.spent + Math.max(0, needed - p.passing) * per;
  const fillable = p.passing + (Number.isFinite(per) ? Math.floor((p.cap - p.spent) / per) : 0);
  const comparison_fillable = Math.min(QUOTA.comparison, Math.max(0, fillable - QUOTA.calibration - QUOTA.twins - QUOTA.reserve));
  const out = { spent: p.spent, passing: p.passing, per_passing: per, needed, projected, cap: p.cap, fits: projected <= p.cap, comparison_fillable, mdd: p.mdd(comparison_fillable) };
  if (!out.fits) throw Object.assign(new AuthorError("E_OF_SUPPLY_SHORT", "the pilot's " + p.passing + " passing units project " + projected + " for " + needed + " quota units, past the authoring cap of " + p.cap + "; " + comparison_fillable + " comparison units can fill, MDD " + (out.mdd ?? "above 0.50") + " there"), { projection: out });
  return out;
}

/** Replaces a dropped comparison unit with the first reserve in draw order, unless a stage 2 session already ran on it. */
export function replaceDropped(s: Sets, dropped: string, ranStage2: ReadonlySet<string>): Sets {
  if (ranStage2.has(dropped) || !s.comparison.some((m) => m.id === dropped) || !s.reserve.length) return s;
  const [first, ...reserve] = s.reserve;
  return { ...s, comparison: [...s.comparison.filter((m) => m.id !== dropped), first!].sort((a, b) => a.draw - b.draw), reserve };
}

const tally = (ms: readonly Member[], of: (m: Member) => string | null) => Object.fromEntries([...new Set(ms.map(of))].sort().map((k) => [String(k), ms.filter((m) => of(m) === k).length]));

/** The comparison set's size, composition and digest: sha256 over "id digest" lines in draw order. */
export const comparisonRecord = (ms: readonly Member[]) => ({
  size: ms.length,
  types: tally(ms, (m) => m.type),
  shapes: tally(ms, (m) => m.shape),
  authors: tally(ms, (m) => m.author),
  digest: sha256([...ms].sort((a, b) => a.draw - b.draw).map((m) => m.id + " " + m.digest).join("\n") + "\n"),
});
