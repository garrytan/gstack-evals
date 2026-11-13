// Copyright (c) 2026 Garry Tan. MIT License.
// The harness mechanics judge metering proxy (lanes/harness-mechanics/README.md "Not built"). It runs on the VM beside the
// Lane B session proxy (quick/laneb/runner/vm-run.sh), holds the provider keys from ~/.laneb-keys, and serves the judgment
// hooks' decider calls (lanes/harness-mechanics/judge/hm_judge.py) on a per-session slot bound over its management unix
// socket. It is a src/runner/proxy/metering-proxy.ts MeteringProxy with allowanceCode DR_ALLOWANCE_STOP, so a slot's canary
// hit is refused DR_CUSTODY_HIT and journaled, and a marker hit is logged and forwarded. Its spend is held against the
// item's cap through the ledger SERVICE over the SSH reverse tunnel (http://127.0.0.1:9911), not a ledger file: the VM has
// none. The entrypoint's CLI is modelled on src/trial/proxy-entry.ts and quick/laneb/runner/proxy.ts.
import { MeteringProxy, type RetryBudget } from "../../../src/runner/proxy/metering-proxy.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../../src/types.ts";

/**
 * The judge proxy's ReservationLedger over the ledger service's HTTP (the same POST /reserve and /settle the Lane B
 * session proxy uses, quick/laneb/runner/proxy.ts). It mirrors picker.ts LaneBReservations, async over HTTP: a reserve
 * holds the call's worst case under the item's cap (409 is a CAP_STOP), a spent outcome settles it at its metered cost, and
 * an unknown outcome settles it at its reserved maximum marked unknown (meta unknown: true; D1, the Captain's ruling), so
 * the ledger never holds a judge call open and a report can count the unknowns apart. Reserves are idempotent by id, so a
 * repeat returns the first reservation and never double-books. The id is the prefix plus the metering proxy's idempotency
 * key; vm-run.sh passes "judge:" plus the part's ledger prefix (E1), so each part's judge rows are its own and never collide
 * with the Lane B session proxy's rows on the shared ledger.
 */
export class HttpReservations implements ReservationLedger {
  private held = new Map<string, Reservation>();
  constructor(
    private ledgerUrl: string,
    private prefix = "judge:",
    private timeoutMs = 10_000,
  ) {}

  private async call(path: "/reserve" | "/settle", body: Record<string, unknown>): Promise<{ status: number; json: any }> {
    const res = await fetch(this.ledgerUrl + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs) });
    let json: any = {};
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, json };
  }

  async reserve(r: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    const id = this.prefix + r.idempotency_key, prior = this.held.get(id);
    if (prior) return { ok: true, reservation: prior };
    const { status, json } = await this.call("/reserve", { id, usd_micros: r.max_micros, meta: { cell: r.cell, lease_id: r.lease_id } });
    if (status === 409 || json?.reason === "cap") return { ok: false, code: "CAP_STOP", message: "judge reserve " + id + ": the item cap cannot hold the reserve" };
    if (status !== 200 || json?.ok === false) return { ok: false, code: "E_RESERVE_CONFLICT", message: "judge reserve " + id + ": " + (json?.reason ?? "HTTP " + status) };
    const reservation: Reservation = { reservation_id: id, ...r, state: "reserved", spent_micros: null, usage: null };
    this.held.set(id, reservation);
    return { ok: true, reservation };
  }

  async settle(id: string, outcome: CallOutcome): Promise<LedgerReply> {
    const r = this.held.get(id);
    if (!r) return { ok: false, code: "E_INTERNAL", message: "judge settle: no reservation " + id };
    const body = outcome.kind === "unknown" ? { id, usd_micros: r.max_micros, meta: { unknown: true } } : { id, usd_micros: outcome.spent_micros, meta: { usage: outcome.usage } };
    const { status, json } = await this.call("/settle", body);
    if (status !== 200 && json?.reason !== "already settled") return { ok: false, code: "E_SETTLE_CONFLICT", message: "judge settle " + id + ": " + (json?.reason ?? "HTTP " + status) };
    if (outcome.kind === "unknown") return { ok: true, reservation: Object.assign(r, { state: "unknown" as const }) };
    return { ok: true, reservation: Object.assign(r, { state: "settled" as const, spent_micros: outcome.spent_micros, usage: outcome.usage }) };
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i]!.startsWith("--")) out[argv[i]!.slice(2)] = argv[++i]!;
  return out;
}

if (import.meta.main) {
  const a = parseArgs(Bun.argv.slice(2));
  const token = process.env.HM_JUDGE_MGMT_TOKEN ?? "";
  if (!a["ledger-url"]) throw new Error("E_USAGE judge-proxy.ts: --ledger-url is required (the ledger service over the SSH reverse tunnel)");
  if (!a["data-host"] || !a["journal"] || !a["management-socket"]) throw new Error("E_USAGE judge-proxy.ts: --data-host, --data-port, --management-socket and --journal are required");
  const retry: RetryBudget = { attempts: Number(a["retry-attempts"] ?? 3), elapsed_ms: Number(a["retry-elapsed-ms"] ?? 300_000) };
  const proxy = new MeteringProxy({
    ledger: new HttpReservations(a["ledger-url"]!, a["ledger-prefix"] ?? "judge:"),
    leaseId: a["lease-id"] ?? "hm-judge",
    host: a["data-host"]!,
    port: Number(a["data-port"] ?? 0),
    managementSocket: a["management-socket"]!,
    managementToken: token,
    journal: a["journal"]!,
    retry,
    env: process.env,
    allowanceCode: "DR_ALLOWANCE_STOP",
  });
  proxy.start();
  console.log("HM_JUDGE_PROXY_READY " + proxy.port);
  const stop = () => {
    proxy.stop();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
