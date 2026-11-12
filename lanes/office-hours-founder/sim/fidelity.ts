// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's fidelity audit of the simulated founder (prereg section 4): the frozen V1 to V6
// definitions, the seeded draw of founder turns, the two auditors through src/persona-sim/audit.ts, the pass rule and
// what a failed audit does to its stage.
//
// - Only arm sessions of the stage enter the draw; reference and pitch-only sessions have no founder turns by
//   construction. An arm session with no founder turn (a block in the first reply) is counted and offers none.
// - The seeded order: every founder turn, sorted by unit, model, arm, pass and turn, then shuffled with seed 20261109.
// - With at least 40 turns the draw walks the seeded order three times under the arm targets and at most 2 turns a
//   session: first turns that revealed a fact until 12 are drawn, then turns that revealed none until 12 are drawn, then
//   any turn until the targets fill. An arm target is its quota, capped by what the arm can offer under the per-session
//   limit; the shortfall goes to the other arms in the order office-hours, lens, none. Stage 1's "the rest" is the lens
//   arm, the only other arm with founder turns.
// - With fewer than 40 turns every turn is audited. With fewer than 20 the stage reads NO READ (simulator).
// - One pass rule covers both cases: at most 5% of audited turns fail, which is at most 2 of 40. When the per-session
//   limit leaves fewer than 40 drawable turns out of 40 or more, the draw audits what it can under the same rule.
// - A stage 1 failure gets one repair of the rule wording, recorded with its digest; every stage 1 session reruns and a
//   fresh audit must pass, else FIX-METHOD on the instrument. A stage 2 failure, or a stage 2 NO READ, voids stage 2.
import { createHash } from "node:crypto";
import { auditTurn, combine, UNREADABLE, type AuditCall, type AuditInput, type AuditorRead, type TurnVerdict, type Violation } from "../../../src/persona-sim/audit.ts";
import { pool } from "../../product-value/meter.ts";
import { kappa, seededRandom, shuffle } from "../../product-value/stats.ts";
import { SEED } from "../frozen.ts";
import type { ArmId, SessionRow } from "../types.ts";
import { FOUNDER_RULES } from "./founder.ts";

/** Section 4's violations, byte for byte. */
export const VIOLATIONS: readonly Violation[] = [
  { code: "V1", definition: "volunteered: the reply states a hidden fact that no part of the last message asks about (for a confirmation, no part of what was to be confirmed falls under the fact's reveal_when line), or more than two hidden facts at once" },
  { code: "V2", definition: "invented: the reply states a material fact about the startup, its people, customers or numbers that is on neither the sheet nor the opening" },
  { code: "V3", definition: "contradicted: the reply contradicts the sheet or the opening" },
  { code: "V4", definition: "log mismatch: the logged ids differ from the hidden facts the reply states or clearly implies" },
  { code: "V5", definition: "steered: the reply says what the advisor should recommend, or judges the advice" },
  { code: "V6", definition: "broke frame: the reply mentions a sheet, rules, ids or playing a role, or says anything about the startup's future" },
];

/** The two auditors, both outside the simulator's family, each at maximum effort. */
export const AUDITORS = ["astra", "opus"] as const;
export type AuditorKey = (typeof AUDITORS)[number];
export const AUDIT_EFFORT = "max";

export const SAMPLE = 40;
export const PER_SESSION = 2;
export const MIN_EACH = 12;
export const MIN_TURNS = 20;
export const FAIL_PERCENT = 5;
export const QUOTAS: Readonly<Record<1 | 2, Readonly<Record<ArmId, number>>>> = {
  1: { none: 16, "office-hours": 16, lens: 8 },
  2: { "office-hours": 14, none: 14, lens: 12 },
};
export const SHORTFALL_ORDER: readonly ArmId[] = ["office-hours", "lens", "none"];

export type AuditSession = Pick<SessionRow, "stage" | "kind" | "unit" | "model" | "arm" | "pass" | "founder_turns">;
export type SessionId = Omit<AuditSession, "founder_turns">;

export interface DrawnTurn {
  session: SessionId;
  turn: number;
  revealed: string[];
}

