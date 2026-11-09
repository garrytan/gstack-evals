// Copyright (c) 2026 Garry Tan. MIT License.
// Vendored from harness-evals (https://github.com/garrytan/harness-evals) runner/proxy/metering-proxy.ts at 70cb3d019,
// which includes the exposure fix of harness-evals#97 (a0fe48da6). Lease mode is kept as the base; the plan's U3 work is
// new code on it.
// Changes from upstream (U3):
// - Lease mode only. In-process mode, Voyage, the BudgetRun ledger, the standalone CLI and the usage log are dropped:
//   the proxy reserves and settles through ReservationLedger (src/types.ts), which U4 implements.
// - A slot is opened by bind with a cell, a model allowlist and an allowance, and gets a random per-session bearer and a
//   separate public meter id. The bearer authenticates that slot only, lives only in memory (as a hash) and in the
//   agent's env, is revoked by unbind, and is scrubbed from error causes. The meter id authorizes nothing.
// - bind, unbind and finalize are served only on an evaluator-side unix socket that needs its own credential; the trial
//   listener serves provider routes only, and binds only to a loopback or private address (no hostnames, no wildcard).
// - Before each reserve the proxy journals its idempotency key, and before each forward the cell attempt and reservation
//   id; reconcileJournal settles a call with no recorded outcome as unknown and never resends it, and releases at zero a
//   hold the ledger kept for a reserve whose answer was lost. A running proxy or reconcile holds a flock on the journal's
//   lock file, so reconcile never runs beside a proxy that may still send.
// - The proxy is the single retry owner: 429 and 5xx answers are retried within a finite attempt count and elapsed-time
//   budget, a 429 pauses every call to that provider (the limiter), and a lost send is never retried.
// - Refusals are problem-details JSON (RFC 9457) carrying a reason code from src/errors/codes.ts.
// - A non-2xx answer's allow-listed error fields are journaled with its call (upstreamBody): code, type, the failed
//   routing step and provider name, each cut to 512 characters with keys redacted and replaced by its size when it
//   repeats the request's text, plus only the byte lengths of error.message and metadata.raw, within 4,096 bytes. No
//   free-text field of the answer is journaled.
// - OpenAI chat streams get stream_options.include_usage forced on; Anthropic Messages and OpenAI Responses streams are
//   metered from their own final usage events.
// - Money is integer micro-dollars throughout, and each reserve carries an idempotency key naming the call attempt.
// - Free routes (model listings, Anthropic token counts, an OpenRouter generation record by id) are forwarded unreserved, and every request, free, paid or
//   refused, is journaled with its source address.
// - OpenRouter chat, Responses and Anthropic-compatible Messages calls are routed with OPENROUTER_API_KEY. The proxy
//   replaces the request's provider routing with the price row's (its prices as max_price, and its pinned providers), and
//   settles from the token usage OpenRouter reports, priced at the row, as for the other providers. On the Messages route
//   (/v1/messages, which Claude Code arms use for OpenRouter models) usage comes in Anthropic's shape, with cache reads and
//   writes beside input_tokens, and is read that way.
// - Claude Code's token counts on OpenRouter's Messages route (/v1/messages/count_tokens) are answered by the proxy, at one
//   token per four bytes of the request, and sent nowhere, as Lane B's proxy answers them (quick/laneb/config/proxy.json,
//   count_tokens estimate). Refused, they counted toward review-units' 2% degraded share (GEVA-89: all 106 of particle-1's
//   refusals). The answer only sizes Claude Code's own context checks; the reservation still bounds input by bytes.
// - Decision routing (B3): a typesafe provider serves TypeSafe's POST /v1/systemone with TYPESAFE_API_KEY as a bearer, takes
//   the SDK's zstd request body (decoded before the tripwire and the price, and refused once it decodes past 16 MiB), and adds no output cap, since Jev's output is
//   free. ProxyOptions.allowanceCode DR_ALLOWANCE_STOP turns a slot's allowance refusal into a 403 whose body every SDK shows
//   as its error message; the default keeps the 402 E_ALLOWANCE refusal unchanged. Outcome lines carry the call's latency.
//   BindRequest.forbidden_markers adds runner-only markers to the tripwire for that slot's calls only. On a DR_ALLOWANCE_STOP
//   proxy a hit on those alone is refused DR_CUSTODY_HIT only when the request names one of the bind's deciders and the hit
//   includes the bind's canary; every other such hit is journaled as a marker_hit line and the call goes on as if there were
//   no hit. Both carry the slot's cell and each marker's index and sha256 prefix, never its text. A proxy-wide marker, and
//   every hit on other proxies, keeps E_TRIPWIRE byte for byte.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { dlopen, FFIType } from "bun:ffi";
import { chmodSync, closeSync, existsSync, fstatSync, fsyncSync, ftruncateSync, openSync, readFileSync, readSync, rmSync, writeSync } from "node:fs";
import { BlockList, isIP } from "node:net";
import { zstdDecompressSync } from "node:zlib";
import { docAnchor, type ReasonCode } from "../../errors/codes.ts";
import type { CallOutcome, CellAttempt, LedgerReply, ReservationLedger, TokenUsage } from "../../types.ts";
import { chatPrice, openRouterRouting, PriceError, priceRequest, reservationMicros, sseUsage, usageCost, type MeteredProvider } from "../pricing/prices.ts";
import { findLeaks } from "./sanitize.ts";

export const UPSTREAM: Record<MeteredProvider, string> = { anthropic: "https://api.anthropic.com", openai: "https://api.openai.com", openrouter: "https://openrouter.ai/api", typesafe: "https://api.typesafe.ai" };
/**
 * Routes the proxy serves. A free route costs nothing at the provider, so it is forwarded without a reservation. An estimate
 * route is answered by the proxy itself and sent nowhere.
 */
const ROUTES: Record<MeteredProvider, Array<{ method: string; path: RegExp; query?: RegExp; free?: true; estimate?: true }>> = {
  anthropic: [
    { method: "POST", path: /^\/v1\/messages$/ },
    { method: "POST", path: /^\/v1\/messages\/count_tokens$/, free: true },
    { method: "GET", path: /^\/v1\/models(\/[^/]+)?$/, free: true },
  ],
  openai: [
    { method: "POST", path: /^\/v1\/chat\/completions$/ },
    { method: "POST", path: /^\/v1\/responses$/ },
    { method: "GET", path: /^\/v1\/models(\/[^/]+)?$/, free: true },
  ],
  openrouter: [
    { method: "POST", path: /^\/v1\/messages$/ },
    { method: "POST", path: /^\/v1\/messages\/count_tokens$/, free: true, estimate: true },
    { method: "POST", path: /^\/v1\/chat\/completions$/ },
    { method: "POST", path: /^\/v1\/responses$/ },
    { method: "GET", path: /^\/v1\/models$/, free: true },
    // A generation record, read by id only: the tbv driver checks an unsettled send's cost before releasing it.
    { method: "GET", path: /^\/v1\/generation$/, query: /^\?id=[A-Za-z0-9_-]+$/, free: true },
  ],
  typesafe: [
    { method: "POST", path: /^\/v1\/systemone$/ },
    { method: "GET", path: /^\/v1\/models$/, free: true },
  ],
};
const KEY_ENV: Record<MeteredProvider, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", openrouter: "OPENROUTER_API_KEY", typesafe: "TYPESAFE_API_KEY" };

