// Value: protects=section 3's brief files and screens: the key shape per role, the builder goal fact (item 4e), T8's prior session, twins one decisive fact apart, the digest, and the vocabulary screen's sources and edges.
import { describe, expect, test } from "bun:test";
import { readBrief, twinProblem, digestOf, goalFactProblem, type BriefFiles } from "../../../lanes/office-hours-rewrite/author/files.ts";
import { buildScreen, loadScreen, quotedIn, screenVocabulary, SCREEN_SOURCES } from "../../../lanes/office-hours-rewrite/author/screens.ts";
import { BUILDER, BUILDER_GOAL, FIRST, FIRST_TWIN_CALL, FIXTURE_ASKS, FIXTURE_SCREEN, SECOND, T7, T8, authorReply } from "../../../lanes/office-hours-rewrite/author/fixtures.ts";
import { LENS_LINE } from "../../../lanes/office-hours-rewrite/frozen.ts";

const spec = { role: "unpaired" as const, goal: null, prior: false, twin: null };

describe("readBrief", () => {
  test("reads a first twin with its twin_call and fixes key.twin", () => {
    const r = readBrief(authorReply(FIRST, { twinCall: FIRST_TWIN_CALL }), { role: "first", goal: null, prior: false, twin: "d1b" });
    if (typeof r === "string") throw new Error(r);
    expect(r.files.key).toEqual(FIRST.key);
    expect(r.twinCall).toBe(FIRST_TWIN_CALL);
  });
  test("a first twin without twin_call fails", () => {
    expect(readBrief(authorReply(FIRST), { role: "first", goal: null, prior: false, twin: "d1b" })).toContain("twin_call");
  });
  test("a second twin takes the partner's opening, word for word", () => {
    const r = readBrief(authorReply({ ...SECOND, opening: "something else\n" }, { opening: false }), { role: "second", goal: null, prior: false, twin: "d1a", opening: FIRST.opening });
    if (typeof r === "string") throw new Error(r);
    expect(r.files.opening).toBe(FIRST.opening);
  });
  test("an unpaired key needs a wrong call; 2 to 4 actions; 1 or 2 decisive ids on the sheet", () => {
    expect(readBrief(authorReply({ ...T7, key: { ...T7.key, wrong_call: null } }), spec)).toContain("wrong_call");
    expect(readBrief(authorReply({ ...T7, key: { ...T7.key, actions: ["one"] } }), spec)).toContain("2 to 4 actions");
    expect(readBrief(authorReply({ ...T7, key: { ...T7.key, actions: ["a", "b", "c", "d", "e"] } }), spec)).toContain("2 to 4 actions");
    expect(readBrief(authorReply({ ...T7, key: { ...T7.key, decisive: ["F1", "F2", "F3"] } }), spec)).toContain("1 or 2 decisive");
    expect(readBrief(authorReply({ ...T7, key: { ...T7.key, decisive: ["F99"] } }), spec)).toContain("not on the sheet");
    expect(typeof readBrief(authorReply(T7), spec)).toBe("object");
  });
  test("T8 needs prior.json with the frozen dates", () => {
    const s = { ...spec, prior: true };
    const ok = readBrief(authorReply(T8), s);
    if (typeof ok === "string") throw new Error(ok);
    expect(ok.files.prior).toEqual(T8.prior);
    expect(readBrief(authorReply({ ...T8, prior: { ...T8.prior!, test_date: "2027-01-01" } }), s)).toContain("dates");
    expect(readBrief(authorReply({ ...T8, prior: null }), s)).toContain("prior.json");
  });
});

describe("the builder goal fact (pre-run change 1 item 4e)", () => {
  const bs = { ...spec, goal: BUILDER_GOAL };
  test("a sheet stating the goal with a goal-question reveal_when passes", () => {
    expect(typeof readBrief(authorReply(BUILDER), bs)).toBe("object");
  });
  test("a sheet with no goal fact fails", () => {
    const sheet = { ...BUILDER.sheet, facts: BUILDER.sheet.facts.map((f) => (f.id === "F1" ? { ...f, text: "I like bikes a lot." } : f)) };
    expect(readBrief(authorReply({ ...BUILDER, sheet }), bs)).toContain("goal");
  });
  test("a goal fact whose reveal_when covers no goal or mode question fails", () => {
    const sheet = { ...BUILDER.sheet, facts: BUILDER.sheet.facts.map((f) => (f.id === "F1" ? { ...f, reveal_when: "Asked about my weekend." } : f)) };
    expect(goalFactProblem(sheet, BUILDER_GOAL)).toContain("goal or mode");
  });
  test("the goal must be the brief's own", () => {
    expect(goalFactProblem(BUILDER.sheet, "research")).not.toBeNull();
  });
  test("a builder key with traction fails", () => {
    expect(readBrief(authorReply({ ...BUILDER, key: { ...BUILDER.key, traction: true } }), bs)).toContain("traction");
  });
});

