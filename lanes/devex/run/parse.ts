// Copyright (c) 2026 Garry Tan. MIT License.
// The devex eval's closing block and attempt outcome (prereg 2026-11-09-geva-417, section 6). It binds the shared
// plan-changes reader (lanes/aftermath/parse.ts) to section 6's size and its one frozen lenient parse: at most 8 changes
// of at most 40 words; the strict parse reads the last plan-changes block; the lenient parse covers exactly a fence
// labelled otherwise, trailing commas, a bare JSON array of strings and an object with the array under another single
// key. The normalizer keeps the first 8 strings, strips markdown and leading numbering, collapses whitespace, cuts at
// the 40th word and renders numbered plain lines. cellStats gives per cell the mean words and items per block and the
// share of items the cut shortened.
//
// dxAttempt reads one attempt into the failure table's rows, in this order (a choice this file makes where the table
// is silent: contamination outranks a block, and a block outranks the way the session ended):
// - a successful web tool result: contaminated, E_DX_WEB_CONTAMINATED, no retry;
// - a cap stop on the ledger item: an incomplete run, missing, no retry;
// - a block from either parse: block, whatever the termination;
// - gstack's install verdict failing (an own Bash result with an INSTALL: fail line): infra, install, E_DX_INFRA_MISSING;
// - the rec persona failing to answer a question (E_USER_TURNS_MISSING): infra, persona, E_DX_INFRA_MISSING;
// - a stop the arm causes itself (the turn, minute or dollar limit, a harness timeout, a context overflow): arm stop,
//   E_DX_ARM_STOP, one retry;
// - a completed reply with no block: no-block, E_DX_NO_BLOCK, no retry;
// - anything else (a provider or API error, a CLI crash, an unreadable transcript, a lost machine): infra, E_DX_INFRA_MISSING.
import type { Termination } from "../../../src/types.ts";
import * as core from "../../aftermath/parse.ts";
import { ownUses } from "../../aftermath/exposure.ts";

export const DX_PARSER_SHA256 = core.parserSha256(import.meta.url);
export const DX_MAX_CHANGES = 8;
export const DX_MAX_WORDS = core.MAX_WORDS;
export const DX_PARSER: core.ParserOptions = { max: DX_MAX_CHANGES, singleKey: true };

export type DxParse = core.ChangesParse | { kind: "unreadable"; reason: string };
export const parseDx = (texts: readonly string[]): core.ChangesParse => core.parseChanges(texts, DX_PARSER);
export const dxTranscriptParse = (transcript: string): core.ChangesParse => core.transcriptParse(transcript, DX_PARSER);
export const normalizeDx = (changes: readonly unknown[]) => core.normalizeChanges(changes, DX_MAX_CHANGES);
export const normalize = (strings: string[]): string[] => normalizeDx(strings).list;
export const renderList = core.renderList;
export const cellStats = core.cellStats;
export const webUses = core.webUses;

export type ArmStopReason = "turn limit" | "minute limit" | "dollar limit" | "harness timeout" | "context overflow";
export type InfraReason = "install" | "persona" | "API error" | "crash" | "lost machine";

export type DxAttempt =
  | { state: "block" }
  | { state: "no-block" }
  | { state: "cap" }
  | { state: "contaminated"; code: "E_DX_WEB_CONTAMINATED"; detail: string }
  | { state: "arm-stop"; code: "E_DX_ARM_STOP"; reason: ArmStopReason; detail: string }
  | { state: "infra"; code: "E_DX_INFRA_MISSING"; reason: InfraReason; detail: string };

const INSTALL_FAIL = /^INSTALL: fail\b/m;
/** Whether an own successful-or-failed Bash result shows gstack's install verdict failing. */
export const installFailed = (transcript: string): boolean => ownUses(transcript).some((u) => u.name === "Bash" && INSTALL_FAIL.test(u.result) && !(typeof u.input.command === "string" && INSTALL_FAIL.test(u.input.command)));

const describe = (t: Termination): string => t.kind + ("code" in t && t.code ? " (" + t.code + ")" : "incident" in t && t.incident ? " (" + t.incident + ")" : "");

/** One attempt's outcome and its parse; transcript is null when host/transcript.ndjson could not be read. */
export function dxAttempt(termination: Termination, transcript: string | null): { outcome: DxAttempt; parse: DxParse } {
  if (transcript === null) return { outcome: termination.kind === "cap_stop" ? { state: "cap" } : { state: "infra", code: "E_DX_INFRA_MISSING", reason: "crash", detail: "host/transcript.ndjson is unreadable" }, parse: { kind: "unreadable", reason: "host/transcript.ndjson is unreadable" } };
  const parse = dxTranscriptParse(transcript);
  const web = webUses(transcript);
  if (web.length) return { outcome: { state: "contaminated", code: "E_DX_WEB_CONTAMINATED", detail: web.length + " successful web result" + (web.length === 1 ? "" : "s") + " (" + web.map((w) => w.tool).join(", ") + ")" }, parse };
  if (termination.kind === "cap_stop") return { outcome: { state: "cap" }, parse };
  if (parse.kind === "changes") return { outcome: { state: "block" }, parse };
  const k = termination.kind;
  const detail = describe(termination);
  if (installFailed(transcript)) return { outcome: { state: "infra", code: "E_DX_INFRA_MISSING", reason: "install", detail: "gstack's install verdict failed (INSTALL: fail)" }, parse };
  if (k === "missing" && termination.code === "E_USER_TURNS_MISSING") return { outcome: { state: "infra", code: "E_DX_INFRA_MISSING", reason: "persona", detail }, parse };
  if (core.overflowed(transcript)) return { outcome: { state: "arm-stop", code: "E_DX_ARM_STOP", reason: "context overflow", detail }, parse };
  if (k === "turn_cap") return { outcome: { state: "arm-stop", code: "E_DX_ARM_STOP", reason: "turn limit", detail }, parse };
  if (k === "allowance_stop") return { outcome: { state: "arm-stop", code: "E_DX_ARM_STOP", reason: "dollar limit", detail }, parse };
  if (k === "timeout") return { outcome: { state: "arm-stop", code: "E_DX_ARM_STOP", reason: "minute limit", detail }, parse };
  if (k === "missing" && termination.code === "E_BACKGROUND_DEADLINE") return { outcome: { state: "arm-stop", code: "E_DX_ARM_STOP", reason: "harness timeout", detail }, parse };
  if (k === "completed") return { outcome: { state: "no-block" }, parse };
  if (k === "arm_failure") return { outcome: { state: "infra", code: "E_DX_INFRA_MISSING", reason: "crash", detail }, parse };
  return { outcome: { state: "infra", code: "E_DX_INFRA_MISSING", reason: "API error", detail }, parse };
}
