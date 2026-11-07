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

/** Messages with roles alternating, starting with the user, one assistant message per API response (rebuildTurns). */
export function renderHistory(history: History): Message[] {
  return rebuildTurns(history).messages;
}

/**
 * The API turns of a history (GEVA-392 addendum). An assistant block joins the response before it while any of that
 * response's calls has no result yet, since the API starts no response before every call has its result; Claude Code
 * starts a call while its response still streams, so a result can be logged before the response's last call. The
 * response's results follow in the next user message: in logged order when all of them came after its last block, as
 * joining blocks by role gave, else in tool_use order (a rebuilt response). Text and order within a role are kept, and
 * no event is added or dropped. A history whose turns cannot be rebuilt refuses with E_TBV_HISTORY, naming only the
 * event number and the reason.
 */
export function rebuildTurns(history: History): { messages: Message[]; rebuilt: number } {
  const first = history.events[0];
  if (!first || first.kind !== "user-text") fail("E_TBV_HISTORY", "history " + history.task + " does not open with the user's first message");
  const out: Message[] = [];
  const push = (role: Message["role"], blocks: Block[]) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else if (blocks.length) out.push({ role, content: blocks });
  };
  const refuse = (n: number, why: string): never => fail("E_TBV_HISTORY", "the turns cannot be rebuilt at event " + n + ": " + why);
  const waiting = (k: number) => k + " of the response's calls " + (k === 1 ? "has" : "have") + " no result";
  type Response = { blocks: Block[]; calls: string[]; open: Set<string>; results: Map<string, Block>; answered: boolean; rebuilt: boolean };
  let r: Response | null = null;
  let rebuilt = 0;
  const seen = new Set<string>();
  const close = () => {
    if (!r) return;
    push("assistant", r.blocks);
    push("user", r.rebuilt ? r.calls.map((id) => r!.results.get(id)!) : [...r.results.values()]);
    if (r.rebuilt) rebuilt++;
    r = null;
  };
  for (const e of history.events) {
    if (e.kind === "user-text") {
      if (r?.open.size) refuse(e.n, "the user's text comes while " + waiting(r.open.size) + ", so its place among the turns is ambiguous");
      close();
      push("user", [{ type: "text", text: e.text }]);
    } else if (e.kind === "tool-result") {
      if (!r?.open.delete(e.tool_use_id)) return refuse(e.n, "the result answers no call of its response that still has no result");
      r.results.set(e.tool_use_id, { type: "tool_result", tool_use_id: e.tool_use_id, content: e.content, ...(e.is_error ? { is_error: true } : {}) });
      r.answered = true;
    } else {
      if (r?.answered && !r.open.size) close();
      r ??= { blocks: [], calls: [], open: new Set(), results: new Map(), answered: false, rebuilt: false };
      if (r.answered) r.rebuilt = true;
      if (e.kind === "assistant-text") r.blocks.push({ type: "text", text: e.text });
      else {
        if (seen.has(e.id)) refuse(e.n, "the call repeats an earlier call's id");
        seen.add(e.id);
        r.calls.push(e.id);
        r.open.add(e.id);
        r.blocks.push({ type: "tool_use", id: e.id, name: e.name, input: e.input });
      }
    }
  }
  if (r?.open.size) refuse(history.events[history.events.length - 1]!.n, waiting(r.open.size));
  close();
  return { messages: out, rebuilt };
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
