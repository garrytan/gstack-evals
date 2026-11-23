// Copyright (c) 2026 Garry Tan. MIT License.
// Section 12's admission readings and section 13's stage 2 rule, as pure functions over counts and costs. They print a
// reading and the next step; none opens a lease, records a cap or starts a session.

const M = 1_000_000;

// ---- Section 13: claim 1's stage 2 rule ----

/** Stage 2's size: 120 fresh units, A0, A1 and A2 once each; VMs per session from section 16; the owner's all-in line. */
export const STAGE2 = { units: 120, arms: 3, vm_micros: 0.08 * M, owner_line_micros: 5000 * M } as const;
export interface Stage2 { model: string; a1_clean: number; a2_clean: number; eligible: boolean; projection_micros: number | null; text: string }

/** On a model where A1 clean-fixes more test units than A2, claim 1 gets a stage 2 that needs a cap the Captain records
 *  first; otherwise claim 1's result on that model is final at n = 60. meanFirstMicros, when given, is the test run's
 *  measured mean first-stage session cost on that model, and prices stage 2. */
export function stage2Rule(model: string, a1Clean: number, a2Clean: number, meanFirstMicros?: number): Stage2 {
  for (const [k, v] of [["A1", a1Clean], ["A2", a2Clean]] as const) if (!Number.isSafeInteger(v) || v < 0) throw new Error("E_SM_ANALYSIS " + k + "'s clean-fix count must be a whole number of at least 0");
  const eligible = a1Clean > a2Clean;
  const projection = eligible && meanFirstMicros !== undefined ? Math.round(STAGE2.units * STAGE2.arms * (meanFirstMicros + STAGE2.vm_micros)) : null;
  const text = eligible
    ? "stage 2 eligible on " + model + " (A1 clean-fixed " + a1Clean + " test units, A2 " + a2Clean + "): 120 fresh units by the same draw rule, A0, A1 and A2 once each, analysed on its own and never pooled with the 60; it needs a cap the Captain records first" +
      (projection === null ? "" : "; projection " + projection + " micros from the measured mean session cost") + "; a projection past " + STAGE2.owner_line_micros + " micros all-in goes to the owner. Nothing was opened."
    : "final at n = 60 on " + model + " (A1 clean-fixed " + a1Clean + " test units, A2 " + a2Clean + "): claim 1 has no stage 2 on this model.";
  return { model, a1_clean: a1Clean, a2_clean: a2Clean, eligible, projection_micros: projection, text };
}

// ---- Section 12: admission readings ----

export const FLOOR_CLEAN_FIXES = 3;
export interface Claim1Admission { reading: "OK" | "FLOOR"; scope: "folder" | "file" | null; clean: number; sessions: number; retry: { clean: number; sessions: number } | null; next: string }

/** Claim 1 FLOOR: fewer than 3 clean fixes across the admission sessions (A0 and A1 together). On FLOOR the scope switches
 *  to the fix's changed files for every arm and model and 15 fresh units rerun the check; FLOOR again stops claim 1. */
export function claim1Admission(clean: number, sessions: number, retry?: { clean: number; sessions: number }): Claim1Admission {
  const floor = (c: number) => c < FLOOR_CLEAN_FIXES;
  if (!floor(clean)) return { reading: "OK", scope: "folder", clean, sessions, retry: null, next: "claim 1 runs at folder scope (" + clean + " clean fixes in " + sessions + " sessions)" };
  if (!retry) return { reading: "FLOOR", scope: null, clean, sessions, retry: null, next: "FLOOR (" + clean + " clean fixes in " + sessions + " sessions): switch the scope rule to the fix's changed files for every arm and model and rerun the check on 15 fresh admission units at file scope (the draw's retry units)" };
  if (!floor(retry.clean)) return { reading: "OK", scope: "file", clean, sessions, retry, next: "claim 1 runs at file scope for every arm and model (retry: " + retry.clean + " clean fixes in " + retry.sessions + " sessions)" };
  return { reading: "FLOOR", scope: null, clean, sessions, retry, next: "FLOOR at folder and file scope: claim 1 stops and is reported as a finding (neither prompt fixes these real bugs blind at a rate we can measure on Opus); A0 and A2 are not run; claim 2 continues at folder scope" };
}

export const HEADROOM = { low: 0.15, high: 0.9 } as const;
export interface Claim2Admission { reading: "OK" | "CEILING" | "FLOOR"; mean: number; raised: number | null; issue: "full" | "cut" | null; models: string; next: string }

