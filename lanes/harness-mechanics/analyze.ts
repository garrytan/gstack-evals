// Copyright (c) 2026 Garry Tan. MIT License.
// The analysis (sections 9, 13, 14, 16, 17 and 20): Stage 1's admission A1 to A6 and Stage 4's H1 to H3 with their R48
// end states, Why-null cycles and H1's pre-data reporting amendment. Paired differences and 95% intervals come from
// clusteredPairedDelta resampling repositories (10,000 draws, seed 20261148); ratios, E (f re-estimated in every
// resample) and the 80% intervals from a bootstrap over the same clusters; every MDD and power line from the bundle's
// power.py. Rows are the session table plus the picker and judgment-hook input columns (HmRowIn).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clusteredPairedDelta, seededRandom, type PairedItem } from "../../src/runner/stats/paired.ts";
import type { HmArm, HmSessionRow } from "../../src/types.ts";
import { BUNDLE, HM, loadBundle, MODELS, REPO } from "./pins.ts";
import { patternsPerArm } from "./score.ts";

/** A session row plus the input columns units 7 and 8 fill: on a none row, the bo2 patch the picker ships; on a judge row, the hook logs. */
export type HmRowIn = HmSessionRow & {
  bo2_pass?: boolean | null; picker_parsed?: boolean | null; picker_cost_usd?: number | null;
  hook_time_s?: number | null; hook_cost_usd?: number | null; hook_log?: boolean | null; fail_open?: number | null; escalations?: number | null;
};
export type Iv = [number, number] | null;
export const DRAWS = 10_000;
export const BAR = { exposure: 0.9, a1: [0.15, 0.9], headroom: 0.9, a3: 0.8, a5: 0.95, keepOut: 0.2, missing: 0.05, h1Margin: -0.075, h2Margin: 0.05, h3Margin: -0.075, h3Ratio: 0.5 } as const;
// Section 16's pooled H1 adherence count, and power.py part 3's planning inputs for H2's MDD at the measured d0.
const ADHERENCE_N = 570;
const H2_PLAN = { bases: [0.613, 0.65, 0.75], qs: [0.6, 0.8], f: 0.32, n: 200, sims: 2000 };
// Section 22: expected spend of the items Stage 1 doesn't measure, the owner line, and the drop order's counts.
const OTHER_USD = { replay: 60, pilot: 35, vms: 106, crew: 260 };
const OWNER_USD = 5000;
const DROPS = ["none", "the judge arms on particle-1", "the judge subset from 60 tasks to 40", "the scored split from 200 tasks to 180"];
export const AMENDMENT = "Pre-data reporting amendment for H1 (before any data). The H1 verdict rules stand as written; rule 1 carries the A4 guard, and when A4 keeps the shipping test out, rules 3 to 5 decide the verdict. Reporting addition, which changes no verdict, arm or money rule: when A4 keeps the shipping test out, the results print P's interval next to the H1 verdict. If P's upper bound is below 0, the results also say in plain words that the hook arm lost passes on that interval, and that the shipping test carries no verdict because discordance passed the planned 0.20. The label NO MEASURABLE DIFFERENCE never stands alone in that case.";

const pts = (x: number) => (100 * x).toFixed(1);
const pct = (x: number | null) => (x === null || !Number.isFinite(x) ? "n/a" : (100 * x).toFixed(1) + "%");
const civ = (c: Iv) => (c ? "[" + pts(c[0]) + ", " + pts(c[1]) + "]" : "[no interval]");
const dec = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "n/a");
const div = (c: Iv) => (c ? "[" + dec(c[0]) + ", " + dec(c[1]) + "]" : "[no interval]");
const holds0 = (c: Iv) => !c || (c[0] <= 0 && c[1] >= 0);
const rate = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : null);
const mean = (xs: number[]) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
const num = (x: number | null | undefined) => (typeof x === "number" ? x : NaN);
const P = (r: HmRowIn) => (r.pass ? 1 : 0);
const FD = (r: HmRowIn) => (r.score.false_done === true ? 1 : 0);
const hasRecord = (r: HmRowIn) => r.contract_record === true || r.score.hook.record === true;
const told = (a: HmArm) => a !== "none" && a !== "plain-2";
export const repoOf = (task: string) => task.replace(/-\d+(?:_[A-Za-z]+)?$/, "");
const ORDER = Object.keys(MODELS) as (keyof typeof MODELS)[];
export const modelKey = (m: string) => ORDER.find((k) => m === MODELS[k].id || m.endsWith("/" + MODELS[k].id)) ?? m;
const modelName = (mk: string) => (Object.hasOwn(MODELS, mk) ? MODELS[mk as keyof typeof MODELS].id : mk);

// power.py, loaded from the bundle after its digests check, answers a batch of calls in one process.
type Call = [string, ...number[]];
const PY = "import importlib.util,json,sys,random\ns=importlib.util.spec_from_file_location('hm_power',sys.argv[1]);p=importlib.util.module_from_spec(s);s.loader.exec_module(p)\nout=[]\nfor c in json.loads(sys.argv[2]):\n  f=getattr(p,c[0])\n  try:\n    if not callable(f): out.append(f)\n    elif c[0]=='sim_e': out.append(list(f(c[1],c[2],c[3],c[4],int(c[5]),int(c[6]),random.Random(" + HM.seed + "))))\n    else: out.append(f(*c[1:]))\n  except (ValueError, ZeroDivisionError): out.append(None)\nprint(json.dumps(out))";
export function powerPy(calls: Call[]): unknown[] {
  if (!calls.length) return [];
  loadBundle();
  const r = Bun.spawnSync(["python3", "-B", "-c", PY, join(REPO, BUNDLE, "power.py"), JSON.stringify(calls)]);
  if (r.exitCode !== 0) throw new Error("power.py failed: " + r.stderr.toString().trim().split("\n").at(-1));
  return JSON.parse(r.stdout.toString());
}

