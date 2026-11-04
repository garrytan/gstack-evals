// The cost-per-solved guard of the outcome-per-skill plan v3 (build step O4), by #169's G3 definition
// (wiki/plans/2026-11-02-geva-214-gstack-overhaul-before-after-prereg, section 6.2). Each arm's figure is its metered
// model dollars over its solved trials, the ratio is told's figure over none's, and the guard holds when the upper bound
// of the ratio's 95% task-clustered bootstrap interval (10,000 resamples, seed 20261102) is at most 1.5. A told arm that
// solves no task fails it; a none arm that solves no task has an unbounded figure, so the guard holds. Plan v3 section 3
// counts an arm's dollars over all its trials: every scored trial, arm stops included, on the tasks both arms share, as
// a contrast pairs them. Measurement agents are metered apart and never reach these trials. The break-even gain (plan v3
// section 8) is the gain at which told's cost per solved task is 1.5 times none's: p times (m / 1.5 minus 1), with p the
// control rate and m told's session multiple.
import { taskRepos, type Arms, type OutcomeTrial } from "./outcome-decision.ts";
import { seededRandom } from "./paired.ts";

export const G3 = { bar: 1.5, bootstrap: { seed: 20261102, draws: 10000 } };

export interface ArmCost {
  trials: number;
  solved: number;
  cost_usd: number;
  /** Dollars per solved trial; null when the arm solved none. */
  per_solved_usd: number | null;
  mean_session_usd: number;
}

export interface CostGuard {
  tasks: number;
  control: ArmCost;
  treatment: ArmCost;
  /** Told's dollars per solved trial over none's; null when either arm solved no trial. */
  ratio: number | null;
  ci95: [number, number];
  holds: boolean;
  reason: string;
  /** Told's mean session cost over none's. */
  session_multiple: number;
}

/** A resample's ratio: told with no solve is unbounded, none with no solve leaves told's figure unbounded below none's. */
function ratioOf(ct: number, st: number, cn: number, sn: number): number {
  if (st === 0) return Infinity;
  if (sn === 0) return 0;
  if (cn === 0) return ct === 0 ? 1 : Infinity;
  return ct / st / (cn / sn);
}

export function costGuard(trials: readonly OutcomeTrial[], arms: Arms, cfg: { bar: number; bootstrap: { seed: number; draws: number } } = G3, scope?: readonly string[]): CostGuard {
  taskRepos(trials);
  if (!Number.isSafeInteger(cfg.bootstrap.draws) || cfg.bootstrap.draws < 1000) throw new Error("the guard's bootstrap needs at least 1000 draws");
  const inScope = scope ? new Set(scope) : null;
  const by = new Map<string, { t: OutcomeTrial[]; n: OutcomeTrial[] }>();
  for (const x of trials) {
    if (x.status !== "scored" || (inScope && !inScope.has(x.task))) continue;
    const side = x.arm === arms.treatment ? "t" : x.arm === arms.control ? "n" : null;
    if (!side) continue;
    const e = by.get(x.task) ?? { t: [], n: [] };
    e[side].push(x);
    by.set(x.task, e);
  }
  const shared = [...by.entries()].filter(([, e]) => e.t.length && e.n.length).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (!shared.length) throw new Error("no task has a scored trial in both arms, so cost per solved task can't be compared");
  const sums = shared.map(([, e]) => {
    const side = (xs: OutcomeTrial[]) => {
      let cost = 0, solved = 0;
      for (const x of xs) {
        if (x.cost_usd === null || !Number.isFinite(x.cost_usd) || x.cost_usd < 0) throw new Error("trial " + x.trial + " of arm " + x.arm + " on task " + x.task + " has no metered cost; the guard reads every counted trial's U4 lease spend");
        cost += x.cost_usd;
        if (x.solved) solved++;
      }
      return { cost, solved, trials: xs.length };
    };
    return { t: side(e.t), n: side(e.n) };
  });
  const total = (k: "t" | "n") => sums.reduce((a, s) => ({ cost: a.cost + s[k].cost, solved: a.solved + s[k].solved, trials: a.trials + s[k].trials }), { cost: 0, solved: 0, trials: 0 });
  const T = total("t"), N = total("n");
  const arm = (x: { cost: number; solved: number; trials: number }): ArmCost => ({ trials: x.trials, solved: x.solved, cost_usd: x.cost, per_solved_usd: x.solved ? x.cost / x.solved : null, mean_session_usd: x.cost / x.trials });
  const base = { tasks: sums.length, control: arm(N), treatment: arm(T), session_multiple: T.cost / T.trials / (N.cost / N.trials) };
  if (T.solved === 0) return { ...base, ratio: null, ci95: [Infinity, Infinity], holds: false, reason: "told solved no task in the contrast, so G3 fails" };
  if (N.solved === 0) return { ...base, ratio: null, ci95: [0, 0], holds: true, reason: "none solved no task in the contrast, so its cost per solved task is unbounded and G3 holds" };
  const rng = seededRandom(cfg.bootstrap.seed);
  const D = cfg.bootstrap.draws, n = sums.length;
  const draws = new Array<number>(D);
  for (let i = 0; i < D; i++) {
    let ct = 0, st = 0, cn = 0, sn = 0;
    for (let j = 0; j < n; j++) {
      const s = sums[Math.floor(rng() * n)]!;
      ct += s.t.cost;
      st += s.t.solved;
      cn += s.n.cost;
      sn += s.n.solved;
    }
    draws[i] = ratioOf(ct, st, cn, sn);
  }
  draws.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const ci95: [number, number] = [draws[Math.floor(D * 0.025)]!, draws[Math.ceil(D * 0.975) - 1]!];
  const holds = ci95[1] <= cfg.bar;
  const text = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "unbounded");
  return { ...base, ratio: ratioOf(T.cost, T.solved, N.cost, N.solved), ci95, holds, reason: "the upper bound " + text(ci95[1]) + " of told's cost per solved task over none's is " + (holds ? "at most " : "above ") + cfg.bar };
}

/** The gain at which told's cost per solved task is bar times none's: p (m / bar - 1), p the control rate, m told's session multiple. */
export function breakEvenGain(controlRate: number, sessionMultiple: number, bar: number = G3.bar): number {
  return controlRate * (sessionMultiple / bar - 1);
}
