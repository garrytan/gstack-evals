// The G family's one-survivor re-size (outcome-per-skill plan v3, build step O4), ported from the G admission prereg's
// resize.py (wiki/plans/2026-11-04-geva-262-g-family-admission-prereg, section 7) and plan v3's frozen price model
// (cost.py and survivor.py's alone()) and MDD grid (mdd-grid.json times 1.2), in the merged plan bundle. It changes
// none of their numbers, and it keeps Python's float sum (Neumaier's compensated sum, Python 3.12 on) and Python's
// round (half to even) so its prices and its text match theirs byte for byte.
//
// M1 replaces d7's order for G only, as a fixed ladder with no search. Rung 1 is the survivor's planned size priced
// alone (60 x 3 for plan-eng-review, 54 x 3 for autoplan). Rung 2 is n0 x 4 when k0 is under 4. From rung 3 on, k is 4
// and tasks drop by 6 down to 24. The design is the first rung inside the $1,700 plan line whose MDD is at most the
// 20-point bound; with none, the survivor stops as FIX-METHOD (price). The Captain's pick C orders the survivors: a
// skill that fails admission items 1 to 4 stops and the other re-sizes alone; if the both-alive design leaves one skill
// past the bound, it stops and the other re-sizes alone; if both are past it, or no both-alive design fits the plan
// line, plan-eng-review re-sizes alone first, then autoplan if plan-eng-review finds no rung.
import grid from "../../../wiki/plans/2026-11-03-geva-225-outcome-per-skill-plan/mdd-grid.json" with { type: "json" };

export const MDD_GRID: Record<string, number> = grid;

/** Python's sum() of floats: Neumaier's compensated sum, as CPython 3.12 adds them, starting from 0. */
export function pySum(xs: readonly number[]): number {
  let s = 0, c = 0;
  for (const x of xs) {
    const t = s + x;
    c += Math.abs(s) >= Math.abs(x) ? s - t + x : x - t + s;
    s = t;
  }
  return c && Number.isFinite(c) ? s + c : s;
}

/** Python's round() of a float to a whole number: half to even. */
export function pyRound(x: number): number {
  const f = Math.floor(x), d = x - f;
  const r = d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1;
  return r === 0 ? 0 : r;
}

/** Python's repr of a float (and str of None), as resize.py's %s prints it. */
const pyStr = (x: number | null): string => (x === null ? "None" : Number.isInteger(x) && Math.abs(x) < 1e16 ? x.toFixed(1) : String(x));

function pyFloat(name: string, s: string): number {
  const t = s.trim();
  if (/^[+-]?(inf|infinity)$/i.test(t)) return t.startsWith("-") ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(t)) return NaN;
  if (!/^[+-]?(\d[\d_]*(\.[\d_]*)?|\.\d[\d_]*)(e[+-]?\d+)?$/i.test(t)) throw new Error(name + "=" + JSON.stringify(s) + " is not a number");
  return Number(t.replaceAll("_", ""));
}

const DE = 1.2;
/** cost.py's mdd(): the grid's MDD for n tasks and k trials at one-sided level a, times the 1.2 design effect, to one decimal. */
export function mdd(n: number, k: number, a: 0.05 | 0.025): number | null {
  const v = MDD_GRID[n + "," + k + "," + a];
  return v === undefined ? null : Math.round(v * DE * 10) / 10;
}

const V_NONE = 0.191;
const VM = 0.02;
const STAND = 1.25;
/** cost.py's plan line, slice size, MDD bound and task grid. */
export const PLAN = 1700.0;
export const SLICE = 12;
export const BOUND = 20.0;
export const NS: readonly number[] = Array.from({ length: 17 }, (_, i) => 24 + 6 * i);

export type Family = "G" | "U" | "X";
const FAMILIES: readonly Family[] = ["G", "U", "X"];
export const FAM: Record<Family, [string, string]> = { G: ["plan-eng-review", "autoplan"], U: ["plan-design-review", "design-review"], X: ["plan-devex-review", "devex-review"] };
export const G_SKILLS = ["plan-eng-review", "autoplan"] as const;
export type GSkill = (typeof G_SKILLS)[number];
/** Plan v3's both-alive sizes, rung 1 of each skill's ladder. */
export const PLANNED: Record<GSkill, [number, number]> = { "plan-eng-review": [60, 3], autoplan: [54, 3] };
export const ENVELOPE = 10000;
export const CAP = 2000;

