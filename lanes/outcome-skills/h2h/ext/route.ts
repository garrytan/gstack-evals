// Copyright (c) 2026 Garry Tan. MIT License.
// Part P's route (plan sections 2 and 3; prereg.json parts.P.route): particle-ai/particle-1 on the Claude Code path through
// the run's metering proxy to OpenRouter, pinned to the Particle AI provider only, with data collection denied and no
// fallbacks. The proxy already writes that routing into every OpenRouter call from the price row (prices.ts
// openRouterRouting); particleRoute checks the row against prereg.json before anything runs. A call served by another
// provider is caught after the session from OpenRouter's generation record of each answer (the Messages stream's
// message_start id is the generation id), read through the proxy's free generation route; one such call stops part P's
// items for the Captain. This file also holds the extension's Claude Code stages (parts P and L): the items, the arms each
// pays for, the model and the session allowance.
import { chatPrice, openRouterRouting } from "../../../../src/runner/pricing/prices.ts";
import { HARBOR_MODEL } from "../../statemachines/run.ts";
import { h2hFail } from "../prereg.ts";
import { L_ARMS, P_ARMS, partOf, readExtPrereg, type ExtArm, type ExtPrereg, type Part } from "./prereg.ts";

/** OpenRouter's provider slug for each provider name prereg.json pins. */
export const PROVIDER_SLUG: Record<string, string> = { "Particle AI": "particle-ai" };
export const EXT_PREFIX = "h2hx:";

export interface ClaudeRoute {
  provider: "openrouter" | "anthropic";
  model: string;
  /** The provider:model id a session's proxy slot allows. */
  slot_model: string;
  /** The model Harbor's Claude Code agent is given. */
  harbor_model: string;
  /** OpenRouter only: the provider names a call may be served by. */
  served_by: string[] | null;
}

/** Part P's route, checked against the proxy's price row: an OpenRouter row for the model, pinned to exactly the slugs of
 *  prereg.json's provider_only, with fallbacks off and data collection denied as prereg.json says (E_H2HX_ROUTE_CONFIG). */
export function particleRoute(x: ExtPrereg = readExtPrereg()): ClaudeRoute {
  const p = x.parts.P, r = p.route;
  const bad = (why: string): never => h2hFail("E_H2HX_ROUTE_CONFIG", "part P's route " + why);
  if (r.via !== "openrouter") bad("goes via " + r.via + ", not openrouter");
  if (!r.provider_only.length) bad("pins no provider");
  const slugs = r.provider_only.map((n) => PROVIDER_SLUG[n] ?? bad("names provider " + n + ", which has no OpenRouter slug here"));
  const price = chatPrice("openrouter:" + p.model) ?? bad("has no OpenRouter price row for " + p.model + " in src/runner/pricing/prices.ts");
  const routing = openRouterRouting(price) as { only?: string[]; allow_fallbacks?: boolean; data_collection?: string };
  if ((routing.only ?? []).join(",") !== slugs.join(",")) bad("pins " + slugs.join(",") + " but the proxy's row pins " + ((routing.only ?? []).join(",") || "no provider"));
  if ((routing.allow_fallbacks ?? true) !== r.allow_fallbacks) bad("sets allow_fallbacks " + r.allow_fallbacks + " but the proxy sends " + (routing.allow_fallbacks ?? "none"));
  if (routing.data_collection !== r.data_collection) bad("sets data_collection " + r.data_collection + " but the proxy sends " + routing.data_collection);
  return { provider: "openrouter", model: p.model, slot_model: "openrouter:" + p.model, harbor_model: HARBOR_MODEL[p.model] ?? "anthropic/" + p.model, served_by: [...r.provider_only] };
}

/** The route a Claude Code arm runs on: part P's pinned OpenRouter route, part L's Anthropic one. Part S runs in Codex. */
export function claudeRoute(arm: ExtArm, x: ExtPrereg = readExtPrereg()): ClaudeRoute {
  const part = partOf(arm);
  if (part === "P") return particleRoute(x);
  if (part === "L") return { provider: "anthropic", model: x.parts.L.model, slot_model: "anthropic:" + x.parts.L.model, harbor_model: HARBOR_MODEL[x.parts.L.model] ?? "anthropic/" + x.parts.L.model, served_by: null };
  return h2hFail("E_H2HX_INPUT", "arm " + arm + " runs in Codex, not on the Claude Code path");
}

