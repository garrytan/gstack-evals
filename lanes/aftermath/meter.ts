// Copyright (c) 2026 Garry Tan. MIT License.
// The metered client the aftermath-keyed plan-review evals share (product-value, prereg 2026-11-08-geva-403; devex,
// prereg 2026-11-09-geva-417): every direct model call an eval makes (authoring, checks, probes, judges) goes through one
// lease of one ledger line item and an in-process metering proxy, one slot per call. Replies are cached on disk by model
// and request digest, so a resumed run never pays twice for the same request. OpenRouter replies name the provider that
// served them; a provider other than the route's pin is the eval's drift code. With onDrift "throw" (product-value) the
// run stops; with "stop-model" (devex, GST-2016) only that model stops: the lease records a scope stop on the model, its
// in-flight calls finish and settle, its later calls are refused, and every other model keeps calling on the same open
// lease. stop() does the same for a subject (a model under test whose lists a judge labels, carried in the cell's arm).
// lanes/product-value/meter.ts binds the product-value defaults.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { judgeAnswer, judgeRequest } from "../../src/adapters/judge.ts";
import type { ReasonCode } from "../../src/errors/codes.ts";
import { openLease, settleLease } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger, type ScopeFigures, type ScopeMatch, type ScopeStop } from "../../src/runner/ledger/local.ts";
import { ledgerPath, recordPath } from "../../src/runner/ledger/paths.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import type { Provider } from "../../src/runner/pricing/prices.ts";
import { MeteringProxy, reconcileJournal, type RetryBudget } from "../../src/runner/proxy/metering-proxy.ts";
import { rigAdmission } from "../../src/rig/admission.ts";

export type ModelKey = "opus" | "astra" | "sol" | "particle" | "gemini";

/** The models the eval calls directly, on the routes the price table lists. OpenRouter rows carry their provider pin in prices.ts. */
export const MODELS: Readonly<Record<ModelKey, { provider: Provider; id: string; served_by?: RegExp }>> = {
  opus: { provider: "anthropic", id: "claude-opus-5-5" },
  astra: { provider: "openai", id: "gpt-6-astra" },
  sol: { provider: "openrouter", id: "openai/gpt-6.1-sol", served_by: /^openai$/i },
  particle: { provider: "openrouter", id: "particle-ai/particle-1", served_by: /^particle/i },
  gemini: { provider: "openrouter", id: "google/gemini-4-argon", served_by: /^google/i },
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
  /** The model under test this call serves, when a per-subject stop may cut it (the cell's arm becomes <arm>:<subject>). */
  subject?: string;
}

export interface CallResult {
  text: string | null;
  status: number;
  micros: number | null;
  cached: boolean;
  problem: string | null;
  served_by: string | null;
}

export function requestBody(m: { provider: Provider; id: string }, prompt: string, maxTokens: number, effort: string | null | undefined): Record<string, unknown> {
  const messages = [{ role: "user", content: prompt }];
  if (m.provider === "openai") return judgeRequest("openai", m.id, prompt, maxTokens, effort ?? undefined);
  if (m.provider === "anthropic") return { model: m.id, max_tokens: maxTokens, messages, ...(effort ? { output_config: { effort } } : {}) };
  return { model: m.id, max_tokens: maxTokens, messages, ...(effort ? { reasoning: { effort } } : {}) };
}

export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
export const cacheKey = (model: ModelKey, body: Record<string, unknown>) => sha256(model + "\n" + JSON.stringify(body));

export interface MeterOptions {
  item: string;
  /** The eval's reason code for provider drift (E_PV_PROVIDER_DRIFT, E_DX_PROVIDER_DRIFT). */
  driftCode: ReasonCode;
  /** throw: drift stops the run. stop-model: drift stops only the drifted model on this lease (GST-2016). */
  onDrift: "throw" | "stop-model";
  /** The journal cell's arm, such as pv or dx. */
  arm: string;
  runId: string;
  /** Holds journal.ndjson; replies never go here. */
  out: string;
  /** Holds the reply cache; it carries model output, so it sits on tmpfs for sealed work. */
  cacheDir: string;
  maxOutputTokens: number;
  record?: string;
  ledger?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  warn?: (code: ReasonCode, message: string) => void;
}

/** A scope of this meter's calls: one called model, or one subject (a model under test) across every called model. */
export type MeterScope = { model: ModelKey } | { subject: string };

