// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 12's analysis. Rates with Wilson 95% intervals; the confirmatory verdicts P minus N and P minus C pooled
// over the models, with a bootstrap over repositories stratified by model (10,000 resamples, bootstrap_seed), a two-sided
// bootstrap p (twice the smaller share of resampled differences at or beyond 0) and Holm over the two contrasts; the
// exact McNemar p and the counts worse and better beside them. Per model the same contrasts carry the exact McNemar p
// with Holm over P minus N and P minus C; C minus N is descriptive. Beside every verdict: the gap worst case, the reading
// that scores fix-merge conflicts and fix-tree rebuild failures as misses, the reading that scores tree-check refusals,
// S base or head mismatches and post-turn failures on what the agent wrote (E_PF_ARM) as misses for the arm that produced them, the static-text, API-guess and compile-blocked readings, the
// E_PF_ARM and E_PF_WRAPUP_ALLOWANCE gaps per arm and model, and the exposure rates. Strata are descriptive.
import { exactMcNemar, holmAdjusted, seededRandom } from "../../../src/runner/stats/paired.ts";
import type { Arm } from "./items.ts";

export const DRAWS = 10_000;
export type Score = 0 | 1 | null;
export interface Row { unit: string; repo: string; model: string; arm: Arm; stratum: string; score: Score; gap: string | null; no_static: Score; no_api_guess: Score; compile_rerun: Score; loaded?: boolean; checker?: boolean; breaks?: number | null; breaks_unmeasured?: boolean; entries?: number; unreached?: number; timeout_only?: number; ceiling_hit?: boolean; timeout_s?: number | null; overhead_ms?: number | null; flagged?: boolean; reservation_bound?: number; subagents?: number; subagent_cap_refused?: number }
export const READINGS = ["primary", "worst_case", "conflict_as_miss", "arm_refusal_as_miss", "no_static", "no_api_guess", "compile_rerun", "ceiling_missing", "no_flagged"] as const;
export type Reading = (typeof READINGS)[number];
export const MISS_GAPS = new Set(["E_PF_FIX_CONFLICT", "E_PF_REBUILD_FIX"]);
/** Gaps an arm's own session can cause, counted per arm and model beside every verdict. */
export const NAMED_GAPS = { E_PF_ARM: "tree-check refusals, S base or head mismatches and post-turn failures on what the agent wrote", E_PF_WRAPUP_ALLOWANCE: "wrap-up refused for its allowance" } as const;

export function valueOf(r: Row, k: Reading): Score {
  if (k === "primary") return r.score;
  if (k === "worst_case") return r.score ?? 0;
  if (k === "conflict_as_miss") return r.score ?? (r.gap && MISS_GAPS.has(r.gap) ? 0 : null);
  if (k === "arm_refusal_as_miss") return r.score ?? (r.gap === "E_PF_ARM" ? 0 : null);
  if (k === "ceiling_missing") return r.score === 0 && (r.unreached ?? 0) > 0 ? null : r.score;
  if (k === "no_flagged") return r.flagged ? null : r.score;
  return r[k];
}

// Copied from lanes/autoplan-audit/stats.ts (the Wilson score interval, as power.py computes it).
const Z975 = 1.959964;
export function wilson(k: number, n: number, z = Z975): [number, number] {
  if (n <= 0) return [0, 1];
  const p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}

export interface Pair { unit: string; repo: string; model: string; a: number; b: number }

/** The bootstrap over repositories, stratified by model: each model's repositories are resampled within the model and the
 *  difference is the sum of paired differences over the sum of pairs (the structure of statemachines/analysis.ts
 *  stratifiedBootstrap, with the draws kept for the p). */
export function bootstrap(pairs: readonly Pair[], seed: number, draws = DRAWS): { delta: number; ci95: [number, number] | null; p: number } {
  const models = [...new Set(pairs.map((p) => p.model))].sort();
  const strata = models.map((m) => {
    const by = new Map<string, { sum: number; count: number }>();
    for (const p of pairs.filter((x) => x.model === m)) {
      const c = by.get(p.repo) ?? { sum: 0, count: 0 };
      c.sum += p.b - p.a;
      c.count++;
      by.set(p.repo, c);
    }
    return [...by.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, c]) => c);
  });
  const all = strata.flat();
  const n = all.reduce((a, c) => a + c.count, 0);
  if (!n) return { delta: 0, ci95: null, p: 1 };
  const delta = all.reduce((a, c) => a + c.sum, 0) / n;
  if (strata.every((s) => s.length < 2)) return { delta, ci95: null, p: 1 };
  const rng = seededRandom(seed);
  const boot = new Array<number>(draws);
  for (let i = 0; i < draws; i++) {
    let sum = 0, count = 0;
    for (const s of strata) for (let j = 0; j < s.length; j++) {
      const c = s[Math.floor(rng() * s.length)]!;
      sum += c.sum;
      count += c.count;
    }
    boot[i] = sum / count;
  }
  const lo = boot.filter((x) => x <= 0).length / draws, hi = boot.filter((x) => x >= 0).length / draws;
  boot.sort((x, y) => x - y);
  return { delta, ci95: [boot[Math.floor(draws * 0.025)]!, boot[Math.ceil(draws * 0.975) - 1]!], p: Math.min(1, 2 * Math.min(lo, hi)) };
}

