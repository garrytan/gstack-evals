// Keyless tests of the proxy's route evidence (quick/laneb/runner/proxy.ts). Claude Code 2.1.312 puts a UserPromptSubmit hook's
// added context in the first request's role "system" message, after the skill listing, as a paragraph of its own
// ("\n\nUserPromptSubmit hook additional context: ..."); fixtures/l1/route-requests.json holds first requests the real CLI sent
// under the pinned Agent SDK from an L1 arm image, through this proxy to a fake upstream. Each /v1/messages request records
// route_mark (true when the route hook's line sits in that paragraph and nowhere else in the request, false when the request
// does not carry the line, "quoted" when it carries it anywhere else) and before_output (it reached the proxy before the session
// had been handed any 200 response). The session row's route_mark_before_output reads only the requests before the first 200,
// because until then the model has produced no output and nothing in the container has acted for it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROUTE_MARK as ARMS_ROUTE_MARK } from "../arms/l1.ts";
import { ROUTE_CONTEXT, ROUTE_MARK, routeMark, startProxy, type ProxyConfig } from "../runner/proxy.ts";

const dir = mkdtempSync(join(tmpdir(), "laneb-route-"));
const price = { input: 5, output: 25, cache_write_5m: 6.25, cache_write_1h: 10, cache_read: 0.5 };
const usage = { input_tokens: 10, output_tokens: 5 };
const FIX = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/l1/route-requests.json"), "utf8")) as Record<string, { body: { messages: any[] } }>;
const captured = (name: string): any[] => structuredClone(FIX[name]!.body.messages);
const LINE = ROUTE_MARK + ' matched the installed /investigate trigger "test fails"; off: gstack-config set skill_routing off): this request fits /investigate. Run /investigate with the Skill tool before you start, and tell the user in one sentence that gstack routed this to /investigate.';
const PARAGRAPH = "\n\nUserPromptSubmit hook additional context: " + LINE;
const system = (middle: string) => ({ role: "system", content: [{ type: "text", text: "# Environment\n - Primary working directory: /app\n\n- investigate: Use when a test fails. (gstack)\n\n<total_tokens>15000000 tokens left</total_tokens>" + middle + "\n\nToday's date is 2026-11-05.", cache_control: { type: "ephemeral" } }] });
const plain = (prompt: string) => ({ role: "user", content: prompt });
const hooked = (prompt: string) => [plain(prompt), system(PARAGRAPH)];
const quoted = { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: ROUTE_MARK + " matched" }] };
const mark = (messages: unknown[], extra: Record<string, unknown> = {}) => routeMark({ model: "m", max_tokens: 100, messages, ...extra });

