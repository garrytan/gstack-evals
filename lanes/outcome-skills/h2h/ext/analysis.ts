// Copyright (c) 2026 Garry Tan. MIT License.
// The extension's analysis (plan section 9) over one part's units, sessions, scores and tests-added records: part S's
// primary family (Holm over 10) and part P's (Holm over 12) with the base analysis's test, interval, MDD and row states;
// the sentence family, three co-primaries with Holm over the three within each contrast and the frozen readings; tests
// added per arm with the correction post's recount beside it; and the descriptive secondaries, particle-1's gap to the
// published Opus rows among them. The statistics are the base analysis's own (../analysis/stats.ts and power.ts), run on
// the extension's arm names and bootstrap_seed.
import { holmAdjusted } from "../../../../src/runner/stats/paired.ts";
import { regressionTest, testFileChanged } from "../../../../src/grade/regression-test.ts";
import type { Lang } from "../../statemachines/langs.ts";
import { rowState } from "../analysis/analyze.ts";
import { mdd } from "../analysis/power.ts";
import { logRatio, mean, pairedTest, percentile, wilson, type LogRatio, type Pair, type PairedTest } from "../analysis/stats.ts";
import { h2hFail, readPrereg, type H2hPrereg } from "../prereg.ts";
import { COMPARATORS, type H2hScore, type H2hSession, type H2hUnit, type RowState, type Stage, type UnitClass } from "../types.ts";
import { absZ, boundAt, holmCrossings, lookHalf, zFromP } from "./look.ts";
import { EXT_ARMS, extArmsFor, readExtPrereg, type ExtArm, type ExtPrereg, type Part } from "./prereg.ts";

const ALPHA = 0.05;
const EPS = 1e-9;
export type ExtSession = Omit<H2hSession, "arm"> & { arm: ExtArm };
export type ExtScore = Omit<H2hScore, "arm"> & { arm: ExtArm };
/** Section 7 for one session: the frozen rule (regressionTest) and the correction post's recount (testFileChanged). */
export interface ExtTests { schema: "h2hx-tests.v1"; unit: string; arm: ExtArm; stage: Stage; added: boolean; recount: boolean; lines: number }
export interface ExtInput { units: H2hUnit[]; sessions: ExtSession[]; scores: ExtScore[]; tests: ExtTests[]; stage: Stage; runAsPublished?: string[] }

/** One session's tests-added record from its extracted change (before the strict reading), the unit's language, its hidden
 *  test files and a base-tree reader. */
export function testsRecord(o: { unit: string; arm: ExtArm; stage: Stage; patch: string; lang: Lang; testFiles: readonly string[]; readBase: (path: string) => string | null }): ExtTests {
  const r = regressionTest(o.patch, o.lang, o.testFiles, o.readBase);
  return { schema: "h2hx-tests.v1", unit: o.unit, arm: o.arm, stage: o.stage, added: r.added, recount: testFileChanged(o.patch, o.lang), lines: r.lines };
}

const fail = (m: string): never => h2hFail("E_H2HX_ANALYSIS_INPUT", m);

