// Analysis for the second-opinion rerun, as preregistered in wiki/plans/2026-10-28-gsta-13-second-opinion-rerun-prereg.md.
// Usage: bun rerun-analyze.ts <rerun runs dir> <parent runs dir> <runner dir>
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const [rerunDir, parentDir, runnerDir] = process.argv.slice(2);
const { loadResults, wilson } = await import(join(runnerDir, "src/analyze.ts"));
const TASKS = ["second-opinion-offer", "second-opinion-accepted"];
const ARMS = ["before", "after"];
const MODEL = "claude-opus-5-5";

function cellDirs(root: string, task: string, arm: string): string[] {
  const d = join(root, "office-hours", MODEL, task, arm);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((n) => /^t\d+$/.test(n)).map((n) => join(d, n));
}
function offered(dir: string): boolean {
  const p = join(dir, "usersim.jsonl");
  if (!existsSync(p)) return false;
  return readFileSync(p, "utf8").split("\n").filter(Boolean).some((l) => {
    const e = JSON.parse(l);
    return (e.event === "ask" || e.event === "prose") && e.category === "second_opinion";
  });
}
function sessions(root: string) {
  const out: Record<string, Record<string, { pass: boolean; pass_final: boolean; offered: boolean; cost: number }[]>> = {};
  let missing: Record<string, number> = {};
  for (const t of TASKS) {
    out[t] = {};
    for (const a of ARMS) {
      out[t][a] = [];
      for (const dir of cellDirs(root, t, a)) {
        const rp = join(dir, "result.json");
        if (!existsSync(rp)) { missing[`${t}/${a}`] = (missing[`${t}/${a}`] ?? 0) + 1; continue; }
        const r = JSON.parse(readFileSync(rp, "utf8"));
        if (r.status !== "complete") { missing[`${t}/${a}`] = (missing[`${t}/${a}`] ?? 0) + 1; continue; }
        out[t][a].push({ pass: r.pass, pass_final: r.pass_final, offered: offered(dir), cost: r.cost_usd });
      }
    }
  }
  return { out, missing };
}
function lchoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}
// One-sided Fisher exact test that after's success rate is below before's: P(X_after <= k_after) under the hypergeometric null.
function fisherLess(kA: number, nA: number, kB: number, nB: number): number {
  const K = kA + kB, N = nA + nB;
  let p = 0;
  for (let x = Math.max(0, K - nB); x <= Math.min(kA, K); x++) p += Math.exp(lchoose(nA, x) + lchoose(nB, K - x) - lchoose(N, K));
  return Math.min(1, p);
}
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function analyse(data: ReturnType<typeof sessions>["out"], key: "pass" | "pass_final" | "offered") {
  const perTask: Record<string, any> = {};
  const diffs: number[] = [];
  for (const t of TASKS) {
    const row: Record<string, any> = {};
    for (const a of ARMS) {
      const xs = data[t][a];
      const k = xs.filter((x) => x[key]).length;
      row[a] = { k, n: xs.length, rate: xs.length ? k / xs.length : NaN, ci95: wilson(k, xs.length) };
    }
    row.fisher_p_after_below_before = fisherLess(row.after.k, row.after.n, row.before.k, row.before.n);
    row.after_minus_before_pp = 100 * (row.after.rate - row.before.rate);
    diffs.push(row.after.rate - row.before.rate);
    perTask[t] = row;
  }
  const rnd = mulberry32(20261028);
  const boots: number[] = [];
  for (let b = 0; b < 10000; b++) {
    let s = 0;
    for (const t of TASKS) {
      const r: Record<string, number> = {};
      for (const a of ARMS) {
        const xs = data[t][a];
        let k = 0;
        for (let i = 0; i < xs.length; i++) if (xs[Math.floor(rnd() * xs.length)]![key]) k++;
        r[a] = xs.length ? k / xs.length : NaN;
      }
      s += r.after! - r.before!;
    }
    boots.push(s / TASKS.length);
  }
  boots.sort((x, y) => x - y);
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const ci = [boots[Math.floor(0.025 * boots.length)]!, boots[Math.ceil(0.975 * boots.length) - 1]!];
  return { per_task: perTask, pooled_after_minus_before_pp: 100 * mean, pooled_ci95_pp: ci.map((x) => 100 * x), reading: ci[1]! < 0 ? "LOSS_CONFIRMED" : "NO_LOSS_SHOWN" };
}
const rerun = sessions(rerunDir);
const parent = sessions(parentDir);
const short = TASKS.flatMap((t) => ARMS.filter((a) => rerun.out[t][a].length < 8).map((a) => `${t}/${a}`));
const pooled13: ReturnType<typeof sessions>["out"] = {};
for (const t of TASKS) { pooled13[t] = {}; for (const a of ARMS) pooled13[t][a] = [...parent.out[t][a], ...rerun.out[t][a]]; }
const cost: Record<string, number> = {};
for (const a of ARMS) { const xs = TASKS.flatMap((t) => rerun.out[t][a]); cost[a] = xs.reduce((s, x) => s + x.cost, 0) / xs.length; }
const result = {
  status: short.length ? `INCOMPLETE (${short.join(", ")} under 8 valid runs)` : "COMPLETE",
  missing: rerun.missing,
  primary: analyse(rerun.out, "pass"),
  final_answer: analyse(rerun.out, "pass_final"),
  offered: analyse(rerun.out, "offered"),
  mean_cost_usd: cost,
  outside_the_decision_13_trial_pool: { primary: analyse(pooled13, "pass"), offered: analyse(pooled13, "offered") },
};
console.log(JSON.stringify(result, null, 2));