export function pairsOf(rows: readonly Row[], a: Arm, b: Arm, k: Reading, models?: string[]): Pair[] {
  const at = new Map<string, Row>();
  for (const r of rows) if (!models || models.includes(r.model)) at.set(r.unit + "|" + r.model + "|" + r.arm, r);
  const out: Pair[] = [];
  for (const r of at.values()) {
    if (r.arm !== b) continue;
    const o = at.get(r.unit + "|" + r.model + "|" + a);
    const vb = valueOf(r, k), va = o ? valueOf(o, k) : null;
    if (va !== null && vb !== null) out.push({ unit: r.unit, repo: r.repo, model: r.model, a: va, b: vb });
  }
  return out.sort((x, y) => (x.model + x.unit < y.model + y.unit ? -1 : 1));
}

export type Verdict = "HELPS" | "HURTS" | "NO MEASURABLE DIFFERENCE" | "INCOMPLETE";
export function verdictOf(ci: [number, number] | null, p: number, incomplete: boolean): Verdict {
  if (incomplete) return "INCOMPLETE";
  if (ci && ci[0] > 0 && p < 0.05) return "HELPS";
  if (ci && ci[1] < 0 && p < 0.05) return "HURTS";
  return "NO MEASURABLE DIFFERENCE";
}

/** Section 14's MDD, at the tabulated n nearest the units in the contrast. */
export function mddText(units: number, pooled: boolean): string {
  const rows: Array<[number, string]> = pooled
    ? [[28, "16 to 27 points at discordant shares 0.2 to 0.5"], [44, "13 to 22 points at discordant shares 0.2 to 0.5"]]
    : [[28, "no difference fits at discordant shares 0.2 or 0.3; 37 to 39 points at 0.4 and 41 to 43 at 0.5"], [36, "28 to 39 points at discordant shares 0.3 to 0.5"], [44, "25 to 36 points at discordant shares 0.3 to 0.5"]];
  const [n, t] = rows.reduce((best, r) => (Math.abs(r[0] - units) < Math.abs(best[0] - units) ? r : best));
  return "MDD (section 14, tabulated n = " + n + (pooled ? ", pooled" : ", per model") + "): " + t;
}

export interface ContrastOut { n: number; n_repos: number; delta: number; ci95: [number, number] | null; p: number; p_holm: number | null; mcnemar_p: number; worse: number; better: number; verdict: Verdict | null; mdd: string; readings: Record<string, { n: number; delta: number; ci95: [number, number] | null; p: number }>; named_gaps: Record<string, Record<string, Partial<Record<Arm, number>>>> }

function contrast(rows: readonly Row[], a: Arm, b: Arm, seed: number, models: string[] | undefined, pooled: boolean): Omit<ContrastOut, "p_holm" | "verdict"> {
  const pairs = pairsOf(rows, a, b, "primary", models);
  const bs = bootstrap(pairs, seed);
  const mc = exactMcNemar(pairs.map((p) => ({ id: p.model + "|" + p.unit, cluster: p.repo, a: p.a, b: p.b })));
  const readings: ContrastOut["readings"] = {};
  for (const k of READINGS.slice(1)) {
    const pk = pairsOf(rows, a, b, k, models);
    const x = bootstrap(pk, seed);
    readings[k] = { n: pk.length, delta: x.delta, ci95: x.ci95, p: x.p };
  }
  const named_gaps: ContrastOut["named_gaps"] = {};
  for (const code of Object.keys(NAMED_GAPS)) {
    const by: Record<string, Partial<Record<Arm, number>>> = (named_gaps[code] = {});
    for (const m of models ?? [...new Set(rows.map((r) => r.model))].sort()) by[m] = Object.fromEntries([b, a].map((arm) => [arm, rows.filter((r) => r.model === m && r.arm === arm && r.gap === code).length]));
  }
  return { n: pairs.length, n_repos: new Set(pairs.map((p) => p.repo)).size, delta: bs.delta, ci95: bs.ci95, p: bs.p, mcnemar_p: mc.p_two_sided, worse: pairs.filter((p) => p.b < p.a).length, better: pairs.filter((p) => p.b > p.a).length, mdd: mddText(new Set(pairs.map((p) => p.unit)).size, pooled), readings, named_gaps };
}

