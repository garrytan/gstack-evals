import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { WORK } from "./config.ts";
import type { SessionResult } from "./session.ts";

export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [NaN, NaN];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

function rng(seed: number) {
  let h = seed >>> 0 || 1;
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
}

export function bootstrapMeanCI(xs: number[], reps = 10000, seed = 20261028): [number, number] {
  if (xs.length === 0) return [NaN, NaN];
  const r = rng(seed);
  const means: number[] = [];
  for (let i = 0; i < reps; i++) {
    let s = 0;
    for (let j = 0; j < xs.length; j++) s += xs[Math.floor(r() * xs.length)]!;
    means.push(s / xs.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(0.025 * reps)]!, means[Math.floor(0.975 * reps)]!];
}

export function signFlipP(ds: number[]): number {
  const xs = ds.filter((d) => d !== 0);
  if (xs.length === 0) return 1;
  if (xs.length > 20) throw new Error("sign-flip: too many tasks for exact enumeration");
  const obs = xs.reduce((a, b) => a + b, 0);
  let le = 0;
  const total = 1 << xs.length;
  for (let mask = 0; mask < total; mask++) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += mask & (1 << i) ? -Math.abs(xs[i]!) : Math.abs(xs[i]!);
    if (s <= obs + 1e-12) le++;
  }
  return le / total;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
};

export function loadResults(root: string): SessionResult[] {
  const out: SessionResult[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name !== "work" && e.name !== "stages" && !e.name.includes(".failed-")) walk(join(d, e.name));
      } else if (e.name === "result.json") out.push(JSON.parse(readFileSync(join(d, e.name), "utf8")));
    }
  };
  walk(root);
  return out;
}

type Key = "pass" | "pass_final";

interface Cell {
  n: number;
  k: number;
  opened: number;
  missing: number;
  runs: boolean[];
}

