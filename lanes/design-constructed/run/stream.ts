// Copyright (c) 2026 Garry Tan. MIT License.
// A Claude Code session that ended on a malformed tool call, read from its stream (wiring item 9). The shared driver
// reports a non-success result after model output as harness_crash. When the last top-level message before that result
// is Claude Code's own rejection of the model's tool call (a tool_result marked is_error whose text is a tool_use_error
// naming an input validation failure or a tool that does not exist), the harness ended the session on the model's call,
// so the termination is malformed_tool_call and PD-17 decides it by errorSeen (run/session.ts endOf).
import type { Termination } from "../../../src/types.ts";

const REJECTED = /<tool_use_error>[^]*(InputValidationError|No such tool available)/;

const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === "string" ? b.text : "")).join("") : "");

/** The model's tool call the harness rejected in this top-level message, or false. */
function rejectedCall(m: any): boolean {
  if (m?.type !== "user" || m.parent_tool_use_id) return false;
  const content = m.message?.content;
  return Array.isArray(content) && content.some((b: any) => b?.type === "tool_result" && b.is_error === true && REJECTED.test(textOf(b.content)));
}

/** The termination with a harness_crash that ended on a rejected tool call read as malformed_tool_call. */
export function toolCallEnd(transcript: string, t: Termination): Termination {
  if (t.kind !== "arm_failure" || t.failure !== "harness_crash") return t;
  const lines = transcript.split("\n").flatMap((l) => {
    try {
      return l.trim() ? [JSON.parse(l)] : [];
    } catch {
      return [];
    }
  });
  const top = lines.filter((m) => !m?.parent_tool_use_id && m?.type !== "system" && m?.type !== "stream_event");
  const last = top.length - 1;
  if (last < 1 || top[last]?.type !== "result" || top[last].subtype === "success" || top[last].subtype === "error_max_turns") return t;
  return rejectedCall(top[last - 1]) ? { kind: "arm_failure", failure: "malformed_tool_call" } : t;
}
