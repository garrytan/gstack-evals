// Copyright (c) 2026 Garry Tan. MIT License.
// The sim area's dry-run seams (prereg section 12 stage 1's dry run; pre-run change 1, items 4b and 4e; section 12
// stage 3). Each drives one frozen rule through the real code on both sides of its edge with planted cases, keyless and
// fast: the rules digests, the done field, the reveal guard at 2 and 3 revealed ids, the shared budget of three calls and
// the order of the resend notes, the founder lane's allowance refusal, and the fixed-script audit at 40 and 39 auditable
// turns, at 4 and 5 failing turns of 80, with a guard-failed sampled turn, at a guard-failure share either side of 5% and
// on a cap stop. The fixture sheets are invented and are never eval briefs.
import { NOTES, type PersonSheet, type SimCall, type SimRequest } from "../../../src/persona-sim/sim.ts";
import { fakeMeter } from "../../office-hours-founder/sim/seams.ts";
import { worstCase } from "../../office-hours-founder/sim/founder.ts";
import { attemptLine, AUDIT, AUDIT_SCRIPT, REVEAL_NOTE, SIM_RULES_SHA256 } from "../frozen.ts";
import type { BriefKind, Seam } from "../types.ts";
import { drawSample, runScriptAudit, type AuditSheet, type ScriptTurn } from "./audit.ts";
import { founderCall, pinnedCall, simRules, simTurn } from "./founder.ts";

export function fixtureSheet(kind: BriefKind, n = 0): PersonSheet {
  return {
    rules: simRules(kind),
    persona: kind === "founder" ? "A former courier who plans pickup routes for small laundry services." : "A student building a pixel-art music toy for a weekend game jam.",
    opening: kind === "founder" ? "I'm building route sheets for laundry pickup services, number " + n + ". Should I raise money now?" : "I want to build a music toy for this weekend's jam, number " + n + ". What should I make first?",
    items: [
      { id: "f1", text: "Two services pay me forty dollars a month.", reveal_when: "Asked whether anyone pays." },
      { id: "f2", text: "The owners ask me to text drivers when a pickup moves.", reveal_when: "Asked what users ask for." },
      { id: "f3", text: "I have three months of savings left.", reveal_when: "Asked about runway or money." },
    ],
  };
}

export const NO_DONE = Symbol("no done");
export const out = (reply: string, revealed: string[] = ["f1"], done: unknown = false): string => JSON.stringify({ reply, revealed, rules: [1, 3], ...(done === NO_DONE ? {} : { done }) });

/** A call that answers from a script, recording each request. */
export function scripted(outs: readonly string[]): SimCall & { reqs: SimRequest[] } {
  const reqs: SimRequest[] = [];
  return Object.assign(async (req: SimRequest) => {
    reqs.push(req);
    return { kind: "text" as const, text: outs[reqs.length - 1] ?? "" };
  }, { reqs });
}

const transcript = [{ role: "assistant" as const, text: "Does anyone pay you for this today?" }];
const turn = (outs: string[], kind: BriefKind = "founder") => {
  const call = scripted(outs);
  return simTurn({ kind, sheet: fixtureSheet(kind), transcript, call }).then((t) => ({ t, call }));
};
const wordsOf = (n: number) => Array.from({ length: n }, (_, i) => "w" + i).join(" ");
const notesOf = (system: string) => system.slice(0, system.indexOf("\n\nThe sheet:\n"));

/** A simulator for the audit: turn k of a sheet replies "reply <brief> <k>", or fails as plan says. */
export function auditCall(brief: string, plan: (turn: number) => "reply" | "guard" | "provider" | "cap" | "drift" = () => "reply"): SimCall {
  return async (req) => {
    const k = req.messages.filter((m) => m.role === "user").length;
    const p = plan(k);
    if (p === "provider") return { kind: "call-failed", reason: "provider", detail: "HTTP 503" };
    if (p === "cap") return { kind: "call-failed", reason: "cap", detail: "CAP_STOP the item's cap" };
    if (p === "drift") return { kind: "call-failed", reason: "drift", detail: "E_OF_PROVIDER_DRIFT google/gemini-4-argon was served by Google AI Studio, not Google Vertex" };
    return { kind: "text", text: out("reply " + brief + " " + k, p === "guard" ? ["f1", "f2", "f3"] : ["f1"]) };
  };
}

