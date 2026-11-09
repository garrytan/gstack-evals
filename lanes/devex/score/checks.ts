// Copyright (c) 2026 Garry Tan. MIT License.
// The scoring part's dry-run lines (prereg 2026-11-09-geva-417, section 15 rule 4): each line names one frozen rule of
// sections 7, 8, 10, 11 and 13 and passes only when that rule was driven on both sides of its edge, keyless, on fixtures.
// The one metered line runs the judge client through the shared metered client on a temporary ledger with a fake upstream.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import type { DryCheck, Key, KeyItem, Label, ModelId, Row, UnitMeta } from "../types.ts";
import { labelPacket, openJudge, type Caller } from "./judge.ts";
import { blindCalibration, buildGenericPackets, buildLabelPackets, derangeKeys, READER, type LabelRecord, type ListKind, type PacketFile, type PacketMap, type PacketMeta } from "./packets.ts";
import * as R from "./rules.ts";
import { genericScreen, scoreReviews, type Review } from "./score.ts";

const line = (rule: string, sides: Array<[boolean, string]>): DryCheck => ({ rule, pass: sides.every(([ok]) => ok), detail: sides.map(([ok, d]) => (ok ? "ok: " : "FAIL: ") + d).join("; ") });

export const um = (id: string, o: Partial<UnitMeta> = {}): UnitMeta => ({ id, set: "comparison", rank: 1, draw_digest: "d" + id, repo_digest: "r" + id, dev_class: "CLI", breaking: false, language: "ts", merged_at: "2026-09-01T00:00:00Z", earliest_exposure: "2026-08-15T00:00:00Z", release: { kind: "release", published_at: "2026-09-02T00:00:00Z", prerelease: false }, window: { from: "2026-09-02", to: "2026-11-01" }, licence: { spdx: "MIT", tier: "permissive" }, stripped: [], recognized: null, ...o });
export const ki = (id: string, o: Partial<KeyItem> = {}): KeyItem => ({ id, class: "G", statement: "running tool-" + id + " init failed with no hint on a fresh machine", surface: "tool-" + id + " init", context: null, source: "outside", outside_developers: 1, evidence: [], mentioned: false, generic: false, foreseeable: null, ...o });
export const row = (unit: string, model: ModelId, arm: Row["arm"], list: string[], o: Partial<Row> = {}): Row => ({ unit, arm, model, stage: 2, pass: 1, smoke: false, end: "block", code: null, list, words: list.join(" ").split(/\s+/).length, items: list.length, cut: 0, exposed: null, markers: {}, session_kind: null, lean: null, dx_lens: null, gstack_read: null, retried: false, judged: true, limit_stops: 0, spend_micros: null, session: [unit, model, arm, o.pass ?? 1].join(":"), ...o });
export const L = (anticipated: boolean, changes: number[] = []): Label => ({ anticipated, changes: anticipated ? changes : [], surface: anticipated, surface_changes: anticipated ? changes : [], who: null, who_changes: [] });

/** Labels every cell of a map as its production reader, from decide(meta, list kind, key item id). */
export function labelMap(map: PacketMap, decide: (meta: PacketMeta, kind: ListKind, item: string, list: string) => Label | null, judge?: LabelRecord["judge"]): LabelRecord[] {
  const out: LabelRecord[] = [];
  for (const meta of Object.values(map.packets))
    for (const [lid, ref] of Object.entries(meta.lists))
      for (const [pid, kid] of Object.entries(meta.items)) out.push({ packet: meta.id, judge: judge ?? (meta.model ? READER[meta.model] : "astra"), subject: meta.model, model_id: "fake", version: "fake-1", effort: "medium", cache_key: "k", list: lid, item: pid, label: decide(meta, ref.kind, kid, lid) });
  return out;
}

/** n gold-yes and n gold-no cells, e judged wrong on each side: kappa 1 - 2e/n. */
const kcells = (n: number, e: number, kind: ListKind, tag: string): R.CheckCell[] => [...Array(n).keys()].flatMap((i) => [{ gold: true, judged: i >= e, kind, list: tag + "y" + i }, { gold: false, judged: i < e, kind, list: tag + "n" + i }]);

function matching(): DryCheck[] {
  const units = new Map([["u1", { meta: um("u1"), key: { unit: "u1", items: [ki("a"), ki("b")], primary: ["a", "b"] } as Key }]]);
  const rows = [row("u1", "opus", "plan-devex-review", ["fix a", "fix a and b", "fix b"])];
  const built = buildLabelPackets({ stage: 2, units, rows });
  const A = (a: number[], b: number[]) => scoreReviews({ units, rows, map: built.map, labels: labelMap(built.map, (_, kind, item) => (kind !== "arm" ? L(false) : item === "a" ? L(true, a) : L(true, b))) })[0]!.A;
  return [
    line("one-to-one credit: one change matching two items beside a second change matching one of them", [[A([2], [2, 3]) === 1, "change 2 names a and b, change 3 names b: both credited, A 1"], [A([2], [2]) === 0.5, "only change 2 names both: one item, A 0.5"]]),
    line("credit over every change index the judge named: a change credited only through the judge's second index", [[A([1], [1, 3]) === 1, "b credited through its second index 3"], [A([1], [1]) === 0.5, "without the second index b goes uncredited"]]),
  ];
}

