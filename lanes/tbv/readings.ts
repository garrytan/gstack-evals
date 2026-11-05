// Copyright (c) 2026 Garry Tan. MIT License.
// The readings writer: driver records, the packet key and judge records into the readings file rule.ts reads.
import { notBuilt } from "./errors.ts";
import type { Arm, Family } from "./types.ts";

/** The procedure gate (section 5): current in the skill layer, current in capy, or principle by the pin post's detector. */
export function exposed(text: string, arm: Arm, family: Family, principle: RegExp[] | null): boolean | null {
  return notBuilt("exposed");
}
