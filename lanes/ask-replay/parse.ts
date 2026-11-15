// Copyright (c) 2026 Garry Tan. MIT License.
// Reply parsing and failure kinds (prereg section 6). A reply is a JSON object {"action", "reason"} plus "repeats" and
// "reask_reason" in arms c and d, sent through the provider's JSON schema mode where frozen.json says it has one;
// otherwise the last JSON object in the text with a valid action is parsed. Action is case-insensitive. Safety stops are
// frozen per provider: Anthropic stop_reason refusal; OpenAI a refusal part or field, finish_reason content_filter or
// the Responses API's incomplete_details.reason content_filter; OpenRouter finish_reason content_filter. A safety stop
// is its own outcome (R95). A non-200 answer or no answer is upstream. run.ts applies the retries.
import { judgeAnswer } from "../../src/adapters/judge.ts";
import type { Provider } from "../../src/runner/pricing/prices.ts";
import { ACTIONS, type Action, type Reply } from "./types.ts";

export type Classified =
  | { kind: "reply"; reply: Reply; text: string; capped: boolean }
  | { kind: "unparsable"; text: string; capped: boolean }
  | { kind: "safety"; text: string }
  | { kind: "upstream"; detail: string };

const actionOf = (v: unknown): Action | null => {
  if (typeof v !== "string") return null;
  const a = v.trim().toUpperCase();
  return (ACTIONS as readonly string[]).includes(a) ? (a as Action) : null;
};

const toReply = (v: unknown): Reply | null => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const action = actionOf(o.action);
  if (!action) return null;
  return { action, reason: typeof o.reason === "string" ? o.reason : "", ...("repeats" in o ? { repeats: o.repeats } : {}), ...("reask_reason" in o ? { reask_reason: o.reask_reason } : {}) };
};

/** The end of the JSON object that opens at start, reading strings and escapes; -1 when it never closes. */
function objectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}

/** The reply in a model's text: the whole text as JSON, else the last JSON object in it with a valid action. */
export function parseReply(text: string): Reply | null {
  try {
    const whole = toReply(JSON.parse(text.trim()));
    if (whole) return whole;
  } catch {}
  let best: { end: number; start: number; reply: Reply } | null = null;
  for (let i = text.indexOf("{"); i >= 0; i = text.indexOf("{", i + 1)) {
    const end = objectEnd(text, i);
    if (end < 0) continue;
    let reply: Reply | null = null;
    try {
      reply = toReply(JSON.parse(text.slice(i, end + 1)));
    } catch {}
    if (reply && (!best || end > best.end)) best = { end, start: i, reply };
  }
  return best?.reply ?? null;
}

/** The frozen safety-stop signal in a provider's 200 answer. */
export function safetyStop(provider: Provider, body: any): boolean {
  if (provider === "anthropic") return body?.stop_reason === "refusal";
  if (provider === "openai") {
    const parts = (body?.output ?? []).flatMap((o: any) => (Array.isArray(o?.content) ? o.content : []));
    return parts.some((c: any) => c?.type === "refusal" || typeof c?.refusal === "string") || body?.refusal != null || body?.choices?.[0]?.message?.refusal != null || body?.choices?.[0]?.finish_reason === "content_filter" || body?.incomplete_details?.reason === "content_filter";
  }
  return body?.choices?.[0]?.finish_reason === "content_filter";
}

/** The answer stopped at the output cap. */
export function cappedReply(provider: Provider, body: any): boolean {
  if (provider === "anthropic") return body?.stop_reason === "max_tokens";
  if (provider === "openai") return body?.status === "incomplete" && body?.incomplete_details?.reason === "max_output_tokens";
  return body?.choices?.[0]?.finish_reason === "length";
}

/** One provider answer (status and parsed body), or null when no answer came back, as a reply or a failure kind. */
export function classify(provider: Provider, answer: { status: number; body: unknown } | null): Classified {
  if (!answer) return { kind: "upstream", detail: "no answer" };
  if (answer.status !== 200 || !answer.body || typeof answer.body !== "object") return { kind: "upstream", detail: "HTTP " + answer.status };
  const text = judgeAnswer(provider, answer.body) ?? "";
  if (safetyStop(provider, answer.body)) return { kind: "safety", text };
  const capped = cappedReply(provider, answer.body);
  const reply = parseReply(text);
  return reply ? { kind: "reply", reply, text, capped } : { kind: "unparsable", text, capped };
}
