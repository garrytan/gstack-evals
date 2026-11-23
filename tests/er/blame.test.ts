// Copyright (c) 2026 Garry Tan. MIT License.
// The miner's blame fix (prereg 2026-11-08-geva-405, section 16, item 2): consecutive lines go to git blame as one
// -L a,b range, so a large edit in a large file is one short command.
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { blame, lineRanges } from "../../lanes/real-outcome/mine/szz.ts";
import { buildRepo, tempDir } from "../real/fixture.ts";

const t = tempDir("er-blame-");
afterAll(() => t.cleanup());

describe("blame ranges", () => {
  test("runs of consecutive lines merge; gaps, order and repeats are handled", () => {
    expect(lineRanges([])).toEqual([]);
    expect(lineRanges([5])).toEqual([[5, 5]]);
    expect(lineRanges([3, 1, 2, 2, 7, 8, 10])).toEqual([[1, 3], [7, 8], [10, 10]]);
    expect(lineRanges([4, 6])).toEqual([[4, 4], [6, 6]]);
  });
  test("a 20,000-line edit blames as one range and maps every line to the commit that wrote it", () => {
    const dir = join(t.dir, "big");
    const a = Array.from({ length: 20_000 }, (_, i) => "line " + i + "\n").join("");
    const b = a.split("\n").map((l, i) => (i >= 10_000 && i < 10_010 ? l + " changed" : l)).join("\n");
    const sha = buildRepo(dir, [
      { name: "one", message: "one", date: "2026-07-01T00:00:00Z", files: { "big.txt": a } },
      { name: "two", message: "two", date: "2026-07-02T00:00:00Z", files: { "big.txt": b } },
    ]);
    const lines = Array.from({ length: 20_000 }, (_, i) => i + 1);
    expect(lineRanges(lines)).toEqual([[1, 20_000]]);
    const m = blame(dir, sha.two!, "big.txt", lines);
    expect(m.size).toBe(20_000);
    expect(m.get(10_001)).toBe(sha.two);
    expect(m.get(10_011)).toBe(sha.one);
    expect(m.get(1)).toBe(sha.one);
    const gaps = blame(dir, sha.two!, "big.txt", [2, 3, 10_005, 19_999]);
    expect([...gaps.keys()].sort((x, y) => x - y)).toEqual([2, 3, 10_005, 19_999]);
    expect(gaps.get(10_005)).toBe(sha.two);
  });
});
