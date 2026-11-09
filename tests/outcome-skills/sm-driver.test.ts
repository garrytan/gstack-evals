// Copyright (c) 2026 Garry Tan. MIT License.
// The session driver's family SM stage branch (stage.ts): one lease per model's line item, each SM arm's per-model
// allowance at open, a cap_usd that is not the arm's refused, and the SM proxy's provider-side tool refusal before any
// upstream call. In the style of driver.test.ts, on a temporary ledger with a stub upstream; no key, no paid call.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordProgram } from "../../src/runner/ledger/envelope.ts";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import { serveStages, type StageSpec } from "../../lanes/outcome-skills/driver/stage.ts";

const D = 1_000_000;
const quote = { words: "test words", by: "test", source: "sm-driver.test.ts" };
const ARMS = ["sm:A0", "sm:A1", "sm:A2", "sm:S2", "sm:followon"];
const OPUS: StageSpec = { item: "sm-opus", arm: "sm-opus", model: "claude-opus-5-5", arms: ARMS };
const PARTICLE: StageSpec = { item: "sm-particle", arm: "sm-particle", model: "particle-ai/particle-1", arms: ARMS };
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

test("an SM stage per model opens one lease each, binds each arm's allowance and refuses provider-side tools before the upstream", async () => {
  const root = mkdtempSync(join(tmpdir(), "sm-driver-test-"));
  roots.push(root);
  const record = join(root, "record");
  recordProgram(record, { program: "w", cap_micros: 1_000 * D, skill_cap_micros: 1_000 * D, skills: ["sm"], credit_rate_micros: D, quotes: [quote] });
  for (const item of ["sm-opus", "sm-particle"]) recordApproval(record, { action: "init", item, cap_micros: 100 * D, quotes: [quote], admission: "required", program: "w", skills: ["sm"] });
  const local = LocalLedger.open(join(root, "ledger.sqlite"));
  const upstreamCalls: string[] = [];
  const fetchStub = async (url: string, init: RequestInit) => {
    upstreamCalls.push(url);
    const body = JSON.parse(String(init.body)) as { model: string };
    return Response.json({ id: "msg_1", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  };
  const served = await serveStages({ record, local, run_id: "r1", envelope_host: "m1", machine: "m1", stages: [OPUS, PARTICLE], host: "127.0.0.1", dir: join(root, "run"), fetch: fetchStub, requireAdmission: () => null, env: { ANTHROPIC_API_KEY: "upstream-key", OPENROUTER_API_KEY: "upstream-key" }, log: () => {} });
  expect(served.stages.map((s) => s.item)).toEqual(["sm-opus", "sm-particle"]);
  expect(new Set(served.stages.map((s) => s.lease_id)).size).toBe(2);
  expect(served.stages.map((s) => s.reserved_micros)).toEqual([100 * D, 100 * D]);
  for (const item of ["sm-opus", "sm-particle"]) expect(readItem(record, item).open?.lease_id).toBe(served.stages.find((s) => s.item === item)!.lease_id);
  const open = async (arm: string, model: string, cap: number, task: string) => {
    const res = await fetch(served.control + "/sessions", { method: "POST", body: JSON.stringify({ trial: "t-" + task, model, cap_usd: cap, meta: { arm, task, trial_n: 1 }, open_key: arm + model + task, ledger: "u4" }) });
    const json = (await res.json()) as Record<string, any>;
    if (res.status === 200) opened.push(json.id);
    return { status: res.status, json };
  };
  const opened: string[] = [];
  const a1 = await open("sm:A1", "claude-opus-5-5", 15, "u1/A1");
  expect(a1.status).toBe(200);
  expect(a1.json).toMatchObject({ item: "sm-opus", ledger: "u4", allowance_micros: 15 * D, lease_id: served.stages[0]!.lease_id });
  expect(a1.json.base_url).toEndWith("/anthropic");
  expect((await open("sm:followon", "claude-opus-5-5", 6, "u1/F-A1-1")).json).toMatchObject({ item: "sm-opus", allowance_micros: 6 * D });
  const p0 = await open("sm:A0", "particle-ai/particle-1", 3, "u1/A0");
  expect(p0.json).toMatchObject({ item: "sm-particle", allowance_micros: 3 * D, lease_id: served.stages[1]!.lease_id });
  const wrong = await open("sm:A0", "claude-opus-5-5", 6, "u1/A0");
  expect(wrong.status).toBe(400);
  expect(JSON.stringify(wrong.json)).toContain("session_cap_usd");
  expect((await open("qa:told", "claude-opus-5-5", 15, "u1/A3")).status).toBe(400);
  const call = (tools?: unknown[]) => fetch(a1.json.base_url + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": a1.json.token }, body: JSON.stringify({ model: "claude-opus-5-5", max_tokens: 100, messages: [{ role: "user", content: "hi" }], ...(tools ? { tools } : {}) }) });
  const web = await call([{ type: "web_search_20250305", name: "web_search", max_uses: 1 }]);
  expect(web.status).toBeGreaterThanOrEqual(400);
  expect(await web.text()).toContain("E_PROXY_SERVER_TOOL");
  expect(upstreamCalls.length).toBe(0);
  expect((await call()).status).toBe(200);
  expect(upstreamCalls.length).toBe(1);
  for (const id of opened) expect((await fetch(served.control + "/sessions/" + id + "/close", { method: "POST", body: JSON.stringify({ reason: "agent_finished" }) })).status).toBe(200);
  expect(await served.stop()).toBe(0);
  for (const item of ["sm-opus", "sm-particle"]) {
    const s = readItem(record, item);
    expect(s.open).toBeNull();
    expect(s.leases.length).toBe(1);
    expect(s.leases[0]!.close).not.toBeNull();
  }
  local.close?.();
});
