// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the proposed ledger split: every approved item's ledger items sum to at most its frozen cap, each part keeps 1.35 times its cost.py central figure plus its allowance, and each launch's two items fit its frozen line; fails_when=a part grows past its approved cap, shrinks under its central figure, or a launch's items stop fitting run/manifest.ts's line.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CAPS } from "../../lanes/office-hours-rewrite/frozen.ts";
import { LAUNCH_ITEMS, SPLIT, splitProblems } from "../../lanes/office-hours-rewrite/ledger.ts";
import { dryRun } from "../../lanes/office-hours-rewrite/dryrun.ts";

describe("the ledger split", () => {
  test("holds as written, and each approved item's parts sum to at most its cap", () => {
    expect(splitProblems()).toEqual([]);
    for (const line of Object.keys(CAPS) as (keyof typeof CAPS)[]) expect(SPLIT.filter((p) => p.line === line).reduce((t, p) => t + p.cap, 0)).toBeLessThanOrEqual(CAPS[line]);
  });

  test("matches the table pre-run change 3 freezes, row for row", () => {
    const tsv = readFileSync(join(import.meta.dir, "../../wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-3/split.tsv"), "utf8");
    const rows = tsv.trimEnd().split("\n").slice(1).map((l) => l.split("\t"));
    expect(rows).toEqual(SPLIT.map((p) => [p.item, p.line, String(p.central ?? ""), String(p.allowance ?? ""), String(p.cap), p.what]));
  });

  test("a part one dollar past its approved cap is refused", () => {
    expect(splitProblems(SPLIT.map((p) => (p.item === "ohr-hosts" ? { ...p, cap: 23 } : p)))).toEqual(["hosts's ledger items sum to $23, past its approved cap of $22"]);
  });

  test("a part under 1.35 times central is refused, and so is a duplicate item", () => {
    expect(splitProblems(SPLIT.map((p) => (p.item === "ohr-audit" ? { ...p, cap: 39 } : p))).join()).toContain("ohr-audit's cap $39 is under 1.35 times");
    expect(splitProblems([...SPLIT, SPLIT[0]!]).join()).toContain("item ohr-author appears twice");
  });

  test("each launch names two items in the split", () => {
    for (const it of Object.values(LAUNCH_ITEMS)) for (const item of [it.arms, it.sim]) expect(SPLIT.map((p) => p.item)).toContain(item);
  });

  test("the dry run's split and ledger lines pass: one lease per ledger item, and a second run refused", async () => {
    const lines = (await dryRun({ ledger: true })).filter((l) => /^ledger( split)?: /.test(l.name));
    expect(lines.length).toBeGreaterThanOrEqual(5);
    expect(lines.some((l) => l.name.includes("refuses a second run (E_ITEM_BOUND)"))).toBe(true);
    expect(lines.filter((l) => l.state !== "PASS")).toEqual([]);
  });
});
