// The metering proxy's refuseServerTools option (state machines prereg section 4): on for the family's stages only, it
// refuses a request carrying a provider-side tool before pricing; off, every other caller's requests pass through exactly
// as before the option existed. Keyless: a fake ledger and a fake upstream.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeteringProxy, type ProxyOptions } from "../../src/runner/proxy/metering-proxy.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";

const cell: Omit<CellAttempt, "meter_id"> = { run_id: "r1", arm: "sm:A0", task: "t1", model: "claude-opus-5-5", trial: 1, attempt: 1 };

class Ledger implements ReservationLedger {
  reserves = 0;
  rows = new Map<string, Reservation>();
  async reserve(r: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    this.reserves++;
    const reservation: Reservation = { reservation_id: "res_" + this.reserves, idempotency_key: r.idempotency_key, lease_id: r.lease_id, cell: r.cell, max_micros: r.max_micros, state: "reserved", spent_micros: null, usage: null };
    this.rows.set(reservation.reservation_id, reservation);
    return { ok: true, reservation };
  }
  async settle(id: string, outcome: CallOutcome): Promise<LedgerReply> {
    const r = this.rows.get(id)!;
    Object.assign(r, outcome.kind === "spent" ? { state: "settled", spent_micros: outcome.spent_micros, usage: outcome.usage } : { state: "unknown" });
    return { ok: true, reservation: r };
  }
}

