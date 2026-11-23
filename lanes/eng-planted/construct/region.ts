// Copyright (c) 2026 Garry Tan. MIT License.
// The region finder and the test-case remover of the planted-unit construction (plan section 2), on ast-grep's parsers:
// the enclosing named function or method of each product hunk at P, each region function's signature, the removal of
// test cases from a test file (Go Test, Benchmark, Example and Fuzz functions; Python test functions and classes; Rust
// #[test] functions, inline #[cfg(test)] modules included; JavaScript and TypeScript it and test blocks) keeping helpers,
// fixtures and imports, and the cleanup of imports a removal leaves unused. Prints nothing.
import go from "@ast-grep/lang-go";
import python from "@ast-grep/lang-python";
import rust from "@ast-grep/lang-rust";
import { Lang, parse, registerDynamicLanguage, type SgNode } from "@ast-grep/napi";

registerDynamicLanguage({ go, python, rust } as never);

export type Lng = "ts" | "tsx" | "js" | "go" | "python" | "rust";

export function lngOf(path: string): Lng | null {
  if (/\.(ts|mts|cts)$/.test(path)) return "ts";
  if (/\.tsx$/.test(path)) return "tsx";
  if (/\.(js|jsx|mjs|cjs)$/.test(path)) return "js";
  if (path.endsWith(".go")) return "go";
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".rs")) return "rust";
  return null;
}

export const rootOf = (l: Lng, text: string): SgNode => parse((l === "ts" ? Lang.TypeScript : l === "tsx" ? Lang.Tsx : l === "js" ? Lang.JavaScript : l) as never, text).root();

/** ERROR nodes in a parse: a stub or a removal that adds one broke the file. */
export const parseErrors = (l: Lng, text: string): number => rootOf(l, text).findAll({ rule: { kind: "ERROR" } }).length;

const JS_FN = ["function_declaration", "generator_function_declaration", "method_definition", "arrow_function", "function_expression"];
const FN_KINDS: Record<Lng, string[]> = { ts: JS_FN, tsx: JS_FN, js: JS_FN, go: ["function_declaration", "method_declaration"], python: ["function_definition"], rust: ["function_item"] };

/** A function's name: its own, or for a JavaScript function value the variable, field, key or assignment target. */
function nameOf(n: SgNode, l: Lng): string | null {
  const own = n.field("name")?.text();
  if (own || l === "go" || l === "python" || l === "rust") return own ?? null;
  const p = n.parent();
  if (!p) return null;
  const pk = p.kind();
  if (pk === "variable_declarator") return p.field("name")?.text() ?? null;
  if (pk === "public_field_definition" || pk === "field_definition") return (p.field("name") ?? p.field("property"))?.text() ?? null;
  if (pk === "pair") return p.field("key")?.text() ?? null;
  if (pk === "assignment_expression") return p.field("left")?.text() ?? null;
  return null;
}

export interface Fn {
  name: string;
  /** 0-based first and last line, and byte offsets of the whole function and of its body. */
  sl: number;
  el: number;
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
  body: SgNode;
  node: SgNode;
}

/** Every named function or method in a file. */
export function functionsOf(l: Lng, text: string): Fn[] {
  const fns: Fn[] = [];
  for (const n of rootOf(l, text).findAll({ rule: { any: FN_KINDS[l].map((kind) => ({ kind })) } })) {
    const name = nameOf(n, l);
    const body = n.field("body");
    if (!name || !body) continue;
    const r = n.range();
    const b = body.range();
    fns.push({ name, sl: r.start.line, el: r.end.line, start: r.start.index, end: r.end.index, bodyStart: b.start.index, bodyEnd: b.end.index, body, node: n });
  }
  return fns;
}

/** The innermost function enclosing each hunk (0-based first and last line at P), with functions nested in another chosen
 * one left out; null when a hunk sits outside every named function. */
export function enclosing(fns: Fn[], hunks: { s: number; e: number }[]): Fn[] | null {
  const chosen: Fn[] = [];
  for (const h of hunks) {
    const inside = fns.filter((f) => h.s >= 0 && f.sl <= h.s && f.el >= h.e).sort((x, y) => x.end - x.start - (y.end - y.start));
    if (inside.length === 0) return null;
    if (!chosen.includes(inside[0])) chosen.push(inside[0]);
  }
  return chosen.filter((c) => !chosen.some((o) => o !== c && o.bodyStart <= c.start && o.bodyEnd >= c.end));
}

