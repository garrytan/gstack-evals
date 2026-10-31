import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ContractError, parseArm } from "../../lanes/review-noloss/contract.ts";
import { ARMS_ROOT, readIngested, snapshot } from "../../lanes/review-noloss/ingest.ts";
import { armMetrics, scoreComparisons, type Comparison, type FalseBlockerReading } from "../../lanes/review-noloss/score.ts";
import { loadSuite, REPO_ROOT } from "../../lanes/review-noloss/suite.ts";
import { cleanup, editArm, run, tmp, writeArm } from "./helpers.ts";

afterAll(cleanup);
// A synthetic copy of the suite in which 3596's B2 is the unit's known informational case (over-blocking).
const dir = tmp("noloss-adj-");
const suitePath = join(dir, "suite.json");
const base = loadSuite("gsta167-14pr").suite;
writeFileSync(suitePath, JSON.stringify({ ...base, units: base.units.map((u) => (u.pr === 3596 ? { ...u, blockers: u.blockers.map((b) => (b.id === "B2" ? { ...b, counts: "over-blocking" } : b)) } : u)) }));
const { suite, sha256 } = loadSuite(suitePath);
const example = snapshot(join(REPO_ROOT, "lanes/review-noloss/example/arm-example"));
const blocking = (id: string, n: number) => JSON.stringify({ id, severity: "CRITICAL", path: "lib/x.ts", line: n, summary: "Synthetic unmatched blocking finding number " + n + ".", reader: "testing" });
const build = (id: string, label: string, extra: Record<string, string[]>) => {
  const f = new Map(editArm(example, (a) => ((a.id = id), (a.label = label))));
  for (const [pr, lines] of Object.entries(extra)) {
    const old = f.get("findings/" + pr + ".jsonl")!.toString("utf8").replace(/\n*$/, "");
    f.set("findings/" + pr + ".jsonl", Buffer.from((old ? old + "\n" : "") + lines.join("\n") + "\n"));
  }
  return f;
};
// alpha raises one unmatched blocking finding (v1). beta raises six (r1 to r6) and matches the informational case
// of 3596 at CRITICAL (r-ob), which judgments.tsv already rules: it over-blocks.
const alpha = build("alpha", "Alpha arm (synthetic)", { "3593": [blocking("v1", 1)] });
const beta = (() => {
  const f = build("beta", "Beta arm (synthetic)", { "3593": [blocking("r1", 2)], "3596": [blocking("r-ob", 3), blocking("r6", 4)], "3516": [blocking("r2", 5)], "3524": [blocking("r3", 6)], "3526": [blocking("r4", 7)], "3527": [blocking("r5", 8)] });
  const rows = f.get("judgments.tsv")!.toString("utf8").replace(/\n+$/, "").split("\n").map((l) => {
    const c = l.split("\t");
    if (c[0] === "3596" && c[1] === "B2") [c[2], c[3], c[4], c[5], c[8]] = ["F", "r-ob", "CRITICAL", "CRITICAL", ""];
    return c.join("\t");
  });
  f.set("judgments.tsv", Buffer.from(rows.join("\n") + "\n"));
  return f;
})();
const HEAD = "pr\tfinding\tpass\truling\tjudge\tsaw_label\tversion\tbatch\tnote";
const adj = (rows: string[][], head = HEAD, tail = ["judge one", "no", "1", "test", ""]) => Buffer.from([head, ...rows.map((r) => [...r, ...tail].join("\t"))].join("\n") + "\n");
const RULED: Record<string, string> = { v1: "defect", r1: "not-defect", r2: "not-defect", r3: "not-defect", r4: "defect", r5: "not-defect", r6: "known-informational" };
const PR: Record<string, string> = { v1: "3593", r1: "3593", r6: "3596", r2: "3516", r3: "3524", r4: "3526", r5: "3527" };
const rowsFor = (ids: string[]) => ids.map((id) => [PR[id]!, id, "1", RULED[id]!]);
const withAdj = (f: Map<string, Buffer>, ids: string[]) => new Map(f).set("adjudication.tsv", adj(rowsFor(ids)));
const parse = (f: Map<string, Buffer>) => parseArm(f, suite, sha256);
const refusal = (f: Map<string, Buffer>) => {
  try {
    parse(f);
  } catch (e) {
    if (e instanceof ContractError) return e;
    throw e;
  }
  throw new Error("expected a refusal");
};
const cmp = (extra: Partial<Comparison> = {}): Comparison => ({ id: "alpha-vs-beta", variant: "alpha", reference: "beta", margin_points: 10, margin_reason: "test", post_hoc: true, frozen_bar: null, ...extra });
const score = (a: Map<string, Buffer>, b: Map<string, Buffer>, extra: Partial<Comparison> = {}) =>
  scoreComparisons(suite, sha256, new Map([["alpha", { arm: parse(a), tree_sha256: "t" }], ["beta", { arm: parse(b), tree_sha256: "t" }]]), [cmp(extra)], { seed: 1, draws: 2000 })[0]!;
