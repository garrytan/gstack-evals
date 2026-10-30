import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArm } from "../../lanes/review-noloss/contract.ts";
import { buildExport, loadArms, renderExport } from "../../lanes/review-noloss/export.ts";
import { ARMS_ROOT, readIngested, snapshot } from "../../lanes/review-noloss/ingest.ts";
import { armMetrics, pairedCost, scoreComparisons, ScoreError, type Comparison, type ScoredArm } from "../../lanes/review-noloss/score.ts";
import { loadSuite, REPO_ROOT } from "../../lanes/review-noloss/suite.ts";
import { cleanup, editArm, editJudgments, run, tmp, writeArm } from "./helpers.ts";

afterAll(cleanup);
const { suite, sha256 } = loadSuite("gsta167-14pr");
const COMPARISONS = join(REPO_ROOT, "lanes/review-noloss/comparisons/gsta167-14pr.json");
const legacy = loadArms(ARMS_ROOT, suite, sha256);
const files = (id: string) => readIngested(join(ARMS_ROOT, "gsta167-14pr", id), suite, sha256).files;
const scored = (f: Map<string, Buffer>): ScoredArm => ({ arm: parseArm(f, suite, sha256), tree_sha256: "test" });
const opts = { seed: 1, draws: 2000 };
const cmp = (variant: string, reference: string, extra: Partial<Comparison> = {}): Comparison => ({ id: variant + "-vs-" + reference, variant, reference, margin_points: 10, margin_reason: "test margin", post_hoc: true, frozen_bar: null, ...extra });
const refusal = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    if (e instanceof ScoreError) return e;
    throw e;
  }
  throw new Error("expected a refusal");
};
const renamed = (base: Map<string, Buffer>, id: string) => editArm(base, (a) => (a.id = id));

describe("legacy arms, as the scorer reports them", () => {
  test("blocking recall C 19/29, A' 12/29, A 11/29, B 8/29; detection C 20/29", () => {
    const found = Object.fromEntries([...legacy].map(([id, a]) => [id, armMetrics(suite, a, opts).blocking!.found]));
    expect(found).toEqual({ A: 11, A2: 12, B: 8, C: 19 });
    expect(armMetrics(suite, legacy.get("C")!, opts).detection!.found).toBe(20);
  });

  test("A', A and B each LOSS against C at 10 points, and B against A NOT_DISTINGUISHED", () => {
    const file = JSON.parse(readFileSync(COMPARISONS, "utf8"));
    const recs = scoreComparisons(suite, sha256, legacy, file.comparisons, opts);
    expect(recs.map((r) => [r.id, r.result.verdict, r.result.losses, r.result.gains, r.result.p_no_loss, r.result.p_loss, r.exit])).toEqual([
      ["A2-vs-C", "LOSS", 9, 2, 0.931091, 0.03125, 1],
      ["A-vs-C", "LOSS", 11, 3, 0.914246, 0.03125, 1],
      ["B-vs-C", "LOSS", 13, 2, 0.990479, 0.003906, 1],
      ["B-vs-A", "NOT_DISTINGUISHED", 3, 0, 0.548401, 0.125, 2],
    ]);
    expect(recs[3]!.result.min_p_loss).toBe(0.125);
    expect(recs.map((r) => [r.frozen_bar!.result, r.frozen_bar!.detail])).toEqual([
      ["FAIL", "misses 9 of the 19 blockers C found (allows 1)"],
      ["FAIL", "2 of 4 group (a) blockers found (needs all); 3 of 12 group (b) PRs hit (needs 11)"],
      ["FAIL", "1 of 4 group (a) blockers found (needs all); 2 of 12 group (b) PRs hit (needs 11)"],
      ["FAIL", "1 of 4 group (a) blockers found (needs all); 2 of 12 group (b) PRs hit (needs 11)"],
    ]);
    expect(recs[0]!.eligibility.reasons[0]).toBe("frozen bar, round 3: FAIL (misses 9 of the 19 blockers C found (allows 1))");
    for (const r of recs) {
      expect(r.judging.labelled).toBe(true);
      expect(r.eligibility.eligible).toBe(false);
    }
  });

  test("cost: C on its 12 metered PRs, and C and A' on the 11 metered in both, all upper bounds", () => {
    const c = armMetrics(suite, legacy.get("C")!, opts).cost!;
    expect([c.units, c.tokens_per_pass, c.per_unit_mean]).toEqual([12, 330276174, 27523015]);
    const p = pairedCost(suite, legacy.get("A2")!.arm, legacy.get("C")!.arm);
    if ("reason" in p) throw new Error(p.reason);
    expect([p.grade, p.reference.units, p.reference.tokens_per_pass, p.reference.per_unit_mean, p.reference.found, p.reference.per_blocker_found]).toEqual(["upper-bound", 11, 311112137, 28282922, 16, 19444509]);
    expect([p.variant.tokens_per_pass, p.variant.per_unit_mean, p.variant.found, p.variant.per_blocker_found]).toEqual([194864669, 17714970, 10, 19486467]);
    expect(pairedCost(suite, legacy.get("A")!.arm, legacy.get("C")!.arm)).toEqual({ reason: "arm A has no metered units" });
  });
});

