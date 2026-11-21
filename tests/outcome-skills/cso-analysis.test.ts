// Copyright (c) 2026 Garry Tan. MIT License.
// Plan sections 9, 10 and 12, tested on fixtures: a clustered fixture where exact McNemar and the clustered test disagree
// (the clustered test decides), the gap bounds both ways, every verdict branch in section 10's order, deviation CV5's
// interim look with its futility rule, the n2 re-pricing and the sealed stage 1 readout.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";
import type { CsoArm, CsoModel, SessionRecord, UnitRecord } from "../../lanes/outcome-skills/cso/types.ts";
import type { CsoScore } from "../../lanes/outcome-skills/cso/score/outcomes.ts";
import { GATES, GOLD_MINIMUMS, RELEASE_ITEMS, type JudgeCheck } from "../../lanes/outcome-skills/cso/analysis/release.ts";
import { analyze, conditionalPower, interimApplies, look, type AnalysisInput } from "../../lanes/outcome-skills/cso/analysis/verdicts.ts";
import { readKey, readout, reprice, seal, unseal } from "../../lanes/outcome-skills/cso/analysis/readout.ts";

const p = loadCsoPrereg();
type V = 0 | 1 | null;
interface Row { repo?: string; none: V; cso: V; nu?: number; cu?: number; ns?: number; cs?: number }

const unit = (id: string, repo: string): UnitRecord => ({ unit: id, repo } as UnitRecord);
const score = (u: UnitRecord, arm: CsoArm, model: CsoModel, v: V, stage: CsoScore["stage"] = "stage2", o: Partial<CsoScore> = {}): CsoScore =>
  ({ schema: "cso-score.v1", unit: u.unit, repo: u.repo, arm, model, stage, gap: v === null ? "session" : null, named: v === null ? null : v === 1, unsupported: 0, supported: 0, phantoms: { paths: 0, lines: 0, cited: 0, items: [] }, ...o } as CsoScore);
const session = (u: string, arm: CsoArm, model: CsoModel, ran: boolean, stage: SessionRecord["stage"] = "stage2", o: Partial<SessionRecord> = {}): SessionRecord =>
  ({ schema: "cso-session.v1", unit: u, arm, model, stage, end: "completed", cost_usd: 1, exposure: { loaded: ran, procedure_ran: ran, run_id: ran ? "r" : null, completeness: "complete", findings_submitted: 0, tooling_errors: 0, host_reads_after_start: 0, scope: ran ? "daily/default" : null }, ...o } as SessionRecord);

/** One model's rows for Opus; particle gets the same rows unless given its own. */
function build(rows: Row[], o: { particle?: Row[]; ran?: number; judge?: Partial<AnalysisInput["judge"]>; extra?: Partial<AnalysisInput> } = {}): AnalysisInput {
  const units = rows.map((r, k) => unit("u" + k, r.repo ?? "repo" + k));
  const scores: CsoScore[] = [], sessions: SessionRecord[] = [];
  const add = (m: CsoModel, rs: Row[]) => rs.forEach((r, k) => {
    const u = units[k]!;
    scores.push(score(u, "none", m, r.none, "stage2", { unsupported: r.nu ?? 0, supported: r.ns ?? 0 }), score(u, "cso", m, r.cso, "stage2", { unsupported: r.cu ?? 0, supported: r.cs ?? 0 }));
    sessions.push(session(u.unit, "cso", m, k / rs.length < (o.ran ?? 1)));
  });
  add("opus", rows);
  add("particle", o.particle ?? rows);
  return { units, scores, sessions, judge: { opus: { named: true, validity: true }, particle: { named: true, validity: true }, sol: { named: false, validity: false }, ...o.judge }, headroom_admitted: true, ...o.extra };
}
const rep = (n: number, r: Row) => Array.from({ length: n }, () => ({ ...r }));
const opus = (i: AnalysisInput) => analyze(i, p).verdicts[0]!;

describe("section 10: the clustered test decides, exact McNemar sits beside it", () => {
  test("12 wins in two repositories and 2 losses: exact McNemar is below 0.05, the clustered test is not, so no difference is shown", () => {
    const rows: Row[] = [...rep(6, { repo: "A", none: 0, cso: 1 }), ...rep(6, { repo: "B", none: 0, cso: 1 }), { none: 1, cso: 0 }, { none: 1, cso: 0 }, ...rep(20, { none: 0, cso: 0 })];
    const a = analyze(build(rows, { particle: rep(34, { none: 0, cso: 0 }) }), p);
    const s = a.rows[0]!.stats.complete;
    expect(s.p_exact).toBeLessThan(0.05);
    expect(s.p).toBeGreaterThan(0.05);
    expect([s.b_only, s.a_only, s.n_repos]).toEqual([12, 2, 24]);
    expect(a.rows[0]!.state).toBe("no_difference");
  });
});