const ALPHA_IDS = ["v1"];
const BETA_IDS = ["r1", "r2", "r3", "r4", "r5", "r6"];

describe("adjudication.tsv in arm contract v1", () => {
  test("one row per unmatched blocking finding per pass parses, and a missing row is not an error", () => {
    expect(parse(withAdj(beta, BETA_IDS)).adjudications!.map((a) => [a.finding.id, a.ruling])).toEqual(BETA_IDS.map((id) => [id, RULED[id]]));
    expect(parse(withAdj(beta, ["r1"])).adjudications!.length).toBe(1);
  });

  test("refuses a matched finding, an informational one, a misplaced known-informational, a repeat, a version and a header", () => {
    const cases: Array<[string[][], string]> = [
      [[["3593", "ex-3593-b1", "1", "not-defect"]], "judgments.tsv already rules"],
      [[["3593", "#2", "1", "not-defect"]], "maps to INFORMATIONAL"],
      [[["3593", "r1", "1", "known-informational"]], "has no over-blocking blocker"],
      [[["3593", "r1", "1", "not-defect"], ["3593", "r1", "1", "defect"]], "a second row"],
      [[["3593", "r1", "1", "maybe"]], "is not defect, not-defect, known-informational"],
    ];
    for (const [rows, msg] of cases) {
      const e = refusal(new Map(beta).set("adjudication.tsv", adj(rows)));
      expect([e.code, e.message]).toEqual(["E_NOLOSS_ADJUDICATION", expect.stringContaining(msg)]);
    }
    expect(refusal(new Map(beta).set("adjudication.tsv", adj([["3593", "r1", "1", "defect"]], HEAD, ["j", "no", "2", "", ""]))).message).toContain("is not adjudication version 1");
    expect(refusal(new Map(beta).set("adjudication.tsv", adj([["3593", "r1", "1", "defect"]], HEAD.replace("\tversion", ""), ["j", "no", "", ""]))).message).toContain("missing column(s) version");
    const transcribed = new Map(readIngested(join(ARMS_ROOT, "gsta167-14pr", "C"), base, loadSuite("gsta167-14pr").sha256).files).set("adjudication.tsv", adj([]));
    expect(refusal(transcribed).message).toContain("no findings to adjudicate");
  });
});

describe("the false-blocker reading", () => {
  test("per PR, paired: the difference, its interval, the exact two-sided test and the smallest drop that counts", () => {
    const rec = score(withAdj(alpha, ALPHA_IDS), withAdj(beta, BETA_IDS), { false_blocker_drop: 0.4 });
    const fb = rec.false_blockers as FalseBlockerReading;
    expect([fb.complete, fb.per_pr, fb.difference, fb.p_two_sided, fb.min_p, fb.drop, fb.clears_drop, fb.prs]).toEqual([true, { variant: 0, reference: 0.4286 }, -0.4286, 0.0625, 0.0625, 0.4, true, 14]);
    expect(fb.table.find((t) => t.pr.endsWith("#3596"))).toEqual({ pr: "garrytan/gstack#3596", variant: 0, reference: 2, difference: -2, variant_unadjudicated: 0, reference_unadjudicated: 0 });
    expect((score(withAdj(alpha, ALPHA_IDS), withAdj(beta, BETA_IDS), { false_blocker_drop: 0.5 }).false_blockers as FalseBlockerReading).clears_drop).toBe(false);
    const m = armMetrics(suite, { arm: parse(withAdj(beta, BETA_IDS)), tree_sha256: "t" }, { seed: 1, draws: 2000 });
    expect(m.false_blockers).toEqual({ per_pr: 0.4286, not_defect: 4, known_informational: 2, new_blockers: 1, unadjudicated: 0, labelled: false });
    expect(rec.eligibility.reasons.join("; ")).not.toContain("false-blocking bound");
  });

  test("a blocking finding with no row makes the reading incomplete; it is never counted as not a defect", () => {
    const rec = score(alpha, withAdj(beta, ["r1", "r2", "r3", "r4", "r6"]));
    const fb = rec.false_blockers as FalseBlockerReading;
    expect([fb.complete, fb.p_two_sided, fb.clears_drop, fb.per_pr.reference]).toEqual([false, null, null, 0.3571]);
    expect(fb.reasons).toEqual(["arm alpha has 1 blocking finding with no adjudication row", "arm beta has 1 blocking finding with no adjudication row"]);
    expect(fb.table.find((t) => t.pr.endsWith("#3527"))).toMatchObject({ reference: 0, reference_unadjudicated: 1 });
    expect(rec.eligibility.reasons).toContain("the variant's unmatched blocking findings are not adjudicated, so there is no false-blocking bound");
  });
});

