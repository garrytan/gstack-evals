// Copyright (c) 2026 Garry Tan. MIT License.
// The score area's own shapes: review rows as the scorer reads them, packets and their sealed maps, judge cells and labels.
import type { CellState, Key, LabelCell, ListSource, Model, SessionKind, Tier, Unit } from "../types.ts";

/** A judge model. Argon is Gemini 4 Argon, the particle-1 panel's third vote and the check pass's third family. */
export type Judge = "astra" | "opus" | "argon";
/** Whose labels a model's lists are read with (frozen JUDGE_OF): one judge, or the particle-1 panel. */
export type Reader = "astra" | "opus" | "panel";
export type Stage = 1 | 2;

/** One review session as the scorer reads it. The run area fills it once the cell is final (plan section 6). */
export interface ReviewRow {
  session: string;
  unit: string;
  model: Model;
  kind: SessionKind;
  stage: Stage;
  pass: number;
  smoke: boolean;
  /** The cell's final state, after its one retry. */
  state: CellState;
  /** The normalized list; null unless the state scores from a block. */
  list: string[] | null;
  words: number;
  /** The evidence paths the session's tool inputs named (parse.ts evidenceOpened); null when the transcript was unreadable. */
  evidenceOpened: string[] | null;
}

/** A unit version and its key. A 2x version is its own unit with its own key; the 10x read uses the 2x unit's key. */
export interface ScoreUnit {
  unit: Unit;
  key: Key;
  /** The base unit's id: its own id at the base tier, the base unit's at 2x, so STOCK FAIL counts a unit once (PD-8). */
  base: string;
  /** The unit's evidence file paths, for the evidence read. */
  evidence: string[];
}

export type PromptName = "brief" | "audit";
export type PacketRole = "production" | "shuffled" | "check" | "recheck";

/** What a packet list is: a session's list, a stock row or the oracle list, and the unit it was written for. */
export interface ListRef {
  source: ListSource;
  /** The session id for a session's list; null for stock rows and oracle lists. */
  session: string | null;
  unit: string;
  words: number;
  /** Oracle lists at 10x: the item ids whose change the 40-word cut shortened (left out of the detail anchors). */
  cut?: string[];
}

/** What a packet item is: a key item (by its key.json id), the 2x decoy, or a wrong-way fact (by its index from 1). */
export type ItemRef = { role: "key"; id: string } | { role: "decoy" } | { role: "wrong-way"; index: number };

export interface PacketItem {
  id: string;
  statement: string;
  /** The file the statement names, shown beside it; null when the statement names none (decoy and wrong-way facts). */
  file: string | null;
  /** 10x packets only: the keyed detail; null on items without one and on every base and 2x item. */
  detail: string | null;
}

/** The blind packet a judge reads: random ids only. */
export interface PacketFile {
  id: string;
  prompt: PromptName;
  tier: Tier;
  items: PacketItem[];
  lists: { id: string; changes: string[] }[];
}

/** The sealed side of a packet: what each random id stands for. */
export interface PacketMeta {
  id: string;
  role: PacketRole;
  stage: Stage;
  tier: Tier;
  /** The unit whose key items the packet shows. */
  unit: string;
  /** The unit whose lists the packet shows; differs from unit only on a shuffled-key packet. */
  listsUnit: string;
  /** The model whose lists the packet holds. */
  model: Model;
  pass: number | null;
  smoke: boolean;
  items: Record<string, ItemRef>;
  lists: Record<string, ListRef>;
  /** Re-check packets: the gold cells they carry, by packet cell key. */
  gold?: { cell: string; gold: boolean; anchor: boolean }[];
}

export interface Built {
  packets: PacketFile[];
  metas: PacketMeta[];
}

/** A cell as one judge answered it, before R2-18: a yes may name no change index here. */
export interface RawCell {
  anticipated: boolean;
  edges: number[];
  screenHit: boolean;
  screenEdges: number[];
  /** 10x packets: the anticipated edges whose change states the detail; null on base and 2x packets. */
  detailEdges: number[] | null;
  /** True when a yes named no change index (anticipated or screen hit). */
  noIndex: boolean;
  /** Audit pass: the quoted change behind each anticipated index. */
  quotes?: string[];
}

/** How a panel cell's anticipated edges were chosen (M11, R2-18). */
export type EdgeSource = "two-vote" | "gemini" | "others";

/** A cell as the reader gives it: one judge's own label, or the panel's. */
export type ReaderCell = LabelCell & { via?: EdgeSource };

/** One judge's answer for one packet after its one resend. */
export interface JudgeLabels {
  packet: string;
  judge: Judge;
  modelId: string;
  version: string | null;
  effort: string;
  cacheKey: string;
  attempts: number;
  /** Cell key to the judge's raw cell, or null when the cell is missing or garbled. */
  cells: Map<string, RawCell | null>;
}

/** A packet's labels: every judge's own, and the reader's cells. */
export interface PacketLabels {
  packet: string;
  judges: JudgeLabels[];
  reader: Map<string, ReaderCell>;
}

export const cellKey = (list: string, item: string): string => list + "|" + item;
