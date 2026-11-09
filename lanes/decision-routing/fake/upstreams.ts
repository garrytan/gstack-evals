// Copyright (c) 2026 Garry Tan. MIT License.
// Scriptable fake upstreams for the decision-routing dry run: one Bun server per provider, each serving the routes the
// metering proxy forwards to (Anthropic Messages, OpenAI chat completions and Responses, OpenRouter chat completions,
// TypeSafe System One). Each server answers from its queue of scripted replies, then from a default derived from the
// request: a bash tool call that submits for a main-model turn (a function_call output item on the Responses route), a
// schema-shaped JSON answer for a json_schema request, and one answer per question for System One. Every reply carries usage, with cache fields where the provider reports them. Requests are recorded with their
// header names only, never header values.
//
// Control routes on every server: POST /__script appends replies (a JSON array), GET /__requests lists what it served.
// CLI: bun lanes/decision-routing/fake/upstreams.ts [--script <file.json>] [--host 127.0.0.1] [--out <urls.json>]
// prints {"anthropic": url, "openai": url, "openrouter": url, "typesafe": url} and runs until killed. The controller's
// --fake-upstreams takes that file.

import { readFileSync, writeFileSync } from "node:fs";

export const FAKE_PROVIDERS = ["anthropic", "openai", "openrouter", "typesafe"] as const;
export type FakeProvider = (typeof FAKE_PROVIDERS)[number];

const ROUTES: Record<FakeProvider, string[]> = { anthropic: ["/v1/messages"], openai: ["/v1/chat/completions", "/v1/responses"], openrouter: ["/v1/chat/completions"], typesafe: ["/v1/systemone"] };
/** mini-swe-agent ends a session when a command's output starts with this line. */
export const SUBMIT_COMMAND = "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT";

export interface FakeUsage {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  reasoning?: number;
}

export interface FakeReply {
  status?: number;
  json?: unknown;
  /** Server-sent events, one data line each. */
  sse?: unknown[];
  delay_ms?: number;
}

export interface FakeRequest {
  provider: FakeProvider;
  method: string;
  path: string;
  header_names: string[];
  authorized: boolean;
  body: any;
}

let ids = 0;
const nextId = (prefix: string) => prefix + "_" + String(++ids).padStart(6, "0");

export const anthropicUsage = (u: FakeUsage = {}) => ({ input_tokens: u.input ?? 100, output_tokens: u.output ?? 20, cache_read_input_tokens: u.cache_read ?? 0, cache_creation_input_tokens: u.cache_write ?? 0 });

/** OpenAI-shaped usage: cache reads inside prompt_tokens, reasoning inside completion_tokens. */
export const openaiUsage = (u: FakeUsage = {}) => {
  const input = u.input ?? 100;
  const cached = u.cache_read ?? 0;
  const output = u.output ?? 20;
  const reasoning = u.reasoning ?? 0;
  return { prompt_tokens: input + cached + (u.cache_write ?? 0), completion_tokens: output + reasoning, total_tokens: input + cached + (u.cache_write ?? 0) + output + reasoning, prompt_tokens_details: { cached_tokens: cached, cache_write_tokens: u.cache_write ?? 0 }, completion_tokens_details: { reasoning_tokens: reasoning } };
};

export function anthropicToolUse(commands: string[], usage?: FakeUsage, text = "I will run a command."): FakeReply {
  return { json: { id: nextId("msg"), type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }, ...commands.map((command) => ({ type: "tool_use", id: nextId("toolu"), name: "bash", input: { command } }))], stop_reason: "tool_use", stop_sequence: null, usage: anthropicUsage(usage) } };
}

export function anthropicText(text: string, usage?: FakeUsage): FakeReply {
  return { json: { id: nextId("msg"), type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: anthropicUsage(usage) } };
}

