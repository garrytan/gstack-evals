// Minimum detectable differences for GEVA-106's preregistration (section 11). No data, no key.
// Run D, 37 tasks, one trial per task per arm: the per-trial open probability that gives 80% power for
//   D1: gstack and placebo pooled (two trials per task); a claim needs the bootstrap interval to exclude 0;
//   D2: rewritten minus pooled, shipped rate 0 or 0.02; Holm across 5 models, so the first step needs p < 0.01,
//       and the interval must exclude 0.
// Opens are uniform across tasks, or confined to a random 30% of tasks (11 of 37; the rewritten arm's opens in
// D2, the shipped opens stay uniform). Each power value is 1,000 simulated datasets with 1,000 bootstrap
// resamples each (and 1,000 sign-flip draws for D2's p), seed 20261101. The search is a bisection to 0.001.
// Run T is analytic: MDD = 2.8 x 4.08 x sqrt(3 / r) points, and (2.394 + 0.842) x 4.08 x sqrt(3 / r) for T2's
// first Holm step across three models.
//   bun analysis/mdd-sim.ts [datasets] [resamples]
import { rng } from "./analyze.ts";

const TASKS = 37;
const CONFINED = Math.round(0.3 * TASKS);
const [DATASETS, RESAMPLES] = [Number(Bun.argv[2] ?? 1000), Number(Bun.argv[3] ?? 1000)];
const rand = rng(20261101);

const quantile = (s: Float64Array, q: number) => { const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo); };
function interval(v: Float64Array) {
  const reps = new Float64Array(RESAMPLES);
  for (let b = 0; b < RESAMPLES; b++) { let s = 0; for (let i = 0; i < TASKS; i++) s += v[Math.floor(rand() * TASKS)]!; reps[b] = s / TASKS; }
  reps.sort();
  return { lo: quantile(reps, 0.025), hi: quantile(reps, 0.975) };
}
function signFlipP(v: Float64Array) {
  let obs = 0;
  for (const x of v) obs += x;
  obs = Math.abs(obs / TASKS) - 1e-12;
  let hits = 0;
  for (let b = 0; b < RESAMPLES; b++) { let s = 0; for (const x of v) s += rand() < 0.5 ? -x : x; if (Math.abs(s / TASKS) >= obs) hits++; }
  return (1 + hits) / (1 + RESAMPLES);
}
// Per-task open probabilities with overall per-trial rate p: uniform, or p / 0.3 on a random 11 tasks.
function probs(p: number, confined: boolean) {
  const out = new Float64Array(TASKS).fill(confined ? 0 : p);
  if (!confined) return out;
  const idx = Array.from({ length: TASKS }, (_, i) => i);
  for (let i = TASKS - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j]!, idx[i]!]; }
  for (const i of idx.slice(0, CONFINED)) out[i] = Math.min(1, (p * TASKS) / CONFINED);
  return out;
}
const trials = (q: Float64Array, n: number) => q.map((x) => { let k = 0; for (let t = 0; t < n; t++) if (rand() < x) k++; return k / n; });

function powerD1(p: number, confined: boolean) {
  let ok = 0;
  for (let d = 0; d < DATASETS; d++) if (interval(trials(probs(p, confined), 2)).lo > 0) ok++;
  return ok / DATASETS;
}
function powerD2(p: number, shipped: number, confined: boolean) {
  let ok = 0;
  for (let d = 0; d < DATASETS; d++) {
    const rw = trials(probs(p, confined), 1), pool = trials(probs(shipped, false), 2);
    const v = rw.map((x, i) => x - pool[i]!);
    const ci = interval(v);
    if ((ci.lo > 0 || ci.hi < 0) && signFlipP(v) < 0.01) ok++;
  }
  return ok / DATASETS;
}
function mdd(power: (p: number) => number, hi: number) {
  let lo = 0;
  if (power(hi) < 0.8) return { p: NaN, power: power(hi) };
  while (hi - lo > 0.001) { const mid = (lo + hi) / 2; if (power(mid) >= 0.8) hi = mid; else lo = mid; }
  return { p: hi, power: power(hi) };
}
const pct = (x: number) => (Number.isFinite(x) ? (100 * x).toFixed(1) + "%" : "not reached");

console.log(`Run D MDD, 37 tasks, r = 1: ${DATASETS} simulated datasets x ${RESAMPLES} bootstrap resamples per power value (D2 also ${RESAMPLES} sign-flip draws), seed 20261101`);
console.log("| Reading | Opens | Shipped rate | Per-trial open probability at 80% power | Difference | Power there |");
console.log("|---|---|---|---|---|---|");
for (const confined of [false, true]) {
  const m = mdd((p) => powerD1(p, confined), confined ? 0.3 : 1);
  console.log(`| D1 | ${confined ? "30% of tasks" : "uniform"} | - | ${pct(m.p)} | - | ${pct(m.power)} |`);
}
for (const shipped of [0, 0.02]) for (const confined of [false, true]) {
  const m = mdd((p) => powerD2(p, shipped, confined), confined ? 0.3 : 1);
  console.log(`| D2 | ${confined ? "30% of tasks" : "uniform"} | ${pct(shipped)} | ${pct(m.p)} | ${pct(m.p - shipped)} | ${pct(m.power)} |`);
}
console.log("", "Run T analytic check (points): | r | MDD 2.8 x 4.08 x sqrt(3/r) | T2 first Holm step (2.394 + 0.842) x 4.08 x sqrt(3/r) |", "|---|---|---|");
for (let r = 1; r <= 5; r++) console.log(`| ${r} | ${(2.8 * 4.08 * Math.sqrt(3 / r)).toFixed(1)} | ${((2.394 + 0.842) * 4.08 * Math.sqrt(3 / r)).toFixed(1)} |`);