/** True when the proxy has a route and a price row for the model, as in routable("openrouter", "particle-ai/particle-1"). Preflight checks each model with it. */
export function routable(provider: string, model: string): boolean {
  return Object.hasOwn(ROUTES, provider) && chatPrice(`${provider}:${model}`) !== undefined;
}

const DROPPED_HEADERS = ["host", "content-length", "accept-encoding", "connection", "authorization", "x-api-key", "api-key", "openai-organization", "openai-project", "cookie", "proxy-authorization"];
const MANAGEMENT_HEADER = "x-gstack-evals-management";
export const DEFAULT_MAX_OUTPUT_TOKENS = 32_768;
/** Under allowanceCode DR_ALLOWANCE_STOP, an upstream 5xx that reports no usage settles at $0, journaled with this reason. */
export const NO_USAGE_5XX_REASON = "a 5xx without usage settles at $0 under DR_ALLOWANCE_STOP; shadow_micros is the reservation it would have charged";
/** How long finalize waits for in-flight calls by default, and the most the management socket lets a caller ask for. */
export const FINALIZE_TIMEOUT_MS = 30_000;
export const FINALIZE_MAX_MS = 120_000;
/** One provider call may run this long; long reasoning calls exceed Bun's own 300-second fetch timeout, which is off. */
export const UPSTREAM_DEADLINE_MS = 900_000;
/** A zstd request body that decodes past this many bytes is refused, and decoding stops there. */
export const MAX_DECODED_BODY_BYTES = 16 * 1024 * 1024;
const NO_TOKENS: TokenUsage = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 };
const usd = (micros: number) => `$${(micros / 1e6).toFixed(6)}`;
/** Reserve refusals that, under ReservationLedger's contract, mean the ledger holds nothing under the idempotency key. */
const NOTHING_HELD = new Set(["CAP_STOP", "E_LEASE_CLOSED", "E_LEDGER_MISSING"]);

/** Claude 4.5 and older answer inference_geo with a 400. A model id this cannot read is pinned, since an unpinned call may bill above the table. */
function acceptsInferenceGeo(model: string): boolean {
  if (/[^a-z0-9.-]/.test(model)) return true;
  const version = /^claude-(?:[a-z]+-)?(\d+)(?:[-.](\d{1,2}))?(?=-|$)/.exec(model);
  return !version || Number(version[1]) * 100 + Number(version[2] ?? 0) > 405;
}

type Send = (input: string, init: RequestInit) => Promise<Response>;

/**
 * flock(2) through libc, non-blocking and exclusive. The kernel drops the lock when its descriptor closes or its process
 * dies, so a lock is never stale and nothing ever takes one over.
 */
let libc: { symbols: { flock: (fd: number, operation: number) => number } } | null = null;
const LOCK_EX_NB = 2 | 4;

/**
 * Holds <journal>.lock with flock on a kept descriptor, so one proxy or one reconcile holds a journal at a time, in this
 * process or another. The file stays on disk and records the holder's pid for the refusal message only. Closing the
 * returned descriptor releases the lock.
 */