export class ExtData {
  readonly units: H2hUnit[];
  private readonly scores = new Map<string, ExtScore>();
  private readonly sessions = new Map<string, ExtSession>();
  private readonly tested = new Map<string, ExtTests>();
  constructor(readonly part: Part, i: ExtInput, readonly x: ExtPrereg = readExtPrereg()) {
    this.units = i.units.filter((u) => u.stage === i.stage);
    const byId = new Map<string, H2hUnit>();
    for (const u of this.units) {
      if (byId.has(u.id)) fail("unit " + u.id + " is listed twice for " + i.stage);
      if (u.kind === "B1" || (part === "L" && u.kind !== "O")) fail("unit " + u.id + " is a " + u.kind + " unit, which part " + part + " does not run");
      byId.set(u.id, u);
    }
    const add = <T extends { unit: string; arm: string; stage: string; schema: string }>(rows: readonly T[], into: Map<string, T>, schema: string, what: string) => {
      for (const r of rows) {
        if (r.schema !== schema) fail("a " + what + " record is not " + schema);
        if (r.stage !== i.stage) continue;
        const u = byId.get(r.unit) ?? fail(what + " for unknown unit " + r.unit);
        if (!(EXT_ARMS as readonly string[]).includes(r.arm) || !this.arms(u).includes(r.arm as ExtArm)) fail(what + " for " + r.unit + " names arm " + r.arm + ", which does not run on that unit in part " + part);
        const k = r.unit + "\t" + r.arm;
        if (into.has(k)) fail("two " + what + " records for " + r.unit + " and " + r.arm);
        into.set(k, r);
      }
    };
    add(i.scores, this.scores, "h2h-score.v1", "score");
    add(i.sessions, this.sessions, "h2h-session.v1", "session");
    add(i.tests, this.tested, "h2hx-tests.v1", "tests-added");
    this.capStop = [...this.sessions.values()].some((s) => s.end === "cap_stop") || [...this.scores.values()].some((s) => s.gap === "CAP_STOP");
  }
  /** Section 14: a cap stop anywhere in the part's stage ends that part incomplete, so every cell reads incomplete. */
  readonly capStop: boolean;
  arms = (u: H2hUnit): ExtArm[] => extArmsFor(this.part, u.kind, this.x);
  score = (u: H2hUnit, arm: ExtArm) => this.scores.get(u.id + "\t" + arm) ?? null;
  session = (u: H2hUnit, arm: ExtArm) => this.sessions.get(u.id + "\t" + arm) ?? null;
  /** 1, 0, or null for a gap or a missing score; the worst case scores gaps as 0. */
  value(u: H2hUnit, arm: ExtArm, worst = false): 0 | 1 | null {
    const s = this.score(u, arm);
    if (!s || s.gap !== null) return worst ? 0 : null;
    return s.verified ? 1 : 0;
  }
  /** Whether a scored session added tests (1 or 0), null for a gap; a scored session with no tests-added record is refused. */
  added(u: H2hUnit, arm: ExtArm, rule: "frozen" | "recount" = "frozen"): 0 | 1 | null {
    if (this.value(u, arm) === null) return null;
    const t = this.tested.get(u.id + "\t" + arm) ?? fail("scored session " + u.id + " " + arm + " has no tests-added record");
    return (rule === "frozen" ? t.added : t.recount) ? 1 : 0;
  }
  of = (cls: UnitClass, arm: ExtArm) => this.units.filter((u) => u.class === cls && this.arms(u).includes(arm));
}

export interface Cell { units: number; gaps: number; gap_share: number | null; incomplete: boolean }
export function cellOf(d: ExtData, base: H2hPrereg, cls: UnitClass, arm: ExtArm): Cell {
  const us = d.of(cls, arm);
  const gaps = us.filter((u) => d.value(u, arm) === null).length;
  const share = us.length ? gaps / us.length : null;
  return { units: us.length, gaps, gap_share: share, incomplete: d.capStop || share === null || share > base.analysis.incomplete_gap_share };
}

/** Arms whose bug-unit exposure is the installed pack (section 8): every gstack install that has no bug entry of its own. */
const BUG_INSTALLED: ReadonlySet<ExtArm> = new Set<ExtArm>(["s-gstack", "s-gstack-line", "p-gstack", "p-gstack-oneline", "l-gstack", "l-gstack-md", "l-gstack-task"]);
export interface ExposureRate { sessions: number; loaded: number | null; procedure: number | null; missing: number; foreign_reads: number }
/** Section 8's rates over the arm's scored sessions in the class, as the base analysis reads them. */
export function exposureOf(d: ExtData, cls: UnitClass, arm: ExtArm): ExposureRate {
  const us = d.of(cls, arm).filter((u) => d.value(u, arm) !== null);
  let loaded = 0, ran = 0, missing = 0, foreign = 0;
  for (const u of us) {
    const e = d.session(u, arm)?.exposure ?? null;
    if (e) foreign += e.foreign_reads.length > 0 ? 1 : 0;
    if (BUG_INSTALLED.has(arm) && u.entry === "bug") {
      loaded++;
      ran++;
      continue;
    }
    if (!e) missing++;
    loaded += e?.loaded ? 1 : 0;
    ran += e?.procedure ? 1 : 0;
  }
  return { sessions: us.length, loaded: us.length ? loaded / us.length : null, procedure: us.length ? ran / us.length : null, missing, foreign_reads: foreign };
}

