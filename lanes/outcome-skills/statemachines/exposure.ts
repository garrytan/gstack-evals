// Exposure detectors for family SM (prereg section 11, and section 17 for /qa), keyless, read from the session's
// sdk-messages.jsonl with arms/exposure.ts readTranscript. Exposure decides nothing; it prints beside the verdicts.
import { readTranscript } from "../arms/exposure.ts";

type Rec = { type: string; parent_tool_use_id?: string | null; content?: unknown };
const blocks = (r: Rec) => (Array.isArray(r.content) ? (r.content as Array<Record<string, any>>) : []);

/** The assistant's own text (not a subagent's) after its first tool call. */
export function textAfterFirstTool(records: Rec[]): string {
  const own = records.filter((r) => r.type === "AssistantMessage" && (r.parent_tool_use_id ?? null) === null);
  const out: string[] = [];
  let seen = false;
  for (const r of own)
    for (const b of blocks(r)) {
      if (b.type === "tool_use") seen = true;
      else if (seen && b.type === "text" && typeof b.text === "string") out.push(b.text);
    }
  return out.join("\n");
}

export const A1_EXPOSED = /state machine|transition/i;
export const S2_EXPOSED = /refactor|restructur/i;

/** A1: "state machine" or "transition" after the first tool call; S2: "refactor" or "restructur". */
export function textExposure(records: Rec[], cell: "A1" | "S2"): boolean {
  return (cell === "A1" ? A1_EXPOSED : S2_EXPOSED).test(textAfterFirstTool(records));
}

const toolInputs = (records: Rec[], name: string) => records.flatMap((r) => (r.type === "AssistantMessage" ? blocks(r).filter((b) => b.type === "tool_use" && b.name === name).map((b) => b.input ?? {}) : []));

/** /qa: gstack's skill start ran for qa (a Bash call to gstack-skill-start naming qa), and the session read qa/SKILL.md and at least one qa/sections/ file under the install. */
export function qaExposure(records: Rec[], install = "/root/.claude/skills/gstack"): { skill_start: boolean; skill_md: boolean; section: boolean; exposed: boolean } {
  const bash = toolInputs(records, "Bash").map((i) => String(i.command ?? ""));
  const reads = toolInputs(records, "Read").map((i) => String(i.file_path ?? ""));
  const skill_start = bash.some((c) => /gstack-skill-start\b[^\n]*\bqa\b/.test(c));
  const skill_md = reads.some((p) => p === install + "/qa/SKILL.md");
  const section = reads.some((p) => p.startsWith(install + "/qa/sections/"));
  return { skill_start, skill_md, section, exposed: skill_start && skill_md && section };
}

export const readSession = (file: string): Rec[] => readTranscript(file).records as unknown as Rec[];
