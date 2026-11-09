// Copyright (c) 2026 Garry Tan. MIT License.
// pv packets (prereg 2026-11-08-geva-403, sections 7 and 8): the blind packets every judge reads, and the sealed map
// from their random ids back to units, arms, passes and key items. Packets hold text and random ids only: key items as
// statements, change lists as numbered changes. The map, the keys and the gold answers stay in files outside the
// packets directory, and every output path sits outside the repository.
//   label     one packet per (unit, model) with that model's lists for the unit across arms and passes, the three
//             frozen stock rows and, in stage 1, the unit's oracle list; one shuffled-key packet beside each; in
//             stage 2 also gold packets, 40 gold cells per production judge, drawn under the oracle half cap, and a
//             plain rendering of a fixed seeded subset of 40 gold cells per family.
//   check     the judge check's separate pass: packets that mirror stage 1's label packets, for Astra and Opus.
//   pairwise  pass 1 of each unit: the skill's list against none's and against the lens's, in random order.
//   probe     the arm-guess probe: 30 seeded lists, one a packet, for Astra.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Io } from "./cli.ts";
import { loadNormalize, loadUnits, need, parseArgs, PvError, readJson, readRecords, readRows, realOf, refuseAliases, refuseInRepo, writeJson, type LoadedUnit, type Normalize } from "./io.ts";
import type { OracleFile } from "./oracle.ts";
import { derangeByGroup, randomId, seededRandom, SEED, shuffle } from "./stats.ts";
import type { ArmId, Family, ItemKind, Label, ModelId, Row } from "./types.ts";

export type JudgeKey = "astra" | "opus" | "gemini";
export type Role = "production" | "shuffled" | "gold" | "check" | "pairwise" | "probe" | "generic";
export type PromptName = "brief" | "audit" | "pairwise" | "probe";

/** Section 8's three stock rows, verbatim, judged in every label packet as if they were reviews. */
export const STOCK_ROWS: readonly (readonly string[])[] = [
  [
    "Add clear documentation, examples and a quick-start guide for the most common use cases.",
    "Support configuration through a config file and environment variables, not only flags.",
    "Make it work well on Windows, in containers and in CI environments.",
    "Improve error messages so users can tell what went wrong and how to fix it.",
    "Provide a migration path and deprecation warnings so existing users are not broken.",
  ],
  [
    "Ship a minimal first version behind an opt-in flag, gather feedback, then expand.",
    "Expose an API or plugin hook so other tools can build on this.",
    "Add integrations with the most popular tools in this ecosystem.",
    "Add a dry-run or preview mode so users can see the effect before applying it.",
    "Collect usage data or feedback to learn how people actually use it.",
  ],
  [
    "Describe the 12-month ideal and build toward the best version of this feature, not the minimal one.",
    "Add five small delight features next to the core flow.",
    "Put the new behavior behind a feature flag, with a rollback plan and a post-deploy checklist.",
    "Add logs, metrics and alerts for every new code path.",
    "Plan phases 2 and 3 so this becomes a platform other features build on.",
  ],
];

/** Section 7 (R78): Astra labels Claude lists, Opus labels GPT lists, particle-1 lists go to both, Gemini on splits. */
export const PRODUCTION_JUDGES: Readonly<Record<ModelId, readonly JudgeKey[]>> = { opus: ["astra"], sol: ["opus"], particle: ["astra", "opus"] };
export const CHECK_JUDGES: readonly JudgeKey[] = ["astra", "opus"];
export const MODELS_IN_ORDER: readonly ModelId[] = ["opus", "sol", "particle"];

