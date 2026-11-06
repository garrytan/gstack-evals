// Copyright (c) 2026 Garry Tan. MIT License.
// The judge run (prereg section 7, amendment item 9): judge-brief-v2.md and one packet per request, the frozen judge
// routing, the seeded double read, one retry on a bad reply. Also the send helpers and flag parsing keys.ts shares.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { priceRequest, reservationMicros } from "../../src/runner/pricing/prices.ts";
import { openItemRun } from "./drive.ts";
import { fail } from "./errors.ts";
import { JUDGE_MAX_TOKENS, judgeSend, keyWriterSend } from "./routes.ts";
import { RETRIES } from "./rule.ts";
import { BUNDLE, type Io, type ItemRun, type ItemRunOptions, type JudgeAnswer, type JudgeRecord, type Packet, type PacketKeyEntry, type SendRequest, type SendResult, type Slot } from "./types.ts";

export const REPO_ROOT = resolve(import.meta.dir, "..", "..");
export const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
export const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isBool = (x: unknown): x is boolean => typeof x === "boolean";
export const isStrs = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === "string");

/** A frozen bundle file, refused (E_TBV_JUDGE) unless it is at its sha256. */
export function readBundle(file: { path: string; sha256: string }, root = REPO_ROOT): string {
  const p = join(root, file.path);
  if (!existsSync(p)) fail("E_TBV_JUDGE", file.path + " is missing");
  const bytes = readFileSync(p);
  if (sha256(bytes) !== file.sha256) fail("E_TBV_JUDGE", file.path + " is not at its frozen sha256 " + file.sha256);
  return bytes.toString("utf8");
}
export function readJson<T>(path: string): T {
  if (!existsSync(path)) fail("E_TBV_INPUT", path + " is missing");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fail("E_TBV_INPUT", path + " is not JSON");
  }
}
export const readNdjson = <T>(path: string): T[] => {
  if (!existsSync(path)) fail("E_TBV_INPUT", path + " is missing");
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l, i) => {
    try {
      return JSON.parse(l) as T;
    } catch {
      return fail("E_TBV_INPUT", path + " line " + (i + 1) + " is not JSON");
    }
  });
};
/** Every *.json file in a directory holding the given schema, in name order. */
export function readJsonDir<T>(dir: string, schema: string, skip: string[] = []): T[] {
  if (!existsSync(dir)) fail("E_TBV_INPUT", dir + " is missing");
  return readdirSync(dir).filter((f) => f.endsWith(".json") && !skip.includes(f)).sort().map((f) => {
    const v = readJson<{ schema?: string }>(join(dir, f));
    if (v.schema !== schema) fail("E_TBV_INPUT", join(dir, f) + " is not a " + schema + " file");
    return v as T;
  });
}
export const inside = (dir: string, path: string) => {
  const rel = relative(resolve(dir), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};
export function readPacketKey(path: string): PacketKeyEntry[] {
  const k = readJson<{ schema?: string; entries?: PacketKeyEntry[] }>(path);
  if (k.schema !== "tbv-packet-key.v1" || !Array.isArray(k.entries)) fail("E_TBV_INPUT", path + " is not a tbv-packet-key.v1 file");
  return k.entries!;
}

/** --name value pairs; unknown, repeated or missing flags are refused. */
export function parseFlags(argv: string[], required: string[], optional: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]!;
    const value = argv[i + 1];
    const name = flag.startsWith("--") ? flag.slice(2) : "";
    if (![...required, ...optional].includes(name)) fail("E_TBV_INPUT", "unknown argument " + JSON.stringify(flag) + "; flags: " + [...required, ...optional].map((f) => "--" + f).join(" "));
    if (value === undefined || value.startsWith("--")) fail("E_TBV_INPUT", flag + " needs a value");
    if (name in out) fail("E_TBV_INPUT", flag + " is given twice");
    out[name] = value!;
  }
  for (const r of required) if (!(r in out)) fail("E_TBV_INPUT", "--" + r + " is required");
  return out;
}

export interface Deps {
  open?: (o: ItemRunOptions) => Promise<ItemRun>;
  judgeSend?: typeof judgeSend;
  keyWriterSend?: typeof keyWriterSend;
  worst?: Worst;
  env?: Record<string, string | undefined>;
  fetch?: ItemRunOptions["fetch"];
}
export const openRun = (a: Record<string, string>, deps: Deps) =>
  (deps.open ?? openItemRun)({ item: a.item!, runId: a["run-id"]!, record: a.record!, ledger: a.ledger!, out: a.out!, env: deps.env ?? process.env, fetch: deps.fetch });

