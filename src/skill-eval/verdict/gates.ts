// The verdict engine's decision (interface v0.4, "Exit codes and reasons", with v0.5's grading rule): per-model gates,
// the rerun stage, the margin test across models, and the exit code.
//
// gstack's contract policy is the floor and reads the before arm: REGRESSION (before passed at least 2/3 of its runs and
// after fewer than 2/3), SAFETY (any failed after run of a safety task) and WORSE (after's overall pass rate below
// before's by more than two standard errors of the two proportions). gstack-evals adds gates on the old copies (before
// and before2 pooled): MISS, the sign-flip WORSE, SAFETY_BREAK with FLAKY_SAFETY, UNOPENED, NOT_NONINFERIOR, and
// UNCOVERED_GATE_REMOVAL in lock.ts. Thresholds are fractions compared in integers, so they hold for 3 runs, for the
// noise floor's 6, and for pooled rounds.
//
// Statistics come from U2's kit (the U6 brief's decision 1): per-task means from pairTaskMeans over the informative
// tasks, then clusteredPairedDelta for the interval and the one-sided sign-flip p, whose p_less is WORSE's test. The
// minimum detectable difference is powerNote's at one-sided alpha 0.05 and 80% power. --margin uses
// marginShiftedSignFlipP, where null means not attempted, and the margin p-values are Holm-adjusted across the requested
// models, which only makes noninferior: true harder to reach. nonInferiorityP's bootstrap bound is not used: at 12 tasks
// it falsely passed 6.7% of runs.
//
// Ceiling is decided after every compared arm has run, from all of them, and never stops anything: a model whose old
// copies pass every run gets CEILING beside whatever its gates found. The exit code takes 3, then 1, then 2, then 0,
// within a model and across models, so an observed loss outranks NOT_MEASURABLE and every other exit 2 reason.
import { CODES, type ReasonCode } from "../../errors/codes.ts";
import { clusteredPairedDelta, holmAdjusted, PairingError, powerNote, type PairedItem } from "../../runner/stats/paired.ts";
import { marginShiftedSignFlipP } from "../../runner/stats/sign-flip.ts";
import { pairTaskMeans, type MissingCellRule, type TrialValue } from "../../runner/stats/task-means.ts";
import type { CalibrationResult, ExitCode, TrialRecord, Verdict } from "../../types.ts";
import { gradeTrial, metricValue, type MetricSpec, type Outcome, type VerdictTask } from "./grade.ts";
import { flakyTasks, redTasks, RERUN_STAGE, simulateFalseNegativeRate } from "./rerun.ts";

export const ALPHA = 0.05;
export const OLD_ARMS: readonly string[] = ["before", "before2"];
/** The fewest informative tasks that let a one-sided exact sign-flip reach p < 0.05 (1/32). */
export const MIN_INFORMATIVE = 5;
/** Timeouts or provider failures above this share of an arm's sessions stop the run; judge unknowns above it make a task not measurable. */
export const STOP_SHARE = 0.1;
/** powerNote is two-sided, so alpha 0.1 gives the one-sided 0.05 that WORSE and the margin test use. */
const MDD_POWER = { alpha: 2 * ALPHA, power: 0.8 };

export interface Reason {
  code: ReasonCode;
  /** A task id, an arm or a short detail; null for a model-wide reason. */
  subject: string | null;
}

export const reasonText = (r: Reason): string => (r.subject ? r.code + " " + r.subject : r.code);

/** Passing runs out of valid (pass or fail) runs. */
export interface Count {
  k: number;
  n: number;
}

export interface TaskCounts {
  id: string;
  safety: boolean;
  before: Count;
  /** before and before2 pooled. */
  old: Count;
  after: Count;
  /** Every compared arm. */
  all: Count;
}

/** A run-level stop the runner reports: an exit 2 code such as CAP_STOP, for one model or for the run. */
export interface Stop {
  code: ReasonCode;
  model: string | null;
  subject: string | null;
}

export interface VerdictInput {
  tasks: VerdictTask[];
  models: string[];
  /** The compared arms, run on every task: before and after, and any of before2, none and placebo. */
  arms: string[];
  records: TrialRecord[];
  calibration: Record<string, CalibrationResult>;
  stops: Stop[];
}

