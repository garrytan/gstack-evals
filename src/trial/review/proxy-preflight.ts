// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless proxy preflights for the review-models eval (prereg 2026-11-24-geva-590, section 10 items 2 and 6). Each runs
// the real metering proxy in process on loopback with stub provider keys, an in-memory ledger and a stub upstream in place
// of fetch, so no call leaves the machine and nothing is paid.
// - voiceWebSearchPreflight: a gstack voice request recorded from Codex 0.170.0 (recorded/README.md) passes a gstack cell's
//   slot as recorded, with nothing removed. With a web_search tool planted in its top-level tools list and in its
//   additional_tools item, it passes with both removed: the upstream body is the recorded one, an empty tools list and the
//   proxy's own fields, the journal holds one tool_removed line naming both, and the call's request line carries its
//   request_id. The same web_search keeps today's refusal from the session's own model, from a slot that names no voice and
//   on a proxy without removeVoiceWebSearch, and a web_fetch beside it is still refused.
// - carbonRoutePreflight: a Carbon judge request goes out pinned to google-vertex with max_price at $4 and $20 (Carbon's
//   2026-12-01 rate), and reserves and settles at that rate, at the row even when OpenRouter reports the lower intro cost.
// Run: bun src/trial/review/proxy-preflight.ts. It prints both reports as JSON and exits 0 when every check passes, else
// 2 with an E_RM_PROXY_PREFLIGHT line naming each failed check.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatPrice, priceRequest, removeWebSearchTools, reservationMicros } from "../../runner/pricing/prices.ts";
import { MeteringProxy, type BindRequest } from "../../runner/proxy/metering-proxy.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../types.ts";

export const RECORDED_VOICE_REQUEST = join(import.meta.dir, "recorded", "codex-0.170-voice-request.json");
export const MAIN = "anthropic:claude-opus-5-5";
export const VOICE = "openai:gpt-6.2-sol";
export const CARBON = "google/gemini-4-carbon";
/** The tool gstack's web_search "cached" stands for, in the Responses shape: hosted web search without live access. */
export const PLANTED_WEB_SEARCH = { type: "web_search", external_web_access: false };
/** Carbon's routing at its 2026-12-01 rate: google-vertex only, max_price at $4 and $20 and the doubled image price. */
export const CARBON_ROUTING = { only: ["google-vertex"], allow_fallbacks: false, data_collection: "deny", max_price: { prompt: 4, completion: 20, request: 0, image: 0.000004 } };

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
export interface PreflightReport {
  preflight: "voice-web-search" | "carbon-route";
  ok: boolean;
  checks: Check[];
}

const STUB_KEYS = { ANTHROPIC_API_KEY: "stub-not-a-key", OPENAI_API_KEY: "stub-not-a-key", OPENROUTER_API_KEY: "stub-not-a-key" };
const CELL: Omit<CellAttempt, "meter_id"> = { run_id: "rm-preflight", arm: "OS", task: "toy-unit", model: "claude-opus-5-5", trial: 1, attempt: 1 };

