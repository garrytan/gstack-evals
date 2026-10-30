import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importCases, locate, locationOf, main, sharedRuns } from "../../scripts/import-noloss-cases.ts";
import { Git } from "../../scripts/mine-review-cases.ts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "noloss-import-"));
  dirs.push(dir);
  const git = (...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { cwd: dir, encoding: "utf8" }).stdout.trim();
  git("init", "-q", "-b", "main");
  const commit = (files: Record<string, string>, msg: string) => {
    for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t);
    git("add", "-A");
    git("commit", "-q", "-m", msg);
    return git("rev-parse", "HEAD");
  };
  return { dir, git, commit };
}

const lines = (n: number, edit: Record<number, string> = {}, insertAfter: Record<number, string[]> = {}) =>
  Array.from({ length: n }, (_, i) => [edit[i + 1] ?? "line " + (i + 1), ...(insertAfter[i + 1] ?? [])]).flat().join("\n") + "\n";

describe("import line resolution", () => {
  const r = repo();
  const base = r.commit({ "a.ts": lines(10), "b.ts": "b\n" }, "base");
  const head = r.commit({ "a.ts": lines(10, { 6: "buggy()" }) }, "pass-1 head");
  const childFix = r.commit({ "a.ts": lines(10, { 6: "fixed()" }) }, "fix as a child");
  const g = new Git(r.dir);

  test("a child fix rewrites the line", () => {
    expect(locate(g, head, childFix, "a.ts", 6)).toMatchObject({ check: "rewritten", lineage: [], mapped: 6, carried: false });
    expect(locate(g, head, childFix, "a.ts", 3)).toMatch(/neither rewrites/);
    expect(locate(g, childFix, head, "a.ts", 6)).toMatch(/does not descend/);
    expect(locate(g, head, childFix, "a.ts", 99)).toMatch(/past the end/);
  });

  test("a later fix is followed back through the commits in between", () => {
    r.git("checkout", "-q", head);
    const shift = r.commit({ "a.ts": lines(10, { 6: "buggy()" }, { 2: ["new 1", "new 2"] }) }, "lines added above");
    const fix = r.commit({ "a.ts": lines(10, { 6: "fixed()" }, { 2: ["new 1", "new 2"] }) }, "later fix");
    expect(locate(g, head, fix, "a.ts", 6)).toMatchObject({ check: "rewritten", lineage: [shift], mapped: 8 });
  });

  test("a line rewritten in between is refused unless the hand audit says how it carried", () => {
    r.git("checkout", "-q", head);
    const split = r.commit({ "a.ts": lines(10, { 6: "buggy(1)\nbuggy(2)" }) }, "split the line");
    const fix = r.commit({ "a.ts": lines(10, { 6: "buggy(1)\nfixed(2)" }) }, "fix the second half");
    expect(locate(g, head, fix, "a.ts", 6)).toMatch(/rewritten between the pass-1 head/);
    expect(locate(g, head, fix, "a.ts", 6, "the split kept the call")).toMatchObject({ check: "rewritten", lineage: [split], mapped: 7, carried: true });
  });

  test("an insertion-only fix counts for the line right above it", () => {
    r.git("checkout", "-q", head);
    const fix = r.commit({ "a.ts": lines(10, { 6: "buggy()" }, { 6: ["guard()"] }) }, "insert a guard");
    expect(locate(g, head, fix, "a.ts", 6)).toMatchObject({ check: "insertion-adjacent", mapped: 6 });
    expect(locate(g, head, fix, "a.ts", 5)).toMatch(/neither rewrites/);
  });

  test("location: added, context or outside the diff", () => {
    expect(locationOf(g, base, head, "a.ts", 6)).toBe("added");
    expect(locationOf(g, base, head, "a.ts", 2)).toBe("context");
    expect(locationOf(g, base, head, "b.ts", 1)).toBe("outside");
  });

  test("repo visibility is read fresh, never from the cache, and a private repo is refused", async () => {
    const calls: unknown[] = [];
    const api = { get: async (p: string, o?: { fresh?: boolean }) => (calls.push([p, o]), { visibility: "private" }), calls: () => calls.length };
    const run = importCases({ cohort: { repo: "garrytan/gstack", units: [] } as never, hand: {} as never, git: {} as never, api, scope: {} as never, reuse: new Map(), prereg: null });
    await expect(run).rejects.toThrow(/is private, not public/);
    expect(calls[0]).toEqual(["repos/garrytan/gstack", { fresh: true }]);
  });

  test("a missing prereg file is reported with its reason code, not a stack", async () => {
    const d = mkdtempSync(join(tmpdir(), "noloss-main-"));
    dirs.push(d);
    mkdirSync(join(d, ".git"));
    mkdirSync(join(d, "bin"));
    writeFileSync(join(d, "bin", "gstack-diff-scope"), "");
    const err = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await main(["--clone", d, "--gstack", d, "--cache", d, "--prereg", join(d, "missing.md")])).toBe(2);
      expect(String(err.mock.calls[0]?.[0])).toMatch(/^E_NOLOSS_SOURCE no prereg file/);
    } finally {
      err.mockRestore();
    }
  });

  test("restated summaries share no eight-word run with the source", () => {
    const src = "the quick brown fox jumps over the lazy dog near the river bank";
    expect(sharedRuns("A quick fox leapt across a sleeping dog by the water.", src)).toEqual([]);
    expect(sharedRuns("Here the quick brown fox jumps over the lazy dog again.", src)).toEqual(["the quick brown fox jumps over the lazy", "quick brown fox jumps over the lazy dog"]);
  });
});