export interface ListRef {
  kind: "arm" | "stock" | "oracle";
  /** The unit the list was written for. */
  unit: string;
  model: ModelId;
  arm?: ArmId;
  pass?: number;
  session?: string;
  stock?: number;
  words: number;
}
export interface ItemRef {
  unit: string;
  /** The key item's id, or c1 to c3 for the plan's commitments (brief family). */
  item: string;
  kind: ItemKind | "C";
}
export interface GoldCell {
  list: string;
  item: string;
  gold: boolean;
  oracle: boolean;
  real: boolean;
}
export interface PacketMeta {
  id: string;
  role: Role;
  family: Family;
  stage: 1 | 2;
  /** The unit whose key items the packet shows. */
  unit: string;
  /** The unit whose lists the packet shows, when it differs (a shuffled-key packet). */
  lists_unit?: string;
  model: ModelId;
  judges: readonly JudgeKey[];
  lists: Record<string, ListRef>;
  items: Record<string, ItemRef>;
  gold?: GoldCell[];
  pair?: { contrast: "skill-none" | "skill-lens" };
}
export interface PacketFile {
  id: string;
  prompt: PromptName;
  items: Array<{ id: string; statement: string }>;
  lists: Array<{ id: string; changes: string[] }>;
  input?: string;
}
export interface PacketMap {
  version: 1;
  kind: "label" | "check" | "pairwise" | "probe";
  family: Family;
  stage: 1 | 2;
  seed: number;
  packets: Record<string, PacketMeta>;
}
/** One judge's answer for one (list, item) cell; label is null when the cell stayed unlabelled (section 7). */
export interface LabelRecord {
  packet: string;
  judge: JudgeKey | "panel";
  model_id: string;
  version: string | null;
  effort: string | null;
  list: string;
  item: string;
  label: Label | null;
  quotes?: string[];
}

export const words = (changes: readonly string[]): number => changes.reduce((s, c) => s + c.split(/\s+/).filter(Boolean).length, 0);
/** A list's identity across builds: the check pass and production packets name the same list with different ids. */
export const listKey = (r: ListRef): string => r.kind + ":" + r.unit + ":" + r.model + ":" + (r.kind === "arm" ? r.session : r.kind === "stock" ? "row" + r.stock : "oracle");
export const itemKey = (r: ItemRef): string => r.unit + ":" + r.item;

/** The text a judge reads after its prompt. */
export function renderPacket(p: PacketFile): string {
  const lists = (title: (id: string) => string) => p.lists.map((l) => title(l.id) + "\n" + l.changes.map((c, i) => i + 1 + ". " + c).join("\n")).join("\n\n");
  if (p.prompt === "pairwise") return (p.input ?? "") + "\n\n" + lists((id) => "LIST " + id);
  if (p.prompt === "probe") return lists(() => "CHANGES");
  return "KEY ITEMS\n" + p.items.map((i) => "[" + i.id + "] " + i.statement).join("\n") + "\n\nCHANGE LISTS\n\n" + lists((id) => "List " + id);
}

interface Built {
  packets: PacketFile[];
  map: PacketMap;
  plain?: { text: string; answers: Array<{ cell: number; gold: boolean; unit: string; model: ModelId; list: string; item: string }> };
}

export interface BuildInput {
  family: Family;
  stage: 1 | 2;
  seed: number;
  units: Map<string, LoadedUnit>;
  rows: Row[];
  normalize: Normalize;
  oracle?: OracleFile;
  /** Stage 2 only: the judge check's packets, map and labels, which give the gold cells. */
  check?: { map: PacketMap; packets: Map<string, PacketFile>; labels: LabelRecord[] };
}

class Ids {
  readonly taken = new Set<string>();
  constructor(readonly rng: () => number) {}
  next(): string {
    return randomId(this.rng, this.taken);
  }
}

function familyRows(inp: BuildInput): Row[] {
  const rows = inp.rows.filter((r) => r.family === inp.family);
  for (const r of rows) if (!inp.units.has(r.unit)) throw new PvError("E_USAGE", "row " + r.session + " names unit " + r.unit + ", which is not under --units");
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.session)) throw new PvError("E_USAGE", "session " + r.session + " appears twice in the rows");
    seen.add(r.session);
  }
  return rows;
}

