// Copyright (c) 2026 Garry Tan. MIT License.
// Eval 1's exposure detectors (prereg 2026-11-24-geva-587-design-time-state-modeling section 6), keyless. Each reads only
// what the review session left behind: the authored and final plan.md, and the session's transcript. A Claude Code session
// is its host/transcript.ndjson (stream-json, as the eng-review detector reads it). A Codex session's rollouts are read
// into the same shape first (codexAsClaude): every exec call and patch, through src/scoring/codex-transcript.ts, as a tool
// call with its result, then every assistant message as a text block. Exposure decides nothing by itself; the pilot needs
// 5 of 6 sessions exposed per arm and model, and a counted arm and model under 0.80 reads untested.
//
// - D: the final plan.md holds a new block of 3 or more consecutive lines that each carry an arrow or box character
//   (->, -->, =>, a Unicode arrow U+2190 to U+21FF, or box drawing U+2500 to U+257F), with at least two distinct labels
//   joined by an arrow, and the authored plan lacks that block. A diagram only in the reply does not count.
// - C: a shell call whose command matches #358's frozen checker list (lanes/outcome-skills/pfchecks/exposure.ts CHECKER)
//   returned TLC's model-checking result: a states-generated line, a completed check, or a violated invariant, property
//   or deadlock with its behavior trace. A run that ended on a parse, config or setup error has none of these.
// - P: statechart's SKILL.md body reached the session (its pinned marker line appears in the transcript or in Claude Code's
//   own session file, where the expanded command lands, or a successful read of statechart/SKILL.md by any tool), and C's
//   check holds. The SDK stream never carries the expanded command, so the session file is read too, as #358 read it.
// - G: attempt 3's precut procedure detector (lanes/eng-review/exposure.ts erExposure "precut"): Scope Challenge, Sections
//   1 to 4 in order, the coverage diagram and the test-plan file under the session's gstack state root.
import { readFileSync } from "node:fs";
import { erExposure, ownUses, type ErEvidence } from "../../eng-review/exposure.ts";
import { runsChecker } from "../../outcome-skills/pfchecks/exposure.ts";
import { codexTranscript } from "../../../src/scoring/codex-transcript.ts";
import type { E1Arm } from "./frozen.ts";

const ARROW = /-->|->|=>|[\u2190-\u21FF]/;
const MARK = /-->|->|=>|[\u2190-\u21FF\u2500-\u257F]/;
const LABEL_PAIR = /([A-Za-z_][\w]*)[^A-Za-z_\n]*?(?:-->|->|=>|[\u2190-\u21FF])[^A-Za-z_\n]*?([A-Za-z_][\w]*)/g;
const norm = (l: string) => l.replace(/\s+/g, " ").trim();