type Val = (u: H2hUnit, arm: ExtArm) => 0 | 1 | null;
const pairsOf = (us: readonly H2hUnit[], a: ExtArm, b: ExtArm, v: Val): Pair[] =>
  us.flatMap((u) => {
    const x = v(u, a), y = v(u, b);
    return x === null || y === null ? [] : [{ unit: u.id, repo: u.repo, a: x, b: y }];
  });

export const GSTACK_ARM: Record<"S" | "P", ExtArm> = { S: "s-gstack", P: "p-gstack" };
/** The arms gstack is compared with in a part's primary family: part P's are the base family's comparators through
 *  base_arm; part S's are its arms other than gstack's two (pstack has no Codex install). */
export function comparatorsOf(part: "S" | "P", x: ExtPrereg = readExtPrereg()): ExtArm[] {
  const out = part === "P"
    ? x.parts.P.arms.filter((a) => (COMPARATORS as readonly string[]).includes(x.parts.P.base_arm[a as keyof typeof x.parts.P.base_arm]))
    : x.parts.S.arms.filter((a) => a !== "s-gstack" && a !== "s-gstack-line");
  if (2 * out.length !== x.parts[part].holm_m) h2hFail("E_H2HX_PREREG", "part " + part + " has " + out.length + " comparators in 2 classes, not holm_m " + x.parts[part].holm_m);
  return out;
}

export interface FamilyRow {
  class: UnitClass; other: ExtArm; test: PairedTest; incomplete: boolean; p_holm_input: number; p_holm: number; holm_rank: number; holm_alpha: number; bound: number | null;
  mdd: number | null; state: RowState; exposure_other: ExposureRate | null; exposure_gstack: ExposureRate; cells: { gstack: Cell; other: Cell }; worst_case: PairedTest;
}

/** Section 9's primary family for part S or P: gstack minus each comparator in O and in B, the clustered McNemar test,
 *  Holm over holm_m (an incomplete cell stays in with p = 1), the MDD at the contrast's discordant share and Holm-step
 *  alpha, and the base plan's row states. With look set (part S's counted stage, section 11), a contrast is significant
 *  only when it crosses its Holm step's O'Brien-Fleming bound (0 at the look, 1 at the end) and every contrast ranked
 *  before it crossed, in place of p Holm under 0.05. */
