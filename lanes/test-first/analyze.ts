// Copyright (c) 2026 Garry Tan. MIT License.
// B2's reading (preregistration sections 8, 9 and the decision table) from the session table. Per model: each arm's counts
// of passes, passes with a regression test and followed (section 6.3) over graded sessions with Wilson 95% intervals, and the
// paired contrasts on tasks graded in both arms with Newcombe's method 10 (B1's analyze.ts, pinned to Altman's worked
// example). Pooled: the contrast over every complete model's (model, task) pairs with the cluster-robust variance by
// repository of section 9.2, z against the group-sequential bounds (2.917 at the look, 2.068 at the end) for passes and 2.576
// for passes with a regression test. The procedure gate (section 6.3), INCOMPLETE (section 8), the decision table read in
// order, the delivery-form contrast, and section 6.4's descriptive lines. The interim look (section 11) prints only its z,
// its bound and its decision. The pilot report prints a PASS or FAIL line per arm and model by section 12's criteria.
import { newcombe, wilson } from "../delivery-route/analyze.ts";
import { ARM_KEYS, B2, BOUNDS, GATE, LABELS, labelOf, MODEL_KEYS, MODELS, PILOT_ARM_CAPS_USD, SOL_EFFORT, type Arm, type ModelKey } from "./pins.ts";
import type { B2Row } from "./table.ts";

export { newcombe, wilson };
export type Outcome = "pass" | "regression" | "followed";
export const OUTCOMES: Outcome[] = ["pass", "regression", "followed"];
/** Each outcome on a graded row: passes, passes with a regression test, and followed under section 6.3's rule. A Codex
 *  session with unreadable rollout items, or any session with a write no parser can name, is scored both ways: low reads it not
 *  followed, high followed. */
export const outcomeOf = (o: Outcome, r: B2Row, way: "primary" | "low" | "high" = "primary"): boolean => {
  if (o === "pass") return r.pass;
  if (o === "regression") return r.regression_test;
  const both = (r.unreadable_items ?? 0) > 0 || (r.detect?.unresolved_writes ?? 0) > 0;
  return way === "low" ? !!r.followed_b2 && !both : way === "high" ? !!r.followed_b2 || both : !!r.followed_b2;
};
// Section 9.1's per-model contrasts, each first minus second.
export const CONTRASTS: [Arm, Arm][] = [["prove-it", "gstack"], ["prove-it", "none"], ["prove-it", "line"], ["gstack", "none"], ["line", "none"]];
// Sections 9.3 and 11 of the plan as merged on main (3e02b099): when the run stops at the look, passes with a regression test
// are descriptive and take no part in the decision; otherwise they are read at the end, on all 183 tasks, at |z| of at least 2.576.
export const REGRESSION_AFTER_STOP = "descriptive" as const;

const graded = (rows: B2Row[]) => rows.filter((r) => r.outcome === "graded");
const pct = (x: number | null) => (x === null ? "n/a" : (100 * x).toFixed(1) + "%");
const pts = (x: number) => (x >= 0 ? "+" : "") + (100 * x).toFixed(1);
const num = (x: number | null, d = 3) => (x === null || !Number.isFinite(x) ? String(x) : x.toFixed(d));

/** Rows the report must not read: a task outside the scope, and more than one graded row for a model, arm and task. */
export function checkRows(rows: B2Row[], scope: string[]): string[] {
  const run = new Set(scope), seen = new Map<string, number>(), bad: string[] = [];
  for (const r of rows) {
    if (!run.has(r.task)) bad.push(r.trial + ": task " + r.task + " is not one of the " + run.size + " tasks read");
    if (!LABELS.includes(r.label)) bad.push(r.trial + ": arm " + r.label + " is not one of B2's");
    if (r.outcome === "graded") { const k = r.model + " " + r.label + " " + r.task; seen.set(k, (seen.get(k) ?? 0) + 1); }
  }
  for (const [k, n] of seen) if (n > 1) bad.push(k + " has " + n + " graded rows, not 1");
  return bad;
}

