// Value: protects=the second attempt's slot set (its section 4) and draw sequence (section 5.1) over the first attempt's seeded schedule: the full 76 slots unchanged, the 68 kept slots field for field, four founder slots a type, anti-pattern coverage, author family by slot and number, and draw numbers clear of the first attempt's.
import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { BUILDER_GOALS, DROPPED_SLOTS, PAIRED_TYPES, QUOTA, REUSED_SLOTS, UNPAIRED_TYPES } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { ANTI_PATTERNS, SKINS } from "../../../lanes/office-hours-rewrite/author/prompts.ts";
import { drawOf, factOrder, familyOf, fullSchedule, schedule } from "../../../lanes/office-hours-rewrite/author/draws.ts";

const full = fullSchedule();
const slots = schedule();
const briefs = (s: (typeof slots)[number]) => (s.kind === "pair" ? 2 : 1);
/** sha256 of the first attempt's 76 slots as main's draws.ts computed them at 70615fd7, before slots carried p. */
const ATTEMPT_1_SCHEDULE = "7a17446652a056bad3b843fde8b9e5cc679f0f3160d774ca4e930a888aceb87b";
const coverage = (kept: readonly (typeof full)[number][]) => {
  const used = new Set(kept.filter((s) => s.set === "comparison").map((s) => s.anti_pattern));
  return ANTI_PATTERNS.filter((a) => !used.has(a.id)).map((a) => a.id);
};

