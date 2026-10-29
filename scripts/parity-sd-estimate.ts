#!/usr/bin/env bun
// gstack-evals (U15, GSTA-27): the per-task SD of (C+gstack minus F+none) estimated from DeepSWE v1.1's published trials,
// and plan v3.2's decision 9 table and Amendment A2's release-split table at that estimate. No model calls.
// docs/benchmarks/2026-11-parity-sd-estimate/README.md is the note. This script writes its counts.json, results.json and
// the block between the README's markers; --check compares instead of writing and exits 1 on any byte that differs.
//
//   bun scripts/parity-sd-estimate.ts fetch <out>                   download the recorded trials file, refuse another sha256
//   bun scripts/parity-sd-estimate.ts build <trials.json> [--check] check the sha256, derive counts.json, then report
//   bun scripts/parity-sd-estimate.ts report [--check]              counts.json to results.json and the README block
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CODES } from "../src/errors/codes.ts";
import { seededRandom } from "../src/runner/stats/paired.ts";
import { codeLines } from "../src/skill-eval/contract/cli-io.ts";
import {
  coveredSd, DECISION_9_DESIGNS, decision9Table, PARITY_EFFECT, parityDesign, RELEASE_OPTIONS, releaseSplitTable, taskDiffSd,
} from "../src/runner/stats/sizing.ts";

export const DIR = join(import.meta.dir, "..", "docs", "benchmarks", "2026-11-parity-sd-estimate");
export const PATHS = { source: join(DIR, "source.json"), counts: join(DIR, "counts.json"), results: join(DIR, "results.json"), note: join(DIR, "README.md") };

/** Plan v3.2's trials per task: 5 in a cheap-rung cell, 3 in an Opus cell. */
export const TRIALS = { cheap: 5, frontier: 3 };
export const CEILING = 213;
export const BOOTSTRAP = { seed: 20261029, draws: 10000 };

/** The board's top four configurations (72.7% to 74.1% pass@1; the fifth is 69.9%). The first stands in for Opus 5.5. */
export const FRONTIER = ["claude-opus-5 [max]", "gpt-6-astra [xhigh]", "gemini-3-8-flash [high]", "gpt-5-6-sol [max]"];

/** Each cheap rung of the ladder with its DeepSWE stand-in and an alternate, each at the effort the board ranks best. */
export const RUNGS = [
  { rung: "Haiku 5.5", proxy: "gpt-5-6-luna [max]", alternate: "gpt-5-6-terra [max]" },
  { rung: "DeepSeek V4.1 Flash", proxy: "deepseek-v4-flash [max]", alternate: "deepseek-v4-pro [max]" },
  { rung: "GLM 5.3 Flash", proxy: "glm-5-3-flash [max]", alternate: "glm-5-3 [max]" },
];

/** Claude Opus 5 at adjacent efforts: how far one model's per-task rates move when only its configuration changes. */
export const EFFORT_STEPS: Array<[string, string]> = [["claude-opus-5 [high]", "claude-opus-5 [xhigh]"], ["claude-opus-5 [xhigh]", "claude-opus-5 [max]"]];

/** What-if SDs of gstack's own lift across tasks, which DeepSWE cannot show. */
export const GSTACK_SPREADS = [0.1, 0.2];

export const CONFIGS = [...FRONTIER, ...RUNGS.flatMap((r) => [r.proxy, r.alternate]), "claude-opus-5 [high]", "claude-opus-5 [xhigh]"];

const RULE = "Scored trials only (included_in_score true); a pass is passed true. Each cell is [passes, scored trials], in configs order.";

const OPTION_NAMES: Record<string, string> = {
  "v3.2": "v3.2 as written",
  A: "A, a bigger share (0.03)",
  B: "B, its own tranche (the tranche alone)",
  C: "C, four frozen releases (0.0125)",
  "C-steer": "C, if releases steer (0.05/15)",
};
const DESIGN_NAMES: Record<string, string> = {
  "three-models": "Three cheap models, 90% power",
  "one-primary": "One primary model, 90% power",
  "one-primary-80": "One primary model, 80% power",
};

