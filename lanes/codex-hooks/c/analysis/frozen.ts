// Copyright (c) 2026 Garry Tan. MIT License.
// Frozen values of part C's judging and analysis: the preregistration's sections 1, 5.3 to 5.5, 9, 10 and 11, and pre-run
// change 1 section 8. Each value names where it comes from. Nothing here calls a model.
import { join } from "node:path";
import { PREREG, REPO } from "../../pins.ts";

export const ARMS = ["c-on", "c-off", "c-high", "c-none"] as const;
export type CArm = (typeof ARMS)[number];
export const STATES = ["first_stop", "final"] as const;
export type CState = (typeof STATES)[number];

/** R2's suite, stacks-r1 (section 5.1): 33 units, 42 blocking bugs on 26 pull-request clusters. */
export const SUITE = { path: join(REPO, "wiki/plans/2026-10-31-geva-76-stacks-round-1-prereg/stacks-r1.json"), sha256: "4f46bb17b7ef98a34db9bf4b03c69755c694eb17dfc7ca0e29e1049a1bcc9a1d", units: 33, bugs: 42, clusters: 26 } as const;
/** #108's judge brief (section 5.5), sent with every matching and adjudication request. */
export const BRIEF = { path: join(REPO, "wiki/plans/2026-10-31-geva-76-stacks-round-1-prereg/judge-brief.md"), sha256: "ef33d5ca0f802e49e18d1f3e4b16f989bcbd48fa4c46f339bc0533dfb1364427" } as const;
/**
 * R2's severity maps (section 5.3). R2's after-pin file keeps stacks round 1's severity-map.json, adds title-case and
 * P-label rows to its none entry and adds the gstack-full entry. The gstack arms read gstack-full; c-none reads none.
 */
export const SEVERITY_MAP = { path: join(REPO, "wiki/plans/2026-11-03-geva-255-r2-after-pin-amendment/severity-map.rr2.json"), sha256: "80dbac1d3e66d64e38255137f84d630c66b75b44e89fbdc2792619a26cd4178b" } as const;
export const SEVERITY_ENTRY: Readonly<Record<CArm, string>> = { "c-on": "gstack-full", "c-off": "gstack-full", "c-high": "gstack-full", "c-none": "none" };
/** power.txt as the preregistration attaches it. */
export const POWER_TXT = { path: join(REPO, PREREG, "power.txt"), sha256: "37ddae4adf8800bc0f85413fcec1bde201d831d62706bc635e793cda10e21222" } as const;

/** The seed of the bootstrap, the packet order and the confirmation draw (sections 5.4, 5.5 and 9). */
export const SEED = 20261119;
/** R2's pull-request-clustered bootstrap: 10,000 resamples (section 5.4). */
export const DRAWS = 10_000;
export const ALPHA = 0.05;
/** Counted runs: 2 passes per unit and arm, so 66 sessions and 84 bug-passes per arm (section 5.1). */
export const PASSES = 2;
export const SESSIONS_PER_ARM = 66;
export const BUG_PASSES = 84;
/** The sign-flip test enumerates every flip over the clusters whose sum is not 0, at most 2^26 (section 5.4). */
export const MAX_SIGN_FLIP_CLUSTERS = 26;
/** A state's counted findings: the first 15 of its last fenced json block (section 5.3). */
export const COUNTED_FINDINGS = 15;
/** An arm with more than 7 of its 66 sessions not scored reads INCOMPLETE (section 5.8). */
export const INCOMPLETE_ABOVE = 7;
/** The contract table's ceiling row: the contract blocked in fewer than 7 of 66 c-on sessions (section 1). */
export const BLOCKED_AT_LEAST = 7;
/** The contract table's false-block row: false blocks in more than 5% of c-on sessions (sections 1 and 5.6). */
export const FALSE_BLOCK_SHARE = 0.05;
/** The CUT-CANDIDATE bar in points, kept after check A's swap (section 1; pre-run change 1, section 8). */
export const CUT_BAR_POINTS = 11.5;

/** power.txt's numbers (section 10). tests/codex-hooks/c/analysis/power.test.ts reads them from the file; nothing re-derives them. */
export const POWER = {
  contract_within: [
    { losses_pct: 0, mdd_points: 11.5 },
    { losses_pct: 2, mdd_points: 15.0 },
    { losses_pct: 5, mdd_points: 18.5 },
  ],
  between_arms: [
    { disagree_pct: 10, mdd_points: null },
    { disagree_pct: 20, mdd_points: 15.5 },
    { disagree_pct: 30, mdd_points: 19.0 },
    { disagree_pct: 40, mdd_points: 22.0 },
  ],
  design_effect: 1.2,
  effective_pairs: 70,
  obrien_fleming: { interim_z: 2.797, final_z: 1.977 },
} as const;

/** The judges (section 5.5). Route A is the plan. Route B is the fallback after a failed check, with Gemini 4 Carbon as the primary. */
export const ROUTES = {
  A: { primary: "anthropic/claude-opus-5-5", second: "openrouter/google/gemini-4-carbon", third: "anthropic/claude-sonnet-5-5" },
  B: { primary: "openrouter/google/gemini-4-carbon", second: "anthropic/claude-opus-5-5", third: "anthropic/claude-sonnet-5-5" },
} as const;
export type RouteName = keyof typeof ROUTES;
/** The gold labellers. Gold labels are the items where both agree, each labelling blind from the same packet and brief. */
export const GOLD = ["openai/gpt-6.2-astra", "openrouter/google/gemini-4-argon"] as const;
/** R2's second-read sample of the rest (SECOND_SAMPLE in lanes/review-noloss/judge.ts). */
export const SECOND_SAMPLE = 0.2;

/** The judge check (section 5.5): kappa of at least 0.6 on at least 40 gold items with at least 10 in each class. */
export const CHECK = {
  kappa: 0.6,
  min_items: 40,
  min_class: 10,
  anchors_max_share: 0.3,
  /** A near miss sits in the bug's file at least 30 lines from it; the harness puts it 40 lines away. */
  near_miss_offset: 40,
  near_miss_min_offset: 30,
  confirm_items: 40,
  confirm_per_label: 20,
} as const;

/** The judge ledger item (section 11). One run id spends from it across the pilot check, the counted judging and the confirmation. */
export const JUDGE_ITEM = { item: "geva-562-judge", central_usd: 55, cap_usd: 80, what: "matching, adjudication, second and third reads, key-blind extraction, and gold labels for both checks" } as const;

/** Per-session allowances (section 5.7): a pilot 95th percentile above half of one doubles its part's allowances. */
export const ALLOWANCE_USD: Readonly<Record<CArm, number>> = { "c-on": 8, "c-off": 8, "c-high": 15, "c-none": 8 };

/**
 * R113 (section 10): no interim look unless the pilot's re-pricing puts the counted run above $500. Part C's counted run
 * is c-main, h-main and judging, $490 at planning prices. The VM shares are the parts of c-main's $234 and h-main's $201
 * that the planned session prices do not explain (198 sessions at $1.50, $1.50 and $0.40; 66 at $3.00).
 */
export const R113 = { threshold_usd: 500, planned_usd: 490, vm_usd: 12.6, judge_usd: 55, futility_conditional_power: 0.1 } as const;