describe("the decision rule and claim eligibility", () => {
  const twin = scored(renamed(files("C"), "C2"));
  const arms = new Map([...legacy, ["C2", twin]]);

  test("an arm identical to the reference gets p = 2^-14 and NO_LOSS, but unchecked it exits 2 with NOLOSS_UNDERPOWERED and no claim", () => {
    const [r] = scoreComparisons(suite, sha256, arms, [cmp("C2", "C")], opts);
    expect(r!.result).toMatchObject({ verdict: "NO_LOSS", p_no_loss: 0.000061, note: "no discordant blocker", losses: 0, gains: 0 });
    expect(r!.warnings).toEqual(["NOLOSS_UNDERPOWERED"]);
    expect(r!.exit).toBe(2);
    expect(r!.eligibility.eligible).toBe(false);
    expect(r!.eligibility.reasons).toContain("the size rule is unchecked");
  });

  test("a declared power decides the size rule: 0.9 exits 0 without the warning, 0.5 exits 2 below the rule", () => {
    const [ok] = scoreComparisons(suite, sha256, arms, [cmp("C2", "C", { size_rule: { power: 0.9, source: "test" } })], opts);
    expect([ok!.exit, ok!.warnings, ok!.size_rule.met]).toEqual([0, [], true]);
    expect(ok!.eligibility.reasons.some((x) => x.startsWith("post hoc"))).toBe(true);
    const [low] = scoreComparisons(suite, sha256, arms, [cmp("C2", "C", { size_rule: { power: 0.5, source: "test" } })], opts);
    expect([low!.exit, low!.warnings, low!.eligibility.reasons[0]]).toEqual([2, ["NOLOSS_UNDERPOWERED"], "below the size rule: power 0.5 is under 0.8"]);
  });

  test("Holm adjusts the no-loss p across the family, which can only make NO_LOSS harder", () => {
    const recs = scoreComparisons(suite, sha256, arms, [cmp("C2", "C"), cmp("A2", "C")], opts);
    expect(recs[0]!.result.p_no_loss_holm).toBe(0.000122);
    expect(recs[0]!.result.holm_family).toBe(2);
  });

  test("a true ceiling stays NOT_DISTINGUISHED with the reason", () => {
    const all = (id: string) => scored(editJudgments(renamed(files("C"), id), (_c, set) => set("F")));
    const [r] = scoreComparisons(suite, sha256, new Map([["X", all("X")], ["Y", all("Y")]]), [cmp("X", "Y")], opts);
    expect(r!.result).toMatchObject({ verdict: "NOT_DISTINGUISHED", p_no_loss: null, note: "ceiling: both arms found every blocker" });
  });

  test("a stopped arm, or blockers with coverage incomplete, get no verdict", () => {
    const stopped = scored(editArm(renamed(files("A2"), "S"), (a) => (a.status = "stopped")));
    const [s] = scoreComparisons(suite, sha256, new Map([...legacy, ["S", stopped]]), [cmp("S", "C")], opts);
    expect([s!.result.verdict, s!.exit, s!.result.no_verdict_reason]).toEqual([null, 2, "arm S stopped, so there is no verdict"]);
    const head = (f: Map<string, Buffer>) => {
      const m = new Map(f);
      const lines = m.get("judgments.tsv")!.toString("utf8").replace(/\n+$/, "").split("\n");
      m.set("judgments.tsv", Buffer.from([lines[0] + "\tcoverage", ...lines.slice(1).map((l, i) => (i === 3 ? l.replace(/\t$/, "\toutside voice did not run") + "\tincomplete" : l + "\t"))].join("\n") + "\n"));
      return m;
    };
    const inc = scored(head(renamed(files("A2"), "I")));
    const [i] = scoreComparisons(suite, sha256, new Map([...legacy, ["I", inc]]), [cmp("I", "C")], opts);
    expect(i!.result.verdict).toBe(null);
    expect(i!.result.no_verdict_reason).toContain("coverage incomplete");
  });

  test("refuses a missing margin, a raw arm, and pooling labelled with blind judgments", () => {
    expect(refusal(() => scoreComparisons(suite, sha256, legacy, [cmp("A2", "C", { margin_reason: " " })], opts)).code).toBe("E_USAGE");
    const example = snapshot(join(REPO_ROOT, "lanes/review-noloss/example/arm-example"));
    const raw = new Map(example);
    raw.delete("judgments.tsv");
    expect(refusal(() => scoreComparisons(suite, sha256, new Map([...legacy, ["example", scored(raw)]]), [cmp("example", "C")], opts)).code).toBe("E_NOLOSS_JUDGMENT");
    const pooled = refusal(() => scoreComparisons(suite, sha256, new Map([...legacy, ["example", scored(example)]]), [cmp("example", "C")], opts));
    expect([pooled.code, pooled.message]).toEqual(["E_NOLOSS_BLIND", expect.stringContaining("never pooled")]);
    const mixed = example.get("judgments.tsv")!.toString("utf8").replace("\tno\t", "\tyes\t");
    const m = new Map(example);
    m.set("judgments.tsv", Buffer.from(mixed));
    expect(refusal(() => scoreComparisons(suite, sha256, new Map([["example", scored(m)], ["e2", scored(renamed(example, "e2"))]]), [cmp("example", "e2")], opts)).message).toContain("mixes labelled and blind");
  });
});

