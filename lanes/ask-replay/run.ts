// Copyright (c) 2026 Garry Tan. MIT License.
// The paid driver (prereg sections 6 and 11), built and tested keyless and never run without the go. Every sample has a
// fixed id (item, arm, model, replicate); within each item a model's arms and replicates run in a seeded random order.
// A shard is a foreground run that stops launching samples after 50 minutes, so it ends before 55. Each sample's record
// is written through an injected store (custody passes one that seals to an age recipient) under its id, atomically,
// and only then is the sample done, so a resumed shard skips every sealed sample id. Before each call the shard journals
// the sample id, draw and attempt; a resumed shard that finds a journaled draw with no sealed record reconciles its calls
// through the spend ledger's unknown-charge path (E_ASK_RESUME), then redraws it once, counted per arm. Retries: one
// retry with the same prompt on an unparsable reply; three retries with backoff on an upstream failure, then UPSTREAM;
// safety stops are their own outcome and are not retried; one end-of-run pass redraws UPSTREAM samples only. Spend runs
// through one lease on the frozen line item per shard (src/runner/ledger): the real client is the metering proxy, which
// reserves and settles every call against the lease, and the keyless client reserves and settles each call on the same
// ledger under its sample id, draw and attempt. particle-1 goes through OpenRouter with the price row's routing, which
// sends data_collection deny; the shard writes that setting to routing.json.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ReasonCode } from "../../src/errors/codes.ts";
import { rigAdmission } from "../../src/rig/admission.ts";
import { openLease, settleLease } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger, type LocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath, recordPath } from "../../src/runner/ledger/paths.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import { chatPrice, openRouterRouting, priceRequest, reservationMicros, usageCost } from "../../src/runner/pricing/prices.ts";
import { MeteringProxy, reconcileJournal } from "../../src/runner/proxy/metering-proxy.ts";
import { seededRandom } from "../../src/runner/stats/paired.ts";
import { pool } from "../product-value/meter.ts";
import { AskError, fail, FROZEN } from "./frozen.ts";
import { ledgerRows, sendCheck } from "./ledger.ts";
import { classify, parseReply } from "./parse.ts";
import { buildPrompt, replySchema, type BuiltPrompt, type GstackText } from "./prompt.ts";
import type { Arm, AskItem, LabelReply, MissingKind, ModelKey, Reply, Sample, SampleRecord } from "./types.ts";

export const sampleId = (item: string, arm: Arm, model: ModelKey, replicate: number): string => item + "." + arm + "." + model + "." + replicate;

/** One model's samples: items by id; within each item its arm cells in seeded random order, each cell's replicates in sequence. k is one count for every arm or a count per arm (the pilot's). */
export function schedule(items: readonly Pick<AskItem, "item">[], model: ModelKey, k: number | Partial<Record<Arm, number>>, seed: number, arms: readonly Arm[] = FROZEN.models[model].arms): Sample[] {
  const rng = seededRandom(seed);
  const reps = (arm: Arm) => (typeof k === "number" ? k : k[arm] ?? 0);
  const out: Sample[] = [];
  for (const it of [...items].sort((a, b) => (a.item < b.item ? -1 : a.item > b.item ? 1 : 0))) {
    const order = arms.filter((a) => reps(a) > 0);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    for (const arm of order) for (let r = 1; r <= reps(arm); r++) out.push({ id: sampleId(it.item, arm, model, r), item: it.item, arm, model, replicate: r, k });
  }
  return out;
}

/** Samples grouped by cell (item, arm, model) in schedule order. A cell's replicates run one after another, so replicate 2 reads the prompt replicate 1 cached; cells run in parallel. */
export function cells(samples: readonly Sample[]): Sample[][] {
  const by = new Map<string, Sample[]>();
  for (const s of samples) {
    const key = s.item + "." + s.arm + "." + s.model;
    const c = by.get(key);
    if (c) c.push(s);
    else by.set(key, [s]);
  }
  return [...by.values()].map((c) => c.sort((a, b) => a.replicate - b.replicate));
}

