// Copyright (c) 2026 Garry Tan. MIT License.
// F8 (prereg 2026-11-11-geva-522 section 3): the key writer's 2,500-word cut of a B candidate's diff keeps every hunk
// that edits a line blamed on the change, by putting those hunks first. Keyless; the repository is invented.
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { blamedFirst, candidateDiff } from "../../lanes/eng-review/author/run.ts";
import { cut } from "../../lanes/product-value/author/run.ts";
import { buildRepo, tempDir } from "../real/fixture.ts";

const t = tempDir("er-blamed-first-");
afterAll(() => t.cleanup());
const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i + 1)).join("\n") + "\n";
const base = lines(400, (i) => "v" + i + ' = "alpha beta gamma delta epsilon zeta eta theta"');
const unit = base.replace('v380 = "alpha beta gamma delta epsilon zeta eta theta"', "v380 = risky(1, 0)");
const fixed = lines(400, (i) => (i <= 300 ? "v" + i + ' = "ALPHA BETA GAMMA DELTA EPSILON ZETA ETA THETA"' : i === 380 ? "v380 = safe(1, 0)" : "v" + i + ' = "alpha beta gamma delta epsilon zeta eta theta"'));
const dir = join(t.dir, "repo");
const sha = buildRepo(dir, [
  { name: "base", message: "base", date: "2026-07-01T00:00:00Z", files: { "app/big.py": base, "app/other.py": "x = 1\n" } },
  { name: "unit", message: "Add risky", date: "2026-07-02T00:00:00Z", files: { "app/big.py": unit } },
  { name: "fix", message: "Fix the crash in risky and reword constants", date: "2026-07-03T00:00:00Z", files: { "app/big.py": fixed, "app/other.py": "x = 2\n" } },
]);
const sorted = (s: string) => s.split("\n").sort();

describe("er author: blamed hunks first (F8)", () => {
  test("the blamed hunk leads, and the reorder only moves hunks", () => {
    const plain = candidateDiff(dir, sha.fix!);
    const ordered = blamedFirst(dir, sha.fix!, new Set([sha.unit!]));
    expect(plain.indexOf("+v380 = safe(1, 0)")).toBeGreaterThan(plain.indexOf("+v300 = "));
    expect(ordered.startsWith("diff --git a/app/big.py b/app/big.py\n")).toBe(true);
    expect(ordered.indexOf("+v380 = safe(1, 0)")).toBeLessThan(ordered.indexOf("+v1 = "));
    expect(ordered.indexOf("app/other.py")).toBeGreaterThan(ordered.indexOf("+v300 = "));
    const headers = ordered.split("\n").filter((l) => l.startsWith("diff --git ") || l.startsWith("--- ") || l.startsWith("+++ ") || l.startsWith("index "));
    expect(sorted(ordered).filter((l) => !headers.includes(l))).toEqual(sorted(plain).filter((l) => !headers.includes(l)));
  });

  test("the 2,500-word cut keeps the blamed hunk that the diff-order cut loses", () => {
    expect(cut(candidateDiff(dir, sha.fix!), 2500)).not.toContain("safe(1, 0)");
    expect(cut(blamedFirst(dir, sha.fix!, new Set([sha.unit!])), 2500)).toContain("+v380 = safe(1, 0)");
  });

  test("with no owned commit blamed, the diff keeps its own order", () => {
    expect(blamedFirst(dir, sha.fix!, new Set([sha.base!.replace(/./g, "0")]))).toBe(candidateDiff(dir, sha.fix!));
  });
});
