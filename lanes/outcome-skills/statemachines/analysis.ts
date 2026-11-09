// Copyright (c) 2026 Garry Tan. MIT License.
// Section 14's analysis and verdicts, with section 6's gap rules. analyse() reads only sm-analysis-input.v1, which
// buildInput() makes from first-stage outcome records (sm-outcome.v1), follow-on records (sm-followon.v1), session
// records (sm-session.v1) and unit.json files. Fields added to the records later are read by name and may be absent.
//
// Claim 1 per model: A1-A0 (primary), A1-A2 (lens), A2-A0 (framing); the strict reading is primary and the adapted reading
// sits beside it. Each contrast is the paired difference in clean-fix rate with a 95% bootstrap interval over
// repositories (paired.ts clusteredPairedDelta, cluster = repository, 10,000 resamples, bootstrap_seed), the exact
// McNemar p (paired.ts exactMcNemar) and the counts of units that got worse and better, with the strict break-rate
// difference beside it. Claim 2 per model: A1-S0 (primary), A1-S2 (lens), S2-S0 (framing) on per-unit mean incremental
// follow-on scores, with the exact two-sided unit-level sign-flip p computed by convolution (exactSignFlip).
import { clusteredPairedDelta, exactMcNemar, seededRandom } from "../../../src/runner/stats/paired.ts";
import { stage2Rule, type Stage2 } from "./admission.ts";

const refuse = (m: string): never => {
  throw new Error("E_SM_ANALYSIS " + m);
};

export const CELLS = ["A0", "A1", "A2", "S2", "A3"] as const;
export type Cell = (typeof CELLS)[number];
export const TREES = ["S0", "A1", "S2"] as const;
export type Tree = (typeof TREES)[number];
export type Outcome = "clean_fix" | "fix_broke" | "no_fix" | "no_fix_broke";
const OUTCOMES: readonly string[] = ["clean_fix", "fix_broke", "no_fix", "no_fix_broke"];
export const FALLBACKS = ["skip_marker", "stable_missing", "test_patch_conflict_adapted", "rebuild_failed", "unrecorded"] as const;
export type FallbackReason = (typeof FALLBACKS)[number];
export type ReadingName = "strict" | "adapted";

export interface Reruns { fix: string[]; no_fix: string[]; break: string[] }
export interface ReadingRow { outcome: Outcome | null; gap: string | null; reruns: Reruns | null; rerun_2of3: boolean }
export interface FirstRow {
  unit: string; model: string; cell: Cell; session_gap: string | null; strict: ReadingRow; adapted: ReadingRow;
  fallbacks: Array<{ reason: FallbackReason; reading: ReadingName }>; questions: { ask_user_question: number; prose: number } | null; exposed: boolean | null;
}
export interface FollowRow {
  unit: string; model: string; tree: Tree; rep: number; gap: string | null; incremental: 0 | 1 | null; end_to_end: 0 | 1 | null;
  whole: { incremental: 0 | 1; end_to_end: 0 | 1 } | null; drift: boolean;
}
export interface UnitRow { id: string; repo: string; month: string; stratum: "state" | "other" | "unclear"; july: boolean; in_source: boolean }
export interface AnalysisInput {
  schema: "sm-analysis-input.v1"; models: string[]; units: UnitRow[]; first: FirstRow[]; followon: FollowRow[];
  config: { bootstrap_seed: number; draws: number; replicates: number };
}

// ---- Frozen numbers from power.txt (section 15), pinned against the file by a test ----

/** Claim 1 MDD in points by discordant share: n = 60, n = 60 with design effect 1.2, pooled n = 180 with design effect 1.2. */
export const MDD_CLAIM1: ReadonlyArray<{ d: number; n60: number; n60_deff: number; pooled: number }> = [
  { d: 0.1, n60: 11.4, n60_deff: 12.5, pooled: 7.2 },
  { d: 0.15, n60: 14.0, n60_deff: 15.3, pooled: 8.9 },
  { d: 0.2, n60: 16.2, n60_deff: 17.7, pooled: 10.2 },
  { d: 0.3, n60: 19.8, n60_deff: 21.7, pooled: 12.5 },
];
/** Claim 2 MDD range in points, k = 3, n = 60, design effect 1.2: incremental, and end to end at 5% to 20% carry-over. */
export const MDD_CLAIM2 = { incremental: [10.8, 12.0], end_to_end: [13.1, 15.8] } as const;

const pts = (x: number) => (Math.round(x * 1000) / 10).toFixed(1);

/** The MDD sentence for a claim 1 contrast: the tabled row at the smallest discordant share at or above the observed one. */
export function mddClaim1(discordantShare: number, pooled = false): string {
  const row = MDD_CLAIM1.find((r) => r.d >= discordantShare - 1e-12) ?? null;
  const col = (r: (typeof MDD_CLAIM1)[number]) => (pooled ? r.pooled : r.n60_deff);
  const where = pooled ? "pooled n = 180, design effect 1.2" : "n = 60, design effect 1.2";
  if (!row) return "MDD above " + col(MDD_CLAIM1.at(-1)!).toFixed(1) + " points (observed discordant share " + discordantShare.toFixed(3) + " is above power.txt's 0.30 row; " + where + ")";
  return "MDD " + col(row).toFixed(1) + " points (power.txt, " + where + ", discordant share row " + row.d.toFixed(2) + " for observed " + discordantShare.toFixed(3) + ")";
}
export const mddClaim2 = (measure: "incremental" | "end_to_end"): string =>
  "MDD " + MDD_CLAIM2[measure][0].toFixed(1) + " to " + MDD_CLAIM2[measure][1].toFixed(1) + " points (power.txt, k = 3, n = 60, design effect 1.2)";

// ---- Exact two-sided paired sign-flip ----

/**
 * Exact two-sided paired sign-flip p over units: under the null each unit's difference keeps or flips its sign with
 * probability 1/2, and p is the share of the 2^n patterns whose sum is at least as far from 0 as the observed sum. The
 * differences are put on an integer grid (scale 6 holds every difference of means over 1, 2 or 3 replicates) and the
 * null distribution of the sum is built by convolution with exact integer counts. For n <= 20 the same count is also
 * taken by enumerating every pattern (Gray code order) and the two must agree.
 */