describe("section 9: gap bounds", () => {
  const rows: Row[] = [{ none: null, cso: 1, nu: 0, cu: 0 }, { none: 0, cso: null }, ...rep(38, { none: 0, cso: 0, nu: 2, cu: 1, ns: 1, cs: 1 })];
  const r = analyze(build(rows), p).rows[0]!.stats;
  test("named: Ahead and KEEP fill cso gaps as not named and none gaps as named; Behind and CUT the reverse", () => {
    expect(r.complete.n).toBe(38);
    expect([r.bound.cso_down.a_rate, r.bound.cso_down.b_rate]).toEqual([1 / 40, 1 / 40]);
    expect([r.bound.cso_up.a_rate, r.bound.cso_up.b_rate]).toEqual([0, 2 / 40]);
  });
  test("counts at the KEEP bound: 10 in the arm the condition needs low, 0 in the arm it needs high", () => {
    expect(r.unsupported.complete.delta).toBeCloseTo(-1, 9);
    expect(r.unsupported.keep_bound.delta).toBeCloseTo((38 * -1 + 10 - 0) / 40, 9);
    expect(r.supported.keep_bound.delta).toBeCloseTo((0 - 10) / 40, 9);
  });
});

describe("section 10: every verdict branch, in order", () => {
  setDefaultTimeout(60_000);
  const wins = (n: number, w: number, l = 0): Row[] => [...rep(w, { none: 0, cso: 1 }), ...rep(l, { none: 1, cso: 0 }), ...rep(n - w - l, { none: 0, cso: 0 })];
  test("1. FIX-METHOD: Incomplete (gaps over 10%), Skill not exercised (procedure under 80%), Judge not validated, headroom failed", () => {
    expect(opus(build([...rep(5, { none: 0, cso: null }), ...wins(35, 30)]))).toMatchObject({ verdict: "FIX-METHOD", step: 1, row: "Incomplete" });
    expect(opus(build(wins(40, 30), { ran: 0.7 }))).toMatchObject({ verdict: "FIX-METHOD", step: 1, row: "Skill not exercised as designed" });
    expect(opus(build(wins(40, 30), { judge: { opus: { named: false, validity: true } } }))).toMatchObject({ verdict: "FIX-METHOD", step: 1, row: "Judge not validated" });
    expect(opus(build(wins(40, 30), { extra: { headroom_failed: true } }))).toMatchObject({ verdict: "FIX-METHOD", step: 1 });
    expect(opus(build(wins(40, 30), { extra: { left_out: { opus: true } } }))).toMatchObject({ verdict: "FIX-METHOD", step: 1, row: "Incomplete" });
  });
  test("2. KEEP when Ahead at the gap bound", () => {
    expect(opus(build(wins(40, 20)))).toMatchObject({ verdict: "KEEP", step: 2, row: "Ahead" });
  });
  test("2. KEEP on the second path: named within the margin, fewer unsupported, supported not lower, validity checked", () => {
    const rows = rep(80, { none: 0, cso: 0, nu: 3, cu: 1, ns: 2, cs: 2 });
    expect(opus(build(rows))).toMatchObject({ verdict: "KEEP", step: 2 });
    expect(opus(build(rows, { judge: { opus: { named: true, validity: false } } })).verdict).not.toBe("KEEP");
  });
  test("3. FIX-METHOD on gaps when a KEEP path holds on complete pairs but not at its gap bound", () => {
    const rows = [...rep(4, { none: null, cso: null }), ...wins(36, 9)];
    const v = opus(build(rows));
    expect(v).toMatchObject({ verdict: "FIX-METHOD", step: 3 });
  });
  test("4. CUT-CANDIDATE when Behind at the gap bound with the procedure run", () => {
    expect(opus(build(wins(40, 0, 20)))).toMatchObject({ verdict: "CUT-CANDIDATE", step: 4, row: "Behind" });
  });
  test("4. CUT-CANDIDATE on a null: no difference, headroom admitted, validity checked, interval below +15 points", () => {
    const rows = [...rep(5, { none: 1, cso: 1 }), ...rep(95, { none: 0, cso: 0 })];
    expect(opus(build(rows))).toMatchObject({ verdict: "CUT-CANDIDATE", step: 4, row: "No difference shown" });
    expect(opus(build(rows, { extra: { headroom_admitted: false } }))).toMatchObject({ verdict: "FIX-METHOD", step: 5 });
  });
  test("5. FIX-METHOD on gaps when a CUT-CANDIDATE condition holds on complete pairs but not at its gap bound", () => {
    const rows = [...rep(10, { none: 0, cso: null }), ...rep(90, { none: 0, cso: 0 })];
    expect(opus(build(rows))).toMatchObject({ verdict: "FIX-METHOD", step: 5, why: expect.stringContaining("on gaps") });
  });
  test("5. otherwise FIX-METHOD on power, with the interval", () => {
    expect(opus(build(wins(20, 4, 3)))).toMatchObject({ verdict: "FIX-METHOD", step: 5, why: expect.stringContaining("on power: interval [") });
  });
  test("the particle-1 line follows the same rules and a split names itself", () => {
    const a = analyze(build(wins(40, 20), { particle: wins(40, 0, 20) }), p);
    expect(a.verdicts.map((v) => v.verdict)).toEqual(["KEEP", "CUT-CANDIDATE"]);
    expect(a.split).toBe(true);
  });
});

