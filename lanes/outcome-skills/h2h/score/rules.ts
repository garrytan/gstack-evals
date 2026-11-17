// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 7 rule 3 and section 9's lines secondary. The fix's new test paths come from test.patch (and
// fix-tests.patch when the fix was split); an arm section that writes one of them is dropped before scoring. Lines changed
// are the added plus deleted lines of the strict reading, test files, lockfiles and generated files out, with a pack's
// planning files counted apart. A strict section that puts an in-source test module back to base replaces the whole
// file, so its lines are counted as git diff --numstat counts the two texts.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { isProtected, isTestPath, type Lang } from "../../statemachines/langs.ts";
import { extractChange, readings, sections } from "../../statemachines/score.ts";
import { fileDiffs, whatChanged } from "../../statemachines/secondary.ts";
import type { SmUnit } from "../../statemachines/unit.ts";
import { parsePatch } from "../../mutation/diff.ts";

/** Lockfiles by file name; a lockfile's lines never count. */
export const LOCKFILES: ReadonlySet<string> = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "deno.lock", "Cargo.lock", "go.sum",
  "poetry.lock", "uv.lock", "Pipfile.lock", "pdm.lock", "requirements.lock", "Gemfile.lock", "composer.lock", "Podfile.lock", "Package.resolved",
  "packages.lock.json", "gradle.lockfile", "mix.lock", "pubspec.lock", "flake.lock",
]);
/** A pack's own planning files, from the project root (section 9): GSD, Superpowers, agent-skills and gstack. */
export const PLANNING: readonly RegExp[] = [/^\.planning\//, /^docs\/superpowers\//, /^SPEC\.md$/, /^tasks\/plan\.md$/, /^tasks\/todo\.md$/, /^\.gstack\//];
export const isPlanning = (path: string): boolean => PLANNING.some((r) => r.test(path));

const read = (dir: string, name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : "");

/** The paths where the fix adds a new test file. */
export function newTestPaths(unitDir: string, u: Pick<SmUnit, "split">): string[] {
  const patches = [read(unitDir, "test.patch"), u.split ? read(unitDir, "fix-tests.patch") : ""];
  return [...new Set(patches.flatMap((p) => parsePatch(p).filter((c) => c.oldPath === null && c.newPath !== null).map((c) => c.newPath!)))].sort();
}

/** The arm's patch without its sections that write a new-test path, and the paths dropped. */
export function dropAtPaths(patch: string, paths: readonly string[]): { patch: string; dropped: string[] } {
  const at = new Set(paths);
  const keep: string[] = [], dropped: string[] = [];
  for (const s of sections(patch)) {
    const c = parsePatch(s)[0];
    if (c?.newPath && at.has(c.newPath)) dropped.push(c.newPath);
    else keep.push(s.endsWith("\n") ? s : s + "\n");
  }
  return { patch: keep.join(""), dropped: [...new Set(dropped)].sort() };
}

function numstat(from: string, to: string): number {
  const dir = mkdtempSync(join(tmpdir(), "h2h-numstat-"));
  try {
    writeFileSync(join(dir, "a"), from);
    writeFileSync(join(dir, "b"), to);
    const r = spawnSync("git", ["diff", "--no-index", "--numstat", "--no-renames", "a", "b"], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir, LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
    const m = /^(\d+)\t(\d+)\t/m.exec(r.stdout ?? "");
    return m ? Number(m[1]) + Number(m[2]) : 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface LineCounts { lines: number; planning: number; generated: string[]; lockfiles: string[] }

/** Section 9's lines over the strict reading of patch. readBase reads a file of the base tree (null when absent). */
export function lineCounts(patch: string, lang: Lang, testFiles: readonly string[], readBase: (path: string) => string | null): LineCounts {
  const testSet = new Set(testFiles);
  const ch = extractChange(patch);
  let strict: string;
  let replaced = new Set<string>();
  try {
    const base = (p: string) => {
      const t = readBase(p);
      if (t === null) throw new Error("E_SM_APPLY_FAILED " + p + " is not in the base tree");
      return t;
    };
    const rd = readings(lang, testSet, ch, base);
    strict = rd.strict;
    replaced = new Set(rd.excluded.filter((x) => x.rule === "in_source_test").map((x) => x.path));
  } catch (e) {
    if (!(e as Error).message.startsWith("E_SM_APPLY_FAILED")) throw e;
    strict = ch.files.filter((f) => ![f.oldPath, f.newPath].some((p) => p !== null && (isProtected(p) || (f.oldPath !== null && isTestPath(lang, f.oldPath, testSet))))).map((f) => f.text).join("");
  }
  const generated = new Set(whatChanged(strict, { lang, scopeDir: null, testFiles: [...testSet], readBase }).generated.map((g) => g.path));
  const out: LineCounts = { lines: 0, planning: 0, generated: [...generated].sort(), lockfiles: [] };
  for (const f of fileDiffs(strict)) {
    const p = f.newPath ?? f.oldPath ?? "";
    if (f.binary || generated.has(p)) continue;
    if (LOCKFILES.has(basename(p))) {
      out.lockfiles.push(p);
      continue;
    }
    const n = replaced.has(p) ? numstat(f.minus.join("\n") + "\n", f.plus.join("\n") + "\n") : f.plus.length + f.minus.length;
    if (isPlanning(p)) out.planning += n;
    else if (!isTestPath(lang, p, testSet)) out.lines += n;
  }
  out.lockfiles.sort();
  return out;
}