export function exactSignFlip(diffs: readonly number[], scale = 6): { p: number; n: number; observed: number; method: "convolution"; enumerated: boolean } {
  const k = diffs.map((d) => {
    const v = d * scale;
    const r = Math.round(v);
    if (!Number.isFinite(d) || Math.abs(v - r) > 1e-6) refuse("a paired difference " + d + " is not on the 1/" + scale + " grid the exact sign-flip needs");
    return Math.abs(r);
  });
  const n = k.length;
  const obs = diffs.reduce((a, d) => a + Math.round(d * scale), 0);
  const total = k.reduce((a, x) => a + x, 0);
  let dist: bigint[] = new Array(2 * total + 1).fill(0n);
  dist[total] = 1n;
  let reach = 0;
  for (const x of k) {
    if (x === 0) {
      dist = dist.map((c) => c * 2n);
      continue;
    }
    const next: bigint[] = new Array(2 * total + 1).fill(0n);
    for (let s = total - reach; s <= total + reach; s++) {
      const c = dist[s]!;
      if (c === 0n) continue;
      next[s + x]! += c;
      next[s - x]! += c;
    }
    dist = next;
    reach += x;
  }
  const far = Math.abs(obs);
  let count = 0n;
  for (let s = 0; s < dist.length; s++) if (Math.abs(s - total) >= far) count += dist[s]!;
  let enumerated = false;
  if (n <= 20) {
    let sum = k.reduce((a, x) => a + x, 0);
    const signs = new Array<number>(n).fill(1);
    let hits = Math.abs(sum) >= far ? 1 : 0;
    for (let i = 1; i < 2 ** n; i++) {
      const j = Math.log2(i & -i);
      sum -= 2 * signs[j]! * k[j]!;
      signs[j] = -signs[j]!;
      if (Math.abs(sum) >= far) hits++;
    }
    if (BigInt(hits) !== count) refuse("the sign-flip convolution (" + count + ") and the enumeration (" + hits + ") disagree on n = " + n);
    enumerated = true;
  }
  return { p: Math.min(1, Number(count) / 2 ** n), n, observed: obs / scale, method: "convolution", enumerated };
}

// ---- Paired contrasts ----

export interface Pair { unit: string; repo: string; a: number; b: number }
export interface Stat {
  n: number; n_repos: number; mean_a: number; mean_b: number; delta: number; ci95: [number, number] | null; p: number;
  p_method: "exact-mcnemar" | "exact-sign-flip"; worse: number; better: number; discordant_share: number;
}
export interface Cfg { bootstrap_seed: number; draws: number }

/** One paired contrast b minus a: the bootstrap over repositories, the exact p and the counts worse and better. */
export function stat(pairs: readonly Pair[], test: "mcnemar" | "sign_flip", cfg: Cfg): Stat | null {
  if (!pairs.length) return null;
  const items = pairs.map((p) => ({ id: p.unit, cluster: p.repo, a: p.a, b: p.b }));
  const d = clusteredPairedDelta(items, { seed: cfg.bootstrap_seed, draws: cfg.draws });
  const p = test === "mcnemar" ? exactMcNemar(items).p_two_sided : exactSignFlip(pairs.map((x) => x.b - x.a)).p;
  const worse = pairs.filter((x) => x.b < x.a - 1e-12).length, better = pairs.filter((x) => x.b > x.a + 1e-12).length;
  return { n: d.n_pairs, n_repos: d.n_clusters, mean_a: d.mean_a, mean_b: d.mean_b, delta: d.delta, ci95: d.ci95, p, p_method: test === "mcnemar" ? "exact-mcnemar" : "exact-sign-flip", worse, better, discordant_share: (worse + better) / pairs.length };
}

export type Verdict = "HELPS" | "HURTS" | "NO MEASURABLE DIFFERENCE" | "INCOMPLETE";
/** Section 14: HELPS when the interval's lower bound is above 0 and the exact p is below 0.05; HURTS when the upper bound
 *  is below 0 and p is below 0.05; otherwise no measurable difference. An incomplete cell gets no verdict. */
export function verdictOf(s: Stat | null, incomplete: boolean): Verdict {
  if (incomplete) return "INCOMPLETE";
  if (!s || !s.ci95) return "NO MEASURABLE DIFFERENCE";
  if (s.ci95[0] > 0 && s.p < 0.05) return "HELPS";
  if (s.ci95[1] < 0 && s.p < 0.05) return "HURTS";
  return "NO MEASURABLE DIFFERENCE";
}
export const lensReading = (v: Verdict): string => (v === "HELPS" ? "the lens helps" : v === "HURTS" ? "the lens hurts" : v === "INCOMPLETE" ? "no reading (incomplete cell)" : "no measurable lens effect");

/** Section 14's pooled reading: each model's repositories are resampled within the model, the pooled difference is the sum
 *  of paired differences over the sum of pairs. Descriptive. */
export function stratifiedBootstrap(byModel: ReadonlyMap<string, readonly Pair[]>, cfg: Cfg): { delta: number; ci95: [number, number] | null } {
  const strata = [...byModel.entries()].filter(([, p]) => p.length).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, pairs]) => {
    const by = new Map<string, { sum: number; count: number }>();
    for (const p of pairs) {
      const c = by.get(p.repo) ?? { sum: 0, count: 0 };
      c.sum += p.b - p.a;
      c.count++;
      by.set(p.repo, c);
    }
    return [...by.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, c]) => c);
  });
  const all = strata.flat();
  const n = all.reduce((a, c) => a + c.count, 0);
  if (!n) return { delta: 0, ci95: null };
  const delta = all.reduce((a, c) => a + c.sum, 0) / n;
  if (strata.every((s) => s.length < 2)) return { delta, ci95: null };
  const rng = seededRandom(cfg.bootstrap_seed);
  const boot = new Array<number>(cfg.draws);
  for (let i = 0; i < cfg.draws; i++) {
    let sum = 0, count = 0;
    for (const s of strata) for (let j = 0; j < s.length; j++) {
      const c = s[Math.floor(rng() * s.length)]!;
      sum += c.sum;
      count += c.count;
    }
    boot[i] = sum / count;
  }
  boot.sort((x, y) => x - y);
  return { delta, ci95: [boot[Math.floor(cfg.draws * 0.025)]!, boot[Math.ceil(cfg.draws * 0.975) - 1]!] };
}

/** The difference of differences between two unit groups (state-shaped minus other), with a bootstrap that resamples
 *  repositories once for both groups. A draw that leaves a group empty is skipped; the interval reads the kept draws. */
