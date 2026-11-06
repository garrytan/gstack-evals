// Copyright (c) 2026 Garry Tan. MIT License.
// Routes (prereg sections 1 and 7): the arm models, the judges with their effort settings, the key writer and the
// auditors. Every request goes through the item's metering proxy, which adds OpenRouter's provider object (the price
// row's pin, data_collection deny and max_price) and the output cap.
import { JUDGE_REASONING_EFFORT, judgeRequest } from "../../src/adapters/judge.ts";
import type { Provider } from "../../src/runner/pricing/prices.ts";
import { requestFor } from "../review-replay/outcome.ts";
import { fail } from "./errors.ts";
import { ARM_MODELS, type Judge, type Model, type PacketKind, type SendRequest } from "./types.ts";

export const KEY_WRITER = { provider: "openrouter" as Provider, model: "google/gemini-4-argon" };
/** Judge max output tokens per packet kind (review round: explicit, used by the projection). */
export const JUDGE_MAX_TOKENS: Readonly<Record<PacketKind, number>> = { first: 16000, control: 16000, d2: 8000 };
/** The judges and auditors: Sol on OpenAI's own Responses route, Opus on Anthropic's Messages route. */
export const JUDGE_MODELS: Readonly<Record<Judge, { provider: "openai" | "anthropic"; id: string }>> = { sol: { provider: "openai", id: "gpt-6.1-sol" }, opus: { provider: "anthropic", id: "claude-opus-5-5" } };
export const JUDGE_EFFORT = JUDGE_REASONING_EFFORT;

/** An arm request: the built Messages body on the model's route, streamed. Extended thinking is off at every turn, so a body that carries a thinking field is refused. */
export function armSend(model: Model, body: Record<string, unknown>): SendRequest {
  if (body.thinking !== undefined) fail("E_TBV_REQUEST", "an arm request for " + model + " carries a thinking field; extended thinking is off at every turn (prereg section 3)");
  const m = ARM_MODELS[model];
  return { provider: m.provider, route: "/v1/messages", body: { ...body, model: m.id, stream: true }, stream: true };
}
/** A judge or auditor request: Sol on OpenAI's Responses route at reasoning effort medium, Opus on Anthropic's Messages route with output_config effort medium. */
export function judgeSend(judge: Judge, prompt: string, maxTokens: number): SendRequest {
  const m = JUDGE_MODELS[judge];
  if (m.provider === "openai") return { provider: "openai", route: "/v1/responses", body: judgeRequest("openai", m.id, prompt, maxTokens, JUDGE_EFFORT), stream: false };
  const { route, body } = requestFor("anthropic", m.id, prompt, JUDGE_EFFORT, maxTokens);
  return { provider: "anthropic", route, body, stream: false };
}
/** The key auditors are the judges on the same routes. */
export const auditorSend = judgeSend;
/** The key writer's request on OpenRouter's chat route (the proxy adds the provider pin and data_collection deny). */
export function keyWriterSend(prompt: string, maxTokens: number): SendRequest {
  return { provider: "openrouter", route: "/v1/chat/completions", body: { model: KEY_WRITER.model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens }, stream: false };
}
/** The route a request takes, as the outage pause counts it. */
export const routeKey = (req: SendRequest) => req.provider + " " + req.route;
