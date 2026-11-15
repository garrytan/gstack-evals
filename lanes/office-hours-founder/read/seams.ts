// Copyright (c) 2026 Garry Tan. MIT License.
// The readings' dry-run seams for the office-hours founder eval (prereg
// wiki/plans/2026-11-09-geva-418-office-hours-founder-evidence-prereg, start rule 7): each seam drives one frozen rule on
// one side of its edge through this area's code, on invented fixtures that are never eval units, so the lane's dry
// run prints PASS or FAIL per edge. The fixture builders are exported for the area's tests.
import { MODELS } from "../frozen.ts";
import type { ManifestEntry, ModelId, ScoredSession, Seam, StockCredit, UnitMeta } from "../types.ts";
import { headlines } from "./headline.ts";
import { projectionRerun, type Python } from "./projection.ts";
import { bandDecide, judgeCheck, parseRate, readStage1, smoke, stockCheck, type CheckCell, type JudgeInput, type Stage1Input } from "./stage1.ts";
import { armGuess, cell, exposure, interimStop, interimStops, manifest, onManifest, readingRule, readPitch, readStage2, untestedReasons, verdict, type ContrastName, type Stage2Input, type Untested, type Verdict, type VerdictInput } from "./stage2.ts";
import { matchUnits, r4, W } from "./stats.ts";

// ---- Fixtures ----

export const session = (o: Partial<ScoredSession>): ScoredSession => ({
  stage: 2, kind: "arm", unit: "u01", model: "opus", arm: "none", pass: 1, stratum: "constructed", set: "comparison", end: "block",
  W: 0, W_shuffled: 0, W_customer: null, W_wedge: null, W_both: null, W_alt: 0, N: 0, R: null, E: 0.5, E_demand: 0.5, E_all: 0.5, order_share: 0.5,
  founder_turns: 5, questions: 5, pushes: 1, first_move_words: 30, exposed: null, limit_hit: false, arm_stop: false, gstack_read: false, web: false,
  named_source: false, usd: 1, sim_usd: 0.1, repairs: [], ...o,
});

export const unitMeta = (id: string, o: Partial<UnitMeta> = {}): UnitMeta => ({
  id, stratum: "constructed", set: "comparison", draw: 1, author: "sol", shape: "s1", type: "B2B", industry: "invented", primary: ["customer", "wedge"],
  mentioned: [], generic: [], founder_stage: "pre-product", digest: "0".repeat(64), ...o,
});

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, k) => prefix + String(k + 1).padStart(2, "0"));
export const CALIBRATION = ids("c", 16);
const TWINS = ids("t", 8);

/** Gold cells for one production judge: credited and not, false fails among the credited, and oracle cells beside them. */
export function judgeCells(credited: number, not: number, falseFail = 0, oracle = 0): CheckCell[] {
  let k = 0;
  const cell = (gold: boolean, judged: boolean, kind: CheckCell["kind"]): CheckCell => ({ gold, judged, kind, list: "b" + k++ });
  return [
    ...Array.from({ length: credited }, (_, j) => cell(true, j >= falseFail, "arm")),
    ...Array.from({ length: oracle }, () => cell(true, true, "oracle")),
    ...Array.from({ length: not }, () => cell(false, false, "arm")),
  ];
}
const nearMiss = (right: number, total: number) => Array.from({ length: total }, (_, j) => ({ expected: true, judged: j < right }));
const judgeInput = (cells = judgeCells(40, 40)): JudgeInput => ({ cells, unlabelled: 0, near_miss: nearMiss(10, 10) });

/**
 * Stage 1 that reads HEADROOM: Opus none credits 6 of 16 calibration units (0.375) on 3 passes and each twin like its
 * first skin; the reference credits 13 (0.8125); Sol and particle-1 run the same pattern on 2 passes; every judge, stock
 * row, audit and smoke session passes.
 */
