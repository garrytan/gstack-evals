// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's simulator turn (prereg section 4 step 3; pre-run change 1, items 4b, 4c and 4e). One
// turn of the simulated founder or builder, for the session loop and the fixed-script audit. It reuses persona-sim's
// renderSystem, toMessages, readOutput and NOTES, and the founder lane's founderCall (Gemini 4 Argon pinned to Google
// Vertex, temperature 0, its allowance check and its cap, provider and drift readings). src/persona-sim is not changed.
//
// - The rules text is pre-run change 6's attachment for the brief's kind (sim-rules-founder.txt or sim-rules-builder.txt,
//   change 1's text with rule 3 and the revealed line rewritten), checked against frozen.SIM_RULES_SHA256 when it is read
//   and again before any call (E_OHR_SIM_RULES).
// - One budget of frozen.REVEAL_GUARD.calls_per_reply (3) model calls a reply covers every check: persona-sim's json,
//   ids and words checks, a done field that must be a boolean (a missing or non-boolean done fails json), and the reveal
//   guard (more than 2 distinct revealed ids). A resend puts, after the rules and before the sheet, persona-sim's note
//   for each check the last draw failed, then frozen.REVEAL_NOTE when the guard failed, then frozen.attemptLine(n).
// - Outcomes: reply (with revealed, rules, done, attempts), guard-failed (the third draw failed only the guard),
//   check-failed (the third draw failed another check) and call-failed (allowance, cap, provider or drift). Every
//   outcome carries the rejected draws apart from the reply, and the request digests.
// - The simulator reads its own earlier turns as the JSON objects it returned (reply, revealed, rules, done), never as
//   the prose the adviser sees (pre-run change 6): every person turn in the transcript carries its accepted JSON as own,
//   and a person turn without it is refused before any call.
// - pinnedCall is the call every paid run uses (the audit through wire.ts, the stage launches through run.ts): the
//   founder lane's founderCall, plus a drift when a reply names a model other than Gemini 4 Argon (pinned.ts), whose
//   detail starts with E_OHR_MODEL_DRIFT. founderCall itself is unchanged.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NOTES, readOutput, renderSystem, toMessages, type CallFailure, type Check, type PersonSheet, type SimCall, type VisibleTurn } from "../../../src/persona-sim/sim.ts";
import { founderCall, type SimSession } from "../../office-hours-founder/sim/founder.ts";
import { MeterError, MODELS, type Meter } from "../../product-value/meter.ts";
import { modelDrift } from "../pinned.ts";
import { attemptLine, REVEAL_GUARD, REVEAL_NOTE, SIM_RULES_FILES, SIM_RULES_MOVE, SIM_RULES_SHA256 } from "../frozen.ts";
import type { BriefKind, Sheet } from "../types.ts";

export { founderCall };

/** founderCall on a meter, with a reply that names another model than Argon read as a drift (E_OHR_MODEL_DRIFT). */
export function pinnedCall(o: { meter: Pick<Meter, "call">; session: SimSession; label: string }): SimCall {
  let drift: string | null = null;
  const inner = founderCall({ ...o, meter: { call: async (req) => { const res = await o.meter.call(req); if (res.text !== null && res.model !== undefined) drift = modelDrift(MODELS[req.model].id, res.model, "the simulated person (" + o.label + ")"); return res; } } });
  return async (req) => {
    drift = null;
    let out;
    try {
      out = await inner(req);
    } catch (e) {
      if (e instanceof MeterError && e.code === "E_PV_EMPTY_REPLIES") return { kind: "call-failed", reason: "drift", detail: e.message.startsWith("E_PV_EMPTY_REPLIES") ? e.message : "E_PV_EMPTY_REPLIES " + e.message };
      throw e;
    }
    return drift ? { kind: "call-failed", reason: "drift", detail: drift } : out;
  };
}
export type { PersonSheet, SimCall, VisibleTurn };

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

/** The repository root, from this file's place in it. */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Throws E_OHR_SIM_RULES unless text is the frozen rules text for kind. */
export function checkRules(kind: BriefKind, text: string): void {
  const got = sha256(text);
  if (got !== SIM_RULES_SHA256[kind]) throw new Error("E_OHR_SIM_RULES the " + kind + " simulator rules hash to " + got + ", and pre-run change 1 freezes " + SIM_RULES_SHA256[kind]);
}

/** Pre-run change 6's rules attachment for the brief's kind, read from the repo and checked against its frozen digest. */
export function simRules(kind: BriefKind, root: string = REPO_ROOT): string {
  const text = readFileSync(join(root, SIM_RULES_MOVE.replace(/README\.md$/, ""), SIM_RULES_FILES[kind]), "utf8");
  checkRules(kind, text);
  return text;
}

/** A brief's person sheet: sheet.json's persona and facts (each kept to id, text and reveal_when), the trimmed opening and the kind's rules. */
export function loadPerson(dir: string, kind: BriefKind, root: string = REPO_ROOT): PersonSheet {
  const sheet = JSON.parse(readFileSync(join(dir, "sheet.json"), "utf8")) as Sheet;
  return { rules: simRules(kind, root), persona: sheet.persona, opening: readFileSync(join(dir, "opening.md"), "utf8").trim(), items: sheet.facts.map((f) => ({ id: f.id, text: f.text, reveal_when: f.reveal_when })) };
}

