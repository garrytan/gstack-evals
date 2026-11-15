// Copyright (c) 2026 Garry Tan. MIT License.
// Constants the readings part needs that the shared frozen.ts does not hold yet (prereg
// 2026-11-15-geva-537-eng-review-planted-units-prereg). Each one cites its plan section; the integrator folds them into
// frozen.ts or types.ts.
import type { SkillArm } from "../types.ts";

/** Section 9: the two skill-arm families, in print order. */
export const SKILL_ARMS: readonly SkillArm[] = ["standalone", "engphase"];

/** Section 2, rule 2, and section 5 (reach): the per-run case classes that count as a scorable failure. "assert" is the
 * lane's assertion class; "crash" is a runtime error raised in a product file, the class the planted grader records. */
export const SCORABLE: ReadonlySet<string> = new Set(["assert", "crash"]);

/** Sections 5 and 8: the judge and the two gold labellers, each at high effort and blind to arm. */
export const JUDGE_MODELS = {
  judge: "openai/gpt-6-astra",
  gold: ["anthropic/claude-opus-5-5", "google/gemini-4-carbon"],
  effort: "high",
} as const;

/** Section 8: the gold set's quotas. 12 smoke skill reviews, the first 10 comparison reviews of each skill arm, 12 pilot
 * plain reviews, and at least 2 stock and 2 plan-only bundles, so at least FROZEN.judge.minGold (48). The keyword proxy
 * aims each quota at 40% likely positives, inside the 30% to 50% band. */
export const GOLD = { smoke: 12, comparisonPerSkillArm: 10, pilotPlain: 12, stock: 2, plan: 2, proxyTarget: 0.4 } as const;

/** Section 8: the quick keyword match. A bundle holds the hint when at least half of the hint's content words (4 or more
 * letters, not a stop word) appear in it. The same rule matches a credited quote to a generic-list entry (section 5). */
export const KEYWORD = { minLetters: 4, share: 0.5 } as const;

/** Section 5: arm and package names stripped from every bundle the judge or a labeller reads. */
export const ARM_NAMES: readonly RegExp[] = [/\/?plan-eng-review\b/gi, /\bautoplan\b/gi, /\bgstack[\w-]*/gi, /\bGSTACK_[A-Z_]+\b/g, /\beng[ -]?phase\b/gi, /\bstandalone\b/gi];

/** Section 5: the bundle headings a credited quote maps to, first keyword match wins, else "other". */
export const SECTION_MAP: ReadonlyArray<readonly [string, RegExp]> = [
  ["coverage diagram", /coverage|diagram|code path/i],
  ["failure modes", /failure|edge case|error|risk/i],
  ["test plan", /test/i],
  ["architecture", /architecture|design|data flow|interface/i],
];

/** Section 9: region-size strata, in stubbed lines (the region is 10 to 300 lines by section 2). */
export const REGION_BINS: ReadonlyArray<readonly [string, number, number]> = [
  ["region 10-29 lines", 0, 29],
  ["region 30-99 lines", 30, 99],
  ["region 100-300 lines", 100, Number.POSITIVE_INFINITY],
];

/** Section 12: a cap sits at about 1.2 times its projection; the content raise's projection prints with one. */
export const CAP_FACTOR = 1.2;