export interface Cell { model: string; arm: Arm; units: number; gaps: number; incomplete: boolean }
export function cellsOf(rows: readonly Row[]): Cell[] {
  const by = new Map<string, Cell>();
  for (const r of rows) {
    const c = by.get(r.model + "|" + r.arm) ?? { model: r.model, arm: r.arm, units: 0, gaps: 0, incomplete: false };
    c.units++;
    if (r.score === null) c.gaps++;
    c.incomplete = c.gaps / c.units > 0.1;
    by.set(r.model + "|" + r.arm, c);
  }
  return [...by.values()].sort((x, y) => (x.model + x.arm < y.model + y.arm ? -1 : 1));
}

export function ratesOf(rows: readonly Row[]) {
  const by = new Map<string, { model: string; arm: Arm; k: number; n: number }>();
  for (const r of rows) {
    if (r.score === null) continue;
    const c = by.get(r.model + "|" + r.arm) ?? { model: r.model, arm: r.arm, k: 0, n: 0 };
    c.k += r.score;
    c.n++;
    by.set(r.model + "|" + r.arm, c);
  }
  return [...by.values()].sort((x, y) => (x.model + x.arm < y.model + y.arm ? -1 : 1)).map((c) => ({ ...c, rate: c.n ? c.k / c.n : null, ci95: wilson(c.k, c.n) }));
}

export function exposureOf(rows: readonly Row[]) {
  const out: Record<string, Record<string, { sessions: number; loaded: number; checker: number; both: number }>> = {};
  for (const r of rows) {
    const m = (out[r.model] ??= {});
    const c = (m[r.arm] ??= { sessions: 0, loaded: 0, checker: 0, both: 0 });
    c.sessions++;
    if (r.loaded) c.loaded++;
    if (r.checker) c.checker++;
    if (r.loaded && r.checker) c.both++;
  }
  return out;
}

/** The breaks secondary per model and arm: sessions it measured, those with at least one break, and those it could not
 *  measure. Sessions scored without the breaks runs are not counted. */
export function breaksOf(rows: readonly Row[]) {
  const out: Record<string, Record<string, { measured: number; with_breaks: number; not_measured: number }>> = {};
  for (const r of rows) {
    if ((r.breaks ?? null) === null && !r.breaks_unmeasured) continue;
    const c = ((out[r.model] ??= {})[r.arm] ??= { measured: 0, with_breaks: 0, not_measured: 0 });
    if (r.breaks_unmeasured) c.not_measured++;
    else {
      c.measured++;
      if (r.breaks! > 0) c.with_breaks++;
    }
  }
  return out;
}

/** The ceiling limit (section 6.7): a unit is flagged when one entry that times out on the parent and neutral trees could
 *  not start its last neutral run inside the ceiling even alone, 5T + 8R >= 10,800 s, where T is the unit's entry timeout
 *  and R the median, over its sessions in every arm, of each session's median run overhead (the tree copy, the container's
 *  start and the rebuild). */
export const CEILING_S = 10_800;
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
export function flaggedUnits(rows: readonly Row[]): Map<string, { t_s: number | null; r_s: number | null; flagged: boolean }> {
  const out = new Map<string, { t_s: number | null; r_s: number | null; flagged: boolean }>();
  for (const unit of new Set(rows.map((r) => r.unit))) {
    const rs = rows.filter((r) => r.unit === unit);
    const ts = rs.map((r) => r.timeout_s).filter((x): x is number => typeof x === "number");
    const t_s = ts.length ? Math.max(...ts) : null;
    const m = median(rs.map((r) => r.overhead_ms).filter((x): x is number => typeof x === "number"));
    const r_s = m === null ? null : m / 1000;
    out.set(unit, { t_s, r_s, flagged: t_s !== null && r_s !== null && 5 * t_s + 8 * r_s >= CEILING_S });
  }
  return out;
}

