// Copyright (c) 2026 Garry Tan. MIT License.
// Section 5.2's frozen detector, two readings. Lenient (primary): a cell is present when its key phrase or a frozen
// synonym appears as a heading, a bold label or a table header, followed by substance (30 words before the next
// heading, a table with 2 data rows, or for a diagram a fenced block of 5 lines with arrows or box characters);
// registries also take "N/A" or "none" with a reason of 8 words; score sets need 7 (design) or 8 (DX) distinct
// dimension names with n/10 in one section; REALITY cells need a line starting REALITY: in that phase's part. Strict
// (secondary): the first key phrase as a heading, with the same substance rule.
import type { Phase } from "./records.ts";
import { wordCount } from "./units.ts";

export interface Block {
  kind: "heading" | "label" | "table";
  level: number;
  label: string;
  body: string;
}

const isHeading = (l: string) => /^#{1,6}\s+\S/.test(l);
const fenceLine = (l: string) => /^\s*(\x60\x60\x60|~~~)/.test(l);

/** Headings, bold labels and table headers, each with the text up to the next heading (a label also stops at the next label). */
export function blocks(md: string): Block[] {
  const lines = md.split("\n");
  const out: Block[] = [];
  let fence = false;
  const heads: number[] = [];
  const fenced: boolean[] = lines.map((l) => {
    if (fenceLine(l)) {
      fence = !fence;
      return true;
    }
    return fence;
  });
  lines.forEach((l, i) => {
    if (!fenced[i] && isHeading(l)) heads.push(i);
  });
  const nextHead = (i: number) => heads.find((h) => h > i) ?? lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    const l = lines[i]!;
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) {
      out.push({ kind: "heading", level: h[1]!.length, label: h[2]!.trim(), body: lines.slice(i + 1, nextHead(i)).join("\n") });
      continue;
    }
    const b = /^\s*(?:[-*+]\s+|\d+\.\s+)?\*\*([^*]+)\*\*:?(.*)$/.exec(l);
    if (b) {
      let end = nextHead(i);
      for (let j = i + 1; j < end; j++) if (!fenced[j] && /^\s*(?:[-*+]\s+|\d+\.\s+)?\*\*[^*]+\*\*/.test(lines[j]!)) {
        end = j;
        break;
      }
      out.push({ kind: "label", level: 7, label: b[1]!.trim(), body: [b[2]!, ...lines.slice(i + 1, end)].join("\n") });
      continue;
    }
    if (l.trim().startsWith("|") && (i === 0 || !lines[i - 1]!.trim().startsWith("|"))) {
      let end = i;
      while (end < lines.length && lines[end]!.trim().startsWith("|")) end++;
      out.push({ kind: "table", level: 8, label: l, body: lines.slice(i, end).join("\n") });
    }
  }
  return out;
}

/** Tables in text, as their data rows (rows after the separator row). */
export function tables(text: string): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  for (const l of [...text.split("\n"), ""]) {
    if (l.trim().startsWith("|")) cur.push(l);
    else if (cur.length) {
      const sep = cur.findIndex((r) => /^\s*\|?\s*:?-{2,}/.test(r));
      out.push(sep >= 0 ? cur.slice(sep + 1) : cur.slice(1));
      cur = [];
    }
  }
  return out;
}

export function fences(text: string): string[][] {
  const out: string[][] = [];
  let cur: string[] | null = null;
  for (const l of text.split("\n")) {
    if (fenceLine(l)) {
      if (cur) {
        out.push(cur);
        cur = null;
      } else cur = [];
    } else if (cur) cur.push(l);
  }
  return out;
}

