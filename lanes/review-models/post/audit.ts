// Copyright (c) 2026 Garry Tan. MIT License.
// Two session-record reads for the review-models pilot (wiki/plans/2026-11-24-geva-590-review-models-prereg, Pilots):
// - readAudit: N's read audit. A plain-Opus session passes when its transcript.ndjson shows no gstack file and no Capy drive
//   path: no tool call (main agent or subagent) whose input names gstack or a drive (lanes/office-hours-founder's
//   gstackReads covers the read tools; this adds every input field of every tool and the drive forms), no tool result that
//   quotes a drive path or a gstack SKILL.md path, and no session init message that lists a gstack skill or command. An
//   empty or unreadable transcript fails, since nothing shows the session clean.
// - sessionModels: every model that answered in the session, main agent and subagents, from each assistant message's
//   model. The pilot's part-ran check for a gstack cell needs every one to be the cell's model (Opus cells on
//   claude-opus-5-5, Fable cells on claude-fable-5-2, specialists included).
// Neither read returns text from the session beyond the hit's tool name and the pattern it matched, so the readout can
// print a hit without quoting a unit's paths.
import { gstackReads } from "../../office-hours-founder/run/contain.ts";
import { readTranscript } from "../../../src/trial/review/readers.ts";

const GSTACK = /gstack/i;
const DRIVE = /\.capy\/drive|drive:\/\//i;
const SKILL_PATH = /gstack[\w.-]*\/(?:[\w.-]+\/)*SKILL\.md/i;
/** Claude Code's own placeholder for a turn no model wrote. */
const SYNTHETIC = "<synthetic>";

const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);

export interface AuditHit {
  /** The tool, "result" for a tool result, or "init" for the session's init message. */
  where: string;
  pattern: "gstack" | "drive" | "gstack skill file";
}

export interface ReadAudit {
  readable: boolean;
  hits: AuditHit[];
  clean: boolean;
}

export function readAudit(transcript: string): ReadAudit {
  const messages = readTranscript(transcript);
  if (!messages.length) return { readable: false, hits: [], clean: false };
  const hits: AuditHit[] = [];
  const add = (where: string, pattern: AuditHit["pattern"]) => {
    if (!hits.some((h) => h.where === where && h.pattern === pattern)) hits.push({ where, pattern });
  };
  for (const read of gstackReads(transcript)) add(read.split(" ")[0]!, "gstack");
  for (const m of messages) {
    if (m.type === "system" && m.subtype === "init" && strings([m.slash_commands, m.skills, m.plugins, m.agents]).some((s) => GSTACK.test(s))) add("init", "gstack");
    for (const b of Array.isArray(m.message?.content) ? (m.message.content as Record<string, unknown>[]) : []) {
      if (b?.type === "tool_use") {
        const input = strings(b.input);
        if (input.some((s) => GSTACK.test(s))) add(String(b.name), "gstack");
        if (input.some((s) => DRIVE.test(s))) add(String(b.name), "drive");
      }
      if (b?.type === "tool_result") {
        const text = strings(b.content);
        if (text.some((s) => DRIVE.test(s))) add("result", "drive");
        if (text.some((s) => SKILL_PATH.test(s))) add("result", "gstack skill file");
      }
    }
  }
  return { readable: true, hits, clean: hits.length === 0 };
}

/** Every distinct model that answered in the session, main agent and subagents alike. */
export function sessionModels(transcript: string): string[] {
  const seen = new Set<string>();
  for (const m of readTranscript(transcript)) {
    const model = m.type === "assistant" ? m.message?.model : undefined;
    if (typeof model === "string" && model && model !== SYNTHETIC) seen.add(model);
  }
  return [...seen].sort();
}