export function diffOfDiffs(x: readonly Pair[], y: readonly Pair[], cfg: Cfg): { delta: number | null; ci95: [number, number] | null; draws_kept: number } {
  if (!x.length || !y.length) return { delta: null, ci95: null, draws_kept: 0 };
  const by = new Map<string, { sx: number; nx: number; sy: number; ny: number }>();
  for (const [rows, side] of [[x, "x"], [y, "y"]] as const) for (const p of rows) {
    const c = by.get(p.repo) ?? { sx: 0, nx: 0, sy: 0, ny: 0 };
    if (side === "x") { c.sx += p.b - p.a; c.nx++; } else { c.sy += p.b - p.a; c.ny++; }
    by.set(p.repo, c);
  }
  const cl = [...by.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, c]) => c);
  const mean = (rows: readonly Pair[]) => rows.reduce((a, p) => a + p.b - p.a, 0) / rows.length;
  const delta = mean(x) - mean(y);
  if (cl.length < 2) return { delta, ci95: null, draws_kept: 0 };
  const rng = seededRandom(cfg.bootstrap_seed);
  const boot: number[] = [];
  for (let i = 0; i < cfg.draws; i++) {
    let sx = 0, nx = 0, sy = 0, ny = 0;
    for (let j = 0; j < cl.length; j++) {
      const c = cl[Math.floor(rng() * cl.length)]!;
      sx += c.sx; nx += c.nx; sy += c.sy; ny += c.ny;
    }
    if (nx && ny) boot.push(sx / nx - sy / ny);
  }
  boot.sort((a, b) => a - b);
  if (boot.length < 2) return { delta, ci95: null, draws_kept: boot.length };
  return { delta, ci95: [boot[Math.floor(boot.length * 0.025)]!, boot[Math.ceil(boot.length * 0.975) - 1]!], draws_kept: boot.length };
}

// ---- Input checks ----

export function checkInput(x: AnalysisInput): void {
  if (!x || x.schema !== "sm-analysis-input.v1") refuse("the input is not sm-analysis-input.v1");
  const c = x.config;
  if (!c || !Number.isSafeInteger(c.bootstrap_seed) || c.bootstrap_seed < 0 || c.bootstrap_seed >= 2 ** 32) refuse("config.bootstrap_seed must be an unsigned 32-bit integer (prereg.json)");
  if (c.draws !== 10_000) refuse("config.draws must be 10000 (section 14)");
  if (c.replicates !== 3) refuse("config.replicates must be 3 (section 8)");
  if (!Array.isArray(x.models) || !x.models.length || new Set(x.models).size !== x.models.length) refuse("models must be a non-empty list without repeats");
  const ids = new Set<string>();
  for (const u of x.units ?? []) {
    if (!u.id || ids.has(u.id)) refuse("unit " + JSON.stringify(u.id) + " is missing or repeated");
    if (!u.repo) refuse("unit " + u.id + " has no repository");
    if (!["state", "other", "unclear"].includes(u.stratum)) refuse("unit " + u.id + " has stratum " + JSON.stringify(u.stratum));
    ids.add(u.id);
  }
  if (!ids.size) refuse("no units");
  const seen = new Set<string>();
  for (const r of x.first ?? []) {
    if (!ids.has(r.unit)) refuse("a first-stage row names unit " + r.unit + ", which the input does not hold");
    if (!x.models.includes(r.model)) refuse("a first-stage row names model " + r.model + ", which models does not list");
    if (!CELLS.includes(r.cell)) refuse("a first-stage row names cell " + r.cell);
    const k = r.unit + " " + r.model + " " + r.cell;
    if (seen.has(k)) refuse("two first-stage rows for " + k);
    seen.add(k);
    for (const rd of [r.strict, r.adapted]) if (rd.outcome !== null && !OUTCOMES.includes(rd.outcome)) refuse(k + " has outcome " + rd.outcome);
    for (const f of r.fallbacks) if (!FALLBACKS.includes(f.reason)) refuse(k + " has fallback reason " + f.reason);
  }
  const seenF = new Set<string>();
  for (const r of x.followon ?? []) {
    if (!ids.has(r.unit)) refuse("a follow-on row names unit " + r.unit + ", which the input does not hold");
    if (!x.models.includes(r.model)) refuse("a follow-on row names model " + r.model);
    if (!TREES.includes(r.tree)) refuse("a follow-on row names tree " + r.tree);
    if (!Number.isSafeInteger(r.rep) || r.rep < 1 || r.rep > c.replicates) refuse("a follow-on row on " + r.unit + " has replicate " + r.rep);
    const k = r.unit + " " + r.model + " " + r.tree + " " + r.rep;
    if (seenF.has(k)) refuse("two follow-on rows for " + k);
    seenF.add(k);
    if (!r.gap && (r.incremental === null || r.end_to_end === null)) refuse(k + " has no gap and no score");
  }
}

// ---- The analysis ----

export interface ContrastOut {
  name: string; role: "primary" | "lens" | "framing" | "qa" | "qa_beside"; reading: string; measure: string;
  status: "ok" | "not run"; incomplete_cells: string[]; dropped: number; stat: Stat | null;
  verdict?: Verdict; reading_text?: string; mdd?: string;
  breaks?: { stat: Stat | null; breaks_more: boolean } | null;
  worst_case?: { stat: Stat | null; verdict: Verdict } | null;
}
export interface CellOut { units: number; gaps: number; incomplete: boolean }
export interface TreeVal {
  unit: string; tree: Tree; kept: boolean; reason: string; scored: number; inc: number | null; e2e: number | null; whole_inc: number | null; whole_e2e: number | null;
  worst_inc: number; worst_e2e: number; drift: boolean; pass3_inc: boolean | null; pass3_e2e: boolean | null; inherited: boolean; first_tpc: boolean; start_conflict: boolean; break_first: number | null;
}

const isBroke = (o: Outcome | null) => o === "fix_broke" || o === "no_fix_broke";
const isClean = (o: Outcome | null) => o === "clean_fix";
const sortU = <T extends { unit: string }>(a: T[]) => a.sort((x, y) => (x.unit < y.unit ? -1 : x.unit > y.unit ? 1 : 0));

