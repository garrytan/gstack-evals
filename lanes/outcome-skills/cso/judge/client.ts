// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 7's judge and labeller clients. Every client sends through a transport the caller supplies (the metering
// proxy in a run, a fake in tests), so this file holds no key and makes no call of its own. Carbon goes through OpenRouter
// pinned to google-vertex with fallbacks off and data collection denied; Astra and Opus are the gold labellers and the
// fallback judges, and every Astra prompt opens with prereg.json's read-only correctness framing. A malformed or truncated
// reply gets one retry, sent as its own request, then is a judge gap labelled by what came back (a reply cut off at its
// output cap is truncated, not malformed); a provider refusal is counted as a refusal. The judge's cap is deviation (d)'s. JUDGE_MODELS is the one place that maps
// prereg.json's model ids to provider ids and to src/runner/pricing/prices.ts ids (Astra is openai/gpt-6.2-astra in
// prereg.json and openai:gpt-6.2-astra in prices.ts).
import { judgeAnswer, JUDGE_ROUTE } from "../../../../src/adapters/judge.ts";
import { OPENROUTER_MODELS, openRouterRouting, type Provider } from "../../../../src/runner/pricing/prices.ts";
import { csoFail, judgeMaxOutput, type CsoPrereg } from "../prereg.ts";
import type { CsoModel } from "../types.ts";

/** prereg.json model id to provider, provider model id and price id. */
export const JUDGE_MODELS: Record<string, { provider: Provider; api: string; price: string }> = {
  "google/gemini-4-carbon": { provider: "openrouter", api: "google/gemini-4-carbon", price: "google/gemini-4-carbon" },
  "google/gemini-4-argon": { provider: "openrouter", api: "google/gemini-4-argon", price: "google/gemini-4-argon" },
  "openai/gpt-6.2-astra": { provider: "openai", api: "gpt-6.2-astra", price: "openai:gpt-6.2-astra" },
  "anthropic:claude-opus-5-5": { provider: "anthropic", api: "claude-opus-5-5", price: "anthropic:claude-opus-5-5" },
};
/** Output caps the plan does not freeze per labeller: section 14 sizes Astra's largest call at 32,000 output tokens, and
 *  that figure is used for every gold labeller; a fallback judge takes the production judge's cap. */
export const LABELLER_MAX_OUTPUT = 32_000;
export const ASTRA = "openai/gpt-6.2-astra";

export interface TransportRequest { provider: Provider; route: string; body: Record<string, unknown>; attempt?: number }
export type Transport = (req: TransportRequest) => Promise<{ status: number; body: unknown }>;
export interface JudgeClient { model: string; role: "judge" | "gold"; ask(prompt: string, attempt?: number): Promise<{ text: string; refused: boolean; truncated: boolean }> }

/** The request body for one prompt on a model's provider route. */
export function judgeBody(model: string, prompt: string, maxOutputTokens: number, effort: string): Record<string, unknown> {
  const m = JUDGE_MODELS[model] ?? csoFail("E_CSO_JUDGE_ROUTE", model + " is not a judge or labeller model the plan names");
  const messages = [{ role: "user", content: prompt }];
  if (m.provider === "openai") return { model: m.api, input: messages, store: false, max_output_tokens: maxOutputTokens, reasoning: { effort } };
  if (m.provider === "anthropic") return { model: m.api, max_tokens: maxOutputTokens, messages, output_config: { effort } };
  const price = OPENROUTER_MODELS[m.price] ?? csoFail("E_CSO_JUDGE_ROUTE", m.price + " has no price row");
  if (!price.providers?.includes("google-vertex")) csoFail("E_CSO_JUDGE_ROUTE", m.price + " is not pinned to google-vertex");
  return { model: m.api, messages, max_tokens: maxOutputTokens, reasoning: { effort }, provider: openRouterRouting(price) };
}

function refusedOrTruncated(provider: Provider, b: any): { refused: boolean; truncated: boolean } {
  if (provider === "anthropic") return { refused: b?.stop_reason === "refusal", truncated: b?.stop_reason === "max_tokens" };
  if (provider === "openai") {
    const refusal = (b?.output ?? []).some((i: any) => (i?.content ?? []).some((c: any) => c?.type === "refusal")) || b?.incomplete_details?.reason === "content_filter";
    return { refused: refusal, truncated: b?.incomplete_details?.reason === "max_output_tokens" };
  }
  const c = b?.choices?.[0];
  return { refused: c?.finish_reason === "content_filter" || !!c?.message?.refusal, truncated: c?.finish_reason === "length" };
}