const DIAGRAM = /->|<-|\u2192|\u2190|\u2193|\u2191|=>|[\u2500-\u257f]|\+--|--\+|\|\s*$|^\s*\|/;
export const qualifyingFence = (text: string): boolean => fences(text).some((f) => f.length >= 5 && f.some((l) => DIAGRAM.test(l)));
const proseWords = (body: string) => wordCount(body.split("\n").filter((l) => !fenceLine(l)).join(" ").replace(/[|#*_\x60>-]/g, " "));

export function substance(body: string, diagram = false): boolean {
  if (diagram) return qualifyingFence(body);
  return proseWords(body) >= 30 || tables(body).some((t) => t.length >= 2);
}

const naReason = (body: string): boolean => {
  const first = body.split("\n").map((l) => l.replace(/^[\s:>*_-]+/, "").trim()).find(Boolean) ?? "";
  const m = /^(n\/a|none)\b[\s:.,;\u2014-]*(.*)$/i.exec(first);
  return m !== null && wordCount(m[2]!) >= 8;
};

const has = (label: string, phrases: readonly string[]) => phrases.some((p) => label.toLowerCase().includes(p));

/** A REALITY: line (after an optional bullet or table pipe). */
export const realityLine = (text: string): boolean => text.split("\n").some((l) => /^\s*(?:[-*+]\s+|\|\s*)?\**REALITY:/.test(l));

/** Distinct dimension names that carry an n/10 score, best over the sections of the text. */
export function distinctScores(text: string): number {
  let best = 0;
  for (const section of text.split(/\n(?=#{1,6}\s)/)) {
    const names = new Set<string>();
    for (const l of section.split("\n")) {
      if (l.trim().startsWith("|")) {
        const cells = l.split("|").map((c) => c.replace(/[*_\x60]/g, "").trim()).filter(Boolean);
        if (cells.length >= 2 && cells.slice(1).some((c) => /\b\d{1,2}\s*\/\s*10\b/.test(c)) && /[a-z]/i.test(cells[0]!)) names.add(cells[0]!.toLowerCase());
        continue;
      }
      const m = /^\s*(?:[-*+]\s+|\d+\.\s+)?\**([A-Za-z][A-Za-z &\/'-]{1,40}?)\**\s*(?::|\u2014|\u2013|-|\()\s*\**(\d{1,2})\s*\/\s*10\b/.exec(l);
      if (m) names.add(m[1]!.trim().toLowerCase());
    }
    best = Math.max(best, names.size);
  }
  return best;
}

export interface CellInput {
  phase: Phase;
  cell: string;
  /** Bound results, consensus file and review record joined. */
  searched: string;
  /** The phase's own part, for REALITY lines. */
  part: string;
  /** Run directory file names (for the test plan). */
  files: readonly string[];
  hasConsensusFile: boolean;
  dims: { design: number; dx: number };
  ceoSections: ReadonlyArray<{ name: string; ui: boolean }>;
  ui: boolean;
}

const PHRASES: Record<string, string[]> = {
  error_rescue: ["error & rescue", "error and rescue"],
  failure_modes: ["failure modes", "failure mode registry"],
  not_in_scope: ["not in scope", "out of scope"],
  already_exists: ["what already exists", "already exists", "existing code"],
  dream: ["dream state", "12-month", "ideal state"],
  completion: ["completion summary", "review summary"],
  litmus: ["litmus"],
  journey: ["journey map", "developer journey"],
  empathy: ["empathy"],
  tthw: ["tthw", "time to hello world", "time to first success"],
  checklist: ["dx implementation checklist", "dx checklist"],
  architecture: ["architecture", "dependency"],
  test_diagram: ["test diagram", "codepath", "code path", "coverage"],
  issues: ["issues", "findings", "decisions"],
  scope: ["scope challenge", "scope"],
  premise: ["premise challenge", "premise"],
};
const REGISTRY = new Set(["error_rescue", "failure_modes"]);

function labelled(bs: Block[], phrases: string[], strict: boolean, test: (b: Block) => boolean): boolean {
  return bs.some((b) => (strict ? b.kind === "heading" && b.label.toLowerCase().includes(phrases[0]!) : b.kind !== "table" ? has(b.label, phrases) : has(b.label, phrases)) && test(b));
}

/** True when the cell is present in the reading (lenient or strict). */
export function present(c: CellInput, strict: boolean): boolean {
  const bs = blocks(c.searched);
  const ph = PHRASES[c.cell] ?? [];
  const sub = (b: Block) => (b.kind === "table" ? tables(b.body).some((t) => t.length >= 2) : substance(b.body));
  switch (c.cell) {
    case "premise":
      return realityLine(c.part) && (!strict || labelled(blocks(c.part), ph, true, () => true));
    case "scope":
      return realityLine(c.part) && labelled(blocks(c.part).concat(bs), strict ? ["scope challenge"] : ph, strict, () => true);
    case "scores":
      return distinctScores(c.searched) >= (c.phase === "design" ? c.dims.design : c.dims.dx);
    case "consensus":
      return c.hasConsensusFile || tables(c.searched).length > 0 && c.searched.split("\n").some((l) => l.trim().startsWith("|") && /native|claude|opus/i.test(l) && /outside|codex|gpt|sol|astra/i.test(l));
    case "test_plan":
      return /[^\s\x60'"()<>]*test-plan[^\s\x60'"()<>]*\.md/i.test(c.searched) || c.files.some((f) => /test-plan.*\.md$/i.test(f));
    case "architecture":
      return labelled(bs, ph, strict, (b) => qualifyingFence(b.body));
    case "test_diagram":
      return labelled(bs, ph, strict, (b) => qualifyingFence(b.body) || tables(b.body).some((t) => t.length >= 2));
    case "issues":
      return labelled(bs, ph, strict, (b) => fences(b.body).some((f) => f.length >= 1) || tables(b.body).some((t) => t.length >= 1)) || (!strict && bs.some((b) => b.kind === "table" && /decision/i.test(b.label) && tables(b.body).some((t) => t.length >= 1)));
    case "sections": {
      const need = c.ceoSections.filter((s) => !s.ui || c.ui);
      if (!need.length) return false;
      const lines = c.searched.split("\n");
      return need.every((s) => {
        const name = s.name.toLowerCase();
        if (strict) return bs.some((b) => b.kind === "heading" && b.label.toLowerCase().includes(name) && wordCount(b.body) >= 8);
        return lines.some((l, i) => l.toLowerCase().includes(name) && wordCount(lines.slice(i, i + 4).join(" ")) >= 8);
      });
    }
    default: {
      const reg = REGISTRY.has(c.cell);
      const engGap = c.cell === "failure_modes" && c.phase === "eng";
      return labelled(bs, ph, strict, (b) => (sub(b) || (reg && naReason(b.body))) && (!engGap || /critical gap/i.test(b.body) || tables(b.body).some((t) => t.length >= 2)));
    }
  }
}
