// Copyright (c) 2026 Garry Tan. MIT License.
// The metering proxy's removal of a cell voice's hosted web_search tool (review-models prereg 2026-11-24-geva-590, section
// 10 item 2), on planted requests, and the keyless preflights for it and for Carbon's 2026-12-01 route (item 6).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeWebSearchTools, refuseRequestShape, PriceError } from "../../src/runner/pricing/prices.ts";
import { MeteringProxy, type BindRequest } from "../../src/runner/proxy/metering-proxy.ts";
import { carbonRoutePreflight, plantTools, PLANTED_WEB_SEARCH, recordedVoiceRequest, voiceWebSearchPreflight } from "../../src/trial/review/proxy-preflight.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";

class Ledger implements ReservationLedger {
  reservations = new Map<string, Reservation>();
  async reserve(request: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    const reservation: Reservation = { reservation_id: "res_" + (this.reservations.size + 1), ...request, state: "reserved", spent_micros: null, usage: null };
    this.reservations.set(reservation.reservation_id, reservation);
    return { ok: true, reservation };
  }
  async settle(id: string, outcome: CallOutcome): Promise<LedgerReply> {
    const r = this.reservations.get(id)!;
    Object.assign(r, outcome.kind === "spent" ? { state: "settled", spent_micros: outcome.spent_micros, usage: outcome.usage } : { state: "unknown" });
    return { ok: true, reservation: r };
  }
}

const cell: Omit<CellAttempt, "meter_id"> = { run_id: "r1", arm: "OS", task: "u1", model: "claude-opus-5-5", trial: 1, attempt: 1 };
let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanup) c();
  cleanup = [];
});

function rig(removeVoiceWebSearch = true) {
  const dir = mkdtempSync(join(tmpdir(), "rm-voice-"));
  const sent: any[] = [];
  const proxy = new MeteringProxy({
    ledger: new Ledger(),
    leaseId: "l1",
    host: "127.0.0.1",
    managementSocket: join(dir, "m.sock"),
    managementToken: "management-token-0123456789abcdef",
    journal: join(dir, "journal.ndjson"),
    retry: { attempts: 1, elapsed_ms: 10_000 },
    env: { OPENAI_API_KEY: "stub", ANTHROPIC_API_KEY: "stub", OPENROUTER_API_KEY: "stub" },
    fetch: async (_url, init) => {
      sent.push(JSON.parse(String(init.body)));
      return Response.json({ id: "x", usage: { input_tokens: 10, output_tokens: 2, prompt_tokens: 10, completion_tokens: 2 } });
    },
    removeVoiceWebSearch,
  });
  proxy.start();
  cleanup.push(() => {
    proxy.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const bind = (r: Partial<BindRequest> = {}) => proxy.bind({ cell, models: ["anthropic:claude-opus-5-5", "openai:gpt-6.2-sol", "openrouter:openai/gpt-6.1-sol"], allowance_micros: 50_000_000, ...r });
  const call = (b: { slot: string; token: string }, path: string, body: unknown) => fetch("http://127.0.0.1:" + proxy.port + "/" + b.slot + path, { method: "POST", headers: { authorization: "Bearer " + b.token, "content-type": "application/json" }, body: JSON.stringify(body) });
  const journal = () => readFileSync(join(dir, "journal.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { proxy, sent, bind, call, journal };
}

const responses = (tools: unknown[], extra: Record<string, unknown> = {}) => ({ model: "gpt-6.2-sol", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "review" }] }], tools, ...extra });

describe("removeWebSearchTools", () => {
  // Value: protects=the one hosted tool the voice may lose is web_search, wherever the hosted-tool rule finds it, and nothing else is touched; fails_when=another hosted tool is removed, a client function named web_search is removed, a nested copy is missed or a replayed tool input is edited; why_new=GEVA-590 section 10 item 2; seam=removeWebSearchTools; no_claim=what a provider does with the request
  test("removes web_search under its current, preview and dated names from every tools list, and nothing else", () => {
    const body: Record<string, any> = {
      tools: [{ type: "function", name: "web_search" }, { type: "web_search" }, { type: "web_fetch" }, { type: "web_search_preview_2025_03_11" }, { type: "file_search" }],
      input: [{ type: "additional_tools", tools: [{ type: "namespace", name: "n", tools: [{ type: "web_search", external_web_access: false }, { type: "custom", name: "exec" }] }] }, { type: "message", content: [{ type: "tool_use", input: { tools: [{ type: "web_search" }] } }] }],
    };
    expect(removeWebSearchTools(body)).toEqual([
      { path: "tools[1]", type: "web_search" },
      { path: "tools[3]", type: "web_search_preview_2025_03_11" },
      { path: "input[0].tools[0].tools[0]", type: "web_search" },
    ]);
    expect(body.tools.map((t: any) => t.type)).toEqual(["function", "web_fetch", "file_search"]);
    expect(body.input[0].tools[0].tools).toEqual([{ type: "custom", name: "exec" }]);
    expect(body.input[1].content[0].input.tools).toEqual([{ type: "web_search" }]);
    expect(() => refuseRequestShape("openai", body)).toThrow(PriceError);
    expect(removeWebSearchTools({ tools: [{ type: "web_search_20250305", name: "web_search" }] })).toEqual([]);
  });
});

