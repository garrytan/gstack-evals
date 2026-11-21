// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 2's preregistered half (pre-run change 3 to the second attempt, part B, rule R113). Stage 2 on Opus 5.5 and Sol
// is planned above $500 paid, so it takes one interim look at half its units. The half is 16 of the 32 founder opening
// clusters with every brief in them, and 12 of the 24 builder briefs, on every arm and both models:
// - founder clusters are listed type by type (T1 to T8), each type's clusters in an order shuffled with frozen.SEED, and
//   every second cluster of that list, starting with the first, is in the half; so the half holds two of each type's
//   four clusters, and both twins of a pair sit in the same half;
// - builder briefs are listed goal by goal (frozen.BUILDER_GOALS) the same way, from the same stream, and every second
//   one is in the half: 12 of 24, two or three of each goal.
// The first part of stage 2 freezes this split into its manifest before any stage 2 session runs, and the interim read
// and the second part take it from there, so a reserve that later replaces a second-half brief cannot move it.
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import { shuffle } from "../../product-value/stats.ts";
import { BUILDER_GOALS, PAIRED_TYPES, SEED, UNPAIRED_TYPES } from "../frozen.ts";
import type { BriefMeta } from "../types.ts";

/** One part of stage 2's comparison set: its founder and builder brief ids, and how many founder clusters they make. */
export interface HalfPart {
  founder: string[];
  builder: string[];
  clusters: number;
}
export interface Half {
  first: HalfPart;
  second: HalfPart;
}

/** What the interim read decided (read/look.ts): run the second half, stop for a difference either way, or stop for futility. */
export type Action = "continue" | "stop-new" | "stop-current" | "stop-futility";

/** A stage 2 launch's part: the half, or the second part after the interim read that allows it. */
export type ManifestLook = { part: "first" } | { part: "second"; half: Half; action: Action; interim_sha256: string };

const everySecond = (groups: readonly string[][], rng: () => number) => {
  const order = groups.flatMap((g) => shuffle([...g].sort(), rng));
  return { first: order.filter((_, i) => i % 2 === 0), second: order.filter((_, i) => i % 2 === 1) };
};

/** The seeded, balanced half of the comparison briefs ids names. */
export function stage2Half(briefs: readonly BriefMeta[], ids: readonly string[]): Half {
  const set = briefs.filter((b) => ids.includes(b.id));
  if (set.length !== ids.length) throw new Error("E_OHR_MANIFEST the half's comparison set names " + ids.length + " briefs and the briefs dir holds " + set.length + " of them");
  const rng = seededRandom(SEED);
  const founders = set.filter((b) => b.kind === "founder");
  const clusters = everySecond([...PAIRED_TYPES, ...UNPAIRED_TYPES].map((t) => [...new Set(founders.filter((b) => b.type === t).map((b) => b.cluster))]), rng);
  const builders = everySecond(BUILDER_GOALS.map((g) => set.filter((b) => b.kind === "builder" && b.type === g).map((b) => b.id)), rng);
  const part = (cs: string[], bs: string[]): HalfPart => ({ founder: founders.filter((b) => cs.includes(b.cluster)).map((b) => b.id).sort(), builder: [...bs].sort(), clusters: cs.length });
  const half = { first: part(clusters.first, builders.first), second: part(clusters.second, builders.second) };
  const placed = half.first.founder.length + half.first.builder.length + half.second.founder.length + half.second.builder.length;
  if (placed !== set.length) throw new Error("E_OHR_MANIFEST the half placed " + placed + " of " + set.length + " comparison briefs; every founder brief needs a type T1 to T8 and every builder brief a goal");
  return half;
}