export function stage1Fixture(): Stage1Input {
  const sessions: ScoredSession[] = [];
  const noneW = (u: string) => (Number(u.slice(1)) <= 6 ? 1 : 0);
  for (const model of MODELS) {
    const passes = model === "opus" ? 3 : 2;
    for (let pass = 1; pass <= passes; pass++) {
      for (const u of [...CALIBRATION, ...(model === "opus" ? TWINS : [])]) sessions.push(session({ stage: 1, model, unit: u, pass, set: u[0] === "t" ? "twin" : "calibration", W: noneW(u), W_shuffled: 0 }));
      for (const u of CALIBRATION) {
        const w = Number(u.slice(1)) <= 13 ? 1 : 0;
        sessions.push(session({ stage: 1, kind: "reference", model, unit: u, pass, set: "calibration", W: w, W_customer: w, W_wedge: 0 }));
      }
    }
  }
  const smokeRun = MODELS.flatMap((model) => CALIBRATION.slice(0, 6).map((u) => session({ stage: 1, model, arm: "office-hours", unit: u, set: "calibration", exposed: true, usd: 4 })));
  sessions.push(...[1, 2].map((pass) => session({ stage: 1, arm: "lens", unit: "c01", pass, set: "calibration", usd: 0.5 })));
  const stock: StockCredit[] = MODELS.flatMap((model) => ([1, 2, 3] as const).flatMap((row) => CALIBRATION.map((unit) => ({ stage: 1 as const, model, judge: "astra" as const, row, unit, W: 0 as const, N: 0 as const }))));
  return {
    sessions,
    units: [...CALIBRATION.map((id) => unitMeta(id, { set: "calibration" })), ...TWINS.map((id, k) => unitMeta(id, { set: "twin", twin_of: CALIBRATION[k] }))],
    audit: { pass: true, no_read: false, repaired: false },
    judges: { opus: judgeInput(), sol: judgeInput(), particle: judgeInput() },
    stock,
    smoke: smokeRun,
    resmoke: [],
    ceiling_attempt: false,
  };
}

/** Sets Opus none's W on the twin pairs: first skin a, second skin b, per pair index. */
const twinW = (i: Stage1Input, a: (k: number) => 0 | 1, b: (k: number) => 0 | 1): Stage1Input => ({
  ...i,
  sessions: i.sessions.map((s) => {
    if (s.kind !== "arm" || s.model !== "opus" || s.arm !== "none") return s;
    const t = TWINS.indexOf(s.unit), c = CALIBRATION.indexOf(s.unit);
    return t >= 0 ? { ...s, W: b(t) } : c >= 0 && c < 8 ? { ...s, W: a(c) } : s;
  }),
});

export const COMPARISON = ids("u", 10);
/**
 * Stage 2 on 10 invented units: every scheduled session scored with W from w, every pitch-only session at W 0 unless
 * extra replaces it, shuffled-key W 0, office-hours exposed,
 * clean stage 1, perfect gold re-check, and power.py's MDD stubbed at 0.13. edit may change a session or unrun it (null).
 */
export function stage2Fixture(o: { w: (e: ManifestEntry) => 0 | 1; edit?: (s: ScoredSession) => ScoredSession | null; extra?: readonly ScoredSession[]; real?: readonly string[]; stopped?: boolean; pitch_stopped?: boolean }): Stage2Input {
  const man = manifest(COMPARISON, { kind: "arm", real: false, cuts: [] });
  const sessions = man.flatMap((e) => {
    const s = session({ ...e, W: o.w(e), exposed: e.arm === "office-hours" ? true : null });
    const t = o.edit ? o.edit(s) : s;
    return t ? [t] : [];
  });
  const gold = Array.from({ length: 40 }, (_, k) => ({ gold: k < 20, judged: k < 20 }));
  const pitchManifest = manifest(COMPARISON, { kind: "pitch", real: false, cuts: [] });
  return {
    manifest: man,
    real_manifest: manifest(o.real ?? [], { kind: "arm", real: true, cuts: [] }),
    pitch_manifest: pitchManifest,
    sessions: [...sessions, ...pitchManifest.map((e) => session({ ...e, W: 0 })), ...(o.extra ?? [])],
    units: COMPARISON.map((id) => unitMeta(id)),
    stage1: { band: bandDecide(0.375, 0.8125, false), untested: { opus: [], sol: [], particle: [] }, smoke_drop: { opus: false, sol: false, particle: false }, repairs: [] },
    stock: [],
    gold: { opus: gold, sol: gold, particle: gold },
    voided: false,
    stopped: o.stopped ?? false,
    pitch_stopped: o.pitch_stopped ?? false,
    arm_guess: { correct: 15, total: 30 },
    mdd: () => 0.13,
  };
}
const helps = (e: ManifestEntry): 0 | 1 => (e.arm === "office-hours" ? 1 : 0);

// ---- Seams ----

const check = (name: string, ok: boolean, detail: string): Seam => ({ name, run: () => ({ ok, detail }) });
const seam = (name: string, f: () => { ok: boolean; detail: string }): Seam => ({ name, run: f });

const bandSeams: Seam[] = [
  [0.65, 0.8, "HEADROOM"], [0.6501, 0.8, "CEILING"], [0.1, 0.3, "HEADROOM"], [0.1, 0.2999, "FLOOR"], [0.3, 0.45, "HEADROOM"], [0.3, 0.4499, "NO ROOM"],
].map(([n, r, want]) => seam("band: Opus none " + n + ", reference " + r + " reads " + want, () => {
  const b = bandDecide(n as number, r as number, false);
  return { ok: b.reading === want, detail: b.reading + ", room " + b.room };
}));