describe("cost arithmetic", () => {
  const prs = suite.units.map((u) => u.pr);
  const withCost = (id: string, rows: string[], passes = 1) => {
    let f = renamed(files("C"), id);
    if (passes === 2) {
      const lines = f.get("judgments.tsv")!.toString("utf8").replace(/\n+$/, "").split("\n");
      f = new Map(f);
      f.set("judgments.tsv", Buffer.from([lines[0] + "\tpass", ...lines.slice(1).flatMap((l) => [l + "\t1", l + "\t2"])].join("\n") + "\n"));
      f = editArm(f, (a) => (a.passes = 2));
    }
    f.set("cost.tsv", Buffer.from(["pr\tscope\ttotal_tokens\tmeter_source\tcovers\tpass", ...rows].join("\n") + "\n"));
    return parseArm(f, suite, sha256);
  };
  const row = (pr: string | number, tokens: number, meter = "proxy-journal", covers = "", pass = "") => [pr, "all", tokens, meter, covers, pass].join("\t");

  test("partial overlap compares only the units metered in both arms", () => {
    const v = withCost("V", [row(3593, 100), row(3596, 200), row(3516, 300)]);
    const r = withCost("R", [row(3596, 1000), row(3516, 3000), row(3524, 5000, "estimate")]);
    const p = pairedCost(suite, v, r);
    if ("reason" in p) throw new Error(p.reason);
    expect([p.variant.units, p.variant.tokens_per_pass, p.variant.per_unit_median, p.reference.tokens_per_pass, p.reference.found, p.grade]).toEqual([2, 500, 250, 4000, 3, "exact"]);
  });

  test("an aggregate-only meter gives a mean but no median, and is never split to fit the other arm", () => {
    const agg = withCost("R", [row("*", 14000, "root-counter-delta", prs.join(" "))]);
    const full = withCost("V", prs.map((pr) => row(pr, 100)));
    const p = pairedCost(suite, full, agg);
    if ("reason" in p) throw new Error(p.reason);
    expect([p.reference.units, p.reference.per_unit_mean, p.reference.per_unit_median, p.grade]).toEqual([14, 1000, null, "upper-bound"]);
    expect(p.reference.notes).toContain("a pr * row has no per-unit values, so there is no median");
    const short = withCost("V", prs.slice(1).map((pr) => row(pr, 100)));
    const q = pairedCost(suite, short, agg);
    expect("reason" in q && q.reason).toContain("it is not split");
  });

  test("a unit inside a pr * row is not counted twice, and repeated passes are averaged per pass", () => {
    const dbl = armMetrics(suite, { arm: withCost("V", [...prs.map((pr) => row(pr, 100)), row("*", 50, "proxy-journal", "3593 3596")]), tree_sha256: "t" }, opts).cost!;
    expect([dbl.units, dbl.tokens_per_pass]).toEqual([14, 1250]);
    expect(dbl.notes[0]).toContain("2 units with their own total inside a pr * row");
    const overlap = armMetrics(suite, { arm: withCost("O", [row("*", 200, "proxy-journal", "3593 3596"), row("*", 200, "proxy-journal", "3596 3516"), row(3524, 100)]), tree_sha256: "t" }, opts).cost!;
    expect([overlap.units, overlap.tokens_per_pass]).toEqual([1, 100]);
    const two = armMetrics(suite, { arm: withCost("P", [row(3593, 100, "proxy-journal", "", "1"), row(3593, 300, "proxy-journal", "", "2"), row(3596, 1000), row(3516, 70, "proxy-journal", "", "1")], 2), tree_sha256: "t" }, opts).cost!;
    expect([two.units, two.tokens_per_pass, two.per_unit_median]).toEqual([2, 700, 350]);
    expect(two.notes).toContain("1 units with totals for only some passes, so not metered");
  });
});