/** cost.py's environment (MULT, P1RATIO, AUTH_EXTRA, AGENT_USER, TOLD_SCALE), and resize.py's metered overrides of it (M_PER, M_AP, AUTH_PAID). */
export interface PriceEnv {
  mult: number;
  p1ratio: number;
  authExtra: number;
  agentUser: number;
  toldScale: number;
  mPer?: number;
  mAp?: number;
  authPaid?: number;
}

/** cost.py's reading of its environment, with its defaults. */
export function pyEnv(env: Record<string, string | undefined>): PriceEnv {
  const get = (k: string, d: string) => pyFloat(k, env[k] ?? d);
  return { mult: get("MULT", "2.5"), p1ratio: get("P1RATIO", String(0.019 / 0.236)), authExtra: get("AUTH_EXTRA", "0"), agentUser: get("AGENT_USER", "1.20"), toldScale: get("TOLD_SCALE", "1") };
}

/** cost.py's globals. TOLD and AUTH are the two resize.py overrides with metered values. */
export interface PriceModel {
  NONE: number;
  P1: number;
  TOLD: Record<string, number>;
  MEAS: Record<Family, number>;
  AUTH: Record<Family, number>;
  SCR_T: Record<Family, number>;
  SCR_MEAS: Record<Family, number>;
  YIELD: Record<Family, number>;
  CREW: Record<Family, number>;
  CALIB: Record<Family, number>;
}

/** cost.py's globals at e. M_PER and M_AP replace told's session multiples and AUTH_PAID plus AUTH_EXTRA (1.2 unless given) replaces G's author line, as resize.py's model() does. */
export function priceModel(e: Partial<PriceEnv> & { mult: number }): PriceModel {
  const p1 = e.p1ratio ?? 0.019 / 0.236, ax = e.authExtra ?? 0, u = e.agentUser ?? 1.2, ts = e.toldScale ?? 1;
  const told: Record<string, number> = { "plan-eng-review": 2.2, autoplan: 5.0, "plan-design-review": 2.4, "design-review": 3.0, "plan-devex-review": 2.4, "devex-review": 2.5 };
  const meas = { G: 0.05, U: u, X: 0.4 };
  const TOLD = Object.fromEntries(Object.entries(told).map(([s, m]) => [s, m * ts]));
  if (e.mPer !== undefined) TOLD["plan-eng-review"] = e.mPer;
  if (e.mAp !== undefined) TOLD.autoplan = e.mAp;
  return {
    NONE: V_NONE * e.mult,
    P1: p1,
    TOLD,
    MEAS: meas,
    AUTH: { G: e.authPaid !== undefined ? e.authPaid + (e.authExtra ?? 1.2) : 1.39 + ax, U: 2.78 + ax, X: 2.78 + ax },
    SCR_T: { G: 2.27, U: 1.0, X: 1.0 },
    SCR_MEAS: { G: 0.0, U: meas.U, X: 0.4 },
    YIELD: { G: 0.3, U: 0.4, X: 0.4 },
    CREW: { G: 100 + 150 + 70, U: 100 + 200 + 70, X: 100 + 150 + 70 },
    CALIB: { G: 0.0, U: 12 * 2 * 2 * meas.U, X: 12 * 2 * 2 * 0.4 },
  };
}

type Pair<T> = [T, T];
/** One skill's cost parts, in cost.py's insertion order, which its float sum follows. */
export type Parts = Record<string, number>;
export type PairPricer = (n: Pair<number>, k: number, st: Pair<number>, p1: Pair<number>) => Pair<Parts>;

