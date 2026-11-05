// Copyright (c) 2026 Garry Tan. MIT License.
// Key writing and auditing (prereg section 4): the key writer and two auditors through the proxy on tbv-author's lease.
import { notBuilt } from "./errors.ts";
import type { Extract, History, Key } from "./types.ts";

/** Checks a key writer's reply against the brief's rules; returns the key or the reason it is refused. */
export function parseKey(reply: string, history: History, extract: Extract): Key | string {
  return notBuilt("parseKey");
}

export const keyPrompt = (brief: string, history: History, extract: Extract): string => notBuilt("keyPrompt");
export const auditPrompt = (brief: string, key: Key, history: History): string => notBuilt("auditPrompt");
export const parseAudit = (reply: string, key: Key): { rejected: string[]; missing: string[] } | string => notBuilt("parseAudit");
export const settleKey = (key: Key, audits: unknown[], clean: boolean): { key: Key; drop: string | null } => notBuilt("settleKey");
export const writeKeys = async (o: Record<string, unknown>): Promise<{ kept: Key[]; dropped: Array<{ task: string; reason: string }> }> => notBuilt("writeKeys");
export const run = async (argv: string[], io: unknown, deps: Record<string, unknown> = {}): Promise<number> => notBuilt("tbv keys");