describe("twins", () => {
  test("one decisive fact apart with opposite calls passes", () => {
    expect(twinProblem(FIRST, SECOND)).toBeNull();
  });
  test("a changed non-decisive fact fails", () => {
    const s: BriefFiles = { ...SECOND, sheet: { ...SECOND.sheet, facts: SECOND.sheet.facts.map((f) => (f.id === "F5" ? { ...f, text: "We have two months." } : f)) } };
    expect(twinProblem(FIRST, s)).toContain("not decisive");
  });
  test("no rewritten decisive fact, the same call, or another opening fails", () => {
    expect(twinProblem(FIRST, { ...SECOND, sheet: FIRST.sheet })).toContain("rewrote no decisive");
    expect(twinProblem(FIRST, { ...SECOND, key: { ...SECOND.key, call: FIRST.key.call } })).toContain("same call");
    expect(twinProblem(FIRST, { ...SECOND, opening: "Other.\n" })).toContain("openings differ");
  });
});

describe("digest", () => {
  test("binds every file, prior.json included", () => {
    expect(digestOf(T8)).not.toBe(digestOf({ ...T8, prior: { ...T8.prior!, test: "six sign up" } }));
    expect(digestOf(FIRST)).not.toBe(digestOf({ ...FIRST, key: { ...FIRST.key, twin: "d9b" } }));
    expect(digestOf(FIRST)).toBe(digestOf(structuredClone(FIRST)));
  });
});

describe("vocabulary screen", () => {
  test("four shared words pass and five fail", () => {
    expect(screenVocabulary(FIXTURE_SCREEN, { opening: T7.opening + " Which neighbor would lend a hand?" }).pass).toBe(true);
    const r = screenVocabulary(FIXTURE_SCREEN, { opening: T7.opening + " Which neighbor would lend you a hand?" });
    expect(r.pass).toBe(false);
    expect(r.files).toEqual(["opening.md"]);
  });
  test("the lens line is barred, and so is each named term in a key or a prior session", () => {
    expect(screenVocabulary(FIXTURE_SCREEN, { opening: LENS_LINE }).pass).toBe(false);
    expect(screenVocabulary(FIXTURE_SCREEN, { key: { ...T7.key, call: "Find the narrowest wedge" } }).files).toEqual(["key.json"]);
    expect(screenVocabulary(FIXTURE_SCREEN, { prior: { ...T8.prior!, test: "check the status quo" } }).files).toEqual(["prior.json"]);
  });
  test("the fixtures pass", () => {
    for (const b of [FIRST, SECOND, T7, T8, BUILDER]) expect(screenVocabulary(FIXTURE_SCREEN, b).hits).toEqual([]);
  });
  test("loadScreen refuses a source whose sha256 is not pinned; the extractors read their sections", () => {
    const text = "### The Six Forcing Questions\n" + FIXTURE_ASKS.map((a) => '**Ask:** "' + a + '"').join("\n") + "\n### Reality Check (ask first, at every stage)\nSay " + '"one two three four five six"' + ".\n### Pivot flow\n" + '"seven eight nine ten eleven"' + "\n";
    expect(() => loadScreen(() => Buffer.from(text))).toThrow("not the pinned");
    expect(SCREEN_SOURCES).toHaveLength(3);
    expect(quotedIn(text, "### Pivot flow")).toEqual(["seven eight nine ten eleven"]);
    expect(quotedIn(text, "### Reality Check (ask first, at every stage)")).toEqual(["one two three four five six"]);
    expect(buildScreen(["one two three four five six"]).grams.has("two three four five six")).toBe(true);
  });
});
