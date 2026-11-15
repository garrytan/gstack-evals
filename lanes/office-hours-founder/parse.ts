// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's closing block (prereg section 6): the first-move parser, its one frozen lenient parse,
// the normalizer every block, stock row and oracle block goes through before a judge reads it, and the split of a
// session's transcript into replies. The rules, with the build-time choices this file makes:
//
// - A reply is the main agent's own text blocks (capped.ts's mainAgentTexts rule: no subagent text, API error or
//   AskUserQuestion) between two turn results in transcript.ndjson. The session loop ends a session at the first reply
//   that holds a block by either parse, and the scorer reads the last block of the reply that ended it.
// - The strict parse takes the last fence labelled first-move (any case) in the reply. Its body must be one JSON object
//   with "first_move" a non-empty string, "next_action" a string, "other_moves" an array of strings and "doubt" a
//   string; other keys are ignored.
// - The one lenient parse runs once when the strict parse fails. Its candidate is that same last first-move fence; when
//   the reply holds none, it is the last fence of any label whose body holds all four keys. It drops each comma before a
//   ] or } outside a string, and, on a first-move fence, reads a missing other_moves or doubt as empty. A fence labelled
//   otherwise must hold all four keys. Nothing else is tolerated: a missing next_action, or a field of the wrong type,
//   is no-block.
// - A block whose first_move is missing or empty after trimming is no-block.
// - normalizeBlock keeps the four fields and the first two other moves; strips markdown (images and links to their text,
//   code ticks, bold, italics with * or _ at word edges, strikethrough) and then leading heading marks, bullets and
//   numbering; collapses whitespace; and cuts first_move at its 40th word, next_action at its 30th and each other move
//   and the doubt at their 25th. first_move_full keeps the whole first_move, normalized but uncut, for the multi-target
//   label alone. renderBlock writes four labelled plain lines.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fencedBlocks } from "../../src/trial/review/findings.ts";
import { readTranscript } from "../../src/trial/review/readers.ts";
import { CUTS, FENCE, MAX_OTHER_MOVES } from "./frozen.ts";
import type { FirstMove, Lenient, MoveParse, NormalizedBlock } from "./types.ts";

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

/** sha256 of this file: stored with every parse and part of each session's key. */
export const PARSER_SHA256 = sha256(readFileSync(fileURLToPath(import.meta.url)));

const KEYS = ["first_move", "next_action", "other_moves", "doubt"] as const;

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

