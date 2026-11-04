// Copyright (c) 2026 Garry Tan. MIT License.
// Finds the test units in a file and the lines each spans, so the scorer runs only the tests the agent added or changed:
// those whose span holds a line the patch touched (outcome-per-skill plan v3, section 3). Python units are pytest functions
// and methods, Go units are TestXxx functions, Rust units are #[test] functions, and TypeScript units are test() and it()
// calls. Also maps changed Python lines to the functions mutmut names its mutants after. Strings and comments are never
// read as code.
import { newLine, type FileChange } from "./diff.ts";

export interface Unit {
  file: string;
  /** The runner's selector: a pytest node id, a Go test name, a Rust test path, or a vitest call's first line. */
  name: string;
  start: number;
  end: number;
  /** Rust: the test target ("unit" for tests inside src, or the integration test's name). Go: the package directory. */
  scope: string;
}

const indent = (s: string) => s.length - s.trimStart().length;
const blank = (s: string) => s.trim() === "" || s.trimStart().startsWith("#");

/** For each line, whether it starts a logical line: outside any string, bracket or backslash continuation. */
function pyLineStarts(lines: string[]): boolean[] {
  const starts: boolean[] = [];
  let depth = 0;
  let quote = "";
  let cont = false;
  for (const s of lines) {
    starts.push(depth === 0 && quote === "" && !cont);
    cont = false;
    for (let k = 0; k < s.length; k++) {
      const ch = s[k]!;
      if (quote) {
        if (ch === "\\") k++;
        else if (s.startsWith(quote, k)) {
          k += quote.length - 1;
          quote = "";
        }
        continue;
      }
      if (ch === "#") break;
      if (ch === '"' || ch === "'") {
        quote = s.startsWith(ch.repeat(3), k) ? ch.repeat(3) : ch;
        k += quote.length - 1;
      } else if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
      else if (ch === "\\" && k === s.length - 1) cont = true;
    }
    if (quote.length === 1) quote = "";
  }
  return starts;
}

/** The last line of an indented Python block that opens at line index i (0-based), 1-based. */
function pyBlockEnd(lines: string[], starts: boolean[], i: number): number {
  const base = indent(lines[i]!);
  let end = i;
  for (let j = i + 1; j < lines.length; j++) {
    const s = lines[j]!;
    if (starts[j] && !blank(s) && indent(s) <= base) break;
    if (!starts[j] || !blank(s)) end = j;
  }
  return end + 1;
}

/** The first line of a def's decorators, 1-based, each decorator's continuation lines included. */
function pyDecoStart(lines: string[], starts: boolean[], i: number): number {
  let s = i;
  for (let k = i - 1; k >= 0; k--) {
    if (!starts[k]) continue;
    if (!lines[k]!.trimStart().startsWith("@") || indent(lines[k]!) !== indent(lines[i]!)) break;
    s = k;
  }
  return s + 1;
}