export interface Draw {
  stage: 1 | 2;
  read: "audit" | "no-read";
  /** True when every turn of the stage is audited (fewer than 40). */
  every: boolean;
  sessions: number;
  zero_turn_sessions: number;
  turns: number;
  drawn: DrawnTurn[];
  by_arm: Record<ArmId, number>;
  revealing: number;
}

export function drawAudit(stage: 1 | 2, all: readonly AuditSession[]): Draw {
  const sessions = all.filter((s) => s.stage === stage && s.kind === "arm");
  const key = (s: SessionId) => [s.unit, s.model, s.arm, String(s.pass).padStart(4, "0")].join("\u0000");
  const turns = [...sessions]
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
    .flatMap((s) => {
      const { founder_turns, ...session } = s;
      return [...founder_turns].sort((a, b) => a.turn - b.turn).map((t) => ({ session, turn: t.turn, revealed: t.revealed, slot: key(session) }));
    });
  const order = shuffle(turns, seededRandom(SEED));
  const base = { stage, sessions: sessions.length, zero_turn_sessions: sessions.filter((s) => !s.founder_turns.length).length, turns: order.length };
  const summary = (drawn: DrawnTurn[]): Draw => ({ ...base, read: "audit", every: drawn.length === order.length, drawn, by_arm: { none: 0, lens: 0, "office-hours": 0, ...Object.fromEntries(Object.entries(Object.groupBy(drawn, (t) => t.session.arm)).map(([a, ts]) => [a, ts!.length])) }, revealing: drawn.filter((t) => t.revealed.length).length });
  const strip = ({ session, turn, revealed }: (typeof order)[number]): DrawnTurn => ({ session, turn, revealed });
  if (order.length < MIN_TURNS) return { ...summary([]), read: "no-read", every: false };
  if (order.length < SAMPLE) return summary(order.map(strip));
  const cap = (a: ArmId) => sessions.filter((s) => s.arm === a).reduce((n, s) => n + Math.min(PER_SESSION, s.founder_turns.length), 0);
  const target = Object.fromEntries(SHORTFALL_ORDER.map((a) => [a, Math.min(QUOTAS[stage][a], cap(a))])) as Record<ArmId, number>;
  let short = SAMPLE - SHORTFALL_ORDER.reduce((n, a) => n + target[a], 0);
  for (const a of SHORTFALL_ORDER) {
    const add = Math.min(short, cap(a) - target[a]);
    target[a] += add;
    short -= add;
  }
  const taken = new Set<number>();
  const perSession = new Map<string, number>();
  const perArm: Record<ArmId, number> = { none: 0, lens: 0, "office-hours": 0 };
  const walk = (want: (t: (typeof order)[number]) => boolean, limit: number) => {
    let n = 0;
    for (let i = 0; i < order.length && n < limit; i++) {
      const t = order[i]!;
      if (taken.has(i) || !want(t) || (perSession.get(t.slot) ?? 0) >= PER_SESSION || perArm[t.session.arm] >= target[t.session.arm]) continue;
      taken.add(i);
      perSession.set(t.slot, (perSession.get(t.slot) ?? 0) + 1);
      perArm[t.session.arm]++;
      n++;
    }
  };
  walk((t) => t.revealed.length > 0, MIN_EACH);
  walk((t) => t.revealed.length === 0, MIN_EACH);
  walk(() => true, SAMPLE);
  return { ...summary([...taken].sort((a, b) => a - b).map((i) => strip(order[i]!))), every: false };
}

export interface AuditedTurn {
  turn: DrawnTurn;
  reads: Record<AuditorKey, AuditorRead>;
  verdict: TurnVerdict;
}

export interface AuditResult {
  audited: number;
  failing: number;
  passes: boolean;
  disputed: DrawnTurn[];
  /** Per violation code: turns both auditors marked with it, and turns each auditor marked with it. */
  per_violation: Record<string, Record<AuditorKey | "both", number>>;
  /** Turn-level agreement on "marked any violation": the share of turns the auditors agree on, and Cohen's kappa. */
  agreement: { share: number | null; kappa: number | null };
  unreadable: Record<AuditorKey, number>;
  turns: AuditedTurn[];
}

/** Section 4's pass rule: at most 5% of audited turns fail. */
export const auditPasses = (failing: number, audited: number): boolean => failing * 100 <= FAIL_PERCENT * audited;

