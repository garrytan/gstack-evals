// Copyright (c) 2026 Garry Tan. MIT License.
// The real-outcome lane's paired analysis (plan wiki/plans/2026-11-01-geva-87-real-outcome-lane-plan, sections 7 and 9 and
// open items 7, 10, 13 and 14; lanes/real-outcome/score/README.md). Pure: trial evidence and a frozen config in, the
// readings and the verdict out. Models are input (org R54): nothing here names one. Built on src/runner/stats: the
// cluster bootstrap, the sign-flip test and Holm.
import { clusteredPairedDelta, holmAdjusted, type PairedItem } from "../../../src/runner/stats/paired.ts";
import { classifyTrial, DEFAULT_TAXONOMY, ScoreError, type Taxonomy, type TrialEvidence, type TrialOutcome } from "./outcome.ts";
import { Z_FINAL, Z_INTERIM } from "./power.ts";

export const CONFIG_SCHEMA = "real-outcome/analysis-config/v1";
export const ANALYSIS_SCHEMA = "real-outcome/analysis/v1";

export interface AnalysisConfig {
  schema: typeof CONFIG_SCHEMA;
  /** The powered model; its readings carry the verdict and the cut rule. Every other model is descriptive. */
  primary_model: string;
  models: string[];
  treatment: string;
  control: string;
  /** The build panel in its frozen random order. The interim look reads the first half. */
  task_order: string[];
  look: "interim" | "final";
  /** Equivalence margin, as a share (0.07 is 7 points). */
  margin: number;
  /** Ceiling stop: the control arm's shipped-clean share above this makes no claim. */
  ceiling: number;
  /** Truncation guard: above this share of truncated trials in either arm, a claim needs both readings to agree. */
  truncation_guard: number;
  boundaries: { interim: number; final: number };
  bootstrap: { seed: number; draws: number };
  /** Scored replay tasks the cut rule needs before the replay set counts as usable escaped-defect evidence. */
  replay_min_tasks: number;
  /** The thin slice kept the K1 build-flow escaped-defect secondary (the control arm re-created a K1 bug in at least 10% of build trials). */
  k1_secondary_kept: boolean;
  /** Garry accepted the cost tradeoff from metered numbers (the cut rule's fourth condition). */
  cost_accepted: boolean;
  /** Valid trials a task needs in each arm to enter a comparison; fewer drops the task from that comparison. */
  min_trials: number;
}

/** The plan's frozen numbers. A config fills primary_model, models, treatment, control, task_order and look. */
export const PLAN_DEFAULTS = { margin: 0.07, ceiling: 0.85, truncation_guard: 0.05, boundaries: { interim: Z_INTERIM, final: Z_FINAL }, bootstrap: { seed: 20261031, draws: 10000 }, replay_min_tasks: 30, k1_secondary_kept: false, cost_accepted: false, min_trials: 1 };

export function readConfig(raw: unknown): AnalysisConfig {
  const c = { ...PLAN_DEFAULTS, ...(raw as Partial<AnalysisConfig>) } as AnalysisConfig;
  const bad = (m: string): never => {
    throw new ScoreError("E_REAL_SCORE_CONFIG", m);
  };
  if (c.schema !== CONFIG_SCHEMA) bad("schema must be " + CONFIG_SCHEMA);
  if (!Array.isArray(c.models) || !c.models.length || c.models.some((m) => typeof m !== "string" || !m)) bad("models must list every model under test");
  if (new Set(c.models).size !== c.models.length) bad("models has a duplicate");
  if (!c.models.includes(c.primary_model)) bad("primary_model must be one of models");
  if (typeof c.treatment !== "string" || typeof c.control !== "string" || !c.treatment || !c.control || c.treatment === c.control) bad("treatment and control must be two different arms");
  if (!Array.isArray(c.task_order) || !c.task_order.length || new Set(c.task_order).size !== c.task_order.length) bad("task_order must list the build panel once each, in its frozen order");
  if (c.look !== "interim" && c.look !== "final") bad("look must be interim or final");
  for (const k of ["margin", "ceiling", "truncation_guard"] as const) if (!(c[k] > 0 && c[k] < 1)) bad(k + " must be a share between 0 and 1");
  if (!(c.boundaries?.interim > 0 && c.boundaries?.final > 0)) bad("boundaries need interim and final z values");
  if (!Number.isSafeInteger(c.bootstrap?.draws) || c.bootstrap.draws < 1000 || !Number.isSafeInteger(c.bootstrap?.seed)) bad("bootstrap needs an integer seed and at least 1000 draws");
  if (!Number.isSafeInteger(c.min_trials) || c.min_trials < 1) bad("min_trials must be a whole number of at least 1");
  if (!Number.isSafeInteger(c.replay_min_tasks) || c.replay_min_tasks < 1) bad("replay_min_tasks must be a whole number of at least 1");
  return c;
}

