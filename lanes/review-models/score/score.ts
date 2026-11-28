// Copyright (c) 2026 Garry Tan. MIT License.
// The review-models scorer (prereg section 4, scores; section 5 and section 8, gaps and contamination). Per review:
// - catch: any finding the judge rules names the bug, at any severity. The strict reading counts can't tell as a miss,
//   the lenient (second) reading counts it as naming.
// - blocking catch: a finding that names the bug and is blocking under gstack's rule (judge.ts isBlocking).
// - native and voice catches: each source's findings scored alone.
// - false alarms: blocking findings per decoy review (judge-free), and blocking findings per bug review that the judge
//   does not rule as naming the bug (descriptive).
// - dollars and wall time from the run's cost rows (cost.tsv, src/trial/review/cost.ts: the all row per unit-pass).
// A gap (a review that failed twice on a provider or infrastructure error) and a contaminated review are scored two ways:
// dropped (its unit leaves every contrast that needs its cell) and as a miss (catch 0 at its metered cost). A provider
// safety stop is its own outcome (R95): counted apart and scored as a miss in both readings. Units pair by unit id.
import { parseTsv } from "../../review-noloss/contract.ts";
import { COST_COLUMNS } from "../../../src/trial/review/cost.ts";
import { ARMS, CONTAMINATED_MAX, EXPOSED_MIN, rmFail, type Arm, type Pool } from "./frozen.ts";
import { isBlocking, type Judged, type ReviewFinding } from "./judge.ts";

export interface Review {
  unit: string;
  arm: Arm;
  pool: Pool;
  /** The PR for a P unit or a decoy, the repository for a B unit. */
  cluster: string;
  /** A finer source tag printed apart, such as S2-openai. */
  stratum?: string;
  outcome: "ok" | "gap" | "safety_stop";
  contaminated: boolean;
  /** Section 6's exposure, for gstack arms; absent for N. */
  exposed?: boolean;
  findings: ReviewFinding[];
  /** The Carbon call's result; null for decoys, and for a review with no report. */
  judged: Judged | null;
  usd: number | null;
  wall_seconds: number | null;
}

export type CatchReading = "strict" | "lenient";
export type GapReading = "dropped" | "miss";
export const GAP_READINGS: readonly GapReading[] = ["dropped", "miss"];

export interface Cell {
  catch: number;
  blocking: number;
  native: number;
  voice: number;
  usd: number;
  wall: number | null;
}

export interface UnitRow {
  unit: string;
  pool: "P" | "B";
  cluster: string;
  stratum?: string;
  /** Absent: the arm did not review the unit. null: dropped under the gap reading. */
  cells: Partial<Record<Arm, Cell | null>>;
}

const key = (r: Pick<Review, "unit" | "arm">) => r.unit + "\u0000" + r.arm;
const gapLike = (r: Review) => r.outcome === "gap" || r.contaminated;

/** Checks the review set once: one review per unit and arm, one pool and cluster per unit, a cost on every scored review, a judge result on every judged one. */
export function checkReviews(reviews: readonly Review[]): void {
  const problems: string[] = [];
  const seen = new Set<string>();
  const unitOf = new Map<string, string>();
  for (const r of reviews) {
    if (!ARMS.includes(r.arm)) problems.push(r.unit + ": unknown arm " + r.arm);
    if (seen.has(key(r))) problems.push(r.unit + " " + r.arm + ": reviewed twice");
    seen.add(key(r));
    const place = r.pool + " " + r.cluster;
    if ((unitOf.get(r.unit) ?? place) !== place) problems.push(r.unit + ": pool or cluster differs across arms");
    unitOf.set(r.unit, place);
    if (r.outcome === "ok" && !r.contaminated && (r.usd === null || !Number.isFinite(r.usd))) problems.push(r.unit + " " + r.arm + ": no metered cost");
    if (r.pool !== "decoy" && r.outcome === "ok" && r.findings.length && !r.judged) problems.push(r.unit + " " + r.arm + ": findings with no judge result");
    if (r.judged) for (const f of r.findings) if (!r.judged.rulings[f.id]) problems.push(r.unit + " " + r.arm + ": finding " + f.id + " has no ruling");
  }
  if (problems.length) rmFail("E_RM_SCORE_INPUT", problems.slice(0, 8).join("; ") + (problems.length > 8 ? " (+" + (problems.length - 8) + " more)" : ""));
}

