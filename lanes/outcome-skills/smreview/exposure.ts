// Copyright (c) 2026 Garry Tan. MIT License.
// SR's exposure reading (plan section 8), keyless, from the session's SDK stream and Claude Code's own transcript (which
// holds the subagents' calls). G+ ran the part under test when the State Machines specialist's file was read or its
// matrix helper ran; G0 is clean when neither happened. army: the Review Army section was read, so /review reached its
// specialist step at all. Exposure decides nothing; it prints beside every verdict, and the pilot gate reads it.
import type { SrArm } from "./arms.ts";

type Rec = { type?: string; content?: unknown; message?: { content?: unknown } };
const HOME = "/root/.claude/skills/gstack";
export const SPECIALIST = HOME + "/review/specialists/state-machines.md";
export const ARMY = HOME + "/review/sections/review-army.md";
export const MATRIX = /gstack-state-matrix\s+(outfile|check)\b/;

/** Every tool call in a transcript, from the SDK stream's blocks or Claude Code's message records alike. */
function calls(records: Rec[]): Array<{ name: string; input: Record<string, unknown> }> {
  return records.flatMap((r) => {
    const blocks = Array.isArray(r.content) ? r.content : Array.isArray(r.message?.content) ? r.message!.content : [];
    return (blocks as Array<Record<string, any>>).filter((b) => b?.type === "tool_use").map((b) => ({ name: String(b.name), input: (b.input ?? {}) as Record<string, unknown> }));
  });
}

export interface SrExposure { army: boolean; specialist_read: boolean; matrix_ran: boolean; ran: boolean; part_under_test: "ran" | "absent" | null }
export function srExposure(arm: SrArm, ...transcripts: Rec[][]): SrExposure {
  const cs = transcripts.flatMap(calls);
  const reads = cs.filter((c) => c.name === "Read").map((c) => String(c.input.file_path ?? ""));
  const bash = cs.filter((c) => c.name === "Bash").map((c) => String(c.input.command ?? ""));
  const army = reads.includes(ARMY);
  const specialist_read = reads.includes(SPECIALIST);
  const matrix_ran = bash.some((c) => MATRIX.test(c));
  const ran = specialist_read || matrix_ran;
  return { army, specialist_read, matrix_ran, ran, part_under_test: arm === "G+" || arm === "G0" ? (ran ? "ran" : "absent") : null };
}
