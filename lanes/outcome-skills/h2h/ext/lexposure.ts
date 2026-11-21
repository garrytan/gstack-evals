// Copyright (c) 2026 Garry Tan. MIT License.
// Part L's exposure detectors (plan section 8), for Claude Code past gstack 7f9c1bc5, where gstack's SKILL.md runs its
// start step and inlines the preamble as Claude Code loads it, so no gstack-skill-start Bash call need appear. The
// /autoplan procedure marker is either form of the start step: inline, the printed start block inside the expanded
// command body (its SKILL_START_PROTO line, its SESSION_KIND line and the autoplan guard line, which names the skill); or
// fallback, where gstack-skill-load's injection fell back (SHARED_PREAMBLE: not loaded, a SKILL_LOAD: line, or a
// SKILL_START: line saying the start did not run at load) and a later Bash call runs gstack-skill-start for autoplan.
// Every marker is read line by line from context the session got (never a tool result, never the SKILL.md prose, which
// names the same keys inside sentences). The sentence arms' exposure is the sentence in the session's first request body
// at the metering proxy: inside the CLAUDE.md text for l-gstack-md, at the end of T for l-gstack-task.
import type { Entry, Exposure } from "../types.ts";
import type { Ev } from "../sessions/exposure.ts";
import { readExtPrereg, type ExtPrereg } from "./prereg.ts";

export type StartForm = "inline" | "fallback";
const INLINE = [/^SKILL_START_PROTO: 1\s*$/m, /^SESSION_KIND: [a-z]+/m, /^autoplan guard: /m];
const FALLBACK = [/^SHARED_PREAMBLE: not loaded/m, /^SKILL_LOAD: /m, /^SKILL_START: (not run|timed out|failed)[^\n]* at load/m];
const START_CALL = /gstack-skill-start\b[^\n]*--skill\s+["']?autoplan\b/;

/** The /autoplan start step's form in a session's events, or null when neither form shows. */
export function autoplanStart(evs: readonly Ev[]): { form: StartForm | null; markers: string[] } {
  const ctx = evs.filter((e) => e.kind === "context");
  const inline = ctx.find((e) => INLINE.every((r) => r.test(e.text)));
  if (inline) return { form: "inline", markers: ["start:inline@" + inline.at] };
  const fell = ctx.find((e) => FALLBACK.some((r) => r.test(e.text)));
  if (!fell) return { form: null, markers: [] };
  const call = evs.find((e) => e.kind === "tool_use" && e.name === "Bash" && e.at > fell.at && START_CALL.test(String(e.input?.command ?? "")));
  return call ? { form: "fallback", markers: ["start:fallback@" + fell.at, "start:bash@" + call.at] } : { form: null, markers: ["start:fallback-without-call@" + fell.at] };
}

/** Every string a parsed JSON value holds, in order. */
const strings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
};

/** Where the sentence sits in the session's first request body (the proxy's first_request record of its system and
 *  messages fields): inside the l-gstack-md CLAUDE.md text, after T's blank line (the task suffix), or elsewhere; null
 *  when absent. */
export function sentenceIn(firstRequest: unknown, x: ExtPrereg = readExtPrereg()): "claude_md" | "task" | "elsewhere" | null {
  const all = strings(firstRequest);
  const md = x.parts.L.claude_md["l-gstack-md"]!.trimEnd();
  const suffix = x.parts.L.task_suffix["l-gstack-task"]!;
  if (all.some((s) => s.includes(md))) return "claude_md";
  if (all.some((s) => s.includes(suffix))) return "task";
  return all.some((s) => s.includes(x.sentence)) ? "elsewhere" : null;
}

export interface LExposure extends Exposure { start_form: StartForm | null; sentence: "claude_md" | "task" | "elsewhere" | null }

/** Part L's exposure for one session. Bug entries of the gstack arms count as the installed pack (loaded and run); on
 *  feature entries loaded is the /autoplan command expanded or a start form seen, and procedure is a start form. The
 *  sentence arms are loaded only when the sentence sits where the arm puts it. foreign_reads come from the read audit. */
export function lExposure(arm: "l-none" | "l-gstack" | "l-gstack-md" | "l-gstack-task", entry: Entry, evs: readonly Ev[], firstRequest: unknown, x: ExtPrereg = readExtPrereg()): LExposure {
  const sentence = sentenceIn(firstRequest, x);
  const start = autoplanStart(evs);
  if (arm === "l-none") return { loaded: false, procedure: false, markers: [], foreign_reads: [], start_form: start.form, sentence };
  const placed = arm === "l-gstack-md" ? sentence === "claude_md" : arm === "l-gstack-task" ? sentence === "task" : true;
  const command = evs.some((e) => e.kind === "context" && /<command-name>\s*\/autoplan\s*<\/command-name>/.test(e.text));
  const markers = [...(entry === "bug" ? ["installed-pack"] : command ? ["command:/autoplan"] : []), ...start.markers, ...(arm !== "l-gstack" && placed ? ["sentence:" + sentence] : [])];
  const loaded = (entry === "bug" || command || start.form !== null) && placed;
  return { loaded, procedure: entry === "bug" || start.form !== null, markers, foreign_reads: [], start_form: start.form, sentence };
}
