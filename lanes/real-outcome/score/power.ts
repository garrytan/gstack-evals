// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless power and screening simulation for the real-outcome lane (plan wiki/plans/2026-11-01-geva-87-real-outcome-lane-plan,
// section 9 and power.md, open item 15). A faithful port of power.md's scripts: the same mulberry32 stream seeded
// 20261031, the same prior, screen, test and grid search, so at power.md's own simulation counts it prints power.md's
// numbers exactly. B6 runs it at 5,000 or more simulations per point and reports each point's Monte Carlo error.
// No model calls.

export const SEED = 20261031;
export const MIN_SIMS = 5000;
/** Final-look boundary of the two-look O'Brien-Fleming design (two-sided alpha 0.048), and the interim one. */
export const Z_FINAL = 1.977;
export const Z_INTERIM = 2.797;

export interface Prior {
  /** Share of valid candidates near ceiling, U(0.9, 1). */
  ceiling: number;
  /** Share near floor, U(0, 0.1). The rest are U(0.1, 0.9). */
  floor: number;
}

export const MAIN_PRIOR: Prior = { ceiling: 0.3, floor: 0.1 };
export const CEILING_PRIOR: Prior = { ceiling: 0.5, floor: 0.1 };

/** power.md's generator and draws, one stream per run. */
export class Stream {
  private a: number;
  constructor(seed = SEED) {
    this.a = seed >>> 0;
  }
  rnd(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  norm(): number {
    let u = 0;
    while (u === 0) u = this.rnd();
    const v = this.rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  bern(p: number, k: number): number {
    let s = 0;
    for (let i = 0; i < k; i++) if (this.rnd() < p) s++;
    return s;
  }
  prior(pr: Prior): number {
    const u = this.rnd();
    if (u < pr.ceiling) return 0.9 + 0.1 * this.rnd();
    if (u < pr.ceiling + pr.floor) return 0.1 * this.rnd();
    return 0.1 + 0.8 * this.rnd();
  }
}

export interface Screen {
  pool: number[];
  candidates: number;
  trials: number;
}

/** Screening as in section 4: 2 none trials, drop 2 of 2; a 0 of 2 task gets a third trial and drops at 0 of 3.
 * power.ts counts screening trials; power-repo.ts does not, so its stream skips nothing either way. */
export function screen(s: Stream, pr: Prior, size: number): Screen {
  const pool: number[] = [];
  let candidates = 0, trials = 0;
  while (pool.length < size) {
    candidates++;
    const p = s.prior(pr);
    const a = s.bern(p, 2);
    trials += 2;
    if (a === 2) continue;
    if (a === 0) {
      trials++;
      if (s.bern(p, 1) === 0) continue;
    }
    pool.push(p);
  }
  return { pool, candidates, trials };
}

export function screenLines(sc: Screen): string[] {
  const mean = sc.pool.reduce((x, y) => x + y, 0) / sc.pool.length;
  const pv = sc.pool.slice(0, 50000).map((p) => p * (1 - p));
  return [
    "screen yield (valid candidates kept): " + ((sc.pool.length / sc.candidates) * 100).toFixed(1) + "%; screening trials per candidate: " + (sc.trials / sc.candidates).toFixed(2) + "; mean true none rate of kept tasks: " + (mean * 100).toFixed(1) + "%",
    "mean p(1-p) of kept tasks: " + (pv.reduce((x, y) => x + y, 0) / pv.length).toFixed(3),
  ];
}

const pick = (s: Stream, pool: number[]): number => pool[Math.floor(s.rnd() * pool.length)];

/** Share of simulated runs whose paired per-task test passes the final boundary: n tasks, k fresh trials per arm,
 * gstack rate clip(p + delta + sd * N(0,1)). */
export function power(s: Stream, pool: number[], n: number, k: number, delta: number, sd: number, sims: number): number {
  let hit = 0;
  for (let i = 0; i < sims; i++) {
    let sum = 0, sum2 = 0;
    for (let j = 0; j < n; j++) {
      const p = pick(s, pool);
      const g = Math.min(1, Math.max(0, p + delta + sd * s.norm()));
      const d = s.bern(g, k) / k - s.bern(p, k) / k;
      sum += d;
      sum2 += d * d;
    }
    const m = sum / n;
    const v = (sum2 - n * m * m) / (n - 1);
    if (Math.abs(m / Math.sqrt(v / n)) > Z_FINAL) hit++;
  }
  return hit / sims;
}

export interface MddPoint {
  /** Smallest difference in points, on power.md's 0.5-point grid from 3 to 25, detected 80% of the time; null past 25. */
  mdd: number | null;
  /** Estimated power at the MDD, and at the grid point below it, each with its Monte Carlo standard error. */
  power: number | null;
  power_se: number | null;
  below: number | null;
  below_se: number | null;
  sims: number;
}

export const mcSe = (p: number, sims: number): number => Math.sqrt((p * (1 - p)) / sims);

/** power.ts's mdd search: d from 0.03 in steps of 0.005 (float accumulation kept, as power.md ran it). */
export function mdd(s: Stream, pool: number[], n: number, k: number, sd: number, sims: number, powerFn: (d: number) => number = (d) => power(s, pool, n, k, d, sd, sims)): MddPoint {
  let prev: number | null = null;
  for (let d = 0.03; d <= 0.25; d += 0.005) {
    const p = powerFn(d);
    if (p >= 0.8) return { mdd: Math.round(d * 1000) / 10, power: p, power_se: mcSe(p, sims), below: prev, below_se: prev === null ? null : mcSe(prev, sims), sims };
    prev = p;
  }
  return { mdd: null, power: null, power_se: null, below: prev, below_se: prev === null ? null : mcSe(prev, sims), sims };
}

export interface GridRow {
  tasks: number;
  trials: number;
  sd10: MddPoint;
  sd15: MddPoint;
  sd20: MddPoint;
}

export interface GridResult {
  screen: string[];
  rows: GridRow[];
}

/** power.ts (main grid), power8.ts (8 trials) and power-ceil.ts (ceiling-heavy prior): one fresh stream each. */
export function grid(o: { prior: Prior; tasks: number[]; trials: number[]; sims: number }): GridResult {
  const s = new Stream(SEED);
  const sc = screen(s, o.prior, 200000);
  const rows: GridRow[] = [];
  for (const n of o.tasks) for (const k of o.trials) rows.push({ tasks: n, trials: k, sd10: mdd(s, sc.pool, n, k, 0.1, o.sims), sd15: mdd(s, sc.pool, n, k, 0.15, o.sims), sd20: mdd(s, sc.pool, n, k, 0.2, o.sims) });
  return { screen: screenLines(sc), rows };
}

export const MAIN_GRID = { prior: MAIN_PRIOR, tasks: [90, 120, 150, 180, 210, 240], trials: [3, 4, 6] };
export const EIGHT_GRID = { prior: MAIN_PRIOR, tasks: [120, 150, 180], trials: [8] };
export const CEILING_GRID = { prior: CEILING_PRIOR, tasks: [240], trials: [4] };

const cell = (p: MddPoint): string => (p.mdd === null ? ">25" : String(p.mdd));

export function gridTable(g: GridResult, withError = false): string[] {
  const out = [...g.screen, "| tasks | trials per arm | MDD, sd 0.10 | MDD, sd 0.15 | MDD, sd 0.20 |", "|---|---|---|---|---|"];
  for (const r of g.rows) out.push("| " + r.tasks + " | " + r.trials + " | " + cell(r.sd10) + " | " + cell(r.sd15) + " | " + cell(r.sd20) + " |");
  if (withError) {
    out.push("", "Monte Carlo error: power at each MDD and at the grid point below it, with standard errors, at " + (g.rows[0]?.sd10.sims ?? 0) + " simulations per point.", "| tasks | trials | sd | MDD | power (se) | power one step below (se) |", "|---|---|---|---|---|---|");
    for (const r of g.rows)
      for (const [sd, p] of [["0.10", r.sd10], ["0.15", r.sd15], ["0.20", r.sd20]] as const)
        out.push("| " + r.tasks + " | " + r.trials + " | " + sd + " | " + cell(p) + " | " + (p.power === null ? "-" : p.power.toFixed(4) + " (" + p.power_se!.toFixed(4) + ")") + " | " + (p.below === null ? "-" : p.below.toFixed(4) + " (" + p.below_se!.toFixed(4) + ")") + " |");
  }
  return out;
}

export interface InterimRow {
  delta: number;
  sd: number;
  interim_stop: number;
  final_difference: number;
  same_within_7: number;
  sims: number;
  /** Monte Carlo standard error of each share. */
  se: { interim_stop: number; final_difference: number; same_within_7: number };
}

/** power-interim.ts: 150 tasks at 8 trials, interim at the first 75 (|z| > 2.797), final |z| > 1.977; equivalence when no
 * boundary is crossed and the final 90% normal interval lies inside +-0.07. It runs after power.ts's screen on one stream. */
export function interim(sims: number): InterimRow[] {
  const s = new Stream(SEED);
  const pool = screen(s, MAIN_PRIOR, 200000).pool;
  const stat = (a: number[]): [number, number] => {
    const n = a.length;
    const m = a.reduce((x, y) => x + y, 0) / n;
    const v = a.reduce((x, y) => x + (y - m) * (y - m), 0) / (n - 1);
    return [m, Math.sqrt(v / n)];
  };
  const rows: InterimRow[] = [];
  for (const sd of [0.1, 0.15, 0.2])
    for (const delta of [0, 0.07, 0.1, 0.15]) {
      let stopI = 0, diffF = 0, equiv = 0;
      for (let i = 0; i < sims; i++) {
        const d: number[] = [];
        for (let j = 0; j < 150; j++) {
          const p = pick(s, pool);
          const g = Math.min(1, Math.max(0, p + delta + sd * s.norm()));
          d.push(s.bern(g, 8) / 8 - s.bern(p, 8) / 8);
        }
        const [m1, se1] = stat(d.slice(0, 75));
        if (Math.abs(m1 / se1) > Z_INTERIM) {
          stopI++;
          continue;
        }
        const [m2, se2] = stat(d);
        if (Math.abs(m2 / se2) > Z_FINAL) {
          diffF++;
          continue;
        }
        if (m2 - 1.645 * se2 > -0.07 && m2 + 1.645 * se2 < 0.07) equiv++;
      }
      const share = (x: number) => x / sims;
      rows.push({ delta, sd, interim_stop: share(stopI), final_difference: share(diffF), same_within_7: share(equiv), sims, se: { interim_stop: mcSe(share(stopI), sims), final_difference: mcSe(share(diffF), sims), same_within_7: mcSe(share(equiv), sims) } });
    }
  return rows;
}

export const interimLines = (rows: InterimRow[]): string[] =>
  rows.map((r) => "delta " + r.delta + " sd " + r.sd + ": interim stop " + (100 * r.interim_stop).toFixed(1) + "%, final difference " + (100 * r.final_difference).toFixed(1) + "%, same within 7 " + (100 * r.same_within_7).toFixed(1) + "%");

export interface RepoRow {
  tasks: number;
  trials: number;
  cells: MddPoint[];
}

export const REPO_SDS: [number, number][] = [[0, 0.15], [0.07, 0.13], [0.1, 0.1], [0.1, 0.15]];

/** power-repo.ts: tasks come 3 per repository, effect delta + u_repo + e_task, test on repository means. */
export function repo(sims: number): { yieldLine: string; rows: RepoRow[] } {
  const s = new Stream(SEED);
  const pool: number[] = [];
  let c = 0;
  while (pool.length < 100000) {
    c++;
    const p = s.prior(MAIN_PRIOR);
    const x = s.bern(p, 2);
    if (x === 2) continue;
    if (x === 0 && s.bern(p, 1) === 0) continue;
    pool.push(p);
  }
  const pw = (n: number, k: number, delta: number, sdr: number, sdt: number): number => {
    const R = n / 3;
    let hit = 0;
    for (let i = 0; i < sims; i++) {
      let sum = 0, sum2 = 0;
      for (let r = 0; r < R; r++) {
        const u = sdr * s.norm();
        let m = 0;
        for (let j = 0; j < 3; j++) {
          const p = pick(s, pool);
          const g = Math.min(1, Math.max(0, p + delta + u + sdt * s.norm()));
          m += s.bern(g, k) / k - s.bern(p, k) / k;
        }
        m /= 3;
        sum += m;
        sum2 += m * m;
      }
      const mu = sum / R;
      const v = (sum2 - R * mu * mu) / (R - 1);
      if (Math.abs(mu / Math.sqrt(v / R)) > Z_FINAL) hit++;
    }
    return hit / sims;
  };
  const rows: RepoRow[] = [];
  for (const [n, k] of [[150, 8], [180, 7], [240, 5]]) rows.push({ tasks: n, trials: k, cells: REPO_SDS.map(([sdr, sdt]) => mdd(s, pool, n, k, 0, sims, (d) => pw(n, k, d, sdr, sdt))) });
  return { yieldLine: "yield " + ((100 * pool.length) / c).toFixed(1) + "%", rows };
}

export const repoTable = (r: { yieldLine: string; rows: RepoRow[] }): string[] => [
  r.yieldLine,
  "| tasks (repos) | trials | sd repo 0, task 0.15 | repo 0.07, task 0.13 | repo 0.10, task 0.10 | repo 0.10, task 0.15 |",
  "|---|---|---|---|---|---|",
  ...r.rows.map((x) => "| " + x.tasks + " (" + x.tasks / 3 + ") | " + x.trials + " | " + x.cells.map(cell).join(" | ") + " |"),
];
