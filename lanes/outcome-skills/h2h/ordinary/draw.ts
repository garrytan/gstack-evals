// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head's draw (plan sections 5 and 6), one module for the O frame and both B frames. The seeded order: months
// newest first, each month's ids sorted and then shuffled by one seededRandom(draw_seed) stream (src/runner/stats/
// paired.ts), months taking the stream in walk order, as pfchecks/draw.ts does; each frame starts its own stream. The gate
// walk asks each unit's gates in that order; a unit whose repository already holds 3 drawn units in the class is skipped
// unasked, and positions count only units that pass every gate. Stage 1 takes prereg.json's positions; stage 2 takes the
// other positions in order up to n; the reserves follow; stage 0 takes, for O, the first bug unit and the first feature
// unit after the reserves and, for B1 and B2, the first unit after them. A gate whose input is not there yet stops the
// walk and names the unit (E_H2H_DRAW_PENDING); a frame that runs out first is short (E_H2H_DRAW_SHORT).
import { seededRandom } from "../../../../src/runner/stats/paired.ts";
import { h2hFail, type H2hPrereg } from "../prereg.ts";
import type { Entry, Stage, UnitKind } from "../types.ts";

export interface DrawUnit { id: string; repo: string; month: string; entry?: Entry }
export type GateResult = { ok: true } | { ok: false; code: string; reason: string } | { pending: true; why: string };
export interface Gate { name: string; check: (id: string) => GateResult }
export interface Plan { stage1: number[]; n: number; reserve: number; stage0: "bug_and_feature" | "first" }
export type Role = Stage | "reserve";
export interface Drawn { id: string; repo: string; month: string; entry?: Entry; position: number; stage: Role; replaces?: string }
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

/** The class's plan from prereg.json. B1 and B2 take n from the caller (drawB splits B's n between them). */
export function planFor(p: H2hPrereg, kind: UnitKind, n?: number): Plan {
  if (kind === "O") {
    const o = p.classes.O as H2hPrereg["classes"]["O"] & { stage1_positions?: unknown };
    return { stage1: positions(o.stage1_positions, "classes.O.stage1_positions"), n: n ?? o.n, reserve: o.reserve, stage0: "bug_and_feature" };
  }
  const b = p.classes.B as H2hPrereg["classes"]["B"] & { stage1_positions?: unknown };
  if (n === undefined || !Number.isInteger(n) || n < 0) h2hFail("E_H2H_DRAW_INPUT", kind + " needs its share of B's n");
  return { stage1: positions(b.stage1_positions, "classes.B.stage1_positions"), n: n!, reserve: b.reserve, stage0: "first" };
}

/** The gate walk over a seeded order. capCounts carries drawn units per repository from an earlier frame of the same
 *  class (B2 after B1) and is updated in place. */
export function walk(kind: UnitKind, seed: number, order: readonly DrawUnit[], gates: readonly Gate[], plan: Plan, repoCap: number, capCounts: Map<string, number> = new Map()): Walk {
  const w: Walk = { schema: "h2h-draw.v1", kind, draw_seed: seed, plan, usable: 0, units: [], passed_unassigned: [], drops: [], capped: [], pending: null, short: null };
  const s1 = new Set(plan.stage1);
  const need = { stage1: plan.stage1.length, stage2: plan.n, reserve: plan.reserve, stage0: plan.stage0 === "bug_and_feature" ? 2 : 1 };
  const got = { stage1: 0, stage2: 0, reserve: 0, stage0: 0 };
  const stage0Entries = new Set<Entry>();
  const done = () => got.stage1 === need.stage1 && got.stage2 === need.stage2 && got.reserve === need.reserve && got.stage0 === need.stage0;
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
  if (!done()) w.short = { ...got };
  return w;
}

export interface BDraw { b1: Walk; b2: Walk | null; b1_feasible: boolean | null; n_b1: number; n_b2: number }

/** B's two frames: B1 first, up to half of B's n; if the B1 frame runs out, its stage 2 share shrinks so the reserves
 *  and stage 0 still fill, and under b1_min_units usable units B1 is infeasible and B is B2 alone. B2 takes the rest of
 *  n, and the repository cap counts across both frames. */
export function drawB(p: H2hPrereg, seed: number, b1Order: readonly DrawUnit[], b2Order: readonly DrawUnit[], g1: readonly Gate[], g2: readonly Gate[], n: number = p.classes.B.n): BDraw {
  const b = p.classes.B;
  let n1 = Math.floor(n * b.b1_share_max);
  let w1 = walk("B1", seed, b1Order, g1, planFor(p, "B1", n1), b.repo_cap);
  for (let i = 0; i < 5 && w1.short && !w1.pending; i++) {
    const s1 = w1.plan.stage1.filter((x) => x <= w1.usable).length;
    const next = Math.max(0, Math.min(n1, w1.usable - s1 - b.reserve - 1));
    if (next === n1) break;
    n1 = next;
    w1 = walk("B1", seed, b1Order, g1, planFor(p, "B1", n1), b.repo_cap);
  }
  if (w1.pending) return { b1: w1, b2: null, b1_feasible: null, n_b1: n1, n_b2: n - n1 };
  const feasible = w1.usable >= b.b1_min_units;
  const caps = new Map<string, number>();
  if (feasible) for (const u of w1.units) caps.set(u.repo, (caps.get(u.repo) ?? 0) + 1);
  else n1 = 0;
  const w2 = walk("B2", seed, b2Order, g2, planFor(p, "B2", n - n1), b.repo_cap, caps);
  return { b1: w1, b2: w2, b1_feasible: feasible, n_b1: n1, n_b2: n - n1 };
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