const stage1Ends = (name: string, f: (i: Stage1Input) => Stage1Input, want: (r: ReturnType<typeof readStage1>) => boolean): Seam =>
  seam(name, () => {
    const r = readStage1(f(stage1Fixture()));
    return { ok: want(r), detail: "ends: " + (r.ends ?? "none") + "; untested " + JSON.stringify(r.untested) };
  });

const opusJudge = (j: JudgeInput) => (i: Stage1Input): Stage1Input => ({ ...i, judges: { ...i.judges, opus: j } });
const stockOn = (model: ModelId, units: number) => (i: Stage1Input): Stage1Input => ({ ...i, stock: i.stock.map((c) => (c.model === model && c.row === 1 && CALIBRATION.indexOf(c.unit) < units ? { ...c, W: 1 } : c)) });

const stage1Seams: Seam[] = [
  stage1Ends("stage 1 fixture reads HEADROOM and nothing ends", (i) => i, (r) => r.ends === null && r.ready && r.band.reading === "HEADROOM"),
  stage1Ends("band: Opus none 0.10 is under no edge; the 0.10 lower edge prints and stops nothing", (i) => ({ ...i, sessions: i.sessions.map((s) => (s.kind === "arm" && s.model === "opus" && s.arm === "none" ? { ...s, W: 0 } : s)) }), (r) => r.band.under_low && r.band.reading === "HEADROOM" && r.ends === null),
  stage1Ends("band: a second CEILING ends as FIX-METHOD (saturation)", (i) => ({ ...i, ceiling_attempt: true, sessions: i.sessions.map((s) => (s.kind === "arm" && s.arm === "none" ? { ...s, W: 1 } : s)) }), (r) => r.band.reading === "CEILING" && (r.ends ?? "").includes("saturation")),
  stage1Ends("twin check (a): the 90% interval wholly outside -0.10 to 0.10 reads NO READ (twin)", (i) => twinW(i, () => 1, () => 0), (r) => r.twin.test?.a_fail === true && (r.ends ?? "").startsWith("NO READ (twin)")),
  stage1Ends("twin check (a): identical skins track", (i) => i, (r) => r.twin.test?.a_fail === false && r.twin.track),
  stage1Ends("twin check (b): mean absolute difference above the re-split 95th percentile reads NO READ (twin)", (i) => twinW(i, () => 1, (k) => (k < 4 ? 0 : 1)), (r) => r.twin.test?.b_fail === true),
  stage1Ends("twin check (b): a balanced split passes part (a) and fails part (b)", (i) => twinW(i, (k) => (k < 4 ? 1 : 0), (k) => (k < 4 ? 0 : 1)), (r) => r.twin.test?.a_fail === false && r.twin.test?.b_fail === true && !r.twin.track),
  stage1Ends("twin floor: 5 pairs left reads NO READ (twin)", (i) => ({ ...i, sessions: i.sessions.filter((s) => !(["t01", "t02", "t03"].includes(s.unit) && s.pass === 3)) }), (r) => r.twin.pairs === 5 && r.twin.dropped.length === 3 && !r.twin.track),
  stage1Ends("twin floor: 6 pairs left still reads", (i) => ({ ...i, sessions: i.sessions.filter((s) => !(["t01", "t02"].includes(s.unit) && s.pass === 3)) }), (r) => r.twin.pairs === 6 && r.twin.track),
  stage1Ends("judge: Opus kappa 0.59 ends the eval", opusJudge(judgeInput(judgeCells(100, 100, 41))), (r) => r.judges.opus.reading === "fail" && (r.ends ?? "").includes("Opus judge")),
  stage1Ends("judge: Opus kappa 0.60 passes", opusJudge(judgeInput(judgeCells(100, 100, 40))), (r) => r.judges.opus.reading === "pass" && r.ends === null),
  stage1Ends("judge: 39 credited gold cells reads NO READ (judge) and ends on Opus", opusJudge(judgeInput(judgeCells(39, 40))), (r) => r.judges.opus.reading === "NO READ (judge)" && r.ends !== null),
  stage1Ends("judge: 40 credited gold cells pass", opusJudge(judgeInput(judgeCells(40, 40))), (r) => r.judges.opus.reading === "pass"),
  stage1Ends("judge: oracle cells over half the credited gold are capped, leaving it short", opusJudge(judgeInput(judgeCells(15, 40, 0, 30))), (r) => r.judges.opus.oracle_used === 15 && r.judges.opus.reading === "NO READ (judge)"),
  stage1Ends("judge: oracle cells at most half the credited gold all count", opusJudge(judgeInput(judgeCells(30, 40, 0, 20))), (r) => r.judges.opus.oracle_used === 20 && r.judges.opus.reading === "pass"),
  stage1Ends("judge: a Sol judge failing makes only Sol's contrasts untested", (i) => ({ ...i, judges: { ...i.judges, sol: judgeInput(judgeCells(100, 100, 41)) } }), (r) => r.ends === null && r.untested.sol.includes("judge") && !r.untested.opus.length),
  seam("judge: near-miss accuracy 0.80 passes", () => {
    const j = judgeCheck("opus", { cells: judgeCells(40, 40), unlabelled: 0, near_miss: nearMiss(80, 100) });
    return { ok: j.pass && j.near_miss === 0.8, detail: j.reading + ", near-miss " + j.near_miss };
  }),
  seam("judge: near-miss accuracy 0.79 fails", () => {
    const j = judgeCheck("opus", { cells: judgeCells(40, 40), unlabelled: 0, near_miss: nearMiss(79, 100) });
    return { ok: !j.pass && j.reading === "fail", detail: j.reading + ", near-miss " + j.near_miss };
  }),
  stage1Ends("stock: Opus row credited on 2 of 16 calibration units passes", stockOn("opus", 2), (r) => !r.stock.fail.opus && r.ends === null),
  stage1Ends("stock: Opus row credited on 3 of 16 calibration units ends the eval", stockOn("opus", 3), (r) => r.stock.fail.opus && (r.ends ?? "").includes("STOCK FAIL")),
  stage1Ends("stock: Sol row credited on 2 of 16 calibration units passes", stockOn("sol", 2), (r) => !r.untested.sol.includes("stock")),
  stage1Ends("stock: Sol row credited on 3 of 16 calibration units makes Sol untested (stock), nothing ends", stockOn("sol", 3), (r) => r.untested.sol.includes("stock") && r.ends === null),
  ...([[8, false], [9, true]] as const).flatMap(([n, fail]) =>
    (["opus", "sol"] as const).map((model) =>
      seam("stock: stage 2, " + model + " row credited on " + n + " of 64 comparison units " + (fail ? "fails" : "passes"), () => {
        const units = Array.from({ length: 64 }, (_, k) => "x" + k);
        const s = stockCheck(units.map((unit, k) => ({ stage: 2, model, judge: "astra", row: 3, unit, W: k < n ? 1 : 0, N: 0 })), 2, units);
        return { ok: s.fail[model] === fail && s.limit === 8, detail: "limit " + s.limit + ", fail " + s.fail[model] };
      }),
    ),
  ),
  ...([[94, false], [95, true]] as const).map(([n, pass]) =>
    seam("parse rate: " + n + "% of Opus none sessions " + (pass ? "passes" : "fails"), () => {
      const p = parseRate(Array.from({ length: 100 }, (_, k) => session({ stage: 1, unit: "x" + k, end: k < n ? "block" : "no-block" })));
      return { ok: p.pass === pass && p.rate === n / 100, detail: p.parsed + " of " + p.sessions };
    }),
  ),
];

