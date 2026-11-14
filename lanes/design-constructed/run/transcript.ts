// Copyright (c) 2026 Garry Tan. MIT License.
// Transcript readers for the run area: the main agent's own tool calls with their results, its own words, whether it
// read a skill file, its reply, and the two contamination reads of plan section 6 (a successful web result, a gstack
// file read). A call whose result is an error, carries a tool_use_error tag or is absent did not happen. Subagent
// records, injected skill bodies and tool results never count as the main agent's own words.
// Adapted from lanes/aftermath/exposure.ts at 5ee7f764232b196a1d0cec5b144a287b792f9c94 (build-devex-review-eval).
import { mainAgentTexts } from "../../../src/trial/review/capped.ts";
import { readTranscript } from "../../../src/trial/review/readers.ts";

type Rec = Record<string, any>;
export type Use = { name: string; input: Rec; ok: boolean; result: string; id: string };
const text = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === "string" ? b.text : JSON.stringify(b))).join("\n") : c == null ? "" : JSON.stringify(c));
const own = (transcript: string) => readTranscript(transcript).filter((m: Rec) => !m.parent_tool_use_id && Array.isArray(m.message?.content)) as Rec[];

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
const written = (u: Use): string[] => {
  if (u.name === "Write" && typeof u.input.content === "string") return [u.input.content];
  if (u.name === "Edit" && typeof u.input.new_string === "string") return [u.input.new_string];
  if (u.name === "MultiEdit" && Array.isArray(u.input.edits)) return u.input.edits.flatMap((e: Rec) => (typeof e?.new_string === "string" ? [e.new_string] : []));
  return [];
};

/** The main agent's own words: its text blocks, then the text its successful Write, Edit and MultiEdit calls wrote. */
export function ownWords(transcript: string): string[] {
  return [...mainAgentTexts(transcript), ...ownUses(transcript).filter((u) => u.ok).flatMap(written)];
}

/** The main agent's reply: its text blocks in order, joined by a blank line (BT). The parser reads the last block. */
export const replyOf = (transcript: string): string => mainAgentTexts(transcript).join("\n\n");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** Whether the main agent read a skill file (rel) by a successful Read, or a cat, head, sed -n or nl Bash read with a non-empty result. */
export function skillFileRead(transcript: string, rel: string): boolean {
  const path = new RegExp("(?:^|\\/)" + escape(rel) + "$");
  const bash = new RegExp("^\\s*(?:cat|head|nl|sed\\s+-n\\s+([\"']?)[\\d,$]*p\\1)\\s[^<>|;&]*" + escape(rel) + "\\s*$");
  return ownUses(transcript).some((u) => u.ok && u.result.trim() !== "" && ((u.name === "Read" && typeof u.input.file_path === "string" && path.test(u.input.file_path)) || (u.name === "Bash" && typeof u.input.command === "string" && bash.test(u.input.command))));
}

/**
 * A successful web result anywhere in the session, subagents included: a WebSearch or WebFetch tool call with a
 * result that is not an error, or the provider's own server tool result (web_search_tool_result, web_fetch_tool_result)
 * whose content is not an error object (BT).
 */
export function webResult(transcript: string): boolean {
  const messages = readTranscript(transcript) as Rec[];
  const calls = new Set<string>();
  for (const m of messages) for (const b of Array.isArray(m.message?.content) ? m.message.content : []) if (b?.type === "tool_use" && (b.name === "WebSearch" || b.name === "WebFetch")) calls.add(b.id);
  for (const m of messages) {
    for (const b of Array.isArray(m.message?.content) ? m.message.content : []) {
      if (b?.type === "tool_result" && calls.has(b.tool_use_id) && b.is_error !== true && !text(b.content).includes("<tool_use_error>")) return true;
      if ((b?.type === "web_search_tool_result" || b?.type === "web_fetch_tool_result") && !(b.content && typeof b.content === "object" && !Array.isArray(b.content) && /error/.test(String(b.content.type)))) return true;
    }
  }
  return false;
}

/** A path, pattern or command that names a gstack file: a gstack or .gstack path segment, .claude/skills, or a SKILL.md (BT). */
export const GSTACK_PATH = /(?:^|[\s/"'=])(?:\.?gstack(?:[-/]|$)|\.claude\/skills(?:\/|$))|(?:^|\/)SKILL\.md\b/;

/** Whether any agent in the session (subagents included) read a gstack file by a successful Read, Grep, Glob or Bash call. */
export function gstackRead(transcript: string): boolean {
  const messages = readTranscript(transcript) as Rec[];
  const results = new Map<string, Rec>();
  for (const m of messages) for (const b of Array.isArray(m.message?.content) ? m.message.content : []) if (b?.type === "tool_result") results.set(b.tool_use_id, b);
  for (const m of messages) {
    if (m.type !== "assistant") continue;
    for (const b of Array.isArray(m.message?.content) ? m.message.content : []) {
      if (b?.type !== "tool_use") continue;
      const res = results.get(b.id);
      if (!res || res.is_error === true || text(res.content).includes("<tool_use_error>") || !text(res.content).trim()) continue;
      const i = b.input ?? {};
      const named = [i.file_path, i.path, i.pattern, i.command].filter((x): x is string => typeof x === "string");
      if (["Read", "Grep", "Glob", "Bash"].includes(b.name) && named.some((s) => GSTACK_PATH.test(s))) return true;
    }
  }
  return false;
}
