// Contract lines: the lines of a skill a diet must not lose (MUST, NEVER, STOP, ask and approval lines, required
// outputs), and how an edited copy treats each one (kept, moved, rewritten or removed).
//
// Ported from GSTA-13's office-hours diet study (quick/lanea-quick/contract-lines/extract.ts in gstack-evals PR #6),
// with its rules unchanged and its git and command-line code replaced by functions over skill directories:
// - Files: SKILL.md, then every .md under sections/ and references/, by path. SKILL.md is always loaded; the others
//   are read on demand. Templates (.tmpl) are skipped.
// - Units are logical lines. Outside fences, consecutive non-blank lines join while the previous one does not end in
//   . ? ! : ; (optionally followed by closing quotes, brackets or emphasis) and the next starts no list item; a
//   blockquote line never continues into a plain line. Headings and table rows are their own units. Front matter and
//   whole-line HTML comments are skipped. Shell fences are skipped whole; in other fences only output-format lines
//   count (a heading, or an ALL-CAPS label such as "PREMISES:").
// - Normalization strips list, heading and blockquote markers, straightens quotes, drops backticks and emphasis, and
//   collapses whitespace. Case is kept.
// - A contract line is a unit whose normalized text matches a category rule below; every format line counts as output.
// - Against an edited copy: kept is an exact normalized match in its SKILL.md; moved is an exact match only in its
//   on-demand files; rewritten has no exact match but a Sorensen-Dice similarity of at least 0.5 to some unit;
//   removed is the rest. Exact pairing is a multiset match, same file first.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const EXTRACTOR_VERSION = 1;

export type LineCategory = "must" | "never" | "stop" | "prohibition" | "ask" | "output";
export type UnitKind = "prose" | "heading" | "table" | "format";
export type Load = "always" | "on-demand";
export type LineClass = "kept" | "moved" | "rewritten" | "removed";

export interface SkillFile {
  /** Relative to the skill directory, with forward slashes. */
  path: string;
  text: string;
  sha256: string;
  load: Load;
}

export interface Unit {
  file: string;
  line: number;
  end_line: number;
  kind: UnitKind;
  heading: string;
  norm: string;
}

export interface ContractLine extends Unit {
  /** "B:<file without sections/ and .md>:<line padded to 4>", as GSTA-13's study numbers them. */
  id: string;
  categories: LineCategory[];
}

