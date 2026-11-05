// Copyright (c) 2026 Garry Tan. MIT License.
// Key writing and auditing (prereg section 4): the key writer and two auditors through the proxy on tbv-author's lease.
import { notBuilt } from "./errors.ts";
import type { Extract, History, Key } from "./types.ts";

/** Checks a key writer's reply against the brief's rules; returns the key or the reason it is refused. */
export function parseKey(reply: string, history: History, extract: Extract): Key | string {
  return notBuilt("parseKey");
}
