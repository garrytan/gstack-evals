// Copyright (c) 2026 Garry Tan. MIT License.
// Invented fixtures for the score area's dry run and tests: units, keys, rows and a scripted judge that reads tags.
//
// Every fact here is made up. Each key item's statement carries a tag (ZQ1 to ZQ5), each wrong-way fact WW1 or WW2,
// the decoy DC1 and each detail DT1 to DT5. The scripted judge reads the rendered packet back out of the prompt and,
// by default, labels an item anticipated (and a screen hit) by every change that holds its tag, and a change as
// stating the detail when it also holds the detail's tag. An override can change, drop or garble any cell per judge.
import type { CellState, Key, KeyItem, Model, SessionKind, Tier, Unit, UnitSet } from "../types.ts";
import type { JudgeCall, JudgeCaller, JudgeReply } from "./seams.ts";
import type { Judge, ReviewRow, ScoreUnit } from "./types.ts";

export const ITEM_TEXT: readonly { cls: KeyItem["class"]; statement: string; detail: string }[] = [
  { cls: "S", statement: "The new orders table ZQ1 sits blank for several seconds while its one slow request loads (src/pages/Orders.tsx).", detail: "skeleton rows DT1, first 50 shown" },
  { cls: "H", statement: "Staff on the orders table ZQ2 look for the export action first, and it sits below the fold (src/pages/Orders.tsx).", detail: "export button DT2 in the header" },
  { cls: "R", statement: "Drivers open the orders table ZQ3 on phones 360 pixels wide, where its columns run off screen (src/pages/Orders.tsx).", detail: "360 pixels DT3, card rows" },
  { cls: "A", statement: "Screen-reader users ZQ4 can't tell the sort state of the SortHeader columns on the orders table (src/components/SortHeader.tsx).", detail: "aria-sort DT4 on each header" },
  { cls: "Y", statement: "The app's DataGrid component ZQ5 already pages long tables, and the orders table should use it (src/components/DataGrid.vue).", detail: "DataGrid DT5 with page size 50" },
];
export const WRONG_WAY = ["Two customers asked for a dark theme WW1 on every screen.", "One note says a map view WW2 of orders could help dispatch."];
export const DECOY = "Several notes worry about the print layout DC1 of the orders table.";

export const itemId = (k: number) => String(k + 1).padStart(2, "0");

export function makeKey(o: { tier: Tier; drop?: Partial<Record<number, KeyItem["drop"]>>; mentioned?: number[]; generic?: number[]; detailKeyed?: number[] } = { tier: "base" }): Key {
  return {
    items: ITEM_TEXT.map((t, k) => ({ id: itemId(k), class: t.cls, statement: t.statement, detail: t.detail, evidence: [{ file: "docs/notes-" + (k + 1) + ".md", line: 3 }], drop: o.drop?.[k] ?? null, mentioned: !!o.mentioned?.includes(k), generic: !!o.generic?.includes(k), detailKeyed: !!o.detailKeyed?.includes(k) })),
    wrongWay: [...WRONG_WAY],
    decoy: o.tier === "base" ? null : DECOY,
  };
}

export function makeUnit(id: string, o: { baseApp?: string; tier?: Tier; set?: UnitSet; base?: string; key?: Key } = {}): ScoreUnit {
  const tier = o.tier ?? "base";
  const unit: Unit = { id, baseApp: o.baseApp ?? "app-a", position: 1, kind: "k1", author: "sol", tier, set: o.set ?? "calibration", digest: "d-" + id };
  return { unit, key: o.key ?? makeKey({ tier }), base: o.base ?? id, evidence: ITEM_TEXT.map((_, k) => "docs/notes-" + (k + 1) + ".md") };
}

export function makeRow(unit: string, kind: SessionKind, list: string[] | null, o: Partial<ReviewRow> = {}): ReviewRow {
  const state: CellState = o.state ?? (list === null ? "no-block" : "scored");
  return { session: o.session ?? [unit, o.model ?? "opus", kind, o.pass ?? 1, o.stage ?? 1].join(":"), unit, model: "opus", kind, stage: 1, pass: 1, smoke: false, state, list, words: (list ?? []).join(" ").split(/\s+/).filter(Boolean).length, evidenceOpened: [], ...o };
}

