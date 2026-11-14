// Copyright (c) 2026 Garry Tan. MIT License.
// The score area's dry-run cases: fixedMatching on one fixture per M3 tie-break key and on PD-1's tied validator
// blocks, each with its inputs permuted, beside a first-found matcher that must fail the same checks; then every
// scoring edge of plan section 15 and the round 2 addendum, each through the area's real functions on invented
// fixtures (fixtures.ts) with a scripted judge in place of the metered client.
import { JUDGING, MONEY, STOCK } from "../frozen.ts";
import type { DryRunCase, Matching, MatchItem, Model, Tier } from "../types.ts";
import { gate, goldFor, detailGoldFor, judgedOn, liveProbe, recheckGate, recheckPackets, recheckSample, ROUTES, type CheckSubject, type GoldCell, type JudgedCell } from "./check.ts";
import { defaultEntry, DECOY, ITEM_TEXT, makeKey, makeRow, makeUnit, scriptedCaller, type Override } from "./fixtures.ts";
import { cacheKeyOf, labelAll, promptFor } from "./labels.ts";
import { fixedMatching } from "./match.ts";
import { pairwiseSummary, type PairwiseResult } from "./pairwise.ts";
import { evidenceOpened, normalizeChanges, parseChanges, webUses } from "./parse.ts";
import { buildCheckPackets, buildLabelPackets, derangePartners, fileNamed, renderPacket } from "./packets.ts";
import { armSummary, scoreReviews, stockCounts, stockReading, tieDecided, type Review } from "./score.ts";
import type { Built, PacketLabels, ReviewRow, ScoreUnit, Stage } from "./types.ts";

const e = (change: number, detail = false) => ({ change, detail });

/** One fixture per M3 key: the earlier keys tie (or key 1 decides), and the named key picks the named matching. */
export const TIE_BREAK_FIXTURES: { key: 1 | 2 | 3 | 4; name: string; items: MatchItem[]; expect: Matching }[] = [
  {
    key: 1,
    name: "more items credited beats a lower index vector",
    items: [
      { id: "i1", keyedDetail: false, edges: [e(1), e(2)] },
      { id: "i2", keyedDetail: false, edges: [e(1)] },
    ],
    expect: { assigned: { i1: 2, i2: 1 }, credited: 2, score: 4, detailCredited: 0 },
  },
  {
    key: 2,
    name: "with credit tied, the higher score wins over a lower index vector",
    items: [
      { id: "i1", keyedDetail: true, edges: [e(1), e(2, true)] },
      { id: "i2", keyedDetail: false, edges: [e(1), e(2)] },
    ],
    expect: { assigned: { i1: 2, i2: 1 }, credited: 2, score: 4, detailCredited: 1 },
  },
  {
    key: 3,
    name: "with credit and score tied, more details carried wins over a lower index vector",
    items: [
      { id: "i1", keyedDetail: false, edges: [e(1)] },
      { id: "i2", keyedDetail: true, edges: [e(1, true)] },
      { id: "i3", keyedDetail: true, edges: [e(2)] },
    ],
    expect: { assigned: { i1: null, i2: 1, i3: 2 }, credited: 2, score: 3, detailCredited: 1 },
  },
  {
    key: 4,
    name: "with keys 1 to 3 tied, the lowest change indices in key order win",
    items: [
      { id: "i1", keyedDetail: false, edges: [e(1), e(2)] },
      { id: "i2", keyedDetail: false, edges: [e(1), e(2)] },
    ],
    expect: { assigned: { i1: 1, i2: 2 }, credited: 2, score: 4, detailCredited: 0 },
  },
];

/** PD-1: three validator blocks in which one change matches two items, so tied matchings retain different items. */
export const PD1_BLOCKS: MatchItem[][] = [
  [
    { id: "i1", keyedDetail: false, edges: [e(3)] },
    { id: "i2", keyedDetail: false, edges: [e(3)] },
    { id: "i3", keyedDetail: false, edges: [e(5)] },
  ],
  [
    { id: "i1", keyedDetail: false, edges: [e(1)] },
    { id: "i2", keyedDetail: false, edges: [e(1), e(4)] },
    { id: "i3", keyedDetail: false, edges: [e(2)] },
  ],
  [
    { id: "i1", keyedDetail: false, edges: [e(6)] },
    { id: "i2", keyedDetail: false, edges: [e(6)] },
    { id: "i3", keyedDetail: false, edges: [e(7)] },
  ],
];
/** Credited in all three blocks under the fixed matching: i2 loses the shared change to i1 in blocks 1 and 3. */
export const PD1_UNANIMOUS = ["i1", "i3"];

/** PD-1 for the give-away check: one change in one block matches two items that survived step 5. */
export const PD1_GIVE_AWAY: MatchItem[][] = [
  [
    { id: "i1", keyedDetail: false, edges: [e(2)] },
    { id: "i2", keyedDetail: false, edges: [e(2)] },
  ],
  [
    { id: "i1", keyedDetail: false, edges: [] },
    { id: "i2", keyedDetail: false, edges: [] },
  ],
  [
    { id: "i1", keyedDetail: false, edges: [] },
    { id: "i2", keyedDetail: false, edges: [] },
  ],
];
/** The fixed matching credits i1 in the first block, so i1 is given away and i2 stays. */
export const PD1_KEPT_AFTER_GIVE_AWAY = ["i2"];

type Matcher = (items: readonly MatchItem[]) => Matching;

