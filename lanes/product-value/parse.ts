// Copyright (c) 2026 Garry Tan. MIT License.
// The product-value eval's closing block (prereg 2026-11-08-geva-403, sections 5 and 6): its binding of the shared
// plan-changes reader (lanes/aftermath/parse.ts) to five changes with the label, commas and array tolerances, and its
// own session outcome. The rules the shared reader keeps are in its header; the ones this file adds:
//
// - normalizeChanges keeps the first five strings; renderList writes "1." to "5." plain lines. normalize is exported for
//   the stock rows and oracle lists, so every list goes through the same code.
// - pvOutcome reads one attempt: contaminated when webUses finds anything; cap when the ledger item's cap stopped it;
//   block when either parse reads a block, whatever the termination; no-block for a completed session or a turn cap;
//   otherwise an infrastructure failure under one named reason. A timeout or a background deadline is a harness
//   timeout, an allowance stop is an allowance stop, the arm's CLI failing or an unreadable transcript is a crash, and
//   every other ending (a provider error, an infra incident, rejected credentials, an unknown send) is an API error, or a
//   context overflow when an API error text in the transcript says the prompt or context was too long. The run gives an
//   infrastructure failure one retry; a second failure is missing (E_PV_INFRA_MISSING).
import { readFileSync } from "node:fs";
import type { Termination } from "../../src/types.ts";
import * as core from "../aftermath/parse.ts";
import type { EndState, Row } from "./types.ts";

/** sha256 of this file and the shared reader: part of a product-value session key's verifier, and stored with every journaled parse. */
export const PV_PARSER_SHA256 = core.parserSha256(import.meta.url);

export const PV_FENCE = core.FENCE;
export const MAX_CHANGES = 5;
export const MAX_WORDS = core.MAX_WORDS;
const OPTIONS: core.ParserOptions = { max: MAX_CHANGES, singleKey: false };

/** Which tolerance the lenient parse needed: a fence labelled otherwise, trailing commas, a bare array. */
export type Lenient = "label" | "commas" | "array";

export type PvParse =
  | { kind: "changes"; changes: string[]; lenient: Lenient[] | null; body_sha256: string }
  | { kind: "no-block"; reason: string; body_sha256: string | null }
  /** The session's transcript.ndjson could not be read. */
  | { kind: "unreadable"; reason: string };

export const dropTrailingCommas = core.dropTrailingCommas;

/** The parse of a reply's main-agent texts, in order: the strict parse, then the one lenient parse. */
export const parsePv = (texts: readonly string[]): Extract<PvParse, { kind: "changes" | "no-block" }> => core.parseChanges(texts, OPTIONS) as Extract<PvParse, { kind: "changes" | "no-block" }>;

/** A session's one parse, from its transcript.ndjson text. */
export const pvTranscriptParse = (transcript: string): Extract<PvParse, { kind: "changes" | "no-block" }> => core.transcriptParse(transcript, OPTIONS) as Extract<PvParse, { kind: "changes" | "no-block" }>;

export const normalizeItem = core.normalizeItem;

/** The normalized list: the first five strings, each normalized; its word count after the cut, item count and cut count. */
export const normalizeChanges = (changes: readonly unknown[]) => core.normalizeChanges(changes, MAX_CHANGES);

/** The scoring side's entry point (io.ts loadNormalize): stock rows, oracle lists and arm lists normalize the same way. */
export const normalize = (strings: string[]): string[] => normalizeChanges(strings).list;

/** The list as judges read it: "1." to "5." plain lines. */
export const renderList = core.renderList;

/** Per cell: mean words and items per block, the share of items the 40-word cut shortened, and the end-state counts. */
export function cellStats(rows: readonly Pick<Row, "end" | "words" | "items" | "cut">[]) {
  const s = core.cellStats<EndState>(rows, ["block", "no-block", "missing", "contaminated"], "block");
  return { planned: s.planned, blocks: s.counts.block, no_block: s.counts["no-block"], missing: s.counts.missing, contaminated: s.counts.contaminated, mean_words: s.mean_words, mean_items: s.mean_items, cut_share: s.cut_share };
}

export type WebUse = core.WebUse;
export const webUses = core.webUses;

export const INFRA_REASONS = ["API error", "crash", "harness timeout", "allowance stop", "context overflow"] as const;
export type InfraReason = (typeof INFRA_REASONS)[number];

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
  return { outcome: { state: "infra", reason: core.overflowed(transcript) ? "context overflow" : "API error", detail: ended }, parse };
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
