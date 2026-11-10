// Copyright (c) 2026 Garry Tan. MIT License.
// The paid step for the state machines family's packets (GST-1959): section 3's labeller packets under sm-labels and
// section 10's judge packets under sm-judges. It leases its own item through the ledger and sends each call through an
// in-process metering proxy, one slot per call, as the product-value meter and noloss judge-run do. Calls run one at a
// time. Each call's slot allowance is its packet's byte worst case by the proxy's own formula (prices.ts priceRequest and
// reservationMicros on the exact body the proxy forwards), and before each call the lease's room (its reserve less what
// it holds) must hold that worst case. A call that does not fit cap-stops the item in the ledger and nothing more is
// sent; the ledger then admits no new lease on the item, so a cap stop is never retried. After each call settles, its
// reported usage is checked against the prereg's bound of 20,000 input and 1,500 output tokens (R78_PRICE_BOUND). A call
// past it, or one the proxy refuses at its allowance check, halts the item before the next send: a halt line in the
// replies file refuses every later send until one with --lift-halt records the Captain's ruling. Every reply
// goes through the strict readers that sm packets read uses; a malformed one is recorded with E_SM_JUDGE_ANSWER and
// never asked again, since the prereg allows no re-ask. An upstream failure is recorded and stops the send. One with no
// answer and nothing charged (the proxy meter shows $0 spent, $0 unknown and nothing lost in transit) is recorded as
// uncharged, and the next send asks it once more; if that one resend also fails uncharged, the call is recorded as a gap
// that names both codes and is never sent again. Any other call once
// sent is never sent again, including one whose answer a stopped send never recorded (recorded as lost): its send line
// is on disk before the call goes out, one live send holds the item, and a send whose replies file does not name every
// call the ledger holds for the item and run is refused before it recovers or sends anything. So is a send whose local
// ledger lacks one of the run's leases, unless the owner reconciled that lease and the replies file holds its lease
// line, which a send writes when it opens a lease.
import { createHash, randomBytes } from "node:crypto";
import { Database } from "bun:sqlite";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { JUDGE_REASONING_EFFORT, JUDGE_ROUTE, judgeAnswer, judgeRequest } from "../../../src/adapters/judge.ts";
import { CODES, type ReasonCode } from "../../../src/errors/codes.ts";
import { openLease, recordStop, settleLease, type RequireAdmission } from "../../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../../src/runner/ledger/local.ts";
import { usd } from "../../../src/runner/ledger/money.ts";
import { ledgerPath, recordPath } from "../../../src/runner/ledger/paths.ts";
import { capStopRefusal, LedgerError, readItem } from "../../../src/runner/ledger/record.ts";
import { cutShort } from "../../../src/runner/ledger/sessions.ts";
import { priceRequest, reservationMicros } from "../../../src/runner/pricing/prices.ts";
import { MeteringProxy, reconcileJournal } from "../../../src/runner/proxy/metering-proxy.ts";
import { rigAdmission } from "../../../src/rig/admission.ts";
import { DEFAULT_RETRY } from "../driver/stage.ts";
import { ITEMS } from "./items.ts";
import { assertBlind, judgeFor, LABELLERS, R78_PRICE_BOUND, readJudgeAnswer, readLabelAnswer, type JudgePacket, type LabelPacket } from "./packets.ts";
import { smFail } from "./unit.ts";

