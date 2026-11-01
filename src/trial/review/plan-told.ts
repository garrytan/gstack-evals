// The told prefix on plan units (GEVA-115's spec, GST-849), so a forced-procedure gstack arm can run beside the default
// gstack arm in one plan run. A gstack stack arm named gstack-<suffix>, other than gstack-auto, runs plan arm gstack.
// Only a gstack plan arm takes a told prefix: one line that opens with the lens's command. The arm's line becomes that
// line, a space and PLAN_ASK, and the prompt still ends with TOLD_PLAN_TEMPLATE. An arm without a prefix gets plan.ts's
// line and prompt byte for byte. This lives outside plan.ts because plan.ts's own bytes are PLAN_PARSER_SHA256, the plan
// session key's verifier, so a plan run with no prefix keeps today's session keys and parser digest.
import type { ArmSpec } from "../../types.ts";
import { PLAN_ASK, PLAN_LENSES, planArmLine, planArmOf, planPrompt, TOLD_PLAN_TEMPLATE, type PlanArm, type PlanLens } from "./plan.ts";

/** planArmOf, plus a gstack stack arm named gstack-<suffix> (gstack-auto keeps its own arm), which runs plan arm gstack. */
export const planArmFor = (spec: ArmSpec): PlanArm | null => planArmOf(spec) ?? (/^gstack-[a-z0-9_-]+$/.test(spec.name) && planArmOf({ ...spec, name: "gstack" }) === "gstack" ? "gstack" : null);

/** Why a plan arm cannot take this told prefix, or null when it can. */
export function planPrefixProblem(arm: PlanArm, lens: PlanLens, prefix: string): string | null {
  const command = PLAN_LENSES[lens].command;
  if (arm !== "gstack") return "plan arm " + arm + " takes no told prefix; only a gstack plan arm (gstack or gstack-<suffix>) does";
  if (/[\r\n]/.test(prefix) || (prefix !== command && !prefix.startsWith(command + " "))) return "the prefix must be one line that opens with " + command;
  return null;
}

/** The arm's line: the prefix and PLAN_ASK when the arm has a prefix, planArmLine's otherwise. */
export const planToldLine = (arm: PlanArm, lens: PlanLens, prefix?: string): string => (prefix === undefined ? planArmLine(arm, lens) : prefix + " " + PLAN_ASK);

/** The arm's prompt: its line, a blank line and TOLD_PLAN_TEMPLATE; planPrompt's when the arm has no prefix. */
export const planToldPrompt = (arm: PlanArm, lens: PlanLens, prefix?: string): string => (prefix === undefined ? planPrompt(arm, lens) : planToldLine(arm, lens, prefix) + "\n\n" + TOLD_PLAN_TEMPLATE);
