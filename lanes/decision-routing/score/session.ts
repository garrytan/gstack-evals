// Copyright (c) 2026 Garry Tan. MIT License.
// Session outcomes from Harbor trial directories (prereg section 10). Success is the verifier's reward. The bill is every
// call the proxy journalled for the session's meter, priced from the dated table by its usage fields; a call whose outcome
// is unknown (no usage came back) costs its full reservation, as the controller's meterSpend charges it. Time is the
// session's own clock (first model call to end) from dr-summary.json. Stops (step, wall, allowance) are graded; an
// allowance stop is never a gap. Infrastructure, a Harbor exception, a session that never entered and a session with no
// reward are missing: coverage gaps, never fails.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

export interface Usage { input: number; output: number; reasoning: number; cache_read: number; cache_write: number }
export interface Call { reservation_id: string; provider: string; model: string; status: number | null; usage: Usage; latency_ms: number | null; reserved_micros?: number }
export interface PriceRow { input: number; output: number; cache_read?: number; cache_write?: number; long?: { above_input_tokens: number; input: number; output: number; cache_read?: number; cache_write?: number } }
export interface PriceTable { date: string; models: Record<string, PriceRow> }

export interface SessionOutcome {
  session: string;
  cell: string;
  model: "opus" | "sol";
  task: string;
  repo: string;
  status: "graded" | "missing";
  reason: string | null;
  success: 0 | 1 | null;
  bill_usd: number | null;
  time_ms: number | null;
  exit_status: string | null;
  entered: boolean;
  dir: string;
}

const readJson = (path: string): any => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function loadPrices(path: string): PriceTable {
  const t = JSON.parse(readFileSync(path, "utf8")) as PriceTable & { read_on?: string };
  const date = t.date ?? t.read_on;
  if (typeof date !== "string" || !t.models || typeof t.models !== "object") throw new Error(path + " is not a dated price table {date or read_on, models}");
  return { date, models: t.models };
}

/** Completed calls per meter id, in journal order: each outcome joined to its request's provider and model. An outcome
 *  that is not spent (unknown) carries its request's max_micros as reserved_micros, the charge meterSpend books for it. */
export function readJournal(paths: readonly string[]): Map<string, Call[]> {
  const requests = new Map<string, { provider: string; model: string; max_micros: unknown }>();
  const outcomes: Array<{ meter: string; call: Call; unknown: boolean }> = [];
  for (const path of paths) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      if (r.kind === "request") requests.set(r.reservation_id, { provider: r.provider, model: r.model, max_micros: r.max_micros });
      if (r.kind !== "outcome") continue;
      const u = r.outcome?.usage ?? r.usage ?? {};
      outcomes.push({ meter: r.meter_id, call: { reservation_id: r.reservation_id, provider: "", model: "", status: r.status ?? null, usage: { input: num(u.input), output: num(u.output), reasoning: num(u.reasoning), cache_read: num(u.cache_read), cache_write: num(u.cache_write) }, latency_ms: typeof r.latency_ms === "number" ? r.latency_ms : null }, unknown: r.outcome?.kind !== "spent" });
    }
  }
  const byMeter = new Map<string, Call[]>();
  for (const { meter, call, unknown } of outcomes) {
    const req = requests.get(call.reservation_id);
    if (!req) throw new Error("journal outcome " + call.reservation_id + " has no request line, so its model can't be priced");
    if (unknown && (typeof req.max_micros !== "number" || !Number.isFinite(req.max_micros))) throw new Error("journal outcome " + call.reservation_id + " is unknown and its request line has no max_micros, so its reservation can't be charged");
    const list = byMeter.get(meter) ?? [];
    list.push({ ...call, provider: req.provider, model: req.model, ...(unknown ? { reserved_micros: req.max_micros as number } : {}) });
    byMeter.set(meter, list);
  }
  return byMeter;
}

/** Dollars for one call: fresh input, cache read, cache write, and output plus reasoning at the dated row; an unknown
 *  outcome's full reservation. */
export function callUsd(call: Call, prices: PriceTable): number {
  const key = call.provider + ":" + call.model;
  const row = prices.models[key];
  if (!row) throw new Error("no price row for " + key + " in the dated price table of " + prices.date);
  if (call.reserved_micros !== undefined) return call.reserved_micros / 1e6;
  const u = call.usage;
  const rates = row.long && u.input + u.cache_read + u.cache_write > row.long.above_input_tokens ? row.long : row;
  return (u.input * rates.input + u.cache_read * (rates.cache_read ?? rates.input) + u.cache_write * (rates.cache_write ?? rates.input) + (u.output + u.reasoning) * rates.output) / 1e6;
}

/** The repository of a SWE-bench style task id, owner__repo-number, as owner/repo. */
export function taskRepo(task: string): string {
  const m = /^([A-Za-z0-9_.-]+?)__([A-Za-z0-9_.-]+)-\d+$/.exec(task);
  if (!m) throw new Error("task id " + JSON.stringify(task) + " is not owner__repo-number, so its repository cluster is unknown");
  return m[1] + "/" + m[2];
}

