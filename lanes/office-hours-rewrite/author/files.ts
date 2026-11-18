// Copyright (c) 2026 Garry Tan. MIT License.
// Brief files for the office-hours rewrite eval's authoring (prereg section 3, "Key", "Unanimous key" and "Sealing";
// pre-run change 1 item 4e): reading an author's reply into opening.md, sheet.json, key.json and, on T8, prior.json in
// types.ts's shapes; the shape checks each file must pass; the twin check that keeps a pair's second twin to the
// partner's opening and facts except the decisive ones; and the digest every check binds. It reuses the founder lane's
// reply reader, sheet shape check and JSON writers.
import { jsonObject, keyJson, readFiles, sha256, sheetJson, sheetProblem } from "../../office-hours-founder/author/files.ts";
import { words } from "../../office-hours-founder/author/screens.ts";
import type { BuilderGoal, Key, PriorSession, Sheet } from "../types.ts";
import { GOAL_QUESTION_WORDS, GOAL_WORDS, PRIOR_DATES } from "./prompts.ts";

export interface BriefFiles {
  opening: string;
  sheet: Sheet;
  key: Key;
  prior: PriorSession | null;
}

/** What an author's reply must hold for its role. A second twin writes only its sheet and key over the partner's opening. */
export type Role = "first" | "second" | "unpaired";
export interface ReadSpec {
  role: Role;
  /** Set on a builder brief: its sheet must hold the goal fact. */
  goal: BuilderGoal | null;
  /** T8 writes prior.json. */
  prior: boolean;
  /** The brief's own id and its twin's, so key.json's twin is fixed before any check binds the digest. */
  twin: string | null;
  /** The partner's opening, on a second twin. */
  opening?: string;
}

export const fileNames = (s: Pick<ReadSpec, "role" | "prior">): string[] => [...(s.role === "second" ? [] : ["opening.md"]), "sheet.json", "key.json", ...(s.prior ? ["prior.json"] : [])];

const str = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return jsonObject(text);
  }
};
const holds = (text: string, phrase: string) => (" " + words(text).join(" ") + " ").includes(" " + words(phrase).join(" ") + " ");

/** Item 4e: a builder sheet holds one fact stating its goal, whose reveal_when covers a goal or mode question. */
export function goalFactProblem(sheet: Sheet, goal: BuilderGoal): string | null {
  const ok = sheet.facts.some((f) => GOAL_WORDS[goal].some((w) => holds(f.text, w)) && GOAL_QUESTION_WORDS.some((w) => holds(f.reveal_when, w)));
  return ok ? null : "sheet.json holds no fact stating the goal (" + goal + ") with a reveal_when that covers a goal or mode question";
}

/** Key shape for a role: call, 2 to 4 actions, 1 or 2 decisive ids on the sheet, a traction flag, and the role's contrast. */
export function keyProblem(v: unknown, sheet: Sheet, s: ReadSpec): string | null {
  const k = v as Record<string, unknown>;
  if (!k || typeof k !== "object" || !str(k.call)) return "key.json needs a call";
  if (!Array.isArray(k.actions) || k.actions.length < 2 || k.actions.length > 4 || !k.actions.every(str)) return "key.json needs 2 to 4 actions";
  if (!Array.isArray(k.decisive) || k.decisive.length < 1 || k.decisive.length > 2 || !k.decisive.every(str)) return "key.json needs 1 or 2 decisive fact ids";
  const ids = new Set(sheet.facts.map((f) => f.id));
  if (!k.decisive.every((id) => ids.has(id as string)) || new Set(k.decisive).size !== k.decisive.length) return "a decisive fact is not on the sheet or repeats";
  if (typeof k.traction !== "boolean") return "key.json needs traction as true or false";
  if (s.goal && k.traction !== false) return "a builder key's traction is false";
  if (s.role === "unpaired" && !str(k.wrong_call)) return "an unpaired key needs a wrong_call";
  if (s.role === "first" && !str(k.twin_call)) return "a first twin's key needs a twin_call";
  return null;
}

