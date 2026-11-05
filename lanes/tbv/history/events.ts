// Copyright (c) 2026 Garry Tan. MIT License.
// The canonical history: numbered events, their sha256, rendering to Messages API messages, and the drive-path refusal
// every assembler runs (prereg section 3, "No rules text from outside gstack").
import { notBuilt } from "../errors.ts";
import type { History, HistoryEvent, Message } from "../types.ts";

/** sha256 of the canonical JSON of the events (sorted keys), hex. */
export function historySha256(events: HistoryEvent[]): string {
  return notBuilt("historySha256");
}
/** Messages with roles alternating, starting with the user: consecutive blocks of one role join one message. */
export function renderHistory(history: History): Message[] {
  return notBuilt("renderHistory");
}
/** Refuses (E_TBV_HISTORY) text that holds a drive path, a Captain drive folder or a crew rules file name. */
export function refuseOutsideRules(text: string, where: string): void {
  notBuilt("refuseOutsideRules");
}
