// Copyright (c) 2026 Garry Tan. MIT License.
// The extension's stages on the outcome driver (wiki/plans/2026-11-21-geva-568-skill-pack-h2h-sol-particle-prereg
// sections 3 and 14), beside the head-to-head's own (sessions/driver.ts). An extension item (h2hx-<part>-pilot or
// h2hx-<part>-main, ext/prereg.ts extItemOf) serves that part's arms only, runs the part's model from the extension's
// prereg.json through the part's provider route, and opens one slot per session at the part's allowance
// (limits.allowance_usd, or exactly twice it after the doubling rule). Part S runs gpt-6.2-sol on the openai route (the
// metering proxy's Responses API) at 15 dollars, on h2h:s-* arms; part P runs particle-1 on the openrouter route, its row
// checked against prereg.json (route.ts particleRoute), and part L Opus on the anthropic route, both on route.ts's h2hx:
// arms. Part L's slots record their first request's prompt fields for lexposure.ts's sentence reader.
// driver/stage.ts asks this file for every h2h item, and the head-to-head's own items get exactly what sessions/driver.ts
// gives them.
import { h2hFail } from "../prereg.ts";
import { H2H_PREFIX, H2H_STAGES, h2hLimits, h2hModel, isH2hArm } from "../sessions/driver.ts";
import { readExtPrereg, S_ARMS, type ExtPrereg, type Part } from "./prereg.ts";
import { EXT_CLAUDE_STAGES, isExtArm, particleRoute } from "./route.ts";

type Provider = "anthropic" | "openai" | "openrouter";
/** The provider route each part's model takes on the metering proxy. */
export const EXT_PROVIDER: Record<Part, Provider> = { S: "openai", P: "openrouter", L: "anthropic" };
/** The first-request fields a part's slots record into the close answer: part L's sentence arms read the sentence in the
 *  Messages request (lexposure.ts sentenceIn). The proxy records a request with a top-level tools list only, which Codex's
 *  Responses requests do not send, so part S's line arm reads its AGENTS.md text from the root rollout instead
 *  (ext/session.ts firstInput). */
export const EXT_FIRST_REQUEST: Partial<Record<Part, string[]>> = { L: ["system", "messages"] };
/** The extension's items a stage may name, and the part and arms each pays for. */
export const EXT_STAGES: Record<string, { part: Part; arms: string[] }> = {
  "h2hx-s-pilot": { part: "S", arms: S_ARMS.map((a) => H2H_PREFIX + a) },
  "h2hx-s-main": { part: "S", arms: S_ARMS.map((a) => H2H_PREFIX + a) },
  "h2hx-p-pilot": { part: "P", arms: EXT_CLAUDE_STAGES["h2hx-p-pilot"]! },
  "h2hx-p-main": { part: "P", arms: EXT_CLAUDE_STAGES["h2hx-p-main"]! },
  "h2hx-l-pilot": { part: "L", arms: EXT_CLAUDE_STAGES["h2hx-l-pilot"]! },
  "h2hx-l-main": { part: "L", arms: EXT_CLAUDE_STAGES["h2hx-l-main"]! },
};

/** Whether a stage arm is an h2h stage's: the head-to-head's and part S's h2h:<arm>, or parts P and L's h2hx:<arm>. */
export const isStageArm = (arm: string): boolean => isH2hArm(arm) || isExtArm(arm);

export const isExtStage = (item: string): boolean => Object.hasOwn(EXT_STAGES, item);
/** Every h2h item a stage may name: the head-to-head's and the extension's. */
export const h2hItems = (): string[] => [...Object.keys(H2H_STAGES), ...Object.keys(EXT_STAGES)];
/** The arms an h2h item serves, or undefined for an item that is neither the head-to-head's nor the extension's. */
export const h2hStageArms = (item: string): string[] | undefined => (Object.hasOwn(H2H_STAGES, item) ? H2H_STAGES[item] : EXT_STAGES[item]?.arms);

/** The model an h2h item's sessions run: the head-to-head's prereg.json model, or the extension part's. */
export const h2hStageModel = (item: string, x?: ExtPrereg): string => (isExtStage(item) ? (x ?? readExtPrereg()).parts[EXT_STAGES[item]!.part].model : h2hModel());

/** One session's slot limits on an h2h item: sessions/driver.ts h2hLimits for the head-to-head's items; for an
 *  extension item, the part's allowance or exactly twice it, its wall and its turns. Any other allowance refuses, and a
 *  part P item refuses unless the proxy's particle-1 row is the route prereg.json pins (E_H2HX_ROUTE_CONFIG). */
export function h2hStageLimits(item: string, allowanceUsd?: number, x?: ExtPrereg): { session_cap_usd: number; wall_limit_sec: number; max_turns: number } {
  if (!isExtStage(item)) return h2hLimits(allowanceUsd);
  const part = EXT_STAGES[item]!.part;
  const xp = x ?? readExtPrereg();
  if (part === "P") particleRoute(xp);
  const l = xp.parts[part].limits;
  const cap = allowanceUsd ?? l.allowance_usd;
  if (cap !== l.allowance_usd && cap !== 2 * l.allowance_usd) h2hFail("E_H2H_SESSION_INPUT", "a part " + part + " session allowance is the extension's $" + l.allowance_usd + " or, after the doubling rule, $" + 2 * l.allowance_usd + "; not $" + cap);
  return { session_cap_usd: cap, wall_limit_sec: l.wall_sec, max_turns: l.max_turns };
}

/** The proxy route an extension item's sessions take. */
export function extStageProvider(item: string): Provider {
  const part = EXT_STAGES[item]?.part ?? h2hFail("E_H2HX_INPUT", item + " is not one of the extension's items");
  return EXT_PROVIDER[part];
}

/** The first-request fields an h2h item's proxy records, or undefined for the head-to-head's items and parts S and P's. */
export const extFirstRequestFields = (item: string): string[] | undefined => (isExtStage(item) ? EXT_FIRST_REQUEST[EXT_STAGES[item]!.part] : undefined);
