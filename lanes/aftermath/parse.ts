// Copyright (c) 2026 Garry Tan. MIT License.
// The plan-changes reader the aftermath-keyed plan-review evals share (product-value, prereg 2026-11-08-geva-403,
// section 6; devex, prereg 2026-11-09-geva-417, section 6): the strict parse, the one frozen lenient parse, the
// normalizer every list goes through before a judge reads it, the per-cell length counts and the web contamination check.
// Each eval binds its own block size and lenient tolerances (lanes/product-value/parse.ts, lanes/devex/run/parse.ts):
//
// - The parser reads the main agent's own text blocks (capped.ts's mainAgentTexts), latest first. The strict parse
//   takes the last fence labelled plan-changes in the latest text that holds one. Its body must be one JSON object
//   whose "changes" is an array of strings; other keys are ignored.
// - The one lenient parse runs once when the strict parse finds no block or cannot read it. Its candidate is that same
//   last plan-changes fence, or, when no text holds one, the last fence of any label in the latest text that holds a
//   fence. It drops each comma that comes before a ] or } outside a string, and takes {"changes": [...]} or a bare JSON
//   array, every element a string, and, when the eval's binding turns singleKey on, an object with exactly one key whose
//   value is an array of strings. A candidate that still does not read, or no candidate, is no-block.
// - normalizeChanges keeps the first max strings; strips markdown (images and links to their text, code ticks, bold,
//   italics with * or _ at word edges, strikethrough) and then leading heading marks, bullets and numbering ("1.",
//   "1)", "(1)", "1:"); collapses whitespace; and cuts each string at its 40th word. A string that normalizes to nothing
//   stays an empty item. renderList writes numbered plain lines.
// - webUses finds every successful WebSearch or WebFetch result anywhere in a transcript, subagents included.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mainAgentTexts } from "../../src/trial/review/capped.ts";
import { cut40, words } from "../../src/trial/review/ceo-outcome.ts";
import { fencedBlocks } from "../../src/trial/review/findings.ts";
import { readTranscript } from "../../src/trial/review/readers.ts";

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

/** This file's bytes; each binding's parser sha256 covers them and its own. */
export const CORE_BYTES = readFileSync(fileURLToPath(import.meta.url));
export const parserSha256 = (bindingUrl: string): string => sha256(Buffer.concat([readFileSync(fileURLToPath(bindingUrl)), CORE_BYTES]));

export const FENCE = "plan-changes";
export const MAX_WORDS = 40;

/** Which tolerance the lenient parse needed: a fence labelled otherwise, trailing commas, a bare array, another single key. */
export type Lenient = "label" | "commas" | "array" | "key";

export type ChangesParse =
  | { kind: "changes"; changes: string[]; lenient: Lenient[] | null; body_sha256: string }
  | { kind: "no-block"; reason: string; body_sha256: string | null };

/** Drops each comma that comes before a ] or } outside a JSON string. */
export function dropTrailingCommas(body: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (inString) {
      out += c;
      if (c === "\\") out += body[++i] ?? "";
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    if (c === "," && /^\s*[\]}]/.test(body.slice(i + 1))) continue;
    out += c;
  }
  return out;
}

const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null);

export interface ParserOptions {
  /** How many changes a block keeps. */
  max: number;
  /** Whether the lenient parse takes an object with the array under another single key. */
  singleKey: boolean;
}

function readBody(body: string, lenient: boolean, singleKey: boolean): { changes: string[]; used: Lenient[] } | string {
  const fixed = lenient ? dropTrailingCommas(body) : body;
  let value: unknown;
  try {
    value = JSON.parse(fixed);
  } catch {
    return "the block is not valid JSON" + (lenient ? " even without trailing commas" : "");
  }
  const used: Lenient[] = fixed !== body ? ["commas"] : [];
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const changes = strings(obj.changes);
    if (changes) return { changes, used };
    const keys = Object.keys(obj);
    if (lenient && singleKey && !Object.hasOwn(obj, "changes") && keys.length === 1 && strings(obj[keys[0]!])) return { changes: obj[keys[0]!] as string[], used: [...used, "key"] };
    return 'the block\'s "changes" is not an array of strings';
  }
  if (lenient && strings(value)) return { changes: value as string[], used: [...used, "array"] };
  return lenient ? 'the block is neither {"changes": [...]} nor an array of strings' : "the block is not one JSON object";
}

/** The parse of a reply's main-agent texts, in order: the strict parse, then the one lenient parse. */
export function parseChanges(texts: readonly string[], o: ParserOptions): ChangesParse {
  let labelled: string | null = null;
  for (let t = texts.length - 1; t >= 0 && labelled === null; t--) labelled = fencedBlocks(texts[t]!).filter((b) => b.info.toLowerCase() === FENCE).at(-1)?.body ?? null;
  let strictWhy = "no fence is labelled " + FENCE;
  if (labelled !== null) {
    const strict = readBody(labelled, false, o.singleKey);
    if (typeof strict !== "string") return { kind: "changes", changes: strict.changes, lenient: null, body_sha256: sha256(labelled) };
    strictWhy = strict;
  }
  let candidate = labelled;
  let label = false;
  for (let t = texts.length - 1; t >= 0 && candidate === null; t--) {
    candidate = fencedBlocks(texts[t]!).at(-1)?.body ?? null;
    label = candidate !== null;
  }
  if (candidate === null) return { kind: "no-block", reason: strictWhy + ", and no other fence holds a candidate", body_sha256: null };
  const lenient = readBody(candidate, true, o.singleKey);
  if (typeof lenient === "string") return { kind: "no-block", reason: strictWhy + "; lenient parse: " + lenient, body_sha256: sha256(candidate) };
  return { kind: "changes", changes: lenient.changes, lenient: [...(label ? (["label"] as Lenient[]) : []), ...lenient.used], body_sha256: sha256(candidate) };
}

