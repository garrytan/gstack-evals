// Model comparisons for the Lane B quick look, paired by task over per-task mean rewards with the same
// task-clustered bootstrap analyze.ts uses (10,000 resamples, seed 20261028). Quick look 3 preregisters:
// each cell's pass rate, cost per success, median tokens and median wall time per trial; model A minus
// model B within each arm (model_pairs: particle-1 and DeepSeek V4.1 Flash, Sonnet 5.5 and Haiku 5.5);
// every cell minus the reference cell (reference_cell: Opus 5.5 none); and analyze.ts's share of the
// Opus gap closed by each model's gstack arm, beside the interval of its denominator, Opus none minus the
// model's none, marked unstable when that interval does not lie wholly above zero.
// Usage: bun model-contrast.ts <config.json>, where the config is analyze.ts's plus model_pairs and
// reference_cell, for example "model_pairs": [["particle-1", "deepseek-v4.1-flash-1017"]].
import { readFileSync } from "node:fs";
import { analyze, bootstrap, loadJobs, perTask, readSessionRows, sessionsByTrial, type SessionRow, type Trial } from "./analyze.ts";

type Cell = [model: string, arm: string];
type Opts = { seed?: number; b?: number; noReward?: "zero" | "drop" };

const kept = (all: Trial[], noReward?: "zero" | "drop") => ((noReward ?? "zero") === "drop" ? all.filter((t) => !t.noReward) : all);
const avg = (m: Map<string, number>, s: string[]) => s.reduce((x, k) => x + m.get(k)!, 0) / s.length;
const common = (...maps: Map<string, number>[]) => [...maps[0].keys()].filter((k) => maps.every((m) => m.has(k))).sort();
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((x, y) => x - y), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

export function cellContrast(trials: Trial[], [ma, aa]: Cell, [mb, ab]: Cell, opts: Opts = {}) {
  const A = perTask(trials, ma, aa), B = perTask(trials, mb, ab);
  const tasks = common(A, B);
  const ci = bootstrap(tasks, (s) => avg(A, s) - avg(B, s), opts);
  return { tasks: tasks.length, a: tasks.length ? avg(A, tasks) : NaN, b: tasks.length ? avg(B, tasks) : NaN, diff: ci.point, lo: ci.lo, hi: ci.hi };
}

export function modelContrasts(all: Trial[], opts: Opts & { pairs: [string, string][]; arms: string[] }) {
  const trials = kept(all, opts.noReward);
  return opts.arms.flatMap((arm) => opts.pairs.map(([a, b]) => ({ arm, contrast: `${a} - ${b}`, ...cellContrast(trials, [a, arm], [b, arm], opts) })));
}

export function referenceContrasts(all: Trial[], opts: Opts & { models: string[]; arms: string[]; reference: Cell }) {
  const trials = kept(all, opts.noReward);
  const [rm, ra] = opts.reference;
  return opts.models.flatMap((m) => opts.arms.filter((a) => m !== rm || a !== ra).map((a) => ({ model: m, arm: a, contrast: `${m} ${a} - ${rm} ${ra}`, ...cellContrast(trials, [m, a], opts.reference, opts) })))
    .filter((r) => r.tasks > 0);
}

// Billed tokens per trial: input, both cache writes, cache reads and output, summed over the trial's sessions.
export function tokensByTrial(rows: SessionRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [trial, list] of sessionsByTrial(rows)) {
    out.set(trial, list.reduce((x, r) => x + Object.values((r as SessionRow & { usage?: Record<string, number> }).usage ?? {}).reduce((y, v) => y + (Number(v) || 0), 0), 0));
  }
  return out;
}

export function cellTable(all: Trial[], tokens: Map<string, number>, opts: Opts & { models: string[]; arms: string[] }) {
  const trials = kept(all, opts.noReward);
  return opts.models.flatMap((m) => opts.arms.flatMap((a) => {
    const g = trials.filter((t) => t.model === m && t.arm === a && t.outcome !== "infra");
    if (!g.length) return [];
    const map = perTask(trials, m, a);
    const ci = bootstrap([...map.keys()].sort(), (s) => avg(map, s), opts);
    const passes = g.filter((t) => t.outcome === "pass").length;
    const cost = g.every((t) => t.costUsd !== null) ? g.reduce((x, t) => x + (t.costUsd ?? 0), 0) : NaN;
    return [{
      model: m, arm: a, tasks: map.size, trials: g.length, rate: ci.point, lo: ci.lo, hi: ci.hi, costPerSuccess: passes ? cost / passes : NaN,
      medianTokens: median(g.flatMap((t) => (tokens.has(t.trialName) ? [tokens.get(t.trialName)!] : []))),
      medianWallMin: median(g.flatMap((t) => (t.wallS === null ? [] : [t.wallS / 60]))),
    }];
  }));
}

