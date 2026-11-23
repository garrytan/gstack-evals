// Copyright (c) 2026 Garry Tan. MIT License.
// Verdict words and decision rows of the planted-unit read (prereg 2026-11-15-geva-537-eng-review-planted-units-prereg,
// sections 9 and 11). Precedence: untested, then KEEP, then helps without KEEP, then the other words. No CUT-CANDIDATE
// path exists: every null, not shown, hurts or untested reading maps to FIX-METHOD with R48's Why null? cycle, because
// ENG-1 and ENG-4 to ENG-7 stay untested. Each arm's decision row uses its own test at alpha 0.05; the public headline
// uses the Holm-adjusted result, and both print (the Captain's condition 2). Every skill-arm result says the effect is
// measured given an explicit invocation, beside the arm's exposed, unexposed and gap counts (condition 4).
import { FROZEN } from "../frozen.ts";
import type { SkillArm } from "../types.ts";
import { finalUntested, type ExposureCounts } from "./gates.ts";
import { at, fmt, holdsZero, lvl, word, type Reading, type Word } from "./stats.ts";

export type Verdict = "untested" | "KEEP" | "helps without KEEP" | Word;
export type Untested = "admission" | "exposure" | "coverage" | "reach";

/** What each arm's result line names: the package tested. */
export const PACKAGE: Record<SkillArm, string> = {
  standalone: "the restored /plan-eng-review under a forced invocation held by the Stop hook, with the reviewed plan handed to the builder",
  engphase: "autoplan's Phase 3 eng phase under a forced opening held by the Stop hook, with the reviewed plan handed to the builder",
};
const SUBJECT: Record<SkillArm, string> = { standalone: "the restored skill", engphase: "autoplan's Phase 3 (as users get it in Claude Code)" };

export interface UntestedInput {
  admitted: boolean;
  gatePassed: boolean;
  stopped: boolean;
  exposure: number | null;
  coverage: number;
  plainCoverage: number;
  reachGuard: Reading | null;
}

/** Why a skill arm reads untested, in this order, or null: admission not passed, the exposure gate, the interim stop,
 * final exposure under 0.80, the arm's or plain's coverage (scored builds over planned) under 0.90, the reach guard (the
 * arm's reach minus plain's with a 95% upper bound below -0.05). */
export function untestedWhy(o: UntestedInput): { kind: Untested; why: string } | null {
  if (!o.admitted) return { kind: "admission", why: "admission not passed" };
  if (!o.gatePassed) return { kind: "exposure", why: "failed the exposure gate" };
  if (o.stopped) return { kind: "exposure", why: "stopped at the interim exposure check" };
  if (finalUntested(o.exposure)) return { kind: "exposure", why: "exposure " + lvl(o.exposure, 2) + " is under " + FROZEN.exposure.final.toFixed(2) };
  if (at(o.coverage) < FROZEN.coverageMin) return { kind: "coverage", why: "coverage " + lvl(o.coverage, 2) + " is under " + FROZEN.coverageMin.toFixed(2) };
  if (at(o.plainCoverage) < FROZEN.coverageMin) return { kind: "coverage", why: "plain coverage " + lvl(o.plainCoverage, 2) + " is under " + FROZEN.coverageMin.toFixed(2) };
  if (o.reachGuard && at(o.reachGuard.hi) < FROZEN.reachGuard) return { kind: "reach", why: "reach guard: reach minus plain has a 95% upper bound of " + fmt(o.reachGuard.hi) + ", below " + FROZEN.reachGuard.toFixed(2) };
  return null;
}

export interface VerdictInput {
  untested: { kind: Untested; why: string } | null;
  /** The primary, arm minus plain. */
  reading: Reading | null;
  /** The functional share, arm minus plain: KEEP's guard. */
  functional: Reading | null;
  /** A Holm-adjusted p for the headline; the arm's own p otherwise. */
  p?: number;
}

export interface VerdictOut {
  verdict: Verdict;
  why: string;
  r48: "KEEP" | "FIX-METHOD";
}

/** The fixed precedence: untested, then KEEP, then helps without KEEP, then the other words. */
export function verdictOf(v: VerdictInput): VerdictOut {
  if (v.untested) return { verdict: "untested", why: v.untested.why, r48: "FIX-METHOD" };
  const r = v.reading;
  if (!r) return { verdict: "untested", why: "no paired units", r48: "FIX-METHOD" };
  const p = v.p ?? r.p;
  const w = word(r, p);
  const guard = "the functional share minus plain has a 95% lower bound of " + fmt(v.functional?.lo);
  if (w === "helps" && v.functional && at(v.functional.lo) > FROZEN.keepFunctionalLower) return { verdict: "KEEP", why: "helps (p " + p.toFixed(4) + "), and " + guard + ", above " + FROZEN.keepFunctionalLower.toFixed(2), r48: "KEEP" };
  if (w === "helps") return { verdict: "helps without KEEP", why: "helps on the planted bugs at a cost to the rest of the change: " + guard + ", not above " + FROZEN.keepFunctionalLower.toFixed(2), r48: "FIX-METHOD" };
  const why = w === "not shown" ? "p " + p.toFixed(4) + " and the interval disagree" : w === "no measurable difference" ? "the interval holds zero (p " + p.toFixed(4) + ")" : "p " + p.toFixed(4) + " and the interval below zero";
  return { verdict: w, why, r48: "FIX-METHOD" };
}