/** A client for one model at its frozen effort and cap. A non-200 reply refuses with E_CSO_JUDGE_TRANSPORT. */
export function judgeClient(model: string, role: "judge" | "gold", transport: Transport, o: { maxOutputTokens: number; effort: string; framing?: string }): JudgeClient {
  const m = JUDGE_MODELS[model] ?? csoFail("E_CSO_JUDGE_ROUTE", model + " is not a judge or labeller model the plan names");
  return {
    model, role,
    async ask(prompt, attempt = 1) {
      const body = judgeBody(model, o.framing ? o.framing + "\n\n" + prompt : prompt, o.maxOutputTokens, o.effort);
      const r = await transport({ provider: m.provider, route: JUDGE_ROUTE[m.provider], body, attempt });
      if (r.status !== 200) csoFail("E_CSO_JUDGE_TRANSPORT", model + " answered HTTP " + r.status);
      return { text: judgeAnswer(m.provider, r.body), ...refusedOrTruncated(m.provider, r.body) };
    },
  };
}

export type Asked<T> = { value: T; refused: false; attempts: number } | { gap: string; refused: boolean; attempts: number };

/** Section 7's retry rule: a malformed or truncated reply gets one retry as attempt 2, and a second is a judge gap named
 *  by what each reply was. A refusal ends the call as a refusal (and a gap). */
export async function askParsed<T>(c: JudgeClient, prompt: string, parse: (text: string) => T | null): Promise<Asked<T>> {
  const why: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await c.ask(prompt, attempt);
    if (r.refused) return { gap: c.model + " refused", refused: true, attempts: attempt };
    const v = r.truncated ? null : parse(r.text);
    if (v !== null) return { value: v, refused: false, attempts: attempt };
    why.push(r.truncated ? "truncated" : "malformed");
  }
  return { gap: c.model + (why[0] === why[1] ? " gave a " + why[0] + " reply twice" : " gave a " + why[0] + " reply, then a " + why[1] + " one"), refused: false, attempts: 2 };
}

export interface JudgeRoute { route: string; judge: string; gold: [string, string]; cells: CsoModel[] }

/** The production route and prereg.json's fallback routes (E_CSO_JUDGE_ROUTE when a model is not in JUDGE_MODELS). */
export function judgeRoutes(p: CsoPrereg): JudgeRoute[] {
  const j = p.judge as unknown as { production: { model: string }; gold_labellers: { model: string }[]; fallback: Record<"opus_and_particle_cells" | "sol_cells", { judge: string; gold: string[] }> };
  const pair = (g: string[]): [string, string] => (g.length === 2 ? [g[0]!, g[1]!] : csoFail("E_CSO_JUDGE_ROUTE", "a gold pair needs two labellers"));
  const routes: JudgeRoute[] = [
    { route: "production", judge: j.production.model, gold: pair(j.gold_labellers.map((g) => g.model)), cells: ["opus", "particle", "sol"] },
    { route: "fallback-opus-particle", judge: j.fallback.opus_and_particle_cells.judge, gold: pair(j.fallback.opus_and_particle_cells.gold), cells: ["opus", "particle"] },
    { route: "fallback-sol", judge: j.fallback.sol_cells.judge, gold: pair(j.fallback.sol_cells.gold), cells: ["sol"] },
  ];
  for (const r of routes) for (const m of [r.judge, ...r.gold]) if (!JUDGE_MODELS[m]) csoFail("E_CSO_JUDGE_ROUTE", r.route + " names " + m + ", which has no client");
  return routes;
}

/** The clients for one route: the judge at the production effort and cap, and both labellers at high effort. */
export function routeClients(route: JudgeRoute, p: CsoPrereg, transport: Transport): { judge: JudgeClient; gold: [JudgeClient, JudgeClient] } {
  const j = p.judge as unknown as { production: { effort: string; max_output_tokens: number }; gold_labellers: { model: string; effort: string; framing?: string }[] };
  const framing = j.gold_labellers.find((g) => g.model === ASTRA)?.framing;
  const frame = (m: string) => (m === ASTRA && framing ? "This is " + framing + "." : undefined);
  const effort = (m: string) => j.gold_labellers.find((g) => g.model === m)?.effort ?? "high";
  return {
    judge: judgeClient(route.judge, "judge", transport, { maxOutputTokens: judgeMaxOutput(p), effort: j.production.effort, framing: frame(route.judge) }),
    gold: route.gold.map((m) => judgeClient(m, "gold", transport, { maxOutputTokens: LABELLER_MAX_OUTPUT, effort: effort(m), framing: frame(m) })) as [JudgeClient, JudgeClient],
  };
}
