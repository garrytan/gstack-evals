// Copyright (c) 2026 Garry Tan. MIT License.
// The planted-unit read's gates (prereg 2026-11-15-geva-537-eng-review-planted-units-prereg, sections 3, 6, 7 and 10).
// The admission pilot reads the plain arm only, in the plan's order: INSTRUMENT (reach, then hinted builds), the
// component rule on the component means (in band at 0.10 to 0.75 with a 95% lower bound at most 0.65), FLOOR with the
// functional share printed first, CEILING (the content raise the first time, a stop after it), the split stop, else
// HEADROOM. The content raise marks hard units and projects its supply and cost. The exposure gate (5 of 6 Opus, 2 of 3
// Sol or particle-1, a gap counting against the arm), the interim stop (under 0.70 after the first 24 non-gap sessions)
// and the final 0.80; the start rule (a re-printed MDD past 0.12); short supply (under 40 admitted units). Every lower
// bound is the 2.5% quantile of the two-stage repository-clustered bootstrap of unit means (stats.ts).
import type { ReasonCode } from "../../../src/errors/codes.ts";
import { fail } from "../errors.ts";
import { FROZEN, SIZE } from "../frozen.ts";
import type { GradedBuild, PlantedUnit, Primary, Reviewer, ReviewRecord, SkillArm } from "../types.ts";
import { CAP_FACTOR, SKILL_ARMS } from "./local.ts";
import { avoid, catchScore, functionalShare, isGap, reach, score, unitScore, type Measure } from "./score.ts";
import { at, levelOf, lvl, type Reading } from "./stats.ts";

const P = FROZEN.pilot;
const f2 = (x: number) => x.toFixed(2);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** A gate's outcome: a reason code when it stops, the message the code's line carries, and the lines it prints. */
export interface GateDecision {
  code: ReasonCode | null;
  message: string;
}

/** Throws the decision's refusal; cli.ts prints it with its code and exits 2. */
export const enforce = (d: GateDecision): void => {
  if (d.code) fail(d.code, d.message);
};

// ---------------------------------------------------------------------------------------------------------------------
// Admission pilot (section 7).

export interface Hinted {
  passed: number;
  screened: number;
}

/** Batch 1's screened units whose hinted build passed a planted case in 2 of 3 runs (PlantedUnit.winnable). */
export function hintedOf(units: PlantedUnit[]): Hinted {
  const s = units.filter((u) => u.winnable !== null);
  return { passed: s.filter((u) => u.winnable === true).length, screened: s.length };
}

export interface AdmissionReading {
  units: number;
  repos: number;
  builds: number;
  /** Unit mean of each plain build's reach. */
  reach: number | null;
  hinted: Hinted;
  /** Unit mean of each plain build's functional share. */
  functional: number | null;
  avoid: Reading | null;
  catch: Reading | null;
  composite: Reading | null;
}

/** The plain arm's levels on the given units (the pilot's 20, or the raise's 16 hard units): Opus plain reviews, each
 * built once, gaps left out. Catch scores a dropped transplant 0, as in the primary. */
export function admissionReading(units: PlantedUnit[], builds: GradedBuild[], hinted: Hinted, seed: number, draws: number = FROZEN.bootstrapDraws): AdmissionReading {
  const ids = new Set(units.map((u) => u.id));
  const by = new Map<string, GradedBuild[]>();
  for (const b of builds) if (b.arm === "plain" && b.reviewer === "opus" && ids.has(b.unit)) by.set(b.unit, [...(by.get(b.unit) ?? []), b]);
  const per = (m: Measure) => (u: PlantedUnit) => unitScore(by.get(u.id) ?? [], u, m, "missing");
  const vals = (m: Measure) => units.map(per(m)).filter((x): x is number => x !== null);
  const read = units.filter((u) => by.has(u.id));
  return {
    units: read.length,
    repos: new Set(read.map((u) => u.repo)).size,
    builds: [...by.values()].reduce((s, bs) => s + bs.length, 0),
    reach: mean(vals(reach)),
    hinted,
    functional: mean(vals(functionalShare)),
    avoid: levelOf(units, per(avoid), seed, draws),
    catch: levelOf(units, per((b) => catchScore(b)), seed, draws),
    composite: levelOf(units, per((b, u) => score(b, u, "composite")), seed, draws),
  };
}