export interface Source { url: string; retrieved: string; sha256: string; bytes: number; last_modified: string; etag: string; scope: string; n_trials: number; licence: string }
export interface TrialRow { task_name: string; model: string; reasoning_effort: string | null; included_in_score: boolean; passed: boolean }
export interface Counts { source_sha256: string; rule: string; configs: string[]; tasks: Record<string, Array<[number, number]>> }

export const configLabel = (r: Pick<TrialRow, "model" | "reasoning_effort">) => r.model + " [" + (r.reasoning_effort ?? "default") + "]";
export const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** Per task, each config's passes and scored trials. Every task in the file gets a row; a config with no scored trial is refused. */
export function extractCounts(rows: readonly TrialRow[], sourceSha256: string, configs: readonly string[] = CONFIGS): Counts {
  const index = new Map(configs.map((c, i) => [c, i]));
  const tasks: Record<string, Array<[number, number]>> = {};
  for (const name of [...new Set(rows.map((r) => r.task_name))].sort()) tasks[name] = configs.map(() => [0, 0]);
  const seen = new Set<string>();
  for (const r of rows) {
    const i = index.get(configLabel(r));
    if (i === undefined || !r.included_in_score) continue;
    seen.add(configs[i]!);
    const cell = tasks[r.task_name]![i]!;
    cell[1] += 1;
    if (r.passed) cell[0] += 1;
  }
  const missing = configs.filter((c) => !seen.has(c));
  if (missing.length) throw new Error("no scored trials for " + missing.join(", "));
  return { source_sha256: sourceSha256, rule: RULE, configs: [...configs], tasks };
}

export function countsJson(c: Counts): string {
  const lines = Object.entries(c.tasks).map(([t, cells]) => "    " + JSON.stringify(t) + ": " + JSON.stringify(cells));
  return "{\n  \"source_sha256\": " + JSON.stringify(c.source_sha256) + ",\n  \"rule\": " + JSON.stringify(c.rule) + ",\n  \"configs\": " +
    JSON.stringify(c.configs) + ",\n  \"tasks\": {\n" + lines.join(",\n") + "\n  }\n}\n";
}

/** One pair's per-task terms, aligned with the task list; a task with fewer than 2 scored trials in either cell is invalid. */
interface PairTerms { valid: boolean[]; d: number[]; noise: number[]; wc: number[]; wf: number[]; pc: number[]; pf: number[] }

export function pairTerms(counts: Counts, cheap: string, frontier: string): PairTerms {
  const ci = counts.configs.indexOf(cheap), fi = counts.configs.indexOf(frontier);
  if (ci < 0 || fi < 0) throw new Error("counts.json has no column for " + (ci < 0 ? cheap : frontier));
  const t: PairTerms = { valid: [], d: [], noise: [], wc: [], wf: [], pc: [], pf: [] };
  for (const cells of Object.values(counts.tasks)) {
    const [a, n] = cells[ci]!, [b, m] = cells[fi]!;
    const ok = n >= 2 && m >= 2;
    const p = ok ? a / n : 0, q = ok ? b / m : 0;
    t.valid.push(ok);
    t.d.push(p - q);
    t.noise.push(ok ? p * (1 - p) / (n - 1) + q * (1 - q) / (m - 1) : 0);
    t.wc.push(ok ? p * (1 - p) * n / (n - 1) : 0);
    t.wf.push(ok ? q * (1 - q) * m / (m - 1) : 0);
    t.pc.push(p);
    t.pf.push(q);
  }
  return t;
}

/**
 * Method of moments over the tasks in idx (repeats allowed). The sample variance of the observed differences, minus the
 * mean unbiased trial-noise term p(1-p)/(n-1) + q(1-q)/(m-1), is the between-task variance of the true difference, floored
 * at 0. wc and wf are unbiased means of each arm's per-task p(1-p), which the plan's formula divides by the trial counts.
 */
export interface Moments { tasks: number; gap: number; between: number; wc: number; wf: number; pc: number; pf: number }