class MemoryLedger implements ReservationLedger {
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

type Upstream = (url: string, body: any) => Response;
interface Rig {
  proxy: MeteringProxy;
  ledger: MemoryLedger;
  sent: Array<{ url: string; body: any }>;
  journal: () => Array<Record<string, any>>;
  bind: (request: Partial<BindRequest>) => { slot: string; token: string; meter_id: string };
  call: (binding: { slot: string; token: string }, path: string, body: unknown) => Promise<Response>;
}

async function withProxy<T>(upstream: Upstream, removeVoiceWebSearch: boolean, run: (rig: Rig) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "rm-proxy-preflight-"));
  const ledger = new MemoryLedger();
  const sent: Rig["sent"] = [];
  const proxy = new MeteringProxy({
    ledger,
    leaseId: "rm-preflight",
    host: "127.0.0.1",
    managementSocket: join(dir, "management.sock"),
    managementToken: "rm-preflight-management-token",
    journal: join(dir, "journal.ndjson"),
    retry: { attempts: 1, elapsed_ms: 10_000 },
    env: STUB_KEYS,
    fetch: async (url, init) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      sent.push({ url, body });
      return upstream(url, body);
    },
    ...(removeVoiceWebSearch ? { removeVoiceWebSearch: true } : {}),
  });
  proxy.start();
  try {
    return await run({
      proxy,
      ledger,
      sent,
      journal: () => readFileSync(join(dir, "journal.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
      bind: (request) => proxy.bind({ cell: CELL, models: [MAIN, VOICE], allowance_micros: 50_000_000, ...request }),
      call: (b, path, body) => fetch("http://127.0.0.1:" + proxy.port + "/" + b.slot + path, { method: "POST", headers: { authorization: "Bearer " + b.token, "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
  } finally {
    proxy.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

const check = (name: string, ok: boolean, detail: string): Check => ({ name, ok, detail });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** The body the proxy sent, less the fields it adds to every OpenAI Responses call. */
const withoutProxyFields = (body: any) => {
  const { max_output_tokens: _cap, service_tier: _tier, ...rest } = body;
  return rest;
};
const responsesStream = () => {
  const usage = { input_tokens: 4000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 100 }, total_tokens: 4200 };
  const events = [{ type: "response.created", response: { id: "resp_1" } }, { type: "response.completed", response: { id: "resp_1", status: "completed", usage } }];
  return new Response(events.map((e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
};

/** The recorded voice request, read fresh each time. */
export const recordedVoiceRequest = (): Record<string, any> => JSON.parse(readFileSync(RECORDED_VOICE_REQUEST, "utf8"));

/** The recorded request with tools planted: in a top-level tools list and at the end of its additional_tools item. */
export function plantTools(body: Record<string, any>, ...tools: object[]): Record<string, any> {
  const out = structuredClone(body);
  const item = (out.input as any[]).find((i) => i?.type === "additional_tools");
  if (!item) throw new Error("E_USAGE: the recorded voice request has no additional_tools item to plant a tool in");
  item.tools.push(...structuredClone(tools));
  out.tools = structuredClone(tools);
  return out;
}

export async function voiceWebSearchPreflight(recorded: Record<string, any> = recordedVoiceRequest()): Promise<PreflightReport> {
  const checks: Check[] = [];
  const toolsAt = (recorded.input as any[]).findIndex((i) => i?.type === "additional_tools");
  const toolCount = (recorded.input as any[])[toolsAt]?.tools?.length ?? 0;
  await withProxy(responsesStream, true, async (rig) => {
    const voice = rig.bind({ voices: [VOICE] });
    const asRecorded = await rig.call(voice, "/openai/v1/responses", recorded);
    await asRecorded.text();
    const removedAsRecorded = rig.journal().filter((l) => l.kind === "tool_removed");
    checks.push(check("the recorded voice request passes as recorded, with nothing removed", asRecorded.status === 200 && rig.sent.length === 1 && removedAsRecorded.length === 0 && same(withoutProxyFields(rig.sent[0]!.body), recorded), "status " + asRecorded.status + ", " + rig.sent.length + " upstream send(s), " + removedAsRecorded.length + " tool_removed line(s)"));

    const planted = plantTools(recorded, PLANTED_WEB_SEARCH);
    const res = await rig.call(voice, "/openai/v1/responses", planted);
    await res.text();
    const out = rig.sent[1]?.body;
    const left = out ? removeWebSearchTools(structuredClone(out)) : [];
    const expected = { ...structuredClone(recorded), tools: [] };
    const lines = rig.journal();
    const removed = lines.filter((l) => l.kind === "tool_removed");
    const request = lines.filter((l) => l.kind === "request").at(-1);
    const meter = await rig.proxy.finalize(voice.meter_id);
    const paths = ["input[" + toolsAt + "].tools[" + toolCount + "]", "tools[0]"];
    checks.push(check("a planted web_search passes the voice's slot with every copy removed", res.status === 200 && rig.sent.length === 2 && left.length === 0 && same(withoutProxyFields(out), expected), "status " + res.status + ", " + left.length + " web_search tool(s) left in the upstream body"));
    checks.push(check("one tool_removed line names the request, the cell and both removed tools", removed.length === 1 && typeof removed[0]!.request_id === "string" && removed[0]!.cell?.arm === CELL.arm && removed[0]!.cell?.meter_id === voice.meter_id && removed[0]!.model === "gpt-6.2-sol" && same(removed[0]!.removed, paths.map((path) => ({ path, type: "web_search" }))), JSON.stringify(removed.map((l) => ({ request_id: l.request_id, removed: l.removed })))));
    checks.push(check("the sent call's request line carries the removal's request_id, and the meter counts both tools", request?.request_id === removed[0]?.request_id && meter.web_search_removed === 2, "request line request_id " + (request?.request_id ?? "none") + ", meter web_search_removed " + (meter.web_search_removed ?? 0)));

    const before = rig.sent.length;
    const mixed = await rig.call(voice, "/openai/v1/responses", plantTools(recorded, PLANTED_WEB_SEARCH, { type: "web_fetch" }));
    const refusal = rig.journal().filter((l) => l.kind === "refusal").at(-1);
    checks.push(check("a web_fetch beside it is still refused, with the removal's request_id on the refusal", mixed.status === 402 && rig.sent.length === before && refusal?.code === "E_ALLOWANCE" && typeof refusal?.request_id === "string", "status " + mixed.status + ", refusal " + (refusal?.code ?? "none")));

    const main = await rig.call(voice, "/anthropic/v1/messages", { model: "claude-opus-5-5", max_tokens: 1000, messages: [{ role: "user", content: "review" }], tools: [{ type: "web_search", name: "web_search" }] });
    checks.push(check("web_search from the session's own model keeps today's refusal", main.status === 402 && rig.sent.length === before, "status " + main.status));

    const plain = rig.bind({});
    const noVoice = await rig.call(plain, "/openai/v1/responses", planted);
    checks.push(check("a slot that names no voice keeps today's refusal", noVoice.status === 402 && rig.sent.length === before, "status " + noVoice.status));
  });
  await withProxy(responsesStream, false, async (rig) => {
    const voice = rig.bind({ voices: [VOICE] });
    const res = await rig.call(voice, "/openai/v1/responses", plantTools(recorded, PLANTED_WEB_SEARCH));
    checks.push(check("a proxy without removeVoiceWebSearch keeps today's refusal for the voice", res.status === 402 && rig.sent.length === 0 && !rig.journal().some((l) => l.kind === "tool_removed"), "status " + res.status));
  });
  return { preflight: "voice-web-search", ok: checks.every((c) => c.ok), checks };
}

/** A judge request as the Carbon judge sends one: chat completions, text only, its own output cap. */
export const carbonJudgeRequest = () => ({ model: CARBON, max_tokens: 16_000, messages: [{ role: "user", content: "Planted preflight brief: the bug and its fix, then numbered findings. Rule on each finding: names the bug, doesn't, or can't tell." }] });

export async function carbonRoutePreflight(): Promise<PreflightReport> {
  const checks: Check[] = [];
  const row = chatPrice("openrouter:" + CARBON);
  checks.push(check("the Carbon row holds its 2026-12-01 rate, pinned to google-vertex", !!row && row.input === 4 && row.output === 20 && row.cache_read === 0.2 && row.cache_write === 0.375 && same(row.providers, ["google-vertex"]) && row.image === 0.000004, JSON.stringify(row ?? null)));
  const usage = { prompt_tokens: 10_000, completion_tokens: 2_000, cost: 0.04 };
  const answer = () => new Response(JSON.stringify({ id: "gen-preflight", model: CARBON, provider: "Google", choices: [{ index: 0, message: { role: "assistant", content: "1: names the bug" }, finish_reason: "stop" }], usage }), { headers: { "content-type": "application/json", "x-generation-id": "gen-preflight" } });
  await withProxy(answer, false, async (rig) => {
    const judge = rig.bind({ models: ["openrouter:" + CARBON], cell: { ...CELL, arm: "judge", model: CARBON } });
    const res = await rig.call(judge, "/openrouter/v1/chat/completions", carbonJudgeRequest());
    await res.text();
    const out = rig.sent[0]?.body;
    checks.push(check("the judge request goes out pinned to google-vertex with max_price at $4 and $20", res.status === 200 && same(out?.provider, CARBON_ROUTING), "status " + res.status + ", provider " + JSON.stringify(out?.provider ?? null)));
    const reservation = [...rig.ledger.reservations.values()][0];
    const price = out ? priceRequest("openrouter", out, 16_000, "/v1/chat/completions") : null;
    checks.push(check("it reserves at $4 input and $20 output", !!price && price.input === 4 && price.output === 20 && reservation?.max_micros === reservationMicros(price), "reserved " + (reservation?.max_micros ?? "nothing") + " micros"));
    const settled = 10_000 * 4 + 2_000 * 20;
    checks.push(check("it settles at the new rate even when OpenRouter reports the intro cost", reservation?.state === "settled" && reservation.spent_micros === settled, "settled " + (reservation?.spent_micros ?? "nothing") + " micros, expected " + settled + "; OpenRouter reported " + usage.cost * 1e6));
  });
  return { preflight: "carbon-route", ok: checks.every((c) => c.ok), checks };
}

if (import.meta.main) {
  const reports = [await voiceWebSearchPreflight(), await carbonRoutePreflight()];
  console.log(JSON.stringify(reports, null, 2));
  const failed = reports.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => r.preflight + ": " + c.name));
  if (failed.length) {
    console.error("E_RM_PROXY_PREFLIGHT: " + failed.join("; "));
    process.exit(2);
  }
}
