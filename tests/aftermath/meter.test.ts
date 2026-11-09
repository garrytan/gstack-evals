// Copyright (c) 2026 Garry Tan. MIT License.
// The shared metered client's per-model stop (lanes/aftermath/meter.ts, GST-2016): with onDrift stop-model, a drifted
// model stops on its lease while every other model keeps calling on the same open lease; stop() does the same for a
// subject, after its in-flight calls settle. With onDrift throw (product-value) nothing is recorded on the lease.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeterError, openMeter } from "../../lanes/aftermath/meter.ts";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { readItem } from "../../src/runner/ledger/record.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ENV = { ANTHROPIC_API_KEY: "dry-run", OPENAI_API_KEY: "dry-run", OPENROUTER_API_KEY: "dry-run" };

/** Anthropic answers as Opus; OpenRouter answers name the provider the test sets for each model id. */
function upstream(providers: Record<string, string>): typeof fetch {
  return (async (url: any, init?: any) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (String(url).includes("anthropic")) return Response.json({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5-20260922", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } });
    return Response.json({ id: "gen-1", model: body.model, provider: providers[body.model] ?? "OpenAI", choices: [{ message: { role: "assistant", content: "ok" } }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
  }) as typeof fetch;
}

async function setup(onDrift: "throw" | "stop-model", providers: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "aftermath-meter-"));
  dirs.push(dir);
  const record = join(dir, "record"), ledger = join(dir, "ledger.sqlite");
  recordApproval(record, { action: "init", item: "dx-judges", cap_micros: 50_000_000, quotes: [{ words: "test", by: "test", source: "test" }], admission: "warn" });
  const meter = await openMeter({ item: "dx-judges", runId: "dx-judges-s1", out: join(dir, "out"), cacheDir: join(dir, "cache"), maxOutputTokens: 4000, record, ledger, env: ENV, fetch: upstream(providers), driftCode: onDrift === "throw" ? "E_PV_PROVIDER_DRIFT" : "E_DX_PROVIDER_DRIFT", onDrift, arm: onDrift === "throw" ? "pv" : "dx" });
  return { meter, record, ledger };
}

describe("the metered client's per-model stop", () => {
  test("stop-model: a drifted model stops on the lease, and another model keeps calling on the same open lease", async () => {
    const { meter, record, ledger } = await setup("stop-model", { "openai/gpt-6.1-sol": "Azure" });
    await expect(meter.call({ model: "sol", prompt: "a", maxTokens: 100, label: "s1" })).rejects.toMatchObject({ code: "E_DX_PROVIDER_DRIFT" });
    await expect(meter.call({ model: "sol", prompt: "b", maxTokens: 100, label: "s2" })).rejects.toBeInstanceOf(MeterError);
    const opus = await meter.call({ model: "opus", prompt: "c", maxTokens: 100, label: "o1" });
    expect(opus.text).toBe("ok");
    expect(meter.stopped().map((s) => [s.field, s.value, s.code])).toEqual([["model", "openai/gpt-6.1-sol", "E_DX_PROVIDER_DRIFT"]]);
    expect(readItem(record, "dx-judges").open?.lease_id).toBe(meter.leaseId);
    const local = openLocalLedger({ path: ledger, rule: "test" });
    try {
      expect(local.getLease(meter.leaseId)!.state).toBe("open");
    } finally {
      local.close();
    }
    await meter.close();
  });

  test("stop(subject): later calls for that subject are refused after its in-flight call settles; other subjects go on", async () => {
    const { meter } = await setup("stop-model", {});
    expect((await meter.call({ model: "opus", prompt: "d", maxTokens: 100, label: "sol-list", subject: "sol" })).text).toBe("ok");
    const racing = meter.call({ model: "opus", prompt: "d2", maxTokens: 100, label: "sol-list-race", subject: "sol" });
    const figures = await meter.stop({ subject: "sol" }, "E_DX_JUDGE_KAPPA", "the judge of sol lists failed its check");
    const raced = await racing;
    expect(raced.text === "ok" || (raced.status === 402 && raced.micros === null)).toBe(true);
    expect(figures.unknown_calls).toBe(0);
    expect(figures.settled_calls).toBe(raced.text === "ok" ? 2 : 1);
    await expect(meter.call({ model: "opus", prompt: "e", maxTokens: 100, label: "sol-list-2", subject: "sol" })).rejects.toMatchObject({ code: "E_DX_JUDGE_KAPPA" });
    expect((await meter.call({ model: "opus", prompt: "f", maxTokens: 100, label: "opus-list", subject: "opus" })).text).toBe("ok");
    const close = await meter.close();
    expect(close.unknown_micros).toBe(0);
  });

  test("throw (product-value): drift throws and records no scope stop", async () => {
    const { meter } = await setup("throw", { "openai/gpt-6.1-sol": "Azure" });
    await expect(meter.call({ model: "sol", prompt: "g", maxTokens: 100, label: "s" })).rejects.toMatchObject({ code: "E_PV_PROVIDER_DRIFT" });
    expect(meter.stopped()).toEqual([]);
    await meter.close();
  });
});
