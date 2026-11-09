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
