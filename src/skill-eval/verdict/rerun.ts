// The same-tree rerun stage (interface v0.4, "Exit codes and reasons"). When any task is red after round 1, every task
// reruns once in every compared arm, so the second round can find losses as well as clear them, and the decision pools
// both rounds. A task is red when REGRESSION or MISS names it. SAFETY_BREAK alone does not trigger the stage, since no
// rerun clears it. FLAKY is recorded only when after's panel and the old copies' panel both change between rounds.
//
// The verdict prints the two-stage rule's simulated false-negative rate at the run's minimum detectable difference: the
// share of simulated runs with a true loss of that size on every task that end without an exit 1 reason. Each simulated
// task starts from its old pass rate in this run, after's rate is that minus the loss (floored at 0), and every arm
// runs the trials this run scheduled. The simulation applies the same gates as the verdict (taskGates, contractWorse and
// the sign-flip WORSE); its sign-flip p counts sign patterns exactly instead of enumerating them, which gives the same p
// as clusteredPairedDelta's p_less (tests/verdict/rerun.test.ts).
import { seededRandom } from "../../runner/stats/paired.ts";
import type { ReasonCode } from "../../errors/codes.ts";
import { ALPHA, contractWorse, taskGates, type Count, type Reason, type TaskCounts } from "./gates.ts";

export const RERUN_STAGE = "same-tree-rerun";

const RED: readonly ReasonCode[] = ["REGRESSION", "MISS"];

/** Tasks a round's reasons mark red. */
export const redTasks = (reasons: readonly Reason[]): string[] => [...new Set(reasons.filter((r) => RED.includes(r.code) && r.subject).map((r) => r.subject!))].sort();

const panel = (c: Count) => 3 * c.k >= 2 * c.n;

/** Tasks whose after panel and old panel (at least 2 of 3 runs passing) both changed between the rounds. */
export function flakyTasks(round1: readonly TaskCounts[], round2: readonly TaskCounts[]): string[] {
  const second = new Map(round2.map((c) => [c.id, c]));
  return round1
    .filter((a) => {
      const b = second.get(a.id);
      return b && a.after.n && b.after.n && a.old.n && b.old.n && panel(a.after) !== panel(b.after) && panel(a.old) !== panel(b.old);
    })
    .map((c) => c.id);
}

/**
 * Exact one-sided sign-flip p over integer cluster sums: the share of sign patterns whose total is at or below the
 * observed total. Every cluster counts, zero sums included, as in clusteredPairedDelta.
 */
export function signFlipPLess(sums: readonly number[]): number {
  const total = sums.reduce((s, x) => s + Math.abs(x), 0);
  let dist = new Float64Array(2 * total + 1);
  dist[total] = 1;
  for (const x of sums) {
    const a = Math.abs(x);
    if (!a) continue;
    const next = new Float64Array(dist.length);
    for (let i = 0; i < dist.length; i++) {
      if (!dist[i]) continue;
      next[i + a]! += dist[i]! / 2;
      next[i - a]! += dist[i]! / 2;
    }
    dist = next;
  }
  const observed = total + sums.reduce((s, x) => s + x, 0);
  let p = 0;
  for (let i = 0; i <= observed; i++) p += dist[i]!;
  return Math.min(1, p);
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Per-task (after minus old) mean differences scaled to integers, for signFlipPLess. */
export function scaledDiffs(counts: readonly TaskCounts[]): number[] {
  const usable = counts.filter((c) => c.old.n && c.after.n);
  const scale = usable.reduce((l, c) => [c.old.n, c.after.n].reduce((m, n) => (m * n) / gcd(m, n), l), 1);
  return usable.map((c) => (c.after.k * scale) / c.after.n - (c.old.k * scale) / c.old.n);
}

/** Whether a round's counts give an exit 1 reason under the pass-rate gates the simulation models. */
export function losesOn(counts: readonly TaskCounts[]): boolean {
  if (counts.some((c) => taskGates(c).reasons.length)) return true;
  const sum = (key: "before" | "after") => counts.reduce((s, c) => ({ k: s.k + c[key].k, n: s.n + c[key].n }), { k: 0, n: 0 });
  if (contractWorse(sum("before"), sum("after"))?.fires) return true;
  return signFlipPLess(scaledDiffs(counts)) < ALPHA;
}

export interface SimulationInput {
  tasks: { id: string; safety: boolean; old_rate: number }[];
  /** Trials per task in one round. */
  trials: { before: number; before2: number; after: number };
  /** The true loss on every task, as a fraction. */
  loss: number;
  simulations: number;
  seed: number;
}

/** The share of simulated two-stage runs with a true loss that end without an exit 1 reason. */
export function simulateFalseNegativeRate(input: SimulationInput): number {
  const rng = seededRandom(input.seed);
  const draw = (n: number, p: number): Count => {
    let k = 0;
    for (let i = 0; i < n; i++) if (rng() < p) k++;
    return { k, n };
  };
  const add = (a: Count, b: Count): Count => ({ k: a.k + b.k, n: a.n + b.n });
  const round = (): TaskCounts[] =>
    input.tasks.map((t) => {
      const before = draw(input.trials.before, t.old_rate);
      const old = add(before, draw(input.trials.before2, t.old_rate));
      const after = draw(input.trials.after, Math.max(0, t.old_rate - input.loss));
      return { id: t.id, safety: t.safety, before, old, after, all: add(old, after) };
    });
  let missed = 0;
  for (let s = 0; s < input.simulations; s++) {
    const first = round();
    const red = first.some((c) => taskGates(c).reasons.some((r) => RED.includes(r.code)));
    const decided = red
      ? round().map((c, i) => {
          const a = first[i]!;
          return { ...c, before: add(a.before, c.before), old: add(a.old, c.old), after: add(a.after, c.after), all: add(a.all, c.all) };
        })
      : first;
    if (!losesOn(decided)) missed++;
  }
  return missed / input.simulations;
}