export function analyse(x: AnalysisInput) {
  checkInput(x);
  const cfg: Cfg = { bootstrap_seed: x.config.bootstrap_seed, draws: x.config.draws };
  const R = x.config.replicates;
  const units = [...x.units].sort((a, b) => (a.id < b.id ? -1 : 1));
  const firstOf = new Map(x.first.map((r) => [r.unit + "\u0000" + r.model + "\u0000" + r.cell, r]));
  const fRow = (u: string, m: string, c: string) => firstOf.get(u + "\u0000" + m + "\u0000" + c);
  const ran = (m: string, c: Cell) => x.first.some((r) => r.model === m && r.cell === c);
  const gapOf = (r: FirstRow | undefined, rd: ReadingName): string | null => (!r ? "no record" : r.session_gap ?? r[rd].gap ?? (r[rd].outcome === null ? "no outcome" : null));

  const cell1 = (m: string, c: Cell, rd: ReadingName, us = units): CellOut => {
    const gaps = us.filter((u) => gapOf(fRow(u.id, m, c), rd) !== null).length;
    return { units: us.length, gaps, incomplete: gaps * 10 > us.length };
  };

  // Claim 2's trees, section 6 and section 8 items 4 to 6.
  const treeCache = new Map<string, TreeVal>();
  const treeVal = (u: UnitRow, m: string, t: Tree): TreeVal => {
    const key = u.id + "\u0000" + m + "\u0000" + t;
    const hit = treeCache.get(key);
    if (hit) return hit;
    const rows = x.followon.filter((r) => r.unit === u.id && r.model === m && r.tree === t).sort((a, b) => a.rep - b.rep);
    const first = t === "S0" ? null : fRow(u.id, m, t) ?? null;
    const scored = rows.filter((r) => !r.gap && r.incremental !== null && r.end_to_end !== null);
    const firstTpc = (!!first && !first.session_gap && first.strict.gap === "E_SM_TEST_PATCH_CONFLICT") || rows.some((r) => r.gap === "first_stage_test_patch_conflict");
    const startConflict = rows.length === R && rows.every((r) => r.gap === "start_set_conflict");
    let reason = "kept";
    if (t !== "S0" && !first) reason = "no first-stage record";
    else if (first && gapOf(first, "strict")) reason = "first-stage gap " + gapOf(first, "strict");
    else if (firstTpc) reason = "first-stage gap first_stage_test_patch_conflict";
    else if (scored.length < 2) reason = scored.length + " of " + R + " replicates scored";
    const kept = reason === "kept";
    const mean = (f: (r: FollowRow) => number) => scored.reduce((a, r) => a + f(r), 0) / scored.length;
    const whole = kept && scored.every((r) => r.whole) ? scored : null;
    const v: TreeVal = {
      unit: u.id, tree: t, kept, reason, scored: scored.length,
      inc: kept ? mean((r) => r.incremental!) : null, e2e: kept ? mean((r) => r.end_to_end!) : null,
      whole_inc: whole ? mean((r) => r.whole!.incremental) : null, whole_e2e: whole ? mean((r) => r.whole!.end_to_end) : null,
      worst_inc: reason.startsWith("first-stage") || reason.startsWith("no first") ? 0 : scored.reduce((a, r) => a + r.incremental!, 0) / R,
      worst_e2e: reason.startsWith("first-stage") || reason.startsWith("no first") ? 0 : scored.reduce((a, r) => a + r.end_to_end!, 0) / R,
      drift: kept && scored.some((r) => r.drift), pass3_inc: kept && scored.length === R ? scored.every((r) => r.incremental === 1) : null,
      pass3_e2e: kept && scored.length === R ? scored.every((r) => r.end_to_end === 1) : null,
      inherited: !!first && isClean(first.strict.outcome), first_tpc: firstTpc, start_conflict: startConflict,
      break_first: t === "S0" ? 0 : first && !gapOf(first, "strict") ? (isBroke(first.strict.outcome) ? 1 : 0) : null,
    };
    treeCache.set(key, v);
    return v;
  };
  const ranTree = (m: string, t: Tree) => x.followon.some((r) => r.model === m && r.tree === t);
  const cell2 = (m: string, t: Tree, us = units): CellOut => {
    const gaps = us.filter((u) => !treeVal(u, m, t).kept).length;
    return { units: us.length, gaps, incomplete: gaps * 10 > us.length };
  };

  type Measure1 = "clean" | "break";
  const val1 = (r: FirstRow, rd: ReadingName, ms: Measure1) => (ms === "clean" ? (isClean(r[rd].outcome) ? 1 : 0) : isBroke(r[rd].outcome) ? 1 : 0);
  const pairs1 = (m: string, b: Cell, a: Cell, rd: ReadingName, ms: Measure1, us: UnitRow[]) => {
    const pairs: Pair[] = [];
    let dropped = 0;
    for (const u of us) {
      const rb = fRow(u.id, m, b), ra = fRow(u.id, m, a);
      if (gapOf(rb, rd) || gapOf(ra, rd)) { dropped++; continue; }
      pairs.push({ unit: u.id, repo: u.repo, a: val1(ra!, rd, ms), b: val1(rb!, rd, ms) });
    }
    return { pairs, dropped };
  };
  const worst1 = (m: string, b: Cell, a: Cell, rd: ReadingName, us: UnitRow[]): Pair[] =>
    us.map((u) => {
      const v = (c: Cell) => { const r = fRow(u.id, m, c); return gapOf(r, rd) ? 0 : val1(r!, rd, "clean"); };
      return { unit: u.id, repo: u.repo, a: v(a), b: v(b) };
    });

  type Measure2 = "inc" | "e2e" | "whole_inc" | "whole_e2e";
  const pairs2 = (m: string, b: Tree, a: Tree, ms: Measure2, us: UnitRow[]) => {
    const pairs: Pair[] = [];
    let dropped = 0;
    for (const u of us) {
      const tb = treeVal(u, m, b), ta = treeVal(u, m, a);
      if (!tb.kept || !ta.kept || tb[ms] === null || ta[ms] === null) { dropped++; continue; }
      pairs.push({ unit: u.id, repo: u.repo, a: ta[ms]!, b: tb[ms]! });
    }
    return { pairs, dropped };
  };

  const c1 = (m: string, b: Cell, a: Cell, role: ContrastOut["role"], rd: ReadingName, us: UnitRow[], full: boolean): ContrastOut => {
    const name = b + "-" + a;
    if (!ran(m, b) || !ran(m, a)) return { name, role, reading: rd, measure: "clean_fix", status: "not run", incomplete_cells: [], dropped: 0, stat: null };
    const inc = [b, a].filter((c) => cell1(m, c, rd, us).incomplete).map((c) => m + " " + c + " (" + rd + ")");
    const { pairs, dropped } = pairs1(m, b, a, rd, "clean", us);
    const s = stat(pairs, "mcnemar", cfg);
    const out: ContrastOut = { name, role, reading: rd, measure: "clean_fix", status: "ok", incomplete_cells: inc, dropped, stat: s };
    if (!full) return out;
    const v = verdictOf(s, inc.length > 0);
    const bs = stat(pairs1(m, b, a, "strict", "break", us).pairs, "mcnemar", cfg);
    const ws = stat(worst1(m, b, a, rd, us), "mcnemar", cfg);
    return {
      ...out, verdict: v, reading_text: role === "lens" ? lensReading(v) : v, mdd: mddClaim1(s?.discordant_share ?? 0),
      breaks: { stat: bs, breaks_more: !!bs?.ci95 && bs.ci95[0] > 0 }, worst_case: { stat: ws, verdict: verdictOf(ws, false) },
    };
  };
  const c2 = (m: string, b: Tree, a: Tree, role: ContrastOut["role"], ms: Measure2, us: UnitRow[], full: boolean): ContrastOut => {
    const name = b + "-" + a;
    const measure = { inc: "incremental", e2e: "end_to_end", whole_inc: "whole_incremental", whole_e2e: "whole_end_to_end" }[ms];
    if (!ranTree(m, b) || !ranTree(m, a)) return { name, role, reading: "strict", measure, status: "not run", incomplete_cells: [], dropped: 0, stat: null };
    const inc = [b, a].filter((t) => cell2(m, t, us).incomplete).map((t) => m + " tree " + t);
    const { pairs, dropped } = pairs2(m, b, a, ms, us);
    const s = stat(pairs, "sign_flip", cfg);
    const out: ContrastOut = { name, role, reading: ms.startsWith("whole") ? "whole change (reported only)" : "strict", measure, status: "ok", incomplete_cells: inc, dropped, stat: s };
    if (!full) return out;
    const v = verdictOf(s, inc.length > 0);
    const bp = pairs.map((p) => {
      const u = units.find((y) => y.id === p.unit)!;
      return { unit: p.unit, repo: p.repo, a: treeVal(u, m, a).break_first ?? 0, b: treeVal(u, m, b).break_first ?? 0 };
    });
    const bs = stat(bp, "mcnemar", cfg);
    const key = ms === "inc" ? "worst_inc" : "worst_e2e";
    const wp = us.map((u) => ({ unit: u.id, repo: u.repo, a: treeVal(u, m, a)[key], b: treeVal(u, m, b)[key] }));
    const ws = stat(wp, "sign_flip", cfg);
    return {
      ...out, verdict: v, reading_text: role === "lens" ? lensReading(v) : v, mdd: mddClaim2(ms === "inc" ? "incremental" : "end_to_end"),
      breaks: { stat: bs, breaks_more: !!bs?.ci95 && bs.ci95[0] > 0 }, worst_case: { stat: ws, verdict: verdictOf(ws, false) },
    };
  };

  const CLAIM1: Array<[Cell, Cell, ContrastOut["role"]]> = [["A1", "A0", "primary"], ["A1", "A2", "lens"], ["A2", "A0", "framing"], ["A3", "A0", "qa"], ["A3", "A1", "qa_beside"]];
  const CLAIM2: Array<[Tree, Tree, ContrastOut["role"]]> = [["A1", "S0", "primary"], ["A1", "S2", "lens"], ["S2", "S0", "framing"]];
  const fullRole = (r: ContrastOut["role"]) => r === "primary" || r === "lens" || r === "qa";
  const by = (s: (u: UnitRow) => boolean) => units.filter(s);

  const perModel = x.models.map((m) => {
    const cells = {
      first: Object.fromEntries(CELLS.filter((c) => ran(m, c)).map((c) => [c, { strict: cell1(m, c, "strict"), adapted: cell1(m, c, "adapted") }])),
      trees: Object.fromEntries(TREES.filter((t) => ranTree(m, t)).map((t) => [t, cell2(m, t)])),
    };
    const claim1 = {
      strict: CLAIM1.map(([b, a, role]) => c1(m, b, a, role, "strict", units, fullRole(role))),
      adapted: CLAIM1.map(([b, a, role]) => c1(m, b, a, role, "adapted", units, false)),
    };
    const counts = (c: Cell) => units.filter((u) => { const r = fRow(u.id, m, c); return !gapOf(r, "strict") && isClean(r!.strict.outcome); }).length;
    const stage2: Stage2 | null = ran(m, "A1") && ran(m, "A2") ? stage2Rule(m, counts("A1"), counts("A2")) : null;
    const lens = claim1.strict.find((c) => c.role === "lens")!;
    const lens_open = stage2 && !stage2.eligible && lens.stat?.ci95 ? { largest_lens_gain_points: Number(pts(lens.stat.ci95[1])), text: "claim 1 stops at n = 60 on " + m + "; the lens upper bound leaves open a gain of up to " + pts(lens.stat.ci95[1]) + " points" } : null;
    const claim2 = {
      incremental: CLAIM2.map(([b, a, role]) => c2(m, b, a, role, "inc", units, fullRole(role))),
      end_to_end: CLAIM2.map(([b, a, role]) => c2(m, b, a, role, "e2e", units, false)),
      whole_incremental: CLAIM2.map(([b, a, role]) => c2(m, b, a, role, "whole_inc", units, false)),
      whole_end_to_end: CLAIM2.map(([b, a, role]) => c2(m, b, a, role, "whole_e2e", units, false)),
    };
    const trees = TREES.filter((t) => ranTree(m, t)).map((t) => {
      const v = units.map((u) => treeVal(u, m, t));
      const full = v.filter((y) => y.pass3_inc !== null), kept = v.filter((y) => y.kept);
      return {
        tree: t, kept: kept.length, mean_incremental: kept.length ? kept.reduce((s, y) => s + y.inc!, 0) / kept.length : null, removed: Object.entries(v.filter((y) => !y.kept).reduce<Record<string, number>>((a, y) => ((a[y.reason.replace(/ E_\S+$/, " (code)")] = (a[y.reason.replace(/ E_\S+$/, " (code)")] ?? 0) + 1), a), {})),
        pass3: { trees: full.length, incremental: full.filter((y) => y.pass3_inc).length, end_to_end: full.filter((y) => y.pass3_e2e).length },
        inherited_fix: v.filter((y) => y.kept && y.inherited).length, drift_units: v.filter((y) => y.drift).length,
      };
    });
    const literal = {
      first_stage_test_patch_conflict_trees: units.flatMap((u) => (["A1", "S2"] as Tree[]).map((t) => treeVal(u, m, t))).filter((y) => y.first_tpc).length,
      start_set_conflict_trees: units.flatMap((u) => TREES.map((t) => treeVal(u, m, t))).filter((y) => y.start_conflict).length,
    };
    const without = (pred: (u: UnitRow) => boolean) => by((u) => !pred(u));
    const sensitivity = {
      in_source: {
        units_left_out: units.filter((u) => u.in_source).length,
        claim1: CLAIM1.slice(0, 2).map(([b, a, role]) => c1(m, b, a, role, "strict", without((u) => u.in_source), false)),
        claim2: CLAIM2.slice(0, 2).map(([b, a, role]) => c2(m, b, a, role, "inc", without((u) => u.in_source), false)),
      },
      inherited_fix: CLAIM2.map(([b, a, role]) => {
        const out = without((u) => treeVal(u, m, b).inherited || treeVal(u, m, a).inherited);
        return { ...c2(m, b, a, role, "inc", out, false), units_left_out: units.length - out.length, label: "conditioned on the outcome" };
      }),
      drift: CLAIM2.map(([b, a, role]) => {
        const out = without((u) => treeVal(u, m, b).drift || treeVal(u, m, a).drift);
        return { ...c2(m, b, a, role, "inc", out, false), units_left_out: units.length - out.length };
      }),
    };
    const stState = by((u) => u.stratum === "state"), stOther = by((u) => u.stratum === "other");
    const strata = CLAIM1.slice(0, 2).map(([b, a, role]) => {
      const s = c1(m, b, a, role, "strict", stState, false), o = c1(m, b, a, role, "strict", stOther, false);
      const dd = s.status === "ok" ? diffOfDiffs(pairs1(m, b, a, "strict", "clean", stState).pairs, pairs1(m, b, a, "strict", "clean", stOther).pairs, cfg) : null;
      return { name: b + "-" + a, role, state: s, other: o, difference_of_differences: dd };
    });
    const july = by((u) => u.july);
    const julyOut = { units: july.length, claim1: c1(m, "A1", "A0", "primary", "strict", july, false), claim2: c2(m, "A1", "S0", "primary", "inc", july, false) };
    const rows = (c: Cell) => x.first.filter((r) => r.model === m && r.cell === c);
    const reruns = Object.fromEntries(CELLS.filter((c) => ran(m, c)).map((c) => [c, Object.fromEntries((["strict", "adapted"] as ReadingName[]).map((rd) => {
      const rs = rows(c).map((r) => r[rd]);
      return [rd, { sessions: rs.filter((r) => r.rerun_2of3).length, fix: rs.filter((r) => r.reruns?.fix.length).length, no_fix: rs.filter((r) => r.reruns?.no_fix.length).length, break: rs.filter((r) => r.reruns?.break.length).length, direction_unrecorded: rs.filter((r) => r.rerun_2of3 && !r.reruns).length }];
    }))]));
    const fallbacks = Object.fromEntries(CELLS.filter((c) => ran(m, c)).map((c) => [c, rows(c).flatMap((r) => r.fallbacks).reduce<Record<string, number>>((a, f) => ((a[f.reason + " (" + f.reading + ")"] = (a[f.reason + " (" + f.reading + ")"] ?? 0) + 1), a), {})]));
    const questions = Object.fromEntries(CELLS.filter((c) => ran(m, c) && rows(c).some((r) => r.questions)).map((c) => {
      const q = rows(c).filter((r) => r.questions);
      return [c, { sessions: q.length, ask_user_question: q.reduce((a, r) => a + r.questions!.ask_user_question, 0), prose: q.reduce((a, r) => a + r.questions!.prose, 0) }];
    }));
    const exposure = Object.fromEntries((["A1", "S2", "A3"] as Cell[]).filter((c) => rows(c).some((r) => r.exposed !== null)).map((c) => {
      const e = rows(c).filter((r) => r.exposed !== null);
      return [c, { sessions: e.length, exposed: e.filter((r) => r.exposed).length, rate: e.filter((r) => r.exposed).length / e.length }];
    }));
    return { model: m, cells, claim1: { ...claim1, stage2, lens_open }, claim2: { ...claim2, trees }, sensitivity, strata, july: julyOut, reruns, fallbacks, literal, questions, exposure };
  });

  const pooled = {
    claim1: CLAIM1.slice(0, 3).map(([b, a, role]) => {
      const byM = new Map(x.models.filter((m) => ran(m, a) && ran(m, b)).map((m) => [m, pairs1(m, b, a, "strict", "clean", units).pairs]));
      const all = [...byM.values()].flat();
      const sb = stratifiedBootstrap(byM, cfg);
      const mc = all.length ? exactMcNemar(all.map((p) => ({ id: p.unit, cluster: p.repo, a: p.a, b: p.b }))) : null;
      return { name: b + "-" + a, role, models: [...byM.keys()], n: all.length, delta: sb.delta, ci95: sb.ci95, p: mc?.p_two_sided ?? null, worse: mc?.losses ?? 0, better: mc?.wins ?? 0, mdd: all.length ? mddClaim1((mc!.discordant) / all.length, true) : null, descriptive: true };
    }),
    claim2: CLAIM2.map(([b, a, role]) => {
      const byM = new Map(x.models.filter((m) => ranTree(m, a) && ranTree(m, b)).map((m) => [m, pairs2(m, b, a, "inc", units).pairs]));
      const all = [...byM.values()].flat();
      const sb = stratifiedBootstrap(byM, cfg);
      return { name: b + "-" + a, role, models: [...byM.keys()], n: all.length, delta: sb.delta, ci95: sb.ci95, p: all.length ? exactSignFlip(all.map((p) => p.b - p.a)).p : null, worse: all.filter((p) => p.b < p.a).length, better: all.filter((p) => p.b > p.a).length, descriptive: true };
    }),
  };
  return { schema: "sm-analysis.v1" as const, units: units.length, models: perModel, pooled, config: x.config };
}
export type Analysis = ReturnType<typeof analyse>;

