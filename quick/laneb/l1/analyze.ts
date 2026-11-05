// L1 analysis: one keyless entry from the per-session table (table.ts, L1SessionRow in src/types.ts) to every endpoint of the
// L1 superseding preregistration (wiki/plans/2026-11-03-geva-254-l1-overhaul-prereg-2000, sections 5, 7 and 8, over #169
// sections 7.5, 7.6, 8 and 9).
//
// Method (#169 8.1, unchanged): per-cluster means over graded sessions, paired over the clusters both arms share; 95%
// percentile intervals from a cluster bootstrap (10,000 resamples, seed 20261102), by task and, beside it, by repository;
// two-sided Monte Carlo sign-flip p on per-task differences (100,000 draws, seed 20261102, p = (k + 1) / (draws + 1)); Holm at
// 0.05 over B1 and B3 per model. The family is fixed at two members: a member that is not run, not admitted or has no outcome
// enters Holm with p = 1. Every MDD is read from the merged power.txt (sha256 pinned below), never recomputed: linear
// interpolation between rows, the nearest end row outside them, and n/r (80% power not reached) as not powered, also between
// an n/r row and its neighbour.
//
// Behavior admission (section 7, pilot): c is the before arm's rate on its pilot sessions and u its Wilson 95% upper bound;
// MDD is the larger of power.txt's MDD@Holm2 at c and at 2%; admit when 1 - u >= 2 x MDD and MDD <= 20 points. Pilot coverage
// under 90% gives no admission and goes to the Captain (#169 8.3).
//
// Verdicts (#169 9 with section 8's changes), per member: KEEP when Holm rejects with the task interval above 0 and the probe
// passed its audit (else FIX-METHOD method); LOSS when Holm rejects with the interval below 0: CUT-CANDIDATE only when the audit
// passed, install exposure held and no contrast arm cap-stopped in over 10% of sessions, else FIX-METHOD (method, exposure,
// harness limit: the first that fails). A KEEP or LOSS read where power.txt's MDD@Holm2 at the before arm's counted rate passes
// the 20-point margin carries no verdict (section 7): FIX-METHOD (saturation), with the direction printed. A null runs the cycle:
// harness limit (cap stops or S13 background over 10% in a contrast arm), method (audit failed, or a probed output dropped by
// design), install exposure (construction checks not shown passed, or the hook shown firing in under 80% of the sessions where
// it should: the route hook on after-u sessions of the routed stratum for B1, where an empty stratum fails, and a contract
// record on after-t sessions for B3; an unrecorded hook counts as not fired), saturation (MDD past the margin, or 1 minus the
// upper bound of the before arm's task interval under 2 x MDD), else CUT-CANDIDATE. Not admitted: a descriptive line,
// FIX-METHOD (saturation), with no ceiling-raise attempt. No outcome (#169 7.5 coverage): FIX-METHOD (harness limit).
// The coverage rule holds for every endpoint: a secondary contrast or O5 whose coverage fails prints no outcome. B1 also prints
// on the routed stratum (section 5), descriptively.
// A model the ceiling refused: not run, with the MDD it would have had.
//
// The probe audit (#169 7.6 item 4) is read from labels a blind reader wrote: per probe and model, Cohen's kappa at 0.7 or more,
// or 95% agreement when either sampled class holds under 10 sessions. A missing audit fails it. O5 prints with its intervals,
// before-t's counted rate and power.txt's O5 MDD at that rate, and carries no verdict.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rng } from "../analysis/analyze.ts";
import type { L1Arm, L1Instrument, L1SessionRow } from "../../../src/types.ts";

export const SEED = 20261102;
export const RESAMPLES = 10_000;
export const DRAWS = 100_000;
export const ALPHA = 0.05;
export const MARGIN = 0.2;
export const PLANNING_RATE = 0.02;
export const EXPOSURE_BAR = 0.8;
export const OVER = 0.1;
export const COVERAGE = 0.9;
export const GATE_BAR = 0.5;
export const KAPPA_BAR = 0.7;
export const AGREEMENT_BAR = 0.95;
export const SMALL_CLASS = 10;
export const AUDIT_PER_CLASS = 20;
const BUNDLE = join(import.meta.dir, "../../../wiki/plans/2026-11-03-geva-254-l1-overhaul-prereg-2000");
export const POWER_TXT = join(BUNDLE, "power.txt");
export const POWER_SHA256 = "45585faa827b9b780e1782f66319989cc18fb04e3a9e35f54c806a56eb0c4f9e";
export const PROBES_TS = join(import.meta.dir, "probes.ts");
export const F1_ARMS: readonly L1Arm[] = ["none", "before-u", "after-u", "before-t", "after-t", "off-u", "off-t"];
export const TB2_ARMS: readonly L1Arm[] = ["none", "before-u", "after-u", "before-t", "after-t"];

export class UsageError extends Error {}
const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

// ---- power.txt -----------------------------------------------------------------------------------------------------------

export type Row = { rate: number; v: number | null };
export type PowerTable = { holm2: Row[]; at05: Row[]; o5: Row[]; sha256: string };