/** cost.py's costs(): each skill's parts of a both-alive design of family f at n tasks and k trials. */
export function costs(M: PriceModel, f: Family, n: Pair<number>, k: number, st: Pair<number> = [0, 0], p1: Pair<number> = [0, 0]): Pair<Parts> {
  const s = FAM[f], me = M.MEAS[f];
  const N = Math.max(...n), cand = N / M.YIELD[f];
  const shared: Parts = {
    crew: M.CREW[f],
    author: (cand + SLICE) * M.AUTH[f],
    screen: cand * M.SCR_T[f] * (M.NONE + VM + M.SCR_MEAS[f]),
    calib: M.CALIB[f],
    adm_none: SLICE * 2 * (M.NONE + VM + me),
  };
  const lo = Math.min(...n);
  const out = [0, 1].map((i) => {
    const c: Parts = Object.fromEntries(Object.entries(shared).map(([kk, v]) => [kk, v / 2]));
    const told = M.TOLD[s[i]!]!;
    c.adm_told = SLICE * 2 * (M.NONE * told + VM + me);
    const noneTasks = lo / 2 + (n[i]! - lo);
    c.conf_none = noneTasks * k * (M.NONE + VM + me);
    c.conf_told = n[i]! * k * (M.NONE * told + VM + me);
    c.conf_standin = st[i] ? n[i]! * k * (M.NONE * STAND + VM + me) : 0.0;
    if (p1[i]) {
      const both = p1[0] && p1[1];
      const pl = both ? lo : 0;
      const pNone = both ? pl / 2 + (n[i]! - pl) : n[i]!;
      c.p1_adm = SLICE * 2 * (M.NONE * M.P1 * (1 + told) + 2 * (VM + me));
      c.p1_conf = pNone * k * (M.NONE * M.P1 + VM + me) + n[i]! * k * (M.NONE * M.P1 * told + VM + me);
    }
    return c;
  });
  return [out[0]!, out[1]!];
}

export const pairPrice = (M: PriceModel, f: Family): PairPricer => (n, k, st, p1) => costs(M, f, n, k, st, p1);

export const total = (c: Parts) => pySum(Object.values(c));
type Key = [number, number, number];
const less = (a: Key, b: Key) => a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];

export interface PairDesign {
  key: Key;
  n: Pair<number>;
  k: number;
  mdd: Pair<number>;
  parts: Pair<Parts>;
}

/** cost.py's best(): the both-alive design inside the plan line with the smallest larger MDD, then the smallest MDD sum, then the most tasks. */
export function bestPair(price: PairPricer, st: Pair<number> = [0, 0], p1: Pair<number> = [0, 0], ns: readonly number[] = NS): PairDesign | null {
  let top: PairDesign | null = null;
  for (const k of [2, 3, 4]) {
    for (const n1 of ns) {
      for (const n2 of ns) {
        const n: Pair<number> = [n1, n2];
        const cs = price(n, k, st, p1);
        if (cs.some((c) => total(c) > PLAN)) continue;
        const m = [0, 1].map((i) => mdd(n[i]!, k, st[i] ? 0.025 : 0.05));
        if (m[0] === null || m[1] === null) continue;
        const key: Key = [Math.max(m[0]!, m[1]!), pySum([m[0]!, m[1]!]), -(n1 + n2)];
        if (top === null || less(key, top.key)) top = { key, n, k, mdd: [m[0]!, m[1]!], parts: cs };
      }
    }
  }
  return top;
}

const rounded = (cs: Pair<Parts>) => cs.map((c) => Object.fromEntries(Object.entries(c).map(([kk, v]) => [kk, pyRound(v)])));
const tots = (cs: Pair<Parts>) => cs.map((c) => pyRound(total(c)));

