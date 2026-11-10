// Copyright (c) 2026 Garry Tan. MIT License.
// The paid step for the state machines family's packets (GST-1959): section 3's labeller packets under sm-labels and
// section 10's judge packets under sm-judges. It leases its own item through the ledger and sends each call through an
// in-process metering proxy, one slot per call, as the product-value meter and noloss judge-run do. Each call's
// allowance is the per-call bound the prereg prices with (20,000 input and 1,500 output tokens at prices.ts prices, from
// r78Price), and before each call the stage driver's room check runs: the lease's reserve less what it holds and what
// calls in flight may still spend. A call that does not fit cap-stops the item in the ledger and nothing more is sent;
// the ledger then admits no new lease on the item, so a cap stop is never retried. A call the proxy refuses at its own
// allowance check, before any send, is an allowance stop for that packet and reader and is never sent again. Every reply
// goes through the strict readers that sm packets read uses; a malformed one is recorded with E_SM_JUDGE_ANSWER and
// never asked again, since the prereg allows no re-ask. An upstream failure is recorded and stops the send. A call once
// sent is never sent again, including one whose answer a stopped send never recorded (recorded as lost).
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { JUDGE_REASONING_EFFORT, JUDGE_ROUTE, judgeAnswer, judgeRequest } from "../../../src/adapters/judge.ts";
import { CODES, type ReasonCode } from "../../../src/errors/codes.ts";
import { openLease, recordStop, settleLease, type RequireAdmission } from "../../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../../src/runner/ledger/local.ts";
import { usd } from "../../../src/runner/ledger/money.ts";
import { ledgerPath, recordPath } from "../../../src/runner/ledger/paths.ts";
import { LedgerError, readItem } from "../../../src/runner/ledger/record.ts";
import { cutShort } from "../../../src/runner/ledger/sessions.ts";
import { MeteringProxy, reconcileJournal } from "../../../src/runner/proxy/metering-proxy.ts";
import { rigAdmission } from "../../../src/rig/admission.ts";
import { DEFAULT_RETRY } from "../driver/stage.ts";
import { ITEMS } from "./items.ts";
import { assertBlind, judgeFor, LABELLERS, R78_PRICE_BOUND, r78Price, readJudgeAnswer, readLabelAnswer, type JudgePacket, type LabelPacket } from "./packets.ts";
import { smFail } from "./unit.ts";

export type Reader = keyof typeof LABELLERS;
export type Outcome = "answered" | "malformed" | "allowance_stop" | "cap_stop" | "upstream" | "lost";
const READERS = Object.keys(LABELLERS) as Reader[];
const OUTCOMES: Outcome[] = ["answered", "malformed", "allowance_stop", "cap_stop", "upstream", "lost"];
const KEY_ENV = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" } as const;
const MODEL = Object.fromEntries(READERS.map((r) => [r, { provider: LABELLERS[r].split("/")[0] as keyof typeof KEY_ENV, model: LABELLERS[r].split("/")[1]! }])) as Record<Reader, { provider: keyof typeof KEY_ENV; model: string }>;
/** Each reader's per-call allowance in micros: the prereg's per-call bound at its model's prices.ts prices. */
const ALLOWANCE = Object.fromEntries(READERS.map((r) => [r, Math.round(r78Price().per_call_usd[r] * 1e6)])) as Record<Reader, number>;
const KINDS: Record<string, { packet: string; keys: string[] }> = {
  "sm-labels": { packet: "sm-label-packet.v1", keys: ["sm-label-key.v1"] },
  "sm-judges": { packet: "sm-judge-packet.v1", keys: ["sm-judge-key.v1", "sm-r78-key.v1"] },
};

export interface SendOptions {
  item: string;
  /** The run the item's leases name. An item admits one run, so a resumed send names the same run. */
  run_id: string;
  packets: string;
  /** Holds replies.jsonl, raw/<reader>/<packet>.txt and each lease's proxy journal; never inside packets. */
  out: string;
  record?: string;
  ledger?: string;
  concurrency?: number;
  env?: Record<string, string | undefined>;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  requireAdmission?: RequireAdmission;
  log?: (line: string) => void;
}