function lockJournal(journal: string): number {
  const lock = `${journal}.lock`;
  libc ??= dlopen(process.platform === "darwin" ? "libc.dylib" : "libc.so.6", { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
  const fd = openSync(lock, "a+", 0o600);
  if (libc.symbols.flock(fd, LOCK_EX_NB) !== 0) {
    const holder = Buffer.alloc(16);
    const read = readSync(fd, holder, 0, holder.length, 0);
    closeSync(fd);
    throw new Error(`E_USAGE: metering proxy: the journal ${journal} is held by another proxy or reconcile (process ${holder.subarray(0, read).toString("utf8").trim() || "unknown"}) through ${lock}; stop that proxy or let its reconcile finish`);
  }
  try {
    ftruncateSync(fd, 0);
    writeSync(fd, String(process.pid));
    return fd;
  } catch (e) {
    closeSync(fd);
    throw e;
  }
}

/** The preregistered retry budget per call: at most attempts sends, and no new attempt after elapsed_ms. */
export interface RetryBudget {
  attempts: number;
  elapsed_ms: number;
}

export interface ProxyOptions {
  ledger: ReservationLedger;
  leaseId: string;
  /** The trial network address: a loopback or private IP literal. */
  host: string;
  port?: number;
  /** The evaluator-side unix socket for bind, unbind and finalize. */
  managementSocket: string;
  managementToken: string;
  /** Append-only ndjson journal of call requests and outcomes. It holds no request body, bearer or key, and of an answer only a non-2xx answer's allow-listed error fields (upstreamBody). */
  journal: string;
  retry: RetryBudget;
  /** Where provider keys come from (defaults to process.env). */
  env?: Record<string, string | undefined>;
  fetch?: Send;
  /** Output-token cap injected when a request names none; a request naming more is refused. */
  maxOutputTokens?: number;
  /** Strings that must never leave the cell (hidden facts, answer keys); a body carrying one is refused. */
  forbiddenMarkers?: string[];
  sleep?: (ms: number) => Promise<void>;
  /** The code a slot's allowance refusal carries: E_ALLOWANCE (402, the default) or DR_ALLOWANCE_STOP (403, decision routing). */
  allowanceCode?: "E_ALLOWANCE" | "DR_ALLOWANCE_STOP";
}

export interface BindRequest {
  cell: Omit<CellAttempt, "meter_id">;
  /** provider:model ids this slot may call, such as anthropic:claude-opus-5-5. */
  models: string[];
  /** The slot's allowance in integer micro-dollars. */
  allowance_micros: number;
  /** Runner-only strings that this slot's calls must never carry, added to ProxyOptions.forbiddenMarkers for this slot only. */
  forbidden_markers?: string[];
  /** The provider:model ids among models that are this slot's deciders; on a DR_ALLOWANCE_STOP proxy only their requests can stop on the canary. */
  deciders?: string[];
  /** The forbidden_markers entry that is this slot's planted canary; a DR_ALLOWANCE_STOP proxy needs it whenever forbidden_markers is set. */
  canary?: string;
}

export interface Binding {
  slot: string;
  /** The per-session bearer: hand it to the agent's env only, never to a file or a log. */
  token: string;
  meter_id: string;
}

export interface Meter {
  meter_id: string;
  /** Spend in integer micro-dollars, unknown sends at their full reservation. */
  micros: number;
  /** Paid attempts sent upstream, retries included. */
  requests: number;
  /** Sends with no recorded outcome; each keeps its full reservation. */
  unknown: number;
  /** Requests from this slot's bearer that the proxy refused. */
  refused: number;
  /** Outcomes the journal failed to record or the ledger did not acknowledge; reconcileJournal settles them. */
  unsettled: number;
  by_model: Record<string, { micros: number; requests: number }>;
  upstream: { statuses: Record<string, number>; failed: number };
  /** Calls still in flight when finalize timed out. */
  undrained: number;
  /** The most worst-case reservation, in micro-dollars, this meter's calls held in flight at once: each call holds its full worst case until it settles. */
  peak_inflight_micros: number;
  /** The most calls in flight at once. */
  peak_inflight_calls: number;
  /** The most prompt tokens one call's usage reported (input plus cache read plus cache write), or null when no call reported usage. */
  largest_prompt: number | null;
  /** The most request bytes per reported prompt token over the calls that reported usage, or null when none did. */
  bytes_per_token: number | null;
  /** The cache-write modes the priced requests asked for (priceRequest's cacheWrite), distinct, in the order none, 5m, 1h that the scorer's row contract reads. */
  cache_write: string[];
}

interface Slot {
  tokenHash: Buffer;
  cell: CellAttempt;
  models: Set<string>;
  markers: string[];
  deciders: Set<string>;
  canary: string | null;
  allowanceMicros: number;
  /** Spent plus reserved plus unknown, in micro-dollars. */
  committedMicros: number;
  /** Paid calls started on this slot; with the attempt number it makes each reserve's idempotency key. */
  calls: number;
  /** Worst-case micro-dollars and calls reserved and not yet settled. */
  inflightMicros: number;
  inflightCalls: number;
}

interface CallContext {
  slot: Slot;
  provider: MeteredProvider;
  route: string;
  model: string;
  source: string | null;
  secrets: string[];
  /** The bytes of the request body sent upstream, once priced. */
  bytes?: number;
  /** When the current attempt was sent, for its outcome line's latency_ms. */
  sentAt?: number;
}

const hash = (secret: string) => createHash("sha256").update(secret).digest();
const sameSecret = (expected: Buffer, presented: string | null) => presented !== null && timingSafeEqual(expected, hash(presented));
const newMeter = (meter_id: string): Meter => ({ meter_id, micros: 0, requests: 0, unknown: 0, refused: 0, unsettled: 0, by_model: {}, upstream: { statuses: {}, failed: 0 }, undrained: 0, peak_inflight_micros: 0, peak_inflight_calls: 0, largest_prompt: null, bytes_per_token: null, cache_write: [] });

const TRIAL_NETWORKS = new BlockList();
for (const [net, bits] of [["127.0.0.0", 8], ["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16]] as const) TRIAL_NETWORKS.addSubnet(net, bits, "ipv4");
TRIAL_NETWORKS.addAddress("::1", "ipv6");
TRIAL_NETWORKS.addSubnet("fc00::", 7, "ipv6");

/** True for an IP literal on a loopback or private range (127/8, 10/8, 172.16/12, 192.168/16, ::1, fc00::/7). Never a hostname or a wildcard. */
export function isTrialNetworkHost(host: string): boolean {
  const h = host.trim().replace(/^\[(.*)\]$/, "$1");
  const version = isIP(h);
  return version !== 0 && TRIAL_NETWORKS.check(h, version === 4 ? "ipv4" : "ipv6");
}

/**
 * A refusal as problem-details JSON. detail starts with the code, like every gstack-evals error line. With errorType the body
 * also carries an error object in the shape provider SDKs read ({type, code, message}), so the code reaches the caller's
 * exception message.
 */
export function problem(code: ReasonCode, status: number, detail: string, errorType?: string): Response {
  const text = `${code}: metering proxy: ${detail}`;
  const body = { type: `https://github.com/garrytan/gstack-evals/blob/main/${docAnchor(code)}`, title: code, status, code, detail: text, ...(errorType ? { error: { type: errorType, code, message: text } } : {}) };
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/problem+json" } });
}

/** An error's message with its nested causes, every secret replaced. */
export function scrubbedCause(error: unknown, secrets: readonly string[]): string {
  const parts: string[] = [];
  for (let e: unknown = error, depth = 0; e && depth < 8; e = (e as { cause?: unknown }).cause, depth++) parts.push(e instanceof Error ? e.message : String(e));
  return secrets.reduce((text, s) => (s ? text.split(s).join("[redacted]") : text), parts.join(": ")).slice(0, 500);
}

/** The bytes of a non-2xx answer's error fields the journal keeps. */
export const UPSTREAM_BODY_BYTES = 4096;

/** The characters of each error string the journal keeps. */
const UPSTREAM_FIELD_CHARS = 512;

/** A run this long shared with one of the request's own strings marks an answer that repeats the request. */
const ECHO_CHARS = 24;

/**
 * What the journal keeps of a non-2xx answer: a fixed allow-list of its error fields (error.code, error.type,
 * error.metadata.failed_routing_step and error.metadata.provider_name), plus only the byte lengths of error.message and
 * error.metadata.raw, so no free-text field is journaled. Each kept string has every secret redacted and is cut to UPSTREAM_FIELD_CHARS
 * characters; one that repeats ECHO_CHARS characters of any string in the request other than its model id (a prompt quoted
 * back) is replaced by a note of its size. The whole is cut to UPSTREAM_BODY_BYTES bytes at a whole character. An answer
 * that is not a JSON object (an array included), or that cannot be measured, is kept only as a note of its size.
 */
export function upstreamBody(text: string, request: unknown, secrets: readonly string[]): string {
  const bytes = Buffer.byteLength(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {}
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return `[not a JSON object, ${bytes} bytes]`;
  try {
    const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
    const model = (request as { model?: unknown } | null | undefined)?.model;
    const requestTexts = decodedStrings(request).filter(s => s !== model).flatMap(s => [s, JSON.stringify(s).slice(1, -1)]);
    const field = (v: unknown): unknown => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v !== "string") return undefined;
      const cut = secrets.reduce((t, s) => (s ? t.split(s).join("[redacted]") : t), v).slice(0, UPSTREAM_FIELD_CHARS);
      const runs = new Set<string>();
      for (let i = 0; i + ECHO_CHARS <= cut.length; i++) runs.add(cut.slice(i, i + ECHO_CHARS));
      for (const s of requestTexts) for (let i = 0; i + ECHO_CHARS <= s.length; i++) if (runs.has(s.slice(i, i + ECHO_CHARS))) return `[withheld: it repeats the request's text, ${Buffer.byteLength(v)} bytes]`;
      return cut;
    };
    const size = (v: unknown) => (v === undefined ? undefined : Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v)));
    const error = record((parsed as Record<string, unknown>).error);
    const metadata = record(error.metadata);
    const kept = {
      code: field(error.code),
      type: field(error.type),
      message_bytes: size(error.message),
      metadata: {
        failed_routing_step: field(metadata.failed_routing_step),
        provider_name: field(metadata.provider_name),
        raw_bytes: size(metadata.raw),
      },
    };
    if (Object.values(kept.metadata).every(v => v === undefined)) delete (kept as { metadata?: unknown }).metadata;
    const json = Buffer.from(JSON.stringify({ error: kept }));
    let end = Math.min(json.length, UPSTREAM_BODY_BYTES);
    if (end < json.length) while (end > 0 && (json[end]! & 0xc0) === 0x80) end--;
    return json.subarray(0, end).toString("utf8");
  } catch {
    return `[unreadable, ${bytes} bytes]`;
  }
}

/** Every string a parsed JSON value holds, keys included, decoded from its escapes, so the tripwire sees what the provider will read. */
function decodedStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) decodedStrings(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      decodedStrings(v, out);
    }
  }
  return out;
}

