// Copyright (c) 2026 Garry Tan. MIT License.
// SR's analysis (plan section 10). A session's score is pstack-checks' catch (pfchecks/score.ts: a check the agent left
// fails 3 of 3 on the change under review, passes 3 of 3 with the fix, and fails 3 of 3 after a harmless edit); a cell
// (unit, model, arm) scores the mean over its sessions with a harness gap left out. Contrasts are paired by unit and
// model, b minus a, with pstack-checks' bootstrap over repositories stratified by model (10,000 resamples,
// bootstrap_seed). G is shipped gstack, derived per unit: G+'s cell where gstack's detector fires on the change under
// review, G0's elsewhere. The primary contrast is G+ minus G0 pooled over the two models; every other is secondary or
// descriptive. Readings beside it: gaps as misses, arm refusals as misses, changes of more than 10 changed lines only, and
// the units where the detector fires and where it does not. Exposure and false alarms print per arm and model.
import { bootstrap, wilson, type Pair, type Verdict } from "../pfchecks/analysis.ts";
import type { SrArm } from "./arms.ts";
import type { SrExposure } from "./exposure.ts";

export type CellArm = SrArm | "G";
export interface SrSession { unit: string; repo: string; model: string; arm: SrArm; score: 0 | 1 | null; gap: string | null; exposure: SrExposure | null; false_alarms: number; checks: number; cap_stop?: boolean }
export interface UnitFacts { id: string; repo: string; detected: boolean; pr_lines: number }
export const SMALL_PR = 10;
export const READINGS = ["primary", "gaps_as_miss", "arm_refusal_as_miss", "no_small_pr", "detector_fires", "detector_silent"] as const;
export type Reading = (typeof READINGS)[number];
export const CONTRASTS: Array<{ a: CellArm; b: CellArm; role: "primary" | "secondary" | "descriptive" }> = [
  { a: "G0", b: "G+", role: "primary" }, { a: "N", b: "G", role: "secondary" }, { a: "G+", b: "C", role: "secondary" }, { a: "G+", b: "P", role: "secondary" },
  { a: "N", b: "G+", role: "descriptive" }, { a: "N", b: "G0", role: "descriptive" }, { a: "N", b: "C", role: "descriptive" }, { a: "N", b: "P", role: "descriptive" },
];
/** R113's one look at half the counted units (rounded up): the primary contrast stops the run when its bootstrap p is
 *  under 0.003 either way; the final test is then at 0.049. */
export const LOOK = { stop_p: 0.003, final_p: 0.049 } as const;

/** The gain the Decision section asks of a HELPS before it widens the specialist: 10 points. */
export const WIDEN_DELTA = 0.1;

/** Whether every planned session of a part has a record: reps sessions for each (unit, model, arm), none a cap stop. */
export function complete(sessions: readonly SrSession[], units: readonly string[], reps: number, models: readonly string[], arms: readonly SrArm[] = ["N", "C", "P", "G+", "G0"]): boolean {
  if (sessions.some((s) => s.cap_stop)) return false;
  return units.every((u) => models.every((m) => arms.every((arm) => sessions.filter((s) => s.unit === u && s.model === m && s.arm === arm).length >= reps)));
}

/** pstack-checks' verdict rule at level alpha: the interval clear of 0 and the bootstrap p under alpha. */
export function verdictAt(ci: [number, number] | null, p: number, alpha: number, incomplete: boolean): Verdict {
  if (incomplete) return "INCOMPLETE";
  if (ci && ci[0] > 0 && p < alpha) return "HELPS";
  if (ci && ci[1] < 0 && p < alpha) return "HURTS";
  return "NO MEASURABLE DIFFERENCE";
}

const sessionValue = (s: SrSession, k: Reading): number | null => (k === "gaps_as_miss" ? s.score ?? 0 : k === "arm_refusal_as_miss" ? s.score ?? (s.gap === "E_PF_ARM" ? 0 : null) : s.score);

/** Each cell's mean under a reading, with G derived per unit. */
export function cells(sessions: readonly SrSession[], units: ReadonlyMap<string, UnitFacts>, k: Reading): Map<string, { unit: string; repo: string; model: string; arm: CellArm; value: number }> {
  const sum = new Map<string, { unit: string; repo: string; model: string; arm: CellArm; s: number; n: number }>();
  for (const s of sessions) {
    const f = units.get(s.unit);
    if (!f) continue;
    if (k === "no_small_pr" && f.pr_lines <= SMALL_PR) continue;
    if (k === "detector_fires" && !f.detected) continue;
    if (k === "detector_silent" && f.detected) continue;
    const v = sessionValue(s, k);
    if (v === null) continue;
    const arms: CellArm[] = [s.arm, ...((s.arm === "G+" && f.detected) || (s.arm === "G0" && !f.detected) ? (["G"] as const) : [])];
    for (const arm of arms) {
      const key = s.unit + "|" + s.model + "|" + arm;
      const c = sum.get(key) ?? { unit: s.unit, repo: s.repo, model: s.model, arm, s: 0, n: 0 };
      c.s += v;
      c.n++;
      sum.set(key, c);
    }
  }
  return new Map([...sum].map(([key, c]) => [key, { unit: c.unit, repo: c.repo, model: c.model, arm: c.arm, value: c.s / c.n }]));
}

