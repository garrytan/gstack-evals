// Copyright (c) 2026 Garry Tan. MIT License.
// GEVA-583 rerun prereg sections 4 to 6: the before-and-after analysis. The new cso arm's sessions and scores are read as
// stage 2's cso cells and joined with the parent's stage 2 records: against its none arm for the primary family (the
// parent's section 10 rows and verdicts, unchanged), and against its old cso arm, relabelled as the baseline, for the
// second family (rows only; it never decides the verdict). The old arm's exposure is the fixed detector replayed over its
// transcripts, keyed by unit and model. Yield is descriptive. printCheck is the pilot's print check: every frozen
// secondary prints a value, or "no pair in the pilot" where the records in hand can't pair it.
import type { CsoPrereg } from "../prereg.ts";
import type { CsoModel, SessionRecord, UnitRecord } from "../types.ts";
import type { CsoScore, Judged, Miss } from "../score/outcomes.ts";
import type { TreeIndex } from "../score/checks.ts";
import { missMap, secondaries, type Diff } from "./secondaries.ts";
import { analyze, PRIMARY_MODELS, rows, type AnalysisInput } from "./verdicts.ts";

export const NO_PAIR = "no pair in the pilot";
/** The miss anatomy's names in the rerun's output: the outside-first-10 bucket is a location match (#443's ruled note). */
export const MISS_LABEL: Record<Miss, string> = {
  safety_stop: "safety stop", limit_tooling_or_not_assessed: "limit, tooling error or not assessed", never_opened_fix_file: "never opened a fix file",
  opened_not_named: "opened a fix file, text doesn't name it", other_flaw_or_class: "named the file with another flaw or class",
  outside_first_k: "a fix-file location outside the first 10 (location match, not labelled)", unclassified: "unclassified",
};

export interface RerunArm { sessions: SessionRecord[]; scores: CsoScore[] }
/** The miss anatomy's inputs: the new arm's judged rows by unit and model, the parent's by unit, arm and model, and the audited trees. */
export interface RerunMissInput { fresh: (unit: string, model: CsoModel) => Judged | null; parent: (unit: string, arm: "none" | "cso", model: CsoModel) => Judged | null; tree: (unit: string) => TreeIndex }
export interface RerunInput {
  units: UnitRecord[];
  /** The parent's records, one stage each (stage 2 for the counted run, stage 0 for the pilot), read as stage 2: its none arm and its old cso arm. */
  none: RerunArm; old: RerunArm;
  /** The new cso arm, any stage; read as stage 2's cso cells. */
  fresh: RerunArm;
  /** The old cso arm's procedure flag from the fixed detector's replay, keyed "unit model". */
  oldProcedure: Record<string, boolean>;
  /** The helper's saved run records per new session, keyed "unit model": runs and the findings they hold. */
  runRecords: Record<string, { runs: number; findings: number }>;
  judge: AnalysisInput["judge"];
  headroom_admitted: boolean;
  /** Without it the miss anatomy prints empty (the pilot's print check). */
  miss?: RerunMissInput;
}

