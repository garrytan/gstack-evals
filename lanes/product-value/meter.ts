// Copyright (c) 2026 Garry Tan. MIT License.
// The product-value eval's metered client (prereg 2026-11-08-geva-403, sections 13 and 17): every direct model call the
// eval makes (authoring, checks, probes, judges, the taste summaries) goes through one lease of one ledger line item and
// an in-process metering proxy, one slot per call. Replies are cached on disk by model and request digest, so a resumed
// run never pays twice for the same request (section 7: judge calls are cached by model, version, prompt and packet).
// OpenRouter replies name the provider that served them; a provider other than the route's pin stops the run with
// E_PV_PROVIDER_DRIFT (section 17, rule 6). An OpenRouter request may also carry a system text, a chat in place of the
// one prompt, a temperature and a seed (the office-hours founder eval's simulator); a request without them keeps its body
// and cache key byte for byte. Each result also carries the model the reply names, for a caller that checks it against
// its pin (the office-hours rewrite eval's wire); the meter itself does not judge it.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

export type ModelKey = "opus" | "astra" | "astra-6.2" | "sol" | "particle" | "gemini" | "carbon";

/** The models the eval calls directly, on the routes the price table lists. OpenRouter rows carry their provider pin in prices.ts. */
export const MODELS: Readonly<Record<ModelKey, { provider: Provider; id: string; served_by?: RegExp }>> = {
  opus: { provider: "anthropic", id: "claude-opus-5-5" },
  astra: { provider: "openai", id: "gpt-6-astra" },
  "astra-6.2": { provider: "openai", id: "gpt-6.2-astra" },
  sol: { provider: "openrouter", id: "openai/gpt-6.1-sol", served_by: /^openai$/i },
  particle: { provider: "openrouter", id: "particle-ai/particle-1", served_by: /^particle/i },
  gemini: { provider: "openrouter", id: "google/gemini-4-argon", served_by: /^google/i },
  carbon: { provider: "openrouter", id: "google/gemini-4-carbon", served_by: /^google/i },
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
  /** OpenRouter only: a system text sent as a first system message. */
  system?: string;
  /** OpenRouter only: the chat to send in place of the one user prompt. */
  messages?: ChatMessage[];
  /** OpenRouter only: sent top-level. */
  temperature?: number;
  seed?: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type ChatFields = Pick<CallRequest, "system" | "messages" | "temperature" | "seed">;

export interface CallResult {
  text: string | null;
  status: number;
  micros: number | null;
  cached: boolean;
  problem: string | null;
  served_by: string | null;
  /** The model the reply names (its top-level model field), null when it names none; absent on a result cached before this field. */
  model?: string | null;
}

/** A request's body. The chat fields are sent only when set, so a request without them keeps its body and cache key. */
export function requestBody(m: { provider: Provider; id: string }, prompt: string, maxTokens: number, effort: string | null | undefined, chat: ChatFields = {}): Record<string, unknown> {
  const { system, temperature, seed } = chat;
  const set = system !== undefined || chat.messages !== undefined || temperature !== undefined || seed !== undefined;
  if (set && m.provider !== "openrouter") throw new MeterError("E_USAGE", "system, messages, temperature and seed are sent only on OpenRouter, not to " + m.provider);
  const messages = [...(system !== undefined ? [{ role: "system", content: system }] : []), ...(chat.messages ?? [{ role: "user", content: prompt }])];
  if (m.provider === "openai") return judgeRequest("openai", m.id, prompt, maxTokens, effort ?? undefined);
  if (m.provider === "anthropic") return { model: m.id, max_tokens: maxTokens, messages, ...(effort ? { output_config: { effort } } : {}) };
  return { model: m.id, max_tokens: maxTokens, messages, ...(effort ? { reasoning: { effort } } : {}), ...(temperature !== undefined ? { temperature } : {}), ...(seed !== undefined ? { seed } : {}) };
}

export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
export const cacheKey = (model: ModelKey, body: Record<string, unknown>) => sha256(model + "\n" + JSON.stringify(body));

export interface MeterOptions {
  item: string;
  runId: string;
  /** Holds journal.ndjson; replies never go here. */
  out: string;
  /** Holds the reply cache; it carries model output, so it sits on tmpfs for sealed work. */
  cacheDir: string;
  maxOutputTokens: number;
  /** The most the lease reserves, in micros; without it the lease reserves what the item's cap has left. */
  amountMicros?: number;
  record?: string;
  ledger?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  warn?: (code: ReasonCode, message: string) => void;
  /**
   * Stops the command (E_PV_EMPTY_REPLIES) when replies come back with no answer: streak of them in a row, or more than
   * share of the run's calls, counted over at least floor calls. Counts persist in <out>/empty.json, so a resume keeps
   * them. Cache hits are not counted again. Without it, no bound applies.
   */
  emptyBound?: { streak: number; share: number; floor: number };
}

export interface Meter {
  leaseId: string;
  call(req: CallRequest): Promise<CallResult>;
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
    leaseId = openLease(record, local, { item: o.item, run_id: o.runId, amount_micros: o.amountMicros, warn, requireAdmission: rigAdmission({ proof: "direct" }) }).lease_id;
    proxy = new MeteringProxy({ ledger: local, leaseId, host: "127.0.0.1", managementSocket: join(tmpdir(), "pv-" + randomBytes(6).toString("hex") + ".sock"), managementToken: randomBytes(24).toString("hex"), journal, retry: RETRY, env, fetch: o.fetch, maxOutputTokens: o.maxOutputTokens });
    proxy.start();
  } catch (e) {
    if (leaseId && !proxy) settleLease(record, local, leaseId, warn);
    local.close();
    throw e;
  }
  const p = proxy;
  const emptyFile = join(out, "empty.json");
  const empties = existsSync(emptyFile) ? (JSON.parse(readFileSync(emptyFile, "utf8")) as { calls: number; empty: number; streak: number }) : { calls: 0, empty: 0, streak: 0 };
  const tally = (empty: boolean | null, label: string) => {
    const b = o.emptyBound;
    if (!b) return;
    empties.calls += 1;
    if (empty === true) empties.empty += 1;
    if (empty !== null) empties.streak = empty ? empties.streak + 1 : 0;
    writeFileSync(emptyFile, JSON.stringify(empties) + "\n");
    if (empty && (empties.streak >= b.streak || empties.empty > b.share * Math.max(empties.calls, b.floor))) throw new MeterError("E_PV_EMPTY_REPLIES", label + ": " + empties.empty + " of " + empties.calls + " calls on " + o.item + " came back with no answer, " + empties.streak + " in a row; the bound is " + b.streak + " in a row or more than " + b.share * 100 + "% of at least " + b.floor + " calls, so the command stops for the Captain");
  };
  const reserved = () => readItem(record, o.item).leases.find((l) => l.lease.lease_id === leaseId)!.lease.reserved_micros;
  let closed = false;
  return {
    leaseId,
    spent: () => [...local.meters(leaseId).values()].reduce((a, m) => a + m.spent_micros, 0),
    async call(req) {
      if (closed) throw new MeterError("E_USAGE", "the meter is closed");
      const m = MODELS[req.model];
      if (req.maxTokens > o.maxOutputTokens) throw new MeterError("E_USAGE", "a " + req.maxTokens + "-token request is above this meter's output cap of " + o.maxOutputTokens);
      const body = requestBody(m, req.prompt, req.maxTokens, req.effort, req);
      const file = join(o.cacheDir, cacheKey(req.model, body) + ".json");
      if (existsSync(file)) {
        const hit = JSON.parse(readFileSync(file, "utf8")) as CallResult;
        return { ...hit, cached: true, micros: 0 };
      }
      const b = p.bind({ cell: { run_id: o.runId, arm: "pv", task: req.label, model: m.id, trial: 1, attempt: 1 }, models: [m.provider + ":" + m.id], allowance_micros: reserved() });
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
        tally(null, req.label);
        return { text: null, status, micros, cached: false, problem, served_by: null };
      }
      const servedBy = m.provider === "openrouter" ? (typeof parsed?.provider === "string" ? parsed.provider : null) : m.provider;
      const answer = parsed ? judgeAnswer(m.provider, parsed) : null;
      if (!answer) {
        tally(true, req.label);
        return { text: null, status, micros, cached: false, problem: parsed ? "the reply carries no answer" + (servedBy === null ? " and names no provider" : "") : "the reply is not JSON", served_by: servedBy, model: null };
      }
      if (m.served_by && (servedBy === null || !m.served_by.test(servedBy))) throw new MeterError("E_PV_PROVIDER_DRIFT", m.id + " was served by " + (servedBy ?? "an unnamed provider") + ", not its pinned provider; stop this model's items and ask the Captain");
      tally(false, req.label);
      const result: CallResult = { text: answer, status, micros, cached: false, problem: null, served_by: servedBy, model: typeof parsed?.model === "string" ? parsed.model : null };
      if (result.text !== null) {
        writeFileSync(file + ".tmp", JSON.stringify(result), { mode: 0o600 });
        renameSync(file + ".tmp", file);
      }
      return result;
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