export type Reader = keyof typeof LABELLERS;
export type Outcome = "answered" | "malformed" | "allowance_stop" | "cap_stop" | "upstream" | "uncharged" | "gap" | "lost";
const READERS = Object.keys(LABELLERS) as Reader[];
const OUTCOMES: Outcome[] = ["answered", "malformed", "allowance_stop", "cap_stop", "upstream", "uncharged", "gap", "lost"];
const KEY_ENV = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" } as const;
const MODEL = Object.fromEntries(READERS.map((r) => [r, { provider: LABELLERS[r].split("/")[0] as keyof typeof KEY_ENV, model: LABELLERS[r].split("/")[1]! }])) as Record<Reader, { provider: keyof typeof KEY_ENV; model: string }>;
/** The fields the metering proxy adds to a request before it prices it, sent up front so the worst case priced here is the one the proxy reserves. */
const PROXY_FIELDS = { openai: { service_tier: "default" }, anthropic: { inference_geo: "global" } } as const;
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
  /** Meter ids of halts the Captain ruled on. Each must name a halt standing in the replies file; the send records the lift and goes on. */
  lift_halts?: string[];
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
 * The packets in dir that item pays for, each checked against its digest and every key that names it, and who reads
 * each: both labellers for a label packet; for a judge packet each key's frozen judge (two sessions with the same diff and
 * files share one packet), plus every judge whose queue (queue-<reader>.json, from sm packets queue) names it. An R78
 * labelled item must be in both queues. Each reader's list is its queue in order, then its other packets by id; the lists
 * are sent in turn, one call from each.
 */
function loadPackets(item: string, dir: string) {
  const want = KINDS[item]!;
  const packets = new Map<string, { packet: LabelPacket | JudgePacket; prompt: string }>();
  const keys = new Map<string, Array<Record<string, any>>>();
  const queues = new Map<Reader, string[]>();
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    const v = JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, any>;
    if (v?.schema === "sm-label-packet.v1" || v?.schema === "sm-judge-packet.v1") {
      if (v.schema !== want.packet) smFail("E_USAGE", name + " is a " + v.schema + ", which " + item + " does not pay for; give " + item + " a packets dir that holds " + want.packet + " packets only; nothing was opened");
      const { schema: _schema, packet: id, ...body } = v;
      const prompt = JSON.stringify(body);
      if (createHash("sha256").update(prompt).digest("hex").slice(0, 16) !== id) smFail("E_SM_PACKET", "packet " + id + " (" + name + ") no longer matches its digest, so it is not what was built and checked; rebuild it; nothing was opened");
      packets.set(id, { packet: v as LabelPacket | JudgePacket, prompt });
    } else if (KINDS["sm-labels"]!.keys.includes(v?.schema) || KINDS["sm-judges"]!.keys.includes(v?.schema)) keys.set(v.packet, [...(keys.get(v.packet) ?? []), v]);
    else if (v?.schema === "sm-labelled-queue.v1") {
      const reader = /^queue-(\w+)\.json$/.exec(name)?.[1] as Reader | undefined;
      if (!reader || !READERS.includes(reader)) smFail("E_SM_PACKET", name + " is a judge's queue but names no judge (" + READERS.map((r) => "queue-" + r + ".json").join(" or ") + "); nothing was opened");
      queues.set(reader!, [...new Set(v.order as string[])]);
    }
  }
  for (const [id, named] of keys) if (!packets.has(id)) smFail("E_SM_PACKET", "a " + named[0]!.schema + " in " + dir + " names packet " + id + ", which is not in " + dir + "; a key is sent only beside its packet, so a key whose packet is missing is refused, never skipped; nothing was opened");
  const readers = new Map<string, Set<Reader>>();
  for (const [id, { packet }] of packets) {
    const set = new Set<Reader>();
    for (const key of keys.get(id) ?? smFail("E_SM_PACKET", "packet " + id + " has no key in " + dir + "; a packet is sent only beside the key that says who reads it; nothing was opened")) {
      if (!want.keys.includes(key.schema)) smFail("E_SM_PACKET", "packet " + id + "'s key is a " + key.schema + ", not one of " + want.keys.join(", ") + "; nothing was opened");
      assertBlind(packet, key.schema === "sm-judge-key.v1" ? [key.model, key.unit] : [key.unit]);
      if (key.schema === "sm-label-key.v1") for (const r of READERS) set.add(r);
      if (key.schema === "sm-judge-key.v1") {
        const judge = judgeFor(key.model);
        if (key.judge !== judge) smFail("E_SM_PACKET", "packet " + id + "'s key names judge " + key.judge + ", but section 10's judge for " + key.model + " is " + judge + "; nothing was opened");
        set.add(READERS.find((r) => LABELLERS[r] === judge)!);
      }
    }
    readers.set(id, set);
  }
  for (const [reader, order] of queues) for (const id of order) (readers.get(id) ?? smFail("E_SM_PACKET", "queue-" + reader + ".json names packet " + id + ", which is not in " + dir + "; nothing was opened")).add(reader);
  for (const id of packets.keys()) {
    if (keys.get(id)!.some((key) => key.schema === "sm-r78-key.v1") && READERS.some((r) => !queues.get(r)?.includes(id))) smFail("E_SM_PACKET", "labelled item " + id + " is not in every judge's queue; both judges grade every labelled item, in their queue's order (sm packets queue); nothing was opened");
  }
  const sorted = [...packets.keys()].sort();
  const lists = READERS.map((r) => {
    const q = queues.get(r) ?? [];
    return [...q, ...sorted.filter((id) => !q.includes(id) && readers.get(id)!.has(r))].map((packet): Job => ({ packet, reader: r }));
  });
  const order = Array.from({ length: Math.max(0, ...lists.map((l) => l.length)) }, (_, i) => lists.flatMap((l) => (l[i] ? [l[i]!] : []))).flat();
  return { packets, order };
}

