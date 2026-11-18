// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's authoring schedule (prereg section 3, "Founder types", "Builder briefs" and
// "Calibration and reserves"; pre-run change 1 item 5's one seed). It fixes 76 slots before any brief exists, each with
// its frozen inputs: the set, the skin, the kind (a matched pair, an unpaired founder or a builder), the type or goal,
// the industry or project domain, the voice, the opening's founder anti-pattern and, on a pair, which side of the hidden
// contrast the first twin takes. The comparison set is five skins of the eight founder types (T1 to T6 as pairs, T7 and
// T8 unpaired) plus 24 builders, one per goal and skin but one; calibration and reserves are two pairs, T7, T8 and two
// builders each. Anti-patterns go round a seeded order of the list over the comparison openings first, so each appears in
// at least one. The slots run in one seeded order (seed 20261117).
// The second attempt (its sections 4 and 5.1) computes that schedule in full, so every slot keeps its inputs, and drops 8
// comparison founder slots (frozen.DROPPED_SLOTS); each kept slot carries its seeded position p in the full list. A
// slot's drafts follow a fixed sequence: its k-th first-twin or unpaired draft is draw 1000 * (p + 1) + k, so a draw
// depends only on the slot and its numbers and never on concurrency or a restart, and stays clear of the first
// attempt's draws, which never reached 1000. Sol writes it when p + k is odd and Argon when it is even; a second twin
// comes from its partner's family.
import { seededRandom, shuffle } from "../../product-value/stats.ts";
import { authorOf, otherFamily, modelOf } from "../../office-hours-founder/author/draws.ts";
import { sha256 } from "../../office-hours-founder/author/files.ts";
import { BUILDER_GOALS, DROPPED_SLOTS, PAIRED_TYPES, SEED, UNPAIRED_TYPES } from "../frozen.ts";
import type { AuthorFamily, BuilderGoal, Fact, FounderType, SetName } from "../types.ts";
import { ANTI_PATTERNS, SKINS } from "./prompts.ts";

export { authorOf, otherFamily, modelOf };

export type SlotKind = "pair" | "founder" | "builder";

export interface Slot {
  /** Stable slot id: set, skin and type. */
  slot: string;
  set: SetName;
  /** 1 to 5 in the comparison set, 0 in calibration and reserves (BriefMeta.skin). */
  skin: number;
  /** The SKINS entry the slot reads its voice and industry from. */
  skinIndex: number;
  kind: SlotKind;
  type: FounderType | BuilderGoal;
  industry: string;
  voice: string;
  anti_pattern: string | null;
  /** The first twin's side of the hidden contrast (pairs only; 0 otherwise). */
  side: 0 | 1;
  /** The slot's 0-based position in the first attempt's full seeded list of 76. */
  p: number;
}

const RESERVE_SKIN = 6;

/** The first attempt's 76 slots in seeded draw order. */
export function fullSchedule(): Slot[] {
  const rng = seededRandom(SEED);
  const out: Omit<Slot, "anti_pattern" | "side" | "p">[] = [];
  const add = (set: SetName, skin: number, skinIndex: number, type: FounderType | BuilderGoal) => {
    const kind: SlotKind = (BUILDER_GOALS as readonly string[]).includes(type) ? "builder" : (PAIRED_TYPES as readonly string[]).includes(type) ? "pair" : "founder";
    const s = SKINS[skinIndex]!;
    out.push({ slot: set.slice(0, 3) + skin + "-" + type, set, skin, skinIndex, kind, type, industry: kind === "builder" ? s.domains[type as BuilderGoal] : s.industries[type as FounderType], voice: s.voice });
  };
  for (let skin = 1; skin <= 5; skin++) for (const t of [...PAIRED_TYPES, ...UNPAIRED_TYPES]) add("comparison", skin, skin, t);
  const combos = shuffle(Array.from({ length: 5 }, (_, s) => BUILDER_GOALS.map((g) => ({ skin: s + 1, goal: g }))).flat(), rng).slice(0, 24);
  for (const c of combos) add("comparison", c.skin, c.skin, c.goal);
  const pairTypes = shuffle(PAIRED_TYPES, rng), goals = shuffle(BUILDER_GOALS, rng);
  for (const [set, skinIndex, k] of [["calibration", 0, 0], ["reserve", RESERVE_SKIN, 2]] as const) {
    for (const t of [...pairTypes.slice(k, k + 2), ...UNPAIRED_TYPES, ...goals.slice(k, k + 2)]) add(set, 0, skinIndex, t);
  }
  const patterns = shuffle(ANTI_PATTERNS.map((a) => a.id), rng);
  const founders = [...shuffle(out.filter((s) => s.set === "comparison" && s.kind !== "builder"), rng), ...out.filter((s) => s.set !== "comparison" && s.kind !== "builder")];
  const pattern = new Map(founders.map((s, k) => [s.slot, patterns[k % patterns.length]!]));
  return shuffle(out, rng).map((s, p) => ({ ...s, anti_pattern: pattern.get(s.slot) ?? null, side: s.kind === "pair" && rng() < 0.5 ? 1 : 0, p }));
}

/** The second attempt's 68 slots: the full schedule less the dropped 8, in the same order. */
export const schedule = (): Slot[] => fullSchedule().filter((s) => !DROPPED_SLOTS.includes(s.slot));

/** A slot's k-th first-twin or unpaired draft's draw number. */
export const drawOf = (p: number, k: number): number => 1000 * (p + 1) + k;
/** Who writes a slot's k-th first-twin or unpaired draft. */
export const familyOf = (p: number, k: number): AuthorFamily => ((p + k) % 2 === 1 ? "sol" : "argon");

/** A brief's facts in its seeded order: sorted by sha256 of the seed, the brief id and the fact id. */
export const factOrder = (brief: string, facts: readonly Fact[]): Fact[] => [...facts].sort((a, b) => (sha256(SEED + "\n" + brief + "\n" + a.id) < sha256(SEED + "\n" + brief + "\n" + b.id) ? -1 : 1));