/** A matcher that keeps the first maximum matching it finds, by augmenting paths in input order. PD-1 says it must fail. */
export const firstFoundMatching: Matcher = (items) => {
  const owner = new Map<number, number>();
  const tryItem = (i: number, seen: Set<number>): boolean => {
    for (const { change } of items[i]!.edges) {
      if (seen.has(change)) continue;
      seen.add(change);
      const o = owner.get(change);
      if (o === undefined || tryItem(o, seen)) {
        owner.set(change, i);
        return true;
      }
    }
    return false;
  };
  items.forEach((_, i) => tryItem(i, new Set()));
  const assigned: Record<string, number | null> = {};
  items.forEach((item) => (assigned[item.id] = null));
  for (const [change, i] of owner) assigned[items[i]!.id] = change;
  const credited = owner.size;
  return { assigned, credited, score: 2 * credited, detailCredited: 0 };
};

/** Every order of the items, each also with every item's edges reversed and its first edge repeated. */
export function permutations(items: readonly MatchItem[]): MatchItem[][] {
  const orders: MatchItem[][] = [];
  const walk = (left: MatchItem[], acc: MatchItem[]) => {
    if (left.length === 0) return void orders.push(acc);
    left.forEach((x, i) => walk([...left.slice(0, i), ...left.slice(i + 1)], [...acc, x]));
  };
  walk([...items], []);
  return orders.flatMap((o) => [o, o.map((it) => ({ ...it, edges: [...it.edges].reverse().concat(it.edges.slice(0, 1)) }))]);
}

const credited = (m: Matching) => Object.keys(m.assigned).filter((id) => m.assigned[id] !== null);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Unanimous: credited in every block. Each block arrives in its own order, as permuted input would. */
export const unanimous = (blocks: MatchItem[][], match: Matcher) => blocks.map((b) => new Set(credited(match(b)))).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
/** Kept after give-away: credited in no block. */
export const notGivenAway = (ids: string[], blocks: MatchItem[][], match: Matcher) => {
  const hit = new Set(blocks.flatMap((b) => credited(match(b))));
  return ids.filter((id) => !hit.has(id));
};

/** The key each order of the blocks and of their items gives; a fixed rule gives one key across all of them. */
function keysUnder(match: Matcher, read: (blocks: MatchItem[][]) => string[], blocks: MatchItem[][]): Set<string> {
  const keys = new Set<string>();
  const perms = blocks.map(permutations);
  const blockOrders = [[0, 1, 2], [2, 1, 0], [1, 0, 2]];
  for (let k = 0; k < perms[0]!.length; k++) {
    for (const order of blockOrders) {
      const permuted = order.map((b, j) => perms[b]![(k + j) % perms[b]!.length]!);
      keys.add(JSON.stringify(read(permuted).sort()));
    }
  }
  return keys;
}

export const pd1Keys = (match: Matcher) => ({
  unanimous: keysUnder(match, (b) => [...unanimous(b, match)], PD1_BLOCKS),
  giveAway: keysUnder(match, (b) => notGivenAway(["i1", "i2"], b, match), PD1_GIVE_AWAY),
});

function matcherCases(): DryRunCase[] {
  const out: DryRunCase[] = TIE_BREAK_FIXTURES.map((f) => ({
    rule: "M3",
    name: "key " + f.key + ": " + f.name,
    check: () => {
      for (const p of permutations(f.items)) {
        const got = fixedMatching(p);
        if (!same(got, f.expect)) return "expected " + JSON.stringify(f.expect) + ", got " + JSON.stringify(got);
      }
      return null;
    },
  }));
  out.push(
    {
      rule: "PD-1",
      name: "unanimous key from tied validator blocks is one fixed key under every input order",
      check: () => {
        const keys = pd1Keys(fixedMatching).unanimous;
        return same([...keys], [JSON.stringify(PD1_UNANIMOUS)]) ? null : "keys " + [...keys].join(" | ");
      },
    },
    {
      rule: "PD-1",
      name: "give-away check on a tied block keeps one fixed key under every input order",
      check: () => {
        const keys = pd1Keys(fixedMatching).giveAway;
        return same([...keys], [JSON.stringify(PD1_KEPT_AFTER_GIVE_AWAY)]) ? null : "keys " + [...keys].join(" | ");
      },
    },
    {
      rule: "PD-1",
      name: "a matcher that keeps the first maximum matching it finds fails both checks",
      check: () => {
        const k = pd1Keys(firstFoundMatching);
        return k.unanimous.size > 1 && k.giveAway.size > 1 ? null : "the first-found matcher gave one key: unanimous " + k.unanimous.size + ", give-away " + k.giveAway.size;
      },
    },
  );
  return out;
}


// ---- Scoring edges (plan section 15, addendum R2-5 and R2-18, PD-4, PD-5, PD-7, PD-8)

const fence = (label: string, body: string) => "```" + label + "\n" + body + "\n```";

interface Run {
  built: Built;
  labels: Map<string, PacketLabels>;
  reviews: Review[];
  calls: ReturnType<typeof scriptedCaller>["calls"];
}

/** Builds a read's packets, labels them with the scripted judge and scores the rows. */
async function pipeline(o: { read: Tier; units: ScoreUnit[]; rows: ReviewRow[]; stage?: Stage; calibration?: string[]; partners?: Map<string, string> | null; override?: Override }): Promise<Run> {
  const units = new Map(o.units.map((u) => [u.unit.id, u]));
  const built = buildLabelPackets({ stage: o.stage ?? 1, read: o.read, units, rows: o.rows, calibration: new Set(o.calibration ?? []), partners: o.partners ?? null });
  const { call, calls } = scriptedCaller({ override: o.override });
  const labels = new Map((await labelAll(built, call)).map((l) => [l.packet, l]));
  return { built, labels, reviews: scoreReviews({ read: o.read, units, rows: o.rows, metas: built.metas, labels }), calls };
}

