// The told prefix on plan units (GEVA-115's spec, GST-849; panel v3's turn 1), so a forced-procedure gstack arm can run
// beside the default gstack arm in one plan run. A gstack stack arm named gstack-<suffix>, other than gstack-auto, runs
// plan arm gstack. Only a gstack plan arm takes a told prefix: one line that opens with the lens's command and plan.md,
// then adds words. Its turn 1 is that line verbatim with nothing appended, and its turn 2 is PLAN_TURN2_TEXT, as for every
// arm. An arm without a prefix gets plan.ts's line byte for byte. A prefix has no edge whitespace or control characters,
// and each refusal names its cause. A gstack-<suffix> arm exists to carry a prefix, so one with no prefix is refused. This
// lives outside plan.ts because plan.ts's own bytes are PLAN_PARSER_SHA256, the plan session key's verifier.
import type { ArmSpec } from "../../types.ts";
import { PLAN_LENSES, planArmLine, planArmOf, type PlanArm, type PlanLens } from "./plan.ts";

/** planArmOf, plus a gstack stack arm named gstack-<suffix> (gstack-auto keeps its own arm), which runs plan arm gstack. */
export const planArmFor = (spec: ArmSpec): PlanArm | null => planArmOf(spec) ?? (/^gstack-[a-z0-9_-]+$/.test(spec.name) && planArmOf({ ...spec, name: "gstack" }) === "gstack" ? "gstack" : null);

const CONTROL_NAMES: Record<string, string> = { "\n": "a line feed", "\r": "a carriage return", "\t": "a tab", "\ufeff": "a byte order mark" };

/** Why a told prefix is not one line of plain text, naming its first control character, or null when it is. */
export function prefixControlProblem(prefix: string): string | null {
  const control = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/.exec(prefix);
  return control ? "the prefix must be one line of plain text, but it has " + (CONTROL_NAMES[control[0]] ?? "a control character") + " (U+" + control[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0") + ") at character " + (control.index + 1) : null;
}

/** Why a plan arm cannot take this told prefix, or null when it can. */
export function planPrefixProblem(arm: PlanArm, lens: PlanLens, prefix: string): string | null {
  const opening = PLAN_LENSES[lens].command + " plan.md";
  if (arm !== "gstack") return "plan arm " + arm + " takes no told prefix; only a gstack plan arm (gstack or gstack-<suffix>) does";
  const control = prefixControlProblem(prefix);
  if (control) return control;
  if (prefix !== prefix.trim()) return "the prefix must not start or end with whitespace; the harness sends it verbatim as turn 1";
  if (prefix !== opening && !prefix.startsWith(opening + " ")) return "the prefix must be one line that opens with " + JSON.stringify(opening);
  if (prefix === opening) return "the prefix adds nothing after " + JSON.stringify(opening) + ", so the arm would send the default gstack line; put the forced instruction after it";
  return null;
}

/** Why a plan arm with no told prefix cannot run, or null when it can: a gstack-<suffix> arm exists to carry a told prefix. */
export const planNoPrefixProblem = (name: string, arm: PlanArm, prefix?: string): string | null => (prefix === undefined && arm === "gstack" && name !== "gstack" ? "arm " + name + " runs plan arm gstack with no --told-prefix; a gstack-<suffix> plan arm needs a told prefix" : null);

/** The arm's turn 1: its prefix verbatim when it has one, planArmLine's otherwise. */
export const planToldLine = (arm: PlanArm, lens: PlanLens, prefix?: string): string => prefix ?? planArmLine(arm, lens);
