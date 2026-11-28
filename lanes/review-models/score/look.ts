// Copyright (c) 2026 Garry Tan. MIT License.
// The interim look and the final read (prereg section 8 and "Interim look", as change 1 item 4 words them). Each
// contrast is a weighted sum of cells per bug unit, paired by unit. Net value per unit = $25 x catch minus dollars, so a
// contrast's net value is $25 x its catch difference minus its cost difference. Every bound is the mean plus or minus z
// times its clustered bootstrap standard error (stats.ts):
// - the look, at half the counted bug units rounded down in seeded order, is futility only: a decision contrast whose
//   upper bound at z 2.797 is below 0 is a binding "doesn't pay" and is not read again;
// - at the end, "pays" is a lower bound at z 1.655 above 0 and "doesn't pay" an upper bound at z 1.655 below 0, else
//   "unsettled";
// - catches more or fewer: two-sided normal p on the catch difference, Holm over the decision contrasts;
// - printed intervals are the mean plus or minus 1.96 SE.
// Decisions read can't tell as a miss. Gaps and contaminated reviews are read both ways (dropped and as a miss); the plan
// prints both and names neither as the decider, so a verdict holds only where both readings give it, and a look stops a
// contrast only when both readings cross.
import { holmAdjusted } from "../../../src/runner/stats/paired.ts";
import { phi } from "../../../src/runner/stats/outcome-decision.ts";
import { rmFail, VALUE_PER_CATCH, Z, type Arm } from "./frozen.ts";
import { GAP_READINGS, unitTable, type CatchReading, type Cell, type GapReading, type Review, type UnitRow } from "./score.ts";
import type { ProceedSet } from "./staged.ts";
import { clusteredMeanSe, type MeanSe } from "./stats.ts";

export interface Contrast {
  name: string;
  weights: Partial<Record<Arm, number>>;
  /** The decision this contrast settles, or null for a printed secondary. */
  decision: "main" | "voice" | null;
}

const c = (name: string, weights: Partial<Record<Arm, number>>, decision: Contrast["decision"] = null): Contrast => ({ name, weights, decision });

/** The contrasts each frozen proceed set reads: its decisions first, then the secondaries and every gstack cell against N. */
export function contrastsFor(set: ProceedSet): Contrast[] {
  const vsN = (arms: Arm[]) => arms.map((a) => c(a + " minus N", { [a]: 1, N: -1 }));
  if (set === "all")
    return [
      c("main reviewer: Fable minus Opus", { FS: 0.5, FA: 0.5, OS: -0.5, OA: -0.5 }, "main"),
      c("voice: Astra minus Sol", { OA: 0.5, FA: 0.5, OS: -0.5, FS: -0.5 }, "voice"),
      c("package: FA minus OS", { FA: 1, OS: -1 }),
      c("interaction: FA minus FS minus OA plus OS", { FA: 1, FS: -1, OA: -1, OS: 1 }),
      c("voice on Opus: OA minus OS", { OA: 1, OS: -1 }),
      c("voice on Fable: FA minus FS", { FA: 1, FS: -1 }),
      ...vsN(["OS", "OA", "FS", "FA"]),
    ];
  if (set === "OS_OA_N") return [c("voice: OA minus OS", { OA: 1, OS: -1 }, "voice"), ...vsN(["OS", "OA"])];
  if (set === "OS_FS_N") return [c("main reviewer: FS minus OS", { FS: 1, OS: -1 }, "main"), ...vsN(["OS", "FS"])];
  return [];
}

type Metric = "catch" | "blocking" | "usd" | "wall" | "net";
const metricOf = (cell: Cell, m: Metric): number | null => (m === "net" ? VALUE_PER_CATCH * cell.catch - cell.usd : m === "wall" ? cell.wall : cell[m]);

/** The contrast's value on each unit whose weighted cells are all present and not dropped. */
export function contrastValues(rows: readonly UnitRow[], ct: Contrast, m: Metric) {
  const arms = Object.entries(ct.weights).filter(([, w]) => w) as Array<[Arm, number]>;
  return rows.flatMap((row) => {
    let value = 0;
    for (const [arm, w] of arms) {
      const cell = row.cells[arm];
      const v = cell ? metricOf(cell, m) : null;
      if (v === null) return [];
      value += w * v;
    }
    return [{ unit: row.unit, cluster: row.cluster, value }];
  });
}

const stat = (rows: readonly UnitRow[], ct: Contrast, m: Metric): MeanSe | null => {
  const v = contrastValues(rows, ct, m);
  return v.length ? clusteredMeanSe(v) : null;
};

export const upper = (s: MeanSe | null, z: number) => (s && s.se !== null ? s.mean + z * s.se : null);
export const lower = (s: MeanSe | null, z: number) => (s && s.se !== null ? s.mean - z * s.se : null);

