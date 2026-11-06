// Copyright (c) 2026 Garry Tan. MIT License.
// Judge packets (prereg section 7): one first packet per reading, a D2 packet, the stock and oracle controls, and the
// packet key kept apart.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { heldOutputs } from "./custody.ts";
import { fail, notBuilt } from "./errors.ts";
import { inside, parseFlags, readBundle, readJson, readJsonDir, readNdjson, sha256 } from "./judge.ts";
import * as rule from "./rule.ts";
import { boundary, CUT } from "./rule.ts";
import { BUNDLE, type Io, type Judge, JUDGE_OF, type Key, otherJudge, type Packet, type PacketKeyEntry, type PacketKind, type ReadingRecord, type SplitManifest } from "./types.ts";

export const BOUNDARY = "<<<BOUNDARY>>>";

/** The oracle report: the key's fact statements joined, cut to 250 words. */
export function oracleReport(key: Key): string {
  const t = key.facts.map((f) => f.statement).join(" ");
  return t.slice(0, boundary(t, CUT));
}
/** The first reply with the boundary line after its 250th word. */
export function withBoundary(reply: string): string {
  const b = boundary(reply, CUT);
  return reply.slice(0, b) + "\n" + BOUNDARY + "\n" + reply.slice(b);
}
const ruleDoubleRead = (label: string): boolean => {
  const f = (rule as unknown as { doubleRead?: (l: string) => boolean }).doubleRead;
  return f ? f(label) : notBuilt("rule.ts doubleRead");
};
export const packetBytes = (p: Packet) => JSON.stringify(p, null, 2) + "\n";

/** Packets and their key: first and D2 packets for scored readings, stock and oracle controls for each control task. */
export function buildPackets(o: { records: ReadingRecord[]; keys: Record<string, Key>; controlTaskIds: string[]; stock: string; doubleRead?: (label: string) => boolean }): { packets: Packet[]; entries: PacketKeyEntry[] } {
  const pick = o.doubleRead ?? ruleDoubleRead;
  const packets: Packet[] = [];
  const entries: PacketKeyEntry[] = [];
  const keyOf = (task: string) => o.keys[task] ?? fail("E_TBV_INPUT", "no key for task " + task);
  const add = (kind: PacketKind, key: Key, reply: string, d1: string | null, label: string, primary: Judge, second: Judge | null) => {
    const small = kind === "d2";
    const p: Packet = { schema: "tbv-packet.v1", id: randomBytes(12).toString("hex"), kind, digest: key.digest, facts: small ? [] : key.facts.map((f) => ({ id: f.id, statement: f.statement })), traps: small ? [] : key.traps.map((t) => ({ id: t.id, claim: t.claim })), list: small ? null : key.list, reply, d1 };
    packets.push(p);
    entries.push({ packet: p.id, sha256: sha256(packetBytes(p)), kind, label, task: key.task, primary, second });
  };
  for (const r of o.records) {
    if (r.cls !== "scored") continue;
    if (r.texts.report === null || !r.responseIds.length) fail("E_TBV_INPUT", "scored reading " + r.label + " has no report text or no response id");
    const key = keyOf(r.task);
    const primary = JUDGE_OF[r.model];
    add("first", key, withBoundary(r.texts.report!), r.texts.d1, r.label, primary, pick(r.label) ? otherJudge(primary) : null);
    if (r.texts.d2 !== null) add("d2", key, r.texts.d2, null, r.label, primary, null);
  }
  for (const task of o.controlTaskIds) {
    const key = keyOf(task);
    add("control", key, withBoundary(o.stock), null, "stock:" + task, "opus", "sol");
    add("control", key, withBoundary(oracleReport(key)), null, "oracle:" + task, "opus", "sol");
  }
  return { packets, entries };
}

/** Writes one file per packet and the key apart; refuses (E_TBV_JUDGE) a key path inside the packets directory. */
export function writePackets(dir: string, keyPath: string, built: { packets: Packet[]; entries: PacketKeyEntry[] }): void {
  if (inside(dir, keyPath)) fail("E_TBV_JUDGE", "the packet key " + keyPath + " sits inside the packets directory " + dir);
  if (existsSync(dir) && readdirSync(dir).length) fail("E_TBV_INPUT", dir + " is not empty; write packets into a new directory");
  if (existsSync(keyPath)) fail("E_TBV_INPUT", keyPath + " already exists");
  mkdirSync(dir, { recursive: true });
  for (const p of built.packets) writeFileSync(join(dir, p.id + ".json"), packetBytes(p));
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, JSON.stringify({ schema: "tbv-packet-key.v1", entries: built.entries }, null, 2) + "\n");
}

/** Driver records from one file (.json array or object, or ndjson) or every such file in a directory. */
export function readRecords(path: string): ReadingRecord[] {
  if (!existsSync(path)) fail("E_TBV_INPUT", path + " is missing");
  const files = statSync(path).isDirectory() ? readdirSync(path).filter((f) => /\.(json|ndjson|jsonl)$/.test(f)).sort().map((f) => join(path, f)) : [path];
  const recs = files.flatMap((f) => (f.endsWith(".json") ? [readJson<ReadingRecord | ReadingRecord[]>(f)].flat() : readNdjson<ReadingRecord>(f)));
  for (const r of recs) if (r.schema !== "tbv-reading.v1") fail("E_TBV_INPUT", path + " holds a record that is not tbv-reading.v1");
  return recs;
}
export const readKeys = (dir: string): Record<string, Key> => Object.fromEntries(readJsonDir<Key>(dir, "tbv-key.v1", ["drops.json"]).map((k) => [k.task, k]));
export function readManifest(path: string): SplitManifest {
  const m = readJson<SplitManifest>(path);
  if (m.schema !== "tbv-split.v1" || !Array.isArray(m.tasks) || !Array.isArray(m.controlTaskIds)) fail("E_TBV_INPUT", path + " is not a tbv-split.v1 manifest");
  return m;
}

/** tbv packets --records PATH --keys DIR --split FILE --out DIR --key FILE [--held SEALED_DIR --seal-cmd CMD] */
export async function run(argv: string[], io: Io): Promise<number> {
  const a = parseFlags(argv.slice(1), ["records", "keys", "split", "out", "key"], ["held", "seal-cmd"]);
  const seal = heldOutputs(a, ["out", "key"]);
  if (inside(a.out!, a.key!)) fail("E_TBV_JUDGE", "the packet key " + a.key + " sits inside the packets directory " + a.out);
  const manifest = readManifest(a.split!);
  const records = readRecords(a.records!);
  const tasks = new Set(manifest.tasks.map((t) => t.id));
  for (const r of records) if (!tasks.has(r.task)) fail("E_TBV_INPUT", "reading " + r.label + " names a task the split manifest does not hold");
  const built = buildPackets({ records, keys: readKeys(a.keys!), controlTaskIds: manifest.controlTaskIds, stock: readBundle(BUNDLE.stock) });
  writePackets(a.out!, a.key!, built);
  if (seal) for (const f of [...built.packets.map((p) => join(a.out!, p.id + ".json")), a.key!]) seal(f);
  const n = (k: PacketKind) => built.entries.filter((e) => e.kind === k).length;
  io.out("packets: " + n("first") + " first, " + n("d2") + " d2, " + n("control") + " control");
  return 0;
}
