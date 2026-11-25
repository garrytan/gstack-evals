// Copyright (c) 2026 Garry Tan. MIT License.
// Vendored from garrytan/gstack at d74ee528b6df9ddb945be2103a24544babe76e65 (lib/state-matrix.ts detectStateMachine and
// words, lib/banned-terms.ts addedLines), unchanged in logic: the rule that decides whether gstack's /review dispatches its
// State Machines specialist. SR records it on each unit's pull request (plan section 8) and never edits it.
const SUBJECT = new Set(["proposal", "proposals", "propose", "proposed", "hold", "holds", "held", "approval", "approvals", "pending"]);
const ACTION = new Set(["accept", "accepted", "accepts", "approve", "approved", "approves", "drop", "dropped", "drops", "reject", "rejected", "rejects", "deny", "denied", "dismiss", "dismissed", "withdraw", "withdrawn", "release", "released"]);
const NOT_CODE = [/(^|\/)(test|tests|spec|__tests__|fixtures?|docs?)\//, /\.(test|spec)\.[a-z0-9]+$/i, /_(test|spec)\.[a-z0-9]+$/i, /\.(md|txt|json|ya?ml|lock)$/i];

export function words(text: string): string[] {
  return text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase());
}

export function addedLines(diff: string): Map<string, Array<{ line: number; text: string }>> {
  const out = new Map<string, Array<{ line: number; text: string }>>();
  let file = "", line = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) { file = raw.slice(4).replace(/^b\//, "").replace(/\t.*$/, ""); if (file === "/dev/null") file = ""; continue; }
    if (raw.startsWith("--- ") || raw.startsWith("diff --git") || raw.startsWith("index ")) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (!file) continue;
    if (raw.startsWith("+")) { (out.get(file) ?? out.set(file, []).get(file)!).push({ line, text: raw.slice(1) }); line += 1; }
    else if (!raw.startsWith("-") && !raw.startsWith("\\")) line += 1;
  }
  return out;
}

/** Whether the specialist dispatches on a unified=0 diff, with the words that matched. */
export function detectStateMachine(diff: string): { detected: boolean; hits: number; subject: string[]; action: string[] } {
  const hits: Array<{ subject: string[]; action: string[] }> = [];
  for (const [file, lines] of addedLines(diff)) {
    if (NOT_CODE.some((re) => re.test(file))) continue;
    for (const l of lines) {
      const w = words(l.text);
      const subject = [...new Set(w.filter((x) => SUBJECT.has(x)))], action = [...new Set(w.filter((x) => ACTION.has(x)))];
      if (subject.length || action.length) hits.push({ subject, action });
    }
  }
  const detected = hits.some((h) => h.subject.length) && hits.some((h) => h.action.length);
  return { detected, hits: detected ? hits.length : 0, subject: detected ? [...new Set(hits.flatMap((h) => h.subject))].sort() : [], action: detected ? [...new Set(hits.flatMap((h) => h.action))].sort() : [] };
}
