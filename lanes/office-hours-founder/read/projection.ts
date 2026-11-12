// Copyright (c) 2026 Garry Tan. MIT License.
// The projection rerun before stage 2 for the office-hours founder eval (prereg
// wiki/plans/2026-11-09-geva-418-office-hours-founder-evidence-prereg, sections 12, 13 and start rule 8): the control
// rate, ICC and shuffled-key credit re-estimated from stage 1; power.py rerun through python3 at the final size for the
// W MDD and the guard-rule MDD (the Opus guard-rule MDD must be at most 0.15); the session allowances after the smoke;
// round admission; and the per-item money projection with section 13's net-envelope cuts, where the Captain's AN-1
// pitch-only cell is an item of its own for runs and for labels. power.py runs as committed: the rerun executes its
// imports, constants and functions and skips its printed grid, then calls mdd() and Part F's guard search.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { MODELS, PRE_SMOKE_SIM_ALLOWANCE, PREREG } from "../frozen.ts";
import type { ArmId, ManifestEntry, ModelId, ScoredSession } from "../types.ts";
import { CUTS, manifest, PASSES, ROUND, type Cut } from "./stage2.ts";
import { mean, r4 } from "./stats.ts";

export const POWER_PY = join(import.meta.dir, "..", "..", "..", PREREG, "..", "power.py");
/** Section 12: the Opus guard-rule MDD at the final size must be at most the 15-point smallest effect worth acting on. */
export const MDD_BAR = 0.15;
/** Section 13: any projection past this many dollars goes to the Captain. */
export const CAPTAIN_STOP = 5000;
/** Section 13's cost ratios to Opus, which scale the lens allowance for Sol and particle-1. */
export const RATIO: Readonly<Record<ModelId, number>> = { opus: 1, sol: 0.6, particle: 0.1 };

/** Runs a python3 program with stdin; returns stdout. Injected so tests make no subprocess call. */
export type Python = (program: string, stdin: string) => string;
export const python3: Python = (program, stdin) => {
  const r = spawnSync("python3", ["-c", program], { input: stdin, encoding: "utf8" });
  if (r.status !== 0) throw new Error("power.py rerun failed: " + (r.stderr || r.error?.message));
  return r.stdout;
};

export interface Estimate {
  model: ModelId;
  units: number;
  sessions: number;
  p0: number;
  rho: number;
  s: number;
}

/**
 * Section 12's re-estimate from a model's stage 1 none sessions on the calibration units: the control rate (units weigh
 * equally), the one-way ANOVA ICC of W over units, and the shuffled-key credit per session. power.py needs both in
 * (0, 1), so each is clipped to 0.01 to 0.99; an ICC with no variance to read takes the prereg's planning value 0.5.
 */
export function estimate(sessions: readonly ScoredSession[], model: ModelId, calibration: readonly string[]): Estimate {
  const cal = new Set(calibration);
  const xs = sessions.filter((s) => s.stage === 1 && s.kind === "arm" && s.arm === "none" && s.model === model && cal.has(s.unit) && s.W !== null);
  const by = new Map<string, number[]>();
  for (const s of xs) by.set(s.unit, [...(by.get(s.unit) ?? []), s.W!]);
  const groups = [...by.values()];
  const n = xs.length, g = groups.length;
  if (g < 2) throw new Error(model + ": the projection needs scored stage 1 none sessions on at least two calibration units");
  const grand = mean(xs.map((s) => s.W!));
  const k0 = (n - groups.reduce((t, y) => t + y.length ** 2, 0) / n) / (g - 1);
  const msb = groups.reduce((t, y) => t + y.length * (mean(y) - grand) ** 2, 0) / (g - 1);
  const msw = n > g ? groups.reduce((t, y) => t + y.reduce((u, v) => u + (v - mean(y)) ** 2, 0), 0) / (n - g) : 0;
  const den = msb + (k0 - 1) * msw;
  const clip = (x: number) => Math.min(0.99, Math.max(0.01, x));
  const shuffled = xs.filter((s) => s.W_shuffled !== null).map((s) => s.W_shuffled!);
  return { model, units: g, sessions: n, p0: r4(clip(mean(groups.map(mean)))), rho: r4(den > 0 ? clip((msb - msw) / den) : 0.5), s: r4(clip(shuffled.length ? mean(shuffled) : 0)) };
}