/** The request body for one sample, on the model's provider route, with JSON schema mode where frozen.json sets it. On Anthropic both the system prefix and the user content end in a cache breakpoint (frozen.json caching). */
export function requestBody(model: ModelKey, p: BuiltPrompt, arm: Arm, maxTokens: number, schema: Record<string, unknown> = replySchema(arm)): Record<string, unknown> {
  const m = FROZEN.models[model];
  if (m.provider === "anthropic") return { model: m.id, max_tokens: maxTokens, system: [{ type: "text", text: p.system, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: [{ type: "text", text: p.user, cache_control: { type: "ephemeral" } }] }], output_config: { effort: m.reasoning_effort, ...(m.json_schema ? { format: { type: "json_schema", schema } } : {}) } };
  if (m.provider === "openai") return { model: m.id, input: [{ role: "system", content: p.system }, { role: "user", content: p.user }], max_output_tokens: maxTokens, store: false, reasoning: { effort: m.reasoning_effort }, ...(m.json_schema ? { text: { format: { type: "json_schema", name: "ask_reply", schema, strict: true } } } : {}) };
  return { model: m.id, max_tokens: maxTokens, messages: [{ role: "system", content: p.system }, { role: "user", content: p.user }], reasoning: { effort: m.reasoning_effort }, ...(m.json_schema ? { response_format: { type: "json_schema", json_schema: { name: "ask_reply", strict: true, schema } } } : {}) };
}

export interface Answer {
  status: number;
  body: unknown;
  micros: number | null;
}

export interface CallKey {
  draw: number;
  attempt: number;
}

export interface Client {
  /** One call: the provider's answer, or null when none came back. Throws AskError for a cap stop, a metering proxy refusal or a processor refusal; any other throw is a crash. */
  call(sample: Sample, key: CallKey, body: Record<string, unknown>): Promise<Answer | null>;
  /** Settles a call a killed shard left open through the unknown-charge path; a no-op where the meter reconciles at open. */
  reconcile?(sample: Sample, key: CallKey, body: Record<string, unknown>): Promise<void>;
}

export interface Store {
  has(id: string): boolean;
  write(id: string, record: SampleRecord): void;
}

export interface ShardOptions {
  items: ReadonlyMap<string, AskItem>;
  samples: readonly Sample[];
  gstack: GstackText | null;
  client: Client;
  store: Store;
  /** Holds calls.ndjson and index.ndjson: sample ids, draws and failure kinds only. */
  out: string;
  maxOutputTokens: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  concurrency?: number;
  stopAfterMs?: number;
  warn?: (code: ReasonCode, message: string) => void;
  /** A labeller run (label.ts): its request body and reply reader replace the arm prompt and the arm reply. */
  job?: LabelJob;
}

export interface LabelJob {
  body(item: AskItem, s: Sample, maxTokens: number): Record<string, unknown>;
  parse(text: string): LabelReply | null;
}

const bodyFor = (o: ShardOptions, item: AskItem, s: Sample) => (o.job ? o.job.body(item, s, o.maxOutputTokens) : requestBody(s.model, buildPrompt(item, s.arm, o.gstack), s.arm, o.maxOutputTokens));

export interface ShardResult {
  ran: number;
  skipped: number;
  left: number;
  redrawn: Partial<Record<Arm, number>>;
  lost_twice: number;
  stopped: "time" | "cap" | null;
  missing: Record<MissingKind, number>;
  capped: number;
}

const R = FROZEN.retries;
/** Draws: 1 first, 2 the one redraw after a resume, 3 the end-of-run UPSTREAM pass; each call's ledger key holds its draw. */
export const UPSTREAM_DRAW = 3;
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Journaled draws per sample id: the highest draw started and its attempts. */
function journaled(file: string): Map<string, { draw: number; attempts: number[] }> {
  const out = new Map<string, { draw: number; attempts: number[] }>();
  if (!existsSync(file)) return out;
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l.trim()) continue;
    let e: { id: string; draw: number; attempt: number };
    try {
      e = JSON.parse(l);
    } catch {
      continue;
    }
    const cur = out.get(e.id);
    if (!cur || e.draw > cur.draw) out.set(e.id, { draw: e.draw, attempts: [e.attempt] });
    else if (e.draw === cur.draw) cur.attempts.push(e.attempt);
  }
  return out;
}

