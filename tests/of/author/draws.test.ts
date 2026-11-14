// Value: protects=section 3's draw positions: the frozen mix in seeded order, the Sol and Argon alternation, the pilot and the seeded fact order.
import { describe, expect, test } from "bun:test";
import { authorOf, factOrder, pilot, schedule } from "../../../lanes/office-hours-founder/author/draws.ts";
import { FIXTURE } from "../../../lanes/office-hours-founder/author/fixtures.ts";

describe("schedule", () => {
  const all = schedule(240);
  test("Sol writes odd positions and Argon even ones", () => {
    expect(all.every((d) => d.author === (d.draw % 2 ? "sol" : "argon"))).toBe(true);
    expect([authorOf(1), authorOf(2)]).toEqual(["sol", "argon"]);
  });
  test("any prefix is the same whatever the length", () => {
    expect(schedule(37)).toEqual(all.slice(0, 37));
  });
  test("each round of six holds every shape once, and s2 and s6 take only consumer and marketplace", () => {
    for (let k = 0; k < 240; k += 6) expect(new Set(all.slice(k, k + 6).map((d) => d.shape)).size).toBe(6);
    expect(all.filter((d) => d.shape === "s2" || d.shape === "s6").every((d) => d.type === "consumer" || d.type === "marketplace")).toBe(true);
  });
  test("the pilot is the first position of each named type", () => {
    const p = pilot(all);
    expect(p.map((d) => d.type).sort()).toEqual(["B2B", "consumer", "developer tools", "marketplace"]);
    for (const d of p) expect(all.find((x) => x.type === d.type)!.draw).toBe(d.draw);
  });
});

describe("factOrder", () => {
  test("is seeded per unit and keeps every fact", () => {
    const a = factOrder("c1", FIXTURE.sheet.facts), b = factOrder("c2", FIXTURE.sheet.facts);
    expect(a.map((f) => f.id).sort()).toEqual(FIXTURE.sheet.facts.map((f) => f.id).sort());
    expect(factOrder("c1", [...FIXTURE.sheet.facts].reverse())).toEqual(a);
    expect(a).not.toEqual(b);
  });
});