describe("blinded adjudication: packet, rulings, join, ingest and score", () => {
  const root = join(dir, "arms");
  const packets = join(dir, "packets");
  const keyPath = join(dir, "key.json");
  const out = join(dir, "adjudicated");
  const armDir = (id: string) => join(root, suite.id, id);
  const save = (name: string, value: unknown) => {
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify(value));
    return p;
  };
  interface Key { batch: string; packets: Array<{ file: string; sha256: string }>; entries: Array<{ packet: string; opaque: string; finding: string }> }
  const reply = (key: Key, judge: string, flip: Record<string, string> = {}, only?: Set<string>) => ({
    batch: key.batch,
    judge,
    packets: key.packets.map((p) => ({ file: p.file, sha256: p.sha256, findings: key.entries.filter((e) => e.packet === p.file && (!only || only.has(e.packet + " " + e.opaque))).map((e) => ({ id: e.opaque, ruling: flip[e.finding] ?? RULED[e.finding] })) })).filter((p) => p.findings.length),
  });
  const named = (text: string) => new Set([...text.matchAll(/(packets\/\S+\.json) (F\d+)/g)].map((m) => m[1] + " " + m[2]));
  const joinRun = (extra: string[]) => run(["judge-join", "--suite", suitePath, "--key", keyPath, "--out", out, "--arm", armDir("alpha"), "--arm", armDir("beta"), ...extra]);

  test("packets hold only unmatched blocking findings, blinded, with the unit's known informational case", async () => {
    for (const [id, f] of [["alpha", alpha], ["beta", beta]] as const) expect((await run(["ingest", writeArm(join(dir, "src", id), f), "--suite", suitePath, "--root", root])).code).toBe(0);
    const r = await run(["judge-packet", "--suite", suitePath, "--arm", armDir("alpha"), "--arm", armDir("beta"), "--seed", "3", "--out", packets, "--key", keyPath, "--adjudicate"]);
    expect(r.code).toBe(0);
    expect(readdirSync(join(packets, "packets")).sort()).toEqual(["3516.json", "3524.json", "3526.json", "3527.json", "3593.json", "3596.json"]);
    const text = readdirSync(join(packets, "packets")).map((f) => readFileSync(join(packets, "packets", f), "utf8")).join("\n");
    for (const leak of ["alpha", "beta", "Alpha arm", "CRITICAL", "r-ob", "testing"]) expect(text).not.toContain(leak);
    const ob = JSON.parse(readFileSync(join(packets, "packets", "3596.json"), "utf8"));
    expect([ob.kind, ob.known_informational.map((b: { id: string }) => b.id), ob.findings.length]).toEqual(["adjudicate", ["B2"], 1]);
  });

  test("join waits for the second judge and the third read, then writes adjudication.tsv for both arms", async () => {
    const key: Key = JSON.parse(readFileSync(keyPath, "utf8"));
    const p1 = save("primary.json", reply(key, "judge one"));
    const wait2 = await joinRun(["--reply", p1]);
    expect([wait2.code, wait2.err]).toEqual([2, expect.stringContaining("scoring waits for the second judge")]);
    const need2 = named(wait2.err);
    expect(need2.size).toBe(6);
    const flipped = key.entries.find((e) => e.finding === "r2")!;
    const p2 = save("second.json", reply(key, "judge two", { r2: "defect" }, need2));
    const wait3 = await joinRun(["--reply", p1, "--second", p2]);
    expect(named(wait3.err)).toEqual(new Set([flipped.packet + " " + flipped.opaque]));
    const p3 = save("third.json", reply(key, "judge three", {}, named(wait3.err)));
    const done = await joinRun(["--reply", p1, "--second", p2, "--third", p3]);
    expect([done.code, done.out]).toEqual([0, expect.stringContaining("wrote adjudication.tsv for alpha, beta")]);
    const tsv = readFileSync(join(out, "beta", "adjudication.tsv"), "utf8");
    expect(tsv.split("\n").filter(Boolean).length).toBe(7);
    expect(tsv).toContain("judge three (third read)");
    expect(existsSync(join(out, "alpha", "adjudication.tsv"))).toBe(true);
  });

  test("the adjudicated arms ingest and score: a complete reading, a per-PR table and the verdict line", async () => {
    for (const id of ["alpha", "beta"]) expect((await run(["ingest", join(out, id), "--suite", suitePath, "--root", root, "--replace", "blind adjudication from the test batch"])).code).toBe(0);
    const r = await run(["score", "--suite", suitePath, "--variant", "alpha", "--reference", "beta", "--margin", "10", "--margin-reason", "test", "--root", root, "--false-blocker-drop", "0.5"]);
    expect(r.out).toContain("false blockers per PR: alpha 0.00, beta 0.43, difference -0.43 [95% CI");
    expect(r.out).toContain("two-sided p 0.063 (minimum reachable 0.063); smallest drop that counts 0.5 per PR: the estimate does not clear it");
    expect(r.out).toContain("| PR | alpha | beta | difference |");
    expect(r.out.split("\n").at(-1)).toStartWith("verdict: ");
  });
});
