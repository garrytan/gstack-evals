// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 10's descriptive secondaries on a small fixture: paired differences, pooled precision, strata by part,
// kind, size and month, outcome counts and the miss anatomy per arm, with its input built from the sessions, the judged
// rows and the audited trees.
import { describe, expect, test } from "bun:test";
import { loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";
import type { CsoArm, CsoModel, SessionRecord, UnitRecord } from "../../lanes/outcome-skills/cso/types.ts";
import type { CsoScore } from "../../lanes/outcome-skills/cso/score/outcomes.ts";
import { missMap, secondaries } from "../../lanes/outcome-skills/cso/analysis/secondaries.ts";
import { treeIndex } from "../../lanes/outcome-skills/cso/score/checks.ts";

const p = loadCsoPrereg();
const units: UnitRecord[] = Array.from({ length: 8 }, (_, k) => ({ unit: "u" + k, repo: "r" + k, part: k < 4 ? "part1" : "part2", kind: k % 2 ? "service" : "library", source_files: 100 * (k + 1), published: k < 2 ? "2026-10-05" : "2026-08-01", ecosystem: k < 6 ? "npm" : "go" }) as UnitRecord);
const sc = (u: UnitRecord, arm: CsoArm, m: CsoModel, named: boolean, o: Partial<CsoScore> = {}) =>
  ({ schema: "cso-score.v1", unit: u.unit, repo: u.repo, arm, model: m, stage: "stage2", gap: null, named, named_final: named, file_level: named, supported: 2, unsupported: arm === "cso" ? 1 : 3, cant_tell: 0, findings_total: 4, counted: 4, hits: named ? 1 : 0, known_real: named ? 1 : 0, over_k: false, phantoms: { paths: 0, lines: 0, cited: 0, items: [] }, cost_usd: arm === "cso" ? 3 : 1, ...o } as CsoScore);

describe("section 10: secondaries", () => {
  const scores = units.flatMap((u, k) => (["opus", "particle"] as CsoModel[]).flatMap((m) => [sc(u, "none", m, false), sc(u, "cso", m, k < 4)]));
  const sessions = units.flatMap((u) => [{ unit: u.unit, arm: "cso", model: "opus", stage: "stage2", end: u.unit === "u7" ? "safety_stop" : "completed" } as SessionRecord]);
  const [opus] = secondaries({ units, scores, sessions, judge: { opus: { named: true, validity: true }, particle: { named: true, validity: true }, sol: { named: false, validity: false } } }, p, { "u5 cso opus": "opened_not_named", "u6 cso opus": "opened_not_named" });
  test("paired differences and pooled precision", () => {
    expect(opus!.diffs.named).toMatchObject({ n: 8, none: 0, cso: 0.5, delta: 0.5 });
    expect(opus!.diffs.unsupported.delta).toBe(-2);
    expect(opus!.diffs.cost_usd.delta).toBe(2);
    expect(opus!.precision.cso.key).toEqual({ num: 4, den: 32, rate: 0.125 });
  });
  test("strata split by part, kind, size at the median, month and ecosystem", () => {
    expect(opus!.strata["part1"]!.delta).toBe(1);
    expect(opus!.strata["part2"]!.delta).toBe(0);
    expect(opus!.strata["size<=median"]!.n).toBe(4);
    expect(opus!.strata["strict month"]!).toMatchObject({ n: 2, delta: 1 });
    expect(opus!.strata["ecosystem go"]!.n).toBe(2);
  });
  test("outcome counts and the miss anatomy per arm", () => {
    expect(opus!.outcomes.cso.safety_stop).toBe(1);
    expect(opus!.miss.cso).toEqual({ opened_not_named: 2 });
  });
});

describe("section 10: the miss anatomy's input, from the sessions, the judged rows and the audited trees", () => {
  const TREE = treeIndex({ "src/a.js": Array.from({ length: 30 }, (_, i) => "a " + (i + 1)).join("\n") + "\n", "src/b.js": "b\n" });
  const mu = ["m0", "m1", "m2", "m3"].map((u) => ({ ...units[0]!, unit: u, repo: "r-" + u, hunks: [{ file: "src/a.js", start: 10, end: 12, insert_only: false, text: "x" }] }) as UnitRecord);
  const ses = (unit: string, arm: CsoArm, m: CsoModel, o: Partial<SessionRecord> = {}) => ({
    schema: "cso-session.v1", unit, arm, model: m, stage: "stage2", model_id: "x", harness: "claude-code", harness_version: "x", end: "completed", reason: null, attempts: 1, continuations: 0, done_seen: true,
    texts: ["Report\nDONE"], opened: ["src/a.js"], helper: { snapshot_root: null, handles: {} },
    exposure: { loaded: true, procedure_ran: true, run_id: null, completeness: "complete", findings_submitted: 0, tooling_errors: 0, host_reads_after_start: 0, scope: "daily/default" },
    cost_usd: 1, wall_sec: 1, turns: 1, tokens: { input: 1, output: 1, cache_read: 0, cache_write: 0 }, ...o,
  }) as SessionRecord;
  const scores = [
    sc(mu[0]!, "none", "opus", true), sc(mu[0]!, "cso", "opus", false),
    sc(mu[1]!, "none", "opus", false), sc(mu[1]!, "cso", "opus", true),
    sc(mu[2]!, "none", "opus", true), sc(mu[2]!, "cso", "opus", true),
    sc(mu[3]!, "none", "opus", true), sc(mu[3]!, "cso", "opus", false, { gap: "judge", named: null }),
    ...mu.flatMap((u) => [sc(u, "none", "particle", false), sc(u, "cso", "particle", false)]),
  ];
  const sessions = [
    ses("m0", "none", "opus"), ses("m0", "cso", "opus", { opened: ["src/b.js"] }),
    ses("m1", "none", "opus", { end: "limit_allowance" }), ses("m1", "cso", "opus"),
    ses("m2", "none", "opus"), ses("m2", "cso", "opus"), ses("m3", "none", "opus"), ses("m3", "cso", "opus", { opened: [] }),
    ...mu.flatMap((u) => [ses(u.unit, "none", "particle"), ses(u.unit, "cso", "particle")]),
  ];
  const i = { units: mu, scores, sessions, judge: { opus: { named: true, validity: true }, particle: { named: true, validity: true }, sol: { named: false, validity: false } } };
  const misses = missMap(i, () => ({ findings: [], labels: [] }), () => TREE, p);
  test("only the arm that missed while the other named is classified, by the plan's first matching cause", () => {
    expect(misses).toEqual({ "m0 cso opus": "never_opened_fix_file", "m1 none opus": "limit_tooling_or_not_assessed" });
  });
  test("the secondaries count it per arm", () => {
    const [opus, particle] = secondaries(i, p, misses);
    expect(opus!.miss).toEqual({ none: { limit_tooling_or_not_assessed: 1 }, cso: { never_opened_fix_file: 1 } });
    expect(particle!.miss).toEqual({ none: {}, cso: {} });
  });
});