export function primaryFamily(d: ExtData, part: "S" | "P", base: H2hPrereg, o: { runAsPublished?: readonly string[]; withMdd?: boolean; look?: 0 | 1 | null } = {}): FamilyRow[] {
  const x = d.x, seed = x.bootstrap_seed, g = GSTACK_ARM[part], m = x.parts[part].holm_m;
  const published = new Set(o.runAsPublished ?? []);
  const v: Val = (u, a) => d.value(u, a);
  const rows: FamilyRow[] = [];
  for (const cls of ["O", "B"] as const)
    for (const other of comparatorsOf(part, x)) {
      const us = d.of(cls, g);
      const test = pairedTest(pairsOf(us, other, g, v), seed);
      const cells = { gstack: cellOf(d, base, cls, g), other: cellOf(d, base, cls, other) };
      const incomplete = cells.gstack.incomplete || cells.other.incomplete || test.n === 0;
      rows.push({
        class: cls, other, test, incomplete, p_holm_input: incomplete ? 1 : test.p, p_holm: 1, holm_rank: 0, holm_alpha: ALPHA, bound: null, mdd: null, state: "no_difference",
        exposure_other: other.endsWith("-none") ? null : exposureOf(d, cls, other), exposure_gstack: exposureOf(d, cls, g), cells,
        worst_case: pairedTest(pairsOf(us, other, g, (u, a) => d.value(u, a, true)), seed),
      });
    }
  const adj = holmAdjusted(rows.map((r) => r.p_holm_input));
  const look = o.look ?? null;
  const crossed = look === null ? null : holmCrossings(rows.map((r) => ({ p: r.p_holm_input, z: r.incomplete ? 0 : absZ(r.test) })), m, x, look);
  rows.map((r, k) => ({ p: r.p_holm_input, k })).sort((a, b) => a.p - b.p).forEach(({ k }, rank) => {
    const r = rows[k]!;
    r.p_holm = adj[k]!;
    r.holm_rank = rank + 1;
    r.holm_alpha = ALPHA / (m - rank);
    r.bound = look === null ? null : boundAt(x, m - rank, look);
    r.mdd = o.withMdd !== false && r.test.n && r.test.discordant_share !== null ? mdd(r.test.n, r.test.discordant_share, r.holm_alpha) : null;
    const notExercised = r.exposure_other !== null && (r.exposure_other.procedure ?? 0) < base.analysis.exposure_floor;
    r.state = rowState({ incomplete: r.incomplete, runAsPublished: published.has(r.other) || published.has(g), notExercised, pHolm: crossed ? (crossed[k] ? 0 : 1) : r.p_holm, ci95: r.test.ci95 });
  });
  return rows;
}

export type SentenceReading = "holds" | "holds only by dropping tests" | "cuts code but loses fixes" | "does not cut code" | "incomplete";
export interface SentenceRow {
  label: string; sentence: ExtArm; gstack: ExtArm; decides: boolean; incomplete: boolean;
  lines: LogRatio; fixes: PairedTest; tests: PairedTest; p_holm: [number, number, number];
  less_code: boolean; fixes_kept: boolean; tests_kept: boolean; reading: SentenceReading;
}

/** A no-harm criterion (section 9, criteria 2 and 3): the point difference is no worse than min_point_diff and the 95%
 *  interval is not wholly below 0. */
export const noHarm = (t: PairedTest, minPointDiff: number): boolean => t.delta !== null && t.delta >= minPointDiff - EPS && !(t.ci95 && t.ci95[1] < 0);

/** The sentence pairs a part reads (prereg.json sentence_family), sentence arm first; O units only. */
export const SENTENCE_PAIRS: Record<Part, [ExtArm, ExtArm][]> = {
  L: [["l-gstack-md", "l-gstack"], ["l-gstack-task", "l-gstack"]],
  S: [["s-gstack-line", "s-gstack"]],
  P: [["p-gstack-oneline", "p-gstack"]],
};

/** One sentence contrast's three co-primaries on O units, sentence arm minus gstack: (1) the paired log ratio of non-test
 *  lines on units both arms fixed (piece G's statistic), (2) the verified-correct difference, (3) the tests-added
 *  difference, each with the clustered test and bootstrap on bootstrap_seed, Holm over the three, and the reading. With
 *  look set (part S's counted stage), the less-code ratio counts only when it crosses its step's O'Brien-Fleming bound
 *  within the three, as primaryFamily reads its contrasts. */