export type AdmissionLine = "INSTRUMENT" | "FLOOR" | "CEILING" | "COMPONENTS_SPLIT" | "HEADROOM";

export interface Admission extends GateDecision {
  line: AdmissionLine;
  /** The primary the component rule picked, or null when neither component is in band. */
  primary: Primary | null;
  /** The components at the ceiling, for the content raise's hard rule. */
  ceiling: Array<"avoid" | "catch">;
  lines: string[];
}

/** In band: the plain mean is 0.10 to 0.75 and its 95% lower bound is at most 0.65. */
export const inBand = (r: Reading) => at(r.estimate) >= P.low && at(r.estimate) <= P.high && at(r.lo) <= P.lowerMax;
const floorSide = (r: Reading) => at(r.estimate) < P.low;
const ceilingSide = (r: Reading) => at(r.estimate) > P.high || at(r.lo) > P.lowerMax;
const lv = (name: string, r: Reading | null) => name + " " + (r ? lvl(r.estimate) + " (95% lower bound " + lvl(r.lo) + ")" : "n/a");

/** The pilot's lines in the plan's order. After the content raise a ceiling stops with E_EP_CEILING; the first ceiling
 * reads E_EP_RAISE, and the caller adds the raise's projection (raiseStep). */
export function admissionLine(r: AdmissionReading, o: { afterRaise: boolean }): Admission {
  const hintedShare = r.hinted.screened ? r.hinted.passed / r.hinted.screened : null;
  const context = "units " + r.units + ", repos " + r.repos + ", builds " + r.builds;
  const lines = [
    (o.afterRaise ? "raise" : "pilot") + " plain reading: reach " + lvl(r.reach) + ", hinted builds passing " + r.hinted.passed + " of " + r.hinted.screened + " (" + lvl(hintedShare) + "), functional share " + lvl(r.functional) + "; " + context,
    "components: " + lv("avoid", r.avoid) + ", " + lv("catch", r.catch) + "; " + lv("composite", r.composite),
  ];
  const out = (line: AdmissionLine, code: ReasonCode | null, primary: Primary | null, ceiling: Array<"avoid" | "catch">, message: string): Admission => ({ line, code, primary, ceiling, message, lines: [...lines, (code ? code + " " : "") + message] });
  if (r.reach === null || at(r.reach) < P.reachMin || hintedShare === null || at(hintedShare) < P.hintedMin || !r.avoid || !r.catch || !r.composite)
    return out("INSTRUMENT", "E_EP_INSTRUMENT", null, [], "reach " + lvl(r.reach) + " against " + f2(P.reachMin) + ", hinted builds passing " + lvl(hintedShare) + " against " + f2(P.hintedMin) + " (" + context + "): FIX-METHOD on the instrument");
  const a = r.avoid;
  const c = r.catch;
  const primary: Primary | null = inBand(a) && inBand(c) ? "composite" : inBand(a) ? "avoid" : inBand(c) ? "catch" : null;
  const chosen = primary === "composite" ? r.composite : primary === "avoid" ? a : primary === "catch" ? c : null;
  const pick = primary ? "primary " + primary + (primary === "composite" ? " (both components in band)" : " alone (the other component is out of band)") : "neither component in band";
  if ((chosen && floorSide(chosen)) || (floorSide(a) && floorSide(c))) {
    const setup = r.functional !== null && at(r.functional) < P.functionalMin;
    return out("FLOOR", "E_EP_FLOOR", primary, [], "functional share " + lvl(r.functional) + (setup ? " (under " + f2(P.functionalMin) + ": the build setup, not the task)" : "") + "; " + pick + "; " + (chosen ? lv(primary!, chosen) : "both components") + " under " + f2(P.low) + " (" + context + "): FIX-METHOD on " + (setup ? "the build setup" : "task fit"));
  }
  const ceilingOf: Array<"avoid" | "catch"> = primary === "composite" || !primary ? ["avoid", "catch"] : [primary];
  if ((chosen && ceilingSide(chosen)) || (ceilingSide(a) && ceilingSide(c))) {
    const what = (chosen ? lv(primary!, chosen) : "both components") + " above " + f2(P.high) + " or a lower bound above " + f2(P.lowerMax);
    return o.afterRaise
      ? out("CEILING", "E_EP_CEILING", primary, ceilingOf, pick + "; " + what + " on hard units (" + context + "): FIX-METHOD on saturation, no cut")
      : out("CEILING", "E_EP_RAISE", primary, ceilingOf, pick + "; " + what + " (" + context + "): the content raise to hard units needs the Captain's go");
  }
  if (!primary) {
    const low = floorSide(a) ? "avoid" : "catch";
    return out("COMPONENTS_SPLIT", "E_EP_COMPONENTS_SPLIT", null, [], low + " at the floor and " + (low === "avoid" ? "catch" : "avoid") + " at the ceiling; " + lv("avoid", a) + ", " + lv("catch", c) + " (" + context + "): FIX-METHOD on task fit");
  }
  return out("HEADROOM", null, primary, [], "HEADROOM: " + pick + ", " + lv(primary, chosen) + " (" + context + "); the re-projection runs on the pilot's measured costs and variance");
}