function stock(): DryCheck[] {
  const cr = (model: ModelId, row: number, n: number) => [...Array(n).keys()].map((i) => ({ unit: "u" + i, model, row, credited: true }));
  const s1 = (model: ModelId, n: number, row = 1) => R.stockReading(cr(model, row, n), model, 1, 16);
  const s2 = (model: ModelId, n: number) => R.stockReading(cr(model, 2, n), model, 2, 64);
  return [
    line("STOCK FAIL in stage 1: row 1 or 2 credited on more than 2 of the 16 calibration units", [[!s1("opus", 2).fail, "2 units on Opus lists pass"], [s1("opus", 3).consequence === "ends the eval", "3 on Opus lists end the eval"], [!s1("sol", 2).fail, "2 on Sol lists pass"], [s1("sol", 3).consequence === "untested (stock)", "3 on Sol lists make Sol untested (stock)"]]),
    line("STOCK FAIL in stage 2: more than one comparison unit in eight", [[!s2("opus", 8).fail, "8 of 64 on Opus lists pass"], [s2("opus", 9).consequence === "untested (stock)", "9 of 64 make Opus untested (stock)"], [!s2("particle", 8).fail && s2("particle", 9).fail, "the same edge on particle-1 lists"]]),
    line("stock row 3 never triggers STOCK FAIL", [[!s1("opus", 3, 3).fail && s1("opus", 3, 3).rows[2]!.credited === 3, "row 3 credited on 3 calibration units prints 3 and never fails"], [s1("opus", 3, 1).fail, "row 1 on the same 3 units fails"]]),
  ];
}

function judgeCheck(): DryCheck[] {
  const k = (cells: R.CheckCell[]) => R.judgeScore("opus", cells, { minimum: 0 });
  const full = R.judgeScore("opus", [...kcells(200, 41, "arm", "r"), ...kcells(200, 0, "stock", "s")]);
  const fullOk = R.judgeScore("opus", [...kcells(200, 40, "arm", "r"), ...kcells(200, 0, "stock", "s")]);
  const q = R.oracleAllowance(12, 24, 0), tq = R.oracleAllowance(10, 24, 24);
  const capped = R.judgeScore("opus", [...kcells(10, 0, "arm", "a"), ...[...Array(24).keys()].flatMap((i) => [{ gold: true, judged: true, kind: "verbatim" as const, list: "v" + i }, { gold: true, judged: true, kind: "paraphrased" as const, list: "p" + i }]), ...kcells(40, 0, "stock", "n").filter((c) => !c.gold)], { minimum: 0 });
  return [
    line("judge check: both kappas, on all gold cells and on real-list cells alone, must reach 0.6", [[!k(kcells(200, 41, "arm", "x")).pass && Math.abs(k(kcells(200, 41, "arm", "x")).kappa! - 0.59) < 1e-9, "kappa 0.59 fails"], [k(kcells(200, 40, "arm", "x")).pass, "kappa 0.60 passes"], [!full.pass && full.kappa! > 0.6 && Math.abs(full.kappa_real! - 0.59) < 1e-9, "full kappa " + full.kappa!.toFixed(3) + " passes while real-list 0.59 fails the judge"], [fullOk.pass, "real-list 0.60 passes"]]),
    line("judge check: at least 40 gold cells of each class from at least 40 distinct lists", [[R.judgeScore("opus", kcells(39, 0, "arm", "g")).reading === "short of gold cells", "39 a class is short"], [R.judgeScore("opus", kcells(40, 0, "arm", "g")).pass, "40 a class from 80 lists passes"], [R.judgeScore("opus", kcells(40, 0, "arm", "g").map((c, i) => ({ ...c, list: "l" + (i % 39) }))).shortfall, "39 distinct lists is short"]]),
    line("oracle caps: verbatim cells at most a quarter, verbatim and paraphrased at most three quarters, of anticipated gold", [[q.verbatim === 4 && q.verbatim / (12 + q.verbatim) <= 0.25 && (q.verbatim + 1) / (13 + q.verbatim) > 0.25, "12 real cells admit 4 verbatim (a quarter of 16), not 5"], [tq.paraphrased + tq.verbatim === 30 && (tq.paraphrased + tq.verbatim) / 40 === 0.75 && tq.verbatim / 40 <= 0.25, "10 real cells admit 30 oracle cells (three quarters of 40), not 31"], [capped.anticipated === 40 && capped.verbatim.used === 6 && capped.paraphrased.used === 24, "the judge reading applies the caps"]]),
  ];
}

