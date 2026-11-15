// Copyright (c) 2026 Garry Tan. MIT License.
// Plan sections 8 to 10 over one stage's units, sessions and scores: the 12-contrast primary family with its row states,
// Holm over the 12, the MDD at each contrast's measured discordant share and Holm-step alpha, half-MDD ideas to study,
// exposure, the secondaries and strata (descriptive, no Holm), piece G and the section 10 rows each result triggers.
import { holmAdjusted } from "../../../../src/runner/stats/paired.ts";
import { h2hFail, type H2hPrereg } from "../prereg.ts";
import { ALL_ARMS, COMPARATORS, PIECE_G_ARMS, PRIMARY_ARMS, SECONDARY_ARMS, type H2hArm, type H2hScore, type H2hSession, type H2hUnit, type RowState, type Stage, type UnitClass } from "../types.ts";
import { mdd } from "./power.ts";
import { logRatio, mean, pairedTest, percentile, wilson, type LogRatio, type Pair, type PairedTest } from "./stats.ts";

export const FAMILY_SIZE = 12;
const ALPHA = 0.05;
/** Arms whose bug-unit exposure is the installed pack (section 8): gstack, and gstack plus its one line. */
const BUG_INSTALLED: ReadonlySet<H2hArm> = new Set<H2hArm>(["gstack", "gstack-oneline"]);
const PACKS = COMPARATORS.filter((a) => a !== "none");

export interface AnalysisInput { units: H2hUnit[]; sessions: H2hSession[]; scores: H2hScore[]; stage: Stage; runAsPublished?: string[] }
export type Reading = "verified" | "without_new_test_rule" | "adapted" | "worst_case";

/** The arms that run on a unit: every primary arm, piece G's two on O, the /qa arm on B1. */
export const armsFor = (u: H2hUnit): H2hArm[] => [...PRIMARY_ARMS, ...(u.class === "O" ? PIECE_G_ARMS : []), ...(u.kind === "B1" ? SECONDARY_ARMS : [])];

export class Data {
  readonly units: H2hUnit[];
  private readonly scores = new Map<string, H2hScore>();
  private readonly sessions = new Map<string, H2hSession>();
  constructor(i: AnalysisInput) {
    this.units = i.units.filter((u) => u.stage === i.stage);
    const byId = new Map<string, H2hUnit>();
    for (const u of this.units) {
      if (byId.has(u.id)) h2hFail("E_H2H_ANALYSIS_INPUT", "unit " + u.id + " is listed twice for " + i.stage);
      byId.set(u.id, u);
    }
    const add = <T extends { unit: string; arm: string; stage: string }>(rows: readonly T[], into: Map<string, T>, what: string) => {
      for (const r of rows) {
        if (r.stage !== i.stage) continue;
        const u = byId.get(r.unit) ?? h2hFail("E_H2H_ANALYSIS_INPUT", what + " for unknown unit " + r.unit);
        if (!(ALL_ARMS as readonly string[]).includes(r.arm) || !armsFor(u).includes(r.arm as H2hArm)) h2hFail("E_H2H_ANALYSIS_INPUT", what + " for " + r.unit + " names arm " + r.arm + ", which does not run on that unit");
        const k = r.unit + "\t" + r.arm;
        if (into.has(k)) h2hFail("E_H2H_ANALYSIS_INPUT", "two " + what + "s for " + r.unit + " and " + r.arm);
        into.set(k, r);
      }
    };
    for (const s of i.scores) if (s.schema !== "h2h-score.v1") h2hFail("E_H2H_ANALYSIS_INPUT", "a score record is not h2h-score.v1");
    for (const s of i.sessions) if (s.schema !== "h2h-session.v1") h2hFail("E_H2H_ANALYSIS_INPUT", "a session record is not h2h-session.v1");
    add(i.scores, this.scores, "score");
    add(i.sessions, this.sessions, "session");
  }
  score = (u: H2hUnit, arm: H2hArm) => this.scores.get(u.id + "\t" + arm) ?? null;
  session = (u: H2hUnit, arm: H2hArm) => this.sessions.get(u.id + "\t" + arm) ?? null;
  /** 1, 0, or null for a gap or a missing score (a missing score counts as a gap). The worst case scores gaps as 0. */
  value(u: H2hUnit, arm: H2hArm, r: Reading = "verified"): 0 | 1 | null {
    const s = this.score(u, arm);
    if (!s || s.gap !== null) return r === "worst_case" ? 0 : null;
    const v = r === "without_new_test_rule" ? s.verified_without_new_test_rule : r === "adapted" ? s.adapted_verified : s.verified;
    return v === null ? null : v ? 1 : 0;
  }
  of = (cls: UnitClass, arm: H2hArm, keep: (u: H2hUnit) => boolean = () => true) => this.units.filter((u) => u.class === cls && armsFor(u).includes(arm) && keep(u));
}

