// Copyright (c) 2026 Garry Tan. MIT License.
// dx packets (prereg 2026-11-09-geva-417, sections 7 and 8): the blind packets every judge reads and the sealed map from
// their random ids back to units, arms, passes and key items. A label packet holds one unit-pass: the unit's aliased key
// items and that model's normalized lists for the unit from every arm that ran the pass, plus the three frozen stock rows
// (and, in stage 1, the calibration unit's three anchor lists), shuffled with a seed and labelled only by random ids. Beside
// each sits a shuffled-key packet: the same arm lists against a seeded derangement of keys. The judge check's separate
// pass mirrors stage 1's packets with the audit prompt; the generic screen labels each key against stock rows 1 and 2;
// stage 2 inserts whole calibration packets blind into each production judge's queue. Packets hold text and random ids.
import { oracleChanges } from "../../aftermath/oracle.ts";
import { randomId, seededRandom, shuffle } from "../../aftermath/stats.ts";
import { SEED, type ArmId, type Key, type KeyItem, type ModelId, type Row, type Stage, type UnitMeta } from "../types.ts";

/** Section 8's three stock rows, frozen verbatim, judged in every label packet as if they were reviews. */
export const STOCK_ROWS: readonly (readonly string[])[] = [
  [
    "Add a quickstart with copy-paste install and first-run commands.",
    "Make every error message say what went wrong and how to fix it.",
    "Document every new option and command with an example.",
    "Add deprecation warnings and a migration guide for any breaking change.",
    "Give every command a --help with examples.",
    "Test installation on Linux, macOS and Windows.",
    "Validate configuration at startup with clear errors and sensible defaults.",
    "Add a troubleshooting section to the docs.",
  ],
  [
    "Write a short design doc and get it reviewed before coding.",
    "Add unit and integration tests for the new code.",
    "Run the tests and linters in CI on every pull request.",
    "Release it behind a feature flag first.",
    "Add telemetry to measure adoption and failures.",
    "Ask a few users for feedback before the release.",
    "Keep the change small and ship it in steps.",
    "Update the changelog and release notes.",
  ],
  [
    "Name the target developer, their context and how many minutes they will tolerate.",
    "Set a time-to-hello-world target under five minutes with a one-command install.",
    "Specify the magical moment and make sure the plan delivers it first.",
    "Make every error follow the agent-ready contract: what failed, the fix, a code, a docs link.",
    "Trace the journey: discover, install, hello world, real use, debug, upgrade.",
    "Add --json output and a non-interactive flag for agents and CI.",
    "Ship a migration guide and a codemod with every breaking change.",
    "Write copy-paste examples that run unmodified in CI.",
  ],
];

export type JudgeKey = "astra" | "opus" | "gemini";
export type PromptName = "brief" | "audit" | "paraphrase";
export type ListKind = "arm" | "stock" | "verbatim" | "paraphrased" | "near-miss";
export type Role = "production" | "shuffled" | "calibration" | "check" | "generic";
/** A production judge as the readings name it: one judge, or the particle-1 panel. */
export type Reader = "astra" | "opus" | "panel";

/** Section 7 (R78): Astra labels Opus lists, Opus labels Sol lists, particle-1 lists go to both with Argon on splits. */
export const PRODUCTION_JUDGES: Readonly<Record<ModelId, readonly JudgeKey[]>> = { opus: ["astra"], sol: ["opus"], particle: ["astra", "opus"] };
export const CHECK_JUDGES: readonly JudgeKey[] = ["astra", "opus"];
export const READER: Readonly<Record<ModelId, Reader>> = { opus: "astra", sol: "opus", particle: "panel" };