describe("noloss score and export commands", () => {
  test("exit 1 on LOSS, 2 on NOT_DISTINGUISHED, and no default margin", async () => {
    const loss = await run(["score", "--suite", "gsta167-14pr", "--variant", "B", "--reference", "C", "--margin", "10", "--margin-reason", "test", "--json"]);
    expect([loss.code, JSON.parse(loss.out).result.verdict, JSON.parse(loss.out).version]).toEqual([1, "LOSS", 1]);
    const nd = await run(["score", "--suite", "gsta167-14pr", "--variant", "B", "--reference", "A", "--prereg", COMPARISONS]);
    expect(nd.code).toBe(2);
    expect(nd.out).toContain("(Holm 1.000 over 4)");
    expect(nd.out.split("\n")[0]).toStartWith("labelled judging, transcribed (B, A), post hoc: frozen bar, round 2: B FAIL");
    const none = await run(["score", "--suite", "gsta167-14pr", "--variant", "B", "--reference", "A"]);
    expect([none.code, none.err.split("\n")[0]]).toEqual([2, expect.stringContaining("E_USAGE noloss score needs --margin")]);
  });

  test("the committed table is fresh, a stale copy fails with E_NOLOSS_STALE, and the render never says a bare no loss", async () => {
    expect((await run(["export", "--check"])).code).toBe(0);
    const stale = join(tmp(), "table.json");
    writeFileSync(stale, readFileSync(join(REPO_ROOT, "tables/review-noloss.json"), "utf8").replace('"seed": 1', '"seed": 2'));
    const r = await run(["export", "--check", "--table", stale]);
    expect([r.code, r.err.split("\n")[0]]).toEqual([2, expect.stringMatching(/^E_NOLOSS_STALE/)]);
    const md = renderExport(buildExport({ comparisons: COMPARISONS, root: ARMS_ROOT }));
    expect(md).not.toMatch(/\bno loss\b/i);
    const verdictLines = md.split("\n").filter((l) => / vs [A-Z]/.test(l) && l.includes("margin"));
    expect(verdictLines.length).toBe(4);
    for (const l of verdictLines) expect(l).toStartWith("- labelled judging");
  }, 60_000);

  test("a sealed suite: arms, records and tables inside the repo are refused, and the table outside holds no unit ids", async () => {
    const dir = tmp();
    const sealedPath = join(dir, "sealed-suite.json");
    writeFileSync(sealedPath, JSON.stringify({ ...suite, sealed: true }));
    const sealed = loadSuite(sealedPath);
    expect(() => readIngested(join(ARMS_ROOT, "gsta167-14pr", "C"), sealed.suite, sealed.sha256)).toThrow(/sealed/);
    const root = join(dir, "arms");
    for (const id of ["A2", "C"]) expect((await run(["ingest", writeArm(join(dir, "src", id), files(id)), "--suite", sealedPath, "--root", root])).code).toBe(0);
    const ok = await run(["score", "--suite", sealedPath, "--variant", "A2", "--reference", "C", "--margin", "10", "--margin-reason", "test", "--root", root, "--out", join(dir, "rec.json")]);
    expect(ok.code).toBe(1);
    const inRepo = join(REPO_ROOT, "tables", "sealed-test.json");
    expect((await run(["score", "--suite", sealedPath, "--variant", "A2", "--reference", "C", "--margin", "10", "--margin-reason", "test", "--root", root, "--out", inRepo])).code).toBe(2);
    const comparisons = join(dir, "comparisons.json");
    writeFileSync(comparisons, JSON.stringify({ schema_version: 1, suite: sealedPath, decision_rule: "test", seed: 1, draws: 1000, comparisons: [cmp("A2", "C")] }));
    const refused = await run(["export", "--comparisons", comparisons, "--root", root, "--table", inRepo]);
    expect([refused.code, refused.err.split("\n")[0]]).toEqual([2, expect.stringMatching(/^E_NOLOSS_SUITE/)]);
    expect(existsSync(inRepo)).toBe(false);
    const table = join(dir, "table.json");
    expect((await run(["export", "--comparisons", comparisons, "--root", root, "--table", table])).code).toBe(0);
    const text = readFileSync(table, "utf8");
    expect(text).toContain('"sealed": true');
    expect(text).not.toContain("garrytan/gstack#");
  });
});
