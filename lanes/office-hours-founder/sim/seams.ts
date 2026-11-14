// Copyright (c) 2026 Garry Tan. MIT License.
// The simulator's dry-run seams (prereg section 14, start rule 7): each drives one frozen rule through the real code on
// one side of its edge. The simulator's JSON checks, its retry and a second failure; the fidelity audit at 2 and 3
// failing turns with a disputed turn; an audit short of turns in a stratum, in revealing turns and in all (under 40,
// under 20); a refusal on the simulator's allowance; and a served provider other than Google Vertex. The fixtures are
// invented and are never eval units.
import { personTurn, type PersonSheet, type SimCall, type VisibleTurn } from "../../../src/persona-sim/sim.ts";
import { MeterError, type CallResult, type Meter } from "../../product-value/meter.ts";
import type { ArmId, Seam } from "../types.ts";
import { auditOutcome, drawAudit, runAudit, type AuditSession } from "./fidelity.ts";
import { FOUNDER_RULES, founderCall, worstCase } from "./founder.ts";

export const FIXTURE_SHEET: PersonSheet = {
  rules: FOUNDER_RULES,
  persona: "A former courier who builds route sheets for small laundry pickup services.",
  opening: "I'm building an app that plans pickup routes for laundry services. Three services use my spreadsheet version today.",
  items: [
    { id: "f1", text: "Two of the three services pay me forty dollars a month for the spreadsheet.", reveal_when: "Asked whether anyone pays or what they pay." },
    { id: "f2", text: "The owners mostly ask me to text their drivers when a pickup moves.", reveal_when: "Asked what users ask for or complain about." },
  ],
};
export const FIXTURE_TRANSCRIPT: VisibleTurn[] = [{ role: "assistant", text: "Does anyone pay you for this today?" }];

/** A model call that answers from a script, one output per call. */
export const scripted = (outs: readonly string[]): SimCall & { calls: () => number } => {
  let i = 0;
  return Object.assign(async () => ({ kind: "text" as const, text: outs[i++] ?? "" }), { calls: () => i });
};
export const answer = (reply: string, revealed: string[] = ["f1"]) => JSON.stringify({ reply, revealed, rules: [1, 3] });
const wordsOf = (n: number) => Array.from({ length: n }, (_, i) => "w" + i).join(" ");

/**
 * Stage sessions with the given number of sessions per arm, each with turnsEach founder turns. reveals(k) says whether
 * the k-th turn overall revealed a fact.
 */
export function fixtureSessions(stage: 1 | 2, perArm: Partial<Record<ArmId, number>>, turnsEach: number, reveals: (k: number) => boolean = (k) => k % 2 === 0): AuditSession[] {
  let k = 0;
  return (Object.entries(perArm) as [ArmId, number][]).flatMap(([arm, n]) =>
    Array.from({ length: n }, (_, i) => ({ stage, kind: "arm" as const, unit: "u" + String(i).padStart(3, "0"), model: "opus" as const, arm, pass: 1, founder_turns: Array.from({ length: turnsEach }, (_, t) => ({ turn: t + 1, reply: "r", revealed: reveals(k++) ? ["f1"] : [], rules: [1], attempts: 1 })) })),
  );
}

/** Audits a stage whose drawn turns fail and dispute as asked: the first fail turns fail, the next disputed are disputed. */
export async function auditWith(sessions: AuditSession[], stage: 1 | 2, fail: number, disputed: number) {
  const draw = drawAudit(stage, sessions);
  const plan = new Map(draw.drawn.map((t, i) => [t.session.unit + t.session.arm + t.turn, i < fail ? "FAILTURN" : i < fail + disputed ? "DISPUTEDTURN" : "CLEANTURN"]));
  const result = draw.read === "audit" ? await runAudit({ draw, input: (t) => ({ sheet: FIXTURE_SHEET, last: "Does anyone pay you?", reply: plan.get(t.session.unit + t.session.arm + t.turn)! }), auditors: { astra: async (p) => (p.includes("FAILTURN") || p.includes("DISPUTEDTURN") ? '{"marked": ["V2"]}' : '{"marked": []}'), opus: async (p) => (p.includes("FAILTURN") ? '{"marked": ["V2", "V4"]}' : '{"marked": []}') } }) : null;
  return { draw, result, outcome: auditOutcome({ draw, result, repair: null }) };
}

