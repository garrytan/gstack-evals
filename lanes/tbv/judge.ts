// Copyright (c) 2026 Garry Tan. MIT License.
// The judge run (prereg section 7, amendment item 9): judge-brief-v2.md and one packet per request, the frozen judge
// routing, the seeded double read, one retry on a bad reply.
import { notBuilt } from "./errors.ts";
import type { JudgeAnswer, Packet } from "./types.ts";

/** Parses one judge reply: one fenced tbv-judge block, one entry per key fact in order. Returns the answer or why it is refused. */
export function parseJudgeReply(text: string, packet: Packet): JudgeAnswer | string {
  return notBuilt("parseJudgeReply");
}
