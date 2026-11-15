// Copyright (c) 2026 Garry Tan. MIT License.
// The custody builder (prereg section 2): transcript pages, the October ask audit's CSV and the rules history into
// AskItems. Only the frozen interface is read. Pages: DIR/<thread>/page-<n>.json, arrays of transcript items. Agent
// messages are source "assistant" items with text and tool "message_user" items with text; owner messages are source
// "user" items with an authorName (one of --owner when given); crew traffic (source "user", no authorName) enters only
// the variant bundle. Items are the audit rows whose class is not NOT_ASK; note and reply_kind are never read into an
// item. Rules: rule text and the earliest YYYY-MM-DD in the date text; an undated row takes the date of the next dated
// row with a higher rule number, and rows still unplaced are dropped and counted. Every text field passes the secret
// and contact scan (privacy.ts). Item ids are random bytes, never derived from content. Threads get codes in the order of
// their first ask row; the map stays in custody. The result is counts only on the way out; the CLI never prints text.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fail, FROZEN } from "./frozen.ts";
import { multiDecision } from "./ledger.ts";
import { emptyCount, mapTexts, redact, type ScanCount } from "./privacy.ts";
import { LABELS, type AskItem, type EarlierAsk, type Label, type Message, type OwnerMessage, type RuleRow } from "./types.ts";

export interface TranscriptItem {
  id: string;
  source: "assistant" | "user" | "tool";
  text?: string;
  tool?: string;
  authorName?: string;
  createdAt: string;
}

export interface AuditRow {
  thread: string;
  event: string;
  at: string;
  latency_min: string;
  class: string;
  reply_kind: string;
  note: string;
}

export const AUDIT_HEADER = ["thread", "event", "at", "latency_min", "class", "reply_kind", "note"] as const;
const CLASSES = new Set<string>(["NOT_ASK", ...LABELS]);

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"', i++);
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") (row.push(field), (field = ""));
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (quoted) fail("E_ASK_INPUT", "the audit CSV ends inside a quoted field");
  if (field !== "" || row.length) (row.push(field), rows.push(row));
  return rows;
}

export function parseAudit(text: string): AuditRow[] {
  const [header, ...rows] = parseCsv(text);
  if (!header || header.join(",") !== AUDIT_HEADER.join(",")) fail("E_ASK_INPUT", "the audit CSV header is not " + AUDIT_HEADER.join(","));
  return rows.map((r, i) => {
    if (r.length !== AUDIT_HEADER.length) fail("E_ASK_INPUT", "audit row " + (i + 2) + " has " + r.length + " fields, not " + AUDIT_HEADER.length);
    const row = Object.fromEntries(AUDIT_HEADER.map((k, j) => [k, r[j]!])) as unknown as AuditRow;
    if (!CLASSES.has(row.class)) fail("E_ASK_INPUT", "audit row " + (i + 2) + " has a class outside NOT_ASK, " + LABELS.join(", "));
    return row;
  });
}

/** DIR/<thread>/page-<n>.json, pages in number order, each a JSON array of transcript items. */
export function readPages(dir: string): Map<string, TranscriptItem[]> {
  const out = new Map<string, TranscriptItem[]>();
  for (const thread of readdirSync(dir).sort()) {
    const tdir = join(dir, thread);
    if (!statSync(tdir).isDirectory()) continue;
    const pages = readdirSync(tdir).filter((f) => /^page-\d+\.json$/.test(f)).sort((a, b) => Number(a.slice(5, -5)) - Number(b.slice(5, -5)));
    const items: TranscriptItem[] = [];
    for (const p of pages) {
      let v: unknown;
      try {
        v = JSON.parse(readFileSync(join(tdir, p), "utf8"));
      } catch {
        return fail("E_ASK_INPUT", "a transcript page is not JSON (" + pages.indexOf(p) + " of " + pages.length + " in a thread)");
      }
      if (!Array.isArray(v)) fail("E_ASK_INPUT", "a transcript page is not a JSON array");
      items.push(...(v as TranscriptItem[]));
    }
    out.set(thread, items);
  }
  return out;
}

export interface ParsedRules {
  rows: Array<RuleRow & { n: number }>;
  total: number;
  dated: number;
  placed: number;
  dropped: number;
  /** Rows whose date text holds more than one distinct date: restated or amended after their first date. */
  multi_dated: number;
}

