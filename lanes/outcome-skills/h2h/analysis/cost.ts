// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 11's COST reading and section 14's caps. Stage 1's measured per-arm, per-class session costs re-price the
// three stage 2 model items (h2h-opus: 100 O and 60 B units over the 7 primary arms; h2h-qa: gstack /qa on B1, half of
// B; h2h-pony: piece G's two arms on 100 O units). A re-priced item's cap is 1.35 times its central price, rounded to
// the dollar as the post's A2 table rounds; every other item keeps its cap. Above the approved total at caps, the only
// automatic figure is the frozen n cut: the largest factor f such that floor(f n_O) and floor(f n_B) fit. If any arm's
// 95th-percentile stage 1 session cost is above half the allowance, the allowance doubles for every arm, and stage 1
// sessions that stopped at the allowance are priced at the doubled allowance.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CAP_FACTOR, ITEMS } from "../items.ts";
import { h2hFail, PREREG_PATH, type H2hPrereg } from "../prereg.ts";
import { planningPrice } from "../rerun.ts";
import { PIECE_G_ARMS, PRIMARY_ARMS, type H2hArm, type H2hSession, type UnitClass } from "../types.ts";
import { mean, percentile } from "./stats.ts";

export const REPRICED = ["h2h-opus", "h2h-qa", "h2h-pony"] as const;

/** The post's A2 table: each item's cap and the total at caps, read from the approved post (the last dollar amount in
 *  each row's cap cell). Refuses when the caps do not add up to the total. */
export function postCaps(readme: string = join(PREREG_PATH, "..", "README.md")): { caps: Record<string, number>; total: number } {
  const all = readFileSync(readme, "utf8");
  const text = all.slice(all.indexOf("**A2. "), all.indexOf("**A3. "));
  const dollars = (cell: string) => [...cell.matchAll(/\$([\d,]+)/g)].map((m) => Number(m[1]!.replace(/,/g, "")));
  const caps: Record<string, number> = {};
  let total: number | null = null;
  for (const line of text.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 6) continue;
    const name = cells[1]!.replace(/\*/g, "");
    const cap = dollars(cells[4]!).pop();
    if (cap === undefined) continue;
    if (ITEMS[name]) caps[name] = cap;
    else if (name === "Total") total = cap;
  }
  const missing = Object.keys(ITEMS).filter((k) => caps[k] === undefined);
  const sum = Object.values(caps).reduce((a, x) => a + x, 0);
  if (missing.length || total === null || sum !== total) h2hFail("E_H2H_ANALYSIS_INPUT", readme + "'s A2 table does not read: missing " + (missing.join(", ") || "none") + ", caps add to " + sum + ", total " + total);
  return { caps, total: total! };
}

export interface ArmCost { n: number; mean: number | null; median: number | null; p95: number | null; allowance_stops: number }
export interface Repricing {
  allowance_usd: number; doubled: boolean; max_p95: { arm: string; usd: number } | null;
  costs: Record<string, Partial<Record<UnitClass, ArmCost>>>;
  /** Arms and classes priced at planning prices because stage 1 measured no session there. */
  planning_priced: string[];
  central: Record<string, number>; caps: Record<string, number>; total_at_caps: number; approved_total: number; above: boolean;
  /** The frozen n cut, when above: the factor and the class sizes it gives, or null when no size fits. */
  n_cut: { factor: number; n_O: number; n_B: number; n_qa: number; total_at_caps: number } | null;
}

/** Stage 1 cost statistics per arm and class (every session record, gaps included). With priceStopsAt, a session that
 *  stopped at the allowance is priced at that amount. */
