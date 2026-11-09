// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPrompt, PROMPT_SHA256 } from "../../lanes/eng-review/judge.ts";
import { STOCK_PATHS_RAW, STOCK_ROWS_RAW, stockPaths, stockRow } from "../../lanes/eng-review/stock.ts";

const ANTICIPATED = "one check names, in substance, both the specific code path or user flow the item records and the specific condition, input, environment or behavior that failed or was later tested, so that running that check as written would have caught the defect or checked that behavior.";
const SPECIFIC = 'A category alone doesn\'t match ("test error handling" doesn\'t match "returns 500 on an empty tag list"); the right condition on another path doesn\'t match; a check that names the path and condition in other words does.';
const PREREG = join(import.meta.dir, "../../wiki/plans/2026-11-08-geva-405-eng-review-intentions-prereg/README.md");

describe("stock rows and the frozen prompts (sections 7 and 8)", () => {
  test("three rows of eight checks and eight stock paths, normalized without changing their words", () => {
    expect(STOCK_ROWS_RAW.map((r) => r.length)).toEqual([8, 8, 8]);
    expect(STOCK_PATHS_RAW.length).toBe(8);
    expect(stockRow(1)).toEqual([...STOCK_ROWS_RAW[0]!]);
    expect(stockRow(3)[5]).toBe("Test zero, one and 10,000 results.");
    expect(stockPaths()).toEqual([...STOCK_PATHS_RAW]);
  });
  test("each row and path appears verbatim in the prereg when it is on this checkout", () => {
    if (!existsSync(PREREG)) return;
    const text = readFileSync(PREREG, "utf8");
    for (const row of STOCK_ROWS_RAW) row.forEach((c, i) => expect(text).toContain("(" + (i + 1) + ") " + c));
    expect(text).toContain(STOCK_PATHS_RAW.join("; "));
    expect(text).toContain(ANTICIPATED);
    expect(text).toContain(SPECIFIC);
  });
  test("each prompt matches its pinned sha256 and holds the packet slot; a changed file is refused", () => {
    for (const name of Object.keys(PROMPT_SHA256) as Array<keyof typeof PROMPT_SHA256>) expect(loadPrompt(name)).toContain("{{PACKET}}");
    expect(PROMPT_SHA256.brief).not.toBe(PROMPT_SHA256.audit);
  });
  test("the brief and the audit prompt carry section 7's anticipated and specific-match rules verbatim and three examples", () => {
    for (const name of ["brief", "audit"] as const) {
      const t = loadPrompt(name);
      expect(t).toContain("anticipated: " + ANTICIPATED);
      expect(t).toContain(SPECIFIC);
      expect(t).toContain("path_hit: one check names the item's path or flow, whatever its condition.");
      expect((t.match(/^\d\. (Match|No match)\./gm) ?? []).length).toBe(3);
      expect(t).toContain('"credit"');
    }
    expect(loadPrompt("audit")).toContain("quote the exact words");
    expect(loadPrompt("brief")).not.toContain("quote the exact words");
    expect(loadPrompt("pairwise")).toContain("fewer untested paths and more regressions caught before merge");
    expect(loadPrompt("recognition")).toContain("60 days after that merge");
  });
});
