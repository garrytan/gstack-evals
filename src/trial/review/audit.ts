// The read audit for plan runs (panel v3 plan, sections 4 and 5; FOUN-32's rule from GGST-6, 2026-11-02). It reads every
// tool call in a session's transcript.ndjson, the main agent's and each subagent's, with its tool_result, and classes what
// each call touched: a gstack skill file (a SKILL.md, or a .md under sections/, on a path with a gstack or .claude/skills
// segment), anything under .local/share/gstack, anything under a home's .capy (~/.capy, $HOME/.capy, /home/*/.capy,
// /root/.capy) and a gstack-* command in Bash. It reads a call's file_path, path, pattern and notebook_path, and a Bash
// call's command text. A touch whose result is an error (a missing file, a failed command) is printed and is never
// contamination; a call with no result counts as done. Contamination, in any arm, is a non-error touch under .capy; in
// the none and lens arms it is also a non-error touch of a skill file or of .local/share/gstack, or a gstack-* command.
// A contaminated arm is untested (E_ARM_CONTAMINATED). Printed targets replace the session's HOME with ~ and its
// /work/<task> with <unit>. AUDIT_SHA256, this file's sha256, joins every plan session key's verifier.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import type { PlanArm } from "./plan.ts";
import { readTranscript } from "./readers.ts";

export const AUDIT_SHA256 = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");

export type TouchClass = "skill" | "gstack" | "capy" | "command";
export interface Touch {
  tool: string;
  class: TouchClass;
  /** The path or command word, with HOME as ~ and /work/<task> as <unit>. */
  target: string;
  error: boolean;
  contaminated: boolean;
}

const INPUTS = ["file_path", "path", "pattern", "notebook_path"] as const;

function pathClasses(raw: string, home: string): TouchClass[] {
  const p = raw.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home);
  const out: TouchClass[] = [];
  if (/(^|\/)(SKILL\.md|sections\/[^/]+\.md)$/.test(p) && (p.split("/").includes("gstack") || /(^|\/)\.claude\/skills(\/|$)/.test(p))) out.push("skill");
  if (/(^|\/)\.local\/share\/gstack(\/|$)/.test(p)) out.push("gstack");
  if (p === home + "/.capy" || p.startsWith(home + "/.capy/") || /^\/(home\/[^/]+|root)\/\.capy(\/|$)/.test(p)) out.push("capy");
  return out;
}

/** Every touch in one session's transcript.ndjson, in order. */
export function auditTranscript(transcript: string, o: { arm: PlanArm; home: string; work: string }): Touch[] {
  const messages = readTranscript(transcript);
  const errors = new Map<string, boolean>();
  for (const m of messages) for (const b of m.type === "user" && Array.isArray(m.message?.content) ? m.message.content : []) if (b?.type === "tool_result" && typeof b.tool_use_id === "string") errors.set(b.tool_use_id, b.is_error === true);
  const bare = o.arm === "none" || o.arm === "lens";
  const show = (s: string) => s.replaceAll(o.work, "<unit>").replaceAll(o.home, "~");
  const touches: Touch[] = [];
  for (const m of messages) for (const b of m.type === "assistant" && Array.isArray(m.message?.content) ? m.message.content : []) {
    if (b?.type !== "tool_use" || !b.input || typeof b.input !== "object") continue;
    const input = b.input as Record<string, unknown>;
    const error = errors.get(b.id) === true;
    const found: [TouchClass, string][] = INPUTS.flatMap((k) => (typeof input[k] === "string" ? pathClasses(input[k] as string, o.home).map((c): [TouchClass, string] => [c, input[k] as string]) : []));
    if (b.name === "Bash" && typeof input.command === "string") {
      for (const w of input.command.split(/[\s;|&()<>`'"=]+/)) if (w) for (const c of pathClasses(w, o.home)) found.push([c, w]);
      for (const seg of input.command.split(/[;&|()\n`]+/)) {
        const word = seg.trim().split(/\s+/).find((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
        if (word && /^gstack-[A-Za-z0-9_-]+$/.test(basename(word))) found.push(["command", word]);
      }
    }
    const seen = new Set<string>();
    for (const [c, target] of found) {
      if (seen.has(c + " " + target)) continue;
      seen.add(c + " " + target);
      touches.push({ tool: String(b.name), class: c, target: show(target), error, contaminated: !error && (c === "capy" || bare) });
    }
  }
  return touches;
}

/** One printed line per touch. */
export const touchLine = (t: Touch): string => t.tool + " " + t.class + " " + t.target + (t.error ? " (error, not contamination)" : t.contaminated ? " (contamination)" : "");
