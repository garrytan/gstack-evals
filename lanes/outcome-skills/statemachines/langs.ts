// Copyright (c) 2026 Garry Tan. MIT License.
// The state machines family's frozen per-language lists (the post leaves their contents to the build; the module README
// writes each one as frozen at the commit that adds it). P1 holds the test-file conventions, the source extensions the
// scope rule counts, the protected test and build configuration, the skip markers and the feature-request screen. Later
// packages add the in-source test-module detectors, drift forms, state constructs, fix-title words and generated marks.
import { createHash } from "node:crypto";

export const LANGS = ["rust", "java", "c", "cpp", "csharp", "go", "js", "ts", "python"] as const;
export type Lang = (typeof LANGS)[number];

/** MultiLang's parquet file stem to the family's language name. */
export const DATASET_LANG: Record<string, Lang> = { c: "c", cpp: "cpp", cs: "csharp", go: "go", java: "java", js: "js", rust: "rust", ts: "ts" };

export const SOURCE_EXT: Record<Lang, RegExp> = {
  rust: /\.rs$/,
  java: /\.java$/,
  c: /\.[ch]$/,
  cpp: /\.(cc|cpp|cxx|c\+\+|c|h|hh|hpp|hxx|ipp|tpp|inl)$/,
  csharp: /\.cs$/,
  go: /\.go$/,
  js: /\.(js|mjs|cjs|jsx)$/,
  ts: /\.(ts|mts|cts|tsx|js|mjs|cjs|jsx)$/,
  python: /\.py$/,
};

/** Test-file conventions, by path. A unit's own test.patch files count as test files on top of these. */
export const TEST_PATH: Record<Lang, RegExp> = {
  rust: /(^|\/)(tests|benches)\//,
  java: /(^|\/)src\/test\/|(Test|Tests|IT)\.java$/,
  c: /(^|\/)tests?\/|(_test\.c|_unittest\.cc|(^|\/)test_[^/]*\.c)$/,
  cpp: /(^|\/)tests?\/|(_test\.(cc|cpp)|_unittest\.cc|(^|\/)test_[^/]*\.(c|cc|cpp))$/,
  csharp: /(^|\/)[^/]*\.Tests\/|(Tests|Test)\.cs$/,
  go: /_test\.go$/,
  js: /\.(test|spec)\.[^/]+$|(^|\/)(__tests__|test|tests)\//,
  ts: /\.(test|spec)\.[^/]+$|(^|\/)(__tests__|test|tests)\//,
  python: /(^|\/)tests?\/|(^|\/)(test_[^/]*|[^/]*_test|conftest)\.py$/,
};

/** An existing test file for the scorer's readings (section 7): one of the unit's test.patch files, or a path that matches
 *  the language's test-file conventions, whatever its extension (so a fixture under tests/ is a test file too). */
export const isTestPath = (lang: Lang, path: string, testFiles: ReadonlySet<string>): boolean => testFiles.has(path) || TEST_PATH[lang].test(path);

/** Paths that are never a unit's source: vendored, generated or build output. */
const NOT_SOURCE = /(^|\/)(node_modules|vendor|third_party|target|\.git|dist|build|__pycache__|\.venv|venv)(\/|$)/;

/** source: counts for the 1 to 6 file screen and the scope rule. test: by convention or the unit's test patch. other. */
export function classify(lang: Lang, path: string, testFiles: ReadonlySet<string> = new Set()): "source" | "test" | "other" {
  if (testFiles.has(path)) return "test";
  if (NOT_SOURCE.test(path) || !SOURCE_EXT[lang].test(path)) return "other";
  return TEST_PATH[lang].test(path) ? "test" : "source";
}

/** Rust source with its comments, strings and char literals blanked to spaces (newlines kept), so brace and attribute
 *  matching sees code only. Handles nested block comments, raw strings (r#"..."#, br"..."), byte strings and lifetimes. */
