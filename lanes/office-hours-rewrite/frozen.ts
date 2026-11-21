// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's cross-cutting frozen values (prereg wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg
// and its dated pre-run changes, as the second attempt's prereg wiki/plans/2026-11-18-geva-555-office-hours-rewrite-attempt-2-prereg
// changes them in its section 3: the slot set, the quotas, the reused briefs, authoring's draws, bound, pilot and
// projection stop, and the item caps). Strings quoted in the prereg or a pre-run change appear there byte for byte, and
// tests/ohr/frozen.test.ts checks each one against those posts. Area-specific frozen text (author prompts, the judge
// prompt, detector markers) lives in its area and is listed in the lane README as a build-time choice.
import type { ArmId, BuilderGoal, FounderType, JudgeKey, ModelId, SkillArm } from "./types.ts";

/** HOME inside every arm container: the trial image's agent user. */
export const CONTAINER_HOME = "/home/agent";

/** The first attempt's preregistration: everything its second attempt does not change still holds from it. */
export const PREREG_1 = "wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg/README.md";
/** The second attempt's preregistration, which this build serves. */
export const PREREG = "wiki/plans/2026-11-18-geva-555-office-hours-rewrite-attempt-2-prereg/README.md";
export const CHANGE_1 = "wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-1/README.md";
export const CHANGE_2 = "wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-2/README.md";
/** The second attempt's pre-run change 5, which moves both pins (PINS) and the Codex and Claude Code figures that follow from them. */
export const PIN_MOVE = "wiki/plans/2026-11-21-geva-555-office-hours-rewrite-attempt-2-pre-run-change-5/README.md";

/** Every seeded draw, order and sample in the eval (pre-run change 1, item 5). */
export const SEED = 20261117;

/** Section 4 step 1 and pre-run change 1, item 4c: each arm's first message, byte for byte. */
export const LENS_LINE = "Act as a YC partner holding office hours with me.";
export const SKILL_PREFIX = "/office-hours ";
/** The eval owner's ruling of 2026-11-19 (the second attempt's pre-run change 2): Sol runs in Codex CLI; Opus and particle-1 stay on Claude Code. */
export const HOSTS: Readonly<Record<ModelId, "claude" | "codex">> = { opus: "claude", sol: "codex", particle: "claude" };
/** The Claude Code version every Opus and particle-1 session runs, docker/host-cli.json's claude pin; each row's transcript must name it (the second attempt's pre-run change 2). */
export const CLAUDE_CODE_VERSION = "2.1.314";
/** A Codex skill arm names the skill with Codex's own mention syntax; the rest of the message is the same. */
export const CODEX_SKILL_PREFIX = "$office-hours ";
export const firstMessage = (arm: ArmId, opening: string, model: ModelId = "opus"): string => (arm === "none" ? "" : HOSTS[model] === "codex" ? CODEX_SKILL_PREFIX : SKILL_PREFIX) + LENS_LINE + "\n\n" + opening.trim();

/**
 * Pre-run change 2: the Codex CLI every Sol session runs, npm's latest stable on 2026-11-19, by version and checksum. The
 * trial image installs the package's vendor/<triple> directory under root (docker/trial.Dockerfile checks the tarball
 * and the binary), and docker/host-cli.json names the version as codex_office_hours_rewrite. Sol reaches OpenAI's
 * Responses route at the metering proxy as model, the openai provider's id for MODEL_KEYS.sol.
 */
export const CODEX = {
  version: "0.170.0",
  tarball: "https://registry.npmjs.org/@openai/codex/-/codex-0.170.0-linux-x64.tgz",
  tarball_sha256: "67c4bccce8e6c3a2b9ae0e586750e0efac7e0b8cd85e6b4734ad474317d2cc32",
  binary_sha256: "880819aab735adcf16f36cd628940b9f1e652a36c01d10a5d32f83cc84902971",
  root: "/opt/codex-0.170.0",
  bin: "/opt/codex-0.170.0/bin/codex",
  path_dir: "/opt/codex-0.170.0/codex-path",
  model: "gpt-6.1-sol",
  provider: "openai",
} as const;
/**
 * Every Sol session's Codex settings beside the proxy's provider entry, passed as -c pairs under --strict-config. Effort
 * and window are the catalog's own values for gpt-6.1-sol (default_reasoning_level low, context_window 500000), written
 * out. model_auto_compact_token_limit is Codex's auto-compaction key; unset, Codex 0.170.0 compacts at 9/10 of the
 * context window (ModelInfo::auto_compact_token_limit, protocol/src/openai_models.rs), 450000 here, and turn-end
 * compaction is off (model_post_turn_compact_threshold_percent defaults to 0). The bundled system skills, web search,
 * image generation, browser and computer use and apps are off; Claude Code has none of the last four, and its arms deny
 * WebSearch and WebFetch. The sleep tool (clock.sleep) is off too: Codex delivers the reply to a request_user_input_async
 * question only as a new user message, which exec gives only at the next turn (exec resume), so a model that sleeps to
 * wait for it would wait for nothing (run/codex.ts).
 */
