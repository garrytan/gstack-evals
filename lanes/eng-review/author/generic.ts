// Copyright (c) 2026 Garry Tan. MIT License.
// er generic (prereg 2026-11-08-geva-405, section 3, "Generic screen"): Astra and Opus each label every key item of a
// unit against stock rows 1 and 2 only, as if the rows were reviews, with the production brief, the same packet
// rendering and the same judge client. It reads no arm output, and row 3 never screens. An item either judge marks
// anticipated by either row becomes generic. The command writes the generic flags into key.json, recomputes the primary
// list by section 3's rule and prints counts only, never key text. A unit with no primary item left drops (counted).
// Build-time choices: own-test items are not screened (they never enter the primary); a cell still missing after the
// one whole-packet resend leaves its item not generic and is counted as unlabelled; the primary ranks B items (defect
// reverts, then fixes linked to an issue a user opened, then other fixes), then C, then T, and breaks ties inside each
// rank by the sha256 of the seed, the unit id and the item id, so one item's place never depends on another's text.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Io } from "../cli.ts";
import { parseArgs, PvError, readJson, refuseAliases, refuseInRepo, writeJson } from "../../product-value/io.ts";
import { randomId, SEED, seededRandom, shuffle } from "../../product-value/stats.ts";
import { labelPacket, openErJudge, type CallLog, type Caller } from "../judge.ts";
import { itemStatement, sha256, type ListRef, type PacketFile, type PacketMeta } from "../packets.ts";
import { words } from "../parse.ts";
import { SCREEN_ROWS, stockRow } from "../stock.ts";
import type { Key, KeyItem } from "../types.ts";

/** One unit's screen packet: every B, T and C item against stock rows 1 and 2; ids and order seeded so reruns hit the cache. */
export function genericPacket(key: Key): { packet: PacketFile; meta: PacketMeta } {
  const rng = seededRandom(SEED);
  const taken = new Set<string>();
  const id = randomId(rng, taken);
  const lists = shuffle(SCREEN_ROWS.map((k) => ({ id: randomId(rng, taken), checks: stockRow(k), row: k })), rng);
  const items = shuffle(key.items.map((i) => ({ id: randomId(rng, taken), statement: itemStatement(i), ref: i.id, kind: i.kind })), rng);
  return {
    packet: { id, prompt: "brief", items: items.map((i) => ({ id: i.id, statement: i.statement })), lists: lists.map((l) => ({ id: l.id, checks: l.checks })) },
    meta: { id, role: "generic", stage: 1, unit: key.unit, model: "opus", pass: 1, judges: ["astra", "opus"], lists: Object.fromEntries(lists.map((l) => [l.id, { kind: "stock", unit: key.unit, model: "opus", pass: 1, stock: l.row, words: l.checks.reduce((s, c) => s + words(c), 0) } as ListRef])), items: Object.fromEntries(items.map((i) => [i.id, { unit: key.unit, item: i.ref, kind: i.kind }])) },
  };
}

const KIND_RANK: Record<KeyItem["kind"], number> = { B: 0, C: 1, T: 2 };
const SOURCE_RANK = { revert: 0, "user-issue": 1, fix: 2 } as const;

/** Section 3's primary: B, T and C items neither mentioned nor generic, B first by source, then C, then T, seeded ties, at most 6. */
export function primaryOf(key: Key, seed = SEED): string[] {
  const rank = (i: KeyItem) => KIND_RANK[i.kind] * 10 + (i.kind === "B" ? SOURCE_RANK[i.b_source ?? "fix"] : 0);
  const tie = (i: KeyItem) => sha256(seed + "\n" + key.unit + "\n" + i.id);
  return key.items.filter((i) => !i.mentioned && !i.generic && i.kind in KIND_RANK).sort((a, b) => rank(a) - rank(b) || (tie(a) < tie(b) ? -1 : 1)).slice(0, 6).map((i) => i.id);
}

/** Screens one key: returns the key with generic flags and primary updated, and the counts. */
export async function screenKey(key: Key, call: Caller, logs: CallLog[]): Promise<{ key: Key; generic: number; unlabelled: number }> {
  const { packet, meta } = genericPacket(key);
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

const USAGE = "gstack-evals er generic --units <dir of unit dirs, each with key.json> --item <ledger item> --out <dir> --cache <dir> [--ids a,b] [--run-id id] [--record <dir>] [--ledger <path>]";

export async function run(argv: string[], io: Io, o: { fetch?: typeof fetch; env?: Record<string, string | undefined> } = {}): Promise<number> {
  const a = parseArgs(argv, { units: "one", item: "one", ids: "one", "run-id": "one", out: "one", cache: "one", record: "one", ledger: "one" }, USAGE);
  for (const f of ["units", "item", "out", "cache"]) if (!a.one[f]) throw new PvError("E_USAGE", "missing --" + f + "; usage: " + USAGE);
  const units = a.one.units!;
  const paths: Array<[string, string]> = [["--units", units], ["--out", a.one.out!], ["--cache", a.one.cache!]];
  for (const f of ["record", "ledger"]) if (a.one[f]) paths.push(["--" + f, a.one[f]!]);
  refuseAliases(paths);
  for (const [f, p] of paths.slice(0, 3)) refuseInRepo(f, p);
  if (!existsSync(units)) throw new PvError("E_USAGE", "units directory " + units + " does not exist");
  const wanted = a.one.ids ? new Set(a.one.ids.split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const ids = readdirSync(units).filter((d) => existsSync(join(units, d, "key.json")) && (!wanted || wanted.has(d))).sort();
  if (wanted) for (const w of wanted) if (!ids.includes(w)) throw new PvError("E_USAGE", "unit " + w + " has no key.json under " + units);
  if (!ids.length) throw new PvError("E_USAGE", "no unit directory with key.json under " + units);
  const judge = await openErJudge({ item: a.one.item!, runId: a.one["run-id"] ?? "er-generic", out: a.one.out!, cacheDir: a.one.cache!, record: a.one.record, ledger: a.one.ledger, env: o.env, fetch: o.fetch, io });
  const logs: CallLog[] = [];
  let dropped = 0;
  try {
    for (const id of ids) {
      const key = readJson<Key>(join(units, id, "key.json"), "key file");
      if (key.unit !== id) throw new PvError("E_USAGE", "key.json in " + id + " names unit " + JSON.stringify(key.unit));
      const s = await screenKey(key, judge.call, logs);
      writeJson(join(units, id, "key.json"), s.key);
      if (!s.key.primary.length) dropped++;
      io.out("unit " + id + ": generic " + s.generic + ", primary " + s.key.primary.length + (s.key.primary.length ? "" : ", dropped (no primary item left)") + (s.unlabelled ? ", unlabelled cells " + s.unlabelled : ""));
      if (s.unlabelled) io.err("E_ER_LABEL_MISSING unit " + id + ": " + s.unlabelled + " screen cells stayed unlabelled after the one resend; their items stay not generic");
    }
  } finally {
    await judge.close();
  }
  io.out("er generic: screened " + ids.length + " units, " + dropped + " dropped, " + logs.length + " calls");
  return 0;
}
