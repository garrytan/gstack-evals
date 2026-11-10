// Copyright (c) 2026 Garry Tan. MIT License.
// The session driver's PF stage branch (stage.ts): a PF item's arms and models at stage start, two slots per session (the
// task turn and the wrap-up turn) at each phase's allowance, the open rules per session, the room rule that keeps the
// wrap-up allowance pending on the lease, and the allowance table admission may double. On a temporary ledger with a stub
// upstream, in the style of sm-driver.test.ts; no key, no paid call.
import { afterAll, expect, jest, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordProgram } from "../../src/runner/ledger/envelope.ts";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { MeteringProxy } from "../../src/runner/proxy/metering-proxy.ts";
import { serveStages, type ServeOptions, type StageSpec } from "../../lanes/outcome-skills/driver/stage.ts";
import { costReading } from "../../lanes/outcome-skills/pfchecks/admission.ts";
import { OPUS, P1, SOL } from "../../lanes/outcome-skills/pfchecks/items.ts";

const D = 1_000_000;
const quote = { words: "test words", by: "test", source: "pf-driver.test.ts" };
const TOLD = ["pf:P", "pf:C", "pf:N"];
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

function ledger(items: Record<string, { cap: number; skills?: string[] }>) {
  const root = mkdtempSync(join(tmpdir(), "pf-driver-test-"));
  roots.push(root);
  const record = join(root, "record");
  recordProgram(record, { program: "w", cap_micros: 1_000 * D, skill_cap_micros: 1_000 * D, skills: ["pf", "sm"], credit_rate_micros: D, quotes: [quote] });
  for (const [item, v] of Object.entries(items)) recordApproval(record, { action: "init", item, cap_micros: v.cap * D, quotes: [quote], admission: "required", program: "w", skills: v.skills ?? ["pf"] });
  const local = LocalLedger.open(join(root, "ledger.sqlite"));
  const fetchStub = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { model: string };
    return Response.json({ id: "msg_1", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  };
  const serve = (stages: StageSpec[], extra: Partial<ServeOptions> = {}) => serveStages({ record, local, run_id: "r1", envelope_host: "m1", machine: "m1", stages, host: "127.0.0.1", dir: join(root, "run"), fetch: fetchStub, requireAdmission: () => null, env: { ANTHROPIC_API_KEY: "upstream-key", OPENROUTER_API_KEY: "upstream-key" }, log: () => {}, ...extra });
  return { root, local, serve };
}

function client(control: string) {
  const opened: string[] = [];
  const open = async (o: { arm: string; model?: string; cap: number; task?: string; trial_n?: number; phase?: unknown; rerun?: string; key?: string }) => {
    const meta: Record<string, unknown> = { arm: o.arm, task: o.task ?? "u1", trial_n: o.trial_n ?? 1, ...(o.phase !== undefined ? { phase: o.phase } : {}), ...(o.rerun ? { rerun: o.rerun } : {}) };
    const res = await fetch(control + "/sessions", { method: "POST", body: JSON.stringify({ trial: "t-" + (o.task ?? "u1"), model: o.model ?? OPUS, cap_usd: o.cap, ledger: "u4", open_key: o.key ?? crypto.randomUUID(), meta }) });
    const json = (await res.json()) as Record<string, any>;
    if (res.status === 200) opened.push(json.id);
    return { status: res.status, json };
  };
  const closeAll = async () => {
    for (const id of opened.splice(0)) expect((await fetch(control + "/sessions/" + id + "/close", { method: "POST", body: JSON.stringify({ reason: "agent_finished" }) })).status).toBe(200);
  };
  return { open, closeAll };
}

test("each PF item starts as a stage on its own models and arms; a wrong skill, mixed arms, pf:P on pf-blind, a stage model or an unknown item is refused", async () => {
  const items = { "pf-admit": TOLD, "pf-opus": TOLD, "pf-sol": TOLD, "pf-particle": TOLD, "pf-blind": ["pf:blind"] };
  for (const [item, arms] of Object.entries(items)) {
    const { serve, local } = ledger({ [item]: { cap: 100 } });
    const served = await serve([{ item, arm: item, arms }]);
    expect(served.stages.map((s) => [s.item, s.reserved_micros])).toEqual([[item, 100 * D]]);
    expect(await served.stop()).toBe(0);
    local.close?.();
  }
  const refused = async (items: Record<string, { cap: number; skills?: string[] }>, stages: StageSpec[], text: string) => {
    const { serve, local } = ledger(items);
    await expect(serve(stages)).rejects.toThrow(text);
    local.close?.();
  };
  await refused({ "pf-opus": { cap: 100, skills: ["sm"] } }, [{ item: "pf-opus", arm: "pf-opus", arms: TOLD }], "spends for pf");
  await refused({ "pf-opus": { cap: 100 } }, [{ item: "pf-opus", arm: "pf-opus", arms: ["pf:P", "sm:A0"] }], "mixes PF arms");
  await refused({ "pf-blind": { cap: 100 } }, [{ item: "pf-blind", arm: "pf-blind", arms: ["pf:P"] }], "serves pf:blind, not pf:P");
  await refused({ "pf-opus": { cap: 100 } }, [{ item: "pf-opus", arm: "pf-opus", model: OPUS, arms: TOLD }], "takes its models from its item");
  await refused({ "pf-x": { cap: 100 } }, [{ item: "pf-x", arm: "pf-x", arms: TOLD }], "is not a PF item");
});

test("pf-admit serves all three models with a task slot and a wrap-up slot per session, each at its phase's allowance, and enforces the open rules", async () => {
  const { serve, local, root } = ledger({ "pf-admit": { cap: 500 }, "sm-opus": { cap: 100, skills: ["sm"] } });
  const served = await serve([{ item: "pf-admit", arm: "pf-admit", arms: TOLD }, { item: "sm-opus", arm: "sm-opus", model: OPUS, arms: ["sm:A0"] }]);
  const { open, closeAll } = client(served.control);
  const lease = served.stages[0]!.lease_id;
  const task = await open({ arm: "pf:P", cap: 12, phase: "task" });
  expect(task.status).toBe(200);
  expect(task.json).toMatchObject({ item: "pf-admit", ledger: "u4", lease_id: lease, allowance_micros: 12 * D });
  expect(task.json.base_url).toEndWith("/anthropic");
  const wrap = await open({ arm: "pf:P", cap: 6, phase: "wrapup" });
  expect(wrap.status).toBe(200);
  expect(wrap.json).toMatchObject({ item: "pf-admit", lease_id: lease, allowance_micros: 6 * D });
  expect(wrap.json.meter_id).not.toBe(task.json.meter_id);
  expect(wrap.json.base_url).not.toBe(task.json.base_url);
  expect(wrap.json.base_url).toEndWith("/anthropic");
  const sol = await open({ arm: "pf:C", model: SOL, cap: 12, phase: "task" });
  expect(sol.json).toMatchObject({ item: "pf-admit", allowance_micros: 12 * D });
  expect(sol.json.base_url).toEndWith("/openrouter");
  expect((await open({ arm: "pf:N", model: P1, cap: 3, phase: "task" })).json).toMatchObject({ allowance_micros: 3 * D });
  const p1wrap = await open({ arm: "pf:N", model: P1, cap: 0.5, phase: "wrapup" });
  expect(p1wrap.json).toMatchObject({ allowance_micros: 0.5 * D });
  expect(p1wrap.json.base_url).toEndWith("/openrouter");

  expect((await open({ arm: "pf:P", cap: 1, phase: "task", task: "u2" })).json.detail).toContain("task allowance_usd");
  expect((await open({ arm: "pf:P", cap: 12, phase: "wrapup", task: "u2" })).status).toBe(400);
  expect((await open({ arm: "pf:P", cap: 12, task: "u2" })).json.detail).toContain("meta.phase");
  expect((await open({ arm: "pf:P", cap: 12, phase: "t1", task: "u2" })).json.detail).toContain("meta.phase");
  expect((await open({ arm: "pf:blind", cap: 15, phase: "task", task: "u2" })).status).toBe(400);
  expect((await open({ arm: "sm:A0", cap: 6, phase: "task" })).json.detail).toContain("PF sessions only");

  const early = await open({ arm: "pf:C", cap: 6, phase: "wrapup", task: "u3" });
  expect(early.status).toBe(422);
  expect(early.json.detail).toContain("no task open yet");
  expect((await open({ arm: "pf:P", cap: 6, phase: "wrapup" })).status).toBe(422);
  expect((await open({ arm: "pf:P", cap: 6, phase: "wrapup", rerun: "wrap-up infra end" })).status).toBe(200);
  expect((await open({ arm: "pf:P", cap: 6, phase: "wrapup", rerun: "again" })).json.detail).toContain("one rerun at most");
  expect((await open({ arm: "pf:P", cap: 12, phase: "task" })).status).toBe(422);
  expect((await open({ arm: "pf:P", cap: 12, phase: "task", rerun: "task infra end" })).status).toBe(200);
  expect((await open({ arm: "pf:P", cap: 6, phase: "wrapup" })).status).toBe(200);
  expect((await open({ arm: "pf:P", cap: 12, phase: "task", rerun: "third" })).status).toBe(422);

  const status = (await (await fetch(served.control + "/status")).json()) as { stages: Array<{ opens: number; reruns: number }> };
  expect(status.stages[0]).toMatchObject({ opens: 4, reruns: 1 });
  const lines = readFileSync(join(root, "run", "sessions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const opens = lines.filter((e) => e.event === "open" && e.item === "pf-admit");
  expect(opens.map((e) => e.phase)).toEqual(["task", "wrapup", "task", "task", "wrapup", "wrapup", "task", "wrapup"]);
  expect(opens.map((e) => e.model)).toEqual([OPUS, OPUS, SOL, P1, P1, OPUS, OPUS, OPUS]);
  await closeAll();
  expect(lines.length).toBeGreaterThan(0);
  expect(await served.stop()).toBe(0);
  local.close?.();
});

test("a task open needs room for its task and wrap-up allowances, the wrap-up's room stays held for it, and a task open past that cap-stops", async () => {
  const { serve, local } = ledger({ "pf-opus": { cap: 24 } });
  const served = await serve([{ item: "pf-opus", arm: "pf-opus", arms: TOLD }]);
  const { open, closeAll } = client(served.control);
  expect((await open({ arm: "pf:N", cap: 6, phase: "task", task: "u1" })).status).toBe(200);
  expect((await open({ arm: "pf:N", cap: 6, phase: "task", task: "u2" })).status).toBe(200);
  expect((await open({ arm: "pf:N", cap: 6, phase: "wrapup", task: "u1" })).status).toBe(200);
  expect((await open({ arm: "pf:N", cap: 6, phase: "wrapup", task: "u2" })).status).toBe(200);
  await closeAll();
  expect(await served.stop()).toBe(0);
  local.close?.();

  const small = ledger({ "pf-opus": { cap: 12.5 } });
  const s2 = await small.serve([{ item: "pf-opus", arm: "pf-opus", arms: TOLD }]);
  const c2 = client(s2.control);
  const stop = await c2.open({ arm: "pf:P", cap: 12, phase: "task" });
  expect(stop.status).toBe(409);
  expect(stop.json.code).toBe("CAP_STOP");
  expect(stop.json.detail).toContain("for its wrap-up turn");
  await s2.done;
  small.local.close?.();

  const two = ledger({ "pf-opus": { cap: 13.5 } });
  const s3 = await two.serve([{ item: "pf-opus", arm: "pf-opus", arms: TOLD }]);
  const c3 = client(s3.control);
  expect((await c3.open({ arm: "pf:N", cap: 6, phase: "task", task: "u1" })).status).toBe(200);
  const third = await c3.open({ arm: "pf:N", cap: 6, phase: "task", task: "u2" });
  expect(third.json.code).toBe("CAP_STOP");
  await c3.closeAll();
  await s3.done;
  two.local.close?.();
});

test("pf-blind serves pf:blind on Opus only, and the doubled allowance table changes the task cap a told open must name", async () => {
  const { serve, local } = ledger({ "pf-blind": { cap: 100 }, "pf-opus": { cap: 100 } });
  const doubled = costReading({ P: [10, 10, 10], C: [1, 1], N: [1] }).allowance;
  expect(doubled.P[OPUS]).toBe(24);
  const served = await serve([{ item: "pf-blind", arm: "pf-blind", arms: ["pf:blind"] }, { item: "pf-opus", arm: "pf-opus", arms: TOLD }], { pf_allowance: doubled });
  const { open, closeAll } = client(served.control);
  expect((await open({ arm: "pf:blind", cap: 15, phase: "task" })).json).toMatchObject({ item: "pf-blind", allowance_micros: 15 * D });
  expect((await open({ arm: "pf:blind", model: SOL, cap: 15, phase: "task" })).status).toBe(400);
  expect((await open({ arm: "pf:P", cap: 12, phase: "task" })).status).toBe(400);
  expect((await open({ arm: "pf:P", cap: 24, phase: "task" })).json).toMatchObject({ item: "pf-opus", allowance_micros: 24 * D });
  expect((await open({ arm: "pf:C", cap: 12, phase: "task" })).json).toMatchObject({ item: "pf-opus", allowance_micros: 12 * D });
  expect((await open({ arm: "pf:P", model: SOL, cap: 24, phase: "task" })).status).toBe(400);
  await closeAll();
  expect(await served.stop()).toBe(0);
  local.close?.();
});

test("a PF slot past its wall limit plus the grace is closed by its deadline and its bearer refused", async () => {
  const { serve, local, root } = ledger({ "pf-opus": { cap: 100 } });
  const served = await serve([{ item: "pf-opus", arm: "pf-opus", arms: TOLD }], { deadline_grace_ms: 50 });
  const { open, closeAll } = client(served.control);
  expect((await open({ arm: "pf:N", cap: 6, phase: "task" })).status).toBe(200);
  jest.useFakeTimers();
  let wrap: Awaited<ReturnType<typeof open>>;
  try {
    wrap = await open({ arm: "pf:N", cap: 6, phase: "wrapup" });
    jest.advanceTimersByTime(300_000 + 51);
  } finally {
    jest.useRealTimers();
  }
  expect(wrap.status).toBe(200);
  const sessions = join(root, "run", "sessions.jsonl");
  const closed = () => readFileSync(sessions, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.event === "close" && e.id === wrap.json.id);
  for (let i = 0; i < 50 && !closed(); i++) await Bun.sleep(20);
  expect(closed()).toMatchObject({ reason: "deadline", lease_id: served.stages[0]!.lease_id });
  const call = await fetch(wrap.json.base_url + "/v1/messages", { method: "POST", headers: { "x-api-key": wrap.json.token, "content-type": "application/json", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: OPUS, max_tokens: 10, messages: [{ role: "user", content: "hi" }] }) });
  expect(call.status).toBe(403);
  await closeAll();
  expect(await served.stop()).toBe(0);
  local.close?.();
});

test("a closed task slot's wrap-up hold keeps its room for the deadline grace, then frees it for the next task open", async () => {
  const run = async (advance: number) => {
    let clock = Date.now();
    const { serve, local } = ledger({ "pf-opus": { cap: 12.5 } });
    const served = await serve([{ item: "pf-opus", arm: "pf-opus", arms: TOLD }], { deadline_grace_ms: 1_000, now: () => clock });
    const { open } = client(served.control);
    const task = await open({ arm: "pf:N", cap: 6, phase: "task", task: "u1" });
    expect(task.status).toBe(200);
    expect((await fetch(served.control + "/sessions/" + task.json.id + "/close", { method: "POST", body: JSON.stringify({ reason: "agent_finished" }) })).status).toBe(200);
    clock += advance;
    const next = await open({ arm: "pf:N", cap: 6, phase: "task", task: "u2" });
    await served.stop();
    local.close?.();
    return next;
  };
  const held = await run(999);
  expect(held.status).toBe(409);
  expect(held.json.code).toBe("CAP_STOP");
  expect((await run(1_001)).status).toBe(200);
});

test("a PF slot's close answer carries the effort and thinking fields of its first request with a tools list, as its proxy recorded them, or null when it sent none", async () => {
  const { serve, local } = ledger({ "pf-opus": { cap: 100 } });
  const served = await serve([{ item: "pf-opus", arm: "pf-opus", arms: TOLD }]);
  const { open } = client(served.control);
  const task = await open({ arm: "pf:P", cap: 12, phase: "task" });
  const call = (body: unknown) => fetch(task.json.base_url + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": task.json.token }, body: JSON.stringify(body) });
  const tools = [{ name: "Bash", description: "run", input_schema: { type: "object" } }];
  expect((await call({ model: OPUS, max_tokens: 100, messages: [{ role: "user", content: "title" }] })).status).toBe(200);
  expect((await call({ model: OPUS, messages: [{ role: "user", content: "fix" }], tools, thinking: { type: "adaptive" } })).status).toBe(200);
  expect((await call({ model: OPUS, messages: [{ role: "user", content: "again" }], tools, thinking: { type: "disabled" }, effort: "low" })).status).toBe(200);
  const close = async (id: string) => (await (await fetch(served.control + "/sessions/" + id + "/close", { method: "POST", body: JSON.stringify({ reason: "turn_end" }) })).json()) as Record<string, any>;
  expect((await close(task.json.id)).first_request).toEqual({ thinking: { type: "adaptive" }, output_config: null, reasoning: null, reasoning_effort: null, effort: null });
  const wrap = await open({ arm: "pf:P", cap: 6, phase: "wrapup" });
  expect((await close(wrap.json.id)).first_request).toBeNull();
  expect(await served.stop()).toBe(0);
  local.close?.();
});

test("a PF slot refuses provider-side tools and capabilities, and its close answer counts an allowance stop only for the slot's allowance check", async () => {
  const { serve, local } = ledger({ "pf-opus": { cap: 100 } });
  const served = await serve([{ item: "pf-opus", arm: "pf-opus", arms: TOLD }]);
  const { open } = client(served.control);
  const close = async (id: string) => (await (await fetch(served.control + "/sessions/" + id + "/close", { method: "POST", body: JSON.stringify({ reason: "turn_end" }) })).json()) as Record<string, any>;
  const caller = (slot: { json: Record<string, any> }) => (body: Record<string, unknown>) => fetch(slot.json.base_url + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": slot.json.token }, body: JSON.stringify({ model: OPUS, max_tokens: 100, messages: [{ role: "user", content: "hi" }], ...body }) });
  const task = await open({ arm: "pf:P", cap: 12, phase: "task" });
  const call = caller(task);
  const web = await call({ tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }] });
  expect(web.status).toBe(403);
  expect(((await web.json()) as Record<string, any>).code).toBe("E_PROXY_SERVER_TOOL");
  const mcp = await call({ mcp_servers: [{ type: "url", url: "https://example.invalid/mcp", name: "x" }] });
  expect(mcp.status).toBe(403);
  expect(((await mcp.json()) as Record<string, any>).code).toBe("E_PROXY_SERVER_TOOL");
  expect((await call({ model: OPUS + ":online" })).status).toBe(403);
  expect((await call({})).status).toBe(200);
  expect(await close(task.json.id)).toMatchObject({ refusals: ["E_PROXY_SERVER_TOOL", "E_PROXY_SERVER_TOOL", "E_ALLOWANCE"], allowance_stops: 0 });
  const wrap = await open({ arm: "pf:P", cap: 6, phase: "wrapup" });
  expect((await caller(wrap)({ messages: [{ role: "user", content: "x".repeat(4_000_000) }] })).status).toBe(402);
  expect(await close(wrap.json.id)).toMatchObject({ refusals: ["E_ALLOWANCE"], allowance_stops: 1 });
  expect(await served.stop()).toBe(0);
  local.close?.();
});

// Value: protects=the PF end kinds' input when the proxy's finalize fails, and the Captain's halt of the item; fails_when=a PF close answer reports counts it never read, drops the journal's refusal codes or keeps an effort record, or the stage opens another slot or the driver names no session and journal; why_new=the state machines eval's finalized flag, read by PF turns; seam=driver/stage.ts closeSession's PF branch; no_claim=the end kind and the session halt (pf-run.test.ts) or the agent (pf_agent_sdk_test.py)
test("a PF slot whose proxy finalize fails closes with finalized false, null counts, its journal's refusal codes and no effort record, and halts its stage, naming the session and the journal, until a relaunch lifts it", async () => {
  const { serve, local, root } = ledger({ "pf-opus": { cap: 100 }, "pf-sol": { cap: 100 } });
  const lines: string[] = [];
  const served = await serve([{ item: "pf-opus", arm: "pf-opus", arms: TOLD }, { item: "pf-sol", arm: "pf-sol", arms: TOLD }], { log: (line) => lines.push(line) });
  const { open } = client(served.control);
  const task = await open({ arm: "pf:P", cap: 12, phase: "task" });
  const call = (body: Record<string, unknown>) => fetch(task.json.base_url + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": task.json.token }, body: JSON.stringify({ model: OPUS, max_tokens: 100, messages: [{ role: "user", content: "hi" }], ...body }) });
  expect((await call({ tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }] })).status).toBe(403);
  expect((await call({ tools: [{ name: "Bash", description: "run", input_schema: { type: "object" } }], thinking: { type: "adaptive" } })).status).toBe(200);
  const finalize = MeteringProxy.prototype.finalize;
  MeteringProxy.prototype.finalize = async () => {
    throw new Error("finalize failed in this test");
  };
  let answer: Record<string, any>;
  try {
    answer = (await (await fetch(served.control + "/sessions/" + task.json.id + "/close", { method: "POST", body: JSON.stringify({ reason: "turn_end" }) })).json()) as Record<string, any>;
  } finally {
    MeteringProxy.prototype.finalize = finalize;
  }
  expect(answer).toMatchObject({ finalized: false, requests: null, ok_responses: null, refused: null, refusals: ["E_PROXY_SERVER_TOOL"], allowance_stops: null, first_request: null });
  const journal = join(root, "run", answer.lease_id + ".journal.ndjson");
  expect(lines.filter((l) => l.startsWith("E_PF_FINALIZE_HALT "))).toEqual([expect.stringContaining("PF session " + task.json.id + " on stage pf-opus")]);
  expect(lines.find((l) => l.startsWith("E_PF_FINALIZE_HALT "))).toEndWith(journal);
  const events = readFileSync(join(root, "run", "sessions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(events.filter((e) => e.event === "halt")).toEqual([expect.objectContaining({ item: "pf-opus", id: task.json.id, lease_id: answer.lease_id, journal })]);
  const next = await open({ arm: "pf:P", cap: 12, phase: "task", task: "u2" });
  expect([next.status, next.json.code]).toEqual([503, "E_LEASE_CLOSED"]);
  expect(await served.stop()).toBe(2);
  const stage = [{ item: "pf-opus", arm: "pf-opus", arms: TOLD }];
  const relaunch = await serve(stage).then(async (s) => (await s.stop(), "served"), (err: { code?: string; message: string }) => err.code + " " + err.message);
  expect(relaunch).toStartWith("E_SM_FINALIZE_HALT line item pf-opus halted in run r1");
  expect(relaunch).toContain(task.json.id);
  const lifted = await serve(stage, { lift_halts: [task.json.id] });
  expect(await lifted.stop()).toBe(0);
  local.close?.();
});
