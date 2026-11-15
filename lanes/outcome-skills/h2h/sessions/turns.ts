// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head's turns (post section 4), pure and keyless: the task text T, each arm's scripted turns per entry from
// prereg.json's entries, the frozen question reply and continuation, and the DONE rule. Every text comes from prereg.json
// through readPrereg; nothing here retypes one. h2h_rules.py holds the same DONE rule for the session loop, and
// tests/outcome-skills/h2h-turns.test.ts checks the two agree on every fixture.
import { h2hFail, readPrereg, type H2hPrereg } from "../prereg.ts";
import type { Entry, H2hArm, H2hUnit } from "../types.ts";

export const STATEMENT = "{problem statement}";
/** The GSD onboarding turn that stage 0 may put ahead of /gsd-debug on bug units (prereg.json entry_rule). */
export const GSD_ONBOARD = "/gsd-onboard";

/** JavaScript's String.prototype.trimEnd, so a statement file's trailing newline never adds lines to T. */
const trimEnd = (s: string) => s.replace(/\s+$/u, "");

/** T: texts.task with the problem statement in place of {problem statement}, the statement's trailing whitespace removed. */
export function taskText(statement: string, p: H2hPrereg = readPrereg()): string {
  const s = trimEnd(statement);
  if (!s.trim()) h2hFail("E_H2H_SESSION_INPUT", "the problem statement is empty; T needs the unit's statement");
  if (p.texts.task.split(STATEMENT).length !== 2) h2hFail("E_H2H_PREREG", "texts.task holds " + STATEMENT + " " + (p.texts.task.split(STATEMENT).length - 1) + " times, not once");
  return p.texts.task.replace(STATEMENT, () => s);
}

/** The entry a unit uses: O units their bug or feature tag, security and browser units the bug entry in every arm. */
export const entryOf = (u: Pick<H2hUnit, "kind" | "entry">): Entry => (u.kind === "O" ? u.entry : "bug");

/**
 * The arm's scripted turns for one entry, in order (prereg.json entry_rule): a string ending in a space is a prefix for T,
 * the empty string is T alone, and any other string is a whole turn. gstack-oneline's T is T, a blank line, then
 * texts.oneline. gsdOnboard puts the onboarding turn ahead of GSD's bug entry, the one entry stage 0 may change.
 */
export function scriptedTurns(arm: H2hArm, entry: Entry, statement: string, o: { prereg?: H2hPrereg; gsdOnboard?: boolean } = {}): string[] {
  const p = o.prereg ?? readPrereg();
  const list = p.entries[arm]?.[entry];
  if (!list?.length) return h2hFail("E_H2H_SESSION_INPUT", "arm " + arm + " has no " + entry + " entry in prereg.json; gstack-qa runs B1 units only, on its bug entry");
  const t = arm === "gstack-oneline" ? taskText(statement, p) + "\n\n" + p.texts.oneline : taskText(statement, p);
  const turns = list.map((e) => (e === "" || e.endsWith(" ") ? e + t : e));
  if (!turns.some((x) => x.includes(t))) h2hFail("E_H2H_PREREG", "arm " + arm + "'s " + entry + " entry never carries T");
  if (o.gsdOnboard && arm === "gsd" && entry === "bug" && turns[0] !== GSD_ONBOARD) return [GSD_ONBOARD, ...turns];
  return turns;
}

/** Everything one session's loop needs: the scripted turns, the continuation, the question reply and the cap. */
export interface TurnPlan { arm: H2hArm; entry: Entry; scripted: string[]; continuation: string; question_reply: string; continuation_cap: number }
export function turnPlan(arm: H2hArm, entry: Entry, statement: string, o: { prereg?: H2hPrereg; gsdOnboard?: boolean } = {}): TurnPlan {
  const p = o.prereg ?? readPrereg();
  return { arm, entry, scripted: scriptedTurns(arm, entry, statement, { ...o, prereg: p }), continuation: p.texts.continuation, question_reply: p.texts.question_reply, continuation_cap: p.continuation_cap };
}

/** One line of a final message with markdown markers and punctuation stripped: every Unicode punctuation or symbol
 *  character goes, then the spaces at both ends. */
export const bareLine = (line: string): string => line.replace(/[\p{P}\p{S}]/gu, "").trim();

/** The DONE rule (section 4, prereg.json done_rule): any of the last 3 non-empty lines of the turn's final message, with
 *  markdown markers and punctuation stripped and case ignored, is the word DONE. A turn with no final message has none. */
export function hasDone(finalMessage: string | null | undefined, p: H2hPrereg = readPrereg()): boolean {
  const r = p.done_rule;
  if (!finalMessage) return false;
  const lines = finalMessage.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "").slice(-r.last_nonempty_lines);
  const word = r.case_insensitive ? r.word.toLowerCase() : r.word;
  return lines.some((l) => (r.case_insensitive ? bareLine(l).toLowerCase() : bareLine(l)) === word);
}