const smokeRun = (model: ModelId, o: { parsed?: number; exposed?: number; limits?: number }) =>
  Array.from({ length: 6 }, (_, k) => session({ stage: 1, model, arm: "office-hours", unit: "c" + k, end: k < (o.parsed ?? 6) ? "block" : "no-block", exposed: k < (o.exposed ?? 6), limit_hit: k < (o.limits ?? 0) }));
const allSmoke = (opus: ScoredSession[]) => [...opus, ...smokeRun("sol", {}), ...smokeRun("particle", {})];

const smokeSeams: Seam[] = [
  seam("smoke: 5 of 6 parse passes", () => { const s = smoke(allSmoke(smokeRun("opus", { parsed: 5 })), []); return { ok: s.opus.status === "pass", detail: s.opus.status }; }),
  seam("smoke: 4 of 6 parse gets the forced sentence and a re-smoke", () => { const s = smoke(allSmoke(smokeRun("opus", { parsed: 4 })), []); return { ok: s.opus.status === "re-smoke due" && s.opus.repairs.includes("forced sentence") && s.sol.status === "pass", detail: JSON.stringify(s.opus.repairs) }; }),
  seam("smoke: 5 of 6 exposed passes", () => { const s = smoke(allSmoke(smokeRun("opus", { exposed: 5 })), []); return { ok: s.opus.status === "pass", detail: s.opus.status }; }),
  seam("smoke: 4 of 6 exposed gets the forced sentence", () => { const s = smoke(allSmoke(smokeRun("opus", { exposed: 4 })), []); return { ok: s.opus.repairs.includes("forced sentence"), detail: JSON.stringify(s.opus.repairs) }; }),
  seam("smoke: 1 Opus limit hit passes", () => { const s = smoke(allSmoke(smokeRun("opus", { limits: 1 })), []); return { ok: s.opus.status === "pass" && !s.sol.repairs.length, detail: s.opus.status }; }),
  seam("smoke: 2 Opus limit hits raise the limit to 30 for every arm, so every model re-smokes", () => { const s = smoke(allSmoke(smokeRun("opus", { limits: 2 })), []); return { ok: MODELS.every((m) => s[m].repairs.includes("30-reply limit") && s[m].status === "re-smoke due"), detail: JSON.stringify(s.opus.repairs) }; }),
  seam("smoke: the forced-sentence re-smoke passing reads pass after repair", () => { const s = smoke(allSmoke(smokeRun("opus", { parsed: 4 })), smokeRun("opus", { parsed: 5 })); return { ok: s.opus.status === "pass after repair", detail: s.opus.status }; }),
  seam("smoke: the forced-sentence re-smoke failing drops the arm", () => { const s = smoke(allSmoke(smokeRun("opus", { exposed: 4 })), smokeRun("opus", { exposed: 4 })); return { ok: s.opus.status === "drop", detail: s.opus.status }; }),
  seam("smoke: the limit re-smoke passing on every model reads pass after repair", () => { const s = smoke(allSmoke(smokeRun("opus", { limits: 2 })), allSmoke(smokeRun("opus", { limits: 1 }))); return { ok: MODELS.every((m) => s[m].status === "pass after repair"), detail: s.opus.status }; }),
  seam("smoke: the limit re-smoke with 2 Opus limit hits drops the arm", () => { const s = smoke(allSmoke(smokeRun("opus", { limits: 2 })), allSmoke(smokeRun("opus", { limits: 2 }))); return { ok: s.opus.status === "drop" && s.sol.status === "pass after repair", detail: s.opus.status }; }),
  stage1Ends("smoke: a drop on Opus ends the eval and stage 2 doesn't start", (i) => ({ ...i, smoke: allSmoke(smokeRun("opus", { parsed: 4 })), resmoke: smokeRun("opus", { parsed: 4 }) }), (r) => (r.ends ?? "").includes("exposure") && !r.ready),
  stage1Ends("smoke: a drop on Sol makes Sol's office-hours contrasts untested (smoke), nothing ends", (i) => ({ ...i, smoke: [...smokeRun("opus", {}), ...smokeRun("sol", { parsed: 4 }), ...smokeRun("particle", {})], resmoke: smokeRun("sol", { parsed: 4 }) }), (r) => r.smoke_drop.sol && r.ends === null && r.repairs.includes("forced sentence")),
];

