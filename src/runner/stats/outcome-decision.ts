// The decision test of the outcome-per-skill plan v3 (build step O4, plan v3 section 13) for one told-minus-none
// contrast, as the G family's admission prereg freezes it (wiki/plans/2026-11-04-geva-262-g-family-admission-prereg,
// section 8). Each task's arm score is the mean of its scored trials, tasks pair across arms, delta is the mean paired
// difference and z is delta over the cluster-robust standard error over repositories, as paired.ts (clusteredPairedDelta)
// and lanes/real-outcome/score/analysis.ts (compare) compute them. A reading is helps or hurts only when |z| > 1.959964
// and the exact repository sign-flip one-sided p in z's direction is at most 0.025, counted inclusively as paired.ts
// counts it. A control arm that solved more than 85% of its trials makes no claim. There is no efficacy interim: the
// panel reads once. Above 5% truncated trials in either arm, a claim needs the readings with and without them to agree.
//
// The sign-flip p is exact for any number of repositories. paired.ts enumerates every pattern up to 20 clusters and
// draws patterns above that. Here each task's difference is a whole multiple of 1/L, L the least common multiple of the
// trial counts, so the null distribution of the cluster sums is a convolution over integers, counted exactly.
//
// The futility look (plan v3 section 6) is power.py's B-value conditional power at the panel's frozen random half, at
// information t = 1/2, for plus and for minus the planned MDD. Its standard error is power.py's: cluster-robust over the
// panel's repositories, each counted whether or not the half holds one of its tasks. It stops only when both conditional
// powers are under 10%, and never for efficacy.
import { clusteredPairedDelta, type PairedItem } from "./paired.ts";

export interface OutcomeTrial {
  task: string;
  repo: string;
  arm: string;
  trial: number;
  /** scored: a valid trial. gap: a rig, provider or proxy failure still a gap after its one rerun. contaminated: read a gstack file in an arm that must not. */
  status: "scored" | "gap" | "contaminated";
  solved: boolean;
  /** An arm stop: the session hit its turn cap, dollar allowance or wall limit and is scored unsolved at the stop. */
  truncated: boolean;
  /** The session's metered model dollars, as the proxy settled them on its U4 lease; null when no meter record exists. */
  cost_usd: number | null;
  /** Told trials: whether the skill's exposure detector found its steps; null on other arms. */
  exposed: boolean | null;
}

export interface Arms {
  control: string;
  treatment: string;
}

export interface DecisionConfig {
  boundary: number;
  agree: number;
  ceiling: number;
  truncation_guard: number;
  bootstrap: { seed: number; draws: number };
}

/** G's confirmatory test (prereg section 8, the Captain's d1a), with the lane's bootstrap for the reported interval. */
export const G_DECISION: DecisionConfig = { boundary: 1.959964, agree: 0.025, ceiling: 0.85, truncation_guard: 0.05, bootstrap: { seed: 20261031, draws: 10000 } };

export type Verdict = "helps" | "hurts" | "not_distinguished" | "ceiling";

function fraction(level: number): [bigint, bigint] {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(level));
  if (!m) throw new Error("a level must be a plain decimal share such as 0.025, not " + String(level));
  const digits = m[2] ?? "";
  return [BigInt(m[1]! + digits), 10n ** BigInt(digits.length)];
}

function count(x: number | bigint): bigint {
  if (typeof x === "bigint") return x;
  if (!Number.isSafeInteger(x) || x < 0) throw new Error("a count must be a whole number, not " + x);
  return BigInt(x);
}

/** x / of > level, exactly. */
export function shareAbove(x: number | bigint, of: number | bigint, level: number): boolean {
  const [p, q] = fraction(level);
  return count(x) * q > p * count(of);
}

/** x / of <= level, exactly. */
export function shareAtMost(x: number | bigint, of: number | bigint, level: number): boolean {
  return !shareAbove(x, of, level);
}

