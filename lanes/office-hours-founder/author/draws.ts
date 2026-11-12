// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's draw positions (prereg section 3): each position's story shape, type and industry,
// fixed in seeded order (seed 20261109) before any unit exists, and who writes it (GPT-6.1 Sol at odd positions, Gemini
// 4 Argon at even ones). The schedule runs in rounds: each round takes the six shapes in a seeded order, and each shape
// takes the next pair from its own seeded list of the types it allows (s2 and s6 only consumer and marketplace) crossed
// with the 24 industries. So every shape holds a sixth of the positions and any prefix of the schedule is the same
// whatever its length. The pilot is the first position of each named type. Facts reach the validators in a seeded order
// per unit: sorted by sha256 of the seed, the unit id and the fact id.
import { SEED } from "../frozen.ts";
import { seededRandom, shuffle } from "../../product-value/stats.ts";
import type { AuthorFamily, Fact, Shape } from "../types.ts";
import { sha256 } from "./files.ts";
import { INDUSTRIES, NAMED_TYPES, SHAPE_TYPES, SHAPES, type NamedType } from "./prompts.ts";

export interface Draw {
  /** 1-based draw position. */
  draw: number;
  shape: Shape;
  type: NamedType;
  industry: string;
  author: AuthorFamily;
}

/** Sol writes odd draw positions and Argon even ones; the real stratum's T1 alternates the same way in its seeded order. */
export const authorOf = (draw: number): AuthorFamily => (draw % 2 === 1 ? "sol" : "argon");
export const otherFamily = (f: AuthorFamily): AuthorFamily => (f === "sol" ? "argon" : "sol");
/** The meter's model key for an author family. */
export const modelOf = (f: AuthorFamily) => (f === "sol" ? "sol" : "gemini") as const;

/** The first n draw positions. */
export function schedule(n: number): Draw[] {
  const rng = seededRandom(SEED);
  const shapes = Object.keys(SHAPES) as Shape[];
  const lists = Object.fromEntries(shapes.map((s) => [s, shuffle(SHAPE_TYPES[s].flatMap((type) => INDUSTRIES.map((industry) => ({ type, industry }))), rng)])) as Record<Shape, { type: NamedType; industry: string }[]>;
  const used = Object.fromEntries(shapes.map((s) => [s, 0])) as Record<Shape, number>;
  const out: Draw[] = [];
  while (out.length < n) {
    for (const shape of shuffle(shapes, rng)) {
      if (out.length >= n) break;
      const pick = lists[shape][used[shape]++ % lists[shape].length]!;
      out.push({ draw: out.length + 1, shape, ...pick, author: authorOf(out.length + 1) });
    }
  }
  return out;
}

/** The 4-unit pilot: the first draw position of each named type. */
export const pilot = (draws: readonly Draw[]): Draw[] => NAMED_TYPES.map((t) => draws.find((d) => d.type === t)!).sort((a, b) => a.draw - b.draw);

/** The facts in the unit's seeded order. */
export const factOrder = (unit: string, facts: readonly Fact[]): Fact[] => [...facts].sort((a, b) => (sha256(SEED + "\n" + unit + "\n" + a.id) < sha256(SEED + "\n" + unit + "\n" + b.id) ? -1 : 1));
