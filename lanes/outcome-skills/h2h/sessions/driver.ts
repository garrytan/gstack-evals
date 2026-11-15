// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head's stages on the outcome driver (post sections 3, 7 and 14). An h2h stage names h2h:<arm> arms only and
// pays from one of prereg.json's model items; it runs prereg.json's one model through the registry's provider route. Each
// session opens one slot whose cap is the session allowance (limits.allowance_usd, or twice it after stage 1's doubling
// rule) and whose deadline is the session's wall limit plus the driver's grace. driver/stage.ts reads this file.
import { h2hFail, readPrereg } from "../prereg.ts";
import { ALL_ARMS, PIECE_G_ARMS, PRIMARY_ARMS, SECONDARY_ARMS, type H2hArm } from "../types.ts";

export const H2H_PREFIX = "h2h:";
/** The program skill every h2h item's spend is charged to in the approvals record. */
export const H2H_SKILL = "h2h";
const tag = (arms: readonly H2hArm[]) => arms.map((a) => H2H_PREFIX + a);

/** The model items a stage may name and the arms each one pays for (plan.ts itemOf reads the same split). */
export const H2H_STAGES: Record<string, string[]> = {
  "h2h-smoke": tag(ALL_ARMS),
  "h2h-pilot": tag(ALL_ARMS),
  "h2h-opus": tag(PRIMARY_ARMS),
  "h2h-pony": tag(PIECE_G_ARMS),
  "h2h-qa": tag(SECONDARY_ARMS),
};

export const isH2hArm = (arm: string): boolean => arm.startsWith(H2H_PREFIX);
export const armOf = (tagged: string): H2hArm => ((ALL_ARMS as readonly string[]).includes(tagged.slice(H2H_PREFIX.length)) ? (tagged.slice(H2H_PREFIX.length) as H2hArm) : h2hFail("E_H2H_SESSION_INPUT", tagged + " is not an h2h arm"));

/** The model every h2h session runs on: prereg.json's model. */
export const h2hModel = (): string => readPrereg().model;

/** One session's slot limits: the allowance (prereg.json's, or exactly twice it once stage 1's doubling rule fired) and the
 *  session's wall limit. Any other allowance is refused, so no stage runs on a value chosen elsewhere. */
export function h2hLimits(allowanceUsd?: number): { session_cap_usd: number; wall_limit_sec: number; max_turns: number } {
  const l = readPrereg().limits;
  const cap = allowanceUsd ?? l.allowance_usd;
  if (cap !== l.allowance_usd && cap !== 2 * l.allowance_usd) h2hFail("E_H2H_SESSION_INPUT", "an h2h session allowance is prereg.json's $" + l.allowance_usd + " or, after stage 1's doubling rule, $" + 2 * l.allowance_usd + "; not $" + cap);
  return { session_cap_usd: cap, wall_limit_sec: l.wall_sec, max_turns: l.max_turns };
}
