// Copyright (c) 2026 Garry Tan. MIT License.
// The review-models eval's frozen scoring constants (wiki/plans/2026-11-24-geva-590-review-models-prereg, sections 4, 7
// and 8, the judge check and the interim look, as pre-run change 1 amends them), and the part's refusal helper. Every
// refusal message starts with its reason code.
import type { ReasonCode } from "../../../src/errors/codes.ts";

export class RmError extends Error {
  constructor(readonly code: ReasonCode, message: string) {
    super(code + " " + message);
  }
}
export const rmFail = (code: ReasonCode, message: string): never => {
  throw new RmError(code, message);
};

export const ARMS = ["OS", "OA", "FS", "FA", "N"] as const;
export type Arm = (typeof ARMS)[number];
export type Pool = "P" | "B" | "decoy";

/** Section 4: the judge, as the route names it and as src/runner/pricing/prices.ts keys it, pinned to google-vertex. */
export const CARBON = { route: "openrouter/google/gemini-4-carbon", model: "google/gemini-4-carbon", pin: "google-vertex" } as const;
/** The judge check's two labellers (fix-aware, blind to arm), by provider route. */
export const LABELLERS = {
  opus: { model: "anthropic/claude-opus-5-5", provider: "anthropic", api: "claude-opus-5-5" },
  astra: { model: "openai/gpt-6.2-astra", provider: "openai", api: "gpt-6.2-astra" },
} as const;

/** Decision rule C1: dollars per extra catch. */
export const VALUE_PER_CATCH = 25;
/** Section 4's location hit: a cited line within this many lines of a changed hunk of the real fix. */
export const LOCATION_WINDOW = 3;
/** Section 8: the clustered bootstrap behind every standard error. */
export const BOOTSTRAP = { seed: 20261124, draws: 10_000 };
/** Change 1 item 4: z for "doesn't pay" at the look, for "pays" and "doesn't pay" at the end, and for printed intervals. */
export const Z = { look: 2.797, end: 1.655, interval: 1.96 };
/** Section 5 and section 6: an arm reads "untested" past these shares. */
export const CONTAMINATED_MAX = 0.1;
export const EXPOSED_MIN = 0.9;
/** The judge check as change 1 item 1 sets it, and the pilot's per-arm judge errors (pilot table). */
export const JUDGE_CHECK = { kappa_min: 0.6, labels_min: 100, per_arm_min: 20, pilot_errors_max: 2 };
/** Change 1 item 3: Harness Evals' per-pass stage 1 CSV, never committed, read by path and bound by its digest. */
export const HISTORY = { sha256: "fae7595bafb1016b3c91fd66f4c0091f9dc6706c7375398aaf71b93973aff6a3", units: 54, stratum: "outside_bug", arm: "gstack_review" };