/** Claim 2 headroom: the untouched-tree follow-on's mean incremental score on Opus must sit from 0.15 to 0.90, both
 *  included. Above 0.90 is CEILING and gets one raise attempt (the issue cut to its title and first paragraph); the
 *  raised mean reads by the same rule. Below 0.15 is FLOOR and claim 2 stops. */
export function claim2Admission(mean: number, raised?: number): Claim2Admission {
  const band = (v: number) => (v < HEADROOM.low ? "FLOOR" : v > HEADROOM.high ? "CEILING" : "OK");
  const r = band(mean);
  if (r === "FLOOR") return { reading: "FLOOR", mean, raised: null, issue: null, models: "none", next: "FLOOR (mean " + mean.toFixed(3) + " below 0.15): claim 2 stops" };
  if (r === "OK") return { reading: "OK", mean, raised: null, issue: "full", models: "all three", next: "claim 2 runs on every model with the full issue (mean " + mean.toFixed(3) + ")" };
  if (raised === undefined) return { reading: "CEILING", mean, raised: null, issue: null, models: "pending", next: "CEILING for Opus (mean " + mean.toFixed(3) + " above 0.90): one raise attempt cuts the follow-on's issue to its title and first paragraph, checked on the same 15 units" };
  const r2 = band(raised);
  if (r2 === "CEILING") return { reading: "CEILING", mean, raised, issue: "full", models: "Sol and particle-1", next: "CEILING on Opus after the raise attempt (" + raised.toFixed(3) + "): claim 2 runs on Sol and particle-1 only" };
  if (r2 === "FLOOR") return { reading: "FLOOR", mean, raised, issue: null, models: "none", next: "the cut issue reads FLOOR (" + raised.toFixed(3) + " below 0.15): claim 2 stops" };
  return { reading: "OK", mean, raised, issue: "cut", models: "all three", next: "claim 2 runs on every model with the cut issue (raised mean " + raised.toFixed(3) + ")" };
}

/** The raise attempt's issue cut: the title and its first paragraph; a blank line after the title is skipped. */
export function issueCut(issue: string): string {
  const lines = issue.replace(/\r\n/g, "\n").split("\n");
  const blank = (i: number) => !lines[i]!.trim();
  let i = 0;
  while (i < lines.length && blank(i)) i++;
  const title = lines[i++] ?? "";
  const gap = i < lines.length && blank(i);
  while (i < lines.length && blank(i)) i++;
  const para: string[] = [];
  for (; i < lines.length && !blank(i); i++) para.push(lines[i]!);
  return [title, ...(gap && para.length ? [""] : []), ...para].join("\n").trimEnd() + "\n";
}

/** Nearest-rank 95th percentile. */
export function p95(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.ceil(0.95 * s.length) - 1]!;
}

export type Stage = "first" | "followon";
export type Allowances = Record<Stage, Record<string, number>>;
export interface CostReading { stage: Stage; sessions: number; p95_micros: number | null; half_allowance_micros: number; over: boolean }

/** Section 6's cost check: Opus's 95th-percentile session cost per stage against half that stage's Opus allowance. */
export function costReading(costs: Record<Stage, readonly number[]>, allowances: Allowances, opus = "claude-opus-5-5"): CostReading[] {
  return (["first", "followon"] as Stage[]).map((stage) => {
    const a = allowances[stage][opus];
    if (!Number.isSafeInteger(a) || a! <= 0) throw new Error("E_SM_ANALYSIS no " + stage + " allowance in micros for " + opus);
    const p = p95(costs[stage]);
    return { stage, sessions: costs[stage].length, p95_micros: p, half_allowance_micros: a! / 2, over: p !== null && p > a! / 2 };
  });
}

/** The allowance doubling: every model's allowance doubles on each stage whose Opus reading is over. Returns new limits;
 *  the Captain sees the new projection before the test run uses them. */
export function doubledAllowances(allowances: Allowances, readings: readonly CostReading[]): Allowances {
  const over = new Set(readings.filter((r) => r.over).map((r) => r.stage));
  const out = {} as Allowances;
  for (const stage of ["first", "followon"] as Stage[]) out[stage] = Object.fromEntries(Object.entries(allowances[stage]).map(([m, v]) => [m, over.has(stage) ? v * 2 : v]));
  return out;
}

export interface InfraReading { reading: "OK" | "INFRA"; cells: Array<{ cell: string; units: number; gaps: number; over: boolean }> }
/** INFRA: gaps on more than 10% of any admission cell's units (exactly 10% is not over). */
export function infraReading(cells: ReadonlyArray<{ cell: string; units: number; gaps: number }>): InfraReading {
  const out = cells.map((c) => ({ ...c, over: c.gaps * 10 > c.units }));
  return { reading: out.some((c) => c.over) ? "INFRA" : "OK", cells: out };
}