function blank(s: Sample, draw: number, redraw: boolean): SampleRecord {
  return { sample: s, draw, attempts: 0, missing: null, agent_action: null, final_action: null, repeats: s.arm === "c" || s.arm === "d" ? "missing_field" : "not_asked", named: null, reask_reason: false, gate: "none", reason: null, text: null, capped: false, micros: null, upstream_redraw: redraw };
}

/** One sample to its record, with the frozen retries. */
export async function runSample(o: ShardOptions, s: Sample, draw: number, redraw = false): Promise<SampleRecord> {
  const item = o.items.get(s.item) ?? fail("E_ASK_INPUT", "sample " + s.id + " names an item the bundle does not hold");
  const body = bodyFor(o, item, s);
  const provider = FROZEN.models[s.model].provider;
  const sleep = o.sleep ?? realSleep;
  const rec = blank(s, draw, redraw);
  let upstream = 0;
  let unparsable = 0;
  for (;;) {
    rec.attempts++;
    appendFileSync(join(o.out, "calls.ndjson"), JSON.stringify({ id: s.id, draw, attempt: rec.attempts }) + "\n");
    const answer = await o.client.call(s, { draw, attempt: rec.attempts }, body);
    if (answer?.micros != null) rec.micros = (rec.micros ?? 0) + answer.micros;
    const c = classify<Reply | LabelReply>(provider, answer, o.job ? o.job.parse : parseReply);
    if (c.kind === "upstream") {
      if (upstream < R.upstream) {
        await sleep(R.upstream_backoff_ms[upstream] ?? R.upstream_backoff_ms.at(-1)!);
        upstream++;
        continue;
      }
      return { ...rec, missing: "upstream" };
    }
    if (c.kind === "safety") return { ...rec, missing: "safety", text: c.text };
    if (c.kind === "unparsable") {
      if (unparsable < R.unparsable) {
        unparsable++;
        continue;
      }
      o.warn?.("E_ASK_PARSE", "sample " + s.id + " has no valid action after its retry");
      return { ...rec, missing: "parse", text: c.text, capped: c.capped };
    }
    if (o.job) return { ...rec, label: c.reply as LabelReply, reason: (c.reply as LabelReply).reason, text: c.text, capped: c.capped };
    const reply = c.reply as Reply;
    const g = s.arm === "c" || s.arm === "d" ? sendCheck(reply, ledgerRows(item)) : null;
    return { ...rec, agent_action: reply.action, final_action: g ? g.final_action : reply.action, repeats: g ? g.repeats : "not_asked", named: g?.named ?? null, reask_reason: g?.reask_reason ?? false, gate: g?.gate ?? "none", reason: reply.reason, text: c.text, capped: c.capped };
  }
}

const seal = (o: ShardOptions, id: string, r: SampleRecord) => {
  o.store.write(id, r);
  appendFileSync(join(o.out, "index.ndjson"), JSON.stringify({ id, draw: r.draw, missing: r.missing, capped: r.capped }) + "\n");
};

