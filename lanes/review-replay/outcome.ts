// Copyright (c) 2026 Garry Tan. MIT License.
// The review replay's request bodies and its reading of a provider's reply (plan v3.2, "Review replay lane",
// requirement 4, and GSTA-11's rerun preconditions 1, 3, 6 and 7). Every HTTP-200 failure takes one path: an error
// object, an error finish, a choice error, no usage, or an OpenRouter reply from a provider outside the price row's pin
// is missing (E_REPLAY_TRANSPORT), and the provider's usage and text stay on the record. A reply counts as answered
// only when it stops at end_turn, stop, stop_sequence, max_tokens or length.
import type { ReasonCode } from "../../src/errors/codes.ts";
import { chatPrice } from "../../src/runner/pricing/prices.ts";
import type { PolicyProvider } from "../../src/skill-eval/cli/policy.ts";
import type { Termination } from "../../src/types.ts";

const ANSWERED = new Set(["end_turn", "stop", "stop_sequence"]);
const CUT_OFF = new Set(["max_tokens", "length"]);
const CONTEXT_OVERFLOW = /context[ _-]?(length|window)|prompt is too long|maximum context|too many (input )?tokens/i;

/** The route and body one item sends: its prompt as one user turn, the plan's output cap in the route's own field, and its effort where the provider reads it. */
export function requestFor(provider: PolicyProvider, model: string, prompt: string, effort: string | null, maxOutputTokens: number): { route: string; body: Record<string, unknown> } {
  const messages = [{ role: "user", content: prompt }];
  if (provider === "anthropic") return { route: "/v1/messages", body: { model, max_tokens: maxOutputTokens, messages, ...(effort ? { output_config: { effort } } : {}) } };
  if (provider === "openai") return { route: "/v1/chat/completions", body: { model, max_completion_tokens: maxOutputTokens, messages, ...(effort ? { reasoning_effort: effort } : {}) } };
  return { route: "/v1/chat/completions", body: { model, max_tokens: maxOutputTokens, messages, ...(effort ? { reasoning: { effort } } : {}) } };
}

export interface Reading {
  /** null when the reply stops the run with no outcome for the item, such as an unexpected 4xx (E_INTERNAL). */
  termination: Termination | null;
  /** Set when the reply stops the run; the item still gets its outcome when termination is terminal. */
  stop: ReasonCode | null;
  reason: string;
  stop_reason: string | null;
  truncated: boolean;
  cut_off: boolean;
  text: string | null;
  usage: unknown;
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Reads a provider's own answer (not a proxy refusal). spendKnown is false when the proxy settled the call without
 * usage. A 4xx other than a context overflow returns termination null: it stops the run with E_INTERNAL and the item
 * gets no outcome.
 */
export function readReply(provider: PolicyProvider, model: string, status: number, body: string, minVisibleChars: number, spendKnown: boolean): Reading {
  let json: Record<string, any> = {};
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed;
  } catch {}
  const choice = Array.isArray(json.choices) ? json.choices[0] : undefined;
  const text = provider === "anthropic" ? (Array.isArray(json.content) ? json.content.filter((c: any) => c?.type === "text").map((c: any) => String(c.text ?? "")).join("\n") : null) : typeof choice?.message?.content === "string" ? choice.message.content : null;
  const stopReason: string | null = (provider === "anthropic" ? json.stop_reason : choice?.finish_reason) ?? null;
  const base = { stop_reason: stopReason, truncated: false, cut_off: false, text, usage: json.usage ?? null };
  const reading = (termination: Termination | null, reason: string, stop: ReasonCode | null = null, extra: Partial<Reading> = {}): Reading => ({ ...base, ...extra, termination, stop, reason });
  if (status < 200 || status >= 300) {
    if (status >= 400 && status < 500 && CONTEXT_OVERFLOW.test(body)) return reading({ kind: "arm_failure", failure: "context_overflow" }, "the provider answered " + status + " with a context-length error");
    return reading(null, "the provider answered " + status + ", which the runner does not expect: " + body.slice(0, 200), "E_INTERNAL");
  }
  const missing = (reason: string) => reading({ kind: "missing", code: "E_REPLAY_TRANSPORT" }, reason, "E_REPLAY_TRANSPORT");
  if (json.error) return missing("the provider answered 200 with an error object");
  if (stopReason === "error" || choice?.error) return missing("the provider answered 200 with " + (choice?.error ? "a choice error" : "finish_reason error"));
  const pinned = provider === "openrouter" ? chatPrice("openrouter:" + model)?.providers : undefined;
  if (pinned && !pinned.some((p) => typeof json.provider === "string" && slug(json.provider) === slug(p.split("/")[0]!))) return missing("OpenRouter served the reply from " + (json.provider ?? "an unnamed provider") + ", outside the price row's pinned providers " + pinned.join(", "));
  if (!json.usage || typeof json.usage !== "object" || !spendKnown) return missing("the provider answered 200 without usage, so its spend is unknown");
  if (stopReason === "refusal" || stopReason === "content_filter") return reading({ kind: "arm_failure", failure: "refusal" }, "the reply stopped with " + stopReason);
  if (provider !== "anthropic" && !choice) return reading({ kind: "arm_failure", failure: "empty_response" }, "the reply has no choices");
  const cutOff = stopReason !== null && CUT_OFF.has(stopReason);
  if (!cutOff && !ANSWERED.has(stopReason ?? "")) return reading({ kind: "arm_failure", failure: "malformed_output" }, "the reply stopped with " + (stopReason ?? "no stop reason"));
  const visible = (text ?? "").trim().length;
  if (!visible) return reading({ kind: "arm_failure", failure: "empty_response" }, "the reply has no text", null, { cut_off: cutOff });
  if (!cutOff) return reading({ kind: "completed" }, "answered");
  if (visible < minVisibleChars) return reading({ kind: "arm_failure", failure: "empty_response" }, "the reply was cut off with " + visible + " visible characters, under the plan's " + minVisibleChars, null, { cut_off: true });
  return reading({ kind: "completed" }, "the reply was cut off at the output cap", null, { cut_off: true, truncated: true });
}