describe("section 12 and deviation CV5: the interim look", () => {
  test("applies only above $500 paid", () => {
    expect([interimApplies(400), interimApplies(500), interimApplies(500.01)]).toEqual([false, false, true]);
  });
  test("3.18 then 2.80 at the interim look; 2.25 then 1.98 at the final", () => {
    const i = look("interim", [{ model: "opus", z: 3.2, se: 0.08 }, { model: "particle", z: -2.85, se: 0.08 }], [], p);
    expect(i.map((x) => [x.reject, x.bound])).toEqual([[true, 3.18], [true, 2.8]]);
    const j = look("interim", [{ model: "opus", z: 3.1, se: 0.08 }, { model: "particle", z: 2.85, se: 0.08 }], [], p);
    expect(j.map((x) => x.reject)).toEqual([false, false]);
    const f = look("final", [{ model: "opus", z: 2.3, se: 0.05 }, { model: "particle", z: 2.0, se: 0.05 }], [], p);
    expect(f.map((x) => [x.reject, x.bound])).toEqual([[true, 2.25], [true, 1.98]]);
    const g = look("final", [{ model: "particle", z: 2.0, se: 0.05 }], ["opus"], p);
    expect(g[0]).toMatchObject({ reject: true, bound: 1.98 });
    expect(look("final", [{ model: "opus", z: 2.2, se: 0.05 }, { model: "particle", z: 2.0, se: 0.05 }], [], p).map((x) => x.reject)).toEqual([false, false]);
  });
  test("futility: conditional power under a 19-point effect below 10% stops the contrast", () => {
    const strong = look("interim", [{ model: "opus", z: 0.2, se: 0.07 }], [], p)[0]!;
    expect(strong.futile).toBe(false);
    const weak = look("interim", [{ model: "opus", z: 0, se: 0.5 }], [], p)[0]!;
    expect(weak.conditional_power!).toBeLessThan(0.1);
    expect(weak.futile).toBe(true);
    expect(conditionalPower(3, 0.07, 0.19, 2.25)).toBeGreaterThan(0.9);
  });
});