const PROGRAM = (path: string) => `import ast, json, sys
tree = ast.parse(open(${JSON.stringify(path)}).read())
tree.body = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom, ast.Assign, ast.FunctionDef))]
ns = {}
exec(compile(tree, ${JSON.stringify(path)}, "exec"), ns)
out = []
for d in json.load(sys.stdin):
    rng = ns["np"].random.default_rng(ns["SEED"])
    w = ns["mdd"](d["p0"], d["rho"], ns["TAU"], d["n"], d["passes"], 0.05, rng)
    g = None
    for delta in ns["STEPS"]:
        if d["p0"] + delta >= 0.95: break
        if ns["helps_rate"](d["p0"], d["rho"], ns["TAU"], d["n"], d["passes"], delta, d["s"], 0.0, rng)[2] >= 0.80:
            g = float(delta)
            break
    out.append({"w": w, "guard": g})
print(json.dumps(out))
`;

export interface PowerDesign {
  p0: number;
  rho: number;
  s: number;
  n: number;
  passes: number;
}

/** power.py's W MDD and its guard-rule MDD (a fully specific gain, k 0) at each design; null is above 0.50. */
export function powerMdd(designs: readonly PowerDesign[], run: Python = python3): Array<{ w: number | null; guard: number | null }> {
  return JSON.parse(run(PROGRAM(POWER_PY), JSON.stringify(designs)));
}

export interface Rerun {
  estimates: Record<ModelId, Estimate>;
  units: number;
  mdd: Record<ModelId, { passes: number; w: number | null; guard: number | null }>;
  opus_ok: boolean;
  next: string;
}

/** The projection rerun at the final size: every model at its passes, and the Opus guard-rule bar (start rule 8). */
export function projectionRerun(sessions: readonly ScoredSession[], calibration: readonly string[], units: number, run: Python = python3): Rerun {
  const estimates = Object.fromEntries(MODELS.map((m) => [m, estimate(sessions, m, calibration)])) as Record<ModelId, Estimate>;
  const out = powerMdd(MODELS.map((m) => ({ p0: estimates[m].p0, rho: estimates[m].rho, s: estimates[m].s, n: units, passes: PASSES[m] })), run);
  const mdd = Object.fromEntries(MODELS.map((m, k) => [m, { passes: PASSES[m], ...out[k]! }])) as Rerun["mdd"];
  const opus_ok = mdd.opus.guard !== null && r4(mdd.opus.guard) <= MDD_BAR;
  return { estimates, units, mdd, opus_ok, next: opus_ok ? "the Opus guard-rule MDD fits; stage 2 may start once the money projection fits" : "the Opus guard-rule MDD is over 0.15: the set grows within the line, or the question goes to the Captain" };
}

// ---- Section 13: allowances ----

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
/** Three times the median measured session, and at least the costliest one. */
const allowanceOf = (usd: readonly number[]) => r4(Math.max(3 * median(usd), ...usd));

/**
 * Section 13 after the smoke: none from stage 1's none sessions, office-hours from each model's smoke, lens from Opus's
 * two lens smoke sessions scaled for Sol and particle-1 by the cost ratios. The simulator keeps its frozen allowance.
 */
export function allowances(stage1: readonly ScoredSession[], smoke: readonly ScoredSession[]): { arm: Record<ArmId, Record<ModelId, number>>; sim: number } {
  const usd = (xs: readonly ScoredSession[], arm: ArmId, model: ModelId) => {
    const v = xs.filter((s) => s.stage === 1 && s.kind === "arm" && s.arm === arm && s.model === model).map((s) => s.usd);
    if (!v.length) throw new Error("no measured " + arm + " session on " + model + " to set its allowance");
    return v;
  };
  const lens = allowanceOf(usd(smoke, "lens", "opus"));
  const arm = {
    none: Object.fromEntries(MODELS.map((m) => [m, allowanceOf(usd(stage1, "none", m))])),
    lens: Object.fromEntries(MODELS.map((m) => [m, r4(lens * RATIO[m])])),
    "office-hours": Object.fromEntries(MODELS.map((m) => [m, allowanceOf(usd(smoke, "office-hours", m))])),
  } as Record<ArmId, Record<ModelId, number>>;
  return { arm, sim: PRE_SMOKE_SIM_ALLOWANCE };
}

// ---- Section 13: round admission ----

/** The manifest's rounds in run order: 4 units with every scheduled arm, on one model and one pass. */
export function rounds(man: readonly ManifestEntry[]): ManifestEntry[][] {
  const out: ManifestEntry[][] = [];
  let units = new Set<string>();
  let key = "";
  for (const e of man) {
    const k = e.model + "#" + e.pass;
    if (k !== key || (!units.has(e.unit) && units.size === ROUND)) {
      out.push([]);
      units = new Set();
      key = k;
    }
    units.add(e.unit);
    out[out.length - 1]!.push(e);
  }
  return out;
}

export interface Headroom {
  cap: number;
  settled: number;
  open: number;
}

/**
 * A session gets at most one retry, so a round leases twice each session's allowance on the runs item and twice the
 * simulator's on the simulator item. It starts only when both fit under their item caps and, together, the line's ceiling.
 */
