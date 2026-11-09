// Copyright (c) 2026 Garry Tan. MIT License.
// The session scorer (section 13): a stub until the scorer's build replaces it. Every score field is null.
import type { HmArm, HmScore } from "../../src/types.ts";

export const SCORER = "stub";
export function scoreSession(_records: unknown[], _arm: HmArm): HmScore {
  return { scorer: SCORER, edited: null, adherent: null, claim: null, false_done: null, verify_load: null, patterns: { redirected_read: null, tox_no_tests: null, combined_flags: null } };
}
