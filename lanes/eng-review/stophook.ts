// Copyright (c) 2026 Garry Tan. MIT License.
// The harness Stop hook fallback of smoke rule 2 (prereg 2026-11-08-geva-405, section 10). When a session tries to stop,
// onStop runs the arm's frozen detector (exposure.ts) on the transcript so far and, while the procedure hasn't shown,
// returns the block reason: one fixed message naming the missing outputs. It blocks at most twice; the third stop, and
// any stop once the session is exposed, is released (null). blocks() is the count the row prints. Build-time choices:
// the missing outputs fill the template's {missing} slot joined with "; ", and the hook keeps no state but its count, so
// each session gets its own erStopHook. The caller turns it on only for a run started with --enforce <arm>.
import { erExposure, type ErEvidence, type ErSkillArm } from "./exposure.ts";

export const ER_STOP_MESSAGE = "Do not stop yet. The skill's procedure has not shown these required outputs: {missing}. Produce them, then finish your reply as the prompt asks.";
export const ER_MAX_BLOCKS = 2;

export function erStopHook(arm: ErSkillArm, evidence: (transcript: string) => ErEvidence): { onStop: (transcript: string) => string | null; blocks: () => number } {
  let blocks = 0;
  return {
    onStop: (transcript) => {
      if (blocks >= ER_MAX_BLOCKS) return null;
      const e = erExposure(arm, evidence(transcript));
      if (e.exposed) return null;
      blocks++;
      return ER_STOP_MESSAGE.replace("{missing}", e.missing.join("; "));
    },
    blocks: () => blocks,
  };
}
