// Copyright (c) 2026 Garry Tan. MIT License.
// The eng-review build read's gates (prereg 2026-11-11-geva-522-eng-review-build-read-prereg, sections 3, 6 and 7): the
// recount's floor of clean units, the headroom pilot's stop lines in their frozen order (reach, then floor with
// functional solved deciding task fit or build setup, then ceiling, else HEADROOM), the exposure gate (Opus 5 of 6,
// Sol and particle-1 2 of 3, pooled membership frozen at the gate, fewer than two Opus arms stops), the interim stop
// (under 0.70 after 24 sessions) and the final 0.80 exposure each arm needs. Exposure is the frozen detector's reading
// on the final transcript (ReviewRecord.exposed), never the Stop hook's count.
import type { ReasonCode } from "../../src/errors/codes.ts";
import { at, functional, infer, isGap, lvl, primary, reach, SKILL_ARMS, type Paired } from "./analysis.ts";
import { fail } from "./errors.ts";
import { FROZEN } from "./frozen.ts";
import type { BuildUnit, GradedBuild, Reviewer, ReviewRecord, SkillArm } from "./types.ts";

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Section 3: fewer than 16 clean units after the recount stops for the Captain before any lease opens. */
export function recountGate(clean: number): void {
  if (clean < FROZEN.recount.minClean) fail("E_EB_FEW_UNITS", "clean units " + clean + " against " + FROZEN.recount.minClean + "; stop for the Captain, no lease opened");
}

// ---------------------------------------------------------------------------------------------------------------------
// Headroom pilot (section 6).

export type PilotLine = "INSTRUMENT" | "FLOOR" | "CEILING" | "HEADROOM";

export interface PilotReading {
  /** Item-weighted, unit-mean reach over every pilot build (no review and plain). */
  reach: number;
  /** Plain-review aftermath pass share, unit mean. */
  plain: number;
  /** Its 95% lower bound, clustered on the repository. */
  plainLower: number;
  /** Plain-review functional solved, unit mean. */
  functional: number;
  units: number;
  builds: number;
}

export function pilotReading(units: BuildUnit[], builds: GradedBuild[], seed: number, draws: number = FROZEN.bootstrapDraws): PilotReading {
  const pilot = builds.filter((b) => b.pilot && (b.arm === "none" ? b.reviewer === null : b.arm === "plain" && b.reviewer === "opus"));
  const reachU: number[] = [];
  const plainU: Paired[] = [];
  const fnU: number[] = [];
  for (const u of units) {
    const mine = pilot.filter((b) => b.unit === u.id && !isGap(b));
    const r = mine.map((b) => reach(b, u)).filter((x): x is number => x !== null);
    if (r.length) reachU.push(mean(r));
    const plain = mine.filter((b) => b.arm === "plain");
    const p = plain.map((b) => primary(b, u)).filter((x): x is number => x !== null);
    if (p.length) plainU.push({ unit: u.id, repo: u.repo, d: mean(p) });
    if (plain.length) fnU.push(mean(plain.map((b) => functional(b, u))));
  }
  const lv = infer(plainU, seed, draws);
  return { reach: reachU.length ? mean(reachU) : 0, plain: lv?.estimate ?? 0, plainLower: lv?.lo ?? 0, functional: fnU.length ? mean(fnU) : 0, units: new Set(pilot.map((b) => b.unit)).size, builds: pilot.length };
}

export interface PilotDecision {
  line: PilotLine;
  code: ReasonCode | null;
  message: string;
}

/** The stop lines, read in order: reach, floor, ceiling, else HEADROOM. */
export function pilotLine(r: PilotReading): PilotDecision {
  const read = "units " + r.units + ", builds " + r.builds;
  const P = FROZEN.pilot;
  if (at(r.reach) < P.reachMin) return { line: "INSTRUMENT", code: "E_EB_REACH", message: "pilot reach " + lvl(r.reach) + " is under " + P.reachMin.toFixed(2) + " (" + read + "; plain functional solved " + lvl(r.functional) + "): FIX-METHOD on the instrument" };
  if (at(r.plain) < P.floor) {
    const taskFit = at(r.functional) >= P.functionalMin;
    return { line: "FLOOR", code: "E_EB_FLOOR", message: "plain functional solved " + lvl(r.functional) + ", reach " + lvl(r.reach) + "; plain-review later-fix pass share " + lvl(r.plain) + " is under " + P.floor.toFixed(2) + " (" + read + "): FIX-METHOD on " + (taskFit ? "task fit" : "the build setup") };
  }
  if (at(r.plain) > P.ceiling || at(r.plainLower) > P.ceilingLower)
    return { line: "CEILING", code: "E_EB_CEILING", message: "plain-review later-fix pass share " + lvl(r.plain) + " (95% lower bound " + lvl(r.plainLower) + ") is above " + P.ceiling.toFixed(2) + " or its lower bound above " + P.ceilingLower.toFixed(2) + " (" + read + "; plain functional solved " + lvl(r.functional) + "): FIX-METHOD on saturation" };
  return { line: "HEADROOM", code: null, message: "HEADROOM: reach " + lvl(r.reach) + ", plain-review later-fix pass share " + lvl(r.plain) + " (95% lower bound " + lvl(r.plainLower) + "), plain functional solved " + lvl(r.functional) + " (" + read + "); the money re-projection runs next" };
}