/** A meter that answers every call with one result, or throws. */
export const fakeMeter = (r: Partial<CallResult> | Error): Pick<Meter, "call"> & { calls: number } => {
  const m = {
    calls: 0,
    async call() {
      m.calls++;
      if (r instanceof Error) throw r;
      return { text: answer("We have two paying services."), status: 200, micros: 1000, cached: false, problem: null, served_by: "Google", ...r };
    },
  };
  return m;
};

const sim = async (outs: string[]) => personTurn({ sheet: FIXTURE_SHEET, transcript: FIXTURE_TRANSCRIPT, call: scripted(outs) });
const req = { system: "s", messages: [{ role: "user" as const, content: "Does anyone pay you?" }] };

export const seams: Seam[] = [
  { name: "sim: a JSON object passes its checks on the first attempt", run: async () => { const t = await sim([answer("Two services pay me.")]); return { ok: t.kind === "reply" && t.attempts === 1, detail: t.kind }; } },
  { name: "sim: prose around the JSON fails the json check", run: async () => { const t = await sim(["Sure! " + answer("x"), "still prose"]); return { ok: t.kind === "check-failed" && t.checks.join() === "json", detail: JSON.stringify(t) }; } },
  { name: "sim: a failed check is retried once with its note, and the retry passes", run: async () => { const t = await sim(["not json", answer("Two services pay me.")]); return { ok: t.kind === "reply" && t.attempts === 2 && t.requests.length === 2 && t.requests[0] !== t.requests[1], detail: JSON.stringify(t) }; } },
  { name: "sim: a second failure on one turn is a check failure naming its checks", run: async () => { const t = await sim([answer("x", ["f9"]), answer(wordsOf(151), ["f9"])]); return { ok: t.kind === "check-failed" && t.attempts === 2 && t.checks.join() === "ids,words", detail: JSON.stringify(t) }; } },
  { name: "sim: a 150-word reply passes", run: async () => { const t = await sim([answer(wordsOf(150))]); return { ok: t.kind === "reply", detail: t.kind }; } },
  { name: "sim: a 151-word reply fails the words check", run: async () => { const t = await sim([answer(wordsOf(151)), answer(wordsOf(151))]); return { ok: t.kind === "check-failed" && t.checks.join() === "words", detail: t.kind }; } },
  { name: "fidelity: 2 failing turns of 40, with a disputed turn, pass", run: async () => { const a = await auditWith(fixtureSessions(2, { none: 20, lens: 20, "office-hours": 20 }, 3), 2, 2, 1); return { ok: a.result?.audited === 40 && a.result.failing === 2 && a.result.disputed.length === 1 && a.outcome.read === "pass", detail: JSON.stringify(a.outcome) }; } },
  { name: "fidelity: 3 failing turns of 40 fail (stage 1: the one repair)", run: async () => { const a = await auditWith(fixtureSessions(1, { none: 20, lens: 20, "office-hours": 20 }, 3), 1, 3, 1); return { ok: a.result?.failing === 3 && a.outcome.read === "repair", detail: JSON.stringify(a.outcome) }; } },
  { name: "fidelity: 3 failing turns of 40 in stage 2 void stage 2", run: async () => { const a = await auditWith(fixtureSessions(2, { none: 20, lens: 20, "office-hours": 20 }, 3), 2, 3, 0); return { ok: a.outcome.read === "void", detail: JSON.stringify(a.outcome) }; } },
  { name: "fidelity: a lens stratum short of its quota draws the shortfall from office-hours first", run: () => { const d = drawAudit(2, fixtureSessions(2, { none: 20, lens: 3, "office-hours": 20 }, 2)); return { ok: d.drawn.length === 40 && d.by_arm.lens === 6 && d.by_arm["office-hours"] === 20 && d.by_arm.none === 14, detail: JSON.stringify(d.by_arm) }; } },
  { name: "fidelity: with 5 revealing turns in the stage the minimum takes all 5", run: () => { const d = drawAudit(2, fixtureSessions(2, { none: 20, lens: 20, "office-hours": 20 }, 2, (k) => k < 10 && k % 2 === 0)); return { ok: d.drawn.length === 40 && d.revealing === 5, detail: "revealing " + d.revealing }; } },
  { name: "fidelity: 39 turns audit every turn, and 1 failing passes (5%)", run: async () => { const a = await auditWith(fixtureSessions(2, { none: 13, lens: 13, "office-hours": 13 }, 1), 2, 1, 0); return { ok: a.draw.every && a.result?.audited === 39 && a.outcome.read === "pass", detail: JSON.stringify(a.outcome) }; } },
  { name: "fidelity: 39 turns with 2 failing fail (over 5%)", run: async () => { const a = await auditWith(fixtureSessions(2, { none: 13, lens: 13, "office-hours": 13 }, 1), 2, 2, 0); return { ok: a.outcome.read === "void", detail: JSON.stringify(a.outcome) }; } },
  { name: "fidelity: 20 founder turns read", run: () => { const d = drawAudit(1, [...fixtureSessions(1, { none: 10, "office-hours": 10 }, 1), ...fixtureSessions(1, { lens: 4 }, 0)]); return { ok: d.read === "audit" && d.drawn.length === 20 && d.zero_turn_sessions === 4, detail: d.read }; } },
  { name: "fidelity: 19 founder turns read NO READ (simulator)", run: () => { const d = drawAudit(1, fixtureSessions(1, { none: 10, "office-hours": 9 }, 1)); const o = auditOutcome({ draw: d, result: null, repair: null }); return { ok: d.read === "no-read" && o.read === "no-read" && "code" in o && o.code === "E_OF_NO_READ", detail: JSON.stringify(o) }; } },
  { name: "allowance: a simulator call whose worst case fits what is left runs", run: async () => { const m = fakeMeter({}); const r = await founderCall({ meter: m, session: { allowance_micros: 2_000_000, spent_micros: 2_000_000 - worstCase(req) }, label: "s" })(req); return { ok: r.kind === "text" && m.calls === 1, detail: r.kind }; } },
  { name: "allowance: a simulator call whose worst case does not fit is refused before it is sent", run: async () => { const m = fakeMeter({}); const r = await founderCall({ meter: m, session: { allowance_micros: 2_000_000, spent_micros: 2_000_000 - worstCase(req) + 1 }, label: "s" })(req); return { ok: r.kind === "call-failed" && r.reason === "allowance" && m.calls === 0, detail: r.kind }; } },
  { name: "provider: a reply served by Google (Vertex) is accepted", run: async () => { const r = await founderCall({ meter: fakeMeter({ served_by: "Google" }), session: { allowance_micros: 2_000_000, spent_micros: 0 }, label: "s" })(req); return { ok: r.kind === "text", detail: r.kind }; } },
  { name: "provider: a reply served by Google AI Studio stops with E_OF_PROVIDER_DRIFT", run: async () => { const r = await founderCall({ meter: fakeMeter({ served_by: "Google AI Studio" }), session: { allowance_micros: 2_000_000, spent_micros: 0 }, label: "s" })(req); return { ok: r.kind === "call-failed" && r.reason === "drift" && r.detail.startsWith("E_OF_PROVIDER_DRIFT"), detail: r.kind === "call-failed" ? r.detail : r.kind }; } },
  { name: "provider: the meter's own pin refusal is a drift too", run: async () => { const r = await founderCall({ meter: fakeMeter(new MeterError("E_PV_PROVIDER_DRIFT", "served by Other")), session: { allowance_micros: 2_000_000, spent_micros: 0 }, label: "s" })(req); return { ok: r.kind === "call-failed" && r.reason === "drift", detail: r.kind }; } },
];