/** cost.py's printed plan: per family, the both-alive base and the chosen design with stand-in and particle-1 rows. */
export function costPlan(M: PriceModel) {
  const res: Record<string, unknown> = {};
  for (const f of FAMILIES) {
    const price = pairPrice(M, f);
    const base = bestPair(price);
    if (base === null) {
      res[f] = null;
      continue;
    }
    let choice: { st: Pair<number>; p1: Pair<number>; b: PairDesign } = { st: [0, 0], p1: [0, 0], b: base };
    for (const st of [[0, 0], [0, 1], [1, 0], [1, 1]] as Pair<number>[]) {
      for (const p1 of [[0, 0], [0, 1], [1, 0], [1, 1]] as Pair<number>[]) {
        if (!st[0] && !st[1] && !p1[0] && !p1[1]) continue;
        const b = bestPair(price, st, p1);
        if (b === null) continue;
        if (!(Math.max(...b.mdd) <= BOUND && [0, 1].every((i) => b.mdd[i]! <= base.mdd[i]! + 2.0))) continue;
        const rank: Pair<number> = [st[0] + st[1], p1[0] + p1[1]];
        const cur: Pair<number> = [choice.st[0] + choice.st[1], choice.p1[0] + choice.p1[1]];
        const above = rank[0] !== cur[0] ? rank[0] > cur[0] : rank[1] > cur[1];
        if (above || (rank[0] === cur[0] && rank[1] === cur[1] && less(b.key, choice.b.key))) choice = { st, p1, b };
      }
    }
    const { st, p1, b } = choice;
    res[f] = {
      base: { n: base.n, k: base.k, mdd: base.mdd, tot: tots(base.parts), parts: rounded(base.parts) },
      chosen: { standin: st, p1, n: b.n, k: b.k, mdd: b.mdd, tot: tots(b.parts), parts: rounded(b.parts) },
    };
  }
  return res;
}

/** survivor.py's alone(): one skill of family f passing admission alone, at n tasks and k trials, paying every unspent shared cost. */
export function alone(M: PriceModel, f: Family, s: string, n: number, k: number): number {
  const me = M.MEAS[f], cand = n / M.YIELD[f], told = M.TOLD[s]!;
  let t = M.CREW[f] / 2 + M.CALIB[f] / 2 + (cand + SLICE) * M.AUTH[f] + cand * M.SCR_T[f] * (M.NONE + VM + M.SCR_MEAS[f]);
  t += SLICE * 2 * (M.NONE + VM + me) + SLICE * 2 * (M.NONE * told + VM + me);
  t += n * k * (M.NONE + VM + me) + n * k * (M.NONE * told + VM + me);
  return t;
}

export interface Rung {
  n: number;
  k: number;
  price: number;
  mdd: number | null;
}

export interface Ladder {
  n: number | null;
  k: number | null;
  price: number | null;
  mdd: number | null;
  stops: boolean;
  tried: Rung[];
}

/** alone()'s terms by name, for a projection that replaces the spent ones with settled spend. */
export function aloneParts(M: PriceModel, f: Family, s: string, n: number, k: number): Parts {
  const me = M.MEAS[f], cand = n / M.YIELD[f], told = M.TOLD[s]!;
  return {
    crew: M.CREW[f] / 2,
    calib: M.CALIB[f] / 2,
    slice_author: SLICE * M.AUTH[f],
    author: cand * M.AUTH[f],
    screen: cand * M.SCR_T[f] * (M.NONE + VM + M.SCR_MEAS[f]),
    adm_none: SLICE * 2 * (M.NONE + VM + me),
    adm_told: SLICE * 2 * (M.NONE * told + VM + me),
    conf_none: n * k * (M.NONE + VM + me),
    conf_told: n * k * (M.NONE * told + VM + me),
  };
}

/** M1's ladder from the planned n0 x k0, priced by price(n, k); the first rung inside the plan line and the bound wins. Rungs above maxN (a built panel's size) can't run and are passed over. */
export function ladder(price: (n: number, k: number) => number, n0: number, k0: number, maxN = Infinity): Ladder {
  const rungs: Array<[number, number]> = [[n0, k0]];
  if (k0 < 4) rungs.push([n0, 4]);
  for (let n = n0 - 6; n > 23; n -= 6) rungs.push([n, 4]);
  const tried: Rung[] = [];
  for (const [n, k] of rungs.filter(([n]) => n <= maxN)) {
    const p = price(n, k), m = mdd(n, k, 0.05);
    tried.push({ n, k, price: pyRound(p), mdd: m });
    if (p <= PLAN && m !== null && m <= BOUND) return { n, k, price: pyRound(p), mdd: m, stops: false, tried };
  }
  return { n: null, k: null, price: null, mdd: null, stops: true, tried };
}