// ---- The printed report ----

const fmtStat = (s: Stat | null) =>
  !s ? "no pairs" : "n=" + s.n + " repos=" + s.n_repos + " diff=" + pts(s.delta) + " pts 95% [" + (s.ci95 ? pts(s.ci95[0]) + ", " + pts(s.ci95[1]) : "none") + "] p=" + s.p.toPrecision(3) + " worse=" + s.worse + " better=" + s.better;

export function report(a: Analysis): string[] {
  const out: string[] = [];
  for (const m of a.models) {
    out.push("== " + m.model);
    for (const c of m.claim1.strict) {
      if (c.status !== "ok") { out.push("claim 1 " + c.name + " (" + c.role + "): not run"); continue; }
      out.push("claim 1 " + c.name + " (" + c.role + ", strict): " + fmtStat(c.stat) + (c.verdict ? " -> " + c.reading_text + (c.verdict === "NO MEASURABLE DIFFERENCE" || c.role === "lens" ? "; " + c.mdd : "") : ""));
      if (c.incomplete_cells.length) out.push("  E_SM_CELL_INCOMPLETE " + c.incomplete_cells.join(", ") + ": gaps on more than 10% of units, no verdict");
      if (c.breaks) out.push("  break-rate difference: " + fmtStat(c.breaks.stat) + (c.breaks.breaks_more ? " -> breaks more" : ""));
      if (c.worst_case) out.push("  gap worst case: " + fmtStat(c.worst_case.stat) + " -> " + c.worst_case.verdict);
      const ad = m.claim1.adapted.find((y) => y.name === c.name);
      if (ad?.status === "ok") out.push("  adapted beside: " + fmtStat(ad.stat));
    }
    if (m.claim1.stage2) out.push("stage 2: " + m.claim1.stage2.text);
    if (m.claim1.lens_open) out.push(m.claim1.lens_open.text);
    for (const [k, list] of [["incremental", m.claim2.incremental], ["end to end (net value)", m.claim2.end_to_end], ["whole change, incremental (reported only)", m.claim2.whole_incremental]] as const) {
      for (const c of list) {
        if (c.status !== "ok") { out.push("claim 2 " + c.name + " " + k + ": not run"); continue; }
        out.push("claim 2 " + c.name + " (" + c.role + ", " + k + "): " + fmtStat(c.stat) + (c.verdict ? " -> " + c.reading_text + (c.verdict === "NO MEASURABLE DIFFERENCE" || c.role === "lens" ? "; " + c.mdd : "") : ""));
        if (c.incomplete_cells.length) out.push("  E_SM_CELL_INCOMPLETE " + c.incomplete_cells.join(", ") + ": gaps on more than 10% of units, no verdict");
        if (c.breaks) out.push("  first-stage break-rate difference: " + fmtStat(c.breaks.stat) + (c.breaks.breaks_more ? " -> breaks more" : ""));
        if (c.worst_case) out.push("  gap worst case: " + fmtStat(c.worst_case.stat) + " -> " + c.worst_case.verdict);
      }
    }
    for (const t of m.claim2.trees) out.push("tree " + t.tree + ": kept=" + t.kept + " pass^3 incremental " + t.pass3.incremental + "/" + t.pass3.trees + " end to end " + t.pass3.end_to_end + "/" + t.pass3.trees + " inherited=" + t.inherited_fix + " drift_units=" + t.drift_units);
    out.push("literal choices: first-stage test-patch conflict removed " + m.literal.first_stage_test_patch_conflict_trees + " trees; start-set conflict gapped " + m.literal.start_set_conflict_trees + " trees");
    for (const s of m.strata) out.push("stratum " + s.name + ": state " + fmtStat(s.state.stat) + " | other " + fmtStat(s.other.stat) + " | difference of differences " + (s.difference_of_differences?.delta == null ? "none" : pts(s.difference_of_differences.delta) + " pts 95% [" + (s.difference_of_differences.ci95 ? pts(s.difference_of_differences.ci95[0]) + ", " + pts(s.difference_of_differences.ci95[1]) : "none") + "]"));
    out.push("July stratum (" + m.july.units + " units): claim 1 " + fmtStat(m.july.claim1.stat) + " | claim 2 " + fmtStat(m.july.claim2.stat));
    out.push("reruns: " + JSON.stringify(m.reruns));
    out.push("fallbacks: " + JSON.stringify(m.fallbacks));
    if (Object.keys(m.questions).length) out.push("questions: " + JSON.stringify(m.questions));
    if (Object.keys(m.exposure).length) out.push("exposure: " + JSON.stringify(m.exposure));
  }
  out.push("== pooled across models (stratified by model, descriptive)");
  for (const c of [...a.pooled.claim1, ...a.pooled.claim2]) out.push(c.name + " (" + c.role + "): n=" + c.n + " diff=" + pts(c.delta) + " pts 95% [" + (c.ci95 ? pts(c.ci95[0]) + ", " + pts(c.ci95[1]) : "none") + "] p=" + (c.p === null ? "none" : c.p.toPrecision(3)) + " worse=" + c.worse + " better=" + c.better);
  return out;
}

