// Copyright (c) 2026 Garry Tan. MIT License.
// The mechanical extractor (prereg section 4): fact candidates with cited events, lists in record order, and the
// stratum. B0's screen rules, ported; this module is the one the run uses.
import { notBuilt } from "./errors.ts";
import type { Extract, History } from "./types.ts";

export function extract(history: History): Extract {
  return notBuilt("extract");
}
/** Amendment item 12: history plus the family's overhead (the larger of 40,000 and the captured overhead, characters / 3) is at most 130,000 tokens. */
export function admitsSize(historyTokens: number, overheadTokens: number): boolean {
  return notBuilt("admitsSize");
}