export interface Cell { units: number; gaps: number; gap_share: number | null; incomplete: boolean }
export function cellOf(d: Data, p: H2hPrereg, cls: UnitClass, arm: H2hArm, keep?: (u: H2hUnit) => boolean): Cell {
  const us = d.of(cls, arm, keep);
  const gaps = us.filter((u) => d.value(u, arm) === null).length;
  const share = us.length ? gaps / us.length : null;
  return { units: us.length, gaps, gap_share: share, incomplete: share === null || share > p.analysis.incomplete_gap_share };
}

export interface ExposureRate { sessions: number; loaded: number | null; procedure: number | null; missing: number; foreign_reads: number }
/** Section 8's rates over the arm's scored (not gap) sessions in the class; a session with no exposure record counts as
 *  not loaded and not run. gstack and its one-line arm count as loaded and run on bug units. */
export function exposureOf(d: Data, cls: UnitClass, arm: H2hArm, keep?: (u: H2hUnit) => boolean): ExposureRate {
  const us = d.of(cls, arm, keep).filter((u) => d.value(u, arm) !== null);
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

const pairsOf = (d: Data, us: readonly H2hUnit[], a: H2hArm, b: H2hArm, r: Reading = "verified"): Pair[] =>
  us.flatMap((u) => {
    const x = d.value(u, a, r), y = d.value(u, b, r);
    return x === null || y === null ? [] : [{ unit: u.id, repo: u.repo, a: x, b: y }];
  });

export interface FamilyRow {
  class: UnitClass; other: (typeof COMPARATORS)[number]; test: PairedTest; incomplete: boolean; p_holm_input: number; p_holm: number;
  holm_rank: number; holm_alpha: number; mdd: number | null; half_mdd: number | null; state: RowState; idea_to_study: boolean;
  exposure_other: ExposureRate | null; exposure_gstack: ExposureRate; cells: { gstack: Cell; other: Cell }; worst_case: PairedTest;
}

export interface Contrast { label: string; test: PairedTest; state?: RowState }
export interface ArmRow {
  class: UnitClass; arm: H2hArm; cell: Cell; verified: { k: number; n: number; rate: number | null; ci95: [number, number] | null };
  worst_case_rate: number | null; without_new_test_rule: number | null; adapted: number | null; exposure: ExposureRate;
  lines: { mean: number | null; median: number | null; verified_mean: number | null }; planning_lines: { mean: number | null; sessions_with: number };
  dollars: { total: number; per_verified_fix: number | null; mean: number | null; median: number | null; p95: number | null };
  wall_ms: { mean: number | null; median: number | null }; tokens: { input: number; output: number; cache_read: number; cache_write: number };
  continuations: number; spurious_continuations: number; reservation_refusals: number; allowance_stops: number; safety_stops: number; questions: number;
  worktree: { candidates: number; passes: number; passes_main_not: number }; dropped_arm_tests: { sessions: number; files: number };
}

export interface PieceG {
  verified: PairedTest; incomplete: boolean; lines: LogRatio; oneline: LogRatio; p_holm: [number, number]; less_code: boolean; more_correct: boolean;
  adopt: "oneline" | "ponystack" | null; exposure_pony: ExposureRate; exercised: boolean;
}

export interface Analysis {
  schema: "h2h-analysis.v1"; stage: Stage; bootstrap_seed: number; units: Record<UnitClass, number> & { B1: number; B2: number };
  family: FamilyRow[]; fix_method_exposure: Record<UnitClass, boolean>; why_null: { class: UnitClass; other: string; state: RowState; reads: string }[];
  arms: ArmRow[]; none_vs_pack: Contrast[]; pack_pairs: Contrast[]; qa: Contrast[]; strata: { name: string; class: UnitClass; units: number; rates: Record<string, number | null>; gstack_minus: Contrast[] }[];
  piece_g: PieceG; triggers: string[]; ideas_to_study: string[];
}

function armRow(d: Data, p: H2hPrereg, cls: UnitClass, arm: H2hArm): ArmRow {
  const us = d.of(cls, arm);
  const scored = us.filter((u) => d.value(u, arm) !== null);
  const k = scored.filter((u) => d.value(u, arm) === 1).length;
  const rate = (r: Reading) => {
    const v = us.map((u) => d.value(u, arm, r)).filter((x): x is 0 | 1 => x !== null);
    return v.length ? v.filter((x) => x === 1).length / v.length : null;
  };
  const scores = scored.map((u) => d.score(u, arm)!);
  const sess = us.map((u) => d.session(u, arm)).filter((s): s is H2hSession => s !== null);
  const cost = sess.map((s) => s.cost_usd);
  const total = cost.reduce((a, x) => a + x, 0);
  const sum = (f: (s: H2hSession) => number) => sess.reduce((a, s) => a + f(s), 0);
  const wt = scores.filter((s) => s.worktree_pass !== null);
  return {
    class: cls, arm, cell: cellOf(d, p, cls, arm), verified: { k, n: scored.length, rate: scored.length ? k / scored.length : null, ci95: wilson(k, scored.length) },
    worst_case_rate: rate("worst_case"), without_new_test_rule: rate("without_new_test_rule"), adapted: rate("adapted"), exposure: exposureOf(d, cls, arm),
    lines: { mean: mean(scores.map((s) => s.lines_changed)), median: percentile(scores.map((s) => s.lines_changed), 50), verified_mean: mean(scores.filter((s) => s.verified).map((s) => s.lines_changed)) },
    planning_lines: { mean: mean(scores.map((s) => s.planning_lines)), sessions_with: scores.filter((s) => s.planning_lines > 0).length },
    dollars: { total, per_verified_fix: k ? total / k : null, mean: mean(cost), median: percentile(cost, 50), p95: percentile(cost, 95) },
    wall_ms: { mean: mean(sess.map((s) => s.wall_ms)), median: percentile(sess.map((s) => s.wall_ms), 50) },
    tokens: { input: sum((s) => s.tokens.input), output: sum((s) => s.tokens.output), cache_read: sum((s) => s.tokens.cache_read), cache_write: sum((s) => s.tokens.cache_write) },
    continuations: sum((s) => s.continuations), spurious_continuations: sum((s) => s.spurious_continuations), reservation_refusals: sum((s) => s.reservation_refusals),
    allowance_stops: sess.filter((s) => s.end === "limit_allowance").length, safety_stops: sess.filter((s) => s.end === "safety_stop").length, questions: sum((s) => s.questions),
    worktree: { candidates: wt.length, passes: wt.filter((s) => s.worktree_pass).length, passes_main_not: wt.filter((s) => s.worktree_pass && !s.verified).length },
    dropped_arm_tests: { sessions: scores.filter((s) => s.dropped_arm_tests.length).length, files: scores.reduce((a, s) => a + s.dropped_arm_tests.length, 0) },
  };
}

/** Section 9's row state, by precedence: infeasible, incomplete, run as published, pack not exercised, then the test. */
export function rowState(o: { infeasible?: boolean; incomplete: boolean; runAsPublished?: boolean; notExercised?: boolean; pHolm: number; ci95: [number, number] | null }): RowState {
  if (o.infeasible) return "infeasible";
  if (o.incomplete) return "incomplete";
  if (o.runAsPublished) return "run_as_published";
  if (o.notExercised) return "not_exercised";
  if (o.pHolm < ALPHA && o.ci95 && o.ci95[0] > 0) return "ahead";
  if (o.pHolm < ALPHA && o.ci95 && o.ci95[1] < 0) return "behind";
  return "no_difference";
}

export function analyze(i: AnalysisInput, p: H2hPrereg): Analysis {
  const d = new Data(i);
  const seed = p.bootstrap_seed;
  const floor = p.analysis.exposure_floor;
  const published = new Set(i.runAsPublished ?? []);
  const family: FamilyRow[] = [];
  for (const cls of ["O", "B"] as const)
    for (const other of COMPARATORS) {
      const us = d.of(cls, "gstack");
      const test = pairedTest(pairsOf(d, us, other, "gstack"), seed);
      const cells = { gstack: cellOf(d, p, cls, "gstack"), other: cellOf(d, p, cls, other) };
      const incomplete = cells.gstack.incomplete || cells.other.incomplete || test.n === 0;
      family.push({
        class: cls, other, test, incomplete, p_holm_input: incomplete ? 1 : test.p, p_holm: 1, holm_rank: 0, holm_alpha: ALPHA, mdd: null, half_mdd: null, state: "no_difference", idea_to_study: false,
        exposure_other: other === "none" ? null : exposureOf(d, cls, other), exposure_gstack: exposureOf(d, cls, "gstack"), cells,
        worst_case: pairedTest(pairsOf(d, us, other, "gstack", "worst_case"), seed),
      });
    }
  const adj = holmAdjusted(family.map((r) => r.p_holm_input));
  const order = family.map((r, k) => ({ p: r.p_holm_input, k })).sort((a, b) => a.p - b.p);
  order.forEach(({ k }, rank) => {
    const r = family[k]!;
    r.p_holm = adj[k]!;
    r.holm_rank = rank + 1;
    r.holm_alpha = ALPHA / (FAMILY_SIZE - rank);
    r.mdd = r.test.n && r.test.discordant_share !== null ? mdd(r.test.n, r.test.discordant_share, r.holm_alpha) : null;
    r.half_mdd = r.mdd === null ? null : r.mdd / 2;
    const notExercised = r.exposure_other !== null && (r.exposure_other.procedure ?? 0) < floor;
    r.state = rowState({ incomplete: r.incomplete, runAsPublished: published.has(r.other) || published.has("gstack"), notExercised, pHolm: r.p_holm, ci95: r.test.ci95 });
    r.idea_to_study = r.other !== "none" && r.state === "no_difference" && r.half_mdd !== null && r.test.delta !== null && -r.test.delta >= r.half_mdd;
  });
  const fix_method_exposure = { O: (exposureOf(d, "O", "gstack").procedure ?? 0) < floor, B: (exposureOf(d, "B", "gstack").procedure ?? 0) < floor };
  const why_null = family.filter((r) => r.state === "no_difference" || r.state === "behind").map((r) => ({
    class: r.class, other: r.other, state: r.state,
    reads: fix_method_exposure[r.class] ? "FIX-METHOD on exposure: gstack's procedure ran in under " + 100 * floor + "% of its " + r.class + " sessions" : "one Why-null cycle due: exposure, task fit, power and headroom, and whether Opus does it unaided",
  }));

  const arms: ArmRow[] = [];
  for (const cls of ["O", "B"] as const) for (const arm of ALL_ARMS) if (d.of(cls, arm).length || PRIMARY_ARMS.includes(arm as never)) arms.push(armRow(d, p, cls, arm));
  const contrast = (label: string, us: readonly H2hUnit[], a: H2hArm, b: H2hArm): Contrast => ({ label, test: pairedTest(pairsOf(d, us, a, b), seed) });
  const none_vs_pack: Contrast[] = [], pack_pairs: Contrast[] = [];
  for (const cls of ["O", "B"] as const) {
    const us = d.units.filter((u) => u.class === cls);
    for (const pk of PACKS) none_vs_pack.push(contrast(cls + ": " + pk + " minus none", us, "none", pk));
    PACKS.forEach((x, k) => PACKS.slice(k + 1).forEach((y) => pack_pairs.push(contrast(cls + ": " + y + " minus " + x, us, x, y))));
  }
  const b1 = d.units.filter((u) => u.kind === "B1");
  const b1Infeasible = b1.length < p.classes.B.b1_min_units;
  const qa = [contrast("B1: gstack-qa minus gstack", b1, "gstack", "gstack-qa"), contrast("B1: gstack-qa minus none", b1, "none", "gstack-qa")].map((c) => ({
    ...c, state: rowState({ infeasible: b1Infeasible, incomplete: cellOf(d, p, "B", "gstack-qa").incomplete || c.test.n === 0, pHolm: c.test.p, ci95: c.test.ci95 }),
  }));
  const strataDefs: { name: string; class: UnitClass; keep: (u: H2hUnit) => boolean }[] = [
    { name: "O July 2026", class: "O", keep: (u) => u.month === "2026-07" },
    { name: "O bug", class: "O", keep: (u) => u.entry === "bug" },
    { name: "O feature", class: "O", keep: (u) => u.entry === "feature" },
    { name: "B B1", class: "B", keep: (u) => u.kind === "B1" },
    { name: "B B2", class: "B", keep: (u) => u.kind === "B2" },
    ...(["O", "B"] as const).flatMap((cls) => [...new Set(d.units.filter((u) => u.class === cls).map((u) => u.language))].sort().map((lang) => ({ name: cls + " " + lang, class: cls, keep: (u: H2hUnit) => u.language === lang }))),
  ];
  const strata = strataDefs.map((s) => {
    const us = d.units.filter((u) => u.class === s.class && s.keep(u));
    const rates = Object.fromEntries(PRIMARY_ARMS.map((arm) => {
      const v = us.map((u) => d.value(u, arm)).filter((x) => x !== null);
      return [arm, v.length ? v.filter((x) => x === 1).length / v.length : null];
    }));
    return { name: s.name, class: s.class, units: us.length, rates, gstack_minus: COMPARATORS.map((o) => contrast(s.name + ": gstack minus " + o, us, o, "gstack")) };
  });

  const ou = d.units.filter((u) => u.class === "O");
  const both = (arm: H2hArm) => ou.filter((u) => d.value(u, arm) === 1 && d.value(u, "gstack") === 1).map((u) => ({ repo: u.repo, x: d.score(u, "gstack")!.lines_changed, y: d.score(u, arm)!.lines_changed }));
  const pv = pairedTest(pairsOf(d, ou, "gstack", "gstack-pony"), seed);
  const pgIncomplete = cellOf(d, p, "O", "gstack").incomplete || cellOf(d, p, "O", "gstack-pony").incomplete || pv.n === 0;
  const lines = logRatio(both("gstack-pony"), seed);
  const oneline = logRatio(both("gstack-oneline"), seed);
  const ph = holmAdjusted([lines.p, pgIncomplete ? 1 : pv.p]) as [number, number];
  const exposure_pony = exposureOf(d, "O", "gstack-pony");
  const exercised = (exposure_pony.procedure ?? 0) >= floor;
  const less_code = ph[0] < ALPHA && lines.ratio !== null && lines.ratio < 1;
  const more_correct = !pgIncomplete && ph[1] < ALPHA && !!pv.ci95 && pv.ci95[0] > 0;
  const adoptable = less_code && pv.delta !== null && pv.delta >= p.analysis.piece_g.adopt_min_point_diff && !(pv.ci95 && pv.ci95[1] < 0);
  const piece_g: PieceG = {
    verified: pv, incomplete: pgIncomplete, lines, oneline, p_holm: ph, less_code, more_correct, exposure_pony, exercised,
    adopt: !adoptable ? null : oneline.ci95 && lines.ratio !== null && oneline.ci95[1] <= lines.ratio ? "oneline" : "ponystack",
  };

  const row = (cls: UnitClass, other: string) => family.find((r) => r.class === cls && r.other === other)!;
  const triggers: string[] = [];
  const oNone = row("O", "none").state, bNone = row("B", "none").state;
  if (oNone === "no_difference") triggers.push("gstack ties plain Opus on ordinary bugs (O)");
  if (oNone === "behind") triggers.push("gstack behind plain Opus on O");
  if (oNone === "ahead") triggers.push("gstack ahead of plain Opus on O");
  if (bNone === "ahead") triggers.push("gstack ahead of plain Opus on B");
  if (bNone === "no_difference" || bNone === "behind") triggers.push("gstack ties or trails plain Opus on B");
  for (const r of family.filter((r) => r.other !== "none" && r.state === "behind")) triggers.push("A pack ahead of gstack on a class (after Holm, exercised as designed): " + r.other + " on " + r.class);
  const ideas_to_study = family.filter((r) => r.idea_to_study).map((r) => r.other + " on " + r.class);
  for (const x of ideas_to_study) triggers.push("A pack ahead of gstack by at least half the MDD, not after Holm: " + x);
  for (const r of family.filter((r) => r.state === "not_exercised")) triggers.push("A pack not exercised as designed: " + r.other + " on " + r.class);
  for (const cls of ["O", "B"] as const) {
    const g = arms.find((a) => a.class === cls && a.arm === "gstack")!.dollars.per_verified_fix, n = arms.find((a) => a.class === cls && a.arm === "none")!.dollars.per_verified_fix;
    if (g !== null && n !== null && g > n && row(cls, "none").state !== "ahead") triggers.push("gstack's dollars per verified fix above plain Opus's, with no correctness gain on " + cls);
  }
  triggers.push("Piece G");
  return {
    schema: "h2h-analysis.v1", stage: i.stage, bootstrap_seed: seed,
    units: { O: ou.length, B: d.units.filter((u) => u.class === "B").length, B1: b1.length, B2: d.units.filter((u) => u.kind === "B2").length },
    family, fix_method_exposure, why_null, arms, none_vs_pack, pack_pairs, qa, strata, piece_g, triggers, ideas_to_study,
  };
}

const pct = (x: number | null) => (x === null ? "none" : (100 * x).toFixed(1));
const ci = (c: [number, number] | null) => (c ? "[" + pct(c[0]) + ", " + pct(c[1]) + "]" : "no interval");
const STATE_TEXT: Record<RowState, string> = {
  ahead: "gstack ahead", behind: "gstack behind", no_difference: "no difference shown", incomplete: "incomplete", not_exercised: "pack not exercised as designed",
  infeasible: "infeasible", run_as_published: "run as published, failure disclosed",
};

/** The analysis as plain lines: the 12-contrast table, then piece G, the /qa secondary and the section 10 rows. */
export function report(a: Analysis): string[] {
  const out = ["h2h analysis, " + a.stage + ": O " + a.units.O + " units, B " + a.units.B + " (B1 " + a.units.B1 + ", B2 " + a.units.B2 + ")", "class | gstack minus | n | difference (points) | 95% interval | p clustered | p exact | p Holm | MDD | procedure rate | state"];
  for (const r of a.family) {
    const t = r.test;
    const words = r.state === "no_difference" && r.mdd !== null ? "no difference larger than about " + Math.round(100 * r.mdd) + " points shown" : STATE_TEXT[r.state];
    out.push([r.class, r.other, t.n, pct(t.delta), ci(t.ci95), t.p.toFixed(4), t.p_exact.toFixed(4), r.p_holm.toFixed(4), r.mdd === null ? "none fits" : Math.round(100 * r.mdd), r.exposure_other ? pct(r.exposure_other.procedure) : "n/a", words].join(" | "));
  }
  const g = a.piece_g;
  out.push("piece G: lines ratio gstack-pony over gstack " + (g.lines.ratio?.toFixed(3) ?? "none") + " on " + g.lines.n + " units both fixed (" + g.lines.zero_excluded + " with zero lines left out), interval " + (g.lines.ci95 ? "[" + g.lines.ci95.map((x) => x.toFixed(3)).join(", ") + "]" : "none") + ", Holm p " + g.p_holm[0].toFixed(4) + "; verified difference " + pct(g.verified.delta) + " " + ci(g.verified.ci95) + ", Holm p " + g.p_holm[1].toFixed(4) + "; less code " + g.less_code + ", more correct " + g.more_correct + ", adopt " + (g.adopt ?? "nothing"));
  for (const q of a.qa) out.push("secondary " + q.label + ": " + pct(q.test.delta) + " " + ci(q.test.ci95) + " on " + q.test.n + " units, " + STATE_TEXT[q.state!]);
  for (const w of a.why_null) out.push("why null " + w.class + " gstack minus " + w.other + ": " + w.reads);
  for (const t of a.triggers) out.push("section 10: " + t);
  return out;
}