/** Standard normal CDF (Abramowitz and Stegun 7.1.26, error under 1.5e-7). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp((-x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export type Cluster = "repo" | "task";
type Metric = (o: TrialOutcome) => number | null;

export interface Reading {
  metric: string;
  cluster: Cluster;
  tasks: number;
  clusters: number;
  /** Tasks in scope with too few valid trials in an arm. */
  dropped: number;
  control_mean: number;
  treatment_mean: number;
  /** treatment minus control, as a share. */
  delta: number;
  se: number | null;
  z: number | null;
  /** Cluster bootstrap 95% interval. */
  ci95: [number, number] | null;
  /** Normal 90% interval (equivalence) and the repeated interval at this look's boundary (stopping-aware). */
  ci90: [number, number] | null;
  rci: [number, number] | null;
  boundary: number;
  p_two_sided: number;
  p_greater: number;
  p_less: number;
  p_method: string;
}

/** One paired comparison: each task's arm score is the mean of its valid trials, tasks pair across arms, and the test
 * clusters by repository or by task. null when no task pairs. */
export function compare(outcomes: readonly TrialOutcome[], o: { metric: string; value: Metric; model: string; tasks: ReadonlySet<string> | null; cluster: Cluster; truncated: boolean; boundary: number }, cfg: AnalysisConfig): Reading | null {
  const cells = new Map<string, { repo: string; c: number[]; t: number[] }>();
  for (const x of outcomes) {
    if (x.model !== o.model || x.status !== "scored" || (o.tasks && !o.tasks.has(x.task)) || (!o.truncated && x.truncated)) continue;
    const v = o.value(x);
    if (v === null) continue;
    const cell = cells.get(x.task) ?? { repo: x.repo, c: [], t: [] };
    if (x.arm === cfg.control) cell.c.push(v);
    else if (x.arm === cfg.treatment) cell.t.push(v);
    else continue;
    cells.set(x.task, cell);
  }
  const mean = (a: number[]) => a.reduce((s, y) => s + y, 0) / a.length;
  const pairs: PairedItem[] = [];
  let dropped = 0;
  for (const [task, cell] of [...cells.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (cell.c.length < cfg.min_trials || cell.t.length < cfg.min_trials) dropped++;
    else pairs.push({ id: task, cluster: o.cluster === "repo" ? cell.repo : task, a: mean(cell.c), b: mean(cell.t) });
  }
  if (o.tasks) dropped += [...o.tasks].filter((t) => !cells.has(t)).length;
  if (!pairs.length) return null;
  const d = clusteredPairedDelta(pairs, cfg.bootstrap);
  const se = d.se_cluster;
  const z = se !== null && se > 0 ? d.delta / se : null;
  const around = (k: number): [number, number] | null => (se !== null && se > 0 ? [d.delta - k * se, d.delta + k * se] : null);
  return { metric: o.metric, cluster: o.cluster, tasks: pairs.length, clusters: d.n_clusters, dropped, control_mean: d.mean_a, treatment_mean: d.mean_b, delta: d.delta, se, z, ci95: d.ci95, ci90: around(1.6448536), rci: around(o.boundary), boundary: o.boundary, p_two_sided: d.p_two_sided, p_greater: d.p_greater, p_less: d.p_less, p_method: d.p_method };
}

/** Whether a reading crosses its boundary, and whether the sign-flip test agrees: its one-sided p in the estimate's
 * direction is at most the boundary's one-sided level. */
export function crossing(r: Reading | null): { crossed: boolean; agrees: boolean; direction: 1 | -1 | 0 } {
  if (!r || r.z === null || Math.abs(r.z) <= r.boundary) return { crossed: false, agrees: false, direction: 0 };
  const direction = r.z > 0 ? 1 : -1;
  return { crossed: true, agrees: (direction === 1 ? r.p_greater : r.p_less) <= 1 - normalCdf(r.boundary), direction };
}

const within = (ci: [number, number] | null, m: number): boolean => ci !== null && ci[0] > -m && ci[1] < m;

export type Verdict = "treatment_better" | "treatment_worse" | "same_within_margin" | "not_distinguished" | "ceiling" | "continue";

export interface LookResult {
  look: "interim" | "final";
  tasks_in_scope: number;
  /** The control arm's shipped-clean share over its scored trials in scope (the ceiling rule reads it). */
  control_clean_share: number | null;
  reading: Reading | null;
  verdict: Verdict;
  note: string | null;
}

const BUILD = (o: TrialOutcome) => o.family === "build";
const metricOf = (k: "shipped_clean" | "shipped_defective" | "escaped_defect" | "regression" | "not_shipped" | "acts" | "turn1_clean"): Metric => (o) => (BUILD(o) ? o[k] : null);

function controlShare(outcomes: readonly TrialOutcome[], cfg: AnalysisConfig, model: string, tasks: ReadonlySet<string>, truncated: boolean): number | null {
  const xs = outcomes.filter((o) => o.model === model && o.arm === cfg.control && o.status === "scored" && BUILD(o) && tasks.has(o.task) && (truncated || !o.truncated));
  return xs.length ? xs.reduce((s, o) => s + (o.shipped_clean ?? 0), 0) / xs.length : null;
}

/** One look at the primary (shipped clean), for one reading (with or without truncated trials). */
function look(outcomes: readonly TrialOutcome[], cfg: AnalysisConfig, model: string, which: "interim" | "final", tasks: ReadonlySet<string>, truncated: boolean, cluster: Cluster, interimStopped: boolean): LookResult {
  const boundary = which === "interim" ? cfg.boundaries.interim : cfg.boundaries.final;
  const reading = compare(outcomes, { metric: "shipped_clean", value: metricOf("shipped_clean"), model, tasks, cluster, truncated, boundary }, cfg);
  const share = controlShare(outcomes, cfg, model, tasks, truncated);
  const base = { look: which, tasks_in_scope: tasks.size, control_clean_share: share, reading };
  if (share !== null && share > cfg.ceiling) return { ...base, verdict: "ceiling", note: "the control arm shipped clean on " + (100 * share).toFixed(1) + "% of trials, above the " + 100 * cfg.ceiling + "% ceiling" };
  const x = crossing(reading);
  if (x.crossed && x.agrees) return { ...base, verdict: x.direction > 0 ? "treatment_better" : "treatment_worse", note: null };
  const disagree = x.crossed ? "z crossed the boundary but the sign-flip test does not agree" : null;
  if (which === "interim") return { ...base, verdict: "continue", note: disagree };
  if (!x.crossed && !interimStopped && within(reading?.ci90 ?? null, cfg.margin)) return { ...base, verdict: "same_within_margin", note: null };
  return { ...base, verdict: "not_distinguished", note: disagree };
}

export interface Primary {
  model: string;
  /** Readings with truncated trials scored on what they shipped (the default) and without them. */
  with_truncated: { interim: LookResult; final: LookResult | null };
  without_truncated: { interim: LookResult; final: LookResult | null };
  /** Task-clustered sensitivity (plan open item 13: repository clustering decides). */
  task_clustered: { interim: LookResult; final: LookResult | null };
  truncation: { control: number; treatment: number; guard: number; tripped: boolean };
  /** The look that decided and its verdict, after the truncation guard. */
  deciding_look: "interim" | "final";
  verdict: Verdict;
  note: string | null;
}

function truncShare(outcomes: readonly TrialOutcome[], model: string, arm: string, tasks: ReadonlySet<string>): number {
  const xs = outcomes.filter((o) => o.model === model && o.arm === arm && o.status === "scored" && BUILD(o) && tasks.has(o.task));
  return xs.length ? xs.filter((o) => o.truncated).length / xs.length : 0;
}

function primary(outcomes: readonly TrialOutcome[], cfg: AnalysisConfig, model: string): Primary {
  const half = new Set(cfg.task_order.slice(0, Math.floor(cfg.task_order.length / 2)));
  const all = new Set(cfg.task_order);
  const run = (truncated: boolean, cluster: Cluster) => {
    const interim = look(outcomes, cfg, model, "interim", half, truncated, cluster, false);
    const stopped = interim.verdict !== "continue";
    const final = cfg.look === "final" && !stopped ? look(outcomes, cfg, model, "final", all, truncated, cluster, false) : null;
    return { interim, final };
  };
  const withT = run(true, "repo");
  const withoutT = run(false, "repo");
  const scope = cfg.look === "interim" ? half : all;
  const truncation = { control: truncShare(outcomes, model, cfg.control, scope), treatment: truncShare(outcomes, model, cfg.treatment, scope), guard: cfg.truncation_guard, tripped: false };
  truncation.tripped = truncation.control > cfg.truncation_guard || truncation.treatment > cfg.truncation_guard;
  const decide = (r: { interim: LookResult; final: LookResult | null }) => r.final ?? r.interim;
  const a = decide(withT), b = decide(withoutT);
  let verdict = a.verdict, note = a.note;
  if (truncation.tripped && (a.verdict !== b.verdict || a.look !== b.look)) {
    verdict = a.look === "interim" && b.look === "interim" ? "continue" : "not_distinguished";
    note = "truncation guard: more than " + 100 * cfg.truncation_guard + "% of an arm's trials were truncated and the readings with and without them disagree (" + a.look + " " + a.verdict + " against " + b.look + " " + b.verdict + ")";
  }
  return { model, with_truncated: withT, without_truncated: withoutT, task_clustered: run(true, "task"), truncation, deciding_look: a.look, verdict, note };
}

export interface FamilyRow {
  metric: string;
  reading: Reading | null;
  /** Task-clustered sensitivity. */
  task_reading: Reading | null;
  /** Holm-adjusted two-sided p within the family; a comparison that cannot pair stays in at p = 1. */
  p_holm: number;
}

function family(outcomes: readonly TrialOutcome[], cfg: AnalysisConfig, model: string, rows: [string, Metric][], tasks: ReadonlySet<string> | null): FamilyRow[] {
  const r = rows.map(([metric, value]) => ({
    metric,
    reading: compare(outcomes, { metric, value, model, tasks, cluster: "repo", truncated: true, boundary: cfg.boundaries.final }, cfg),
    task_reading: compare(outcomes, { metric, value, model, tasks, cluster: "task", truncated: true, boundary: cfg.boundaries.final }, cfg),
  }));
  const holm = holmAdjusted(r.map((x) => x.reading?.p_two_sided ?? 1));
  return r.map((x, i) => ({ ...x, p_holm: holm[i] }));
}

const fam = (o: TrialOutcome, f: TrialOutcome["family"], v: number | null) => (o.family === f ? v : null);

export interface Attribution {
  /** Turn-1 trees graded keyless in both arms: treatment minus control on turn-1 clean. */
  turn1: Reading | null;
  /** Per arm, the mean over tasks of (shipped clean minus turn-1 clean): what the ship turn changed. */
  turn2_change: { control: number | null; treatment: number | null };
  /** Treatment minus control on that change, paired by task. */
  turn2_difference: Reading | null;
  /** Trials whose build turn invoked a skill, per arm. */
  turn1_skill_trials: { control: number; treatment: number };
  /** Scored build trials with no turn-1 grade, left out of these readings. */
  turn1_missing: number;
}

function attribution(outcomes: readonly TrialOutcome[], cfg: AnalysisConfig, model: string, tasks: ReadonlySet<string>): Attribution {
  const opts = { model, tasks, cluster: "repo" as Cluster, truncated: true, boundary: cfg.boundaries.final };
  const change: Metric = (o) => (BUILD(o) && o.turn1_clean !== null && o.shipped_clean !== null ? o.shipped_clean - o.turn1_clean : null);
  const armChange = (arm: string): number | null => {
    const per = new Map<string, number[]>();
    for (const o of outcomes) {
      const v = o.model === model && o.arm === arm && o.status === "scored" && tasks.has(o.task) ? change(o) : null;
      if (v !== null) per.set(o.task, [...(per.get(o.task) ?? []), v]);
    }
    const means = [...per.values()].map((a) => a.reduce((s, y) => s + y, 0) / a.length);
    return means.length ? means.reduce((s, y) => s + y, 0) / means.length : null;
  };
  const scored = outcomes.filter((o) => o.model === model && o.status === "scored" && BUILD(o) && tasks.has(o.task));
  const skills = (arm: string) => scored.filter((o) => o.arm === arm && o.turn1_skills > 0).length;
  return {
    turn1: compare(outcomes, { ...opts, metric: "turn1_clean", value: metricOf("turn1_clean") }, cfg),
    turn2_change: { control: armChange(cfg.control), treatment: armChange(cfg.treatment) },
    turn2_difference: compare(outcomes, { ...opts, metric: "turn2_change", value: change }, cfg),
    turn1_skill_trials: { control: skills(cfg.control), treatment: skills(cfg.treatment) },
    turn1_missing: scored.filter((o) => o.turn1_clean === null).length,
  };
}

export interface Cell {
  model: string;
  arm: string;
  trials: number;
  scored: number;
  truncated: number;
  infra: Record<string, number>;
  contaminated: number;
  held_draft: number;
  shipped_clean: number | null;
  tree_clean: number | null;
  cost_usd_mean: number | null;
  cost_per_clean_ship: number | null;
  wall_s_mean: number | null;
  by_kind: Record<string, { scored: number; shipped_clean: number | null }>;
  by_stratum: Record<string, { scored: number; shipped_clean: number | null }>;
  flags: number;
  acts_by_kind: Record<string, number>;
}

function cell(outcomes: readonly TrialOutcome[], model: string, arm: string): Cell {
  const xs = outcomes.filter((o) => o.model === model && o.arm === arm);
  const scored = xs.filter((o) => o.status === "scored");
  const build = scored.filter(BUILD);
  const avg = (vs: (number | null)[]) => {
    const ok = vs.filter((v): v is number => v !== null);
    return ok.length ? ok.reduce((s, y) => s + y, 0) / ok.length : null;
  };
  const infra: Record<string, number> = {};
  for (const o of xs) if (o.status === "infra") infra[o.reason ?? "?"] = (infra[o.reason ?? "?"] ?? 0) + 1;
  const group = (key: (o: TrialOutcome) => string) => {
    const g: Record<string, { scored: number; shipped_clean: number | null }> = {};
    for (const k of new Set(build.map(key))) {
      const ys = build.filter((o) => key(o) === k);
      g[k] = { scored: ys.length, shipped_clean: avg(ys.map((o) => o.shipped_clean)) };
    }
    return g;
  };
  const costs = build.map((o) => o.cost_usd).filter((v): v is number => v !== null);
  const cleanShips = build.filter((o) => o.shipped_clean === 1).length;
  const acts_by_kind: Record<string, number> = {};
  for (const o of scored) for (const [k, n] of Object.entries(o.acts_by_kind)) acts_by_kind[k] = (acts_by_kind[k] ?? 0) + n;
  return {
    model, arm, trials: xs.length, scored: scored.length, truncated: scored.filter((o) => o.truncated).length, infra,
    contaminated: xs.filter((o) => o.status === "contaminated").length, held_draft: scored.filter((o) => o.held_draft).length,
    shipped_clean: avg(build.map((o) => o.shipped_clean)), tree_clean: avg(build.map((o) => o.tree_clean)),
    cost_usd_mean: avg(build.map((o) => o.cost_usd)),
    cost_per_clean_ship: costs.length === build.length && cleanShips > 0 ? costs.reduce((s, y) => s + y, 0) / cleanShips : null,
    wall_s_mean: avg(build.map((o) => o.wall_s)),
    by_kind: group((o) => o.kind), by_stratum: group((o) => o.stratum ?? "none"),
    flags: scored.reduce((s, o) => s + o.flags, 0), acts_by_kind,
  };
}

export interface Cut {
  track: "open" | "pending_cost_acceptance" | "closed" | "not_read";
  conditions: { clean_same: boolean; defective_same: boolean; safety_usable: boolean; safety_no_benefit: boolean | null; cost_accepted: boolean };
  defective: { verdict: string; read_by: "test" | "interval90" | "none"; reading: Reading | null };
  safety: string;
  readings: string[];
}

function cutRule(outcomes: readonly TrialOutcome[], cfg: AnalysisConfig, p: Primary, secondaries: FamilyRow[], replay: FamilyRow[]): Cut {
  const conditions = { clean_same: false, defective_same: false, safety_usable: false, safety_no_benefit: null as boolean | null, cost_accepted: cfg.cost_accepted };
  const deciding = p.deciding_look === "final" ? p.with_truncated.final : p.with_truncated.interim;
  const tasks = new Set(p.deciding_look === "interim" ? cfg.task_order.slice(0, Math.floor(cfg.task_order.length / 2)) : cfg.task_order);
  const boundary = p.deciding_look === "interim" ? cfg.boundaries.interim : cfg.boundaries.final;
  const dReading = compare(outcomes, { metric: "shipped_defective", value: metricOf("shipped_defective"), model: p.model, tasks, cluster: "repo", truncated: true, boundary }, cfg);
  let defective: Cut["defective"] = { verdict: "not_read", read_by: "none", reading: dReading };
  if (p.verdict === "treatment_better" || p.verdict === "treatment_worse") {
    const x = crossing(dReading);
    defective = { verdict: x.crossed && x.agrees ? (x.direction < 0 ? "treatment_lower" : "treatment_higher") : "not_distinguished", read_by: "test", reading: dReading };
  } else if (deciding?.look === "final" && dReading?.ci90) {
    const ci = dReading.ci90;
    defective = { verdict: within(ci, cfg.margin) ? "same_within_margin" : ci[1] < 0 ? "treatment_lower" : ci[0] > 0 ? "treatment_higher" : "undetermined", read_by: "interval90", reading: dReading };
  }
  if (cfg.look !== "final" || p.deciding_look !== "final") return { track: "not_read", conditions, defective, safety: "not read before the final look", readings: [] };
  conditions.clean_same = p.verdict === "same_within_margin";
  conditions.defective_same = defective.verdict === "same_within_margin";
  const caught = replay.find((r) => r.metric === "replay_caught")!;
  const escaped = secondaries.find((r) => r.metric === "escaped_defect")!;
  const replayUsable = (caught.reading?.tasks ?? 0) >= cfg.replay_min_tasks;
  conditions.safety_usable = replayUsable || cfg.k1_secondary_kept;
  const replayBenefit = replayUsable && caught.reading !== null && ((caught.reading.delta > 0 && caught.p_holm < 0.05) || caught.reading.delta >= cfg.margin);
  const k1Benefit = cfg.k1_secondary_kept && escaped.reading !== null && ((escaped.reading.delta < 0 && escaped.p_holm < 0.05) || -escaped.reading.delta >= cfg.margin);
  conditions.safety_no_benefit = conditions.safety_usable ? !replayBenefit && !k1Benefit : null;
  const safety = !conditions.safety_usable ? "cannot decide: fewer than " + cfg.replay_min_tasks + " scored replay tasks and the K1 build-flow secondary was not kept" : replayBenefit || k1Benefit ? cfg.treatment + " shows an escaped-defect benefit" : "no escaped-defect benefit for " + cfg.treatment;
  const readings: string[] = [];
  if (conditions.clean_same && defective.verdict === "treatment_lower") readings.push(cfg.treatment + " stops bad merges at the same clean-ship rate");
  if (conditions.clean_same && replayBenefit) readings.push(cfg.treatment + " stops escaped bugs the build flow did not surface");
  const all = conditions.clean_same && conditions.defective_same && conditions.safety_usable && conditions.safety_no_benefit === true;
  return { track: all ? (cfg.cost_accepted ? "open" : "pending_cost_acceptance") : "closed", conditions, defective, safety, readings };
}

export interface ModelResult {
  model: string;
  primary: Primary;
  secondaries: FamilyRow[];
  replay: FamilyRow[];
  attribution: Attribution;
  cells: { control: Cell; treatment: Cell };
}

export interface Analysis {
  schema: typeof ANALYSIS_SCHEMA;
  config: AnalysisConfig;
  taxonomy: string;
  trials: { total: number; analysed: number; ignored: Record<string, number> };
  /** Build trials whose task is not in task_order, left out of every build reading (a config error for the primary model). */
  outside_order: Record<string, number>;
  verdict: Verdict;
  note: string | null;
  cut: Cut;
  models: ModelResult[];
}

export function analyze(evidence: readonly TrialEvidence[], cfg: AnalysisConfig, taxonomy: Taxonomy = DEFAULT_TAXONOMY): Analysis {
  const ignored: Record<string, number> = {};
  const outcomes: TrialOutcome[] = [];
  for (const e of evidence) {
    if (!cfg.models.includes(e.model) || (e.arm !== cfg.control && e.arm !== cfg.treatment)) {
      const k = e.model + " / " + e.arm;
      ignored[k] = (ignored[k] ?? 0) + 1;
      continue;
    }
    outcomes.push(classifyTrial(e, taxonomy));
  }
  const order = new Set(cfg.task_order);
  const outside_order: Record<string, number> = {};
  for (const o of outcomes) if (BUILD(o) && !order.has(o.task)) outside_order[o.model] = (outside_order[o.model] ?? 0) + 1;
  if (outside_order[cfg.primary_model]) throw new ScoreError("E_REAL_SCORE_CONFIG", outside_order[cfg.primary_model] + " build trial(s) of " + cfg.primary_model + " have a task that is not in task_order; the frozen order must cover the build panel");
  const scope = new Set(cfg.look === "interim" ? cfg.task_order.slice(0, Math.floor(cfg.task_order.length / 2)) : cfg.task_order);
  const models = cfg.models.map((model): ModelResult => {
    const p = primary(outcomes, cfg, model);
    const secondaries = family(outcomes, cfg, model, [
      ["escaped_defect", (o) => (BUILD(o) && o.kind === "K1" ? o.escaped_defect : null)],
      ["regression", metricOf("regression")],
      ["not_shipped", metricOf("not_shipped")],
      ["acts", metricOf("acts")],
    ], scope);
    const replay = family(outcomes, cfg, model, [
      ["replay_caught", (o) => fam(o, "replay", o.caught)],
      ["decoy_shipped_clean", (o) => fam(o, "decoy", o.decoy_clean)],
      ["replay_held", (o) => fam(o, "replay", o.held)],
      ["decoy_held", (o) => fam(o, "decoy", o.held)],
    ], null);
    return { model, primary: p, secondaries, replay, attribution: attribution(outcomes, cfg, model, scope), cells: { control: cell(outcomes, model, cfg.control), treatment: cell(outcomes, model, cfg.treatment) } };
  });
  const main = models.find((m) => m.model === cfg.primary_model)!;
  return {
    schema: ANALYSIS_SCHEMA, config: cfg, taxonomy: taxonomy.version,
    trials: { total: evidence.length, analysed: outcomes.length, ignored }, outside_order,
    verdict: main.primary.verdict, note: main.primary.note,
    cut: cutRule(outcomes, cfg, main.primary, main.secondaries, main.replay),
    models,
  };
}

const pct = (x: number | null | undefined): string => (x === null || x === undefined ? "-" : (100 * x).toFixed(1));
const ivl = (c: [number, number] | null): string => (c ? "[" + pct(c[0]) + ", " + pct(c[1]) + "]" : "-");
const row = (r: Reading | null, extra = ""): string =>
  r === null ? "| no pairs | | | | | |" : "| " + r.metric + " | " + r.tasks + " (" + r.clusters + " " + r.cluster + "s) | " + pct(r.control_mean) + " | " + pct(r.treatment_mean) + " | " + pct(r.delta) + " " + ivl(r.ci95) + " | " + (r.z === null ? "-" : r.z.toFixed(2)) + " | " + r.p_two_sided.toFixed(4) + extra + " |";

/** A plain report of the analysis, in percentage points. */
export function renderMarkdown(a: Analysis): string {
  const c = a.config;
  const out: string[] = ["# Real-outcome analysis (" + c.look + " look)", "", "Treatment " + c.treatment + " against control " + c.control + ". Primary model " + c.primary_model + "; models " + c.models.join(", ") + ". Taxonomy " + a.taxonomy + ".", "", "Verdict: **" + a.verdict + "**" + (a.note ? " (" + a.note + ")" : "") + ". Cut track: " + a.cut.track + ". Safety: " + a.cut.safety + "." + (a.cut.readings.length ? " " + a.cut.readings.join("; ") + "." : "")];
  const head = "| metric | tasks | control % | treatment % | difference, 95% interval | z | p |";
  for (const m of a.models) {
    const p = m.primary;
    out.push("", "## " + m.model + (m.model === c.primary_model ? " (primary)" : " (descriptive)"), "", "Verdict " + p.verdict + " at the " + p.deciding_look + " look" + (p.note ? " (" + p.note + ")" : "") + ". Truncated: control " + pct(p.truncation.control) + "%, treatment " + pct(p.truncation.treatment) + "% (guard " + pct(p.truncation.guard) + "%" + (p.truncation.tripped ? ", tripped" : "") + ").", "", head, "|---|---|---|---|---|---|---|");
    for (const [label, r] of [["with truncated", p.with_truncated], ["without truncated", p.without_truncated], ["task-clustered", p.task_clustered]] as const) {
      const l = r.final ?? r.interim;
      out.push(row(l.reading, ", " + label + ", " + l.look + " " + l.verdict));
    }
    out.push("", "Secondaries (Holm):", "", head, "|---|---|---|---|---|---|---|", ...m.secondaries.map((s) => row(s.reading, ", Holm " + s.p_holm.toFixed(4))));
    out.push("", "Ship-replay family (Holm, never pooled into the headline):", "", head, "|---|---|---|---|---|---|---|", ...m.replay.map((s) => row(s.reading, ", Holm " + s.p_holm.toFixed(4))));
    const at = m.attribution;
    out.push("", "Attribution: turn-2 change control " + pct(at.turn2_change.control) + ", treatment " + pct(at.turn2_change.treatment) + "; build-turn skill trials control " + at.turn1_skill_trials.control + ", treatment " + at.turn1_skill_trials.treatment + "; turn-1 grade missing " + at.turn1_missing + ".", "", head, "|---|---|---|---|---|---|---|", row(at.turn1), row(at.turn2_difference));
    out.push("", "| arm | trials | scored | truncated | infra | contaminated | shipped clean % | tree clean % | cost per trial | cost per clean ship |", "|---|---|---|---|---|---|---|---|---|---|");
    for (const x of [m.cells.control, m.cells.treatment]) out.push("| " + x.arm + " | " + x.trials + " | " + x.scored + " | " + x.truncated + " | " + Object.values(x.infra).reduce((s, y) => s + y, 0) + " | " + x.contaminated + " | " + pct(x.shipped_clean) + " | " + pct(x.tree_clean) + " | " + (x.cost_usd_mean?.toFixed(2) ?? "-") + " | " + (x.cost_per_clean_ship?.toFixed(2) ?? "-") + " |");
  }
  return out.join("\n") + "\n";
}