const names = (r: Review, f: ReviewFinding, reading: CatchReading) => {
  const ruling = r.judged?.rulings[f.id];
  return ruling === "names" || (reading === "lenient" && ruling === "cant_tell");
};

/** A bug review's catches under a catch reading; a gap, a contaminated review and a safety stop catch nothing here. */
export function reviewCatch(r: Review, reading: CatchReading): Omit<Cell, "usd" | "wall"> {
  if (r.outcome !== "ok" || r.contaminated) return { catch: 0, blocking: 0, native: 0, voice: 0 };
  const hit = r.findings.filter((f) => names(r, f, reading));
  return { catch: +(hit.length > 0), blocking: +hit.some((f) => isBlocking(f)), native: +hit.some((f) => f.source === "native"), voice: +hit.some((f) => f.source === "voice") };
}

/** Bug units with each arm's cell under one catch reading and one gap reading. */
export function unitTable(reviews: readonly Review[], o: { catchReading: CatchReading; gapReading: GapReading }): UnitRow[] {
  checkReviews(reviews);
  const rows = new Map<string, UnitRow>();
  for (const r of reviews) {
    if (r.pool === "decoy") continue;
    const row = rows.get(r.unit) ?? { unit: r.unit, pool: r.pool, cluster: r.cluster, ...(r.stratum ? { stratum: r.stratum } : {}), cells: {} };
    rows.set(r.unit, row);
    row.cells[r.arm] = gapLike(r) && o.gapReading === "dropped" ? null : { ...reviewCatch(r, o.catchReading), usd: r.usd ?? 0, wall: r.wall_seconds };
  }
  return [...rows.values()].sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0));
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: readonly number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const share = (k: number, n: number) => (n ? k / n : null);

export interface ArmSummary {
  arm: Arm;
  bug_reviews: number;
  decoy_reviews: number;
  gaps: number;
  safety_stops: number;
  contaminated: number;
  contaminated_share: number | null;
  exposed_share: number | null;
  /** Why the arm reads untested for every contrast it is in, if it does. */
  untested: string[];
  catch_rate: Record<CatchReading, Record<GapReading, number | null>>;
  blocking_catch_rate: number | null;
  native_catches: number;
  voice_catches: number;
  native_only: number;
  voice_only: number;
  cant_tell_findings: number;
  judge_failed_reviews: number;
  judge_retried_reviews: number;
  usd_per_review: number | null;
  usd_per_catch: number | null;
  median_wall_seconds: number | null;
  voice_blocking_share: number | null;
  false_alarms_per_decoy: number | null;
  unmatched_blocking_per_bug_review: number | null;
  unknown_cost_reviews: number;
}

