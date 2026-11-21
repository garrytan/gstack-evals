// The OpenAI Responses API on Lane B's session proxy (runner/proxy.ts), for Codex CLI sessions (the Codex hooks eval's part R,
// lanes/codex-hooks/r). The proxy serves a request whose path ends in /v1/responses with the same session token, model pin,
// per-session cap, worst-case refusal, ledger reserve and settle and request log as /v1/messages; this file holds what
// differs on that wire:
// - The body keys a Responses request may carry: what Codex 0.170.0 sends for gpt-6.1-sol (captured against a local stub:
//   model, input, stream, store, include, reasoning, text, tool_choice, parallel_tool_calls, prompt_cache_key and
//   client_metadata), plus instructions, tools, max_output_tokens, temperature, top_p, metadata and stream_options. Anything
//   else is refused: previous_response_id, conversation and prompt reach stored context the byte bound can't see, background
//   runs outside the session, and service_tier changes the price.
// - Tools run on our side only. Codex sends its tools as an additional_tools input item (namespace, function and custom
//   tools); a tool of any other type, in body.tools or in that item, at any depth, is a provider-side tool and is refused.
// - Images and files must be inline: an input_image or input_file that names a URL other than a data URL, or a file_id, is
//   refused, since the provider would fetch it outside the sandbox and outside the byte bound.
// - Codex sends no output cap, so the worst case would have none. The proxy writes max_output_tokens at the model's
//   output_cap_tokens when the body has none, and refuses a larger one; every request log line records the cap it sent.
// - Usage comes from response.completed, response.incomplete or response.failed (stream) or the body's usage (no stream).
//   OpenAI counts cached and cache-written tokens inside input_tokens and reasoning inside output_tokens; the proxy's Usage
//   keeps fresh input, cache reads and cache writes apart, and prices every output token, reasoning included, at the output
//   rate.
// - Every request log line carries the request's reasoning.effort as sent (reasoning_effort) beside the model it named
//   (requested_model), the two fields the eval reads each session's model and effort from.
import { emptyUsage, type ModelCfg, type Usage } from "./proxy.ts";

export const RESPONSES_PATH = "/v1/responses";
export const isResponsesPath = (pathname: string) => pathname.endsWith(RESPONSES_PATH);

export const RESPONSES_BODY_KEYS = new Set([
  "model", "input", "stream", "store", "include", "reasoning", "text", "tool_choice", "parallel_tool_calls", "prompt_cache_key",
  "client_metadata", "instructions", "tools", "max_output_tokens", "temperature", "top_p", "metadata", "stream_options",
]);
export const unknownResponsesKeys = (body: Record<string, unknown>) => Object.keys(body).filter((k) => !RESPONSES_BODY_KEYS.has(k));

const CLIENT_TOOLS = new Set(["function", "custom", "namespace"]);
function toolTypes(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((t: any) => {
    if (!t || typeof t !== "object") return ["(not an object)"];
    const own = CLIENT_TOOLS.has(t.type) ? [] : [String(t.type)];
    return [...own, ...(t.type === "namespace" ? toolTypes(t.tools) : [])];
  });
}
/** Provider-side tool types the request carries, in body.tools or in an additional_tools input item. */
export function responsesServerTools(body: any): string[] {
  const items = Array.isArray(body?.input) ? body.input.filter((i: any) => i?.type === "additional_tools") : [];
  return [...toolTypes(body?.tools), ...items.flatMap((i: any) => toolTypes(i.tools))];
}

/** input_image and input_file parts whose content the provider would fetch: a URL that is not a data URL, or a file_id. */
export function responsesRemoteSources(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(responsesRemoteSources);
  if (!v || typeof v !== "object") return [];
  const o = v as any;
  const own: string[] = [];
  if (o.type === "input_image" || o.type === "input_file") {
    const url = o.image_url ?? o.file_url;
    if (typeof url === "string" && !url.startsWith("data:")) own.push(o.type + ":url");
    if (o.file_id !== undefined) own.push(o.type + ":file_id");
  }
  return [...own, ...Object.values(o).flatMap(responsesRemoteSources)];
}

/** Inline image and file parts: input_image with a data URL, and input_file with file_data or a data URL. */
export function responsesInline(v: unknown): { images: number; files: number } {
  if (Array.isArray(v)) return v.map(responsesInline).reduce((a, b) => ({ images: a.images + b.images, files: a.files + b.files }), { images: 0, files: 0 });
  if (!v || typeof v !== "object") return { images: 0, files: 0 };
  const o = v as any;
  const own = { images: o.type === "input_image" && typeof o.image_url === "string" && o.image_url.startsWith("data:") ? 1 : 0, files: o.type === "input_file" && (o.file_data !== undefined || (typeof o.file_url === "string" && o.file_url.startsWith("data:"))) ? 1 : 0 };
  const inner = responsesInline(Object.values(o));
  return { images: own.images + inner.images, files: own.files + inner.files };
}

