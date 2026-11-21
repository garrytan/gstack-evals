// Copyright (c) 2026 Garry Tan. MIT License.
// The record part C's rig writes for the judging and analysis: one JSON line per session state in a states file. A
// session the contract blocked has two states, first_stop and final; a session it never blocked has one, final, which is
// also its first-stop state (preregistration section 5.3). A session that was not scored has one final line with no
// findings. readStates checks every line against the suite and the session rules and returns the sessions.
import { readFileSync } from "node:fs";
import { parseFinalTurn, type ToldFinding } from "../../../../src/trial/review/findings.ts";
import type { Suite, Unit } from "../../../review-noloss/suite.ts";
import { ARMS, COUNTED_FINDINGS, STATES, type CArm, type CState } from "./frozen.ts";

export const STATES_SCHEMA = 1;
export const OUTCOMES = ["scored", "gap", "cap_stop"] as const;
export type SessionOutcome = (typeof OUTCOMES)[number];

/** Section 5.6's contract readout for one session, from gstack's contract log and the rollout. null in c-none. */
export interface Exposure {
  /** Stops the contract evaluated. */
  evaluated_stops: number;
  /** Blocks the contract made. */
  blocks: number;
  /** Items the contract named as missing, over all its blocks. */
  items_named: string[];
  fail_open: boolean;
  /** A block at a stop before which the independent check finds both the adversarial pass and the report. */
  false_block: boolean;
  /** c-off only: the same readout says the contract would have blocked. null in the other arms. */
  would_block: boolean | null;
  /** Pre-run change 1, sections 7 and 10: flagged SKILL.md read shapes, spawn_agent calls in an unknown namespace, and sub-agents started on another model. */
  read_shape_flags: number;
  unknown_namespace_spawns: number;
  subagent_other_model: number;
}

/** One line of the states file. */
export interface StateRecord {
  schema: 1;
  /** The session's id, the same on both of its states. */
  session: string;
  /** The suite unit, by its id (owner/repo#pr@head12). */
  unit: string;
  /** The unit's blocking bugs, by blocker id. */
  bugs: string[];
  /** The unit's pull-request cluster (owner/repo#pr). */
  cluster: string;
  arm: CArm;
  pass: number;
  state: CState;
  /** scored (section 5.8), gap (an infrastructure failure after its one rerun, or another model or Codex version: pre-run change 1, section 10) or cap_stop. */
  outcome: SessionOutcome;
  /** The reason code of a gap or cap stop; null when scored. */
  outcome_code: string | null;
  /** 2 when the session is its rerun. */
  attempts: number;
  /** Hit its allowance or 3,600 seconds: scored on its last assistant message and counted (section 5.7). */
  limit_stop: boolean;
  /** A provider safety stop, kept in its own class (section 5.8). */
  safety_stop: boolean;
  /** No assistant text: scored as finding nothing, with findings [] (section 5.8). */
  no_text: boolean;
  /** The contract blocked the session at least once. Always false in c-off and c-none. */
  blocked: boolean;
  /** The state's counted findings: the first 15 of its message's last fenced json block, as review-units' parser reads them, with each file made repo-relative. null when no_block. */
  findings: ToldFinding[] | null;
  /** The state's message has no parseable block (the parser says missing or malformed), so the judge extracts its findings key-blind. */
  no_block: boolean;
  /** The state's message text when no_block; null otherwise. */
  message: string | null;
  /** The whole session's cost, the same on both states. */
  cost: { usd: number | null; total_tokens: number | null };
  exposure: Exposure | null;
}

/** A state as the judging sees it: the record and its id. An unblocked session's first-stop state is its final state, so both share one id. */
export interface StateRef {
  id: string;
  record: StateRecord;
}

export interface Session {
  id: string;
  unit: Unit;
  arm: CArm;
  pass: number;
  outcome: SessionOutcome;
  outcome_code: string | null;
  attempts: number;
  limit_stop: boolean;
  safety_stop: boolean;
  no_text: boolean;
  blocked: boolean;
  cost: StateRecord["cost"];
  exposure: Exposure | null;
  /** null when the session was not scored. */
  states: Record<CState, StateRef> | null;
}

export interface StatesFile {
  sessions: Session[];
  /** Arm, unit and pass with no line at all; each counts as a session not scored. */
  missing: Array<{ arm: CArm; unit: string; pass: number }>;
  /** Every state the judging reads, once: an unblocked session gives one. */
  states: StateRef[];
}

export class StatesError extends Error {
  constructor(
    readonly code: "E_CH_C_STATES",
    readonly problems: string[],
  ) {
    super(code + " the states file breaks the record contract (lanes/codex-hooks/c/analysis/record.ts):\n" + problems.slice(0, 20).join("\n") + (problems.length > 20 ? "\n(and " + (problems.length - 20) + " more)" : ""));
  }
}

