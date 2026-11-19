// Copyright (c) 2026 Garry Tan. MIT License.
// B1's report from the session table: per model and arm, the share of graded sessions that followed the Prove-It steps
// (detect.ts) with its Wilson 95% interval, the 80% bar and the gap rule; the paired contrasts between arms on the tasks
// graded in both, with Newcombe's interval for paired proportions; and the decision reading (prereg section 8), on Opus,
// with Sol and particle-1 read the same way and reported as descriptive. Passes are descriptive only. Beside each arm's
// primary it prints the reading under the rule as merged, before deviation D1 (detect.ts followed_as_merged).
import { ARM_NAMES, B1, MODEL_KEYS, MODELS, type B1Arm, type ModelKey } from "./pins.ts";
import type { B1Row } from "./table.ts";

const Z = 1.959963984540054;
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const p = k / n, d = 1 + (Z * Z) / n, c = p + (Z * Z) / (2 * n), h = Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}
/** Newcombe's method 10 for a difference of paired proportions: a = both, b = first only, c = second only, d = neither. Each
 *  margin's Wilson interval, joined by phi whose numerator ad - bc is continuity-corrected: ad - bc - n/2 when that is
 *  positive, 0 when ad - bc lies between 0 and n/2, and ad - bc unchanged when it is negative (Newcombe 1998; Altman et al.
 *  2000, Statistics with Confidence, p. 52). */
export function newcombe(a: number, b: number, c: number, d: number): { diff: number; lo: number; hi: number } {
  const n = a + b + c + d;
  if (!n) return { diff: 0, lo: -1, hi: 1 };
  const p1 = (a + b) / n, p2 = (a + c) / n, [l1, u1] = wilson(a + b, n), [l2, u2] = wilson(a + c, n);
  const den = Math.sqrt((a + b) * (c + d) * (a + c) * (b + d));
  const cross = a * d - b * c, phi = den ? (cross > n / 2 ? cross - n / 2 : cross < 0 ? cross : 0) / den : 0;
  const diff = p1 - p2;
  return {
    diff,
    lo: diff - Math.sqrt(Math.max(0, (p1 - l1) ** 2 - 2 * phi * (p1 - l1) * (u2 - p2) + (u2 - p2) ** 2)),
    hi: diff + Math.sqrt(Math.max(0, (u1 - p1) ** 2 - 2 * phi * (u1 - p1) * (p2 - l2) + (p2 - l2) ** 2)),
  };
}

export type ArmStat = { arm: B1Arm; planned: number; graded: number; gaps: number; cap_stops: number; followed: number; rate: number | null; ci: [number, number] | null; incomplete: boolean; reaches: boolean;
  followed_tool_only: number; unresolved_sessions: number; unresolved_writes: number; spec_folder_sessions: number; followed_low: number; followed_high: number;
  source_changed: number; bash_only_source: number; source_write_unseen: number; unread_background: number; steps_seen: number; loaded: number; passes: number; safety_stops: number; audit_sessions: number; mean_cost_usd: number | null };
export type Contrast = { a: B1Arm; b: B1Arm; pairs: number; both: number; a_only: number; b_only: number; neither: number; diff: number; lo: number; hi: number };
// The contrasts the report prints, each as first minus second: every route against none, and the routes against each other.
export const CONTRASTS: [B1Arm, B1Arm][] = [["described", "none"], ["gstack-shaped", "none"], ["command", "none"], ["command", "gstack-shaped"], ["described", "gstack-shaped"], ["command", "described"]];