// The session table indexed by model, arm and task. A graded attempt wins over an infrastructure failure, so an
// attempt 2 fills its pair; a task with no graded attempt is missing. A contaminated no-gstack session is missing too.
type Cell = { row: HmRowIn; status: "graded" | "contaminated" | "missing" };
type Ix = { cell: Map<string, Cell>; tasks: Map<string, Set<string>>; mks: string[] };
const K = (mk: string, arm: string, task: string) => mk + "|" + arm + "|" + task;
export function indexRows(rows: HmRowIn[]): Ix {
  const cell = new Map<string, Cell>(), tasks = new Map<string, Set<string>>(), rank = { graded: 2, contaminated: 1, missing: 0 };
  for (const r of rows) {
    const mk = modelKey(r.model), tk = mk + "|" + r.arm;
    (tasks.get(tk) ?? tasks.set(tk, new Set()).get(tk)!).add(r.task);
    const status = r.outcome === "graded" ? "graded" : r.outcome === "contaminated" ? "contaminated" : "missing";
    const prev = cell.get(K(mk, r.arm, r.task));
    if (!prev || rank[status] >= rank[prev.status]) cell.set(K(mk, r.arm, r.task), { row: r, status });
  }
  const mks = [...new Set(rows.map((r) => modelKey(r.model)))].sort((a, b) => (ORDER.indexOf(a as never) + 1 || 99) - (ORDER.indexOf(b as never) + 1 || 99) || a.localeCompare(b));
  return { cell, tasks, mks };
}
const cellsOf = (ix: Ix, mk: string, arm: HmArm) => [...(ix.tasks.get(mk + "|" + arm) ?? [])].map((t) => ix.cell.get(K(mk, arm, t))!);
const graded = (ix: Ix, mk: string, arm: HmArm) => cellsOf(ix, mk, arm).filter((c) => c.status === "graded").map((c) => c.row);
const scope = (ix: Ix, arms: HmArm[]) => ix.mks.filter((mk) => arms.some((a) => ix.tasks.has(mk + "|" + a)));

// Walks the tasks of a contrast: a task missing a graded session in any of its arms is missing; fn sees the rest.
type Get = (arm: HmArm) => HmRowIn;
function walk(ix: Ix, mks: string[], arms: HmArm[], fn: (g: Get, mk: string, task: string) => boolean): { total: number; missing: number } {
  let total = 0, missing = 0;
  for (const mk of mks) {
    const ts = new Set<string>();
    for (const a of arms) for (const t of ix.tasks.get(mk + "|" + a) ?? []) ts.add(t);
    for (const t of [...ts].sort()) {
      total++;
      if (arms.some((a) => ix.cell.get(K(mk, a, t))?.status !== "graded") || !fn((a) => ix.cell.get(K(mk, a, t))!.row, mk, t)) missing++;
    }
  }
  return { total, missing };
}

export type Contrast = { label: string; n: number; total: number; missing: number; excluded: number; incomplete: boolean; delta: number; ci: Iv; worse: number; better: number; disc: number; none: [number, number] | null; pairs: PairedItem[]; mdd: number | null };
type Val = (g: Get) => [number, number] | null | "missing";
function contrast(ix: Ix, label: string, mks: string[], arms: HmArm[], val: Val, lowerIsBetter = false): Contrast {
  const pairs: PairedItem[] = [], noneP: number[] = [];
  let excluded = 0;
  const w = walk(ix, mks, arms, (g, mk, t) => {
    const v = val(g);
    if (v === "missing") return false;
    if (!v) { excluded++; return true; }
    pairs.push({ id: mk + "|" + t, cluster: repoOf(t), a: v[0], b: v[1] });
    const nc = ix.cell.get(K(mk, "none", t));
    if (nc?.status === "graded") noneP.push(P(nc.row));
    return true;
  });
  const s = pairs.length ? clusteredPairedDelta(pairs, { seed: HM.seed, draws: DRAWS }) : null;
  return {
    label, n: pairs.length, total: w.total, missing: w.missing, excluded, incomplete: w.total === 0 || w.missing / w.total > BAR.missing,
    delta: s?.delta ?? NaN, ci: s?.ci95 ?? null, worse: pairs.filter((p) => (lowerIsBetter ? p.b > p.a : p.b < p.a)).length, better: pairs.filter((p) => (lowerIsBetter ? p.b < p.a : p.b > p.a)).length,
    disc: pairs.length ? pairs.filter((p) => p.a !== p.b).length / pairs.length : 0, none: noneP.length ? [noneP.reduce((a, b) => a + b, 0), noneP.length] : null, pairs, mdd: null,
  };
}
const passV = (a: HmArm, b: HmArm): Val => (g) => [P(g(a)), P(g(b))];
const fdV = (a: HmArm, b: HmArm): Val => (g) => [FD(g(a)), FD(g(b))];
const withMdd = (cs: Contrast[], extra: Call[] = []) => {
  const out = powerPy([...cs.map((c): Call => ["mdd", c.disc, c.n]), ...extra]);
  cs.forEach((c, i) => { c.mdd = typeof out[i] === "number" ? (out[i] as number) : null; });
  return out.slice(cs.length);
};
const cline = (c: Contrast) => c.label + ": " + (c.n ? pts(c.delta) + " points, 95% " + civ(c.ci) + (holds0(c.ci) ? " (no measurable difference)" : "") : "no pairs") + "; MDD " + (c.mdd === null ? "n/a" : pts(c.mdd)) + " at discordance " + dec(c.disc) + "; " + c.n + " pairs; worse " + c.worse + ", better " + c.better + "; none " + (c.none ? "passed " + c.none[0] + " of " + c.none[1] : "n/a") + "; missing " + c.missing + " of " + c.total + (c.incomplete ? " INCOMPLETE" : "") + (c.excluded ? "; left out " + c.excluded : "");

/** Bootstrap over clusters (repositories) at the stats kit's seed: sorted finite draws of stat, empty under two clusters. */
export function clusterBoot<T extends { cluster: string }>(units: T[], stat: (us: T[]) => number, draws = DRAWS): number[] {
  const by = new Map<string, T[]>();
  for (const u of units) (by.get(u.cluster) ?? by.set(u.cluster, []).get(u.cluster)!).push(u);
  const cs = [...by.keys()].sort().map((k) => by.get(k)!);
  if (cs.length < 2) return [];
  const rng = seededRandom(HM.seed), out: number[] = [];
  for (let i = 0; i < draws; i++) { const s: T[] = []; for (let j = 0; j < cs.length; j++) s.push(...cs[Math.floor(rng() * cs.length)]!); out.push(stat(s)); }
  return out.filter(Number.isFinite).sort((x, y) => x - y);
}
const iv = (b: number[], tail: number): Iv => (b.length ? [b[Math.floor(b.length * tail)]!, b[Math.ceil(b.length * (1 - tail)) - 1]!] : null);

