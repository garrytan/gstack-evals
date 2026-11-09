// Copyright (c) 2026 Garry Tan. MIT License.
// The decision-routing fake upstreams, driven through the real metering proxy as the dry run drives them: every provider
// answers with usage the proxy settles, cache fields included, and the fakes keep header names but no header values.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anthropicToolUse, errorReply, FakeUpstreams, sampleOf, SUBMIT_COMMAND, type FakeProvider, type FakeReply } from "../../lanes/decision-routing/fake/upstreams.ts";
import { fakeFetch } from "../../lanes/decision-routing/host/controller.ts";
import { MeteringProxy } from "../../src/runner/proxy/metering-proxy.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";

class Ledger implements ReservationLedger {
  n = 0;
  async reserve(r: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    return { ok: true, reservation: { reservation_id: "res_" + ++this.n, ...r, state: "reserved", spent_micros: null, usage: null } };
  }
  async settle(id: string, _o: CallOutcome): Promise<LedgerReply> {
    return { ok: true, reservation: { reservation_id: id } as Reservation };
  }
}

const KEYS = { ANTHROPIC_API_KEY: "sk-ant-fake-0123456789", OPENAI_API_KEY: "sk-oai-fake-0123456789", OPENROUTER_API_KEY: "sk-or-fake-0123456789", TYPESAFE_API_KEY: "ts-fake-0123456789" };
let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanup) c();
  cleanup = [];
});

function rig(script: Partial<Record<FakeProvider, FakeReply[]>> = {}) {
  const fakes = FakeUpstreams.start(script);
  const dir = mkdtempSync(join(tmpdir(), "dr-fake-"));
  const proxy = new MeteringProxy({ ledger: new Ledger(), leaseId: "l", host: "127.0.0.1", managementSocket: join(dir, "m.sock"), managementToken: "management-token-0123456789", journal: join(dir, "j.ndjson"), retry: { attempts: 1, elapsed_ms: 10_000 }, env: KEYS, fetch: fakeFetch(fakes.urls), maxOutputTokens: 32_000, allowanceCode: "DR_ALLOWANCE_STOP" });
  proxy.start();
  cleanup.push(() => {
    proxy.stop();
    fakes.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const b = proxy.bind({ cell: { run_id: "r", arm: "R", task: "t", model: "opus", trial: 1, attempt: 1 }, models: ["anthropic:claude-opus-5-5", "openai:gpt-6.1-sol", "openrouter:particle-ai/particle-1", "typesafe:jev-1.13.0"], allowance_micros: 5_000_000 });
  const call = async (path: string, body: unknown) => {
    const res = await fetch("http://127.0.0.1:" + proxy.port + "/" + b.slot + path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + b.token }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as any };
  };
  const outcomes = () => readFileSync(join(dir, "j.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((l) => l.kind === "outcome");
  return { fakes, call, outcomes };
}

describe("fake upstreams through the metering proxy", () => {
  test("Anthropic: a scripted tool call with cache reads and writes is settled from its usage, then the default submits", async () => {
    const r = rig({ anthropic: [anthropicToolUse(["ls"], { input: 50, output: 30, cache_read: 4000, cache_write: 200 })] });
    const body = { model: "claude-opus-5-5", max_tokens: 1000, messages: [{ role: "user", content: "go" }] };
    const res = await r.call("/anthropic/v1/messages", body);
    expect(res.status).toBe(200);
    expect(res.json.content[1]).toMatchObject({ type: "tool_use", name: "bash", input: { command: "ls" } });
    const second = await r.call("/anthropic/v1/messages", body);
    expect(second.json.content[1].input.command).toBe(SUBMIT_COMMAND);
    expect(r.outcomes()[0].outcome).toEqual({ kind: "spent", spent_micros: Math.ceil(50 * 4 + 4000 * 0.2 + 200 * 5 + 30 * 20), usage: { input: 50, output: 30, reasoning: 0, cache_read: 4000, cache_write: 200 } });
    expect(r.fakes.requests[0]!.authorized).toBe(true);
    expect(JSON.stringify(r.fakes.requests)).not.toContain(KEYS.ANTHROPIC_API_KEY);
  });

  test("OpenAI: the default main-model turn is a bash tool call that submits", async () => {
    const r = rig();
    const res = await r.call("/openai/v1/chat/completions", { model: "gpt-6.1-sol", max_completion_tokens: 1000, messages: [{ role: "user", content: "go" }] });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.json.choices[0].message.tool_calls[0].function.arguments)).toEqual({ command: SUBMIT_COMMAND });
    expect(r.outcomes()[0].outcome.kind).toBe("spent");
  });

  test("OpenRouter: a json_schema request gets a schema-shaped answer, and the fake sees the Particle AI pin", async () => {
    const r = rig();
    const schema = { type: "object", properties: { answer: { type: "string", enum: ["run_tests", "submit", "other"] }, confidence: { type: "number" } }, required: ["answer", "confidence"] };
    const res = await r.call("/openrouter/v1/chat/completions", { model: "particle-ai/particle-1", max_tokens: 8000, response_format: { type: "json_schema", json_schema: { name: "decision", schema } }, messages: [{ role: "user", content: "pick" }] });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.json.choices[0].message.content)).toEqual({ answer: "run_tests", confidence: 0.5 });
    expect(r.fakes.requests[0]!.body.provider).toMatchObject({ only: ["particle-ai"], allow_fallbacks: false });
    expect(r.outcomes()[0].outcome.spent_micros).toBeGreaterThan(0);
  });

  test("TypeSafe: one answer per question and input-only billing", async () => {
    const r = rig();
    const res = await r.call("/typesafe/v1/systemone", { model: "jev-1.13.0", state: "s", questions: { done: { type: "noul" }, next_step: { type: "choice", criteria: { run_tests: "a", submit: "b" } } } });
    expect(res.status).toBe(200);
    expect(res.json.answers).toEqual({ done: { type: "noul", noul: 0.5 }, next_step: { type: "choice", choice: "run_tests", confidence: 0.5, probabilities: { run_tests: 0.5, submit: 0.5 } } });
    const o = r.outcomes()[0].outcome;
    expect(o.usage.output).toBe(10);
    expect(o.spent_micros).toBe(Math.ceil(o.usage.input * 0.042));
  });

  test("a scripted 500 reaches the proxy's retry owner, and the control routes queue and list", async () => {
    const r = rig();
    await fetch(r.fakes.urls.openai + "/__script", { method: "POST", body: JSON.stringify([errorReply(500)]) });
    const res = await r.call("/openai/v1/chat/completions", { model: "gpt-6.1-sol", max_completion_tokens: 100, messages: [{ role: "user", content: "go" }] });
    expect(res.status).toBe(502);
    expect(res.json.code).toBe("UPSTREAM");
    expect((await (await fetch(r.fakes.urls.openai + "/__requests")).json()) as unknown[]).toHaveLength(1);
  });

  test("sampleOf fills nested schemas", () => {
    expect(sampleOf({ type: "object", properties: { answers: { type: "array", items: { type: "object", properties: { hit: { type: "string" }, answer: { enum: ["yes", "no"] } } } } } })).toEqual({ answers: [{ hit: "", answer: "yes" }] });
  });
});
