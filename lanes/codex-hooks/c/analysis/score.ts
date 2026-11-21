// Copyright (c) 2026 Garry Tan. MIT License.
// Scoring part C's states from their joined judgments (preregistration section 5.3). Found: a counted finding matches the
// bug, at any severity. Blocking, a secondary: a matched finding maps to CRITICAL under the arm's R2 severity map.
// Unmatched findings: counted findings the matching batch matches to no blocker. R2's adjudication of unmatched blocking
// findings gives new blockers and false blockers, the way R2's tallyFalseBlockers counts them: a blocking finding matched
// only to a unit's known informational case over-blocks it; an unmatched one ruled not-defect or known-informational is a
// false blocker, one ruled defect a new blocker, and one with no ruling is unadjudicated, never counted as not a defect.
// A label no map names leaves the blocking numbers of its arm incomplete; it never changes found.
import type { Unit } from "../../../review-noloss/suite.ts";
import type { CArm, CState } from "./frozen.ts";
import type { Judged, JudgedState } from "./judging.ts";
import { blockingBugs, type Session, type StatesFile } from "./record.ts";
import { readerOf, severityOf, type SeverityEntry } from "./severity.ts";

export interface StateScore {
  id: string;
  arm: CArm;
  unit: Unit;
  pass: number;
  counted: number;
  extracted: boolean;
  /** Per blocking bug: found at any severity. */
  found: Record<string, boolean>;
  /** Per blocking bug: found by a finding that maps to CRITICAL. */
  blocking: Record<string, boolean>;
  unmatched: number;
  unmatched_blocking: number;
  new_blockers: number;
  false_blockers: number;
  unadjudicated: number;
  /** Labels of counted findings that no map names. */
  unmapped: string[];
}

export interface SessionScore {
  session: Session;
  states: Record<CState, StateScore>;
}

export interface Scored {
  /** Scored sessions with every state judged. */
  sessions: SessionScore[];
  /** Sessions the rig scored whose judging left a state with no judgment: not scored here. */
  judge_gaps: Array<{ session: string; arm: CArm; reason: string }>;
}

export function scoreState(j: JudgedState, arm: CArm, unit: Unit, pass: number, map: SeverityEntry): StateScore {
  const sev = j.findings.map((f) => severityOf(arm, map, f.severity, readerOf(f)));
  const matchedBy = (i: number) => unit.blockers.filter((b) => (j.matches[b.id] ?? []).includes(i));
  const found: Record<string, boolean> = {};
  const blocking: Record<string, boolean> = {};
  for (const b of blockingBugs(unit)) {
    const m = j.matches[b.id] ?? [];
    found[b.id] = m.length > 0;
    blocking[b.id] = m.some((i) => sev[i] === "CRITICAL");
  }
  let unmatched = 0;
  let unmatchedBlocking = 0;
  let newBlockers = 0;
  let falseBlockers = 0;
  let unadjudicated = 0;
  j.findings.forEach((_, i) => {
    const by = matchedBy(i);
    if (!by.length) unmatched++;
    if (sev[i] !== "CRITICAL") return;
    if (by.some((b) => b.counts !== "over-blocking")) return;
    if (by.length) return void falseBlockers++;
    unmatchedBlocking++;
    const ruling = j.rulings?.[String(i)];
    if (ruling === undefined) unadjudicated++;
    else if (ruling === "defect") newBlockers++;
    else falseBlockers++;
  });
  const unmapped = [...new Set(j.findings.filter((_, i) => sev[i] === null).map((f) => f.severity))];
  return { id: j.id, arm, unit, pass, counted: j.findings.length, extracted: j.extracted, found, blocking, unmatched, unmatched_blocking: unmatchedBlocking, new_blockers: newBlockers, false_blockers: falseBlockers, unadjudicated, unmapped };
}

/** Scores every scored session from the joined judgments. */
export function scoreSessions(states: StatesFile, judged: Judged, maps: Record<CArm, SeverityEntry>): Scored {
  const byId = new Map(judged.states.map((j) => [j.id, j]));
  const sessions: SessionScore[] = [];
  const gaps: Scored["judge_gaps"] = [];
  for (const s of states.sessions) {
    if (!s.states) continue;
    const refs = [s.states.first_stop, s.states.final];
    const js = refs.map((r) => byId.get(r.id));
    const missing = js.findIndex((j) => !j);
    if (missing >= 0) throw new Error("E_CH_C_STATES the judgments name no state " + refs[missing]!.id + "; judge the same states file you score");
    const gap = js.find((j) => j!.gap);
    if (gap) {
      gaps.push({ session: s.id, arm: s.arm, reason: gap.gap! });
      continue;
    }
    const final = scoreState(js[1]!, s.arm, s.unit, s.pass, maps[s.arm]);
    const first = s.blocked ? scoreState(js[0]!, s.arm, s.unit, s.pass, maps[s.arm]) : final;
    sessions.push({ session: s, states: { first_stop: first, final } });
  }
  return { sessions, judge_gaps: gaps };
}
