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
  return { ledger, sent, call, journal };
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