export function pythonUnits(file: string, text: string): Unit[] {
  const lines = text.split("\n");
  const starts = pyLineStarts(lines);
  const out: Unit[] = [];
  let cls: { name: string; end: number; body: number | null } | null = null;
  lines.forEach((s, i) => {
    if (cls && i + 1 > cls.end) cls = null;
    if (!starts[i]) return;
    const c = /^class\s+(Test\w*)\b[^:]*:/.exec(s);
    if (c) {
      cls = { name: c[1]!, end: pyBlockEnd(lines, starts, i), body: null };
      return;
    }
    const d = /^(\s*)(?:async\s+)?def\s+(test\w*)\s*\(/.exec(s);
    if (!d) return;
    const ind = d[1]!.length;
    if (ind === 0) out.push({ file, name: file + "::" + d[2], start: pyDecoStart(lines, starts, i), end: pyBlockEnd(lines, starts, i), scope: "" });
    else if (cls) {
      cls.body ??= ind;
      if (ind === cls.body) out.push({ file, name: file + "::" + cls.name + "::" + d[2], start: pyDecoStart(lines, starts, i), end: pyBlockEnd(lines, starts, i), scope: "" });
    }
  });
  return out;
}

/** Top-level functions and the methods of top-level classes, the functions mutmut mutates, with mutmut's mangled names. */
export function pythonFunctions(text: string): { mangled: string; start: number; end: number }[] {
  const lines = text.split("\n");
  const starts = pyLineStarts(lines);
  const out: { mangled: string; start: number; end: number }[] = [];
  let cls: { name: string; end: number; body: number | null } | null = null;
  lines.forEach((s, i) => {
    if (cls && i + 1 > cls.end) cls = null;
    if (!starts[i]) return;
    const c = /^class\s+(\w+)\b[^:]*:/.exec(s);
    if (c) {
      cls = { name: c[1]!, end: pyBlockEnd(lines, starts, i), body: null };
      return;
    }
    const d = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/.exec(s);
    if (!d) return;
    const ind = d[1]!.length;
    if (ind === 0) out.push({ mangled: "x_" + d[2], start: pyDecoStart(lines, starts, i), end: pyBlockEnd(lines, starts, i) });
    else if (cls) {
      cls.body ??= ind;
      if (ind === cls.body) out.push({ mangled: "x\u01c1" + cls.name + "\u01c1" + d[2], start: pyDecoStart(lines, starts, i), end: pyBlockEnd(lines, starts, i) });
    }
  });
  return out;
}

/** mutmut's module name for a source path: dots for slashes, a leading "src." dropped, "__init__" folded into its package. */
export function pythonModule(path: string): string {
  const m = path.replace(/\.py$/, "").split("/").join(".").replace(/^src\./, "");
  return m.endsWith(".__init__") ? m.slice(0, -9) : m === "__init__" ? "" : m;
}

/** The text with comments and the insides of string, rune and template literals turned to spaces, newlines kept, so every
 * line and column stays where it was. Go's backquote strings are raw; TypeScript keeps the code inside a template's ${}
 * and blanks regex literals, told from division by the token before them. */
function blankLiterals(text: string, ts: boolean): string {
  const out = text.split("");
  const n = text.length;
  const blankOut = (a: number, b: number) => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const template = (i: number): number => {
    let s = i;
    while (i < n && text[i] !== "\u0060") {
      if (text[i] === "\\") i += 2;
      else if (text.startsWith("${", i)) {
        blankOut(s, i);
        i = code(i + 2, true);
        s = i;
      } else i++;
    }
    blankOut(s, i);
    return i + 1;
  };
  const code = (i: number, inExpr: boolean): number => {
    let depth = 0;
    let prev = "(";
    while (i < n) {
      const ch = text[i]!;
      if (text.startsWith("//", i)) {
        const e = text.indexOf("\n", i);
        blankOut(i, e < 0 ? n : e);
        i = e < 0 ? n : e;
        continue;
      }
      if (text.startsWith("/*", i)) {
        const e = text.indexOf("*/", i + 2);
        blankOut(i, e < 0 ? n : e + 2);
        i = e < 0 ? n : e + 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        let k = i + 1;
        while (k < n && text[k] !== ch && text[k] !== "\n") k += text[k] === "\\" ? 2 : 1;
        blankOut(i + 1, k);
        i = k + 1;
        prev = "a";
        continue;
      }
      if (ch === "\u0060") {
        if (ts) i = template(i + 1);
        else {
          const e = text.indexOf("\u0060", i + 1);
          blankOut(i + 1, e < 0 ? n : e);
          i = e < 0 ? n : e + 1;
        }
        prev = "a";
        continue;
      }
      if (ts && ch === "/" && /[(,=:[!&|?{};+\-*%<>~^]/.test(prev)) {
        let k = i + 1;
        let cls = false;
        while (k < n && text[k] !== "\n" && (cls || text[k] !== "/")) {
          if (text[k] === "\\") k++;
          else if (text[k] === "[") cls = true;
          else if (text[k] === "]") cls = false;
          k++;
        }
        blankOut(i + 1, k);
        i = k + 1;
        prev = "a";
        continue;
      }
      if (inExpr && ch === "{") depth++;
      else if (inExpr && ch === "}") {
        if (depth === 0) return i + 1;
        depth--;
      }
      if (!/\s/.test(ch)) prev = /[\w$]/.test(ch) ? "a" : ch;
      i++;
    }
    return n;
  };
  code(0, false);
  return out.join("");
}

export function goUnits(file: string, text: string): Unit[] {
  const lines = blankLiterals(text, false).split("\n");
  const out: Unit[] = [];
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".";
  lines.forEach((s, i) => {
    const m = /^func\s+(Test(?:[^a-z\W]\w*)?)\s*\(\s*\w+\s+\*testing\.T\s*\)/.exec(s);
    if (!m) return;
    let end = lines.length;
    for (let j = i; j < lines.length; j++) if (lines[j] === "}" || (j === i && /\}\s*$/.test(s) && /\{/.test(s))) {
      end = j + 1;
      break;
    }
    out.push({ file, name: m[1]!, start: i + 1, end, scope: dir });
  });
  return out;
}

type Tok = { t: string; line: number; at: number };

/** Rust tokens with comments, strings and char literals dropped: identifiers, and single punctuation characters. */
function rustTokens(text: string): Tok[] {
  const toks: Tok[] = [];
  let line = 1;
  let i = 0;
  const n = text.length;
  const nl = (a: number, b: number) => {
    for (let k = a; k < b; k++) if (text[k] === "\n") line++;
  };
  while (i < n) {
    const ch = text[i]!;
    if (ch === "\n") {
      line++;
      i++;
    } else if (/\s/.test(ch)) i++;
    else if (text.startsWith("//", i)) {
      while (i < n && text[i] !== "\n") i++;
    } else if (text.startsWith("/*", i)) {
      let depth = 0;
      const s = i;
      while (i < n) {
        if (text.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (text.startsWith("*/", i)) {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else i++;
      }
      nl(s, i);
    } else if (/[rb]/.test(ch) && /^(?:b?r#*")/.test(text.slice(i, i + 40))) {
      const m = /^b?r(#*)"/.exec(text.slice(i, i + 40))!;
      const close = '"' + m[1];
      const s = i;
      const e = text.indexOf(close, i + m[0].length);
      i = e < 0 ? n : e + close.length;
      nl(s, i);
    } else if (ch === '"' || (ch === "b" && text[i + 1] === '"')) {
      const s = i;
      i += ch === "b" ? 2 : 1;
      while (i < n && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i++;
      nl(s, i);
    } else if (ch === "'") {
      const m = /^'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|.)|[^\\'\n])'/u.exec(text.slice(i, i + 16));
      i += m ? m[0].length : 1;
    } else if (/[A-Za-z_]/.test(ch)) {
      const s = i;
      while (i < n && /\w/.test(text[i]!)) i++;
      toks.push({ t: text.slice(s, i), line, at: s });
    } else {
      toks.push({ t: ch, line, at: i });
      i++;
    }
  }
  return toks;
}

/** The module path of a Rust file inside its crate, and its test target: "unit" for src, the binary name for tests/. */
export function rustModule(rel: string): { target: string; path: string[] } {
  if (rel.startsWith("tests/")) {
    const parts = rel.slice(6).replace(/\.rs$/, "").split("/");
    return { target: parts[0]!, path: parts.slice(1).filter((p) => p !== "main" && p !== "mod") };
  }
  const parts = rel.replace(/^src\//, "").replace(/\.rs$/, "").split("/");
  if (parts[0] === "bin" && parts.length > 1) parts.splice(0, parts.length > 2 ? 2 : parts.length);
  if (parts.length === 1 && (parts[0] === "lib" || parts[0] === "main")) return { target: "unit", path: [] };
  if (parts[parts.length - 1] === "mod") parts.pop();
  return { target: "unit", path: parts };
}

/** #[test] functions (also #[tokio::test] and the like) with their full test paths. rel is the path inside the crate. */
export function rustUnits(file: string, rel: string, text: string): Unit[] {
  const { target, path } = rustModule(rel);
  const toks = rustTokens(text);
  const out: Unit[] = [];
  const mods: { name: string; depth: number }[] = [];
  let depth = 0;
  let testAttr: number | null = null;
  let pendingMod: string | null = null;
  let fn: { name: string; start: number; open: number | null } | null = null;
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k]!;
    if (tok.t === "#" && toks[k + 1]?.t === "[") {
      let j = k + 2;
      let d = 1;
      const words: string[] = [];
      for (; j < toks.length && d > 0; j++) {
        if (toks[j]!.t === "[") d++;
        else if (toks[j]!.t === "]") d--;
        if (d > 0) words.push(toks[j]!.t);
      }
      const head = words.join("").split("(")[0]!;
      if (/^(?:[\w]+::)*test$/.test(head)) testAttr ??= tok.line;
      k = j - 1;
      continue;
    }
    if (tok.t === "mod" && /^[A-Za-z_]\w*$/.test(toks[k + 1]?.t ?? "") && toks[k + 2]?.t === "{") pendingMod = toks[k + 1]!.t;
    if (tok.t === "fn" && /^[A-Za-z_]\w*$/.test(toks[k + 1]?.t ?? "")) {
      if (testAttr !== null && !fn) fn = { name: toks[k + 1]!.t, start: testAttr, open: null };
      testAttr = null;
    }
    if (tok.t === ";" && fn && fn.open === null) fn = null;
    if (tok.t === "{") {
      depth++;
      if (pendingMod) {
        mods.push({ name: pendingMod, depth });
        pendingMod = null;
      }
      if (fn && fn.open === null) fn.open = depth;
    } else if (tok.t === "}") {
      if (fn && fn.open === depth) {
        out.push({ file, name: [...path, ...mods.map((m) => m.name), fn.name].join("::"), start: fn.start, end: tok.line, scope: target });
        fn = null;
      }
      if (mods.length && mods[mods.length - 1]!.depth === depth) mods.pop();
      depth--;
    } else if (tok.t !== "fn" && /^(struct|enum|impl|trait|const|static|use|type|let)$/.test(tok.t) && fn === null) testAttr = null;
  }
  return out;
}

/** The 1-based line on which the test or it call starting at (line, column) closes, following .each tables. */
export function tsCallEnd(text: string, line: number, column: number): number {
  const lines = text.split("\n");
  let i = lines.slice(0, line - 1).reduce((a, s) => a + s.length + 1, 0) + Math.max(0, column - 1);
  const n = text.length;
  const lineAt = (p: number) => text.slice(0, p).split("\n").length;
  const head = /^[\w$]+(?:\.[\w$]+(?:\([^()]*\))?)*/.exec(text.slice(i))?.[0] ?? "";
  const each = /\.each\b/.test(head);
  i += head.length;
  let calls = each ? 2 : 1;
  let end = line;
  let prevSig = "(";
  while (i < n && calls > 0) {
    while (i < n && /\s/.test(text[i]!)) i++;
    if (text[i] === "\u0060") {
      i = skipTemplate(text, i);
      continue;
    }
    if (text[i] !== "(") return end;
    let d = 0;
    for (; i < n; i++) {
      const ch = text[i]!;
      if (ch === "/" && text[i + 1] === "/") {
        while (i < n && text[i] !== "\n") i++;
        continue;
      }
      if (ch === "/" && text[i + 1] === "*") {
        const e = text.indexOf("*/", i + 2);
        i = e < 0 ? n : e + 1;
        continue;
      }
      if (ch === "'" || ch === '"') {
        i++;
        while (i < n && text[i] !== ch && text[i] !== "\n") i += text[i] === "\\" ? 2 : 1;
        prevSig = "a";
        continue;
      }
      if (ch === "\u0060") {
        i = skipTemplate(text, i) - 1;
        prevSig = "a";
        continue;
      }
      if (ch === "/" && /[(,=:[!&|?{};+\-*%<>~^]/.test(prevSig)) {
        i++;
        let cls = false;
        while (i < n && text[i] !== "\n" && (cls || text[i] !== "/")) {
          if (text[i] === "\\") i++;
          else if (text[i] === "[") cls = true;
          else if (text[i] === "]") cls = false;
          i++;
        }
        prevSig = "a";
        continue;
      }
      if (ch === "(") d++;
      else if (ch === ")") {
        d--;
        if (d === 0) {
          end = lineAt(i);
          i++;
          break;
        }
      }
      if (!/\s/.test(ch)) prevSig = /[\w$]/.test(ch) ? "a" : ch;
    }
    calls--;
  }
  return end;
}

function skipTemplate(text: string, i: number): number {
  i++;
  while (i < text.length && text[i] !== "\u0060") {
    if (text[i] === "\\") i += 2;
    else if (text[i] === "$" && text[i + 1] === "{") {
      let d = 1;
      i += 2;
      while (i < text.length && d > 0) {
        if (text[i] === "{") d++;
        else if (text[i] === "}") d--;
        else if (text[i] === "\u0060") i = skipTemplate(text, i) - 1;
        i++;
      }
    } else i++;
  }
  return i + 1;
}

/** Each test() or it() call in a TypeScript or JavaScript test file, found by its line; vitest reports the same line. */
export function tsUnits(file: string, text: string): Unit[] {
  const out: Unit[] = [];
  blankLiterals(text, true).split("\n").forEach((s, i) => {
    const re = /(^|[^.\w$])((?:it|test)(?:\.\w+(?:\([^()]*\))?)*)\s*[(\u0060]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const col = m.index + m[1]!.length + 1;
      out.push({ file, name: file + ":" + (i + 1) + ":" + col, start: i + 1, end: tsCallEnd(text, i + 1, col), scope: "" });
    }
  });
  return out;
}

/** The units the patch added or changed: those whose span holds an added line, and those whose old span (in before, the
 * same file's units before the patch) held a removed line, found by the first line of theirs the patch kept. So a test the
 * patch deleted whole changes none of its neighbours, and a test that only lost lines still counts as changed. */
export function changedUnits(units: Unit[], change: FileChange, before: Unit[] = []): Unit[] {
  const lines = new Set(change.added);
  for (const u of before) {
    if (!change.removed.some((n) => n >= u.start && n <= u.end)) continue;
    for (let n = u.start; n <= u.end; n++) {
      const now = newLine(change, n);
      if (now !== null) {
        lines.add(now);
        break;
      }
    }
  }
  return units.filter((u) => [...lines].some((n) => n >= u.start && n <= u.end));
}
