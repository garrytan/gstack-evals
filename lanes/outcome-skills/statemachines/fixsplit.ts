// Copyright (c) 2026 Garry Tan. MIT License.
// Tests inside the fix patch (post sections 3 and 7): the fix patch's hunks that sit wholly inside an in-source test
// module (langs.ts TEST_MODULES) are the fix's tests. They leave fix.patch for fix-tests.patch, which is never in the base
// tree or any arm's tree and is applied only with test.patch (the oracle's fixed runs, and scoring). A hunk the detector
// can't place wholly inside or wholly outside a test module drops the unit (E_SM_MIXED_TEST_HUNK). Only fix.patch's
// source files count for the 1 to 6 file rule. Pure: the base files come from a reader.
import { classify, SOURCE_EXT, TEST_MODULES, type Lang } from "./langs.ts";
import { smFail } from "./unit.ts";

interface Hunk { oldStart: number; oldCount: number; newCount: number; tail: string; body: string[]; left: [number, number] }
interface FileDiff { path: string; oldPath: string | null; header: string[]; hunks: Hunk[]; raw: string[] }

/** A git diff split into file sections and their hunks. A hunk ends when its line counts are used up (so a next header git
 *  can't parse still ends it); an empty line inside a hunk is an empty context line. A section with no hunk (binary, mode
 *  or rename only) keeps its raw lines. */
export function parsePatch(patch: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = patch.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  let f: FileDiff | null = null;
  let h: Hunk | null = null;
  for (const line of lines) {
    if (h && (h.left[0] > 0 || h.left[1] > 0)) {
      const k = line === "" ? " " : line[0];
      if (k === "\\") h.body.push(line);
      else {
        h.body.push(k === " " && line === "" ? " " : line);
        if (k !== "+") h.left[0]--;
        if (k !== "-") h.left[1]--;
      }
      f!.raw.push(line);
      continue;
    }
    if (h && line.startsWith("\\")) {
      h.body.push(line);
      f!.raw.push(line);
      continue;
    }
    h = null;
    const g = line.match(/^diff --git a\/(\S+) b\/(\S+)$/);
    if (g) {
      f = { path: g[2]!, oldPath: g[1]!, header: [line], hunks: [], raw: [line] };
      h = null;
      files.push(f);
      continue;
    }
    if (!f) smFail("E_SM_UNIT", "the fix patch does not start with a diff --git line");
    f!.raw.push(line);
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (m) {
      h = { oldStart: +m[1]!, oldCount: m[2] === undefined ? 1 : +m[2], newCount: m[4] === undefined ? 1 : +m[4], tail: m[5]!, body: [], left: [0, 0] };
      h.left = [h.oldCount, h.newCount];
      f!.hunks.push(h);
    } else {
      f!.header.push(line);
      if (line === "--- /dev/null") f!.oldPath = null;
    }
  }
  return files;
}

type Place = "test" | "source" | "mixed";

/** Applies a file's hunks to its base text, each at its stated line or the nearest offset where its old lines match (as
 *  git apply does, without fuzz); returns the new text and, per hunk, its removed (old) and added (new) line numbers. */
function walk(base: string, hunks: Hunk[], label: string): { text: string; marks: { old: number[]; new: number[] }[] } {
  const src = base === "" ? [] : base.split("\n");
  const out: string[] = [];
  const marks: { old: number[]; new: number[] }[] = [];
  let cur = 0;
  for (const h of hunks) {
    const old = h.body.filter((l) => l[0] === " " || l[0] === "-").map((l) => l.slice(1));
    const fits = (at: number) => at >= cur && at + old.length <= src.length && old.every((l, i) => src[at + i] === l);
    const stated = h.oldCount === 0 ? h.oldStart : h.oldStart - 1;
    let start = -1;
    for (let off = 0; start < 0 && off <= src.length; off++) start = fits(stated - off) ? stated - off : fits(stated + off) ? stated + off : -1;
    if (start < 0) smFail("E_SM_UNIT", label + ": the fix patch's hunk at line " + h.oldStart + " does not match the base file");
    while (cur < start) out.push(src[cur++]!);
    const mk = { old: [] as number[], new: [] as number[] };
    for (const l of h.body) {
      const k = l[0];
      if (k === "\\") continue;
      if (k === " " || k === "-") {
        if (src[cur] !== l.slice(1)) smFail("E_SM_UNIT", label + ": the fix patch does not match the base file at line " + (cur + 1));
        if (k === " ") out.push(src[cur]!);
        else mk.old.push(cur + 1);
        cur++;
      } else if (k === "+") {
        out.push(l.slice(1));
        mk.new.push(out.length);
      }
    }
    marks.push(mk);
  }
  while (cur < src.length) out.push(src[cur++]!);
  return { text: out.join("\n"), marks };
}

