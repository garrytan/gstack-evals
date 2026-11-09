// Copyright (c) 2026 Garry Tan. MIT License.
// The pstack-checks arms (plan sections 4, 5 and 13): P, C, N and the blind probe, worded exactly as section 4 words them,
// the shared suffix, the wrap-up turn, P's leading skill command and the recorded fallback to the /pstack: names, and the
// limits of each turn per arm and model. The allowance-doubling rule after admission is admission.ts costReading; its
// allowance table goes in here as `allowance`.
import { ALLOWANCE, BLIND_ALLOWANCE_USD, MODELS, OPUS, P1, SOL, type Arm } from "./items.ts";
import { pfFail } from "./prereg.ts";

export type PfArm = Arm | "blind";
export const PF_ARMS: readonly PfArm[] = ["P", "C", "N", "blind"];

export const TEXT: Record<PfArm, string> = {
  P: "/create-formal-verification-skill model the state machine behind this bug report, and use /statechart to visualize the flow it breaks.",
  C: "Formally model the state machine behind this bug report with a model checker, and draw the flow it breaks as a statechart. When the model describes code, replay each bug path against the real code, as a test or a live repro, one step for each action.",
  N: "Write a test that catches the bug in this bug report.",
  blind: "/create-formal-verification-skill model the state machines in {scope}, one skill per subsystem, and use /statechart to visualize the most important flows.",
};
export const SUFFIX_HEAD = "Here is the bug report:";
export const SUFFIX_TAIL = "My app is the repository in this directory. Don't stop to ask.";
export const WRAPUP =
  'Last step. Write CHECKS.json at the repository root: a JSON array with one object for each check you left in this repository that someone can rerun. Each object has "name", "command" and "what_it_checks". "command" must run from the repository root with no network and run only that one check, so list a check that covers several properties or tests once per property or test. List only checks that are already in the repository. Don\'t write or change any other file.';
export const NO_ANSWER = "No one is available to answer. Use your own judgment.";

/** The skill commands P and the blind probe open with. "short" is the plan's wording; "plugin" is the recorded fallback
 *  when the pinned Claude Code does not resolve the short name (the dry run decides and records it). */
export const NAMES = { short: ["/create-formal-verification-skill", "/statechart"], plugin: ["/pstack:create-formal-verification-skill", "/pstack:statechart"] } as const;
export type Names = keyof typeof NAMES;

const JS_SPACE = /[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$/;

/** The arm's text with the chosen skill names: the leading command and the later /statechart, each once. */
export function withNames(arm: PfArm, names: Names = "short"): string {
  const text = TEXT[arm];
  if (arm !== "P" && arm !== "blind") return text;
  const [cmd, chart] = NAMES[names];
  const out = text.replace(/^\/create-formal-verification-skill /, cmd + " ").replace(/ \/statechart /, " " + chart + " ");
  if (!out.startsWith(cmd + " ") || !out.includes(" " + chart + " ")) pfFail("E_PF_ARM", "arm " + arm + " does not carry both skill commands");
  return out;
}

/** The task turn: the arm's text, a blank line, then section 4's suffix with the issue text (JavaScript's trailing
 *  whitespace removed). The blind probe takes the scope (one line) and the suffix without the bug report. */
export function taskTurn(arm: PfArm, input: { issue?: string; scope?: string; names?: Names }): string {
  const text = withNames(arm, input.names ?? "short");
  if (arm === "blind") {
    const scope = input.scope ?? "";
    if (!scope || /[\n\r`]/.test(scope)) pfFail("E_PF_ARM", "the blind probe's scope must be one line with no backtick, not " + JSON.stringify(scope));
    return text.replace("{scope}", () => scope) + "\n\n" + SUFFIX_TAIL;
  }
  const issue = (input.issue ?? "").replace(JS_SPACE, "");
  if (!issue.trim()) pfFail("E_PF_ARM", "arm " + arm + ": the bug report is empty");
  return text + "\n\n" + SUFFIX_HEAD + "\n\n" + issue + "\n\n" + SUFFIX_TAIL;
}

export interface TurnLimits { wall_limit_sec: number; max_turns: number; allowance_usd: number; quiet_sec: number; bg_wait_sec: number }
/** The rig's quiet and background-wait rule, as the state machines arms run it (registry.json sm limits). */
export const QUIET_SEC = 30, BG_WAIT_SEC = 600;
export const TASK_LIMITS: Record<PfArm, { wall_limit_sec: number; max_turns: number }> = {
  P: { wall_limit_sec: 5400, max_turns: 250 }, C: { wall_limit_sec: 5400, max_turns: 250 }, N: { wall_limit_sec: 3600, max_turns: 150 }, blind: { wall_limit_sec: 5400, max_turns: 250 },
};
export const WRAPUP_LIMITS = { wall_limit_sec: 300, max_turns: 20 } as const;
export const WRAPUP_ALLOWANCE: Record<string, number> = { [OPUS]: 6, [SOL]: 3, [P1]: 0.5 };

/** Both turns' limits for one session. allowance is the task-turn table (items.ts ALLOWANCE, or costReading's doubled one). */
export function sessionLimits(arm: PfArm, model: string, allowance: Record<Arm, Record<string, number>> = ALLOWANCE): { task: TurnLimits; wrapup: TurnLimits } {
  if (!(MODELS as readonly string[]).includes(model)) pfFail("E_PF_ARM", "model " + model + " is not one of " + MODELS.join(", "));
  if (arm === "blind" && model !== OPUS) pfFail("E_PF_ARM", "the blind probe runs on Opus only");
  const task = arm === "blind" ? BLIND_ALLOWANCE_USD : allowance[arm]?.[model];
  if (!(typeof task === "number" && task > 0)) pfFail("E_PF_ARM", "arm " + arm + " has no allowance for " + model);
  const rig = { quiet_sec: QUIET_SEC, bg_wait_sec: BG_WAIT_SEC };
  return { task: { ...TASK_LIMITS[arm], allowance_usd: task!, ...rig }, wrapup: { ...WRAPUP_LIMITS, allowance_usd: WRAPUP_ALLOWANCE[model]!, ...rig } };
}

/** The harness rules every arm shares (sections 3 and 4). P and the blind probe alone mount the pstack plugin. */
export const ARM_ENV = { CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" } as const;
export const DISALLOWED_TOOLS = ["WebSearch", "WebFetch"] as const;
export const loadsPlugin = (arm: PfArm): boolean => arm === "P" || arm === "blind";