export function readPowerTable(path = POWER_TXT): PowerTable {
  const text = readFileSync(path);
  const digest = sha256(text);
  if (digest !== POWER_SHA256) throw new UsageError("E_USAGE l1 analyze: " + path + " has sha256 " + digest + ", not the merged power.txt " + POWER_SHA256);
  const num = (s: string) => (s === "n/r" ? null : Number(s) / 100);
  const holm2: Row[] = [], at05: Row[] = [], o5: Row[] = [];
  for (const line of text.toString("utf8").split("\n")) {
    const b = /^\s+behavior before\s+(\d+)%\s+MDD@0\.05\s+(\S+)\s+MDD@Holm2\s+(\S+)/.exec(line);
    if (b) { at05.push({ rate: Number(b[1]) / 100, v: num(b[2]!) }); holm2.push({ rate: Number(b[1]) / 100, v: num(b[3]!) }); }
    const o = /^\s+O5 control\s+(\d+)%\s+MDD@0\.05\s+(\S+)/.exec(line);
    if (o) o5.push({ rate: Number(o[1]) / 100, v: num(o[2]!) });
  }
  if (holm2.length !== 12 || o5.length !== 5) throw new UsageError("E_USAGE l1 analyze: power.txt did not parse into 12 behavior rows and 5 O5 rows");
  return { holm2, at05, o5, sha256: digest };
}

/** A frozen table read at a rate: linear between rows, the nearest end row outside them; null (not powered) touches n/r. */
export function interp(rows: Row[], rate: number): number | null {
  if (rate <= rows[0]!.rate) return rows[0]!.v;
  if (rate >= rows.at(-1)!.rate) return rows.at(-1)!.v;
  const k = rows.findIndex((r) => r.rate >= rate);
  const hi = rows[k]!, lo = rows[k - 1]!;
  if (hi.rate === rate) return hi.v;
  if (lo.v === null || hi.v === null) return null;
  return lo.v + ((hi.v - lo.v) * (rate - lo.rate)) / (hi.rate - lo.rate);
}

