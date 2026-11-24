// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 7's paid transport, on the pattern of lanes/autoplan-audit/meter.ts and the head-to-head's label send:
// every judge and labeller call goes through one lease of the cso-judge ledger item and an in-process metering proxy, one
// slot per call, with the call's byte worst case (prices.ts priceRequest and reservationMicros on the exact body) as the
// slot's allowance. Before each call the lease's room must hold that worst case, or the item cap-stops and nothing more
// is sent. Carbon and Argon go through OpenRouter, where the proxy pins google-vertex with fallbacks off and data
// collection denied, and a reply served by any other provider stops the send; Astra goes through OpenAI and Opus
// through Anthropic. Every request (the judge packet) and answered reply is kept by request digest in the out dir, so a rerun
// never pays for the same request twice (a retry's digest names its attempt, so the retry rule sends a fresh call) and the export carries both; with the readout key they are sealed to it, since
// stage 1's packets and replies carry its reports and labels (section 12).
// probe sends one short call down each judge and labeller route at its frozen model, effort and cap.
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openLease, recordStop, settleLease } from "../../../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../../../src/runner/ledger/local.ts";
import { usd } from "../../../../src/runner/ledger/money.ts";
import { ledgerPath, recordPath } from "../../../../src/runner/ledger/paths.ts";
import { readItem } from "../../../../src/runner/ledger/record.ts";
import { priceRequest, reservationMicros } from "../../../../src/runner/pricing/prices.ts";
import { MeteringProxy, reconcileJournal, type RetryBudget } from "../../../../src/runner/proxy/metering-proxy.ts";
import { rigAdmission } from "../../../../src/rig/admission.ts";
import { isSealedRow, openRow, sealRow } from "../analysis/readout.ts";
import { csoFail, JUDGE_MAX_OUTPUT_D, type CsoPrereg } from "../prereg.ts";
import { judgeRoutes, LABELLER_MAX_OUTPUT, routeClients, type JudgeClient, type Transport } from "./client.ts";

export const JUDGE_ITEM = "cso-judge";
/** The ledger item the judge leases: cso2-judge under the rerun plan (GEVA-583 prereg section 9), else cso-judge. */
export const judgeItem = (p: CsoPrereg): string => (p.rerun ? "cso2-judge" : JUDGE_ITEM);
const VERTEX = /^(google|google vertex|google-vertex)$/i;
const RETRY: RetryBudget = { attempts: 3, elapsed_ms: 900_000 };
/** The fields the metering proxy adds before it prices a request, sent up front so the worst case priced here is the one
 *  it reserves (as statemachines/send.ts does). */
const PROXY_FIELDS = { openai: { service_tier: "default" }, anthropic: { inference_geo: "global" }, openrouter: { usage: { include: true } } } as const;
const KEY_ENV = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", openrouter: "OPENROUTER_API_KEY" } as const;

export interface MeterOptions { run_id: string; out: string; item?: string; record?: string; ledger?: string; env?: Record<string, string | undefined>; fetch?: typeof fetch; warn?: (line: string) => void; seal?: Buffer }
export interface JudgeMeter { lease_id: string; transport: Transport; sent(): number; close(): Promise<{ spent_micros: number; unknown_micros: number }> }

/** Leases the judge item (o.item, default cso-judge) for the run (settling this run's own stale lease first), starts the proxy and returns its transport.
 *  E_KEY_MISSING when a provider key is unset. */