export const stateId = (session: string, state: CState) => session + "#" + state;
export const blockingBugs = (u: Unit) => u.blockers.filter((b) => b.counts === "blocking");
const isBool = (v: unknown) => typeof v === "boolean";
const isCount = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;

/** Why a findings array is not one review-units' parser would give, or null. */
export function findingsProblem(findings: unknown): string | null {
  if (!Array.isArray(findings)) return "findings is not an array or null";
  if (findings.length > COUNTED_FINDINGS) return "findings holds " + findings.length + " items; a state counts only its first " + COUNTED_FINDINGS;
  const parsed = parseFinalTurn("~~~json\n" + JSON.stringify(findings) + "\n~~~");
  if (parsed.kind !== "findings") return "findings do not have review-units' finding shape: " + ("reason" in parsed ? parsed.reason : parsed.kind);
  return null;
}

function exposureProblem(e: unknown): string | null {
  if (e === null) return null;
  if (typeof e !== "object" || Array.isArray(e)) return "exposure is not an object or null";
  const x = e as Record<string, unknown>;
  for (const k of ["evaluated_stops", "blocks", "read_shape_flags", "unknown_namespace_spawns", "subagent_other_model"]) if (!isCount(x[k])) return "exposure." + k + " is not a whole number from 0";
  if (!Array.isArray(x.items_named) || !x.items_named.every((i) => typeof i === "string")) return "exposure.items_named is not a list of item names";
  if (!isBool(x.fail_open) || !isBool(x.false_block)) return "exposure.fail_open and exposure.false_block must be true or false";
  if (!(x.would_block === null || isBool(x.would_block))) return "exposure.would_block must be true, false or null";
  return null;
}

/** Problems with one line, alone. */
function lineProblems(r: Record<string, unknown>, suite: Suite, passes: number): string[] {
  const p: string[] = [];
  if (r.schema !== STATES_SCHEMA) p.push("schema is " + JSON.stringify(r.schema) + ", not " + STATES_SCHEMA);
  if (typeof r.session !== "string" || !r.session) p.push("session is not an id");
  if (!ARMS.includes(r.arm as CArm)) p.push("arm " + JSON.stringify(r.arm) + " is not one of " + ARMS.join(", "));
  if (!STATES.includes(r.state as CState)) p.push("state " + JSON.stringify(r.state) + " is not one of " + STATES.join(", "));
  if (!Number.isSafeInteger(r.pass) || (r.pass as number) < 1 || (r.pass as number) > passes) p.push("pass " + JSON.stringify(r.pass) + " is not from 1 to " + passes);
  const unit = suite.units.find((u) => u.id === r.unit);
  if (!unit) p.push("unit " + JSON.stringify(r.unit) + " is not a unit of suite " + suite.id);
  else {
    const want = blockingBugs(unit).map((b) => b.id).sort();
    const got = Array.isArray(r.bugs) ? [...(r.bugs as unknown[])].map(String).sort() : null;
    if (!got || got.join(",") !== want.join(",")) p.push("bugs " + JSON.stringify(r.bugs) + " are not the unit's blocking bugs " + JSON.stringify(want));
    if (r.cluster !== unit.cluster) p.push("cluster " + JSON.stringify(r.cluster) + " is not the unit's " + unit.cluster);
  }
  if (!OUTCOMES.includes(r.outcome as SessionOutcome)) p.push("outcome " + JSON.stringify(r.outcome) + " is not one of " + OUTCOMES.join(", "));
  if (r.outcome === "scored" ? r.outcome_code !== null : typeof r.outcome_code !== "string" || !/^[A-Z][A-Z0-9_]+$/.test(r.outcome_code)) p.push("outcome_code must be null on a scored session and a reason code otherwise");
  if (r.attempts !== 1 && r.attempts !== 2) p.push("attempts is not 1 or 2");
  for (const k of ["limit_stop", "safety_stop", "no_text", "blocked", "no_block"]) if (!isBool(r[k])) p.push(k + " is not true or false");
  if (r.blocked === true && (r.arm === "c-off" || r.arm === "c-none")) p.push("a " + r.arm + " session cannot be blocked: no contract runs there");
  const cost = r.cost as Record<string, unknown> | null;
  if (!cost || typeof cost !== "object" || !(cost.usd === null || (typeof cost.usd === "number" && cost.usd >= 0)) || !(cost.total_tokens === null || isCount(cost.total_tokens))) p.push("cost needs usd (dollars or null) and total_tokens (a whole number or null)");
  const e = exposureProblem(r.exposure ?? null);
  if (e) p.push(e);
  if (r.outcome !== "scored") {
    if (r.state !== "final" || r.findings !== null || r.no_block !== false || r.message !== null) p.push("a session that was not scored has one final line with findings null, no_block false and message null");
    return p;
  }
  if (r.no_block === true) {
    if (r.findings !== null) p.push("a no_block state has findings null: the judge extracts them");
    if (typeof r.message !== "string" || !r.message.trim()) p.push("a no_block state carries its message text for extraction");
    if (r.no_text === true) p.push("a session with no assistant text scores as finding nothing: findings [], no_block false");
  } else {
    const f = findingsProblem(r.findings);
    if (f) p.push(f);
    if (r.message !== null) p.push("message is null unless no_block");
    if (r.no_text === true && Array.isArray(r.findings) && r.findings.length) p.push("a session with no assistant text has findings []");
  }
  return p;
}

