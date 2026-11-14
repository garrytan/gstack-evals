// Keyless test of the Lane B session proxy's route pinning (quick/laneb/runner/proxy.ts), for the harness mechanics judge
// key deviation (D9): a judge item's part VM holds TYPESAFE and OPENROUTER beside its route key in ~/.laneb-keys, which the
// session proxy reads too. A session is pinned at open to its model, and the proxy takes the route and its key from that
// model alone: it rewrites any model a request names to the session's upstream model and sends it to the session's route.
// No request field, model name or path picks a route, so another provider's key in the proxy's env is never sent.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startProxy, type ProxyConfig } from "../runner/proxy.ts";

type Seen = { path: string; model: string; headers: Record<string, string> };
const price = { input: 5, output: 25, cache_write_5m: 6.25, cache_write_1h: 10, cache_read: 0.5 };
const dir = mkdtempSync(join(tmpdir(), "laneb-pin-"));
const KEYS = { ANTHROPIC_API_KEY: "stub-anthropic-" + randomBytes(8).toString("hex"), OPENROUTER_API_KEY: "stub-openrouter-" + randomBytes(8).toString("hex"), TYPESAFE_API_KEY: "stub-typesafe-" + randomBytes(8).toString("hex") };
const seen: Record<"anthropic" | "openrouter", Seen[]> = { anthropic: [], openrouter: [] };
const fake = (name: "anthropic" | "openrouter") => Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const body = (await req.json()) as { model?: string };
    seen[name].push({ path: new URL(req.url).pathname, model: String(body.model), headers: Object.fromEntries(req.headers) });
    return Response.json({ id: "m", type: "message", role: "assistant", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } });
  },
});
let a: ReturnType<typeof fake>, o: ReturnType<typeof fake>, proxy: ReturnType<typeof startProxy>;

beforeAll(() => {
  a = fake("anthropic");
  o = fake("openrouter");
  const config: ProxyConfig = {
    routes: {
      anthropic: { base_url: "http://127.0.0.1:" + a.port, key_env: "ANTHROPIC_API_KEY", auth: "x-api-key", count_tokens: "estimate" },
      openrouter: { base_url: "http://127.0.0.1:" + o.port + "/api", key_env: "OPENROUTER_API_KEY", auth: "bearer", count_tokens: "estimate" },
    },
    models: {
      "claude-opus-5-5": { route: "anthropic", upstream_model: "claude-opus-5-5", price_per_mtok: price },
      "particle-1": { route: "openrouter", upstream_model: "particle-ai/particle-1", price_per_mtok: price },
      "gpt-6.1-sol": { route: "openrouter", upstream_model: "openai/gpt-6.1-sol", price_per_mtok: price },
    },
  };
  proxy = startProxy({ config, dataHost: "127.0.0.1", dataPort: 0, controlPort: 0, env: KEYS, closeWaitMs: 300, logPath: join(dir, "requests.jsonl"), sessionsPath: join(dir, "sessions.jsonl") });
});
afterAll(async () => {
  await proxy.stop();
  a.stop(true);
  o.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

const control = () => "http://127.0.0.1:" + proxy.control.port;
const open = async (trial: string, model: string) => (await (await fetch(control() + "/sessions", { method: "POST", body: JSON.stringify({ trial, model, cap_usd: 1 }) })).json()) as { id: string; token: string };
const close = (id: string) => fetch(control() + "/sessions/" + id + "/close", { method: "POST", body: "{}" });
const send = (token: string, model: string, path = "/v1/messages") =>
  fetch("http://127.0.0.1:" + proxy.data.port + path, { method: "POST", headers: { "x-api-key": token, "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: 100, messages: [{ role: "user", content: "hi" }] }) });
const carries = (s: Seen, key: string) => Object.values(s.headers).some((v) => v.includes(key));
const OTHER_PATHS = ["/v1/messages", "/openrouter/api/v1/messages", "/anthropic/v1/messages"];

describe("a session proxy pins each session to its own model's route and key (D9)", () => {
  // Value: protects=key custody on a judge part VM; fails_when=a session reaches a provider other than its model's route, or sends a key other than that route's; why_new=D9 puts TYPESAFE and OPENROUTER in an Opus part VM's session proxy env; seam=proxy.ts data handler (route from s.model, body.model rewritten); no_claim=the judge metering proxy, which the judge tests cover
  test("an Opus session that names another provider's model, by any path, reaches only Anthropic with the Anthropic key", async () => {
    const before = { a: seen.anthropic.length, o: seen.openrouter.length };
    const s = await open("opus-pin", "claude-opus-5-5");
    for (const model of ["particle-1", "particle-ai/particle-1", "gpt-6.1-sol", "openai/gpt-6.1-sol", "anthropic/gpt-6.1-sol"]) for (const path of OTHER_PATHS) expect([model, path, (await send(s.token, model, path)).status]).toEqual([model, path, 200]);
    await close(s.id);
    const got = seen.anthropic.slice(before.a);
    expect(seen.openrouter.length - before.o).toBe(0);
    expect(got.length).toBe(15);
    for (const r of got) {
      expect(r.model).toBe("claude-opus-5-5");
      expect(r.headers["x-api-key"]).toBe(KEYS.ANTHROPIC_API_KEY);
      expect(carries(r, KEYS.OPENROUTER_API_KEY) || carries(r, KEYS.TYPESAFE_API_KEY)).toBe(false);
    }
  });

  test("a particle-1 session that names Opus reaches only OpenRouter with the OpenRouter key, never Anthropic's or TypeSafe's", async () => {
    const before = { a: seen.anthropic.length, o: seen.openrouter.length };
    const s = await open("p1-pin", "particle-1");
    for (const model of ["claude-opus-5-5", "claude-haiku-5-5", "gpt-6.1-sol"]) for (const path of OTHER_PATHS) expect([model, path, (await send(s.token, model, path)).status]).toEqual([model, path, 200]);
    await close(s.id);
    const got = seen.openrouter.slice(before.o);
    expect(seen.anthropic.length - before.a).toBe(0);
    expect(got.length).toBe(9);
    for (const r of got) {
      expect(r.path).toBe("/api/v1/messages");
      expect(r.model).toBe("particle-ai/particle-1");
      expect(r.headers["authorization"]).toBe("Bearer " + KEYS.OPENROUTER_API_KEY);
      expect(carries(r, KEYS.ANTHROPIC_API_KEY) || carries(r, KEYS.TYPESAFE_API_KEY)).toBe(false);
    }
  });

  test("the TypeSafe key in the env reaches no upstream at all, and no session opens on a model the config does not route", async () => {
    expect([...seen.anthropic, ...seen.openrouter].some((r) => carries(r, KEYS.TYPESAFE_API_KEY))).toBe(false);
    const res = await fetch(control() + "/sessions", { method: "POST", body: JSON.stringify({ trial: "typesafe", model: "jev-1.13.0", cap_usd: 1 }) });
    expect(res.status).toBe(400);
  });
});