const x2 = (id = "u1x", o: { detailKeyed?: number[]; baseApp?: string } = {}) => makeUnit(id, { tier: "2x", base: id.replace(/x$/, ""), baseApp: o.baseApp, key: makeKey({ tier: "2x", detailKeyed: o.detailKeyed ?? [0, 2] }) });
const LIST = ["Show skeleton rows ZQ1 DT1 while the orders table loads.", "Turn table rows into cards ZQ3 at 400 pixels.", "Add print styles DC1 and fix the ZQ2 export placement."];
const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-9;
const isUnlabelled = (r: Review) => r.state === "label-missing" && r.count === "missing";

/** n gold-yes and n gold-no agreed cells, e judged wrong on each side: kappa 1 - 2e/n. */
const kcells = (n: number, e: number, tag = "l", kind: GoldCell["kind"] = "agreed"): JudgedCell[] =>
  [...Array(n).keys()].flatMap((i) => [
    { cell: goldCell(tag + "y" + i, true, kind), judged: i >= e },
    { cell: goldCell(tag + "n" + i, false, kind === "oracle" ? "stock" : kind), judged: i < e },
  ]);
function goldCell(list: string, gold: boolean, kind: GoldCell["kind"]): GoldCell {
  return { id: list + "|01", list, unit: "u", model: "opus", tier: "base", source: kind === "agreed" ? "none" : kind === "oracle" ? "oracle" : "stock-1", item: "01", change: null, gold, kind, listRef: { source: "none", session: list, unit: "u", words: 0 }, changes: [], packetItem: { statement: "", file: null, detail: null } };
}
const ASTRA_ON_OPUS: CheckSubject = { judge: "astra", model: "opus" };

/** The rows of one unit-pass, as a particle-1 packet for the panel. */
const particleRow = (unit: string, list: string[]) => makeRow(unit, "none", list, { model: "particle" as Model, session: unit + ":particle:none:1" });

