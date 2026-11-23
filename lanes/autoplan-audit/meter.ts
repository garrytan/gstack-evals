// Copyright (c) 2026 Garry Tan. MIT License.
// Adapted from lanes/product-value/meter.ts at gstack-evals commit 3744a20 (blob 23985488): the autoplan record audit's
// metered client (prereg 2026-11-09-geva-419, sections 6, 12 and 13). Every panel call goes through one lease of one
// ledger line item and an in-process metering proxy, one slot per call. Changed for this lane: the reason codes
// (E_AR_* for E_PV_*), the judges (Astra, Opus, and Argon on OpenRouter held to Google Vertex), the arm label, the
// proxy's forbidden markers (the run's identifiers and owner-reply 6-grams, a second outbound check), the reply's
// truncation flag for the smoke, and no reply cache here: journal.ts holds the request journal and the only cache.
// OpenRouter replies name the provider that served them; any other than Google Vertex stops Argon's calls with
// E_AR_PROVIDER_DRIFT.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { judgeAnswer, judgeRequest } from "../../src/adapters/judge.ts";
import type { ReasonCode } from "../../src/errors/codes.ts";
import { openLease, settleLease } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath, recordPath } from "../../src/runner/ledger/paths.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import type { Provider } from "../../src/runner/pricing/prices.ts";
import { MeteringProxy, reconcileJournal, type RetryBudget } from "../../src/runner/proxy/metering-proxy.ts";
import { rigAdmission } from "../../src/rig/admission.ts";
import { truncated } from "./judge.ts";

export type ModelKey = "opus" | "astra" | "argon";

/** The models the eval calls directly, on the routes the price table lists. OpenRouter rows carry their provider pin in prices.ts. */
export const MODELS: Readonly<Record<ModelKey, { provider: Provider; id: string; served_by?: RegExp }>> = {
  opus: { provider: "anthropic", id: "claude-opus-5-5" },
  astra: { provider: "openai", id: "gpt-6-astra" },
  argon: { provider: "openrouter", id: "google/gemini-4-argon", served_by: /^(google|google vertex|google-vertex)$/i },
};

const ROUTE: Record<Provider, string> = { anthropic: "/v1/messages", openai: "/v1/responses", openrouter: "/v1/chat/completions" };
/** The proxy retries a 429 or 5xx at most twice more inside 15 minutes; past that the call returns its failure. */
export const RETRY: RetryBudget = { attempts: 3, elapsed_ms: 900_000 };

export class MeterError extends Error {
  constructor(readonly code: ReasonCode, message: string) {
    super(code + " " + message);
  }
}

export interface CallRequest {
  model: ModelKey;
  prompt: string;
  maxTokens: number;
  /** Reasoning effort: output_config.effort on Anthropic, reasoning.effort on OpenAI and OpenRouter; null sends none. */
  effort?: string | null;
  /** A label for the journal's cell (never prompt text). */
  label: string;
}

export interface CallResult {
  text: string | null;
  status: number;
  micros: number | null;
  cached: boolean;
  problem: string | null;
  served_by: string | null;
  truncated: boolean;
  /** The proxy settled this call's reservation as unknown: the request may have reached the provider, so it is never resent. */
  unknown: boolean;
}

export function requestBody(m: { provider: Provider; id: string }, prompt: string, maxTokens: number, effort: string | null | undefined): Record<string, unknown> {
  const messages = [{ role: "user", content: prompt }];
  if (m.provider === "openai") return judgeRequest("openai", m.id, prompt, maxTokens, effort ?? undefined);
  if (m.provider === "anthropic") return { model: m.id, max_tokens: maxTokens, messages, ...(effort ? { output_config: { effort } } : {}) };
  return { model: m.id, max_tokens: maxTokens, messages, ...(effort ? { reasoning: { effort } } : {}) };
}

export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
/** The request digest: the journal's key. */
export const requestDigest = (model: ModelKey, body: Record<string, unknown>) => sha256(model + "\n" + JSON.stringify(body));

export interface MeterOptions {
  item: string;
  runId: string;
  /** Holds journal.ndjson; replies never go here. */
  out: string;
  maxOutputTokens: number;
  /** Strings the proxy refuses to send (the run's identifiers and owner-reply 6-grams). */
  forbiddenMarkers?: string[];
  record?: string;
  ledger?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  warn?: (code: ReasonCode, message: string) => void;
}

export interface Meter {
  leaseId: string;
  call(req: CallRequest): Promise<CallResult>;
  /** Settled spend on this lease so far, in micros, from the local ledger. */
  spent(): number;
  /** Reservations whose outcome is unknown on this lease, in micros (kept until reconciled). */
  unknown(): number;
  close(): Promise<{ spent_micros: number; unknown_micros: number }>;
}

