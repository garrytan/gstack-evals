// Copyright (c) 2026 Garry Tan. MIT License.
// The devex eval's rec persona and its one answer rule (prereg 2026-11-09-geva-417, section 5, "One answer rule for
// every arm", and "The autoplan arm"). Every arm gets the same persona:
// - an AskUserQuestion question gets the option marked recommended, else the first option;
// - a prose question (autoplan's gate when it asks in prose) gets "Go with your recommendation.";
// - a session that ends with no plan-changes block and no limit stop gets "Go with your recommendation and finish." as
//   its next turn, once (the driver's followUp fires only at a success result, so a limit stop never gets it).
// The harness's user simulator (src/usersim/sim.ts) carries the answers. Each answer and the follow-up are counted per
// session from its usersim.ndjson, session.json and the persona's own log, and summed per arm.
import { appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import type { PersonaAnswer } from "../../../src/usersim/persona.ts";
import type { UserScript } from "../../../src/skill-eval/contract/sidecar.ts";
import { REC_REPLY } from "../../../src/trial/review/plan.ts";
import { dxTranscriptParse } from "./parse.ts";

export const DX_REPLY = REC_REPLY;
export const DX_FINISH = "Go with your recommendation and finish.";
export const DX_PERSONA = "You take every recommendation. To a question with options you pick the option marked recommended, else the first option. To a question in prose you answer exactly " + JSON.stringify(DX_REPLY);
const RECOMMENDED = /\brecommended\b/i;
export const DX_REC_USER: UserScript = { persona: DX_PERSONA };
export const DX_REC_USER_SHA256 = createHash("sha256").update(JSON.stringify({ persona: DX_PERSONA, reply: DX_REPLY, finish: DX_FINISH, recommended: RECOMMENDED.source })).digest("hex");

export type AnswerRule = "recommended" | "first" | "prose";
/** One question as the simulator words it (the question, then "- label: description" per option) to its answer and the rule that chose it. */
export function dxAnswer(question: string): { text: string; rule: AnswerRule } {
  const options = question.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  if (!options.length) return { text: DX_REPLY, rule: "prose" };
  const label = (o: string) => (o.includes(": ") ? o.slice(0, o.indexOf(": ")) : o).trim();
  const marked = options.find((o) => RECOMMENDED.test(o));
  return marked ? { text: label(marked), rule: "recommended" } : { text: label(options[0]!), rule: "first" };
}

/** The persona's free-form source for the driver; each answer goes to log (persona.ndjson) with the rule that chose it. */
export function dxFreeform(log: string | null): (persona: string, question: string) => Promise<PersonaAnswer> {
  return async (_persona, question) => {
    const a = dxAnswer(question);
    if (log) {
      mkdirSync(dirname(log), { recursive: true });
      appendFileSync(log, JSON.stringify({ rule: a.rule, answer: a.text }) + "\n");
    }
    return { text: a.text };
  };
}

/** The driver's one follow-up: at a success result with no plan-changes block in the transcript so far. */
export const DX_FOLLOW_UP = { text: DX_FINISH, needed: (transcript: string) => dxTranscriptParse(transcript).kind !== "changes" };

export interface AnswerCounts {
  /** AskUserQuestion questions answered, and how many by each rule. */
  asks: number;
  recommended: number;
  first: number;
  /** Prose questions answered with the recommendation. */
  prose: number;
  /** Answers the simulator did not pass on as the persona gave them (a gated effect, its cap, no persona). */
  not_rec: number;
  /** The one follow-up turn was sent. */
  finish: boolean;
}

const lines = (text: string | null): Record<string, any>[] => (text ?? "").split("\n").filter((l) => l.trim()).flatMap((l) => {
  try {
    return [JSON.parse(l)];
  } catch {
    return [];
  }
});

/** One session's answer counts, from its usersim.ndjson, its persona.ndjson and its session.json (each null when absent). */
export function answerCounts(usersim: string | null, personaLog: string | null, session: string | null): AnswerCounts {
  const events = lines(usersim).filter((e) => e.kind === "ask" || e.kind === "prose");
  const rules = lines(personaLog);
  let finish = false;
  try {
    finish = session ? JSON.parse(session).follow_up === true : false;
  } catch {
    finish = false;
  }
  return {
    asks: events.filter((e) => e.kind === "ask").length,
    recommended: rules.filter((r) => r.rule === "recommended").length,
    first: rules.filter((r) => r.rule === "first").length,
    prose: events.filter((e) => e.kind === "prose").length,
    not_rec: events.filter((e) => e.source !== "freeform").length,
    finish,
  };
}

/** Whether the persona answered, and every answer reached the session as the persona gave it (autoplan's gate answered rec). */
export const answeredRec = (c: AnswerCounts): boolean => c.asks + c.prose > 0 && c.not_rec === 0;

/** Per-arm sums of the sessions' counts, with the number of sessions that got the follow-up. */
export function armAnswerCounts(sessions: ReadonlyArray<{ arm: string; answers: AnswerCounts }>): Record<string, Omit<AnswerCounts, "finish"> & { sessions: number; finish: number }> {
  const out: Record<string, Omit<AnswerCounts, "finish"> & { sessions: number; finish: number }> = {};
  for (const { arm, answers: a } of sessions) {
    const o = (out[arm] ??= { sessions: 0, asks: 0, recommended: 0, first: 0, prose: 0, not_rec: 0, finish: 0 });
    o.sessions++;
    o.asks += a.asks;
    o.recommended += a.recommended;
    o.first += a.first;
    o.prose += a.prose;
    o.not_rec += a.not_rec;
    o.finish += a.finish ? 1 : 0;
  }
  return out;
}