function edgeCases(): DryRunCase[] {
  return [
    {
      rule: "geva-420-s5",
      name: "the strict parse reads the last plan-changes block and the lenient parse takes the three frozen forms only",
      check: () => {
        const strict = parseChanges(["early\n" + fence("plan-changes", '{"changes": ["a"]}'), "late\n" + fence("plan-changes", '{"changes": ["b", "c"]}')]);
        const label = parseChanges([fence("json", '{"changes": ["x"]}')]);
        const commas = parseChanges([fence("plan-changes", '{"changes": ["x", "y",],}')]);
        const array = parseChanges([fence("plan-changes", '["x", "y"]')]);
        const single = parseChanges([fence("plan-changes", '{"edits": ["x"]}')]);
        const none = parseChanges(["no fence here"]);
        if (strict.kind !== "changes" || strict.changes.join() !== "b,c" || strict.lenient !== null) return "strict read " + JSON.stringify(strict);
        if (label.kind !== "changes" || label.lenient?.join() !== "label") return "a fence labelled otherwise: " + JSON.stringify(label);
        if (commas.kind !== "changes" || commas.lenient?.join() !== "commas") return "trailing commas: " + JSON.stringify(commas);
        if (array.kind !== "changes" || array.lenient?.join() !== "array") return "a bare array: " + JSON.stringify(array);
        if (single.kind !== "no-block") return "an object under another single key is not a frozen form, got " + JSON.stringify(single);
        return none.kind === "no-block" ? null : "a reply with no fence parsed";
      },
    },
    {
      rule: "geva-420-s5",
      name: "the normalizer keeps 8 changes, strips markdown and numbering and cuts each at its 40th word",
      check: () => {
        const long = Array.from({ length: 45 }, (_, i) => "w" + i).join(" ");
        const n = normalizeChanges(["1. **Bold** `code` [link](http://x)", long, "c", "d", "e", "f", "g", "h", "ninth"]);
        if (n.list.length !== 8 || n.items !== 8) return "kept " + n.list.length;
        if (n.list[0] !== "Bold code link") return "stripped to " + JSON.stringify(n.list[0]);
        if (n.list[1]!.split(" ").length !== 40 || n.cut !== 1) return "the cut gave " + n.list[1]!.split(" ").length + " words, cut " + n.cut;
        return null;
      },
    },
    {
      rule: "section-11-BT",
      name: "the web check, the evidence read and the file read on their edges",
      check: () => {
        const t = (blocks: object[]) => blocks.map((b) => JSON.stringify(b)).join("\n");
        const web = t([{ type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "WebFetch", input: {} }, { type: "tool_use", id: "b", name: "WebSearch", input: {} }] } }, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a", content: "page" }, { type: "tool_result", tool_use_id: "b", is_error: true, content: "denied" }] } }]);
        if (webUses(web).map((u) => u.tool).join() !== "WebFetch") return "web uses " + JSON.stringify(webUses(web));
        const tr = t([{ type: "assistant", message: { content: [{ type: "tool_use", id: "r", name: "Read", input: { file_path: "/work/repo/docs/notes-1.md" } }, { type: "tool_use", id: "s", name: "Bash", input: { command: "cat docs/notes-2.md | head" } }, { type: "tool_use", id: "x", name: "Read", input: { file_path: "/work/repo/docs/notes-3.md.bak" } }] } }]);
        const opened = evidenceOpened(tr, ["docs/notes-1.md", "docs/notes-2.md", "docs/notes-3.md"]);
        if (opened.join() !== "docs/notes-1.md,docs/notes-2.md") return "opened " + opened.join();
        const it = makeKey({ tier: "base" }).items[3]!;
        const named = [fileNamed(it, ["Fix src/components/SortHeader.tsx"]), fileNamed(it, ["Fix SortHeader.tsx"]), fileNamed(it, ["Give SortHeader an aria-sort"]), fileNamed(it, ["Fix the sort header"]), fileNamed(it, ["Fix SortHeaderX"])];
        return named.join() === "true,true,true,false,false" ? null : "file read " + named.join();
      },
    },
    {
      rule: "R2-5",
      name: "a 2x packet shows statements with the decoy and wrong-way items, and a 10x packet shows keyed details with the detail label",
      check: async () => {
        const u = x2();
        const rows = [makeRow("u1x", "none", LIST)];
        const units = new Map([[u.unit.id, u]]);
        const b2 = buildLabelPackets({ stage: 1, read: "2x", units, rows, calibration: new Set() });
        const b10 = buildLabelPackets({ stage: 1, read: "10x", units, rows, calibration: new Set() });
        const r2 = renderPacket(b2.packets[0]!), r10 = renderPacket(b10.packets[0]!);
        const p2 = promptFor(b2.packets[0]!), p10 = promptFor(b10.packets[0]!);
        if (!r2.includes(DECOY) || !r2.includes("WW1") || !r2.includes("WW2") || r2.includes("detail:")) return "the 2x packet is not statement-only with the decoy and wrong-way items";
        if (r10.includes(DECOY) || r10.includes("WW1") || (r10.match(/ {4}detail: /g) ?? []).length !== 2) return "the 10x packet shows " + (r10.match(/ {4}detail: /g) ?? []).length + " details or a decoy";
        if (p2.includes("detail_changes") || !p10.includes("detail_changes")) return "only the 10x prompt carries the detail label";
        const roles = Object.values(b2.metas[0]!.items).map((r) => r.role).sort().join();
        if (roles !== "decoy,key,key,key,key,key,wrong-way,wrong-way") return "2x item roles " + roles;
        return cacheKeyOf("astra", "medium", b2.packets[0]!) !== cacheKeyOf("astra", "medium", b10.packets[0]!) ? null : "2x and 10x share a cache identity";
      },
    },
    {
      rule: "PD-7",
      name: "shuffled-key partners come from the same base app first, and a 10x shuffled packet carries the partner's details",
      check: async () => {
        const us = [x2("a1x", { baseApp: "app-a" }), x2("a2x", { baseApp: "app-a" }), x2("b1x", { baseApp: "app-b", detailKeyed: [1] }), x2("c1x", { baseApp: "app-c" })];
        const partners = derangePartners(us)!;
        if (partners.get("a1x") !== "a2x" || partners.get("a2x") !== "a1x") return "a1x and a2x share a base app but got " + partners.get("a1x") + ", " + partners.get("a2x");
        if ([...partners].some(([a, b]) => a === b)) return "a unit is its own partner";
        const rows = us.map((u) => makeRow(u.unit.id, "none", LIST, { stage: 2 }));
        const run = await pipeline({ read: "10x", stage: 2, units: us, rows, partners });
        const sh = run.built.metas.find((m) => m.role === "shuffled" && m.listsUnit === "c1x")!;
        const file = run.built.packets.find((p) => p.id === sh.id)!;
        const details = file.items.filter((i) => i.detail !== null).length;
        const want = us.find((u) => u.unit.id === sh.unit)!.key.items.filter((i) => i.detailKeyed).length;
        if (details !== want || file.items.length !== 5) return "the shuffled packet shows " + details + " details of " + want;
        const r = run.reviews.find((x) => x.unit === "c1x")!;
        return r.shuffled !== null && near(r.specificity, r.G! - r.shuffled) ? null : "specificity at 10x is not G minus shuffled G: " + JSON.stringify([r.G, r.shuffled, r.specificity]);
      },
    },
    {
      rule: "R2-18",
      name: "a yes with no change index is unlabelled, resent once whole, then the review is E_DC_LABEL_MISSING",
      check: async () => {
        const ov: Override = (c) => (c.item.tag === "ZQ1" && c.list.changes[0]?.includes("ZQ1") ? { ...defaultEntry(c), changes: [] } : undefined);
        const run = await pipeline({ read: "base", units: [makeUnit("u1")], rows: [makeRow("u1", "none", LIST)], override: ov });
        const r = run.reviews[0]!;
        if (run.calls.length !== 2 || run.calls[1]!.maxTokens !== 2 * MONEY.outputCaps.productionLabels || !run.calls[1]!.prompt.endsWith("Answer every cell.)")) return "expected one whole-packet resend at twice the cap, got " + run.calls.length + " calls";
        if (!isUnlabelled(r) || !r.unlabelled[0]!.includes("R2-18")) return "the review reads " + r.state + " " + r.unlabelled.join();
        const fixed: Override = (c) => (c.attempt === 1 ? ov(c) : undefined);
        const again = await pipeline({ read: "base", units: [makeUnit("u1")], rows: [makeRow("u1", "none", LIST)], override: fixed });
        return again.reviews[0]!.state === "scored" && near(again.reviews[0]!.A, 0.6) ? null : "a resend that answers every cell should score A 0.6, got " + again.reviews[0]!.A;
      },
    },
    {
      rule: "geva-420-s5",
      name: "a primary cell missing after the resend makes the review missing, and a missing secondary cell only nulls that read",
      check: async () => {
        const prim: Override = (c) => (c.item.tag === "ZQ4" && c.list.changes.length === 3 ? "omit" : undefined);
        const a = await pipeline({ read: "base", units: [makeUnit("u1")], rows: [makeRow("u1", "none", LIST)], override: prim });
        if (!isUnlabelled(a.reviews[0]!)) return "a missing primary cell scored " + a.reviews[0]!.A;
        const unit = makeUnit("u1", { key: makeKey({ tier: "base", mentioned: [3] }) });
        const b = await pipeline({ read: "base", units: [unit], rows: [makeRow("u1", "none", LIST)], override: prim });
        const r = b.reviews[0]!;
        return r.state === "scored" && r.mentioned === null && r.precision === null && r.A !== null ? null : "a missing mentioned cell read " + JSON.stringify([r.state, r.mentioned, r.precision]);
      },
    },
    {
      rule: "M11",
      name: "a Gemini call names pairs Astra and Opus didn't split on, and its detail labels count there",
      check: async () => {
        const ov: Override = (c) => {
          if (c.item.tag !== "ZQ1" || !c.list.changes[0]?.includes("ZQ1")) return undefined;
          const e = defaultEntry(c);
          if (c.judge === "astra") return { ...e, changes: [1], screen_changes: [1], detail_changes: [1] };
          if (c.judge === "opus") return { ...e, changes: [2], screen_changes: [2], detail_changes: [] };
          return { ...e, changes: [1, 2], screen_changes: [1, 2], detail_changes: [1] };
        };
        const list = ["Skeleton rows ZQ1 DT1 on the orders table.", "Placeholder rows ZQ1 while it loads.", "Cards ZQ3 at 400 pixels."];
        const run = await pipeline({ read: "10x", units: [x2()], rows: [particleRow("u1x", list)], override: ov });
        const argon = run.calls.filter((c) => c.judge === "argon");
        if (argon.length !== 1 || !argon[0]!.prompt.includes("detail_changes")) return "Gemini should label the whole 10x packet once, got " + argon.length;
        const meta = run.built.metas[0]!;
        const lid = Object.entries(meta.lists).find(([, r]) => r.source === "none")![0];
        const pid = Object.entries(meta.items).find(([, r]) => r.role === "key" && r.id === "01")![0];
        const cell = run.labels.get(meta.id)!.reader.get(lid + "|" + pid)!;
        if (cell.kind !== "labelled" || cell.anticipatedEdges.join() !== "1,2" || cell.detailEdges?.join() !== "1") return "panel cell " + JSON.stringify(cell);
        const r = run.reviews[0]!;
        return r.assigned?.["01"] === 1 && near(r.G, (2 + 1) / 10) ? null : "item 01 should take change 1 with its detail: " + JSON.stringify([r.assigned, r.G]);
      },
    },
    {
      rule: "M11",
      name: "an item credited only through the Gemini fallback caps at 1 of 2 and prints in the fallback count",
      check: async () => {
        const ov: Override = (c) => {
          if (c.item.tag !== "ZQ1" || !c.list.changes[0]?.includes("ZQ1")) return undefined;
          if (c.judge === "astra") return { ...defaultEntry(c), changes: [1], screen_changes: [1], detail_changes: [1] };
          if (c.judge === "opus") return { ...defaultEntry(c), anticipated: false, changes: [], detail_changes: [] };
          return { ...defaultEntry(c), changes: [3], screen_changes: [1], detail_changes: [3] };
        };
        const list = ["Skeleton rows ZQ1 DT1 on the orders table.", "Export ZQ2 in the header.", "Placeholder rows DT1 for orders ZQ1."];
        const run = await pipeline({ read: "10x", units: [x2()], rows: [particleRow("u1x", list)], override: ov });
        const r = run.reviews[0]!;
        const s = armSummary(run.reviews, "particle", "none");
        return r.assigned?.["01"] === 3 && near(r.G, (1 + 2) / 10) && r.viaGemini === 1 && s.viaGemini === 1 ? null : "fallback read " + JSON.stringify([r.assigned, r.G, r.viaGemini]);
      },
    },
    {
      rule: "R2-18",
      name: "in the panel a yes with no index uses the other judges' edges, and is unlabelled only when no judge names one",
      check: async () => {
        const one: Override = (c) => (c.item.tag === "ZQ1" && c.list.changes[0]?.includes("ZQ1") ? (c.judge === "astra" ? { ...defaultEntry(c), changes: [] } : c.judge === "argon" ? { ...defaultEntry(c), anticipated: false, changes: [] } : undefined) : undefined);
        const a = await pipeline({ read: "base", units: [makeUnit("u1")], rows: [particleRow("u1", LIST)], override: one });
        if (a.reviews[0]!.assigned?.["01"] !== 1 || a.reviews[0]!.viaOthers !== 1) return "the other judges' edge should credit item 01: " + JSON.stringify(a.reviews[0]!.assigned);
        const both: Override = (c) => (c.item.tag === "ZQ1" && c.list.changes[0]?.includes("ZQ1") && c.judge !== "argon" ? { ...defaultEntry(c), changes: [] } : undefined);
        const b = await pipeline({ read: "base", units: [makeUnit("u1")], rows: [particleRow("u1", LIST)], override: both });
        return isUnlabelled(b.reviews[0]!) ? null : "a panel yes with no index from any judge should be unlabelled, read " + b.reviews[0]!.state;
      },
    },
    {
      rule: "PD-4",
      name: "an unlabelled stock cell that could flip STOCK FAIL sends the read to the Captain",
      check: async () => {
        const res = await stockRun(2, 1);
        return res.toCaptain && !res.fail && res.consequence === "to the Captain" && res.rows[0]!.credited === 2 && res.rows[0]!.unlabelled === 1 ? null : "read " + JSON.stringify(res);
      },
    },
    {
      rule: "PD-4",
      name: "an unlabelled stock cell that can't flip STOCK FAIL leaves the read as observed",
      check: async () => {
        const low = await stockRun(1, 1);
        const high = await stockRun(3, 1);
        if (low.toCaptain || low.fail || low.consequence !== "none") return "1 credited and 1 unlabelled read " + low.consequence;
        return high.fail && !high.toCaptain && high.consequence === "ends the eval" ? null : "3 credited on Opus lists in stage 1 should end the eval, read " + high.consequence;
      },
    },
    {
      rule: "PD-8",
      name: "a unit credited only in its 2x packet counts once, and a twin's packet counts nothing",
      check: async () => {
        const stock2: Override = (c) => (c.item.tag === "ZQ1" && c.list.changes[0] === "Make wireframes or mockups of every new screen before building." ? { ...defaultEntry(c), anticipated: true, changes: [1], screen_hit: false, screen_changes: [] } : undefined);
        const base = makeUnit("u1"), v2 = x2("u1x"), twin = makeUnit("t1", { set: "second-skin" });
        const runB = await pipeline({ read: "base", units: [base, twin], rows: [makeRow("u1", "none", LIST), makeRow("t1", "none", LIST)], override: (c) => (c.list.changes[0]?.startsWith("Make wireframes") && c.item.tag === "ZQ1" ? stock2(c) : undefined) });
        const runX = await pipeline({ read: "2x", units: [v2], rows: [makeRow("u1x", "none", LIST, { pass: 1 }), makeRow("u1x", "none", LIST, { pass: 2, session: "u1x:p2" })], override: stock2 });
        const units = new Map([base, twin, v2].map((u) => [u.unit.id, u]));
        const labelsB = new Map([...runB.labels, ...runX.labels]);
        const onlyX = stockCounts({ metas: [...runB.built.metas.filter((m) => m.unit !== "u1"), ...runX.built.metas], labels: labelsB, units, stageSet: "calibration" });
        const row2 = onlyX.filter((c) => c.row === 2 && c.status === "credited");
        if (row2.length !== 1 || row2[0]!.unit !== "u1" || row2[0]!.packets.length !== 2) return "credited only at 2x: " + JSON.stringify(row2);
        const all = stockCounts({ metas: [...runB.built.metas, ...runX.built.metas], labels: labelsB, units, stageSet: "calibration" });
        const r2 = all.filter((c) => c.row === 2 && c.status === "credited");
        return r2.length === 1 && r2[0]!.unit === "u1" ? null : "the twin or a second packet added a unit: " + JSON.stringify(r2.map((c) => c.unit));
      },
    },
    {
      rule: "PD-5",
      name: "a change matching the decoy keeps its primary edges, and the decoy and wrong-way reads are 2x label reads",
      check: async () => {
        const list = ["Add print styles DC1 and skeleton rows ZQ1.", "Cards ZQ3 on phones.", "A dark theme WW1."];
        const run = await pipeline({ read: "2x", units: [x2()], rows: [makeRow("u1x", "none", list)] });
        const r = run.reviews[0]!;
        if (r.assigned?.["01"] !== 1 || r.decoyHit !== true || r.wrongWayHit !== true || !near(r.A, 0.4)) return "2x read " + JSON.stringify([r.assigned, r.decoyHit, r.wrongWayHit, r.A]);
        const base = await pipeline({ read: "base", units: [makeUnit("u1")], rows: [makeRow("u1", "none", list)] });
        return base.reviews[0]!.decoyHit === null && base.reviews[0]!.wrongWayHit === null ? null : "the base read labels no decoy or wrong-way fact";
      },
    },
    {
      rule: "M6",
      name: "A, G, D and A without Y read one matching; a no-block scores 0 and a missing review reads nothing",
      check: async () => {
        const list = ["Skeleton rows ZQ1 DT1.", "Cards ZQ3 at 400 pixels.", "Use DataGrid ZQ5 DT5."];
        const rows = [makeRow("u1x", "none", list), makeRow("u1x", "lens", null, { state: "no-block" }), makeRow("u1x", "autoplan", null, { state: "web-contaminated" })];
        const run = await pipeline({ read: "10x", units: [x2("u1x", { detailKeyed: [0, 2] })], rows });
        const [s, z, m] = run.reviews as [Review, Review, Review];
        if (!near(s.A, 0.6) || !near(s.G, 5 / 10) || !near(s.D, 0.5) || !near(s.withoutY, 0.5) || s.byClass.Y !== 1) return "scored " + JSON.stringify([s.A, s.G, s.D, s.withoutY, s.byClass]);
        if (z.A !== 0 || z.G !== 0 || z.D !== 0 || z.count !== "zero") return "no-block " + JSON.stringify([z.A, z.G, z.D]);
        return m.A === null && m.count === "missing" ? null : "contaminated read " + m.A;
      },
    },
    {
      rule: "M13",
      name: "uneven pass counts weigh units equally: each unit's mean over its passes, then the mean over units",
      check: async () => {
        const hit = ["ZQ1 ZQ2 ZQ3 ZQ4 ZQ5 all", "ZQ2", "ZQ3", "ZQ4", "ZQ5"];
        const rows = [
          makeRow("u1", "none", hit, { pass: 1, session: "a1" }), makeRow("u1", "none", ["nothing"], { pass: 2, session: "a2" }), makeRow("u1", "none", ["nothing"], { pass: 3, session: "a3" }),
          makeRow("u2", "none", hit, { pass: 1, session: "b1" }),
        ];
        const run = await pipeline({ read: "base", units: [makeUnit("u1"), makeUnit("u2", { baseApp: "app-b" })], rows });
        const s = armSummary(run.reviews, "opus", "none");
        return near(s.A, (1 / 3 + 1) / 2) && s.units === 2 ? null : "arm A " + s.A + " over " + s.units + " units; pooled passes would give 0.5";
      },
    },
    {
      rule: "M14",
      name: "the print of PD-1's effect counts the credits a tie-break decided",
      check: () => {
        const e = (c: number) => ({ change: c, detail: false });
        const tied = tieDecided([{ id: "01", keyedDetail: false, edges: [e(1)] }, { id: "02", keyedDetail: false, edges: [e(1)] }, { id: "03", keyedDetail: false, edges: [e(2)] }]);
        const clear = tieDecided([{ id: "01", keyedDetail: false, edges: [e(1)] }, { id: "02", keyedDetail: false, edges: [e(2)] }]);
        return tied.join() === "01" && clear.length === 0 ? null : "tie-decided " + tied.join() + " and " + clear.join();
      },
    },
    {
      rule: "section-6-judge-check",
      name: "kappa 0.59 fails and 0.60 passes at four decimals",
      check: () => {
        const lo = gate(ASTRA_ON_OPUS, kcells(200, 41)), hi = gate(ASTRA_ON_OPUS, kcells(200, 40));
        return !lo.pass && lo.reading === "kappa under 0.6" && near(lo.kappa, 0.59) && hi.pass && near(hi.kappa, 0.6) ? null : "kappas " + lo.kappa + " " + hi.kappa;
      },
    },
    {
      rule: "section-6-judge-check",
      name: "the floors: 40 gold cells of each class from 40 distinct lists",
      check: () => {
        const ok = gate(ASTRA_ON_OPUS, kcells(40, 0));
        const short = gate(ASTRA_ON_OPUS, kcells(39, 0));
        const fewLists = gate(ASTRA_ON_OPUS, kcells(40, 0).map((j, i) => ({ ...j, cell: { ...j.cell, list: "l" + (i % 39) } })));
        return ok.pass && short.reading === "short of gold cells" && fewLists.short && fewLists.lists === 39 ? null : "floors " + [ok.reading, short.reading, fewLists.lists].join();
      },
    },
    {
      rule: "section-6-judge-check",
      name: "anchor cells carry at most a quarter of the weight, and oracle cells at most half of the anticipated class",
      check: () => {
        const real = kcells(30, 9, "r");
        const anchors = [...kcells(50, 0, "o", "oracle")];
        const g = gate(ASTRA_ON_OPUS, [...real, ...anchors]);
        if (g.oracle.used !== 30 || g.oracle.available !== 50) return "oracle cells used " + g.oracle.used + " of " + g.oracle.available;
        const anchorWeight = g.anchors * g.anchorWeight, total = 60 + anchorWeight;
        if (!(anchorWeight / total <= JUDGING.anchorWeightMax + 1e-12) || Math.abs(anchorWeight / total - 0.25) > 1e-9) return "anchor share " + anchorWeight / total;
        return g.kappa !== null && g.kappaUnweighted !== null && g.kappa < g.kappaUnweighted && near(g.kappaReal, 1 - 18 / 30) ? null : "weighted " + g.kappa + " unweighted " + g.kappaUnweighted + " real " + g.kappaReal;
      },
    },
    {
      rule: "section-6-judge-check",
      name: "each judge's gold comes from the other two families, and the detail check reads pairs at 10x",
      check: async () => {
        const units = [x2("u1x", { detailKeyed: [0, 2] })];
        const rows = [makeRow("u1x", "none", ["Skeleton rows ZQ1 DT1.", "Cards ZQ3 at 400 pixels."]), makeRow("u1x", "reference", ["ZQ3 DT3 cards at 360.", "ZQ2 export first."], { session: "ref" })];
        const um = new Map(units.map((u) => [u.unit.id, u]));
        const prod = await pipeline({ read: "10x", units, rows, calibration: ["u1x"] });
        const checkBuilt = buildCheckPackets({ stage: 1, read: "10x", units: um, rows, calibration: new Set(["u1x"]) });
        const astraOff: Override = (c) => (c.judge === "astra" && c.item.tag === "ZQ2" ? { ...defaultEntry(c), anticipated: !defaultEntry(c).anticipated, changes: defaultEntry(c).anticipated ? [] : [1], screen_hit: false, screen_changes: [] } : undefined);
        const { call } = scriptedCaller({ override: astraOff });
        const checkLabels = new Map((await labelAll(checkBuilt, call)).map((l) => [l.packet, l]));
        const inp = { units: um, check: { built: checkBuilt, labels: checkLabels }, production: { built: prod.built, labels: prod.labels } };
        const astraGold = goldFor({ judge: "astra", model: "opus" }, inp), opusGold = goldFor({ judge: "opus", model: "opus" }, inp);
        const hasZQ2 = (gs: GoldCell[]) => gs.some((g) => g.item === "02" && g.kind === "agreed");
        if (!hasZQ2(astraGold) || hasZQ2(opusGold)) return "Astra's own disagreement should leave its gold alone and remove the cells from Opus's";
        if (astraGold.filter((g) => g.kind === "oracle").length !== 5 || astraGold.filter((g) => g.kind === "stock").length !== 10) return "anchors: oracle " + astraGold.filter((g) => g.kind === "oracle").length + ", stock " + astraGold.filter((g) => g.kind === "stock").length;
        const pairs = detailGoldFor({ judge: "astra", model: "opus" }, inp);
        const judged = judgedOn({ judge: "astra", model: "opus" }, pairs, inp.production, true);
        const yes = pairs.filter((p) => p.gold).length, no = pairs.filter((p) => !p.gold).length;
        if (pairs.filter((p) => p.kind === "oracle").length !== 2 || yes < 3 || no < 1) return "detail pairs " + yes + " yes, " + no + " no";
        return judged.every((j) => j.judged === j.cell.gold) ? null : "Astra's production detail labels disagree with the scripted gold";
      },
    },
    {
      rule: "section-6-recheck",
      name: "the stage 2 re-check draws 80 gold cells in 8 blind packets of 10, half of each class, from at least 20 lists",
      check: async () => {
        const gold: GoldCell[] = [];
        for (let u = 0; u < 10; u++)
          for (let l = 0; l < 4; l++)
            for (let i = 0; i < 4; i++) {
              const it = ITEM_TEXT[i]!;
              gold.push({ ...goldCell("u" + u + "l" + l, (l + i) % 2 === 0, "agreed"), id: "u" + u + "l" + l + "|0" + (i + 1), unit: "u" + u, item: "0" + (i + 1), source: (["none", "lens", "plan-design-review", "autoplan"] as const)[l]!, listRef: { source: "none", session: "u" + u + "l" + l, unit: "u" + u, words: 1 }, changes: [0, 1, 2, 3].filter((j) => (l + j) % 2 === 0).map((j) => "A change for ZQ" + (j + 1) + "."), packetItem: { statement: it.statement, file: null, detail: null } });
            }
        const s = recheckSample(ASTRA_ON_OPUS, gold, { tier: "base" });
        if (s.short || s.packets.length !== 8 || s.packets.some((p) => p.length !== 10 || p.filter((g) => g.gold).length !== 5) || s.lists < 20) return "sample " + JSON.stringify({ short: s.short, n: s.packets.map((p) => p.length), lists: s.lists });
        const built = recheckPackets(ASTRA_ON_OPUS, s.packets);
        const { call } = scriptedCaller();
        const labels = new Map((await labelAll(built, call)).map((l) => [l.packet, l]));
        const g = recheckGate(ASTRA_ON_OPUS, built, labels);
        if (g.anticipated !== 40 || g.not !== 40 || !g.pass) return "re-check gate " + JSON.stringify([g.anticipated, g.not, g.reading]);
        const few = recheckSample(ASTRA_ON_OPUS, gold.filter((x) => Number(x.unit.slice(1)) < 7), { tier: "base" });
        return few.short ? null : "seven units of gold should leave the re-check short";
      },
    },
    {
      rule: "section-6-probe",
      name: "the live judge probe calls every route once and fails a route that returns no text",
      check: async () => {
        const { call, calls } = scriptedCaller({ noText: (c) => c.label === "probe:check:argon" });
        const res = await liveProbe(call);
        const failed = res.filter((r) => !r.ok).map((r) => r.route);
        return calls.length === ROUTES.length && ROUTES.length === 9 && failed.join() === "check:argon" ? null : "probe " + calls.length + " calls, failed " + failed.join();
      },
    },
    {
      rule: "section-6-pairwise",
      name: "the stock block's pairwise share flags above 20% on Opus, and the arm guess flags above 70%",
      check: () => {
        const pr = (winner: PairwiseResult["winner"], k: number): PairwiseResult => ({ task: { id: "t" + k, unit: "u" + k, model: "opus", x: { side: "stock-1", list: [], words: 0 }, y: { side: "none", list: [], words: 0 }, aIs: "x" }, winner, why: null });
        const at = (wins: number, n: number) => pairwiseSummary([...Array(n).keys()].map((k) => pr(k < wins ? "x" : "y", k)));
        if (at(1, 5).stockFlag || !at(2, 9).stockFlag) return "stock flag at 1 of 5 " + at(1, 5).stockFlag + ", at 2 of 9 " + at(2, 9).stockFlag;
        const flag = (correct: number) => {
          const rate = correct / JUDGING.armGuess.lists;
          return Math.round(rate * 1e4) / 1e4 > JUDGING.armGuess.flagAbove;
        };
        return !flag(21) && flag(22) ? null : "arm guess flags at 21 of 30: " + flag(21) + ", at 22: " + flag(22);
      },
    },
    {
      rule: "section-6-resend",
      name: "a failed Gemini tie-break is retried once, then its split cells stay unlabelled",
      check: async () => {
        const ov: Override = (c) => (c.item.tag === "ZQ1" && c.list.changes[0]?.includes("ZQ1") ? (c.judge === "opus" ? { ...defaultEntry(c), anticipated: false, changes: [] } : c.judge === "argon" ? "omit" : undefined) : undefined);
        const run = await pipeline({ read: "base", units: [makeUnit("u1")], rows: [particleRow("u1", LIST)], override: ov });
        const argon = run.calls.filter((c) => c.judge === "argon").length;
        return argon === 2 && isUnlabelled(run.reviews[0]!) && run.reviews[0]!.unlabelled[0]!.includes("Gemini") ? null : "Gemini calls " + argon + ", review " + run.reviews[0]!.state;
      },
    },
  ];
}