/** Section 9: standalone minus eng phase reads a direction only when its interval excludes zero. */
export function pairWord(r: Reading | null, untested: boolean): string {
  if (untested) return "untested (a skill arm reads untested)";
  if (!r) return "no paired units";
  if (holdsZero(r)) return "no measurable difference (MDD " + lvl(r.mdd) + ")";
  return at(r.lo) > 0 ? "standalone better" : "eng phase better";
}

/** Section 9: stock matches a skill arm only when that arm reads helps and its minus-stock upper bound is below +0.05. */
export function stockWord(v: Verdict, minusStock: Reading | null): "matches" | "not distinguished" {
  return (v === "KEEP" || v === "helps without KEEP") && minusStock !== null && at(minusStock.hi) < FROZEN.stockUpper ? "matches" : "not distinguished";
}

/** Condition 4: the explicit-invocation clause and the arm's exposure counts. */
export const invocation = (arm: SkillArm, c: ExposureCounts) =>
  "measured given an explicit invocation (" + PACKAGE[arm] + "); sessions exposed " + c.exposed + ", unexposed " + c.unexposed + ", gaps " + c.gaps;

export interface RowContext {
  untested: Untested | null;
  why: string;
  /** The judged find rate, arm minus plain, when the judged secondary is reported. */
  judged: Reading | null;
  judgedReported: boolean;
  /** Which component moved more, for KEEP's lead. */
  lead: "avoid" | "catch" | null;
  mdd: number | null;
}

/** Section 11's row for one arm's own verdict. */
export function decisionRow(arm: SkillArm, v: Verdict, c: RowContext): string {
  const s = SUBJECT[arm];
  if (v === "untested") {
    if (c.untested === "exposure") return "A gstack bug for GStack Minder: " + s + " doesn't run its procedure unattended under a forced invocation and the Stop hook (" + c.why + "). The arm reads untested.";
    if (c.untested === "admission") return "No skill reading; FIX-METHOD on task fit, instrument or saturation. Nothing in gstack changes.";
    return "No skill reading; FIX-METHOD on the instrument (" + c.why + "). Nothing in gstack changes.";
  }
  if (v === "KEEP") {
    const lead = c.lead === "avoid" ? "avoid-led, a lead to failure modes and edge cases" : c.lead === "catch" ? "catch-led, a lead to the coverage diagram and test plan" : "no component lead";
    return "GStack Minder keeps the test review and failure-modes sections of " + s + " as they are (" + lead + "; leads, not findings). Users are told, with the interval and the package named: on real bugs from open-source fixes, builds from plans the forced " + (arm === "standalone" ? "skill" : "eng phase") + " reviewed passed more of the real fixes' tests, or caught more of the bugs, than builds from a plain Opus review.";
  }
  if (v === "helps without KEEP") return "GStack Minder gets a brief: " + s + " moves the planted bugs but costs the rest of the change; look at scope drift in the reviewed plans. Users are told both halves.";
  if (v === "hurts") return "GStack Minder investigates " + s + " before the next stable cut that carries it (length, scope drift, builder distraction, using the stock and length lines), and its docs say what we found. Users are told plainly.";
  const steer = !c.judgedReported
    ? "the judged secondary is unreported, so the brief goes unsteered"
    : c.judged && at(c.judged.lo) > 0
      ? "the reviewed plans named the planted condition more often than plain but builds didn't differ, so the hand-off is the gap (the plan's task and test output, ENG-8)"
      : "the reviewed plans didn't name the planted condition more often than plain, so the coverage and failure-mode procedure finds nothing plain Opus doesn't";
  return "FIX-METHOD, no cut. GStack Minder gets a rewrite brief for the test review and failure-modes sections of " + s + ": " + steer + ". Users are told plainly: no measurable difference on these real bugs at MDD " + lvl(c.mdd) + "; the skill's other aims are untested.";
}

/** Section 11's rows for standalone minus eng phase. */
export function pairRow(w: string): string {
  if (w === "standalone better") return "Autoplan's Phase 3 wrapper (its opening, eng-phase.md, unattended.md and the skip list) loses what the skill adds: GStack Minder gets a brief to fix the wrapper, with the skipped sections named.";
  if (w === "eng phase better") return "The wrapper adds something: GStack Minder gets a brief to move the wrapper's instructions into the standalone skill.";
  return "No change to autoplan's wrapper.";
}

/** Section 11's row for the stock line. */
export const stockRow = (w: "matches" | "not distinguished", arm: SkillArm) =>
  w === "matches" ? "The measured gain of " + arm + " is reachable by a short generic checklist: GStack Minder gets a brief to put that checklist into the build hand-off and trim the procedure the gain doesn't need." : "Not distinguished: no brief.";

/** R48's Why null? cycle, printed beside every FIX-METHOD reading. */
export const whyNull = (arm: SkillArm, exposure: number | null, mdd: number | null, plainLevel: number | null) =>
  arm + " R48 Why null?: exposure " + lvl(exposure, 2) + "; task fit by the admission pilot; power MDD " + lvl(mdd) + " against the smallest effect worth acting on, " + FROZEN.worthActing.toFixed(2) + " (5 points is plausible and beyond this design); plain level " + lvl(plainLevel) + " (whether plain Opus already does it). FIX-METHOD, no CUT-CANDIDATE: ENG-1 and ENG-4 to ENG-7 stay untested.";