/** Per model and arm: sessions, entries scored, entries the ceiling left unreached, timeout-only entries (every parent run
 *  timed out) and sessions that hit the ceiling, with the two shares of entries. */
export function ceilingOf(rows: readonly Row[]) {
  const out: Record<string, Record<string, { sessions: number; entries: number; unreached: number; timeout_only: number; ceiling_hit: number; unreached_rate: number | null; timeout_only_share: number | null }>> = {};
  for (const r of rows) {
    const c = ((out[r.model] ??= {})[r.arm] ??= { sessions: 0, entries: 0, unreached: 0, timeout_only: 0, ceiling_hit: 0, unreached_rate: null, timeout_only_share: null });
    c.sessions++;
    c.entries += r.entries ?? 0;
    c.unreached += r.unreached ?? 0;
    c.timeout_only += r.timeout_only ?? 0;
    if (r.ceiling_hit) c.ceiling_hit++;
    c.unreached_rate = c.entries ? c.unreached / c.entries : null;
    c.timeout_only_share = c.entries ? c.timeout_only / c.entries : null;
  }
  return out;
}

/** Per model and arm (section 12): allowance stops that only calls still in flight caused, and the subagents sessions asked
 *  for and the ones the concurrent-subagent cap refused, so a cap that bit one arm harder shows beside every verdict. */
export function inFlightOf(rows: readonly Row[]) {
  const out: Record<string, Record<string, { sessions: number; reservation_bound: number; sessions_reservation_bound: number; subagents: number; subagent_cap_refused: number; sessions_cap_refused: number }>> = {};
  for (const r of rows) {
    const c = ((out[r.model] ??= {})[r.arm] ??= { sessions: 0, reservation_bound: 0, sessions_reservation_bound: 0, subagents: 0, subagent_cap_refused: 0, sessions_cap_refused: 0 });
    c.sessions++;
    c.reservation_bound += r.reservation_bound ?? 0;
    if (r.reservation_bound) c.sessions_reservation_bound++;
    c.subagents += r.subagents ?? 0;
    c.subagent_cap_refused += r.subagent_cap_refused ?? 0;
    if (r.subagent_cap_refused) c.sessions_cap_refused++;
  }
  return out;
}

