import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { snapshot } from "../../lanes/review-noloss/ingest.ts";
import { REPO_ROOT } from "../../lanes/review-noloss/suite.ts";
import { cleanup, editArm, editJudgments, run, tmp, writeArm } from "./helpers.ts";

afterAll(cleanup);
const example = snapshot(join(REPO_ROOT, "lanes/review-noloss/example/arm-example"));
const U3593 = "garrytan/gstack#3593@89156431975e";
const U3596 = "garrytan/gstack#3596@0be7c3d44339";
const U3516 = "garrytan/gstack#3516@ee73419c3295";
const arm = (id: string, edit?: (a: Record<string, unknown>) => void) =>
  editArm(example, (a) => {
    a.id = id;
    a.label = id + " arm";
    delete a.coverage_gaps;
    edit?.(a);
  });
const miss = (files: Map<string, Buffer>, prs: string[]) =>
  editJudgments(files, (c, set) => {
    if (prs.includes(c[0]!) && c[2] !== "M") {
      set("M");
      c[3] = "";
    }
  });

describe("noloss derive: secondary readings score through the unchanged scorer (GST-452, GST-454)", () => {
  const dir = tmp("noloss-derive-");
  const root = join(dir, "arms");
  const comparisons = join(dir, "comparisons.json");
  const json = (name: string, value: unknown) => {
    writeFileSync(join(dir, name), typeof value === "string" ? value : JSON.stringify(value, null, 2));
    return join(dir, name);
  };
  const score = (suite: string, armsRoot: string, prereg: string, extra: string[] = []) => run(["score", "--suite", suite, "--root", armsRoot, "--prereg", prereg, "--variant", "beta", "--reference", "alpha", ...extra]);
  const deriveTo = (name: string, extra: string[]) => run(["derive", "--suite", "gsta167-14pr", "--comparisons", comparisons, "--root", root, "--id", name, "--out", join(dir, name), ...extra]);
  const derived = (name: string) => [join(dir, name, name + ".json"), join(dir, name, "arms"), join(dir, name, "comparisons." + name + ".json")] as const;

  test("setup: a complete arm and an arm stopped by a coverage gap get no verdict at the pin", async () => {
    json("comparisons.json", { schema_version: 1, suite: "gsta167-14pr", decision_rule: "test rule", seed: 1, draws: 1000, comparisons: [{ id: "beta-vs-alpha", variant: "beta", reference: "alpha", margin_points: 10, margin_reason: "test", post_hoc: false, frozen_bar: null, false_blocker_drop: 0.5 }], loss_family: { order: ["beta-vs-alpha"], null: "zero", reason: "test" } });
    const beta = miss(arm("beta", (a) => {
      a.status = "stopped";
      a.coverage_gaps = [U3593 + " pass 1: incomplete, the session timed out"];
      a.parse_outcomes = { findings: 13, incomplete: 1, not_run: 0 };
    }), ["3526", "3527", "3534", "3567"]);
    for (const [id, files] of [["alpha", arm("alpha")], ["beta", beta]] as const) expect((await run(["ingest", writeArm(join(dir, "src", id), files), "--suite", "gsta167-14pr", "--root", root])).code).toBe(0);
    const r = await score("gsta167-14pr", root, comparisons, ["--expect", "NO_VERDICT"]);
    expect([r.code, r.out]).toEqual([0, expect.stringContaining("arm beta stopped, so there is no verdict")]);
  });

  test("a comparisons file that names a suite path is still refused, so a derived file names the derived id", async () => {
    const byPath = json("by-path.json", { ...JSON.parse(readFileSync(comparisons, "utf8")), suite: join(REPO_ROOT, "lanes/review-noloss/suites/gsta167-14pr.json") });
    const r = await score(join(REPO_ROOT, "lanes/review-noloss/suites/gsta167-14pr.json"), root, byPath);
    expect([r.code, r.err]).toEqual([2, expect.stringMatching(/^E_USAGE .*--prereg is for suite/)]);
  });

  test("complete case: --drop-gaps drops the gap unit for every arm, the stopped arm becomes complete and scores", async () => {
    const d = await deriveTo("gsta167-cc", ["--drop-gaps"]);
    expect(d.code).toBe(0);
    expect(d.out).toContain("arm beta: stopped -> complete");
    expect(d.out).toContain("13 units, 27 blocking blockers on 13 PRs; 1 units dropped (" + U3593 + ")");
    const [suite, armsRoot, prereg] = derived("gsta167-cc");
    const s = JSON.parse(readFileSync(suite, "utf8"));
    expect(s.excluded.at(-1)).toEqual({ ref: U3593, reason: "dropped by noloss derive: a coverage gap in arm beta" });
    const c = JSON.parse(readFileSync(prereg, "utf8"));
    expect([c.suite, c.seed, c.draws, c.loss_family]).toEqual(["gsta167-cc", 1, 1000, { order: ["beta-vs-alpha"], null: "zero", reason: "test" }]);
    const betaArm = JSON.parse(readFileSync(join(armsRoot, "gsta167-cc", "beta", "arm.json"), "utf8"));
    expect([betaArm.status, betaArm.coverage_gaps, betaArm.suite, betaArm.derived.status_before]).toEqual(["complete", undefined, "gsta167-cc", "stopped"]);
    expect(readFileSync(join(armsRoot, "gsta167-cc", "beta", "judgments.tsv"), "utf8")).not.toMatch(/^3593\t/m);
    expect(readFileSync(join(armsRoot, "gsta167-cc", "alpha", "cost.tsv"), "utf8")).not.toMatch(/^3593\t/m);
    const r = await score(suite, armsRoot, prereg, ["--json"]);
    const rec = JSON.parse(r.out);
    expect([rec.suite.id, rec.result.blockers, rec.result.no_verdict_reason]).toEqual(["gsta167-cc", 27, null]);
    expect(["LOSS", "NOT_DISTINGUISHED"]).toContain(rec.result.verdict);
    expect(rec.false_blockers.prs).toBe(13);
  });

  test("without flagged: --drop-file drops listed units; a gap elsewhere keeps the arm stopped", async () => {
    const flags = json("flags.tsv", "unit\tarm\tpass\n" + U3516 + "\tgstack\t1\n" + U3516 + "\tgstack\t2\n" + U3596 + "\tgstack\t1\n");
    const d = await deriveTo("gsta167-nf", ["--drop-file", flags]);
    expect(d.code).toBe(0);
    expect(d.out).toContain("12 units, 25 blocking blockers on 12 PRs; 2 units dropped");
    expect(d.out).toContain("arm beta: stopped, 1 coverage gaps left");
    const [suite, armsRoot, prereg] = derived("gsta167-nf");
    expect((await score(suite, armsRoot, prereg, ["--expect", "NO_VERDICT"])).code).toBe(0);
    const both = await deriveTo("gsta167-nf-cc", ["--drop-file", flags, "--drop-gaps"]);
    expect(both.out).toContain("11 units, 23 blocking blockers on 11 PRs; 3 units dropped");
    const [s2, a2, p2] = derived("gsta167-nf-cc");
    expect((await score(s2, a2, p2, ["--expect", "LOSS,NOT_DISTINGUISHED"])).code).toBe(0);
  });

  test("--detection-only moves a blocker out of blocking recall and keeps its judgments", async () => {
    const d = await deriveTo("gsta167-run", ["--drop-gaps", "--detection-only", "3527:B3", "--detection-only", "3545:B1"]);
    expect(d.code).toBe(0);
    const [suite, armsRoot, prereg] = derived("gsta167-run");
    const rec = JSON.parse((await score(suite, armsRoot, prereg, ["--json"])).out);
    expect(rec.result.blockers).toBe(25);
    expect(readFileSync(join(armsRoot, "gsta167-run", "alpha", "judgments.tsv"), "utf8")).toMatch(/^3527\tB3\t/m);
  });

  test("--severity-map recomputes outcomes from the judges' matches, per arm id or arm name", async () => {
    const map = json("map.json", { alpha: { default: { FIXABLE: "INFORMATIONAL", INVESTIGATE: "INFORMATIONAL", High: "CRITICAL", Medium: "INFORMATIONAL" } } });
    const d = await deriveTo("gsta167-sev", ["--drop-gaps", "--severity-map", map]);
    expect(d.code).toBe(0);
    const [suite, armsRoot, prereg] = derived("gsta167-sev");
    expect(readFileSync(join(armsRoot, "gsta167-sev", "alpha", "judgments.tsv"), "utf8")).toMatch(/^3516\tB2\tD\t[^\t]+\tFIXABLE\tINFORMATIONAL\t/m);
    expect(readFileSync(join(armsRoot, "gsta167-sev", "beta", "judgments.tsv"), "utf8")).toMatch(/^3516\tB2\tF\t[^\t]+\tFIXABLE\tCRITICAL\t/m);
    expect(JSON.parse((await score(suite, armsRoot, prereg, ["--json"])).out).result.verdict).not.toBe(null);
    const unknown = await deriveTo("gsta167-sev2", ["--severity-map", json("map2.json", { gamma: { default: {} } })]);
    expect([unknown.code, unknown.err]).toEqual([2, expect.stringMatching(/^E_USAGE .*key gamma names no arm/)]);
  });

  test("--impact re-maps every finding by one judge's impact rating, unrated findings non-blocking", async () => {
    const packets = join(dir, "packets");
    const keyPath = join(dir, "key.json");
    expect((await run(["judge-packet", "--suite", "gsta167-14pr", "--arm", join(root, "gsta167-14pr", "alpha"), "--arm", join(root, "gsta167-14pr", "beta"), "--seed", "7", "--out", packets, "--key", keyPath])).code).toBe(0);
    const key = JSON.parse(readFileSync(keyPath, "utf8")) as { entries: Array<{ packet: string; opaque: string; arm: string; finding: string }> };
    const rows = key.entries.filter((e) => e.finding !== "ex-3524-b1").map((e) => [e.packet, e.opaque, "judge-a", e.finding.startsWith("ex-") && e.finding.endsWith("b1") ? "blocking" : "non-blocking"].join("\t"));
    const impact = json("impact.tsv", ["packet\topaque\tjudge\timpact", ...rows, key.entries[0]!.packet + "\t" + key.entries[0]!.opaque + "\tjudge-b\tblocking"].join("\n") + "\n");
    const d = await deriveTo("gsta167-imp", ["--drop-gaps", "--impact", impact, "--key", keyPath, "--impact-judge", "judge-a"]);
    expect(d.code).toBe(0);
    const [suite, armsRoot, prereg] = derived("gsta167-imp");
    const alpha = join(armsRoot, "gsta167-imp", "alpha");
    expect(readFileSync(join(alpha, "findings", "3596.jsonl"), "utf8")).toContain('"label":"IMPACT-BLOCKING"');
    expect(readFileSync(join(alpha, "findings", "3524.jsonl"), "utf8")).toContain('"label":"IMPACT-UNRATED"');
    const j = readFileSync(join(alpha, "judgments.tsv"), "utf8");
    expect(j).toMatch(/^3596\tB1\tF\t[^\t]+\tIMPACT-BLOCKING\tCRITICAL\t/m);
    expect(j).toMatch(/^3516\tB2\tD\t[^\t]+\tIMPACT-NONBLOCKING\tINFORMATIONAL\t/m);
    expect(JSON.parse(readFileSync(join(alpha, "arm.json"), "utf8")).severity_map).toEqual({ default: { "IMPACT-BLOCKING": "CRITICAL", "IMPACT-NONBLOCKING": "INFORMATIONAL", "IMPACT-UNRATED": "INFORMATIONAL" } });
    expect(JSON.parse((await score(suite, armsRoot, prereg, ["--json"])).out).result.verdict).not.toBe(null);
  });

  test("--impact reads judge-run's missing rating as unrated and refuses any other value", async () => {
    const keyPath = join(dir, "key.json");
    const key = JSON.parse(readFileSync(keyPath, "utf8")) as { entries: Array<{ packet: string; opaque: string; finding: string }> };
    const tsv = (name: string, rating: string) => json(name, ["packet\topaque\tjudge\timpact", ...key.entries.map((e) => [e.packet, e.opaque, "judge-a", e.finding === "ex-3596-b1" ? rating : "non-blocking"].join("\t"))].join("\n") + "\n");
    const d = await deriveTo("gsta167-imp-missing", ["--drop-gaps", "--impact", tsv("impact-missing.tsv", "missing"), "--key", keyPath, "--impact-judge", "judge-a"]);
    expect([d.code, d.err]).toEqual([0, expect.not.stringContaining("E_USAGE")]);
    const first = JSON.parse(readFileSync(join(dir, "gsta167-imp-missing", "arms", "gsta167-imp-missing", "alpha", "findings", "3596.jsonl"), "utf8").split("\n")[0]!);
    expect([first.id, first.label]).toEqual(["ex-3596-b1", "IMPACT-UNRATED"]);
    const bad = await deriveTo("gsta167-imp-bad", ["--drop-gaps", "--impact", tsv("impact-bad.tsv", "maybe"), "--key", keyPath, "--impact-judge", "judge-a"]);
    expect([bad.code, bad.err]).toEqual([2, expect.stringMatching(/^E_USAGE .*impact is blocking, non-blocking or missing, not "maybe"/)]);
  });

  test("--impact keeps ratings apart when two units' findings share an id", async () => {
    const shared = (files: Map<string, Buffer>) => {
      const m = new Map(files);
      for (const pr of ["3596", "3524"]) m.set("findings/" + pr + ".jsonl", Buffer.from(m.get("findings/" + pr + ".jsonl")!.toString("utf8").replace('"id":"ex-' + pr + '-b1"', '"id":"p1-1"')));
      return editJudgments(m, (c) => {
        if (c[3] === "ex-3596-b1" || c[3] === "ex-3524-b1") c[3] = "p1-1";
      });
    };
    const sharedRoot = join(dir, "arms-shared");
    for (const id of ["alpha", "beta"]) expect((await run(["ingest", writeArm(join(dir, "src-shared", id), shared(arm(id))), "--suite", "gsta167-14pr", "--root", sharedRoot])).code).toBe(0);
    const keyPath = join(dir, "key-shared.json");
    expect((await run(["judge-packet", "--suite", "gsta167-14pr", "--arm", join(sharedRoot, "gsta167-14pr", "alpha"), "--arm", join(sharedRoot, "gsta167-14pr", "beta"), "--seed", "7", "--out", join(dir, "packets-shared"), "--key", keyPath])).code).toBe(0);
    const key = JSON.parse(readFileSync(keyPath, "utf8")) as { packets: Array<{ file: string; unit: string }>; entries: Array<{ packet: string; opaque: string; finding: string }> };
    const unitOf = new Map(key.packets.map((p) => [p.file, p.unit]));
    const rows = key.entries.map((e) => [e.packet, e.opaque, "judge-a", e.finding === "p1-1" && unitOf.get(e.packet) === U3596 ? "blocking" : "non-blocking"].join("\t"));
    const impact = json("impact-shared.tsv", ["packet\topaque\tjudge\timpact", ...rows].join("\n") + "\n");
    const d = await run(["derive", "--suite", "gsta167-14pr", "--comparisons", comparisons, "--root", sharedRoot, "--id", "gsta167-shared", "--out", join(dir, "gsta167-shared"), "--impact", impact, "--key", keyPath, "--impact-judge", "judge-a"]);
    expect([d.code, d.err]).toEqual([0, expect.not.stringContaining("E_USAGE")]);
    const label = (pr: string) => readFileSync(join(dir, "gsta167-shared", "arms", "gsta167-shared", "alpha", "findings", pr + ".jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((f) => f.id === "p1-1").label;
    expect([label("3596"), label("3524")]).toEqual(["IMPACT-BLOCKING", "IMPACT-NONBLOCKING"]);
  });

  test("refusals: the base id, a used out dir, a drop file with no unit column", async () => {
    expect((await deriveTo("gsta167-14pr", [])).err).toMatch(/^E_USAGE .*--id must differ/);
    expect((await deriveTo("gsta167-cc", ["--drop-gaps"])).err).toMatch(/^E_USAGE .*is not empty/);
    expect((await deriveTo("gsta167-x", ["--drop-file", json("bad.tsv", "pr\n3593\n")])).err).toMatch(/^E_USAGE .*needs a unit column/);
    mkdirSync(join(dir, "empty-root"));
    expect((await run(["derive", "--suite", "gsta167-14pr", "--comparisons", comparisons, "--root", join(dir, "empty-root"), "--id", "gsta167-y", "--out", join(dir, "y")])).err).toMatch(/^E_USAGE .*no arm is ingested/);
  });
});