const keyItems = (inp: BuildInput, unit: string, commitments: boolean): Array<{ ref: ItemRef; statement: string }> => {
  const key = inp.units.get(unit)!.key!;
  const out = key.items.map((i) => ({ ref: { unit, item: i.id, kind: i.kind } as ItemRef, statement: i.statement }));
  if (commitments) key.commitments.forEach((c, i) => out.push({ ref: { unit, item: "c" + (i + 1), kind: "C" }, statement: c }));
  return out;
};

interface Draft {
  role: Role;
  unit: string;
  lists_unit?: string;
  model: ModelId;
  judges: readonly JudgeKey[];
  lists: Array<{ ref: ListRef; changes: string[] }>;
  items: Array<{ ref: ItemRef; statement: string }>;
  gold?: Array<{ listIndex: number; item: string; gold: boolean; oracle: boolean; real: boolean }>;
}

/** Shuffles a draft's lists and items, gives everything a random id and records the map entry. */
function seal(d: Draft, prompt: PromptName, inp: BuildInput, ids: Ids, built: Built): void {
  const id = ids.next();
  const lists = shuffle(d.lists.map((l, i) => ({ ...l, i, id: ids.next() })), ids.rng);
  const items = shuffle(d.items.map((it) => ({ ...it, id: ids.next() })), ids.rng);
  const byIndex = new Map(lists.map((l) => [l.i, l.id]));
  const byItem = new Map(items.map((it) => [itemKey(it.ref), it.id]));
  built.packets.push({ id, prompt, items: items.map((i) => ({ id: i.id, statement: i.statement })), lists: lists.map((l) => ({ id: l.id, changes: l.changes })) });
  built.map.packets[id] = {
    id,
    role: d.role,
    family: inp.family,
    stage: inp.stage,
    unit: d.unit,
    ...(d.lists_unit ? { lists_unit: d.lists_unit } : {}),
    model: d.model,
    judges: d.judges,
    lists: Object.fromEntries(lists.map((l) => [l.id, l.ref])),
    items: Object.fromEntries(items.map((i) => [i.id, i.ref])),
    ...(d.gold ? { gold: d.gold.map((g) => ({ list: byIndex.get(g.listIndex)!, item: byItem.get(g.item)!, gold: g.gold, oracle: g.oracle, real: g.real })) } : {}),
  };
}

const stockLists = (inp: BuildInput, unit: string, model: ModelId) =>
  STOCK_ROWS.map((row, k) => {
    const changes = inp.normalize([...row]);
    return { ref: { kind: "stock", unit, model, stock: k + 1, words: words(changes) } as ListRef, changes };
  });

/** The (unit, model) cells a stage holds, each with its arm lists in session order. */
function cells(inp: BuildInput): Array<{ unit: string; model: ModelId; lists: Array<{ ref: ListRef; changes: string[] }> }> {
  const rows = familyRows(inp);
  const out = [];
  for (const unit of [...new Set(rows.map((r) => r.unit))].sort())
    for (const model of MODELS_IN_ORDER) {
      const mine = rows.filter((r) => r.unit === unit && r.model === model).sort((a, b) => (a.session < b.session ? -1 : 1));
      if (!mine.length) continue;
      const lists = mine.filter((r) => r.end === "block").map((r) => ({ ref: { kind: "arm", unit, model, arm: r.arm, pass: r.pass, session: r.session, words: words(r.list!) } as ListRef, changes: r.list! }));
      out.push({ unit, model, lists });
    }
  return out;
}

function oracleFor(inp: BuildInput, unit: string, model: ModelId): Array<{ ref: ListRef; changes: string[] }> {
  if (inp.stage !== 1 || inp.units.get(unit)!.meta.set !== "calibration") return [];
  const o = inp.oracle?.units[unit];
  if (!o) throw new PvError("E_USAGE", "calibration unit " + unit + " has no oracle list; run pv oracle and pass --oracle");
  const changes = inp.normalize([...o.changes]);
  return [{ ref: { kind: "oracle", unit, model, words: words(changes) }, changes }];
}