export function readTrial(dir: string, ctx: { calls: Map<string, Call[]>; prices: PriceTable; repoOf?: (task: string) => string }): SessionOutcome {
  const result = readJson(join(dir, "result.json"));
  const summary = readJson(join(dir, "agent", "dr", "dr-summary.json"));
  const task: string | undefined = result?.task_name;
  if (!task) throw new Error(dir + ": result.json names no task_name, so the session can't be paired");
  const entered = existsSync(join(dir, "agent"));
  const rewardFile = join(dir, "verifier", "reward.txt");
  const rawReward = existsSync(rewardFile) ? Number(readFileSync(rewardFile, "utf8").trim()) : result?.verifier_result?.rewards?.reward;
  const reward = typeof rawReward === "number" && Number.isFinite(rawReward) ? rawReward : null;
  const base = { session: summary?.session ?? dir, cell: summary?.cell ?? "?", model: summary?.model, task, repo: (ctx.repoOf ?? taskRepo)(task), exit_status: summary?.exit_status ?? null, entered, dir, time_ms: typeof summary?.session_ms === "number" ? summary.session_ms : null };
  const missing = (reason: string): SessionOutcome => ({ ...base, status: "missing", reason, success: null, bill_usd: null });
  if (!summary) return missing(entered ? "no dr-summary.json" : "did not enter: no agent directory");
  if (summary.exit_status === "infra_error") return missing("infrastructure (infra_error)");
  if (result?.exception_info && summary.exit_status !== "allowance_stop") return missing("Harbor exception " + (result.exception_info.exception_type ?? "unknown"));
  if (reward === null) return missing("no verifier reward");
  const meter = readJson(join(dir, "agent", "dr", "meter.json"))?.meter_id;
  if (typeof meter !== "string") throw new Error(dir + ": graded session has no agent/dr/meter.json meter_id, so its bill can't be read");
  const calls = ctx.calls.get(meter);
  if (!calls?.length) throw new Error(dir + ": meter " + meter + " has no calls in the journals given; pass the journal of its lease");
  if (base.time_ms === null) throw new Error(dir + ": dr-summary.json has no session_ms");
  return { ...base, status: "graded", reason: null, success: reward >= 1 ? 1 : 0, bill_usd: calls.reduce((s, c) => s + callUsd(c, ctx.prices), 0) };
}

export interface Coverage { planned: number; graded: number; share: number; not_entered: number; ok: boolean }

/** Section 10: an endpoint has no outcome when a cell has graded sessions for under 90% of its planned tasks, or over 10% fail to enter. */
export function coverage(sessions: readonly SessionOutcome[], planned: readonly string[]): Coverage {
  const plan = new Set(planned);
  const graded = new Set(sessions.filter((s) => s.status === "graded" && plan.has(s.task)).map((s) => s.task)).size;
  const notEntered = new Set(sessions.filter((s) => !s.entered && plan.has(s.task)).map((s) => s.task)).size;
  const share = graded / planned.length;
  return { planned: planned.length, graded, share, not_entered: notEntered, ok: share >= 0.9 && notEntered / planned.length <= 0.1 };
}

export interface SessionPair { task: string; repo: string; a: SessionOutcome; b: SessionOutcome }

/** Tasks graded in both cells, sorted by task id. */
export function pairOnTasks(a: readonly SessionOutcome[], b: readonly SessionOutcome[]): SessionPair[] {
  const index = (xs: readonly SessionOutcome[]) => {
    const m = new Map<string, SessionOutcome>();
    for (const s of xs) {
      if (s.status !== "graded") continue;
      if (m.has(s.task)) throw new Error("two graded sessions of cell " + s.cell + " on task " + s.task);
      m.set(s.task, s);
    }
    return m;
  };
  const left = index(a), right = index(b);
  return [...left.keys()].filter((t) => right.has(t)).sort().map((task) => ({ task, repo: left.get(task)!.repo, a: left.get(task)!, b: right.get(task)! }));
}

export interface InfraAttempt { trial: string; cell: string; model: string; exit_status: string | null; meter_id: string | null; micros: number }

/** Prereg line 206: the first attempts dr_harbor kept under <job>/dr-infra-attempts/<trial>/attempt.json before Harbor's
 *  one rerun, at most three levels under root. They are never scored; their booked spend stays on the item's lease. */
export function infraAttempts(root: string): InfraAttempt[] {
  const out: InfraAttempt[] = [];
  const walk = (dir: string, depth: number) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const sub = join(dir, e.name);
      if (e.name === "dr-infra-attempts") { for (const t of readdirSync(sub)) { const f = join(sub, t, "attempt.json"); if (existsSync(f)) out.push(JSON.parse(readFileSync(f, "utf8"))); } }
      else if (depth < 3) walk(sub, depth + 1);
    }
  };
  walk(root, 0);
  return out.sort((x, y) => x.trial.localeCompare(y.trial));
}

export interface RerunRow { model: string; cell: string; reruns: number; rerun_graded: number; rerun_missing: number; missing: number }

/** Reruns and missing sessions per creative model and cell. A rerun's outcome is the trial that replaced the kept attempt. */
export function rerunRows(attempts: readonly InfraAttempt[], sessions: readonly SessionOutcome[]): RerunRow[] {
  const rows = new Map<string, RerunRow>();
  const row = (model: string, cell: string) => { const k = model + " " + cell; if (!rows.has(k)) rows.set(k, { model, cell, reruns: 0, rerun_graded: 0, rerun_missing: 0, missing: 0 }); return rows.get(k)!; };
  for (const s of sessions) { const r = row(s.model ?? "?", s.cell); if (s.status === "missing") r.missing++; }
  for (const a of attempts) {
    const r = row(a.model, a.cell);
    r.reruns++;
    const final = sessions.find((s) => basename(s.dir) === a.trial);
    if (final?.status === "graded") r.rerun_graded++; else r.rerun_missing++;
  }
  return [...rows.values()].sort((x, y) => (x.model + x.cell).localeCompare(y.model + y.cell));
}