/** Audits every drawn turn with both auditors. input gives a drawn turn's sheet, the advisor's last message and the reply. */
export async function runAudit(o: { draw: Draw; input: (t: DrawnTurn) => Omit<AuditInput, "logged">; auditors: Record<AuditorKey, AuditCall> }): Promise<AuditResult> {
  const turns = await pool(
    8,
    o.draw.drawn.map((turn) => async (): Promise<AuditedTurn> => {
      const input = { ...o.input(turn), logged: turn.revealed };
      const [astra, opus] = await Promise.all(AUDITORS.map((a) => auditTurn(VIOLATIONS, input, o.auditors[a])));
      return { turn, reads: { astra: astra!, opus: opus! }, verdict: combine(astra!, opus!) };
    }),
  );
  const per_violation = Object.fromEntries([...VIOLATIONS.map((v) => v.code), UNREADABLE].map((c) => [c, { both: turns.filter((t) => t.reads.astra.marked.includes(c) && t.reads.opus.marked.includes(c)).length, astra: turns.filter((t) => t.reads.astra.marked.includes(c)).length, opus: turns.filter((t) => t.reads.opus.marked.includes(c)).length }]));
  const pairs = turns.map((t) => [t.reads.astra.marked.length > 0, t.reads.opus.marked.length > 0] as const);
  const failing = turns.filter((t) => t.verdict === "fail").length;
  return {
    audited: turns.length,
    failing,
    passes: turns.length > 0 && auditPasses(failing, turns.length),
    disputed: turns.filter((t) => t.verdict === "disputed").map((t) => t.turn),
    per_violation,
    agreement: { share: pairs.length ? pairs.filter(([a, b]) => a === b).length / pairs.length : null, kappa: kappa(pairs) },
    unreadable: { astra: turns.filter((t) => !t.reads.astra.readable).length, opus: turns.filter((t) => !t.reads.opus.readable).length },
    turns,
  };
}

/** The one stage 1 repair of the rule wording, by digest. The sheets never change. */
export interface Repair {
  from_sha256: string;
  to_sha256: string;
}

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

export function repairRecord(repaired: string): Repair {
  if (repaired === FOUNDER_RULES) throw new Error("E_USAGE fidelity: a repair must change the rule wording");
  return { from_sha256: sha256(FOUNDER_RULES), to_sha256: sha256(repaired) };
}

export type AuditOutcome =
  | { read: "pass" }
  | { read: "repair"; code: "E_OF_SIM_AUDIT"; detail: string }
  | { read: "fix-method" | "void" | "no-read"; code: "E_OF_SIM_AUDIT" | "E_OF_NO_READ"; detail: string };

/** What a stage's audit means for the eval. repair is the stage 1 repair already made, or null. */
export function auditOutcome(o: { draw: Draw; result: AuditResult | null; repair: Repair | null }): AuditOutcome {
  const stage = o.draw.stage;
  if (o.draw.read === "no-read") return stage === 1 ? { read: "no-read", code: "E_OF_NO_READ", detail: "NO READ (simulator): " + o.draw.turns + " founder turns in stage 1, under " + MIN_TURNS + "; the eval ends at stage 1 and stage 2 is void" } : { read: "no-read", code: "E_OF_SIM_AUDIT", detail: "NO READ (simulator): " + o.draw.turns + " founder turns in stage 2, under " + MIN_TURNS + "; stage 2 is void" };
  if (!o.result) throw new Error("E_USAGE fidelity: a stage that reads needs its audit result");
  if (o.result.passes) return { read: "pass" };
  const failed = o.result.failing + " of " + o.result.audited + " audited turns failed";
  if (stage === 2) return { read: "void", code: "E_OF_SIM_AUDIT", detail: failed + " in stage 2; stage 2 is void and every contrast reads untested (simulator)" };
  if (!o.repair) return { read: "repair", code: "E_OF_SIM_AUDIT", detail: failed + " in stage 1; make the one repair of the rule wording, rerun every stage 1 session and audit again" };
  return { read: "fix-method", code: "E_OF_SIM_AUDIT", detail: failed + " in stage 1 after the repair " + o.repair.to_sha256 + "; the eval ends as FIX-METHOD on the instrument (simulator)" };
}
