// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's cross-cutting frozen values (prereg wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg
// and its dated pre-run changes). Strings quoted in the prereg or a pre-run change appear there byte for byte, and
// tests/ohr/frozen.test.ts checks each one against those posts. Area-specific frozen text (author prompts, the judge
// prompt, detector markers) lives in its area and is listed in the lane README as a build-time choice.
import type { ArmId, BuilderGoal, FounderType, JudgeKey, ModelId, SkillArm } from "./types.ts";

export const PREREG = "wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg/README.md";
export const CHANGE_1 = "wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-1/README.md";
export const CHANGE_2 = "wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-2/README.md";

/** Every seeded draw, order and sample in the eval (pre-run change 1, item 5). */
export const SEED = 20261117;

/** Section 4 step 1 and pre-run change 1, item 4c: each arm's first message, byte for byte. */
export const LENS_LINE = "Act as a YC partner holding office hours with me.";
export const SKILL_PREFIX = "/office-hours ";
export const firstMessage = (arm: ArmId, opening: string): string => (arm === "none" ? "" : SKILL_PREFIX) + LENS_LINE + "\n\n" + opening.trim();

/** Section 4 step 4 and pre-run change 1, item 4c: the closing message, sent at most twice. */
export const CLOSING = "I need to stop here. Please end your reply with exactly these three lines, filled in:\nDECISION: what I should do.\nNEXT ACTION: one thing, who and by when.\nWHY: up to three facts from our talk.";
export const CLOSING_SENDS = 2;
export const BLOCK_LABELS = ["DECISION", "NEXT ACTION", "WHY"] as const;
/** Section 5: a script cuts each block line at 40 words before any judge sees it. */
export const BLOCK_WORDS = 40;

/** Section 4 step 5's limits, from the founder lane. */
export const FOUNDER_REPLIES = 20;
export const AGENT_TURNS_PER_REPLY = 60;
export const SESSION_MINUTES = 120;
export const CONTEXT_TOKENS = 200_000;
export const SESSION_RETRIES = 1;
export const DENIED_TOOLS = ["WebSearch", "WebFetch", "AskUserQuestion"] as const;