// ---- Building the input from records ----

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const LEGACY_FALLBACK: Array<[RegExp, FallbackReason]> = [[/skip marker/i, "skip_marker"], [/absent|missing/i, "stable_missing"]];

function readingRow(v: unknown): ReadingRow {
  const r = obj(v) ?? {};
  const rr = obj(r.reruns);
  return {
    outcome: typeof r.outcome === "string" && OUTCOMES.includes(r.outcome) ? (r.outcome as Outcome) : null,
    gap: typeof r.gap === "string" ? r.gap : null,
    reruns: rr ? { fix: arr(rr.fix), no_fix: arr(rr.no_fix), break: arr(rr.break) } : null,
    rerun_2of3: r.rerun_2of3 === true,
  };
}

/** Session gap: a second upstream or infra end (session.ts nextStep). */
const sessionGap = (s: Record<string, unknown> | undefined): string | null =>
  s && s.attempt === 2 && (s.end === "upstream" || s.end === "infra") ? (s.end === "upstream" ? "E_SM_UPSTREAM_GAP" : "E_SM_INFRA_GAP") : null;

export interface BuildSources { units: unknown[]; outcomes: unknown[]; followons: unknown[]; sessions?: unknown[]; bootstrap_seed: number; models?: string[] }

/** sm-analysis-input.v1 from records, reading the scorer's fields by name: reruns per direction, fallbacks, the follow-on's
 *  strict and whole readings and the gap reasons first_stage_test_patch_conflict and start_set_conflict. Older records
 *  without them still read: reruns stay unrecorded, fallbacks come from adapted.fell_back_to_strict, the follow-on's
 *  top-level scores serve as strict and whole is null. */
