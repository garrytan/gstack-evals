// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 7's gold fill under the 30% anchor cap in check_seed order, and section 5's atomization rules carried by the
// pass A prompt (a table row and its evidence block are one finding; checked-and-safe items and plans to check are not).
// The extra findings pool is pass A findings past the first 10 of check-set reports.
import { describe, expect, test } from "bun:test";
import { loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";
import { GATES, GOLD_MINIMUMS, type JudgeCheck } from "../../lanes/outcome-skills/cso/analysis/release.ts";
import { extraFindingPool, goldFill, type AnchorCandidate } from "../../lanes/outcome-skills/cso/judge/check.ts";
import { passAPacket } from "../../lanes/outcome-skills/cso/judge/packets.ts";

const p = loadCsoPrereg();
const all = <K extends string>(ks: readonly K[]) => Object.fromEntries(ks.map((k) => [k, true])) as Record<K, boolean>;
const check = (d: Record<string, unknown>): JudgeCheck => ({ route: "production", minimums: all(GOLD_MINIMUMS), gates: all(GATES), detail: { reports: 94, anchors: 24, gold_reports: 50, gold_classes: { named: 20, not_named: 30 }, gold_findings: 60, validity_classes: { supported: 30, unsupported: 30 }, ...d } });
const pool: AnchorCandidate[] = Array.from({ length: 8 }, (_, k) => ({ id: (k % 2 ? "stock-" : "oracle-") + k, kind: k % 2 ? "stock" : "oracle" }));
const findings = Array.from({ length: 30 }, (_, k) => "f" + k);

describe("section 7: gold fill", () => {
  test("no shortfall takes nothing", () => {
    expect(goldFill(check({}), { anchors: pool, findings }, p)).toEqual({ anchors: [], findings: [], still_short: [] });
  });
  test("a named-class shortfall takes oracle anchors, in check_seed order, only as many as the cap allows", () => {
    const f = goldFill(check({ gold_classes: { named: 7, not_named: 40 } }), { anchors: pool, findings }, p);
    expect(f.anchors.length).toBe(3);
    expect(f.anchors.every((a) => a.startsWith("oracle-"))).toBe(true);
    expect(goldFill(check({ gold_classes: { named: 7, not_named: 40 } }), { anchors: [...pool].reverse(), findings }, p).anchors).toEqual(f.anchors);
    const capped = goldFill(check({ gold_classes: { named: 0, not_named: 40 } }), { anchors: pool, findings }, p);
    expect(capped.anchors.length).toBe(4);
    expect(capped.still_short).toEqual(["named_class"]);
    expect((24 + capped.anchors.length) / (94 + capped.anchors.length)).toBeLessThanOrEqual(0.3);
  });
  test("a report-count shortfall alternates oracle and stock; a stock shortage is named", () => {
    const f = goldFill(check({ gold_reports: 37, gold_classes: { named: 17, not_named: 20 } }), { anchors: pool, findings }, p);
    expect(f.anchors.map((a) => a.split("-")[0])).toEqual(["oracle", "stock", "oracle"]);
    expect(goldFill(check({ gold_classes: { named: 30, not_named: 8 } }), { anchors: pool.filter((a) => a.kind === "oracle"), findings }, p).still_short).toEqual(["named_class"]);
  });
  test("a validity shortfall takes seeded extra findings; an empty pool is named", () => {
    const f = goldFill(check({ gold_findings: 33, validity_classes: { supported: 25, unsupported: 8 } }), { anchors: pool, findings }, p);
    expect(f.findings.length).toBe(7);
    expect(new Set(f.findings).size).toBe(7);
    expect(f.findings).not.toEqual(findings.slice(0, 7));
    expect(goldFill(check({ gold_findings: 33 }), { anchors: pool, findings: [] }, p).still_short).toEqual(["validity"]);
  });
});

describe("section 5: the pass A prompt carries the atomization rules", () => {
  const prompt = passAPacket("REPORT TEXT");
  test("a table row and its later evidence block are one finding, and duplicates merge", () => {
    expect(prompt).toContain("A table row and its later evidence block are one finding, and the same issue said twice is one finding.");
  });
  test("checked-and-safe items, plans to check, ruled-out items, general advice and coverage notes are not findings", () => {
    expect(prompt).toContain("Not findings: plans to check something, items framed as checked and safe, items the text itself rules out, general advice that names no defect, and coverage notes.");
  });
  test("the definition, the order rule and the report come through, with no answer key", () => {
    expect(prompt).toContain("whatever its severity label, informational and dependency findings included");
    expect(prompt).toContain("Order: findings in order of first appearance in the final message, then findings that appear only in earlier messages");
    expect(prompt).toContain("You see no answer key.");
    expect(prompt.endsWith("=== Report ===\n\nREPORT TEXT")).toBe(true);
  });
});

describe("section 7: the extra findings pool", () => {
  const reps = [{ id: "r1", findings_total: 13 }, { id: "r2", findings_total: 10 }, { id: "r3", findings_total: 12 }, { id: "r4" }] as unknown as Parameters<typeof extraFindingPool>[0];
  test("pass A findings past the first 10 of check-set reports, one id each", () => {
    expect(extraFindingPool(reps, p)).toEqual(["r1#11", "r1#12", "r1#13", "r3#11", "r3#12"]);
  });
  test("a validity shortfall draws from it in check_seed order, whatever order the reports came in", () => {
    const short = check({ gold_findings: 37 });
    const a = goldFill(short, { anchors: pool, findings: extraFindingPool(reps, p) }, p);
    expect(a.findings.length).toBe(3);
    expect(goldFill(short, { anchors: pool, findings: extraFindingPool([...reps].reverse(), p) }, p).findings).toEqual(a.findings);
    expect(goldFill(check({ gold_findings: 30 }), { anchors: pool, findings: extraFindingPool(reps, p) }, p)).toMatchObject({ findings: expect.any(Array), still_short: ["validity"] });
  });
});
