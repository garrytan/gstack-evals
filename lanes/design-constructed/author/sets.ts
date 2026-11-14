// Copyright (c) 2026 Garry Tan. MIT License.
// K11, sets (prereg section 3, "Sets and timing", frozen), as pure functions over passing first-skin units:
// calibration is the first passing unit on each of the first 16 base apps in draw order; comparison is up to 64 of the
// rest in draw order, at most 4 a base app; then 6 reserves in draw order, which that cap doesn't count. A reserve
// replaces a comparison unit only when it dropped before any stage 2 session ran on it: the first reserve in draw order
// on the same base app, else the first on a base app that then holds at most 4 comparison units.
// Adapted from lanes/office-hours-founder/author/sets.ts at 14fbe35b2a3cb6d7477bc1eea4e61577650d4243, with this eval's rules in place of its quotas.
import { SETS } from "../frozen.ts";
import type { AuthorFamily, ChangeKind } from "../types.ts";
import { sha256 } from "./text.ts";

export interface Member {
  id: string;
  position: number;
  /** The base app's index in frame order, from 0. */
  app: number;
  kind: ChangeKind;
  author: AuthorFamily;
  digest: string;
}

export interface Sets {
  calibration: Member[];
  comparison: Member[];
  reserve: Member[];
}

const byPosition = (a: Member, b: Member) => a.position - b.position;

export function fillSets(passed: readonly Member[], size: { comparison: number } = { comparison: SETS.comparison }): Sets {
  const pool = [...passed].sort(byPosition);
  const calibration: Member[] = [];
  for (let app = 0; app < SETS.calibration; app++) {
    const first = pool.find((m) => m.app === app);
    if (first) calibration.push(first);
  }
  const rest = pool.filter((m) => !calibration.includes(m));
  const comparison: Member[] = [];
  const perApp = new Map<number, number>();
  for (const m of rest) {
    if (comparison.length >= size.comparison) break;
    if ((perApp.get(m.app) ?? 0) >= SETS.maxComparisonPerApp) continue;
    comparison.push(m);
    perApp.set(m.app, (perApp.get(m.app) ?? 0) + 1);
  }
  const reserve = rest.filter((m) => !comparison.includes(m)).slice(0, SETS.reserves);
  return { calibration: calibration.sort(byPosition), comparison, reserve };
}

/** K11's replacement. Returns the sets unchanged with the reason when no replacement applies. */
export function replaceDropped(s: Sets, dropped: string, ranStage2: ReadonlySet<string>): { sets: Sets; replacedBy: string | null; reason: string } {
  const gone = s.comparison.find((m) => m.id === dropped);
  if (!gone) return { sets: s, replacedBy: null, reason: dropped + " is not a comparison unit" };
  if (ranStage2.has(dropped)) return { sets: s, replacedBy: null, reason: "a stage 2 session already ran on " + dropped };
  const comparison = s.comparison.filter((m) => m.id !== dropped);
  const count = (app: number) => comparison.filter((m) => m.app === app).length;
  const pick = s.reserve.find((m) => m.app === gone.app) ?? s.reserve.find((m) => count(m.app) + 1 <= SETS.maxComparisonPerApp);
  if (!pick) return { sets: { ...s, comparison }, replacedBy: null, reason: "no reserve fits" };
  return { sets: { ...s, comparison: [...comparison, pick].sort(byPosition), reserve: s.reserve.filter((m) => m !== pick) }, replacedBy: pick.id, reason: pick.app === gone.app ? "the first reserve on the same base app" : "the first reserve on a base app that then holds at most 4" };
}

const tally = <K extends string | number>(ms: readonly Member[], of: (m: Member) => K) => Object.fromEntries([...new Set(ms.map(of))].sort((a, b) => (a < b ? -1 : 1)).map((k) => [String(k), ms.filter((m) => of(m) === k).length]));

/** The comparison set's size, composition and digest (sha256 over "id digest" lines in draw order), fixed before stage 2. */
export const setRecord = (ms: readonly Member[]) => ({
  size: ms.length,
  apps: tally(ms, (m) => m.app),
  kinds: tally(ms, (m) => m.kind),
  authors: tally(ms, (m) => m.author),
  digest: sha256([...ms].sort(byPosition).map((m) => m.id + " " + m.digest).join("\n") + "\n"),
});
