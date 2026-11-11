// Copyright (c) 2026 Garry Tan. MIT License.
// Every number the eng-review build read freezes (prereg 2026-11-11-geva-522-eng-review-build-read-prereg). The
// comparison size is one parameter: the owner's pick between 48 units with 3 builds a cell and 40 with 2 changes only
// SIZE and the MDD lines tied to it.
import type { SkillArm } from "./types.ts";

export const SIZE = { units: 48, k: 3, kNone: 2 } as const;

export const FROZEN = {
  runs: 3,
  passOf: 2,
  recount: { minClean: 16 },
  pilot: { units: 16, k: 2, reachMin: 0.6, floor: 0.1, functionalMin: 0.5, ceiling: 0.85, ceilingLower: 0.75 },
  exposure: {
    opus: { sessions: 6, min: 5 },
    other: { sessions: 3, min: 2 },
    interim: { after: 24, min: 0.7 },
    final: 0.8,
    minOpusArms: 2,
  },
  stopHook: { maxBlocks: 2 },
  bundle: { maxWords: 12000 },
  alpha: 0.05,
  sequence: ["candidate", "precut", "engphase"] as readonly SkillArm[],
  bootstrapDraws: 10000,
  reachGuard: -0.05,
  cutUpper: 0.05,
  keepFunctionalLower: -0.1,
  coverageMin: 0.9,
  toolTreesMin: 0.9,
  mddStop: 0.12,
  newUnitsPerRepo: 2,
  conditionalReviewsPerCell: 2,
  sessions: {
    review: { usd: 10, turns: 200, minutes: 90 },
    build: { usd: 16, turns: 400, minutes: 180 },
  },
} as const;
