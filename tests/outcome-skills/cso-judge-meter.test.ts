// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 7's paid transport, keyless: a temporary ledger and a stubbed upstream behind the real metering proxy. The
// probe sends one call down each judge and labeller route at its frozen model, effort and cap; OpenRouter replies served by
// anything but google-vertex stop the send; a call past the lease's room cap-stops the item; an answered request is never
// paid for twice; a missing key opens nothing.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import { loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";
import { judgeClient } from "../../lanes/outcome-skills/cso/judge/client.ts";
import { JUDGE_ITEM, openJudgeMeter, probe, PROBE_PROMPT } from "../../lanes/outcome-skills/cso/judge/meter.ts";

const p = loadCsoPrereg();
const DRY_ENV = { ANTHROPIC_API_KEY: "dry-run", OPENAI_API_KEY: "dry-run", OPENROUTER_API_KEY: "dry-run" };
const quote = { words: "cso judge meter tests on a temporary ledger", by: "cso tests", source: "tests/outcome-skills/cso-judge-meter.test.ts" };
const setup = (capUsd: number) => {
  const dir = mkdtempSync(join(tmpdir(), "cso-meter-"));
  const record = join(dir, "record");
  recordApproval(record, { action: "init", item: JUDGE_ITEM, cap_micros: capUsd * 1_000_000, quotes: [quote], admission: "warn" });
  return { dir, record, ledger: join(dir, "ledger.sqlite") };
};
const seen: { url: string; body: any }[] = [];
const upstream = (provider = "Google"): typeof fetch => (async (url: any, init?: any) => {
  const u = String(url), body = JSON.parse(String(init?.body ?? "{}"));
  seen.push({ url: u, body });
  if (u.includes("anthropic")) return Response.json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  if (u.includes("openrouter")) return Response.json({ id: "g", model: body.model, provider, choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 2 } });
  return Response.json({ id: "r", object: "response", model: "gpt-6.2-astra", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }], usage: { input_tokens: 20, input_tokens_details: { cached_tokens: 0 }, output_tokens: 2, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 22 } });
}) as typeof fetch;

describe("section 7: the metered judge transport", () => {
  test("the probe calls each distinct judge and labeller route once, at its frozen model, effort and cap, and all pass", async () => {
    const s = setup(20);
    seen.length = 0;
    const m = await openJudgeMeter({ run_id: "probe", out: join(s.dir, "out"), record: s.record, ledger: s.ledger, env: DRY_ENV, fetch: upstream() });
    const rows = await probe(p, m.transport);
    const close = await m.close();
    expect(rows.map((r) => r.role + " " + r.model)).toEqual(["judge google/gemini-4-carbon", "gold openai/gpt-6.2-astra", "gold anthropic:claude-opus-5-5", "judge openai/gpt-6.2-astra", "gold google/gemini-4-argon", "judge anthropic:claude-opus-5-5"]);
    expect(rows.every((r) => r.ok)).toBe(true);
    const carbon = seen.find((x) => x.body.model === "google/gemini-4-carbon")!;
    expect(carbon.url).toContain("openrouter.ai");
    expect(carbon.body).toMatchObject({ max_tokens: 16000, reasoning: { effort: "high" }, provider: { only: ["google-vertex"], allow_fallbacks: false, data_collection: "deny" } });
    expect(seen.find((x) => x.body.model === "gpt-6.2-astra" && x.body.max_output_tokens === 32000)!.body.input[0].content).toContain("read-only correctness review");
    expect(seen.find((x) => x.body.model === "claude-opus-5-5" && x.body.max_tokens === 16000)!.body.output_config).toEqual({ effort: "high" });
    expect(close.spent_micros).toBeGreaterThan(0);
    expect(readItem(s.record, JUDGE_ITEM).open).toBeNull();
  });
  test("an answered request is never paid for twice", async () => {
    const s = setup(20);
    seen.length = 0;
    const m = await openJudgeMeter({ run_id: "cache", out: join(s.dir, "out"), record: s.record, ledger: s.ledger, env: DRY_ENV, fetch: upstream() });
    const c = judgeClient("google/gemini-4-carbon", "judge", m.transport, { maxOutputTokens: 100, effort: "high" });
    await c.ask(PROBE_PROMPT);
    expect((await c.ask(PROBE_PROMPT)).text).toBe("OK");
    expect([seen.length, m.sent()]).toEqual([1, 1]);
    await m.close();
  });
  test("a reply OpenRouter served from another provider stops the send", async () => {
    const s = setup(20);
    const m = await openJudgeMeter({ run_id: "drift", out: join(s.dir, "out"), record: s.record, ledger: s.ledger, env: DRY_ENV, fetch: upstream("Google AI Studio") });
    await expect(judgeClient("google/gemini-4-argon", "gold", m.transport, { maxOutputTokens: 100, effort: "high" }).ask("x")).rejects.toThrow(/^E_CSO_PROVIDER_DRIFT/);
    await m.close();
  });
  test("a call whose worst case passes the lease's room cap-stops the item and sends nothing", async () => {
    const s = setup(1);
    seen.length = 0;
    const m = await openJudgeMeter({ run_id: "cap", out: join(s.dir, "out"), record: s.record, ledger: s.ledger, env: DRY_ENV, fetch: upstream() });
    await expect(judgeClient("openai/gpt-6.2-astra", "gold", m.transport, { maxOutputTokens: 32000, effort: "high" }).ask("x")).rejects.toThrow(/^E_CSO_CAP_STOP/);
    expect(seen.length).toBe(0);
    await m.close();
  });
  test("a missing provider key opens nothing", async () => {
    const s = setup(20);
    await expect(openJudgeMeter({ run_id: "nokey", out: join(s.dir, "out"), record: s.record, ledger: s.ledger, env: { ANTHROPIC_API_KEY: "x" }, fetch: upstream() })).rejects.toThrow(/^E_KEY_MISSING/);
    expect(readItem(s.record, JUDGE_ITEM).leases.length).toBe(0);
  });
});
