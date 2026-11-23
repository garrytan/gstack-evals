// Copyright (c) 2026 Garry Tan. MIT License.
// The scorer B2's table reads, in one place: B1's detector with B2's reading (section 6.3, detect's { rules: "b2" } option,
// returned as followed_b2 beside B1's fields), the Codex reader that turns rollouts into the records the detector reads
// (src/scoring/codex-transcript.ts), and the regression-test path rule on the graded diff (section 6.2,
// src/scoring/regression-test.ts). This file is the one seam B2's lane imports them through.
import { detect, type Detection } from "../delivery-route/detect.ts";
import type { Rec } from "../../quick/laneb/l1/probes.ts";
import { codexTranscript, type CodexTranscript } from "../../src/scoring/codex-transcript.ts";
import { testFilesInDiff } from "../../src/scoring/regression-test.ts";

export type { CodexTranscript, Detection, Rec };
export { codexTranscript, testFilesInDiff };
/** One session's detection: B1's fields (followed, followed_as_merged) and section 6.3's followed_b2. */
export const detectB2 = (recs: Rec[], patch: string, root?: string): Detection => detect(recs, patch, root, { rules: "b2" });