function presentedCredential(req: Request): string | null {
  const apiKey = req.headers.get("x-api-key");
  if (apiKey) return apiKey;
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  return bearer ? bearer[1]!.trim() : null;
}

/** The output-cap fields the provider reads on this route; the first is where the proxy writes the cell's cap. */
function outputFields(provider: MeteredProvider, route: string): string[] {
  if (provider === "typesafe") return [];
  if (provider === "anthropic" || route === "/v1/messages") return ["max_tokens"];
  if (route === "/v1/responses") return ["max_output_tokens"];
  return provider === "openrouter" ? ["max_tokens", "max_completion_tokens"] : ["max_completion_tokens", "max_tokens"];
}

/** Decodes each run of percent escapes on its own, so one malformed escape cannot hide the rest of the string. */
function percentDecoded(text: string): string {
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, run => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run.replace(/%([0-7][0-9A-Fa-f])/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    }
  });
}

function retryDelayMs(res: Response, attempt: number): number {
  const ms = Number(res.headers.get("retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const seconds = Number(res.headers.get("retry-after"));
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return Math.min(1000 * 2 ** (attempt - 1), 30_000);
}

export class MeteringProxy {
  private trial: ReturnType<typeof Bun.serve> | null = null;
  private management: ReturnType<typeof Bun.serve> | null = null;
  private journalFd: number | null = null;
  private journalTorn = false;
  private journalLock: number | null = null;
  private slots = new Map<string, Slot>();
  private meters = new Map<string, Meter>();
  private inflight = new Map<string, number>();
  private waiters = new Map<string, Array<() => void>>();
  private pausedUntil: Record<MeteredProvider, number> = { anthropic: 0, openai: 0, openrouter: 0, typesafe: 0 };
  private managementHash: Buffer;

  constructor(private options: ProxyOptions) {
    if (!isTrialNetworkHost(options.host)) throw new Error(`E_USAGE: metering proxy: refusing to listen on ${options.host}; it binds only to a loopback or private IP on the trial network`);
    if (!(options.retry.attempts >= 1 && Number.isInteger(options.retry.attempts) && options.retry.elapsed_ms > 0)) throw new Error("E_USAGE: metering proxy: the retry budget needs attempts >= 1 and elapsed_ms > 0");
    if (options.managementToken.length < 16) throw new Error("E_USAGE: metering proxy: the management token must be at least 16 characters");
    this.managementHash = hash(options.managementToken);
  }

  get port(): number {
    return this.trial!.port as number;
  }

  /** Takes the journal's lock, then opens the journal and both listeners; a failure after the lock releases everything. */
  start(): void {
    this.journalLock = lockJournal(this.options.journal);
    try {
      this.journalFd = openSync(this.options.journal, "a+", 0o600);
      const { size } = fstatSync(this.journalFd);
      const last = Buffer.alloc(1);
      this.journalTorn = size > 0 && readSync(this.journalFd, last, 0, 1, size - 1) === 1 && last[0] !== 0x0a;
      if (existsSync(this.options.managementSocket)) rmSync(this.options.managementSocket);
      this.management = Bun.serve({ unix: this.options.managementSocket, fetch: req => this.manage(req) });
      chmodSync(this.options.managementSocket, 0o600);
      this.trial = Bun.serve({ hostname: this.options.host, port: this.options.port ?? 0, idleTimeout: 0, fetch: (req, server) => this.handle(req, server.requestIP(req)?.address ?? null), error: () => problem("E_INTERNAL", 500, "the request failed before its slot was checked") });
    } catch (e) {
      this.stop();
      throw e;
    }
  }

  stop(): void {
    this.trial?.stop(true);
    this.management?.stop(true);
    this.trial = this.management = null;
    if (this.journalFd !== null) closeSync(this.journalFd);
    this.journalFd = null;
    rmSync(this.options.managementSocket, { force: true });
    if (this.journalLock !== null) closeSync(this.journalLock);
    this.journalLock = null;
  }

  bind(request: BindRequest): Binding {
    if (!request.models?.length || !Number.isSafeInteger(request.allowance_micros) || request.allowance_micros <= 0) throw new Error("E_USAGE: metering proxy: bind needs a non-empty models list and a positive integer allowance_micros");
    if (request.forbidden_markers !== undefined && (!Array.isArray(request.forbidden_markers) || request.forbidden_markers.some(m => typeof m !== "string" || !m))) throw new Error("E_USAGE: metering proxy: bind's forbidden_markers must be a list of non-empty strings");
    if (request.deciders !== undefined && (!Array.isArray(request.deciders) || request.deciders.some(m => typeof m !== "string" || !request.models.includes(m)))) throw new Error("E_USAGE: metering proxy: bind's deciders must be a list of ids from its models");
    if (request.canary !== undefined && (typeof request.canary !== "string" || !request.forbidden_markers?.includes(request.canary))) throw new Error("E_USAGE: metering proxy: bind's canary must be one of its forbidden_markers");
    if (this.options.allowanceCode === "DR_ALLOWANCE_STOP" && request.forbidden_markers?.length && request.canary === undefined) throw new Error("E_USAGE: metering proxy: a decision-routing bind with forbidden_markers must name its canary");
    const binding = { slot: `s_${randomBytes(9).toString("base64url")}`, token: `gse_${randomBytes(32).toString("base64url")}`, meter_id: `m_${randomBytes(12).toString("hex")}` };
    this.slots.set(binding.slot, { tokenHash: hash(binding.token), cell: { ...request.cell, meter_id: binding.meter_id }, models: new Set(request.models), markers: [...(request.forbidden_markers ?? [])], deciders: new Set(request.deciders ?? []), canary: request.canary ?? null, allowanceMicros: request.allowance_micros, committedMicros: 0, inflightMicros: 0, inflightCalls: 0, calls: 0 });
    this.meters.set(binding.meter_id, newMeter(binding.meter_id));
    return binding;
  }

  /** Closes the slot and revokes its bearer; calls already in flight finish and are metered. */
  unbind(slot: string): void {
    this.slots.delete(slot);
  }

  /** Waits for the meter's in-flight calls (at most timeoutMs), then removes and returns it. */
  async finalize(meterId: string, timeoutMs = FINALIZE_TIMEOUT_MS): Promise<Meter> {
    if (this.inflight.get(meterId)) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([new Promise<void>(r => this.waiters.set(meterId, [...(this.waiters.get(meterId) ?? []), r])), new Promise<void>(r => (timer = setTimeout(r, timeoutMs)))]);
      clearTimeout(timer);
    }
    const meter = this.meters.get(meterId) ?? newMeter(meterId);
    meter.undrained = this.inflight.get(meterId) ?? 0;
    if (!meter.undrained) this.meters.delete(meterId);
    return meter;
  }

  private async manage(req: Request): Promise<Response> {
    if (!sameSecret(this.managementHash, req.headers.get(MANAGEMENT_HEADER))) return problem("E_SLOT_DENIED", 403, "the management socket needs its own credential; a trial bearer is never accepted here");
    let body: Record<string, any>;
    try {
      body = (await req.json()) as Record<string, any>;
    } catch {
      return problem("E_USAGE", 400, "the management body is not JSON");
    }
    const path = new URL(req.url).pathname;
    try {
      if (req.method === "POST" && path === "/bind") return Response.json(this.bind(body as BindRequest));
      if (req.method === "POST" && path === "/unbind" && typeof body.slot === "string") {
        this.unbind(body.slot);
        return Response.json({ ok: true });
      }
      if (req.method === "POST" && path === "/finalize" && typeof body.meter_id === "string") {
        const timeout = body.timeout_ms ?? FINALIZE_TIMEOUT_MS;
        if (!Number.isSafeInteger(timeout) || timeout < 0) throw new Error("E_USAGE: metering proxy: finalize needs timeout_ms as a non-negative integer");
        return Response.json(await this.finalize(body.meter_id, Math.min(timeout, FINALIZE_MAX_MS)));
      }
    } catch (e) {
      return problem("E_USAGE", 400, (e as Error).message.replace(/^E_USAGE: metering proxy: /, ""));
    }
    return problem("E_USAGE", 404, `no management route ${req.method} ${path}`);
  }

  /** Appends one line and syncs it. After a failed write, the next line starts on a fresh line, so a torn line stays on its own. */
  private journal(line: Record<string, unknown>): void {
    if (this.journalFd === null) throw new Error("E_INTERNAL: metering proxy: the journal is not open");
    const bytes = Buffer.from(`${this.journalTorn ? "\n" : ""}${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`);
    try {
      for (let written = 0; written < bytes.length; ) written += writeSync(this.journalFd, bytes, written);
      fsyncSync(this.journalFd);
      this.journalTorn = false;
    } catch (e) {
      this.journalTorn = true;
      throw e;
    }
  }

  private meter(slot: Slot): Meter {
    const id = slot.cell.meter_id;
    let m = this.meters.get(id);
    if (!m) this.meters.set(id, (m = newMeter(id)));
    return m;
  }

  private async handle(req: Request, source: string | null): Promise<Response> {
    const path = new URL(req.url).pathname;
    const match = path.match(/^\/([A-Za-z0-9_-]+)\/(anthropic|openai|openrouter|typesafe)(\/.*)$/);
    const slot = match ? this.slots.get(match[1]!) : undefined;
    const credential = presentedCredential(req);
    if (!match || !slot || !sameSecret(slot.tokenHash, credential)) {
      const reason = !match ? `no provider route ${path}` : !slot ? `slot ${match[1]} is not open` : `the credential presented is not slot ${match[1]}'s bearer`;
      this.journal({ kind: "refusal", code: "E_SLOT_DENIED", slot: match?.[1] ?? null, reason, source });
      return problem("E_SLOT_DENIED", 403, reason);
    }
    const meterId = slot.cell.meter_id;
    this.inflight.set(meterId, (this.inflight.get(meterId) ?? 0) + 1);
    let streaming = false;
    const done = () => {
      const n = (this.inflight.get(meterId) ?? 1) - 1;
      if (n > 0) return void this.inflight.set(meterId, n);
      this.inflight.delete(meterId);
      for (const wake of this.waiters.get(meterId) ?? []) wake();
      this.waiters.delete(meterId);
    };
    const ctx: CallContext = { slot, provider: match[2] as MeteredProvider, route: match[3]!, model: "", source, secrets: [credential!] };
    try {
      return await this.forward(req, ctx, () => ((streaming = true), done));
    } catch (e) {
      return problem("E_INTERNAL", 500, scrubbedCause(e, ctx.secrets).replace(/^[A-Z_]+: metering proxy: /, ""));
    } finally {
      if (!streaming) done();
    }
  }

  private refuse(ctx: CallContext, code: ReasonCode, status: number, reason: string, extra: Record<string, unknown> = {}): Response {
    this.meter(ctx.slot).refused++;
    this.journal({ kind: "refusal", code, meter_id: ctx.slot.cell.meter_id, provider: ctx.provider, route: ctx.route, model: ctx.model || null, reason, source: ctx.source, ...extra });
    return problem(code, status, reason, code === "DR_ALLOWANCE_STOP" ? "allowance_stop" : undefined);
  }

  /** Route allowlist, key, tripwire, model allowlist, output cap, price, then per attempt: rate-limit pause, allowance, journal, reserve, journal, send, settle. */
  private async forward(req: Request, ctx: CallContext, beginStream: () => () => void): Promise<Response> {
    const o = this.options;
    const { provider, route, slot } = ctx;
    const allowed = ROUTES[provider].find(r => r.method === req.method && r.path.test(route) && (!r.query || r.query.test(new URL(req.url).search)));
    if (!allowed) return this.refuse(ctx, "E_ALLOWANCE", 403, `route ${req.method} /${provider}${route} is not allowlisted`);
    const key = (o.env ?? process.env)[KEY_ENV[provider]];
    if (!key) return this.refuse(ctx, "E_KEY_MISSING", 503, `${KEY_ENV[provider]} is not set in the proxy's environment`);
    ctx.secrets.push(key);
    const target = `${UPSTREAM[provider]}${route}${new URL(req.url).search}`;
    const headers = new Headers(req.headers);
    for (const h of DROPPED_HEADERS) headers.delete(h);
    if (provider === "anthropic") {
      headers.set("x-api-key", key);
      if (!headers.has("anthropic-version")) headers.set("anthropic-version", "2023-06-01");
    } else headers.set("authorization", `Bearer ${key}`);
    const send: Send = o.fetch ?? ((input, init) => fetch(input, init));
    const strip = (res: Response) => {
      const out = new Headers(res.headers);
      for (const h of ["content-encoding", "content-length", "transfer-encoding"]) out.delete(h);
      return out;
    };
    const forwardFree = async (body?: string) => {
      const free = { kind: "free", meter_id: slot.cell.meter_id, provider, route, model: ctx.model || null, source: ctx.source };
      let res: Response;
      let text: string;
      try {
        res = await send(target, { method: req.method, headers, body });
        text = await res.text();
      } catch (e) {
        const reason = `the free route failed upstream and is not resent: ${scrubbedCause(e, ctx.secrets)}`;
        this.journal({ ...free, status: null, reason });
        return problem("UPSTREAM", 502, reason);
      }
      this.journal({ ...free, status: res.status, ...(res.ok ? {} : { upstream_body: upstreamBody(text, parsed, ctx.secrets) }) });
      return new Response(text, { status: res.status, headers: strip(res) });
    };

    const zstd = provider === "typesafe" && req.headers.get("content-encoding") === "zstd";
    let raw: string;
    try {
      raw = req.method === "GET" ? "" : zstd ? new TextDecoder().decode(zstdDecompressSync(new Uint8Array(await req.arrayBuffer()), { maxOutputLength: MAX_DECODED_BODY_BYTES })) : await req.text();
    } catch {
      return this.refuse(ctx, "E_ALLOWANCE", 400, "the zstd request body cannot be decoded, so it cannot be priced");
    }
    if (zstd) headers.delete("content-encoding");
    let parsed: unknown;
    let isJson = true;
    try {
      parsed = JSON.parse(raw);
    } catch {
      isJson = false;
    }
    const url = new URL(req.url);
    const headerText = [...req.headers].flat();
    const channels = [route, percentDecoded(route), url.search, percentDecoded(url.search), ...[...url.searchParams].flat(), ...headerText, ...headerText.map(percentDecoded), raw, ...decodedStrings(parsed)];
    const text = channels.join("\n");
    const leaks = findLeaks(text, [...(o.forbiddenMarkers ?? []), ...slot.markers]);
    if (leaks.length && o.allowanceCode === "DR_ALLOWANCE_STOP" && !findLeaks(text, o.forbiddenMarkers ?? []).length) {
      const markers = leaks.map(m => ({ index: slot.markers.indexOf(m), sha256: createHash("sha256").update(m).digest("hex").slice(0, 12) }));
      const { run_id, arm, task, model, trial, attempt } = slot.cell;
      const cell = { run_id, arm, task, model, trial, attempt };
      const asked = (parsed as Record<string, unknown> | null)?.model;
      const decider = typeof asked === "string" && slot.deciders.has(`${provider}:${asked}`);
      if (decider && slot.canary !== null && leaks.includes(slot.canary)) return this.refuse(ctx, "DR_CUSTODY_HIT", 403, `the request carries ${leaks.length} runner-only marker(s); custody hit, the run stops`, { cell, markers });
      this.journal({ kind: "marker_hit", meter_id: slot.cell.meter_id, provider, route, model: typeof asked === "string" ? asked : null, source: ctx.source, decider, cell, markers });
    } else if (leaks.length) return this.refuse(ctx, "E_TRIPWIRE", 403, `the request carries ${leaks.length} forbidden marker(s); the cell is invalid`);
    if (req.method === "GET") return forwardFree();
    if (!isJson) return this.refuse(ctx, "E_ALLOWANCE", 400, "the request body is not JSON, so it cannot be priced");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return this.refuse(ctx, "E_ALLOWANCE", 400, "the request body must be a JSON object");
    const body = parsed as Record<string, any>;
    ctx.model = typeof body.model === "string" ? body.model : "";
    if (!slot.models.has(`${provider}:${ctx.model}`)) return this.refuse(ctx, "E_ALLOWANCE", 403, `${provider}:${ctx.model || "(no model)"} is not on this slot's model allowlist`);
    if (allowed.estimate) {
      this.journal({ kind: "free", meter_id: slot.cell.meter_id, provider, route, model: ctx.model, source: ctx.source, status: 200, estimated: true });
      return Response.json({ input_tokens: Math.ceil(Buffer.byteLength(raw) / 4) });
    }
    if (allowed.free) return forwardFree(raw);
    if (body.stream === true && route === "/v1/chat/completions") body.stream_options = { ...(body.stream_options ?? {}), include_usage: true };
    if (provider === "openai" && body.service_tier === undefined) body.service_tier = "default";
    if (provider === "anthropic" && body.inference_geo === undefined && acceptsInferenceGeo(ctx.model)) body.inference_geo = "global";
    const listed = chatPrice(`${provider}:${ctx.model}`);
    if (provider === "openrouter" && listed) body.provider = openRouterRouting(listed);
    const cap = o.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    const fields = outputFields(provider, route);
    const stated = fields.map(f => body[f]).filter((v): v is number => typeof v === "number");
    if (stated.some(v => v > cap)) return this.refuse(ctx, "E_ALLOWANCE", 400, `the request asks for ${Math.max(...stated)} output tokens, above this cell's cap of ${cap}`);
    if (!stated.length && fields.length) body[fields[0]!] = cap;
    if (provider === "openrouter" && route === "/v1/chat/completions") body.max_tokens ??= body.max_completion_tokens;
    const outBody = JSON.stringify(body);
    let price: ReturnType<typeof priceRequest>;
    try {
      price = priceRequest(provider, body, stated.length ? Math.max(...stated) : cap, route);
    } catch (e) {
      if (e instanceof PriceError) return this.refuse(ctx, "E_ALLOWANCE", 402, `unpriced request refused: ${e.message}`);
      throw e;
    }
    const maxMicros = reservationMicros(price);
    const meter = this.meter(slot);
    if (!meter.cache_write.includes(price.cacheWrite)) meter.cache_write = (["none", "5m", "1h"] as const).filter((m) => m === price.cacheWrite || meter.cache_write.includes(m));
    ctx.bytes = Buffer.byteLength(outBody);
    const call = ++slot.calls;
    const sleep = o.sleep ?? Bun.sleep;
    const started = Date.now();

    for (let attempt = 1; ; attempt++) {
      ctx.sentAt = undefined;
      for (let sleptUntil = 0; this.pausedUntil[provider] > Math.max(Date.now(), sleptUntil); ) {
        const until = this.pausedUntil[provider];
        const wait = until - Date.now();
        if (Date.now() - started + wait > o.retry.elapsed_ms) return this.refuse(ctx, "UPSTREAM", 502, `${provider} is rate limited for ${wait} ms more, past this call's retry budget of ${o.retry.elapsed_ms} ms`);
        await sleep(wait);
        sleptUntil = until;
      }
      if (slot.committedMicros + maxMicros > slot.allowanceMicros) {
        const stop = o.allowanceCode === "DR_ALLOWANCE_STOP";
        return this.refuse(ctx, stop ? "DR_ALLOWANCE_STOP" : "E_ALLOWANCE", stop ? 403 : 402, `the slot's allowance of ${usd(slot.allowanceMicros)} cannot hold this call's worst case of ${usd(maxMicros)} (${usd(slot.committedMicros)} already committed)`);
      }
      const idempotencyKey = `${slot.cell.meter_id}:${call}:${attempt}`;
      const reservation = { idempotency_key: idempotencyKey, lease_id: o.leaseId, cell: slot.cell, max_micros: maxMicros };
      this.journal({ kind: "reserve", ...reservation, provider, route, model: ctx.model, try: attempt, source: ctx.source });
      slot.committedMicros += maxMicros;
      slot.inflightMicros += maxMicros;
      slot.inflightCalls++;
      meter.peak_inflight_micros = Math.max(meter.peak_inflight_micros, slot.inflightMicros);
      meter.peak_inflight_calls = Math.max(meter.peak_inflight_calls, slot.inflightCalls);
      let held: LedgerReply;
      try {
        held = await o.ledger.reserve(reservation);
      } catch (e) {
        slot.committedMicros -= maxMicros;
        slot.inflightMicros -= maxMicros;
        slot.inflightCalls--;
        return this.refuse(ctx, "E_LEDGER_UNAVAILABLE", 503, `the ledger did not answer reservation ${idempotencyKey}, so nothing was sent; if the ledger recorded it, reconcileJournal releases it at $0: ${scrubbedCause(e, ctx.secrets)}`);
      }
      if (!held.ok) {
        slot.committedMicros -= maxMicros;
        slot.inflightMicros -= maxMicros;
        slot.inflightCalls--;
        return this.refuse(ctx, held.code, 402, held.message, { idempotency_key: idempotencyKey });
      }
      const rid = held.reservation.reservation_id;
      try {
        this.journal({ kind: "request", reservation_id: rid, idempotency_key: idempotencyKey, lease_id: o.leaseId, cell: slot.cell, provider, route, model: ctx.model, try: attempt, max_micros: maxMicros, source: ctx.source });
      } catch (e) {
        await this.settle(ctx, rid, maxMicros, { kind: "spent", spent_micros: 0, usage: NO_TOKENS }, null, "not sent: the request line could not be journaled");
        throw e;
      }
      if (attempt > 1 && Date.now() - started > o.retry.elapsed_ms) {
        const reason = `not sent: attempt ${attempt} would start past this call's retry budget of ${o.retry.elapsed_ms} ms`;
        await this.settle(ctx, rid, maxMicros, { kind: "spent", spent_micros: 0, usage: NO_TOKENS }, null, reason);
        return problem("UPSTREAM", 502, reason);
      }
      meter.requests++;
      let res: Response;
      ctx.sentAt = Date.now();
      try {
        res = await send(target, { method: "POST", headers, body: outBody, timeout: false, signal: AbortSignal.timeout(UPSTREAM_DEADLINE_MS) } as RequestInit);
      } catch (e) {
        const reason = `the send failed after it may have reached the provider, so it keeps its charge and is not resent: ${scrubbedCause(e, ctx.secrets)}`;
        meter.upstream.failed++;
        await this.settle(ctx, rid, maxMicros, { kind: "unknown" }, null, reason);
        return problem("UPSTREAM", 502, reason);
      }
      meter.upstream.statuses[String(res.status)] = (meter.upstream.statuses[String(res.status)] ?? 0) + 1;

      if (res.ok && (res.headers.get("content-type") ?? "").includes("event-stream") && res.body) {
        const finish = beginStream();
        const [client, metered] = res.body.tee();
        void new Response(metered)
          .text()
          .then(
            text => {
              const cost = usageCost(price, sseUsage(text));
              return this.settle(ctx, rid, maxMicros, cost ? { kind: "spent", spent_micros: cost.micros, usage: cost.usage } : { kind: "unknown" }, res.status, cost ? undefined : "the stream ended without usage");
            },
            e => this.settle(ctx, rid, maxMicros, { kind: "unknown" }, res.status, `the stream broke: ${scrubbedCause(e, ctx.secrets)}`),
          )
          .finally(finish);
        const reader = client.getReader();
        const scrubbed = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const { done, value } = await reader.read();
              if (done) controller.close();
              else controller.enqueue(value);
            } catch (e) {
              controller.error(new Error(`UPSTREAM: metering proxy: the stream broke: ${scrubbedCause(e, ctx.secrets)}`));
            }
          },
          cancel: reason => reader.cancel(reason),
        });
        return new Response(scrubbed, { status: res.status, headers: strip(res) });
      }

      let text: string;
      try {
        text = await res.text();
      } catch (e) {
        const reason = `the response body was lost after ${provider} answered ${res.status}, so the call keeps its charge and is not resent: ${scrubbedCause(e, ctx.secrets)}`;
        meter.upstream.failed++;
        await this.settle(ctx, rid, maxMicros, { kind: "unknown" }, res.status, reason);
        return problem("UPSTREAM", 502, reason);
      }
      let reported: unknown = null;
      try {
        reported = (JSON.parse(text) as { usage?: unknown })?.usage;
      } catch {}
      const cost = usageCost(price, reported);
      const retryable = res.status === 429 || res.status >= 500;
      let outcome: CallOutcome;
      const freeFiveXx = res.status >= 500 && !cost && o.allowanceCode === "DR_ALLOWANCE_STOP";
      if (cost) outcome = { kind: "spent", spent_micros: cost.micros, usage: cost.usage };
      else if (res.status >= 400 && res.status < 500) outcome = { kind: "spent", spent_micros: 0, usage: NO_TOKENS };
      else if (res.status >= 500) outcome = { kind: "spent", spent_micros: freeFiveXx ? 0 : maxMicros, usage: NO_TOKENS };
      else outcome = { kind: "unknown" };
      const reason = freeFiveXx ? NO_USAGE_5XX_REASON : res.status >= 500 && !cost ? "a 5xx without usage is charged at its reservation" : undefined;
      await this.settle(ctx, rid, maxMicros, outcome, res.status, reason, res.ok ? undefined : upstreamBody(text, body, ctx.secrets), freeFiveXx ? { no_usage_5xx: true, shadow_micros: maxMicros } : undefined);
      if (res.status === 401 || res.status === 403) return problem("E_KEY_REJECTED", 502, `${provider} answered ${res.status} to the proxy's key`);
      if (!retryable) return new Response(text, { status: res.status, headers: strip(res) });
      const delay = retryDelayMs(res, attempt);
      if (res.status === 429) this.pausedUntil[provider] = Math.max(this.pausedUntil[provider], Date.now() + delay);
      if (attempt >= o.retry.attempts || Date.now() - started + delay > o.retry.elapsed_ms) {
        return problem("UPSTREAM", 502, `${provider} answered ${res.status} on attempt ${attempt}, and the retry budget (${o.retry.attempts} attempts, ${o.retry.elapsed_ms} ms) is spent`);
      }
      if (res.status !== 429) await sleep(delay);
    }
  }

  /**
   * Journal the outcome first, so a lost ledger acknowledgement is repaired by reconcileJournal, then settle and meter.
   * A journal write that fails is reported on stderr and counted as unsettled; the call is still metered and settled.
   */
  private async settle(ctx: CallContext, rid: string, maxMicros: number, outcome: CallOutcome, status: number | null, reason?: string, upstream?: string, mark?: { no_usage_5xx: true; shadow_micros: number }): Promise<void> {
    const meter = this.meter(ctx.slot);
    const micros = outcome.kind === "spent" ? outcome.spent_micros : maxMicros;
    let journaled = true;
    try {
      this.journal({ kind: "outcome", reservation_id: rid, meter_id: ctx.slot.cell.meter_id, status, outcome, latency_ms: ctx.sentAt === undefined ? null : Date.now() - ctx.sentAt, ...(reason ? { reason } : {}), ...(upstream !== undefined ? { upstream_body: upstream } : {}), ...mark });
    } catch (e) {
      journaled = false;
      console.error(`E_INTERNAL: metering proxy: the outcome of reservation ${rid} was not journaled: ${scrubbedCause(e, ctx.secrets)}`);
    }
    ctx.slot.committedMicros += micros - maxMicros;
    ctx.slot.inflightMicros -= maxMicros;
    ctx.slot.inflightCalls--;
    const prompt = outcome.kind === "spent" ? outcome.usage.input + outcome.usage.cache_read + outcome.usage.cache_write : 0;
    if (prompt > 0) {
      meter.largest_prompt = Math.max(meter.largest_prompt ?? 0, prompt);
      if (ctx.bytes) meter.bytes_per_token = Math.max(meter.bytes_per_token ?? 0, ctx.bytes / prompt);
    }
    meter.micros += micros;
    if (outcome.kind === "unknown") meter.unknown++;
    const id = `${ctx.provider}:${ctx.model}`;
    meter.by_model[id] ??= { micros: 0, requests: 0 };
    meter.by_model[id].micros += micros;
    meter.by_model[id].requests++;
    let reply: LedgerReply | null = null;
    try {
      reply = await this.options.ledger.settle(rid, outcome);
    } catch {}
    if (!journaled || !reply?.ok) meter.unsettled++;
  }
}

