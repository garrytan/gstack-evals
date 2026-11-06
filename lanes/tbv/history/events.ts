// Copyright (c) 2026 Garry Tan. MIT License.
// The canonical history: numbered events, their sha256, rendering to Messages API messages, and the drive-path refusal
// every assembler runs (prereg section 3, "No rules text from outside gstack").
import { createHash } from "node:crypto";
import { fail } from "../errors.ts";
import type { Block, History, HistoryEvent, Message } from "../types.ts";

const byCodePoint = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** Python's json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort(byCodePoint).map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
  }
  return JSON.stringify(v ?? null);
}

/** sha256 of the canonical JSON of the events (sorted keys), hex. */
export function historySha256(events: HistoryEvent[]): string {
  return createHash("sha256").update(canonical(events)).digest("hex");
}

/** Messages with roles alternating, starting with the user: consecutive blocks of one role join one message. */
export function renderHistory(history: History): Message[] {
  const first = history.events[0];
  if (!first || first.kind !== "user-text") fail("E_TBV_HISTORY", "history " + history.task + " does not open with the user's first message");
  const out: Message[] = [];
  for (const e of history.events) {
    let role: Message["role"];
    let block: Block;
    if (e.kind === "user-text") [role, block] = ["user", { type: "text", text: e.text }];
    else if (e.kind === "assistant-text") [role, block] = ["assistant", { type: "text", text: e.text }];
    else if (e.kind === "tool-use") [role, block] = ["assistant", { type: "tool_use", id: e.id, name: e.name, input: e.input }];
    else [role, block] = ["user", { type: "tool_result", tool_use_id: e.tool_use_id, content: e.content, ...(e.is_error ? { is_error: true } : {}) }];
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(block);
    else out.push({ role, content: [block] });
  }
  return out;
}

const OUTSIDE_RULES: Array<[RegExp, string]> = [
  [/\.capy\/drive\b/, "a drive path"],
  [/\bcaptain-[\w.-]+\//, "a Captain drive folder"],
  [/\bCREW\.md\b/, "a crew rules file"],
  [/\bsoftware-factory\/rules\.md\b/, "a crew rules file"],
];

/** Refuses (E_TBV_HISTORY) text that holds a drive path, a Captain drive folder or a crew rules file name. */
export function refuseOutsideRules(text: string, where: string): void {
  for (const [rx, what] of OUTSIDE_RULES) {
    if (rx.test(text)) fail("E_TBV_HISTORY", where + " holds " + what + " (" + rx.source + "); a history carries no rules text from outside gstack");
  }
}