// ---------- Sends ----------

const TRANSPORT = new Set(["5xx", "timeout", "broken-stream", "truncated", "no-final"]);
const STOPS = new Set(["budget", "4xx", "validator", "size", "closer", "outage"]);
export type Worst = (req: SendRequest, maxTokens: number) => number;
/** A send's worst case as the proxy reserves it. */
export const worstOf: Worst = (req, maxTokens) => reservationMicros(priceRequest(req.provider, req.body, maxTokens, req.route));
export const modelOf = (req: SendRequest) => req.provider + ":" + String(req.body.model);
/** Two tries (one retry on an unusable reply), each up to three sends (two transport retries): a slot's allowance covers all. */
export const SENDS_PER_ASK = 2 * (1 + RETRIES);

export type Asked<T> = { ok: true; value: T; responseIds: string[] } | { ok: false; reason: string; responseIds: string[] };
/** One request with up to two transport retries, and one fresh retry when the reply is malformed, cut off at max tokens,
 * refused or empty. A cap, harness or outage refusal stops the run (E_TBV_RUN). */
export async function ask<T>(slot: Slot, build: () => SendRequest, parse: (text: string) => T | string): Promise<Asked<T>> {
  const responseIds: string[] = [];
  let reason = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const req = build();
    let res: SendResult | undefined;
    for (let t = 0; t <= RETRIES; t++) {
      res = await slot.send(req);
      if (res.responseId) responseIds.push(res.responseId);
      if (!TRANSPORT.has(res.kind)) break;
    }
    const r = res!;
    if (STOPS.has(r.kind)) fail("E_TBV_RUN", "slot " + slot.label + " stopped on " + r.kind + (r.problemCode ? " (" + r.problemCode + ")" : "") + "; the run is incomplete");
    if (TRANSPORT.has(r.kind)) return { ok: false, reason: "transport: " + r.kind + " after " + RETRIES + " retries", responseIds };
    if (r.kind === "allowance") return { ok: false, reason: "allowance refusal", responseIds };
    if (r.kind === "text") {
      const v = parse(r.reply?.text ?? "");
      if (typeof v !== "string") return { ok: true, value: v, responseIds };
      reason = "malformed: " + v;
    } else reason = r.kind === "max-tokens" ? "cut off at max tokens" : r.kind === "refusal" ? "refusal" : "no text (" + r.kind + ")";
  }
  return { ok: false, reason: reason + ", after one retry", responseIds };
}

/** The JSON object inside exactly one fenced block with this tag. */
export function fencedJson(text: string, tag: string): { v: unknown } | string {
  const opens = text.split("```" + tag).length - 1;
  const m = [...text.matchAll(new RegExp("```" + tag + "[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*```", "g"))];
  if (opens !== 1 || m.length !== 1) return "expected exactly one fenced " + tag + " block, found " + Math.max(opens, m.length);
  try {
    return { v: JSON.parse(m[0]![1]!) };
  } catch {
    return "the " + tag + " block is not JSON";
  }
}

// ---------- Judge replies ----------

/** Parses one judge reply: one fenced tbv-judge block, one entry per key fact in order. Returns the answer or why it is refused. */
export function parseJudgeReply(text: string, packet: Packet): JudgeAnswer | string {
  const b = fencedJson(text, "tbv-judge");
  if (typeof b === "string") return b;
  const o = b.v;
  if (!isObj(o)) return "the tbv-judge block is not one JSON object";
  if (!Array.isArray(o.facts) || o.facts.length !== packet.facts.length) return "label count: " + (Array.isArray(o.facts) ? o.facts.length : "no") + " fact entries for " + packet.facts.length + " key facts";
  const facts: JudgeAnswer["facts"] = [];
  for (const [i, f] of (o.facts as unknown[]).entries()) {
    const id = packet.facts[i]!.id;
    if (!isObj(f) || f.id !== id) return "fact entry " + (i + 1) + " is not " + id;
    if (!isBool(f.in) || !isBool(f.any)) return "fact " + id + " needs boolean in and any";
    facts.push({ id, in: f.in, any: f.any });
  }
  if (!isStrs(o.unsupported)) return "unsupported must be a list of quoted sentences";
  const ids = new Set(packet.traps.map((t) => t.id));
  if (!isStrs(o.traps) || o.traps.some((t) => !ids.has(t)) || new Set(o.traps).size !== o.traps.length) return "traps must list distinct trap ids from the packet";
  let list: JudgeAnswer["list"] = null;
  if (packet.list) {
    const l = o.list;
    if (!isObj(l) || !isBool(l.named) || !isBool(l.order) || !isBool(l.rest) || !isBool(l.offer)) return "list needs named, order, rest and offer as booleans";
    list = { named: l.named, order: l.order, rest: l.rest, offer: l.offer };
  } else if (o.list != null) return "list must be null: the packet has no list";
  let d1: JudgeAnswer["d1"] = null;
  if (packet.d1 !== null) {
    if (!Array.isArray(o.d1) || !o.d1.every((x) => isObj(x) && typeof x.name === "string" && typeof x.state === "string")) return "d1 must list each item's name and state";
    d1 = (o.d1 as Array<{ name: string; state: string }>).map((x) => ({ name: x.name, state: x.state }));
  } else if (o.d1 != null) return "d1 must be null: no D1 reply was given";
  return { facts, unsupported: o.unsupported, traps: o.traps, list, d1 };
}