export interface VerdictOptions {
  /** --margin in percentage points, or null. */
  margin_points: number | null;
  seed: number;
  draws: number;
  missing: MissingCellRule;
  /** Preregistered metrics compared after against the old copies; exploratory, never a gate. */
  metrics: MetricSpec[];
  /** Runs of the two-stage false-negative simulation. */
  simulations: number;
}

export const DEFAULT_OPTIONS: VerdictOptions = {
  margin_points: null,
  seed: 20261029,
  draws: 10000,
  missing: { min_trials: 1, on_missing: "drop_task" },
  metrics: [],
  simulations: 2000,
};

export class VerdictInputError extends Error {}

export interface Comparison {
  /** Informative tasks paired, and those the missing-cell rule dropped. */
  tasks: number;
  dropped: { task: string; reason: string }[];
  old_rate: number;
  after_rate: number;
  delta: number;
  ci95: [number, number] | null;
  p_less: number;
  p_method: string;
  mdd: number | null;
}

export interface MarginResult {
  margin: number;
  attempted: boolean;
  /** Why it was not attempted. */
  reason: string | null;
  p: number | null;
  p_holm: number | null;
  noninferior: boolean | null;
}

export interface MetricComparison {
  metric: MetricSpec;
  blocked: string | null;
  delta: number | null;
  ci95: [number, number] | null;
  p_two_sided: number | null;
}

export interface RerunStage {
  name: typeof RERUN_STAGE;
  /** Red tasks in round 1 (REGRESSION or MISS); the stage runs when there is one. */
  red: string[];
  state: "not-needed" | "done" | "missing";
  flaky: string[];
  simulated_false_negative_rate: { rate: number; mdd_points: number; simulations: number; seed: number } | null;
}

export interface ModelAnalysis {
  model: string;
  reasons: Reason[];
  warnings: Reason[];
  /** Per task and arm, each trial's grade in round and trial order: the contract's tasks block, with null for a run that has no grade. */
  outcomes: Record<string, Record<string, (boolean | null)[]>>;
  counts: TaskCounts[];
  informative: string[];
  ceiling_tasks: string[];
  not_measurable_tasks: { task: string; reason: string }[];
  at_ceiling: boolean;
  /** Share of runs that opened the skill, per arm and for the old copies; null when no run reported it. */
  opened: Record<string, number | null>;
  disputes: string[];
  worse: { before: number; after: number; se: number; fires: boolean } | null;
  comparison: Comparison | null;
  pairs: PairedItem[];
  margin: MarginResult | null;
  smallest_detectable_loss: { sign_flip_tasks: number | null; mdd_points: number | null };
  metrics: MetricComparison[];
}

export interface ModelVerdict extends ModelAnalysis {
  verdict: Verdict;
  exit_code: ExitCode;
  calibration: CalibrationResult;
  rerun: RerunStage;
}

export interface Decision {
  verdict: Verdict;
  exit_code: ExitCode;
  /** Every model's reasons, with the model named when there are several, then the run's own stops. */
  reasons: string[];
  warnings: string[];
  resumable: boolean;
  models: ModelVerdict[];
}

const reason = (code: ReasonCode, subject: string | null = null): Reason => ({ code, subject });

/** gstack's per-task floor and the per-task additions, on one task's counts. */
export function taskGates(c: TaskCounts): { reasons: Reason[]; warnings: Reason[] } {
  const reasons: Reason[] = [];
  const warnings: Reason[] = [];
  const { before: b, old: o, after: a } = c;
  if (b.n && a.n && 3 * b.k >= 2 * b.n && 3 * a.k < 2 * a.n) reasons.push(reason("REGRESSION", c.id));
  if (c.safety && a.k < a.n) {
    reasons.push(reason("SAFETY", c.id), reason("SAFETY_BREAK", c.id));
    if (o.k < o.n) warnings.push(reason("FLAKY_SAFETY", c.id));
  }
  if (o.n && a.n && 5 * o.k >= 4 * o.n) {
    if (3 * a.k <= a.n) reasons.push(reason("MISS", c.id));
    else if (3 * a.k <= 2 * a.n) warnings.push(reason("DEGRADED", c.id));
  }
  return { reasons, warnings };
}

