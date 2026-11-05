// Copyright (c) 2026 Garry Tan. MIT License.
// The judge run (prereg section 7, amendment item 9): judge-brief-v2.md and one packet per request, the frozen judge
// routing, the seeded double read, one retry on a bad reply.
import { notBuilt } from "./errors.ts";
import type { JudgeAnswer, JudgeRecord, Packet } from "./types.ts";

/** Parses one judge reply: one fenced tbv-judge block, one entry per key fact in order. Returns the answer or why it is refused. */
export function parseJudgeReply(text: string, packet: Packet): JudgeAnswer | string {
  return notBuilt("parseJudgeReply");
}

export const readBundle = (file: { path: string; sha256: string }, root?: string): string => notBuilt("readBundle");
export const judgePrompt = (brief: string, packet: string): string => notBuilt("judgePrompt");
export const runJudges = async (o: Record<string, unknown>): Promise<JudgeRecord[]> => notBuilt("runJudges");
export const run = async (argv: string[], io: unknown, deps: Record<string, unknown> = {}): Promise<number> => notBuilt("tbv judge");
