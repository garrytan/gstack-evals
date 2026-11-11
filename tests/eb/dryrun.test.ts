import { describe, expect, test } from "bun:test";
import { wiredSeams } from "../../lanes/eng-build/dryrun-seams.ts";
import { check, dryRun, EXPECTED, SEAMS, type Seams } from "../../lanes/eng-build/dryrun.ts";

const stubs = Object.fromEntries(Object.entries(SEAMS).map(([k, v]) => [k, async () => v.expect])) as Seams;

describe("dry run", () => {
  test("this lane's own rules all match", async () => {
    const r = await dryRun({ part: "own" });
    expect(r.failed).toEqual([]);
    expect(r.ok).toBe(true);
  });
  test("without Docker the wired seams run the pure rules, and every Docker seam prints SKIP with its reason, never a pass", async () => {
    const { seams, close } = wiredSeams({});
    try {
      const r = await dryRun({ part: "all", seams });
      expect(r.ok).toBe(false);
      expect(r.failed).toEqual([]);
      expect(r.skipped).toEqual(["recipe go", "recipe node", "recipe node-rust", "recipe python", "adapter jest", "adapter vitest", "adapter mocha", "adapter node-test", "adapter cargo", "classify t-case", "region product-hash", "rebuild stale-artifact", "transplant catch", "transplant no-catch", "leak image"].map((s) => "seam " + s));
      expect(r.lines).toContain("SKIP seam leak image: needs Docker: set GSTACK_EVALS_DOCKER=1 to build and grade its fixture unit; not a pass");
      for (const s of ["classify fail-to-pass", "classify anchor", "region rust-inline", "stophook blocks", "bundle cap"]) expect(r.lines).toContain("ok seam " + s + ": " + SEAMS[s as keyof typeof SEAMS].expect);
    } finally {
      close();
    }
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
