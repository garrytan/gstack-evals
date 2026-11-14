// Copyright (c) 2026 Garry Tan. MIT License.
// fixedMatching, the one matcher behind every credit in the lane (build plan section 3, M1 to M5): it enumerates
// every partial one-to-one assignment of items to changes and keeps the best by M3's four keys, so its answer never
// depends on the order of its inputs.
import { fail } from "../errors.ts";
import { MATCH_LIMITS, MATCH_SCORE } from "../frozen.ts";
import type { Matching, MatchItem } from "../types.ts";

interface Canonical {
  id: string;
  keyedDetail: boolean;
  /** Distinct change indices, ascending. */
  changes: number[];
  /** The changes among them that carry the item's detail. */
  detail: Set<number>;
}

/** M2: items by id, edges deduplicated (a change carries the detail when any copy of its edge says so) and sorted. */
export function canonicalize(items: readonly MatchItem[]): Canonical[] {
  if (items.length > MATCH_LIMITS.maxItems) fail("E_USAGE", "fixedMatching takes at most " + MATCH_LIMITS.maxItems + " items, got " + items.length);
  const ids = new Set<string>();
  const out: Canonical[] = [];
  for (const item of items) {
    if (!item.id || ids.has(item.id)) fail("E_USAGE", "fixedMatching needs distinct non-empty item ids, got " + JSON.stringify(item.id));
    ids.add(item.id);
    const detail = new Set<number>();
    const changes = new Set<number>();
    for (const e of item.edges) {
      if (!Number.isInteger(e.change) || e.change < 1 || e.change > MATCH_LIMITS.maxChanges) fail("E_USAGE", "item " + item.id + " names change " + e.change + "; changes are 1 to " + MATCH_LIMITS.maxChanges);
      changes.add(e.change);
      if (e.detail) detail.add(e.change);
    }
    out.push({ id: item.id, keyedDetail: item.keyedDetail, changes: [...changes].sort((a, b) => a - b), detail });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** M3: the most items credited, then the highest score, then the most details carried, then the lowest index vector. */
export function fixedMatching(items: readonly MatchItem[]): Matching {
  const c = canonicalize(items);
  const none = MATCH_LIMITS.maxChanges + 1;
  const pick: number[] = c.map(() => none);
  const used = new Array<boolean>(none + 1).fill(false);
  let best: { pick: number[]; credited: number; score: number; detailCredited: number } | null = null;

  const consider = () => {
    let credited = 0;
    let score = 0;
    let detailCredited = 0;
    for (let i = 0; i < c.length; i++) {
      if (pick[i] === none) continue;
      credited++;
      if (!c[i]!.keyedDetail) score += MATCH_SCORE.credited;
      else if (c[i]!.detail.has(pick[i]!)) {
        score += MATCH_SCORE.detailCarried;
        detailCredited++;
      } else score += MATCH_SCORE.detailMissing;
    }
    if (best && !better(credited, score, detailCredited, pick, best)) return;
    best = { pick: [...pick], credited, score, detailCredited };
  };

  const visit = (i: number) => {
    if (i === c.length) return consider();
    pick[i] = none;
    visit(i + 1);
    for (const change of c[i]!.changes) {
      if (used[change]) continue;
      used[change] = true;
      pick[i] = change;
      visit(i + 1);
      used[change] = false;
    }
    pick[i] = none;
  };
  visit(0);

  const b = best!;
  const assigned: Record<string, number | null> = {};
  c.forEach((item, i) => (assigned[item.id] = b.pick[i] === none ? null : b.pick[i]!));
  return { assigned, credited: b.credited, score: b.score, detailCredited: b.detailCredited };
}

function better(credited: number, score: number, detailCredited: number, pick: number[], best: { pick: number[]; credited: number; score: number; detailCredited: number }): boolean {
  if (credited !== best.credited) return credited > best.credited;
  if (score !== best.score) return score > best.score;
  if (detailCredited !== best.detailCredited) return detailCredited > best.detailCredited;
  for (let i = 0; i < pick.length; i++) if (pick[i] !== best.pick[i]) return pick[i]! < best.pick[i]!;
  return false;
}