// Exposure (section 17): /verify loaded in told arms, the contract record in verify-hook, hook logs in the judge arms,
// and the no-gstack arms clean, each with a 90% bar; blocks fired print beside them.
type Expo = { n: number; loaded: number | null; record: number | null; blocks: number; hook_log: number | null; clean: number | null };
function expo(ix: Ix, mk: string, arm: HmArm): Expo {
  const g = graded(ix, mk, arm), seen = cellsOf(ix, mk, arm).filter((c) => c.status !== "missing");
  return {
    n: g.length, loaded: told(arm) ? rate(g.map((r) => r.score.verify_loads > 0)) : null, record: arm === "verify-hook" ? rate(g.map(hasRecord)) : null,
    blocks: g.filter((r) => (r.score.hook.blocks ?? 0) > 0).length, hook_log: arm.startsWith("judge") ? rate(g.map((r) => r.hook_log === true)) : null,
    clean: told(arm) ? null : rate(seen.map((c) => c.status === "graded" && !c.row.audit_hits.length)),
  };
}
const expoText = (e: Expo) => "/verify loaded " + pct(e.loaded) + ", contract record " + pct(e.record) + ", blocks fired " + e.blocks + ", hook logs " + pct(e.hook_log) + ", clean " + pct(e.clean) + " (" + e.n + " graded)";
function expoFails(ix: Ix, mks: string[], arms: HmArm[]): string[] {
  const out: string[] = [];
  for (const mk of mks) for (const a of arms) {
    if (!ix.tasks.has(mk + "|" + a)) continue;
    const e = expo(ix, mk, a);
    const bars: [string, boolean, number | null][] = [["/verify loaded", told(a), e.loaded], ["contract record", a === "verify-hook", e.record], ["hook logs written", a.startsWith("judge"), e.hook_log], ["clean", !told(a), e.clean]];
    for (const [name, on, v] of bars) if (on && (v === null || v < BAR.exposure)) out.push(mk + " " + a + " " + name + " " + pct(v) + " under 90%");
  }
  return out;
}

// Section 14's verdict rules, first match wins. Intervals are in proportions; margins are 7.5 and 5 points.
export function h1Verdict(A: Iv, Pv: Iv, shippingIn: boolean): string {
  if (shippingIn && Pv && Pv[1] < 0) return "HOOK COSTS PASSES";
  if (A && A[0] > 0 && shippingIn && Pv && Pv[0] > BAR.h1Margin) return "HOOK FOLLOWED MORE";
  if (A && A[0] > 0) return "HOOK FOLLOWED MORE, SHIPPING UNTESTED";
  if (A && A[1] < 0) return "PROSE FOLLOWED MORE";
  return "NO MEASURABLE DIFFERENCE";
}
export function h2Verdict(E: Iv): string {
  if (E && E[0] > 0) return "VERIFIER COMPUTE WINS";
  if (E && E[1] < 0) return "GSTACK WINS";
  if (E && E[0] >= -BAR.h2Margin && E[1] <= BAR.h2Margin) return "EQUAL AT EQUAL SPEND";
  return "NO MEASURABLE DIFFERENCE";
}
export function h3Verdict(Pv: Iv, ratioHi: number | null): string {
  const fast = ratioHi !== null && ratioHi < BAR.h3Ratio;
  if (Pv && Pv[1] < 0) return "JEV COSTS PASSES";
  if (fast && Pv && Pv[0] > BAR.h3Margin) return "JEV MATCHES AND IS FASTER";
  if (fast) return "JEV FASTER, SHIPPING UNTESTED";
  return "NO CLEAR SPEED GAIN";
}
const END: Record<string, string> = {
  "H1|HOOK FOLLOWED MORE": "KEEP: switch skill_contracts on for rules with an edit loop and drop the duplicated sentence",
  "H1|HOOK FOLLOWED MORE, SHIPPING UNTESTED": "FIX-METHOD (power on passes): the adherence gain stands, its cost in passes is unmeasured, and no switch-on is recommended",
  "H1|HOOK COSTS PASSES": "CUT-CANDIDATE: the contract hook for this rule",
  "H1|PROSE FOLLOWED MORE": "CUT-CANDIDATE: the contract hook for this rule",
  "H2|VERIFIER COMPUTE WINS": "CUT-CANDIDATE: /verify, against a second attempt at the same spend",
  "H2|GSTACK WINS": "KEEP: /verify",
  "H2|EQUAL AT EQUAL SPEND": "KEEP: /verify as one way to spend, since neither use of the money beats the other by 5 points; gstack against none prints beside it",
  "H2|NO MEASURABLE DIFFERENCE": "FIX-METHOD (power): the interval is wider than the margin",
  "H3|JEV MATCHES AND IS FASTER": "KEEP: the Jev cascade as a hook backend",
  "H3|JEV FASTER, SHIPPING UNTESTED": "FIX-METHOD (power on passes): the speed gain stands, its cost in passes is unmeasured",
  "H3|JEV COSTS PASSES": "CUT-CANDIDATE: Jev as a hook backend",
  "H3|NO CLEAR SPEED GAIN": "CUT-CANDIDATE: Jev as a hook backend",
};
const NULLS = ["NO MEASURABLE DIFFERENCE", "PROSE FOLLOWED MORE", "HOOK COSTS PASSES", "VERIFIER COMPUTE WINS", "NO CLEAR SPEED GAIN", "JEV COSTS PASSES", "NOT ADMITTED"];
const R61 = "; R61: one attempt to raise the ceiling, verify-prose and verify-hook on L1's 37-task Terminal-Bench 2 twin set after a 10-task headroom check at the same 90% bar, from room the all-in read shows after Stage 4 and under an item cap the Captain records; if that check is saturated too or can't run, the verdict stays FIX-METHOD (saturation) and the post says the model already follows this rule from prose";

type Read80 = { x: number; ci80: Iv; n: number };
export type ModelAdmission = {
  a1: { rate: number | null; n: number; ok: boolean };
  a2: { headroom: number | null; n_edit: number; loads: number | null; n_told: number; record: number | null; n_hook: number; saturated: boolean; exposure_ok: boolean };
  a3: { rate: number | null; n: number; ok: boolean };
  a4: { d: Read80; d0: Read80; gap: Read80 };
  a5: { rate: number | null; n: number; ok: boolean };
};
export type Admission = {
  models: Record<string, ModelAdmission>;
  pooled: { d: Read80; d0: Read80; gap: Read80; adherence_d: number; adherence_mdd: number | null; likely_null: boolean; keep_out: boolean; h2_mdd: { q: number; mdd: number | null }[] };
  a6: { stage1_usd: number; projections: { drop: number; all_in_usd: number }[]; drop_step: number; inside: boolean };
  lines: string[];
};

