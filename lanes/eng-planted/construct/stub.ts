// Copyright (c) 2026 Garry Tan. MIT License.
// The stubber of the planted-unit construction (plan section 2): each region function's body becomes a language stub
// (TypeScript and JavaScript throw, Go panics, Python raises NotImplementedError, Rust calls todo!()), keeping the
// signature, the doc comments above it and a Python docstring, and imports the stubs leave unused are dropped. It returns
// the removed body lines for the body check. Prints nothing.
import { parseErrors, pruneImports, type Fn, type Lng } from "./region.ts";

export interface Stubbed {
  text: string;
  /** The removed body lines, as written at P, in order. */
  removed: string[];
}

const indentAt = (text: string, idx: number): string => /^[ \t]*/.exec(text.slice(text.lastIndexOf("\n", idx - 1) + 1))![0];
const unitOf = (text: string): string => (/\n\t/.test(text) ? "\t" : /\n {4}\S/.test(text) && !/\n {2}\S/.test(text) ? "    " : "  ");
const inner = (body: string): string[] => {
  const lines = body.split("\n");
  return lines.length >= 3 ? lines.slice(1, -1) : [body.replace(/^\{|\}$/g, "").trim()].filter(Boolean);
};

/** One function's stub edit: the body's byte range, its replacement and the lines it takes out. */
function stubEdit(l: Lng, text: string, fn: Fn): { start: number; end: number; text: string; removed: string[] } {
  const body = text.slice(fn.bodyStart, fn.bodyEnd);
  const ind = indentAt(text, fn.start);
  const u = unitOf(text);
  if (l === "python") {
    const first = fn.body.children().find((c) => String(c.kind()) !== "comment");
    const doc = first && String(first.kind()) === "expression_statement" && String(first.children()[0]?.kind()) === "string" ? first : null;
    const pad = " ".repeat(fn.body.range().start.column);
    if (doc) {
      const gone = text.slice(doc.range().end.index, fn.bodyEnd);
      return { start: doc.range().end.index, end: fn.bodyEnd, text: "\n" + pad + "raise NotImplementedError", removed: gone.split("\n").filter((x) => x.trim()) };
    }
    return { start: fn.bodyStart, end: fn.bodyEnd, text: "raise NotImplementedError", removed: body.split("\n") };
  }
  if (l === "go") return { start: fn.bodyStart, end: fn.bodyEnd, text: "{\n" + ind + u + 'panic("not implemented")\n' + ind + "}", removed: inner(body) };
  if (l === "rust") return { start: fn.bodyStart, end: fn.bodyEnd, text: "{\n" + ind + u + "todo!()\n" + ind + "}", removed: inner(body) };
  if (String(fn.body.kind()) !== "statement_block") return { start: fn.bodyStart, end: fn.bodyEnd, text: '{ throw new Error("not implemented"); }', removed: body.split("\n") };
  return { start: fn.bodyStart, end: fn.bodyEnd, text: "{\n" + ind + u + 'throw new Error("not implemented");\n' + ind + "}", removed: inner(body) };
}

/** Stubs the given functions of one file (none nested in another). null when the stubs add a parse error. */
export function stubFile(l: Lng, text: string, fns: Fn[]): Stubbed | null {
  const edits = fns.map((fn) => stubEdit(l, text, fn)).sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  out = pruneImports(l, text, out);
  if (parseErrors(l, out) > parseErrors(l, text)) return null;
  return { text: out, removed: edits.reverse().flatMap((e) => e.removed) };
}
