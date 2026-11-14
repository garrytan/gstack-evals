// Copyright (c) 2026 Garry Tan. MIT License.
// One unit's files and key as the author area holds them (prereg section 3, "Unit files"): reading an author,
// transform or translation reply, item ids at intake in a seeded per-unit order (PD-12 with R2-21's seed reduction),
// the 2x key's id inheritance (M2, K7), the digest every check result binds (K2) and the check log.
// seededShuffle follows shuffle in lanes/aftermath/stats.ts at 5ee7f764232b196a1d0cec5b144a287b792f9c94 (same Fisher-Yates on main's PRNG).
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import { ITEM_CLASSES, SEED } from "../frozen.ts";
import type { ItemClass, Key, KeyItem } from "../types.ts";
import { lastJsonObject, sha256 } from "./text.ts";

export interface EvidenceFile {
  path: string;
  text: string;
}

/** A unit version's files. context is null until the context writer has run. */
export interface UnitFiles {
  plan: string;
  context: string | null;
  evidence: EvidenceFile[];
  key: Key;
}

/** An item as a reply gives it, before intake assigns its id. */
export interface RawItem {
  class: string;
  statement: string;
  detail: string;
  evidence: { file: string; line: number }[];
}

export interface ParsedReply {
  plan: string | null;
  evidence: EvidenceFile[];
  items: RawItem[];
  /** The classes of the items the reply marks mentioned. */
  mentioned: ItemClass[];
  wrongWay: string[];
  decoy: string | null;
}

const isStr = (v: unknown): v is string => typeof v === "string";

function readItem(v: unknown): RawItem | string {
  if (!v || typeof v !== "object") return "an item is not an object";
  const o = v as Record<string, unknown>;
  if (!isStr(o.class) || !isStr(o.statement) || !isStr(o.detail)) return "an item lacks class, statement or detail as strings";
  if (!Array.isArray(o.evidence)) return "an item's evidence is not a list";
  const evidence: { file: string; line: number }[] = [];
  for (const e of o.evidence) {
    const p = e as Record<string, unknown>;
    if (!p || !isStr(p.file) || typeof p.line !== "number" || !Number.isInteger(p.line)) return "an evidence pointer is not {file, line}";
    evidence.push({ file: p.file, line: p.line });
  }
  return { class: o.class.trim().toUpperCase(), statement: o.statement, detail: o.detail, evidence };
}

/**
 * Reads a reply in the author prompt's format: one JSON object {plan, evidence: [{path, text}], key}. key is a list of
 * items or an object holding "items" with "mentioned", "wrong_way" and "decoy"; those three may also sit at the top
 * level. A mentioned entry names an item by its class letter or its exact statement (BT). needPlan is false for the 2x
 * transform, which outputs only the evidence files and the key. A string is the reason the reply doesn't parse.
 */
export function parseUnitReply(reply: string, o: { needPlan: boolean }): ParsedReply | string {
  const j = lastJsonObject(reply);
  if (!j) return "no JSON object";
  if (o.needPlan && !isStr(j.plan)) return "no plan string";
  if (!Array.isArray(j.evidence)) return "no evidence list";
  const evidence: EvidenceFile[] = [];
  for (const e of j.evidence) {
    const f = e as Record<string, unknown>;
    if (!f || !isStr(f.path) || !isStr(f.text)) return "an evidence file is not {path, text}";
    evidence.push({ path: f.path, text: f.text });
  }
  const key = j.key;
  const k = (Array.isArray(key) ? { items: key } : key) as Record<string, unknown> | undefined;
  if (!k || typeof k !== "object" || !Array.isArray(k.items)) return "no key items";
  const items: RawItem[] = [];
  for (const v of k.items) {
    const it = readItem(v);
    if (isStr(it)) return it;
    items.push(it);
  }
  const pick = (name: string): unknown => (k[name] !== undefined ? k[name] : j[name]);
  const mentionedRaw = pick("mentioned") ?? [];
  if (!Array.isArray(mentionedRaw)) return "mentioned is not a list";
  const mentioned: ItemClass[] = [];
  for (const m of mentionedRaw) {
    const name = isStr(m) ? m : m && typeof m === "object" && isStr((m as Record<string, unknown>).class) ? ((m as Record<string, unknown>).class as string) : null;
    if (name === null) return "a mentioned entry is not a class letter or a statement";
    const byClass = ITEM_CLASSES.find((c) => c === name.trim().toUpperCase());
    const byStatement = items.find((i) => i.statement === name);
    const cls = byClass ?? (byStatement ? (byStatement.class as ItemClass) : undefined);
    if (!cls || !ITEM_CLASSES.includes(cls)) return "mentioned entry " + JSON.stringify(name) + " names no item";
    if (!mentioned.includes(cls)) mentioned.push(cls);
  }
  const ww = pick("wrong_way") ?? [];
  if (!Array.isArray(ww) || !ww.every(isStr)) return "wrong_way is not a list of strings";
  const decoy = pick("decoy");
  if (decoy !== undefined && decoy !== null && !isStr(decoy)) return "decoy is not a string";
  return { plan: isStr(j.plan) ? j.plan : null, evidence, items, mentioned, wrongWay: ww as string[], decoy: isStr(decoy) ? decoy : null };
}

