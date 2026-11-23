// Copyright (c) 2026 Garry Tan. MIT License.
// Part P's route, keyless: the real metering proxy against a stub OpenRouter upstream that replays answers OpenRouter
// really sent (tests/fixtures/openrouter-generation-ids.json: the msg_ body id, the X-Generation-Id header and the
// generation record of that id). A particle-1 Messages call leaves the proxy pinned to Particle AI with fallbacks off and
// data collection denied, and the served-provider check reads each answer's generation record through the proxy's free
// route by the header's id, refusing one served by another provider or one whose reply had no header.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeteringProxy } from "../../src/runner/proxy/metering-proxy.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";
import { answerIds, checkServedBy, claudeRoute, EXT_CLAUDE_STAGES, extArmOf, extLimits, particleRoute, proxyLookup } from "../../lanes/outcome-skills/h2h/ext/route.ts";
import { readExtPrereg } from "../../lanes/outcome-skills/h2h/ext/prereg.ts";
import FIXTURE from "../fixtures/openrouter-generation-ids.json";

const x = readExtPrereg();
const MODEL = "particle-ai/particle-1";

class Ledger implements ReservationLedger {
  n = 0;
  rows = new Map<string, Reservation>();
  async reserve(r: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    const reservation: Reservation = { reservation_id: "res_" + ++this.n, idempotency_key: r.idempotency_key, lease_id: r.lease_id, cell: r.cell, max_micros: r.max_micros, state: "reserved", spent_micros: null, usage: null };
    this.rows.set(reservation.reservation_id, reservation);
    return { ok: true, reservation };
  }
  async settle(id: string, outcome: CallOutcome): Promise<LedgerReply> {
    const r = this.rows.get(id)!;
    Object.assign(r, outcome.kind === "spent" ? { state: "settled", spent_micros: outcome.spent_micros, usage: outcome.usage } : { state: "unknown" });
    return { ok: true, reservation: r };
  }
}

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
});

type Recorded = (typeof FIXTURE.answers)[number];
const PARTICLE = FIXTURE.answers.filter((a) => a.record.provider_name === "Particle AI");
const OTHER = FIXTURE.answers.find((a) => a.record.provider_name !== "Particle AI")!;
const NO_HEADER = { ...PARTICLE[1]!, x_generation_id: null as string | null, answer_id: "msg_noheader0123456789ab" };

/** The real proxy with a stub OpenRouter that sends the given recorded answers in turn (body id and X-Generation-Id
 *  header as recorded) and answers a generation lookup only for a recorded generation id, as OpenRouter did. */
function setup(answers: Array<Omit<Recorded, "x_generation_id"> & { x_generation_id: string | null }>) {
  const dir = mkdtempSync(join(tmpdir(), "h2hx-route-"));
  const sent: { url: string; body: Record<string, unknown> | null }[] = [];
  let n = 0;
  const proxy = new MeteringProxy({
    ledger: new Ledger(), leaseId: "l1", host: "127.0.0.1", managementSocket: join(dir, "m.sock"), managementToken: "management-token-0123456789abcdef", journal: join(dir, "journal.ndjson"),
    retry: { attempts: 1, elapsed_ms: 60_000 }, env: { OPENROUTER_API_KEY: "sk-or-stub-0123456789" }, sleep: async () => {},
    fetch: async (url, init) => {
      const u = String(url);
      sent.push({ url: u, body: init.body ? JSON.parse(String(init.body)) : null });
      const gen = u.match(/\/v1\/generation\?id=([A-Za-z0-9_-]+)$/);
      if (gen) {
        const hit = FIXTURE.answers.find((a) => a.x_generation_id === gen[1]);
        return hit ? Response.json({ data: hit.record }) : new Response(PARTICLE[0]!.record_by_answer_id.text, { status: 400 });
      }
      const a = answers[n++]!;
      return Response.json({ id: a.answer_id, type: "message", role: "assistant", model: MODEL, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }, { headers: a.x_generation_id ? { "x-generation-id": a.x_generation_id } : {} });
    },
  });
  proxy.start();
  cleanup.push(() => {
    proxy.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const route = particleRoute(x);
  const slot = proxy.bind({ cell: { run_id: "r1", arm: "h2hx:p-gstack", task: "t1", model: MODEL, trial: 1, attempt: 1 }, models: [route.slot_model], allowance_micros: 5_000_000 });
  const base = "http://127.0.0.1:" + proxy.port;
  const call = async () => {
    const res = await fetch(base + "/" + slot.slot + "/openrouter/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": slot.token }, body: JSON.stringify({ model: MODEL, max_tokens: 512, messages: [{ role: "user", content: "fix it" }] }) });
    return { status: res.status, body: (await res.json()) as { id?: string } };
  };
  return { route, sent, call, lookup: proxyLookup(base, slot.slot, slot.token) };
}