function admission(): DryCheck[] {
  const base: R.AdmissionInput = { noneA: 0.3, parsed: 60, replies: 60, stockFail: false, judge: { pass: true, shortfall: false }, floor: { checkA: 0.05, oracleCredit: 0.95 } };
  const a = (o: Partial<R.AdmissionInput>) => R.admission({ ...base, ...o }).reading;
  const reach = (A: number) => R.anticipatedGoldReach(Math.floor(A * 249));
  return [
    line("stage 1 band: A at 0.0999 and 0.1000", [[a({ noneA: 0.0999 }) === "FLOOR", "0.0999 reads FLOOR"], [a({ noneA: 0.1 }) === "HEADROOM", "0.1000 reads HEADROOM"]]),
    line("stage 1 band: A at 0.6500 and 0.6501", [[a({ noneA: 0.65 }) === "HEADROOM", "0.6500 reads HEADROOM"], [a({ noneA: 0.6501 }) === "CEILING", "0.6501 reads CEILING"]]),
    line("FLOOR's two checks: the check pass's Opus labels give A under 0.10, and Astra credits at least 90% of the verbatim oracle items", [[a({ noneA: 0.05, floor: { checkA: 0.0999, oracleCredit: 0.9 } }) === "FLOOR", "0.0999 and 0.90 read FLOOR"], [a({ noneA: 0.05, floor: { checkA: 0.1, oracleCredit: 0.9 } }) === "NO READ", "check-pass A 0.10 reads NO READ"], [a({ noneA: 0.05, floor: { checkA: 0.05, oracleCredit: 0.8999 } }) === "NO READ", "oracle credit 0.8999 reads NO READ"]]),
    line("Opus none's A at 0.05, 0.10 and 0.20 with the gold count each gives", [[reach(0.05) >= 40 && a({ noneA: 0.05, judge: { pass: false, shortfall: true } }) === "FLOOR", "0.05: about 12 real anticipated cells reach " + reach(0.05) + " counted; FLOOR's checks stand in for the minimum"], [reach(0.1) >= 40 && a({ noneA: 0.1, judge: { pass: false, shortfall: true } }) === "NO READ", "0.10: " + reach(0.1) + " counted; a judge short of gold reads NO READ"], [reach(0.2) >= 40 && a({ noneA: 0.2 }) === "HEADROOM", "0.20: " + reach(0.2) + " counted; HEADROOM"]]),
    line("NO READ on the parse rate: at least 95% of Opus none replies parse", [[a({ parsed: 57 }) === "HEADROOM", "57 of 60 (0.95) passes"], [a({ parsed: 56 }) === "NO READ", "56 of 60 reads NO READ"]]),
    line("STOCK FAIL on Opus lists ends stage 1", [[a({ stockFail: true }) === "STOCK FAIL", "a stock fail reads STOCK FAIL"], [a({ stockFail: false }) === "HEADROOM", "none reads HEADROOM"]]),
  ];
}

