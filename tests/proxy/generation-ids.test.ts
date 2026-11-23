// Copyright (c) 2026 Garry Tan. MIT License.
// The metering proxy records each OpenRouter answer's X-Generation-Id header with the answer's own id, streamed or not,
// and its free generation route reads the record of that generation id when asked for the answer id. The upstream
// replays answers OpenRouter really sent (tests/fixtures/openrouter-generation-ids.json).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { MeteringProxy } from "../../src/runner/proxy/metering-proxy.ts";
import FIXTURE from "../fixtures/openrouter-generation-ids.json";

const MODEL = "particle-ai/particle-1";
type Answer = Omit<(typeof FIXTURE.answers)[number], "x_generation_id"> & { x_generation_id: string | null };
let dirs: string[] = [];
let proxies: MeteringProxy[] = [];
afterEach(() => {
  for (const p of proxies.splice(0)) p.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function stream(a: Answer): string {
  const events = [
    { type: "message_start", message: { id: a.answer_id, type: "message", role: "assistant", model: MODEL, content: [], usage: { input_tokens: 12, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 12, output_tokens: 2 } },
    { type: "message_stop" },
  ];
  return events.map((e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
}

function setup(answers: Answer[]) {
  const dir = mkdtempSync(join(tmpdir(), "gen-ids-"));
  dirs.push(dir);
  const ledger = LocalLedger.open(join(dir, "ledger.sqlite"));
  ledger.addLease({ schema: 1, kind: "lease", item: "gen", seq: 1, lease_id: "gen.0001.abcdef", run_id: "r1", machine_id: "m1", reserved_micros: 10_000_000, expires_at: new Date(Date.now() + 3_600_000).toISOString(), created_at: new Date().toISOString() });
  const looked: string[] = [];
  let n = 0;
  const journal = join(dir, "journal.ndjson");
  const proxy = new MeteringProxy({
    ledger, leaseId: "gen.0001.abcdef", host: "127.0.0.1", managementSocket: join(dir, "m.sock"), managementToken: "management-token-0123456789abcdef", journal, retry: { attempts: 1, elapsed_ms: 60_000 }, env: { OPENROUTER_API_KEY: "sk-or-stub-0123456789" },
    fetch: async (url) => {
      const u = String(url);
      const gen = u.match(/\/v1\/generation\?id=([A-Za-z0-9_-]+)$/);
      if (gen) {
        looked.push(gen[1]!);
        const hit = FIXTURE.answers.find((a) => a.x_generation_id === gen[1]);
        return hit ? Response.json({ data: hit.record }) : new Response(FIXTURE.answers[0]!.record_by_answer_id.text, { status: 400 });
      }
      const a = answers[n++]!;
      const headers: Record<string, string> = { "content-type": a.stream ? "text/event-stream" : "application/json", ...(a.x_generation_id ? { "x-generation-id": a.x_generation_id } : {}) };
      return new Response(a.stream ? stream(a) : JSON.stringify({ id: a.answer_id, type: "message", role: "assistant", model: MODEL, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 12, output_tokens: 2 } }), { headers });
    },
  });
  proxy.start();
  proxies.push(proxy);
  const b = proxy.bind({ cell: { run_id: "r1", arm: "h2hx:p-none", task: "t1", model: "openrouter:" + MODEL, trial: 1, attempt: 1 }, models: ["openrouter:" + MODEL], allowance_micros: 5_000_000 });
  const base = "http://127.0.0.1:" + proxy.port + "/" + b.slot + "/openrouter";
  const call = async (streamed: boolean) => {
    const res = await fetch(base + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": b.token }, body: JSON.stringify({ model: MODEL, max_tokens: 16, stream: streamed, messages: [{ role: "user", content: "Reply with the word ok." }] }) });
    await res.text();
    return res.status;
  };
  const lookup = async (id: string) => {
    const res = await fetch(base + "/v1/generation?id=" + id, { headers: { authorization: "Bearer " + b.token } });
    return { status: res.status, generation_id: res.headers.get("x-h2h-generation-id"), body: (await res.json()) as any };
  };
  const lines = async () => {
    await proxy.finalize(b.meter_id);
    return readFileSync(journal, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  };
  return { call, lookup, lines, looked };
}

describe("OpenRouter generation ids", () => {
  const particle = FIXTURE.answers.filter((a) => a.record.provider_name === "Particle AI");

  test("a recorded answer's body id is not a generation id: OpenRouter refused it, and took the header's id", () => {
    for (const a of FIXTURE.answers) {
      expect(a.answer_id).toMatch(/^msg_/);
      expect(a.x_generation_id).toMatch(/^gen-/);
      expect(a.record.id).toBe(a.x_generation_id);
      expect(a.record_by_answer_id.status).toBe(400);
    }
    expect(particle.map((a) => a.stream).sort()).toEqual([false, true]);
  });

  test("streamed and JSON answers journal their answer and generation ids, and the lookup by answer id reads the header's record", async () => {
    const t = setup(particle);
    expect(await t.call(particle[0]!.stream)).toBe(200);
    expect(await t.call(particle[1]!.stream)).toBe(200);
    for (const a of particle) {
      const r = await t.lookup(a.answer_id);
      expect(r.status).toBe(200);
      expect(r.generation_id).toBe(a.x_generation_id);
      expect(r.body.data).toEqual(a.record);
    }
    expect(t.looked).toEqual(particle.map((a) => a.x_generation_id));
    const lines = await t.lines();
    const outcomes = lines.filter((l) => l.kind === "outcome");
    expect(outcomes.map((l) => [l.answer_id, l.generation_id])).toEqual(particle.map((a) => [a.answer_id, a.x_generation_id]));
    expect(lines.filter((l) => l.kind === "free").map((l) => l.generation_id)).toEqual(particle.map((a) => a.x_generation_id));
  });

  test("an answer with no X-Generation-Id header, or an id the slot never served, is forwarded as asked with no generation header", async () => {
    const bare = { ...particle[0]!, x_generation_id: null };
    const t = setup([bare]);
    expect(await t.call(true)).toBe(200);
    const r = await t.lookup(bare.answer_id);
    expect([r.status, r.generation_id]).toEqual([400, null]);
    const g = await t.lookup(particle[1]!.x_generation_id);
    expect([g.status, g.generation_id]).toEqual([200, null]);
    expect(t.looked).toEqual([bare.answer_id, particle[1]!.x_generation_id]);
    const out = (await t.lines()).find((l) => l.kind === "outcome");
    expect([out.answer_id, out.generation_id]).toEqual([bare.answer_id, null]);
  });

  test("a malformed X-Generation-Id header is not recorded", async () => {
    const t = setup([{ ...particle[1]!, x_generation_id: "gen 1/../x" }]);
    expect(await t.call(false)).toBe(200);
    expect((await t.lookup(particle[1]!.answer_id)).generation_id).toBe(null);
  });
});