export const judgePrompt = (brief: string, packet: string) => brief + "\n" + packet;

/** Judges every packet the key lists, primary then second, one slot each; appends each JudgeRecord to out/judges.ndjson. */
export async function runJudges(o: { packets: string; entries: PacketKeyEntry[]; out: string; brief: string; run: ItemRun; judgeSend?: typeof judgeSend; worst?: Worst }): Promise<JudgeRecord[]> {
  const send = o.judgeSend ?? judgeSend;
  const worst = o.worst ?? worstOf;
  const file = join(o.out, "judges.ndjson");
  if (existsSync(file)) fail("E_TBV_JUDGE", file + " already exists; judge into a new out directory");
  const loaded = o.entries.map((e) => {
    const path = join(o.packets, e.packet + ".json");
    if (!existsSync(path)) fail("E_TBV_JUDGE", "packet " + e.packet + " is missing from " + o.packets);
    const bytes = readFileSync(path);
    if (sha256(bytes) !== e.sha256) fail("E_TBV_JUDGE", "packet " + e.packet + " changed since it was written");
    const packet = JSON.parse(bytes.toString("utf8")) as Packet;
    if (packet.id !== e.packet || packet.kind !== e.kind) fail("E_TBV_JUDGE", "packet " + e.packet + " does not match its key entry");
    return { e, text: bytes.toString("utf8"), packet };
  });
  mkdirSync(o.out, { recursive: true });
  const records: JudgeRecord[] = [];
  for (const { e, text, packet } of loaded)
    for (const [role, judge] of [["primary", e.primary], ["second", e.second]] as const) {
      if (!judge) continue;
      const max = JUDGE_MAX_TOKENS[e.kind];
      const build = () => send(judge, judgePrompt(o.brief, text), max);
      const req = build();
      const slot = o.run.slot(e.packet + "-" + role, [modelOf(req)], SENDS_PER_ASK * worst(req, max));
      try {
        const r = await ask(slot, build, (t) => parseJudgeReply(t, packet));
        const rec: JudgeRecord = r.ok
          ? { packet: e.packet, judge, role, status: "judged", answer: r.value, responseIds: r.responseIds, reason: "" }
          : { packet: e.packet, judge, role, status: "unjudged", answer: null, responseIds: r.responseIds, reason: r.reason };
        appendFileSync(file, JSON.stringify(rec) + "\n");
        records.push(rec);
      } finally {
        await slot.close();
      }
    }
  return records;
}

/** tbv judge --packets DIR --key FILE --out DIR --item ID --run-id ID --record DIR --ledger FILE */
export async function run(argv: string[], io: Io, deps: Deps = {}): Promise<number> {
  const a = parseFlags(argv.slice(1), ["packets", "key", "out", "item", "run-id", "record", "ledger"]);
  if (inside(a.packets!, a.key!)) fail("E_TBV_JUDGE", "the packet key " + a.key + " sits inside the packets directory " + a.packets);
  const entries = readPacketKey(a.key!);
  const brief = readBundle(BUNDLE.judgeBrief);
  const runner = await openRun(a, deps);
  let records: JudgeRecord[];
  try {
    records = await runJudges({ packets: a.packets!, entries, out: a.out!, brief, run: runner, judgeSend: deps.judgeSend, worst: deps.worst });
  } finally {
    await runner.close();
  }
  io.out("judge: " + records.length + " records, " + records.filter((r) => r.status === "unjudged").length + " unjudged");
  return 0;
}
