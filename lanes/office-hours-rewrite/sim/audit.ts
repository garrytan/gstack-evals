// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's fixed-script simulator audit (prereg section 12 stage 3; pre-run change 1, items 4b
// and 5). It runs independent of any arm, through the simulator turn in founder.ts, the founder lane's violation
// definitions (sim/fidelity.ts VIOLATIONS) and src/persona-sim/audit.ts's auditor read and two-auditor rule.
//
// - Every sheet gets frozen.AUDIT_SCRIPT's six adviser messages in order, each followed by the simulator's turn. The
//   visible transcript is the script messages and the simulator's delivered replies. A turn that ends without a
//   delivered reply (guard-failed, check-failed or a call failure) ends that sheet's script.
// - A script turn is auditable when it delivered a reply, failed the guard or failed its checks. The seeded sample
//   (frozen.SEED) takes frozen.AUDIT.sample (80) of them, or every one when fewer; fewer than frozen.AUDIT.no_read_below
//   (40) reads NO READ. A guard-failed or check-failed sampled turn counts as failed and never goes to the auditors.
// - GPT-6.2 Astra and Opus 5.5, at maximum effort, read each other sampled turn. The audit passes when at most 5% of
//   audited turns fail (both auditors mark one) and guard failures are at most 5% of all script turns that ran.
// - A cap stop on any call ends the audit INCOMPLETE. The record binds both rules digests, the script's digest, the
//   persona-sim and founder.ts file digests, the seed and every sheet's digest.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { auditTurn, combine, type AuditCall, type AuditorRead, type TurnVerdict } from "../../../src/persona-sim/audit.ts";
import { SIM_SHA256, type PersonSheet, type SimCall, type VisibleTurn } from "../../../src/persona-sim/sim.ts";
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import { VIOLATIONS } from "../../office-hours-founder/sim/fidelity.ts";
import { pool } from "../../product-value/meter.ts";
import { shuffle } from "../../product-value/stats.ts";
import { AUDIT, AUDIT_SCRIPT, SEED, SIM_RULES_SHA256 } from "../frozen.ts";
import type { BriefKind } from "../types.ts";
import { simTurn, type SimOutcome } from "./founder.ts";

const sha256 = (t: string | Buffer) => createHash("sha256").update(t).digest("hex");

/** sha256 of the simulator turn's file, which the audit record binds beside persona-sim's. */
export const FOUNDER_TS_SHA256 = sha256(readFileSync(fileURLToPath(new URL("./founder.ts", import.meta.url))));

export type AuditorKey = (typeof AUDIT.auditors)[number];

export interface AuditSheet {
  brief: string;
  kind: BriefKind;
  sheet: PersonSheet;
}

/** One script turn as it ran. */
export interface ScriptTurn {
  brief: string;
  /** 1 to 6: the script message it answers. */
  turn: number;
  outcome: SimOutcome["kind"];
  reply: string | null;
  revealed: string[];
  attempts: number;
}

export interface AuditedTurn {
  turn: ScriptTurn;
  /** Null for a guard-failed or check-failed turn, which counts as failed without the auditors. */
  reads: Record<AuditorKey, AuditorRead> | null;
  verdict: TurnVerdict;
}

export interface AuditRecord {
  read: "pass" | "fail" | "no-read" | "incomplete";
  code: "E_OHR_SIM_AUDIT" | "E_OHR_NO_READ" | "CAP_STOP" | null;
  reasons: string[];
  binds: { rules_sha256: typeof SIM_RULES_SHA256; script_sha256: string; persona_sim_sha256: string; founder_sha256: string; seed: number; effort: string; sheets: Record<string, string> };
  sheets: number;
  /** Script turns that ran, by outcome. */
  script_turns: number;
  outcomes: Record<SimOutcome["kind"], number>;
  guard_failures: number;
  auditable: number;
  audited: number;
  failing: number;
  disputed: number;
  turns: ScriptTurn[];
  sampled: AuditedTurn[];
}

/** The script transcript before turn n (0-based): the script messages so far and the replies the simulator delivered. */
export function scriptTranscript(replies: readonly string[], n: number): VisibleTurn[] {
  if (replies.length !== n) throw new Error("E_USAGE audit: turn " + (n + 1) + " needs " + n + " delivered replies");
  return AUDIT_SCRIPT.slice(0, n + 1).flatMap((m, i): VisibleTurn[] => [{ role: "assistant", text: m }, ...(i < n ? [{ role: "person" as const, text: replies[i]! }] : [])]);
}

