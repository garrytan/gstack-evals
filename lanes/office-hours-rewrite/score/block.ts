// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's block parser (prereg section 4 step 4, the closing block, and section 5, the cut of
// each line at 40 words; pre-run change 1, item 4c, the closing message). It implements types.ts BlockParser: the
// session loop calls it on each closing reply, and the packets render what it returns. The tolerance rules are frozen
// build-time choices 1 to 9 in score/README.md:
// 1. Labels match in any case.
// 2. Markdown emphasis (* and _) around a label or its value is dropped.
// 3. Leading white space, quote marks (>), list marks (-, *, +), heading marks (#) and numbers (1. or 1)) before a label
//    are dropped, on label lines and on continuation lines alike.
// 4. NEXT and ACTION may be joined by spaces, one hyphen or one underscore.
// 5. A label opens its line, after the marks in 3, and is followed by a colon (emphasis may sit between).
// 6. A field runs from its label to the next label line of any kind, a code fence line, a thematic break (---, *** or
//    ___) or the end of the reply. Its lines are trimmed, empty lines dropped, and the rest joined with single spaces.
// 7. The last line of each label in the reply wins.
// 8. A block needs all three labels, with DECISION and NEXT ACTION non-empty; WHY may be empty.
// 9. Each field is cut at frozen.BLOCK_WORDS words (runs of non-white-space), and the cut is recorded.
import { createHash } from "node:crypto";
import { BLOCK_WORDS } from "../frozen.ts";
import type { Block, BlockParse, BlockParser } from "../types.ts";

type Field = keyof Block;
const FIELDS: readonly Field[] = ["decision", "next_action", "why"];
const NAMES: Readonly<Record<Field, string>> = { decision: "DECISION", next_action: "NEXT ACTION", why: "WHY" };

const MARKS = /^(?:[ \t]*(?:>|[-*+](?=[ \t])|#{1,6}(?=[ \t])|\d{1,3}[.)](?=[ \t])))*[ \t]*/;
const LABEL = /^[*_]*(DECISION|NEXT(?: +|-|_)ACTION|WHY)[*_]*[ \t]*:[*_]*(.*)$/i;
const STOP = /^[ \t]*(?:`{3,}|~{3,}|(?:-[ \t]*){3,}$|(?:\*[ \t]*){3,}$|(?:_[ \t]*){3,}$)/;

export const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);
const clean = (s: string): string => s.trim().replace(/^[*_]+|[*_]+$/g, "").trim();

function labelOf(line: string): { field: Field; rest: string } | null {
  const m = LABEL.exec(line.replace(MARKS, ""));
  if (!m) return null;
  const name = m[1]!.toUpperCase();
  return { field: name === "DECISION" ? "decision" : name === "WHY" ? "why" : "next_action", rest: m[2]! };
}

export const parseBlock: BlockParser = (replyText) => {
  const body_sha256 = createHash("sha256").update(replyText).digest("hex");
  const lines = replyText.split(/\r?\n/);
  const last = new Map<Field, number>();
  lines.forEach((l, i) => {
    const lab = labelOf(l);
    if (lab) last.set(lab.field, i);
  });
  const missing = FIELDS.filter((f) => !last.has(f));
  if (missing.length) return { kind: "no-block", reason: "missing " + missing.map((f) => NAMES[f]).join(", "), body_sha256 };
  const block = {} as Block;
  const cut = { decision: false, next_action: false, why: false };
  for (const f of FIELDS) {
    const start = last.get(f)!;
    const parts = [labelOf(lines[start]!)!.rest];
    for (let i = start + 1; i < lines.length && !labelOf(lines[i]!) && !STOP.test(lines[i]!); i++) parts.push(lines[i]!.replace(MARKS, ""));
    const w = words(parts.map(clean).filter(Boolean).join(" "));
    cut[f] = w.length > BLOCK_WORDS;
    block[f] = w.slice(0, BLOCK_WORDS).join(" ");
  }
  const empty = (["decision", "next_action"] as const).filter((f) => !block[f]);
  if (empty.length) return { kind: "no-block", reason: "empty " + empty.map((f) => NAMES[f]).join(", "), body_sha256 };
  return { kind: "block", block, cut, body_sha256 };
};

/** The three lines a judge reads for one block. */
export const renderBlock = (b: Block): string => "DECISION: " + b.decision + "\nNEXT ACTION: " + b.next_action + "\nWHY: " + b.why;
