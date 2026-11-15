// Copyright (c) 2026 Garry Tan. MIT License.
// The B1 browser-only label, keyless: the packet, the answer reader, the both-yes rule and agreement, with stub clients.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readUnit } from "../../lanes/outcome-skills/statemachines/unit.ts";
import { agreement, LABEL_MODELS, LABEL_QUESTION, labelPacket, labelUnit, readAnswer, recordLabel, stubClient, type LabelRow } from "../../lanes/outcome-skills/h2h/breadth/label.ts";
import { candidateOf, writeBUnit } from "../../lanes/outcome-skills/h2h/breadth/oracle-b.ts";
import { isDrop, testPlan, type TestPlan } from "../../lanes/outcome-skills/h2h/breadth/recipes.ts";

const P40 = "d".repeat(40), C40 = "e".repeat(40);
const REF = "127.0.0.1:5000/h2h@sha256:" + "f".repeat(64);

function plantUnit(root: string): string {
  const c = candidateOf("B1", { repo: "acme/web", number: 7, url: "u", merged: "2026-06-02", month: "2026-06", window: "primary", licence: "MIT", runners: ["playwright"], fix: { commit: C40, parent: P40 }, files: { browser_test: 1, test: 1, source: 1, total: 2 }, issue_url: "https://github.com/acme/web/issues/3", statement_sha256: "0".repeat(64), statement_chars: 300 });
  const plan = testPlan("playwright", ["e2e/focus.spec.ts"], { files: ["package.json"], texts: {} });
  if (isDrop(plan)) throw new Error("plan");
  const dir = join(root, c.id);
  writeBUnit(dir, {
    c, lang: "ts", plan: plan as TestPlan, statement: "Focus ring disappears after the dialog closes.\n",
    patches: { fix: "diff --git a/src/focus.ts b/src/focus.ts\n+restore()\n", test: "diff --git a/e2e/focus.spec.ts b/e2e/focus.spec.ts\n+test('focus')\n", all: ["e2e/focus.spec.ts", "src/focus.ts"], testFiles: ["e2e/focus.spec.ts"], fixFiles: ["src/focus.ts"], sourceFiles: ["src/focus.ts"] },
    tests: { f2p: ["[chromium]::focus.spec.ts::focus.spec.ts::::focus"], p2p: ["[chromium]::focus.spec.ts::focus.spec.ts::::opens"] },
    h2h: { kind: "B1", image_ref: REF, runner: "playwright", format: "junit-playwright", ecosystem: "npm", licence: "MIT", statement_sha256: "0".repeat(64), build: { image_id: "sha256:" + "1".repeat(64), dockerfile_sha256: "2".repeat(64) } },
  });
  return dir;
}

describe("label packet", () => {
  test("built from the unit dir alone, with the frozen question word for word", () => {
    const root = mkdtempSync(join(tmpdir(), "h2h-label-"));
    try {
      const dir = plantUnit(root);
      const p = labelPacket(dir);
      expect(p.text).toContain("Question: " + LABEL_QUESTION);
      expect(LABEL_QUESTION).toBe("Is the wrong behaviour visible only in a real browser engine, through rendering, layout, focus, DOM events, browser APIs or hydration, and not in Node or jsdom?");
      expect(p.text).toContain("Focus ring disappears");
      expect(p.text).toContain("+restore()");
      expect(p.text).toContain("- [chromium]::focus.spec.ts::focus.spec.ts::::focus");
      expect(labelPacket(dir).sha256).toBe(p.sha256);
      const row: LabelRow = { id: "acme__web-7", packet_sha256: p.sha256, answers: { a: "yes", b: "yes" }, reply_sha256: {}, in: true };
      recordLabel(dir, row);
      expect((readUnit(dir).labels as { browser_only: LabelRow }).browser_only.in).toBe(true);
      expect(readFileSync(join(dir, "issue.md"), "utf8")).toContain("Focus ring");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("answers and the both-yes rule", () => {
  test("reader", () => {
    expect(readAnswer("Yes.\nBecause layout.")).toBe("yes");
    expect(readAnswer("\n  no, jsdom shows it")).toBe("no");
    expect(readAnswer("Probably")).toBe("unclear");
    expect(readAnswer("")).toBe("unclear");
  });
  test("a unit is in only when both models say yes", async () => {
    const pk = { text: "packet", sha256: "s" };
    const [a, b] = LABEL_MODELS;
    expect((await labelUnit("u", pk, [stubClient(a, () => "yes"), stubClient(b, () => "Yes, focus")])).in).toBe(true);
    expect((await labelUnit("u", pk, [stubClient(a, () => "yes"), stubClient(b, () => "no")])).in).toBe(false);
    expect((await labelUnit("u", pk, [stubClient(a, () => "yes"), stubClient(b, () => "maybe")])).in).toBe(false);
    expect((await labelUnit("u", pk, [])).in).toBe(false);
  });
  test("agreement and kappa", () => {
    const [a, b] = LABEL_MODELS;
    const row = (x: string, y: string): LabelRow => ({ id: "u", packet_sha256: "", answers: { [a]: x as "yes", [b]: y as "yes" }, reply_sha256: {}, in: x === "yes" && y === "yes" });
    const rows = [...Array(4).fill(row("yes", "yes")), ...Array(3).fill(row("no", "no")), ...Array(2).fill(row("yes", "no")), row("no", "yes")];
    const g = agreement(rows);
    expect([g.units, g.both_yes, g.both_no, g.split, g.unclear]).toEqual([10, 4, 3, 3, 0]);
    expect(g.agreement).toBeCloseTo(0.7, 10);
    expect(g.kappa!).toBeCloseTo(0.4, 10);
    expect(agreement([row("yes", "yes")]).kappa).toBeNull();
  });
});