/** Runs the samples not yet sealed, resuming any a killed shard left open, until done, the time stop or a cap stop. */
export async function runShard(o: ShardOptions): Promise<ShardResult> {
  mkdirSync(o.out, { recursive: true });
  const now = o.now ?? Date.now;
  const start = now();
  const stopAfter = o.stopAfterMs ?? FROZEN.shards.stop_launching_after_minutes * 60000;
  const open = journaled(join(o.out, "calls.ndjson"));
  const res: ShardResult = { ran: 0, skipped: 0, left: 0, redrawn: {}, lost_twice: 0, stopped: null, missing: { parse: 0, safety: 0, upstream: 0 }, capped: 0 };
  const step = async (s: Sample) => {
    if (o.store.has(s.id)) return void res.skipped++;
    if (res.stopped || now() - start >= stopAfter) {
      res.stopped ??= "time";
      return void res.left++;
    }
    let draw = 1;
    const j = open.get(s.id);
    if (j) {
      o.warn?.("E_ASK_RESUME", "sample " + s.id + " draw " + j.draw + " started and has no sealed reply; reconciling and redrawing once");
      const item = o.items.get(s.item);
      if (o.client.reconcile && item) {
        const body = bodyFor(o, item, s);
        for (const attempt of j.attempts) await o.client.reconcile(s, { draw: j.draw, attempt }, body);
      }
      if (j.draw > R.resume_redraws) {
        res.lost_twice++;
        res.missing.upstream++;
        return seal(o, s.id, { ...blank(s, j.draw, false), attempts: j.attempts.length, missing: "upstream" });
      }
      draw = j.draw + 1;
      res.redrawn[s.arm] = (res.redrawn[s.arm] ?? 0) + 1;
    }
    try {
      const r = await runSample(o, s, draw);
      seal(o, s.id, r);
      res.ran++;
      if (r.missing) res.missing[r.missing]++;
      if (r.capped) res.capped++;
    } catch (e) {
      if (e instanceof AskError && e.code === "E_ASK_CAP") {
        res.stopped = "cap";
        res.left++;
        return;
      }
      throw e;
    }
  };
  const jobs = cells(o.samples).map((cell) => async () => {
    for (const s of cell) await step(s);
  });
  await pool(o.concurrency ?? FROZEN.shards.concurrency, jobs);
  return res;
}

/** The one end-of-run pass: each UPSTREAM sample once more, sealed under <id>~u; the scorer reads it in place of the first. */
export async function upstreamRedraw(o: ShardOptions): Promise<{ redrawn: number; still_upstream: number }> {
  const index = join(o.out, "index.ndjson");
  const last = new Map<string, string | null>();
  if (existsSync(index)) for (const l of readFileSync(index, "utf8").split("\n").filter((x) => x.trim())) {
    const e = JSON.parse(l) as { id: string; missing: string | null };
    last.set(e.id, e.missing);
  }
  const todo = o.samples.filter((s) => last.get(s.id) === "upstream" && !o.store.has(s.id + "~u"));
  let still = 0;
  await pool(o.concurrency ?? FROZEN.shards.concurrency, cells(todo).map((cell) => async () => {
    for (const s of cell) {
      const r = await runSample(o, s, UPSTREAM_DRAW, true);
      if (r.missing === "upstream") still++;
      seal(o, s.id + "~u", r);
    }
  }));
  return { redrawn: todo.length, still_upstream: still };
}

/** Sealed records to scored records: an end-of-run redraw replaces its first record. */
export function finalRecords(records: ReadonlyMap<string, SampleRecord>): SampleRecord[] {
  return [...records.entries()].filter(([id]) => !id.endsWith("~u")).map(([id, r]) => records.get(id + "~u") ?? r);
}

