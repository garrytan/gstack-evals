// Copyright (c) 2026 Garry Tan. MIT License.
// Label packets as prereg section 6 freezes them: tier-specific production packets, shuffled-key packets, check-pass mirrors and oracle lists.
// Copied from lanes/devex/score/packets.ts at 5ee7f764232b196a1d0cec5b144a287b792f9c94, with design items, the 2x
// decoy and wrong-way labels, 10x details and oracle lists in place of D's surfaces, contexts and anchors.
//
// A production packet holds one unit-pass: the unit's key items (every item no key step dropped, so the mentioned and
// generic strata read from the same packet), that model's normalized lists for the unit from every arm and the
// reference that ran the pass, the three stock rows and, on calibration units, the oracle list. Lists and items are
// shuffled with a seed and labelled only by random ids. The packets are tier-specific (R2-5): a base packet shows
// statements; a 2x packet shows statements and adds the decoy and each wrong-way fact as items; a 10x packet, read
// from the same 2x lists, shows each keyed detail and asks for the detail label. A shuffled-key packet labels the same
// session lists against a partner unit's primary items from a seeded derangement, same base app first (seed 20261114),
// at 10x with the partner's keyed details (PD-7).
import { fail } from "../errors.ts";
import { SEED, STOCK_ROWS } from "../frozen.ts";
import type { Key, KeyItem, ListSource, Model, Tier } from "../types.ts";
import { normalizeItem } from "./parse.ts";
import { derangeByGroup, randomId, rngFor, seededRandom, shuffle } from "./stats.ts";
import type { Built, ItemRef, ListRef, PacketFile, PacketItem, PacketMeta, PacketRole, PromptName, ReviewRow, ScoreUnit, Stage } from "./types.ts";

