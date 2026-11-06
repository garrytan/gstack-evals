// The ceo-outcome run's arms: ceo-outcome.ts's four plus the stage 2 amendment's gstack-enforced (analysis name enforced),
// the hook-enforced /plan-ceo-review arm at gstack 4743132. ceo-outcome.ts keeps its bytes, because every ceo-outcome
// journal binds them through parser_sha256 and ceo rows reads stage 1's journals beside the smoke rerun's. gstack-enforced
// runs plan arm gstack with gstack-forced's prompt: the forced line, the plan ask, a blank line and template.txt.
import { CEO_ARMS, CEO_PLAN_ARM, ceoPrompt, FORCED_LINE, type CeoArm } from "./ceo-outcome.ts";
import type { PlanArm } from "./plan.ts";

export type CeoRunArm = CeoArm | "gstack-enforced";
/** Every ceo-outcome session's context window (the Captain's ruling D1): Claude Code 2.1.314 gives Opus 5.5 a 1,000,000-token
 * window that compacts at 967,000, while section 5's trip rule holds a 200,000-token prompt; this env line gives every arm on
 * every model 200,000, compacting at 167,000, as Sol and particle-1 already have. It is the session key's env_values part and rides arm_provenance. */
export const CEO_CONTEXT_ENV = { CLAUDE_CODE_DISABLE_1M_CONTEXT: "1" } as const;
export const CEO_RUN_ARMS: readonly CeoRunArm[] = [...CEO_ARMS, "gstack-enforced"];
export const isCeoRunArm = (v: string): v is CeoRunArm => (CEO_RUN_ARMS as readonly string[]).includes(v);
/** The plan arm each run arm runs as: its install, skill and cell. */
export const CEO_RUN_PLAN_ARM: Readonly<Record<CeoRunArm, PlanArm>> = { ...CEO_PLAN_ARM, "gstack-enforced": "gstack" };
export const ceoRunPrompt = (arm: CeoRunArm): string => ceoPrompt(arm === "gstack-enforced" ? "gstack-forced" : arm);
/** Whether an arm may take --told-prefix, and then only the forced line: gstack-forced and gstack-enforced. */
export const forcedPrefixOk = (arm: string, prefix: string): boolean => (arm === "gstack-forced" || arm === "gstack-enforced") && prefix === FORCED_LINE;
