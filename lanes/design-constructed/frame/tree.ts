// Copyright (c) 2026 Garry Tan. MIT License.
// The file check's view of a clone: every regular file outside .git and node_modules, never through a symlink, and
// every package.json there with the packages it names. Nothing in the clone runs; files are only read.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Folders the walk never enters, at any depth. */
export const SKIPPED_DIRS: readonly string[] = [".git", "node_modules"];

/** Repo-relative paths with "/" separators, sorted, of every regular file outside SKIPPED_DIRS. */
export function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const d of readdirSync(rel ? join(root, rel) : root, { withFileTypes: true })) {
      const p = rel ? rel + "/" + d.name : d.name;
      if (d.isDirectory()) {
        if (!SKIPPED_DIRS.includes(d.name)) walk(p);
      } else if (d.isFile()) out.push(p);
    }
  };
  walk("");
  return out.sort();
}

/** Reads a file as text, or null past maxBytes or when it can't be read. */
export function readText(root: string, rel: string, maxBytes = 2_000_000): string | null {
  try {
    const p = join(root, rel);
    if (statSync(p).size > maxBytes) return null;
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

export interface PackageJson {
  /** Repo-relative folder holding the package.json; "" for the root. */
  dir: string;
  /** Name to version range, from dependencies, devDependencies and peerDependencies. */
  deps: Record<string, string>;
}

/** Every package.json outside node_modules that parses as a JSON object. */
export function readPackages(root: string, files: readonly string[]): PackageJson[] {
  const out: PackageJson[] = [];
  for (const f of files) {
    if (f !== "package.json" && !f.endsWith("/package.json")) continue;
    const text = readText(root, f);
    if (text === null) continue;
    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      continue;
    }
    if (!j || typeof j !== "object" || Array.isArray(j)) continue;
    const deps: Record<string, string> = {};
    for (const k of ["peerDependencies", "devDependencies", "dependencies"]) {
      const m = j[k];
      if (m && typeof m === "object" && !Array.isArray(m)) for (const [n, v] of Object.entries(m)) deps[n] = String(v);
    }
    out.push({ dir: f === "package.json" ? "" : f.slice(0, -"/package.json".length), deps });
  }
  return out;
}

/** The parent folder of a repo-relative path; "" at the root. */
export const parentOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

/** True when dir is folder or lies under it. */
export const under = (rel: string, folder: string) => folder === "" || rel === folder || rel.startsWith(folder + "/");