export interface Meter {
  leaseId: string;
  call(req: CallRequest): Promise<CallResult>;
  /**
   * Stops one scope on this lease (GST-2016): its later calls throw MeterError with code, its in-flight calls finish and
   * settle at their cost, then its reservations settle (settleScope), and every other scope keeps calling on the same
   * open lease. The first stop on a scope stands. Returns the scope's figures.
   */
  stop(scope: MeterScope, code: ReasonCode, why: string): Promise<ScopeFigures>;
  /** The scopes stopped on this lease, by their ledger match. */
  stopped(): ScopeStop[];
  /** Settled spend on this lease so far, in micros, from the local ledger. */
  spent(): number;
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
  mkdirSync(o.cacheDir, { recursive: true, mode: 0o700 });
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
    proxy = new MeteringProxy({ ledger: local, leaseId, host: "127.0.0.1", managementSocket: join(tmpdir(), "pv-" + randomBytes(6).toString("hex") + ".sock"), managementToken: randomBytes(24).toString("hex"), journal, retry: RETRY, env, fetch: o.fetch, maxOutputTokens: o.maxOutputTokens });
    proxy.start();
  } catch (e) {
    if (leaseId && !proxy) settleLease(record, local, leaseId, warn);
    local.close();
    throw e;
  }
  const p = proxy;
  const reserved = () => readItem(record, o.item).leases.find((l) => l.lease.lease_id === leaseId)!.lease.reserved_micros;
  let closed = false;
  const matchOf = (s: MeterScope): ScopeMatch => ("model" in s ? { field: "model", value: MODELS[s.model].id } : { field: "arm", value: o.arm + ":" + s.subject });
  const inFlight = new Map<string, Set<Promise<unknown>>>();
  const key = (m: ScopeMatch) => m.field + "\n" + m.value;
  const stopOf = (model: ModelKey, subject: string | undefined) => local.scopeStops(leaseId).find((s) => (s.field === "model" && s.value === MODELS[model].id) || (subject !== undefined && s.field === "arm" && s.value === o.arm + ":" + subject));
  const track = <T>(scopes: ScopeMatch[], work: Promise<T>): Promise<T> => {
    for (const s of scopes) {
      let set = inFlight.get(key(s));
      if (!set) inFlight.set(key(s), (set = new Set()));
      set.add(work);
    }
    return work.finally(() => scopes.forEach((s) => inFlight.get(key(s))!.delete(work)));
  };
  const stop = async (scope: MeterScope, code: ReasonCode, why: string): Promise<ScopeFigures> => {
    const match = matchOf(scope);
    local.stopScope(leaseId, match, code, why);
    await Promise.allSettled([...(inFlight.get(key(match)) ?? [])]);
    return local.settleScope(leaseId, match);
  };
  const send = async (req: CallRequest): Promise<CallResult> => {
      const m = MODELS[req.model];
      if (req.maxTokens > o.maxOutputTokens) throw new MeterError("E_USAGE", "a " + req.maxTokens + "-token request is above this meter's output cap of " + o.maxOutputTokens);
      const body = requestBody(m, req.prompt, req.maxTokens, req.effort);
      const file = join(o.cacheDir, cacheKey(req.model, body) + ".json");
      if (existsSync(file)) {
        const hit = JSON.parse(readFileSync(file, "utf8")) as CallResult;
        return { ...hit, cached: true, micros: 0 };
      }
      const b = p.bind({ cell: { run_id: o.runId, arm: req.subject === undefined ? o.arm : o.arm + ":" + req.subject, task: req.label, model: m.id, trial: 1, attempt: 1 }, models: [m.provider + ":" + m.id], allowance_micros: reserved() });
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
      const micros = local.meters(leaseId).get(b.meter_id)?.spent_micros ?? null;
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {}
      if (status !== 200) {
        const problem = typeof parsed?.code === "string" ? parsed.code + ": " + (parsed.detail ?? "") : "HTTP " + status;
        return { text: null, status, micros, cached: false, problem, served_by: null };
      }
      const servedBy = m.provider === "openrouter" ? (typeof parsed?.provider === "string" ? parsed.provider : null) : m.provider;
      if (m.served_by && (servedBy === null || !m.served_by.test(servedBy))) {
        const why = m.id + " was served by " + (servedBy ?? "an unnamed provider") + ", not its pinned provider; stop this model's items and ask the Captain";
        if (o.onDrift === "stop-model") local.stopScope(leaseId, { field: "model", value: m.id }, o.driftCode, why);
        throw new MeterError(o.driftCode, why);
      }
      const result: CallResult = { text: parsed ? judgeAnswer(m.provider, parsed) : null, status, micros, cached: false, problem: parsed ? null : "the reply is not JSON", served_by: servedBy };
      if (result.text !== null) {
        writeFileSync(file + ".tmp", JSON.stringify(result), { mode: 0o600 });
        renameSync(file + ".tmp", file);
      }
      return result;
  };
  return {
    leaseId,
    spent: () => [...local.meters(leaseId).values()].reduce((a, m) => a + m.spent_micros, 0),
    stopped: () => local.scopeStops(leaseId),
    stop,
    async call(req) {
      if (closed) throw new MeterError("E_USAGE", "the meter is closed");
      const stopped = stopOf(req.model, req.subject);
      if (stopped) throw new MeterError(stopped.code, "lease " + leaseId + " stopped " + stopped.field + " " + stopped.value + " (" + stopped.scope + "); this call is not sent");
      const scopes: ScopeMatch[] = [matchOf({ model: req.model }), ...(req.subject === undefined ? [] : [matchOf({ subject: req.subject })])];
      return track(scopes, send(req));
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
