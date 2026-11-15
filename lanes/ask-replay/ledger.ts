// Copyright (c) 2026 Garry Tan. MIT License.
// The ask ledger as idea 1 would ship it (prereg section 4), applied by the harness in arms c and d. Rows are every
// earlier ask row in the thread, any class, in event order. A row's text is the first line left after stripping the
// frozen header and trailer lines (name lines, TL;DR lines, gstack: lines, markdown headings, empty lines), capped at
// 300 characters; its id is "q-" and the first 12 hex of sha256 of thread, sent time and text. Ruling K1: a row is
// answered once an owner message arrives after it and before the item's moment, and that message, capped at 300
// characters, is its quoted answer. The send-time check (rulings I1 and J1): SEND or FOLD naming an answered row becomes
// DROP unless reask_reason is non-empty after trimming; SEND naming an open row becomes FOLD; a missing repeats field or
// an unknown row id counts as new, and both are counted.
import { createHash } from "node:crypto";
import { FROZEN } from "./frozen.ts";
import type { Action, AskItem, GateRule, RepeatsKind, Reply } from "./types.ts";

const L = FROZEN.ledger;
const STRIP = L.strip.map((s) => new RegExp(s, "iu"));

export interface LedgerRow {
  id: string;
  at: string;
  order: number;
  text: string;
  status: "open" | "answered";
  answer: string | null;
  answered_at: string | null;
}

/** The row text of one ask: its first line that no strip rule matches, trimmed and capped. */
export function rowText(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const kept = lines.find((l) => !STRIP.some((r) => r.test(l))) ?? lines.find((l) => l) ?? "";
  return Array.from(kept).slice(0, L.row_text_cap).join("");
}

export const rowId = (thread: string, at: string, text: string): string => L.id_prefix + createHash("sha256").update(thread + "\n" + at + "\n" + text).digest("hex").slice(0, L.id_hex);

const cap = (t: string) => Array.from(t.trim()).slice(0, L.answer_quote_cap).join("");

/** The ledger at the item's moment, oldest first. */
export function ledgerRows(item: Pick<AskItem, "thread" | "earlier_asks">): LedgerRow[] {
  return [...item.earlier_asks]
    .sort((a, b) => a.order - b.order)
    .map((e) => ({ id: rowId(item.thread, e.at, e.text), at: e.at, order: e.order, text: rowText(e.text), status: e.next_owner ? "answered" : "open", answer: e.next_owner ? cap(e.next_owner.text) : null, answered_at: e.next_owner?.at ?? null }));
}

/** "asked <age> ago": minutes under an hour, hours under two days, then days, each rounded down. */
export function age(from: string, to: string): string {
  const min = Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 60000));
  const unit = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s");
  if (min < 60) return unit(min, "minute");
  if (min < 48 * 60) return unit(Math.floor(min / 60), "hour");
  return unit(Math.floor(min / 1440), "day");
}

/** The view the agent reads in arms c and d: open rows, then answered rows, each newest first. */
export function ledgerView(item: Pick<AskItem, "thread" | "earlier_asks" | "at">): string {
  const rows = ledgerRows(item).reverse();
  const open = rows.filter((r) => r.status === "open");
  const answered = rows.filter((r) => r.status === "answered");
  return [
    "Waiting on you (asks sent and not yet answered, newest first):",
    ...(open.length ? open.map((r) => "- " + r.id + ": " + r.text + " (asked " + age(r.at, item.at) + " ago)") : ["- none"]),
    "",
    "Answered (newest first):",
    ...(answered.length ? answered.flatMap((r) => ["- " + r.id + ": " + r.text, "  Answer: " + r.answer]) : ["- none"]),
  ].join("\n");
}

export interface GateResult {
  final_action: Action;
  repeats: RepeatsKind;
  named: string | null;
  reask_reason: boolean;
  gate: GateRule;
  /** The answer the gate quotes when it drops an ask. */
  quoted: string | null;
}

/** The send-time check on one c or d reply. */
export function sendCheck(reply: Reply, rows: readonly LedgerRow[]): GateResult {
  const reask = typeof reply.reask_reason === "string" && reply.reask_reason.trim() !== "";
  const keep = (repeats: RepeatsKind, named: string | null, gate: GateRule = "none"): GateResult => ({ final_action: reply.action, repeats, named, reask_reason: reask, gate, quoted: null });
  if (typeof reply.repeats !== "string") return keep("missing_field", null);
  const said = reply.repeats.trim();
  if (said.toLowerCase() === "new") return keep("new", null);
  const row = rows.find((r) => r.id === said);
  if (!row) return keep("unknown_id", null);
  if (row.status === "answered" && reply.action !== "DROP") {
    if (reask) return keep("named", row.id, "reask_kept");
    return { final_action: "DROP", repeats: "named", named: row.id, reask_reason: false, gate: "drop_answered", quoted: row.answer };
  }
  if (row.status === "open" && reply.action === "SEND") return { ...keep("named", row.id, "fold_open"), final_action: "FOLD" };
  return keep("named", row.id);
}
