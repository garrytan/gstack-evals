// Minimum detectable differences for Run D's preregistration (GEVA-125, section 11). No data, no key.
// 37 tasks; opens per trial are Bernoulli; every claim needs the 95% task-clustered percentile interval to exclude 0,
// and a test also needs the two-sided sign-flip p under its alpha. Readings, for the frozen layout:
//   D1   per model: gstack and placebo pooled under the preset, 2r trials per task; interval only.
//   D2   per model: gstack-rewritten (r per task) minus the pooled shipped arms (2r per task); Holm across the five
//        preset models, so the first step needs p < 0.01. Run at r = 1 and r = 2 (option (a), the cheap models).
//   D2   pooled: the per-task mean over the five models of that difference; one test, p < 0.05. The effect sits on
//        every model, or on 2 of the 5 (the pooled difference is then 2/5 of the per-model one).
//   D3   per model: gstack under the preset (r per task) minus gstack under sdk-default (r per task); Holm across
//        Opus and Haiku, so the first step needs p < 0.025.
//   D3   pooled: the per-task mean over the two models; one test, p < 0.05.
// The shipped (or sdk-default) rate is 0 or 0.02. Opens are uniform across tasks, or confined to the same random 30%
// of tasks (11 of 37) on every model, for the arm that carries the effect; the baseline stays uniform. Each power value
// is DATASETS simulated datasets with RESAMPLES bootstrap resamples and RESAMPLES sign-flip draws each, seed 20261101.
// The search is a bisection to 0.001 on the effect arm's per-trial open probability; the MDD is that probability
// minus the baseline, in points, at 80% power.
//   bun analysis/mdd-sim.ts [datasets] [resamples]
import { rng } from "./analyze.ts";

export const TASKS = 37;
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
function confinedTasks() {
  const idx = Array.from({ length: TASKS }, (_, i) => i);
  for (let i = TASKS - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j]!, idx[i]!]; }
  return new Set(idx.slice(0, CONFINED));
}
// Per-task open probabilities with overall per-trial rate p: uniform, or p / 0.3 on the given tasks.
function probs(p: number, on: Set<number> | null) {
  const out = new Float64Array(TASKS).fill(on ? 0 : p);
  if (on) for (const i of on) out[i] = Math.min(1, (p * TASKS) / CONFINED);
  return out;
}
const trials = (q: Float64Array, n: number) => q.map((x) => { let k = 0; for (let t = 0; t < n; t++) if (rand() < x) k++; return k / n; });

export type Design = { name: string; models: number; affected: number; effectTrials: number; baseTrials: number; alpha: number | null };
// One simulated dataset: the per-task difference, averaged over the models, and whether the claim rule holds.
function claims(d: Design, p: number, base: number, confined: boolean) {
  const on = confined ? confinedTasks() : null;
  const v = new Float64Array(TASKS);
  for (let m = 0; m < d.models; m++) {
    const eff = trials(probs(m < d.affected ? p : base, m < d.affected ? on : null), d.effectTrials);
    const ref = d.baseTrials ? trials(probs(base, null), d.baseTrials) : new Float64Array(TASKS);
    for (let i = 0; i < TASKS; i++) v[i] += (eff[i]! - ref[i]!) / d.models;
  }
  const ci = interval(v);
  if (d.alpha === null) return ci.lo > 0;
  return (ci.lo > 0 || ci.hi < 0) && signFlipP(v) < d.alpha;
}
function power(d: Design, p: number, base: number, confined: boolean) {
  let ok = 0;
  for (let k = 0; k < DATASETS; k++) if (claims(d, p, base, confined)) ok++;
  return ok / DATASETS;
}
function mdd(d: Design, base: number, confined: boolean) {
  let lo = base, hi = confined ? 0.3 : 1;
  if (power(d, hi, base, confined) < 0.8) return { p: NaN, power: NaN };
  while (hi - lo > 0.001) { const mid = (lo + hi) / 2; if (power(d, mid, base, confined) >= 0.8) hi = mid; else lo = mid; }
  return { p: hi, power: power(d, hi, base, confined) };
}
const pts = (x: number) => (Number.isFinite(x) ? (100 * x).toFixed(1) : "not reached");

export const DESIGNS: Design[] = [
  { name: "D1 per model, r = 1 (gstack and placebo pooled, 2 trials per task)", models: 1, affected: 1, effectTrials: 2, baseTrials: 0, alpha: null },
  { name: "D2 per model, r = 1 (Holm across 5, first step p < 0.01)", models: 1, affected: 1, effectTrials: 1, baseTrials: 2, alpha: 0.01 },
  { name: "D2 per model, r = 2 (option (a); Holm across 5, first step p < 0.01)", models: 1, affected: 1, effectTrials: 2, baseTrials: 4, alpha: 0.01 },
  { name: "D2 pooled over 5 models, r = 1, effect on all 5 (one test, p < 0.05)", models: 5, affected: 5, effectTrials: 1, baseTrials: 2, alpha: 0.05 },
  { name: "D2 pooled over 5 models, r = 1, effect on 2 of 5 (one test, p < 0.05)", models: 5, affected: 2, effectTrials: 1, baseTrials: 2, alpha: 0.05 },
  { name: "D3 per model, r = 1 (Holm across 2, first step p < 0.025)", models: 1, affected: 1, effectTrials: 1, baseTrials: 1, alpha: 0.025 },
  { name: "D3 pooled over Opus and Haiku, r = 1 (one test, p < 0.05)", models: 2, affected: 2, effectTrials: 1, baseTrials: 1, alpha: 0.05 },
];

if (import.meta.main) {
  console.log(`Run D MDD: ${TASKS} tasks, ${DATASETS} simulated datasets x ${RESAMPLES} bootstrap resamples and ${RESAMPLES} sign-flip draws per power value, seed 20261101, 80% power`);
  console.log("MDD is in points of the pooled (or per-model) open-rate difference; for D1 it is the open rate itself.");
  console.log("| Reading | Opens | Baseline rate | Effect arm's open probability at 80% power | MDD (points) | Power there |");
  console.log("|---|---|---|---|---|---|");
  for (const d of DESIGNS) for (const base of d.baseTrials ? [0, 0.02] : [0]) for (const confined of [false, true]) {
    const t0 = performance.now();
    const m = mdd(d, base, confined);
    const diff = d.models > 1 ? ((m.p - base) * d.affected) / d.models : m.p - base;
    console.log(`| ${d.name} | ${confined ? "30% of tasks" : "uniform"} | ${d.baseTrials ? pts(base) : "-"} | ${pts(m.p)} | ${pts(diff)} | ${Number.isFinite(m.power) ? m.power.toFixed(3) : "-"} |`);
    console.error(`${d.name} ${confined} ${base}: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
}
