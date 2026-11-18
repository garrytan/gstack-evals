// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the meter's provider-drift stop (pre-run change 5): only a reply that carries an answer can show which provider served it, so an empty, error or non-JSON reply with no provider is a failed call, and an answer from another provider still stops the command; fails_when=a timed-out or error reply stops a run as a provider drift, or an answer from an unpinned provider is counted.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { openWire } from "../../lanes/office-hours-rewrite/wire.ts";

const D = 1_000_000;
const KEYS = { OPENAI_API_KEY: "stub-not-a-key", ANTHROPIC_API_KEY: "stub-not-a-key", OPENROUTER_API_KEY: "stub-not-a-key" };
const usage = { prompt_tokens: 40, completion_tokens: 30, total_tokens: 70 };

async function argon(reply: () => Response) {
  const W = mkdtempSync(join(tmpdir(), "ohr-drift-"));
  const record = join(W, "record");
  recordApproval(record, { action: "init", item: "ohr-drift-test", cap_micros: 20 * D, quotes: [{ words: "drift test on a temporary ledger, not an approval", by: "tests/ohr/meter-drift.test.ts", source: "pre-run change 5" }], admission: "warn" });
  const w = await openWire({ dir: join(W, "wire"), item: "ohr-drift-test", capMicros: 20 * D, label: "ohr-drift-test", record, ledger: join(W, "ledger.sqlite"), env: KEYS, io: { out: () => {}, err: () => {} }, upstream: (async () => reply()) as unknown as typeof fetch });
  try {
    return await w.call({ model: "gemini", prompt: "Say ok.", maxTokens: 200, effort: null, label: "drift" }).then((r) => ({ r, code: null as string | null }), (e: { code?: string }) => ({ r: null, code: e.code ?? "thrown" }));
  } finally {
    await w.close("drift test");
  }
}

test("a 200 reply with no answer and no provider is a failed call, not a provider drift", async () => {
  const empty = await argon(() => Response.json({ id: "gen-1", error: { code: 524, message: "upstream timed out" }, usage }));
  expect(empty.code).toBeNull();
  expect(empty.r?.text).toBeNull();
  expect(empty.r?.problem).toBe("the reply carries no answer and names no provider");
});

test("a 200 reply that is not JSON is a failed call, not a provider drift", async () => {
  const cut = await argon(() => new Response('{"id":"gen-1","choices":[{"mess', { status: 200, headers: { "content-type": "application/json" } }));
  expect(cut.code).toBeNull();
  expect(cut.r?.problem).toBe("the reply is not JSON");
});

test("an answer served by another provider, or by an unnamed one, still stops the command", async () => {
  const answer = { choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage };
  expect((await argon(() => Response.json({ id: "gen-1", provider: "Azure", model: "google/gemini-4-argon", ...answer }))).code).toBe("E_PV_PROVIDER_DRIFT");
  expect((await argon(() => Response.json({ id: "gen-1", model: "google/gemini-4-argon", ...answer }))).code).toBe("E_PV_PROVIDER_DRIFT");
  const ok = await argon(() => Response.json({ id: "gen-1", provider: "Google", model: "google/gemini-4-argon", ...answer }));
  expect(ok.r?.text).toBe("ok");
});
