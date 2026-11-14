// Copyright (c) 2026 Garry Tan. MIT License.
// Every frozen constant and quoted prompt of the design plan review eval on constructed units, grouped by area.
// Strings quoted from a preregistration are checked byte for byte against it by tests/dc/frozen.test.ts. Values marked
// BT are build-time choices from the build plan, listed in the lane README; values marked PD are pre-data clarifications.
import type { ReasonCode } from "../../src/errors/codes.ts";
import type { Arm, CellCount, CellState, ChangeKind, DcStopCode, ItemClass, LedgerItemId, Model, StopScope } from "./types.ts";

// ---- Sources and seeds

/** The frozen preregistration this lane implements. */
export const PREREG = "wiki/plans/2026-11-14-geva-527-design-review-constructed-units-prereg/README.md";
/** The earlier design prereg whose sections 4 to 6, 7's stock rows, 9's smoke rules, 10, 11 and start rules 4 and 5 it keeps. */
export const PREREG_KEPT = "wiki/plans/2026-11-09-geva-420-design-review-intentions-prereg/README.md";

/** The one seed: frame order, kind order, draws, shuffles, derangements, bootstraps, re-splits and item ids. */
export const SEED = 20261114;

// ---- Frame, file check and recipes (prereg section 3; plan section 8; Captain rulings A1 and B1)

export const FRAME = {
  topics: ["admin-dashboard", "admin-panel", "dashboard", "crm", "helpdesk", "inventory-management", "project-management", "booking-system", "invoicing", "self-hosted"],
  licenses: ["mit", "apache-2.0", "bsd-3-clause", "bsd-2-clause", "isc"],
  resultsPerQuery: 100,
  minStars: 200,
  pushedOnOrAfter: "2026-06-01",
  languages: ["TypeScript", "JavaScript", "Vue", "Svelte"],
  /** Left out when a topic's hyphen-split words hold one of these words (BT reading). */
  topicWords: ["template", "starter", "boilerplate", "uikit"],
  /** Left out when the README title's lowercase words hold one of these words. */
  titleWords: ["template", "starter", "boilerplate"],
  /** Left out when a topic's or the README title's words hold one of these pairs. */
  wordPairs: ["ui kit", "component library"],
  /** BT: at least this long between two search requests, at concurrency 1. */
  requestGapMs: 3000,
} as const;

export const FILE_CHECK = {
  frameworks: ["react", "vue", "svelte", "@angular/core"],
  componentFilesInOneFolder: 10,
  minCustomProperties: 20,
  minRoutes: 3,
} as const;

export const RECIPES = {
  /** A1: "at most 30" bounds recipe sessions; clones have their own hard limit. */
  maxSessions: 30,
  maxClones: 100,
  baseApps: 20,
  minBaseApps: 16,
  /** BT (plan Big decision 5): one session at a time on this allowance; a J1 retry is admitted on its own (R2-7). */
  session: { usd: 5, turns: 150, minutes: 45 },
  viewports: [
    [375, 812],
    [768, 1024],
    [1440, 900],
  ],
  /** PD-10: no uncaught page error within this window after load. */
  pageErrorWindowMs: 10000,
} as const;

// ---- Authoring (prereg sections 2 and 3)

export const ITEM_CLASSES: readonly ItemClass[] = ["S", "H", "R", "A", "Y"];

export const CHANGE_KINDS: Record<ChangeKind, string> = {
  k1: "a new list or table screen",
  k2: "a new form or settings flow",
  k3: "a reworked dashboard or overview",
  k4: "a new detail or record view",
  k5: "a multi-step flow such as an import, onboarding or checkout",
  k6: "a notification, inbox or activity feed",
};

/** PD-11: the words each kind's screen files are ranked by. */
export const KIND_NOUNS: Record<ChangeKind, readonly string[]> = {
  k1: ["list", "table"],
  k2: ["form", "settings"],
  k3: ["dashboard", "overview"],
  k4: ["detail", "record", "view"],
  k5: ["import", "onboarding", "checkout", "step", "wizard"],
  k6: ["notification", "inbox", "activity", "feed"],
};