/** The maximal runs of consecutive lines that each carry an arrow or box character. */
export function markedBlocks(text: string): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  for (const line of text.split("\n")) {
    if (MARK.test(line)) cur.push(line);
    else {
      if (cur.length) out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

const labelsJoined = (block: string[]): boolean =>
  block.some((l) => [...l.matchAll(LABEL_PAIR)].some((m) => m[1] !== m[2]) || (ARROW.test(l) && new Set(l.match(/[A-Za-z_][\w]*/g) ?? []).size >= 2));

export function dExposure(authored: string, final: string | null): { exposed: boolean; detail: string } {
  if (final === null) return { exposed: false, detail: "no final plan.md" };
  const old = new Set(markedBlocks(authored).map((b) => b.map(norm).join("\n")));
  const blocks = markedBlocks(final).filter((b) => b.length >= 3 && !old.has(b.map(norm).join("\n")) && labelsJoined(b));
  return { exposed: blocks.length > 0, detail: blocks.length ? blocks.length + " new diagram block(s) of " + blocks.map((b) => b.length).join(", ") + " lines" : "no new block of 3 or more arrow or box lines with two labels joined" };
}

/** TLC's model-checking results; a parse, config or setup error prints none of these. */
export const TLC_RESULT: readonly RegExp[] = [
  /\b\d[\d,]* states generated, \d[\d,]* distinct states found/,
  /Model checking completed\. No error has been found/,
  /Error: Invariant \S+ is violated/,
  /Error: (?:Temporal properties were violated|Action property \S+ is violated)/,
  /Error: Deadlock reached/,
];
export const tlcResult = (output: string): boolean => TLC_RESULT.some((r) => r.test(output));

export function cExposure(transcript: string): { exposed: boolean; runs: number; results: number } {
  const runs = ownUses(transcript).filter((u) => u.name === "Bash" && runsChecker(String(u.input.command ?? "")));
  const results = runs.filter((u) => tlcResult(u.result)).length;
  return { exposed: results > 0, runs: runs.length, results };
}

const STATECHART = /(^|\/)statechart\/SKILL\.md$/;
export function pExposure(transcript: string, marker: string, claudeSession: string = ""): { exposed: boolean; body: boolean; read: boolean; checked: boolean } {
  if (!marker.trim()) throw new Error("E_USAGE: P's detector needs the pinned statechart SKILL.md marker line");
  const read = ownUses(transcript).some((u) => u.ok && (STATECHART.test(String(u.input.file_path ?? u.input.path ?? "")) || (u.name === "Bash" && /statechart\/SKILL\.md/.test(String(u.input.command ?? "")) && u.result.includes(marker))));
  const body = [transcript, claudeSession].some((t) => t.includes(JSON.stringify(marker).slice(1, -1)));
  const checked = cExposure(transcript).exposed;
  return { exposed: (body || read) && checked, body, read, checked };
}

export function gExposure(ev: ErEvidence): { exposed: boolean; missing: string[] } {
  const r = erExposure("precut", ev);
  return { exposed: r.exposed, missing: r.missing };
}

export interface ExposureInput {
  arm: E1Arm;
  authored: string;
  final: string | null;
  transcript: string;
  /** Claude Code's own session file, read only for P's body. */
  claudeSession?: string;
  stateRoot: string | null;
  statechartMarker?: string;
}

/** One session's exposure for its arm; N has nothing to expose and reads null. */
export function exposure(i: ExposureInput): boolean | null {
  if (i.arm === "N") return null;
  if (i.arm === "D") return dExposure(i.authored, i.final).exposed;
  if (i.arm === "C") return cExposure(i.transcript).exposed;
  if (i.arm === "P") return pExposure(i.transcript, i.statechartMarker ?? "", i.claudeSession).exposed;
  return gExposure({ transcript: i.transcript, stateRoot: i.stateRoot, coverage: null, opening: null }).exposed;
}

type J = Record<string, any>;
/** A Codex session's rollouts as Claude Code stream-json lines: tool calls with their results first, in call order,
 * then the assistant's messages in order. */
export function codexAsClaude(rollouts: readonly string[]): string {
  const texts = rollouts.map((f) => readFileSync(f, "utf8"));
  const t = codexTranscript(texts);
  const lines: J[] = [];
  for (const r of t.recs as J[]) {
    if (r.type === "AssistantMessage" && Array.isArray(r.content)) lines.push({ type: "assistant", message: { content: r.content.map((b: J) => ({ type: "tool_use", id: b.id, name: b.name, input: b.input ?? {} })) } });
    if (r.type === "UserMessage" && Array.isArray(r.content)) lines.push({ type: "user", message: { content: r.content.map((b: J) => ({ type: "tool_result", tool_use_id: b.tool_use_id, content: b.content ?? "", ...(b.is_error ? { is_error: true } : {}) })) } });
  }
  for (const text of texts)
    for (const raw of text.split("\n")) {
      if (!raw.trim()) continue;
      let o: J;
      try {
        o = JSON.parse(raw);
      } catch {
        continue;
      }
      const p = o?.payload;
      if (o?.type !== "response_item" || p?.type !== "message" || p.role !== "assistant" || !Array.isArray(p.content)) continue;
      const text = p.content.filter((c: J) => c?.type === "output_text" && typeof c.text === "string").map((c: J) => c.text).join("\n");
      if (text) lines.push({ type: "assistant", message: { content: [{ type: "text", text }] } });
    }
  return lines.map((l) => JSON.stringify(l)).join("\n") + (lines.length ? "\n" : "");
}