/** A keyless client on the spend ledger: each call reserves under sample id, draw and attempt and settles once; send stands in for the provider. */
export function ledgerClient(o: { local: LocalLedger; leaseId: string; runId: string; maxOutputTokens: number; send: (s: Sample, key: CallKey, body: Record<string, unknown>) => Promise<{ status: number; body: unknown } | null> }): Client {
  const reserve = async (s: Sample, key: CallKey, body: Record<string, unknown>) => {
    const m = FROZEN.models[s.model];
    const price = priceRequest(m.provider, body, o.maxOutputTokens);
    const ik = s.id + "#" + key.draw + "/" + key.attempt;
    const r = await o.local.reserve({ idempotency_key: ik, lease_id: o.leaseId, cell: { run_id: o.runId, arm: s.arm, task: s.id + "#" + key.draw, model: m.id, trial: s.replicate, attempt: key.attempt, meter_id: ik }, max_micros: reservationMicros(price) });
    if (!r.ok) throw r.code === "CAP_STOP" ? new AskError("E_ASK_CAP", r.message) : new Error(r.code + " " + r.message);
    return { price, reservation: r.reservation };
  };
  return {
    async call(s, key, body) {
      const { price, reservation } = await reserve(s, key, body);
      const answer = await o.send(s, key, body);
      const cost = answer?.status === 200 ? usageCost(price, (answer.body as { usage?: unknown } | null)?.usage) : null;
      const zero = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 };
      const outcome = cost ? { kind: "spent" as const, spent_micros: cost.micros, usage: cost.usage } : answer && answer.status !== 200 ? { kind: "spent" as const, spent_micros: 0, usage: zero } : { kind: "unknown" as const };
      const settled = await o.local.settle(reservation.reservation_id, outcome);
      if (!settled.ok) throw new Error(settled.code + " " + settled.message);
      return answer && { ...answer, micros: cost?.micros ?? null };
    },
    async reconcile(s, key, body) {
      const { reservation } = await reserve(s, key, body);
      if (reservation.state === "reserved") await o.local.settle(reservation.reservation_id, { kind: "unknown" });
    },
  };
}

export interface ProxyMeter {
  client: Client;
  leaseId: string;
  routing: Record<string, unknown> | null;
  close(): Promise<{ spent_micros: number; unknown_micros: number }>;
}

/** One live shard per run directory: a lock file holds the shard's pid and is taken over only when that process is gone. */
function holdRunDir(out: string): { release(): void } {
  const lock = join(out, "shard.lock");
  try {
    writeFileSync(lock, String(process.pid), { flag: "wx" });
  } catch {
    const pid = Number(readFileSync(lock, "utf8"));
    let live = pid === process.pid;
    if (!live && pid > 0) {
      try {
        process.kill(pid, 0);
        live = true;
      } catch (e) {
        live = (e as { code?: string }).code === "EPERM";
      }
    }
    if (live) fail("E_USAGE", "run directory " + out + " is held by a live shard (pid " + pid + "); run one shard per --out at a time");
    writeFileSync(lock, String(process.pid));
  }
  return { release: () => rmSync(lock, { force: true }) };
}

/**
 * The real client: one lease on the spend line item for this shard and the repo's metering proxy (as the product-value
 * eval's meter opens it), with the proxy's journal reconciled and a stale lease this run directory opened settled first. The proxy sends
 * each call once (retries are this driver's, section 6) and reads the provider keys by name from the environment.
 */