/** Stage 1's admission (section 9), per model and pooled. sims sets power.py's Monte Carlo runs (2,000 as frozen). */
export function admission(rows: HmRowIn[], o: { sims?: number } = {}): Admission {
  const ix = indexRows(rows), models: Record<string, ModelAdmission> = {}, lines: string[] = [];
  const four: HmArm[] = ["verify-prose", "verify-hook"];
  const adhV: Val = (g) => { const x = g("verify-prose").score.adherent, y = g("verify-hook").score.adherent; return x === null || y === null ? null : [+x, +y]; };
  const r80 = (c: Contrast, f: (p: PairedItem) => number): Read80 => ({ x: c.n ? mean(c.pairs.map(f)) : NaN, ci80: iv(clusterBoot(c.pairs, (s) => mean(s.map(f))), 0.1), n: c.n });
  const disc = (p: PairedItem) => (p.a === p.b ? 0 : 1), gap = (p: PairedItem) => p.b - p.a;
  const a4 = (mks: string[]) => {
    const adh = contrast(ix, "", mks, four, adhV);
    return { d: r80(contrast(ix, "", mks, four, passV("verify-prose", "verify-hook")), disc), d0: r80(contrast(ix, "", mks, ["none", "plain-2"], passV("none", "plain-2")), disc), gap: r80(adh, gap), adh_d: r80(adh, disc).x };
  };
  for (const mk of ix.mks) {
    const none = graded(ix, mk, "none"), prose = graded(ix, mk, "verify-prose"), hook = graded(ix, mk, "verify-hook");
    const edited = prose.filter((r) => r.score.adherent !== null), toldRows = [...prose, ...hook];
    const picks = cellsOf(ix, mk, "none").filter((c) => typeof c.row.picker_parsed === "boolean").map((c) => c.row);
    const a1 = rate(none.map((r) => r.pass)), headroom = rate(edited.map((r) => r.score.adherent === true));
    const loads = rate(toldRows.map((r) => r.score.verify_loads > 0)), record = rate(hook.map(hasRecord)), a3 = rate(prose.map((r) => r.score.edited)), a5 = rate(picks.map((r) => r.picker_parsed === true));
    const m = a4([mk]);
    models[mk] = {
      a1: { rate: a1, n: none.length, ok: a1 !== null && a1 >= BAR.a1[0] && a1 <= BAR.a1[1] },
      a2: { headroom, n_edit: edited.length, loads, n_told: toldRows.length, record, n_hook: hook.length, saturated: headroom !== null && headroom > BAR.headroom, exposure_ok: loads !== null && loads >= BAR.exposure && record !== null && record >= BAR.exposure },
      a3: { rate: a3, n: prose.length, ok: a3 !== null && a3 >= BAR.a3 },
      a4: { d: m.d, d0: m.d0, gap: m.gap },
      a5: { rate: a5, n: picks.length, ok: a5 !== null && a5 >= BAR.a5 },
    };
  }
  const pool = a4(ix.mks);
  const sims = o.sims ?? H2_PLAN.sims, d0 = pool.d0.x;
  const sim: Call[] = Number.isFinite(d0) ? H2_PLAN.qs.flatMap((q) => H2_PLAN.bases.map((m): Call => ["sim_e", m, d0, q, H2_PLAN.f, H2_PLAN.n, sims])) : [];
  const out = powerPy([["Z"], ["mdd", pool.adh_d, ADHERENCE_N], ...sim]);
  const Z = out[0] as number, adhMdd = typeof out[1] === "number" ? (out[1] as number) : null;
  const h2_mdd = H2_PLAN.qs.map((q, qi) => {
    const sds = H2_PLAN.bases.map((_, bi) => out[2 + qi * H2_PLAN.bases.length + bi] as number[] | null | undefined);
    return { q, mdd: sim.length && sds.every((s) => Array.isArray(s)) ? (Z * Math.sqrt(sds.reduce((a, s) => a + s![0]! ** 2, 0))) / sds.length : null };
  });
  const keep_out = !!pool.d.ci80 && pool.d.ci80[1] > BAR.keepOut;
  const likely_null = Number.isFinite(pool.gap.x) && adhMdd !== null && pool.gap.x < adhMdd;
  const a6 = recost(rows, ix);
  const ok = (b: boolean) => (b ? "ok" : "FAIL");
  for (const [mk, a] of Object.entries(models)) {
    lines.push("STAGE1 A1 " + mk + ": none passed " + pct(a.a1.rate) + " of " + a.a1.n + " (bar 15% to 90%): " + (a.a1.ok ? "ok" : "FAIL, H2 and H3 saturated on " + mk));
    lines.push("STAGE1 A2 " + mk + ": verify-prose ran the rule in " + pct(a.a2.headroom) + " of " + a.a2.n_edit + " sessions with an edit (bar at most 90%): " + (a.a2.saturated ? "SATURATED, H1 saturated on " + mk : "ok") + "; /verify loaded in " + pct(a.a2.loads) + " of " + a.a2.n_told + " told sessions and the contract record in " + pct(a.a2.record) + " of " + a.a2.n_hook + " verify-hook sessions (bar 90%): " + (a.a2.exposure_ok ? "ok" : "FAIL, H1 FIX-METHOD (exposure); check the build before Stage 4"));
    lines.push("STAGE1 A3 " + mk + ": verify-prose edited a file in " + pct(a.a3.rate) + " of " + a.a3.n + " (bar 80%): " + ok(a.a3.ok));
    lines.push("STAGE1 A4 " + mk + ": d verify-prose vs verify-hook " + dec(a.a4.d.x) + ", 80% " + div(a.a4.d.ci80) + " (" + a.a4.d.n + " tasks); d0 none vs plain-2 " + dec(a.a4.d0.x) + ", 80% " + div(a.a4.d0.ci80) + " (" + a.a4.d0.n + "); adherence gap verify-hook minus verify-prose " + pts(a.a4.gap.x) + " points, 80% " + civ(a.a4.gap.ci80) + " (" + a.a4.gap.n + " tasks with an edit in both)");
  }
  lines.push("STAGE1 A4 pooled: d verify-prose vs verify-hook " + dec(pool.d.x) + ", 80% " + div(pool.d.ci80) + "; shipping test " + (keep_out ? "OUT: the upper end passes 0.20, so H1's shipping test is reported without a verdict" : "IN: the upper end is at most 0.20") + "; d0 none vs plain-2 " + dec(d0) + ", 80% " + div(pool.d0.ci80));
  lines.push("STAGE1 A4 H2 MDD at the measured d0 " + dec(d0) + ": E's pooled MDD " + h2_mdd.map((x) => (x.mdd === null ? "n/a" : pts(x.mdd)) + " points at picker accuracy " + x.q).join(", ") + " (power.py sim_e at f 0.32, 200 tasks per model and its three base rates)");
  lines.push("STAGE1 A4 adherence gap pooled " + pts(pool.gap.x) + " points, 80% " + civ(pool.gap.ci80) + ", beside the pooled H1 adherence MDD " + (adhMdd === null ? "n/a" : pts(adhMdd)) + " points at the measured adherence discordance " + dec(pool.adh_d) + " (power.py mdd, " + ADHERENCE_N + " sessions with an edit)");
  if (likely_null) lines.push("STAGE1 A4 likely null: the adherence gap " + pts(pool.gap.x) + " is below the MDD " + pts(adhMdd!) + ", so H1's likely reading is a null; the run goes on.");
  for (const [mk, a] of Object.entries(models)) lines.push("STAGE1 A5 " + mk + ": picker replies parsed " + pct(a.a5.rate) + " of " + a.a5.n + " (bar 95%): " + (a.a5.ok ? "ok" : "FAIL, H2 ships attempt A on unparsed replies and prints the rate beside every H2 line"));
  lines.push("STAGE1 A6 all-in projection from Stage 1's measured rates: $" + a6.projections[0]!.all_in_usd.toFixed(0) + " (Stage 1 spent $" + a6.stage1_usd.toFixed(0) + ") against the $" + HM.lineUsd + " line: " + (a6.drop_step ? "past it, section 22's drop order applies" : "inside"));
  for (const p of a6.projections.slice(1)) lines.push("STAGE1 A6 drop step " + p.drop + " (" + DROPS[p.drop] + "): $" + p.all_in_usd.toFixed(0) + (p.all_in_usd <= HM.lineUsd ? ", inside the line" : ", still past the line"));
  if (!a6.inside) lines.push("STAGE1 A6 past the line after every drop step: a raised cap or the projection goes to the Captain" + (a6.projections.at(-1)!.all_in_usd > OWNER_USD ? ", and past $5000 to the project owner through the Captain" : ""));
  return { models, pooled: { d: pool.d, d0: pool.d0, gap: pool.gap, adherence_d: pool.adh_d, adherence_mdd: adhMdd, likely_null, keep_out, h2_mdd }, a6, lines };
}