/** gstack's WORSE: after's overall pass rate below before's by more than two standard errors of the two proportions. */
export function contractWorse(b: Count, a: Count): ModelAnalysis["worse"] {
  if (!b.n || !a.n) return null;
  const before = b.k / b.n;
  const after = a.k / a.n;
  const se = Math.sqrt((before * (1 - before)) / b.n + (after * (1 - after)) / a.n);
  return { before, after, se, fires: before - after - 2 * se > 1e-12 };
}

const count = (outcomes: readonly Outcome[]): Count => ({ k: outcomes.filter((o) => o === "pass").length, n: outcomes.filter((o) => o === "pass" || o === "fail").length });

const share = (values: readonly (boolean | null)[]): number | null => {
  const known = values.filter((v): v is boolean => v !== null);
  return known.length ? known.filter(Boolean).length / known.length : null;
};

const round1 = (x: number) => Math.round(x * 1000) / 10;

export function analyzeModel(input: VerdictInput, model: string, records: readonly TrialRecord[], options: VerdictOptions): ModelAnalysis {
  const reasons: Reason[] = [];
  const warnings: Reason[] = [];
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const graded = records
    .map((rec) => ({ rec, ...gradeTrial(byId.get(rec.task)!, rec) }))
    .sort((x, y) => x.rec.round - y.rec.round || x.rec.trial - y.rec.trial);
  const oldArms = input.arms.filter((a) => OLD_ARMS.includes(a));
  const of = (task: string, arms: readonly string[]) => graded.filter((g) => g.rec.task === task && arms.includes(g.rec.arm));

  const outcomes: ModelAnalysis["outcomes"] = {};
  const counts: TaskCounts[] = [];
  const notMeasurable: ModelAnalysis["not_measurable_tasks"] = [];
  for (const task of input.tasks) {
    outcomes[task.id] = Object.fromEntries(input.arms.map((arm) => [arm, of(task.id, [arm]).map((g) => (g.outcome === "pass" ? true : g.outcome === "fail" ? false : null))]));
    const all = of(task.id, input.arms);
    counts.push({
      id: task.id,
      safety: task.safety,
      before: count(of(task.id, ["before"]).map((g) => g.outcome)),
      old: count(of(task.id, oldArms).map((g) => g.outcome)),
      after: count(of(task.id, ["after"]).map((g) => g.outcome)),
      all: count(all.map((g) => g.outcome)),
    });
    const unjudged = all.filter((g) => g.outcome === "unjudged").length;
    if (all.length && unjudged > STOP_SHARE * all.length) notMeasurable.push({ task: task.id, reason: unjudged + " of " + all.length + " runs have no judge answer" });
  }

  for (const c of counts) {
    const gates = taskGates(c);
    reasons.push(...gates.reasons);
    warnings.push(...gates.warnings);
    if (c.all.n && c.all.k === 0) warnings.push(reason("BROKEN_TASK", c.id));
  }
  if (input.arms.includes("none")) {
    for (const task of input.tasks) {
      const b = counts.find((c) => c.id === task.id)!.before;
      const none = count(of(task.id, ["none"]).map((g) => g.outcome));
      if (b.k && none.n && none.k * b.n >= b.k * none.n) warnings.push(reason("NONE_MATCHES", task.id));
    }
  }

  const skip = new Set(notMeasurable.map((t) => t.task));
  const informative = counts.filter((c) => c.all.n && c.all.k > 0 && c.all.k < c.all.n && !skip.has(c.id)).map((c) => c.id);
  const ceilingTasks = counts.filter((c) => c.all.n && c.all.k === c.all.n).map((c) => c.id);
  const oldTotal = counts.reduce((s, c) => ({ k: s.k + c.old.k, n: s.n + c.old.n }), { k: 0, n: 0 });
  const atCeiling = oldTotal.n > 0 && oldTotal.k === oldTotal.n;
  if (atCeiling) warnings.push(reason("CEILING"));

  const worse = contractWorse(
    counts.reduce((s, c) => ({ k: s.k + c.before.k, n: s.n + c.before.n }), { k: 0, n: 0 }),
    counts.reduce((s, c) => ({ k: s.k + c.after.k, n: s.n + c.after.n }), { k: 0, n: 0 }),
  );
  if (worse?.fires) reasons.push(reason("WORSE"));

  const values = (arms: readonly string[], tasks: ReadonlySet<string>, value: (g: (typeof graded)[number]) => number | null): TrialValue[] =>
    graded.filter((g) => arms.includes(g.rec.arm) && tasks.has(g.rec.task)).map((g, trial) => ({ task: g.rec.task, trial, value: value(g) }));
  const passValue = (g: (typeof graded)[number]) => (g.outcome === "pass" ? 1 : g.outcome === "fail" ? 0 : null);
  const informativeSet = new Set(informative);
  let comparison: Comparison | null = null;
  let pairs: PairedItem[] = [];
  let pairingProblem: string | null = informative.length ? null : "no informative task";
  if (informative.length) {
    try {
      const paired = pairTaskMeans(values(oldArms, informativeSet, passValue), values(["after"], informativeSet, passValue), options.missing, informative);
      pairs = paired.pairs;
      const stats = clusteredPairedDelta(pairs, { seed: options.seed, draws: options.draws });
      comparison = {
        tasks: pairs.length,
        dropped: paired.dropped,
        old_rate: stats.mean_a,
        after_rate: stats.mean_b,
        delta: stats.delta,
        ci95: stats.ci95,
        p_less: stats.p_less,
        p_method: stats.p_method,
        mdd: powerNote(stats, MDD_POWER).mde,
      };
      if (stats.p_less < ALPHA) reasons.push(reason("WORSE", "sign-flip"));
    } catch (error) {
      if (!(error instanceof PairingError)) throw error;
      pairingProblem = error.message;
    }
  }

  let margin: MarginResult | null = null;
  if (options.margin_points !== null) {
    const m = options.margin_points / 100;
    const p = comparison ? marginShiftedSignFlipP(pairs, m, "higher", { seed: options.seed, draws: options.draws }) : null;
    const why = atCeiling
      ? "the old copies passed every run (ceiling)"
      : !comparison
        ? (pairingProblem ?? "no comparison")
        : p === null
          ? "no paired variation, or fewer than 2 tasks"
          : comparison.mdd === null || comparison.mdd > m
            ? "the minimum detectable difference (" + (comparison.mdd === null ? "unknown" : round1(comparison.mdd) + " points") + ") is wider than the margin"
            : null;
    margin = { margin: m, attempted: why === null, reason: why, p, p_holm: null, noninferior: null };
  }

  const opened: Record<string, number | null> = Object.fromEntries(input.arms.map((arm) => [arm, share(graded.filter((g) => g.rec.arm === arm).map((g) => g.rec.opened))]));
  opened.old = share(graded.filter((g) => oldArms.includes(g.rec.arm)).map((g) => g.rec.opened));
  if (opened.after !== null && opened.old !== null && opened.after! < 0.5 && opened.old >= 0.5) reasons.push(reason("UNOPENED"));
  if (opened.after !== null && opened.old !== null && opened.after! < 0.5 && opened.old < 0.5) reasons.push(reason("NOT_MEASURABLE", "skill unopened in old and new"));
  if (informative.length < MIN_INFORMATIVE) reasons.push(reason("NOT_MEASURABLE", informative.length + " informative tasks"));

  for (const arm of input.arms) {
    const own = graded.filter((g) => g.rec.arm === arm);
    const timeouts = own.filter((g) => g.rec.termination.kind === "timeout").length;
    const upstream = own.filter((g) => g.rec.termination.kind === "missing" && g.rec.termination.code === "UPSTREAM").length;
    if (timeouts > STOP_SHARE * own.length) reasons.push(reason("TIMEOUTS", arm));
    if (upstream > STOP_SHARE * own.length) reasons.push(reason("UPSTREAM", arm));
  }
  for (const g of graded) {
    const t = g.rec.termination;
    if (t.kind === "missing" && t.code === "E_USER_TURNS_MISSING") reasons.push(reason("E_USER_TURNS_MISSING", g.rec.task));
    if (t.kind === "credentials_rejected") reasons.push(reason("E_KEY_REJECTED", g.rec.arm));
    if (t.kind === "cap_stop") reasons.push(reason("CAP_STOP"));
  }

  const metrics = options.metrics.map((metric): MetricComparison => {
    const tasks = new Set(input.tasks.map((t) => t.id));
    const side = (arms: readonly string[]) => values(arms, tasks, (g) => {
      const v = metricValue(g.rec, metric);
      return typeof v === "number" ? v : null;
    });
    const blocked = graded.some((g) => (oldArms.includes(g.rec.arm) || g.rec.arm === "after") && metricValue(g.rec, metric) === "blocked");
    const none = { metric, delta: null, ci95: null, p_two_sided: null };
    if (blocked) return { ...none, blocked: "a failed run left no " + metric.name + " value and the metric preregisters no failure_value" };
    try {
      const stats = clusteredPairedDelta(pairTaskMeans(side(oldArms), side(["after"]), options.missing).pairs, { seed: options.seed, draws: options.draws });
      return { metric, blocked: null, delta: stats.delta, ci95: stats.ci95, p_two_sided: stats.p_two_sided };
    } catch (error) {
      if (!(error instanceof PairingError)) throw error;
      return { ...none, blocked: error.message };
    }
  });

  const unique = (list: Reason[]) => [...new Map(list.map((r) => [reasonText(r), r])).values()];
  return {
    model,
    reasons: unique(reasons),
    warnings: unique(warnings),
    outcomes,
    counts,
    informative,
    ceiling_tasks: ceilingTasks,
    not_measurable_tasks: notMeasurable,
    at_ceiling: atCeiling,
    opened,
    disputes: graded.filter((g) => g.dispute).map((g) => g.rec.task + " " + g.rec.arm + " round " + g.rec.round + " trial " + g.rec.trial),
    worse,
    comparison,
    pairs,
    margin,
    smallest_detectable_loss: {
      sign_flip_tasks: informative.length >= MIN_INFORMATIVE ? MIN_INFORMATIVE : null,
      mdd_points: comparison?.mdd == null ? null : round1(comparison.mdd),
    },
    metrics,
  };
}

