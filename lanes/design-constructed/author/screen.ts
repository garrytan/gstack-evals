// Copyright (c) 2026 Garry Tan. MIT License.
// Step 3, the keyless structure and vocabulary screen (prereg section 3 step 3), and the 2x screen's two extra checks
// with the needle check (K7). Every failed check is named, so the rewrite note can name it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../errors.ts";
import { ARM_LEAD, AUTHORING, ITEM_CLASSES, STRIP, VOCABULARY_PASS_NAMES, VOCABULARY_WORDS } from "../frozen.ts";
import type { KeyItem } from "../types.ts";
import type { BaseAppView } from "./seams.ts";
import { grams, holdsSequence, normWords, sha256, wordCount } from "./text.ts";
import type { UnitFiles } from "./unit.ts";

/** The skill files the vocabulary screen reads, at the gstack pin (b6155921), with their sha256. */
export const SKILL_FILES = [
  { path: "plan-design-review/SKILL.md", sha256: "5934f10c95119c12e3fe785a9b33cdb608f6214f79a88ea84ac77cdfed6fb820" },
  { path: "plan-design-review/sections/review-sections.md", sha256: "262d857596134531e5b3e20e1d491afcf2083f798e05f6d5edcc566b3b000ddd" },
  { path: "plan-design-review/sections/checklist.md", sha256: "1844bcab2e3e9b458698af93deb6442e10ebf3ee87789497f490a3f99cbffd41" },
] as const;

/** The barred 5-word sequences from the given texts and the lens line. */
export const vocabularyFrom = (texts: readonly string[]): Set<string> => new Set([...texts, ARM_LEAD.lens!].flatMap((t) => grams(normWords(t), AUTHORING.vocabularyRun)));

/** Reads the three skill files from a gstack checkout at the pin, refusing any whose sha256 differs. */
export function loadVocabulary(gstackDir: string): Set<string> {
  const texts = SKILL_FILES.map((f) => {
    const bytes = readFileSync(join(gstackDir, f.path));
    const got = sha256(bytes);
    if (got !== f.sha256) fail("E_USAGE", f.path + " has sha256 " + got + ", not the pinned " + f.sha256 + "; check out gstack at the pin");
    return bytes.toString("utf8");
  });
  return vocabularyFrom(texts);
}

/**
 * BT: the frozen list of common first names for the name check. A hit is one of these, any case of its first letter,
 * followed by a surname-shaped word: a capital letter then at least one lowercase letter, with no digits. Names that are
 * also common English or colour words (Mark, Frank, Jack, Grace, Amber) are left out, so a label like "Amber Badge" isn't a hit.
 */
export const FIRST_NAMES = (
  "james john robert michael william david richard joseph thomas charles christopher daniel matthew anthony donald steven paul andrew joshua " +
  "kenneth kevin brian george timothy ronald edward jason jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott brandon " +
  "benjamin samuel gregory alexander patrick raymond dennis jerry tyler aaron jose adam nathan henry douglas zachary peter kyle " +
  "mary patricia jennifer linda elizabeth barbara susan jessica sarah karen lisa nancy betty margaret sandra ashley kimberly emily donna michelle " +
  "carol amanda dorothy melissa deborah stephanie rebecca sharon laura cynthia kathleen amy angela shirley anna brenda pamela emma nicole helen " +
  "samantha katherine christine debra rachel carolyn janet catherine maria heather diane ruth julie olivia joyce virginia victoria kelly lauren " +
  "christina joan evelyn judith megan andrea cheryl hannah jacqueline martha gloria teresa ann sara madison frances kathryn janice jean abigail " +
  "alice julia judy sophia denise doris marilyn danielle beverly isabella theresa diana natalie brittany charlotte marie kayla alexis " +
  "lori priya wei mohammed ahmed fatima aisha raj arjun yuki hiroshi mei li chen ana sofia lucas mateo diego carlos luis juan pedro"
).split(" ");

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monthOf = (m: string): number => MONTHS.findIndex((x) => x.startsWith(m.toLowerCase().slice(0, 3))) + 1;
const iso = (y: number, m: number, d: number): string => String(y).padStart(4, "0") + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");

/**
 * BT: the dates the screen reads, as ISO days in text order. Forms: 2026-08-14, 2026/08/14, "August 14, 2026",
 * "Aug 14 2026", "14 August 2026" and "August 2026" (read as its first day).
 */
export function datesIn(text: string): string[] {
  const found: { at: number; day: string }[] = [];
  const add = (at: number, y: number, m: number, d: number) => {
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2999) found.push({ at, day: iso(y, m, d) });
  };
  for (const m of text.matchAll(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g)) add(m.index!, +m[1]!, +m[2]!, +m[3]!);
  const taken = new Set<number>();
  for (const m of text.matchAll(new RegExp("\\b" + MONTH_RE + "\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b", "gi"))) {
    add(m.index!, +m[3]!, monthOf(m[1]!), +m[2]!);
    taken.add(m.index!);
  }
  for (const m of text.matchAll(new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+" + MONTH_RE + "\\.?,?\\s+(\\d{4})\\b", "gi"))) {
    add(m.index!, +m[3]!, monthOf(m[2]!), +m[1]!);
    taken.add(m.index! + m[0].indexOf(m[2]!));
  }
  for (const m of text.matchAll(new RegExp("\\b" + MONTH_RE + "\\.?,?\\s+(\\d{4})\\b", "gi"))) if (!taken.has(m.index!)) add(m.index!, +m[2]!, monthOf(m[1]!), 1);
  return found.sort((a, b) => a.at - b.at).map((f) => f.day);
}