export function analyse(input: readonly Row[], seed: number) {
  const flags = flaggedUnits(input);
  const rows = input.map((r) => ({ ...r, flagged: flags.get(r.unit)!.flagged }));
  const cells = cellsOf(rows);
  const models = [...new Set(rows.map((r) => r.model))].sort();
  const incomplete = (arms: Arm[], ms: string[]) => cells.some((c) => arms.includes(c.arm) && ms.includes(c.model) && c.incomplete);
  const finish = (x: Omit<ContrastOut, "p_holm" | "verdict">[], arms: Array<[Arm, Arm]>, ms: string[], p: (c: (typeof x)[number]) => number): ContrastOut[] => {
    const holm = holmAdjusted(x.map(p));
    return x.map((c, i) => ({ ...c, p_holm: holm[i]!, verdict: verdictOf(c.ci95, holm[i]!, incomplete(arms[i]!, ms)) }));
  };
  const V: Array<[Arm, Arm]> = [["N", "P"], ["C", "P"]];
  const [pn, pc] = finish(V.map(([a, b]) => contrast(rows, a, b, seed, undefined, true)), V, models, (c) => c.p);
  const per_model: Record<string, Record<string, ContrastOut>> = {};
  for (const m of models) {
    const [mpn, mpc] = finish(V.map(([a, b]) => contrast(rows, a, b, seed, [m], false)), V, [m], (c) => c.mcnemar_p);
    per_model[m] = { "P-N": mpn!, "P-C": mpc!, "C-N": { ...contrast(rows, "N", "C", seed, [m], false), p_holm: null, verdict: null } };
  }
  const strata: Record<string, unknown> = {};
  for (const s of [...new Set(rows.map((r) => r.stratum))].sort()) {
    const sr = rows.filter((r) => r.stratum === s);
    strata[s] = { rates: ratesOf(sr), "P-N": contrast(sr, "N", "P", seed, undefined, true), "P-C": contrast(sr, "C", "P", seed, undefined, true), "C-N": contrast(sr, "N", "C", seed, undefined, true) };
  }
  const exposure = exposureOf(rows);
  const p = Object.values(exposure).reduce((a, m) => ({ s: a.s + (m.P?.sessions ?? 0), b: a.b + (m.P?.both ?? 0) }), { s: 0, b: 0 });
  const process_reading = p.s && p.b / p.s >= 0.75 ? "a fair test of pstack's text" : "pstack as the model ran it (" + p.b + " of " + p.s + " P sessions loaded the skill and ran a checker)";
  return { schema: "pf-analysis.v1" as const, seed, draws: DRAWS, rates: ratesOf(rows), cells, pooled: { "P-N": pn!, "P-C": { ...pc!, process_reading } }, pooled_c_n: { ...contrast(rows, "N", "C", seed, undefined, true), p_holm: null, verdict: null }, per_model, strata, exposure, ceiling: ceilingOf(rows), in_flight: inFlightOf(rows), flagged_units: [...flags].filter(([, f]) => f.flagged).map(([unit, f]) => ({ unit, ...f })).sort((a, b) => (a.unit < b.unit ? -1 : 1)), breaks: breaksOf(rows), incomplete: cells.filter((c) => c.incomplete) };
}
export type Analysis = ReturnType<typeof analyse>;

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "-" : (100 * x).toFixed(1));
const ci = (c: [number, number] | null) => (c ? "[" + pct(c[0]) + ", " + pct(c[1]) + "]" : "[no interval]");
export function report(a: Analysis): string[] {
  const out = ["rates (catch rate, Wilson 95%):"];
  for (const r of a.rates) out.push("  " + r.model + " " + r.arm + ": " + r.k + "/" + r.n + " = " + pct(r.rate) + "% " + ci(r.ci95));
  const line = (name: string, c: ContrastOut) => {
    out.push("  " + name + ": " + (c.verdict ?? "descriptive") + "; delta " + pct(c.delta) + " points " + ci(c.ci95) + ", n " + c.n + " pairs over " + c.n_repos + " repositories, bootstrap p " + c.p.toFixed(4) + (c.p_holm !== null ? ", Holm p " + c.p_holm.toFixed(4) : "") + ", McNemar p " + c.mcnemar_p.toFixed(4) + ", worse " + c.worse + ", better " + c.better);
    for (const [k, v] of Object.entries(c.readings)) out.push("    " + k + ": delta " + pct(v.delta) + " " + ci(v.ci95) + " (n " + v.n + ")");
    for (const [code, by] of Object.entries(c.named_gaps)) out.push("    " + code + " gaps (" + NAMED_GAPS[code as keyof typeof NAMED_GAPS] + "): " + Object.entries(by).map(([m, arms]) => m + " " + Object.entries(arms).map(([arm, n]) => arm + " " + n).join(", ")).join("; "));
    out.push("    " + c.mdd);
  };
  out.push("pooled verdicts:");
  line("P minus N", a.pooled["P-N"]);
  line("P minus C", a.pooled["P-C"]);
  out.push("    process contrast reads as " + a.pooled["P-C"].process_reading);
  line("C minus N", a.pooled_c_n);
  for (const [m, cs] of Object.entries(a.per_model)) {
    out.push("per model " + m + " (per-model readings):");
    for (const [k, c] of Object.entries(cs)) line(k, c);
  }
  out.push("exposure: " + JSON.stringify(a.exposure));
  out.push("breaks (sessions measured, with a break, not measured): " + JSON.stringify(a.breaks));
  for (const [m, arms] of Object.entries(a.ceiling)) for (const [arm, c] of Object.entries(arms)) out.push("ceiling " + m + " " + arm + ": " + c.sessions + " sessions, " + c.entries + " entries, unreached " + c.unreached + " (" + pct(c.unreached_rate) + "%), timeout-only " + c.timeout_only + " (" + pct(c.timeout_only_share) + "%), sessions at the ceiling " + c.ceiling_hit);
  for (const [m, arms] of Object.entries(a.in_flight)) for (const [arm, c] of Object.entries(arms)) out.push("in flight " + m + " " + arm + ": " + c.sessions + " sessions; reservation-bound refusals " + c.reservation_bound + " (" + c.sessions_reservation_bound + " sessions); subagents asked " + c.subagents + ", refused at the cap " + c.subagent_cap_refused + " (" + c.sessions_cap_refused + " sessions)");
  out.push("units flagged by 5T + 8R >= " + CEILING_S + " s: " + (a.flagged_units.length ? a.flagged_units.map((f) => f.unit + " (T " + f.t_s + " s, R " + Math.round(f.r_s!) + " s)").join(", ") : "none"));
  for (const c of a.incomplete) out.push("E_PF_CELL_INCOMPLETE " + c.model + " " + c.arm + ": " + c.gaps + " gaps on " + c.units + " units");
  return out;
}
