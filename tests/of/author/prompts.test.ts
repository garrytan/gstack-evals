// Value: protects=section 3's frozen authoring text, so every author, twin, probe and real-stratum prompt reaches the models byte for byte as preregistered.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PREREG } from "../../../lanes/office-hours-founder/frozen.ts";
import { AUTHOR_PROMPT, CEILING_LINE, EXCLUDED_HOSTS, INDUSTRIES, NAMED_TERMS, NOTES_PROMPT, PROBE, PROBE_REWRITE, QUERIES, SHAPES, SHAPE_TYPES, T1_PROMPT, T2_PROMPT, TWIN_NOTE, TYPE_PHRASE, authorPrompt } from "../../../lanes/office-hours-founder/author/prompts.ts";

const prereg = readFileSync(PREREG, "utf8");

describe("frozen authoring text", () => {
  test("the four long prompts are the prereg's quoted lines byte for byte", () => {
    for (const p of [AUTHOR_PROMPT, NOTES_PROMPT, T1_PROMPT, T2_PROMPT]) expect(prereg.includes("\n> " + p + "\n")).toBe(true);
  });
  test("the CEILING line, the twin note, the probe and its rewrite line appear quoted", () => {
    for (const s of [CEILING_LINE, TWIN_NOTE, PROBE, PROBE_REWRITE]) expect(prereg.includes('"' + s + '"')).toBe(true);
  });
  test("shapes, type phrases, industries and named terms match the prereg's lists", () => {
    for (const [k, v] of Object.entries(SHAPES)) expect(prereg.includes("- " + k + ": " + v + "\n")).toBe(true);
    for (const v of Object.values(TYPE_PHRASE)) expect(prereg.includes('"' + v + '"')).toBe(true);
    expect(prereg.includes("Industries: " + INDUSTRIES.slice(0, -1).join(", ") + " and " + INDUSTRIES.at(-1) + ".")).toBe(true);
    expect(INDUSTRIES).toHaveLength(24);
    expect(prereg.includes(NAMED_TERMS.slice(0, -1).map((t) => '"' + t + '"').join(", ") + ' and "' + NAMED_TERMS.at(-1) + '"')).toBe(true);
    expect(SHAPE_TYPES.s2).toEqual(["consumer", "marketplace"]);
    expect(SHAPE_TYPES.s6).toEqual(["consumer", "marketplace"]);
  });
  test("the 40 queries and the left-out hosts are the frame's, in order", () => {
    expect(QUERIES).toHaveLength(40);
    expect(new Set(QUERIES).size).toBe(40);
    expect(prereg.includes("the 8 the supply count used (" + QUERIES.slice(0, 8).join("; ") + ") and 32 more: " + QUERIES.slice(8).join("; ") + ". A result enters")).toBe(true);
    expect(prereg.includes("left out: " + EXCLUDED_HOSTS.slice(0, -1).join(", ") + " and " + EXCLUDED_HOSTS.at(-1) + ".")).toBe(true);
  });
});

describe("authorPrompt", () => {
  test("fills the shape without its closing period, the type phrase and the industry", () => {
    const p = authorPrompt("s4", "B2B", "farming", false);
    expect(p).toContain("Story shape: " + SHAPES.s4.slice(0, -1) + ". The founder pitches " + TYPE_PHRASE.B2B + ". Industry: farming. Write three files.");
    expect(p.endsWith("sends the opening message.")).toBe(true);
  });
  test("sets a developer tool among teams that build software for the industry", () => {
    expect(authorPrompt("s1", "developer tools", "hotels", false)).toContain("Industry: teams that build software for hotels.");
  });
  test("the CEILING variant adds its line at the end", () => {
    expect(authorPrompt("s1", "consumer", "hotels", true)).toBe(authorPrompt("s1", "consumer", "hotels", false) + " " + CEILING_LINE);
  });
});