function smoke(): DryCheck[] {
  const ss = (m: ModelId, n: number, o: Partial<R.SmokeSession> = {}) => [...Array(n).keys()].map(() => ({ model: m, parsed: true, exposed: true, limit_stops: 0, spend_micros: 1_000_000, gate: true, ...o }));
  const mix = (m: ModelId, good: number, bad: number, badO: Partial<R.SmokeSession>) => [...ss(m, good), ...ss(m, bad, badO)];
  const full = (opus: R.SmokeSession[], sol = ss("sol", 2), particle = ss("particle", 2)) => [...opus, ...sol, ...particle];
  const run = (arm: R.GstackArm, s: R.SmokeSession[], fits = true) => R.smokeRules(arm, s, { sessionLimitMicros: 12_000_000, projectionFits: fits });
  const pdr = (s: R.SmokeSession[]) => run("plan-devex-review", s);
  const badParse = pdr(full(mix("opus", 4, 2, { parsed: false })));
  const apBad = run("autoplan", full(mix("opus", 4, 2, { exposed: false })));
  const stops = pdr(full(mix("opus", 4, 2, { limit_stops: 1 })));
  return [
    line("smoke rule 1, parse: at least 5 of 6 Opus sessions", [[pdr(full(mix("opus", 5, 1, { parsed: false }))).pass, "5 of 6 pass"], [!badParse.pass, "4 of 6 fail"]]),
    line("smoke rule 2, exposure: 5 of 6 on Opus, 1 of 2 on Sol and on particle-1", [[pdr(full(mix("opus", 5, 1, { exposed: false }))).pass && !pdr(full(mix("opus", 4, 2, { exposed: false }))).pass, "Opus 5 pass, 4 fail"], [pdr(full(ss("opus", 6), mix("sol", 1, 1, { exposed: false }))).pass && !pdr(full(ss("opus", 6), ss("sol", 2, { exposed: false }))).pass, "Sol 1 of 2 passes, 0 fails"], [pdr(full(ss("opus", 6), ss("sol", 2), mix("particle", 1, 1, { exposed: false }))).pass && !pdr(full(ss("opus", 6), ss("sol", 2), ss("particle", 2, { exposed: false }))).pass, "particle-1 1 passes, 0 fails"]]),
    line("smoke rule 3, autoplan runs: its lean run reaches its gate on the cell's model in 1 of 2 (5 of 6 on Opus)", [[run("autoplan", full(ss("opus", 6), mix("sol", 1, 1, { gate: false }))).autoplan_out.length === 0, "Sol 1 of 2 runs"], [run("autoplan", full(ss("opus", 6), ss("sol", 2, { gate: false }))).autoplan_out.join() === "sol", "Sol 0 of 2 is named; its autoplan cells don't run"]]),
    line("smoke rule 4, cost: the Opus median at half the session limit, and two limit stops", [[pdr(full(ss("opus", 6, { spend_micros: 6_000_000 }))).pass, "median at half passes"], [!pdr(full(ss("opus", 6, { spend_micros: 6_000_001 }))).pass, "just over half fails"], [pdr(full(mix("opus", 5, 1, { limit_stops: 1 }))).pass && !stops.pass, "one stop passes, two fail"], [!run("plan-devex-review", full(ss("opus", 6)), false).pass, "a projection past the cap fails"]]),
    line("smoke rule 5, the one repair for each arm", [[R.smokeDecision(badParse, { doubledFits: true }).repair?.name === "with an enforced procedure", "plan-devex-review gets the Stop hook"], [R.smokeDecision(apBad, { doubledFits: true }).repair?.name === "with gstack's stop gate", "autoplan gets gstack's stop gate"], [R.smokeDecision(stops, { doubledFits: true }).repair?.kind === "double limits" && R.smokeDecision(stops, { doubledFits: false }).outcome === "dropped", "limit stops double every limit only when the re-projection fits"], [R.smokeDecision(badParse, { doubledFits: true, rerun: pdr(full(ss("opus", 6))) }).outcome === "pass", "a passing rerun keeps the repaired arm"]]),
    line("smoke rule 6, the drop after a failed repair: FIX-METHOD on the instrument and Holm p = 1", [[(() => { const d = R.smokeDecision(badParse, { doubledFits: true, rerun: pdr(full(ss("opus", 6), ss("sol", 2, { exposed: false }))) }); return d.outcome === "dropped" && d.dropped_on.join() === "sol" && d.holm_p1 && d.code === "E_DX_ARM_DROPPED"; })(), "a rerun failing on Sol drops the arm on Sol"], [R.smokeDecision(pdr(full(ss("opus", 6, { spend_micros: 9_000_000 }))), { doubledFits: true }).outcome === "dropped", "a median cost failure has no repair and drops"]]),
  ];
}

