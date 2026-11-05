// Copyright (c) 2026 Garry Tan. MIT License.
// Splice sets (prereg section 3): the captured skill invocation, the skill-start Bash call and its stdout, Reads as Claude
// Code renders them, capy's three files; and the closer byte check on de-rendered text.
import { notBuilt } from "./errors.ts";
import type { Family, History, Message, SpliceSet } from "./types.ts";

export interface SpliceOptions {
  family: Family;
  pin: string;
  claude: string;
  gstack: string;
  out: string;
}
export function captureSplice(o: SpliceOptions): Promise<SpliceSet> {
  return notBuilt("captureSplice");
}
/** The arm's messages: the splice's opening (filled with the task's first user message), head, the history's work, tail. */
export function applySplice(history: History, splice: SpliceSet): Message[] {
  return notBuilt("applySplice");
}
/** The closer byte check on de-rendered request text (line-number prefixes removed). */
export function closerHolds(body: Record<string, unknown>, splice: SpliceSet): boolean {
  return notBuilt("closerHolds");
}