/** The rows of one model: by the session's own model record, falling back to the planned model for a session that is not
 *  graded and left none. */
export const modelRows = (rows: B2Row[], m: ModelKey) => rows.filter((r) => (r.model ?? "") === MODELS[m].id || (r.model === null && r.outcome !== "graded" && r.planned_model === MODELS[m].id));
const armRows = (rows: B2Row[], a: Arm) => rows.filter((r) => r.arm === a);

export type ArmCount = { arm: Arm; planned: number; graded: number; gaps: number; cap_stops: number; counts: Record<Outcome, number>; ci: Record<Outcome, [number, number] | null>; followed_low: number; followed_high: number };
export function armCount(rows: B2Row[], a: Arm, planned: number): ArmCount {
  const all = armRows(rows, a), g = graded(all);
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, g.filter((r) => outcomeOf(o, r)).length])) as Record<Outcome, number>;
  return {
    arm: a, planned, graded: g.length, gaps: planned - new Set(g.map((r) => r.task)).size, cap_stops: all.filter((r) => r.outcome === "cap_stop").length, counts,
    ci: Object.fromEntries(OUTCOMES.map((o) => [o, g.length ? wilson(counts[o], g.length) : null])) as Record<Outcome, [number, number] | null>,
    followed_low: g.filter((r) => outcomeOf("followed", r, "low")).length, followed_high: g.filter((r) => outcomeOf("followed", r, "high")).length,
  };
}
/** Section 8: a model is INCOMPLETE when any arm has more than 10% of its tasks not graded, or its item hit a cap stop. */
export function incompleteWhy(rows: B2Row[], planned: number): string[] {
  const why: string[] = [];
  const capped = rows.filter((r) => r.outcome === "cap_stop").length;
  if (capped) why.push("its item stopped at its cap (" + capped + " cap stop sessions)");
  for (const a of ARM_KEYS) { const c = armCount(rows, a, planned); if (c.gaps > Math.floor(planned * B2.gapMax + 1e-9)) why.push(a + " has " + c.gaps + " of " + planned + " tasks not graded"); }
  return why;
}

export type Paired = { a: Arm; b: Arm; outcome: Outcome; pairs: number; both: number; a_only: number; b_only: number; neither: number; diff: number; lo: number; hi: number };
/** A per-model paired contrast on the tasks graded in both arms, with Newcombe's method 10. */
export function paired(rows: B2Row[], a: Arm, b: Arm, o: Outcome): Paired {
  const by = (x: Arm) => new Map(graded(armRows(rows, x)).map((r) => [r.task, outcomeOf(o, r)]));
  const A = by(a), B = by(b);
  let both = 0, aOnly = 0, bOnly = 0, neither = 0;
  for (const [t, x] of A) { if (!B.has(t)) continue; const y = B.get(t)!; if (x && y) both++; else if (x) aOnly++; else if (y) bOnly++; else neither++; }
  return { a, b, outcome: o, pairs: both + aOnly + bOnly + neither, both, a_only: aOnly, b_only: bOnly, neither, ...newcombe(both, aOnly, bOnly, neither) };
}

/** Section 9.2: d = A's outcome minus B's for each (model, task) graded in both arms; D their mean; V = G/(G-1) times the sum
 *  over repositories g of (s_g - n_g D)^2, over N^2; z = D / sqrt(V); the 95% interval D plus or minus 1.96 sqrt(V). */
