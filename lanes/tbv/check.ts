// Copyright (c) 2026 Garry Tan. MIT License.
// The handoff check, the leak check and the org-rules scan over real inputs (prereg section 11 items 4 and 7).
// Stub: every export throws E_TBV_NOT_BUILT until the module is written.
import { notBuilt } from "./errors.ts";
export const addedLines = (..._: unknown[]): string[] => notBuilt("addedLines");
export const treeText = (..._: unknown[]): string => notBuilt("treeText");
export const namesOf = (..._: unknown[]): string[] => notBuilt("namesOf");
export const repoNames = (..._: unknown[]): string[] => notBuilt("repoNames");
export const run = (..._: unknown[]): number => notBuilt("tbv check");
