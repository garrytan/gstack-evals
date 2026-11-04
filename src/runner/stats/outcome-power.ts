// The power re-simulation of the outcome-per-skill plan v3 (build step O4): the G admission prereg's power.py
// (wiki/plans/2026-11-04-geva-262-g-family-admission-prereg, section 8) with its data model, layouts and seeds' roles
// kept, but every reading made by this scorer's own code: decideCells for the decision test and futilityCells for the
// futility look (outcome-decision.ts). So it shows the scorer as built reaching the power, null size and futility
// behavior the prereg printed, within Monte Carlo error. Its random streams are this file's (xoshiro128**), not
// numpy's, so a point matches power.txt to sampling error, not digit for digit; the exact parity on power.py's own
// simulated panels lives in tests/stats/fixtures/g-power-parity.json.
//
// Data model, as power.py: 20 repositories in the most concentrated layout the cap allows; per-task none rate p from
// the control scenario; told rate q = clip(p + d + a_repo + e_task, 0, 1) with e ~ N(0, 0.15) and a_repo sized to the
// stated ICC of the observed task difference, and d solved so the panel's true mean difference E[q - p] equals the
// effect after clipping. Nulls are strict (q = p) or heterogeneous (q = p + clip(h, -min(p, 1 - p), min(p, 1 - p))).
import { decideCells, futilityCells, G_DECISION, G_FUTILITY, shareAtLeast, shareAtMost, type TaskCounts } from "./outcome-decision.ts";

const SEED = 20261104;
const SD_EFF = 0.15;
const STEP = 0.005;

/** A seeded uniform on [0, 1) with 53 random bits, from xoshiro128** seeded by splitmix32. */
export function uniform(seed: number): () => number {
  let x = seed >>> 0;
  const split = () => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = split(), b = split(), c = split(), d = split();
  const next = () => {
    const r = Math.imul(((Math.imul(b, 5) << 7) | (Math.imul(b, 5) >>> 25)) >>> 0, 9) >>> 0;
    const t = b << 9;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = ((d << 11) | (d >>> 21)) >>> 0;
    a >>>= 0; b >>>= 0; c >>>= 0;
    return r;
  };
  return () => ((next() >>> 5) * 67108864 + (next() >>> 6)) / 9007199254740992;
}

class Draws {
  private spare: number | null = null;
  constructor(readonly u: () => number) {}
  normal(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    for (;;) {
      const x = 2 * this.u() - 1, y = 2 * this.u() - 1, s = x * x + y * y;
      if (s > 0 && s < 1) {
        const m = Math.sqrt((-2 * Math.log(s)) / s);
        this.spare = y * m;
        return x * m;
      }
    }
  }
  gamma(a: number): number {
    if (a < 1) return this.gamma(a + 1) * Math.pow(this.u(), 1 / a);
    const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number, v: number;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.u();
      if (u < 1 - 0.0331 * x * x * x * x || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  beta(a: number, b: number): number {
    for (;;) {
      const x = this.gamma(a), y = this.gamma(b);
      if (x + y > 0) return x / (x + y);
    }
  }
}

/** A control scenario: the distribution of per-task none rates (power.py's SCENARIOS). */
export type Pool = { kind: "band" } | { kind: "screened"; x: number } | { kind: "fixed"; mean: number; conc: number };

export const SCENARIOS: Record<string, Pool> = {
  "screened U-pool": { kind: "screened", x: 0.5 },
  "plan v3 band": { kind: "band" },
  "screened flat pool": { kind: "screened", x: 1.0 },
  "mean 0.30": { kind: "fixed", mean: 0.3, conc: 4.0 },
  "mean 0.70": { kind: "fixed", mean: 0.7, conc: 4.0 },
};

/** G's frozen screen (plan v3 section 6, stage 4): 2 none trials, a third on 0 of 2; in band is 1 of 2 or 1 of 3. */
export function screenPass(p: number): number {
  return 2 * p * (1 - p) + (1 - p) ** 2 * p;
}

function drawP(r: Draws, pool: Pool): number {
  if (pool.kind === "band") return r.beta(2.2, 2.2) * 0.7 + 0.15;
  if (pool.kind === "fixed") return r.beta(pool.mean * pool.conc, (1 - pool.mean) * pool.conc);
  for (;;) {
    const c = r.beta(pool.x, pool.x);
    if (r.u() < screenPass(c)) return c;
  }
}

/** power.py's repo_of: as many repositories at the cap as the task count permits, one remainder, the rest at 1 task. */
export function repoLayout(n: number, cap: number, g = 20): { repo: number[]; sizes: number[] } {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(cap) || cap < 1 || n < g || n > cap * g) throw new Error(n + " tasks can't fit " + g + " repositories at 1 to " + cap + " per repository; use " + g + " to " + cap * g + " tasks");
  const a = cap === 1 ? g : Math.min(Math.floor((n - g) / (cap - 1)), g);
  const sizes = a === g ? Array<number>(g).fill(cap) : [...Array<number>(a).fill(cap), n - cap * a - (g - a - 1), ...Array<number>(g - a - 1).fill(1)];
  if (sizes.reduce((s, x) => s + x, 0) !== n || Math.min(...sizes) < 1 || Math.max(...sizes) > cap) throw new Error("layout of " + n + " tasks at cap " + cap + " does not add up");
  return { repo: sizes.flatMap((size, i) => Array<number>(size).fill(i)), sizes };
}

/** Admission item 2: P(at least 7 of 8 sampled told trials exposed) at true exposure rate e, exactly. */
export function exposurePass(e: number): number {
  return e ** 8 + 8 * e ** 7 * (1 - e);
}

/** Admission item 1: P(none solves 5 to 19 of 12 tasks x 2 trials) on tasks drawn from Beta(m conc, (1 - m) conc). */
export function headroomPass(m: number, conc: number, sims: number, seed: number): number {
  const r = new Draws(uniform(seed));
  let pass = 0;
  for (let s = 0; s < sims; s++) {
    let solved = 0;
    for (let t = 0; t < 12; t++) {
      const p = r.beta(m * conc, (1 - m) * conc);
      for (let j = 0; j < 2; j++) if (r.u() < p) solved++;
    }
    if (shareAtLeast(solved, 24, 0.2) && shareAtMost(solved, 24, 0.8)) pass++;
  }
  return pass / sims;
}

/** power.py's calib: the shift d that makes the panel's true mean difference equal eff after clipping, and the repository effect's sd for the ICC. */
function calib(seed: number, pool: Pool, k: number, icc: number, eff: number): { dd: number; sa: number } {
  const r = new Draws(uniform(seed));
  const N = 200000;
  const p = new Float64Array(N), h = new Float64Array(N);
  let v = 0;
  for (let i = 0; i < N; i++) {
    p[i] = drawP(r, pool);
    v += p[i]! * (1 - p[i]!);
  }
  const v0 = (2 * (v / N)) / k + SD_EFF ** 2;
  const sa = icc > 0 ? Math.sqrt((icc / (1 - icc)) * v0) : 0;
  for (let i = 0; i < N; i++) h[i] = r.normal() * SD_EFF + (sa ? r.normal() * sa : 0);
  let lo = -0.5, hi = 1.0;
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) / 2;
    let m = 0;
    for (let i = 0; i < N; i++) m += Math.min(1, Math.max(0, p[i]! + mid + h[i]!)) - p[i]!;
    if (m / N < eff) lo = mid;
    else hi = mid;
  }
  return { dd: (lo + hi) / 2, sa };
}