export type Pooled = { a: Arm; b: Arm; outcome: Outcome; models: ModelKey[]; n: number; g: number; d: number; v: number | null; z: number | null; lo: number | null; hi: number | null };
export function clusterContrast(pairs: { cluster: string; d: number }[]): { n: number; g: number; d: number; v: number | null; z: number | null; lo: number | null; hi: number | null } {
  const n = pairs.length;
  if (!n) return { n: 0, g: 0, d: 0, v: null, z: null, lo: null, hi: null };
  const d = pairs.reduce((x, p) => x + p.d, 0) / n;
  const groups = new Map<string, { s: number; n: number }>();
  for (const p of pairs) { const x = groups.get(p.cluster) ?? { s: 0, n: 0 }; x.s += p.d; x.n++; groups.set(p.cluster, x); }
  const g = groups.size;
  if (g < 2) return { n, g, d, v: null, z: null, lo: null, hi: null };
  const v = (g / (g - 1)) * [...groups.values()].reduce((x, c) => x + (c.s - c.n * d) ** 2, 0) / (n * n);
  const se = Math.sqrt(v);
  const z = se > 0 ? d / se : d === 0 ? 0 : Math.sign(d) * Infinity;
  return { n, g, d, v, z, lo: d - BOUNDS.z95 * se, hi: d + BOUNDS.z95 * se };
}
export function pooled(rows: B2Row[], models: ModelKey[], a: Arm, b: Arm, o: Outcome): Pooled {
  const pairs: { cluster: string; d: number }[] = [];
  for (const m of models) {
    const mine = modelRows(rows, m);
    const by = (x: Arm) => new Map(graded(armRows(mine, x)).map((r) => [r.task, r]));
    const A = by(a), B = by(b);
    for (const [t, x] of A) { const y = B.get(t); if (y) pairs.push({ cluster: x.repo ?? t, d: Number(outcomeOf(o, x)) - Number(outcomeOf(o, y)) }); }
  }
  return { a, b, outcome: o, models, ...clusterContrast(pairs) };
}

/** Section 6.3's procedure gate: pooled over the models read, prove-it's followed rate at least 20 points above the gstack
 *  arm's, and on Opus 5.5 prove-it's followed rate at least 50%. */
export function procedureGate(rows: B2Row[], models: ModelKey[]) {
  const rate = (rs: B2Row[]) => { const g = graded(rs); return g.length ? g.filter((r) => outcomeOf("followed", r)).length / g.length : null; };
  const all = models.flatMap((m) => modelRows(rows, m));
  const p = rate(armRows(all, "prove-it")), g = rate(armRows(all, "gstack")), opus = rate(armRows(modelRows(rows, "opus"), "prove-it"));
  const gap = p !== null && g !== null ? p - g : null;
  const pass = gap !== null && gap >= GATE.pooledPoints - 1e-9 && opus !== null && opus >= GATE.opusRate - 1e-9;
  return { pass, prove_it: p, gstack: g, gap, opus, perModel: MODEL_KEYS.map((m) => ({ m, prove_it: rate(armRows(modelRows(rows, m), "prove-it")), gstack: rate(armRows(modelRows(rows, m), "gstack")) })) };
}

export type Stage = "end" | "look";
export type Decision = { key: "incomplete" | "gate" | "captain" | "cut" | "keep-strengthen" | "keep" | "null"; text: string };
export type Reading = {
  stage: Stage; planned: number; complete: ModelKey[]; incomplete: Partial<Record<ModelKey, string[]>>; gate: ReturnType<typeof procedureGate> | null;
  passes: Pooled | null; regression: Pooled | null; delivery: Pooled | null; bound: number; regressionRead: boolean; decision: Decision; beside: Pooled[];
};
/** The decision table, the first row that applies. stage end reads all 183 tasks at 2.068; stage look reads the look's units
 *  after the run stopped there, at 2.917, with passes with a regression test descriptive (REGRESSION_AFTER_STOP). */
