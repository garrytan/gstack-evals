// Copyright (c) 2026 Garry Tan. MIT License.
// Path classes shared by the miner (does a change touch source and tests?) and the task verifier (which files the
// hidden run restores from gold). The patterns are strings that read the same as a JavaScript RegExp and as a POSIX
// ERE, because the verifier's prepare.sh applies them with grep -E.

export type Language = "python" | "typescript" | "javascript" | "go" | "rust";
export type PathClass = "vendored" | "lockfile" | "manifest" | "release" | "test" | "source" | "other";

/** Test files and test-only directories, in every language the lane mines. */
export const TEST_PATTERNS = [
  "(^|/)(tests?|__tests__|testdata|spec)/",
  "(^|/)test_[^/]*\\.py$",
  "_test\\.py$",
  "(^|/)conftest\\.py$",
  "_test\\.go$",
  "\\.(test|spec)\\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$",
  "(^|/)\\.?pytest\\.ini$",
];

/** Files that change how a test run starts or what it loads. The hidden run keeps only gold's copies. */
export const RUNNER_CONFIG_PATTERNS = ["(^|/)(sitecustomize|usercustomize)\\.py$", "\\.pth$", "(^|/)go\\.work(\\.sum)?$"];

/** Directories that hold installed dependencies. They come from the task image, never from a tree under test. */
export const INSTALL_DIRS = [".git", ".venv", "venv", "node_modules", ".tox", "__pypackages__"];

const VENDORED = /(^|\/)(node_modules|vendor|third_party|dist|build|\.venv|venv)\/|\.min\.js$/;
const LOCKFILES = new Set(["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "poetry.lock", "uv.lock", "Pipfile.lock", "pdm.lock", "go.sum", "Cargo.lock", "requirements.lock"]);
const MANIFESTS = new Set(["package.json", "pyproject.toml", "setup.py", "setup.cfg", "Pipfile", "go.mod", "Cargo.toml"]);
const RELEASE = /^(VERSION|CHANGELOG[^/]*|TODOS[^/]*)$/i;
const SOURCE_EXT: Record<string, Language> = { py: "python", pyi: "python", ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", go: "go", rs: "rust" };

const TEST_RES = TEST_PATTERNS.map((p) => new RegExp(p));
const RUNNER_RES = RUNNER_CONFIG_PATTERNS.map((p) => new RegExp(p));

const base = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export const isTestPath = (path: string): boolean => TEST_RES.some((re) => re.test(path));
export const isRunnerConfigPath = (path: string): boolean => RUNNER_RES.some((re) => re.test(path));
export const isProtectedPath = (path: string): boolean => isTestPath(path) || isRunnerConfigPath(path);
export const inInstallDir = (path: string): boolean => INSTALL_DIRS.some((d) => path === d || path.startsWith(d + "/"));
export const isRequirementsFile = (path: string): boolean => /^requirements[^/]*\.(txt|in)$/.test(base(path));

export function languageOf(path: string): Language | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot < path.lastIndexOf("/")) return null;
  return SOURCE_EXT[path.slice(dot + 1)] ?? null;
}

export function classifyPath(path: string): PathClass {
  if (VENDORED.test(path)) return "vendored";
  const name = base(path);
  if (LOCKFILES.has(name)) return "lockfile";
  if (MANIFESTS.has(name) || isRequirementsFile(path)) return "manifest";
  if (!path.includes("/") && RELEASE.test(name)) return "release";
  if (isTestPath(path)) return "test";
  if (languageOf(path) !== null) return "source";
  return "other";
}
