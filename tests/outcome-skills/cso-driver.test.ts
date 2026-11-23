// Copyright (c) 2026 Garry Tan. MIT License.
// The session driver's cso stage branch (driver/stage.ts with cso/driver.ts), plan sections 4 and 14: each cso session
// item serves its own cso:<arm> arms on both models under test, one slot per session at that model's allowance ($8 Opus,
// $3 particle-1, or twice it after stage 1), one whole-session retry naming meta.rerun, an item cap no higher than
// prereg.json's or a re-priced one, and the cso finalize halt. On a temporary ledger with a stub upstream; no key, no paid call.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordProgram } from "../../src/runner/ledger/envelope.ts";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { MeteringProxy } from "../../src/runner/proxy/metering-proxy.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { serveStages, type ServeOptions, type StageSpec } from "../../lanes/outcome-skills/driver/stage.ts";
import { CSO_STAGES, csoDriverLimits, csoDriverModels, csoItemCapUsd } from "../../lanes/outcome-skills/cso/driver.ts";
import { loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";

const D = 1_000_000;
const p = loadCsoPrereg();
const OPUS = "claude-opus-5-5", PARTICLE = "particle-ai/particle-1";
const quote = { words: "test words", by: "test", source: "cso-driver.test.ts" };
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const ok = (): Response => Response.json({ id: "msg_1", type: "message", role: "assistant", model: OPUS, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });

function ledger(items: Record<string, { cap: number; skills?: string[] }>) {
  const root = mkdtempSync(join(tmpdir(), "cso-driver-test-"));
  roots.push(root);
  const record = join(root, "record");
  recordProgram(record, { program: "w", cap_micros: 5_000 * D, skill_cap_micros: 5_000 * D, skills: ["cso", "h2h"], credit_rate_micros: D, quotes: [quote] });
  for (const [item, v] of Object.entries(items)) recordApproval(record, { action: "init", item, cap_micros: v.cap * D, quotes: [quote], admission: "required", program: "w", skills: v.skills ?? ["cso"] });
  const local = LocalLedger.open(join(root, "ledger.sqlite"));
  const serve = (stages: StageSpec[], extra: Partial<ServeOptions> = {}) => serveStages({ record, local, run_id: "r1", envelope_host: "m1", machine: "m1", stages, host: "127.0.0.1", dir: join(root, "run"), fetch: async () => ok(), requireAdmission: () => null, env: { ANTHROPIC_API_KEY: "upstream-key", OPENROUTER_API_KEY: "upstream-key" }, log: () => {}, ...extra });
  return { root, local, serve };
}
function client(control: string) {
  const open = async (o: { arm: string; model?: string; cap?: number; task?: string; rerun?: string; phase?: string }) => {
    const meta = { arm: o.arm, task: o.task ?? "u1", trial_n: 1, ...(o.rerun ? { rerun: o.rerun } : {}), ...(o.phase ? { phase: o.phase } : {}) };
    const model = o.model ?? OPUS;
    const res = await fetch(control + "/sessions", { method: "POST", body: JSON.stringify({ trial: "t", model, cap_usd: o.cap ?? (model === OPUS ? 8 : 3), ledger: "u4", open_key: crypto.randomUUID(), meta }) });
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };
  const close = async (id: string) => (await (await fetch(control + "/sessions/" + id + "/close", { method: "POST", body: JSON.stringify({ reason: "agent_finished" }) })).json()) as Record<string, any>;
  return { open, close };
}

test("the cso items, models, allowances and caps come from prereg.json", () => {
  expect(Object.keys(CSO_STAGES)).toEqual(["cso-smoke", "cso-pilot", "cso-main"]);
  expect(CSO_STAGES["cso-main"]).toEqual(["cso:none", "cso:cso"]);
  expect(csoDriverModels()).toEqual([OPUS, PARTICLE]);
  expect(csoDriverLimits(OPUS)).toEqual({ session_cap_usd: 8, wall_limit_sec: 2700, max_turns: 200 });
  expect(csoDriverLimits(PARTICLE).session_cap_usd).toBe(3);
  expect(csoDriverLimits(PARTICLE, { [PARTICLE]: 6 }).session_cap_usd).toBe(6);
  expect(() => csoDriverLimits("openai/gpt-6.2-sol")).toThrow(/^E_CSO_SESSION /);
  expect(csoItemCapUsd("cso-main")).toBe(p.items["cso-main"]!.cap);
  expect(csoItemCapUsd("cso-main", { "cso-main": 600 })).toBe(600);
});

test("each cso item starts on its own arms; mixed lanes, an unknown item, a stage model, a stray arm, a wrong skill, a chosen allowance and a cap above prereg.json's are refused", async () => {
  for (const [item, arms] of Object.entries(CSO_STAGES)) {
    const { serve, local } = ledger({ [item]: { cap: p.items[item]!.cap } });
    const served = await serve([{ item, arm: item, arms }]);
    expect(served.stages.map((s) => s.item)).toEqual([item]);
    expect(await served.stop()).toBe(0);
    local.close?.();
  }
  const refused = async (items: Record<string, { cap: number; skills?: string[] }>, stages: StageSpec[], text: string, extra: Partial<ServeOptions> = {}) => {
    const { serve, local } = ledger(items);
    await expect(serve(stages, extra)).rejects.toThrow(text);
    local.close?.();
  };
  const main = { "cso-main": { cap: 100 } };
  await refused(main, [{ item: "cso-main", arm: "cso-main", arms: ["cso:none", "h2h:none"] }], "mixes h2h arms with other lanes' arms");
  await refused(main, [{ item: "cso-main", arm: "cso-main", arms: ["cso:none", "sm:A0"] }], "mixes cso arms with other lanes' arms");
  await refused({ "cso-x": { cap: 100 } }, [{ item: "cso-x", arm: "cso-x", arms: ["cso:none"] }], "is not a cso session item");
  await refused(main, [{ item: "cso-main", arm: "cso-main", model: OPUS, arms: ["cso:none"] }], "serves prereg.json's models");
  await refused(main, [{ item: "cso-main", arm: "cso-main", arms: ["cso:untold"] }], "not cso:untold");
  await refused({ "cso-main": { cap: 100, skills: ["h2h"] } }, [{ item: "cso-main", arm: "cso-main", arms: ["cso:none"] }], "spends for cso");
  await refused(main, [{ item: "cso-main", arm: "cso-main", arms: ["cso:none"] }], "not $5", { cso_allowance_usd: { [OPUS]: 5 } });
  await refused({ "cso-smoke": { cap: p.items["cso-smoke"]!.cap + 1 } }, [{ item: "cso-smoke", arm: "cso-smoke", arms: ["cso:none"] }], "above the $" + p.items["cso-smoke"]!.cap);
  const repriced = ledger({ "cso-main": { cap: 600 } });
  const s = await repriced.serve([{ item: "cso-main", arm: "cso-main", arms: ["cso:none"] }], { cso_caps_usd: { "cso-main": 600 } });
  expect(await s.stop()).toBe(0);
  repriced.local.close?.();
});

test("one slot per session at the model's allowance on its provider, one whole-session retry, and the doubled allowance per model", async () => {
  const { serve, local, root } = ledger({ "cso-pilot": { cap: 147 } });
  const served = await serve([{ item: "cso-pilot", arm: "cso-pilot", arms: CSO_STAGES["cso-pilot"]! }]);
  const { open, close } = client(served.control);
  const opus = await open({ arm: "cso:cso" });
  expect(opus.status).toBe(200);
  expect(opus.json).toMatchObject({ item: "cso-pilot", allowance_micros: 8 * D });
  expect(opus.json.base_url).toEndWith("/anthropic");
  const particle = await open({ arm: "cso:cso", model: PARTICLE });
  expect(particle.status).toBe(200);
  expect(particle.json).toMatchObject({ allowance_micros: 3 * D });
  expect(particle.json.base_url).toEndWith("/openrouter");
  expect((await open({ arm: "cso:none", model: PARTICLE, cap: 8 })).json.detail).toContain("of 3");
  expect((await open({ arm: "cso:none", model: "claude-sonnet-5-5" })).status).toBe(400);
  expect((await open({ arm: "cso:none", phase: "task" })).json.detail).toContain("PF sessions only");
  expect((await open({ arm: "cso:cso" })).status).toBe(422);
  const retry = await open({ arm: "cso:cso", rerun: "upstream end" });
  expect(retry.status).toBe(200);
  expect((await open({ arm: "cso:cso", rerun: "again" })).json.detail).toContain("one rerun at most");
  const untold = await open({ arm: "cso:untold" });
  expect(untold.status).toBe(200);
  expect(await close(opus.json.id)).toMatchObject({ finalized: true, allowance_stops: 0, reservation_bound: 0 });
  for (const id of [particle.json.id, retry.json.id, untold.json.id]) await close(id);
  expect(await served.stop()).toBe(0);
  const lines = readFileSync(join(root, "run", "sessions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(lines.filter((e) => e.event === "open").map((e) => [e.arm, e.model, e.rerun ?? null])).toEqual([["cso:cso", OPUS, null], ["cso:cso", PARTICLE, null], ["cso:cso", OPUS, "upstream end"], ["cso:untold", OPUS, null]]);
  local.close?.();

  const doubled = ledger({ "cso-main": { cap: 486 } });
  const s2 = await doubled.serve([{ item: "cso-main", arm: "cso-main", arms: ["cso:none"] }], { cso_allowance_usd: { [PARTICLE]: 6 } });
  const c2 = client(s2.control);
  expect((await c2.open({ arm: "cso:none", model: PARTICLE, cap: 3 })).status).toBe(400);
  const twice = await c2.open({ arm: "cso:none", model: PARTICLE, cap: 6 });
  expect(twice.json).toMatchObject({ allowance_micros: 6 * D });
  const opusSame = await c2.open({ arm: "cso:none", cap: 8 });
  expect(opusSame.json).toMatchObject({ allowance_micros: 8 * D });
  for (const id of [twice.json.id, opusSame.json.id]) await c2.close(id);
  expect(await s2.stop()).toBe(0);
  doubled.local.close?.();
});

test("a cso slot whose proxy finalize fails halts its stage: the next open is refused and a relaunch names the session", async () => {
  const lines: string[] = [];
  const { serve, local, root } = ledger({ "cso-main": { cap: 100 }, "cso-smoke": { cap: 62 } });
  const served = await serve([{ item: "cso-main", arm: "cso-main", arms: ["cso:cso"] }, { item: "cso-smoke", arm: "cso-smoke", arms: ["cso:none"] }], { log: (l: string) => void lines.push(l) });
  const { open, close } = client(served.control);
  const s1 = await open({ arm: "cso:cso" });
  expect(s1.status).toBe(200);
  const finalize = MeteringProxy.prototype.finalize;
  MeteringProxy.prototype.finalize = async () => {
    throw new Error("finalize failed in this test");
  };
  let answer: Record<string, any>;
  try {
    answer = await close(s1.json.id);
  } finally {
    MeteringProxy.prototype.finalize = finalize;
  }
  expect(answer).toMatchObject({ finalized: false, allowance_stops: null });
  expect(lines.filter((l) => l.startsWith("E_CSO_FINALIZE_HALT outcome driver: session " + s1.json.id + " on line item cso-main"))).toHaveLength(1);
  const events = readFileSync(join(root, "run", "sessions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(events.filter((e) => e.event === "halt")).toEqual([expect.objectContaining({ item: "cso-main", id: s1.json.id })]);
  const next = await open({ arm: "cso:cso", task: "u2" });
  expect([next.status, next.json.code, next.json.item]).toEqual([423, "E_SM_FINALIZE_HALT", "cso-main"]);
  expect(await served.stop()).toBe(2);
  const relaunch = await serve([{ item: "cso-main", arm: "cso-main", arms: ["cso:cso"] }]).then(async (s) => (await s.stop(), "served"), (err: { code?: string; message: string }) => err.code + " " + err.message);
  expect(relaunch).toStartWith("E_SM_FINALIZE_HALT line item cso-main halted in run r1");
  expect(relaunch).toContain(s1.json.id);
  local.close?.();
});

test("the cso session runner's finalize halt stops the driver, which exits 2", async () => {
  const logs: string[] = [];
  const { serve, local } = ledger({ "cso-smoke": { cap: 62 } });
  const served = await serve([{ item: "cso-smoke", arm: "cso-smoke", arms: ["cso:none"] }], { log: (l: string) => void logs.push(l) });
  const res = await fetch(served.control + "/stop", { method: "POST", body: JSON.stringify({ code: "E_CSO_FINALIZE_HALT", session: "u1/none/stage0/0 attempt 1" }) });
  expect(res.status).toBeLessThan(500);
  expect(await served.stop()).toBe(2);
  expect(logs.some((l) => l.startsWith("E_CSO_FINALIZE_HALT outcome driver: the cso session runner halted session u1/none/stage0/0 attempt 1"))).toBe(true);
  local.close?.();
});

test("a cso runner's finalize halt holds the next launch until a relaunch lifts it by the session the halt names", async () => {
  const { serve, local, root } = ledger({ "cso-smoke": { cap: 62 } });
  const stages: StageSpec[] = [{ item: "cso-smoke", arm: "cso-smoke", arms: ["cso:none"] }];
  const served = await serve(stages);
  await fetch(served.control + "/stop", { method: "POST", body: JSON.stringify({ code: "E_CSO_FINALIZE_HALT", session: "u1/none/stage0/0 attempt 1" }) });
  expect(await served.stop()).toBe(2);
  const tryServe = (extra: Partial<ServeOptions> = {}) => serve(stages, extra).then(async (s) => (await s.stop(), "served"), (err: { code?: string; message: string }) => err.code + " " + err.message);
  const held = await tryServe();
  expect(held).toStartWith("E_CSO_FINALIZE_HALT line item cso-smoke halted in run r1");
  expect(held).toContain("--lift-halt 'u1/none/stage0/0 attempt 1'");
  expect(await tryServe({ lift_halts: ["u1/none/stage0/0 attempt 2"] })).toStartWith("E_USAGE --lift-halt u1/none/stage0/0 attempt 2 names no halt still standing");
  expect(await tryServe({ lift_halts: ["u1/none/stage0/0 attempt 1"] })).toBe("served");
  const events = readFileSync(join(root, "run", "sessions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(events.filter((e) => e.event === "lift").map((e) => [e.id, e.item])).toEqual([["u1/none/stage0/0 attempt 1", ""]]);
  expect(await tryServe()).toBe("served");
  local.close?.();
});