export function buildInput(src: BuildSources): AnalysisInput {
  const units: UnitRow[] = src.units.map((v) => {
    const u = obj(v) ?? refuse("a unit is not an object");
    const labels = obj(u.labels), split = obj(u.split);
    const month = typeof u.month === "string" ? u.month : refuse("unit " + String(u.id) + " has no month");
    const stratum = labels && (labels.stratum === "state" || labels.stratum === "other") ? labels.stratum : "unclear";
    return { id: String(u.id), repo: String(u.repo ?? ""), month, stratum, july: month === "2026-07", in_source: split?.in_source_tests === true };
  });
  const sessions = (src.sessions ?? []).map((v) => obj(v) ?? refuse("a session record is not an object")).filter((s) => s.schema === "sm-session.v1");
  const latest = new Map<string, Record<string, unknown>>();
  for (const s of sessions) {
    const k = String(s.unit) + "\u0000" + String(s.model) + "\u0000" + String(s.cell);
    const prev = latest.get(k);
    if (!prev || Number(s.attempt) > Number(prev.attempt)) latest.set(k, s);
  }
  const sKey = (u: string, m: string, c: string) => latest.get(u + "\u0000" + m + "\u0000" + c);
  const modelOf = (v: unknown, what: string) => (typeof v === "string" && v ? v : refuse(what + " has no model; analysis reads only records of real sessions"));
  const first: FirstRow[] = [];
  const seenFirst = new Set<string>();
  for (const v of src.outcomes) {
    const o = obj(v) ?? refuse("an outcome record is not an object");
    if (o.schema !== "sm-outcome.v1" || o.stage !== "first") continue;
    const model = modelOf(o.model, "outcome record " + String(o.unit) + " " + String(o.cell));
    const s = sKey(String(o.unit), model, String(o.cell));
    const strict = readingRow(o.strict), adapted = readingRow(o.adapted);
    const fb = Array.isArray(o.fallbacks)
      ? o.fallbacks.map((f) => { const g = obj(f) ?? {}; return { reason: (FALLBACKS as readonly string[]).includes(String(g.reason)) ? (g.reason as FallbackReason) : refuse("fallback reason " + String(g.reason) + " is not one the scorer writes"), reading: g.reading === "strict" ? "strict" as const : "adapted" as const }; })
      : (() => { const t = obj(o.adapted)?.fell_back_to_strict; return typeof t === "string" && t ? [{ reason: LEGACY_FALLBACK.find(([re]) => re.test(t))?.[1] ?? "unrecorded" as FallbackReason, reading: "adapted" as const }] : []; })();
    const q = obj(s?.questions), ex = obj(s?.exposure);
    first.push({
      unit: String(o.unit), model, cell: String(o.cell) as Cell, session_gap: sessionGap(s), strict, adapted, fallbacks: fb,
      questions: q ? { ask_user_question: Number(q.ask_user_question ?? 0), prose: Number(q.prose ?? 0) } : null,
      exposed: typeof ex?.text === "boolean" ? ex.text : typeof ex?.exposed === "boolean" ? ex.exposed : null,
    });
    seenFirst.add(String(o.unit) + "\u0000" + model + "\u0000" + String(o.cell));
  }
  for (const s of sessions) {
    if (s.stage !== "first" || !sessionGap(s)) continue;
    const k = String(s.unit) + "\u0000" + String(s.model) + "\u0000" + String(s.cell);
    if (seenFirst.has(k) || latest.get(k) !== s) continue;
    const blank: ReadingRow = { outcome: null, gap: null, reruns: null, rerun_2of3: false };
    first.push({ unit: String(s.unit), model: String(s.model), cell: String(s.cell) as Cell, session_gap: sessionGap(s), strict: blank, adapted: blank, fallbacks: [], questions: null, exposed: null });
    seenFirst.add(k);
  }
  const followon: FollowRow[] = [];
  const seenF = new Set<string>();
  for (const v of src.followons) {
    const f = obj(v) ?? refuse("a follow-on record is not an object");
    if (f.schema !== "sm-followon.v1") continue;
    const model = modelOf(f.model, "follow-on record " + String(f.unit) + " " + String(f.cell));
    const st = obj(f.strict), wh = obj(f.whole), start = obj(f.start);
    const bit = (x: unknown) => (x === 0 || x === 1 ? x : null);
    let gap = typeof f.gap === "string" ? f.gap : null;
    if (gap && gap !== "first_stage_test_patch_conflict" && start && typeof start.gap === "string") gap = "start_set_conflict";
    const rep = typeof f.replicate === "number" ? f.replicate : Number(/-(\d+)$/.exec(String(f.cell))?.[1] ?? NaN);
    followon.push({
      unit: String(f.unit), model, tree: String(f.tree) as Tree, rep, gap,
      incremental: bit(st ? st.incremental : f.incremental), end_to_end: bit(st ? st.end_to_end : f.end_to_end),
      whole: wh && bit(wh.incremental) !== null && bit(wh.end_to_end) !== null ? { incremental: wh.incremental as 0 | 1, end_to_end: wh.end_to_end as 0 | 1 } : null,
      drift: obj(f.drift)?.drift === true,
    });
    seenF.add(String(f.unit) + "\u0000" + model + "\u0000" + String(f.tree) + "\u0000" + rep);
  }
  for (const s of sessions) {
    if (s.stage !== "followon" || !sessionGap(s)) continue;
    const tree = obj(s.tree_ref)?.tree ?? /^F-(S0|A1|S2)-/.exec(String(s.cell))?.[1];
    const rep = Number(/-(\d+)$/.exec(String(s.cell))?.[1] ?? NaN);
    const k = String(s.unit) + "\u0000" + String(s.model) + "\u0000" + String(tree) + "\u0000" + rep;
    if (seenF.has(k) || latest.get(String(s.unit) + "\u0000" + String(s.model) + "\u0000" + String(s.cell)) !== s) continue;
    followon.push({ unit: String(s.unit), model: String(s.model), tree: String(tree) as Tree, rep, gap: sessionGap(s), incremental: null, end_to_end: null, whole: null, drift: false });
    seenF.add(k);
  }
  const models = src.models ?? [...new Set([...first.map((r) => r.model), ...followon.map((r) => r.model)])].sort();
  const input: AnalysisInput = { schema: "sm-analysis-input.v1", models, units, first: sortU(first), followon: sortU(followon), config: { bootstrap_seed: src.bootstrap_seed, draws: 10_000, replicates: 3 } };
  checkInput(input);
  return input;
}