/** d7's order, which M1 replaces for G: trials down to 2, then tasks down to 24, until the survivor fits the plan line. */
export function d7(M: PriceModel, s: GSkill, n: number, k: number): { n: number; k: number; mdd: number | null; stops: boolean } {
  const p = () => alone(M, "G", s, n, k);
  while (p() > PLAN && k > 2) k -= 1;
  while (p() > PLAN && n > NS[0]!) n -= 6;
  const m = p() <= PLAN ? mdd(n, k, 0.05) : null;
  return { n, k, mdd: m, stops: m === null || m > BOUND };
}

/** What a skill that stops at admission has settled by then (resize.py's at_admission). */
export function atAdmission(M: PriceModel, s: GSkill): number {
  const me = M.MEAS.G;
  const shared = M.CREW.G + SLICE * M.AUTH.G + SLICE * 2 * (M.NONE + VM + me);
  return shared / 2 + SLICE * 2 * (M.NONE * M.TOLD[s]! + VM + me);
}

/** Admission's metered inputs (prereg section 6, item 5): MULT is none's mean session over a Verified session's $0.191, M_PER and M_AP told's session multiples, AUTH_PAID paid author and audit dollars per valid task, AUTH_EXTRA crew dollars per valid task. */
export interface GMetered {
  MULT: number;
  M_PER?: number;
  M_AP?: number;
  AUTH_PAID?: number;
  AUTH_EXTRA?: number;
}

const NUMERIC = ["MULT", "M_PER", "M_AP", "AUTH_PAID", "AUTH_EXTRA"] as const;

function meteredEnv(m: GMetered): Record<string, string> {
  if (m === null || typeof m !== "object") throw new Error("resize: bad metered input: expected an object of metered values");
  for (const k of Object.keys(m)) {
    if (k === "YIELD_G" || k === "TOLD_SCALE") throw new Error("resize: refused input: " + k + " is set; " + (k === "YIELD_G" ? "G's in-band yield is frozen at plan v3's" : "it names a planning case, not a metered input"));
    if (!(NUMERIC as readonly string[]).includes(k)) throw new Error("resize: bad metered input: " + k + " is not one of " + NUMERIC.join(", "));
  }
  const extra: Record<string, string> = {};
  for (const k of NUMERIC) {
    const v = m[k];
    if (v === undefined) continue;
    if (typeof v !== "number" || !(v > 0 && v < 1000)) throw new Error("resize: bad metered input: " + k + "='" + String(v) + "' is not a positive number; fix: pass the metered value from section 6, item 5");
    extra[k] = String(v);
  }
  if (!("MULT" in extra)) throw new Error("resize: bad metered input: MULT is missing; fix: pass none's metered mean session cost over $0.191 (section 6, item 5)");
  return extra;
}

function overridden(env: Record<string, string>): PriceModel {
  const opt = (k: string) => (env[k] === undefined ? undefined : pyFloat(k, env[k]!));
  return priceModel({ ...pyEnv(env), mPer: opt("M_PER"), mAp: opt("M_AP"), authPaid: opt("AUTH_PAID") });
}

const HOUSE: Record<string, string> = { MULT: "5", P1RATIO: "0.41", AUTH_EXTRA: "1.2" };

/** The price model at admission's metered inputs: G at metered prices, the rest at plan v3's house central. */
export function meteredPricer(m: GMetered): PriceModel {
  return overridden({ P1RATIO: "0.41", AUTH_EXTRA: "1.2", ...meteredEnv(m) });
}

const designOf = (b: PairDesign) => ({ "plan-eng-review": { n: b.n[0], k: b.k, mdd: b.mdd[0], price: pyRound(total(b.parts[0])) }, autoplan: { n: b.n[1], k: b.k, mdd: b.mdd[1], price: pyRound(total(b.parts[1])) } });

export interface Run {
  n: number;
  k: number;
  mdd: number;
  price: number;
}

export interface M1Decision {
  /** The both-alive design when no skill stopped at admission items 1 to 4 and one fits the plan line. */
  both: Record<GSkill, Run> | null;
  /** Skills past the 20-point bound in the both-alive design. */
  over: GSkill[];
  /** What each skill runs at; null when it stops. */
  runs: Record<GSkill, Run | null>;
  ladders: Record<GSkill, Ladder>;
  reason: string;
}

