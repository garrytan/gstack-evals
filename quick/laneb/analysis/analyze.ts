// Analysis for the Lane B quick look. Reads Harbor job directories and the metering proxy's
// session rows, classifies each trial, and reports pass rates with task-clustered bootstrap
// intervals, paired arm differences, cost per success, share of the Opus gap closed, and
// skill-open rates.
//
// Outcome rules (preregistration, stop rule and "Changes after the first paid call"):
// - a trial with a verifier reward is graded on it;
// - a trial without a reward in which a model response reached the agent is paid and scores 0
//   (noReward), whatever the error: agent error, verifier timeout, missing reward file;
// - a trial in which no model response reached the agent is infra and leaves the denominators.
// Cost comes from the proxy's session rows (proxy-sessions.jsonl), never from files the agent
// could write; a trial with no session row has an unknown cost, reported as missing, not $0.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type Trial = {
  task: string;
  arm: string;
  model: string;
  trialName: string;
  outcome: "pass" | "fail" | "infra";
  reason: string;
  noReward: boolean;
  modelResponded: boolean;
  costUsd: number | null;
  attempts: number;
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

export type SessionRow = { id: string; trial: string; spent_micros: number; ok_responses: number; requests: number; refused: number; refused_budget: number; opened_at: string; closed_at?: string };

// Session rows grouped by Harbor trial name, oldest first, one row per session id. The agent opens each
// session with the environment's session id, which is the trial name plus "__env"; a retried trial
// keeps its name, so it can have several rows.
export function sessionsByTrial(rows: SessionRow[]): Map<string, SessionRow[]> {
  const byId = new Map<string, SessionRow>();
  for (const r of rows) if (r && typeof r.id === "string" && typeof r.trial === "string") byId.set(r.id, r);
  const out = new Map<string, SessionRow[]>();
  for (const r of byId.values()) {
    const key = r.trial.replace(/__env$/, "");
    out.set(key, [...(out.get(key) ?? []), r]);
  }
  for (const list of out.values()) list.sort((a, b) => String(a.opened_at).localeCompare(String(b.opened_at)));
  return out;
}

export function readSessionRows(paths: string[]): SessionRow[] {
  return paths.flatMap((p) => readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as SessionRow));
}

// Evaluator evidence lives in evaluator/ beside agent/. Runs before the fix PR wrote it into agent/,
// which the agent under test can rewrite; those trials are read from there and flagged.
function evidencePath(dir: string, name: string): { path: string; fromAgentDir: boolean } {
  const trusted = join(dir, "evaluator", name);
  if (existsSync(join(dir, "evaluator"))) return { path: trusted, fromAgentDir: false };
  return { path: join(dir, "agent", name), fromAgentDir: true };
}

const assistantMessages = (lines: string[]) => lines.filter((l) => {
  try { return JSON.parse(l).type === "AssistantMessage"; } catch { return false; }
}).length;

