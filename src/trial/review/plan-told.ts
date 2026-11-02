// The told prefix on plan units (GEVA-115's spec, GST-849), so a forced-procedure gstack arm can run beside the default
// gstack arm in one plan run. A gstack stack arm named gstack-<suffix>, other than gstack-auto, runs plan arm gstack.
// Only a gstack plan arm takes a told prefix: one line that opens with the lens's command. The arm's line becomes that
// line, a space and PLAN_ASK, and the prompt still ends with TOLD_PLAN_TEMPLATE. An arm without a prefix gets plan.ts's
// line and prompt byte for byte. A prefix must add words after the command, must not hold the ask, and has no edge
// whitespace or control characters, and each refusal names its cause. A gstack-<suffix> arm exists to carry a prefix, so
// one with no prefix is refused. This lives outside plan.ts because plan.ts's own bytes are PLAN_PARSER_SHA256, the plan
// session key's verifier, so a plan run with no prefix keeps today's session keys and parser digest.
import type { ArmSpec } from "../../types.ts";
import { PLAN_ASK, PLAN_LENSES, planArmLine, planArmOf, planPrompt, TOLD_PLAN_TEMPLATE, type PlanArm, type PlanLens } from "./plan.ts";

/** planArmOf, plus a gstack stack arm named gstack-<suffix> (gstack-auto keeps its own arm), which runs plan arm gstack. */
export const planArmFor = (spec: ArmSpec): PlanArm | null => planArmOf(spec) ?? (/^gstack-[a-z0-9_-]+$/.test(spec.name) && planArmOf({ ...spec, name: "gstack" }) === "gstack" ? "gstack" : null);

const CONTROL_NAMES: Record<string, string> = { "\n": "a line feed", "\r": "a carriage return", "\t": "a tab", "\ufeff": "a byte order mark" };

/** Why a plan arm cannot take this told prefix, or null when it can. */
export function planPrefixProblem(arm: PlanArm, lens: PlanLens, prefix: string): string | null {
  const command = PLAN_LENSES[lens].command;
  if (arm !== "gstack") return "plan arm " + arm + " takes no told prefix; only a gstack plan arm (gstack or gstack-<suffix>) does";
  const control = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/.exec(prefix);
  if (control) return "the prefix must be one line of plain text, but it has " + (CONTROL_NAMES[control[0]] ?? "a control character") + " (U+" + control[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0") + ") at character " + (control.index + 1);
  if (prefix !== prefix.trim()) return "the prefix must not start or end with whitespace; the harness puts one space between it and " + JSON.stringify(PLAN_ASK);
  if (prefix !== command && !prefix.startsWith(command + " ")) return "the prefix must be one line that opens with " + command;
  if (prefix === command) return "the prefix adds nothing after " + command + ", so the arm would send the default gstack line; put the forced instruction after the command";
  if (prefix.toLowerCase().includes(PLAN_ASK.toLowerCase())) return "the prefix contains " + JSON.stringify(PLAN_ASK) + ", which the harness appends after it, so the arm would send the ask twice";
  return null;
}

/** Why a plan arm with no told prefix cannot run, or null when it can: a gstack-<suffix> arm exists to carry a told prefix. */
export const planNoPrefixProblem = (name: string, arm: PlanArm, prefix?: string): string | null => (prefix === undefined && arm === "gstack" && name !== "gstack" ? "arm " + name + " runs plan arm gstack with no --told-prefix; a gstack-<suffix> plan arm needs a told prefix" : null);

/** The arm's line: the prefix and PLAN_ASK when the arm has a prefix, planArmLine's otherwise. */
export const planToldLine = (arm: PlanArm, lens: PlanLens, prefix?: string): string => (prefix === undefined ? planArmLine(arm, lens) : prefix + " " + PLAN_ASK);

/** The arm's prompt: its line, a blank line and TOLD_PLAN_TEMPLATE; planPrompt's when the arm has no prefix. */
export const planToldPrompt = (arm: PlanArm, lens: PlanLens, prefix?: string): string => (prefix === undefined ? planPrompt(arm, lens) : planToldLine(arm, lens, prefix) + "\n\n" + TOLD_PLAN_TEMPLATE);