const emptyMap = (inp: BuildInput, kind: PacketMap["kind"]): Built => ({ packets: [], map: { version: 1, kind, family: inp.family, stage: inp.stage, seed: inp.seed, packets: {} } });

/** Production label packets, a shuffled-key packet beside each, and in stage 2 the gold packets and plain rendering. */
export function buildLabelPackets(inp: BuildInput): Built {
  const ids = new Ids(seededRandom(inp.seed));
  const built = emptyMap(inp, "label");
  const all = cells(inp);
  const units = [...new Set(all.map((c) => c.unit))];
  const sigma = derangeByGroup(units, (u) => inp.units.get(u)!.meta.type, ids.rng);
  if (!sigma) throw new PvError("E_USAGE", "the shuffled-key control needs at least two units; the rows hold " + units.length);
  for (const c of all) {
    const items = keyItems(inp, c.unit, inp.family === "brief");
    seal({ role: "production", unit: c.unit, model: c.model, judges: PRODUCTION_JUDGES[c.model], lists: [...c.lists, ...stockLists(inp, c.unit, c.model), ...oracleFor(inp, c.unit, c.model)], items }, "brief", inp, ids, built);
    if (!c.lists.length) continue;
    const other = sigma.get(c.unit)!;
    seal({ role: "shuffled", unit: other, lists_unit: c.unit, model: c.model, judges: PRODUCTION_JUDGES[c.model], lists: [...c.lists, ...stockLists(inp, c.unit, c.model)], items: keyItems(inp, other, false) }, "brief", inp, ids, built);
  }
  if (inp.stage === 2) {
    if (!inp.check) throw new PvError("E_USAGE", "stage 2 label packets carry gold cells; pass the judge check's --check-map, --check-packets and --check-labels");
    addGold(inp, ids, built);
  }
  return shuffleOrder(built, ids.rng);
}

function shuffleOrder(b: Built, rng: () => number): Built {
  return { ...b, packets: shuffle(b.packets, rng) };
}

/** The judge check's separate pass: packets that mirror stage 1's label packets, labelled by Astra and Opus. */
export function buildCheckPackets(inp: BuildInput): Built {
  if (inp.stage !== 1) throw new PvError("E_USAGE", "the judge check draws from stage 1 (section 7); pass --stage 1");
  const ids = new Ids(seededRandom(inp.seed + 1));
  const built = emptyMap(inp, "check");
  const all = cells(inp);
  for (const c of all) seal({ role: "check", unit: c.unit, model: c.model, judges: CHECK_JUDGES, lists: [...c.lists, ...stockLists(inp, c.unit, c.model), ...oracleFor(inp, c.unit, c.model)], items: keyItems(inp, c.unit, false) }, "audit", inp, ids, built);
  const real = all.reduce((s, c) => s + c.lists.length, 0);
  if (real < 48) throw new PvError("E_USAGE", "the judge check set holds " + real + " change lists for the " + inp.family + " family; section 7 needs at least 48 across the three models");
  return shuffleOrder(built, ids.rng);
}

export interface GoldRef {
  packet: string;
  list: string;
  item: string;
  gold: boolean;
  ref: ListRef;
  itemRef: ItemRef;
  model: ModelId;
  unit: string;
}

/** Section 7: gold labels are the check-pass cells where Astra and Opus agree. */
export function goldCells(map: PacketMap, labels: readonly LabelRecord[]): GoldRef[] {
  const votes = new Map<string, Partial<Record<JudgeKey, boolean>>>();
  for (const l of labels) {
    if (!map.packets[l.packet] || l.label === null || (l.judge !== "astra" && l.judge !== "opus")) continue;
    const k = l.packet + "|" + l.list + "|" + l.item;
    votes.set(k, { ...(votes.get(k) ?? {}), [l.judge]: l.label.anticipated });
  }
  const out: GoldRef[] = [];
  for (const [id, p] of Object.entries(map.packets).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (p.role !== "check") continue;
    for (const list of Object.keys(p.lists).sort())
      for (const item of Object.keys(p.items).sort()) {
        const v = votes.get(id + "|" + list + "|" + item);
        if (v?.astra === undefined || v.opus === undefined || v.astra !== v.opus) continue;
        out.push({ packet: id, list, item, gold: v.astra, ref: p.lists[list]!, itemRef: p.items[item]!, model: p.model, unit: p.unit });
      }
  }
  return out;
}