export function moments(t: PairTerms, idx: readonly number[]): Moments {
  let n = 0, sd = 0, sn = 0, swc = 0, swf = 0, spc = 0, spf = 0;
  for (const i of idx) {
    if (!t.valid[i]) continue;
    n++; sd += t.d[i]!; sn += t.noise[i]!; swc += t.wc[i]!; swf += t.wf[i]!; spc += t.pc[i]!; spf += t.pf[i]!;
  }
  if (n < 2) throw new Error("a pair needs at least 2 tasks with 2 or more scored trials in both arms");
  const gap = sd / n;
  let ss = 0;
  for (const i of idx) if (t.valid[i]) ss += (t.d[i]! - gap) ** 2;
  return { tasks: n, gap, between: Math.max(0, ss / (n - 1) - sn / n), wc: swc / n, wf: swf / n, pc: spc / n, pf: spf / n };
}

/** The plan's per-task variance of (C minus F) task means, p(1-p) read per task: between + mean p(1-p)/5 + mean q(1-q)/3. */
export const pairVariance = (m: Moments, trials = TRIALS) => m.between + m.wc / trials.cheap + m.wf / trials.frontier;

const rms = (variances: readonly number[]) => Math.sqrt(variances.reduce((s, v) => s + v, 0) / variances.length);
// Every SD is rounded once, to 3 decimals, and the gap once, to a tenth of a point; the tables and the text use those values.
const r3 = (x: number) => Number(x.toFixed(3));
const f3 = (x: number) => x.toFixed(3);
const interval = (sorted: readonly number[]): [number, number] => [sorted[Math.floor(sorted.length * 0.025)]!, sorted[Math.ceil(sorted.length * 0.975) - 1]!];
type Fit = "fits" | "does not fit" | "changes";
const fit = (covered: number, lo: number, hi: number): Fit => (covered >= hi ? "fits" : covered < lo ? "does not fit" : "changes");

export function analyse(counts: Counts) {
  const nTasks = Object.keys(counts.tasks).length;
  const all = Array.from({ length: nTasks }, (_, i) => i);
  const head = FRONTIER[0]!;
  const ladderTerms = RUNGS.map((r) => pairTerms(counts, r.proxy, head));
  const ladderMoments = ladderTerms.map((t) => moments(t, all));
  const ladderVar = ladderMoments.map((m) => pairVariance(m));

  const rng = seededRandom(BOOTSTRAP.seed);
  const boot = { pooled: [] as number[], pairs: ladderTerms.map(() => [] as number[]) };
  for (let b = 0; b < BOOTSTRAP.draws; b++) {
    const idx = Array.from({ length: nTasks }, () => Math.floor(rng() * nTasks));
    const v = ladderTerms.map((t) => pairVariance(moments(t, idx)));
    v.forEach((x, i) => boot.pairs[i]!.push(Math.sqrt(x)));
    boot.pooled.push(rms(v));
  }
  boot.pooled.sort((x, y) => x - y);
  boot.pairs.forEach((p) => p.sort((x, y) => x - y));

  const headline = rms(ladderVar);
  const headlineCi = interval(boot.pooled);
  const grid = RUNGS.flatMap((r) => [r.proxy, r.alternate]).flatMap((cheap) => FRONTIER.map((frontier) => ({ cheap, frontier, sd: Math.sqrt(pairVariance(moments(pairTerms(counts, cheap, frontier), all))) })));
  const low = grid.reduce((a, b) => (b.sd < a.sd ? b : a));
  const high = grid.reduce((a, b) => (b.sd > a.sd ? b : a));
  const sds = [low.sd, headlineCi[0], headline, headlineCi[1], high.sd].map(r3);
  const [sLo, bLo, h, bHi, sHi] = sds as [number, number, number, number, number];

  return {
    tasks: nTasks,
    ladder: RUNGS.map((r, i) => {
      const m = ladderMoments[i]!;
      return { rung: r.rung, proxy: r.proxy, frontier: head, tasks: m.tasks, gap_points: Number((m.gap * 100).toFixed(1)), between_sd: r3(Math.sqrt(m.between)), sd: r3(Math.sqrt(ladderVar[i]!)), ci95: interval(boot.pairs[i]!).map(r3) };
    }),
    headline: { sd: r3(headline), ci95: headlineCi.map(r3) },
    grid: grid.map((g) => ({ ...g, sd: r3(g.sd) })),
    sensitivity: { low: { ...low, sd: r3(low.sd) }, high: { ...high, sd: r3(high.sd) } },
    aggregate_rate_sd: r3(rms(ladderMoments.map((m) => taskDiffSd(Math.sqrt(m.between), [{ rate: m.pc, trials: TRIALS.cheap }, { rate: m.pf, trials: TRIALS.frontier }]) ** 2))),
    opus_five_trials_sd: r3(rms(ladderMoments.map((m) => pairVariance(m, { cheap: TRIALS.cheap, frontier: 5 })))),
    effort_steps: EFFORT_STEPS.map(([from, to]) => ({ from, to, between_sd: r3(Math.sqrt(moments(pairTerms(counts, from, to), all).between)) })),
    gstack_spread: GSTACK_SPREADS.map((spread) => ({ spread, sd: r3(Math.sqrt(headline ** 2 + spread ** 2)) })),
    table_sds: sds,
    fits: RELEASE_OPTIONS.flatMap((o) => DECISION_9_DESIGNS.map((d) => {
      const covered = coveredSd(CEILING, PARITY_EFFECT, parityDesign(d, o.parity_alpha));
      return { option: o.id, design: d.id, covered_sd: r3(covered), at_estimate: covered >= h ? "fits" : "does not fit", bootstrap: fit(covered, bLo, bHi), sensitivity: fit(covered, sLo, sHi) };
    })),
  };
}