// ---------------------------------------------------------------------------------------------------------------------
// The content raise (section 7, R61).

/** Hard: a foreseeable unit (not both raters "no") whose no-review build missed on a component at the ceiling (avoid
 * under 1, or catch 0 with a dropped transplant scored 0). Null when the unit has no scored no-review build. */
export function hardOf(u: PlantedUnit, builds: GradedBuild[], ceiling: Array<"avoid" | "catch">): boolean | null {
  if (u.foresee && u.foresee[0] === "no" && u.foresee[1] === "no") return false;
  const none = builds.find((b) => b.unit === u.id && b.arm === "none" && !isGap(b));
  if (!none) return null;
  return ceiling.some((k) => (k === "avoid" ? at(avoid(none, u) ?? 0) < 1 : catchScore(none) === 0));
}

/** The units with PlantedUnit.hard set from their no-review builds. */
export const markHard = (units: PlantedUnit[], builds: GradedBuild[], ceiling: Array<"avoid" | "catch">): PlantedUnit[] => units.map((u) => ({ ...u, hard: hardOf(u, builds, ceiling) }));

export interface RaiseInput {
  /** Batch 1's admitted comparison units with a scored no-review build, and how many of them are hard. */
  read: number;
  hard: number;
  /** Batch 1's authored qualifiers and the comparison units authoring admitted from them. */
  authored: number;
  admitted: number;
  /** Qualifiers in the frozen manifest no batch has used. */
  unused: number;
  /** Authoring cost of one candidate (plan, audit, hint, two ratings, hinted build, no-review build), and of one plain
   * review plus its build for the raise's read, both from batch 1's ledger. */
  perCandidateUsd: number;
  perReadUsd: number;
}

export interface RaiseProjection extends RaiseInput {
  hardRate: number;
  survival: number;
  /** Hard comparison units projected from the unused qualifiers, with batch 1's in hand. */
  projected: number;
  target: number;
  /** The supply can't reach the floor of 40 hard units. */
  short: boolean;
  candidates: number;
  authoringUsd: number;
  readUsd: number;
  totalUsd: number;
  capUsd: number;
}

/** The raise's projection at batch 1's measured hard rate and authoring survival: hard units projected, the size target
 * (64, down to the floor of 40), the candidates to author, and the spend and cap that go to the Captain. */
export function raiseProjection(i: RaiseInput): RaiseProjection {
  const hardRate = i.read ? i.hard / i.read : 0;
  const survival = i.authored ? i.admitted / i.authored : 0;
  const yieldPer = hardRate * survival;
  const projected = i.hard + Math.floor(at(i.unused * yieldPer));
  const target = Math.min(FROZEN.raise.target, projected);
  const short = projected < FROZEN.raise.floor;
  const candidates = yieldPer > 0 ? Math.min(i.unused, Math.ceil(at(Math.max(0, target - i.hard) / yieldPer))) : 0;
  const authoringUsd = candidates * i.perCandidateUsd;
  const readUsd = FROZEN.raise.readUnits * FROZEN.raise.k * i.perReadUsd;
  const totalUsd = authoringUsd + readUsd;
  return { ...i, hardRate, survival, projected, target, short, candidates, authoringUsd, readUsd, totalUsd, capUsd: Math.ceil(totalUsd * CAP_FACTOR) };
}