export function analyze(results: SessionResult[], key: Key = "pass", openedOnly = false, stageStops: Record<string, string[]> = {}) {
  const valid = (r: SessionResult) => r.status === "complete";
  const bySuiteModel = new Map<string, SessionResult[]>();
  for (const r of results) {
    const k = `${r.suite}|${r.model}`;
    if (!bySuiteModel.has(k)) bySuiteModel.set(k, []);
    bySuiteModel.get(k)!.push(r);
  }
  const blocks: any[] = [];
  for (const [k, rs] of [...bySuiteModel.entries()].sort()) {
    const [suite, model] = k.split("|");
    const arms: string[] = [...new Set<string>(rs.map((r) => r.arm))].sort();
    const tasks = [...new Set(rs.map((r) => r.task))];
    const safety = new Set(rs.filter((r) => r.safety).map((r) => r.task));
    const cells: Record<string, Record<string, Cell>> = {};
    for (const t of tasks) {
      cells[t] = {};
      for (const a of arms) {
        const xs = rs.filter((r) => r.task === t && r.arm === a).sort((x, y) => x.trial - y.trial);
        const ok = xs.filter(valid);
        cells[t]![a] = { n: ok.length, k: ok.filter((r) => r[key]).length, opened: ok.filter((r) => r.opened).length, missing: xs.length - ok.length, runs: ok.map((r) => r[key]) };
      }
    }
    const rate = (c?: Cell) => (c && c.n ? c.k / c.n : NaN);
    const skillArms = arms.filter((a) => a !== "none");
    const unopenedTasks = tasks.filter((t) => skillArms.some((a) => cells[t]![a] && cells[t]![a]!.n && cells[t]![a]!.opened / cells[t]![a]!.n < 0.5));
    const useTasks = openedOnly ? tasks.filter((t) => !unopenedTasks.includes(t)) : tasks;
    const trialsPlanned = Math.max(0, ...tasks.flatMap((t) => arms.map((a) => cells[t]![a]!.n + cells[t]![a]!.missing)));
    const paired = (t: string) => ["before", "after"].every((a) => (cells[t]![a]?.n ?? 0) >= 2);
    const informative = useTasks.filter((t) => {
      if (!paired(t)) return false;
      const all = arms.flatMap((a) => cells[t]![a]!.runs);
      return all.some(Boolean) && !all.every(Boolean);
    });
    const unpaired = useTasks.filter((t) => !paired(t));
    const short = useTasks.filter((t) => paired(t) && ["before", "after"].some((a) => (cells[t]![a]?.n ?? 0) < trialsPlanned));
    const incomplete: string[] = [...(stageStops[suite!] ?? [])];
    if (!arms.includes("after") || !arms.includes("before")) incomplete.push("NO_PAIRED_ARMS");
    else if (unpaired.length) incomplete.push(`UNPAIRED ${unpaired.join(",")}`);
    const pooled: Record<string, any> = {};
    for (const a of arms) {
      const n = useTasks.reduce((s, t) => s + cells[t]![a]!.n, 0);
      const kk = useTasks.reduce((s, t) => s + cells[t]![a]!.k, 0);
      const op = useTasks.reduce((s, t) => s + cells[t]![a]!.opened, 0);
      const ms = useTasks.reduce((s, t) => s + cells[t]![a]!.missing, 0);
      pooled[a] = { n, k: kk, rate: n ? kk / n : NaN, ci95: wilson(kk, n), opened_rate: n ? op / n : NaN, missing: ms };
    }
    const diff = (a: string, b: string) => {
      if (!arms.includes(a) || !arms.includes(b)) return null;
      const ds = useTasks.map((t) => rate(cells[t]![a]) - rate(cells[t]![b])).filter((d) => !Number.isNaN(d));
      return { mean_pp: 100 * mean(ds), ci95_pp: bootstrapMeanCI(ds).map((x) => 100 * x), tasks: ds.length, per_task: Object.fromEntries(useTasks.map((t) => [t, rate(cells[t]![a]) - rate(cells[t]![b])])) };
    };
    const reasons: string[] = [];
    const warnings: string[] = short.length ? [`MISSING_CELLS ${short.join(",")}`] : [];
    for (const t of useTasks) {
      const b = cells[t]!.before;
      const af = cells[t]!.after;
      if (b && af && b.n >= 3 && af.n >= 3 && b.k / b.n >= 2 / 3 && af.k / af.n < 2 / 3) reasons.push(`REGRESSION ${t}`);
      if (safety.has(t) && af && af.k < af.n) reasons.push(`SAFETY ${t}`);
      if (arms.every((a) => cells[t]![a]!.n && cells[t]![a]!.k === 0)) warnings.push(`UNCOVERED ${t}`);
      const old = ["before", "before2"].filter((a) => cells[t]![a]).map((a) => cells[t]![a]!);
      const oldN = old.reduce((s, c) => s + c.n, 0);
      const oldK = old.reduce((s, c) => s + c.k, 0);
      if (af && oldN && af.n && oldK / oldN >= 0.8 && af.k / af.n <= 1 / 3) reasons.push(`MISS ${t}`);
    }
    const pb = pooled.before;
    const pa = pooled.after;
    if (pb && pa && pb.n && pa.n) {
      const se = Math.sqrt((pb.rate * (1 - pb.rate)) / pb.n + (pa.rate * (1 - pa.rate)) / pa.n);
      if (pb.rate - pa.rate > 2 * se && se > 0) reasons.push("WORSE");
    }
    const oldRate = (t: string) => {
      const old = ["before", "before2"].filter((a) => cells[t]![a]).map((a) => cells[t]![a]!);
      const n = old.reduce((s, c) => s + c.n, 0);
      return n ? old.reduce((s, c) => s + c.k, 0) / n : NaN;
    };
    const signDs = informative.map((t) => rate(cells[t]!.after) - oldRate(t)).filter((d) => !Number.isNaN(d));
    const signP = arms.includes("after") ? signFlipP(signDs) : NaN;
    if (signP < 0.05) reasons.push("WORSE_SIGNFLIP");
    if (pa && pb && pa.opened_rate < 0.5 && pb.opened_rate >= 0.5) reasons.push("UNOPENED");
    for (const a of skillArms) if (pooled[a] && pooled[a].opened_rate < 0.5) warnings.push(`OPENED_LOW ${a} ${pooled[a].opened_rate.toFixed(2)}`);
    if (unopenedTasks.length) warnings.push(`UNOPENED_TASKS ${unopenedTasks.join(",")}`);
    const cost: Record<string, any> = {};
    for (const a of arms) {
      const xs = rs.filter((r) => r.arm === a && valid(r));
      cost[a] = {
        sessions: xs.length,
        mean_usd: mean(xs.map((r) => r.cost_usd)),
        total_usd: xs.reduce((s, r) => s + r.cost_usd, 0),
        median_input_tokens: median(xs.map((r) => r.usage.input + r.usage.cacheRead + r.usage.cacheWrite5m + r.usage.cacheWrite1h)),
        mean_input_tokens: mean(xs.map((r) => r.usage.input + r.usage.cacheRead + r.usage.cacheWrite5m + r.usage.cacheWrite1h)),
        mean_output_tokens: mean(xs.map((r) => r.usage.output)),
        mean_cache_write_tokens: mean(xs.map((r) => r.usage.cacheWrite5m + r.usage.cacheWrite1h)),
        mean_requests: mean(xs.map((r) => r.requests)),
        mean_loaded_bytes_unique: mean(xs.map((r) => r.loaded_bytes_unique)),
        median_loaded_bytes_unique: median(xs.map((r) => r.loaded_bytes_unique)),
        mean_loaded_bytes_opened: mean(xs.filter((r) => r.opened).map((r) => r.loaded_bytes_unique)),
        budget_hits: xs.filter((r) => r.budget_hit).length,
        timeouts: rs.filter((r) => r.arm === a && r.status === "timeout").length,
        infra_errors: rs.filter((r) => r.arm === a && r.status === "infra_error").length,
        mean_wall_s: mean(xs.map((r) => r.wall_ms / 1000)),
      };
    }
    blocks.push({
      suite,
      model,
      grading: key,
      opened_only: openedOnly,
      verdict: reasons.length ? "FAIL" : incomplete.length ? "INCOMPLETE" : informative.length < 5 ? "NOT_MEASURABLE" : "PASS",
      reasons,
      incomplete,
      trials_planned: trialsPlanned,
      warnings,
      informative_tasks: informative.length,
      tasks: useTasks.length,
      sign_flip_p: signP,
      pooled,
      after_minus_before: diff("after", "before"),
      before2_minus_before: diff("before2", "before"),
      none_minus_before: diff("none", "before"),
      cells: Object.fromEntries(useTasks.map((t) => [t, Object.fromEntries(arms.map((a) => [a, { k: cells[t]![a]!.k, n: cells[t]![a]!.n, opened: cells[t]![a]!.opened, missing: cells[t]![a]!.missing }]))])),
      safety_tasks: [...safety],
      cost,
    });
  }
  return blocks;
}

