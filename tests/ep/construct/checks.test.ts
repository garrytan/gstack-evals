// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless tests of the planted-unit body check and one-commit check (lanes/eng-planted/construct/checks.ts).
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitCount, judge, needlesOf, scanTexts } from "../../../lanes/eng-planted/construct/checks.ts";
import { fixtureRepo } from "../../../lanes/eng-planted/construct/fixtures.ts";

const body = ["  const total = items.reduce((a, b) => a + b, 0);", "  }", "  const average = total / Math.max(items.length, 1);", "  const rounded = Math.round(average * 100) / 100;", "  return rounded;"];

describe("body check", () => {
  const [needles] = needlesOf([{ file: "src/a.js", lines: body }]);

  test("needles are the normalized lines of 20 or more characters, keeping the body's layout", () => {
    expect(needles.map((n) => n.at)).toEqual([0, 2, 3]);
    expect(needles[0].text).toBe("const total = items.reduce((a, b) => a + b, 0);");
  });

  test("a body with 3 or more contiguous removed lines copied outside the region drops, re-indented or not", () => {
    const copy = "function other(items) {\n" + body.map((l) => "    " + l).join("\n") + "\n}\n";
    const r = judge(needles, scanTexts(needles, [{ path: "lib/b.js", text: copy }]));
    expect(r.run).toBe(true);
    expect(r.passes).toBe(false);
  });

  test("shared boilerplate lines of 20 or more characters that form no 3-line run pass, however many match", () => {
    const scattered = body[0] + "\nx\n\ny\n" + body[2] + "\n\nz\n" + body[3] + "\n";
    const r = judge(needles, scanTexts(needles, [{ path: "lib/b.js", text: scattered }, { path: "lib/c.js", text: body[3] + "\n" + body[0] + "\n" }]));
    expect(r.run).toBe(false);
    expect(r.found).toBe(3);
    expect(r.passes).toBe(true);
    expect(judge(needles, scanTexts(needles, [{ path: "lib/b.js", text: "nothing here\n" }])).passes).toBe(true);
  });

  test("a source map's sourcesContent is read", () => {
    const map = JSON.stringify({ version: 3, sources: ["a.js"], sourcesContent: [body.join("\n")] });
    expect(judge(needles, scanTexts(needles, [{ path: "dist/a.js.map", text: map }])).run).toBe(true);
  });
});

describe("one-commit check", () => {
  test("commitCount counts every commit object, reachable or not", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "ep-test-")), "r");
    fixtureRepo(dir, [
      { name: "a", date: "2026-08-01T00:00:00Z", message: "a", files: { x: "1\n" } },
      { name: "b", date: "2026-08-02T00:00:00Z", message: "b", files: { x: "2\n" } },
    ]);
    expect(commitCount(join(dir, ".git"))).toBe(2);
    spawnSync("git", ["update-ref", "refs/heads/main", "HEAD~1"], { cwd: dir });
    expect(commitCount(join(dir, ".git"))).toBe(2);
  });
});
