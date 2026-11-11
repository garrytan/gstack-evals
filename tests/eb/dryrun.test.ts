import { describe, expect, test } from "bun:test";
import { check, dryRun, EXPECTED, SEAMS, type Seams } from "../../lanes/eng-build/dryrun.ts";

const stubs = Object.fromEntries(Object.entries(SEAMS).map(([k, v]) => [k, async () => v.expect])) as Seams;

describe("dry run", () => {
  test("this lane's own rules all match", async () => {
    const r = await dryRun({ part: "own" });
    expect(r.failed).toEqual([]);
    expect(r.ok).toBe(true);
  });
  test("all fails while a seam is open, naming the case", async () => {
    const r = await dryRun({ part: "all", seams: { ...stubs, "bundle cap": undefined } });
    expect(r.failed).toEqual(["seam bundle cap"]);
    expect(r.lines).toContain('FAIL seam bundle cap: expected "truncated at 12000 words", got "OPEN (seam review bundle not wired)"');
  });
  test("all passes once every seam answers its expected word", async () => {
    expect((await dryRun({ part: "all", seams: stubs })).ok).toBe(true);
  });
  test("the run-side check needs every exact line: no wildcard and no undefined", () => {
    const got = new Map(Object.entries(EXPECTED).filter(([k]) => !k.startsWith("seam ")));
    expect(check(got, EXPECTED, "own").ok).toBe(true);
    const wrong = new Map(got);
    wrong.set("score gaps", "missing 0.500, as 0 0.250, gap TRUE");
    const r = check(wrong, EXPECTED, "own");
    expect(r.failed).toEqual(["score gaps"]);
    expect(r.lines.filter((l) => l.startsWith("FAIL"))).toEqual(['FAIL score gaps: expected "missing 0.500, as 0 0.250, gap true", got "missing 0.500, as 0 0.250, gap TRUE"']);
    const undef = new Map(got);
    undef.set("prompts", "undefined");
    expect(check(undef, { ...EXPECTED, prompts: "undefined" }, "own").failed).toEqual(["prompts"]);
    const missing = new Map(got);
    missing.delete("strip rule");
    missing.set("an extra case", "x");
    expect(check(missing, EXPECTED, "own").failed).toEqual(["strip rule", "an extra case"]);
    expect(r.lines.some((l) => l.startsWith("FAIL run side"))).toBe(false);
    expect(r.lines.join("\n")).not.toContain("undefined");
  });
});