/** A function's signature as written: everything before its body, from the declaration a JavaScript function value sits
 * in, whitespace collapsed. */
export function signatureOf(text: string, fn: Fn): string {
  const p = fn.node.parent();
  const k = p ? String(p.kind()) : "";
  const start = k === "variable_declarator" ? (p!.parent()?.range().start.index ?? fn.start) : ["pair", "public_field_definition", "field_definition", "assignment_expression"].includes(k) ? p!.range().start.index : fn.start;
  return text.slice(start, fn.bodyStart).replace(/\s+/g, " ").trim().replace(/\s*(=>|:)$/, "");
}

/** A range to cut; a plain one never widens to its line. */
type Cut = [number, number, plain?: boolean];

/** Cuts ranges, last first. A range that starts a line's text and ends it takes the whole line, and one blank line
 * around it when that would leave two in a row. */
const applyCuts = (text: string, cuts: Cut[]): string => {
  let t = text;
  for (const [s0, e0, plain] of [...cuts].sort((a, b) => b[0] - a[0])) {
    let s = s0;
    let e = e0;
    const ls = t.lastIndexOf("\n", s - 1) + 1;
    const trail = /^[ \t]*(\n|$)/.exec(t.slice(e));
    if (!plain && t.slice(ls, s).trim() === "" && trail) {
      s = ls;
      e += trail[0].length;
      if (t.slice(Math.max(0, s - 2), s) === "\n\n" && /^[ \t]*\n/.test(t.slice(e))) e += /^[ \t]*\n/.exec(t.slice(e))![0].length;
    }
    t = t.slice(0, s) + t.slice(e);
  }
  return t;
};

/** Start of a node with the comments and attributes directly above it. */
function withLeading(n: SgNode, kinds: string[]): number {
  let start = n.range().start.index;
  let line = n.range().start.line;
  for (let p = n.prev(); p && kinds.includes(String(p.kind())) && p.range().end.line >= line - 1; p = p.prev()) {
    start = p.range().start.index;
    line = p.range().start.line;
  }
  return start;
}