export function reading(rows: B2Row[], stage: Stage, planned: number): Reading {
  const incomplete: Partial<Record<ModelKey, string[]>> = {};
  for (const m of MODEL_KEYS) { const w = incompleteWhy(modelRows(rows, m), planned); if (w.length) incomplete[m] = w; }
  const complete = MODEL_KEYS.filter((m) => !incomplete[m]);
  const bound = stage === "look" ? BOUNDS.look : BOUNDS.end, regressionRead = stage === "end" || REGRESSION_AFTER_STOP !== "descriptive";
  const base = { stage, planned, complete, incomplete, bound, regressionRead };
  if (incomplete.opus || incomplete.sol) {
    return { ...base, gate: null, passes: null, regression: null, delivery: null, beside: [], decision: { key: "incomplete", text: "INCOMPLETE: " + (["opus", "sol"] as ModelKey[]).filter((m) => incomplete[m]).map((m) => MODELS[m].id + " " + incomplete[m]!.join("; ")).join("; ") + ". No reading; gstack changes nothing, and the result goes to the Captain with what is missing." } };
  }
  const gate = procedureGate(rows, complete);
  const passes = pooled(rows, complete, "prove-it", "gstack", "pass"), regression = pooled(rows, complete, "prove-it", "gstack", "regression");
  const beside = ([["prove-it", "none"], ["gstack", "none"], ["line", "none"]] as [Arm, Arm][]).map(([a, b]) => pooled(rows, complete, a, b, "pass"));
  const p1 = incomplete.p1 ? " (particle-1 left out: " + incomplete.p1.join("; ") + ")" : "";
  const out = { ...base, gate, passes, regression, beside, delivery: null as Pooled | null };
  if (!gate.pass) return { ...out, decision: { key: "gate", text: "The procedure gate fails (prove-it minus gstack followed " + (gate.gap === null ? "n/a" : pts(gate.gap)) + " points pooled, Opus prove-it " + pct(gate.opus) + "): the procedure didn't reach the sessions. No reading on outcomes. FIX-METHOD on exposure; gstack changes nothing." + p1 } };
  const z = passes.z ?? 0, rz = regression.z ?? 0, rb = BOUNDS.regression, regressionBelow = regressionRead && rz <= -rb;
  if (z >= bound && regressionBelow) return { ...out, decision: { key: "captain", text: "Passes above 0 (z " + num(passes.z) + " >= " + bound + ") while passes with a regression test are below 0 (z " + num(regression.z) + " <= -" + rb + "). The table makes no reading: the result goes to the Captain with both contrasts." + p1 } };
  if (z <= -bound || regressionBelow) return { ...out, decision: { key: "cut", text: "Test-first costs fixes (passes z " + num(passes.z) + ", passes with a regression test z " + num(regression.z) + "). CUT-CANDIDATE: gstack drops the routing hook's bug-report rule and the \"focused failing test first\" clause of its CLAUDE.md bug line." + p1 } };
  if (z >= bound) {
    const delivery = pooled(rows, complete, "prove-it", "line", "pass");
    const skill = delivery.lo !== null && delivery.lo > 0;
    const below = (["opus", "sol"] as ModelKey[]).filter((m) => paired(modelRows(rows, m), "prove-it", "gstack", "pass").hi < 0).map((m) => MODELS[m].id);
    return { ...out, delivery, decision: { key: "keep-strengthen", text: "Test-first fixes more bugs (passes z " + num(passes.z) + " >= " + bound + "). KEEP and strengthen: gstack ships its own prove-it skill and keeps routing bug reports to it; " + (skill ? "prove-it minus the line on passes is above 0 (" + pts(delivery.d) + " [" + pts(delivery.lo!) + ", " + pts(delivery.hi!) + "]), so the procedure ships as that skill." : "prove-it minus the line on passes is not above 0, so gstack ships the one line in its CLAUDE.md block and Codex AGENTS.md text in place of its bug line, and no new skill.") + (below.length ? " " + below.join(" and ") + "'s own passes interval lies wholly below 0." : "") + p1 } };
  }
  if (regressionRead && rz >= rb) return { ...out, decision: { key: "keep", text: "Passes not shown either way (z " + num(passes.z) + "), passes with a regression test above 0 (z " + num(regression.z) + " >= " + rb + "). KEEP as it is: the routing rule and the bug line stay, gstack doesn't ship its own skill, and its docs claim tests, not fixes." + p1 } };
  return { ...out, decision: { key: "null", text: "Neither shown (passes z " + num(passes.z) + ", passes with a regression test z " + num(regression.z) + (regressionRead ? "" : ", descriptive after the stop") + "). A null: one Why null? cycle (below), then CUT-CANDIDATE for the routing rule and the bug line's clause, unless the cycle finds an exposure, task-fit or power cause (FIX-METHOD), or a ceiling (FIX-METHOD once, with one attempt to raise it)." + p1 } };
}