export function armCosts(sessions: readonly { s: H2hSession; cls: UnitClass }[], priceStopsAt: number | null = null): Record<string, Partial<Record<UnitClass, ArmCost>>> {
  const out: Record<string, Partial<Record<UnitClass, ArmCost>>> = {};
  for (const key of [...new Set(sessions.map((x) => x.s.arm + "\t" + x.cls))].sort()) {
    const [arm, cls] = key.split("\t") as [string, UnitClass];
    const own = sessions.filter((x) => x.s.arm === arm && x.cls === cls);
    const usd = own.map((x) => (priceStopsAt !== null && x.s.end === "limit_allowance" ? Math.max(priceStopsAt, x.s.cost_usd) : x.s.cost_usd));
    (out[arm] ??= {})[cls] = { n: own.length, mean: mean(usd), median: percentile(usd, 50), p95: percentile(usd, 95), allowance_stops: own.filter((x) => x.s.end === "limit_allowance").length };
  }
  return out;
}

/** Re-prices the program from stage 1 sessions. caps overrides the post's caps (the approvals record), approved the total. */
export function reprice(p: H2hPrereg, sessions: readonly { s: H2hSession; cls: UnitClass }[], o: { caps?: Record<string, number>; approved?: number } = {}): Repricing {
  const post = postCaps();
  const caps0 = { ...post.caps, ...(o.caps ?? {}) };
  const approved = o.approved ?? post.total;
  const allowance0 = p.limits.allowance_usd;
  const byArm = new Map<string, number[]>();
  for (const { s } of sessions) byArm.set(s.arm, [...(byArm.get(s.arm) ?? []), s.cost_usd]);
  let max: Repricing["max_p95"] = null;
  for (const [arm, xs] of byArm) {
    const v = percentile(xs, 95)!;
    if (!max || v > max.usd) max = { arm, usd: v };
  }
  const doubled = !!max && max.usd > allowance0 / 2;
  const allowance = doubled ? 2 * allowance0 : allowance0;
  const costs = armCosts(sessions, doubled ? allowance : null);
  const planning: string[] = [];
  const price = (arm: H2hArm, cls: UnitClass) => {
    const m = costs[arm]?.[cls]?.mean;
    if (m !== null && m !== undefined) return m;
    planning.push(arm + " " + cls);
    return planningPrice(arm, cls);
  };
  const share = p.classes.B.b1_share_max;
  const centralAt = (nO: number, nB: number) => ({
    "h2h-opus": PRIMARY_ARMS.reduce((a, arm) => a + nO * price(arm, "O") + nB * price(arm, "B"), 0),
    "h2h-qa": Math.floor(nB * share) * price("gstack-qa", "B"),
    "h2h-pony": PIECE_G_ARMS.reduce((a, arm) => a + nO * price(arm, "O"), 0),
  });
  const capsAt = (nO: number, nB: number) => {
    const c = centralAt(nO, nB);
    const caps = { ...caps0 };
    for (const k of REPRICED) caps[k] = Math.round(c[k] * CAP_FACTOR);
    return { central: c, caps, total: Object.values(caps).reduce((a, x) => a + x, 0) };
  };
  const nO = p.classes.O.n, nB = p.classes.B.n;
  const full = capsAt(nO, nB);
  const planning_priced = [...new Set(planning)].sort();
  const out: Repricing = { allowance_usd: allowance, doubled, max_p95: max, costs, planning_priced, central: full.central, caps: full.caps, total_at_caps: full.total, approved_total: approved, above: full.total > approved, n_cut: null };
  if (!out.above) return out;
  const factors = [...new Set([...Array.from({ length: nO }, (_, k) => k / nO), ...Array.from({ length: nB }, (_, j) => j / nB)])].filter((f) => f > 0).sort((a, b) => b - a);
  for (const f of factors) {
    const kO = Math.floor(f * nO + 1e-9), kB = Math.floor(f * nB + 1e-9);
    const at = capsAt(kO, kB);
    if (at.total <= approved) return { ...out, n_cut: { factor: f, n_O: kO, n_B: kB, n_qa: Math.floor(kB * share), total_at_caps: at.total } };
  }
  return out;
}