describe("the first attempt's schedule, computed in full", () => {
  test("is the first attempt's 76 slots field for field, each carrying its seeded position", () => {
    expect(full).toHaveLength(76);
    expect(createHash("sha256").update(JSON.stringify(full.map(({ p: _p, ...s }) => s))).digest("hex")).toBe(ATTEMPT_1_SCHEDULE);
    expect(full.map((s) => s.p)).toEqual(full.map((_, i) => i));
  });
  test("each of its five comparison skins is the eight founder types: 14 briefs in 8 opening clusters", () => {
    for (let skin = 1; skin <= 5; skin++) {
      const f = full.filter((s) => s.set === "comparison" && s.skin === skin && s.kind !== "builder");
      expect(f.map((s) => s.type).sort()).toEqual(["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]);
      expect(f.reduce((n, s) => n + briefs(s), 0)).toBe(14);
      for (const s of f) expect(s.kind).toBe(PAIRED_TYPES.includes(s.type as never) ? "pair" : "founder");
      expect(new Set(f.map((s) => s.voice)).size).toBe(1);
      expect(f.every((s) => s.industry === SKINS[skin]!.industries[s.type as "T1"])).toBe(true);
    }
  });
  test("is seeded: the same order every call, and not the construction order", () => {
    expect(fullSchedule().map((s) => s.slot)).toEqual(full.map((s) => s.slot));
    expect(full.slice(0, 8).every((s) => s.set === "comparison" && s.skin === 1)).toBe(false);
    expect(new Set(full.map((s) => s.slot)).size).toBe(full.length);
  });
});

describe("the second attempt's slots", () => {
  test("are the full schedule less the dropped 8, in seeded order, every kept slot equal to the first attempt's field for field", () => {
    expect(slots).toHaveLength(68);
    expect(slots).toEqual(full.filter((s) => !DROPPED_SLOTS.includes(s.slot)));
    expect(full.filter((s) => DROPPED_SLOTS.includes(s.slot)).map((s) => s.slot).sort()).toEqual([...DROPPED_SLOTS].sort());
    expect(slots.filter((s) => REUSED_SLOTS.includes(s.slot))).toHaveLength(REUSED_SLOTS.length);
  });
  test("hold 28 pair slots and 40 unpaired slots, 96 briefs", () => {
    expect(slots.filter((s) => s.kind === "pair")).toHaveLength(QUOTA.pairs);
    expect(slots.filter((s) => s.kind !== "pair")).toHaveLength(QUOTA.unpaired);
    expect(slots.reduce((n, s) => n + briefs(s), 0)).toBe(96);
  });
  test("the comparison set holds 4 founder slots a type: 24 pairs and 8 unpaired, 56 founder briefs in 32 clusters", () => {
    const f = slots.filter((s) => s.set === "comparison" && s.kind !== "builder");
    for (const t of [...PAIRED_TYPES, ...UNPAIRED_TYPES]) expect(f.filter((s) => s.type === t)).toHaveLength(4);
    expect(f).toHaveLength(32);
    expect(f.reduce((n, s) => n + briefs(s), 0)).toBe(QUOTA.founder);
  });
  test("every one of the 21 anti-patterns sits on a kept comparison opening; builders carry none", () => {
    expect(ANTI_PATTERNS).toHaveLength(21);
    expect(coverage(slots)).toEqual([]);
    expect(slots.filter((s) => s.kind === "builder").every((s) => s.anti_pattern === null)).toBe(true);
    expect(slots.filter((s) => s.kind !== "builder").every((s) => s.anti_pattern !== null)).toBe(true);
  });
  test("dropping skin 1's T8 slot instead of skin 5's would leave an anti-pattern on no comparison opening", () => {
    const other = [...DROPPED_SLOTS.filter((s) => s !== "com5-T8"), "com1-T8"];
    expect(coverage(full.filter((s) => !other.includes(s.slot))).length).toBeGreaterThan(0);
  });
  test("24 builder briefs spread over the five goals and five skins, no goal and skin twice", () => {
    const b = slots.filter((s) => s.set === "comparison" && s.kind === "builder");
    expect(b).toHaveLength(QUOTA.builder);
    expect(BUILDER_GOALS.map((g) => b.filter((s) => s.type === g).length).sort()).toEqual([4, 5, 5, 5, 5]);
    expect(new Set(b.map((s) => s.type + " " + s.skin)).size).toBe(24);
  });
  test("calibration and reserves: two pairs, two unpaired founders and two builders each, skin 0", () => {
    for (const set of ["calibration", "reserve"] as const) {
      const s = slots.filter((x) => x.set === set);
      expect(s.filter((x) => x.kind === "pair")).toHaveLength(2);
      expect(s.filter((x) => x.kind === "founder").map((x) => x.type).sort()).toEqual(["T7", "T8"]);
      expect(s.filter((x) => x.kind === "builder")).toHaveLength(2);
      expect(s.every((x) => x.skin === 0)).toBe(true);
      expect(s.reduce((n, x) => n + briefs(x), 0)).toBe(set === "calibration" ? QUOTA.calibration : QUOTA.reserve);
    }
  });
});

describe("draws, authors and fact order", () => {
  test("a slot's k-th draft is draw 1000 * (p + 1) + k, unique across slots and above every first-attempt draw", () => {
    expect(drawOf(0, 1)).toBe(1001);
    expect(drawOf(74, 3)).toBe(75003);
    const draws = slots.flatMap((s) => [1, 2, 3, 999].map((k) => drawOf(s.p, k)));
    expect(new Set(draws).size).toBe(draws.length);
    expect(Math.min(...draws)).toBeGreaterThan(1000);
  });
  test("Sol writes when p + k is odd and Argon when it is even", () => {
    expect([familyOf(0, 1), familyOf(0, 2), familyOf(1, 1), familyOf(1, 2), familyOf(10, 3)]).toEqual(["sol", "argon", "argon", "sol", "sol"]);
  });
  test("facts reach validators in a seeded order per brief", () => {
    const facts = ["F1", "F2", "F3", "F4", "F5"].map((id) => ({ id, text: id, reveal_when: "x", kind: "other" as const }));
    const a = factOrder("d1a", facts).map((f) => f.id);
    expect(factOrder("d1a", facts).map((f) => f.id)).toEqual(a);
    expect([...a].sort()).toEqual(["F1", "F2", "F3", "F4", "F5"]);
    expect(factOrder("d2a", facts).map((f) => f.id)).not.toEqual(a);
  });
});
