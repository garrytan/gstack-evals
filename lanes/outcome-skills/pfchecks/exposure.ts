// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 8's exposure detectors, keyless. The transcript is the session's sdk-messages.jsonl, read with
// arms/exposure.ts readTranscript as the state machines sessions record it. Exposure decides nothing; it prints beside
// every verdict.
import { readTranscript } from "../arms/exposure.ts";
import { isTestPath, type Lang } from "../statemachines/langs.ts";
import type { Change } from "./transplant.ts";

type Rec = { type?: string; content?: unknown };
export const P_HEADING = "# Create a formal verification skill";
export const STATECHART_SKILL = /(^|\/)statechart\/SKILL\.md$/;
/** The frozen checker list: TLC (tlc2.TLC, tla2tools.jar, a script in statechart's skill dir) and the other checkers. */
export const CHECKER: readonly RegExp[] = [/tlc2\.TLC/, /tla2tools\.jar/, /statechart\/(scripts?\/)?[\w.-]+\.(sh|ts|js|mjs|py)\b/, /\bapalache(-mc)?\b/, /\bquint\s+(run|verify|test)\b/, /\bspin\s+-/, /\b(NuSMV|nuXmv)\b/, /alloy[\w.-]*\.jar|org\.alloytools/];
export const runsChecker = (cmd: string): boolean => CHECKER.some((r) => r.test(cmd));

const toolInputs = (records: Rec[], name: string): Record<string, unknown>[] =>
  records.flatMap((r) => (r.type === "AssistantMessage" && Array.isArray(r.content) ? (r.content as Array<Record<string, any>>).filter((b) => b?.type === "tool_use" && b.name === name).map((b) => (b.input ?? {}) as Record<string, unknown>) : []));

/** P loaded: the skill body's heading appears in the transcript and a Read of statechart's SKILL.md appears. */
export function pLoaded(records: Rec[]): { body: boolean; statechart_read: boolean; loaded: boolean } {
  const body = records.some((r) => JSON.stringify(r).includes(P_HEADING));
  const statechart_read = toolInputs(records, "Read").some((i) => STATECHART_SKILL.test(String(i.file_path ?? "")));
  return { body, statechart_read, loaded: body && statechart_read };
}
export const ranChecker = (records: Rec[]): boolean => toolInputs(records, "Bash").some((i) => runsChecker(String(i.command ?? "")));

/** P's own procedure: a new SKILL.md under a .claude/skills/ dir in T whose text opens with front matter. */
export function pProcedure(newFiles: { path: string; text: string }[]): boolean {
  return newFiles.some((f) => /(^|\/)\.claude\/skills\/(.+\/)?SKILL\.md$/.test(f.path) && /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.test(f.text));
}
export const codeTest = (lang: Lang, testFiles: ReadonlySet<string>, tChanges: Change[]): boolean => tChanges.some((c) => c.status !== "D" && isTestPath(lang, c.path, testFiles));

export const readSession = (file: string): Rec[] => readTranscript(file).records as unknown as Rec[];