export type Results = ReturnType<typeof analyse>;

/** results.json for U17: one top-level field per line, and one line per element of a list. */
export function resultsJson(source: Source, r: Results): string {
  const doc: Record<string, unknown> = { source, trials: TRIALS, bootstrap: BOOTSTRAP, ceiling: CEILING, ...r };
  const field = ([k, v]: [string, unknown]) => "  " + JSON.stringify(k) + ": " + (Array.isArray(v) ? "[\n" + v.map((e) => "    " + JSON.stringify(e)).join(",\n") + "\n  ]" : JSON.stringify(v));
  return "{\n" + Object.entries(doc).map(field).join(",\n") + "\n}\n";
}

export const MARKERS = { start: "<!-- parity-sd-estimate:start (bun scripts/parity-sd-estimate.ts report writes this block; do not edit by hand) -->", end: "<!-- parity-sd-estimate:end -->" };

export function renderBlock(r: Results): string {
  const [sLo, bLo, h, bHi, sHi] = r.table_sds as [number, number, number, number, number];
  const { low, high } = r.sensitivity;
  const rowName = (f: Results["fits"][number]) => OPTION_NAMES[f.option] + ", " + DESIGN_NAMES[f.design]!.toLowerCase();
  const fitsAt = r.fits.filter((f) => f.at_estimate === "fits");
  const changeList = (key: "bootstrap" | "sensitivity") => {
    const rows = r.fits.filter((f) => f[key] === "changes");
    return rows.length ? rows.map((f) => "- " + rowName(f) + ": fits up to SD " + f3(f.covered_sd) + ".").join("\n") : "- None.";
  };
  const out = [
    MARKERS.start,
    "",
    "**Estimate.** The per-task SD of (C+gstack minus F+none) at " + TRIALS.cheap + " cheap-rung and " + TRIALS.frontier + " Opus trials is **" + f3(r.headline.sd) + "** (95% task-bootstrap interval " +
      f3(r.headline.ci95[0]!) + " to " + f3(r.headline.ci95[1]!) + "), pooled over the three cheap rungs' stand-ins against " + r.ladder[0]!.frontier + " on " + r.tasks + " DeepSWE v1.1 tasks. Across the " +
      r.grid.length + " stand-in pairs it runs from " + f3(low.sd) + " (" + low.cheap + " against " + low.frontier + ") to " + f3(high.sd) + " (" + high.cheap + " against " + high.frontier + ").",
    "",
    "| Rung | DeepSWE stand-in | Tasks | Gap to " + r.ladder[0]!.frontier + " (points) | Between-task SD | SD at " + TRIALS.cheap + " and " + TRIALS.frontier + " trials | 95% bootstrap interval |",
    "|---|---|---|---|---|---|---|",
    ...r.ladder.map((l) => "| " + l.rung + " | " + l.proxy + " | " + l.tasks + " | " + l.gap_points.toFixed(1) + " | " + f3(l.between_sd) + " | " + f3(l.sd) + " | " + f3(l.ci95[0]!) + " to " + f3(l.ci95[1]!) + " |"),
    "| Pooled (root mean square) | | | | | " + f3(r.headline.sd) + " | " + f3(r.headline.ci95[0]!) + " to " + f3(r.headline.ci95[1]!) + " |",
    "",
    "The sensitivity grid: the SD at " + TRIALS.cheap + " and " + TRIALS.frontier + " trials for every pair of a cheap stand-in or its alternate (rows) and a top-four configuration (columns).",
    "",
    "| Cheap stand-in | " + FRONTIER.join(" | ") + " |",
    "|---|" + FRONTIER.map(() => "---|").join(""),
    ...RUNGS.flatMap((x) => [x.proxy, x.alternate]).map((c) => "| " + c + " | " + FRONTIER.map((f) => f3(r.grid.find((g) => g.cheap === c && g.frontier === f)!.sd)).join(" | ") + " |"),
    "",
    "- Plugging each arm's overall pass rate into p(1-p), as \u0060taskDiffSd\u0060 does with one rate per arm, would give " + f3(r.aggregate_rate_sd) + " for the pooled estimate instead of " + f3(r.headline.sd) + ".",
    "- With 5 Opus trials instead of 3, the pooled estimate would be " + f3(r.opus_five_trials_sd) + ".",
    "- When only its effort changes, Claude Opus 5's per-task pass rates move with a between-task SD of " + r.effort_steps.map((e) => f3(e.between_sd) + " (" + e.from.replace(/^.*\[|\]$/g, "") + " to " + e.to.replace(/^.*\[|\]$/g, "") + ")").join(" and ") +
      " beyond trial noise. If gstack's lift varied across tasks with an SD of " + r.gstack_spread.map((g) => g.spread.toFixed(2)).join(" or ") + ", independently of the gap, the pooled estimate would be " + r.gstack_spread.map((g) => f3(g.sd)).join(" or ") + ".",
    "",
    "### Decision 9 at the estimate",
    "",
    "Build-fix tasks needed at the low end of the sensitivity range, the low end of the bootstrap interval, the estimate, the high end of the bootstrap interval and the high end of the sensitivity range. Counts round up.",
    "",
    decision9Table(r.table_sds, CEILING),
    "",
    "### Amendment A2 at the estimate",
    "",
    "Each cell gives the tasks needed at SD " + r.table_sds.join(" / ") + ".",
    "",
    releaseSplitTable(r.table_sds),
    "",
    "### Which rows fit under " + CEILING + " tasks",
    "",
    "| Option | Design | SD " + CEILING + " tasks cover | At " + f3(h) + " | Bootstrap " + f3(bLo) + " to " + f3(bHi) + " | Sensitivity " + f3(sLo) + " to " + f3(sHi) + " |",
    "|---|---|---|---|---|---|",
    ...r.fits.map((f) => "| " + OPTION_NAMES[f.option] + " | " + DESIGN_NAMES[f.design] + " | " + f3(f.covered_sd) + " | " + f.at_estimate + " | " + f.bootstrap + " | " + f.sensitivity + " |"),
    "",
    "At the estimate, " + fitsAt.length + " of " + r.fits.length + " rows fit under " + CEILING + " tasks" + (fitsAt.length ? ": " + fitsAt.map(rowName).join("; ") + "." : "."),
    "",
    "Rows that change across the bootstrap interval:",
    "",
    changeList("bootstrap"),
    "",
    "Rows that change across the sensitivity range:",
    "",
    changeList("sensitivity"),
    "",
    MARKERS.end,
  ];
  return out.join("\n");
}