/**
 * Draws a production judge's stage 2 gold cells: 20 anticipated, with oracle cells never more than the real ones (the
 * half cap), then not-anticipated cells up to 40 in all. Seeded; returns fewer when the gold set runs short.
 */
export function drawGold(cells: readonly GoldRef[], rng: () => number, total = 40): GoldRef[] {
  const half = Math.floor(total / 2);
  const ant = shuffle(cells.filter((c) => c.gold && c.ref.kind !== "oracle"), rng);
  const orc = shuffle(cells.filter((c) => c.gold && c.ref.kind === "oracle"), rng);
  const not = shuffle(cells.filter((c) => !c.gold), rng);
  const real = ant.slice(0, half);
  const oracle = orc.slice(0, Math.min(half - real.length, real.length));
  return [...real, ...oracle, ...not.slice(0, total - real.length - oracle.length)];
}

function addGold(inp: BuildInput, ids: Ids, built: Built): void {
  const { map, packets, labels } = inp.check!;
  if (map.kind !== "check" || map.family !== inp.family) throw new PvError("E_USAGE", "--check-map is not the " + inp.family + " family's judge check map");
  const gold = goldCells(map, labels);
  const rng = seededRandom(inp.seed + 2);
  for (const model of MODELS_IN_ORDER) {
    const drawn = drawGold(gold.filter((g) => g.model === model), rng);
    const bySource = new Map<string, GoldRef[]>();
    for (const g of drawn) bySource.set(g.packet, [...(bySource.get(g.packet) ?? []), g]);
    for (const [src, gs] of [...bySource.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const file = packets.get(src);
      if (!file) throw new PvError("E_USAGE", "the judge check's packet " + src + " is not under --check-packets");
      const meta = map.packets[src]!;
      const text = new Map(file.lists.map((l) => [l.id, l.changes]));
      const listIds = [...new Set(gs.map((g) => g.list))];
      const lists = listIds.map((l) => ({ ref: meta.lists[l]!, changes: text.get(l)! }));
      for (const k of [1, 2, 3]) if (!lists.some((l) => l.ref.kind === "stock" && l.ref.stock === k)) {
        const sid = Object.keys(meta.lists).find((l) => meta.lists[l]!.kind === "stock" && meta.lists[l]!.stock === k)!;
        lists.push({ ref: meta.lists[sid]!, changes: text.get(sid)! });
      }
      const items = file.items.map((i) => ({ ref: meta.items[i.id]!, statement: i.statement }));
      const goldDraft = gs.map((g) => ({ listIndex: listIds.indexOf(g.list), item: itemKey(g.itemRef), gold: g.gold, oracle: g.ref.kind === "oracle", real: g.ref.kind === "arm" }));
      seal({ role: "gold", unit: meta.unit, model, judges: PRODUCTION_JUDGES[model], lists, items, gold: goldDraft }, "brief", inp, ids, built);
    }
  }
  const plainRng = seededRandom(inp.seed + 3);
  const subset = shuffle(gold, plainRng).slice(0, 40);
  const text: string[] = ["# Gold cells, plain rendering (" + inp.family + " family)", "", "For each cell: does the list anticipate the item? Answer yes or no per cell. The rule is section 7's anticipation rule.", ""];
  const answers: NonNullable<Built["plain"]>["answers"] = [];
  subset.forEach((g, i) => {
    const file = packets.get(g.packet)!;
    text.push("## Cell " + (i + 1), "", "Item: " + file.items.find((x) => x.id === g.item)!.statement, "", "List:", ...file.lists.find((x) => x.id === g.list)!.changes.map((c, k) => k + 1 + ". " + c), "");
    answers.push({ cell: i + 1, gold: g.gold, unit: g.unit, model: g.model, list: listKey(g.ref), item: itemKey(g.itemRef) });
  });
  built.plain = { text: text.join("\n"), answers };
}

function unitInput(u: LoadedUnit, family: Family): string {
  const input = join(u.dir, family === "plan" ? "plan.md" : "brief.md");
  if (!existsSync(input)) throw new PvError("E_USAGE", "unit " + u.meta.id + " has no " + (family === "plan" ? "plan.md" : "brief.md"));
  const ctx = join(u.dir, "context");
  const files = existsSync(ctx) ? readdirSync(ctx).sort() : [];
  return (family === "plan" ? "PLAN\n" : "BRIEF\n") + readFileSync(input, "utf8").trim() + "\n\nCONTEXT\n" + files.map((f) => "--- " + f + "\n" + readFileSync(join(ctx, f), "utf8").trim()).join("\n\n");
}

/** Pairwise packets for pass 1: the skill's list against none's and against the lens's, order random per pair. */
export function buildPairwisePackets(inp: BuildInput): Built {
  const rng = seededRandom(inp.seed + 4);
  const taken = new Set<string>();
  const built = emptyMap(inp, "pairwise");
  const rows = familyRows(inp).filter((r) => r.pass === 1 && r.end === "block");
  for (const unit of [...new Set(rows.map((r) => r.unit))].sort())
    for (const model of MODELS_IN_ORDER) {
      const arm = (a: ArmId) => rows.find((r) => r.unit === unit && r.model === model && r.arm === a);
      const skill = arm("skill");
      if (!skill) continue;
      for (const [other, contrast] of [[arm("none"), "skill-none"], [arm("lens"), "skill-lens"]] as const) {
        if (!other) continue;
        const pair = rng() < 0.5 ? [skill, other] : [other, skill];
        const id = randomId(rng, taken);
        built.packets.push({ id, prompt: "pairwise", items: [], input: unitInput(inp.units.get(unit)!, inp.family), lists: pair.map((r, i) => ({ id: i ? "B" : "A", changes: r.list! })) });
        built.map.packets[id] = { id, role: "pairwise", family: inp.family, stage: inp.stage, unit, model, judges: PRODUCTION_JUDGES[model], items: {}, pair: { contrast }, lists: Object.fromEntries(pair.map((r, i) => [i ? "B" : "A", { kind: "arm", unit, model, arm: r.arm, pass: r.pass, session: r.session, words: words(r.list!) } as ListRef])) };
      }
    }
  return shuffleOrder(built, rng);
}

/** The arm-guess probe (section 9, attack 5): 30 seeded lists, one a packet, for Astra. */
export function buildProbePackets(inp: BuildInput, n = 30): Built {
  const rng = seededRandom(inp.seed + 5);
  const taken = new Set<string>();
  const built = emptyMap(inp, "probe");
  const rows = shuffle(familyRows(inp).filter((r) => r.end === "block").sort((a, b) => (a.session < b.session ? -1 : 1)), rng).slice(0, n);
  for (const r of rows) {
    const id = randomId(rng, taken);
    built.packets.push({ id, prompt: "probe", items: [], lists: [{ id: "L", changes: r.list! }] });
    built.map.packets[id] = { id, role: "probe", family: inp.family, stage: inp.stage, unit: r.unit, model: r.model, judges: ["astra"], items: {}, lists: { L: { kind: "arm", unit: r.unit, model: r.model, arm: r.arm, pass: r.pass, session: r.session, words: words(r.list!) } } };
  }
  return built;
}

export function readPackets(dir: string): Map<string, PacketFile> {
  if (!existsSync(dir)) throw new PvError("E_USAGE", "packets directory " + dir + " does not exist");
  const out = new Map<string, PacketFile>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const p = readJson<PacketFile>(join(dir, f), "packet");
    out.set(p.id, p);
  }
  return out;
}

