// Keyless tests of the Responses route on Lane B's session proxy (quick/laneb/runner/responses.ts, runner/proxy.ts), the
// route part R's Codex sessions use: the session token, the model pin, metering from a Responses stream, the output cap the
// proxy writes, the refusals, the per-request log line with the model and effort as sent, and the session cap.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BYTE_SLACK_TOKENS, startProxy, type ProxyConfig } from "../../../quick/laneb/runner/proxy.ts";
import { RESPONSES_IMAGE_BOUND_TOKENS, responsesUsage, ResponsesSseUsage } from "../../../quick/laneb/runner/responses.ts";

const dir = mkdtempSync(join(tmpdir(), "laneb-responses-"));
const KEY = "stub-openai-key-" + Math.random().toString(16).slice(2);
type Seen = { path: string; body: any; auth: string | null };
const seen: Seen[] = [];
let failNext: "error" | null = null;
const usage = { input_tokens: 1000, input_tokens_details: { cached_tokens: 600 }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 50 }, total_tokens: 1200 };
const sse = (events: object[]) => events.map((e: any) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
const upstream = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const body = await req.json();
    seen.push({ path: new URL(req.url).pathname, body, auth: req.headers.get("authorization") });
    const item = { type: "message", role: "assistant", content: [{ type: "output_text", text: "DONE" }] };
    const events = failNext === "error"
      ? [{ type: "error", code: "server_error", message: "boom" }]
      : [{ type: "response.created", response: { id: "r1" } }, { type: "response.output_item.done", item }, { type: "response.completed", response: { id: "r1", status: "completed", usage } }];
    failNext = null;
    return new Response(sse(events), { headers: { "content-type": "text/event-stream" } });
  },
});
const price = { input: 2, output: 10, cache_write_5m: 2.5, cache_write_1h: 2.5, cache_read: 0.1 };
const config: ProxyConfig = {
  routes: { openai: { base_url: "http://127.0.0.1:" + upstream.port, key_env: "OPENAI_API_KEY", auth: "bearer", count_tokens: "estimate" } },
  models: { "gpt-6.1-sol": { route: "openai", upstream_model: "gpt-6.1-sol", price_per_mtok: price, bound_bytes_per_token: 3, output_cap_tokens: 32000 } },
};
let proxy: ReturnType<typeof startProxy>;
beforeAll(() => {
  proxy = startProxy({ config, dataHost: "127.0.0.1", dataPort: 0, controlPort: 0, env: { OPENAI_API_KEY: KEY }, closeWaitMs: 300, logPath: join(dir, "requests.jsonl"), sessionsPath: join(dir, "sessions.jsonl") });
});
afterAll(async () => {
  await proxy.stop();
  upstream.stop(true);
  rmSync(dir, { recursive: true, force: true });
});
const control = () => "http://127.0.0.1:" + proxy.control.port;
const open = async (cap = 1) => (await (await fetch(control() + "/sessions", { method: "POST", body: JSON.stringify({ trial: "t-" + Math.random(), model: "gpt-6.1-sol", cap_usd: cap }) })).json()) as { id: string; token: string };
const tools = [{ type: "namespace", name: "functions", tools: [{ type: "custom", name: "exec" }, { type: "function", name: "wait" }] }];
const codexBody = (extra: Record<string, unknown> = {}) => ({ model: "gpt-6.1-sol", stream: true, store: false, include: ["reasoning.encrypted_content"], reasoning: { effort: "low", context: "all_turns" }, text: { verbosity: "low" }, tool_choice: "auto", parallel_tool_calls: false, prompt_cache_key: "k", client_metadata: { thread_id: "x" }, input: [{ type: "additional_tools", role: "developer", tools }, { type: "message", role: "user", content: [{ type: "input_text", text: "fix it" }] }], ...extra });
const send = (token: string, body: object, path = "/laneb/openai/v1/responses") => fetch("http://127.0.0.1:" + proxy.data.port + path, { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(body) });
const logLines = () => readFileSync(join(dir, "requests.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

describe("the Responses route on Lane B's session proxy", () => {
  test("a Codex request is forwarded to /v1/responses with the route's key, its output capped, and metered from response.completed", async () => {
    const s = await open();
    const res = await send(s.token, codexBody());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("response.completed");
    const last = seen.at(-1)!;
    expect(last.path).toBe("/v1/responses");
    expect(last.auth).toBe("Bearer " + KEY);
    expect(last.body.max_output_tokens).toBe(32000);
    expect(last.body.reasoning.effort).toBe("low");
    const line = logLines().filter((l) => l.event === "request" && l.session === s.id).at(-1);
    expect(line).toMatchObject({ requested_model: "gpt-6.1-sol", reasoning_effort: "low", wire: "responses", status: 200, complete: true, max_tokens: 32000, before_output: true });
    // 400 fresh input at $2, 600 cached at $0.10, 200 output (reasoning included) at $10.
    expect(line.usage).toEqual({ input_tokens: 400, output_tokens: 200, cache_creation_input_tokens: 0, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 600 });
    expect(line.cost_micros).toBe(Math.ceil((400 * 2 + 600 * 0.1 + 200 * 10) / 1e6 * 1e6));
    const closed = (await (await fetch(control() + "/sessions/" + s.id + "/close", { method: "POST", body: "{}" })).json()) as any;
    expect(closed.ok_responses).toBe(1);
    expect(closed.requested_models).toEqual({ "gpt-6.1-sol": 1 });
  });

  test("the model a request names is logged as sent and replaced by the session's upstream model", async () => {
    const s = await open();
    await (await send(s.token, codexBody({ model: "gpt-6.2-sol" }))).text();
    expect(seen.at(-1)!.body.model).toBe("gpt-6.1-sol");
    expect(logLines().filter((l) => l.event === "request" && l.session === s.id).at(-1)).toMatchObject({ requested_model: "gpt-6.2-sol", upstream_model: "gpt-6.1-sol" });
  });

  test("provider-side tools, unknown fields, remote images and an output cap over the model's are refused in OpenAI's error shape", async () => {
    const s = await open();
    const before = seen.length;
    const cases: [object, string][] = [
      [codexBody({ input: [{ type: "additional_tools", role: "developer", tools: [{ type: "namespace", name: "n", tools: [{ type: "web_search" }] }] }] }), "server_tools"],
      [codexBody({ tools: [{ type: "mcp", server_url: "https://x" }] }), "server_tools"],
      [codexBody({ previous_response_id: "resp_1" }), "body_keys"],
      [codexBody({ service_tier: "priority" }), "body_keys"],
      [codexBody({ input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: "https://example.com/a.png" }] }] }), "remote_source"],
      [codexBody({ max_output_tokens: 64000 }), "max_output_tokens"],
    ];
    for (const [body, reason] of cases) {
      const res = await send(s.token, body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error.message).toContain("laneb proxy:");
      expect(logLines().filter((l) => l.event === "refused" && l.session === s.id).at(-1)).toMatchObject({ reason, wire: "responses", reasoning_effort: "low" });
    }
    expect(seen.length).toBe(before);
  });

  test("inline file content is refused, an inline image is bounded at admission, and a text request passes as before", async () => {
    const s = await open(2);
    const before = seen.length;
    const pdf = "data:application/pdf;base64,JVBERi0xLjQK";
    for (const part of [{ type: "input_file", filename: "a.pdf", file_data: pdf }, { type: "input_file", file_url: pdf }]) {
      const res = await send(s.token, codexBody({ input: [{ type: "message", role: "user", content: [part] }] }));
      expect(res.status).toBe(400);
      expect(logLines().filter((l) => l.event === "refused" && l.session === s.id).at(-1)).toMatchObject({ reason: "inline_file", wire: "responses" });
    }
    expect(seen.length).toBe(before);
    const last = () => logLines().filter((l) => l.event === "request" && l.session === s.id).at(-1);
    await (await send(s.token, codexBody())).text();
    const text = last();
    expect(text.status).toBe(200);
    expect(text.input_tokens_bound).toBe(Math.ceil(text.body_bytes / 3) + BYTE_SLACK_TOKENS);
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
    const output = [{ type: "input_image", image_url: png }];
    await (await send(s.token, codexBody({ input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: png }] }, { type: "function_call_output", call_id: "c1", output }] }))).text();
    const image = last();
    expect(image.status).toBe(200);
    expect(image.input_tokens_bound).toBe(Math.ceil(image.body_bytes / 3) + BYTE_SLACK_TOKENS + 2 * RESPONSES_IMAGE_BOUND_TOKENS);
    expect(seen.length).toBe(before + 2);
  });

  test("a request whose worst case passes the session cap is refused before it is sent", async () => {
    const s = await open(0.2);
    const res = await send(s.token, codexBody());
    expect(res.status).toBe(400);
    expect(logLines().filter((l) => l.event === "refused" && l.session === s.id).at(-1)).toMatchObject({ reason: "session_cap", max_tokens: 32000 });
  });

  test("an error event before response.created costs nothing and is not an ok response; an unknown token gets a 401", async () => {
    const s = await open();
    failNext = "error";
    await (await send(s.token, codexBody())).text();
    const line = logLines().filter((l) => l.event === "request" && l.session === s.id).at(-1);
    expect(line).toMatchObject({ sse_error: "server_error", cost_micros: 0 });
    const closed = (await (await fetch(control() + "/sessions/" + s.id + "/close", { method: "POST", body: "{}" })).json()) as any;
    expect(closed.ok_responses).toBe(0);
    expect((await send("nope", codexBody())).status).toBe(401);
  });

  test("usage mapping and the stream parser keep fresh input, cache reads, cache writes and output apart", () => {
    expect(responsesUsage({ input_tokens: 100, input_tokens_details: { cached_tokens: 30, cache_write_tokens: 20 }, output_tokens: 9 })).toEqual({ input_tokens: 50, output_tokens: 9, cache_creation_input_tokens: 20, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 30 });
    const p = new ResponsesSseUsage();
    p.feed(sse([{ type: "response.created", response: {} }]).slice(0, 20));
    p.feed(sse([{ type: "response.created", response: {} }]).slice(20) + sse([{ type: "response.incomplete", response: { status: "incomplete", usage } }]));
    expect(p.sawStart).toBe(true);
    expect(p.stopReason).toBe("incomplete");
    expect(p.usage.output_tokens).toBe(200);
    const f = new ResponsesSseUsage();
    f.feed(sse([{ type: "response.failed", response: { status: "failed", error: { code: "rate_limit_exceeded", message: "slow down" } } }]));
    expect(f.error).toEqual({ type: "rate_limit_exceeded", message: "slow down" });
  });
});
