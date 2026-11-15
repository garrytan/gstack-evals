// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head's draw (plan sections 5 and 6), one module for the O frame and both B frames. The seeded order: months
// newest first, each month's ids sorted and then shuffled by one seededRandom(draw_seed) stream (src/runner/stats/
// paired.ts), months taking the stream in walk order, as pfchecks/draw.ts does; each frame starts its own stream. The gate
// walk asks each unit's gates in that order; a unit whose repository already holds 3 drawn units in the class is skipped
// unasked, and positions count only units that pass every gate. Stage 1 takes prereg.json's positions; stage 2 takes the
// other positions in order up to n; the reserves follow; stage 0 takes, for O, the first bug unit and the first feature
// unit after the reserves and, for B2, the first unit after them. B1's frame is small, so its walk runs to the end of the
// frame first; with N usable units, stage 1 takes positions Math.round(k * N / 7) for k = 1 to 6, stage 0 takes position
// N, the reserves are the last unused positions before N, and stage 2 takes the rest in order, up to half of B's n. A
// gate whose input is not there yet stops the walk and names the unit (E_H2H_DRAW_PENDING); a frame that runs out first is
// short (E_H2H_DRAW_SHORT). The full-size option adds units at the next usable positions after stage 0's units.
import { seededRandom } from "../../../../src/runner/stats/paired.ts";
import { h2hFail, type H2hPrereg } from "../prereg.ts";
import type { Entry, Stage, UnitKind } from "../types.ts";

