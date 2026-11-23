// Copyright (c) 2026 Garry Tan. MIT License.
// Every "once more" rule of authoring on the real meter and its reply cache, with a fake upstream: the plan rewrite and
// its audit, the hint rewrite and its audit, and a rating asked once more each reach the model; the same attempt asked
// again replays from the cache; Carbon streams at its default effort with a 32,000-token cap while every other role
// keeps 16,000 and its cache key; a reply with no usage keeps its body and still stops; a rating stream that ends with an
// error event stops the run.
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { underLease } from "../../../lanes/eng-build/pipeline.ts";
import { authorCalls } from "../../../lanes/eng-planted/stages/author.ts";
import { codeOf, MATERIAL } from "../../../lanes/eng-planted/stages/cases.ts";
import { REAL } from "../../../lanes/eng-planted/stages/commands.ts";
import { takeSpend } from "../../../lanes/eng-build/spend.ts";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";

const root = mkdtempSync(join(tmpdir(), "ep-retries-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const record = join(root, "record");
const ledger = join(root, "ledger.sqlite");
recordApproval(record, { action: "init", item: "ep-authoring", cap_micros: 50_000_000, quotes: [{ words: "retry rules test on a temporary ledger", by: "ep tests", source: "tests/ep/stages/retries.test.ts" }], admission: "warn" });

const KINDS: [string, string][] = [["You are writing the plan", "writer"], ["You audit a plan", "audit"], ["Below are the commit message", "hint"], ["Below is a one-sentence hint", "hintAudit"], ["Below are a plan to implement", "rater"]];
const PLAN = "# Plan\n\n" + Array.from({ length: 250 }, () => "plan").join(" ");
const HINT = "The parser must accept the two bounds of a range in either order.";
type Seen = { who: "opus" | "sol" | "carbon"; kind: string; body: any };
type Answer = (s: Seen, n: number) => string | Response | undefined;

const defaults = (s: Seen): string => ({ writer: PLAN, audit: "CONDITION: SILENT\nCODE: SIGNATURES", hint: HINT, hintAudit: "HINT: CLEAN" })[s.kind] ?? "FORESEE: maybe";

function upstream(seen: Seen[], answer: Answer = () => undefined): typeof fetch {
  return (async (url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const prompt = String(body.messages?.[0]?.content ?? "");
    const s: Seen = { who: String(url).includes("anthropic") ? "opus" : String(body.model).includes("carbon") ? "carbon" : "sol", kind: KINDS.find(([p]) => prompt.startsWith(p))?.[1] ?? "other", body };
    seen.push(s);
    const reply = answer(s, seen.filter((x) => x.who === s.who && x.kind === s.kind).length) ?? defaults(s);
    if (reply instanceof Response) return reply;
    if (s.who === "opus") return Response.json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: reply }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    return Response.json({ id: "g", model: body.model, provider: s.who === "carbon" ? "Google" : "OpenAI", choices: [{ message: { role: "assistant", content: reply } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
  }) as unknown as typeof fetch;
}

/** One authoring pass for MATERIAL through the real authoring seam (commands.ts REAL.author) on its own lease. */
async function author(name: string, seen: Seen[], answer?: Answer, cache = join(root, name, "cache")) {
  const opts = { out: join(root, name, "out"), cacheDir: cache, fetch: upstream(seen, answer), env: { OPENAI_API_KEY: "test", ANTHROPIC_API_KEY: "test", OPENROUTER_API_KEY: "test" } };
  return underLease({ item: "ep-authoring", capUsd: 2, record, ledger }, REAL.author(opts), (call) => authorCalls(MATERIAL, call));
}
const count = (seen: Seen[], kind: string) => seen.filter((s) => s.kind === kind).length;

describe("each second ask reaches the model through the meter's cache", () => {
  test("a plan rewrite and its audit both reach the model, even when the rewrite comes back the same", async () => {
    const seen: Seen[] = [];
    const r = await author("plan", seen, (s, n) => (s.kind === "audit" && n === 1 ? "CONDITION: BUGGY\nCODE: SIGNATURES" : undefined));
    expect([count(seen, "writer"), count(seen, "audit")]).toEqual([2, 2]);
    expect(r.record.plan.drafts).toBe(2);
    expect(r.record.drop).toBeNull();
  });
  test("a hint rewrite and its audit both reach the model, even when the rewrite comes back the same", async () => {
    const seen: Seen[] = [];
    const r = await author("hint", seen, (s, n) => (s.kind === "hintAudit" && n === 1 ? "HINT: CODE" : undefined));
    expect([count(seen, "hint"), count(seen, "hintAudit")]).toEqual([2, 2]);
    expect(r.record.hint).toEqual({ drafts: 2, passed: true, reason: null });
    expect(r.record.drop).toBeNull();
  });
  test("a rating with no FORESEE line is asked once more, and the second ask reaches the model", async () => {
    const seen: Seen[] = [];
    const r = await author("rate", seen, (s, n) => (s.who === "carbon" && n === 1 ? "I would say it is foreseeable." : s.who === "carbon" ? "FORESEE: yes" : undefined));
    expect(seen.filter((s) => s.who === "carbon")).toHaveLength(2);
    expect(r.record.foresee).toEqual(["yes", "maybe"]);
  });
  test("the same attempt asked again replays from the cache, the second ask included", async () => {
    const answer: Answer = (s, n) => (s.who === "carbon" && n === 1 ? "unsure" : s.who === "carbon" ? "FORESEE: no" : undefined);
    const cache = join(root, "replay-cache");
    const first: Seen[] = [];
    const a = await author("replay1", first, answer, cache);
    expect(first.filter((s) => s.who === "carbon")).toHaveLength(2);
    const again: Seen[] = [];
    const b = await author("replay2", again, answer, cache);
    expect(again).toHaveLength(0);
    expect(b.record.foresee).toEqual(a.record.foresee);
    expect(b.record.costUsd).toBe(0);
    expect(readdirSync(cache).filter((f) => f.endsWith(".a2.json"))).toHaveLength(1);
  });
});

describe("Carbon's stream and effort, and replies that stop", () => {
  test("Carbon streams at its model's default effort with a 32,000-token cap; every other role sends 16,000, no effort and no stream", async () => {
    const seen: Seen[] = [];
    await author("effort", seen);
    expect(seen.filter((s) => s.who === "carbon").map((s) => [s.body.stream, s.body.reasoning, s.body.max_tokens])).toEqual([[true, undefined, 32_000]]);
    const others = seen.filter((s) => s.who !== "carbon");
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((s) => s.body.reasoning === undefined && s.body.output_config === undefined && s.body.stream === undefined && s.body.max_tokens === 16_000)).toBe(true);
  });
  test("every other role's reply is cached under the key it had before the Carbon cap, so its cached calls stand", async () => {
    const seen: Seen[] = [];
    const cache = join(root, "keys", "cache");
    await author("keys", seen, undefined, cache);
    const key = (route: string, body: Record<string, unknown>) => createHash("sha256").update(route + "\n" + JSON.stringify(body)).digest("hex") + ".json";
    const before = (s: Seen) => key(s.who, { model: s.body.model, max_tokens: 16_000, messages: [{ role: "user", content: s.body.messages[0].content }] });
    const others = seen.filter((s) => s.who !== "carbon");
    expect(others.length).toBe(5);
    expect(others.filter((s) => !existsSync(join(cache, before(s))))).toEqual([]);
    const carbon = seen.find((s) => s.who === "carbon")!;
    expect(existsSync(join(cache, key("carbon", { model: carbon.body.model, max_tokens: 32_000, messages: [{ role: "user", content: carbon.body.messages[0].content }], stream: true })))).toBe(true);
  });
  test("a Carbon rating cached at 16,000 tokens misses the cache at 32,000 and reaches the model", async () => {
    const first: Seen[] = [];
    await author("cap16-a", first);
    const prompt = first.find((s) => s.who === "carbon")!.body.messages[0].content;
    const cache = join(root, "cap16-b", "cache");
    mkdirSync(cache, { recursive: true });
    const at16 = createHash("sha256").update("carbon\n" + JSON.stringify({ model: "google/gemini-4-carbon", max_tokens: 16_000, messages: [{ role: "user", content: prompt }], stream: true })).digest("hex");
    writeFileSync(join(cache, at16 + ".json"), JSON.stringify({ text: "FORESEE: no", status: 200, micros: 1, unknown_micros: 0, cached: false, problem: null, served_by: "Google" }));
    const seen: Seen[] = [];
    const r = await author("cap16-b", seen, undefined, cache);
    expect(seen.filter((s) => s.who === "carbon").map((s) => s.body.messages[0].content)).toEqual([prompt]);
    expect(r.record.foresee).toEqual(["maybe", "maybe"]);
  });
  test("a rating stream that ends with an error event stops the run at the call allowance, never asking again over an empty answer", async () => {
    const seen: Seen[] = [];
    const event = { id: "gen-t", model: "google/gemini-4-carbon", provider: "Google", error: { code: 504, message: "A Timeout Occurred", metadata: { error_type: "timeout" } }, choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }] };
    const timeout = () => new Response(": OPENROUTER PROCESSING\n\ndata: " + JSON.stringify(event) + "\n\ndata: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    const thrown = await author("stream-error", seen, (s) => (s.who === "carbon" ? timeout() : undefined)).then(() => null, (e: unknown) => e);
    expect((thrown as { code?: string } | null)?.code).toBe("E_PV_STREAM_ERROR");
    expect(takeSpend(thrown)).toBe(2);
    expect(seen.filter((s) => s.who === "carbon")).toHaveLength(1);
  });
  test("a 200 with an error body and no usage keeps its body beside the cache and still stops, as a failed call", async () => {
    const seen: Seen[] = [];
    const error = { error: { code: 504, message: "A Timeout Occurred" } };
    const cache = join(root, "empty", "cache");
    expect(await codeOf(() => author("empty", seen, (s) => (s.who === "carbon" ? Response.json(error) : undefined), cache))).toBe("E_USAGE");
    const kept = readdirSync(cache).filter((f) => f.startsWith("no-usage-"));
    expect(kept).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(cache, kept[0]!), "utf8"))).toEqual(error);
  });
});