/** x / of >= level, exactly. */
export function shareAtLeast(x: number | bigint, of: number | bigint, level: number): boolean {
  const [p, q] = fraction(level);
  return count(x) * q >= p * count(of);
}

/** Each task's repository, after refusing input no reading can trust: a trial listed twice, a task in two repositories, or an arm stop scored solved. */
export function taskRepos(trials: readonly OutcomeTrial[]): Map<string, string> {
  const seen = new Set<string>();
  const repos = new Map<string, string>();
  for (const t of trials) {
    if (!t.task || !t.repo || !t.arm) throw new Error("a trial needs a task, a repository and an arm: " + JSON.stringify(t));
    if (t.status !== "scored" && t.status !== "gap" && t.status !== "contaminated") throw new Error("trial " + t.trial + " of arm " + t.arm + " on task " + t.task + " has status " + JSON.stringify(t.status) + ", not scored, gap or contaminated");
    const key = JSON.stringify([t.arm, t.task, t.trial]);
    if (seen.has(key)) throw new Error("trial " + t.trial + " of arm " + t.arm + " on task " + t.task + " is listed twice");
    seen.add(key);
    const r = repos.get(t.task);
    if (r !== undefined && r !== t.repo) throw new Error("task " + t.task + " is in two repositories, " + r + " and " + t.repo);
    repos.set(t.task, t.repo);
    if (t.truncated && t.solved) throw new Error("trial " + t.trial + " of arm " + t.arm + " on task " + t.task + " is an arm stop, which is scored unsolved at the stop");
  }
  return repos;
}

/** One paired task: solved and scored trial counts in each arm. a is the control, b the treatment. */
export interface TaskCounts {
  task: string;
  cluster: string;
  a_solved: number;
  a_trials: number;
  b_solved: number;
  b_trials: number;
}

/** Exact sign-flip counts over all 2^g patterns of cluster signs: patterns whose sum is at least, at most, and at least in size, the observed one. */
export interface SignFlip {
  clusters: number;
  patterns: bigint;
  greater: bigint;
  less: bigint;
  two_sided: bigint;
}

/** The exact sign-flip distribution of integer cluster sums, by convolution; a tie with the observed sum counts (inclusive). */
export function exactSignFlip(sums: readonly number[]): SignFlip {
  if (!sums.length || !sums.every((s) => Number.isSafeInteger(s))) throw new Error("the sign-flip test needs one or more whole-number cluster sums");
  const g = sums.length;
  const size = sums.map((s) => Math.abs(s));
  const reach = size.reduce((a, s) => a + s, 0);
  const observed = sums.reduce((a, s) => a + s, 0);
  const width = 2 * reach + 1;
  let greater = 0n, less = 0n, two = 0n;
  const tally = (v: number, c: bigint) => {
    if (v >= observed) greater += c;
    if (v <= observed) less += c;
    if (Math.abs(v) >= Math.abs(observed)) two += c;
  };
  if (g <= 52) {
    let cur = new Float64Array(width);
    cur[reach] = 1;
    let span = 0;
    for (const s of size) {
      const next = new Float64Array(width);
      for (let t = reach - span; t <= reach + span; t++) {
        const c = cur[t]!;
        if (c !== 0) {
          next[t + s] += c;
          next[t - s] += c;
        }
      }
      span += s;
      cur = next;
    }
    for (let t = 0; t < width; t++) if (cur[t] !== 0) tally(t - reach, BigInt(cur[t]!));
  } else {
    let cur = new Array<bigint>(width).fill(0n);
    cur[reach] = 1n;
    let span = 0;
    for (const s of size) {
      const next = new Array<bigint>(width).fill(0n);
      for (let t = reach - span; t <= reach + span; t++) {
        const c = cur[t]!;
        if (c !== 0n) {
          next[t + s] = next[t + s]! + c;
          next[t - s] = next[t - s]! + c;
        }
      }
      span += s;
      cur = next;
    }
    for (let t = 0; t < width; t++) if (cur[t] !== 0n) tally(t - reach, cur[t]!);
  }
  return { clusters: g, patterns: 1n << BigInt(g), greater, less, two_sided: two };
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Cluster sums of the paired differences in units of 1/scale, sorted by cluster id; ids, when given, are every cluster the variance counts. */
function clusterSums(cells: readonly TaskCounts[], ids?: readonly string[]) {
  let scale = 1;
  for (const c of cells) {
    for (const [s, n] of [[c.a_solved, c.a_trials], [c.b_solved, c.b_trials]] as const) {
      if (!Number.isSafeInteger(n) || n < 1 || !Number.isSafeInteger(s) || s < 0 || s > n) throw new Error("task " + c.task + " has " + s + " solved of " + n + " trials, which is not a count");
      scale = (scale / gcd(scale, n)) * n;
    }
  }
  const by = new Map<string, { sum: number; count: number }>();
  for (const id of ids ?? []) by.set(id, { sum: 0, count: 0 });
  for (const c of cells) {
    const e = by.get(c.cluster);
    if (!e && ids) throw new Error("task " + c.task + " is in repository " + c.cluster + ", which is not one of the panel's");
    const x = e ?? { sum: 0, count: 0 };
    x.sum += c.b_solved * (scale / c.b_trials) - c.a_solved * (scale / c.a_trials);
    x.count += 1;
    by.set(c.cluster, x);
  }
  const sums = [...by.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, e]) => e);
  return { scale, sums };
}