/** Rows on a 50-unit manifest, so Opus has 100 sessions an arm. */
const rows100 = (edit: (s: ScoredSession, k: number) => ScoredSession) => {
  const man = manifest(Array.from({ length: 50 }, (_, k) => "x" + String(k).padStart(2, "0")), { kind: "arm", real: false, cuts: [] });
  const count = new Map<string, number>();
  return onManifest(man, man.map((e) => {
    const key = e.model + e.arm;
    const k = count.get(key) ?? 0;
    count.set(key, k + 1);
    return edit(session({ ...e, exposed: e.arm === "office-hours" ? true : null }), k);
  }));
};
const opusUntested = (u: Partial<Untested>, arms: ContrastName = "office-hours-none") =>
  untestedReasons("opus", arms === "office-hours-none" ? ["none", "office-hours"] : ["none", "lens"], { incomplete: false, headroom: true, smoke_drop: false, exposure: 1, interim_stop: false, cells: [], stock: false, judge: [], voided: false, ...u });

const coverageSeams: Seam[] = [
  ...([[79, true], [80, false]] as const).map(([n, untested]) =>
    seam("exposure " + n / 100 + (untested ? " reads untested" : " passes"), () => {
      const e = exposure(rows100((s, k) => (s.arm === "office-hours" ? { ...s, exposed: k < n } : s)), "opus");
      const r = opusUntested({ exposure: e.rate });
      return { ok: e.rate === n / 100 && r.some((x) => x.startsWith("exposure")) === untested && !opusUntested({ exposure: e.rate }, "lens-none").length, detail: r.join("; ") || "no condition" };
    }),
  ),
  ...([[0.69, true], [0.7, false]] as const).map(([rate, stop]) => check("interim stop at " + rate + (stop ? " stops the arm" : " doesn't stop"), interimStops(rate) === stop, "stops " + interimStops(rate))),
  ...([[16, true], [17, false]] as const).map(([n, stop]) =>
    seam("interim stop after 24 Opus office-hours sessions with " + n + " exposed " + (stop ? "stops" : "goes on"), () => {
      const r = interimStop(rows100((s, k) => (s.arm === "office-hours" ? { ...s, exposed: k < n || k >= 24 } : s)));
      return { ok: r.ready && r.sessions === 24 && r.stop === stop, detail: r.exposed + " of " + r.sessions };
    }),
  ),
  seam("interim stop reads nothing before 24 sessions", () => {
    const r = interimStop(rows100((s, k) => (s.arm === "office-hours" && s.model === "opus" ? { ...s, exposed: k < 23 ? false : null } : s)));
    return { ok: !r.ready && !r.stop, detail: r.sessions + " sessions" };
  }),
  ...([[10, false], [11, true]] as const).map(([n, untested]) =>
    seam("coverage: " + n + "% missing " + (untested ? "reads untested" : "passes"), () => {
      const c = cell(rows100((s, k) => (s.arm === "none" ? { ...s, W: k < n ? null : 0, end: k < n ? "missing" : "block" } : s)), "opus", "none");
      const r = opusUntested({ cells: [c] });
      return { ok: c.missing_rate === n / 100 && r.some((x) => x.startsWith("coverage")) === untested, detail: r.join("; ") || "no condition" };
    }),
  ),
  ...([[5, false], [6, true]] as const).map(([n, untested]) =>
    seam("gstack reads: " + n + "% of a no-gstack arm " + (untested ? "reads untested" : "passes"), () => {
      const c = cell(rows100((s, k) => (s.arm === "lens" ? { ...s, gstack_read: k < n, W: k < n ? null : 0 } : s)), "opus", "lens");
      const r = opusUntested({ cells: [c] }, "lens-none");
      return { ok: c.gstack_rate === n / 100 && r.some((x) => x.startsWith("gstack")) === untested, detail: r.join("; ") || "no condition" };
    }),
  ),
];

