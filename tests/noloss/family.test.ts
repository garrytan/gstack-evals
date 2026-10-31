import { afterAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { holmAdjusted, seededRandom } from "../../src/runner/stats/paired.ts";
import { loadArms, loadComparisons } from "../../lanes/review-noloss/export.ts";
import { ARMS_ROOT, readIngested } from "../../lanes/review-noloss/ingest.ts";
import { scoreComparisons, type Comparison } from "../../lanes/review-noloss/score.ts";
import { holmSteps, twoSidedSignFlip } from "../../lanes/review-noloss/stats.ts";
import { loadSuite } from "../../lanes/review-noloss/suite.ts";
import { readScoreRun } from "../../lanes/review-noloss/verdict.ts";
import { cleanup, editArm, run, tmp, writeArm } from "./helpers.ts";

afterAll(cleanup);
const { suite, sha256 } = loadSuite("gsta167-14pr");
const legacy = new Map([...loadArms(ARMS_ROOT, suite, sha256)].filter(([id]) => ["A", "A2", "B", "C"].includes(id)));
const opts = { seed: 1, draws: 2000 };
const cmp = (variant: string, reference: string): Comparison => ({ id: variant + "-vs-" + reference, variant, reference, margin_points: 10, margin_reason: "test margin", post_hoc: true, frozen_bar: null });
const loss = (cs: Comparison[], order: string[] | null, nul: "zero" | "margin" = "zero") =>
  scoreComparisons(suite, sha256, legacy, cs, { ...opts, ...(order ? { lossFamily: { order, null: nul, reason: "test" } } : {}) });
const row = (r: ReturnType<typeof loss>[number]) => [r.id, r.result.verdict, r.result.p_loss, r.result.p_loss_holm, r.result.loss_family?.step ?? null];

describe("Holm's step-down over a declared LOSS family", () => {
  test("steps in order of p, ties in declared order, and adjusted p never falls; it equals the kit's holmAdjusted", () => {
    const h = holmSteps([0.03, 0.001, 0.04, 0.02]);
    expect([h.adjusted.map((x) => +x.toFixed(6)), h.step]).toEqual([[0.06, 0.004, 0.06, 0.06], [3, 1, 4, 2]]);
    expect(holmSteps([0.01, 0.01]).step).toEqual([1, 2]);
    const rng = seededRandom(5);
    for (let t = 0; t < 200; t++) {
      const p = Array.from({ length: 1 + Math.floor(rng() * 6) }, () => Math.round(rng() * 1000) / 1000);
      const s = holmSteps(p);
      expect(s.adjusted).toEqual(holmAdjusted(p));
      const byStep = p.map((_, i) => i).sort((x, y) => s.step[x]! - s.step[y]!).map((i) => s.adjusted[i]!);
      for (let i = 1; i < byStep.length; i++) expect(byStep[i]!).toBeGreaterThanOrEqual(byStep[i - 1]!);
    }
  });

  test("two comparisons: B against C steps first, and both stay LOSS after adjustment", () => {
    expect(loss([cmp("A2", "C"), cmp("B", "C")], ["A2-vs-C", "B-vs-C"]).map(row)).toEqual([
      ["A2-vs-C", "LOSS", 0.03125, 0.03125, 2],
      ["B-vs-C", "LOSS", 0.003906, 0.007813, 1],
    ]);
  });

  test("four comparisons with mirrors: only B against C stays LOSS, and the mirrors step last", () => {
    const recs = loss([cmp("A2", "C"), cmp("B", "C"), cmp("C", "A2"), cmp("C", "B")], ["A2-vs-C", "B-vs-C", "C-vs-A2", "C-vs-B"]);
    expect(recs.slice(0, 2).map(row)).toEqual([
      ["A2-vs-C", "NOT_DISTINGUISHED", 0.03125, 0.09375, 2],
      ["B-vs-C", "LOSS", 0.003906, 0.015625, 1],
    ]);
    for (const r of recs.slice(2)) {
      expect(r.result.verdict).not.toBe("LOSS");
      expect(r.result.p_loss_holm!).toBeGreaterThanOrEqual(r.result.p_loss!);
      expect(r.result.loss_family!.step).toBeGreaterThan(2);
    }
    expect(loss([cmp("A2", "C")], null).map(row)).toEqual([["A2-vs-C", "LOSS", 0.03125, null, null]]);
  });

  test("monotonicity: in the legacy family of four, A against C is raised from 0.0625 to the step before it", () => {
    const recs = loss([cmp("A2", "C"), cmp("A", "C"), cmp("B", "C"), cmp("B", "A")], ["A2-vs-C", "A-vs-C", "B-vs-C", "B-vs-A"]);
    expect(recs.map((r) => [r.id, r.result.verdict, r.result.p_loss_holm])).toEqual([
      ["A2-vs-C", "NOT_DISTINGUISHED", 0.09375],
      ["A-vs-C", "NOT_DISTINGUISHED", 0.09375],
      ["B-vs-C", "LOSS", 0.015625],
      ["B-vs-A", "NOT_DISTINGUISHED", 0.125],
    ]);
  });

  test("the margin null tests 'worse by more than the margin', a harder LOSS than the zero null", () => {
    const [m] = loss([cmp("B", "C")], ["B-vs-C"], "margin");
    expect(m!.result.p_loss!).toBeGreaterThan(0.003906);
    expect(m!.result.loss_family).toEqual({ size: 1, position: 1, step: 1, null: "margin", null_points: 10 });
  });

  test("a comparisons file declares the family; score --prereg shows raw and adjusted p, and a bad order is refused", async () => {
    const dir = tmp();
    const file = { schema_version: 1, suite: "gsta167-14pr", decision_rule: "test", seed: 1, draws: 1000, comparisons: [cmp("A2", "C"), cmp("B", "C")], loss_family: { order: ["B-vs-C", "A2-vs-C"], null: "zero", reason: "test" } };
    const ok = join(dir, "ok.json");
    writeFileSync(ok, JSON.stringify(file));
    const r = await run(["score", "--suite", "gsta167-14pr", "--variant", "A2", "--reference", "C", "--prereg", ok]);
    expect(r.out).toContain("p loss 0.031 (Holm 0.031, step 2 of 2 in the declared LOSS family)");
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ ...file, loss_family: { ...file.loss_family, order: ["B-vs-C", "nope"] } }));
    expect(() => loadComparisons(bad)).toThrow(/loss_family.order/);
  });
});