const USAGE = "gstack-evals pv packets --kind label|check|pairwise|probe --family plan|brief --stage 1|2 --units <dir> --rows <rows> [--rows <rows>] --out <packets dir> --map <map.json> [--oracle <oracle.json>] [--check-map <map.json> --check-packets <dir> --check-labels <labels.ndjson> --plain <dir>] [--seed n]";

export async function run(argv: string[], io: Io, o: { normalize?: Normalize } = {}): Promise<number> {
  const a = parseArgs(argv, { kind: "one", family: "one", stage: "one", units: "one", rows: "many", out: "one", map: "one", oracle: "one", "check-map": "one", "check-packets": "one", "check-labels": "one", plain: "one", seed: "one" }, USAGE);
  need(a, ["kind", "family", "stage", "units", "rows", "out", "map"], USAGE);
  const kind = a.one.kind as PacketMap["kind"];
  if (!["label", "check", "pairwise", "probe"].includes(kind)) throw new PvError("E_USAGE", "--kind is label, check, pairwise or probe");
  const family = a.one.family as Family;
  if (family !== "plan" && family !== "brief") throw new PvError("E_USAGE", "--family is plan or brief");
  const stage = Number(a.one.stage);
  if (stage !== 1 && stage !== 2) throw new PvError("E_USAGE", "--stage is 1 or 2");
  const seed = a.one.seed === undefined ? SEED : Number(a.one.seed);
  if (!Number.isSafeInteger(seed)) throw new PvError("E_USAGE", "--seed is a whole number");
  const paths: Array<[string, string]> = [["--units", a.one.units!], ...a.many.rows!.map((r) => ["--rows", r] as [string, string]), ["--out", a.one.out!], ["--map", a.one.map!]];
  for (const f of ["oracle", "check-map", "check-packets", "check-labels", "plain"]) if (a.one[f]) paths.push(["--" + f, a.one[f]!]);
  refuseAliases(paths);
  for (const f of ["out", "map", "plain"]) if (a.one[f]) refuseInRepo("--" + f, a.one[f]!);
  if (realOf(a.one.map!).startsWith(realOf(a.one.out!) + "/")) throw new PvError("E_USAGE", "--map sits inside --out; the map from ids to arms is written outside the packets");
  const inp: BuildInput = { family, stage, seed, units: loadUnits(a.one.units!, { keys: true }), rows: a.many.rows!.flatMap(readRows), normalize: o.normalize ?? (await loadNormalize()) };
  if (a.one.oracle) inp.oracle = readJson<OracleFile>(a.one.oracle, "oracle file");
  if (kind === "label" && stage === 2) {
    need(a, ["check-map", "check-packets", "check-labels", "plain"], USAGE);
    inp.check = { map: readJson<PacketMap>(a.one["check-map"]!, "check map"), packets: readPackets(a.one["check-packets"]!), labels: readRecords<LabelRecord>(a.one["check-labels"]!, "check labels") };
  }
  const built = kind === "label" ? buildLabelPackets(inp) : kind === "check" ? buildCheckPackets(inp) : kind === "pairwise" ? buildPairwisePackets(inp) : buildProbePackets(inp);
  for (const p of built.packets) writeJson(join(a.one.out!, p.id + ".json"), p);
  writeJson(a.one.map!, built.map);
  if (built.plain) {
    writeJson(join(a.one.plain!, "gold-plain-answers.json"), built.plain.answers);
    writeFileSync(join(a.one.plain!, "gold-plain.md"), built.plain.text + "\n", { mode: 0o600 });
  }
  const roles = new Map<string, number>();
  for (const m of Object.values(built.map.packets)) roles.set(m.role, (roles.get(m.role) ?? 0) + 1);
  io.out("pv packets: " + built.packets.length + " " + kind + " packets (" + [...roles].map(([r, n]) => r + " " + n).join(", ") + ") under " + a.one.out + "; map " + a.one.map);
  return 0;
}