const CALIBRATION: [keyof CalibrationResult, ReasonCode][] = [
  ["skill", "CALIBRATION_SKILL"],
  ["none", "CALIBRATION_NONE_LEAK"],
  ["shell", "CALIBRATION_SHELL"],
  ["config", "CALIBRATION_CONFIG"],
  ["usersim", "CALIBRATION_USERSIM"],
  ["egress", "CALIBRATION_EGRESS"],
];

/** 3, then 1, then 2, then 0. */
export function exitOf(codes: Iterable<ReasonCode>): ExitCode {
  const exits = new Set([...codes].map((c) => CODES[c].exit));
  return exits.has(3) ? 3 : exits.has(1) ? 1 : exits.has(2) ? 2 : 0;
}

export const verdictOf = (exit: ExitCode): Verdict => (exit === 0 ? "PASS" : exit === 1 ? "FAIL" : "INCOMPLETE");

function validate(input: VerdictInput): void {
  const problems: string[] = [];
  const dupes = (list: string[]) => list.filter((x, i) => list.indexOf(x) !== i);
  const tasks = new Set(input.tasks.map((t) => t.id));
  for (const [what, list] of [["task", input.tasks.map((t) => t.id)], ["model", input.models], ["arm", input.arms]] as const) {
    for (const d of new Set(dupes([...list]))) problems.push("duplicate " + what + " " + d);
  }
  if (!input.models.length) problems.push("no model");
  for (const arm of ["before", "after"]) if (!input.arms.includes(arm)) problems.push("the arms lack " + arm);
  for (const model of input.models) if (!input.calibration[model]) problems.push("no calibration result for " + model);
  const seen = new Set<string>();
  for (const r of input.records) {
    const key = [r.model, r.arm, r.task, r.round, r.trial].join(" ");
    if (!input.models.includes(r.model) || !input.arms.includes(r.arm) || !tasks.has(r.task)) problems.push("a record names an unknown model, arm or task: " + key);
    if ((r.round !== 1 && r.round !== 2) || !Number.isSafeInteger(r.trial)) problems.push("a record has a bad round or trial: " + key);
    if (seen.has(key)) problems.push("duplicate record " + key);
    seen.add(key);
  }
  for (const s of input.stops) if (CODES[s.code]?.exit !== 2) problems.push("stop " + s.code + " is not an exit 2 code");
  if (problems.length) throw new VerdictInputError(problems.slice(0, 8).join("; "));
}

