// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 2's told-mode screen, keyless. The issue text exists and has at least 200 characters; no line starts
// with "@@", "+++ " or "--- "; and the issue does not hold two or more of the lines the fix adds that have 30 characters
// or more, verbatim. Characters are code points. A line is compared with its ends trimmed on both sides.
export const TOLD = { min_chars: 200, line_chars: 30, shared_lines: 2 } as const;
export interface ToldDrop { rule: "issue_missing" | "issue_short" | "diff_block" | "fix_lines"; value: number }

const len = (s: string) => Array.from(s).length;

export function toldScreen(issue: string | null, fixPatch: string): ToldDrop | null {
  if (issue === null || !issue.trim()) return { rule: "issue_missing", value: 0 };
  if (len(issue) < TOLD.min_chars) return { rule: "issue_short", value: len(issue) };
  const lines = issue.split("\n").map((l) => l.replace(/\r$/, ""));
  const at = lines.findIndex((l) => l.startsWith("@@") || l.startsWith("+++ ") || l.startsWith("--- "));
  if (at >= 0) return { rule: "diff_block", value: at + 1 };
  const added = new Set(fixPatch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1).replace(/\r$/, "").trim()).filter((l) => len(l) >= TOLD.line_chars));
  const shared = new Set(lines.map((l) => l.trim()).filter((l) => added.has(l)));
  if (shared.size >= TOLD.shared_lines) return { rule: "fix_lines", value: shared.size };
  return null;
}