const SHELL_FENCE = /^(?:bash|sh|shell|zsh|console)$/i;
const FORMAT_LINE = [/^#{1,6}\s+\S/, /^(?:[A-Z][A-Z0-9_]+(?:\s+[A-Z0-9<>_]+)*|[A-Z]<N>)(?:\s*\([^)]*\))?\s*(?::|—)/];

export const CATEGORY_RULES: Record<LineCategory, RegExp[]> = {
  must: [/\bmust\b/i, /\bALWAYS\b/, /\b(?:required|mandatory|non-negotiable)\b/i],
  never: [/\bnever\b/i],
  stop: [/\bSTOP\b/, /\bstop (?:immediately|here|the loop|and (?:wait|read|reassess))\b/i],
  prohibition: [/\b(?:do not|don['’]t|does not|doesn['’]t|must not|should not|cannot|can['’]t|may not)\b/i, /\bNOT\b/, /\bskips?\b/i, /\bavoid\b/i],
  ask: [/\bAskUserQuestion\b/, /\bask(?:s|ing)?\b/i, /\bapprov(?:e|es|ed|al)\b/i, /\bconfirm(?:s|ed|ation)?\b/i, /\bwait(?:s|ing)?\b/i, /\buser responds\b/i],
  output: [
    /\boutput\b/i,
    /\bformat\b/i,
    /\b(?:header|heading)s?\b/i,
    /\b(?:design doc(?:ument)?s?|wireframe|mockups?|sketch|screenshot|assignment)\b/i,
    /\b(?:write|writes|save|saves|append|appends|log|print|emit|present|show|display)\b[^.]*?(?:\.(?:md|json|jsonl|html|png)\b|\bfile\b|\bline\b|\bentry\b)/i,
    /\b(?:say|says|display|tell the user)\b[^.]{0,60}?["“:]/i,
  ],
};

const STOPWORDS = new Set(
  ("a an the and or of to in on for with by at as is are be been it its this that these those from into than then so if when while which who " +
    "what your you we our their they them he she i me my his her there here will would can could should may might just also only any each").split(" "),
);
export const REWRITE_THRESHOLD = 0.5;

/** sha256 over every rule above, so a lock records which extractor listed its lines. */
export const EXTRACTOR_SHA256 = createHash("sha256")
  .update(JSON.stringify({ version: EXTRACTOR_VERSION, shell: String(SHELL_FENCE), format: FORMAT_LINE.map(String), categories: Object.entries(CATEGORY_RULES).map(([k, v]) => [k, v.map(String)]), stopwords: [...STOPWORDS], threshold: REWRITE_THRESHOLD }))
  .digest("hex");

export function normalize(s: string): string {
  return s
    .replace(/^\s*(?:>\s?)+/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6})\s+/, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/`/g, "")
    .replace(/\*\*|__/g, "")
    .replace(/(?<=^|[\s(["'])\*(?=\S)(.+?)(?<=\S)\*(?=$|[\s).,;:!?"'\]])/g, "$1")
    .replace(/(?<=^|[\s(["'])_(?=\S)(.+?)(?<=\S)_(?=$|[\s).,;:!?"'\]])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const TERMINAL = /[.?!:;]["'”’)\]*_`]*\s*$/;
const LIST_MARKER = /^\s*(?:[-*+]\s|\d+[.)]\s|[A-Z]\)\s)/;

export function parseUnits(file: string, text: string): Unit[] {
  const lines = text.split("\n");
  const units: Unit[] = [];
  let i = 0;
  if (lines[0] === "---") {
    i = 1;
    while (i < lines.length && lines[i] !== "---") i++;
    i++;
  }
  let fence: string | null = null;
  let heading = "";
  let cur: { unit: Unit; raw: string; quote: boolean; last: string } | null = null;
  const flush = () => {
    if (cur) {
      cur.unit.norm = normalize(cur.raw);
      if (cur.unit.norm) units.push(cur.unit);
    }
    cur = null;
  };
  for (; i < lines.length; i++) {
    const ln = lines[i] ?? "";
    const n = i + 1;
    const fm = ln.match(/^\s*(?:>\s*)?(```+|~~~+)\s*([\w-]*)/);
    if (fm) {
      flush();
      fence = fence === null ? (fm[2] ?? "") : null;
      continue;
    }
    const t = ln.trim();
    if (fence !== null) {
      if (!SHELL_FENCE.test(fence) && FORMAT_LINE.some((r) => r.test(t))) units.push({ file, line: n, end_line: n, kind: "format", heading, norm: normalize(t) });
      continue;
    }
    if (!t || /^<!--.*-->$/.test(t) || /^(?:-{3,}|\*{3,})$/.test(t) || /^>\s*$/.test(t)) {
      flush();
      continue;
    }
    const hm = t.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      flush();
      heading = normalize(hm[2] ?? "");
      units.push({ file, line: n, end_line: n, kind: "heading", heading, norm: heading });
      continue;
    }
    if (t.startsWith("|")) {
      flush();
      if (!/^\|[-:|\s]+\|$/.test(t)) units.push({ file, line: n, end_line: n, kind: "table", heading, norm: normalize(t) });
      continue;
    }
    const quote = t.startsWith(">");
    const body = quote ? t.replace(/^(?:>\s?)+/, "") : t;
    const c = cur as { unit: Unit; raw: string; quote: boolean; last: string } | null;
    if (c && !TERMINAL.test(c.last) && !LIST_MARKER.test(body) && (quote === c.quote || !quote)) {
      c.raw += " " + body;
      c.unit.end_line = n;
      c.last = body;
    } else {
      flush();
      cur = { unit: { file, line: n, end_line: n, kind: "prose", heading, norm: "" }, raw: body, quote, last: body };
    }
  }
  flush();
  return units;
}

export function lineCategories(u: Unit): LineCategory[] {
  if (u.kind === "format") return ["output"];
  return (Object.keys(CATEGORY_RULES) as LineCategory[]).filter((c) => CATEGORY_RULES[c].some((r) => r.test(u.norm)));
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** SKILL.md, then every .md under sections/ and references/, by path. */
export function readSkillFiles(dir: string): SkillFile[] {
  const found: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".md")) found.push(relative(dir, p).split("\\").join("/"));
    }
  };
  for (const sub of ["sections", "references"]) if (existsSync(join(dir, sub))) walk(join(dir, sub));
  const paths = [...(existsSync(join(dir, "SKILL.md")) ? ["SKILL.md"] : []), ...found.sort()];
  return paths.map((path) => {
    const text = readFileSync(join(dir, path), "utf8");
    return { path, text, sha256: sha256(text), load: path === "SKILL.md" ? "always" : "on-demand" };
  });
}

export const lineId = (u: Unit) => "B:" + u.file.replace(/^sections\//, "").replace(/\.md$/, "") + ":" + String(u.line).padStart(4, "0");

export function contractLines(files: readonly SkillFile[]): ContractLine[] {
  return files.flatMap((f) => parseUnits(f.path, f.text)).flatMap((u) => {
    const categories = lineCategories(u);
    return categories.length ? [{ ...u, id: lineId(u), categories }] : [];
  });
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9#<>/._'-]+/g, " ")
    .split(" ")
    .map((w) => w.replace(/^[.'_/-]+|[.'_/-]+$/g, ""))
    .filter((w) => w && !STOPWORDS.has(w));
}

function dice(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const m = new Map<string, number>();
  for (const w of a) m.set(w, (m.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of b) {
    const k = m.get(w) ?? 0;
    if (k > 0) {
      shared++;
      m.set(w, k - 1);
    }
  }
  return (2 * shared) / (a.length + b.length);
}

export interface LineFate {
  id: string;
  class: LineClass;
  /** The matching unit in the edited copy (the closest one for a removed line), or null when it has no units. */
  match: { file: string; line: number; similarity: number } | null;
}

/** How an edited copy treats each contract line of the original. */
export function lineFates(lines: readonly ContractLine[], after: readonly SkillFile[]): LineFate[] {
  const afterUnits = after.flatMap((f) => parseUnits(f.path, f.text));
  const order = (f: string) => (f === "SKILL.md" ? "" : f);
  const pool = new Map<string, Unit[]>();
  for (const u of afterUnits) pool.set(u.norm, [...(pool.get(u.norm) ?? []), u]);
  const byNorm = new Map<string, ContractLine[]>();
  for (const l of lines) byNorm.set(l.norm, [...(byNorm.get(l.norm) ?? []), l]);
  const pair = new Map<ContractLine, Unit>();
  for (const [norm, ls] of byNorm) {
    const left = [...(pool.get(norm) ?? [])];
    const rest: ContractLine[] = [];
    for (const l of ls) {
      const k = left.findIndex((a) => a.file === l.file);
      if (k >= 0) pair.set(l, left.splice(k, 1)[0]!);
      else rest.push(l);
    }
    left.sort((x, y) => order(x.file).localeCompare(order(y.file)) || x.line - y.line);
    for (const l of rest) {
      const a = left.shift();
      if (a) pair.set(l, a);
    }
  }
  const tok = new Map<Unit, string[]>();
  const tokensOf = (u: Unit) => tok.get(u) ?? (tok.set(u, tokens(u.norm)), tok.get(u)!);
  return lines.map((l) => {
    const exact = pair.get(l);
    if (exact) return { id: l.id, class: exact.file === "SKILL.md" ? "kept" : "moved", match: { file: exact.file, line: exact.line, similarity: 1 } };
    let best: { u: Unit; score: number } | null = null;
    for (const u of afterUnits) {
      const score = dice(tokensOf(l), tokensOf(u));
      const better = !best || score > best.score || (score === best.score && ((u.file === "SKILL.md" && best.u.file !== "SKILL.md") || (u.file === l.file && best.u.file !== l.file)));
      if (better) best = { u, score };
    }
    const match = best && { file: best.u.file, line: best.u.line, similarity: Math.round(best.score * 1000) / 1000 };
    return { id: l.id, class: best && best.score >= REWRITE_THRESHOLD ? "rewritten" : "removed", match };
  });
}