// A6: Stage 1's spend plus Stage 4 at Stage 1's measured per-session rates (a judge session at verify-hook's rate),
// plus section 22's expected spend for the replay, the pilot, the VMs and the crew; then the drop order while past the line.
function recost(rows: HmRowIn[], ix: Ix): Admission["a6"] {
  const stage1 = rows.reduce((a, r) => a + (num(r.cost_usd) || 0) + (num(r.picker_cost_usd) || 0), 0);
  const fin = (x: number) => (Number.isFinite(x) ? x : 0);
  const rates = ix.mks.map((mk) => {
    const c = (a: HmArm) => fin(mean(cellsOf(ix, mk, a).map((x) => num(x.row.cost_usd))));
    return { mk, four: c("none") + c("plain-2") + c("verify-prose") + c("verify-hook"), pick: fin(mean(cellsOf(ix, mk, "none").map((x) => num(x.row.picker_cost_usd)))), judge: c("verify-hook") };
  });
  const other = Object.values(OTHER_USD).reduce((a, b) => a + b, 0);
  const proj = (drop: number) => {
    const T = drop >= 3 ? 180 : 200, J = drop >= 2 ? 40 : 60;
    return stage1 + other + rates.reduce((a, r) => a + T * (r.four + r.pick) + (drop >= 1 && r.mk === "p1" ? 0 : J * 2 * r.judge), 0);
  };
  const projections = [{ drop: 0, all_in_usd: proj(0) }];
  while (projections.at(-1)!.all_in_usd > HM.lineUsd && projections.length < 4) projections.push({ drop: projections.length, all_in_usd: proj(projections.length) });
  return { stage1_usd: stage1, projections, drop_step: projections.length - 1, inside: projections.at(-1)!.all_in_usd <= HM.lineUsd };
}

export type ReportConfig = {
  /** Stage 1's admission (the admission command's admission.json), or the Stage 1 table to compute it from. */
  stage1?: Admission;
  stage1_table?: string;
  /** The replay's admission (unit 8): each judgment point admitted, not beaten by its deterministic version, or NO READ. */
  h3_admission?: { points: { point: string; result: "admitted" | "not beaten" | "no read" }[] };
  /** Section 22's drop steps taken after Stage 1's re-cost, 0 to 3. */
  drop_step?: number;
};
type Why = { exposure: string; task_fit: string; power: string; frontier: string };
export type Verdict = { q: "H1" | "H2" | "H3"; models: string[]; rule: string; end: string; gate?: string; why?: Why; detail: Record<string, unknown> };
export type ReportJson = { schema: "hm-report/1"; verdicts: Record<"H1" | "H2" | "H3", Verdict>; exposure: Record<string, Record<string, Expo>>; admission: Omit<Admission, "lines"> };

