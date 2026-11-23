// Copyright (c) 2026 Garry Tan. MIT License.
// Section 3's scope rule: the deepest directory holding every non-test source file the fix changed, widened one parent at
// a time until it holds at least 10 source files of the unit's language (tracked files, test files excluded). The
// repository root stops the widening. The prompt shows the dir relative to repo_dir, "." for the root.
import { classify, type Lang } from "./langs.ts";
import { runBash, type Where } from "./history.ts";
import { smFail } from "./unit.ts";

export const MIN_FILES = 10;

const parent = (d: string) => (d.includes("/") ? d.slice(0, d.lastIndexOf("/")) : "");
const under = (d: string, f: string) => d === "" || f.startsWith(d + "/");

export function scopeOf(lang: Lang, tracked: string[], fixSource: string[], testFiles: ReadonlySet<string>): { dir: string; files: string[]; widened: number } {
  if (!fixSource.length) smFail("E_SM_UNIT", "the fix changes no non-test source file, so it has no scope");
  let dir = fixSource.map(parent).reduce((a, b) => {
    const x = a.split("/"), y = b.split("/");
    let i = 0;
    while (i < x.length && i < y.length && x[i] === y[i]) i++;
    return x.slice(0, i).join("/");
  });
  const source = tracked.filter((f) => classify(lang, f, testFiles) === "source");
  let widened = 0;
  let files = source.filter((f) => under(dir, f));
  while (files.length < MIN_FILES && dir !== "") {
    dir = parent(dir);
    widened++;
    files = source.filter((f) => under(dir, f));
  }
  return { dir: dir === "" ? "." : dir, files, widened };
}

export const TRACKED_SCRIPT = 'cd "$1" && git ls-files -z';
export const LINES_SCRIPT = 'cd "$1" && xargs -0 -r cat -- < "$2/files" | wc -l';

/** The unit's scope on its prepared tree: dir, source file count, their line count, and widening steps. */
export function scope(where: Where, lang: Lang, fixSource: string[], testFiles: string[]): { dir: string; files: number; lines: number; widened: number } {
  const t = runBash(where, TRACKED_SCRIPT);
  if (t.status !== 0) smFail("E_SM_UNIT", "git ls-files failed on the tree: " + t.stderr.slice(-200));
  const s = scopeOf(lang, t.stdout.split("\0").filter(Boolean), fixSource, new Set(testFiles));
  const l = runBash(where, LINES_SCRIPT, { files: s.files.map((f) => f + "\0").join("") });
  return { dir: s.dir, files: s.files.length, lines: Number(l.stdout.trim()) || 0, widened: s.widened };
}
