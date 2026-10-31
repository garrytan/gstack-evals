// Stacks round 1 TB2 contrasts (GST-456, the superseding preregistration's section 8). Per model:
// pstack minus gstack, pstack minus pstack-placebo and gstack minus none, paired by task over per-task
// mean rewards with analyze.ts's task-clustered bootstrap, 10,000 resamples, seed 20261031. Outcome
// rules are analyze.ts's: a trial with no reward after a model response scores 0, with the drop reading
// printed beside it, and a trial no model response reached leaves the denominators. pstack wins a
// model's cell when its interval against gstack lies above zero and, on every model but the reference,
// its interval against pstack-placebo does too. gstack minus none enters no win rule; it is reported
// beside the others. A pair with no paired task is not printed. Idea-card wins (section 7): a task pstack passed at least
// twice and gstack never in a model's cell, beside a null from swapping the two arms' trials within each task at random,
// 10,000 permutations, seed 20261031, with the null's mean and 95th percentile (nearest rank).
// Usage: bun stacks-tb2.ts <config.json>, where the config is analyze.ts's: models, reference, jobs,
// sessions and subsets.
import { readFileSync } from "node:fs";
import { loadJobs, readSessionRows, rng, type Trial } from "./analyze.ts";
import { cellContrast } from "./model-contrast.ts";

export const SEED = 20261031;
export const RESAMPLES = 10_000;
export const PAIRS: [string, string][] = [["pstack", "gstack"], ["pstack", "pstack-placebo"], ["gstack", "none"]];

export function ideaWins(trials: Trial[], model: string) {
  const graded = trials.filter((t) => t.model === model && t.outcome !== "infra");
  const passes = (task: string, arm: string) => graded.filter((t) => t.task === task && t.arm === arm && t.outcome === "pass").length;
  const has = (task: string, arm: string) => graded.some((t) => t.task === task && t.arm === arm);
  const cells = [...new Set(graded.map((t) => t.task))].sort().filter((task) => has(task, "pstack") && has(task, "gstack")).map((task) => ({ task, p: passes(task, "pstack"), g: passes(task, "gstack") }));
  const win = (a: number, b: number) => (a >= 2 && b === 0 ? 1 : 0);
  const r = rng(SEED);
  const draws = Array.from({ length: RESAMPLES }, () => cells.reduce((n, c) => n + (r() < 0.5 ? win(c.g, c.p) : win(c.p, c.g)), 0)).sort((a, b) => a - b);
  const p95 = draws[Math.ceil(0.95 * draws.length) - 1] ?? 0;
  const won = cells.filter((c) => win(c.p, c.g)).map((c) => c.task);
  return { model, tasks: cells.length, wins: won.length, nullMean: draws.reduce((s, x) => s + x, 0) / draws.length, nullP95: p95, aboveNull: won.length > p95, won };
}

export function stacksContrasts(all: Trial[], opts: { models: string[]; reference: string; noReward: "zero" | "drop" }) {
  const trials = opts.noReward === "drop" ? all.filter((t) => !t.noReward) : all;
  const rows = opts.models
    .flatMap((model) => PAIRS.map(([a, b]) => ({ model, contrast: `${a} - ${b}`, ...cellContrast(trials, [model, a], [model, b], { seed: SEED, b: RESAMPLES }) })))
    .filter((r) => r.tasks > 0);
  const above = (model: string, contrast: string) => rows.some((r) => r.model === model && r.contrast === contrast && r.lo > 0);
  const wins = opts.models.map((model) => ({
    model,
    pstackWins: above(model, "pstack - gstack") && (model === opts.reference || above(model, "pstack - pstack-placebo")),
  }));
  return { rows, wins, cards: opts.models.map((model) => ideaWins(trials, model)) };
}

const pp = (x: number) => (Number.isFinite(x) ? (x >= 0 ? "+" : "") + (100 * x).toFixed(0) : "n/a");

export function markdown(rep: ReturnType<typeof stacksContrasts>): string {
  const lines = ["| Model | Contrast | Paired tasks | Difference, pp [95% CI] |", "|---|---|---|---|"];
  for (const r of rep.rows) lines.push(`| ${r.model} | ${r.contrast} | ${r.tasks} | ${pp(r.diff)} [${pp(r.lo)}, ${pp(r.hi)}] |`);
  lines.push("", "| Model | pstack wins the cell |", "|---|---|");
  for (const w of rep.wins) lines.push(`| ${w.model} | ${w.pstackWins ? "yes" : "no"} |`);
  lines.push("", "| Model | Tasks | pstack idea-card wins | Null mean | Null 95th percentile | Above the null | Tasks won |", "|---|---|---|---|---|---|---|");
  for (const c of rep.cards) lines.push(`| ${c.model} | ${c.tasks} | ${c.wins} | ${c.nullMean.toFixed(2)} | ${c.nullP95} | ${c.aboveNull ? "yes" : "no"} | ${c.won.join(", ") || "none"} |`);
  return lines.join("\n");
}

if (import.meta.main) {
  const cfg = JSON.parse(readFileSync(Bun.argv[2], "utf8")) as { models: string[]; reference: string; jobs: string[]; sessions: string[]; subsets?: Record<string, string[]> };
  if (!Array.isArray(cfg.sessions) || !cfg.sessions.length) {
    console.error("E_USAGE stacks-tb2.ts: the config needs sessions, the proxy-sessions.jsonl files of the runs in jobs");
    process.exit(2);
  }
  const trials = loadJobs(cfg.jobs, readSessionRows(cfg.sessions));
  const sets: [string, Trial[]][] = [["all tasks", trials], ...Object.entries(cfg.subsets ?? {}).map(([name, tasks]): [string, Trial[]] => [`subset ${name} (${tasks.length} tasks)`, trials.filter((t) => tasks.includes(t.task))])];
  for (const noReward of ["zero", "drop"] as const) {
    for (const [name, set] of sets) {
      console.log(`\n## ${name}, trials without a reward after a model response ${noReward === "zero" ? "scored 0" : "dropped"}\n`);
      console.log(markdown(stacksContrasts(set, { models: cfg.models, reference: cfg.reference, noReward })));
    }
  }
  const list = (ts: Trial[]) => ts.map((t) => ({ task: t.task, model: t.model, arm: t.arm, trial: t.trialName, reason: t.reason }));
  console.log("\n" + JSON.stringify({ noReward: list(trials.filter((t) => t.noReward)), infra: list(trials.filter((t) => t.outcome === "infra")), nTrials: trials.length }, null, 2));
}
