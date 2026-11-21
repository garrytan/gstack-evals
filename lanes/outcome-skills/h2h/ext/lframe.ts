// Copyright (c) 2026 Garry Tan. MIT License.
// Part L's frame, order and walk (post section 5). Three pools of fresh units, none of them among the head-to-head's 100
// counted O units:
//   1. the MultiLang units that passed every gate in the head-to-head's O walk and never ran: its 10 reserves (positions
//      112 to 119, 121 and 122) and the 8 units that passed after stage 0's bug unit (position 123) and before its feature
//      unit (position 132), which are bug units by the walk's own rule;
//   2. the MultiLang rows that walk skipped only for its repository cap of 3;
//   3. the pinned SWE-rebench pool's tasks created 2026-03 to 2026-05.
// The head-to-head's walk records (its draw and gate files) died with its runner, so pools 1 and 2 are rebuilt from what
// survives: o-order.json, o-frame.json, the published units' positions, the stage 1 and stage 0 units and the reserves a
// surviving record names. Pool 2 replays the cap rule over the walk's drawn units and must give the walk's recorded count;
// any drawn unit the records lack can only add capped rows, so a replay that matches the count is exact. Pool 1 is whatever
// the records name; the rest of it is listed as missing with the order windows it sits in, never guessed. A frame with a
// pool short of its count is incomplete, and its order is provisional (readLOrder refuses it for a walk).
// The order: base draw.ts seededOrder over the union with the extension's draw_seed (months newest first, ids sorted, then
// shuffled within a month by one seededRandom stream). The walk counts positions over units that pass every gate, holds at
// most 3 units a repository (pilot, counted and reserve units alike), puts the first 4 usable units of pools 1 and 2 and the
// first 2 of pool 3 in the pilot, then takes 100 counted units and 5 reserves from the rest. Short of that, the counted
// units are what is left after the pilot and 5 reserves, and under 60 is underpowered.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { seededOrder, type DrawUnit, type Gate } from "../ordinary/draw.ts";
import { h2hFail } from "../prereg.ts";
import type { Entry } from "../types.ts";
import { EXT_PREREG_PATH, readExtPrereg, type ExtPrereg } from "./prereg.ts";

export const L_FRAME_SCHEMA = "h2hx-l-frame.v1";
export const L_ORDER_SCHEMA = "h2hx-l-order.v1";
export const L_FRAME_PATH = join(EXT_PREREG_PATH, "..", "l-frame.json");
export const L_ORDER_PATH = join(EXT_PREREG_PATH, "..", "l-order.json");
export type Pool = 1 | 2 | 3;

export interface LUnit { id: string; pool: Pool; repo: string; month: string; language: string; entry: Entry | null; licence: string | null; source: string; reused?: { verdict: string; from: string } }
export interface Window { from_index: number; to_index: number; positions: number[]; role: "reserve" | "passed_unassigned"; need: number; candidates: string[] }
export interface PoolStatus { expected: number; recovered: number; complete: boolean; how: string; missing?: Window[] }
export interface LFrame { schema: typeof L_FRAME_SCHEMA; draw_seed: number; sources: Record<string, string>; pools: Record<Pool, PoolStatus>; complete: boolean; units: LUnit[] }
export interface LOrder { schema: typeof L_ORDER_SCHEMA; draw_seed: number; frame_sha256: string; complete: boolean; months: string[]; order: string[] }