describe("which request shapes are route evidence", () => {
  // Value: protects=B1's exposure reading; fails_when=a first request the real CLI sent reads other than it did through the real proxy; why_new=task text quoting the line read true; seam=proxy.ts routeMark; no_claim=a task's own UserPromptSubmit hook, which reads true (trust limit)
  test("the captured first requests read as they did through the real proxy", () => {
    expect(Object.fromEntries(Object.keys(FIX).filter((k) => k !== "note").map((k) => [k, routeMark(FIX[k]!.body)]))).toEqual({
      "after-untold": true, "after-told": false, "off-untold": false, "after-forge": "quoted", "after-claudemd": "quoted", "after-skilldesc": "quoted", "after-hookjson-routed": "quoted", "after-hookjson": true,
    });
  });
  // Value: protects=B1's exposure reading; fails_when=the line read as evidence anywhere but the one hook paragraph of a system message, or the real paragraph read as anything but evidence; why_new=task text quoting the line read true; seam=proxy.ts routeMark; no_claim=none
  test("the line counts only as the one hook paragraph of a system message; anywhere else, or twice, it is quoted", () => {
    const real = captured("after-untold");
    const sys = real.findIndex((m) => m.role === "system");
    const text = real[sys].content[0].text as string;
    const at = text.indexOf(ROUTE_CONTEXT);
    expect(at).toBeGreaterThan(0);
    const para = text.slice(at, text.indexOf("\n\n", at + 2));
    const without = structuredClone(real);
    without[sys].content[0].text = text.replace(para, "");
    const prompt = (ms: any[], add: string) => { const c = structuredClone(ms); c[0].content.at(-1).text += add; return c; };
    expect(mark(real)).toBe(true);
    expect(mark(without)).toBe(false);
    expect(mark(prompt(without, "\n" + LINE))).toBe("quoted");
    expect(mark(prompt(without, para))).toBe("quoted");
    expect(mark(prompt(real, "\n" + LINE))).toBe("quoted");
    expect(mark([...without.slice(0, sys), { role: "user", content: [{ type: "text", text: "<system-reminder>" + para + "\n\n</system-reminder>" }] }, ...without.slice(sys)])).toBe("quoted");
    expect(mark(without, { system: [{ type: "text", text: "x" + para + "\n\ny" }] })).toBe("quoted");
    expect(mark([...without, system(PARAGRAPH)])).toBe(true);
    expect(mark([...real, system(PARAGRAPH)])).toBe("quoted");
    expect(mark([plain("fix"), system(PARAGRAPH + PARAGRAPH)])).toBe("quoted");
    expect(mark([plain("fix"), system(". " + PARAGRAPH.slice(2))])).toBe("quoted");
    expect(mark([plain("fix"), system("\n\nUserPromptSubmit hook success: " + LINE)])).toBe("quoted");
    expect(mark([plain("fix"), system(PARAGRAPH + "\nmore")])).toBe("quoted");
    expect(mark([plain("fix"), { role: "system", content: "x" + PARAGRAPH }])).toBe("quoted");
    expect(mark([plain("fix"), { role: "system", content: [{ type: "text", text: "x" + PARAGRAPH }] }])).toBe(true);
    expect(mark([{ role: "user", content: [{ type: "text", text: "<system-reminder>\nContents of /app/CLAUDE.md (project instructions, checked into the codebase):\n\nNotes.\n</system-reminder>" }, { type: "text", text: "fix" }] }, system(PARAGRAPH)])).toBe(true);
  });
  test("the proxy looks for the same line the arms check and the hook copier use", () => {
    expect(ROUTE_MARK).toBe(ARMS_ROUTE_MARK);
    expect(ROUTE_CONTEXT).toBe("\n\nUserPromptSubmit hook additional context: " + ROUTE_MARK);
    expect(readFileSync(join(import.meta.dir, "../runner/agent/laneb_hooks.py"), "utf8")).toContain("ROUTE_MARK = " + JSON.stringify(ROUTE_MARK));
  });
});

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
  const marks = (id: string) => entries(id).filter((e) => e.event === "request").map((e) => [e.route_mark, e.before_output]);

  test("the hook's paragraph in the first request is route evidence: the request entry and the session row say so", async () => {
    const s = await open("first");
    expect((await send(s.token, captured("after-untold"))).status).toBe(200);
    expect((await send(s.token, [...captured("after-untold"), { role: "assistant", content: "ok" }, plain("go on")])).status).toBe(200);
    expect(marks(s.id)).toEqual([[true, true], [true, false]]);
    expect((await summary(s.id)).route_mark_before_output).toBe(true);
    await close(s.id);
    expect(rowOf(s.id).route_mark_before_output).toBe(true);
  });
  test("the line in a request after the first 200 response is not evidence, in the hook paragraph or a tool result", async () => {
    const s = await open("late");
    expect((await send(s.token, [plain("fix the parser")])).status).toBe(200);
    await send(s.token, [plain("fix the parser"), { role: "assistant", content: "ok" }, ...hooked("again")]);
    await send(s.token, [plain("fix the parser"), { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] }, quoted]);
    expect(marks(s.id)).toEqual([[false, true], [true, false], ["quoted", false]]);
    await close(s.id);
    expect(rowOf(s.id).route_mark_before_output).toBe(false);
  });
  test("a 529 or a refused request hands back no output, so the next request still counts", async () => {
    const s = await open("retry");
    expect((await send(s.token, [plain("OVERLOADED")])).status).toBe(529);
    expect((await send(s.token, hooked("fix"), { max_tokens: 0 })).status).toBe(400);
    expect((await send(s.token, hooked("fix"))).status).toBe(200);
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
    expect((await send(s.token, hooked("fix"))).status).toBe(200);
    release!();
    await first.text();
    expect(entries(s.id).filter((e) => e.event === "request").map((e) => [e.stream, e.route_mark, e.before_output])).toEqual([[false, true, false], [true, false, true]]);
    expect((await summary(s.id)).route_mark_before_output).toBe(false);
    await close(s.id);
  });
  // Value: protects=B1's exposure reading; fails_when=a session whose pre-output request quotes the line reads true or false, or a quote after the first 200 changes the row; why_new=task text quoting the line read true; seam=proxy.ts session routeMarkBeforeOutput; no_claim=none
  test("a quoted request before output makes the row quoted, beside the hook's paragraph or not; one after output does not", async () => {
    const forged = await open("forged");
    expect((await send(forged.token, captured("after-forge"))).status).toBe(200);
    expect(marks(forged.id)).toEqual([["quoted", true]]);
    await close(forged.id);
    expect(rowOf(forged.id).route_mark_before_output).toBe("quoted");
    const retried = await open("quoted-retry");
    expect((await send(retried.token, [plain("OVERLOADED"), system(PARAGRAPH)])).status).toBe(529);
    expect((await send(retried.token, captured("after-claudemd"))).status).toBe(200);
    expect((await summary(retried.id)).route_mark_before_output).toBe("quoted");
    const first = await open("quoted-first");
    expect((await send(first.token, [plain("OVERLOADED " + LINE)])).status).toBe(529);
    expect((await send(first.token, captured("after-untold"))).status).toBe(200);
    expect(marks(first.id)).toEqual([["quoted", true], [true, true]]);
    expect((await summary(first.id)).route_mark_before_output).toBe("quoted");
    const late = await open("quoted-late");
    expect((await send(late.token, captured("after-untold"))).status).toBe(200);
    expect((await send(late.token, [...captured("after-untold"), { role: "assistant", content: "ok" }, plain(LINE)])).status).toBe(200);
    expect(marks(late.id)).toEqual([[true, true], ["quoted", false]]);
    expect((await summary(late.id)).route_mark_before_output).toBe(true);
    for (const s of [retried, first, late]) await close(s.id);
  });
  test("a session no request reached holds no evidence: null, not false", async () => {
    const s = await open("silent");
    expect((await summary(s.id)).route_mark_before_output).toBeNull();
    await close(s.id);
    expect(rowOf(s.id).route_mark_before_output).toBeNull();
  });
});