export function rustCode(text: string): string {
  const out = text.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const ident = (ch: string | undefined) => !!ch && /[A-Za-z0-9_]/.test(ch);
  let i = 0;
  while (i < text.length) {
    const c = text[i]!, n = text[i + 1];
    if (c === "/" && n === "/") {
      const e = text.indexOf("\n", i);
      const end = e < 0 ? text.length : e;
      blank(i, end);
      i = end;
    } else if (c === "/" && n === "*") {
      let depth = 1, j = i + 2;
      while (j < text.length && depth) {
        if (text[j] === "/" && text[j + 1] === "*") (depth++, (j += 2));
        else if (text[j] === "*" && text[j + 1] === "/") (depth--, (j += 2));
        else j++;
      }
      blank(i, j);
      i = j;
    } else if ((c === "r" || (c === "b" && n === "r")) && !ident(text[i - 1]) && /^b?r#*"/.test(text.slice(i, i + 260))) {
      const m = text.slice(i).match(/^b?r(#*)"/)!;
      const close = "\"" + m[1];
      const e = text.indexOf(close, i + m[0].length);
      const end = e < 0 ? text.length : e + close.length;
      blank(i, end);
      i = end;
    } else if (c === "\"" || (c === "b" && n === "\"" && !ident(text[i - 1]))) {
      let j = i + (c === "b" ? 2 : 1);
      while (j < text.length && text[j] !== "\"") j += text[j] === "\\" ? 2 : 1;
      blank(i, j + 1);
      i = j + 1;
    } else if (c === "'") {
      if (n === "\\") {
        const e = text.indexOf("'", i + 3);
        const end = e < 0 ? text.length : e + 1;
        blank(i, end);
        i = end;
      } else {
        const cp = text.codePointAt(i + 1);
        const w = cp !== undefined && cp > 0xffff ? 2 : 1;
        if (cp !== undefined && text[i + 1] !== "\n" && text[i + 1 + w] === "'") {
          blank(i, i + 2 + w);
          i += 2 + w;
        } else i++;
      }
    } else i++;
  }
  return out.join("");
}

const lineAt = (text: string, pos: number) => text.slice(0, pos).split("\n").length;

/** Rust's in-source test modules: each #[cfg(test)] attribute that sits on an inline mod (after any further attributes
 *  and a pub or pub(...) visibility), from the attribute's line, widened up over directly preceding attribute-only lines,
 *  to the line of the mod's closing brace. 1-based inclusive line ranges. An out-of-line mod (mod x;) is not a range. */
export function rustTestModules(text: string): [number, number][] {
  const code = rustCode(text);
  const lines = text.split("\n");
  const out: [number, number][] = [];
  for (const m of code.matchAll(/#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]/g)) {
    let j = m.index! + m[0].length;
    for (;;) {
      const ws = code.slice(j).match(/^\s*/)![0].length;
      j += ws;
      if (code[j] !== "#") break;
      const open = code.indexOf("[", j);
      if (open < 0) break;
      let depth = 0, k = open;
      for (; k < code.length; k++) {
        if (code[k] === "[") depth++;
        else if (code[k] === "]" && --depth === 0) break;
      }
      j = k + 1;
    }
    const head = code.slice(j).match(/^(pub(\s*\([^)]*\))?\s+)?mod\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/);
    if (!head) continue;
    let depth = 0, k = j + head[0].length - 1;
    for (; k < code.length; k++) {
      if (code[k] === "{") depth++;
      else if (code[k] === "}" && --depth === 0) break;
    }
    if (k >= code.length) continue;
    let start = lineAt(text, m.index!);
    while (start > 1 && /^\s*#!?\[.*\]\s*$/.test(lines[start - 2]!)) start--;
    out.push([start, lineAt(text, k)]);
  }
  return out;
}

/** The frozen in-source test-module detectors (section 7, step 2), by language. Rust's #[cfg(test)] modules are the only
 *  in-source form: the other languages here keep unit tests in test files (TEST_PATH, the dataset's test patterns), so
 *  their detector finds no range. */
export const TEST_MODULES: Record<Lang, ((text: string) => [number, number][]) | null> = {
  rust: rustTestModules, java: null, c: null, cpp: null, csharp: null, go: null, js: null, ts: null, python: null,
};

/** Protected test and build configuration (section 7): an arm's edit to one goes back to base under both readings, and a
 *  new file matching one is never applied. Starts from real-outcome's PROTECT_ERE. */
export const PROTECTED: RegExp[] = [
  /(^|\/)(Cargo\.toml|Cargo\.lock|build\.rs|rust-toolchain(\.toml)?)$/, /(^|\/)\.cargo\/config[^/]*$/,
  /(^|\/)(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.properties)$/, /(^|\/)gradle\/wrapper\//,
  /(^|\/)(CMakeLists\.txt|[^/]*\.cmake|Makefile|meson\.build|configure[^/]*)$/,
  /(^|\/)([^/]*\.csproj|[^/]*\.sln|Directory\.Build\.[^/]+|global\.json|nuget\.config)$/i,
  /(^|\/)(go\.mod|go\.sum)$/,
  /(^|\/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|npm-shrinkwrap\.json)$/,
  /(^|\/)(jest|vitest|karma|mocha|babel)\.config\.[^/]+$/, /(^|\/)(\.mocharc[^/]*|\.babelrc[^/]*|karma\.conf\.[^/]+|tsconfig[^/]*\.json)$/,
  /(^|\/)(conftest\.py|pytest\.ini|tox\.ini|setup\.cfg|pyproject\.toml|sitecustomize\.py|[^/]*\.pth)$/,
];
export const isProtected = (path: string): boolean => PROTECTED.some((r) => r.test(path));

/** Skip markers (section 7, adapted reading): an added line holding one fails the adapted conditions. */
export const SKIP_MARKERS: Record<Lang, string[]> = {
  rust: ["#[ignore"],
  java: ["@Disabled", "@Ignore", "Assumptions.assume", "Assume.assume"],
  c: ["GTEST_SKIP", "DISABLED_", "SKIP("],
  cpp: ["GTEST_SKIP", "DISABLED_", "SKIP("],
  csharp: ["[Ignore", "Skip =", "[Fact(Skip"],
  go: ["t.Skip(", "t.SkipNow(", "t.Skipf("],
  js: [".skip(", "xit(", "xdescribe(", ".todo("],
  ts: [".skip(", "xit(", "xdescribe(", ".todo("],
  python: ["@pytest.mark.skip", "skipif", "xfail", "unittest.skip", "pytest.skip("],
};

/** The feature-request screen (section 3): supply-count.py's FEAT pattern, byte for byte, case-insensitive, over the
 *  issue text's first 800 code points. */
export const FEAT_TEXT = String.raw`\b(feature request|add support for|support for|would be nice|enhancement|proposal|new option|allow (users? )?to)\b`;
export const FEAT_SHA256 = "d1d17a14b6888740aa8c3a6e0b0c53f88194c3c76d1d9c6b4b4217f7d4103f7d";
export const FEAT = new RegExp(FEAT_TEXT, "i");
export const featFirst800 = (issue: string): boolean => FEAT.test(Array.from(issue).slice(0, 800).join(""));
export const featDigest = (): string => createHash("sha256").update(FEAT_TEXT).digest("hex");

/** Drift forms (section 8 item 6), frozen at the commit that adds them. Each matches one error in a scoring run's log and
 *  captures the identifier it names: for compiled languages a compiler error, for JS, TypeScript and Python an import,
 *  attribute, reference or not-a-function error. A "module" capture is a module path; drift.ts reads its last segment. */
export interface DriftForm { kind: "import" | "attribute" | "reference" | "not_a_function" | "compiler"; capture: "name" | "module"; re: RegExp; source: string }
export const COMPILED: ReadonlySet<Lang> = new Set<Lang>(["rust", "java", "c", "cpp", "csharp", "go"]);
const Q = "['\u2018\`\"]", E = "['\u2019\`\"]";
const cc = (re: string, source: string): DriftForm => ({ kind: "compiler", capture: "name", re: new RegExp(re, "g"), source });
const C_FORMS: DriftForm[] = [
  cc("error: " + Q + "([A-Za-z_][\\w:]*)" + E + " (?:was not declared in this scope|undeclared)", "GCC: 'x' was not declared in this scope (C++), 'x' undeclared (C)"),
  cc("error: implicit declaration of function " + Q + "([A-Za-z_]\\w*)" + E, "GCC 14 and later: implicit declaration of function 'x' (an error by default)"),
  cc("has no member named " + Q + "([A-Za-z_]\\w*)" + E, "GCC: 'struct s' has no member named 'x'"),
  cc("error: " + Q + "([A-Za-z_][\\w:]*)" + E + " (?:is not a member of|has not been declared|does not name a type)", "GCC (C++): 'x' is not a member of 'ns', 'ns::x' has not been declared, 'X' does not name a type"),
  cc("error: unknown type name " + Q + "([A-Za-z_]\\w*)" + E, "GCC and Clang: unknown type name 'X'"),
  cc("error: (?:use of undeclared identifier|call to undeclared function) " + Q + "([A-Za-z_][\\w:]*)" + E, "Clang DiagnosticSemaKinds.td: use of undeclared identifier 'x', call to undeclared function 'x'"),
  cc("error: no (?:member|type) named " + Q + "([A-Za-z_]\\w*)" + E + " in", "Clang DiagnosticSemaKinds.td: no member named 'x' in 'S', no type named 'X' in 'ns'"),
];
const JS_FORMS: DriftForm[] = [
  { kind: "reference", capture: "name", re: /ReferenceError: ([A-Za-z_$][\w$]*) is not defined/g, source: "V8 message-template.h kNotDefined: % is not defined" },
  { kind: "not_a_function", capture: "name", re: /TypeError: (?:\(0\s*,\s*)?([A-Za-z_$][\w$.]*)\)? is not a function/g, source: "V8 message-template.h kCalledNonCallable: % is not a function (Babel's (0, _m.x) call form included)" },
  { kind: "import", capture: "name", re: /SyntaxError: The requested module '[^'\n]+' does not provide an export named '([A-Za-z_$][\w$]*)'/g, source: "V8 message-template.h kUnresolvableExport" },
  { kind: "import", capture: "module", re: /Cannot find module '([^'\n]+)'/g, source: "Node and Jest module resolution: Cannot find module 'x'" },
];
export const DRIFT_FORMS: Record<Lang, DriftForm[]> = {
  rust: [
    cc("error\\[E0(?:425|412|422|531|405|433)\\]: (?:cannot find|failed to resolve: (?:use of undeclared (?:type|crate or module)|could not find)) [^\x60\\n]*\x60([^\x60]+)\x60", "rustc error index E0425, E0412, E0422, E0531, E0405, E0433: cannot find value, function, type, struct, variant or trait \x60x\x60; failed to resolve"),
    cc("error: cannot find (?:macro|attribute|derive macro) \x60([^\x60]+)\x60", "rustc: cannot find macro \x60x\x60 in this scope"),
    cc("error\\[E0432\\]: unresolved imports? \x60([^\x60]+)\x60", "rustc error index E0432: unresolved import \x60a::x\x60"),
    cc("error\\[E0599\\]: no (?:method|function or associated item|variant or associated item|associated item|variant) named \x60([^\x60]+)\x60", "rustc error index E0599: no method named \x60x\x60 found"),
    cc("error\\[E0609\\]: no field \x60([^\x60]+)\x60", "rustc error index E0609: no field \x60x\x60 on type"),
    cc("error\\[E0560\\]: (?:struct|union|variant) \x60[^\x60]+\x60 has no field named \x60([^\x60]+)\x60", "rustc error index E0560: struct \x60S\x60 has no field named \x60x\x60"),
  ],
  go: [
    cc("undefined: ([A-Za-z_][\\w.]*)", "go/types UndeclaredName and UndeclaredImportedName: undefined: x, undefined: pkg.X"),
    cc("has no field or method ([A-Za-z_]\\w*)", "go/types MissingFieldOrMethod: x.F undefined (type T has no field or method F)"),
    cc("unknown field '?([A-Za-z_]\\w*)'? in struct literal", "go/types MissingLitField: unknown field F in struct literal"),
  ],
  java: [
    cc("cannot find symbol[\\s\\S]{0,400}?symbol:\\s+(?:class|method|variable|interface|enum|record|static)\\s+([A-Za-z_$][\\w$]*)", "javac compiler.properties compiler.err.cant.resolve: cannot find symbol, symbol: method x"),
    cc("package ([A-Za-z_][\\w.]*) does not exist", "javac compiler.properties compiler.err.doesnt.exist: package a.b does not exist"),
  ],
  c: C_FORMS,
  cpp: C_FORMS,
  csharp: [
    cc("error CS0103: The name '([A-Za-z_]\\w*)' does not exist", "C# CS0103: The name 'x' does not exist in the current context"),
    cc("error CS(?:0117|1061): '[^'\\n]+' does not contain a definition for '([A-Za-z_]\\w*)'", "C# CS0117 and CS1061: 'T' does not contain a definition for 'x'"),
    cc("error CS02(?:46|34): The type or namespace name '([A-Za-z_]\\w*)' (?:could not be found|does not exist)", "C# CS0246 and CS0234: The type or namespace name 'X' could not be found"),
  ],
  js: JS_FORMS,
  ts: [
    ...JS_FORMS,
    { kind: "reference", capture: "name", re: /TS(?:2304|2552): Cannot find name '([A-Za-z_$][\w$]*)'/g, source: "TypeScript diagnosticMessages.json 2304 and 2552: Cannot find name 'x'" },
    { kind: "attribute", capture: "name", re: /TS(?:2339|2551): Property '([A-Za-z_$][\w$]*)' does not exist on type/g, source: "TypeScript diagnosticMessages.json 2339 and 2551: Property 'x' does not exist on type 'T'" },
    { kind: "import", capture: "name", re: /TS(?:2305|2614): Module '.+?' has no exported member '([A-Za-z_$][\w$]*)'/g, source: "TypeScript diagnosticMessages.json 2305 and 2614: Module 'm' has no exported member 'x'" },
    { kind: "import", capture: "name", re: /TS2724: '.+?' has no exported member named '([A-Za-z_$][\w$]*)'/g, source: "TypeScript diagnosticMessages.json 2724: 'm' has no exported member named 'x'" },
    { kind: "import", capture: "module", re: /TS2307: Cannot find module '([^'\n]+)'/g, source: "TypeScript diagnosticMessages.json 2307: Cannot find module 'm'" },
  ],
  python: [
    { kind: "import", capture: "name", re: /ImportError: cannot import name '([A-Za-z_]\w*)'/g, source: "CPython import.c: cannot import name 'x' from 'm'" },
    { kind: "import", capture: "module", re: /ModuleNotFoundError: No module named '([\w.]+)'/g, source: "CPython import.c: No module named 'm'" },
    { kind: "attribute", capture: "name", re: /AttributeError: (?:module '[\w.]+'|'[^'\n]+' object|type object '[^'\n]+') has no attribute '([A-Za-z_]\w*)'/g, source: "CPython Objects/object.c and moduleobject.c: 'T' object has no attribute 'x', module 'm' has no attribute 'x'" },
    { kind: "reference", capture: "name", re: /NameError: name '([A-Za-z_]\w*)' is not defined/g, source: "CPython ceval.c: name 'x' is not defined" },
  ],
};

// ---- P4 lists (frozen at this commit): state constructs, fix-title words and generated marks (post section 10) ----

export type ConstructKind = "enum" | "sealed" | "union" | "table";
export const CONSTRUCT_KINDS: readonly ConstructKind[] = ["enum", "sealed", "union", "table"];
/** A line that defines or assigns something named for transitions: a transition table, map or function. */
const TABLE = /\b\w*transitions?\w*\s*(?::=|=(?!=)|:(?!:))/i;
const C_ENUM = /\benum\b/;
/** New state constructs, counted per added line of a source file; one pattern per kind and language. */
export const STATE_CONSTRUCTS: Record<Lang, Array<{ kind: ConstructKind; re: RegExp }>> = {
  rust: [{ kind: "enum", re: /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+\w/ }, { kind: "sealed", re: /\bmod\s+sealed\b|\btrait\s+Sealed\b/ }, { kind: "table", re: TABLE }],
  java: [{ kind: "enum", re: /\benum\s+\w/ }, { kind: "sealed", re: /\bsealed\s+(?:abstract\s+)?(?:interface|class)\b|\bpermits\s+\w/ }, { kind: "table", re: TABLE }],
  c: [{ kind: "enum", re: C_ENUM }, { kind: "table", re: TABLE }],
  cpp: [{ kind: "enum", re: C_ENUM }, { kind: "union", re: /\bstd::variant\s*</ }, { kind: "table", re: TABLE }],
  csharp: [{ kind: "enum", re: /\benum\s+\w/ }, { kind: "sealed", re: /\babstract\s+record\b/ }, { kind: "table", re: TABLE }],
  go: [{ kind: "enum", re: /\biota\b/ }, { kind: "sealed", re: /^\s*is[A-Z]\w*\(\)\s*$/ }, { kind: "table", re: TABLE }],
  js: [{ kind: "enum", re: /\bObject\.freeze\(\s*\{/ }, { kind: "table", re: TABLE }],
  ts: [{ kind: "enum", re: /\benum\s+\w/ }, { kind: "union", re: /\btype\s+\w+\s*=\s*\|?\s*(['"\x60])[^'"\x60]*\1\s*\|/ }, { kind: "table", re: TABLE }],
  python: [{ kind: "enum", re: /^\s*class\s+\w+\(\s*(?:enum\.)?(?:Enum|IntEnum|StrEnum|Flag|IntFlag)\s*\)/ }, { kind: "union", re: /\bLiteral\[\s*['"]/ }, { kind: "table", re: TABLE }],
};

/** A commit title that names a fix (later-fix overlap), case-insensitive, whole words. */
export const FIX_TITLE_TEXT = String.raw`\b(fix|fixes|fixed|fixing|bugfix|hotfix|bug|regression|crash|panic|resolve|resolves|resolved)\b`;
export const FIX_TITLE = new RegExp(FIX_TITLE_TEXT, "i");
export const fixTitleDigest = (): string => createHash("sha256").update(FIX_TITLE_TEXT).digest("hex");

/** A generated file's header: the word "generated" or "do not edit" on one of its first 5 lines, case-insensitive. */
export const GENERATED_HEADER = /\bgenerated\b|\bdo not edit\b/i;
export const GENERATED_LINES = 5;

