// Copyright (c) 2026 Garry Tan. MIT License.
// The readings' descriptive prints, which decide nothing: PD-1's effect (M14), the arm stops whose attempt held a block
// (plan section 6) and, on a supply stop, the qualified count under both readings of "renders" (PD-10).
import { ITEM_CLASSES } from "../frozen.ts";
import { fixedMatching } from "../score/match.ts";
import type { ItemClass, MatchItem } from "../types.ts";
import type { ArmStopCounts } from "./seams.ts";

/**
 * The credits in one matching that a tie-break decided: credited items for which another maximum matching exists that
 * leaves them uncredited, found by re-running fixedMatching without that item's edges and keeping the same count.
 */
export function tieDecided(items: readonly MatchItem[]): string[] {
  const m = fixedMatching(items);
  return Object.entries(m.assigned)
    .filter(([id, change]) => change !== null && fixedMatching(items.map((it) => (it.id === id ? { ...it, edges: [] } : it))).credited === m.credited)
    .map(([id]) => id);
}

export interface Pd1Instance {
  /** "step 5", "step 6", or a read tier. */
  step: string;
  classOf: Readonly<Record<string, ItemClass>>;
  items: readonly MatchItem[];
}

/** M14: per step and class, the credits and how many a tie-break decided, beside the funnel of items each check removed. */
export function pd1Effect(instances: readonly Pd1Instance[], funnel: Readonly<Record<string, Readonly<Partial<Record<ItemClass, number>>>>>): string[] {
  const steps = [...new Set([...instances.map((i) => i.step), ...Object.keys(funnel)])];
  const lines: string[] = [];
  for (const step of steps) {
    const credits = new Map<ItemClass, number>(), tied = new Map<ItemClass, number>();
    for (const inst of instances.filter((i) => i.step === step)) {
      const m = fixedMatching(inst.items);
      const t = new Set(tieDecided(inst.items));
      for (const [id, change] of Object.entries(m.assigned)) {
        if (change === null) continue;
        const cls = inst.classOf[id];
        if (!cls) throw new Error("item " + id + " has no class");
        credits.set(cls, (credits.get(cls) ?? 0) + 1);
        if (t.has(id)) tied.set(cls, (tied.get(cls) ?? 0) + 1);
      }
    }
    for (const cls of ITEM_CLASSES) lines.push("PD-1 effect, " + step + ", class " + cls + ": " + (credits.get(cls) ?? 0) + " credits, " + (tied.get(cls) ?? 0) + " decided by a tie-break; removed by the check: " + (funnel[step]?.[cls] ?? 0));
  }
  return lines;
}

/** Beside the sensitivity read: per arm and model, the arm stops whose attempt held a block before it stopped. */
export function armStopsHeldBlock(counts: ArmStopCounts): string[] {
  return counts().map((c) => "arm stops holding a block, " + c.model + " " + c.arm + ": " + c.heldBlock + " of " + c.armStops + " (descriptive; decides nothing)");
}

/** On a supply stop: the qualified count under the strict reading of "renders" and under the HTTP 200 reading. */
export function rendersOnSupplyStop(q: { strict: number; http200: number }, needed: number): string {
  return "supply stop: " + q.strict + " base apps qualify under the strict reading of renders and " + q.http200 + " under the HTTP 200 reading; " + needed + " are needed";
}
