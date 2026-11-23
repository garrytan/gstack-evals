// Copyright (c) 2026 Garry Tan. MIT License.
// The rollout files of one fixture session, in the order readCodexSessions reads them.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d).sort().flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)])) : []);
export const walkRollouts = (dir: string) => walk(join(dir, "codex-sessions")).filter((f) => /rollout-.*\.jsonl$/.test(f));