/**
 * One live send per item on this host, so a send never recovers or settles a lease another live send meters: an exclusive
 * SQLite lock in a file beside the record, which the operating system lets go when the process ends.
 */
function holdItemLock(record: string, item: string): Database {
  const file = join(dirname(record), "." + basename(record) + ".send-" + item + ".lock.db");
  const db = new Database(file, { create: true });
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("BEGIN EXCLUSIVE");
    return db;
  } catch (e) {
    db.close();
    return smFail("E_USAGE", "another send still holds line item " + item + " on this host (" + file + ": " + (e as Error).message + "); let it finish or stop it before sending again; nothing was written, recovered or opened");
  }
}

/** Sends every packet's calls that the out dir has not recorded, on one lease of the item, and settles the lease. */
export async function sendPackets(o: SendOptions): Promise<SendResult> {
  if (!ITEMS[o.item] || !KINDS[o.item]) smFail("E_USAGE", "sm packets send pays from sm-labels or sm-judges, not " + JSON.stringify(o.item));
  const record = recordPath(o.record, o.env ?? process.env).path;
  if (!existsSync(record)) smFail("E_LEDGER_MISSING", "no approval record is at " + record + "; nothing was opened");
  const lock = holdItemLock(realpathSync(record), o.item);
  try {
    return await sendHeld(o, record);
  } finally {
    lock.close();
  }
}