export function sentenceContrast(d: ExtData, sentence: ExtArm, gstack: ExtArm, base: H2hPrereg, decides = true, look: 0 | 1 | null = null): SentenceRow {
  const x = d.x, seed = x.bootstrap_seed, us = d.of("O", sentence).filter((u) => d.arms(u).includes(gstack));
  const lines = logRatio(us.filter((u) => d.value(u, sentence) === 1 && d.value(u, gstack) === 1).map((u) => ({ repo: u.repo, x: d.score(u, gstack)!.lines_changed, y: d.score(u, sentence)!.lines_changed })), seed);
  const fixes = pairedTest(pairsOf(us, gstack, sentence, (u, a) => d.value(u, a)), seed);
  const tests = pairedTest(pairsOf(us, gstack, sentence, (u, a) => d.added(u, a)), seed);
  const incomplete = cellOf(d, base, "O", sentence).incomplete || cellOf(d, base, "O", gstack).incomplete || fixes.n === 0;
  const p_holm = holmAdjusted([lines.p, fixes.p, tests.p]) as [number, number, number];
  const min = x.sentence_family.min_point_diff;
  const below = lines.ratio !== null && lines.ratio < 1;
  const less_code = below && (look === null ? p_holm[0] < ALPHA : holmCrossings([{ p: lines.p, z: zFromP(lines.p) }, { p: fixes.p, z: absZ(fixes) }, { p: tests.p, z: absZ(tests) }], x.sentence_family.holm_within, x, look)[0]!);
  const fixes_kept = noHarm(fixes, min), tests_kept = noHarm(tests, min);
  const reading: SentenceReading = incomplete ? "incomplete" : !less_code ? "does not cut code" : !fixes_kept ? "cuts code but loses fixes" : !tests_kept ? "holds only by dropping tests" : "holds";
  return { label: sentence + " minus " + gstack, sentence, gstack, decides, incomplete, lines, fixes, tests, p_holm, less_code, fixes_kept, tests_kept, reading };
}

export interface TestsRow { class: UnitClass; arm: ExtArm; sessions: number; frozen: number; recount: number }
export interface Contrast { label: string; test: PairedTest; lines?: LogRatio }
export interface ArmRow {
  class: UnitClass; arm: ExtArm; cell: Cell; verified: { k: number; n: number; rate: number | null; ci95: [number, number] | null }; exposure: ExposureRate;
  lines_mean: number | null; dollars: { total: number; per_verified_fix: number | null; mean: number | null; p95: number | null }; wall_ms_mean: number | null;
  tokens: { input: number; output: number; cache_read: number; cache_write: number }; continuations: number; questions: number; allowance_stops: number;
}

function armRow(d: ExtData, base: H2hPrereg, cls: UnitClass, arm: ExtArm): ArmRow {
  const us = d.of(cls, arm);
  const scored = us.filter((u) => d.value(u, arm) !== null);
  const k = scored.filter((u) => d.value(u, arm) === 1).length;
  const sess = us.map((u) => d.session(u, arm)).filter((s): s is ExtSession => s !== null);
  const cost = sess.map((s) => s.cost_usd), total = cost.reduce((a, c) => a + c, 0);
  const sum = (f: (s: ExtSession) => number) => sess.reduce((a, s) => a + f(s), 0);
  return {
    class: cls, arm, cell: cellOf(d, base, cls, arm), verified: { k, n: scored.length, rate: scored.length ? k / scored.length : null, ci95: wilson(k, scored.length) }, exposure: exposureOf(d, cls, arm),
    lines_mean: mean(scored.map((u) => d.score(u, arm)!.lines_changed)), dollars: { total, per_verified_fix: k ? total / k : null, mean: mean(cost), p95: percentile(cost, 95) },
    wall_ms_mean: mean(sess.map((s) => s.wall_ms)), tokens: { input: sum((s) => s.tokens.input), output: sum((s) => s.tokens.output), cache_read: sum((s) => s.tokens.cache_read), cache_write: sum((s) => s.tokens.cache_write) },
    continuations: sum((s) => s.continuations), questions: sum((s) => s.questions), allowance_stops: sess.filter((s) => s.end === "limit_allowance").length,
  };
}

/** The published Opus rows of the head-to-head (its session data's score-records.jsonl), by base arm. */
export interface OpusRows { scores: H2hScore[] }