export const AUTHORING = {
  itemsPerKey: 5,
  statementMaxWords: 30,
  detailMaxWords: 12,
  planWords: [350, 700],
  evidenceFiles: [5, 8],
  evidenceWords: [1200, 2000],
  contextMaxWords: 400,
  wrongWayFacts: 2,
  decoyMaxWords: 30,
  minPrimaryItems: 3,
  /** The vocabulary screen bars any run of this many words from the skill's files or the lens line. */
  vocabularyRun: 5,
  rewritesPerUnit: 1,
  /** PD-2: one fix round per unit version, read by a second audit. */
  fixRoundsPerVersion: 1,
  resendsPerReply: 1,
  /** No Claude model writes any part of a unit; GPT-6.1 Sol authors when a + r is even, Gemini 4 Argon when odd. */
  authorWhenEven: "sol",
  authorWhenOdd: "argon",
  /** The validators of steps 5 and 6, and who labels each one's block. */
  validators: { opus: "astra", sol: "opus", astra: "opus" },
  genericScreenLabellers: ["astra", "opus"],
  /** PD-11: the author's input bundle. KB read as 1,000 bytes (BT). */
  bundle: { readmeBytes: 30000, treePaths: 4000, designBytes: 60000, screenFiles: 6, screenFileBytes: 30000 },
  pilot: { units: 8, baseApps: 4, perApp: 2, maxUsdPerPassingUnit: 10 },
  transform2x: { lengthTolerance: 0.1, minFilesPerItem: 2, minKeyItems: 3 },
} as const;

/** The vocabulary screen's barred pass names, as section 3 step 3 lists them (eight, with Emotional Arc and AI Slop). */
export const VOCABULARY_PASS_NAMES = "Information Architecture, Interaction State Coverage, User Journey, Emotional Arc, AI Slop, Design System Alignment, Responsive & Accessibility, Unresolved Design Decisions".split(", ");
/** The vocabulary screen's barred words. */
export const VOCABULARY_WORDS = ["gstack", "plan-design-review", "autoplan", "office hours"] as const;

export const SETS = {
  calibration: 16,
  comparison: 64,
  maxComparisonPerApp: 4,
  reserves: 6,
  comparisonFloor: 48,
  twins: { passingPairs: 8, maxTries: 16, minPairs: 6 },
} as const;

/** Step 1: the author prompt. <kind> is replaced by the kind's words. */
export const AUTHOR_PROMPT = "You are writing a test case for reviewers of product plans. Above are a real open-source web app's README, file tree, design files and some of its screens. Change kind: <kind>. Invent one new or reworked screen of that kind that this app's team might build next, and write three things. (1) plan.md: the team's plan for the screen before building, 350 to 700 words, in the future tense: goal, users, the route and the existing endpoint or data module the screen will read, screens and flows, scope, out of scope and open questions. State at least two design decisions of your own. (2) Evidence: 5 to 8 files the team already keeps in the repository, each as a path and its text, at paths under the app's docs folder (create docs/ if it has none) that don't exist yet, each a support summary, user research notes, an analytics summary, API or backend notes, a customer requirement, earlier release notes or design notes, 1,200 to 2,000 words in all, dated before the plan. Write them as plain records of what the team knows: observations, paraphrased quotes without names, numbers and facts. No file may recommend a design or say what the new screen should do. (3) key.json: five items, one in each class. S: a loading, empty, error, success or partial state, or an edge such as long text or many records, that the screen must handle. H: what users need first, how they find or reach the next step, or a label that would mislead. R: a viewport, device, orientation or zoom level where the layout must work. A: a screen-reader, keyboard, focus, contrast or motion need. Y: an existing component, token or pattern in this app that the screen should use instead of a new one; cite its real file. Each item: {\"class\", \"statement\": an observed fact of at most 30 words naming the screen, component or flow, the file where it would be handled, and the condition, \"detail\": the specific value, threshold, component or rule the evidence fixes, at most 12 words, \"evidence\": [{\"file\", \"line\"}]}. Each item must follow from the evidence files (for Y, from the app's real code), and a reader of plan.md alone must not be able to name it: choose conditions the evidence shows and the plan doesn't hint at. Also give \"mentioned\", the items plan.md already names as something to handle (normally none), and \"wrong_way\", two facts in the evidence that point toward a plausible design change the rest of the evidence doesn't support. Invent the people, customers and numbers. Name no real person, and don't base anything on this project's real issues or history. Output one JSON object {\"plan\": ..., \"evidence\": [{\"path\", \"text\"}], \"key\": ...} and nothing else.";
/** Step 2: the context writer prompt. */
export const CONTEXT_WRITER_PROMPT = "Below are a project's README, design files and file tree with each docs file's first heading, and the plan for a change. Write a short description of the project for a reviewer of the plan: what the project does and who uses it, the screens and flows the plan touches as they stand now, and where the project keeps its design system and its product docs, with file paths. At most 400 words. Use only what the material says. Don't judge the plan or suggest anything.";
/** Step 5: the full-information opening, then plan.md, context, evidence, design files, cited files and the template. */
export const FULL_INFORMATION_OPENING = "Review the plan in plan.md for the code described below, and make it better before anyone builds it. context/project.md describes the project. The team keeps the product evidence for this plan in the files below.";
/** Step 6: the give-away opening, then plan.md, context/project.md and the template. */
export const GIVE_AWAY_OPENING = "Review the plan in plan.md and make it better before anyone builds it. context/project.md describes the project.";
/** The 2x transform prompt. */
export const TRANSFORM_2X_PROMPT = "Below are a test case's plan, evidence files and key. Rewrite only the evidence files so the case is harder to read without changing what it supports. For every key item, no single file may state its condition: split its support into two facts in two different files that together support it, neither enough alone. Add one decoy: a concern that one file raises several times about the new screen and that other files show doesn't matter for this plan, and record it in the key as \"decoy\", at most 30 words. Keep every file's path and kind, keep each file within 10% of its length and the total within 10% of its words, keep the neutral and wrong-way facts, and change nothing else. Output the evidence files and the updated key in the same JSON format.";
/** The twin note, sent with a unit moved onto the next kept base app. */
export const TWIN_NOTE = "Move this case to the app above. Keep every fact's meaning and role and every key item's class and kind of condition; change the screen, names, files, numbers and the cited components to fit this app.";