/** Pick C's survivor order over M1's ladders. stopped lists the skills that failed admission items 1 to 4. */
export function m1Decide(M: PriceModel, stopped: readonly GSkill[]): M1Decision {
  for (const s of stopped) if (!(G_SKILLS as readonly string[]).includes(s)) throw new Error("not a G skill: " + s);
  const ladders = { "plan-eng-review": ladder((n, k) => alone(M, "G", "plan-eng-review", n, k), ...PLANNED["plan-eng-review"]), autoplan: ladder((n, k) => alone(M, "G", "autoplan", n, k), ...PLANNED.autoplan) };
  const runOf = (s: GSkill): Run | null => (ladders[s].stops ? null : { n: ladders[s].n!, k: ladders[s].k!, mdd: ladders[s].mdd!, price: ladders[s].price! });
  const only = (s: GSkill | null, reason: string, both: Record<GSkill, Run> | null = null, over: GSkill[] = []): M1Decision => ({
    both, over, ladders, reason,
    runs: { "plan-eng-review": s === "plan-eng-review" ? runOf(s) : null, autoplan: s === "autoplan" ? runOf(s) : null },
  });
  const order = (why: string, both: Record<GSkill, Run> | null = null, over: GSkill[] = []) =>
    !ladders["plan-eng-review"].stops ? only("plan-eng-review", why + "; autoplan stops and plan-eng-review re-sizes alone", both, over)
    : !ladders.autoplan.stops ? only("autoplan", why + "; plan-eng-review finds no alone design and stops, autoplan re-sizes alone", both, over)
    : only(null, why + "; neither finds an alone design: both stop as FIX-METHOD (price)", both, over);
  if (stopped.length) {
    const left = G_SKILLS.filter((s) => !stopped.includes(s));
    if (!left.length) return only(null, "both skills stopped at admission items 1 to 4");
    const s = left[0]!;
    return only(s, stopped.join(", ") + " stopped at admission items 1 to 4; " + s + (ladders[s].stops ? " finds no alone design and stops as FIX-METHOD (price)" : " re-sizes alone"));
  }
  const base = bestPair(pairPrice(M, "G"));
  if (base === null) return order("no both-alive G design fits the $1,700 line");
  const both = designOf(base);
  const over = G_SKILLS.filter((s) => both[s].mdd > BOUND);
  if (!over.length) return { both, over, ladders, runs: { ...both }, reason: "both alive inside the plan line and the bound" };
  if (over.length === 1) {
    const keep: GSkill = over[0] === "plan-eng-review" ? "autoplan" : "plan-eng-review";
    return only(keep, over[0] + " is past the 20-point bound with both alive and stops; " + keep + (ladders[keep].stops ? " finds no alone design and stops as FIX-METHOD (price)" : " re-sizes alone"), both, over);
  }
  return order("both are past the 20-point bound with both alive", both, over);
}

function wave1(M: PriceModel, ref: PriceModel): number {
  let t = 0;
  for (const f of FAMILIES) {
    const b = bestPair(pairPrice(f === "G" ? M : ref, f));
    if (b) t += tots(b.parts).reduce((a, x) => a + x, 0);
  }
  return t;
}

function orderText(l: Record<GSkill, Ladder>): string {
  if (!l["plan-eng-review"].stops) return "autoplan stops at admission item 5 and plan-eng-review re-sizes alone";
  if (!l.autoplan.stops) return "plan-eng-review finds no alone design and stops; autoplan re-sizes alone";
  return "neither finds an alone design: both skills stop at admission as FIX-METHOD (price)";
}