/** R2-21: the first 8 hex digits of sha256 of "20261114", a newline and the unit id, as an unsigned 32-bit integer. */
export const idSeed = (unitId: string): number => parseInt(sha256(String(SEED) + "\n" + unitId).slice(0, 8), 16) >>> 0;

/** Fisher-Yates on the repository's seeded PRNG (src/runner/stats/paired.ts), from the last place down. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const rng = seededRandom(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Fixed width, so plain string order is key order. */
export const itemId = (n: number): string => "i" + String(n).padStart(2, "0");

const classRank = (c: string): number => {
  const r = ITEM_CLASSES.indexOf(c as ItemClass);
  return r < 0 ? ITEM_CLASSES.length : r;
};

/**
 * PD-12: items get ids in a seeded per-unit order, never the author's array order. The items are first put in a
 * canonical order (class S, H, R, A, Y, then statement, detail and pointers), so the author's order can't reach the
 * shuffle; the shuffle's i-th item gets id i01, i02, ... and key.json lists items in id order from then on.
 */
export function intake(unitId: string, raw: readonly RawItem[], mentioned: readonly ItemClass[]): KeyItem[] {
  const canon = [...raw].sort((a, b) => classRank(a.class) - classRank(b.class) || cmp(a.class, b.class) || cmp(a.statement, b.statement) || cmp(a.detail, b.detail) || cmp(JSON.stringify(a.evidence), JSON.stringify(b.evidence)));
  return seededShuffle(canon, idSeed(unitId)).map((r, i) => ({
    id: itemId(i + 1),
    class: r.class as ItemClass,
    statement: r.statement,
    detail: r.detail,
    evidence: r.evidence.map((e) => ({ file: e.file, line: e.line })),
    drop: null,
    mentioned: mentioned.includes(r.class as ItemClass),
    generic: false,
    detailKeyed: false,
  }));
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A reply's unit files, ids assigned at intake. */
export function unitFromReply(unitId: string, p: ParsedReply): UnitFiles {
  return { plan: p.plan ?? "", context: null, evidence: p.evidence, key: { items: intake(unitId, p.items, p.mentioned), wrongWay: p.wrongWay, decoy: p.decoy } };
}

/**
 * M2 and K7: a 2x key inherits each base item's id by byte-identical statement match. Refused (a string) when the
 * items don't map one to one, or a matched item's class or detail changed, since statements and details stay byte for
 * byte. The base item's flags carry; the 2x evidence pointers replace the base ones.
 */
export function inheritIds(base: readonly KeyItem[], raw: readonly RawItem[]): KeyItem[] | string {
  if (raw.length !== base.length) return "the 2x key has " + raw.length + " items, the base key " + base.length;
  const out: KeyItem[] = [];
  const taken = new Set<string>();
  for (const r of raw) {
    const hits = base.filter((b) => b.statement === r.statement);
    if (hits.length !== 1) return "a 2x statement matches " + hits.length + " base statements byte for byte: " + JSON.stringify(r.statement.slice(0, 60));
    const b = hits[0]!;
    if (taken.has(b.id)) return "two 2x items map to base item " + b.id;
    if (b.class !== r.class || b.detail !== r.detail) return "base item " + b.id + "'s class or detail changed in the 2x key";
    taken.add(b.id);
    out.push({ ...b, evidence: r.evidence.map((e) => ({ file: e.file, line: e.line })) });
  }
  return out.sort((a, b) => cmp(a.id, b.id));
}

/**
 * K2: sha256 over plan.md, context/project.md, every evidence file (path and bytes, in path order) and key.json's item
 * wording (class, statement, detail, evidence pointers, in id order), the wrong-way facts and the decoy. Flags (drops,
 * mentioned, generic, detail keyed) are left out: item drops are flags in key.json and change no file.
 */
export function digestOf(u: UnitFiles): string {
  const evidence = [...u.evidence].sort((a, b) => cmp(a.path, b.path)).map((e) => [e.path, e.text]);
  const items = [...u.key.items].sort((a, b) => cmp(a.id, b.id)).map((i) => ({ id: i.id, class: i.class, statement: i.statement, detail: i.detail, evidence: i.evidence }));
  return sha256(JSON.stringify({ plan: u.plan, context: u.context, evidence, items, wrongWay: u.key.wrongWay, decoy: u.key.decoy }));
}

/** One check result, bound to the digest it read. */
export interface CheckEntry {
  step: string;
  digest: string;
  ok: boolean;
  detail: string;
  /** True once a rewrite replaced the files this result read. */
  void: boolean;
  /** True for a first audit's result after the fix round: its drop and mentioned flags carry to the fixed version (K2). */
  carried: boolean;
}

/** K2: the results that stand for the current files: same digest, or a first audit carried across the fix round. */
export const standing = (log: readonly CheckEntry[], digest: string): CheckEntry[] => log.filter((e) => !e.void && (e.digest === digest || e.carried));

/** The items still in the key: not dropped. */
export const live = (k: Key): KeyItem[] => k.items.filter((i) => i.drop === null);
/** The step 5 and 6 candidates: not dropped, not mentioned, not generic (PD-3, M9). */
export const candidates = (k: Key): KeyItem[] => k.items.filter((i) => i.drop === null && !i.mentioned && !i.generic);

export const cloneFiles = (u: UnitFiles): UnitFiles => structuredClone(u);

/** key.json as written to the sealed store. */
export const keyJson = (k: Key): string => JSON.stringify(k, null, 2) + "\n";
