// Copyright (c) 2026 Garry Tan. MIT License.
// The extension's session plan (post sections 5 and 11): one part's units in run order, each unit's arms shuffled, from
// the extension's order_seed. The run order of units is itself seeded, so part S's interim look (its first half in this
// order) mixes units of every kind and month. Each part and stage has its own seededRandom stream.
import { seededRandom } from "../../../../src/runner/stats/paired.ts";
import { h2hFail } from "../prereg.ts";
import type { Entry, H2hUnit, Stage, UnitKind } from "../types.ts";
import { entryOf } from "../sessions/turns.ts";
import { extArmsFor, extItemOf, PARTS, readExtPrereg, type ExtArm, type ExtPrereg, type Part } from "./prereg.ts";

const STAGE_N: Record<Stage, number> = { stage0: 0, stage1: 1, stage2: 2 };

export interface ExtPlanned { part: Part; unit: string; kind: UnitKind; entry: Entry; stage: Stage; index: number; arm: ExtArm; item: string }
export interface ExtPlan { schema: "h2hx-plan.v1"; part: Part; stage: Stage; order_seed: number; units: string[]; sessions: ExtPlanned[] }

const shuffle = <T>(a: T[], rand: () => number): T[] => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

/** One part's stage: the units, first put in their frozen draw order (kind, then draw position, then id) so the order a
 *  units file lists them in never matters, shuffled into run order, then each unit's arms shuffled, all from one
 *  seededRandom(order_seed + 10 * part index + stage number) stream. A listed-twice unit, a B1 unit or a non-O unit in
 *  part L is refused. */
export function planExtStage(part: Part, units: Pick<H2hUnit, "id" | "kind" | "entry" | "position">[], stage: Stage, x: ExtPrereg = readExtPrereg()): ExtPlan {
  if (!PARTS.includes(part)) h2hFail("E_H2HX_INPUT", "part " + part + " is not S, P or L");
  if (!Object.hasOwn(STAGE_N, stage)) h2hFail("E_H2HX_INPUT", "stage " + stage + " is not stage0, stage1 or stage2");
  const seen = new Set<string>();
  for (const u of units) {
    if (seen.has(u.id)) h2hFail("E_H2HX_INPUT", "unit " + u.id + " is listed twice");
    seen.add(u.id);
  }
  const rand = seededRandom(x.order_seed + 10 * PARTS.indexOf(part) + STAGE_N[stage]);
  const order = shuffle([...units].sort((a, b) => a.kind.localeCompare(b.kind) || a.position - b.position || a.id.localeCompare(b.id)), rand);
  const sessions: ExtPlanned[] = [];
  for (const u of order) {
    for (const arm of shuffle(extArmsFor(part, u.kind, x), rand)) {
      sessions.push({ part, unit: u.id, kind: u.kind, entry: entryOf(u), stage, index: sessions.length, arm, item: extItemOf(stage, arm, x) });
    }
  }
  return { schema: "h2hx-plan.v1", part, stage, order_seed: x.order_seed, units: order.map((u) => u.id), sessions };
}