function moments(scale: number, sums: readonly { sum: number; count: number }[], n: number) {
  const g = sums.length;
  const total = sums.reduce((s, e) => s + e.sum, 0);
  const se = g > 1 ? Math.sqrt((g / (g - 1)) * sums.reduce((s, e) => s + (e.sum - (total * e.count) / n) ** 2, 0)) / (n * scale) : null;
  return { delta: total / (n * scale), se, g };
}

export interface Decision {
  verdict: Verdict;
  tasks: number;
  clusters: number;
  delta: number;
  se: number | null;
  z: number | null;
  crossed: boolean;
  agrees: boolean;
  direction: 1 | -1 | 0;
  /** Counted only when z crossed its boundary. */
  flip: SignFlip | null;
  note: string | null;
}

/** The decision on paired task counts; control is the control arm's solved and scored trials in scope, which the ceiling reads. */
export function decideCells(cells: readonly TaskCounts[], control: { solved: number; trials: number }, cfg: DecisionConfig = G_DECISION): Decision {
  if (!cells.length) return { verdict: "not_distinguished", tasks: 0, clusters: 0, delta: 0, se: null, z: null, crossed: false, agrees: false, direction: 0, flip: null, note: "no task has a scored trial in both arms" };
  const { scale, sums } = clusterSums(cells);
  const m = moments(scale, sums, cells.length);
  const z = m.se !== null && m.se > 0 ? m.delta / m.se : null;
  const crossed = z !== null && Math.abs(z) > cfg.boundary;
  const direction: 1 | -1 | 0 = !crossed ? 0 : z! > 0 ? 1 : -1;
  const flip = crossed ? exactSignFlip(sums.map((s) => s.sum)) : null;
  const agrees = flip !== null && shareAtMost(direction > 0 ? flip.greater : flip.less, flip.patterns, cfg.agree);
  const base = { tasks: cells.length, clusters: sums.length, delta: m.delta, se: m.se, z, crossed, agrees, direction, flip };
  if (control.trials > 0 && shareAbove(control.solved, control.trials, cfg.ceiling)) {
    return { ...base, verdict: "ceiling", note: "the control arm solved " + ((100 * control.solved) / control.trials).toFixed(1) + "% of its trials, above the " + 100 * cfg.ceiling + "% ceiling" };
  }
  if (crossed && agrees) return { ...base, verdict: direction > 0 ? "helps" : "hurts", note: null };
  return { ...base, verdict: "not_distinguished", note: crossed ? "z crossed the boundary but the sign-flip test does not agree" : null };
}

