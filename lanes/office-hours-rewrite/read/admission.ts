// Copyright (c) 2026 Garry Tan. MIT License.
// Section 12 stage 4's admission for the office-hours rewrite eval (prereg
// wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg, section 12, with section 13's caps as pre-run change 1
// item 4a records them). A1 at least 6 of 8 sessions exposed in each skill arm and model; A2 a founder median of at
// least 3 founder replies in each skill arm and model; A3 the simulator audit passed; A4 both judge checks passed; A5 the
// current arm's pooled right-call rate on the calibration founder briefs at most 0.75; A6 stage 1's measured cost per
// session keeps stage 2's projection inside its caps; A7 every skill session printed SESSION_KIND: interactive and no
// none-arm session read gstack. A failing condition gets one repair; a second failure ends the eval with FIX-METHOD.
import { ADMISSION, ARMS, CAPS, MODELS, PRIMARY_MODELS, QUOTA } from "../frozen.ts";
import type { ArmId, ModelId, ScoredSession, SessionRow, SkillArm } from "../types.ts";
import { checkRows, METRIC, scoredValue } from "./estimate.ts";
import { le, mean } from "./stats.ts";

const fail = (why: string): never => {
  throw new Error("E_OHR_READ_INPUT " + why);
};

const SKILL_ARMS: readonly SkillArm[] = ["current", "new"];
/** Stage 2 runs every comparison brief once per arm and model: 70 founder and 24 builder briefs. */
export const STAGE2_PER_CELL = QUOTA.founder + QUOTA.builder;

export interface AdmissionInput {
  /** Stage 1's scored sessions on the 8 calibration briefs, every arm and model. */
  rows: readonly ScoredSession[];
  /** Stage 1's run rows, for A7's session kind and none-arm read audit. */
  sessions: readonly SessionRow[];
  /** A3: the simulator audit's outcome. */
  audit: { pass: boolean };
  /** A4: each production judge's check (section 12's judge check). */
  judges: { astra: boolean; opus: boolean };
  /** A6: the label cost per session, measured on stage 1's production labels. */
  label_usd: number;
}

export type AdmissionId = "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7";
export interface Condition {
  id: AdmissionId;
  pass: boolean;
  values: Record<string, unknown>;
}
export interface AdmissionReading {
  pass: boolean;
  failed: AdmissionId[];
  conditions: Condition[];
}

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const round2 = (x: number) => Math.round(x * 100) / 100;

export function admission(x: AdmissionInput): AdmissionReading {
  checkRows(x.rows);
  const cal = x.rows.filter((s) => s.stage === 1 && s.set === "calibration");
  const cellOf = (arm: ArmId, model: ModelId) => cal.filter((s) => s.arm === arm && s.model === model);
  const live = (s: ScoredSession) => s.end !== "missing" && s.end !== "contaminated";

  const a1 = SKILL_ARMS.flatMap((arm) => MODELS.map((model) => {
    const xs = cellOf(arm, model);
    if (xs.length !== QUOTA.calibration) fail("A1 needs the " + QUOTA.calibration + " calibration sessions of " + arm + " on " + model + ", got " + xs.length);
    const exposed = xs.filter((s) => s.exposure?.exposed === true).length;
    return { arm, model, exposed, sessions: xs.length, decides: PRIMARY_MODELS.includes(model), pass: exposed >= ADMISSION.a1_exposed_of_8 };
  }));
  const a2 = SKILL_ARMS.flatMap((arm) => MODELS.map((model) => {
    const xs = cellOf(arm, model).filter((s) => s.kind === "founder" && live(s)).map((s) => s.founder_replies);
    const m = xs.length ? median(xs) : null;
    return { arm, model, sessions: xs.length, median: m, decides: PRIMARY_MODELS.includes(model), pass: m !== null && m >= ADMISSION.a2_median_founder_replies };
  }));
  const a5s = cal.filter((s) => s.arm === "current" && s.kind === "founder" && PRIMARY_MODELS.includes(s.model)).map((s) => scoredValue(s, METRIC.R)).filter((v): v is number => v !== null);
  const rate = a5s.length ? mean(a5s) : null;

  const perCell = ARMS.flatMap((arm) => MODELS.map((model) => {
    const xs = cellOf(arm, model);
    if (!xs.length) fail("A6 has no stage 1 session of " + arm + " on " + model);
    const per = mean(xs.map((s) => s.usd)) + mean(xs.map((s) => s.sim_usd)) + x.label_usd;
    return { arm, model, per_session: per, projection: per * STAGE2_PER_CELL };
  }));
  const item = (models: readonly ModelId[], cap: number) => ({ projection: round2(perCell.filter((c) => models.includes(c.model)).reduce((t, c) => t + c.projection, 0)), cap });
  const item5 = item(PRIMARY_MODELS, CAPS.stage2), item6 = item(["particle"], CAPS.stage2_particle);

  const s1 = x.sessions.filter((s) => s.stage === 1);
  const notInteractive = s1.filter((s) => s.arm !== "none" && s.session_kind !== "interactive" && !(s.session_kind === null && s.end === "missing")).map((s) => s.brief + "|" + s.model + "|" + s.arm);
  const unread = s1.filter((s) => s.arm !== "none" && s.session_kind === null && s.end === "missing").map((s) => s.brief + "|" + s.model + "|" + s.arm);
  const noneReads = s1.filter((s) => s.arm === "none" && (s.gstack_reads.length > 0 || s.end === "contaminated")).map((s) => s.brief + "|" + s.model);

  const conditions: Condition[] = [
    { id: "A1", pass: a1.every((c) => !c.decides || c.pass), values: { need: ADMISSION.a1_exposed_of_8, cells: a1 } },
    { id: "A2", pass: a2.every((c) => !c.decides || c.pass), values: { need: ADMISSION.a2_median_founder_replies, cells: a2 } },
    { id: "A3", pass: x.audit.pass, values: { audit: x.audit.pass } },
    { id: "A4", pass: x.judges.astra && x.judges.opus, values: { ...x.judges } },
    { id: "A5", pass: rate !== null && le(rate, ADMISSION.a5_current_max), values: { rate, right: a5s.filter((v) => v === 1).length, scored: a5s.length, max: ADMISSION.a5_current_max } },
    { id: "A6", pass: le(item5.projection, item5.cap) && le(item6.projection, item6.cap), values: { item5, item6, sessions_per_cell: STAGE2_PER_CELL, label_usd: x.label_usd, cells: perCell } },
    { id: "A7", pass: !notInteractive.length && !noneReads.length, values: { not_interactive: notInteractive, none_reads: noneReads, never_started: unread } },
  ];
  const failed = conditions.filter((c) => !c.pass).map((c) => c.id);
  return { pass: !failed.length, failed, conditions };
}

/** Section 12: the first read, then at most one repaired read. A second failure ends the eval with FIX-METHOD on the instrument. */
export function admissionState(reads: readonly AdmissionReading[]): "admitted" | "repair" | "fix-method" {
  if (!reads.length || reads.length > 2) fail("admission reads once and at most once more after its one repair, got " + reads.length + " reads");
  if (reads[reads.length - 1]!.pass) return "admitted";
  return reads.length === 1 ? "repair" : "fix-method";
}
