// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 10's descriptive secondaries on a small fixture: paired differences, pooled precision, strata by part,
// kind, size and month, outcome counts and the miss anatomy per arm.
import { describe, expect, test } from "bun:test";
import { loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";
import type { CsoArm, CsoModel, SessionRecord, UnitRecord } from "../../lanes/outcome-skills/cso/types.ts";
import type { CsoScore } from "../../lanes/outcome-skills/cso/score/outcomes.ts";
import { secondaries } from "../../lanes/outcome-skills/cso/analysis/secondaries.ts";

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