/** Stage 4's report: H1 to H3 with their end states, per-model tables (Opus first), exposure, patterns and the admission. */
export function report(rows: HmRowIn[], cfg: ReportConfig, o: { out?: string; sims?: number } = {}): { lines: string[]; json: ReportJson } {
  const s1 = cfg.stage1;
  if (!s1) throw new Error("E_USAGE hm report: the config needs stage1 or stage1_table (Stage 1's admission)");
  const ix = indexRows(rows), sims = o.sims ?? H2_PLAN.sims, mksAll = ix.mks;
  const a1Fail = Object.entries(s1.models).filter(([, a]) => !a.a1.ok).map(([m]) => m);
  const noneLine = "none passed " + mksAll.map((mk) => pct(rate(graded(ix, mk, "none").map((r) => r.pass))) + " on " + mk).join(", ");
  const fitOf = (arms: HmArm[], mks: string[]) => mks.flatMap((mk) => arms.filter((a) => ix.tasks.has(mk + "|" + a)).map((a) => { const g = graded(ix, mk, a); return mk + " " + a + " edited " + pct(rate(g.map((r) => r.score.edited))) + ", rule ran " + pct(rate(g.filter((r) => r.score.adherent !== null).map((r) => r.score.adherent === true))); })).join("; ");
  const expoOf = (arms: HmArm[], mks: string[]) => mks.flatMap((mk) => arms.filter((a) => ix.tasks.has(mk + "|" + a)).map((a) => mk + " " + a + " " + expoText(expo(ix, mk, a)))).join("; ");
  const settle = (q: "H1" | "H2" | "H3", rule: string, g: { exposure: string[]; incomplete: string[]; saturated: string[] }, table: () => string) => {
    if (g.exposure.length) return { rule, end: "FIX-METHOD (exposure): " + g.exposure.join("; "), gate: "exposure" };
    if (g.incomplete.length) return { rule, end: "FIX-METHOD (incomplete): " + g.incomplete.join("; ") + "; no claim", gate: "incomplete" };
    if (g.saturated.length) return { rule, end: "FIX-METHOD (saturation) on " + g.saturated.join(", ") + (q === "H1" ? R61 : ""), gate: "saturation" };
    return { rule, end: table() };
  };
  const incl = (cs: Contrast[]) => cs.filter((c) => c.incomplete).map((c) => c.label + " missing " + c.missing + " of " + c.total);
  const h: string[] = [], per: string[] = [];

  // H1: verify-hook against verify-prose, A on adherence, P on pass, pooled with equal weight per task and model.
  const H1A: HmArm[] = ["verify-prose", "verify-hook"], m1 = scope(ix, H1A);
  const adhV: Val = (g) => { const x = g("verify-prose").score.adherent, y = g("verify-hook").score.adherent; return x === null || y === null ? null : [+x, +y]; };
  const A = contrast(ix, "A (verify-hook minus verify-prose adherence)", m1, H1A, adhV);
  const Pc = contrast(ix, "P (verify-hook minus verify-prose pass)", m1, H1A, passV("verify-prose", "verify-hook"));
  const perA = m1.map((mk) => [contrast(ix, "A", [mk], H1A, adhV), contrast(ix, "P", [mk], H1A, passV("verify-prose", "verify-hook"))] as const);
  const sec1 = [
    contrast(ix, "false done verify-hook minus verify-prose", m1, H1A, fdV("verify-prose", "verify-hook"), true),
    contrast(ix, "verify-prose minus none pass", m1, ["none", "verify-prose"], passV("none", "verify-prose")),
    contrast(ix, "verify-hook minus none pass", m1, ["none", "verify-hook"], passV("none", "verify-hook")),
    contrast(ix, "verify-prose minus none false done", m1, ["none", "verify-prose"], fdV("none", "verify-prose"), true),
    contrast(ix, "verify-hook minus none false done", m1, ["none", "verify-hook"], fdV("none", "verify-hook"), true),
  ];

  // H2: gstack (verify-prose) against best-of-2 at equal spend; f re-estimated in every resample, per model.
  const H2A: HmArm[] = ["none", "plain-2", "verify-prose"], m2 = scope(ix, H2A);
  type EU = { mk: string; cluster: string; a: number; p2: number; bo2: number; g: number; cn: number; cb: number; cg: number };
  const units: EU[] = [];
  const ew = walk(ix, m2, H2A, (g, mk, t) => {
    const n = g("none");
    if (typeof n.bo2_pass !== "boolean") return false;
    units.push({ mk, cluster: repoOf(t), a: P(n), p2: P(g("plain-2")), bo2: n.bo2_pass ? 1 : 0, g: P(g("verify-prose")), cn: num(n.cost_usd), cb: num(n.cost_usd) + num(g("plain-2").cost_usd) + num(n.picker_cost_usd), cg: num(g("verify-prose").cost_usd) });
    return true;
  });
  const fOf = (us: EU[]) => { const cn = mean(us.map((u) => u.cn)), cb = mean(us.map((u) => u.cb)), cg = mean(us.map((u) => u.cg)); const den = cb - cn; return { cn, cb, cg, f: den > 0 ? Math.min(1, Math.max(0, (cg - cn) / den)) : 1 }; };
  const eOf = (us: EU[]) => { const by = new Map<string, EU[]>(); for (const u of us) (by.get(u.mk) ?? by.set(u.mk, []).get(u.mk)!).push(u); let s = 0; for (const g of by.values()) { const { f } = fOf(g); for (const u of g) s += (1 - f) * u.a + f * u.bo2 - u.g; } return us.length ? s / us.length : NaN; };
  const spend = (us: EU[]) => mean(us.map((u) => u.cb)) / mean(us.map((u) => u.cg));
  const E = { x: eOf(units), ci: iv(clusterBoot(units, eOf), 0.025), n: units.length, total: ew.total, missing: ew.missing, incomplete: ew.total === 0 || ew.missing / ew.total > BAR.missing };
  const bo2V = (b: HmArm): Val => (g) => (typeof g("none").bo2_pass === "boolean" ? [P(g(b)), g("none").bo2_pass ? 1 : 0] : "missing");
  const raw = contrast(ix, "bo2 minus gstack pass", m2, H2A, bo2V("verify-prose"));
  const sec2 = [
    raw,
    contrast(ix, "gstack minus none pass", m2, ["none", "verify-prose"], passV("none", "verify-prose")),
    contrast(ix, "bo2 minus none pass", m2, ["none", "plain-2"], bo2V("none")),
    contrast(ix, "bo2 minus verify-hook pass", m2, ["none", "plain-2", "verify-hook"], bo2V("verify-hook")),
  ];
  const d0By = m2.map((mk) => contrast(ix, "d0 " + mk, [mk], ["none", "plain-2"], passV("none", "plain-2")));
  const a5Fail = Object.entries(s1.models).filter(([, a]) => !a.a5.ok).map(([mk, a]) => mk + " " + pct(a.a5.rate));
  const a5Note = a5Fail.length ? " (picker parse rate under 95% on " + a5Fail.join(", ") + ": unparsed replies shipped attempt A)" : "";
  const perE = m2.map((mk) => {
    const us = units.filter((u) => u.mk === mk), split = us.filter((u) => u.a !== u.p2);
    return { mk, us, x: eOf(us), ci: iv(clusterBoot(us, eOf), 0.025), ...fOf(us), q: split.length ? mean(split.map((u) => u.bo2)) : null, split: split.length, pass2: mean(us.map((u) => Math.max(u.a, u.p2))), ratio: spend(us), ratioCi: iv(clusterBoot(us, spend), 0.025) };
  });

  // H3: judge-jev against judge-p1 on the judge subset; the hook-time ratio by bootstrap over the same clusters.
  const H3A: HmArm[] = ["judge-p1", "judge-jev"], m3 = scope(ix, H3A);
  const J = contrast(ix, "judge-jev minus judge-p1 pass", m3, H3A, passV("judge-p1", "judge-jev"));
  type RU = { mk: string; cluster: string; j: number; p: number };
  const ru: RU[] = [];
  walk(ix, m3, H3A, (g, mk, t) => { const j = num(g("judge-jev").hook_time_s), p = num(g("judge-p1").hook_time_s); if (Number.isFinite(j) && Number.isFinite(p)) ru.push({ mk, cluster: repoOf(t), j, p }); return true; });
  const ratioOf = (us: RU[]) => mean(us.map((u) => u.j)) / mean(us.map((u) => u.p));
  const R = { x: ratioOf(ru), ci: iv(clusterBoot(ru, ratioOf), 0.025) };
  const perJ = m3.map((mk) => ({ mk, c: contrast(ix, "pass", [mk], H3A, passV("judge-p1", "judge-jev")), x: ratioOf(ru.filter((u) => u.mk === mk)), ci: iv(clusterBoot(ru.filter((u) => u.mk === mk), ratioOf), 0.025) }));
  const sec3 = (["judge-jev", "judge-p1"] as HmArm[]).flatMap((a) => (["verify-hook", "none"] as HmArm[]).flatMap((b) => [contrast(ix, a + " minus " + b + " pass", m3, [b, a], passV(b, a)), contrast(ix, a + " minus " + b + " false done", m3, [b, a], fdV(b, a), true)]));

  // Every MDD and power line in one power.py call.
  const all = [A, Pc, ...perA.flat(), ...sec1, ...sec2, ...d0By, J, ...perJ.map((x) => x.c), ...sec3];
  const drop = cfg.drop_step ?? 0;
  const eCalls = perE.map((e, i): Call => ["sim_e", mean(e.us.map((u) => u.a)), Math.max(d0By[i]!.disc, 1e-9), e.q ?? 0.5, e.f, Math.max(e.us.length, 2), sims]);
  const extra = withMdd(all, [["Z"], ...eCalls, ["ni_power", 0.12, J.n, 0], ["ni_power", J.disc, J.n, 0]]);
  const Z = extra[0] as number;
  const eSd = perE.map((_, i) => (Array.isArray(extra[1 + i]) ? ((extra[1 + i] as number[])[0] ?? null) : null));
  const eMdd = (i: number) => (eSd[i] === null ? null : Z * eSd[i]!);
  const eMddPooled = eSd.length && eSd.every((s) => s !== null) ? (Z * Math.sqrt(eSd.reduce((a, s) => a + s! ** 2, 0))) / eSd.length : null;
  const pw = extra.slice(1 + perE.length) as (number | null)[];

  // Verdicts and end states, in section 14's order.
  const shippingIn = !s1.pooled.keep_out;
  const r1 = A.incomplete || Pc.incomplete ? "INCOMPLETE" : h1Verdict(A.ci, Pc.ci, shippingIn);
  const a3Fail = Object.entries(s1.models).filter(([mk, a]) => m1.includes(mk) && !a.a3.ok).map(([m]) => m);
  const v1 = settle("H1", r1, {
    exposure: [...expoFails(ix, m1, H1A), ...Object.entries(s1.models).filter(([mk, a]) => m1.includes(mk) && !a.a2.exposure_ok).map(([mk]) => "Stage 1 A2 exposure failed on " + mk)],
    incomplete: incl([A, Pc]), saturated: Object.entries(s1.models).filter(([mk, a]) => m1.includes(mk) && a.a2.saturated).map(([m]) => m),
  }, () => r1 === "NO MEASURABLE DIFFERENCE" ? (a3Fail.length ? "FIX-METHOD (task fit): A3 failed on " + a3Fail.join(", ") : "CUT-CANDIDATE for the hook on this rule, stated with its MDD: A's pooled MDD " + (A.mdd === null ? "n/a" : pts(A.mdd)) + " points, P's " + (Pc.mdd === null ? "n/a" : pts(Pc.mdd))) : END["H1|" + r1]!);
  const r2 = E.incomplete ? "INCOMPLETE" : h2Verdict(E.ci);
  const v2 = settle("H2", r2, { exposure: expoFails(ix, m2, H2A), incomplete: E.incomplete ? ["E missing " + E.missing + " of " + E.total] : [], saturated: a1Fail.filter((m) => m2.includes(m)) }, () => END["H2|" + r2]!);
  const pts3 = cfg.h3_admission?.points ?? [];
  let v3: { rule: string; end: string; gate?: string };
  if (!cfg.h3_admission) v3 = { rule: "NOT READ", end: "no replay admission input" };
  else if (!pts3.some((p) => p.result === "admitted")) v3 = { rule: "NOT ADMITTED", end: pts3.map((p) => (p.result === "no read" ? "FIX-METHOD (labels): " + p.point + " read NO READ" : "CUT-CANDIDATE: the " + p.point + " judgment hook, which didn't beat its deterministic version in the replay")).join("; ") || "CUT-CANDIDATE: no point reached the replay" };
  else {
    const r3 = J.incomplete ? "INCOMPLETE" : h3Verdict(J.ci, R.ci ? R.ci[1] : null);
    v3 = settle("H3", r3, { exposure: expoFails(ix, m3, H3A), incomplete: incl([J]), saturated: a1Fail.filter((m) => m3.includes(m)) }, () => END["H3|" + r3]!);
  }
  const why = (rule: string, end: string, w: () => Why) => (NULLS.includes(rule) || end.startsWith("FIX-METHOD") ? w() : undefined);
  const w1 = why(v1.rule, v1.end, () => ({ exposure: expoOf(H1A, m1), task_fit: fitOf(H1A, m1), power: "A's MDD " + (A.mdd === null ? "n/a" : pts(A.mdd)) + " points at discordance " + dec(A.disc) + " over " + A.n + " pairs; P's " + (Pc.mdd === null ? "n/a" : pts(Pc.mdd)) + " at " + dec(Pc.disc) + " over " + Pc.n, frontier: noneLine }));
  const w2 = why(v2.rule, v2.end, () => ({ exposure: expoOf(H2A, m2), task_fit: fitOf(["verify-prose"], m2), power: "E's pooled MDD " + (eMddPooled === null ? "n/a" : pts(eMddPooled)) + " points over " + E.n + " pairs; d0 " + d0By.map((c, i) => m2[i] + " " + dec(c.disc)).join(", "), frontier: noneLine }));
  const w3 = why(v3.rule, v3.end, () => ({ exposure: expoOf(H3A, m3), task_fit: fitOf(H3A, m3), power: "pass MDD " + (J.mdd === null ? "n/a" : pts(J.mdd)) + " points at discordance " + dec(J.disc) + " over " + J.n + " pairs; non-inferiority power " + (pw[0] ?? "n/a") + " at d 0.12", frontier: noneLine }));
  const verdicts: ReportJson["verdicts"] = {
    H1: { q: "H1", models: m1, ...v1, why: w1, detail: { keep_out: !shippingIn, A: { delta: A.delta, ci: A.ci, mdd: A.mdd }, P: { delta: Pc.delta, ci: Pc.ci, mdd: Pc.mdd } } },
    H2: { q: "H2", models: m2, ...v2, why: w2, detail: { E: { x: E.x, ci: E.ci, mdd: eMddPooled }, f: Object.fromEntries(perE.map((e) => [e.mk, e.f])) } },
    H3: { q: "H3", models: m3, ...v3, why: w3, detail: { pass: { delta: J.delta, ci: J.ci, mdd: J.mdd }, ratio: R, drop_step: drop } },
  };

  // The report text.
  const vline = (v: Verdict) => v.q + " VERDICT: " + v.rule + " -> " + v.end;
  h.push("# Harness mechanics report", "", "## Verdicts", "");
  let l1 = vline(verdicts.H1);
  if (!shippingIn) l1 += "; " + Pc.label + " " + pts(Pc.delta) + " points, 95% " + civ(Pc.ci) + "; the shipping test carries no verdict (A4 kept it out)";
  h.push(l1);
  if (!shippingIn && Pc.ci && Pc.ci[1] < 0) h.push("The hook arm lost passes on that interval: P is " + pts(Pc.delta) + " points, 95% " + civ(Pc.ci) + ". The shipping test carries no verdict because discordance passed the planned 0.20 (A4's pooled upper end was " + dec(s1.pooled.d.ci80?.[1] ?? NaN) + ").");
  h.push(vline(verdicts.H2) + a5Note, vline(verdicts.H3), "");
  h.push("## H1: verify-hook against verify-prose, pooled over " + m1.join(", "), "", AMENDMENT, "", "H1 pooled " + cline(A), "H1 pooled " + cline(Pc));
  per.push(...perA.map(([a, p], i) => "H1 " + m1[i] + ": " + cline(a) + " | " + cline(p)));
  h.push(...per.splice(0));
  for (const c of sec1) h.push("H1 secondary " + cline(c));
  for (const mk of m1) for (const a of H1A) {
    const g = graded(ix, mk, a);
    h.push("H1 arm " + mk + " " + a + ": waivers " + g.filter((r) => r.score.hook.waived).length + ", BLOCKED exits " + g.filter((r) => r.score.blocked_exit).length + ", blocks " + g.reduce((s, r) => s + (r.score.hook.blocks ?? 0), 0) + ", turn-cap stops " + g.filter((r) => r.turn_cap).length + ", more than one /verify load " + g.filter((r) => r.score.verify_loads > 1).length + ", an edit before the last load " + g.filter((r) => r.score.edit_before_last_load).length + ", strict rule ran " + pct(rate(g.filter((r) => r.score.adherent_strict !== null).map((r) => r.score.adherent_strict === true))) + ", left out with no edit " + g.filter((r) => r.score.adherent === null).length);
  }
  if (w1) h.push(...Object.entries(w1).map(([k, v]) => "H1 why-null " + k + ": " + v));
  h.push("", "## H2: gstack (verify-prose) against best-of-2 at equal spend, pooled over " + m2.join(", "), "", "H2 pooled E (equal-spend policy minus gstack pass): " + (E.n ? pts(E.x) + " points, 95% " + civ(E.ci) + (holds0(E.ci) ? " (no measurable difference)" : "") : "no pairs") + "; MDD " + (eMddPooled === null ? "n/a" : pts(eMddPooled)) + "; " + E.n + " pairs; missing " + E.missing + " of " + E.total + (E.incomplete ? " INCOMPLETE" : "") + a5Note);
  perE.forEach((e, i) => per.push("H2 " + e.mk + ": E " + (e.us.length ? pts(e.x) + " points, 95% " + civ(e.ci) : "no pairs") + "; MDD " + (eMdd(i) === null ? "n/a" : pts(eMdd(i)!)) + "; f " + dec(e.f) + "; spend ratio bo2 over gstack " + dec(e.ratio) + ", 95% " + div(e.ratioCi) + "; pass@2 " + pct(e.pass2) + "; picker right on " + pct(e.q) + " of " + e.split + " split tasks" + (e.f === 1 ? "; f is 1, so E is bo2 minus gstack, and gstack spends $" + (e.cg - e.cb).toFixed(2) + " more per task" : "") + a5Note));
  h.push(...per.splice(0));
  h.push("H2 pooled spend ratio bo2 over gstack " + dec(spend(units)) + ", 95% " + div(iv(clusterBoot(units, spend), 0.025)));
  for (const c of sec2) h.push("H2 secondary " + cline(c) + a5Note);
  if (w2) h.push(...Object.entries(w2).map(([k, v]) => "H2 why-null " + k + ": " + v));
  h.push("", "## H3: judge-jev against judge-p1 on the judge subset, pooled over " + (m3.join(", ") || "no model"), "", "H3 pooled " + cline(J), "H3 pooled hook-time ratio judge-jev over judge-p1 " + dec(R.x) + ", 95% " + div(R.ci));
  if (drop >= 1) h.push("H3 power after drop step " + drop + ": " + J.n + " pairs, non-inferiority power " + (pw[0] === null || pw[0] === undefined ? "n/a" : pw[0].toFixed(2)) + " at d 0.12 and " + (pw[1] === null || pw[1] === undefined ? "n/a" : pw[1].toFixed(2)) + " at the measured d " + dec(J.disc) + " (power.py ni_power, a true difference of 0)");
  for (const x of perJ) per.push("H3 " + x.mk + ": " + cline(x.c) + " | hook-time ratio " + dec(x.x) + ", 95% " + div(x.ci));
  h.push(...per.splice(0));
  for (const mk of m3) for (const a of ["judge-jev", "judge-p1"] as HmArm[]) {
    const g = graded(ix, mk, a);
    h.push("H3 secondary " + mk + " " + a + ": hook calls' model cost per session $" + mean(g.map((r) => num(r.hook_cost_usd))).toFixed(3) + ", fail-open " + g.reduce((s, r) => s + (num(r.fail_open) || 0), 0) + ", escalations " + g.reduce((s, r) => s + (num(r.escalations) || 0), 0) + ", mean hook time " + mean(g.map((r) => num(r.hook_time_s))).toFixed(1) + " s");
  }
  for (const c of sec3) h.push("H3 secondary " + cline(c));
  if (w3) h.push(...Object.entries(w3).map(([k, v]) => "H3 why-null " + k + ": " + v));

  h.push("", "## Per model", "");
  const exposure: ReportJson["exposure"] = {};
  const ARMS_ALL: HmArm[] = ["none", "plain-2", "verify-prose", "verify-hook", "judge-jev", "judge-p1"];
  for (const mk of mksAll) {
    h.push("### Model " + modelName(mk) + " (" + mk + ")", "", "| arm | graded | missing | pass | edited | rule ran | strict | false done | mean spend |", "|---|---|---|---|---|---|---|---|---|");
    exposure[mk] = {};
    for (const a of ARMS_ALL.filter((x) => ix.tasks.has(mk + "|" + x))) {
      const g = graded(ix, mk, a), cs = cellsOf(ix, mk, a), adh = g.filter((r) => r.score.adherent !== null);
      exposure[mk]![a] = expo(ix, mk, a);
      h.push("| " + a + " | " + g.length + " | " + (cs.length - g.length) + " | " + pct(rate(g.map((r) => r.pass))) + " | " + pct(rate(g.map((r) => r.score.edited))) + " | " + pct(rate(adh.map((r) => r.score.adherent === true))) + " | " + pct(rate(adh.map((r) => r.score.adherent_strict === true))) + " | " + pct(rate(g.map((r) => r.score.false_done === true))) + " | " + (Number.isFinite(mean(g.map((r) => num(r.cost_usd)))) ? "$" + mean(g.map((r) => num(r.cost_usd))).toFixed(2) : "n/a") + " |");
    }
    h.push("");
  }
  h.push("## Exposure", "");
  for (const mk of mksAll) for (const [a, e] of Object.entries(exposure[mk]!)) h.push("EXPOSURE " + mk + " " + a + ": " + expoText(e));
  h.push("", "## Patterns 1 to 3", "", ...patternsPerArm(rows.filter((r) => r.outcome === "graded")).lines, "", "## Stage 1 admission", "", ...s1.lines);
  const { lines: _l, ...adm } = s1;
  const json: ReportJson = { schema: "hm-report/1", verdicts, exposure, admission: adm };
  if (o.out) {
    mkdirSync(o.out, { recursive: true });
    writeFileSync(join(o.out, "report.md"), h.join("\n") + "\n");
    writeFileSync(join(o.out, "report.json"), JSON.stringify(json, null, 2) + "\n");
  }
  return { lines: h, json };
}