/** Section 4 step 2: left unset in every arm's environment, and set in every arm's environment. */
export const ARM_ENV_UNSET = ["GSTACK_SESSION_KIND", "OPENCLAW_SESSION", "GSTACK_HEADLESS", "CI", "GITHUB_ACTIONS"] as const;
export const ARM_ENV: Readonly<Record<string, string>> = { CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" };
export const SESSION_KIND_LINE = "SESSION_KIND: interactive";

/**
 * Section 2's pins. current is the commit the content change is built on, its merge base with gstack main (pre-run
 * change 1, item 1, confirmed by pre-run change 2). new is the content change's ready head (pre-run change 2). Both
 * check the same helper paths; bin/gstack-design-doc-find at the current pin comes from change 2, section 1. VERSION is
 * 1.100.0.0 at both commits, so only the file hashes tell the pins apart; each container checks every one.
 */
export interface Pin {
  sha: string;
  version: string;
  files: Readonly<Record<string, string>>;
}
export const GSTACK_REPO = "garrytan/gstack";
export const PINS: Readonly<Record<SkillArm, Pin | null>> = {
  current: {
    sha: "fc5c285035b58ce0552d25cf7cb71749795b6d30",
    version: "1.100.0.0",
    files: {
    "office-hours/SKILL.md": "0e898ac8d2eb8bf022ef9b344a29c93d1fb0139f2e93afd7ff7fd34ddfc27963",
    "office-hours/SKILL.md.tmpl": "7779f7336ae38965380545c3c973a06cee176ae5ce3f17d53ebe1548ecbf4d51",
    "office-hours/sections/design-and-handoff.md": "b861eeaf809c9350b217cf1f5db9b9752631ef83a5f211f163ad1eaeac318dce",
    "office-hours/sections/design-and-handoff.md.tmpl": "ca552fffff409e5cd17da2029b2e5b8e88e6b40c08ea0290cb7c00e8419bb2a0",
    "office-hours/sections/manifest.json": "91f8b0520d105f44de04f348392c96cafaf53947c5d8b07f8bac2b5855a709c5",
    "office-hours/sections/phase-2a-startup-diagnostic.md": "35ed1e419eca359e454b9f18dddcce0aeb553a0ee519a7e635f4f0b7d484a393",
    "office-hours/sections/phase-2a-startup-diagnostic.md.tmpl": "b1867ed9a84ff5a2698b59490fe2b437af1b6193385ccf23aa0b9cc5be5afc08",
    "office-hours/sections/phase-2b-builder-brainstorm.md": "05251d190b32f1da63165e8339211404963556ef5b9cf4c3e46361cbc51027e2",
    "office-hours/sections/phase-2b-builder-brainstorm.md.tmpl": "604794b75cb79230ce728a70cab9bf02747cb2deafbcd6899ade0c39bc550f3e",
    "office-hours/sections/preamble.md": "188d404f839d5abb390dd96f716fa965a0d8b2d2a40619fd2ff75f4d6ba7f001",
    "office-hours/sections/second-opinion.md": "0ef8cc1c5ce9e614b1ea7d0fadce66128c43855c48d50104898900fb7590aa62",
    "office-hours/sections/second-opinion.md.tmpl": "c5714e290efb8b2a117f79c180d01595e6c2445860dbff70beaad0d3359070a4",
    "office-hours/sections/visual-design.md": "fdd31b99d7f19fbe08d7d2407112f81e1a242f4d90d321e69007e15633378595",
    "office-hours/sections/visual-design.md.tmpl": "98e49e16af227c7199dc3e4b84790f2aef22a857b20563dfe2f2a1625c9d2b30",
    "bin/gstack-builder-profile": "11e99f40f65190986b6c95a93db9058b16e9556227e23f99adf03a9f915b9ae7",
    "bin/gstack-design-doc-find": "78823ce7660281ed57e20f91bf9b84bf8bb7365d00eb02bc09ba964758358f7b",
    "bin/gstack-developer-profile": "d7a3d1dd787658f0c018075d40b41c3830e7b44622c019beaa61b4ceee43f4f8",
    "bin/gstack-founder-resources": "ba9d03881e6edf087b84b4c45868a2bd9b3cdc6b1483f7917fdede5ed8ef97cb",
    "bin/gstack-session-kind": "408a168892c0f088accfc580c08b294724edd826db31436d655e76dacec8ce90",
    "bin/gstack-skill-start": "22ddd3eac3aa605a928551664b4c96c1215debefbd57097b2580db275f1ff7a0",
    "lib/founder-resources.ts": "788aa18d9ae400d6ab81ad51126030be8869ffb66001f28ccb68d906aadb37ad",
    },
  },
  new: {
    sha: "4afa7f2b3e291758f6a7842dd066cde22606fca1",
    version: "1.100.0.0",
    files: {
      "office-hours/SKILL.md": "8ff8e76098282f8a526aeb78640b975241db8fe0c0c557ac149075ed6c8f78ff",
      "office-hours/SKILL.md.tmpl": "791e0793abae78ce2c7e847e85b32b60f22cd0b5d4b0d42edaece4375489fc03",
      "office-hours/sections/design-and-handoff.md": "445b87a9cc6b949c37ed2517dc0e2ed321035486a1e01dd8e1c63eab9e8951a8",
      "office-hours/sections/design-and-handoff.md.tmpl": "573730dcbbb4b8af473d4972657a300335644d450919cf469fa124d9417d4468",
      "office-hours/sections/landscape.md": "6c70b6eaac271fc27951268dd8062b6ec3b1d502b4ef6b9ddb690c3d24419c61",
      "office-hours/sections/landscape.md.tmpl": "b051290a583a1f8e5545f00beec57126b22120e869186615ead83abe8750ed09",
      "office-hours/sections/manifest.json": "17b6d1a986189272b5f7715d4d603952d8170f79ee4cf6679a62b4f5de591fcb",
      "office-hours/sections/phase-2a-startup-diagnostic.md": "003fe35de1cef3e984ef3bb63250d35c3b1c806968adebf1ab502577fdca20db",
      "office-hours/sections/phase-2a-startup-diagnostic.md.tmpl": "fd07f7d132f4905824097b4954c1f3eecf89bf7f85ea258f44e9cd16fd9c1c13",
      "office-hours/sections/phase-2b-builder-brainstorm.md": "05251d190b32f1da63165e8339211404963556ef5b9cf4c3e46361cbc51027e2",
      "office-hours/sections/phase-2b-builder-brainstorm.md.tmpl": "604794b75cb79230ce728a70cab9bf02747cb2deafbcd6899ade0c39bc550f3e",
      "office-hours/sections/phase-2c-pivot-discovery.md": "58dde49ca9f8bc81d23dd36213a4f782c783cc71ef6885f2c5f1ff7824a2e32f",
      "office-hours/sections/phase-2c-pivot-discovery.md.tmpl": "c7326044be0065f77ba6a51b9a2c9737bf03e1e725a0b556abc8cefb0a5d4891",
      "office-hours/sections/preamble.md": "188d404f839d5abb390dd96f716fa965a0d8b2d2a40619fd2ff75f4d6ba7f001",
      "office-hours/sections/second-opinion.md": "0ef8cc1c5ce9e614b1ea7d0fadce66128c43855c48d50104898900fb7590aa62",
      "office-hours/sections/second-opinion.md.tmpl": "c5714e290efb8b2a117f79c180d01595e6c2445860dbff70beaad0d3359070a4",
      "office-hours/sections/visual-design.md": "fdd31b99d7f19fbe08d7d2407112f81e1a242f4d90d321e69007e15633378595",
      "office-hours/sections/visual-design.md.tmpl": "98e49e16af227c7199dc3e4b84790f2aef22a857b20563dfe2f2a1625c9d2b30",
      "bin/gstack-builder-profile": "11e99f40f65190986b6c95a93db9058b16e9556227e23f99adf03a9f915b9ae7",
      "bin/gstack-design-doc-find": "e7e2fc8cca965453303f7c3a9104d20ec4c1c9fbcf6672dd86a7c141c7e39951",
      "bin/gstack-developer-profile": "0320009508bae043a9d5dce5082a26e294698257f89cc63bbcf5a103ebf5f905",
      "bin/gstack-founder-resources": "ba9d03881e6edf087b84b4c45868a2bd9b3cdc6b1483f7917fdede5ed8ef97cb",
      "bin/gstack-session-kind": "408a168892c0f088accfc580c08b294724edd826db31436d655e76dacec8ce90",
      "bin/gstack-skill-start": "22ddd3eac3aa605a928551664b4c96c1215debefbd57097b2580db275f1ff7a0",
      "lib/founder-resources.ts": "788aa18d9ae400d6ab81ad51126030be8869ffb66001f28ccb68d906aadb37ad",
    },
  },
};

export const ARMS: readonly ArmId[] = ["none", "current", "new"];
/** Section 2: Opus 5.5 and Sol decide; particle-1 is descriptive. */
export const MODELS: readonly ModelId[] = ["opus", "sol", "particle"];
export const PRIMARY_MODELS: readonly ModelId[] = ["opus", "sol"];
export const MODEL_KEYS: Readonly<Record<ModelId, string>> = { opus: "claude-opus-5-5", sol: "openai/gpt-6.1-sol", particle: "particle-ai/particle-1" };

/** Section 5: GPT-6.2 Astra labels Opus blocks; Opus 5.5 labels Sol and particle-1 blocks. One label at medium effort. */
export const JUDGE_FOR: Readonly<Record<ModelId, JudgeKey>> = { opus: "astra", sol: "opus", particle: "opus" };
export const JUDGE_MODEL_KEYS: Readonly<Record<"astra" | "opus", string>> = { astra: "openai/gpt-6.2-astra", opus: "claude-opus-5-5" };
export const JUDGE_EFFORT = "medium";
export const GOLD_EFFORT = "max";

/** Section 4 step 3: the four rules this plan adds to the founder lane's repaired simulator rules (rules 11 to 14 in item 4e's files). */
export const SIM_ADDED_RULES = [
  "Answer from the fact sheet whenever it covers the question, the goal or mode question included. Otherwise take the option the adviser marks as recommended.",
  "Decline optional extras in one line: a second opinion, founder resources, starting another review, a YC application.",
  "Approve a document or memo after reading it once.",
  "Set done when the adviser has given advice and a next step and asks nothing that needs an answer.",
] as const;

/**
 * Pre-run change 1, item 4b: every check on a simulator reply (format, ids, length and this guard) shares one budget of
 * three model calls. A resend adds the note for each failed check, then the attempt line, after the rules.
 */
export const REVEAL_GUARD = { max_reveals: 2, calls_per_reply: 3 } as const;
export const REVEAL_NOTE = "Your last answer listed more than two facts in revealed. Reveal at most two hidden facts in one reply.";
export const attemptLine = (n: number): string => "This is attempt " + n + " of " + REVEAL_GUARD.calls_per_reply + ".";

/** Pre-run change 1, item 4e: the simulator's whole rules text per brief kind, attached to the change; the manifest binds each sha256. */
export const SIM_RULES_FILES = { founder: "sim-rules-founder.txt", builder: "sim-rules-builder.txt" } as const;
export const SIM_RULES_SHA256 = {
  founder: "4e57be24062e90d7871162561b5749728e2e3f2d527e29532212e53d8874aa40",
  builder: "8bf2b16592b3c3bb8fd56658e106298a988cfba57bb0c8d292d778ee2b8f9aff",
} as const;

/** Section 12 stage 3: the fixed-script simulator audit. */
export const AUDIT = { sample: 80, pass_max_share: 0.05, no_read_below: 40, effort: "max", auditors: ["astra", "opus"] as const } as const;
/** The six adviser messages the audit script sends to every sheet, in order (a build-time choice, pinned by the build commit). */
export const AUDIT_SCRIPT: readonly string[] = [
  "What's your goal with this session? A) Building a startup B) Pivot: deciding whether to change the business's direction C) Hackathon or demo D) Open source or research E) Learning F) Having fun. Recommendation: A, because you described a business.",
  "Tell me more about where things stand right now.",
  "Has anyone used it or paid for it yet? Who, and what did they do?",
  "What do the people you're building for do today instead, and what does that cost them?",
  "Would you like a second opinion from another adviser before we go on?",
  "My advice: before you build anything more, get one specific person to commit, and decide by a set date. Which do you choose? A) Do that this week B) Keep building as planned. Recommendation: A.",
];

/** Section 5: three stock blocks in every packet that must never score (a build-time choice, pinned by the build commit). */
export const STOCK_ROWS: readonly { row: 1 | 2 | 3; decision: string; next_action: string; why: string }[] = [
  { row: 1, decision: "Keep going and focus on growth.", next_action: "Talk to more customers this month.", why: "Customers matter most; focus wins; momentum matters." },
  { row: 2, decision: "Validate the idea before you build more.", next_action: "Build an MVP and get feedback from users.", why: "Feedback lowers risk; an MVP is cheap; iterate fast." },
  { row: 3, decision: "Weigh both options carefully and do what feels right.", next_action: "Write down the pros and cons and revisit next week.", why: "Both paths have merit; it depends on your goals; take your time." },
];

/** Section 12's judge check. */
export const JUDGE_CHECK = { min_outputs: 40, min_blocks: 40, kappa: 0.6, near_miss: 0.8, min_per_class: 10, anchor_max_share: 0.5 } as const;

/** Section 12 stage 4's admission conditions. */
export const ADMISSION = { a1_exposed_of_8: 6, a2_median_founder_replies: 3, a5_current_max: 0.75 } as const;

/** Section 8's missing limits. */
export const MISSING_LIMITS = { founder_differences: 0.1, cell_sessions: 0.1, contamination: 0.02 } as const;

/** Sections 7 and 10. */
export const DECISION = { bar: 0.15, builder_margin: -0.15, g2_questions: 1, g3_share: 0.2, design_effect: [1, 2] as const } as const;

/** Section 3's types and goals, and the briefs a skin holds. */
export const PAIRED_TYPES: readonly FounderType[] = ["T1", "T2", "T3", "T4", "T5", "T6"];
export const UNPAIRED_TYPES: readonly FounderType[] = ["T7", "T8"];
export const BUILDER_GOALS: readonly BuilderGoal[] = ["hackathon", "open-source", "research", "learning", "fun"];
export const QUOTA = { skins: 5, founder: 70, builder: 24, calibration: 8, reserve: 8, pairs: 34, unpaired: 42 } as const;

/** Pre-run change 1, item 4d: the two-step authoring pilot. */
export const PILOT = { first_read: 16, second_read: 32, z: 1.6448536269514722 } as const;

/** Section 4 step 5: per-session dollar allowances at the metering proxy, until stage 1 measures them (A6). */
export const ALLOWANCE: Readonly<Record<"none" | "skill", Readonly<Record<ModelId, number>>>> = {
  none: { opus: 3, sol: 2, particle: 1 },
  skill: { opus: 15, sol: 10, particle: 3 },
};
export const SIM_ALLOWANCE = 2;

/** The item caps recorded on 2026-11-17 after the prereg merged (pre-run change 1, item 4a). */
export const CAPS = { authoring: 251, simulator_audit: 41, stage1: 220, judge_check: 123, stage2: 1620, stage2_particle: 139, hosts: 22 } as const;