export interface SendResult {
  item: string;
  run_id: string;
  lease_id: string | null;
  sent: number;
  counts: Record<Outcome, number>;
  spent_micros: number;
  unknown_micros: number;
  replies: string;
}

interface Job {
  packet: string;
  reader: Reader;
}

const ledger = <T>(f: () => T): T => {
  try {
    return f();
  } catch (e) {
    if (e instanceof LedgerError) smFail(e.code, e.message);
    throw e;
  }
};

/**
 * The packets in dir that item pays for, each checked against its digest and its key, and who reads each: both labellers
 * for a label packet; for a judge packet the key's frozen judge, plus every judge whose queue (queue-<reader>.json, from
 * sm packets queue) names it. An R78 labelled item must be in both queues. Each reader's list is its queue in order, then
 * its other packets by id; the lists are sent in turn, one call from each.
 */
function loadPackets(item: string, dir: string) {
  const want = KINDS[item]!;
  const packets = new Map<string, { packet: LabelPacket | JudgePacket; prompt: string }>();
  const keys = new Map<string, Record<string, any>>();
  const queues = new Map<Reader, string[]>();
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    const v = JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, any>;
    if (v?.schema === "sm-label-packet.v1" || v?.schema === "sm-judge-packet.v1") {
      if (v.schema !== want.packet) smFail("E_USAGE", name + " is a " + v.schema + ", which " + item + " does not pay for; give " + item + " a packets dir that holds " + want.packet + " packets only; nothing was opened");
      const { schema: _schema, packet: id, ...body } = v;
      const prompt = JSON.stringify(body);
      if (createHash("sha256").update(prompt).digest("hex").slice(0, 16) !== id) smFail("E_SM_PACKET", "packet " + id + " (" + name + ") no longer matches its digest, so it is not what was built and checked; rebuild it; nothing was opened");
      packets.set(id, { packet: v as LabelPacket | JudgePacket, prompt });
    } else if (KINDS["sm-labels"]!.keys.includes(v?.schema) || KINDS["sm-judges"]!.keys.includes(v?.schema)) keys.set(v.packet, v);
    else if (v?.schema === "sm-labelled-queue.v1") {
      const reader = /^queue-(\w+)\.json$/.exec(name)?.[1] as Reader | undefined;
      if (!reader || !READERS.includes(reader)) smFail("E_SM_PACKET", name + " is a judge's queue but names no judge (" + READERS.map((r) => "queue-" + r + ".json").join(" or ") + "); nothing was opened");
      queues.set(reader!, [...new Set(v.order as string[])]);
    }
  }
  const readers = new Map<string, Set<Reader>>();
  for (const [id, { packet }] of packets) {
    const key = keys.get(id) ?? smFail("E_SM_PACKET", "packet " + id + " has no key in " + dir + "; a packet is sent only beside the key that says who reads it; nothing was opened");
    if (!want.keys.includes(key.schema)) smFail("E_SM_PACKET", "packet " + id + "'s key is a " + key.schema + ", not one of " + want.keys.join(", ") + "; nothing was opened");
    assertBlind(packet, key.schema === "sm-judge-key.v1" ? [key.model, key.unit] : [key.unit]);
    const set = new Set<Reader>(key.schema === "sm-label-key.v1" ? READERS : []);
    if (key.schema === "sm-judge-key.v1") {
      const judge = judgeFor(key.model);
      if (key.judge !== judge) smFail("E_SM_PACKET", "packet " + id + "'s key names judge " + key.judge + ", but section 10's judge for " + key.model + " is " + judge + "; nothing was opened");
      set.add(READERS.find((r) => LABELLERS[r] === judge)!);
    }
    readers.set(id, set);
  }
  for (const [reader, order] of queues) for (const id of order) (readers.get(id) ?? smFail("E_SM_PACKET", "queue-" + reader + ".json names packet " + id + ", which is not in " + dir + "; nothing was opened")).add(reader);
  for (const id of packets.keys()) {
    if (keys.get(id)!.schema === "sm-r78-key.v1" && READERS.some((r) => !queues.get(r)?.includes(id))) smFail("E_SM_PACKET", "labelled item " + id + " is not in every judge's queue; both judges grade every labelled item, in their queue's order (sm packets queue); nothing was opened");
  }
  const sorted = [...packets.keys()].sort();
  const lists = READERS.map((r) => {
    const q = queues.get(r) ?? [];
    return [...q, ...sorted.filter((id) => !q.includes(id) && readers.get(id)!.has(r))].map((packet): Job => ({ packet, reader: r }));
  });
  const order = Array.from({ length: Math.max(0, ...lists.map((l) => l.length)) }, (_, i) => lists.flatMap((l) => (l[i] ? [l[i]!] : []))).flat();
  return { packets, order };
}

