// Copyright (c) 2026 Garry Tan. MIT License.
// The checklist run's verdict parser and per-build score (prereg section 6; gate-class under the Captain's D1 ruling).
// - The checker's first message is CHECK_HEADER, one block per hidden task in rank order (id, what the owner tries,
//   what counts as done, and the sample file when the task names one), then CHECK_FOOTER.
// - parseVerdicts reads the main agent's texts of the checker's last reply and takes the last fenced block labelled
//   verdicts. It must be a JSON object whose tasks list names every task id exactly once and nothing else, each with a
//   boolean done. Anything else is unparsable: the check runs once more in a fresh browser container, and a second
//   unparsable answer leaves the build unscored (a gap, never a zero).
// - scoreBuild: an app that never answers on its port scores no task done. Otherwise each task is done exactly when
//   the parsed verdict says so. share is done over the list's length; nothing_useful is true when none of the top
//   three tasks is done (or the app never started).
import { CHECK_FOOTER, CHECK_HEADER, VERDICT_FENCE } from "./frozen.ts";
import type { HiddenList, Task } from "./units.ts";

export interface Verdict {
  id: string;
  done: boolean;
  why: string;
}
export type VerdictParse = { kind: "ok"; tasks: Verdict[] } | { kind: "bad"; reason: string };

/** One task's block in the checker's message. */
export const taskBlock = (t: Pick<Task, "id" | "task" | "success" | "data">): string =>
  "Task " + t.id + ": " + t.task.trim() + "\nDone when: " + t.success.trim() + (t.data ? "\nFile: /samples/" + t.data.replace(/^samples\//, "") : "");

/** The checker's whole first message for one hidden list. */
export const checkPrompt = (list: Pick<HiddenList, "tasks">): string => [CHECK_HEADER, ...[...list.tasks].sort((a, b) => a.rank - b.rank).map(taskBlock), CHECK_FOOTER].join("\n\n");

const FENCE = new RegExp("```[ \\t]*" + VERDICT_FENCE + "[ \\t]*\\n([\\s\\S]*?)\\n[ \\t]*```", "g");

/** Reads the last verdicts block of the last reply's main-agent texts. */
export function parseVerdicts(texts: readonly string[], ids: readonly string[]): VerdictParse {
  const blocks = [...texts.join("\n\n").matchAll(FENCE)];
  if (!blocks.length) return { kind: "bad", reason: "no fenced block labelled " + VERDICT_FENCE };
  let obj: any;
  try {
    obj = JSON.parse(blocks.at(-1)![1]!);
  } catch (e) {
    return { kind: "bad", reason: "the last verdicts block is not JSON (" + (e as Error).message.slice(0, 120) + ")" };
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || !Array.isArray(obj.tasks)) return { kind: "bad", reason: "the block is not an object with a tasks list" };
  const seen = new Map<string, Verdict>();
  for (const t of obj.tasks) {
    if (!t || typeof t !== "object" || typeof t.id !== "string") return { kind: "bad", reason: "a verdict has no string id" };
    if (!ids.includes(t.id)) return { kind: "bad", reason: "the verdict for " + JSON.stringify(t.id) + " names no task" };
    if (seen.has(t.id)) return { kind: "bad", reason: "task " + t.id + " has two verdicts" };
    if (typeof t.done !== "boolean") return { kind: "bad", reason: "task " + t.id + "'s done is not a boolean" };
    seen.set(t.id, { id: t.id, done: t.done, why: typeof t.why === "string" ? t.why : "" });
  }
  const missing = ids.filter((id) => !seen.has(id));
  if (missing.length) return { kind: "bad", reason: "no verdict for " + missing.join(", ") };
  return { kind: "ok", tasks: ids.map((id) => seen.get(id)!) };
}

export interface BuildScore {
  started: boolean;
  /** Tasks done, in rank order; null when the build is unscored. */
  done: boolean[] | null;
  share: number | null;
  top3: number | null;
  nothing_useful: boolean | null;
}

/** The build's score from whether the app started and the parsed verdicts (null when both checks were unparsable). */
export function scoreBuild(list: Pick<HiddenList, "tasks">, started: boolean, parse: VerdictParse | null): BuildScore {
  const ranked = [...list.tasks].sort((a, b) => a.rank - b.rank);
  let done: boolean[] | null;
  if (!started) done = ranked.map(() => false);
  else if (!parse || parse.kind !== "ok") done = null;
  else done = ranked.map((t) => parse.tasks.find((v) => v.id === t.id)!.done);
  if (done === null) return { started, done: null, share: null, top3: null, nothing_useful: null };
  const top3 = done.slice(0, 3).filter(Boolean).length;
  return { started, done, share: done.filter(Boolean).length / done.length, top3, nothing_useful: top3 === 0 };
}