/** BT: the plan's date is the first date plan.md states, else the authoring date. */
export const planDate = (plan: string, today: string): string => datesIn(plan)[0] ?? today;

/** The name check's hits: a listed first name before a surname-shaped word, an email address or an @handle. */
export function namesIn(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(/\b([A-Z][a-z]+)(?=\s+([A-Z][a-z]+)\b)/g)) if (FIRST_NAMES.includes(m[1]!.toLowerCase())) hits.push(m[1] + " " + m[2]);
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) hits.push(m[0]);
  for (const m of text.matchAll(/(?<![A-Za-z0-9_.@/-])@[A-Za-z0-9_][A-Za-z0-9_-]{1,38}(?![A-Za-z0-9_/@-]|\.[A-Za-z0-9])/g)) if (!hits.some((h) => h.includes(m[0]))) hits.push(m[0]);
  return hits;
}

/** Section 4's strip list as path segments: an evidence path holding any of them bears an instruction-file name. */
const INSTRUCTION_NAMES = new Set([...STRIP.filesAnyDepth.filter((f) => !f.includes("/")), ...STRIP.foldersAnyDepth, ...STRIP.namesAnyType].map((n) => n.toLowerCase()));
export const bearsInstructionName = (path: string): boolean => path.split("/").some((seg) => INSTRUCTION_NAMES.has(seg.toLowerCase()));

/** BT: the docs folder is docs/ at the repository root (the author prompt has the author create it when missing). */
export const DOCS_DIR = "docs/";

export interface Failure {
  check: string;
  detail: string;
}

export interface ScreenResult {
  pass: boolean;
  failures: Failure[];
}

const leaves = (v: unknown): string[] => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(leaves) : []);

/** The texts the vocabulary and name checks read: plan.md, context/project.md, each evidence file and key.json's strings. */
export function unitTexts(u: UnitFiles): { file: string; text: string }[] {
  const keyStrings = [...u.key.items.flatMap((i) => [i.statement, i.detail]), ...u.key.wrongWay, ...(u.key.decoy ? [u.key.decoy] : [])];
  return [{ file: "plan.md", text: u.plan }, ...(u.context !== null ? [{ file: "context/project.md", text: u.context }] : []), ...u.evidence.map((e) => ({ file: e.path, text: e.text })), ...leaves(keyStrings).map((text) => ({ file: "key.json", text }))];
}

/** The vocabulary hits in one text: barred 5-word sequences, pass names and barred words, whole words in any case. */
export function vocabularyHits(text: string, vocabulary: ReadonlySet<string>): string[] {
  const w = normWords(text);
  const hits = grams(w, AUTHORING.vocabularyRun).filter((g) => vocabulary.has(g));
  for (const term of [...VOCABULARY_PASS_NAMES, ...VOCABULARY_WORDS]) if (holdsSequence(w, normWords(term))) hits.push(term);
  return [...new Set(hits)];
}

const lineCount = (text: string): number => text.split("\n").length;

/**
 * Step 3 on a unit version. items limits the per-item checks (all items at intake; never fewer at the base tier).
 * The context check runs once the context writer has run.
 */
