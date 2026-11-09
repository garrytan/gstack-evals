// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { approvedItems, run } from "../../lanes/eng-review/dryrun.ts";
import { capture, tmp } from "./fixtures.ts";

describe("er dryrun (section 16 item 4)", () => {
  test("every scoring-side case passes; it fails only on the run-side hook and the missing item caps", async () => {
    const c = capture();
    const code = await run(["--approvals", "/nonexistent/approvals.md"], c.io);
    const fails = c.out.filter((l) => l.startsWith("FAIL "));
    expect(c.out.filter((l) => l.startsWith("PASS ")).length).toBeGreaterThanOrEqual(44);
    expect(fails.every((l) => l.startsWith("FAIL run side:") || l.startsWith("FAIL one ledger lease"))).toBe(true);
    expect(code).toBe(1);
    expect(c.out.at(-1)).toMatch(/^er dryrun: \d+ PASS, \d+ FAIL$/);
  }, 120_000);

  test("the item caps table: er- rows under an Item caps heading with a Cap column; nothing else counts", async () => {
    const d = tmp();
    const f = join(d, "a.md");
    writeFileSync(f, "# Line\n| er-x | $9 |\n## Item caps (Captain, 2026-11-10)\n| Item | Line | Cap |\n|---|---|---|\n| er-s1-opus-none | Stage 1 runs | $22 |\n| `er-s1-labels` | Judges | $1,042 |\n| pv-other | x | $5 |\n## Later\n| er-y | z | $3 |\n");
    expect(approvedItems(f).items).toEqual({ "er-s1-opus-none": 22, "er-s1-labels": 1042 });
    writeFileSync(f, "# Line\nno caps yet\n");
    expect(approvedItems(f).items).toBeNull();
    const c = capture();
    await run(["--approvals", f], c.io);
    expect(c.out.some((l) => l.startsWith("FAIL one ledger lease") && l.includes("Item caps"))).toBe(true);
  }, 120_000);

  test("with an item caps section, one lease per item opens and settles, judge items through the metered client", async () => {
    const d = tmp();
    const f = join(d, "a.md");
    writeFileSync(f, "## Item caps\n| Item | Cap |\n|---|---|\n| er-s1-opus-none | $22 |\n| er-s1-labels | $40 |\n");
    const c = capture();
    await run(["--approvals", f], c.io);
    expect(c.out.some((l) => l.startsWith("PASS one ledger lease per item") && l.includes("2 items"))).toBe(true);
  }, 120_000);

  test("an unknown argument is a usage error", async () => {
    await expect(run(["--fast"], capture().io)).rejects.toThrow(/unknown argument/);
  });
});