const tag = (arms: readonly string[]) => arms.map((a) => EXT_PREFIX + a);
/** The extension's Claude Code items and the arms each pays for. */
export const EXT_CLAUDE_STAGES: Record<string, string[]> = {
  "h2hx-p-pilot": tag(P_ARMS), "h2hx-p-main": tag(P_ARMS), "h2hx-l-pilot": tag(L_ARMS), "h2hx-l-main": tag(L_ARMS),
};
export const isExtArm = (tagged: string): boolean => tagged.startsWith(EXT_PREFIX);
/** The arm of a tagged h2hx arm that a stage may serve. */
export function extArmOf(tagged: string, item?: string): ExtArm {
  if (!isExtArm(tagged)) h2hFail("E_H2HX_INPUT", tagged + " is not an h2hx arm");
  if (item !== undefined && !(EXT_CLAUDE_STAGES[item] ?? []).includes(tagged)) h2hFail("E_H2HX_INPUT", "item " + item + " does not pay for " + tagged + "; it pays for " + (EXT_CLAUDE_STAGES[item] ?? []).join(", "));
  return tagged.slice(EXT_PREFIX.length) as ExtArm;
}

/** One session's slot limits in a part: prereg.json's allowance for the part ($5 for particle-1), or exactly twice it once
 *  the part's doubling rule fired; any other allowance is refused. */
export function extLimits(part: Part, allowanceUsd?: number, x: ExtPrereg = readExtPrereg()): { session_cap_usd: number; wall_limit_sec: number; max_turns: number } {
  const l = x.parts[part].limits;
  const cap = allowanceUsd ?? l.allowance_usd;
  if (cap !== l.allowance_usd && cap !== 2 * l.allowance_usd) h2hFail("E_H2HX_INPUT", "a part " + part + " session allowance is $" + l.allowance_usd + " or, after the doubling rule, $" + 2 * l.allowance_usd + "; not $" + cap);
  return { session_cap_usd: cap, wall_limit_sec: l.wall_sec, max_turns: l.max_turns };
}

/** The model Claude Code names on the assistant messages it writes itself rather than receives. */
export const SYNTHETIC_MODEL = "<synthetic>";

/** The answer ids of a Claude Code session, in order, from its SDK message log (assistant messages' message.id). A message
 * Claude Code writes itself (model "<synthetic>", such as the API error after an allowance stop) has no generation record
 * and is left out. */
export function answerIds(transcript: string): string[] {
  const ids: string[] = [];
  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;
    let m: { type?: string; message?: { id?: unknown; model?: unknown } };
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    const id = m.type === "assistant" && m.message?.model !== SYNTHETIC_MODEL ? m.message?.id : undefined;
    if (typeof id === "string" && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export type GenerationLookup = (id: string) => Promise<{ status: number; text: string }>;
/** A lookup through a proxy slot's free OpenRouter generation route. */
export const proxyLookup = (proxyBase: string, slot: string, token: string): GenerationLookup => async (id) => {
  const res = await fetch(proxyBase.replace(/\/$/, "") + "/" + slot + "/openrouter/v1/generation?id=" + id, { headers: { authorization: "Bearer " + token } });
  return { status: res.status, text: await res.text() };
};

/** Refuses unless every answer was served by one of the route's providers: E_H2HX_ROUTE_PROVIDER for a call served by
 *  another provider, E_H2HX_ROUTE_RECORD when an answer has no readable generation record. Either stops part P's items. */
export async function checkServedBy(ids: readonly string[], lookup: GenerationLookup, route: ClaudeRoute): Promise<{ checked: number; served_by: string[] }> {
  if (!route.served_by) return { checked: 0, served_by: [] };
  const allowed = new Set(route.served_by.map((n) => n.toLowerCase()));
  const seen = new Set<string>();
  for (const id of ids) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) h2hFail("E_H2HX_ROUTE_RECORD", "answer id " + JSON.stringify(id) + " can't name a generation record; part P's items stop for the Captain");
    const r = await lookup(id);
    let data: { id?: unknown; provider_name?: unknown } | undefined;
    try {
      data = (JSON.parse(r.text) as { data?: { id?: unknown; provider_name?: unknown } }).data;
    } catch {}
    const name = r.status === 200 && data?.id === id && typeof data.provider_name === "string" ? data.provider_name : h2hFail("E_H2HX_ROUTE_RECORD", "no generation record for answer " + id + " (status " + r.status + "); part P's items stop for the Captain");
    if (!allowed.has(name.toLowerCase())) h2hFail("E_H2HX_ROUTE_PROVIDER", "answer " + id + " for " + route.model + " was served by " + JSON.stringify(name) + ", not " + route.served_by.join(" or ") + "; part P's items stop for the Captain");
    seen.add(name);
  }
  return { checked: ids.length, served_by: [...seen].sort() };
}