const inside = (ranges: [number, number][], n: number) => ranges.some(([a, b]) => n >= a && n <= b);

function place(ranges: { old: [number, number][]; new: [number, number][] }, mk: { old: number[]; new: number[] }): Place {
  const hits = [...mk.old.map((n) => inside(ranges.old, n)), ...mk.new.map((n) => inside(ranges.new, n))];
  if (hits.every(Boolean)) return "test";
  if (!hits.some(Boolean)) return "source";
  return "mixed";
}

/** A hunk header with its new start recounted for the hunks kept beside it. */
function section(f: FileDiff, hunks: Hunk[]): string {
  let delta = 0, s = f.header.join("\n") + "\n";
  for (const h of hunks) {
    const c = h.oldStart + delta + (h.oldCount === 0 ? 1 : 0) - (h.newCount === 0 ? 1 : 0);
    s += ["@@ -" + h.oldStart + "," + h.oldCount + " +" + c + "," + h.newCount + " @@" + h.tail, ...h.body].join("\n") + "\n";
    delta += h.newCount - h.oldCount;
  }
  return s;
}

export interface FixSplit {
  /** fix.patch: every non-test hunk, as the fix the oracle and arms are measured against. */
  fix: string;
  /** fix-tests.patch: the hunks wholly inside in-source test modules; empty when there are none. */
  tests: string;
  test_hunks: number;
  mixed: { path: string; hunk: number }[];
  /** Source files (classify) with at least one hunk left in fix.patch: the 1 to 6 file rule counts these. */
  source_files: string[];
}

/** Paths whose base text the split needs: the language has a detector and the file is a source file it changes. */
export function needsBase(lang: Lang, patch: string, testFiles: ReadonlySet<string>): string[] {
  if (!TEST_MODULES[lang]) return [];
  return parsePatch(patch).filter((f) => f.hunks.length && SOURCE_EXT[lang].test(f.path) && classify(lang, f.path, testFiles) === "source" && f.oldPath !== null).map((f) => f.oldPath!);
}

/** Splits the fix patch. base(path) returns a file's text at the base commit (needsBase lists which). */
export function splitFix(lang: Lang, patch: string, testFiles: ReadonlySet<string>, base: (path: string) => string, label: string): FixSplit {
  const detect = TEST_MODULES[lang];
  const want = new Set(needsBase(lang, patch, testFiles));
  let fix = "", tests = "", test_hunks = 0;
  const mixed: { path: string; hunk: number }[] = [];
  const source = new Set<string>();
  for (const f of parsePatch(patch)) {
    const isSource = classify(lang, f.path, testFiles) === "source";
    const newFile = f.oldPath === null && f.hunks.length && SOURCE_EXT[lang].test(f.path) && isSource;
    if (!detect || !f.hunks.length || !(want.has(f.oldPath ?? "") || newFile)) {
      fix += f.raw.join("\n") + "\n";
      if (isSource) source.add(f.path);
      continue;
    }
    const old = f.oldPath === null ? "" : base(f.oldPath);
    const w = walk(old, f.hunks, label + " " + f.path);
    const ranges = { old: detect(old), new: detect(w.text) };
    const where = w.marks.map((mk) => place(ranges, mk));
    where.forEach((p, i) => p === "mixed" && mixed.push({ path: f.path, hunk: i + 1 }));
    const t = f.hunks.filter((_, i) => where[i] === "test"), s = f.hunks.filter((_, i) => where[i] !== "test");
    test_hunks += t.length;
    if (t.length) tests += section(f, t);
    if (s.length) {
      fix += section(f, s);
      if (isSource) source.add(f.path);
    }
  }
  return { fix, tests, test_hunks, mixed, source_files: [...source].sort() };
}