describe("the proxy on planted voice requests", () => {
  // Value: protects=only the slot's voice loses web_search, the call goes on and is metered, and the removal is journaled with its request id and cell; fails_when=the voice's request is refused, the main model's web_search passes, the journal lacks the removal or its request id, or the upstream still sees the tool; why_new=GEVA-590 section 10 item 2; seam=MeteringProxy.forward and bind's voices; no_claim=what Codex sends
  test("a voice request loses web_search and passes; the same tool from the session's model is refused", async () => {
    const t = rig();
    const b = t.bind({ voices: ["openai:gpt-6.2-sol"] });
    const res = await t.call(b, "/openai/v1/responses", responses([{ type: "web_search" }, { type: "function", name: "f", parameters: {} }]));
    expect(res.status).toBe(200);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].tools).toEqual([{ type: "function", name: "f", parameters: {} }]);
    const lines = t.journal();
    const removed = lines.find((l) => l.kind === "tool_removed");
    expect(removed).toMatchObject({ meter_id: b.meter_id, cell: { ...cell, meter_id: b.meter_id }, provider: "openai", route: "/v1/responses", model: "gpt-6.2-sol", removed: [{ path: "tools[0]", type: "web_search" }] });
    expect(removed.request_id).toMatch(/^rq_/);
    expect(lines.filter((l) => l.kind === "reserve" || l.kind === "request").map((l) => l.request_id)).toEqual([removed.request_id, removed.request_id]);
    expect((await t.proxy.finalize(b.meter_id)).web_search_removed).toBe(1);

    const main = await t.call(b, "/anthropic/v1/messages", { model: "claude-opus-5-5", max_tokens: 100, messages: [{ role: "user", content: "x" }], tools: [{ type: "web_search", name: "web_search" }] });
    expect(main.status).toBe(402);
    expect(t.sent).toHaveLength(1);
  });

  // Value: protects=the voice keeps today's refusal for every other hosted tool and for web_search options, a voice routed through OpenRouter is covered, and an untagged slot or an off proxy changes nothing; fails_when=a web_fetch, file_search or web_search_options passes, or removal runs without its tag or option; why_new=GEVA-590 section 10 item 2; seam=MeteringProxy.forward; no_claim=OpenRouter's handling
  test("every other hosted tool still refuses, and only a tagged voice on a proxy with the option loses web_search", async () => {
    const t = rig();
    const b = t.bind({ voices: ["openai:gpt-6.2-sol", "openrouter:openai/gpt-6.1-sol"] });
    for (const tools of [[{ type: "web_search" }, { type: "web_fetch" }], [{ type: "file_search" }], [{ type: "code_interpreter" }]]) expect((await t.call(b, "/openai/v1/responses", responses(tools))).status).toBe(402);
    expect((await t.call(b, "/openai/v1/chat/completions", { model: "gpt-6.2-sol", messages: [{ role: "user", content: "x" }], web_search_options: {} })).status).toBe(402);
    expect(t.sent).toHaveLength(0);
    const refusal = t.journal().filter((l) => l.kind === "refusal")[0];
    expect(refusal.request_id).toBe(t.journal().find((l) => l.kind === "tool_removed").request_id);
    expect((await t.call(b, "/openrouter/v1/chat/completions", { model: "openai/gpt-6.1-sol", messages: [{ role: "user", content: "x" }], tools: [{ type: "web_search" }] })).status).toBe(200);
    expect(t.sent[0].tools).toEqual([]);

    const plain = t.bind();
    expect((await t.call(plain, "/openai/v1/responses", responses([{ type: "web_search" }]))).status).toBe(402);
    const off = rig(false);
    const ob = off.bind({ voices: ["openai:gpt-6.2-sol"] });
    expect((await off.call(ob, "/openai/v1/responses", responses([{ type: "web_search" }]))).status).toBe(402);
    expect(off.sent).toHaveLength(0);
    expect(off.journal().some((l) => l.kind === "tool_removed")).toBe(false);
  });

  // Value: protects=a slot can only tag a voice it admits; fails_when=bind accepts a voice off its model list; why_new=GEVA-590 section 10 item 2; seam=MeteringProxy.bind; no_claim=none
  test("bind refuses a voice that is not among its models", () => {
    const t = rig();
    expect(() => t.bind({ voices: ["openai:gpt-6.2-astra"] })).toThrow("E_USAGE: metering proxy: bind's voices must be a list of ids from its models");
  });
});

describe("keyless preflights", () => {
  // Value: protects=a recorded gstack voice request passes the proxy with its web_search removed, against a stub upstream, before any review spends; fails_when=any preflight check fails; why_new=GEVA-590 section 10 item 2; seam=voiceWebSearchPreflight; no_claim=that a live Codex 0.170.0 voice sends web_search (the recording shows it sent none)
  test("the recorded voice request passes as recorded and with planted web_search removed", async () => {
    const recorded = recordedVoiceRequest();
    expect(JSON.stringify(recorded)).not.toContain("web_search");
    expect(recorded.model).toBe("gpt-6.2-sol");
    const report = await voiceWebSearchPreflight(recorded);
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(report.checks).toHaveLength(8);
    expect(report.ok).toBe(true);
    expect(() => plantTools({ input: [] }, PLANTED_WEB_SEARCH)).toThrow("E_USAGE");
  });

  // Value: protects=a Carbon judge request routes and settles at the 2026-12-01 ceiling before any review spends; fails_when=the row, the routing or the settlement holds the intro rate; why_new=GEVA-590 section 10 item 6; seam=carbonRoutePreflight; no_claim=OpenRouter's live endpoint list
  test("a Carbon judge request routes at $4 and $20 and settles there", async () => {
    const report = await carbonRoutePreflight();
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(report.ok).toBe(true);
  });
});