export function admitRound(round: readonly ManifestEntry[], allow: { arm: Readonly<Record<ArmId, Readonly<Record<ModelId, number>>>>; sim: number }, h: { runs: Headroom; simulator: Headroom; line: Headroom }) {
  const runs = r4(2 * round.reduce((t, e) => t + allow.arm[e.arm][e.model], 0));
  const sim = r4(2 * round.length * allow.sim);
  const fits = (x: Headroom, lease: number) => r4(x.settled + x.open + lease) <= x.cap;
  return { runs, sim, fits: fits(h.runs, runs) && fits(h.simulator, sim) && fits(h.line, runs + sim) };
}

// ---- Section 13: the money projection and the net-envelope cuts ----

export const ITEMS = ["stage 2 runs", "real stratum runs", "simulator", "judges", "pitch-only runs", "pitch-only labels"] as const;
export type Item = (typeof ITEMS)[number];
type PerCell = Readonly<Record<ArmId, Readonly<Record<ModelId, number>>>>;

export interface MoneyInput {
  comparison: readonly string[];
  real: readonly string[];
  /** Measured or planning dollars: per session by arm and model (arm calls, simulator, pitch-only), and per label packet by model. */
  cost: { session: PerCell; sim: PerCell; pitch: PerCell; packet: Readonly<Record<ModelId, number>>; pitch_packet: Readonly<Record<ModelId, number>> };
  /** Each manifest-driven item's cap, its spend so far and any projection outside the manifests (the gold re-check, the audits, the probe). */
  items: Readonly<Record<Item, { cap: number; spent: number; extra: number }>>;
  /** Items the manifests don't drive (authoring, stage 1, hosts, crew), with their spend and remaining projection. */
  others: ReadonlyArray<{ name: string; cap: number; spent: number; projected: number }>;
  ceiling: number;
}
export interface Money {
  cuts: Cut[];
  items: Array<{ name: string; cap: number; spent: number; projected: number; fits: boolean }>;
  total: number;
  fits: boolean;
  captain: string | null;
}

/** One projection at one set of cuts. */
export function project(i: MoneyInput, cuts: readonly Cut[]): Omit<Money, "captain"> {
  const primary = manifest(i.comparison, { kind: "arm", real: false, cuts });
  const real = manifest(i.real, { kind: "arm", real: true, cuts });
  const pitch = manifest(i.comparison, { kind: "pitch", real: false, cuts });
  const sum = (m: readonly ManifestEntry[], c: PerCell) => m.reduce((t, e) => t + c[e.arm][e.model], 0);
  const packets = (m: readonly ManifestEntry[], c: Readonly<Record<ModelId, number>>) => [...new Set(m.map((e) => e.model + "|" + e.unit + "|" + e.pass))].reduce((t, k) => t + c[k.split("|")[0] as ModelId], 0);
  const derived: Record<Item, number> = {
    "stage 2 runs": sum(primary, i.cost.session),
    "real stratum runs": sum(real, i.cost.session),
    simulator: sum(primary, i.cost.sim) + sum(real, i.cost.sim),
    judges: packets(primary, i.cost.packet) + packets(real, i.cost.packet),
    "pitch-only runs": sum(pitch, i.cost.pitch),
    "pitch-only labels": packets(pitch, i.cost.pitch_packet),
  };
  const items = [
    ...ITEMS.map((name) => ({ name, cap: i.items[name].cap, spent: i.items[name].spent, projected: r4(derived[name] + i.items[name].extra) })),
    ...i.others.map((o) => ({ ...o, projected: r4(o.projected) })),
  ].map((x) => ({ ...x, fits: r4(x.spent + x.projected) <= x.cap }));
  const total = r4(items.reduce((t, x) => t + x.spent + x.projected, 0));
  return { cuts: [...cuts], items, total, fits: total <= i.ceiling && items.every((x) => x.fits) };
}

/**
 * Section 13's net-envelope rule: when the projection doesn't fit, cut in the frozen order (Sol's lens cells,
 * particle-1's lens cells, the real stratum's Sol and particle-1 cells, then Opus's second lens pass) until it fits. No
 * listed cut touches the Opus none or office-hours cells, so none moves the Opus MDD. A projection past the Captain stop,
 * or one that still doesn't fit after every cut, goes to the Captain.
 */
export function moneyProjection(i: MoneyInput): Money {
  for (let k = 0; ; k++) {
    const p = project(i, CUTS.slice(0, k));
    if (p.total > CAPTAIN_STOP) return { ...p, captain: "the projection passes the Captain stop" };
    if (p.fits) return { ...p, captain: null };
    if (k === CUTS.length) return { ...p, captain: "the projection doesn't fit after every cut" };
  }
}
