// Copyright (c) 2026 Garry Tan. MIT License.
// A simulated person for evals that talk to an assistant (office-hours founder prereg, section 4). It knows a person sheet
// and the visible transcript, and nothing else: no keys, flags, arms, models under test or scores. The caller supplies the
// rules text and the model call, so another eval can reuse it with its own sheet and rules.
//
// - The system prompt is the caller's rules text, a blank line, "The sheet:" and the sheet as indented JSON with the keys
//   persona, opening and facts (each fact's id, text and reveal_when). SIM_SHA256 pins this file, so the rendering, the
//   checks and the retry notes travel with every logged turn.
// - The transcript must start and end with an assistant message. Assistant messages go to the model as user messages and
//   the person's earlier replies as assistant messages, as plain text.
// - The output must be one JSON object, alone or as the whole body of one fenced block, with "reply" a non-empty string,
//   "revealed" an array of strings and "rules" an array of integers; other keys are ignored. Every revealed id must be on
//   the sheet, and the reply must be at most MAX_REPLY_WORDS words. Duplicate ids are dropped.
// - A turn that fails a check is sent again once with the same input and a fixed note, naming each failed check, added to
//   the end of the system prompt. A second failure returns check-failed with the checks. A call that fails (the caller's
//   allowance, a provider error or a provider drift) returns call-failed at once and is never retried here.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sha256 = (t: string | Buffer) => createHash("sha256").update(t).digest("hex");

/** sha256 of this file: the sheet rendering, the checks and the retry notes. */
export const SIM_SHA256 = sha256(readFileSync(fileURLToPath(import.meta.url)));

export const MAX_REPLY_WORDS = 150;

export interface SheetItem {
  id: string;
  text: string;
  reveal_when: string;
}

export interface PersonSheet {
  /** The system prompt text the caller supplies; the sheet follows it. */
  rules: string;
  persona: string;
  /** The opening message the person already sent. */
  opening: string;
  items: SheetItem[];
}

/** One visible message: assistant text or the person's reply, never tool calls or files. */
export interface VisibleTurn {
  role: "assistant" | "person";
  text: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SimRequest {
  system: string;
  messages: ChatMessage[];
}

export type CallFailure = { kind: "call-failed"; reason: "allowance" | "provider" | "drift"; detail: string };

/** The injected model call: the model's text, or why the call failed. */
export type SimCall = (req: SimRequest) => Promise<{ kind: "text"; text: string } | CallFailure>;

export type Check = "json" | "ids" | "words";

export type PersonTurn =
  | { kind: "reply"; reply: string; revealed: string[]; rules: number[]; attempts: number; requests: string[] }
  | { kind: "check-failed"; checks: Check[]; attempts: number; requests: string[] }
  | (CallFailure & { requests: string[] });

/** The fixed retry notes, one per failed check. */
export const NOTES: Readonly<Record<Check, string>> = {
  json: "Your last answer was not one JSON object with the keys reply, revealed and rules. Reply with that JSON object only.",
  ids: "Your last answer listed an id in revealed that is not on the sheet. List only ids on the sheet.",
  words: "Your last reply was too long. Keep it within the word limit.",
};

export const renderSystem = (s: PersonSheet): string =>
  s.rules.trimEnd() + "\n\nThe sheet:\n" + JSON.stringify({ persona: s.persona, opening: s.opening, facts: s.items.map((i) => ({ id: i.id, text: i.text, reveal_when: i.reveal_when })) }, null, 2);

export function toMessages(transcript: readonly VisibleTurn[]): ChatMessage[] {
  if (transcript[0]?.role !== "assistant" || transcript.at(-1)?.role !== "assistant") throw new Error("E_USAGE persona-sim: the transcript must start and end with an assistant message");
  return transcript.map((t) => ({ role: t.role === "assistant" ? "user" : "assistant", content: t.text }));
}

const countWords = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/** Reads one output against the sheet's ids: the parsed turn, or the checks it fails. */
export function readOutput(text: string, ids: ReadonlySet<string>): { reply: string; revealed: string[]; rules: number[] } | { checks: Check[] } {
  const fenced = /^\x60{3}[\w-]*\n([\s\S]*?)\n?\x60{3}$/.exec(text.trim());
  let o: any;
  try {
    o = JSON.parse(fenced ? fenced[1]! : text);
  } catch {
    return { checks: ["json"] };
  }
  const shaped = o && typeof o === "object" && !Array.isArray(o) && typeof o.reply === "string" && o.reply.trim() !== "" && Array.isArray(o.revealed) && o.revealed.every((r: unknown) => typeof r === "string") && Array.isArray(o.rules) && o.rules.every((r: unknown) => Number.isInteger(r));
  if (!shaped) return { checks: ["json"] };
  const checks: Check[] = [];
  if (!o.revealed.every((r: string) => ids.has(r))) checks.push("ids");
  if (countWords(o.reply) > MAX_REPLY_WORDS) checks.push("words");
  return checks.length ? { checks } : { reply: o.reply, revealed: [...new Set<string>(o.revealed)], rules: o.rules };
}

/** One person turn: renders the request, calls the model, checks the output and retries once on a failed check. */
export async function personTurn(o: { sheet: PersonSheet; transcript: readonly VisibleTurn[]; call: SimCall }): Promise<PersonTurn> {
  const system = renderSystem(o.sheet);
  const messages = toMessages(o.transcript);
  const ids = new Set(o.sheet.items.map((i) => i.id));
  const requests: string[] = [];
  let failed: Check[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const req = { system: failed.length ? system + "\n\n" + failed.map((c) => NOTES[c]).join(" ") : system, messages };
    requests.push(sha256(JSON.stringify(req)));
    const res = await o.call(req);
    if (res.kind === "call-failed") return { ...res, requests };
    const out = readOutput(res.text, ids);
    if (!("checks" in out)) return { kind: "reply", ...out, attempts: attempt, requests };
    failed = out.checks;
  }
  return { kind: "check-failed", checks: failed, attempts: 2, requests };
}