/** Runs the script over one sheet; stops at the first turn with no delivered reply. */
export async function runScript(s: AuditSheet, call: SimCall): Promise<{ turns: ScriptTurn[]; cap: string | null }> {
  const replies: string[] = [];
  const turns: ScriptTurn[] = [];
  for (let n = 0; n < AUDIT_SCRIPT.length; n++) {
    const out = await simTurn({ kind: s.kind, sheet: s.sheet, transcript: scriptTranscript(replies, n), call });
    turns.push({ brief: s.brief, turn: n + 1, outcome: out.kind, reply: out.kind === "reply" ? out.reply : null, revealed: out.kind === "reply" ? out.revealed : [], attempts: "attempts" in out ? out.attempts : out.requests.length });
    if (out.kind === "call-failed" && out.reason === "cap") return { turns, cap: out.detail };
    if (out.kind !== "reply") break;
    replies.push(out.reply);
  }
  return { turns, cap: null };
}

const auditable = (t: ScriptTurn) => t.outcome === "reply" || t.outcome === "guard-failed" || t.outcome === "check-failed";

/** The seeded sample: every auditable turn sorted by brief and turn, shuffled with SEED, the first AUDIT.sample kept. */
export function drawSample(turns: readonly ScriptTurn[]): ScriptTurn[] {
  const ready = turns.filter(auditable).sort((a, b) => (a.brief < b.brief ? -1 : a.brief > b.brief ? 1 : a.turn - b.turn));
  return shuffle(ready, seededRandom(SEED)).slice(0, AUDIT.sample);
}

/** At most pass_max_share of n, in whole numbers so no float decides the edge. */
const within = (k: number, n: number) => k * 100 <= Math.round(AUDIT.pass_max_share * 100) * n;

/** The audit over every sheet, with injected simulator call and auditor calls. */
export async function runScriptAudit(o: { sheets: readonly AuditSheet[]; call: (s: AuditSheet) => SimCall; auditors: Record<AuditorKey, AuditCall>; parallel?: number }): Promise<AuditRecord> {
  const sheets = [...o.sheets].sort((a, b) => (a.brief < b.brief ? -1 : 1));
  const binds = {
    rules_sha256: SIM_RULES_SHA256,
    script_sha256: sha256(JSON.stringify(AUDIT_SCRIPT)),
    persona_sim_sha256: SIM_SHA256,
    founder_sha256: FOUNDER_TS_SHA256,
    seed: SEED,
    effort: AUDIT.effort,
    sheets: Object.fromEntries(sheets.map((s) => [s.brief, sha256(JSON.stringify(s.sheet))])),
  };
  const runs = await pool(o.parallel ?? 8, sheets.map((s) => () => runScript(s, o.call(s))));
  const turns = runs.flatMap((r) => r.turns);
  const outcomes = { reply: 0, "guard-failed": 0, "check-failed": 0, "call-failed": 0 } as Record<SimOutcome["kind"], number>;
  for (const t of turns) outcomes[t.outcome]++;
  const base = { binds, sheets: sheets.length, script_turns: turns.length, outcomes, guard_failures: outcomes["guard-failed"], auditable: turns.filter(auditable).length, turns };
  const empty = { audited: 0, failing: 0, disputed: 0, sampled: [] as AuditedTurn[] };
  const caps = runs.flatMap((r) => (r.cap ? [r.cap] : []));
  if (caps.length) return { ...base, ...empty, read: "incomplete", code: "CAP_STOP", reasons: ["a cap stop on the simulator: " + caps[0]] };
  if (base.auditable < AUDIT.no_read_below) return { ...base, ...empty, read: "no-read", code: "E_OHR_NO_READ", reasons: [base.auditable + " auditable script turns, under " + AUDIT.no_read_below] };
  const sheetOf = new Map(sheets.map((s) => [s.brief, s.sheet]));
  const sampled = await pool(o.parallel ?? 8, drawSample(turns).map((turn) => async (): Promise<AuditedTurn> => {
    if (turn.outcome !== "reply") return { turn, reads: null, verdict: "fail" };
    const input = { sheet: sheetOf.get(turn.brief)!, last: AUDIT_SCRIPT[turn.turn - 1]!, reply: turn.reply!, logged: turn.revealed };
    const [astra, opus] = await Promise.all(AUDIT.auditors.map((a) => auditTurn(VIOLATIONS, input, o.auditors[a])));
    return { turn, reads: { astra: astra!, opus: opus! }, verdict: combine(astra!, opus!) };
  }));
  const failing = sampled.filter((t) => t.verdict === "fail").length;
  const reasons: string[] = [];
  if (!within(failing, sampled.length)) reasons.push(failing + " of " + sampled.length + " audited turns failed, over " + AUDIT.pass_max_share * 100 + "%");
  if (!within(base.guard_failures, turns.length)) reasons.push(base.guard_failures + " guard failures in " + turns.length + " script turns, over " + AUDIT.pass_max_share * 100 + "%");
  return { ...base, audited: sampled.length, failing, disputed: sampled.filter((t) => t.verdict === "disputed").length, sampled, read: reasons.length ? "fail" : "pass", code: reasons.length ? "E_OHR_SIM_AUDIT" : null, reasons };
}