/** Sends every packet's calls that the out dir has not recorded, on one lease of the item, and settles the lease. */
export async function sendPackets(o: SendOptions): Promise<SendResult> {
  const def = ITEMS[o.item];
  if (!def || !KINDS[o.item]) smFail("E_USAGE", "sm packets send pays from sm-labels or sm-judges, not " + JSON.stringify(o.item));
  const concurrency = o.concurrency ?? 4;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) smFail("E_USAGE", "--concurrency must be a whole number from 1");
  if (!o.run_id) smFail("E_USAGE", "a send names its run with --run");
  const packetsDir = resolve(o.packets), out = resolve(o.out);
  if (out === packetsDir || out.startsWith(packetsDir + sep)) smFail("E_USAGE", "--out " + out + " is inside --packets " + packetsDir + "; write the replies beside the packets, never among them");
  const { packets, order } = loadPackets(o.item, packetsDir);
  const env = o.env ?? process.env;
  const log = o.log ?? ((line: string) => console.error(line));
  const warn = (code: ReasonCode, message: string) => log(code + " sm packets send: " + message);

  mkdirSync(out, { recursive: true });
  const repliesFile = join(out, "replies.jsonl");
  const counts = Object.fromEntries(OUTCOMES.map((k) => [k, 0])) as Record<Outcome, number>;
  const write = (line: Record<string, unknown>) => appendFileSync(repliesFile, (existsSync(repliesFile) && cutShort(repliesFile) ? "\n" : "") + JSON.stringify({ at: new Date().toISOString(), item: o.item, run_id: o.run_id, ...line }) + "\n");
  const reply = (job: Job, r: { outcome: Outcome; code?: ReasonCode; why?: string; answer?: unknown; raw?: string; micros?: number; meter_id?: string }) => {
    counts[r.outcome]++;
    write({ event: "reply", packet: job.packet, reader: job.reader, model: LABELLERS[job.reader], outcome: r.outcome, code: r.code ?? null, why: r.why ?? null, answer: r.answer ?? null, raw: r.raw ?? null, micros: r.micros ?? null, meter_id: r.meter_id ?? null });
  };
  const prior: Array<{ event?: string; item?: string; run_id?: string; packet: string; reader: Reader; meter_id?: string }> = [];
  for (const l of existsSync(repliesFile) ? readFileSync(repliesFile, "utf8").split("\n") : []) {
    try {
      prior.push(JSON.parse(l));
    } catch {}
  }
  const other = prior.find((l) => l.item !== o.item || l.run_id !== o.run_id);
  if (other) smFail("E_USAGE", repliesFile + " holds replies of " + other.item + " for run " + other.run_id + ", not " + o.item + " for run " + o.run_id + "; give each send its own --out");
  const k = (j: { packet: string; reader: string }) => j.packet + " " + j.reader;
  const done = new Set(prior.filter((l) => l.event === "reply").map(k));
  for (const l of prior) {
    if (l.event !== "send" || done.has(k(l))) continue;
    done.add(k(l));
    reply({ packet: l.packet, reader: l.reader }, { outcome: "lost", code: "UPSTREAM", why: "sent on meter " + l.meter_id + ", but that send stopped before its answer was recorded; the proxy journal settles the call as unknown at its full reservation, and it is never sent again", meter_id: l.meter_id });
  }
  const todo = order.filter((j) => !done.has(k(j)));
  const missing = [...new Set(todo.map((j) => KEY_ENV[MODEL[j.reader].provider]))].filter((name) => !env[name]);
  if (missing.length) smFail("E_KEY_MISSING", "the readers need " + missing.join(" and ") + ", not set; nothing was opened");

  const record = recordPath(o.record, env).path;
  const local = ledger(() => openLocalLedger(ledgerPath(o.ledger, env)));
  const result: SendResult = { item: o.item, run_id: o.run_id, lease_id: null, sent: 0, counts, spent_micros: 0, unknown_micros: 0, replies: repliesFile };
  let lease: { lease_id: string; reserved_micros: number };
  try {
    const state = ledger(() => readItem(record, o.item));
    if (state.cap_micros !== null && (state.program !== def!.program || state.skills.join() !== def!.skills.join())) smFail("E_USAGE", "line item " + o.item + " is recorded in program " + (state.program ?? "none") + " for " + (state.skills.join(", ") || "no skill") + ", not " + def!.program + " for " + def!.skills.join(", ") + " (items.ts); nothing was opened");
    if (state.open && state.open.run_id === o.run_id && local.getLease(state.open.lease_id)) {
      const stale = join(out, state.open.lease_id + ".journal.ndjson");
      if (existsSync(stale)) for (const r of (await reconcileJournal(stale, local)).refused) warn(r.code as ReasonCode, "recovering lease " + state.open.lease_id + ": " + r.message);
      const close = ledger(() => settleLease(record, local, state.open!.lease_id, warn));
      log("SEND_RECOVERED item=" + o.item + " lease=" + close.lease_id + " spent=" + usd(close.spent_micros) + " unknown=" + usd(close.unknown_micros));
    }
    if (!todo.length) {
      local.close();
      return result;
    }
    lease = ledger(() => openLease(record, local, { item: o.item, run_id: o.run_id, warn, requireAdmission: o.requireAdmission ?? rigAdmission({ proof: "direct" }) }));
  } catch (e) {
    local.close();
    throw e;
  }
  result.lease_id = lease.lease_id;
  const journal = join(out, lease.lease_id + ".journal.ndjson");
  const proxy = new MeteringProxy({ ledger: local, leaseId: lease.lease_id, host: "127.0.0.1", managementSocket: join(tmpdir(), "sm-send-" + randomBytes(6).toString("hex") + ".sock"), managementToken: randomBytes(24).toString("hex"), journal, retry: DEFAULT_RETRY, env, fetch: o.fetch, sleep: o.sleep, maxOutputTokens: R78_PRICE_BOUND.output_tokens, refuseServerTools: true });
  const scope = o.item + " only";
  const live = new Map<string, number>();
  let capped = false;
  let stop = null as { code: ReasonCode; why: string } | null;
  let crash: unknown = null;

  const call = async (job: Job) => {
    const allowance = ALLOWANCE[job.reader];
    const meters = local.meters(lease.lease_id);
    let pending = 0;
    for (const [meter_id, allowed] of live) pending += Math.max(0, allowed - (meters.get(meter_id)?.held_micros ?? 0));
    const held = local.held(lease.lease_id);
    const room = lease.reserved_micros - held - pending;
    if (room < allowance) {
      const why = "line item " + o.item + " has " + usd(Math.max(room, 0)) + " of room on lease " + lease.lease_id + " (" + usd(lease.reserved_micros) + " reserved, " + usd(held) + " held, " + usd(pending) + " still allowed to calls in flight); a " + job.reader + " call needs " + usd(allowance) + ". Do not retry: the item ends incomplete, scope " + scope;
      if (!capped) {
        capped = true;
        local.stageStop(lease.lease_id, scope);
        ledger(() => recordStop(record, lease.lease_id, scope));
      }
      reply(job, { outcome: "cap_stop", code: "CAP_STOP", why });
      stop ??= { code: "CAP_STOP", why };
      return;
    }
    const { provider, model } = MODEL[job.reader];
    const b = proxy.bind({ cell: { run_id: o.run_id, arm: job.reader, task: job.packet, model, trial: 1, attempt: 1 }, models: [provider + ":" + model], allowance_micros: allowance });
    live.set(b.meter_id, allowance);
    write({ event: "send", packet: job.packet, reader: job.reader, meter_id: b.meter_id });
    result.sent++;
    let status = 0;
    let text = "";
    let problem: { code?: string; detail?: string } | null = null;
    let meter: Awaited<ReturnType<MeteringProxy["finalize"]>>;
    try {
      const body = judgeRequest(provider, model, packets.get(job.packet)!.prompt, R78_PRICE_BOUND.output_tokens, provider === "openai" ? JUDGE_REASONING_EFFORT : undefined);
      const res = await fetch("http://127.0.0.1:" + proxy.port + "/" + b.slot + "/" + provider + JUDGE_ROUTE[provider], { method: "POST", headers: { authorization: "Bearer " + b.token, "content-type": "application/json" }, body: JSON.stringify(body), timeout: false } as RequestInit);
      status = res.status;
      text = await res.text();
      if ((res.headers.get("content-type") ?? "").includes("application/problem+json")) problem = JSON.parse(text);
    } catch (e) {
      problem = { detail: "the call to the metering proxy failed: " + (e as Error).message };
    } finally {
      meter = await proxy.finalize(b.meter_id);
      proxy.unbind(b.slot);
      live.delete(b.meter_id);
    }
    const base = { micros: local.meters(lease.lease_id).get(b.meter_id)?.held_micros ?? 0, meter_id: b.meter_id };
    if (status === 200) {
      let answer: string | null = null;
      try {
        answer = judgeAnswer(provider, JSON.parse(text));
      } catch {}
      if (answer !== null) {
        const raw = join("raw", job.reader, job.packet + ".txt");
        mkdirSync(join(out, "raw", job.reader), { recursive: true });
        writeFileSync(join(out, raw), answer);
        const { packet } = packets.get(job.packet)!;
        const read = packet.schema === "sm-judge-packet.v1" ? readJudgeAnswer(answer, packet) : readLabelAnswer(answer);
        reply(job, read.ok ? { outcome: "answered", answer: read.answer, raw, ...base } : { outcome: "malformed", code: read.code, why: read.why, raw, ...base });
        return;
      }
    }
    if (meter.requests === 0 && meter.allowance_stops > 0) {
      reply(job, { outcome: "allowance_stop", code: "E_ALLOWANCE", why: problem?.detail ?? "the proxy refused the call at its allowance check", ...base });
      return;
    }
    const code: ReasonCode = meter.requests === 0 && problem?.code && Object.hasOwn(CODES, problem.code) ? (problem.code as ReasonCode) : "UPSTREAM";
    const why = (meter.requests ? "sent " + meter.requests + " time(s), provider answers " + JSON.stringify(meter.upstream.statuses) + (meter.upstream.failed ? ", " + meter.upstream.failed + " lost in transit" : "") + "; " : "") + "the proxy answered HTTP " + status + (problem?.detail ? ": " + problem.detail : status === 200 ? ": the provider's response is not JSON" : "");
    reply(job, { outcome: "upstream", code, why, ...base });
    stop ??= { code, why: job.reader + " on packet " + job.packet + ": " + why + "; the send stops, and a rerun sends only what is not recorded" };
  };

  try {
    proxy.start();
    const queue = [...todo];
    await Promise.all(
      Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (!stop && queue.length) {
          const job = queue.shift()!;
          try {
            await call(job);
          } catch (e) {
            crash ??= e;
            stop ??= { code: "E_INTERNAL", why: (e as Error).message };
          }
        }
      }),
    );
  } finally {
    proxy.stop();
    try {
      for (const r of (await reconcileJournal(journal, local)).refused) warn(r.code as ReasonCode, "settling lease " + lease.lease_id + ": " + r.message);
      const close = ledger(() => settleLease(record, local, lease.lease_id, warn, capped ? scope : undefined));
      result.spent_micros = close.spent_micros;
      result.unknown_micros = close.unknown_micros;
    } finally {
      local.close();
    }
  }
  if (crash) throw crash;
  if (stop) smFail(stop.code, stop.why + ". Lease " + lease.lease_id + " settled at " + usd(result.spent_micros) + " spent and " + usd(result.unknown_micros) + " unknown; replies in " + repliesFile);
  return result;
}