const dirs: string[] = [];
const proxies: MeteringProxy[] = [];
afterEach(() => {
  for (const p of proxies.splice(0)) p.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(extra: Partial<ProxyOptions>) {
  const dir = mkdtempSync(join(tmpdir(), "sm-proxy-"));
  dirs.push(dir);
  const ledger = new Ledger();
  const sent: string[] = [];
  const proxy = new MeteringProxy({
    ledger, leaseId: "l1", host: "127.0.0.1", managementSocket: join(dir, "m.sock"), managementToken: "management-token-0123456789abcdef", journal: join(dir, "journal.ndjson"),
    retry: { attempts: 1, elapsed_ms: 60_000 }, env: { ANTHROPIC_API_KEY: "sk-ant-test-0123456789" }, sleep: async () => {},
    fetch: async (_url, init) => {
      sent.push(String(init.body ?? ""));
      return Response.json({ id: "msg", usage: { input_tokens: 10, output_tokens: 5 } });
    },
    ...extra,
  });
  proxy.start();
  proxies.push(proxy);
  const slot = proxy.bind({ cell, models: ["anthropic:claude-opus-5-5"], allowance_micros: 5_000_000 });
  const call = (body: unknown) => fetch("http://127.0.0.1:" + proxy.port + "/" + slot.slot + "/anthropic/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": slot.token }, body: JSON.stringify(body) });
  const journal = () => readFileSync(join(dir, "journal.ndjson"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { ledger, sent, call, journal, proxy, slot };
}

const plain = { model: "claude-opus-5-5", max_tokens: 1000, messages: [{ role: "user", content: "hi" }], tools: [{ name: "Bash", description: "run", input_schema: { type: "object" } }] };
const web = { ...plain, tools: [...plain.tools, { type: "web_search_20250305", name: "web_search", max_uses: 3 }] };

// Value: protects=section 4's server-side web-tool refusal on SM leases; fails_when=the check is dropped, moved after pricing or reserving, or matches custom tools; why_new=GEVA-436 P2; seam=metering-proxy.ts forward; no_claim=what the agent sends (sm-claude.test.ts)
test("with refuseServerTools on, a request carrying a server-side web tool is refused before pricing, and a plain one passes", async () => {
  const t = setup({ refuseServerTools: true });
  const res = await t.call(web);
  expect(res.status).toBe(403);
  const body = (await res.json()) as { code: string; detail: string };
  expect(body.code).toBe("E_PROXY_SERVER_TOOL");
  expect(body.detail).toContain("web_search_20250305");
  expect(t.sent).toHaveLength(0);
  expect(t.ledger.reserves).toBe(0);
  const j = t.journal();
  expect(j.map((e) => e.kind)).toEqual(["refusal"]);
  expect(j[0]).toMatchObject({ code: "E_PROXY_SERVER_TOOL", tools: ["web_search_20250305"] });
  expect((await t.call(plain)).status).toBe(200);
  expect(t.sent).toHaveLength(1);
});

// Value: protects=every other lane's proxy behaviour (the option is off by default); fails_when=the option changes a body, refuses or prices differently when off; why_new=GEVA-436 P2; seam=ProxyOptions.refuseServerTools; no_claim=behaviour of other options
test("with refuseServerTools off or unset, every request gets today's answer and upstream bytes, and on changes no allowed body", async () => {
  const unset = setup({});
  const off = setup({ refuseServerTools: false });
  const on = setup({ refuseServerTools: true });
  const answers = async (t: ReturnType<typeof setup>) => {
    const out: string[] = [];
    for (const b of [plain, web]) {
      const res = await t.call(b);
      out.push(res.status + " " + (await res.text()));
    }
    return out;
  };
  const before = await answers(unset);
  expect(await answers(off)).toEqual(before);
  expect(before[0]).toStartWith("200 ");
  expect(before[1]).not.toContain("E_PROXY_SERVER_TOOL");
  expect((await on.call(plain)).status).toBe(200);
  expect(off.sent).toEqual(unset.sent);
  expect(on.sent[0]).toBe(unset.sent[0]!);
  const kinds = (t: ReturnType<typeof setup>) => t.journal().map((e) => e.kind + ":" + (e.code ?? "") + ":" + (e.reason ?? ""));
  expect(kinds(off)).toEqual(kinds(unset));
});

// Value: protects=section 4's clean room against provider-side capabilities asked for outside body.tools (a curl from the agent's Bash with the slot token); fails_when=a top-level mcp_servers, plugins or web_search_options body reaches pricing or the upstream on an SM lease, or the off path changes; why_new=#290 review (red team); seam=metering-proxy.ts forward; no_claim=what Claude Code itself sends
test("with refuseServerTools on, a body asking for mcp_servers, plugins or web_search_options at the top level is refused before pricing; off, the same bodies get the answer they got before", async () => {
  const on = setup({ refuseServerTools: true });
  const off = setup({});
  const bodies: [string, Record<string, unknown>][] = [
    ["mcp_servers", { ...plain, mcp_servers: [{ type: "url", url: "https://mcp.example.com/sse", name: "x" }] }],
    ["plugins", { ...plain, plugins: [{ id: "web" }] }],
    ["web_search_options", { ...plain, web_search_options: { search_context_size: "low" } }],
  ];
  const offAnswers: string[] = [];
  for (const [key, b] of bodies) {
    const res = await on.call(b);
    expect(res.status).toBe(403);
    const j = (await res.json()) as { code: string; detail: string };
    expect(j.code).toBe("E_PROXY_SERVER_TOOL");
    expect(j.detail).toContain(key);
    const o = await off.call(b);
    offAnswers.push(key + " " + o.status + " " + ((await o.json()) as { code?: string }).code);
  }
  expect(on.sent).toHaveLength(0);
  expect(on.ledger.reserves).toBe(0);
  expect(offAnswers).toEqual(["mcp_servers 402 E_ALLOWANCE", "plugins 200 undefined", "web_search_options 200 undefined"]);
});

// Value: protects=the slot's one-model pin, so an OpenRouter :online suffix or another model never reaches the upstream; fails_when=the allowlist matches a prefix or drops a suffix; why_new=#290 review (red team); seam=metering-proxy.ts forward; no_claim=OpenRouter's own routing
test("a slot takes only its session's model: an :online suffix or another model is refused before pricing", async () => {
  const t = setup({ refuseServerTools: true });
  for (const model of ["claude-opus-5-5:online", "claude-sonnet-5-5", "anthropic/claude-opus-5-5"]) {
    const res = await t.call({ ...plain, model });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("E_ALLOWANCE");
  }
  expect(t.sent).toHaveLength(0);
  expect(t.ledger.reserves).toBe(0);
});

// Value: protects=section 6's end kind input, the codes a session's refusals carried; fails_when=the meter keeps only a count, so the driver's close answer cannot name E_ALLOWANCE; why_new=#290 review (red team CRITICAL); seam=Meter.refusals; no_claim=the close answer (sm-driver.test.ts)
test("the meter records each refusal's code once, in the order met, beside the refusal count", async () => {
  const t = setup({ refuseServerTools: true });
  await t.call(web);
  await t.call({ ...plain, model: "claude-sonnet-5-5" });
  await t.call(web);
  expect((await t.call(plain)).status).toBe(200);
  const m = await t.proxy.finalize(t.slot.meter_id);
  expect(m.refused).toBe(3);
  expect(m.refusals).toEqual(["E_PROXY_SERVER_TOOL", "E_ALLOWANCE"]);
});

// Value: protects=section 6's end kind input, the one refusal that is an allowance stop; fails_when=a model or output-cap refusal, which shares the E_ALLOWANCE code, counts as a stop, or the slot's allowance check is not counted; why_new=#290 pass two; seam=metering-proxy.ts Meter allowance_stops; no_claim=the status or body of any refusal, which stay as they were
test("the meter counts an allowance stop only at the slot's allowance check, not for another E_ALLOWANCE refusal", async () => {
  const t = setup({});
  expect((await t.call({ ...plain, model: "claude-sonnet-5-5" })).status).toBe(403);
  expect((await t.call({ ...plain, max_tokens: 1_000_000 })).status).toBe(400);
  expect((await t.call(plain)).status).toBe(200);
  const stray = await t.proxy.finalize(t.slot.meter_id);
  expect(stray.refusals).toEqual(["E_ALLOWANCE"]);
  expect(stray.allowance_stops).toBe(0);
  const u = setup({});
  const res = await u.call({ ...plain, messages: [{ role: "user", content: "x".repeat(1_300_000) }] });
  expect(res.status).toBe(402);
  expect(((await res.json()) as { code?: string }).code).toBe("E_ALLOWANCE");
  const stopped = await u.proxy.finalize(u.slot.meter_id);
  expect(stopped.refusals).toEqual(["E_ALLOWANCE"]);
  expect(stopped.allowance_stops).toBe(1);
});