const same = (a: StateRecord, b: StateRecord) => a.unit === b.unit && a.arm === b.arm && a.pass === b.pass && a.outcome === b.outcome && a.blocked === b.blocked && a.attempts === b.attempts && JSON.stringify(a.cost) === JSON.stringify(b.cost) && JSON.stringify(a.exposure) === JSON.stringify(b.exposure);

/**
 * Reads a states file. units names the units the run covers (every suite unit for a counted run, the drawn units for a
 * pilot); a unit, arm and pass with no line is listed as missing.
 */
export function readStates(text: string, suite: Suite, o: { passes: number; units: readonly string[] }): StatesFile {
  const problems: string[] = [];
  const records: StateRecord[] = [];
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    let r: unknown;
    try {
      r = JSON.parse(line);
    } catch (e) {
      problems.push("line " + (i + 1) + ": not JSON (" + (e as Error).message + ")");
      return;
    }
    if (r === null || typeof r !== "object" || Array.isArray(r)) return problems.push("line " + (i + 1) + ": not an object");
    const p = lineProblems(r as Record<string, unknown>, suite, o.passes);
    if (p.length) problems.push(...p.map((x) => "line " + (i + 1) + ": " + x));
    else records.push(r as StateRecord);
  });
  const bySession = new Map<string, StateRecord[]>();
  for (const r of records) bySession.set(r.session, [...(bySession.get(r.session) ?? []), r]);
  const sessions: Session[] = [];
  const cell = new Map<string, string>();
  for (const [id, rs] of bySession) {
    const first = rs[0]!;
    const where = "session " + id;
    if (rs.some((r) => !same(r, first))) problems.push(where + ": its lines disagree on unit, arm, pass, outcome, blocked, attempts, cost or exposure");
    const states = rs.map((r) => r.state).sort();
    if (new Set(states).size !== states.length) problems.push(where + ": a state appears twice");
    const want = first.outcome === "scored" && first.blocked ? ["final", "first_stop"] : ["final"];
    if (states.join(",") !== want.join(",")) problems.push(where + ": has states " + states.join(", ") + "; a " + (first.outcome !== "scored" ? "session that was not scored" : first.blocked ? "blocked session" : "session the contract never blocked") + " has " + want.join(" and "));
    if (!o.units.includes(first.unit)) problems.push(where + ": unit " + first.unit + " is not one this run covers");
    const k = first.arm + " " + first.unit + " " + first.pass;
    if (cell.has(k)) problems.push(where + ": " + k + " already has session " + cell.get(k) + "; a rerun is the same session with attempts 2");
    cell.set(k, id);
    const ref = (s: CState) => {
      const r = rs.find((x) => x.state === s)!;
      return { id: stateId(id, s), record: r };
    };
    const final = ref("final");
    sessions.push({ id, unit: suite.units.find((u) => u.id === first.unit)!, arm: first.arm, pass: first.pass, outcome: first.outcome, outcome_code: first.outcome_code, attempts: first.attempts, limit_stop: first.limit_stop, safety_stop: first.safety_stop, no_text: final.record.no_text, blocked: first.blocked, cost: first.cost, exposure: first.exposure ?? null, states: first.outcome !== "scored" ? null : { first_stop: first.blocked ? ref("first_stop") : final, final } });
  }
  if (problems.length) throw new StatesError("E_CH_C_STATES", problems);
  const missing: StatesFile["missing"] = [];
  for (const arm of ARMS) for (const unit of o.units) for (let pass = 1; pass <= o.passes; pass++) if (!cell.has(arm + " " + unit + " " + pass)) missing.push({ arm, unit, pass });
  sessions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const states = sessions.flatMap((s) => (s.states ? (s.blocked ? [s.states.first_stop, s.states.final] : [s.states.final]) : []));
  return { sessions, missing, states };
}

export const readStatesFile = (path: string, suite: Suite, o: { passes: number; units: readonly string[] }) => readStates(readFileSync(path, "utf8"), suite, o);