// The admission bound for one inline image. An image is billed by its patches, not its bytes, so the byte bound alone can
// undercount a small file of many pixels. OpenAI's vision guide caps an image at 30,000 patches; the bound takes twice that
// in tokens, so a model's patch multiplier up to 2 stays inside it, and the settle's over_reserve flag shows any image past it.
export const RESPONSES_IMAGE_BOUND_TOKENS = 60_000;

/** The tokens a Responses body's inline images add to its byte bound. */
export const responsesImageBound = (body: any) => responsesInline([body?.input, body?.instructions]).images * RESPONSES_IMAGE_BOUND_TOKENS;

/** The refusal a Responses body earns before it is priced, or null. */
export function responsesRefusal(body: any, model: Pick<ModelCfg, "output_cap_tokens">): { reason: string; message: string; extra: Record<string, unknown> } | null {
  const server = responsesServerTools(body);
  if (server.length) return { reason: "server_tools", message: "provider-side tools are not allowed: " + server.join(","), extra: { tools: server } };
  const unknown = unknownResponsesKeys(body);
  if (unknown.length) return { reason: "body_keys", message: "request fields are not allowed: " + unknown.join(","), extra: { keys: unknown } };
  const remote = responsesRemoteSources([body.input, body.instructions]);
  if (remote.length) return { reason: "remote_source", message: "image and file content with a url or file id is not allowed", extra: { sources: remote } };
  const inline = responsesInline([body.input, body.instructions]);
  if (inline.files) return { reason: "inline_file", message: "file content sent inline is not allowed: its tokens are not bounded by its bytes", extra: { files: inline.files } };
  const cap = model.output_cap_tokens;
  if (!Number.isSafeInteger(cap) || (cap as number) < 1) return { reason: "output_cap", message: "the model's output_cap_tokens is not set", extra: {} };
  const asked = body.max_output_tokens;
  if (asked !== undefined && !(Number.isSafeInteger(asked) && asked >= 1 && asked <= (cap as number))) return { reason: "max_output_tokens", message: "max_output_tokens must be a positive integer of at most " + cap, extra: { max_output_tokens: asked } };
  return null;
}

/** Writes the output cap the worst case needs when the body has none; returns the cap the request carries. */
export function applyOutputCap(body: any, model: Pick<ModelCfg, "output_cap_tokens">): number {
  if (body.max_output_tokens === undefined) body.max_output_tokens = model.output_cap_tokens;
  return body.max_output_tokens;
}

/** reasoning.effort as the request sent it, or null. */
export const reasoningEffort = (body: any): string | null => (typeof body?.reasoning?.effort === "string" ? body.reasoning.effort : null);

/** A Responses usage object as the proxy's Usage: fresh input, cache reads, cache writes, and output with reasoning. */
export function responsesUsage(raw: any): Usage {
  const u = emptyUsage();
  if (!raw || typeof raw !== "object") return u;
  const n = (v: unknown) => (typeof v === "number" && v > 0 ? v : 0);
  const cached = n(raw.input_tokens_details?.cached_tokens), written = n(raw.input_tokens_details?.cache_write_tokens);
  u.cache_read_input_tokens = cached;
  u.cache_creation_input_tokens = written;
  u.input_tokens = Math.max(0, n(raw.input_tokens) - cached - written);
  u.output_tokens = n(raw.output_tokens);
  return u;
}

export const hasResponsesUsage = (raw: any) => typeof raw?.input_tokens === "number" && typeof raw?.output_tokens === "number";

const TERMINAL = new Set(["response.completed", "response.incomplete", "response.failed"]);

/** Incremental SSE parser for a Responses stream, with runner/proxy.ts SseUsage's fields: usage and stopReason (the final
 *  response's status) from its terminal event, sawStart at response.created, and the first error (an error event, or a
 *  response.failed's error). */
export class ResponsesSseUsage {
  private buf = "";
  usage = emptyUsage();
  providerCost: number | null = null;
  stopReason: string | null = null;
  sawInput = false;
  sawOutput = false;
  sawStart = false;
  error: { type: string; message: string } | null = null;
  feed(text: string) {
    this.buf += text.replace(/\r\n?/g, "\n");
    let i: number;
    while ((i = this.buf.indexOf("\n\n")) >= 0) {
      const event = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          const data = JSON.parse(line.slice(5).trim());
          if (data.type === "response.created") this.sawStart = true;
          if (TERMINAL.has(data.type)) {
            const usage = data.response?.usage;
            if (hasResponsesUsage(usage)) { this.usage = responsesUsage(usage); this.sawInput = this.sawOutput = true; }
            this.stopReason = String(data.response?.status ?? data.type.slice("response.".length));
            if (data.type === "response.failed" && !this.error) this.error = { type: String(data.response?.error?.code ?? "response_failed"), message: String(data.response?.error?.message ?? "").slice(0, 300) };
          }
          if (data.type === "error" && !this.error) this.error = { type: String(data.code ?? data.error?.code ?? data.error?.type ?? "error"), message: String(data.message ?? data.error?.message ?? "").slice(0, 300) };
        } catch {}
      }
    }
  }
}

/** An error in the OpenAI shape Codex reads. */
export const responsesError = (status: number, type: string, message: string) => Response.json({ error: { message, type, code: type } }, { status });