export function readSource(): Source {
  return JSON.parse(readFileSync(PATHS.source, "utf8")) as Source;
}

export function readCounts(): Counts {
  return JSON.parse(readFileSync(PATHS.counts, "utf8")) as Counts;
}

export function spliceBlock(note: string, block: string): string {
  const start = note.indexOf(MARKERS.start), end = note.indexOf(MARKERS.end);
  if (start < 0 || end < start) throw new Error("the README has no generated block markers");
  return note.slice(0, start) + block + note.slice(end + MARKERS.end.length);
}

/** Every file the report owns, as it should be on disk. */
export function reportFiles(source: Source, counts: Counts): Record<string, string> {
  if (counts.source_sha256 !== source.sha256) throw new Error("counts.json was derived from " + counts.source_sha256 + ", but source.json records " + source.sha256);
  const r = analyse(counts);
  return { [PATHS.results]: resultsJson(source, r), [PATHS.note]: spliceBlock(readFileSync(PATHS.note, "utf8"), renderBlock(r)) };
}

type ScriptCode = "E_USAGE" | "E_PARITY_SOURCE" | "E_PARITY_STALE";
const USAGE = "bun scripts/parity-sd-estimate.ts fetch <out> | build <trials.json> [--check] | report [--check]";

function fail(code: ScriptCode, messages: string[], fix: string = CODES[code].fix): never {
  console.error(codeLines(code, messages.map((m) => "parity-sd-estimate: " + m), fix));
  process.exit(CODES[code].exit);
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

function coded<T>(code: ScriptCode, what: string, f: () => T): T {
  try {
    return f();
  } catch (e) {
    return fail(code, [what + ": " + reason(e)]);
  }
}

function settle(files: Record<string, string>, check: boolean): void {
  const stale = Object.entries(files).filter(([path, text]) => {
    let current: string | null = null;
    try { current = readFileSync(path, "utf8"); } catch { /* a missing file is stale */ }
    return current !== text;
  });
  if (!check) {
    for (const [path, text] of Object.entries(files)) writeFileSync(path, text);
    console.log("parity-sd-estimate: wrote " + Object.keys(files).length + " files under " + DIR);
    return;
  }
  if (stale.length) fail("E_PARITY_STALE", stale.map(([path]) => path + " differs from what the script computes"));
  console.log("parity-sd-estimate: " + Object.keys(files).length + " files match byte for byte");
}

function verified(bytes: Uint8Array, source: Source, what: string): void {
  const got = sha256(bytes);
  if (got !== source.sha256) fail("E_PARITY_SOURCE", [what + " has sha256 " + got + ", but source.json records " + source.sha256 + " (" + source.bytes + " bytes, retrieved " + source.retrieved + "); the estimate reproduces only from the recorded file"]);
}

export async function main(argv: string[]): Promise<void> {
  const [cmd, arg] = argv;
  const check = argv.includes("--check");
  const source = coded("E_PARITY_STALE", PATHS.source, readSource);
  if (cmd === "fetch" && arg) {
    const res = await fetch(source.url).catch((e) => fail("E_PARITY_SOURCE", [source.url + ": " + reason(e)]));
    if (!res.ok) fail("E_PARITY_SOURCE", [source.url + " answered HTTP " + res.status]);
    const bytes = new Uint8Array(await res.arrayBuffer());
    verified(bytes, source, source.url + " (Last-Modified " + (res.headers.get("last-modified") ?? "unknown") + ")");
    writeFileSync(arg, bytes);
    console.log("parity-sd-estimate: wrote " + arg + ", sha256 " + source.sha256);
  } else if (cmd === "build" && arg && arg !== "--check") {
    const counts = coded("E_PARITY_SOURCE", arg, () => {
      const bytes = readFileSync(arg);
      verified(bytes, source, arg);
      return extractCounts((JSON.parse(bytes.toString("utf8")) as { rows: TrialRow[] }).rows, source.sha256);
    });
    settle({ [PATHS.counts]: countsJson(counts), ...coded("E_PARITY_STALE", "report", () => reportFiles(source, counts)) }, check);
  } else if (cmd === "report") {
    const counts = coded("E_PARITY_STALE", PATHS.counts, readCounts);
    settle(coded("E_PARITY_STALE", "report", () => reportFiles(source, counts)), check);
  } else {
    fail("E_USAGE", ["unknown command or missing argument: " + (argv.join(" ") || "(none)")], USAGE);
  }
}

if (import.meta.main) await main(process.argv.slice(2));