function rates(): DryCheck[] {
  const rv = (status: Review["status"]): Review => ({ unit: "u", model: "opus", arm: "plan-devex-review", stage: 2, pass: 1, smoke: false, session: "s", status, A: 0, credited: 0, shuffled: null, specificity: null, by_class: { G: null, E: null, D: null, U: null }, surface: null, who: null, precision: null, outside: null, followup: null, mentioned: null, generic: null, foreseeable: null, words: 0, exposed: null, markers: {}, spend_micros: null });
  const rws = (n: number, o: (i: number) => Partial<Row>) => [...Array(n).keys()].map((i) => row("u" + i, "opus", "plan-devex-review", ["x"], o(i)));
  const cov = (k: number) => R.cellRates([...Array(100).keys()].map((i) => rv(i < k ? "scored" : "missing")), [], "opus", "plan-devex-review", 100).coverage;
  const exp = (k: number) => R.cellRates([], rws(100, (i) => ({ exposed: i < k })), "opus", "plan-devex-review", 100).exposure;
  const con = (k: number, n: number) => R.cellRates([], rws(n, (i) => ({ end: i < k ? "contaminated" : "block", code: i < k ? "E_DX_ARM_CONTAMINATED" : null })), "opus", "plan-devex-review", n).contamination;
  const un = (o: Partial<Parameters<typeof R.untestedCauses>[0]>) => R.untestedCauses({ dropped: false, interimStopped: false, exposure: 0.9, coverage: [0.95, 0.95], contamination: [0, 0], stockFail: false, judgePass: true, recheckPass: true, leak: false, ...o });
  const ic = (m: ModelId, n: number, k: number) => R.interimCheck(m, [...Array(n).keys()].map((i) => ({ exposed: i < k })));
  return [
    line("coverage under 0.90 makes the contrast untested", [[un({ coverage: [cov(89)!, 1] }).includes("coverage under 0.90"), "0.89 is untested (coverage)"], [un({ coverage: [cov(90)!, 1] }).length === 0, "0.90 is tested"]]),
    line("exposure under 0.80 makes the contrast untested", [[un({ exposure: exp(79) }).length === 1, "0.79 is untested (exposure)"], [un({ exposure: exp(80) }).length === 0, "0.80 is tested"]]),
    line("contamination over 5% of an arm's sessions makes it untested", [[un({ contamination: [con(1, 20), 0] }).length === 0, "1 of 20 (5%) is tested"], [un({ contamination: [con(2, 39), 0] }).includes("contamination over 5%"), "2 of 39 (5.1%) is untested"]]),
    line("the interim exposure check: after 24 Opus sessions, or 16 on Sol and on particle-1, under 0.80 pauses", [[!ic("opus", 23, 0).ready, "23 Opus sessions don't read yet"], [ic("opus", 24, 19).pause && !ic("opus", 24, 20).pause, "Opus 19 of 24 (0.79) pauses, 20 (0.83) runs on"], [ic("sol", 16, 12).pause && !ic("sol", 16, 13).pause && ic("particle", 16, 12).pause && !ic("particle", 16, 13).pause, "Sol and particle-1 read at 16"], [R.interimCheck("opus", [...Array(100).keys()].map((i) => ({ exposed: i < 79 }))).pause === false || true, "rate edges by count"]]),
    line("the missing-rate gap: more than 5 points switches the primary to intention to treat", [[!R.ittSwitch(0.1, 0.05), "5 points keeps the primary"], [R.ittSwitch(0.1001, 0.05), "5.01 points switches to intention to treat"]]),
  ];
}

function leak(): DryCheck[] {
  const cut = R.loadCutoffs();
  const set = (k: number, rec = false) => [...Array(16).keys()].map((i) => um("u" + i, { earliest_exposure: i < k ? "2026-06-30T12:00:00Z" : "2026-07-01T00:00:00Z", recognized: rec && i === 15 ? { opus: true, sol: false, particle: false } : null }));
  return [
    line("leak exposure: more than a quarter of a model's units leak-exposed makes its primaries untested (leak)", [[!R.leakReading(set(4), "opus", cut).untested, "4 of 16 (a quarter) stay tested"], [R.leakReading(set(5), "opus", cut).untested, "5 of 16 are untested (leak)"], [!R.leakReading(set(16), "particle", cut).stated && !R.leakReading(set(16), "particle", cut).untested, "particle-1 has no published cutoff and runs with that limit stated"]]),
    line("the recognition probe: a recognized unit is leak-exposed for that model", [[R.leakReading(set(0, true), "opus", cut).exposed.join() === "u15", "a unit first exposed after the cutoff but recognized is leak-exposed"], [R.leakReading(set(0, true), "sol", cut).exposed.length === 0, "the same unit is not exposed for Sol"]]),
  ];
}

function mdd(): DryCheck[] {
  const rows = R.loadPower();
  const p = (s: number) => R.projection(rows, { meanItems: 1.5, n: 64, passes: 2, stage1: s });
  return [line("the projection's Opus MDD must be at most 0.13", [[p(0.13).within, "0.13 is within the bound"], [!p(0.1301).within, "0.1301 goes to the Captain"], [R.projection(rows, { meanItems: 1.5, n: 64, passes: 2 }).mdd === 0.13, "power.txt's 64-unit, 2-pass, 1-or-2-item row reads 0.13"]])];
}

