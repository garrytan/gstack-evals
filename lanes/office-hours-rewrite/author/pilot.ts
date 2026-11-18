// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's projection stop (the second attempt's section 5.5). At the pilot's end, and after
// every later batch until calibration and comparison are full, authoring projects the cost to place every open
// calibration and comparison slot, costing a slot with a partner waiting as a fresh pair:
// - a pair of type t costs (c1 / f + m_t * D * c2 + (1 - m_t) * B * c2) / m_t, the first attempt's resize.py formula at
//   the top-up bound B, 30 second twins a partner (the Captain's ruling of 2026-11-18);
// - an unpaired brief of kind u (T7, T8 or builder) costs cu / y_u.
// f is the first-twin pass rate over all pair types, m_t the share of type t's settled partners that matched within the
// bound and y_u kind u's pass rate, each counting the first attempt's final path (frozen.PROJECTION.attempt1) plus this
// run, at the 0.95 quantile of its Jeffreys posterior, Beta(k + 0.5, n - k + 0.5), so the projection is optimistic. D is
// the plain mean of the draws a matched partner took, over both attempts. c1, c2 and cu are the first attempt's costs a
// draft, scaled by this run's spend over what they predict for the drafts it has made. Authoring stops when the
// projection passes the item's cap less its committed spend less 8 drafts at the $3.50 brief allowance. The 16 and 32
// draw reads of pre-run change 1, item 4d, are gone with the pair-only pilot they read.
import { BRIEF_ALLOWANCE, PAIRED_TYPES, PROJECTION, TOP_UP_BOUND } from "../frozen.ts";
import { betaQuantile } from "../read/stats.ts";
import type { Role } from "./files.ts";

export type UnpairedKind = "T7" | "T8" | "builder";
export const UNPAIRED_KINDS: readonly UnpairedKind[] = ["T7", "T8", "builder"];

/** A pass count over a draw count, or for matched_draws the draws matched partners took over how many matched. */
export type KN = readonly [number, number];
export interface Counts {
  first: KN;
  /** Per pair type T1 to T6: partners matched within the bound over partners settled. */
  partners: Readonly<Record<string, KN>>;
  matched_draws: KN;
  unpaired: Readonly<Record<UnpairedKind, KN>>;
}
/** Open calibration and comparison slots: pairs by type, unpaired by kind. */
export interface Open {
  pairs: Readonly<Record<string, number>>;
  unpaired: Readonly<Record<UnpairedKind, number>>;
}

export const ATTEMPT_1: Counts = PROJECTION.attempt1;

/** The 0.95 quantile of k of n's Jeffreys posterior. */
export const jeffreys = (k: number, n: number): number => betaQuantile(PROJECTION.quantile, k + 0.5, n - k + 0.5);

const add = (a: KN, b: KN): KN => [a[0] + b[0], a[1] + b[1]];
export const plus = (a: Counts, b: Counts): Counts => ({
  first: add(a.first, b.first),
  partners: Object.fromEntries(PAIRED_TYPES.map((t) => [t, add(a.partners[t] ?? [0, 0], b.partners[t] ?? [0, 0])])),
  matched_draws: add(a.matched_draws, b.matched_draws),
  unpaired: { T7: add(a.unpaired.T7, b.unpaired.T7), T8: add(a.unpaired.T8, b.unpaired.T8), builder: add(a.unpaired.builder, b.unpaired.builder) },
});

/** The projected dollars to place every open calibration and comparison slot. */
export function projection(c: Counts, open: Open, scale: number): number {
  const { first, second, unpaired } = PROJECTION.usd;
  const f = jeffreys(...c.first);
  const d = c.matched_draws[0] / c.matched_draws[1];
  let cost = 0;
  for (const t of PAIRED_TYPES) {
    const m = jeffreys(...(c.partners[t] ?? [0, 0]));
    cost += (open.pairs[t] ?? 0) * ((first / f + m * d * second + (1 - m) * TOP_UP_BOUND * second) / m);
  }
  for (const u of UNPAIRED_KINDS) cost += (open.unpaired[u] ?? 0) * (unpaired / jeffreys(...c.unpaired[u]));
  return cost * scale;
}

/** What the first attempt's costs a draft predict for a draft of this role. */
export const predicted = (role: Role): number => PROJECTION.usd[role];

/** The room the projection must fit: the cap less the committed spend less the drafts in flight at the brief allowance. */
export const roomLeft = (cap: number, committed: number): number => cap - committed - PROJECTION.held * BRIEF_ALLOWANCE;

export interface ProjectionRead {
  /** Drafts settled when the read was taken. */
  drafts: number;
  committed: number;
  scale: number;
  projection: number;
  room: number;
  stop: boolean;
  counts: Counts;
  open: Open;
}

export function readProjection(o: { counts: Counts; open: Open; spend: number; predicted: number; cap: number; committed: number; drafts: number }): ProjectionRead {
  const scale = o.predicted > 0 ? o.spend / o.predicted : 1;
  const counts = plus(ATTEMPT_1, o.counts);
  const p = projection(counts, o.open, scale);
  const room = roomLeft(o.cap, o.committed);
  return { drafts: o.drafts, committed: o.committed, scale, projection: p, room, stop: p > room, counts, open: o.open };
}