function cellsOf(trials: readonly OutcomeTrial[], arms: Arms, tasks: readonly string[], truncated: boolean, cluster: "repo" | "task", repos: Map<string, string>) {
  const scope = new Set(tasks);
  const by = new Map<string, { a: { solved: number; trials: number }; b: { solved: number; trials: number } }>();
  const control = { solved: 0, trials: 0 };
  for (const t of trials) {
    if (t.status !== "scored" || !scope.has(t.task) || (!truncated && t.truncated)) continue;
    const side = t.arm === arms.control ? "a" : t.arm === arms.treatment ? "b" : null;
    if (!side) continue;
    const e = by.get(t.task) ?? { a: { solved: 0, trials: 0 }, b: { solved: 0, trials: 0 } };
    e[side].trials++;
    if (t.solved) e[side].solved++;
    by.set(t.task, e);
    if (side === "a") {
      control.trials++;
      if (t.solved) control.solved++;
    }
  }
  const cells: TaskCounts[] = [];
  const dropped: string[] = [];
  for (const task of [...scope].sort()) {
    const e = by.get(task);
    if (!e || !e.a.trials || !e.b.trials) {
      dropped.push(task);
      continue;
    }
    cells.push({ task, cluster: cluster === "repo" ? repos.get(task)! : task, a_solved: e.a.solved, a_trials: e.a.trials, b_solved: e.b.solved, b_trials: e.b.trials });
  }
  return { cells, dropped, control };
}

const pairsOf = (cells: readonly TaskCounts[]): PairedItem[] => cells.map((c) => ({ id: c.task, cluster: c.cluster, a: c.a_solved / c.a_trials, b: c.b_solved / c.b_trials }));

export interface ContrastReading {
  cluster: "repo" | "task";
  tasks: number;
  clusters: number;
  control_mean: number;
  treatment_mean: number;
  /** treatment minus control, as a share. */
  delta: number;
  se: number | null;
  z: number | null;
  /** Cluster bootstrap 95% interval (paired.ts). */
  ci95: [number, number] | null;
  /** Exact sign-flip p values over the reading's clusters. */
  p_greater: number;
  p_less: number;
  p_two_sided: number;
  control_share: number | null;
  verdict: Verdict;
  note: string | null;
}

function readingOf(cells: readonly TaskCounts[], control: { solved: number; trials: number }, cluster: "repo" | "task", cfg: DecisionConfig): ContrastReading | null {
  if (!cells.length) return null;
  const d = decideCells(cells, control, cfg);
  const boot = clusteredPairedDelta(pairsOf(cells), cfg.bootstrap);
  const flip = d.flip ?? exactSignFlip(clusterSums(cells).sums.map((s) => s.sum));
  const all = Number(flip.patterns);
  return {
    cluster, tasks: d.tasks, clusters: d.clusters, control_mean: boot.mean_a, treatment_mean: boot.mean_b, delta: d.delta, se: d.se, z: d.z, ci95: boot.ci95,
    p_greater: Number(flip.greater) / all, p_less: Number(flip.less) / all, p_two_sided: Number(flip.two_sided) / all,
    control_share: control.trials ? control.solved / control.trials : null, verdict: d.verdict, note: d.note,
  };
}

export interface Contrast {
  arms: Arms;
  verdict: Verdict;
  note: string | null;
  /** The deciding reading: truncated trials scored unsolved at their stop, clustered by repository. */
  with_truncated: ContrastReading | null;
  without_truncated: ContrastReading | null;
  /** Task-clustered sensitivity; it never decides. */
  task_clustered: ContrastReading | null;
  truncation: { guard: number; control: number; treatment: number; tripped: boolean };
  /** Tasks in scope without a scored trial in both arms. */
  dropped: string[];
}