/** Section 11: the interim look on the first 92 tasks of every model, pooled passes, prove-it minus gstack. It prints only z,
 *  the bound and the decision. With Opus or Sol INCOMPLETE on the look's units there is no pooled z, and the run goes on. */
export function look(rows: B2Row[]): { z: number | null; bound: number; decision: "continue" | "stop"; line: string } {
  const r = reading(rows, "look", B2.half);
  const z = r.decision.key === "incomplete" ? null : r.passes?.z ?? null;
  const decision = z !== null && Math.abs(z) >= BOUNDS.look ? "stop" : "continue";
  return { z, bound: BOUNDS.look, decision, line: "B2_LOOK z=" + (z === null ? "none" : z.toFixed(3)) + " bound=" + BOUNDS.look + " decision=" + decision };
}

const mean = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
/** Section 6.4's descriptive line for one model and arm. */
export function descriptive(rows: B2Row[], a: Arm, planned: number): string {
  const all = armRows(rows, a), g = graded(all), n = (f: (r: B2Row) => boolean) => all.filter(f).length;
  const c = armCount(rows, a, planned);
  return a + ": steps seen " + n((r) => r.steps_seen === true) + ", line seen " + n((r) => r.line_seen) + ", prove-it loaded " + n((r) => r.prove_it_loads > 0) + ", a gstack skill loaded " + n((r) => r.gstack_loads.length > 0) +
    ", hook named something " + n((r) => !!r.routing_named?.length) + " (no hook log " + n((r) => r.routing_named === null) + "), start step seen " + n((r) => r.start_seen) + ", questions " + all.reduce((x, r) => x + r.questions, 0) +
    "; mean cost $" + num(mean(all.map((r) => r.cost_usd)), 2) + ", mean tokens " + num(mean(all.map((r) => r.tokens)), 0) + ", mean wall " + num(mean(all.map((r) => r.wall_s)), 0) + " s" +
    "; allowance stops " + n((r) => r.allowance_stop) + ", turn-limit stops " + n((r) => r.turn_cap) + ", time stops " + n((r) => r.time_stop) + ", safety stops " + n((r) => r.safety_stop) +
    "; writes no parser can name in " + g.filter((r) => (r.detect?.unresolved_writes ?? 0) > 0).length + " sessions, unreadable Codex items in " + g.filter((r) => (r.unreadable_items ?? 0) > 0).length + " (followed " + c.followed_low + " to " + c.followed_high + " of " + c.graded + " scored both ways)" +
    "; touches a test file " + n((r) => r.touches_test) + ", regression test only at the root " + g.filter((r) => r.regression_test && r.root_only).length + "; followed under B1's rule " + g.filter((r) => r.followed).length + ", as merged " + g.filter((r) => r.followed_as_merged).length +
    (all.some((r) => r.audit !== null) ? "; read audit: " + n((r) => (r.audit ?? 0) > 0) + " sessions read a gstack path, a skill or a drive" : "");
}