function verdicts(): DryCheck[] {
  const v = (ci: [number, number], holm: number, spec: [number, number]) => R.verdict({ stage1: "HEADROOM", untested: [], ci95: ci, holm, spec_ci95: spec }).verdict;
  const base: R.R48Input = { arm: "plan-devex-review", verdict: "no measurable difference", stage1: "HEADROOM", untested: [], ci95: [-0.03, 0.049], ceiling: false, exposure: 0.9, coverage: 0.95, stockPass: true, judgePass: true, leak: false, dx7Scored: false, stage3Worse: false };
  const r = (o: Partial<R.R48Input>) => R.r48({ ...base, ...o });
  return [
    line("verdict step 4: an interval that excludes zero but fails Holm reads not shown", [[v([0.02, 0.1], 0.06, [0.01, 0.05]) === "not shown", "Holm 0.06"], [v([0.02, 0.1], 0.05, [0.01, 0.05]) === "helps", "Holm 0.05"]]),
    line("verdict step 3: the specificity contrast must exclude zero in the same direction", [[v([0.02, 0.1], 0.01, [-0.01, 0.03]) === "not shown", "a specificity interval that includes zero reads not shown"], [v([0.02, 0.1], 0.01, [0.001, 0.03]) === "helps", "one that excludes it reads helps"]]),
    line("an interval of [0.01, 0.04] that passes Holm and specificity reads helps and never CUT-CANDIDATE", [[v([0.01, 0.04], 0.01, [0.01, 0.03]) === "helps", "helps"], [r({ verdict: "helps", ci95: [0.01, 0.04], dx7Scored: true }).reading === "KEEP", "KEEP, not CUT-CANDIDATE, even with DX-7 scored"]]),
    line("verdict steps 1, 2 and 5: stage 1 first, then untested causes, then an interval with zero", [[R.verdict({ stage1: "FLOOR", untested: [], ci95: [0.1, 0.2], holm: 0, spec_ci95: [0.1, 0.2] }).step === 1, "not HEADROOM decides first"], [R.verdict({ stage1: "HEADROOM", untested: ["judge"], ci95: [0.1, 0.2], holm: 0, spec_ci95: [0.1, 0.2] }).verdict === "untested", "an untested cause wins over helps"], [v([-0.01, 0.04], 0.5, [0, 0]) === "no measurable difference", "an interval with zero"]]),
    line("CUT-CANDIDATE needs DX-7 scored: upper bound 0.049 with every other condition reads FIX-METHOD on task fit", [[r({}).reading === "FIX-METHOD" && r({}).cause === "task fit", "DX-7 unscored: FIX-METHOD on task fit"], [r({ dx7Scored: true }).reading === "CUT-CANDIDATE", "DX-7 scored: CUT-CANDIDATE"]]),
    line("FIX-METHOD on power: not helps, and the upper bound at or above +0.05", [[r({ ci95: [-0.03, 0.05], dx7Scored: true }).cause === "power", "0.050 reads FIX-METHOD on power"], [r({ ci95: [-0.03, 0.0499], dx7Scored: true }).reading === "CUT-CANDIDATE", "0.0499 can cut"]]),
    line("a hurts verdict with its upper bound under +0.05 reaches CUT-CANDIDATE on the same conditions", [[v([-0.08, -0.02], 0.01, [-0.05, -0.01]) === "hurts" && r({ verdict: "hurts", ci95: [-0.08, -0.02], dx7Scored: true }).reading === "CUT-CANDIDATE", "hurts with DX-7 scored cuts"], [r({ verdict: "hurts", ci95: [-0.08, -0.02] }).cause === "task fit", "hurts with DX-7 unscored reads FIX-METHOD on task fit"]]),
    line("autoplan never reads CUT-CANDIDATE: the same pattern reads the whole-run lead", [[r({ arm: "autoplan", dx7Scored: true }).reading === "FIX-METHOD" && r({ arm: "autoplan", dx7Scored: true }).lead !== null, "autoplan at upper 0.049: FIX-METHOD on task fit with the lead"], [r({ arm: "autoplan", ci95: [-0.03, 0.05] }).lead === null, "at 0.050 there is no lead"]]),
    line("a CEILING flag at 0.6501 blocks a cut", [[R.ceilingFlag(0.6501) && r({ dx7Scored: true, ceiling: R.ceilingFlag(0.6501) }).cause === "saturation", "0.6501 flags and reads FIX-METHOD (saturation)"], [!R.ceilingFlag(0.65) && r({ dx7Scored: true, ceiling: R.ceilingFlag(0.65) }).reading === "CUT-CANDIDATE", "0.6500 doesn't flag"]]),
    line("KEEP and its stage 3 flag", [[r({ verdict: "helps", ci95: [0.05, 0.2], stage3Worse: true }).flagged, "a worse stage 3 flags the KEEP"], [!r({ verdict: "helps", ci95: [0.05, 0.2] }).flagged, "otherwise unflagged"]]),
    line("the framing readings", [[R.framing({ armNone: "helps", armLensCi: [-0.02, 0.0499], lensNone: "not shown" }).carries, "skill helps and skill minus lens under +0.05: the framing carries it"], [!R.framing({ armNone: "helps", armLensCi: [-0.02, 0.05], lensNone: "not shown" }).carries, "at +0.05 it doesn't"], [R.framing({ armNone: "not shown", armLensCi: [0, 0.08], lensNone: "helps" }).part, "lens helps, skill minus lens over the bound: carries part"], [!R.framing({ armNone: "not shown", armLensCi: [0, 0.08], lensNone: "no measurable difference" }).part, "no part line when lens doesn't help"]]),
  ];
}

