// Paired model contrasts for the Lane B quick look: for each arm, model A minus model B, paired by
// task over per-task mean rewards, with the same task-clustered bootstrap analyze.ts uses (10,000
// resamples, seed 20261028). Quick look 3 preregisters particle-1 minus DeepSeek V4.1 Flash per arm.
// Usage: bun model-contrast.ts <config.json>, where the config is analyze.ts's plus
// "model_pairs": [["particle-1", "deepseek-v4.1-flash-1017"]].
import { readFileSync } from "node:fs";
import { bootstrap, loadJobs, perTask, readSessionRows, type Trial } from "./analyze.ts";

export function modelContrasts(all: Trial[], opts: { pairs: [string, string][]; arms: string[]; seed?: number; b?: number; noReward?: "zero" | "drop" }) {
  const trials = (opts.noReward ?? "zero") === "drop" ? all.filter((t) => !t.noReward) : all;
  return opts.arms.flatMap((arm) =>
    opts.pairs.map(([a, b]) => {
      const A = perTask(trials, a, arm), B = perTask(trials, b, arm);
      const tasks = [...A.keys()].filter((k) => B.has(k)).sort();
      const avg = (m: Map<string, number>, s: string[]) => s.reduce((x, k) => x + m.get(k)!, 0) / s.length;
      const ci = bootstrap(tasks, (s) => avg(A, s) - avg(B, s), { seed: opts.seed, b: opts.b });
      return { arm, contrast: `${a} - ${b}`, tasks: tasks.length, a: tasks.length ? avg(A, tasks) : NaN, b: tasks.length ? avg(B, tasks) : NaN, diff: ci.point, lo: ci.lo, hi: ci.hi };
    }),
  );
}

const pp = (x: number) => (Number.isFinite(x) ? (x >= 0 ? "+" : "") + Math.round(x * 100) : "n/a");
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : "n/a");

export function markdown(rows: ReturnType<typeof modelContrasts>): string {
  const lines = ["| Arm | Contrast | Paired tasks | Model A | Model B | Difference, pp [95% CI] |", "|---|---|---|---|---|---|"];
  for (const r of rows) lines.push(`| ${r.arm} | ${r.contrast} | ${r.tasks} | ${pct(r.a)} | ${pct(r.b)} | ${pp(r.diff)} [${pp(r.lo)}, ${pp(r.hi)}] |`);
  return lines.join("\n");
}

if (import.meta.main) {
  const cfg = JSON.parse(readFileSync(Bun.argv[2], "utf8")) as { model_pairs: [string, string][]; arms: string[]; jobs: string[]; sessions: string[]; no_reward?: "zero" | "drop"; subsets?: Record<string, string[]> };
  if (!Array.isArray(cfg.model_pairs) || !cfg.model_pairs.length) {
    console.error("E_USAGE model-contrast.ts: the config needs model_pairs, for example [[\"particle-1\", \"deepseek-v4.1-flash-1017\"]]");
    process.exit(2);
  }
  const trials = loadJobs(cfg.jobs, readSessionRows(cfg.sessions ?? []));
  const opts = { pairs: cfg.model_pairs, arms: cfg.arms, noReward: cfg.no_reward };
  console.log(markdown(modelContrasts(trials, opts)));
  for (const [name, tasks] of Object.entries(cfg.subsets ?? {})) {
    console.log(`\n## Subset: ${name} (${tasks.length} tasks)\n`);
    console.log(markdown(modelContrasts(trials.filter((t) => tasks.includes(t.task)), opts)));
  }
}