/** The full report on the table: per model counts and contrasts, the pooled reading, the decision and section 9.4's numbers. */
export function report(rows: B2Row[], stage: Stage = "end", planned: number = stage === "end" ? B2.tasks : B2.half) {
  const lines: string[] = [];
  const r = reading(rows, stage, planned);
  lines.push("== B2 reading at the " + stage + " on " + planned + " tasks a model; models read: " + (r.complete.map((m) => MODELS[m].id).join(", ") || "none"));
  for (const m of MODEL_KEYS) {
    const mine = modelRows(rows, m);
    if (!mine.length) continue;
    lines.push("== " + MODELS[m].id + (r.incomplete[m] ? " INCOMPLETE: " + r.incomplete[m]!.join("; ") : ""));
    for (const a of ARM_KEYS) {
      const c = armCount(mine, a, planned);
      lines.push("  " + a + ": graded " + c.graded + "/" + planned + " (gaps " + c.gaps + ", cap stops " + c.cap_stops + "); " + OUTCOMES.map((o) => o + " " + c.counts[o] + " " + pct(c.graded ? c.counts[o] / c.graded : null) + (c.ci[o] ? " [" + pct(c.ci[o]![0]) + ", " + pct(c.ci[o]![1]) + "]" : "")).join("; "));
    }
    for (const [a, b] of CONTRASTS) for (const o of OUTCOMES) { const p = paired(mine, a, b, o); lines.push("  " + a + " - " + b + " " + o + ": " + pts(p.diff) + " points [" + pts(p.lo) + ", " + pts(p.hi) + "] on " + p.pairs + " paired tasks (" + p.a_only + " vs " + p.b_only + " discordant)"); }
    for (const a of ARM_KEYS) lines.push("  " + descriptive(mine, a, planned));
  }
  const show = (p: Pooled | null, what: string) => (p ? "  " + what + " " + p.a + " - " + p.b + " " + p.outcome + ": " + pts(p.d) + " points" + (p.lo === null ? "" : " [" + pts(p.lo) + ", " + pts(p.hi!) + "]") + ", z " + num(p.z) + " on " + p.n + " pairs in " + p.g + " repositories" : "  " + what + ": not read");
  if (r.gate) lines.push("  procedure gate " + (r.gate.pass ? "PASS" : "FAIL") + ": followed pooled prove-it " + pct(r.gate.prove_it) + ", gstack " + pct(r.gate.gstack) + ", gap " + (r.gate.gap === null ? "n/a" : pts(r.gate.gap)) + " points (needs +" + 100 * GATE.pooledPoints + "); Opus prove-it " + pct(r.gate.opus) + " (needs " + 100 * GATE.opusRate + "%); " + r.gate.perModel.map((x) => MODELS[x.m].id + " " + pct(x.prove_it) + " vs " + pct(x.gstack)).join(", "));
  lines.push(show(r.passes, "pooled primary (bound " + r.bound + ")"));
  lines.push(show(r.regression, "pooled co-primary (bound " + BOUNDS.regression + (r.regressionRead ? "" : ", descriptive after a stop at the look") + ")"));
  if (r.delivery) lines.push(show(r.delivery, "delivery form (95%, uncorrected)"));
  for (const p of r.beside) lines.push(show(p, "beside (descriptive)"));
  lines.push("  decision: " + r.decision.text);
  if (r.decision.key === "null") {
    const g = r.gate!;
    lines.push("  why null? exposure: the gate above, steps seen per model in the descriptive lines; task fit: the corrections post's bug-report check, and passes split by whether none passed: " + whyNullSplit(rows, r.complete).join("; "));
    lines.push("  why null? power: realized discordance on passes " + r.complete.map((m) => { const p = paired(modelRows(rows, m), "prove-it", "gstack", "pass"); return MODELS[m].id + " " + pct(p.pairs ? (p.a_only + p.b_only) / p.pairs : null); }).join(", ") + "; floor and ceiling: none's pass rate " + r.complete.map((m) => MODELS[m].id + " " + pct(rate(modelRows(rows, m), "none", "pass"))).join(", ") + "; unaided: followed in none and gstack " + r.complete.map((m) => MODELS[m].id + " " + pct(rate(modelRows(rows, m), "none", "followed")) + " and " + pct(rate(modelRows(rows, m), "gstack", "followed"))).join(", ") + "; gate gap " + (g.gap === null ? "n/a" : pts(g.gap)));
  }
  return { lines, reading: r };
}
const rate = (rows: B2Row[], a: Arm, o: Outcome) => { const g = graded(armRows(rows, a)); return g.length ? g.filter((r) => outcomeOf(o, r)).length / g.length : null; };
function whyNullSplit(rows: B2Row[], models: ModelKey[]): string[] {
  return models.map((m) => {
    const mine = modelRows(rows, m), none = new Map(graded(armRows(mine, "none")).map((r) => [r.task, r.pass]));
    const split = (want: boolean) => paired(mine.filter((r) => none.get(r.task) === want), "prove-it", "gstack", "pass");
    const a = split(true), b = split(false);
    return MODELS[m].id + ": where none passed " + pts(a.diff) + " on " + a.pairs + ", where none failed " + pts(b.diff) + " on " + b.pairs;
  });
}