export function wilsonUpper(x: number, n: number, z = 1.959963984540054): number {
  if (n <= 0) return 1;
  const p = x / n;
  const z2 = z * z;
  return (p + z2 / (2 * n) + z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

/** Section 7's behavior admission at x of n pilot sessions. */
export function admit(x: number, n: number, power: PowerTable) {
  const c = n ? x / n : 0;
  const atC = interp(power.holm2, c), atPlan = interp(power.holm2, PLANNING_RATE);
  const mdd = atC === null || atPlan === null ? null : Math.max(atC, atPlan);
  const u = wilsonUpper(x, n);
  return { c, u, mdd, admitted: mdd !== null && mdd <= MARGIN && 1 - u >= 2 * mdd };
}

// ---- intervals and tests -------------------------------------------------------------------------------------------------

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const quantile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
};

/** Percentile 95% interval of the mean of per-cluster values, resampling groups (each group carries its clusters). */
export function bootstrap(values: number[], groups: number[][]): { lo: number; hi: number } {
  if (!groups.length) return { lo: NaN, hi: NaN };
  const r = rng(SEED);
  const reps: number[] = [];
  for (let b = 0; b < RESAMPLES; b++) {
    let s = 0, n = 0;
    for (let g = 0; g < groups.length; g++) {
      const pick = groups[Math.floor(r() * groups.length)]!;
      for (const i of pick) { s += values[i]!; n++; }
    }
    reps.push(s / n);
  }
  reps.sort((a, b) => a - b);
  return { lo: quantile(reps, 0.025), hi: quantile(reps, 0.975) };
}

/** Two-sided Monte Carlo sign-flip p on per-cluster differences. */
export function signFlipP(diffs: number[]): number | null {
  if (!diffs.length) return null;
  const obs = Math.abs(diffs.reduce((a, b) => a + b, 0));
  const r = rng(SEED);
  let k = 0;
  for (let d = 0; d < DRAWS; d++) {
    let s = 0;
    for (const x of diffs) s += r() < 0.5 ? -x : x;
    if (Math.abs(s) >= obs - 1e-12) k++;
  }
  return (k + 1) / (DRAWS + 1);
}

export function holm(ps: (number | null)[]): number[] {
  const p = ps.map((x) => (x === null ? 1 : x));
  const order = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const adj = new Array<number>(p.length);
  let run = 0;
  order.forEach(([v, i], k) => {
    run = Math.max(run, Math.min(1, (p.length - k) * v));
    adj[i] = run;
  });
  return adj;
}

// ---- cells, contrasts and coverage ---------------------------------------------------------------------------------------

export type Metric = "pass" | "load" | "complete";
const value = (r: L1SessionRow, m: Metric) => Number(m === "pass" ? r.pass : m === "load" ? r.load_investigate : r.complete);

export type Scope = { model: string; instrument: L1Instrument; tasks?: Set<string> };
export const graded = (rows: L1SessionRow[], s: Scope, arm: L1Arm) =>
  rows.filter((r) => r.model === s.model && r.instrument === s.instrument && r.arm === arm && r.outcome === "graded" && (!s.tasks || s.tasks.has(r.task)));

function cell(rows: L1SessionRow[], s: Scope, arm: L1Arm, m: Metric): Map<string, { v: number; repo: string }> {
  const acc = new Map<string, { xs: number[]; repo: string }>();
  for (const r of graded(rows, s, arm)) {
    const e = acc.get(r.task) ?? { xs: [], repo: r.repo };
    e.xs.push(value(r, m));
    acc.set(r.task, e);
  }
  return new Map([...acc].map(([t, e]) => [t, { v: mean(e.xs), repo: e.repo }]));
}

const groupsBy = (keys: string[]) => {
  const m = new Map<string, number[]>();
  keys.forEach((k, i) => m.set(k, [...(m.get(k) ?? []), i]));
  return [...m.keys()].sort().map((k) => m.get(k)!);
};

export type Planned = { tasks: string[]; reps: number };
export type Coverage = ReturnType<typeof coverage>;
export type Contrast = { a: L1Arm; b: L1Arm; metric: Metric; a_rate: number; b_rate: number; a_n: number; b_n: number; tasks: number; est: number; task_ci: { lo: number; hi: number }; repo_ci: { lo: number; hi: number }; p: number | null; coverage: Coverage | null };

/** A paired contrast; with the planned sessions it also carries #169 7.5's coverage, and an endpoint whose coverage fails has no outcome. */
export function contrast(rows: L1SessionRow[], s: Scope, a: L1Arm, b: L1Arm, metric: Metric, planned: Planned | null = null): Contrast {
  const A = cell(rows, s, a, metric), B = cell(rows, s, b, metric);
  const tasks = [...A.keys()].filter((t) => B.has(t)).sort();
  const diffs = tasks.map((t) => A.get(t)!.v - B.get(t)!.v);
  const ga = graded(rows, s, a), gb = graded(rows, s, b);
  return {
    a, b, metric,
    a_rate: mean(ga.map((r) => value(r, metric))), b_rate: mean(gb.map((r) => value(r, metric))), a_n: ga.length, b_n: gb.length,
    tasks: tasks.length, est: mean(diffs),
    task_ci: bootstrap(diffs, tasks.map((_, i) => [i])),
    repo_ci: bootstrap(diffs, groupsBy(tasks.map((t) => A.get(t)!.repo))),
    p: signFlipP(diffs),
    coverage: planned ? coverage(rows, s, [a, b], planned) : null,
  };
}

/** One arm's rate with its task-clustered interval. */
export function armRate(rows: L1SessionRow[], s: Scope, arm: L1Arm, m: Metric) {
  const c = cell(rows, s, arm, m);
  const vals = [...c.keys()].sort().map((t) => c.get(t)!.v);
  const g = graded(rows, s, arm);
  return { arm, n: g.length, x: g.reduce((x, r) => x + value(r, m), 0), rate: mean(g.map((r) => value(r, m))), ci: bootstrap(vals, vals.map((_, i) => [i])) };
}

/** #169 7.5: each arm graded on 90% of its planned sessions, and at most 10% of planned task clusters failing to enter. Only
 * planned sessions count: a graded session on a task outside the plan, or past the plan's replicates of its task, does not. An
 * empty plan is not covered. */
export function coverage(rows: L1SessionRow[], s: Scope, arms: L1Arm[], planned: Planned) {
  const plan = new Set(planned.tasks);
  const perTask = (arm: L1Arm) => {
    const n = new Map<string, number>();
    for (const r of graded(rows, s, arm)) if (plan.has(r.task)) n.set(r.task, (n.get(r.task) ?? 0) + 1);
    return n;
  };
  const counts = arms.map(perTask);
  const per = arms.map((arm, i) => ({ arm, graded: [...counts[i]!.values()].reduce((x, v) => x + Math.min(v, planned.reps), 0), planned: planned.tasks.length * planned.reps }));
  const missing = planned.tasks.filter((t) => !counts.every((x) => x.has(t))).length;
  const ok = planned.tasks.length > 0 && per.every((p) => p.graded >= COVERAGE * p.planned) && missing <= OVER * planned.tasks.length;
  return { ok, per, clusters_missing: missing, clusters_planned: planned.tasks.length };
}

const share = (rs: L1SessionRow[], f: (r: L1SessionRow) => boolean) => (rs.length ? rs.filter(f).length / rs.length : 0);

// ---- probe audit ---------------------------------------------------------------------------------------------------------

export type AuditLabel = { probe: "L" | "I"; model: string; trial: string; probe_value: boolean; reader_value: boolean };

export function auditResult(labels: AuditLabel[], probe: "L" | "I", model: string) {
  const ls = labels.filter((l) => l.probe === probe && l.model === model);
  const n = ls.length;
  const pos = ls.filter((l) => l.probe_value).length;
  const neg = n - pos;
  const agree = ls.filter((l) => l.probe_value === l.reader_value).length;
  if (!n) return { n, passed_class: 0, failed_class: 0, agreement: null, kappa: null, rule: "missing" as const, pass: false };
  const po = agree / n;
  const rp = ls.filter((l) => l.reader_value).length / n;
  const pp = pos / n;
  const pe = pp * rp + (1 - pp) * (1 - rp);
  const kappa = pe < 1 ? (po - pe) / (1 - pe) : null;
  const small = Math.min(pos, neg) < SMALL_CLASS;
  return { n, passed_class: pos, failed_class: neg, agreement: po, kappa, rule: small ? ("agreement" as const) : ("kappa" as const), pass: small ? po >= AGREEMENT_BAR : kappa !== null && kappa >= KAPPA_BAR };
}

/** The audit joined to the table it judges: a probe's labels for a model pass only when they hold exactly one label for each
 * session of that table's audit sample, each with the probe value the table carries, and auditResult passes on them. A label
 * for any other session, a second label or a label with another probe value fails it (rule unjoined). */
export function tableAudit(rows: L1SessionRow[], labels: AuditLabel[], probe: "L" | "I", model: string) {
  const metric: Metric = probe === "L" ? "load" : "complete";
  const byTrial = new Map(rows.filter((r) => r.model === model).map((r) => [r.trial, r]));
  const sample = new Map(auditSample(rows, model).filter((s) => s.probe === probe).map((s) => [s.trial, Boolean(value(byTrial.get(s.trial)!, metric))]));
  const ls = labels.filter((l) => l.probe === probe && l.model === model);
  const res = auditResult(ls, probe, model);
  const joined = ls.length === sample.size && new Set(ls.map((l) => l.trial)).size === ls.length && ls.every((l) => sample.has(l.trial) && typeof l.probe_value === "boolean" && typeof l.reader_value === "boolean" && sample.get(l.trial) === l.probe_value);
  return joined || !ls.length ? { ...res, sample: sample.size } : { ...res, sample: sample.size, rule: "unjoined" as const, pass: false };
}

/** The blind audit's sample: per probe and model, 20 sessions the probe passed and 20 it failed (all of a class when fewer), pooled over the probe's F1 arms, in seeded order. */
export function auditSample(rows: L1SessionRow[], model: string) {
  const out: { probe: "L" | "I"; trial: string; task: string }[] = [];
  for (const [probe, arms, m] of [["L", ["before-u", "after-u", "off-u"], "load"], ["I", ["before-t", "after-t", "off-t"], "complete"]] as const) {
    const pool = rows.filter((r) => r.model === model && r.instrument === "f1" && (arms as readonly string[]).includes(r.arm) && r.outcome === "graded").sort((a, b) => a.trial.localeCompare(b.trial));
    for (const want of [true, false]) {
      const cls = pool.filter((r) => Boolean(value(r, m)) === want);
      const r = rng(SEED);
      for (let i = cls.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [cls[i], cls[j]] = [cls[j]!, cls[i]!];
      }
      for (const s of cls.slice(0, AUDIT_PER_CLASS)) out.push({ probe, trial: s.trial, task: s.task });
    }
  }
  return out;
}

// ---- verdicts ------------------------------------------------------------------------------------------------------------

export type Member = "B1" | "B3";
export const PART: Record<Member, string> = { B1: "the route hook and the description rewrite", B3: "the contract hook and the body diet" };
export type Kind = "harness limit" | "method" | "exposure" | "saturation";
export type Reading = "KEEP" | "LOSS" | "NULL" | "NOT_ADMITTED" | "NO_ADMISSION" | "NO_OUTCOME" | "NOT_RUN";
export type Decision = { reading: Reading; verdict: "KEEP" | "CUT-CANDIDATE" | "FIX-METHOD" | "NONE"; kind: Kind | null; why: string };

export type DecideIn = {
  member: Member;
  notRun: boolean;
  admission: "admitted" | "not_admitted" | "incomplete" | "no_pilot";
  coverageOk: boolean;
  est: number | null;
  lo: number | null;
  hi: number | null;
  holmP: number | null;
  auditPassed: boolean;
  droppedByDesign: boolean;
  constructionOk: boolean;
  exposureRate: number | null;
  capStopOver: boolean;
  backgroundOver: boolean;
  mdd: number | null;
  beforeUpper: number | null;
};

const fix = (reading: Reading, kind: Kind, why: string): Decision => ({ reading, verdict: "FIX-METHOD", kind, why });

export function decide(d: DecideIn): Decision {
  const part = PART[d.member];
  if (d.notRun) return { reading: "NOT_RUN", verdict: "NONE", kind: null, why: "not run under the $2,000 ceiling" };
  if (d.admission === "not_admitted") return fix("NOT_ADMITTED", "saturation", "the pilot did not admit it: a descriptive line, with no ceiling-raise attempt");
  if (d.admission !== "admitted") return { reading: "NO_ADMISSION", verdict: "NONE", kind: null, why: "the pilot is " + (d.admission === "incomplete" ? "incomplete" : "missing") + ": no admission; the Captain decides (#169 8.3)" };
  if (!d.coverageOk || d.est === null || d.lo === null || d.hi === null) return fix("NO_OUTCOME", "harness limit", "no outcome under the coverage rule (#169 7.5)");
  const powered = d.mdd !== null && d.mdd <= MARGIN;
  const notPowered = "not powered: power.txt's MDD@Holm2 at the before arm's counted rate is " + (d.mdd === null ? "n/r" : (100 * d.mdd).toFixed(1) + " points") + ", past the 20-point margin, so the reading carries no verdict";
  const rejects = d.holmP !== null && d.holmP < ALPHA;
  const exposureOk = d.constructionOk && d.exposureRate !== null && d.exposureRate >= EXPOSURE_BAR;
  if (rejects && d.lo > 0) {
    if (!powered) return fix("KEEP", "saturation", "the after arm rose; " + notPowered);
    if (!d.auditPassed) return fix("KEEP", "method", "the probe failed its audit");
    return { reading: "KEEP", verdict: "KEEP", kind: null, why: "KEEP for " + part };
  }
  if (rejects && d.hi < 0) {
    if (!powered) return fix("LOSS", "saturation", "a loss; " + notPowered);
    if (!d.auditPassed) return fix("LOSS", "method", "a loss for " + part + "; the probe failed its audit");
    if (!exposureOk) return fix("LOSS", "exposure", "a loss for " + part + "; install exposure was not shown");
    if (d.capStopOver) return fix("LOSS", "harness limit", "a loss for " + part + "; an arm cap-stopped in over 10% of its sessions");
    return { reading: "LOSS", verdict: "CUT-CANDIDATE", kind: null, why: "a loss: CUT-CANDIDATE for " + part };
  }
  if (d.capStopOver || d.backgroundOver) return fix("NULL", "harness limit", d.capStopOver ? "an arm cap-stopped in over 10% of its sessions" : "over 10% of an arm's sessions ended with background work running (S13)");
  if (!d.auditPassed || d.droppedByDesign) return fix("NULL", "method", d.droppedByDesign ? "the after pin dropped a probed output by design" : "the probe failed its audit");
  if (!exposureOk) return fix("NULL", "exposure", !d.constructionOk ? "the construction checks were not shown passed" : d.exposureRate === null ? "no session where the hook should fire" : "the hook was shown firing in " + (100 * d.exposureRate).toFixed(0) + "% of the sessions where it should, under 80%");
  if (!powered) return fix("NULL", "saturation", notPowered);
  if (d.beforeUpper === null || 1 - d.beforeUpper < 2 * d.mdd!) return fix("NULL", "saturation", "100 minus the before arm's upper bound is under 2 x MDD");
  return { reading: "NULL", verdict: "CUT-CANDIDATE", kind: null, why: "CUT-CANDIDATE for " + part };
}

// ---- the analysis --------------------------------------------------------------------------------------------------------

export type Config = {
  models: { id: string; status: "run" | "not_run" }[];
  f1_tasks?: string[] | string;
  pilot_tasks?: string[] | string;
  tb2_tasks?: string[] | string;
  tb2_replicates?: number;
  routed_stratum: string[];
  tb2_fit_stratum?: string[];
  construction_checks: boolean;
  dropped_by_design?: boolean;
  audit?: AuditLabel[] | string | null;
  power_txt?: string;
};

const taskList = (v: string[] | string | undefined, fallback: string | null): string[] => {
  if (Array.isArray(v)) return v;
  const path = typeof v === "string" ? v : fallback;
  return path ? readFileSync(path, "utf8").split(/\s+/).filter(Boolean) : [];
};

/** The current probes.ts sha256, refusing a table with any row scored by another probes.ts. */
export function currentProbes(rows: L1SessionRow[]): string {
  const sha = sha256(readFileSync(PROBES_TS));
  const stale = rows.find((r) => r.probes_sha256 !== sha);
  if (stale) throw new UsageError("E_USAGE l1 analyze: trial " + stale.trial + " was tabled by probes.ts " + String(stale.probes_sha256).slice(0, 12) + ", not the current " + sha.slice(0, 12) + "; rebuild the table with this probes.ts");
  return sha;
}

export function analyze(rows: L1SessionRow[], cfg: Config) {
  if (!Array.isArray(cfg.models) || !cfg.models.length) throw new UsageError("E_USAGE l1 analyze: the config needs models, each {id, status: run | not_run}");
  if (!Array.isArray(cfg.routed_stratum)) throw new UsageError("E_USAGE l1 analyze: the config needs routed_stratum, the F1 tasks Amendment C's routing table sends to /investigate (may be empty)");
  if (typeof cfg.construction_checks !== "boolean") throw new UsageError("E_USAGE l1 analyze: the config needs construction_checks, true only when U1's checks and Amendment C's dry run passed");
  const power = readPowerTable(cfg.power_txt ?? POWER_TXT);
  const f1Tasks = taskList(cfg.f1_tasks, join(BUNDLE, "f-tasks.txt"));
  const pilotTasks = taskList(cfg.pilot_tasks, join(BUNDLE, "pilot-tasks.txt"));
  const tb2Tasks = taskList(cfg.tb2_tasks, null);
  if (cfg.models.some((m) => m.status === "run" && rows.some((r) => r.model === m.id && r.instrument === "tb2"))) {
    if (!tb2Tasks.length) throw new UsageError("E_USAGE l1 analyze: the table holds TB2 rows, so the config needs tb2_tasks, the TB2 twin's planned tasks");
    if (!Array.isArray(cfg.tb2_fit_stratum)) throw new UsageError("E_USAGE l1 analyze: the table holds TB2 rows, so the config needs tb2_fit_stratum, the TB2 fit stratum's tasks (may be empty)");
  }
  const tb2Reps = cfg.tb2_replicates ?? 2;
  const labels: AuditLabel[] = Array.isArray(cfg.audit) ? cfg.audit : typeof cfg.audit === "string" ? readFileSync(cfg.audit, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
  const routed = new Set(cfg.routed_stratum);
  const f1Plan: Planned = { tasks: f1Tasks, reps: 1 };
  const probesSha = currentProbes(rows);
  const models = cfg.models.map((m) => {
    const id = m.id;
    const f1: Scope = { model: id, instrument: "f1" };
    const pilot: Scope = { model: id, instrument: "pilot" };
    const notRun = m.status === "not_run";
    const members = (["B1", "B3"] as const).map((member) => {
      const [after, before, metric] = member === "B1" ? (["after-u", "before-u", "load"] as const) : (["after-t", "before-t", "complete"] as const);
      const pr = armRate(rows, pilot, before, metric);
      const pilotCov = coverage(rows, pilot, [before], { tasks: pilotTasks, reps: 1 });
      const ad = admit(pr.x, pr.n, power);
      const admission = notRun || !pilotTasks.length || pr.n === 0 ? "no_pilot" : !pilotCov.ok ? "incomplete" : ad.admitted ? "admitted" : "not_admitted";
      const c = contrast(rows, f1, after, before, metric, f1Plan);
      const cov = c.coverage!;
      const br = armRate(rows, f1, before, metric);
      const arms = [graded(rows, f1, after), graded(rows, f1, before)];
      const capStopOver = arms.some((g) => share(g, (r) => r.allowance_stop || r.turn_cap) > OVER);
      const backgroundOver = arms.some((g) => share(g, (r) => r.background_at_result) > OVER);
      const audit = tableAudit(rows, labels, member === "B1" ? "L" : "I", id);
      const exposed = member === "B1" ? graded(rows, f1, "after-u").filter((r) => routed.has(r.task)) : graded(rows, f1, "after-t");
      const exposureRate = exposed.length ? share(exposed, (r) => (member === "B1" ? r.route_hook : r.contract_record) === true) : null;
      return { member, after, before, metric, admission: { status: admission, n: pr.n, x: pr.x, c: pr.n ? pr.rate : null, u: ad.u, mdd: ad.mdd, coverage: pilotCov }, contrast: c, coverage: cov, before_rate: br, capStopOver, backgroundOver, audit, exposure: { rate: exposureRate, n: exposed.length }, mdd: br.n ? interp(power.holm2, br.rate) : null };
    });
    const tested = members.map((x) => !notRun && x.admission.status === "admitted" && x.coverage.ok);
    const adj = holm(members.map((x, i) => (tested[i] ? x.contrast.p : null)));
    const primaries = members.map((x, i) => ({
      ...x,
      holm_p: adj[i]!,
      decision: decide({
        member: x.member, notRun, admission: x.admission.status as DecideIn["admission"], coverageOk: x.coverage.ok,
        est: Number.isFinite(x.contrast.est) ? x.contrast.est : null, lo: Number.isFinite(x.contrast.task_ci.lo) ? x.contrast.task_ci.lo : null, hi: Number.isFinite(x.contrast.task_ci.hi) ? x.contrast.task_ci.hi : null,
        holmP: tested[i] ? adj[i]! : null, auditPassed: x.audit.pass, droppedByDesign: cfg.dropped_by_design === true, constructionOk: cfg.construction_checks,
        exposureRate: x.exposure.rate, capStopOver: x.capStopOver, backgroundOver: x.backgroundOver, mdd: x.mdd, beforeUpper: Number.isFinite(x.before_rate.ci.hi) ? x.before_rate.ci.hi : null,
      }),
      not_run_mdd: notRun ? interp(power.holm2, PLANNING_RATE) : null,
    }));
    const at = graded(rows, f1, "after-t");
    const gate = { n: at.length, complete: at.filter((r) => r.complete).length, rate: at.length ? share(at, (r) => r.complete) : null, met: at.length > 0 && share(at, (r) => r.complete) >= GATE_BAR, probes_sha256: probesSha };
    const o5c = contrast(rows, f1, "after-t", "before-t", "pass", f1Plan);
    const o5 = { contrast: o5c, outcome: o5c.coverage!.ok, before_t_rate: o5c.b_n ? o5c.b_rate : null, mdd: o5c.b_n ? interp(power.o5, o5c.b_rate) : null, verdict: "none: descriptive and unpowered (section 8)" };
    const b1Routed = contrast(rows, { ...f1, tasks: routed }, "after-u", "before-u", "load", { tasks: cfg.routed_stratum, reps: 1 });
    const pass = (a: L1Arm, b: L1Arm) => contrast(rows, f1, a, b, "pass", f1Plan);
    const tb2: Scope = { model: id, instrument: "tb2" };
    const tb2Plan: Planned = { tasks: tb2Tasks, reps: tb2Reps };
    const fit: Scope = { ...tb2, tasks: new Set(cfg.tb2_fit_stratum ?? []) };
    const costs = Object.fromEntries(F1_ARMS.map((arm) => {
      const g = graded(rows, f1, arm);
      const known = g.filter((r) => r.cost_usd !== null);
      const dollars = known.reduce((x, r) => x + r.cost_usd!, 0);
      const passes = known.filter((r) => r.pass).length;
      const toks = g.filter((r) => r.tokens !== null);
      return [arm, { sessions: g.length, cost_missing: g.length - known.length, usd_per_session: known.length ? dollars / known.length : null, tokens_per_session: toks.length ? toks.reduce((x, r) => x + r.tokens!, 0) / toks.length : null, usd_per_pass: passes ? dollars / passes : null }];
    }));
    const ratio = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);
    const skillCounts = (inst: L1Instrument) => Object.fromEntries((["none", "before-u", "after-u", "off-u"] as const).map((arm) => {
      const g = graded(rows, { model: id, instrument: inst }, arm);
      const count = (pick: (r: L1SessionRow) => string[]) => {
        const out: Record<string, number> = {};
        for (const r of g) for (const s of new Set(pick(r))) out[s] = (out[s] ?? 0) + 1;
        return out;
      };
      return [arm, { sessions: g.length, gstack: count((r) => r.gstack_loads.filter((s) => s !== "investigate")), repo: count((r) => r.repo_loads) }];
    }));
    const s10 = { both: 0, probe_only: 0, contract_only: 0, neither: 0, unrecorded: 0 };
    for (const r of at) {
      if (r.contract_check_met === null) s10.unrecorded++;
      else s10[r.complete ? (r.contract_check_met ? "both" : "probe_only") : r.contract_check_met ? "contract_only" : "neither"]++;
    }
    const au = graded(rows, f1, "after-u");
    const background = Object.fromEntries((["pilot", "smoke", "f1", "tb2"] as const).map((inst) => [inst, Object.fromEntries(F1_ARMS.map((arm) => {
      const g = graded(rows, { model: id, instrument: inst }, arm);
      return [arm, { sessions: g.length, background: g.filter((r) => r.background_at_result).length, over: share(g, (r) => r.background_at_result) > OVER }];
    }).filter(([, v]) => (v as any).sessions > 0))]));
    const s12b1 = contrast(rows, tb2, "after-u", "before-u", "load", tb2Plan), s12b3 = contrast(rows, tb2, "after-t", "before-t", "complete", tb2Plan);
    const gap = (t: Contrast, f: Contrast) => (t.coverage!.ok && f.coverage!.ok ? t.est - f.est : null);
    return {
      model: id,
      status: m.status,
      primaries,
      b1_routed: b1Routed,
      gate,
      o5,
      secondary: {
        S1: [pass("after-t", "none"), pass("after-u", "none")],
        S3: [pass("after-u", "before-u")],
        S5: [pass("before-t", "none"), pass("before-u", "none")],
        S6: [contrast(rows, f1, "after-u", "off-u", "load", f1Plan), contrast(rows, f1, "after-t", "off-t", "complete", f1Plan), pass("after-t", "off-t"), pass("after-u", "off-u")],
        S7: { f1: skillCounts("f1"), tb2: skillCounts("tb2") },
        S8: { per_arm: costs, ratio_to_none: Object.fromEntries(F1_ARMS.map((arm) => [arm, { per_session: ratio(costs[arm]!.usd_per_session, costs.none!.usd_per_session), per_pass: ratio(costs[arm]!.usd_per_pass, costs.none!.usd_per_pass) }])), g3_after_t: ratio(costs["after-t"]!.usd_per_pass, costs.none!.usd_per_pass) },
        S10: s10,
        S11: { route_hook_after_u: { n: au.length, fired: au.filter((r) => r.route_hook === true).length, unrecorded: au.filter((r) => r.route_hook === null).length, routed_n: au.filter((r) => routed.has(r.task)).length, routed_fired: au.filter((r) => routed.has(r.task) && r.route_hook === true).length }, contract_after_t: { n: at.length, block: at.filter((r) => r.contract_block).length, record: at.filter((r) => r.contract_record === true).length, unrecorded: at.filter((r) => r.contract_record === null).length } },
        S12: { tb2_b1: s12b1, tb2_b3: s12b3, gap_b1: gap(s12b1, primaries[0]!.contrast), gap_b3: gap(s12b3, primaries[1]!.contrast), fit_b1: contrast(rows, fit, "after-u", "before-u", "load", { tasks: cfg.tb2_fit_stratum ?? [], reps: tb2Reps }), tb2_coverage: coverage(rows, tb2, [...TB2_ARMS], tb2Plan) },
        S13: background,
      },
    };
  });
  const sessions = { total: rows.length, contaminated: rows.filter((r) => r.outcome === "contaminated").map((r) => ({ trial: r.trial, arm: r.arm, hit: r.audit_hits[0] ?? "" })), cap_stops: rows.filter((r) => r.outcome === "cap_stop").length, infra: rows.filter((r) => r.outcome === "infra").length };
  return { power_sha256: power.sha256, probes_sha256: probesSha, sessions, models };
}

export type Report = ReturnType<typeof analyze>;

const pct = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "n/a" : (100 * x).toFixed(1) + "%");
const pts = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "n/a" : (x >= 0 ? "+" : "") + (100 * x).toFixed(1));
const ci = (c: { lo: number; hi: number }) => "[" + pts(c.lo) + ", " + pts(c.hi) + "]";
const line = (label: string, c: Contrast, tested = false) => {
  const none = c.coverage !== null && !c.coverage.ok;
  return "| " + label + " | " + c.a + " " + pct(c.a_rate) + " (" + c.a_n + ") | " + c.b + " " + pct(c.b_rate) + " (" + c.b_n + ") | " + c.tasks + " | " + (none ? "no outcome (coverage) | - | -" : pts(c.est) + " | " + ci(c.task_ci) + " | " + ci(c.repo_ci)) + " | " + (!tested || none ? "-" : c.p === null ? "n/a" : c.p < 1e-4 ? "<0.0001" : c.p.toFixed(4)) + " |";
};

