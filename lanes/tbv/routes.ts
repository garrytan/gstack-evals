// Copyright (c) 2026 Garry Tan. MIT License.
// Routes: the arm models, the judges with their effort settings, the key writer and the auditors.
import { notBuilt } from "./errors.ts";
import type { Provider } from "../../src/runner/pricing/prices.ts";
import type { Judge, Model, PacketKind, SendRequest } from "./types.ts";

export const KEY_WRITER = { provider: "openrouter" as Provider, model: "google/gemini-4-argon" };
/** Judge max output tokens per packet kind (review round: explicit, used by the projection). */
export const JUDGE_MAX_TOKENS: Readonly<Record<PacketKind, number>> = { first: 16000, control: 16000, d2: 8000 };
export function armSend(model: Model, body: Record<string, unknown>): SendRequest {
  return notBuilt("armSend");
}
/** A judge or auditor request: Sol on OpenAI's Responses route at reasoning effort medium, Opus on Anthropic's Messages route with output_config effort medium. */
export function judgeSend(judge: Judge, prompt: string, maxTokens: number): SendRequest {
  return notBuilt("judgeSend");
}
/** The key writer's request on OpenRouter's chat route (the proxy adds the provider pin and data_collection deny). */
export function keyWriterSend(prompt: string, maxTokens: number): SendRequest {
  return notBuilt("keyWriterSend");
}