export interface DrawUnit { id: string; repo: string; month: string; entry?: Entry }
export type GateResult = { ok: true } | { ok: false; code: string; reason: string } | { pending: true; why: string };
export interface Gate { name: string; check: (id: string) => GateResult }
/** extra: the full-size option's added units, taken at the next usable positions after stage 0's. */
export interface Plan { stage1: number[]; n: number; reserve: number; stage0: "bug_and_feature" | "first" | "last"; extra?: number }
export type Role = Stage | "reserve";
export interface Drawn { id: string; repo: string; month: string; entry?: Entry; position: number; stage: Role; replaces?: string; full_size?: true }
export interface Walk {
  schema: "h2h-draw.v1"; kind: UnitKind; draw_seed: number; plan: Plan; usable: number;
  units: Drawn[]; passed_unassigned: string[]; drops: { id: string; gate: string; code: string; reason: string }[]; capped: string[];
  pending: { id: string; gate: string; why: string } | null; short: { stage1: number; stage2: number; reserve: number; stage0: number } | null;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** One seeded order over a frame: months newest first, ids sorted then shuffled within each month by one stream. */
export function seededOrder<T extends DrawUnit>(units: readonly T[], seed: number): T[] {
  if (new Set(units.map((u) => u.id)).size !== units.length) h2hFail("E_H2H_DRAW_INPUT", "the frame repeats an id");
  for (const u of units) if (!u.id || !u.repo || !/^\d{4}-\d{2}$/.test(u.month)) h2hFail("E_H2H_DRAW_INPUT", "unit " + JSON.stringify(u.id) + " has no id, repository or YYYY-MM month");
  const rnd = seededRandom(seed);
  const months = [...new Set(units.map((u) => u.month))].sort().reverse();
  const out: T[] = [];
  for (const m of months) {
    const g = units.filter((u) => u.month === m).sort(byId);
    for (let i = g.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [g[i], g[j]] = [g[j]!, g[i]!];
    }
    out.push(...g);
  }
  return out;
}

const positions = (v: unknown, what: string): number[] => {
  if (!Array.isArray(v) || !v.length || !v.every((x, i) => Number.isInteger(x) && x >= 1 && (i === 0 || x > v[i - 1]))) h2hFail("E_H2H_PREREG", "prereg.json has no increasing positive " + what);
  return v as number[];
};

/** The plan of O or B2 from prereg.json. B2 takes n from the caller (drawB gives it what B1 leaves). extra is the
 *  full-size option's added units. B1's positions depend on its usable count (b1Positions). */
export function planFor(p: H2hPrereg, kind: UnitKind, n?: number, extra = 0): Plan {
  if (!Number.isInteger(extra) || extra < 0) h2hFail("E_H2H_DRAW_INPUT", "the full-size option's added units must be a whole number");
  if (kind === "O") {
    const o = p.classes.O as H2hPrereg["classes"]["O"] & { stage1_positions?: unknown };
    return { stage1: positions(o.stage1_positions, "classes.O.stage1_positions"), n: n ?? o.n, reserve: o.reserve, stage0: "bug_and_feature", extra };
  }
  if (kind === "B1") return h2hFail("E_H2H_DRAW_INPUT", "B1's positions come from its usable count; draw it with walkB1");
  const b = p.classes.B as H2hPrereg["classes"]["B"] & { stage1_positions?: { B2?: unknown } };
  if (n === undefined || !Number.isInteger(n) || n < 0) h2hFail("E_H2H_DRAW_INPUT", kind + " needs its share of B's n");
  return { stage1: positions(b.stage1_positions?.B2, "classes.B.stage1_positions.B2"), n: n!, reserve: b.reserve, stage0: "first", extra };
}

/** B1's positions over N usable units: stage 1 at Math.round(k * N / 7) for k = 1 to 6, stage 0 at N, the reserves at the
 *  last unused positions before N, stage 2 the rest in order up to nMax. */
export function b1Positions(N: number, nMax: number, reserve: number): { stage1: number[]; stage0: number[]; reserve: number[]; stage2: number[] } {
  const stage1 = [...new Set([1, 2, 3, 4, 5, 6].map((k) => Math.round((k * N) / 7)))].filter((x) => x >= 1 && x < N);
  const stage0 = N >= 1 ? [N] : [];
  const used = new Set([...stage1, ...stage0]);
  const free = Array.from({ length: Math.max(0, N - 1) }, (_, k) => k + 1).filter((x) => !used.has(x));
  const res = free.slice(Math.max(0, free.length - reserve));
  const stage2 = free.slice(0, Math.max(0, free.length - reserve)).slice(0, nMax);
  return { stage1, stage0, reserve: res, stage2 };
}

/** The gate walk over a seeded order. capCounts carries drawn units per repository from an earlier frame of the same
 *  class (B2 after B1) and is updated in place. */
export function walk(kind: UnitKind, seed: number, order: readonly DrawUnit[], gates: readonly Gate[], plan: Plan, repoCap: number, capCounts: Map<string, number> = new Map()): Walk {
  const w: Walk = { schema: "h2h-draw.v1", kind, draw_seed: seed, plan, usable: 0, units: [], passed_unassigned: [], drops: [], capped: [], pending: null, short: null };
  const s1 = new Set(plan.stage1);
  if (plan.stage0 === "last") h2hFail("E_H2H_DRAW_INPUT", "a plan with stage 0 at the last position is B1's; draw it with walkB1");
  const need = { stage1: plan.stage1.length, stage2: plan.n, reserve: plan.reserve, stage0: plan.stage0 === "bug_and_feature" ? 2 : 1, extra: plan.extra ?? 0 };
  const got = { stage1: 0, stage2: 0, reserve: 0, stage0: 0, extra: 0 };
  const stage0Entries = new Set<Entry>();
  const core = () => got.stage1 === need.stage1 && got.stage2 === need.stage2 && got.reserve === need.reserve && got.stage0 === need.stage0;
  const done = () => core() && got.extra === need.extra;
  for (const u of order) {
    if (done()) break;
    if ((capCounts.get(u.repo) ?? 0) >= repoCap) {
      w.capped.push(u.id);
      continue;
    }
    let dropped = false;
    for (const g of gates) {
      const r = g.check(u.id);
      if ("pending" in r) {
        w.pending = { id: u.id, gate: g.name, why: r.why };
        return w;
      }
      if (!r.ok) {
        w.drops.push({ id: u.id, gate: g.name, code: r.code, reason: r.reason });
        dropped = true;
        break;
      }
    }
    if (dropped) continue;
    const k = ++w.usable;
    let stage: Role | null = null;
    if (core()) {
      got.extra++;
      capCounts.set(u.repo, (capCounts.get(u.repo) ?? 0) + 1);
      w.units.push({ id: u.id, repo: u.repo, month: u.month, ...(u.entry ? { entry: u.entry } : {}), position: k, stage: "stage2", full_size: true });
      continue;
    }
    if (s1.has(k)) stage = "stage1";
    else if (got.stage2 < need.stage2) stage = "stage2";
    else if (got.reserve < need.reserve) stage = "reserve";
    else if (got.stage0 < need.stage0) {
      if (plan.stage0 === "first") stage = "stage0";
      else if (!u.entry) h2hFail("E_H2H_DRAW_INPUT", u.id + " has no bug or feature tag, which O's stage 0 needs");
      else if (!stage0Entries.has(u.entry)) {
        stage0Entries.add(u.entry);
        stage = "stage0";
      }
    }
    if (!stage) {
      w.passed_unassigned.push(u.id);
      continue;
    }
    got[stage === "stage1" ? "stage1" : stage === "stage2" ? "stage2" : stage === "reserve" ? "reserve" : "stage0"]++;
    capCounts.set(u.repo, (capCounts.get(u.repo) ?? 0) + 1);
    w.units.push({ id: u.id, repo: u.repo, month: u.month, ...(u.entry ? { entry: u.entry } : {}), position: k, stage });
  }
  if (!done()) w.short = { stage1: got.stage1, stage2: got.stage2, reserve: got.reserve, stage0: got.stage0, ...(need.extra ? { extra: got.extra } : {}) };
  return w;
}

/** B1's walk: every unit of the frame through the gates (a repository already holding repoCap usable units is skipped
 *  unasked), then b1Positions over the N usable units. */
export function walkB1(p: H2hPrereg, seed: number, order: readonly DrawUnit[], gates: readonly Gate[], nMax: number): Walk {
  const b = p.classes.B;
  const w: Walk = { schema: "h2h-draw.v1", kind: "B1", draw_seed: seed, plan: { stage1: [], n: nMax, reserve: b.reserve, stage0: "last" }, usable: 0, units: [], passed_unassigned: [], drops: [], capped: [], pending: null, short: null };
  const usable: DrawUnit[] = [];
  const held = new Map<string, number>();
  for (const u of order) {
    if ((held.get(u.repo) ?? 0) >= b.repo_cap) {
      w.capped.push(u.id);
      continue;
    }
    let dropped = false;
    for (const g of gates) {
      const r = g.check(u.id);
      if ("pending" in r) {
        w.pending = { id: u.id, gate: g.name, why: r.why };
        return w;
      }
      if (!r.ok) {
        w.drops.push({ id: u.id, gate: g.name, code: r.code, reason: r.reason });
        dropped = true;
        break;
      }
    }
    if (dropped) continue;
    usable.push(u);
    held.set(u.repo, (held.get(u.repo) ?? 0) + 1);
  }
  const N = (w.usable = usable.length);
  const pos = b1Positions(N, nMax, b.reserve);
  w.plan.stage1 = pos.stage1;
  const role = new Map<number, Role>([...pos.stage1.map((x) => [x, "stage1"] as const), ...pos.stage2.map((x) => [x, "stage2"] as const), ...pos.reserve.map((x) => [x, "reserve"] as const), ...pos.stage0.map((x) => [x, "stage0"] as const)]);
  usable.forEach((u, k) => {
    const stage = role.get(k + 1);
    if (stage) w.units.push({ id: u.id, repo: u.repo, month: u.month, ...(u.entry ? { entry: u.entry } : {}), position: k + 1, stage });
    else w.passed_unassigned.push(u.id);
  });
  return w;
}

/** b1_status: usable when B1's stage 2 gets at least b1_min_units units; fallbacks_due when it does not and the widened
 *  frame has not been drawn yet (B2 waits); infeasible when it still does not after the fallbacks, so B1 takes no stage
 *  and B is B2 alone. */
export type B1Status = "usable" | "fallbacks_due" | "infeasible";
export interface BDraw { b1: Walk; b2: Walk | null; b1_status: B1Status | null; b1_feasible: boolean | null; n_b1: number; n_b2: number; full_size: { n: number; b1_added: number; b2_added: number } | null }

/** B's two frames. B1 walks its whole frame first and fills up to half of B's n in stage 2; B2 takes the rest of n, and
 *  the repository cap counts B1's drawn units in B2. fallbacksDone says the B1 frame already holds the widening
 *  fallbacks. fullSize is an approved full B n: B1 has no positions after its stage 0 (position N), so B2 takes every
 *  added unit, after its own stage 0. */
export function drawB(p: H2hPrereg, seed: number, b1Order: readonly DrawUnit[], b2Order: readonly DrawUnit[], g1: readonly Gate[], g2: readonly Gate[], o: { n?: number; fallbacksDone?: boolean; fullSize?: number } = {}): BDraw {
  const b = p.classes.B;
  const n = o.n ?? b.n;
  if (o.fullSize !== undefined && !(Number.isInteger(o.fullSize) && o.fullSize >= n)) h2hFail("E_H2H_DRAW_INPUT", "the full B n must be a whole number at least the core n " + n);
  const extra = o.fullSize === undefined ? 0 : o.fullSize - n;
  const w1 = walkB1(p, seed, b1Order, g1, Math.floor(n * b.b1_share_max));
  const full = o.fullSize === undefined ? null : { n: o.fullSize, b1_added: 0, b2_added: extra };
  if (w1.pending) return { b1: w1, b2: null, b1_status: null, b1_feasible: null, n_b1: 0, n_b2: n, full_size: full };
  let n1 = w1.units.filter((u) => u.stage === "stage2").length;
  const status: B1Status = n1 >= b.b1_min_units ? "usable" : o.fallbacksDone ? "infeasible" : "fallbacks_due";
  if (status === "fallbacks_due") return { b1: w1, b2: null, b1_status: status, b1_feasible: null, n_b1: n1, n_b2: n - n1, full_size: full };
  if (status === "infeasible") {
    w1.passed_unassigned = [...w1.units.map((u) => u.id), ...w1.passed_unassigned];
    w1.units = [];
    n1 = 0;
  }
  const caps = new Map<string, number>();
  for (const u of w1.units) caps.set(u.repo, (caps.get(u.repo) ?? 0) + 1);
  const w2 = walk("B2", seed, b2Order, g2, planFor(p, "B2", n - n1, extra), b.repo_cap, caps);
  return { b1: w1, b2: w2, b1_status: status, b1_feasible: status === "usable", n_b1: n1, n_b2: n - n1, full_size: full };
}

/** Reserves replace units that drop after the draw and before any model run, in reserve order; O's stage 0 bug or feature
 *  unit takes the first reserve with its tag. A drop no reserve can replace is listed. */
export function replaceDropped(w: Walk, dropped: ReadonlySet<string>): { units: Drawn[]; unreplaced: string[] } {
  const units = w.units.map((u) => ({ ...u }));
  const free = units.filter((u) => u.stage === "reserve" && !dropped.has(u.id));
  const unreplaced: string[] = [];
  for (const u of units) {
    if (!dropped.has(u.id) || u.stage === "reserve") continue;
    const i = free.findIndex((r) => u.stage !== "stage0" || w.plan.stage0 === "first" || r.entry === u.entry);
    if (i < 0) {
      unreplaced.push(u.id);
      continue;
    }
    const r = free.splice(i, 1)[0]!;
    r.stage = u.stage;
    r.replaces = u.id;
  }
  return { units: units.filter((u) => !dropped.has(u.id)), unreplaced };
}