export interface ListRef {
  kind: ListKind;
  /** The unit the list was written for. */
  unit: string;
  model: ModelId | null;
  arm?: ArmId;
  pass?: number;
  smoke?: boolean;
  session?: string;
  stock?: number;
  words: number;
}
export interface PacketItem {
  id: string;
  statement: string;
  surface: string;
  context: string | null;
}
export interface PacketFile {
  id: string;
  prompt: PromptName;
  items: PacketItem[];
  lists: Array<{ id: string; changes: string[] }>;
}
/** A gold cell carried by a stage 2 calibration packet, for the blind re-check. */
export interface CarriedGold {
  list: string;
  item: string;
  gold: boolean;
  kind: ListKind;
}
export interface PacketMeta {
  id: string;
  role: Role;
  stage: Stage;
  /** The unit whose key items the packet shows. */
  unit: string;
  /** The unit whose lists the packet shows, when it differs (a shuffled-key packet). */
  lists_unit?: string;
  model: ModelId | null;
  pass: number | null;
  smoke: boolean;
  judges: readonly JudgeKey[];
  lists: Record<string, ListRef>;
  /** Packet item id to key item id. */
  items: Record<string, string>;
  gold?: CarriedGold[];
}
export interface PacketMap {
  version: 1;
  kind: "label" | "check" | "generic";
  stage: Stage;
  seed: number;
  packets: Record<string, PacketMeta>;
}
/** One judge's answer for one (list, item) cell; label is null when the cell stayed unlabelled (E_DX_LABEL_MISSING). */
export interface LabelRecord {
  packet: string;
  judge: JudgeKey | "panel";
  /** The model under test whose lists the packet holds; null for the generic screen. */
  subject: ModelId | null;
  model_id: string;
  version: string | null;
  effort: string;
  /** sha256 of model, version, prompt digest and packet digest. */
  cache_key: string;
  list: string;
  item: string;
  label: import("../types.ts").Label | null;
  quotes?: string[];
}

export interface Unit {
  meta: UnitMeta;
  key: Key;
}
export interface Anchors {
  verbatim: string[];
  paraphrased: string[] | null;
  near: string[];
}

export const words = (changes: readonly string[]): number => changes.reduce((s, c) => s + c.split(/\s+/).filter(Boolean).length, 0);
/** A list's identity across builds: the check pass and production packets name the same list with different ids. */
export const listKey = (r: ListRef): string => (r.kind === "arm" ? "arm:" + r.session : r.kind === "stock" ? "stock:" + r.unit + ":" + r.stock : r.kind + ":" + r.unit);
export const cellKey = (list: string, item: string): string => list + "|" + item;

/** The text a judge reads after its prompt. */
export function renderPacket(p: PacketFile): string {
  if (p.prompt === "paraphrase") return "CHANGES\n" + (p.lists[0]?.changes ?? []).map((c, i) => i + 1 + ". " + c).join("\n");
  const items = p.items.map((i) => "[" + i.id + "] " + i.statement + "\n    surface: " + i.surface + "; developer context: " + (i.context ?? "none")).join("\n");
  const lists = p.lists.map((l) => "List " + l.id + "\n" + l.changes.map((c, i) => i + 1 + ". " + c).join("\n")).join("\n\n");
  return "KEY ITEMS\n" + items + "\n\nCHANGE LISTS\n\n" + lists;
}

/** Section 7's verbatim oracle change: the item's surface and its statement (which records the trouble). */
export const oracleChange = (i: { surface: string; statement: string }): string => "Before launch, prevent this on " + i.surface.trim() + ": " + i.statement.trim();

/** One verbatim oracle list per calibration unit, written by script from its primary items. */
export const verbatimOracle = (key: Key): string[] => oracleChanges(key.items, key.primary, 8, oracleChange).changes;

/**
 * Near-miss lists: each primary item's surface paired with the trouble of a primary item from another calibration unit,
 * picked with the seed. The other item's statement has its own surface replaced by this item's surface where it names it.
 */