export function markdown(rep: Report): string {
  const out: string[] = ["L1 analysis. power.txt " + rep.power_sha256.slice(0, 12) + ", probes.ts " + rep.probes_sha256.slice(0, 12) + ". Sessions " + rep.sessions.total + ": infra " + rep.sessions.infra + ", cap stops " + rep.sessions.cap_stops + ", contaminated none " + rep.sessions.contaminated.length + "."];
  const head = "| Endpoint | Arm A | Arm B | Paired tasks | Difference, points | Task 95% CI | Repository 95% CI | p, primaries only |\n|---|---|---|---|---|---|---|---|";
  for (const m of rep.models) {
    out.push("", "## " + m.model + (m.status === "not_run" ? " (not run under the $2,000 ceiling)" : ""), "");
    for (const p of m.primaries) {
      const a = p.admission;
      out.push("**" + p.member + "** admission: " + a.status + (a.c === null ? "" : " (before " + a.x + "/" + a.n + ", Wilson upper " + pct(a.u) + ", MDD@Holm2 " + pts(a.mdd) + ")") + ". Verdict: **" + p.decision.verdict + (p.decision.kind ? " (" + p.decision.kind + ")" : "") + "**, reading " + p.decision.reading + ": " + p.decision.why + ". Holm p " + p.holm_p.toFixed(4) + "; before rate " + pct(p.before_rate.rate) + " [" + pct(p.before_rate.ci.lo) + ", " + pct(p.before_rate.ci.hi) + "]; MDD@Holm2 there " + pts(p.mdd) + "; coverage " + (p.coverage.ok ? "ok" : "failed") + "; audit " + p.audit.rule + " " + (p.audit.pass ? "passed" : "failed") + "; exposure " + pct(p.exposure.rate) + " of " + p.exposure.n + (p.not_run_mdd === null ? "" : "; it would have had MDD@Holm2 " + pts(p.not_run_mdd) + " at the planning rate"));
    }
    out.push("", head);
    for (const p of m.primaries) out.push(line(p.member, p.contrast, true));
    out.push(line("B1 routed stratum", m.b1_routed));
    out.push(line("O5 (descriptive)", m.o5.contrast));
    for (const [k, cs] of Object.entries({ S1: m.secondary.S1, S3: m.secondary.S3, S5: m.secondary.S5, S6: m.secondary.S6 })) for (const c of cs) out.push(line(k + " " + c.metric, c));
    out.push(line("S12 TB2 B1", m.secondary.S12.tb2_b1), line("S12 TB2 B3", m.secondary.S12.tb2_b3), line("S12 TB2 fit B1", m.secondary.S12.fit_b1));
    out.push("", "Gate reading (probe I complete in F1 after-t, bar 50%): " + m.gate.complete + "/" + m.gate.n + " = " + pct(m.gate.rate) + ", " + (m.gate.met ? "met" : "not met") + "; probes.ts sha256 " + m.gate.probes_sha256 + ". It is B3's exposure line.");
    out.push("O5: " + (m.o5.outcome ? pts(m.o5.contrast.est) + " points " + ci(m.o5.contrast.task_ci) : "no outcome under the coverage rule") + ", before-t " + pct(m.o5.before_t_rate) + ", power.txt MDD@0.05 there " + pts(m.o5.mdd) + ". Unpowered: no verdict.");
    out.push("S13 background at result: " + JSON.stringify(m.secondary.S13));
    out.push("S7, S8, S10, S11: " + JSON.stringify({ S7: m.secondary.S7, S8: m.secondary.S8, S10: m.secondary.S10, S11: m.secondary.S11 }));
  }
  return out.join("\n");
}

if (import.meta.main) {
  const [cmd, tablePath, cfgPath, outPath] = Bun.argv.slice(2);
  try {
    if ((cmd !== "report" && cmd !== "audit-sample") || !tablePath || !cfgPath) throw new UsageError("E_USAGE usage: bun quick/laneb/l1/analyze.ts report <sessions.jsonl> <config.json> [report.json] | audit-sample <sessions.jsonl> <model>");
    const rows = readFileSync(tablePath, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as L1SessionRow);
    if (rows.some((r) => r.schema !== "l1-session/1")) throw new UsageError("E_USAGE l1 analyze: every row must have schema l1-session/1");
    currentProbes(rows);
    if (cmd === "audit-sample") console.log(auditSample(rows, cfgPath).map((x) => JSON.stringify(x)).join("\n"));
    else {
      const rep = analyze(rows, JSON.parse(readFileSync(cfgPath, "utf8")));
      if (outPath) writeFileSync(outPath, JSON.stringify(rep, null, 2) + "\n");
      console.log(markdown(rep));
    }
  } catch (e) {
    console.error(e instanceof UsageError ? e.message : "E_USAGE l1 analyze: " + String(e));
    process.exit(2);
  }
}