export const CODEX_SETTINGS = {
  model_reasoning_effort: "low",
  model_context_window: 500_000,
  model_auto_compact_token_limit: 450_000,
  "skills.bundled.enabled": false,
  web_search: "disabled",
  "features.image_generation": false,
  "features.browser_use": false,
  "features.computer_use": false,
  "features.apps": false,
  "features.sleep_tool": false,
  check_for_update_on_startup: false,
  "analytics.enabled": false,
} as const;
/**
 * The one layout fix. gstack's `./setup --host codex` lists three skills twice under CODEX_HOME/skills: office-hours,
 * plan-design-review and gstack-upgrade each as gstack-<name> (a link into the tree's .agents/skills) and as a copy in the
 * runtime root, gstack/<name>/SKILL.md, with the same name and bytes. With office-hours listed twice, Codex injects
 * nothing for "$office-hours". Each Sol skill arm disables the three copies with one [[skills.config]] entry each,
 * path = "<CODEX_HOME>/<entry>" and enabled = false, and hides nothing else.
 */
export const CODEX_LAYOUT_FIX = ["skills/gstack/office-hours/SKILL.md", "skills/gstack/plan-design-review/SKILL.md", "skills/gstack/gstack-upgrade/SKILL.md"] as const;
/** The rendered office-hours SKILL.md each pin's Codex install serves, under HOME at both entries; the Sol arms' install check. */
export const CODEX_SKILL_FILES = [".codex/skills/gstack-office-hours/SKILL.md", ".codex/" + CODEX_LAYOUT_FIX[0]] as const;
export const CODEX_RENDERED: Readonly<Record<SkillArm, { sha256: string; bytes: number }>> = {
  current: { sha256: "9aabb2d1949aab7be03eb09814d56279cf1eba3a39f86e362739d48a263b1f72", bytes: 48_068 },
  new: { sha256: "7b927e4de37d5a2ca3db4d8691ec6926a1cc807d460b6a262454edaa9f22cdd7", bytes: 48_058 },
};
/**
 * A8's body on Claude Code (the second attempt's pre-run change 3): each pin's office-hours/SKILL.md less its frontmatter
 * (the lines from the opening --- to the closing --- and one blank line after it), which is what Claude Code 2.1.314
 * expands /office-hours into. The expansion is one user-side message in Claude Code's own session file: "Base directory
 * for this skill: <dir>", a blank line, this body, then "\n\nARGUMENTS: " and the rest of the first message. A keyless
 * capture on that binary showed the body arrives byte for byte, with no substitution. chars counts UTF-16 code units.
 */
export const CLAUDE_BODY: Readonly<Record<SkillArm, { sha256: string; chars: number }>> = {
  current: { sha256: "59f9c4c1f2ce21e27440d114ec0aba5a5b85af755a06a080c0a9d10f39231d9c", chars: 42_936 },
  new: { sha256: "ba035a7b7201c0217a7ece0059ca5c2e242aea22fe78b864200c2de6ffc9c93b", chars: 42_862 },
};
/** Changed lines in the unified diff from current to new, the same for the pins' office-hours/SKILL.md and for Codex's render of it. */
export const RENDER_GAP = 62;

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
 * Section 2's pins, as the second attempt's pre-run change 5 (PIN_MOVE) sets them. new is the content change's final
 * head, after it merged gstack main in, and current is that head's merge base with gstack main. Both check the same
 * helper paths. VERSION is 1.102.0.0 at both commits, so only the file hashes tell the pins apart; each container checks
 * every one. VERSION's own sha256 is the one pin-current.tsv and pin-new.tsv list, and it is checked beside the trimmed
 * text (pre-run change 4).
 */
