// Copyright (c) 2026 Garry Tan. MIT License.
// Custody for a run (prereg section 16): the plaintext root on tmpfs, the leftover check at start, sealed records.
import { notBuilt } from "./errors.ts";

export function plaintextRoot(dir: string, o: { devPlaintext: boolean; held: boolean }): string {
  return notBuilt("plaintextRoot");
}