describe("h2hx part P route (particle-1 through the proxy to OpenRouter)", () => {
  test("prereg.json's route matches the proxy's price row: Particle AI only, no fallbacks, data collection denied", () => {
    const r = particleRoute(x);
    expect(r).toEqual({ provider: "openrouter", model: MODEL, slot_model: "openrouter:" + MODEL, harbor_model: "anthropic/" + MODEL, served_by: ["Particle AI"] });
    expect(claudeRoute("p-none", x)).toEqual(r);
    expect(claudeRoute("l-gstack", x).slot_model).toBe("anthropic:claude-opus-5-5");
    expect(() => claudeRoute("s-gstack", x)).toThrow(/^E_H2HX_INPUT /);
  });

  test("a route naming another provider, allowing fallbacks or allowing data collection is refused", () => {
    const P = x.parts.P;
    const other = (route: Partial<typeof P.route>) => ({ ...x, parts: { ...x.parts, P: { ...P, route: { ...P.route, ...route } } } });
    expect(() => particleRoute(other({ provider_only: ["Fireworks"] }))).toThrow(/^E_H2HX_ROUTE_CONFIG part P's route names provider Fireworks/);
    expect(() => particleRoute(other({ allow_fallbacks: true }))).toThrow(/^E_H2HX_ROUTE_CONFIG .*allow_fallbacks true/);
    expect(() => particleRoute(other({ data_collection: "allow" }))).toThrow(/^E_H2HX_ROUTE_CONFIG .*data_collection allow/);
    expect(() => particleRoute(other({ via: "anthropic" }))).toThrow(/^E_H2HX_ROUTE_CONFIG /);
  });

  test("a particle-1 call through the proxy leaves pinned to Particle AI, and its answer's record passes the check", async () => {
    const t = setup(PARTICLE);
    const a = await t.call(), b = await t.call();
    expect([a.status, b.status]).toEqual([200, 200]);
    const msg = t.sent.filter((s) => s.url.endsWith("/v1/messages"));
    expect(msg).toHaveLength(2);
    expect(msg[0]!.url).toBe("https://openrouter.ai/api/v1/messages");
    expect(msg[0]!.body!.provider).toMatchObject({ only: ["particle-ai"], allow_fallbacks: false, data_collection: "deny" });
    const synthetic = JSON.stringify({ type: "assistant", message: { id: "6f1c0d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f", model: "<synthetic>", content: [{ type: "text", text: "API Error: 402" }] } });
    const transcript = [a, b].map((r) => JSON.stringify({ type: "assistant", message: { id: r.body.id, content: [] } })).join("\n") + "\n" + JSON.stringify({ type: "user" }) + "\n" + synthetic + "\n";
    expect(answerIds(transcript)).toEqual(PARTICLE.map((a) => a.answer_id));
    expect(await checkServedBy(answerIds(transcript), t.lookup, t.route)).toEqual({ checked: 2, served_by: ["Particle AI"] });
    const looked = t.sent.filter((s) => s.url.includes("/v1/generation")).map((s) => s.url);
    expect(looked).toEqual(PARTICLE.map((a) => "https://openrouter.ai/api/v1/generation?id=" + a.x_generation_id));
  });

  test("an answer served by another provider is refused, and so is one whose reply had no X-Generation-Id header", async () => {
    const t = setup([PARTICLE[0]!, OTHER, NO_HEADER]);
    await t.call();
    await t.call();
    await t.call();
    await expect(checkServedBy([PARTICLE[0]!.answer_id, OTHER.answer_id], t.lookup, t.route)).rejects.toThrow(new RegExp("^E_H2HX_ROUTE_PROVIDER answer " + OTHER.answer_id + " for particle-ai/particle-1 was served by \"Google AI Studio\""));
    await expect(checkServedBy([NO_HEADER.answer_id], t.lookup, t.route)).rejects.toThrow(new RegExp("^E_H2HX_ROUTE_RECORD no generation id was recorded for answer " + NO_HEADER.answer_id + " .*lookup status 400"));
    await expect(checkServedBy(["msg_neverserved0123456789"], t.lookup, t.route)).rejects.toThrow(/^E_H2HX_ROUTE_RECORD no generation id was recorded for answer msg_neverserved0123456789 /);
    await expect(checkServedBy(["gen 1"], t.lookup, t.route)).rejects.toThrow(/^E_H2HX_ROUTE_RECORD /);
  });

  test("a generation id passed straight to the lookup is not taken as an answer's record", async () => {
    const t = setup(PARTICLE);
    await t.call();
    await expect(checkServedBy([PARTICLE[0]!.x_generation_id], t.lookup, t.route)).rejects.toThrow(/^E_H2HX_ROUTE_RECORD no generation id was recorded for answer gen-/);
  });

  test("part P's sessions run at a $5 allowance (or $10 after the doubling rule) on the h2hx-p items", () => {
    expect(extLimits("P", undefined, x)).toEqual({ session_cap_usd: 5, wall_limit_sec: 5400, max_turns: 300 });
    expect(extLimits("P", 10, x).session_cap_usd).toBe(10);
    expect(() => extLimits("P", 25, x)).toThrow(/^E_H2HX_INPUT a part P session allowance is \$5/);
    expect(EXT_CLAUDE_STAGES["h2hx-p-main"]).toHaveLength(9);
    expect(extArmOf("h2hx:p-gstack-pony", "h2hx-p-main")).toBe("p-gstack-pony");
    expect(() => extArmOf("h2hx:p-gstack", "h2hx-l-main")).toThrow(/^E_H2HX_INPUT item h2hx-l-main does not pay for h2hx:p-gstack/);
  });
});