const byId = (a: KeyItem, b: KeyItem) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Every item no key step dropped, in key order (the ids' order, PD-12). */
export const keyItems = (key: Key): KeyItem[] => key.items.filter((i) => i.drop === null).sort(byId);
/** The primary items: kept, neither mentioned nor generic, in key order. */
export const primaryItems = (key: Key): KeyItem[] => keyItems(key).filter((i) => !i.mentioned && !i.generic);
/** Whether an item carries a keyed detail at a read tier: only at 10x, and only when M10 keyed it. */
export const keyedAt = (item: KeyItem, tier: Tier): boolean => tier === "10x" && item.detailKeyed;

export const wordCount = (changes: readonly string[]): number => changes.reduce((s, c) => s + c.split(/\s+/).filter(Boolean).length, 0);

const EXT = "ts|tsx|js|jsx|mjs|cjs|vue|svelte|astro|css|scss|sass|less|html|erb|md|json|py|rb|php|go";
const PATH = new RegExp("(?:^|[\\s(\"'])((?:[\\w@.\\-\\[\\]]+/)*[\\w@\\-\\[\\]]+\\.(?:" + EXT + "))(?=$|[\\s),.;:\"'])", "g");

/** The file an item's statement names (the last path-like token with a source extension), or null (BT). */
export function itemFile(statement: string): string | null {
  return [...statement.matchAll(PATH)].map((m) => m[1]!).at(-1) ?? null;
}

/** Component identifiers in a statement: PascalCase words of two or more parts and camelCase words (BT). */
export function componentIds(statement: string): string[] {
  const out = new Set<string>();
  for (const m of statement.matchAll(/\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b/g)) out.add(m[0]);
  for (const m of statement.matchAll(/\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/g)) out.add(m[0]);
  return [...out].sort();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The file read (plan section 11, BT): an item's file is named when a change names its path, its basename or a
 * component identifier from its statement, each as a whole token. An item whose statement names no file and no
 * identifier can't be named.
 */
export function fileNamed(item: KeyItem, changes: readonly string[]): boolean {
  const file = itemFile(item.statement);
  const needles = [...(file ? [file, file.split("/").at(-1)!] : []), ...componentIds(item.statement)];
  const text = changes.join("\n");
  return needles.some((n) => new RegExp("(?:^|[^\\w./-])" + escapeRe(n) + "(?![\\w/-])").test(text));
}

/**
 * The oracle list (plan section 11, BT): each primary item becomes one change, its statement; at the 10x read, an item
 * with a keyed detail adds "Specifically: " and its detail. The list is normalized like any list; at 10x the ids of
 * items whose change the cut shortened come back in cut, because such a change can no longer be known-good for the detail.
 */
export function oracleList(key: Key, tier: Tier): { changes: string[]; cut: string[] } {
  const items = primaryItems(key);
  const raw = items.map((i) => (keyedAt(i, tier) ? i.statement.trim() + " Specifically: " + i.detail.trim() : i.statement.trim()));
  const n = raw.map(normalizeItem);
  return { changes: n.map((x) => x.text), cut: items.filter((i, k) => keyedAt(i, tier) && n[k]!.cut).map((i) => i.id) };
}

/** The shuffled-key partners: a seeded derangement over a frozen pool, another unit on the same base app first (seed 20261114). */
export function derangePartners(pool: readonly ScoreUnit[]): Map<string, string> | null {
  const app = new Map(pool.map((u) => [u.unit.id, u.unit.baseApp]));
  return derangeByGroup([...app.keys()], (id) => app.get(id)!, seededRandom(SEED));
}

interface DraftItem {
  ref: ItemRef;
  item: Omit<PacketItem, "id">;
}
interface DraftList {
  ref: ListRef;
  changes: string[];
}
/** A packet before it is sealed with random ids. */
export interface Draft {
  role: PacketRole;
  prompt: PromptName;
  stage: Stage;
  tier: Tier;
  unit: string;
  listsUnit: string;
  model: Model;
  pass: number | null;
  smoke: boolean;
  items: DraftItem[];
  lists: DraftList[];
}

const keyDraftItems = (items: readonly KeyItem[], tier: Tier): DraftItem[] => items.map((i) => ({ ref: { role: "key", id: i.id }, item: { statement: i.statement, file: itemFile(i.statement), detail: keyedAt(i, tier) ? i.detail : null } }));

/** The items of a production packet: every kept key item, plus the decoy and the wrong-way facts on a 2x packet. */
function productionItems(key: Key, tier: Tier): DraftItem[] {
  const items = keyDraftItems(keyItems(key), tier);
  if (tier !== "2x") return items;
  if (key.decoy === null) fail("E_USAGE", "a 2x packet needs the 2x key's decoy, and this key has none");
  items.push({ ref: { role: "decoy" }, item: { statement: key.decoy!, file: null, detail: null } });
  key.wrongWay.forEach((w, k) => items.push({ ref: { role: "wrong-way", index: k + 1 }, item: { statement: w, file: null, detail: null } }));
  return items;
}

const stockLists = (unit: string): DraftList[] => STOCK_ROWS.map((r) => ({ ref: { source: ("stock-" + r.row) as ListSource, session: null, unit, words: wordCount(r.changes) }, changes: [...r.changes] }));

/** The seal's stream: one per packet identity, so a packet's order and ids don't depend on what else the build holds. */
const identity = (d: Draft) => [d.role, d.stage, d.tier, d.unit, d.listsUnit, d.model, d.pass ?? "-", d.smoke ? "smoke" : "main"].join("|");

/** Shuffles a draft's items and lists with its own seeded stream and gives each a random id unique within the build. */
export function seal(d: Draft, taken: Set<string>, salt = ""): { file: PacketFile; meta: PacketMeta } {
  const rng = rngFor("packet\n" + identity(d) + salt);
  const id = randomId(rng, taken);
  const items = shuffle(d.items, rng).map((x) => ({ pid: randomId(rng, taken), x }));
  const lists = shuffle(d.lists, rng).map((x) => ({ pid: randomId(rng, taken), x }));
  return {
    file: { id, prompt: d.prompt, tier: d.tier, items: items.map(({ pid, x }) => ({ id: pid, ...x.item })), lists: lists.map(({ pid, x }) => ({ id: pid, changes: x.changes })) },
    meta: { id, role: d.role, stage: d.stage, tier: d.tier, unit: d.unit, listsUnit: d.listsUnit, model: d.model, pass: d.pass, smoke: d.smoke, items: Object.fromEntries(items.map(({ pid, x }) => [pid, x.ref])), lists: Object.fromEntries(lists.map(({ pid, x }) => [pid, x.ref])) },
  };
}

export interface BuildInput {
  stage: Stage;
  /** The read tier. A 10x read takes the 2x units' lists and keys. */
  read: Tier;
  units: ReadonlyMap<string, ScoreUnit>;
  /** Final rows only (plan section 6: a packet waits for every cell in it). Rows without a list hold no list. */
  rows: readonly ReviewRow[];
  /** Calibration units: their packets carry the oracle list. */
  calibration: ReadonlySet<string>;
  /** Unit to the partner whose key its lists are also labelled against (derangePartners); omit for no shuffled packets. */
  partners?: ReadonlyMap<string, string> | null;
}

/** The unit-pass groups of a stage's rows that hold a list, in a fixed order. */
export function unitPasses(rows: readonly ReviewRow[], stage: Stage): { unit: string; model: Model; pass: number; smoke: boolean; rows: ReviewRow[] }[] {
  const groups = new Map<string, ReviewRow[]>();
  for (const r of rows) {
    if (r.stage !== stage || r.list === null) continue;
    const k = [r.unit, r.model, r.smoke ? "s" : "m", String(r.pass).padStart(3, "0")].join("|");
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.keys()].sort().map((k) => {
    const rs = groups.get(k)!.sort((a, b) => (a.session < b.session ? -1 : 1));
    return { unit: rs[0]!.unit, model: rs[0]!.model, pass: rs[0]!.pass, smoke: rs[0]!.smoke, rows: rs };
  });
}

const tierOfUnits = (read: Tier): Tier => (read === "10x" ? "2x" : read);

/** The drafts of one build: a production (or check-pass) packet per unit-pass, and its shuffled-key packet. */
export function drafts(inp: BuildInput, role: "production" | "check"): Draft[] {
  if (inp.partners && inp.stage === 1 && inp.read !== "base") fail("E_USAGE", "stage 1 runs shuffled-key packets on base-tier lists only (prereg section 6)");
  const out: Draft[] = [];
  for (const g of unitPasses(inp.rows, inp.stage)) {
    const u = inp.units.get(g.unit);
    if (!u) fail("E_USAGE", "rows name unit " + g.unit + ", which is not among the units");
    if (u!.unit.tier !== tierOfUnits(inp.read)) fail("E_USAGE", "unit " + g.unit + " is a " + u!.unit.tier + " version; the " + inp.read + " read takes " + tierOfUnits(inp.read) + " versions");
    const sessions: DraftList[] = g.rows.map((r) => ({ ref: { source: r.kind, session: r.session, unit: g.unit, words: wordCount(r.list!) }, changes: r.list! }));
    const lists = [...sessions, ...stockLists(g.unit)];
    if (inp.calibration.has(g.unit)) {
      const o = oracleList(u!.key, inp.read);
      lists.push({ ref: { source: "oracle", session: null, unit: g.unit, words: wordCount(o.changes), ...(inp.read === "10x" ? { cut: o.cut } : {}) }, changes: o.changes });
    }
    const base = { stage: inp.stage, tier: inp.read, model: g.model, pass: g.pass, smoke: g.smoke };
    out.push({ ...base, role, prompt: role === "check" ? "audit" : "brief", unit: g.unit, listsUnit: g.unit, items: productionItems(u!.key, inp.read), lists });
    const partner = role === "production" ? inp.partners?.get(g.unit) : undefined;
    if (partner) {
      const pu = inp.units.get(partner);
      if (!pu) fail("E_USAGE", "unit " + g.unit + "'s partner " + partner + " is not among the units");
      out.push({ ...base, role: "shuffled", prompt: "brief", unit: partner, listsUnit: g.unit, items: keyDraftItems(primaryItems(pu!.key), inp.read), lists: sessions });
    }
  }
  return out;
}

const sealAll = (ds: readonly Draft[]): Built => {
  const taken = new Set<string>();
  const sealed = ds.map((d) => seal(d, taken));
  return { packets: sealed.map((s) => s.file), metas: sealed.map((s) => s.meta) };
};

/** Production label packets (and shuffled-key packets) for one stage and read tier. */
export const buildLabelPackets = (inp: BuildInput): Built => sealAll(drafts(inp, "production"));
/** The judge check's separate pass: the same unit-passes with the audit prompt and fresh ids, for all three families. */
export const buildCheckPackets = (inp: BuildInput): Built => sealAll(drafts({ ...inp, partners: null }, "check"));

/** The text a judge reads after its prompt. */
export function renderPacket(p: PacketFile): string {
  const items = p.items.map((i) => "[" + i.id + "] " + i.statement + (i.file ? "\n    file: " + i.file : "") + (i.detail !== null ? "\n    detail: " + i.detail : "")).join("\n");
  const lists = p.lists.map((l) => "List " + l.id + "\n" + (l.changes.length ? l.changes.map((c, k) => k + 1 + ". " + c).join("\n") : "(no changes)")).join("\n\n");
  return "KEY ITEMS\n" + items + "\n\nCHANGE LISTS\n\n" + lists;
}
