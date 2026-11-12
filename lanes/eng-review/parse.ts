// Copyright (c) 2026 Garry Tan. MIT License.
// The plan-eng-review intentions eval's closing block (prereg 2026-11-08-geva-405, section 6): the eng-plan parser, its
// one frozen lenient parse, the normalizer every list goes through before a judge reads it, the per-cell length counts
// and each session's end state. The rules, with the build-time choices this file makes:
//
// - The parser reads the main agent's own text blocks (capped.ts's mainAgentTexts: no subagent text, API error or
//   AskUserQuestion), latest first. The strict parse takes the last fence labelled eng-plan in the latest text that holds
//   one, wherever it sits, so a skill's own closing line after it doesn't make the reply no-block. Its body must be one
//   JSON object whose "paths" and "checks" are both arrays of strings; other keys are ignored.
// - The one lenient parse runs once when the strict parse finds no block or cannot read it. Its candidate is that same
//   last eng-plan fence, or, when no text holds one, the last fence of any label in the latest text that holds a fence
//   ("label"). It drops each comma that comes before a ] or } outside a string ("commas") and takes a JSON object with
//   both keys or with only one of them, the other read as empty ("one-key"). When the candidate still doesn't read, it
//   looks in the latest text that holds a fence for two bare arrays under paths and checks headings ("headings"): the
//   last fence whose body is a JSON array of strings under a heading or label line naming paths, and the same for checks.
//   A heading line is a markdown heading or a line ending in a colon. Anything else is no-block.
// - normalizeEngPlan keeps the first 15 paths and the first 8 checks; strips markdown (images and links to their text,
//   code ticks, bold, italics with * or _ at word edges, strikethrough) and then leading heading marks, bullets and
//   numbering ("1.", "1)", "(1)", "1:"); collapses whitespace; and cuts each path at its 25th word and each check at its
//   40th. A string that normalizes to nothing stays an empty item. renderLines writes numbered plain lines. Stock rows,
//   oracle lists and arm lists all go through it.
// - erOutcome reads one attempt: contaminated when webUses finds a successful web result; cap when the ledger item's cap
//   stopped it; block when either parse reads a block, whatever the termination; no-block for a completed session.
//   Otherwise the attempt stopped: an arm stop (section 6, gate answer C1) for a turn cap, a harness timeout (a timeout or
//   a background deadline), an allowance stop or a context overflow (an API error text that says the prompt or context
//   was too long); an infrastructure failure for any other ending (a provider or API error, the CLI or container
//   crashing, an unreadable transcript). Both get one retry under their named reason. The session's end state reads from
//   its last attempt: an arm stop is no-block with arm_stop set (E_ER_ARM_STOP, scored 0), an infrastructure failure is
//   missing (E_ER_INFRA_MISSING, never 0).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mainAgentTexts } from "../../src/trial/review/capped.ts";
import { fencedBlocks } from "../../src/trial/review/findings.ts";
import { readTranscript } from "../../src/trial/review/readers.ts";
import type { Termination } from "../../src/types.ts";
import { dropTrailingCommas, webUses, type WebUse } from "../product-value/parse.ts";
import type { EndState, Row } from "./types.ts";

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

/** sha256 of this file: part of an eng-review session key's verifier, and stored with every journaled parse. */
export const ER_PARSER_SHA256 = sha256(readFileSync(fileURLToPath(import.meta.url)));

export const ER_FENCE = "eng-plan";
export const MAX_PATHS = 15;
export const MAX_CHECKS = 8;
export const PATH_WORDS = 25;
export const CHECK_WORDS = 40;

/** Which tolerance the lenient parse needed. */
export type Lenient = "label" | "commas" | "one-key" | "headings";

export type ErParse =
  | { kind: "block"; paths: string[]; checks: string[]; lenient: Lenient[] | null; body_sha256: string }
  | { kind: "no-block"; reason: string; body_sha256: string | null }
  /** The session's transcript.ndjson could not be read. */
  | { kind: "unreadable"; reason: string };

const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null);

