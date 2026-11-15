// Value: protects=the vocabulary screen, the copy check and the name scan, the keyless guards against the skill's wording, copied source text and named sources.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE, FIXTURE_ASKS, FIXTURE_PHASE_2A } from "../../../lanes/office-hours-founder/author/fixtures.ts";
import { PHASE_2A, copyCheck, forcingQuestions, loadForcingQuestions, namesIn, screenVocabulary, unitStrings, vocabulary, words } from "../../../lanes/office-hours-founder/author/screens.ts";

const screen = vocabulary(FIXTURE_ASKS);

describe("words", () => {
  test("lowercases and turns every run of punctuation into one space", () => {
    expect(words("Office-hours: What's NEXT?")).toEqual(["office", "hours", "what", "s", "next"]);
  });
});

describe("forcing questions", () => {
  test("reads the six Ask lines without their quotes", () => {
    expect(forcingQuestions(FIXTURE_PHASE_2A)).toEqual(FIXTURE_ASKS);
  });
  test("refuses a file without exactly six Ask lines", () => {
    expect(() => forcingQuestions("**Ask:** one")).toThrow(/E_USAGE/);
  });
  test("refuses a checkout whose file differs from the pinned sha256", () => {
    const dir = mkdtempSync(join(tmpdir(), "of-gstack-"));
    mkdirSync(join(dir, "office-hours", "sections"), { recursive: true });
    writeFileSync(join(dir, PHASE_2A.path), FIXTURE_PHASE_2A);
    expect(() => loadForcingQuestions(dir)).toThrow(/not the pinned/);
  });
});

describe("vocabulary screen", () => {
  test("the fixture unit passes", () => {
    expect(screenVocabulary(screen, FIXTURE).pass).toBe(true);
  });
  test("a 5-word sequence from the lens arm's first line fails in any case and punctuation", () => {
    const r = screenVocabulary(screen, { key: { ...FIXTURE.key, first_move: "Hold a YC OFFICE-HOURS session." } });
    expect(r.pass).toBe(false);
    expect(r.files).toEqual(["key.json"]);
  });
  test("reads the persona and reveal_when lines but not the fact kinds", () => {
    expect(unitStrings({ sheet: FIXTURE.sheet }).map((s) => s.text)).not.toContain("status-quo");
    const r = screenVocabulary(screen, { sheet: { ...FIXTURE.sheet, persona: "Cares about demand reality." } });
    expect(r.hits).toEqual(["demand reality"]);
  });
  test("a named term inside a longer word does not count", () => {
    expect(screenVocabulary(screen, { opening: "The status quorum met." }).pass).toBe(true);
  });
});

describe("copy check and name scan", () => {
  test("reports which file holds the copy", () => {
    const r = copyCheck({ ...FIXTURE, key: { ...FIXTURE.key, pivot: "two route setters exported the hold inventory" } }, ["two route setters exported the hold inventory weekly"], []);
    expect(r.files).toEqual(["key.json"]);
  });
  test("name scan matches whole entries, any case, and not parts of words", () => {
    expect(namesIn("acme's growth", ["Acme"])).toEqual(["Acme"]);
    expect(namesIn("acmesoft", ["Acme"])).toEqual([]);
    expect(namesIn("Ada Quill wrote", ["Ada Quill", "Bo Lin"])).toEqual(["Ada Quill"]);
  });
});
