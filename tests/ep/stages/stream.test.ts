// Copyright (c) 2026 Garry Tan. MIT License.
// Gemini 4 Carbon streams (the Captain's ruling S, 2026-11-17), on the real meter with a fake upstream: a stream adds up
// to the same text, provider and cost as the same reply sent whole; a stream with no usage chunk, or one from a provider
// other than Google, still stops as provider drift; a stream that ends with an error event, like the 504 that cut the
// whole replies, stops and is never read as an empty answer. The streams follow OpenRouter's documented chat-completions
// shape (https://openrouter.ai/docs/api_reference/streaming): keep-alive comments, then the usage chunk before [DONE].
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codeOf } from "../../../lanes/eng-planted/stages/cases.ts";
import { assembleStream, openMeter, type CallResult } from "../../../lanes/product-value/meter.ts";
import { judgeAnswer } from "../../../src/adapters/judge.ts";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";

const root = mkdtempSync(join(tmpdir(), "ep-stream-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const record = join(root, "record");
const ledger = join(root, "ledger.sqlite");
recordApproval(record, { action: "init", item: "ep-authoring", cap_micros: 50_000_000, quotes: [{ words: "stream test on a temporary ledger", by: "ep tests", source: "tests/ep/stages/stream.test.ts" }], admission: "warn" });

const ANSWER = "FORESEE: yes";
const USAGE = { prompt_tokens: 1200, completion_tokens: 900, total_tokens: 2100, completion_tokens_details: { reasoning_tokens: 880 } };
const WHOLE = { id: "gen-1", object: "chat.completion", created: 1, model: "google/gemini-4-carbon", provider: "Google", choices: [{ index: 0, message: { role: "assistant", content: ANSWER }, finish_reason: "stop", native_finish_reason: "STOP" }], usage: USAGE };
const chunk = (choice: Record<string, unknown>, more: Record<string, unknown> = {}) => "data: " + JSON.stringify({ id: "gen-1", object: "chat.completion.chunk", created: 1, model: "google/gemini-4-carbon", provider: "Google", choices: [{ index: 0, ...choice }], ...more });
const KEEPALIVE = ": OPENROUTER PROCESSING";
const THINKING = chunk({ delta: { role: "assistant", content: "", reasoning: "Weighing the plan against the change." }, finish_reason: null });
const ANSWERED = [chunk({ delta: { role: "assistant", content: "FORESEE" }, finish_reason: null }), chunk({ delta: { role: "assistant", content: ": yes" }, finish_reason: "stop", native_finish_reason: "STOP" })];
const USAGE_CHUNK = chunk({ delta: { role: "assistant", content: "" }, finish_reason: "stop", native_finish_reason: "STOP" }, { usage: USAGE });
const STREAM = [KEEPALIVE, THINKING, KEEPALIVE, ...ANSWERED, USAGE_CHUNK, "data: [DONE]"];
/** The error the cut whole replies carried, sent as a mid-stream error event. */
const TIMEOUT = chunk({ delta: { content: "" }, finish_reason: "error" }, { error: { code: 504, message: "A Timeout Occurred", metadata: { error_type: "timeout" } } });

const body = (lines: string[]) => lines.join("\n\n") + "\n\n";
const sse = (lines: string[]) => new Response(body(lines), { headers: { "content-type": "text/event-stream" } });

/** One Carbon call through its own meter, lease and cache: the result or the stop's code, the request bodies the upstream
 * saw, and the files left beside the cache. */
async function carbon(name: string, reply: () => Response) {
  const seen: any[] = [];
  const cacheDir = join(root, name, "cache");
  const fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    seen.push(JSON.parse(String(init?.body ?? "{}")));
    return reply();
  }) as unknown as typeof globalThis.fetch;
  const meter = await openMeter({ item: "ep-authoring", runId: "ep-stream-test", out: join(root, name, "out"), cacheDir, maxOutputTokens: 16_000, amountMicros: 4_000_000, record, ledger, env: { OPENROUTER_API_KEY: "test" }, fetch });
  let result: CallResult | null = null;
  const code = await codeOf(async () => {
    result = await meter.call({ model: "carbon", prompt: "Below are a plan to implement", maxTokens: 16_000, label: "t" });
  });
  await meter.close();
  const files = readdirSync(cacheDir);
  return { result: result as CallResult | null, code, seen, cacheDir, files, cached: files.filter((f) => f.endsWith(".json")) };
}