function render(name: string, M: PriceModel, ref: PriceModel): string {
  const out: string[] = [];
  const w1 = wave1(M, ref);
  const base = bestPair(pairPrice(M, "G"));
  const l = { "plan-eng-review": ladder((n, k) => alone(M, "G", "plan-eng-review", n, k), ...PLANNED["plan-eng-review"]), autoplan: ladder((n, k) => alone(M, "G", "autoplan", n, k), ...PLANNED.autoplan) };
  out.push("== " + name);
  let sizes: Record<GSkill, [number, number]> = PLANNED;
  let tot: number[] = [];
  if (base === null) {
    out.push("no both-alive G design fits the $1,700 line: " + orderText(l));
  } else {
    const [n1, n2] = base.n, k = base.k;
    tot = tots(base.parts);
    sizes = { "plan-eng-review": [n1, k], autoplan: [n2, k] };
    const over = G_SKILLS.filter((_, i) => base.mdd[i]! > BOUND);
    out.push("both alive: plan-eng-review " + n1 + "x" + k + " MDD " + pyStr(base.mdd[0]) + " $" + tot[0] + "; autoplan " + n2 + "x" + k + " MDD " + pyStr(base.mdd[1]) + " $" + tot[1] + "; wave 1 plans $" + w1 + " at these prices");
    if (over.length === 1) {
      const keep = over[0] === "plan-eng-review" ? "autoplan" : "plan-eng-review";
      out.push("  past the 20-point bound with both alive: " + over[0] + "; " + over[0] + " stops at admission item 5 and " + keep + " re-sizes alone");
    } else if (over.length) {
      out.push("  past the 20-point bound with both alive: " + over.join(", ") + "; " + orderText(l));
    }
  }
  for (const [s, other] of [["plan-eng-review", "autoplan"], ["autoplan", "plan-eng-review"]] as Array<[GSkill, GSkill]>) {
    const m1 = l[s], old = d7(M, s, ...sizes[s]);
    const rungs = m1.tried.map((t) => t.n + "x" + t.k + " $" + t.price + " MDD " + pyStr(t.mdd)).join(", ");
    const verdict = m1.stops ? "stops, FIX-METHOD (price)" : "runs " + m1.n + "x" + m1.k + ", MDD " + pyStr(m1.mdd) + ", $" + m1.price + ", reserve $" + (CAP - m1.price!) + " of its $" + CAP + " cap";
    out.push(s + " alone (" + other + " stops at admission): M1 ladder [" + rungs + "] -> " + verdict + "; d7 would give " + old.n + "x" + old.k + " MDD " + pyStr(old.mdd) + " (" + (old.stops ? "stops" : "runs") + ")");
    if (m1.stops) continue;
    const settled = atAdmission(M, other);
    const gTotal = settled + m1.price!;
    const fits = (x: number) => (x <= ENVELOPE ? "fits" : "OVER");
    if (base === null) {
      const all = w1 + gTotal;
      out.push("  envelope: " + other + " settles about $" + pyRound(settled) + " at admission; G then plans $" + pyRound(gTotal) + " with no both-alive design; wave 1 plans $" + pyRound(all) + " of the $" + ENVELOPE + " envelope (" + fits(all) + ")");
    } else {
      const all = w1 - tot[0]! - tot[1]! + gTotal;
      out.push("  envelope: " + other + " settles about $" + pyRound(settled) + " at admission; G then plans $" + pyRound(gTotal) + " against $" + (tot[0]! + tot[1]!) + " with both alive; wave 1 plans $" + pyRound(all) + " of the $" + ENVELOPE + " envelope (" + fits(all) + ")");
    }
  }
  return out.map((x) => x + "\n").join("");
}

/** resize.py's planning cases, in its order: what it prints with no metered input (resize.txt). */
export const RESIZE_CASES: Array<[string, Record<string, string>]> = [
  ["house central (plan v3)", HOUSE],
  ["forced or exposed told, 1.15 times told", { ...HOUSE, TOLD_SCALE: "1.15" }],
  ["forced or exposed told, 1.5 times told", { ...HOUSE, TOLD_SCALE: "1.5" }],
  ["high, 10 times a Verified session", { ...HOUSE, MULT: "10" }],
  ["crew line at TS's full rate", { ...HOUSE, AUTH_EXTRA: "6.2" }],
];

export function renderResizeCases(): string {
  return RESIZE_CASES.map(([name, env]) => {
    const M = overridden(env);
    return render(name, M, M);
  }).join("");
}

/** What resize.py prints at admission's metered inputs. */
export function renderResizeMetered(m: GMetered): string {
  const extra = meteredEnv(m);
  const name = "metered inputs {" + Object.keys(extra).sort().map((k) => JSON.stringify(k) + ": " + JSON.stringify(extra[k])).join(", ") + "}";
  return render(name, meteredPricer(m), overridden(HOUSE));
}