export function priorProblem(v: unknown): string | null {
  const p = v as Record<string, unknown>;
  if (!p || typeof p !== "object" || !str(p.assignment) || !str(p.test) || !str(p.condition)) return "prior.json needs an assignment, a test and a condition";
  if (p.date !== PRIOR_DATES.date || p.test_date !== PRIOR_DATES.test_date) return "prior.json's dates must be " + PRIOR_DATES.date + " and " + PRIOR_DATES.test_date;
  return null;
}

/** Reads an author's reply into a brief and its first twin's twin_call. A string is the problem. */
export function readBrief(reply: string, s: ReadSpec): { files: BriefFiles; twinCall: string | null } | string {
  const got = readFiles(reply, fileNames(s));
  if (typeof got === "string") return got;
  const opening = s.role === "second" ? s.opening! : got["opening.md"]!;
  const sheet = parse(got["sheet.json"]!) as Sheet;
  const sp = sheetProblem(sheet, true);
  if (sp) return sp;
  if (s.goal) {
    const g = goalFactProblem(sheet, s.goal);
    if (g) return g;
  }
  const raw = parse(got["key.json"]!) as Record<string, unknown>;
  const kp = keyProblem(raw, sheet, s);
  if (kp) return kp;
  let prior: PriorSession | null = null;
  if (s.prior) {
    const p = parse(got["prior.json"]!) as PriorSession;
    const pp = priorProblem(p);
    if (pp) return pp;
    prior = { date: p.date, assignment: p.assignment, test: p.test, test_date: p.test_date, condition: p.condition };
  }
  const key: Key = { call: raw.call as string, actions: raw.actions as string[], decisive: raw.decisive as string[], twin: s.twin, traction: raw.traction as boolean, wrong_call: s.role === "unpaired" ? (raw.wrong_call as string) : null };
  return { files: { opening: opening.trim() + "\n", sheet: { persona: sheet.persona, facts: sheet.facts.map((f) => ({ id: f.id, text: f.text, reveal_when: f.reveal_when, kind: f.kind })) }, key, prior }, twinCall: s.role === "first" ? (raw.twin_call as string) : null };
}

/**
 * Section 3's twins: same opening word for word and one hidden decisive fact apart. The second twin keeps the partner's
 * persona and fact ids, every fact outside either key's decisive ids unchanged, at least one decisive fact rewritten,
 * and a call of its own.
 */
export function twinProblem(first: BriefFiles, second: BriefFiles): string | null {
  if (first.opening !== second.opening) return "the twins' openings differ";
  if (first.sheet.persona !== second.sheet.persona) return "the twin changed the persona";
  const ids = (b: BriefFiles) => b.sheet.facts.map((f) => f.id).sort().join(" ");
  if (ids(first) !== ids(second)) return "the twin changed the fact ids";
  const decisive = new Set([...first.key.decisive, ...second.key.decisive]);
  const byId = new Map(first.sheet.facts.map((f) => [f.id, f]));
  for (const f of second.sheet.facts) {
    const a = byId.get(f.id)!;
    const same = a.text === f.text && a.reveal_when === f.reveal_when && a.kind === f.kind;
    if (!decisive.has(f.id) && !same) return "the twin changed fact " + f.id + ", which is not decisive";
  }
  if (![...decisive].some((id) => byId.get(id)!.text !== second.sheet.facts.find((f) => f.id === id)!.text)) return "the twin rewrote no decisive fact";
  if (words(first.key.call).join(" ") === words(second.key.call).join(" ")) return "the twins make the same call";
  return null;
}

export const priorJson = (p: PriorSession): string => JSON.stringify(p, null, 2) + "\n";
export { keyJson, sheetJson };

/** sha256 over the brief's current opening.md, sheet.json, key.json and, on T8, prior.json, as written. */
export const digestOf = (b: BriefFiles): string => sha256([b.opening, sheetJson(b.sheet), keyJson(b.key), ...(b.prior ? [priorJson(b.prior)] : [])].join("\0"));