/** A delivered simulator turn as the simulator returned it, which is how its own history shows it (pre-run change 6). */
export interface OwnTurn {
  reply: string;
  revealed: string[];
  rules: number[];
  done: boolean;
}

/** A visible transcript line; a person line carries the simulator's accepted JSON for that turn. */
export type HistoryTurn = VisibleTurn & { own?: OwnTurn };

/** The simulator's messages: the adviser's lines as the adviser wrote them, its own turns as the JSON it returned. */
export function historyMessages(transcript: readonly HistoryTurn[]): ReturnType<typeof toMessages> {
  return toMessages(transcript).map((m, i) => {
    const t = transcript[i]!;
    if (t.role !== "person") return m;
    if (!t.own) throw new Error("E_USAGE simulator: person turn " + (i + 1) + " carries no JSON of its own (pre-run change 6)");
    return { ...m, content: JSON.stringify({ reply: t.own.reply, revealed: t.own.revealed, rules: t.own.rules, done: t.own.done }) };
  });
}

/** One draw the checks rejected, logged apart: it never reaches the adviser and never counts toward R1. */
export interface RejectedDraw {
  attempt: number;
  checks: Check[];
  guard: boolean;
  /** The draw's reply and revealed ids, when the draw was a readable JSON object. */
  reply: string | null;
  revealed: string[] | null;
  request: string;
}

export type SimOutcome =
  | { kind: "reply"; reply: string; revealed: string[]; rules: number[]; done: boolean; attempts: number; rejected: RejectedDraw[]; requests: string[] }
  | { kind: "guard-failed"; attempts: number; rejected: RejectedDraw[]; requests: string[] }
  | { kind: "check-failed"; checks: Check[]; attempts: number; rejected: RejectedDraw[]; requests: string[] }
  | (CallFailure & { rejected: RejectedDraw[]; requests: string[] });

/** Reads one draw: the turn, or the checks it fails and whether it fails the guard. */
export function readDraw(text: string, ids: ReadonlySet<string>): { reply: string; revealed: string[]; rules: number[]; done: boolean } | { checks: Check[]; guard: boolean; reply: string | null; revealed: string[] | null } {
  const out = readOutput(text, ids);
  if ("checks" in out && out.checks.includes("json")) return { checks: ["json"], guard: false, reply: null, revealed: null };
  const fenced = /^\x60{3}[\w-]*\n([\s\S]*?)\n?\x60{3}$/.exec(text.trim());
  const o = JSON.parse(fenced ? fenced[1]! : text) as { reply: string; revealed: string[]; done?: unknown };
  const revealed = [...new Set(o.revealed)];
  if (typeof o.done !== "boolean") return { checks: ["json"], guard: false, reply: o.reply, revealed };
  const guard = revealed.length > REVEAL_GUARD.max_reveals;
  if ("checks" in out || guard) return { checks: "checks" in out ? out.checks : [], guard, reply: o.reply, revealed };
  return { ...out, done: o.done };
}

/** The system text of attempt n: the rules, then the notes for the last draw's failures and the attempt line, then the sheet. */
export function attemptSystem(sheet: PersonSheet, n: number, failed: readonly Check[], guard: boolean): string {
  if (n === 1) return renderSystem(sheet);
  const notes = [...failed.map((c) => NOTES[c]), ...(guard ? [REVEAL_NOTE] : []), attemptLine(n)].join(" ");
  return renderSystem({ ...sheet, rules: sheet.rules.trimEnd() + "\n\n" + notes });
}

/** One simulator turn under one shared budget of three calls. kind names the rules the sheet must carry. */
export async function simTurn(o: { kind: BriefKind; sheet: PersonSheet; transcript: readonly HistoryTurn[]; call: SimCall }): Promise<SimOutcome> {
  checkRules(o.kind, o.sheet.rules);
  const messages = historyMessages(o.transcript);
  const ids = new Set(o.sheet.items.map((i) => i.id));
  const requests: string[] = [];
  const rejected: RejectedDraw[] = [];
  let failed: Check[] = [];
  let guard = false;
  for (let n = 1; n <= REVEAL_GUARD.calls_per_reply; n++) {
    const req = { system: attemptSystem(o.sheet, n, failed, guard), messages };
    const digest = sha256(JSON.stringify(req));
    requests.push(digest);
    const res = await o.call(req);
    if (res.kind === "call-failed") return { ...res, rejected, requests };
    const draw = readDraw(res.text, ids);
    if (!("checks" in draw)) return { kind: "reply", ...draw, attempts: n, rejected, requests };
    rejected.push({ attempt: n, checks: draw.checks, guard: draw.guard, reply: draw.reply, revealed: draw.revealed, request: digest });
    failed = draw.checks;
    guard = draw.guard;
  }
  const n = REVEAL_GUARD.calls_per_reply;
  return failed.length ? { kind: "check-failed", checks: failed, attempts: n, rejected, requests } : { kind: "guard-failed", attempts: n, rejected, requests };
}
