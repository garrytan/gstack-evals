// Copyright (c) 2026 Garry Tan. MIT License.
// The scorer B2's table reads, in one place: B1's detector with B2's changes (section 6.3), the Codex reader that turns
// rollouts into the records the detector reads, and the regression-test path rule on the graded diff (section 6.2). They are
// built on the b2-scorer branch (lanes/delivery-route/detect.ts's b2 option, src/scoring/codex-transcript.ts codexRecs,
// src/scoring/regression-test.ts testFilesInDiff); this file is the one seam B2's lane imports them through.
// STAND-IN until b2-scorer merges into this branch: followed_b2 reads B1's rule as merged on main, the regression-test rule
// reads B1's TEST_PATH on the diff's added, modified and renamed-to files, and the Codex reader refuses (E_B2_SCORER).
import { detect, modifiedFiles, TEST_PATH, type Detection } from "../delivery-route/detect.ts";
import type { Rec } from "../../quick/laneb/l1/probes.ts";

export type { Detection, Rec };
export { modifiedFiles };
/** B1's detection (followed under B1's rule, and as merged) and section 6.3's (followed_b2), for one session. */
export function detectBoth(recs: Rec[], patch: string, root?: string): { b1: Detection; b2: Detection } {
  const b1 = detect(recs, patch, root);
  return { b1, b2: b1 };
}
/** The Codex rollouts of one session (root thread and sub-agents, as texts) as detector records, with the count of rollout
 *  items the reader could not read. */
export function codexRecs(rollouts: string[]): { recs: Rec[]; unreadable: number } {
  void rollouts;
  throw new Error("E_B2_SCORER the Codex reader (src/scoring/codex-transcript.ts) is not merged into this branch yet");
}
/** The files a unified diff adds, modifies or renames to that the test-path rule calls a test, in diff order. */
export function testFilesInDiff(patch: string): string[] {
  const out: string[] = [];
  for (const line of patch.split("\n")) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line);
    if (m && TEST_PATH.test(m[1]!) && !out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}
