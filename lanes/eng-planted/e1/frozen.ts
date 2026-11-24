// Copyright (c) 2026 Garry Tan. MIT License.
// Every number and pin eval 1 of the state machine plan freezes (prereg 2026-11-24-geva-587-design-time-state-modeling
// and its pre-run changes). The lane's own FROZEN (../frozen.ts) still holds what eval 1 takes from attempt 3
// unchanged: the grading runs, the frame and window, the session limits and the bundle cap.

export type E1Arm = "N" | "D" | "C" | "P" | "G";
export type E1Model = "opus" | "sol" | "particle";

export const E1_ARMS: readonly E1Arm[] = ["N", "D", "C", "P", "G"];
export const E1_MODELS: readonly E1Model[] = ["opus", "sol", "particle"];

/** Which arms run on which model. P has no Codex harness at its pin, so it does not run on Sol (prereg section 4). */
export const RUNS_ON: Readonly<Record<E1Arm, readonly E1Model[]>> = {
  N: ["opus", "sol", "particle"],
  D: ["opus", "sol", "particle"],
  C: ["opus", "sol", "particle"],
  P: ["opus", "particle"],
  G: ["opus", "sol", "particle"],
};

export const pairs = (): Array<{ arm: E1Arm; model: E1Model }> => E1_ARMS.flatMap((arm) => RUNS_ON[arm].map((model) => ({ arm, model })));

/** The reviewer models, as the policy and the proxies name them. */
export const E1_MODEL_ID: Readonly<Record<E1Model, string>> = { opus: "claude-opus-5-5", sol: "gpt-6.2-sol", particle: "particle-ai/particle-1" };
export const E1_HOST: Readonly<Record<E1Model, "claude" | "codex">> = { opus: "claude", sol: "codex", particle: "claude" };

export const PINS = {
  gstack: { repo: "garrytan/gstack", sha: "d74ee528b6df9ddb945be2103a24544babe76e65", version: "1.103.2.0" },
  pstack: { repo: "cursor/plugins", sha: "ca782ed8b3c2c521cead8e1720d55c3a5dbf2347", harness: "harness/pstack/claude-code" },
  claudeCode: "2.1.314",
  codex: "0.170.0",
} as const;

export const E1 = {
  units: { target: 64, floor: 48, calibration: 6, reserve: 6, perRepo: 3 },
  /** Two review and build cells a unit, arm and model. */
  cells: 2,
  exposure: { pilot: { sessions: 6, min: 5 }, final: 0.8, maxGapShare: 0.1 },
  /** Decision lines, in points out of 100. */
  gain: 10,
  lookStop: 5,
  alpha: 0.05,
  look: { fraction: 0.5 },
  bundleWords: 12000,
  reply: "Go with your recommendation.",
} as const;