async function sendHeld(o: SendOptions, record: string): Promise<SendResult> {
  const def = ITEMS[o.item]!;
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
  let torn = 0;
  const write = (line: Record<string, unknown>) => {
    const fresh = !existsSync(repliesFile);
    const fd = openSync(repliesFile, "a");
    try {
      const stamp = { at: new Date().toISOString(), item: o.item, run_id: o.run_id };
      writeSync(fd, (!fresh && cutShort(repliesFile) ? "\n" : "") + (torn ? JSON.stringify({ ...stamp, event: "torn", lines: torn }) + "\n" : "") + JSON.stringify({ ...stamp, ...line }) + "\n");
      fsyncSync(fd);
      torn = 0;
    } finally {
      closeSync(fd);
    }
    if (!fresh) return;
    const dir = openSync(out, "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  };
  const reply = (job: Job, r: { outcome: Outcome; code?: ReasonCode; first_code?: ReasonCode; why?: string; answer?: unknown; raw?: string; micros?: number; meter_id?: string }) => {
    counts[r.outcome]++;
    write({ event: "reply", packet: job.packet, reader: job.reader, model: LABELLERS[job.reader], outcome: r.outcome, code: r.code ?? null, ...(r.first_code ? { first_code: r.first_code } : {}), why: r.why ?? null, answer: r.answer ?? null, raw: r.raw ?? null, micros: r.micros ?? null, meter_id: r.meter_id ?? null });
  };
  const prior: Array<{ at?: string; event?: string; item?: string; run_id?: string; packet: string; reader: Reader; meter_id?: string; lease_id?: string; outcome?: Outcome; code?: ReasonCode; why?: string }> = [];
  const rows = existsSync(repliesFile) ? readFileSync(repliesFile, "utf8").split("\n") : [];
  if (rows.at(-1) === "") rows.pop();
  for (const [i, row] of rows.entries()) {
    let v: unknown = null;
    try {
      v = JSON.parse(row);
    } catch {}
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      torn++;
      continue;
    }
    if (torn && (v as { event?: unknown }).event !== "torn") smFail("E_USAGE", repliesFile + " line " + (i - torn + 1) + " won't parse. Only the lines a crash cut short at the end of the file may, and the next send marks them with a torn line; nothing was opened");
    torn = 0;
    prior.push(v as (typeof prior)[number]);
  }
  const other = prior.find((l) => l.item !== o.item || l.run_id !== o.run_id);
  if (other) smFail("E_USAGE", repliesFile + " holds replies of " + other.item + " for run " + other.run_id + ", not " + o.item + " for run " + o.run_id + "; give each send its own --out");
  const k = (j: { packet: string; reader: string }) => j.packet + " " + j.reader;
  const done = new Set(prior.filter((l) => l.event === "reply" && l.outcome !== "cap_stop" && l.outcome !== "uncharged").map(k));
  const uncharged = new Map<string, (typeof prior)[number]>();
  for (const l of prior) if (l.event === "reply" && l.outcome === "uncharged" && !uncharged.has(k(l))) uncharged.set(k(l), l);
  const replied = new Set(prior.filter((l) => l.event === "reply" && l.meter_id).map((l) => l.meter_id));
  const lost = new Map<string, (typeof prior)[number]>();
  for (const l of prior) if (l.event === "send" && !replied.has(l.meter_id) && !done.has(k(l)) && !lost.has(k(l))) lost.set(k(l), l);
  const todo = order.filter((j) => !done.has(k(j)) && !lost.has(k(j)));
  const halts = new Map<string, (typeof prior)[number]>();
  for (const l of prior) {
    if (l.event === "halt" && l.meter_id) halts.set(l.meter_id, l);
    if (l.event === "lift" && l.meter_id) halts.delete(l.meter_id);
  }
  const lifts = [...new Set(o.lift_halts ?? [])];
  const unknownLift = lifts.find((m) => !halts.has(m));
  if (unknownLift) smFail("E_USAGE", "--lift-halt " + unknownLift + " names no halt standing in " + repliesFile + "; nothing was opened");
  const standing = [...halts.values()].find((h) => !lifts.includes(h.meter_id!));
  if (standing) smFail(standing.code ?? "E_SM_USAGE_HALT", "line item " + o.item + " halted at " + standing.at + ": " + standing.why + "; once the Captain rules, send again with --lift-halt " + standing.meter_id + "; nothing was opened");
  const missing = [...new Set(todo.map((j) => KEY_ENV[MODEL[j.reader].provider]))].filter((name) => !env[name]);
  if (missing.length) smFail("E_KEY_MISSING", "the readers need " + missing.join(" and ") + ", not set; nothing was opened");

  const local = ledger(() => openLocalLedger(ledgerPath(o.ledger, env)));
  const result: SendResult = { item: o.item, run_id: o.run_id, lease_id: null, sent: 0, counts, spent_micros: 0, unknown_micros: 0, replies: repliesFile };
  let lease: { lease_id: string; reserved_micros: number };
  try {
    const state = ledger(() => readItem(record, o.item));
    if (state.cap_micros !== null && (state.program !== def!.program || state.skills.join() !== def!.skills.join())) smFail("E_USAGE", "line item " + o.item + " is recorded in program " + (state.program ?? "none") + " for " + (state.skills.join(", ") || "no skill") + ", not " + def!.program + " for " + def!.skills.join(", ") + " (items.ts); nothing was opened");
    const cannotLease = capStopRefusal(state) !== null || (state.cap_micros !== null && state.committed_micros >= state.cap_micros);
    const leased = new Set(prior.flatMap((l) => (l.event === "lease" && l.lease_id ? [l.lease_id] : [])));
    const unheld = cannotLease ? [] : state.leases.filter(({ lease, close }) => lease.run_id === o.run_id && !local.getLease(lease.lease_id) && !(close?.how === "reconciled" && leased.has(lease.lease_id))).map(({ lease }) => lease.lease_id);
    if (unheld.length) smFail("E_USAGE", "line item " + o.item + " holds run " + o.run_id + "'s lease " + unheld.join(", ") + ", which the local ledger at " + local.path + " does not hold. A send resumes only on the ledger that sent the run's calls, since another ledger can't tell which calls are already paid for. The one exception is a lease the owner reconciled whose lease line is in " + repliesFile + ", since those replies record every call it made; nothing was recovered, settled or opened");
    const named = new Set(prior.flatMap((l) => (l.event === "send" && l.meter_id ? [l.meter_id] : [])));
    const unnamed = state.leases.filter(({ lease }) => lease.run_id === o.run_id).flatMap(({ lease }) => [...local.meters(lease.lease_id).keys()].filter((m) => !named.has(m)).map((m) => "lease " + lease.lease_id + " meter " + m));
    if (unnamed.length) smFail("E_USAGE", repliesFile + " names no send for " + unnamed.join(", ") + ", which the ledger holds for run " + o.run_id + " on line item " + o.item + ". A send resumes only from the --out that holds its replies, so a replies file that is missing, emptied, cut short by a crash or from another --out can't serve the run; nothing was recovered, settled or opened");
    for (const m of lifts) write({ event: "lift", packet: halts.get(m)!.packet, reader: halts.get(m)!.reader, meter_id: m });
    if (state.open && state.open.run_id === o.run_id && local.getLease(state.open.lease_id)) {
      const stale = join(out, state.open.lease_id + ".journal.ndjson");
      if (existsSync(stale)) for (const r of (await reconcileJournal(stale, local)).refused) warn(r.code as ReasonCode, "recovering lease " + state.open.lease_id + ": " + r.message);
      const close = ledger(() => settleLease(record, local, state.open!.lease_id, warn));
      log("SEND_RECOVERED item=" + o.item + " lease=" + close.lease_id + " spent=" + usd(close.spent_micros) + " unknown=" + usd(close.unknown_micros));
    }
    const halted = new Set(prior.flatMap((l) => (l.event === "halt" && l.meter_id ? [l.meter_id] : [])));
    const runLeases = state.leases.filter(({ lease }) => lease.run_id === o.run_id).map(({ lease }) => lease.lease_id);
    const newHalts: string[] = [];
    for (const l of lost.values()) {
      const u = runLeases.map((id) => local.meters(id).get(l.meter_id!)).find(Boolean)?.usage;
      const usage = u ? { input: u.input + u.cache_read + u.cache_write, output: u.output + u.reasoning } : null;
      if (usage && (usage.input > R78_PRICE_BOUND.input_tokens || usage.output > R78_PRICE_BOUND.output_tokens) && !halted.has(l.meter_id!)) {
        write({ event: "halt", packet: l.packet, reader: l.reader, meter_id: l.meter_id, code: "E_SM_USAGE_HALT", why: l.reader + " on packet " + l.packet + " (meter " + l.meter_id + ") settled at " + usage.input + " input and " + usage.output + " output tokens, past the prereg's bound of " + R78_PRICE_BOUND.input_tokens + " input and " + R78_PRICE_BOUND.output_tokens + " output tokens, and its send stopped before its reply and halt were recorded", usage });
        newHalts.push(l.meter_id!);
      }
      reply({ packet: l.packet, reader: l.reader }, { outcome: "lost", code: "UPSTREAM", why: "sent on meter " + l.meter_id + ", but that send stopped before its answer was recorded; the proxy journal settles the call as unknown at its full reservation, and it is never sent again", meter_id: l.meter_id });
    }
    if (newHalts.length) smFail("E_SM_USAGE_HALT", "line item " + o.item + " halted: a call its last send never recorded settled past the prereg's bound (meter " + newHalts.join(", ") + "); the halt line is in " + repliesFile + ". Once the Captain rules, send again with --lift-halt " + newHalts.join(",") + "; nothing was opened");
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
  write({ event: "lease", lease_id: lease.lease_id });
  const journal = join(out, lease.lease_id + ".journal.ndjson");
  const proxy = new MeteringProxy({ ledger: local, leaseId: lease.lease_id, host: "127.0.0.1", managementSocket: join(tmpdir(), "sm-send-" + randomBytes(6).toString("hex") + ".sock"), managementToken: randomBytes(24).toString("hex"), journal, retry: DEFAULT_RETRY, env, fetch: o.fetch, sleep: o.sleep, maxOutputTokens: R78_PRICE_BOUND.output_tokens, refuseServerTools: true });
  const scope = o.item + " only";
  let capped = false;
  let stop = null as { code: ReasonCode; why: string } | null;
  let crash: unknown = null;

  const call = async (job: Job) => {
    const { provider, model } = MODEL[job.reader];
    const body = { ...judgeRequest(provider, model, packets.get(job.packet)!.prompt, R78_PRICE_BOUND.output_tokens, provider === "openai" ? JUDGE_REASONING_EFFORT : undefined), ...PROXY_FIELDS[provider] };
    const worst = reservationMicros(priceRequest(provider, body, R78_PRICE_BOUND.output_tokens, JUDGE_ROUTE[provider]));
    const held = local.held(lease.lease_id);
    const room = lease.reserved_micros - held;
    if (room < worst) {
      const why = "line item " + o.item + " has " + usd(Math.max(room, 0)) + " of room on lease " + lease.lease_id + " (" + usd(lease.reserved_micros) + " reserved, " + usd(held) + " held); a " + job.reader + " call on packet " + job.packet + " has a byte worst case of " + usd(worst) + ". Do not retry: the item ends incomplete, scope " + scope;
      capped = true;
      local.stageStop(lease.lease_id, scope);
      ledger(() => recordStop(record, lease.lease_id, scope));
      reply(job, { outcome: "cap_stop", code: "CAP_STOP", why });
      stop = { code: "CAP_STOP", why };
      return;
    }
    const b = proxy.bind({ cell: { run_id: o.run_id, arm: job.reader, task: job.packet, model, trial: 1, attempt: 1 }, models: [provider + ":" + model], allowance_micros: worst });
    write({ event: "send", packet: job.packet, reader: job.reader, meter_id: b.meter_id, worst_micros: worst });
    result.sent++;
    let status = 0;
    let text = "";
    let problem: { code?: string; detail?: string } | null = null;
    let meter: Awaited<ReturnType<MeteringProxy["finalize"]>>;
    try {
      const res = await fetch("http://127.0.0.1:" + proxy.port + "/" + b.slot + "/" + provider + JUDGE_ROUTE[provider], { method: "POST", headers: { authorization: "Bearer " + b.token, "content-type": "application/json" }, body: JSON.stringify(body), timeout: false } as RequestInit);
      status = res.status;
      text = await res.text();
      if ((res.headers.get("content-type") ?? "").includes("application/problem+json")) problem = JSON.parse(text);
    } catch (e) {
      problem = { detail: "the call to the metering proxy failed: " + (e as Error).message };
    } finally {
      meter = await proxy.finalize(b.meter_id);
      proxy.unbind(b.slot);
    }
    const settled = local.meters(lease.lease_id).get(b.meter_id);
    const base = { micros: settled?.held_micros ?? 0, meter_id: b.meter_id };
    const failed = ((): Parameters<typeof reply>[1] => {
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
          return read.ok ? { outcome: "answered", answer: read.answer, raw, ...base } : { outcome: "malformed", code: read.code, why: read.why, raw, ...base };
        }
      }
      if (meter.requests === 0 && meter.allowance_stops > 0) return { outcome: "allowance_stop", code: "E_ALLOWANCE", why: (problem?.detail ?? "the proxy refused the call at its allowance check") + ", though the sender priced its worst case at " + usd(worst), ...base };
      const code: ReasonCode = meter.requests === 0 && problem?.code && Object.hasOwn(CODES, problem.code) ? (problem.code as ReasonCode) : "UPSTREAM";
      const why = (meter.requests ? "sent " + meter.requests + " time(s), provider answers " + JSON.stringify(meter.upstream.statuses) + (meter.upstream.failed ? ", " + meter.upstream.failed + " lost in transit" : "") + "; " : "") + "the proxy answered HTTP " + status + (problem?.detail ? ": " + problem.detail : status === 200 ? ": the provider's response is not JSON" : "");
      return { outcome: "upstream", code, why, ...base };
    })();
    const first = uncharged.get(k(job));
    const free = failed.outcome === "upstream" && meter.upstream.failed === 0 && !settled?.spent_micros && !settled?.unknown_micros;
    const r: Parameters<typeof reply>[1] = !free ? failed : first ? { ...failed, outcome: "gap", first_code: first.code ?? "UPSTREAM", why: failed.why + "; its one resend after a first uncharged failure (" + (first.code ?? "UPSTREAM") + ") failed uncharged again, so it is a gap and is never sent again" } : { ...failed, outcome: "uncharged", why: failed.why + "; no answer and nothing charged, so the next send asks it once more" };
    const u = settled?.usage;
    const usage = u ? { input: u.input + u.cache_read + u.cache_write, output: u.output + u.reasoning } : null;
    const past = usage !== null && (usage.input > R78_PRICE_BOUND.input_tokens || usage.output > R78_PRICE_BOUND.output_tokens);
    const halt = past
      ? { code: "E_SM_USAGE_HALT" as ReasonCode, why: job.reader + " on packet " + job.packet + " (meter " + b.meter_id + ") reported " + usage!.input + " input and " + usage!.output + " output tokens, past the prereg's bound of " + R78_PRICE_BOUND.input_tokens + " input and " + R78_PRICE_BOUND.output_tokens + " output tokens" }
      : r.outcome === "allowance_stop"
        ? { code: "E_ALLOWANCE" as ReasonCode, why: job.reader + " on packet " + job.packet + " (meter " + b.meter_id + "): " + r.why }
        : null;
    if (halt) write({ event: "halt", packet: job.packet, reader: job.reader, meter_id: b.meter_id, code: halt.code, why: halt.why, usage });
    reply(job, r);
    if (r.outcome === "upstream" || r.outcome === "uncharged" || r.outcome === "gap") stop ??= { code: r.code!, why: job.reader + " on packet " + job.packet + ": " + r.why + "; the send stops, and a rerun sends only what is not recorded, plus an uncharged call once more" };
    if (halt) stop = { code: halt.code, why: halt.why + "; the item halts before the next send until the Captain rules, then send again with --lift-halt " + b.meter_id };
  };

  try {
    proxy.start();
    for (const job of todo) {
      if (stop) break;
      try {
        await call(job);
      } catch (e) {
        crash ??= e;
        stop ??= { code: "E_INTERNAL", why: (e as Error).message };
      }
    }
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
