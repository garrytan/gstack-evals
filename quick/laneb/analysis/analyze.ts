// Analysis for the Lane B quick look. Reads Harbor job directories, classifies each
// trial, and reports pass rates with task-clustered bootstrap intervals, paired arm
// differences, cost per success, share of the Opus gap closed, and skill-open rates.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type Trial = {
  task: string;
  arm: string;
  model: string;
  trialName: string;
  outcome: "pass" | "fail" | "infra";
  reason: string;
  costUsd: number;
  requests: number;
  refused: number;
  skillOpens: string[];
  budgetStop: boolean;
  agentTimeout: boolean;
  wallS: number | null;
};

const SKILL_PATH = /\/\.claude\/skills\/([^/\s"']+)\/SKILL\.md/;

export function skillOpensFromMessages(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: any;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.type !== "AssistantMessage" || !Array.isArray(rec.content)) continue;
    for (const block of rec.content) {
      if (!block || typeof block !== "object" || !("name" in block)) continue;
      const input = block.input ?? {};
      if (block.name === "Skill") out.push(String(input.skill ?? input.command ?? input.name ?? "?").replace(/^\//, ""));
      else if (block.name === "Read" && typeof input.file_path === "string") {
        const m = SKILL_PATH.exec(input.file_path);
        if (m) out.push(m[1]);
      } else if (block.name === "Bash" && typeof input.command === "string") {
        const m = SKILL_PATH.exec(input.command);
        if (m && /\b(cat|head|less|sed|tail|grep)\b/.test(input.command)) out.push(m[1]);
      }
    }
  }
  return out;
}

function readJson(path: string): any {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

// Map a Harbor trial directory to a Trial. The arm and model come from the trial's
// agent config, the task from its task path.
export function loadTrial(dir: string): Trial | null {
  const result = readJson(join(dir, "result.json"));
  const config = readJson(join(dir, "config.json"));
  if (!result || !config) return null;
  const kwargs = config.agent?.kwargs ?? {};
  const task = String(config.task?.path ?? result.task_name ?? "").split("/").filter(Boolean).at(-1) ?? "?";
  const summary = readJson(join(dir, "agent", "laneb-summary.json"));
  const msgsPath = join(dir, "agent", "sdk-messages.jsonl");
  const skillOpens = existsSync(msgsPath) ? skillOpensFromMessages(readFileSync(msgsPath, "utf8").split("\n")) : [];
  const exc = result.exception_info?.exception_type ?? null;
  const excMsg = String(result.exception_info?.exception_message ?? "");
  const rewards = result.verifier_result?.rewards ?? null;
  const reward = rewards ? Number(rewards.reward ?? Object.values(rewards)[0]) : null;
  const session = summary?.session ?? {};
  const budgetStop = (session.refused ?? 0) > 0;
  const agentTimeout = exc === "AgentTimeoutError";
  let outcome: Trial["outcome"];
  let reason: string;
  if (reward === null) {
    outcome = "infra";
    reason = exc ? `${exc}: ${excMsg.slice(0, 160)}` : "no verifier reward";
  } else {
    outcome = reward >= 1 ? "pass" : "fail";
    reason = agentTimeout ? "agent timeout, patch graded" : budgetStop ? "session budget stop, patch graded" : exc ? `${exc}, patch graded` : "graded";
  }
  return {
    task,
    arm: String(kwargs.arm ?? "?"),
    model: String(kwargs.upstream_model ?? config.agent?.model_name ?? "?"),
    trialName: String(result.trial_name ?? dir.split("/").at(-1)),
    outcome,
    reason,
    costUsd: (session.spent_micros ?? 0) / 1e6,
    requests: session.requests ?? 0,
    refused: session.refused ?? 0,
    skillOpens,
    budgetStop,
    agentTimeout,
    wallS: summary?.wall_s ?? null,
  };
}

export function loadJobs(jobDirs: string[]): Trial[] {
  const out: Trial[] = [];
  for (const job of jobDirs) {
    for (const name of readdirSync(job)) {
      const d = join(job, name);
      if (!statSync(d).isDirectory()) continue;
      const t = loadTrial(d);
      if (t) out.push(t);
    }
  }
  return out;
}

// Seeded PRNG (mulberry32) so intervals are reproducible.
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

// Per-task mean reward for one cell, over graded trials only.
export function perTask(trials: Trial[], model: string, arm: string): Map<string, number> {
  const acc = new Map<string, number[]>();
  for (const t of trials) {
    if (t.model !== model || t.arm !== arm || t.outcome === "infra") continue;
    const xs = acc.get(t.task) ?? [];
    xs.push(t.outcome === "pass" ? 1 : 0);
    acc.set(t.task, xs);
  }
  return new Map([...acc].map(([k, xs]) => [k, mean(xs)]));
}

// Task-clustered bootstrap: resample tasks with replacement and recompute stat on them.
export function bootstrap(tasks: string[], stat: (sample: string[]) => number, opts: { b?: number; seed?: number } = {}) {
  const b = opts.b ?? 10000;
  const r = rng(opts.seed ?? 20261028);
  const point = stat(tasks);
  const reps: number[] = [];
  for (let i = 0; i < b; i++) {
    const sample = Array.from({ length: tasks.length }, () => tasks[Math.floor(r() * tasks.length)]);
    const v = stat(sample);
    if (Number.isFinite(v)) reps.push(v);
  }
  reps.sort((x, y) => x - y);
  return { point, lo: quantile(reps, 0.025), hi: quantile(reps, 0.975), finiteShare: reps.length / b };
}

export type Report = ReturnType<typeof analyze>;

export function analyze(trials: Trial[], opts: { models: string[]; arms: string[]; reference: string; seed?: number; b?: number }) {
  const { models, arms, reference } = opts;
  const bopts = { seed: opts.seed, b: opts.b };
  const cells: Record<string, Map<string, number>> = {};
  for (const m of models) for (const a of arms) cells[`${m}|${a}`] = perTask(trials, m, a);
  const cell = (m: string, a: string) => cells[`${m}|${a}`];
  const tasksIn = (...maps: Map<string, number>[]) => [...maps[0].keys()].filter((k) => maps.every((m) => m.has(k))).sort();
  const avg = (map: Map<string, number>, sample: string[]) => mean(sample.map((k) => map.get(k)!));

  const passRates = models.flatMap((m) => arms.map((a) => {
    const map = cell(m, a);
    const tasks = [...map.keys()].sort();
    const ci = bootstrap(tasks, (s) => avg(map, s), bopts);
    const graded = trials.filter((t) => t.model === m && t.arm === a && t.outcome !== "infra");
    const passes = graded.filter((t) => t.outcome === "pass").length;
    const cost = graded.reduce((x, t) => x + t.costUsd, 0);
    const opened = graded.filter((t) => t.skillOpens.length > 0).length;
    return {
      model: m, arm: a, tasks: tasks.length, trials: graded.length, passes, rate: ci.point, lo: ci.lo, hi: ci.hi,
      costUsd: cost, costPerSuccess: passes ? cost / passes : null,
      skillOpenRate: graded.length ? opened / graded.length : null,
      budgetStops: graded.filter((t) => t.budgetStop).length,
      timeouts: graded.filter((t) => t.agentTimeout).length,
    };
  }));

  const diff = (m: string, a: string, b: string) => {
    const A = cell(m, a), B = cell(m, b);
    const tasks = tasksIn(A, B);
    const ci = bootstrap(tasks, (s) => avg(A, s) - avg(B, s), bopts);
    return { model: m, contrast: `${a} - ${b}`, tasks: tasks.length, diff: ci.point, lo: ci.lo, hi: ci.hi };
  };
  const contrasts = models.flatMap((m) => [diff(m, "gstack", "none"), diff(m, "gstack", "placebo"), diff(m, "placebo", "none")]);

  const gap = models.filter((m) => m !== reference).map((m) => {
    const ref = cell(reference, "none"), mn = cell(m, "none"), mg = cell(m, "gstack");
    const tasks = tasksIn(ref, mn, mg);
    const share = (s: string[]) => {
      const denom = avg(ref, s) - avg(mn, s);
      return denom > 0 ? (avg(mg, s) - avg(mn, s)) / denom : NaN;
    };
    const ci = bootstrap(tasks, share, bopts);
    return { model: m, tasks: tasks.length, opusNone: avg(ref, tasks), modelNone: avg(mn, tasks), modelGstack: avg(mg, tasks), share: ci.point, lo: ci.lo, hi: ci.hi, definedShare: ci.finiteShare };
  });

  const skillCounts: Record<string, Record<string, number>> = {};
  for (const t of trials) {
    if (t.outcome === "infra") continue;
    const key = `${t.model}|${t.arm}`;
    skillCounts[key] ??= {};
    for (const s of new Set(t.skillOpens)) skillCounts[key][s] = (skillCounts[key][s] ?? 0) + 1;
  }
  const infra = trials.filter((t) => t.outcome === "infra").map((t) => ({ task: t.task, arm: t.arm, model: t.model, trial: t.trialName, reason: t.reason }));
  return { passRates, contrasts, gap, skillCounts, infra, nTrials: trials.length };
}

const pct = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "n/a" : (100 * x).toFixed(0) + "%");
const pp = (x: number) => (Number.isFinite(x) ? (x >= 0 ? "+" : "") + (100 * x).toFixed(0) : "n/a");

export function markdown(rep: Report): string {
  const lines: string[] = [];
  lines.push("| Model | Arm | Tasks | Trials | Pass rate [95% CI] | Cost | Cost per success | Skill-open rate | Budget stops | Timeouts |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rep.passRates) lines.push(`| ${r.model} | ${r.arm} | ${r.tasks} | ${r.trials} | ${pct(r.rate)} [${pct(r.lo)}, ${pct(r.hi)}] | $${r.costUsd.toFixed(2)} | ${r.costPerSuccess === null ? "n/a" : "$" + r.costPerSuccess.toFixed(2)} | ${pct(r.skillOpenRate)} | ${r.budgetStops} | ${r.timeouts} |`);
  lines.push("", "| Model | Contrast | Paired tasks | Difference, pp [95% CI] |", "|---|---|---|---|");
  for (const c of rep.contrasts) lines.push(`| ${c.model} | ${c.contrast} | ${c.tasks} | ${pp(c.diff)} [${pp(c.lo)}, ${pp(c.hi)}] |`);
  lines.push("", "| Model | Tasks | Opus none | Model none | Model gstack | Share of Opus gap closed [95% CI] | Resamples with a gap |", "|---|---|---|---|---|---|---|");
  for (const g of rep.gap) lines.push(`| ${g.model} | ${g.tasks} | ${pct(g.opusNone)} | ${pct(g.modelNone)} | ${pct(g.modelGstack)} | ${pct(g.share)} [${pct(g.lo)}, ${pct(g.hi)}] | ${pct(g.definedShare)} |`);
  return lines.join("\n");
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const cfg = JSON.parse(readFileSync(args[0], "utf8")) as { models: string[]; arms: string[]; reference: string; jobs: string[] };
  const trials = loadJobs(cfg.jobs);
  const rep = analyze(trials, cfg);
  console.log(markdown(rep));
  console.log("\n" + JSON.stringify({ skillCounts: rep.skillCounts, infra: rep.infra, nTrials: rep.nTrials }, null, 2));
}