export interface Pin {
  sha: string;
  version: string;
  /** sha256 of the VERSION file's bytes, as the pin tables list it. */
  version_sha256: string;
  files: Readonly<Record<string, string>>;
}
export const GSTACK_REPO = "garrytan/gstack";
export const PINS: Readonly<Record<SkillArm, Pin | null>> = {
  current: {
    sha: "858679423cc4778f9961d4aaf3c061a9368985ec",
    version: "1.102.0.0",
    version_sha256: "2ff194b6ed856895a2fcd37b3e7c2bb60b623f3e594c839f481932e22f37f393",
    files: {
    "office-hours/SKILL.md": "6cfa24bd67d8ea29563ae9c4d0e35ed1a96fa46b36c68f11582400aebe32d12d",
    "office-hours/SKILL.md.tmpl": "44ea3f4830cf5c24ae83a51c9c519ef9e37e59820974d2bfea149258f59e4fe8",
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
    "bin/gstack-session-kind": "455e02bbe35e50a92a6650b9c2690358091ca090b7a33aa6f09d3b3662dbbc67",
    "bin/gstack-skill-start": "5468478202f4e5331a4a06b9e14c89595f3425928214e5dbd53015eba1a92ded",
    "lib/founder-resources.ts": "788aa18d9ae400d6ab81ad51126030be8869ffb66001f28ccb68d906aadb37ad",
    },
  },
  new: {
    sha: "8fcca8a5a0491ca6077b28103d85a47938fa6264",
    version: "1.102.0.0",
    version_sha256: "2ff194b6ed856895a2fcd37b3e7c2bb60b623f3e594c839f481932e22f37f393",
    files: {
      "office-hours/SKILL.md": "30ff20bce6b13af39a61ff92fd1c6c968490512f3a207ca4e915041816ee2f2d",
      "office-hours/SKILL.md.tmpl": "d5aed1eabf1adcd0b0a040db5b8d6649222d99ad485073dd42840e0b6ee61efe",
      "office-hours/sections/design-and-handoff.md": "dedaede7e5e83ff8e8ccb75d5a9c610174c228f2501475abe15cef5d8433a144",
      "office-hours/sections/design-and-handoff.md.tmpl": "79350fd2a4ee877414860279bd2a971e5d7e758ae55634960b4b35369289a076",
      "office-hours/sections/landscape.md": "6c70b6eaac271fc27951268dd8062b6ec3b1d502b4ef6b9ddb690c3d24419c61",
      "office-hours/sections/landscape.md.tmpl": "b051290a583a1f8e5545f00beec57126b22120e869186615ead83abe8750ed09",
      "office-hours/sections/manifest.json": "17b6d1a986189272b5f7715d4d603952d8170f79ee4cf6679a62b4f5de591fcb",
      "office-hours/sections/phase-2a-startup-diagnostic.md": "f62e3fbd1dc864f99ab9d7ee25930534d2ea5c22786ce5d67d0b0aa72290ba05",
      "office-hours/sections/phase-2a-startup-diagnostic.md.tmpl": "00ac8ff5e4a59aa37c737599806436c16ba5f34863bc203062f42dd25670f0ba",
      "office-hours/sections/phase-2b-builder-brainstorm.md": "05251d190b32f1da63165e8339211404963556ef5b9cf4c3e46361cbc51027e2",
      "office-hours/sections/phase-2b-builder-brainstorm.md.tmpl": "604794b75cb79230ce728a70cab9bf02747cb2deafbcd6899ade0c39bc550f3e",
      "office-hours/sections/phase-2c-pivot-discovery.md": "559b4ebf91bb1e7fd8b80ce7df09d5b85c77f7f7ca671f6ba434a621f1e26dc6",
      "office-hours/sections/phase-2c-pivot-discovery.md.tmpl": "5b7aae97025f0b6049bfd01334b48b6418cadd8156cbf8f44a4899ed3864ae9a",
      "office-hours/sections/preamble.md": "188d404f839d5abb390dd96f716fa965a0d8b2d2a40619fd2ff75f4d6ba7f001",
      "office-hours/sections/second-opinion.md": "0ef8cc1c5ce9e614b1ea7d0fadce66128c43855c48d50104898900fb7590aa62",
      "office-hours/sections/second-opinion.md.tmpl": "c5714e290efb8b2a117f79c180d01595e6c2445860dbff70beaad0d3359070a4",
      "office-hours/sections/visual-design.md": "fdd31b99d7f19fbe08d7d2407112f81e1a242f4d90d321e69007e15633378595",
      "office-hours/sections/visual-design.md.tmpl": "98e49e16af227c7199dc3e4b84790f2aef22a857b20563dfe2f2a1625c9d2b30",
      "bin/gstack-builder-profile": "11e99f40f65190986b6c95a93db9058b16e9556227e23f99adf03a9f915b9ae7",
      "bin/gstack-design-doc-find": "e7e2fc8cca965453303f7c3a9104d20ec4c1c9fbcf6672dd86a7c141c7e39951",
      "bin/gstack-developer-profile": "0320009508bae043a9d5dce5082a26e294698257f89cc63bbcf5a103ebf5f905",
      "bin/gstack-founder-resources": "ba9d03881e6edf087b84b4c45868a2bd9b3cdc6b1483f7917fdede5ed8ef97cb",
      "bin/gstack-session-kind": "455e02bbe35e50a92a6650b9c2690358091ca090b7a33aa6f09d3b3662dbbc67",
      "bin/gstack-skill-start": "5468478202f4e5331a4a06b9e14c89595f3425928214e5dbd53015eba1a92ded",
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
/**
 * The second attempt's section 3, item 1: four comparison skins, 56 founder briefs (24 pairs and 8 unpaired, 32
 * clusters) and the same 24 builders, 8 calibration and 8 reserve briefs, 96 in all, from 28 pair slots and 40 unpaired.
 */
export const QUOTA = { skins: 4, founder: 56, builder: 24, calibration: 8, reserve: 8, pairs: 28, unpaired: 40 } as const;

/** The second attempt's section 4: the 8 comparison founder slots of the first attempt's schedule it drops. */
export const DROPPED_SLOTS: readonly string[] = ["com1-T1", "com1-T2", "com1-T3", "com1-T4", "com1-T5", "com1-T6", "com1-T7", "com5-T8"];
/** Section 4: the slots of the 19 briefs the first attempt placed, which this run reuses. */
export const REUSED_SLOTS: readonly string[] = ["cal0-research", "com2-T4", "com2-T6", "com3-T2", "com3-T3", "com4-T6", "com5-T5", "com4-T7", "com5-T7", "com2-fun", "com2-open-source", "com3-open-source", "com5-fun"];
/** Section 4: the sha256 of the plaintext (the tar stream age wraps) of the first attempt's sealed authoring output. */
export const REUSE_PLAINTEXT_SHA256 = "971ec21b83e6b6be65c5e54b7f5fd2aec0cca805fea1bbea2c0a908a0e15cfea";

/** Section 5.3, as the Captain ruled on 2026-11-18: the second-twin draws a partner gets; when all fail, the partner drops and its slot starts a new pair. */
export const TOP_UP_BOUND = 30;

/** Section 5.4: the first two open slots of each pair type, each until it settles one partner or drafts 3 first twins, and 8 drafts each of T7, T8 and builders. */
export const PILOT = { pair_slots: 2, first_twins: 3, unpaired_drafts: 8 } as const;

/** Section 13's allowance for authoring's costliest unit, a brief. */
export const BRIEF_ALLOWANCE = 3.5;

/**
 * Section 5.5's projection, a descriptive read since the Captain's ruling of 2026-11-18: rates at the 0.95 quantile of
 * their Jeffreys posterior, the first attempt's costs a draft, room for the drafts in flight (8 at the brief allowance),
 * and the first attempt's final-path counts as sizing.py, Part D, lists them: first twins passed of drafted, each pair type's partners matched within the bound's 30 draws of
 * settled, the draws matched partners took (1, 1, 1, 2, 19 and 26) over how many matched, and each unpaired kind's
 * passes of drafts.
 */
export const PROJECTION = {
  quantile: 0.95,
  usd: { first: 0.887, second: 0.093, unpaired: 0.545 },
  held: 8,
  attempt1: {
    first: [10, 15],
    partners: { T1: [0, 1], T2: [1, 1], T3: [1, 1], T4: [1, 2], T5: [1, 1], T6: [2, 2] },
    matched_draws: [50, 6],
    unpaired: { T7: [2, 41], T8: [0, 0], builder: [5, 41] },
  },
} as const;

/** Section 4 step 5: per-session dollar allowances at the metering proxy, until stage 1 measures them (A6). */
export const ALLOWANCE: Readonly<Record<"none" | "skill", Readonly<Record<ModelId, number>>>> = {
  none: { opus: 3, sol: 2, particle: 1 },
  skill: { opus: 15, sol: 10, particle: 3 },
};
export const SIM_ALLOWANCE = 2;

/** The second attempt's section 7: each item's cap, 1.35 times central plus what its parallel calls hold at open. */
export const CAPS = { authoring: 409, simulator_audit: 40, stage1: 220, judge_check: 123, stage2: 1406, stage2_particle: 130, hosts: 19 } as const;

/** Pre-run change 5: the bound on empty replies (status 200, no answer) for every metered run of this eval. */
export const EMPTY_BOUND = { streak: 3, share: 0.01, floor: 100 } as const;