export async function openProxyMeter(o: { item: string; runId: string; out: string; model: ModelKey; maxOutputTokens: number; amountMicros?: number; record?: string; ledger?: string; env?: Record<string, string | undefined>; fetch?: typeof fetch; warn?: (code: ReasonCode, message: string) => void }): Promise<ProxyMeter> {
  const env = o.env ?? process.env;
  const m = FROZEN.models[o.model];
  const routing = m.provider === "openrouter" ? openRouterRouting(chatPrice(m.price_row)!) : null;
  if (routing && (routing as { data_collection?: string }).data_collection !== "deny") fail("E_ASK_PROCESSOR", m.id + "'s route does not send data_collection deny");
  const record = recordPath(o.record, env).path;
  const out = resolve(o.out);
  mkdirSync(out, { recursive: true });
  const lock = holdRunDir(out);
  const local = openLocalLedger(ledgerPath(o.ledger, env));
  const warn = o.warn ?? (() => {});
  const journal = join(out, "proxy-journal.ndjson");
  const own = join(out, "lease.json");
  let proxy: MeteringProxy | null = null;
  let leaseId = "";
  try {
    if (existsSync(journal)) {
      await reconcileJournal(journal, local);
      renameSync(journal, join(out, "proxy-journal." + Date.now() + ".dead.ndjson"));
    }
    const open = readItem(record, o.item).open;
    const mine = existsSync(own) ? (JSON.parse(readFileSync(own, "utf8")) as { lease_id?: string }).lease_id : undefined;
    if (open && open.run_id === o.runId && open.lease_id === mine && local.getLease(open.lease_id)) settleLease(record, local, open.lease_id, warn);
    leaseId = openLease(record, local, { item: o.item, run_id: o.runId, amount_micros: o.amountMicros, warn, requireAdmission: rigAdmission({ proof: "direct" }) }).lease_id;
    writeFileSync(own, JSON.stringify({ lease_id: leaseId }) + "\n");
    proxy = new MeteringProxy({ ledger: local, leaseId, host: "127.0.0.1", managementSocket: join(tmpdir(), "ask-" + randomBytes(6).toString("hex") + ".sock"), managementToken: randomBytes(24).toString("hex"), journal, retry: { attempts: 1, elapsed_ms: FROZEN.shards.request_timeout_ms }, env, fetch: o.fetch, maxOutputTokens: o.maxOutputTokens });
    proxy.start();
  } catch (e) {
    if (leaseId && !proxy) settleLease(record, local, leaseId, warn);
    local.close();
    lock.release();
    throw e;
  }
  const p = proxy;
  writeFileSync(join(out, "routing.json"), JSON.stringify({ model: m.price_row, provider_routing: routing }) + "\n");
  const reserved = () => readItem(record, o.item).leases.find((l) => l.lease.lease_id === leaseId)!.lease.reserved_micros;
  const route = m.provider === "anthropic" ? "/v1/messages" : m.provider === "openai" ? "/v1/responses" : "/v1/chat/completions";
  let closed = false;
  return {
    leaseId,
    routing,
    client: {
      async call(s, key, body) {
        if (closed) fail("E_USAGE", "the meter is closed");
        const b = p.bind({ cell: { run_id: o.runId, arm: s.arm, task: s.id + "#" + key.draw, model: m.id, trial: s.replicate, attempt: key.attempt }, models: [m.provider + ":" + m.id], allowance_micros: reserved() });
        let status = 0;
        let text = "";
        try {
          const res = await fetch("http://127.0.0.1:" + p.port + "/" + b.slot + "/" + m.provider + route, { method: "POST", headers: { authorization: "Bearer " + b.token, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(FROZEN.shards.request_timeout_ms) });
          status = res.status;
          text = await res.text();
        } catch {
          status = 0;
        } finally {
          await p.finalize(b.meter_id);
          p.unbind(b.slot);
        }
        const micros = local.meters(leaseId).get(b.meter_id)?.spent_micros ?? null;
        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch {}
        if (parsed?.code === "CAP_STOP") throw new AskError("E_ASK_CAP", "the spend cap refused a reservation for sample " + s.id);
        if (typeof parsed?.code === "string" && parsed.title === parsed.code && parsed.code !== "UPSTREAM") throw new AskError("E_ASK_PROXY", "the metering proxy refused sample " + s.id + " with " + parsed.code + " (HTTP " + status + "), so the sample stays unsealed");
        if (m.provider === "openrouter" && status === 404 && /no endpoints|data polic/i.test(text)) throw new AskError("E_ASK_PROCESSOR", m.id + " has no route that accepts data collection denied");
        if (m.provider === "openrouter" && status === 200 && !/^particle/i.test(String(parsed?.provider ?? ""))) throw new AskError("E_ASK_PROCESSOR", m.id + " was served by a provider other than its pin");
        return status === 0 ? null : { status, body: parsed, micros };
      },
    },
    async close() {
      if (closed) fail("E_USAGE", "the meter is already closed");
      closed = true;
      p.stop();
      try {
        await reconcileJournal(journal, local);
        const c = settleLease(record, local, leaseId, warn);
        return { spent_micros: c.spent_micros, unknown_micros: c.unknown_micros };
      } finally {
        local.close();
        lock.release();
      }
    },
  };
}
