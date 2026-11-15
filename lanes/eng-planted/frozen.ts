// Copyright (c) 2026 Garry Tan. MIT License.
// Every number the planted-unit eng-review read freezes (prereg 2026-11-15-geva-537-eng-review-planted-units-prereg). The
// comparison size is one parameter (SIZE); the MDD lines tied to it print from power.py.

/** The gstack commit both skill arms run: the restore of the standalone /plan-eng-review merged on gstack main
 * (garrytan/gstack#4375), with the sha256 of each file the arms and detectors read. */
export const RESTORE_PIN: { repo: "garrytan/gstack"; sha: string; version: string; digests: Readonly<Record<string, string>> } = {
  repo: "garrytan/gstack",
  sha: "8837fda3998224fc09f46e6e90a549334fbc9b68",
  version: "1.99.4.0",
  digests: {
    "plan-eng-review/SKILL.md": "58d96f6f3e296ccc2942e2e1a5732810b18f9f8bcd6ed9338115c99c91a88524",
    "plan-eng-review/sections/review-sections.md": "3d04ce8807d0c1afbe8502b18edea88a62f78305d07bc4d1de4bd9b0772e195a",
    "plan-eng-review/sections/preamble.md": "3eeee274045c6af4a3a4a88895944a348e3f8613232f44e04875fd1318861705",
    "autoplan/SKILL.md": "2ec68c1217fa7fcb0cf392db160eb52ca852afa6f5dff9ae332d91e52949aaf0",
    "autoplan/sections/eng-phase.md": "527e7ff9c629cbee410d292de179ea4477ecbb12b338e97952c1c6749411fb9e",
    "autoplan/sections/unattended.md": "ef2485de42d109de85a803723220c98e6c89e21f7e9cd9efb285972e6ee9eda8",
    "bin/gstack-autoplan-snapshot.ts": "f9a31c701d8a86af3b752ab0901661a12f54cd7cd73b512e33f0eea62e555e73",
  },
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