export function nearMissLists(keys: ReadonlyMap<string, Key>, rng: () => number): Map<string, string[]> {
  const all: Array<{ unit: string; item: KeyItem }> = [];
  for (const unit of [...keys.keys()].sort()) {
    const key = keys.get(unit)!;
    for (const id of key.primary) all.push({ unit, item: key.items.find((i) => i.id === id)! });
  }
  const out = new Map<string, string[]>();
  for (const unit of [...keys.keys()].sort()) {
    const others = all.filter((x) => x.unit !== unit);
    if (!others.length) continue;
    const key = keys.get(unit)!;
    out.set(
      unit,
      key.primary.map((id) => {
        const mine = key.items.find((i) => i.id === id)!;
        const other = others[Math.floor(rng() * others.length)]!.item;
        const trouble = other.surface && other.statement.includes(other.surface) ? other.statement.split(other.surface).join(mine.surface) : other.statement;
        return oracleChange({ surface: mine.surface, statement: trouble });
      }),
    );
  }
  return out;
}

/**
 * Section 7's shuffled-key control: a seeded derangement of keys over all audited units. Units take another unit's key from
 * the same repository where one exists, else the same developer-facing class and language, else the same class, else any.
 * Each level forms one random cycle per group of two or more; a last lone unit joins a cycle of its own class where it
 * can. Returns unit -> the unit whose key its lists are labelled against; null for fewer than two units.
 */
export function derangeKeys(metas: readonly UnitMeta[], rng: () => number): Map<string, string> | null {
  if (metas.length < 2) return null;
  const levels: Array<(m: UnitMeta) => string> = [(m) => "repo:" + m.repo_digest, (m) => "cl:" + m.dev_class + ":" + (m.language ?? "-"), (m) => "c:" + m.dev_class, () => "all"];
  const out = new Map<string, string>();
  let left = [...metas].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const level of levels) {
    const groups = new Map<string, UnitMeta[]>();
    for (const m of left) groups.set(level(m), [...(groups.get(level(m)) ?? []), m]);
    const next: UnitMeta[] = [];
    for (const g of [...groups.keys()].sort()) {
      const members = groups.get(g)!;
      if (members.length < 2) {
        next.push(...members);
        continue;
      }
      const order = shuffle(members.map((m) => m.id), rng);
      order.forEach((id, i) => out.set(id, order[(i + 1) % order.length]!));
    }
    left = next;
    if (left.length < 2) break;
  }
  if (left.length === 1) {
    const lone = left[0]!;
    const same = [...out.keys()].sort().filter((id) => metas.find((m) => m.id === id)!.dev_class === lone.dev_class);
    const hosts = same.length ? same : [...out.keys()].sort();
    const host = hosts[Math.floor(rng() * hosts.length)]!;
    out.set(lone.id, out.get(host)!);
    out.set(host, lone.id);
  }
  return out;
}

export interface Built {
  packets: PacketFile[];
  map: PacketMap;
}

interface Draft {
  role: Role;
  prompt: PromptName;
  unit: string;
  lists_unit?: string;
  model: ModelId | null;
  pass: number | null;
  smoke: boolean;
  judges: readonly JudgeKey[];
  items: KeyItem[];
  lists: Array<{ ref: ListRef; changes: string[] }>;
}

/** Shuffles a draft's lists and items with the seed and gives each a random id unique within the build. */
function seal(d: Draft, rng: () => number, taken: Set<string>, stage: Stage): { file: PacketFile; meta: PacketMeta } {
  const id = randomId(rng, taken);
  const items = shuffle(d.items, rng).map((it) => ({ pid: randomId(rng, taken), it }));
  const lists = shuffle(d.lists, rng).map((l) => ({ pid: randomId(rng, taken), l }));
  return {
    file: { id, prompt: d.prompt, items: items.map(({ pid, it }) => ({ id: pid, statement: it.statement, surface: it.surface, context: it.context })), lists: lists.map(({ pid, l }) => ({ id: pid, changes: l.changes })) },
    meta: { id, role: d.role, stage, unit: d.unit, ...(d.lists_unit ? { lists_unit: d.lists_unit } : {}), model: d.model, pass: d.pass, smoke: d.smoke, judges: d.judges, lists: Object.fromEntries(lists.map(({ pid, l }) => [pid, l.ref])), items: Object.fromEntries(items.map(({ pid, it }) => [pid, it.id])) },
  };
}

