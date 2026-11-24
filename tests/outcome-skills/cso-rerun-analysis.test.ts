// Copyright (c) 2026 Garry Tan. MIT License.
// GEVA-583 rerun prereg sections 4 to 6: the before-and-after join on fixtures. The new arm, read as stage 2's cso cells,
// against the parent's none arm (primary) and its old cso arm (second family), the reused arms' own join, exposure with
// the old arm's fixed replay, yield, the miss labels, and the pilot's print check.
import { expect, test } from "bun:test";
import { loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";
import { NO_PAIR, printCheck, rerunAnalysis, type RerunInput } from "../../lanes/outcome-skills/cso/analysis/rerun.ts";
import type { CsoScore } from "../../lanes/outcome-skills/cso/score/outcomes.ts";
import type { CsoArm, CsoModel, CsoStage, SessionRecord, UnitRecord } from "../../lanes/outcome-skills/cso/types.ts";
import { treeIndex } from "../../lanes/outcome-skills/cso/score/checks.ts";

const p = loadCsoPrereg();
const units: UnitRecord[] = Array.from({ length: 8 }, (_, k) => ({ unit: "u" + k, repo: "r" + k, part: "part1", kind: "library", source_files: 100, published: "2026-08-01", ecosystem: "npm" }) as UnitRecord);
const sc = (u: UnitRecord, arm: CsoArm, m: CsoModel, stage: CsoStage, named: boolean, findings: number): CsoScore =>
  ({ schema: "cso-score.v1", unit: u.unit, repo: u.repo, arm, model: m, stage, gap: null, named, named_final: named, file_level: named, supported: 1, unsupported: 0, cant_tell: 0, findings_total: findings, counted: findings, hits: named ? 1 : 0, known_real: named ? 1 : 0, over_k: false, phantoms: { paths: 0, lines: 0, cited: 0, items: [] }, cost_usd: 1 }) as unknown as CsoScore;
const ss = (u: UnitRecord, arm: CsoArm, m: CsoModel, stage: CsoStage, ran: boolean) => ({ unit: u.unit, arm, model: m, stage, end: "completed", exposure: { loaded: arm !== "none", procedure_ran: ran } }) as SessionRecord;
const MODELS: CsoModel[] = ["opus", "particle"];
const input = (us: UnitRecord[], fresh: UnitRecord[]): RerunInput => ({
  units: us,
  none: { sessions: units.flatMap((u) => MODELS.map((m) => ss(u, "none", m, "stage2", false))), scores: units.flatMap((u, k) => MODELS.map((m) => sc(u, "none", m, "stage2", k < 2, 5))) },
  old: { sessions: units.flatMap((u) => MODELS.map((m) => ss(u, "cso", m, "stage2", false))), scores: units.flatMap((u) => MODELS.map((m) => sc(u, "cso", m, "stage2", false, 1))) },
  fresh: { sessions: fresh.flatMap((u) => MODELS.map((m) => ss(u, "cso", m, "rerun", u.unit !== "u7"))), scores: fresh.flatMap((u, k) => MODELS.map((m) => sc(u, "cso", m, "rerun", k < 6, k === 0 ? 0 : 4))) },
  oldProcedure: Object.fromEntries(units.flatMap((u, k) => MODELS.map((m) => [u.unit + " " + m, k < 3]))),
  runRecords: { "u0 opus": { runs: 2, findings: 6 } },
  judge: { opus: { named: true, validity: true }, particle: { named: true, validity: true }, sol: { named: false, validity: false } },
  headroom_admitted: true,
});

test("the new arm joins the none arm for the verdict and the old cso arm for the second family; the reused join reads the parent's own pairs", () => {
  const a = rerunAnalysis(input(units, units), p);
  const opus = a.primary.rows.find((r) => r.model === "opus")!;
  expect([opus.complete.n, opus.complete.a_rate, opus.complete.b_rate]).toEqual([8, 0.25, 0.75]);
  const second = a.second.rows.find((r) => r.model === "opus")!;
  expect([second.complete.n, second.complete.a_rate, second.complete.b_rate]).toEqual([8, 0, 0.75]);
  expect(a.reused_join).toEqual([{ model: "opus", pairs: 8, baseline_named: 2, cso_named: 0 }, { model: "particle", pairs: 8, baseline_named: 2, cso_named: 0 }]);
  expect(a.primary.verdicts.map((v) => v.model)).toEqual(["opus", "particle"]);
  expect(a.exposure[0]).toEqual({ model: "opus", new_loaded: 8, new_ran: 7, new_of: 8, old_ran_fixed: 3, old_of: 8 });
  expect(a.yield[0]).toMatchObject({ model: "opus", findings_per_session: { new_cso: 3.5, none: 5, old_cso: 1 }, no_finding_share: { new_cso: 0.125, none: 0, old_cso: 0 }, helper_findings_per_run: 3, helper_runs: 2 });
  expect(a.yield[0]!.findings_per_session_procedure_ran).toBeCloseTo(24 / 7, 10);
  expect(a.secondaries.second[0]!.diffs.findings_total.delta).toBe(2.5);
  expect(a.miss_labels.outside_first_k).toContain("location match");
});

test("the print check marks what can't pair and fails only on a field that doesn't print", () => {
  const pilot = units.slice(0, 2);
  const lonely = input(pilot, pilot);
  lonely.none = { sessions: [], scores: [] };
  lonely.old = { sessions: [], scores: [] };
  const c = printCheck(rerunAnalysis(lonely, p));
  expect(c.pass).toBe(true);
  const out = c.out as { secondaries: { primary: { diffs: Record<string, unknown> }[] } };
  expect(out.secondaries.primary[0]!.diffs.findings_total).toBe(NO_PAIR);
  const paired = printCheck(rerunAnalysis(input(pilot, pilot), p));
  expect(paired.pass).toBe(true);
  expect((paired.out as typeof out).secondaries.primary[0]!.diffs.findings_total).toMatchObject({ n: 2 });
  const none = printCheck(rerunAnalysis(input(pilot, []), p));
  expect(none.pass).toBe(false);
  expect(none.missing).toContain("yield opus findings per new cso session");
  expect(none.missing).toContain("exposure particle: no new cso session");
});

test("the pilot's parent records from stage 0 pair as stage 2", () => {
  const pilot = units.slice(0, 2);
  const i = input(pilot, pilot);
  const s0 = <T extends { stage: string }>(x: T): T => ({ ...x, stage: "stage0" });
  i.none = { sessions: i.none.sessions.map(s0), scores: i.none.scores.map(s0) };
  i.old = { sessions: i.old.sessions.map(s0), scores: i.old.scores.map(s0) };
  const a = rerunAnalysis(i, p);
  expect(a.primary.rows.find((r) => r.model === "opus")!.complete.n).toBe(2);
  expect(a.second.rows.find((r) => r.model === "opus")!.complete.n).toBe(2);
  expect(a.exposure[0]).toMatchObject({ old_of: 2 });
  expect(printCheck(a).pass).toBe(true);
});

test("the miss anatomy reads the new arm's judged rows for cso misses and the parent's for the none arm and the old cso baseline", () => {
  const TREE = treeIndex({ "src/a.js": Array.from({ length: 30 }, (_, i) => "a " + (i + 1)).join("\n") + "\n", "src/b.js": "b\n" });
  const mu = ["m0", "m1"].map((u) => ({ ...units[0]!, unit: u, repo: "r-" + u, hunks: [{ file: "src/a.js", start: 10, end: 12, insert_only: false, text: "x" }] }) as UnitRecord);
  const ses = (unit: string, arm: CsoArm, m: CsoModel, stage: CsoStage, o: Partial<SessionRecord> = {}) => ({
    schema: "cso-session.v1", unit, arm, model: m, stage, end: "completed", texts: ["Report\nDONE"], opened: ["src/a.js"], helper: { snapshot_root: null, handles: {} },
    exposure: { loaded: arm !== "none", procedure_ran: arm !== "none", completeness: "complete", tooling_errors: 0 }, ...o,
  }) as unknown as SessionRecord;
  const named: Record<string, boolean> = { "m0 none": true, "m0 old": false, "m0 new": false, "m1 none": false, "m1 old": false, "m1 new": true };
  const both = (f: (m: CsoModel) => unknown[]) => MODELS.flatMap(f) as never[];
  const i: RerunInput = {
    units: mu,
    none: { sessions: both((m) => mu.map((u) => ses(u.unit, "none", m, "stage2", u.unit === "m1" ? { end: "limit_allowance" } : {}))), scores: both((m) => mu.map((u) => sc(u, "none", m, "stage2", m === "opus" && named[u.unit + " none"]!, 5))) },
    old: { sessions: both((m) => mu.map((u) => ses(u.unit, "cso", m, "stage2", { opened: [] }))), scores: both((m) => mu.map((u) => sc(u, "cso", m, "stage2", false, 1))) },
    fresh: { sessions: both((m) => mu.map((u) => ses(u.unit, "cso", m, "rerun", u.unit === "m0" ? { opened: ["src/b.js"] } : {}))), scores: both((m) => mu.map((u) => sc(u, "cso", m, "rerun", m === "opus" && named[u.unit + " new"]!, 2))) },
    oldProcedure: {}, runRecords: {}, judge: { opus: { named: true, validity: true }, particle: { named: true, validity: true }, sol: { named: false, validity: false } }, headroom_admitted: true,
  };
  const asked: string[] = [];
  i.miss = { fresh: (u, m) => (asked.push("fresh " + u + " " + m), { findings: [], labels: [] } as never), parent: (u, arm, m) => (asked.push("parent " + u + " " + arm + " " + m), { findings: [], labels: [] } as never), tree: () => TREE };
  const a = rerunAnalysis(i, p);
  expect(a.secondaries.primary[0]!.miss).toEqual({ none: { limit_tooling_or_not_assessed: 1 }, cso: { never_opened_fix_file: 1 } });
  expect(a.secondaries.second[0]!.miss).toEqual({ none: { never_opened_fix_file: 1 }, cso: {} });
  expect(asked.sort()).toEqual(["fresh m0 opus", "parent m1 cso opus", "parent m1 none opus"]);
  delete i.miss;
  expect(rerunAnalysis(i, p).secondaries.primary[0]!.miss).toEqual({ none: {}, cso: {} });
});