const objectOf = (text: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(text);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

function readBody(body: string, lenient: boolean, labelled: boolean): { block: FirstMove; used: Lenient[] } | string {
  const fixed = lenient ? dropTrailingCommas(body) : body;
  const o = objectOf(fixed);
  if (!o) return "the block is not one JSON object" + (lenient ? " even without trailing commas" : "");
  const used: Lenient[] = fixed !== body ? ["commas"] : [];
  if (!labelled && !KEYS.every((k) => Object.hasOwn(o, k))) return "a fence labelled otherwise must hold all four keys";
  if (typeof o.first_move !== "string") return "first_move is missing or not a string";
  if (!o.first_move.trim()) return "first_move is empty";
  if (typeof o.next_action !== "string") return "next_action is missing or not a string";
  let other_moves: string[] = [];
  let doubt = "";
  if (Object.hasOwn(o, "other_moves")) {
    if (!Array.isArray(o.other_moves) || !o.other_moves.every((m) => typeof m === "string")) return "other_moves is not an array of strings";
    other_moves = o.other_moves as string[];
  } else if (!lenient) return "other_moves is missing";
  else used.push("optional");
  if (Object.hasOwn(o, "doubt")) {
    if (typeof o.doubt !== "string") return "doubt is not a string";
    doubt = o.doubt;
  } else if (!lenient) return "doubt is missing";
  else if (!used.includes("optional")) used.push("optional");
  return { block: { first_move: o.first_move, next_action: o.next_action, other_moves, doubt }, used };
}

/** One reply's parse, from its main-agent texts in order: the strict parse, then the one lenient parse. */
export function parseFirstMove(texts: readonly string[]): MoveParse {
  let labelled: string | null = null;
  for (let t = texts.length - 1; t >= 0 && labelled === null; t--) labelled = fencedBlocks(texts[t]!).filter((b) => b.info.toLowerCase() === FENCE).at(-1)?.body ?? null;
  let strictWhy = "no fence is labelled " + FENCE;
  if (labelled !== null) {
    const strict = readBody(labelled, false, true);
    if (typeof strict !== "string") return { kind: "block", block: strict.block, lenient: null, body_sha256: sha256(labelled) };
    strictWhy = strict;
    const lenient = readBody(labelled, true, true);
    if (typeof lenient === "string") return { kind: "no-block", reason: strictWhy + "; lenient parse: " + lenient, body_sha256: sha256(labelled) };
    return { kind: "block", block: lenient.block, lenient: lenient.used, body_sha256: sha256(labelled) };
  }
  for (let t = texts.length - 1; t >= 0; t--) {
    const fences = fencedBlocks(texts[t]!);
    for (let f = fences.length - 1; f >= 0; f--) {
      const o = objectOf(dropTrailingCommas(fences[f]!.body));
      if (!o || !KEYS.every((k) => Object.hasOwn(o, k))) continue;
      const lenient = readBody(fences[f]!.body, true, false);
      if (typeof lenient === "string") return { kind: "no-block", reason: strictWhy + "; lenient parse of a fence labelled " + JSON.stringify(fences[f]!.info) + ": " + lenient, body_sha256: sha256(fences[f]!.body) };
      return { kind: "block", block: lenient.block, lenient: ["label", ...lenient.used], body_sha256: sha256(fences[f]!.body) };
    }
  }
  return { kind: "no-block", reason: strictWhy + ", and no other fence holds the four keys", body_sha256: null };
}

type Message = Record<string, any>;

const mainTexts = (m: Message): string[] =>
  m.type === "assistant" && !m.parent_tool_use_id && !m.error && !m.is_api_error_message && Array.isArray(m.message?.content)
    ? m.message.content.filter((b: { type?: unknown; text?: unknown }) => b?.type === "text" && typeof b.text === "string" && b.text.trim()).map((b: { text: string }) => b.text)
    : [];

/** A transcript.ndjson's replies: the main agent's texts between turn results, one array per reply, in order. A trailing reply with no result yet is kept. */
export function replies(transcript: string): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  let open = false;
  for (const m of readTranscript(transcript)) {
    if (m.type === "result") {
      out.push(current);
      current = [];
      open = false;
      continue;
    }
    const t = mainTexts(m);
    if (t.length) {
      current.push(...t);
      open = true;
    }
  }
  if (open) out.push(current);
  return out;
}

/** The parse of the reply that ended a session: the last reply in its transcript. */
export const sessionParse = (transcript: string): MoveParse => {
  const r = replies(transcript);
  return r.length ? parseFirstMove(r.at(-1)!) : { kind: "no-block", reason: "the transcript holds no reply", body_sha256: null };
};

const LEADING = /^(?:#{1,6}(?:\s+|$)|[-*+\u2022]\s+|\(\d{1,3}\)\s*|\d{1,3}[.):](?:\s+|$))/;

export const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;
const cutAt = (s: string, n: number): string => s.split(/\s+/).filter(Boolean).slice(0, n).join(" ");

/** One field, markdown stripped and whitespace collapsed, uncut. */
export function stripField(raw: string): string {
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
  return s;
}

const field = (raw: string, n: number): { text: string; cut: boolean } => {
  const s = stripField(raw);
  return words(s) > n ? { text: cutAt(s, n), cut: true } : { text: s, cut: false };
};

/** Section 6's normalization, the same for every arm, stock row and oracle block. */
export function normalizeBlock(b: FirstMove): NormalizedBlock {
  const first = field(b.first_move, CUTS.first_move);
  const next = field(b.next_action, CUTS.next_action);
  const others = b.other_moves.slice(0, MAX_OTHER_MOVES).map((m) => field(m, CUTS.other_move));
  const doubt = field(b.doubt, CUTS.doubt);
  return {
    block: { first_move: first.text, next_action: next.text, other_moves: others.map((o) => o.text), doubt: doubt.text },
    first_move_full: stripField(b.first_move),
    words: { first_move: words(first.text), next_action: words(next.text), other_moves: others.reduce((s, o) => s + words(o.text), 0), doubt: words(doubt.text) },
    cut: { first_move: first.cut, next_action: next.cut, other_moves: others.some((o) => o.cut), doubt: doubt.cut },
  };
}

/** A normalized block as a judge reads it: four labelled plain lines. */
export const renderBlock = (n: NormalizedBlock): string =>
  ["First move: " + n.block.first_move, "Next action: " + n.block.next_action, "Other moves weighed: " + (n.block.other_moves.filter(Boolean).join("; ") || "(none)"), "Doubt: " + (n.block.doubt || "(none)")].join("\n");