export function gapTable(all: Trial[], opts: Opts & { models: string[]; reference: string }) {
  const trials = kept(all, opts.noReward);
  const rep = analyze(all, { models: opts.models, arms: ["none", "gstack"], reference: opts.reference, seed: opts.seed, b: opts.b, noReward: opts.noReward });
  return rep.gap.map((g) => {
    const ref = perTask(trials, opts.reference, "none"), mn = perTask(trials, g.model, "none"), mg = perTask(trials, g.model, "gstack");
    const d = bootstrap(common(ref, mn, mg), (s) => avg(ref, s) - avg(mn, s), opts);
    return { ...g, denom: d.point, denomLo: d.lo, denomHi: d.hi, unstable: !(d.lo > 0) };
  });
}

const pp = (x: number) => (Number.isFinite(x) ? (x >= 0 ? "+" : "") + Math.round(x * 100) : "n/a");
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : "n/a");
const usd = (x: number) => (Number.isFinite(x) ? `$${x.toFixed(2)}` : "n/a");
const num = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");

export function markdown(rows: ReturnType<typeof modelContrasts>): string {
  const lines = ["| Arm | Contrast | Paired tasks | Model A | Model B | Difference, pp [95% CI] |", "|---|---|---|---|---|---|"];
  for (const r of rows) lines.push(`| ${r.arm} | ${r.contrast} | ${r.tasks} | ${pct(r.a)} | ${pct(r.b)} | ${pp(r.diff)} [${pp(r.lo)}, ${pp(r.hi)}] |`);
  return lines.join("\n");
}

export function report(all: Trial[], tokens: Map<string, number>, cfg: Opts & { models: string[]; arms: string[]; model_pairs?: [string, string][]; reference_cell?: Cell }): string {
  const out = ["### Cells", "", "| Model | Arm | Tasks | Trials | Pass rate [95% CI] | Cost per success | Median tokens per trial | Median wall min per trial |", "|---|---|---|---|---|---|---|---|"];
  for (const c of cellTable(all, tokens, cfg)) out.push(`| ${c.model} | ${c.arm} | ${c.tasks} | ${c.trials} | ${pct(c.rate)} [${pct(c.lo)}, ${pct(c.hi)}] | ${usd(c.costPerSuccess)} | ${num(c.medianTokens)} | ${num(c.medianWallMin, 1)} |`);
  if (cfg.model_pairs?.length) out.push("", "### Model pairs within each arm", "", markdown(modelContrasts(all, { ...cfg, pairs: cfg.model_pairs })));
  if (cfg.reference_cell) {
    const [rm, ra] = cfg.reference_cell;
    out.push("", `### Against ${rm} ${ra}`, "", "| Contrast | Paired tasks | Cell | Reference | Difference, pp [95% CI] |", "|---|---|---|---|---|");
    for (const r of referenceContrasts(all, { ...cfg, reference: cfg.reference_cell })) out.push(`| ${r.contrast} | ${r.tasks} | ${pct(r.a)} | ${pct(r.b)} | ${pp(r.diff)} [${pp(r.lo)}, ${pp(r.hi)}] |`);
    if (ra === "none" && cfg.arms.includes("gstack")) {
      out.push("", `### Share of the ${rm} gap closed by gstack`, "", `| Model | Tasks | Share [95% CI] | Resamples with a gap | ${rm} none - model none, pp [95% CI] | Stability |`, "|---|---|---|---|---|---|");
      for (const g of gapTable(all, { ...cfg, reference: rm })) out.push(`| ${g.model} | ${g.tasks} | ${pct(g.share)} [${pct(g.lo)}, ${pct(g.hi)}] | ${pct(g.definedShare)} | ${pp(g.denom)} [${pp(g.denomLo)}, ${pp(g.denomHi)}] | ${g.unstable ? "unstable" : "stable"} |`);
    }
  }
  return out.join("\n");
}

if (import.meta.main) {
  const cfg = JSON.parse(readFileSync(Bun.argv[2], "utf8")) as { models: string[]; arms: string[]; jobs: string[]; sessions: string[]; no_reward?: "zero" | "drop"; subsets?: Record<string, string[]>; model_pairs?: [string, string][]; reference_cell?: Cell };
  if (!cfg.model_pairs?.length && !cfg.reference_cell) {
    console.error("E_USAGE model-contrast.ts: the config needs model_pairs, reference_cell or both, for example \"model_pairs\": [[\"particle-1\", \"deepseek-v4.1-flash-1017\"]], \"reference_cell\": [\"claude-opus-5-5\", \"none\"]");
    process.exit(2);
  }
  const rows = readSessionRows(cfg.sessions ?? []);
  const trials = loadJobs(cfg.jobs, rows);
  const tokens = tokensByTrial(rows);
  const opts = { ...cfg, noReward: cfg.no_reward };
  console.log(report(trials, tokens, opts));
  for (const [name, tasks] of Object.entries(cfg.subsets ?? {})) {
    console.log(`\n## Subset: ${name} (${tasks.length} tasks)\n`);
    console.log(report(trials.filter((t) => tasks.includes(t.task)), tokens, opts));
  }
}