const k = (x: { unit: string; model: string }) => x.unit + " " + x.model;
const stage2 = <T extends { stage: string }>(x: T): T => ({ ...x, stage: "stage2" });
const baseline = <T extends { arm: string }>(x: T): T => ({ ...x, arm: "none" });
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function rerunAnalysis(i: RerunInput, p: CsoPrereg) {
  const ids = new Set(i.units.map((u) => u.unit));
  const pick = <T extends { unit: string; arm: string; stage: string }>(xs: T[], arm: string) => xs.filter((x) => ids.has(x.unit) && x.arm === arm).map(stage2);
  const fresh = { sessions: i.fresh.sessions.filter((s) => ids.has(s.unit) && s.arm === "cso").map(stage2), scores: i.fresh.scores.filter((s) => ids.has(s.unit) && s.arm === "cso").map(stage2) };
  const primary: AnalysisInput = { units: i.units, sessions: [...pick(i.none.sessions, "none"), ...fresh.sessions], scores: [...pick(i.none.scores, "none"), ...fresh.scores], judge: i.judge, headroom_admitted: i.headroom_admitted };
  const second: AnalysisInput = { units: i.units, sessions: [...pick(i.old.sessions, "cso").map(baseline), ...fresh.sessions], scores: [...pick(i.old.scores, "cso").map(baseline), ...fresh.scores], judge: i.judge, headroom_admitted: i.headroom_admitted };
  const reused: AnalysisInput = { units: i.units, sessions: [...pick(i.none.sessions, "none"), ...pick(i.old.sessions, "cso")], scores: [...pick(i.none.scores, "none"), ...pick(i.old.scores, "cso")], judge: i.judge, headroom_admitted: i.headroom_admitted };
  const scored = (xs: CsoScore[], m: CsoModel) => xs.filter((s) => s.model === m && s.gap === null && s.findings_total !== null);
  const yieldOf = (m: CsoModel) => {
    const cells = { new_cso: scored(fresh.scores, m), none: scored(pick(i.none.scores, "none"), m), old_cso: scored(pick(i.old.scores, "cso"), m) };
    const ran = new Set(fresh.sessions.filter((s) => s.model === m && s.exposure.procedure_ran).map(k));
    const recs = fresh.sessions.filter((s) => s.model === m).map((s) => i.runRecords[k(s)]).filter((r): r is { runs: number; findings: number } => !!r);
    const runs = recs.reduce((a, r) => a + r.runs, 0);
    return {
      model: m,
      findings_per_session: Object.fromEntries(Object.entries(cells).map(([a, c]) => [a, mean(c.map((s) => s.findings_total!))])),
      no_finding_share: Object.fromEntries(Object.entries(cells).map(([a, c]) => [a, c.length ? c.filter((s) => s.findings_total === 0).length / c.length : null])),
      findings_per_session_procedure_ran: mean(cells.new_cso.filter((s) => ran.has(k(s))).map((s) => s.findings_total!)),
      helper_findings_per_run: runs ? recs.reduce((a, r) => a + r.findings, 0) / runs : null,
      helper_runs: runs,
    };
  };
  const exposure = (m: CsoModel) => {
    const n = fresh.sessions.filter((s) => s.model === m && s.end !== "gap");
    const old = pick(i.old.sessions, "cso").filter((s) => s.model === m && s.end !== "gap");
    return { model: m, new_loaded: n.filter((s) => s.exposure.loaded).length, new_ran: n.filter((s) => s.exposure.procedure_ran).length, new_of: n.length, old_ran_fixed: old.filter((s) => i.oldProcedure[k(s)] === true).length, old_of: old.length };
  };
  const named = (x: AnalysisInput) => rows(x, p).map((r) => ({ model: r.model, pairs: r.stats.complete.n, baseline_named: Math.round((r.stats.complete.a_rate ?? 0) * r.stats.complete.n), cso_named: Math.round((r.stats.complete.b_rate ?? 0) * r.stats.complete.n) }));
  const misses = (x: AnalysisInput, baseline: "none" | "cso") => (i.miss ? missMap(x, (s) => (s.arm === "cso" ? i.miss!.fresh(s.unit, s.model) : i.miss!.parent(s.unit, baseline, s.model)), i.miss.tree, p) : {});
  const a = analyze(primary, p);
  return {
    schema: "cso-rerun-analysis.v1" as const,
    primary: { rows: a.rows.map(rowOut), verdicts: a.verdicts, split: a.split },
    second: { note: "new cso minus old cso; decides what we tell the maintainer, never the verdict", rows: rows(second, p).map(rowOut) },
    exposure: PRIMARY_MODELS.map(exposure),
    yield: PRIMARY_MODELS.map(yieldOf),
    secondaries: { primary: secondaries(primary, p, misses(primary, "none")), second: secondaries(second, p, misses(second, "cso")) },
    reused_join: named(reused),
    miss_labels: MISS_LABEL,
  };
}
type RowLike = ReturnType<typeof rows>[number];
const rowOut = (r: RowLike) => ({ model: r.model, state: r.state, p_holm: r.p_holm, p_holm_bound: r.p_holm_bound, complete: r.stats.complete, bound: r.stats.bound, complete_only: r.complete_only, mdd_points: r.mdd_points, procedure: r.stats.procedure });

/** The pilot's print check over an analysis: each secondary's paired difference prints a number, or, where nothing pairs,
 *  NO_PAIR; each yield field and exposure count prints. Returns the analysis with NO_PAIR filled in and every miss. */
export function printCheck(a: ReturnType<typeof rerunAnalysis>): { pass: boolean; missing: string[]; out: unknown } {
  const missing: string[] = [];
  const fillDiff = (d: Diff, at: string): Diff | typeof NO_PAIR | Diff => {
    if (d.note) return d;
    if (d.n === 0) return NO_PAIR;
    if (typeof d.delta !== "number" || !Number.isFinite(d.delta)) missing.push(at);
    return d;
  };
  const sec = (fam: "primary" | "second") => a.secondaries[fam].map((s) => ({ ...s, diffs: Object.fromEntries(Object.entries(s.diffs).map(([key, d]) => [key, fillDiff(d, fam + " " + s.model + " " + key)])), strata: Object.fromEntries(Object.entries(s.strata).map(([key, d]) => [key, fillDiff(d, fam + " " + s.model + " stratum " + key)])) }));
  for (const y of a.yield) {
    const fps = y.findings_per_session as Record<string, number | null>;
    if (typeof fps.new_cso !== "number") missing.push("yield " + y.model + " findings per new cso session");
    if (typeof (y.no_finding_share as Record<string, number | null>).new_cso !== "number") missing.push("yield " + y.model + " no-finding share");
    if (y.helper_runs > 0 && typeof y.helper_findings_per_run !== "number") missing.push("yield " + y.model + " helper findings per run");
  }
  for (const e of a.exposure) if (e.new_of === 0) missing.push("exposure " + e.model + ": no new cso session");
  const out = { ...a, secondaries: { primary: sec("primary"), second: sec("second") } };
  return { pass: missing.length === 0, missing, out };
}