const stockLists = (unit: string, model: ModelId | null, rows: readonly number[]) => rows.map((r) => ({ ref: { kind: "stock" as const, unit, model, stock: r, words: words(STOCK_ROWS[r - 1]!) }, changes: [...STOCK_ROWS[r - 1]!] }));

function anchorLists(unit: string, model: ModelId | null, a: Anchors | undefined) {
  if (!a) return [];
  const out: Array<{ ref: ListRef; changes: string[] }> = [{ ref: { kind: "verbatim", unit, model, words: words(a.verbatim) }, changes: a.verbatim }];
  if (a.paraphrased) out.push({ ref: { kind: "paraphrased", unit, model, words: words(a.paraphrased) }, changes: a.paraphrased });
  out.push({ ref: { kind: "near-miss", unit, model, words: words(a.near) }, changes: a.near });
  return out;
}

export interface BuildInput {
  stage: Stage;
  units: ReadonlyMap<string, Unit>;
  rows: readonly Row[];
  /** Stage 1: each calibration unit's anchor lists. */
  anchors?: ReadonlyMap<string, Anchors>;
  /** The shuffled-key derangement; derangeKeys over every audited unit. */
  shuffled?: ReadonlyMap<string, string> | null;
  seed?: number;
}

/** The unit-pass groups of a stage's block rows, in a fixed order. */
export function unitPasses(rows: readonly Row[], stage: Stage): Array<{ unit: string; model: ModelId; pass: number; smoke: boolean; rows: Row[] }> {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.stage !== stage || r.end !== "block" || !r.list) continue;
    const k = [r.unit, r.model, r.smoke ? "s" : "m", String(r.pass).padStart(3, "0")].join("|");
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.keys()].sort().map((k) => {
    const rs = groups.get(k)!.sort((a, b) => (a.session < b.session ? -1 : 1));
    return { unit: rs[0]!.unit, model: rs[0]!.model, pass: rs[0]!.pass, smoke: rs[0]!.smoke, rows: rs };
  });
}

function drafts(inp: BuildInput, role: "production" | "check"): Draft[] {
  const out: Draft[] = [];
  for (const g of unitPasses(inp.rows, inp.stage)) {
    const u = inp.units.get(g.unit);
    if (!u) throw new Error("rows name unit " + g.unit + ", which is not among the units");
    const judges = role === "check" || inp.stage === 1 ? CHECK_JUDGES : PRODUCTION_JUDGES[g.model];
    const arm = g.rows.map((r) => ({ ref: { kind: "arm" as const, unit: g.unit, model: g.model, arm: r.arm, pass: r.pass, smoke: r.smoke, session: r.session, words: words(r.list!) }, changes: r.list! }));
    out.push({ role, prompt: role === "check" ? "audit" : "brief", unit: g.unit, model: g.model, pass: g.pass, smoke: g.smoke, judges, items: u.key.items, lists: [...arm, ...stockLists(g.unit, g.model, [1, 2, 3]), ...(inp.stage === 1 ? anchorLists(g.unit, g.model, inp.anchors?.get(g.unit)) : [])] });
    const other = role === "production" ? inp.shuffled?.get(g.unit) : undefined;
    if (other) {
      const ok = inp.units.get(other)!.key;
      out.push({ role: "shuffled", prompt: "brief", unit: other, lists_unit: g.unit, model: g.model, pass: g.pass, smoke: g.smoke, judges: PRODUCTION_JUDGES[g.model], items: ok.items.filter((i) => ok.primary.includes(i.id)), lists: arm });
    }
  }
  return out;
}

function build(inp: BuildInput, kind: "label" | "check", ds: Draft[], salt: number): Built {
  const seed = (inp.seed ?? SEED) + salt;
  const rng = seededRandom(seed);
  const taken = new Set<string>();
  const sealed = ds.map((d) => seal(d, rng, taken, inp.stage));
  return { packets: sealed.map((s) => s.file), map: { version: 1, kind, stage: inp.stage, seed, packets: Object.fromEntries(sealed.map((s) => [s.meta.id, s.meta])) } };
}