describe("section 12: the sealed stage 1 readout", () => {
  const units = Array.from({ length: 12 }, (_, k) => unit("s" + k, "r" + k));
  const all = (noneNamed: number, csoRan: number, o: { cost?: number; gapsCso?: number } = {}) => {
    const scores: CsoScore[] = [], sessions: SessionRecord[] = [];
    units.forEach((u, k) => {
      for (const [m, a] of [["opus", "none"], ["opus", "cso"], ["opus", "untold"], ["particle", "none"], ["particle", "cso"]] as [CsoModel, CsoArm][]) {
        const v: V = a === "cso" && k < (o.gapsCso ?? 0) ? null : a === "none" ? (k < noneNamed ? 1 : 0) : 1;
        scores.push(score(u, a, m, v, "stage1"));
        sessions.push(session(u.unit, a, m, a === "cso" ? k < csoRan : a === "untold" && k < 3, "stage1", { cost_usd: o.cost ?? (m === "opus" ? (a === "cso" ? 3 : 1) : 0.4) }));
      }
    });
    return { units: units.map((u) => u.unit), scores, sessions };
  };
  const all1 = <K extends string>(ks: readonly K[], v: boolean) => Object.fromEntries(ks.map((k) => [k, v])) as Record<K, boolean>;
  const check: JudgeCheck = { route: "production", minimums: all1(GOLD_MINIMUMS, true), gates: all1(GATES, true), detail: { kappa: 0.71 } };
  const money = { spent_usd: 120, judging_per_session_usd: 0.12, vm_usd: 40, vm_stage2_usd: 20 };
  test("the release carries exactly RELEASE_ITEMS, the judge item as booleans, and no cso named rate", () => {
    const { release, sealed } = readout({ ...all(4, 12), checks: [check], ...money }, p);
    expect(release.items.map((x) => x.item)).toEqual([...RELEASE_ITEMS]);
    expect(release.items[0]!.value).toEqual({ opus: { named: 4, scored: 12, gaps: 0 }, particle: { named: 4, scored: 12, gaps: 0 } });
    expect(release.items[4]!.value).toEqual({ loaded: 3, of: 12 });
    expect(JSON.stringify(release)).not.toContain("0.71");
    expect(JSON.stringify(release.items[5]!.value)).not.toMatch(/[0-9]/);
    expect(sealed.outcomes.filter((o) => o.arm === "cso" && o.named).length).toBe(24);
    expect(release.readings.map((r) => r.reading)).toEqual(["COST"]);
  });
  test("every reading that holds: FLOOR, EXPOSURE, INFRA and JUDGE together; CEILING; MOST", () => {
    const failed = { ...check, gates: { ...check.gates, named_kappa_all: false } };
    const r = readout({ ...all(1, 9, { gapsCso: 2 }), checks: [failed], ...money }, p).release.readings.map((x) => x.reading);
    expect(r).toEqual(["FLOOR", "EXPOSURE", "INFRA", "INFRA", "COST", "JUDGE"]);
    expect(readout({ ...all(10, 12), checks: [check], ...money }, p).release.readings.map((x) => x.reading)).toEqual(["CEILING", "COST"]);
    expect(readout({ ...all(8, 12), checks: [check], ...money }, p).release.readings.map((x) => x.reading)).toEqual(["MOST", "COST"]);
  });
  test("n2 is the largest multiple of 4 from 48 to 100 whose program is at most $600; below 48 goes to the Captain; above $500 paid takes the look", () => {
    const c = (opusNone: number, opusCso: number, pn: number, pc: number) => ({ "opus none": { mean: opusNone }, "opus cso": { mean: opusCso }, "particle none": { mean: pn }, "particle cso": { mean: pc } } as any);
    const r = reprice(c(1, 3, 0.4, 1.2), money, p);
    expect(r.n2).toBe(72);
    expect(r.program_usd!).toBeLessThanOrEqual(600);
    expect(r.interim_look).toBe(false);
    expect(reprice(c(4, 8, 1, 2), money, p)).toMatchObject({ n2: null, to_captain: true });
    expect(reprice(c(0.5, 4.9, 0.1, 0.3), { ...money, spent_usd: 50, vm_usd: 0, vm_stage2_usd: 0 }, p)).toMatchObject({ n2: 84, interim_look: true });
  });
  test("allowance doubling when a cell's 95th-percentile cost passes half the allowance", () => {
    expect(readout({ ...all(4, 12, { cost: 4.5 }), checks: [check], ...money }, p).release.allowance_doubled).toEqual({ opus: true, particle: true });
    expect(readout({ ...all(4, 12), checks: [check], ...money }, p).release.allowance_doubled).toEqual({ opus: false, particle: false });
  });
  test("seal and unseal round trip under a key outside the repo; a wrong digest, an existing file or a key in the repo refuses", () => {
    const dir = mkdtempSync(join(tmpdir(), "cso-readout-"));
    const keyPath = join(dir, "key");
    writeFileSync(keyPath, "ab".repeat(32));
    chmodSync(keyPath, 0o600);
    const key = readKey(keyPath);
    const { sealed } = readout({ ...all(4, 12), checks: [check], ...money }, p);
    const out = join(dir, "stage1.sealed");
    const sha = seal(sealed, key, out);
    expect(unseal(out, key, sha)).toEqual(sealed);
    expect(() => unseal(out, key, "0".repeat(64))).toThrow(/^E_CSO_READOUT_OUT/);
    expect(() => seal(sealed, key, out)).toThrow(/^E_CSO_READOUT_OUT/);
    expect(() => readKey(join(import.meta.dir, "cso-analysis.test.ts"))).toThrow(/^E_CSO_READOUT_KEY/);
  });
});