// Map a Harbor trial directory to a Trial. The arm and model come from the trial's
// agent config, the task from its task path, money and model responses from the session rows.
export function loadTrial(dir: string, sessions: Map<string, SessionRow[]> = new Map()): Trial | null {
  const result = readJson(join(dir, "result.json"));
  const config = readJson(join(dir, "config.json"));
  if (!result || !config) return null;
  const kwargs = config.agent?.kwargs ?? {};
  const task = String(config.task?.path ?? result.task_name ?? "").split("/").filter(Boolean).at(-1) ?? "?";
  const trialName = String(result.trial_name ?? dir.split("/").filter(Boolean).at(-1));
  const summary = readJson(evidencePath(dir, "laneb-summary.json").path);
  const msgs = evidencePath(dir, "sdk-messages.jsonl");
  const msgLines = existsSync(msgs.path) ? readFileSync(msgs.path, "utf8").split("\n") : [];
  const skillOpens = skillOpensFromMessages(msgLines);
  const exc = result.exception_info?.exception_type ?? null;
  const excMsg = String(result.exception_info?.exception_message ?? "");
  const rewards = result.verifier_result?.rewards ?? null;
  const rawReward = rewards ? Number(rewards.reward ?? Object.values(rewards)[0]) : NaN;
  const reward = Number.isFinite(rawReward) ? rawReward : null;
  const rows = sessions.get(trialName) ?? [];
  const last = rows.at(-1);
  // Without a session row, the SDK log is the only record that a model response arrived.
  const modelResponded = last ? (last.ok_responses ?? 0) > 0 : assistantMessages(msgLines) > 0;
  const budgetStop = (last?.refused_budget ?? 0) > 0;
  const agentTimeout = exc === "AgentTimeoutError";
  let outcome: Trial["outcome"];
  let reason: string;
  let noReward = false;
  if (reward !== null) {
    outcome = reward >= 1 ? "pass" : "fail";
    reason = agentTimeout ? "agent timeout, graded" : budgetStop ? "session budget stop, graded" : exc ? `${exc}, graded` : "graded";
  } else if (modelResponded) {
    outcome = "fail";
    noReward = true;
    reason = `${exc ?? "no verifier reward"}, no reward after a model response, scored 0`;
  } else {
    outcome = "infra";
    reason = exc ? `${exc}: ${excMsg.slice(0, 160)}` : "no verifier reward and no model response";
  }
  if (msgs.fromAgentDir && msgLines.length) reason += " (evidence read from agent/)";
  return {
    task,
    arm: String(kwargs.arm ?? "?"),
    model: String(kwargs.upstream_model ?? config.agent?.model_name ?? "?"),
    trialName,
    outcome,
    reason,
    noReward,
    modelResponded,
    costUsd: rows.length ? rows.reduce((x, r) => x + (r.spent_micros ?? 0), 0) / 1e6 : null,
    attempts: rows.length,
    requests: last?.requests ?? 0,
    refused: last?.refused ?? 0,
    skillOpens,
    budgetStop,
    agentTimeout,
    wallS: summary?.wall_s ?? null,
  };
}