export interface Reading {
  net: MeanSe | null;
  catch: MeanSe | null;
  blocking: MeanSe | null;
  usd: MeanSe | null;
  wall: MeanSe | null;
  /** Mean cost difference over mean catch difference, when the catch difference is above 0. */
  usd_per_extra_catch: number | null;
}

export function reading(rows: readonly UnitRow[], ct: Contrast): Reading {
  const r = { net: stat(rows, ct, "net"), catch: stat(rows, ct, "catch"), blocking: stat(rows, ct, "blocking"), usd: stat(rows, ct, "usd"), wall: stat(rows, ct, "wall") };
  return { ...r, usd_per_extra_catch: r.catch && r.usd && r.catch.mean > 0 ? r.usd.mean / r.catch.mean : null };
}

const tables = (reviews: readonly Review[], catchReading: CatchReading, only?: ReadonlySet<string>) =>
  Object.fromEntries(GAP_READINGS.map((g) => [g, unitTable(reviews, { catchReading, gapReading: g }).filter((r) => !only || only.has(r.unit))])) as Record<GapReading, UnitRow[]>;

export interface LookContrast {
  name: string;
  decision: "main" | "voice";
  upper: Record<GapReading, number | null>;
  net: Record<GapReading, MeanSe | null>;
  doesnt_pay: boolean;
}

export interface Look {
  look_units: string[];
  contrasts: LookContrast[];
  /** Cells no open decision contrast needs. OS, every contrast's reference, and N (R44) are never stopped. */
  stop_cells: Arm[];
}

/** The one binding look, futility only. order is the counted bug units in seeded order; counted is how many there are. */
export function interimLook(reviews: readonly Review[], set: ProceedSet, order: readonly string[], counted: number): Look {
  if (order.length !== counted || new Set(order).size !== counted) rmFail("E_RM_SCORE_INPUT", "the seeded order must list each of the " + counted + " counted bug units once");
  const look = order.slice(0, Math.floor(counted / 2));
  const t = tables(reviews, "strict", new Set(look));
  const have = new Set(t.miss.map((r) => r.unit));
  const missing = look.filter((u) => !have.has(u));
  if (missing.length) rmFail("E_RM_SCORE_INPUT", "look units with no bug-unit review: " + missing.slice(0, 5).join(", "));
  const contrasts = contrastsFor(set).flatMap((ct) => {
    if (!ct.decision) return [];
    const net = { dropped: stat(t.dropped, ct, "net"), miss: stat(t.miss, ct, "net") };
    const up = { dropped: upper(net.dropped, Z.look), miss: upper(net.miss, Z.look) };
    return [{ name: ct.name, decision: ct.decision, net, upper: up, doesnt_pay: GAP_READINGS.every((g) => up[g] !== null && up[g]! < 0) }];
  });
  const open = contrastsFor(set).filter((ct) => ct.decision && !contrasts.find((l) => l.name === ct.name)!.doesnt_pay);
  const needed = new Set<Arm>(["OS", "N", ...open.flatMap((ct) => Object.keys(ct.weights) as Arm[])]);
  const inSet = [...new Set(contrastsFor(set).flatMap((ct) => Object.keys(ct.weights) as Arm[]))];
  return { look_units: look, contrasts, stop_cells: inSet.filter((a) => !needed.has(a)) };
}

export type PayVerdict = "pays" | "doesn't pay" | "unsettled";
export type CatchVerdict = "catches more" | "catches fewer" | "not distinguished";

export interface FinalContrast {
  name: string;
  decision: Contrast["decision"];
  /** Set when the contrast is not read: decided at the look, or an arm in it is untested. */
  status: "read" | "decided at the look" | "untested";
  untested: string[];
  pay: Record<GapReading, PayVerdict | null>;
  /** The verdict both gap readings give, else unsettled. */
  pay_verdict: PayVerdict | null;
  readings_agree: boolean | null;
  catch_p: Record<GapReading, number | null>;
  /** Holm over the decision contrasts; null on a secondary. */
  catch_p_holm: Record<GapReading, number | null>;
  catch_verdict: CatchVerdict | null;
  strict: Record<GapReading, Reading>;
  lenient: Record<GapReading, Reading>;
  by_pool: Record<"P" | "B", Record<GapReading, Reading>>;
  /** The voice contrast on S2-openai units alone. */
  s2_openai: Record<GapReading, Reading> | null;
}

const payVerdict = (s: MeanSe | null): PayVerdict | null => {
  if (!s || s.se === null) return null;
  return lower(s, Z.end)! > 0 ? "pays" : upper(s, Z.end)! < 0 ? "doesn't pay" : "unsettled";
};
const twoSidedP = (s: MeanSe | null) => (s && s.se !== null ? (s.se === 0 ? (s.mean === 0 ? 1 : 0) : 2 * (1 - phi(Math.abs(s.mean / s.se)))) : null);
const agreed = <T>(x: Record<GapReading, T | null>, fallback: T): T | null => (x.dropped === null || x.miss === null ? null : x.dropped === x.miss ? x.dropped : fallback);

