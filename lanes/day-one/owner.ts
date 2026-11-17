// Copyright (c) 2026 Garry Tan. MIT License.
// The owner channel (prereg section 5, the Captain's H1 ruling). Every planning arm gets it; the builder and the checker
// never do. Nothing here calls a model: the responder's call comes in as ask, and run.ts meters it on its own item.
//
// - AskUserQuestion is denied in every session (beside WebSearch and WebFetch), so every question reaches the owner as
//   text at the end of a reply, as in the office-hours founder lane. The driver calls nextUser after each reply.
// - A reply asks the owner when its last 600 characters hold a question mark (usersim's proseQuestion), or, on a gstack
//   arm, when autoplan's run in the session's state root waits at its gate (gatePending). Otherwise the session ends.
// - The responder gets usersim's persona prompt (src/usersim/persona.ts) with the persona text OWNER_HEAD, the sealed
//   profile and OWNER_RULES, and the asking reply's text as the question: one request per question, no transcript.
// - The responder ends its answer with a SOURCE line (profile, recommended or unknown). The line is cut before the
//   answer goes back; a missing or unreadable line logs untagged. Question counts and sources are logged by arm.
// - After OWNER_REPLIES answers, OWNER_CLOSING goes instead, and the reply to it ends the session whatever it holds.
import type { NextUser } from "../../src/adapters/claude-code/driver.ts";
import { personaPrompt } from "../../src/usersim/persona.ts";
import { proseQuestion } from "../../src/usersim/classifier.ts";
import { OWNER_CLOSING, OWNER_HEAD, OWNER_REPLIES, OWNER_RULES } from "./frozen.ts";

export type AnswerSource = "profile" | "recommended" | "unknown" | "untagged";

export interface OwnerTurn {
  n: number;
  /** What the responder was shown as the question: the asking reply's tail, at most 600 characters. */
  question: string;
  answer: string;
  source: AnswerSource;
  /** The question came from autoplan's waiting gate rather than a question mark. */
  gate: boolean;
}

/** What ask returns: the responder's raw text, or why the call failed. */
export type OwnerReply = { text: string } | { failed: "allowance" | "provider"; detail: string };

export interface OwnerState {
  turns: OwnerTurn[];
  replies: number;
  closing_sent: boolean;
  ended: "no-question" | "closing" | null;
  failed: { reason: "allowance" | "provider"; detail: string } | null;
}

/** The persona text the responder gets for one unit. */
export const ownerPersona = (profile: string): string => OWNER_HEAD + "\n\n" + profile.trim() + "\n\n" + OWNER_RULES;

/** The prompt one question sends: usersim's persona prompt, unchanged. */
export const ownerPrompt = (profile: string, question: string): string => personaPrompt(ownerPersona(profile), question);

const SOURCE = /\n?[ \t]*SOURCE:[ \t]*(profile|recommended|unknown)[ \t.]*$/i;
const ANY_SOURCE = /\n?[ \t]*SOURCE:[^\n]*$/i;

/** Splits the responder's text into the answer the agent sees and its source tag. */
export function splitSource(text: string): { answer: string; source: AnswerSource } {
  const t = text.trimEnd();
  const m = SOURCE.exec(t);
  if (m) return { answer: t.slice(0, m.index).trim(), source: m[1]!.toLowerCase() as AnswerSource };
  const any = ANY_SOURCE.exec(t);
  return { answer: (any ? t.slice(0, any.index) : t).trim(), source: "untagged" };
}

/** The question a reply asks the owner, or null when it asks none. */
export function ownerQuestion(texts: readonly string[], gatePending: boolean): { question: string; gate: boolean } | null {
  const all = texts.join("\n\n");
  const q = proseQuestion(all);
  if (q !== null) return { question: q, gate: false };
  if (gatePending && all.trim()) return { question: all.slice(-600), gate: true };
  return null;
}

/** The driver's nextUser for one attempt, and the state it fills. */
export function ownerLoop(o: { ask: (question: string) => Promise<OwnerReply>; gatePending?: () => boolean; limit?: number }): { state: OwnerState; nextUser: (texts: string[]) => Promise<NextUser> } {
  const limit = o.limit ?? OWNER_REPLIES;
  const state: OwnerState = { turns: [], replies: 0, closing_sent: false, ended: null, failed: null };
  const nextUser = async (texts: string[]): Promise<NextUser> => {
    state.replies++;
    if (state.closing_sent) {
      state.ended = "closing";
      return { end: true };
    }
    const q = ownerQuestion(texts, o.gatePending?.() ?? false);
    if (!q) {
      state.ended = "no-question";
      return { end: true };
    }
    if (state.turns.length >= limit) {
      state.closing_sent = true;
      return { reply: OWNER_CLOSING };
    }
    const r = await o.ask(q.question);
    if ("failed" in r) {
      state.failed = { reason: r.failed, detail: r.detail };
      return { stop: { kind: "missing", code: "E_DAYONE_OWNER" } };
    }
    const { answer, source } = splitSource(r.text);
    const text = answer || "I don't know.";
    state.turns.push({ n: state.turns.length + 1, question: q.question, answer: text, source, gate: q.gate });
    return { reply: text };
  };
  return { state, nextUser };
}

/** Counts by source, for the per-arm table beside every score. */
export function sourceCounts(turns: readonly OwnerTurn[]): Record<AnswerSource, number> & { questions: number; gate: number } {
  const c = { profile: 0, recommended: 0, unknown: 0, untagged: 0, questions: turns.length, gate: 0 };
  for (const t of turns) {
    c[t.source]++;
    if (t.gate) c.gate++;
  }
  return c;
}