/** The followed count an arm needs on n graded sessions, and the most gaps an arm may have, as integers. */
export const barCount = (n: number) => Math.ceil(n * B1.bar - 1e-9);
export const maxGaps = (planned: number) => Math.floor(planned * B1.gapMax + 1e-9);
/** A session the sensitivity line scores both ways: a Bash write no parser can name, or a non-spec file under a spec folder. */
const bothWays = (r: B1Row) => r.detect.unresolved_writes > 0 || r.detect.spec_folder_write;
export function armStats(rows: B1Row[], planned: number): ArmStat[] {
  const capped = rows.some((r) => r.outcome === "cap_stop");
  return ARM_NAMES.map((arm) => {
    const all = rows.filter((r) => r.arm === arm), g = all.filter((r) => r.outcome === "graded");
    const k = g.filter((r) => r.detect.followed).length, count = (f: (r: B1Row) => boolean) => g.filter(f).length;
    const gaps = planned - g.length, incomplete = gaps > maxGaps(planned) || capped;
    const costs = all.map((r) => r.cost_usd).filter((x): x is number => x !== null);
    return {
      arm, planned, graded: g.length, gaps, cap_stops: all.filter((r) => r.outcome === "cap_stop").length, followed: k, rate: g.length ? k / g.length : null, ci: g.length ? wilson(k, g.length) : null,
      incomplete, reaches: !incomplete && g.length > 0 && k >= barCount(g.length),
      followed_tool_only: count((r) => r.detect.followed_tool_only),
      unresolved_sessions: count((r) => r.detect.unresolved_writes > 0), unresolved_writes: g.reduce((x, r) => x + r.detect.unresolved_writes, 0), spec_folder_sessions: count((r) => r.detect.spec_folder_write),
      followed_low: count((r) => r.detect.followed && !bothWays(r)), followed_high: count((r) => r.detect.followed || bothWays(r)),
      source_changed: count((r) => r.detect.source_changed), bash_only_source: count((r) => r.detect.bash_only_source),
      source_write_unseen: count((r) => r.detect.source_write_unseen), unread_background: count((r) => r.detect.unread_background > 0), steps_seen: count((r) => r.steps_seen === true),
      loaded: count((r) => r.skill_loads > 0), passes: count((r) => r.pass), safety_stops: all.filter((r) => r.safety_stop).length, audit_sessions: all.filter((r) => r.audit_hits.length > 0).length,
      mean_cost_usd: costs.length ? costs.reduce((x, y) => x + y, 0) / costs.length : null,
    };
  });
}

/** Rows the report must not read: one problem per row whose task is not one of the drawn run tasks (smoke and calibration
 *  tasks included), and one per model, arm and task with more than one graded row. Infra and cap-stop rows never count as
 *  repeats, so an attempt 2 or a relaunch after one is read. */
export function checkRows(rows: B1Row[], drawn: string[]): string[] {
  const run = new Set(drawn), graded = new Map<string, number>(), bad: string[] = [];
  for (const r of rows) {
    if (!run.has(r.task)) bad.push(r.trial + ": task " + r.task + " is not one of the " + run.size + " drawn tasks");
    if (r.outcome === "graded") graded.set(r.model + " " + r.arm + " " + r.task, (graded.get(r.model + " " + r.arm + " " + r.task) ?? 0) + 1);
  }
  for (const [k, n] of graded) if (n > 1) bad.push(k + " has " + n + " graded rows, not 1");
  return bad;
}

export function contrast(rows: B1Row[], a: B1Arm, b: B1Arm): Contrast {
  const graded = (arm: B1Arm) => new Map(rows.filter((r) => r.arm === arm && r.outcome === "graded").map((r) => [r.task, r.detect.followed]));
  const A = graded(a), B = graded(b);
  let both = 0, aOnly = 0, bOnly = 0, neither = 0;
  for (const [t, x] of A) { if (!B.has(t)) continue; const y = B.get(t)!; if (x && y) both++; else if (x) aOnly++; else if (y) bOnly++; else neither++; }
  return { a, b, pairs: both + aOnly + bOnly + neither, both, a_only: aOnly, b_only: bOnly, neither, ...newcombe(both, aOnly, bOnly, neither) };
}

/** Section 8's reading, from which arms reach the bar and the two guarded contrasts. guard: a reading that rests on one
 *  route beating gstack-shaped also needs that paired contrast's 95% interval above 0. */
export type Reading = { key: "incomplete" | "ceiling" | "steps-first" | "descriptions" | "layout-ok" | "hooks" | "not-shown"; text: string };
export function reading(stats: ArmStat[], contrasts: Contrast[], guard = true): Reading {
  const s = (a: B1Arm) => stats.find((x) => x.arm === a)!, up = (a: B1Arm, b: B1Arm) => !guard || (contrasts.find((c) => c.a === a && c.b === b)?.lo ?? -1) > 0;
  if (stats.some((x) => x.incomplete)) {
    const capped = stats.reduce((k, x) => k + x.cap_stops, 0);
    return { key: "incomplete", text: "INCOMPLETE: " + [...(capped ? ["the item stopped at its cap (" + capped + " cap stop sessions)"] : []), ...stats.filter((x) => x.gaps > maxGaps(x.planned)).map((x) => x.arm + " has " + x.gaps + " of " + x.planned + " sessions ungraded")].join("; ") + "; no reading" };
  }
  const [N, D, G, C] = (["none", "described", "gstack-shaped", "command"] as B1Arm[]).map((a) => s(a).reaches);
  if (N) return { key: "ceiling", text: "none reaches the bar: the model follows the steps unprompted, so no route can show lift here" };
  if (C && !G) return up("command", "gstack-shaped") ? { key: "steps-first", text: "command reaches the bar and gstack-shaped does not: move checkable steps to the top of routed skills" + (D ? "; the described skill reaches it too" : "") } : { key: "not-shown", text: "command reaches the bar and gstack-shaped does not, but their paired difference's interval includes 0: no layout change is shown" };
  if (G) return { key: "layout-ok", text: "gstack-shaped reaches the bar" + (C ? " and so does command" : "") + ": the setup-first layout does not stop the steps, so no layout change" + (D ? "; the described skill reaches it too" : "") };
  if (D) return up("described", "gstack-shaped") ? { key: "descriptions", text: "only the described skill reaches the bar: long descriptions get the steps followed, and gstack's short descriptions are the gap" } : { key: "not-shown", text: "only the described skill reaches the bar, but its paired difference from gstack-shaped has an interval that includes 0: no description change is shown" };
  return { key: "hooks", text: "no route reaches the bar: keep hooks for steps that must run, and stop spending on wording" };
}