export interface WorldOptions {
  n: number;
  k: number;
  pool: Pool;
  icc: number;
  sims: number;
  seed: number;
  /** Tasks per repository at most; 3 is the prereg's cap, 8 plan v3's. */
  cap?: number;
}

/** One design's simulated panels, with common random numbers across effects, as power.py's World. */
export class World {
  readonly n: number;
  readonly k: number;
  readonly sims: number;
  readonly repo: number[];
  readonly sizes: number[];
  private readonly ids: string[];
  private readonly p: Float64Array;
  private readonly e: Float64Array;
  private readonly az: Float64Array;
  private readonly UB: Float64Array;
  private readonly A: Int32Array;
  private readonly half: Int32Array;
  private readonly cache = new Map<number, { dd: number; sa: number }>();

  constructor(readonly o: WorldOptions) {
    const { n, k, sims } = o;
    if (!Number.isSafeInteger(k) || k < 1 || !Number.isSafeInteger(sims) || sims < 1) throw new Error("a world needs whole trial and simulation counts");
    this.n = n;
    this.k = k;
    this.sims = sims;
    ({ repo: this.repo, sizes: this.sizes } = repoLayout(n, o.cap ?? 3));
    this.ids = this.sizes.map((_, i) => "r" + String(i).padStart(2, "0"));
    const r = new Draws(uniform(o.seed));
    const g = this.sizes.length;
    this.p = new Float64Array(sims * n);
    for (let i = 0; i < sims * n; i++) this.p[i] = drawP(r, o.pool);
    this.e = new Float64Array(sims * n);
    for (let i = 0; i < sims * n; i++) this.e[i] = r.normal() * SD_EFF;
    this.az = new Float64Array(sims * g);
    for (let i = 0; i < sims * g; i++) this.az[i] = r.normal();
    this.A = new Int32Array(sims * n);
    for (let i = 0; i < sims * n; i++) for (let j = 0; j < k; j++) if (r.u() < this.p[i]!) this.A[i]++;
    this.UB = new Float64Array(sims * n * k);
    for (let i = 0; i < sims * n * k; i++) this.UB[i] = r.u();
    const h = Math.floor(n / 2);
    this.half = new Int32Array(sims * h);
    const order = Array.from({ length: n }, (_, i) => i);
    for (let s = 0; s < sims; s++) {
      for (let i = 0; i < h; i++) {
        const j = i + Math.floor(r.u() * (n - i));
        [order[i], order[j]] = [order[j]!, order[i]!];
        this.half[s * h + i] = order[i]!;
      }
    }
  }

