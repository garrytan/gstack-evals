// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless text checks of the office-hours founder eval's authoring (prereg section 3): the vocabulary screen, the
// real stratum's copy check, and the name scan the run side calls on session text and the recognition probe calls on
// guesses. Every check compares whole words in any case with punctuation stripped: text is lowercased, every run of
// characters that is not a letter or a digit becomes one space, and the words are what is left. So "office-hours" reads
// as "office hours" and "Acme's" as "acme s", which still holds the whole word "acme".
//
// The vocabulary screen's sources are the six forcing questions of phase-2a-startup-diagnostic.md at the pinned gstack
// (each question's "Ask:" line, read from a checkout and refused when the file's sha256 differs from PHASE_2A) and the
// lens arm's first line; it bars any 5-word sequence from them and each of the skill's six named terms.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIRST_LINE } from "../frozen.ts";
import type { Sheet } from "../types.ts";
import { AuthorError, sha256, type UnitFiles } from "./files.ts";
import { NAMED_TERMS } from "./prompts.ts";

/** The pinned file the forcing questions come from, inside a gstack checkout at frozen.ts's GSTACK.sha. */
export const PHASE_2A = { path: "office-hours/sections/phase-2a-startup-diagnostic.md", sha256: "35ed1e419eca359e454b9f18dddcce0aeb553a0ee519a7e635f4f0b7d484a393" } as const;

export const words = (s: string): string[] => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);

const grams = (w: readonly string[], n: number): string[] => Array.from({ length: Math.max(0, w.length - n + 1) }, (_, i) => w.slice(i, i + n).join(" "));

/** True when the word sequence needle appears whole in hay. */
const holds = (hay: readonly string[], needle: readonly string[]): boolean => needle.length > 0 && (" " + hay.join(" ") + " ").includes(" " + needle.join(" ") + " ");

/** The six forcing questions' text: each "Ask:" line of the file, without its quotes. */
export function forcingQuestions(text: string): string[] {
  const asks = [...text.matchAll(/^\*\*Ask:\*\*\s*(.+)$/gm)].map((m) => m[1]!.trim().replace(/^"|"$/g, ""));
  if (asks.length !== 6) throw new AuthorError("E_USAGE", PHASE_2A.path + " holds " + asks.length + " Ask: lines, not the six forcing questions");
  return asks;
}

/** Reads the forcing questions from a gstack checkout, refusing a file whose sha256 differs from the pinned one. */
export function loadForcingQuestions(gstackDir: string): string[] {
  const text = readFileSync(join(gstackDir, PHASE_2A.path));
  const got = sha256(text);
  if (got !== PHASE_2A.sha256) throw new AuthorError("E_USAGE", PHASE_2A.path + " has sha256 " + got + ", not the pinned " + PHASE_2A.sha256 + "; check out the gstack pin");
  return forcingQuestions(text.toString("utf8"));
}

/** The strings of a unit that the vocabulary screen and the copy check read: opening.md, the persona, each fact's text and reveal_when, and every string in key.json. */
export function unitStrings(u: { opening?: string; sheet?: Sheet; key?: unknown }): { file: string; text: string }[] {
  const leaves = (v: unknown): string[] => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(leaves) : []);
  return [
    ...(u.opening ? [{ file: "opening.md", text: u.opening }] : []),
    ...(u.sheet ? [u.sheet.persona, ...u.sheet.facts.flatMap((f) => [f.text, f.reveal_when])].map((text) => ({ file: "sheet.json", text })) : []),
    ...leaves(u.key).map((text) => ({ file: "key.json", text })),
  ];
}

export interface Screen {
  grams: ReadonlySet<string>;
}

/** The vocabulary screen's barred 5-word sequences, from the forcing questions and the lens arm's first line. */
export const vocabulary = (asks: readonly string[]): Screen => ({ grams: new Set([...asks, FIRST_LINE.lens].flatMap((s) => grams(words(s), 5))) });

export interface Hits {
  pass: boolean;
  hits: string[];
  /** The unit files that hold a hit. */
  files: string[];
}

/** Section 3 step 2: no barred 5-word sequence and no named term in the unit's strings. */
export function screenVocabulary(screen: Screen, u: Partial<UnitFiles>): Hits {
  const hits = new Set<string>(), files = new Set<string>();
  for (const s of unitStrings(u)) {
    const w = words(s.text);
    const found = [...grams(w, 5).filter((g) => screen.grams.has(g)), ...NAMED_TERMS.filter((t) => holds(w, words(t)))];
    for (const f of found) hits.add(f);
    if (found.length) files.add(s.file);
  }
  return { pass: hits.size === 0, hits: [...hits], files: [...files] };
}

/** Section 3 step 5 (real stratum): no 6-word sequence of the unit in the fetched pages or the notes, and no word from the Names line in the unit. */
export function copyCheck(u: Partial<UnitFiles>, sources: readonly string[], names: readonly string[]): Hits {
  const source = new Set(sources.flatMap((s) => grams(words(s), 6)));
  const nameWords = new Set(names.flatMap(words));
  const hits = new Set<string>(), files = new Set<string>();
  for (const s of unitStrings(u)) {
    const w = words(s.text);
    const found = [...grams(w, 6).filter((g) => source.has(g)), ...w.filter((x) => nameWords.has(x))];
    for (const f of found) hits.add(f);
    if (found.length) files.add(s.file);
  }
  return { pass: hits.size === 0, hits: [...hits], files: [...files] };
}

/** The name scan: the Names-line entries (a company, a product or a founder) that the text names, whole words, any case. */
export const namesIn = (text: string, names: readonly string[]): string[] => {
  const w = words(text);
  return names.filter((n) => holds(w, words(n)));
};