export const auditSheets = (n: number): AuditSheet[] => Array.from({ length: n }, (_, i) => ({ brief: "b" + String(i).padStart(3, "0"), kind: i % 3 === 2 ? ("builder" as const) : ("founder" as const), sheet: fixtureSheet(i % 3 === 2 ? "builder" : "founder", i) }));

/** The sample the audit will draw when every listed sheet runs its whole script, except turns cut short as given. */
export function expectedTurns(sheets: readonly AuditSheet[], plan: (brief: string, turn: number) => "reply" | "guard" | "provider" = () => "reply"): ScriptTurn[] {
  return sheets.flatMap((s) => {
    const turns: ScriptTurn[] = [];
    for (let k = 1; k <= AUDIT_SCRIPT.length; k++) {
      const p = plan(s.brief, k);
      turns.push({ brief: s.brief, turn: k, outcome: p === "reply" ? "reply" : p === "guard" ? "guard-failed" : "call-failed", reply: p === "reply" ? "reply " + s.brief + " " + k : null, revealed: p === "reply" ? ["f1"] : [], attempts: 1 });
      if (p !== "reply") break;
    }
    return turns;
  });
}

/** Auditors that both mark the turns whose replies are in fail, and count their calls. */
export function auditors(fail: ReadonlySet<string>) {
  let calls = 0;
  const read = async (prompt: string) => {
    calls++;
    const m = /The person's reply:\n<<<\n([\s\S]*?)\n>>>/.exec(prompt);
    return fail.has(m?.[1] ?? "") ? '{"marked": ["V2"]}' : '{"marked": []}';
  };
  return { auditors: { astra: read, opus: read }, calls: () => calls };
}

async function auditWithFailing(k: number) {
  const sheets = auditSheets(14);
  const sample = drawSample(expectedTurns(sheets));
  const a = auditors(new Set(sample.slice(0, k).map((t) => t.reply!)));
  return runScriptAudit({ sheets, call: (s) => auditCall(s.brief), auditors: a.auditors });
}

async function auditGuard(failingSheets: number) {
  const sheets = auditSheets(15 + failingSheets);
  const bad = new Set(sheets.slice(15).map((s) => s.brief));
  const a = auditors(new Set());
  return runScriptAudit({ sheets, call: (s) => auditCall(s.brief, (k) => (bad.has(s.brief) && k === 1 ? "guard" : "reply")), auditors: a.auditors });
}

async function auditShort(auditable: number) {
  const sheets = auditSheets(7);
  const last = sheets[6]!.brief;
  const cut = auditable - 36;
  return runScriptAudit({ sheets, call: (s) => auditCall(s.brief, (k) => (s.brief === last && k > cut ? "provider" : "reply")), auditors: auditors(new Set()).auditors });
}

const GUARD_REASON = "guard failures in";

