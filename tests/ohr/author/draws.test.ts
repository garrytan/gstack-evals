// Value: protects=section 3's schedule: five skins of the eight types, the builder spread, calibration and reserve make-up, seeded order, author alternation and anti-pattern coverage.
import { describe, expect, test } from "bun:test";
import { BUILDER_GOALS, PAIRED_TYPES, QUOTA } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { ANTI_PATTERNS, SKINS } from "../../../lanes/office-hours-rewrite/author/prompts.ts";
import { authorOf, factOrder, schedule } from "../../../lanes/office-hours-rewrite/author/draws.ts";

const slots = schedule();
const briefs = (s: (typeof slots)[number]) => (s.kind === "pair" ? 2 : 1);

describe("the schedule", () => {
  test("holds 34 pair slots and 42 unpaired slots, 110 briefs", () => {
    expect(slots.filter((s) => s.kind === "pair")).toHaveLength(QUOTA.pairs);
    expect(slots.filter((s) => s.kind !== "pair")).toHaveLength(QUOTA.unpaired);
    expect(slots.reduce((n, s) => n + briefs(s), 0)).toBe(110);
  });
  test("each comparison skin is the eight founder types: 14 briefs in 8 opening clusters", () => {
    for (let skin = 1; skin <= QUOTA.skins; skin++) {
      const f = slots.filter((s) => s.set === "comparison" && s.skin === skin && s.kind !== "builder");
      expect(f.map((s) => s.type).sort()).toEqual(["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]);
      expect(f.reduce((n, s) => n + briefs(s), 0)).toBe(14);
      for (const s of f) expect(s.kind).toBe(PAIRED_TYPES.includes(s.type as never) ? "pair" : "founder");
      expect(new Set(f.map((s) => s.voice)).size).toBe(1);
      expect(f.every((s) => s.industry === SKINS[skin]!.industries[s.type as "T1"])).toBe(true);
    }
    const founders = slots.filter((s) => s.set === "comparison" && s.kind !== "builder");
    expect(founders.reduce((n, s) => n + briefs(s), 0)).toBe(QUOTA.founder);
  });
  test("24 builder briefs spread over the five goals and five skins, no goal and skin twice", () => {
    const b = slots.filter((s) => s.set === "comparison" && s.kind === "builder");
    expect(b).toHaveLength(QUOTA.builder);
    const per = BUILDER_GOALS.map((g) => b.filter((s) => s.type === g).length).sort();
    expect(per).toEqual([4, 5, 5, 5, 5]);
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
  test("every anti-pattern the list names appears in at least one comparison opening; builders carry none", () => {
    const used = new Set(slots.filter((s) => s.set === "comparison").map((s) => s.anti_pattern));
    for (const a of ANTI_PATTERNS) expect(used.has(a.id)).toBe(true);
    expect(slots.filter((s) => s.kind === "builder").every((s) => s.anti_pattern === null)).toBe(true);
    expect(slots.filter((s) => s.kind !== "builder").every((s) => s.anti_pattern !== null)).toBe(true);
  });
  test("is seeded: the same order every call, and not the construction order", () => {
    expect(schedule().map((s) => s.slot)).toEqual(slots.map((s) => s.slot));
    expect(slots.slice(0, 8).every((s) => s.set === "comparison" && s.skin === 1)).toBe(false);
    expect(new Set(slots.map((s) => s.slot)).size).toBe(slots.length);
  });
});

describe("authors and fact order", () => {
  test("Sol writes odd draws and Argon even ones", () => {
    expect([1, 2, 3, 4].map(authorOf)).toEqual(["sol", "argon", "sol", "argon"]);
  });
  test("facts reach validators in a seeded order per brief", () => {
    const facts = ["F1", "F2", "F3", "F4", "F5"].map((id) => ({ id, text: id, reveal_when: "x", kind: "other" as const }));
    const a = factOrder("d1a", facts).map((f) => f.id);
    expect(factOrder("d1a", facts).map((f) => f.id)).toEqual(a);
    expect([...a].sort()).toEqual(["F1", "F2", "F3", "F4", "F5"]);
    expect(factOrder("d2a", facts).map((f) => f.id)).not.toEqual(a);
  });
});
