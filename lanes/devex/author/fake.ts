// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless fake upstreams for the devex eval's checks and tests (prereg 2026-11-09-geva-417, section 15 rule 4): a
// provider-shaped reply for each model the metered client calls (Anthropic Messages for Opus, OpenAI Responses for
// Astra, OpenRouter chat for Sol, particle-1 and Argon, each naming its pinned provider unless a test sets a drift).
// No call leaves the process, and the env the checks pass holds placeholder strings, never a key.
import type { ModelKey } from "../../aftermath/meter.ts";

const ROUTED: Record<string, { key: ModelKey; provider: string }> = {
  "openai/gpt-6.1-sol": { key: "sol", provider: "OpenAI" },
  "particle-ai/particle-1": { key: "particle", provider: "particle-ai" },
  "google/gemini-4-argon": { key: "gemini", provider: "Google" },
};

/** Placeholder credentials for the metering proxy's upstream calls; the fake upstream never reads them. */
export const DRY_ENV: Record<string, string> = { ANTHROPIC_API_KEY: "dry-run", OPENAI_API_KEY: "dry-run", OPENROUTER_API_KEY: "dry-run" };

/** answer(model, prompt) gives each reply's text; drift names an OpenRouter model id and the provider that serves it instead. */
export function fakeModels(answer: (model: ModelKey, prompt: string) => string, drift: Record<string, string> = {}): typeof fetch {
  return (async (url: unknown, init?: { body?: unknown }) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? "{}"));
    const prompt = String((body.input ?? body.messages)?.[0]?.content ?? "");
    if (u.includes("anthropic")) return Response.json({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5-20260922", content: [{ type: "text", text: answer("opus", prompt) }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    if (u.includes("openrouter")) {
      const r = ROUTED[body.model] ?? { key: "gemini" as ModelKey, provider: "Google" };
      return Response.json({ id: "gen-1", model: body.model, provider: drift[body.model] ?? r.provider, choices: [{ message: { role: "assistant", content: answer(r.key, prompt) } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } });
    }
    return Response.json({ id: "resp_1", object: "response", model: "gpt-6-astra-2026-09-01", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: answer("astra", prompt) }] }], usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1200 } });
  }) as typeof fetch;
}

/** A fenced json reply. */
export const jsonReply = (value: unknown) => "\u0060\u0060\u0060json\n" + JSON.stringify(value) + "\n\u0060\u0060\u0060";
