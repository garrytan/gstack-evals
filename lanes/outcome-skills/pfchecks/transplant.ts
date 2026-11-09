// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 6.2: T is S with every existing non-test source file put back to its base content, by the state machines
// eval's per-language test patterns and protected configuration list. In a file with in-source test modules (langs.ts
// TEST_MODULES), the agent's hunks wholly inside a test module stay and every other hunk goes back to base; a hunk the
// detector can't place wholly inside or outside goes back too and is counted as mixed. New files, edits to existing
// test files, protected build and test configuration and other existing files stay as S has them. Deleted files that
// are not test files are restored.
import { parsePatch, walk } from "../statemachines/fixsplit.ts";
import { classify, isProtected, TEST_MODULES, type Lang } from "../statemachines/langs.ts";

export interface Change { path: string; status: "A" | "M" | "D" }
export interface TransplantPlan {
  /** Paths checked out again from base. */
  restore: string[];
  /** Source files with in-source test modules, written with only their kept hunks. */
  write: { path: string; text: string }[];
  /** Existing non-test source files S changed or deleted outside test modules (section 9's product edits). */
  product_files: string[];
  deleted_restored: string[];
  kept_test_hunks: number;
  restored_hunks: number;
  mixed_hunks: number;
}

// Copied from statemachines/fixsplit.ts (not exported there): a hunk's place against the test-module ranges.
const inside = (ranges: [number, number][], n: number) => ranges.some(([a, b]) => n >= a && n <= b);
function place(ranges: { old: [number, number][]; new: [number, number][] }, mk: { old: number[]; new: number[] }): "test" | "source" | "mixed" {
  const hits = [...mk.old.map((n) => inside(ranges.old, n)), ...mk.new.map((n) => inside(ranges.new, n))];
  if (hits.every(Boolean)) return "test";
  if (!hits.some(Boolean)) return "source";
  return "mixed";
}

/** fileDiff(path) returns the file's base text and its unified diff from base to S (latin1). */
export function planTransplant(lang: Lang, testFiles: ReadonlySet<string>, changes: Change[], fileDiff: (path: string) => { base: string; diff: string }): TransplantPlan {
  const plan: TransplantPlan = { restore: [], write: [], product_files: [], deleted_restored: [], kept_test_hunks: 0, restored_hunks: 0, mixed_hunks: 0 };
  const detect = TEST_MODULES[lang];
  for (const c of [...changes].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    if (c.status === "A") continue;
    const cls = classify(lang, c.path, testFiles);
    if (c.status === "D") {
      if (cls === "test") continue;
      plan.restore.push(c.path);
      plan.deleted_restored.push(c.path);
      if (cls === "source" && !isProtected(c.path)) plan.product_files.push(c.path);
      continue;
    }
    if (cls !== "source" || isProtected(c.path)) continue;
    if (!detect) {
      plan.restore.push(c.path);
      plan.product_files.push(c.path);
      continue;
    }
    const { base, diff } = fileDiff(c.path);
    const hunks = parsePatch(diff)[0]?.hunks ?? [];
    const s = walk(base, hunks, "transplant " + c.path);
    const ranges = { old: detect(base), new: detect(s.text) };
    const where = s.marks.map((mk) => place(ranges, mk));
    const kept = hunks.filter((_, i) => where[i] === "test");
    plan.kept_test_hunks += kept.length;
    plan.restored_hunks += hunks.length - kept.length;
    plan.mixed_hunks += where.filter((w) => w === "mixed").length;
    if (kept.length === hunks.length) continue;
    plan.product_files.push(c.path);
    if (!kept.length) plan.restore.push(c.path);
    else plan.write.push({ path: c.path, text: walk(base, kept, "transplant " + c.path).text });
  }
  return plan;
}
