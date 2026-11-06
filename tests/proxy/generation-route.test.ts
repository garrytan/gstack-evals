// Copyright (c) 2026 Garry Tan. MIT License.
// The metering proxy's free OpenRouter generation route: GET /v1/generation with one id query, journaled, never reserved.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { MeteringProxy } from "../../src/runner/proxy/metering-proxy.ts";

const KEY = "sk-or-v1-fake-key-for-generation-route";
let dirs: string[] = [];
let proxies: MeteringProxy[] = [];
afterEach(() => {
  for (const p of proxies.splice(0)) p.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "gen-route-"));
  dirs.push(dir);
  const ledger = LocalLedger.open(join(dir, "ledger.sqlite"));
  ledger.addLease({ schema: 1, kind: "lease", item: "gen", seq: 1, lease_id: "gen.0001.abcdef", run_id: "r1", machine_id: "m1", reserved_micros: 10_000_000, expires_at: new Date(Date.now() + 3_600_000).toISOString(), created_at: new Date().toISOString() });
  const calls: Array<{ url: string; method: string; auth: string | null }> = [];
  const journal = join(dir, "journal.ndjson");
  const proxy = new MeteringProxy({ ledger, leaseId: "gen.0001.abcdef", host: "127.0.0.1", managementSocket: join(dir, "m.sock"), managementToken: "management-token-0123456789abcdef", journal, retry: { attempts: 1, elapsed_ms: 900_000 }, env: { OPENROUTER_API_KEY: KEY, ANTHROPIC_API_KEY: "fake-anthropic" }, fetch: async (url, init) => (calls.push({ url, method: init.method ?? "GET", auth: new Headers(init.headers).get("authorization") }), Response.json({ data: { id: "gen-1", total_cost: 0 } })) });
  proxy.start();
  proxies.push(proxy);
  const b = proxy.bind({ cell: { run_id: "r1", arm: "tbv", task: "label", model: "openrouter:openai/gpt-6.1-sol", trial: 1, attempt: 1 }, models: ["openrouter:openai/gpt-6.1-sol"], allowance_micros: 1 });
  const at = (provider: string, path: string, method = "GET") => fetch("http://127.0.0.1:" + proxy.port + "/" + b.slot + "/" + provider + path, { method, headers: { authorization: "Bearer " + b.token, "content-type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) });
  const lines = () => readFileSync(journal, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { ledger, calls, at, lines, dir };
}

describe("GET /v1/generation on OpenRouter", () => {
  test("is forwarded with the proxy's key, journaled as free, and reserves nothing", async () => {
    const t = setup();
    const res = await t.at("openrouter", "/v1/generation?id=gen-1");
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.total_cost).toBe(0);
    expect(t.calls).toEqual([{ url: "https://openrouter.ai/api/v1/generation?id=gen-1", method: "GET", auth: "Bearer " + KEY }]);
    const free = t.lines().filter((l) => l.kind === "free");
    expect(free.length).toBe(1);
    expect(free[0]).toMatchObject({ provider: "openrouter", route: "/v1/generation", status: 200 });
    expect(t.lines().some((l) => l.kind === "reserve")).toBe(false);
    expect(t.ledger.held("gen.0001.abcdef")).toBe(0);
  });

  test("a POST, a path variant, a missing or extra query, and another provider are refused with E_ALLOWANCE", async () => {
    const t = setup();
    for (const [provider, path, method] of [
      ["openrouter", "/v1/generation?id=gen-1", "POST"],
      ["openrouter", "/v1/generation/gen-1", "GET"],
      ["openrouter", "/v1/generations?id=gen-1", "GET"],
      ["openrouter", "/v1/generation", "GET"],
      ["openrouter", "/v1/generation?id=gen-1&x=2", "GET"],
      ["openrouter", "/v1/generation?ids=gen-1", "GET"],
      ["anthropic", "/v1/generation?id=gen-1", "GET"],
    ] as const) {
      const res = await t.at(provider, path, method);
      expect(res.status).toBe(403);
      expect(((await res.json()) as any).code).toBe("E_ALLOWANCE");
    }
    expect(t.calls.length).toBe(0);
    expect(t.lines().filter((l) => l.kind === "refusal" && l.code === "E_ALLOWANCE").length).toBe(7);
  });
});