export interface ExtAnalysis {
  schema: "h2hx-analysis.v1"; part: Part; stage: Stage; bootstrap_seed: number; units: { O: number; B: number }; stopped_at_half: boolean; cap_stop: boolean;
  family: FamilyRow[]; sentence: SentenceRow[]; tests: TestsRow[]; arms: ArmRow[]; secondaries: Contrast[]; opus_gap: Contrast[]; rows: string[];
}

/** The whole section 9 analysis of one part and stage. opus gives particle-1's gap to the published Opus rows (part P),
 *  paired on unit ids, each particle-1 arm against its base arm. Part S's counted stage reads its significance against
 *  the O'Brien-Fleming bounds (section 11): the end bounds over every unit, or, with stoppedAtHalf, the look's bounds over
 *  the first half only, the analysis after an efficacy stop at the look. */
export function analyzeExt(part: Part, i: ExtInput, o: { x?: ExtPrereg; base?: H2hPrereg; opus?: OpusRows; withMdd?: boolean; stoppedAtHalf?: boolean } = {}): ExtAnalysis {
  const x = o.x ?? readExtPrereg(), base = o.base ?? readPrereg();
  const counted = part === "S" && i.stage === "stage2";
  if (o.stoppedAtHalf && !counted) h2hFail("E_H2HX_ANALYSIS_INPUT", "only part S's counted stage has an interim look to stop at");
  const half = o.stoppedAtHalf ? lookHalf(i.units.filter((u) => u.stage === "stage2"), x) : null;
  const d = new ExtData(part, half ? { ...i, units: i.units.filter((u) => half.has(u.id)), sessions: i.sessions.filter((r) => half.has(r.unit)), scores: i.scores.filter((r) => half.has(r.unit)), tests: i.tests.filter((r) => half.has(r.unit)) } : i, x);
  const look = counted ? (half ? 0 : 1) : null;
  const seed = x.bootstrap_seed;
  const family = part === "L" ? [] : primaryFamily(d, part, base, { runAsPublished: i.runAsPublished, withMdd: o.withMdd, look });
  const sentence = SENTENCE_PAIRS[part].map(([s, g]) => sentenceContrast(d, s, g, base, true, look));
  if (part === "L") sentence.push(sentenceContrast(d, "l-gstack-md", "l-gstack-task", base, false));
  const classes: UnitClass[] = part === "L" ? ["O"] : ["O", "B"];
  const tests: TestsRow[] = [], arms: ArmRow[] = [];
  for (const cls of classes)
    for (const arm of x.parts[part].arms) {
      const us = d.of(cls, arm);
      if (!us.length) continue;
      const scored = us.filter((u) => d.value(u, arm) !== null);
      tests.push({ class: cls, arm, sessions: scored.length, frozen: scored.filter((u) => d.added(u, arm) === 1).length, recount: scored.filter((u) => d.added(u, arm, "recount") === 1).length });
      arms.push(armRow(d, base, cls, arm));
    }
  const contrast = (label: string, cls: UnitClass, a: ExtArm, b: ExtArm, withLines = false): Contrast => {
    const us = d.of(cls, b).filter((u) => d.arms(u).includes(a));
    const c: Contrast = { label, test: pairedTest(pairsOf(us, a, b, (u, arm) => d.value(u, arm)), seed) };
    if (withLines) c.lines = logRatio(us.filter((u) => d.value(u, a) === 1 && d.value(u, b) === 1).map((u) => ({ repo: u.repo, x: d.score(u, a)!.lines_changed, y: d.score(u, b)!.lines_changed })), seed);
    return c;
  };
  const secondaries: Contrast[] = [];
  const none = (part.toLowerCase() + "-none") as ExtArm;
  for (const cls of classes)
    for (const arm of x.parts[part].arms) if (arm !== none && d.of(cls, arm).length) secondaries.push(contrast(cls + ": " + arm + " minus " + none, cls, none, arm));
  if (part === "P") secondaries.push(contrast("O: p-gstack-pony minus p-gstack", "O", "p-gstack", "p-gstack-pony", true));
  const opus_gap: Contrast[] = [];
  if (part === "P" && o.opus) {
    const ov = new Map<string, 0 | 1 | null>(o.opus.scores.map((s) => [s.unit + "\t" + s.arm, s.gap !== null ? null : s.verified ? 1 : 0]));
    for (const cls of classes)
      for (const arm of x.parts.P.arms) {
        const b = x.parts.P.base_arm[arm as keyof typeof x.parts.P.base_arm];
        if (!d.of(cls, arm).length) continue;
        const pairs = d.of(cls, arm).flatMap((u): Pair[] => {
          const a = ov.get(u.id + "\t" + b), y = d.value(u, arm);
          return a === undefined || a === null || y === null ? [] : [{ unit: u.id, repo: u.repo, a, b: y }];
        });
        opus_gap.push({ label: cls + ": " + arm + " minus Opus " + b, test: pairedTest(pairs, seed) });
      }
  }
  const a: ExtAnalysis = {
    schema: "h2hx-analysis.v1", part, stage: i.stage, bootstrap_seed: seed, units: { O: d.units.filter((u) => u.class === "O").length, B: d.units.filter((u) => u.class === "B").length }, stopped_at_half: !!half, cap_stop: d.capStop,
    family, sentence, tests, arms, secondaries, opus_gap, rows: [],
  };
  a.rows = partRows(a, x);
  return a;
}