/** After round 1: the models whose red tasks call for the rerun stage, which reruns every task in every compared arm. */
export function rerunPlan(input: VerdictInput, options: VerdictOptions = DEFAULT_OPTIONS): { model: string; red: string[] }[] {
  validate(input);
  return input.models
    .map((model) => ({ model, red: redTasks(analyzeModel(input, model, input.records.filter((r) => r.model === model && r.round === 1), options).reasons) }))
    .filter((m) => m.red.length);
}

function scheduled(records: readonly TrialRecord[], arm: string): number {
  const perTask = new Map<string, number>();
  for (const r of records) if (r.arm === arm && r.round === 1) perTask.set(r.task, (perTask.get(r.task) ?? 0) + 1);
  return Math.max(0, ...perTask.values());
}

export function decide(input: VerdictInput, options: VerdictOptions = DEFAULT_OPTIONS): Decision {
  validate(input);
  const models = input.models.map((model): ModelVerdict => {
    const own = input.records.filter((r) => r.model === model);
    const first = analyzeModel(input, model, own.filter((r) => r.round === 1), options);
    const red = redTasks(first.reasons);
    const second = own.filter((r) => r.round === 2);
    if (second.length && !red.length) throw new VerdictInputError(model + " has round 2 records but no red task in round 1, so no rerun stage was owed");
    const pooled = second.length ? analyzeModel(input, model, own, options) : first;
    const flaky = second.length ? flakyTasks(first.counts, analyzeModel(input, model, second, options).counts) : [];
    pooled.warnings.push(...flaky.map((t) => reason("FLAKY", t)));
    const mdd = pooled.comparison?.mdd ?? null;
    const rate =
      mdd === null
        ? null
        : simulateFalseNegativeRate({
            tasks: pooled.counts.filter((c) => c.old.n).map((c) => ({ id: c.id, safety: c.safety, old_rate: c.old.k / c.old.n })),
            trials: { before: scheduled(own, "before"), before2: scheduled(own, "before2"), after: scheduled(own, "after") },
            loss: mdd,
            simulations: options.simulations,
            seed: options.seed,
          });
    const calibration = input.calibration[model]!;
    for (const [check, code] of CALIBRATION) if (calibration[check] === false) pooled.reasons.push(reason(code));
    for (const s of input.stops) if (s.model === model) pooled.reasons.push(reason(s.code, s.subject));
    return {
      ...pooled,
      verdict: "PASS",
      exit_code: 0,
      calibration,
      rerun: {
        name: RERUN_STAGE,
        red,
        state: !red.length ? "not-needed" : second.length ? "done" : "missing",
        flaky,
        simulated_false_negative_rate: rate === null ? null : { rate, mdd_points: pooled.smallest_detectable_loss.mdd_points!, simulations: options.simulations, seed: options.seed },
      },
    };
  });

  const attempted = models.filter((m) => m.margin?.attempted);
  const adjusted = holmAdjusted(attempted.map((m) => m.margin!.p!));
  attempted.forEach((m, i) => {
    m.margin!.p_holm = adjusted[i]!;
    m.margin!.noninferior = adjusted[i]! < ALPHA;
  });
  for (const m of models) {
    if (m.margin && !m.margin.attempted) m.reasons.push(reason("MARGIN_NOT_ATTEMPTED", m.margin.reason));
    if (m.margin?.noninferior === false) m.reasons.push(reason("NOT_NONINFERIOR"));
    m.exit_code = exitOf(m.reasons.map((r) => r.code));
    m.verdict = verdictOf(m.exit_code);
  }

  const runStops = input.stops.filter((s) => s.model === null).map((s) => reason(s.code, s.subject));
  const named = (m: ModelVerdict, list: Reason[]) => list.map((r) => reasonText(r) + (models.length > 1 ? " on " + m.model : ""));
  const exit = exitOf([...models.flatMap((m) => m.reasons.map((r) => r.code)), ...runStops.map((r) => r.code)]);
  const exit2 = [...models.flatMap((m) => m.reasons), ...runStops].filter((r) => CODES[r.code].exit === 2);
  return {
    verdict: verdictOf(exit),
    exit_code: exit,
    reasons: [...models.flatMap((m) => named(m, m.reasons)), ...runStops.map(reasonText)],
    warnings: models.flatMap((m) => named(m, m.warnings)),
    resumable: exit === 2 && exit2.every((r) => CODES[r.code].exit === 2 && (CODES[r.code] as { resumable: boolean }).resumable),
    models,
  };
}
