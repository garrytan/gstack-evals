// Copyright (c) 2026 Garry Tan. MIT License.
// The product-value eval's closing block (prereg 2026-11-08-geva-403, sections 5 and 6): the plan-changes parser, its one
// frozen lenient parse, the normalizer every list goes through before a judge reads it, the per-cell length counts, the
// web contamination check and each session's end state. The rules, with the build-time choices this file makes:
//
// - The parser reads the main agent's own text blocks (capped.ts's mainAgentTexts: no subagent text, API error or
//   AskUserQuestion), latest first. The strict parse takes the last fence labelled plan-changes in the latest text that
//   holds one. Its body must be one JSON object whose "changes" is an array of strings; other keys are ignored.
// - The one lenient parse runs once when the strict parse finds no block or cannot read it. Its candidate is that same
//   last plan-changes fence, or, when no text holds one, the last fence of any label in the latest text that holds a
//   fence. It drops each comma that comes before a ] or } outside a string, and takes {"changes": [...]} or a bare JSON
//   array, every element a string. A candidate that still does not read, or no candidate, is no-block.
// - normalizeChanges keeps the first five strings; strips markdown (images and links to their text, code ticks, bold,
//   italics with * or _ at word edges, strikethrough) and then leading heading marks, bullets and numbering ("1.",
//   "1)", "(1)", "1:"); collapses whitespace; and cuts each string at its 40th word (ceo-outcome.ts's words and cut40). A
//   string that normalizes to nothing stays an empty item. renderList writes "1." to "5." plain lines. It is exported for
//   the stock rows and oracle lists, so every list goes through the same code.
// - webUses finds every successful WebSearch or WebFetch result anywhere in a transcript, subagents included: a client
//   tool call whose result is present, not an error and holds no tool_use_error tag, or a server tool result block
//   (web_search_tool_result or web_fetch_tool_result) whose content is not an error object, empty result lists included.
// - pvOutcome reads one attempt: contaminated when webUses finds anything; cap when the ledger item's cap stopped it;
//   block when either parse reads a block, whatever the termination; no-block for a completed session or a turn cap;
//   otherwise an infrastructure failure under one named reason. A timeout or a background deadline is a harness
//   timeout, an allowance stop is an allowance stop, the arm's CLI failing or an unreadable transcript is a crash, and
//   every other ending (a provider error, an infra incident, rejected credentials, an unknown send) is an API error, or a
//   context overflow when an API error text in the transcript says the prompt or context was too long. The run gives an
//   infrastructure failure one retry; a second failure is missing (E_PV_INFRA_MISSING).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mainAgentTexts } from "../../src/trial/review/capped.ts";
import { cut40, words } from "../../src/trial/review/ceo-outcome.ts";
import { fencedBlocks } from "../../src/trial/review/findings.ts";
import { readTranscript } from "../../src/trial/review/readers.ts";
import type { Termination } from "../../src/types.ts";
import type { EndState, Row } from "./types.ts";

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

/** sha256 of this file: part of a product-value session key's verifier, and stored with every journaled parse. */
export const PV_PARSER_SHA256 = sha256(readFileSync(fileURLToPath(import.meta.url)));

export const PV_FENCE = "plan-changes";
export const MAX_CHANGES = 5;
export const MAX_WORDS = 40;

/** Which tolerance the lenient parse needed: a fence labelled otherwise, trailing commas, a bare array. */
export type Lenient = "label" | "commas" | "array";

export type PvParse =
  | { kind: "changes"; changes: string[]; lenient: Lenient[] | null; body_sha256: string }
  | { kind: "no-block"; reason: string; body_sha256: string | null }
  /** The session's transcript.ndjson could not be read. */
  | { kind: "unreadable"; reason: string };

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

function readBody(body: string, lenient: boolean): { changes: string[]; used: Lenient[] } | string {
  const fixed = lenient ? dropTrailingCommas(body) : body;
  let value: unknown;
  try {
    value = JSON.parse(fixed);
  } catch {
    return "the block is not valid JSON" + (lenient ? " even without trailing commas" : "");
  }
  const used: Lenient[] = fixed !== body ? ["commas"] : [];
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const changes = strings((value as Record<string, unknown>).changes);
    return changes ? { changes, used } : 'the block\'s "changes" is not an array of strings';
  }
  if (lenient && strings(value)) return { changes: value as string[], used: [...used, "array"] };
  return lenient ? 'the block is neither {"changes": [...]} nor an array of strings' : "the block is not one JSON object";
}