// ---- Harness (2026-11-09 section 4 and 9, kept word for word; prereg section 4)

export const GSTACK_PIN = { repo: "garrytan/gstack", commit: "b6155921a564ba9ec2470fd2cb3894c05e2c2d13", version: "1.98.0.0", install: "./setup --host claude" } as const;

export const SESSION_LIMITS: Record<Model, { usd: number; turns: number; minutes: number }> = {
  opus: { usd: 10, turns: 200, minutes: 90 },
  sol: { usd: 5, turns: 200, minutes: 90 },
  particle: { usd: 0.5, turns: 200, minutes: 90 },
};

export const HARNESS = {
  env: { CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1", CLAUDE_CODE_DISABLE_1M_CONTEXT: "1" },
  gstackEnv: { GSTACK_SESSION_KIND: "unattended" },
  deniedTools: ["WebSearch", "WebFetch"],
  mounts: ["/work/repo", "/work/plan.md", "/work/context/"],
  neverMounted: ["key.json", "unit.json"],
  /** BT (plan section 10). */
  maxSessionsAtOnce: 8,
  /** The D1 repair hook blocks a stop at most this many times. */
  maxRepairBlocks: 2,
} as const;

/** Section 4's strip, run on the export before the unit's evidence files are added. */
export const STRIP = {
  filesAnyDepth: ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", ".claude/AGENTS.md", ".mcp.json", "SKILL.md"],
  foldersAnyDepth: [".claude", ".agents", ".codex", ".cursor"],
  /** These names go whatever their type, a symlink pointing inside the tree included. */
  namesAnyType: [".claude", "CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", ".mcp.json"],
  symlinksOutsideTree: true,
} as const;

/** Ends every arm prompt before the template. */
export const COMMON_LINE = "Review the plan in plan.md for the code in /work/repo, and make it better before anyone builds it. context/project.md describes the project.";
/** What comes before the common line in each arm. */
export const ARM_LEAD: Record<Arm, string | null> = {
  none: null,
  lens: "Do a senior product designer's review of this plan.",
  "plan-design-review": "/plan-design-review plan.md",
  autoplan: "/autoplan --kind feature plan.md",
};
/** Follows the invocation in both gstack arms. */
export const FORCED_SENTENCE = "Run its whole procedure unattended, taking your recommended option at every decision.";
/** The full-information reference's opening, then each evidence file under its path, the common line and the template. */
export const REFERENCE_OPENING = "The team keeps the product evidence for this plan in these files, copied below.";
/** The closing block template every prompt ends with, after a blank line. */
export const TEMPLATE = "End your reply with one fenced block labelled plan-changes that holds a JSON object {\"changes\": [...]}: at most eight changes you would make to this plan before anyone builds it, most important first, each one string of at most 40 words. Only this block is scored.";
/** The gate hook's answer, run with the --out, --gate-rev and --rec-hash flags the pinned binary needs (plan section 10). */
export const AUTOPLAN_ANSWER = "gstack-autoplan answer --reply rec --by agent:harness";
/** The gate hook's fixed message, returned after every gate revision it answers (R2-6). */
export const GATE_MESSAGE = "The gate is answered rec. Apply the accepted changes, finish the run, then end your reply with the block.";
/** The headline label of an arm that passes its re-smoke under the D1 repair hook. */
export const ENFORCED_LABEL = "with an enforced procedure";
/** The plan-design-review detector's seven pass names in the skill's order (Emotional Arc is not one; AI Slop Risk is). */
export const DETECTOR_PASS_NAMES = "Information Architecture, Interaction State Coverage, User Journey, AI Slop Risk, Design System Alignment, Responsive & Accessibility, Unresolved Design Decisions".split(", ");
export const STATE_TABLE_HEADER = ["LOADING", "EMPTY", "ERROR", "SUCCESS", "PARTIAL"] as const;
export const DETECTOR = { minPassNames: 5 } as const;

// ---- The closing block and its parse (2026-11-09 section 5)

export const CHANGE_LIST = { maxChanges: 8, maxWords: 40, label: "plan-changes" } as const;
/** The one frozen lenient parse accepts exactly these three forms. */
export const LENIENT_FORMS = "a fence labelled otherwise, trailing commas, a bare JSON array of strings".split(", ");

/** How each cell state counts and which retry it gets (plan section 6). */
export const CELL_STATES: Record<CellState, { count: CellCount; retry: "none" | "fresh-session" | "j1" | "packet-resend"; code: ReasonCode | null }> = {
  scored: { count: "score", retry: "none", code: null },
  "scored-unexposed": { count: "score", retry: "none", code: null },
  "no-block": { count: "zero", retry: "none", code: "E_DC_NO_BLOCK" },
  "arm-stop": { count: "zero", retry: "fresh-session", code: "E_DC_ARM_STOP" },
  "gstack-read": { count: "missing", retry: "none", code: "E_DC_GSTACK_READ" },
  "web-contaminated": { count: "missing", retry: "none", code: "E_DC_WEB_CONTAMINATED" },
  "infra-missing": { count: "missing", retry: "j1", code: "E_DC_INFRA_MISSING" },
  incomplete: { count: "incomplete", retry: "none", code: null },
  "label-missing": { count: "missing", retry: "packet-resend", code: "E_DC_LABEL_MISSING" },
};

// ---- Judging and scoring (prereg sections 6 and 7; plan section 3)

/** Who labels each model's lists; particle-1 lists go to the panel. */
export const JUDGE_OF: Record<Model, "astra" | "opus" | "panel"> = { opus: "astra", sol: "opus", particle: "panel" };
export const PANEL = ["astra", "opus", "argon"] as const;

export const JUDGING = {
  productionEffort: "medium",
  checkEffort: "max",
  kappaMin: 0.6,
  goldPerClass: 40,
  goldDistinctLists: 40,
  oracleShareMax: 0.5,
  anchorWeightMax: 0.25,
  recheck: { cells: 80, perClass: 40, packets: 8, cellsPerPacket: 10, distinctLists: 20 },
  plainSubsetPerFamily: 40,
  pairwiseStockMax: 0.2,
  armGuess: { lists: 30, flagAbove: 0.7 },
} as const;

/** M3's whole-number scores: twice section 7's 1, 0.5 and 1. */
export const MATCH_SCORE = { credited: 2, detailCarried: 2, detailMissing: 1 } as const;
export const MATCH_LIMITS = { maxItems: 8, maxChanges: 8 } as const;
/** M12: every statistic is rounded to this many decimals before it meets its threshold. */
export const ROUND_DECIMALS = 4;

/** The three stock rows, word for word, judged in every packet as if they were reviews. Row 3 never screens. */
export const STOCK_ROWS = [
  {
    row: 1,
    title: "generic UI advice",
    changes: [
      "Add loading, empty and error states to every screen that fetches data.",
      "Make every new screen responsive and check it at phone, tablet and desktop widths.",
      "Meet WCAG 2.1 AA: labels on every form field, alt text on images and 4.5:1 text contrast.",
      "Make every interactive element reachable by keyboard with a visible focus ring.",
      "Use the existing design system's components, colours and spacing tokens instead of custom styles.",
      "Give each screen one clear primary action and a visible way back.",
      "Show clear error messages next to the field or action that failed.",
      "Handle long names, missing images and zero results without breaking the layout."
    ]
  },
  {
    row: 2,
    title: "generic process advice",
    changes: [
      "Make wireframes or mockups of every new screen before building.",
      "Run a usability test with five users before launch.",
      "Get design sign-off from the product owner before implementation.",
      "Write a design spec that covers every screen and interaction.",
      "Add visual regression tests for the new screens to CI.",
      "Test the feature on real phones and browsers before release.",
      "Run an automated accessibility audit such as axe in CI.",
      "Document the new components in the design system or Storybook."
    ]
  },
  {
    row: 3,
    title: "the skill's own checklist (never used to screen)",
    changes: [
      "Add a table of loading, empty, error, success and partial states for each feature, saying what the user sees in each.",
      "Define what the user sees first, second and third on each screen, with one primary action.",
      "Add a storyboard of the user's journey: what they do and feel at each step.",
      "Specify each viewport's layout, not just \"stacked on mobile\".",
      "Specify keyboard paths, ARIA landmarks, 44-pixel touch targets and contrast.",
      "Use the tokens and components in DESIGN.md and check each new component against them.",
      "Replace generic patterns (three-column icon grids, gradients, everything centered) with specific choices.",
      "Make empty states features, with warmth, a primary action and context."
    ]
  }
] as const;

export const STOCK = { stage1MaxUnits: 2, stage1Units: 16, stage2MaxShare: 1 / 8 } as const;

// ---- Readings (prereg sections 9, 10 and 12)

export const PASSES = {
  stage1: {
    baseNone: { opus: 3, sol: 2, particle: 2 },
    baseReference: { opus: 3, sol: 2, particle: 2 },
    baseLens: { opus: 3, sol: 1, particle: 1 },
    none2x: { opus: 3, sol: 1, particle: 1 },
    reference2x: { opus: 2, sol: 0, particle: 0 },
    twinsOpusNone: 3,
    smokeSessions: 6,
    smokeUnits: 6,
  },
  stage2: { opus: 2, sol: 1, particle: 1 },
} as const;

export const TIERS = {
  base: { noneMax: 0.65, referenceMin: 0.3, roomMin: 0.15, noneLowPrint: 0.1 },
  x2: { noneMax: 0.6, referenceMin: 0.3, roomMin: 0.15, minUnits: 12, budgetAnchor: [0.8, 1.25], kLabel: [1.6, 2.7] },
  x10: { g: [0.25, 0.5], dMax: 0.2, gRoomMin: 0.15, minDetailUnits: 12 },
} as const;

export const READS = {
  parseMin: 0.95,
  missingMax: 0.1,
  contaminationMax: 0.05,
  exposureMin: 0.8,
  interimStop: { afterSessions: 24, exposureMin: 0.7 },
  smoke: { parseMin: 5, exposureMin: 5, of: 6 },
  lensParseMin: 0.95,
  twin: { interval: 0.9, band: 0.1, resplitPercentile: 0.95, passesPerSkin: 3 },
  alpha: 0.05,
  interval: 0.95,
  draws: 10000,
  exactSignFlipMaxClusters: 20,
  framingBound: 0.05,
  admission: { power: 0.8, lift: 0.12, p0Floor: 0.05, icc: 0.5, alphaFirstStep: 0.025 },
} as const;

/** KEEP's wording for a gstack arm on a model. */
export const KEEP_WORDING = "its plan changes name more of the design decisions the product's own evidence supports";
/** The 10x tier's saturation reading. */
export const SATURATION_WORDING = "plain Opus already writes in the design decisions its product's evidence supports, even split across files and next to a decoy";
/** The 10x tier's saturation (detail) reading. */
export const SATURATION_DETAIL_WORDING = "plain Opus already reaches too many of the evidence's specific values for the 10x read";

// ---- Money (prereg section 13; plan section 5 with R2-3, R2-7 and R2-20)

export interface LedgerItemSpec {
  capUsd: number;
  projectionUsd: number;
  /** False only for crew, which thread counters report. */
  leased: boolean;
  /** How the item admits work. */
  admission: { kind: "sessions"; perRound: number; allowanceUsd: number; reserveUsd: number } | { kind: "direct"; maxInFlight: number } | { kind: "vms" } | { kind: "none" };
}

const direct = { kind: "direct", maxInFlight: 8 } as const;

/** The 17 items. Session reserves are every session in the round at full allowance, twice over for the one retry. */
export const LEDGER_ITEMS: Record<LedgerItemId, LedgerItemSpec> = {
  "dc-base-apps": { capUsd: 95, projectionUsd: 72, leased: true, admission: { kind: "sessions", perRound: 1, allowanceUsd: 5, reserveUsd: 5 } },
  "dc-gate-check": { capUsd: 25, projectionUsd: 20, leased: true, admission: direct },
  "dc-authoring-1": { capUsd: 170, projectionUsd: 127, leased: true, admission: direct },
  "dc-authoring-2": { capUsd: 330, projectionUsd: 269, leased: true, admission: direct },
  "dc-authoring-3": { capUsd: 140, projectionUsd: 0, leased: true, admission: direct },
  "dc-stage1-opus": { capUsd: 215, projectionUsd: 170, leased: true, admission: { kind: "sessions", perRound: 2, allowanceUsd: 10, reserveUsd: 40 } },
  "dc-stage1-sol": { capUsd: 115, projectionUsd: 92, leased: true, admission: { kind: "sessions", perRound: 2, allowanceUsd: 5, reserveUsd: 20 } },
  "dc-stage1-particle": { capUsd: 12, projectionUsd: 9, leased: true, admission: { kind: "sessions", perRound: 2, allowanceUsd: 0.5, reserveUsd: 2 } },
  "dc-stage2-opus": { capUsd: 840, projectionUsd: 749, leased: true, admission: { kind: "sessions", perRound: 4, allowanceUsd: 10, reserveUsd: 80 } },
  "dc-stage2-sol": { capUsd: 385, projectionUsd: 337, leased: true, admission: { kind: "sessions", perRound: 4, allowanceUsd: 5, reserveUsd: 40 } },
  "dc-stage2-particle": { capUsd: 42, projectionUsd: 37, leased: true, admission: { kind: "sessions", perRound: 4, allowanceUsd: 0.5, reserveUsd: 4 } },
  "dc-judges": { capUsd: 520, projectionUsd: 491, leased: true, admission: direct },
  "dc-stage3-authoring": { capUsd: 185, projectionUsd: 174, leased: true, admission: direct },
  "dc-stage3-builds": { capUsd: 210, projectionUsd: 144, leased: true, admission: { kind: "sessions", perRound: 2, allowanceUsd: 15, reserveUsd: 60 } },
  "dc-stage3-reads": { capUsd: 165, projectionUsd: 146, leased: true, admission: direct },
  "dc-hosts": { capUsd: 80, projectionUsd: 70, leased: true, admission: { kind: "vms" } },
  crew: { capUsd: 470, projectionUsd: 450, leased: false, admission: { kind: "none" } },
};

/**
 * PD-14 (Captain, 2026-11-14, before any outcome data): crew's cap rises from the frozen $470 to $700, under the rule
 * that the lines are guidelines. Crew spend up to $700 never counts against the $3,999 line, so it triggers no stage 2
 * cut; past $700 it counts as before. The pre-stage-2 projection rerun still runs, and the $5,000 stop reads every dollar.
 */
export const CREW_DEVIATION = { capUsd: 700, frozenCapUsd: 470, ruled: "2026-11-14" } as const;

export const MONEY = {
  capAllInUsd: 3999,
  projectionStopUsd: 5000,
  /** dc-authoring-3's projection when a harder tier is admitted; it is released, unleased, when the base tier admits. */
  authoring3IfRunUsd: 123,
  /** Oracle builds run one at a time inside dc-stage3-authoring against this reserve. */
  oracleBuildReserveUsd: 30,
  /** Planning figures per session until the smoke measures them; Sol about 0.9 times Opus, particle-1 about a tenth. */
  planningOpusUsd: { none: 0.4, lens: 0.45, "plan-design-review": 2.5, autoplan: 2.5, reference: 0.5 },
  planningSolFactor: 0.9,
  planningParticleFactor: 0.1,
  planningBuildUsd: 1.5,
  planningRecipeUsd: 3,
  /** BT (plan L1): output caps in tokens; every resend doubles its cap. */
  outputCaps: { author: 24000, translation: 24000, contextWriter: 6000, audit: 16000, validatorBlock: 8000, validatorLabels: 12000, genericScreenLabels: 12000, transform2x: 16000, productionLabels: 16000, judgeCheck: 24000, pairwise: 4000, probe: 4000 },
  /** The frozen cut order when the projection rerun doesn't fit. */
  cutOrder: ["stage 3 down to 12 units", "Sol's lens cells in stage 2", "comparison units down to 48", "Opus's second pass on the gstack arms"],
} as const;

/** Plan L5 (PD-13) with R2-3's dc-hosts row. A recorded cap stop closes its whole item (R2-20). */
export const STOP_SCOPES: Record<DcStopCode, StopScope> = {
  E_DC_EXPOSURE_STOP: { stops: "arm-on-model", unless: null, keepsRunning: "the other arms on that model; every other model", ledger: "that arm's sub-reservations settle and its unrun ones release; the shared round and stage leases stay open" },
  E_DC_SMOKE_DROP: { stops: "arm-on-model", unless: null, keepsRunning: "the other arms on that model; every other model", ledger: "that arm's sub-reservations settle and its unrun ones release; the shared round and stage leases stay open" },
  E_DC_JUDGE_KAPPA: { stops: "model-contrasts", unless: { reach: "eval", when: "on Opus lists in stage 1" }, keepsRunning: "the other models' sessions and labels, unless the eval ends", ledger: "that model's sub-reservations settle and its unrun ones release; dc-judges stays open for the rest" },
  E_DC_STOCK_FAIL: { stops: "model-contrasts", unless: { reach: "eval", when: "on Opus lists in stage 1" }, keepsRunning: "the other models' sessions and labels, unless the eval ends", ledger: "that model's sub-reservations settle and its unrun ones release; dc-judges stays open for the rest" },
  E_DC_NO_READ: { stops: "eval", unless: null, keepsRunning: "nothing", ledger: "every open lease settles" },
  E_DC_TWIN: { stops: "eval", unless: null, keepsRunning: "nothing", ledger: "every open lease settles" },
  E_DC_PROVIDER_DRIFT: { stops: "model-calls", unless: null, keepsRunning: "outputs finished before the drift; work that doesn't call that model and doesn't read its pending outputs", ledger: "that model's sub-reservations settle; nothing on it resumes without the Captain" },
  E_DC_SUPPLY_SHORT: { stops: "authoring", unless: null, keepsRunning: "nothing that depends on authoring", ledger: "the authoring and base-app leases settle" },
  E_DC_AUTHOR_COST: { stops: "authoring", unless: null, keepsRunning: "nothing that depends on authoring", ledger: "the authoring and base-app leases settle" },
  E_DC_GATE_CHECK: { stops: "authoring", unless: null, keepsRunning: "nothing that depends on authoring", ledger: "the authoring and base-app leases settle" },
  E_DC_SANDBOX_AUDIT: { stops: "stage3", unless: { reach: "base-app-screen", when: "the hit is in a recipe VM" }, keepsRunning: "the rest", ledger: "the stopped stage's leases settle" },
};

export const CAP_STOP_SCOPE: { item: StopScope; hosts: StopScope } = {
  item: { stops: "item", unless: null, keepsRunning: "other items", ledger: "that item's lease settles and the item closes" },
  hosts: { stops: "every-stage", unless: null, keepsRunning: "nothing", ledger: "every open lease settles" },
};

// ---- Stage 3 (prereg section 11 and 2026-11-09 section 11)

export const STAGE3 = {
  maxUnits: 16,
  minUnits: 8,
  cutUnits: 12,
  buildArms: 6,
  build: { usd: 15, turns: 250, minutes: 120 },
  buildsAtOnce: 2,
  oracleBuildsPerUnit: 2,
  scenarios: 3,
  agentUserSteps: 25,
  des4InstrumentMin: 0.7,
  forcedStateLoadingMs: 1500,
  minTouchTargetPx: 44,
  overflowWidths: [375, 768],
} as const;

/** The generic-look control's frozen stock block. */
export const GENERIC_LOOK_BLOCK = "Style any new screen the way most AI-built apps look: a centered layout, a purple-to-blue gradient header, a grid of three cards each with an icon in a coloured circle, large rounded corners on everything, and the system font stack.";
/** The build prompt, then the block. */
export const BUILD_PROMPT = "Implement the plan in plan.md in /work/repo. A reviewer's notes on the plan follow; use them as you see fit.";
