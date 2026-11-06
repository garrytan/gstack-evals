// Copyright (c) 2026 Garry Tan. MIT License.
// Source A (prereg section 4, amendment section 1): R3 none-arm sessions from run bundles, with the provenance gate,
// the first-message rebuild, block-type inference, the drops and the final-text cut.
import { notBuilt } from "../errors.ts";
import type { AssembleResult, Io } from "../types.ts";

/** One trial's files, as read from a bundle (rel path to text), and the gate's inputs. */
export interface TrialFiles {
  files: Map<string, string>;
  /** sha256 of the task directory the trial ran (held tier) or rebuilt from the pinned export (rebuild tier), or null. */
  taskTreeDigest: string | null;
  instruction: string | null;
  wrapper: { text: string; sha256: string };
  persona: { sha256: string };
  manifest: { wrapper_sha256: string; persona_sha256: string } | null;
  /** The commit time of the last change to the wrapper and persona in the repo (B0's second basis). */
  runnerUnchangedSince: string | null;
}
export function assembleA(trial: TrialFiles): AssembleResult {
  return notBuilt("assembleA");
}

/** The first user message as quick/laneb/runner/agent/prompt_builder.py's build_prompt composes it for a none arm. */
export function buildFirstMessage(wrapper: string, instruction: string, kwargs: Record<string, unknown>): string {
  return notBuilt("buildFirstMessage");
}
export function parseSession(lines: string): { drops: string[]; work: unknown[]; report: string } {
  return notBuilt("parseSession");
}
export function treeDigestOf(files: Map<string, string>): string {
  return notBuilt("treeDigestOf");
}
export function taskDirDigest(dir: string): string {
  return notBuilt("taskDirDigest");
}
export function checkTaskDir(dir: string, digest: string): boolean {
  return notBuilt("checkTaskDir");
}
export async function run(argv: string[], io: Io): Promise<number> {
  return notBuilt("assemble-a");
}
