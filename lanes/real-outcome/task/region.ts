// Copyright (c) 2026 Garry Tan. MIT License.
// The test-region rule (eng-review build read, plan section 3): only test code moves into a graded tree. A file at a
// protected test path moves whole. A Rust source file with one inline cfg(test) module gives up only that module, so the
// tree keeps its own product code in the same file. Any other file that holds both product and test code is mixed, and
// its cases drop rather than move product code.

export type FileClass = { kind: "product" } | { kind: "region"; start: number; end: number } | { kind: "mixed"; why: string };

/** Which offsets of a Rust file are code, outside comments, strings and char literals, so a brace in a string can't end
 * a module. */
function rustCode(text: string): boolean[] {
  const code = new Array<boolean>(text.length).fill(false);
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text[i] === "/" && text[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (text[i] === "*" && text[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      continue;
    }
    const raw = /^b?r(#*)"/.exec(text.slice(i, i + 260));
    if (raw && !/\w/.test(text[i - 1] ?? "")) {
      const close = '"' + raw[1];
      const end = text.indexOf(close, i + raw[0].length);
      i = end < 0 ? text.length : end + close.length;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "'") {
      const lit = /^'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|.)|[^\\'\n])'/.exec(text.slice(i, i + 16));
      if (lit) {
        i += lit[0].length;
        continue;
      }
    }
    code[i] = true;
    i++;
  }
  return code;
}

/** Where a Rust file's inline test module sits, or why the file is mixed. A file with no test code is product. */
export function rustClass(text: string): FileClass {
  const code = rustCode(text);
  const at = (re: RegExp) => [...text.matchAll(re)].filter((m) => code[m.index!]);
  const mods = at(/#\[cfg\(test\)\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*([{;])/g);
  const tests = at(/#\[(?:\w+::)*test\b[^\]]*\]/g);
  if (mods.length === 0) return tests.length === 0 ? { kind: "product" } : { kind: "mixed", why: "test functions outside a cfg(test) module" };
  if (mods.length > 1) return { kind: "mixed", why: mods.length + " cfg(test) modules" };
  const m = mods[0];
  if (m[1] === ";") return { kind: "mixed", why: "an out-of-line cfg(test) module" };
  const start = m.index!;
  let depth = 0;
  for (let i = 0; i < start; i++) if (code[i]) depth += text[i] === "{" ? 1 : text[i] === "}" ? -1 : 0;
  if (depth !== 0) return { kind: "mixed", why: "a cfg(test) module that is not at the top level" };
  let end = -1;
  for (let i = start + m[0].length - 1; i < text.length; i++) {
    if (!code[i]) continue;
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end < 0) return { kind: "mixed", why: "an unclosed cfg(test) module" };
  if (tests.some((t) => t.index! < start || t.index! >= end)) return { kind: "mixed", why: "test functions outside the cfg(test) module" };
  return { kind: "region", start, end };
}

/** Test markers in a source file outside the protected test paths, for languages with no inline-test region. */
const INLINE_TESTS: [RegExp, RegExp][] = [
  [/\.py$/, /^\s*(?:async\s+)?def\s+test_\w*\s*\(|^\s*class\s+Test\w*\s*[(:]/m],
  [/\.[cm]?[jt]sx?$/, /\bimport\.meta\.vitest\b|^\s*(?:describe|it|test)(?:\.\w+)?\s*\(\s*['"\x60]/m],
];

/** A file's class under the test-region rule. Call it only for files outside the protected test paths. */
export function classifyFile(path: string, text: string): FileClass {
  if (path.endsWith(".rs")) return rustClass(text);
  const rule = INLINE_TESTS.find(([file]) => file.test(path));
  return rule && rule[1].test(text) ? { kind: "mixed", why: "test code in a source file" } : { kind: "product" };
}

/** The file with its test region taken out: what the product hash reads. */
export function productText(path: string, text: string): string {
  const c = classifyFile(path, text);
  if (c.kind !== "region") return text;
  return (text.slice(0, c.start) + text.slice(c.end)).trimEnd() + "\n";
}

/** A file's test region, or null when it has none. */
export function regionText(path: string, text: string): string | null {
  const c = classifyFile(path, text);
  return c.kind === "region" ? text.slice(c.start, c.end) : null;
}

/** The tree's file with its own test region replaced by the source's, so the tree keeps every byte of its product code. A
 * tree that lacks the file gets the test region alone. */
export function splice(path: string, tree: string | null, source: string): string {
  const region = regionText(path, source);
  if (region === null) throw new Error(path + ": the source file has no test region to move");
  const product = tree === null ? "" : productText(path, tree).trimEnd();
  return (product ? product + "\n\n" : "") + region + "\n";
}