/** Section 12's pilot report: a PASS or FAIL line per arm and model. A part ran when the arm's own evidence holds in every
 *  session; the tasks can be supplied when every pilot cell graded. armTree says, per arm label, what the committed manifest
 *  shows (no gstack file and no ~/.gstack for none and line, telemetry off for the gstack arms). */
export function pilotReport(rows: B2Row[], pilot: readonly string[], armTree: (label: string) => string[]): { lines: string[]; failed: string[] } {
  const lines: string[] = [], failed: string[] = [];
  for (const m of MODEL_KEYS) {
    const host = MODELS[m].host, mine = modelRows(rows, m);
    const noneListed = new Set(armRows(mine, "none").flatMap((r) => r.skills_listed));
    for (const a of ARM_KEYS) {
      const label = labelOf(host, a), all = armRows(mine, a), g = graded(all), why: string[] = [...armTree(label)];
      const every = (f: (r: B2Row) => boolean, what: string) => { const bad = all.filter((r) => !f(r)); if (!all.length || bad.length) why.push(what + (all.length ? " (" + bad.length + " of " + all.length + " sessions not)" : " (no session)")); };
      if (m === "sol") every((r) => !!r.metered_effort?.length && r.metered_effort.every((e) => e === SOL_EFFORT), "every metered request at effort " + SOL_EFFORT);
      const missing = pilot.filter((t) => !g.some((r) => r.task === t));
      if (missing.length) why.push("supply: not graded on " + missing.join(", "));
      if (a === "none" || a === "line") {
        every((r) => r.steps_seen !== true, "no step text");
        every((r) => (r.audit ?? 0) === 0, "no gstack read in the audit");
        if (a === "none") every((r) => r.skills_listed.every((s) => ["plugin-authoring", "doctor"].includes(s)), "no skill listed but the host's own");
        if (a === "line") { every((r) => r.line_seen, "the line arrives in the session's start"); every((r) => r.skills_listed.every((s) => noneListed.has(s)), "no skill listed beyond none's"); }
      }
      if (a === "gstack" || a === "prove-it") {
        every((r) => r.skills_listed.length > noneListed.size + 5, "gstack's skill listing reached the model");
        every((r) => r.routing_named !== null, "gstack's routing hook logged an event on the prompt");
        every((r) => r.gstack_loads.length === 0 || r.start_seen, "the start step of any gstack skill that loaded is seen");
      }
      if (a === "prove-it") {
        every((r) => r.steps_seen === true, "the step text arrived");
        if (g.some((r) => r.followed_b2 === null)) why.push("the followed detector read no reading on " + g.filter((r) => r.followed_b2 === null).length + " graded sessions");
        if (!g.some((r) => r.followed_b2 === true)) why.push("no session reads as followed");
        if (!all.some((r) => r.prove_it_loads > 0 || r.start_seen)) why.push("prove-it's own load is not seen (no load and no start step)");
      }
      const spent = all.reduce((x, r) => x + (r.cost_usd ?? 0), 0);
      const line = (why.length ? "FAIL" : "PASS") + " " + a + " on " + MODELS[m].id + ": " + all.length + " sessions, " + g.length + " graded, $" + spent.toFixed(2) + " of the arm's $" + PILOT_ARM_CAPS_USD[a] + " pilot cap across models" + (why.length ? "; " + why.join("; ") : "");
      lines.push(line);
      if (why.length) failed.push(a + " " + MODELS[m].id);
    }
  }
  return { lines, failed };
}
