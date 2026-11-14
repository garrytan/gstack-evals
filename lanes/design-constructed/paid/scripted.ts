// Copyright (c) 2026 Garry Tan. MIT License.
// Scripted upstreams for the keyless tests and dry run: each answers like its provider (Anthropic Messages, OpenAI
// Responses, OpenRouter chat completions and its Anthropic-shaped Messages route), as JSON or as a stream, with usage
// blocks, OpenRouter's served-provider field, provider-shaped errors, 429 with retry-after and 5xx with no usage. The
// metering proxy's fetch is bound to one; nothing reaches a network and no key is read. A Messages reply may be one tool
// call instead of text, so a Claude Code session takes a second turn. Routes are read from the URL's path, since the CLI
// adds ?beta=true to its Messages calls.

export type Reply =
  | { kind: "ok"; text?: string; input?: number; output?: number; provider?: string | null; stream?: boolean; model?: string; tool?: { name: string; input: Record<string, unknown> } }
  | { kind: "status"; status: number; retryAfterS?: number; usage?: { input: number; output: number } };

export interface Sent {
  url: string;
  body: any;
  headers: Record<string, string>;
}

export interface Scripted {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sent: Sent[];
}

const sse = (events: Array<{ event?: string; data: unknown }>) =>
  new Response(events.map((e) => (e.event ? "event: " + e.event + "\n" : "") + "data: " + (typeof e.data === "string" ? e.data : JSON.stringify(e.data)) + "\n\n").join(""), { status: 200, headers: { "content-type": "text/event-stream" } });

function okReply(url: string, body: any, r: Extract<Reply, { kind: "ok" }>, n: number): Response {
  const text = r.text ?? "ok";
  const input = r.input ?? 100;
  const output = r.output ?? 20;
  const model = r.model ?? String(body?.model ?? "model");
  const openrouter = url.includes("openrouter.ai");
  const named = openrouter && r.provider !== null ? { provider: r.provider ?? "OpenAI" } : {};
  const route = new URL(url).pathname;
  if (route.endsWith("/v1/messages")) {
    const id = (openrouter ? "gen-" : "msg_") + n;
    const tool = r.tool ? { type: "tool_use", id: "toolu_" + n, name: r.tool.name, input: r.tool.input } : null;
    const stop = tool ? "tool_use" : "end_turn";
    if (!r.stream) return Response.json({ id, type: "message", role: "assistant", model, ...named, content: [tool ?? { type: "text", text }], stop_reason: stop, usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    return sse([
      { event: "message_start", data: { type: "message_start", message: { id, type: "message", role: "assistant", model, ...named, content: [], usage: { input_tokens: input, output_tokens: 1 } } } },
      { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: tool ? { ...tool, input: {} } : { type: "text", text: "" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } : { type: "text_delta", text } } },
      { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
      { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: output } } },
      { event: "message_stop", data: { type: "message_stop" } },
    ]);
  }
  if (route.endsWith("/v1/responses")) return Response.json({ id: "resp_" + n, object: "response", status: "completed", model, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }], usage: { input_tokens: input, output_tokens: output, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } });
  const id = "gen-" + n;
  if (!r.stream) return Response.json({ id, object: "chat.completion", model, ...named, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output } });
  return sse([
    { data: { id, object: "chat.completion.chunk", model, ...named, choices: [{ index: 0, delta: { role: "assistant", content: text } }] } },
    { data: { id, object: "chat.completion.chunk", model, ...named, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output } } },
    { data: "[DONE]" },
  ]);
}

function statusReply(url: string, r: Extract<Reply, { kind: "status" }>): Response {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (r.retryAfterS !== undefined) headers["retry-after"] = String(r.retryAfterS);
  const message = r.status === 429 ? "rate limited" : r.status >= 500 ? "upstream overloaded" : "bad request";
  const route = new URL(url).pathname;
  const usage = r.usage ? (route.endsWith("/v1/messages") || route.endsWith("/v1/responses") ? { input_tokens: r.usage.input, output_tokens: r.usage.output } : { prompt_tokens: r.usage.input, completion_tokens: r.usage.output }) : undefined;
  const error = url.includes("api.anthropic.com") ? { type: "error", error: { type: r.status === 429 ? "rate_limit_error" : r.status >= 500 ? "overloaded_error" : "invalid_request_error", message } } : url.includes("openrouter.ai") ? { error: { code: r.status, message, metadata: { provider_name: "OpenAI" } } } : { error: { type: r.status === 429 ? "rate_limit_exceeded" : "server_error", code: null, message } };
  return new Response(JSON.stringify({ ...error, ...(usage ? { usage } : {}) }), { status: r.status, headers });
}

/** An upstream that answers each send with the next scripted reply (the last one repeats), per provider route. */
export function scripted(script: Reply[] | ((url: string, body: any, n: number) => Reply), o: { generation?: (id: string) => string | null } = {}): Scripted {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: async (url, init) => {
      let body: any = null;
      try {
        body = JSON.parse(String(init.body ?? "null"));
      } catch {}
      const headers: Record<string, string> = {};
      new Headers(init.headers).forEach((v, k) => (headers[k] = v));
      sent.push({ url, body, headers });
      const gen = url.match(/\/api\/v1\/generation\?id=([A-Za-z0-9_-]+)$/)?.[1];
      if (gen !== undefined) {
        const name = o.generation?.(gen) ?? null;
        return name === null ? Response.json({ error: { code: 404, message: "generation not found" } }, { status: 404 }) : Response.json({ data: { id: gen, provider_name: name, total_cost: 0 } });
      }
      const n = sent.length;
      const r = typeof script === "function" ? script(url, body, n) : script[Math.min(n - 1, script.length - 1)]!;
      return r.kind === "ok" ? okReply(url, body, r, n) : statusReply(url, r);
    },
  };
}