describe("exact two-sided sign-flip", () => {
  test("equals brute-force enumeration of P(|S| >= |observed|)", () => {
    expect(twoSidedSignFlip([-1, -1, -1, -1, -1, 0, 0])).toEqual({ p: 0.0625, min_p: 0.0625, informative_clusters: 5 });
    expect(twoSidedSignFlip([1, -1]).p).toBe(1);
    const rng = seededRandom(9);
    for (let t = 0; t < 100; t++) {
      const v = Array.from({ length: 2 + Math.floor(rng() * 8) }, () => Math.floor(rng() * 7) - 3);
      const o = Math.abs(v.reduce((s, x) => s + x, 0));
      let hit = 0;
      for (let m = 0; m < 2 ** v.length; m++) if (Math.abs(v.reduce((s, x, i) => s + (m & (1 << i) ? -x : x), 0)) >= o) hit++;
      expect(twoSidedSignFlip(v).p!).toBeCloseTo(hit / 2 ** v.length, 12);
    }
  });
});

describe("reading a score run: the verdict line and the first reason code, never exit 2 alone", () => {
  const dir = tmp();
  const root = join(dir, "arms");
  const files = (id: string) => readIngested(join(ARMS_ROOT, "gsta167-14pr", id), suite, sha256).files;
  const score = (v: string, r: string, extra: string[] = [], where = ["--root", root]) => run(["score", "--suite", "gsta167-14pr", "--variant", v, "--reference", r, "--margin", "10", "--margin-reason", "test", ...where, ...extra]);
  const read = (x: { code: number; out: string; err: string }) => readScoreRun({ exit: x.code, stdout: x.out, stderr: x.err });

  test("one fixture per outcome", async () => {
    const arms: Array<[string, Map<string, Buffer>]> = [["C", files("C")], ["A2", files("A2")], ["T", editArm(files("C"), (a) => (a.id = "T"))], ["S", editArm(files("A2"), (a) => ((a.id = "S"), (a.status = "stopped")))]];
    for (const [id, f] of arms) expect((await run(["ingest", writeArm(join(dir, "src", id), f), "--suite", "gsta167-14pr", "--root", root])).code).toBe(0);
    const lossRun = await score("A2", "C");
    expect([lossRun.code, read(lossRun)]).toEqual([1, { kind: "verdict", verdict: "LOSS", claim: false, code: "LOSS", key: "LOSS" }]);
    const nd = await score("B", "A", [], []);
    expect(read(nd)).toEqual({ kind: "verdict", verdict: "NOT_DISTINGUISHED", claim: false, code: "NOT_DISTINGUISHED", key: "NOT_DISTINGUISHED" });
    const claim = await score("T", "C", ["--power", "0.9", "--power-source", "test"]);
    expect([claim.code, read(claim)]).toEqual([0, { kind: "verdict", verdict: "NO_LOSS", claim: true, code: null, key: "NO_LOSS" }]);
    const under = await score("T", "C");
    expect(under.out.split("\n").at(-1)).toBe("verdict: NO_LOSS NOLOSS_UNDERPOWERED");
    expect(read(under)).toEqual({ kind: "verdict", verdict: "NO_LOSS", claim: false, code: "NOLOSS_UNDERPOWERED", key: "NOLOSS_UNDERPOWERED" });
    const none = await score("S", "C");
    expect(read(none)).toEqual({ kind: "no_verdict", verdict: null, claim: false, code: null, key: "NO_VERDICT" });
    const refused = await score("Z", "C");
    expect(read(refused)).toEqual({ kind: "refusal", verdict: null, claim: false, code: "E_NOLOSS_ARM", key: "E_NOLOSS_ARM" });
    const usage = await run(["score", "--suite", "gsta167-14pr", "--variant", "T", "--reference", "C"]);
    expect(read(usage).key).toBe("E_USAGE");
    expect([nd, under, none, refused, usage].map((x) => x.code)).toEqual([2, 2, 2, 2, 2]);
    expect(() => readScoreRun({ exit: 2, stdout: "verdict: LOSS", stderr: "" })).toThrow(/exits 1, not 2/);
  });

  test("the underpowered case through the JSON record: NO_LOSS with the warning, no claim, apart from the exit code", async () => {
    const r = await score("T", "C", ["--json"]);
    const rec = JSON.parse(r.out);
    expect([rec.result.verdict, rec.warnings, rec.size_rule.met, rec.eligibility.eligible, rec.exit]).toEqual(["NO_LOSS", ["NOLOSS_UNDERPOWERED"], null, false, 2]);
    expect(rec.eligibility.reasons).toContain("the size rule is unchecked");
    expect(read(r).key).toBe("NOLOSS_UNDERPOWERED");
  });

  test("--expect exits 0 only on an outcome it lists, and names the outcome otherwise", async () => {
    expect((await score("A2", "C", ["--expect", "LOSS"])).code).toBe(0);
    expect((await score("T", "C", ["--expect", "NOT_DISTINGUISHED,NOLOSS_UNDERPOWERED"])).code).toBe(0);
    expect((await score("Z", "C", ["--expect", "E_NOLOSS_ARM"])).code).toBe(0);
    const miss = await score("Z", "C", ["--expect", "NOLOSS_UNDERPOWERED,NOT_DISTINGUISHED"]);
    expect([miss.code, miss.err.split("\n").find((l) => l.startsWith("E_NOLOSS_EXPECT"))]).toEqual([2, expect.stringContaining("outcome is E_NOLOSS_ARM")]);
    expect((await score("A2", "C", ["--expect", "MAYBE"])).err).toStartWith("E_USAGE");
  });
});
