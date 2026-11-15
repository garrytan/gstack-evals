// Copyright (c) 2026 Garry Tan. MIT License.
// Every number the planted-unit eng-review read freezes (prereg 2026-11-15-geva-537-eng-review-planted-units-prereg). The
// comparison size is one parameter (SIZE); the MDD lines tied to it print from power.py.

/** The gstack commit both skill arms run: GSTA-546's restore merge on gstack main. Empty until the prereg freezes on it;
 * every paid path refuses an empty pin, and tests pass their own fixture pin. */
export const RESTORE_PIN: { repo: "garrytan/gstack"; sha: string; version: string; digests: Readonly<Record<string, string>> } = {
  repo: "garrytan/gstack",
  sha: "",
  version: "",
  digests: {},
};

export const SIZE = { units: 64, floor: 40, k: 3, kControl: 1, calibration: 6, reserve: 6, pilotUnits: 20, pilotK: 2 } as const;

export const FROZEN = {
  runs: 3,
  passOf: 2,
  window: {
    from: "2026-07-01",
    to: "2026-10-31",
    strictFrom: "2026-10-01",
    /** Published training cutoffs of the models that see unit content: Opus 5.5 (June 2026) and GPT-6.1 Sol (2026-04-30). */
    cutoffs: { opus: "2026-06-30", sol: "2026-04-30" },
  },
  frame: {
    licences: ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD"],
    stars: { min: 300, max: 50000 },
    pushedMonth: "2026-10",
    maxRepoMB: 300,
    perRepo: 3,
    maxProductLines: 80,
    maxFunctions: 3,
    maxFiles: 2,
  },
  region: { minLines: 10, maxLines: 300 },
  bodyCheck: { minChars: 20, runLines: 3, maxShare: 0.1 },
  supply: { minQualifiers: 80, targetQualifiers: 115 },
  plan: { minWords: 200, maxWords: 500, rewrites: 1 },
  hinted: { runs: 3, passOf: 2 },
  pilot: { reachMin: 0.6, hintedMin: 0.6, low: 0.1, high: 0.75, lowerMax: 0.65, functionalMin: 0.5 },
  raise: { readUnits: 16, k: 2, target: 64, floor: 40 },
  exposure: {
    opus: { sessions: 6, min: 5 },
    other: { sessions: 3, min: 2 },
    interim: { after: 24, min: 0.7 },
    final: 0.8,
  },
  stopHook: { maxBlocks: 2 },
  bundle: { maxWords: 12000 },
  alpha: 0.05,
  bootstrapDraws: 10000,
  reachGuard: -0.05,
  keepFunctionalLower: -0.1,
  stockUpper: 0.05,
  coverageMin: 0.9,
  toolTreesMin: 0.9,
  mddStop: 0.12,
  worthActing: 0.1,
  judge: { minGold: 48, kappaMin: 0.6, maxItems: 12, prevalence: { min: 0.3, max: 0.5 }, genericPerEcosystem: 30, stockWords: 120 },
  sessions: {
    review: { usd: 10, turns: 200, minutes: 90 },
    build: { usd: 16, turns: 400, minutes: 180 },
  },
  money: { allInStopUsd: 5000, reserveUsd: 150, inflightUsd: 16, haltAfterSessions: 10 },
  conditionalReviewsPerCell: 2,
} as const;