describe("a Carbon stream adds up to the reply sent whole", () => {
  test("its text, provider and usage match the whole reply, and the meter returns the same text, provider and cost", async () => {
    const a = assembleStream(body(STREAM))!;
    expect([judgeAnswer("openrouter", a), a.provider, a.usage, a.error]).toEqual([judgeAnswer("openrouter", WHOLE), WHOLE.provider, WHOLE.usage, undefined]);
    const streamed = await carbon("streamed", () => sse(STREAM));
    const whole = await carbon("whole", () => Response.json(WHOLE));
    const pick = (r: CallResult | null) => r && { text: r.text, served_by: r.served_by, micros: r.micros, unknown_micros: r.unknown_micros, status: r.status };
    expect([streamed.code, whole.code]).toEqual(["no refusal", "no refusal"]);
    expect(pick(streamed.result)).toEqual(pick(whole.result));
    expect(streamed.result!.text).toBe(ANSWER);
    expect(streamed.result!.micros).toBeGreaterThan(0);
    expect(streamed.cached).toHaveLength(1);
  });
  test("every Carbon call asks for a stream that ends with its usage", async () => {
    const r = await carbon("asked", () => sse(STREAM));
    expect(r.seen.map((b) => [b.stream, b.stream_options])).toEqual([[true, { include_usage: true }]]);
  });
});

describe("a Carbon stream that cannot be read as an answer stops", () => {
  test("a stream with no usage chunk stops as provider drift and keeps its body", async () => {
    const lines = [KEEPALIVE, THINKING, ...ANSWERED, "data: [DONE]"];
    const r = await carbon("no-usage", () => sse(lines));
    expect(r.code).toBe("E_PV_PROVIDER_DRIFT");
    const kept = r.files.filter((f) => f.startsWith("no-usage-"));
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(r.cacheDir, kept[0]!), "utf8")).toBe(body(lines));
    expect(r.cached).toEqual([]);
  });
  test("a stream from a provider other than Google stops as provider drift", async () => {
    const r = await carbon("other", () => sse(STREAM.map((l) => l.replace('"provider":"Google"', '"provider":"Other Cloud"'))));
    expect(r.code).toBe("E_PV_PROVIDER_DRIFT");
    expect(r.cached).toEqual([]);
  });
  test("a stream that ends with the 504 error event stops, is never an empty answer, and keeps its body", async () => {
    const lines = [KEEPALIVE, THINKING, KEEPALIVE, TIMEOUT, "data: [DONE]"];
    const r = await carbon("timeout", () => sse(lines));
    expect(r.code).toBe("E_PV_STREAM_ERROR");
    expect(r.result).toBeNull();
    const kept = r.files.filter((f) => f.startsWith("no-usage-"));
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(r.cacheDir, kept[0]!), "utf8")).toBe(body(lines));
    expect(r.cached).toEqual([]);
  });
  test("an error event after part of the answer stops even when the stream ends with its usage", async () => {
    const lines = [THINKING, ANSWERED[0]!, TIMEOUT, USAGE_CHUNK, "data: [DONE]"];
    const r = await carbon("partial", () => sse(lines));
    expect(r.code).toBe("E_PV_STREAM_ERROR");
    const kept = r.files.filter((f) => f.startsWith("stream-error-"));
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(r.cacheDir, kept[0]!), "utf8")).toBe(body(lines));
    expect(r.cached).toEqual([]);
  });
});
