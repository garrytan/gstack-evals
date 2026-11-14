// Copyright (c) 2026 Garry Tan. MIT License.
// The per-turn audit of a simulated person (office-hours founder prereg, section 4). The caller supplies the violation
// definitions and the auditors' model calls; this module renders the auditor prompt, reads the codes an auditor marks and
// combines two auditors.
//
// - The auditor answers with one JSON object {"marked": [codes]}, alone or as the whole body of one fenced block. Only
//   codes from the caller's list count; any other code, or any other shape, is unreadable.
// - An unreadable answer is sent again once with the same prompt. An answer still unreadable fails closed: it counts as
//   that auditor marking the turn, under the code UNREADABLE, so an unreadable answer never clears a turn.
// - Two auditors: a turn fails when both mark at least one violation (the codes need not match), is disputed when one
//   alone does, and is clean when neither does.
import { renderSystem, type PersonSheet } from "./sim.ts";

export interface Violation {
  code: string;
  definition: string;
}

/** The code an auditor's answer counts as after one resend, when it is still unreadable. */
export const UNREADABLE = "UNREADABLE";

export interface AuditInput {
  sheet: PersonSheet;
  /** The assistant's last message before the reply. */
  last: string;
  reply: string;
  /** The ids the simulator logged as revealed. */
  logged: readonly string[];
}

/** The injected auditor call: the auditor's text for one prompt. */
export type AuditCall = (prompt: string) => Promise<string>;

export interface AuditorRead {
  marked: string[];
  attempts: number;
  readable: boolean;
}

export type TurnVerdict = "fail" | "disputed" | "clean";

export function auditPrompt(violations: readonly Violation[], t: AuditInput): string {
  const sheet = renderSystem({ ...t.sheet, rules: "" }).trimStart();
  return [
    "You are auditing one reply written by a model that plays a person talking with an assistant. The sheet below holds everything the person knows: a persona, the opening message they already sent, and facts that stay hidden until the assistant asks for them. Read the sheet, the assistant's last message, the person's reply and the fact ids the person logged as revealed in that reply. Then mark every violation below that the reply commits.",
    "Violations:\n" + violations.map((v) => "- " + v.code + ", " + v.definition).join("\n"),
    sheet,
    "The assistant's last message:\n<<<\n" + t.last + "\n>>>",
    "The person's reply:\n<<<\n" + t.reply + "\n>>>",
    "The ids the person logged as revealed: " + JSON.stringify(t.logged),
    'Answer with a JSON object only: {"marked": ["<code>", ...]}, listing every violation code that applies, or an empty list when none applies.',
  ].join("\n\n");
}

/** The codes an answer marks, or null when it is unreadable. */
export function readAudit(text: string, codes: ReadonlySet<string>): string[] | null {
  const fenced = /^\x60{3}[\w-]*\n([\s\S]*?)\n?\x60{3}$/.exec(text.trim());
  let o: any;
  try {
    o = JSON.parse(fenced ? fenced[1]! : text);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || !Array.isArray(o.marked) || !o.marked.every((c: unknown) => typeof c === "string" && codes.has(c))) return null;
  return [...new Set<string>(o.marked)];
}

/** One auditor's read of one turn, with one resend on an unreadable answer. */
export async function auditTurn(violations: readonly Violation[], t: AuditInput, call: AuditCall): Promise<AuditorRead> {
  const prompt = auditPrompt(violations, t);
  const codes = new Set(violations.map((v) => v.code));
  for (let attempt = 1; attempt <= 2; attempt++) {
    const marked = readAudit(await call(prompt), codes);
    if (marked) return { marked, attempts: attempt, readable: true };
  }
  return { marked: [UNREADABLE], attempts: 2, readable: false };
}

export const combine = (a: AuditorRead, b: AuditorRead): TurnVerdict => (a.marked.length && b.marked.length ? "fail" : a.marked.length || b.marked.length ? "disputed" : "clean");