/** Rule rows of the rules history: "| R<n> | rule text | owner's words | date text | scope | recorded at | status |". */
export function parseRules(md: string): ParsedRules {
  const raw: Array<{ n: number; text: string; date: string | null; dates: number }> = [];
  for (const line of md.split(/\r?\n/)) {
    const m = /^\s*\|\s*R(\d+)\s*\|(.*)\|\s*$/.exec(line);
    if (!m) continue;
    const cells = m[2]!.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
    if (cells.length < 6) fail("E_ASK_INPUT", "rule row R" + m[1] + " has " + (cells.length + 1) + " cells, not 7");
    const dates = (cells[2]!.match(/\d{4}-\d{2}-\d{2}/g) ?? []).sort();
    raw.push({ n: Number(m[1]), text: cells[0]!, date: dates[0] ?? null, dates: new Set(dates).size });
  }
  const sorted = raw.map((r, i) => ({ ...r, i })).sort((a, b) => a.n - b.n || a.i - b.i);
  const rows: ParsedRules["rows"] = [];
  let dropped = 0;
  for (const [k, r] of sorted.entries()) {
    const date = r.date ?? sorted.slice(k + 1).find((x) => x.n > r.n && x.date !== null)?.date ?? null;
    if (date === null) dropped++;
    else rows.push({ n: r.n, id: "R" + r.n, date, placed: r.date === null, text: r.text });
  }
  return { rows, total: raw.length, dated: raw.filter((r) => r.date !== null).length, placed: rows.filter((r) => r.placed).length, dropped, multi_dated: raw.filter((r) => r.dates > 1).length };
}

export interface BuildInput {
  threads: ReadonlyMap<string, readonly TranscriptItem[]>;
  audit: readonly AuditRow[];
  rules: string;
  /** Owner display names; when absent, any authorName counts as the owner. */
  owner?: readonly string[];
  variant?: boolean;
  /** Thread code prefix: T in custody, S for the synthetic set. */
  prefix?: string;
  /** Item ids; defaults to 12 random bytes from crypto.getRandomValues. */
  newId?: () => string;
}

export interface BuildCounts {
  items: number;
  per_class: Record<string, number>;
  per_thread: Record<string, Record<string, number>>;
  dropped: { unreadable: number; thread_missing: number };
  not_ask_rows: number;
  rules: { total: number; dated: number; placed: number; dropped: number; multi_dated: number };
  scan: ScanCount;
  tokens: { min: number; p25: number; median: number; p75: number; p90: number; max: number; mean: number } | null;
  multi_decision: number;
  cut: number;
  crew_messages: number;
}

const randomId = () => "i-" + Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("hex");

interface Msg extends Message {
  index: number;
  id: string;
}

function ordered(items: readonly TranscriptItem[]): TranscriptItem[] {
  const seen = new Set<string>();
  const out: Array<TranscriptItem & { k: number }> = [];
  for (const [k, t] of items.entries()) {
    if (!t || typeof t !== "object" || typeof t.id !== "string" || typeof t.createdAt !== "string" || Number.isNaN(Date.parse(t.createdAt))) fail("E_ASK_INPUT", "a transcript item has no id or no valid createdAt");
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({ ...t, k });
  }
  return out.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.k - b.k);
}

function messagesOf(items: readonly TranscriptItem[], owner: readonly string[] | undefined, variant: boolean): Map<string, Msg> {
  const out = new Map<string, Msg>();
  for (const [index, t] of items.entries()) {
    const text = typeof t.text === "string" ? t.text : "";
    if (!text.trim()) continue;
    const at = new Date(t.createdAt).toISOString();
    let from: Message["from"] | null = null;
    if (t.source === "assistant" || (t.source === "tool" && t.tool === "message_user")) from = "agent";
    else if (t.source === "user" && t.authorName) from = !owner?.length || owner.includes(t.authorName) ? "owner" : null;
    else if (t.source === "user" && !t.authorName && variant) from = "crew";
    if (from) out.set(t.id, { at, from, text, index, id: t.id });
  }
  return out;
}

const quantile = (xs: readonly number[], q: number) => xs[Math.min(xs.length - 1, Math.floor(q * xs.length))]!;