export const seams: Seam[] = [
  { name: "sim rules: both attachments hash to frozen.SIM_RULES_SHA256", run: () => { const ok = (["founder", "builder"] as const).every((k) => { try { simRules(k); return true; } catch { return false; } }); return { ok, detail: JSON.stringify(SIM_RULES_SHA256) }; } },
  { name: "sim rules: a rules text one byte off is refused before any call", run: async () => { const call = scripted([out("x")]); let err = ""; try { await simTurn({ kind: "founder", sheet: { ...fixtureSheet("founder"), rules: fixtureSheet("founder").rules + " " }, transcript, call }); } catch (e) { err = (e as Error).message; } return { ok: err.startsWith("E_OHR_SIM_RULES") && call.reqs.length === 0, detail: err.slice(0, 80) }; } },
  { name: "sim rules: a builder brief refuses the founder rules, and runs on its own", run: async () => { let err = ""; try { await simTurn({ kind: "builder", sheet: fixtureSheet("founder"), transcript, call: scripted([out("x")]) }); } catch (e) { err = (e as Error).message; } const { t } = await turn([out("I want to finish by Sunday.")], "builder"); return { ok: err.startsWith("E_OHR_SIM_RULES") && t.kind === "reply", detail: t.kind }; } },
  { name: "sim done: true and false are read", run: async () => { const a = await turn([out("Yes.", [], true)]); const b = await turn([out("No.", [], false)]); return { ok: a.t.kind === "reply" && a.t.done === true && b.t.kind === "reply" && b.t.done === false, detail: a.t.kind + " " + b.t.kind }; } },
  { name: "sim done: a missing done fails the json check and is resent", run: async () => { const { t, call } = await turn([out("Yes.", [], NO_DONE), out("Yes.")]); return { ok: t.kind === "reply" && t.attempts === 2 && t.rejected[0]!.checks.join() === "json" && notesOf(call.reqs[1]!.system).includes(NOTES.json), detail: JSON.stringify(t.kind === "reply" ? t.rejected : t) }; } },
  { name: "sim done: a non-boolean done fails the json check", run: async () => { const { t } = await turn([out("Yes.", [], "true"), out("Yes.", [], 1), out("Yes.", [], null)]); return { ok: t.kind === "check-failed" && t.checks.join() === "json" && t.attempts === 3, detail: JSON.stringify(t) }; } },
  { name: "reveal guard: two revealed ids pass on the first call", run: async () => { const { t } = await turn([out("Two pay, and they ask for texts.", ["f1", "f2"])]); return { ok: t.kind === "reply" && t.attempts === 1 && t.revealed.length === 2, detail: t.kind }; } },
  { name: "reveal guard: three revealed ids are resent with the guard's note and attempt 2", run: async () => { const { t, call } = await turn([out("All of it.", ["f1", "f2", "f3"]), out("Two pay.", ["f1"])]); const notes = notesOf(call.reqs[1]!.system); return { ok: t.kind === "reply" && t.attempts === 2 && t.rejected.length === 1 && t.rejected[0]!.guard && notes.endsWith(REVEAL_NOTE + " " + attemptLine(2)) && notes.startsWith(fixtureSheet("founder").rules.trimEnd()), detail: notes.slice(-160) }; } },
  { name: "reveal guard: a repeated id counts once", run: async () => { const { t } = await turn([out("Two pay.", ["f1", "f1", "f2"])]); return { ok: t.kind === "reply" && t.attempts === 1, detail: t.kind }; } },
  { name: "budget: the guard failing on all three calls is a guard failure after exactly three calls", run: async () => { const g = out("All.", ["f1", "f2", "f3"]); const { t, call } = await turn([g, g, g, out("late")]); return { ok: t.kind === "guard-failed" && call.reqs.length === 3 && t.rejected.length === 3 && new Set(t.requests).size === 3 && notesOf(call.reqs[2]!.system).endsWith(attemptLine(3)), detail: t.kind + " " + call.reqs.length }; } },
  { name: "budget: a pass on the third call is a reply", run: async () => { const g = out("All.", ["f1", "f2", "f3"]); const { t } = await turn([g, "not json", out("Two pay.")]); return { ok: t.kind === "reply" && t.attempts === 3 && t.rejected.length === 2, detail: t.kind }; } },
  { name: "budget: a third draw that fails another check is a check failure", run: async () => { const g = out("All.", ["f1", "f2", "f3"]); const { t } = await turn([g, g, out("x", ["f9"])]); return { ok: t.kind === "check-failed" && t.checks.join() === "ids", detail: JSON.stringify(t.kind === "check-failed" ? t.checks : t.kind) }; } },
  { name: "notes: each failed check's note comes first, then the guard's note, then the attempt line", run: async () => { const { call } = await turn([out(wordsOf(151), ["f1", "f2", "f3"]), out("ok")]); const notes = notesOf(call.reqs[1]!.system); return { ok: notes.endsWith(NOTES.words + " " + REVEAL_NOTE + " " + attemptLine(2)), detail: notes.slice(-200) }; } },
  { name: "call failure: a cap refusal returns at once with the draws rejected so far", run: async () => { let n = 0; const call: SimCall = async () => (n++ === 0 ? { kind: "text", text: "nope" } : { kind: "call-failed", reason: "cap", detail: "CAP_STOP" }); const t = await simTurn({ kind: "founder", sheet: fixtureSheet("founder"), transcript, call }); return { ok: t.kind === "call-failed" && t.reason === "cap" && t.rejected.length === 1 && n === 2, detail: t.kind }; } },
  { name: "allowance: the founder lane's founderCall refuses a call whose worst case does not fit", run: async () => { const m = fakeMeter({ text: out("ok") }); const req = { system: "s", messages: [{ role: "user" as const, content: "q" }] }; const fits = await founderCall({ meter: m, session: { allowance_micros: 2_000_000, spent_micros: 2_000_000 - worstCase(req) }, label: "s" })(req); const over = await founderCall({ meter: m, session: { allowance_micros: 2_000_000, spent_micros: 2_000_000 - worstCase(req) + 1 }, label: "s" })(req); return { ok: fits.kind === "text" && over.kind === "call-failed" && over.reason === "allowance" && m.calls === 1, detail: fits.kind + " " + over.kind }; } },
  { name: "audit: 40 auditable script turns read", run: async () => { const r = await auditShort(40); return { ok: r.auditable === 40 && r.read === "pass" && r.audited === 40, detail: r.read + " " + r.auditable }; } },
  { name: "audit: 39 auditable script turns read NO READ", run: async () => { const r = await auditShort(39); return { ok: r.auditable === 39 && r.read === "no-read" && r.code === "E_OHR_NO_READ" && r.audited === 0, detail: r.read + " " + r.auditable }; } },
  { name: "audit: 4 of 80 sampled turns failing pass", run: async () => { const r = await auditWithFailing(4); return { ok: r.audited === AUDIT.sample && r.failing === 4 && r.read === "pass", detail: r.read + " " + r.failing + "/" + r.audited }; } },
  { name: "audit: 5 of 80 sampled turns failing fail", run: async () => { const r = await auditWithFailing(5); return { ok: r.failing === 5 && r.read === "fail" && r.code === "E_OHR_SIM_AUDIT", detail: r.read + " " + r.reasons.join("; ") }; } },
  { name: "audit: a guard-failed sampled turn counts as failed and is never sent to the auditors", run: async () => { const sheets = auditSheets(14); const a = auditors(new Set()); const r = await runScriptAudit({ sheets, call: (s) => auditCall(s.brief, (k) => (s.brief === "b000" && k === 1 ? "guard" : "reply")), auditors: a.auditors }); const g = r.sampled.filter((t) => t.turn.outcome === "guard-failed"); const sent = r.sampled.length - g.length; return { ok: r.guard_failures === 1 && g.every((t) => t.reads === null && t.verdict === "fail") && r.failing === g.length && a.calls() === 2 * sent, detail: g.length + " guard-failed sampled, " + a.calls() + " auditor calls" }; } },
  { name: "audit: 4 guard failures in 94 script turns keep the guard share under 5%", run: async () => { const r = await auditGuard(4); return { ok: r.script_turns === 94 && r.guard_failures === 4 && !r.reasons.some((x) => x.includes(GUARD_REASON)), detail: r.reasons.join("; ") || r.read }; } },
  { name: "audit: 5 guard failures in 95 script turns fail the audit", run: async () => { const r = await auditGuard(5); return { ok: r.script_turns === 95 && r.read === "fail" && r.reasons.some((x) => x.includes(GUARD_REASON)), detail: r.reasons.join("; ") }; } },
  { name: "audit: a cap stop ends the audit incomplete", run: async () => { const r = await runScriptAudit({ sheets: auditSheets(8), call: (s) => auditCall(s.brief, (k) => (s.brief === "b003" && k === 2 ? "cap" : "reply")), auditors: auditors(new Set()).auditors }); return { ok: r.read === "incomplete" && r.code === "CAP_STOP" && r.audited === 0, detail: r.read }; } },
  { name: "audit: a provider drift on one turn halts the audit (E_PV_PROVIDER_DRIFT) instead of dropping the turn and passing", run: async () => { const r = await runScriptAudit({ sheets: auditSheets(14), call: (s) => auditCall(s.brief, (k) => (s.brief === "b003" && k === 2 ? "drift" : "reply")), auditors: auditors(new Set()).auditors, parallel: 1 }); return { ok: r.read === "halt" && r.code === "E_PV_PROVIDER_DRIFT" && r.audited === 0 && r.reasons[0]!.includes("b003") && !r.turns.some((t) => t.brief > "b003"), detail: r.read + " " + r.code }; } },
  { name: "audit: a cap stop on an auditor call ends the audit incomplete (CAP_STOP), never an empty auditor answer", run: async () => { const a = { astra: async () => { throw Object.assign(new Error("CAP_STOP audit:astra: the ledger refused the call"), { code: "CAP_STOP" }); }, opus: async () => '{"marked": []}' }; const r = await runScriptAudit({ sheets: auditSheets(14), call: (s) => auditCall(s.brief), auditors: a }); return { ok: r.read === "incomplete" && r.code === "CAP_STOP" && r.audited === 0 && r.reasons[0]!.includes("auditor"), detail: r.read + " " + r.code }; } },
  { name: "audit: an auditor reply that names another model halts the audit (E_OHR_MODEL_DRIFT)", run: async () => { const a = { astra: async () => '{"marked": []}', opus: async () => { throw Object.assign(new Error("E_OHR_MODEL_DRIFT audit:opus asked for claude-opus-5-5 and the reply reports claude-sonnet-5-5"), { code: "E_OHR_MODEL_DRIFT" }); } }; const r = await runScriptAudit({ sheets: auditSheets(14), call: (s) => auditCall(s.brief), auditors: a }); return { ok: r.read === "halt" && r.code === "E_OHR_MODEL_DRIFT" && r.audited === 0, detail: r.read + " " + r.code }; } },
  { name: "sim model: a reply naming Argon or its dated snapshot passes; another model is a drift (E_OHR_MODEL_DRIFT); a cached reply from before the field is not judged", run: async () => { const session = () => ({ allowance_micros: 1e9, spent_micros: 0 }); const req = { system: "s", messages: [{ role: "user" as const, content: "q" }] }; const run = (model: string | null | undefined) => pinnedCall({ meter: fakeMeter(model === undefined ? {} : { model }), session: session(), label: "s" })(req); const [a, b, c, d, n] = await Promise.all([run("google/gemini-4-argon"), run("google/gemini-4-argon-20261101"), run("google/gemini-4-hydrogen"), run(undefined), run(null)]); return { ok: a.kind === "text" && b.kind === "text" && c.kind === "call-failed" && c.reason === "drift" && c.detail.startsWith("E_OHR_MODEL_DRIFT") && c.detail.includes("gemini-4-hydrogen") && d.kind === "text" && n.kind === "call-failed" && n.reason === "drift", detail: [a, b, c, d, n].map((x) => x.kind).join() }; } },
  { name: "audit: the record binds both rules digests and the script", run: async () => { const r = await auditShort(40); return { ok: r.binds.rules_sha256.founder === SIM_RULES_SHA256.founder && r.binds.rules_sha256.builder === SIM_RULES_SHA256.builder && /^[0-9a-f]{64}$/.test(r.binds.script_sha256) && Object.keys(r.binds.sheets).length === 7, detail: r.binds.script_sha256 }; } },
];