const pct = (x: number) => (Number.isNaN(x) ? "-" : `${(100 * x).toFixed(0)}%`);
const pp = (x: number) => (Number.isNaN(x) ? "-" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}`);

export function markdown(blocks: any[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    const arms = Object.keys(b.pooled);
    lines.push(`### ${b.suite} on ${b.model} (${b.grading}${b.opened_only ? ", opened-only" : ""})`, "");
    lines.push(`Verdict: ${b.verdict}${b.reasons.length ? ` (${b.reasons.join("; ")})` : ""}${b.incomplete.length ? ` [${b.incomplete.join("; ")}]` : ""}. Informative tasks: ${b.informative_tasks} of ${b.tasks}. Sign-flip p: ${Number.isNaN(b.sign_flip_p) ? "-" : b.sign_flip_p.toFixed(3)}.${b.warnings.length ? ` Warnings: ${b.warnings.join("; ")}.` : ""}`, "");
    lines.push(`| task | ${arms.join(" | ")} |`, `|---|${arms.map(() => "---").join("|")}|`);
    for (const [t, row] of Object.entries<any>(b.cells)) lines.push(`| ${t}${b.safety_tasks.includes(t) ? " (safety)" : ""} | ${arms.map((a) => `${row[a].k}/${row[a].n}${row[a].opened < row[a].n && a !== "none" ? ` (opened ${row[a].opened})` : ""}${row[a].missing ? ` (+${row[a].missing} missing)` : ""}`).join(" | ")} |`);
    lines.push(`| pooled | ${arms.map((a) => `${pct(b.pooled[a].rate)} [${pct(b.pooled[a].ci95[0])}, ${pct(b.pooled[a].ci95[1])}]`).join(" | ")} |`, "");
    for (const [name, d] of [["after - before", b.after_minus_before], ["before2 - before (noise floor)", b.before2_minus_before], ["none - before", b.none_minus_before]] as const)
      if (d) lines.push(`- ${name}: ${pp(d.mean_pp)} pp, 95% CI [${pp(d.ci95_pp[0])}, ${pp(d.ci95_pp[1])}] over ${d.tasks} tasks`);
    lines.push("", `| arm | sessions | mean $ | median input tok | mean output tok | mean loaded skill bytes (opened runs) | timeouts | budget hits |`, "|---|---|---|---|---|---|---|---|");
    for (const a of arms) {
      const c = b.cost[a];
      lines.push(`| ${a} | ${c.sessions} | ${c.mean_usd.toFixed(4)} | ${Math.round(c.median_input_tokens)} | ${Math.round(c.mean_output_tokens)} | ${Number.isNaN(c.mean_loaded_bytes_opened) ? "-" : Math.round(c.mean_loaded_bytes_opened)} | ${c.timeouts} | ${c.budget_hits} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: { out: { type: "string" }, dest: { type: "string" } } });
  const root = values.out ?? join(WORK, "runs");
  const results = loadResults(root);
  const stageStops: Record<string, string[]> = {};
  const stageSuite: Record<string, string> = { S0: "learn", S1: "office-hours", S2: "office-hours", S3: "learn" };
  const stagesDir = join(root, "stages");
  if (existsSync(stagesDir))
    for (const f of readdirSync(stagesDir)) {
      const st = JSON.parse(readFileSync(join(stagesDir, f), "utf8"));
      const label = st.cap_stop ? `CAP_STOP ${st.stage}` : st.finished < st.planned ? `UNFINISHED ${st.stage} ${st.finished}/${st.planned}` : null;
      if (label) (stageStops[stageSuite[st.stage] ?? "?"] ??= []).push(label);
    }
  const verdict = {
    generated: new Date().toISOString(),
    sessions: results.length,
    stage_stops: stageStops,
    primary: analyze(results, "pass", false, stageStops),
    final_answer_grading: analyze(results, "pass_final", false, stageStops),
    opened_only: analyze(results, "pass", true, stageStops),
  };
  const dest = values.dest ?? root;
  writeFileSync(join(dest, "verdict.json"), JSON.stringify(verdict, null, 2) + "\n");
  const md = ["## Primary (must over the transcript)", "", markdown(verdict.primary), "## Final-answer grading", "", markdown(verdict.final_answer_grading), "## Opened-only", "", markdown(verdict.opened_only)].join("\n");
  writeFileSync(join(dest, "verdict.md"), md);
  console.log(md);
}