  /** Told's solved counts per task at a true mean effect eff, or under a null. */
  outcomes(eff: number, nullKind?: "strict" | "heterogeneous"): Int32Array {
    const { n, k, sims } = this;
    const g = this.sizes.length;
    let q: (i: number, s: number) => number;
    if (nullKind === "strict") q = (i) => this.p[i]!;
    else if (nullKind === "heterogeneous") {
      const { sa } = calib(SEED + 7, this.o.pool, k, this.o.icc, 0);
      q = (i, s) => {
        const p = this.p[i]!, m = Math.min(p, 1 - p);
        return p + Math.min(m, Math.max(-m, this.e[i]! + sa * this.az[s * g + this.repo[i - s * n]!]!));
      };
    } else {
      if (!this.cache.has(eff)) this.cache.set(eff, calib(SEED + Math.trunc(eff * 1000) + 7, this.o.pool, k, this.o.icc, eff));
      const { dd, sa } = this.cache.get(eff)!;
      q = (i, s) => Math.min(1, Math.max(0, this.p[i]! + dd + this.e[i]! + sa * this.az[s * g + this.repo[i - s * n]!]!));
    }
    const B = new Int32Array(sims * n);
    for (let s = 0; s < sims; s++) {
      for (let t = 0; t < n; t++) {
        const i = s * n + t, qi = q(i, s);
        for (let j = 0; j < k; j++) if (this.UB[i * k + j]! < qi) B[i]++;
      }
    }
    return B;
  }

  cells(B: Int32Array, s: number, tasks?: Int32Array | number[]): TaskCounts[] {
    const list = tasks ?? Array.from({ length: this.n }, (_, t) => t);
    return Array.from(list, (t) => ({ task: "t" + t, cluster: this.ids[this.repo[t]!]!, a_solved: this.A[s * this.n + t]!, a_trials: this.k, b_solved: B[s * this.n + t]!, b_trials: this.k }));
  }

  control(s: number): { solved: number; trials: number } {
    let solved = 0;
    for (let t = 0; t < this.n; t++) solved += this.A[s * this.n + t]!;
    return { solved, trials: this.n * this.k };
  }

  /** Shares of panels the decision test reads helps, hurts and ceiling. */
  read(B: Int32Array): { helps: number; hurts: number; ceiling: number; verdicts: string[] } {
    const verdicts: string[] = [];
    let helps = 0, hurts = 0, ceiling = 0;
    for (let s = 0; s < this.sims; s++) {
      const v = decideCells(this.cells(B, s), this.control(s), G_DECISION).verdict;
      verdicts.push(v);
      if (v === "helps") helps++;
      else if (v === "hurts") hurts++;
      else if (v === "ceiling") ceiling++;
    }
    return { helps: helps / this.sims, hurts: hurts / this.sims, ceiling: ceiling / this.sims, verdicts };
  }

  power(eff: number): { helps: number; hurts: number; ceiling: number } {
    const { helps, hurts, ceiling } = this.read(this.outcomes(eff));
    return { helps, hurts, ceiling };
  }

  /** The panel's frozen random half for simulation s. */
  halfOf(s: number): Int32Array {
    const h = Math.floor(this.n / 2);
    return this.half.subarray(s * h, (s + 1) * h);
  }

  get clusters(): string[] {
    return this.ids;
  }
}

/** power.py's mdd_search: the smallest effect, in 0.5-point steps from 10 to 30 points, with power of at least 80%; null past 30. */
export function mddSearch(w: World): number | null {
  let lo = 20, hi = 60;
  if (w.power(hi * STEP).helps < 0.8) return null;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (w.power(mid * STEP).helps >= 0.8) hi = mid;
    else lo = mid;
  }
  return hi / 2;
}

/** Null size: the shares of helps, hurts and any claim when the true mean difference is 0. */
export function nullSize(w: World, kind: "strict" | "heterogeneous"): { helps: number; hurts: number; any: number } {
  const { helps, hurts } = w.read(w.outcomes(0, kind));
  return { helps, hurts, any: helps + hurts };
}

/** The futility look on simulated panels: the share that stops, and the share that reads helps with the look applied. */
export function futilitySim(w: World, effTrue: number, mddPlan: number): { stop: number; helps: number } {
  const B = effTrue ? w.outcomes(effTrue) : w.outcomes(0, "strict");
  const full = w.read(B).verdicts;
  let stops = 0, helps = 0;
  for (let s = 0; s < w.sims; s++) {
    const stop = futilityCells(w.cells(B, s, w.halfOf(s)), w.clusters, mddPlan, G_FUTILITY).stop;
    if (stop) stops++;
    else if (full[s] === "helps") helps++;
  }
  return { stop: stops / w.sims, helps: helps / w.sims };
}