/** The parse of a reply's main-agent texts, in order: the strict parse, then the one lenient parse. */
export function parsePv(texts: readonly string[]): Extract<PvParse, { kind: "changes" | "no-block" }> {
  let labelled: string | null = null;
  for (let t = texts.length - 1; t >= 0 && labelled === null; t--) labelled = fencedBlocks(texts[t]!).filter((b) => b.info.toLowerCase() === PV_FENCE).at(-1)?.body ?? null;
  let strictWhy = "no fence is labelled " + PV_FENCE;
  if (labelled !== null) {
    const strict = readBody(labelled, false);
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
  const lenient = readBody(candidate, true);
  if (typeof lenient === "string") return { kind: "no-block", reason: strictWhy + "; lenient parse: " + lenient, body_sha256: sha256(candidate) };
  return { kind: "changes", changes: lenient.changes, lenient: [...(label ? (["label"] as Lenient[]) : []), ...lenient.used], body_sha256: sha256(candidate) };
}

/** A session's one parse, from its transcript.ndjson text. */
export const pvTranscriptParse = (transcript: string): Extract<PvParse, { kind: "changes" | "no-block" }> => parsePv(mainAgentTexts(transcript));

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

/** The normalized list: the first five strings, each normalized; its word count after the cut, item count and cut count. */
export function normalizeChanges(changes: readonly unknown[]): { list: string[]; words: number; items: number; cut: number } {
  const items = changes.filter((c): c is string => typeof c === "string").slice(0, MAX_CHANGES).map(normalizeItem);
  return { list: items.map((i) => i.text), words: items.reduce((s, i) => s + words(i.text), 0), items: items.length, cut: items.filter((i) => i.cut).length };
}

/** The list as judges read it: "1." to "5." plain lines. */
export const renderList = (list: readonly string[]): string => list.map((t, i) => i + 1 + ". " + t).join("\n");

/** Per cell: mean words and items per block, the share of items the 40-word cut shortened, and the end-state counts. */
export function cellStats(rows: readonly Pick<Row, "end" | "words" | "items" | "cut">[]) {
  const blocks = rows.filter((r) => r.end === "block");
  const items = blocks.reduce((s, r) => s + r.items, 0);
  const count = (e: EndState) => rows.filter((r) => r.end === e).length;
  return {
    planned: rows.length, blocks: blocks.length, no_block: count("no-block"), missing: count("missing"), contaminated: count("contaminated"),
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
const resultText = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === "string" ? b.text : JSON.stringify(b))).join("\n") : c == null ? "" : JSON.stringify(c));

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

export const INFRA_REASONS = ["API error", "crash", "harness timeout", "allowance stop", "context overflow"] as const;
export type InfraReason = (typeof INFRA_REASONS)[number];
const OVERFLOW = /prompt is too long|context (?:length|window)|maximum context|input is too long|too many (?:input )?tokens/i;

/** Whether an API error text in the transcript says the prompt or context was too long. */
function overflowed(transcript: string): boolean {
  return readTranscript(transcript).some((m) => {
    if (m.type === "result" && m.is_error) return OVERFLOW.test(String(m.result ?? "") + " " + JSON.stringify(m.errors ?? ""));
    if (m.type !== "assistant" || !(m.error || m.is_api_error_message || m.message?.model === "<synthetic>")) return false;
    return OVERFLOW.test(resultText(m.message?.content));
  });
}

export type PvOutcome =
  | { state: "block" | "no-block" | "cap" }
  | { state: "contaminated"; web: WebUse[] }
  | { state: "infra"; reason: InfraReason; detail: string };

/** One attempt's outcome and its parse; transcript is null when host/transcript.ndjson could not be read. */
export function pvOutcome(termination: Termination, transcript: string | null): { outcome: PvOutcome; parse: PvParse } {
  const unreadable: PvParse = { kind: "unreadable", reason: "host/transcript.ndjson is unreadable" };
  if (termination.kind === "cap_stop") return { outcome: { state: "cap" }, parse: transcript === null ? unreadable : pvTranscriptParse(transcript) };
  if (transcript === null) return { outcome: { state: "infra", reason: "crash", detail: "host/transcript.ndjson is unreadable" }, parse: unreadable };
  const parse = pvTranscriptParse(transcript);
  const web = webUses(transcript);
  if (web.length) return { outcome: { state: "contaminated", web }, parse };
  if (parse.kind === "changes") return { outcome: { state: "block" }, parse };
  const k = termination.kind;
  if (k === "completed" || k === "turn_cap") return { outcome: { state: "no-block" }, parse };
  const ended = k + ("code" in termination && termination.code ? " (" + termination.code + ")" : "incident" in termination ? " (" + termination.incident + ")" : "");
  if (k === "timeout" || (k === "missing" && termination.code === "E_BACKGROUND_DEADLINE")) return { outcome: { state: "infra", reason: "harness timeout", detail: ended }, parse };
  if (k === "allowance_stop") return { outcome: { state: "infra", reason: "allowance stop", detail: ended }, parse };
  if (k === "arm_failure") return { outcome: { state: "infra", reason: "crash", detail: ended }, parse };
  return { outcome: { state: "infra", reason: overflowed(transcript) ? "context overflow" : "API error", detail: ended }, parse };
}

/** The session's end state from its last attempt: an infrastructure failure on the retry is missing; a cap stop has none. */
export const endStateOf = (last: PvOutcome): EndState | null => (last.state === "block" || last.state === "no-block" || last.state === "contaminated" ? last.state : last.state === "infra" ? "missing" : null);

const HELP = "gstack-evals pv parse <reply.txt | transcript.ndjson>\n  Prints the strict or lenient parse of the reply's last plan-changes block, the normalized list and its counts.";

export function run(argv: string[], io: { out: (t: string) => void; err: (t: string) => void }): number {
  const file = argv[0];
  if (!file || argv.length !== 1 || file.startsWith("-")) {
    io.out(HELP);
    return file === "--help" || file === "-h" ? 0 : 2;
  }
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    io.err("E_USAGE pv parse: cannot read " + file + ": " + (e as Error).message + "\nE_USAGE fix: pass a reply text file or a session's host/transcript.ndjson");
    return 2;
  }
  const parse = file.endsWith(".ndjson") ? pvTranscriptParse(text) : parsePv([text]);
  const normalized = parse.kind === "changes" ? normalizeChanges(parse.changes) : null;
  io.out(JSON.stringify({ parser_sha256: PV_PARSER_SHA256, parse, normalized, rendered: normalized ? renderList(normalized.list) : null }, null, 2));
  return 0;
}