export const raiseLine = (p: RaiseProjection) =>
  "raise projection: hard rate " + lvl(p.hardRate) + " (" + p.hard + " of " + p.read + "), authoring survival " + lvl(p.survival) + " (" + p.admitted + " of " + p.authored + "), " + p.unused + " unused qualifiers project " + p.projected + " hard units against a target of " + FROZEN.raise.target + " (floor " + FROZEN.raise.floor + "); target " + p.target + ", " + p.candidates + " candidates to author: authoring $" + p.authoringUsd.toFixed(0) + " + the read of " + FROZEN.raise.readUnits + " hard units x " + FROZEN.raise.k + " $" + p.readUsd.toFixed(0) + " = $" + p.totalUsd.toFixed(0) + ", cap $" + p.capUsd;

/** The first ceiling: the projection prints with E_EP_RAISE, or, when the supply can't reach 40 hard units, the attempt
 * stops with E_EP_CEILING (FIX-METHOD on saturation) before any raise spend. */
export function raiseStep(a: Admission, p: RaiseProjection): Admission {
  if (a.code !== "E_EP_RAISE") return a;
  const line = raiseLine(p);
  if (p.short) {
    const message = a.message.replace(/: the content raise.*$/, "") + "; " + line + ": the supply can't reach " + FROZEN.raise.floor + " hard units, FIX-METHOD on saturation, no cut";
    return { ...a, code: "E_EP_CEILING", message, lines: [...a.lines.slice(0, -1), "E_EP_CEILING " + message] };
  }
  const message = a.message + "; " + line;
  return { ...a, message, lines: [...a.lines.slice(0, -1), "E_EP_RAISE " + message] };
}

/** The raise's read on its hard units (the same lines, after the raise), and the hard supply once authored. */
export function raiseRead(r: AdmissionReading, hardAdmitted: number | null): Admission {
  const a = admissionLine(r, { afterRaise: true });
  if (a.code || hardAdmitted === null || hardAdmitted >= FROZEN.raise.floor) return a;
  const message = "hard units admitted " + hardAdmitted + " against the floor of " + FROZEN.raise.floor + ": the supply can't reach it, FIX-METHOD on saturation, no cut";
  return { ...a, line: "CEILING", code: "E_EP_CEILING", message, lines: [...a.lines, "E_EP_CEILING " + message] };
}

/** The start rule's input for power.py --fit: one row per scored plain pilot build. */
export function pilotPowerInput(units: PlantedUnit[], builds: GradedBuild[], unforeseeable: number) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const rows: Array<{ unit: string; repo: string; avoid: number; catch: number }> = [];
  for (const b of builds) {
    const u = byId.get(b.unit);
    if (!u || b.arm !== "plain" || b.reviewer !== "opus" || isGap(b)) continue;
    const a = avoid(b, u);
    if (a !== null) rows.push({ unit: u.id, repo: u.repo, avoid: a, catch: catchScore(b)! });
  }
  return { builds: rows, unforeseeable };
}

// ---------------------------------------------------------------------------------------------------------------------
// Exposure (section 6). Exposure is the frozen detector's reading on the final transcript (ReviewRecord.exposed).

export interface ExposureCounts {
  exposed: number;
  unexposed: number;
  gaps: number;
  /** Exposed over exposed plus unexposed: a gap counts as neither. Null with no non-gap session. */
  share: number | null;
}

export function exposureCounts(rs: ReviewRecord[]): ExposureCounts {
  const gaps = rs.filter(isGap).length;
  const exposed = rs.filter((r) => !isGap(r) && r.exposed === true).length;
  const unexposed = rs.length - gaps - exposed;
  return { exposed, unexposed, gaps, share: exposed + unexposed ? exposed / (exposed + unexposed) : null };
}

export interface SmokeArm {
  arm: SkillArm;
  exposed: number;
  sessions: number;
  need: number;
  gaps: number;
  passed: boolean;
}

export interface SmokeResult extends GateDecision {
  reviewer: Reviewer;
  arms: SmokeArm[];
  /** The skill arms through the gate; each runs its own family. */
  through: SkillArm[];
  lines: string[];
}

/** The smoke: the first 6 sessions of each Opus skill arm need 5 exposed, the first 3 on Sol or particle-1 need 2. A gap,
 * or a session that never ran, counts against the arm. No arm through stops the comparison for this reviewer. */