/**
 * Resume: settle every journaled call through the ledger. A call with a recorded outcome is settled with it again
 * (settle is idempotent by reservation id), whether or not its request line survived; a call with none is settled as
 * unknown, keeps its full charge, and is never resent. A reserve line with no request line and no ledger refusal after it
 * was never sent, but the ledger may hold it if its answer was lost: reconcile reserves again under the same idempotency
 * key, which returns any hold the ledger kept, and settles it at zero (released). A line torn by a crash or a short write
 * is skipped and counted as unreadable. It takes the journal's lock, so it refuses (E_USAGE) while a proxy holds the
 * journal: a call still in flight there would look unanswered. Nothing here can send a provider request.
 */
export async function reconcileJournal(path: string, ledger: ReservationLedger): Promise<{ settled: string[]; unknown: string[]; released: string[]; refused: Array<{ reservation_id: string | null; code: string; message: string }>; unreadable: number }> {
  const lock = lockJournal(path);
  try {
    return await reconcileLocked(path, ledger);
  } finally {
    closeSync(lock);
  }
}

async function reconcileLocked(path: string, ledger: ReservationLedger): Promise<Awaited<ReturnType<typeof reconcileJournal>>> {
  const calls = new Set<string>();
  const outcomes = new Map<string, CallOutcome>();
  const reserves = new Map<string, { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }>();
  const answered = new Set<string>();
  let unreadable = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry: { kind: string; reservation_id?: string; idempotency_key?: string; lease_id: string; cell: CellAttempt; max_micros: number; outcome?: CallOutcome };
    try {
      entry = JSON.parse(line);
    } catch {
      unreadable++;
      continue;
    }
    if (entry.kind === "reserve" && entry.idempotency_key) reserves.set(entry.idempotency_key, { idempotency_key: entry.idempotency_key, lease_id: entry.lease_id, cell: entry.cell, max_micros: entry.max_micros });
    if ((entry.kind === "request" || entry.kind === "refusal") && entry.idempotency_key) answered.add(entry.idempotency_key);
    if ((entry.kind === "request" || entry.kind === "outcome") && entry.reservation_id) calls.add(entry.reservation_id);
    if (entry.kind === "outcome" && entry.reservation_id && entry.outcome) outcomes.set(entry.reservation_id, entry.outcome);
  }
  const result = { settled: [] as string[], unknown: [] as string[], released: [] as string[], refused: [] as Array<{ reservation_id: string | null; code: string; message: string }>, unreadable };
  for (const rid of calls) {
    const outcome = outcomes.get(rid) ?? { kind: "unknown" as const };
    const reply = await ledger.settle(rid, outcome);
    if (!reply.ok) result.refused.push({ reservation_id: rid, code: reply.code, message: reply.message });
    else (outcomes.has(rid) ? result.settled : result.unknown).push(rid);
  }
  for (const [key, reservation] of reserves) {
    if (answered.has(key)) continue;
    const held = await ledger.reserve(reservation);
    if (!held.ok) {
      if (!NOTHING_HELD.has(held.code)) result.refused.push({ reservation_id: null, code: held.code, message: held.message });
      continue;
    }
    const rid = held.reservation.reservation_id;
    if (calls.has(rid)) continue;
    const reply = await ledger.settle(rid, { kind: "spent", spent_micros: 0, usage: NO_TOKENS });
    if (!reply.ok) result.refused.push({ reservation_id: rid, code: reply.code, message: reply.message });
    else result.released.push(rid);
  }
  return result;
}

/** The evaluator's client for the management socket. */
export class ProxyControl {
  constructor(
    private socket: string,
    private token: string,
  ) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`http://localhost${path}`, { unix: this.socket, method: "POST", headers: { "content-type": "application/json", [MANAGEMENT_HEADER]: this.token }, body: JSON.stringify(body) });
    const answer = (await res.json()) as T & { detail?: string };
    if (!res.ok) throw new Error(answer.detail ?? `E_INTERNAL: metering proxy ${path}: HTTP ${res.status}`);
    return answer;
  }

  bind(request: BindRequest): Promise<Binding> {
    return this.post("/bind", request);
  }

  unbind(slot: string): Promise<{ ok: true }> {
    return this.post("/unbind", { slot });
  }

  finalize(meterId: string, timeoutMs = FINALIZE_TIMEOUT_MS): Promise<Meter> {
    return this.post("/finalize", { meter_id: meterId, timeout_ms: timeoutMs });
  }
}