/** Each arm's descriptive figures over the reviews it holds. */
export function armSummaries(reviews: readonly Review[]): ArmSummary[] {
  checkReviews(reviews);
  return ARMS.filter((arm) => reviews.some((r) => r.arm === arm)).map((arm) => {
    const all = reviews.filter((r) => r.arm === arm);
    const bug = all.filter((r) => r.pool !== "decoy");
    const decoy = all.filter((r) => r.pool === "decoy");
    const rate = (reading: CatchReading, gap: GapReading) => {
      const kept = gap === "dropped" ? bug.filter((r) => !gapLike(r)) : bug;
      return share(kept.filter((r) => reviewCatch(r, reading).catch).length, kept.length);
    };
    const strict = bug.map((r) => reviewCatch(r, "strict"));
    const contaminated = all.filter((r) => r.contaminated).length;
    const exposure = all.filter((r) => r.exposed !== undefined);
    const exposedShare = share(exposure.filter((r) => r.exposed).length, exposure.length);
    const contaminatedShare = share(contaminated, all.length);
    const voiceFindings = all.flatMap((r) => r.findings.filter((f) => f.source === "voice"));
    const costed = all.filter((r) => r.usd !== null);
    const bugUsd = bug.reduce((s, r) => s + (r.usd ?? 0), 0);
    const catches = strict.filter((c) => c.catch).length;
    const untested: string[] = [];
    if (contaminatedShare !== null && contaminatedShare > CONTAMINATED_MAX) untested.push("contaminated " + (100 * contaminatedShare).toFixed(1) + "% of reviews, over " + 100 * CONTAMINATED_MAX + "%");
    if (exposedShare !== null && exposedShare < EXPOSED_MIN) untested.push("exposed in " + (100 * exposedShare).toFixed(1) + "% of reviews, under " + 100 * EXPOSED_MIN + "%");
    return {
      arm,
      bug_reviews: bug.length,
      decoy_reviews: decoy.length,
      gaps: all.filter((r) => r.outcome === "gap").length,
      safety_stops: all.filter((r) => r.outcome === "safety_stop").length,
      contaminated,
      contaminated_share: contaminatedShare,
      exposed_share: exposedShare,
      untested,
      catch_rate: { strict: { dropped: rate("strict", "dropped"), miss: rate("strict", "miss") }, lenient: { dropped: rate("lenient", "dropped"), miss: rate("lenient", "miss") } },
      blocking_catch_rate: share(strict.filter((c) => c.blocking).length, bug.length),
      native_catches: strict.filter((c) => c.native).length,
      voice_catches: strict.filter((c) => c.voice).length,
      native_only: strict.filter((c) => c.native && !c.voice).length,
      voice_only: strict.filter((c) => c.voice && !c.native).length,
      cant_tell_findings: bug.reduce((s, r) => s + r.findings.filter((f) => r.judged?.rulings[f.id] === "cant_tell").length, 0),
      judge_failed_reviews: bug.filter((r) => r.judged?.failed).length,
      judge_retried_reviews: bug.filter((r) => (r.judged?.attempts ?? 0) > 1).length,
      usd_per_review: mean(costed.map((r) => r.usd!)),
      usd_per_catch: catches ? bugUsd / catches : null,
      median_wall_seconds: median(all.flatMap((r) => (r.wall_seconds === null ? [] : [r.wall_seconds]))),
      voice_blocking_share: share(voiceFindings.filter((f) => isBlocking(f)).length, voiceFindings.length),
      false_alarms_per_decoy: mean(decoy.map((r) => r.findings.filter((f) => isBlocking(f)).length)),
      unmatched_blocking_per_bug_review: mean(bug.filter((r) => r.outcome === "ok" && !r.contaminated).map((r) => r.findings.filter((f) => isBlocking(f) && r.judged?.rulings[f.id] !== "names").length)),
      unknown_cost_reviews: all.length - costed.length,
    };
  });
}

/** An arm's cost.tsv: each unit's dollars and wall seconds from its all row for one pass; "unavailable" is null. */
export function readCostRows(text: string, pass = 1): Map<string, { usd: number | null; wall_seconds: number | null }> {
  const { header, rows, ragged } = parseTsv(text);
  if (ragged.length || COST_COLUMNS.some((c) => !header.includes(c))) rmFail("E_RM_SCORE_INPUT", "the cost rows are not cost.tsv's columns" + (ragged.length ? " (ragged lines " + ragged.join(", ") + ")" : ""));
  const out = new Map<string, { usd: number | null; wall_seconds: number | null }>();
  const num = (s: string | undefined) => (s === undefined || s === "" || s === "unavailable" ? null : Number(s));
  for (const { line, cells } of rows) {
    if (cells.scope !== "all" || Number(cells.pass) !== pass) continue;
    if (out.has(cells.pr!)) rmFail("E_RM_SCORE_INPUT", "cost row " + line + " repeats unit " + cells.pr);
    const usd = num(cells.usd), wall = num(cells.wall_seconds);
    if ((usd !== null && !Number.isFinite(usd)) || (wall !== null && !Number.isFinite(wall))) rmFail("E_RM_SCORE_INPUT", "cost row " + line + " has a cost or wall time that is not a number");
    out.set(cells.pr!, { usd, wall_seconds: wall });
  }
  return out;
}