const W_OK = { delta: 0.2, ci95: [0.1, 0.3] as [number, number], p: 0.01 };
const v = (o: Partial<VerdictInput>) => verdict({ untested: [], w: W_OK, guard: { spec: 0.1, w: 0.2 }, spec_coverage: true, ...o });
const verdictSeams: Seam[] = [
  seam("verdict 1: an untested condition wins over a significant gain", () => { const r = v({ untested: ["stock"] }); return { ok: r.verdict === "untested" && r.why === "stock", detail: r.verdict }; }),
  seam("verdict 2: helps with p 0.01, an interval above zero and the guard", () => { const r = v({}); return { ok: r.verdict === "helps", detail: r.why }; }),
  seam("verdict 2: hurts mirrored", () => { const r = v({ w: { delta: -0.2, ci95: [-0.3, -0.1], p: 0.01 }, guard: { spec: -0.1, w: -0.2 } }); return { ok: r.verdict === "hurts", detail: r.why }; }),
  seam("verdict 2: a specificity estimate at exactly half the W difference holds", () => { const r = v({ guard: { spec: 0.1, w: 0.2 } }); return { ok: r.verdict === "helps", detail: r.why }; }),
  seam("verdict 3: a specificity estimate just under half reads not shown", () => { const r = v({ guard: { spec: 0.0999, w: 0.2 } }); return { ok: r.verdict === "not shown" && r.why.includes("specificity guard"), detail: r.why }; }),
  seam("verdict 3: an interval that excludes zero with p 0.051 reads not shown", () => { const r = v({ w: { ...W_OK, p: 0.051 } }); return { ok: r.verdict === "not shown" && r.why.includes("p 0.051"), detail: r.why }; }),
  seam("verdict 3: p at 0.05 still helps", () => { const r = v({ w: { ...W_OK, p: 0.05 } }); return { ok: r.verdict === "helps", detail: r.why }; }),
  seam("verdict 3: specificity coverage under 90% reads not shown, named", () => { const r = v({ spec_coverage: false }); return { ok: r.verdict === "not shown" && r.why.includes("specificity coverage"), detail: r.why }; }),
  seam("verdict 4: an interval that includes zero reads no measurable difference", () => { const r = v({ w: { delta: 0.1, ci95: [-0.02, 0.22], p: 0.2 } }); return { ok: r.verdict === "no measurable difference", detail: r.why }; }),
  seam("verdict 4: a null prints its MDD and the interval's upper bound", () => {
    const h = headlines(readStage2(stage2Fixture({ w: () => 0 })), {});
    const opus = h.find((x) => x.includes("on Opus"))!;
    return { ok: opus.startsWith("no measurable difference") && opus.includes("an MDD of 0.13") && opus.includes("leaves open of 0"), detail: opus.slice(0, 160) };
  }),
  seam("incomplete: a stop with scheduled sessions unrun after a prefix with p under 0.05 reads untested", () => {
    const r = readStage2(stage2Fixture({ w: helps, edit: (s) => (s.model === "opus" && s.pass === 2 ? null : s), stopped: true }));
    const c = r.models.opus.contrasts["office-hours-none"];
    return { ok: c.verdict === "untested" && c.why.includes("incomplete") && c.w !== null && c.w.p < 0.05 && r.models.sol.contrasts["office-hours-none"].verdict === "helps", detail: c.why + "; prefix p " + c.w?.p };
  }),
  seam("matched passes: a pass missing on one arm only leaves that pass out of the unit's contrast", () => {
    const i = stage2Fixture({ w: helps, edit: (s) => (s.model === "opus" && s.arm === "office-hours" && s.unit === "u01" && s.pass === 2 ? { ...s, W: null, end: "missing" } : s) });
    const opus = (arm: string) => i.sessions.filter((s) => s.model === "opus" && s.arm === arm);
    const m = matchUnits(opus("none"), opus("office-hours"), W);
    return { ok: m.one_side === 1 && m.units.find((u) => u.unit === "u01")!.passes === 1 && m.units.length === 10, detail: "one side " + m.one_side };
  }),
  ...([[2, "helps"], [3, "not shown"]] as const).map(([nulls, want]) =>
    seam("specificity coverage: shuffled-key labels missing on " + nulls + " of 20 office-hours passes reads " + want, () => {
      const drop = [["u01", 1], ["u01", 2], ["u02", 1]].slice(0, nulls);
      const r = readStage2(stage2Fixture({ w: helps, edit: (s) => (s.model === "opus" && s.arm === "office-hours" && drop.some(([u, p]) => s.unit === u && s.pass === p) ? { ...s, W_shuffled: null } : s) }));
      const c = r.models.opus.contrasts["office-hours-none"];
      const rate = r.models.opus.cells.find((x) => x.arm === "office-hours")!.specificity_rate;
      return { ok: c.verdict === want && rate === 1 - nulls / 20 && c.w?.units === 10 && c.specificity?.units === 9, detail: c.verdict + ", rate " + rate + ", W units " + c.w?.units + ", guard units " + c.specificity?.units };
    }),
  ),
  seam("guard: a pass both arms scored with incomplete shuffled-key labels counts for W and not for the guard", () => {
    const r = readStage2(stage2Fixture({ w: helps, edit: (s) => (s.model === "sol" && s.unit === "u03" && s.arm === "none" ? { ...s, W_shuffled: null } : s) }));
    const c = r.models.sol.contrasts["office-hours-none"];
    return { ok: c.w?.units === 10 && c.specificity?.units === 9 && c.w_complete?.units === 9, detail: "W units " + c.w?.units + ", guard units " + c.specificity?.units };
  }),
];

