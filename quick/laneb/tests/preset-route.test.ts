// particle-1 runs with the claude-code-preset system prompt over OpenRouter (GEVA-108). Keyless check of that route:
// the committed proxy config's particle-1 model and openrouter route, with only the base URL and key env pointed at a
// local stub upstream, take a first request shaped like Claude Code's under the preset (the billing header, the Agent
// SDK line and a long cached guidance block in system) and pass system through untouched, with the provider pin.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startProxy, type ProxyConfig } from "../runner/proxy.ts";

const dir = mkdtempSync(join(tmpdir(), "laneb-preset-"));
const received: any[] = [];
const upstream = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    received.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization"), body: await req.json() });
    return Response.json({ id: "msg_1", type: "message", role: "assistant", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 2000, output_tokens: 5 } });
  },
});
const committed = JSON.parse(readFileSync(join(import.meta.dir, "../config/proxy.json"), "utf8")) as ProxyConfig;
const config: ProxyConfig = {
  routes: { openrouter: { ...committed.routes.openrouter, base_url: `http://127.0.0.1:${upstream.port}`, key_env: "FAKE_KEY" } },
  models: { "particle-1": committed.models["particle-1"] },
};
const proxy = startProxy({ dataHost: "127.0.0.1", dataPort: 0, controlPort: 0, env: { FAKE_KEY: "fake" }, closeWaitMs: 300, config, logPath: join(dir, "log.jsonl"), sessionsPath: join(dir, "sessions.jsonl") });

afterAll(async () => {
  await proxy.stop();
  upstream.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

test("particle-1 over OpenRouter takes a claude-code-preset request and passes its system blocks through", async () => {
  const control = `http://127.0.0.1:${proxy.control.port}`;
  const s = (await (await fetch(control + "/sessions", { method: "POST", body: JSON.stringify({ trial: "t", model: "particle-1", cap_usd: 0.5, meta: { system_prompt: "claude-code-preset" } }) })).json()) as any;
  const system = [
    { type: "text", text: "x-anthropic-billing-header: cc_version=2.1.312; cc_entrypoint=sdk-py;" },
    { type: "text", text: "You are a Claude agent, built on Anthropic's Claude Agent SDK." },
    { type: "text", text: "Guidance line for the preset stand-in.\n".repeat(150), cache_control: { type: "ephemeral" } },
  ];
  const res = await fetch(`http://127.0.0.1:${proxy.data.port}/v1/messages`, {
    method: "POST",
    headers: { authorization: "Bearer " + s.token, "content-type": "application/json" },
    body: JSON.stringify({ model: "particle-1", max_tokens: 1000, system, messages: [{ role: "user", content: "hi" }], tools: [], stream: false }),
  });
  expect(res.status).toBe(200);
  await res.text();
  const closed = (await (await fetch(control + `/sessions/${s.id}/close`, { method: "POST", body: "{}" })).json()) as any;
  expect(closed.ok_responses).toBe(1);
  expect(closed.meta).toEqual({ system_prompt: "claude-code-preset" });
  const sent = received.at(-1);
  expect(sent.auth).toBe("Bearer fake");
  expect(sent.body.model).toBe("particle-ai/particle-1");
  expect(sent.body.provider).toEqual({ only: ["particle-ai"], allow_fallbacks: false });
  expect(sent.body.system).toEqual(system);
});