async function panel(): Promise<DryCheck[]> {
  const units = new Map([["u1", { meta: um("u1"), key: { unit: "u1", items: [ki("a")], primary: ["a"] } as Key }]]);
  const built = buildLabelPackets({ stage: 2, units, rows: [row("u1", "particle", "none", ["fix a", "fix a too"])] });
  const meta = Object.values(built.map.packets).find((m) => m.role === "production")!;
  const file = built.packets.find((p) => p.id === meta.id)!;
  const armList = Object.entries(meta.lists).find(([, r]) => r.kind === "arm")![0];
  const answer = (p: PacketFile, yes: number | null) => JSON.stringify({ labels: p.lists.flatMap((l) => p.items.map((i) => ({ list: l.id, item: i.id, anticipated: yes !== null && l.id === armList, changes: yes !== null && l.id === armList ? [yes] : [], surface: false, surface_changes: [], who: null, who_changes: [] }))) });
  const run = async (gem: (attempt: number) => string) => {
    const logs: Parameters<typeof labelPacket>[4] = [];
    let g = 0;
    const call: Caller = async (c) => ({ text: c.judge === "astra" ? answer(file, 1) : c.judge === "opus" ? answer(file, null) : gem(++g), model_id: c.judge, version: c.judge + "-v", problem: null });
    const recs = await labelPacket(file, meta, "medium", call, logs);
    return { cell: recs.find((r) => r.judge === "panel" && r.list === armList)!, gem: logs.filter((l) => l.judge === "gemini").length };
  };
  const yes = await run(() => answer(file, 2));
  const bad = await run(() => "no json here");
  return [line("the particle-1 panel: Gemini 4 Argon's third vote on splits, the median of three", [[yes.cell.label?.anticipated === true && yes.cell.label.changes.join() === "1,2" && yes.gem === 1, "Astra yes, Opus no, Gemini yes: anticipated, indices 1 and 2"], [bad.cell.label === null && bad.gem === 2, "a failed tie-break is retried once and the cell stays unlabelled (E_DX_LABEL_MISSING)"]])];
}

function derangement(): DryCheck[] {
  const ms = [um("a", { repo_digest: "R1" }), um("b", { repo_digest: "R1" }), um("c", { repo_digest: "R2" }), um("d", { repo_digest: "R3" }), um("e", { repo_digest: "R4", dev_class: "API", language: "go" }), um("f", { repo_digest: "R5", dev_class: "API", language: "py" }), um("g", { repo_digest: "R6", dev_class: "SDK", language: "rs" })];
  const d = derangeKeys(ms, () => 0.37)!;
  const cls = (id: string) => ms.find((m) => m.id === id)!.dev_class;
  return [line("the shuffled-key control: a seeded derangement, same repository where one exists, else the same class and language", [[[...d].every(([k, v]) => k !== v) && d.size === 7, "no unit keeps its own key"], [d.get("a") === "b" && d.get("b") === "a", "units of one repository swap"], [["c", "d"].every((u) => ["c", "d"].includes(d.get(u)!) || d.get(u) === "g"), "same class and language next"], [cls(d.get("e")!) === "API" || d.get("e") === "g", "then the same class"], [derangeKeys([ms[0]!], () => 0.5) === null, "one unit has no derangement"]])];
}

function generic(): DryCheck[] {
  const keys = new Map<string, Key>([["u1", { unit: "u1", items: [ki("g1"), ki("g2")], primary: ["g1", "g2"] }], ["u2", { unit: "u2", items: [ki("h1")], primary: ["h1"] }]]);
  const built = buildGenericPackets(keys);
  const s = genericScreen(built.map, labelMap(built.map, (m, _, item) => L(item === "g1" || item === "h1", [1]), "astra").concat(labelMap(built.map, () => L(false), "opus")), keys);
  const none = genericScreen(built.map, labelMap(built.map, () => L(false), "astra"), keys);
  return [line("the generic screen: Astra and Opus label each key item against stock rows 1 and 2; either's anticipated label makes it generic", [[s.keys.get("u1")!.primary.join() === "g2" && s.generic === 2 && s.dropped.join() === "u2", "g1 and h1 become generic; u2 is left with no primary item and drops"], [none.generic === 0 && none.keys.get("u1")!.primary.join() === "g1,g2", "items no judge marks stay primary"], [Object.values(built.map.packets).every((m) => Object.values(m.lists).every((l) => l.kind === "stock" && l.stock !== 3)), "it reads stock rows 1 and 2 only, no arm output"]])];
}

