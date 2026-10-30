// Copyright (c) 2026 Garry Tan. MIT License.
// noloss power (plan section 5, size rule): a seeded simulation of the decision rule at a suite's PR cluster sizes. Each
// simulated blocker gets a reference detection rate from a beta distribution with the stated mean recall and spread;
// the variant's rates are the reference's scaled so its mean recall moves by exactly delta. Each arm's passes are
// independent draws, and every simulated comparison runs the exact tests in stats.ts. No model is called.
import { seededRandom } from "../../src/runner/stats/paired.ts";
import { ALPHA, decide, pairedTests } from "./stats.ts";
import type { Suite } from "./suite.ts";

/** Beta concentration (alpha + beta) of the per-blocker detection rates: wide puts many blockers near 0 or 1. */
export const SPREADS: Record<string, number> = { wide: 2, narrow: 8 };
export const POWER_GOAL = 0.8;

export interface PowerInput {
  /** Blocking blockers per PR cluster. */
  clusters: number[];
  passes_variant: number;
  passes_reference: number;
  recall: number;
  spread: number;
  margin_points: number;
  delta_points: number;
  sims: number;
  seed: number;
  /** The no-loss test's alpha; an export's Holm family faces 0.05 / its size at the strictest step. */
  alpha_no_loss?: number;
}

export interface PowerResult {
  no_loss: number;
  loss: number;
  not_distinguished: number;
  sims: number;
  /** Monte Carlo standard error of the NO_LOSS rate. */
  mc_se: number;
}

function normal(rng: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

function gamma(shape: number, rng: () => number): number {
  if (shape < 1) return gamma(shape + 1, rng) * (1 - rng()) ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = normal(rng);
    const v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    const u = 1 - rng();
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function spreadValue(spread: string): number {
  const named = SPREADS[spread];
  if (named !== undefined) return named;
  const k = Number(spread);
  if (!Number.isFinite(k) || k <= 0) throw new Error("--spread is wide, narrow or a positive beta concentration");
  return k;
}

/** Blocking blockers per PR cluster in a suite. */
export function suiteClusters(suite: Suite): number[] {
  const byCluster = new Map<string, number>();
  for (const u of suite.units) {
    const n = u.blockers.filter((b) => b.counts === "blocking").length;
    if (n) byCluster.set(u.cluster, (byCluster.get(u.cluster) ?? 0) + n);
  }
  return [...byCluster.values()];
}

export function simulate(input: PowerInput): PowerResult {
  const { clusters, recall, spread, sims } = input;
  if (!(recall > 0 && recall < 1)) throw new Error("--recall is a share strictly between 0 and 1");
  if (input.delta_points > 0) throw new Error("delta is zero or a loss; a gain is not simulated");
  if (!Number.isSafeInteger(sims) || sims < 1) throw new Error("--sims is a positive integer");
  if (clusters.length < 2) throw new Error("the size rule needs at least 2 PR clusters");
  const rng = seededRandom(input.seed);
  const cluster = clusters.flatMap((n, c) => Array.from({ length: n }, () => "c" + String(c).padStart(3, "0")));
  const passes = [input.passes_reference, input.passes_variant];
  const share = (rate: number, p: number) => {
    let hits = 0;
    for (let i = 0; i < p; i++) if (rng() < rate) hits++;
    return hits / p;
  };
  let noLoss = 0;
  let loss = 0;
  for (let s = 0; s < sims; s++) {
    const rates = cluster.map(() => {
      const x = gamma(recall * spread, rng);
      return x / (x + gamma((1 - recall) * spread, rng));
    });
    const mean = rates.reduce((a, r) => a + r, 0) / rates.length;
    const scale = mean > 0 ? Math.max(0, mean + input.delta_points / 100) / mean : 1;
    const pairs = rates.map((r, i) => ({ id: String(i), cluster: cluster[i]!, a: share(r, input.passes_reference), b: share(Math.min(1, r * scale), input.passes_variant) }));
    const t = pairedTests(pairs, input.margin_points, passes);
    const v = decide(t.no_loss.p, t.loss.p, input.alpha_no_loss ?? ALPHA);
    if (v === "NO_LOSS") noLoss++;
    else if (v === "LOSS") loss++;
  }
  const p = noLoss / sims;
  return { no_loss: p, loss: loss / sims, not_distinguished: (sims - noLoss - loss) / sims, sims, mc_se: Math.sqrt((p * (1 - p)) / sims) };
}

export interface PowerDesign {
  label: string;
  clusters: number[];
  passes: number;
}

export interface PowerRow {
  label: string;
  prs: number;
  blockers: number;
  passes: number;
  /** Share of simulations in which an arm as good as the reference gets NO_LOSS, per margin in points. */
  equal: Record<string, number>;
  /** Share of NO_LOSS when the variant is worse by exactly the first margin, and its Monte Carlo standard error. */
  false_no_loss: number;
  false_no_loss_mc_se: number;
  /** Share of LOSS when the variant is worse by the stated loss, at the first margin. */
  loss: number | null;
}

/** The plan's power table for each design: equal arms at every margin, false NO_LOSS at minus the first margin, and a stated loss. */
export function powerTable(designs: PowerDesign[], o: { recall: number; spread: number; margins: number[]; loss_points: number | null; sims: number; seed: number }): PowerRow[] {
  if (!o.margins.length) throw new Error("the size rule needs at least one margin");
  return designs.map((d) => {
    const run = (margin: number, delta: number) => simulate({ clusters: d.clusters, passes_variant: d.passes, passes_reference: d.passes, recall: o.recall, spread: o.spread, margin_points: margin, delta_points: delta, sims: o.sims, seed: o.seed });
    const off = run(o.margins[0]!, -o.margins[0]!);
    return {
      label: d.label,
      prs: d.clusters.length,
      blockers: d.clusters.reduce((s, n) => s + n, 0),
      passes: d.passes,
      equal: Object.fromEntries(o.margins.map((m) => [String(m), run(m, 0).no_loss])),
      false_no_loss: off.no_loss,
      false_no_loss_mc_se: Math.round(off.mc_se * 1e6) / 1e6,
      loss: o.loss_points === null ? null : run(o.margins[0]!, -o.loss_points).loss,
    };
  });
}

export function renderPowerTable(rows: PowerRow[], margins: number[], lossPoints: number | null): string[] {
  const pct = (x: number) => (x * 100).toFixed(1) + "%";
  const head = ["Design", "PRs", "Blocking blockers", "Passes per arm", ...margins.map((m) => "Equal arm NO_LOSS at " + m + " pts"), "False NO_LOSS at delta -" + margins[0], ...(lossPoints === null ? [] : ["A " + lossPoints + "-point loss called LOSS"])];
  return ["| " + head.join(" | ") + " |", "|" + head.map(() => "---").join("|") + "|", ...rows.map((r) => "| " + [r.label, r.prs, r.blockers, r.passes, ...margins.map((m) => pct(r.equal[String(m)]!)), pct(r.false_no_loss), ...(r.loss === null ? [] : [pct(r.loss)])].join(" | ") + " |")];
}
