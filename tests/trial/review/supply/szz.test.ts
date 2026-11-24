// Value: protects=the SZZ port picks the most-blamed commit over non-trivial deleted lines (else lines beside an insertion),
// skips tests and added files, and gate 2 refuses merges, root commits, minority BICs, big BICs and test-only BICs;
// fails_when=line numbering, the fallback, the tie order or a gate 2 bound drifts from the plan; why_new=GEVA-590 section 10
// item 3; seam=parsePatch, blameTargets, blameLines, pickBic, bicShape, gate2; no_claim=real advisory repositories
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { bicShape, blameLines, blameTargets, gate2, nontrivial, NON_SOURCE, parsePatch, pickBic, type Blamed } from "../../../../src/trial/review/supply/szz.ts";
import { commitAll, git, tree } from "../../../cli/helpers.ts";

const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1..2 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -3,4 +3,4 @@ fn",
  " keep",
  "-old one",
  "---sql comment",
  "+new",
  " keep",
  "@@ -20,2 +20,3 @@",
  " ctx",
  "+inserted",
  " ctx2",
  "diff --git a/tests/a.test.ts b/tests/a.test.ts",
  "--- a/tests/a.test.ts",
  "+++ b/tests/a.test.ts",
  "@@ -1,1 +1,1 @@",
  "-x",
  "+y",
  "diff --git a/src/new.ts b/src/new.ts",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/src/new.ts",
  "@@ -0,0 +1,1 @@",
  "+z",
].join("\n");

describe("SZZ targets", () => {
  test("parsePatch numbers deleted lines and insertion points on the old side", () => {
    const files = parsePatch(PATCH);
    expect(files.map((f) => [f.b, f.added])).toEqual([["src/a.ts", false], ["tests/a.test.ts", false], ["src/new.ts", true]]);
    expect(files[0]!.hunks).toEqual([{ dels: [4, 5], addsAt: [6] }, { dels: [], addsAt: [21] }]);
  });

  test("blameTargets skips non-source and added files and blames both sides of an insertion", () => {
    const t = blameTargets(parsePatch(PATCH));
    expect(t.source).toEqual(["src/a.ts", "src/new.ts"]);
    expect(t.deleted).toEqual([{ path: "src/a.ts", line: 4 }, { path: "src/a.ts", line: 5 }]);
    expect(t.beside).toEqual([{ path: "src/a.ts", line: 5 }, { path: "src/a.ts", line: 6 }, { path: "src/a.ts", line: 20 }, { path: "src/a.ts", line: 21 }]);
    expect(["src/x_test.go", "pkg/testdata/a.go", "README.md", "a.spec.ts", "Cargo.lock"].every((p) => NON_SOURCE.test(p))).toBe(true);
    expect(["src/server.go", "src/latest/mod.rs"].some((p) => NON_SOURCE.test(p))).toBe(false);
  });
});

const b = (sha: string, text: string): Blamed => ({ sha, path: "a", line: 1, text });

describe("pickBic", () => {
  test("most blamed over non-trivial deleted lines, first blamed wins a tie", () => {
    expect(nontrivial("}")).toBe(false);
    expect(nontrivial("  return x;")).toBe(true);
    expect(pickBic([b("a", "x = 1"), b("b", "y = 2"), b("b", "z = 3"), b("a", "}"), b("a", "w")], [])).toEqual({ basis: "deleted", blamed_lines: 3, blamed_commits: 2, bic: "b", bic_lines: 2 });
    expect(pickBic([b("a", "x = 1"), b("b", "y = 2")], []).bic).toBe("a");
  });
  test("falls back to the lines beside insertions, else none", () => {
    expect(pickBic([b("a", "}")], [b("c", "call()")])).toMatchObject({ basis: "beside", bic: "c" });
    expect(pickBic([], [b("c", "{")])).toEqual({ basis: "none", blamed_lines: 0, blamed_commits: 0, bic: null, bic_lines: 0 });
  });
});

describe("blame and gate 2 on a git history", () => {
  test("the BIC is the commit whose lines the fix deletes", () => {
    const root = tree({ "src/a.ts": ["one();", "two();", "three();", "four();", ""].join("\n") });
    const c1 = commitAll(root, "initial");
    writeFileSync(join(root, "src/a.ts"), ["one();", "bad(1);", "bad(2);", "four();", ""].join("\n"));
    writeFileSync(join(root, "src/a.test.ts"), "test();\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "introduce");
    const bic = git(root, "rev-parse", "HEAD");
    writeFileSync(join(root, "src/a.ts"), ["one();", "good();", "four();", ""].join("\n"));
    git(root, "commit", "-q", "-am", "fix");
    const fix = git(root, "rev-parse", "HEAD");
    const t = blameTargets(parsePatch(git(root, "diff", fix + "^", fix)));
    const deleted = blameLines(root, fix + "^", t.deleted);
    expect(deleted.map((d) => [d.sha, d.line, d.text])).toEqual([[bic, 2, "bad(1);"], [bic, 3, "bad(2);"]]);
    expect(blameLines(root, fix + "^", [{ path: "src/a.ts", line: 99 }, { path: "gone.ts", line: 1 }])).toEqual([]);
    const pick = pickBic(deleted, []);
    const shape = bicShape(root, bic);
    expect(shape).toEqual({ parents: 1, files: 2, lines: 5, source_lines: 4 });
    expect(gate2(pick, shape)).toBeNull();
    expect(bicShape(root, c1).parents).toBe(0);
    expect(gate2(pick, bicShape(root, c1))).toBe("the BIC is the initial commit");
    expect(gate2(pick, { ...shape, parents: 2 })).toBe("the BIC has 2 parents");
    expect(gate2({ ...pick, blamed_lines: 5 }, shape)).toBe("the BIC carries 2 of 5 blamed lines, under half");
    expect(gate2({ ...pick, blamed_lines: 4 }, shape)).toBeNull();
    expect(gate2(pick, { ...shape, lines: 2001 })).toBe("the BIC changes 2001 lines, over 2,000");
    expect(gate2(pick, { ...shape, lines: 2000 })).toBeNull();
    expect(gate2(pick, { ...shape, source_lines: 0 })).toBe("the BIC changes no source line");
  });
});