/** One told-minus-none contrast on a panel, read once (no efficacy interim). scope is the panel's tasks; by default every task either arm ran. */
export function contrast(trials: readonly OutcomeTrial[], arms: Arms, cfg: DecisionConfig = G_DECISION, scope?: readonly string[]): Contrast {
  const repos = taskRepos(trials);
  const tasks = scope ? [...new Set(scope)] : [...new Set(trials.filter((t) => t.arm === arms.control || t.arm === arms.treatment).map((t) => t.task))];
  for (const t of tasks) if (!repos.has(t)) throw new Error("task " + t + " is in the scope but has no trial");
  const inScope = new Set(tasks);
  const shareOf = (arm: string) => {
    let n = 0, k = 0;
    for (const t of trials) {
      if (t.arm !== arm || t.status !== "scored" || !inScope.has(t.task)) continue;
      n++;
      if (t.truncated) k++;
    }
    return { n, k };
  };
  const tc = shareOf(arms.control), tt = shareOf(arms.treatment);
  const tripped = (tc.n > 0 && shareAbove(tc.k, tc.n, cfg.truncation_guard)) || (tt.n > 0 && shareAbove(tt.k, tt.n, cfg.truncation_guard));
  const withT = cellsOf(trials, arms, tasks, true, "repo", repos);
  const withoutT = cellsOf(trials, arms, tasks, false, "repo", repos);
  const byTask = cellsOf(trials, arms, tasks, true, "task", repos);
  const a = readingOf(withT.cells, withT.control, "repo", cfg);
  const b = readingOf(withoutT.cells, withoutT.control, "repo", cfg);
  const va = a?.verdict ?? "not_distinguished", vb = b?.verdict ?? "not_distinguished";
  const refused = tripped && va !== vb;
  const note = refused
    ? "truncation guard: more than " + 100 * cfg.truncation_guard + "% of an arm's trials were truncated and the readings with and without them disagree (" + va + " against " + vb + ")"
    : a ? a.note : "no task has a scored trial in both arms";
  return {
    arms, verdict: refused ? "not_distinguished" : va, note,
    with_truncated: a, without_truncated: b, task_clustered: readingOf(byTask.cells, byTask.control, "task", cfg),
    truncation: { guard: cfg.truncation_guard, control: tc.n ? tc.k / tc.n : 0, treatment: tt.n ? tt.k / tt.n : 0, tripped },
    dropped: withT.dropped,
  };
}

export interface FutilityConfig {
  boundary: number;
  threshold: number;
  /** Information time of the look. */
  t: number;
  bootstrap: { seed: number; draws: number };
}

/** Plan v3 section 6's two-sided futility look, frozen here: power.py's B-value form at t = 1/2, stop when both conditional powers are under 10%. */
export const G_FUTILITY: FutilityConfig = { boundary: 1.959964, threshold: 0.1, t: 0.5, bootstrap: G_DECISION.bootstrap };

export interface FutilityCells {
  tasks: number;
  clusters: number;
  delta: number;
  se: number | null;
  z: number | null;
  /** Conditional power to cross the final boundary toward helps if the true effect is plus the planned MDD, and toward hurts if it is minus it. */
  cp_plus: number;
  cp_minus: number;
  stop: boolean;
}

