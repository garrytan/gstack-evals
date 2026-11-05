// Copyright (c) 2026 Garry Tan. MIT License.
// Judge packets (prereg section 7): one first packet per reading, a D2 packet, the stock and oracle controls, and the
// packet key kept apart.
import { notBuilt } from "./errors.ts";
import type { Key } from "./types.ts";

/** The oracle report: the key's fact statements joined, cut to 250 words. */
export function oracleReport(key: Key): string {
  return notBuilt("oracleReport");
}
/** The first reply with the boundary line after its 250th word. */
export function withBoundary(reply: string): string {
  return notBuilt("withBoundary");
}