const realSeams: Seam[] = [
  seam("real stratum: kept out of every primary number, and the opposite sign reaches Opus's headline", () => {
    const real = ["r01", "r02", "r03"];
    const extra = manifest(real, { kind: "arm", real: true, cuts: [] }).map((e) => session({ ...e, stratum: "real", set: "real", W: e.arm === "none" ? 1 : 0 }));
    const pitch = manifest(COMPARISON, { kind: "pitch", real: false, cuts: [] }).map((e) => session({ ...e, W: e.arm === "none" ? 1 : 0 }));
    const base = readStage2(stage2Fixture({ w: helps }));
    const r = readStage2(stage2Fixture({ w: helps, extra: [...extra, ...pitch], real }));
    const same = MODELS.every((m) => JSON.stringify(r.models[m].contrasts) === JSON.stringify(base.models[m].contrasts) && JSON.stringify(r.models[m].cells) === JSON.stringify(base.models[m].cells));
    const h = headlines(r, {}).find((x) => x.includes("on Opus"))!;
    return { ok: same && r.models.opus.real.W?.delta === -1 && r.real_opposite && h.includes("opposite sign") && !base.real_opposite, detail: "primary unchanged " + same + ", real " + r.models.opus.real.W?.delta };
  }),
  ...([[0.7, false], [0.71, true]] as const).map(([rate, flag]) => check("arm guess at " + rate + (flag ? " is flagged" : " is not flagged"), armGuess(rate * 100, 100).flag === flag, "rate " + armGuess(rate * 100, 100).rate)),
];

