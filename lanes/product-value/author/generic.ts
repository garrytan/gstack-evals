// Copyright (c) 2026 Garry Tan. MIT License.
// pv generic (prereg 2026-11-08-geva-403, section 3, "Generic screen"): Astra and Opus each label every key item of a
// unit against stock rows 1 and 2 only, as if the rows were reviews, with the production label brief, the same packet
// rendering, normalization and judge client (so calls cache by model, prompt and packet). Row 3 never screens. An item
// either judge marks anticipated by either row becomes generic. The command writes generic: true on those items,
// recomputes primary by section 3's rule and prints counts only, never key text. A cell still missing after the one
// whole-packet resend leaves its item not generic and is counted as unlabelled. A unit left with no primary item is
// reported as dropped; nothing is deleted.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Io } from "../cli.ts";
import { loadNormalize, parseArgs, PvError, readJson, refuseAliases, refuseInRepo, writeJson, type Normalize } from "../io.ts";
import { labelPacket, openJudge, type CallLog, type Caller } from "../judge.ts";
import { STOCK_ROWS, words, type ListRef, type PacketFile, type PacketMeta } from "../packets.ts";
import { randomId, SEED, seededRandom, shuffle } from "../stats.ts";
import type { Key } from "../types.ts";

export const GENERIC_ITEM = "pv-auth-generic";

/** One unit's screen packet: every key item against stock rows 1 and 2, ids and order seeded so reruns hit the cache. */
export function genericPacket(key: Key, normalize: Normalize): { packet: PacketFile; meta: PacketMeta } {
  const rng = seededRandom(SEED);
  const taken = new Set<string>();
  const id = randomId(rng, taken);
  const lists = shuffle([0, 1].map((k) => ({ id: randomId(rng, taken), changes: normalize([...STOCK_ROWS[k]!]), row: k + 1 })), rng);
  const items = shuffle(key.items.map((i) => ({ id: randomId(rng, taken), statement: i.statement, ref: i.id, kind: i.kind })), rng);
  return {
    packet: { id, prompt: "brief", items: items.map((i) => ({ id: i.id, statement: i.statement })), lists: lists.map((l) => ({ id: l.id, changes: l.changes })) },
    meta: { id, role: "generic", family: "plan", stage: 1, unit: key.unit, model: "opus", judges: ["astra", "opus"], lists: Object.fromEntries(lists.map((l) => [l.id, { kind: "stock", unit: key.unit, model: "opus", stock: l.row, words: words(l.changes) } as ListRef])), items: Object.fromEntries(items.map((i) => [i.id, { unit: key.unit, item: i.ref, kind: i.kind }])) },
  };
}

/** Section 3's primary: U and E items neither mentioned nor generic, ranked by outside users, a seeded tie-break, at most 6. */
export function primaryOf(key: Key): string[] {
  const eligible = key.items.filter((i) => (i.kind === "U" || i.kind === "E") && !i.mentioned && !i.generic).sort((a, b) => (a.id < b.id ? -1 : 1));
  const order = new Map(shuffle(eligible.map((i) => i.id), seededRandom(SEED)).map((id, k) => [id, k]));
  return [...eligible].sort((a, b) => b.outside_users - a.outside_users || order.get(a.id)! - order.get(b.id)!).slice(0, 6).map((i) => i.id);
}

/** Screens one key: returns the key with generic flags and primary updated, and the counts. */
export async function screenKey(key: Key, normalize: Normalize, call: Caller, logs: CallLog[]): Promise<{ key: Key; generic: number; unlabelled: number }> {
  const { packet, meta } = genericPacket(key, normalize);
  const records = await labelPacket(packet, meta, "medium", call, logs);
  const hit = new Set<string>();
  let unlabelled = 0;
  for (const r of records) {
    if (r.label === null) unlabelled++;
    else if (r.label.anticipated) hit.add(meta.items[r.item]!.item);
  }
  const items = key.items.map((i) => (hit.has(i.id) ? { ...i, generic: true } : i));
  const next: Key = { ...key, items };
  next.primary = primaryOf(next);
  return { key: next, generic: items.filter((i) => i.generic).length, unlabelled };
}

const USAGE = "gstack-evals pv generic --units <dir of unit dirs, each with key.json> --item " + GENERIC_ITEM + " [--ids a,b] [--run-id id] [--out <dir>] [--cache <dir>] [--record <dir>] [--ledger <path>]";

export async function run(argv: string[], io: Io, o: { fetch?: typeof fetch; env?: Record<string, string | undefined>; normalize?: Normalize } = {}): Promise<number> {
  const a = parseArgs(argv, { units: "one", item: "one", ids: "one", "run-id": "one", out: "one", cache: "one", record: "one", ledger: "one" }, USAGE);
  if (!a.one.units || !a.one.item) throw new PvError("E_USAGE", "missing --units or --item; usage: " + USAGE);
  if (a.one.item !== GENERIC_ITEM) throw new PvError("E_USAGE", "the generic screen spends only on line item " + GENERIC_ITEM + ", not " + a.one.item);
  const units = a.one.units;
  const out = a.one.out ?? join(units, ".pv-generic", "run");
  const cache = a.one.cache ?? join(units, ".pv-generic", "cache");
  const paths: Array<[string, string]> = [["--units", units], ["--out", out], ["--cache", cache]];
  for (const f of ["record", "ledger"]) if (a.one[f]) paths.push(["--" + f, a.one[f]!]);
  refuseAliases(paths);
  for (const [f, p] of paths.slice(0, 3)) refuseInRepo(f, p);
  if (!existsSync(units)) throw new PvError("E_USAGE", "units directory " + units + " does not exist");
  const wanted = a.one.ids ? new Set(a.one.ids.split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const ids = readdirSync(units).filter((d) => existsSync(join(units, d, "key.json")) && (!wanted || wanted.has(d))).sort();
  if (wanted) for (const w of wanted) if (!ids.includes(w)) throw new PvError("E_USAGE", "unit " + w + " has no key.json under " + units);
  if (!ids.length) throw new PvError("E_USAGE", "no unit directory with key.json under " + units);
  const normalize = o.normalize ?? (await loadNormalize());
  const judge = await openJudge({ item: GENERIC_ITEM, runId: a.one["run-id"] ?? "pv-generic", out, cacheDir: cache, record: a.one.record, ledger: a.one.ledger, env: o.env, fetch: o.fetch, io });
  const logs: CallLog[] = [];
  let dropped = 0;
  try {
    for (const id of ids) {
      const key = readJson<Key>(join(units, id, "key.json"), "key file");
      if (key.unit !== id) throw new PvError("E_USAGE", "key.json in " + id + " names unit " + JSON.stringify(key.unit));
      const s = await screenKey(key, normalize, judge.call, logs);
      writeJson(join(units, id, "key.json"), s.key);
      if (!s.key.primary.length) dropped++;
      io.out("unit " + id + ": generic " + s.generic + ", primary " + s.key.primary.length + (s.key.primary.length ? "" : ", dropped (no primary item left)") + (s.unlabelled ? ", unlabelled cells " + s.unlabelled : ""));
      if (s.unlabelled) io.err("E_PV_LABEL_MISSING unit " + id + ": " + s.unlabelled + " screen cells stayed unlabelled after the one resend; their items stay not generic");
    }
  } finally {
    await judge.close();
  }
  io.out("pv generic: screened " + ids.length + " units, " + dropped + " dropped, " + logs.length + " calls");
  return 0;
}
