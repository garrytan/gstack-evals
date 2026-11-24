import { describe, expect, test } from "bun:test";
import { agreement, agreementLine, fixHunks, locationHit, reviewLocationHit } from "../../../lanes/review-models/score/location.ts";

const diff = [
  "diff --git a/src/retry.ts b/src/retry.ts",
  "index 1111111..2222222 100644",
  "--- a/src/retry.ts",
  "+++ b/src/retry.ts",
  "@@ -10,6 +10,6 @@ export async function retry() {",
  " a",
  " b",
  " c",
  "-  await send();",
  "+  if (await send() === 429) break;",
  " d",
  " e",
  "@@ -40,0 +41,2 @@",
  "+  log();",
  "+  log();",
  "--- a/lib/old.ts",
  "+++ b/lib/old.ts",
  "@@ -3,2 +2,0 @@",
  "-x",
  "-y",
  "--- /dev/null",
  "+++ b/src/new.ts",
  "@@ -0,0 +1,2 @@",
  "+one",
  "+two",
  "",
].join("\n");

describe("the fix's changed spans", () => {
  test("in pre-fix line numbers: replaced lines, the lines around a pure insertion, and no span for an added file", () => {
    expect(fixHunks(diff)).toEqual([
      { path: "src/retry.ts", start: 13, end: 13 },
      { path: "src/retry.ts", start: 40, end: 41 },
      { path: "lib/old.ts", start: 3, end: 4 },
    ]);
  });
  test("a removed line that starts with two dashes stays inside its hunk", () => {
    const sql = ["--- a/db/q.sql", "+++ b/db/q.sql", "@@ -5,3 +5,2 @@", " select 1;", "--- drop this comment", " select 2;", ""].join("\n");
    expect(fixHunks(sql)).toEqual([{ path: "db/q.sql", start: 6, end: 6 }]);
  });
});

describe("the location hit", () => {
  const hunks = fixHunks(diff);
  test("a cited file and a line within 3 lines of a span", () => {
    for (const line of [10, 13, 16, 37, 44]) expect(locationHit({ path: "src/retry.ts", line }, hunks)).toBe(true);
    for (const line of [9, 17, 36, 45]) expect(locationHit({ path: "src/retry.ts", line }, hunks)).toBe(false);
    expect(locationHit({ path: "./lib/old.ts", line: 7 }, hunks)).toBe(true);
    expect(locationHit({ path: "lib/other.ts", line: 3 }, hunks)).toBe(false);
    expect(locationHit({ path: "src/retry.ts", line: null }, hunks)).toBe(false);
    expect(locationHit({ path: null, line: 13 }, hunks)).toBe(false);
    expect(locationHit({ path: "src/new.ts", line: 1 }, hunks)).toBe(false);
  });
  test("a review hits when any finding does", () => {
    const f = (path: string, line: number) => ({ id: path + line, source: "voice" as const, severity: "LOW", path, line, text: "" });
    expect(reviewLocationHit([f("a.ts", 1), f("src/retry.ts", 12)], hunks)).toBe(true);
    expect(reviewLocationHit([f("a.ts", 1)], hunks)).toBe(false);
  });
});

describe("agreement with the judge", () => {
  test("the two by two, the share that agrees and kappa", () => {
    const rows = [
      ...Array.from({ length: 30 }, () => ({ judge: true, location: true })),
      ...Array.from({ length: 10 }, () => ({ judge: true, location: false })),
      ...Array.from({ length: 5 }, () => ({ judge: false, location: true })),
      ...Array.from({ length: 55 }, () => ({ judge: false, location: false })),
    ];
    const a = agreement(rows);
    expect(a).toMatchObject({ both: 30, judge_only: 10, location_only: 5, neither: 55, agree_share: 0.85 });
    expect(a.kappa!).toBeCloseTo((0.85 - (0.4 * 0.35 + 0.6 * 0.65)) / (1 - (0.4 * 0.35 + 0.6 * 0.65)), 12);
    expect(agreementLine(a)).toBe("location hit against the judge: both 30, judge only 10, location only 5, neither 55; agree 85.0%, kappa " + a.kappa!.toFixed(3));
    expect(agreement([]).agree_share).toBeNull();
  });
});