const stub = (verdict: Verdict, ci95: [number, number] | null) => ({ verdict, why: "", w: ci95 ? { units: 10, mean_a: 0.3, mean_b: 0.5, delta: (ci95[0] + ci95[1]) / 2, ci95, p: 0.01, worse: 0 } : null });
const readingSeams: Seam[] = [
  ...([[0.049, "carries the gain"], [0.05, null]] as const).map(([hi, want]) =>
    seam("framing: office-hours minus lens upper bound " + hi + " reads " + (want ?? "no framing line"), () => {
      const r = readingRule({ "office-hours-none": stub("helps", [0.1, 0.3]), "lens-none": stub("no measurable difference", [-0.05, 0.2]), "office-hours-lens": stub("no measurable difference", [-0.1, hi]) }, null, null);
      return { ok: r.framing === want && r.keep, detail: String(r.framing) };
    }),
  ),
  ...([[0.049, null], [0.05, "carries part of the gain"]] as const).map(([hi, want]) =>
    seam("framing: lens minus none helps with office-hours minus lens upper bound " + hi + " reads " + (want ?? "the full framing line"), () => {
      const r = readingRule({ "office-hours-none": stub("helps", [0.1, 0.3]), "lens-none": stub("helps", [0.1, 0.3]), "office-hours-lens": stub("no measurable difference", [-0.1, hi]) }, null, null);
      return { ok: r.framing === (want ?? "carries the gain"), detail: String(r.framing) };
    }),
  ),
  seam("reading rule: no verdict reads CUT-CANDIDATE, and a null with an upper bound at 0.15 names power", () => {
    const r = readingRule({ "office-hours-none": stub("no measurable difference", [-0.05, 0.15]), "lens-none": stub("untested", null), "office-hours-lens": stub("untested", null) }, null, null);
    return { ok: !r.keep && r.power && (r.fix_method ?? "").includes("task fit") && !r.lines.join(" ").includes("CUT"), detail: r.lines.join(" | ") };
  }),
];

const pitchSeams: Seam[] = [0.2, 0.2002].map((wDelta) =>
  seam("AN-1: a pitch-only difference of 0.1 against a W difference of " + wDelta + (wDelta === 0.2 ? " (exactly half) meets" : " (just under half) misses") + " the headline condition", () => {
    const pitch = COMPARISON.flatMap((unit, k) => [session({ kind: "pitch", unit, arm: "none", W: 0 }), session({ kind: "pitch", unit, arm: "office-hours", W: k === 0 ? 1 : 0 })]);
    const p = readPitch(pitch, { verdict: "helps", w: { units: 10, mean_a: 0.3, mean_b: 0.5, delta: wDelta, ci95: [0.1, 0.3], p: 0.01, worse: 0 } }, new Map(COMPARISON.map((u) => [u, wDelta])), { scheduled: pitch.length, stopped: false });
    return { ok: p.condition === (wDelta === 0.2) && p.diff?.delta === 0.1 && p.part?.delta === r4(wDelta - 0.1), detail: "pitch " + p.diff?.delta + ", part " + p.part?.delta };
  }),
);
pitchSeams.push(seam("AN-1: when the condition holds the helps headline says the gain appears when the founder reveals nothing", () => {
  const pitch = manifest(COMPARISON, { kind: "pitch", real: false, cuts: [] }).map((e) => session({ ...e, W: e.arm === "office-hours" ? 1 : 0 }));
  const h = headlines(readStage2(stage2Fixture({ w: helps, extra: pitch })), {}).find((x) => x.includes("on Opus"))!;
  return { ok: h.startsWith("helps on Opus") && h.includes("reveals nothing") && !h.includes("asking a founder"), detail: h.slice(0, 160) };
}));
pitchSeams.push(
  ...([["one Opus pitch-only session missing", false], ["the pitch-only launch stopped", true]] as const).map(([what, stopped]) =>
    seam("AN-1 completion: with " + what + ", the helps headline says the pitch-only check didn't complete and credits neither reading", () => {
      const pitch = manifest(COMPARISON, { kind: "pitch", real: false, cuts: [] }).map((e) => session({ ...e, W: e.arm === "office-hours" ? 1 : 0 }));
      const gone = pitch.find((s) => s.model === "opus")!;
      const i = stage2Fixture({ w: helps, extra: pitch, pitch_stopped: stopped });
      const r = readStage2({ ...i, sessions: stopped ? i.sessions : i.sessions.filter((s) => !(s.kind === "pitch" && s.model === gone.model && s.unit === gone.unit && s.arm === gone.arm)) });
      const h = headlines(r, {}).find((x) => x.includes("on Opus"))!;
      return { ok: !r.models.opus.pitch.complete && h.startsWith("helps on Opus") && h.includes("the pitch-only check didn't complete") && !h.includes("reveals nothing") && !h.includes("asking a founder"), detail: h.slice(0, 200) };
    }),
  ),
);

const fakePower = (guard: number): Python => () => JSON.stringify(MODELS.map(() => ({ w: 0.13, guard })));
const projectionSeams: Seam[] = ([[0.15, true], [0.16, false]] as const).map(([g, ok]) =>
  seam("projection: the Opus guard-rule MDD at " + g + (ok ? " fits" : " goes to the set or the Captain"), () => {
    const r = projectionRerun(stage1Fixture().sessions, CALIBRATION, 64, fakePower(g));
    return { ok: r.opus_ok === ok, detail: r.next };
  }),
);

export const seams: Seam[] = [...bandSeams, ...stage1Seams, ...smokeSeams, ...coverageSeams, ...verdictSeams, ...realSeams, ...readingSeams, ...pitchSeams, ...projectionSeams];
