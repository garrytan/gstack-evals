// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's sets (prereg section 3, "Calibration and reserves" and "Unanimous key"), pure
// functions over placed briefs:
// - placeSets: each placed slot's briefs go to the slot's set (calibration, comparison by skin, or reserve) in draw
//   order; a pair is placed only with both twins, so sets hold pairs whole.
// - replaceDropped: a comparison brief that drops before any stage 2 session runs on it is replaced by the first reserve
//   of the same kind in draw order (a pair by a pair, both twins together, an unpaired founder by an unpaired founder, a
//   builder by a builder). A dropped twin takes its partner out with it. The reserve takes the dropped brief's skin.
// - setRecord: a set's size, make-up and digest, safe to print.
import { sha256 } from "../../office-hours-founder/author/files.ts";
import type { BriefMeta, SetName } from "../types.ts";
import type { SlotKind } from "./draws.ts";

export interface Member {
  id: string;
  slot: string;
  set: SetName;
  kind: SlotKind;
  type: BriefMeta["type"];
  skin: number;
  cluster: string;
  draw: number;
  twin: string | null;
  digest: string;
  pilot: boolean;
}

export type Sets = Record<SetName, Member[]>;

const order = (a: Member, b: Member) => a.draw - b.draw || (a.id < b.id ? -1 : 1);

export function placeSets(members: readonly Member[]): Sets {
  const ids = new Set(members.map((m) => m.id));
  const whole = members.filter((m) => m.twin === null || ids.has(m.twin));
  const of = (set: SetName) => whole.filter((m) => m.set === set).sort(order);
  return { calibration: of("calibration"), comparison: of("comparison"), reserve: of("reserve") };
}

/** Replaces a dropped comparison brief (and its twin) with the first reserve of its kind; replaced is null when nothing changed. */
export function replaceDropped(s: Sets, dropped: string, ranStage2: ReadonlySet<string>): { sets: Sets; replaced: string[] | null; removed: string[] } {
  const m = s.comparison.find((x) => x.id === dropped);
  if (!m) return { sets: s, replaced: null, removed: [] };
  const out = s.comparison.filter((x) => x.cluster === m.cluster);
  if (out.some((x) => ranStage2.has(x.id))) return { sets: s, replaced: null, removed: [] };
  const first = s.reserve.find((x) => x.kind === m.kind);
  const promoted = first ? s.reserve.filter((x) => x.cluster === first.cluster) : [];
  const comparison = [...s.comparison.filter((x) => x.cluster !== m.cluster), ...promoted.map((x) => ({ ...x, set: "comparison" as const, skin: m.skin }))].sort(order);
  return { sets: { ...s, comparison, reserve: s.reserve.filter((x) => !promoted.includes(x)) }, replaced: first ? promoted.map((x) => x.id) : null, removed: out.map((x) => x.id) };
}

const tally = (ms: readonly Member[], of: (m: Member) => string) => Object.fromEntries([...new Set(ms.map(of))].sort().map((k) => [k, ms.filter((m) => of(m) === k).length]));

/** A set's size, make-up and digest: sha256 over "id digest" lines in draw order. */
export const setRecord = (ms: readonly Member[]) => ({
  size: ms.length,
  clusters: new Set(ms.map((m) => m.cluster)).size,
  kinds: tally(ms, (m) => m.kind),
  types: tally(ms, (m) => String(m.type)),
  skins: tally(ms, (m) => String(m.skin)),
  pilot: ms.filter((m) => m.pilot).length,
  digest: sha256([...ms].sort(order).map((m) => m.id + " " + m.digest).join("\n") + "\n"),
});
