// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless dry run at the head (build plan section 10). Stub: every export throws E_TBV_NOT_BUILT until it is written.
import { notBuilt } from "./errors.ts";
import type { Io } from "./types.ts";
export const ORDERED: Record<string, string> = {};
export const dryrun = async (_out: string, _io: Io): Promise<{ pass: number; fail: number }> => notBuilt("dryrun");
export const run = (..._: unknown[]): number => notBuilt("tbv dryrun");
