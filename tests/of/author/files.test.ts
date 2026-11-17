// Value: protects=reading writer replies into unit files, their shape checks, the digest every check binds, and custody outside the repository.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE, authorReply } from "../../../lanes/office-hours-founder/author/fixtures.ts";
import { digestOf, keyProblem, openSink, readFiles, sheetProblem, unitFrom, writeUnit } from "../../../lanes/office-hours-founder/author/files.ts";

describe("readFiles", () => {
  test("reads headed fences", () => {
    const u = unitFrom(authorReply(FIXTURE), { constructed: true });
    expect(u).toEqual(FIXTURE);
  });
  test("reads fences labelled with the file name and bold headings with plain text", () => {
    const reply = "**opening.md**\nHello there.\n\n" + "\u0060\u0060\u0060" + "sheet.json\n{}\n" + "\u0060\u0060\u0060" + "\n";
    expect(readFiles(reply, ["opening.md", "sheet.json"])).toEqual({ "opening.md": "Hello there.", "sheet.json": "{}" });
  });
  test("reads one JSON object keyed by file name", () => {
    expect(readFiles(JSON.stringify({ "opening.md": "Hi", "key.json": { a: 1 } }), ["opening.md", "key.json"])).toEqual({ "opening.md": "Hi", "key.json": '{"a":1}' });
  });
  test("names a missing file", () => {
    expect(readFiles("### opening.md\nHi", ["opening.md", "key.json"])).toBe("the reply holds no key.json");
  });
});

describe("shape checks", () => {
  test("a constructed sheet needs 10 to 16 facts and listed kinds", () => {
    expect(sheetProblem({ ...FIXTURE.sheet, facts: FIXTURE.sheet.facts.slice(0, 9) }, true)).toMatch(/outside 10 to 16/);
    expect(sheetProblem({ ...FIXTURE.sheet, facts: FIXTURE.sheet.facts.slice(0, 9) }, false)).toBeNull();
    expect(sheetProblem({ ...FIXTURE.sheet, facts: [{ ...FIXTURE.sheet.facts[0]!, kind: "hunch" }] }, false)).toMatch(/listed kind/);
  });
  test("a constructed key needs 4 to 6 key facts on the sheet, an alternative and mentioned from the two W items", () => {
    expect(keyProblem({ ...FIXTURE.key, key_facts: ["F1", "F2", "F3"] }, FIXTURE.sheet, true)).toMatch(/outside 4 to 6/);
    expect(keyProblem({ ...FIXTURE.key, key_facts: ["F1", "F2", "F3", "F99"] }, FIXTURE.sheet, true)).toMatch(/not on the sheet/);
    expect(keyProblem({ ...FIXTURE.key, alternative: undefined }, FIXTURE.sheet, true)).toMatch(/alternative/);
    expect(keyProblem({ ...FIXTURE.key, mentioned: ["platform"] }, FIXTURE.sheet, true)).toMatch(/mentioned/);
    expect(keyProblem({ ...FIXTURE.key, key_facts: ["F99"], alternative: undefined }, FIXTURE.sheet, false)).toBeNull();
  });
  test("the digest moves with any file", () => {
    expect(digestOf(FIXTURE)).not.toBe(digestOf({ ...FIXTURE, opening: FIXTURE.opening + "x" }));
  });
});

describe("custody", () => {
  test("refuses a sink inside the repository and one that already exists", () => {
    expect(() => openSink(join(import.meta.dir, "sink"))).toThrow(/inside the repository/);
    expect(() => openSink(tmpdir())).toThrow(/already exists/);
  });
  test("writes a unit in the shared layout, with the check record in key.json", () => {
    const sink = openSink(join(mkdtempSync(join(tmpdir(), "of-sink-")), "run"));
    writeUnit(sink, FIXTURE, { id: "c1", stratum: "constructed", set: "calibration", draw: 1, author: "sol", shape: "s1", type: "B2B", industry: "farming", primary: ["customer", "wedge"], mentioned: [], generic: [], founder_stage: "has users", digest: digestOf(FIXTURE) }, { audit: "ok" });
    for (const f of ["opening.md", "sheet.json", "key.json", "unit.json"]) expect(existsSync(join(sink, "units", "c1", f))).toBe(true);
    expect(JSON.parse(readFileSync(join(sink, "units", "c1", "key.json"), "utf8")).audit).toBe("ok");
  });
});