/** A rendered packet read back from the prompt: items with their tags and detail tags, lists with their changes. */
export interface Seen {
  items: { id: string; tag: string | null; detailTag: string | null; detail: boolean }[];
  lists: { id: string; changes: string[] }[];
}

export function readPacket(prompt: string): Seen {
  const at = prompt.lastIndexOf("KEY ITEMS\n");
  const body = prompt.slice(at);
  const [itemsPart, listsPart] = body.slice("KEY ITEMS\n".length).split("\n\nCHANGE LISTS\n\n") as [string, string];
  const items: Seen["items"] = [];
  for (const line of itemsPart.split("\n")) {
    const m = /^\[(\w+)\] (.*)$/.exec(line);
    if (m) items.push({ id: m[1]!, tag: /\b(ZQ\d|WW\d|DC\d)\b/.exec(m[2]!)?.[1] ?? null, detailTag: null, detail: false });
    const d = /^ {4}detail: (.*)$/.exec(line);
    if (d && items.length) Object.assign(items.at(-1)!, { detail: true, detailTag: /\b(DT\d)\b/.exec(d[1]!)?.[1] ?? null });
  }
  const lists = listsPart.split("\n\n").map((block) => {
    const [head, ...rest] = block.split("\n");
    return { id: head!.slice("List ".length), changes: rest.filter((l) => /^\d+\. /.test(l)).map((l) => l.replace(/^\d+\. /, "")) };
  });
  return { items, lists };
}

export interface CellContext {
  judge: Judge;
  list: { id: string; changes: string[] };
  item: Seen["items"][number];
  tier10x: boolean;
  attempt: number;
  /** The whole packet the cell sits in. */
  packet: Seen;
}
/** An override: an entry object to answer with, "omit" to leave the cell out, or undefined for the default answer. */
export type Override = (c: CellContext) => Record<string, unknown> | "omit" | undefined;

const hits = (changes: readonly string[], tag: string | null) => (tag === null ? [] : changes.flatMap((c, i) => (new RegExp("\\b" + tag + "\\b").test(c) ? [i + 1] : [])));

/** The default answer for a cell: anticipated and screen hit by every change holding the item's tag. */
export function defaultEntry(c: CellContext): Record<string, unknown> {
  const edges = hits(c.list.changes, c.item.tag);
  const e: Record<string, unknown> = { list: c.list.id, item: c.item.id, anticipated: edges.length > 0, changes: edges, screen_hit: edges.length > 0, screen_changes: edges };
  if (c.tier10x) e.detail_changes = c.item.detail ? edges.filter((i) => hits(c.list.changes, c.item.detailTag).includes(i)) : [];
  return e;
}

/** A scripted JudgeCaller. It records every call; noText lists judges whose replies come back empty. */
export function scriptedCaller(o: { override?: Override; noText?: (call: JudgeCall) => boolean } = {}): { call: JudgeCaller; calls: JudgeCall[] } {
  const calls: JudgeCall[] = [];
  const attempts = new Map<string, number>();
  const call: JudgeCaller = async (c) => {
    calls.push(c);
    const reply = (text: string | null): JudgeReply => ({ text, modelId: "fake:" + c.judge, version: "fake-1", problem: text === null ? "scripted: no text" : null });
    if (o.noText?.(c)) return reply(null);
    if (!c.prompt.includes("KEY ITEMS\n")) return reply("ready");
    const base = c.label.replace(/:\d+$/, "");
    const attempt = (attempts.get(base) ?? 0) + 1;
    attempts.set(base, attempt);
    const seen = readPacket(c.prompt);
    const tier10x = c.prompt.includes('"detail_changes"');
    const labels: Record<string, unknown>[] = [];
    for (const list of seen.lists)
      for (const item of seen.items) {
        const ctx: CellContext = { judge: c.judge, list, item, tier10x, attempt, packet: seen };
        const ov = o.override?.(ctx);
        if (ov === "omit") continue;
        labels.push(ov ?? defaultEntry(ctx));
      }
    return reply(JSON.stringify({ labels }));
  };
  return { call, calls };
}
