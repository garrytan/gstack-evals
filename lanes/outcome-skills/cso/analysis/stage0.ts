// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 12's stage 0 readout, each counted arm's R111 pilot. An arm passes on a model when, on every stage 0
// unit, its install verified (a cso-arm.v1 record for that arm's home), its entry resolved (for cso, section 8's
// exposure shows the skill loaded and the helper procedure ran), its report landed in assistant text, the session ended
// scored with no infra gap, and, for cso, every snapshot or handle citation resolved (section 5's stage 0 citation gate).
// Each failure is named. A cso session whose helper run started in any mode or scope but daily with default scope fails
// with its own reason.
import type { CsoPrereg } from "../prereg.ts";
import type { CsoArm, CsoModel, SessionRecord } from "../types.ts";
import type { CsoArmRecord } from "../arms.ts";
import { CSO_HOME } from "../arms.ts";
import { armRuns } from "../sessions.ts";
import { citationGate, type TreeIndex } from "../score/checks.ts";
import type { CsoScore } from "../score/outcomes.ts";

export interface Stage0Input { units: string[]; sessions: SessionRecord[]; scores: CsoScore[]; arms: Partial<Record<CsoArm, CsoArmRecord>>; trees: Record<string, TreeIndex> }
export interface Stage0Cell { model: CsoModel; arm: CsoArm; pass: boolean; reasons: { unit: string | null; reason: string }[] }

const ARMS: CsoArm[] = ["none", "cso", "untold"];
const MODELS: CsoModel[] = ["opus", "particle"];

/** Pass or fail per arm and model that runs in stage 0, with every reason it failed. */
export function stage0Readout(i: Stage0Input, p: CsoPrereg): Stage0Cell[] {
  const out: Stage0Cell[] = [];
  for (const model of MODELS) for (const arm of ARMS) {
    if (!armRuns(arm, model, "stage0", p)) continue;
    const reasons: Stage0Cell["reasons"] = [];
    const rec = i.arms[arm];
    if (!rec || rec.schema !== "cso-arm.v1" || rec.arm !== arm || rec.home !== CSO_HOME[arm]) reasons.push({ unit: null, reason: "install not verified: no cso-arm.v1 record for the " + arm + " arm's " + CSO_HOME[arm] + " home" });
    for (const unit of i.units) {
      const s = i.sessions.find((x) => x.stage === "stage0" && x.unit === unit && x.arm === arm && x.model === model);
      if (!s) {
        reasons.push({ unit, reason: "no session" });
        continue;
      }
      if (arm === "cso" && !s.exposure.loaded) reasons.push({ unit, reason: "entry not resolved: the cso skill did not load" });
      if (arm === "cso" && !s.exposure.procedure_ran) reasons.push({ unit, reason: "entry not resolved: the helper procedure did not run" });
      if (arm === "cso" && s.exposure.scope !== null && s.exposure.scope !== "daily/default") reasons.push({ unit, reason: "not the default run: the helper started " + s.exposure.scope + ", not daily/default" });
      if (!s.texts.some((t) => t.trim())) reasons.push({ unit, reason: "no report in assistant text" });
      if (s.end === "gap") reasons.push({ unit, reason: "infra gap: " + (s.reason ?? "session gap") });
      const sc = i.scores.find((x) => x.stage === "stage0" && x.unit === unit && x.arm === arm && x.model === model);
      if (s.end !== "gap" && (!sc || sc.gap !== null)) reasons.push({ unit, reason: "not scored" + (sc?.gap ? ": " + sc.gap + " gap" + (sc.gap_reason ? " (" + sc.gap_reason + ")" : "") : "") });
      if (arm === "cso") {
        const tree = i.trees[unit];
        if (!tree) reasons.push({ unit, reason: "citation gate not run: no audited tree" });
        else for (const u of citationGate(s, tree).unresolved) reasons.push({ unit, reason: "citation gate: " + u.handle + " (" + u.reason + ")" });
      }
    }
    out.push({ model, arm, pass: reasons.length === 0, reasons });
  }
  return out;
}