export function screenUnit(u: UnitFiles, app: BaseAppView, o: { vocabulary: ReadonlySet<string>; today: string }): ScreenResult {
  const f: Failure[] = [];
  const add = (check: string, detail: string) => f.push({ check, detail });
  const A = AUTHORING;
  const pw = wordCount(u.plan);
  if (pw < A.planWords[0] || pw > A.planWords[1]) add("plan-words", "plan.md has " + pw + " words, not " + A.planWords[0] + " to " + A.planWords[1]);
  if (u.evidence.length < A.evidenceFiles[0] || u.evidence.length > A.evidenceFiles[1]) add("evidence-files", u.evidence.length + " evidence files, not " + A.evidenceFiles[0] + " to " + A.evidenceFiles[1]);
  const ew = u.evidence.reduce((s, e) => s + wordCount(e.text), 0);
  if (ew < A.evidenceWords[0] || ew > A.evidenceWords[1]) add("evidence-words", "the evidence files hold " + ew + " words, not " + A.evidenceWords[0] + " to " + A.evidenceWords[1]);
  if (u.context !== null && wordCount(u.context) > A.contextMaxWords) add("context-words", "context/project.md has " + wordCount(u.context) + " words, over " + A.contextMaxWords);

  const classes = u.key.items.map((i) => i.class);
  if (u.key.items.length !== A.itemsPerKey || ITEM_CLASSES.some((c) => classes.filter((x) => x === c).length !== 1)) add("classes", "the key has " + u.key.items.length + " items in classes " + classes.join(",") + ", not five, one in each class");

  const tree = new Set(app.tree);
  const evidence = new Map(u.evidence.map((e) => [e.path, e.text]));
  if (evidence.size !== u.evidence.length) add("evidence-paths", "two evidence files share a path");
  for (const e of u.evidence) {
    if (tree.has(e.path)) add("evidence-paths", e.path + " already exists in the base app");
    if (!e.path.startsWith(DOCS_DIR) || e.path.split("/").some((s) => s === ".." || s === "." || s === "")) add("evidence-paths", e.path + " is not under " + DOCS_DIR);
    if (bearsInstructionName(e.path)) add("evidence-paths", e.path + " bears an instruction-file name");
  }
  for (const i of u.key.items) {
    const sw = wordCount(i.statement);
    if (sw > A.statementMaxWords) add("statement-words", i.id + "'s statement has " + sw + " words, over " + A.statementMaxWords);
    const dw = wordCount(i.detail);
    if (dw > A.detailMaxWords) add("detail-words", i.id + "'s detail has " + dw + " words, over " + A.detailMaxWords);
    if (!i.evidence.length) add("pointers", i.id + " has no evidence pointer");
    for (const p of i.evidence) {
      const text = evidence.get(p.file) ?? (tree.has(p.file) ? app.read(p.file) : null);
      if (text === null) add("pointers", i.id + " points to " + p.file + ", which doesn't exist");
      else if (p.line < 1 || p.line > lineCount(text)) add("pointers", i.id + " points to line " + p.line + " of " + p.file + ", which has " + lineCount(text) + " lines");
    }
    if (i.class === "Y" && !i.evidence.some((p) => tree.has(p.file) && !evidence.has(p.file))) add("y-file", i.id + " (Y) cites no file that exists in the base app");
  }

  const planDay = planDate(u.plan, o.today);
  for (const e of u.evidence) for (const d of datesIn(e.text)) if (d > planDay) add("dates", e.path + " holds the date " + d + ", after the plan's " + planDay);

  for (const t of unitTexts(u)) {
    for (const n of namesIn(t.text)) add("names", t.file + " holds the name-shaped string " + JSON.stringify(n));
    for (const h of vocabularyHits(t.text, o.vocabulary)) add("vocabulary", t.file + " holds the barred " + JSON.stringify(h));
  }
  return { pass: f.length === 0, failures: f };
}

/**
 * K7's needle stop list (BT): 40 function words. A detail's needle is its words after the vocabulary screen's
 * normalization, minus these.
 */
export const NEEDLE_STOP_WORDS = (
  "a an the and or but nor so of to in on at by for from with without into onto over under than then that this these those " +
  "is are was were be been it its as if not no per each every"
).split(" ");

export const needleOf = (detail: string): string[] => [...new Set(normWords(detail).filter((w) => !NEEDLE_STOP_WORDS.includes(w)))];

/** K7: the evidence files that carry an item's detail: each holds every needle word as a whole word. */
export function carriers(detail: string, evidence: readonly { path: string; text: string }[]): string[] {
  const needle = needleOf(detail);
  if (!needle.length) return [];
  return evidence.filter((e) => {
    const w = new Set(normWords(e.text));
    return needle.every((n) => w.has(n));
  }).map((e) => e.path);
}

/**
 * The 2x screen: step 3 on the 2x files, plus a decoy of at most 30 words, and for each primary item at least two
 * evidence files cited and no single evidence file carrying its detail by the needle check (a detail with no needle
 * word left fails).
 */
export function screen2x(u: UnitFiles, primary: readonly KeyItem[], app: BaseAppView, o: { vocabulary: ReadonlySet<string>; today: string }): ScreenResult {
  const base = screenUnit(u, app, o);
  const f = [...base.failures];
  if (!u.key.decoy || !u.key.decoy.trim()) f.push({ check: "decoy", detail: "the 2x key has no decoy" });
  else if (wordCount(u.key.decoy) > AUTHORING.decoyMaxWords) f.push({ check: "decoy", detail: "the decoy has " + wordCount(u.key.decoy) + " words, over " + AUTHORING.decoyMaxWords });
  const paths = new Set(u.evidence.map((e) => e.path));
  for (const p of primary) {
    const item = u.key.items.find((i) => i.id === p.id);
    if (!item) {
      f.push({ check: "split", detail: p.id + " is missing from the 2x key" });
      continue;
    }
    const cited = new Set(item.evidence.map((e) => e.file).filter((x) => paths.has(x)));
    if (cited.size < AUTHORING.transform2x.minFilesPerItem) f.push({ check: "split", detail: item.id + " cites " + cited.size + " evidence files, not at least " + AUTHORING.transform2x.minFilesPerItem });
    if (!needleOf(item.detail).length) f.push({ check: "needle", detail: item.id + "'s detail has no needle word left" });
    else for (const c of carriers(item.detail, u.evidence)) f.push({ check: "needle", detail: c + " alone carries " + item.id + "'s detail" });
  }
  return { pass: f.length === 0, failures: f };
}
