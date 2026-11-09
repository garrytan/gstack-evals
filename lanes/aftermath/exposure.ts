// Copyright (c) 2026 Garry Tan. MIT License.
// Transcript readers the aftermath-keyed plan-review evals' exposure detectors share (product-value, prereg
// 2026-11-08-geva-403, section 5; devex, prereg 2026-11-09-geva-417, section 5): the main agent's own tool calls with
// their results, its own words, and whether it read a skill file. A call whose result is an error, carries a
// tool_use_error tag or is absent did not happen. Subagent records, injected skill bodies and tool results never count
// as the main agent's own words. lanes/product-value/exposure.ts and lanes/devex/run/exposure.ts bind them.
import { mainAgentTexts } from "../../src/trial/review/capped.ts";
import { readTranscript } from "../../src/trial/review/readers.ts";

type Rec = Record<string, any>;
export type Use = { name: string; input: Rec; ok: boolean; result: string; id: string };
export const text = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === "string" ? b.text : JSON.stringify(b))).join("\n") : c == null ? "" : JSON.stringify(c));
export const own = (transcript: string) => readTranscript(transcript).filter((m) => !m.parent_tool_use_id && Array.isArray(m.message?.content));

/** The main agent's own tool calls with their results, in order. */
export function ownUses(transcript: string): Use[] {
  const messages = own(transcript);
  const results = new Map<string, Rec>();
  for (const m of messages) if (m.type === "user") for (const b of m.message.content) if (b?.type === "tool_result") results.set(b.tool_use_id, b);
  return messages
    .filter((m) => m.type === "assistant" && !m.error && !m.is_api_error_message)
    .flatMap((m) => m.message.content.filter((b: Rec) => b?.type === "tool_use"))
    .map((b: Rec) => {
      const res = results.get(b.id);
      const result = res ? text(res.content) : "";
      return { name: b.name, input: b.input ?? {}, ok: !!res && res.is_error !== true && !result.includes("<tool_use_error>"), result, id: String(b.id) };
    });
}

/** The text a successful Write, Edit or MultiEdit call wrote. */
export const written = (u: Use): string[] => {
  if (u.name === "Write" && typeof u.input.content === "string") return [u.input.content];
  if (u.name === "Edit" && typeof u.input.new_string === "string") return [u.input.new_string];
  if (u.name === "MultiEdit" && Array.isArray(u.input.edits)) return u.input.edits.flatMap((e: Rec) => (typeof e?.new_string === "string" ? [e.new_string] : []));
  return [];
};

/** The main agent's own words, in order: its text blocks and the text its successful Write, Edit and MultiEdit calls wrote. */
export function ownWords(transcript: string): string[] {
  return [...mainAgentTexts(transcript), ...ownUses(transcript).filter((u) => u.ok).flatMap(written)];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** Whether the main agent read a skill file (rel, such as plan-ceo-review/sections/review-sections.md) by a successful Read or a simple cat, head, sed -n or nl Bash read with a non-empty result. */
export function skillFileRead(transcript: string, rel: string): boolean {
  const path = new RegExp("(?:^|\\/)" + escape(rel) + "$");
  const bash = new RegExp("^\\s*(?:cat|head|nl|sed\\s+-n\\s+([\"']?)[\\d,$]*p\\1)\\s[^<>|;&]*" + escape(rel) + "\\s*$");
  return ownUses(transcript).some((u) => u.ok && u.result.trim() !== "" && ((u.name === "Read" && typeof u.input.file_path === "string" && path.test(u.input.file_path)) || (u.name === "Bash" && typeof u.input.command === "string" && bash.test(u.input.command))));
}