/** A session's one parse, from its transcript.ndjson text. */
export const transcriptParse = (transcript: string, o: ParserOptions): ChangesParse => parseChanges(mainAgentTexts(transcript), o);

const LEADING = /^(?:#{1,6}(?:\s+|$)|[-*+\u2022]\s+|\(\d{1,3}\)\s*|\d{1,3}[.):](?:\s+|$))/;

/** One change, normalized: markdown stripped, whitespace collapsed, cut at its 40th word. cut says the cut shortened it. */
export function normalizeItem(raw: string): { text: string; cut: boolean } {
  let s = raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/`+/g, "")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1$2")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(LEADING, "").trim();
  }
  const n = words(s);
  return { text: n > MAX_WORDS ? cut40(s) : s, cut: n > MAX_WORDS };
}

/** The normalized list: the first max strings, each normalized; its word count after the cut, item count and cut count. */
export function normalizeChanges(changes: readonly unknown[], max: number): { list: string[]; words: number; items: number; cut: number } {
  const items = changes.filter((c): c is string => typeof c === "string").slice(0, max).map(normalizeItem);
  return { list: items.map((i) => i.text), words: items.reduce((s, i) => s + words(i.text), 0), items: items.length, cut: items.filter((i) => i.cut).length };
}

/** The list as judges read it: numbered plain lines. */
export const renderList = (list: readonly string[]): string => list.map((t, i) => i + 1 + ". " + t).join("\n");

/** Per cell: mean words and items per block, the share of items the 40-word cut shortened, and the end-state counts. */
export function cellStats<E extends string>(rows: readonly { end: E; words: number; items: number; cut: number }[], ends: readonly E[], block: E) {
  const blocks = rows.filter((r) => r.end === block);
  const items = blocks.reduce((s, r) => s + r.items, 0);
  return {
    planned: rows.length,
    counts: Object.fromEntries(ends.map((e) => [e, rows.filter((r) => r.end === e).length])) as Record<E, number>,
    mean_words: blocks.length ? blocks.reduce((s, r) => s + r.words, 0) / blocks.length : null,
    mean_items: blocks.length ? items / blocks.length : null,
    cut_share: items ? blocks.reduce((s, r) => s + r.cut, 0) / items : null,
  };
}

export interface WebUse {
  tool: string;
  id: string;
  subagent: boolean;
}

type Rec = Record<string, any>;
const WEB_TOOLS = new Set(["WebSearch", "WebFetch"]);
export const resultText = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === "string" ? b.text : JSON.stringify(b))).join("\n") : c == null ? "" : JSON.stringify(c));

/** Every successful WebSearch or WebFetch result in a transcript, subagents included. */
export function webUses(transcript: string): WebUse[] {
  const messages = readTranscript(transcript).filter((m) => Array.isArray(m.message?.content));
  const results = new Map<string, Rec>();
  for (const m of messages) for (const b of m.message.content as Rec[]) if (b?.type === "tool_result" && typeof b.tool_use_id === "string") results.set(b.tool_use_id, b);
  const uses: WebUse[] = [];
  for (const m of messages) {
    if (m.type !== "assistant") continue;
    for (const b of m.message.content as Rec[]) {
      if (b?.type === "tool_use" && WEB_TOOLS.has(b.name)) {
        const r = results.get(b.id);
        if (r && r.is_error !== true && !resultText(r.content).includes("<tool_use_error>")) uses.push({ tool: b.name, id: String(b.id), subagent: !!m.parent_tool_use_id });
      }
      if ((b?.type === "web_search_tool_result" || b?.type === "web_fetch_tool_result") && !(typeof b.content?.type === "string" && b.content.type.endsWith("_error"))) uses.push({ tool: b.type, id: String(b.tool_use_id ?? ""), subagent: !!m.parent_tool_use_id });
    }
  }
  return uses;
}

const OVERFLOW = /prompt is too long|context (?:length|window)|maximum context|input is too long|too many (?:input )?tokens/i;

/** Whether an API error text in the transcript says the prompt or context was too long. */
export function overflowed(transcript: string): boolean {
  return readTranscript(transcript).some((m) => {
    if (m.type === "result" && m.is_error) return OVERFLOW.test(String(m.result ?? "") + " " + JSON.stringify(m.errors ?? ""));
    if (m.type !== "assistant" || !(m.error || m.is_api_error_message || m.message?.model === "<synthetic>")) return false;
    return OVERFLOW.test(resultText(m.message?.content));
  });
}