export function buildFrom(input: BuildInput): { items: AskItem[]; map: Record<string, string>; counts: BuildCounts } {
  const prefix = input.prefix ?? "T";
  const newId = input.newId ?? randomId;
  const rules = parseRules(input.rules);
  const asks = input.audit.filter((r) => r.class !== "NOT_ASK");
  const first = new Map<string, number>();
  for (const r of asks) first.set(r.thread, Math.min(first.get(r.thread) ?? Infinity, Date.parse(r.at) || Infinity));
  const names = [...first.keys()].sort((a, b) => first.get(a)! - first.get(b)! || (a < b ? -1 : 1));
  const map = Object.fromEntries(names.map((n, i) => [n, prefix + (i + 1)]));
  const counts: BuildCounts = { items: 0, per_class: Object.fromEntries(LABELS.map((l) => [l, 0])), per_thread: {}, dropped: { unreadable: 0, thread_missing: 0 }, not_ask_rows: input.audit.length - asks.length, rules: { total: rules.total, dated: rules.dated, placed: rules.placed, dropped: rules.dropped, multi_dated: rules.multi_dated }, scan: emptyCount(), tokens: null, multi_decision: 0, cut: 0, crew_messages: 0 };
  const memo = new Map<string, string>();
  const clean = (t: string) => {
    let v = memo.get(t);
    if (v === undefined) memo.set(t, (v = redact(t, counts.scan)));
    return v;
  };
  const items: AskItem[] = [];
  for (const name of names) {
    const transcript = input.threads.get(name);
    const rows = asks.filter((r) => r.thread === name);
    if (!transcript) {
      counts.dropped.thread_missing += rows.length;
      continue;
    }
    const msgs = messagesOf(ordered(transcript), input.owner, input.variant ?? false);
    const all = [...msgs.values()].sort((a, b) => a.index - b.index);
    const owners = all.filter((m) => m.from === "owner");
    const readable = rows.map((r) => ({ r, m: msgs.get(r.event) })).filter((x): x is { r: AuditRow; m: Msg } => x.m !== undefined && x.m.from === "agent").sort((a, b) => a.m.index - b.m.index);
    counts.dropped.unreadable += rows.length - readable.length;
    for (const { r, m } of readable) {
      const before = all.filter((x) => x.index < m.index);
      const kept: Msg[] = [];
      let chars = 0;
      for (let i = before.length - 1; i >= 0; i--) {
        if (chars + before[i]!.text.length > FROZEN.window.chars) break;
        chars += before[i]!.text.length;
        kept.unshift(before[i]!);
      }
      const ownerBetween = (lo: number, hi: number): OwnerMessage | null => {
        const o = owners.find((x) => x.index > lo && x.index < hi);
        return o ? { at: o.at, text: o.text } : null;
      };
      const earlier: EarlierAsk[] = readable.filter((x) => x.m.index < m.index).map((x) => ({ at: x.m.at, order: x.m.index, text: x.m.text, next_owner: ownerBetween(x.m.index, m.index) }));
      const day = m.at.slice(0, 10);
      const item: AskItem = {
        item: newId(),
        thread: map[name]!,
        at: m.at,
        order: m.index,
        label: r.class as Label,
        conversation: kept.map(({ at, from, text }) => ({ at, from, text })),
        cut: kept.length < before.length,
        rules: rules.rows.filter((x) => x.date <= day).map(({ id, date, placed, text }) => ({ id, date, placed, text })),
        draft: m.text,
        earlier_asks: earlier,
        after_reply: ownerBetween(m.index, Infinity),
      };
      items.push(mapTexts(item, clean));
    }
  }
  for (const it of items) {
    counts.items++;
    counts.per_class[it.label]!++;
    const t = (counts.per_thread[it.thread] ??= Object.fromEntries(LABELS.map((l) => [l, 0])));
    t[it.label]!++;
    if (multiDecision(it.draft)) counts.multi_decision++;
    if (it.cut) counts.cut++;
    counts.crew_messages += it.conversation.filter((m) => m.from === "crew").length;
  }
  const tokens = items.map((it) => Math.ceil(([...it.conversation.map((m) => m.text), ...it.rules.map((r) => r.text), it.draft, ...it.earlier_asks.map((e) => e.text)].join("").length) / 4)).sort((a, b) => a - b);
  if (tokens.length) counts.tokens = { min: tokens[0]!, p25: quantile(tokens, 0.25), median: quantile(tokens, 0.5), p75: quantile(tokens, 0.75), p90: quantile(tokens, 0.9), max: tokens.at(-1)!, mean: Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) };
  return { items, map, counts };
}

/** buildFrom on files: --pages DIR, --audit FILE, --rules FILE. */
export function buildFiles(o: { pages: string; audit: string; rules: string; owner?: string[]; variant?: boolean }) {
  for (const p of [o.pages, o.audit, o.rules]) if (!existsSync(p)) fail("E_ASK_INPUT", "no such input " + p);
  return buildFrom({ threads: readPages(o.pages), audit: parseAudit(readFileSync(o.audit, "utf8")), rules: readFileSync(o.rules, "utf8"), owner: o.owner, variant: o.variant });
}

export const toJsonl = (items: readonly AskItem[]): string => items.map((i) => JSON.stringify(i)).join("\n") + "\n";

export function readItems(file: string): AskItem[] {
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l, i) => {
    try {
      const v = JSON.parse(l) as AskItem;
      if (typeof v.item !== "string" || !Array.isArray(v.conversation) || !LABELS.includes(v.label)) throw new Error("shape");
      return v;
    } catch {
      return fail("E_ASK_INPUT", "items line " + (i + 1) + " is not an AskItem");
    }
  });
}