const fail = (code: "E_H2HX_UNITS_INPUT" | "E_H2HX_UNITS_POOL", why: string): never => h2hFail(code, why);
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** The rows a walk over order skips for the repository cap: a row whose repository already holds cap drawn units earlier
 *  in the order, up to and including endId (the walk's last drawn unit). Passed-but-unassigned units never count. */
export function cappedRows(order: readonly string[], repoOf: (id: string) => string, drawn: ReadonlySet<string>, cap: number, endId: string): string[] {
  const end = order.indexOf(endId);
  if (end < 0) fail("E_H2HX_UNITS_INPUT", endId + " is not in the order");
  const held = new Map<string, number>();
  const out: string[] = [];
  for (const id of order.slice(0, end + 1)) {
    const r = repoOf(id);
    if ((held.get(r) ?? 0) >= cap) out.push(id);
    else if (drawn.has(id)) held.set(r, (held.get(r) ?? 0) + 1);
  }
  return out;
}

export interface BaseWalkRecords {
  order: readonly string[];
  frame: ReadonlyMap<string, { repo: string; entry: Entry }>;
  /** Units the records place, with their draw positions: stage 2 (published), stage 1 (frozen positions) and stage 0. */
  placed: ReadonlyMap<string, number>;
  /** Reserves a surviving record names (no position needed: their order index places them). */
  reserves: readonly string[];
  /** Rows a surviving verdict record drops. */
  drops: ReadonlySet<string>;
  usable: number; reservePositions: readonly number[]; passedPositions: readonly number[]; cap: number; capped: number;
}

/** Pools 1 and 2 from the base walk's surviving records. Pool 2 refuses (E_H2HX_UNITS_INPUT) unless the cap replay gives
 *  the recorded count. Pool 1's missing units are listed by window: the order rows between two placed units that hold
 *  the missing positions, each with its candidates (rows not placed, not capped, not dropped by a record, and for the
 *  passed-unassigned positions bug rows only). */
export function basePools(r: BaseWalkRecords): { pool1: string[]; pool1Missing: Window[]; pool2: string[] } {
  const at = new Map(r.order.map((id, i) => [id, i]));
  for (const id of [...r.placed.keys(), ...r.reserves]) if (!at.has(id) || !r.frame.has(id)) fail("E_H2HX_UNITS_INPUT", id + " is not in the frozen order and frame");
  const known = [...r.placed.entries()].sort((a, b) => a[1] - b[1]);
  for (let i = 1; i < known.length; i++) if (at.get(known[i]![0])! <= at.get(known[i - 1]![0])!) fail("E_H2HX_UNITS_INPUT", known[i]![0] + " at position " + known[i]![1] + " does not follow " + known[i - 1]![0] + " in the order");
  const last = known[known.length - 1]!;
  if (last[1] !== r.usable) fail("E_H2HX_UNITS_INPUT", "the last placed unit is at position " + last[1] + ", not the walk's " + r.usable + " usable");
  const drawn = new Set([...r.placed.keys(), ...r.reserves]);
  const repoOf = (id: string) => r.frame.get(id)!.repo;
  const pool2 = cappedRows(r.order, repoOf, drawn, r.cap, last[0]);
  if (pool2.length !== r.capped) fail("E_H2HX_UNITS_INPUT", "the cap replay gives " + pool2.length + " capped rows, not the walk's recorded " + r.capped);
  const capped = new Set(pool2);
  const windows: Window[] = [];
  let prev: [string, number] = ["", 0];
  let namedIn = 0;
  for (const k of known) {
    const gap = Array.from({ length: k[1] - prev[1] - 1 }, (_, i) => prev[1] + 1 + i);
    if (gap.length) {
      const from = prev[0] ? at.get(prev[0])! + 1 : 0, to = at.get(k[0])! - 1;
      const res = gap.filter((p) => r.reservePositions.includes(p)), pas = gap.filter((p) => r.passedPositions.includes(p));
      if (res.length + pas.length !== gap.length) fail("E_H2HX_UNITS_INPUT", "positions " + gap.join(",") + " are neither placed nor reserve or passed positions");
      const rows = r.order.slice(from, to + 1);
      const named = rows.filter((id) => r.reserves.includes(id));
      if (named.length > res.length) fail("E_H2HX_UNITS_INPUT", "the window before " + k[0] + " holds " + named.length + " named reserves for " + res.length + " reserve positions");
      namedIn += named.length;
      const open = rows.filter((id) => !drawn.has(id) && !capped.has(id) && !r.drops.has(id));
      if (res.length > named.length) windows.push({ from_index: from, to_index: to, positions: res, role: "reserve", need: res.length - named.length, candidates: open });
      if (pas.length) windows.push({ from_index: from, to_index: to, positions: pas, role: "passed_unassigned", need: pas.length, candidates: open.filter((id) => r.frame.get(id)!.entry === "bug") });
    }
    prev = k;
  }
  if (namedIn !== r.reserves.length) fail("E_H2HX_UNITS_INPUT", (r.reserves.length - namedIn) + " named reserves sit where the placed units leave no reserve position");
  return { pool1: [...r.reserves], pool1Missing: windows, pool2 };
}

/** The frame from the three pools, in id order, with each pool's status. */
export function lFrameFrom(o: { x?: ExtPrereg; units: LUnit[]; pools: Record<Pool, PoolStatus>; sources: Record<string, string> }): LFrame {
  const x = o.x ?? readExtPrereg();
  const ids = new Set<string>();
  for (const u of o.units) {
    if (ids.has(u.id)) fail("E_H2HX_UNITS_INPUT", u.id + " is in two pools");
    ids.add(u.id);
    if (!u.repo || !/^\d{4}-\d{2}$/.test(u.month)) fail("E_H2HX_UNITS_INPUT", u.id + " has no repository or YYYY-MM month");
  }
  for (const p of [1, 2, 3] as Pool[]) {
    const n = o.units.filter((u) => u.pool === p).length;
    if (n !== o.pools[p].recovered) fail("E_H2HX_UNITS_INPUT", "pool " + p + " lists " + n + " units, not its status's " + o.pools[p].recovered);
  }
  return { schema: L_FRAME_SCHEMA, draw_seed: x.draw_seed, sources: o.sources, pools: o.pools, complete: Object.values(o.pools).every((s) => s.complete), units: [...o.units].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
}

/** The seeded order over the frame's union, as l-order.json holds it. frameText is the frame file's bytes. */
export function lOrder(frame: LFrame, frameText: string): LOrder {
  const order = seededOrder(frame.units.map((u): DrawUnit => ({ id: u.id, repo: u.repo, month: u.month })), frame.draw_seed);
  return { schema: L_ORDER_SCHEMA, draw_seed: frame.draw_seed, frame_sha256: sha(frameText), complete: frame.complete, months: [...new Set(order.map((u) => u.month))], order: order.map((u) => u.id) };
}

export function readLFrame(path: string = L_FRAME_PATH): LFrame {
  if (!existsSync(path)) fail("E_H2HX_UNITS_INPUT", path + " does not exist");
  const j = JSON.parse(readFileSync(path, "utf8")) as LFrame;
  if (j.schema !== L_FRAME_SCHEMA || !Array.isArray(j.units)) fail("E_H2HX_UNITS_INPUT", path + " is not an " + L_FRAME_SCHEMA + " file");
  return j;
}

/** The frame and its order for a walk: refused (E_H2HX_UNITS_POOL) while a pool is incomplete, or when the order is not
 *  the frame's seeded order. */
export function readLOrder(framePath: string = L_FRAME_PATH, orderPath: string = L_ORDER_PATH): { frame: LFrame; order: LOrder } {
  const frame = readLFrame(framePath);
  const order = JSON.parse(readFileSync(orderPath, "utf8")) as LOrder;
  const want = lOrder(frame, readFileSync(framePath, "utf8"));
  if (order.schema !== L_ORDER_SCHEMA || order.frame_sha256 !== want.frame_sha256 || order.order.join(",") !== want.order.join(",")) fail("E_H2HX_UNITS_INPUT", orderPath + " is not the seeded order of " + framePath);
  if (!frame.complete) fail("E_H2HX_UNITS_POOL", "part L's frame is incomplete (" + Object.entries(frame.pools).filter(([, s]) => !s.complete).map(([p, s]) => "pool " + p + ": " + s.recovered + " of " + s.expected).join("; ") + "), so its order is provisional and no walk may use it");
  return { frame, order };
}

export type LRole = "pilot" | "counted" | "reserve";
export interface LDrawn { id: string; pool: Pool; repo: string; month: string; walk_position: number; role: LRole; position: number }
export interface LPlan { pilot12: number; pilot3: number; n: number; reserve: number; repoCap: number; minCounted: number }
export interface LWalk {
  schema: "h2hx-l-walk.v1"; draw_seed: number; plan: LPlan; usable: number; units: LDrawn[]; passed_unassigned: string[];
  drops: { id: string; gate: string; code: string; reason: string }[]; capped: string[];
  pending: { id: string; gate: string; why: string } | null; short: boolean; counted: number; underpowered: boolean;
}

/** The plan from prereg.json parts.L.units: 6 pilot units (4 from pools 1 and 2, 2 from pool 3), n counted, the reserves. */
export function lPlan(x: ExtPrereg = readExtPrereg()): LPlan {
  const u = x.parts.L.units;
  if (u.pilot !== 6) fail("E_H2HX_UNITS_INPUT", "part L's pilot is " + u.pilot + " units; the stratified rule splits 6 as 4 and 2");
  return { pilot12: 4, pilot3: 2, n: u.n, reserve: u.reserve, repoCap: u.repo_cap, minCounted: u.min_counted };
}

/** The walk over the seeded order (frame units in l-order.json's order). A pending gate stops it; positions count only
 *  units that pass every gate; a repository already holding repoCap drawn units is skipped unasked. When the order runs
 *  out first, the rest is split so the reserves keep the last positions. */
export function walkL(order: readonly LUnit[], gates: readonly Gate[], plan: LPlan, seed: number): LWalk {
  const w: LWalk = { schema: "h2hx-l-walk.v1", draw_seed: seed, plan, usable: 0, units: [], passed_unassigned: [], drops: [], capped: [], pending: null, short: false, counted: 0, underpowered: false };
  const held = new Map<string, number>();
  let p12 = 0, p3 = 0;
  const rest: LDrawn[] = [];
  const full = () => p12 === plan.pilot12 && p3 === plan.pilot3 && rest.length === plan.n + plan.reserve;
  for (const u of order) {
    if (full()) break;
    if ((held.get(u.repo) ?? 0) >= plan.repoCap) {
      w.capped.push(u.id);
      continue;
    }
    let dropped = false;
    for (const g of gates) {
      const r = g.check(u.id);
      if ("pending" in r) {
        w.pending = { id: u.id, gate: g.name, why: r.why };
        break;
      }
      if (!r.ok) {
        w.drops.push({ id: u.id, gate: g.name, code: r.code, reason: r.reason });
        dropped = true;
        break;
      }
    }
    if (w.pending) break;
    if (dropped) continue;
    const k = ++w.usable;
    const d: LDrawn = { id: u.id, pool: u.pool, repo: u.repo, month: u.month, walk_position: k, role: "pilot", position: 0 };
    if (u.pool !== 3 && p12 < plan.pilot12) d.position = ++p12;
    else if (u.pool === 3 && p3 < plan.pilot3) d.position = plan.pilot12 + ++p3;
    else if (rest.length < plan.n + plan.reserve) {
      d.role = rest.length < plan.n ? "counted" : "reserve";
      d.position = rest.length + 1;
      rest.push(d);
    } else {
      w.passed_unassigned.push(u.id);
      continue;
    }
    held.set(u.repo, (held.get(u.repo) ?? 0) + 1);
    w.units.push(d);
  }
  if (w.pending) return w;
  w.short = !full();
  const nCounted = w.short ? Math.max(0, Math.min(plan.n, rest.length - plan.reserve)) : plan.n;
  rest.forEach((d, i) => (d.role = i < nCounted ? "counted" : "reserve"));
  w.counted = nCounted;
  w.underpowered = nCounted < plan.minCounted;
  return w;
}