/** The final read of every contrast the set holds. untested maps an arm to why it reads untested (score.ts armSummaries). */
export function finalRead(reviews: readonly Review[], set: ProceedSet, o: { decidedAtLook?: readonly string[]; untested?: Partial<Record<Arm, string[]>> } = {}): FinalContrast[] {
  const strict = tables(reviews, "strict");
  const lenient = tables(reviews, "lenient");
  const pool = (p: "P" | "B") => Object.fromEntries(GAP_READINGS.map((g) => [g, strict[g].filter((r) => r.pool === p)])) as Record<GapReading, UnitRow[]>;
  const s2 = Object.fromEntries(GAP_READINGS.map((g) => [g, strict[g].filter((r) => r.stratum === "S2-openai")])) as Record<GapReading, UnitRow[]>;
  const each = (t: Record<GapReading, UnitRow[]>, ct: Contrast) => Object.fromEntries(GAP_READINGS.map((g) => [g, reading(t[g], ct)])) as Record<GapReading, Reading>;
  const out: FinalContrast[] = contrastsFor(set).map((ct) => {
    const untested = (Object.keys(ct.weights) as Arm[]).flatMap((a) => (o.untested?.[a] ?? []).map((why) => a + ": " + why));
    const decided = ct.decision !== null && (o.decidedAtLook ?? []).includes(ct.name);
    const s = each(strict, ct);
    const pay = { dropped: payVerdict(s.dropped.net), miss: payVerdict(s.miss.net) };
    return {
      name: ct.name,
      decision: ct.decision,
      status: decided ? "decided at the look" : untested.length ? "untested" : "read",
      untested,
      pay: decided || untested.length ? { dropped: null, miss: null } : pay,
      pay_verdict: decided ? "doesn't pay" : untested.length ? null : agreed(pay, "unsettled" as PayVerdict),
      readings_agree: decided || untested.length || pay.dropped === null || pay.miss === null ? null : pay.dropped === pay.miss,
      catch_p: { dropped: twoSidedP(s.dropped.catch), miss: twoSidedP(s.miss.catch) },
      catch_p_holm: { dropped: null, miss: null },
      catch_verdict: null,
      strict: s,
      lenient: each(lenient, ct),
      by_pool: { P: each(pool("P"), ct), B: each(pool("B"), ct) },
      s2_openai: ct.decision === "voice" ? each(s2, ct) : null,
    };
  });
  const family = out.filter((f) => f.decision && f.status !== "untested");
  for (const g of GAP_READINGS) {
    const ps = family.map((f) => f.catch_p[g]);
    if (ps.some((p) => p === null)) continue;
    holmAdjusted(ps as number[]).forEach((p, i) => (family[i]!.catch_p_holm[g] = p));
  }
  for (const f of family) {
    const v = Object.fromEntries(GAP_READINGS.map((g) => {
      const p = f.catch_p_holm[g], m = f.strict[g].catch?.mean ?? 0;
      return [g, p === null ? null : p < 0.05 && m > 0 ? "catches more" : p < 0.05 && m < 0 ? "catches fewer" : "not distinguished"];
    })) as Record<GapReading, CatchVerdict | null>;
    f.catch_verdict = agreed(v, "not distinguished" as CatchVerdict);
  }
  return out;
}

const money = (x: number) => (x < 0 ? "-$" : "$") + Math.abs(x).toFixed(2);
const iv = (s: MeanSe | null, fmt: (x: number) => string) => (!s ? "n/a" : fmt(s.mean) + (s.interval ? " [" + fmt(s.interval[0]) + ", " + fmt(s.interval[1]) + "]" : " (one cluster)"));

/** One line per contrast and gap reading. */
export function renderFinal(rows: readonly FinalContrast[]): string[] {
  return rows.flatMap((f) => {
    if (f.status !== "read") return [f.name + ": " + (f.status === "untested" ? "untested (" + f.untested.join("; ") + ")" : "doesn't pay, decided at the look")];
    return [
      f.name + ": " + (f.decision ? "pays? " + f.pay_verdict + (f.readings_agree === false ? " (gap readings disagree)" : "") + "; " + f.catch_verdict : "secondary"),
      ...GAP_READINGS.map((g) => "  gaps " + g + ": net value " + iv(f.strict[g].net, money) + " per unit, catch " + iv(f.strict[g].catch, (x) => (100 * x).toFixed(1) + " pts") + ", cost " + iv(f.strict[g].usd, money) + ", $ per extra catch " + (f.strict[g].usd_per_extra_catch === null ? "n/a" : money(f.strict[g].usd_per_extra_catch!)) + "; can't tell as naming: net " + iv(f.lenient[g].net, money)),
    ];
  });
}
