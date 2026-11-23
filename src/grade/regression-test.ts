// Copyright (c) 2026 Garry Tan. MIT License.
// Tests added: whether a session's change adds at least one non-blank, non-comment line to a test, by the scorer's own split
// of changed lines into test and non-test (the rule the outcome scorer's non-test line count uses). A test file is one
// that matches the unit language's TEST_PATH convention or one the unit's hidden test patch touches. For a language with
// in-source test modules (Rust's #[cfg(test)] modules, TEST_MODULES), a line added inside such a module of a source file
// counts too. Pack planning files never count. The change is the session's whole extracted change, before the strict
// reading reverts edits to existing test files, so an edit that adds a test case to an existing test file counts.
import { isPlanning } from "../../lanes/outcome-skills/h2h/score/rules.ts";
import { walk, parsePatch } from "../../lanes/outcome-skills/statemachines/fixsplit.ts";
import { isTestPath, SOURCE_EXT, TEST_MODULES, type Lang } from "../../lanes/outcome-skills/statemachines/langs.ts";
import { extractChange } from "../../lanes/outcome-skills/statemachines/score.ts";
import { fileDiffs } from "../../lanes/outcome-skills/statemachines/secondary.ts";

/** A whole-line comment: the trimmed line starts with the language's comment marker. */
const COMMENT: Record<Lang, RegExp> = {
  rust: /^(\/\/|\/\*|\*)/,
  java: /^(\/\/|\/\*|\*)/,
  c: /^(\/\/|\/\*|\*)/,
  cpp: /^(\/\/|\/\*|\*)/,
  csharp: /^(\/\/|\/\*|\*)/,
  go: /^(\/\/|\/\*|\*)/,
  js: /^(\/\/|\/\*|\*)/,
  ts: /^(\/\/|\/\*|\*)/,
  python: /^#/,
};

export interface RegressionTest {
  /** At least one non-blank, non-comment test line added. */
  added: boolean;
  /** Paths that gained a non-blank test line, sorted. */
  files: string[];
  /** Non-blank, non-comment test lines added, over every such path. */
  lines: number;
}

/** Each added line of one file's diff with its line number in the new file. */
function addedLines(text: string): { at: number; line: string }[] {
  const out: { at: number; line: string }[] = [];
  for (const f of fileDiffs(text)) {
    for (const b of f.blocks) {
      let at = b.newAt;
      for (const l of b.lines) if (l.startsWith("+")) out.push({ at: at++, line: l.slice(1) });
    }
  }
  return out;
}

/** The new file's in-source test module ranges (1-based, inclusive), or [] when the language has none or the file is not
 *  a source file. readBase reads a base-tree file; a base file that can't be read gives no ranges. */
function moduleRanges(lang: Lang, path: string, oldPath: string | null, text: string, readBase: (path: string) => string | null): [number, number][] {
  const detect = TEST_MODULES[lang];
  if (!detect || !SOURCE_EXT[lang].test(path)) return [];
  const hunks = parsePatch(text)[0]?.hunks ?? [];
  const base = oldPath === null ? "" : readBase(oldPath);
  if (base === null) return [];
  try {
    return detect(walk(base, hunks, path).text);
  } catch {
    return [];
  }
}

export function regressionTest(patch: string, lang: Lang, testFiles: readonly string[], readBase: (path: string) => string | null): RegressionTest {
  const tests = new Set(testFiles);
  const files = new Set<string>();
  let lines = 0;
  for (const f of extractChange(patch).files) {
    if (f.binary || f.newPath === null || isPlanning(f.newPath)) continue;
    const added = addedLines(f.text).filter((a) => {
      const t = a.line.trim();
      return t !== "" && !COMMENT[lang].test(t);
    });
    if (!added.length) continue;
    const counted = isTestPath(lang, f.newPath, tests) ? added : (() => {
      const ranges = moduleRanges(lang, f.newPath!, f.oldPath, f.text, readBase);
      return added.filter((a) => ranges.some(([lo, hi]) => a.at >= lo && a.at <= hi));
    })();
    if (!counted.length) continue;
    files.add(f.newPath);
    lines += counted.length;
  }
  return { added: files.size > 0, files: [...files].sort(), lines };
}

/** The correction post's recount rule (#387, recount.ts section 2a): the change touches at least one file that matches the
 *  language's TEST_PATH convention, added or removed lines alike, with no hidden test files. Reported beside the frozen rule
 *  so the published counts reproduce exactly. */
export function testFileChanged(patch: string, lang: Lang): boolean {
  return fileDiffs(patch).some((f) => isTestPath(lang, f.newPath ?? f.oldPath ?? "", new Set()));
}