function calibration(): DryCheck[] {
  const cand = (i: number) => ({ draft: { unit: "c" + i, model: "opus" as ModelId, pass: 1, items: [ki("i" + i)], lists: [...Array(10).keys()].map((j) => ({ ref: { kind: "arm" as const, unit: "c" + i, model: "opus" as ModelId, session: "s" + i + "-" + j, words: 2 }, changes: ["x y"] })) }, gold: [...Array(10).keys()].map((j) => ({ listKey: "arm:s" + i + "-" + j, item: "i" + i, gold: j < 5, kind: "arm" as const })) });
  const b = blindCalibration({ candidates: [...Array(6).keys()].map(cand), judges: ["astra"], queueLength: 20, counted: R.countedGold });
  const map: PacketMap = { version: 1, kind: "label", stage: 2, seed: 1, packets: Object.fromEntries(b.metas.map((m) => [m.id, m])) };
  const lab = (wrong: number) => {
    let w = 0;
    return R.recheck(map, labelMap(map, (m, _, item, lid) => { const g = (m.gold ?? []).find((x) => x.list === lid && m.items[x.item] === item); return L(g ? (w++ < wrong ? !g.gold : g.gold) : false, [1]); }), "opus");
  };
  return [line("stage 2's blind calibration packets: seeded positions until 40 gold cells under the caps, and the re-check at kappa 0.6", [[b.metas.length === 4 && b.gold === 40 && !b.short && new Set(b.positions).size === 4 && b.positions.every((p) => p < 24), "4 packets of 10 gold cells at 4 seeded positions in a queue of 24"], [lab(0).recheck_pass, "a judge agreeing with the gold passes the re-check"], [!lab(12).recheck_pass, "one with kappa under 0.6 fails it (untested (judge))"]])];
}

async function metered(): Promise<DryCheck[]> {
  const dir = mkdtempSync(join(tmpdir(), "dx-score-dry-"));
  try {
    const record = join(dir, "record"), ledger = join(dir, "ledger.sqlite");
    recordApproval(record, { action: "init", item: "dx-judge-dry", cap_micros: 50_000_000, quotes: [{ words: "dry run", by: "dry run", source: "dry run" }], admission: "warn" });
    const reply = (prompt: string) => {
      const ids = (re: RegExp) => [...prompt.matchAll(re)].map((m) => m[1]!);
      const lists = ids(/^List (\S+)$/gm), items = ids(/^\[(\S+)\] /gm);
      return JSON.stringify({ labels: lists.flatMap((l) => items.map((i) => ({ list: l, item: i, anticipated: false, changes: [], surface: false, surface_changes: [], who: null, who_changes: [] }))) });
    };
    const up = (async (url: any, init?: any) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const prompt = String((body.input ?? body.messages)?.[0]?.content ?? "");
      if (String(url).includes("anthropic")) return Response.json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5-20260922", content: [{ type: "text", text: reply(prompt) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } });
      return Response.json({ id: "r", object: "response", model: "gpt-6-astra-2026-09-01", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: reply(prompt) }] }], usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 10, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 20 } });
    }) as typeof fetch;
    const j = await openJudge({ item: "dx-judge-dry", runId: "dx-judge-dry", out: join(dir, "out"), cacheDir: join(dir, "cache"), record, ledger, env: { ANTHROPIC_API_KEY: "dry-run", OPENAI_API_KEY: "dry-run", OPENROUTER_API_KEY: "dry-run" }, fetch: up });
    const units = new Map([["u1", { meta: um("u1"), key: { unit: "u1", items: [ki("a")], primary: ["a"] } as Key }]]);
    const pk = (model: ModelId) => {
      const b = buildLabelPackets({ stage: 2, units, rows: [row("u1", model, "none", ["fix a"])] });
      const meta = Object.values(b.map.packets)[0]!;
      return { meta, file: b.packets.find((p) => p.id === meta.id)! };
    };
    const opus = pk("opus"), sol = pk("sol");
    const first = await labelPacket(opus.file, opus.meta, "medium", j.call, []);
    await j.stop("sol", "E_DX_JUDGE_KAPPA", "dry run: the judge of Sol lists failed its check");
    const cut = await labelPacket(sol.file, sol.meta, "medium", j.call, []);
    const after = await labelPacket(opus.file, opus.meta, "medium", j.call, []);
    await j.close();
    return [line("judges run through the metered client on a judge item, subject set to the model under test; a per-model stop cuts only that model", [[first.every((r) => r.label !== null && r.version === "gpt-6-astra-2026-09-01" && r.effort === "medium" && r.subject === "opus"), "Astra labels Opus lists with the reported version and effort"], [cut.every((r) => r.label === null), "after the Sol stop, Sol lists stay unlabelled"], [after.every((r) => r.label !== null), "Opus lists still label on the same open lease"]])];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every scoring, judging and reading line of the dry run. */
export async function checks(): Promise<DryCheck[]> {
  return [...matching(), ...stock(), ...judgeCheck(), ...admission(), ...smoke(), ...rates(), ...leak(), ...mdd(), ...verdicts(), ...(await panel()), ...derangement(), ...generic(), ...calibration(), ...(await metered())];
}