/** The look on the half's paired counts. clusters lists every repository of the panel; the variance counts each one (power.py's g). */
export function futilityCells(half: readonly TaskCounts[], clusters: readonly string[], mdd: number, cfg: FutilityConfig = G_FUTILITY): FutilityCells {
  if (!(mdd > 0 && mdd < 1)) throw new Error("the planned MDD must be a share between 0 and 1, not " + mdd);
  if (!half.length) throw new Error("the futility look needs paired tasks in its half");
  const { scale, sums } = clusterSums(half, clusters);
  const { delta, se, g } = moments(scale, sums, half.length);
  if (se === null || se === 0) return { tasks: half.length, clusters: g, delta, se, z: null, cp_plus: 1, cp_minus: 1, stop: false };
  const t = cfg.t, sq = Math.sqrt(1 - t);
  const z = delta / se, drift = mdd / (se * Math.sqrt(t));
  const cp_plus = 1 - phi((cfg.boundary - z * Math.sqrt(t) - drift * (1 - t)) / sq);
  const cp_minus = phi((-cfg.boundary - z * Math.sqrt(t) + drift * (1 - t)) / sq);
  return { tasks: half.length, clusters: g, delta, se, z, cp_plus, cp_minus, stop: cp_plus < cfg.threshold && cp_minus < cfg.threshold };
}

export interface Futility extends FutilityCells {
  /** Repository bootstrap 95% interval of the interim estimate. */
  ci95: [number, number] | null;
  direction: "helps" | "hurts" | "none";
  /** A stop whose interim estimate favors none: a loss lead, not a plain null (plan v3 section 9). */
  loss_lead: boolean;
}

/** The futility look at the panel's frozen random half (with truncated trials, as the deciding reading scores them). */
export function futilityLook(trials: readonly OutcomeTrial[], arms: Arms, o: { half: readonly string[]; panel: readonly string[]; mdd: number }, cfg: FutilityConfig = G_FUTILITY): Futility {
  const repos = taskRepos(trials);
  const panel = new Set(o.panel);
  if (panel.size !== o.panel.length) throw new Error("the panel lists a task twice");
  for (const t of o.half) if (!panel.has(t)) throw new Error("half task " + t + " is not in the panel");
  const want = Math.floor(o.panel.length / 2);
  if (new Set(o.half).size !== o.half.length || o.half.length !== want) throw new Error("the look reads exactly half of the panel, " + want + " of its " + o.panel.length + " tasks, each once; this half has " + o.half.length);
  for (const t of o.panel) if (!repos.has(t)) throw new Error("panel task " + t + " has no trial");
  const clusters = [...new Set(o.panel.map((t) => repos.get(t)!))];
  const { cells } = cellsOf(trials, arms, o.half, true, "repo", repos);
  const look = futilityCells(cells, clusters, o.mdd, cfg);
  const boot = clusteredPairedDelta(pairsOf(cells), cfg.bootstrap);
  return { ...look, ci95: boot.ci95, direction: look.delta > 0 ? "helps" : look.delta < 0 ? "hurts" : "none", loss_lead: look.stop && look.delta < 0 };
}

/** The standard normal CDF, from erf: its positive power series below |x| / sqrt(2) = 3 and Lentz's continued fraction for erfc above. */
export function phi(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return 1;
  if (x === -Infinity) return 0;
  const y = x / Math.SQRT2;
  if (Math.abs(y) < 3) {
    let term = y, sum = y;
    for (let n = 1; n < 300; n++) {
      term *= (2 * y * y) / (2 * n + 1);
      sum += term;
      if (Math.abs(term) <= 1e-17 * Math.abs(sum)) break;
    }
    return 0.5 * (1 + (2 / Math.sqrt(Math.PI)) * Math.exp(-y * y) * sum);
  }
  const a = Math.abs(y), tiny = 1e-300;
  let f = a, C = a, D = 0;
  for (let i = 1; i < 500; i++) {
    const k = i / 2;
    D = a + k * D;
    D = 1 / (D === 0 ? tiny : D);
    C = a + k / C;
    if (C === 0) C = tiny;
    const step = C * D;
    f *= step;
    if (Math.abs(step - 1) < 1e-16) break;
  }
  const erfc = Math.exp(-a * a) / Math.sqrt(Math.PI) / f;
  return y > 0 ? 1 - 0.5 * erfc : 0.5 * erfc;
}
