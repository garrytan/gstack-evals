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