const GO_CASE = /^(Test|Benchmark|Example|Fuzz)/;
const RUST_TEST_ATTR = /^#\[(?:[\w:]+::)?(test|rstest|test_case|quickcheck)\b/;
const JS_CASE = /^(it|test|xit|xtest|fit)(\.(only|skip|todo|concurrent|each|failing|sequential))*(\(|$)/;

function goCuts(root: SgNode): Cut[] {
  return root
    .children()
    .filter((n) => n.kind() === "function_declaration" && GO_CASE.test(n.field("name")?.text() ?? "") && n.field("name")?.text() !== "TestMain")
    .map((n) => [withLeading(n, ["comment"]), n.range().end.index]);
}

function pyCuts(root: SgNode): Cut[] {
  const cuts: Cut[] = [];
  for (const n of root.children()) {
    const def = n.kind() === "decorated_definition" ? n.field("definition") : n;
    if (!def) continue;
    const name = def.field("name")?.text() ?? "";
    const k = def.kind();
    if ((k === "function_definition" && name.startsWith("test")) || (k === "class_definition" && (name.startsWith("Test") || /TestCase\b/.test(def.field("superclasses")?.text() ?? ""))))
      cuts.push([withLeading(n, ["comment"]), n.range().end.index]);
  }
  return cuts;
}

const rustAttrs = (n: SgNode): SgNode[] => {
  const out: SgNode[] = [];
  for (let p = n.prev(); p && (p.kind() === "attribute_item" || p.kind() === "line_comment" || p.kind() === "block_comment"); p = p.prev()) if (p.kind() === "attribute_item") out.push(p);
  return out;
};

function rustCuts(root: SgNode): Cut[] {
  const cuts: Cut[] = [];
  for (const f of root.findAll({ rule: { kind: "function_item" } })) if (rustAttrs(f).some((a) => RUST_TEST_ATTR.test(a.text()))) cuts.push([withLeading(f, ["attribute_item", "line_comment", "block_comment"]), f.range().end.index]);
  for (const m of root.findAll({ rule: { kind: "mod_item" } })) {
    if (!rustAttrs(m).some((a) => /^#\[cfg\(test\)\]/.test(a.text()))) continue;
    const body = m.field("body");
    if (!body) continue;
    const left = body.children().filter((c) => !["{", "}", "use_declaration", "attribute_item", "inner_attribute_item", "line_comment", "block_comment"].includes(String(c.kind())) && !cuts.some(([s, e]) => c.range().start.index >= s && c.range().end.index <= e));
    if (left.length === 0) cuts.push([withLeading(m, ["attribute_item", "line_comment", "block_comment"]), m.range().end.index]);
  }
  return cuts.filter((c) => !cuts.some((o) => o !== c && o[0] <= c[0] && o[1] >= c[1]));
}

/** A JavaScript statement that calls a case (it, test and their modifiers) or a describe whose callback holds no
 * statement left after the case cuts. */
function jsCuts(root: SgNode): Cut[] {
  const calls = root.findAll({ rule: { kind: "expression_statement", has: { kind: "call_expression" } } });
  const callee = (s: SgNode) => s.children().find((c) => c.kind() === "call_expression")?.field("function")?.text().replace(/\s+/g, "") ?? "";
  const cuts: Cut[] = calls.filter((s) => JS_CASE.test(callee(s))).map((s) => [withLeading(s, ["comment"]), s.range().end.index]);
  const inCut = (n: SgNode) => cuts.some(([s, e]) => n.range().start.index >= s && n.range().end.index <= e);
  for (const s of calls.filter((x) => /^(describe|suite|context)(\.(only|skip|each))*(\(|$)/.test(callee(x))).reverse()) {
    const fn = s.findAll({ rule: { any: [{ kind: "arrow_function" }, { kind: "function_expression" }] } })[0];
    const body = fn?.field("body");
    if (!body || body.kind() !== "statement_block") continue;
    const left = body.children().filter((c) => !["{", "}", "comment"].includes(String(c.kind())) && !inCut(c));
    if (left.length === 0) cuts.push([withLeading(s, ["comment"]), s.range().end.index]);
  }
  return cuts.filter((c) => !cuts.some((o) => o !== c && o[0] <= c[0] && o[1] >= c[1]));
}

const KEEP_ONLY: Record<Lng, string[]> = {
  go: ["package_clause", "import_declaration", "comment"],
  python: ["import_statement", "import_from_statement", "future_import_statement", "comment"],
  rust: ["use_declaration", "attribute_item", "inner_attribute_item", "line_comment", "block_comment", "extern_crate_declaration"],
  ts: ["import_statement", "comment"],
  tsx: ["import_statement", "comment"],
  js: ["import_statement", "comment"],
};

/** Removes every test case from a test file, keeping helpers, fixtures and imports, and drops imports the removal left
 * unused. null when nothing but imports and comments is left (the file is deleted). A product file with an inline Rust
 * test region keeps its product code, so it is never null. */
export function removeTestCases(l: Lng, text: string): string | null {
  const root = rootOf(l, text);
  const cuts = l === "go" ? goCuts(root) : l === "python" ? pyCuts(root) : l === "rust" ? rustCuts(root) : jsCuts(root);
  const after = pruneImports(l, text, applyCuts(text, cuts));
  const left = rootOf(l, after)
    .children()
    .filter((c) => !KEEP_ONLY[l].includes(String(c.kind())) && !(l === "python" && c.kind() === "expression_statement" && c.children()[0]?.kind() === "string"));
  return left.length === 0 ? null : after;
}

/** Go: the package names a file's code uses. */
function goUsed(text: string): Set<string> {
  const root = rootOf("go", text);
  const used = new Set<string>();
  for (const n of root.findAll({ rule: { kind: "selector_expression" } })) {
    const o = n.field("operand");
    if (o && o.kind() === "identifier") used.add(o.text());
  }
  for (const n of root.findAll({ rule: { kind: "package_identifier" } })) if (n.parent()?.kind() !== "import_spec") used.add(n.text());
  return used;
}

/** Identifiers used outside import statements. */
function used(l: Lng, text: string): Set<string> {
  if (l === "go") return goUsed(text);
  const imp = l === "python" ? ["import_statement", "import_from_statement"] : ["import_statement"];
  const kinds = l === "python" ? ["identifier"] : l === "js" ? ["identifier", "shorthand_property_identifier"] : ["identifier", "type_identifier", "shorthand_property_identifier"];
  return new Set(rootOf(l, text).findAll({ rule: { any: kinds.map((kind) => ({ kind })), not: { inside: { any: imp.map((kind) => ({ kind })), stopBy: "end" } } } }).map((n) => n.text()));
}

/** The local names an import binds, each with the node to cut when it alone goes. */
function bindings(l: Lng, stmt: SgNode): { name: string; node: SgNode }[] {
  if (l === "go") {
    const path = (stmt.field("path")?.text() ?? "").replace(/^["`]|["`]$/g, "");
    const alias = stmt.field("name")?.text();
    if (alias === "_" || alias === ".") return [];
    const segs = path.split("/");
    let last = segs.pop() ?? "";
    if (/^v\d+$/.test(last) && segs.length) last = segs.pop()!;
    return [{ name: alias ?? last.replace(/\.v\d+$/, "").replace(/^go-/, "").replace(/-go$/, "").replace(/[-.]/g, "_"), node: stmt }];
  }
  if (l === "python") {
    const out: { name: string; node: SgNode }[] = [];
    const mod = stmt.field("module_name")?.range().start.index;
    const named = stmt.kind() === "import_from_statement" ? stmt.children().filter((c) => (c.kind() === "dotted_name" || c.kind() === "aliased_import") && c.range().start.index !== mod) : stmt.children().filter((c) => c.kind() === "dotted_name" || c.kind() === "aliased_import");
    for (const c of named) out.push({ name: c.kind() === "aliased_import" ? (c.field("alias")?.text() ?? "") : stmt.kind() === "import_statement" ? c.text().split(".")[0] : c.text(), node: c });
    return out;
  }
  const out: { name: string; node: SgNode }[] = [];
  const clause = stmt.children().find((c) => c.kind() === "import_clause");
  if (!clause) return out;
  for (const c of clause.children()) {
    if (c.kind() === "identifier") out.push({ name: c.text(), node: c });
    if (c.kind() === "namespace_import") out.push({ name: c.children().find((x) => x.kind() === "identifier")?.text() ?? "", node: c });
    if (c.kind() === "named_imports") for (const s of c.children().filter((x) => x.kind() === "import_specifier")) out.push({ name: (s.field("alias") ?? s.field("name"))?.text() ?? "", node: s });
  }
  return out;
}

/** Drops each import binding the original file used and the changed file no longer does; a statement losing every binding
 * goes whole. Rust's unused uses are warnings, so Rust is left as it is. */
export function pruneImports(l: Lng, before: string, after: string): string {
  if (l === "rust") return after;
  const was = used(l, before);
  const now = used(l, after);
  const root = rootOf(l, after);
  const stmts = root.findAll({ rule: { any: (l === "go" ? ["import_spec"] : l === "python" ? ["import_statement", "import_from_statement"] : ["import_statement"]).map((kind) => ({ kind })) } });
  const cuts: Cut[] = [];
  for (const s of stmts) {
    const bs = bindings(l, s);
    const gone = bs.filter((b) => b.name && was.has(b.name) && !now.has(b.name));
    if (gone.length === 0) continue;
    if (gone.length === bs.length) {
      const whole = l === "go" && s.parent()?.kind() === "import_declaration" ? s.parent()! : l === "go" && s.parent()?.kind() === "import_spec_list" && s.parent()!.children().filter((c) => c.kind() === "import_spec").length === 1 ? s.parent()!.parent()! : s;
      cuts.push([whole.kind() === "import_spec" ? withLeading(whole, ["comment"]) : whole.range().start.index, whole.range().end.index]);
      continue;
    }
    for (const b of gone) {
      const r = b.node.range();
      const tail = /^\s*,\s*/.exec(after.slice(r.end.index));
      if (tail) cuts.push([r.start.index, r.end.index + tail[0].length, true]);
      else {
        const head = /,\s*$/.exec(after.slice(0, r.start.index));
        cuts.push([head ? r.start.index - head[0].length : r.start.index, r.end.index, true]);
      }
    }
  }
  return applyCuts(after, cuts);
}