/** The section 10 rows one part's analysis triggers on its own. Rows that need two parts come from crossRows. */
function partRows(a: ExtAnalysis, x: ExtPrereg): string[] {
  if (a.cap_stop) return ["Part " + a.part + " incomplete: a session stopped at the cap, and the part is not retried"];
  const out: string[] = [];
  if (a.part === "L") {
    const md = a.sentence.find((s) => s.sentence === "l-gstack-md" && s.gstack === "l-gstack");
    if (a.units.O < x.parts.L.units.min_counted) out.push("Part L underpowered (under " + x.parts.L.units.min_counted + " counted units)");
    else if (md && md.reading !== "incomplete" && md.reading !== "cuts code but loses fixes") out.push("l-gstack-md " + md.reading);
    return out;
  }
  const who = a.part === "S" ? "Sol" : "particle-1";
  const g = GSTACK_ARM[a.part], none = a.part === "S" ? "s-none" : "p-none";
  const vsNone = a.family.filter((r) => r.other === none);
  const ahead = vsNone.filter((r) => r.state === "ahead").map((r) => r.class);
  if (ahead.length) out.push(who + ", " + ahead.join(" and ") + ": " + g + " ahead of " + none);
  if (vsNone.length && vsNone.every((r) => r.state === "no_difference" || r.state === "behind")) out.push(who + ", O and B: " + g + " not ahead of " + none);
  for (const r of a.family.filter((r) => r.other !== none && r.state === "behind")) out.push("A pack ahead of gstack on " + who + " (after Holm, exercised as designed): " + r.other + " on " + r.class);
  for (const r of a.family.filter((r) => r.state === "not_exercised")) out.push("A pack not exercised as designed: " + r.other + " on " + r.class);
  const pony = a.secondaries.find((c) => c.label === "O: p-gstack-pony minus p-gstack");
  if (pony?.test.ci95 && pony.test.ci95[0] > 0) out.push("p-gstack-pony ahead of p-gstack on O (interval wholly above 0)");
  return out;
}

/** The section 10 rows that read two parts: s-gstack-line holding while l-gstack-md does not, both holding (the Codex
 *  AGENTS.md too), and particle-1's sentence losing fixes while l-gstack-md holds. Each reads Part L's counted stage, so
 *  none fires on a Part L that is descriptive only or incomplete: a stage other than stage2, a cap stop, or under
 *  min_counted counted units. */