const pct = (x: number | null) => (x === null ? "n/a" : (100 * x).toFixed(1) + "%");
const pts = (x: number) => (x >= 0 ? "+" : "") + (100 * x).toFixed(1);
/** The rows with the primary under the rule as merged, before deviation D1, for the report's sensitivity lines. */
export const asMerged = (rows: B1Row[]): B1Row[] => rows.map((r) => ({ ...r, detect: { ...r.detect, followed: r.detect.followed_as_merged } }));
type ModelReport = { stats: ArmStat[]; contrasts: Contrast[]; reading: Reading };
export function report(rows: B1Row[], planned = B1.tasks) {
  const lines: string[] = [];
  const out: Record<string, ModelReport & { as_merged: ModelReport }> = {};
  for (const m of MODEL_KEYS) {
    const mine = rows.filter((r) => r.model === MODELS[m].id);
    if (!mine.length) continue;
    const stats = armStats(mine, planned), contrasts = CONTRASTS.map(([a, b]) => contrast(mine, a, b)), r = reading(stats, contrasts);
    const merged = asMerged(mine), mStats = armStats(merged, planned), mContrasts = CONTRASTS.map(([a, b]) => contrast(merged, a, b));
    out[m] = { stats, contrasts, reading: r, as_merged: { stats: mStats, contrasts: mContrasts, reading: reading(mStats, mContrasts) } };
    lines.push("== " + MODELS[m].id + (m === "opus" ? " (decision model)" : " (descriptive)"));
    for (const s of stats) lines.push("  " + s.arm + ": followed " + s.followed + "/" + s.graded + " " + pct(s.rate) + (s.ci ? " [" + pct(s.ci[0]) + ", " + pct(s.ci[1]) + "]" : "") + (s.reaches ? " REACHES" : "") + (s.incomplete ? " INCOMPLETE" : "") + "; gaps " + s.gaps + ", cap stops " + s.cap_stops + ", tool-only " + s.followed_tool_only + ", bash-only source " + s.bash_only_source + ", unseen source " + s.source_write_unseen + ", steps seen " + s.steps_seen + ", loaded " + s.loaded + ", safety stops " + s.safety_stops + ", audit " + s.audit_sessions + ", passes " + s.passes + " (descriptive)");
    for (const s of stats) lines.push("  " + s.arm + " sensitivity: " + s.unresolved_writes + " Bash writes no parser can name, in " + s.unresolved_sessions + " sessions; " + s.spec_folder_sessions + " sessions write a non-spec file under a spec folder; followed " + s.followed_low + "/" + s.graded + " with those sessions scored not followed, " + s.followed_high + "/" + s.graded + " scored followed" + (s.graded && !s.incomplete && (s.followed_low >= barCount(s.graded)) !== (s.followed_high >= barCount(s.graded)) ? "; the bar reading rests on them" : ""));
    for (const s of mStats) lines.push("  " + s.arm + " as merged, before D1: followed " + s.followed + "/" + s.graded + " " + pct(s.rate) + (s.ci ? " [" + pct(s.ci[0]) + ", " + pct(s.ci[1]) + "]" : "") + (s.reaches ? " REACHES" : ""));
    for (const c of contrasts) lines.push("  " + c.a + " - " + c.b + ": " + pts(c.diff) + " points [" + pts(c.lo) + ", " + pts(c.hi) + "] on " + c.pairs + " paired tasks (" + c.a_only + " vs " + c.b_only + " discordant)");
    lines.push("  reading: " + r.text);
    lines.push("  reading as merged, before D1: " + out[m].as_merged.reading.text);
  }
  return { lines, models: out as Partial<Record<ModelKey, ModelReport & { as_merged: ModelReport }>> };
}