const chat = (model: string, message: Record<string, unknown>, finish: string, usage?: FakeUsage, extra: Record<string, unknown> = {}): FakeReply => ({
  json: { id: nextId("chatcmpl"), object: "chat.completion", created: 1_762_000_000, model, choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finish }], usage: { ...openaiUsage(usage), ...extra } },
});

export function openaiToolCalls(commands: string[], usage?: FakeUsage, model = "gpt-6.1-sol"): FakeReply {
  return chat(model, { content: null, tool_calls: commands.map((command) => ({ id: nextId("call"), type: "function", function: { name: "bash", arguments: JSON.stringify({ command }) } })) }, "tool_calls", usage);
}

/** Responses-shaped usage: cache reads inside input_tokens, reasoning inside output_tokens. */
export const openaiResponsesUsage = (u: FakeUsage = {}) => {
  const c = openaiUsage(u);
  return { input_tokens: c.prompt_tokens, input_tokens_details: c.prompt_tokens_details, output_tokens: c.completion_tokens, output_tokens_details: c.completion_tokens_details, total_tokens: c.total_tokens };
};

const response = (model: string, output: unknown[], usage?: FakeUsage): FakeReply => ({
  json: { id: nextId("resp"), object: "response", created_at: 1_762_000_000, status: "completed", model, output, usage: openaiResponsesUsage(usage) },
});

/** A Responses main-model turn: a reasoning item, then one function_call item per command. */
export function openaiResponsesToolCalls(commands: string[], usage?: FakeUsage, model = "gpt-6.1-sol"): FakeReply {
  const calls = commands.map((command) => ({ type: "function_call", id: nextId("fc"), call_id: nextId("call"), name: "bash", arguments: JSON.stringify({ command }), status: "completed" }));
  return response(model, [{ type: "reasoning", id: nextId("rs"), summary: [] }, ...calls], usage);
}

/** A Responses turn with only a text message. */
export function openaiResponsesText(text: string, usage?: FakeUsage, model = "gpt-6.1-sol"): FakeReply {
  return response(model, [{ type: "message", id: nextId("msg"), role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }], usage);
}

/** A structured reply: the object as the message content, as a json_schema response_format returns it. */
export function openaiJson(answer: unknown, usage?: FakeUsage, model = "gpt-6.1-sol"): FakeReply {
  return chat(model, { content: JSON.stringify(answer) }, "stop", usage);
}

/** particle-1 through OpenRouter: the chat shape plus OpenRouter's usage.cost, priced at today's $0.05 in and $0.50 out. */
export function openrouterJson(answer: unknown, usage?: FakeUsage): FakeReply {
  const u = openaiUsage(usage);
  return chat("particle-ai/particle-1", { content: JSON.stringify(answer) }, "stop", usage, { cost: ((u.prompt_tokens - (usage?.cache_read ?? 0)) * 0.05 + (usage?.cache_read ?? 0) * 0.003 + u.completion_tokens * 0.5) / 1e6 });
}

export function typesafeAnswers(answers: Record<string, unknown>, usage?: FakeUsage, model = "jev-1.13.0"): FakeReply {
  return { json: { model, answers, usage: { input_tokens: usage?.input ?? 100, output_tokens: usage?.output ?? 0 } } };
}

export const errorReply = (status: number, message = "fake upstream error"): FakeReply => ({ status, json: { error: { type: "fake_error", code: status, message } } });

/** A value matching a JSON schema's shape: the first enum value, 0.5 for numbers, and each required property filled. */
export function sampleOf(schema: any): unknown {
  if (!schema || typeof schema !== "object") return null;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "object" || schema.properties) return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, v]) => [k, sampleOf(v)]));
  if (type === "array") return schema.items ? [sampleOf(schema.items)] : [];
  if (type === "number" || type === "integer") return 0.5;
  if (type === "boolean") return true;
  return "";
}

