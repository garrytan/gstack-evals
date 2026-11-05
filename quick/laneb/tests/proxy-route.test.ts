// Keyless tests of the proxy's route evidence (quick/laneb/runner/proxy.ts): each /v1/messages request records whether its
// messages carry the route hook's line (route_mark) and whether it reached the proxy before the session had been handed any
// 200 response (before_output), and the session row carries route_mark_before_output. Only requests before the first 200
// count, because until then the model has produced no output and nothing in the container has acted for it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROUTE_MARK as ARMS_ROUTE_MARK } from "../arms/l1.ts";
import { ROUTE_MARK, startProxy, type ProxyConfig } from "../runner/proxy.ts";

const dir = mkdtempSync(join(tmpdir(), "laneb-route-"));
const price = { input: 5, output: 25, cache_write_5m: 6.25, cache_write_1h: 10, cache_read: 0.5 };
const usage = { input_tokens: 10, output_tokens: 5 };
const hooked = (prompt: string) => ({ role: "user", content: [{ type: "text", text: "<system-reminder>\n" + ROUTE_MARK + " score 1.00): investigate\n</system-reminder>" }, { type: "text", text: prompt }] });
const plain = (prompt: string) => ({ role: "user", content: prompt });
const quoted = { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: ROUTE_MARK + " matched" }] };

describe("route evidence recorded by the proxy", () => {
  let upstream: ReturnType<typeof Bun.serve>;
  let proxy: ReturnType<typeof startProxy>;
  let release: (() => void) | null = null;
  beforeAll(() => {
    upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as any;
        const text = JSON.stringify(body.messages);
        if (text.includes("OVERLOADED")) return Response.json({ type: "error", error: { type: "overloaded_error", message: "busy" } }, { status: 529 });
        if (!body.stream) return Response.json({ id: "m", type: "message", role: "assistant", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage });
        const held = new Promise<void>((r) => (release = r));
        const enc = new TextEncoder();
        const ev = (name: string, data: unknown) => enc.encode("event: " + name + "\ndata: " + JSON.stringify(data) + "\n\n");
        return new Response(new ReadableStream({
          async start(c) {
            c.enqueue(enc.encode(": ping\n\n"));
            await held;
            c.enqueue(ev("message_start", { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } }));
            c.enqueue(ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }));
            c.enqueue(ev("message_stop", { type: "message_stop" }));
            c.close();
          },
        }), { status: 200, headers: { "content-type": "text/event-stream" } });
      },
    });
    const config: ProxyConfig = { routes: { stub: { base_url: "http://127.0.0.1:" + upstream.port, key_env: "FAKE_KEY", auth: "x-api-key", count_tokens: "estimate" } }, models: { m: { route: "stub", upstream_model: "claude-opus-5-5", price_per_mtok: price } } };
    proxy = startProxy({ config, dataHost: "127.0.0.1", dataPort: 0, controlPort: 0, env: { FAKE_KEY: "fake" }, closeWaitMs: 300, logPath: join(dir, "requests.jsonl"), sessionsPath: join(dir, "sessions.jsonl") });
  });
  afterAll(async () => {
    await proxy.stop();
    upstream.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });
  const control = () => "http://127.0.0.1:" + proxy.control.port;
  const open = async (trial: string) => (await (await fetch(control() + "/sessions", { method: "POST", body: JSON.stringify({ trial, model: "m", cap_usd: 1 }) })).json()) as { id: string; token: string };
  const send = (token: string, messages: unknown[], extra: Record<string, unknown> = {}) =>
    fetch("http://127.0.0.1:" + proxy.data.port + "/v1/messages", { method: "POST", headers: { "x-api-key": token, "content-type": "application/json" }, body: JSON.stringify({ model: "m", max_tokens: 100, messages, ...extra }) });
  const summary = async (id: string) => (await (await fetch(control() + "/sessions/" + id)).json()) as any;
  const close = async (id: string) => (await (await fetch(control() + "/sessions/" + id + "/close", { method: "POST", body: "{}" })).json()) as any;
  const entries = (id: string) => readFileSync(join(dir, "requests.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.session === id);
  const rowOf = (id: string) => readFileSync(join(dir, "sessions.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((r) => r.id === id);

  test("the hook's line in the first request is route evidence: the request entry and the session row say so", async () => {
    const s = await open("first");
    expect((await send(s.token, [hooked("fix the parser")])).status).toBe(200);
    expect((await send(s.token, [hooked("fix the parser"), { role: "assistant", content: "ok" }, plain("go on")])).status).toBe(200);
    expect(entries(s.id).filter((e) => e.event === "request").map((e) => [e.route_mark, e.before_output])).toEqual([[true, true], [true, false]]);
    expect((await summary(s.id)).route_mark_before_output).toBe(true);
    await close(s.id);
    expect(rowOf(s.id).route_mark_before_output).toBe(true);
  });
  test("the line in a request after the first 200 response is not evidence, in user text or a tool result", async () => {
    const s = await open("late");
    expect((await send(s.token, [plain("fix the parser")])).status).toBe(200);
    await send(s.token, [plain("fix the parser"), { role: "assistant", content: "ok" }, hooked("again")]);
    await send(s.token, [plain("fix the parser"), { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] }, quoted]);
    expect(entries(s.id).filter((e) => e.event === "request").map((e) => [e.route_mark, e.before_output])).toEqual([[false, true], [true, false], [true, false]]);
    await close(s.id);
    expect(rowOf(s.id).route_mark_before_output).toBe(false);
  });
  test("a 529 or a refused request hands back no output, so the next request still counts", async () => {
    const s = await open("retry");
    expect((await send(s.token, [plain("OVERLOADED")])).status).toBe(529);
    expect((await send(s.token, [hooked("fix")], { max_tokens: 0 })).status).toBe(400);
    expect((await send(s.token, [hooked("fix")])).status).toBe(200);
    const es = entries(s.id);
    expect(es.find((e) => e.event === "refused")).toMatchObject({ reason: "max_tokens", route_mark: true, before_output: true });
    expect(es.filter((e) => e.event === "request").map((e) => [e.status, e.route_mark, e.before_output])).toEqual([[529, false, true], [200, true, true]]);
    expect((await summary(s.id)).route_mark_before_output).toBe(true);
    await close(s.id);
  });
  test("a streamed 200 counts as output once its headers come back, before any body byte", async () => {
    const s = await open("stream");
    const first = await send(s.token, [plain("fix")], { stream: true });
    expect(first.status).toBe(200);
    expect((await send(s.token, [hooked("fix")])).status).toBe(200);
    release!();
    await first.text();
    expect(entries(s.id).filter((e) => e.event === "request").map((e) => [e.stream, e.route_mark, e.before_output])).toEqual([[false, true, false], [true, false, true]]);
    expect((await summary(s.id)).route_mark_before_output).toBe(false);
    await close(s.id);
  });
  test("a session no request reached holds no evidence: null, not false", async () => {
    const s = await open("silent");
    expect((await summary(s.id)).route_mark_before_output).toBeNull();
    await close(s.id);
    expect(rowOf(s.id).route_mark_before_output).toBeNull();
  });
  test("the proxy looks for the same line the arms check and the hook copier use", () => {
    expect(ROUTE_MARK).toBe(ARMS_ROUTE_MARK);
    expect(readFileSync(join(import.meta.dir, "../runner/agent/laneb_hooks.py"), "utf8")).toContain("ROUTE_MARK = " + JSON.stringify(ROUTE_MARK));
  });
});