export function smokeGate(smoke: ReviewRecord[], reviewer: Reviewer): SmokeResult {
  const rule = reviewer === "opus" ? FROZEN.exposure.opus : FROZEN.exposure.other;
  const arms: SmokeArm[] = [];
  const lines: string[] = [];
  for (const arm of SKILL_ARMS) {
    const rs = smoke.filter((r) => r.arm === arm && r.reviewer === reviewer).slice(0, rule.sessions);
    const exposed = rs.filter((r) => !isGap(r) && r.exposed === true).length;
    const passed = exposed >= rule.min;
    arms.push({ arm, exposed, sessions: rule.sessions, need: rule.min, gaps: rs.filter(isGap).length, passed });
    lines.push("smoke " + arm + " on " + reviewer + ": exposed " + exposed + " of " + rule.sessions + " (gaps " + rs.filter(isGap).length + ", counted against the arm), needs " + rule.min + ": " + (passed ? "through" : "untested (FIX-METHOD on the instrument), its cap released, the finding goes to the Captain for GStack Minder"));
  }
  const through = arms.filter((a) => a.passed).map((a) => a.arm);
  const failed = arms.filter((a) => !a.passed);
  const message = failed.length
    ? failed.map((a) => a.arm + " exposed " + a.exposed + " of " + a.sessions + " (needs " + a.need + ")").join(", ") + " on " + reviewer + "; " + (through.length ? "only " + through.join(" and ") + " runs its family" : "no skill arm is through, so the comparison does not start")
    : "";
  return { reviewer, arms, through, lines, code: failed.length ? "E_EP_EXPOSURE_GATE" : null, message };
}

/** The interim line on an exposure share: under 0.70 stops. */
export const interimStops = (share: number) => at(share) < FROZEN.exposure.interim.min;
/** The final line: an arm under 0.80 over all its comparison sessions (or with none read) reads untested. */
export const finalUntested = (share: number | null) => share === null || at(share) < FROZEN.exposure.final;

export interface Interim extends GateDecision {
  stop: boolean;
  /** Exposure over the first 24 non-gap sessions; null before 24 have run. */
  share: number | null;
}

/** The interim stop: an arm under 0.70 exposed after its first 24 non-gap comparison sessions, in run order, stops. */
export function interimCheck(arm: SkillArm, reviewer: Reviewer, sessions: ReviewRecord[]): Interim {
  const I = FROZEN.exposure.interim;
  const read = sessions.filter((r) => r.arm === arm && r.reviewer === reviewer && !isGap(r)).slice(0, I.after);
  if (read.length < I.after) return { stop: false, share: null, code: null, message: "" };
  const share = read.filter((r) => r.exposed === true).length / read.length;
  if (!interimStops(share)) return { stop: false, share, code: null, message: "" };
  return { stop: true, share, code: "E_EP_EXPOSURE_STOP", message: "arm " + arm + " on " + reviewer + ": exposed " + lvl(share) + " over its first " + I.after + " non-gap sessions, under " + f2(I.min) + "; the arm stops and reads untested, the other arms go on" };
}

// ---------------------------------------------------------------------------------------------------------------------
// The start rule (section 10) and short supply (sections 3 and 9).

/** After the pilot, a re-printed MDD past 0.12 waits for the Captain before any skill-arm build. */
export function startRule(mdd: number, context = ""): GateDecision {
  if (at(mdd) <= FROZEN.mddStop) return { code: null, message: "start rule: re-printed MDD " + lvl(mdd) + " is within " + f2(FROZEN.mddStop) + (context ? " (" + context + ")" : "") };
  return { code: "E_EP_START_RULE", message: "re-printed MDD " + lvl(mdd) + " is past " + f2(FROZEN.mddStop) + (context ? " (" + context + ")" : "") + "; the pre-decided option moves the eng phase arm's remaining budget into more standalone units" };
}

/** Under 40 admitted comparison units stops for the Captain; at 40 or more the comparison runs at the achieved number
 * with its MDD re-printed. */
export function supplyCheck(admitted: number): GateDecision {
  if (admitted >= SIZE.floor) return { code: null, message: "supply: " + admitted + " admitted units" + (admitted < SIZE.units ? ", under the target of " + SIZE.units + ": the comparison runs at " + admitted + " with its MDD re-printed" : "") };
  return { code: "E_EP_SUPPLY_SHORT", message: "authoring admitted " + admitted + " comparison units against the floor of " + SIZE.floor + "; stop for the Captain" };
}
