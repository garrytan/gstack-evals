// Copyright (c) 2026 Garry Tan. MIT License.
// The eng-review build read's review arms (prereg 2026-11-11-geva-522 section 4): each arm's prompt, gstack pin and
// install, Stop hook and environment, and the review session's frozen limits. The skill arms keep stage 1's forced
// sentence, GSTACK_SESSION_KIND=unattended, the fixed AskUserQuestion answer and its Stop hook (lanes/eng-review), so a
// review arm here differs from stage 1's only in the common line, which asks for the improved plan in plan.md and has no
// closing template.
//
// - Prompt: the arm's prefix lines, then the common line, joined by one newline, as stage 1 joined them. plain has no
//   prefix; precut "/plan-eng-review plan.md", candidate "/plan-coverage plan.md" and engphase the unit's rendered
//   opening (lanes/eng-review/render.ts), each followed by the forced sentence. none runs no review session.
// - Stop hook: on the three skill arms only, never on plain. It runs the arm's frozen detector (exposure.ts) at each stop
//   and blocks with one fixed message naming the missing outputs, at most FROZEN.stopHook.maxBlocks times.
// - Session: the claude-code-preset system prompt, a 200,000-token window (the 1M context off), bundled skills off,
//   WebSearch and WebFetch denied, and FROZEN.sessions.review's dollars, turns and minutes. CLAUDE.md, AGENTS.md and
//   .claude/ are stripped from the unit's tree at any depth before arm setup, by prepareReviewTree (review-stage.ts).
import type { ErEvidence } from "../eng-review/exposure.ts";
import { ER_MAX_BLOCKS, erStopHook } from "../eng-review/stophook.ts";
import { ER_FORCED, ER_PINS } from "../../src/trial/review/eng-review.ts";
import { REC_REPLY } from "../../src/trial/review/plan.ts";
import { fail } from "./errors.ts";
import { FROZEN } from "./frozen.ts";
import type { Arm, SkillArm } from "./types.ts";

export const EB_COMMON = "Review the plan in plan.md for the code in /work/repo, and make it better before anyone builds it. Leave the improved plan in plan.md.";
export const EB_FORCED = ER_FORCED;
/** The one answer every AskUserQuestion gets, in every review arm. */
export const EB_ASK_ANSWER = REC_REPLY;

export interface GstackPin {
  repo: "garrytan/gstack";
  sha: string;
  version: string;
  install: "default" | "./setup --host claude";
}

export interface ReviewArm {
  arm: Arm;
  /** false: the arm runs no review session, and its build gets no /work/review/. */
  session: boolean;
  /** The skill command that opens the prompt, or null. */
  command: string | null;
  /** The prompt opens with the unit's rendered eng phase opening. */
  opening: boolean;
  /** The forced sentence follows the command or opening. */
  forced: boolean;
  gstack: GstackPin | null;
  stopHook: boolean;
  env: Readonly<Record<string, string>>;
}

const skill = (command: string | null, pin: { sha: string; version: string }, install: GstackPin["install"]): Omit<ReviewArm, "arm"> => ({
  session: true,
  command,
  opening: command === null,
  forced: true,
  gstack: { repo: "garrytan/gstack", sha: pin.sha, version: pin.version, install },
  stopHook: true,
  env: { GSTACK_SESSION_KIND: "unattended" },
});

export const REVIEW_ARMS: Readonly<Record<Arm, ReviewArm>> = {
  none: { arm: "none", session: false, command: null, opening: false, forced: false, gstack: null, stopHook: false, env: {} },
  plain: { arm: "plain", session: true, command: null, opening: false, forced: false, gstack: null, stopHook: false, env: {} },
  precut: { arm: "precut", ...skill("/plan-eng-review plan.md", ER_PINS.precut, "default") },
  engphase: { arm: "engphase", ...skill(null, ER_PINS.engphase, "default") },
  candidate: { arm: "candidate", ...skill("/plan-coverage plan.md", ER_PINS.candidate, "./setup --host claude") },
};

export const isSkillArm = (arm: Arm): arm is SkillArm => arm === "precut" || arm === "engphase" || arm === "candidate";

/** The review session's prompt for an arm; engphase needs its unit's rendered opening, and none has no session. */
export function reviewPrompt(arm: Arm, opening: string | null = null): string {
  const a = REVIEW_ARMS[arm];
  if (!a.session) return fail("E_USAGE", "the none arm runs no review session, so it has no prompt");
  if (a.opening && (opening === null || !opening.trim())) return fail("E_USAGE", "the eng phase arm's prompt needs its unit's rendered opening");
  const lead = a.opening ? [opening!.replace(/\s+$/, "")] : a.command ? [a.command] : [];
  return [...lead, ...(a.forced ? [EB_FORCED] : []), EB_COMMON].join("\n");
}

/** The frozen review session settings, the same for every arm and reviewer. */
export const REVIEW_SESSION = {
  systemPrompt: "claude-code-preset",
  contextTokens: 200_000,
  maxTurns: FROZEN.sessions.review.turns,
  timeoutS: FROZEN.sessions.review.minutes * 60,
  allowanceMicros: FROZEN.sessions.review.usd * 1_000_000,
  env: { CLAUDE_CODE_DISABLE_1M_CONTEXT: "1", CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" },
  deniedTools: ["WebSearch", "WebFetch"],
  strip: ["CLAUDE.md", "AGENTS.md", ".claude/"],
} as const;

if (ER_MAX_BLOCKS !== FROZEN.stopHook.maxBlocks) fail("E_INTERNAL", "stophook.ts blocks " + ER_MAX_BLOCKS + " times, but the prereg freezes " + FROZEN.stopHook.maxBlocks);

/** A fresh Stop hook for one session of a skill arm (stage 1's, unchanged), or null for plain and none. */
export function reviewStopHook(arm: Arm, evidence: (transcript: string) => ErEvidence): ReturnType<typeof erStopHook> | null {
  return isSkillArm(arm) ? erStopHook(arm, evidence) : null;
}
