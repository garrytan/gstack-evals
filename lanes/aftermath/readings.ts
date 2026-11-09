// Copyright (c) 2026 Garry Tan. MIT License.
// Frozen-reading cores the aftermath-keyed plan-review evals share (product-value, prereg 2026-11-08-geva-403; devex, prereg
// 2026-11-09-geva-417): the judge check's gold scoring (catch rate, false-fail rate, both kappas, the gold minimum and an
// eval's own oracle cap), power.txt's MDD table and the design MDD, and a month-stated training cutoff's last day. Each
// eval binds its own constants and error codes; these functions throw nothing and return null where a binding must refuse.
import { kappa, r4 } from "./stats.ts";

/** One gold cell the reading judge also labelled: the separate pass's gold label against the judge's own. */
export interface GoldRead {
  gold: boolean;
  judged: boolean;
  kind: string;
  list: string;
}

export interface GoldScore<C extends GoldRead> {
  used: C[];
  anticipated: number;
  not: number;
  lists: number;
  shortfall: boolean;
  catch_rate: number | null;
  false_fail: number | null;
  kappa: number | null;
  kappa_real: number | null;
  kappa_ok: boolean;
  pass: boolean;
}

/**
 * Scores a judge on gold cells. capAnticipated picks the anticipated gold cells that count (an eval's oracle cap); every
 * not-anticipated gold cell counts. The gold minimum needs minimum cells of each class from minimum distinct lists (0 turns
 * it off). Both kappas, on all counted cells and on real-list cells alone, must reach bar at four decimals.
 */
export function scoreGold<C extends GoldRead>(cells: readonly C[], o: { minimum: number; bar: number; real: (c: C) => boolean; capAnticipated: (anticipated: C[]) => C[] }): GoldScore<C> {
  const ant = o.capAnticipated(cells.filter((c) => c.gold));
  const not = cells.filter((c) => !c.gold);
  const used = [...ant, ...not];
  const lists = new Set(used.map((c) => c.list)).size;
  const shortfall = o.minimum > 0 && (ant.length < o.minimum || not.length < o.minimum || lists < o.minimum);
  const k = kappa(used.map((c) => [c.gold, c.judged] as const));
  const kr = kappa(used.filter(o.real).map((c) => [c.gold, c.judged] as const));
  const kappa_ok = k !== null && kr !== null && r4(k) >= o.bar && r4(kr) >= o.bar;
  return {
    used,
    anticipated: ant.length,
    not: not.length,
    lists,
    shortfall,
    catch_rate: not.length ? not.filter((c) => !c.judged).length / not.length : null,
    false_fail: ant.length ? ant.filter((c) => !c.judged).length / ant.length : null,
    kappa: k,
    kappa_real: kr,
    kappa_ok,
    pass: !shortfall && kappa_ok,
  };
}

export interface PowerRow {
  m: string;
  p0: number;
  rho: number;
  n: number;
  passes: number;
  mdd05: number;
  mdd025: number;
}

/** power.txt's Part A rows: items per unit, control, ICC, units, passes and the MDD at alpha 0.05 and 0.025. */
export function parsePower(text: string): PowerRow[] {
  const out: PowerRow[] = [];
  for (const line of text.split("\n")) {
    const m = /^m (\S+)\s+p0 ([\d.]+)\s+rho ([\d.]+)\s+n (\d+)\s+passes (\d+)\s+MDD05 ([\d.]+|None)\s+MDD025 ([\d.]+|None)/.exec(line.trim());
    if (m && m[6] !== "None" && m[7] !== "None") out.push({ m: m[1]!, p0: Number(m[2]), rho: Number(m[3]), n: Number(m[4]), passes: Number(m[5]), mdd05: Number(m[6]), mdd025: Number(m[7]) });
  }
  return out;
}

/**
 * The design MDD: the item mix (by its mean items a unit, from mixMean) nearest meanItems, a tie taking the larger MDD, at
 * the tabled unit count nearest n at or below it and the given passes, the conservative end over ICC and control rate,
 * at alpha 0.025. A larger stage 1 re-estimate governs. Null when the table has no row there.
 */
export function designMdd(rows: readonly PowerRow[], mixMean: Readonly<Record<string, number>>, o: { meanItems: number; n: number; passes: number; stage1?: number | null }): { mdd: number; mix: string[]; n: number; table: number; source: "table" | "stage 1" } | null {
  const ns = [...new Set(rows.map((r) => r.n))].sort((a, b) => a - b);
  const n = [...ns].reverse().find((x) => x <= o.n) ?? ns[0]!;
  const dist = (m: string) => Math.abs(mixMean[m]! - o.meanItems);
  const best = Math.min(...Object.keys(mixMean).map(dist));
  const mixes = Object.keys(mixMean).filter((m) => Math.abs(dist(m) - best) < 1e-9);
  const table = Math.max(...rows.filter((r) => mixes.includes(r.m) && r.n === n && r.passes === o.passes).map((r) => r.mdd025));
  if (!Number.isFinite(table)) return null;
  const s1 = o.stage1 ?? null;
  return s1 !== null && s1 > table ? { mdd: s1, mix: mixes, n, table, source: "stage 1" } : { mdd: table, mix: mixes, n, table, source: "table" };
}

/** A month-stated cutoff covers that whole month: "2026-06" reads as 2026-06-30. Null for a form it can't read. */
export function cutoffEnd(c: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(c)) return c;
  const m = /^(\d{4})-(\d{2})$/.exec(c);
  if (!m) return null;
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return m[1] + "-" + m[2] + "-" + String(last).padStart(2, "0");
}