// ---------------------------------------------------------------------------------------------------------------------
// Exposure (section 7).

/** The detector's exposed share over the sessions given; a session with no exposure reading counts as not exposed. */
export const exposureShare = (rs: ReviewRecord[]): number | null => (rs.length ? rs.filter((r) => r.exposed === true).length / rs.length : null);

export interface GateArm {
  arm: SkillArm;
  reviewer: Reviewer;
  exposed: number;
  sessions: number;
  need: number;
  passed: boolean;
}

export interface GateResult {
  arms: GateArm[];
  /** The Opus arms through the gate: the pooled primary's frozen membership. */
  members: SkillArm[];
  /** Fewer than two Opus arms passed: the comparison does not start. */
  stop: boolean;
  lines: string[];
}

/** The smoke: 6 Opus sessions of each skill arm need 5 exposed; 3 each on Sol and particle-1 need 2. */
export function exposureGate(smoke: ReviewRecord[]): GateResult {
  const arms: GateArm[] = [];
  const lines: string[] = [];
  for (const reviewer of ["opus", "sol", "particle"] as const) {
    const rule = reviewer === "opus" ? FROZEN.exposure.opus : FROZEN.exposure.other;
    for (const arm of SKILL_ARMS) {
      const rs = smoke.filter((r) => r.arm === arm && r.reviewer === reviewer).slice(0, rule.sessions);
      const exposed = rs.filter((r) => r.exposed === true).length;
      const passed = exposed >= rule.min;
      arms.push({ arm, reviewer, exposed, sessions: rule.sessions, need: rule.min, passed });
      if (!passed) lines.push("E_EB_EXPOSURE_GATE arm " + arm + " on " + reviewer + ": exposed " + exposed + " of " + rule.sessions + ", needs " + rule.min + "; " + (reviewer === "opus" ? "untested (FIX-METHOD on the instrument), its cap released" : "its conditional cells do not run"));
    }
  }
  const members = arms.filter((a) => a.reviewer === "opus" && a.passed).map((a) => a.arm);
  const stop = members.length < FROZEN.exposure.minOpusArms;
  if (stop) lines.push("E_EB_EXPOSURE_GATE " + members.length + " Opus arm" + (members.length === 1 ? "" : "s") + " passed the gate, needs " + FROZEN.exposure.minOpusArms + "; the comparison does not start, stop for the Captain");
  return { arms, members, stop, lines };
}

export interface Interim {
  stop: boolean;
  /** Exposure over the first 24 sessions, or null before 24 have run. */
  exposure: number | null;
  line: string | null;
}

/** The interim line on an exposure share: under 0.70 stops. */
export const interimStops = (e: number) => at(e) < FROZEN.exposure.interim.min;
/** The final line: an arm under 0.80 over all its comparison sessions reads untested. */
export const finalUntested = (e: number | null) => e === null || at(e) < FROZEN.exposure.final;

/** The interim stop: an arm under 0.70 exposure after its first 24 comparison sessions (in run order) stops. */
export function interimCheck(arm: SkillArm, reviewer: Reviewer, sessions: ReviewRecord[]): Interim {
  const I = FROZEN.exposure.interim;
  if (sessions.length < I.after) return { stop: false, exposure: null, line: null };
  const e = exposureShare(sessions.slice(0, I.after))!;
  if (!interimStops(e)) return { stop: false, exposure: e, line: null };
  return { stop: true, exposure: e, line: "E_EB_EXPOSURE_STOP arm " + arm + " on " + reviewer + ": exposure " + lvl(e) + " after " + I.after + " sessions is under " + I.min.toFixed(2) + "; the arm stops and its leases settle, the pooled primary reads untested, the other arms go on" };
}

export interface GateState {
  reviewer: Reviewer;
  members: SkillArm[];
  passed: Record<SkillArm, boolean>;
  stopped: Record<SkillArm, boolean>;
  /** Exposure over all of the arm's comparison sessions; under 0.80 reads untested. */
  final: Record<SkillArm, number | null>;
}

/** The state the analysis reads: the gate's verdicts for this reviewer, the interim stops and the final exposure. */
export function gateState(gate: GateResult, reviewer: Reviewer, comparison: ReviewRecord[]): GateState {
  const passed = {} as Record<SkillArm, boolean>;
  const stopped = {} as Record<SkillArm, boolean>;
  const final = {} as Record<SkillArm, number | null>;
  for (const arm of SKILL_ARMS) {
    passed[arm] = gate.arms.some((a) => a.arm === arm && a.reviewer === reviewer && a.passed);
    const rs = comparison.filter((r) => r.arm === arm && r.reviewer === reviewer);
    stopped[arm] = interimCheck(arm, reviewer, rs).stop;
    final[arm] = exposureShare(rs);
  }
  const members = reviewer === "opus" ? gate.members : SKILL_ARMS.filter((a) => passed[a]);
  return { reviewer, members: [...members], passed, stopped, final };
}
