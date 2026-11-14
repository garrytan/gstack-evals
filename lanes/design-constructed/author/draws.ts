// Copyright (c) 2026 Garry Tan. MIT License.
// K9, draw positions (prereg section 3, frozen): position p (from 1) on N kept base apps takes app index
// a = (p - 1) mod N and round r = floor((p - 1) / N), the change kind at index (floor(a / 2) + r) mod 6 of the kind
// order, and GPT-6.1 Sol as author when a + r is even, Gemini 4 Argon when odd. The kind order is the repository's
// seeded Fisher-Yates (src/runner/stats/paired.ts's PRNG) over k1 to k6 with seed 20261114. The pilot is positions
// 1 to 4 and N + 1 to N + 4: the first 4 base apps, 2 units each, which covers kind indices 0 to 2 only.
import { AUTHORING, CHANGE_KINDS, SEED } from "../frozen.ts";
import type { AuthorFamily, ChangeKind } from "../types.ts";
import { seededShuffle } from "./unit.ts";

export const KINDS = Object.keys(CHANGE_KINDS) as ChangeKind[];

export const kindOrder = (): ChangeKind[] => seededShuffle(KINDS, SEED);

export interface Draw {
  position: number;
  /** The base app's index in frame order, from 0. */
  app: number;
  round: number;
  kind: ChangeKind;
  /** The kind's index in the shuffled order. */
  kindIndex: number;
  author: AuthorFamily;
}

export function draw(position: number, apps: number): Draw {
  if (!Number.isInteger(position) || position < 1 || !Number.isInteger(apps) || apps < 1) throw new Error("draw needs a position from 1 and at least one base app");
  const a = (position - 1) % apps;
  const r = Math.floor((position - 1) / apps);
  const kindIndex = (Math.floor(a / 2) + r) % KINDS.length;
  return { position, app: a, round: r, kind: kindOrder()[kindIndex]!, kindIndex, author: (a + r) % 2 === 0 ? AUTHORING.authorWhenEven : AUTHORING.authorWhenOdd };
}

export const drawsUpTo = (count: number, apps: number): Draw[] => Array.from({ length: count }, (_, i) => draw(i + 1, apps));

/** The 8 pilot positions: 1 to 4 and N + 1 to N + 4. */
export const pilotPositions = (apps: number): number[] => [1, 2, 3, 4].flatMap((p) => [p, apps + p]).sort((x, y) => x - y);

/**
 * The frozen draw rule's two promises at N base apps: every app gets both author families over the first 2N positions,
 * and once N is at least 12 each family gets all six kinds in every round (checked over the first six rounds). Null
 * when both hold, else why not.
 */
export function drawRuleProblems(apps: number): string | null {
  const ds = drawsUpTo(apps * 6, apps);
  for (let a = 0; a < apps; a++) {
    const fams = new Set(ds.filter((d) => d.app === a && d.round < 2).map((d) => d.author));
    if (fams.size !== 2) return "app " + a + " gets " + [...fams].join(",") + " over the first " + 2 * apps + " positions";
  }
  if (apps >= 12)
    for (let r = 0; r < 6; r++)
      for (const f of ["sol", "argon"] as AuthorFamily[]) {
        const kinds = new Set(ds.filter((d) => d.round === r && d.author === f).map((d) => d.kind));
        if (kinds.size !== KINDS.length) return f + " gets " + kinds.size + " kinds in round " + r;
      }
  return null;
}
