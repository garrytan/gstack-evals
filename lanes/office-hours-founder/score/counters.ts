// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's mechanical counters (prereg section 8), read from the main agent's own text per reply
// (parse.ts replies), with each reply's first-move block cut off. Frozen rules:
// - A sentence ends at a full stop, question mark or exclamation mark followed by white space, or at a line break. A
//   question is a sentence whose last character, after closing quotes, brackets and markdown marks, is a question mark.
// - A push repeats the previous question's subject: a reply after the first holds a question that shares at least two
//   content words with the last question of the reply before it. A reply counts once. Content words are lowercased runs
//   of letters, digits and apostrophes, longer than three characters, outside a fixed stop list.
// - A reply recommends what to build or sell when it holds a parsable first-move block, or a sentence that is not a
//   question, holds a recommending phrase and an action word, and holds no deferring phrase. The order check reads the
//   first such reply; first_recommendation_reply is the number of founder turns before it (0 for the first reply).
import { parseFirstMove, replies } from "../parse.ts";
import { beforeBlock } from "./exposure.ts";

const STOP = new Set("what what's that that's this with your you're have does doing they them their there they're would could should about when which will from into been were also just more most some much very like than then only each here where who's it's".split(" "));
const RECOMMENDING = /\b(?:I (?:would |'d )?(?:recommend|suggest|advise)|my (?:recommendation|advice|suggestion) is|recommendation:|you should|start by|your first move|the first move)/i;
const ACTION = /\b(?:build|building|sell|selling|launch|launching|offer|offering|charge|charging|ship|shipping|target|targeting|pitch|pitching|start with|focus on)\b/i;
const DEFERRING = /\b(?:before|until|not yet|too early|can't|cannot|won't|don't want to)\b[^.]*\b(?:recommend|suggest|advise)/i;

export const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
export const isQuestion = (s: string): boolean => /\?$/.test(s.replace(/[\s"'\u201d\u2019)\]*_]+$/, ""));
export const contentWords = (s: string): Set<string> => new Set((s.toLowerCase().replace(/\u2019/g, "'").match(/[a-z0-9']+/g) ?? []).filter((w) => w.length > 3 && !STOP.has(w)));
export const recommends = (s: string): boolean => !isQuestion(s) && RECOMMENDING.test(s) && ACTION.test(s) && !DEFERRING.test(s);

/** Questions, pushes and the order check's reply, from one session's transcript. */
export function counters(transcript: string): { questions: number; pushes: number; first_recommendation_reply: number | null } {
  const all = replies(transcript);
  const asked = all.map((texts) => sentences(beforeBlock(texts.join("\n\n"))).filter(isQuestion));
  let pushes = 0;
  for (let k = 1; k < asked.length; k++) {
    const last = asked[k - 1]!.at(-1);
    if (!last) continue;
    const subject = contentWords(last);
    if (asked[k]!.some((q) => [...contentWords(q)].filter((w) => subject.has(w)).length >= 2)) pushes++;
  }
  const first = all.findIndex((texts) => parseFirstMove(texts).kind === "block" || sentences(beforeBlock(texts.join("\n\n"))).some(recommends));
  return { questions: asked.reduce((n, q) => n + q.length, 0), pushes, first_recommendation_reply: first < 0 ? null : first };
}