/**
 * Stage 1 STOCK FAIL on Opus lists through the real label path: on the first credited units the judge credits stock row
 * 1's first change with item 01; on the next unlabelled units it leaves that cell out of both answers.
 */
async function stockRun(credited: number, unlabelled: number) {
  const units: ScoreUnit[] = [];
  const rows: ReviewRow[] = [];
  for (let k = 0; k < credited + unlabelled; k++) {
    units.push(makeUnit("s" + k, { baseApp: "app-" + k }));
    rows.push(makeRow("s" + k, "none", [...LIST, "Unit marker S" + k + "."]));
  }
  const ov: Override = (c) => {
    if (c.list.changes[0] !== "Add loading, empty and error states to every screen that fetches data." || c.item.tag !== "ZQ1") return undefined;
    const k = Number(/Unit marker S(\d+)\./.exec(c.packet.lists.flatMap((l) => l.changes).join("\n"))?.[1]);
    if (k < credited) return { ...defaultEntry(c), anticipated: true, changes: [1] };
    return "omit";
  };
  const run = await pipeline({ read: "base", units, rows, override: ov });
  const res = stockReading(stockCounts({ metas: run.built.metas, labels: run.labels, units: new Map(units.map((u) => [u.unit.id, u])), stageSet: "calibration" }), "opus", 1, STOCK.stage1Units);
  const resent = run.calls.filter((c) => c.label.endsWith(":2")).length;
  if (resent !== unlabelled) throw new Error("expected one resend per unlabelled packet, got " + resent);
  if (run.reviews.some((r) => r.state !== "scored")) throw new Error("a stock cell left unlabelled must not unscore the review");
  return res;
}

export function cases(): DryRunCase[] {
  return [...matcherCases(), ...edgeCases()];
}