/** Leases the item for the run (settling this run's own stale lease first), starts the proxy and returns the client. */
export async function openMeter(o: MeterOptions): Promise<Meter> {
  const env = o.env ?? process.env;
  const record = recordPath(o.record, env).path;
  const local = openLocalLedger(ledgerPath(o.ledger, env));
  const warn = o.warn ?? (() => {});
  const out = resolve(o.out);
  mkdirSync(out, { recursive: true });
  const journal = join(out, "journal.ndjson");
  let proxy: MeteringProxy | null = null;
  let leaseId = "";
  try {
    if (existsSync(journal)) {
      await reconcileJournal(journal, local);
      renameSync(journal, join(out, "journal." + Date.now() + ".dead.ndjson"));
    }
    const open = readItem(record, o.item).open;
    if (open && open.run_id === o.runId && local.getLease(open.lease_id)) settleLease(record, local, open.lease_id, warn);
    leaseId = openLease(record, local, { item: o.item, run_id: o.runId, warn, requireAdmission: rigAdmission({ proof: "direct" }) }).lease_id;
    proxy = new MeteringProxy({ ledger: local, leaseId, host: "127.0.0.1", forbiddenMarkers: o.forbiddenMarkers, managementSocket: join(tmpdir(), "ar-" + randomBytes(6).toString("hex") + ".sock"), managementToken: randomBytes(24).toString("hex"), journal, retry: RETRY, env, fetch: o.fetch, maxOutputTokens: o.maxOutputTokens });
    proxy.start();
  } catch (e) {
    if (leaseId && !proxy) settleLease(record, local, leaseId, warn);
    local.close();
    throw e;
  }
  const p = proxy;
  const reserved = () => readItem(record, o.item).leases.find((l) => l.lease.lease_id === leaseId)!.lease.reserved_micros;
  let closed = false;
  return {
    leaseId,
    spent: () => [...local.meters(leaseId).values()].reduce((a, m) => a + m.spent_micros, 0),
    unknown: () => [...local.meters(leaseId).values()].reduce((a, m) => a + m.unknown_micros, 0),
    async call(req) {
      if (closed) throw new MeterError("E_USAGE", "the meter is closed");
      const m = MODELS[req.model];
      if (req.maxTokens > o.maxOutputTokens) throw new MeterError("E_USAGE", "a " + req.maxTokens + "-token request is above this meter's output cap of " + o.maxOutputTokens);
      const body = requestBody(m, req.prompt, req.maxTokens, req.effort);
      const b = p.bind({ cell: { run_id: o.runId, arm: "ar", task: req.label, model: m.id, trial: 1, attempt: 1 }, models: [m.provider + ":" + m.id], allowance_micros: reserved() });
      let status = 0;
      let text = "";
      try {
        const res = await fetch("http://127.0.0.1:" + p.port + "/" + b.slot + "/" + m.provider + ROUTE[m.provider], { method: "POST", headers: { authorization: "Bearer " + b.token, "content-type": "application/json" }, body: JSON.stringify(body), timeout: false } as RequestInit);
        status = res.status;
        text = await res.text();
      } finally {
        await p.finalize(b.meter_id);
        p.unbind(b.slot);
      }
      const settled = local.meters(leaseId).get(b.meter_id);
      const micros = settled?.spent_micros ?? null;
      const unknown = (settled?.unknown_micros ?? 0) > 0;
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {}
      if (status !== 200) {
        const problem = typeof parsed?.code === "string" ? parsed.code + ": " + (parsed.detail ?? "") : "HTTP " + status;
        return { text: null, status, micros, cached: false, problem, served_by: null, truncated: false, unknown };
      }
      const servedBy = m.provider === "openrouter" ? (typeof parsed?.provider === "string" ? parsed.provider : null) : m.provider;
      if (m.served_by && (servedBy === null || !m.served_by.test(servedBy))) throw new MeterError("E_AR_PROVIDER_DRIFT", m.id + " was served by " + (servedBy ?? "an unnamed provider") + ", not its pinned provider; stop this model's items and ask the Captain");
      return { text: parsed ? judgeAnswer(m.provider, parsed) : null, status, micros, cached: false, problem: parsed ? null : "the reply is not JSON", served_by: servedBy, truncated: parsed ? truncated(m.provider, parsed) : false, unknown };
    },
    async close() {
      if (closed) throw new MeterError("E_USAGE", "the meter is already closed");
      closed = true;
      p.stop();
      try {
        await reconcileJournal(journal, local);
        const c = settleLease(record, local, leaseId, warn);
        return { spent_micros: c.spent_micros, unknown_micros: c.unknown_micros };
      } finally {
        local.close();
      }
    },
  };
}

/** Runs jobs with at most n in flight; the first thrown error stops new jobs and is rethrown after the rest settle. */
export async function pool<T>(n: number, jobs: Array<() => Promise<T>>): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  let error: unknown = null;
  await Promise.all(
    Array.from({ length: Math.min(n, jobs.length) }, async () => {
      while (error === null && next < jobs.length) {
        const i = next++;
        try {
          out[i] = await jobs[i]!();
        } catch (e) {
          error ??= e;
        }
      }
    }),
  );
  if (error !== null) throw error;
  return out;
}