export function pairs(c: ReturnType<typeof cells>, a: CellArm, b: CellArm, models?: readonly string[]): Pair[] {
  const out: Pair[] = [];
  for (const x of c.values()) {
    if (x.arm !== b || (models && !models.includes(x.model))) continue;
    const y = c.get(x.unit + "|" + x.model + "|" + a);
    if (y) out.push({ unit: x.unit, repo: x.repo, model: x.model, a: y.value, b: x.value });
  }
  return out.sort((p, q) => (p.model + p.unit < q.model + q.unit ? -1 : 1));
}

export interface SrContrast { a: CellArm; b: CellArm; role: string; models: string; n: number; n_repos: number; delta: number; ci95: [number, number] | null; p: number; verdict: Verdict | null; readings: Record<string, { n: number; delta: number; ci95: [number, number] | null; p: number }> }
export interface SrAnalysis {
  schema: "sr-analysis.v1"; units: number; sessions: number; gaps: Record<string, number>;
  rates: Array<{ model: string; arm: SrArm; k: number; n: number; rate: number | null; ci95: [number, number] }>;
  contrasts: SrContrast[]; exposure: Array<{ model: string; arm: SrArm; sessions: number; army: number; ran: number }>;
  false_alarms: Array<{ model: string; arm: SrArm; sessions: number; checks: number; false_alarms: number }>;
  decision: "WIDEN" | "KEEP" | "CUT" | "NULL" | "INCOMPLETE"; look?: { units: number; p: number; stop: boolean };
}

export function analyse(sessions: readonly SrSession[], units: readonly UnitFacts[], seed: number, models: readonly string[], incomplete = false): SrAnalysis {
  const facts = new Map(units.map((u) => [u.id, u]));
  const by = <T>(f: (model: string, arm: SrArm, ss: SrSession[]) => T) => models.flatMap((m) => (["N", "C", "P", "G+", "G0"] as SrArm[]).map((arm) => f(m, arm, sessions.filter((s) => s.model === m && s.arm === arm))));
  const contrasts: SrContrast[] = [];
  for (const c of CONTRASTS) {
    for (const ms of [models, ...models.map((m) => [m])]) {
      const p = pairs(cells(sessions, facts, "primary"), c.a, c.b, ms);
      const bs = bootstrap(p, seed);
      const readings: SrContrast["readings"] = {};
      for (const k of READINGS.slice(1)) {
        const pk = pairs(cells(sessions, facts, k), c.a, c.b, ms);
        const x = bootstrap(pk, seed);
        readings[k] = { n: pk.length, delta: x.delta, ci95: x.ci95, p: x.p };
      }
      contrasts.push({ a: c.a, b: c.b, role: c.role, models: ms.join("+"), n: p.length, n_repos: new Set(p.map((x) => x.repo)).size, delta: bs.delta, ci95: bs.ci95, p: bs.p, verdict: c.role === "descriptive" ? null : verdictAt(bs.ci95, bs.p, c.role === "primary" ? LOOK.final_p : 0.05, incomplete), readings });
    }
  }
  const primary = contrasts[0]!;
  const gaps: Record<string, number> = {};
  for (const s of sessions) if (s.gap) gaps[s.gap] = (gaps[s.gap] ?? 0) + 1;
  return {
    schema: "sr-analysis.v1", units: new Set(sessions.map((s) => s.unit)).size, sessions: sessions.length, gaps,
    rates: by((model, arm, ss) => { const sc = ss.filter((s) => s.score !== null); const k = sc.filter((s) => s.score === 1).length; return { model, arm, k, n: sc.length, rate: sc.length ? k / sc.length : null, ci95: wilson(k, sc.length) }; }),
    contrasts,
    exposure: by((model, arm, ss) => ({ model, arm, sessions: ss.length, army: ss.filter((s) => s.exposure?.army).length, ran: ss.filter((s) => s.exposure?.ran).length })),
    false_alarms: by((model, arm, ss) => ({ model, arm, sessions: ss.length, checks: ss.reduce((a, s) => a + s.checks, 0), false_alarms: ss.reduce((a, s) => a + s.false_alarms, 0) })),
    decision: primary.verdict === "HELPS" ? (primary.delta >= WIDEN_DELTA ? "WIDEN" : "KEEP") : primary.verdict === "HURTS" ? "CUT" : primary.verdict === "INCOMPLETE" ? "INCOMPLETE" : "NULL",
  };
}

/** The one look: the primary contrast on the first half (rounded up) of the counted units in plan order, read only once
 *  every one of those units has all reps of its G+ and G0 sessions on every model. A unit not yet done is never replaced
 *  by a later one. */
export function look(sessions: readonly SrSession[], units: readonly UnitFacts[], order: readonly string[], reps: number, seed: number, models: readonly string[]): { units: number; done: number; p: number | null; delta: number | null; stop: boolean } {
  const facts = new Map(units.map((u) => [u.id, u]));
  const half = order.slice(0, Math.ceil(order.length / 2));
  const done = half.filter((id) => facts.has(id) && complete(sessions.filter((s) => s.unit === id), [id], reps, models, ["G+", "G0"]));
  if (done.length < half.length) return { units: half.length, done: done.length, p: null, delta: null, stop: false };
  const ss = sessions.filter((s) => half.includes(s.unit));
  const bs = bootstrap(pairs(cells(ss, facts, "primary"), "G0", "G+", models), seed);
  return { units: half.length, done: done.length, p: bs.p, delta: bs.delta, stop: bs.p < LOOK.stop_p };
}