/** Production label packets for a stage (stage 1: every model's lists go to Astra and Opus, so each judge reads them all). */
export const buildLabelPackets = (inp: BuildInput): Built => build(inp, "label", drafts(inp, "production"), 0);
/** The judge check's separate pass: stage 1's packets mirrored with the audit prompt, for Astra and Opus at maximum effort. */
export const buildCheckPackets = (inp: BuildInput): Built => build({ ...inp, stage: 1 }, "check", drafts({ ...inp, stage: 1 }, "check"), 1);

/** The generic screen (section 3): each key's items against stock rows 1 and 2 only, for Astra and Opus. */
export function buildGenericPackets(keys: ReadonlyMap<string, Key>, seed = SEED): Built {
  const ds: Draft[] = [...keys.keys()].sort().map((unit) => ({ role: "generic", prompt: "brief", unit, model: null, pass: null, smoke: false, judges: CHECK_JUDGES, items: keys.get(unit)!.items, lists: stockLists(unit, null, [1, 2]) }));
  return build({ stage: 1, units: new Map(), rows: [] }, "label", ds, 2);
}

/** The paraphrase packet Argon reads for one calibration unit's verbatim oracle list. */
export const paraphrasePacket = (unit: string, verbatim: readonly string[]): PacketFile => ({ id: "para-" + unit, prompt: "paraphrase", items: [], lists: [{ id: "v", changes: [...verbatim] }] });

/**
 * Stage 2's blind calibration packets for one production judge: candidate calibration unit-passes in seeded order, each
 * resealed with fresh random ids and its gold cells carried in the map, until the counted gold (counted applies the
 * oracle caps) reaches need; then seeded positions in a queue of queueLength packets. Short when the candidates run out.
 */
export function blindCalibration(o: {
  candidates: ReadonlyArray<{ draft: { unit: string; model: ModelId; pass: number; items: KeyItem[]; lists: Array<{ ref: ListRef; changes: string[] }> }; gold: ReadonlyArray<{ listKey: string; item: string; gold: boolean; kind: ListKind }> }>;
  judges: readonly JudgeKey[];
  queueLength: number;
  counted: (cells: ReadonlyArray<{ gold: boolean; kind: ListKind; list: string }>) => number;
  need?: number;
  seed?: number;
}): { packets: PacketFile[]; metas: PacketMeta[]; positions: number[]; gold: number; short: boolean } {
  const need = o.need ?? 40;
  const rng = seededRandom((o.seed ?? SEED) + 3);
  const taken = new Set<string>();
  const order = shuffle([...o.candidates.keys()], rng);
  const chosen: Array<{ file: PacketFile; meta: PacketMeta }> = [];
  const cells: Array<{ gold: boolean; kind: ListKind; list: string }> = [];
  for (const i of order) {
    if (o.counted(cells) >= need) break;
    const c = o.candidates[i]!;
    const s = seal({ role: "calibration", prompt: "brief", unit: c.draft.unit, model: c.draft.model, pass: c.draft.pass, smoke: false, judges: o.judges, items: c.draft.items, lists: c.draft.lists }, rng, taken, 2);
    const byKey = new Map(Object.entries(s.meta.lists).map(([pid, ref]) => [listKey(ref), pid]));
    const byItem = new Map(Object.entries(s.meta.items).map(([pid, kid]) => [kid, pid]));
    s.meta.gold = c.gold.filter((g) => byKey.has(g.listKey) && byItem.has(g.item)).map((g) => ({ list: byKey.get(g.listKey)!, item: byItem.get(g.item)!, gold: g.gold, kind: g.kind }));
    for (const g of s.meta.gold) cells.push({ gold: g.gold, kind: g.kind, list: s.meta.id + ":" + g.list });
    chosen.push(s);
  }
  const total = o.queueLength + chosen.length;
  const positions = shuffle([...Array(total).keys()], rng).slice(0, chosen.length).sort((a, b) => a - b);
  const gold = o.counted(cells);
  return { packets: chosen.map((c) => c.file), metas: chosen.map((c) => c.meta), positions, gold, short: gold < need };
}
