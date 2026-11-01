// Copyright (c) 2026 Garry Tan. MIT License.
// K2 and K3 classification and the eligibility rules of plan section 2: a change that touches source and tests is K2
// when it closes an issue and K3 otherwise; it must touch at least two non-test source files or add at least 80
// non-test source lines (K1 is exempt), and it must add no dependency, because trial containers have no network.
import type { Change, FileChange } from "./changes.ts";
import { showFile } from "./git.ts";
import { isRequirementsFile } from "./paths.ts";

export const MIN_SOURCE_FILES = 2;
export const MIN_SOURCE_LINES = 80;

export interface Size {
  source_files: number;
  source_added: number;
  test_files: number;
}

export function sizeOf(files: FileChange[]): Size {
  const source = files.filter((f) => f.cls === "source");
  return { source_files: source.length, source_added: source.reduce((n, f) => n + f.added, 0), test_files: files.filter((f) => f.cls === "test").length };
}

export const meetsSize = (s: Size): boolean => s.source_files >= MIN_SOURCE_FILES || s.source_added >= MIN_SOURCE_LINES;

const PKG_KEYS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "bundledDependencies", "bundleDependencies", "overrides", "resolutions", "packageManager"];
const PYPROJECT_KEYS = [["project", "dependencies"], ["project", "optional-dependencies"], ["dependency-groups"], ["build-system", "requires"], ["tool", "poetry", "dependencies"], ["tool", "poetry", "dev-dependencies"], ["tool", "poetry", "group"], ["tool", "uv", "sources"], ["tool", "pdm", "dev-dependencies"]];
const CARGO_KEYS = [["dependencies"], ["dev-dependencies"], ["build-dependencies"], ["target"], ["workspace", "dependencies"], ["patch"], ["replace"]];

const pick = (obj: unknown, path: string[]): unknown => path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function goRequires(text: string | null): string {
  if (text === null) return "";
  return text
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter((l) => /^(require|replace|exclude|toolchain|go\s)/.test(l) || /^[\w.\-/]+\s+v\d/.test(l))
    .join("\n");
}

/** Whether one manifest's dependency set differs between two revisions. A file that can't be parsed counts as changed. */
export function manifestChanged(repoDir: string, from: string, to: string, path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const a = showFile(repoDir, from, path);
  const b = showFile(repoDir, to, path);
  if (a === b) return false;
  if (isRequirementsFile(path) || name === "setup.py" || name === "setup.cfg" || name === "Pipfile") return true;
  if (name === "go.mod") return goRequires(a) !== goRequires(b);
  try {
    if (name === "package.json") {
      const pa = a === null ? {} : JSON.parse(a);
      const pb = b === null ? {} : JSON.parse(b);
      return PKG_KEYS.some((k) => !same(pa[k], pb[k]));
    }
    const keys = name === "Cargo.toml" ? CARGO_KEYS : PYPROJECT_KEYS;
    const ta = a === null ? {} : Bun.TOML.parse(a);
    const tb = b === null ? {} : Bun.TOML.parse(b);
    return keys.some((k) => !same(pick(ta, k), pick(tb, k)));
  } catch {
    return true;
  }
}

/** Files whose change adds, removes or moves a dependency. */
export function dependencyChanges(repoDir: string, from: string, to: string, files: FileChange[]): string[] {
  return files.filter((f) => f.cls === "lockfile" || (f.cls === "manifest" && manifestChanged(repoDir, from, to, f.path))).map((f) => f.path);
}

/** Rust source files whose diff adds or edits inline test modules, which the hidden run can't separate from source. */
export function inlineTestFiles(repoDir: string, from: string, to: string, files: FileChange[]): string[] {
  return files
    .filter((f) => f.cls === "source" && f.path.endsWith(".rs"))
    .filter((f) => /#\[(cfg\()?test\)?\]/.test(showFile(repoDir, to, f.path) ?? "") && /#\[(cfg\()?test\)?\]/.test(diffText(repoDir, from, to, f.path)))
    .map((f) => f.path);
}

function diffText(repoDir: string, from: string, to: string, path: string): string {
  const a = (showFile(repoDir, from, path) ?? "").split("\n");
  const b = new Set(a);
  return (showFile(repoDir, to, path) ?? "").split("\n").filter((l) => !b.has(l)).join("\n");
}

export type BuildKind = "K2" | "K3";

/** K2 when the change closes an issue (from its pull request, or closing keywords when it has none), else K3. */
export const buildKind = (c: Change): BuildKind => (c.closing.length > 0 ? "K2" : "K3");