/** The reply a provider gives when nothing is scripted. */
export function defaultReply(provider: FakeProvider, body: any, path = ROUTES[provider][0]): FakeReply {
  const usage = { input: Math.ceil(JSON.stringify(body ?? {}).length / 4), output: 10 };
  if (path === "/v1/responses") return openaiResponsesToolCalls([SUBMIT_COMMAND], usage, body?.model);
  if (provider === "typesafe") {
    const answers = Object.fromEntries(
      Object.entries((body?.questions ?? {}) as Record<string, any>).map(([name, q]) => {
        if (q?.type !== "choice") return [name, { type: "noul", noul: 0.5 }];
        const options = Object.keys(q.criteria ?? {});
        return [name, { type: "choice", choice: options[0] ?? "", confidence: options.length ? 1 / options.length : 0, probabilities: Object.fromEntries(options.map((o) => [o, 1 / options.length])) }];
      }),
    );
    return typesafeAnswers(answers, usage, body?.model);
  }
  const schema = body?.response_format?.json_schema?.schema;
  if (provider === "anthropic") return anthropicToolUse([SUBMIT_COMMAND], usage);
  if (schema) return provider === "openrouter" ? openrouterJson(sampleOf(schema), usage) : openaiJson(sampleOf(schema), usage, body?.model);
  return openaiToolCalls([SUBMIT_COMMAND], usage, body?.model);
}

export class FakeUpstreams {
  readonly urls = {} as Record<FakeProvider, string>;
  readonly requests: FakeRequest[] = [];
  private queues = Object.fromEntries(FAKE_PROVIDERS.map((p) => [p, [] as FakeReply[]])) as Record<FakeProvider, FakeReply[]>;
  private servers: Array<ReturnType<typeof Bun.serve>> = [];

  static start(script: Partial<Record<FakeProvider, FakeReply[]>> = {}, hostname = "127.0.0.1"): FakeUpstreams {
    const f = new FakeUpstreams();
    for (const p of FAKE_PROVIDERS) {
      f.push(p, ...(script[p] ?? []));
      const server = Bun.serve({ hostname, port: 0, fetch: (req) => f.handle(p, req) });
      f.servers.push(server);
      f.urls[p] = "http://" + hostname + ":" + server.port;
    }
    return f;
  }

  push(provider: FakeProvider, ...replies: FakeReply[]): void {
    this.queues[provider].push(...replies);
  }

  stop(): void {
    for (const s of this.servers) s.stop(true);
  }

  private async handle(provider: FakeProvider, req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/__requests") return Response.json(this.requests.filter((r) => r.provider === provider));
    if (req.method === "POST" && path === "/__script") {
      const replies = (await req.json()) as FakeReply[];
      this.push(provider, ...replies);
      return Response.json({ queued: this.queues[provider].length });
    }
    let body: any = null;
    try {
      body = await req.json();
    } catch {}
    const names = [...req.headers.keys()];
    this.requests.push({ provider, method: req.method, path, header_names: names, authorized: provider === "anthropic" ? req.headers.has("x-api-key") : /^Bearer \S+/.test(req.headers.get("authorization") ?? ""), body });
    if (req.method !== "POST" || !ROUTES[provider].includes(path)) return Response.json({ error: { type: "not_found", message: "fake " + provider + " serves POST " + ROUTES[provider].join(" and ") } }, { status: 404 });
    const reply = this.queues[provider].shift() ?? defaultReply(provider, body, path);
    if (reply.delay_ms) await Bun.sleep(reply.delay_ms);
    if (reply.sse) return new Response(reply.sse.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("") + "data: [DONE]\n\n", { status: reply.status ?? 200, headers: { "content-type": "text/event-stream" } });
    return Response.json(reply.json ?? {}, { status: reply.status ?? 200 });
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const scriptFile = flag("--script");
  const fakes = FakeUpstreams.start(scriptFile ? JSON.parse(readFileSync(scriptFile, "utf8")) : {}, flag("--host") ?? "127.0.0.1");
  const out = flag("--out");
  if (out) writeFileSync(out, JSON.stringify(fakes.urls) + "\n");
  console.log(JSON.stringify(fakes.urls));
}