export async function openJudgeMeter(o: MeterOptions): Promise<JudgeMeter> {
  const env = o.env ?? process.env, item = o.item ?? JUDGE_ITEM;
  const missing = Object.values(KEY_ENV).filter((k) => !env[k]);
  if (missing.length) csoFail("E_KEY_MISSING", "the judge routes need " + missing.join(", ") + ", not set; nothing was opened");
  const record = recordPath(o.record, env).path;
  const local = openLocalLedger(ledgerPath(o.ledger, env));
  const warn = (code: string, m: string) => (o.warn ?? ((l: string) => console.error(l)))(code + " cso judge: " + m);
  const out = resolve(o.out);
  mkdirSync(join(out, "replies"), { recursive: true });
  mkdirSync(join(out, "requests"), { recursive: true });
  const journal = join(out, "journal.ndjson");
  let proxy: MeteringProxy | null = null;
  let lease = { lease_id: "", reserved_micros: 0 };
  try {
    if (existsSync(journal)) {
      await reconcileJournal(journal, local);
      renameSync(journal, join(out, "journal." + Date.now() + ".dead.ndjson"));
    }
    const open = readItem(record, item).open;
    if (open && open.run_id === o.run_id && local.getLease(open.lease_id)) settleLease(record, local, open.lease_id, warn);
    lease = openLease(record, local, { item, run_id: o.run_id, warn, requireAdmission: rigAdmission({ proof: "direct" }) });
    proxy = new MeteringProxy({ ledger: local, leaseId: lease.lease_id, host: "127.0.0.1", managementSocket: join(tmpdir(), "cso-judge-" + randomBytes(6).toString("hex") + ".sock"), managementToken: randomBytes(24).toString("hex"), journal, retry: RETRY, env, fetch: o.fetch, maxOutputTokens: Math.max(LABELLER_MAX_OUTPUT, JUDGE_MAX_OUTPUT_D), refuseServerTools: true });
    proxy.start();
  } catch (e) {
    if (lease.lease_id && !proxy) settleLease(record, local, lease.lease_id, warn);
    local.close();
    throw e;
  }
  const px = proxy;
  const log = join(out, "calls.jsonl");
  let sent = 0, closed = false;
  const transport: Transport = async ({ provider, route, body: asked, attempt = 1 }) => {
    const body: Record<string, unknown> = { ...asked, ...PROXY_FIELDS[provider as keyof typeof PROXY_FIELDS] };
    if (closed) csoFail("E_USAGE", "the judge meter is closed");
    const digest = createHash("sha256").update(provider + route + JSON.stringify(body) + (attempt > 1 ? "#attempt" + attempt : "")).digest("hex");
    const kept = join(out, "replies", digest + ".json");
    if (existsSync(kept)) {
      const v: unknown = JSON.parse(readFileSync(kept, "utf8"));
      return { status: 200, body: isSealedRow(v) ? openRow(v, o.seal ?? csoFail("E_USAGE", kept + " is sealed to the readout key; pass --key"), kept) : v };
    }
    const packet = join(out, "requests", digest + ".json");
    if (!existsSync(packet)) writeFileSync(packet, o.seal ? sealRow(body, o.seal) : JSON.stringify(body));
    const maxOut = Number(body.max_tokens ?? body.max_output_tokens);
    const worst = reservationMicros(priceRequest(provider, body, maxOut, route));
    const room = lease.reserved_micros - local.held(lease.lease_id);
    if (room < worst) {
      local.stageStop(lease.lease_id, item + " only");
      recordStop(record, lease.lease_id, item + " only");
      csoFail("E_CSO_CAP_STOP", item + " has " + usd(Math.max(room, 0)) + " of room on lease " + lease.lease_id + "; the next call's worst case is " + usd(worst) + ". Do not retry: the item ends incomplete");
    }
    const model = String(body.model);
    const b = px.bind({ cell: { run_id: o.run_id, arm: "judge", task: digest.slice(0, 16), model, trial: 1, attempt: 1 }, models: [provider + ":" + model], allowance_micros: worst });
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), event: "send", digest, provider, model, meter_id: b.meter_id, worst_micros: worst }) + "\n");
    sent++;
    let status = 0, text = "";
    try {
      const res = await fetch("http://127.0.0.1:" + px.port + "/" + b.slot + "/" + provider + route, { method: "POST", headers: { authorization: "Bearer " + b.token, "content-type": "application/json" }, body: JSON.stringify(body), timeout: false } as RequestInit);
      status = res.status;
      text = await res.text();
    } finally {
      await px.finalize(b.meter_id);
      px.unbind(b.slot);
    }
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), event: "reply", digest, meter_id: b.meter_id, status, micros: local.meters(lease.lease_id).get(b.meter_id)?.spent_micros ?? null }) + "\n");
    if (status === 200 && provider === "openrouter" && !(typeof parsed?.provider === "string" && VERTEX.test(parsed.provider))) csoFail("E_CSO_PROVIDER_DRIFT", model + " was served by " + (parsed?.provider ?? "an unnamed provider") + ", not google-vertex; stop and ask the Captain");
    if (status === 200 && parsed) writeFileSync(kept, o.seal ? sealRow(parsed, o.seal) : JSON.stringify(parsed));
    return { status, body: parsed };
  };
  return {
    lease_id: lease.lease_id, transport, sent: () => sent,
    async close() {
      if (closed) csoFail("E_USAGE", "the judge meter is already closed");
      closed = true;
      px.stop();
      try {
        await reconcileJournal(journal, local);
        const c = settleLease(record, local, lease.lease_id, warn);
        return { spent_micros: c.spent_micros, unknown_micros: c.unknown_micros };
      } finally {
        local.close();
      }
    },
  };
}

export const PROBE_PROMPT = "This is a connection check. Reply with the single word OK.";
export interface ProbeRow { route: string; role: "judge" | "gold"; model: string; ok: boolean; detail: string }

/** Section 7's last bullet: one call down each distinct judge and labeller route at its frozen model, effort and output cap.
 *  A route passes when text comes back. */
export async function probe(p: CsoPrereg, transport: Transport): Promise<ProbeRow[]> {
  const seen = new Set<string>();
  const clients: { route: string; c: JudgeClient }[] = [];
  for (const r of judgeRoutes(p)) {
    const cs = routeClients(r, p, transport);
    for (const c of [cs.judge, ...cs.gold]) {
      const k = c.role + " " + c.model;
      if (seen.has(k)) continue;
      seen.add(k);
      clients.push({ route: r.route, c });
    }
  }
  const rows: ProbeRow[] = [];
  for (const { route, c } of clients) {
    try {
      const a = await c.ask(PROBE_PROMPT);
      const ok = !a.refused && a.text.trim().length > 0;
      rows.push({ route, role: c.role, model: c.model, ok, detail: a.refused ? "refused" : a.truncated ? "truncated, text " + JSON.stringify(a.text.slice(0, 40)) : "text " + JSON.stringify(a.text.trim().slice(0, 40)) });
    } catch (e) {
      rows.push({ route, role: c.role, model: c.model, ok: false, detail: (e as Error).message });
    }
  }
  return rows;
}