export function loadJobs(jobDirs: string[], sessionRows: SessionRow[] = []): Trial[] {
  const sessions = sessionsByTrial(sessionRows);
  const out: Trial[] = [];
  for (const job of jobDirs) {
    for (const name of readdirSync(job)) {
      const d = join(job, name);
      if (!statSync(d).isDirectory()) continue;
      const t = loadTrial(d, sessions);
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

// noReward: "zero" (preregistered) scores a paid trial without a reward as 0; "drop" removes those
// trials, the sensitivity the preregistration also reports.
export function analyze(all: Trial[], opts: { models: string[]; arms: string[]; reference: string; seed?: number; b?: number; noReward?: "zero" | "drop" }) {
  const { models, arms, reference } = opts;
  const noRewardPolicy = opts.noReward ?? "zero";
  const trials = noRewardPolicy === "drop" ? all.filter((t) => !t.noReward) : all;
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
    const costMissing = graded.filter((t) => t.costUsd === null).length;
    const cost = costMissing ? null : graded.reduce((x, t) => x + (t.costUsd ?? 0), 0);
    const opened = graded.filter((t) => t.skillOpens.length > 0).length;
    return {
      model: m, arm: a, tasks: tasks.length, trials: graded.length, passes, rate: ci.point, lo: ci.lo, hi: ci.hi,
      costUsd: cost, costMissing, costPerSuccess: passes && cost !== null ? cost / passes : null,
      noReward: graded.filter((t) => t.noReward).length,
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
  const pairs = [["gstack", "none"], ["gstack", "placebo"], ["placebo", "none"]].filter(([a, b]) => arms.includes(a) && arms.includes(b));
  const contrasts = models.flatMap((m) => pairs.map(([a, b]) => diff(m, a, b)));

  const gap = models.filter((m) => m !== reference && models.includes(reference) && arms.includes("none") && arms.includes("gstack")).map((m) => {
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
  const row = (t: Trial) => ({ task: t.task, arm: t.arm, model: t.model, trial: t.trialName, reason: t.reason });
  const infra = trials.filter((t) => t.outcome === "infra").map(row);
  const noReward = all.filter((t) => t.noReward).map(row);
  const costMissing = trials.filter((t) => t.outcome !== "infra" && t.costUsd === null).map(row);
  return { passRates, contrasts, gap, skillCounts, infra, noReward, noRewardPolicy, costMissing, nTrials: trials.length };
}

const pct = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "n/a" : (100 * x).toFixed(0) + "%");
const pp = (x: number) => (Number.isFinite(x) ? (x >= 0 ? "+" : "") + (100 * x).toFixed(0) : "n/a");

export function markdown(rep: Report): string {
  const lines: string[] = [];
  lines.push("| Model | Arm | Tasks | Trials | Pass rate [95% CI] | Cost | Cost per success | Skill-open rate | Budget stops | Timeouts | No reward, scored 0 |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rep.passRates) lines.push(`| ${r.model} | ${r.arm} | ${r.tasks} | ${r.trials} | ${pct(r.rate)} [${pct(r.lo)}, ${pct(r.hi)}] | ${r.costUsd === null ? `n/a (${r.costMissing} missing)` : "$" + r.costUsd.toFixed(2)} | ${r.costPerSuccess === null ? "n/a" : "$" + r.costPerSuccess.toFixed(2)} | ${pct(r.skillOpenRate)} | ${r.budgetStops} | ${r.timeouts} | ${r.noReward} |`);
  lines.push("", "| Model | Contrast | Paired tasks | Difference, pp [95% CI] |", "|---|---|---|---|");
  for (const c of rep.contrasts) lines.push(`| ${c.model} | ${c.contrast} | ${c.tasks} | ${pp(c.diff)} [${pp(c.lo)}, ${pp(c.hi)}] |`);
  lines.push("", "| Model | Tasks | Opus none | Model none | Model gstack | Share of Opus gap closed [95% CI] | Resamples with a gap |", "|---|---|---|---|---|---|---|");
  for (const g of rep.gap) lines.push(`| ${g.model} | ${g.tasks} | ${pct(g.opusNone)} | ${pct(g.modelNone)} | ${pct(g.modelGstack)} | ${pct(g.share)} [${pct(g.lo)}, ${pct(g.hi)}] | ${pct(g.definedShare)} |`);
  return lines.join("\n");
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const cfg = JSON.parse(readFileSync(args[0], "utf8")) as { models: string[]; arms: string[]; reference: string; jobs: string[]; sessions: string[]; no_reward?: "zero" | "drop"; subsets?: Record<string, string[]> };
  if (!Array.isArray(cfg.sessions) || !cfg.sessions.length) {
    console.error("E_USAGE analyze.ts: the config needs sessions, the proxy-sessions.jsonl files of the runs in jobs; cost comes only from them");
    process.exit(2);
  }
  const trials = loadJobs(cfg.jobs, readSessionRows(cfg.sessions));
  const policy = cfg.no_reward ?? "zero";
  const other = policy === "zero" ? "drop" : "zero";
  const rep = analyze(trials, { ...cfg, noReward: policy });
  console.log(markdown(rep));
  for (const [name, tasks] of Object.entries(cfg.subsets ?? {})) {
    console.log(`\n## Subset: ${name} (${tasks.length} tasks)\n`);
    console.log(markdown(analyze(trials.filter((t) => tasks.includes(t.task)), { ...cfg, noReward: policy })));
  }
  if (rep.noReward.length) {
    console.log(`\n## Sensitivity: ${rep.noReward.length} paid trials without a verifier reward ${other === "drop" ? "dropped" : "scored 0"}\n`);
    console.log(markdown(analyze(trials, { ...cfg, noReward: other })));
  }
  console.log("\n" + JSON.stringify({ skillCounts: rep.skillCounts, infra: rep.infra, noReward: rep.noReward, costMissing: rep.costMissing, nTrials: rep.nTrials }, null, 2));
}