export function crossRows(parts: Partial<Record<Part, ExtAnalysis>>, x: ExtPrereg = readExtPrereg()): string[] {
  const l = parts.L;
  if (!l || l.stage !== "stage2" || l.cap_stop || l.units.O < x.parts.L.units.min_counted) return [];
  const md = l.sentence.find((s) => s.sentence === "l-gstack-md" && s.gstack === "l-gstack");
  const line = parts.S?.sentence.find((s) => s.sentence === "s-gstack-line");
  const one = parts.P?.sentence.find((s) => s.sentence === "p-gstack-oneline");
  const out: string[] = [];
  if (md && line?.reading === "holds" && md.reading !== "holds") out.push("s-gstack-line holds, l-gstack-md does not");
  if (md?.reading === "holds" && line?.reading === "holds") out.push("l-gstack-md holds and s-gstack-line holds: the same sentence goes into gstack's Codex AGENTS.md");
  if (md?.reading === "holds" && one && !one.incomplete && !one.fixes_kept) out.push("particle-1's gstack-oneline loses fixes (criterion 2 fails) while l-gstack-md holds");
  return out;
}

const pct = (v: number | null) => (v === null ? "none" : (100 * v).toFixed(1));
const ci = (c: [number, number] | null) => (c ? "[" + pct(c[0]) + ", " + pct(c[1]) + "]" : "no interval");
const rci = (c: [number, number] | null) => (c ? "[" + c.map((v) => v.toFixed(3)).join(", ") + "]" : "no interval");

/** The analysis as plain lines: the primary family, the sentence family, tests added with the recount beside the frozen
 *  rule, the secondaries and the section 10 rows. */
export function reportExt(a: ExtAnalysis): string[] {
  const out = ["h2hx analysis, part " + a.part + ", " + a.stage + ": O " + a.units.O + " units, B " + a.units.B + (a.stopped_at_half ? ", stopped at half: the first half only, against the look's bounds" : "")];
  if (a.family.length) {
    out.push("class | gstack minus | n | difference (points) | 95% interval | p clustered | p Holm | Holm step | |z| bound | MDD | procedure rate | state");
    for (const r of a.family) out.push([r.class, r.other, r.test.n, pct(r.test.delta), ci(r.test.ci95), r.test.p.toFixed(4), r.p_holm.toFixed(4), "0.05/" + Math.round(ALPHA / r.holm_alpha), r.bound === null ? "none" : r.bound.toFixed(3), r.mdd === null ? "none fits" : Math.round(100 * r.mdd), r.exposure_other ? pct(r.exposure_other.procedure) : "n/a", r.state].join(" | "));
  }
  for (const s of a.sentence) {
    out.push("sentence " + s.label + (s.decides ? "" : " (secondary, decides nothing)") + ": lines ratio " + (s.lines.ratio?.toFixed(3) ?? "none") + " on " + s.lines.n + " units both fixed " + rci(s.lines.ci95) + " Holm p " + s.p_holm[0].toFixed(4)
      + "; fixes " + pct(s.fixes.delta) + " " + ci(s.fixes.ci95) + " Holm p " + s.p_holm[1].toFixed(4) + "; tests added " + pct(s.tests.delta) + " " + ci(s.tests.ci95) + " Holm p " + s.p_holm[2].toFixed(4) + (s.decides ? "; reading: " + s.reading : ""));
  }
  out.push("tests added | class | arm | sessions | frozen rule | recount rule");
  for (const t of a.tests) out.push(["tests added", t.class, t.arm, t.sessions, t.frozen, t.recount].join(" | "));
  for (const c of [...a.secondaries, ...a.opus_gap]) out.push("secondary " + c.label + ": " + pct(c.test.delta) + " " + ci(c.test.ci95) + " on " + c.test.n + " units" + (c.lines ? "; lines ratio " + (c.lines.ratio?.toFixed(3) ?? "none") + " " + rci(c.lines.ci95) : ""));
  for (const r of a.rows) out.push("section 10: " + r);
  return out;
}