function readBody(body: string, lenient: boolean): { paths: string[]; checks: string[]; used: Lenient[] } | string {
  const fixed = lenient ? dropTrailingCommas(body) : body;
  let value: unknown;
  try {
    value = JSON.parse(fixed);
  } catch {
    return "the block is not valid JSON" + (lenient ? " even without trailing commas" : "");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "the block is not one JSON object";
  const used: Lenient[] = fixed !== body ? ["commas"] : [];
  const o = value as Record<string, unknown>;
  const has = (k: string) => Object.hasOwn(o, k);
  const paths = has("paths") ? strings(o.paths) : null;
  const checks = has("checks") ? strings(o.checks) : null;
  if ((has("paths") && !paths) || (has("checks") && !checks)) return 'the block\'s "paths" or "checks" is not an array of strings';
  if (paths && checks) return { paths, checks, used };
  if (!lenient) return 'the block lacks "' + (paths ? "checks" : checks ? "paths" : "paths\" and \"checks") + '"';
  if (!paths && !checks) return 'the block has neither "paths" nor "checks"';
  return { paths: paths ?? [], checks: checks ?? [], used: [...used, "one-key"] };
}

const HEADING = /^\s*(?:#{1,6}\s+.*|.*:\s*)$/;

/** Two bare arrays under paths and checks headings: the last fence of each under a heading line naming it. */
export function headingArrays(text: string): { paths: string[]; checks: string[] } | null {
  const lines = text.split("\n");
  const found: { paths: string[] | null; checks: string[] | null } = { paths: null, checks: null };
  let heading = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const open = /^\s*(`{3,}|~{3,})/.exec(line);
    if (open) {
      const close = new RegExp("^\\s*" + open[1]![0] + "{" + open[1]!.length + ",}\\s*$");
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j]!)) j++;
      const body = lines.slice(i + 1, j).join("\n");
      i = j;
      let arr: string[] | null = null;
      try {
        arr = strings(JSON.parse(dropTrailingCommas(body)));
      } catch {
        arr = null;
      }
      if (arr) {
        const h = heading.toLowerCase();
        if (/\bpaths?\b/.test(h) && !/\bchecks?\b/.test(h)) found.paths = arr;
        else if (/\bchecks?\b/.test(h) && !/\bpaths?\b/.test(h)) found.checks = arr;
      }
      continue;
    }
    if (line.trim() && HEADING.test(line)) heading = line;
  }
  return found.paths && found.checks ? { paths: found.paths, checks: found.checks } : null;
}

/** The parse of a reply's main-agent texts, in order: the strict parse, then the one lenient parse. */
export function parseEngPlan(texts: readonly string[]): Extract<ErParse, { kind: "block" | "no-block" }> {
  let labelled: string | null = null;
  for (let t = texts.length - 1; t >= 0 && labelled === null; t--) labelled = fencedBlocks(texts[t]!).filter((b) => b.info.toLowerCase() === ER_FENCE).at(-1)?.body ?? null;
  let strictWhy = "no fence is labelled " + ER_FENCE;
  if (labelled !== null) {
    const strict = readBody(labelled, false);
    if (typeof strict !== "string") return { kind: "block", paths: strict.paths, checks: strict.checks, lenient: null, body_sha256: sha256(labelled) };
    strictWhy = strict;
  }
  let candidate = labelled;
  let label = false;
  let fencedText: string | null = null;
  for (let t = texts.length - 1; t >= 0 && fencedText === null; t--) if (fencedBlocks(texts[t]!).length) fencedText = texts[t]!;
  if (candidate === null && fencedText !== null) {
    candidate = fencedBlocks(fencedText).at(-1)?.body ?? null;
    label = candidate !== null;
  }
  if (candidate === null) return { kind: "no-block", reason: strictWhy + ", and no other fence holds a candidate", body_sha256: null };
  const lenient = readBody(candidate, true);
  if (typeof lenient !== "string") return { kind: "block", paths: lenient.paths, checks: lenient.checks, lenient: [...(label ? (["label"] as Lenient[]) : []), ...lenient.used], body_sha256: sha256(candidate) };
  const pair = fencedText === null ? null : headingArrays(fencedText);
  if (pair) return { kind: "block", paths: pair.paths, checks: pair.checks, lenient: ["headings"], body_sha256: sha256(fencedText!) };
  return { kind: "no-block", reason: strictWhy + "; lenient parse: " + lenient + ", and no paths and checks arrays sit under headings", body_sha256: sha256(candidate) };
}

/** A session's one parse, from its transcript.ndjson text. */
export const erTranscriptParse = (transcript: string): Extract<ErParse, { kind: "block" | "no-block" }> => parseEngPlan(mainAgentTexts(transcript));

const LEADING = /^(?:#{1,6}(?:\s+|$)|[-*+\u2022]\s+|\(\d{1,3}\)\s*|\d{1,3}[.):](?:\s+|$))/;
export const words = (s: string): number => (s.match(/\S+/g) ?? []).length;
const cutAt = (s: string, n: number): string => (s.match(/\S+/g) ?? []).slice(0, n).join(" ");

/** One item, normalized: markdown stripped, whitespace collapsed, cut at its limit. cut says the cut shortened it. */
export function normalizeItem(raw: string, limit: number): { text: string; cut: boolean } {
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
  return { text: n > limit ? cutAt(s, limit) : s, cut: n > limit };
}

export interface Normalized {
  paths: string[];
  checks: string[];
  /** Words across both lists after the cuts, and in the checks alone. */
  words: number;
  check_words: number;
  items: number;
  /** Items the 25- and 40-word cuts shortened. */
  cut: number;
}

/** The normalized block: the first 15 paths and 8 checks, each normalized, and its counts. */
export function normalizeEngPlan(paths: readonly unknown[], checks: readonly unknown[]): Normalized {
  const p = paths.filter((c): c is string => typeof c === "string").slice(0, MAX_PATHS).map((s) => normalizeItem(s, PATH_WORDS));
  const c = checks.filter((x): x is string => typeof x === "string").slice(0, MAX_CHECKS).map((s) => normalizeItem(s, CHECK_WORDS));
  const all = [...p, ...c];
  return {
    paths: p.map((i) => i.text),
    checks: c.map((i) => i.text),
    words: all.reduce((s, i) => s + words(i.text), 0),
    check_words: c.reduce((s, i) => s + words(i.text), 0),
    items: all.length,
    cut: all.filter((i) => i.cut).length,
  };
}

/** The scoring side's entry point for a checks list alone (stock rows, oracle lists, arm checks). */
export const normalizeChecks = (checks: string[]): string[] => normalizeEngPlan([], checks).checks;
export const normalizePaths = (paths: string[]): string[] => normalizeEngPlan(paths, []).paths;

/** A list as judges read it: "1." onward, plain lines. */
export const renderLines = (list: readonly string[]): string => list.map((t, i) => i + 1 + ". " + t).join("\n");

/** Per cell: mean words and items per block, the share of items the cuts shortened, and the end-state counts. */
export function cellStats(rows: readonly Pick<Row, "end" | "words" | "items" | "cut" | "arm_stop">[]) {
  const blocks = rows.filter((r) => r.end === "block");
  const items = blocks.reduce((s, r) => s + r.items, 0);
  const count = (e: EndState) => rows.filter((r) => r.end === e).length;
  return {
    planned: rows.length, blocks: blocks.length, no_block: count("no-block"), arm_stops: rows.filter((r) => r.arm_stop).length, missing: count("missing"), contaminated: count("contaminated"),
    mean_words: blocks.length ? blocks.reduce((s, r) => s + r.words, 0) / blocks.length : null,
    mean_items: blocks.length ? items / blocks.length : null,
    cut_share: items ? blocks.reduce((s, r) => s + r.cut, 0) / items : null,
  };
}

export const ARM_STOP_REASONS = ["context overflow", "harness timeout", "turn limit", "allowance stop"] as const;
export const INFRA_REASONS = ["API error", "crash"] as const;
export type ArmStopReason = (typeof ARM_STOP_REASONS)[number];
export type InfraReason = (typeof INFRA_REASONS)[number];
const OVERFLOW = /prompt is too long|context (?:length|window)|maximum context|input is too long|too many (?:input )?tokens/i;
const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === "string" ? b.text : JSON.stringify(b))).join("\n") : c == null ? "" : JSON.stringify(c));

/** Whether an API error text in the transcript says the prompt or context was too long. */
export function overflowed(transcript: string): boolean {
  return readTranscript(transcript).some((m) => {
    if (m.type === "result" && m.is_error) return OVERFLOW.test(String(m.result ?? "") + " " + JSON.stringify(m.errors ?? ""));
    if (m.type !== "assistant" || !(m.error || m.is_api_error_message || m.message?.model === "<synthetic>")) return false;
    return OVERFLOW.test(textOf(m.message?.content));
  });
}

export type ErOutcome =
  | { state: "block" | "no-block" | "cap" }
  | { state: "contaminated"; web: WebUse[] }
  | { state: "arm-stop"; reason: ArmStopReason; detail: string }
  | { state: "infra"; reason: InfraReason; detail: string };

/** One attempt's outcome and its parse; transcript is null when host/transcript.ndjson could not be read. */
export function erOutcome(termination: Termination, transcript: string | null): { outcome: ErOutcome; parse: ErParse } {
  const unreadable: ErParse = { kind: "unreadable", reason: "host/transcript.ndjson is unreadable" };
  if (termination.kind === "cap_stop") return { outcome: { state: "cap" }, parse: transcript === null ? unreadable : erTranscriptParse(transcript) };
  if (transcript === null) return { outcome: { state: "infra", reason: "crash", detail: "host/transcript.ndjson is unreadable" }, parse: unreadable };
  const parse = erTranscriptParse(transcript);
  const web = webUses(transcript);
  if (web.length) return { outcome: { state: "contaminated", web }, parse };
  if (parse.kind === "block") return { outcome: { state: "block" }, parse };
  const k = termination.kind;
  if (k === "completed") return { outcome: { state: "no-block" }, parse };
  const ended = k + ("code" in termination && termination.code ? " (" + termination.code + ")" : "incident" in termination ? " (" + termination.incident + ")" : "");
  if (k === "turn_cap") return { outcome: { state: "arm-stop", reason: "turn limit", detail: ended }, parse };
  if (k === "timeout" || (k === "missing" && termination.code === "E_BACKGROUND_DEADLINE")) return { outcome: { state: "arm-stop", reason: "harness timeout", detail: ended }, parse };
  if (k === "allowance_stop") return { outcome: { state: "arm-stop", reason: "allowance stop", detail: ended }, parse };
  if (k === "arm_failure") return { outcome: { state: "infra", reason: "crash", detail: ended }, parse };
  if (overflowed(transcript)) return { outcome: { state: "arm-stop", reason: "context overflow", detail: ended }, parse };
  return { outcome: { state: "infra", reason: "API error", detail: ended }, parse };
}

/** Whether an attempt gets the one retry: an arm stop or an infrastructure failure on the first attempt. */
export const retries = (o: ErOutcome, attempt: number): boolean => attempt === 1 && (o.state === "arm-stop" || o.state === "infra");

/** The session's end state from its last attempt; a cap stop has none. */
export function endStateOf(last: ErOutcome): { end: EndState; arm_stop: boolean } | null {
  if (last.state === "block" || last.state === "no-block" || last.state === "contaminated") return { end: last.state, arm_stop: false };
  if (last.state === "arm-stop") return { end: "no-block", arm_stop: true };
  if (last.state === "infra") return { end: "missing", arm_stop: false };
  return null;
}

const HELP = "gstack-evals er parse <reply.txt | transcript.ndjson>\n  Prints the strict or lenient parse of the reply's last eng-plan block, the normalized lists and their counts.";

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
    io.err("E_USAGE er parse: cannot read " + file + ": " + (e as Error).message + "\nE_USAGE fix: pass a reply text file or a session's host/transcript.ndjson");
    return 2;
  }
  const parse = file.endsWith(".ndjson") ? erTranscriptParse(text) : parseEngPlan([text]);
  const normalized = parse.kind === "block" ? normalizeEngPlan(parse.paths, parse.checks) : null;
  io.out(JSON.stringify({ parser_sha256: ER_PARSER_SHA256, parse, normalized, rendered: normalized ? { paths: renderLines(normalized.paths), checks: renderLines(normalized.checks) } : null }, null, 2));
  return 0;
}
